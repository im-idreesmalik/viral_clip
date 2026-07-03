import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { type NextRequest } from "next/server";
import { resolveKey, stat } from "@/lib/storage";
import { getSession } from "@/lib/auth";
import { verifyMediaSig } from "@/lib/media-url";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ path: string[] }> };

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4v": "video/x-m4v",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".srt": "application/x-subrip",
  ".ass": "text/x-ssa",
  ".vtt": "text/vtt",
};

/**
 * Serve stored media with HTTP range support (required for video scrubbing).
 * Public by design — IG/FB and CDNs fetch it unauthenticated. In production,
 * front this with a CDN and/or signed URLs.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { path: segments } = await ctx.params;
  const key = segments.join("/");

  // Access control: allow a valid short-lived signature (used by IG/FB pull
  // upload) OR an authenticated session (dashboard playback). Otherwise 404 —
  // never expose another tenant's media by id. (404, not 401, to avoid leaking
  // whether a key exists.)
  const url = new URL(req.url);
  const signed = verifyMediaSig(key, url.searchParams.get("exp"), url.searchParams.get("sig"));
  if (!signed) {
    const session = await getSession();
    if (!session) return new Response("Not found", { status: 404 });
  }

  let absPath: string;
  let size: number;
  let mtimeMs = 0;
  try {
    absPath = resolveKey(key);
    const info = await stat(key);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    size = info.size;
    mtimeMs = info.mtimeMs;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const ext = path.extname(absPath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const range = req.headers.get("range");

  // Rendered clips/thumbnails are content-addressed (immutable). Cache hard for
  // signed URLs (CDN-friendly); keep session access private. Support 304.
  const etag = `"${size.toString(16)}-${Math.round(mtimeMs).toString(16)}"`;
  const cacheControl = signed
    ? "public, max-age=31536000, immutable"
    : "private, max-age=86400";
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": cacheControl } });
  }

  // Range request -> 206 Partial Content.
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : size - 1;
      if (start >= size || end >= size || start > end) {
        return new Response("Range Not Satisfiable", {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }
      const stream = createReadStream(absPath, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": cacheControl,
          ETag: etag,
        },
      });
    }
  }

  const stream = createReadStream(absPath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
      ETag: etag,
    },
  });
}

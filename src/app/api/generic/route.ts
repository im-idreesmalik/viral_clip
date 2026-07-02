import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import fsp from "node:fs/promises";
import path from "node:path";
import { handler, ok, created, requireSession, ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { listGenericFootage, nextGenericName, resolveKey, ensureDirFor } from "@/lib/storage";
import { normalizeToVertical } from "@/services/video/ffmpeg";

// Streaming uploads of (potentially large) generic footage.
export const runtime = "nodejs";
export const maxDuration = 300;

const ALLOWED_EXT = new Set(["mp4", "mov", "mkv", "webm", "avi", "m4v"]);

// Serialize in-request transcodes so multiple concurrent uploads can't spawn
// multiple ffmpeg processes and saturate the web server's CPU/GPU.
let transcodeChain: Promise<unknown> = Promise.resolve();
function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = transcodeChain.then(fn, fn);
  transcodeChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// GET /api/generic — list the generic/stock footage in storage/generic.
export const GET = handler(async () => {
  await requireSession();
  const files = listGenericFootage();
  const items = await Promise.all(
    files.map(async (p) => {
      const name = path.basename(p);
      let sizeBytes = 0;
      try {
        sizeBytes = (await fsp.stat(p)).size;
      } catch {
        /* ignore */
      }
      return { name, sizeBytes, url: `/api/media/generic/${encodeURIComponent(name)}` };
    }),
  );
  return ok(items);
});

// POST /api/generic — upload a generic video into storage/generic.
export const POST = handler(async (req) => {
  await requireSession();

  // Reject oversized uploads up front (before reading the body) to protect disk.
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength && contentLength > env.maxUploadBytes) {
    throw new ApiError(413, `File too large (max ${Math.round(env.maxUploadBytes / 1024 / 1024)} MB).`);
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "No file provided (field 'file').");
  if (file.size > env.maxUploadBytes) {
    throw new ApiError(413, `File too large (max ${Math.round(env.maxUploadBytes / 1024 / 1024)} MB).`);
  }

  const ext = (path.extname(file.name).slice(1) || "mp4").toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new ApiError(400, `Unsupported type .${ext}. Allowed: ${[...ALLOWED_EXT].join(", ")}`);
  }

  // Stored file is always a normalized vertical .mp4, auto-named in sequence
  // (1.mp4, 2.mp4, …) so the library stays ordered without the user naming it.
  const safe = nextGenericName();
  const key = `generic/${safe}`;
  // Temp lands with a non-video extension so it's ignored by the footage lister
  // while the upload + transcode are in flight.
  const tmpKey = `generic/.uploading-${safe}-${file.size}.part`;
  await ensureDirFor(key);

  const tmpPath = resolveKey(tmpKey);
  const outPath = resolveKey(key);

  // 1. Stream the raw upload to a temp file.
  const nodeStream = Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(nodeStream, createWriteStream(tmpPath));

  // 2. Transcode to a 1080x1920 (9:16) vertical MP4 so every generic clip is
  //    vertical before it's ever used. Serialized + timed-out inside
  //    normalizeToVertical. Always clean up the temp file.
  try {
    await runExclusive(() => normalizeToVertical(tmpPath, outPath));
  } finally {
    await fsp.rm(tmpPath, { force: true }).catch(() => undefined);
  }

  return created({ name: safe });
});

import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import fsp from "node:fs/promises";
import path from "node:path";
import { handler, ok, created, requireSession, ApiError } from "@/lib/api";
import { listGenericFootage, resolveKey, ensureDirFor } from "@/lib/storage";

// Streaming uploads of (potentially large) generic footage.
export const runtime = "nodejs";
export const maxDuration = 300;

const ALLOWED_EXT = new Set(["mp4", "mov", "mkv", "webm", "avi", "m4v"]);

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

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "No file provided (field 'file').");

  const ext = (path.extname(file.name).slice(1) || "mp4").toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new ApiError(400, `Unsupported type .${ext}. Allowed: ${[...ALLOWED_EXT].join(", ")}`);
  }

  // Sanitize to a safe, folder-local filename.
  const safe =
    path.basename(file.name).replace(/[^\w.\- ]+/g, "_").trim() || `generic-${file.size}.${ext}`;
  const key = `generic/${safe}`;
  await ensureDirFor(key);

  const nodeStream = Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(nodeStream, createWriteStream(resolveKey(key)));

  return created({ name: safe });
});

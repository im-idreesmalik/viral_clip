import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { ClipMode, VideoSource, VideoStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handler, created, requireSession, ApiError } from "@/lib/api";
import { resolveKey, ensureDirFor } from "@/lib/storage";
import { enqueueProcessVideo } from "@/lib/queue";
import { serializeVideo } from "@/lib/serialize";

// Stream large uploads straight to disk rather than buffering in memory.
export const runtime = "nodejs";
export const maxDuration = 300;

function field(form: FormData, name: string): string | undefined {
  const v = form.get(name);
  return typeof v === "string" ? v : undefined;
}

function intField(form: FormData, name: string, fallback: number): number {
  const raw = field(form, name);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

const ALLOWED_EXT = new Set(["mp4", "mov", "mkv", "webm", "avi", "m4v"]);

// POST /api/videos/upload — multipart file upload, then start processing.
export const POST = handler(async (req) => {
  const session = await requireSession();

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "No file provided (field 'file').");

  const ext = (path.extname(file.name).slice(1) || "mp4").toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new ApiError(400, `Unsupported file type .${ext}. Allowed: ${[...ALLOWED_EXT].join(", ")}`);
  }

  const clipModeRaw = field(form, "clipMode");
  const clipMode = clipModeRaw === ClipMode.FULL ? ClipMode.FULL : ClipMode.VIRAL;
  // burnCaptions defaults to true unless explicitly "false".
  const burnCaptions = field(form, "burnCaptions") !== "false";

  const video = await prisma.video.create({
    data: {
      userId: session.sub,
      title: field(form, "title") || file.name.replace(/\.[^.]+$/, "") || "Uploaded video",
      source: VideoSource.UPLOAD,
      status: VideoStatus.PENDING,
      clipMode,
      viralThreshold: clampInt(intField(form, "viralThreshold", 70), 0, 100),
      segmentSeconds: clampInt(intField(form, "segmentSeconds", 45), 15, 60),
      targetClipCount: clampInt(intField(form, "targetClipCount", 8), 1, 30),
      burnCaptions,
    },
  });

  const key = `videos/${video.id}/source.${ext}`;
  await ensureDirFor(key);

  // Stream the upload to disk.
  const nodeStream = Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(nodeStream, createWriteStream(resolveKey(key)));

  await prisma.video.update({
    where: { id: video.id },
    data: { storageKey: key, sizeBytes: BigInt(file.size) },
  });

  await enqueueProcessVideo(video.id);

  const fresh = await prisma.video.findUniqueOrThrow({ where: { id: video.id } });
  return created(serializeVideo(fresh));
});

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

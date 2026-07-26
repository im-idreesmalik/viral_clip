import path from "node:path";
import { prisma } from "@/lib/db";
import { handler, ok, created, requireAdmin, ApiError } from "@/lib/api";
import { writeFile, ensureDirFor, resolveKey, publicUrl } from "@/lib/storage";
import { probe } from "@/services/video/ffmpeg";
import { enqueueGenerateMusic } from "@/lib/queue";

const AUDIO_EXT = new Set(["mp3", "wav", "m4a", "ogg", "aac", "flac"]);

// GET /api/admin/music — every track (incl. who claimed it), for Super Admin.
export const GET = handler(async () => {
  await requireAdmin();
  const tracks = await prisma.backgroundMusic.findMany({
    orderBy: { createdAt: "desc" },
    include: { claimedBy: { select: { name: true, email: true } } },
  });
  return ok(
    tracks.map((t) => ({
      id: t.id,
      title: t.title,
      mood: t.mood,
      source: t.source,
      durationSec: t.durationSec,
      url: t.storageKey ? publicUrl(t.storageKey) : null,
      generating: !t.storageKey, // no file yet = AI generation in progress
      claimedBy: t.claimedBy?.name ?? t.claimedBy?.email ?? null,
    })),
  );
});

// POST /api/admin/music — JSON body => generate a track locally with MusicGen;
// multipart => upload a ready audio file. Both land in the shared library.
export const POST = handler(async (req) => {
  await requireAdmin();

  if ((req.headers.get("content-type") || "").includes("application/json")) {
    const body = (await req.json().catch(() => ({}))) as {
      prompt?: string;
      title?: string;
      mood?: string;
      durationSec?: number;
    };
    const prompt = String(body.prompt ?? "").trim();
    const title = String(body.title ?? "").trim();
    const mood = String(body.mood ?? "").trim() || null;
    const durationSec = Math.max(5, Math.min(30, Number(body.durationSec) || 25));
    if (prompt.length < 10) throw new ApiError(400, "Add a music description prompt.");
    if (!title) throw new ApiError(400, "Add a title.");
    // Pending row (empty storageKey) — the worker fills it in.
    const row = await prisma.backgroundMusic.create({ data: { title, mood, source: "GENERATED", storageKey: "" } });
    await enqueueGenerateMusic(row.id, prompt, durationSec);
    return created({ id: row.id, generating: true });
  }

  const form = await req.formData();
  const file = form.get("file");
  const title = String(form.get("title") ?? "").trim();
  const mood = String(form.get("mood") ?? "").trim() || null;
  if (!(file instanceof File)) throw new ApiError(400, "Choose an audio file.");
  if (!title) throw new ApiError(400, "Add a title.");
  const ext = (path.extname(file.name).slice(1) || "mp3").toLowerCase();
  if (!AUDIO_EXT.has(ext)) {
    throw new ApiError(400, `Unsupported audio type .${ext}. Allowed: ${[...AUDIO_EXT].join(", ")}`);
  }

  const row = await prisma.backgroundMusic.create({
    data: { title, mood, source: "UPLOAD", storageKey: "" },
  });
  try {
    const key = `music/${row.id}.${ext}`;
    await ensureDirFor(key);
    await writeFile(key, Buffer.from(await file.arrayBuffer()));
    const meta = await probe(resolveKey(key)).catch(() => null);
    const updated = await prisma.backgroundMusic.update({
      where: { id: row.id },
      data: { storageKey: key, durationSec: meta?.durationSec ?? null },
    });
    return created({ id: updated.id, title: updated.title });
  } catch (err) {
    await prisma.backgroundMusic.delete({ where: { id: row.id } }).catch(() => undefined);
    throw new ApiError(500, `Upload failed: ${err instanceof Error ? err.message : err}`);
  }
});

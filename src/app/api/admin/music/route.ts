import path from "node:path";
import { prisma } from "@/lib/db";
import { handler, ok, created, requireAdmin, ApiError } from "@/lib/api";
import { writeFile, ensureDirFor, resolveKey, publicUrl } from "@/lib/storage";
import { probe } from "@/services/video/ffmpeg";

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
      url: publicUrl(t.storageKey),
      claimedBy: t.claimedBy?.name ?? t.claimedBy?.email ?? null,
    })),
  );
});

// POST /api/admin/music — upload a track into the shared library (multipart).
export const POST = handler(async (req) => {
  await requireAdmin();
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

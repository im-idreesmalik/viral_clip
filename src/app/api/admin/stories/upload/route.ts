import path from "node:path";
import { StorySource, StoryStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handler, created, requireAdmin, ApiError } from "@/lib/api";
import { serializeStory } from "@/lib/serialize";
import { enqueueStoryAudio } from "@/lib/queue";
import { resolveKey, ensureDirFor, writeFile } from "@/lib/storage";
import { probe } from "@/services/video/ffmpeg";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;

const AUDIO_EXT = new Set(["mp3", "wav", "m4a", "aac", "ogg", "opus", "flac", "webm"]);

// POST /api/admin/stories/upload — multipart. kind=voice uploads a ready audio
// file (no TTS); kind=text uploads a .txt whose voice-over is then synthesized.
export const POST = handler(async (req) => {
  await requireAdmin();

  const form = await req.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") || "voice");
  const title = String(form.get("title") || "").trim();
  const language = String(form.get("language") || "en") === "ur" ? "ur" : "en";
  if (!(file instanceof File)) throw new ApiError(400, "No file provided (field 'file').");
  if (file.size > env.maxUploadBytes) throw new ApiError(413, "File too large.");
  if (!title) throw new ApiError(400, "A title is required.");

  if (kind === "text") {
    const text = (await file.text()).trim();
    if (text.length < 20) throw new ApiError(400, "The text file looks empty.");
    const story = await prisma.story.create({
      data: { title, language, source: StorySource.UPLOAD, status: StoryStatus.GENERATING, text },
    });
    await enqueueStoryAudio(story.id);
    return created(serializeStory(story, { includeAdmin: true }));
  }

  // Voice upload: store the audio as-is and mark the story ready immediately.
  const ext = (path.extname(file.name).slice(1) || "mp3").toLowerCase();
  if (!AUDIO_EXT.has(ext)) {
    throw new ApiError(400, `Unsupported audio type .${ext}. Allowed: ${[...AUDIO_EXT].join(", ")}`);
  }
  const optionalText = String(form.get("text") || "").trim();

  const story = await prisma.story.create({
    data: { title, language, source: StorySource.UPLOAD, status: StoryStatus.GENERATING, text: optionalText },
  });
  try {
    const audioKey = `stories/${story.id}/audio.${ext}`;
    await ensureDirFor(audioKey);
    await writeFile(audioKey, Buffer.from(await file.arrayBuffer()));
    const meta = await probe(resolveKey(audioKey)).catch(() => null);
    const updated = await prisma.story.update({
      where: { id: story.id },
      data: {
        audioKey,
        durationSec: meta?.durationSec ?? null,
        voice: "uploaded",
        status: StoryStatus.READY,
      },
    });
    return created(serializeStory(updated, { includeAdmin: true }));
  } catch (err) {
    await prisma.story
      .update({ where: { id: story.id }, data: { status: StoryStatus.FAILED, errorMessage: String(err) } })
      .catch(() => undefined);
    throw new ApiError(500, `Upload failed: ${err instanceof Error ? err.message : err}`);
  }
});

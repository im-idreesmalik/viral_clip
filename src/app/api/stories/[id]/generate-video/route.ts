import fsp from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ClipMode, FootageMode, StoryStatus, VideoSource, VideoStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handler, created, parseBody, requireSession, ApiError } from "@/lib/api";
import { serializeVideo } from "@/lib/serialize";
import { enqueueProcessVideo } from "@/lib/queue";
import { resolveKey, ensureDirFor } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

// Same clip options as New Video, minus footage (a story is audio-only, so its
// visuals always come from GENERIC stock footage / a synthetic background).
const schema = z.object({
  clipMode: z.nativeEnum(ClipMode).default(ClipMode.FULL),
  viralThreshold: z.number().int().min(0).max(100).default(70),
  segmentSeconds: z.number().int().min(15).max(60).default(45),
  targetClipCount: z.number().int().min(1).max(30).default(8),
  burnCaptions: z.boolean().default(true),
  captionStyle: z.string().max(20).default("default"),
  shortTitle: z.string().max(80).optional(),
  showShortTitle: z.boolean().default(false),
});

// POST /api/stories/[id]/generate-video — claim a story and start generating a
// video from its voice-over. Once claimed, the story disappears from the public
// library for everyone.
export const POST = handler(async (req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);

  const story = await prisma.story.findUnique({ where: { id } });
  if (!story) throw new ApiError(404, "Story not found");
  if (story.status !== StoryStatus.READY || story.claimedById) {
    throw new ApiError(409, "This story is no longer available.");
  }
  if (!story.audioKey) throw new ApiError(409, "This story has no voice-over yet.");

  // Atomically claim it so two users can't grab the same story at once.
  const claim = await prisma.story.updateMany({
    where: { id, status: StoryStatus.READY, claimedById: null },
    data: { status: StoryStatus.CLAIMED, claimedById: session.sub, claimedAt: new Date() },
  });
  if (claim.count === 0) throw new ApiError(409, "This story was just claimed by someone else.");

  try {
    const video = await prisma.video.create({
      data: {
        userId: session.sub,
        title: story.title,
        source: VideoSource.UPLOAD,
        status: VideoStatus.PENDING,
        clipMode: body.clipMode,
        viralThreshold: body.viralThreshold,
        segmentSeconds: body.segmentSeconds,
        targetClipCount: body.targetClipCount,
        burnCaptions: body.burnCaptions,
        captionStyle: body.captionStyle,
        shortTitle: body.shortTitle?.trim() || null,
        showShortTitle: body.showShortTitle,
        // Stories are audio-only → always stock/generic visuals.
        footageMode: FootageMode.GENERIC,
        language: story.language,
      },
    });

    // Copy the story's voice-over into the video's own storage so the video is
    // self-contained (survives the story later being deleted).
    const ext = path.extname(story.audioKey) || ".mp3";
    const storageKey = `videos/${video.id}/source${ext}`;
    await ensureDirFor(storageKey);
    await fsp.copyFile(resolveKey(story.audioKey), resolveKey(storageKey));

    // If the story was pre-transcribed, reuse it so we skip re-transcription.
    const updated = await prisma.video.update({
      where: { id: video.id },
      data: {
        storageKey,
        transcript: (story.transcript as object | null) ?? undefined,
      },
    });

    await prisma.story.update({ where: { id }, data: { generatedVideoId: video.id } });
    await enqueueProcessVideo(video.id);

    return created(serializeVideo(updated));
  } catch (err) {
    // Roll back the claim so the story returns to the library on failure.
    await prisma.story
      .update({ where: { id }, data: { status: StoryStatus.READY, claimedById: null, claimedAt: null } })
      .catch(() => undefined);
    throw new ApiError(500, `Could not start video generation: ${err instanceof Error ? err.message : err}`);
  }
});

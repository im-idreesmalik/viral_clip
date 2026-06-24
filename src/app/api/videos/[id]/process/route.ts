import { z } from "zod";
import { ClipMode, VideoStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handler, ok, requireSession, ApiError } from "@/lib/api";
import { enqueueProcessVideo } from "@/lib/queue";
import { deleteKey } from "@/lib/storage";
import { serializeVideo } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

const schema = z
  .object({
    clipMode: z.nativeEnum(ClipMode).optional(),
    viralThreshold: z.number().int().min(0).max(100).optional(),
    segmentSeconds: z.number().int().min(15).max(60).optional(),
    targetClipCount: z.number().int().min(1).max(30).optional(),
    burnCaptions: z.boolean().optional(),
  })
  .optional();

// POST /api/videos/[id]/process — (re)start processing, optionally with new
// clip-selection settings. Existing clips are cleared so we don't duplicate.
export const POST = handler(async (req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  const video = await prisma.video.findFirst({ where: { id, userId: session.sub } });
  if (!video) throw new ApiError(404, "Video not found");

  if (video.status === VideoStatus.DOWNLOADING || video.status === VideoStatus.GENERATING) {
    throw new ApiError(409, "Video is already being processed.");
  }

  const overrides = await req.json().then((j) => schema.parse(j)).catch(() => undefined);

  // Clear prior clips + their media so reprocessing starts clean.
  const existing = await prisma.clip.findMany({ where: { videoId: id }, select: { id: true } });
  await Promise.all(existing.map((c) => deleteKey(`clips/${c.id}`)));
  await prisma.clip.deleteMany({ where: { videoId: id } });

  const updated = await prisma.video.update({
    where: { id },
    data: {
      status: VideoStatus.PENDING,
      errorMessage: null,
      clipMode: overrides?.clipMode ?? video.clipMode,
      viralThreshold: overrides?.viralThreshold ?? video.viralThreshold,
      segmentSeconds: overrides?.segmentSeconds ?? video.segmentSeconds,
      targetClipCount: overrides?.targetClipCount ?? video.targetClipCount,
      burnCaptions: overrides?.burnCaptions ?? video.burnCaptions,
    },
  });

  await enqueueProcessVideo(id);
  return ok(serializeVideo(updated));
});

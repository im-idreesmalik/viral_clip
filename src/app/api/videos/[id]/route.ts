import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, parseBody, requireSession, ApiError } from "@/lib/api";
import { serializeVideo } from "@/lib/serialize";
import { deleteKey } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/videos/[id] — a video with its clips.
export const GET = handler(async (_req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  const video = await prisma.video.findFirst({
    where: { id, userId: session.sub },
    include: {
      clips: {
        orderBy: [{ order: "asc" }, { viralScore: "desc" }, { startSec: "asc" }],
        include: { publications: { select: { platform: true, status: true } } },
      },
    },
  });
  if (!video) throw new ApiError(404, "Video not found");

  return ok(serializeVideo(video));
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  hashtags: z.string().max(500).optional(),
});

// PATCH /api/videos/[id] — edit the video title and/or hashtags.
export const PATCH = handler(async (req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);

  const video = await prisma.video.findFirst({ where: { id, userId: session.sub } });
  if (!video) throw new ApiError(404, "Video not found");

  const updated = await prisma.video.update({
    where: { id },
    data: {
      title: body.title ?? undefined,
      hashtags: body.hashtags === undefined ? undefined : body.hashtags,
    },
  });
  return ok(serializeVideo(updated));
});

// DELETE /api/videos/[id] — delete the video, its clips, and all stored media.
export const DELETE = handler(async (_req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  const video = await prisma.video.findFirst({
    where: { id, userId: session.sub },
    include: { clips: { select: { id: true } } },
  });
  if (!video) throw new ApiError(404, "Video not found");

  // Remove stored media (best-effort) before the DB cascade.
  await Promise.all(video.clips.map((c) => deleteKey(`clips/${c.id}`)));
  await deleteKey(`videos/${id}`);

  await prisma.video.delete({ where: { id } });
  return ok({ success: true });
});

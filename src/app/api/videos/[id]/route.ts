import { prisma } from "@/lib/db";
import { handler, ok, requireSession, ApiError } from "@/lib/api";
import { serializeVideo } from "@/lib/serialize";
import { deleteKey } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/videos/[id] — a video with its clips.
export const GET = handler(async (_req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  const video = await prisma.video.findFirst({
    where: { id, userId: session.sub },
    include: { clips: { orderBy: [{ order: "asc" }, { viralScore: "desc" }, { startSec: "asc" }] } },
  });
  if (!video) throw new ApiError(404, "Video not found");

  return ok(serializeVideo(video));
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

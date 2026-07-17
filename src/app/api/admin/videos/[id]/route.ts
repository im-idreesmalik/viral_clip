import { prisma } from "@/lib/db";
import { handler, ok, requireAdmin, ApiError } from "@/lib/api";
import { deleteKey } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/admin/videos/[id] — superuser deletes ANY user's video, its clips
// (FK cascade), and all stored media. Not scoped to an owner.
export const DELETE = handler(async (_req, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;

  const video = await prisma.video.findUnique({
    where: { id },
    include: { clips: { select: { id: true } } },
  });
  if (!video) throw new ApiError(404, "Video not found");

  // Remove stored media (best-effort) before the DB cascade removes clips/pubs.
  await Promise.all(video.clips.map((c) => deleteKey(`clips/${c.id}`)));
  await deleteKey(`videos/${id}`);

  await prisma.video.delete({ where: { id } });
  return ok({ deleted: id });
});

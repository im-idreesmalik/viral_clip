import { prisma } from "@/lib/db";
import { handler, ok, requireAdmin, ApiError } from "@/lib/api";
import { deleteKey } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/admin/music/[id] — remove a track + its file, and clear it from
// any user who had it selected.
export const DELETE = handler(async (_req, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const track = await prisma.backgroundMusic.findUnique({ where: { id } });
  if (!track) throw new ApiError(404, "Track not found");
  if (track.storageKey) await deleteKey(track.storageKey).catch(() => undefined);
  await prisma.user.updateMany({ where: { backgroundMusicId: id }, data: { backgroundMusicId: null } });
  await prisma.backgroundMusic.delete({ where: { id } });
  return ok({ success: true });
});

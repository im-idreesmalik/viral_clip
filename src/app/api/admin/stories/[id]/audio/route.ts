import { StoryStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handler, ok, requireAdmin, ApiError } from "@/lib/api";
import { enqueueStoryAudio } from "@/lib/queue";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/admin/stories/[id]/audio — (re)generate the voice-over.
export const POST = handler(async (_req, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const story = await prisma.story.findUnique({ where: { id } });
  if (!story) throw new ApiError(404, "Story not found");
  if (!story.text?.trim()) throw new ApiError(400, "Story has no text to narrate yet.");

  await prisma.story.update({ where: { id }, data: { status: StoryStatus.QUEUED, errorMessage: null } });
  await enqueueStoryAudio(id);
  return ok({ success: true });
});

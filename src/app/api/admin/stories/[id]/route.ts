import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, parseBody, requireAdmin, ApiError } from "@/lib/api";
import { serializeStory } from "@/lib/serialize";
import { deleteStoryAudio } from "@/services/story/pipeline";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  text: z.string().trim().min(1).optional(),
  topic: z.string().trim().max(500).optional(),
  language: z.enum(["en", "ur"]).optional(),
});

// PATCH /api/admin/stories/[id] — edit story metadata/text. Editing text does
// NOT auto-resynthesize; use the regenerate-audio action for that.
export const PATCH = handler(async (req, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);

  const story = await prisma.story.findUnique({ where: { id } });
  if (!story) throw new ApiError(404, "Story not found");

  const updated = await prisma.story.update({
    where: { id },
    data: {
      title: body.title ?? undefined,
      text: body.text ?? undefined,
      topic: body.topic === undefined ? undefined : body.topic || null,
      language: body.language ?? undefined,
    },
  });
  return ok(serializeStory(updated, { includeAdmin: true }));
});

// DELETE /api/admin/stories/[id] — remove the story and its stored voice-over.
export const DELETE = handler(async (_req, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const story = await prisma.story.findUnique({ where: { id } });
  if (!story) throw new ApiError(404, "Story not found");

  await deleteStoryAudio(id);
  await prisma.story.delete({ where: { id } });
  return ok({ success: true });
});

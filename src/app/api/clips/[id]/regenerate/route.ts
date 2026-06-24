import { z } from "zod";
import { ClipStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handler, parseBody, ok, requireSession, ApiError } from "@/lib/api";
import { enqueueRegenerateClip } from "@/lib/queue";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  // false -> re-render in place; true -> produce a new alternate take.
  variation: z.boolean().optional().default(false),
});

// POST /api/clips/[id]/regenerate — re-render a clip or create a new variation.
export const POST = handler(async (req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  const clip = await prisma.clip.findFirst({ where: { id, video: { userId: session.sub } } });
  if (!clip) throw new ApiError(404, "Clip not found");

  const { variation } = await parseBody(req, schema);

  if (!variation) {
    await prisma.clip.update({ where: { id }, data: { status: ClipStatus.PENDING, errorMessage: null } });
  }
  await enqueueRegenerateClip(id, variation);

  return ok({ success: true, variation });
});

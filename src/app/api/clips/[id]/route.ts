import { z } from "zod";
import { ClipStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handler, parseBody, ok, requireSession, ApiError } from "@/lib/api";
import { serializeClip } from "@/lib/serialize";
import { deleteKey } from "@/lib/storage";
import { enqueueRegenerateClip } from "@/lib/queue";

type Ctx = { params: Promise<{ id: string }> };

async function loadOwnedClip(clipId: string, userId: string) {
  const clip = await prisma.clip.findFirst({
    where: { id: clipId, video: { userId } },
    include: { video: { select: { durationSec: true } } },
  });
  if (!clip) throw new ApiError(404, "Clip not found");
  return clip;
}

// GET /api/clips/[id]
export const GET = handler(async (_req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const clip = await loadOwnedClip(id, session.sub);
  return ok(serializeClip(clip));
});

const patchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  // Review actions map to a subset of statuses.
  status: z.enum([ClipStatus.APPROVED, ClipStatus.REJECTED, ClipStatus.READY]).optional(),
  startSec: z.number().nonnegative().optional(),
  endSec: z.number().positive().optional(),
  captionText: z.string().max(5000).optional(),
});

// PATCH /api/clips/[id] — edit metadata and/or review (approve/reject).
// Changing in/out points re-renders the clip.
export const PATCH = handler(async (req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const clip = await loadOwnedClip(id, session.sub);
  const body = await parseBody(req, patchSchema);

  const timingChanged =
    (body.startSec != null && body.startSec !== clip.startSec) ||
    (body.endSec != null && body.endSec !== clip.endSec);

  let start = body.startSec ?? clip.startSec;
  let end = body.endSec ?? clip.endSec;
  if (timingChanged) {
    if (end <= start) throw new ApiError(400, "endSec must be greater than startSec.");
    const max = clip.video.durationSec ?? end;
    start = Math.max(0, Math.min(start, max));
    end = Math.min(end, max);
    if (end - start < 1) throw new ApiError(400, "Clip must be at least 1 second long.");
  }

  const updated = await prisma.clip.update({
    where: { id },
    data: {
      title: body.title ?? undefined,
      status: body.status ?? (timingChanged ? ClipStatus.PENDING : undefined),
      captionText: body.captionText ?? undefined,
      startSec: timingChanged ? start : undefined,
      endSec: timingChanged ? end : undefined,
    },
  });

  // Re-render when the cut points changed.
  if (timingChanged) await enqueueRegenerateClip(id, false);

  return ok(serializeClip(updated));
});

// DELETE /api/clips/[id]
export const DELETE = handler(async (_req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  await loadOwnedClip(id, session.sub);

  await deleteKey(`clips/${id}`);
  await prisma.clip.delete({ where: { id } });
  return ok({ success: true });
});

import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, parseBody, requireSession } from "@/lib/api";

const SELECT = { id: true, email: true, name: true, handle: true, createdAt: true } as const;

export const GET = handler(async () => {
  const session = await requireSession();
  const user = await prisma.user.findUnique({ where: { id: session.sub }, select: SELECT });
  return ok({ user });
});

const patchSchema = z.object({
  handle: z.string().trim().max(64).optional(),
});

// PATCH /api/auth/me — update the current user's @handle (watermark).
export const PATCH = handler(async (req) => {
  const session = await requireSession();
  const body = await parseBody(req, patchSchema);
  // Normalize: strip leading @ and surrounding spaces; empty clears it.
  const handle = body.handle === undefined ? undefined : body.handle.replace(/^@+/, "").trim();
  const user = await prisma.user.update({
    where: { id: session.sub },
    data: { handle: handle === undefined ? undefined : handle || null },
    select: SELECT,
  });
  return ok({ user });
});

import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, parseBody, requireSession, isAdminEmail } from "@/lib/api";

const SELECT = { id: true, email: true, name: true, handle: true, createdAt: true } as const;

export const GET = handler(async () => {
  const session = await requireSession();
  const user = await prisma.user.findUnique({ where: { id: session.sub }, select: SELECT });
  return ok({ user, isAdmin: isAdminEmail(session.email) });
});

const patchSchema = z.object({
  handle: z.string().trim().max(64).optional(),
});

// PATCH /api/auth/me — update the current user's @handle (watermark).
export const PATCH = handler(async (req) => {
  const session = await requireSession();
  const body = await parseBody(req, patchSchema);
  // Normalize: strip a leading @, allow only safe handle chars (letters, digits,
  // _ . -) so it's harmless when burned into the video via ffmpeg drawtext.
  const handle =
    body.handle === undefined
      ? undefined
      : body.handle.replace(/^@+/, "").replace(/[^\w.\-]/g, "").slice(0, 32).trim();
  const user = await prisma.user.update({
    where: { id: session.sub },
    data: { handle: handle === undefined ? undefined : handle || null },
    select: SELECT,
  });
  return ok({ user });
});

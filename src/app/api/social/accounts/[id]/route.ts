import { prisma } from "@/lib/db";
import { handler, ok, requireSession, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/social/accounts/[id] — disconnect a social account.
export const DELETE = handler(async (_req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  const account = await prisma.socialAccount.findFirst({ where: { id, userId: session.sub } });
  if (!account) throw new ApiError(404, "Account not found");

  await prisma.socialAccount.delete({ where: { id } });
  return ok({ success: true });
});

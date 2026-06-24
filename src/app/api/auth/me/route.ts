import { prisma } from "@/lib/db";
import { handler, ok, requireSession } from "@/lib/api";

export const GET = handler(async () => {
  const session = await requireSession();
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { id: true, email: true, name: true, createdAt: true },
  });
  return ok({ user });
});

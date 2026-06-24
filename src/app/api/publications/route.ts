import { prisma } from "@/lib/db";
import { handler, ok, requireSession } from "@/lib/api";
import { serializePublication } from "@/lib/serialize";

// GET /api/publications — publishing history for the current user.
export const GET = handler(async () => {
  const session = await requireSession();
  const publications = await prisma.publication.findMany({
    where: { userId: session.sub },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { clip: true, socialAccount: true },
  });
  return ok(publications.map(serializePublication));
});

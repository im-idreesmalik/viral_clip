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
    // Omit the (potentially large) transcript JSON — this endpoint is polled and
    // serializePublication only needs the video's title/hashtags/clipMode.
    include: {
      clip: { include: { video: { omit: { transcript: true } } } },
      socialAccount: true,
    },
  });
  return ok(publications.map(serializePublication));
});

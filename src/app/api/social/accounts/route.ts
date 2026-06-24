import { prisma } from "@/lib/db";
import { handler, ok, requireSession } from "@/lib/api";
import { serializeSocialAccount } from "@/lib/serialize";
import { platformCatalog } from "@/services/social";

// GET /api/social/accounts — connected accounts + the platform catalog
// (which platforms have server-side OAuth credentials configured).
export const GET = handler(async () => {
  const session = await requireSession();
  const accounts = await prisma.socialAccount.findMany({
    where: { userId: session.sub },
    orderBy: { createdAt: "desc" },
  });
  return ok({
    accounts: accounts.map(serializeSocialAccount),
    platforms: platformCatalog(),
  });
});

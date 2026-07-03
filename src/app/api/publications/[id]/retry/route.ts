import { PublicationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handler, ok, requireSession, ApiError } from "@/lib/api";
import { enqueuePublish } from "@/lib/queue";
import { getProvider } from "@/services/social";
import { serializePublication } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/publications/[id]/retry — re-run a failed (or cancelled) publication
// IN PLACE (same record — no duplicate row). enqueuePublish clears the stale
// queue job so the same publication id runs again; batch linkage is preserved
// since we reuse the row, so a fixed clip resumes the sequential chain.
export const POST = handler(async (_req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;

  const prev = await prisma.publication.findFirst({
    where: { id, userId: session.sub },
    include: { clip: true, socialAccount: true },
  });
  if (!prev) throw new ApiError(404, "Publication not found");
  if (prev.status === PublicationStatus.PUBLISHED) {
    throw new ApiError(409, "This clip was already published to that platform.");
  }
  if (!prev.clip?.storageKey) throw new ApiError(409, "Clip has not finished rendering yet.");
  if (!prev.socialAccountId || !prev.socialAccount?.isActive) {
    throw new ApiError(400, "The connected account is inactive — reconnect it and try again.");
  }
  const provider = getProvider(prev.platform);
  if (!provider.isConfigured()) {
    throw new ApiError(400, `${provider.label} is not configured on this server.`);
  }

  const publication = await prisma.publication.update({
    where: { id: prev.id },
    data: { status: PublicationStatus.QUEUED, lastError: null, publishAt: null },
    include: { clip: true, socialAccount: true },
  });
  await enqueuePublish(publication.id, 0);
  return ok(serializePublication(publication));
});

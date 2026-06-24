import { PublicationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handler, created, requireSession, ApiError } from "@/lib/api";
import { enqueuePublish } from "@/lib/queue";
import { getProvider } from "@/services/social";
import { serializePublication } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/publications/[id]/retry — re-run a failed (or cancelled) publication.
//
// We create a FRESH publication (new id) for the same clip + account rather than
// re-running the original. The publish queue keys jobs by `publish-<id>`, and the
// original job is already COMPLETED in Redis (the publisher records a terminal
// failure as a completed job), so re-using the same id would be silently ignored.
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

  const publication = await prisma.publication.create({
    data: {
      userId: session.sub,
      clipId: prev.clipId,
      socialAccountId: prev.socialAccountId,
      platform: prev.platform,
      caption: prev.caption,
      status: PublicationStatus.QUEUED,
      // Preserve batch linkage so a fixed clip resumes the sequential chain.
      batchId: prev.batchId,
      batchSeq: prev.batchSeq,
      batchIntervalMin: prev.batchIntervalMin,
    },
    include: { clip: true, socialAccount: true },
  });
  await enqueuePublish(publication.id, 0);
  return created(serializePublication(publication));
});

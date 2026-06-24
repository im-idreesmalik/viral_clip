import { z } from "zod";
import { ClipStatus, Platform, PublicationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handler, parseBody, created, requireSession, ApiError } from "@/lib/api";
import { enqueuePublish } from "@/lib/queue";
import { getProvider } from "@/services/social";
import { serializePublication } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  platform: z.nativeEnum(Platform),
  // Optional explicit account; otherwise the user's active account for the platform.
  accountId: z.string().optional(),
  caption: z.string().max(2200).optional(),
  // ISO timestamp for scheduled publishing; omit/now for immediate.
  publishAt: z.string().datetime().optional(),
});

// POST /api/clips/[id]/publish — publish (or schedule) a clip to a platform.
export const POST = handler(async (req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);

  const clip = await prisma.clip.findFirst({ where: { id, video: { userId: session.sub } } });
  if (!clip) throw new ApiError(404, "Clip not found");
  if (clip.status !== ClipStatus.READY && clip.status !== ClipStatus.APPROVED) {
    throw new ApiError(409, "Clip must be rendered (READY/APPROVED) before publishing.");
  }
  if (!clip.storageKey) throw new ApiError(409, "Clip has not finished rendering yet.");

  const provider = getProvider(body.platform);
  if (!provider.isConfigured()) {
    throw new ApiError(400, `${provider.label} is not configured on this server.`);
  }

  const account = body.accountId
    ? await prisma.socialAccount.findFirst({
        where: { id: body.accountId, userId: session.sub, platform: body.platform, isActive: true },
      })
    : await prisma.socialAccount.findFirst({
        where: { userId: session.sub, platform: body.platform, isActive: true },
      });
  if (!account) {
    throw new ApiError(400, `No connected ${provider.label} account. Connect one first.`);
  }

  const publishAt = body.publishAt ? new Date(body.publishAt) : null;
  const isScheduled = publishAt != null && publishAt.getTime() > Date.now();

  const publication = await prisma.publication.create({
    data: {
      userId: session.sub,
      clipId: clip.id,
      socialAccountId: account.id,
      platform: body.platform,
      caption: body.caption ?? clip.title,
      publishAt,
      status: isScheduled ? PublicationStatus.SCHEDULED : PublicationStatus.QUEUED,
    },
    include: { clip: true, socialAccount: true },
  });

  // Enqueue immediately, or with a delay until publishAt.
  const delayMs = isScheduled ? publishAt!.getTime() - Date.now() : 0;
  await enqueuePublish(publication.id, delayMs);

  return created(serializePublication(publication));
});

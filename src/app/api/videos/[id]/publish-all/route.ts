import crypto from "node:crypto";
import { z } from "zod";
import { ClipStatus, Platform, PublicationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handler, parseBody, created, requireSession, ApiError } from "@/lib/api";
import { enqueuePublish } from "@/lib/queue";
import { composeCaption } from "@/lib/caption";
import { getProvider } from "@/services/social";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  platforms: z.array(z.nativeEnum(Platform)).min(1),
  // Minutes between consecutive clips. 0 = post them all at once.
  intervalMinutes: z.number().int().min(0).max(10080),
});

// POST /api/videos/[id]/publish-all — schedule every rendered clip of a video to
// the selected platforms, spaced `intervalMinutes` apart (drip publishing).
export const POST = handler(async (req, ctx: Ctx) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);

  const video = await prisma.video.findFirst({
    where: { id, userId: session.sub },
    include: {
      clips: {
        where: { status: { in: [ClipStatus.READY, ClipStatus.APPROVED] }, storageKey: { not: null } },
        orderBy: [{ order: "asc" }, { startSec: "asc" }],
      },
    },
  });
  if (!video) throw new ApiError(404, "Video not found");
  if (video.clips.length === 0) throw new ApiError(409, "No rendered clips available to publish.");

  // One active account per requested platform.
  const accounts = await prisma.socialAccount.findMany({
    where: { userId: session.sub, platform: { in: body.platforms }, isActive: true },
  });
  const accountByPlatform = new Map<Platform, (typeof accounts)[number]>();
  for (const a of accounts) if (!accountByPlatform.has(a.platform)) accountByPlatform.set(a.platform, a);

  const usable = body.platforms.filter(
    (p) => getProvider(p).isConfigured() && accountByPlatform.has(p),
  );
  if (usable.length === 0) {
    throw new ApiError(400, "None of the selected platforms have a connected account.");
  }

  let scheduled = 0;
  // One sequential batch per platform: clips post one-by-one, and the next is
  // only enqueued after the previous succeeds (the chaining lives in the
  // publisher). So we enqueue just the FIRST clip now; the rest start SCHEDULED.
  for (const platform of usable) {
    const account = accountByPlatform.get(platform)!;
    const batchId = crypto.randomUUID();
    for (let i = 0; i < video.clips.length; i++) {
      const clip = video.clips[i];
      const caption = composeCaption({
        videoTitle: video.title,
        hashtags: video.hashtags,
        clipMode: video.clipMode,
        order: clip.order,
        clipTitle: clip.title,
      });
      const first = i === 0;
      const pub = await prisma.publication.create({
        data: {
          userId: session.sub,
          clipId: clip.id,
          socialAccountId: account.id,
          platform,
          caption,
          status: first ? PublicationStatus.QUEUED : PublicationStatus.SCHEDULED,
          batchId,
          batchSeq: i,
          batchIntervalMin: body.intervalMinutes,
        },
      });
      if (first) await enqueuePublish(pub.id, 0);
      scheduled++;
    }
  }

  return created({ scheduled, clips: video.clips.length, platforms: usable });
});

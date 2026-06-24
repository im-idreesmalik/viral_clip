/**
 * Map Prisma models to JSON-safe DTOs for the client.
 *
 * Handles BigInt (not JSON-serializable), Date -> ISO strings, and resolves
 * storage keys into public media URLs. Sensitive fields (token ciphertext)
 * are never included.
 */
import type { Video, Clip, ClipMode, SocialAccount, Publication, AutoPublishConfig } from "@prisma/client";
import { publicUrl } from "./storage";
import { composeCaption } from "./caption";

export function serializeVideo(v: Video & { clips?: Clip[] }) {
  return {
    id: v.id,
    title: v.title,
    source: v.source,
    sourceUrl: v.sourceUrl,
    status: v.status,
    clipMode: v.clipMode,
    viralThreshold: v.viralThreshold,
    segmentSeconds: v.segmentSeconds,
    targetClipCount: v.targetClipCount,
    burnCaptions: v.burnCaptions,
    durationSec: v.durationSec,
    width: v.width,
    height: v.height,
    sizeBytes: v.sizeBytes != null ? Number(v.sizeBytes) : null,
    thumbnailUrl: publicUrl(v.thumbnailKey),
    sourceMediaUrl: publicUrl(v.storageKey),
    hashtags: v.hashtags,
    errorMessage: v.errorMessage,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    clips: v.clips
      ? v.clips.map((c) =>
          serializeClip(c, { videoTitle: v.title, hashtags: v.hashtags, clipMode: v.clipMode }),
        )
      : undefined,
    clipCount: v.clips ? v.clips.length : undefined,
  };
}

export function serializeClip(
  c: Clip & { publications?: Pick<Publication, "platform" | "status">[] },
  ctx?: { videoTitle: string; hashtags: string | null; clipMode: ClipMode },
) {
  const publishedPlatforms = Array.from(
    new Set((c.publications ?? []).filter((p) => p.status === "PUBLISHED").map((p) => p.platform)),
  );
  const composedCaption = ctx
    ? composeCaption({
        videoTitle: ctx.videoTitle,
        hashtags: ctx.hashtags,
        clipMode: ctx.clipMode,
        order: c.order,
        clipTitle: c.title,
      })
    : c.title;
  return {
    id: c.id,
    videoId: c.videoId,
    title: c.title,
    startSec: c.startSec,
    endSec: c.endSec,
    durationSec: c.durationSec ?? c.endSec - c.startSec,
    viralScore: c.viralScore,
    reason: c.reason,
    order: c.order,
    status: c.status,
    captionText: c.captionText,
    videoUrl: publicUrl(c.storageKey),
    thumbnailUrl: publicUrl(c.thumbnailKey),
    captionsUrl: publicUrl(c.captionsKey),
    errorMessage: c.errorMessage,
    publishedPlatforms,
    composedCaption,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function serializeSocialAccount(a: SocialAccount) {
  return {
    id: a.id,
    platform: a.platform,
    externalId: a.externalId,
    displayName: a.displayName,
    username: a.username,
    avatarUrl: a.avatarUrl,
    scope: a.scope,
    isActive: a.isActive,
    tokenExpiresAt: a.tokenExpiresAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

export function serializePublication(
  p: Publication & { clip?: Clip; socialAccount?: SocialAccount },
) {
  return {
    id: p.id,
    clipId: p.clipId,
    platform: p.platform,
    status: p.status,
    caption: p.caption,
    publishAt: p.publishAt?.toISOString() ?? null,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    externalUrl: p.externalUrl,
    externalPostId: p.externalPostId,
    attempts: p.attempts,
    lastError: p.lastError,
    autoScheduled: p.autoScheduled,
    createdAt: p.createdAt.toISOString(),
    clip: p.clip ? serializeClip(p.clip) : undefined,
    account: p.socialAccount ? serializeSocialAccount(p.socialAccount) : undefined,
  };
}

export function serializeAutoConfig(c: AutoPublishConfig | null) {
  if (!c) {
    return {
      enabled: false,
      intervalMinutes: 120,
      platforms: [] as string[],
      windowStartHour: null,
      windowEndHour: null,
      nextRunAt: null,
    };
  }
  return {
    enabled: c.enabled,
    intervalMinutes: c.intervalMinutes,
    platforms: c.platforms,
    windowStartHour: c.windowStartHour,
    windowEndHour: c.windowEndHour,
    nextRunAt: c.nextRunAt?.toISOString() ?? null,
    lastScheduledAt: c.lastScheduledAt?.toISOString() ?? null,
  };
}

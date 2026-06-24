/**
 * Auto-publishing scheduler.
 *
 * Runs on an interval inside the worker process. For each user with auto-publish
 * enabled and due, it picks the next approved-but-unpublished clip per selected
 * platform, creates a Publication, and enqueues it. Respects an optional daily
 * posting window and the per-user interval.
 */
import { ClipStatus, PublicationStatus, type Platform } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { enqueuePublish } from "@/lib/queue";
import { getProvider } from "@/services/social";

const log = createLogger("scheduler");

const ACTIVE_PUB_STATUSES: PublicationStatus[] = [
  PublicationStatus.SCHEDULED,
  PublicationStatus.QUEUED,
  PublicationStatus.PUBLISHING,
  PublicationStatus.PUBLISHED,
];

export async function runScheduler(now = new Date()): Promise<void> {
  const dueConfigs = await prisma.autoPublishConfig.findMany({
    where: {
      enabled: true,
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    },
  });

  for (const config of dueConfigs) {
    try {
      if (!withinWindow(config.windowStartHour, config.windowEndHour, now)) {
        // Outside the allowed window; check again next tick without advancing.
        continue;
      }
      await processConfig(config.userId, config.platforms, config.id);

      const next = new Date(now.getTime() + config.intervalMinutes * 60_000);
      await prisma.autoPublishConfig.update({
        where: { id: config.id },
        data: { lastScheduledAt: now, nextRunAt: next },
      });
    } catch (err) {
      log.error("Scheduler error for config", {
        configId: config.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function processConfig(userId: string, platforms: Platform[], configId: string) {
  for (const platform of platforms) {
    const provider = getProvider(platform);
    if (!provider.isConfigured()) continue;

    const account = await prisma.socialAccount.findFirst({
      where: { userId, platform, isActive: true },
    });
    if (!account) {
      log.warn("No connected account for platform; skipping", { userId, platform });
      continue;
    }

    const clip = await nextEligibleClip(userId, platform);
    if (!clip) continue;

    const publication = await prisma.publication.create({
      data: {
        userId,
        clipId: clip.id,
        socialAccountId: account.id,
        platform,
        caption: clip.title,
        status: PublicationStatus.QUEUED,
        autoScheduled: true,
      },
    });
    await enqueuePublish(publication.id);
    log.info("Auto-scheduled publication", { configId, platform, clipId: clip.id });
  }
}

/** Oldest approved clip with no active publication on this platform. */
async function nextEligibleClip(userId: string, platform: Platform) {
  return prisma.clip.findFirst({
    where: {
      status: ClipStatus.APPROVED,
      video: { userId },
      publications: { none: { platform, status: { in: ACTIVE_PUB_STATUSES } } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** True if `now`'s local hour is within [start, end). Null bounds = anytime. */
function withinWindow(start: number | null, end: number | null, now: Date): boolean {
  if (start == null || end == null) return true;
  const hour = now.getHours();
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  // Wraps past midnight (e.g. 20 -> 6).
  return hour >= start || hour < end;
}

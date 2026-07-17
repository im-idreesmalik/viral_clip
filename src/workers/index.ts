/**
 * Worker entrypoint. Boots the video + publish workers and the auto-publish
 * scheduler in a single long-running process. Run with `npm run worker`.
 *
 * NOTE: ./loadEnv MUST be the first import so .env is populated before any
 * module that reads process.env (env.ts) is evaluated.
 */
import "./loadEnv";

import { VideoStatus, ClipStatus, PublicationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { enqueuePublish } from "@/lib/queue";
import { ensureStorageRoot } from "@/lib/storage";
import { createLogger } from "@/lib/logger";
import { startVideoWorker } from "./videoProcessor";
import { startPublishWorker } from "./publishWorker";
import { startStoryWorker } from "./storyProcessor";
import { runScheduler } from "./scheduler";

const log = createLogger("worker");

const SCHEDULER_INTERVAL_MS = 60_000;

// Video statuses that mean "work in progress".
const PROCESSING_STATUSES: VideoStatus[] = [
  VideoStatus.DOWNLOADING,
  VideoStatus.TRANSCRIBING,
  VideoStatus.ANALYZING,
  VideoStatus.GENERATING,
];

/**
 * Fail any video/clip that has been "in progress" longer than the stale
 * threshold — i.e. no worker has touched it (e.g. after a crash or a killed
 * job). This stops the dashboard from spinning forever and frees the user to
 * retry, without touching jobs that are still actively progressing.
 */
async function reapStuckJobs() {
  const cutoff = new Date(Date.now() - env.staleJobMs);
  try {
    const videos = await prisma.video.updateMany({
      where: { status: { in: PROCESSING_STATUSES }, updatedAt: { lt: cutoff } },
      data: {
        status: VideoStatus.FAILED,
        errorMessage: "Processing stalled and was terminated to protect the system. Please retry.",
      },
    });
    const clips = await prisma.clip.updateMany({
      where: { status: ClipStatus.RENDERING, updatedAt: { lt: cutoff } },
      data: { status: ClipStatus.FAILED, errorMessage: "Render stalled and was terminated." },
    });
    if (videos.count || clips.count) {
      log.warn("Reaped stuck jobs", { videos: videos.count, clips: clips.count });
    }
  } catch (err) {
    log.error("Reaper failed", { message: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Auto-retry a failed publication in a sequential "Publish All" batch if it's
 * been stuck past the threshold and nobody clicked Retry — one transient
 * failure shouldn't halt the rest of the queue forever. Capped by attempts so
 * a permanently-broken publication eventually stops retrying.
 */
async function autoRetryStuckPublications() {
  const cutoff = new Date(Date.now() - env.publishAutoRetryAfterMs);
  try {
    const stuck = await prisma.publication.findMany({
      where: {
        status: PublicationStatus.FAILED,
        batchId: { not: null },
        updatedAt: { lt: cutoff },
        attempts: { lt: env.publishAutoRetryMax },
      },
      take: 25,
    });
    for (const p of stuck) {
      await prisma.publication.update({
        where: { id: p.id },
        data: { status: PublicationStatus.QUEUED, lastError: null, publishAt: null },
      });
      await enqueuePublish(p.id, 0);
      log.warn("Auto-retrying stuck batch publication", { id: p.id, attempts: p.attempts });
    }
  } catch (err) {
    log.error("Auto-retry failed", { message: err instanceof Error ? err.message : String(err) });
  }
}

async function main() {
  // Last line of defense: a stray unhandled rejection or uncaught exception
  // would otherwise terminate the whole worker (Node ≥15) and kill every
  // in-flight job. Log and keep running — individual jobs already fail safely.
  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled promise rejection (kept worker alive)", {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
  process.on("uncaughtException", (err) => {
    log.error("Uncaught exception (kept worker alive)", {
      message: err.message,
      stack: err.stack,
    });
  });

  ensureStorageRoot();

  const videoWorker = startVideoWorker();
  const publishWorker = startPublishWorker();
  const storyWorker = startStoryWorker();

  log.info("Workers started", {
    queues: ["video-processing", "publishing", "stories"],
  });

  // Auto-publish scheduler loop + stuck-job reaper, on the same tick.
  const tick = async () => {
    try {
      await runScheduler();
    } catch (err) {
      log.error("Scheduler tick failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
    await reapStuckJobs();
    await autoRetryStuckPublications();
  };
  await tick();
  const schedulerTimer = setInterval(tick, SCHEDULER_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down...`);
    clearInterval(schedulerTimer);
    await Promise.allSettled([videoWorker.close(), publishWorker.close(), storyWorker.close()]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("Worker failed to start", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

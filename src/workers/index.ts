/**
 * Worker entrypoint. Boots the video + publish workers and the auto-publish
 * scheduler in a single long-running process. Run with `npm run worker`.
 *
 * NOTE: ./loadEnv MUST be the first import so .env is populated before any
 * module that reads process.env (env.ts) is evaluated.
 */
import "./loadEnv";

import { ensureStorageRoot } from "@/lib/storage";
import { createLogger } from "@/lib/logger";
import { startVideoWorker } from "./videoProcessor";
import { startPublishWorker } from "./publishWorker";
import { runScheduler } from "./scheduler";

const log = createLogger("worker");

const SCHEDULER_INTERVAL_MS = 60_000;

async function main() {
  ensureStorageRoot();

  const videoWorker = startVideoWorker();
  const publishWorker = startPublishWorker();

  log.info("Workers started", {
    queues: ["video-processing", "publishing"],
  });

  // Auto-publish scheduler loop.
  const tick = async () => {
    try {
      await runScheduler();
    } catch (err) {
      log.error("Scheduler tick failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };
  await tick();
  const schedulerTimer = setInterval(tick, SCHEDULER_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down...`);
    clearInterval(schedulerTimer);
    await Promise.allSettled([videoWorker.close(), publishWorker.close()]);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("Worker failed to start", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

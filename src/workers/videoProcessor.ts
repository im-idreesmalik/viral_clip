/**
 * BullMQ worker for the video-processing queue. Handles full-video processing
 * and single-clip regeneration jobs.
 */
import { Worker, type Job, type ConnectionOptions } from "bullmq";
import { createRedisConnection } from "@/lib/redis";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { QUEUE_NAMES, type VideoJob } from "@/lib/queue";
import { processVideo, regenerateClip } from "@/services/video/pipeline";

const log = createLogger("worker:video");

export function startVideoWorker(): Worker<VideoJob> {
  const worker = new Worker<VideoJob>(
    QUEUE_NAMES.videoProcessing,
    async (job: Job<VideoJob>) => {
      const payload = job.data;
      if (payload.kind === "process-video") {
        await processVideo(payload.data.videoId);
      } else if (payload.kind === "regenerate-clip") {
        await regenerateClip(payload.data.clipId, payload.data.variation ?? false);
      }
    },
    {
      connection: createRedisConnection() as unknown as ConnectionOptions,
      concurrency: env.videoWorkerConcurrency,
      // Video jobs are long-running; give them room before stalling.
      lockDuration: 10 * 60 * 1000,
    },
  );

  worker.on("completed", (job) => log.info("Job completed", { id: job.id, name: job.name }));
  worker.on("failed", (job, err) =>
    log.error("Job failed", { id: job?.id, name: job?.name, message: err.message }),
  );
  return worker;
}

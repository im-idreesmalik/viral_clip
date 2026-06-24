/**
 * BullMQ worker for the publishing queue. Each job publishes one Publication
 * to its target platform. Retryable failures rethrow so BullMQ retries with
 * exponential backoff (configured on the queue's defaultJobOptions).
 */
import { Worker, type Job, type ConnectionOptions } from "bullmq";
import { createRedisConnection } from "@/lib/redis";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { QUEUE_NAMES, type PublishJob } from "@/lib/queue";
import { executePublication } from "@/services/publishing/publisher";

const log = createLogger("worker:publish");

export function startPublishWorker(): Worker<PublishJob> {
  const worker = new Worker<PublishJob>(
    QUEUE_NAMES.publishing,
    async (job: Job<PublishJob>) => {
      await executePublication(job.data.publicationId);
    },
    {
      connection: createRedisConnection() as unknown as ConnectionOptions,
      concurrency: env.publishWorkerConcurrency,
      lockDuration: 5 * 60 * 1000,
    },
  );

  worker.on("completed", (job) => log.info("Publish completed", { id: job.id }));
  worker.on("failed", (job, err) =>
    log.error("Publish job failed", { id: job?.id, message: err.message }),
  );
  return worker;
}

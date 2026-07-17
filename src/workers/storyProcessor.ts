/**
 * BullMQ worker for the AI Stories queue: writing story text and synthesizing
 * voice-overs. Separate from the video queue so a long TTS run doesn't block
 * video processing (and vice-versa).
 */
import { Worker, type Job, type ConnectionOptions } from "bullmq";
import { createRedisConnection } from "@/lib/redis";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { QUEUE_NAMES, type StoryJob } from "@/lib/queue";
import { processStoryGeneration, generateStoryAudio } from "@/services/story/pipeline";

const log = createLogger("worker:story");

export function startStoryWorker(): Worker<StoryJob> {
  const worker = new Worker<StoryJob>(
    QUEUE_NAMES.stories,
    async (job: Job<StoryJob>) => {
      const payload = job.data;
      if (payload.kind === "generate-story") {
        await processStoryGeneration(payload.data.storyId, payload.data.durationMin);
      } else if (payload.kind === "story-audio") {
        await generateStoryAudio(payload.data.storyId);
      }
    },
    {
      connection: createRedisConnection() as unknown as ConnectionOptions,
      concurrency: env.storyWorkerConcurrency,
      // Generation + a full voice-over can take minutes; give it room.
      lockDuration: 20 * 60 * 1000,
    },
  );

  worker.on("completed", (job) => log.info("Story job completed", { id: job.id, name: job.name }));
  worker.on("failed", (job, err) =>
    log.error("Story job failed", { id: job?.id, name: job?.name, message: err.message }),
  );
  return worker;
}

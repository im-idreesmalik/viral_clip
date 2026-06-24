/**
 * BullMQ queue definitions + typed enqueue helpers.
 *
 * Queues are created lazily so importing this module from the Next.js server
 * (to enqueue work) doesn't spin up worker-only connections unnecessarily.
 * The actual processors live in src/workers and run in a separate process
 * (`npm run worker`).
 */
import { Queue, type JobsOptions, type ConnectionOptions } from "bullmq";
import { createRedisConnection } from "./redis";

// BullMQ bundles its own copy of ioredis; our top-level ioredis instance is
// runtime-compatible but nominally a different type, so cast at the boundary.
function bullConnection(): ConnectionOptions {
  return createRedisConnection() as unknown as ConnectionOptions;
}

export const QUEUE_NAMES = {
  videoProcessing: "video-processing",
  publishing: "publishing",
} as const;

// ---- Job payload types -----------------------------------------------------

export interface ProcessVideoJob {
  videoId: string;
}

export interface RegenerateClipJob {
  clipId: string;
  // Optional overrides when the user requests a fresh variation.
  variation?: boolean;
}

export type VideoJob =
  | { kind: "process-video"; data: ProcessVideoJob }
  | { kind: "regenerate-clip"; data: RegenerateClipJob };

export interface PublishJob {
  publicationId: string;
}

// ---- Queue singletons ------------------------------------------------------

const globalForQueues = globalThis as unknown as {
  videoQueue?: Queue<VideoJob>;
  publishQueue?: Queue<PublishJob>;
};

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 10_000 },
  removeOnComplete: { age: 60 * 60 * 24, count: 500 },
  removeOnFail: { age: 60 * 60 * 24 * 7 },
};

export function getVideoQueue(): Queue<VideoJob> {
  const existing = globalForQueues.videoQueue;
  if (existing) return existing;
  const queue = new Queue<VideoJob>(QUEUE_NAMES.videoProcessing, {
    connection: bullConnection(),
    defaultJobOptions,
  }) as unknown as Queue<VideoJob>;
  globalForQueues.videoQueue = queue;
  return queue;
}

export function getPublishQueue(): Queue<PublishJob> {
  const existing = globalForQueues.publishQueue;
  if (existing) return existing;
  const queue = new Queue<PublishJob>(QUEUE_NAMES.publishing, {
    connection: bullConnection(),
    defaultJobOptions,
  }) as unknown as Queue<PublishJob>;
  globalForQueues.publishQueue = queue;
  return queue;
}

// ---- Enqueue helpers -------------------------------------------------------

export async function enqueueProcessVideo(videoId: string) {
  // No fixed jobId: a deterministic id would let a lingering completed job in
  // Redis suppress re-processing (reprocess/retry would be silently ignored).
  return getVideoQueue().add("process-video", { kind: "process-video", data: { videoId } });
}

export async function enqueueRegenerateClip(clipId: string, variation = false) {
  return getVideoQueue().add("regenerate-clip", {
    kind: "regenerate-clip",
    data: { clipId, variation },
  });
}

export async function enqueuePublish(publicationId: string, delayMs?: number) {
  return getPublishQueue().add(
    "publish",
    { publicationId },
    {
      jobId: `publish-${publicationId}`,
      delay: delayMs && delayMs > 0 ? delayMs : undefined,
    },
  );
}

/**
 * Shared ioredis connection factory for BullMQ.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on its connections, and each
 * component (Queue / Worker / QueueEvents) needs its own connection. We expose
 * a factory rather than an eager singleton so that merely importing this module
 * (e.g. during `next build`) never opens a socket — connections are created
 * only when a queue or worker is actually instantiated.
 */
import IORedis, { type RedisOptions } from "ioredis";
import { env } from "./env";
import { createLogger } from "./logger";

const log = createLogger("redis");

const options: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

export function createRedisConnection(): IORedis {
  const conn = new IORedis(env.redisUrl, options);
  // Without an "error" listener, ioredis emits an unhandled 'error' event on a
  // disconnect, which can crash the process. Log and let it auto-reconnect.
  conn.on("error", (err) => {
    log.warn("Redis connection error", { message: err instanceof Error ? err.message : String(err) });
  });
  return conn;
}

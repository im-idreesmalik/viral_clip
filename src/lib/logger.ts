/**
 * Tiny structured logger. Keeps log lines greppable and JSON-friendly in prod
 * while staying readable in dev. Swap the sink for pino/winston if needed.
 */
type Level = "debug" | "info" | "warn" | "error";

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: Level = (process.env.LOG_LEVEL as Level) || "info";

function emit(level: Level, scope: string, message: string, data?: unknown) {
  if (order[level] < order[minLevel]) return;
  const time = new Date().toISOString();
  if (process.env.NODE_ENV === "production") {
    const line: Record<string, unknown> = { time, level, scope, message };
    if (data !== undefined) line.data = data;
    const fn = level === "error" ? console.error : console.log;
    fn(JSON.stringify(line));
  } else {
    const tag = `${time} ${level.toUpperCase().padEnd(5)} [${scope}]`;
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    if (data !== undefined) fn(tag, message, data);
    else fn(tag, message);
  }
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, data?: unknown) => emit("debug", scope, msg, data),
    info: (msg: string, data?: unknown) => emit("info", scope, msg, data),
    warn: (msg: string, data?: unknown) => emit("warn", scope, msg, data),
    error: (msg: string, data?: unknown) => emit("error", scope, msg, data),
    child: (sub: string) => createLogger(`${scope}:${sub}`),
  };
}

export const logger = createLogger("app");

/**
 * Loads .env into process.env for the standalone worker process.
 *
 * Imported FIRST (before any module that reads process.env) so config is
 * populated before env.ts is evaluated. Next.js loads .env for the web app
 * automatically; the worker does not, hence this shim. Uses Node's built-in
 * loader (Node >= 20.12), so no dotenv dependency is required.
 */
const proc = process as NodeJS.Process & { loadEnvFile?: (path?: string) => void };
try {
  proc.loadEnvFile?.(".env");
} catch {
  // .env is optional (env may be provided by the orchestrator); ignore.
}

export {};

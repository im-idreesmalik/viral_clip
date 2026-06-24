/**
 * Shared helpers for route handlers: consistent JSON responses, auth guard,
 * and Zod body parsing. Keeps each route file focused on its own logic.
 */
import { NextResponse } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { getSession, type SessionPayload } from "./auth";
import { createLogger } from "./logger";
import { env } from "./env";

const log = createLogger("api");

/**
 * The public origin to use for OAuth redirect URIs.
 *
 * OAuth redirect URIs must EXACTLY match what's registered with each provider.
 * When a real public URL is configured in APP_URL (a deployment or tunnel
 * domain), we ALWAYS use it — Host headers behind a proxy/tunnel are unreliable:
 * a Cloudflare tunnel forwarding to `http://localhost:3000` makes the origin see
 * `Host: localhost:3000`, which would produce a localhost redirect_uri that no
 * provider has whitelisted. Only when APP_URL is itself localhost (pure local
 * dev) do we derive the origin from the incoming request headers.
 */
export function publicOrigin(req: Request): string {
  const configured = env.appUrl?.replace(/\/$/, "");
  if (configured && !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(configured)) {
    return configured;
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return env.appUrl;
  const proto = (req.headers.get("x-forwarded-proto") ?? "http").split(",")[0].trim();
  return `${proto}://${host}`;
}

/** OAuth callback URL for a platform, derived from the incoming request origin. */
export function oauthRedirectForRequest(req: Request, platformSlug: string): string {
  return `${publicOrigin(req)}/api/social/callback/${platformSlug}`;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function created<T>(data: T) {
  return NextResponse.json({ data }, { status: 201 });
}

export function fail(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Require a logged-in session; throws ApiError(401) otherwise. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new ApiError(401, "Not authenticated");
  return session;
}

/** Parse + validate a JSON body against a Zod schema. */
export async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ApiError(400, formatZodError(result.error));
  }
  return result.data;
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
    .join("; ");
}

/**
 * Wrap a route handler so thrown ApiErrors (and unexpected errors) become
 * clean JSON responses with the right status.
 */
export function handler<Args extends unknown[]>(
  fn: (req: Request, ...args: Args) => Promise<Response>,
) {
  return async (req: Request, ...args: Args): Promise<Response> => {
    try {
      return await fn(req, ...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return fail(err.status, err.message);
      }
      log.error("Unhandled route error", {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      return fail(500, "Internal server error");
    }
  };
}

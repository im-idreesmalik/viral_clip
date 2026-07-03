/**
 * Short-lived signed URLs for the (otherwise public) media endpoint.
 *
 * The dashboard fetches media with the session cookie, but IG/FB "pull upload"
 * fetch it server-side with no cookie — so we hand those a URL signed with an
 * HMAC of the key + expiry. The media route accepts either a valid session OR a
 * valid signature, closing the "any file downloadable by id" hole.
 */
import crypto from "node:crypto";

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6h — long enough for a publish job

function secret(): string {
  return process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
}

function computeSig(key: string, exp: number): string {
  return crypto.createHmac("sha256", secret()).update(`${key}:${exp}`).digest("base64url");
}

/** Query string (`exp=…&sig=…`) authorizing unauthenticated access to `key`. */
export function signMediaKey(key: string, ttlMs = DEFAULT_TTL_MS): string {
  const exp = Date.now() + ttlMs;
  return `exp=${exp}&sig=${computeSig(key, exp)}`;
}

/** Constant-time validation of a media signature. */
export function verifyMediaSig(key: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now()) return false;
  const expected = computeSig(key, expNum);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

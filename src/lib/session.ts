/**
 * Edge-safe session token primitives.
 *
 * This module is imported by the Edge middleware, so it MUST stay free of
 * Node-only dependencies (no Prisma, bcrypt, node:path, next/headers). It only
 * uses `jose` and reads AUTH_SECRET straight from process.env. The Node-side
 * helpers (cookies, password hashing, DB lookups) live in auth.ts.
 */
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "vc_session";
const ALG = "HS256";

export interface SessionPayload {
  sub: string; // user id
  email: string;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(process.env.AUTH_SECRET || "dev-insecure-secret-change-me");
}

function sessionMaxAgeSeconds(): number {
  const days = Number(process.env.AUTH_SESSION_DAYS || 30);
  return days * 24 * 60 * 60;
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${sessionMaxAgeSeconds()}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: [ALG] });
    if (!payload.sub) return null;
    return { sub: payload.sub, email: String(payload.email ?? "") };
  } catch {
    return null;
  }
}

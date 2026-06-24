/**
 * Local filesystem media storage.
 *
 * Files are addressed by a "storage key" — a relative path within STORAGE_DIR
 * (e.g. "videos/<id>/source.mp4"). This indirection means the storage backend
 * can later be swapped for S3/GCS by reimplementing this module without
 * touching callers. Keys are validated to prevent path traversal.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { env } from "./env";

const ROOT = env.storageDir;

export function ensureStorageRoot(): void {
  fs.mkdirSync(ROOT, { recursive: true });
}

/** Resolve a storage key to an absolute path, rejecting traversal. */
export function resolveKey(key: string): string {
  const normalized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = path.resolve(ROOT, normalized);
  if (!abs.startsWith(ROOT)) {
    throw new Error(`Invalid storage key (path traversal): ${key}`);
  }
  return abs;
}

export async function ensureDirFor(key: string): Promise<void> {
  const abs = resolveKey(key);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
}

export async function writeFile(key: string, data: Buffer | Uint8Array): Promise<void> {
  await ensureDirFor(key);
  await fsp.writeFile(resolveKey(key), data);
}

export async function deleteKey(key: string): Promise<void> {
  try {
    await fsp.rm(resolveKey(key), { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

export async function stat(key: string) {
  return fsp.stat(resolveKey(key));
}

/**
 * Public URL for a stored file, for use in the dashboard (preview/playback).
 * Always a RELATIVE in-app media route so it loads correctly from whatever
 * origin the dashboard is viewed on (localhost or the public domain) without
 * depending on MEDIA_PUBLIC_BASE. The ABSOLUTE public URL needed for IG/FB
 * pull-upload is built separately in the publisher — and must include this same
 * `/api/media/` path.
 */
export function publicUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  return `/api/media/${key}`;
}

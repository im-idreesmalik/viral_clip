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
const GENERIC_DIR = path.join(ROOT, "generic");
const GENERIC_VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"]);

export function ensureStorageRoot(): void {
  fs.mkdirSync(ROOT, { recursive: true });
}

/**
 * Absolute paths of all generic/stock videos the user dropped in
 * storage/generic. Used by GENERIC footage mode to build B-roll reels. Creates
 * the folder on first call so it's ready for the user to paste files into.
 */
export function listGenericFootage(): string[] {
  try {
    fs.mkdirSync(GENERIC_DIR, { recursive: true });
    return fs
      .readdirSync(GENERIC_DIR)
      .filter((f) => GENERIC_VIDEO_EXTS.has(path.extname(f).toLowerCase()))
      .sort(compareGenericNames)
      .map((f) => path.join(GENERIC_DIR, f));
  } catch {
    return [];
  }
}

/** Sort numeric names naturally (1, 2, …, 10) with any others after them. */
function compareGenericNames(a: string, b: string): number {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  const aNum = /^\d+\./.test(a);
  const bNum = /^\d+\./.test(b);
  if (aNum && bNum) return na - nb;
  if (aNum) return -1;
  if (bNum) return 1;
  return a.localeCompare(b);
}

/**
 * The next sequential generic filename ("1.mp4", "2.mp4", …). Picks one past
 * the highest existing number and skips any name already on disk, so uploads
 * stay ordered without the user naming them.
 */
export function nextGenericName(): string {
  let n = 1;
  for (const p of listGenericFootage()) {
    const m = parseInt(path.basename(p), 10);
    if (!isNaN(m) && m >= n) n = m + 1;
  }
  while (fs.existsSync(path.join(GENERIC_DIR, `${n}.mp4`))) n++;
  return `${n}.mp4`;
}

/** Resolve a storage key to an absolute path, rejecting traversal. */
export function resolveKey(key: string): string {
  // Reject any key that tries to climb out — checked before normalization so a
  // "..\\" or "../" segment can't be silently stripped and slip through.
  if (/(^|[\\/])\.\.([\\/]|$)/.test(key)) {
    throw new Error(`Invalid storage key (path traversal): ${key}`);
  }
  const normalized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = path.resolve(ROOT, normalized);
  // Require a path-separator boundary so a sibling dir sharing the prefix
  // (e.g. "storage-evil") can't pass the containment check.
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
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

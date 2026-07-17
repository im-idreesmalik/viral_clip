/**
 * A published clip has two parts:
 *   - TITLE:       the video title, plus "— Part N" for sequential (FULL) clips.
 *   - DESCRIPTION: the clip's own text ("what you write") plus hashtags.
 *
 * Platforms with separate fields (YouTube) use both; single-caption platforms
 * (TikTok/Instagram/Facebook) combine them.
 */
import type { ClipMode } from "@prisma/client";

export function composeTitle(opts: {
  videoTitle: string;
  clipMode: ClipMode | "VIRAL" | "FULL";
  order?: number | null;
}): string {
  const title = opts.videoTitle.trim();
  if (opts.clipMode === "FULL" && opts.order != null) return `${title} | Part ${opts.order}`;
  return title;
}

// Always appended to every clip so posts get reach out of the box. Merged with
// (and deduped against) any per-video hashtags the user added.
export const DEFAULT_HASHTAGS = [
  "#shorts",
  "#reels",
  "#fyp",
  "#foryou",
  "#viral",
  "#trending",
  "#explore",
  "#follow",
  "#subscribe",
  "#video",
];

export function composeDescription(opts: { clipTitle: string; hashtags?: string | null }): string {
  // Strip any leading "Part N —" the clip title may still carry (older clips).
  const text =
    opts.clipTitle.replace(/^\s*part\s+\d+\s*[—–-]?\s*/i, "").trim() || opts.clipTitle.trim();

  // Merge the user's hashtags with the default set, deduped case-insensitively,
  // user tags first. Bare words are normalized to "#word".
  const seen = new Set<string>();
  const merged: string[] = [];
  const add = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const norm = t.startsWith("#") ? t : `#${t}`;
    const key = norm.slice(1).toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(norm);
  };
  (opts.hashtags ?? "").split(/\s+/).forEach(add);
  DEFAULT_HASHTAGS.forEach(add);

  const tags = merged.join(" ");
  return tags ? `${text}\n\n${tags}` : text;
}

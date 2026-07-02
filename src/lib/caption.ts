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

export function composeDescription(opts: { clipTitle: string; hashtags?: string | null }): string {
  // Strip any leading "Part N —" the clip title may still carry (older clips).
  const text =
    opts.clipTitle.replace(/^\s*part\s+\d+\s*[—–-]?\s*/i, "").trim() || opts.clipTitle.trim();
  const tags = (opts.hashtags ?? "").trim();
  return tags ? `${text}\n\n${tags}` : text;
}

/**
 * Compose a clip's published caption from its parts:
 *   {video title} — Part {n} — {your title}
 *
 *   {hashtags}
 *
 * The part number is only added for FULL-video (sequential) clips. Any leading
 * "Part N —" already present in the clip title is stripped so it isn't doubled.
 */
import type { ClipMode } from "@prisma/client";

export function composeCaption(opts: {
  videoTitle: string;
  hashtags?: string | null;
  clipMode: ClipMode | "VIRAL" | "FULL";
  order?: number | null;
  clipTitle: string;
}): string {
  const yourTitle =
    opts.clipTitle.replace(/^\s*part\s+\d+\s*[—–-]?\s*/i, "").trim() || opts.clipTitle.trim();

  const segments: string[] = [opts.videoTitle.trim()];
  if (opts.clipMode === "FULL" && opts.order != null) segments.push(`Part ${opts.order}`);
  if (yourTitle) segments.push(yourTitle);

  const title = segments.filter(Boolean).join(" — ");
  const tags = (opts.hashtags ?? "").trim();
  return tags ? `${title}\n\n${tags}` : title;
}

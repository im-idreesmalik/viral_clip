/**
 * Algorithmic (non-AI) clip selection.
 *
 * Used for FULL-VIDEO mode — chops the whole source into sequential parts named
 * "Part 1", "Part 2", ... — and as the fallback for VIRAL mode when no
 * transcript is available (we can't judge "viral" without content). Snapping to
 * transcript segment boundaries (when present) avoids cutting mid-sentence.
 */
import type { DetectedClip } from "./types";
import type { Transcript } from "@/services/video/transcription";

export interface SegmentOptions {
  durationSec: number;
  segmentSeconds: number;
  maxClips: number;
  transcript?: Transcript | null;
}

const MIN_CLIP = 15;
const MAX_CLIP = 60;

export function segmentVideo(opts: SegmentOptions): DetectedClip[] {
  const target = clamp(opts.segmentSeconds, MIN_CLIP, MAX_CLIP);
  const clips: DetectedClip[] = [];

  let cursor = 0;
  let order = 1;
  while (cursor < opts.durationSec - 1 && clips.length < opts.maxClips) {
    let end = Math.min(cursor + target, opts.durationSec);
    // Snap the cut to a nearby sentence/segment boundary if we have one.
    if (opts.transcript) {
      end = snapToBoundary(end, cursor + MIN_CLIP, cursor + MAX_CLIP, opts.transcript);
    }
    if (end - cursor < MIN_CLIP && clips.length > 0) {
      // Merge a too-short tail into the previous clip.
      clips[clips.length - 1].endSec = Math.min(opts.durationSec, end);
      break;
    }
    clips.push({
      startSec: round(cursor),
      endSec: round(end),
      title: partTitle(order, cursor, end, opts.transcript),
      viralScore: null,
      reason: null,
      order,
    });
    cursor = end;
    order += 1;
  }
  return clips;
}

/**
 * Title a sequential part: always starts with the part number. When a
 * transcript is available we append a short snippet of what's said in that
 * window so the title is meaningful (e.g. "Part 2 — so the first thing to know").
 */
function partTitle(
  order: number,
  startSec: number,
  endSec: number,
  transcript?: Transcript | null,
): string {
  const base = `Part ${order}`;
  if (!transcript) return base;
  const text = transcript.segments
    .filter((s) => s.end > startSec && s.start < endSec)
    .map((s) => s.text)
    .join(" ")
    .trim();
  if (!text) return base;
  const snippet = text.split(/\s+/).slice(0, 7).join(" ").replace(/[.,!?;:]+$/, "");
  return snippet ? `${base} — ${snippet}` : base;
}

function snapToBoundary(
  ideal: number,
  min: number,
  max: number,
  transcript: Transcript,
): number {
  let best = ideal;
  let bestDist = Infinity;
  for (const seg of transcript.segments) {
    if (seg.end < min || seg.end > max) continue;
    const dist = Math.abs(seg.end - ideal);
    if (dist < bestDist) {
      bestDist = dist;
      best = seg.end;
    }
  }
  return best;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

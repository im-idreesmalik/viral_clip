/**
 * UNION merge of transcript candidates and local visual candidates.
 *
 * NOT an intersection: a visual-only moment survives even if the transcript
 * detector never surfaced it, and vice-versa. Overlapping/near candidates from
 * the two sources are combined into a single "both" candidate that keeps BOTH
 * evidences intact — we never average the transcript viralScore with the visual
 * heuristic (they measure different things).
 */
import type { DetectedClip, MergedCandidate, VisualCandidate } from "./types";

const MAX_CLIP = 60;
const COMBINE_OVERLAP = 0.25; // combine if overlap >= 25% of the shorter window
const COMBINE_GAP = 5; // ...or if the two windows are within 5s of each other

function overlapRatio(aS: number, aE: number, bS: number, bE: number): number {
  const o = Math.max(0, Math.min(aE, bE) - Math.max(aS, bS));
  const minLen = Math.min(aE - aS, bE - bS);
  return minLen > 0 ? o / minLen : 0;
}
function gap(aS: number, aE: number, bS: number, bE: number): number {
  if (aE >= bS && bE >= aS) return 0;
  return aE < bS ? bS - aE : aS - bE;
}

export function mergeCandidates(transcriptClips: DetectedClip[], visualCands: VisualCandidate[]): MergedCandidate[] {
  const merged: MergedCandidate[] = transcriptClips.map((t) => ({
    startSec: t.startSec,
    endSec: t.endSec,
    source: "transcript",
    transcriptEvidence: { viralScore: t.viralScore, reason: t.reason, title: t.title },
  }));

  for (const v of visualCands) {
    const hit = merged.find(
      (m) =>
        m.transcriptEvidence &&
        (overlapRatio(m.startSec, m.endSec, v.startSec, v.endSec) >= COMBINE_OVERLAP ||
          gap(m.startSec, m.endSec, v.startSec, v.endSec) <= COMBINE_GAP),
    );
    if (hit) {
      hit.source = "both";
      // Union the window, bounded to a Shorts-friendly max length.
      hit.startSec = Math.min(hit.startSec, v.startSec);
      hit.endSec = Math.max(hit.endSec, v.endSec);
      if (hit.endSec - hit.startSec > MAX_CLIP) hit.endSec = hit.startSec + MAX_CLIP;
      // Keep the strongest visual evidence if several visual events combine here.
      if (!hit.visualEvidence || v.heuristicScore > hit.visualEvidence.heuristicScore) {
        hit.visualEvidence = { heuristicScore: v.heuristicScore, signals: v.signals };
      }
    } else {
      merged.push({
        startSec: v.startSec,
        endSec: v.endSec,
        source: "visual",
        visualEvidence: { heuristicScore: v.heuristicScore, signals: v.signals },
      });
    }
  }
  return merged.sort((a, b) => a.startSec - b.startSec);
}

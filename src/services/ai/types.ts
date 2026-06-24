/** Shared shape for a clip candidate, whether AI-detected or segmented. */
export interface DetectedClip {
  startSec: number;
  endSec: number;
  title: string;
  /** 0-100 AI confidence. Null for sequential FULL-mode parts. */
  viralScore: number | null;
  reason: string | null;
  /** 1-based sequence index for FULL mode. */
  order: number | null;
}

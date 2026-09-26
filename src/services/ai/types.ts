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
  /** Optional debug metadata (hybrid pipeline). Ignored by Clip creation. */
  debug?: ClipDebug;
}

// ---- Hybrid pipeline types -------------------------------------------------

export type CandidateSource = "transcript" | "visual" | "both";

/** Cheap local visual signals for a window — for discovery/ranking only. */
export interface VisualSignals {
  sceneChange: number; // strongest scene-change score in the window (0-1)
  sceneDensity: number; // scene cuts per 10s
  motionActivity: number; // 0-1 activity proxy (from cut density)
  audioEnergy: number; // 0-1 windowed RMS peak (NOT speech detection)
}

/** A visually-discovered candidate. heuristicScore is discovery ranking, NOT virality. */
export interface VisualCandidate {
  startSec: number;
  endSec: number;
  source: "visual";
  heuristicScore: number; // 0-100, discovery ranking only
  signals: VisualSignals;
}

/** Union-merged candidate carrying evidence from whichever source(s) found it. */
export interface MergedCandidate {
  startSec: number;
  endSec: number;
  source: CandidateSource;
  transcriptEvidence?: { viralScore: number | null; reason: string | null; title: string };
  visualEvidence?: { heuristicScore: number; signals: VisualSignals };
}

/** Debug metadata attached to a final clip (not persisted to the Clip row). */
export interface ClipDebug {
  source: CandidateSource;
  transcriptScore?: number | null;
  visualHeuristicScore?: number;
  multimodalScore?: number;
  visualSignals?: VisualSignals;
}

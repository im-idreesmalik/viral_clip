/**
 * Vision provider abstraction for the SELECTIVE multimodal stage.
 *
 * A provider evaluates ONE candidate from a few representative frames + context.
 * It NEVER receives the whole video — only the shortlisted candidate's frames.
 * Swap providers (Gemini / OpenAI / Groq vision / …) behind this interface.
 */
import type { CandidateSource, VisualSignals } from "../types";

export interface VisionFrame {
  base64: string; // raw base64 (no data: prefix)
  mime: string; // e.g. "image/jpeg"
  label: string; // "start" | "middle" | "end"
}

export interface VisionInput {
  startSec: number;
  endSec: number;
  source: CandidateSource;
  frames: VisionFrame[];
  transcriptExcerpt: string; // may be empty for a silent/visual candidate
  signals?: VisualSignals;
}

export interface VisionResult {
  viralScore: number; // 0-100 final judgment for THIS candidate
  title: string;
  reason: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface VisionProvider {
  name: string;
  model: string;
  evaluateCandidate(input: VisionInput): Promise<VisionResult>;
}

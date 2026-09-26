/**
 * Gemini vision provider — evaluates ONE candidate from a few inline frames +
 * the transcript excerpt for that window. Uses generateContent with inline image
 * data (base64), so ONLY the candidate's representative frames are sent — never
 * the whole source video. Structured JSON output.
 */
import { env } from "@/lib/env";
import type { VisionInput, VisionProvider, VisionResult } from "./types";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const SCHEMA = {
  type: "OBJECT",
  properties: {
    viralScore: { type: "INTEGER" },
    title: { type: "STRING" },
    reason: { type: "STRING" },
  },
  required: ["viralScore", "title", "reason"],
};

function prompt(input: VisionInput): string {
  const secs = Math.round(input.endSec - input.startSec);
  const sig = input.signals
    ? `Local signals — scene-change ${input.signals.sceneChange}, motion ${input.signals.motionActivity}, audio-energy ${input.signals.audioEnergy}.`
    : "";
  return [
    "You are an expert short-form video editor judging ONE candidate moment for a",
    `TikTok/Reels/Shorts clip. It is ${secs}s long. You are shown representative`,
    "frames (start / middle / end) and the transcript for this exact window.",
    "",
    "Judge how good a standalone Short this is, weighing: immediate hook, visual",
    "interest, action/motion, reveal/payoff, facial/emotional reaction, demonstration,",
    "interesting on-screen content, spoken insight, humor, surprise, controversy/debate,",
    "standalone understandability, retention, and natural start/end.",
    "",
    "CRITICAL: do NOT require BOTH speech and visuals to be strong. A candidate can be",
    "excellent because the speech is excellent, OR because the visuals are excellent, OR",
    "both. A silent but visually exceptional moment MUST be able to score very high.",
    sig,
    "",
    "Transcript for this window (may be empty if little/no speech):",
    input.transcriptExcerpt ? `"""${input.transcriptExcerpt}"""` : "(no meaningful speech)",
    "",
    "Return viralScore 0-100 (honest), a scroll-stopping title (<12 words, no hashtags),",
    "and a one-sentence reason.",
  ].join("\n");
}

async function evaluateCandidate(input: VisionInput): Promise<VisionResult> {
  if (!env.geminiApiKey) throw new Error("GEMINI_API_KEY is required for the gemini vision provider.");
  const parts: unknown[] = [{ text: prompt(input) }];
  for (const f of input.frames) parts.push({ inline_data: { mime_type: f.mime, data: f.base64 } });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), env.aiTimeoutMs);
  try {
    const res = await fetch(`${BASE}/${env.geminiVisionModel}:generateContent?key=${env.geminiApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }, // key is a query param; never logged
      signal: ctrl.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.4, response_mime_type: "application/json", response_schema: SCHEMA },
      }),
    });
    if (!res.ok) throw new Error(`Gemini vision error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const first = text.indexOf("{"), last = text.lastIndexOf("}");
    const parsed = JSON.parse(text.slice(first, last + 1));
    const um = j?.usageMetadata;
    return {
      viralScore: Math.max(0, Math.min(100, Math.round(Number(parsed.viralScore) || 0))),
      title: String(parsed.title || "").trim().slice(0, 120),
      reason: String(parsed.reason || "").trim().slice(0, 400),
      usage: um ? { inputTokens: um.promptTokenCount ?? 0, outputTokens: um.candidatesTokenCount ?? 0 } : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const geminiVisionProvider: VisionProvider = {
  name: "gemini",
  get model() { return env.geminiVisionModel; },
  evaluateCandidate,
};

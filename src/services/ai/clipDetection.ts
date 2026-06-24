/**
 * AI-powered viral clip detection with Claude.
 *
 * Feeds a timestamped transcript to Claude (claude-opus-4-8) and asks it to
 * identify the highest-potential short-form moments, each with precise
 * timestamps, an auto-generated hook title, a 0-100 viral confidence score,
 * and a rationale. Uses structured outputs so the result is guaranteed-valid
 * JSON, adaptive thinking for better judgment, and streaming to avoid timeouts
 * on long transcripts.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import type { Transcript } from "@/services/video/transcription";
import type { DetectedClip } from "./types";

const log = createLogger("ai:clips");

const MIN_CLIP = 15;
const MAX_CLIP = 60;

export interface DetectViralOptions {
  transcript: Transcript;
  durationSec: number;
  threshold: number; // 0-100 minimum viral score to keep
  maxClips: number;
}

// Validated post-hoc (structured-output JSON Schema can't express numeric
// bounds), then clamped to sane clip lengths.
const clipSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().positive(),
  title: z.string().min(1).max(120),
  viralScore: z.number(),
  reason: z.string().max(400),
});
const responseSchema = z.object({ clips: z.array(clipSchema) });

// JSON Schema for the Messages API structured-output constraint.
const OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    clips: {
      type: "array",
      items: {
        type: "object",
        properties: {
          startSec: { type: "number", description: "Clip start time in seconds from the video start." },
          endSec: { type: "number", description: "Clip end time in seconds from the video start." },
          title: { type: "string", description: "Punchy, curiosity-driven title/hook for the clip." },
          viralScore: { type: "integer", description: "Viral potential confidence from 0 to 100." },
          reason: { type: "string", description: "One sentence on why this moment could go viral." },
        },
        required: ["startSec", "endSec", "title", "viralScore", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["clips"],
  additionalProperties: false,
} as const;

/**
 * Detect viral clips using the configured AI provider (local Ollama by default,
 * or cloud Anthropic). Both return the same normalized DetectedClip[].
 */
export async function detectViralClips(opts: DetectViralOptions): Promise<DetectedClip[]> {
  const { transcript, durationSec, threshold, maxClips } = opts;
  if (!transcript || transcript.segments.length === 0) {
    throw new Error("A transcript is required for AI viral detection.");
  }

  const transcriptText = formatTranscript(transcript);
  const system = buildSystemPrompt(durationSec, maxClips);
  const userMessage = buildUserPrompt(transcriptText, threshold, durationSec);

  const rawJson =
    env.aiProvider === "anthropic"
      ? await runAnthropic(system, userMessage)
      : await runOllama(system, userMessage);

  let parsed: z.infer<typeof responseSchema>;
  try {
    parsed = responseSchema.parse(JSON.parse(rawJson));
  } catch (err) {
    log.error("Failed to parse AI output", { sample: rawJson.slice(0, 300) });
    throw new Error(`AI output was not valid: ${err instanceof Error ? err.message : err}`);
  }

  return normalizeClips(parsed.clips, durationSec, threshold, maxClips);
}

// ---- Local provider: Ollama ----------------------------------------------

async function runOllama(system: string, userMessage: string): Promise<string> {
  log.info("Requesting viral clip analysis (Ollama)", {
    model: env.ollama.model,
    baseUrl: env.ollama.baseUrl,
  });

  let res: Response;
  try {
    res = await fetch(`${env.ollama.baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.ollama.model,
        stream: false,
        // Ollama structured outputs: pass the JSON Schema as `format` (v0.5+).
        format: OUTPUT_JSON_SCHEMA,
        options: { temperature: 0.4, num_ctx: env.ollama.numCtx },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMessage },
        ],
      }),
    });
  } catch (err) {
    throw new Error(
      `Could not reach Ollama at ${env.ollama.baseUrl}. Is it running (\`ollama serve\`) and is the model pulled (\`ollama pull ${env.ollama.model}\`)? ${
        err instanceof Error ? err.message : err
      }`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama error ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  const content = json?.message?.content;
  if (!content) throw new Error("Ollama returned an empty response.");
  return content;
}

// ---- Cloud provider: Anthropic Claude ------------------------------------

let client: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!env.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set; set AI_PROVIDER=ollama for local, free detection.");
  }
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

async function runAnthropic(system: string, userMessage: string): Promise<string> {
  const anthropic = getAnthropic();
  log.info("Requesting viral clip analysis (Anthropic)", { model: env.anthropicModel });

  // Built as a loose object so we aren't coupled to the exact SDK type version
  // for `output_config` / adaptive `thinking` (both are current wire params).
  const params = {
    model: env.anthropicModel,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: OUTPUT_JSON_SCHEMA },
    },
    system,
    messages: [{ role: "user", content: userMessage }],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = anthropic.messages.stream(params as any);
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("Claude declined to analyze this content.");
  }
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI analysis returned no structured output.");
  }
  return textBlock.text;
}

function normalizeClips(
  raw: z.infer<typeof clipSchema>[],
  durationSec: number,
  threshold: number,
  maxClips: number,
): DetectedClip[] {
  const cleaned: DetectedClip[] = [];

  for (const c of raw) {
    let start = Math.max(0, Math.min(c.startSec, durationSec - MIN_CLIP));
    let end = Math.min(durationSec, c.endSec);
    if (end <= start) continue;

    // Clamp to platform-friendly short-form length.
    let len = end - start;
    if (len < MIN_CLIP) end = Math.min(durationSec, start + MIN_CLIP);
    if (len > MAX_CLIP) end = start + MAX_CLIP;

    const score = clampScore(c.viralScore);
    if (score < threshold) continue;

    cleaned.push({
      startSec: round(start),
      endSec: round(end),
      title: c.title.trim().slice(0, 120),
      viralScore: score,
      reason: c.reason.trim() || null,
      order: null,
    });
  }

  // Highest score first, drop heavy overlaps, cap at maxClips.
  cleaned.sort((a, b) => (b.viralScore ?? 0) - (a.viralScore ?? 0));
  const selected: DetectedClip[] = [];
  for (const clip of cleaned) {
    if (selected.length >= maxClips) break;
    if (selected.some((s) => overlapRatio(s, clip) > 0.5)) continue;
    selected.push(clip);
  }
  return selected;
}

function overlapRatio(a: DetectedClip, b: DetectedClip): number {
  const start = Math.max(a.startSec, b.startSec);
  const end = Math.min(a.endSec, b.endSec);
  const overlap = Math.max(0, end - start);
  const minLen = Math.min(a.endSec - a.startSec, b.endSec - b.startSec);
  return minLen > 0 ? overlap / minLen : 0;
}

// ---- Prompt construction --------------------------------------------------

function buildSystemPrompt(durationSec: number, maxClips: number): string {
  return [
    "You are an expert short-form video editor and social media strategist.",
    "Your job: given a timestamped transcript of a long-form video, identify the",
    `moments most likely to go viral as standalone TikTok/Reels/Shorts clips.`,
    "",
    "Selection criteria for a viral moment:",
    "- A strong hook in the first 1-2 seconds (surprise, bold claim, question, emotion).",
    "- A self-contained idea, story, or punchline that makes sense without surrounding context.",
    "- High emotional charge, controversy, humor, insight, or actionable value.",
    "- Natural start/end points (don't cut mid-sentence).",
    "",
    "Hard constraints:",
    `- Each clip MUST be between ${MIN_CLIP} and ${MAX_CLIP} seconds long.`,
    `- Timestamps must fall within the video duration of ${Math.floor(durationSec)} seconds.`,
    "- Clips must not substantially overlap each other.",
    `- Return at most ${maxClips} clips, ordered by viral potential.`,
    "- viralScore is your honest 0-100 confidence that the clip will perform well.",
    "- The title is a scroll-stopping hook (not a summary), under 12 words, no hashtags.",
  ].join("\n");
}

function buildUserPrompt(transcript: string, threshold: number, durationSec: number): string {
  return [
    `Here is the transcript of a ${Math.floor(durationSec)}-second video. Each line is`,
    "prefixed with its start time as [seconds | mm:ss].",
    "",
    "Identify the best viral clip candidates. Only include clips you score at or above",
    `${threshold}/100. If fewer strong moments exist, return fewer clips — do not pad.`,
    "",
    "TRANSCRIPT:",
    transcript,
  ].join("\n");
}

function formatTranscript(transcript: Transcript): string {
  return transcript.segments
    .map((s) => `[${s.start.toFixed(1)} | ${mmss(s.start)}] ${s.text}`)
    .join("\n");
}

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

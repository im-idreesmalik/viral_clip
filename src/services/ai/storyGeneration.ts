/**
 * AI story writer for the AI Stories feature.
 *
 * Generates a long-form (8-10 min) narrated story script that is engaging,
 * curiosity-driven, and built for retention. Uses Claude when an
 * ANTHROPIC_API_KEY is configured (best quality — structured JSON in one shot),
 * otherwise falls back to the local Ollama model, which is driven with plain
 * prose + a continuation loop so it actually reaches the target length (local
 * models cut long structured outputs short).
 *
 * For Urdu we produce TWO forms of the SAME text: the display script (Urdu /
 * Arabic) and a Devanagari transliteration used to drive the Hindi TTS voice
 * (Hindi + Urdu are the same spoken language → natural Hindustani narration).
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("ai:story");

export type StoryLanguage = "en" | "ur";

export interface GenerateStoryOptions {
  topic: string;
  language: StoryLanguage;
  durationMin: number; // target narrated length, 8-10
}

export interface GeneratedStory {
  title: string;
  text: string; // display script
  ttsText: string | null; // Devanagari for Urdu; null for English (speak `text`)
}

// Roughly how many words a listener hears per minute at a calm narration pace.
const WORDS_PER_MIN = 145;

export async function generateStory(opts: GenerateStoryOptions): Promise<GeneratedStory> {
  const targetWords = Math.round(opts.durationMin * WORDS_PER_MIN);
  return env.anthropicApiKey
    ? generateStoryAnthropic(opts, targetWords)
    : generateStoryOllama(opts, targetWords);
}

// ---- Shared prompt pieces -------------------------------------------------

function retentionRules(language: StoryLanguage, targetWords: number): string[] {
  const lang = language === "ur" ? "Urdu" : "English";
  return [
    "You are a master storyteller who writes scripts for narrated short-video stories that people cannot stop listening to.",
    "",
    "Craft the story to maximize retention:",
    "- Open with an irresistible hook in the first 1-2 sentences (a mystery, a bold question, a shocking fact, or high stakes).",
    "- Keep raising curiosity with small cliffhangers and 'but then…' turns so the listener always wants the next line.",
    "- Use vivid, concrete, sensory language and short punchy sentences that are pleasant to hear read aloud.",
    "- Build to a satisfying, surprising, or moving payoff at the very end — reward people for finishing.",
    `- Write entirely in natural, conversational ${lang}.`,
    `- The story MUST be at least ${targetWords} words long — fully dramatize every beat with scenes, detail, thoughts, and dialogue. Do not summarize or wrap up early.`,
    "- Flowing prose only: NO markdown, NO headings, NO stage directions, NO speaker labels, NO emojis.",
    "- Spell out numbers as words so a voice engine reads them correctly.",
  ];
}

// ---- Anthropic path (structured JSON) -------------------------------------

const storySchema = z.object({
  title: z.string().min(1).max(160),
  text: z.string().min(1),
  ttsText: z.string().optional().default(""),
});

const OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "A short, curiosity-driven title (no hashtags)." },
    text: { type: "string", description: "The full narrated story in the requested language/script." },
    ttsText: {
      type: "string",
      description: "For Urdu: a Devanagari transliteration of the EXACT same words. For English: an empty string.",
    },
  },
  required: ["title", "text", "ttsText"],
  additionalProperties: false,
} as const;

async function generateStoryAnthropic(opts: GenerateStoryOptions, targetWords: number): Promise<GeneratedStory> {
  const system = [
    ...retentionRules(opts.language, targetWords),
    opts.language === "ur"
      ? "- Write `text` in natural Urdu (Arabic script). Also provide `ttsText`: a faithful Devanagari transliteration of the SAME words, sentence-for-sentence."
      : "- Set `ttsText` to an empty string.",
  ].join("\n");
  const user = [
    `Write a complete, ${targetWords}-word narrated story on this topic:`,
    "",
    opts.topic,
  ].join("\n");

  const raw = await runAnthropicJson(system, user);
  let parsed: z.infer<typeof storySchema>;
  try {
    parsed = storySchema.parse(JSON.parse(raw));
  } catch (err) {
    log.error("Failed to parse story output", { sample: raw.slice(0, 300) });
    throw new Error(`Story generation returned invalid output: ${err instanceof Error ? err.message : err}`);
  }
  // Urdu is narrated directly from its Arabic-script text now, so ignore any
  // Devanagari the model returned.
  return { title: parsed.title.trim(), text: parsed.text.trim(), ttsText: null };
}

// ---- Ollama path (plain prose + continuation loop) ------------------------

async function generateStoryOllama(opts: GenerateStoryOptions, targetWords: number): Promise<GeneratedStory> {
  const system = [
    ...retentionRules(opts.language, targetWords),
    "",
    "Respond as PLAIN TEXT in exactly this shape, with nothing else:",
    "TITLE: <a short, curiosity-driven title>",
    "<blank line>",
    "<the full story text>",
  ].join("\n");
  const user = `Topic:\n${opts.topic}\n\nWrite the complete story now (at least ${targetWords} words).`;

  log.info("Generating story (Ollama)", { model: env.ollama.model, targetWords });
  let raw = await runOllamaChat(system, user);
  let { title, body } = parseTitleBody(raw);
  let words = countWords(body);

  // Local models often stop short — top up with continuations until we're near
  // the target (or we've tried enough times).
  let rounds = 0;
  while (words < targetWords * 0.75 && rounds < 5) {
    rounds++;
    const contPrompt = [
      "Continue this story seamlessly from exactly where it stops.",
      "Do NOT repeat any earlier text, do NOT restate the title, keep the same language and tone,",
      "and write several more vivid paragraphs (dialogue, detail, rising tension).",
      "",
      "Story so far:",
      body.slice(-4000),
    ].join("\n");
    const more = parseTitleBody(await runOllamaChat(system, contPrompt)).body.trim();
    if (!more || more.length < 40) break;
    body += "\n\n" + more;
    const next = countWords(body);
    if (next <= words) break; // no progress
    words = next;
    log.info("Story continuation", { rounds, words });
  }

  // Urdu is now narrated directly from its Arabic-script text (espeak -v ur),
  // so no Devanagari transliteration is needed.
  return { title, text: body.trim(), ttsText: null };
}

function parseTitleBody(raw: string): { title: string; body: string } {
  const text = raw.trim();
  const lines = text.split(/\r?\n/);
  let title = "";
  const titleIdx = lines.findIndex((l) => /^\s*(?:title|عنوان|سرخی)\s*[:：]/i.test(l));
  if (titleIdx !== -1) {
    title = lines[titleIdx].replace(/^\s*(?:title|عنوان|سرخی)\s*[:：]\s*/i, "").trim();
    lines.splice(titleIdx, 1);
  }
  let body = lines.join("\n").trim();
  body = body.replace(/^\s*(?:story|کہانی|کہانی)\s*[:：]\s*/i, "").trim();
  if (!title) title = (body.split(/[.!?\n]/)[0] || "").slice(0, 80).trim() || "Untitled story";
  return { title, body };
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Transliterate Urdu (Arabic script) into Devanagari for the Hindi TTS voice.
 * Used for AI Urdu stories and for admin-pasted Urdu that lacks the Devanagari
 * form. Returns plain text.
 */
export async function transliterateUrduToDevanagari(urdu: string): Promise<string> {
  const system = [
    "You transliterate Urdu (Arabic script) into Devanagari (Hindi script).",
    "Output ONLY the Devanagari transliteration of the given text — same words, same order, same punctuation.",
    "Do not translate, summarize, add, or remove anything. No preamble, no quotes, no explanation.",
  ].join("\n");
  return (env.anthropicApiKey ? runAnthropicText(system, urdu) : runOllamaChat(system, urdu, 0.2)).then((t) =>
    t.trim(),
  );
}

// ---- Provider transports --------------------------------------------------

let client: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

async function runAnthropicJson(system: string, user: string): Promise<string> {
  log.info("Generating story (Anthropic)", { model: env.anthropicModel });
  const params = {
    model: env.anthropicModel,
    max_tokens: 24000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: { type: "json_schema", schema: OUTPUT_JSON_SCHEMA } },
    system,
    messages: [{ role: "user", content: user }],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message = await getAnthropic().messages.stream(params as any).finalMessage();
  if (message.stop_reason === "refusal") throw new Error("The AI declined to write this story. Try another topic.");
  const block = message.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Story generation returned no output.");
  return block.text;
}

async function runAnthropicText(system: string, user: string): Promise<string> {
  const params = { model: env.anthropicModel, max_tokens: 16000, system, messages: [{ role: "user", content: user }] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message = await getAnthropic().messages.stream(params as any).finalMessage();
  const block = message.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Transliteration returned no output.");
  return block.text;
}

/**
 * Plain-text Ollama chat with a raised output cap for long-form generation.
 *
 * MUST stream: long generations (minutes) exceed Node/undici's default headers
 * timeout when `stream:false` (Ollama only sends response headers once the whole
 * answer is ready). Streaming delivers headers + tokens immediately, so only our
 * own abort timeout applies.
 */
async function runOllamaChat(system: string, user: string, temperature = 0.9): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.storyGenTimeoutMs);
  try {
    const res = await fetch(`${env.ollama.baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: env.ollama.model,
        stream: true,
        options: {
          temperature,
          num_ctx: Math.max(env.ollama.numCtx, 16384),
          // Cap output per call so a single generation stays reasonable; the
          // continuation loop tops up length across calls.
          num_predict: 3500,
        },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok || !res.body) throw new Error(`Ollama error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);

    // Ollama streams newline-delimited JSON; accumulate message.content deltas.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let out = "";
    const consume = (line: string) => {
      const t = line.trim();
      if (!t) return;
      try {
        const j = JSON.parse(t);
        if (j?.message?.content) out += j.message.content as string;
        if (j?.error) throw new Error(`Ollama error: ${j.error}`);
      } catch {
        /* ignore partial/non-JSON lines */
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        consume(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    }
    consume(buf);
    if (!out.trim()) throw new Error("Ollama returned an empty response.");
    return out;
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`Story generation timed out after ${env.storyGenTimeoutMs}ms.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

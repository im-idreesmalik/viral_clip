/**
 * Local, free text-to-speech for AI Stories — two engines by language:
 *
 *   English  -> Kokoro-82M (kokoro-js) with a soft, natural FEMALE voice
 *               (af_heart by default; configurable via STORY_VOICE_EN).
 *   Urdu/Hindi -> Meta MMS-TTS Hindi (mms-tts-hin) via @huggingface/transformers,
 *               fed a Devanagari transliteration so it narrates natural
 *               Hindustani. (Kokoro is English-only, so Urdu uses the best
 *               available local voice.)
 *
 * Both run on CPU (stable), and their pipelines are cached so the model load
 * happens once. Long text is chunked, synthesized per chunk, concatenated with
 * a short gap, and encoded to a compact MP3.
 */
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("tts");

if (env.ffmpegPath || ffmpegStatic) ffmpeg.setFfmpegPath(env.ffmpegPath || (ffmpegStatic as string));

// VITS handles a sentence or two well; keep chunks short so nothing is dropped.
const MAX_CHARS_PER_CHUNK = 240;
// Silence inserted between chunks so sentences don't run together (seconds).
const GAP_SECONDS = 0.28;

const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const MMS_HINDI_MODEL = "Xenova/mms-tts-hin";

/** Urdu + Hindi use the MMS Hindi voice; everything else uses Kokoro (English). */
function isIndic(language: string): boolean {
  const l = (language || "en").toLowerCase();
  return l === "ur" || l === "hi" || l.startsWith("hi-") || l === "ur-hi";
}

// ---- Model caches ---------------------------------------------------------

let kokoroPromise: Promise<{ generate: (t: string, o: { voice: string }) => Promise<{ audio: Float32Array; sampling_rate: number }> }> | null = null;
async function getKokoro() {
  if (!kokoroPromise) {
    kokoroPromise = (async () => {
      const { KokoroTTS } = await import("kokoro-js");
      log.info("Loading Kokoro TTS (first use downloads it)", { model: KOKORO_MODEL });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: "q8", device: "cpu" } as any)) as any;
    })();
  }
  return kokoroPromise;
}

const mmsPipelines = new Map<string, Promise<(text: string) => Promise<{ audio: Float32Array; sampling_rate: number }>>>();
async function getMms(model: string) {
  if (!mmsPipelines.has(model)) {
    mmsPipelines.set(
      model,
      (async () => {
        const { pipeline } = await import("@huggingface/transformers");
        log.info("Loading MMS TTS model (first use downloads it)", { model });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = (await pipeline("text-to-speech", model, { device: "cpu" } as any)) as any;
        return (text: string) => p(text);
      })(),
    );
  }
  return mmsPipelines.get(model)!;
}

// ---- Chunking -------------------------------------------------------------

/** Split text into short, speakable chunks on sentence then clause boundaries. */
export function chunkForTts(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?।؟])\s+/);
  const chunks: string[] = [];
  let buf = "";
  const push = () => {
    const t = buf.trim();
    if (t) chunks.push(t);
    buf = "";
  };
  for (const s of sentences) {
    if (s.length > MAX_CHARS_PER_CHUNK) {
      push();
      const parts = s.split(/(?<=[,،;:])\s+/);
      for (const p of parts) {
        if ((buf + " " + p).trim().length > MAX_CHARS_PER_CHUNK) push();
        buf = (buf ? buf + " " : "") + p;
        while (buf.length > MAX_CHARS_PER_CHUNK) {
          chunks.push(buf.slice(0, MAX_CHARS_PER_CHUNK));
          buf = buf.slice(MAX_CHARS_PER_CHUNK);
        }
      }
      push();
    } else if ((buf + " " + s).trim().length > MAX_CHARS_PER_CHUNK) {
      push();
      buf = s;
    } else {
      buf = (buf ? buf + " " : "") + s;
    }
  }
  push();
  return chunks;
}

// ---- Synthesis ------------------------------------------------------------

export interface SynthesizeResult {
  durationSec: number;
}

/**
 * Synthesize a full story to an MP3 at `outMp3Path`.
 *   - `text`: spoken content (English text, or Devanagari for Urdu/Hindustani).
 *   - `language`: "en" | "ur" (selects the voice engine).
 */
export async function synthesizeToMp3(
  text: string,
  language: string,
  outMp3Path: string,
): Promise<SynthesizeResult> {
  const chunks = chunkForTts(text);
  if (chunks.length === 0) throw new Error("Nothing to synthesize (empty text).");

  const { merged, sampleRate } = isIndic(language)
    ? await synthWithMms(chunks)
    : await synthWithKokoro(chunks, env.storyVoiceEn);

  const tmpWav = path.join(os.tmpdir(), `vc-tts-${process.pid}-${chunks.length}.wav`);
  await fsp.writeFile(tmpWav, wavFromFloat32(merged, sampleRate));
  try {
    await wavToMp3(tmpWav, outMp3Path);
  } finally {
    await fsp.rm(tmpWav, { force: true }).catch(() => undefined);
  }

  const durationSec = merged.length / sampleRate;
  log.info("Synthesized voice-over", {
    engine: isIndic(language) ? "mms-hin" : `kokoro:${env.storyVoiceEn}`,
    chunks: chunks.length,
    durationSec: Math.round(durationSec),
  });
  return { durationSec };
}

async function synthWithKokoro(chunks: string[], voice: string): Promise<{ merged: Float32Array; sampleRate: number }> {
  const tts = await getKokoro();
  let sampleRate = 24000;
  const parts: Float32Array[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const out = await tts.generate(chunks[i], { voice });
    sampleRate = out.sampling_rate;
    parts.push(out.audio, new Float32Array(Math.round(sampleRate * GAP_SECONDS)));
    if ((i + 1) % 10 === 0) log.info("TTS progress (kokoro)", { done: i + 1, total: chunks.length });
  }
  return { merged: concat(parts), sampleRate };
}

async function synthWithMms(chunks: string[]): Promise<{ merged: Float32Array; sampleRate: number }> {
  const synth = await getMms(MMS_HINDI_MODEL);
  let sampleRate = 16000;
  const parts: Float32Array[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const out = await synth(chunks[i]);
    sampleRate = out.sampling_rate;
    parts.push(out.audio, new Float32Array(Math.round(sampleRate * GAP_SECONDS)));
    if ((i + 1) % 10 === 0) log.info("TTS progress (mms)", { done: i + 1, total: chunks.length });
  }
  return { merged: concat(parts), sampleRate };
}

function concat(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const p of parts) {
    merged.set(p, offset);
    offset += p.length;
  }
  return merged;
}

// ---- Encoding -------------------------------------------------------------

/** Encode a mono WAV into a compact MP3 suitable for browser playback. */
function wavToMp3(wavPath: string, mp3Path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(wavPath)
      .audioCodec("libmp3lame")
      .audioBitrate("128k")
      .audioChannels(1)
      .format("mp3")
      .on("error", (err) => reject(new Error(`MP3 encode failed: ${err.message}`)))
      .on("end", () => resolve())
      .save(mp3Path);
  });
}

/** Build a 16-bit PCM mono WAV file buffer from float samples in [-1, 1]. */
function wavFromFloat32(samples: Float32Array, sampleRate: number): Buffer {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, 44 + i * 2);
  }
  return buf;
}

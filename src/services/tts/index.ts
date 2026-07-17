/**
 * Local, free text-to-speech for AI Stories.
 *
 * Runs Meta's MMS-TTS (VITS) models in-process via @huggingface/transformers
 * (the same ONNX runtime we already use for Whisper) — no Python, no external
 * binaries. English uses `mms-tts-eng`; Urdu/Hindustani uses `mms-tts-hin` fed
 * with a Devanagari transliteration (Hindi and Urdu are the same spoken
 * language, so the Hindi voice reads it as natural Hindustani).
 *
 * The model is CPU-only here (VITS is small + fast, ~5-8x realtime, and CPU
 * ONNX is stable — unlike the GPU Whisper backend we had to isolate). The
 * pipeline is cached across calls so the ~30s model load happens once.
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

const SAMPLE_RATE = 16000;
// VITS handles a sentence or two well; keep chunks short so nothing is dropped.
const MAX_CHARS_PER_CHUNK = 240;
// Silence inserted between chunks so sentences don't run together (seconds).
const GAP_SECONDS = 0.28;

/** Pick the MMS voice model for a language. Urdu is spoken via the Hindi voice. */
function modelForLanguage(language: string): string {
  const lang = (language || "en").toLowerCase();
  if (lang === "ur" || lang === "hi" || lang.startsWith("hi-")) return "Xenova/mms-tts-hin";
  return "Xenova/mms-tts-eng";
}

// Cache one pipeline per model id (loading is expensive).
const pipelines = new Map<string, Promise<unknown>>();

async function getSynth(model: string): Promise<(text: string) => Promise<{ audio: Float32Array; sampling_rate: number }>> {
  if (!pipelines.has(model)) {
    pipelines.set(
      model,
      (async () => {
        const { pipeline } = await import("@huggingface/transformers");
        log.info("Loading TTS model (first use downloads it)", { model });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await pipeline("text-to-speech", model, { device: "cpu" } as any);
      })(),
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const synth = (await pipelines.get(model)!) as any;
  return (text: string) => synth(text);
}

/** Split text into short, speakable chunks on sentence then clause boundaries. */
export function chunkForTts(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  // Sentence boundaries for Latin + Devanagari/Urdu punctuation.
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
      // Very long sentence: break on commas / spaces.
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

export interface SynthesizeResult {
  durationSec: number;
}

/**
 * Synthesize a full story to an MP3 at `outMp3Path`.
 *   - `text`: the spoken content in the voice engine's expected script
 *     (English text, or Devanagari for Urdu/Hindustani).
 *   - `language`: "en" | "ur" (selects the voice model).
 */
export async function synthesizeToMp3(
  text: string,
  language: string,
  outMp3Path: string,
): Promise<SynthesizeResult> {
  const model = modelForLanguage(language);
  const chunks = chunkForTts(text);
  if (chunks.length === 0) throw new Error("Nothing to synthesize (empty text).");

  const synth = await getSynth(model);
  const gap = new Float32Array(Math.round(SAMPLE_RATE * GAP_SECONDS));
  const parts: Float32Array[] = [];
  let totalLen = 0;

  for (let i = 0; i < chunks.length; i++) {
    const out = await synth(chunks[i]);
    parts.push(out.audio, gap);
    totalLen += out.audio.length + gap.length;
    if ((i + 1) % 10 === 0) log.info("TTS progress", { done: i + 1, total: chunks.length });
  }

  const merged = new Float32Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    merged.set(p, offset);
    offset += p.length;
  }

  const tmpWav = path.join(os.tmpdir(), `vc-tts-${process.pid}-${chunks.length}.wav`);
  await fsp.writeFile(tmpWav, wavFromFloat32(merged, SAMPLE_RATE));
  try {
    await wavToMp3(tmpWav, outMp3Path);
  } finally {
    await fsp.rm(tmpWav, { force: true }).catch(() => undefined);
  }

  const durationSec = merged.length / SAMPLE_RATE;
  log.info("Synthesized story voice-over", { model, chunks: chunks.length, durationSec: Math.round(durationSec) });
  return { durationSec };
}

/** Encode a mono 16kHz WAV into a compact MP3 suitable for browser playback. */
function wavToMp3(wavPath: string, mp3Path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(wavPath)
      .audioCodec("libmp3lame")
      .audioBitrate("96k")
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

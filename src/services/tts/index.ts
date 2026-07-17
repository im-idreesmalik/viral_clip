/**
 * Local, free text-to-speech for AI Stories — powered end-to-end by Kokoro-82M
 * (the best free local TTS), with soft, natural FEMALE voices:
 *
 *   English -> kokoro-js handles phonemization internally (af_heart default).
 *   Urdu    -> phonemize the Urdu (Arabic-script) text with espeak-ng's Urdu
 *              voice (-v ur) — this preserves Urdu-specific sounds (q/x/ɣ/z) and
 *              vocabulary that a Hindi reading would flatten — then tokenize with
 *              Kokoro's own tokenizer and synthesize via generate_from_ids with a
 *              Hindi female voice (hf_alpha, the closest Hindustani voice Kokoro
 *              ships). Hindi text (if ever used) goes through -v hi on Devanagari.
 *
 * One Kokoro model serves both languages. Runs on CPU (stable, fast). Long text
 * is chunked, synthesized per chunk, concatenated with a short gap, and encoded
 * to a compact MP3.
 */
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";

const execFileAsync = promisify(execFile);
const log = createLogger("tts");

if (env.ffmpegPath || ffmpegStatic) ffmpeg.setFfmpegPath(env.ffmpegPath || (ffmpegStatic as string));

// Kokoro handles a sentence or two well; keep chunks short so nothing is dropped.
const MAX_CHARS_PER_CHUNK = 240;
// Silence inserted between chunks so sentences don't run together (seconds).
const GAP_SECONDS = 0.28;
const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

/** Urdu + Hindi use the Kokoro Hindi voice; everything else uses English. */
function isIndic(language: string): boolean {
  const l = (language || "en").toLowerCase();
  return l === "ur" || l === "hi" || l.startsWith("hi-") || l === "ur-hi";
}

// ---- Kokoro model (cached) ------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let kokoroPromise: Promise<any> | null = null;
async function getKokoro() {
  if (!kokoroPromise) {
    kokoroPromise = (async () => {
      const { KokoroTTS } = await import("kokoro-js");
      log.info("Loading Kokoro TTS (first use downloads it)", { model: KOKORO_MODEL });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: "q8", device: "cpu" } as any);
    })();
  }
  return kokoroPromise;
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

// ---- espeak-ng phonemization (for the Hindi voice) ------------------------

let espeakCounter = 0;
/** Phonemize text to IPA with espeak-ng. Text is passed via a UTF-8 file so
 *  non-Latin scripts survive (Windows mangles native-exe UTF-8 args). */
async function espeakIpa(text: string, voice: string): Promise<string> {
  if (!fs.existsSync(env.espeakPath)) {
    throw new Error(
      `espeak-ng not found at "${env.espeakPath}". Install it (winget install eSpeak-NG.eSpeak-NG) or set ESPEAK_PATH.`,
    );
  }
  const f = path.join(os.tmpdir(), `vc-esp-${process.pid}-${espeakCounter++}.txt`);
  await fsp.writeFile(f, text, "utf8");
  try {
    const { stdout } = await execFileAsync(env.espeakPath, ["-q", "--ipa", "-v", voice, "-f", f], {
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout.replace(/\s+/g, " ").trim();
  } finally {
    await fsp.rm(f, { force: true }).catch(() => undefined);
  }
}

// ---- Synthesis ------------------------------------------------------------

export interface SynthesizeResult {
  durationSec: number;
}

/**
 * Synthesize a full story to an MP3 at `outMp3Path`.
 *   - `text`: spoken content (English text, or Devanagari for Urdu/Hindustani).
 *   - `language`: "en" | "ur" (selects the voice + phonemization path).
 */
export async function synthesizeToMp3(
  text: string,
  language: string,
  outMp3Path: string,
): Promise<SynthesizeResult> {
  const chunks = chunkForTts(text);
  if (chunks.length === 0) throw new Error("Nothing to synthesize (empty text).");

  const tts = await getKokoro();
  const indic = isIndic(language);
  const voice = indic ? env.storyVoiceUr : env.storyVoiceEn;
  // Urdu text -> espeak Urdu voice (keeps Urdu sounds); Hindi text -> Hindi voice.
  const l = language.toLowerCase();
  const espeakVoice = l === "hi" || l.startsWith("hi-") ? "hi" : "ur";
  let sampleRate = 24000;
  const parts: Float32Array[] = [];

  for (let i = 0; i < chunks.length; i++) {
    let audio: { audio: Float32Array; sampling_rate: number };
    if (indic) {
      // espeak phonemes -> Kokoro tokenizer -> model (bypasses kokoro-js's
      // English-only phonemizer + voice-list validation).
      const ph = await espeakIpa(chunks[i], espeakVoice);
      if (!ph) continue;
      const { input_ids } = tts.tokenizer(ph, { truncation: true });
      audio = await tts.generate_from_ids(input_ids, { voice });
    } else {
      audio = await tts.generate(chunks[i], { voice });
    }
    sampleRate = audio.sampling_rate;
    parts.push(audio.audio, new Float32Array(Math.round(sampleRate * GAP_SECONDS)));
    if ((i + 1) % 10 === 0) log.info("TTS progress", { done: i + 1, total: chunks.length });
  }

  const merged = concat(parts);
  const tmpWav = path.join(os.tmpdir(), `vc-tts-${process.pid}-${chunks.length}.wav`);
  await fsp.writeFile(tmpWav, wavFromFloat32(merged, sampleRate));
  try {
    await wavToMp3(tmpWav, outMp3Path);
  } finally {
    await fsp.rm(tmpWav, { force: true }).catch(() => undefined);
  }

  const durationSec = merged.length / sampleRate;
  log.info("Synthesized voice-over", { engine: `kokoro:${voice}`, chunks: chunks.length, durationSec: Math.round(durationSec) });
  return { durationSec };
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

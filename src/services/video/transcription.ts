/**
 * Speech-to-text with word-level timestamps.
 *
 * Pluggable provider (TRANSCRIPTION_PROVIDER):
 *   - "openai": OpenAI Whisper API (verbose_json + word granularity). Long
 *     audio is chunked to stay under the 25MB upload limit; chunk timestamps
 *     are offset back to absolute video time.
 *   - "local":  a whisper.cpp-compatible CLI emitting JSON (offsets in ms).
 *   - "none":   returns null; clip detection falls back to uniform segmentation.
 *
 * The resulting transcript feeds both AI clip detection and caption timing.
 */
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { extractAudio, extractAudioMp3, extractPcmF32, probe } from "./ffmpeg";

const execFileAsync = promisify(execFile);
const log = createLogger("transcription");

export interface TranscriptWord {
  start: number;
  end: number;
  word: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  text: string;
  segments: TranscriptSegment[];
  words: TranscriptWord[];
  provider: string;
}

// Keep each Whisper API chunk well under the 25MB limit (~64kbps mono mp3).
const CHUNK_SECONDS = 20 * 60;

export async function transcribe(videoPath: string): Promise<Transcript | null> {
  const provider = env.transcriptionProvider;
  if (provider === "none") {
    log.warn("TRANSCRIPTION_PROVIDER=none; skipping transcription.");
    return null;
  }
  try {
    if (provider === "transformers") return await transcribeTransformers(videoPath);
    if (provider === "openai") return await transcribeOpenAI(videoPath);
    if (provider === "local") return await transcribeLocal(videoPath);
  } catch (err) {
    log.error("Transcription failed; continuing without transcript", {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  return null;
}

// --------------------------------------------------------------------------
// Local, in-process Whisper via @huggingface/transformers (ONNX).
// No Python, no external binary — the model is downloaded + cached on first run.
// --------------------------------------------------------------------------

// Cache the pipeline across jobs (model load is expensive).
let asrPipelinePromise: Promise<unknown> | null = null;

async function getAsrPipeline() {
  if (!asrPipelinePromise) {
    asrPipelinePromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      const model = env.transformersWhisperModel;
      const device = env.transformersDevice;
      const dtype = env.transformersDtype;
      log.info("Loading local Whisper model (first run downloads it)", { model, device, dtype });
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await pipeline("automatic-speech-recognition", model, { device, dtype } as any);
      } catch (err) {
        if (device !== "cpu") {
          log.warn(`Whisper failed on device "${device}"; falling back to CPU`, {
            message: err instanceof Error ? err.message : String(err),
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await pipeline("automatic-speech-recognition", model, { device: "cpu", dtype: "q8" } as any);
        }
        throw err;
      }
    })();
  }
  return asrPipelinePromise;
}

interface AsrChunk {
  text: string;
  timestamp: [number, number | null];
}

async function transcribeTransformers(videoPath: string): Promise<Transcript> {
  const audio = await extractPcmF32(videoPath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transcriber = (await getAsrPipeline()) as any;

  const output = await transcriber(audio, {
    return_timestamps: "word",
    chunk_length_s: 30,
    stride_length_s: 5,
  });

  const chunks: AsrChunk[] = output?.chunks ?? [];
  const words: TranscriptWord[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const word = c.text.trim();
    if (!word) continue;
    const start = c.timestamp[0] ?? 0;
    // The final word in a chunk can have a null end; estimate from the next.
    const end = c.timestamp[1] ?? chunks[i + 1]?.timestamp[0] ?? start + 0.4;
    words.push({ start, end: Math.max(end, start + 0.05), word });
  }

  return {
    text: (output?.text ?? words.map((w) => w.word).join(" ")).trim(),
    segments: groupWordsIntoSegments(words),
    words,
    provider: "transformers",
  };
}

/** Group word-level tokens into readable sentence-ish segments for the AI prompt. */
function groupWordsIntoSegments(words: TranscriptWord[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let buf: TranscriptWord[] = [];
  const flush = () => {
    if (!buf.length) return;
    segments.push({
      start: buf[0].start,
      end: buf[buf.length - 1].end,
      text: buf.map((w) => w.word).join(" "),
    });
    buf = [];
  };
  for (const w of words) {
    buf.push(w);
    const endsSentence = /[.!?]$/.test(w.word);
    const longGap = buf.length >= 14;
    if (endsSentence || longGap) flush();
  }
  flush();
  return segments;
}

// --------------------------------------------------------------------------
// OpenAI Whisper API
// --------------------------------------------------------------------------

async function transcribeOpenAI(videoPath: string): Promise<Transcript> {
  if (!env.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required for the openai transcription provider.");
  }
  const { durationSec } = await probe(videoPath);
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "vc-stt-"));

  try {
    const segments: TranscriptSegment[] = [];
    const words: TranscriptWord[] = [];
    let fullText = "";

    const chunkCount = Math.max(1, Math.ceil(durationSec / CHUNK_SECONDS));
    for (let i = 0; i < chunkCount; i++) {
      const offset = i * CHUNK_SECONDS;
      const dur = Math.min(CHUNK_SECONDS, durationSec - offset);
      if (dur <= 0) break;
      const chunkPath = path.join(tmpRoot, `chunk-${i}.mp3`);
      await extractAudioMp3(videoPath, chunkPath, offset, dur);

      log.info(`Transcribing chunk ${i + 1}/${chunkCount}`, { offset, dur });
      const result = await callWhisperApi(chunkPath);

      fullText += (fullText ? " " : "") + (result.text ?? "").trim();
      for (const s of result.segments ?? []) {
        segments.push({ start: s.start + offset, end: s.end + offset, text: s.text.trim() });
      }
      for (const w of result.words ?? []) {
        words.push({ start: w.start + offset, end: w.end + offset, word: w.word });
      }
    }

    return { text: fullText, segments, words, provider: "openai" };
  } finally {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
}

interface WhisperApiResponse {
  text?: string;
  segments?: { start: number; end: number; text: string }[];
  words?: { start: number; end: number; word: string }[];
}

async function callWhisperApi(audioPath: string): Promise<WhisperApiResponse> {
  const buffer = await fsp.readFile(audioPath);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/mpeg" }), path.basename(audioPath));
  form.append("model", env.openaiWhisperModel);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiApiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Whisper API error ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as WhisperApiResponse;
}

// --------------------------------------------------------------------------
// Local whisper.cpp CLI
// --------------------------------------------------------------------------

async function transcribeLocal(videoPath: string): Promise<Transcript> {
  if (!env.whisperCli || !env.whisperModel) {
    throw new Error("WHISPER_CLI and WHISPER_MODEL are required for the local provider.");
  }
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "vc-stt-"));
  try {
    const wavPath = path.join(tmpRoot, "audio.wav");
    await extractAudio(videoPath, wavPath);

    const outBase = path.join(tmpRoot, "out");
    // whisper.cpp: -oj writes JSON; --max-len 1 yields token/word-level segments.
    await execFileAsync(env.whisperCli, [
      "-m", env.whisperModel,
      "-f", wavPath,
      "-oj",
      "-of", outBase,
      "--max-len", "1",
    ]);

    const json = JSON.parse(await fsp.readFile(`${outBase}.json`, "utf8"));
    return parseWhisperCppJson(json);
  } finally {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
}

interface WhisperCppJson {
  transcription?: {
    offsets?: { from: number; to: number };
    text: string;
  }[];
}

function parseWhisperCppJson(json: WhisperCppJson): Transcript {
  const segments: TranscriptSegment[] = [];
  const words: TranscriptWord[] = [];
  let text = "";

  for (const item of json.transcription ?? []) {
    const start = (item.offsets?.from ?? 0) / 1000;
    const end = (item.offsets?.to ?? 0) / 1000;
    const t = item.text.trim();
    if (!t) continue;
    text += (text ? " " : "") + t;
    segments.push({ start, end, text: t });
    // With --max-len 1 each segment is roughly one word.
    words.push({ start, end, word: t });
  }
  return { text, segments, words, provider: "local" };
}

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
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { romanizeDevanagari } from "@/services/captions/romanize";
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

export async function transcribe(videoPath: string, language?: string): Promise<Transcript | null> {
  const provider = env.transcriptionProvider;
  if (provider === "none") {
    log.warn("TRANSCRIPTION_PROVIDER=none; skipping transcription.");
    return null;
  }
  try {
    if (provider === "groq") return await transcribeGroq(videoPath, language);
    if (provider === "transformers") return await transcribeTransformers(videoPath);
    if (provider === "openai") return await transcribeOpenAI(videoPath);
    if (provider === "local") return await transcribeLocal(videoPath, language);
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

/**
 * Transcribe with the local Whisper (transformers/ONNX) model, but run the
 * actual inference in an ISOLATED child process. The DirectML/CUDA GPU
 * backends can crash onnxruntime natively (segfault) — which no try/catch can
 * recover from — so isolating it means a crash or a hang only fails this one
 * job (and we fall back to CPU, then to no-transcript) instead of taking down
 * the whole worker. Returns null if every attempt fails.
 */
async function transcribeTransformers(videoPath: string): Promise<Transcript | null> {
  // 1. Try the configured device (may be the GPU) in a subprocess.
  let transcript = await transcribeViaSubprocess(videoPath, null);
  if (transcript) return transcript;

  // 2. If that crashed/timed out and it wasn't already CPU, retry on CPU —
  //    slower, but stable.
  if (env.transformersDevice !== "cpu") {
    log.warn("GPU transcription subprocess failed; retrying on CPU (slower but stable).");
    transcript = await transcribeViaSubprocess(videoPath, {
      TRANSFORMERS_DEVICE: "cpu",
      TRANSFORMERS_DTYPE: "q8",
    });
    if (transcript) return transcript;
  }

  log.error("All transcription attempts failed; continuing without a transcript.");
  return null;
}

/**
 * Spawn `node --import tsx transcribe-runner.ts <video> <out>` and wait for it,
 * enforcing a hard timeout (the child is SIGKILLed if exceeded). Any non-zero
 * exit, spawn error, timeout, or unreadable output resolves to null.
 */
function transcribeViaSubprocess(
  videoPath: string,
  envOverride: Record<string, string> | null,
): Promise<Transcript | null> {
  const outPath = path.join(os.tmpdir(), `vc-transcript-${Date.now()}-${process.pid}.json`);
  const runner = path.resolve(process.cwd(), "src/services/video/transcribe-runner.ts");
  const timeoutMs = env.transcribeTimeoutMs;

  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", runner, videoPath, outPath], {
      env: { ...process.env, ...(envOverride ?? {}) },
      stdio: ["ignore", "inherit", "inherit"],
    });

    let settled = false;
    const finish = async (result: Transcript | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await fsp.rm(outPath, { force: true }).catch(() => undefined);
      resolve(result);
    };

    const timer = setTimeout(() => {
      log.error("Transcription timed out; terminating subprocess", { timeoutMs });
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      void finish(null);
    }, timeoutMs);

    child.on("error", (err) => {
      log.error("Failed to spawn transcription subprocess", { message: err.message });
      void finish(null);
    });

    child.on("exit", async (code, signal) => {
      if (settled) return;
      if (code === 0) {
        try {
          const raw = await fsp.readFile(outPath, "utf8");
          const parsed = JSON.parse(raw) as Transcript | null;
          void finish(parsed && parsed.words?.length ? parsed : null);
          return;
        } catch (err) {
          log.error("Transcription output unreadable", {
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        log.error("Transcription subprocess crashed/failed", { code, signal });
      }
      void finish(null);
    });
  });
}

/**
 * The actual in-process ONNX inference. Exported so the isolated runner
 * (transcribe-runner.ts) can call it directly without re-spawning.
 */
export async function runTransformersInProcess(videoPath: string): Promise<Transcript> {
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
    const start = c.timestamp?.[0] ?? 0;
    // The final word in a chunk can have a null end; estimate from the next.
    // Optional-chain every hop: a chunk may arrive with a missing timestamp.
    const end = c.timestamp?.[1] ?? chunks[i + 1]?.timestamp?.[0] ?? start + 0.4;
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
// Groq Speech-to-Text API (OpenAI-compatible; whisper-large-v3-turbo).
// Extremely fast (~228x realtime) + cheap. Long audio is chunked under Groq's
// file-size limit, chunks are transcribed concurrently with per-chunk retry,
// then merged back with offset timestamps + de-dup at chunk boundaries. Output
// is the SAME internal Transcript shape as every other provider.
// --------------------------------------------------------------------------

const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_PRICE_PER_HOUR = 0.04; // whisper-large-v3-turbo, USD per audio-hour.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `fn` over `items` with at most `limit` in flight; preserves index order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface GroqError extends Error {
  status?: number;
  retryable?: boolean;
  retryAfterMs?: number;
}

/** One Groq transcription request for a single audio file (a chunk or the whole clip). */
async function callGroqApi(audioPath: string, language?: string): Promise<WhisperApiResponse & { language?: string }> {
  const buffer = await fsp.readFile(audioPath);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/mpeg" }), path.basename(audioPath));
  form.append("model", env.groqSttModel);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  form.append("temperature", "0");
  // Omit `language` for auto-detection (equivalent to whisper.cpp `-l auto`).
  if (language) form.append("language", language);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), env.groqRequestTimeoutMs);
  let res: Response;
  try {
    res = await fetch(GROQ_STT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.groqApiKey}` }, // key never logged
      body: form,
      signal: ctrl.signal,
    });
  } catch (err) {
    const e = new Error(`Groq request failed: ${(err as Error).message}`) as GroqError;
    e.retryable = true; // network error / abort (timeout) → retry
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const e = new Error(`Groq API error ${res.status}: ${body.slice(0, 200)}`) as GroqError;
    e.status = res.status;
    e.retryable = res.status === 429 || res.status >= 500;
    const ra = res.headers.get("retry-after");
    if (ra) {
      const s = Number(ra);
      if (Number.isFinite(s)) e.retryAfterMs = s * 1000;
    }
    throw e;
  }
  return (await res.json()) as WhisperApiResponse & { language?: string };
}

/** callGroqApi with exponential backoff on 429 / 5xx / network — one chunk's failure never restarts the whole video. */
async function callGroqApiWithRetry(audioPath: string, language?: string) {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= env.groqMaxRetries; attempt++) {
    try {
      return await callGroqApi(audioPath, language);
    } catch (err) {
      lastErr = err;
      const e = err as GroqError;
      if (e.retryable === false || attempt === env.groqMaxRetries) break;
      const backoff = e.retryAfterMs ?? Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
      log.warn("Groq chunk failed; retrying", { attempt: attempt + 1, backoffMs: backoff, status: e.status });
      await sleep(backoff);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function transcribeGroq(videoPath: string, language?: string): Promise<Transcript> {
  if (!env.groqApiKey) {
    throw new Error("GROQ_API_KEY is required for the groq transcription provider (get one at https://console.groq.com/keys).");
  }
  const started = Date.now();
  // Per-video language wins; "auto" → omit param so Whisper detects it. "hi-Latn"
  // (Hinglish) is transcribed as Hindi then romanized, matching the local path.
  const requested = language || env.whisperLanguage || "auto";
  const romanize = requested === "hi-Latn";
  const langParam = romanize ? "hi" : requested === "auto" ? undefined : requested;

  const { durationSec } = await probe(videoPath);
  const chunkLen = env.groqChunkSeconds;
  const overlap = env.groqChunkOverlapSeconds;
  const chunkCount = Math.max(1, Math.ceil(durationSec / chunkLen));
  const chunks = Array.from({ length: chunkCount }, (_, i) => {
    const regionStart = i * chunkLen; // this chunk "owns" words starting in [regionStart, regionEnd)
    const regionEnd = Math.min((i + 1) * chunkLen, durationSec);
    const isLast = i === chunkCount - 1;
    // Extract slightly past the boundary (except the last) so a word straddling
    // the cut is fully transcribed by whichever chunk owns its start.
    const extractDur = Math.min(chunkLen + (isLast ? 0 : overlap), durationSec - regionStart);
    return { i, regionStart, regionEnd, extractDur, isLast };
  });

  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "vc-groq-"));
  try {
    // Phase 1 — prepare chunk audio (parallel). ffmpeg → mono mp3; Groq downsamples to 16kHz.
    const prep0 = Date.now();
    const prepared = await mapWithConcurrency(chunks, env.groqConcurrency, async (c) => {
      const chunkPath = path.join(tmpRoot, `chunk-${c.i}.mp3`);
      await extractAudioMp3(videoPath, chunkPath, c.regionStart, c.extractDur);
      return { c, chunkPath };
    });
    const prepMs = Date.now() - prep0;

    // Phase 2 — transcribe chunks (parallel, retrying each independently).
    const api0 = Date.now();
    const transcribed = await mapWithConcurrency(prepared, env.groqConcurrency, async ({ c, chunkPath }) => {
      const resp = await callGroqApiWithRetry(chunkPath, langParam);
      return { c, resp };
    });
    const apiMs = Date.now() - api0;

    // Phase 3 — merge in order, offset timestamps, de-dup by owned region.
    const merge0 = Date.now();
    const words: TranscriptWord[] = [];
    let detectedLang = "";
    for (const { c, resp } of transcribed.slice().sort((a, b) => a.c.i - b.c.i)) {
      if (!detectedLang && resp.language) detectedLang = resp.language;
      for (const w of resp.words ?? []) {
        const start = w.start + c.regionStart;
        // A word belongs to exactly one chunk: the one whose owned region holds its start.
        if (!c.isLast && start >= c.regionEnd) continue;
        const word = (w.word ?? "").trim();
        if (!word) continue;
        words.push({ start, end: Math.max(w.end + c.regionStart, start + 0.05), word });
      }
    }
    words.sort((a, b) => a.start - b.start);
    let transcript: Transcript = {
      text: words.map((w) => w.word).join(" "),
      segments: groupWordsIntoSegments(words),
      words,
      provider: "groq",
    };
    if (romanize) transcript = romanizeTranscript(transcript);
    const mergeMs = Date.now() - merge0;

    const totalSec = (Date.now() - started) / 1000;
    const rtf = durationSec > 0 ? totalSec / durationSec : 0;
    log.info("Groq transcription complete", {
      model: env.groqSttModel,
      audioPrepSec: +(prepMs / 1000).toFixed(1),
      apiSec: +(apiMs / 1000).toFixed(1),
      parseMergeSec: +(mergeMs / 1000).toFixed(2),
      totalSec: +totalSec.toFixed(1),
      audioMinutes: +(durationSec / 60).toFixed(1),
      realTimeFactor: +rtf.toFixed(3),
      chunks: chunkCount,
      words: words.length,
      detectedLanguage: detectedLang || langParam || "auto",
      approxCostUsd: +((durationSec / 3600) * GROQ_PRICE_PER_HOUR).toFixed(4),
    });
    if (!words.length) throw new Error("Groq returned no words (empty/invalid response).");
    return transcript;
  } finally {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// Local whisper.cpp CLI
// --------------------------------------------------------------------------

async function transcribeLocal(videoPath: string, language?: string): Promise<Transcript> {
  if (!env.whisperCli || !env.whisperModel) {
    throw new Error("WHISPER_CLI and WHISPER_MODEL are required for the local provider.");
  }
  // Per-video language wins over the global default; "auto" lets whisper detect.
  const requested = language || env.whisperLanguage || "auto";
  // "Hinglish": transcribe the Hindustani speech as Hindi (Devanagari), then
  // romanize the result to casual Latin ("kahani suno").
  const romanize = requested === "hi-Latn";
  const lang = romanize ? "hi" : requested;
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "vc-stt-"));
  try {
    const wavPath = path.join(tmpRoot, "audio.wav");
    await extractAudio(videoPath, wavPath);

    const outBase = path.join(tmpRoot, "out");
    // whisper.cpp: -oj writes JSON. --max-len 1 + --split-on-word yields ONE
    // WHOLE WORD per segment. -sow is essential: without it Urdu/Arabic split
    // into sub-word tokens that, joined with spaces, break letter-joining.
    // -l sets the language ("auto" detects it — needs a multilingual model).
    // Hard timeout so a stuck CLI can't hang the job; killed on overrun.
    await execFileAsync(
      env.whisperCli,
      [
        "-m", env.whisperModel,
        "-f", wavPath,
        "-l", lang,
        "-oj",
        "-of", outBase,
        "--max-len", "1",
        "--split-on-word",
      ],
      { timeout: env.transcribeTimeoutMs, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 * 64 },
    );

    const raw = await fsp.readFile(`${outBase}.json`, "utf8");
    let json: WhisperCppJson;
    try {
      json = JSON.parse(raw) as WhisperCppJson;
    } catch {
      throw new Error("whisper.cpp produced invalid/partial JSON output.");
    }
    const transcript = parseWhisperCppJson(json);
    return romanize ? romanizeTranscript(transcript) : transcript;
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

/** Romanize every text field of a transcript (Devanagari → Latin "Hinglish"). */
function romanizeTranscript(t: Transcript): Transcript {
  return {
    ...t,
    text: romanizeDevanagari(t.text),
    segments: t.segments.map((s) => ({ ...s, text: romanizeDevanagari(s.text) })),
    words: t.words.map((w) => ({ ...w, word: romanizeDevanagari(w.word) })),
  };
}

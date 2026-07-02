/**
 * Centralized, validated environment configuration.
 *
 * Anything that reads `process.env` directly should go through here so we get
 * a single source of truth and fail fast on misconfiguration. Validation is
 * lazy + lenient: the app boots even if optional integrations are unset, but
 * the features that need them will report a clear error at use time.
 */
import path from "node:path";

function required(name: string, value: string | undefined): string {
  // Never throw at import time — that would break `next build` (which imports
  // modules with NODE_ENV=production). Missing critical config surfaces as a
  // clear runtime error at the point of use (e.g. Prisma on the first query).
  if (!value || value.trim() === "") {
    console.warn(`[env] Missing ${name}; the feature that needs it will fail until set.`);
    return "";
  }
  return value;
}

/**
 * Parse a positive-integer env var, falling back to `fallback` for anything
 * missing, non-numeric, NaN, or <= 0. This prevents a mistyped var (e.g.
 * "15min") from producing NaN — which would make setTimeout fire immediately
 * or wedge worker concurrency at 0/NaN.
 */
function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || "./storage");

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProd: process.env.NODE_ENV === "production",
  appUrl: process.env.APP_URL || "http://localhost:3000",

  databaseUrl: required("DATABASE_URL", process.env.DATABASE_URL),
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",

  authSecret: required("AUTH_SECRET", process.env.AUTH_SECRET) || "dev-insecure-secret-change-me",
  authSessionDays: int(process.env.AUTH_SESSION_DAYS, 30),

  encryptionKey: process.env.ENCRYPTION_KEY || "",

  storageDir: STORAGE_DIR,
  mediaPublicBase: process.env.MEDIA_PUBLIC_BASE || "",

  ffmpegPath: process.env.FFMPEG_PATH || "",
  ffprobePath: process.env.FFPROBE_PATH || "",
  ytdlpPath: process.env.YTDLP_PATH || "",
  // H.264 encoder for clip rendering: "h264_nvenc" (NVIDIA GPU) or "libx264"
  // (CPU). Falls back to libx264 automatically if the GPU encoder fails.
  ffmpegVideoEncoder: process.env.FFMPEG_VIDEO_ENCODER || "libx264",
  // Font used to burn the "Part N" title into clips (drawtext). Defaults to
  // Windows Arial Bold; override with FONT_FILE.
  fontFile: process.env.FONT_FILE || "C:/Windows/Fonts/arialbd.ttf",

  // AI clip detection provider: "ollama" (local, free) or "anthropic" (cloud).
  aiProvider: (process.env.AI_PROVIDER || "ollama") as "ollama" | "anthropic",

  // Local LLM via Ollama (https://ollama.com).
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    model: process.env.OLLAMA_MODEL || "llama3.1",
    // Context window the model is told to use. Local models default tiny
    // (2-4k); raise this so long transcripts aren't truncated.
    numCtx: int(process.env.OLLAMA_NUM_CTX, 8192),
  },

  // Cloud fallback (optional, paid).
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",

  // Transcription provider:
  //   transformers -> local Whisper via @huggingface/transformers (default, free)
  //   local        -> local whisper.cpp CLI
  //   openai       -> OpenAI Whisper API (paid)
  //   none         -> skip transcription
  transcriptionProvider: (process.env.TRANSCRIPTION_PROVIDER || "transformers") as
    | "transformers"
    | "local"
    | "openai"
    | "none",
  // Local in-process Whisper model (auto-downloaded + cached on first use).
  transformersWhisperModel: process.env.TRANSFORMERS_WHISPER_MODEL || "Xenova/whisper-base.en",
  // Execution device for local Whisper: cpu | dml (DirectML GPU) | cuda | webgpu.
  // dml uses the GPU on Windows via DirectX 12. Falls back to cpu on failure.
  transformersDevice: process.env.TRANSFORMERS_DEVICE || "cpu",
  // Numeric precision: q8 (fast, cpu) | fp32 | fp16 (gpu).
  transformersDtype: process.env.TRANSFORMERS_DTYPE || "q8",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiWhisperModel: process.env.OPENAI_WHISPER_MODEL || "whisper-1",
  whisperCli: process.env.WHISPER_CLI || "",
  whisperModel: process.env.WHISPER_MODEL || "",

  videoWorkerConcurrency: int(process.env.VIDEO_WORKER_CONCURRENCY, 1),
  publishWorkerConcurrency: int(process.env.PUBLISH_WORKER_CONCURRENCY, 2),
  // How many clips to render in parallel within one video job (CPU + GPU bound).
  clipRenderConcurrency: int(process.env.CLIP_RENDER_CONCURRENCY, 3),

  // --- Safety limits: terminate runaway/stuck work so it can't peg the CPU/GPU
  //     or hang forever. All in milliseconds. ---
  // Max time for a single clip render before its ffmpeg process is killed.
  renderTimeoutMs: int(process.env.RENDER_TIMEOUT_MS, 15 * 60 * 1000),
  // Max time for the (isolated) transcription subprocess before it's killed.
  transcribeTimeoutMs: int(process.env.TRANSCRIBE_TIMEOUT_MS, 20 * 60 * 1000),
  // A video left in a processing state longer than this (no worker touching it,
  // e.g. after a crash) is marked FAILED by the reaper so it stops spinning.
  staleJobMs: int(process.env.STALE_JOB_MS, 30 * 60 * 1000),
  // Max clip renders to run at once on the GPU (NVENC) — a hard cap so many
  // parallel encodes can't overload the GPU/driver.
  gpuRenderConcurrencyCap: int(process.env.GPU_RENDER_CONCURRENCY_CAP, 2),
  // Reject uploads larger than this many bytes (protects disk/memory).
  maxUploadBytes: int(process.env.MAX_UPLOAD_BYTES, 3 * 1024 * 1024 * 1024),
  // Max time for a yt-dlp download/metadata call before the process is killed.
  downloadTimeoutMs: int(process.env.DOWNLOAD_TIMEOUT_MS, 30 * 60 * 1000),
  // Max time to wait on the AI clip-detection call (Ollama) before aborting →
  // falls back to plain segmentation instead of hanging the job.
  aiTimeoutMs: int(process.env.AI_TIMEOUT_MS, 5 * 60 * 1000),

  social: {
    youtube: {
      clientId: process.env.YOUTUBE_CLIENT_ID || "",
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET || "",
    },
    tiktok: {
      clientKey: process.env.TIKTOK_CLIENT_KEY || "",
      clientSecret: process.env.TIKTOK_CLIENT_SECRET || "",
    },
    // Instagram API with Instagram Login — distinct credentials from the
    // Facebook app (dashboard → Instagram product → "API setup with Instagram
    // login"). Used by instagram.ts. Facebook Reels still uses meta.* below.
    instagram: {
      appId: process.env.INSTAGRAM_APP_ID || "",
      appSecret: process.env.INSTAGRAM_APP_SECRET || "",
    },
    meta: {
      appId: process.env.META_APP_ID || "",
      appSecret: process.env.META_APP_SECRET || "",
    },
  },
} as const;

export function oauthRedirectUri(platform: string): string {
  return `${env.appUrl}/api/social/callback/${platform}`;
}

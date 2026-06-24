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

const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || "./storage");

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProd: process.env.NODE_ENV === "production",
  appUrl: process.env.APP_URL || "http://localhost:3000",

  databaseUrl: required("DATABASE_URL", process.env.DATABASE_URL),
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",

  authSecret: required("AUTH_SECRET", process.env.AUTH_SECRET) || "dev-insecure-secret-change-me",
  authSessionDays: Number(process.env.AUTH_SESSION_DAYS || 30),

  encryptionKey: process.env.ENCRYPTION_KEY || "",

  storageDir: STORAGE_DIR,
  mediaPublicBase: process.env.MEDIA_PUBLIC_BASE || "",

  ffmpegPath: process.env.FFMPEG_PATH || "",
  ffprobePath: process.env.FFPROBE_PATH || "",
  ytdlpPath: process.env.YTDLP_PATH || "",

  // AI clip detection provider: "ollama" (local, free) or "anthropic" (cloud).
  aiProvider: (process.env.AI_PROVIDER || "ollama") as "ollama" | "anthropic",

  // Local LLM via Ollama (https://ollama.com).
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    model: process.env.OLLAMA_MODEL || "llama3.1",
    // Context window the model is told to use. Local models default tiny
    // (2-4k); raise this so long transcripts aren't truncated.
    numCtx: Number(process.env.OLLAMA_NUM_CTX || 8192),
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

  videoWorkerConcurrency: Number(process.env.VIDEO_WORKER_CONCURRENCY || 1),
  publishWorkerConcurrency: Number(process.env.PUBLISH_WORKER_CONCURRENCY || 2),

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

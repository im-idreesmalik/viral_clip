# ViralCut — Project Brief & Build Log

_Last updated: July 2026_

A self-hosted web app that (1) turns long-form videos into vertical **9:16 short clips**
for TikTok / Reels / Shorts / YouTube and publishes them, and (2) runs an **AI Stories**
engine that writes narrated fiction, generates local voice-overs, and lets users spin those
into videos. **Every AI component runs locally / free** wherever possible; where a hosted
model is optional it's clearly gated behind an env flag.

---

## 1. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15.5 (App Router), React 19, TypeScript (strict, ES2022, `@/*`→`src/*`) |
| Database | PostgreSQL 16 + Prisma 6 (Docker `viralcut-postgres`) |
| Queue / jobs | Redis 7 + BullMQ (Docker `viralcut-redis`); a separate long-running **worker** process |
| Auth | Custom JWT (jose HS256, httpOnly cookie `vc_session`), bcryptjs (cost 12); login by **email OR name** |
| Media | FFmpeg (fluent-ffmpeg + ffmpeg-static); **h264_nvenc** GPU encode → **libx264** auto-fallback; libass `.ass` burn-in subtitles |
| Transcription (STT) | **whisper.cpp CUDA** (`ggml-large-v3.bin`) in an isolated subprocess; alt: transformers.js ONNX / OpenAI Whisper API |
| AI text (LLM) | Local **Ollama** — live model **`gemma3:12b-it-qat`**; optional Anthropic Claude (`claude-opus-4-8`) via `AI_PROVIDER=anthropic` |
| Voice-over (TTS) | **Kokoro-82M** (`onnx-community/Kokoro-82M-v1.0-ONNX`, kokoro-js) + **espeak-ng** for authentic Urdu/Hindi phonemes |
| Background music | Local text-to-music: **Stable Audio Open** (commercial-safe, default) or **MusicGen** (non-commercial); Python subprocess, GPU (cu128) |
| GPU | NVIDIA **RTX 5080** (Blackwell, sm_120); CUDA 12.8. Drives NVENC, whisper.cpp, Ollama, and Stable Audio (torch `2.11.0+cu128`) |
| Theme | Light "Obsidian Kinetic Light" (inverted `ink` scale, brand purple `#7c5cff`, cyan accent `#22d3ee`) |
| Public hosting | Local machine + **Cloudflare tunnel** → `viralcut.idreesmalik.com` (`start.ps1` / `stop.ps1`) |

---

## 2. Core video pipeline

YouTube URL **or** file upload **or** an AI-Story voice-over → **download/finalize** (yt-dlp, H.264-preferred ladder) →
`ffprobe` → **transcribe** (word-level) → **clip selection** (AI "viral moments" above a
threshold, **or** full-video split into "Part 1/2/…") → **render** each clip to 1080×1920
(blurred-fill background, burned captions, **@username watermark**, "Part N" + optional
short-title overlay, ducked background-music bed) → review/approve → **publish** to
YouTube / TikTok / Instagram / Facebook (OAuth), with scheduling, sequential "Publish All"
drip batches, and auto-retry.

- **Blurred-fill 9:16 look**, built cheaply: cover-scale the background to a tiny 360×640,
  `boxblur=14:1` there, upscale to 1080×1920 (~9× less blur work/frame); original
  contain-scaled and centered on top. Output: `-r 30`, `yuv420p`, `profile high`,
  `+faststart`, AAC 128k.
- **Generic footage library** — superuser uploads stock clips (auto-transcoded to 1080×1920);
  `GENERIC` footage mode swaps visuals while keeping original audio. Used for FULL B-roll and
  for **audio-only AI Story** videos (a solid `0x0b0b12` bg is synthesized if no stock exists).
- **Auto-hashtags** — 10 defaults (`#shorts #reels #fyp #foryou #viral #trending #explore
  #follow #subscribe #video`) merged + deduped (case-insensitive) with per-video tags.
- **VIRAL detection**: transcript → Ollama/Claude with a **JSON-schema structured-output
  constraint** + zod validation; clips clamped 15–60s, scored 0–100, threshold-filtered,
  de-overlapped (>0.5 overlap dropped), capped at `targetClipCount`. **FULL mode**: sequential
  cuts snapped to sentence boundaries (guarded by `FULL_MODE_MAX_PARTS=500`).

---

## 3. Subtitles / captions

- **Styles** (`CAPTION_STYLES` in `subtitles.ts`): Classic, **Bold** (Impact, fs120), Bold
  **Yellow**, Bold **Green**, **Boxed** (opaque box), plus interactive **Karaoke** (word-by-word
  highlight synced to speech) and **Pop** (fade + scale-in). Client mirror in
  `lib/caption-styles.ts` + a live `CaptionPreview.tsx` (server `subtitles.ts` can't be bundled
  client-side — it imports ffmpeg).
- **Karaoke auto-wrap fix** — libass **silently drops** `\kf`/`\k` timing on any line that
  auto-wraps. `packKaraokeLines()` greedily packs words into explicit ≤`KARAOKE_CHARS_PER_LINE`
  (13-char) lines joined with manual `\N` breaks, `WrapStyle: 0`.
- **RTL fix (Urdu/Arabic)** — karaoke uses instant `\k` (not the always-left-to-right `\kf`
  sweep) so the highlight runs right→left correctly.
- **Non-Latin fonts** (bundled in `tools/fonts`, loaded via libass `:fontsdir=`): **Noto Naskh
  Arabic** (Urdu/Arabic — Nastaliq deliberately avoided, too complex for libass → tofu), **Noto
  Sans Devanagari** (Hindi). Latin uses Arial (uppercased); Impact swaps in only for `bold`.
- **Whisper word timing** — whisper.cpp run with `--max-len 1 --split-on-word` so each segment
  is one **whole word** (critical: without `-sow`, Urdu/Arabic split into sub-word tokens that
  break letter-joining).
- **Windows filtergraph path fix** — the drive-letter colon is a filter option separator even
  inside quotes, so subtitle/font paths are passed **relative to cwd**; the `.ass` is written
  under `STORAGE_DIR` (same drive) so a clean relative path exists.
- **Languages** — per-video selector incl. **Hinglish** (`hi-Latn`: transcribe as Hindi →
  `romanizeDevanagari()` to loose Latin, e.g. "kahani suno") and **Urdu** (native script + Urdu voice).

---

## 4. AI Stories

- **User tab** to listen to narrated stories and turn one into a video.
- **Generation** (`AI_PROVIDER=ollama` by default): local Ollama writes 3–15 min (default ~9)
  curiosity/mystery stories. Local models truncate long structured output, so the Ollama path
  uses a plain-text `TITLE:/VIRAL:/body` format + a **continuation loop** (re-prompts "continue
  seamlessly" until ~word target, ≤5 rounds). **Ollama must stream** (`stream:true`) — otherwise
  headers arrive only after the whole minutes-long answer, blowing undici's header timeout. Each
  story gets an AI **viral score (0–100)**.
- **Voice-over (Kokoro, local/free):** English = `af_heart`; **Urdu = `hf_alpha`** driven by
  **espeak `-v ur`** IPA phonemes generated from the **Arabic-script text directly** — authentic
  Urdu, **not** Hindi, **no Devanagari conversion** (that path was removed). espeak text is passed
  via a **UTF-8 temp file** (Windows mangles non-Latin CLI args). Chunked at 240 chars, 0.28s
  gaps, encoded to 128k mono mp3.
- **Storage** — text + mp3 stored so playback never regenerates; word-level transcript cached and
  reused as caption timing when a video is generated.
- **Super Admin management** — generate by topic/language/duration, paste text (auto voice-over),
  upload text/voice, edit/delete, regenerate audio.
- **Granular status** — DRAFT → QUEUED → Writing… → Narrating… → READY / FAILED (live UI polling).
- **Claiming** — generating a video atomically flips READY→CLAIMED (`updateMany` guard; 409 if
  someone just claimed it); the mp3 is copied into the video's own storage so it survives story
  deletion; claim rolls back on failure.

---

## 5. Background music (local, commercial-safe)

- **Shared library** each user can **claim one track exclusively** (it disappears from others'
  lists); the claimed track is looped and **mixed ducked under that user's clips** for a unique
  sonic signature. Per-user enable toggle (`backgroundMusicEnabled`).
- **Local AI generation** (admin "Generate with AI"): a Python subprocess runs a text-to-music
  model; the wav is loudnorm'd (`I=-16`) and stored as a 160k stereo mp3. Two backends via
  `MUSIC_BACKEND`:
  - **`stable-audio`** (default) — **Stable Audio Open** (`stabilityai/stable-audio-open-1.0`).
    Chosen because its Stability Community License **permits commercial use for creators under
    $1M/yr revenue**. **Gated** on Hugging Face → one-time license accept + `HF_TOKEN`. Up to ~45s.
  - **`musicgen`** — Meta MusicGen. **CC-BY-NC (non-commercial only)** — kept for non-monetized use.
- **GPU required in practice** — Stable Audio is a diffusion model: ~90s/track on the RTX 5080
  (torch `2.11.0+cu128`) vs 30–60 min on CPU. Scripts auto-fall-back to CPU if no CUDA.
- **Mixing** — static duck (not sidechain): `[0:a]loudnorm[voice];[music]volume=0.15,afade[bed];
  amix=inputs=2:duration=first:normalize=0`. Bed gain is **env-tunable** (`MUSIC_MIX_VOLUME`,
  default **0.15** ≈ 16 dB under the voice; `MUSIC_MIX_VOLUME_SOLO` 0.45 when a clip has no speech).
- **Retry/orphan bug fix** — a failed generation must **not** delete its `BackgroundMusic` row
  (a pending row has `storageKey=""`; BullMQ retries the job, and a deleted row makes every retry
  fail "record not found"). Final cleanup (`cleanupFailedMusicRow`, idempotent, scoped to
  `storageKey=""`, also removes any orphan mp3) runs in the worker's `failed` handler only once
  `attemptsMade >= opts.attempts`.

---

## 6. Publishing

- **OAuth connect** for YouTube (Data API v3), TikTok (Content Posting + Login Kit v2, PKCE),
  Instagram (Instagram Login business, Reels), Facebook (Graph video_reels 3-phase). Tokens
  stored **AES-256-GCM encrypted at rest** (`ENCRYPTION_KEY`; format `base64(iv|tag|ct)`); OAuth
  `state` CSRF cookie (10-min TTL). Graph API pinned to **v21.0**.
- **Provider registry** (`services/social/`) behind a `SocialProvider` interface
  (`getAuthorizationUrl` / `handleCallback` / `refresh?` / `publish`); `PublishError.retryable`
  drives retry-vs-terminal handling.
- **Signed media URLs** — HMAC-SHA256, 6-h TTL (`AUTH_SECRET`) so IG/FB **server-side pull-upload**
  can fetch media cookieless; the `/api/media` route also does HTTP range/206 for scrubbing and
  returns **404 (not 401)** on unauth to avoid leaking key existence.
- **Publish All** = sequential drip: one batch (`batchId`/`batchSeq`/`batchIntervalMin`) per
  platform; only the first clip is QUEUED, the rest SCHEDULED; the publisher chains the next after
  the previous succeeds (a failure pauses the batch until retried).
- **Auto-publish scheduler** — per-user `AutoPublishConfig` (interval + daily window, wraps
  midnight) enqueues the next approved/unpublished clip per platform.

---

## 7. Reliability / infrastructure

- **Isolated transcription subprocess** (`transcribe-runner.ts`, `node --import tsx`) — a native
  onnxruntime GPU segfault (uncatchable) only fails one job; parent falls back GPU→CPU→no-transcript.
- **Hard timeouts + SIGKILL** on every ffmpeg/yt-dlp/transcribe/LLM/music call (render 15m,
  transcribe 20m, download 30m, AI 5m, story-gen 15m, music 30m).
- **Stale-job reaper** (60s tick) — fails a Video only if it's past `STALE_JOB_MS` (30m) **and no
  clip advanced** in the window (so a long-but-active multi-clip render isn't false-failed); also
  fails clips stuck RENDERING.
- **Resume** — a retried video re-renders only the not-yet-READY clips (keeps finished ones);
  reprocess deletes clips first (re-detects) and drops the cached transcript so a language change
  re-transcribes.
- **yt-dlp** invoked directly via `execFile` (not the shell wrapper — cmd.exe mishandles `<` in
  the format selector); `--no-part` (avoids the `.part`→final rename AV blocks → WinError 32),
  H.264-preferred ladder (avoids costly AV1), stale-partial cleanup, retries.
- **BullMQ dedupe fixes** — `enqueueProcessVideo` uses **no fixed jobId** (a lingering completed
  job would suppress reprocess); `enqueuePublish` removes any stale `publish-<id>` job before
  re-adding so retry actually re-runs.
- **Publish auto-retry** (60s tick) — a FAILED batch publication older than 5 min with
  `attempts < 5` is reset to QUEUED so one transient failure can't stall the drip.
- **Worker keep-alive** — `unhandledRejection`/`uncaughtException` handlers log and keep the
  process alive (Node ≥15 would otherwise kill all in-flight jobs); graceful SIGINT/SIGTERM.
- The full stack runs **in-session** (Docker Postgres/Redis + Ollama + `next dev` + worker +
  tunnel). `start.ps1` is a one-click launcher; no supervisor / always-on host (acknowledged gap).

---

## 8. Data model (Prisma) — 9 models, 9 enums

- **User** — email (unique), `name` (unique, doubles as login identifier), `handle` (@watermark),
  passwordHash, `backgroundMusicId?`, `backgroundMusicEnabled`.
- **BackgroundMusic** — title, mood?, `source` (GENERATED|UPLOAD), storageKey (`""` = generating),
  durationSec?, exclusive claim (`claimedById`/`claimedAt`, onDelete SetNull).
- **Video** — clipMode, viralThreshold, segmentSeconds, targetClipCount, burnCaptions,
  captionStyle, shortTitle/showShortTitle, language, footageMode, transcript (JSON), status,
  hashtags, source metadata.
- **Clip** — startSec/endSec, viralScore?, reason, order (Part N), status, storageKey, captionsKey,
  captionText.
- **SocialAccount** — platform, externalId, `accessTokenEnc`/`refreshTokenEnc` (encrypted), meta JSON.
- **Publication / PublicationLog** — status, publishAt, externalPostId/Url, attempts, batch fields,
  autoScheduled, per-post logs.
- **AutoPublishConfig** — per-user auto-publish schedule (interval, platforms[], daily window).
- **Story** — language, `status` (DRAFT/QUEUED/WRITING/NARRATING/GENERATING/READY/CLAIMED/FAILED),
  `viralScore`, `text` (@db.Text), `ttsText` (@db.Text, now unused — Urdu is spoken from `text`
  directly), audioKey, durationSec, voice, transcript (JSON), claim fields, generatedVideoId.

> **Migration note:** `BackgroundMusic`, `User.backgroundMusic*`, `Story.viralScore`, and the
> `StoryStatus` values `QUEUED/WRITING/NARRATING` were applied via `prisma db push` (no migration
> file yet). A clean rebuild must `db push` or add a migration.

---

## 9. Environment (`.env`, gitignored)

Full inventory lives in `.env.example`. Live deployment differs from code defaults — key live values:

| Var | Code default | **Live** |
|---|---|---|
| `AI_PROVIDER` / `OLLAMA_MODEL` | ollama / llama3.1 | ollama / **gemma3:12b-it-qat** |
| `OLLAMA_NUM_CTX` | 8192 | **16384** |
| `TRANSCRIPTION_PROVIDER` / `WHISPER_MODEL` | transformers / — | **local** / **ggml-large-v3.bin** |
| `FFMPEG_VIDEO_ENCODER` | libx264 | **h264_nvenc** |
| `CLIP_RENDER_CONCURRENCY` | 3 | **6** |
| `MUSIC_BACKEND` | stable-audio | stable-audio |
| `MUSIC_MIX_VOLUME` | **0.15** | 0.15 |
| `APP_URL` / `MEDIA_PUBLIC_BASE` | localhost | **https://viralcut.idreesmalik.com** |
| `HF_TOKEN` | — | _(set; gated Stable Audio download)_ |

Plus: `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `ADMIN_EMAILS`, `STORAGE_DIR`,
`ESPEAK_PATH`, `STORY_VOICE_EN/UR`, all timeout/concurrency limits, and OAuth creds
(`YOUTUBE_*`, `TIKTOK_*`, `INSTAGRAM_*`, `META_*`).

---

## 10. Local AI stack (self-hosted, GPU-accelerated)

Runs entirely on one Windows machine with an NVIDIA RTX 5080 (Blackwell, CUDA 12.8):

- **Ollama** — LLM server (`localhost:11434`), model `gemma3:12b-it-qat` (best local Urdu per
  Jan-2026 UrduBench). `npm run setup:local` pulls it + pre-downloads the Whisper model.
- **whisper.cpp CUDA** — `tools/whisper/…/whisper-cli.exe` + `ggml-large-v3.bin` (multilingual,
  word timings). `tools/*` is gitignored (machine-specific build) except `tools/fonts`.
- **Kokoro-82M** + **espeak-ng** — story voice-over.
- **Stable Audio Open / MusicGen** — Python 3.12 venv (`tools/musicgen/venv`) with **torch
  2.11.0+cu128**, diffusers 0.39, soundfile, scipy, transformers. GPU install (documented in
  `.env.example`): uninstall torch → `pip install torch --index-url .../whl/cu128`.
- **NVENC** for clip encoding (auto-fallback to libx264).

---

## 11. Run it

```bash
docker compose up -d                         # Postgres + Redis
# ensure Ollama is running (gemma3:12b-it-qat pulled)
npm run dev                                   # web app (:3000)
npm run worker                                # processing / publish / story / music worker
cloudflared tunnel --config <cfg> run         # public domain
```

One-click: `start.ps1` (waits for Docker, brings up compose, checks Ollama, opens app/worker/tunnel).
`stop.ps1` stops everything (data preserved). `npm run setup:local` bootstraps the local AI models.

---

## 12. Channels / branding (decided)

- **English channel:** _Unheard Tales_ — mystery/curiosity narrated shorts.
- **Urdu channel:** _Ansunay Afsany_ (ان سنے افسانے, "Unheard Tales") — literal sibling.
- Assets ready: YouTube descriptions, Facebook bios (English + Hinglish), and Gemini/"Nano-Banana"
  profile + banner image prompts (midnight-indigo + gold lamp/moon/book mystery theme).

---

## 13. Known constraints / next steps

- No dedicated **Urdu neural voice** exists free/local — `hf_alpha` + Urdu espeak phonemes is the
  best current option (quality still improves via Gemma-3 writing + large-v3 transcription).
- Stable Audio Open is **commercial-safe only under $1M/yr revenue** (Stability Community License);
  MusicGen-generated tracks are **non-commercial**. For unrestricted commercial music, use the
  **Upload** path with royalty-free tracks.
- **TikTok** app approval is blocked on root-domain (vs subdomain) hosting — deferred; launching
  with YouTube + Facebook first.
- Uptime depends on the local machine + tunnel staying up (processes are session-bound); a
  supervisor or always-on host would harden this.
- Config divergence (code default vs `.env.example` vs live `.env`) exists by design — treat the
  live `.env` as the source of truth for the running deployment.

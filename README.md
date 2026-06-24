# ✂️ ViralCut

Turn long-form videos into viral, ready-to-post **vertical short-form clips** for
**TikTok, Instagram Reels, Facebook Reels, and YouTube Shorts** — with AI clip
detection, auto-generated burned-in captions, 9:16 conversion, a review
dashboard, OAuth publishing, and scheduled auto-posting.

Built with **Next.js 15 (App Router) + TypeScript**, **PostgreSQL + Prisma**,
**BullMQ + Redis**, **FFmpeg**, **yt-dlp**, **Whisper** transcription, and the
**Anthropic Claude API** for viral-moment detection.

---

## ✨ Features

| Area | What it does |
|---|---|
| **Input** | YouTube URL import (yt-dlp) **and** direct file upload (streamed to disk). |
| **AI clip detection** | Claude (`claude-opus-4-8`) analyzes a timestamped transcript and returns viral moments with precise timestamps, hook titles, 0–100 confidence scores, and rationale — as guaranteed-valid structured JSON. |
| **Two modes** | **Viral-only** (extract top moments above a confidence threshold) and **Full-video** (sequential "Part 1, Part 2…" segmentation). Toggle per video. |
| **Clip generation** | FFmpeg trims each clip, converts to **9:16 (1080×1920)** with a blurred-fill background, and **burns in word-timed captions**. H.264/AAC MP4 tuned for social platforms. |
| **Captions** | Word-level timings from Whisper → grouped cues → **ASS** (burn-in) + **SRT** (downloadable sidecar). |
| **Dashboard** | Responsive UI: thumbnails, in-browser preview, **approve / reject / regenerate / new variation**, edit title + in/out points, view scores + metadata. |
| **Publishing** | Official **TikTok, Instagram, Facebook, YouTube** APIs with **OAuth 2.0**, immediate or scheduled posting, retries with backoff. |
| **Automation** | Background **auto-publisher**: enable per-user, choose interval (every 2h/6h/daily…), platforms, and an optional daily posting window. Approved clips post sequentially. |
| **Persistence** | All videos, clips, metadata, connected accounts, and publishing history in PostgreSQL. OAuth tokens **encrypted at rest** (AES-256-GCM). |

---

## 🏗️ Architecture

```
                         ┌──────────────────────────────┐
   Browser  ──────────▶  │  Next.js app (App Router)     │
                         │  - Dashboard (React)          │
                         │  - REST API routes            │
                         │  - Auth (JWT cookie)          │
                         └──────────────┬────────────────┘
                                        │ enqueue jobs
                              ┌─────────▼─────────┐         ┌─────────────┐
                              │  Redis (BullMQ)   │◀───────▶│ PostgreSQL  │
                              └─────────┬─────────┘         │  (Prisma)   │
                                        │ consume           └─────────────┘
                         ┌──────────────▼───────────────┐
                         │  Worker process (npm run worker)
                         │  - video pipeline             │     ┌──────────────┐
                         │    download→transcribe→detect │────▶│ Anthropic    │
                         │    →render(9:16+captions)     │     │ Claude API   │
                         │  - publish worker             │     └──────────────┘
                         │  - auto-publish scheduler     │────▶ TikTok / Meta / YouTube
                         └───────────────────────────────┘
                                        │ FFmpeg / yt-dlp / Whisper
                                        ▼
                                 ./storage (media)
```

The **web app** handles HTTP, auth, and enqueuing. All heavy lifting
(download, transcription, AI analysis, rendering, publishing) runs in a separate
**worker process** so requests stay fast and work survives restarts/retries.

### Directory layout

```
prisma/                  Prisma schema + seed
src/
  app/
    api/                 REST route handlers (auth, videos, clips, social, schedule, media)
    dashboard/           Authenticated UI (videos, clip review, connections, publishing, automation)
    login/ register/     Auth pages
  components/            React components (dashboard, auth form)
  lib/                   db, redis, env, logger, auth/session, crypto, storage, queue, api helpers
  services/
    video/               download (yt-dlp), ffmpeg, transcription (Whisper), pipeline
    ai/                  Claude clip detection + algorithmic segmentation
    captions/            ASS/SRT generation
    social/              OAuth + publishing providers (youtube, tiktok, instagram, facebook)
    publishing/          publication executor (token refresh, retries)
  workers/               BullMQ workers + auto-publish scheduler
  middleware.ts          Route protection (Edge)
```

---

## 🚀 Local setup

### Prerequisites
- **Node.js 20+** (24 recommended)
- **Docker** (for Postgres + Redis) — or your own Postgres/Redis
- **FFmpeg** — bundled automatically via `ffmpeg-static`, no system install needed
- **yt-dlp** — bundled via `youtube-dl-exec`; only needed for YouTube URL import

### 1. Install + infrastructure
```bash
# The yt-dlp wrapper has a preinstall Python check; the bundled yt-dlp binary
# is standalone, so it's safe to skip it:
YOUTUBE_DL_SKIP_PYTHON_CHECK=1 npm install      # (Windows PowerShell: $env:YOUTUBE_DL_SKIP_PYTHON_CHECK=1; npm install)

docker compose up -d        # starts PostgreSQL (5432) and Redis (6379)
```

### 2. Configure environment
```bash
cp .env.example .env
# Generate secrets:
#   AUTH_SECRET     -> openssl rand -base64 48
#   ENCRYPTION_KEY  -> openssl rand -hex 32
```
Defaults are **fully local / free** (`AI_PROVIDER=ollama`,
`TRANSCRIPTION_PROVIDER=transformers`) — no API keys needed for AI or
transcription. See **[Running everything locally](#-running-everything-locally-no-paid-services)**.

### 3. Database
```bash
npm run prisma:migrate      # create tables (dev)
npm run db:seed             # optional: demo user  (demo@viralcut.app / demo1234)
```

### 4. Run the app + worker (two terminals)
```bash
npm run dev                 # Next.js on http://localhost:3000
npm run worker              # background processor + scheduler
```

Open http://localhost:3000, register (or use the seeded demo account), and
import a video.

> **You need both processes.** The web app enqueues jobs; the worker does the
> downloading, transcription, AI analysis, rendering, and publishing.

---

## 🔑 Social platform setup

Each platform requires a **registered developer app**. Publishing for a platform
stays disabled until its credentials are present in `.env`. Register this
redirect URI for each: `{APP_URL}/api/social/callback/{platform}`.

| Platform | Where | Credentials | Notes |
|---|---|---|---|
| **YouTube** | [Google Cloud Console](https://console.cloud.google.com) → enable *YouTube Data API v3*, create an OAuth Web client | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | Vertical clips < 60s with `#Shorts` surface as Shorts automatically. |
| **TikTok** | [developers.tiktok.com](https://developers.tiktok.com) → Login Kit + Content Posting API | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | **Direct (public) posting requires app audit.** Unaudited apps can post privately only. |
| **Instagram Reels** | [Meta for Developers](https://developers.facebook.com) → Instagram Graph API | `META_APP_ID`, `META_APP_SECRET` | Requires an IG **Business/Creator** account linked to a Facebook Page. **Pull-based upload → media must be at a public URL** (set `MEDIA_PUBLIC_BASE`). |
| **Facebook Reels** | Same Meta app | `META_APP_ID`, `META_APP_SECRET` | You must manage a Facebook Page. Also pull-based (public URL required). |

> ⚠️ **Instagram & Facebook fetch the video from a public URL.** On localhost
> they can't reach `http://localhost:3000`. For real IG/FB publishing, deploy
> behind a public HTTPS domain and set `MEDIA_PUBLIC_BASE` (or expose `APP_URL`
> publicly, e.g. via a tunnel like ngrok/cloudflared during development).

---

## 💻 Running everything locally (no paid services)

This is the **default** configuration — no OpenAI/Anthropic keys required.

**1. AI clip detection → [Ollama](https://ollama.com) (local LLM).**
Install Ollama (one-click Windows/macOS installer), then pull a model:
```bash
ollama pull llama3.1        # 8B, ~4.7GB — good default
# alternatives: qwen2.5:7b (great at JSON), llama3.1:70b / qwen2.5:14b (if you have the VRAM)
```
Make sure `ollama serve` is running (the installer runs it as a background
service). Config: `AI_PROVIDER=ollama`, `OLLAMA_MODEL`, `OLLAMA_NUM_CTX`
(raise for long transcripts).

**2. Transcription → local Whisper, in-process.** The default
`TRANSCRIPTION_PROVIDER=transformers` runs Whisper via
`@huggingface/transformers` (ONNX) — **no Python, no compiler, no extra
binaries**. The model (`Xenova/whisper-base.en` by default) auto-downloads and
caches on first use. Use `Xenova/whisper-small.en` for higher accuracy or
`Xenova/whisper-base` for non-English audio.

**3. One-shot helper:**
```bash
npm run setup:local        # verifies Ollama + pulls the model + pre-downloads Whisper
```

Everything else (PostgreSQL, Redis, FFmpeg, yt-dlp) is already local: Postgres
and Redis run as free Docker containers, and FFmpeg/yt-dlp binaries are bundled
with the npm install. **Nothing leaves your machine** except the optional
social-publishing step (which only runs when you connect an account).

> **Performance:** transcription + LLM analysis are CPU/GPU-bound. A 10-minute
> video on a modern laptop typically processes in a few minutes. For speed, use
> a smaller Whisper model and an 8B LLM; for quality, scale both up. Ollama uses
> your GPU automatically when available.

### Other transcription providers

Pick via `TRANSCRIPTION_PROVIDER`:

- **`transformers`** *(default, local, free)* — in-process Whisper as above.
- **`local`** — external [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
  CLI (faster with a GPU build). Set `WHISPER_CLI` + `WHISPER_MODEL`.
- **`openai`** — OpenAI Whisper API *(paid)*. Set `OPENAI_API_KEY`. Auto-chunks
  long audio.
- **`none`** — skip transcription (no captions; viral mode uses segmentation).

### Using cloud AI instead (optional)

To use Claude instead of a local model, set `AI_PROVIDER=anthropic` and
`ANTHROPIC_API_KEY`. The clip-detection code is identical — only the backend
differs.

---

## 🎛️ How it works (pipeline)

1. **Ingest** — YouTube URL (yt-dlp) or uploaded file is stored under `./storage`.
2. **Probe** — FFmpeg reads duration/resolution; a source thumbnail is captured.
3. **Transcribe** — Whisper produces segments + word timings (cached on the video).
4. **Detect clips** —
   - *Viral mode*: Claude scores moments from the transcript → keeps those ≥ threshold, de-overlaps, caps at the target count.
   - *Full mode*: sequential segmentation snapped to sentence boundaries.
5. **Render** — each clip is trimmed, converted to 9:16 with a blurred fill, and captions are burned in; a thumbnail + SRT sidecar are saved.
6. **Review** — approve / reject / regenerate / make a variation / edit in the dashboard.
7. **Publish** — manually (now or scheduled) or via the auto-publisher, to any connected platform.

---

## 📦 Environment reference

| Variable | Required | Description |
|---|---|---|
| `APP_URL` | yes | Public base URL (used for OAuth redirect URIs + absolute media links). |
| `DATABASE_URL` | yes | PostgreSQL connection string. |
| `REDIS_URL` | yes | Redis connection string for BullMQ. |
| `AUTH_SECRET` | yes | JWT signing secret (32+ chars). |
| `AUTH_SESSION_DAYS` | no | Session lifetime in days (default 30). |
| `ENCRYPTION_KEY` | yes (for publishing) | 32-byte hex/base64 key; encrypts OAuth tokens at rest. |
| `STORAGE_DIR` | no | Media directory (default `./storage`). |
| `MEDIA_PUBLIC_BASE` | for IG/FB | Public base URL for serving media (e.g. a CDN). Required so IG/FB can pull videos. |
| `FFMPEG_PATH` / `FFPROBE_PATH` | no | Override bundled FFmpeg binaries. |
| `YTDLP_PATH` | no | Override bundled yt-dlp binary. |
| `AI_PROVIDER` | no | `ollama` (local, default) or `anthropic` (cloud). |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` / `OLLAMA_NUM_CTX` | for `ollama` | Local LLM endpoint, model name, context size. |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | for `anthropic` | Cloud Claude credentials. |
| `TRANSCRIPTION_PROVIDER` | no | `transformers` (local, default) \| `local` \| `openai` \| `none`. |
| `TRANSFORMERS_WHISPER_MODEL` | no | Local Whisper model id (default `Xenova/whisper-base.en`). |
| `OPENAI_API_KEY` / `OPENAI_WHISPER_MODEL` | for `openai` | Whisper API credentials (paid). |
| `WHISPER_CLI` / `WHISPER_MODEL` | for `local` | External whisper.cpp binary + model. |
| `VIDEO_WORKER_CONCURRENCY` | no | Parallel video jobs (default 1; raise if CPU allows). |
| `PUBLISH_WORKER_CONCURRENCY` | no | Parallel publish jobs (default 2). |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | for YouTube | Google OAuth client. |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | for TikTok | TikTok app credentials. |
| `META_APP_ID` / `META_APP_SECRET` | for IG/FB | Meta app credentials. |

---

## 🛠️ Scripts

| Command | Description |
|---|---|
| `npm run dev` | Next.js dev server. |
| `npm run worker` | Background worker + scheduler. |
| `npm run worker:dev` | Worker with file watching. |
| `npm run build` / `npm start` | Production build / serve. |
| `npm run prisma:migrate` | Apply dev migrations. |
| `npm run prisma:deploy` | Apply migrations (production). |
| `npm run prisma:studio` | Browse the DB. |
| `npm run db:seed` | Seed a demo user. |

---

## ☁️ Deployment notes

- Run the **web app** and the **worker** as separate processes/containers
  (`npm start` and `npm run worker`). The worker is stateful CPU work — give it
  FFmpeg + adequate CPU/RAM, and scale horizontally by running more workers
  (BullMQ distributes jobs).
- Use a **managed PostgreSQL + Redis**.
- Put media on **object storage + a CDN** in production: reimplement
  `src/lib/storage.ts` against S3/GCS and set `MEDIA_PUBLIC_BASE` to the CDN.
  This also satisfies IG/FB's public-URL requirement.
- Apply migrations on deploy: `npm run prisma:deploy`.
- Set `secure` cookies + a strong `AUTH_SECRET` + a real `ENCRYPTION_KEY` in prod.

---

## 🔒 Security

- Passwords hashed with **bcrypt**; sessions are signed **JWTs** in httpOnly cookies.
- Social OAuth tokens are **AES-256-GCM encrypted** before storage and never
  returned to the client.
- OAuth flows use a **state** parameter (CSRF) validated against a cookie.
- Route handlers + Edge middleware enforce per-user ownership on every resource.

---

## 📋 Status / known limitations

This is a complete, runnable reference implementation. To go fully live you must
supply: a Postgres + Redis instance, an `ANTHROPIC_API_KEY`, a transcription
provider, and **approved developer apps** for each social platform (TikTok and
Meta gate public posting behind app review). The publishing code targets the
real, current platform APIs — it activates as soon as valid credentials exist.

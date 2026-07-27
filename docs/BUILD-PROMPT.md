# ViralCut — Master Build Prompt

A single, self-contained prompt you can hand to a capable AI coding agent (or an engineering
team) to build **ViralCut** from scratch — or a better version of it. It captures not just *what*
to build but the **non-obvious lessons** that cost real time the first time around, so a rebuild
skips the same traps. Copy everything below the line.

---

## ROLE & GOAL

You are building a **self-hosted, local-first web application** called **ViralCut** that does two
things:

1. **Long-video → short clips.** Ingest a long video (YouTube URL, file upload, or an AI-narrated
   story) and produce vertical **1080×1920 (9:16)** short clips with burned-in animated captions,
   a watermark, and an optional ducked music bed — then publish them to **YouTube, TikTok,
   Instagram, and Facebook** with scheduling and drip batches.
2. **AI Stories.** Locally **write** long-form narrated stories, **voice** them with a local TTS
   engine (including authentic non-English voices), and let users turn a story into a set of clips.

**Prime directive:** every AI capability (LLM, speech-to-text, text-to-speech, text-to-music) must
run **locally and free** by default, with an optional hosted fallback behind an env flag. Optimize
for a solo creator running the whole stack on one machine with an NVIDIA GPU.

**Commercial safety is a first-class requirement**, not an afterthought: any generated asset that
ships on a monetized channel (music especially) must use a **commercially-licensed** model, and the
UI must make the license implications obvious.

---

## TECH STACK (recommended; "or better" alternatives noted)

- **Framework:** Next.js 15 (App Router) + React 19 + TypeScript (strict). *Or better:* keep the
  App Router; consider Server Actions + streaming for progress instead of client polling.
- **DB:** PostgreSQL + Prisma. **Queue:** Redis + BullMQ, driven by a **separate worker process**
  (the web server only enqueues; all heavy work runs in the worker).
- **Media:** FFmpeg (fluent-ffmpeg + ffmpeg-static), libass for subtitle burn-in, NVENC
  (`h264_nvenc`) with automatic `libx264` fallback.
- **STT:** whisper.cpp (CUDA build) for GPU word-level timing; pluggable with transformers.js
  (ONNX) and a hosted Whisper API. *Or better:* `faster-whisper`/WhisperX for word alignment if you
  can stabilize it on your GPU.
- **LLM:** local **Ollama** (a strong instruct model, e.g. a 12–14B QAT build with good multilingual
  support); optional hosted Claude behind `AI_PROVIDER`.
- **TTS:** **Kokoro-82M** (ONNX, via kokoro-js) + **espeak-ng** for non-Latin phonemes. *Or better:*
  a native neural voice for your target languages if a free/local one exists (none did for Urdu as
  of build time — see lessons).
- **Text-to-music:** a **commercially-licensed** local model (**Stable Audio Open** — commercial use
  permitted under a revenue cap) as default, with a non-commercial fallback (MusicGen) behind an env
  flag. Run it in an isolated **Python subprocess** on the GPU (torch CUDA build).
- **Auth:** custom JWT (jose HS256) in an httpOnly cookie + bcrypt; **edge-safe session module**
  separate from Node-only auth helpers so middleware runs on the Edge runtime.
- **Styling:** Tailwind, one cohesive theme, self-hosted fonts (CSP-safe), a single icon font.

---

## FEATURE SPEC (by subsystem)

### 1. Auth & accounts
- Register (unique email **and** unique display name — the name doubles as a login identifier),
  login by email-with-`@` OR case-insensitive name, logout. Uniform "Invalid credentials" (no user
  enumeration). Passwords bcrypt cost 12.
- Session = jose HS256 JWT (`sub`=user id, `email` claim) in an httpOnly cookie; **fail closed in
  production** if the secret is missing/default. **Split** the token primitives (edge-safe, no
  Prisma/bcrypt/`next/headers`) from Node-only helpers, because Edge middleware can't import
  Node-only modules.
- **Admin = email allowlist** (`ADMIN_EMAILS`), compared against the session's email claim. Because
  admin rides on the email claim, **re-issue the session token whenever the email changes**.
- **Settings/Profile:** edit username/email/password (email & password changes require the current
  password; enforce uniqueness with a DB unique index *and* handle the Prisma P2002 race → 409),
  a `@handle` watermark, background-music selection, and auto-publish config.

### 2. Video pipeline
- **Ingest:** YouTube (yt-dlp) / upload (stream to disk, size-capped) / AI-story audio.
- **Stages** with per-record status so the dashboard shows live progress and a single clip failure
  never aborts the batch: DOWNLOADING → TRANSCRIBING → ANALYZING → GENERATING → READY/FAILED.
- **Clip selection:** VIRAL (LLM picks moments, JSON-schema-constrained, 0–100 scored,
  threshold-filtered, de-overlapped, clamped 15–60s) or FULL (sequential "Part N" split snapped to
  sentence boundaries). Fall back to algorithmic segmentation if the LLM times out.
- **Render** each clip to 1080×1920: blurred-fill background (blur at low-res then upscale — cheap),
  burned captions, `@handle` watermark bottom-center, "Part N" + optional short title, ducked music
  bed, loudnorm audio (EBU R128 `I=-16:TP=-1.5`), 30fps, faststart.
- **Generic footage mode:** replace visuals with random stock clips (kept audio); synthesize a solid
  background for audio-only sources so captions have a backdrop.

### 3. Captions (this is where the subtle bugs live — read the lessons)
- Word-level cues (≤4 words / ≤26 chars / ≤2.6s), 7 styles incl. animated **karaoke** and **pop**,
  emit both a burned `.ass` and an `.srt` sidecar.
- Full RTL support (Urdu/Arabic) + Devanagari (Hindi) + a romanized "Hinglish" mode. Bundle Noto
  fonts and load them via libass `fontsdir`.

### 4. AI Stories
- Local LLM writes 3–15 min stories with a continuation loop to hit length; self-rated viral score
  0–100; per-stage status. Local TTS voices them (authentic non-Latin pronunciation). Store text +
  audio + word timings. Admin can generate/paste/upload/edit. Users **claim** a story
  (race-safe) to spawn an audio-only video; copy the audio into the video's own storage.

### 5. Background music
- Admin builds a shared library by **generating locally** (commercially-licensed model) or
  uploading. Each user **exclusively claims one track**; it's looped and mixed **ducked** under
  their clips. Bed gain env-tunable. Generation runs off the queue in a Python subprocess on the GPU.

### 6. Publishing
- OAuth connect per platform; **encrypt tokens at rest** (AES-256-GCM). Single publish, scheduled
  publish, sequential "Publish All" drip batches (next enqueued only after the prior succeeds),
  in-place retry, and a per-user auto-publish scheduler with a daily window. **Signed, short-lived
  media URLs** so platforms that pull media server-side can fetch it without a session.

---

## DATA MODEL (Prisma)

`User` (email unique, name unique = login id, handle, backgroundMusicId, backgroundMusicEnabled) ·
`BackgroundMusic` (source, storageKey `""`=generating, exclusive claim) · `Video` (clip config,
transcript JSON, status) · `Clip` (start/end, viralScore?, order, status, storageKey, captionsKey) ·
`SocialAccount` (encrypted tokens, meta JSON) · `Publication` + `PublicationLog` (status, batch
fields, attempts) · `AutoPublishConfig` (interval, platforms[], window) · `Story` (status machine,
viralScore, text/audio/transcript, claim fields). All PKs cuid; timestamps everywhere; index the
scheduler/reaper query paths.

---

## HARD-WON LESSONS (implement these deliberately — they are not obvious)

1. **libass silently drops karaoke timing on auto-wrapped lines.** Pre-wrap karaoke cues into
   explicit short lines (~13 chars) joined with manual `\N`, and set `WrapStyle: 0`.
2. **`\kf` always sweeps left-to-right.** For RTL scripts use instant `\k`, or the highlight runs
   backwards through the word.
3. **Whisper needs `--split-on-word --max-len 1`** for one whole word per segment — without it,
   Urdu/Arabic split into sub-word tokens that break letter-joining when re-joined with spaces.
4. **Windows ffmpeg filtergraph paths:** the drive-letter colon is parsed as an option separator
   even inside quotes. Pass subtitle/font paths **relative to cwd**; write the `.ass` on the same
   drive as the project.
5. **yt-dlp:** invoke via `execFile` (argv), not a shell wrapper (cmd.exe mangles `<` in
   `[height<=1080]` and spaced paths). Use `--no-part` (the `.part`→final rename is frequently
   blocked by AV → WinError 32). Prefer an **H.264 format ladder** (AV1 is costly to decode).
6. **Run native ONNX/GPU inference in an isolated child process.** A native onnxruntime segfault
   is uncatchable and would kill the worker; isolate it, hard-timeout with SIGKILL, fall back
   GPU→CPU→none.
7. **Ollama must stream** (`stream:true`). With `stream:false` it sends headers only after the whole
   (minutes-long) answer, blowing the HTTP client's header timeout. Also: local models truncate long
   structured output — use a plain-text format + a continuation loop, not one giant JSON request.
8. **Don't delete a queued job's DB row on failure.** BullMQ retries; a deleted row makes every
   retry fail "record not found". Keep the pending row, and clean it up **only after all attempts are
   exhausted** (in the worker's `failed` handler, idempotently).
9. **Stale-job reaper must check real progress**, not just `updatedAt` — only fail a video if **no
   clip advanced** in the window, or you false-fail long-but-active renders.
10. **BullMQ job-id dedupe cuts both ways:** use *no* fixed id for reprocess (a lingering completed
    job would suppress it), but for retryable publishes remove the stale id before re-adding so the
    retry actually runs.
11. **"Local" ≠ "commercial."** A model's weight license governs its output regardless of where you
    run it. MusicGen is CC-BY-NC. Default to a commercially-licensed model (Stable Audio Open) and
    surface the license (and any revenue cap) in the UI.
12. **Authentic non-English voice:** don't transliterate Urdu → Devanagari to reuse a Hindi voice —
    it flattens Urdu-specific sounds. Phonemize the native script with espeak-ng (`-v ur`) and feed
    the phonemes to the TTS engine, bypassing its English-only phonemizer. Pass non-Latin text to
    native binaries via a **UTF-8 file**, not a CLI arg (Windows mangles the encoding).
13. **Keep the worker alive** on `unhandledRejection`/`uncaughtException` (Node ≥15 exits by
    default, killing every in-flight job); jobs already fail safely per-record.
14. **Diffusion music generation is GPU-bound.** ~90s/track on a modern GPU vs 30–60 min on CPU —
    plan for the GPU path and document the CUDA-torch install.

---

## MAKE IT BETTER THAN THIS (encouraged improvements)

- **Reliability:** run as a supervised service (PM2/systemd/Windows Service) instead of session-bound
  terminals; add a Story reaper (the current build reaps only Video/Clip); add health checks + a
  restart policy; consider object storage (S3-compatible) instead of local FS for horizontal scale.
- **Progress UX:** replace client polling with Server-Sent Events / WebSockets for live job progress.
- **Quality:** word-accurate forced alignment (WhisperX); a native commercial-free neural voice for
  each target language when one becomes available; sidechain (dynamic) ducking instead of a static
  volume cut so music breathes under speech.
- **Music:** an unconditionally-permissive (Apache) local music model when quality catches up, to
  drop the revenue-cap caveat entirely.
- **Config hygiene:** collapse the three-way divergence (code defaults vs `.env.example` vs live
  `.env`) into one validated schema with typed loading and a `doctor` command that verifies the
  local AI stack (Ollama model pulled, whisper model present, espeak installed, GPU torch working).
- **Testing:** golden-frame tests for caption rendering (the karaoke/RTL bugs were only caught by
  frame-by-frame inspection); contract tests for each publish provider.
- **Security:** rate-limit auth, add email verification + password reset, CSRF tokens, and per-user
  storage quotas.

---

## ACCEPTANCE CRITERIA

- A user can register, connect at least one social account, import a YouTube video, get
  auto-generated 9:16 clips with correct **animated karaoke captions in English AND a right-to-left
  language**, and publish one — all with the LLM/STT/TTS running **locally**.
- An admin can **generate a background-music track locally** from a text prompt using a
  **commercially-licensed** model, and a user can claim it and hear it ducked under their clips.
- The AI Stories flow writes, voices (authentic pronunciation), and converts a story to video
  end-to-end offline.
- Killing the machine mid-job and restarting the worker **resumes** cleanly (no duplicate clips, no
  ghost "generating forever" rows, no false-failed active renders).
- Every one of the 14 hard-won lessons above is demonstrably handled.

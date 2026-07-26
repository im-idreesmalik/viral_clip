# ViralCut — Project Brief & Build Log

_Last updated: July 2026_

A self-hosted web app that (1) turns long-form videos into vertical **9:16 short clips**
for TikTok / Reels / Shorts and publishes them, and (2) runs an **AI Stories** engine that
writes narrated fiction, generates local voice-overs, and lets users spin those into videos.
Everything AI runs **locally / free** wherever possible.

---

## 1. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15.5 (App Router), React 19, TypeScript |
| Database | PostgreSQL + Prisma 6 (Docker `viralcut-postgres`) |
| Queue / jobs | Redis + BullMQ (Docker `viralcut-redis`); a separate long-running **worker** process |
| Auth | Custom JWT (jose), httpOnly cookie, bcrypt; login by **email OR name** |
| Media | FFmpeg (fluent-ffmpeg + ffmpeg-static); NVENC GPU encode → libx264 fallback; libass `.ass` subtitles |
| Transcription (STT) | whisper.cpp CUDA (`large-v3-turbo`), isolated in a subprocess |
| AI text (LLM) | Local **Ollama** (`qwen2.5:14b`) by default; optional Anthropic Claude (respects `AI_PROVIDER`) |
| Voice-over (TTS) | **Kokoro-82M** via `kokoro-js` (ONNX, local) + **espeak-ng** for Urdu/Hindi phonemes |
| Theme | Light "Obsidian Kinetic Light" (brand purple `#7c5cff`, cyan accent) |
| Public hosting | Local machine + **Cloudflare tunnel** → `viralcut.idreesmalik.com` |

---

## 2. Core video pipeline

YouTube URL **or** file upload → download/finalize → **transcribe** (word-level) →
**clip selection** (AI "viral moments" above a threshold, **or** full-video split into
"Part 1/2/…") → **render** each clip to 9:16 (blurred-fill background, burned captions,
**@username watermark**, "Part N" + optional short-title overlay) → review/approve →
**publish** to YouTube / TikTok / Instagram / Facebook (OAuth), with scheduling,
sequential "Publish All" batches, and auto-retry.

- **Generic footage library** — superuser uploads stock clips (auto-converted to 9:16, audio
  stripped); the "Generic" footage mode swaps visuals while keeping original audio.
- **Auto-hashtags** — 10 defaults (`#shorts #reels #fyp #foryou #viral #trending #explore
  #follow #subscribe #video`) merged + deduped with per-video tags.

---

## 3. Subtitles / captions

- **Styles:** Classic, Bold (Impact, largest), Bold Yellow, Bold Green, Boxed, plus
  **interactive**: **Karaoke** (word-by-word highlight synced to speech) and **Pop**
  (fade + scale-in). Sizes enlarged and clearly differentiated.
- **RTL fix (Urdu/Arabic):** karaoke uses instant `\k` (not the left-to-right `\kf` sweep)
  so the highlight runs right→left; **explicit `\N` line breaks** because libass silently
  drops karaoke timing on auto-wrapped lines.
- **Non-Latin fonts:** Noto Naskh Arabic (Urdu/Arabic) and Noto Sans Devanagari (Hindi),
  bundled so libass renders them instead of tofu boxes.
- **Live preview:** New-Video + Reprocess show a mini faux-video screen rendering sample
  text in the chosen **style + language** (colours, outline, Impact, box, animated
  karaoke/pop, correct script + text direction).
- **Languages:** per-video selector, including **Hinglish** (transcribe Hindi → romanize to
  Latin, e.g. "kahani suno") and **Urdu** (native script + Urdu voice).

---

## 4. AI Stories

- **User tab** to listen to narrated stories and turn one into a set of videos.
- **Generation:** local Ollama writes 8–10 min curiosity/mystery stories (continuation loop
  to reach length); each gets an AI **viral score (0–100)**.
- **Voice-over (Kokoro, local/free):** English = `af_heart` (soft female);
  **Urdu = `hf_alpha`** driven by **espeak `-v ur`** phonemes generated from the
  **Arabic-script text directly** — authentic Urdu, **not** Hindi, no Devanagari conversion.
- **Storage:** text + mp3 stored so playback never regenerates.
- **Super Admin management:** generate by topic/language/duration, paste text (auto
  voice-over), upload text/voice, edit/delete.
- **Granular status:** In queue → Writing story… → Generating voice-over… → Ready / Failed,
  with a live "working now" summary + pulsing badges.
- **Claiming:** when a user generates a video from a story, it's **hidden from everyone**.
- Seed content: 15 English + 15 Urdu stories.

---

## 5. Admin / auth / settings

- **Superuser** (via `ADMIN_EMAILS`): admin panel with all users + their activity; delete any
  user's video (video + clips); manage the generic library and the stories.
- **Profile section in Settings:** edit **username, email, password** (email/password require
  current-password verification; username/email uniqueness enforced; session token re-issued
  on email change). Separate **"Clip watermark"** @handle section.

---

## 6. Reliability / infrastructure

- Transcription runs in an **isolated subprocess** (a native GPU crash only fails one job);
  render/transcribe/download **timeouts + SIGKILL**; a **stale-job reaper**.
- **Reaper fix:** a video is only failed if **none of its clips advanced** in the window
  (no more false-failing long-but-active renders).
- **Resume:** a retried video renders only the **not-yet-done** clips (keeps finished ones).
- Story generation uses **local Ollama** so a cloud API outage can't stall it.
- The full stack runs **in-session** (no external terminal windows): Docker
  (postgres/redis) + Ollama + `npm run dev` + worker + tunnel. `start.ps1` is a one-click
  launcher.

---

## 7. Key data model (Prisma)

- **User** — email, `name` (unique, login identifier), `handle` (@watermark), passwordHash.
- **Video** — clipMode, viralThreshold, segmentSeconds, targetClipCount, burnCaptions,
  captionStyle, shortTitle/showShortTitle, language, footageMode, transcript (JSON), status.
- **Clip** — startSec/endSec, viralScore, reason, order, status, storageKey, captionsKey.
- **SocialAccount / Publication / PublicationLog** — OAuth publishing + scheduling.
- **Story** — language, `status` (DRAFT/QUEUED/WRITING/NARRATING/GENERATING/READY/CLAIMED/FAILED),
  `viralScore`, text, audioKey, durationSec, voice, claimedBy/claimedAt, generatedVideoId.
- **AutoPublishConfig** — per-user auto-publish schedule.

---

## 8. Environment (`.env`, gitignored)

`DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `ADMIN_EMAILS`,
`AI_PROVIDER` (ollama|anthropic), `OLLAMA_MODEL`, `ANTHROPIC_API_KEY`,
`TRANSCRIPTION_PROVIDER` (local|transformers|openai|none), `WHISPER_CLI`, `WHISPER_MODEL`,
`STORY_VOICE_EN` (af_heart), `STORY_VOICE_UR` (hf_alpha), `ESPEAK_PATH`,
plus OAuth creds (`YOUTUBE_*`, `TIKTOK_*`, `INSTAGRAM_*`, `META_*`).

---

## 9. Run it

```bash
docker start viralcut-postgres viralcut-redis   # or: docker compose up -d
# ensure the Ollama app is running (qwen2.5:14b pulled)
npm run dev                                      # web app (:3000)
npm run worker                                   # processing/publish worker
cloudflared tunnel --config <cfg> run            # public domain
```

One-click: `start.ps1`.

---

## 10. Channels / branding (decided)

- **English channel:** _Unheard Tales_ — mystery/curiosity narrated shorts.
- **Urdu channel:** _Ansunay Afsany_ (ان سنے افسانے, "Unheard Tales") — literal sibling.
- Assets ready: YouTube descriptions, Facebook bios (English + Hinglish), and
  Gemini/"Nano-Banana" **profile + banner image prompts** (midnight-indigo + gold
  lamp/moon/book mystery theme).

---

## 11. Known constraints / next steps

- Kokoro TTS runs on CPU (~5–6 min per full 8–10 min story); GPU would be faster but risks
  onnxruntime crashes on the Blackwell card.
- No dedicated **Urdu neural voice** exists free/local — `hf_alpha` + Urdu espeak phonemes
  is the best current option.
- **TikTok** app approval is blocked on root-domain (vs subdomain) hosting — deferred;
  launching with YouTube + Facebook first.
- Uptime depends on the local machine + tunnel staying up (processes are session-bound); a
  supervisor or always-on host would harden this.

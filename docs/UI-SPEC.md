# ViralCut — UI/UX Design Spec (for Google Stitch)

## Product in one line
ViralCut turns long-form videos (YouTube URL or uploaded file) into ready-to-post
**vertical 9:16 short clips** with AI clip detection, burned-in auto-captions
(multi-language), a per-user @handle watermark, and one-click / scheduled
publishing to TikTok, Instagram Reels, Facebook Reels, and YouTube Shorts.

Audience: solo creators and social teams. Tone: modern, fast, confident,
"creator SaaS." It is a **dark-theme web app** with a marketing landing page.

---

## Design language / tokens

**Theme:** dark, near-black canvas with soft purple ambient glow.

**Color palette**
- Canvas / bg: `#0a0a0f` (deepest), panels `#111118`, raised surfaces `#1a1a24`, borders `#262633`.
- Text: primary `#e8e8f0`, secondary `#a9a9be`, muted `#76768e`.
- Brand (primary): purple `#7c5cff`; primary gradient `linear-gradient(135deg,#7c5cff,#6442e6)`.
- Accent: cyan `#22d3ee` (used sparingly, e.g. gradient text highlight, progress bar).
- Semantic: success emerald `#34d399`, warning amber `#fbbf24`, danger red `#f87171`.

**Typography:** Inter (or a clean geometric sans). Tight tracking on headings.
Scale: page title 24–30px semibold; section title 14px uppercase tracked, muted;
body 14px; small/meta 12px. Numbers/timestamps can be tabular.

**Shape & depth:** cards `rounded-2xl` with 1px subtle border + soft shadow +
slight backdrop blur; buttons/inputs `rounded-xl`. Primary buttons have a purple
glow. Cards lift slightly and get a brand-tinted border on hover.

**Motion:** smooth, quick (150–350ms, ease-out). Fade-up on page/content mount,
scale-in for dialogs, shimmer skeletons while loading, an indeterminate top
progress bar during navigation. Respect reduced-motion.

**Iconography:** currently emoji; Stitch should replace with a consistent line-icon
set (e.g. Lucide). Logo = a gradient rounded-square tile with a scissors ✂️ mark +
"ViralCut" wordmark.

**Reusable components (design once, reused everywhere):**
- Buttons: Primary (gradient+glow), Secondary (surface+border), Ghost, Danger.
- Pill badges with semantic variants (neutral/brand/success/warn/danger).
- Inputs, selects, textareas, range sliders, toggles/checkboxes — dark, with a
  large soft focus ring in brand purple.
- Cards, empty-states, skeleton loaders, toasts (bottom, slide/scale in).
- Status badges (see "Status system" below).

**Status system (used on videos, clips, publications):**
- Video: Pending, Downloading, Transcribing, Analyzing, Generating (all "in
  progress" → animated/pulsing), Ready (success/green), Failed (red).
- Clip: Pending, Rendering (pulsing), Ready, Failed.
- Publication: Scheduled, Queued, Publishing (pulsing), Published (green), Failed
  (red, with Retry), Cancelled.

**Responsive:** desktop = fixed left sidebar + fluid content (max ~1152px, centered).
Mobile = top bar with hamburger opening a slide-in drawer; grids collapse to 2/1 columns.

---

## GLOBAL: Dashboard shell (app layout)
Every signed-in page sits inside this shell.
- **Left sidebar (desktop, ~240px, sticky full height):** brand logo at top; nav
  list; account block pinned at bottom.
  - Nav items (icon + label, active item has a tinted pill highlight + subtle
    inset ring; a small spinner appears on the item while its page loads):
    **Videos** (🎬), **Connections** (🔗), **Publishing** (📡), **Generic** (🎞️),
    **Settings** (⚙️).
  - Account block: circular avatar (first letter), name + email (truncated),
    "Sign out" ghost button.
- **Mobile:** sticky top bar with logo + hamburger; tapping opens a full-height
  left drawer (same nav + account) over a dimmed blurred backdrop.
- Content area fades in on mount.

---

## SCREEN 1 — Landing / marketing (`/`)
Public homepage (also used for app-store review). Dark, premium SaaS hero.
- **Sticky top nav:** logo left; right = "Terms", "Privacy" (text links, hidden on
  mobile), "Sign in" (secondary button).
- **Hero (centered):** small pill badge "✨ AI-powered short-form video"; big
  headline "**Turn long videos into viral short clips**" where "viral short clips"
  is a purple→cyan gradient text; supporting paragraph; two CTAs — "Get started →"
  (primary) and "Create account" (secondary). Below: "Publishes to" label + row of
  platform chips (TikTok, Instagram, Facebook, YouTube).
- **Features grid (3 cols desktop / 2 / 1):** 6 cards, each an icon tile + title +
  1–2 line description: AI viral detection, Vertical 9:16 clips, Auto captions,
  Two modes (viral vs full-split), Publish anywhere, Automation.
- **Footer:** © line + Terms / Privacy / Sign in links.
- States: static. Entrance fade-up on hero elements.

---

## SCREEN 2 — Sign in (`/login`) and Create account (`/register`)
Single centered auth card on the dark canvas.
- Logo tile (gradient rounded-square ✂️) centered, "ViralCut" title, subtitle
  ("Welcome back" / "Create your account").
- Card form: (register only: **Name**), **Email**, **Password** (min 8 on register).
  Inline red error banner on failure. Full-width primary submit ("Sign in" /
  "Create account"; shows "Please wait…" while loading).
- Below card: link to switch between sign in / register.
- States: idle, loading (disabled button), error banner.

---

## SCREEN 3 — Videos (dashboard home, `/dashboard`)
Two-column: **left = your videos list**, **right = "New video" creation panel**
(on mobile the New Video panel stacks on top).

**Left — "Your videos"**
- Header: title "Your videos" + subtitle "Import a video and ViralCut turns it into
  ready-to-post vertical clips."
- List of **video rows** (card, hover-lift). Each row:
  - Thumbnail (16:9, ~112×64, rounded) or placeholder 🎞️.
  - Title (bold, links to detail) + a wrap row of small meta badges:
    **status badge**, mode ("Viral-only" / "Full-video"), footage ("Original"/
    "Generic", full-video only), captions ("Captions" / "No captions"), language
    (only when captions on, e.g. "Urdu"), duration, "N clips", source ("YouTube"/
    "Upload"). If failed: a red error line.
  - Right side: "Open" (secondary) + "Delete" (danger text).
- **Empty state:** centered card, 🎬, "No videos yet", "Paste a YouTube URL or
  upload a file to get started."
- **Loading:** 3 skeleton rows.

**Right — "New video" panel (card):**
- Segmented tabs: **YouTube URL** / **Upload file**.
  - URL tab: text input for the YouTube link.
  - Upload tab: file picker (video/*) with an upload progress bar.
- **Clip selection mode** — two selectable "mode cards":
  - "Viral-only" — "AI extracts the highest-confidence viral moments."
  - "Full-video" — "Split the whole video into sequential parts."
- Mode-specific settings:
  - Viral: **Viral threshold** slider (0–100, shows value) + **Max clips** number.
  - Full: **Part length (sec)** number (15–60) + helper text.
- **Add captions (subtitles)** checkbox.
- **Spoken language** select (shown only when captions on): Auto-detect, English,
  Urdu, Hindi, Punjabi, Arabic, Pashto, … + helper "Auto-detect can confuse similar
  languages (e.g. Urdu vs Hindi)."
- **Footage** (full-video only): two mode cards "Original" / "Generic (stock)";
  if Generic, helper "Add stock videos in the Generic tab first."
- Full-width primary "Generate clips" ("Starting…" while busy). Inline error banner.

---

## SCREEN 4 — Video detail (`/dashboard/videos/[id]`)
Header card + responsive grid of **clip cards**.
- Back link "← All videos".
- **Header card (flex):** thumbnail; title with an inline "✏️ Edit" (edit mode
  reveals Title + Hashtags inputs and Save/Cancel); a wrap row of badges (status,
  mode, footage, captions, language, duration, "N clips"); failure error line if
  any. Right side actions: "📡 Publish all" (primary, shown when ≥1 clip is
  publishable) and "Reprocess" (secondary → opens Reprocess dialog).
- **Processing state (no clips yet):** centered card with spinner, "Working on
  it…", "Turning your video into clips. This can take a few minutes." (auto-polls).
- **Clips grid (2 / 3 / 4 columns responsive):** each **clip card**:
  - **9:16 video preview** (with poster). While rendering: spinner + "Rendering…".
    Overlays: top-left "Part N" gradient badge (full-video) + viral **score badge**;
    top-right duration pill; bottom-left small round platform icons for platforms
    it's already **published** to.
  - Below: clip title (2-line clamp) with inline edit (Title + Start/End second
    inputs → "Save & re-render"); optional AI "reason" line; red error line if failed.
  - Action row (ghost buttons): ✏️ Edit, 🔁 Regenerate, ✨ Variation, 💬 Captions
    (download), 🗑 delete; then a full-width primary "📡 Publish".
- Loading: skeleton 9:16 tiles.

---

## SCREEN 5 — Connections (`/dashboard/connections`)
Manage linked social accounts.
- Title "Connections" + subtitle "Connect your social accounts to publish clips
  directly from ViralCut."
- Success/error banner (after OAuth redirect back).
- List of **platform cards** (one per platform: YouTube, TikTok, Instagram Reels,
  Facebook Reels). Each card:
  - Left: colored rounded icon tile + platform name + status subline ("Ready to
    connect" / "Not available yet").
  - Right: "+ Connect" (secondary) if available, else muted "Not available yet".
  - If connected: a divider + list of connected accounts (display name + @handle)
    each with a "Disconnect" (danger text) action.
- Loading: 4 skeleton cards.

---

## SCREEN 6 — Publishing (`/dashboard/publishing`)
History/log of every publish attempt.
- Title "Publishing" + subtitle "Track every clip you've published and its status."
- **Empty state:** 📡, "Nothing published yet", "Publish a clip and it'll show up here."
- **List (rows, divided):** each row: small clip thumbnail; title (e.g. "Video Title
  | Part 8") + platform + timestamp/relative time + an "auto" badge if
  auto-scheduled; right side: **publication status badge**; if Failed → red
  "fetch failed" line + **Retry** button (re-runs in place, no duplicate row); if
  Published → "View ↗" external link. Auto-polls while anything is in progress.
- Loading: skeleton rows.

---

## SCREEN 7 — Generic footage library (`/dashboard/generic`)
Shared stock-clip library used by "Generic" footage mode.
- Title "Generic footage" + subtitle: "Stock clips for Generic mode — they replace
  the visuals while your original audio is kept. Uploads are automatically converted
  to vertical (9:16). This library is shared with everyone."
- "⬆ Upload generic videos" primary button (multi-select). While uploading: shows
  "Uploading… %" then "Converting to 9:16…" + a progress bar.
- **Grid of vertical (9:16) clip cards** (denser, 3 / 4 / 6 columns): each card is a
  9:16 video player + filename (e.g. "1.mp4") + size. Files are auto-numbered
  (1, 2, 3…). No delete (shared library).
- Empty state: 🎞️, "No generic footage yet", "Upload stock clips to use as
  background footage."

---

## SCREEN 8 — Settings (`/dashboard/settings`)
Creator profile + auto-publishing preferences.
- Title "Settings" + subtitle "Your creator profile and auto-publishing preferences."
- **Username card:** label "Username", helper "Added as a watermark on every clip
  you create. Leave blank for none." An input prefixed with a fixed "@" + Save
  button (shows ✓ on success).
- **Auto-publishing section:** card with:
  - Toggle "Enable auto-publishing" + helper.
  - "Posting interval" — preset chips (Every 2h/6h/12h/Daily) + custom minutes input.
  - "Platforms" — selectable chips of connected platforms (icon + label, ✓ when on);
    if none connected, a prompt to connect first.
  - "Posting window (optional, local time)" — two hour inputs (from / to).
  - Save button + "Saved ✓"; "Next run: <time>" when enabled.
- Loading: skeletons.

---

## OVERLAY A — Publish dialog (single clip)
Centered modal (scale-in over blurred backdrop).
- Title "Publish clip". Platform picker (chips of connected accounts). **Title**
  (read-only, from video title + Part N — helper "Set from the video title. Edit
  the video title to change it."). **Description** textarea (editable, prefilled
  with clip text + hashtags, 2200 char limit). Publish (primary) + Cancel.
- States: idle, publishing (spinner), error banner.

## OVERLAY B — Publish All dialog
Centered modal.
- Title "Publish all clips" + "N ready clips will be queued to the selected platforms."
- **Platforms** chips (multi-select). **Minutes between clips** — preset chips
  (5/10/15/20/30/60) + custom input. Helper: "Posts in order — the first clip goes
  out now, each next clip publishes N min after the previous one succeeds. A failed
  clip pauses the queue until you retry it." Confirm (primary) + Cancel. If no
  connected accounts: prompt to connect first.

## OVERLAY C — Reprocess dialog
Centered modal, pre-filled from the video. Same controls as the New Video panel:
clip mode (Viral/Full mode cards), mode-specific settings, captions toggle,
spoken language (when captions on), footage (Original/Generic, full-video only).
Note "Existing clips will be replaced." Reprocess (primary) + Cancel.

## OVERLAY D — Toasts
Bottom-center/-right stacked toasts (success/error/info), slide+scale in,
auto-dismiss ~4.5s.

---

## SCREEN 9 — Legal (`/privacy`, `/terms`, `/data-deletion`)
Simple centered long-form text pages (readable prose column, headings, muted body),
consistent with the dark theme. Low design priority — keep clean and legible.

---

## Notes for the designer
- It's a **dark-first** product; a light theme is optional, not required.
- The two visual "hero" surfaces are the **Landing hero** and the **clip grid**
  (9:16 previews) — make those shine.
- Keep the information-dense areas (video rows, publishing log, settings) scannable:
  clear hierarchy, generous spacing, restrained use of the purple accent.
- Every list has three states to design: **loading (skeleton)**, **empty**, **populated**.
- Every async action has: idle → pending (spinner/label) → success/error (toast/inline).

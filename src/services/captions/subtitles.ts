/**
 * Caption generation from word-level transcript timings.
 *
 * Produces two formats from the same cue list:
 *   - ASS: styled, centered captions for burn-in (libass via FFmpeg), with
 *     optional animated ("interactive") looks — karaoke word-highlight and pop.
 *   - SRT: a portable sidecar the user can download or re-upload.
 *
 * Words are grouped into short, readable cues and re-timed relative to the clip
 * start (the trimmed clip begins at t=0).
 */
import type { TranscriptWord } from "@/services/video/transcription";
import { VERTICAL_WIDTH, VERTICAL_HEIGHT } from "@/services/video/ffmpeg";

interface CueWord {
  word: string;
  start: number; // clip-relative seconds
  end: number;
}
export interface Cue {
  start: number;
  end: number;
  text: string;
  words: CueWord[];
}

// Short cues read better and fit the bigger fonts on a 1080-wide frame.
const MAX_WORDS_PER_CUE = 4;
const MAX_CUE_DURATION = 2.6;
const MAX_CHARS_PER_CUE = 26;

export interface CaptionResult {
  ass: string;
  srt: string;
  text: string;
  cues: Cue[];
}

// Subtitle look presets. ASS colours are &HAABBGGRR (alpha,blue,green,red).
// `latinFont` swaps the face for Latin text only (non-Latin keeps its script
// font). `animate` adds a dynamic effect: karaoke word-highlight or a pop-in.
export type CaptionStyle =
  | "default"
  | "bold"
  | "yellow"
  | "green"
  | "boxed"
  | "karaoke"
  | "pop";

interface StyleSpec {
  primary: string;
  secondary: string; // karaoke "not-yet-spoken" colour; otherwise unused
  outline: string;
  back: string;
  borderStyle: 1 | 3; // 1 = outline+shadow, 3 = opaque box
  outlineW: number;
  fontsize: number;
  latinFont?: string;
  animate?: "karaoke" | "pop";
}

const WHITE = "&H00FFFFFF";
const BLACK = "&H00000000";
const YELLOW = "&H0000FFFF";
const GREEN = "&H0000FF00";

export const CAPTION_STYLES: Record<CaptionStyle, StyleSpec> = {
  default: { primary: WHITE, secondary: WHITE, outline: BLACK, back: "&H64000000", borderStyle: 1, outlineW: 6, fontsize: 84 },
  bold: { primary: WHITE, secondary: WHITE, outline: BLACK, back: "&H64000000", borderStyle: 1, outlineW: 10, fontsize: 120, latinFont: "Impact" },
  yellow: { primary: YELLOW, secondary: YELLOW, outline: BLACK, back: "&H64000000", borderStyle: 1, outlineW: 9, fontsize: 104 },
  green: { primary: GREEN, secondary: GREEN, outline: BLACK, back: "&H64000000", borderStyle: 1, outlineW: 9, fontsize: 104 },
  boxed: { primary: WHITE, secondary: WHITE, outline: BLACK, back: "&HB0000000", borderStyle: 3, outlineW: 5, fontsize: 92 },
  karaoke: { primary: YELLOW, secondary: WHITE, outline: BLACK, back: "&H64000000", borderStyle: 1, outlineW: 9, fontsize: 108, animate: "karaoke" },
  pop: { primary: WHITE, secondary: WHITE, outline: BLACK, back: "&H64000000", borderStyle: 1, outlineW: 9, fontsize: 108, animate: "pop" },
};

export const CAPTION_STYLE_LABELS: Record<CaptionStyle, string> = {
  default: "Classic (white)",
  bold: "Bold (Impact)",
  yellow: "Bold yellow",
  green: "Bold green",
  boxed: "Boxed",
  karaoke: "Karaoke — word highlight",
  pop: "Pop — animated",
};

export interface CaptionOptions {
  /** .ass font family (must be findable by libass). Default "Arial". */
  fontFamily?: string;
  /** Uppercase the burned text (Latin only). Default true. */
  uppercase?: boolean;
  /** Visual preset. Default "default". */
  style?: CaptionStyle;
}

export function buildCaptions(
  words: TranscriptWord[],
  startSec: number,
  endSec: number,
  opts: CaptionOptions = {},
): CaptionResult {
  const windowWords = words
    .filter((w) => w.end > startSec && w.start < endSec)
    .map((w) => ({
      start: Math.max(0, w.start - startSec),
      end: Math.max(0, Math.min(endSec, w.end) - startSec),
      word: w.word.trim(),
    }))
    .filter((w) => w.word.length > 0);

  const cues = groupIntoCues(windowWords);
  const text = cues.map((c) => c.text).join(" ");

  const baseFont = opts.fontFamily ?? "Arial";
  const spec = CAPTION_STYLES[opts.style ?? "default"] ?? CAPTION_STYLES.default;
  // Only swap to a Latin display font when the script font is the Latin default.
  const fontFamily = spec.latinFont && baseFont === "Arial" ? spec.latinFont : baseFont;

  return {
    ass: buildAss(cues, { fontFamily, uppercase: opts.uppercase ?? true, spec }),
    srt: buildSrt(cues),
    text,
    cues,
  };
}

function groupIntoCues(words: CueWord[]): Cue[] {
  const cues: Cue[] = [];
  let current: CueWord[] = [];

  const flush = () => {
    if (!current.length) return;
    cues.push({
      start: current[0].start,
      end: Math.max(current[current.length - 1].end, current[0].start + 0.4),
      text: current.map((w) => w.word).join(" "),
      words: current,
    });
    current = [];
  };

  for (const w of words) {
    if (!current.length) {
      current = [w];
      continue;
    }
    const candidateLen = current.map((x) => x.word).join(" ").length + 1 + w.word.length;
    const tooLong =
      current.length >= MAX_WORDS_PER_CUE ||
      candidateLen > MAX_CHARS_PER_CUE ||
      w.end - current[0].start > MAX_CUE_DURATION ||
      /[.!?]$/.test(current[current.length - 1].word); // break on sentence end

    if (tooLong) {
      flush();
      current = [w];
    } else {
      current.push(w);
    }
  }
  flush();
  return cues;
}

// ---- ASS (Advanced SubStation Alpha) for burn-in --------------------------

function buildAss(
  cues: Cue[],
  opts: { fontFamily: string; uppercase: boolean; spec: StyleSpec },
): string {
  const { fontFamily, uppercase, spec } = opts;
  const cased = (s: string) => (uppercase ? s.toUpperCase() : s);
  const styleLine = `Style: Default,${fontFamily},${spec.fontsize},${spec.primary},${spec.secondary},${spec.outline},${spec.back},-1,0,${spec.borderStyle},${spec.outlineW},3,2,80,80,340,1`;
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${VERTICAL_WIDTH}
PlayResY: ${VERTICAL_HEIGHT}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLine}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const lines = cues.map((c) => {
    let body: string;
    if (spec.animate === "karaoke") {
      // Sweep the highlight across each word in sync with when it's spoken.
      const parts: string[] = [];
      let cursor = c.start;
      for (const w of c.words) {
        const gap = Math.max(0, Math.round((w.start - cursor) * 100));
        if (gap > 0) parts.push(`{\\k${gap}}`);
        const dur = Math.max(6, Math.round((w.end - w.start) * 100));
        parts.push(`{\\kf${dur}}${escapeAss(cased(w.word))} `);
        cursor = w.end;
      }
      body = parts.join("");
    } else if (spec.animate === "pop") {
      // Fade + scale-up as the cue appears.
      body = `{\\fad(110,60)\\fscx55\\fscy55\\t(0,150,\\fscx100\\fscy100)}${escapeAss(cased(c.text))}`;
    } else {
      body = escapeAss(cased(c.text));
    }
    return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${body}`;
  });
  return `${header}\n${lines.join("\n")}\n`;
}

function escapeAss(text: string): string {
  return text.replace(/\n/g, "\\N").replace(/\{/g, "(").replace(/\}/g, ")");
}

function assTime(sec: number): string {
  const cs = Math.round((sec - Math.floor(sec)) * 100);
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

// ---- SRT sidecar ----------------------------------------------------------

function buildSrt(cues: Cue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join("\n");
}

function srtTime(sec: number): string {
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

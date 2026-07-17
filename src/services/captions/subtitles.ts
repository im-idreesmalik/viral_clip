/**
 * Caption generation from word-level transcript timings.
 *
 * Produces two common formats from the same cue list:
 *   - ASS: styled, centered, bold captions for burn-in (libass via FFmpeg).
 *   - SRT: a portable sidecar file the user can download or re-upload.
 *
 * Words are grouped into short, readable cues (a few words each) and re-timed
 * relative to the clip start (the trimmed clip begins at t=0).
 */
import type { TranscriptWord } from "@/services/video/transcription";
import { VERTICAL_WIDTH, VERTICAL_HEIGHT } from "@/services/video/ffmpeg";

export interface Cue {
  start: number; // clip-relative seconds
  end: number;
  text: string;
}

const MAX_WORDS_PER_CUE = 5;
const MAX_CUE_DURATION = 2.6;
const MAX_CHARS_PER_CUE = 36;

export interface CaptionResult {
  ass: string;
  srt: string;
  text: string;
  cues: Cue[];
}

/**
 * Build captions for the window [startSec, endSec] of the source video.
 * Returns empty (but valid) files when no words fall in the window.
 */
// Subtitle look presets. ASS colours are &HAABBGGRR (alpha,blue,green,red).
// `latinFont` swaps the face for Latin text only (non-Latin keeps its script font).
export type CaptionStyle = "default" | "bold" | "yellow" | "boxed";
interface StyleSpec {
  primary: string;
  outline: string;
  back: string;
  borderStyle: 1 | 3; // 1 = outline+shadow, 3 = opaque box
  outlineW: number;
  fontsize: number;
  latinFont?: string;
}
export const CAPTION_STYLES: Record<CaptionStyle, StyleSpec> = {
  default: { primary: "&H00FFFFFF", outline: "&H00000000", back: "&H64000000", borderStyle: 1, outlineW: 5, fontsize: 72 },
  bold: { primary: "&H00FFFFFF", outline: "&H00000000", back: "&H64000000", borderStyle: 1, outlineW: 7, fontsize: 84, latinFont: "Impact" },
  yellow: { primary: "&H0000FFFF", outline: "&H00000000", back: "&H64000000", borderStyle: 1, outlineW: 7, fontsize: 78 },
  boxed: { primary: "&H00FFFFFF", outline: "&H00000000", back: "&HB0000000", borderStyle: 3, outlineW: 4, fontsize: 70 },
};
export const CAPTION_STYLE_LABELS: Record<CaptionStyle, string> = {
  default: "Classic (white)",
  bold: "Bold display",
  yellow: "Bold yellow",
  boxed: "Boxed",
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
  const spec = CAPTION_STYLES[opts.style ?? "default"];
  // Only swap to a Latin display font when the script font is the Latin default.
  const fontFamily = spec.latinFont && baseFont === "Arial" ? spec.latinFont : baseFont;

  return {
    ass: buildAss(cues, { fontFamily, uppercase: opts.uppercase ?? true, spec }),
    srt: buildSrt(cues),
    text,
    cues,
  };
}

function groupIntoCues(words: { start: number; end: number; word: string }[]): Cue[] {
  const cues: Cue[] = [];
  let current: { start: number; end: number; words: string[] } | null = null;

  const flush = () => {
    if (current && current.words.length) {
      cues.push({
        start: current.start,
        end: Math.max(current.end, current.start + 0.4),
        text: current.words.join(" "),
      });
    }
    current = null;
  };

  for (const w of words) {
    if (!current) {
      current = { start: w.start, end: w.end, words: [w.word] };
      continue;
    }
    const candidateLen = current.words.join(" ").length + 1 + w.word.length;
    const tooLong =
      current.words.length >= MAX_WORDS_PER_CUE ||
      candidateLen > MAX_CHARS_PER_CUE ||
      w.end - current.start > MAX_CUE_DURATION ||
      /[.!?]$/.test(current.words[current.words.length - 1]); // break on sentence end

    if (tooLong) {
      flush();
      current = { start: w.start, end: w.end, words: [w.word] };
    } else {
      current.words.push(w.word);
      current.end = w.end;
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
  const styleLine = `Style: Default,${fontFamily},${spec.fontsize},${spec.primary},${spec.outline},${spec.back},-1,0,${spec.borderStyle},${spec.outlineW},2,2,80,80,420,1`;
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${VERTICAL_WIDTH}
PlayResY: ${VERTICAL_HEIGHT}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLine}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const lines = cues.map((c) => {
    const text = escapeAss(uppercase ? c.text.toUpperCase() : c.text);
    return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${text}`;
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

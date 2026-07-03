/**
 * Pick a burn-in caption font family for a transcription language so non-Latin
 * scripts render properly (instead of tofu boxes). The font files live in
 * env.fontsDir and are loaded by libass via `subtitles=…:fontsdir=…`.
 */
export interface CaptionFont {
  /** Font family name — must match the .ass Style Fontname and a font on disk. */
  family: string;
  /** Uppercase the cue text? Only meaningful for Latin scripts. */
  uppercase: boolean;
}

// Arabic-script languages (incl. Urdu). We use Noto Naskh Arabic — it shapes
// reliably in libass and is legible; Nastaliq is too complex for libass (tofu).
const ARABIC_SCRIPT = new Set(["ur", "ar", "fa", "ps"]);
const DEVANAGARI = new Set(["hi", "mr", "ne"]);

export function captionFont(language: string | null | undefined): CaptionFont {
  const lang = (language || "auto").toLowerCase();
  if (ARABIC_SCRIPT.has(lang)) return { family: "Noto Naskh Arabic", uppercase: false };
  if (DEVANAGARI.has(lang)) return { family: "Noto Sans Devanagari", uppercase: false };
  // Latin / auto-detect: the default look (bold uppercase Arial).
  return { family: "Arial", uppercase: true };
}

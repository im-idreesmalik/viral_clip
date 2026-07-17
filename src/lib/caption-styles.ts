/**
 * Client-safe caption-style options for the UI selectors. The values must match
 * the keys of CAPTION_STYLES in src/services/captions/subtitles.ts (which is
 * server-only — it imports ffmpeg, so it can't be imported into client code).
 */
export const CAPTION_STYLE_OPTIONS = [
  { value: "default", label: "Classic (white)" },
  { value: "bold", label: "Bold (Impact)" },
  { value: "yellow", label: "Bold yellow" },
  { value: "green", label: "Bold green" },
  { value: "boxed", label: "Boxed" },
  { value: "karaoke", label: "Karaoke — word highlight" },
  { value: "pop", label: "Pop — animated" },
] as const;

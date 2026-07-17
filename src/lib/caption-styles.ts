/**
 * Client-safe caption-style options for the UI selectors. The values must match
 * the keys of CAPTION_STYLES in src/services/captions/subtitles.ts (which is
 * server-only — it imports ffmpeg, so it can't be imported into client code).
 */
export const CAPTION_STYLE_OPTIONS = [
  { value: "default", label: "Classic (white)" },
  { value: "bold", label: "Bold display" },
  { value: "yellow", label: "Bold yellow" },
  { value: "boxed", label: "Boxed" },
] as const;

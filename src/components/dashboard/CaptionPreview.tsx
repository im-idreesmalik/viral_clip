"use client";

import { useEffect, useState } from "react";

/**
 * A live, in-browser approximation of how burned-in subtitles will look for the
 * chosen style + spoken language. It can't be pixel-perfect (the real captions
 * are rendered by libass server-side), but it mirrors the important cues:
 * colour, outline, the Impact face for "bold", the box, the karaoke word-sweep,
 * the pop animation, plus the script + text direction (RTL for Urdu/Arabic,
 * Devanagari for Hindi, uppercase Latin for English/Hinglish).
 */

const RTL = new Set(["ur", "ar", "fa", "ps"]);
const DEVANAGARI = new Set(["hi", "mr", "ne"]);

const LATIN_FONT = "Arial, 'Helvetica Neue', system-ui, sans-serif";
const ARABIC_FONT = "'Noto Naskh Arabic', 'Segoe UI', Tahoma, sans-serif";
const DEVANAGARI_FONT = "'Noto Sans Devanagari', 'Nirmala UI', system-ui, sans-serif";
const IMPACT_FONT = "Impact, 'Arial Narrow Bold', 'Arial Black', sans-serif";
const HIGHLIGHT = "#ffe100";

function sampleWords(language: string): string[] {
  const l = (language || "auto").toLowerCase();
  if (RTL.has(l)) return ["کہانی", "سنو", "دل", "کی", "بات"];
  if (DEVANAGARI.has(l)) return ["यह", "कहानी", "ज़रूर", "सुनो"];
  if (l === "hi-latn") return ["KAHANI", "SUNO", "DIL", "KI", "BAAT"];
  return ["THIS", "IS", "GONNA", "BE", "HUGE"];
}

interface StyleDef {
  color: string;
  strokeW: number;
  weight: number;
  impact?: boolean;
  scale: number;
  box?: boolean;
  karaoke?: boolean;
  pop?: boolean;
}

const STYLES: Record<string, StyleDef> = {
  default: { color: "#ffffff", strokeW: 2, weight: 800, scale: 1 },
  bold: { color: "#ffffff", strokeW: 3, weight: 900, impact: true, scale: 1.34 },
  yellow: { color: "#ffe100", strokeW: 2.5, weight: 800, scale: 1.16 },
  green: { color: "#26e05a", strokeW: 2.5, weight: 800, scale: 1.16 },
  boxed: { color: "#ffffff", strokeW: 0, weight: 800, scale: 1.04, box: true },
  karaoke: { color: "#ffffff", strokeW: 2.5, weight: 800, scale: 1.2, karaoke: true },
  pop: { color: "#ffffff", strokeW: 2.5, weight: 800, scale: 1.2, pop: true },
};

export function CaptionPreview({ style, language }: { style: string; language: string }) {
  const def = STYLES[style] ?? STYLES.default;
  const l = (language || "auto").toLowerCase();
  const rtl = RTL.has(l);
  const isLatin = !rtl && !DEVANAGARI.has(l);
  const words = sampleWords(language);

  // Karaoke: sweep a highlight across the words (right-to-left for RTL, since the
  // words render in logical order under dir="rtl"), then hold and restart.
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!def.karaoke) return;
    setIdx(0);
    const t = setInterval(() => setIdx((i) => (i + 1) % (words.length + 2)), 520);
    return () => clearInterval(t);
  }, [def.karaoke, style, language, words.length]);

  const fontFamily = def.impact && isLatin
    ? IMPACT_FONT
    : rtl
      ? ARABIC_FONT
      : DEVANAGARI.has(l)
        ? DEVANAGARI_FONT
        : LATIN_FONT;

  const textStyle: React.CSSProperties = {
    fontFamily,
    fontWeight: def.weight,
    color: def.color,
    textTransform: isLatin ? "uppercase" : "none",
    letterSpacing: isLatin ? "0.01em" : undefined,
    lineHeight: 1.18,
    fontSize: `${Math.round(20 * def.scale)}px`,
    maxWidth: "88%",
    textAlign: "center",
    ...(def.strokeW > 0
      ? {
          WebkitTextStroke: `${def.strokeW}px #000`,
          paintOrder: "stroke" as const,
          textShadow: "0 2px 6px rgba(0,0,0,0.6)",
        }
      : { textShadow: "0 2px 6px rgba(0,0,0,0.6)" }),
    ...(def.box ? { background: "rgba(0,0,0,0.82)", borderRadius: 6, padding: "3px 12px" } : {}),
  };

  return (
    <div className="mt-3">
      <div className="mb-1.5 text-xs font-medium text-ink-400">Live preview</div>
      <div
        className="relative flex items-end justify-center overflow-hidden rounded-xl border border-ink-700"
        style={{
          aspectRatio: "16 / 10",
          background: "radial-gradient(120% 85% at 50% 0%, #3a2f63 0%, #1c1930 55%, #0d0c17 100%)",
        }}
      >
        {/* Faint diagonal texture so the caption reads like it's over footage. */}
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{ background: "repeating-linear-gradient(115deg, transparent 0 22px, rgba(255,255,255,0.035) 22px 44px)" }}
        />
        <div
          dir={rtl ? "rtl" : "ltr"}
          className={def.pop ? "animate-caption-pop" : undefined}
          style={{ ...textStyle, marginBottom: "15%" }}
        >
          {def.karaoke
            ? words.map((w, i) => (
                <span key={i} style={{ color: i <= idx - 1 ? HIGHLIGHT : def.color, transition: "color 0.12s" }}>
                  {w}
                  {i < words.length - 1 ? " " : ""}
                </span>
              ))
            : words.join(" ")}
        </div>
      </div>
    </div>
  );
}

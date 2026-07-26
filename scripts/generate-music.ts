/**
 * Generate a library of unique background-music beds — warm, calm ambient pads
 * synthesized locally with ffmpeg (layered detuned oscillators + tremolo + a
 * little reverb). No model or download needed; runs fully offline. Each track is
 * a distinct chord/key/mood so users get a unique bed. Idempotent by title.
 *
 *   npx tsx scripts/generate-music.ts
 */
import "@/workers/loadEnv";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import { prisma } from "@/lib/db";
import { resolveKey, ensureDirFor } from "@/lib/storage";

const execFileAsync = promisify(execFile);
const FF = (ffmpegStatic as string) || "ffmpeg";
const DUR = 45; // seconds; looped to any clip length at render time

// root = base frequency (key); chord = interval ratios; trem = tremolo speed.
const TRACKS = [
  { title: "Calm", mood: "Calm", root: 130.81, chord: [1, 1.25, 1.5, 2], trem: 0.15 },
  { title: "Warm Embrace", mood: "Warm", root: 220, chord: [1, 1.2, 1.5, 2], trem: 0.12 },
  { title: "Mystic", mood: "Mystic", root: 146.83, chord: [1, 1.5, 2, 3], trem: 0.1 },
  { title: "Dreamy", mood: "Dreamy", root: 174.61, chord: [1, 1.25, 1.5, 2.25], trem: 0.13 },
  { title: "Deep Focus", mood: "Deep", root: 110, chord: [1, 1.2, 1.5, 2], trem: 0.08 },
  { title: "Bright Morning", mood: "Bright", root: 196, chord: [1, 1.25, 1.5, 2], trem: 0.18 },
  { title: "Cinematic", mood: "Cinematic", root: 130.81, chord: [1, 1.2, 1.5, 2], trem: 0.1 },
  { title: "Serene", mood: "Serene", root: 146.83, chord: [1, 1.25, 1.5, 2], trem: 0.14 },
  { title: "Nocturne", mood: "Night", root: 164.81, chord: [1, 1.2, 1.5, 2], trem: 0.09 },
  { title: "Ethereal", mood: "Ethereal", root: 164.81, chord: [1, 1.5, 2, 3], trem: 0.11 },
  { title: "Golden Hour", mood: "Golden", root: 174.61, chord: [1, 1.25, 1.5, 2], trem: 0.16 },
  { title: "Reverie", mood: "Soft", root: 196, chord: [1, 1.2, 1.5, 2.25], trem: 0.12 },
];

function ffArgs(freqs: number[], trem: number, outPath: string): string[] {
  // Each note doubled with a slight detune for a warm chorus/beating.
  const voices = freqs.flatMap((f) => [f, f * 1.006]);
  const inputs = voices.flatMap((f) => ["-f", "lavfi", "-i", `sine=frequency=${f.toFixed(2)}:duration=${DUR}`]);
  const mix = voices.map((_, i) => `[${i}]`).join("");
  const rate = Math.max(0.1, trem); // ffmpeg tremolo requires f >= 0.1 Hz
  const fc =
    `${mix}amix=inputs=${voices.length}:normalize=1[m];` +
    // Normalize each track to a consistent, healthy loudness so the bed is
    // audible after it's ducked under the voice at render time.
    `[m]tremolo=f=${rate}:d=0.5,aecho=0.8:0.85:73|131:0.35|0.2,lowpass=f=2400,loudnorm=I=-16:TP=-1.5[a]`;
  return [...inputs, "-filter_complex", fc, "-map", "[a]", "-ac", "2", "-ar", "44100", "-b:a", "128k", "-y", outPath];
}

async function main() {
  // Clear any incomplete rows from a previous failed run.
  await prisma.backgroundMusic.deleteMany({ where: { storageKey: "" } });

  for (const t of TRACKS) {
    const exists = await prisma.backgroundMusic.findFirst({
      where: { title: t.title, NOT: { storageKey: "" } },
      select: { id: true },
    });
    if (exists) {
      console.log(`skip (exists): ${t.title}`);
      continue;
    }
    const row = await prisma.backgroundMusic.create({
      data: { title: t.title, mood: t.mood, source: "GENERATED", storageKey: "" },
    });
    try {
      const storageKey = `music/${row.id}.mp3`;
      await ensureDirFor(storageKey);
      const freqs = t.chord.map((r) => t.root * r);
      await execFileAsync(FF, ffArgs(freqs, t.trem, resolveKey(storageKey)), { maxBuffer: 1024 * 1024 * 16 });
      await prisma.backgroundMusic.update({ where: { id: row.id }, data: { storageKey, durationSec: DUR } });
      console.log(`created: ${t.title} (${t.mood})`);
    } catch (err) {
      await prisma.backgroundMusic.delete({ where: { id: row.id } }).catch(() => undefined);
      console.error(`FAILED: ${t.title} — ${err instanceof Error ? err.message : err}`);
    }
  }
  const total = await prisma.backgroundMusic.count();
  console.log(`done — ${total} tracks in the library`);
  process.exit(0);
}

main().catch((e) => {
  console.error("music generation failed:", e?.message || e);
  process.exit(1);
});

/**
 * LOCAL visual-event discovery — FREE, FFmpeg-only, transcript-INDEPENDENT.
 *
 * Answers only "where might something visually interesting be happening?" using
 * cheap signals — it does NOT judge virality (that's the vision model's job).
 * A visually strong moment can become a candidate even with no speech at all.
 *
 * Signals: (A) scene cuts, (B) activity via cut density, (C) windowed audio RMS
 * (reactions/impacts/peaks — NOT speech), (D) periodic coverage for long shots.
 * Results are clustered, capped (MAX_VISUAL_CANDIDATES) and cached per video.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { detectScenes, extractPcmF32, type SceneCut } from "@/services/video/ffmpeg";
import type { VisualCandidate, VisualSignals } from "./types";

const log = createLogger("ai:visual");

const MIN_CLIP = 15;
const MAX_CLIP = 60;
const TARGET_WIN = 30; // preferred candidate length
const CLUSTER_GAP = 12; // merge interest points within this many seconds
const PCM_HZ = 16000; // extractPcmF32 sample rate
const RMS_WIN_SEC = 2;

interface Point { t: number; weight: number; cut: boolean; audio: boolean }

function cacheFile(videoId: string): string {
  return path.join(env.storageDir, "cache", videoId, "visual.json");
}

/** Discover visual candidates. Transcript-independent. Returns [] on any failure. */
export async function discoverVisualCandidates(
  sourcePath: string,
  durationSec: number,
  videoId: string,
  hasAudio: boolean,
): Promise<VisualCandidate[]> {
  // Cache (skip re-running scene detection + RMS for the same video).
  const cf = cacheFile(videoId);
  try {
    const cached = JSON.parse(await fsp.readFile(cf, "utf8"));
    if (Array.isArray(cached?.candidates)) {
      log.info("Visual discovery cache hit", { videoId, candidates: cached.candidates.length });
      return cached.candidates as VisualCandidate[];
    }
  } catch { /* no cache */ }

  // (A) scene cuts
  let cuts: SceneCut[] = [];
  try {
    cuts = await detectScenes(sourcePath, env.sceneThreshold);
  } catch (err) {
    log.warn("Scene detection failed; continuing with audio + periodic only", { message: msg(err) });
  }

  // (C) audio energy — windowed RMS, normalized to the video's own peak.
  let energy: { t: number; rms: number }[] = [];
  if (hasAudio) {
    try {
      const pcm = await extractPcmF32(sourcePath);
      energy = windowedRms(pcm);
    } catch (err) {
      log.warn("Audio energy extraction failed; continuing", { message: msg(err) });
    }
  }
  const maxRms = energy.reduce((m, e) => Math.max(m, e.rms), 0) || 1;

  // Build interest points from cuts + audio peaks + periodic anchors.
  const points: Point[] = [];
  for (const c of cuts) points.push({ t: c.time, weight: clamp01(c.score), cut: true, audio: false });
  for (const e of energy) {
    const n = e.rms / maxRms;
    if (n >= 0.55) points.push({ t: e.t, weight: n, cut: false, audio: true }); // (D-ish) peaks
  }
  // (D) periodic coverage so long continuous shots aren't ignored.
  for (let t = env.visualSampleIntervalSec; t < durationSec - MIN_CLIP; t += env.visualSampleIntervalSec) {
    points.push({ t, weight: 0.2, cut: false, audio: false });
  }
  if (!points.length) return finish(videoId, cf, []);
  points.sort((a, b) => a.t - b.t);

  // Cluster nearby points into windows.
  const clusters: Point[][] = [];
  let cur: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.t - cur[cur.length - 1].t <= CLUSTER_GAP && p.t - cur[0].t < MAX_CLIP) cur.push(p);
    else { clusters.push(cur); cur = [p]; }
  }
  clusters.push(cur);

  // Turn each cluster into a candidate window + signals.
  let windows = clusters.map((pts) => toCandidate(pts, durationSec, cuts, energy, maxRms));
  // Merge windows that still overlap after padding (union, keep strongest signals).
  windows = mergeOverlaps(windows);
  // Keep the strongest, capped.
  windows.sort((a, b) => b.heuristicScore - a.heuristicScore);
  const capped = windows.slice(0, env.maxVisualCandidates).sort((a, b) => a.startSec - b.startSec);

  log.info("Visual discovery complete", {
    videoId, cuts: cuts.length, audioPeaks: energy.filter((e) => e.rms / maxRms >= 0.55).length,
    clusters: clusters.length, candidates: capped.length,
  });
  return finish(videoId, cf, capped);
}

async function finish(videoId: string, cf: string, candidates: VisualCandidate[]): Promise<VisualCandidate[]> {
  try { await fsp.mkdir(path.dirname(cf), { recursive: true }); await fsp.writeFile(cf, JSON.stringify({ videoId, candidates })); } catch { /* cache best-effort */ }
  return candidates;
}

function toCandidate(pts: Point[], durationSec: number, cuts: SceneCut[], energy: { t: number; rms: number }[], maxRms: number): VisualCandidate {
  let start = pts[0].t;
  let end = pts[pts.length - 1].t;
  // Pad to a sensible short length.
  if (end - start < TARGET_WIN) {
    const mid = (start + end) / 2;
    start = mid - TARGET_WIN / 2;
    end = mid + TARGET_WIN / 2;
  }
  start = Math.max(0, start);
  end = Math.min(durationSec, end);
  if (end - start < MIN_CLIP) end = Math.min(durationSec, start + MIN_CLIP);
  if (end - start > MAX_CLIP) end = start + MAX_CLIP;

  const winCuts = cuts.filter((c) => c.time >= start && c.time <= end);
  const sceneChange = winCuts.reduce((m, c) => Math.max(m, clamp01(c.score)), 0);
  const sceneDensity = winCuts.length / Math.max(1, (end - start) / 10); // cuts per 10s
  const motionActivity = clamp01(sceneDensity / 5);
  const winRms = energy.filter((e) => e.t >= start && e.t <= end).reduce((m, e) => Math.max(m, e.rms), 0);
  const audioEnergy = clamp01(winRms / maxRms);
  const signals: VisualSignals = {
    sceneChange: round(sceneChange), sceneDensity: round(sceneDensity),
    motionActivity: round(motionActivity), audioEnergy: round(audioEnergy),
  };
  const onlyAnchor = pts.every((p) => !p.cut && !p.audio);
  const computed = 100 * (0.45 * sceneChange + 0.25 * motionActivity + 0.30 * audioEnergy);
  const heuristicScore = Math.round(onlyAnchor ? 18 : Math.max(20, computed));
  return { startSec: round(start), endSec: round(end), source: "visual", heuristicScore, signals };
}

function mergeOverlaps(cands: VisualCandidate[]): VisualCandidate[] {
  const sorted = cands.slice().sort((a, b) => a.startSec - b.startSec);
  const out: VisualCandidate[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.startSec <= last.endSec && (Math.min(last.endSec, c.endSec) - c.startSec) > 0 && (last.endSec - last.startSec) < MAX_CLIP) {
      last.endSec = Math.min(last.startSec + MAX_CLIP, Math.max(last.endSec, c.endSec));
      last.heuristicScore = Math.max(last.heuristicScore, c.heuristicScore);
      last.signals = {
        sceneChange: Math.max(last.signals.sceneChange, c.signals.sceneChange),
        sceneDensity: Math.max(last.signals.sceneDensity, c.signals.sceneDensity),
        motionActivity: Math.max(last.signals.motionActivity, c.signals.motionActivity),
        audioEnergy: Math.max(last.signals.audioEnergy, c.signals.audioEnergy),
      };
    } else out.push({ ...c, signals: { ...c.signals } });
  }
  return out;
}

function windowedRms(pcm: Float32Array): { t: number; rms: number }[] {
  const win = PCM_HZ * RMS_WIN_SEC;
  const out: { t: number; rms: number }[] = [];
  for (let i = 0; i < pcm.length; i += win) {
    let sum = 0;
    const end = Math.min(i + win, pcm.length);
    for (let j = i; j < end; j++) sum += pcm[j] * pcm[j];
    const n = end - i;
    out.push({ t: (i + n / 2) / PCM_HZ, rms: Math.sqrt(sum / Math.max(1, n)) });
  }
  return out;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round = (n: number) => Math.round(n * 1000) / 1000;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Invalidate the visual cache for a video (used on reprocess). */
export async function clearVisualCache(videoId: string): Promise<void> {
  await fsp.rm(cacheFile(videoId), { force: true }).catch(() => undefined);
}

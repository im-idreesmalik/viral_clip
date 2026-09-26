/**
 * HYBRID viral-clip detection orchestrator.
 *
 *   transcript analysis (Groq gpt-oss-120b -> Ollama Gemma)   ┐
 *                                                             ├─ UNION merge
 *   local FFmpeg visual discovery (free, transcript-free)     ┘
 *                         │
 *              selective vision (frames only, shortlist)
 *                         │
 *                 final DetectedClip[]  (+ debug metadata)
 *
 * Runs A and B in parallel. Vision sees only shortlisted candidates' frames —
 * never the whole video. Every stage degrades gracefully: a visual/vision
 * failure never fails the job when transcript analysis succeeded. If the whole
 * thing yields nothing, the caller applies the time-based segmentation fallback.
 */
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { captureThumbnail } from "@/services/video/ffmpeg";
import type { Transcript } from "@/services/video/transcription";
import { detectViralClipsFallback } from "./clipDetection";
import { discoverVisualCandidates } from "./visualDiscovery";
import { mergeCandidates } from "./candidateMerge";
import { getVisionProvider, isVisionEnabled } from "./vision";
import type { DetectedClip, MergedCandidate } from "./types";

const log = createLogger("ai:hybrid");
const MAX_CLIP = 60;
// gemini-2.5-flash list price (video/image billed as input tokens).
const VISION_IN_PRICE = 0.30 / 1e6, VISION_OUT_PRICE = 2.50 / 1e6;

export interface HybridOptions {
  sourcePath: string;
  videoId: string;
  durationSec: number;
  hasAudio: boolean;
  transcript: Transcript | null;
  threshold: number;
  maxClips: number;
}

export interface HybridStats {
  analysisProvider: string;
  transcriptCount: number;
  visualCount: number;
  mergedCount: number;
  finalCount: number;
  analysisSec: number;
  visualSec: number;
  visionCalls: number;
  visionSec: number;
  visionCostUsd: number;
}

export async function hybridDetect(opts: HybridOptions): Promise<{ clips: DetectedClip[]; stats: HybridStats }> {
  // ---- A + B in parallel ----
  const analysisStart = Date.now();
  const transcriptP = (async () => {
    if (!opts.transcript || opts.transcript.segments.length === 0) return { clips: [] as DetectedClip[], provider: "none" };
    try {
      return await detectViralClipsFallback({
        transcript: opts.transcript, durationSec: opts.durationSec, threshold: opts.threshold, maxClips: opts.maxClips,
      });
    } catch (err) {
      log.warn("[TRANSCRIPT_ANALYSIS] all providers failed; continuing visual-only", { message: msg(err) });
      return { clips: [] as DetectedClip[], provider: "failed" };
    }
  })();
  const visualStart = Date.now();
  const visualP = (async () => {
    if (!env.visualDiscoveryEnabled) return [];
    try {
      return await discoverVisualCandidates(opts.sourcePath, opts.durationSec, opts.videoId, opts.hasAudio);
    } catch (err) {
      log.warn("[VISUAL_DISCOVERY] failed; continuing transcript-only", { message: msg(err) });
      return [];
    }
  })();

  const [{ clips: transcriptClips, provider }, visualCands] = await Promise.all([transcriptP, visualP]);
  const analysisSec = (Date.now() - analysisStart) / 1000;
  const visualSec = (Date.now() - visualStart) / 1000;
  log.info("[TRANSCRIPT_ANALYSIS]", { provider, clips: transcriptClips.length, sec: round1(analysisSec) });
  log.info("[VISUAL_DISCOVERY]", { candidates: visualCands.length, sec: round1(visualSec) });

  // ---- UNION merge ----
  const merged = mergeCandidates(transcriptClips, visualCands);
  log.info("[CANDIDATE_MERGE]", {
    transcript: transcriptClips.length, visual: visualCands.length, merged: merged.length,
    both: merged.filter((m) => m.source === "both").length,
    visualOnly: merged.filter((m) => m.source === "visual").length,
  });

  // ---- selective vision + final scoring ----
  const { clips, visionCalls, visionSec, visionCostUsd } = await evaluate(merged, opts);

  const stats: HybridStats = {
    analysisProvider: provider, transcriptCount: transcriptClips.length, visualCount: visualCands.length,
    mergedCount: merged.length, finalCount: clips.length, analysisSec: round1(analysisSec),
    visualSec: round1(visualSec), visionCalls, visionSec: round1(visionSec), visionCostUsd: round4(visionCostUsd),
  };
  return { clips, stats };
}

async function evaluate(merged: MergedCandidate[], opts: HybridOptions) {
  const visionOn = isVisionEnabled();
  const provider = visionOn ? getVisionProvider() : null;
  const priority = (m: MergedCandidate) => m.transcriptEvidence?.viralScore ?? m.visualEvidence?.heuristicScore ?? 0;
  const shortlist = new Set<MergedCandidate>(
    visionOn ? merged.slice().sort((a, b) => priority(b) - priority(a)).slice(0, env.visionMaxCandidates) : [],
  );

  const vcf = path.join(env.storageDir, "cache", opts.videoId, "vision.json");
  let vcache: Record<string, { viralScore: number; title: string; reason: string; usage?: { inputTokens: number; outputTokens: number } }> = {};
  try { vcache = JSON.parse(await fsp.readFile(vcf, "utf8")); } catch { /* none */ }

  let visionCalls = 0, inTok = 0, outTok = 0, cacheDirty = false;
  const visionStart = Date.now();
  const out: DetectedClip[] = [];

  for (const m of merged) {
    const excerpt = opts.transcript ? excerptFor(opts.transcript, m.startSec, m.endSec) : "";
    let finalScore: number | null = null, title = "", reason: string | null = null, multimodalScore: number | undefined;

    if (visionOn && provider && shortlist.has(m)) {
      const key = `${m.startSec.toFixed(1)}-${m.endSec.toFixed(1)}`;
      let vr = vcache[key];
      if (!vr) {
        try {
          const frames = await extractFrames(opts.sourcePath, m.startSec, m.endSec);
          if (frames.length) {
            vr = await provider.evaluateCandidate({
              startSec: m.startSec, endSec: m.endSec, source: m.source, frames,
              transcriptExcerpt: excerpt, signals: m.visualEvidence?.signals,
            });
            visionCalls++; inTok += vr.usage?.inputTokens ?? 0; outTok += vr.usage?.outputTokens ?? 0;
            vcache[key] = vr; cacheDirty = true;
          }
        } catch (err) {
          log.warn("[MULTIMODAL_ANALYSIS] candidate failed; using evidence", { window: `${m.startSec}-${m.endSec}`, message: msg(err) });
        }
      }
      if (vr) { finalScore = vr.viralScore; title = vr.title; reason = vr.reason; multimodalScore = vr.viralScore; }
    }

    // Evidence-based scoring when vision is off / not shortlisted / failed.
    if (finalScore == null) {
      if (m.transcriptEvidence) {
        finalScore = m.transcriptEvidence.viralScore ?? 60; // real transcript judgment
        title = m.transcriptEvidence.title;
        reason = m.transcriptEvidence.reason;
      } else if (m.visualEvidence) {
        // No vision judge available: the heuristic is NOT virality, so cap it so a
        // raw visual guess can't outrank transcript-judged clips.
        finalScore = Math.min(m.visualEvidence.heuristicScore, 75);
        title = excerpt ? excerpt.split(/\s+/).slice(0, 8).join(" ") : `Visual moment @ ${mmss(m.startSec)}`;
        reason = `Local visual signals — scene ${m.visualEvidence.signals.sceneChange}, motion ${m.visualEvidence.signals.motionActivity}, audio ${m.visualEvidence.signals.audioEnergy}.`;
      } else continue;
    }

    out.push({
      startSec: round(m.startSec), endSec: round(m.endSec),
      title: (title || "Clip").slice(0, 120), viralScore: Math.round(finalScore), reason, order: null,
      debug: {
        source: m.source, transcriptScore: m.transcriptEvidence?.viralScore ?? null,
        visualHeuristicScore: m.visualEvidence?.heuristicScore, multimodalScore, visualSignals: m.visualEvidence?.signals,
      },
    });
  }

  if (cacheDirty) {
    try { await fsp.mkdir(path.dirname(vcf), { recursive: true }); await fsp.writeFile(vcf, JSON.stringify(vcache)); } catch { /* best-effort */ }
  }
  const visionCostUsd = inTok * VISION_IN_PRICE + outTok * VISION_OUT_PRICE;
  if (visionCalls > 0) {
    log.info("[MULTIMODAL_ANALYSIS]", {
      provider: provider?.model, calls: visionCalls, inputTokens: inTok, outputTokens: outTok,
      costUsd: round4(visionCostUsd), sec: round1((Date.now() - visionStart) / 1000),
    });
  }

  // threshold -> dedup overlaps -> cap at maxClips (a MAX, not a target).
  const kept = out.filter((c) => (c.viralScore ?? 0) >= opts.threshold).sort((a, b) => (b.viralScore ?? 0) - (a.viralScore ?? 0));
  const selected: DetectedClip[] = [];
  for (const c of kept) {
    if (selected.length >= opts.maxClips) break;
    if (selected.some((s) => overlapRatio(s, c) > 0.5)) continue;
    selected.push(c);
  }
  return { clips: selected, visionCalls, visionSec: (Date.now() - visionStart) / 1000, visionCostUsd };
}

async function extractFrames(source: string, start: number, end: number) {
  const times = [Math.min(start + 1, end - 0.1), (start + end) / 2, Math.max(end - 1, start + 0.1)];
  const labels = ["start", "middle", "end"];
  const frames: { base64: string; mime: string; label: string }[] = [];
  for (let i = 0; i < times.length; i++) {
    const tmp = path.join(os.tmpdir(), `vc-vframe-${Date.now()}-${i}-${Math.round(Math.random() * 1e6)}.jpg`);
    try {
      await captureThumbnail(source, tmp, Math.max(0, times[i]), env.visionFrameWidth);
      const buf = await fsp.readFile(tmp);
      frames.push({ base64: buf.toString("base64"), mime: "image/jpeg", label: labels[i] });
    } catch { /* skip this frame */ } finally {
      await fsp.rm(tmp, { force: true }).catch(() => undefined);
    }
  }
  return frames;
}

function excerptFor(t: Transcript, start: number, end: number): string {
  const txt = t.segments.filter((s) => s.end > start && s.start < end).map((s) => s.text.trim()).join(" ").replace(/\s+/g, " ").trim();
  return txt.length > 500 ? txt.slice(0, 497) + "…" : txt;
}
function overlapRatio(a: DetectedClip, b: DetectedClip): number {
  const o = Math.max(0, Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec));
  const m = Math.min(a.endSec - a.startSec, b.endSec - b.startSec);
  return m > 0 ? o / m : 0;
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const round = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

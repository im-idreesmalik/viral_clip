/**
 * The end-to-end video processing pipeline.
 *
 *   source (download / upload) -> probe -> transcribe -> detect clips
 *   -> render each clip (9:16 + burned captions) -> thumbnails -> READY
 *
 * Orchestrated from the BullMQ video worker. Each stage updates the Video /
 * Clip status so the dashboard can show live progress, and failures are
 * captured per-record rather than aborting the whole batch.
 */
import path from "node:path";
import { ClipMode, VideoStatus, ClipStatus, VideoSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { env } from "@/lib/env";
import { resolveKey, ensureDirFor, writeFile, deleteKey } from "@/lib/storage";
import { probe, renderClip, captureThumbnail } from "./ffmpeg";
import { downloadVideo } from "./download";
import { transcribe, type Transcript } from "./transcription";
import { buildCaptions } from "@/services/captions/subtitles";
import { detectViralClips } from "@/services/ai/clipDetection";
import { segmentVideo } from "@/services/ai/segmentation";
import type { DetectedClip } from "@/services/ai/types";

const log = createLogger("pipeline");

export async function processVideo(videoId: string): Promise<void> {
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) throw new Error(`Video ${videoId} not found`);

  log.info("Processing video", { videoId, mode: video.clipMode, source: video.source });

  try {
    // 1. Ensure we have the source file on disk + its metadata.
    let storageKey = video.storageKey;
    if (video.source === VideoSource.YOUTUBE && !storageKey) {
      await setStatus(videoId, VideoStatus.DOWNLOADING);
      const destDir = resolveKey(`videos/${videoId}`);
      const result = await downloadVideo(video.sourceUrl!, destDir);
      storageKey = `videos/${videoId}/${path.basename(result.filePath)}`;
      await prisma.video.update({
        where: { id: videoId },
        data: { storageKey, title: video.title || result.title },
      });
    }
    if (!storageKey) throw new Error("No source media available for this video.");

    const sourcePath = resolveKey(storageKey);
    const meta = await probe(sourcePath);

    // Source thumbnail.
    const videoThumbKey = `videos/${videoId}/thumb.jpg`;
    await ensureDirFor(videoThumbKey);
    await captureThumbnail(sourcePath, resolveKey(videoThumbKey), Math.min(2, meta.durationSec / 2)).catch(
      () => undefined,
    );

    await prisma.video.update({
      where: { id: videoId },
      data: {
        durationSec: meta.durationSec,
        width: meta.width,
        height: meta.height,
        thumbnailKey: videoThumbKey,
      },
    });

    // 2. Transcribe — reuse a cached transcript (e.g. on reprocess) to skip the
    //    expensive re-run; otherwise transcribe once and cache it. Best-effort.
    await setStatus(videoId, VideoStatus.TRANSCRIBING);
    let transcript = (video.transcript as unknown as Transcript | null) ?? null;
    if (!transcript) {
      transcript = await transcribe(sourcePath);
      if (transcript) {
        await prisma.video.update({
          where: { id: videoId },
          data: { transcript: transcript as unknown as object },
        });
      }
    }

    // 3. Determine clips.
    await setStatus(videoId, VideoStatus.ANALYZING);
    const detected = await selectClips(video.clipMode, {
      durationSec: meta.durationSec,
      transcript,
      threshold: video.viralThreshold,
      segmentSeconds: video.segmentSeconds,
      maxClips: video.targetClipCount,
    });

    if (detected.length === 0) {
      throw new Error("No clips could be generated from this video.");
    }

    const createdClips = await prisma.$transaction(
      detected.map((c) =>
        prisma.clip.create({
          data: {
            videoId,
            title: c.title,
            startSec: c.startSec,
            endSec: c.endSec,
            viralScore: c.viralScore,
            reason: c.reason,
            order: c.order,
            status: ClipStatus.PENDING,
          },
        }),
      ),
    );

    // 4. Render clips — a few at a time so the CPU filters and the GPU encoder
    //    work in parallel instead of one clip blocking the next.
    await setStatus(videoId, VideoStatus.GENERATING);
    const concurrency = Math.max(1, env.clipRenderConcurrency);
    for (let i = 0; i < createdClips.length; i += concurrency) {
      const batch = createdClips.slice(i, i + concurrency);
      await Promise.all(
        batch.map((clip) =>
          renderClipRecord(clip.id).catch((err) => {
            log.error("Clip render failed", { clipId: clip.id, message: err.message });
          }),
        ),
      );
    }

    await setStatus(videoId, VideoStatus.READY);
    log.info("Video processing complete", { videoId, clips: createdClips.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Video processing failed", { videoId, message });
    await prisma.video.update({
      where: { id: videoId },
      data: { status: VideoStatus.FAILED, errorMessage: message },
    });
    throw err;
  }
}

interface SelectArgs {
  durationSec: number;
  transcript: Transcript | null;
  threshold: number;
  segmentSeconds: number;
  maxClips: number;
}

// FULL mode splits the ENTIRE video into parts, so don't cap by target count —
// just guard against pathological counts on very long videos.
const FULL_MODE_MAX_PARTS = 500;

async function selectClips(mode: ClipMode, args: SelectArgs): Promise<DetectedClip[]> {
  if (mode === ClipMode.FULL) {
    return segmentVideo({
      durationSec: args.durationSec,
      segmentSeconds: args.segmentSeconds,
      maxClips: FULL_MODE_MAX_PARTS,
      transcript: args.transcript,
    });
  }

  // VIRAL mode — needs a transcript to judge content; otherwise fall back.
  if (args.transcript && args.transcript.segments.length > 0) {
    try {
      const clips = await detectViralClips({
        transcript: args.transcript,
        durationSec: args.durationSec,
        threshold: args.threshold,
        maxClips: args.maxClips,
      });
      if (clips.length > 0) return clips;
      log.warn("AI returned no clips above threshold; falling back to segmentation.");
    } catch (err) {
      log.warn("AI detection failed; falling back to segmentation", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    log.warn("No transcript available for VIRAL mode; using segmentation fallback.");
  }
  return segmentVideo({
    durationSec: args.durationSec,
    segmentSeconds: args.segmentSeconds,
    maxClips: args.maxClips,
    transcript: args.transcript,
  });
}

/**
 * Render a single clip record: build captions from the transcript window,
 * trim + convert to 9:16 with burned captions, capture a thumbnail, and store
 * the SRT sidecar. Reused by the regenerate worker.
 */
export async function renderClipRecord(clipId: string): Promise<void> {
  const clip = await prisma.clip.findUnique({ where: { id: clipId }, include: { video: true } });
  if (!clip || !clip.video.storageKey) throw new Error(`Clip ${clipId} has no source`);

  await prisma.clip.update({ where: { id: clipId }, data: { status: ClipStatus.RENDERING } });

  const sourcePath = resolveKey(clip.video.storageKey);
  const clipKey = `clips/${clipId}/clip.mp4`;
  const thumbKey = `clips/${clipId}/thumb.jpg`;
  const captionsKey = `clips/${clipId}/captions.srt`;
  await ensureDirFor(clipKey);

  // Build captions from the stored transcript, if any.
  let subtitlePath: string | undefined;
  let captionText: string | null = null;
  // Write the burn-in .ass under the storage dir (same drive as the project) so
  // ffmpeg can reference it by a clean cwd-relative path on Windows.
  const assKey = `.captions/${clipId}.ass`;

  const transcript = clip.video.transcript as unknown as Transcript | null;
  // Only build/burn captions when the user enabled them for this video.
  if (clip.video.burnCaptions && transcript?.words?.length) {
    const captions = buildCaptions(transcript.words, clip.startSec, clip.endSec);
    if (captions.cues.length > 0) {
      await writeFile(assKey, Buffer.from(captions.ass, "utf8"));
      await writeFile(captionsKey, Buffer.from(captions.srt, "utf8"));
      subtitlePath = resolveKey(assKey);
      captionText = captions.text;
    }
  }

  try {
    await renderClip({
      input: sourcePath,
      output: resolveKey(clipKey),
      startSec: clip.startSec,
      endSec: clip.endSec,
      subtitlePath,
      partLabel:
        clip.video.clipMode === "FULL" && clip.order != null ? `Part ${clip.order}` : undefined,
      vertical: true,
    });

    const dur = clip.endSec - clip.startSec;
    await captureThumbnail(resolveKey(clipKey), resolveKey(thumbKey), Math.min(1, dur / 2)).catch(
      () => undefined,
    );

    await prisma.clip.update({
      where: { id: clipId },
      data: {
        status: ClipStatus.READY,
        storageKey: clipKey,
        thumbnailKey: thumbKey,
        captionsKey: subtitlePath ? captionsKey : null,
        captionText,
        durationSec: dur,
        width: 1080,
        height: 1920,
        errorMessage: null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.clip.update({
      where: { id: clipId },
      data: { status: ClipStatus.FAILED, errorMessage: message },
    });
    throw err;
  } finally {
    // The .ass is only needed during render; the SRT sidecar is kept for download.
    await deleteKey(assKey).catch(() => undefined);
  }
}

async function setStatus(videoId: string, status: VideoStatus) {
  await prisma.video.update({ where: { id: videoId }, data: { status } });
}

/**
 * Regenerate a clip.
 *   - variation=false: re-render the existing clip in place (e.g. after a
 *     failed render or a manual edit to its in/out points).
 *   - variation=true: create a NEW clip near the same moment with a slightly
 *     shifted window (a fresh "take" the user can compare against the original).
 */
export async function regenerateClip(clipId: string, variation = false): Promise<string> {
  const clip = await prisma.clip.findUnique({ where: { id: clipId }, include: { video: true } });
  if (!clip) throw new Error(`Clip ${clipId} not found`);

  if (!variation) {
    await renderClipRecord(clipId);
    return clipId;
  }

  // Build a shifted window for the variation, clamped to the source duration
  // and to platform-friendly length (15-60s).
  const duration = clip.video.durationSec ?? clip.endSec + 5;
  const len = clip.endSec - clip.startSec;
  // Pull the start a few seconds earlier to capture more of the lead-in hook.
  const shift = Math.min(4, clip.startSec);
  const newStart = Math.max(0, clip.startSec - shift);
  const newEnd = Math.min(duration, Math.max(newStart + 15, Math.min(newStart + len + shift, newStart + 60)));

  const variant = await prisma.clip.create({
    data: {
      videoId: clip.videoId,
      title: `${clip.title} (alt)`,
      startSec: round2(newStart),
      endSec: round2(newEnd),
      viralScore: clip.viralScore,
      reason: clip.reason,
      order: clip.order,
      status: ClipStatus.PENDING,
    },
  });

  await renderClipRecord(variant.id);
  return variant.id;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

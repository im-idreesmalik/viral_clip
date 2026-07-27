/**
 * Local AI background-music generation. Runs a text-to-music model in an
 * isolated Python subprocess, then normalizes + stores the result as an mp3 in
 * the shared library. Called from the stories worker so a slow generation never
 * blocks the web server.
 *
 * Backend is env.musicBackend:
 *   stable-audio -> Stable Audio Open (commercial use OK under $1M revenue).
 *   musicgen     -> Meta MusicGen (non-commercial only).
 */
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { resolveKey, ensureDirFor, deleteKey } from "@/lib/storage";
import { probe } from "@/services/video/ffmpeg";

const execFileAsync = promisify(execFile);
const log = createLogger("music");
if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic as string);

/** Generate a track from a text prompt and store it on the BackgroundMusic row. */
export async function generateMusicTrack(musicId: string, prompt: string, durationSec: number): Promise<void> {
  const wav = path.join(os.tmpdir(), `mg-${musicId}.wav`);
  const stableAudio = env.musicBackend !== "musicgen";
  try {
    // Stable Audio Open handles up to ~47s; MusicGen we keep short.
    const dur = stableAudio
      ? Math.max(5, Math.min(45, Math.round(durationSec) || 25))
      : Math.max(5, Math.min(30, Math.round(durationSec) || 25));
    const args = stableAudio
      ? [env.stableAudioScript, "--prompt", prompt, "--duration", String(dur), "--out", wav,
         "--model", env.stableAudioModel, "--steps", String(env.stableAudioSteps)]
      : [env.musicGenScript, "--prompt", prompt, "--duration", String(dur), "--out", wav, "--model", env.musicGenModel];
    log.info("Generating music", {
      musicId,
      backend: stableAudio ? "stable-audio" : "musicgen",
      model: stableAudio ? env.stableAudioModel : env.musicGenModel,
      durationSec: dur,
    });
    await execFileAsync(env.musicGenPython, args, {
      timeout: env.musicGenTimeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024 * 16,
      // Pass the HF token so the gated Stable Audio Open download can authenticate.
      env: { ...process.env, HF_TOKEN: env.hfToken, HUGGING_FACE_HUB_TOKEN: env.hfToken },
    });

    const key = `music/${musicId}.mp3`;
    await ensureDirFor(key);
    await wavToMp3(wav, resolveKey(key));
    const meta = await probe(resolveKey(key)).catch(() => null);
    await prisma.backgroundMusic.update({
      where: { id: musicId },
      data: { storageKey: key, durationSec: meta?.durationSec ?? dur },
    });
    log.info("Music ready", { musicId });
  } catch (err) {
    log.error("Music generation failed", { musicId, message: err instanceof Error ? err.message : String(err) });
    // Do NOT delete the row here: BullMQ retries this job, and a deleted row makes
    // every retry fail with "record not found" (the update below can't target it).
    // Final-attempt cleanup lives in the worker's failed handler (cleanupFailedMusicRow).
    throw err;
  } finally {
    await fsp.rm(wav, { force: true }).catch(() => undefined);
  }
}

/**
 * Remove a still-pending (never-saved) generation row. Called by the worker only
 * after BullMQ has exhausted all retries, so a permanently-failed generation
 * doesn't linger as "Generating…" forever. Idempotent: deleteMany won't throw if
 * the row is already gone or has since been filled in (storageKey no longer "").
 */
export async function cleanupFailedMusicRow(musicId: string): Promise<void> {
  await prisma.backgroundMusic.deleteMany({ where: { id: musicId, storageKey: "" } }).catch(() => undefined);
  // Also drop any orphan mp3 an attempt may have written before its DB update failed.
  await deleteKey(`music/${musicId}.mp3`).catch(() => undefined);
}

/** Encode the raw model wav to mp3, normalizing its (quiet) level to a good bed. */
function wavToMp3(wavPath: string, mp3Path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(wavPath)
      .audioFilters("loudnorm=I=-16:TP=-1.5")
      .audioCodec("libmp3lame")
      .audioBitrate("160k")
      .audioChannels(2)
      .format("mp3")
      .on("error", (err) => reject(new Error(`MP3 encode failed: ${err.message}`)))
      .on("end", () => resolve())
      .save(mp3Path);
  });
}

/**
 * Local AI background-music generation. Runs Meta's MusicGen in an isolated
 * Python subprocess (scripts/musicgen_generate.py), then normalizes + stores the
 * result as an mp3 in the shared library. Called from the stories worker so a
 * slow generation never blocks the web server.
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
import { resolveKey, ensureDirFor } from "@/lib/storage";
import { probe } from "@/services/video/ffmpeg";

const execFileAsync = promisify(execFile);
const log = createLogger("music");
if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic as string);

/** Generate a track from a text prompt and store it on the BackgroundMusic row. */
export async function generateMusicTrack(musicId: string, prompt: string, durationSec: number): Promise<void> {
  const wav = path.join(os.tmpdir(), `mg-${musicId}.wav`);
  try {
    const dur = Math.max(5, Math.min(30, Math.round(durationSec) || 25));
    log.info("Generating music", { musicId, model: env.musicGenModel, durationSec: dur });
    await execFileAsync(
      env.musicGenPython,
      [env.musicGenScript, "--prompt", prompt, "--duration", String(dur), "--out", wav, "--model", env.musicGenModel],
      { timeout: env.musicGenTimeoutMs, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 * 16 },
    );

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
    // Drop the pending row so it doesn't linger as "generating" forever.
    await prisma.backgroundMusic.delete({ where: { id: musicId } }).catch(() => undefined);
    throw err;
  } finally {
    await fsp.rm(wav, { force: true }).catch(() => undefined);
  }
}

/** Encode the raw MusicGen wav to mp3, normalizing its (quiet) level to a good bed. */
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

/**
 * FFmpeg wrapper: probing, audio extraction, clip trimming, 9:16 conversion,
 * caption burn-in, and thumbnail generation.
 *
 * Binaries: uses FFMPEG_PATH/FFPROBE_PATH if set, otherwise falls back to the
 * bundled ffmpeg-static / ffprobe-static packages so the app works without a
 * system install. All outputs target social-platform-friendly H.264/AAC MP4.
 */
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("ffmpeg");

// Resolve binary paths once: prefer explicit env overrides, fall back to the
// bundled static binaries, and finally to whatever is on PATH.
function resolveBinaries() {
  const ffmpegPath = env.ffmpegPath || ffmpegStatic || undefined;
  const ffprobePath = env.ffprobePath || ffprobeStatic?.path || undefined;
  if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
  if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);
}
resolveBinaries();

// Target output spec for vertical short-form video.
export const VERTICAL_WIDTH = 1080;
export const VERTICAL_HEIGHT = 1920;

export interface ProbeResult {
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
}

export function probe(input: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(input, (err, data) => {
      if (err) return reject(err);
      const videoStream = data.streams.find((s) => s.codec_type === "video");
      const audioStream = data.streams.find((s) => s.codec_type === "audio");
      resolve({
        durationSec: data.format.duration ?? 0,
        width: videoStream?.width ?? 0,
        height: videoStream?.height ?? 0,
        hasAudio: Boolean(audioStream),
        videoCodec: videoStream?.codec_name,
        audioCodec: audioStream?.codec_name,
      });
    });
  });
}

/** Extract a mono 16kHz WAV — the format local whisper.cpp engines prefer. */
export function extractAudio(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec("pcm_s16le")
      .format("wav")
      .on("error", reject)
      .on("end", () => resolve())
      .save(output);
  });
}

/**
 * Extract a (possibly partial) compressed mono MP3 — small enough for the
 * Whisper API's 25MB upload limit. Pass startSec/durationSec to extract a
 * chunk of a long source for chunked transcription.
 */
export function extractAudioMp3(
  input: string,
  output: string,
  startSec?: number,
  durationSec?: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(input);
    if (startSec != null) command.seekInput(startSec);
    if (durationSec != null) command.duration(durationSec);
    command
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .audioCodec("libmp3lame")
      .audioBitrate("64k")
      .format("mp3")
      .on("error", (err) => reject(new Error(`Audio extract failed: ${err.message}`)))
      .on("end", () => resolve())
      .save(output);
  });
}

/**
 * Extract raw 32-bit float mono PCM at 16kHz — the sample format the in-process
 * Whisper (transformers.js) pipeline consumes directly. Returns a Float32Array
 * of samples.
 */
export async function extractPcmF32(input: string): Promise<Float32Array> {
  const fsp = await import("node:fs/promises");
  const os = await import("node:os");
  const pathMod = await import("node:path");
  const tmp = pathMod.join(os.tmpdir(), `vc-pcm-${Date.now()}-${Math.round(performance.now())}.raw`);

  await new Promise<void>((resolve, reject) => {
    ffmpeg(input)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .outputOptions(["-f", "f32le", "-acodec", "pcm_f32le"])
      .on("error", (err) => reject(new Error(`PCM extract failed: ${err.message}`)))
      .on("end", () => resolve())
      .save(tmp);
  });

  try {
    const buf = await fsp.readFile(tmp);
    // Copy into a fresh, 4-byte-aligned ArrayBuffer before viewing as Float32.
    const aligned = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return new Float32Array(aligned);
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
  }
}

export interface RenderClipOptions {
  input: string;
  output: string;
  startSec: number;
  endSec: number;
  /** Path to a subtitle file (.ass or .srt) to burn in. Optional. */
  subtitlePath?: string;
  /** Convert to vertical 9:16 with a blurred background fill. Default true. */
  vertical?: boolean;
  onProgress?: (percent: number) => void;
}

/**
 * Build the video filter chain that fits arbitrary input into a 1080x1920
 * frame: a blurred, scaled-to-cover background with the original (scaled to
 * fit) composited on top — the standard "Reels" look that never letterboxes
 * awkwardly. Subtitles, if provided, are burned on last.
 */
function buildVerticalFilter(subtitlePath?: string): string {
  const W = VERTICAL_WIDTH;
  const H = VERTICAL_HEIGHT;
  // [bg]: cover-scale + crop + blur. [fg]: contain-scale. overlay centered.
  const chain = [
    `[0:v]split=2[bg][fg]`,
    `[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:2,setsar=1[bgblur]`,
    `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fgscaled]`,
    `[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2[outv]`,
  ];
  let lastLabel = "outv";
  if (subtitlePath) {
    chain.push(`[${lastLabel}]${subtitleFilterArg(subtitlePath)}[final]`);
    lastLabel = "final";
  }
  return chain.join(";") + `;[${lastLabel}]null[v]`;
}

/**
 * Build the `subtitles='...'` filtergraph token for a subtitle file.
 *
 * Windows paths are a minefield in ffmpeg filtergraphs: the drive-letter colon
 * is treated as an option separator (even inside quotes) and spaces in the path
 * break parsing. The robust fix is to pass a path RELATIVE to the process cwd —
 * that strips both the drive letter (no colon) and the cwd's spaces. When the
 * file is on another drive than cwd (no relative form), we fall back to an
 * absolute path with the colon backslash-escaped.
 */
function subtitleFilterArg(subtitlePath: string): string {
  let p = subtitlePath;
  const rel = path.relative(process.cwd(), subtitlePath);
  if (rel && !path.isAbsolute(rel)) {
    p = rel; // same drive → clean relative path (no colon, no cwd spaces)
  }
  p = p.replace(/\\/g, "/").replace(/'/g, "\\'");
  if (/^[A-Za-z]:\//.test(p)) {
    p = p.replace(":", "\\:"); // cross-drive absolute fallback
  }
  return `subtitles='${p}'`;
}

// EBU R128 loudness normalization target (a good level for social platforms).
const LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11";

export async function renderClip(opts: RenderClipOptions): Promise<void> {
  const { input, output, startSec, endSec, subtitlePath, vertical = true, onProgress } = opts;
  const duration = Math.max(0.1, endSec - startSec);

  // Detect audio up front so we only build the audio chain when there's a
  // stream to normalize (and keep the clip's voice clear + consistently loud).
  const meta = await probe(input).catch(() => null);
  const hasAudio = meta?.hasAudio ?? true;

  return new Promise((resolve, reject) => {
    const command = ffmpeg(input)
      // Accurate seek: place -ss after input for frame-accurate trims.
      .seekInput(startSec)
      .duration(duration);

    if (vertical) {
      let filter = buildVerticalFilter(subtitlePath);
      // Pass the filtergraph only (no auto-map) and map the outputs ourselves —
      // letting complexFilter also add `-map [v]` would map the label twice.
      const maps = ["-map", "[v]"];
      if (hasAudio) {
        filter += `;[0:a]${LOUDNORM}[aout]`;
        maps.push("-map", "[aout]");
      }
      command.complexFilter(filter);
      command.outputOptions(maps);
    } else {
      if (subtitlePath) command.videoFilters(subtitleFilterArg(subtitlePath));
      if (hasAudio) command.audioFilters(LOUDNORM);
    }

    command
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions([
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-profile:v", "high",
        "-level", "4.0",
        "-movflags", "+faststart",
        "-r", "30",
        "-b:a", "128k",
        "-ar", "44100",
        "-shortest",
      ])
      .on("start", (cmd) => log.debug("render start", { cmd }))
      .on("progress", (p) => onProgress?.(Math.min(100, Math.round(p.percent ?? 0))))
      .on("error", (err) => reject(new Error(`FFmpeg render failed: ${err.message}`)))
      .on("end", () => resolve())
      .save(output);
  });
}

/** Capture a single-frame JPEG thumbnail at the given timestamp. */
export function captureThumbnail(
  input: string,
  output: string,
  atSec: number,
  width = 720,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .seekInput(Math.max(0, atSec))
      .frames(1)
      .videoFilters(`scale=${width}:-2`)
      .outputOptions(["-q:v", "3"])
      .on("error", (err) => reject(new Error(`Thumbnail failed: ${err.message}`)))
      .on("end", () => resolve())
      .save(output);
  });
}

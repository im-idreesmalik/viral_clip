/**
 * FFmpeg wrapper: probing, audio extraction, clip trimming, 9:16 conversion,
 * caption burn-in, and thumbnail generation.
 *
 * Binaries: uses FFMPEG_PATH/FFPROBE_PATH if set, otherwise falls back to the
 * bundled ffmpeg-static / ffprobe-static packages so the app works without a
 * system install. All outputs target social-platform-friendly H.264/AAC MP4.
 */
import fs from "node:fs";
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
  /** Text burned into the top band of the vertical frame (e.g. "Part 3"). */
  partLabel?: string;
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
function buildVerticalFilter(opts: { subtitlePath?: string; partLabel?: string }): string {
  const W = VERTICAL_WIDTH;
  const H = VERTICAL_HEIGHT;
  // [bg]: cover-scale + crop + blur. [fg]: contain-scale. overlay centered.
  const chain = [
    `[0:v]split=2[bg][fg]`,
    // Blur cheaply: cover-scale to a SMALL frame, blur that, then upscale to
    // full size (the upscale smooths it further). Far faster than boxblur at
    // 1080x1920 — blurring the small frame is ~9x less work per frame.
    `[bg]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=14:1,scale=${W}:${H}:flags=bilinear,setsar=1[bgblur]`,
    `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fgscaled]`,
    `[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2[outv]`,
  ];
  let lastLabel = "outv";
  if (opts.subtitlePath) {
    chain.push(`[${lastLabel}]${subtitleFilterArg(opts.subtitlePath)}[subbed]`);
    lastLabel = "subbed";
  }
  if (opts.partLabel) {
    chain.push(`[${lastLabel}]${drawTextArg(opts.partLabel)}[titled]`);
    lastLabel = "titled";
  }
  return chain.join(";") + `;[${lastLabel}]null[v]`;
}

/**
 * Build a `drawtext=...` token that burns a title (e.g. "Part 3") into the top
 * band of the vertical frame. The font path's drive colon is escaped for the
 * filtergraph (same Windows pitfall as subtitles).
 */
function drawTextArg(label: string): string {
  const fontPath = (env.fontFile || "C:/Windows/Fonts/arialbd.ttf")
    .replace(/\\/g, "/")
    .replace(":", "\\:");
  const text = label.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "’");
  return (
    `drawtext=fontfile='${fontPath}':text='${text}':` +
    `fontsize=100:fontcolor=white:borderw=6:bordercolor=black@0.85:` +
    `x=(w-text_w)/2:y=h*0.10`
  );
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

// Output options shared by every encoder.
const COMMON_OUTPUT = [
  "-pix_fmt", "yuv420p",
  "-profile:v", "high",
  "-movflags", "+faststart",
  "-r", "30",
  "-b:a", "128k",
  "-ar", "44100",
  "-shortest",
];

/**
 * Apply the chosen H.264 encoder. "h264_nvenc" offloads encoding to an NVIDIA
 * GPU (much faster); anything else uses the libx264 CPU encoder.
 */
function applyEncoder(command: ReturnType<typeof ffmpeg>, encoder: string) {
  command.audioCodec("aac");
  if (encoder === "h264_nvenc") {
    command.videoCodec("h264_nvenc").outputOptions([
      "-preset", "p5", // p1 fastest … p7 slowest; p5 = good quality/speed balance
      "-rc", "vbr",
      "-cq", "23", // constant-quality, roughly equivalent to libx264 -crf 23
      "-b:v", "0",
      ...COMMON_OUTPUT,
    ]);
  } else {
    command.videoCodec("libx264").outputOptions([
      "-preset", "veryfast",
      "-crf", "23",
      "-level", "4.0",
      ...COMMON_OUTPUT,
    ]);
  }
}

export async function renderClip(opts: RenderClipOptions): Promise<void> {
  const { input, output, startSec, endSec, subtitlePath, partLabel, vertical = true, onProgress } = opts;
  const duration = Math.max(0.1, endSec - startSec);

  // Detect audio up front so we only build the audio chain when there's a
  // stream to normalize (and keep the clip's voice clear + consistently loud).
  const meta = await probe(input).catch(() => null);
  const hasAudio = meta?.hasAudio ?? true;

  // Only burn the "Part N" title if the font is available — otherwise skip it
  // rather than fail the whole render.
  const titleLabel =
    partLabel && fs.existsSync(env.fontFile || "C:/Windows/Fonts/arialbd.ttf") ? partLabel : undefined;
  if (partLabel && !titleLabel) {
    log.warn("Title font not found; skipping burned-in part label", { font: env.fontFile });
  }

  const runRender = (encoder: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const command = ffmpeg(input)
        // Accurate seek: place -ss after input for frame-accurate trims.
        .seekInput(startSec)
        .duration(duration);

      if (vertical) {
        let filter = buildVerticalFilter({ subtitlePath, partLabel: titleLabel });
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

      applyEncoder(command, encoder);

      command
        .on("start", (cmd) => log.debug("render start", { encoder, cmd }))
        .on("progress", (p) => onProgress?.(Math.min(100, Math.round(p.percent ?? 0))))
        .on("error", (err) => reject(new Error(`FFmpeg render failed (${encoder}): ${err.message}`)))
        .on("end", () => resolve())
        .save(output);
    });

  const preferred = env.ffmpegVideoEncoder || "libx264";
  try {
    await runRender(preferred);
  } catch (err) {
    // A GPU encoder can fail (GPU busy, driver/codec issue) — fall back to CPU.
    if (preferred !== "libx264") {
      log.warn(`Render failed on "${preferred}"; retrying with libx264 (CPU)`, {
        message: err instanceof Error ? err.message : String(err),
      });
      await runRender("libx264");
    } else {
      throw err;
    }
  }
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

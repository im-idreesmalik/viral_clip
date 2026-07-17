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
import { listGenericFootage } from "@/lib/storage";

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
    const command = ffmpeg(input)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .outputOptions(["-f", "f32le", "-acodec", "pcm_f32le"]);
    // Timeout + kill so a stuck decode can't hang (and, since this runs in the
    // transcription subprocess, can't orphan an ffmpeg when the parent kills us).
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        command.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      reject(new Error(`PCM extract timed out after ${env.renderTimeoutMs}ms`));
    }, env.renderTimeoutMs);
    command
      .on("error", (err) => {
        clearTimeout(timer);
        if (timedOut) return;
        reject(new Error(`PCM extract failed: ${err.message}`));
      })
      .on("end", () => {
        clearTimeout(timer);
        resolve();
      })
      .save(tmp);
  });

  try {
    const buf = await fsp.readFile(tmp);
    const usableLen = buf.byteLength - (buf.byteLength % 4);
    // Avoid a second full-size copy when the buffer is already 4-byte aligned
    // (the common case for large, unpooled reads) — view it in place.
    if (buf.byteOffset % 4 === 0) {
      return new Float32Array(buf.buffer, buf.byteOffset, usableLen / 4);
    }
    const aligned = buf.buffer.slice(buf.byteOffset, buf.byteOffset + usableLen);
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
  /** Extra fonts dir for libass (non-Latin caption glyphs). */
  subtitleFontsDir?: string;
  /** Text burned into the top band of the vertical frame (e.g. "Part 3"). */
  partLabel?: string;
  /** Optional short title burned ABOVE the part label (topmost). */
  topLabel?: string;
  /** GENERIC footage mode: stock video paths whose visuals replace the
   *  original's (muted). The original audio (from `input`) is kept. */
  genericInputs?: string[];
  /** Small "@handle" burned bottom-center (smaller than the part label). */
  watermark?: string;
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
function buildVerticalFilter(opts: {
  subtitlePath?: string;
  subtitleFontsDir?: string;
  partLabel?: string;
  topLabel?: string;
  watermark?: string;
  inputLabel?: string;
}): string {
  const W = VERTICAL_WIDTH;
  const H = VERTICAL_HEIGHT;
  const src = opts.inputLabel ?? "0:v";
  // [bg]: cover-scale + crop + blur. [fg]: contain-scale. overlay centered.
  const chain = [
    `[${src}]split=2[bg][fg]`,
    // Blur cheaply: cover-scale to a SMALL frame, blur that, then upscale to
    // full size (the upscale smooths it further). Far faster than boxblur at
    // 1080x1920 — blurring the small frame is ~9x less work per frame.
    `[bg]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=14:1,scale=${W}:${H}:flags=bilinear,setsar=1[bgblur]`,
    `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[fgscaled]`,
    `[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2[outv]`,
  ];
  let lastLabel = "outv";
  if (opts.subtitlePath) {
    chain.push(`[${lastLabel}]${subtitleFilterArg(opts.subtitlePath, opts.subtitleFontsDir)}[subbed]`);
    lastLabel = "subbed";
  }
  if (opts.partLabel) {
    // Part number sits a bit lower to leave room for the short title above it.
    chain.push(`[${lastLabel}]${drawTextArg(opts.partLabel, { y: "h*0.135" })}[titled]`);
    lastLabel = "titled";
  }
  if (opts.topLabel) {
    // Short title, topmost, smaller than the part number.
    chain.push(
      `[${lastLabel}]${drawTextArg(opts.topLabel, { fontsize: 60, y: "h*0.05", borderw: 5 })}[toptitle]`,
    );
    lastLabel = "toptitle";
  }
  if (opts.watermark) {
    chain.push(
      `[${lastLabel}]${drawTextArg(opts.watermark, { fontsize: 52, y: "h*0.90", borderw: 4 })}[wm]`,
    );
    lastLabel = "wm";
  }
  return chain.join(";") + `;[${lastLabel}]null[v]`;
}

/**
 * Build a `drawtext=...` token that burns a title (e.g. "Part 3") into the top
 * band of the vertical frame. The font path's drive colon is escaped for the
 * filtergraph (same Windows pitfall as subtitles).
 */
function drawTextArg(
  label: string,
  opts?: { fontsize?: number; y?: string; borderw?: number },
): string {
  const fontPath = (env.fontFile || "C:/Windows/Fonts/arialbd.ttf")
    .replace(/\\/g, "/")
    .replace(":", "\\:");
  const text = label.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "’");
  const fontsize = opts?.fontsize ?? 100;
  const y = opts?.y ?? "h*0.10";
  const borderw = opts?.borderw ?? 6;
  return (
    `drawtext=fontfile='${fontPath}':text='${text}':` +
    `fontsize=${fontsize}:fontcolor=white:borderw=${borderw}:bordercolor=black@0.85:` +
    `x=(w-text_w)/2:y=${y}`
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
function subtitleFilterArg(subtitlePath: string, fontsDir?: string): string {
  const clean = (raw: string) => {
    let p = raw;
    const rel = path.relative(process.cwd(), raw);
    if (rel && !path.isAbsolute(rel)) p = rel; // same drive → clean relative path
    p = p.replace(/\\/g, "/").replace(/'/g, "\\'");
    if (/^[A-Za-z]:\//.test(p)) p = p.replace(":", "\\:"); // cross-drive absolute fallback
    return p;
  };
  let arg = `subtitles='${clean(subtitlePath)}'`;
  // Point libass at our extra fonts (Noto Arabic/Urdu/Devanagari) so non-Latin
  // captions render with the right glyphs instead of boxes.
  if (fontsDir) arg += `:fontsdir='${clean(fontsDir)}'`;
  return arg;
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
  const { input, output, startSec, endSec, subtitlePath, subtitleFontsDir, partLabel, topLabel, genericInputs, watermark, vertical = true, onProgress } = opts;
  const duration = Math.max(0.1, endSec - startSec);

  // Detect streams up front: we only build the audio chain when there's a
  // stream to normalize, and we only use the source's own video when it has one
  // (an AI Story source is audio-only — its visuals come from generic footage
  // or, failing that, a solid background).
  const meta = await probe(input).catch(() => null);
  const hasAudio = meta?.hasAudio ?? true;
  const hasVideo = (meta?.width ?? 0) > 0 && (meta?.height ?? 0) > 0;

  // Only burn drawtext overlays if the font is available — otherwise skip them
  // rather than fail the whole render.
  const fontOk = fs.existsSync(env.fontFile || "C:/Windows/Fonts/arialbd.ttf");
  const titleLabel = partLabel && fontOk ? partLabel : undefined;
  const topTitle = topLabel && fontOk ? topLabel : undefined;
  const wmLabel = watermark && fontOk ? watermark : undefined;
  if ((partLabel || topLabel || watermark) && !fontOk) {
    log.warn("Title font not found; skipping burned-in text", { font: env.fontFile });
  }

  const runRender = (encoder: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const command = ffmpeg(input)
        // Accurate seek: place -ss after input for frame-accurate trims.
        .seekInput(startSec)
        .duration(duration);

      // GENERIC footage: extra inputs whose visuals replace the original's.
      const generic = genericInputs && genericInputs.length > 0 ? genericInputs : null;
      // When the source has no video of its own (an AI Story voice-over) and no
      // generic footage was supplied, synthesize a solid background so there's
      // something to show behind the captions instead of failing the render.
      const syntheticBg = vertical && !generic && !hasVideo;
      const overlayInputs = generic ?? (syntheticBg ? ["__bg__"] : null);

      if (generic) {
        for (const g of generic) command.input(g);
      } else if (syntheticBg) {
        command
          .input(`color=c=0x0b0b12:s=${VERTICAL_WIDTH}x${VERTICAL_HEIGHT}:d=${duration.toFixed(3)}:r=30`)
          .inputOptions(["-f", "lavfi"]);
      }

      if (vertical) {
        let filter: string;
        if (overlayInputs) {
          // Normalize each overlay clip (stock footage or the synthetic bg) to
          // the vertical frame, concat into one reel, trim to the clip length,
          // then feed into the vertical (blurred-fill) filter. Generic footage
          // is stored 9:16 already, so this is a straight fit; any stray
          // non-9:16 file is cover-cropped.
          const norm = overlayInputs.map(
            (_, i) =>
              `[${i + 1}:v]scale=${VERTICAL_WIDTH}:${VERTICAL_HEIGHT}:force_original_aspect_ratio=increase,crop=${VERTICAL_WIDTH}:${VERTICAL_HEIGHT},setsar=1,fps=30,format=yuv420p[g${i}]`,
          );
          const cat = overlayInputs.map((_, i) => `[g${i}]`).join("");
          const reel = `${norm.join(";")};${cat}concat=n=${overlayInputs.length}:v=1:a=0[gcat];[gcat]trim=0:${duration.toFixed(3)},setpts=PTS-STARTPTS[gv]`;
          filter = `${reel};${buildVerticalFilter({ subtitlePath, subtitleFontsDir, partLabel: titleLabel, topLabel: topTitle, watermark: wmLabel, inputLabel: "gv" })}`;
        } else {
          filter = buildVerticalFilter({ subtitlePath, subtitleFontsDir, partLabel: titleLabel, topLabel: topTitle, watermark: wmLabel });
        }
        // Audio always comes from the original (input 0), even in GENERIC mode.
        const maps = ["-map", "[v]"];
        if (hasAudio) {
          filter += `;[0:a]${LOUDNORM}[aout]`;
          maps.push("-map", "[aout]");
        }
        command.complexFilter(filter);
        command.outputOptions(maps);
      } else {
        if (subtitlePath) command.videoFilters(subtitleFilterArg(subtitlePath, subtitleFontsDir));
        if (hasAudio) command.audioFilters(LOUDNORM);
      }

      applyEncoder(command, encoder);

      // Hard timeout: kill a stuck/runaway ffmpeg so it can't peg the CPU/GPU
      // forever. Cleared on normal end/error.
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        log.error("Render timed out; killing ffmpeg", { encoder, timeoutMs: env.renderTimeoutMs });
        try {
          command.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        reject(new Error(`FFmpeg render timed out after ${env.renderTimeoutMs}ms (${encoder})`));
      }, env.renderTimeoutMs);

      command
        .on("start", (cmd) => log.debug("render start", { encoder, cmd }))
        .on("progress", (p) => onProgress?.(Math.min(100, Math.round(p.percent ?? 0))))
        .on("error", (err) => {
          clearTimeout(timer);
          if (timedOut) return; // already rejected by the timeout
          reject(new Error(`FFmpeg render failed (${encoder}): ${err.message}`));
        })
        .on("end", () => {
          clearTimeout(timer);
          resolve();
        })
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

/**
 * Convert any video into a SILENT 1080x1920 (9:16) MP4 with the blurred-fill
 * background. Used to normalize uploaded generic/stock footage so every clip
 * in the library is vertical (and audio-free) before it's ever used — GENERIC
 * mode keeps the ORIGINAL video's audio, so the stock clip's own audio is
 * dropped. Clips that are already 9:16 simply fill the frame (the blurred
 * background stays hidden behind them).
 */
export async function normalizeToVertical(input: string, output: string): Promise<void> {
  const runRender = (encoder: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const command = ffmpeg(input);
      command.complexFilter(buildVerticalFilter({}));
      // Video-only: map the composited stream and drop audio entirely.
      command.outputOptions(["-map", "[v]", "-an"]);
      applyEncoder(command, encoder);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          command.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        reject(new Error(`Normalize timed out after ${env.renderTimeoutMs}ms (${encoder})`));
      }, env.renderTimeoutMs);
      command
        .on("error", (err) => {
          clearTimeout(timer);
          if (timedOut) return;
          reject(new Error(`Normalize failed (${encoder}): ${err.message}`));
        })
        .on("end", () => {
          clearTimeout(timer);
          resolve();
        })
        .save(output);
    });

  const preferred = env.ffmpegVideoEncoder || "libx264";
  try {
    await runRender(preferred);
  } catch (err) {
    if (preferred !== "libx264") {
      log.warn(`Normalize failed on "${preferred}"; retrying with libx264 (CPU)`, {
        message: err instanceof Error ? err.message : String(err),
      });
      await runRender("libx264");
    } else {
      throw err;
    }
  }
}

/**
 * Pick random generic clips (with repetition) whose total duration covers
 * `durationSec`, for GENERIC footage mode. Returns [] if none are available.
 */
export async function selectGenericFootage(durationSec: number): Promise<string[]> {
  const files = listGenericFootage();
  if (files.length === 0) return [];
  const withDur: { path: string; dur: number }[] = [];
  for (const f of files) {
    const m = await probe(f).catch(() => null);
    if (m && m.durationSec > 0.2) withDur.push({ path: f, dur: m.durationSec });
  }
  if (withDur.length === 0) return [];

  const picks: string[] = [];
  let total = 0;
  let guard = 0;
  // Cap the count so the filtergraph stays reasonable even with very short clips.
  while (total < durationSec + 0.3 && guard < 60) {
    const pick = withDur[Math.floor(Math.random() * withDur.length)];
    picks.push(pick.path);
    total += pick.dur;
    guard++;
  }
  return picks;
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

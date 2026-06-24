/**
 * YouTube (and other yt-dlp-supported) source downloading.
 *
 * We invoke the bundled yt-dlp binary DIRECTLY via execFile (no shell). Going
 * through youtube-dl-exec's shell invocation breaks on Windows: cmd.exe treats
 * the "<" in the format selector ("[height<=1080]") as input redirection and
 * mishandles spaces in the output path, surfacing as
 * "The system cannot find the path specified." A direct argv spawn avoids all
 * shell parsing. Set YTDLP_PATH to use a system yt-dlp binary instead.
 */
import path from "node:path";
import fsp from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import ffmpegStatic from "ffmpeg-static";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";

const execFileAsync = promisify(execFile);
const log = createLogger("download");

// yt-dlp needs ffmpeg to merge separate best-video + best-audio streams.
const FFMPEG_DIR = path.dirname(env.ffmpegPath || ffmpegStatic || "");

let cachedBinary: string | null = null;
function ytDlpBinary(): string {
  if (cachedBinary) return cachedBinary;
  if (env.ytdlpPath) {
    cachedBinary = env.ytdlpPath;
    return cachedBinary;
  }
  // Resolve the binary bundled by youtube-dl-exec (resolved lazily so this
  // doesn't run when the module is merely imported for isYouTubeUrl()).
  const require = createRequire(import.meta.url);
  const pkgDir = path.dirname(require.resolve("youtube-dl-exec/package.json"));
  cachedBinary = path.join(pkgDir, "bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  return cachedBinary;
}

async function runYtDlp(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(ytDlpBinary(), args, {
      maxBuffer: 1024 * 1024 * 256,
    });
    return stdout;
  } catch (err) {
    // execFile's error message is just the command line; surface yt-dlp's
    // actual stderr so failures are diagnosable (geo-block, format, network…).
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const detail = (e.stderr || e.stdout || e.message || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-4)
      .join(" | ");
    throw new Error(`yt-dlp failed: ${detail || e.message || "unknown error"}`);
  }
}

export interface DownloadResult {
  filePath: string;
  title: string;
}

const YOUTUBE_RE =
  /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]+/i;

export function isYouTubeUrl(url: string): boolean {
  return YOUTUBE_RE.test(url.trim());
}

interface FetchMetadata {
  title: string;
}

/** Fetch metadata without downloading — used to name the video on creation. */
async function fetchMetadata(url: string): Promise<FetchMetadata> {
  const stdout = await runYtDlp([
    url,
    "--dump-single-json",
    "--skip-download",
    "--no-warnings",
    "--no-playlist",
    "--no-check-certificates",
  ]);
  const info = JSON.parse(stdout) as Record<string, unknown>;
  return {
    title: String(info.title ?? "Untitled video"),
  };
}

/**
 * Download the best MP4 (<=1080p) to `destDir`. Returns the resulting file path.
 * Output is merged to a single .mp4 (video + audio) for predictable downstream
 * FFmpeg processing.
 */
export async function downloadVideo(url: string, destDir: string): Promise<DownloadResult> {
  await fsp.mkdir(destDir, { recursive: true });
  const outputTemplate = path.join(destDir, "source.%(ext)s");

  log.info("Downloading source", { url, ffmpegDir: FFMPEG_DIR });
  const args = [
    url,
    "-o", outputTemplate,
    "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]/best",
    "--merge-output-format", "mp4",
    "--no-warnings",
    "--no-progress",
    "--no-playlist",
    "--no-check-certificates",
    // Be resilient to YouTube throttling / fragment stalls.
    "--retries", "10",
    "--fragment-retries", "10",
    "--socket-timeout", "30",
  ];
  if (FFMPEG_DIR) args.push("--ffmpeg-location", FFMPEG_DIR);
  await runYtDlp(args);

  // yt-dlp names the file source.mp4 after merge; find it defensively.
  const files = await fsp.readdir(destDir);
  const source = files.find((f) => f.startsWith("source."));
  if (!source) {
    throw new Error("Download completed but no output file was found.");
  }
  const filePath = path.join(destDir, source);
  const meta = await fetchMetadata(url).catch(() => ({
    title: "Downloaded video",
  }));

  return {
    filePath,
    title: meta.title,
  };
}

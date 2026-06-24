/**
 * Local setup helper for the fully-offline (no paid services) configuration.
 *
 *   - Checks Ollama is installed and the configured model is pulled.
 *   - Pre-downloads the local Whisper model so the first video doesn't stall.
 *
 * Run with:  npm run setup:local
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Load .env (Node >= 20.12) so we read the same config the app uses.
try {
  process.loadEnvFile?.(".env");
} catch {
  /* .env optional */
}

const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1";
const WHISPER_MODEL = process.env.TRANSFORMERS_WHISPER_MODEL || "Xenova/whisper-base.en";

function log(msg) {
  console.log(`\n[36m▶ ${msg}[0m`);
}
function ok(msg) {
  console.log(`[32m✓ ${msg}[0m`);
}
function warn(msg) {
  console.log(`[33m! ${msg}[0m`);
}

async function setupOllama() {
  log(`Checking Ollama + model "${OLLAMA_MODEL}"`);
  try {
    await execFileAsync("ollama", ["--version"]);
  } catch {
    warn("Ollama is not installed or not on PATH.");
    console.log("  Install it from https://ollama.com/download, then re-run this script.");
    return;
  }
  ok("Ollama is installed.");
  console.log(`  Pulling model "${OLLAMA_MODEL}" (this can take a while the first time)...`);
  try {
    await execFileAsync("ollama", ["pull", OLLAMA_MODEL], { maxBuffer: 1024 * 1024 * 64 });
    ok(`Model "${OLLAMA_MODEL}" is ready.`);
  } catch (err) {
    warn(`Failed to pull "${OLLAMA_MODEL}": ${err.message}`);
    console.log(`  Try manually: ollama pull ${OLLAMA_MODEL}`);
  }
}

async function setupWhisper() {
  log(`Pre-downloading local Whisper model "${WHISPER_MODEL}"`);
  try {
    const { pipeline } = await import("@huggingface/transformers");
    await pipeline("automatic-speech-recognition", WHISPER_MODEL);
    ok("Whisper model downloaded + cached.");
  } catch (err) {
    warn(`Could not pre-download Whisper model: ${err.message}`);
    console.log("  It will download automatically on the first transcription instead.");
  }
}

async function main() {
  console.log("ViralCut — local (no paid services) setup");
  await setupOllama();
  await setupWhisper();
  console.log("\nDone. Make sure `ollama serve` is running, then start the app + worker:");
  console.log("  npm run dev");
  console.log("  npm run worker");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

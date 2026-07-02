/**
 * Isolated transcription runner. Spawned by transcription.ts as a child process
 * so a native onnxruntime crash (GPU/DirectML segfault) or a hang can only kill
 * THIS process — the parent worker survives and falls back gracefully.
 *
 * Usage: node --import tsx transcribe-runner.ts <videoPath> <outJsonPath>
 * Writes the transcript JSON to <outJsonPath> and exits 0 on success.
 */
// Relative import (not the @/ alias) so the spawned process doesn't depend on
// tsconfig path resolution being available in the child's context.
import "../../workers/loadEnv";
import fsp from "node:fs/promises";
import { runTransformersInProcess } from "./transcription";

async function main() {
  const [videoPath, outPath] = process.argv.slice(2);
  if (!videoPath || !outPath) {
    console.error("usage: transcribe-runner <videoPath> <outJsonPath>");
    process.exit(2);
  }
  const transcript = await runTransformersInProcess(videoPath);
  await fsp.writeFile(outPath, JSON.stringify(transcript));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });

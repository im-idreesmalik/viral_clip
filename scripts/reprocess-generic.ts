/**
 * One-time maintenance: re-normalize every existing generic clip to a SILENT
 * vertical (9:16) MP4 and renumber them 1.mp4, 2.mp4, … in their current order.
 * Safe to re-run (idempotent). Run: npx tsx scripts/reprocess-generic.ts
 */
import "@/workers/loadEnv";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { listGenericFootage } from "@/lib/storage";
import { normalizeToVertical } from "@/services/video/ffmpeg";

async function main() {
  const files = listGenericFootage(); // numeric order
  if (files.length === 0) {
    console.log("No generic footage to process.");
    return;
  }
  const dir = path.dirname(files[0]);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vc-regen-"));
  const outputs: string[] = [];

  // 1. Normalize each into a temp dir first (don't touch originals mid-run).
  for (let i = 0; i < files.length; i++) {
    const tmpOut = path.join(tmpDir, `${i + 1}.mp4`);
    process.stdout.write(`[${i + 1}/${files.length}] ${path.basename(files[i])} -> ${i + 1}.mp4 … `);
    await normalizeToVertical(files[i], tmpOut);
    outputs.push(tmpOut);
    console.log("done");
  }

  // 2. Clear the old video files, then move the normalized ones in as 1..N.
  for (const f of files) fs.rmSync(f, { force: true });
  for (let i = 0; i < outputs.length; i++) {
    fs.copyFileSync(outputs[i], path.join(dir, `${i + 1}.mp4`));
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`\nDone: ${outputs.length} clips → silent 9:16, renumbered 1-${outputs.length}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

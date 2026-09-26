/** Vision provider registry + enablement gate for the selective multimodal stage. */
import { env } from "@/lib/env";
import { geminiVisionProvider } from "./gemini";
import type { VisionProvider } from "./types";

const PROVIDERS: Record<string, VisionProvider> = {
  gemini: geminiVisionProvider,
};

/** True only when vision is enabled AND the selected provider has credentials. */
export function isVisionEnabled(): boolean {
  if (!env.visionEnabled) return false;
  const p = PROVIDERS[env.visionProvider];
  if (!p) return false;
  if (env.visionProvider === "gemini" && !env.geminiApiKey) return false;
  return true;
}

export function getVisionProvider(): VisionProvider | null {
  return PROVIDERS[env.visionProvider] ?? null;
}

export type { VisionProvider, VisionInput, VisionResult, VisionFrame } from "./types";

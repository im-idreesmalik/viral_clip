/**
 * AI Story processing pipeline: write the text (if AI-generated) and synthesize
 * the voice-over, storing both so a story never needs regenerating to play.
 *
 * Runs in the stories worker. Each stage updates Story.status so the admin UI
 * shows live progress; failures are captured on the record.
 */
import { StoryStatus, StorySource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logger";
import { env } from "@/lib/env";
import { resolveKey, ensureDirFor, deleteKey } from "@/lib/storage";
import { generateStory, type StoryLanguage } from "@/services/ai/storyGeneration";
import { synthesizeToMp3 } from "@/services/tts";

const log = createLogger("story:pipeline");

/**
 * Full generation for an AI story: write the text from its topic (if not
 * already written), then synthesize the voice-over. Idempotent-ish: safe to
 * re-run after a failure.
 */
export async function processStoryGeneration(storyId: string, durationMin: number): Promise<void> {
  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story) throw new Error(`Story ${storyId} not found`);

  try {
    // 1. Write the text (only for AI stories that don't have it yet).
    if (story.source === StorySource.AI && !story.text?.trim()) {
      await prisma.story.update({ where: { id: storyId }, data: { status: StoryStatus.WRITING, errorMessage: null } });
      const language = (story.language === "ur" ? "ur" : "en") as StoryLanguage;
      const generated = await generateStory({
        topic: story.topic || story.title,
        language,
        durationMin: clampDuration(durationMin),
      });
      await prisma.story.update({
        where: { id: storyId },
        data: { title: generated.title, text: generated.text, ttsText: generated.ttsText, viralScore: generated.viralScore },
      });
      story.text = generated.text;
      story.ttsText = generated.ttsText;
    }

    // 2. Synthesize the voice-over.
    await prisma.story.update({ where: { id: storyId }, data: { status: StoryStatus.NARRATING, errorMessage: null } });
    await synthesizeAndStore(storyId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Story generation failed", { storyId, message });
    await prisma.story.update({ where: { id: storyId }, data: { status: StoryStatus.FAILED, errorMessage: message } });
    throw err;
  }
}

/** (Re)synthesize the voice-over for a story whose text already exists. */
export async function generateStoryAudio(storyId: string): Promise<void> {
  try {
    await prisma.story.update({ where: { id: storyId }, data: { status: StoryStatus.NARRATING, errorMessage: null } });
    await synthesizeAndStore(storyId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Story audio generation failed", { storyId, message });
    await prisma.story.update({ where: { id: storyId }, data: { status: StoryStatus.FAILED, errorMessage: message } });
    throw err;
  }
}

async function synthesizeAndStore(storyId: string): Promise<void> {
  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story) throw new Error(`Story ${storyId} not found`);
  // Speak the story's own text directly. Urdu is narrated from its Arabic-script
  // text via espeak's Urdu voice (see the TTS service), so no transliteration is
  // needed — that also keeps Urdu sounding Urdu, not Hindi.
  const spoken = (story.text || "").trim();
  if (!spoken) throw new Error("Story has no text to synthesize.");

  const audioKey = `stories/${storyId}/audio.mp3`;
  await ensureDirFor(audioKey);
  const { durationSec } = await synthesizeToMp3(spoken, story.language, resolveKey(audioKey));

  await prisma.story.update({
    where: { id: storyId },
    data: { audioKey, durationSec, voice: `kokoro:${story.language === "ur" ? env.storyVoiceUr : env.storyVoiceEn}`, status: StoryStatus.READY },
  });
  log.info("Story ready", { storyId, durationSec: Math.round(durationSec) });
}

/** Remove a story's stored audio (used on delete / before regenerating). */
export async function deleteStoryAudio(storyId: string): Promise<void> {
  await deleteKey(`stories/${storyId}`).catch(() => undefined);
}

function clampDuration(min: number): number {
  if (!Number.isFinite(min)) return 9;
  return Math.max(3, Math.min(15, Math.round(min)));
}

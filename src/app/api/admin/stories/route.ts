import { z } from "zod";
import { StorySource, StoryStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handler, ok, created, parseBody, requireAdmin } from "@/lib/api";
import { serializeStory } from "@/lib/serialize";
import { enqueueGenerateStory, enqueueStoryAudio } from "@/lib/queue";

// GET /api/admin/stories — every story (incl. claimed), for Super Admin.
export const GET = handler(async () => {
  await requireAdmin();
  const stories = await prisma.story.findMany({
    orderBy: { createdAt: "desc" },
    include: { claimedBy: { select: { id: true, name: true, email: true } } },
  });
  return ok(stories.map((s) => serializeStory(s, { includeAdmin: true })));
});

const aiSchema = z.object({
  mode: z.literal("ai"),
  topic: z.string().trim().min(3).max(500),
  language: z.enum(["en", "ur"]),
  durationMin: z.number().int().min(3).max(15).default(9),
});
const pasteSchema = z.object({
  mode: z.literal("paste"),
  title: z.string().trim().min(1).max(160),
  text: z.string().trim().min(20),
  language: z.enum(["en", "ur"]),
  ttsText: z.string().trim().optional(),
});
const createSchema = z.discriminatedUnion("mode", [aiSchema, pasteSchema]);

// POST /api/admin/stories — create a story by AI generation or by pasting text
// (voice-over is then synthesized in the background).
export const POST = handler(async (req) => {
  await requireAdmin();
  const body = await parseBody(req, createSchema);

  if (body.mode === "ai") {
    const story = await prisma.story.create({
      data: {
        title: body.topic.slice(0, 120),
        topic: body.topic,
        language: body.language,
        source: StorySource.AI,
        status: StoryStatus.GENERATING,
        text: "",
      },
    });
    await enqueueGenerateStory(story.id, body.durationMin ?? 9);
    return created(serializeStory(story, { includeAdmin: true }));
  }

  const story = await prisma.story.create({
    data: {
      title: body.title,
      language: body.language,
      source: StorySource.MANUAL,
      status: StoryStatus.GENERATING,
      text: body.text,
      ttsText: body.ttsText || null,
    },
  });
  await enqueueStoryAudio(story.id);
  return created(serializeStory(story, { includeAdmin: true }));
});

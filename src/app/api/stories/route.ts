import { StoryStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handler, ok, requireSession } from "@/lib/api";
import { serializeStory } from "@/lib/serialize";

// GET /api/stories — the public AI Stories library: ready, unclaimed stories.
// Optional ?language=en|ur filter. Claimed stories are hidden from everyone.
export const GET = handler(async (req) => {
  await requireSession();
  const language = new URL(req.url).searchParams.get("language");
  const stories = await prisma.story.findMany({
    where: {
      status: StoryStatus.READY,
      claimedById: null,
      ...(language && language !== "all" ? { language } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return ok(stories.map((s) => serializeStory(s)));
});

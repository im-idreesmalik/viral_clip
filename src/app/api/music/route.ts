import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, parseBody, requireSession, ApiError } from "@/lib/api";
import { publicUrl } from "@/lib/storage";

/**
 * Per-user background music. Each user can claim ONE track exclusively; it's
 * then mixed (ducked) under every clip they render, giving their videos a
 * unique sonic signature. A claimed track disappears from everyone else's list.
 */

async function currentState(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { backgroundMusicId: true, backgroundMusicEnabled: true },
  });
  // Show tracks that are free OR already mine.
  const tracks = await prisma.backgroundMusic.findMany({
    where: { OR: [{ claimedById: null }, { claimedById: userId }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, mood: true, durationSec: true, storageKey: true, claimedById: true },
  });
  return {
    selectedId: user?.backgroundMusicId ?? null,
    enabled: user?.backgroundMusicEnabled ?? true,
    tracks: tracks.map((t) => ({
      id: t.id,
      title: t.title,
      mood: t.mood,
      durationSec: t.durationSec,
      url: publicUrl(t.storageKey),
      mine: t.claimedById === userId,
    })),
  };
}

// GET /api/music — the user's selection + the tracks available to them.
export const GET = handler(async () => {
  const session = await requireSession();
  return ok(await currentState(session.sub));
});

const patchSchema = z.object({
  musicId: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

// PATCH /api/music — pick a track (claims it), clear it (musicId: null), or
// toggle whether music is mixed in.
export const PATCH = handler(async (req) => {
  const session = await requireSession();
  const body = await parseBody(req, patchSchema);

  if (body.musicId !== undefined) {
    if (body.musicId === null) {
      // Release my claim + clear the selection.
      await prisma.$transaction([
        prisma.backgroundMusic.updateMany({
          where: { claimedById: session.sub },
          data: { claimedById: null, claimedAt: null },
        }),
        prisma.user.update({ where: { id: session.sub }, data: { backgroundMusicId: null } }),
      ]);
    } else {
      const track = await prisma.backgroundMusic.findUnique({
        where: { id: body.musicId },
        select: { id: true, claimedById: true },
      });
      if (!track) throw new ApiError(404, "That track no longer exists.");
      if (track.claimedById && track.claimedById !== session.sub) {
        throw new ApiError(409, "That track was just taken by another account. Pick a different one.");
      }
      await prisma.$transaction([
        // Free up whatever I had claimed before.
        prisma.backgroundMusic.updateMany({
          where: { claimedById: session.sub, NOT: { id: body.musicId } },
          data: { claimedById: null, claimedAt: null },
        }),
        prisma.backgroundMusic.update({
          where: { id: body.musicId },
          data: { claimedById: session.sub, claimedAt: new Date() },
        }),
        prisma.user.update({ where: { id: session.sub }, data: { backgroundMusicId: body.musicId } }),
      ]);
    }
  }

  if (body.enabled !== undefined) {
    await prisma.user.update({ where: { id: session.sub }, data: { backgroundMusicEnabled: body.enabled } });
  }

  return ok(await currentState(session.sub));
});

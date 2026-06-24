import { z } from "zod";
import { ClipMode, VideoSource, VideoStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handler, parseBody, ok, created, requireSession, ApiError } from "@/lib/api";
import { isYouTubeUrl } from "@/services/video/download";
import { enqueueProcessVideo } from "@/lib/queue";
import { serializeVideo } from "@/lib/serialize";

// GET /api/videos — list the current user's videos (newest first).
export const GET = handler(async () => {
  const session = await requireSession();
  const videos = await prisma.video.findMany({
    where: { userId: session.sub },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { clips: true } } },
  });
  return ok(
    videos.map((v) => ({ ...serializeVideo(v), clipCount: v._count.clips })),
  );
});

const createSchema = z.object({
  url: z.string().url(),
  clipMode: z.nativeEnum(ClipMode).default(ClipMode.VIRAL),
  viralThreshold: z.number().int().min(0).max(100).default(70),
  segmentSeconds: z.number().int().min(15).max(60).default(45),
  targetClipCount: z.number().int().min(1).max(30).default(8),
  burnCaptions: z.boolean().default(true),
  title: z.string().max(200).optional(),
});

// POST /api/videos — create a video from a YouTube URL and start processing.
export const POST = handler(async (req) => {
  const session = await requireSession();
  const body = await parseBody(req, createSchema);

  if (!isYouTubeUrl(body.url)) {
    throw new ApiError(400, "Only YouTube URLs are supported for URL import. Upload a file otherwise.");
  }

  const video = await prisma.video.create({
    data: {
      userId: session.sub,
      title: body.title || "YouTube import (fetching title…)",
      source: VideoSource.YOUTUBE,
      sourceUrl: body.url,
      status: VideoStatus.PENDING,
      clipMode: body.clipMode,
      viralThreshold: body.viralThreshold,
      segmentSeconds: body.segmentSeconds,
      targetClipCount: body.targetClipCount,
      burnCaptions: body.burnCaptions,
    },
  });

  await enqueueProcessVideo(video.id);
  return created(serializeVideo(video));
});

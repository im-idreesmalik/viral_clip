import { prisma } from "@/lib/db";
import { handler, ok, requireAdmin } from "@/lib/api";

// GET /api/admin/overview — superuser dashboard: every user + their activity.
// Admin-gated; returns only safe fields (never passwordHash or token ciphertext).
export const GET = handler(async () => {
  await requireAdmin();

  const [users, recentVideos, recentPublications, counts] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        handle: true,
        createdAt: true,
        _count: { select: { videos: true, publications: true, socialAccounts: true } },
        videos: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    prisma.video.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        title: true,
        status: true,
        clipMode: true,
        createdAt: true,
        user: { select: { email: true } },
        _count: { select: { clips: true } },
      },
    }),
    prisma.publication.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        platform: true,
        status: true,
        createdAt: true,
        publishedAt: true,
        user: { select: { email: true } },
        clip: { select: { title: true } },
      },
    }),
    prisma.$transaction([
      prisma.user.count(),
      prisma.video.count(),
      prisma.clip.count(),
      prisma.publication.count(),
      prisma.publication.count({ where: { status: "PUBLISHED" } }),
    ]),
  ]);

  return ok({
    totals: {
      users: counts[0],
      videos: counts[1],
      clips: counts[2],
      publications: counts[3],
      published: counts[4],
    },
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      handle: u.handle,
      createdAt: u.createdAt.toISOString(),
      videos: u._count.videos,
      publications: u._count.publications,
      accounts: u._count.socialAccounts,
      lastActiveAt: u.videos[0]?.createdAt.toISOString() ?? null,
    })),
    recentVideos: recentVideos.map((v) => ({
      id: v.id,
      title: v.title,
      status: v.status,
      clipMode: v.clipMode,
      clips: v._count.clips,
      owner: v.user.email,
      createdAt: v.createdAt.toISOString(),
    })),
    recentPublications: recentPublications.map((p) => ({
      id: p.id,
      platform: p.platform,
      status: p.status,
      clipTitle: p.clip?.title ?? null,
      owner: p.user.email,
      createdAt: p.createdAt.toISOString(),
      publishedAt: p.publishedAt?.toISOString() ?? null,
    })),
  });
});

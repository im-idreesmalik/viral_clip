import { z } from "zod";
import { Platform } from "@prisma/client";
import { prisma } from "@/lib/db";
import { handler, parseBody, ok, requireSession } from "@/lib/api";
import { serializeAutoConfig } from "@/lib/serialize";

// GET /api/schedule — the user's auto-publish configuration.
export const GET = handler(async () => {
  const session = await requireSession();
  const config = await prisma.autoPublishConfig.findUnique({ where: { userId: session.sub } });
  return ok(serializeAutoConfig(config));
});

const schema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(15).max(60 * 24),
  platforms: z.array(z.nativeEnum(Platform)).max(4),
  windowStartHour: z.number().int().min(0).max(23).nullable().optional(),
  windowEndHour: z.number().int().min(0).max(23).nullable().optional(),
});

// PUT /api/schedule — update auto-publishing. Enabling schedules the next run
// for the next scheduler tick.
export const PUT = handler(async (req) => {
  const session = await requireSession();
  const body = await parseBody(req, schema);

  const config = await prisma.autoPublishConfig.upsert({
    where: { userId: session.sub },
    create: {
      userId: session.sub,
      enabled: body.enabled,
      intervalMinutes: body.intervalMinutes,
      platforms: body.platforms,
      windowStartHour: body.windowStartHour ?? null,
      windowEndHour: body.windowEndHour ?? null,
      nextRunAt: body.enabled ? new Date() : null,
    },
    update: {
      enabled: body.enabled,
      intervalMinutes: body.intervalMinutes,
      platforms: body.platforms,
      windowStartHour: body.windowStartHour ?? null,
      windowEndHour: body.windowEndHour ?? null,
      // Run on the next tick when (re)enabled.
      nextRunAt: body.enabled ? new Date() : null,
    },
  });

  return ok(serializeAutoConfig(config));
});

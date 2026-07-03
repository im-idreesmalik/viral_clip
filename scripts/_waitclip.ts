import "@/workers/loadEnv";
import { prisma } from "@/lib/db";
const ID = "cmr466apz0047x39o3dcsnq66";
(async () => {
  for (let i = 0; i < 120; i++) {
    const c = await prisma.clip.findFirst({
      where: { videoId: ID, status: "READY", storageKey: { not: null } },
      orderBy: { order: "asc" },
      select: { storageKey: true, startSec: true, endSec: true, captionText: true },
    });
    if (c) { console.log("RESULT " + JSON.stringify(c)); break; }
    await new Promise((r) => setTimeout(r, 15000));
  }
  await prisma.$disconnect(); process.exit(0);
})();

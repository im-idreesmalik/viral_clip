/**
 * Seed script — creates a demo user so you can log in immediately.
 * Run with: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "demo@viralcut.app";
  const password = "demo1234";

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: "Demo Creator",
      passwordHash,
      schedule: {
        create: {
          enabled: false,
          intervalMinutes: 120,
          platforms: [],
        },
      },
    },
  });

  console.log("Seeded demo user:");
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log(`  id:       ${user.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

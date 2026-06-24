import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, parseBody, created, ApiError } from "@/lib/api";
import { hashPassword, createSessionToken, setSessionCookie } from "@/lib/auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().max(120).optional(),
});

export const POST = handler(async (req) => {
  const { email, password, name } = await parseBody(req, schema);
  const normalized = email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) throw new ApiError(409, "An account with that email already exists.");

  const user = await prisma.user.create({
    data: {
      email: normalized,
      name,
      passwordHash: await hashPassword(password),
      schedule: { create: { enabled: false, intervalMinutes: 120, platforms: [] } },
    },
  });

  const token = await createSessionToken({ sub: user.id, email: user.email });
  await setSessionCookie(token);

  return created({ id: user.id, email: user.email, name: user.name });
});

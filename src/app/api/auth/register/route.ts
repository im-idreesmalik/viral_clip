import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, parseBody, created, ApiError } from "@/lib/api";
import { hashPassword, createSessionToken, setSessionCookie } from "@/lib/auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().trim().min(1, "Name is required").max(120),
});

export const POST = handler(async (req) => {
  const { email, password, name } = await parseBody(req, schema);
  const normalized = email.toLowerCase().trim();

  const existingEmail = await prisma.user.findUnique({ where: { email: normalized } });
  if (existingEmail) throw new ApiError(409, "An account with that email already exists.");

  // Names double as a login identifier, so they must be unique (case-insensitive).
  const existingName = await prisma.user.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (existingName) throw new ApiError(409, "That name is taken. Please choose another.");

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

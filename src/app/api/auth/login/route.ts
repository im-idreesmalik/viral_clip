import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, parseBody, ok, ApiError } from "@/lib/api";
import { verifyPassword, createSessionToken, setSessionCookie } from "@/lib/auth";

const schema = z.object({
  // Email OR name (also accepts the legacy "email" field name).
  identifier: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  password: z.string().min(1),
});

export const POST = handler(async (req) => {
  const body = await parseBody(req, schema);
  const identifier = (body.identifier ?? body.email ?? "").trim();
  if (!identifier) throw new ApiError(400, "Enter your email or name.");

  // "@" → look up by email; otherwise by name (case-insensitive).
  const user = identifier.includes("@")
    ? await prisma.user.findUnique({ where: { email: identifier.toLowerCase() } })
    : await prisma.user.findFirst({ where: { name: { equals: identifier, mode: "insensitive" } } });

  // Constant-ish response regardless of which check fails.
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    throw new ApiError(401, "Invalid credentials.");
  }

  const token = await createSessionToken({ sub: user.id, email: user.email });
  await setSessionCookie(token);

  return ok({ id: user.id, email: user.email, name: user.name });
});

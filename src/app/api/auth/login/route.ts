import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, parseBody, ok, ApiError } from "@/lib/api";
import { verifyPassword, createSessionToken, setSessionCookie } from "@/lib/auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const POST = handler(async (req) => {
  const { email, password } = await parseBody(req, schema);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

  // Constant-ish response regardless of which check fails.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new ApiError(401, "Invalid email or password.");
  }

  const token = await createSessionToken({ sub: user.id, email: user.email });
  await setSessionCookie(token);

  return ok({ id: user.id, email: user.email, name: user.name });
});

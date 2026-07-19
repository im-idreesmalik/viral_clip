import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, parseBody, requireSession, isAdminEmail, ApiError } from "@/lib/api";
import { hashPassword, verifyPassword, createSessionToken, setSessionCookie } from "@/lib/auth";

const SELECT = { id: true, email: true, name: true, handle: true, createdAt: true } as const;

export const GET = handler(async () => {
  const session = await requireSession();
  const user = await prisma.user.findUnique({ where: { id: session.sub }, select: SELECT });
  return ok({ user, isAdmin: isAdminEmail(session.email) });
});

const patchSchema = z.object({
  // Clip watermark handle.
  handle: z.string().trim().max(64).optional(),
  // Account profile.
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email("Enter a valid email.").max(200).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(6, "New password must be at least 6 characters.").max(200).optional(),
});

// PATCH /api/auth/me — update the current user's watermark handle and/or account
// profile (name, email, password). Email + password changes require the current
// password. Name + email must stay unique.
export const PATCH = handler(async (req) => {
  const session = await requireSession();
  const body = await parseBody(req, patchSchema);

  const data: Record<string, unknown> = {};

  // Watermark handle: strip a leading @ and keep only ffmpeg-safe characters.
  if (body.handle !== undefined) {
    const h = body.handle.replace(/^@+/, "").replace(/[^\w.\-]/g, "").slice(0, 32).trim();
    data.handle = h || null;
  }

  // Display / login name — must be unique (case-insensitive).
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) throw new ApiError(400, "Username can't be empty.");
    const clash = await prisma.user.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, NOT: { id: session.sub } },
      select: { id: true },
    });
    if (clash) throw new ApiError(409, "That username is already taken.");
    data.name = name;
  }

  // Email and/or password changes require the current password.
  const wantsEmail = body.email !== undefined;
  const wantsPassword = !!body.newPassword;
  let newEmail: string | undefined;
  if (wantsEmail || wantsPassword) {
    if (!body.currentPassword) {
      throw new ApiError(400, "Enter your current password to change your email or password.");
    }
    const me = await prisma.user.findUnique({ where: { id: session.sub }, select: { passwordHash: true } });
    if (!me || !(await verifyPassword(body.currentPassword, me.passwordHash))) {
      throw new ApiError(400, "Your current password is incorrect.");
    }
    if (wantsEmail) {
      newEmail = body.email!.toLowerCase().trim();
      const clash = await prisma.user.findFirst({
        where: { email: newEmail, NOT: { id: session.sub } },
        select: { id: true },
      });
      if (clash) throw new ApiError(409, "That email is already in use.");
      data.email = newEmail;
    }
    if (wantsPassword) {
      data.passwordHash = await hashPassword(body.newPassword!);
    }
  }

  if (Object.keys(data).length === 0) {
    const user = await prisma.user.findUnique({ where: { id: session.sub }, select: SELECT });
    return ok({ user });
  }

  let user;
  try {
    user = await prisma.user.update({ where: { id: session.sub }, data, select: SELECT });
  } catch (err) {
    if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") {
      throw new ApiError(409, "That username or email is already in use.");
    }
    throw err;
  }

  // Email changed → re-issue the session token so admin checks use the new email.
  if (newEmail) {
    await setSessionCookie(await createSessionToken({ sub: user!.id, email: newEmail }));
  }

  return ok({ user });
});

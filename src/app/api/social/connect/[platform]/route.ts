import { NextResponse } from "next/server";
import { requireSession, ApiError, handler, oauthRedirectForRequest } from "@/lib/api";
import { randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { getProvider, platformFromSlug } from "@/services/social";

type Ctx = { params: Promise<{ platform: string }> };

// GET /api/social/connect/[platform] — begin the OAuth consent flow.
export const GET = handler(async (req, ctx: Ctx) => {
  await requireSession();
  const { platform: slug } = await ctx.params;

  const platform = platformFromSlug(slug);
  if (!platform) throw new ApiError(404, "Unknown platform");

  const provider = getProvider(platform);
  if (!provider.isConfigured()) {
    throw new ApiError(400, `${provider.label} OAuth is not configured on this server.`);
  }

  // CSRF protection: random state echoed back + stored in a short-lived cookie.
  const state = randomToken();
  // Build the callback URL from the domain the user is actually on, so it works
  // on localhost, a tunnel, or a deployment. The callback recomputes the same
  // value from its own request origin (same domain → same URI).
  const redirectUri = oauthRedirectForRequest(req, slug);
  const authUrl = provider.getAuthorizationUrl(state, redirectUri);

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(`vc_oauth_${slug}`, state, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes
  });
  return res;
});

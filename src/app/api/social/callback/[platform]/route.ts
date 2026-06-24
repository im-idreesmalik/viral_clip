import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getSession } from "@/lib/auth";
import { oauthRedirectForRequest } from "@/lib/api";
import { createLogger } from "@/lib/logger";
import { encrypt, encryptMaybe } from "@/lib/crypto";
import { getProvider, platformFromSlug, slugFromPlatform } from "@/services/social";

const log = createLogger("social:callback");

type Ctx = { params: Promise<{ platform: string }> };

function redirectTo(path: string, params: Record<string, string>) {
  const url = new URL(path, env.appUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

// GET /api/social/callback/[platform] — OAuth redirect target.
export async function GET(req: NextRequest, ctx: Ctx) {
  const { platform: slug } = await ctx.params;
  const platform = platformFromSlug(slug);
  const dest = "/dashboard/connections";

  if (!platform) return redirectTo(dest, { error: "Unknown platform" });

  const session = await getSession();
  if (!session) return redirectTo("/login", { next: dest });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return redirectTo(dest, { error: `${slug}: ${oauthError}` });
  if (!code || !state) return redirectTo(dest, { error: "Missing code/state from provider." });

  // Validate CSRF state against the cookie set at connect time.
  const expected = req.cookies.get(`vc_oauth_${slug}`)?.value;
  if (!expected || expected !== state) {
    return redirectTo(dest, { error: "OAuth state mismatch. Please retry." });
  }

  try {
    const provider = getProvider(platform);
    // Must match the redirect URI used at authorize time. Both are derived from
    // the same request origin (the browser stays on one domain through the flow).
    const redirectUri = oauthRedirectForRequest(req, slug);
    const result = await provider.handleCallback(code, state, redirectUri);

    await prisma.socialAccount.upsert({
      where: {
        userId_platform_externalId: {
          userId: session.sub,
          platform,
          externalId: result.externalId,
        },
      },
      update: {
        displayName: result.displayName,
        username: result.username,
        avatarUrl: result.avatarUrl,
        accessTokenEnc: encrypt(result.accessToken),
        refreshTokenEnc: encryptMaybe(result.refreshToken),
        scope: result.scope,
        tokenExpiresAt: result.expiresAt ?? null,
        meta: (result.meta as object) ?? undefined,
        isActive: true,
      },
      create: {
        userId: session.sub,
        platform,
        externalId: result.externalId,
        displayName: result.displayName,
        username: result.username,
        avatarUrl: result.avatarUrl,
        accessTokenEnc: encrypt(result.accessToken),
        refreshTokenEnc: encryptMaybe(result.refreshToken),
        scope: result.scope,
        tokenExpiresAt: result.expiresAt ?? null,
        meta: (result.meta as object) ?? undefined,
      },
    });

    const res = redirectTo(dest, { connected: slugFromPlatform(platform) });
    res.cookies.delete(`vc_oauth_${slug}`);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("OAuth callback failed", { platform: slug, message });
    return redirectTo(dest, { error: message.slice(0, 200) });
  }
}

/**
 * Instagram Reels via the **Instagram API with Instagram Login**.
 *
 * This is Meta's current Instagram publishing path. It replaces the legacy
 * "Instagram via Facebook Login" flow, whose `instagram_basic` /
 * `instagram_content_publish` permissions Meta no longer grants to newly created
 * apps (requesting them returns "Invalid Scopes").
 *
 * The user logs in directly with Instagram — no Facebook Page required, only an
 * Instagram **Business or Creator** account. Auth uses the **Instagram** App
 * ID/Secret (dashboard → Instagram product → "API setup with Instagram login"),
 * which are DISTINCT from META_APP_ID / META_APP_SECRET (those still power
 * Facebook Reels in facebook.ts).
 *
 * OAuth:
 *   GET  https://www.instagram.com/oauth/authorize            -> code
 *   POST https://api.instagram.com/oauth/access_token         -> short-lived token + user_id
 *   GET  https://graph.instagram.com/access_token             -> long-lived token (~60 days)
 *
 * Publishing is pull-based: create a REELS container pointing at a PUBLIC video
 * URL, poll until Instagram ingests it, then publish. The app's media must be
 * reachable from the public internet — set MEDIA_PUBLIC_BASE to a public HTTPS base.
 *
 * Redirect URI to register (Instagram product → business login settings):
 *   {APP_URL}/api/social/callback/instagram
 */
import { Platform } from "@prisma/client";
import { env, oauthRedirectUri } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import {
  type SocialProvider,
  type OAuthResult,
  type PublishInput,
  type PublishResult,
  type AccountContext,
  type RefreshResult,
  PublishError,
} from "./types";

const log = createLogger("social:instagram");

const AUTHORIZE = "https://www.instagram.com/oauth/authorize";
const TOKEN = "https://api.instagram.com/oauth/access_token";
const GRAPH = "https://graph.instagram.com";
const API_VERSION = "v21.0";

// Instagram Login (business) scopes — the current names. The old
// instagram_basic / instagram_content_publish are rejected on new apps.
const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

function redirect(redirectUri?: string): string {
  return redirectUri ?? oauthRedirectUri("instagram");
}

export const instagramProvider: SocialProvider = {
  platform: Platform.INSTAGRAM,
  label: "Instagram Reels",
  scopes: SCOPES,

  isConfigured() {
    return Boolean(env.social.instagram.appId && env.social.instagram.appSecret);
  },

  getAuthorizationUrl(state: string, redirectUri?: string): string {
    const params = new URLSearchParams({
      client_id: env.social.instagram.appId,
      redirect_uri: redirect(redirectUri),
      response_type: "code",
      scope: SCOPES.join(","),
      state,
    });
    return `${AUTHORIZE}?${params}`;
  },

  async handleCallback(code: string, _state: string, redirectUri?: string): Promise<OAuthResult> {
    // Instagram appends "#_" to the code in the browser redirect; that fragment
    // never reaches the server, but strip it defensively just in case.
    const cleanCode = code.replace(/#_$/, "");

    // 1. Exchange code -> short-lived token + the IG user id.
    const tokenRes = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.social.instagram.appId,
        client_secret: env.social.instagram.appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirect(redirectUri),
        code: cleanCode,
      }),
    });
    const short = await tokenRes.json();
    if (!tokenRes.ok || short.error_type || short.error || !short.access_token) {
      throw new Error(`Instagram token exchange failed: ${JSON.stringify(short)}`);
    }

    // 2. Exchange the short-lived token for a long-lived one (~60 days).
    const longRes = await fetch(
      `${GRAPH}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(
        env.social.instagram.appSecret,
      )}&access_token=${encodeURIComponent(short.access_token)}`,
    );
    const long = await longRes.json();
    if (!longRes.ok || long.error || !long.access_token) {
      throw new Error(`Instagram long-lived token exchange failed: ${JSON.stringify(long)}`);
    }
    const accessToken = long.access_token as string;
    const expiresAt = long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : undefined;

    // 3. Fetch profile + the Instagram professional account id used for publishing.
    //    IMPORTANT: the content-publishing endpoints (/{ig-id}/media) require the
    //    `user_id` returned by /me — NOT the OAuth token's `user_id`, which is a
    //    different (app-scoped) id and is rejected with "object does not exist".
    const profileRes = await fetch(
      `${GRAPH}/${API_VERSION}/me?fields=user_id,username,name,profile_picture_url,account_type&access_token=${encodeURIComponent(
        accessToken,
      )}`,
    );
    const profile = await profileRes.json();
    const igUserId = String(profile.user_id ?? short.user_id);

    return {
      externalId: igUserId,
      displayName: profile.name ?? profile.username,
      username: profile.username,
      avatarUrl: profile.profile_picture_url,
      accessToken,
      expiresAt,
      scope: SCOPES.join(","),
      meta: { igUserId, accountType: profile.account_type },
    };
  },

  async refresh(account: AccountContext): Promise<RefreshResult> {
    const res = await fetch(
      `${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(
        account.accessToken,
      )}`,
    );
    const json = await res.json();
    if (!res.ok || json.error || !json.access_token) {
      throw new Error(`Instagram token refresh failed: ${JSON.stringify(json)}`);
    }
    return {
      accessToken: json.access_token,
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
    };
  },

  async publish(input: PublishInput): Promise<PublishResult> {
    const meta = input.account.meta ?? {};
    const igUserId = (meta.igUserId as string) ?? input.account.externalId;
    const accessToken = input.account.accessToken;

    if (!isPublicUrl(input.publicUrl)) {
      throw new PublishError(
        "Instagram requires a publicly reachable video URL. Set MEDIA_PUBLIC_BASE to a public HTTPS base.",
      );
    }

    // 1. Create the REELS container.
    const createRes = await fetch(`${GRAPH}/${API_VERSION}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "REELS",
        video_url: input.publicUrl,
        caption: `${input.title}\n\n${input.caption}`.trim().slice(0, 2200),
        access_token: accessToken,
      }),
    });
    const created = await createRes.json();
    if (!createRes.ok || created.error) {
      throw new PublishError(
        `IG container create failed: ${JSON.stringify(created.error ?? created)}`,
        createRes.status >= 500,
      );
    }
    const creationId = created.id;

    // 2. Poll the container until it's ready to publish.
    await waitForContainer(creationId, accessToken);

    // 3. Publish.
    const pubRes = await fetch(`${GRAPH}/${API_VERSION}/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
    });
    const published = await pubRes.json();
    if (!pubRes.ok || published.error) {
      throw new PublishError(`IG publish failed: ${JSON.stringify(published.error ?? published)}`, pubRes.status >= 500);
    }

    log.info("Published to Instagram", { mediaId: published.id });
    return { externalPostId: published.id, externalUrl: undefined };
  },
};

async function waitForContainer(creationId: string, token: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await delay(3000);
    const res = await fetch(
      `${GRAPH}/${API_VERSION}/${creationId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
    );
    const json = await res.json();
    if (json.status_code === "FINISHED") return;
    if (json.status_code === "ERROR") {
      throw new PublishError(`IG media processing error: ${JSON.stringify(json)}`);
    }
  }
  throw new PublishError("IG media did not finish processing in time.", true);
}

function isPublicUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

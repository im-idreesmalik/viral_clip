/**
 * TikTok via the Content Posting API + Login Kit v2.
 *
 * Prerequisites:
 *   - A TikTok developer app with Login Kit + Content Posting API products.
 *   - Scopes video.publish + user.info.basic, redirect URI
 *     {APP_URL}/api/social/callback/tiktok.
 *   - TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET in env.
 *
 * NOTE: Direct (public) posting requires the app to pass TikTok's audit.
 * Unaudited apps can only post privately (SELF_ONLY). We default to public and
 * surface TikTok's error verbatim if the app isn't approved.
 */
import fsp from "node:fs/promises";
import crypto from "node:crypto";
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

const log = createLogger("social:tiktok");
const REDIRECT = () => oauthRedirectUri("tiktok");
const API = "https://open.tiktokapis.com";

// TikTok requires PKCE. The code_verifier must be the same on the authorize
// request and the token exchange — those are two separate HTTP requests, but
// both have the shared OAuth `state` (carried via the connect-time cookie), so
// we derive a deterministic, valid-length (43-char) verifier from it. No extra
// storage needed.
function pkceVerifier(state: string): string {
  return crypto.createHash("sha256").update(`vc-pkce:${state}`).digest("base64url");
}
function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

interface CreatorInfo {
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
}

/** Query what the connected creator/app is allowed to post (required by TikTok). */
async function queryCreatorInfo(accessToken: string): Promise<CreatorInfo> {
  const res = await fetch(`${API}/v2/post/publish/creator_info/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
  });
  const json = await res.json();
  if (!res.ok || json.error?.code !== "ok") {
    throw new PublishError(
      `TikTok creator info query failed: ${JSON.stringify(json.error ?? json)}`,
      res.status >= 500,
    );
  }
  return (json.data ?? {}) as CreatorInfo;
}

/**
 * Choose a privacy level. Public posting (PUBLIC_TO_EVERYONE) is only allowed
 * for AUDITED apps — TikTok offers it in the creator-info options only then.
 * If it isn't offered, the app is restricted (unaudited/sandbox) and the only
 * level TikTok will accept is SELF_ONLY (private). The other "options" TikTok
 * lists (followers/friends) are account capabilities the unaudited app still
 * can't use, so we don't pick them.
 */
function pickPrivacyLevel(options?: string[]): string {
  const available = options && options.length ? options : ["SELF_ONLY"];
  return available.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY";
}

/** Initialize a single-chunk FILE_UPLOAD direct post. Returns the parsed JSON. */
async function initVideoPost(
  accessToken: string,
  title: string,
  privacyLevel: string,
  creator: CreatorInfo,
  size: number,
): Promise<{ error?: { code?: string }; data?: { publish_id: string; upload_url: string } }> {
  const res = await fetch(`${API}/v2/post/publish/video/init/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: {
        title,
        privacy_level: privacyLevel,
        // Respect the creator's interaction settings, or TikTok rejects the post.
        disable_comment: Boolean(creator.comment_disabled),
        disable_duet: Boolean(creator.duet_disabled),
        disable_stitch: Boolean(creator.stitch_disabled),
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: size,
        chunk_size: size,
        total_chunk_count: 1,
      },
    }),
  });
  return res.json();
}

export const tiktokProvider: SocialProvider = {
  platform: Platform.TIKTOK,
  label: "TikTok",
  scopes: ["user.info.basic", "video.publish"],

  isConfigured() {
    return Boolean(env.social.tiktok.clientKey && env.social.tiktok.clientSecret);
  },

  getAuthorizationUrl(state: string, redirectUri?: string): string {
    const params = new URLSearchParams({
      client_key: env.social.tiktok.clientKey,
      scope: this.scopes.join(","),
      response_type: "code",
      redirect_uri: redirectUri ?? REDIRECT(),
      state,
      // PKCE (required by TikTok).
      code_challenge: pkceChallenge(pkceVerifier(state)),
      code_challenge_method: "S256",
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
  },

  async handleCallback(code: string, state: string, redirectUri?: string): Promise<OAuthResult> {
    const tokenRes = await fetch(`${API}/v2/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: env.social.tiktok.clientKey,
        client_secret: env.social.tiktok.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri ?? REDIRECT(),
        // Matching PKCE verifier for the challenge sent at authorize time.
        code_verifier: pkceVerifier(state),
      }),
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok || token.error) {
      throw new Error(`TikTok token exchange failed: ${JSON.stringify(token)}`);
    }

    const infoRes = await fetch(
      `${API}/v2/user/info/?fields=open_id,display_name,avatar_url,username`,
      { headers: { Authorization: `Bearer ${token.access_token}` } },
    );
    const info = await infoRes.json();
    const user = info?.data?.user ?? {};

    return {
      externalId: token.open_id ?? user.open_id,
      displayName: user.display_name,
      username: user.username,
      avatarUrl: user.avatar_url,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      scope: token.scope,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined,
    };
  },

  async refresh(account: AccountContext): Promise<RefreshResult> {
    if (!account.refreshToken) throw new Error("No refresh token for TikTok account.");
    const res = await fetch(`${API}/v2/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: env.social.tiktok.clientKey,
        client_secret: env.social.tiktok.clientSecret,
        grant_type: "refresh_token",
        refresh_token: account.refreshToken,
      }),
    });
    const token = await res.json();
    if (!res.ok || token.error) throw new Error(`TikTok refresh failed: ${JSON.stringify(token)}`);
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined,
    };
  },

  async publish(input: PublishInput): Promise<PublishResult> {
    const file = await fsp.readFile(input.filePath);
    const size = file.byteLength;
    const accessToken = input.account.accessToken;

    // 0. Query the creator's allowed posting options. TikTok requires the
    //    privacy_level to be one the account/app actually permits — and an
    //    UNAUDITED app is only allowed SELF_ONLY (private). It also tells us
    //    which interactions (comment/duet/stitch) the creator has turned off.
    const creator = await queryCreatorInfo(accessToken);
    const title = `${input.title} ${input.caption}`.trim().slice(0, 2200);

    // 1. Initialize the post. Try the preferred privacy level, but an UNAUDITED
    //    app is only ever allowed SELF_ONLY (private) — TikTok rejects anything
    //    else with `unaudited_client_can_only_post_to_private_accounts`. So if
    //    that happens, transparently retry as SELF_ONLY.
    const preferred = pickPrivacyLevel(creator.privacy_level_options);
    log.info("TikTok creator info", { options: creator.privacy_level_options, chosen: preferred });

    let init = await initVideoPost(accessToken, title, preferred, creator, size);
    if (
      init.error?.code === "unaudited_client_can_only_post_to_private_accounts" &&
      preferred !== "SELF_ONLY"
    ) {
      log.warn("TikTok app is unaudited; retrying as SELF_ONLY (private post).");
      init = await initVideoPost(accessToken, title, "SELF_ONLY", creator, size);
    }
    if (init.error?.code !== "ok" || !init.data) {
      throw new PublishError(`TikTok init failed: ${JSON.stringify(init.error ?? init)}`);
    }
    const { publish_id, upload_url } = init.data;

    // 2. Upload the single chunk.
    const uploadRes = await fetch(upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(size),
        "Content-Range": `bytes 0-${size - 1}/${size}`,
      },
      body: file,
    });
    if (!uploadRes.ok) {
      const body = await uploadRes.text();
      throw new PublishError(`TikTok upload failed (${uploadRes.status}): ${body}`, uploadRes.status >= 500);
    }

    // 3. Poll until the post is processed.
    const postId = await pollStatus(publish_id, input.account.accessToken);
    log.info("Published to TikTok", { publish_id, postId });
    return {
      externalPostId: postId ?? publish_id,
      externalUrl: postId ? `https://www.tiktok.com/@me/video/${postId}` : undefined,
    };
  },
};

async function pollStatus(publishId: string, accessToken: string): Promise<string | null> {
  for (let i = 0; i < 12; i++) {
    await delay(2500);
    const res = await fetch(`${API}/v2/post/publish/status/fetch/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const json = await res.json();
    const status = json?.data?.status;
    if (status === "PUBLISH_COMPLETE") {
      return json.data.publicaly_available_post_id?.[0] ?? json.data.publicly_available_post_id?.[0] ?? null;
    }
    if (status === "FAILED") {
      throw new PublishError(`TikTok processing failed: ${JSON.stringify(json.data)}`);
    }
  }
  // Still processing — treat as success; the post will appear shortly.
  return null;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

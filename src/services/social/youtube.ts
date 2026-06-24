/**
 * YouTube (Shorts) via the YouTube Data API v3 + Google OAuth 2.0.
 *
 * Prerequisites:
 *   - A Google Cloud project with the YouTube Data API v3 enabled.
 *   - An OAuth client (Web application) whose redirect URI is
 *     {APP_URL}/api/social/callback/youtube.
 *   - YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET in env.
 *
 * Publish uses a resumable upload; vertical clips under 60s with #Shorts are
 * surfaced as Shorts by YouTube automatically.
 */
import fsp from "node:fs/promises";
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

const log = createLogger("social:youtube");
const REDIRECT = () => oauthRedirectUri("youtube");

export const youtubeProvider: SocialProvider = {
  platform: Platform.YOUTUBE,
  label: "YouTube",
  scopes: [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
  ],

  isConfigured() {
    return Boolean(env.social.youtube.clientId && env.social.youtube.clientSecret);
  },

  getAuthorizationUrl(state: string, redirectUri?: string): string {
    const params = new URLSearchParams({
      client_id: env.social.youtube.clientId,
      redirect_uri: redirectUri ?? REDIRECT(),
      response_type: "code",
      scope: this.scopes.join(" "),
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },

  async handleCallback(code: string, _state: string, redirectUri?: string): Promise<OAuthResult> {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.social.youtube.clientId,
        client_secret: env.social.youtube.clientSecret,
        redirect_uri: redirectUri ?? REDIRECT(),
        grant_type: "authorization_code",
      }),
    });
    const token = await tokenRes.json();
    if (!tokenRes.ok) {
      throw new Error(`YouTube token exchange failed: ${JSON.stringify(token)}`);
    }

    const channelRes = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      { headers: { Authorization: `Bearer ${token.access_token}` } },
    );
    const channel = await channelRes.json();
    const item = channel.items?.[0];

    return {
      externalId: item?.id ?? "unknown",
      displayName: item?.snippet?.title,
      username: item?.snippet?.customUrl,
      avatarUrl: item?.snippet?.thumbnails?.default?.url,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      scope: token.scope,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined,
    };
  },

  async refresh(account: AccountContext): Promise<RefreshResult> {
    if (!account.refreshToken) throw new Error("No refresh token for YouTube account.");
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.social.youtube.clientId,
        client_secret: env.social.youtube.clientSecret,
        refresh_token: account.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const token = await res.json();
    if (!res.ok) throw new Error(`YouTube token refresh failed: ${JSON.stringify(token)}`);
    return {
      accessToken: token.access_token,
      expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : undefined,
    };
  },

  async publish(input: PublishInput): Promise<PublishResult> {
    const file = await fsp.readFile(input.filePath);
    const description = `${input.caption}\n\n#Shorts`.trim();
    const metadata = {
      snippet: {
        title: input.title.slice(0, 100),
        description: description.slice(0, 4900),
        categoryId: "22",
      },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
    };

    // 1. Start a resumable session.
    const initRes = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.account.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(file.byteLength),
          "X-Upload-Content-Type": "video/mp4",
        },
        body: JSON.stringify(metadata),
      },
    );
    if (!initRes.ok) {
      const body = await initRes.text();
      throw new PublishError(`YouTube upload init failed (${initRes.status}): ${body}`, initRes.status >= 500);
    }
    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) throw new PublishError("YouTube did not return an upload URL.");

    // 2. Upload the bytes.
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Content-Length": String(file.byteLength) },
      body: file,
    });
    const result = await uploadRes.json();
    if (!uploadRes.ok) {
      throw new PublishError(`YouTube upload failed (${uploadRes.status}): ${JSON.stringify(result)}`, uploadRes.status >= 500 || uploadRes.status === 429);
    }

    log.info("Published to YouTube", { videoId: result.id });
    return {
      externalPostId: result.id,
      externalUrl: `https://www.youtube.com/shorts/${result.id}`,
    };
  },
};

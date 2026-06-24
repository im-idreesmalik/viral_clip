/**
 * Facebook Reels via the Graph API Reels publishing flow.
 *
 * Three phases against {page-id}/video_reels: start (get a video id + upload
 * url), upload (we use the hosted `file_url` header so Facebook pulls the file
 * — requires a public URL), then finish with video_state=PUBLISHED.
 */
import fsp from "node:fs/promises";
import { Platform } from "@prisma/client";
import { createLogger } from "@/lib/logger";
import {
  type SocialProvider,
  type OAuthResult,
  type PublishInput,
  type PublishResult,
  PublishError,
} from "./types";
import { GRAPH, GRAPH_VERSION, buildAuthUrl, exchangeCode, getLongLivedToken, getPages, metaConfigured } from "./meta";

const log = createLogger("social:facebook");

// NOTE: `publish_video` is deprecated/removed by Meta — Page video & Reels
// publishing is covered by `pages_manage_posts`. Requesting publish_video
// returns "Invalid Scopes".
const SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "business_management",
];

export const facebookProvider: SocialProvider = {
  platform: Platform.FACEBOOK,
  label: "Facebook Reels",
  scopes: SCOPES,

  isConfigured() {
    return metaConfigured();
  },

  getAuthorizationUrl(state: string, redirectUri?: string): string {
    return buildAuthUrl("facebook", SCOPES, state, redirectUri);
  },

  async handleCallback(code: string, _state: string, redirectUri?: string): Promise<OAuthResult> {
    const short = await exchangeCode("facebook", code, redirectUri);
    const { token, expiresAt } = await getLongLivedToken(short);
    const pages = await getPages(token);

    const page = pages[0];
    if (!page) {
      throw new Error("No Facebook Page found. You must manage at least one Page to publish Reels.");
    }

    return {
      externalId: page.id,
      displayName: page.name,
      username: page.name,
      accessToken: token,
      expiresAt,
      scope: SCOPES.join(","),
      meta: { pageId: page.id, pageAccessToken: page.accessToken, pages },
    };
  },

  async publish(input: PublishInput): Promise<PublishResult> {
    const meta = input.account.meta ?? {};
    const pageId = (meta.pageId as string) ?? input.account.externalId;
    const pageToken = (meta.pageAccessToken as string) ?? input.account.accessToken;

    // 1. Start an upload session.
    const startRes = await fetch(`${GRAPH}/${pageId}/video_reels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_phase: "start", access_token: pageToken }),
    });
    const start = await startRes.json();
    if (!startRes.ok || start.error) {
      throw new PublishError(`FB reels start failed: ${JSON.stringify(start.error ?? start)}`, startRes.status >= 500);
    }
    const videoId = start.video_id;

    // 2. Upload the file bytes directly (resumable upload). We push the bytes
    //    ourselves instead of giving Facebook a file_url to pull: the pull path
    //    requires our media URL to be crawlable, and a Cloudflare-managed
    //    robots.txt that disallows Meta's crawler blocks it with
    //    "403 Restricted by robots.txt". Direct upload removes that dependency.
    const file = await fsp.readFile(input.filePath);
    const uploadRes = await fetch(`https://rupload.facebook.com/video-upload/${GRAPH_VERSION}/${videoId}`, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${pageToken}`,
        offset: "0",
        file_size: String(file.byteLength),
      },
      body: file,
    });
    const upload = await uploadRes.json();
    if (!uploadRes.ok || upload.error || upload.debug_info || upload.success === false) {
      throw new PublishError(`FB reels upload failed: ${JSON.stringify(upload)}`, uploadRes.status >= 500);
    }

    // 3. Finish + publish.
    const finishParams = new URLSearchParams({
      access_token: pageToken,
      video_id: videoId,
      upload_phase: "finish",
      video_state: "PUBLISHED",
      description: `${input.title}\n\n${input.caption}`.trim().slice(0, 2200),
    });
    const finishRes = await fetch(`${GRAPH}/${pageId}/video_reels?${finishParams}`, { method: "POST" });
    const finish = await finishRes.json();
    if (!finishRes.ok || finish.error) {
      throw new PublishError(`FB reels finish failed: ${JSON.stringify(finish.error ?? finish)}`, finishRes.status >= 500);
    }

    log.info("Published to Facebook Reels", { videoId });
    return {
      externalPostId: videoId,
      externalUrl: `https://www.facebook.com/reel/${videoId}`,
    };
  },
};

/**
 * Shared Meta (Facebook + Instagram) Graph API helpers.
 *
 * A single Meta app powers both Instagram Reels and Facebook Reels publishing.
 * The OAuth flow (Facebook Login) yields a user token, which we exchange for a
 * long-lived token and use to enumerate the Pages the user manages (each Page
 * carries its own page access token + optional linked Instagram account).
 *
 * Prerequisites: META_APP_ID / META_APP_SECRET, an app with the Instagram Graph
 * API + Facebook Login products, and a Business/Creator IG account linked to a
 * Facebook Page. Redirect URIs:
 *   {APP_URL}/api/social/callback/instagram
 *   {APP_URL}/api/social/callback/facebook
 */
import { env, oauthRedirectUri } from "@/lib/env";

export const GRAPH_VERSION = "v21.0";
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
  igUserId?: string;
}

export function metaConfigured(): boolean {
  return Boolean(env.social.meta.appId && env.social.meta.appSecret);
}

export function buildAuthUrl(
  platform: "instagram" | "facebook",
  scopes: string[],
  state: string,
  redirectUri?: string,
): string {
  const params = new URLSearchParams({
    client_id: env.social.meta.appId,
    redirect_uri: redirectUri ?? oauthRedirectUri(platform),
    state,
    response_type: "code",
    scope: scopes.join(","),
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}`;
}

export async function exchangeCode(
  platform: "instagram" | "facebook",
  code: string,
  redirectUri?: string,
): Promise<string> {
  const params = new URLSearchParams({
    client_id: env.social.meta.appId,
    client_secret: env.social.meta.appSecret,
    redirect_uri: redirectUri ?? oauthRedirectUri(platform),
    code,
  });
  const res = await fetch(`${GRAPH}/oauth/access_token?${params}`);
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Meta code exchange failed: ${JSON.stringify(json.error ?? json)}`);
  }
  return json.access_token as string;
}

export async function getLongLivedToken(shortToken: string): Promise<{ token: string; expiresAt?: Date }> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: env.social.meta.appId,
    client_secret: env.social.meta.appSecret,
    fb_exchange_token: shortToken,
  });
  const res = await fetch(`${GRAPH}/oauth/access_token?${params}`);
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Meta long-lived token exchange failed: ${JSON.stringify(json.error ?? json)}`);
  }
  return {
    token: json.access_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
  };
}

/** List the Pages this user manages, including any linked IG business account. */
export async function getPages(userToken: string): Promise<MetaPage[]> {
  const res = await fetch(
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(userToken)}`,
  );
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Meta page lookup failed: ${JSON.stringify(json.error ?? json)}`);
  }
  return (json.data ?? []).map((p: Record<string, any>) => ({
    id: p.id,
    name: p.name,
    accessToken: p.access_token,
    igUserId: p.instagram_business_account?.id,
  }));
}

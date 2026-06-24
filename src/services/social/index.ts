/**
 * Provider registry. Maps each Platform enum to its SocialProvider and exposes
 * helpers used by the OAuth routes, the dashboard, and the publish worker.
 */
import { Platform } from "@prisma/client";
import type { SocialProvider } from "./types";
import { youtubeProvider } from "./youtube";
import { tiktokProvider } from "./tiktok";
import { instagramProvider } from "./instagram";
import { facebookProvider } from "./facebook";

const PROVIDERS: Record<Platform, SocialProvider> = {
  [Platform.YOUTUBE]: youtubeProvider,
  [Platform.TIKTOK]: tiktokProvider,
  [Platform.INSTAGRAM]: instagramProvider,
  [Platform.FACEBOOK]: facebookProvider,
};

/** URL-path slug <-> Platform mapping for the OAuth routes. */
const SLUGS: Record<string, Platform> = {
  youtube: Platform.YOUTUBE,
  tiktok: Platform.TIKTOK,
  instagram: Platform.INSTAGRAM,
  facebook: Platform.FACEBOOK,
};

export function getProvider(platform: Platform): SocialProvider {
  return PROVIDERS[platform];
}

export function platformFromSlug(slug: string): Platform | null {
  return SLUGS[slug.toLowerCase()] ?? null;
}

export function slugFromPlatform(platform: Platform): string {
  return platform.toLowerCase();
}

function allProviders(): SocialProvider[] {
  return Object.values(PROVIDERS);
}

/** Catalog of platforms + whether each has app credentials configured. */
export function platformCatalog() {
  return allProviders().map((p) => ({
    platform: p.platform,
    slug: slugFromPlatform(p.platform),
    label: p.label,
    configured: p.isConfigured(),
  }));
}

export { PublishError } from "./types";

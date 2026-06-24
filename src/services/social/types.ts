/**
 * Social platform integration contracts.
 *
 * Every platform implements the same `SocialProvider` interface so the OAuth
 * routes, the publish worker, and the scheduler can treat them uniformly.
 * Concrete providers live alongside this file (youtube.ts, tiktok.ts, ...).
 */
import type { Platform } from "@prisma/client";

/** Identity + credentials resolved after a successful OAuth exchange. */
export interface OAuthResult {
  externalId: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string;
  accessToken: string;
  refreshToken?: string;
  scope?: string;
  /** Absolute expiry time of the access token. */
  expiresAt?: Date;
  /** Platform-specific extras persisted on the account (e.g. IG/FB ids). */
  meta?: Record<string, unknown>;
}

/** Decrypted account context handed to publish/refresh calls. */
export interface AccountContext {
  externalId: string;
  accessToken: string;
  refreshToken?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface PublishInput {
  /** Absolute path to the rendered 9:16 MP4 on disk. */
  filePath: string;
  /** Publicly reachable URL of the file (required by IG/FB pull-based upload). */
  publicUrl: string;
  caption: string;
  title: string;
  account: AccountContext;
}

export interface PublishResult {
  externalPostId: string;
  externalUrl?: string;
}

/** Returned by refresh() so the caller can persist rotated credentials. */
export interface RefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface SocialProvider {
  platform: Platform;
  /** Human-friendly label. */
  label: string;
  /** OAuth scopes requested at connect time. */
  scopes: string[];
  /** True when the platform's app credentials are configured in env. */
  isConfigured(): boolean;
  /**
   * Build the consent URL to redirect the user to. `redirectUri`, when given,
   * overrides the env-derived callback URL so it matches the domain the user is
   * actually on (localhost vs. a public tunnel/deployment). It MUST be the same
   * value passed to handleCallback.
   */
  getAuthorizationUrl(state: string, redirectUri?: string): string;
  /** Exchange the OAuth `code` for tokens + identity. */
  handleCallback(code: string, state: string, redirectUri?: string): Promise<OAuthResult>;
  /** Refresh an expired access token, if the platform supports it. */
  refresh?(account: AccountContext): Promise<RefreshResult>;
  /** Upload + publish a rendered clip. */
  publish(input: PublishInput): Promise<PublishResult>;
}

export class PublishError extends Error {
  /** Whether retrying later might succeed (rate limits, transient 5xx). */
  retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

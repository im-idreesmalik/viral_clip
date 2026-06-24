/**
 * Client-facing DTO types (the shapes returned by the serialize.ts helpers).
 * Shared between API responses and React components.
 */
export type VideoStatus =
  | "PENDING"
  | "DOWNLOADING"
  | "TRANSCRIBING"
  | "ANALYZING"
  | "GENERATING"
  | "READY"
  | "FAILED";

export type ClipStatus = "PENDING" | "RENDERING" | "READY" | "APPROVED" | "REJECTED" | "FAILED";
export type ClipMode = "VIRAL" | "FULL";
export type PlatformName = "TIKTOK" | "INSTAGRAM" | "FACEBOOK" | "YOUTUBE";
export type PublicationStatus =
  | "SCHEDULED"
  | "QUEUED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED"
  | "CANCELLED";

export interface ClipDTO {
  id: string;
  videoId: string;
  title: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  viralScore: number | null;
  reason: string | null;
  order: number | null;
  status: ClipStatus;
  captionText: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  captionsUrl: string | null;
  errorMessage: string | null;
  publishedPlatforms: PlatformName[];
  composedCaption: string;
  createdAt: string;
  updatedAt: string;
}

export interface VideoDTO {
  id: string;
  title: string;
  source: "YOUTUBE" | "UPLOAD";
  sourceUrl: string | null;
  status: VideoStatus;
  clipMode: ClipMode;
  viralThreshold: number;
  segmentSeconds: number;
  targetClipCount: number;
  burnCaptions: boolean;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  thumbnailUrl: string | null;
  sourceMediaUrl: string | null;
  hashtags: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  clips?: ClipDTO[];
  clipCount?: number;
}

export interface SocialAccountDTO {
  id: string;
  platform: PlatformName;
  externalId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  scope: string | null;
  isActive: boolean;
  tokenExpiresAt: string | null;
  createdAt: string;
}

export interface PlatformCatalogItem {
  platform: PlatformName;
  slug: string;
  label: string;
  configured: boolean;
}

export interface PublicationDTO {
  id: string;
  clipId: string;
  platform: PlatformName;
  status: PublicationStatus;
  caption: string | null;
  publishAt: string | null;
  publishedAt: string | null;
  externalUrl: string | null;
  externalPostId: string | null;
  attempts: number;
  lastError: string | null;
  autoScheduled: boolean;
  createdAt: string;
  clip?: ClipDTO;
  account?: SocialAccountDTO;
}

export interface AutoConfigDTO {
  enabled: boolean;
  intervalMinutes: number;
  platforms: PlatformName[];
  windowStartHour: number | null;
  windowEndHour: number | null;
  nextRunAt: string | null;
  lastScheduledAt?: string | null;
}

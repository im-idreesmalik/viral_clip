"use client";

import clsx from "clsx";
import type { VideoStatus, ClipStatus, PublicationStatus } from "@/lib/types";

const VIDEO_STATUS: Record<VideoStatus, { label: string; cls: string; pulse?: boolean }> = {
  PENDING: { label: "Queued", cls: "bg-ink-700 text-ink-100/80" },
  DOWNLOADING: { label: "Downloading", cls: "bg-blue-500/15 text-blue-700", pulse: true },
  TRANSCRIBING: { label: "Transcribing", cls: "bg-blue-500/15 text-blue-700", pulse: true },
  ANALYZING: { label: "Analyzing", cls: "bg-brand-500/20 text-brand-700", pulse: true },
  GENERATING: { label: "Generating clips", cls: "bg-brand-500/20 text-brand-700", pulse: true },
  READY: { label: "Ready", cls: "bg-emerald-500/15 text-emerald-700" },
  FAILED: { label: "Failed", cls: "bg-red-500/15 text-red-700" },
};

const CLIP_STATUS: Record<ClipStatus, { label: string; cls: string; pulse?: boolean }> = {
  PENDING: { label: "Queued", cls: "bg-ink-700 text-ink-100/80" },
  RENDERING: { label: "Rendering", cls: "bg-blue-500/15 text-blue-700", pulse: true },
  READY: { label: "Ready", cls: "bg-ink-700 text-ink-100/80" },
  APPROVED: { label: "Approved", cls: "bg-emerald-500/15 text-emerald-700" },
  REJECTED: { label: "Rejected", cls: "bg-red-500/10 text-red-600" },
  FAILED: { label: "Failed", cls: "bg-red-500/15 text-red-700" },
};

const PUB_STATUS: Record<PublicationStatus, { label: string; cls: string }> = {
  SCHEDULED: { label: "Scheduled", cls: "bg-amber-500/15 text-amber-700" },
  QUEUED: { label: "Queued", cls: "bg-blue-500/15 text-blue-700" },
  PUBLISHING: { label: "Publishing", cls: "bg-blue-500/15 text-blue-700" },
  PUBLISHED: { label: "Published", cls: "bg-emerald-500/15 text-emerald-700" },
  FAILED: { label: "Failed", cls: "bg-red-500/15 text-red-700" },
  CANCELLED: { label: "Cancelled", cls: "bg-ink-700 text-ink-100/60" },
};

export function VideoStatusBadge({ status }: { status: VideoStatus }) {
  const s = VIDEO_STATUS[status];
  return (
    <span className={clsx("badge", s.cls)}>
      {s.pulse && <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {s.label}
    </span>
  );
}

export function ClipStatusBadge({ status }: { status: ClipStatus }) {
  const s = CLIP_STATUS[status];
  return (
    <span className={clsx("badge", s.cls)}>
      {s.pulse && <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {s.label}
    </span>
  );
}

export function PublicationStatusBadge({ status }: { status: PublicationStatus }) {
  const s = PUB_STATUS[status];
  return <span className={clsx("badge", s.cls)}>{s.label}</span>;
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const cls =
    score >= 80
      ? "bg-emerald-500/20 text-emerald-700"
      : score >= 60
        ? "bg-amber-500/20 text-amber-700"
        : "bg-ink-700 text-ink-100/70";
  return <span className={clsx("badge font-semibold", cls)}>🔥 {score}</span>;
}

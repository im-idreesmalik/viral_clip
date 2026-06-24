"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, formatDuration } from "@/lib/client";
import type { VideoDTO, ClipDTO } from "@/lib/types";
import { VideoStatusBadge } from "@/components/dashboard/badges";
import { ClipCard } from "@/components/dashboard/ClipCard";

const VIDEO_PROCESSING = new Set([
  "PENDING",
  "DOWNLOADING",
  "TRANSCRIBING",
  "ANALYZING",
  "GENERATING",
]);

type Filter = "all" | "approved" | "pending";

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [video, setVideo] = useState<VideoDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [reprocessing, setReprocessing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<VideoDTO>(`/api/videos/${id}`);
      setVideo(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while the video or any clip is still working.
  useEffect(() => {
    if (!video) return;
    const busy =
      VIDEO_PROCESSING.has(video.status) ||
      (video.clips ?? []).some((c) => c.status === "PENDING" || c.status === "RENDERING");
    if (!busy) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [video, load]);

  async function reprocess() {
    if (!confirm("Reprocess this video? Existing clips will be replaced.")) return;
    setReprocessing(true);
    try {
      await api(`/api/videos/${id}/process`, { method: "POST", body: JSON.stringify({}) });
      await load();
    } finally {
      setReprocessing(false);
    }
  }

  if (loading) return <p className="text-ink-100/50">Loading…</p>;
  if (!video) return <p className="text-ink-100/50">Video not found.</p>;

  const clips = video.clips ?? [];
  const filtered = clips.filter((c) =>
    filter === "approved" ? c.status === "APPROVED" : filter === "pending" ? c.status === "READY" : true,
  );
  const approvedCount = clips.filter((c) => c.status === "APPROVED").length;

  return (
    <div>
      <Link href="/dashboard" className="mb-4 inline-block text-sm text-ink-100/60 hover:text-ink-100">
        ← All videos
      </Link>

      <div className="card mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-950">
          {video.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-3xl opacity-40">🎞️</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{video.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-100/60">
            <VideoStatusBadge status={video.status} />
            <span className="badge bg-ink-800 text-ink-100/60">
              {video.clipMode === "VIRAL" ? "Viral-only" : "Full-video"}
            </span>
            {video.durationSec ? <span>{formatDuration(video.durationSec)}</span> : null}
            <span>{clips.length} clips</span>
            <span>{approvedCount} approved</span>
          </div>
          {video.status === "FAILED" && video.errorMessage && (
            <p className="mt-2 text-xs text-red-300/80">{video.errorMessage}</p>
          )}
        </div>
        <button className="btn-secondary shrink-0" onClick={reprocess} disabled={reprocessing}>
          {reprocessing ? "Reprocessing…" : "Reprocess"}
        </button>
      </div>

      {clips.length === 0 ? (
        <div className="card flex flex-col items-center justify-center p-12 text-center">
          {VIDEO_PROCESSING.has(video.status) ? (
            <>
              <span className="mb-3 h-7 w-7 animate-spin rounded-full border-2 border-ink-600 border-t-brand-500" />
              <p className="font-medium">Working on it…</p>
              <p className="mt-1 text-sm text-ink-100/60">
                Downloading, transcribing, and detecting clips. This can take a few minutes.
              </p>
            </>
          ) : (
            <p className="text-ink-100/60">No clips generated.</p>
          )}
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2 text-sm">
            <FilterTab active={filter === "all"} onClick={() => setFilter("all")}>
              All ({clips.length})
            </FilterTab>
            <FilterTab active={filter === "pending"} onClick={() => setFilter("pending")}>
              Review
            </FilterTab>
            <FilterTab active={filter === "approved"} onClick={() => setFilter("approved")}>
              Approved ({approvedCount})
            </FilterTab>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {filtered.map((clip: ClipDTO) => (
              <ClipCard key={clip.id} clip={clip} onChange={load} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${
        active ? "bg-brand-500 text-white" : "bg-ink-800 text-ink-100/70 hover:bg-ink-700"
      }`}
    >
      {children}
    </button>
  );
}

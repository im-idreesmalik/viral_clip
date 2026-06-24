"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, formatDuration } from "@/lib/client";
import type { VideoDTO } from "@/lib/types";
import { NewVideoPanel } from "@/components/dashboard/NewVideoPanel";
import { VideoStatusBadge } from "@/components/dashboard/badges";

const PROCESSING = new Set(["PENDING", "DOWNLOADING", "TRANSCRIBING", "ANALYZING", "GENERATING"]);

export default function VideosPage() {
  const [videos, setVideos] = useState<VideoDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api<VideoDTO[]>("/api/videos");
      setVideos(data);
    } catch {
      /* ignore transient */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while anything is processing.
  useEffect(() => {
    if (!videos.some((v) => PROCESSING.has(v.status))) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [videos, load]);

  async function remove(id: string) {
    if (!confirm("Delete this video and all its clips?")) return;
    await api(`/api/videos/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_380px]">
      <div className="order-2 lg:order-1">
        <h1 className="mb-1 text-2xl font-semibold">Your videos</h1>
        <p className="mb-6 text-sm text-ink-100/60">
          Import a video and ViralCut turns it into ready-to-post vertical clips.
        </p>

        {loading ? (
          <p className="text-ink-100/50">Loading…</p>
        ) : videos.length === 0 ? (
          <div className="card flex flex-col items-center justify-center p-12 text-center">
            <div className="mb-3 text-4xl">🎬</div>
            <p className="font-medium">No videos yet</p>
            <p className="mt-1 text-sm text-ink-100/60">
              Paste a YouTube URL or upload a file to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {videos.map((v) => (
              <VideoRow key={v.id} video={v} onDelete={() => remove(v.id)} />
            ))}
          </div>
        )}
      </div>

      <div className="order-1 lg:order-2">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-100/60">
          New video
        </h2>
        <NewVideoPanel onCreated={load} />
      </div>
    </div>
  );
}

function VideoRow({ video, onDelete }: { video: VideoDTO; onDelete: () => void }) {
  return (
    <div className="card flex items-center gap-4 p-3">
      <Link href={`/dashboard/videos/${video.id}`} className="shrink-0">
        <div className="flex h-16 w-28 items-center justify-center overflow-hidden rounded-lg bg-ink-950">
          {video.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-2xl opacity-40">🎞️</span>
          )}
        </div>
      </Link>

      <div className="min-w-0 flex-1">
        <Link href={`/dashboard/videos/${video.id}`} className="block truncate font-medium hover:underline">
          {video.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-100/60">
          <VideoStatusBadge status={video.status} />
          <span className="badge bg-ink-800 text-ink-100/60">
            {video.clipMode === "VIRAL" ? "Viral-only" : "Full-video"}
          </span>
          {video.durationSec ? <span>{formatDuration(video.durationSec)}</span> : null}
          {video.clipCount != null && <span>{video.clipCount} clips</span>}
          <span>{video.source === "YOUTUBE" ? "YouTube" : "Upload"}</span>
        </div>
        {video.status === "FAILED" && video.errorMessage && (
          <p className="mt-1 truncate text-xs text-red-300/80">{video.errorMessage}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Link href={`/dashboard/videos/${video.id}`} className="btn-secondary text-xs">
          Open
        </Link>
        <button onClick={onDelete} className="btn-ghost text-xs text-red-300/80">
          Delete
        </button>
      </div>
    </div>
  );
}

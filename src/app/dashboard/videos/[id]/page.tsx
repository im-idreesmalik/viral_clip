"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, formatDuration } from "@/lib/client";
import type { VideoDTO, ClipDTO } from "@/lib/types";
import { VideoStatusBadge } from "@/components/dashboard/badges";
import { ClipCard } from "@/components/dashboard/ClipCard";
import { PublishAllDialog } from "@/components/dashboard/PublishAllDialog";
import { useToast } from "@/components/ui/Toast";

const VIDEO_PROCESSING = new Set([
  "PENDING",
  "DOWNLOADING",
  "TRANSCRIBING",
  "ANALYZING",
  "GENERATING",
]);

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [video, setVideo] = useState<VideoDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [reprocessing, setReprocessing] = useState(false);
  const [showPublishAll, setShowPublishAll] = useState(false);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [hashtagsDraft, setHashtagsDraft] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const toast = useToast();

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

  function startEdit() {
    if (!video) return;
    setTitleDraft(video.title);
    setHashtagsDraft(video.hashtags ?? "");
    setEditing(true);
  }

  async function saveMeta() {
    if (!video) return;
    setSavingMeta(true);
    try {
      await api(`/api/videos/${video.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: titleDraft.trim() || video.title,
          hashtags: hashtagsDraft.trim(),
        }),
      });
      toast.success("Video details saved");
      setEditing(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingMeta(false);
    }
  }

  async function reprocess() {
    if (!confirm("Reprocess this video? Existing clips will be replaced.")) return;
    setReprocessing(true);
    try {
      await api(`/api/videos/${id}/process`, { method: "POST", body: JSON.stringify({}) });
      toast.success("Reprocessing started");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reprocess");
    } finally {
      setReprocessing(false);
    }
  }

  if (loading)
    return (
      <div className="space-y-6">
        <div className="skeleton h-4 w-24" />
        <div className="card flex gap-4 p-5">
          <div className="skeleton h-20 w-32 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-5 w-1/2" />
            <div className="skeleton h-3 w-1/3" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton aspect-[9/16]" />
          ))}
        </div>
      </div>
    );
  if (!video) return <p className="text-ink-300">Video not found.</p>;

  const clips = video.clips ?? [];
  const publishableCount = clips.filter((c) => c.status === "READY" || c.status === "APPROVED").length;

  return (
    <div>
      <Link href="/dashboard" className="mb-4 inline-block text-sm text-ink-300 hover:text-ink-100">
        ← All videos
      </Link>

      <div className="card mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        <div className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-950">
          {video.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-3xl opacity-40">🎞️</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="label">Video title</label>
                <input
                  className="input"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  placeholder="Video title"
                />
              </div>
              <div>
                <label className="label">Hashtags (added to every clip caption)</label>
                <input
                  className="input"
                  value={hashtagsDraft}
                  onChange={(e) => setHashtagsDraft(e.target.value)}
                  placeholder="#viral #fyp #shorts"
                />
              </div>
              <div className="flex gap-2">
                <button className="btn-primary text-sm" onClick={saveMeta} disabled={savingMeta}>
                  {savingMeta ? "Saving…" : "Save"}
                </button>
                <button className="btn-secondary text-sm" onClick={() => setEditing(false)} disabled={savingMeta}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2">
                <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">{video.title}</h1>
                <button className="btn-ghost shrink-0 px-2 py-1 text-xs" onClick={startEdit}>
                  ✏️ Edit
                </button>
              </div>
              {video.hashtags && <p className="mt-1 text-sm text-brand-300">{video.hashtags}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-400">
                <VideoStatusBadge status={video.status} />
                <span className="badge bg-ink-800 text-ink-300">
                  {video.clipMode === "VIRAL" ? "Viral-only" : "Full-video"}
                </span>
                {video.durationSec ? <span>{formatDuration(video.durationSec)}</span> : null}
                <span>{clips.length} clips</span>
              </div>
              {video.status === "FAILED" && video.errorMessage && (
                <p className="mt-2 text-xs text-red-300/80">{video.errorMessage}</p>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {publishableCount > 0 && (
            <button className="btn-primary" onClick={() => setShowPublishAll(true)}>
              📡 Publish all
            </button>
          )}
          <button className="btn-secondary" onClick={reprocess} disabled={reprocessing}>
            {reprocessing ? "Reprocessing…" : "Reprocess"}
          </button>
        </div>
      </div>

      {clips.length === 0 ? (
        <div className="card flex flex-col items-center justify-center p-12 text-center">
          {VIDEO_PROCESSING.has(video.status) ? (
            <>
              <span className="mb-3 h-7 w-7 animate-spin rounded-full border-2 border-ink-600 border-t-brand-500" />
              <p className="font-medium">Working on it…</p>
              <p className="mt-1 text-sm text-ink-400">
                Downloading, transcribing, and detecting clips. This can take a few minutes.
              </p>
            </>
          ) : (
            <p className="text-ink-400">No clips generated.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {clips.map((clip: ClipDTO) => (
            <ClipCard key={clip.id} clip={clip} clipMode={video.clipMode} onChange={load} />
          ))}
        </div>
      )}

      {showPublishAll && (
        <PublishAllDialog
          videoId={video.id}
          clipCount={publishableCount}
          onClose={() => setShowPublishAll(false)}
          onScheduled={load}
        />
      )}
    </div>
  );
}

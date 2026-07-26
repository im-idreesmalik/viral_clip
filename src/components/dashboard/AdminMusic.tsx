"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatDuration } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";

interface MusicDTO {
  id: string;
  title: string;
  mood: string | null;
  source: string;
  durationSec: number | null;
  url: string | null;
  claimedBy: string | null;
}

export function AdminMusic() {
  const [tracks, setTracks] = useState<MusicDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setTracks(await api<MusicDTO[]>("/api/admin/music"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load music");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string, title: string) {
    if (!confirm(`Delete "${title}"? It's removed from the library and from anyone using it.`)) return;
    try {
      await api(`/api/admin/music/${id}`, { method: "DELETE" });
      setTracks((prev) => prev.filter((t) => t.id !== id));
      toast.success("Deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-1 flex items-center gap-3">
        <Link href="/dashboard/settings" className="btn-ghost h-8 w-8 px-0" aria-label="Back">
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        </Link>
        <h1 className="text-2xl font-semibold">Background music library</h1>
      </div>
      <p className="mb-6 text-sm text-ink-400">
        Upload cinematic music tracks. Each user can claim one as a unique bed mixed under their clips.
      </p>

      <UploadForm onUploaded={load} />

      <h2 className="mb-3 mt-8 text-lg font-semibold">Tracks ({tracks.length})</h2>
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-16" />
          ))}
        </div>
      ) : tracks.length === 0 ? (
        <p className="text-sm text-ink-400">No tracks yet — upload one above.</p>
      ) : (
        <div className="space-y-2">
          {tracks.map((t) => (
            <div key={t.id} className="card flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.title}</span>
                  {t.mood && <span className="badge badge-neutral">{t.mood}</span>}
                  <span className="text-xs text-ink-400">{t.source}</span>
                  {t.durationSec ? <span className="text-xs text-ink-400">· {formatDuration(t.durationSec)}</span> : null}
                  {t.claimedBy && <span className="badge badge-brand">used by {t.claimedBy}</span>}
                </div>
                {t.url && (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <audio src={t.url} controls preload="none" className="mt-2 h-8 w-full max-w-md" />
                )}
              </div>
              <button
                onClick={() => remove(t.id, t.title)}
                aria-label="Delete"
                title="Delete"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-red-500/10 hover:text-red-600"
              >
                <span className="material-symbols-outlined text-[19px]">delete</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadForm({ onUploaded }: { onUploaded: () => void }) {
  const [title, setTitle] = useState("");
  const [mood, setMood] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function submit() {
    const file = fileRef.current?.files?.[0];
    if (!title.trim()) return toast.error("Add a title.");
    if (!file) return toast.error("Choose an audio file.");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", title.trim());
      form.append("mood", mood.trim());
      await api("/api/admin/music", { method: "POST", body: form });
      toast.success("Track uploaded");
      setTitle("");
      setMood("");
      if (fileRef.current) fileRef.current.value = "";
      onUploaded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3 p-5">
      <h2 className="text-lg font-semibold">Upload a track</h2>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="label">Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Dark Suspense" />
        </div>
        <div>
          <label className="label">Mood (optional)</label>
          <input className="input" value={mood} onChange={(e) => setMood(e.target.value)} placeholder="Cinematic" />
        </div>
      </div>
      <div>
        <label className="label">Audio file (mp3 / wav / m4a)</label>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="input file:mr-3 file:rounded file:border-0 file:bg-ink-700 file:px-3 file:py-1 file:text-ink-100"
        />
      </div>
      <button className="btn-primary w-full" onClick={submit} disabled={busy}>
        {busy ? "Uploading…" : "Upload track"}
      </button>
    </div>
  );
}

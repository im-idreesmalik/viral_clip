"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import type { ClipMode } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";

export function NewVideoPanel({ onCreated }: { onCreated: () => void }) {
  const [tab, setTab] = useState<"url" | "upload">("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [clipMode, setClipMode] = useState<ClipMode>("VIRAL");
  const [viralThreshold, setViralThreshold] = useState(70);
  const [segmentSeconds, setSegmentSeconds] = useState(45);
  const [targetClipCount, setTargetClipCount] = useState(8);
  const [burnCaptions, setBurnCaptions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (tab === "url") {
        if (!url.trim()) throw new Error("Enter a YouTube URL.");
        await api("/api/videos", {
          method: "POST",
          body: JSON.stringify({
            url,
            clipMode,
            viralThreshold,
            segmentSeconds,
            targetClipCount,
            burnCaptions,
          }),
        });
        setUrl("");
      } else {
        if (!file) throw new Error("Choose a video file.");
        await uploadWithProgress(file);
        setFile(null);
      }
      toast.success("Video added — generating clips…");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create video");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  // XHR upload so we can show progress for large files.
  function uploadWithProgress(f: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append("file", f);
      form.append("clipMode", clipMode);
      form.append("viralThreshold", String(viralThreshold));
      form.append("segmentSeconds", String(segmentSeconds));
      form.append("targetClipCount", String(targetClipCount));
      form.append("burnCaptions", String(burnCaptions));

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/videos/upload");
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else {
          try {
            reject(new Error(JSON.parse(xhr.responseText).error || "Upload failed"));
          } catch {
            reject(new Error("Upload failed"));
          }
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(form);
    });
  }

  return (
    <form onSubmit={submit} className="card p-5">
      <div className="mb-4 flex items-center gap-2">
        <TabButton active={tab === "url"} onClick={() => setTab("url")}>
          YouTube URL
        </TabButton>
        <TabButton active={tab === "upload"} onClick={() => setTab("upload")}>
          Upload file
        </TabButton>
      </div>

      {/* Distinct keys: without them React reuses this same <input> DOM node
          across the two branches, flipping the controlled URL input into the
          uncontrolled file input (the "controlled→uncontrolled" warning). */}
      {tab === "url" ? (
        <div key="tab-url">
          <label className="label">YouTube URL</label>
          <input
            className="input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
          />
        </div>
      ) : (
        <div key="tab-upload">
          <label className="label">Video file</label>
          <input
            className="input file:mr-3 file:rounded file:border-0 file:bg-ink-700 file:px-3 file:py-1 file:text-ink-100"
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {progress > 0 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-700">
              <div className="h-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Mode selection */}
      <div className="mt-5">
        <label className="label">Clip selection mode</label>
        <div className="grid grid-cols-2 gap-2">
          <ModeCard
            active={clipMode === "VIRAL"}
            onClick={() => setClipMode("VIRAL")}
            title="Viral-only"
            desc="AI extracts the highest-confidence viral moments."
          />
          <ModeCard
            active={clipMode === "FULL"}
            onClick={() => setClipMode("FULL")}
            title="Full-video"
            desc="Split the whole video into sequential parts."
          />
        </div>
      </div>

      {/* Mode-specific settings */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        {clipMode === "VIRAL" ? (
          <>
            <div>
              <label className="label">Viral threshold ({viralThreshold})</label>
              <input
                type="range"
                min={0}
                max={100}
                value={viralThreshold}
                onChange={(e) => setViralThreshold(Number(e.target.value))}
                className="w-full accent-brand-500"
              />
            </div>
            <div>
              <label className="label">Max clips</label>
              <input
                className="input"
                type="number"
                min={1}
                max={30}
                value={targetClipCount}
                onChange={(e) => setTargetClipCount(Number(e.target.value))}
              />
            </div>
          </>
        ) : (
          <div className="col-span-2">
            <label className="label">Part length (sec)</label>
            <input
              className="input"
              type="number"
              min={15}
              max={60}
              value={segmentSeconds}
              onChange={(e) => setSegmentSeconds(Number(e.target.value))}
            />
            <p className="mt-1 text-xs text-ink-100/50">
              The whole video is split into sequential parts of this length (Part 1, Part 2, …).
            </p>
          </div>
        )}
      </div>

      {/* Captions toggle */}
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={burnCaptions}
          onChange={(e) => setBurnCaptions(e.target.checked)}
          className="h-4 w-4 accent-brand-500"
        />
        Generate &amp; burn in captions (subtitles)
      </label>

      {error && <p className="mt-4 rounded-lg bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</p>}

      <button type="submit" className="btn-primary mt-5 w-full" disabled={busy}>
        {busy ? "Starting…" : "Generate clips"}
      </button>
    </form>
  );
}

function TabButton({
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
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-brand-500 text-white" : "bg-ink-800 text-ink-100/70 hover:bg-ink-700"
      }`}
    >
      {children}
    </button>
  );
}

function ModeCard({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition-colors ${
        active ? "border-brand-500 bg-brand-500/10" : "border-ink-700 hover:border-ink-600"
      }`}
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-0.5 text-xs text-ink-100/60">{desc}</div>
    </button>
  );
}

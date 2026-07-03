"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import type { VideoDTO, ClipMode } from "@/lib/types";
import { LANGUAGES } from "@/lib/languages";
import { useToast } from "@/components/ui/Toast";

/**
 * Reprocess a video with (optionally changed) settings — the same options as
 * the New Video panel, pre-filled from the video. Existing clips are replaced.
 */
export function ReprocessDialog({
  video,
  onClose,
  onDone,
}: {
  video: VideoDTO;
  onClose: () => void;
  onDone: () => void;
}) {
  const [clipMode, setClipMode] = useState<ClipMode>(video.clipMode);
  const [viralThreshold, setViralThreshold] = useState(video.viralThreshold);
  const [segmentSeconds, setSegmentSeconds] = useState(video.segmentSeconds);
  const [targetClipCount, setTargetClipCount] = useState(video.targetClipCount);
  const [burnCaptions, setBurnCaptions] = useState(video.burnCaptions);
  const [footageMode, setFootageMode] = useState<"ORIGINAL" | "GENERIC">(video.footageMode);
  const [language, setLanguage] = useState(video.language || "auto");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/videos/${video.id}/process`, {
        method: "POST",
        body: JSON.stringify({
          clipMode,
          viralThreshold,
          segmentSeconds,
          targetClipCount,
          burnCaptions,
          footageMode: clipMode === "FULL" ? footageMode : "ORIGINAL",
          language,
        }),
      });
      toast.success("Reprocessing started with new settings");
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reprocess");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card max-h-[90vh] w-full max-w-md animate-scale-in overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold">Reprocess video</h3>
        <p className="mt-1 text-sm text-ink-400">
          Adjust the settings and regenerate. Existing clips will be replaced.
        </p>

        {/* Clip mode */}
        <div className="mt-5">
          <label className="label">Clip selection mode</label>
          <div className="grid grid-cols-2 gap-2">
            <ModeCard
              active={clipMode === "VIRAL"}
              onClick={() => {
                setClipMode("VIRAL");
                setFootageMode("ORIGINAL");
              }}
              title="Viral-only"
              desc="AI extracts the top viral moments."
            />
            <ModeCard
              active={clipMode === "FULL"}
              onClick={() => setClipMode("FULL")}
              title="Full-video"
              desc="Split the whole video into parts."
            />
          </div>
        </div>

        {/* Mode-specific */}
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
            </div>
          )}
        </div>

        {/* Captions */}
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={burnCaptions}
            onChange={(e) => setBurnCaptions(e.target.checked)}
            className="h-4 w-4 accent-brand-500"
          />
          Add captions (subtitles)
        </label>

        {/* Language — only relevant when captions are generated. */}
        {burnCaptions && (
          <div className="mt-4">
            <label className="label">Spoken language</label>
            <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Footage (Full-video only) */}
        {clipMode === "FULL" && (
          <div className="mt-4">
            <label className="label">Footage</label>
            <div className="grid grid-cols-2 gap-2">
              <ModeCard
                active={footageMode === "ORIGINAL"}
                onClick={() => setFootageMode("ORIGINAL")}
                title="Original"
                desc="Use the source footage."
              />
              <ModeCard
                active={footageMode === "GENERIC"}
                onClick={() => setFootageMode("GENERIC")}
                title="Generic (stock)"
                desc="Stock visuals; keep original audio."
              />
            </div>
            {footageMode === "GENERIC" && (
              <p className="mt-1 text-xs text-ink-400">
                Add stock videos in the <strong>Generic</strong> tab first.
              </p>
            )}
          </div>
        )}

        {error && <p className="mt-4 rounded-lg bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</p>}

        <div className="mt-6 flex gap-2">
          <button className="btn-primary flex-1" onClick={submit} disabled={busy}>
            {busy ? "Starting…" : "Reprocess"}
          </button>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
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

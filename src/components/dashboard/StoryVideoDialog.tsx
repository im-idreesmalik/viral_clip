"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import type { ClipMode } from "@/lib/types";
import { CAPTION_STYLE_OPTIONS } from "@/lib/caption-styles";
import { languageLabel } from "@/lib/languages";
import { useToast } from "@/components/ui/Toast";

/**
 * Turn an AI Story into a video. Same options as New Video, minus footage
 * (a story is audio-only → always generic/stock visuals) and language (taken
 * from the story). Submitting claims the story for this user.
 */
export function StoryVideoDialog({
  story,
  onClose,
  onDone,
}: {
  story: { id: string; title: string; language: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [clipMode, setClipMode] = useState<ClipMode>("FULL");
  const [viralThreshold, setViralThreshold] = useState(70);
  const [segmentSeconds, setSegmentSeconds] = useState(45);
  const [targetClipCount, setTargetClipCount] = useState(8);
  const [burnCaptions, setBurnCaptions] = useState(true);
  const [captionStyle, setCaptionStyle] = useState("default");
  const [showShortTitle, setShowShortTitle] = useState(false);
  const [shortTitle, setShortTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const video = await api<{ id: string }>(`/api/stories/${story.id}/generate-video`, {
        method: "POST",
        body: JSON.stringify({
          clipMode,
          viralThreshold,
          segmentSeconds,
          targetClipCount,
          burnCaptions,
          captionStyle,
          showShortTitle,
          shortTitle,
        }),
      });
      toast.success("Generating your video from this story…");
      onDone();
      onClose();
      router.push(`/dashboard/videos/${video.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start video generation");
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
        <h3 className="text-lg font-semibold">Generate video</h3>
        <p className="mt-1 text-sm text-ink-400">
          From “{story.title}” · {languageLabel(story.language)} · stock footage visuals. This claims the
          story for you and removes it from the library.
        </p>

        {/* Clip mode */}
        <div className="mt-5">
          <label className="label">Clip selection mode</label>
          <div className="grid grid-cols-2 gap-2">
            <ModeCard
              active={clipMode === "FULL"}
              onClick={() => setClipMode("FULL")}
              title="Full story"
              desc="Split the whole story into sequential parts."
            />
            <ModeCard
              active={clipMode === "VIRAL"}
              onClick={() => setClipMode("VIRAL")}
              title="Best moments"
              desc="AI extracts the most engaging clips."
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          {clipMode === "VIRAL" ? (
            <>
              <div>
                <label className="label">Threshold ({viralThreshold})</label>
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
        {burnCaptions && (
          <div className="mt-4">
            <label className="label">Subtitle style</label>
            <select className="input" value={captionStyle} onChange={(e) => setCaptionStyle(e.target.value)}>
              {CAPTION_STYLE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Short title */}
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showShortTitle}
            onChange={(e) => setShowShortTitle(e.target.checked)}
            className="h-4 w-4 accent-brand-500"
          />
          Add a short title on top of clips
        </label>
        {showShortTitle && (
          <input
            className="input mt-2"
            value={shortTitle}
            onChange={(e) => setShortTitle(e.target.value)}
            placeholder="e.g. STORY TIME"
            maxLength={80}
          />
        )}

        {error && <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-6 flex gap-2">
          <button className="btn-primary flex-1" onClick={submit} disabled={busy}>
            {busy ? "Starting…" : "Generate video"}
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

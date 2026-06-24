"use client";

import { useState } from "react";
import { api, formatDuration } from "@/lib/client";
import type { ClipDTO } from "@/lib/types";
import { ClipStatusBadge, ScoreBadge } from "@/components/dashboard/badges";
import { PublishDialog } from "@/components/dashboard/PublishDialog";

export function ClipCard({ clip, onChange }: { clip: ClipDTO; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(clip.title);
  const [start, setStart] = useState(clip.startSec);
  const [end, setEnd] = useState(clip.endSec);
  const [showPublish, setShowPublish] = useState(false);

  const isProcessing = clip.status === "PENDING" || clip.status === "RENDERING";

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
      onChange();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  const patch = (body: Record<string, unknown>) =>
    api(`/api/clips/${clip.id}`, { method: "PATCH", body: JSON.stringify(body) });

  return (
    <div className="card overflow-hidden">
      {/* Preview (9:16) */}
      <div className="relative aspect-[9/16] bg-ink-950">
        {clip.videoUrl && clip.status !== "RENDERING" ? (
          <video
            src={clip.videoUrl}
            poster={clip.thumbnailUrl ?? undefined}
            controls
            preload="none"
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-100/40">
            {isProcessing ? (
              <div className="flex flex-col items-center gap-2">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-ink-600 border-t-brand-500" />
                <span className="text-xs">Rendering…</span>
              </div>
            ) : (
              <span className="text-3xl">🎞️</span>
            )}
          </div>
        )}
        <div className="absolute left-2 top-2 flex gap-1.5">
          <ScoreBadge score={clip.viralScore} />
        </div>
        <div className="absolute right-2 top-2">
          <span className="badge bg-black/60 text-white">{formatDuration(clip.durationSec)}</span>
        </div>
      </div>

      <div className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-2">
          {editing ? (
            <input className="input text-sm" value={title} onChange={(e) => setTitle(e.target.value)} />
          ) : (
            <p className="line-clamp-2 text-sm font-medium">{clip.title}</p>
          )}
          <ClipStatusBadge status={clip.status} />
        </div>

        {clip.reason && !editing && (
          <p className="line-clamp-2 text-xs text-ink-100/55">{clip.reason}</p>
        )}

        {editing && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Start (s)</label>
              <input
                className="input text-sm"
                type="number"
                step="0.1"
                value={start}
                onChange={(e) => setStart(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">End (s)</label>
              <input
                className="input text-sm"
                type="number"
                step="0.1"
                value={end}
                onChange={(e) => setEnd(Number(e.target.value))}
              />
            </div>
          </div>
        )}

        {clip.status === "FAILED" && clip.errorMessage && (
          <p className="line-clamp-2 text-xs text-red-300/80">{clip.errorMessage}</p>
        )}

        {/* Actions */}
        {editing ? (
          <div className="flex gap-2">
            <button
              className="btn-primary flex-1 text-xs"
              disabled={!!busy}
              onClick={() =>
                act("save", async () => {
                  await patch({ title, startSec: start, endSec: end });
                  setEditing(false);
                })
              }
            >
              Save & re-render
            </button>
            <button className="btn-secondary text-xs" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <button
                className={`flex-1 text-xs ${clip.status === "APPROVED" ? "btn-primary" : "btn-secondary"}`}
                disabled={!!busy || isProcessing}
                onClick={() => act("approve", () => patch({ status: "APPROVED" }))}
              >
                {clip.status === "APPROVED" ? "✓ Approved" : "Approve"}
              </button>
              <button
                className="btn-secondary text-xs"
                disabled={!!busy || isProcessing}
                onClick={() => act("reject", () => patch({ status: "REJECTED" }))}
              >
                Reject
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 text-xs">
              <button
                className="btn-ghost px-2 py-1 text-xs"
                disabled={!!busy || isProcessing}
                onClick={() => setEditing(true)}
              >
                ✏️ Edit
              </button>
              <button
                className="btn-ghost px-2 py-1 text-xs"
                disabled={!!busy || isProcessing}
                onClick={() =>
                  act("regen", () =>
                    api(`/api/clips/${clip.id}/regenerate`, {
                      method: "POST",
                      body: JSON.stringify({ variation: false }),
                    }),
                  )
                }
              >
                🔁 Regenerate
              </button>
              <button
                className="btn-ghost px-2 py-1 text-xs"
                disabled={!!busy || isProcessing}
                onClick={() =>
                  act("variation", () =>
                    api(`/api/clips/${clip.id}/regenerate`, {
                      method: "POST",
                      body: JSON.stringify({ variation: true }),
                    }),
                  )
                }
              >
                ✨ Variation
              </button>
              {clip.captionsUrl && (
                <a className="btn-ghost px-2 py-1 text-xs" href={clip.captionsUrl} download>
                  💬 Captions
                </a>
              )}
              <button
                className="btn-ghost px-2 py-1 text-xs text-red-300/80"
                disabled={!!busy}
                onClick={() => {
                  if (confirm("Delete this clip?"))
                    act("delete", () => api(`/api/clips/${clip.id}`, { method: "DELETE" }));
                }}
              >
                🗑
              </button>
            </div>

            <button
              className="btn-primary w-full text-xs"
              disabled={!!busy || isProcessing || !clip.videoUrl}
              onClick={() => setShowPublish(true)}
            >
              📡 Publish
            </button>
          </>
        )}
      </div>

      {showPublish && (
        <PublishDialog clip={clip} onClose={() => setShowPublish(false)} onPublished={onChange} />
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { api, PLATFORM_META } from "@/lib/client";
import type { SocialAccountDTO, PlatformName } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";

const INTERVALS = [5, 10, 15, 20, 30, 60]; // minutes between consecutive clips

export function PublishAllDialog({
  videoId,
  clipCount,
  onClose,
  onScheduled,
}: {
  videoId: string;
  clipCount: number;
  onClose: () => void;
  onScheduled: () => void;
}) {
  const [available, setAvailable] = useState<PlatformName[]>([]);
  const [selected, setSelected] = useState<PlatformName[]>([]);
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    api<{ accounts: SocialAccountDTO[] }>("/api/social/accounts")
      .then((d) => {
        const platforms = Array.from(
          new Set(d.accounts.filter((a) => a.isActive).map((a) => a.platform)),
        );
        setAvailable(platforms);
        setSelected(platforms); // default: all connected platforms
      })
      .catch(() => undefined);
  }, []);

  function toggle(p: PlatformName) {
    setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));
  }

  async function submit() {
    if (selected.length === 0) {
      setError("Select at least one platform.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ scheduled: number }>(`/api/videos/${videoId}/publish-all`, {
        method: "POST",
        body: JSON.stringify({ platforms: selected, intervalMinutes }),
      });
      toast.success(
        `Scheduled ${res.scheduled} post${res.scheduled === 1 ? "" : "s"} across ${selected.length} platform${selected.length === 1 ? "" : "s"}`,
      );
      onScheduled();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to schedule");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="card w-full max-w-md animate-scale-in p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">Publish all clips</h3>
        <p className="mt-1 text-sm text-ink-400">
          {clipCount} ready clip{clipCount === 1 ? "" : "s"} will be queued to the selected platforms.
        </p>

        {available.length === 0 ? (
          <p className="mt-5 rounded-lg bg-ink-800 px-3 py-3 text-sm text-ink-200">
            No connected accounts. Link a platform under <strong>Connections</strong> first.
          </p>
        ) : (
          <div className="mt-5 space-y-5">
            <div>
              <label className="label">Platforms</label>
              <div className="flex flex-wrap gap-2">
                {available.map((p) => {
                  const active = selected.includes(p);
                  const meta = PLATFORM_META[p];
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => toggle(p)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-all ${
                        active
                          ? "border-brand-500 bg-brand-500/10 text-ink-100"
                          : "border-ink-700 text-ink-300 hover:border-ink-600"
                      }`}
                    >
                      <span>{meta?.icon}</span>
                      {meta?.label}
                      {active && <span className="text-brand-400">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="label">Minutes between clips</label>
              <div className="flex flex-wrap items-center gap-2">
                {INTERVALS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setIntervalMinutes(m)}
                    className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      intervalMinutes === m
                        ? "bg-brand-gradient text-white"
                        : "bg-ink-800 text-ink-300 hover:bg-ink-700"
                    }`}
                  >
                    {m} min
                  </button>
                ))}
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={10080}
                    value={intervalMinutes}
                    onChange={(e) => setIntervalMinutes(Math.max(1, Number(e.target.value) || 1))}
                    className="input w-20"
                    aria-label="Custom minutes between clips"
                  />
                  <span className="text-xs text-ink-400">min</span>
                </div>
              </div>
              <p className="mt-2 text-xs text-ink-400">
                Posts in order — the first clip goes out now, and each next clip publishes{" "}
                {intervalMinutes} min after the previous one succeeds. A failed clip pauses the
                queue until you retry it.
              </p>
            </div>

            {error && <p className="rounded-lg bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</p>}

            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button className="btn-primary" onClick={submit} disabled={busy}>
                {busy ? "Scheduling…" : "Publish all"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

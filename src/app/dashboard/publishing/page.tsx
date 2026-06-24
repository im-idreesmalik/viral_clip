"use client";

import { useCallback, useEffect, useState } from "react";
import { api, PLATFORM_META } from "@/lib/client";
import type { PublicationDTO } from "@/lib/types";
import { PublicationStatusBadge } from "@/components/dashboard/badges";

const ACTIVE = new Set(["SCHEDULED", "QUEUED", "PUBLISHING"]);

export default function PublishingPage() {
  const [pubs, setPubs] = useState<PublicationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<PublicationDTO[]>("/api/publications");
      setPubs(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const retry = useCallback(
    async (id: string) => {
      setRetrying(id);
      try {
        await api(`/api/publications/${id}/retry`, { method: "POST" });
        await load();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Retry failed");
      } finally {
        setRetrying(null);
      }
    },
    [load],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!pubs.some((p) => ACTIVE.has(p.status))) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [pubs, load]);

  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-2xl font-semibold">Publishing</h1>
      <p className="mb-6 text-sm text-ink-100/60">
        Every manual and auto-scheduled publish, with status and any errors.
      </p>

      {loading ? (
        <p className="text-ink-100/50">Loading…</p>
      ) : pubs.length === 0 ? (
        <div className="card flex flex-col items-center justify-center p-12 text-center">
          <div className="mb-3 text-4xl">📡</div>
          <p className="font-medium">Nothing published yet</p>
          <p className="mt-1 text-sm text-ink-100/60">
            Approve clips and publish them, or enable automation.
          </p>
        </div>
      ) : (
        <div className="card divide-y divide-ink-800">
          {pubs.map((p) => {
            const meta = PLATFORM_META[p.platform];
            return (
              <div key={p.id} className="flex items-center gap-4 p-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-950">
                  {p.clip?.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.clip.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-lg opacity-40">🎞️</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{meta?.icon}</span>
                    <span className="truncate text-sm font-medium">
                      {p.clip?.title ?? p.caption ?? "Clip"}
                    </span>
                    {p.autoScheduled && (
                      <span className="badge bg-ink-800 text-ink-100/50">auto</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-100/55">
                    <span>{meta?.label}</span>
                    {p.publishAt && p.status === "SCHEDULED" && (
                      <span>· scheduled {new Date(p.publishAt).toLocaleString()}</span>
                    )}
                    {p.publishedAt && <span>· {new Date(p.publishedAt).toLocaleString()}</span>}
                    {p.attempts > 1 && <span>· {p.attempts} attempts</span>}
                  </div>
                  {p.lastError && p.status === "FAILED" && (
                    <p className="mt-1 line-clamp-1 text-xs text-red-300/80">{p.lastError}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <PublicationStatusBadge status={p.status} />
                  {p.status === "FAILED" && (
                    <button
                      onClick={() => retry(p.id)}
                      disabled={retrying === p.id}
                      className="rounded-md border border-ink-700 px-2.5 py-1 text-xs font-medium text-ink-100 hover:bg-ink-800 disabled:opacity-50"
                    >
                      {retrying === p.id ? "Retrying…" : "Retry"}
                    </button>
                  )}
                  {p.externalUrl && (
                    <a
                      href={p.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-brand-400 hover:underline"
                    >
                      View ↗
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

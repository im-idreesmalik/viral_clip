"use client";

import { useCallback, useEffect, useState } from "react";
import { api, PLATFORM_META } from "@/lib/client";
import type { PlatformName, PublicationStatus, VideoStatus } from "@/lib/types";
import { VideoStatusBadge, PublicationStatusBadge } from "@/components/dashboard/badges";
import { useToast } from "@/components/ui/Toast";

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  handle: string | null;
  createdAt: string;
  videos: number;
  publications: number;
  accounts: number;
  lastActiveAt: string | null;
}
interface AdminVideo {
  id: string;
  title: string;
  status: VideoStatus;
  clipMode: "VIRAL" | "FULL";
  clips: number;
  owner: string;
  createdAt: string;
}
interface AdminPublication {
  id: string;
  platform: PlatformName;
  status: PublicationStatus;
  clipTitle: string | null;
  owner: string;
  createdAt: string;
  publishedAt: string | null;
}
interface Overview {
  totals: { users: number; videos: number; clips: number; publications: number; published: number };
  users: AdminUser[];
  recentVideos: AdminVideo[];
  recentPublications: AdminPublication[];
}

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setData(await api<Overview>("/api/admin/overview"));
    } catch (err) {
      if (err instanceof Error && /admin access/i.test(err.message)) setDenied(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function deleteVideo(id: string, title: string) {
    if (!confirm(`Delete "${title}" and all its clips? This permanently removes the owner's video.`))
      return;
    setBusy(id);
    try {
      await api(`/api/admin/videos/${id}`, { method: "DELETE" });
      toast.success("Video deleted");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  if (denied) {
    return (
      <div className="card flex flex-col items-center justify-center p-12 text-center">
        <span className="material-symbols-outlined mb-2 text-4xl text-ink-400">lock</span>
        <p className="font-medium">Admin access required</p>
        <p className="mt-1 text-sm text-ink-400">Your account isn&apos;t a superuser.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-ink-400">Every user and their activity across ViralCut.</p>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {loading || !data
          ? [0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-20" />)
          : (
              [
                { label: "Users", value: data.totals.users, icon: "group" },
                { label: "Videos", value: data.totals.videos, icon: "video_library" },
                { label: "Clips", value: data.totals.clips, icon: "movie" },
                { label: "Publications", value: data.totals.publications, icon: "send" },
                { label: "Published", value: data.totals.published, icon: "check_circle" },
              ] as const
            ).map((s) => (
              <div key={s.label} className="card p-4">
                <div className="flex items-center gap-2 text-ink-400">
                  <span className="material-symbols-outlined text-[18px]">{s.icon}</span>
                  <span className="font-geist text-xs uppercase tracking-wide">{s.label}</span>
                </div>
                <div className="mt-1.5 text-2xl font-semibold tabular-nums">{s.value}</div>
              </div>
            ))}
      </div>

      {/* Users */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">Users</h2>
        <div className="card overflow-x-auto">
          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => <div key={i} className="skeleton h-10" />)}
            </div>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-ink-800 text-left font-geist text-xs uppercase tracking-wide text-ink-400">
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Videos</th>
                  <th className="px-4 py-3 font-medium">Publications</th>
                  <th className="px-4 py-3 font-medium">Accounts</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium">Last active</th>
                </tr>
              </thead>
              <tbody>
                {data?.users.map((u) => (
                  <tr key={u.id} className="border-b border-ink-800/60 last:border-0 hover:bg-ink-900/60">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink-100">{u.name || "—"}</div>
                      <div className="text-xs text-ink-400">{u.email}</div>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{u.videos}</td>
                    <td className="px-4 py-3 tabular-nums">{u.publications}</td>
                    <td className="px-4 py-3 tabular-nums">{u.accounts}</td>
                    <td className="px-4 py-3 text-ink-400">{when(u.createdAt)}</td>
                    <td className="px-4 py-3 text-ink-400">{when(u.lastActiveAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Recent activity */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">Recent videos</h2>
          <div className="card divide-y divide-ink-800/60">
            {loading ? (
              <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-8" />)}</div>
            ) : data?.recentVideos.length ? (
              data.recentVideos.map((v) => (
                <div key={v.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <VideoStatusBadge status={v.status} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{v.title}</div>
                    <div className="truncate text-xs text-ink-400">
                      {v.owner} · {v.clips} clips · {when(v.createdAt)}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteVideo(v.id, v.title)}
                    disabled={busy === v.id}
                    aria-label={`Delete ${v.title}`}
                    className="shrink-0 text-ink-400 transition-colors hover:text-red-600 disabled:opacity-40"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              ))
            ) : (
              <p className="p-4 text-sm text-ink-400">No videos yet.</p>
            )}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-400">
            Recent publications
          </h2>
          <div className="card divide-y divide-ink-800/60">
            {loading ? (
              <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-8" />)}</div>
            ) : data?.recentPublications.length ? (
              data.recentPublications.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span title={PLATFORM_META[p.platform]?.label}>{PLATFORM_META[p.platform]?.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.clipTitle || "—"}</div>
                    <div className="truncate text-xs text-ink-400">
                      {p.owner} · {when(p.createdAt)}
                    </div>
                  </div>
                  <PublicationStatusBadge status={p.status} />
                </div>
              ))
            ) : (
              <p className="p-4 text-sm text-ink-400">No publications yet.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

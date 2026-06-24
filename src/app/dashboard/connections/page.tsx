"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, PLATFORM_META } from "@/lib/client";
import type { SocialAccountDTO, PlatformCatalogItem } from "@/lib/types";

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<p className="text-ink-100/50">Loading…</p>}>
      <ConnectionsContent />
    </Suspense>
  );
}

function ConnectionsContent() {
  const params = useSearchParams();
  const [accounts, setAccounts] = useState<SocialAccountDTO[]>([]);
  const [catalog, setCatalog] = useState<PlatformCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await api<{ accounts: SocialAccountDTO[]; platforms: PlatformCatalogItem[] }>(
      "/api/social/accounts",
    );
    setAccounts(data.accounts);
    setCatalog(data.platforms);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function disconnect(id: string) {
    if (!confirm("Disconnect this account?")) return;
    await api(`/api/social/accounts/${id}`, { method: "DELETE" });
    load();
  }

  const connectedError = params.get("error");
  const connected = params.get("connected");

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold">Connections</h1>
      <p className="mb-6 text-sm text-ink-100/60">
        Connect your social accounts to publish clips directly from ViralCut.
      </p>

      {connected && (
        <div className="mb-4 rounded-lg bg-emerald-950/50 px-4 py-2 text-sm text-emerald-300">
          Connected {PLATFORM_META[connected.toUpperCase()]?.label ?? connected} successfully.
        </div>
      )}
      {connectedError && (
        <div className="mb-4 rounded-lg bg-red-950/50 px-4 py-2 text-sm text-red-300">
          {connectedError}
        </div>
      )}

      {loading ? (
        <p className="text-ink-100/50">Loading…</p>
      ) : (
        <div className="space-y-3">
          {catalog.map((p) => {
            const accountsForPlatform = accounts.filter((a) => a.platform === p.platform);
            const meta = PLATFORM_META[p.platform];
            return (
              <div key={p.platform} className="card p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-lg text-xl"
                      style={{ background: `${meta?.color}22` }}
                    >
                      {meta?.icon}
                    </span>
                    <div>
                      <div className="font-medium">{p.label}</div>
                      <div className="text-xs text-ink-100/50">
                        {p.configured ? "Ready to connect" : "Not configured on server"}
                      </div>
                    </div>
                  </div>
                  {p.configured ? (
                    <a className="btn-secondary text-sm" href={`/api/social/connect/${p.slug}`}>
                      + Connect
                    </a>
                  ) : (
                    <span className="text-xs text-ink-100/40">Set credentials in .env</span>
                  )}
                </div>

                {accountsForPlatform.length > 0 && (
                  <div className="mt-3 space-y-2 border-t border-ink-800 pt-3">
                    {accountsForPlatform.map((a) => (
                      <div key={a.id} className="flex items-center justify-between text-sm">
                        <span className="truncate">
                          {a.displayName || a.username || a.externalId}
                          {a.username && a.displayName ? ` (@${a.username})` : ""}
                        </span>
                        <button
                          className="btn-ghost text-xs text-red-300/80"
                          onClick={() => disconnect(a.id)}
                        >
                          Disconnect
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-xs text-ink-100/40">
        Each platform requires a registered developer app. See the README for setup. Publishing to
        Instagram/Facebook Reels also requires your media to be reachable at a public URL
        (set <code>MEDIA_PUBLIC_BASE</code>).
      </p>
    </div>
  );
}

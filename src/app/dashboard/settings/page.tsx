"use client";

import { useEffect, useState } from "react";
import { api, PLATFORM_META } from "@/lib/client";
import type { AutoConfigDTO, SocialAccountDTO, PlatformName } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";

const INTERVAL_PRESETS = [
  { label: "Every 2 hours", value: 120 },
  { label: "Every 6 hours", value: 360 },
  { label: "Every 12 hours", value: 720 },
  { label: "Daily", value: 1440 },
];

export default function SettingsPage() {
  const [config, setConfig] = useState<AutoConfigDTO | null>(null);
  const [accounts, setAccounts] = useState<SocialAccountDTO[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [savingHandle, setSavingHandle] = useState(false);
  const [handleSaved, setHandleSaved] = useState(false);
  const toast = useToast();

  useEffect(() => {
    Promise.all([
      api<AutoConfigDTO>("/api/schedule"),
      api<{ accounts: SocialAccountDTO[] }>("/api/social/accounts"),
    ]).then(([cfg, acc]) => {
      setConfig(cfg);
      setAccounts(acc.accounts.filter((a) => a.isActive));
    });
    api<{ user: { handle: string | null } }>("/api/auth/me")
      .then((res) => setHandle(res.user.handle ?? ""))
      .catch(() => undefined);
  }, []);

  async function saveHandle() {
    setSavingHandle(true);
    setHandleSaved(false);
    try {
      const res = await api<{ user: { handle: string | null } }>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ handle: handle.replace(/^@+/, "").trim() }),
      });
      setHandle(res.user.handle ?? "");
      setHandleSaved(true);
      toast.success("Username saved");
      setTimeout(() => setHandleSaved(false), 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save username");
    } finally {
      setSavingHandle(false);
    }
  }

  if (!config)
    return (
      <div className="max-w-2xl space-y-4">
        <div className="skeleton h-7 w-40" />
        <div className="skeleton h-64 w-full" />
      </div>
    );

  const connectedPlatforms = Array.from(new Set(accounts.map((a) => a.platform)));

  function togglePlatform(p: PlatformName) {
    setConfig((c) => {
      if (!c) return c;
      const has = c.platforms.includes(p);
      return { ...c, platforms: has ? c.platforms.filter((x) => x !== p) : [...c.platforms, p] };
    });
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api<AutoConfigDTO>("/api/schedule", {
        method: "PUT",
        body: JSON.stringify({
          enabled: config.enabled,
          intervalMinutes: config.intervalMinutes,
          platforms: config.platforms,
          windowStartHour: config.windowStartHour,
          windowEndHour: config.windowEndHour,
        }),
      });
      setConfig(updated);
      setSaved(true);
      toast.success("Automation settings saved");
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="mb-1 text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-ink-100/60">Your creator profile and auto-publishing preferences.</p>
      </div>

      {/* Username / watermark */}
      <div className="card space-y-4 p-6">
        <div>
          <label className="label" htmlFor="handle">
            Username
          </label>
          <p className="mb-3 text-xs text-ink-100/55">
            Added as a watermark on every clip you create. Leave blank for none.
          </p>
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center rounded-lg border border-ink-700 bg-ink-900 focus-within:border-brand-500">
              <span className="pl-3 text-ink-100/50">@</span>
              <input
                id="handle"
                type="text"
                maxLength={64}
                placeholder="yourname"
                className="w-full bg-transparent px-2 py-2 text-sm outline-none"
                value={handle.replace(/^@+/, "")}
                onChange={(e) => setHandle(e.target.value)}
              />
            </div>
            <button className="btn-primary" onClick={saveHandle} disabled={savingHandle}>
              {savingHandle ? "Saving…" : "Save"}
            </button>
            {handleSaved && <span className="text-sm text-emerald-700">✓</span>}
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-1 text-lg font-semibold">Auto-publishing</h2>
        <p className="mb-4 text-sm text-ink-100/60">
          Automatically publish your clips on a schedule.
        </p>

        <div className="card space-y-6 p-6">
        <label className="flex items-center justify-between">
          <div>
            <div className="font-medium">Enable auto-publishing</div>
            <div className="text-xs text-ink-100/55">
              When on, your clips are posted automatically.
            </div>
          </div>
          <input
            type="checkbox"
            className="h-5 w-9 accent-brand-500"
            checked={config.enabled}
            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
          />
        </label>

        <div>
          <label className="label">Posting interval</label>
          <div className="flex flex-wrap gap-2">
            {INTERVAL_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => setConfig({ ...config, intervalMinutes: p.value })}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  config.intervalMinutes === p.value
                    ? "bg-brand-500 text-white"
                    : "bg-ink-800 text-ink-100/70 hover:bg-ink-700"
                }`}
              >
                {p.label}
              </button>
            ))}
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={15}
                max={1440}
                className="input w-24"
                value={config.intervalMinutes}
                onChange={(e) =>
                  setConfig({ ...config, intervalMinutes: Number(e.target.value) || 120 })
                }
              />
              <span className="text-xs text-ink-100/50">min</span>
            </div>
          </div>
        </div>

        <div>
          <label className="label">Platforms</label>
          {connectedPlatforms.length === 0 ? (
            <p className="text-sm text-ink-100/55">
              No connected accounts. Connect platforms first under <strong>Connections</strong>.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {connectedPlatforms.map((p) => {
                const active = config.platforms.includes(p);
                const meta = PLATFORM_META[p];
                return (
                  <button
                    key={p}
                    onClick={() => togglePlatform(p)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      active ? "border-brand-500 bg-brand-500/10" : "border-ink-700 hover:border-ink-600"
                    }`}
                  >
                    <span>{meta?.icon}</span>
                    {meta?.label}
                    {active && <span className="text-brand-600">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label className="label">Posting window (optional, local time)</label>
          <div className="flex items-center gap-2 text-sm">
            <input
              type="number"
              min={0}
              max={23}
              placeholder="—"
              className="input w-20"
              value={config.windowStartHour ?? ""}
              onChange={(e) =>
                setConfig({
                  ...config,
                  windowStartHour: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
            <span className="text-ink-100/50">to</span>
            <input
              type="number"
              min={0}
              max={23}
              placeholder="—"
              className="input w-20"
              value={config.windowEndHour ?? ""}
              onChange={(e) =>
                setConfig({
                  ...config,
                  windowEndHour: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
            <span className="text-xs text-ink-100/50">(leave blank for anytime)</span>
          </div>
        </div>

        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-sm text-emerald-700">Saved ✓</span>}
          {config.nextRunAt && config.enabled && (
            <span className="text-xs text-ink-100/50">
              Next run: {new Date(config.nextRunAt).toLocaleString()}
            </span>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

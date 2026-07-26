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

interface MusicTrack {
  id: string;
  title: string;
  mood: string | null;
  durationSec: number | null;
  url: string | null;
  mine: boolean;
}
interface MusicState {
  tracks: MusicTrack[];
  selectedId: string | null;
  enabled: boolean;
}

export default function SettingsPage() {
  const [config, setConfig] = useState<AutoConfigDTO | null>(null);
  const [accounts, setAccounts] = useState<SocialAccountDTO[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [savingHandle, setSavingHandle] = useState(false);
  const [handleSaved, setHandleSaved] = useState(false);
  // Account profile.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  // Background music.
  const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
  const [musicSelectedId, setMusicSelectedId] = useState<string | null>(null);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [savingMusic, setSavingMusic] = useState(false);
  const toast = useToast();

  useEffect(() => {
    Promise.all([
      api<AutoConfigDTO>("/api/schedule"),
      api<{ accounts: SocialAccountDTO[] }>("/api/social/accounts"),
    ]).then(([cfg, acc]) => {
      setConfig(cfg);
      setAccounts(acc.accounts.filter((a) => a.isActive));
    });
    api<{ user: { handle: string | null; name: string | null; email: string } }>("/api/auth/me")
      .then((res) => {
        setHandle(res.user.handle ?? "");
        setName(res.user.name ?? "");
        setEmail(res.user.email ?? "");
      })
      .catch(() => undefined);
    loadMusic();
  }, []);

  function applyMusicState(res: MusicState) {
    setMusicTracks(res.tracks);
    setMusicSelectedId(res.selectedId);
    setMusicEnabled(res.enabled);
  }

  function loadMusic() {
    api<MusicState>("/api/music").then(applyMusicState).catch(() => undefined);
  }

  async function saveMusic(patch: { musicId?: string | null; enabled?: boolean }) {
    setSavingMusic(true);
    try {
      applyMusicState(await api<MusicState>("/api/music", { method: "PATCH", body: JSON.stringify(patch) }));
      toast.success("Background music updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update music");
    } finally {
      setSavingMusic(false);
    }
  }

  async function saveProfile() {
    if (newPassword && newPassword !== confirmPassword) {
      toast.error("New passwords don't match.");
      return;
    }
    setSavingProfile(true);
    try {
      const payload: Record<string, string> = {};
      if (name.trim()) payload.name = name.trim();
      if (email.trim()) payload.email = email.trim();
      if (currentPassword) payload.currentPassword = currentPassword;
      if (newPassword) payload.newPassword = newPassword;
      const res = await api<{ user: { name: string | null; email: string } }>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setName(res.user.name ?? "");
      setEmail(res.user.email ?? "");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  }

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

      {/* Account profile */}
      <div className="card space-y-4 p-6">
        <div>
          <h2 className="text-lg font-semibold">Profile</h2>
          <p className="text-xs text-ink-100/55">Your account username, email, and password.</p>
        </div>
        <div>
          <label className="label" htmlFor="name">
            Username
          </label>
          <input
            id="name"
            type="text"
            className="input"
            maxLength={120}
            placeholder="Your name"
            autoComplete="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="input"
            placeholder="you@example.com"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="border-t border-ink-800 pt-4">
          <label className="label" htmlFor="curpw">
            Current password
          </label>
          <p className="mb-1.5 text-xs text-ink-100/55">Required only to change your email or password.</p>
          <input
            id="curpw"
            type="password"
            className="input"
            placeholder="••••••••"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="newpw">
              New password
            </label>
            <input
              id="newpw"
              type="password"
              className="input"
              placeholder="Leave blank to keep"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="confpw">
              Confirm new password
            </label>
            <input
              id="confpw"
              type="password"
              className="input"
              placeholder="Repeat new password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        </div>
        <div>
          <button className="btn-primary" onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? "Saving…" : "Save profile"}
          </button>
        </div>
      </div>

      {/* Clip watermark */}
      <div className="card space-y-4 p-6">
        <div>
          <label className="label" htmlFor="handle">
            Clip watermark
          </label>
          <p className="mb-3 text-xs text-ink-100/55">
            An @username added as a watermark on every clip you create. Leave blank for none.
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

      {/* Background music */}
      <div className="card space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Background music</h2>
            <p className="text-xs text-ink-100/55">
              A unique music bed mixed softly under every clip you create. Pick one — it becomes yours and
              disappears from everyone else&apos;s list.
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-9 accent-brand-500"
              checked={musicEnabled}
              disabled={savingMusic}
              onChange={(e) => saveMusic({ enabled: e.target.checked })}
            />
            On
          </label>
        </div>

        <div className={`grid gap-2 sm:grid-cols-2 ${musicEnabled ? "" : "pointer-events-none opacity-50"}`}>
          <button
            type="button"
            onClick={() => saveMusic({ musicId: null })}
            disabled={savingMusic}
            className={`rounded-lg border p-3 text-left transition-colors ${
              musicSelectedId === null ? "border-brand-500 bg-brand-500/10" : "border-ink-700 hover:border-ink-600"
            }`}
          >
            <div className="text-sm font-medium">No music</div>
            <div className="text-xs text-ink-100/55">Keep the original audio only.</div>
          </button>
          {musicTracks.map((t) => (
            <div
              key={t.id}
              className={`rounded-lg border p-3 transition-colors ${
                musicSelectedId === t.id ? "border-brand-500 bg-brand-500/10" : "border-ink-700"
              }`}
            >
              <button
                type="button"
                onClick={() => saveMusic({ musicId: t.id })}
                disabled={savingMusic}
                className="flex w-full items-center justify-between text-left"
              >
                <div>
                  <div className="text-sm font-medium">{t.title}</div>
                  <div className="text-xs text-ink-100/55">
                    {t.mood}
                    {musicSelectedId === t.id ? " · selected" : ""}
                  </div>
                </div>
                {musicSelectedId === t.id && (
                  <span className="material-symbols-outlined text-[18px] text-brand-600">check_circle</span>
                )}
              </button>
              {t.url && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <audio src={t.url} controls preload="none" className="mt-2 h-8 w-full" />
              )}
            </div>
          ))}
        </div>
        {musicTracks.length === 0 && (
          <p className="text-sm text-ink-100/55">No tracks available right now.</p>
        )}
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

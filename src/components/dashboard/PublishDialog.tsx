"use client";

import { useEffect, useState } from "react";
import { api, PLATFORM_META } from "@/lib/client";
import type { ClipDTO, SocialAccountDTO, PlatformName } from "@/lib/types";

export function PublishDialog({
  clip,
  onClose,
  onPublished,
}: {
  clip: ClipDTO;
  onClose: () => void;
  onPublished: () => void;
}) {
  const [accounts, setAccounts] = useState<SocialAccountDTO[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [caption, setCaption] = useState(clip.title);
  const [schedule, setSchedule] = useState(false);
  const [publishAt, setPublishAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api<{ accounts: SocialAccountDTO[] }>("/api/social/accounts")
      .then((d) => {
        const active = d.accounts.filter((a) => a.isActive);
        setAccounts(active);
        if (active[0]) setAccountId(active[0].id);
      })
      .catch(() => undefined);
  }, []);

  const selected = accounts.find((a) => a.id === accountId);

  async function publish() {
    setError(null);
    if (!selected) {
      setError("Connect a social account first (Connections tab).");
      return;
    }
    setBusy(true);
    try {
      await api(`/api/clips/${clip.id}/publish`, {
        method: "POST",
        body: JSON.stringify({
          platform: selected.platform as PlatformName,
          accountId: selected.id,
          caption,
          publishAt: schedule && publishAt ? new Date(publishAt).toISOString() : undefined,
        }),
      });
      setDone(true);
      onPublished();
      setTimeout(onClose, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-semibold">Publish clip</h3>

        {done ? (
          <p className="rounded-lg bg-emerald-950/50 px-3 py-2 text-sm text-emerald-300">
            {schedule ? "Scheduled!" : "Queued for publishing!"}
          </p>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-ink-100/70">
            No connected accounts. Go to <strong>Connections</strong> to link a platform first.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="label">Account</label>
              <select
                className="input"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {PLATFORM_META[a.platform]?.icon} {PLATFORM_META[a.platform]?.label} —{" "}
                    {a.displayName || a.username || a.externalId}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Caption</label>
              <textarea
                className="input min-h-20 resize-y"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                maxLength={2200}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={schedule}
                onChange={(e) => setSchedule(e.target.checked)}
                className="accent-brand-500"
              />
              Schedule for later
            </label>
            {schedule && (
              <input
                type="datetime-local"
                className="input"
                value={publishAt}
                onChange={(e) => setPublishAt(e.target.value)}
              />
            )}

            {error && <p className="rounded-lg bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</p>}

            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button className="btn-primary" onClick={publish} disabled={busy}>
                {busy ? "Publishing…" : schedule ? "Schedule" : "Publish now"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatDuration } from "@/lib/client";
import { languageLabel } from "@/lib/languages";
import { useToast } from "@/components/ui/Toast";

interface AdminStoryDTO {
  id: string;
  title: string;
  language: string;
  source: string;
  status: string;
  text: string;
  audioUrl: string | null;
  durationSec: number | null;
  createdAt: string;
  topic: string | null;
  ttsText: string | null;
  claimedByName: string | null;
  claimedByEmail: string | null;
  generatedVideoId: string | null;
  errorMessage: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "badge-neutral",
  GENERATING: "badge-warn",
  READY: "badge-success",
  CLAIMED: "badge-brand",
  FAILED: "badge-danger",
};

type Mode = "ai" | "paste" | "upload";

export function AdminStories() {
  const [stories, setStories] = useState<AdminStoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("ai");
  const [editing, setEditing] = useState<AdminStoryDTO | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setStories(await api<AdminStoryDTO[]>("/api/admin/stories"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load stories");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while anything is still generating so status/duration update live.
  useEffect(() => {
    if (!stories.some((s) => s.status === "GENERATING")) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [stories, load]);

  async function regenerate(id: string) {
    try {
      await api(`/api/admin/stories/${id}/audio`, { method: "POST" });
      toast.success("Regenerating voice-over…");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  }

  async function remove(id: string, title: string) {
    if (!confirm(`Delete "${title}"? This removes the story and its voice-over.`)) return;
    try {
      await api(`/api/admin/stories/${id}`, { method: "DELETE" });
      toast.success("Deleted");
      setStories((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-1 flex items-center gap-3">
        <Link href="/dashboard/stories" className="btn-ghost h-8 w-8 px-0" aria-label="Back">
          <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        </Link>
        <h1 className="text-2xl font-semibold">Manage AI Stories</h1>
      </div>
      <p className="mb-6 text-sm text-ink-400">
        Generate stories with AI, paste your own (voice-over is created automatically), or upload text /
        audio. Voice-overs are stored so stories play instantly without regenerating.
      </p>

      {/* Create panel */}
      <div className="card p-5">
        <div className="mb-4 flex flex-wrap gap-2">
          <TabButton active={mode === "ai"} onClick={() => setMode("ai")}>
            Generate with AI
          </TabButton>
          <TabButton active={mode === "paste"} onClick={() => setMode("paste")}>
            Paste text
          </TabButton>
          <TabButton active={mode === "upload"} onClick={() => setMode("upload")}>
            Upload file
          </TabButton>
        </div>
        {mode === "ai" && <GenerateForm onCreated={load} />}
        {mode === "paste" && <PasteForm onCreated={load} />}
        {mode === "upload" && <UploadForm onCreated={load} />}
      </div>

      {/* List */}
      <h2 className="mb-3 mt-8 text-lg font-semibold">All stories ({stories.length})</h2>
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-16" />
          ))}
        </div>
      ) : stories.length === 0 ? (
        <p className="text-sm text-ink-400">No stories yet — create one above.</p>
      ) : (
        <div className="space-y-2">
          {stories.map((s) => (
            <div key={s.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`badge ${STATUS_BADGE[s.status] ?? "badge-neutral"}`}>{s.status}</span>
                    <span className="badge badge-neutral">{languageLabel(s.language)}</span>
                    <span className="text-xs text-ink-400">{s.source}</span>
                    {s.durationSec ? (
                      <span className="text-xs text-ink-400">· {formatDuration(s.durationSec)}</span>
                    ) : null}
                  </div>
                  <div className="mt-1 truncate font-medium" dir={s.language === "ur" ? "rtl" : "ltr"}>
                    {s.title || "(untitled)"}
                  </div>
                  {s.status === "CLAIMED" && (
                    <div className="mt-0.5 text-xs text-ink-400">
                      Claimed by {s.claimedByName || s.claimedByEmail || "a user"}
                    </div>
                  )}
                  {s.errorMessage && (
                    <div className="mt-1 text-xs text-red-600">{s.errorMessage}</div>
                  )}
                  {s.audioUrl && (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <audio src={s.audioUrl} controls preload="none" className="mt-2 h-8 w-full max-w-md" />
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <IconBtn icon="edit" label="Edit" onClick={() => setEditing(s)} />
                  <IconBtn
                    icon="graphic_eq"
                    label="Regenerate voice-over"
                    disabled={s.status === "GENERATING" || !s.text}
                    onClick={() => regenerate(s.id)}
                  />
                  <IconBtn icon="delete" label="Delete" danger onClick={() => remove(s.id, s.title)} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EditDialog
          story={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// ---- Create forms ---------------------------------------------------------

function GenerateForm({ onCreated }: { onCreated: () => void }) {
  const [topic, setTopic] = useState("");
  const [language, setLanguage] = useState("en");
  const [durationMin, setDurationMin] = useState(9);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit() {
    if (topic.trim().length < 3) return toast.error("Enter a topic.");
    setBusy(true);
    try {
      await api("/api/admin/stories", {
        method: "POST",
        body: JSON.stringify({ mode: "ai", topic: topic.trim(), language, durationMin }),
      });
      toast.success("Writing the story + voice-over… (a few minutes)");
      setTopic("");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="label">Topic / prompt</label>
        <textarea
          className="input min-h-20"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. A mysterious lighthouse keeper who receives letters from the future"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Language</label>
          <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="en">English</option>
            <option value="ur">Urdu</option>
          </select>
        </div>
        <div>
          <label className="label">Length (minutes)</label>
          <input
            className="input"
            type="number"
            min={3}
            max={15}
            value={durationMin}
            onChange={(e) => setDurationMin(Number(e.target.value))}
          />
        </div>
      </div>
      <button className="btn-primary w-full" onClick={submit} disabled={busy}>
        {busy ? "Starting…" : "Generate story"}
      </button>
    </div>
  );
}

function PasteForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("en");
  const [text, setText] = useState("");
  const [ttsText, setTtsText] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit() {
    if (!title.trim() || text.trim().length < 20) return toast.error("Add a title and the story text.");
    setBusy(true);
    try {
      await api("/api/admin/stories", {
        method: "POST",
        body: JSON.stringify({
          mode: "paste",
          title: title.trim(),
          language,
          text: text.trim(),
          ttsText: ttsText.trim() || undefined,
        }),
      });
      toast.success("Generating the voice-over…");
      setTitle("");
      setText("");
      setTtsText("");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="label">Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label">Language</label>
          <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="en">English</option>
            <option value="ur">Urdu</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">Story text</label>
        <textarea
          className="input min-h-40"
          dir={language === "ur" ? "rtl" : "ltr"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the full story…"
        />
      </div>
      {language === "ur" && (
        <div>
          <label className="label">Devanagari for voice-over (optional)</label>
          <textarea
            className="input min-h-20"
            value={ttsText}
            onChange={(e) => setTtsText(e.target.value)}
            placeholder="Leave blank to auto-transliterate the Urdu for the voice engine."
          />
        </div>
      )}
      <button className="btn-primary w-full" onClick={submit} disabled={busy}>
        {busy ? "Starting…" : "Save + generate voice-over"}
      </button>
    </div>
  );
}

function UploadForm({ onCreated }: { onCreated: () => void }) {
  const [kind, setKind] = useState<"voice" | "text">("voice");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("en");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function submit() {
    const file = fileRef.current?.files?.[0];
    if (!title.trim()) return toast.error("Add a title.");
    if (!file) return toast.error("Choose a file.");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      form.append("title", title.trim());
      form.append("language", language);
      await api("/api/admin/stories/upload", { method: "POST", body: form });
      toast.success(kind === "voice" ? "Uploaded voice-over" : "Uploaded — generating voice-over…");
      setTitle("");
      if (fileRef.current) fileRef.current.value = "";
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <ModeCard active={kind === "voice"} onClick={() => setKind("voice")} title="Voice file" desc="Ready audio (mp3/wav) — used as-is." />
        <ModeCard active={kind === "text"} onClick={() => setKind("text")} title="Text file" desc="A .txt — we synthesize the voice." />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="label">Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label">Language</label>
          <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="en">English</option>
            <option value="ur">Urdu</option>
          </select>
        </div>
      </div>
      <div>
        <label className="label">{kind === "voice" ? "Audio file" : "Text file"}</label>
        <input
          ref={fileRef}
          type="file"
          accept={kind === "voice" ? "audio/*" : ".txt,text/plain"}
          className="input file:mr-3 file:rounded file:border-0 file:bg-ink-700 file:px-3 file:py-1 file:text-ink-100"
        />
      </div>
      <button className="btn-primary w-full" onClick={submit} disabled={busy}>
        {busy ? "Uploading…" : "Upload"}
      </button>
    </div>
  );
}

// ---- Edit dialog ----------------------------------------------------------

function EditDialog({
  story,
  onClose,
  onSaved,
}: {
  story: AdminStoryDTO;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(story.title);
  const [text, setText] = useState(story.text);
  const [ttsText, setTtsText] = useState(story.ttsText ?? "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function save(regenerate: boolean) {
    setBusy(true);
    try {
      await api(`/api/admin/stories/${story.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: title.trim(), text: text.trim(), ttsText: ttsText.trim() }),
      });
      if (regenerate) await api(`/api/admin/stories/${story.id}/audio`, { method: "POST" });
      toast.success(regenerate ? "Saved — regenerating voice-over…" : "Saved");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const rtl = story.language === "ur";
  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card max-h-[90vh] w-full max-w-lg animate-scale-in overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">Edit story</h3>
        <div className="mt-4 space-y-3">
          <div>
            <label className="label">Title</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} dir={rtl ? "rtl" : "ltr"} />
          </div>
          <div>
            <label className="label">Story text</label>
            <textarea className="input min-h-48" value={text} onChange={(e) => setText(e.target.value)} dir={rtl ? "rtl" : "ltr"} />
          </div>
          {rtl && (
            <div>
              <label className="label">Devanagari for voice-over (optional)</label>
              <textarea className="input min-h-24" value={ttsText} onChange={(e) => setTtsText(e.target.value)} />
            </div>
          )}
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <button className="btn-primary flex-1" onClick={() => save(true)} disabled={busy}>
            {busy ? "Saving…" : "Save + regenerate voice"}
          </button>
          <button className="btn-secondary" onClick={() => save(false)} disabled={busy}>
            Save only
          </button>
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Small shared bits ----------------------------------------------------

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-brand-500 text-white" : "bg-ink-800 text-ink-100/70 hover:bg-ink-700"
      }`}
    >
      {children}
    </button>
  );
}

function ModeCard({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
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

function IconBtn({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${
        danger ? "text-ink-400 hover:bg-red-500/10 hover:text-red-600" : "text-ink-400 hover:bg-ink-800 hover:text-ink-100"
      }`}
    >
      <span className="material-symbols-outlined text-[19px]">{icon}</span>
    </button>
  );
}

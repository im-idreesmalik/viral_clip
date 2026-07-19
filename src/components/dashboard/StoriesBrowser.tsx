"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, formatDuration } from "@/lib/client";
import { languageLabel } from "@/lib/languages";
import { StoryVideoDialog } from "@/components/dashboard/StoryVideoDialog";

export interface StoryDTO {
  id: string;
  title: string;
  language: string;
  source: string;
  status: string;
  viralScore: number | null;
  text: string;
  audioUrl: string | null;
  durationSec: number | null;
  createdAt: string;
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "en", label: "English" },
  { value: "ur", label: "Urdu" },
];

export function StoriesBrowser({ isAdmin }: { isAdmin: boolean }) {
  const [stories, setStories] = useState<StoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [chosen, setChosen] = useState<StoryDTO | null>(null);

  const load = useCallback(async (language: string) => {
    setLoading(true);
    try {
      setStories(await api<StoryDTO[]>(`/api/stories?language=${language}`));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  return (
    <div className="max-w-5xl">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">AI Stories</h1>
        {isAdmin && (
          <Link href="/dashboard/admin/stories" className="btn-secondary gap-2 text-sm">
            <span className="material-symbols-outlined text-[18px]">tune</span>
            Manage stories
          </Link>
        )}
      </div>
      <p className="mb-5 text-sm text-ink-400">
        Listen to ready-made narrated stories, then turn any one into a set of short videos. Once you
        generate a video from a story, it&apos;s yours — it disappears from the library for everyone else.
      </p>

      <div className="mb-5 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === f.value ? "bg-brand-500 text-white" : "bg-ink-800 text-ink-100/70 hover:bg-ink-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-48" />
          ))}
        </div>
      ) : stories.length === 0 ? (
        <div className="card flex flex-col items-center justify-center p-12 text-center">
          <div className="mb-3 text-4xl">📖</div>
          <p className="font-medium">No stories available</p>
          <p className="mt-1 text-sm text-ink-400">
            {isAdmin
              ? "Generate or add stories from Manage stories."
              : "Check back soon — new stories are added regularly."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {stories.map((s) => (
            <StoryCard key={s.id} story={s} onGenerate={() => setChosen(s)} />
          ))}
        </div>
      )}

      {chosen && (
        <StoryVideoDialog
          story={chosen}
          onClose={() => setChosen(null)}
          onDone={() => setStories((prev) => prev.filter((s) => s.id !== chosen.id))}
        />
      )}
    </div>
  );
}

function StoryCard({ story, onGenerate }: { story: StoryDTO; onGenerate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const rtl = story.language === "ur";
  return (
    <div className="card flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 font-semibold leading-snug" dir={rtl ? "rtl" : "ltr"}>
          {story.title}
        </h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {story.viralScore != null && (
            <span
              className={`badge ${
                story.viralScore >= 80 ? "badge-success" : story.viralScore >= 60 ? "badge-warn" : "badge-neutral"
              }`}
              title="AI viral-potential score"
            >
              🔥 {story.viralScore}
            </span>
          )}
          <span className="badge badge-neutral">{languageLabel(story.language)}</span>
        </div>
      </div>
      <div className="mt-1 text-xs text-ink-400">{formatDuration(story.durationSec)} listen</div>

      {story.audioUrl && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio src={story.audioUrl} controls preload="none" className="mt-3 w-full" />
      )}

      <p
        dir={rtl ? "rtl" : "ltr"}
        className={`mt-3 whitespace-pre-wrap text-sm text-ink-300 ${expanded ? "" : "line-clamp-4"}`}
      >
        {story.text}
      </p>
      {story.text.length > 240 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 self-start text-xs font-medium text-brand-600 hover:underline"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}

      <button onClick={onGenerate} className="btn-primary mt-4 w-full gap-2">
        <span className="material-symbols-outlined text-[18px]">movie</span>
        Generate video
      </button>
    </div>
  );
}

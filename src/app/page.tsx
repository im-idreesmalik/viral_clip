import Link from "next/link";

// Public marketing landing page. This is the app's official website — used as
// the "Web/Desktop URL" for platform (TikTok/YouTube/Meta) app review, and it
// links to the Terms of Service and Privacy Policy those reviews require.
export const metadata = {
  title: "ViralCut — Turn long videos into viral short clips",
  description:
    "ViralCut converts long-form videos into ready-to-post vertical clips for TikTok, Instagram Reels, Facebook Reels, and YouTube Shorts — with AI clip detection, auto captions, and scheduled publishing.",
};

const FEATURES = [
  { icon: "🎯", title: "AI viral detection", body: "Our engine reviews the full transcript and surfaces the highest-potential moments with confidence scores." },
  { icon: "📱", title: "Vertical 9:16 clips", body: "Every clip is reframed to 1080×1920 with a clean blurred-fill background, optimized for short-form feeds." },
  { icon: "💬", title: "Auto captions", body: "Word-timed subtitles are generated and burned in, so clips are watchable with the sound off." },
  { icon: "✂️", title: "Two modes", body: "Extract only the best viral moments, or split an entire video into sequential parts." },
  { icon: "📡", title: "Publish anywhere", body: "Connect TikTok, Instagram, Facebook, and YouTube and post immediately or on a schedule." },
  { icon: "⚙️", title: "Automation", body: "Approve clips once and let ViralCut publish them on the cadence you choose." },
];

const PLATFORMS = [
  { icon: "🎵", label: "TikTok" },
  { icon: "📸", label: "Instagram" },
  { icon: "📘", label: "Facebook" },
  { icon: "▶️", label: "YouTube" },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen text-ink-100">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-ink-800/60 bg-ink-950/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient text-lg shadow-glow-sm">✂️</span>
            <span className="text-lg font-semibold tracking-tight">ViralCut</span>
          </div>
          <nav className="flex items-center gap-1 text-sm sm:gap-3">
            <Link href="/terms" className="hidden rounded-lg px-3 py-1.5 text-ink-300 hover:text-ink-100 sm:block">Terms</Link>
            <Link href="/privacy" className="hidden rounded-lg px-3 py-1.5 text-ink-300 hover:text-ink-100 sm:block">Privacy</Link>
            <Link href="/login" className="btn-secondary">Sign in</Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="mx-auto max-w-6xl px-6">
        <section className="py-16 text-center sm:py-24">
          <span className="badge animate-fade-in border border-brand-500/30 bg-brand-500/10 text-brand-100">
            ✨ AI-powered short-form video
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl animate-fade-up text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
            Turn long videos into{" "}
            <span className="bg-gradient-to-r from-brand-400 via-brand-300 to-accent bg-clip-text text-transparent">
              viral short clips
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl animate-fade-up text-lg leading-relaxed text-ink-300">
            ViralCut analyzes your long-form videos, finds the most engaging moments, converts them
            to vertical 9:16 clips with burned-in captions, and helps you publish them to TikTok,
            Instagram Reels, Facebook Reels, and YouTube Shorts.
          </p>
          <div className="mt-9 flex animate-fade-up flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/login" className="btn-primary w-full px-6 py-3 text-base sm:w-auto">Get started →</Link>
            <Link href="/register" className="btn-secondary w-full px-6 py-3 text-base sm:w-auto">Create account</Link>
          </div>

          {/* Platform chips */}
          <div className="mt-12 flex flex-wrap items-center justify-center gap-2.5">
            <span className="text-xs uppercase tracking-wide text-ink-400">Publishes to</span>
            {PLATFORMS.map((p) => (
              <span key={p.label} className="badge gap-1.5 border border-ink-700 bg-ink-900/80 px-3 py-1 text-ink-200">
                <span>{p.icon}</span> {p.label}
              </span>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="grid grid-cols-1 gap-4 pb-20 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card card-hover p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-800 text-2xl">
                {f.icon}
              </div>
              <h3 className="mt-4 font-medium">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-400">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-ink-800">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-ink-400 sm:flex-row">
          <span>© {new Date().getFullYear()} ViralCut. All rights reserved.</span>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="hover:text-ink-100">Terms of Service</Link>
            <Link href="/privacy" className="hover:text-ink-100">Privacy Policy</Link>
            <Link href="/login" className="hover:text-ink-100">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

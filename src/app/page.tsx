import Link from "next/link";

// Public marketing landing page. This is the app's official website — used as
// the "Web/Desktop URL" for platform (TikTok/YouTube/Meta) app review, and it
// links to the Terms of Service and Privacy Policy those reviews require.
export const metadata = {
  title: "ViralCut — Turn long videos into viral short clips",
  description:
    "ViralCut converts long-form videos into ready-to-post vertical clips for TikTok, Instagram Reels, Facebook Reels, and YouTube Shorts — with AI clip detection, auto captions, and scheduled publishing.",
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-lg">✂️</span>
          <span className="text-lg font-semibold">ViralCut</span>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/terms" className="text-ink-100/70 hover:text-ink-100">Terms</Link>
          <Link href="/privacy" className="text-ink-100/70 hover:text-ink-100">Privacy</Link>
          <Link href="/login" className="btn-secondary">Sign in</Link>
        </nav>
      </header>

      {/* Hero */}
      <main className="mx-auto max-w-6xl px-6">
        <section className="py-16 text-center sm:py-24">
          <span className="badge bg-brand-500/15 text-brand-100">AI-powered short-form video</span>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
            Turn long videos into <span className="text-brand-400">viral short clips</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-ink-100/70">
            ViralCut analyzes your long-form videos, finds the most engaging moments, converts them
            to vertical 9:16 clips with burned-in captions, and helps you publish them to TikTok,
            Instagram Reels, Facebook Reels, and YouTube Shorts.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link href="/login" className="btn-primary px-6 py-3 text-base">Get started</Link>
            <Link href="/register" className="btn-secondary px-6 py-3 text-base">Create account</Link>
          </div>
        </section>

        {/* Features */}
        <section className="grid grid-cols-1 gap-4 pb-16 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: "🎯", title: "AI viral detection", body: "Our engine reviews the full transcript and surfaces the highest-potential moments with confidence scores." },
            { icon: "📱", title: "Vertical 9:16 clips", body: "Every clip is reframed to 1080×1920 with a clean blurred-fill background, optimized for short-form feeds." },
            { icon: "💬", title: "Auto captions", body: "Word-timed subtitles are generated and burned in, so clips are watchable with the sound off." },
            { icon: "✂️", title: "Two modes", body: "Extract only the best viral moments, or split an entire video into sequential parts." },
            { icon: "📡", title: "Publish anywhere", body: "Connect TikTok, Instagram, Facebook, and YouTube and post immediately or on a schedule." },
            { icon: "⚙️", title: "Automation", body: "Approve clips once and let ViralCut publish them on the cadence you choose." },
          ].map((f) => (
            <div key={f.title} className="card p-5">
              <div className="text-2xl">{f.icon}</div>
              <h3 className="mt-3 font-medium">{f.title}</h3>
              <p className="mt-1 text-sm text-ink-100/60">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-ink-800">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-ink-100/60 sm:flex-row">
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

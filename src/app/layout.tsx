import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Self-hosted at build time (no runtime external request / CSP-safe). Exposed
// as a CSS variable consumed by Tailwind's font-sans.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  // Tab/homepage title must equal the app name EXACTLY for TikTok/Meta review:
  // default is "ViralCut"; other pages render "<page> · ViralCut".
  title: { default: "ViralCut", template: "%s · ViralCut" },
  applicationName: "ViralCut",
  description:
    "Turn long-form videos into viral short-form clips for TikTok, Reels, and Shorts — with AI clip detection, auto captions, and scheduled publishing.",
  // TikTok "URL properties" meta-tag verification. Set TIKTOK_URL_VERIFICATION
  // to the code TikTok gives you, then restart — it renders
  // <meta name="tiktok-developers-site-verification" content="..."> on every page.
  other: process.env.TIKTOK_URL_VERIFICATION
    ? { "tiktok-developers-site-verification": process.env.TIKTOK_URL_VERIFICATION }
    : undefined,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
    // attributes on <html>/<body> before React hydrates, which otherwise
    // triggers a harmless hydration-mismatch warning.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Material Symbols icon font (matches the design system). */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
        />
      </head>
      <body className="min-h-screen bg-ink-950 font-sans text-ink-100 antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}

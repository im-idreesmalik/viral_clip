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
  title: "ViralCut — Long-form to viral shorts",
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
      <body className="min-h-screen font-sans antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}

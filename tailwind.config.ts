import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // "Obsidian Kinetic Light" — the scale is inverted vs. a dark theme:
        // ink-950 is the (lightest) page background, ink-100 is near-black text.
        ink: {
          50: "#111118",
          100: "#1b1b22", // on-surface (primary text)
          200: "#2f2d3a",
          300: "#484555", // on-surface-variant (secondary text)
          400: "#6b6878", // muted text
          500: "#797587", // outline / placeholder
          600: "#a7a2b5",
          700: "#c9c4d8", // outline-variant (borders)
          800: "#e4e1eb", // surface-variant (raised chips)
          900: "#f0edf7", // surface-container (panels)
          950: "#fcf8ff", // page background
        },
        brand: {
          DEFAULT: "#7c5cff",
          50: "#f2effe",
          100: "#e3dcff",
          200: "#c8b9ff",
          300: "#ad96ff",
          400: "#9b80ff",
          500: "#7c5cff",
          600: "#6442e6",
          700: "#4f33b8",
          800: "#3c2790",
        },
        accent: {
          DEFAULT: "#22d3ee",
          400: "#22d3ee",
          500: "#06b6d4",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        // Geist for labels/metadata (developer-tool precision).
        geist: ["var(--font-geist)", "var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        // Ambient purple glow for primary/active elements.
        glow: "0 0 0 1px rgba(124,92,255,0.25), 0 10px 30px -8px rgba(124,92,255,0.45)",
        "glow-sm": "0 8px 20px -8px rgba(124,92,255,0.45)",
        // Soft, light-theme card elevation (no heavy black shadows).
        card: "0 1px 2px 0 rgba(17,17,24,0.04), 0 10px 26px -14px rgba(17,17,24,0.14)",
        "card-hover": "0 2px 6px 0 rgba(17,17,24,0.06), 0 22px 44px -18px rgba(94,57,224,0.20)",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #7c5cff 0%, #5e39e0 100%)",
        "brand-radial": "radial-gradient(60% 60% at 50% 0%, rgba(124,92,255,0.14) 0%, rgba(124,92,255,0) 100%)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "toast-in": {
          from: { opacity: "0", transform: "translateY(12px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "slide-left": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
        "fade-up": "fade-up 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-in": "scale-in 0.18s ease-out",
        "toast-in": "toast-in 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-left": "slide-left 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;

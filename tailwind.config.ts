import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f5f5fa",
          100: "#e8e8f0",
          200: "#cfcfdd",
          300: "#a9a9be",
          400: "#76768e",
          500: "#52526a",
          600: "#3a3a4d",
          700: "#262633",
          800: "#1a1a24",
          900: "#111118",
          950: "#0a0a0f",
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
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(124,92,255,0.35), 0 8px 30px -8px rgba(124,92,255,0.45)",
        "glow-sm": "0 4px 16px -6px rgba(124,92,255,0.5)",
        card: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -16px rgba(0,0,0,0.7)",
        "card-hover": "0 1px 0 0 rgba(255,255,255,0.05) inset, 0 16px 40px -20px rgba(0,0,0,0.8)",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #7c5cff 0%, #6442e6 100%)",
        "brand-radial": "radial-gradient(60% 60% at 50% 0%, rgba(124,92,255,0.18) 0%, rgba(124,92,255,0) 100%)",
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

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
          50: "#f4f4f8",
          100: "#e8e8f0",
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
          400: "#9b80ff",
          500: "#7c5cff",
          600: "#6442e6",
          700: "#4f33b8",
        },
        accent: "#22d3ee",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;

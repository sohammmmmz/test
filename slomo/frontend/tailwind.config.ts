import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // "canopy terminal" — warm forest darks with cream ink
        bark: { 950: "#12160f", 900: "#181d14" },
        canopy: { 900: "#1e2419", 800: "#262d20", 700: "#333b2b" },
        moss: { 500: "#8aa86f", 400: "#a3bd8c", 300: "#c0d3ae" },
        amber: { 500: "#dfa03c", 400: "#eab45f" },
        cream: { 100: "#f3f0e4", 300: "#d9d5c3", 500: "#a5a292", 700: "#6f6d61" },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      transitionTimingFunction: {
        sloth: "cubic-bezier(0.25, 0.1, 0.15, 1)",
      },
    },
  },
  plugins: [],
} satisfies Config;

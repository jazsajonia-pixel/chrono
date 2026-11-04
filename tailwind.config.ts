import type { Config } from "tailwindcss";

const hsl = (v: string) => `hsl(var(${v}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Geist", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'Geist Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        background: hsl("--background"),
        foreground: hsl("--foreground"),
        surface: { DEFAULT: hsl("--surface"), 2: hsl("--surface-2") },
        border: hsl("--border"),
        muted: { DEFAULT: hsl("--muted"), foreground: hsl("--muted-foreground") },
        primary: { DEFAULT: hsl("--primary"), foreground: hsl("--primary-foreground") },
        danger: { DEFAULT: hsl("--danger"), foreground: hsl("--danger-foreground") },
        warning: hsl("--warning"),
        success: hsl("--success"),
        ring: hsl("--ring"),
        sidebar: {
          DEFAULT: hsl("--sidebar"),
          foreground: hsl("--sidebar-foreground"),
          muted: hsl("--sidebar-muted"),
          border: hsl("--sidebar-border"),
          accent: hsl("--sidebar-accent"),
        },
      },
      borderRadius: { lg: "12px", md: "8px", sm: "6px" },
      spacing: { safe: "env(safe-area-inset-bottom)" },
      // Every Tailwind transition shares the motion tokens in index.css.
      transitionTimingFunction: { DEFAULT: "var(--ease-out)", out: "var(--ease-out)", in: "var(--ease-in)" },
      transitionDuration: { DEFAULT: "var(--dur-base)", fast: "var(--dur-fast)", base: "var(--dur-base)", slow: "var(--dur-slow)" },
      keyframes: {
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
      },
      animation: {
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;

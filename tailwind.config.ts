import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        capy: {
          // rgb triplet vars → dark mode troca os valores em globals.css
          green: "rgb(var(--capy-green) / <alpha-value>)",
          deep: "rgb(var(--capy-deep) / <alpha-value>)",
          dark: "rgb(var(--capy-dark) / <alpha-value>)",
          fur: "rgb(var(--capy-fur) / <alpha-value>)",
          furlight: "rgb(var(--capy-furlight) / <alpha-value>)",
          sand: "rgb(var(--capy-sand) / <alpha-value>)",
          sanddark: "rgb(var(--capy-sanddark) / <alpha-value>)",
          bubble: "rgb(var(--capy-bubble) / <alpha-value>)",
          accent: "rgb(var(--capy-accent) / <alpha-value>)",
          danger: "rgb(var(--capy-danger) / <alpha-value>)",
        },
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": { from: { transform: "translateY(12px)", opacity: "0" }, to: { transform: "translateY(0)", opacity: "1" } },
        "pop-in": { from: { transform: "scale(0.92)", opacity: "0" }, to: { transform: "scale(1)", opacity: "1" } },
        "rec-pulse": { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
      },
      animation: {
        "fade-in": "fade-in 0.18s ease-out",
        "slide-up": "slide-up 0.22s ease-out",
        "pop-in": "pop-in 0.16s ease-out",
        "rec-pulse": "rec-pulse 1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;

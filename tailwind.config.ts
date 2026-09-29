import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        capy: {
          green: "#3D8B5F",
          deep: "#2F6B4A",
          dark: "#244E37",
          fur: "#8D6748",
          furlight: "#A9805B",
          sand: "#EFE9DF",
          sanddark: "#E3DCCC",
          bubble: "#D9F2CF",
          accent: "#C47A3A",
          danger: "#D9453F",
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

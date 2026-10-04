import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#f4f6f8",
        aqua: {
          50: "#eef8ff",
          500: "#0ea5e9",
          700: "#0369a1",
        },
        status: {
          ok: "#16a34a",
          warn: "#d97706",
          danger: "#dc2626",
          offline: "#64748b",
        },
      },
      boxShadow: {
        card: "0 10px 30px -12px rgb(14 165 233 / 0.18), 0 4px 12px -6px rgb(15 23 42 / 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;

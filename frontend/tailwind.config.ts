import { type Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#0F766E",
          50: "#F0FDFA",
          100: "#CCFBF1",
          200: "#99F6E4",
          300: "#5EEAD4",
          400: "#2DD4BF",
          500: "#14B8A6",
          600: "#0D9488",
          700: "#0F766E",
          800: "#115E59",
          900: "#134E4A",
        },
        ink: { DEFAULT: "#0F172A", soft: "#475569", faint: "#94A3B8" },
        canvas: "#F3F6F7",
        good: "#16A34A",
        warn: "#F59E0B",
        danger: "#DC2626",
        info: "#2563EB",
      },
      fontFamily: {
        sans: ["PingFang SC", "Microsoft YaHei", "Noto Sans SC", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,.04), 0 8px 24px -12px rgba(15,23,42,.12)",
        lift: "0 2px 4px rgba(15,23,42,.06), 0 14px 30px -14px rgba(13,148,136,.25)",
      },
      borderRadius: { xl2: "16px" },
    },
  },
  plugins: [],
} satisfies Config;

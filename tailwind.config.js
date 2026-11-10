/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0e0a",
        panel: "#111812",
        line: "#1e2a20",
        text: "#e8f5e8",
        muted: "#8aa88a",
        danger: "#ff3b3b",
        warn: "#ffb020",
        safe: "#3dff9a",
        hp: "#ff4d4d",
        noise: "#ffd166",
      },
      minHeight: {
        rescue: "64px",
      },
      minWidth: {
        touch: "48px",
      },
    },
  },
  plugins: [],
};

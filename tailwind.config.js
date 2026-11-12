/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#f4f7f4",
        panel: "#ffffff",
        line: "#d4ddd4",
        text: "#0f1a0f",
        muted: "#5a6b5a",
        danger: "#dc2626",
        warn: "#d97706",
        safe: "#16a34a",
        hp: "#dc2626",
        noise: "#b45309",
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

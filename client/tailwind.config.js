import defaultTheme from "tailwindcss/defaultTheme";

// Design tokens for the "campus signage" look (docs/plans/11-interface-redesign.md).
// Every colour pair used for text has at least 4.5:1 contrast; the browser test scans for it.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: { DEFAULT: "#F4F6F5", 2: "#E9EDEB" },
        ink: "#13233B",
        signal: { DEFAULT: "#1F4BFF", dark: "#1738C9" },
        marigold: "#F5B800",
        line: "#D5DBD8", // dividers and card edges
        edge: "#7F8B86", // borders of inputs and buttons (3:1 against white)
        muted: "#4A5668",
        // The grey scale the screens already use is mapped onto the same palette, so nothing
        // keeps the old default-grey look.
        slate: {
          50: "#F4F6F5",
          100: "#E9EDEB",
          200: "#D5DBD8",
          300: "#7F8B86",
          400: "#7F8B86",
          500: "#4A5668",
          600: "#4A5668",
          700: "#2D3B52",
          800: "#13233B",
          900: "#13233B",
        },
        // One colour per category (text colour and its pale background).
        cat: {
          red: "#B3261E",
          "red-tint": "#FBEAE8",
          violet: "#6B3FA0",
          "violet-tint": "#F0EAF7",
          green: "#1B6E43",
          "green-tint": "#E6F3EC",
          slate: "#41546B",
          "slate-tint": "#E9EDF2",
          teal: "#0B6E78",
          "teal-tint": "#E3F2F3",
          orange: "#A24A00",
          "orange-tint": "#FCEEDF",
          rose: "#A1255F",
          "rose-tint": "#FBE8F0",
        },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque Variable"', ...defaultTheme.fontFamily.sans],
        sans: ['"Public Sans Variable"', ...defaultTheme.fontFamily.sans],
      },
      keyframes: {
        // A notice that just arrived slides in; its marigold edge is a static class, so people who
        // switch animation off still see which notice is new.
        arrive: {
          from: { opacity: "0", transform: "translateY(-10px)" },
          to: { opacity: "1", transform: "none" },
        },
        pulse: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.45", transform: "scale(0.8)" },
        },
      },
      animation: {
        arrive: "arrive 0.5s ease-out",
        pulse: "pulse 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

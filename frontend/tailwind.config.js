/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#0ea5e9", dark: "#0284c7" },
        buy:   "#22c55e",
        sell:  "#ef4444",
        hold:  "#f59e0b",
      },
    },
  },
  plugins: [],
};

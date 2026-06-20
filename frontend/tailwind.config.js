/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#0b5fa5", dark: "#083e6e" },
      },
    },
  },
  plugins: [],
};

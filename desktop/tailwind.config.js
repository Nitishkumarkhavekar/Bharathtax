/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#d9e6ff",
          200: "#bccffb",
          300: "#8fa5f5",
          500: "#2563eb",
          600: "#1d4ed8",
          700: "#1e40af",
          800: "#1e3a8a",
        },
      },
      fontFamily: {
        // Formal legal-doc stack — matches what LibreOffice renders for the
        // PDF preview so Modify-with-AI looks the same as Preview.
        serif: ['"Times New Roman"', "Times", '"Liberation Serif"', "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

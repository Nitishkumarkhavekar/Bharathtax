/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // The BharatTax palette is inspired by the Government of India seal
        // and the Income-Tax Department wordmark: deep navy for authority,
        // ashoka-red for accents, ivory-gray for the workspace surface, and
        // green for "healthy/ready" affordances (leaves in the seal).
        navy: {
          50:  "#f2f5fa",
          100: "#dde5f0",
          200: "#b7c6dc",
          300: "#7f96b8",
          400: "#4c6b92",
          500: "#284972",
          600: "#1c3b62",
          700: "#132d4d",
          800: "#0a2540",   // primary chrome
          900: "#061a30",
        },
        ashoka: {
          50:  "#fef2f2",
          100: "#fee2e2",
          400: "#f26b6b",
          500: "#dc2626",
          600: "#b91c1c",
          700: "#991b1b",
        },
        brand: {
          50:  "#eef2fa",
          100: "#d9e0ee",
          200: "#b8c5dc",
          300: "#8fa5c5",
          500: "#284972",
          600: "#1c3b62",
          700: "#132d4d",   // primary
          800: "#0a2540",
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

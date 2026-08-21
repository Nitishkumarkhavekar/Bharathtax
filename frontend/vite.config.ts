import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// API route path prefixes exposed by the FastAPI backend. Anything at these
// roots is proxied to the api container so a single frontend tunnel serves
// both the UI and API calls (no second dev-tunnel required for the API).
const _API_PREFIXES = [
  "ask", "rulings", "documents", "chats", "history", "appeal", "crossref",
  "billing", "admin", "assist", "ratings", "auth", "personalization",
  "drafting", "contact", "support", "health", "public",
  "desktop-update", "desktop-admin", "desktop-session", "password-reset",
];
const _API_PROXY_RE = `^/(${_API_PREFIXES.join("|")})(/|$)`;

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Vite 5+ blocks Host headers not listed here with "Blocked request".
    // The .devtunnels.ms suffix covers Microsoft/VS Code dev tunnels used
    // for cross-machine local testing.
    allowedHosts: [
      "localhost",
      "127.0.0.1",
      ".devtunnels.ms",
      "rqfkjhpd-5174.inc1.devtunnels.ms",
    ],
    // Proxy API calls to the backend container so the ONE tunnel URL
    // serves both /ui and /api paths — remote testers don't need a
    // second dev-tunnel for the API. Matches known FastAPI route roots
    // via regex so we don't have to list each individually.
    proxy: {
      [_API_PROXY_RE]: {
        target: "http://api:8000",
        changeOrigin: true,
        ws: false,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split stable vendor libs into their own long-cached chunks so an app
        // update doesn't re-bust React/router/icons for every user.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-icons": ["lucide-react"],
        },
      },
    },
  },
});

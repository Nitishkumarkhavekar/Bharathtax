import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// API route path prefixes exposed by the FastAPI backend. Anything at these
// roots is proxied to the api container so a single frontend tunnel serves
// both the UI and API calls (no second dev-tunnel required for the API).
//
// **IMPORTANT** — this list must match the BACKEND route prefixes, NOT the
// frontend page routes. Historical bug: including "drafting" here proxied
// deep-links to /drafting/notices etc. to FastAPI (which only has /drafts),
// so every refresh on a Drafting page returned {"detail":"Not Found"} from
// the API instead of the SPA. The backend prefix is /drafts and /library
// and /news — that's what belongs here, not the client-side route names.
const _API_PREFIXES = [
  "ask", "rulings", "documents", "chats", "history", "appeal", "crossref",
  "billing", "admin", "assist", "ratings", "auth", "personalization",
  "workspace", "drafts", "library", "news", "contact", "support",
  "health", "public",
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
    //
    // COLLISION EXCEPTIONS: some FastAPI route roots (e.g. `/ask`) are
    // ALSO frontend SPA page routes. A browser hitting `/ask` directly
    // (address bar, refresh, back button) would otherwise get proxied
    // to POST-only endpoints and see FastAPI's `Method Not Allowed`
    // JSON instead of the Ask page. The bypass function returns
    // `/index.html` for GET requests to those exact roots so the SPA
    // serves the page, while POST + any `/ask/subpath` still proxy to
    // the backend for the streaming / starters / followups / translate
    // endpoints the frontend calls at runtime.
    proxy: {
      [_API_PROXY_RE]: {
        target: "http://api:8000",
        changeOrigin: true,
        ws: false,
        bypass: (req) => {
          const url = req.url || "";
          // Strip query string for path comparison.
          const path = url.split("?")[0];
          // These roots collide with SPA page routes. Bare GET → SPA.
          const spaCollisions = new Set([
            "/ask",
            "/rulings",
            "/history",
            "/news",
            "/library",
          ]);
          if (req.method === "GET" && spaCollisions.has(path)) {
            return "/index.html";
          }
          return undefined; // proxy as usual
        },
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

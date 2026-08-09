import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { host: "0.0.0.0", port: 5173 },
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

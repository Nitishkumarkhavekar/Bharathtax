import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// Self-hosted webfonts (bundled by Vite — no Google CDN, keeps the app
// self-contained/sovereign). Inter = UI/body; Newsreader = display/hero serif.
import "@fontsource-variable/inter";
import "@fontsource-variable/newsreader";
import App from "./App";
import { AuthProvider } from "./auth";
import { Toaster } from "./lib/toast";
import ErrorBoundary from "./components/ErrorBoundary";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
          <Toaster />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);

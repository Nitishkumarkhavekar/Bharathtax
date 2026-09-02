import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
// Self-hosted webfonts (bundled by Vite — no Google CDN, keeps the app
// self-contained/sovereign). Public Sans = UI/body (the typeface built for
// government interfaces); Source Serif 4 = display/heading serif.
import "@fontsource-variable/public-sans";
import "@fontsource-variable/source-serif-4";
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

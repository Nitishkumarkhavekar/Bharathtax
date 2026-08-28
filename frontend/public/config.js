// Runtime deployment config — loaded BEFORE the app bundle, so the SAME built
// frontend can point at any backend without rebuilding.
//
// SaaS (default): leave empty; the build-time VITE_API_BASE_URL is used.
//
// On-prem / sovereign instance — the department edits THIS file on their server
// (no rebuild) to point the UI at their own backend:
//   window.__BHARATTAX_CONFIG__ = { apiBase: "https://itd-bharattax.internal" };
// or, when the UI and API are served from the same host/nginx:
//   window.__BHARATTAX_CONFIG__ = { sameOrigin: true };
//
// LOCAL-FIRST mode — for sovereign / government deployments. When true, saving a
// drafted order to the officer's computer also removes the case and its
// documents from this server, so nothing is retained on the cloud:
//   window.__BHARATTAX_CONFIG__ = { localFirst: true };
window.__BHARATTAX_CONFIG__ = window.__BHARATTAX_CONFIG__ || {};

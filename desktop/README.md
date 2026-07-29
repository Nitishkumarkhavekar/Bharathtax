# BharatTax Appeal Order — Desktop App

Standalone Windows desktop app that lets an officer draft a CIT(A) / NFAC appeal
order end-to-end:

1. Sign in with a BharatTax account.
2. Activate a license key (server-issued).
3. Create a case, upload documents, run the 6-module pipeline, download DOCX.

**Nothing sensitive ships in the `.exe`.** The Gemini API key, the RAG corpus,
LibreOffice previewer and the licensing database all live on the BharatTax
server. The desktop app only holds the server URL and (after login) a short-
lived JWT.

When the server refuses a call because the license expired or the token quota
is used up, the app shows a full-screen **"Token quota completed"** /
**"License expired"** message and blocks all further use until the user signs
back in.

---

## Prerequisites

- Node.js 18+ and npm
- Windows 10 / 11 (for producing the `.exe`; dev works on macOS / Linux too)
- The BharatTax backend reachable from wherever the app runs (default
  `http://localhost:8000`)

## Install

```bash
cd desktop
npm install
```

## Run in development

Starts Vite on `:5173` and launches Electron pointing at it:

```bash
npm run dev
```

The default server URL is `http://localhost:8000`. Change it from the top-right
of the window (click the URL) or bake a different default at build time (see
below).

## Produce a Windows `.exe`

1. Drop your app icon at `build/icon.ico` (multi-size, 256×256 max). See
   "Icon" below for a one-liner to convert a PNG.
2. Optionally set the default server URL the installer bakes in:
   ```bash
   export BHARATTAX_SERVER_URL=https://api.your-domain.com
   ```
   (On Windows PowerShell: `$env:BHARATTAX_SERVER_URL="https://api.your-domain.com"`)
3. Build:
   ```bash
   npm run dist
   ```
   Output lands in `release/`:
   - `BharatTax Appeal Order Setup 1.0.0.exe` — NSIS installer with Start-menu
     + desktop shortcuts.
   - `BharatTax Appeal Order 1.0.0.exe` — portable single-file executable
     (no install needed).

For portable only:

```bash
npm run dist:portable
```

## Icon

The icon file must be `build/icon.ico`. From a source PNG:

```bash
# Requires ImageMagick
magick icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
```

Or use any online PNG → ICO converter.

## What lives where

```
desktop/
  electron/
    main.ts     # window, IPC handlers, config store
    preload.ts  # small typed bridge exposed to the renderer as window.bharat
  src/
    App.tsx           # boot → login → license → ready → locked-out router
    api.ts            # fetch wrapper, 401/402/403 interception
    screens/
      LoginScreen.tsx      # /auth/login
      LicenseScreen.tsx    # /auth/license/activate  (pre-fills pending_key)
      AppealFlow.tsx       # create case → upload → run → poll → download
      LicenseExpired.tsx   # full-screen block on quota / expiry / auth failure
    components/
      SettingsBar.tsx      # top bar with editable server URL and sign-out
  index.html
  vite.config.ts
  package.json      # includes electron-builder config
```

## API endpoints used (server-side, unchanged)

| Purpose | Endpoint |
|--|--|
| Sign in | `POST /auth/login` |
| Am I still logged in? | `GET /auth/me` |
| License state | `GET /auth/license/status` |
| Activate license | `POST /auth/license/activate` |
| Create case | `POST /appeal/cases` |
| Upload documents | `POST /appeal/cases/{slug}/documents` |
| Start 6-module pipeline | `POST /appeal/cases/{slug}/run` |
| Poll progress + outputs | `GET  /appeal/cases/{slug}/latest` |
| Download final DOCX | `GET  /appeal/cases/{slug}/export.docx` |

No new routes required on the server.

## License-expired / token-completed behaviour

The API client (`src/api.ts`) intercepts every response:

| Status | Meaning | Screen shown |
|--|--|--|
| `401` | JWT expired or missing | **Session expired** → back to sign-in |
| `402` | Token quota exhausted | **Token quota completed** — contact admin |
| `403` (detail mentions license/expired) | License lapsed | **License expired** — contact admin |
| `403` (other) | Generic denied | Inline error on current screen |
| Network failure | Server unreachable | **Server unreachable** with retry button |

## Configuration store

Config is persisted via `electron-store` under the OS user-config directory:

- Windows: `%APPDATA%/bharattax-appeal-desktop/bharattax-appeal-config.json`

Contents (JSON):

```json
{
  "serverUrl": "https://api.your-domain.com",
  "jwt": "eyJhbGciOi...",
  "jwtExpiresAt": "2026-07-28T09:00:00Z"
}
```

Signing out (or a 401) clears `jwt` and `jwtExpiresAt`.

## Signing the installer (optional)

To sign the installer for Windows SmartScreen, add to `package.json` `build.win`:

```json
"certificateFile": "path/to/cert.pfx",
"certificatePassword": "..."
```

Or use a signing service and set `signingHashAlgorithms`, `signAndEditExecutable`,
etc. per electron-builder docs.

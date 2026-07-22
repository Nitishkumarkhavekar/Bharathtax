#!/usr/bin/env node
// Writes electron/build-config.ts with the server URL that should be baked
// into the packaged app.  Run BEFORE `tsc -p electron` so main.ts imports the
// updated constant.
//
// Precedence:
//   1. BHARATTAX_SERVER_URL environment variable (CI / release build)
//   2. Existing DEFAULT_SERVER_URL in build-config.ts (local dev)
//   3. http://localhost:8000 (safe fallback for a first-time checkout)
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "electron", "build-config.ts");
const envUrl = (process.env.BHARATTAX_SERVER_URL || "").trim().replace(/\/+$/, "");
const url = envUrl || "http://localhost:8000";

const body = `// AUTO-GENERATED at build time by scripts/write-build-config.js from the
// BHARATTAX_SERVER_URL environment variable.  Do NOT edit by hand — your
// change will be overwritten on the next \`npm run build\`.
export const DEFAULT_SERVER_URL = ${JSON.stringify(url)};
`;

fs.writeFileSync(OUT, body, "utf8");
console.log(`[build-config] DEFAULT_SERVER_URL = ${url}`);

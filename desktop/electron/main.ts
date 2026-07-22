import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";
import Store from "electron-store";
import { DEFAULT_SERVER_URL } from "./build-config";
import { setupAutoUpdater, checkNow, quitAndInstall } from "./updater";

// ---------------------------------------------------------------------------
// Persistent config store. Holds ONLY:
//   - serverUrl   : where to reach the BharatTax API (owns Gemini + licensing)
//   - jwt         : cached login token (short-lived; server re-issues on login)
//   - jwtExpiresAt: ISO string, used for a cheap client-side "expired?" check
// The Gemini API key is NEVER stored here or shipped in the .exe.
// ---------------------------------------------------------------------------
type ConfigShape = {
  serverUrl: string;
  jwt: string | null;
  jwtExpiresAt: string | null;
};

const store = new Store<ConfigShape>({
  name: "bharattax-appeal-config",
  defaults: {
    // Default server URL — baked in at build time from BHARATTAX_SERVER_URL
    // (see scripts/write-build-config.js). The user can still change it in
    // the in-app Settings dialog. `process.env` also wins if set at launch,
    // which is useful for QA / support engineers.
    serverUrl: process.env.BHARATTAX_SERVER_URL || DEFAULT_SERVER_URL,
    jwt: null,
    jwtExpiresAt: null,
  },
});

// Legacy-config migration.
// Older builds hard-coded server URLs that don't work in production:
//   - v1.0.0        → `http://localhost:8000`   (no server on the officer's box)
//   - v1.0.1..1.0.3 → `https://bharattax.wenvia.global`  (missing the `/api`
//                       proxy prefix, so /auth/login hits the SPA host and
//                       returns 405, and the update feed returns HTML)
// electron-store's `defaults` only apply when a key is MISSING, so upgrading
// keeps the stale value.  On every launch we detect these known-bad URLs and
// rewrite them to the current build-time default so an in-place upgrade
// "just works".
{
  const stored = (store.get("serverUrl") ?? "").replace(/\/+$/, "");
  const _knownStale = [
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i,       // any localhost / loopback
    /^https?:\/\/bharattax\.wenvia\.global$/i,             // pre-v1.0.4 production URL (missing /api)
  ];
  const isStale = !stored || _knownStale.some((re) => re.test(stored));
  if (isStale && DEFAULT_SERVER_URL && DEFAULT_SERVER_URL !== stored) {
    store.set("serverUrl", DEFAULT_SERVER_URL);
    // A stale JWT was issued by the wrong host; drop it so we don't POST
    // credentials at a URL that will 405.
    store.set("jwt", null);
    store.set("jwtExpiresAt", null);
  }
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f4f6fb",
    autoHideMenuBar: true,
    show: false,          // hide until we've maximised, avoids a resize flash
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      plugins: true,
      // Allow the renderer to embed <webview> tags.  We use webview to
      // display the PDF preview — Chromium's PDF viewer is unreliable
      // inside a blob-URL iframe under Electron's default CSP, but works
      // out of the box in a webview that loads a file:// URL.
      webviewTag: true,
    },
  });

  // Open at the officer's full working size on every launch — the app is
  // best used at maximum width so all three columns of the case detail have
  // room.  The user can still manually resize / restore from the title bar.
  mainWindow.once("ready-to-show", () => {
    mainWindow!.maximize();
    mainWindow!.show();
  });

  // In dev (running via `npm run dev`), load from the Vite server. Packaged
  // builds load the bundled index.html from the asar-ed dist/ folder.
  const devUrl = process.env.VITE_DEV_SERVER_URL || (!app.isPackaged ? "http://localhost:5173" : null);
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  // External links open in the OS browser, not a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  // Start polling the update feed. Fires renderer notifications on progress
  // and completion via the `updater:event` IPC channel.
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------------------------------------------------------------------------
// IPC bridge — every renderer <-> main call goes through preload.ts and lands
// in one of these handlers. Kept small on purpose: config get/set, file pick
// for uploads, save-as for the final DOCX.
// ---------------------------------------------------------------------------
function registerIpc(): void {
  ipcMain.handle("config:get", () => ({
    serverUrl: store.get("serverUrl"),
    jwt: store.get("jwt"),
    jwtExpiresAt: store.get("jwtExpiresAt"),
  }));

  ipcMain.handle(
    "config:set",
    (_e, patch: Partial<ConfigShape>) => {
      if (typeof patch.serverUrl === "string") {
        // Strip trailing slashes so URL joining stays clean.
        store.set("serverUrl", patch.serverUrl.replace(/\/+$/, ""));
      }
      if (patch.jwt !== undefined) store.set("jwt", patch.jwt);
      if (patch.jwtExpiresAt !== undefined) store.set("jwtExpiresAt", patch.jwtExpiresAt);
      return {
        serverUrl: store.get("serverUrl"),
        jwt: store.get("jwt"),
        jwtExpiresAt: store.get("jwtExpiresAt"),
      };
    },
  );

  ipcMain.handle("config:clearSession", () => {
    store.set("jwt", null);
    store.set("jwtExpiresAt", null);
  });

  // File picker for the "Upload documents" button. Returns [{name,path,size}].
  ipcMain.handle("dialog:pickFiles", async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select case documents",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Case documents", extensions: ["pdf", "docx", "txt", "html", "htm"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (result.canceled) return [];
    return result.filePaths.map((p) => {
      const stat = fs.statSync(p);
      return { name: path.basename(p), path: p, size: stat.size };
    });
  });

  // Reads a picked file's raw bytes on demand; the renderer wraps them in a
  // multipart FormData for the /appeal upload endpoint.
  ipcMain.handle("file:read", async (_e, absPath: string) => {
    const buf = await fs.promises.readFile(absPath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  // Save-as dialog for the final DOCX. Renderer supplies the bytes; main
  // handles the platform-native dialog + write.
  ipcMain.handle(
    "dialog:saveDocx",
    async (_e, args: { defaultName: string; bytes: ArrayBuffer }) => {
      if (!mainWindow) return { saved: false };
      const result = await dialog.showSaveDialog(mainWindow, {
        title: "Save appeal order",
        defaultPath: args.defaultName,
        filters: [{ name: "Word document", extensions: ["docx"] }],
      });
      if (result.canceled || !result.filePath) return { saved: false };
      await fs.promises.writeFile(result.filePath, Buffer.from(args.bytes));
      return { saved: true, path: result.filePath };
    },
  );

  ipcMain.handle("app:openLog", () => {
    shell.openPath(app.getPath("logs"));
  });

  // Auto-update controls exposed to the renderer.
  ipcMain.handle("updater:check", () => {
    checkNow();
  });
  ipcMain.handle("updater:install", () => {
    quitAndInstall();
  });
  ipcMain.handle("app:version", () => app.getVersion());

  // ------------------------------------------------------------------
  // PDF preview file cache.  The renderer hands us the fetched PDF bytes;
  // we write them to a per-case temp file and hand back a file:// URL that a
  // <webview> tag loads.  Chromium's PDF viewer works reliably against
  // file:// URLs inside a webview even when it refuses blob: URLs inside a
  // sandboxed iframe.
  // ------------------------------------------------------------------
  ipcMain.handle(
    "preview:write",
    async (_e, args: { bytes: ArrayBuffer; slug: string }) => {
      const dir = path.join(os.tmpdir(), "bharattax-preview");
      await fs.promises.mkdir(dir, { recursive: true });
      const safeSlug = (args.slug || "case").replace(/[^\w-]/g, "_");
      const file = path.join(dir, `${safeSlug}.pdf`);
      await fs.promises.writeFile(file, Buffer.from(args.bytes));
      // Windows paths need forward slashes for a proper file:// URL.
      return { url: "file:///" + file.replace(/\\/g, "/") };
    },
  );

  // ------------------------------------------------------------------
  // "Open in Word" workflow.  The renderer hands us the docx bytes + a
  // session token; we write them to a temp file, open with the OS default
  // handler (usually Word), and watch the file for changes.  Each change
  // emits `manualEdit:changed` back to the renderer with the fresh bytes so
  // it can POST them to the server as a new draft version.
  // ------------------------------------------------------------------
  ipcMain.handle(
    "manualEdit:start",
    async (_e, args: { bytes: ArrayBuffer; suggestedName: string; sessionId: string }) => {
      const sessionId = args.sessionId || crypto.randomBytes(6).toString("hex");
      const dir = path.join(os.tmpdir(), "bharattax-appeal", sessionId);
      await fs.promises.mkdir(dir, { recursive: true });
      // Sanitise the suggested filename so nothing exotic ends up on disk.
      const safeName = (args.suggestedName || "draft.docx").replace(/[^\w.\-() ]/g, "_");
      const file = path.join(dir, safeName.endsWith(".docx") ? safeName : `${safeName}.docx`);
      await fs.promises.writeFile(file, Buffer.from(args.bytes));
      // Open with the OS default handler for .docx (Word / LibreOffice /
      // WordPad, whichever is registered).
      const openErr = await shell.openPath(file);
      if (openErr) {
        // Clean up and bubble the error back so the renderer can show it.
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
        throw new Error(openErr);
      }
      startWatching(sessionId, file);
      return { sessionId, path: file };
    },
  );

  ipcMain.handle("manualEdit:stop", async (_e, args: { sessionId: string }) => {
    stopWatching(args.sessionId);
  });

  ipcMain.handle("manualEdit:openContainingFolder", async (_e, args: { sessionId: string }) => {
    const session = watchers.get(args.sessionId);
    if (session) shell.showItemInFolder(session.file);
  });
}

// ---------------- file-watch bookkeeping (per session) --------------------

interface WatchSession {
  file: string;
  timer: NodeJS.Timeout | null;
  lastSize: number;
  lastMtimeMs: number;
  watcher: fs.FSWatcher | null;
}
const watchers = new Map<string, WatchSession>();

function startWatching(sessionId: string, file: string): void {
  const initial = fs.statSync(file);
  const session: WatchSession = {
    file,
    timer: null,
    lastSize: initial.size,
    lastMtimeMs: initial.mtimeMs,
    watcher: null,
  };
  const scheduleSync = () => {
    if (session.timer) clearTimeout(session.timer);
    // Word writes the file in a few bursts (temp file → rename dance), so
    // wait 1.2s of quiet before we read.  Long enough to catch the final
    // rename, short enough to feel snappy.
    session.timer = setTimeout(() => void syncOnce(sessionId), 1200);
  };
  try {
    session.watcher = fs.watch(file, { persistent: true }, scheduleSync);
    session.watcher.on("error", () => {/* fall through to polling */});
  } catch { /* fall through to polling */ }
  // Polling fallback for editors that atomically-replace the file (which
  // breaks fs.watch on some platforms).  Cheap: stat every 1.5s.
  const poller = setInterval(async () => {
    try {
      const st = await fs.promises.stat(file);
      if (st.size !== session.lastSize || st.mtimeMs !== session.lastMtimeMs) {
        session.lastSize = st.size;
        session.lastMtimeMs = st.mtimeMs;
        scheduleSync();
      }
    } catch { /* file gone temporarily during rename */ }
  }, 1500);
  (session as any).__poller = poller;
  watchers.set(sessionId, session);
}

async function syncOnce(sessionId: string): Promise<void> {
  const session = watchers.get(sessionId);
  if (!session) return;
  try {
    const buf = await fs.promises.readFile(session.file);
    if (!buf.length) return;
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.webContents.send("manualEdit:changed", {
          sessionId,
          bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          size: buf.length,
        });
      }
    }
  } catch (e: any) {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.webContents.send("manualEdit:error", { sessionId, message: String(e?.message || e) });
      }
    }
  }
}

function stopWatching(sessionId: string): void {
  const session = watchers.get(sessionId);
  if (!session) return;
  if (session.timer) clearTimeout(session.timer);
  session.watcher?.close();
  const poller = (session as any).__poller as NodeJS.Timeout | undefined;
  if (poller) clearInterval(poller);
  watchers.delete(sessionId);
  // Remove the temp directory (best-effort — Word may still hold the file
  // handle if the user hasn't closed the document).
  const dir = path.dirname(session.file);
  fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
}

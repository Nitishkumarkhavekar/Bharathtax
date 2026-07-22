import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import Store from "electron-store";

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
    // Default server URL — override at build time via BHARATTAX_SERVER_URL,
    // or the user can change it from the in-app Settings dialog.
    serverUrl: process.env.BHARATTAX_SERVER_URL || "http://localhost:8000",
    jwt: null,
    jwtExpiresAt: null,
  },
});

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f4f6fb",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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
}

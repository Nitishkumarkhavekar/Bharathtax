import { contextBridge, ipcRenderer } from "electron";

// Narrow, typed surface exposed to the renderer. The renderer NEVER touches
// Node APIs directly — everything routes through these named channels.
contextBridge.exposeInMainWorld("bharat", {
  config: {
    get: () =>
      ipcRenderer.invoke("config:get") as Promise<{
        serverUrl: string;
        jwt: string | null;
        jwtExpiresAt: string | null;
      }>,
    set: (patch: {
      serverUrl?: string;
      jwt?: string | null;
      jwtExpiresAt?: string | null;
    }) => ipcRenderer.invoke("config:set", patch),
    clearSession: () => ipcRenderer.invoke("config:clearSession"),
  },
  files: {
    pick: () =>
      ipcRenderer.invoke("dialog:pickFiles") as Promise<
        Array<{ name: string; path: string; size: number }>
      >,
    read: (absPath: string) =>
      ipcRenderer.invoke("file:read", absPath) as Promise<ArrayBuffer>,
    saveDocx: (defaultName: string, bytes: ArrayBuffer) =>
      ipcRenderer.invoke("dialog:saveDocx", { defaultName, bytes }) as Promise<{
        saved: boolean;
        path?: string;
      }>,
    saveFile: (defaultName: string, bytes: ArrayBuffer) =>
      ipcRenderer.invoke("dialog:saveFile", { defaultName, bytes }) as Promise<{
        saved: boolean;
        path?: string;
      }>,
  },
  app: {
    openLog: () => ipcRenderer.invoke("app:openLog"),
    version: () => ipcRenderer.invoke("app:version") as Promise<string>,
  },
  preview: {
    writePdf: (bytes: ArrayBuffer, slug: string, caseTitle?: string) =>
      ipcRenderer.invoke("preview:write", { bytes, slug, caseTitle }) as Promise<{ url: string; path: string }>,
  },
  drafts: {
    openFolder: () => ipcRenderer.invoke("drafts:openFolder") as Promise<void>,
    root: () => ipcRenderer.invoke("drafts:root") as Promise<string>,
  },
  updater: {
    // Subscribe to update lifecycle events. Returns an unsubscribe fn.
    on: (cb: (ev: UpdaterEvent) => void) => {
      const listener = (_e: unknown, ev: UpdaterEvent) => cb(ev);
      ipcRenderer.on("updater:event", listener);
      return () => ipcRenderer.removeListener("updater:event", listener);
    },
    // Force a check immediately (used by the "Check for updates" menu item).
    check: () => ipcRenderer.invoke("updater:check"),
    // Restart into the freshly downloaded version.
    install: () => ipcRenderer.invoke("updater:install"),
  },
  manualEdit: {
    start: (args: { bytes: ArrayBuffer; suggestedName: string; sessionId: string; caseTitle?: string }) =>
      ipcRenderer.invoke("manualEdit:start", args) as Promise<{ sessionId: string; path: string }>,
    stop: (sessionId: string) =>
      ipcRenderer.invoke("manualEdit:stop", { sessionId }) as Promise<void>,
    openContainingFolder: (sessionId: string) =>
      ipcRenderer.invoke("manualEdit:openContainingFolder", { sessionId }) as Promise<void>,
    onChanged: (cb: (ev: { sessionId: string; bytes: ArrayBuffer; size: number }) => void) => {
      const listener = (_e: unknown, ev: { sessionId: string; bytes: ArrayBuffer; size: number }) => cb(ev);
      ipcRenderer.on("manualEdit:changed", listener);
      return () => ipcRenderer.removeListener("manualEdit:changed", listener);
    },
    onError: (cb: (ev: { sessionId: string; message: string }) => void) => {
      const listener = (_e: unknown, ev: { sessionId: string; message: string }) => cb(ev);
      ipcRenderer.on("manualEdit:error", listener);
      return () => ipcRenderer.removeListener("manualEdit:error", listener);
    },
  },
});

// Mirror the shape defined in electron/updater.ts so the renderer gets nice
// autocomplete without importing anything from `electron-updater`.
type UpdaterEvent =
  | { kind: "checking" }
  | { kind: "available"; version: string; notes?: string | null }
  | { kind: "not-available"; version: string }
  | { kind: "download-progress"; percent: number; bytesPerSecond: number; transferred: number; total: number }
  | { kind: "downloaded"; version: string }
  | { kind: "error"; message: string };

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
  },
  app: {
    openLog: () => ipcRenderer.invoke("app:openLog"),
  },
});

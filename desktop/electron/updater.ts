// Auto-update handling.  On launch the app asks the BharatTax update feed
// (`GET /desktop/update/latest.yml`) whether a newer version exists.  If it
// does, the .exe is downloaded to a cache directory, and once the download
// finishes the renderer is told so the officer can restart at their leisure.
//
// Nothing about this touches the Gemini key or the license DB — the feed URL
// is public and the only artefact fetched is the signed Windows installer.
import { app, BrowserWindow } from "electron";
import type { UpdateInfo, ProgressInfo } from "electron-updater";

// electron-updater is a CommonJS module.  The typed default export sits under
// `.autoUpdater`; keeping the require makes the tsc build work without extra
// esModuleInterop gymnastics.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");

type UpdaterEvent =
  | { kind: "checking" }
  | { kind: "available"; version: string; notes?: string | null }
  | { kind: "not-available"; version: string }
  | { kind: "download-progress"; percent: number; bytesPerSecond: number; transferred: number; total: number }
  | { kind: "downloaded"; version: string }
  | { kind: "error"; message: string };

function broadcast(ev: UpdaterEvent): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("updater:event", ev);
  }
}

let started = false;

export function setupAutoUpdater(opts?: {
  autoDownload?: boolean;
  autoInstallOnQuit?: boolean;
  channel?: string;
}): void {
  // Never fight the OS packager if the app was launched from a dev build —
  // electron-updater refuses to run outside packaged apps anyway, but this
  // keeps the logs quiet.
  if (!app.isPackaged) return;
  if (started) return;
  started = true;

  autoUpdater.autoDownload = opts?.autoDownload ?? true;
  autoUpdater.autoInstallOnAppQuit = opts?.autoInstallOnQuit ?? true;
  if (opts?.channel) autoUpdater.channel = opts.channel;

  autoUpdater.on("checking-for-update", () => broadcast({ kind: "checking" }));
  autoUpdater.on("update-available", (info: UpdateInfo) => {
    broadcast({
      kind: "available",
      version: info.version,
      notes: typeof info.releaseNotes === "string" ? info.releaseNotes : null,
    });
  });
  autoUpdater.on("update-not-available", (info: UpdateInfo) => {
    broadcast({ kind: "not-available", version: info.version });
  });
  autoUpdater.on("download-progress", (p: ProgressInfo) => {
    broadcast({
      kind: "download-progress",
      percent: Math.round(p.percent),
      bytesPerSecond: Math.round(p.bytesPerSecond),
      transferred: p.transferred,
      total: p.total,
    });
  });
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    broadcast({ kind: "downloaded", version: info.version });
  });
  autoUpdater.on("error", (err: Error) => {
    broadcast({ kind: "error", message: err?.message || String(err) });
  });

  // Kick off the first check ~5s after launch so we don't fight the window
  // opening for CPU, then poll every 30 minutes so a fresh release surfaces
  // to the officer within the same working session it was published.
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((err) => {
      broadcast({ kind: "error", message: `${err?.message || err}` });
    });
  }, 5_000);
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch(() => {});
  }, 30 * 60 * 1000);
}

export function checkNow(): void {
  if (!app.isPackaged) return;
  void autoUpdater.checkForUpdates().catch((err) => {
    broadcast({ kind: "error", message: `${err?.message || err}` });
  });
}

/** Live-apply a change to updater preferences without restarting the app. */
export function applyPrefs(opts: {
  autoDownload?: boolean;
  autoInstallOnQuit?: boolean;
  channel?: string;
}): void {
  if (!app.isPackaged) return;
  if (typeof opts.autoDownload === "boolean") autoUpdater.autoDownload = opts.autoDownload;
  if (typeof opts.autoInstallOnQuit === "boolean") autoUpdater.autoInstallOnAppQuit = opts.autoInstallOnQuit;
  if (opts.channel) autoUpdater.channel = opts.channel;
}

export function quitAndInstall(): void {
  if (!app.isPackaged) return;
  // First arg = isSilent (no NSIS prompts). Second = isForceRunAfter.
  autoUpdater.quitAndInstall(false, true);
}

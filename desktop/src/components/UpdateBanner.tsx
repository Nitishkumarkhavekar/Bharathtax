import { useEffect, useState } from "react";

// Slim strip that sits below the top bar and reflects the auto-update state:
//   - Silent when there's nothing new.
//   - Shows a progress bar while the .exe downloads.
//   - Shows "Update ready — Restart to install" once the download completes.
// Users can dismiss the "ready" state; the update is applied automatically on
// the next real quit anyway.
export default function UpdateBanner() {
  const [state, setState] = useState<UpdaterEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!window.bharat?.updater) return;
    const off = window.bharat.updater.on((ev) => {
      setState(ev);
      if (ev.kind === "available" || ev.kind === "downloaded") setDismissed(false);
    });
    return off;
  }, []);

  if (!state || dismissed) return null;

  // Silent states — no visible banner.
  if (state.kind === "checking" || state.kind === "not-available") return null;

  if (state.kind === "download-progress") {
    return (
      <div className="px-6 py-2 text-xs bg-brand-50 border-b border-brand-100 text-brand-700 flex items-center gap-3">
        <div className="font-medium">Downloading update…</div>
        <div className="flex-1 h-1.5 bg-brand-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-600 transition-all duration-300"
            style={{ width: `${state.percent}%` }}
          />
        </div>
        <div className="tabular-nums">{state.percent}%</div>
      </div>
    );
  }

  if (state.kind === "available") {
    return (
      <div className="px-6 py-2 text-xs bg-brand-50 border-b border-brand-100 text-brand-700 flex items-center gap-3">
        <span>A new version <b>v{state.version}</b> is being downloaded in the background.</span>
      </div>
    );
  }

  if (state.kind === "downloaded") {
    return (
      <div className="px-6 py-2 text-xs bg-emerald-50 border-b border-emerald-200 text-emerald-800 flex items-center gap-3">
        <span>
          Update <b>v{state.version}</b> is ready. Restart to install now, or it will apply
          automatically next time you close the app.
        </span>
        <div className="flex-1" />
        <button
          onClick={() => window.bharat.updater.install()}
          className="px-2.5 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 font-medium"
        >
          Restart & install
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-emerald-700 hover:text-emerald-900 font-medium"
          title="Hide until next launch"
        >
          Later
        </button>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="px-6 py-2 text-xs bg-amber-50 border-b border-amber-200 text-amber-800 flex items-center gap-3">
        <span>Update check failed: {state.message}</span>
        <div className="flex-1" />
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-800 hover:text-amber-900 font-medium"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return null;
}

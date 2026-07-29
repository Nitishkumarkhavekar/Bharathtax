import { useEffect, useState } from "react";

// Update UX has two shapes:
//
//   - While the .exe is downloading in the background: a thin strip under
//     the top of the content pane with a progress bar (unobtrusive).
//   - Once the update is downloaded and ready to install: a prominent
//     floating toast at the bottom-right corner that stays put until the
//     officer either restarts (installs) or dismisses it for this session.
//
// The toast is styled to catch the eye — emerald accent, sparkle icon, gentle
// entrance animation — but never blocks the workspace or steals focus.  If
// the officer dismisses it, the update still applies automatically on next
// quit; the toast simply reappears on the next launch to remind them.
export default function UpdateBanner() {
  const [state, setState] = useState<UpdaterEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!window.bharat?.updater) return;
    const off = window.bharat.updater.on((ev) => {
      setState(ev);
      if (ev.kind === "available" || ev.kind === "downloaded") setDismissed(false);
    });
    return off;
  }, []);

  if (!state || dismissed) return null;

  // ----- Silent while checking / no update available.
  if (state.kind === "checking" || state.kind === "not-available") return null;

  // ----- Downloading: thin strip at the top of the content pane.
  if (state.kind === "available" || state.kind === "download-progress") {
    const percent = state.kind === "download-progress" ? state.percent : 0;
    const version = state.kind === "available" ? state.version : "";
    return (
      <div className="px-5 py-2 text-[12.5px] bg-navy-50 border-b border-navy-100 text-navy-800 flex items-center gap-3">
        <span className="relative inline-flex size-2">
          <span className="animate-ping absolute inline-flex size-full rounded-full bg-navy-500 opacity-70" />
          <span className="relative inline-flex size-2 rounded-full bg-navy-700" />
        </span>
        <div className="font-medium whitespace-nowrap">
          {state.kind === "download-progress" ? `Downloading update…` : `Update ${version ? `v${version} ` : ""}available — downloading…`}
        </div>
        <div className="flex-1 h-1.5 bg-navy-100 rounded-full overflow-hidden">
          <div className="h-full bg-navy-700 transition-all duration-300" style={{ width: `${percent}%` }} />
        </div>
        <div className="tabular-nums font-medium">{percent}%</div>
      </div>
    );
  }

  // ----- Downloaded: floating attention toast in the bottom-right corner.
  if (state.kind === "downloaded") {
    return (
      <div className="pointer-events-none fixed inset-0 z-40 flex items-end justify-end p-6">
        <div
          role="dialog"
          aria-live="polite"
          className="pointer-events-auto w-[380px] rounded-2xl bg-white ring-1 ring-emerald-200 shadow-2xl shadow-emerald-900/25 overflow-hidden animate-[updateToastIn_.35s_ease-out]"
        >
          <div className="h-1 bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-500 animate-[updatePulse_2s_ease-in-out_infinite]" />
          <div className="p-4">
            <div className="flex items-start gap-3">
              <div className="size-10 shrink-0 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center ring-4 ring-emerald-50">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold text-slate-900">
                  A new version is ready to install
                </div>
                <div className="text-[12px] text-slate-600 mt-0.5">
                  Version <b>v{state.version}</b> has been downloaded. Restart now to apply the update, or dismiss to install automatically the next time you close BharatTax.
                </div>
              </div>
              <button
                onClick={() => setDismissed(true)}
                aria-label="Dismiss update notification"
                title="Dismiss"
                className="text-slate-400 hover:text-slate-700 -mt-1 -mr-1 p-1"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={() => { setRestarting(true); window.bharat.updater.install(); }}
                disabled={restarting}
                className="flex-1 h-10 px-4 rounded-md bg-emerald-600 text-white font-semibold text-[13.5px] hover:bg-emerald-700 disabled:opacity-70 inline-flex items-center justify-center gap-2"
              >
                {restarting ? (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><circle cx="12" cy="12" r="10" opacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" /></svg>
                    Restarting…
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9" /><path d="M3 3v9h9" /></svg>
                    Restart &amp; install
                  </>
                )}
              </button>
              <button
                onClick={() => setDismissed(true)}
                className="h-10 px-3 rounded-md text-slate-600 hover:bg-slate-100 font-medium text-[13.5px]"
              >
                Later
              </button>
            </div>
          </div>
        </div>
        {/* Keyframes for the toast — kept inline so we don't leak into
            global CSS and don't need a Tailwind plugin. */}
        <style>{`
          @keyframes updateToastIn {
            from { opacity: 0; transform: translateY(24px) scale(0.98); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes updatePulse {
            0%, 100% { opacity: 0.9; }
            50%      { opacity: 0.55; }
          }
        `}</style>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="px-5 py-2 text-[12.5px] bg-amber-50 border-b border-amber-200 text-amber-800 flex items-center gap-3">
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

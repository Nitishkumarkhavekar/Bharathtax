import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, ShieldAlert, X } from "lucide-react";

export type ConfirmTone = "danger" | "warning" | "primary";

export interface ConfirmOptions {
  /** Big bold headline. */
  title: string;
  /** Prose body — accepts plain text or a ReactNode (for lists, `<b>`s, …). */
  description?: ReactNode;
  /** Label on the confirmation button. Defaults to a sensible verb per tone. */
  confirmLabel?: string;
  /** Label on the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Visual tone — controls the icon, gradient border and button colour.
   *  `danger`  → rose (destructive: delete, clear all)
   *  `warning` → amber (interrupt: stop pipeline, discard edits)
   *  `primary` → blue (neutral confirmation)
   */
  tone?: ConfirmTone;
  /** Detail row(s) shown under the description in a subtle boxed block. */
  detail?: ReactNode;
  /**
   * Extra confirmation guard — the user must type this exact string into the
   * "type to confirm" field before the confirm button unlocks. Useful for
   * irreversible destructive ops.
   */
  confirmPhrase?: string;
}

interface State extends ConfirmOptions {
  open: boolean;
  resolve: (v: boolean) => void;
}

/**
 * `useConfirm()` — replaces `window.confirm(...)` with an on-brand modal
 * dialog. Returns:
 *
 *   const { confirm, dialog } = useConfirm();
 *   // ...
 *   if (await confirm({ title: "Delete …", tone: "danger" })) { ... }
 *   return <>{dialog}...</>
 *
 * Render `{dialog}` once anywhere in the component tree — it manages its
 * own portal, so placement doesn't matter visually.
 */
export function useConfirm() {
  const [state, setState] = useState<State>({
    open: false,
    title: "",
    resolve: () => {},
  });

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, resolve, ...opts });
    });
  }, []);

  const close = useCallback(
    (result: boolean) => {
      state.resolve(result);
      setState((s) => ({ ...s, open: false }));
    },
    [state],
  );

  const dialog = state.open ? (
    <ConfirmDialog
      title={state.title}
      description={state.description}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      tone={state.tone ?? "primary"}
      detail={state.detail}
      confirmPhrase={state.confirmPhrase}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  ) : null;

  return { confirm, dialog };
}

const TONE: Record<
  ConfirmTone,
  {
    icon: typeof AlertTriangle;
    iconRing: string;
    iconWash: string;
    haloGradient: string;
    button: string;
    verb: string;
  }
> = {
  danger: {
    icon: AlertTriangle,
    iconRing: "ring-rose-200",
    iconWash: "bg-rose-100 text-rose-600",
    haloGradient: "bg-rose-500/25",
    button:
      "text-white bg-rose-600 hover:brightness-110 shadow-lg shadow-rose-500/30",
    verb: "Delete",
  },
  warning: {
    icon: ShieldAlert,
    iconRing: "ring-amber-200",
    iconWash: "bg-amber-100 text-amber-700",
    haloGradient: "bg-amber-500/25",
    button:
      "text-white bg-amber-600 hover:brightness-110 shadow-lg shadow-amber-500/30",
    verb: "Continue",
  },
  primary: {
    icon: ShieldAlert,
    iconRing: "ring-primary/25",
    iconWash: "bg-accent text-primary",
    haloGradient: "bg-primary/25",
    button:
      "text-white bg-primary hover:brightness-110 shadow-lg shadow-primary/25",
    verb: "Confirm",
  },
};

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "primary",
  detail,
  confirmPhrase,
  onCancel,
  onConfirm,
}: ConfirmOptions & {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const meta = TONE[tone];
  const Icon = meta.icon;
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const phraseOk = !confirmPhrase || phrase === confirmPhrase;

  // Focus the confirm button on open (or the phrase input when required),
  // then trap ESC to cancel — matches native `confirm()` semantics but with
  // proper keyboard UX.
  useEffect(() => {
    if (!confirmPhrase) confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && phraseOk && !busy) {
        // Only auto-fire enter when the confirm button is focused OR no
        // phrase is required (so the modal doesn't fight typing into the
        // phrase input).
        if (!confirmPhrase || document.activeElement === confirmRef.current) {
          e.preventDefault();
          runConfirm();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phraseOk, busy]);

  function runConfirm() {
    if (!phraseOk || busy) return;
    setBusy(true);
    // Let the parent's onConfirm handle the actual work.
    onConfirm();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-up"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={(e) => {
        // Backdrop click cancels — but not clicks originating inside the card.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="relative w-full max-w-md">
        <div className="relative rounded-2xl bg-white ring-1 ring-slate-200 shadow-xl overflow-hidden">
          <button
            onClick={onCancel}
            className="absolute right-3 top-3 p-1.5 rounded-md text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div
                className={
                  "shrink-0 size-12 rounded-2xl ring-1 flex items-center justify-center " +
                  meta.iconRing +
                  " " +
                  meta.iconWash
                }
              >
                <Icon className="size-6" />
              </div>
              <div className="min-w-0 flex-1 pr-6">
                <h2
                  id="confirm-title"
                  className="text-[16px] font-semibold text-slate-900 leading-tight"
                >
                  {title}
                </h2>
                {description && (
                  <div className="mt-1.5 text-[13.5px] text-slate-600 leading-relaxed">
                    {description}
                  </div>
                )}
              </div>
            </div>

            {detail && (
              <div className="mt-4 rounded-xl bg-slate-50 ring-1 ring-slate-200 px-3.5 py-2.5 text-[12.5px] text-slate-700">
                {detail}
              </div>
            )}

            {confirmPhrase && (
              <div className="mt-4">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Type <span className="font-mono text-slate-800">{confirmPhrase}</span> to confirm
                </label>
                <input
                  autoFocus
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 px-6 py-3.5 bg-slate-50 border-t border-slate-200">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="inline-flex items-center justify-center h-9 px-4 rounded-lg text-[13px] font-medium text-slate-700 bg-white ring-1 ring-slate-200 hover:bg-slate-100 hover:text-slate-900 transition-colors disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmRef}
              type="button"
              onClick={runConfirm}
              disabled={!phraseOk || busy}
              className={
                "inline-flex items-center justify-center gap-1.5 h-9 px-5 rounded-lg text-[13px] font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed " +
                meta.button
              }
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {confirmLabel || meta.verb}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

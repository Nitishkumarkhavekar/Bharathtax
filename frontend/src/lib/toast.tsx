// Lightweight global toast notifications — no external dependency.
// Imperative singleton API so ANY code (event handlers, api calls) can fire a
// toast without threading a context/hook:  toast.success("User created").
// Mount <Toaster /> once near the app root.

import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

export type ToastKind = "success" | "error" | "info";
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

let _seq = 0;
let _toasts: ToastItem[] = [];
const _listeners = new Set<(t: ToastItem[]) => void>();

function _emit() {
  for (const l of _listeners) l(_toasts);
}

function dismiss(id: number) {
  _toasts = _toasts.filter((t) => t.id !== id);
  _emit();
}

function push(kind: ToastKind, message: string, ms: number) {
  const msg = (message || "").toString().trim();
  if (!msg) return;
  const id = ++_seq;
  _toasts = [..._toasts, { id, kind, message: msg }].slice(-5);
  _emit();
  if (ms > 0) window.setTimeout(() => dismiss(id), ms);
}

export const toast = {
  success: (m: string) => push("success", m, 4000),
  error: (m: string) => push("error", m, 6000),
  info: (m: string) => push("info", m, 4000),
  message: (m: string) => push("info", m, 4000),
};

const CFG: Record<ToastKind, { Icon: typeof Info; ring: string; icon: string }> = {
  success: { Icon: CheckCircle2, ring: "ring-emerald-200", icon: "text-emerald-600" },
  error: { Icon: AlertCircle, ring: "ring-rose-200", icon: "text-rose-600" },
  info: { Icon: Info, ring: "ring-slate-200", icon: "text-primary" },
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>(_toasts);
  useEffect(() => {
    _listeners.add(setItems);
    setItems(_toasts);
    return () => {
      _listeners.delete(setItems);
    };
  }, []);
  if (!items.length) return null;
  return (
    <div className="fixed z-[200] bottom-4 right-4 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none">
      {items.map((t) => {
        const { Icon, ring, icon } = CFG[t.kind];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl bg-white shadow-lg ring-1 ${ring} px-3.5 py-2.5 animate-fade-up`}
          >
            <Icon className={`size-4 mt-0.5 shrink-0 ${icon}`} />
            <div className="flex-1 text-[13px] text-slate-700 leading-snug">{t.message}</div>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-slate-400 hover:text-slate-700"
              aria-label="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

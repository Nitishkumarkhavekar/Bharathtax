import { useEffect, useState } from "react";
import { HelpCircle, X, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { PAGE_HELP } from "@/lib/pageHelp";

/**
 * A "How to use" affordance for a page header. Shows a small button that opens a
 * concise, consistent panel — what the feature is, when to use it, and the
 * steps — so an officer (or a tester) can always find out what a page does
 * without leaving it. Content lives in lib/pageHelp.ts, keyed by `id`.
 */
export default function PageHelp({ id, className, compact }: { id: string; className?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const h = PAGE_HELP[id];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!h) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="How to use this"
        aria-label="How to use this page"
        className={cn(
          "inline-flex items-center gap-1.5 h-8 rounded-lg text-[12.5px] font-semibold text-slate-500 ring-1 ring-slate-200 bg-white hover:bg-slate-50 hover:text-primary hover:ring-primary/30 transition-colors",
          compact ? "px-2" : "px-2.5",
          className,
        )}
      >
        <HelpCircle className="size-4" />
        {!compact && <span>How to use</span>}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`How to use — ${h.title}`}
          >
            <div className="relative p-6 pb-5">
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="absolute top-3 right-3 p-1.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="size-4" />
              </button>
              <div className="size-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-3.5">
                <HelpCircle className="size-5" />
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">How to use</div>
              <h2 className="text-lg font-bold text-slate-900 mt-0.5">{h.title}</h2>

              <p className="mt-3 text-[13.5px] text-slate-700 leading-relaxed">{h.what}</p>

              <div className="mt-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400 mb-1">When to use it</div>
                <p className="text-[13px] text-slate-600 leading-relaxed">{h.when}</p>
              </div>

              <div className="mt-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400 mb-1.5">How to use it</div>
                <ol className="space-y-1.5">
                  {h.how.map((step, i) => (
                    <li key={i} className="flex gap-2.5 text-[13px] text-slate-700 leading-relaxed">
                      <span className="shrink-0 mt-0.5 size-4 rounded-full bg-primary/10 text-primary text-[10px] font-bold grid place-items-center tabular-nums">{i + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {h.example && (
                <div className="mt-4 flex gap-2 rounded-lg bg-amber-50 ring-1 ring-amber-200/70 px-3 py-2.5">
                  <Lightbulb className="size-4 shrink-0 mt-0.5 text-amber-600" />
                  <p className="text-[12.5px] text-amber-900 leading-relaxed">{h.example}</p>
                </div>
              )}
              {h.note && (
                <p className="mt-3 text-[12px] text-slate-500 italic">{h.note}</p>
              )}
            </div>
            <div className="flex justify-end px-6 py-3.5 border-t border-slate-100">
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg bg-primary text-white text-[13px] font-semibold px-4 py-2 hover:bg-primary/90 transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

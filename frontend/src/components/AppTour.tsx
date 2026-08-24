import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  X, ArrowRight, ArrowLeft, Sparkles, MessageSquareText, CalendarClock,
  Bell, StickyNote, Calculator, Scale, Gavel,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { icon: <Sparkles />, title: "Welcome to BharatTax", body: "Your citation-grounded AI desk for Indian income tax — research, drafting, and a daily workspace that keeps your deadlines. Here's a quick tour." },
  { icon: <MessageSquareText />, title: "Ask, with citations", body: "Ask any tax question in plain English, or upload a notice or order. Every answer links to the exact section, rule, circular or judgment — and refuses to guess when the law isn't there." },
  { icon: <CalendarClock />, title: "Your Calendar & matters", body: "Track each case by PAN and AY. Enter one trigger date and BharatTax computes every statutory deadline — time-barring, appeal windows, the DRP clock — each section-cited." },
  { icon: <Bell />, title: "Never miss a deadline", body: "The notification bell surfaces due reminders the moment they fire, so nothing goes time-barred on your watch." },
  { icon: <StickyNote />, title: "Notes & templates", body: "Pin colour-coded notes to a matter or a section, and keep your reusable notice, order and appeal templates a click away." },
  { icon: <Calculator />, title: "Statutory calculators", body: "Interest u/s 234A/B/C & 220(2), tax u/s 115BBE, slab tax and capital gains — each showing the workings." },
  { icon: <Scale />, title: "Reconcile & watchlists", body: "Match 26AS against AIS to flag the genuine mismatches, and watchlist a section or assessee to jump to fresh rulings." },
  { icon: <Gavel />, title: "Appeals & rulings", body: "Draft CIT(A) / NFAC orders in six auditable modules, and search Supreme Court, High Court and ITAT case law with paragraph-level citations." },
];

/** Controlled welcome tour. The parent persists the "seen" flag. */
export default function AppTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [i, setI] = useState(0);

  useEffect(() => { if (open) setI(0); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, STEPS.length - 1));
      else if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const finish = () => { onClose(); nav("/workspace"); };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Product tour">
        <div className="relative p-6 pb-5">
          <button onClick={onClose} aria-label="Close tour"
            className="absolute top-3 right-3 p-1.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="size-4" />
          </button>
          <div className="size-12 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4 [&_svg]:size-6">{step.icon}</div>
          <h2 className="text-lg font-bold text-slate-900">{step.title}</h2>
          <p className="mt-1.5 text-[13.5px] text-slate-600 leading-relaxed">{step.body}</p>
        </div>
        <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-100">
          <div className="flex gap-1.5" aria-hidden>
            {STEPS.map((_, k) => (
              <span key={k} className={cn("h-1.5 rounded-full transition-all", k === i ? "w-5 bg-primary" : "w-1.5 bg-slate-200")} />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {i === 0 && (
              <button onClick={onClose} className="text-[13px] font-semibold text-slate-400 hover:text-slate-600 px-2 py-1.5">Skip</button>
            )}
            {i > 0 && (
              <button onClick={() => setI(i - 1)} className="inline-flex items-center gap-1 text-[13px] font-semibold text-slate-500 hover:text-slate-800 px-2 py-1.5">
                <ArrowLeft className="size-4" /> Back
              </button>
            )}
            <button onClick={last ? finish : () => setI(i + 1)}
              className="inline-flex items-center gap-1 rounded-lg bg-primary text-white text-[13px] font-semibold px-3.5 py-2 hover:bg-primary/90">
              {last ? "Open my desk" : "Next"} <ArrowRight className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

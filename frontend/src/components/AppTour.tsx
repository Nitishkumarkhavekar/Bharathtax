import { useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  X, ArrowRight, ArrowLeft, Sparkles, MessageSquareText, CalendarClock,
  Bell, ScrollText, Calculator, Scale, Gavel,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Step {
  icon: ReactNode;
  title: string;
  body: string;
  target?: string;                 // CSS selector to spotlight; absent = centered card
  side?: "right" | "bottom";       // where the tooltip sits relative to the target
}

// The tour walks DOWN the sidebar, spotlighting each real feature in turn, so
// the officer sees exactly where everything lives — not just a floating blurb.
const STEPS: Step[] = [
  { icon: <Sparkles />, title: "Welcome to BharatTax", body: "Your citation-grounded AI desk for Indian income tax — research, drafting, and a daily workspace that keeps your deadlines. Here's a 30-second tour of where everything lives." },
  { icon: <MessageSquareText />, target: '[data-tour="new-chat"]', title: "Ask, with citations", body: "Start a chat here. Ask any tax question in plain English — or upload a notice or order — and every answer links to the exact section, rule, circular or judgment, refusing to guess when the law isn't there." },
  { icon: <CalendarClock />, target: '[data-tour="/workspace"]', title: "Your Calendar & matters", body: "Track each case by PAN and AY. Enter one trigger date and every statutory deadline is computed for you — time-barring, appeal windows, the DRP clock — each section-cited." },
  { icon: <Bell />, target: '[data-tour="bell"]', side: "bottom", title: "Never miss a deadline", body: "The bell surfaces your due reminders the moment they fire, so nothing goes time-barred on your watch." },
  { icon: <ScrollText />, target: '[data-tour="/drafting"]', title: "Drafting", body: "Every kind of drafting in one place — assessment orders, CIT(A)/NFAC appellate orders and notices — cited to primary law and exported to editable Word." },
  { icon: <Calculator />, target: '[data-tour="/calculators"]', title: "Statutory calculators", body: "Interest u/s 234A/B/C & 220(2), tax u/s 115BBE, the ALP/TP range, peak credit and more — each showing the workings." },
  { icon: <Scale />, target: '[data-tour="/reconcile"]', title: "Reconcile & scan", body: "Match 26AS against AIS to flag the genuine mismatches, and scan a transaction list for Rule 114E high-value (SFT) reporting." },
  { icon: <Gavel />, target: '[data-tour="/rulings"]', title: "Case law", body: "Search Supreme Court, High Court and ITAT judgments with paragraph-level citations — and watchlist a section to follow fresh rulings." },
  { icon: <Sparkles />, title: "You're all set", body: "That's the tour. Look for the “How to use” button on any page for a refresher — and you can re-open this tour anytime from the help icon in the header." },
];

const TIP_W = 340;

function tipStyle(rect: DOMRect, side?: "right" | "bottom"): CSSProperties {
  const gap = 14, pad = 10;
  const vw = window.innerWidth, vh = window.innerHeight;
  let top: number, left: number;
  if (side === "bottom") {
    top = rect.bottom + gap; left = rect.left;
  } else {
    left = rect.right + gap; top = rect.top;
    if (left + TIP_W + pad > vw) { left = rect.left; top = rect.bottom + gap; } // no room right → below
  }
  left = Math.max(pad, Math.min(left, vw - TIP_W - pad));
  top = Math.max(pad, Math.min(top, vh - 250));
  return { position: "absolute", top, left, width: TIP_W };
}

/** Controlled spotlight tour. The parent persists the "seen" flag. */
export default function AppTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  useEffect(() => { if (open) setI(0); }, [open]);

  // Measure (and keep re-measuring) the current step's target.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      if (!step?.target) { setRect(null); return; }
      const el = document.querySelector(step.target) as HTMLElement | null;
      if (!el) { setRect(null); return; }
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const r = el.getBoundingClientRect();
      // Off-screen / not laid out (e.g. sidebar collapsed on mobile) → centered.
      if (r.width < 1 || r.right < 0 || r.left > window.innerWidth) { setRect(null); return; }
      setRect(r);
    };
    const t = window.setTimeout(measure, 60); // let scroll settle
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, i, step?.target]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "Enter") setI((x) => Math.min(x + 1, STEPS.length - 1));
      else if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const Card = (
    <div className="rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 overflow-hidden pointer-events-auto">
      <div className="relative p-5 pb-4">
        <button onClick={onClose} aria-label="Close tour"
          className="absolute top-3 right-3 p-1.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <X className="size-4" />
        </button>
        <div className="size-11 rounded-xl bg-primary/10 text-primary grid place-items-center mb-3 [&_svg]:size-5">{step.icon}</div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Step {i + 1} of {STEPS.length}</div>
        <h2 className="text-[17px] font-bold text-slate-900 mt-0.5">{step.title}</h2>
        <p className="mt-1.5 text-[13.5px] text-slate-600 leading-relaxed">{step.body}</p>
      </div>
      <div className="flex items-center gap-3 px-5 py-3.5 border-t border-slate-100">
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
          <button onClick={last ? onClose : () => setI(i + 1)}
            className="inline-flex items-center gap-1 rounded-lg bg-primary text-white text-[13px] font-semibold px-3.5 py-2 hover:bg-primary/90">
            {last ? "Done" : "Next"} {!last && <ArrowRight className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Interaction blocker — stops clicks reaching the app during the tour. */}
      <div className="absolute inset-0" />
      {rect ? (
        <>
          {/* Spotlight — dims everything except the highlighted element. */}
          <div
            className="absolute rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-transparent transition-all duration-300 pointer-events-none"
            style={{
              top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12,
              boxShadow: "0 0 0 9999px rgba(15,23,42,0.62)",
            }}
          />
          <div style={tipStyle(rect, step.side)} className="max-w-[calc(100vw-1.25rem)]">{Card}</div>
        </>
      ) : (
        <div className="absolute inset-0 bg-slate-900/55 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md">{Card}</div>
        </div>
      )}
    </div>
  );
}

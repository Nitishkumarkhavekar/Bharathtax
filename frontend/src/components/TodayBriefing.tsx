import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlarmClock, ArrowRight, X } from "lucide-react";
import { api, WsWorkload } from "../api";

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/**
 * The daily hook. On the chat landing, greet the officer with what needs them
 * TODAY — overdue items and deadlines due this week, plus the nearest one — so
 * BharatTax owns the one thing an officer can't afford to miss (a case going
 * time-barred). Only shows when there's something due; dismissible for the day.
 */
export default function TodayBriefing() {
  const [data, setData] = useState<WsWorkload | null>(null);
  const dayKey = "bt_today_dismissed_" + new Date().toISOString().slice(0, 10);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(dayKey) === "1"; } catch { return false; }
  });

  useEffect(() => {
    let alive = true;
    api.wsWorkload().then((d) => { if (alive) setData(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (dismissed || !data) return null;
  const overdue = data.summary.overdue;
  const week = data.summary.due_7;
  if (overdue === 0 && week === 0) return null;

  const next = data.matters
    .filter((m) => m.next_due_date)
    .sort((a, b) => (a.next_due_date! < b.next_due_date! ? -1 : 1))[0];

  const dismiss = () => {
    try { localStorage.setItem(dayKey, "1"); } catch { /* */ }
    setDismissed(true);
  };

  return (
    <div className="flex items-center gap-3 rounded-xl bg-white ring-1 ring-slate-200 shadow-sm px-4 py-2.5 text-left">
      <div className="size-9 rounded-lg bg-rose-50 text-rose-600 grid place-items-center shrink-0">
        <AlarmClock className="size-[18px]" />
      </div>
      <div className="min-w-0 flex-1 text-[13px] leading-snug">
        <span className="font-semibold text-slate-900">Your desk today</span>{" — "}
        {overdue > 0 && <span className="text-rose-600 font-semibold">{overdue} overdue</span>}
        {overdue > 0 && week > 0 && <span className="text-slate-400"> · </span>}
        {week > 0 && <span className="text-amber-600 font-semibold">{week} due this week</span>}
        {next?.next_due_date && (
          <span className="text-slate-500">
            {" · Next: "}{next.next_label || "deadline"}
            {next.next_section ? ` (${next.next_section})` : ""} on {fmtDate(next.next_due_date)}
          </span>
        )}
      </div>
      <Link to="/workspace" className="shrink-0 inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline">
        Open desk <ArrowRight className="size-3.5" />
      </Link>
      <button onClick={dismiss} title="Dismiss for today" aria-label="Dismiss for today"
        className="shrink-0 p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100">
        <X className="size-4" />
      </button>
    </div>
  );
}

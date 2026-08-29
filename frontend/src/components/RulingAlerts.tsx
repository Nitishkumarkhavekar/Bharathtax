import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Scale, ArrowRight, X } from "lucide-react";
import { api, RulingAlerts as TRulingAlerts } from "../api";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

/**
 * "Fresh law for you" — the addiction hook a generic chatbot can't offer.
 * BharatTax knows the sections THIS officer works on (auto-inferred from their
 * chats, cases and docket; wing defaults for a new account) and surfaces newly
 * ingested case law on exactly those sections. Shows only when there's a match;
 * dismissible for the day, like the deadline briefing above it.
 */
export default function RulingAlerts() {
  const [data, setData] = useState<TRulingAlerts | null>(null);
  const dayKey = "bt_rulings_dismissed_" + new Date().toISOString().slice(0, 10);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(dayKey) === "1"; } catch { return false; }
  });

  useEffect(() => {
    let alive = true;
    api.rulingAlerts().then((d) => { if (alive) setData(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (dismissed || !data || data.items.length === 0) return null;

  const items = data.items.slice(0, 3);
  const more = data.items.length - items.length;
  const anyFresh = data.fresh_count > 0;

  const dismiss = () => {
    try { localStorage.setItem(dayKey, "1"); } catch { /* */ }
    setDismissed(true);
  };

  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden text-left">
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100">
        <div className="size-9 rounded-lg bg-indigo-50 text-primary grid place-items-center shrink-0">
          <Scale className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-slate-900 leading-tight">
            {anyFresh ? "New rulings on your topics" : "Rulings on your topics"}
          </div>
          <div className="text-[11.5px] text-slate-500 leading-tight truncate">
            {data.source === "function" ? "For your function · " : "From your work · "}
            {data.sections.slice(0, 6).map((s) => "§" + s).join("  ")}
          </div>
        </div>
        <Link to="/rulings"
          className="shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline">
          Case Law <ArrowRight className="size-3.5" />
        </Link>
        <button onClick={dismiss} title="Dismiss for today" aria-label="Dismiss for today"
          className="shrink-0 p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100">
          <X className="size-4" />
        </button>
      </div>

      {/* rulings */}
      <ul className="divide-y divide-slate-100">
        {items.map((it) => (
          <li key={it.id}>
            <a href={it.source_url ?? undefined} target="_blank" rel="noreferrer"
              className="block px-4 py-2.5 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-semibold text-slate-800 truncate">{it.title}</span>
                {it.fresh && (
                  <span className="shrink-0 text-[9.5px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                    New
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-slate-600 leading-snug"
                style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {it.digest}
              </p>
              <div className="mt-1 flex items-center gap-1.5 text-[10.5px]">
                {it.matched.slice(0, 3).map((s) => (
                  <span key={s} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">§{s}</span>
                ))}
                {it.date && <span className="ml-auto tabular-nums text-slate-400">{fmtDate(it.date)}</span>}
              </div>
            </a>
          </li>
        ))}
      </ul>

      {more > 0 && (
        <Link to="/rulings"
          className="block px-4 py-2 text-[12px] font-medium text-primary hover:bg-slate-50 border-t border-slate-100">
          +{more} more on your topics →
        </Link>
      )}
    </div>
  );
}

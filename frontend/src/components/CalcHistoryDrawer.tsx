import { useMemo, useState, useEffect } from "react";
import { X, History, Trash2, ArrowUpRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { CalcHistoryEntry, CalcTab } from "@/lib/calcHistory";

// Right-side drawer listing saved calculator history. Paginated 10 per
// page. Clicking a row restores the entry into the calculator and closes
// the drawer.

const TAB_LABEL: Record<CalcTab, string> = {
  interest: "Interest", "234c": "234C", tds: "TDS", recovery: "Recovery",
  trust: "Trust", peak: "Peak credit", alp: "ALP / TP", bbe: "115BBE",
  slab: "Slab tax", capgains: "Cap. gains", penalty: "Penalty",
};

const TAB_TONE: Record<CalcTab, string> = {
  interest: "bg-blue-50 text-blue-700 ring-blue-200",
  "234c": "bg-sky-50 text-sky-700 ring-sky-200",
  tds: "bg-orange-50 text-orange-700 ring-orange-200",
  recovery: "bg-rose-50 text-rose-700 ring-rose-200",
  trust: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  peak: "bg-amber-50 text-amber-700 ring-amber-200",
  alp: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
  bbe: "bg-violet-50 text-violet-700 ring-violet-200",
  slab: "bg-primary/10 text-primary ring-primary/20",
  capgains: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  penalty: "bg-red-50 text-red-700 ring-red-200",
};

function relTime(ms: number): string {
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ms).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

interface Props {
  open: boolean;
  entries: CalcHistoryEntry[];
  onClose: () => void;
  onRestore: (entry: CalcHistoryEntry) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
}

const PAGE_SIZE = 10;

export default function CalcHistoryDrawer({
  open, entries, onClose, onRestore, onRemove, onClearAll,
}: Props) {
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");

  // Reset to page 0 whenever the drawer opens or the search changes.
  useEffect(() => { setPage(0); }, [open, q]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    if (!q.trim()) return entries;
    const needle = q.trim().toLowerCase();
    return entries.filter((e) =>
      TAB_LABEL[e.tab].toLowerCase().includes(needle) ||
      e.summary.toLowerCase().includes(needle),
    );
  }, [entries, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(
    clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE,
  );

  if (!open) return null;

  return (
    <>
      {/* Light backdrop — the calculator remains visible so the user can
          orient themselves; clicking anywhere on it dismisses. */}
      <div
        className="fixed inset-0 z-[90] bg-slate-900/20"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label="Calculator history"
        className={cn(
          "fixed top-0 right-0 z-[100] h-full w-full max-w-md bg-white",
          "shadow-2xl ring-1 ring-slate-200 flex flex-col",
          "animate-in slide-in-from-right-4 duration-200",
        )}
      >
        <header className="p-5 border-b border-slate-100 shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="size-10 rounded-xl bg-primary/10 text-primary grid place-items-center">
                <History className="size-5" />
              </div>
              <div>
                <h2 className="text-[15px] font-bold text-slate-900">Calculation history</h2>
                <p className="text-[12px] text-slate-500 mt-0.5">
                  {entries.length} entries saved on this device
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-3 relative">
            <Search className="size-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by calculator or amount…"
              className="pl-9 h-9 text-[13px]"
            />
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {pageItems.length === 0 ? (
            <div className="p-10 text-center">
              <History className="size-8 text-slate-300 mx-auto mb-3" />
              <div className="text-sm font-semibold text-slate-700">
                {entries.length === 0 ? "No history yet" : "Nothing matches"}
              </div>
              <p className="text-[12.5px] text-slate-500 mt-1">
                {entries.length === 0
                  ? "Compute a value and it'll appear here — click to reload the inputs later."
                  : "Try a different search term."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pageItems.map((e) => (
                <li key={e.id} className="group flex items-start gap-2 p-4 hover:bg-slate-50 transition-colors">
                  <button
                    onClick={() => onRestore(e)}
                    className="flex-1 min-w-0 text-left"
                    title="Reload these inputs into the calculator"
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-[10.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ring-1",
                        TAB_TONE[e.tab],
                      )}>{TAB_LABEL[e.tab]}</span>
                      <span className="text-[11px] text-slate-400 tabular-nums">{relTime(e.at)}</span>
                    </div>
                    <div className="mt-1 text-[13.5px] font-semibold text-slate-900 group-hover:text-primary line-clamp-2">
                      {e.summary}
                    </div>
                  </button>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => onRestore(e)}
                      title="Load into calculator"
                      className="p-1.5 rounded-md text-slate-400 hover:text-primary hover:bg-primary/5"
                    >
                      <ArrowUpRight className="size-4" />
                    </button>
                    <button
                      onClick={() => onRemove(e.id)}
                      title="Delete this entry"
                      className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-slate-100 shrink-0 bg-white p-3 flex items-center justify-between text-[12.5px]">
          <button
            onClick={onClearAll}
            disabled={entries.length === 0}
            className="text-slate-500 hover:text-red-600 disabled:opacity-40 disabled:hover:text-slate-500 font-medium"
          >
            Clear all
          </button>
          {filtered.length > PAGE_SIZE && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={clampedPage === 0}
                className="h-7 px-2 rounded text-slate-600 ring-1 ring-slate-200 disabled:opacity-40 hover:bg-slate-100"
              >Prev</button>
              <span className="tabular-nums text-slate-500">
                Page {clampedPage + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={clampedPage >= totalPages - 1}
                className="h-7 px-2 rounded text-slate-600 ring-1 ring-slate-200 disabled:opacity-40 hover:bg-slate-100"
              >Next</button>
            </div>
          )}
        </footer>
      </aside>
    </>
  );
}

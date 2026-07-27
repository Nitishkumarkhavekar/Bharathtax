import { useEffect, useMemo, useState } from "react";
import {
  Clock,
  Trash2,
  Eraser,
  User2,
  ChevronLeft,
  ChevronRight,
  MessageSquareText,
  Gavel,
  FileText,
  LogIn,
  Sparkles,
} from "lucide-react";
import { HistoryItem, HistoryKind, HistoryCounts, api } from "../api";
import { useAuth } from "../auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/ConfirmDialog";

export default function History() {
  const { session } = useAuth();
  const { confirm, dialog } = useConfirm();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [counts, setCounts] = useState<HistoryCounts | null>(null);
  const [kind, setKind] = useState<HistoryKind>("all");
  const [loading, setLoading] = useState(true);
  const [busyClear, setBusyClear] = useState(false);
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  const email = useMemo(() => session?.username || "", [session]);

  async function refresh(k: HistoryKind = kind) {
    setLoading(true);
    try {
      const [rows, c] = await Promise.all([
        api.history(k, 200),
        api.historyCounts(),
      ]);
      setItems(rows);
      setCounts(c);
    } catch {
      /* transient — leave list as-is */
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh(kind);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  async function deleteOne(id: string) {
    const ok = await confirm({
      title: "Delete this history entry?",
      description:
        "This row will be permanently removed from your activity feed. Other users' history is unaffected.",
      tone: "danger",
      confirmLabel: "Delete entry",
    });
    if (!ok) return;
    setDeleting((d) => ({ ...d, [id]: true }));
    try {
      await api.historyDelete(id);
      setItems((prev) => prev.filter((r) => r.id !== id));
    } catch {
      alert("Could not delete this row. Please try again.");
    } finally {
      setDeleting((d) => {
        const nxt = { ...d };
        delete nxt[id];
        return nxt;
      });
    }
  }

  async function clearAll() {
    const scopeLabel = kind === "all" ? "your entire history" : `all ${kind} entries`;
    const ok = await confirm({
      title: `Clear ${scopeLabel}?`,
      description:
        kind === "all"
          ? "Every entry in your activity feed — queries, appeal events, document events, sessions — will be permanently removed."
          : `Every ${kind} entry in your activity feed will be permanently removed. Other kinds are untouched.`,
      tone: "danger",
      confirmLabel: kind === "all" ? "Clear all history" : `Clear ${kind}`,
      confirmPhrase: kind === "all" ? "clear all" : undefined,
    });
    if (!ok) return;
    setBusyClear(true);
    try {
      await api.historyClear(kind);
      await refresh(kind);
    } catch {
      alert("Could not clear history. Please try again.");
    } finally {
      setBusyClear(false);
    }
  }

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const paged = items.slice(pageStart, pageStart + pageSize);

  return (
    <div className="space-y-5">
      {dialog}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold flex items-center gap-2">
            <Clock className="size-5 text-primary" />
            Activity History
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Only your own activity — queries, appeal-case events, document
            events. Never shared with other users.
          </p>
          {email && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-slate-600 bg-slate-100 rounded-full px-2.5 py-1 ring-1 ring-slate-200">
              <User2 className="size-3.5 text-slate-500" />
              Signed in as <span className="font-medium text-slate-800">{email}</span>
            </div>
          )}
        </div>
        {items.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearAll}
            disabled={busyClear}
            className="text-rose-700 hover:bg-rose-50 hover:text-rose-800 border-rose-200"
          >
            <Eraser className="size-4" />
            {busyClear ? "Clearing…" : kind === "all" ? "Clear my history" : `Clear ${kind}`}
          </Button>
        )}
      </div>

      <FilterChips value={kind} onChange={setKind} counts={counts} />

      {loading && (
        <p className="text-sm text-muted-foreground">Loading your history…</p>
      )}

      {items.length > 0 && (
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <div className="tabular-nums">
            <span className="font-medium text-slate-700">{items.length}</span>{" "}
            {items.length === 1 ? "entry" : "entries"}
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="hist-page-size">Rows per page</label>
            <select
              id="hist-page-size"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="h-7 rounded-md border border-slate-200 bg-white px-1.5 tabular-nums"
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {paged.map((it) => (
          <HistoryRow
            key={it.id}
            it={it}
            deleting={!!deleting[it.id]}
            onDelete={() => deleteOne(it.id)}
          />
        ))}
        {!loading && items.length === 0 && (
          <div className="rounded-2xl bg-white border border-dashed border-slate-300 p-10 text-center">
            <div className="mx-auto size-12 rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15 flex items-center justify-center mb-3">
              <Clock className="size-5" />
            </div>
            <div className="text-[14px] font-semibold text-slate-900">
              Nothing here yet
            </div>
            <div className="text-[12.5px] text-slate-500 mt-1">
              Your {kind === "all" ? "activity" : kind} will appear here as you
              use the app.
            </div>
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3 pt-2">
          <div className="text-[11px] text-slate-500 tabular-nums">
            Showing{" "}
            <span className="font-medium text-slate-700">{pageStart + 1}</span>
            –
            <span className="font-medium text-slate-700">
              {Math.min(pageStart + pageSize, items.length)}
            </span>{" "}
            of <span className="font-medium text-slate-700">{items.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <PagerButton
              disabled={safePage === 1}
              onClick={() => setPage(1)}
              label="First"
            >
              «
            </PagerButton>
            <PagerButton
              disabled={safePage === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              label="Previous"
            >
              <ChevronLeft className="size-3.5" />
            </PagerButton>
            {pageWindow(safePage, pageCount).map((p, idx) =>
              p === "…" ? (
                <span
                  key={`gap-${idx}`}
                  className="px-2 text-[11px] text-slate-400 select-none"
                >
                  …
                </span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p as number)}
                  className={
                    "min-w-7 h-7 px-2 rounded-md text-[11px] font-medium tabular-nums transition-colors " +
                    (p === safePage
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-slate-600 hover:bg-slate-100")
                  }
                >
                  {p}
                </button>
              ),
            )}
            <PagerButton
              disabled={safePage === pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              label="Next"
            >
              <ChevronRight className="size-3.5" />
            </PagerButton>
            <PagerButton
              disabled={safePage === pageCount}
              onClick={() => setPage(pageCount)}
              label="Last"
            >
              »
            </PagerButton>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================ subcomponents

function FilterChips({
  value,
  onChange,
  counts,
}: {
  value: HistoryKind;
  onChange: (k: HistoryKind) => void;
  counts: HistoryCounts | null;
}) {
  const chips: {
    key: HistoryKind;
    label: string;
    icon: typeof MessageSquareText;
    tone: string;
  }[] = [
    { key: "all", label: "All", icon: Sparkles, tone: "primary" },
    { key: "query", label: "Queries", icon: MessageSquareText, tone: "sky" },
    { key: "appeal", label: "Appeals", icon: Gavel, tone: "amber" },
    { key: "document", label: "Documents", icon: FileText, tone: "violet" },
    { key: "session", label: "Sessions", icon: LogIn, tone: "emerald" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((ch) => {
        const Icon = ch.icon;
        const active = value === ch.key;
        const n = counts?.[ch.key] ?? 0;
        return (
          <button
            key={ch.key}
            onClick={() => onChange(ch.key)}
            className={
              "inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-medium border transition-all " +
              (active
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-white text-slate-700 border-slate-200 hover:border-primary/30 hover:text-slate-900")
            }
          >
            <Icon className="size-3.5" />
            {ch.label}
            <span
              className={
                "inline-block min-w-[20px] text-center rounded-full px-1.5 text-[10.5px] tabular-nums " +
                (active
                  ? "bg-white/25 text-white"
                  : "bg-slate-100 text-slate-600")
              }
            >
              {n}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function HistoryRow({
  it,
  deleting,
  onDelete,
}: {
  it: HistoryItem;
  deleting: boolean;
  onDelete: () => void;
}) {
  const kindMeta: Record<
    string,
    { icon: typeof MessageSquareText; tone: string; label: string }
  > = {
    query: { icon: MessageSquareText, tone: "sky", label: "Query" },
    appeal: { icon: Gavel, tone: "amber", label: "Appeal" },
    document: { icon: FileText, tone: "violet", label: "Document" },
    session: { icon: LogIn, tone: "emerald", label: "Session" },
  };
  const meta = kindMeta[it.kind] ?? kindMeta.query;
  const Icon = meta.icon;
  const toneClass: Record<string, string> = {
    sky: "bg-primary/10 text-primary ring-primary/20",
    amber: "bg-primary/10 text-primary ring-primary/20",
    violet: "bg-primary/10 text-primary ring-primary/20",
    emerald: "bg-primary/10 text-primary ring-primary/20",
  };
  return (
    <Card className="group">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start gap-3">
          <div
            className={
              "size-9 rounded-lg ring-1 flex items-center justify-center shrink-0 " +
              (toneClass[meta.tone] || toneClass.sky)
            }
          >
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant={it.kind === "query" ? "default" : "secondary"}>
                  {meta.label}
                </Badge>
                {it.scope && (
                  <span className="text-[10.5px] text-slate-400 uppercase tracking-wider">
                    {it.scope}
                  </span>
                )}
                <span className="text-xs text-muted-foreground truncate">
                  {it.created_at ? new Date(it.created_at).toLocaleString() : "—"}
                </span>
              </div>
              <button
                onClick={onDelete}
                disabled={deleting}
                className="opacity-0 group-hover:opacity-100 transition text-slate-400 hover:text-rose-600 focus:opacity-100 disabled:opacity-40"
                title="Delete this entry"
                aria-label="Delete this entry"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="font-medium text-slate-900 line-clamp-2">
              {it.title}
            </div>
            {it.detail && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-3">
                {it.detail}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PagerButton({
  disabled,
  onClick,
  children,
  label,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={
        "inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-md border border-slate-200 bg-white text-slate-600 text-[11px] font-medium transition-colors " +
        (disabled
          ? "opacity-40 cursor-not-allowed"
          : "hover:bg-slate-50 hover:text-slate-900")
      }
    >
      {children}
    </button>
  );
}

/** Compact pagination window: 1 … 4 [5] 6 … 12 */
function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) out.push("…");
  for (let p = left; p <= right; p++) out.push(p);
  if (right < total - 1) out.push("…");
  out.push(total);
  return out;
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard, FolderOpen, ArrowUpRight, RefreshCw, AlarmClock, Newspaper } from "lucide-react";
import { api, WsWorkload, WsWorkloadRow } from "../api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useAuth } from "../auth";
import { resolveWorkspace, resolveTiles } from "@/lib/workspaceProfiles";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";
import PageHelp from "@/components/PageHelp";
import WingActivities from "@/components/WingActivities";

const CATS = [
  { v: "", l: "All" }, { v: "officer", l: "AO" }, { v: "cita", l: "CIT(A)" },
  { v: "drp", l: "DRP" }, { v: "investigation", l: "Investigation" }, { v: "ici", l: "I&CI" },
  { v: "tds", l: "TDS" }, { v: "recovery", l: "Recovery" }, { v: "tp", l: "TP" },
  { v: "ca", l: "CA" }, { v: "other", l: "Other" },
];
const CAT_LABEL: Record<string, string> = {
  officer: "Assessing Officer", cita: "CIT(A) / NFAC", drp: "DRP", investigation: "Investigation",
  ici: "I&CI", tds: "TDS / Exemptions", recovery: "Recovery / TRO", tp: "Transfer Pricing",
  ca: "CA / Advocate", other: "Other",
};
const STATUS_TONE: Record<string, string> = {
  open: "bg-blue-50 text-blue-700 ring-blue-200",
  in_progress: "bg-amber-50 text-amber-700 ring-amber-200",
  awaiting_order: "bg-violet-50 text-violet-700 ring-violet-200",
  closed: "bg-slate-100 text-slate-500 ring-slate-200",
};

function daysUntil(iso: string): number {
  const d = new Date(iso + "T00:00:00");
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86_400_000);
}
function fmt(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function urgency(days: number): { tag: string; tone: string } {
  if (days < 0) return { tag: "Overdue", tone: "bg-rose-50 text-rose-700 ring-rose-200" };
  if (days <= 7) return { tag: `${days}d left`, tone: "bg-rose-50 text-rose-700 ring-rose-200" };
  if (days <= 30) return { tag: `${days}d left`, tone: "bg-amber-50 text-amber-700 ring-amber-200" };
  return { tag: `${days}d`, tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" };
}

function Tile({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className={cn("rounded-2xl ring-1 p-4", tone)}>
      <div className="text-2xl font-bold leading-none tabular-nums">{value}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wide mt-1 opacity-80">{label}</div>
    </div>
  );
}

const inrCompact = (n: number) =>
  "₹" + new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n);

interface DeskStats {
  total_matters: number; open_deadlines: number; overdue: number;
  due_7: number; due_30: number; demand: number;
}

// The tile vocabulary the per-wing tile sets (resolveTiles) pick from.
const TILE_DEFS: Record<string, { label: string; tone: string; get: (s: DeskStats) => string | number }> = {
  matters: { label: "Matters", tone: "bg-white text-slate-900 ring-slate-200", get: (s) => s.total_matters },
  open: { label: "Open deadlines", tone: "bg-white text-slate-900 ring-slate-200", get: (s) => s.open_deadlines },
  overdue: { label: "Overdue", tone: "bg-rose-50 text-rose-700 ring-rose-200", get: (s) => s.overdue },
  due7: { label: "Next 7 days", tone: "bg-amber-50 text-amber-700 ring-amber-200", get: (s) => s.due_7 },
  due30: { label: "Next 30 days", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200", get: (s) => s.due_30 },
  demand: { label: "Demand outstanding", tone: "bg-rose-50 text-rose-700 ring-rose-200", get: (s) => inrCompact(s.demand) },
};

export default function Dashboard() {
  const nav = useNavigate();
  const { session } = useAuth();
  const ws = resolveWorkspace(session?.workspaceProfile, session?.workspaceWings);
  const myCats = ws.categories;
  const [data, setData] = useState<WsWorkload | null>(null);
  const [loading, setLoading] = useState(true);
  // Default to the user's own function when a profile is set ("Mine"); All otherwise.
  const [cat, setCat] = useState(myCats.length ? "__mine" : "");
  const [sort, setSort] = useState<"urgent" | "overdue" | "updated">("urgent");
  // The category chips. With a profile set, the dashboard is department-specific:
  // only "Mine" + "All" + the user's own function chips — not every wing. Without
  // a profile ("all"/none), the full set is shown.
  const cats = myCats.length
    ? [{ v: "__mine", l: "Mine" }, { v: "", l: "All" }, ...CATS.filter((c) => myCats.includes(c.v))]
    : CATS;

  const didInitFallback = useRef(false);
  const prevCatsLen = useRef(myCats.length);

  const load = async () => {
    try {
      const d = await api.wsWorkload();
      setData(d);
      // Don't strand the user on an empty "Mine": if their function's wings
      // match none of their (possibly untagged / other-wing) matters, open on
      // "All" so the caseload is visible. INITIAL load only — a later manual
      // Refresh must never override the user's chosen chip.
      if (!didInitFallback.current && myCats.length && d.matters.length > 0 &&
          !d.matters.some((m) => myCats.includes(m.category || ""))) {
        setCat("");
      }
      didInitFallback.current = true;
    } catch (e: any) {
      toast.error(e?.message || "Could not load your workload.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  // React to the profile changing while this page is live (e.g. picked in the
  // first-run prompt): default to "Mine" when it becomes set, and fall back to
  // "All" when it's cleared so the "Mine" chip never lingers with no list.
  useEffect(() => {
    const was = prevCatsLen.current;
    prevCatsLen.current = myCats.length;
    if (!myCats.length && cat === "__mine") setCat("");
    else if (was === 0 && myCats.length > 0 && cat === "") setCat("__mine");
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [myCats.length]);

  const rows = useMemo(() => {
    if (!data) return [];
    let r = data.matters.filter((m) =>
      !cat ? true : cat === "__mine" ? myCats.includes(m.category || "") : m.category === cat);
    const nextKey = (m: WsWorkloadRow) => (m.next_due_date ? daysUntil(m.next_due_date) : 99999);
    if (sort === "urgent") r = [...r].sort((a, b) => nextKey(a) - nextKey(b));
    else if (sort === "overdue") r = [...r].sort((a, b) => b.overdue_count - a.overdue_count || nextKey(a) - nextKey(b));
    else r = [...r].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    return r;
  }, [data, cat, sort, session?.workspaceProfile, session?.workspaceWings]);

  // Tiles reflect the CURRENT filter (your desk), not the whole department's
  // caseload — so the numbers always agree with the list below.
  const s: DeskStats = useMemo(() => ({
    total_matters: rows.length,
    open_deadlines: rows.reduce((n, m) => n + m.open_count, 0),
    overdue: rows.reduce((n, m) => n + m.overdue_count, 0),
    due_7: rows.reduce((n, m) => n + m.urgent_count, 0),
    due_30: rows.reduce((n, m) => n + (m.due30_count ?? 0), 0),
    demand: rows.reduce((n, m) => n + (m.demand_due ?? 0), 0),
  }), [rows]);
  // Which tiles this desk leads with (Recovery/AO surface outstanding demand).
  const tiles = resolveTiles(session?.workspaceProfile, session?.workspaceWings);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="size-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <LayoutDashboard className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 leading-tight">Your Desk</h1>
          <p className="text-[13px] text-slate-500">
            {myCats.length ? "Tailored to your function — sorted by what's due next." : "Your whole caseload, sorted by what's due next."}
          </p>
        </div>
        <PageHelp id="dashboard" className="ml-auto shrink-0" />
        <button onClick={() => { setLoading(true); load(); }} title="Refresh"
          className="p-2 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <RefreshCw className="size-4" />
        </button>
      </div>

      {/* Summary tiles — the set is tailored to the officer's function. */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {loading
          ? tiles.map((k) => <Skeleton key={k} className="h-[76px] rounded-2xl" />)
          : tiles.map((k) => {
              const d = TILE_DEFS[k];
              return d ? <Tile key={k} label={d.label} value={d.get(s)} tone={d.tone} /> : null;
            })}
      </div>

      {/* Your daily work — the officer's real wing activities (taxonomy-driven). */}
      <WingActivities />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {cats.map((c) => (
            <button key={c.v} onClick={() => setCat(c.v)}
              className={cn("px-3 py-1.5 rounded-full text-[12px] font-semibold ring-1 transition-colors",
                cat === c.v ? "bg-primary text-white ring-primary" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50")}>
              {c.l}
            </button>
          ))}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as any)}
          className="ml-auto h-9 rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-700">
          <option value="urgent">Sort: most urgent</option>
          <option value="overdue">Sort: overdue first</option>
          <option value="updated">Sort: recently updated</option>
        </select>
      </div>

      {/* Matters list */}
      <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm divide-y divide-slate-100">
        {loading && <SkeletonRows rows={6} />}
        {!loading && rows.length === 0 && (
          <div className="py-12 text-center">
            <FolderOpen className="size-7 mx-auto text-slate-300 mb-2" />
            {data && data.matters.length > 0 ? (
              <>
                <p className="text-[13px] text-slate-400">
                  {cat === "__mine"
                    ? `None of your ${data.matters.length} matter${data.matters.length === 1 ? "" : "s"} are tagged to your function.`
                    : "No matters in this filter."}
                </p>
                <button onClick={() => setCat("")} className="mt-2 text-[13px] font-semibold text-primary hover:underline">
                  Show all {data.matters.length} →
                </button>
              </>
            ) : (
              <>
                <p className="text-[13px] text-slate-400">No matters yet.</p>
                <button onClick={() => nav("/workspace")} className="mt-2 text-[13px] font-semibold text-primary hover:underline">
                  Open the Calendar to add one →
                </button>
              </>
            )}
          </div>
        )}
        {rows.map((m) => {
          const days = m.next_due_date ? daysUntil(m.next_due_date) : null;
          const u = days !== null ? urgency(days) : null;
          return (
            <button key={m.id} onClick={() => nav(`/workspace?matter=${m.id}`)}
              className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-slate-800 truncate">{m.title}</span>
                  {!m.owned && <span className="shrink-0 text-[9px] font-bold uppercase text-primary bg-primary/10 px-1.5 py-0.5 rounded">Shared</span>}
                  <span className={cn("shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ring-1 capitalize", STATUS_TONE[m.status] || STATUS_TONE.open)}>
                    {m.status.replace("_", " ")}
                  </span>
                </div>
                <div className="text-[11.5px] text-slate-500 truncate mt-0.5">
                  {[m.pan, m.assessment_year, m.category && CAT_LABEL[m.category]].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <div className="hidden sm:block text-right min-w-0">
                {m.next_due_date ? (
                  <>
                    <div className="text-[12.5px] font-semibold text-slate-700 truncate max-w-[220px]">{m.next_label}</div>
                    <div className="text-[11px] text-slate-500">{m.next_section ? m.next_section + " · " : ""}{fmt(m.next_due_date)}</div>
                  </>
                ) : (
                  <div className="text-[12px] text-slate-400">No open deadline</div>
                )}
              </div>
              {m.demand_due > 0 && (
                <span className="shrink-0 text-[10.5px] font-bold px-2 py-1 rounded-full ring-1 tabular-nums bg-rose-50 text-rose-700 ring-rose-200" title="Outstanding demand incl. 220(2) interest">
                  ₹{new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(m.demand_due)} due
                </span>
              )}
              {u && <span className={cn("shrink-0 text-[10.5px] font-bold px-2 py-1 rounded-full ring-1 tabular-nums", u.tone)}>{u.tag}</span>}
              {m.open_count > 0 && (
                <span className="shrink-0 hidden md:inline-flex items-center gap-1 text-[11px] text-slate-400" title="Open deadlines">
                  <AlarmClock className="size-3.5" /> {m.open_count}
                </span>
              )}
              <ArrowUpRight className="size-4 text-slate-300 shrink-0" />
            </button>
          );
        })}
      </div>

      {/* Latest tax news — a small strip beneath the caseload so the officer
          catches overnight headlines without leaving the dashboard. Full feed
          on /news via the "View all →" link. */}
      <NewsStrip />
    </div>
  );
}

// -------------------------------------------------------------- News strip
// A compact 5-item list of the latest tax headlines, fetched from /news.
// Silent-fails: an empty widget is a better UX than an error toast on the
// dashboard, so a failed poll just hides the strip.
function relTimeShort(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

// Aggregator names ("Google Alerts …", "Google News …") never surface;
// derive publisher from URL hostname when needed.
function newsPublisher(item: { source_name: string; url: string }): string {
  const low = (item.source_name || "").toLowerCase();
  if (item.source_name && !low.startsWith("google alert") && !low.startsWith("google news")) {
    return item.source_name;
  }
  try {
    return new URL(item.url).hostname.replace(/^www\./, "");
  } catch {
    return item.source_name || "";
  }
}

function NewsStrip() {
  const nav = useNavigate();
  const [items, setItems] = useState<{
    id: number; title: string; url: string; source_name: string;
    source_category: string | null; published_at: string;
  }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.news({ limit: 5, sort: "latest" })
      .then((r) => { if (!cancelled) setItems(r.items); })
      .catch(() => { /* silent — see comment above */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (!loading && items.length === 0) return null;

  return (
    <div className="mt-4 bg-white rounded-2xl ring-1 ring-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Newspaper className="size-4 text-primary" />
          <h2 className="text-[13.5px] font-semibold text-slate-900">Latest tax news</h2>
        </div>
        <button
          onClick={() => nav("/news")}
          className="text-[12.5px] font-semibold text-primary hover:underline inline-flex items-center gap-0.5"
        >
          View all
          <ArrowUpRight className="size-3.5" />
        </button>
      </div>
      {loading ? (
        <SkeletonRows rows={3} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((it) => (
            <li key={it.id}>
              <a
                href={it.url}
                target="_blank"
                rel="noreferrer noopener"
                className="group flex items-start gap-3 py-2.5 hover:bg-slate-50 -mx-2 px-2 rounded-md transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium text-slate-900 group-hover:text-primary line-clamp-2 leading-snug">
                    {it.title}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-slate-500 flex items-center gap-1.5">
                    {it.source_category && (
                      <>
                        <span className="text-slate-600">{it.source_category}</span>
                        <span className="text-slate-300">·</span>
                      </>
                    )}
                    <span className="truncate">{newsPublisher(it)}</span>
                    <span className="text-slate-300">·</span>
                    <span className="tabular-nums shrink-0">{relTimeShort(it.published_at)}</span>
                  </div>
                </div>
                <ArrowUpRight className="size-4 text-slate-300 group-hover:text-primary shrink-0 mt-1" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

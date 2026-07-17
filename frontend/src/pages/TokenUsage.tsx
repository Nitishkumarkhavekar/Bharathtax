import { useEffect, useMemo, useState } from "react";
import {
  Coins,
  Zap,
  Activity,
  Sparkles,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { TokenRecentRow, UserTokenUsage, api } from "../api";

/**
 * Officer-facing "Your AI token usage" page. Same data as the block that
 * used to live on the Profile page, but hoisted to its own top-level route
 * (linked from the sidebar) so officers can watch spend at a glance without
 * digging into settings.
 *
 * Model identifiers are intentionally NOT surfaced here — end users see only
 * task labels + counts. Model-level breakdowns remain admin-only.
 */
export default function TokenUsagePage() {
  const [data, setData] = useState<UserTokenUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .myTokenUsage()
      .then(setData)
      .catch((e: any) => setErr(e?.message ?? "Failed to load usage"))
      .finally(() => setLoading(false));
  }, []);

  const maxDay = data?.per_day?.reduce((m, d) => Math.max(m, d.tokens), 1) ?? 1;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Coins className="size-5 text-primary" /> Your AI token usage
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Only counts your own AI calls. Nobody else in your wing can see this.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-5">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            <Coins className="size-4 text-primary" /> Overview
          </div>
          {loading && <Loader2 className="size-4 animate-spin text-slate-400" />}
        </div>

        {err && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-sm px-3 py-2 flex items-start gap-2">
            <AlertCircle className="size-4 mt-0.5 shrink-0" /> {err}
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MiniStat
                label="All-time"
                value={fmt(data.total_tokens)}
                hint={`${fmt(data.calls)} calls`}
                tone="amber"
                icon={<Coins className="size-3.5" />}
              />
              <MiniStat
                label="Last 24h"
                value={fmt(data.tokens_24h)}
                hint="tokens"
                tone="rose"
                icon={<Zap className="size-3.5" />}
              />
              <MiniStat
                label="Last 7 days"
                value={fmt(data.tokens_7d)}
                hint="tokens"
                tone="blue"
                icon={<Activity className="size-3.5" />}
              />
              <MiniStat
                label="Last 30 days"
                value={fmt(data.tokens_30d)}
                hint="tokens"
                tone="green"
                icon={<Sparkles className="size-3.5" />}
              />
            </div>

            {data.by_action.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  By task
                </div>
                <ul className="grid sm:grid-cols-2 gap-1.5 text-sm">
                  {data.by_action.slice(0, 8).map((a) => (
                    <li
                      key={a.action}
                      className="flex items-center gap-2 rounded-md bg-slate-50 border border-slate-200 px-2.5 py-1.5"
                    >
                      <span className="text-slate-800 flex-1 truncate">
                        {actionLabel(a.action)}
                      </span>
                      <span className="text-[11px] text-slate-500 tabular-nums">
                        ×{fmt(a.calls)}
                      </span>
                      <span className="text-slate-900 font-semibold tabular-nums w-20 text-right">
                        {fmt(a.tokens)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.per_day.length > 0 && (
              <TokensBarChart rows={data.per_day.slice(-30)} maxDay={maxDay} />
            )}

            {data.recent.length > 0 && (
              <RecentActivityTable rows={data.recent} />
            )}

            {data.total_tokens === 0 && (
              <div className="text-sm text-slate-500 text-center py-4">
                You haven't used the AI yet.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Paginated "Recent activity" table. Keeps the DOM small when there are
 *  hundreds of rows and gives the user real navigation ("Page 3 of 12")
 *  instead of an infinite scroll blob. */
function RecentActivityTable({ rows }: { rows: TokenRecentRow[] }) {
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  // Clamp page when pageSize / rows changes.
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const slice = useMemo(
    () => rows.slice(start, start + pageSize),
    [rows, start, pageSize],
  );
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Recent activity
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <label htmlFor="ru-page-size">Rows</label>
          <select
            id="ru-page-size"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[11px] tabular-nums"
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2 font-medium">When</th>
              <th className="text-left px-3 py-2 font-medium">Task</th>
              <th className="text-right px-3 py-2 font-medium">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">
                  {r.created_at ? relTime(r.created_at) : "—"}
                </td>
                <td className="px-3 py-1.5 text-slate-800">
                  {actionLabel(r.action)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-slate-900 font-semibold">
                  {fmt(r.total_tokens)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Pagination bar */}
      <div className="flex items-center justify-between mt-3 gap-3 flex-wrap">
        <div className="text-[11px] text-slate-500 tabular-nums">
          Showing <span className="font-medium text-slate-700">{start + 1}</span>
          –<span className="font-medium text-slate-700">
            {Math.min(start + pageSize, rows.length)}
          </span>{" "}
          of <span className="font-medium text-slate-700">{rows.length}</span>
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
    </div>
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

/** Attractive daily-token bar chart. Handles 1..30 days gracefully — bars
 *  cap at a max width so a 2-day view doesn't render as two giant blocks,
 *  and the grid + axis labels give real context instead of anonymous bars. */
export function TokensBarChart({
  rows,
  maxDay,
}: {
  rows: { day: string; tokens: number; calls: number }[];
  maxDay: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  // Round the y-axis top up to something clean so grid labels aren't
  // "347" / "694" / "1041" but "500" / "1k" / "1.5k".
  const niceMax = niceCeil(maxDay);
  const gridLines = [1, 0.66, 0.33, 0].map((f) => Math.round(niceMax * f));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Last {rows.length} day{rows.length === 1 ? "" : "s"}
        </div>
        <div className="text-[11px] text-slate-500">
          <span className="inline-block size-2 rounded-sm bg-gradient-to-t from-sky-400 to-indigo-500 mr-1.5 align-middle" />
          tokens per day
        </div>
      </div>
      <div className="relative rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50/60 to-white p-4 pt-3">
        {/* Grid + Y-axis labels */}
        <div className="relative h-40">
          {gridLines.map((v, i) => (
            <div
              key={i}
              className="absolute left-8 right-0 border-t border-dashed border-slate-200/80 text-[10px] text-slate-400"
              style={{ top: `${(i / 3) * 100}%` }}
            >
              <span className="absolute -translate-y-1/2 -left-8 w-7 text-right tabular-nums">
                {fmt(v)}
              </span>
            </div>
          ))}
          {/* Bars */}
          <div className="absolute inset-0 left-8 flex items-end gap-2 pt-1">
            {rows.map((d, idx) => {
              const pct = niceMax
                ? Math.max(1.5, Math.round((d.tokens / niceMax) * 100))
                : 0;
              const isHover = hover === idx;
              return (
                <div
                  key={d.day}
                  className="relative flex-1 max-w-[42px] mx-auto flex items-end justify-center group"
                  style={{ height: "100%" }}
                  onMouseEnter={() => setHover(idx)}
                  onMouseLeave={() => setHover((h) => (h === idx ? null : h))}
                >
                  {/* Tooltip */}
                  {isHover && d.tokens > 0 && (
                    <div className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full z-10 whitespace-nowrap rounded-md bg-slate-900 text-white text-[11px] px-2 py-1 shadow-lg">
                      <div className="font-semibold tabular-nums">
                        {fmt(d.tokens)} tokens
                      </div>
                      <div className="opacity-75 text-[10px]">
                        {fmt(d.calls)} calls · {shortDate(d.day)}
                      </div>
                      <div className="absolute left-1/2 -translate-x-1/2 top-full size-0 border-x-4 border-x-transparent border-t-4 border-t-slate-900" />
                    </div>
                  )}
                  <div
                    className={
                      "w-full rounded-t-md bg-gradient-to-t from-sky-400 to-indigo-500 transition-all duration-300 " +
                      (isHover ? "opacity-100 shadow-md shadow-indigo-500/25" : "opacity-90")
                    }
                    style={{
                      height: `${pct}%`,
                      minHeight: d.tokens > 0 ? "3px" : "0px",
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {/* X-axis labels */}
        <div className="mt-2 pl-8 flex gap-2">
          {rows.map((d, idx) => {
            // With many bars we'd need every-Nth labels to avoid crowding —
            // pick a step that keeps at most ~10 labels on screen.
            const step = Math.max(1, Math.ceil(rows.length / 10));
            const show = idx % step === 0 || idx === rows.length - 1;
            return (
              <div
                key={d.day}
                className="flex-1 max-w-[42px] mx-auto text-center text-[10px] text-slate-500 tabular-nums"
              >
                {show ? shortDate(d.day) : " "}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function shortDate(iso: string): string {
  // "2026-07-01" -> "01 Jul"
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  const m = d.toLocaleString("en", { month: "short" });
  return `${String(d.getDate()).padStart(2, "0")} ${m}`;
}

function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const mant = n / base;
  // Round mantissa up to the next "nice" step (1, 2, 5, 10).
  const nice = mant <= 1 ? 1 : mant <= 2 ? 2 : mant <= 5 ? 5 : 10;
  return nice * base;
}

function MiniStat({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  icon?: React.ReactNode;
  tone: "amber" | "rose" | "blue" | "green";
}) {
  const map = {
    amber: "from-amber-50/80 to-white text-amber-700 ring-amber-100",
    rose: "from-rose-50/80 to-white text-rose-700 ring-rose-100",
    blue: "from-sky-50/80 to-white text-sky-700 ring-sky-100",
    green: "from-emerald-50/80 to-white text-emerald-700 ring-emerald-100",
  } as const;
  return (
    <div
      className={
        "rounded-xl border border-slate-200/80 bg-gradient-to-br p-3 ring-1 " +
        map[tone]
      }
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
          {label}
        </div>
        {icon}
      </div>
      <div className="mt-1.5 text-lg font-semibold text-slate-900 tabular-nums leading-none">
        {value}
      </div>
      <div className="mt-0.5 text-[10.5px] text-slate-500">{hint}</div>
    </div>
  );
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    ask: "AI Q&A",
    improve_prompt: "Improve prompt",
    "appeal.module1": "Appeal — Deficiency check",
    "appeal.module2": "Appeal — Scope validation",
    "appeal.module3": "Appeal — Document compliance",
    "appeal.module4": "Appeal — Issue matrix",
    "appeal.module5": "Appeal — Issue drafting",
    "appeal.module6": "Appeal — Assemble draft order",
  };
  return map[action] || action.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmt(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 2 : 1) + "k";
  return (n / 1_000_000).toFixed(2) + "M";
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

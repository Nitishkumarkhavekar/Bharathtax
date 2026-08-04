import { useEffect, useMemo, useState } from "react";
import {
  Coins,
  Zap,
  Users,
  Activity,
  Brain,
  Search,
  User as UserIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { AdminTokenUsage, api } from "@/api";
import { Empty, ErrorBanner, Header, Loading } from "./Dashboard";
import { BarChart, DonutChart, Section, StatCard } from "@/components/admin/charts";

const WINDOWS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "365d", days: 365 },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type WindowMode =
  | { kind: "days"; days: number }
  | { kind: "month"; year: number; month: number };

export default function TokenUsagePage() {
  const [mode, setMode] = useState<WindowMode>({ kind: "days", days: 30 });
  const [data, setData] = useState<AdminTokenUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    const opts = mode.kind === "days"
      ? { days: mode.days }
      : { year: mode.year, month: mode.month };
    api
      .adminTokenUsage(opts)
      .then(setData)
      .catch((e) => setErr(e?.message ?? "failed"))
      .finally(() => setLoading(false));
  }, [mode]);

  // Reset to page 1 whenever the search or window changes so the user isn't
  // stranded on an empty page after narrowing results.
  useEffect(() => {
    setPage(1);
  }, [q, mode, pageSize]);

  const users = useMemo(() => {
    if (!data) return [];
    const t = q.trim().toLowerCase();
    if (!t) return data.per_user;
    return data.per_user.filter(
      (u) =>
        u.username.toLowerCase().includes(t) ||
        (u.full_name ?? "").toLowerCase().includes(t) ||
        (u.email ?? "").toLowerCase().includes(t),
    );
  }, [data, q]);

  if (loading && !data) return <Loading label="Loading token usage…" />;
  if (err || !data) return <ErrorBanner msg={err ?? "no data"} />;

  // Day-of-window bars. In month mode we show every day of the calendar
  // month (up to 31); in days mode we show the requested rolling window.
  // The BarChart's `scrollable` mode kicks in when the window is >14 days
  // so 30-day / month / 90-day charts don't squeeze the bars to nothing.
  const dayBars = data.per_day.map((d) => ({
    label: d.day.slice(5), // MM-DD
    value: d.tokens,
  }));
  const dayChartScrollable = dayBars.length > 14;
  const actionBars = data.per_action.slice(0, 8).map((a) => ({
    label: a.action.replace(/_/g, " ").replace("appeal.", "").slice(0, 12),
    value: a.tokens,
  }));
  const donutSegments = data.per_model.slice(0, 6).map((m, i) => ({
    label: m.model.replace(/-instruct$/, ""),
    value: m.tokens,
    color: DONUT_COLORS[i % DONUT_COLORS.length],
  }));

  return (
    <div className="space-y-6 admin-rise">
      <Header
        title="Token Usage"
        subtitle="How many tokens each user, action and model is consuming on the gateway."
        actions={<WindowPicker mode={mode} onChange={setMode} />}
      />

      {/* KPI row */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 admin-rise">
        <StatCard
          label={`Tokens (${data.window_days}d)`}
          value={fmt(data.tokens_window)}
          icon={<Coins className="size-4" />}
          hint={`${fmt(data.total_tokens)} all-time`}
          accent="amber"
        />
        <StatCard
          label="Tokens (24h)"
          value={fmt(data.tokens_24h)}
          icon={<Zap className="size-4" />}
          hint={`${fmt(data.tokens_7d)} in 7d`}
          accent="rose"
        />
        <StatCard
          label="Calls"
          value={fmt(data.calls)}
          icon={<Activity className="size-4" />}
          hint={`avg ${
            data.calls
              ? Math.round(data.total_tokens / data.calls).toLocaleString()
              : 0
          } tokens/call`}
          accent="blue"
        />
        <StatCard
          label="Active users"
          value={fmt(data.active_users)}
          icon={<Users className="size-4" />}
          hint="Users with at least one call"
          accent="green"
        />
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-3 gap-4 admin-rise">
        <Section
          className="lg:col-span-2"
          title={
            mode.kind === "month"
              ? `Tokens per day — ${MONTH_NAMES[mode.month - 1]} ${mode.year}`
              : `Tokens per day (${data.window_days}d)`
          }
          subtitle={dayChartScrollable ? "Scroll horizontally · hover bars for exact counts" : "Hover bars for exact counts"}
          icon={<Activity className="size-4" />}
        >
          {dayBars.length > 0 ? (
            <BarChart
              data={dayBars}
              height={200}
              accent="amber"
              valueFormatter={fmt}
              scrollable={dayChartScrollable}
              minBarSlot={38}
            />
          ) : (
            <Empty label="No token activity in this window yet." />
          )}
        </Section>

        <Section title="By model" icon={<Brain className="size-4" />}>
          {donutSegments.length ? (
            <DonutChart
              size={140}
              thickness={16}
              centerLabel={fmt(data.total_tokens)}
              centerSub="total tokens"
              segments={donutSegments}
            />
          ) : (
            <Empty label="No model calls yet." />
          )}
        </Section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 admin-rise">
        <Section title="Top actions" subtitle="By tokens">
          {actionBars.length ? (
            <BarChart
              data={actionBars}
              height={180}
              accent="violet"
              valueFormatter={fmt}
            />
          ) : (
            <Empty label="No actions yet." />
          )}
        </Section>

        <Section title="By action (details)" subtitle="Rank order">
          {data.per_action.length ? (
            <ul className="text-sm">
              {data.per_action.map((a) => (
                <li
                  key={a.action}
                  className="flex items-center gap-3 py-1.5 border-b border-slate-100 last:border-0"
                >
                  <span className="font-mono text-slate-800 flex-1 truncate">
                    {a.action}
                  </span>
                  <span className="text-[11px] text-slate-500 tabular-nums">
                    {fmt(a.calls)} calls
                  </span>
                  <span className="text-slate-900 font-semibold tabular-nums w-24 text-right">
                    {fmt(a.tokens)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty label="No actions." />
          )}
        </Section>
      </div>

      {/* Per-user leaderboard — every user paginated client-side. */}
      {(() => {
        const total = users.length;
        const pageCount = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(page, pageCount);
        const pageStart = (safePage - 1) * pageSize;
        const paged = users.slice(pageStart, pageStart + pageSize);
        return (
          <Section
            title="All users"
            subtitle={
              q.trim()
                ? `${total} matching · ${data.per_user.length} total`
                : `${data.per_user.length} user${data.per_user.length === 1 ? "" : "s"}`
            }
            icon={<UserIcon className="size-4" />}
            action={
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search users…"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            }
          >
            {total === 0 ? (
              <Empty label="No users match." />
            ) : (
              <>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[720px] text-sm admin-table">
                    <thead className="bg-slate-50 text-slate-700 text-[11px] font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-medium w-10">#</th>
                        <th className="text-left px-4 py-2.5 font-medium">User</th>
                        <th className="text-right px-4 py-2.5 font-medium">Calls</th>
                        <th className="text-right px-4 py-2.5 font-medium">Prompt</th>
                        <th className="text-right px-4 py-2.5 font-medium">Completion</th>
                        <th className="text-right px-4 py-2.5 font-medium">Total</th>
                        <th className="text-right px-4 py-2.5 font-medium">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.map((u, i) => {
                        const rank = pageStart + i + 1;
                        const share = data.total_tokens
                          ? (u.total_tokens / data.total_tokens) * 100
                          : 0;
                        return (
                          <tr key={u.user_id} className="border-t border-slate-100">
                            <td className="px-4 py-2.5 text-slate-500 tabular-nums font-medium">
                              {rank}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2.5">
                                <div className="size-8 rounded-full bg-primary text-white flex items-center justify-center text-xs font-semibold uppercase ring-2 ring-white shadow-sm">
                                  {(u.full_name ?? u.username)[0]}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-medium text-slate-900 truncate">
                                    {u.full_name ?? u.username}
                                  </div>
                                  <div className="text-[11px] text-slate-500 truncate">
                                    @{u.username}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-slate-800">
                              {fmt(u.calls)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-slate-600">
                              {fmt(u.prompt_tokens)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-slate-600">
                              {fmt(u.completion_tokens)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-slate-900 font-semibold">
                              {fmt(u.total_tokens)}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <div className="inline-flex items-center gap-2 w-full max-w-[140px] ml-auto">
                                <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                  <div
                                    className="h-full bg-primary"
                                    style={{ width: `${share}%` }}
                                  />
                                </div>
                                <span className="text-[11px] text-slate-500 tabular-nums w-10 text-right">
                                  {share.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination footer */}
                <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
                  <div className="text-[11px] text-slate-500 tabular-nums">
                    Showing{" "}
                    <span className="font-medium text-slate-700">
                      {pageStart + 1}
                    </span>
                    –
                    <span className="font-medium text-slate-700">
                      {Math.min(pageStart + pageSize, total)}
                    </span>{" "}
                    of{" "}
                    <span className="font-medium text-slate-700">{total}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="tu-page-size"
                      className="text-[11px] text-slate-500"
                    >
                      Rows
                    </label>
                    <select
                      id="tu-page-size"
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[11px] tabular-nums"
                    >
                      {[10, 20, 50, 100].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <div className="w-2" />
                    <PagerBtn
                      disabled={safePage === 1}
                      onClick={() => setPage(1)}
                      label="First"
                    >
                      «
                    </PagerBtn>
                    <PagerBtn
                      disabled={safePage === 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      label="Previous"
                    >
                      <ChevronLeft className="size-3.5" />
                    </PagerBtn>
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
                    <PagerBtn
                      disabled={safePage === pageCount}
                      onClick={() =>
                        setPage((p) => Math.min(pageCount, p + 1))
                      }
                      label="Next"
                    >
                      <ChevronRight className="size-3.5" />
                    </PagerBtn>
                    <PagerBtn
                      disabled={safePage === pageCount}
                      onClick={() => setPage(pageCount)}
                      label="Last"
                    >
                      »
                    </PagerBtn>
                  </div>
                </div>
              </>
            )}
          </Section>
        );
      })()}
    </div>
  );
}

const DONUT_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#64748b",
];

function fmt(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 2 : 1) + "k";
  return (n / 1_000_000).toFixed(2) + "M";
}

function PagerBtn({
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

// Window picker — a small segmented control with three modes:
//   * Rolling day windows (7d / 30d / 90d / 365d)
//   * Month picker (Year → Month → view that calendar month)
// Emits a WindowMode; the parent re-fetches whenever `mode` changes.
function WindowPicker({
  mode, onChange,
}: {
  mode: WindowMode;
  onChange: (m: WindowMode) => void;
}) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  // Show 6 years: this year and the previous 5.
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);
  const activeYear = mode.kind === "month" ? mode.year : currentYear;
  const activeMonth = mode.kind === "month" ? mode.month : currentMonth;

  const isMonthMode = mode.kind === "month";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Days / Rolling window buttons */}
      <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5">
        {WINDOWS.map((w) => {
          const active = mode.kind === "days" && mode.days === w.days;
          return (
            <button
              key={w.days}
              type="button"
              onClick={() => onChange({ kind: "days", days: w.days })}
              className={
                "px-2.5 py-1 text-xs font-semibold rounded " +
                (active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-slate-600 hover:bg-slate-50")
              }
            >
              {w.label}
            </button>
          );
        })}
      </div>

      {/* Month + Year selectors — switch to month mode when any change */}
      <div className={
        "flex items-center gap-1.5 rounded-md border p-0.5 pl-2 " +
        (isMonthMode
          ? "border-primary/40 bg-primary/[0.06]"
          : "border-slate-200 bg-white")
      }>
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500 pr-1">
          Month
        </span>
        <select
          aria-label="Year"
          value={activeYear}
          onChange={(e) => onChange({ kind: "month", year: Number(e.target.value), month: activeMonth })}
          className="h-7 rounded-md bg-white border border-slate-200 px-1.5 text-[11px] tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/25"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select
          aria-label="Month"
          value={activeMonth}
          onChange={(e) => onChange({ kind: "month", year: activeYear, month: Number(e.target.value) })}
          className="h-7 rounded-md bg-white border border-slate-200 px-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-primary/25"
        >
          {MONTH_NAMES.map((n, i) => {
            const monthNum = i + 1;
            const disabled = activeYear === currentYear && monthNum > currentMonth;
            return (
              <option key={monthNum} value={monthNum} disabled={disabled}>
                {n}
              </option>
            );
          })}
        </select>
      </div>
    </div>
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

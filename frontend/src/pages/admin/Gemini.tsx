import { useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  Zap,
  Users,
  Activity,
  Search,
  User as UserIcon,
  Globe,
  KeyRound,
  ChevronLeft,
  ChevronRight,
  Clock,
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
} from "lucide-react";
import { AdminGeminiStats, api } from "@/api";
import { Empty, ErrorBanner, Header, Loading } from "./Dashboard";
import { BarChart, Section, StatCard } from "@/components/admin/charts";

const WINDOWS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "365d", days: 365 },
];

export default function GeminiPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AdminGeminiStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  // Separate pagination state for the recent-calls trail so paging one
  // table doesn't interfere with the other.
  const [rPageSize, setRPageSize] = useState(20);
  const [rPage, setRPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    api
      .adminGemini(days)
      .then(setData)
      .catch((e) => setErr(e?.message ?? "failed"))
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => {
    setPage(1);
  }, [q, days, pageSize]);
  useEffect(() => {
    setRPage(1);
  }, [days, rPageSize]);

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

  if (loading && !data) return <Loading label="Loading Gemini stats…" />;
  if (err || !data) return <ErrorBanner msg={err ?? "no data"} />;

  const dayBars = data.per_day.slice(-30).map((d) => ({
    label: d.day.slice(5),
    value: d.tokens,
  }));
  const actionBars = data.per_action.slice(0, 8).map((a) => ({
    label: a.action.replace(/_/g, " ").replace("appeal.", "").slice(0, 14),
    value: a.tokens,
  }));

  const total = users.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const paged = users.slice(pageStart, pageStart + pageSize);

  return (
    <div className="space-y-6">
      <Header
        title="Gemini API monitoring"
        subtitle="Detailed spend, latency and user breakdown for the Gemini web-search backend."
        actions={
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w.label}
                onClick={() => setDays(w.days)}
                className={
                  "px-3 py-1 text-xs rounded " +
                  (days === w.days
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-slate-600 hover:bg-slate-100")
                }
              >
                {w.label}
              </button>
            ))}
          </div>
        }
      />

      {/* Config / health strip */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-primary/40 via-sky-400/30 to-violet-500/30 blur-md" />
            <div className="relative size-11 rounded-2xl bg-gradient-to-br from-primary via-sky-500 to-violet-600 flex items-center justify-center ring-1 ring-white/50 shadow-md">
              <Sparkles className="size-5 text-white" strokeWidth={2.2} />
            </div>
          </div>
          <div>
            <div className="text-[15px] font-semibold text-slate-900">
              {data.model}
            </div>
            <div className="text-[11px] text-slate-500">
              Web-search fallback for time-sensitive queries
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <HealthChip
            ok={data.configured}
            icon={<KeyRound className="size-3.5" />}
            label={data.configured ? "API key configured" : "API key missing"}
          />
          <HealthChip
            ok={data.web_search_enabled}
            icon={<Globe className="size-3.5" />}
            label={
              data.web_search_enabled
                ? "Web search enabled"
                : "Web search disabled"
            }
          />
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total tokens"
          value={fmt(data.total_tokens)}
          hint={`${fmt(data.calls)} calls`}
          icon={<Sparkles className="size-4" />}
        />
        <StatCard
          label="Last 24h"
          value={fmt(data.tokens_24h)}
          hint={`${fmt(data.calls_24h)} calls`}
          icon={<Zap className="size-4" />}
        />
        <StatCard
          label="Avg latency"
          value={data.avg_latency_ms ? `${(data.avg_latency_ms / 1000).toFixed(2)}s` : "—"}
          hint="per call"
          icon={<Clock className="size-4" />}
        />
        <StatCard
          label="Active users"
          value={String(data.active_users)}
          hint={`in ${data.window_days}d window`}
          icon={<Users className="size-4" />}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section
          title={`Tokens per day (${data.window_days}d)`}
          icon={<Activity className="size-4" />}
        >
          {dayBars.length > 0 ? (
            <BarChart data={dayBars} />
          ) : (
            <Empty label="No Gemini calls yet." />
          )}
        </Section>

        <Section
          title="Where the spend goes"
          icon={<Sparkles className="size-4" />}
        >
          {actionBars.length > 0 ? (
            <BarChart data={actionBars} accent="violet" />
          ) : (
            <Empty label="No task breakdown." />
          )}
        </Section>
      </div>

      {/* Per-user leaderboard */}
      <Section
        title="Gemini spend by user"
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
          <Empty label="No Gemini spend yet." />
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
                    <th className="text-right px-4 py-2.5 font-medium">Avg latency</th>
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
                            <div className="size-8 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white flex items-center justify-center text-xs font-semibold uppercase ring-2 ring-white shadow-sm">
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
                        <td className="px-4 py-2.5 text-right font-mono text-slate-600 tabular-nums">
                          {u.avg_latency_ms
                            ? `${(u.avg_latency_ms / 1000).toFixed(2)}s`
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex items-center gap-2 w-full max-w-[140px] ml-auto">
                            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-primary to-violet-500"
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

            {/* Pagination */}
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
                of <span className="font-medium text-slate-700">{total}</span>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="g-page-size" className="text-[11px] text-slate-500">
                  Rows
                </label>
                <select
                  id="g-page-size"
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
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
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

      {/* Recent calls trail — paginated so the whole 500-row history is
          navigable without scrolling forever. */}
      {(() => {
        const rTotal = data.recent.length;
        const rPageCount = Math.max(1, Math.ceil(rTotal / rPageSize));
        const rSafePage = Math.min(rPage, rPageCount);
        const rStart = (rSafePage - 1) * rPageSize;
        const rPaged = data.recent.slice(rStart, rStart + rPageSize);
        return (
          <Section
            title="Recent Gemini calls"
            subtitle={`${rTotal} call${rTotal === 1 ? "" : "s"} in the trail`}
            icon={<Clock className="size-4" />}
          >
            {rTotal === 0 ? (
              <Empty label="No recent Gemini activity." />
            ) : (
              <>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[720px] text-sm admin-table">
                    <thead className="bg-slate-50 text-slate-700 text-[11px] font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-medium">When</th>
                        <th className="text-left px-4 py-2.5 font-medium">User</th>
                        <th className="text-left px-4 py-2.5 font-medium">Task</th>
                        <th className="text-left px-4 py-2.5 font-medium">Model</th>
                        <th className="text-right px-4 py-2.5 font-medium">Prompt</th>
                        <th className="text-right px-4 py-2.5 font-medium">Completion</th>
                        <th className="text-right px-4 py-2.5 font-medium">Total</th>
                        <th className="text-right px-4 py-2.5 font-medium">Latency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rPaged.map((r) => (
                        <tr key={r.id} className="border-t border-slate-100">
                          <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                            {relTime(r.created_at)}
                          </td>
                          <td className="px-4 py-2.5 text-slate-800">
                            {r.full_name ?? r.username ?? "—"}
                          </td>
                          <td className="px-4 py-2.5 text-slate-800">
                            {r.action}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600 font-mono text-[12px]">
                            {r.model}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-slate-600">
                            {fmt(r.prompt_tokens)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-slate-600">
                            {fmt(r.completion_tokens)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-slate-900 font-semibold">
                            {fmt(r.total_tokens)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-slate-600 tabular-nums">
                            {r.latency_ms != null
                              ? `${(r.latency_ms / 1000).toFixed(2)}s`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="mt-3 flex items-center justify-between flex-wrap gap-3">
                  <div className="text-[11px] text-slate-500 tabular-nums">
                    Showing{" "}
                    <span className="font-medium text-slate-700">
                      {rStart + 1}
                    </span>
                    –
                    <span className="font-medium text-slate-700">
                      {Math.min(rStart + rPageSize, rTotal)}
                    </span>{" "}
                    of{" "}
                    <span className="font-medium text-slate-700">{rTotal}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="gr-page-size"
                      className="text-[11px] text-slate-500"
                    >
                      Rows
                    </label>
                    <select
                      id="gr-page-size"
                      value={rPageSize}
                      onChange={(e) => setRPageSize(Number(e.target.value))}
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
                      disabled={rSafePage === 1}
                      onClick={() => setRPage(1)}
                      label="First"
                    >
                      «
                    </PagerBtn>
                    <PagerBtn
                      disabled={rSafePage === 1}
                      onClick={() => setRPage((p) => Math.max(1, p - 1))}
                      label="Previous"
                    >
                      <ChevronLeft className="size-3.5" />
                    </PagerBtn>
                    {pageWindow(rSafePage, rPageCount).map((p, idx) =>
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
                          onClick={() => setRPage(p as number)}
                          className={
                            "min-w-7 h-7 px-2 rounded-md text-[11px] font-medium tabular-nums transition-colors " +
                            (p === rSafePage
                              ? "bg-primary text-primary-foreground shadow-sm"
                              : "text-slate-600 hover:bg-slate-100")
                          }
                        >
                          {p}
                        </button>
                      ),
                    )}
                    <PagerBtn
                      disabled={rSafePage === rPageCount}
                      onClick={() =>
                        setRPage((p) => Math.min(rPageCount, p + 1))
                      }
                      label="Next"
                    >
                      <ChevronRight className="size-3.5" />
                    </PagerBtn>
                    <PagerBtn
                      disabled={rSafePage === rPageCount}
                      onClick={() => setRPage(rPageCount)}
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

// ================================================================ helpers

function HealthChip({
  ok,
  icon,
  label,
}: {
  ok: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 " +
        (ok
          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
          : "bg-rose-50 text-rose-700 ring-rose-200")
      }
    >
      {icon}
      {label}
      {ok ? (
        <CheckCircle2 className="size-3.5" />
      ) : (
        <CircleAlert className="size-3.5" />
      )}
    </span>
  );
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
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
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

// Silence unused-import complaints — kept for future "surge alert" widgets.
void AlertTriangle;

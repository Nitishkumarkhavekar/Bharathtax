import { useEffect, useMemo, useState } from "react";
import {
  Coins,
  Zap,
  Users,
  Activity,
  Brain,
  Search,
  User as UserIcon,
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

export default function TokenUsagePage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AdminTokenUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .adminTokenUsage(days)
      .then(setData)
      .catch((e) => setErr(e?.message ?? "failed"))
      .finally(() => setLoading(false));
  }, [days]);

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

  const dayBars = data.per_day.slice(-30).map((d) => ({
    label: d.day.slice(5),
    value: d.tokens,
  }));
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
        actions={
          <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                type="button"
                onClick={() => setDays(w.days)}
                className={
                  "px-2.5 py-1 text-xs font-semibold rounded " +
                  (days === w.days
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-slate-600 hover:bg-slate-50")
                }
              >
                {w.label}
              </button>
            ))}
          </div>
        }
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
          title={`Tokens per day (${data.window_days}d)`}
          subtitle="Hover bars for exact counts"
          icon={<Activity className="size-4" />}
        >
          {dayBars.length > 0 ? (
            <BarChart
              data={dayBars}
              height={180}
              accent="amber"
              valueFormatter={fmt}
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

      {/* Per-user leaderboard */}
      <Section
        title="Top users"
        subtitle={`${users.length} of ${data.per_user.length}`}
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
        {users.length === 0 ? (
          <Empty label="No users match." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] text-sm admin-table">
              <thead className="bg-slate-50 text-slate-700 text-[11px] font-semibold uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">User</th>
                  <th className="text-right px-4 py-2.5 font-medium">Calls</th>
                  <th className="text-right px-4 py-2.5 font-medium">Prompt</th>
                  <th className="text-right px-4 py-2.5 font-medium">Completion</th>
                  <th className="text-right px-4 py-2.5 font-medium">Total</th>
                  <th className="text-right px-4 py-2.5 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const share = data.total_tokens
                    ? (u.total_tokens / data.total_tokens) * 100
                    : 0;
                  return (
                    <tr key={u.user_id} className="border-t border-slate-100">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="size-8 rounded-full bg-gradient-to-br from-primary to-primary/60 text-white flex items-center justify-center text-xs font-semibold uppercase ring-2 ring-white shadow-sm">
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
        )}
      </Section>
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

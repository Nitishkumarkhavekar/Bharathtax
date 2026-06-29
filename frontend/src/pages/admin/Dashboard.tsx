import { useEffect, useState } from "react";
import {
  Users,
  MessageSquareText,
  Activity,
  IndianRupee,
  KeyRound,
  Armchair,
  TrendingUp,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { AdminDashboard, api } from "@/api";
import {
  BarChart,
  DonutChart,
  PercentBar,
  ProgressRing,
  Section,
  Sparkline,
  StatCard,
} from "@/components/admin/charts";
import { useAuth } from "@/auth";

export default function AdminDashboardPage() {
  const { session } = useAuth();
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.adminDashboard()
      .then(setData)
      .catch((e) => setErr(e?.message ?? "failed"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading label="Loading dashboard…" />;
  if (err || !data) return <ErrorBanner msg={err ?? "no data"} />;

  const queryBars = data.queries_per_day.slice(-14).map((d) => ({
    label: d.day.slice(5),
    value: d.count,
  }));
  const sparkValues = queryBars.map((b) => b.value);
  const lic_total =
    data.licenses_active + data.licenses_expired + data.licenses_deactivated;
  const trend = simpleTrend(sparkValues);
  const seatPct = data.seats_total ? (data.seats_used / data.seats_total) * 100 : 0;

  return (
    <div className="space-y-6 admin-rise">
      {/* Hero banner */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-[#0b1d36] via-[#0f2748] to-[#13325b] text-white shadow-md">
        <div className="absolute inset-0 opacity-30 pointer-events-none" aria-hidden>
          <div className="absolute -top-24 -right-20 size-72 rounded-full bg-sky-400/30 blur-3xl" />
          <div className="absolute -bottom-24 -left-10 size-72 rounded-full bg-violet-400/20 blur-3xl" />
        </div>
        <div className="relative px-5 py-5 sm:px-8 sm:py-7 flex flex-wrap items-center gap-5">
          <div className="min-w-0 flex-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 backdrop-blur text-[11px] font-medium ring-1 ring-white/25 text-white">
              <Sparkles className="size-3" />
              {greeting()} · {fmtDate(new Date())}
            </div>
            <h1 className="mt-2 text-xl sm:text-3xl font-semibold tracking-tight">
              Welcome back, {capitalize(session?.username ?? "Admin")}
            </h1>
            <p className="mt-1.5 text-[13px] sm:text-sm text-white/85 max-w-xl leading-relaxed">
              Here's a real-time overview of usage, revenue and infrastructure. Numbers update on
              every load; the server pane refreshes live.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Pill ok>
                <CheckCircle2 className="size-3.5" /> System operational
              </Pill>
              <Pill>
                <Users className="size-3.5" /> {data.users_total} users
              </Pill>
              <Pill>
                <KeyRound className="size-3.5" /> {data.licenses_active} active license{data.licenses_active === 1 ? "" : "s"}
              </Pill>
              {data.pending_approvals > 0 && (
                <Pill>
                  <Users className="size-3.5" /> {data.pending_approvals} pending approval{data.pending_approvals === 1 ? "" : "s"}
                </Pill>
              )}
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-4 text-white">
            <ProgressRing
              value={seatPct}
              label={`${data.seats_used}/${data.seats_total}`}
              sub="Seats used"
              size={104}
              thickness={11}
              color="#38bdf8"
            />
            <div className="w-44">
              <div className="text-[10.5px] uppercase tracking-wider font-semibold text-white/80">
                Queries (14d)
              </div>
              <div className="text-2xl font-semibold tabular-nums mt-0.5 text-white">
                {sum(sparkValues)}
              </div>
              <div className="-mx-1 -mb-1 mt-1 text-sky-300">
                <Sparkline data={sparkValues.length ? sparkValues : [0, 0]} height={36} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top stat row */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 admin-rise">
        <StatCard
          label="Total users"
          value={data.users_total}
          hint={`${data.users_active} active · ${data.admins} admins`}
          icon={<Users className="size-4" />}
          accent="blue"
        />
        <StatCard
          label="Queries (24h)"
          value={data.queries_24h}
          hint={`${data.queries_7d} this week · ${data.queries_total} all-time`}
          icon={<MessageSquareText className="size-4" />}
          accent="green"
          trend={trend}
          sparkline={sparkValues}
        />
        <StatCard
          label="Revenue (this month)"
          value={inr(data.revenue_month)}
          hint={`Total: ${inr(data.revenue_total)}`}
          icon={<IndianRupee className="size-4" />}
          accent="amber"
        />
        <StatCard
          label="Avg. latency"
          value={
            data.avg_latency_ms != null ? `${(data.avg_latency_ms / 1000).toFixed(2)}s` : "—"
          }
          hint="Last 7 days · primary model"
          icon={<Activity className="size-4" />}
          accent="rose"
        />
      </div>

      {/* Mid row: bars + donut */}
      <div className="grid lg:grid-cols-3 gap-4 admin-rise">
        <Section
          className="lg:col-span-2"
          title="Query volume (14 days)"
          subtitle="Hover bars for exact counts"
          icon={<TrendingUp className="size-4" />}
        >
          {queryBars.length > 0 ? (
            <BarChart data={queryBars} height={185} accent="blue" />
          ) : (
            <Empty label="No queries in this window yet." />
          )}
        </Section>

        <Section
          title="Licenses"
          icon={<KeyRound className="size-4" />}
          subtitle="Active vs expired vs deactivated"
        >
          {lic_total === 0 ? (
            <Empty label="No licenses issued yet." />
          ) : (
            <DonutChart
              size={140}
              thickness={16}
              centerLabel={lic_total}
              centerSub="Total keys"
              segments={[
                { label: "Active", value: data.licenses_active, color: "#10b981" },
                { label: "Expired", value: data.licenses_expired, color: "#f59e0b" },
                { label: "Deactivated", value: data.licenses_deactivated, color: "#94a3b8" },
              ]}
            />
          )}
        </Section>
      </div>

      {/* Bottom row: seats + top questions */}
      <div className="grid lg:grid-cols-2 gap-4 admin-rise">
        <Section
          title="Concurrent seats"
          icon={<Armchair className="size-4" />}
          subtitle="A seat is held while a JWT lease is live"
        >
          <div className="flex items-center gap-5">
            <ProgressRing
              value={seatPct}
              label={`${seatPct.toFixed(0)}%`}
              sub={`${data.seats_used}/${data.seats_total}`}
              size={88}
              color="#0ea5e9"
            />
            <div className="flex-1 space-y-3">
              <PercentBar
                label="In-use across all wings"
                value={data.seats_used}
                max={Math.max(1, data.seats_total)}
                rightLabel={`${data.seats_used}/${data.seats_total}`}
              />
              <div className="grid grid-cols-3 gap-2 text-center">
                <Tile label="Used" value={data.seats_used} tone="blue" />
                <Tile
                  label="Free"
                  value={Math.max(0, data.seats_total - data.seats_used)}
                  tone="green"
                />
                <Tile label="Capacity" value={data.seats_total} tone="slate" />
              </div>
            </div>
          </div>
        </Section>

        <Section
          title="Top questions (7d)"
          icon={<MessageSquareText className="size-4" />}
          subtitle="Most-asked queries this week"
        >
          {data.top_questions.length === 0 ? (
            <Empty label="No queries logged in the last 7 days." />
          ) : (
            <ul className="space-y-2">
              {data.top_questions.map((q, i) => (
                <li
                  key={i}
                  className="group flex items-start gap-3 text-sm border-b border-slate-100 last:border-0 pb-2.5 last:pb-0"
                >
                  <span className="inline-flex items-center justify-center size-6 rounded-lg bg-primary/10 text-primary text-[11px] font-bold">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-slate-700 line-clamp-2 group-hover:text-slate-900 transition-colors">
                    {q.question}
                  </span>
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    ×{q.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

// ---- shared bits used by other admin pages ----
export function Header({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="text-sm text-slate-600 py-12 text-center">
      <div className="inline-flex items-center gap-2 font-medium">
        <span className="size-2 rounded-full bg-primary animate-pulse" />
        {label ?? "Loading…"}
      </div>
    </div>
  );
}

export function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm font-medium px-4 py-3 flex items-start gap-2">
      <AlertCircle className="size-4 mt-0.5 shrink-0" /> {msg}
    </div>
  );
}

export function Empty({ label }: { label: string }) {
  return <div className="text-sm text-slate-500 py-8 text-center font-medium">{label}</div>;
}

export function inr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

// ---- local helpers ----
function Pill({ children, ok }: { children: React.ReactNode; ok?: boolean }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium ring-1 backdrop-blur " +
        (ok
          ? "bg-emerald-400/20 text-emerald-100 ring-emerald-300/40"
          : "bg-white/15 text-white ring-white/25")
      }
    >
      {children}
    </span>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "blue" | "green" | "slate";
}) {
  const map = {
    blue: "bg-sky-50 text-sky-800 ring-sky-200",
    green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    slate: "bg-slate-100 text-slate-800 ring-slate-200",
  } as const;
  return (
    <div className={"rounded-lg ring-1 px-2 py-2 " + map[tone]}>
      <div className="text-[10.5px] font-semibold uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-base font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function simpleTrend(xs: number[]): { value: number; label?: string } | undefined {
  if (xs.length < 4) return undefined;
  const half = Math.floor(xs.length / 2);
  const a = sum(xs.slice(0, half));
  const b = sum(xs.slice(half));
  if (a === 0) return b === 0 ? { value: 0, label: "vs prev" } : { value: 100, label: "vs prev" };
  const pct = ((b - a) / a) * 100;
  return { value: pct, label: "vs prev" };
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

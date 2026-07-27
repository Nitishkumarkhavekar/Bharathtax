import { useEffect, useState } from "react";
import {
  Brain,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  XCircle,
  Clock,
  CircleCheck,
  Server,
  TrendingUp,
  Activity,
  Zap,
  RefreshCw,
} from "lucide-react";
import { AdminModel, AdminModelHealth, api } from "@/api";
import { Empty, ErrorBanner, Header, Loading } from "./Dashboard";
import { BarChart, PercentBar, Section, StatCard } from "@/components/admin/charts";

export default function ModelManagementPage() {
  const [data, setData] = useState<AdminModel | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<AdminModelHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  useEffect(() => {
    api.adminModel()
      .then(setData)
      .catch((e) => setErr(e?.message ?? "failed"))
      .finally(() => setLoading(false));
  }, []);

  function loadHealth() {
    setHealthLoading(true);
    api.adminModelHealth()
      .then(setHealth)
      .catch(() => setHealth(null))
      .finally(() => setHealthLoading(false));
  }
  useEffect(() => {
    loadHealth();
  }, []);

  if (loading) return <Loading label="Loading model details…" />;
  if (err || !data) return <ErrorBanner msg={err ?? "no data"} />;

  const queryBars = data.queries_per_day.slice(-14).map((d) => ({
    label: d.day.slice(5),
    value: d.count,
  }));
  const latencyBars = data.latency_per_day.slice(-14).map((d) => ({
    label: d.day.slice(5),
    value: Math.round(d.latency_ms),
  }));

  return (
    <div className="space-y-6 admin-rise">
      <Header
        title="Model Management"
        subtitle="Performance, traffic and configuration of the connected LLM models."
      />

      <HealthPanel health={health} loading={healthLoading} onRefresh={loadHealth} />

      {/* Gateway status banner */}
      <div
        className={`relative overflow-hidden rounded-2xl border p-5 shadow-sm ${
          data.healthy
            ? "border-emerald-200 bg-emerald-50/60"
            : "border-rose-200 bg-rose-50/60"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`size-11 rounded-xl flex items-center justify-center ring-1 ${
                data.healthy
                  ? "bg-emerald-100 text-emerald-700 ring-emerald-200"
                  : "bg-rose-100 text-rose-700 ring-rose-200"
              }`}
            >
              {data.healthy ? <CircleCheck className="size-5" /> : <AlertCircle className="size-5" />}
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {data.healthy ? "LLM gateway healthy" : "LLM gateway not reachable"}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                <span className="font-mono">{data.backend}</span> · {data.base_url}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">
              Primary · <span className="font-mono">{data.primary_model}</span>
            </span>
            {data.fallback_model && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">
                Fallback · <span className="font-mono">{data.fallback_model}</span>
              </span>
            )}
          </div>
        </div>
        {data.last_error && (
          <div className="mt-3 text-xs rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2">
            {data.last_error}
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 admin-rise">
        <StatCard
          label="Active models"
          value={data.models.length}
          hint="Exposed by LiteLLM"
          icon={<Brain className="size-4" />}
          accent="violet"
        />
        <StatCard
          label="Queries (7d)"
          value={data.models.reduce((a, m) => a + m.queries_7d, 0)}
          hint={`${data.models.reduce((a, m) => a + m.queries_24h, 0)} in 24h`}
          icon={<Clock className="size-4" />}
          accent="green"
        />
        <StatCard
          label="Avg latency"
          value={(() => {
            const xs = data.models
              .map((m) => m.avg_latency_ms)
              .filter((x): x is number => x != null);
            if (!xs.length) return "—";
            const a = xs.reduce((a, b) => a + b, 0) / xs.length;
            return `${(a / 1000).toFixed(2)}s`;
          })()}
          hint="Last 7 days"
          icon={<Server className="size-4" />}
          accent="amber"
        />
        <StatCard
          label="Success rate"
          value={(() => {
            const primary = data.models.find((m) => m.is_primary);
            return primary ? `${primary.success_rate.toFixed(1)}%` : "—";
          })()}
          hint="Grounded answers / total"
          icon={<CheckCircle2 className="size-4" />}
          accent="rose"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 admin-rise">
        <Section title="Query volume per day" icon={<TrendingUp className="size-4" />}>
          {queryBars.length > 0 ? (
            <BarChart data={queryBars} accent="blue" />
          ) : (
            <Empty label="No queries yet." />
          )}
        </Section>
        <Section title="Average latency (ms) per day" icon={<Clock className="size-4" />}>
          {latencyBars.length > 0 ? (
            <BarChart data={latencyBars} accent="amber" />
          ) : (
            <Empty label="No latency data." />
          )}
        </Section>
      </div>

      <Section title="Per-model breakdown" icon={<Brain className="size-4" />}>
        <div className="space-y-4">
          {data.models.map((m) => (
            <div
              key={m.id}
              className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-mono text-sm text-slate-900">{m.id}</div>
                {m.is_primary && (
                  <span className="px-2 py-0.5 text-[10.5px] font-semibold rounded bg-primary/10 text-primary tracking-wide">
                    PRIMARY
                  </span>
                )}
                {m.is_fallback && (
                  <span className="px-2 py-0.5 text-[10.5px] font-semibold rounded bg-amber-100 text-amber-700 tracking-wide">
                    FALLBACK
                  </span>
                )}
              </div>
              <div className="grid sm:grid-cols-3 gap-4 text-sm">
                <Metric
                  label="Queries (7d / 24h / all)"
                  value={`${m.queries_7d} · ${m.queries_24h} · ${m.queries_total}`}
                />
                <Metric
                  label="Avg latency"
                  value={m.avg_latency_ms != null ? `${(m.avg_latency_ms / 1000).toFixed(2)} s` : "—"}
                />
                <Metric label="Success rate" value={`${m.success_rate.toFixed(1)}%`} />
              </div>
              <PercentBar
                label="Success rate"
                value={m.success_rate}
                max={100}
                tone={m.success_rate > 90 ? "ok" : m.success_rate > 70 ? "warn" : "bad"}
              />
            </div>
          ))}
          {data.models.length === 0 && <Empty label="No models registered." />}
        </div>
      </Section>
    </div>
  );
}

function statusStyle(st: string) {
  if (st === "ok")
    return { dot: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-700 ring-emerald-200", label: "Operational", Icon: CheckCircle2 };
  if (st === "degraded")
    return { dot: "bg-amber-500", chip: "bg-amber-100 text-amber-700 ring-amber-200", label: "Degraded", Icon: AlertTriangle };
  return { dot: "bg-rose-500", chip: "bg-rose-100 text-rose-700 ring-rose-200", label: "Down", Icon: XCircle };
}

function HealthPanel({
  health,
  loading,
  onRefresh,
}: {
  health: AdminModelHealth | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const active = health?.active_generation;
  const activeLabel =
    active === "gemini" ? "Gemini" : active === "local" ? "Local model" : "None available";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4 admin-rise">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-900">Model status</h3>
          {active && (
            <span
              className={`ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                active === "none" ? "bg-rose-100 text-rose-700" : "bg-indigo-100 text-indigo-700"
              }`}
            >
              <Zap className="size-3" /> Serving: {activeLabel}
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {health?.alert && (
        <div
          className={`rounded-lg px-3.5 py-2.5 text-[12.5px] flex items-start gap-2 ${
            health.alert.level === "critical"
              ? "bg-rose-50 ring-1 ring-rose-200 text-rose-800"
              : "bg-amber-50 ring-1 ring-amber-200 text-amber-800"
          }`}
        >
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">
              {health.alert.level === "critical" ? "Critical: " : "Warning: "}
            </span>
            {health.alert.message}
          </div>
        </div>
      )}

      {!health ? (
        <div className="text-xs text-slate-400">
          {loading ? "Checking model health…" : "Could not load model health."}
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            {health.services.map((svc) => {
              const st = statusStyle(svc.status);
              return (
                <div key={svc.key} className="rounded-xl border border-slate-200 p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`size-2.5 rounded-full ${st.dot} shrink-0`} />
                      <span className="text-sm font-medium text-slate-900 truncate">{svc.name}</span>
                    </div>
                    <span
                      className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold ring-1 ${st.chip}`}
                    >
                      <st.Icon className="size-3" /> {st.label}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">{svc.role}</div>
                  {svc.detail && <div className="text-xs text-slate-700">{svc.detail}</div>}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-slate-400">
                    {svc.latency_ms != null && <span>⏱ {Math.round(svc.latency_ms)} ms</span>}
                    {svc.models.length > 0 && (
                      <span className="font-mono truncate max-w-full">{svc.models.join(", ")}</span>
                    )}
                  </div>
                  {svc.endpoint && (
                    <div className="font-mono text-[10px] text-slate-400 truncate">{svc.endpoint}</div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="text-[10.5px] text-slate-400">
            Last checked {new Date(health.checked_at).toLocaleTimeString()}
          </div>
        </>
      )}
    </div>
  );
}


function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white border border-slate-200 px-3 py-2">
      <div className="text-[10.5px] uppercase tracking-wider text-slate-500 font-medium">
        {label}
      </div>
      <div className="font-mono text-slate-900 mt-0.5 text-[13.5px]">{value}</div>
    </div>
  );
}

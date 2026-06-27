import { useEffect, useState } from "react";
import {
  Brain,
  CheckCircle2,
  AlertCircle,
  Clock,
  CircleCheck,
  Server,
  TrendingUp,
} from "lucide-react";
import { AdminModel, api } from "@/api";
import { Empty, ErrorBanner, Header, Loading } from "./Dashboard";
import { BarChart, PercentBar, Section, StatCard } from "@/components/admin/charts";

export default function ModelManagementPage() {
  const [data, setData] = useState<AdminModel | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.adminModel()
      .then(setData)
      .catch((e) => setErr(e?.message ?? "failed"))
      .finally(() => setLoading(false));
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

      {/* Gateway status banner */}
      <div
        className={`relative overflow-hidden rounded-2xl border p-5 shadow-sm ${
          data.healthy
            ? "border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-white"
            : "border-rose-200 bg-gradient-to-br from-rose-50/80 to-white"
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
              className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50/60 to-white p-4 space-y-3"
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

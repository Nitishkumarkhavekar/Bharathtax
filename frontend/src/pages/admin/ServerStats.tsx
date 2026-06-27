import { useEffect, useState } from "react";
import {
  Cpu,
  HardDrive,
  Network,
  Activity,
  Server,
  Clock,
  Container,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { AdminServer, api } from "@/api";
import { Empty, ErrorBanner, Header, Loading } from "./Dashboard";
import { PercentBar, ProgressRing, Section, StatCard } from "@/components/admin/charts";

export default function ServerStatsPage() {
  const [data, setData] = useState<AdminServer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      api.adminServer()
        .then((d) => {
          if (alive) setData(d);
        })
        .catch((e) => {
          if (alive) setErr(e?.message ?? "failed");
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    tick();
    const id = setInterval(tick, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (loading) return <Loading label="Loading model server stats…" />;
  if (err || !data) return <ErrorBanner msg={err ?? "no data"} />;

  return (
    <div className="space-y-6 admin-rise">
      <Header
        title="Model Server"
        subtitle="Live system metrics for the host running the BharathTax web app. Auto-refreshes every 8s."
        actions={
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ring-1 ${
              data.healthy
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : "bg-rose-50 text-rose-700 ring-rose-200"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                data.healthy ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
              }`}
            />
            {data.healthy ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
            {data.healthy ? "Healthy" : "Degraded"}
          </span>
        }
      />

      {/* Top stats */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 admin-rise">
        <StatCard
          label="CPU"
          value={`${data.cpu_percent.toFixed(1)}%`}
          hint={`${data.cpu_count} cores · load ${data.load_avg.map((l) => l.toFixed(2)).join(" / ")}`}
          icon={<Cpu className="size-4" />}
          accent={data.cpu_percent < 75 ? "blue" : "amber"}
        />
        <StatCard
          label="Memory"
          value={`${data.mem_percent.toFixed(1)}%`}
          hint={`${(data.mem_used_mb / 1024).toFixed(1)} / ${(data.mem_total_mb / 1024).toFixed(1)} GB`}
          icon={<Activity className="size-4" />}
          accent={data.mem_percent < 80 ? "green" : "amber"}
        />
        <StatCard
          label="Disk"
          value={`${data.disk_percent.toFixed(1)}%`}
          hint={`${data.disk_used_gb.toFixed(1)} / ${data.disk_total_gb.toFixed(1)} GB`}
          icon={<HardDrive className="size-4" />}
          accent={data.disk_percent < 80 ? "violet" : "amber"}
        />
        <StatCard
          label="Uptime"
          value={fmtUptime(data.uptime_seconds)}
          hint={`${data.process_count.toLocaleString()} processes`}
          icon={<Clock className="size-4" />}
          accent="slate"
        />
      </div>

      {/* Resource gauges */}
      <Section
        title="Resource usage"
        icon={<Server className="size-4" />}
        subtitle="Live gauges and progress bars across the host"
      >
        <div className="grid sm:grid-cols-4 gap-4">
          <Gauge
            label="CPU"
            pct={data.cpu_percent}
            color="#0ea5e9"
            sub={`${data.cpu_count} cores`}
          />
          <Gauge
            label="Memory"
            pct={data.mem_percent}
            color="#10b981"
            sub={`${(data.mem_used_mb / 1024).toFixed(1)}/${(data.mem_total_mb / 1024).toFixed(1)} GB`}
          />
          <Gauge
            label="Disk"
            pct={data.disk_percent}
            color="#8b5cf6"
            sub={`${data.disk_used_gb.toFixed(1)}/${data.disk_total_gb.toFixed(1)} GB`}
          />
          <Gauge
            label="Swap"
            pct={data.swap_percent}
            color="#f59e0b"
            sub={`${data.swap_used_mb.toFixed(0)} MB`}
          />
        </div>
        <div className="mt-5 space-y-3">
          <PercentBar label="CPU" value={data.cpu_percent} />
          <PercentBar
            label="Memory"
            value={data.mem_percent}
            rightLabel={`${(data.mem_used_mb / 1024).toFixed(1)}/${(data.mem_total_mb / 1024).toFixed(1)} GB`}
          />
          <PercentBar
            label="Disk"
            value={data.disk_percent}
            rightLabel={`${data.disk_used_gb.toFixed(1)}/${data.disk_total_gb.toFixed(1)} GB`}
          />
          <PercentBar
            label="Swap"
            value={data.swap_percent}
            rightLabel={`${data.swap_used_mb.toFixed(0)} MB`}
          />
        </div>
      </Section>

      <Section title="Network & LLM" icon={<Network className="size-4" />}>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <Stat name="Bytes sent" value={fmtBytes(data.network_bytes_sent)} />
          <Stat name="Bytes received" value={fmtBytes(data.network_bytes_recv)} />
          <Stat
            name="LLM endpoint"
            value={
              data.llm_endpoint_healthy ? (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  healthy
                </span>
              ) : (
                <span className="text-rose-700">unreachable</span>
              )
            }
          />
          <Stat
            name="LLM latency"
            value={
              data.llm_endpoint_latency_ms != null
                ? `${data.llm_endpoint_latency_ms.toFixed(0)} ms`
                : "—"
            }
          />
        </div>
      </Section>

      <Section
        title={`Docker containers (${data.containers.length})`}
        icon={<Container className="size-4" />}
      >
        {data.containers.length === 0 ? (
          <Empty label="No container info available (docker.sock not mounted into api container)." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm admin-table">
              <thead className="bg-slate-50 text-slate-700 text-[11px] font-semibold uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Name</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-left px-4 py-2.5 font-medium">Image</th>
                </tr>
              </thead>
              <tbody>
                {data.containers.map((c, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-4 py-2.5 font-mono text-slate-800">{c.name}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium ${
                          c.status === "running"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {c.status === "running" && (
                          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        )}
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 font-mono text-xs">{c.image}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function Gauge({
  label,
  pct,
  color,
  sub,
}: {
  label: string;
  pct: number;
  color: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50/60 to-white p-4 flex items-center gap-4">
      <ProgressRing
        value={pct}
        label={`${pct.toFixed(0)}%`}
        size={64}
        thickness={8}
        color={color}
      />
      <div className="min-w-0">
        <div className="text-xs text-slate-500 uppercase tracking-wider font-medium">{label}</div>
        {sub && <div className="text-[11px] text-slate-600 mt-0.5 font-mono">{sub}</div>}
      </div>
    </div>
  );
}

function Stat({ name, value }: { name: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{name}</div>
      <div className="font-medium text-slate-900 mt-0.5">{value}</div>
    </div>
  );
}

function fmtBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

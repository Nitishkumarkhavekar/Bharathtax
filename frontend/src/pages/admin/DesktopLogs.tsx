import { useEffect, useMemo, useState } from "react";
import { Users, Clock, MonitorSmartphone } from "lucide-react";
import { DesktopSessionRow, DesktopUserRollup, api } from "@/api";
import { Empty, ErrorBanner, Header, Loading } from "./Dashboard";
import { Section } from "@/components/admin/charts";

function fmtDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return "0m";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtDT(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—";
}

export default function DesktopLogsPage() {
  const [users, setUsers] = useState<DesktopUserRollup[] | null>(null);
  const [sessions, setSessions] = useState<DesktopSessionRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [activeUser, setActiveUser] = useState<number | null>(null);

  useEffect(() => {
    api.adminDesktopSessionsSummary().then((r) => setUsers(r.users)).catch((e) => setErr(e?.message ?? "load failed"));
    api.adminDesktopSessions({ limit: 200 }).then((r) => setSessions(r.sessions)).catch((e) => setErr(e?.message ?? "load failed"));
  }, []);

  const filtered = useMemo(() => {
    if (!users) return [];
    const t = q.trim().toLowerCase();
    if (!t) return users;
    return users.filter((u) => (u.username ?? "").toLowerCase().includes(t)
      || (u.full_name ?? "").toLowerCase().includes(t)
      || (u.email ?? "").toLowerCase().includes(t));
  }, [users, q]);

  const activeSessions = useMemo(() => {
    if (!sessions) return [];
    if (activeUser === null) return sessions;
    return sessions.filter((s) => s.user_id === activeUser);
  }, [sessions, activeUser]);

  if (err) return <ErrorBanner msg={err} />;
  if (!users || !sessions) return <Loading label="Loading logs…" />;

  const totalUsers = users.length;
  const openSessions = sessions.filter((s) => s.still_open).length;
  const totalSessions = sessions.length;
  const totalHours = sessions.reduce((a, s) => a + (s.duration_seconds ?? 0), 0) / 3600;

  return (
    <div className="space-y-4">
      <Header
        title="Desktop user logs"
        subtitle="Which officers use the desktop app, when they sign in / out, how long they stay, and what they did."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SumCard label="Users" value={totalUsers} icon={<Users className="size-4" />} />
        <SumCard label="Sessions" value={totalSessions} icon={<MonitorSmartphone className="size-4" />} />
        <SumCard label="Active now" value={openSessions} icon={<Clock className="size-4" />} tone={openSessions ? "emerald" : "slate"} />
        <SumCard label="Total time" value={`${totalHours.toFixed(1)}h`} icon={<Clock className="size-4" />} />
      </div>

      <div className="grid grid-cols-[420px_1fr] gap-4">
        <Section title="Per user" icon={<Users className="size-4" />}
          action={
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
              className="w-40 h-8 px-2 rounded border border-slate-200 text-xs focus:outline-none focus:border-primary" />
          }>
          <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-700 text-[11px] font-semibold uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2">Officer</th>
                  <th className="text-right px-3 py-2">Sessions</th>
                  <th className="text-right px-3 py-2">Time</th>
                  <th className="text-left px-3 py-2">Last active</th>
                </tr>
              </thead>
              <tbody>
                <tr className={!activeUser ? "bg-primary/5" : ""}>
                  <td colSpan={4} className="px-3 py-2 border-t border-slate-100">
                    <button onClick={() => setActiveUser(null)} className="text-[12.5px] font-medium text-primary hover:text-primary/80">
                      Show all sessions →
                    </button>
                  </td>
                </tr>
                {filtered.map((u) => {
                  const on = activeUser === u.user_id;
                  return (
                    <tr key={u.user_id} className={"border-t border-slate-100 cursor-pointer " + (on ? "bg-primary/5" : "hover:bg-slate-50")}
                        onClick={() => setActiveUser(u.user_id)}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">{u.full_name || u.username}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2">
                          @{u.username}
                          {u.open_sessions > 0 && <span className="inline-flex items-center gap-1 text-emerald-700"><span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" /> online</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{u.sessions}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtDuration(u.seconds)}</td>
                      <td className="px-3 py-2 text-[12.5px] text-slate-500">{fmtDT(u.last_started_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title={activeUser ? "Sessions" : "All sessions"} icon={<Clock className="size-4" />}>
          {activeSessions.length === 0 ? (
            <Empty label="No sessions logged yet." />
          ) : (
            <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-700 text-[11px] font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2">Officer</th>
                    <th className="text-left px-3 py-2">Started</th>
                    <th className="text-left px-3 py-2">Ended</th>
                    <th className="text-right px-3 py-2">Duration</th>
                    <th className="text-right px-3 py-2">Actions</th>
                    <th className="text-left px-3 py-2">Last action</th>
                    <th className="text-left px-3 py-2">Version · IP</th>
                  </tr>
                </thead>
                <tbody>
                  {activeSessions.map((s) => (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-[12.5px]">
                        <div className="font-medium text-slate-900">{s.full_name || s.username}</div>
                        <div className="text-[11px] text-slate-500">@{s.username}</div>
                      </td>
                      <td className="px-3 py-2 text-[12.5px] text-slate-600 whitespace-nowrap">{fmtDT(s.started_at)}</td>
                      <td className="px-3 py-2 text-[12.5px] text-slate-600 whitespace-nowrap">
                        {s.still_open ? <span className="inline-flex items-center gap-1 text-emerald-700"><span className="size-1.5 rounded-full bg-emerald-500 animate-pulse"/> still on</span> : fmtDT(s.ended_at)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-[12.5px]">{fmtDuration(s.duration_seconds)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[12.5px]">{s.action_count}</td>
                      <td className="px-3 py-2 text-[12.5px] text-slate-500">{s.last_action || "—"}</td>
                      <td className="px-3 py-2 text-[12.5px] text-slate-500">
                        {s.client_version ? `v${s.client_version}` : "—"}<br/>
                        <span className="font-mono">{s.ip_address || "—"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function SumCard({ label, value, icon, tone = "slate" }: {
  label: string; value: number | string; icon: React.ReactNode;
  tone?: "slate" | "emerald";
}) {
  const bg = tone === "emerald" ? "bg-emerald-50 ring-emerald-200 text-emerald-800" : "bg-white ring-slate-200 text-slate-800";
  return (
    <div className={"rounded-xl ring-1 shadow-sm p-4 " + bg}>
      <div className="flex items-center gap-2">
        <div className="size-8 rounded-lg bg-white ring-1 ring-slate-200 grid place-items-center">{icon}</div>
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] opacity-70">{label}</div>
          <div className="text-[20px] font-semibold leading-none mt-0.5 tabular-nums">{value}</div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock, Plus, Trash2, Check, AlarmClock, X, RefreshCw, FolderOpen, Info,
} from "lucide-react";
import { api, WsMatter, WsDeadline, WsRuleCatalogue } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type MatterDetail = WsMatter & { deadlines: WsDeadline[] };

const CATEGORIES = [
  { v: "officer", l: "Assessing Officer" },
  { v: "cita", l: "CIT(A) / NFAC" },
  { v: "drp", l: "DRP" },
  { v: "investigation", l: "Investigation" },
  { v: "ici", l: "I&CI" },
  { v: "tds", l: "TDS / Exemptions" },
  { v: "ca", l: "CA / Advocate" },
  { v: "other", l: "Other" },
];

const todayISO = () => new Date().toISOString().slice(0, 10);

function daysUntil(iso: string): number {
  const d = new Date(iso + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86_400_000);
}
function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}
function urgency(days: number): { tag: string; tone: "rose" | "amber" | "emerald" } {
  if (days < 0) return { tag: "Overdue", tone: "rose" };
  if (days <= 7) return { tag: `${days}d left`, tone: "rose" };
  if (days <= 30) return { tag: `${days}d left`, tone: "amber" };
  return { tag: `${days}d`, tone: "emerald" };
}
const TONE_CHIP: Record<string, string> = {
  rose: "bg-rose-50 text-rose-700 ring-rose-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};
const TONE_BADGE: Record<string, string> = {
  rose: "bg-rose-50 text-rose-600 ring-rose-200",
  amber: "bg-amber-50 text-amber-600 ring-amber-200",
  emerald: "bg-emerald-50 text-emerald-600 ring-emerald-200",
};

/** A single deadline line — used in both the upcoming agenda and matter view. */
function DeadlineRow({
  d, matterTitle, onDone, onDelete,
}: {
  d: WsDeadline; matterTitle?: string;
  onDone: () => void; onDelete: () => void;
}) {
  const days = daysUntil(d.due_date);
  const u = urgency(days);
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <div className={cn(
        "shrink-0 w-14 h-14 rounded-xl ring-1 flex flex-col items-center justify-center leading-none",
        TONE_BADGE[u.tone],
      )}>
        <span className="text-lg font-bold tabular-nums">
          {new Date(d.due_date + "T00:00:00").getDate()}
        </span>
        <span className="text-[9px] font-bold uppercase tracking-wide">
          {new Date(d.due_date + "T00:00:00").toLocaleDateString("en-IN", { month: "short" })}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-slate-900 truncate">{d.label}</div>
        <div className="text-[11.5px] text-slate-500 truncate">
          {d.section_ref && <span className="font-medium text-slate-600">{d.section_ref}</span>}
          {d.section_ref && (matterTitle || d.trigger_date) ? " · " : ""}
          {matterTitle && <span>{matterTitle}</span>}
          {matterTitle && d.trigger_date ? " · " : ""}
          {d.trigger_date && <span>from {fmtDate(d.trigger_date)}</span>}
        </div>
      </div>
      <span className={cn(
        "shrink-0 text-[10.5px] font-bold px-2 py-1 rounded-full ring-1 tabular-nums",
        TONE_CHIP[u.tone],
      )}>
        {u.tag}
      </span>
      <div className="shrink-0 flex items-center gap-0.5">
        <button
          onClick={onDone} title="Mark done"
          className="p-1.5 rounded-md text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
        >
          <Check className="size-4" />
        </button>
        <button
          onClick={onDelete} title="Delete"
          className="p-1.5 rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  );
}

export default function Workspace() {
  const { confirm, dialog } = useConfirm();
  const [rules, setRules] = useState<WsRuleCatalogue | null>(null);
  const [matters, setMatters] = useState<WsMatter[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MatterDetail | null>(null);
  const [upcoming, setUpcoming] = useState<WsDeadline[]>([]);
  const [loading, setLoading] = useState(true);

  // new-matter form
  const [showNew, setShowNew] = useState(false);
  const [nm, setNm] = useState({ title: "", pan: "", assessment_year: "", category: "officer" });

  // compute form
  const [trigger, setTrigger] = useState("");
  const [triggerDate, setTriggerDate] = useState(todayISO());

  const refreshUpcoming = async () => {
    const start = todayISO();
    const end = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
    setUpcoming(await api.wsCalendar(start, end, false));
  };
  const refreshMatters = async () => setMatters(await api.wsMatters());
  const loadDetail = async (id: number) => setDetail(await api.wsMatter(id));

  useEffect(() => {
    (async () => {
      try {
        const [r] = await Promise.all([api.wsLimitationRules(), refreshMatters(), refreshUpcoming()]);
        setRules(r);
        if (r.triggers[0]) setTrigger(r.triggers[0].id);
      } catch (e: any) {
        toast.error(e?.message || "Could not load your workspace.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = async (id: number) => {
    setSelectedId(id);
    try { await loadDetail(id); } catch { /* */ }
  };

  const createMatter = async () => {
    if (!nm.title.trim()) { toast.error("Give the matter a title."); return; }
    try {
      const m = await api.wsCreateMatter({
        title: nm.title.trim(),
        pan: nm.pan.trim() || null,
        assessment_year: nm.assessment_year.trim() || null,
        category: nm.category,
      });
      setNm({ title: "", pan: "", assessment_year: "", category: "officer" });
      setShowNew(false);
      await refreshMatters();
      await select(m.id);
      toast.success("Matter created.");
    } catch (e: any) { toast.error(e?.message || "Could not create the matter."); }
  };

  const compute = async () => {
    if (!selectedId || !trigger || !triggerDate) return;
    try {
      const res = await api.wsComputeDeadlines(selectedId, trigger, triggerDate);
      await Promise.all([loadDetail(selectedId), refreshUpcoming()]);
      toast.success(
        res.created.length
          ? `Computed ${res.created.length} deadline${res.created.length > 1 ? "s" : ""}.`
          : "No statutory deadline maps to that trigger.",
      );
    } catch (e: any) { toast.error(e?.message || "Could not compute deadlines."); }
  };

  const markDone = async (d: WsDeadline) => {
    try {
      await api.wsUpdateDeadline(d.id, { status: "done" });
      await Promise.all([selectedId ? loadDetail(selectedId) : Promise.resolve(), refreshUpcoming()]);
    } catch (e: any) { toast.error(e?.message || "Could not update the deadline."); }
  };

  const removeDeadline = async (d: WsDeadline) => {
    const ok = await confirm({
      title: "Delete this deadline?",
      description: <span>“{d.label}” will be removed from your calendar.</span>,
      tone: "danger", confirmLabel: "Delete",
    });
    if (!ok) return;
    try {
      await api.wsDeleteDeadline(d.id);
      await Promise.all([selectedId ? loadDetail(selectedId) : Promise.resolve(), refreshUpcoming()]);
    } catch (e: any) { toast.error(e?.message || "Could not delete the deadline."); }
  };

  const removeMatter = async (m: WsMatter) => {
    const ok = await confirm({
      title: "Delete this matter?",
      description: <span>“{m.title}” and all its deadlines and reminders will be permanently removed.</span>,
      tone: "danger", confirmLabel: "Delete matter",
    });
    if (!ok) return;
    try {
      await api.wsDeleteMatter(m.id);
      if (selectedId === m.id) { setSelectedId(null); setDetail(null); }
      await Promise.all([refreshMatters(), refreshUpcoming()]);
      toast.success("Matter deleted.");
    } catch (e: any) { toast.error(e?.message || "Could not delete the matter."); }
  };

  const stats = useMemo(() => {
    const overdue = upcoming.filter((d) => daysUntil(d.due_date) < 0).length;
    const soon = upcoming.filter((d) => { const n = daysUntil(d.due_date); return n >= 0 && n <= 30; }).length;
    return { overdue, soon, total: upcoming.length };
  }, [upcoming]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="size-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <CalendarClock className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 leading-tight">Your Desk</h1>
          <p className="text-[13px] text-slate-500">
            Track your matters and never miss a statutory deadline — computed from the section itself.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatPill label="Next 30 days" value={stats.soon} tone="amber" />
          <StatPill label="Overdue" value={stats.overdue} tone="rose" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">
        {/* Matters column */}
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-3">
          <div className="flex items-center justify-between px-1 mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">My Matters</span>
            <button
              onClick={() => setShowNew((s) => !s)}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
            >
              {showNew ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
              {showNew ? "Close" : "New"}
            </button>
          </div>

          {showNew && (
            <div className="mb-3 p-3 rounded-xl bg-slate-50 ring-1 ring-slate-200 space-y-2">
              <Input placeholder="Matter title (e.g. ABC Pvt Ltd — scrutiny)"
                value={nm.title} onChange={(e) => setNm({ ...nm, title: e.target.value })} />
              <div className="flex gap-2">
                <Input placeholder="PAN" value={nm.pan}
                  onChange={(e) => setNm({ ...nm, pan: e.target.value.toUpperCase() })} />
                <Input placeholder="AY 2023-24" value={nm.assessment_year}
                  onChange={(e) => setNm({ ...nm, assessment_year: e.target.value })} />
              </div>
              <select
                className="w-full h-9 rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-700"
                value={nm.category} onChange={(e) => setNm({ ...nm, category: e.target.value })}
              >
                {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
              <Button className="w-full" onClick={createMatter}>Create matter</Button>
            </div>
          )}

          <div className="space-y-1 max-h-[60vh] overflow-y-auto chat-scrollbar">
            {loading && <div className="text-[13px] text-slate-400 px-1 py-6 text-center">Loading…</div>}
            {!loading && matters.length === 0 && (
              <div className="text-[12.5px] text-slate-400 px-2 py-6 text-center">
                No matters yet. Add one to start tracking deadlines.
              </div>
            )}
            {matters.map((m) => (
              <button
                key={m.id}
                onClick={() => select(m.id)}
                className={cn(
                  "group w-full text-left px-2.5 py-2 rounded-lg transition-colors",
                  selectedId === m.id ? "bg-primary/10 ring-1 ring-primary/20" : "hover:bg-slate-100",
                )}
              >
                <div className="flex items-center gap-2">
                  <FolderOpen className={cn("size-4 shrink-0", selectedId === m.id ? "text-primary" : "text-slate-400")} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-slate-800">{m.title}</span>
                </div>
                <div className="mt-0.5 pl-6 text-[11px] text-slate-500 truncate">
                  {[m.pan, m.assessment_year, CATEGORIES.find((c) => c.v === m.category)?.l]
                    .filter(Boolean).join(" · ") || "—"}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5 min-w-0">
          {/* Upcoming agenda — the limitation calendar */}
          <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-4 sm:p-5">
            <div className="flex items-center gap-2 mb-1">
              <AlarmClock className="size-[18px] text-primary" />
              <h2 className="text-[15px] font-bold text-slate-900">Upcoming Deadlines</h2>
              <span className="text-[11px] text-slate-400">next 120 days</span>
              <button onClick={() => refreshUpcoming()} title="Refresh"
                className="ml-auto p-1.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <RefreshCw className="size-4" />
              </button>
            </div>
            {upcoming.length === 0 ? (
              <div className="py-8 text-center text-[13px] text-slate-400">
                Nothing due. Select a matter and compute its statutory dates.
              </div>
            ) : (
              <div>
                {upcoming.map((d) => (
                  <DeadlineRow
                    key={d.id} d={d}
                    matterTitle={matters.find((m) => m.id === d.matter_id)?.title}
                    onDone={() => markDone(d)} onDelete={() => removeDeadline(d)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Selected matter — compute + its deadlines */}
          {detail ? (
            <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-4 sm:p-5">
              <div className="flex items-start gap-2 mb-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-bold text-slate-900 truncate">{detail.title}</h2>
                  <p className="text-[11.5px] text-slate-500">
                    {[detail.pan, detail.assessment_year, CATEGORIES.find((c) => c.v === detail.category)?.l]
                      .filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <button onClick={() => removeMatter(detail)} title="Delete matter"
                  className="ml-auto p-1.5 rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                  <Trash2 className="size-4" />
                </button>
              </div>

              {/* Compute deadlines from a trigger */}
              <div className="p-3 rounded-xl bg-primary/5 ring-1 ring-primary/15 mb-4">
                <div className="flex items-center gap-1.5 mb-2 text-[12px] font-semibold text-primary">
                  <CalendarClock className="size-4" /> Compute statutory deadlines
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    className="flex-1 h-9 rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-700"
                    value={trigger} onChange={(e) => setTrigger(e.target.value)}
                  >
                    {rules?.triggers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  <Input type="date" className="sm:w-40" value={triggerDate}
                    onChange={(e) => setTriggerDate(e.target.value)} />
                  <Button onClick={compute}>Compute</Button>
                </div>
                <p className="mt-1.5 flex items-start gap-1 text-[11px] text-slate-500">
                  <Info className="size-3.5 mt-px shrink-0" />
                  Enter one trigger date; every downstream deadline is computed, section-cited and added below.
                </p>
              </div>

              {/* This matter's deadlines */}
              {detail.deadlines.length === 0 ? (
                <div className="py-6 text-center text-[13px] text-slate-400">
                  No deadlines yet — compute them from a trigger above.
                </div>
              ) : (
                <div>
                  {detail.deadlines.map((d) => (
                    <DeadlineRow key={d.id} d={d}
                      onDone={() => markDone(d)} onDelete={() => removeDeadline(d)} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-[13px] text-slate-400">
              Select a matter on the left to compute its limitation calendar.
            </div>
          )}
        </div>
      </div>
      {dialog}
    </div>
  );
}

function StatPill({ label, value, tone }: { label: string; value: number; tone: "amber" | "rose" }) {
  const cls = tone === "rose"
    ? "bg-rose-50 text-rose-700 ring-rose-200"
    : "bg-amber-50 text-amber-700 ring-amber-200";
  return (
    <div className={cn("px-3 py-1.5 rounded-xl ring-1 text-center", cls)}>
      <div className="text-base font-bold leading-none tabular-nums">{value}</div>
      <div className="text-[9.5px] font-semibold uppercase tracking-wide mt-0.5 opacity-80">{label}</div>
    </div>
  );
}

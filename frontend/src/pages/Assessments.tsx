import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  Stamp,
  Plus,
  ArrowRight,
  Search,
  FileText,
  IdCard,
  CalendarDays,
  Scale,
  Loader2,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ClipboardList,
  ChevronDown,
  Square,
  Pencil,
  Trash2,
  X,
  Check,
} from "lucide-react";
import { api } from "../api";

const STATUS_META: Record<
  string,
  { label: string; dot: string; chip: string; icon: typeof CheckCircle2 }
> = {
  new: {
    label: "New",
    dot: "bg-slate-400 shadow-[0_0_0_3px_rgba(148,163,184,0.2)]",
    chip: "bg-slate-100 text-slate-700 ring-slate-200",
    icon: ClipboardList,
  },
  running: {
    label: "Running",
    dot: "bg-brand-orange shadow-[0_0_0_3px_rgba(239,138,46,0.22)] animate-pulse",
    chip: "bg-brand-orange/10 text-brand-orange ring-brand-orange/25",
    icon: Loader2,
  },
  ready: {
    label: "Ready",
    dot: "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.22)]",
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    icon: CheckCircle2,
  },
  error: {
    label: "Error",
    dot: "bg-rose-500 shadow-[0_0_0_3px_rgba(244,63,94,0.22)]",
    chip: "bg-rose-50 text-rose-700 ring-rose-200",
    icon: AlertTriangle,
  },
};

export default function Assessments() {
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ title: "", assessment_year: "", pan: "", section: "" });
  const [err, setErr] = useState("");
  const [busyCreate, setBusyCreate] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "new" | "running" | "ready" | "error">("all");
  const [formOpen, setFormOpen] = useState(true);

  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  const load = () => {
    setLoading(true);
    return api
      .asmtCases()
      .then((rows) => setCases(rows))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!f.title.trim()) return;
    setBusyCreate(true);
    setErr("");
    try {
      await api.asmtCreateCase({
        ...f,
        assessment_year: f.assessment_year || null,
        pan: f.pan || null,
        section: f.section || null,
      });
      setF({ title: "", assessment_year: "", pan: "", section: "" });
      await load();
      toast.success("Assessment case created");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to create case.");
      toast.error(e?.message ?? "Failed to create case.");
    } finally {
      setBusyCreate(false);
    }
  }

  const stats = useMemo(() => {
    const c = { total: cases.length, running: 0, ready: 0, drafts: 0, error: 0 };
    for (const x of cases) {
      if (x.status === "running") c.running++;
      else if (x.status === "ready") c.ready++;
      else if (x.status === "error") c.error++;
      else c.drafts++;
    }
    return c;
  }, [cases]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return cases.filter((c) => {
      if (filter !== "all" && (c.status || "new") !== filter) return false;
      if (!term) return true;
      const hay = `${c.title} ${c.pan ?? ""} ${c.assessment_year ?? ""} ${c.section ?? ""}`.toLowerCase();
      return hay.includes(term);
    });
  }, [cases, q, filter]);

  return (
    <div className="space-y-4">
      <HeroHeader />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total cases" value={stats.total} hint={`${stats.drafts} draft${stats.drafts === 1 ? "" : "s"}`} tone="indigo" icon={<FileText className="size-4" />} />
        <KpiCard label="Running" value={stats.running} hint="pipeline in progress" tone="sky" icon={<Loader2 className={stats.running > 0 ? "size-4 animate-spin" : "size-4"} />} />
        <KpiCard label="Ready" value={stats.ready} hint="orders drafted" tone="emerald" icon={<CheckCircle2 className="size-4" />} />
        <KpiCard label="Needs attention" value={stats.error} hint={stats.error > 0 ? "errored runs" : "no errors"} tone="rose" icon={<AlertTriangle className="size-4" />} />
      </div>

      <section className="rounded-2xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setFormOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200/80 hover:from-primary/[0.06] transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center ring-1 ring-primary/15">
              <Plus className="size-4" />
            </div>
            <div className="text-left">
              <div className="text-[14px] font-semibold text-slate-900">New assessment case</div>
              <div className="text-[11.5px] text-slate-500">Give the case a name and (optionally) PAN, AY, and section</div>
            </div>
          </div>
          <ChevronDown className={"size-4 text-slate-500 transition-transform duration-200 " + (formOpen ? "rotate-180" : "")} />
        </button>
        {formOpen && (
          <form onSubmit={create} className="p-5 grid sm:grid-cols-12 gap-3 items-end animate-fade-up">
            <FormField className="sm:col-span-5" label="Case title" icon={<FileText className="size-3.5" />} required>
              <input value={f.title} onChange={set("title")} placeholder="ABC Traders Pvt Ltd — AY 2022-23" className="input" />
            </FormField>
            <FormField className="sm:col-span-2" label="AY" icon={<CalendarDays className="size-3.5" />}>
              <input value={f.assessment_year} onChange={set("assessment_year")} placeholder="2022-23" className="input tabular-nums" />
            </FormField>
            <FormField className="sm:col-span-2" label="PAN" icon={<IdCard className="size-3.5" />}>
              <input value={f.pan} onChange={set("pan")} placeholder="AAAPL1234C" className="input font-mono uppercase tracking-wider text-[13px]" maxLength={10} />
            </FormField>
            <FormField className="sm:col-span-2" label="Section" icon={<Scale className="size-3.5" />}>
              <input value={f.section} onChange={set("section")} placeholder="143(3)" className="input tabular-nums" />
            </FormField>
            <div className="sm:col-span-1">
              <button type="submit" disabled={busyCreate || !f.title.trim()} className="bt-btn-primary w-full h-9" title="Create case">
                {busyCreate ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              </button>
            </div>
          </form>
        )}
      </section>

      {err && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {err}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by title, PAN, AY or section…"
            className="w-full pl-9 pr-3 h-9 rounded-lg border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <FilterChips
          value={filter}
          onChange={setFilter}
          counts={{ all: stats.total, new: stats.drafts, running: stats.running, ready: stats.ready, error: stats.error }}
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          <CaseSkeleton />
          <CaseSkeleton />
          <CaseSkeleton />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState hasCases={cases.length > 0} />
      ) : (
        <div className="grid gap-3">
          {filtered.map((c) => (
            <CaseRow key={c.id} c={c} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================ subcomponents

function HeroHeader() {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-primary p-5 sm:p-6 text-white shadow-lg">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.10]"
        style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "22px 22px" }}
      />
      <div className="pointer-events-none absolute -right-10 -top-10 size-56 rounded-full bg-white/15 blur-3xl" />
      <div className="pointer-events-none absolute -left-10 -bottom-10 size-52 rounded-full bg-emerald-400/25 blur-3xl" />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 size-11 rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur flex items-center justify-center">
            <Stamp className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 ring-1 ring-white/25 px-2 py-0.5 text-[11px] font-semibold tracking-wide backdrop-blur">
              <Sparkles className="size-3" /> AO · NaFAC assessment-order drafting
            </div>
            <h2 className="mt-1.5 font-serif text-2xl sm:text-[26px] font-semibold tracking-tight leading-tight">Assessment cases</h2>
            <p className="text-white/85 text-[13.5px] mt-0.5 max-w-xl">
              Upload the return, notices, replies and information; run the drafting engine and produce a draft assessment
              order u/s 143(3) / 147 / 144 grounded in the Act, Rules and case law.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, hint, tone, icon }: { label: string; value: number; hint: string; tone: "indigo" | "sky" | "emerald" | "rose"; icon: React.ReactNode }) {
  const toneMap = {
    indigo: { wrap: "bg-primary/[0.06] ring-primary/20", icon: "bg-indigo-100 text-indigo-700 ring-indigo-200" },
    sky: { wrap: "bg-primary/[0.06] ring-primary/20", icon: "bg-sky-100 text-sky-700 ring-sky-200" },
    emerald: { wrap: "bg-emerald-50 ring-emerald-200", icon: "bg-emerald-100 text-emerald-700 ring-emerald-200" },
    rose: { wrap: "bg-rose-50 ring-rose-200", icon: "bg-rose-100 text-rose-700 ring-rose-200" },
  }[tone];
  return (
    <div className={"relative overflow-hidden rounded-xl bg-white border border-slate-200/80 shadow-sm p-3.5 ring-1 " + toneMap.wrap}>
      <div className="flex items-center gap-2">
        <div className={"size-8 rounded-lg ring-1 flex items-center justify-center shrink-0 " + toneMap.icon}>{icon}</div>
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
          <div className="text-[20px] font-semibold text-slate-900 leading-none tabular-nums mt-0.5">{value}</div>
        </div>
      </div>
      <div className="mt-1.5 text-[11px] text-slate-500">{hint}</div>
    </div>
  );
}

function FormField({ label, icon, className, required, children }: { label: string; icon?: React.ReactNode; className?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
        {icon}
        {label}
        {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function FilterChips({ value, onChange, counts }: { value: "all" | "new" | "running" | "ready" | "error"; onChange: (v: "all" | "new" | "running" | "ready" | "error") => void; counts: Record<"all" | "new" | "running" | "ready" | "error", number> }) {
  const chips: { key: "all" | "new" | "running" | "ready" | "error"; label: string }[] = [
    { key: "all", label: "All" },
    { key: "new", label: "Drafts" },
    { key: "running", label: "Running" },
    { key: "ready", label: "Ready" },
    { key: "error", label: "Errors" },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((ch) => {
        const active = value === ch.key;
        return (
          <button
            key={ch.key}
            onClick={() => onChange(ch.key)}
            className={
              "inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-medium transition-all border " +
              (active ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-white text-slate-700 border-slate-200 hover:border-primary/30 hover:text-slate-900")
            }
          >
            {ch.label}
            <span className={"inline-block min-w-[20px] text-center rounded-full px-1.5 text-[10.5px] tabular-nums " + (active ? "bg-white/25 text-white" : "bg-slate-100 text-slate-600")}>
              {counts[ch.key] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function CaseRow({ c, onChanged }: { c: any; onChanged: () => void }) {
  const { confirm, dialog } = useConfirm();
  const status = (c.status || "new") as keyof typeof STATUS_META;
  const meta = STATUS_META[status] ?? STATUS_META.new;
  const StatusIcon = meta.icon;
  const initial = (c.title || "?").trim().slice(0, 1).toUpperCase();
  const [stopping, setStopping] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const isRunning = status === "running" || status === ("queued" as any);

  const swallow = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  async function stop(e: React.MouseEvent) {
    swallow(e);
    const ok = await confirm({
      title: `Stop the pipeline for "${c.title}"?`,
      description: "Issues already drafted will be kept. Steps still in progress will be aborted — you can rerun anytime.",
      tone: "warning",
      confirmLabel: "Stop pipeline",
      cancelLabel: "Keep running",
    });
    if (!ok) return;
    setStopping(true);
    try {
      await api.asmtStopCase(c.id);
      onChanged();
      toast.success("Pipeline stopped");
    } catch (err: any) {
      toast.error(err?.message ?? "Could not stop the run.");
    } finally {
      setStopping(false);
    }
  }

  async function deleteCase(e: React.MouseEvent) {
    swallow(e);
    const ok = await confirm({
      title: `Delete "${c.title}"?`,
      description: "This permanently removes the case, every uploaded document, and every pipeline run. This cannot be undone.",
      tone: "danger",
      confirmLabel: "Delete case",
      detail: (c.pan || c.assessment_year || c.section) ? (
        <div className="flex flex-col gap-1">
          {c.pan && (<div><b className="text-slate-800">PAN:</b> <span className="font-mono tracking-wider">{c.pan}</span></div>)}
          {c.assessment_year && (<div><b className="text-slate-800">AY:</b> {c.assessment_year}</div>)}
          {c.section && (<div><b className="text-slate-800">Section:</b> <span className="tabular-nums">{c.section}</span></div>)}
        </div>
      ) : undefined,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.asmtDeleteCase(c.id);
      onChanged();
      toast.success("Assessment case deleted");
    } catch (err: any) {
      toast.error(err?.message ?? "Could not delete the case.");
      setDeleting(false);
    }
  }

  function openEdit(e: React.MouseEvent) {
    swallow(e);
    setEditing(true);
  }

  return (
    <Link
      to={`/assessments/${c.slug || c.id}`}
      className="group block rounded-2xl bg-white border border-slate-200/80 shadow-sm hover:shadow-md hover:shadow-primary/10 hover:border-primary/30 hover:-translate-y-0.5 transition-all overflow-hidden"
    >
      <div className="flex items-center gap-4 p-4">
        <div className="relative shrink-0">
          <div className="absolute -inset-0.5 rounded-xl bg-primary/30 opacity-0 group-hover:opacity-100 blur transition-opacity" />
          <div className="relative size-11 rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15 flex items-center justify-center text-[15px] font-semibold">{initial}</div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-semibold text-slate-900 text-[15px] truncate">{c.title}</div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-500">
            <Meta icon={<CalendarDays className="size-3" />} label={c.assessment_year ? `AY ${c.assessment_year}` : "AY —"} />
            <Meta icon={<IdCard className="size-3" />} label={c.pan ? `PAN ${c.pan}` : "PAN —"} mono />
            <Meta icon={<Scale className="size-3" />} label={c.section ? `s.${c.section}` : "s.—"} />
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-2">
          {isRunning && (
            <button
              onClick={stop}
              disabled={stopping}
              title="Stop the pipeline"
              aria-label="Stop the pipeline"
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-semibold ring-1 ring-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:ring-rose-300 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {stopping ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-3 fill-current" />}
              Stop
            </button>
          )}
          <span className={"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 " + meta.chip}>
            <span className={"size-1.5 rounded-full " + meta.dot} />
            <StatusIcon className={"size-3 " + (status === "running" ? "animate-spin" : "")} />
            {meta.label}
          </span>
          <button onClick={openEdit} title="Edit case metadata" aria-label="Edit case metadata" className="p-1.5 rounded-md text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors">
            <Pencil className="size-3.5" />
          </button>
          <button onClick={deleteCase} disabled={deleting} title="Delete this case" aria-label="Delete this case" className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-50">
            {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          </button>
        </div>
        <ArrowRight className="size-4 text-slate-300 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
      </div>
      {editing && <EditCaseModal c={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />}
      {dialog}
    </Link>
  );
}

function EditCaseModal({ c, onClose, onSaved }: { c: any; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(c.title || "");
  const [ay, setAy] = useState(c.assessment_year || "");
  const [pan, setPan] = useState(c.pan || "");
  const [section, setSection] = useState(c.section || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const swallow = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!title.trim()) {
      setErr("Title cannot be empty.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.asmtPatchCase(c.id, {
        title: title.trim(),
        assessment_year: ay.trim() || null,
        pan: pan.trim() || null,
        section: section.trim() || null,
      });
      toast.success("Assessment case updated");
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-up" onClick={(e) => { swallow(e); onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 overflow-hidden" onClick={swallow}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center ring-1 ring-primary/15">
              <Pencil className="size-4" />
            </div>
            <div>
              <div className="text-[14px] font-semibold text-slate-900">Edit case metadata</div>
              <div className="text-[11.5px] text-slate-500">Updates apply immediately</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <form onSubmit={save} className="p-5 space-y-3">
          <FormField label="Case title" icon={<FileText className="size-3.5" />} required>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" autoFocus />
          </FormField>
          <div className="grid sm:grid-cols-3 gap-3">
            <FormField label="AY" icon={<CalendarDays className="size-3.5" />}>
              <input value={ay} onChange={(e) => setAy(e.target.value)} placeholder="2022-23" className="input tabular-nums" />
            </FormField>
            <FormField label="PAN" icon={<IdCard className="size-3.5" />}>
              <input value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} placeholder="AAAPL1234C" className="input font-mono uppercase tracking-wider text-[13px]" maxLength={10} />
            </FormField>
            <FormField label="Section" icon={<Scale className="size-3.5" />}>
              <input value={section} onChange={(e) => setSection(e.target.value)} placeholder="143(3)" className="input tabular-nums" />
            </FormField>
          </div>
          {err && (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {err}
            </div>
          )}
          <div className="pt-1 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="bt-btn-ghost h-9 px-4 rounded-lg">Cancel</button>
            <button type="submit" disabled={busy || !title.trim()} className="bt-btn-primary h-9 px-5 rounded-lg">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Save
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function Meta({ icon, label, mono }: { icon: React.ReactNode; label: string; mono?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-slate-400">{icon}</span>
      <span className={mono ? "font-mono tracking-wide" : ""}>{label}</span>
    </span>
  );
}

function CaseSkeleton() {
  return (
    <div className="rounded-2xl bg-white border border-slate-200/80 p-4 shadow-sm">
      <div className="flex items-center gap-4 animate-pulse">
        <div className="size-11 rounded-xl bg-slate-100" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 bg-slate-100 rounded w-2/5" />
          <div className="h-3 bg-slate-100 rounded w-3/5" />
        </div>
        <div className="h-6 w-20 bg-slate-100 rounded-full" />
      </div>
    </div>
  );
}

function EmptyState({ hasCases }: { hasCases: boolean }) {
  return (
    <div className="rounded-2xl bg-white border border-dashed border-slate-300 p-10 text-center">
      <div className="mx-auto size-12 rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15 flex items-center justify-center mb-3">
        <Stamp className="size-5" />
      </div>
      <div className="text-[14px] font-semibold text-slate-900">{hasCases ? "No cases match this filter" : "No assessment cases yet"}</div>
      <div className="text-[12.5px] text-slate-500 mt-1 max-w-md mx-auto">
        {hasCases
          ? "Clear the search or switch back to All to see every case."
          : "Create your first case above — add the assessee's PAN, AY and section to keep the audit trail intact."}
      </div>
    </div>
  );
}

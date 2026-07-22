import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type AppealCase } from "../api";

// The desktop's mirror of the web's /appeals landing page: stat cards, a
// new-case form, search + status-filter chips, and a scrollable row list.
// Clicking a row hands the slug up to the parent so App.tsx swaps to the
// case-detail screen.
interface Props {
  onOpenCase: (c: AppealCase) => void;
  licenseValidUntil: string | null;
}

type Filter = "all" | "draft" | "running" | "ready" | "error";

const CATEGORY_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  running: "bg-amber-100 text-amber-700",
  ready: "bg-emerald-100 text-emerald-700",
  error: "bg-rose-100 text-rose-700",
};

// Normalise the myriad backend status strings into our four buckets.
function bucket(c: AppealCase): Filter {
  const s = (c.status || "").toLowerCase();
  if (s.includes("error") || s.includes("fail")) return "error";
  if (s.includes("run") || s.includes("progress") || s.includes("queue")) return "running";
  if (s.includes("ready") || s.includes("done") || s.includes("complete")) return "ready";
  return "draft";
}

export default function AppealsList({ onOpenCase, licenseValidUntil }: Props) {
  const [cases, setCases] = useState<AppealCase[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<AppealCase | null>(null);
  const [deleting, setDeleting] = useState<AppealCase | null>(null);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    try {
      setCases(await api.listCases());
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  }
  useEffect(() => { refresh(); }, []);

  const stats = useMemo(() => {
    if (!cases) return { total: 0, running: 0, ready: 0, error: 0, draft: 0 };
    const s = { total: cases.length, running: 0, ready: 0, error: 0, draft: 0 };
    for (const c of cases) s[bucket(c)]++;
    return s;
  }, [cases]);

  const filtered = useMemo(() => {
    if (!cases) return [];
    const t = q.trim().toLowerCase();
    return cases.filter((c) => {
      if (filter !== "all" && bucket(c) !== filter) return false;
      if (!t) return true;
      return (
        c.title.toLowerCase().includes(t) ||
        (c.pan ?? "").toLowerCase().includes(t) ||
        (c.assessment_year ?? "").toLowerCase().includes(t) ||
        (c.section ?? "").toLowerCase().includes(t)
      );
    });
  }, [cases, q, filter]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-6 space-y-5">
        <Hero licenseSuffix={licenseValidUntil} />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total cases" value={stats.total} tone="indigo" sub={`${stats.draft} drafts`} />
          <StatCard label="Running" value={stats.running} tone="amber" sub="pipeline in progress" />
          <StatCard label="Ready" value={stats.ready} tone="emerald" sub="orders drafted" />
          <StatCard label="Errors" value={stats.error} tone="rose" sub="attention needed" />
        </div>

        <NewCaseButton onClick={() => setCreating(true)} />

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="relative flex-1">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by title, PAN, AY, or section…"
              className="w-full pl-10 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
            <svg className="absolute left-3 top-2.5 size-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {(["all", "draft", "running", "ready", "error"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={
                  "h-9 px-3 rounded-md text-xs font-medium capitalize transition-colors " +
                  (filter === f
                    ? "bg-brand-600 text-white"
                    : "text-slate-600 bg-white ring-1 ring-slate-200 hover:bg-slate-100")
                }
              >
                {f}
                <span className="ml-1.5 opacity-70">
                  {f === "all" ? stats.total : stats[f]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {err && <ErrorBanner msg={err} />}
        {!cases && !err && <Loading />}
        {cases && filtered.length === 0 && (
          <EmptyState hasCases={cases.length > 0} onClickNew={() => setCreating(true)} />
        )}

        <ul className="space-y-2">
          {filtered.map((c) => (
            <CaseRow
              key={c.slug}
              c={c}
              onOpen={() => onOpenCase(c)}
              onEdit={() => setEditing(c)}
              onDelete={() => setDeleting(c)}
            />
          ))}
        </ul>
      </div>

      {creating && (
        <NewCaseModal
          onClose={() => setCreating(false)}
          onCreated={(c) => { setCreating(false); refresh(); onOpenCase(c); }}
        />
      )}
      {editing && (
        <EditCaseModal
          c={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
      {deleting && (
        <DeleteCaseModal
          c={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => { setDeleting(null); refresh(); }}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------- Hero

function Hero({ licenseSuffix }: { licenseSuffix: string | null }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-600 to-violet-600 text-white p-5 sm:p-6 shadow-lg shadow-brand-900/10">
      <div className="pointer-events-none absolute -right-10 -top-10 size-56 rounded-full bg-white/15 blur-3xl" />
      <div className="relative">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 ring-1 ring-white/25 px-2 py-0.5 text-[11px] font-semibold tracking-wide backdrop-blur">
          CIT(A) · NFAC appeal drafting
        </div>
        <h1 className="mt-2 text-2xl sm:text-[28px] font-semibold tracking-tight">Appeal cases</h1>
        <p className="mt-1 text-white/85 text-[13.5px] max-w-xl">
          Upload the appeal file, run the six-module pipeline, and produce a
          draft appellate order grounded in the Act, Rules and case law.
        </p>
        {licenseSuffix && (
          <div className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] text-white/75 bg-white/10 ring-1 ring-white/20 rounded-full px-2.5 py-0.5">
            License valid until {new Date(licenseSuffix).toLocaleDateString()}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, tone }: {
  label: string; value: number; sub: string;
  tone: "indigo" | "amber" | "emerald" | "rose";
}) {
  const styles = {
    indigo: "from-indigo-500/[0.07] ring-indigo-200 text-indigo-700",
    amber:  "from-amber-500/[0.07] ring-amber-200 text-amber-700",
    emerald:"from-emerald-500/[0.07] ring-emerald-200 text-emerald-700",
    rose:   "from-rose-500/[0.07] ring-rose-200 text-rose-700",
  }[tone];
  return (
    <div className={"rounded-xl bg-gradient-to-br to-white ring-1 border border-slate-200/70 shadow-sm p-3.5 " + styles}>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em]">{label}</div>
      <div className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}

function NewCaseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-4 rounded-xl bg-white ring-1 ring-slate-200 hover:ring-brand-500/40 hover:bg-brand-50/40 transition-colors group"
    >
      <div className="size-10 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center group-hover:bg-brand-600 group-hover:text-white transition-colors">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </div>
      <div className="flex-1 text-left">
        <div className="font-semibold text-slate-900">New appeal case</div>
        <div className="text-xs text-slate-500">Give the case a name and (optionally) PAN, AY, and section</div>
      </div>
      <svg className="size-4 text-slate-400 group-hover:text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m9 18 6-6-6-6" />
      </svg>
    </button>
  );
}

// ----------------------------------------------------------------- row

function CaseRow({ c, onOpen, onEdit, onDelete }: {
  c: AppealCase; onOpen: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const b = bucket(c);
  const tone = CATEGORY_STYLES[b];
  const initial = (c.title || "?")[0].toUpperCase();
  // Whole row is the click target; edit/delete stop propagation so they don't
  // also open the case.  We use a div with role=button (not a real <button>)
  // because the action buttons need to be nested inside — nested <button>s
  // aren't valid HTML.
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); }
        }}
        className="group cursor-pointer rounded-xl bg-white ring-1 ring-slate-200 hover:ring-brand-500/40 hover:shadow-md hover:-translate-y-px transition-all px-4 py-3 flex items-center gap-3 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
      >
        <div className="size-10 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 text-white font-semibold flex items-center justify-center shrink-0 ring-2 ring-white shadow-sm">
          {initial}
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-medium text-slate-900 truncate">{c.title}</div>
          <div className="text-xs text-slate-500 flex items-center gap-3 mt-0.5">
            <span>AY {c.assessment_year || "—"}</span>
            <span>PAN {c.pan || "—"}</span>
            <span>s.{c.section || "—"}</span>
          </div>
        </div>

        {/* Status pill + action group in a single right-aligned column so
            they never overlap.  Actions fade in on hover. */}
        <div className="flex items-center gap-2 shrink-0">
          <div className={"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold capitalize " + tone}>
            <span className="size-1.5 rounded-full bg-current" /> {b}
          </div>
          <div className="w-px h-6 bg-slate-200/80" />
          <div className="flex items-center gap-0.5 opacity-40 group-hover:opacity-100 transition-opacity">
            <RowAction onClick={onEdit} title="Edit case" label="edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </RowAction>
            <RowAction onClick={onDelete} title="Delete case" label="delete" danger>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              </svg>
            </RowAction>
          </div>
          <svg
            className="size-4 text-slate-300 group-hover:text-brand-500 group-hover:translate-x-0.5 transition-all"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </div>
      </div>
    </li>
  );
}

// Small ghost icon-button used inside a row.  Uses `role="button"` on a `<span>`
// so it can safely nest inside the row's outer `role="button"` div (nested
// real <button>s would break keyboard focus handling on some browsers).
function RowAction({ children, onClick, title, label, danger }: {
  children: React.ReactNode; onClick: () => void; title: string; label: string; danger?: boolean;
}) {
  const tone = danger
    ? "text-slate-400 hover:text-rose-600 hover:bg-rose-50"
    : "text-slate-400 hover:text-brand-600 hover:bg-brand-50";
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault(); e.stopPropagation(); onClick();
        }
      }}
      title={title}
      aria-label={label}
      className={"size-7 rounded-md flex items-center justify-center cursor-pointer transition-colors " + tone}
    >
      {children}
    </span>
  );
}

// ----------------------------------------------------------------- states

function Loading() {
  return (
    <div className="text-sm text-slate-500 flex items-center gap-2">
      <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" opacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" />
      </svg>
      Loading cases…
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2 text-sm">
      {msg}
    </div>
  );
}

function EmptyState({ hasCases, onClickNew }: { hasCases: boolean; onClickNew: () => void }) {
  return (
    <div className="rounded-xl bg-white border border-dashed border-slate-300 p-8 text-center">
      <div className="mx-auto size-12 rounded-2xl bg-brand-100 text-brand-700 flex items-center justify-center mb-3">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </div>
      <div className="text-[15px] font-semibold text-slate-900">
        {hasCases ? "No cases match your filters" : "No appeal cases yet"}
      </div>
      <div className="text-[12.5px] text-slate-500 mt-1">
        {hasCases
          ? "Try clearing the search box or picking a different filter."
          : "Create your first case to start drafting."}
      </div>
      {!hasCases && (
        <button onClick={onClickNew} className="mt-3 inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700">
          New case
        </button>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- modals

function NewCaseModal({ onClose, onCreated }: {
  onClose: () => void; onCreated: (c: AppealCase) => void;
}) {
  const [title, setTitle] = useState("");
  const [ay, setAy] = useState("");
  const [pan, setPan] = useState("");
  const [section, setSection] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr("Case title is required."); return; }
    setBusy(true); setErr(null);
    try {
      const c = await api.createCase({
        title: title.trim(),
        assessment_year: ay.trim() || null,
        pan: pan.trim() || null,
        section: section.trim() || null,
      });
      onCreated(c);
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="New appeal case" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Case title" required>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="ABC Traders Pvt Ltd — AY 2021-22"
            required autoFocus className="input" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="AY"><input value={ay} onChange={(e) => setAy(e.target.value)} placeholder="2021-22" className="input" /></Field>
          <Field label="PAN"><input value={pan} onChange={(e) => setPan(e.target.value)} placeholder="AAAPL1234C" className="input font-mono" /></Field>
          <Field label="Section"><input value={section} onChange={(e) => setSection(e.target.value)} placeholder="143(3)" className="input" /></Field>
        </div>
        {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg text-slate-600 hover:bg-slate-100 font-medium">Cancel</button>
          <button type="submit" disabled={busy || !title.trim()} className="h-9 px-5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60 font-semibold">
            {busy ? "Creating…" : "Create case"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditCaseModal({ c, onClose, onSaved }: {
  c: AppealCase; onClose: () => void; onSaved: () => void;
}) {
  const [title, setTitle] = useState(c.title);
  const [ay, setAy] = useState(c.assessment_year ?? "");
  const [pan, setPan] = useState(c.pan ?? "");
  const [section, setSection] = useState(c.section ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr("Case title is required."); return; }
    setBusy(true); setErr(null);
    try {
      await api.patchCase(c.slug, {
        title: title.trim(),
        assessment_year: ay.trim() || null,
        pan: pan.trim() || null,
        section: section.trim() || null,
      });
      onSaved();
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Edit — ${c.title}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Case title" required>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required className="input" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="AY"><input value={ay} onChange={(e) => setAy(e.target.value)} className="input" /></Field>
          <Field label="PAN"><input value={pan} onChange={(e) => setPan(e.target.value)} className="input font-mono" /></Field>
          <Field label="Section"><input value={section} onChange={(e) => setSection(e.target.value)} className="input" /></Field>
        </div>
        {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg text-slate-600 hover:bg-slate-100 font-medium">Cancel</button>
          <button type="submit" disabled={busy} className="h-9 px-5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60 font-semibold">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteCaseModal({ c, onClose, onDeleted }: {
  c: AppealCase; onClose: () => void; onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    setBusy(true); setErr(null);
    try {
      await api.deleteCase(c.slug);
      onDeleted();
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Delete case?" onClose={onClose}>
      <div className="text-sm text-slate-700">
        Delete <b>{c.title}</b>? All uploaded documents, runs and drafts for this
        case will be permanently removed. This cannot be undone.
      </div>
      {err && <div className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="h-9 px-4 rounded-lg text-slate-600 hover:bg-slate-100 font-medium">Cancel</button>
        <button onClick={remove} disabled={busy} className="h-9 px-5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60 font-semibold">
          {busy ? "Deleting…" : "Delete case"}
        </button>
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------- shared

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-gradient-to-r from-brand-500/[0.06] to-transparent flex items-center justify-between">
          <div className="text-[14px] font-semibold text-slate-900">{title}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

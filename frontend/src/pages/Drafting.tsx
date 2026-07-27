import { useEffect, useMemo, useState } from "react";
import {
  FileText, Plus, Loader2, Sparkles, Copy, Check, RefreshCw, Save,
  Trash2, ArrowLeft, ScrollText, Download, Search, FileSignature,
  Gavel, Scale as ScaleIcon, ChevronRight, ShieldCheck, Clock,
} from "lucide-react";
import { api, DraftDoc, DraftListItem, DraftTemplate } from "../api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSidebarPanel } from "@/components/SidebarSlot";

// ---------------------------------------------------------------------------
// Drafting workspace. Three views:
//   * home  → hero + category grid of templates
//   * form  → structured input for one template
//   * edit  → generated text with copy / regen / export / save controls
// A permanent drafts sidebar on the left surfaces past drafts with search.
// ---------------------------------------------------------------------------

export default function DraftingPage() {
  const [templates, setTemplates] = useState<DraftTemplate[]>([]);
  const [drafts, setDrafts] = useState<DraftListItem[]>([]);
  const [view, setView] = useState<"home" | "form" | "edit">("home");
  const [tmpl, setTmpl] = useState<DraftTemplate | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState<DraftDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refreshList = () => api.listDrafts().then(setDrafts).catch(() => {});
  useEffect(() => {
    api.draftTemplates().then(setTemplates).catch(() => setErr("Could not load templates"));
    refreshList();
  }, []);

  function startNew(t: DraftTemplate) {
    setTmpl(t); setInputs({}); setErr(null); setView("form");
  }

  async function generate() {
    if (!tmpl || busy) return;
    setBusy(true); setErr(null);
    try {
      const d = await api.createDraft({ kind: tmpl.kind, inputs });
      setCurrent(d); setView("edit"); refreshList();
    } catch (e: any) {
      setErr(e?.message ?? "Generation failed");
    } finally { setBusy(false); }
  }

  async function openDraft(id: number) {
    setBusy(true);
    try {
      const d = await api.getDraft(id);
      setCurrent(d);
      setTmpl(templates.find((t) => t.kind === d.kind) ?? null);
      setView("edit");
    } finally { setBusy(false); }
  }

  // Promote the drafts list into the shared Layout sidebar so it lives
  // above the Workspace nav (like a chat app's thread list above tabs).
  useSidebarPanel(
    <DraftsSidebar
      drafts={drafts}
      activeId={current?.id ?? null}
      onNew={() => { setCurrent(null); setView("home"); }}
      onOpen={openDraft}
    />,
  );

  return (
    <div className="min-w-0">
      {err && (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm px-4 py-2.5 flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-rose-500" /> {err}
        </div>
      )}

      {view === "home" && <TemplatePicker templates={templates} onPick={startNew} />}

      {view === "form" && tmpl && (
        <DraftForm
          tmpl={tmpl} inputs={inputs} setInputs={setInputs} busy={busy}
          onBack={() => setView("home")} onGenerate={generate}
        />
      )}

      {view === "edit" && current && (
        <DraftEditor
          draft={current} tmpl={tmpl}
          onChange={setCurrent}
          onDeleted={() => { setCurrent(null); setView("home"); refreshList(); }}
          onSaved={refreshList}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drafts sidebar — search + status pill + relative time
// ---------------------------------------------------------------------------
function DraftsSidebar({
  drafts, activeId, onNew, onOpen,
}: {
  drafts: DraftListItem[]; activeId: number | null;
  onNew: () => void; onOpen: (id: number) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return drafts;
    return drafts.filter((d) => (d.title || "").toLowerCase().includes(t));
  }, [drafts, q]);

  return (
    // Sits inside the Layout sidebar's flex-1 slot -- take the full column
    // height and let the list body scroll independently of the header +
    // Workspace nav pinned below.
    <aside className="h-full flex flex-col bg-transparent">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-slate-200/70">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[13px] font-semibold text-slate-900 flex items-center gap-1.5">
            <ScrollText className="size-4 text-primary" /> Your drafts
          </div>
          <span className="text-[11px] text-slate-400 tabular-nums">{drafts.length}</span>
        </div>
        <button
          onClick={onNew}
          className="w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-lg bg-primary text-white font-semibold text-[13.5px] shadow-md shadow-primary/25 hover:bg-primary/90 transition-colors"
        >
          <Plus className="size-4" /> New draft
        </button>
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-400 pointer-events-none" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search drafts…"
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-slate-50 ring-1 ring-slate-200 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 focus:bg-white"
          />
        </div>
      </div>

      {/* List — takes every remaining pixel in the sidebar slot and shows a
          persistent thin scrollbar so officers realise there's more below. */}
      <div className="flex-1 min-h-0 overflow-y-auto chat-scrollbar px-2 py-2">
        {filtered.length === 0 ? (
          <div className="text-center py-10 px-4">
            <div className="mx-auto size-10 rounded-xl bg-slate-100 grid place-items-center text-slate-400 mb-2">
              <FileText className="size-5" />
            </div>
            <div className="text-[12.5px] text-slate-600 font-medium">
              {drafts.length === 0 ? "No drafts yet." : "No matches."}
            </div>
            <div className="text-[11.5px] text-slate-400 mt-0.5">
              {drafts.length === 0 ? "Click New draft to start one." : "Try a different search term."}
            </div>
          </div>
        ) : (
          <ul className="space-y-1">
            {filtered.map((d) => {
              const active = activeId === d.id;
              return (
                <li key={d.id}>
                  <button
                    onClick={() => onOpen(d.id)}
                    className={cn(
                      "w-full text-left rounded-lg px-3 py-2.5 transition-all group",
                      active
                        ? "bg-primary/10 ring-1 ring-primary/25"
                        : "hover:bg-slate-50"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div className={cn(
                        "shrink-0 size-6 rounded-md grid place-items-center mt-0.5",
                        active ? "bg-primary text-white" : "bg-slate-100 text-slate-500 group-hover:bg-slate-200"
                      )}>
                        <FileText className="size-3" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={cn("text-[13px] font-medium truncate", active ? "text-primary" : "text-slate-800")}>
                          {d.title || "Untitled draft"}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-slate-500">
                          <span className={cn(
                            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-semibold capitalize",
                            d.status === "draft" ? "bg-amber-100 text-amber-800"
                              : d.status === "final" ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-600"
                          )}>
                            <span className="size-1 rounded-full bg-current" /> {d.status}
                          </span>
                          {d.updated_at && (
                            <span className="inline-flex items-center gap-0.5">
                              <Clock className="size-2.5" /> {relTime(d.updated_at)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Home — hero + category grid of templates
// ---------------------------------------------------------------------------
function TemplatePicker({ templates, onPick }: {
  templates: DraftTemplate[]; onPick: (t: DraftTemplate) => void;
}) {
  const [q, setQ] = useState("");
  const byCat = useMemo(() => {
    const t = q.trim().toLowerCase();
    const filtered = t
      ? templates.filter((x) => x.label.toLowerCase().includes(t) || (x.section || "").toLowerCase().includes(t))
      : templates;
    const m: Record<string, DraftTemplate[]> = {};
    filtered.forEach((x) => (m[x.category] ??= []).push(x));
    return m;
  }, [templates, q]);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-primary text-white p-6 sm:p-8 shadow-xl shadow-primary/25">
        <div className="absolute -top-16 -right-8 size-56 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-8 size-56 rounded-full bg-indigo-300/20 blur-3xl pointer-events-none" />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 ring-1 ring-white/25 backdrop-blur text-[11px] font-semibold uppercase tracking-wider">
            <Sparkles className="size-3" /> Grounded in primary law
          </span>
          <h1 className="mt-3 text-[26px] sm:text-[32px] font-semibold tracking-tight leading-tight">
            Draft a notice or order in minutes
          </h1>
          <p className="mt-2 max-w-xl text-white/85 text-[14px] leading-relaxed">
            Pick a template, fill the facts, and generate an audit-ready draft written from the
            Department's standpoint. You can edit, regenerate or export to Word before signing.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[12.5px]">
            <span className="inline-flex items-center gap-1.5 text-white/90"><ShieldCheck className="size-3.5" /> Cited from the Act & Rules</span>
            <span className="inline-flex items-center gap-1.5 text-white/90"><FileSignature className="size-3.5" /> Editable before you sign</span>
            <span className="inline-flex items-center gap-1.5 text-white/90"><Download className="size-3.5" /> Exports to Word</span>
          </div>
        </div>
      </div>

      {/* Search + section header */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-[15px] font-semibold text-slate-900">Templates</h2>
        <div className="ml-auto relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search templates…"
            className="w-full h-10 pl-10 pr-3 rounded-lg bg-white ring-1 ring-slate-200 text-[13.5px] focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      {Object.keys(byCat).length === 0 ? (
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-10 text-center">
          <div className="mx-auto size-12 rounded-xl bg-slate-100 grid place-items-center text-slate-400 mb-3">
            <ScrollText className="size-6" />
          </div>
          <div className="text-[14px] font-semibold text-slate-800">No matching templates</div>
          <div className="text-[12.5px] text-slate-500 mt-1">Try a different search term.</div>
        </div>
      ) : (
        Object.entries(byCat).map(([cat, ts]) => (
          <section key={cat}>
            <div className="flex items-center gap-2 mb-3">
              <div className={cn("size-6 rounded-md grid place-items-center", catStyle(cat).chip)}>
                {catIcon(cat)}
              </div>
              <div className="text-[12px] uppercase tracking-[0.16em] text-slate-500 font-semibold">{cat}s</div>
              <div className="flex-1 h-px" />
              <span className="text-[11px] text-slate-400 tabular-nums">{ts.length}</span>
            </div>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {ts.map((t) => <TemplateCard key={t.kind} t={t} onPick={() => onPick(t)} />)}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function TemplateCard({ t, onPick }: { t: DraftTemplate; onPick: () => void }) {
  const style = catStyle(t.category);
  return (
    <button
      onClick={onPick}
      className="group relative overflow-hidden text-left rounded-2xl bg-white ring-1 ring-slate-200 p-4 shadow-sm hover:ring-primary/40 hover:shadow-lg hover:shadow-primary/10 transition-all hover:-translate-y-0.5"
    >
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity  pointer-events-none" />
      <div className="relative flex items-start gap-3">
        <div className={cn("shrink-0 size-11 rounded-xl ring-1 grid place-items-center transition-colors", style.chip)}>
          {catIcon(t.category, "size-5")}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-semibold text-slate-900 leading-snug group-hover:text-primary transition-colors">
            {t.label}
          </div>
          {t.section && (
            <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500 font-mono">
              <span className="px-1.5 py-0.5 rounded bg-slate-100 ring-1 ring-slate-200">§ {t.section}</span>
            </div>
          )}
        </div>
        <ChevronRight className="size-4 text-slate-300 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
      </div>
    </button>
  );
}

function catStyle(_cat: string): { chip: string } {
  // Uniform primary chip across every category — the icon differentiates
  // Order / Notice / Letter (Gavel / FileText / FileSignature).
  return { chip: "bg-primary/10 text-primary" };
}
function catIcon(cat: string, cls = "size-3.5") {
  const c = cat.toLowerCase();
  if (c.includes("order")) return <Gavel className={cls} />;
  if (c.includes("notice")) return <FileText className={cls} />;
  if (c.includes("letter")) return <FileSignature className={cls} />;
  return <ScaleIcon className={cls} />;
}

// ---------------------------------------------------------------------------
// Draft form — structured inputs for a chosen template
// ---------------------------------------------------------------------------
function DraftForm({
  tmpl, inputs, setInputs, busy, onBack, onGenerate,
}: {
  tmpl: DraftTemplate;
  inputs: Record<string, string>;
  setInputs: (v: Record<string, string>) => void;
  busy: boolean;
  onBack: () => void;
  onGenerate: () => void;
}) {
  const missing = tmpl.fields.some((f) => f.required && !(inputs[f.key] || "").trim());
  const style = catStyle(tmpl.category);
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm max-w-3xl overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-slate-100">
        <button
          onClick={onBack}
          className="text-[12.5px] text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 mb-3"
        >
          <ArrowLeft className="size-3.5" /> All templates
        </button>
        <div className="flex items-start gap-3">
          <div className={cn("shrink-0 size-11 rounded-xl ring-1 grid place-items-center", style.chip)}>
            {catIcon(tmpl.category, "size-5")}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-semibold text-slate-900">{tmpl.label}</h2>
            <p className="text-[12.5px] text-slate-500 mt-0.5">
              Fill the facts — the draft uses only what you provide.
              {tmpl.section && <> · <span className="font-mono">§ {tmpl.section}</span></>}
            </p>
          </div>
        </div>
      </div>
      {/* Fields */}
      <div className="p-6 space-y-4">
        {tmpl.fields.map((f) => (
          <div key={f.key}>
            <label className="text-[12.5px] font-semibold text-slate-800 mb-1.5 block">
              {f.label}
              {f.required && <span className="text-rose-500"> *</span>}
            </label>
            {f.textarea ? (
              <textarea
                rows={4}
                value={inputs[f.key] || ""}
                onChange={(e) => setInputs({ ...inputs, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-[13.5px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
              />
            ) : (
              <input
                value={inputs[f.key] || ""}
                onChange={(e) => setInputs({ ...inputs, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="w-full h-11 rounded-lg border border-slate-200 bg-white px-3.5 text-[13.5px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
              />
            )}
          </div>
        ))}
      </div>
      {/* Footer */}
      <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11.5px] text-slate-500 flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-emerald-500" />
          Every claim in the generated draft is footnoted to the exact section.
        </div>
        <button
          onClick={onGenerate} disabled={busy || missing}
          className="inline-flex items-center gap-1.5 h-11 px-5 rounded-lg bg-primary text-white font-semibold text-[14px] hover:bg-primary/90 shadow-lg shadow-primary/25 disabled:opacity-60"
        >
          {busy ? (<><Loader2 className="size-4 animate-spin" /> Drafting…</>) : (<><Sparkles className="size-4" /> Generate draft</>)}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor — text edit + toolbar with copy / regen / export / delete / save
// ---------------------------------------------------------------------------
function DraftEditor({
  draft, tmpl, onChange, onDeleted, onSaved,
}: {
  draft: DraftDoc;
  tmpl: DraftTemplate | null;
  onChange: (d: DraftDoc) => void;
  onDeleted: () => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState(draft.content);
  const [busy, setBusy] = useState<"save" | "regen" | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => setContent(draft.content), [draft.id, draft.content]);
  const dirty = content !== draft.content;
  const style = tmpl ? catStyle(tmpl.category) : { chip: "bg-slate-100 text-slate-500 ring-slate-200" };

  async function save() {
    setBusy("save");
    try {
      const d = await api.updateDraft(draft.id, { content });
      onChange(d); onSaved();
    } finally { setBusy(null); }
  }
  async function regen() {
    setBusy("regen");
    try {
      const d = await api.regenerateDraft(draft.id);
      onChange(d);
    } finally { setBusy(null); }
  }
  function copy() {
    navigator.clipboard?.writeText(content).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1600);
    });
  }
  async function downloadWord() {
    if (dirty) await save();
    const name = (draft.title || tmpl?.label || "draft").replace(/[^\w.-]+/g, "_");
    await api.appealDownload(`/drafts/${draft.id}/export.docx`, `${name}.docx`);
  }
  async function del() {
    if (!confirm("Delete this draft?")) return;
    await api.deleteDraft(draft.id);
    onDeleted();
  }

  const wordCount = useMemo(() => content.trim().split(/\s+/).filter(Boolean).length, [content]);

  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
      {/* Toolbar header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 flex-wrap">
        <div className={cn("shrink-0 size-10 rounded-xl ring-1 grid place-items-center", style.chip)}>
          {tmpl ? catIcon(tmpl.category, "size-4.5") : <FileText className="size-4.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-slate-900 truncate">
            {draft.title || tmpl?.label || "Draft"}
          </h2>
          <div className="text-[11.5px] text-slate-500 flex items-center gap-2 mt-0.5">
            <span>{tmpl?.label || "Draft"}</span>
            {tmpl?.section && (<><span>·</span><span className="font-mono">§ {tmpl.section}</span></>)}
            <span>·</span>
            <span className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] font-semibold capitalize",
              draft.status === "final" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
            )}>
              <span className="size-1 rounded-full bg-current" /> {draft.status}
            </span>
            {dirty && <span className="text-amber-700 font-medium">· unsaved changes</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <TbBtn onClick={copy} icon={copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}>
            {copied ? "Copied" : "Copy"}
          </TbBtn>
          <TbBtn onClick={regen} disabled={!!busy} icon={<RefreshCw className={cn("size-3.5", busy === "regen" && "animate-spin")} />}>
            Regenerate
          </TbBtn>
          <TbBtn onClick={downloadWord} disabled={!!busy} icon={<Download className="size-3.5" />}>Word</TbBtn>
          <TbBtn onClick={del} icon={<Trash2 className="size-3.5" />} danger />
          <Button size="sm" onClick={save} disabled={!dirty || !!busy} className="h-8">
            {busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
          </Button>
        </div>
      </div>

      {/* Editor body */}
      <div className="p-5 bg-slate-50/60">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="w-full min-h-[560px] rounded-xl border border-slate-200 bg-white p-5 text-[13.5px] leading-[1.7] font-mono text-slate-800 shadow-inner focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 whitespace-pre-wrap"
        />
      </div>

      {/* Footer stats */}
      <div className="px-5 py-2.5 border-t border-slate-100 bg-white flex items-center justify-between text-[11.5px] text-slate-500">
        <div className="flex items-center gap-3">
          <span className="tabular-nums">{wordCount.toLocaleString()} words</span>
          <span>·</span>
          <span className="tabular-nums">{content.length.toLocaleString()} chars</span>
        </div>
        <div className="flex items-center gap-1">
          <ShieldCheck className="size-3 text-emerald-500" /> Every edit is audit-logged.
        </div>
      </div>
    </div>
  );
}

function TbBtn({
  onClick, icon, children, disabled, danger,
}: {
  onClick: () => void; icon: React.ReactNode; children?: React.ReactNode;
  disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 text-[12px] font-medium h-8 px-2.5 rounded-lg ring-1 transition-colors disabled:opacity-60",
        danger
          ? "text-rose-600 ring-rose-200 hover:bg-rose-50"
          : "text-slate-700 bg-white ring-slate-200 hover:bg-slate-50"
      )}
    >
      {icon}{children}
    </button>
  );
}

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

import { useEffect, useMemo, useState } from "react";
import {
  FileText, Plus, Loader2, Sparkles, Copy, Check, RefreshCw, Save,
  Trash2, ArrowLeft, ScrollText, Download, Search, FileSignature,
  Gavel, Scale as ScaleIcon, ChevronRight, ChevronDown, ShieldCheck, Clock,
  Send, Users, CheckCircle2, CornerUpLeft, History, X, Lock, Inbox, Stamp,
} from "lucide-react";
import { api, DraftDoc, DraftListItem, DraftTemplate, Reviewer, ReviewInboxItem, RequiredApproval, WsTemplate } from "../api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth";
import { resolveDraftingGroups } from "@/lib/workspaceProfiles";
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
  const [inbox, setInbox] = useState<ReviewInboxItem[]>([]);

  const refreshList = () => api.listDrafts().then(setDrafts).catch(() => {});
  const refreshInbox = () => api.draftReviewInbox().then(setInbox).catch(() => {});
  useEffect(() => {
    api.draftTemplates().then(setTemplates).catch(() => setErr("Could not load templates"));
    refreshList();
    refreshInbox();
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
      // Distinguish a browser-level network failure ("Failed to fetch" —
      // usually a stale bundle, blocked port, or extension interference)
      // from a server-level rejection (which carries an HTTP status +
      // detail). The old message swallowed both cases behind "Failed to
      // fetch"; the new one names the likely fix.
      const msg = e?.message ?? "";
      if (msg === "Failed to fetch" || /NetworkError|Load failed/i.test(msg)) {
        setErr(
          "Couldn't reach the drafting service. If the problem persists, " +
          "please hard-refresh the page (Ctrl+Shift+R) and try again — " +
          "an old cached copy of the app can trip this.",
        );
      } else {
        setErr(msg || "Generation failed");
      }
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

      {view === "home" && (
        <div className="space-y-6">
          <ReviewInbox items={inbox} onOpen={openDraft} />
          <TemplatePicker templates={templates} onPick={startNew} />
        </div>
      )}

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
          onDeleted={() => { setCurrent(null); setView("home"); refreshList(); refreshInbox(); }}
          onSaved={() => { refreshList(); refreshInbox(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "For my review" — drafts colleagues sent up to this officer for approval.
// Shown on the drafting home; the reason a senior opens BharatTax.
// ---------------------------------------------------------------------------
function ReviewInbox({ items, onOpen }: { items: ReviewInboxItem[]; onOpen: (id: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-2xl bg-white ring-1 ring-amber-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-amber-100 bg-amber-50/60">
        <div className="size-8 rounded-lg bg-amber-100 text-amber-700 grid place-items-center">
          <Inbox className="size-4" />
        </div>
        <div className="text-[13.5px] font-semibold text-slate-900">For my review</div>
        <span className="text-[11px] font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">{items.length}</span>
        <span className="ml-auto text-[11.5px] text-slate-500">Drafts sent to you for approval</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {items.map((it) => (
          <li key={it.id}>
            <button onClick={() => onOpen(it.id)}
              className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors flex items-center gap-3">
              <div className="size-7 rounded-md bg-slate-100 text-slate-500 grid place-items-center shrink-0">
                <FileText className="size-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-slate-800 truncate">{it.title || "Untitled draft"}</div>
                <div className="text-[11.5px] text-slate-500">from {it.drafter || "a colleague"}{it.updated_at ? ` · ${relTime(it.updated_at)}` : ""}</div>
              </div>
              <span className="shrink-0 text-[11px] font-semibold text-primary inline-flex items-center gap-1">
                Review <ChevronRight className="size-3.5" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Status → label + pill style for the review state machine.
function statusMeta(status: string): { label: string; cls: string } {
  switch (status) {
    case "in_review": return { label: "In review", cls: "bg-blue-100 text-blue-800" };
    case "approved": return { label: "Approved", cls: "bg-emerald-100 text-emerald-800" };
    case "returned": return { label: "Returned", cls: "bg-rose-100 text-rose-800" };
    case "final": return { label: "Final", cls: "bg-emerald-100 text-emerald-800" };
    default: return { label: "Draft", cls: "bg-amber-100 text-amber-800" };
  }
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
          className="w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-lg bg-primary text-white font-semibold text-[13.5px] shadow-md hover:bg-primary/90 transition-colors"
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
                            // Logo palette: draft = orange (attention),
                            // final = green (done). Slate for anything else.
                            d.status === "draft" ? "bg-brand-orange/15 text-brand-orange"
                              : d.status === "final" ? "bg-brand-green/15 text-brand-green"
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
  const searching = q.trim().length > 0;
  // Group by FUNCTION (the templates arrive ranked, so the officer's own
  // function's group comes first). Category becomes the per-card tag.
  const byGroup = useMemo(() => {
    const t = q.trim().toLowerCase();
    const filtered = t
      ? templates.filter((x) => x.label.toLowerCase().includes(t) || (x.section || "").toLowerCase().includes(t))
      : templates;
    const m: Record<string, DraftTemplate[]> = {};
    filtered.forEach((x) => (m[x.group || "Other"] ??= []).push(x));
    return m;
  }, [templates, q]);
  const groupNames = Object.keys(byGroup);
  // Role-divided: show the officer ONLY their own function's groups; everything
  // else sits behind one "other functions" expander (never hidden — just not
  // dumped on them). No profile → no division (all groups are "own").
  const { session } = useAuth();
  const ownSet = useMemo(() => {
    const s = resolveDraftingGroups(session?.workspaceProfile, session?.workspaceWings);
    // A ministerial / inspectorate role also owns the group(s) its own
    // work-product lands in — so a Tax Assistant, Inspector, Steno or Notice
    // Server sees THEIR templates expanded, even off their wing's groups.
    const d = session?.designation;
    if (d) templates.forEach((t) => { if (t.designations?.includes(d)) s.add(t.group || "Other"); });
    return s;
  }, [session?.workspaceProfile, session?.workspaceWings, session?.designation, templates]);
  const scoped = ownSet.size > 0;
  const ownGroups = scoped ? groupNames.filter((g) => ownSet.has(g)) : groupNames;
  const otherGroups = scoped ? groupNames.filter((g) => !ownSet.has(g)) : [];
  const [showOther, setShowOther] = useState(false);
  // The officer's first own group opens by default; others in that set collapse.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isOpen = (g: string) => searching || (g in overrides ? overrides[g] : g === ownGroups[0]);
  const toggle = (g: string) => setOverrides((o) => ({ ...o, [g]: !isOpen(g) }));
  const otherCount = otherGroups.reduce((n, g) => n + byGroup[g].length, 0);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-primary text-white p-6 sm:p-8 shadow-xl">
        <div className="absolute -top-16 -right-8 size-56 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-8 size-56 rounded-full bg-indigo-300/20 blur-3xl pointer-events-none" />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 ring-1 ring-white/25 backdrop-blur text-[11px] font-semibold uppercase tracking-wider">
            <Sparkles className="size-3" /> Grounded in primary law
          </span>
          <h1 className="mt-3 font-serif text-[26px] sm:text-[32px] font-semibold tracking-tight leading-tight">
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

      {groupNames.length === 0 ? (
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-10 text-center">
          <div className="mx-auto size-12 rounded-xl bg-slate-100 grid place-items-center text-slate-400 mb-3">
            <ScrollText className="size-6" />
          </div>
          <div className="text-[14px] font-semibold text-slate-800">No matching templates</div>
          <div className="text-[12.5px] text-slate-500 mt-1">Try a different search term.</div>
        </div>
      ) : (
        <>
          {(searching ? groupNames : ownGroups).map((group) => renderGroup(group, byGroup[group], isOpen(group), () => toggle(group), onPick))}

          {/* Everything outside the officer's function — one click away, never dumped. */}
          {scoped && !searching && otherGroups.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowOther((s) => !s)}
                className="w-full flex items-center gap-2 py-2 rounded-lg text-left group">
                <span className="text-[12.5px] font-semibold text-slate-500 group-hover:text-primary transition-colors">
                  {showOther ? "Hide" : "Show"} templates for other functions
                </span>
                <span className="text-[11px] text-slate-400 tabular-nums">{otherCount}</span>
                <div className="flex-1 h-px bg-slate-200/70" />
                <span className={cn("size-5 rounded-md bg-white ring-1 ring-slate-200 flex items-center justify-center text-slate-500 transition-transform", showOther ? "rotate-180" : "")}>
                  <ChevronDown className="size-3.5" />
                </span>
              </button>
              {showOther && (
                <div className="mt-4 space-y-6">
                  {otherGroups.map((group) => renderGroup(group, byGroup[group], isOpen(group), () => toggle(group), onPick))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function renderGroup(
  group: string, ts: DraftTemplate[], open: boolean,
  onToggle: () => void, onPick: (t: DraftTemplate) => void,
) {
  return (
    <section key={group}>
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-2 mb-3 group text-left">
        <div className="text-[12px] uppercase tracking-[0.16em] text-slate-500 font-semibold group-hover:text-slate-800 transition-colors">{group}</div>
        <div className="flex-1 h-px bg-slate-200/70" />
        <span className="text-[11px] text-slate-400 tabular-nums">{ts.length}</span>
        <span className={cn("size-5 rounded-md bg-white ring-1 ring-slate-200 flex items-center justify-center text-slate-500 transition-transform", open ? "rotate-180" : "")}>
          <ChevronDown className="size-3.5" />
        </span>
      </button>
      {open && (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {ts.map((t) => <TemplateCard key={t.kind} t={t} onPick={() => onPick(t)} />)}
        </div>
      )}
    </section>
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
                rows={7}
                value={inputs[f.key] || ""}
                onChange={(e) => setInputs({ ...inputs, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="w-full resize-y min-h-[140px] rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-[14px] leading-relaxed text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
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
          className="inline-flex items-center gap-1.5 h-11 px-5 rounded-lg bg-primary text-white font-semibold text-[14px] hover:bg-primary/90 shadow-lg disabled:opacity-60"
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
  const [busy, setBusy] = useState<"save" | "regen" | "send" | "approve" | "return" | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [lhBusy, setLhBusy] = useState(false);
  const [lhOpen, setLhOpen] = useState(false);
  const [lhList, setLhList] = useState<WsTemplate[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [remarks, setRemarks] = useState("");
  const { confirm, dialog } = useConfirm();
  useEffect(() => { setContent(draft.content); setRemarks(""); }, [draft.id, draft.content]);
  const dirty = content !== draft.content;
  const style = tmpl ? catStyle(tmpl.category) : { chip: "bg-slate-100 text-slate-500 ring-slate-200" };

  // Review state (backend-derived).
  const rev = draft.review;
  const isReviewer = !!rev?.is_reviewer;                       // I'm the assigned reviewer, mid-review
  const isOwner = rev ? rev.is_owner : true;
  const canEdit = rev ? rev.can_edit : true;                   // may I edit the text right now?
  const outForReview = draft.status === "in_review";
  const sm = statusMeta(draft.status);
  const history = rev?.history ?? [];
  const lastResolved = [...history].reverse().find((h) => h.status !== "pending");
  const canSend = isOwner && !outForReview;                    // send/re-send whenever not already out

  async function save() {
    setBusy("save");
    try {
      const d = await api.updateDraft(draft.id, { content });
      onChange(d); onSaved(); toast.success("Draft saved");
    } catch (e: any) { toast.error(e?.message ?? "Couldn't save the draft"); }
    finally { setBusy(null); }
  }
  async function regen() {
    setBusy("regen");
    try {
      const d = await api.regenerateDraft(draft.id);
      onChange(d); toast.success("Draft regenerated");
    } catch (e: any) { toast.error(e?.message ?? "Couldn't regenerate the draft"); }
    finally { setBusy(null); }
  }
  async function sendForReview(reviewerId: number, note: string) {
    setBusy("send");
    try {
      const d = await api.draftSendReview(draft.id, { reviewer_user_id: reviewerId, note });
      onChange(d); onSaved(); setShowSend(false);
      toast.success("Sent for review");
    } catch (e: any) { toast.error(e?.message ?? "Couldn't send for review"); }
    finally { setBusy(null); }
  }
  async function resolve(action: "approve" | "return") {
    if (action === "return" && !remarks.trim()) { toast.error("Add a note so the drafter knows what to correct."); return; }
    // persist any inline edits first, so the reviewer's corrections are saved
    if (dirty) { try { await api.updateDraft(draft.id, { content }); } catch { /* */ } }
    setBusy(action);
    try {
      const d = action === "approve"
        ? await api.draftApprove(draft.id, remarks.trim() || undefined)
        : await api.draftReturn(draft.id, remarks.trim());
      onChange(d); onSaved();
      toast.success(action === "approve" ? "Approved" : "Returned to drafter");
    } catch (e: any) { toast.error(e?.message ?? "Couldn't complete the review"); }
    finally { setBusy(null); }
  }
  function copy() {
    navigator.clipboard?.writeText(content).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1600);
    });
  }
  async function downloadWord() {
    try {
      if (dirty && canEdit) await save();
      const name = (draft.title || tmpl?.label || "draft").replace(/[^\w.-]+/g, "_");
      const m = await api.appealDownload(`/drafts/${draft.id}/export.docx`, `${name}.docx`);
      if (m !== "cancelled") toast.success("Saved to your computer.");
    } catch (e: any) { toast.error(e?.message ?? "Word export failed"); }
  }
  // Download this draft rendered onto one of the officer's uploaded letterheads
  // (Templates → Upload .docx). Header/footer preserved; body = this draft.
  async function letterheadClick() {
    setLhBusy(true);
    try {
      if (dirty && canEdit) await save();
      const lh = (await api.wsTemplates()).filter((t) => t.kind === "file");
      if (lh.length === 0) {
        toast.error("Upload your office letterhead on the Templates page first (Upload .docx).");
        return;
      }
      if (lh.length === 1) { await renderOnLetterhead(lh[0]); return; }
      setLhList(lh); setLhOpen(true);
    } catch (e: any) { toast.error(e?.message ?? "Couldn't load your letterheads"); }
    finally { setLhBusy(false); }
  }
  async function renderOnLetterhead(t: WsTemplate) {
    setLhOpen(false);
    try {
      const name = (draft.title || tmpl?.label || "draft").replace(/[^\w.-]+/g, "_");
      // strip the draft's own office heading — the letterhead already carries it.
      const m = await api.wsRenderTemplateDocx(t.id, content, `${name}.docx`, true);
      if (m !== "cancelled") toast.success(`Saved on ${t.name}.`);
    } catch (e: any) { toast.error(e?.message ?? "Letterhead export failed"); }
  }
  async function del() {
    if (!(await confirm({
      title: "Delete this draft?",
      description: "This removes the draft permanently. This cannot be undone.",
      tone: "danger", confirmLabel: "Delete draft",
    }))) return;
    try {
      await api.deleteDraft(draft.id);
      onDeleted(); toast.success("Draft deleted");
    } catch (e: any) { toast.error(e?.message ?? "Couldn't delete the draft"); }
  }

  const wordCount = useMemo(() => content.trim().split(/\s+/).filter(Boolean).length, [content]);

  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
      {dialog}
      {showSend && (
        <SendReviewModal busy={busy === "send"} onClose={() => setShowSend(false)} onSend={sendForReview}
          requiredApproval={draft.review?.required_approval ?? null} />
      )}
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
            <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] font-semibold", sm.cls)}>
              <span className="size-1 rounded-full bg-current" /> {sm.label}
            </span>
            {outForReview && rev?.reviewer_name && isOwner && (
              <span className="text-slate-500">· with {rev.reviewer_name}</span>
            )}
            {dirty && <span className="text-amber-700 font-medium">· unsaved changes</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <TbBtn onClick={copy} icon={copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}>
            {copied ? "Copied" : "Copy"}
          </TbBtn>
          <TbBtn onClick={downloadWord} disabled={!!busy} icon={<Download className="size-3.5" />}>Word</TbBtn>
          <div className="relative">
            <TbBtn onClick={letterheadClick} disabled={!!busy || lhBusy}
              icon={lhBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Stamp className="size-3.5" />}>
              Letterhead
            </TbBtn>
            {lhOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setLhOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-60 rounded-lg bg-white ring-1 ring-slate-200 shadow-lg p-1">
                  <div className="px-2 py-1 text-[10.5px] uppercase tracking-wide text-slate-400 font-semibold">Download on letterhead</div>
                  {lhList.map((t) => (
                    <button key={t.id} onClick={() => renderOnLetterhead(t)}
                      className="w-full text-left px-2 py-1.5 rounded-md text-[13px] text-slate-700 hover:bg-slate-100 flex items-center gap-2">
                      <Stamp className="size-3.5 text-primary shrink-0" /><span className="truncate">{t.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {/* Owner-only editing actions — hidden while out for review or for the reviewer */}
          {isOwner && !outForReview && (
            <>
              <TbBtn onClick={regen} disabled={!!busy} icon={<RefreshCw className={cn("size-3.5", busy === "regen" && "animate-spin")} />}>Regenerate</TbBtn>
              <TbBtn onClick={del} icon={<Trash2 className="size-3.5" />} danger />
            </>
          )}
          {(canEdit) && (
            <Button size="sm" onClick={save} disabled={!dirty || !!busy} className="h-8">
              {busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
            </Button>
          )}
          {canSend && (
            <Button size="sm" onClick={() => setShowSend(true)} disabled={!!busy}
              className="h-8 bg-primary">
              <Send className="size-3.5" /> Send for review
            </Button>
          )}
        </div>
      </div>

      {/* Contextual banners */}
      {isOwner && outForReview && (
        <div className="px-5 py-2.5 bg-blue-50 border-b border-blue-100 text-[12.5px] text-blue-900 flex items-center gap-2">
          <Lock className="size-3.5 shrink-0" />
          Out for review with <b>{rev?.reviewer_name || "your reviewer"}</b> — locked until they respond.
        </div>
      )}
      {isOwner && draft.status === "returned" && lastResolved && (
        <div className="px-5 py-2.5 bg-rose-50 border-b border-rose-100 text-[12.5px] text-rose-900">
          <div className="flex items-center gap-2 font-semibold"><CornerUpLeft className="size-3.5" /> Returned by {lastResolved.reviewer || "reviewer"}</div>
          {lastResolved.review_remarks && <div className="mt-0.5 text-rose-800">“{lastResolved.review_remarks}”</div>}
        </div>
      )}
      {isOwner && draft.status === "approved" && lastResolved && (
        <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-100 text-[12.5px] text-emerald-900">
          <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-3.5" /> Approved by {lastResolved.reviewer || "reviewer"}</div>
          {lastResolved.review_remarks && <div className="mt-0.5 text-emerald-800">“{lastResolved.review_remarks}”</div>}
        </div>
      )}
      {isReviewer && (
        <div className="px-5 py-2.5 bg-amber-50 border-b border-amber-100 text-[12.5px] text-amber-900 flex items-center gap-2">
          <Users className="size-3.5 shrink-0" />
          Reviewing {history[history.length - 1]?.drafter ? <b>&nbsp;{history[history.length - 1]?.drafter}’s</b> : "this"} draft — edit inline if needed, then approve or return.
        </div>
      )}

      {/* Editor body */}
      <div className="p-5 bg-slate-50/60">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          readOnly={!canEdit}
          spellCheck={false}
          className={cn(
            "w-full resize-y min-h-[68vh] rounded-xl border border-slate-200 p-6 text-[14px] leading-[1.8] font-mono text-slate-800 shadow-inner focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 whitespace-pre-wrap",
            canEdit ? "bg-white" : "bg-slate-100/70 cursor-not-allowed"
          )}
        />
      </div>

      {/* Reviewer action bar */}
      {isReviewer && (
        <div className="px-5 py-3.5 border-t border-slate-100 bg-white space-y-2.5">
          <textarea
            value={remarks} onChange={(e) => setRemarks(e.target.value)}
            rows={2} placeholder="Remarks for the drafter (required to return; optional to approve)…"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => resolve("approve")} disabled={!!busy}
              className="h-9 bg-emerald-600 hover:bg-emerald-700">
              {busy === "approve" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Approve
            </Button>
            <button onClick={() => resolve("return")} disabled={!!busy}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold text-rose-700 ring-1 ring-rose-200 bg-white hover:bg-rose-50 disabled:opacity-60">
              {busy === "return" ? <Loader2 className="size-4 animate-spin" /> : <CornerUpLeft className="size-4" />} Return with remarks
            </button>
            <span className="ml-auto text-[11.5px] text-slate-400">Your edits are saved with your decision.</span>
          </div>
        </div>
      )}

      {/* Footer stats + history */}
      <div className="px-5 py-2.5 border-t border-slate-100 bg-white flex items-center justify-between text-[11.5px] text-slate-500">
        <div className="flex items-center gap-3">
          <span className="tabular-nums">{wordCount.toLocaleString()} words</span>
          <span>·</span>
          <span className="tabular-nums">{content.length.toLocaleString()} chars</span>
          {history.length > 0 && (
            <>
              <span>·</span>
              <button onClick={() => setShowHistory((s) => !s)} className="inline-flex items-center gap-1 text-slate-500 hover:text-primary font-medium">
                <History className="size-3" /> Review history ({history.length})
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <ShieldCheck className="size-3 text-emerald-500" /> Every step is audit-logged.
        </div>
      </div>

      {showHistory && history.length > 0 && (
        <div className="px-5 pb-4 bg-white">
          <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {history.map((h, i) => {
              const m = statusMeta(h.status === "pending" ? "in_review" : h.status);
              return (
                <li key={i} className="px-4 py-2.5 text-[12.5px]">
                  <div className="flex items-center gap-2">
                    <span className={cn("px-1.5 py-0.5 rounded-full text-[10.5px] font-semibold", m.cls)}>{h.status === "pending" ? "Sent" : m.label}</span>
                    <span className="text-slate-700">
                      {h.status === "pending"
                        ? <>{h.drafter} → {h.reviewer}</>
                        : <>{h.reviewer} {h.status} {h.drafter}’s draft</>}
                    </span>
                    <span className="ml-auto text-slate-400">{relTime(h.resolved_at || h.created_at || "")}</span>
                  </div>
                  {(h.request_note || h.review_remarks) && (
                    <div className="mt-1 text-slate-500 italic">“{h.review_remarks || h.request_note}”</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Send-for-review modal — pick a senior in your wing, add a covering note.
// ---------------------------------------------------------------------------
function SendReviewModal({
  busy, onClose, onSend, requiredApproval,
}: {
  busy: boolean; onClose: () => void; onSend: (reviewerId: number, note: string) => void;
  requiredApproval?: RequiredApproval | null;
}) {
  const [reviewers, setReviewers] = useState<Reviewer[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const reqTiers = new Set(requiredApproval?.required_tiers ?? []);

  useEffect(() => { api.draftReviewers().then(setReviewers).catch(() => setReviewers([])); }, []);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = reviewers ?? [];
    return t ? list.filter((r) => (r.full_name || "").toLowerCase().includes(t) || (r.designation || "").toLowerCase().includes(t)) : list;
  }, [reviewers, q]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <div className="size-8 rounded-lg bg-primary/10 text-primary grid place-items-center"><Send className="size-4" /></div>
          <div className="font-semibold text-slate-900 text-[15px]">Send for review</div>
          <button onClick={onClose} className="ml-auto p-1 rounded text-slate-400 hover:bg-slate-100"><X className="size-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          {requiredApproval && (
            <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2.5 text-[12px] text-amber-900">
              <div className="font-semibold">Needs sanction under §{requiredApproval.section} — {requiredApproval.what}</div>
              <div className="mt-0.5">Approving authority: <b>{requiredApproval.authority.join(" / ")}</b>{requiredApproval.years_elapsed != null ? ` · ${requiredApproval.years_elapsed} yrs since AY-end` : ""}. Pick a reviewer marked <span className="font-semibold text-emerald-700">Recommended</span>.</div>
            </div>
          )}
          <div>
            <label className="text-[12.5px] font-semibold text-slate-800 mb-1.5 block">Reviewer</label>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-400 pointer-events-none" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search colleagues…"
                className="w-full h-9 pl-9 pr-3 rounded-lg bg-slate-50 ring-1 ring-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-white" />
            </div>
            <div className="max-h-56 overflow-y-auto rounded-lg ring-1 ring-slate-200 divide-y divide-slate-100">
              {reviewers === null && <div className="px-3 py-6 text-center text-[12.5px] text-slate-400">Loading colleagues…</div>}
              {reviewers !== null && filtered.length === 0 && <div className="px-3 py-6 text-center text-[12.5px] text-slate-400">No colleagues found in your wing.</div>}
              {filtered.map((r) => (
                <button key={r.id} onClick={() => setPicked(r.id)}
                  className={cn("w-full text-left px-3 py-2 flex items-center gap-2.5 transition-colors",
                    picked === r.id ? "bg-primary/10" : "hover:bg-slate-50")}>
                  <div className="size-7 rounded-full bg-slate-100 text-slate-500 grid place-items-center text-[11px] font-semibold shrink-0">
                    {(r.full_name || "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-slate-800 truncate">{r.full_name}</div>
                    {r.designation && <div className="text-[11px] text-slate-500 truncate">{r.designation}</div>}
                  </div>
                  {reqTiers.size > 0 && reqTiers.has(r.tier) && <span className="shrink-0 text-[10px] font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 rounded-full px-1.5 py-0.5">Recommended</span>}
                  {r.is_senior && <span className="shrink-0 text-[10px] font-semibold text-indigo-700 bg-indigo-50 ring-1 ring-indigo-200 rounded-full px-1.5 py-0.5">Senior</span>}
                  {picked === r.id && <Check className="size-4 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[12.5px] font-semibold text-slate-800 mb-1.5 block">Note <span className="font-normal text-slate-400">(optional)</span></label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder="e.g. For your approval under §151."
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
          </div>
        </div>
        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-[13px] font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <Button size="sm" className="h-9" disabled={!picked || busy} onClick={() => picked && onSend(picked, note)}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send
          </Button>
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

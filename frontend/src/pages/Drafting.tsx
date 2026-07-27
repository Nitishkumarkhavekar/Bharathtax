import { useEffect, useMemo, useState } from "react";
import {
  FileText,
  Plus,
  Loader2,
  Sparkles,
  Copy,
  Check,
  RefreshCw,
  Save,
  Trash2,
  ArrowLeft,
  ScrollText,
  Download,
} from "lucide-react";
import { api, DraftDoc, DraftListItem, DraftTemplate } from "../api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
    setTmpl(t);
    setInputs({});
    setErr(null);
    setView("form");
  }

  async function generate() {
    if (!tmpl || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const d = await api.createDraft({ kind: tmpl.kind, inputs });
      setCurrent(d);
      setView("edit");
      refreshList();
    } catch (e: any) {
      setErr(e?.message ?? "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function openDraft(id: number) {
    setBusy(true);
    try {
      const d = await api.getDraft(id);
      setCurrent(d);
      setTmpl(templates.find((t) => t.kind === d.kind) ?? null);
      setView("edit");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr] items-start">
      {/* Sidebar: recent drafts */}
      <aside className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between px-1 pb-2">
          <div className="text-sm font-semibold text-slate-900">Your drafts</div>
        </div>
        <Button size="sm" className="w-full mb-2" onClick={() => setView("home")}>
          <Plus className="size-4" /> New draft
        </Button>
        <div className="space-y-1 max-h-[70vh] overflow-y-auto">
          {drafts.length === 0 ? (
            <div className="text-[12px] text-slate-500 px-1 py-3">No drafts yet.</div>
          ) : (
            drafts.map((d) => (
              <button
                key={d.id}
                onClick={() => openDraft(d.id)}
                className={cn(
                  "w-full text-left rounded-lg px-2.5 py-2 hover:bg-slate-50 transition-colors",
                  current?.id === d.id && "bg-slate-100",
                )}
              >
                <div className="text-[13px] font-medium text-slate-800 truncate">{d.title || "Untitled"}</div>
                <div className="text-[10.5px] text-slate-500 flex items-center gap-1.5">
                  <span className="capitalize">{d.status}</span>
                  {d.updated_at && <span>· {new Date(d.updated_at).toLocaleDateString()}</span>}
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="min-w-0">
        {err && (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm px-4 py-2.5">{err}</div>
        )}

        {view === "home" && <TemplatePicker templates={templates} onPick={startNew} />}

        {view === "form" && tmpl && (
          <DraftForm
            tmpl={tmpl}
            inputs={inputs}
            setInputs={setInputs}
            busy={busy}
            onBack={() => setView("home")}
            onGenerate={generate}
          />
        )}

        {view === "edit" && current && (
          <DraftEditor
            draft={current}
            tmpl={tmpl}
            onChange={setCurrent}
            onDeleted={() => {
              setCurrent(null);
              setView("home");
              refreshList();
            }}
            onSaved={refreshList}
          />
        )}
      </div>
    </div>
  );
}

function TemplatePicker({ templates, onPick }: { templates: DraftTemplate[]; onPick: (t: DraftTemplate) => void }) {
  const byCat = useMemo(() => {
    const m: Record<string, DraftTemplate[]> = {};
    templates.forEach((t) => (m[t.category] ??= []).push(t));
    return m;
  }, [templates]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
          <ScrollText className="size-5 text-primary" /> Draft a document
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Grounded in primary law, written from the Department's standpoint, on your machine.
        </p>
      </div>
      {Object.entries(byCat).map(([cat, ts]) => (
        <div key={cat}>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">{cat}s</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {ts.map((t) => (
              <button
                key={t.kind}
                onClick={() => onPick(t)}
                className="text-left rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-primary hover:shadow transition-all group"
              >
                <div className="flex items-center gap-2">
                  <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                    <FileText className="size-4" />
                  </div>
                  <div className="font-medium text-slate-900 text-[14px]">{t.label}</div>
                </div>
                {t.section && <div className="text-[11.5px] text-slate-500 mt-2">Section {t.section}</div>}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DraftForm({
  tmpl,
  inputs,
  setInputs,
  busy,
  onBack,
  onGenerate,
}: {
  tmpl: DraftTemplate;
  inputs: Record<string, string>;
  setInputs: (v: Record<string, string>) => void;
  busy: boolean;
  onBack: () => void;
  onGenerate: () => void;
}) {
  const missing = tmpl.fields.some((f) => f.required && !(inputs[f.key] || "").trim());
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm max-w-2xl">
      <button onClick={onBack} className="text-[12.5px] text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 mb-3">
        <ArrowLeft className="size-3.5" /> All templates
      </button>
      <h2 className="text-lg font-semibold text-slate-900">{tmpl.label}</h2>
      <p className="text-[12.5px] text-slate-500 mb-4">Fill the facts — the draft uses only what you provide.</p>
      <div className="space-y-3">
        {tmpl.fields.map((f) => (
          <div key={f.key}>
            <label className="text-[12.5px] font-semibold text-slate-800 mb-1 block">
              {f.label}
              {f.required && <span className="text-rose-500"> *</span>}
            </label>
            {f.textarea ? (
              <textarea
                rows={3}
                value={inputs[f.key] || ""}
                onChange={(e) => setInputs({ ...inputs, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            ) : (
              <input
                value={inputs[f.key] || ""}
                onChange={(e) => setInputs({ ...inputs, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-end pt-4">
        <Button onClick={onGenerate} disabled={busy || missing}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Drafting…
            </>
          ) : (
            <>
              <Sparkles className="size-4" /> Generate draft
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function DraftEditor({
  draft,
  tmpl,
  onChange,
  onDeleted,
  onSaved,
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

  async function save() {
    setBusy("save");
    try {
      const d = await api.updateDraft(draft.id, { content });
      onChange(d);
      onSaved();
    } finally {
      setBusy(null);
    }
  }
  async function regen() {
    setBusy("regen");
    try {
      const d = await api.regenerateDraft(draft.id);
      onChange(d);
    } finally {
      setBusy(null);
    }
  }
  function copy() {
    navigator.clipboard?.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }
  async function downloadWord() {
    // Export reflects saved content — flush any pending edits first.
    if (dirty) await save();
    const name = (draft.title || tmpl?.label || "draft").replace(/[^\w.-]+/g, "_");
    await api.appealDownload(`/drafts/${draft.id}/export.docx`, `${name}.docx`);
  }
  async function del() {
    if (!confirm("Delete this draft?")) return;
    await api.deleteDraft(draft.id);
    onDeleted();
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-slate-900 truncate">{draft.title || tmpl?.label || "Draft"}</h2>
          <div className="text-[11px] text-slate-500">{tmpl?.label} · you can edit before sending</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={copy} className="inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1.5 rounded-lg bg-slate-50 ring-1 ring-slate-200 hover:bg-slate-100">
            {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
          </button>
          <button onClick={regen} disabled={!!busy} className="inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1.5 rounded-lg bg-slate-50 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-60">
            <RefreshCw className={cn("size-3.5", busy === "regen" && "animate-spin")} /> Regenerate
          </button>
          <button onClick={downloadWord} disabled={!!busy} className="inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1.5 rounded-lg bg-slate-50 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-60">
            <Download className="size-3.5" /> Word
          </button>
          <button onClick={del} className="inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50">
            <Trash2 className="size-3.5" />
          </button>
          <Button size="sm" onClick={save} disabled={!dirty || !!busy}>
            {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
          </Button>
        </div>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full min-h-[520px] rounded-lg border border-slate-200 bg-white p-4 text-[13.5px] leading-relaxed font-mono text-slate-800 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 whitespace-pre-wrap"
      />
    </div>
  );
}

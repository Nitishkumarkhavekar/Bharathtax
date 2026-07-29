import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiError,
  type AppealCase,
  type AppealDocument,
  type AppealLatest,
  type AppealOutput,
  type AppealRun,
} from "../api";

// The desktop's mirror of the web's /appeals/:id case-detail page.  Sections:
//   1. Documents — pick files off disk, upload, categorise, view, delete.
//   2. Pipeline — 6-module progress + Run / Stop controls.
//   3. Draft   — Reassemble, Download DOCX, Edit-with-AI composer.
// We intentionally skip the OnlyOffice editor embed (needs a live web session
// handoff that Electron's isolated context makes fiddly) — officers can still
// download the DOCX and open it in Word.

const MODULES = [
  { key: 1, label: "Deficiency",  outputKind: "deficiency" },
  { key: 2, label: "Scope",       outputKind: "scope" },
  { key: 3, label: "Compliance",  outputKind: "compliance" },
  { key: 4, label: "Issues",      outputKind: "issue_matrix" },
  { key: 5, label: "Findings",    outputKind: "finding" }, // seq-per-issue
  { key: 6, label: "Draft Order", outputKind: "draft" },
];

// Backend's AppealRun.progress is a free-form label like "Module 3: Document
// compliance in progress". Pull the leading module number out so we can
// render a numeric percentage and paint the step chips.
function parseProgress(run: AppealRun | null | undefined): number {
  if (!run) return 0;
  if (run.status === "done") return 6;
  if (typeof run.progress === "number") return Math.max(0, Math.min(6, run.progress));
  const s = String(run.progress || "");
  const m = s.match(/module\s*(\d)/i);
  if (m) return Math.max(0, Math.min(6, parseInt(m[1], 10)));
  if (run.status === "running" || run.status === "queued") return 0;
  return 0;
}

const CATEGORIES = [
  "unclassified",
  "assessment order",
  "written submission",
  "form 35",
  "grounds",
  "annexure",
  "case laws",
  "other",
];

const CATEGORY_TONES: Record<string, string> = {
  "assessment order": "bg-amber-50 text-amber-800 ring-amber-200",
  "written submission": "bg-violet-50 text-violet-800 ring-violet-200",
  "form 35": "bg-sky-50 text-sky-800 ring-sky-200",
  "grounds": "bg-indigo-50 text-indigo-800 ring-indigo-200",
  "annexure": "bg-slate-50 text-slate-700 ring-slate-200",
  "case laws": "bg-emerald-50 text-emerald-800 ring-emerald-200",
  "unclassified": "bg-slate-100 text-slate-600 ring-slate-200",
  "other": "bg-slate-100 text-slate-600 ring-slate-200",
};

interface Props {
  slug: string;
  onBack: () => void;
}

export default function AppealCaseScreen({ slug, onBack }: Props) {
  const [c, setC] = useState<AppealCase | null>(null);
  const [latest, setLatest] = useState<AppealLatest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // 'upload' | 'run' | 'stop' | 'reassemble' | 'download' | 'instruct'
  const [flash, setFlash] = useState<string | null>(null);

  const pollTimer = useRef<number | null>(null);

  async function refresh(quiet = false) {
    try {
      const [case_, l] = await Promise.all([api.getCase(slug), api.latest(slug)]);
      setC(case_); setLatest(l);
    } catch (e: any) {
      if (!quiet) setErr(e instanceof ApiError ? e.message : String(e));
    }
  }

  useEffect(() => {
    refresh();
    return () => { if (pollTimer.current) window.clearInterval(pollTimer.current); };
  }, [slug]);

  // Poll while a run is in progress.
  useEffect(() => {
    const isRunning = latest?.run && ["queued", "running"].includes(latest.run.status);
    if (pollTimer.current) { window.clearInterval(pollTimer.current); pollTimer.current = null; }
    if (isRunning) pollTimer.current = window.setInterval(() => refresh(true), 4000);
    return () => { if (pollTimer.current) window.clearInterval(pollTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.run?.status]);

  function showFlash(msg: string) {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 3500);
  }

  async function withBusy(kind: string, fn: () => Promise<void>) {
    setBusy(kind); setErr(null);
    try { await fn(); } catch (e: any) { setErr(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  async function onUpload() {
    const picks = await window.bharat.files.pick();
    if (!picks.length) return;
    await withBusy("upload", async () => {
      const files = await Promise.all(picks.map(async (p) => ({
        name: p.name, bytes: await window.bharat.files.read(p.path),
      })));
      const r = await api.uploadDocuments(slug, files);
      showFlash(`Uploaded ${r.documents.length} file(s)${r.skipped.length ? `, skipped ${r.skipped.length}` : ""}`);
      await refresh();
    });
  }

  async function onDeleteDoc(d: AppealDocument) {
    if (!window.confirm(`Remove ${d.filename}?`)) return;
    await withBusy("delete-doc", async () => {
      await api.deleteDoc(slug, d.id);
      showFlash("Document removed");
      await refresh();
    });
  }

  async function onOpenDoc(d: AppealDocument) {
    await withBusy("open-doc", async () => {
      const bytes = await api.downloadDoc(slug, d.id);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  }

  async function onCategorise(d: AppealDocument, category: string) {
    await withBusy("categorise", async () => {
      await api.updateDocCategory(slug, d.id, category);
      await refresh(true);
    });
  }

  async function onRun() {
    await withBusy("run", async () => {
      await api.startRun(slug);
      showFlash("Pipeline started");
      await refresh();
    });
  }

  async function onStop() {
    await withBusy("stop", async () => {
      await api.stopCase(slug);
      showFlash("Run stopped");
      await refresh();
    });
  }

  async function onReassemble() {
    await withBusy("reassemble", async () => {
      await api.reassemble(slug);
      showFlash("Draft reassembled");
      await refresh();
    });
  }

  async function onDownload() {
    await withBusy("download", async () => {
      const bytes = await api.exportDocx(slug);
      const defaultName = `${c?.title.replace(/[^a-z0-9]+/gi, "_") || "draft_order"}.docx`;
      const r = await window.bharat.files.saveDocx(defaultName, bytes);
      if (r.saved) showFlash(`Saved to ${r.path}`);
    });
  }

  async function onInstruct(instruction: string) {
    await withBusy("instruct", async () => {
      const r = await api.instructDraft(slug, instruction);
      showFlash(`Draft updated (v${r.version}${r.scope ? " · " + r.scope : ""})`);
      await refresh(true);
    });
  }

  // ---------------------------------------------------------------- render

  if (!c) {
    return (
      <div className="flex-1 grid place-items-center text-slate-500">
        {err ? <div className="text-rose-700">{err}</div> : "Loading case…"}
      </div>
    );
  }

  const run = latest?.run;
  const progress = parseProgress(run);
  const status = statusBadge(c, run);
  const outputs = latest?.outputs ?? [];
  const findings = latest?.findings ?? [];
  const progressLabel = typeof run?.progress === "string" && run.progress
    ? run.progress
    : run?.status === "done" ? "Complete" : run?.status === "queued" ? "Queued" : "";

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50">
      <div className="w-full px-8 py-6 space-y-5">
        {/* header */}
        <div className="flex items-start gap-4">
          <button onClick={onBack}
            className="mt-1 h-9 px-3 rounded-md text-slate-600 hover:bg-slate-100 font-medium text-sm inline-flex items-center gap-1.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            All cases
          </button>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{c.title}</h1>
              <span className={"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-semibold capitalize " + status.tone}>
                <span className="size-1.5 rounded-full bg-current" /> {status.label}
              </span>
            </div>
            <div className="text-[14.5px] text-slate-500 mt-1">
              AY {c.assessment_year || "—"} · PAN {c.pan || "—"} · s.{c.section || "—"}
            </div>
          </div>
        </div>

        {flash && <FlashBanner tone="ok" msg={flash} />}
        {err && <FlashBanner tone="err" msg={err} onDismiss={() => setErr(null)} />}

        {/* Documents — collapsible, defaults to open on first paint but the
            officer can hide it after the pipeline has run so the pipeline
            + draft workspace is easier to reach. */}
        <Section
          title="Documents"
          collapsible
          defaultOpen
          subtitle={c.documents && c.documents.length > 0
            ? `· ${c.documents.length} file${c.documents.length === 1 ? "" : "s"}`
            : undefined}
          right={
            <button onClick={onUpload} disabled={busy === "upload"}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-brand-600 text-white font-semibold text-[14.5px] hover:bg-brand-700 disabled:opacity-60">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
              {busy === "upload" ? "Uploading…" : "Upload case files"}
            </button>
          }
        >
          {c.documents && c.documents.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {c.documents.map((d) => (
                <DocumentRow key={d.id} d={d}
                  onOpen={() => onOpenDoc(d)}
                  onDelete={() => onDeleteDoc(d)}
                  onCategorise={(cat) => onCategorise(d, cat)} />
              ))}
            </ul>
          ) : (
            <div className="text-sm text-slate-500 py-6 text-center">
              No documents uploaded yet. Click <b>Upload case files</b> to add the appeal bundle.
            </div>
          )}
        </Section>

        {/* Pipeline */}
        <Section title="Pipeline progress" right={
          <div className="text-xs text-slate-500 flex items-center gap-2">
            {progressLabel && <span className="truncate max-w-[280px]">{progressLabel}</span>}
            <span className="tabular-nums">{progress}/6 · {Math.round((progress / 6) * 100)}%</span>
          </div>
        }>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mb-4">
            <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-emerald-500 transition-all duration-500"
              style={{ width: `${(progress / 6) * 100}%` }} />
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {MODULES.map((m) => {
              const state = progress >= m.key ? "done" : progress + 1 === m.key && run?.status === "running" ? "current" : "pending";
              return (
                <div key={m.key} className="flex flex-col items-center text-center">
                  <div className={
                    "size-9 rounded-full flex items-center justify-center text-white " +
                    (state === "done" ? "bg-emerald-500" : state === "current" ? "bg-amber-500 animate-pulse" : "bg-slate-200 text-slate-500")
                  }>
                    {state === "done" ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                    ) : (
                      <span className="text-xs font-semibold">{m.key}</span>
                    )}
                  </div>
                  <div className="text-[12.5px] text-slate-600 mt-1.5 leading-tight">{m.key}. {m.label}</div>
                </div>
              );
            })}
          </div>
          {run?.error && (
            <div className="mt-4 rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">
              <b>Run failed:</b> {run.error}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {(!run || !["queued", "running"].includes(run.status)) && (
              <button onClick={onRun} disabled={busy === "run" || !c.documents?.length}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-brand-600 text-white font-semibold text-[14.5px] hover:bg-brand-700 disabled:opacity-60">
                {busy === "run" ? "Starting…" : run?.status === "done" ? "Re-run pipeline" : "Run pipeline"}
              </button>
            )}
            {run && ["queued", "running"].includes(run.status) && (
              <button onClick={onStop} disabled={busy === "stop"}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-rose-600 text-white font-semibold text-[14.5px] hover:bg-rose-700 disabled:opacity-60">
                {busy === "stop" ? "Stopping…" : "Stop"}
              </button>
            )}
            {run?.status === "done" && (
              <button onClick={onReassemble} disabled={busy === "reassemble"}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-white ring-1 ring-slate-200 text-slate-700 font-medium text-[14.5px] hover:bg-slate-50 disabled:opacity-60">
                {busy === "reassemble" ? "Reassembling…" : "Reassemble draft"}
              </button>
            )}
          </div>
        </Section>

        {/* Per-module outputs — one collapsible section per module so the
            officer can inspect what each stage produced. */}
        {(outputs.length > 0 || findings.length > 0) && (
          <ModulesPanel
            outputs={outputs}
            findings={findings}
            slug={slug}
            documents={c.documents ?? []}
          />
        )}

        {/* Draft — Preview / Modify with AI / Manual edit */}
        {run?.status === "done" && (
          <DraftPane
            slug={slug}
            caseTitle={c.title}
            draftText={(outputs.find((o) => o.kind === "draft")?.content) || ""}
            draftVersion={outputs.find((o) => o.kind === "draft")?.version ?? null}
            refreshKey={outputs.length + findings.length}
            onDownload={onDownload}
            downloadBusy={busy === "download"}
            onFullInstruct={onInstruct}
            fullBusy={busy === "instruct"}
            onSynced={() => refresh(true)}
          />
        )}

        <div className="text-[12.5px] text-slate-400 text-center pb-2">
          Case slug: <span className="font-mono">{c.slug}</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- helpers

// ================================================================ modules

// Per-module output display.  Each module renders as a collapsible card.
//   1. Deficiency  → plain markdown
//   2. Scope       → plain markdown
//   3. Compliance  → JSON we surface as a bullet list of items
//   4. Issues      → JSON matrix of {issue, grounds, ...}
//   5. Findings    → many outputs (one per issue), keyed by seq
//   6. Draft Order → the assembled draft (also shown in the Preview pane)
function ModulesPanel({ outputs, findings, slug, documents }: {
  outputs: AppealOutput[]; findings: AppealOutput[];
  slug: string; documents: AppealDocument[];
}) {
  const get = (kind: string) => outputs.find((o) => o.kind === kind);

  return (
    <Section title="Modules & outputs">
      <div className="space-y-2">
        <ModuleCard n={1} title="Deficiency Report" out={get("deficiency")} render="markdown" />
        <ModuleCard n={2} title="Scope Validation"  out={get("scope")}      render="markdown" />
        <ModuleCard n={3} title="Document Compliance" out={get("compliance")} render="compliance"
          extra={{ slug, documents }} />
        <ModuleCard n={4} title="Issue Matrix"      out={get("issue_matrix")} render="issues" />
        <FindingsCard findings={findings} />
        <ModuleCard n={6} title="Draft Order"       out={get("draft")}      render="markdown" />
      </div>
    </Section>
  );
}

function ModuleCard({ n, title, out, render, extra }: {
  n: number; title: string; out: AppealOutput | undefined;
  render: "markdown" | "json" | "issues" | "compliance";
  extra?: { slug: string; documents: AppealDocument[] };
}) {
  const [open, setOpen] = useState(false);
  const hasContent = !!out?.content;
  return (
    <div className="rounded-lg ring-1 ring-slate-200 bg-white overflow-hidden">
      <button
        onClick={() => hasContent && setOpen((v) => !v)}
        disabled={!hasContent}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left disabled:cursor-not-allowed"
      >
        <div className={
          "size-8 rounded-md flex items-center justify-center text-xs font-semibold " +
          (hasContent ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400")
        }>
          {hasContent ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          ) : n}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14.5px] font-semibold text-slate-900">Module {n} — {title}</div>
          <div className="text-[13px] text-slate-500">
            {hasContent ? `ready · ${out!.content.length.toLocaleString()} chars${out!.edited ? " · edited" : ""}` : "not yet produced"}
          </div>
        </div>
        {hasContent && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={"text-slate-400 transition-transform " + (open ? "rotate-180" : "")}><path d="m6 9 6 6 6-6" /></svg>
        )}
      </button>
      {open && hasContent && (
        <div className="px-4 pb-3 pt-1 border-t border-slate-100 bg-slate-50/50 max-h-96 overflow-y-auto">
          {render === "markdown"   && <MarkdownBlock text={out!.content} />}
          {render === "json"       && <JsonBlock text={out!.content} />}
          {render === "issues"     && <IssuesBlock text={out!.content} />}
          {render === "compliance" && extra && (
            <ComplianceBlock text={out!.content} slug={extra.slug} documents={extra.documents} />
          )}
        </div>
      )}
    </div>
  );
}

function FindingsCard({ findings }: { findings: AppealOutput[] }) {
  const [open, setOpen] = useState(false);
  const ready = findings.length > 0;
  return (
    <div className="rounded-lg ring-1 ring-slate-200 bg-white overflow-hidden">
      <button
        onClick={() => ready && setOpen((v) => !v)}
        disabled={!ready}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left disabled:cursor-not-allowed"
      >
        <div className={
          "size-8 rounded-md flex items-center justify-center text-xs font-semibold " +
          (ready ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400")
        }>
          {ready ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          ) : 5}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14.5px] font-semibold text-slate-900">Module 5 — Issue-wise Findings</div>
          <div className="text-[13px] text-slate-500">
            {ready ? `${findings.length} finding${findings.length > 1 ? "s" : ""} drafted` : "not yet produced"}
          </div>
        </div>
        {ready && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={"text-slate-400 transition-transform " + (open ? "rotate-180" : "")}><path d="m6 9 6 6 6-6" /></svg>
        )}
      </button>
      {open && ready && (
        <div className="px-4 pb-3 pt-1 border-t border-slate-100 bg-slate-50/50 max-h-[500px] overflow-y-auto space-y-3">
          {findings.map((f) => (
            <div key={f.id} className="rounded-md bg-white ring-1 ring-slate-200 p-3">
              <div className="text-[13.5px] font-semibold text-slate-800 mb-1">
                {typeof f.seq === "number" ? `Issue ${f.seq + 1}` : "Issue"}
                {f.label && <span className="ml-2 font-normal text-slate-500">— {f.label}</span>}
              </div>
              <MarkdownBlock text={f.content} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -------------- lightweight renderers (no external markdown lib) ----------

// Renders the draft in the "formal legal document" style so Modify-with-AI
// matches the PDF preview: serif body, justified paragraphs, centered
// section headings, numbered indents.  Works from markdown OR plain text.
// Normalise stray asterisks the LLM sometimes emits (e.g. "****Result:"):
// collapse runs of 3+ to a pair, and drop unbalanced ** per line so no raw
// asterisks render. Balanced **bold** is preserved.
function normalizeAsterisks(text: string): string {
  return (text || "")
    .split("\n")
    .map((ln) => {
      let x = ln.replace(/\*{3,}/g, "**");
      if (((x.match(/\*\*/g) || []).length) % 2 !== 0) x = x.replace(/\*\*/g, "");
      return x;
    })
    .join("\n");
}

function DocumentRender({ text }: { text: string }) {
  // Matches the LibreOffice → PDF preview so Modify-with-AI reads identically
  // to Preview: italic Times New Roman body, centred bold headings for the
  // very top block and for ALL-CAPS numbered sections, tab-indented numbered
  // items with bold-italic markers, generous line-height and 1-inch-ish
  // margins on a paper-white sheet.
  const lines = normalizeAsterisks(text).split(/\n/);
  const out: React.ReactNode[] = [];
  let para: string[] = [];
  let ol: string[] = [];
  // Track whether we're still in the top "cover" block (before the first
  // numbered heading) so we can centre those title lines the way LibreOffice
  // does with the leading bold/underlined party header.
  let inCoverBlock = true;

  const flushPara = (key: string) => {
    if (!para.length) return;
    out.push(
      <p key={key} className="text-[15px] leading-[1.9] text-slate-900 text-justify indent-0 mb-4 italic">
        {inlineFormal(para.join(" "))}
      </p>,
    );
    para = [];
  };
  const flushOl = (key: string) => {
    if (!ol.length) return;
    out.push(
      <ol key={key} className="mb-4 space-y-3 list-none pl-0">
        {ol.map((li, i) => (
          <li key={i} className="grid grid-cols-[3rem_1fr] gap-2 text-[15px] leading-[1.9] text-slate-900 text-justify">
            <span className="font-bold italic text-right pr-2">{i + 1}.</span>
            <span className="italic">{inlineFormal(li)}</span>
          </li>
        ))}
      </ol>,
    );
    ol = [];
  };

  // Heading patterns we recognise:
  //   markdown `## Heading`, `### Heading`
  //   ALL-CAPS bold `**1. INTRODUCTION**`
  //   plain ALL-CAPS numbered `1. INTRODUCTION`
  //   bold-wrapped title `**DRAFT APPELLATE ORDER**`
  const H_MD    = /^(#{1,4})\s+(.+?)\s*$/;
  const H_CAPS  = /^\s*(?:\*\*)?\s*(\d{1,2})\.\s+([A-Z][A-Z0-9 &/()\-–—.,]{2,})\s*(?:\*\*)?\s*$/;
  const OL_ITEM = /^\s*(\d{1,2})\.\s+(.+)$/;                 // numbered lists inside a section
  const UL_ITEM = /^\s*[-*]\s+(.+)$/;
  // A short line that is entirely bold + wrapped in ** ... ** — used for the
  // "DRAFT APPELLATE ORDER" and "RAJU (PAN:…) A.Y. …" cover heading.
  const H_BOLD  = /^\s*\*\*(.+?)\*\*\s*$/;

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara(`p${i}`);
      return;
    }
    if (/^#{1,6}\s*$/.test(line.trim())) {
      flushPara(`p${i}`); flushOl(`o${i}`);
      return;
    }

    // MD heading — centred + bold on the top two levels, matching PDF.
    let m: RegExpMatchArray | null;
    if ((m = line.match(H_MD))) {
      flushPara(`p${i}`); flushOl(`o${i}`);
      const level = m[1].length;
      const cls =
        level <= 2
          ? "text-[17px] font-bold text-slate-900 text-center mt-6 mb-4 tracking-wide"
          : "text-[15.5px] font-bold italic text-slate-900 mt-4 mb-2";
      out.push(<div key={`h${i}`} className={cls}>{inlineFormal(m[2])}</div>);
      inCoverBlock = false;
      return;
    }

    // ALL-CAPS numbered heading (e.g. "2. GROUNDS OF APPEAL") — centred bold
    // to match the PDF.
    if ((m = line.match(H_CAPS))) {
      flushPara(`p${i}`); flushOl(`o${i}`);
      out.push(
        <div key={`c${i}`} className="text-[16px] font-bold text-slate-900 text-center mt-6 mb-4 tracking-wide">
          {m[1]}. {inlineFormal(m[2])}
        </div>,
      );
      inCoverBlock = false;
      return;
    }

    // Bold-wrapped standalone title ("**DRAFT APPELLATE ORDER**",
    // "**RAJU (PAN:…) A.Y. …**") — centred, larger, bold.  Only fires while
    // we're still in the cover block so a stray inline **bold** in the middle
    // of a paragraph doesn't get promoted.
    if (inCoverBlock && (m = line.match(H_BOLD)) && m[1].length < 90) {
      flushPara(`p${i}`); flushOl(`o${i}`);
      out.push(
        <div key={`b${i}`} className="text-[16.5px] font-bold text-slate-900 text-center mt-4 mb-3 tracking-wide underline underline-offset-4 decoration-1">
          {m[1]}
        </div>,
      );
      return;
    }

    // Numbered list item.
    if ((m = line.match(OL_ITEM))) {
      flushPara(`p${i}`);
      ol.push(m[2]);
      inCoverBlock = false;
      return;
    }
    // Bullet list item.
    if ((m = line.match(UL_ITEM))) {
      flushPara(`p${i}`); flushOl(`o${i}`);
      out.push(
        <div key={`u${i}`} className="text-[15px] leading-[1.9] text-slate-900 pl-6 relative text-justify mb-1 italic">
          <span className="absolute left-2">•</span> {inlineFormal(m[1])}
        </div>,
      );
      inCoverBlock = false;
      return;
    }
    flushOl(`o${i}`);
    para.push(line);
  });
  flushPara("pE"); flushOl("oE");

  return <div className="font-serif">{out}</div>;
}

function inlineFormal(s: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) parts.push(<b key={i++}>{t.slice(2, -2)}</b>);
    else if (t.startsWith("`")) parts.push(<code key={i++} className="px-1 py-0.5 rounded bg-slate-100 text-[13.5px] font-mono">{t.slice(1, -1)}</code>);
    else parts.push(<sup key={i++} className="text-brand-700 font-medium">{t.replace(/[\[\]]/g, "")}</sup>);
    last = m.index + t.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}

function MarkdownBlock({ text }: { text: string }) {
  // Very small markdown renderer — enough for headings, bold, lists,
  // paragraphs and inline code.  We deliberately avoid pulling in a full
  // library to keep the desktop bundle tight.
  const lines = normalizeAsterisks(text).split(/\n/);
  const rendered: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = (key: string) => {
    if (paragraph.length) {
      rendered.push(<p key={key} className="text-[14.5px] text-slate-700 leading-relaxed mb-2">{inline(paragraph.join(" "))}</p>);
      paragraph = [];
    }
  };
  const flushList = (key: string) => {
    if (listItems.length) {
      rendered.push(<ul key={key} className="list-disc pl-5 mb-2 text-[14.5px] text-slate-700 space-y-0.5">
        {listItems.map((li, i) => <li key={i}>{inline(li)}</li>)}
      </ul>);
      listItems = [];
    }
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (/^#{1,4}\s+/.test(line)) {
      flushParagraph(`p${i}`); flushList(`l${i}`);
      const level = line.match(/^(#+)/)![1].length;
      const txt = line.replace(/^#+\s+/, "");
      const cls =
        level === 1 ? "text-[17.5px] font-semibold text-slate-900 mt-3 mb-1.5" :
        level === 2 ? "text-[16px] font-semibold text-slate-900 mt-3 mb-1.5" :
        "text-[15px] font-semibold text-slate-800 mt-2 mb-1";
      rendered.push(<div key={`h${i}`} className={cls}>{inline(txt)}</div>);
    } else if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph(`p${i}`);
      listItems.push(line.replace(/^\s*[-*]\s+/, ""));
    } else if (line.trim() === "") {
      flushParagraph(`p${i}`); flushList(`l${i}`);
    } else {
      flushList(`l${i}`);
      paragraph.push(line);
    }
  });
  flushParagraph("pE"); flushList("lE");
  return <div>{rendered}</div>;
}

function inline(s: string): React.ReactNode[] {
  // **bold**, `code`, and citation markers [1] rendered as small pills.
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) parts.push(<b key={i++}>{t.slice(2, -2)}</b>);
    else if (t.startsWith("`")) parts.push(<code key={i++} className="px-1 py-0.5 rounded bg-slate-100 text-[13.5px] font-mono">{t.slice(1, -1)}</code>);
    else parts.push(<span key={i++} className="inline-block bg-brand-50 text-brand-700 rounded px-1 text-[12.5px] font-mono mx-0.5">{t}</span>);
    last = m.index + t.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}

function JsonBlock({ text }: { text: string }) {
  let pretty = text;
  try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* leave as-is */ }
  return (
    <pre className="text-[13.5px] font-mono text-slate-700 whitespace-pre-wrap leading-relaxed">
      {pretty}
    </pre>
  );
}

// Module 3's output is a compliance sheet listing every uploaded document with
// its detected category, size and extracted-chars.  Officers care about the
// files, not the raw JSON — so we render a clean per-file list with a
// download button that maps the filename back to the uploaded document id.
function ComplianceBlock({ text, slug, documents }: {
  text: string; slug: string; documents: AppealDocument[];
}) {
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* fall through */ }
  const rows: Array<{ filename: string; category?: string; group?: string; pages?: number; extracted_chars?: number }>
    = (parsed?.compliance_sheet as any[]) || [];
  if (!rows.length) return <JsonBlock text={text} />;

  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const byFilename = new Map(documents.map((d) => [d.filename, d]));

  async function download(filename: string) {
    const d = byFilename.get(filename);
    if (!d) { setErr(`Original file "${filename}" is no longer attached to this case.`); return; }
    setBusy(filename); setErr(null);
    try {
      const bytes = await api.downloadDoc(slug, d.id);
      // Save via native dialog with the extension inferred from the filename.
      await window.bharat.files.saveFile(filename, bytes);
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  // Bucket rows by group so the compliance sheet reads as an organised index.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const g = r.group || "Other documents";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(r);
  }

  return (
    <div className="space-y-3">
      {err && (
        <div className="text-[13.5px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2.5 py-1.5">
          {err}
        </div>
      )}
      {[...groups.entries()].map(([group, items]) => (
        <div key={group} className="rounded-md bg-white ring-1 ring-slate-200">
          <div className="px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500 border-b border-slate-100 bg-slate-50">
            {group}
          </div>
          <ul className="divide-y divide-slate-100">
            {items.map((r, i) => {
              const d = byFilename.get(r.filename);
              const tone = CATEGORY_TONES[r.category || "unclassified"] || CATEGORY_TONES["unclassified"];
              const isDownloading = busy === r.filename;
              return (
                <li key={i} className="px-3 py-2 flex items-center gap-3">
                  <div className="size-8 rounded-md bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] text-slate-800 truncate" title={r.filename}>{r.filename}</div>
                    <div className="text-[12px] text-slate-500 mt-0.5 flex items-center gap-2">
                      {r.category && (
                        <span className={"inline-flex items-center px-1.5 py-0.5 rounded-full ring-1 text-[9.5px] font-semibold capitalize " + tone}>
                          {r.category.replace(/_/g, " ")}
                        </span>
                      )}
                      {typeof r.pages === "number" && <span>{r.pages} page{r.pages === 1 ? "" : "s"}</span>}
                      {typeof r.extracted_chars === "number" && <span>{r.extracted_chars.toLocaleString()} chars extracted</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => download(r.filename)}
                    disabled={!d || isDownloading}
                    title={d ? "Download this file" : "File not attached to the case anymore"}
                    className="h-8 w-8 rounded-md flex items-center justify-center text-slate-500 hover:text-brand-600 hover:bg-brand-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {isDownloading ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function IssuesBlock({ text }: { text: string }) {
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* fall through */ }
  const issues = parsed?.issues ?? [];
  if (!issues.length) return <JsonBlock text={text} />;
  return (
    <div className="space-y-2">
      {issues.map((it: any, i: number) => (
        <div key={i} className="rounded-md bg-white ring-1 ring-slate-200 p-3">
          <div className="text-[14px] font-semibold text-slate-900">
            <span className="text-slate-400">#{i + 1}</span> {it.issue || it.title || "(untitled issue)"}
          </div>
          {it.grounds && <div className="mt-1 text-[13.5px] text-slate-600"><b>Grounds:</b> {it.grounds}</div>}
          {it.rationale && <div className="mt-1 text-[13.5px] text-slate-600"><b>Rationale:</b> {it.rationale}</div>}
        </div>
      ))}
      {parsed?.facts && (
        <div className="mt-2 rounded-md bg-white ring-1 ring-slate-200 p-3">
          <div className="text-[13.5px] font-semibold text-slate-800 mb-1">Facts</div>
          <div className="text-[13.5px] text-slate-600 whitespace-pre-wrap">{parsed.facts}</div>
        </div>
      )}
    </div>
  );
}

// ================================================================ preview

// Draft PDF preview — asks the server to LibreOffice-render the current
// draft, wraps the bytes in a blob URL, drops it into an iframe.  Refreshes
// whenever the outputs list changes (e.g. after an instruct-edit).
function PreviewPane({ slug, refreshKey, embedded, caseTitle }: { slug: string; refreshKey: number; embedded?: boolean; caseTitle?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setBusy(true); setErr(null);
    (async () => {
      try {
        const buf = await api.previewPdf(slug);
        if (!alive) return;
        // Write to a per-case temp file and load via file:// in a <webview>.
        // Chromium's PDF viewer is unreliable against blob: URLs inside a
        // sandboxed iframe under Electron; file:// in a webview works out
        // of the box.  Cache-bust with a nonce so refreshes reload.
        const r = await window.bharat.preview.writePdf(buf, slug, caseTitle);
        if (!alive) return;
        setUrl(`${r.url}?v=${Date.now()}`);
      } catch (e: any) {
        if (alive) setErr(e instanceof ApiError ? e.message : String(e));
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, refreshKey, nonce]);

  const body = (
    <>
      {!embedded && (
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-[16.5px] font-semibold text-slate-900">Draft preview</h2>
          <button
            onClick={() => setNonce((n) => n + 1)}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-brand-600 disabled:opacity-60"
            title="Refresh preview"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
            {busy ? "Rendering…" : "Refresh"}
          </button>
        </div>
      )}
      {err && (
        <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">
          Could not render preview: {err}
        </div>
      )}
      {url && !err && (
        <div className="rounded-md overflow-hidden ring-1 ring-slate-300 shadow-md bg-slate-800">
          {/* React doesn't know about the Electron <webview> tag by default; the
              JSX intrinsic augmentation at the bottom of this file adds it. */}
          <webview
            src={url}
            /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
            {...({ plugins: "true" } as any)}
            style={{ width: "100%", height: "720px", background: "#1e293b" }}
          />
        </div>
      )}
      {busy && !url && !err && (
        <div className="rounded-md bg-slate-50 border border-slate-200 text-slate-500 text-sm px-3 py-6 text-center">
          Rendering the draft as a PDF…
        </div>
      )}
      {!embedded && (
        <div className="mt-2 text-[12.5px] text-slate-400">
          This is a read-only preview.  For rich editing, use Modify with AI or Open in Word.
        </div>
      )}
    </>
  );

  if (embedded) return <div>{body}</div>;
  return (
    <section id="preview" className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm p-4 sm:p-5">
      {body}
    </section>
  );
}

function statusBadge(c: AppealCase, run: AppealRun | null | undefined): { label: string; tone: string } {
  if (run?.status === "error") return { label: "error", tone: "bg-rose-100 text-rose-700" };
  if (run?.status === "running" || run?.status === "queued") return { label: "running", tone: "bg-amber-100 text-amber-700" };
  if (run?.status === "done") return { label: "ready", tone: "bg-emerald-100 text-emerald-700" };
  const s = (c.status || "").toLowerCase();
  if (s.includes("ready") || s.includes("done")) return { label: "ready", tone: "bg-emerald-100 text-emerald-700" };
  return { label: "draft", tone: "bg-slate-100 text-slate-600" };
}

function Section({ title, children, right, collapsible, defaultOpen = true, subtitle }:
  { title: string; children: React.ReactNode; right?: React.ReactNode;
    collapsible?: boolean; defaultOpen?: boolean; subtitle?: string }) {
  const [open, setOpen] = useState<boolean>(defaultOpen);
  const isCollapsible = !!collapsible;
  return (
    <section className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        {isCollapsible ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="group inline-flex items-center gap-2 rounded-md -mx-1 px-1 py-0.5 hover:bg-slate-50 transition-colors"
            aria-expanded={open}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className={"text-slate-400 group-hover:text-navy-700 transition-transform " + (open ? "rotate-90" : "")}>
              <path d="m9 18 6-6-6-6" />
            </svg>
            <h2 className="text-[16.5px] font-semibold text-slate-900">{title}</h2>
            {subtitle && <span className="text-[13.5px] text-slate-500 font-normal">{subtitle}</span>}
          </button>
        ) : (
          <div className="flex items-baseline gap-2">
            <h2 className="text-[16.5px] font-semibold text-slate-900">{title}</h2>
            {subtitle && <span className="text-[13.5px] text-slate-500 font-normal">{subtitle}</span>}
          </div>
        )}
        {right}
      </div>
      {(!isCollapsible || open) && children}
    </section>
  );
}

function FlashBanner({ tone, msg, onDismiss }: { tone: "ok" | "err"; msg: string; onDismiss?: () => void }) {
  const cls = tone === "ok"
    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
    : "bg-rose-50 border-rose-200 text-rose-800";
  return (
    <div className={"rounded-lg border px-3 py-2 text-sm flex items-start gap-2 " + cls}>
      <div className="flex-1">{msg}</div>
      {onDismiss && (
        <button onClick={onDismiss} className="opacity-70 hover:opacity-100" aria-label="Dismiss">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      )}
    </div>
  );
}

function DocumentRow({ d, onOpen, onDelete, onCategorise }: {
  d: AppealDocument; onOpen: () => void; onDelete: () => void; onCategorise: (c: string) => void;
}) {
  const tone = CATEGORY_TONES[d.category] || CATEGORY_TONES["unclassified"];
  return (
    <li className="py-2.5 flex items-center gap-3">
      <div className="size-8 rounded-md bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><polyline points="14 2 14 8 20 8" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-800 truncate" title={d.filename}>{d.filename}</div>
        <div className="text-[12.5px] text-slate-500 mt-0.5">
          {d.pages > 0 ? `${d.pages} page${d.pages > 1 ? "s" : ""}` : "—"}
        </div>
      </div>
      {/* Always-visible category dropdown, styled as a pill.  The tiny chevron
          makes the affordance obvious; changing the value fires onCategorise
          immediately (no separate "edit / save" toggle). */}
      <CategorySelect value={d.category} tone={tone} onChange={onCategorise} />
      <button onClick={onOpen} title="View" className="h-8 px-2.5 rounded-md text-slate-600 hover:bg-slate-100 text-xs font-medium">view</button>
      <button onClick={onDelete} title="Remove" className="h-8 w-8 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
      </button>
    </li>
  );
}

function CategorySelect({ value, tone, onChange }: {
  value: string; tone: string; onChange: (c: string) => void;
}) {
  return (
    <div className={"relative inline-flex items-center gap-1 pl-2.5 pr-6 py-0.5 rounded-full ring-1 text-[12px] font-semibold capitalize hover:brightness-95 cursor-pointer " + tone}>
      <span>{value}</span>
      <svg
        width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        className="absolute right-1.5 opacity-70 pointer-events-none"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title="Change category"
        className="absolute inset-0 opacity-0 cursor-pointer"
      >
        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  );
}

function InstructComposer({ onSubmit, busy }: { onSubmit: (t: string) => Promise<void>; busy: boolean }) {
  const [text, setText] = useState("");
  const suggestions = useMemo(() => [
    "Rewrite the discussion in shorter paragraphs.",
    "Strengthen the reasoning under Ground 2.",
    "Fix the alignment of the Grounds of Appeal.",
    "Make the conclusion firmer — the appeal is dismissed.",
  ], []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    await onSubmit(t);
    setText("");
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-brand-500/[0.03] to-transparent p-3">
      <div className="text-[14.5px] font-semibold text-slate-900 mb-1.5 flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-600"><path d="M9.5 3 12 8l5.5 1.5-4 4L14 19 9.5 15.5 5 17l1.5-5-4-4L8 8Z" /></svg>
        Edit the draft with AI
      </div>
      <p className="text-[13.5px] text-slate-500 mb-2">
        Type what you want changed. BharatTax will rewrite the draft and save it as a new version.
      </p>
      <form onSubmit={submit} className="flex gap-2 items-start">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(e as any); }}
          rows={2}
          placeholder='e.g. "change the discussion part to focus on Section 68 onus"'
          disabled={busy}
          className="input resize-y flex-1"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="h-9 px-4 rounded-md bg-brand-600 text-white font-semibold text-[14.5px] hover:bg-brand-700 disabled:opacity-60"
          title="Ctrl/⌘ + Enter"
        >
          {busy ? "Applying…" : "Apply"}
        </button>
      </form>
      {!busy && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => setText(s)}
              className="text-[13px] text-slate-600 bg-white ring-1 ring-slate-200 rounded-full px-2.5 py-1 hover:ring-brand-500/40 hover:text-brand-700 transition-colors">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ================================================================ manual edit

// "Open in Word" — downloads the current .docx, writes it to a temp file,
// launches the OS default editor (usually Word), and watches the file.  Each
// save the user does gets debounced and POSTed back to the server as a new
// draft version.  Sync status shows live in the button strip.
type SyncState =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "watching"; localPath: string; sessionId: string }
  | { kind: "uploading"; localPath: string; sessionId: string }
  | { kind: "error"; message: string };

function ManualEditButton({ slug, caseTitle, onSynced }: {
  slug: string; caseTitle: string; onSynced: () => void;
}) {
  const [state, setState] = useState<SyncState>({ kind: "idle" });
  const [lastSaved, setLastSaved] = useState<{ version: number; at: number } | null>(null);
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    const offChanged = window.bharat.manualEdit.onChanged(async (ev) => {
      if (ev.sessionId !== sessionRef.current) return;
      setState((s) => s.kind === "watching" ? { kind: "uploading", localPath: s.localPath, sessionId: s.sessionId } : s);
      try {
        const filename = `${caseTitle.replace(/[^\w.\-() ]/g, "_") || "draft"}.docx`;
        const r = await api.uploadEditedDraft(slug, ev.bytes, filename);
        setLastSaved({ version: r.version, at: Date.now() });
        onSynced();
        setState((s) => s.kind === "uploading" ? { kind: "watching", localPath: s.localPath, sessionId: s.sessionId } : s);
      } catch (e: any) {
        setState({ kind: "error", message: e instanceof ApiError ? e.message : String(e) });
      }
    });
    const offError = window.bharat.manualEdit.onError((ev) => {
      if (ev.sessionId !== sessionRef.current) return;
      setState({ kind: "error", message: ev.message });
    });
    return () => { offChanged(); offError(); };
  }, [slug, caseTitle, onSynced]);

  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        void window.bharat.manualEdit.stop(sessionRef.current);
        sessionRef.current = null;
      }
    };
  }, []);

  async function open() {
    setState({ kind: "opening" });
    try {
      const bytes = await api.exportDocx(slug);
      const sessionId = Math.random().toString(36).slice(2, 10);
      sessionRef.current = sessionId;
      const r = await window.bharat.manualEdit.start({
        bytes,
        suggestedName: `${caseTitle.replace(/[^\w.\-() ]/g, "_") || "draft"}.docx`,
        sessionId,
        caseTitle,
      });
      setState({ kind: "watching", localPath: r.path, sessionId: r.sessionId });
    } catch (e: any) {
      setState({ kind: "error", message: e instanceof ApiError ? e.message : String(e) });
    }
  }

  async function stop() {
    if (sessionRef.current) {
      await window.bharat.manualEdit.stop(sessionRef.current);
      sessionRef.current = null;
    }
    setState({ kind: "idle" });
  }

  const idle = state.kind === "idle" || state.kind === "error";

  if (idle) {
    return (
      <div className="flex items-center gap-2">
        <button onClick={open}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-white ring-1 ring-slate-200 text-slate-700 font-medium text-[14.5px] hover:bg-slate-50">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          Open in Word
        </button>
        {state.kind === "error" && (
          <span className="text-[13px] text-rose-700" title={state.message}>
            Sync failed — click Open in Word to retry
          </span>
        )}
      </div>
    );
  }

  const active = state.kind === "watching" || state.kind === "uploading" || state.kind === "opening";
  const label =
    state.kind === "opening"   ? "Opening…" :
    state.kind === "uploading" ? "Saving…" :
                                 "Editing in Word — auto-syncing";

  return (
    <div className="inline-flex items-stretch h-9 rounded-md ring-1 ring-emerald-200 bg-emerald-50 overflow-hidden">
      <span className="inline-flex items-center gap-2 px-3 text-[14px] font-medium text-emerald-800">
        <span className={"size-2 rounded-full " + (state.kind === "uploading" ? "bg-amber-500 animate-pulse" : "bg-emerald-500 animate-pulse")} />
        {label}
        {lastSaved && (
          <span className="text-emerald-700/70 font-normal">
            · saved v{lastSaved.version}
          </span>
        )}
      </span>
      {active && state.kind !== "opening" && (
        <>
          <button
            onClick={() => sessionRef.current && window.bharat.manualEdit.openContainingFolder(sessionRef.current)}
            className="px-2.5 border-l border-emerald-200 text-emerald-700 hover:bg-emerald-100 text-[14px]"
            title="Show file in Explorer"
          >
            📂
          </button>
          <button
            onClick={stop}
            className="px-3 border-l border-emerald-200 text-emerald-700 hover:bg-emerald-100 text-[14px] font-medium"
            title="Stop syncing and remove the local copy"
          >
            Stop
          </button>
        </>
      )}
    </div>
  );
}

// ================================================================ draft pane

// Unified draft workspace: three modes.
//   Preview  → LibreOffice-rendered PDF, page-navigable.
//   Modify with AI → document-styled read-only text; the officer highlights
//                    a passage, a floating "Modify with AI" popover appears,
//                    they type an instruction, and only that passage is
//                    rewritten in place (backend supports {selection}).
//   Manual   → Open in Word / auto-sync-back (delegates to ManualEditButton).
type DraftMode = "preview" | "modify" | "manual";

function DraftPane({
  slug, caseTitle, draftText, draftVersion, refreshKey,
  onDownload, downloadBusy, onFullInstruct, fullBusy, onSynced,
}: {
  slug: string;
  caseTitle: string;
  draftText: string;
  draftVersion: number | null;
  refreshKey: number;
  onDownload: () => void;
  downloadBusy: boolean;
  onFullInstruct: (t: string) => Promise<void>;
  fullBusy: boolean;
  onSynced: () => void;
}) {
  const [mode, setMode] = useState<DraftMode>("preview");

  return (
    <section id="draft" className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm">
      {/* Header: title + mode toggle + action strip */}
      <div className="px-4 sm:px-5 pt-4 pb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100">
        <div>
          <div className="text-[16.5px] font-semibold text-slate-900">Draft appellate order</div>
          <div className="text-[13.5px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>
            Apply mind and edit before finalising.
            {draftVersion !== null && <span className="text-slate-400">· v{draftVersion}</span>}
            <button
              onClick={() => window.bharat.drafts.openFolder()}
              className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-navy-700 hover:bg-navy-100 font-medium"
              title="Open the Appeal Drafts folder in File Explorer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h4l2 2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg>
              Open drafts folder
            </button>
          </div>
        </div>
        <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
          <ModeBtn label="Preview" active={mode === "preview"} onClick={() => setMode("preview")}
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z"/><circle cx="12" cy="12" r="3"/></svg>} />
          <ModeBtn label="Modify with AI" active={mode === "modify"} onClick={() => setMode("modify")}
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 3 12 8l5.5 1.5-4 4L14 19 9.5 15.5 5 17l1.5-5-4-4L8 8Z"/></svg>} />
          <ModeBtn label="Manual edit" active={mode === "manual"} onClick={() => setMode("manual")}
            icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>} />
        </div>
      </div>

      <div className="px-4 sm:px-5 py-3 flex flex-wrap gap-2 border-b border-slate-100 bg-slate-50/60">
        <button onClick={onDownload} disabled={downloadBusy}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-brand-600 text-white font-semibold text-[14.5px] hover:bg-brand-700 disabled:opacity-60">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          {downloadBusy ? "Preparing…" : "Download .docx"}
        </button>
        <ManualEditButton slug={slug} caseTitle={caseTitle} onSynced={onSynced} />
      </div>

      <div className="p-4 sm:p-5 bg-slate-100/60">
        {mode === "preview" && <PreviewPane slug={slug} refreshKey={refreshKey} embedded caseTitle={caseTitle} />}
        {mode === "modify"  && (
          <ModifyWithAI slug={slug} draftText={draftText} baseVersion={draftVersion}
            onApplied={onSynced} onFullInstruct={onFullInstruct} fullBusy={fullBusy} />
        )}
        {mode === "manual"  && <ManualHint slug={slug} caseTitle={caseTitle} onSynced={onSynced} />}
      </div>
    </section>
  );
}

function ModeBtn({ label, active, onClick, icon }: {
  label: string; active: boolean; onClick: () => void; icon: React.ReactNode;
}) {
  return (
    <button onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium transition-colors " +
        (active ? "bg-brand-600 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900")
      }
    >
      {icon} {label}
    </button>
  );
}

function ManualHint({ slug, caseTitle, onSynced }: {
  slug: string; caseTitle: string; onSynced: () => void;
}) {
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 p-6 text-center">
      <div className="mx-auto size-12 rounded-2xl bg-brand-100 text-brand-700 flex items-center justify-center mb-3">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </div>
      <div className="text-[16.5px] font-semibold text-slate-900">Edit the draft in Microsoft Word</div>
      <div className="text-[14.5px] text-slate-500 mt-1 max-w-md mx-auto">
        Click <b>Open in Word</b> above.  The .docx opens in your default word
        processor.  Every save is auto-synced back to BharatTax as a new draft
        version.
      </div>
      <div className="mt-4 inline-block">
        <ManualEditButton slug={slug} caseTitle={caseTitle} onSynced={onSynced} />
      </div>
    </div>
  );
}

// ============================================================ modify with AI

// The "Modify with AI" workspace.  Renders the draft in a document-styled
// container; when the officer selects text and clicks the floating "Modify
// with AI" button, a popover captures an instruction and rewrites JUST the
// selected passage (server-side via {selection} parameter).
function ModifyWithAI({
  slug, draftText, baseVersion, onApplied, onFullInstruct, fullBusy,
}: {
  slug: string;
  draftText: string;
  baseVersion: number | null;
  onApplied: () => void;
  onFullInstruct: (t: string) => Promise<void>;
  fullBusy: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [selText, setSelText] = useState("");
  const [popover, setPopover] = useState<{ x: number; y: number } | null>(null);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // Local copy of the draft so a successful rewrite renders instantly on the
  // sheet, without waiting for the parent's `refresh()` to finish.
  const [liveText, setLiveText] = useState(draftText);
  useEffect(() => { setLiveText(draftText); }, [draftText]);

  function captureSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { setPopover(null); return; }
    const text = sel.toString().trim();
    if (!text || text.length < 3) { setPopover(null); return; }
    const range = sel.getRangeAt(0);
    if (!bodyRef.current?.contains(range.commonAncestorContainer)) return;
    if (!rootRef.current) return;
    const rect = range.getBoundingClientRect();
    // Position relative to the OUTER root (the popover's positioned ancestor),
    // not the inner sheet.  Bug fix: previously the popover was anchored
    // to sheet-local coords while its `position: absolute` parent was the
    // full-width root, so the popover appeared far to the left of the
    // selection.
    const rootRect = rootRef.current.getBoundingClientRect();
    const POP_W = 360;
    const GUTTER = 12;
    const half = POP_W / 2;
    const rawX = rect.left + rect.width / 2 - rootRect.left;
    const minX = half + GUTTER;
    const maxX = rootRect.width - half - GUTTER;
    const x = Math.max(minX, Math.min(maxX, rawX));
    setSelText(text);
    setPopover({ x, y: rect.top - rootRect.top });
  }

  useEffect(() => {
    // Auto-dismiss on Esc.
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { setPopover(null); setInstruction(""); } }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function apply() {
    const ins = instruction.trim();
    if (!ins || !selText || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.instructDraft(slug, ins, {
        selection: selText,
        base_version: baseVersion,
      });
      // Success — clear popover state, flash the version, update the sheet
      // immediately from the response so the officer sees the change without
      // waiting for the parent refresh.
      if (r?.content) setLiveText(r.content);
      setPopover(null);
      setInstruction("");
      setSelText("");
      window.getSelection()?.removeAllRanges();
      setFlash(`Passage rewritten — draft v${r.version}${r.scope ? " · " + r.scope : ""}`);
      window.setTimeout(() => setFlash(null), 3500);
      onApplied();
    } catch (e: any) {
      // Surface the backend message verbatim.  ApiError carries the parsed
      // .detail.message; other errors show their string.
      const msg = e instanceof ApiError
        ? (e.message || `HTTP ${e.status}`)
        : (e?.message || String(e));
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  const hint = "Select any text below and click Modify with AI to rewrite just that passage.";

  return (
    <div ref={rootRef} className="relative">
      {flash && (
        <div className="mb-2 text-[14px] rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 px-3 py-1.5 inline-flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          {flash}
        </div>
      )}
      <div className="mb-2 text-[13.5px] text-slate-600 flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-600"><path d="M9.5 3 12 8l5.5 1.5-4 4L14 19 9.5 15.5 5 17l1.5-5-4-4L8 8Z"/></svg>
        {hint}
      </div>

      {/* Document-styled draft container.  Selection anywhere here triggers
          the popover.  Serif typography, justified text and paginated white-
          sheet look match the PDF preview so the officer sees the same
          document in both modes. */}
      <div
        ref={bodyRef}
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
        className="draft-page relative mx-auto max-w-[820px] bg-white rounded-md ring-1 ring-slate-200 shadow-md px-10 py-12 sm:px-16 sm:py-16 selection:bg-brand-200/60"
        style={{ minHeight: 720 }}
      >
        <DocumentRender text={liveText || "(no draft content)"} />
      </div>

      {/* Floating popover, positioned just above the selection. */}
      {popover && (
        <div
          className="absolute z-30 -translate-x-1/2 -translate-y-full pt-1"
          style={{ left: popover.x, top: popover.y }}
        >
          <div className="w-[360px] rounded-xl bg-white ring-1 ring-slate-200 shadow-xl p-3.5">
            <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-700 flex items-center gap-1 mb-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 3 12 8l5.5 1.5-4 4L14 19 9.5 15.5 5 17l1.5-5-4-4L8 8Z"/></svg>
              Modify with AI
            </div>
            <div className="text-[13.5px] italic text-slate-500 line-clamp-3 border-l-2 border-brand-300 pl-2 mb-2">
              {selText.length > 200 ? selText.slice(0, 200) + "…" : selText}
            </div>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") apply(); }}
              rows={2}
              placeholder="What should change? e.g. make it more formal"
              disabled={busy}
              autoFocus
              className="input resize-y"
            />
            {err && <div className="mt-2 text-[13px] text-rose-700">{err}</div>}
            {!err && !instruction.trim() && !busy && (
              <div className="mt-1.5 text-[12.5px] text-slate-400">Type an instruction to enable Apply.</div>
            )}
            <div className="mt-2 flex items-center justify-end gap-1.5">
              <button onClick={() => { setPopover(null); setInstruction(""); setErr(null); }}
                disabled={busy}
                className="h-8 px-3 rounded-md text-slate-500 hover:bg-slate-100 text-[14px] font-medium disabled:opacity-60">
                Cancel
              </button>
              <button onClick={apply} disabled={busy || !instruction.trim()}
                className={
                  "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[14px] font-semibold transition-colors " +
                  (busy || !instruction.trim()
                    ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                    : "bg-brand-600 text-white hover:bg-brand-700")
                }
              >
                {busy ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
                )}
                {busy ? "Applying…" : "Apply change"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fallback: full-draft instruct composer, tucked below. */}
      <div className="mt-6">
        <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-2">Or rewrite the whole draft</div>
        <InstructComposer onSubmit={onFullInstruct} busy={fullBusy} />
      </div>
    </div>
  );
}

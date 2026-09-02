import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { toast } from "@/lib/toast";
import { Markdown } from "@/lib/markdown";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  ArrowLeft,
  Upload,
  FileText,
  Loader2,
  Play,
  Square,
  Download,
  RefreshCw,
  Pencil,
  Check,
  X,
  Trash2,
  Eye,
  Stamp,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  ListChecks,
  Calculator,
  ScrollText,
} from "lucide-react";
// Lazy-load so a fault inside the ~800KB TipTap chunk never breaks the
// assessment page shell — the fallback is a plain textarea below.
const RichEditor = lazy(() => import("@/components/RichEditor"));
import { api, isLocalFirst } from "../api";

const CATEGORY_LABELS: Record<string, string> = {
  unclassified: "Unclassified",
  return_of_income: "Return of income",
  computation: "Computation",
  notice_143_2: "Notice u/s 143(2)",
  notice_142_1: "Notice u/s 142(1)",
  notice_148: "Notice u/s 148 / 148A",
  assessee_reply: "Assessee's reply",
  third_party_info: "Third-party info (AIS/26AS)",
  financials: "Financials",
};
const CATEGORY_OPTIONS = Object.keys(CATEGORY_LABELS);

type Run = { id: number; status: string; progress: string | null; error: string | null } | null;
type Output = { id: number; kind: string; seq: number; label: string | null; content: string; citations: any[]; edited: boolean; version: number };

const ACTIVE = (s?: string | null) => s === "queued" || s === "running";

export default function AssessmentCase() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { confirm, dialog } = useConfirm();
  const [cse, setCse] = useState<any>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [run, setRun] = useState<Run>(null);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [issues, setIssues] = useState<Output[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState("");
  const pollRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadCase = useCallback(async () => {
    const c = await api.asmtCase(id);
    setCse(c);
    setDocs(c.documents || []);
  }, [id]);

  const loadLatest = useCallback(async () => {
    const r = await api.asmtLatest(id);
    setRun(r.run);
    setOutputs(r.outputs || []);
    setIssues(r.issues || []);
    return r.run as Run;
  }, [id]);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadCase(), loadLatest()]);
      } catch (e: any) {
        setErr(e?.message ?? "Could not load the case.");
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [loadCase, loadLatest]);

  // Poll while a run is active.
  useEffect(() => {
    if (ACTIVE(run?.status)) {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(async () => {
        try {
          const r = await loadLatest();
          if (!ACTIVE(r?.status)) {
            if (pollRef.current) window.clearInterval(pollRef.current);
            await loadCase();
          }
        } catch {
          /* keep polling */
        }
      }, 3000);
      return () => {
        if (pollRef.current) window.clearInterval(pollRef.current);
      };
    }
  }, [run?.status, loadLatest, loadCase]);

  async function onFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    setErr("");
    try {
      const res = await api.asmtUpload(id, files);
      setDocs(res.documents || []);
      setMissing(res.missing || []);
      if (res.skipped?.length) toast.error(`Skipped: ${res.skipped.join(", ")}`);
      toast.success("Documents uploaded");
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed.");
      toast.error(e?.message ?? "Upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function changeCategory(did: number, category: string) {
    try {
      const res = await api.asmtUpdateDocCategory(id, did, category);
      setDocs((d) => d.map((x) => (x.id === did ? { ...x, category } : x)));
      setMissing(res.missing || []);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update category.");
    }
  }

  async function deleteDoc(did: number, filename: string) {
    const ok = await confirm({ title: "Remove document?", description: <span>“{filename}” will be deleted from this case.</span>, tone: "danger", confirmLabel: "Delete" });
    if (!ok) return;
    try {
      const res = await api.asmtDeleteDoc(id, did);
      setDocs((d) => d.filter((x) => x.id !== did));
      setMissing(res.missing || []);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete document.");
    }
  }

  async function startRun() {
    setStarting(true);
    setErr("");
    try {
      const r = await api.asmtRun(id);
      setRun(r);
      // Immediately re-fetch so the poller has authoritative state — a
      // stale worker in production can leave a run in "queued" and the
      // useEffect polling loop wouldn't fire on top of the setRun above
      // if the status returned by /run was already what we expected.
      await loadLatest();
      toast.success("Drafting started");
      // Watchdog: if the run is still "queued" 45 s later, the worker
      // likely never picked it up. Warn the user and re-enable Start so
      // they can try again (the inline-thread fallback in the api will
      // usually take over on the retry).
      window.setTimeout(async () => {
        try {
          const rr = await api.asmtLatest(id);
          if (rr?.run?.id === r.id && rr?.run?.status === "queued") {
            toast.error("Still queued after 45s — worker may be down. Click Start again to retry.");
            setErr("Pipeline did not start on the worker. Click Start again — the api will run it in-process as a fallback.");
          }
        } catch { /* ignore — the poller will surface network errors */ }
      }, 45_000);
    } catch (e: any) {
      setErr(e?.message ?? "Could not start the run.");
      toast.error(e?.message ?? "Could not start the run.");
    } finally {
      setStarting(false);
    }
  }

  async function stopRun() {
    try {
      await api.asmtStopCase(id);
      await loadLatest();
      toast.success("Pipeline stopped");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not stop the run.");
    }
  }

  async function regenerate(seq: number) {
    try {
      const o = await api.asmtRegenerate(id, seq);
      setIssues((xs) => xs.map((x) => (x.seq === seq ? o : x)));
      toast.success("Issue regenerated");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not regenerate.");
    }
  }

  async function reassemble() {
    try {
      const o = await api.asmtReassemble(id);
      setOutputs((xs) => [...xs.filter((x) => x.kind !== "order"), o]);
      toast.success("Order reassembled");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not reassemble.");
    }
  }

  async function saveOutput(oid: number, content: string) {
    const o = await api.asmtEditOutput(oid, content);
    setOutputs((xs) => xs.map((x) => (x.id === oid ? o : x)));
    setIssues((xs) => xs.map((x) => (x.id === oid ? o : x)));
    return o;
  }

  const understanding = outputs.find((o) => o.kind === "understanding");
  const computation = outputs.find((o) => o.kind === "computation");
  const order = outputs.find((o) => o.kind === "order");
  const parsedU = safeJson(understanding?.content);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="size-5 animate-spin mr-2" /> Loading case…
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <Link to="/drafting/assessments" className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-primary">
        <ArrowLeft className="size-4" /> All assessment cases
      </Link>

      {/* Header */}
      <div className="rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5">
        <div className="flex items-start gap-3">
          <div className="size-11 rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15 flex items-center justify-center shrink-0">
            <Stamp className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-slate-900 leading-tight truncate">{cse?.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-500">
              <span>{cse?.assessment_year ? `AY ${cse.assessment_year}` : "AY —"}</span>
              <span className="font-mono">{cse?.pan ? `PAN ${cse.pan}` : "PAN —"}</span>
              <span>{cse?.section ? `u/s ${cse.section}` : "u/s —"}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {ACTIVE(run?.status) ? (
              <button onClick={stopRun} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold ring-1 ring-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100">
                <Square className="size-3.5 fill-current" /> Stop
              </button>
            ) : (
              <button onClick={startRun} disabled={starting || !docs.length} className="bt-btn-primary h-9 px-4 rounded-lg disabled:opacity-50" title={!docs.length ? "Upload documents first" : "Draft the assessment order"}>
                {starting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                {order ? "Re-run" : "Draft order"}
              </button>
            )}
            {order && (
              <button
                title={isLocalFirst()
                  ? "Save to your own computer — in local-first mode nothing is kept on our servers"
                  : "Save the order straight to a folder on your own computer"}
                onClick={async () => {
                  try {
                    const m = await api.asmtDownload(`/assessment/cases/${id}/export.docx`, `assessment_order_${cse?.pan || id}.docx`);
                    if (m === "cancelled") return;
                    if (isLocalFirst()) {
                      await api.asmtDeleteCase(id);
                      toast.success("Saved to your computer. Nothing is kept on our servers.");
                      nav("/drafting/assessments");
                    } else {
                      toast.success("Saved to your computer.");
                    }
                  } catch (e: any) { toast.error(e?.message ?? "Save failed."); }
                }}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold ring-1 ring-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              >
                <Download className="size-4" /> Save to computer
              </button>
            )}
          </div>
        </div>

        {ACTIVE(run?.status) && (
          <div className="mt-4 rounded-lg bg-primary/[0.05] ring-1 ring-primary/15 px-3.5 py-2.5 flex items-center gap-2.5">
            <Loader2 className="size-4 animate-spin text-primary shrink-0" />
            <span className="text-[13px] text-slate-700">{run?.progress || "Working…"}</span>
          </div>
        )}
        {run?.status === "error" && (
          <div className="mt-4 rounded-lg bg-rose-50 ring-1 ring-rose-200 px-3.5 py-2.5 flex items-start gap-2.5">
            <AlertTriangle className="size-4 text-rose-600 shrink-0 mt-0.5" />
            <span className="text-[13px] text-rose-700">{run?.error || "The run failed. Try again."}</span>
          </div>
        )}
      </div>

      {err && (
        <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {err}
        </div>
      )}

      {/* Documents */}
      <section className="rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="size-4 text-primary" />
          <h2 className="text-[15px] font-semibold text-slate-900">Case documents</h2>
          <span className="text-[12px] text-slate-400">{docs.length} file{docs.length === 1 ? "" : "s"}</span>
        </div>

        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
          className="cursor-pointer rounded-xl border-2 border-dashed border-slate-200 hover:border-primary/40 hover:bg-primary/[0.02] transition-colors px-4 py-6 text-center"
        >
          <input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.txt,.html,.htm" onChange={(e) => onFiles(e.target.files)} />
          {uploading ? (
            <div className="inline-flex items-center gap-2 text-slate-500 text-[13px]"><Loader2 className="size-4 animate-spin" /> Uploading…</div>
          ) : (
            <div className="text-slate-500 text-[13px]">
              <Upload className="size-5 mx-auto mb-1.5 text-slate-400" />
              Drop the return, notices, replies & information here, or <span className="text-primary font-semibold">browse</span>
              <div className="text-[11.5px] text-slate-400 mt-1">PDF, DOCX, TXT, HTML</div>
            </div>
          )}
        </div>

        {missing.length > 0 && (
          <div className="mt-3 rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-[12.5px] text-amber-800 flex items-start gap-2">
            <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
            <span>Missing usual documents: {missing.map((m) => CATEGORY_LABELS[m] || m).join(", ")}. You can still run — the draft flags anything [not on record].</span>
          </div>
        )}

        {docs.length > 0 && (
          <div className="mt-3 space-y-2">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg ring-1 ring-slate-200 px-3 py-2">
                <FileText className="size-4 text-slate-400 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800">{d.filename}</span>
                <select
                  value={d.category}
                  onChange={(e) => changeCategory(d.id, e.target.value)}
                  className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[11.5px] text-slate-600 shrink-0"
                >
                  {CATEGORY_OPTIONS.map((c) => (<option key={c} value={c}>{CATEGORY_LABELS[c]}</option>))}
                </select>
                <button onClick={() => api.asmtOpenDoc(id, d.id).catch(() => toast.error("Open failed."))} title="Open" className="p-1.5 rounded-md text-slate-400 hover:text-primary hover:bg-primary/10"><Eye className="size-3.5" /></button>
                <button onClick={() => deleteDoc(d.id, d.filename)} title="Remove" className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 className="size-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Understanding */}
      {parsedU && (
        <section className="rounded-2xl bg-white border border-slate-200/80 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="size-4 text-primary" />
            <h2 className="text-[15px] font-semibold text-slate-900">Case understanding</h2>
          </div>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
            <Field label="Returned income" value={parsedU.return_income} />
            <Field label="Return filed on" value={parsedU.filing_date} />
            <Field label="Selection / reopening" value={parsedU.selection_reason} full />
            {Array.isArray(parsedU.notices) && parsedU.notices.length > 0 && (
              <div className="sm:col-span-2">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Notices issued</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {parsedU.notices.map((n: string, i: number) => (
                    <span key={i} className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-[12px] text-slate-700">{n}</span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* Issues */}
      {issues.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 px-1">
            <ListChecks className="size-4 text-primary" />
            <h2 className="text-[15px] font-semibold text-slate-900">Issue-wise findings</h2>
            <span className="text-[12px] text-slate-400">{issues.length}</span>
          </div>
          {issues.map((o) => (
            <OutputCard
              key={o.id}
              output={o}
              title={o.label || `Issue ${o.seq + 1}`}
              onSave={(content) => saveOutput(o.id, content)}
              onRegenerate={() => regenerate(o.seq)}
            />
          ))}
        </section>
      )}

      {/* Computation */}
      {computation && (
        <OutputCard
          output={computation}
          title="Computation of total income"
          icon={<Calculator className="size-4 text-primary" />}
          onSave={(content) => saveOutput(computation.id, content)}
        />
      )}

      {/* Assembled order */}
      {order && (
        <OutputCard
          output={order}
          title="Draft assessment order"
          icon={<ScrollText className="size-4 text-primary" />}
          highlight
          onSave={(content) => saveOutput(order.id, content)}
          extraAction={
            <button onClick={reassemble} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-semibold ring-1 ring-slate-200 bg-white text-slate-700 hover:bg-slate-50">
              <RefreshCw className="size-3.5" /> Rebuild from issues
            </button>
          }
        />
      )}

      {!ACTIVE(run?.status) && !order && !issues.length && docs.length > 0 && run?.status !== "error" && (
        <div className="rounded-2xl bg-white border border-dashed border-slate-300 p-8 text-center">
          <CheckCircle2 className="size-6 mx-auto text-emerald-500 mb-2" />
          <div className="text-[14px] font-semibold text-slate-900">Ready to draft</div>
          <div className="text-[12.5px] text-slate-500 mt-1">Hit “Draft order” to run the engine over these documents.</div>
        </div>
      )}
      {dialog}
    </div>
  );
}

function Field({ label, value, full }: { label: string; value?: string; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="text-slate-800 mt-0.5">{value || "[not on record]"}</dd>
    </div>
  );
}

function OutputCard({
  output,
  title,
  icon,
  highlight,
  onSave,
  onRegenerate,
  extraAction,
}: {
  output: Output;
  title: string;
  icon?: React.ReactNode;
  highlight?: boolean;
  onSave: (content: string) => Promise<any>;
  onRegenerate?: () => Promise<void> | void;
  extraAction?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(output.content);
  const [busy, setBusy] = useState(false);
  const [regen, setRegen] = useState(false);

  useEffect(() => { setDraft(output.content); }, [output.content, output.id]);

  async function save() {
    setBusy(true);
    try {
      await onSave(draft);
      setEditing(false);
      toast.success("Saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={"rounded-2xl bg-white shadow-sm p-5 " + (highlight ? "ring-2 ring-primary/20 border border-primary/20" : "border border-slate-200/80")}>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="text-[14.5px] font-semibold text-slate-900 min-w-0 truncate">{title}</h3>
        {output.edited && <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 bg-amber-50 ring-1 ring-amber-200 rounded px-1.5 py-0.5">edited</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {extraAction}
          {onRegenerate && !editing && (
            <button
              onClick={async () => { setRegen(true); try { await onRegenerate(); } finally { setRegen(false); } }}
              disabled={regen}
              title="Regenerate this issue"
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12.5px] font-semibold ring-1 ring-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {regen ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            </button>
          )}
          {editing ? (
            <>
              <button onClick={() => { setDraft(output.content); setEditing(false); }} className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100" title="Cancel"><X className="size-4" /></button>
              <button onClick={save} disabled={busy} className="bt-btn-primary h-8 px-3 rounded-lg" title="Save">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="p-1.5 rounded-md text-slate-400 hover:text-primary hover:bg-primary/10" title="Edit"><Pencil className="size-3.5" /></button>
          )}
        </div>
      </div>
      {editing ? (
        <Suspense fallback={
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-[12px] text-slate-500 min-h-[16rem] flex items-center justify-center">
            Loading rich editor…
          </div>
        }>
          <RichEditor
            markdown={draft}
            onChange={setDraft}
            placeholder="Type freely — headings, bullets, bold and tables are all editable in place."
          />
        </Suspense>
      ) : (
        <div className="prose-legal max-w-none text-[13.5px] leading-relaxed text-slate-800">
          <Markdown text={output.content} />
        </div>
      )}
    </section>
  );
}

function safeJson(s?: string): any | null {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

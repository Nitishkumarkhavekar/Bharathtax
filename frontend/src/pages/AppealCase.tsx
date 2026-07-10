import { ChangeEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Upload, FileText, Play, Loader2, RefreshCw, FileDown, BookOpen, Eye, Pencil, AlertCircle, Check, X as XIcon, ChevronRight, ClipboardList, ClipboardCheck, ScrollText, Gavel, ListChecks, FileSignature, Square, Trash2, Send, Sparkles } from "lucide-react";
import { StarRating } from "../components/ui/StarRating";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";
import { Markdown } from "@/lib/markdown";

type Cite = { n: number; breadcrumb: string; section_number?: string | null; source_url?: string | null };
type Out = { id: number; kind: string; seq: number; label?: string; content: string; citations?: Cite[]; edited: boolean; version: number };

function Citations({ items }: { items?: Cite[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {items.map((c) => (
        <a key={c.n} href={c.source_url || "#"} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border bg-accent/40 px-2 py-0.5 text-xs hover:border-primary/50">
          <span className="font-mono text-primary">[{c.n}]</span>
          <span className="text-foreground/80 max-w-[260px] truncate">{c.breadcrumb}</span>
          {c.section_number && <Badge variant="secondary">§ {c.section_number}</Badge>}
        </a>
      ))}
    </div>
  );
}

function Section({
  title,
  children,
  extra,
  icon,
  status,
  defaultOpen = false,
  collapsible = true,
}: {
  title: string;
  children: ReactNode;
  extra?: ReactNode;
  icon?: ReactNode;
  status?: "done" | "current" | "pending";
  defaultOpen?: boolean;
  collapsible?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || !collapsible);
  const isDone = status === "done";
  const isCurrent = status === "current";
  const toggle = () => collapsible && setOpen((o) => !o);
  return (
    <Card
      className={cn(
        "overflow-hidden transition-shadow",
        isCurrent && "ring-1 ring-primary/30 shadow-md",
      )}
    >
      <div className="flex items-center gap-3 px-4 sm:px-5 py-3">
        {/* Left: clickable icon+title area toggles the accordion. */}
        <div
          role={collapsible ? "button" : undefined}
          tabIndex={collapsible ? 0 : -1}
          onClick={toggle}
          onKeyDown={(e) => {
            if (!collapsible) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggle();
            }
          }}
          className={cn(
            "flex-1 min-w-0 flex items-center gap-3 py-1 -my-1 -mx-1 px-1 rounded-md",
            collapsible && "cursor-pointer hover:bg-slate-50/70 focus:outline-none focus:ring-2 focus:ring-primary/30",
          )}
        >
          {icon && (
            <div
              className={cn(
                "size-9 shrink-0 rounded-xl flex items-center justify-center ring-1 transition-colors",
                isDone
                  ? "bg-emerald-100 text-emerald-700 ring-emerald-200"
                  : isCurrent
                    ? "bg-primary/10 text-primary ring-primary/25"
                    : "bg-slate-100 text-slate-500 ring-slate-200",
              )}
            >
              {icon}
            </div>
          )}
          <h3
            className={cn(
              "flex-1 min-w-0 truncate text-[15px] font-semibold tracking-tight",
              isDone
                ? "text-slate-900"
                : isCurrent
                  ? "text-slate-900"
                  : "text-slate-500",
            )}
          >
            {title}
          </h3>
          {status && (
            <span
              className={cn(
                "hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold uppercase tracking-wider shrink-0",
                isDone
                  ? "bg-emerald-100 text-emerald-800"
                  : isCurrent
                    ? "bg-primary/15 text-primary"
                    : "bg-slate-100 text-slate-500",
              )}
            >
              {isDone ? "Ready" : isCurrent ? "Running…" : "Pending"}
            </span>
          )}
          {collapsible && (
            <ChevronRight
              className={cn(
                "size-4 text-slate-400 transition-transform duration-200 shrink-0",
                open && "rotate-90 text-slate-700",
              )}
            />
          )}
        </div>
        {/* Right: `extra` renders OUTSIDE the toggle click area so buttons /
            selects inside don't accidentally close the accordion. */}
        {extra && (
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {extra}
          </div>
        )}
      </div>
      {open && (
        <CardContent className="border-t border-slate-100 pt-4 pb-5 animate-fade-up">
          {children}
        </CardContent>
      )}
    </Card>
  );
}

export default function AppealCase() {
  const { id } = useParams();
  // `cid` is the opaque slug from the URL. Every backend route in
  // /appeal/cases/{cid} accepts EITHER a slug (new default) or the numeric
  // id (kept working for legacy bookmarks). We pass the raw string through
  // to the api client, whose types now accept string | number.
  const cid = String(id || "");
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [c, setC] = useState<any>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [uploadNote, setUploadNote] = useState("");
  const [outputs, setOutputs] = useState<Out[]>([]);
  const [findings, setFindings] = useState<Out[]>([]);
  const [run, setRun] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [draft, setDraft] = useState("");
  const [versions, setVersions] = useState<any[]>([]);
  const [saved, setSaved] = useState("");
  const [regen, setRegen] = useState<Record<number, boolean>>({});

  const loadCase = useCallback(async () => setC(await api.appealCase(cid)), [cid]);
  const loadLatest = useCallback(async () => {
    const d = await api.appealLatest(cid);
    setRun(d.run); setOutputs(d.outputs || []); setFindings(d.findings || []);
    const dr = (d.outputs || []).find((o: Out) => o.kind === "draft"); if (dr) setDraft(dr.content);
    try { setVersions(await api.appealDraftVersions(cid)); } catch { /* */ }
  }, [cid]);
  useEffect(() => { loadCase(); loadLatest(); }, [loadCase, loadLatest]);

  // Poll while any run for this case is active. Driven by run.status so it
  // starts the moment `start()` sets a running run and stops the instant
  // the run reports done/error — no manual interval bookkeeping, no chance
  // of a stale timer surviving into a rerun.
  useEffect(() => {
    if (!run?.id) return;
    if (run.status !== "queued" && run.status !== "running") return;
    const runId = run.id;
    let cancelled = false;
    const tick = async () => {
      try {
        const rr = await api.appealRunStatus(runId);
        if (cancelled) return;
        setRun(rr);
        setProgress(rr.progress || rr.status);
        const terminal = rr.status === "done" || rr.status === "error";
        await loadLatest();
        if (terminal) {
          setBusy(false);
          setProgress("");
          await loadCase();
        }
        if (cancelled) return;
      } catch (e) {
        // Transient errors (e.g. server restart) — keep polling.
        console.warn("run poll error", e);
      }
    };
    // Fire immediately so the UI updates within one tick of `start()`
    // instead of waiting 3 s for the first interval.
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [run?.id, run?.status, loadLatest, loadCase]);
  // Defensive: if a previous editor session left the body in `overflow:hidden`
  // (the page would render but be unscrollable / blank-looking), undo it.
  useEffect(() => {
    if (document.body.style.overflow === "hidden") {
      document.body.style.overflow = "";
    }
  }, []);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;
    const r = await api.appealUpload(cid, e.target.files);
    setMissing(r.missing);
    if (r.skipped?.length) {
      setUploadNote(`Skipped unsupported files: ${r.skipped.join(", ")}`);
    } else {
      setUploadNote("");
    }
    loadCase();
    e.target.value = "";
  }
  async function start() {
    // Reset the pipeline UI on rerun — the previous run's outputs otherwise
    // linger in state and statusForKey returns "done" for every module,
    // stranding the progress bar at 100%.
    setOutputs([]); setFindings([]); setDraft(""); setVersions([]);
    setBusy(true); setProgress("queued");
    const r = await api.appealRun(cid);
    // Setting `run` with status="queued" or "running" triggers the polling
    // useEffect above — no manual setInterval needed.
    setRun(r);
  }
  async function stopRun() {
    const ok = await confirm({
      title: "Stop the running pipeline?",
      description:
        "Modules completed so far will be kept, but any module still in progress will be aborted. You can rerun the pipeline at any time.",
      tone: "warning",
      confirmLabel: "Stop pipeline",
      cancelLabel: "Keep running",
    });
    if (!ok) return;
    try {
      await api.appealStopCase(cid);
      setBusy(false); setProgress("");
      await loadLatest(); await loadCase();
    } catch (e: any) {
      alert(e?.message ?? "Could not stop the run.");
    }
  }
  async function regenerate(seq: number) {
    setRegen((s) => ({ ...s, [seq]: true }));
    try { await api.appealRegenerate(cid, seq); await loadLatest(); } finally { setRegen((s) => ({ ...s, [seq]: false })); }
  }
  async function reassemble() { await api.appealReassemble(cid); await loadLatest(); flash("Reassembled ✓"); }
  async function saveDraft() {
    const o = outputs.find((x) => x.kind === "draft"); if (!o) return;
    await api.appealEditOutput(o.id, draft); flash("Saved ✓"); loadLatest();
  }
  function flash(m: string) { setSaved(m); setTimeout(() => setSaved(""), 2000); }

  const get = (k: string) => outputs.find((o) => o.kind === k);
  const parse = (k: string) => { try { return JSON.parse(get(k)?.content || ""); } catch { return null; } };
  const compliance = parse("compliance"); const matrix = parse("issue_matrix");

  return (
    <div className="space-y-5">
      {confirmDialog}
      <Link to="/appeals" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="size-4" /> All cases</Link>
      {c && (
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">{c.title}</h2>
          <Badge variant={c.status === "ready" ? "success" : c.status === "running" ? "default" : "secondary"}>{c.status}</Badge>
          <span className="text-sm text-muted-foreground">AY {c.assessment_year || "—"} · PAN {c.pan || "—"} · s.{c.section || "—"}</span>
        </div>
      )}

      <Section title="Documents" extra={
        <label className={cn("inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-3 h-9 text-sm font-medium cursor-pointer hover:bg-primary/90")}>
          <Upload className="size-4" /> Upload case files<input type="file" accept=".pdf,.docx,.txt,.html,.htm,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/html" multiple className="hidden" onChange={upload} />
        </label>}>
        {missing.length > 0 && <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-3">Missing expected: {missing.join(", ")}</div>}
        {uploadNote && <div className="text-sm text-muted-foreground bg-muted/50 border rounded-md px-3 py-2 mb-3">{uploadNote}</div>}
        <div className="divide-y rounded-md border">
          {c?.documents?.map((d: any) => (
            <DocRow
              key={d.id}
              cid={cid}
              doc={d}
              onSaved={(updated, missing) => {
                setC((prev: any) =>
                  prev
                    ? {
                        ...prev,
                        documents: prev.documents.map((x: any) =>
                          x.id === updated.id ? { ...x, ...updated } : x,
                        ),
                      }
                    : prev,
                );
                if (Array.isArray(missing)) setMissing(missing);
              }}
              onDeleted={(deletedId, missing) => {
                setC((prev: any) =>
                  prev
                    ? {
                        ...prev,
                        documents: prev.documents.filter((x: any) => x.id !== deletedId),
                      }
                    : prev,
                );
                if (Array.isArray(missing)) setMissing(missing);
              }}
            />
          ))}
          {!c?.documents?.length && <div className="p-3 text-sm text-muted-foreground">No documents uploaded.</div>}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={start} disabled={busy || !c?.documents?.length}>
            {busy ? <><Loader2 className="size-4 animate-spin" /> Running…</> : <><Play className="size-4" /> Run 6 modules</>}
          </Button>
          {busy && (
            <button
              onClick={stopRun}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-[13px] font-semibold ring-1 ring-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:ring-rose-300 transition-colors"
            >
              <Square className="size-3.5 fill-current" /> Stop
            </button>
          )}
          {busy && <span className="text-sm text-muted-foreground">⏳ {progress}</span>}
          {!busy && run && <span className="text-sm text-muted-foreground">last run: {run.status} · {run.provider}</span>}
        </div>
      </Section>

      {(outputs.length > 0 || busy || run) && (
        <>
          <PipelineStepper
            steps={buildSteps(outputs, findings, run, busy)}
            running={busy || run?.status === "running"}
          />

          <Section
            title="Module 1 — Deficiency Report"
            icon={<ClipboardCheck className="size-4" />}
            status={statusForKey(outputs, "deficiency", run, busy)}
          >
            {get("deficiency") ? (
              <>
                <div className="prose-appeal">
                  <Markdown text={get("deficiency")!.content} />
                </div>
                <Citations items={get("deficiency")!.citations} />
              </>
            ) : (
              <ModulePlaceholder state={statusForKey(outputs, "deficiency", run, busy)} />
            )}
          </Section>

          <Section
            title="Module 2 — Scope Validation"
            icon={<ScrollText className="size-4" />}
            status={statusForKey(outputs, "scope", run, busy)}
          >
            {get("scope") ? (
              <>
                <div className="prose-appeal">
                  <Markdown text={get("scope")!.content} />
                </div>
                <Citations items={get("scope")!.citations} />
              </>
            ) : (
              <ModulePlaceholder state={statusForKey(outputs, "scope", run, busy)} />
            )}
          </Section>

          <Section
            title="Module 3 — Document Compliance"
            icon={<ClipboardList className="size-4" />}
            status={statusForKey(outputs, "compliance", run, busy)}
          >
            {compliance ? (
              <>
                <p className="text-sm mb-2 text-slate-700">
                  Missing:{" "}
                  <b>
                    {compliance.missing?.length
                      ? compliance.missing.join(", ")
                      : "none"}
                  </b>
                </p>
                <div className="grid sm:grid-cols-2 gap-1.5 text-sm">
                  {compliance.compliance_sheet?.map((x: any, i: number) => (
                    <div
                      key={i}
                      className="flex justify-between rounded-md bg-slate-100/70 px-2 py-1"
                    >
                      <span className="truncate">{x.filename}</span>
                      <Badge variant="secondary">{x.category}</Badge>
                    </div>
                  ))}
                </div>
              </>
            ) : get("compliance") ? (
              <div className="prose-appeal">
                <Markdown text={get("compliance")!.content} />
              </div>
            ) : (
              <ModulePlaceholder state={statusForKey(outputs, "compliance", run, busy)} />
            )}
          </Section>

          <Section
            title="Module 4 — Issue Matrix"
            icon={<ListChecks className="size-4" />}
            status={statusForKey(outputs, "issue_matrix", run, busy)}
          >
            {matrix?.issues ? (
              <ul className="space-y-2 text-sm">
                {matrix.issues.map((iss: any, i: number) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-md bg-slate-50 border border-slate-200 px-3 py-2"
                  >
                    <span className="inline-flex items-center justify-center size-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-slate-800">{iss.issue}</span>
                  </li>
                ))}
              </ul>
            ) : get("issue_matrix") ? (
              <div className="prose-appeal">
                <Markdown text={get("issue_matrix")!.content} />
              </div>
            ) : (
              <ModulePlaceholder state={statusForKey(outputs, "issue_matrix", run, busy)} />
            )}
          </Section>

          <Section
            title="Module 5 — Issue-wise Findings"
            icon={<Gavel className="size-4" />}
            status={statusForFindings(findings, matrix, run, busy)}
            extra={
              findings.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    reassemble();
                  }}
                  className="mr-1"
                >
                  <RefreshCw className="size-4" /> Reassemble draft
                </Button>
              ) : undefined
            }
          >
            {matrix?.issues && (
              <p className="text-sm text-muted-foreground mb-3">
                {findings.length} of {matrix.issues.length} issue
                {matrix.issues.length === 1 ? "" : "s"} drafted — regenerate any,
                then reassemble.
              </p>
            )}
            {findings.length === 0 && (
              <div className="mb-3">
                <ModulePlaceholder state={statusForFindings(findings, matrix, run, busy)} />
              </div>
            )}
            <div className="space-y-4">
              {findings.map((fnd) => (
                <div
                  key={fnd.seq}
                  className="rounded-lg border border-slate-200 bg-white p-4 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center size-6 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                      {fnd.seq + 1}
                    </span>
                    <h4 className="flex-1 font-medium text-[14px] text-slate-800">
                      {fnd.label}
                    </h4>
                    {fnd.version > 1 && (
                      <Badge variant="secondary">v{fnd.version}</Badge>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => regenerate(fnd.seq)}
                      disabled={regen[fnd.seq]}
                    >
                      {regen[fnd.seq] ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}{" "}
                      Regenerate
                    </Button>
                  </div>
                  <div className="prose-appeal">
                    <Markdown text={fnd.content} />
                  </div>
                  <Citations items={fnd.citations} />
                </div>
              ))}
            </div>
          </Section>

          <DraftRating cid={cid} />
          <DraftSection
            cid={cid}
            draft={draft}
            setDraft={setDraft}
            versions={versions}
            saved={saved}
            onSave={saveDraft}
          />
        </>
      )}
    </div>
  );
}

function DraftRating({ cid }: { cid: string | number }) {
  const [stars, setStars] = useState(0);
  useEffect(() => {
    api.getRating("appeal", cid).then((r) => { if (r?.stars) setStars(r.stars); }).catch(() => {});
  }, [cid]);
  async function rate(n: number) {
    setStars(n);
    try { await api.rate({ target_type: "appeal", target_id: cid, stars: n }); } catch { /* best-effort */ }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <span className="text-sm font-medium text-slate-700">Rate this draft order:</span>
      <StarRating value={stars} onRate={rate} size={22} />
      {stars > 0 ? <span className="text-sm text-amber-500">{stars}/5 — thank you!</span> : null}
    </div>
  );
}


// ---------------------------------------------------------------- Module 6
type Ver = { id: number; version: number; edited: boolean; content: string };

function DraftSection({
  cid,
  draft,
  setDraft,
  versions,
  saved,
  onSave,
}: {
  cid: string | number;
  draft: string;
  setDraft: (s: string) => void;
  versions: Ver[];
  saved: string;
  onSave: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<"preview" | "edit" | "text">("preview");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Tracks whether the iframe's inner PDF viewer has actually finished
  // initialising. Browser PDF viewers show a hideous "may have been moved,
  // edited, or deleted" grey screen for a beat while they warm up — we
  // hide that behind our own skeleton until the iframe fires `onLoad`.
  const [iframeReady, setIframeReady] = useState(false);
  // Stable callback identity so the OnlyOffice editor doesn't unmount whenever
  // the parent re-renders (it does, often: every preview state change). We
  // pass this down instead of an inline arrow function.
  const bumpPreview = useCallback(() => setReloadKey((k) => k + 1), []);
  const refreshDraft = useCallback(async () => {
    bumpPreview();
    try {
      const vs = await api.appealDraftVersions(cid);
      const latest = [...vs].sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
      if (latest?.content) setDraft(latest.content);
    } catch {
      /* best-effort refresh */
    }
  }, [cid, bumpPreview, setDraft]);
  // Bump the cache-buster when the draft text changes so the preview reflects
  // unsaved edits if the user toggles to Preview mid-edit.
  const draftHash = useMemo(() => `${draft.length}:${draft.slice(0, 64)}`, [draft]);

  useEffect(() => {
    let alive = true;
    let createdUrl: string | null = null;
    async function load() {
      if (mode !== "preview") return;
      if (!draft.trim()) return;
      setPreviewBusy(true);
      setPreviewErr(null);
      // Reset the iframe-ready flag whenever a new render kicks off so the
      // skeleton overlays the STALE PDF until the new blob finishes loading.
      setIframeReady(false);
      try {
        // The /preview.pdf endpoint synchronously asks OnlyOffice to flush
        // any in-flight edits and waits for our save-callback before
        // rendering — so no separate forcesave step is needed here.
        const url = await api.appealPreviewPdfUrl(cid);
        if (!alive) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setPdfUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
      } catch (e: any) {
        if (alive) setPreviewErr(e?.message ?? "Could not render preview");
      } finally {
        if (alive) setPreviewBusy(false);
      }
    }
    load();
    return () => {
      alive = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, mode, reloadKey, draftHash]);

  async function saveAndRefreshPreview() {
    await onSave();
    setReloadKey((k) => k + 1);
  }

  return (
    <Section
      title="Module 6 — Draft Appellate Order"
      icon={<FileSignature className="size-4" />}
      status={draft ? "done" : "pending"}
      defaultOpen
      extra={
        <div className="flex items-center gap-2">
          {versions.length > 1 && (
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              onChange={(e) => {
                const v = versions.find((x) => x.id === Number(e.target.value));
                if (v) {
                  setDraft(v.content);
                  setReloadKey((k) => k + 1);
                }
              }}
              defaultValue={versions[0]?.id}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version}
                  {v.edited ? " (edited)" : ""}
                </option>
              ))}
            </select>
          )}
          {saved && <span className="text-xs text-success">{saved}</span>}
        </div>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm text-muted-foreground flex items-center gap-1">
          <BookOpen className="size-4" /> Apply mind and edit before finalising.
        </p>
        <div className="inline-flex flex-wrap rounded-md border border-input bg-background p-0.5 text-xs max-w-full">
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium transition-colors",
              mode === "preview"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-slate-600 hover:text-slate-900",
            )}
          >
            <Eye className="size-3.5" /> Preview
          </button>
          <button
            type="button"
            onClick={() => setMode("text")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium transition-colors",
              mode === "text"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-slate-600 hover:text-slate-900",
            )}
          >
            <Sparkles className="size-3.5" /> <span className="hidden xs:inline sm:inline">Modify with AI</span><span className="xs:hidden sm:hidden">AI</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("edit")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium transition-colors",
              mode === "edit"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-slate-600 hover:text-slate-900",
            )}
          >
            <Pencil className="size-3.5" /> Edit
          </button>
        </div>
      </div>

      {mode === "preview" ? (
        <div className="relative rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          {/* Loading skeleton — shown either while we're rendering server-side
              OR while the browser PDF viewer is still warming up (that's the
              "It may have been moved…" phase). Fades out once the iframe's
              onLoad fires. */}
          {(previewBusy || !iframeReady) && !previewErr && (
            <PreviewLoadingSkeleton mode={pdfUrl ? "loading" : "rendering"} />
          )}
          {previewErr && !previewBusy && (
            <div className="p-4 text-sm flex items-start gap-2 text-rose-700 bg-rose-50 border-b border-rose-100">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">Could not render the preview.</div>
                <div className="text-xs text-rose-600 mt-0.5">{previewErr}</div>
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="mt-1 text-xs font-semibold underline"
                >
                  Try again
                </button>
              </div>
            </div>
          )}
          {pdfUrl && (
            <iframe
              key={pdfUrl}
              src={pdfUrl}
              title="Draft appellate order preview"
              onLoad={() => setIframeReady(true)}
              className={cn(
                "w-full h-[760px] bg-white transition-opacity duration-300",
                iframeReady ? "opacity-100" : "opacity-0",
              )}
            />
          )}
          {!pdfUrl && !previewBusy && !previewErr && (
            <div className="h-[760px] flex items-center justify-center text-sm text-slate-500">
              No draft yet to preview.
            </div>
          )}
          {/* hidden ref to silence the hash linter */}
          <span className="hidden">{draftHash}</span>
        </div>
      ) : mode === "text" ? (
        <TextModifyView cid={cid} draft={draft} onApplied={refreshDraft} />
      ) : (
        <OnlyOfficeEditor cid={cid} onSaved={bumpPreview} />
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          onClick={saveAndRefreshPreview}
          disabled={mode === "edit"}
          title={mode === "edit" ? "Edits are auto-saved by the editor" : ""}
        >
          Save draft (new version)
        </Button>
        <Button
          variant="outline"
          onClick={() => setReloadKey((k) => k + 1)}
          disabled={mode !== "preview"}
        >
          <RefreshCw className="size-4" /> Refresh preview
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            api
              .appealDownload(
                `/appeal/cases/${cid}/export.docx`,
                `draft_order_case_${cid}.docx`,
              )
              .catch((e) => alert(e.message))
          }
        >
          <FileDown className="size-4" /> Download .docx
        </Button>
      </div>
    </Section>
  );
}

// ---------------------------------------------- Select-to-modify (right-click)
// A selectable HTML rendering of the draft. The officer selects any text and
// right-clicks (or the floating menu) to open an inline "what should change?"
// prompt; only that excerpt is rewritten by the AI and spliced back in place.
function TextModifyView({
  cid,
  draft,
  onApplied,
}: {
  cid: string | number;
  draft: string;
  onApplied: () => void | Promise<void>;
}) {
  const [pop, setPop] = useState<{ x: number; y: number; selection: string } | null>(null);
  // Floating "Ask AI" button shown when the user selects text (ChatGPT-style),
  // so editing is discoverable without needing a right-click.
  const [hint, setHint] = useState<{ x: number; y: number } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function openFor(clientX: number, clientY: number): boolean {
    const sel = window.getSelection();
    const t = (sel?.toString() ?? "").trim();
    if (t.length < 3) return false;
    setErr(null);
    setPrompt("");
    setHint(null);
    setPop({ x: clientX, y: clientY, selection: t });
    return true;
  }
  function onContextMenu(e: React.MouseEvent) {
    if (openFor(e.clientX, e.clientY)) e.preventDefault();
  }
  // On text selection inside the draft, float an "Ask AI" chip above it.
  function onSelectMouseUp() {
    if (pop) return;
    const sel = window.getSelection();
    const t = (sel?.toString() ?? "").trim();
    if (t.length < 3 || !sel || sel.rangeCount === 0) {
      setHint(null);
      return;
    }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    setHint({ x: r.left + r.width / 2, y: r.top - 8 });
  }
  async function apply() {
    if (!pop || !prompt.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.appealInstructDraft(cid, prompt.trim(), pop.selection);
      setPop(null);
      setPrompt("");
      await onApplied();
    } catch (e: any) {
      setErr(e?.message ?? "Could not apply the edit.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!hint) return;
    function onDown(e: MouseEvent) {
      if (!(e.target as HTMLElement)?.closest?.("#ai-ask-btn")) setHint(null);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [hint]);
  useEffect(() => {
    if (!pop) return;
    function onDown(e: MouseEvent) {
      const el = document.getElementById("ai-modify-pop");
      if (el && !el.contains(e.target as Node)) setPop(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPop(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pop]);

  return (
    <div className="relative rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-2 text-[11.5px] text-slate-500 flex items-center gap-1.5">
        <Sparkles className="size-3.5 text-primary" />
        Select any text and click <b>Ask AI</b> to rewrite just that part (right-click also works).
      </div>
      <div
        onContextMenu={onContextMenu}
        onMouseUp={onSelectMouseUp}
        onScroll={() => setHint(null)}
        className="max-h-[65vh] sm:max-h-[720px] overflow-auto px-4 sm:px-6 py-4 sm:py-5 text-[13px] sm:text-[14px] leading-relaxed text-slate-800 break-words selection:bg-primary/20 [&_h1]:font-bold [&_h2]:font-semibold [&_h3]:font-semibold [&_p]:mb-3 [&_strong]:font-semibold [&_*]:max-w-full"
      >
        {draft ? (
          <Markdown text={draft} />
        ) : (
          <div className="text-sm text-slate-500 py-12 text-center">No draft yet.</div>
        )}
      </div>
      {hint && !pop && (
        <button
          id="ai-ask-btn"
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => openFor(hint.x, hint.y)}
          style={{
            position: "fixed",
            left: hint.x,
            top: hint.y,
            transform: "translate(-50%, -100%)",
            zIndex: 60,
          }}
          className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 text-white text-[12px] font-medium px-3 py-1.5 shadow-lg ring-1 ring-white/10 hover:bg-slate-800"
        >
          <Sparkles className="size-3.5 text-primary" /> Ask AI
        </button>
      )}
      {pop && (
        <div
          id="ai-modify-pop"
          style={{
            position: "fixed",
            left: Math.max(8, Math.min(pop.x - 24, window.innerWidth - 320 - 8)),
            top: Math.max(8, Math.min(pop.y + 8, window.innerHeight - 236)),
            zIndex: 60,
            width: "min(320px, calc(100vw - 16px))",
          }}
          className="rounded-xl border border-slate-200 bg-white shadow-2xl p-3"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary mb-1.5">
            <Sparkles className="size-3.5" /> Modify with AI
          </div>
          <div className="text-[11.5px] text-slate-500 line-clamp-2 mb-2 italic border-l-2 border-slate-200 pl-2">
            {pop.selection}
          </div>
          <textarea
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                apply();
              }
            }}
            rows={2}
            placeholder="What should change? e.g. make it more formal"
            disabled={busy}
            className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
          />
          {err && <div className="mt-1 text-[11px] text-rose-600">{err}</div>}
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPop(null)}
              className="text-[12px] text-slate-500 hover:text-slate-800 px-2 py-1"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={busy || !prompt.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-white text-[12.5px] font-medium px-3 py-1.5 disabled:opacity-50 hover:bg-primary/90"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {busy ? "Applying…" : "Apply change"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- OnlyOffice
declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (placeholderId: string, config: Record<string, unknown>) => {
        destroyEditor: () => void;
      };
    };
  }
}

function OnlyOfficeEditor({
  cid,
  onSaved,
}: {
  cid: string | number;
  onSaved: () => void;
}) {
  const containerId = useMemo(
    () => `oo-editor-${cid}-${Math.random().toString(36).slice(2, 8)}`,
    [cid],
  );
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const editorRef = useRef<{ destroyEditor: () => void } | null>(null);
  // Keep `onSaved` in a ref so changing its identity on every parent re-render
  // doesn't tear down + recreate the editor (which made OnlyOffice's save
  // callback fail with `{error:1} / storeForgotten` mid-load).
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  useEffect(() => {
    let cancelled = false;

    async function loadScript(url: string): Promise<void> {
      if (window.DocsAPI) return; // already loaded
      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector(
          `script[data-oo-api="1"]`,
        ) as HTMLScriptElement | null;
        if (existing) {
          if (window.DocsAPI) {
            resolve();
            return;
          }
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error("script load failed")), { once: true });
          return;
        }
        const s = document.createElement("script");
        s.src = url;
        s.async = true;
        s.dataset.ooApi = "1";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Could not load editor script"));
        document.head.appendChild(s);
      });
    }

    (async () => {
      try {
        setLoading(true);
        setErr(null);
        const { editor_url, config } = await api.appealOnlyOfficeConfig(cid);
        await loadScript(editor_url);
        if (cancelled) return;
        if (!window.DocsAPI) throw new Error("Editor SDK did not load");
        const withEvents: Record<string, unknown> = {
          ...config,
          events: {
            onAppReady: () => setLoading(false),
            onDocumentStateChange: (e: { data: boolean }) => {
              if (e?.data === false) onSavedRef.current();
            },
            onRequestClose: () => onSavedRef.current(),
            onError: (e: { data?: { errorDescription?: string } }) => {
              setErr(e?.data?.errorDescription || "Editor error");
            },
          },
        };
        editorRef.current = new window.DocsAPI.DocEditor(containerId, withEvents);
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setErr(msg);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        editorRef.current?.destroyEditor();
      } catch {
        /* ignore */
      }
      editorRef.current = null;
    };
    // intentionally only depends on the stable identity of `cid` and the
    // memoised `containerId` — `onSaved` is read via the ref above so a new
    // function from the parent doesn't re-mount the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, containerId]);

  // One tall, in-page card. No fixed-position overlay — that caused a blank
  // viewport when the iframe stalled. The editor card always renders with
  // visible chrome at the top so the user knows where they are.
  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-200 bg-slate-50">
        <div className="text-[12px] font-medium text-slate-700 inline-flex items-center gap-1.5">
          <Pencil className="size-3.5 text-primary" />
          OnlyOffice editor — your changes are auto-saved
        </div>
        {err && (
          <button
            type="button"
            onClick={() => {
              setErr(null);
              setLoading(true);
              try {
                editorRef.current?.destroyEditor();
              } catch {
                /* ignore */
              }
              editorRef.current = null;
              // Force the parent useEffect to re-run by bumping a key trick.
              window.setTimeout(() => window.location.reload(), 30);
            }}
            className="text-[12px] font-medium text-rose-700 hover:text-rose-900 px-2 py-1 rounded-md hover:bg-rose-50"
          >
            Reload editor
          </button>
        )}
      </div>
      <div
        className="relative w-full bg-white"
        style={{ height: "min(82vh, 1100px)", minHeight: "620px" }}
      >
        {loading && !err && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-slate-500 bg-white">
            <Loader2 className="size-4 animate-spin mr-2" /> Opening editor…
          </div>
        )}
        {err && (
          <div className="absolute inset-0 z-10 p-5 text-sm text-rose-800 bg-rose-50 flex items-start gap-2">
            <AlertCircle className="size-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Couldn't open the editor.</div>
              <div className="text-xs text-rose-700 mt-1 font-mono break-all">{err}</div>
              <div className="text-xs text-rose-600 mt-2">
                Check that OnlyOffice is running and that
                <code className="font-mono"> /oo/ </code> is reachable, then
                hit <b>Reload editor</b>.
              </div>
            </div>
          </div>
        )}
        <div id={containerId} className="absolute inset-0 w-full h-full" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Documents
const DOC_CATEGORIES = [
  "unclassified",
  "form_35",
  "grounds_of_appeal",
  "statement_of_facts",
  "written_submission",
  "remand_report",
  "additional_evidence",
  "demand_notice",
  "penalty_order",
  "assessment_order",
] as const;

function categoryTone(cat: string): string {
  switch (cat) {
    case "form_35":
    case "grounds_of_appeal":
    case "statement_of_facts":
      return "bg-sky-100 text-sky-800 hover:bg-sky-100";
    case "written_submission":
    case "additional_evidence":
      return "bg-violet-100 text-violet-800 hover:bg-violet-100";
    case "remand_report":
      return "bg-emerald-100 text-emerald-800 hover:bg-emerald-100";
    case "assessment_order":
    case "penalty_order":
    case "demand_notice":
      return "bg-amber-100 text-amber-800 hover:bg-amber-100";
    default:
      return "bg-slate-100 text-slate-700 hover:bg-slate-100";
  }
}

function DocRow({
  cid,
  doc,
  onSaved,
  onDeleted,
}: {
  cid: string | number;
  doc: { id: number; filename: string; category: string; pages?: number };
  onSaved: (
    updated: { id: number; filename: string; category: string; pages?: number },
    missing: string[] | null,
  ) => void;
  onDeleted: (deletedId: number, missing: string[] | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(doc.category);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { confirm: confirmDialog, dialog: dialogNode } = useConfirm();

  async function deleteDoc() {
    const ok = await confirmDialog({
      title: `Delete "${doc.filename}"?`,
      description:
        "This also removes the PDF from storage and drops it from any compliance check for this case.",
      tone: "danger",
      confirmLabel: "Delete document",
    });
    if (!ok) return;
    setDeleting(true);
    setErr(null);
    try {
      const res = await api.appealDeleteDoc(cid, doc.id);
      onDeleted(res.deleted_id, Array.isArray(res.missing) ? res.missing : null);
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed");
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!editing) setValue(doc.category);
  }, [doc.category, editing]);

  async function save() {
    if (value === doc.category) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await api.appealUpdateDocCategory(cid, doc.id, value);
      onSaved(
        { id: res.id, filename: res.filename, category: res.category, pages: res.pages },
        Array.isArray(res.missing) ? res.missing : null,
      );
      setEditing(false);
    } catch (e: any) {
      setErr(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setValue(doc.category);
    setErr(null);
    setEditing(false);
  }

  return (
    <div className="flex items-center gap-3 p-2.5">
      {dialogNode}
      <FileText className="size-4 text-muted-foreground shrink-0" />
      <span className="flex-1 text-sm truncate" title={doc.filename}>
        {doc.filename}
      </span>

      {editing ? (
        <div className="flex items-center gap-1.5">
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            autoFocus
          >
            {DOC_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="inline-flex items-center gap-0.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white h-7 px-1.5 text-[11px] font-medium disabled:opacity-60"
            title="Save"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="inline-flex items-center gap-0.5 rounded-md bg-slate-200 hover:bg-slate-300 text-slate-800 h-7 px-1.5 text-[11px] font-medium"
            title="Cancel"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      ) : (
        <>
          <Badge className={`gap-1 ${categoryTone(doc.category)}`}>
            {doc.category.replace(/_/g, " ")}
          </Badge>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-900"
            title="Edit category"
          >
            <Pencil className="size-3.5" />
          </button>
        </>
      )}

      <button
        type="button"
        onClick={() => api.appealOpenDoc(cid, doc.id)}
        className="text-xs text-primary hover:underline"
      >
        view
      </button>

      <button
        type="button"
        onClick={deleteDoc}
        disabled={deleting || busy}
        className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Delete this document"
        aria-label="Delete this document"
      >
        {deleting ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Trash2 className="size-3.5" />
        )}
      </button>

      {err && (
        <span className="text-[11px] text-rose-700 ml-2 inline-flex items-center gap-1">
          <AlertCircle className="size-3" /> {err}
        </span>
      )}
    </div>
  );
}

/** Placeholder shown inside a module Section when its output hasn't landed
 *  yet — either the pipeline is still processing it, or the run hasn't been
 *  kicked off. Keeps expanded-but-empty sections from looking broken. */
/** Attractive overlay shown on top of the preview iframe while it warms up.
 *  Prevents the ugly Chrome PDF-viewer fallback ("It may have been moved,
 *  edited, or deleted.") from ever being visible to the user.
 *
 *  `mode="rendering"` is used when we're waiting for the server to build the
 *  PDF; `mode="loading"` when the PDF is en route but the browser viewer
 *  hasn't painted its first frame yet. */
function PreviewLoadingSkeleton({ mode }: { mode: "rendering" | "loading" }) {
  const phrases =
    mode === "rendering"
      ? [
          "Rendering your draft appellate order",
          "Composing paragraphs",
          "Numbering paragraphs",
          "Applying legal typography",
          "Finalising the preview",
        ]
      : [
          "Loading document viewer",
          "Streaming the PDF",
          "Preparing the preview",
        ];
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % phrases.length), 1600);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-white/95 backdrop-blur-sm animate-fade-up"
      aria-live="polite"
      role="status"
    >
      {/* Fake paginated document mock behind the message so the loader
          reads as "your document, arriving" rather than a blank spinner. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 opacity-40">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-[min(560px,80%)] rounded-lg bg-gradient-to-br from-slate-50 to-white ring-1 ring-slate-200 shadow-sm p-6 animate-pulse"
            style={{ animationDelay: `${i * 200}ms` }}
          >
            <div className="h-3 rounded bg-slate-200 w-2/5 mb-4" />
            <div className="space-y-2">
              <div className="h-2 rounded bg-slate-100 w-full" />
              <div className="h-2 rounded bg-slate-100 w-11/12" />
              <div className="h-2 rounded bg-slate-100 w-10/12" />
              <div className="h-2 rounded bg-slate-100 w-9/12" />
            </div>
          </div>
        ))}
      </div>
      {/* Foreground: gradient-glow document icon + rotating status. */}
      <div className="relative flex flex-col items-center gap-4 px-6 text-center">
        <div className="relative">
          <div className="absolute -inset-4 rounded-2xl bg-gradient-to-br from-primary/30 via-sky-400/30 to-violet-500/30 blur-2xl animate-pulse [animation-duration:2.5s]" />
          <div className="relative size-14 rounded-2xl bg-gradient-to-br from-primary via-sky-500 to-violet-600 flex items-center justify-center ring-4 ring-white shadow-lg shadow-primary/25">
            <FileSignature className="size-6 text-white" strokeWidth={2.2} />
          </div>
        </div>
        <div className="space-y-1">
          <div
            key={idx}
            className="text-[14px] font-semibold text-slate-800 status-phrase"
          >
            {phrases[idx]}…
          </div>
          <div className="text-[11.5px] text-slate-500">
            Times New Roman · italic body · hanging indent
          </div>
        </div>
        <div className="relative w-40 h-1 rounded-full bg-slate-100 overflow-hidden">
          <div className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-primary via-sky-500 to-violet-500 animate-[bt-slide_1.4s_ease-in-out_infinite]" />
        </div>
      </div>
    </div>
  );
}

function ModulePlaceholder({ state }: { state: StepState }) {
  if (state === "current") {
    return (
      <div className="flex items-center gap-2 text-sm text-primary bg-primary/5 rounded-md px-3 py-2 ring-1 ring-primary/15">
        <Loader2 className="size-4 animate-spin" />
        Running this module now — output will appear here as soon as it's ready.
      </div>
    );
  }
  if (state === "done") return null;
  return (
    <div className="text-sm text-slate-500 bg-slate-50 rounded-md px-3 py-2 ring-1 ring-slate-200">
      Not run yet. Click <b>Run 6 modules</b> above to generate this section.
    </div>
  );
}

// ---------------------------------------------------------------- Pipeline stepper
type StepState = "done" | "current" | "pending";
type StepDef = {
  key: string;
  label: string;
  icon: React.ReactNode;
  state: StepState;
};

function statusForKey(
  outputs: Out[],
  key: string,
  run: any,
  busy: boolean,
): StepState {
  const has = outputs.some((o) => o.kind === key);
  if (has) return "done";
  if (busy || run?.status === "running") {
    const p = (run?.progress || "").toLowerCase();
    // Rough mapping progress-string → module.
    const map: Record<string, string[]> = {
      deficiency: ["module 1"],
      scope: ["module 2"],
      compliance: ["module 3"],
      issue_matrix: ["module 4"],
      draft: ["module 6"],
    };
    for (const needle of map[key] || []) {
      if (p.includes(needle)) return "current";
    }
  }
  return "pending";
}

function statusForFindings(
  findings: Out[],
  matrix: any,
  run: any,
  busy: boolean,
): StepState {
  if (findings.length > 0 && matrix?.issues && findings.length >= matrix.issues.length)
    return "done";
  if (busy || run?.status === "running") {
    const p = (run?.progress || "").toLowerCase();
    if (p.includes("module 5")) return "current";
  }
  if (findings.length > 0) return "done";
  return "pending";
}

function buildSteps(
  outputs: Out[],
  findings: Out[],
  run: any,
  busy: boolean,
): StepDef[] {
  const matrix = (() => {
    try {
      const o = outputs.find((x) => x.kind === "issue_matrix");
      return o ? JSON.parse(o.content) : null;
    } catch {
      return null;
    }
  })();
  return [
    {
      key: "deficiency",
      label: "Deficiency",
      icon: <ClipboardCheck className="size-3.5" />,
      state: statusForKey(outputs, "deficiency", run, busy),
    },
    {
      key: "scope",
      label: "Scope",
      icon: <ScrollText className="size-3.5" />,
      state: statusForKey(outputs, "scope", run, busy),
    },
    {
      key: "compliance",
      label: "Compliance",
      icon: <ClipboardList className="size-3.5" />,
      state: statusForKey(outputs, "compliance", run, busy),
    },
    {
      key: "issue_matrix",
      label: "Issues",
      icon: <ListChecks className="size-3.5" />,
      state: statusForKey(outputs, "issue_matrix", run, busy),
    },
    {
      key: "findings",
      label: "Findings",
      icon: <Gavel className="size-3.5" />,
      state: statusForFindings(findings, matrix, run, busy),
    },
    {
      key: "draft",
      label: "Draft Order",
      icon: <FileSignature className="size-3.5" />,
      state: statusForKey(outputs, "draft", run, busy),
    },
  ];
}

function PipelineStepper({ steps, running }: { steps: StepDef[]; running?: boolean }) {
  const doneCount = steps.filter((s) => s.state === "done").length;
  const pct = Math.round((doneCount / steps.length) * 100);
  const allDone = doneCount === steps.length;
  return (
    <Card
      className={cn(
        "relative overflow-hidden transition-shadow",
        running && "ring-1 ring-emerald-400/40 shadow-lg shadow-emerald-500/10",
      )}
    >
      {/* Aurora backdrop while running — a slow-drifting green wash so the
          card visibly "breathes" even when every step is already ticked. */}
      {running && (
        <div className="pointer-events-none absolute inset-0 opacity-70">
          <div className="absolute -inset-8 bg-[radial-gradient(closest-side,rgba(16,185,129,0.16),transparent_70%)] animate-[bt-aurora_6s_ease-in-out_infinite]" />
        </div>
      )}
      <CardContent className="relative pt-5 pb-5">
        <div className="flex items-baseline justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="text-[13px] font-semibold text-slate-800">
              Pipeline progress
            </div>
            {running && (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-emerald-700 bg-emerald-50 ring-1 ring-emerald-500/20 px-1.5 py-0.5 rounded-full">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-ping" />
                <span className="size-1.5 rounded-full bg-emerald-500 -ml-3" />
                {allDone ? "Finalizing" : "Running"}
              </span>
            )}
          </div>
          <div className="text-[12px] text-slate-500 tabular-nums">
            {doneCount}/{steps.length} · {pct}%
          </div>
        </div>
        {/* Progress bar. The base fill grows with `pct`; when we're still
            running, a diagonal shimmer sweeps across it so the eye can
            catch that work is happening even at 100%. */}
        <div className="relative h-1.5 rounded-full bg-slate-100 overflow-hidden mb-4">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
          {running && (
            <div
              className="pointer-events-none absolute inset-y-0 left-0 rounded-full overflow-hidden"
              style={{ width: `${pct}%` }}
            >
              <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent_40%,rgba(255,255,255,0.55)_50%,transparent_60%)] bg-[length:200%_100%] animate-[bt-shimmer_1.6s_linear_infinite]" />
            </div>
          )}
        </div>
        <ol className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {steps.map((s, i) => {
            const isDone = s.state === "done";
            const isCurrent = s.state === "current";
            return (
              <li key={s.key} className="flex flex-col items-center gap-1.5 min-w-0">
                <div
                  className={cn(
                    "relative size-9 rounded-full ring-1 flex items-center justify-center text-[12px] font-bold shrink-0 transition-all duration-300",
                    isDone
                      ? "bg-emerald-500 text-white ring-emerald-500 shadow-md shadow-emerald-500/30"
                      : isCurrent
                        ? "bg-primary text-white ring-primary shadow-md shadow-primary/30 scale-110"
                        : "bg-white text-slate-400 ring-slate-200",
                  )}
                >
                  {isDone ? (
                    <Check
                      key={`done-${s.key}`}
                      className="size-4 animate-[bt-pop_320ms_cubic-bezier(0.34,1.56,0.64,1)]"
                    />
                  ) : isCurrent ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <span>{i + 1}</span>
                  )}
                  {/* Halo. The current step gets a large pulsing halo;
                      recently-done steps get a small ripple as they tick. */}
                  {isCurrent && (
                    <>
                      <span className="absolute -inset-2 rounded-full bg-primary/25 blur-md -z-10 animate-pulse" />
                      <span className="absolute -inset-0.5 rounded-full ring-2 ring-primary/40 animate-[bt-ring_1.6s_ease-out_infinite]" />
                    </>
                  )}
                  {/* Once everything is done but the run is still finalizing,
                      keep the trailing (last) step gently glowing. */}
                  {isDone && running && allDone && i === steps.length - 1 && (
                    <span className="absolute -inset-1 rounded-full ring-2 ring-emerald-400/50 animate-[bt-ring_1.8s_ease-out_infinite]" />
                  )}
                </div>
                <div
                  className={cn(
                    "text-center text-[10.5px] leading-tight font-medium truncate max-w-[80px] transition-colors",
                    isDone
                      ? "text-slate-900"
                      : isCurrent
                        ? "text-primary"
                        : "text-slate-400",
                  )}
                >
                  <span className="hidden sm:inline">
                    {i + 1}. {s.label}
                  </span>
                  <span className="sm:hidden">{s.label}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

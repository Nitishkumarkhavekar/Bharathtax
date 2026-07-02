import { ChangeEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Upload, FileText, Play, Loader2, RefreshCw, FileDown, BookOpen } from "lucide-react";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

function Section({ title, children, extra }: { title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{title}</h3>{extra}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export default function AppealCase() {
  const { id } = useParams();
  const cid = Number(id);
  const [c, setC] = useState<any>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [outputs, setOutputs] = useState<Out[]>([]);
  const [findings, setFindings] = useState<Out[]>([]);
  const [run, setRun] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [draft, setDraft] = useState("");
  const [versions, setVersions] = useState<any[]>([]);
  const [saved, setSaved] = useState("");
  const [regen, setRegen] = useState<Record<number, boolean>>({});
  const [uploadNote, setUploadNote] = useState("");
  const poll = useRef<any>(null);

  const loadCase = useCallback(async () => setC(await api.appealCase(cid)), [cid]);
  const loadLatest = useCallback(async () => {
    const d = await api.appealLatest(cid);
    setRun(d.run); setOutputs(d.outputs || []); setFindings(d.findings || []);
    const dr = (d.outputs || []).find((o: Out) => o.kind === "draft"); if (dr) setDraft(dr.content);
    try { setVersions(await api.appealDraftVersions(cid)); } catch { /* */ }
  }, [cid]);
  useEffect(() => { loadCase(); loadLatest(); }, [loadCase, loadLatest]);
  useEffect(() => () => poll.current && clearInterval(poll.current), []);

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
    setBusy(true); setProgress("queued");
    const r = await api.appealRun(cid); setRun(r);
    poll.current = setInterval(async () => {
      const rr = await api.appealRunStatus(r.id); setRun(rr); setProgress(rr.progress || rr.status);
      if (rr.status === "done" || rr.status === "error") { clearInterval(poll.current); setBusy(false); setProgress(""); loadLatest(); loadCase(); }
    }, 3000);
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
            <div key={d.id} className="flex items-center gap-3 p-2.5">
              <FileText className="size-4 text-muted-foreground" />
              <span className="flex-1 text-sm truncate">{d.filename}</span>
              <Badge variant="secondary">{d.category}</Badge>
              <button onClick={() => api.appealOpenDoc(cid, d.id)} className="text-xs text-primary hover:underline">view</button>
            </div>
          ))}
          {!c?.documents?.length && <div className="p-3 text-sm text-muted-foreground">No documents uploaded.</div>}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={start} disabled={busy || !c?.documents?.length}>
            {busy ? <><Loader2 className="size-4 animate-spin" /> Running…</> : <><Play className="size-4" /> Run 6 modules</>}
          </Button>
          {busy && <span className="text-sm text-muted-foreground">⏳ {progress}</span>}
          {!busy && run && <span className="text-sm text-muted-foreground">last run: {run.status} · {run.provider}</span>}
        </div>
      </Section>

      {outputs.length > 0 && (
        <>
          <Section title="Module 3 — Document Compliance">
            {compliance ? (
              <>
                <p className="text-sm mb-2">Missing: <b>{compliance.missing?.length ? compliance.missing.join(", ") : "none"}</b></p>
                <div className="grid sm:grid-cols-2 gap-1.5 text-sm">
                  {compliance.compliance_sheet?.map((x: any, i: number) => (
                    <div key={i} className="flex justify-between rounded-md bg-muted/50 px-2 py-1"><span className="truncate">{x.filename}</span><Badge variant="secondary">{x.category}</Badge></div>
                  ))}
                </div>
              </>
            ) : <pre className="text-sm whitespace-pre-wrap">{get("compliance")?.content}</pre>}
          </Section>

          <div className="grid lg:grid-cols-2 gap-5">
            <Section title="Module 1 — Deficiency Report"><pre className="text-sm whitespace-pre-wrap leading-relaxed">{get("deficiency")?.content}</pre><Citations items={get("deficiency")?.citations} /></Section>
            <Section title="Module 2 — Scope Validation"><pre className="text-sm whitespace-pre-wrap leading-relaxed">{get("scope")?.content}</pre><Citations items={get("scope")?.citations} /></Section>
          </div>

          <Section title="Module 4/5 — Issues & Findings" extra={findings.length > 0 ? <Button variant="outline" size="sm" onClick={reassemble}><RefreshCw className="size-4" /> Reassemble draft</Button> : undefined}>
            {matrix?.issues && <p className="text-sm text-muted-foreground mb-3">{matrix.issues.length} issues detected · regenerate any, then reassemble.</p>}
            <div className="space-y-4">
              {findings.map((fnd) => (
                <div key={fnd.seq} className="border-t pt-3 first:border-t-0 first:pt-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="flex-1 font-medium text-sm">{fnd.seq + 1}. {fnd.label} {fnd.version > 1 && <Badge variant="secondary">v{fnd.version}</Badge>}</h4>
                    <Button variant="outline" size="sm" onClick={() => regenerate(fnd.seq)} disabled={regen[fnd.seq]}>
                      {regen[fnd.seq] ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Regenerate
                    </Button>
                  </div>
                  <pre className="text-sm whitespace-pre-wrap leading-relaxed">{fnd.content}</pre>
                  <Citations items={fnd.citations} />
                </div>
              ))}
            </div>
          </Section>

          <Section title="Module 6 — Draft Appellate Order" extra={
            <div className="flex items-center gap-2">
              {versions.length > 1 && (
                <select className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  onChange={(e) => { const v = versions.find((x) => x.id === Number(e.target.value)); if (v) setDraft(v.content); }} defaultValue={versions[0]?.id}>
                  {versions.map((v) => <option key={v.id} value={v.id}>v{v.version}{v.edited ? " (edited)" : ""}</option>)}
                </select>
              )}
              {saved && <span className="text-xs text-success">{saved}</span>}
            </div>}>
            <p className="text-sm text-muted-foreground mb-2 flex items-center gap-1"><BookOpen className="size-4" /> Apply mind and edit before finalising.</p>
            <Textarea className="min-h-[360px] font-mono text-[13px]" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="mt-3 flex gap-2">
              <Button onClick={saveDraft}>Save draft (new version)</Button>
              <Button variant="outline" onClick={() => api.appealDownload(`/appeal/cases/${cid}/export.docx`, `draft_order_case_${cid}.docx`).catch((e) => alert(e.message))}>
                <FileDown className="size-4" /> Download .docx
              </Button>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

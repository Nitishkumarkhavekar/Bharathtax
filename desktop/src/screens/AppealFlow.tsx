import { useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  type AppealCase,
  type AppealDocument,
  type AppealRun,
} from "../api";

// ---------------------------------------------------------------------------
// The 6 pipeline modules — labels/order taken from the web app so the desktop
// matches the officer's mental model. The backend reports progress as an int
// 0–6 on the AppealRun row; we translate that into per-step "done / current /
// pending" states.
// ---------------------------------------------------------------------------
const MODULES = [
  { key: 1, name: "Deficiency Report" },
  { key: 2, name: "Scope Validation" },
  { key: 3, name: "Document Compliance" },
  { key: 4, name: "Issue Matrix" },
  { key: 5, name: "Issue-wise Findings" },
  { key: 6, name: "Draft Order" },
];

interface Props {
  username: string;
  licenseValidUntil: string | null;
}

type Phase =
  | { kind: "metadata" }
  | { kind: "upload"; case: AppealCase }
  | { kind: "running"; case: AppealCase; run: AppealRun }
  | { kind: "done"; case: AppealCase; run: AppealRun }
  | { kind: "error"; case: AppealCase; run: AppealRun | null; message: string };

interface PickedFile {
  name: string;
  path: string;
  size: number;
}

export default function AppealFlow({ licenseValidUntil }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "metadata" });
  const [title, setTitle] = useState("");
  const [ay, setAy] = useState("");
  const [pan, setPan] = useState("");
  const [section, setSection] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [uploaded, setUploaded] = useState<AppealDocument[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const licenseSuffix = licenseValidUntil
    ? `License valid until ${new Date(licenseValidUntil).toLocaleDateString()}`
    : "Licensed account";

  // ---- metadata ---------------------------------------------------------
  const createCase = async () => {
    if (!title.trim()) {
      setErr("Case title is required.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const c = await api.createCase({
        title: title.trim(),
        assessment_year: ay.trim() || null,
        pan: pan.trim().toUpperCase() || null,
        section: section.trim() || null,
      });
      setPhase({ kind: "upload", case: c });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ---- upload -----------------------------------------------------------
  const pickFiles = async () => {
    const files = await window.bharat.files.pick();
    if (!files.length) return;
    // Merge with existing picks, dedup by name+size.
    setPicked((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const merged = [...prev];
      for (const f of files) {
        const key = `${f.name}:${f.size}`;
        if (!seen.has(key)) {
          merged.push(f);
          seen.add(key);
        }
      }
      return merged;
    });
  };

  const removePick = (idx: number) =>
    setPicked((prev) => prev.filter((_, i) => i !== idx));

  const uploadAndRun = async () => {
    if (phase.kind !== "upload") return;
    if (!picked.length && !uploaded.length) {
      setErr("Add at least one document before running.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      if (picked.length) {
        setUploadProgress(`Reading ${picked.length} file${picked.length > 1 ? "s" : ""}…`);
        const payloads: Array<{ name: string; bytes: ArrayBuffer }> = [];
        for (const f of picked) {
          const bytes = await window.bharat.files.read(f.path);
          payloads.push({ name: f.name, bytes });
        }
        setUploadProgress("Uploading to server…");
        const result = await api.uploadDocuments(phase.case.slug, payloads);
        setUploaded(result.documents);
        setPicked([]);
        setUploadProgress(null);
      }

      setUploadProgress("Starting pipeline…");
      const run = await api.startRun(phase.case.slug);
      setUploadProgress(null);
      setPhase({ kind: "running", case: phase.case, run });
    } catch (e) {
      setUploadProgress(null);
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ---- run polling ------------------------------------------------------
  // Polls /appeal/cases/{slug}/latest every 2s while the run is queued/running.
  // Stops (and transitions phase) as soon as status becomes done/error.
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (phase.kind !== "running") return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const latest = await api.latest(phase.case.slug);
        if (cancelled) return;
        if (!latest.run) return;
        if (latest.run.status === "done") {
          setPhase({ kind: "done", case: phase.case, run: latest.run });
          return;
        }
        if (latest.run.status === "error") {
          setPhase({
            kind: "error",
            case: phase.case,
            run: latest.run,
            message: latest.run.error || "Pipeline failed. Please try again.",
          });
          return;
        }
        // Still running — reflect progress.
        setPhase((prev) =>
          prev.kind === "running" ? { ...prev, run: latest.run! } : prev,
        );
      } catch (e) {
        // Network hiccup — just skip this tick; the interceptor already
        // handles hard-fail cases (401/403/402).
      }
      pollRef.current = window.setTimeout(tick, 2000);
    };
    tick();

    return () => {
      cancelled = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [phase.kind === "running" ? phase.case.slug : ""]);

  // ---- download ---------------------------------------------------------
  const download = async () => {
    if (phase.kind !== "done") return;
    setDownloading(true);
    try {
      const bytes = await api.exportDocx(phase.case.slug);
      const safe = phase.case.title.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60);
      await window.bharat.files.saveDocx(`${safe || "appeal_order"}.docx`, bytes);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const startNewCase = () => {
    setTitle("");
    setAy("");
    setPan("");
    setSection("");
    setPicked([]);
    setUploaded([]);
    setErr(null);
    setPhase({ kind: "metadata" });
  };

  // ---- render -----------------------------------------------------------
  return (
    <div className="flex-1 p-6 max-w-4xl w-full mx-auto">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-800">Draft appeal order</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {licenseSuffix} · Pipeline runs on the BharatTax server
          </p>
        </div>
        <StepBadge phase={phase} />
      </div>

      {err && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {err}
        </div>
      )}

      {phase.kind === "metadata" && (
        <MetadataPanel
          title={title}
          ay={ay}
          pan={pan}
          section={section}
          busy={busy}
          onTitle={setTitle}
          onAy={setAy}
          onPan={setPan}
          onSection={setSection}
          onSubmit={createCase}
        />
      )}

      {phase.kind === "upload" && (
        <UploadPanel
          case_={phase.case}
          picked={picked}
          uploaded={uploaded}
          busy={busy}
          progress={uploadProgress}
          onPick={pickFiles}
          onRemove={removePick}
          onRun={uploadAndRun}
        />
      )}

      {phase.kind === "running" && <RunningPanel run={phase.run} />}

      {phase.kind === "done" && (
        <DonePanel
          case_={phase.case}
          downloading={downloading}
          onDownload={download}
          onNew={startNewCase}
        />
      )}

      {phase.kind === "error" && (
        <ErrorPanel
          message={phase.message}
          onRetry={() => {
            if (phase.case) setPhase({ kind: "upload", case: phase.case });
            else startNewCase();
          }}
          onNew={startNewCase}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-panels — kept in this file to keep the flow easy to trace at a glance.
// ---------------------------------------------------------------------------

function StepBadge({ phase }: { phase: Phase }) {
  const step =
    phase.kind === "metadata"
      ? 1
      : phase.kind === "upload"
      ? 2
      : phase.kind === "running"
      ? 3
      : phase.kind === "done"
      ? 4
      : 0;
  const label =
    phase.kind === "metadata"
      ? "Step 1 of 4 — Case details"
      : phase.kind === "upload"
      ? "Step 2 of 4 — Upload documents"
      : phase.kind === "running"
      ? "Step 3 of 4 — Running pipeline"
      : phase.kind === "done"
      ? "Step 4 of 4 — Order ready"
      : "Error";
  return (
    <div className="text-xs px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 font-medium">
      {label}
    </div>
  );
}

function MetadataPanel(props: {
  title: string;
  ay: string;
  pan: string;
  section: string;
  busy: boolean;
  onTitle: (v: string) => void;
  onAy: (v: string) => void;
  onPan: (v: string) => void;
  onSection: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <div className="mb-5">
        <h3 className="font-semibold text-slate-800">Case details</h3>
        <p className="text-sm text-slate-500">
          Give the case a title. The other fields are optional but improve
          drafting accuracy.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="text-sm font-medium text-slate-700 block mb-1">
            Case title <span className="text-red-500">*</span>
          </label>
          <input
            className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={props.title}
            onChange={(e) => props.onTitle(e.target.value)}
            placeholder="ABC Traders Pvt Ltd — AY 2021-22"
            disabled={props.busy}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">
            Assessment year
          </label>
          <input
            className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={props.ay}
            onChange={(e) => props.onAy(e.target.value)}
            placeholder="2021-22"
            disabled={props.busy}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">PAN</label>
          <input
            className="w-full border border-slate-300 rounded-lg px-3 py-2 uppercase focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={props.pan}
            onChange={(e) => props.onPan(e.target.value)}
            placeholder="AAAPL1234C"
            disabled={props.busy}
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-sm font-medium text-slate-700 block mb-1">
            Section
          </label>
          <input
            className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={props.section}
            onChange={(e) => props.onSection(e.target.value)}
            placeholder="143(3)"
            disabled={props.busy}
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          onClick={props.onSubmit}
          disabled={props.busy}
          className="px-5 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {props.busy ? "Creating case…" : "Continue"}
        </button>
      </div>
    </div>
  );
}

function UploadPanel(props: {
  case_: AppealCase;
  picked: PickedFile[];
  uploaded: AppealDocument[];
  busy: boolean;
  progress: string | null;
  onPick: () => void;
  onRemove: (idx: number) => void;
  onRun: () => void;
}) {
  const total = props.picked.length + props.uploaded.length;
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <div className="mb-4">
        <div className="text-xs text-slate-500 uppercase tracking-wide">Case</div>
        <div className="font-semibold text-slate-800">{props.case_.title}</div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800">Upload documents</h3>
          <p className="text-sm text-slate-500">
            PDFs, DOCX, TXT or HTML. Upload Form 35, grounds of appeal,
            statement of facts, assessment order, and any supporting papers.
          </p>
        </div>
        <button
          onClick={props.onPick}
          disabled={props.busy}
          className="text-sm px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
        >
          + Add files
        </button>
      </div>

      {total === 0 && (
        <div className="border-2 border-dashed border-slate-200 rounded-xl p-10 text-center text-slate-400">
          No files added yet. Click <b>+ Add files</b> to select documents.
        </div>
      )}

      {props.uploaded.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
            Already on server
          </div>
          <ul className="border border-slate-200 rounded-lg divide-y">
            {props.uploaded.map((d) => (
              <li key={d.id} className="px-3 py-2 flex items-center gap-3 text-sm">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="flex-1 truncate">{d.filename}</span>
                <span className="text-xs text-slate-500">{d.category}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {props.picked.length > 0 && (
        <div className="mb-3">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
            Ready to upload
          </div>
          <ul className="border border-slate-200 rounded-lg divide-y">
            {props.picked.map((f, i) => (
              <li key={f.path} className="px-3 py-2 flex items-center gap-3 text-sm">
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-xs text-slate-500">{formatBytes(f.size)}</span>
                <button
                  onClick={() => props.onRemove(i)}
                  disabled={props.busy}
                  className="text-slate-400 hover:text-red-600 text-xs"
                  title="Remove"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {props.progress && (
        <div className="text-sm text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 mb-3">
          {props.progress}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button
          onClick={props.onRun}
          disabled={props.busy || total === 0}
          className="px-5 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {props.busy ? "Working…" : "Upload & run all 6 phases"}
        </button>
      </div>
    </div>
  );
}

function RunningPanel({ run }: { run: AppealRun }) {
  // backend reports progress as an integer 0..6 (module index just completed).
  // If the field is null we treat as 0.
  const done = Math.max(0, Math.min(6, run.progress ?? 0));
  const pct = Math.round((done / MODULES.length) * 100);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <div className="mb-5">
        <h3 className="font-semibold text-slate-800">Running pipeline</h3>
        <p className="text-sm text-slate-500">
          The six drafting modules run on the server. This can take a couple of
          minutes depending on document length.
        </p>
      </div>

      <div className="mb-4">
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-brand-600 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-slate-500 mt-1">
          <span>{done} of {MODULES.length} modules complete</span>
          <span>{pct}%</span>
        </div>
      </div>

      <ul className="space-y-2">
        {MODULES.map((m) => {
          const isDone = m.key <= done;
          const isCurrent = m.key === done + 1;
          return (
            <li
              key={m.key}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${
                isDone
                  ? "bg-green-50 border-green-200"
                  : isCurrent
                  ? "bg-brand-50 border-brand-200"
                  : "bg-slate-50 border-slate-200"
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full grid place-items-center text-xs font-semibold ${
                  isDone
                    ? "bg-green-500 text-white"
                    : isCurrent
                    ? "bg-brand-600 text-white"
                    : "bg-slate-300 text-slate-600"
                }`}
              >
                {isDone ? "✓" : m.key}
              </span>
              <span className="flex-1 text-sm font-medium text-slate-800">
                {m.name}
              </span>
              <span className="text-xs text-slate-500">
                {isDone
                  ? "done"
                  : isCurrent
                  ? "running…"
                  : "waiting"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DonePanel(props: {
  case_: AppealCase;
  downloading: boolean;
  onDownload: () => void;
  onNew: () => void;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <div className="w-14 h-14 mx-auto rounded-full bg-green-50 text-green-600 grid place-items-center mb-4">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>
      <div className="text-center">
        <h3 className="text-xl font-semibold text-slate-800">Draft order ready</h3>
        <p className="text-sm text-slate-500 mt-1">
          Case <b>{props.case_.title}</b> — all six modules completed. Download
          the DOCX to open it in Microsoft Word.
        </p>
      </div>

      <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
        <button
          onClick={props.onDownload}
          disabled={props.downloading}
          className="px-5 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {props.downloading ? "Preparing…" : "Download appeal order (.docx)"}
        </button>
        <button
          onClick={props.onNew}
          className="px-5 py-2.5 rounded-lg border border-slate-300 hover:bg-slate-50 font-medium text-slate-700"
        >
          Draft another case
        </button>
      </div>
    </div>
  );
}

function ErrorPanel(props: {
  message: string;
  onRetry: () => void;
  onNew: () => void;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-red-200 p-6">
      <div className="w-14 h-14 mx-auto rounded-full bg-red-50 text-red-600 grid place-items-center mb-4">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div className="text-center">
        <h3 className="text-xl font-semibold text-slate-800">Pipeline failed</h3>
        <p className="text-sm text-slate-600 mt-1 max-w-lg mx-auto">
          {props.message}
        </p>
      </div>
      <div className="mt-6 flex gap-3 justify-center">
        <button
          onClick={props.onRetry}
          className="px-5 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700"
        >
          Retry
        </button>
        <button
          onClick={props.onNew}
          className="px-5 py-2.5 rounded-lg border border-slate-300 hover:bg-slate-50 font-medium text-slate-700"
        >
          Start over
        </button>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

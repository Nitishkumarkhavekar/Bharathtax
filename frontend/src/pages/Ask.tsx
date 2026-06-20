import { FormEvent, useState } from "react";
import { AnswerResponse, ApiError, api } from "../api";

// Module = the corpus/domain to search (taxmann.ai's "Module"); Style = answer format.
const MODULES = [
  { value: "", label: "All modules" },
  { value: "income_tax", label: "Income Tax" },
  { value: "gst", label: "GST (coming soon)" },
  { value: "customs", label: "Customs (coming soon)" },
];
const STYLES = ["explanatory", "concise"];

function Answer({ a }: { a: AnswerResponse }) {
  return (
    <div className="bg-white rounded-lg shadow p-5 space-y-4">
      {!a.grounded && (
        <div className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 text-sm">
          No grounded answer — retrieval found nothing relevant in the primary sources.
        </div>
      )}
      <p className="whitespace-pre-wrap leading-relaxed">{a.answer}</p>
      {a.citations.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-600 mb-1">Sources</h3>
          <ol className="space-y-1">
            {a.citations.map((c) => (
              <li key={c.n} className="text-sm">
                <span className="font-mono text-brand">[{c.n}]</span>{" "}
                {c.source_url ? (
                  <a href={c.source_url} target="_blank" rel="noreferrer"
                     className="text-brand hover:underline">{c.breadcrumb}</a>
                ) : (
                  <span>{c.breadcrumb}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="text-xs text-slate-400">
        {a.latency_ms != null && <>answered in {a.latency_ms} ms · </>}
        top score {String(a.meta["top_score"] ?? "—")}
      </div>
    </div>
  );
}

export default function Ask() {
  const [q, setQ] = useState("");
  const [module, setModule] = useState("");
  const [style, setStyle] = useState("explanatory");
  const [answer, setAnswer] = useState<AnswerResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(await api.ask(q, module || undefined, style));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Ask Bot</h1>
      <form onSubmit={submit} className="bg-white rounded-lg shadow p-4 space-y-3">
        <textarea
          className="w-full border rounded p-3 h-24"
          placeholder="e.g. What is the maximum deduction available under section 80C?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">
            Module{" "}
            <select className="border rounded px-2 py-1" value={module}
                    onChange={(e) => setModule(e.target.value)}>
              {MODULES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <label className="text-sm">
            Style{" "}
            <select className="border rounded px-2 py-1" value={style}
                    onChange={(e) => setStyle(e.target.value)}>
              {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <button disabled={busy}
                  className="ml-auto bg-brand text-white rounded px-5 py-2 hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Searching…" : "Ask"}
          </button>
        </div>
      </form>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {answer && <Answer a={answer} />}
    </div>
  );
}

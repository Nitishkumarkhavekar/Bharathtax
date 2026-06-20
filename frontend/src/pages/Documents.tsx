import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { AnswerResponse, ApiError, DocumentOut, api } from "../api";

export default function Documents() {
  const [docs, setDocs] = useState<DocumentOut[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<AnswerResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => api.documents().then(setDocs).catch(() => {});
  useEffect(() => { refresh(); }, []);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await api.uploadDocument(file);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!selected || !q.trim()) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(await api.askDocument(selected, q));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">My Documents</h1>
        <label className="inline-block bg-brand text-white rounded px-4 py-2 cursor-pointer hover:bg-brand-dark">
          Upload a file
          <input type="file" className="hidden" onChange={upload} disabled={busy} />
        </label>
        <ul className="divide-y bg-white rounded-lg shadow">
          {docs.map((d) => (
            <li key={d.id}
                className={`p-3 cursor-pointer hover:bg-slate-50 ${selected === d.id ? "bg-blue-50" : ""}`}
                onClick={() => { setSelected(d.id); setAnswer(null); }}>
              <div className="font-medium text-sm">{d.filename}</div>
              <div className="text-xs text-slate-400">{d.status}</div>
            </li>
          ))}
          {docs.length === 0 && <li className="p-3 text-sm text-slate-400">No documents yet.</li>}
        </ul>
      </div>

      <div className="space-y-3">
        <h1 className="text-xl font-semibold">Ask the selected document</h1>
        <form onSubmit={ask} className="bg-white rounded-lg shadow p-4 space-y-3">
          <textarea className="w-full border rounded p-3 h-24" disabled={!selected}
                    placeholder={selected ? "Ask about this document…" : "Select a document first"}
                    value={q} onChange={(e) => setQ(e.target.value)} />
          <button disabled={busy || !selected}
                  className="bg-brand text-white rounded px-5 py-2 hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Working…" : "Ask"}
          </button>
        </form>
        {error && <div className="text-red-600 text-sm">{error}</div>}
        {answer && (
          <div className="bg-white rounded-lg shadow p-4">
            {!answer.grounded && (
              <div className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 text-sm mb-2">
                Nothing relevant found in this document.
              </div>
            )}
            <p className="whitespace-pre-wrap leading-relaxed">{answer.answer}</p>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { ApiError, api, type AppealCase } from "../api";

// Reusable "create appeal case" modal — invoked from the Sidebar's New
// Appeal button, from Dashboard's action card, and from the empty state
// on the Appeals list.  On save, the newly-created case is passed back to
// the parent so it can auto-navigate the officer straight to the case.
export default function NewCaseDialog({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (c: AppealCase) => void;
}) {
  const [title, setTitle] = useState("");
  const [ay, setAy] = useState("");
  const [pan, setPan] = useState("");
  const [section, setSection] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr("Case title is required."); return; }
    setBusy(true); setErr(null);
    try {
      const c = await api.createCase({
        title: title.trim(),
        assessment_year: ay.trim() || null,
        pan: pan.trim() || null,
        section: section.trim() || null,
      });
      onCreated(c);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-gradient-to-r from-navy-800 to-navy-700 text-white flex items-center justify-between">
          <div className="text-[15.5px] font-semibold">New appeal case</div>
          <button onClick={onClose} className="text-white/70 hover:text-white" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <form onSubmit={save} className="p-5 space-y-3">
          <Field label="Case title" required>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="ABC Traders Pvt Ltd — AY 2021-22"
              required autoFocus className="input" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="AY"><input value={ay} onChange={(e) => setAy(e.target.value)} placeholder="2021-22" className="input" /></Field>
            <Field label="PAN"><input value={pan} onChange={(e) => setPan(e.target.value)} placeholder="AAAPL1234C" className="input font-mono" /></Field>
            <Field label="Section"><input value={section} onChange={(e) => setSection(e.target.value)} placeholder="143(3)" className="input" /></Field>
          </div>
          {err && <div className="text-[13.5px] text-ashoka-700 bg-ashoka-50 border border-ashoka-200 rounded px-3 py-2">{err}</div>}
          <div className="pt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-md text-slate-600 hover:bg-slate-100 font-medium">Cancel</button>
            <button type="submit" disabled={busy || !title.trim()}
              className="h-9 px-5 rounded-md bg-ashoka-600 text-white hover:bg-ashoka-500 disabled:opacity-60 font-semibold">
              {busy ? "Creating…" : "Create & open"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[12.5px] font-semibold uppercase tracking-wider text-slate-500">
        {label} {required && <span className="text-ashoka-600">*</span>}
      </label>
      {children}
    </div>
  );
}

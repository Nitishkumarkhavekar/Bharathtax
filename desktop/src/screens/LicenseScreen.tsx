import { useState } from "react";
import { api, ApiError } from "../api";

interface Props {
  // If the account has an auto-generated trial license waiting, the server
  // returns it in /auth/license/status so we can pre-fill the input.
  pendingKey: string | null;
  onActivated: () => void;
  onSignOut: () => void;
}

export default function LicenseScreen({ pendingKey, onActivated, onSignOut }: Props) {
  const [key, setKey] = useState(pendingKey || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const clean = key.trim().toUpperCase().replace(/\s+/g, "");
    if (!clean) {
      setErr("Enter your license key.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.activateLicense(clean);
      if (r.licensed) onActivated();
      else setErr(r.message || "License could not be activated.");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setErr(msg || "Activation failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 grid place-items-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8"
      >
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-800">Activate your license</h1>
          <p className="text-sm text-slate-500 mt-1">
            Enter the license key issued for your account. This unlocks the appeal
            drafting pipeline for the validity period on file.
          </p>
        </div>

        <label className="block text-sm font-medium text-slate-700 mb-1">
          License key
        </label>
        <input
          type="text"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4 font-mono tracking-wider text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          disabled={busy}
          autoFocus
        />

        {pendingKey && (
          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-3 py-2 mb-4">
            A trial key was pre-filled from your account. Click activate to
            claim it, or paste a different key you were issued.
          </div>
        )}

        {err && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "Activating…" : "Activate license"}
        </button>

        <button
          type="button"
          onClick={onSignOut}
          className="w-full mt-3 text-sm text-slate-500 hover:text-slate-700"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

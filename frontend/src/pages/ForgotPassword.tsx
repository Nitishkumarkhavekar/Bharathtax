import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api";
import { Button } from "@/components/ui/button";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api.passwordResetRequest(email.trim());
      setMsg(r.message);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-gradient-to-br from-slate-100 via-slate-50 to-primary/10">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 p-8">
        <h1 className="text-xl font-semibold text-slate-900">Forgot your password?</h1>
        <p className="text-sm text-slate-500 mt-1.5">
          Enter the email on your BharatTax account. If it's registered, we'll send a
          single-use reset link that expires in 60 minutes.
        </p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="officer@example.gov.in" required autoFocus
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          </div>
          {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{err}</div>}
          {msg && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">{msg}</div>}
          <Button type="submit" disabled={busy || !email.trim()} className="w-full">
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
        <div className="mt-5 text-center text-sm">
          <Link to="/login" className="text-primary hover:text-primary/80 font-medium">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}

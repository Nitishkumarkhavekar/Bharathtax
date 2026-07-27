import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Loader2, Mail } from "lucide-react";
import { ApiError, api } from "../api";
import AuthShell from "@/components/auth/AuthShell";

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
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter the email on your account and we'll send a single-use reset link that expires in 60 minutes."
      footer={<Link to="/login" className="font-semibold text-primary hover:underline">Back to sign in</Link>}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-[12.5px] font-semibold text-slate-800 mb-1.5">Email address</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none" />
            <input
              type="email" required autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@department.gov.in"
              className="w-full h-11 rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-[14px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
            />
          </div>
        </div>
        {err && <div className="text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}
        {msg && <div className="text-[13px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{msg}</div>}
        <button
          type="submit" disabled={busy || !email.trim()}
          className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-lg bg-primary text-white font-semibold text-[14.5px] hover:bg-primary/90 shadow-lg disabled:opacity-60"
        >
          {busy ? <><Loader2 className="size-4 animate-spin" /> Sending…</> : <>Send reset link <ArrowRight className="size-4" /></>}
        </button>
      </form>
    </AuthShell>
  );
}

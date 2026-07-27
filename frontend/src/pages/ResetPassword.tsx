import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { ApiError, api } from "../api";
import AuthShell from "@/components/auth/AuthShell";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string; username: string } | null>(null);

  const canSubmit = useMemo(() =>
    token.length > 10 && pw.length >= 8 && pw === pw2, [token, pw, pw2]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.passwordResetConfirm(token, pw);
      setDone({ email: r.email, username: r.username });
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <AuthShell
        title="Password updated"
        subtitle="You can now use your new password to sign in on the web app or the desktop application."
        badge="All set"
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3.5 py-2.5 flex items-center gap-2 text-[13px]">
            <CheckCircle2 className="size-4 text-emerald-500" />
            Signed in as <span className="font-mono text-slate-900 truncate">{done.email}</span>
          </div>
          <Link to="/login"
            className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-lg bg-primary text-white font-semibold text-[14px] hover:bg-primary/90 shadow-lg shadow-primary/25"
          >
            Continue to web sign-in <ArrowRight className="size-4" />
          </Link>
          <a
            href="https://bharattax.wenvia.global/releases"
            target="_blank" rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center h-11 rounded-lg ring-1 ring-slate-200 text-slate-700 hover:bg-slate-50 font-medium text-[14px]"
          >
            Open the desktop app
          </a>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Your reset link is one-use only and expires 60 minutes after it was issued."
      footer={<Link to="/login" className="font-semibold text-primary hover:underline">Back to sign in</Link>}
    >
      {!token && (
        <div className="mb-4 text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          This URL is missing a reset token. Ask for a fresh link from the Forgot page.
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password">
          <input
            type="password" value={pw} onChange={(e) => setPw(e.target.value)}
            minLength={8} required autoFocus
            placeholder="At least 8 characters"
            className="w-full h-11 rounded-lg border border-slate-200 bg-white px-3.5 text-[14px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
          />
        </Field>
        <Field label="Confirm new password">
          <input
            type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
            minLength={8} required
            className="w-full h-11 rounded-lg border border-slate-200 bg-white px-3.5 text-[14px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
          />
          {pw && pw2 && pw !== pw2 && (
            <div className="mt-1 text-[11.5px] text-rose-700">Passwords don't match.</div>
          )}
        </Field>
        {err && <div className="text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>}
        <button type="submit" disabled={busy || !canSubmit}
          className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-lg bg-primary text-white font-semibold text-[14.5px] hover:bg-primary/90 shadow-lg shadow-primary/25 disabled:opacity-60"
        >
          {busy ? <><Loader2 className="size-4 animate-spin" /> Resetting…</> : <>Set new password <ArrowRight className="size-4" /></>}
        </button>
      </form>
    </AuthShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12.5px] font-semibold text-slate-800 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

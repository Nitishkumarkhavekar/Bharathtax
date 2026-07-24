import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../api";
import { Button } from "@/components/ui/button";

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
      <div className="min-h-screen grid place-items-center p-6 bg-gradient-to-br from-slate-100 via-slate-50 to-primary/10">
        <div className="w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 p-8 text-center">
          <div className="mx-auto size-14 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Password reset</h1>
          <p className="text-sm text-slate-500 mt-1.5">
            Signed in as <b>{done.email}</b>. You can now use your new password on the
            web app or the desktop application.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <Link to="/login">
              <Button className="w-full">Continue to web sign-in</Button>
            </Link>
            <a
              href="https://bharattax.wenvia.global/releases"
              target="_blank" rel="noopener noreferrer"
              className="w-full h-10 grid place-items-center rounded-md ring-1 ring-slate-200 text-slate-700 hover:bg-slate-50 font-medium text-sm"
            >
              Open the desktop app
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center p-6 bg-gradient-to-br from-slate-100 via-slate-50 to-primary/10">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 p-8">
        <h1 className="text-xl font-semibold text-slate-900">Choose a new password</h1>
        <p className="text-sm text-slate-500 mt-1.5">
          Your reset link is one-use only and expires 60 minutes after it was issued.
        </p>
        {!token && (
          <div className="mt-4 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
            This URL is missing a reset token. Ask for a fresh link from the Forgot page.
          </div>
        )}
        <form onSubmit={submit} className="mt-5 space-y-3">
          <Field label="New password">
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
              minLength={8} required autoFocus
              placeholder="At least 8 characters"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          </Field>
          <Field label="Confirm new password">
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
              minLength={8} required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            {pw && pw2 && pw !== pw2 && (
              <div className="mt-1 text-[12px] text-rose-700">Passwords don't match.</div>
            )}
          </Field>
          {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{err}</div>}
          <Button type="submit" disabled={busy || !canSubmit} className="w-full">
            {busy ? "Resetting…" : "Set new password"}
          </Button>
        </form>
        <div className="mt-5 text-center text-sm">
          <Link to="/login" className="text-primary hover:text-primary/80 font-medium">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

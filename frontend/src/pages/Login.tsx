import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { landingPath, useAuth } from "../auth";
import { ApiError } from "../api";
import AuthShell from "@/components/auth/AuthShell";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const s = await login(email.trim(), password);
      nav(landingPath(s.role), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to continue drafting and researching with BharatTax."
      footer={
        <>
          New to BharatTax?{" "}
          <Link to="/register" className="font-semibold text-primary hover:underline">
            Request an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email address" htmlFor="email">
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@department.gov.in"
            className="w-full h-11 rounded-lg border border-slate-200 bg-white px-3.5 text-[14px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          trailing={
            <Link to="/forgot-password" className="text-[12px] font-medium text-primary hover:underline">
              Forgot?
            </Link>
          }
        >
          <div className="relative">
            <input
              id="password"
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full h-11 rounded-lg border border-slate-200 bg-white pl-3.5 pr-10 text-[14px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700"
              aria-label={showPw ? "Hide password" : "Show password"}
            >
              {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>

        {error && (
          <div className="text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-lg bg-primary text-white font-semibold text-[14.5px] hover:bg-primary/90 shadow-lg transition-colors disabled:opacity-60"
        >
          {busy ? <><Loader2 className="size-4 animate-spin" /> Signing in…</> : <>Sign in <ArrowRight className="size-4" /></>}
        </button>

        <div className="pt-2 flex items-center justify-center gap-1.5 text-[11.5px] text-slate-500">
          <ShieldCheck className="size-3.5 text-emerald-500" />
          Secured with per-officer seat leases and audit logging
        </div>
      </form>

      <div className="mt-6 pt-4 border-t border-slate-200/70 flex items-center justify-center gap-2 text-[12px] text-slate-500">
        <img
          src="/bharattax-logo.png"
          alt=""
          aria-hidden
          className="h-5 w-auto select-none mix-blend-multiply"
          draggable={false}
        />
        <span>· Purpose-built for the Income-tax Department</span>
      </div>
    </AuthShell>
  );
}

function Field({
  label, htmlFor, children, trailing,
}: {
  label: string; htmlFor: string; children: React.ReactNode; trailing?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor={htmlFor} className="text-[12.5px] font-semibold text-slate-800">{label}</label>
        {trailing}
      </div>
      {children}
    </div>
  );
}

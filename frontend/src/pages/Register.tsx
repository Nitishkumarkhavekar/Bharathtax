import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Loader2, CheckCircle2, AlertCircle, ArrowRight, Eye, EyeOff,
} from "lucide-react";
import { ApiError, api } from "../api";
import AuthShell from "@/components/auth/AuthShell";

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      const r = await api.register({
        email: email.trim(),
        password,
        full_name: fullName.trim() || undefined,
      });
      setDoneMsg(r.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
    } finally { setBusy(false); }
  }

  const strength = useMemo(() => passwordStrength(password), [password]);
  const matchState = confirm ? (password === confirm ? "ok" : "mismatch") : "empty";

  if (doneMsg) return <RegistrationSuccess email={email} message={doneMsg} />;

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free 30-day trial · 100,000 tokens · no credit card required."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-primary hover:underline">Sign in</Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name" htmlFor="name">
          <input
            id="name" autoFocus autoComplete="name" required
            value={fullName} onChange={(e) => setFullName(e.target.value)}
            placeholder="Anita Sharma"
            className="w-full h-11 rounded-lg border border-slate-200 bg-white px-3.5 text-[14px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
          />
        </Field>
        <Field label="Email address" htmlFor="email">
          <input
            id="email" type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@department.gov.in"
            className="w-full h-11 rounded-lg border border-slate-200 bg-white px-3.5 text-[14px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <div className="relative">
            <input
              id="password" type={showPw ? "text" : "password"} autoComplete="new-password" required
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              className="w-full h-11 rounded-lg border border-slate-200 bg-white pl-3.5 pr-10 text-[14px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
            />
            <button type="button" onClick={() => setShowPw((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700"
              aria-label={showPw ? "Hide password" : "Show password"}
            >
              {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {password && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                <div className={"h-full transition-all " + strength.bar} style={{ width: `${strength.pct}%` }} />
              </div>
              <span className={"text-[11px] font-medium " + strength.text}>{strength.label}</span>
            </div>
          )}
        </Field>
        <Field label="Confirm password" htmlFor="confirm">
          <input
            id="confirm" type={showPw ? "text" : "password"} autoComplete="new-password" required
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat your password"
            className={"w-full h-11 rounded-lg border bg-white px-3.5 text-[14px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 " +
              (matchState === "mismatch"
                ? "border-rose-300 focus:border-rose-400 focus:ring-rose-200"
                : "border-slate-200 focus:border-primary focus:ring-primary/15")}
          />
          {matchState === "mismatch" && (
            <div className="mt-1 text-[11.5px] text-rose-600 flex items-center gap-1"><AlertCircle className="size-3" /> Passwords do not match</div>
          )}
          {matchState === "ok" && (
            <div className="mt-1 text-[11.5px] text-emerald-600 flex items-center gap-1"><CheckCircle2 className="size-3" /> Passwords match</div>
          )}
        </Field>

        {error && (
          <div className="text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertCircle className="size-4 shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}

        <button type="submit" disabled={busy}
          className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-lg bg-primary text-white font-semibold text-[14.5px] hover:bg-primary/90 shadow-lg transition-colors disabled:opacity-60"
        >
          {busy ? <><Loader2 className="size-4 animate-spin" /> Creating account…</> : <>Create account <ArrowRight className="size-4" /></>}
        </button>

        <p className="text-[11.5px] text-slate-500 text-center">
          By creating an account you agree to our{" "}
          <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link>{" "}
          and{" "}
          <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
        </p>
      </form>
    </AuthShell>
  );
}

function Field({ label, htmlFor, children }: {
  label: string; htmlFor: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[12.5px] font-semibold text-slate-800 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function passwordStrength(pw: string): { pct: number; label: string; bar: string; text: string } {
  if (!pw) return { pct: 0, label: "", bar: "", text: "" };
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const map = [
    { pct: 15, label: "Too weak", bar: "bg-rose-500", text: "text-rose-600" },
    { pct: 35, label: "Weak", bar: "bg-orange-500", text: "text-orange-600" },
    { pct: 55, label: "OK", bar: "bg-amber-500", text: "text-amber-600" },
    { pct: 75, label: "Good", bar: "bg-emerald-500", text: "text-emerald-600" },
    { pct: 100, label: "Strong", bar: "bg-emerald-600", text: "text-emerald-700" },
  ];
  return map[Math.min(score, map.length - 1)];
}

function RegistrationSuccess({ email, message }: { email: string; message: string }) {
  const nav = useNavigate();
  return (
    <AuthShell
      title="You're all set"
      subtitle="Your account is approved and your free trial is active."
      badge="Free trial active"
    >
      <div className="space-y-4">
        <p className="text-[13.5px] text-slate-700 leading-relaxed">{message}</p>
        <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3.5 py-2.5">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">Signed in email</div>
          <div className="mt-0.5 font-mono text-[13.5px] text-slate-900 truncate">{email}</div>
        </div>
        <p className="text-[12.5px] text-slate-500 leading-relaxed">
          Sign in to start using BharatTax — your license has been auto-assigned by the system.
        </p>
        <button
          onClick={() => nav("/login", { replace: true })}
          className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-lg bg-primary text-white font-semibold text-[14px] hover:bg-primary/90 shadow-lg"
        >
          Sign in now <ArrowRight className="size-4" />
        </button>
      </div>
    </AuthShell>
  );
}

import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Scale,
  ShieldCheck,
  BookText,
  Gavel,
  Mail,
  Lock,
  User as UserIcon,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ArrowRight,
  Eye,
  EyeOff,
  UserCheck,
  Rocket,
  KeyRound,
  Copy,
  Check,
} from "lucide-react";
import { ApiError, api } from "../api";

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [license, setLicense] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.register({
        email: email.trim(),
        password,
        full_name: fullName.trim() || undefined,
      });
      setLicense(r.license_key ?? null);
      setDoneMsg(r.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  const strength = useMemo(() => passwordStrength(password), [password]);
  const matchState = confirm
    ? password === confirm
      ? "ok"
      : "mismatch"
    : "empty";

  if (doneMsg) {
    return <RegistrationSuccess email={email} message={doneMsg} licenseKey={license} />;
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-slate-50">
      {/* Aurora canvas */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(1200px_640px_at_88%_-8%,rgba(46,124,200,0.28),transparent_60%),radial-gradient(1000px_640px_at_-10%_110%,rgba(99,102,241,0.22),transparent_60%),radial-gradient(700px_500px_at_50%_130%,rgba(139,92,246,0.14),transparent_60%),linear-gradient(180deg,#f4f7fc_0%,#e7eefa_100%)]" />
        <div
          className="absolute inset-0 opacity-[0.055]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgb(15 23 42) 1px, transparent 0)",
            backgroundSize: "26px 26px",
          }}
        />
        <div className="absolute -top-32 -left-32 size-[32rem] rounded-full bg-primary/20 blur-3xl animate-pulse [animation-duration:8s]" />
        <div className="absolute -bottom-32 -right-32 size-[28rem] rounded-full bg-violet-500/25 blur-3xl animate-pulse [animation-duration:11s]" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 size-[20rem] rounded-full bg-sky-400/15 blur-3xl animate-pulse [animation-duration:14s]" />
      </div>

      <div className="relative min-h-screen w-full grid lg:grid-cols-[1.05fr_1fr] items-center gap-8 px-4 sm:px-8 lg:px-16 py-8">
        {/* ============================================ Hero panel */}
        <div className="hidden lg:flex flex-col justify-between max-w-xl xl:max-w-2xl">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-primary/50 via-sky-400/40 to-violet-500/40 blur-md animate-pulse [animation-duration:6s]" />
              <div className="relative size-12 rounded-2xl bg-gradient-to-br from-primary via-sky-500 to-violet-600 flex items-center justify-center ring-1 ring-white/50 shadow-lg shadow-primary/30">
                <Scale className="size-5.5 text-white" strokeWidth={2.2} />
              </div>
            </div>
            <div>
              <div className="text-[22px] font-semibold tracking-tight text-slate-900 leading-none">
                BharathTax
              </div>
              <div className="text-[11.5px] text-slate-500 mt-1.5 flex items-center gap-1">
                <Sparkles className="size-3 text-primary" />
                Income-tax research · CIT(A) drafting
              </div>
            </div>
          </div>

          {/* Marketing body */}
          <div className="space-y-6 mt-10">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/80 backdrop-blur ring-1 ring-primary/25 text-primary text-[12px] font-semibold tracking-wide shadow-sm">
              <Rocket className="size-3.5" />
              Get started in one minute
            </span>
            <h2 className="text-[40px] xl:text-[50px] font-semibold tracking-[-0.02em] leading-[1.03] text-slate-900">
              Join a workspace built for{" "}
              <span className="relative inline-block">
                <span className="relative z-10 bg-gradient-to-r from-primary via-sky-500 to-violet-500 bg-clip-text text-transparent">
                  serious tax work.
                </span>
                <span
                  className="absolute -bottom-1 left-0 right-0 h-2 rounded-full bg-gradient-to-r from-primary/40 via-sky-400/40 to-violet-500/40 blur-md -z-0"
                  aria-hidden
                />
              </span>
            </h2>
            <p className="text-slate-600 text-[15.5px] leading-relaxed max-w-lg">
              Request an account today. An administrator will review your
              details and unlock access to citation-grounded research and the
              six-module appeal-drafting pipeline.
            </p>

            {/* Three onboarding step cards */}
            <div className="space-y-3">
              <StepCard
                num="1"
                icon={<UserCheck className="size-4" />}
                tone="primary"
                title="Fill in the basics"
                body="Just your official email, a name, and a password. Everything else can wait."
              />
              <StepCard
                num="2"
                icon={<ShieldCheck className="size-4" />}
                tone="violet"
                title="Admin approves you"
                body="Access is reviewed by an administrator so the wing's seat pool stays audit-clean."
              />
              <StepCard
                num="3"
                icon={<Gavel className="size-4" />}
                tone="amber"
                title="Sign in and get to work"
                body="Ask, research and draft appellate orders — every claim cited to the exact source."
              />
            </div>
          </div>

          {/* Trust markers */}
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-slate-500">
            <TrustPill>Self-hosted</TrustPill>
            <TrustPill>Seat-licensed</TrustPill>
            <TrustPill>Audit-logged</TrustPill>
            <TrustPill>No credit card</TrustPill>
          </div>
        </div>

        {/* ============================================ Registration card */}
        <div className="relative w-full max-w-md mx-auto lg:mx-0 lg:justify-self-end">
          {/* Static gradient border ring */}
          <div
            className="absolute -inset-[2px] rounded-[22px]"
            style={{
              background:
                "linear-gradient(135deg, rgba(46,124,200,0.95) 0%, rgba(99,102,241,0.95) 50%, rgba(139,92,246,0.95) 100%)",
            }}
            aria-hidden
          />
          <div
            className="absolute -inset-4 rounded-[26px] bg-gradient-to-br from-primary/30 via-sky-400/25 to-violet-500/30 blur-2xl opacity-70"
            aria-hidden
          />
          <div className="relative rounded-[20px] bg-white/95 backdrop-blur-xl shadow-[0_28px_80px_-30px_rgba(15,23,42,0.35)] overflow-hidden">
            {/* Top accent stripe */}
            <div className="h-1 bg-gradient-to-r from-primary via-sky-500 to-violet-500" />

            <form onSubmit={submit} className="p-7 sm:p-8 space-y-4">
              {/* Mobile brand */}
              <div className="lg:hidden flex items-center gap-2.5">
                <div className="relative">
                  <div className="absolute -inset-1 rounded-xl bg-gradient-to-br from-primary/40 via-sky-400/30 to-violet-500/30 blur-md" />
                  <div className="relative size-10 rounded-xl bg-gradient-to-br from-primary via-sky-500 to-violet-600 flex items-center justify-center ring-1 ring-white/50 shadow-md">
                    <Scale className="size-5 text-white" strokeWidth={2.2} />
                  </div>
                </div>
                <div>
                  <div className="text-[16px] font-semibold text-slate-900 leading-none">
                    BharathTax
                  </div>
                  <div className="text-[10.5px] text-slate-500 mt-1">
                    Income-tax research
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-50 ring-1 ring-amber-200 text-amber-700 text-[10.5px] font-semibold">
                  <ShieldCheck className="size-3" />
                  Requires admin approval
                </div>
                <h1 className="text-[26px] font-semibold tracking-tight text-slate-900 leading-tight">
                  Create an account
                </h1>
                <p className="text-[13px] text-slate-500">
                  You'll be able to sign in once an administrator approves.
                </p>
              </div>

              <Field label="Email" htmlFor="email" icon={<Mail className="size-4" />}>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@bharathtax.com"
                  required
                  autoFocus
                  className="peer w-full h-11 rounded-xl border border-slate-200 bg-white/80 pl-10 pr-3 text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-shadow"
                />
              </Field>

              <Field
                label="Full name"
                htmlFor="fullName"
                icon={<UserIcon className="size-4" />}
                optional
              >
                <input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="First & last name"
                  className="peer w-full h-11 rounded-xl border border-slate-200 bg-white/80 pl-10 pr-3 text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-shadow"
                />
              </Field>

              <Field
                label="Password"
                htmlFor="password"
                icon={<Lock className="size-4" />}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                    aria-label={showPw ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showPw ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                }
              >
                <input
                  id="password"
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  className="peer w-full h-11 rounded-xl border border-slate-200 bg-white/80 pl-10 pr-10 text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-shadow"
                />
              </Field>

              {/* Strength meter */}
              {password && (
                <div className="-mt-1 space-y-1">
                  <div className="flex gap-1">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className={
                          "h-1 flex-1 rounded-full transition-colors " +
                          (i < strength.score
                            ? strength.barClass
                            : "bg-slate-200")
                        }
                      />
                    ))}
                  </div>
                  <div className="text-[10.5px] text-slate-500 flex items-center justify-between">
                    <span>Strength: <span className={strength.textClass}>{strength.label}</span></span>
                    <span className="tabular-nums">{password.length} chars</span>
                  </div>
                </div>
              )}

              <Field
                label="Confirm password"
                htmlFor="confirm"
                icon={<Lock className="size-4" />}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowConfirm((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                    aria-label={showConfirm ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showConfirm ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                }
              >
                <input
                  id="confirm"
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                  className={
                    "peer w-full h-11 rounded-xl border bg-white/80 pl-10 pr-10 text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-shadow " +
                    (matchState === "mismatch"
                      ? "border-rose-300 focus:border-rose-400 focus:ring-rose-500/20"
                      : matchState === "ok"
                      ? "border-emerald-300 focus:border-emerald-400 focus:ring-emerald-500/20"
                      : "border-slate-200 focus:border-primary focus:ring-primary/25")
                  }
                />
              </Field>
              {matchState === "mismatch" && (
                <div className="-mt-1 text-[10.5px] text-rose-700 flex items-center gap-1">
                  <AlertCircle className="size-3" /> Passwords do not match yet.
                </div>
              )}
              {matchState === "ok" && (
                <div className="-mt-1 text-[10.5px] text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="size-3" /> Passwords match.
                </div>
              )}

              {error && (
                <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2 animate-fade-up">
                  <AlertCircle className="size-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="group relative w-full h-12 rounded-xl overflow-hidden text-white font-semibold text-[14.5px] tracking-tight transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(46,124,200,1) 0%, rgba(37,99,235,1) 50%, rgba(99,102,241,1) 100%)",
                  boxShadow:
                    "0 14px 34px -14px rgba(46,124,200,0.7), inset 0 1px 0 rgba(255,255,255,0.20)",
                }}
              >
                <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-white/12" />
                <span className="absolute -left-full top-0 h-full w-1/2 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-[-18deg] group-hover:left-full transition-[left] duration-700 ease-out" />
                <span className="relative inline-flex items-center justify-center gap-1.5">
                  {busy ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Creating account…
                    </>
                  ) : (
                    <>
                      Create account <ArrowRight className="size-4" />
                    </>
                  )}
                </span>
              </button>

              <div className="text-center text-[13px] text-slate-600">
                Already have an account?{" "}
                <Link
                  to="/login"
                  className="font-semibold text-primary hover:underline"
                >
                  Sign in
                </Link>
              </div>

              <div className="pt-3 mt-1 border-t border-slate-200/80 flex items-center justify-center gap-1.5 text-[11px] text-slate-500 text-center">
                <BookText className="size-3.5 text-primary" />
                By continuing you agree to seat-lease based access & audit logging.
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

// ================================================================ helpers

function Field({
  label,
  htmlFor,
  icon,
  children,
  trailing,
  optional,
}: {
  label: string;
  htmlFor: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  trailing?: React.ReactNode;
  optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-600 flex items-center gap-2"
      >
        {label}
        {optional && (
          <span className="text-[10px] font-normal text-slate-400 normal-case tracking-normal">
            optional
          </span>
        )}
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 peer-focus:text-primary">
          {icon}
        </span>
        {children}
        {trailing}
      </div>
    </div>
  );
}

function TrustPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/70 backdrop-blur ring-1 ring-slate-200 shadow-sm">
      <CheckCircle2 className="size-3.5 text-emerald-500" />
      {children}
    </span>
  );
}

function StepCard({
  num,
  icon,
  title,
  body,
  tone,
}: {
  num: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  tone: "primary" | "violet" | "amber";
}) {
  const toneMap = {
    primary: {
      tile: "from-sky-100 to-blue-50 text-primary ring-primary/25",
      num: "bg-primary text-white",
    },
    violet: {
      tile: "from-violet-100 to-violet-50 text-violet-700 ring-violet-200",
      num: "bg-violet-600 text-white",
    },
    amber: {
      tile: "from-amber-100 to-amber-50 text-amber-700 ring-amber-200",
      num: "bg-amber-500 text-white",
    },
  }[tone];
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-white/70 backdrop-blur ring-1 ring-slate-200 shadow-sm px-4 py-3">
      <div className="relative shrink-0">
        <div
          className={
            "size-10 rounded-xl bg-gradient-to-br ring-1 flex items-center justify-center " +
            toneMap.tile
          }
        >
          {icon}
        </div>
        <span
          className={
            "absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold tabular-nums flex items-center justify-center ring-2 ring-white shadow-sm " +
            toneMap.num
          }
        >
          {num}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-slate-900 leading-tight">
          {title}
        </div>
        <div className="text-[12.5px] text-slate-600 leading-relaxed mt-0.5">
          {body}
        </div>
      </div>
    </div>
  );
}

/** Simple heuristic strength scorer — 0..4 bars. */
function passwordStrength(pw: string): {
  score: number;
  label: string;
  barClass: string;
  textClass: string;
} {
  if (!pw) return { score: 0, label: "—", barClass: "bg-slate-200", textClass: "text-slate-400" };
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  score = Math.min(4, score);
  if (score <= 1)
    return { score, label: "Weak", barClass: "bg-rose-400", textClass: "text-rose-600 font-medium" };
  if (score === 2)
    return { score, label: "Fair", barClass: "bg-amber-400", textClass: "text-amber-700 font-medium" };
  if (score === 3)
    return { score, label: "Good", barClass: "bg-sky-500", textClass: "text-sky-700 font-medium" };
  return { score, label: "Strong", barClass: "bg-emerald-500", textClass: "text-emerald-700 font-medium" };
}

// ================================================================ success view
function RegistrationSuccess({
  email,
  message,
  licenseKey,
}: {
  email: string;
  message: string;
  licenseKey: string | null;
}) {
  const nav = useNavigate();
  const [copied, setCopied] = useState(false);
  function copyKey() {
    if (!licenseKey) return;
    navigator.clipboard
      ?.writeText(licenseKey)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  }
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-slate-50 flex items-center justify-center p-6">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(1200px_640px_at_50%_-8%,rgba(16,185,129,0.20),transparent_60%),radial-gradient(1000px_640px_at_50%_120%,rgba(46,124,200,0.15),transparent_60%),linear-gradient(180deg,#f4fbf7_0%,#eaf3f0_100%)]" />
        <div className="absolute -top-32 left-1/4 size-[28rem] rounded-full bg-emerald-400/25 blur-3xl animate-pulse [animation-duration:8s]" />
        <div className="absolute -bottom-32 right-1/4 size-[26rem] rounded-full bg-primary/20 blur-3xl animate-pulse [animation-duration:11s]" />
      </div>

      <div className="relative w-full max-w-md">
        <div
          className="absolute -inset-4 rounded-[26px] bg-gradient-to-br from-emerald-400/40 via-teal-400/30 to-primary/30 blur-2xl opacity-70"
          aria-hidden
        />
        <div
          className="absolute -inset-[2px] rounded-[22px]"
          style={{
            background:
              "linear-gradient(135deg, rgba(16,185,129,0.95) 0%, rgba(20,184,166,0.95) 50%, rgba(46,124,200,0.95) 100%)",
          }}
          aria-hidden
        />
        <div className="relative rounded-[20px] bg-white/95 backdrop-blur-xl shadow-[0_28px_80px_-30px_rgba(15,23,42,0.35)] overflow-hidden animate-fade-up">
          <div className="relative bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 text-white px-6 py-7 text-center overflow-hidden">
            <div className="absolute inset-0 opacity-[0.15]" style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
              backgroundSize: "18px 18px",
            }} />
            <div className="relative">
              <div className="relative mx-auto size-14">
                <div className="absolute inset-0 rounded-2xl bg-white/25 blur-lg" />
                <div className="relative size-14 rounded-2xl bg-white/20 ring-1 ring-white/50 flex items-center justify-center">
                  <CheckCircle2 className="size-7" />
                </div>
              </div>
              <h2 className="mt-4 text-[22px] font-semibold tracking-tight">
                You're all set
              </h2>
              <p className="text-[12.5px] text-white/90 mt-1">
                Account approved &middot; 100,000-token free trial active
              </p>
            </div>
          </div>
          <div className="p-6 space-y-4 text-sm text-slate-700">
            <p className="text-[13.5px] leading-relaxed">{message}</p>
            {licenseKey && (
              <div className="rounded-xl bg-indigo-50 ring-1 ring-indigo-200 px-3.5 py-3">
                <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-indigo-600">
                  <KeyRound className="size-3.5" /> Your license key
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="flex-1 font-mono text-[15px] font-semibold text-slate-900 tracking-wide select-all break-all">
                    {licenseKey}
                  </code>
                  <button
                    type="button"
                    onClick={copyKey}
                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white ring-1 ring-slate-200 text-[12px] font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="size-3.5 text-emerald-600" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5" /> Copy
                      </>
                    )}
                  </button>
                </div>
                <p className="mt-2 text-[11.5px] text-indigo-700/80 leading-relaxed">
                  Save this key now. Paste it when you sign in to activate your account.
                </p>
              </div>
            )}
            <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 px-3.5 py-2.5 text-[12.5px] text-slate-700">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
                Signed in email
              </div>
              <div className="mt-0.5 font-mono text-slate-900 truncate">
                {email}
              </div>
            </div>
            <p className="text-[12px] text-slate-500 leading-relaxed">
              Your account is approved &mdash; sign in now and paste your
              license key when prompted to start using BharathTax.
            </p>
            <button
              onClick={() => nav("/login", { replace: true })}
              className="group relative w-full h-11 rounded-xl overflow-hidden text-white font-semibold text-[14px] tracking-tight transition-all"
              style={{
                background:
                  "linear-gradient(135deg, rgba(46,124,200,1) 0%, rgba(37,99,235,1) 50%, rgba(99,102,241,1) 100%)",
                boxShadow:
                  "0 14px 34px -14px rgba(46,124,200,0.6), inset 0 1px 0 rgba(255,255,255,0.20)",
              }}
            >
              <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-white/12" />
              <span className="relative inline-flex items-center justify-center gap-1.5">
                Back to sign in <ArrowRight className="size-4" />
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

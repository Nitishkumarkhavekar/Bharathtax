import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Scale,
  ShieldCheck,
  Mail,
  Lock,
  Loader2,
  ArrowRight,
  Sparkles,
  Eye,
  EyeOff,
  CheckCircle2,
  Quote,
  BookOpen,
} from "lucide-react";
import { landingPath, useAuth } from "../auth";
import { ApiError } from "../api";

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
    <div className="relative min-h-screen w-full overflow-hidden bg-slate-50">
      {/* ============ Aurora canvas + subtle texture ============ */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(1200px_640px_at_88%_-8%,rgba(46,124,200,0.28),transparent_60%),radial-gradient(1000px_640px_at_-10%_110%,rgba(99,102,241,0.22),transparent_60%),radial-gradient(700px_500px_at_50%_130%,rgba(139,92,246,0.14),transparent_60%),linear-gradient(180deg,#f4f7fc_0%,#e7eefa_100%)]" />
        {/* Dot texture */}
        <div
          className="absolute inset-0 opacity-[0.055]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgb(15 23 42) 1px, transparent 0)",
            backgroundSize: "26px 26px",
          }}
        />
        {/* Slow-pulsing colour blobs */}
        <div className="absolute -top-32 -left-32 size-[32rem] rounded-full bg-primary/20 blur-3xl animate-pulse [animation-duration:8s]" />
        <div className="absolute -bottom-32 -right-32 size-[28rem] rounded-full bg-violet-500/25 blur-3xl animate-pulse [animation-duration:11s]" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 size-[20rem] rounded-full bg-sky-400/15 blur-3xl animate-pulse [animation-duration:14s]" />
      </div>

      <div className="relative min-h-screen w-full grid lg:grid-cols-[1.15fr_1fr] items-center gap-8 px-4 sm:px-8 lg:px-16 py-8">
        {/* ============================================ Hero / marketing panel */}
        <div className="hidden lg:flex flex-col justify-between max-w-2xl">
          {/* Header brand */}
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
              <Sparkles className="size-3.5" />
              Purpose-built for the Income-tax Department
            </span>
            <h2 className="text-[42px] xl:text-[52px] font-semibold tracking-[-0.02em] leading-[1.03] text-slate-900">
              Every claim{" "}
              <span className="relative inline-block">
                <span className="relative z-10 bg-gradient-to-r from-primary via-sky-500 to-violet-500 bg-clip-text text-transparent">
                  cited.
                </span>
                <span
                  className="absolute -bottom-1 left-0 right-0 h-2 rounded-full bg-gradient-to-r from-primary/40 via-sky-400/40 to-violet-500/40 blur-md -z-0"
                  aria-hidden
                />
              </span>
              <br />
              Every draft{" "}
              <span className="relative inline-block">
                <span className="relative z-10 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-primary bg-clip-text text-transparent">
                  auditable.
                </span>
                <span
                  className="absolute -bottom-1 left-0 right-0 h-2 rounded-full bg-gradient-to-r from-violet-500/40 via-fuchsia-400/40 to-primary/40 blur-md -z-0"
                  aria-hidden
                />
              </span>
            </h2>
            <p className="text-slate-600 text-[15.5px] leading-relaxed max-w-lg">
              Ask anything on the Income-tax Act, Rules or CBDT circulars. Get
              answers footnoted to the exact section — or run a six-module
              pipeline that drafts a fully-cited appellate order.
            </p>

            {/* Live-looking product preview mock */}
            <PreviewCard />
          </div>

          {/* Trust markers strip */}
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-slate-500">
            <TrustPill>Self-hosted</TrustPill>
            <TrustPill>Seat-licensed</TrustPill>
            <TrustPill>Audit-logged</TrustPill>
            <TrustPill>End-to-end encrypted</TrustPill>
          </div>
        </div>

        {/* ============================================ Sign-in card */}
        <div className="relative w-full max-w-md mx-auto lg:mx-0 lg:justify-self-end">
          {/* Static gradient border — a thin ring that hugs every edge of
              the card evenly. The card body sits on top and covers the
              interior; only ~2 px of coloured ring shows. */}
          <div
            className="absolute -inset-[2px] rounded-[22px]"
            style={{
              background:
                "linear-gradient(135deg, rgba(46,124,200,0.95) 0%, rgba(99,102,241,0.95) 50%, rgba(139,92,246,0.95) 100%)",
            }}
            aria-hidden
          />
          {/* Halo behind the card */}
          <div
            className="absolute -inset-4 rounded-[26px] bg-gradient-to-br from-primary/30 via-sky-400/25 to-violet-500/30 blur-2xl opacity-70"
            aria-hidden
          />

          <div className="relative rounded-[20px] bg-white/95 backdrop-blur-xl shadow-[0_28px_80px_-30px_rgba(15,23,42,0.35)] overflow-hidden">
            {/* Top accent stripe */}
            <div className="relative h-1 overflow-hidden bg-slate-100">
              <div
                className="absolute inset-y-0 w-full bg-gradient-to-r from-primary via-sky-500 to-violet-500"
                aria-hidden
              />
            </div>

            <form onSubmit={submit} className="p-7 sm:p-8 space-y-5">
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
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 ring-1 ring-emerald-200 text-emerald-700 text-[10.5px] font-semibold">
                  <span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.20)]" />
                  All systems operational
                </div>
                <h1 className="text-[28px] font-semibold tracking-tight text-slate-900 leading-tight">
                  Welcome back
                </h1>
                <p className="text-[13.5px] text-slate-500">
                  Sign in with your official email and password.
                </p>
              </div>

              <Field
                label="Email"
                htmlFor="email"
                icon={<Mail className="size-4" />}
              >
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@bharathtax.com"
                  autoFocus
                  required
                  className="peer w-full h-11 rounded-xl border border-slate-200 bg-white/80 pl-10 pr-3 text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-shadow"
                />
              </Field>

              <Field
                label="Password"
                htmlFor="p"
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
                  id="p"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="peer w-full h-11 rounded-xl border border-slate-200 bg-white/80 pl-10 pr-10 text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-shadow"
                />
              </Field>

              {error && (
                <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 animate-fade-up">
                  {error}
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
                      <Loader2 className="size-4 animate-spin" /> Signing in…
                    </>
                  ) : (
                    <>
                      Sign in <ArrowRight className="size-4" />
                    </>
                  )}
                </span>
              </button>

              <div className="text-center text-[13px] text-slate-600">
                New to BharathTax?{" "}
                <Link
                  to="/register"
                  className="font-semibold text-primary hover:underline"
                >
                  Request an account
                </Link>
              </div>

              <div className="pt-3 mt-1 border-t border-slate-200/80 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                <ShieldCheck className="size-3.5 text-emerald-500" />
                Secured with per-officer seat leases and full audit logging
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
}: {
  label: string;
  htmlFor: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-slate-600"
      >
        {label}
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

/** Product-preview mock — a mini chat card showing a real Q&A with a
 *  citation chip. Sells the product visually far better than static bullets. */
function PreviewCard() {
  return (
    <div className="relative">
      {/* Soft primary halo behind the card */}
      <div
        className="absolute -inset-3 rounded-3xl bg-gradient-to-br from-primary/15 via-sky-400/15 to-violet-500/15 blur-xl"
        aria-hidden
      />
      <div className="relative rounded-2xl bg-white ring-1 ring-slate-200 shadow-[0_20px_50px_-24px_rgba(15,23,42,0.25)] overflow-hidden">
        {/* Window chrome */}
        <div className="flex items-center gap-1.5 px-3.5 py-2.5 border-b border-slate-200 bg-slate-50/70">
          <span className="size-2.5 rounded-full bg-rose-400/70" />
          <span className="size-2.5 rounded-full bg-amber-400/70" />
          <span className="size-2.5 rounded-full bg-emerald-400/70" />
          <span className="ml-2 text-[10.5px] text-slate-500 font-medium">
            bharathtax — Chat
          </span>
          <span className="ml-auto text-[10.5px] text-slate-400">
            citation-grounded
          </span>
        </div>

        <div className="p-4 space-y-3">
          {/* User bubble */}
          <div className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-3.5 py-2 text-[13px] shadow-sm">
              What is the maximum deduction under section 80C?
            </div>
          </div>

          {/* Assistant bubble */}
          <div className="flex gap-2">
            <div className="shrink-0 size-7 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white flex items-center justify-center text-[10px] font-semibold ring-1 ring-white">
              BT
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="rounded-2xl bg-slate-50 ring-1 ring-slate-200 px-3.5 py-2.5 text-[13px] text-slate-800 leading-relaxed">
                The maximum aggregate deduction under section 80C is{" "}
                <b className="font-semibold text-slate-900">Rs 1,50,000</b>
                <span className="inline-flex items-center justify-center min-w-[1.4rem] h-5 px-1.5 ml-1 rounded-full bg-primary/10 text-primary text-[0.72rem] font-semibold align-middle">
                  1
                </span>{" "}
                per financial year, covering LIC, EPF, PPF, ELSS and specified
                other instruments.
              </div>
              {/* Citation card */}
              <div className="flex items-center gap-2 rounded-xl bg-white ring-1 ring-slate-200 px-3 py-2 text-[11.5px]">
                <span className="inline-flex items-center justify-center min-w-[1.4rem] h-5 px-1.5 rounded-full bg-primary/10 text-primary text-[0.72rem] font-semibold">
                  1
                </span>
                <BookOpen className="size-3.5 text-primary shrink-0" />
                <span className="text-slate-800 font-medium truncate">
                  Income-tax Act 1961 · s.80C(1)
                </span>
                <span className="ml-auto text-primary underline underline-offset-2 shrink-0">
                  source
                </span>
              </div>
              {/* Quiet quote/attribution row */}
              <div className="flex items-center gap-1.5 text-[10.5px] text-slate-400 pl-1">
                <Quote className="size-3" />
                Grounded in primary law · Refuses when the corpus can't support the answer
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { api, ApiError, setJwt } from "../api";
import logoUrl from "../assets/income_tax_logo.png";

interface Props {
  onLoggedIn: () => void;
}

// Split-screen sign-in.  Left half is a navy brand panel with the Income-Tax
// seal on a rounded medallion and a short tagline — the equivalent of the
// Government of India letterhead you'd expect on an official portal.  Right
// half is a compact, focused sign-in form.  Full-viewport gradient background
// so the app feels like a proper application from first launch, not a form
// popped out of nowhere.
export default function LoginScreen({ onLoggedIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!email.trim() || !password) {
      setErr("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.login(email.trim(), password);
      await setJwt(r.access_token, r.expires_at);
      onLoggedIn();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setErr(msg || "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-100">
      {/* ------------- Brand panel (navy) ------------- */}
      <aside className="relative hidden md:flex md:w-[46%] lg:w-[42%] xl:w-[38%] shrink-0 flex-col justify-between overflow-hidden bg-gradient-to-br from-navy-900 via-navy-800 to-navy-700 text-white p-10 xl:p-14">
        {/* Decorative background flourishes */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]"
             style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "24px 24px" }} />
        <div className="pointer-events-none absolute -top-24 -left-24 size-96 rounded-full bg-ashoka-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-16 size-[28rem] rounded-full bg-white/5 blur-3xl" />

        <div className="relative flex items-center gap-3.5">
          <div className="size-16 rounded-full bg-white p-1.5 shadow-lg ring-2 ring-white/25">
            <img src={logoUrl} alt="Income Tax Department" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="text-[14px] uppercase tracking-[0.18em] text-white/80 font-semibold">Government of India</div>
            <div className="text-[20px] font-semibold leading-tight mt-1">Income Tax Department</div>
          </div>
        </div>

        <div className="relative">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/10 ring-1 ring-white/20 px-3 py-1 text-[12.5px] font-semibold tracking-wide">
            <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
            CIT(A) · NFAC appeal drafting
          </div>
          <h1 className="text-4xl xl:text-[42px] font-semibold tracking-tight leading-[1.1]">
            BharatTax<br />Appeal&nbsp;Order
          </h1>
          <p className="mt-4 text-[16.5px] text-white/80 leading-relaxed max-w-md">
            Upload the appeal file, run the six-module pipeline, and produce a
            draft appellate order grounded in the Act, Rules and case law.
          </p>

          <ul className="mt-8 space-y-3 text-[15px] text-white/90">
            <Bullet>Citation-grounded answers from the primary tax corpus</Bullet>
            <Bullet>Modify with AI — rewrite any passage in place</Bullet>
            <Bullet>Preview, download and open drafts directly in Word</Bullet>
          </ul>
        </div>

        <div className="relative text-[12.5px] text-white/60">
          Secure — your license and token balance stay on the server. Nothing
          sensitive is stored on this device.
        </div>
      </aside>

      {/* ------------- Sign-in form (right side) ------------- */}
      <main className="flex-1 grid place-items-center p-6">
        <form
          onSubmit={submit}
          className="w-full max-w-md bg-white rounded-2xl shadow-xl shadow-navy-900/10 border border-slate-200 p-8"
        >
          {/* Compact brand chip — repeats the identity on the form side for
              devices that hide the brand panel (< md). */}
          <div className="md:hidden flex items-center gap-3 mb-6">
            <div className="size-12 rounded-full bg-navy-50 p-1.5 ring-1 ring-navy-100">
              <img src={logoUrl} alt="Income Tax Department" className="w-full h-full object-contain" />
            </div>
            <div>
              <div className="text-[12px] uppercase tracking-[0.16em] text-navy-700 font-semibold">Income Tax Department</div>
              <div className="text-[16.5px] font-semibold text-slate-900 leading-tight">BharatTax Appeal Order</div>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-[24px] font-semibold text-slate-900 tracking-tight">Sign in</h2>
            <p className="text-[14.5px] text-slate-500 mt-1.5">
              Use your BharatTax account to continue.
            </p>
          </div>

          <label className="block text-[12.5px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-1.5">
            Email
          </label>
          <div className="relative mb-4">
            <IconMail />
            <input
              type="email"
              autoComplete="username"
              className="w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg text-[15.5px] focus:outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-500/20 disabled:opacity-60"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="officer@example.gov.in"
              disabled={busy}
              autoFocus
            />
          </div>

          <label className="block text-[12.5px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-1.5">
            Password
          </label>
          <div className="relative mb-5">
            <IconLock />
            <input
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              className="w-full pl-10 pr-11 py-2.5 border border-slate-300 rounded-lg text-[15.5px] focus:outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-500/20 disabled:opacity-60"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={busy}
            />
            <button type="button" onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              title={showPw ? "Hide password" : "Show password"} aria-label={showPw ? "Hide password" : "Show password"}>
              {showPw ? <IconEyeOff /> : <IconEye />}
            </button>
          </div>

          {err && (
            <div className="text-[14.5px] text-ashoka-700 bg-ashoka-50 border border-ashoka-200 rounded-lg px-3 py-2 mb-4 flex items-start gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              <span>{err}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full h-11 rounded-lg bg-navy-800 text-white font-semibold tracking-wide hover:bg-navy-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><circle cx="12" cy="12" r="10" opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
                Signing in…
              </>
            ) : (
              <>Sign in <IconArrowRight /></>
            )}
          </button>

          <div className="mt-4 text-center">
            <a
              href="https://bharattax.wenvia.global/forgot-password"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13.5px] text-navy-700 hover:text-navy-900 font-medium"
            >
              Forgot your password?
            </a>
          </div>

          <p className="text-[13.5px] text-slate-500 mt-4 text-center">
            No account? Ask your administrator to register you on the BharatTax web portal.
          </p>
        </form>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-1 shrink-0 grid place-items-center size-4 rounded-full bg-emerald-500/20 ring-1 ring-emerald-400/30">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-300"><path d="M20 6 9 17l-5-5"/></svg>
      </span>
      <span>{children}</span>
    </li>
  );
}

function IconMail() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>; }
function IconLock() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>; }
function IconEye()  { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z"/><circle cx="12" cy="12" r="3"/></svg>; }
function IconEyeOff(){ return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 3 18 18"/><path d="M10.6 6.4a10 10 0 0 1 11.4 5.6c-.5 1.1-1.3 2.4-2.4 3.5"/><path d="M6.6 6.6C4.1 8 2 12 2 12s3 8 10 8c1.5 0 2.9-.3 4.1-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>; }
function IconArrowRight() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>; }

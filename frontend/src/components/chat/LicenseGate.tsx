// Forced-flow license gate for non-admin users.
//
// On mount, calls /auth/license/status. If the backend says the user needs a
// license and doesn't have one, we render a non-dismissable activation card
// over the rest of the page. The chat (`children`) only mounts once the user
// is licensed.
//
// Admins are exempt — the backend `required: false` short-circuits this gate
// before any UI shows up.

import { useEffect, useState } from "react";
import {
  KeyRound,
  Sparkles,
  ShieldCheck,
  Loader2,
  AlertCircle,
  LogOut,
  CheckCircle2,
  Copy,
} from "lucide-react";
import { ApiError, LicenseStatus, api } from "@/api";
import { toast } from "@/lib/toast";
import { useAuth } from "@/auth";
import { Button } from "@/components/ui/button";

interface LicenseGateProps {
  children: React.ReactNode;
}

export default function LicenseGate({ children }: LicenseGateProps) {
  const { session, logout } = useAuth();
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [justActivated, setJustActivated] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  function copyKey() {
    const k = status?.pending_key;
    if (!k) return;
    navigator.clipboard
      ?.writeText(k)
      .then(() => {
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 1500);
      })
      .catch(() => {});
  }

  useEffect(() => {
    api
      .licenseStatus()
      .then((s) => {
        setStatus(s);
        if (s.pending_key) setKey(s.pending_key);
      })
      .catch(() => setStatus({
        required: true,
        licensed: false,
        license_key: null,
        pending_key: null,
        assigned_to: null,
        valid_until: null,
        message: "Could not verify your license. Please enter a key to continue.",
      }))
      .finally(() => setLoading(false));
  }, []);

  async function activate() {
    setErr(null);
    setActivating(true);
    try {
      const normalized = key.trim().toUpperCase().replace(/\s+/g, "");
      const s = await api.activateLicense(normalized);
      setStatus(s);
      toast.success("License activated \u2014 welcome to BharathTax!");
      setJustActivated(true);
      // Brief success flash, then mount the chat.
      setTimeout(() => setJustActivated(false), 1200);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Activation failed");
    } finally {
      setActivating(false);
    }
  }

  // While we're still checking, render a quiet full-page loader. Avoid showing
  // the chat (and the suggestion chips) just to immediately occlude them.
  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center chat-bg">
        <div className="inline-flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" /> Verifying your license…
        </div>
      </div>
    );
  }

  const needsLicense = status?.required && !status?.licensed;

  if (!needsLicense) {
    return <>{children}</>;
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center p-4 chat-bg overflow-hidden">
      <div className="relative w-full max-w-md animate-fade-up">
        <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-br from-primary/20 via-sky-200/30 to-violet-200/30 blur-2xl opacity-60 pointer-events-none" />
        <div className="rounded-2xl overflow-hidden bg-white shadow-2xl ring-1 ring-slate-200">
          {/* Gradient header */}
          <div className="relative overflow-hidden bg-gradient-to-br from-[#0b1d36] via-[#13325b] to-[#1c4a85] text-white px-6 py-6">
            <div className="absolute inset-0 opacity-50 pointer-events-none" aria-hidden>
              <div className="absolute -top-16 -right-10 size-44 rounded-full bg-sky-400/30 blur-3xl" />
              <div className="absolute -bottom-20 -left-10 size-44 rounded-full bg-violet-400/20 blur-3xl" />
            </div>
            <div className="relative flex items-start gap-3">
              <div className="size-12 rounded-2xl bg-white/15 ring-1 ring-white/25 flex items-center justify-center">
                <KeyRound className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/15 backdrop-blur text-[10.5px] font-semibold ring-1 ring-white/20">
                  <Sparkles className="size-3" /> Activate your account
                </div>
                <h1 className="mt-1.5 text-xl font-semibold tracking-tight">
                  Welcome, {session?.username ?? "user"}.
                </h1>
                <p className="text-[12.5px] text-white/90 mt-0.5 leading-snug">
                  Enter the BharathTax license key your administrator shared
                  with you to start using the assistant.
                </p>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-4">
            {/* Success state */}
            {justActivated ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 px-4 py-3 flex items-center gap-2.5">
                <CheckCircle2 className="size-5 text-emerald-600" />
                <div className="text-sm font-medium">
                  License activated — opening BharathTax…
                </div>
              </div>
            ) : (
              <>
                {status?.pending_key && (
                  <div className="rounded-xl bg-indigo-50 ring-1 ring-indigo-200 px-3.5 py-3">
                    <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-indigo-600">
                      <Sparkles className="size-3.5" /> Your license key
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <code className="flex-1 font-mono text-[14px] font-semibold text-slate-900 tracking-wide select-all break-all">
                        {status.pending_key}
                      </code>
                      <button
                        type="button"
                        onClick={copyKey}
                        className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white ring-1 ring-slate-200 text-[12px] font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        {copiedKey ? (
                          <>
                            <CheckCircle2 className="size-3.5 text-emerald-600" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="size-3.5" /> Copy
                          </>
                        )}
                      </button>
                    </div>
                    <p className="mt-1.5 text-[11px] text-indigo-700/80">
                      It's already filled in below — just click Activate.
                    </p>
                  </div>
                )}
                <div>
                  <label className="text-[12.5px] font-semibold text-slate-800 flex items-center gap-1 mb-1.5">
                    License key <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none" />
                    <input
                      value={key}
                      onChange={(e) => setKey(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") activate();
                      }}
                      autoFocus
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="BHTX-XXXX-XXXX-XXXX-XXXX"
                      className="w-full h-11 rounded-lg border border-slate-200 bg-white shadow-sm pl-10 pr-3 font-mono tracking-wider text-[14px] text-slate-900 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 placeholder:text-slate-300"
                    />
                  </div>
                  {status?.pending_key ? (
                    <div className="mt-2 text-[11px] text-primary leading-snug flex items-start gap-1.5">
                      <Sparkles className="size-3.5 shrink-0 mt-0.5" />
                      Your trial license key is filled in for you — just click
                      &ldquo;Activate&rdquo; to start.
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px] text-slate-600 leading-snug flex items-start gap-1.5">
                      <ShieldCheck className="size-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      The key links this account to a licensed seat. It's
                      case-insensitive — paste it as-is.
                    </div>
                  )}
                </div>

                {err && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-sm font-medium px-3.5 py-2.5 flex items-start gap-2">
                    <AlertCircle className="size-4 mt-0.5 shrink-0" />
                    <span>{err}</span>
                  </div>
                )}

                {status?.message && !err && (
                  <div className="text-[12px] text-slate-600 italic">
                    {status.message}
                  </div>
                )}

                <Button
                  className="w-full h-11 text-[14px]"
                  onClick={activate}
                  disabled={activating || !key.trim()}
                >
                  {activating ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Activating…
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" /> Activate license
                    </>
                  )}
                </Button>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between gap-2 text-[11.5px] text-slate-600">
            <span>
              Don't have a key? Contact your administrator.
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex items-center gap-1 font-medium text-slate-700 hover:text-slate-900"
            >
              <LogOut className="size-3.5" /> Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

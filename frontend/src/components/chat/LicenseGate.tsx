// License gate for non-admin users.
//
// On mount, calls /auth/license/status. If the backend says the user isn't
// currently licensed we render a full-page "your license is not active" panel
// pointing them at their administrator -- users no longer activate keys
// themselves, that's an admin operation from the console.
//
// Admins are exempt: the backend returns `required: false` and the chat
// children mount directly.

import { useEffect, useState } from "react";
import {
  ShieldAlert,
  Loader2,
  LogOut,
  Mail,
} from "lucide-react";
import { LicenseStatus, api } from "@/api";
import { useAuth } from "@/auth";

interface LicenseGateProps {
  children: React.ReactNode;
}

export default function LicenseGate({ children }: LicenseGateProps) {
  const { session, logout } = useAuth();
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .licenseStatus()
      .then(setStatus)
      .catch(() =>
        setStatus({
          required: true,
          licensed: false,
          license_key: null,
          pending_key: null,
          assigned_to: null,
          valid_until: null,
          message:
            "Could not verify your license. Please contact your administrator.",
        }),
      )
      .finally(() => setLoading(false));
  }, []);

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
        <div className="absolute -inset-4 -z-10 rounded-3xl bg-amber-300/25 blur-2xl opacity-60 pointer-events-none" />
        <div className="rounded-2xl overflow-hidden bg-white shadow-2xl ring-1 ring-slate-200">
          <div className="relative overflow-hidden bg-amber-800 text-white px-6 py-6">
            <div className="absolute inset-0 opacity-50 pointer-events-none" aria-hidden>
              <div className="absolute -top-16 -right-10 size-44 rounded-full bg-amber-400/30 blur-3xl" />
              <div className="absolute -bottom-20 -left-10 size-44 rounded-full bg-rose-400/20 blur-3xl" />
            </div>
            <div className="relative flex items-start gap-3">
              <div className="size-12 rounded-2xl bg-white/15 ring-1 ring-white/25 flex items-center justify-center">
                <ShieldAlert className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/15 backdrop-blur text-[10.5px] font-semibold ring-1 ring-white/20">
                  License required
                </div>
                <h1 className="mt-1.5 text-xl font-semibold tracking-tight">
                  Hi {session?.username ?? "there"}, your license isn't active.
                </h1>
                <p className="text-[12.5px] text-white/90 mt-0.5 leading-snug">
                  Your BharatTax account needs an active license before you can
                  use this section. Licenses are assigned by your organisation's
                  administrator.
                </p>
              </div>
            </div>
          </div>

          <div className="px-6 py-5 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[12.5px] text-slate-700 leading-relaxed">
              <div className="font-semibold text-slate-800 mb-1 flex items-center gap-1.5">
                <Mail className="size-3.5" /> What to do next
              </div>
              Please reach out to your administrator and ask them to assign a
              license to your account. Once they do, refresh this page and you'll
              be able to continue.
              {status?.message && (
                <div className="mt-2 text-[11.5px] text-slate-500 italic">
                  {status.message}
                </div>
              )}
            </div>
          </div>

          <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between gap-2 text-[11.5px] text-slate-600">
            <span>Signed in as {session?.username ?? "user"}.</span>
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

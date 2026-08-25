import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Compass, X } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { toast } from "@/lib/toast";

const DISMISS_KEY = "bt_wp_prompt_dismissed_v1";

// One-time first-run prompt: when an authenticated non-admin user has no
// workspace profile yet, ask which function they primarily work so the
// dashboard and sidebar can tailor to it. Dismissable for the session; also
// changeable anytime in Profile.
export default function WorkspaceProfilePrompt() {
  const { session, setWorkspaceProfile } = useAuth();
  const [options, setOptions] = useState<{ key: string; label: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });

  const isAdmin = !!session && ["super_admin", "wing_admin"].includes(session.role);
  const show = !!session && !isAdmin && !session.workspaceProfile && !dismissed;

  useEffect(() => {
    if (show && options.length === 0) api.workspaceProfiles().then(setOptions).catch(() => {});
  }, [show, options.length]);

  if (!show) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* */ }
    setDismissed(true);
  };

  const pick = async (key: string) => {
    setBusy(key);
    try {
      const updated = await api.updateProfile({ workspace_profile: key });
      setWorkspaceProfile(updated.workspace_profile ?? key);
      toast.success("Workspace tailored to your function.");
    } catch (e: any) {
      toast.error(e?.message || "Could not save. You can set it later in Profile.");
    } finally {
      setBusy(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 overflow-hidden">
        <div className="relative px-6 pt-6 pb-4 bg-primary text-white">
          <button onClick={dismiss} aria-label="Skip" className="absolute right-3 top-3 p-1.5 rounded-md text-white/80 hover:bg-white/15">
            <X className="size-4" />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="size-10 rounded-xl bg-white/15 ring-1 ring-white/25 flex items-center justify-center"><Compass className="size-5" /></div>
            <div>
              <h2 className="text-[17px] font-bold leading-tight">What do you mainly work on?</h2>
              <p className="text-white/85 text-[12.5px] mt-0.5">We'll tailor your dashboard and sidebar to it. Everything stays reachable, and you can change this anytime in Profile.</p>
            </div>
          </div>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {options.map((o) => (
              <button
                key={o.key}
                onClick={() => pick(o.key)}
                disabled={!!busy}
                className="relative rounded-xl ring-1 ring-slate-200 hover:ring-primary hover:bg-primary/[0.04] px-3 py-3 text-left text-[12.5px] font-semibold text-slate-800 transition-colors disabled:opacity-60"
              >
                {busy === o.key ? <Loader2 className="size-4 animate-spin text-primary" /> : o.label}
              </button>
            ))}
          </div>
          <button onClick={dismiss} className="mt-4 w-full text-center text-[12.5px] font-medium text-slate-500 hover:text-slate-800">
            Skip for now
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

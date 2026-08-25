import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Compass, X, Check } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "bt_wp_prompt_dismissed_v1";

// One-time first-run prompt: when an authenticated non-admin user has no
// workspace profile yet, ask which function(s) they work so the dashboard and
// sidebar tailor to it. Options: a single function, Custom (several), or
// "Show everything". Dismissable for the session; changeable in Profile.
export default function WorkspaceProfilePrompt() {
  const { session, setWorkspaceProfile } = useAuth();
  const [options, setOptions] = useState<{ key: string; label: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<"pick" | "custom">("pick");
  const [chosen, setChosen] = useState<string[]>([]);
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

  const save = async (profile: string, wings: string[] | null, tag: string) => {
    setBusy(tag);
    try {
      const updated = await api.updateProfile({ workspace_profile: profile, workspace_wings: profile === "custom" ? wings : null });
      setWorkspaceProfile(updated.workspace_profile ?? profile, updated.workspace_wings ?? null);
      toast.success(profile === "all" ? "Showing everything." : "Workspace tailored to your work.");
    } catch (e: any) {
      toast.error(e?.message || "Could not save. You can set it later in Profile.");
    } finally {
      setBusy(null);
    }
  };

  const toggle = (k: string) => setChosen((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

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
          {mode === "pick" ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {options.map((o) => (
                  <button key={o.key} onClick={() => save(o.key, null, o.key)} disabled={!!busy}
                    className="relative rounded-xl ring-1 ring-slate-200 hover:ring-primary hover:bg-primary/[0.04] px-3 py-3 text-left text-[12.5px] font-semibold text-slate-800 transition-colors disabled:opacity-60">
                    {busy === o.key ? <Loader2 className="size-4 animate-spin text-primary" /> : o.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button onClick={() => setMode("custom")} disabled={!!busy}
                  className="flex-1 rounded-lg ring-1 ring-slate-300 px-3 py-2 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                  I work across several…
                </button>
                <button onClick={() => save("all", null, "all")} disabled={!!busy}
                  className="flex-1 rounded-lg ring-1 ring-slate-300 px-3 py-2 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                  {busy === "all" ? <Loader2 className="size-4 animate-spin mx-auto" /> : "Show everything"}
                </button>
              </div>
              <button onClick={dismiss} className="mt-3 w-full text-center text-[12px] font-medium text-slate-400 hover:text-slate-700">Skip for now</button>
            </>
          ) : (
            <>
              <div className="text-[12px] text-slate-500 mb-2">Pick the functions you work — your dashboard and sidebar will cover all of them.</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {options.map((o) => (
                  <button key={o.key} onClick={() => toggle(o.key)}
                    className={cn("relative rounded-xl ring-1 px-3 py-3 text-left text-[12.5px] font-semibold transition-colors",
                      chosen.includes(o.key) ? "bg-primary text-white ring-primary" : "ring-slate-200 text-slate-800 hover:ring-primary/40")}>
                    {chosen.includes(o.key) && <Check className="absolute right-2 top-2 size-3.5" />}
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button onClick={() => setMode("pick")} className="rounded-lg px-3 py-2 text-[12.5px] font-semibold text-slate-500 hover:text-slate-800">Back</button>
                <button onClick={() => save("custom", chosen, "custom")} disabled={!!busy || chosen.length === 0}
                  className="ml-auto rounded-lg bg-primary text-white px-4 py-2 text-[12.5px] font-semibold hover:bg-primary/90 disabled:opacity-50">
                  {busy === "custom" ? <Loader2 className="size-4 animate-spin" /> : `Use ${chosen.length || ""} selected`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

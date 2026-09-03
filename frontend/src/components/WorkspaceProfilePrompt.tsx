import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X, Check, IdCard, Building2, ArrowRight } from "lucide-react";
import { api, TaxonomyDesignation } from "../api";
import { useAuth } from "../auth";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "bt_wp_prompt_dismissed_v1";
const CADRE_LABEL: Record<string, string> = {
  irs: "IRS · Gazetted", executive: "Field · Executive", ministerial: "Ministerial",
  admin: "Administrative", steno: "Stenographer · PS",
};
const CADRE_ORDER = ["irs", "executive", "admin", "ministerial", "steno"];

// First-run set-up wizard. A new (non-admin) officer with no workspace profile
// yet is walked through TWO steps — (1) their designation/rank, then (2) their
// department/function — so the dashboard, drafting engines, case-law sections
// and approvals tailor to who they are before the welcome tour runs. Both are
// changeable later in Profile; `onComplete` (fired on finish OR skip) lets the
// shell start the tour afterwards.
export default function WorkspaceProfilePrompt({ onComplete }: { onComplete?: () => void }) {
  const { session, setWorkspaceProfile } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [designations, setDesignations] = useState<TaxonomyDesignation[]>([]);
  const [desig, setDesig] = useState<string>("");
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
    if (!show) return;
    if (designations.length === 0) api.departmentTaxonomy().then((t) => setDesignations(t.designations)).catch(() => {});
    if (options.length === 0) api.workspaceProfiles().then(setOptions).catch(() => {});
  }, [show, designations.length, options.length]);

  const byCadre = useMemo(() => {
    const m = new Map<string, TaxonomyDesignation[]>();
    for (const d of designations) { if (!m.has(d.cadre)) m.set(d.cadre, []); m.get(d.cadre)!.push(d); }
    const known = CADRE_ORDER.filter((c) => m.has(c)).map((c) => [c, m.get(c)!] as const);
    const rest = [...m.keys()].filter((c) => !CADRE_ORDER.includes(c)).map((c) => [c, m.get(c)!] as const);
    return [...known, ...rest];
  }, [designations]);

  if (!show) return null;

  const finish = () => {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* */ }
    setDismissed(true);
    onComplete?.();
  };

  const save = async (profile: string, wings: string[] | null, tag: string) => {
    setBusy(tag);
    try {
      const updated = await api.updateProfile({
        workspace_profile: profile,
        workspace_wings: profile === "custom" ? wings : null,
        ...(desig ? { designation: desig } : {}),
      });
      setWorkspaceProfile(updated.workspace_profile ?? profile, updated.workspace_wings ?? null, desig || undefined);
      toast.success(profile === "all" ? "Showing everything — your desk is ready." : "Your desk is set up for your work.");
      finish();
    } catch (e: any) {
      toast.error(e?.message || "Could not save. You can set this later in Profile.");
    } finally { setBusy(null); }
  };

  const toggle = (k: string) => setChosen((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
  const selDesigLabel = designations.find((d) => d.key === desig)?.label;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/55 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 overflow-hidden">
        <div className="relative px-6 pt-6 pb-4 bg-primary text-white">
          <button onClick={finish} aria-label="Skip" className="absolute right-3 top-3 p-1.5 rounded-md text-white/80 hover:bg-white/15">
            <X className="size-4" />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="size-10 rounded-xl bg-white/15 ring-1 ring-white/25 flex items-center justify-center">
              {step === 1 ? <IdCard className="size-5" /> : <Building2 className="size-5" />}
            </div>
            <div>
              <div className="text-white/70 text-[11px] font-semibold uppercase tracking-[0.08em]">Step {step} of 2 · set up your desk</div>
              <h2 className="text-[17px] font-bold leading-tight">
                {step === 1 ? "What's your designation?" : "Which department do you work in?"}
              </h2>
              <p className="text-white/85 text-[12.5px] mt-0.5">
                {step === 1
                  ? "So your templates, approvals and tools fit your role."
                  : "Your dashboard, drafting and case law tailor to it. Everything stays reachable — change it anytime in Profile."}
              </p>
            </div>
          </div>
        </div>

        <div className="p-5">
          {step === 1 ? (
            <>
              <div className="max-h-[46vh] overflow-y-auto pr-1 space-y-3">
                {byCadre.map(([cadre, list]) => (
                  <div key={cadre}>
                    <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400 mb-1.5">{CADRE_LABEL[cadre] ?? cadre}</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {list.map((d) => (
                        <button key={d.key} onClick={() => setDesig(d.key)}
                          className={cn("relative rounded-lg ring-1 px-2.5 py-2 text-left text-[12px] font-semibold transition-colors",
                            desig === d.key ? "bg-primary text-white ring-primary" : "ring-slate-200 text-slate-800 hover:ring-primary/40")}>
                          {desig === d.key && <Check className="absolute right-1.5 top-1.5 size-3" />}
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {designations.length === 0 && (
                  <div className="py-8 text-center text-slate-400"><Loader2 className="size-4 animate-spin mx-auto" /></div>
                )}
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button onClick={finish} className="text-[12px] font-medium text-slate-400 hover:text-slate-700">Skip</button>
                <button onClick={() => setStep(2)}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary text-white px-4 py-2 text-[12.5px] font-semibold hover:bg-primary/90">
                  Continue <ArrowRight className="size-3.5" />
                </button>
              </div>
            </>
          ) : mode === "pick" ? (
            <>
              {selDesigLabel && (
                <div className="mb-3 text-[12px] text-slate-500">Setting up for <b className="text-slate-800">{selDesigLabel}</b>.</div>
              )}
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
              <div className="mt-3 flex items-center">
                <button onClick={() => setStep(1)} className="text-[12px] font-medium text-slate-400 hover:text-slate-700">Back</button>
                <button onClick={finish} className="ml-auto text-[12px] font-medium text-slate-400 hover:text-slate-700">Skip for now</button>
              </div>
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

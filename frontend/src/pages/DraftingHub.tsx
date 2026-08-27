import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Stamp, Gavel, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "../auth";
import Assessments from "./Assessments";
import Appeals from "./Appeals";
import DraftingPage from "./Drafting";
import PageHelp from "@/components/PageHelp";

// The unified "Drafting" hub. Every kind of drafting an officer does —
// assessment orders, appellate orders, and notices — lives here under one item,
// switched by a slim tab bar. Each tab mounts the existing engine unchanged;
// the tabs simply replace the three separate sidebar entries.
type TabKey = "assessments" | "appeals" | "notices";

interface Tab { key: TabKey; label: string; icon: typeof Stamp; feature?: string; }

const TABS: Tab[] = [
  { key: "assessments", label: "Assessment orders", icon: Stamp, feature: "appeals" },
  { key: "appeals", label: "Appeal orders", icon: Gavel, feature: "appeals" },
  { key: "notices", label: "Notices & orders", icon: ScrollText },
];

// The tab an officer lands on by default — their own function's drafting.
function defaultTab(profile: string | null | undefined, wings: string[] | null | undefined, allowAppeals: boolean): TabKey {
  const fns = new Set([profile ?? "", ...(wings ?? [])]);
  if (allowAppeals) {
    if (fns.has("cita") || fns.has("drp")) return "appeals";
    if (fns.has("officer")) return "assessments";
  }
  return allowAppeals ? "assessments" : "notices";
}

export default function DraftingHub() {
  const { tab } = useParams<{ tab?: string }>();
  const nav = useNavigate();
  const { session } = useAuth();

  const feats = session?.features ?? null; // null = all modules allotted
  const allowAppeals = !feats || feats.includes("appeals");
  const visible = TABS.filter((t) => !t.feature || allowAppeals);

  const fallback = defaultTab(session?.workspaceProfile, session?.workspaceWings, allowAppeals);
  const active = (visible.find((t) => t.key === tab)?.key ?? fallback) as TabKey;

  // Normalise the URL so it always names a valid, allowed tab.
  useEffect(() => {
    if (tab !== active) nav(`/drafting/${active}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, active]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="size-11 rounded-xl bg-brand-green/15 text-brand-green flex items-center justify-center shrink-0">
          <ScrollText className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 leading-tight">Drafting</h1>
          <p className="text-[13px] text-slate-500">Assessment &amp; appellate orders and notices — every draft in one place.</p>
        </div>
        <PageHelp id="drafting" className="ml-auto shrink-0" />
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 w-fit">
        {visible.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => nav(`/drafting/${t.key}`)}
              className={cn("inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[13px] font-semibold transition-colors",
                active === t.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
              <Icon className="size-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {active === "assessments" ? <Assessments />
        : active === "appeals" ? <Appeals />
        : <DraftingPage />}
    </div>
  );
}

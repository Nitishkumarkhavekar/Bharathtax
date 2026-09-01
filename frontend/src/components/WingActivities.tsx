import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, ArrowRight } from "lucide-react";
import { api, TaxonomyWing } from "../api";
import { useAuth } from "../auth";

const TOOL_LABEL: Record<string, string> = {
  "/drafting": "Drafting",
  "/calculators": "Calculators",
  "/rulings": "Case law",
  "/reconcile": "Reconcile",
  "/workspace": "Calendar",
  "/templates": "Templates",
};

/**
 * Phase 2 — the config-driven "your daily work" surface. Reads the officer's
 * wing from their profile and renders that wing's real day-to-day activities
 * (from the canonical department taxonomy) with quick-links to the tools that
 * do them. Additive: shows only when a single/known wing is set; hidden for
 * "all"/none so nothing regresses.
 */
export default function WingActivities() {
  const { session } = useAuth();
  const [wings, setWings] = useState<TaxonomyWing[] | null>(null);

  useEffect(() => {
    let alive = true;
    api.departmentTaxonomy().then((t) => { if (alive) setWings(t.wings); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const wing = useMemo<TaxonomyWing | null>(() => {
    if (!wings || !session) return null;
    const key = session.workspaceProfile;
    if (!key || key === "all") return null;
    if (key === "custom") {
      const first = (session.workspaceWings ?? [])[0];
      return wings.find((w) => w.key === first) ?? null;
    }
    return wings.find((w) => w.key === key) ?? null;
  }, [wings, session]);

  if (!wing || wing.activities.length === 0) return null;

  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="size-8 rounded-lg bg-primary/10 text-primary grid place-items-center">
          <ClipboardList className="size-4" />
        </div>
        <div className="text-[14px] font-semibold text-slate-900">Your desk — {wing.label}</div>
        <span className="ml-auto text-[11.5px] text-slate-400">what you do, day to day</span>
      </div>

      <ul className="space-y-1.5">
        {wing.activities.map((a, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] text-slate-700 leading-snug">
            <span className="mt-1.5 size-1.5 rounded-full bg-primary/50 shrink-0" />
            {a}
          </li>
        ))}
      </ul>

      {wing.tools.length > 0 && (
        <div className="mt-3.5 pt-3 border-t border-slate-100 flex flex-wrap gap-1.5">
          {wing.tools.map((t) => (
            <Link key={t} to={t}
              className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary bg-primary/[0.06] hover:bg-primary/10 rounded-lg px-2.5 py-1 transition-colors">
              {TOOL_LABEL[t] ?? t} <ArrowRight className="size-3" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

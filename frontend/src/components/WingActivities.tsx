import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, ArrowRight, UserCog } from "lucide-react";
import { api, TaxonomyWing, TaxonomyDesignation } from "../api";
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
 * The config-driven "your daily work" surface, keyed off the officer's WING and
 * their DESIGNATION. A field/range/commissioner officer sees their wing's desk;
 * a ministerial / Inspector role additionally (or instead) gets a role desk
 * from the taxonomy — so a Tax Assistant, Inspector or Steno sees THEIR work,
 * not the AO's. Additive: hidden when neither applies.
 */
function DeskCard({ title, subtitle, activities, tools, accent }: {
  title: string; subtitle: string; activities: string[]; tools: string[]; accent?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className={"size-8 rounded-lg grid place-items-center " + (accent ? "bg-brand-orange/15 text-brand-orange" : "bg-primary/10 text-primary")}>
          {accent ? <UserCog className="size-4" /> : <ClipboardList className="size-4" />}
        </div>
        <div className="text-[14px] font-semibold text-slate-900">{title}</div>
        <span className="ml-auto text-[11.5px] text-slate-400">{subtitle}</span>
      </div>
      <ul className="space-y-1.5">
        {activities.map((a, i) => (
          <li key={i} className="flex items-start gap-2 text-[13px] text-slate-700 leading-snug">
            <span className={"mt-1.5 size-1.5 rounded-full shrink-0 " + (accent ? "bg-brand-orange/60" : "bg-primary/50")} />
            {a}
          </li>
        ))}
      </ul>
      {tools.length > 0 && (
        <div className="mt-3.5 pt-3 border-t border-slate-100 flex flex-wrap gap-1.5">
          {tools.map((t) => (
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

export default function WingActivities() {
  const { session } = useAuth();
  const [tax, setTax] = useState<{ wings: TaxonomyWing[]; designations: TaxonomyDesignation[] } | null>(null);

  useEffect(() => {
    let alive = true;
    api.departmentTaxonomy()
      .then((t) => { if (alive) setTax({ wings: t.wings, designations: t.designations }); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const wing = useMemo<TaxonomyWing | null>(() => {
    if (!tax || !session) return null;
    const key = session.workspaceProfile;
    if (!key || key === "all") return null;
    if (key === "custom") {
      const first = (session.workspaceWings ?? [])[0];
      return tax.wings.find((w) => w.key === first) ?? null;
    }
    return tax.wings.find((w) => w.key === key) ?? null;
  }, [tax, session]);

  // The role desk — only for designations whose work differs from running the
  // wing (Inspector + ministerial cadre carry `activities` in the taxonomy).
  const role = useMemo<TaxonomyDesignation | null>(() => {
    if (!tax || !session?.designation) return null;
    const d = tax.designations.find((x) => x.key === session.designation);
    return d && (d.activities?.length ?? 0) > 0 ? d : null;
  }, [tax, session]);

  if (!wing && !role) return null;

  return (
    <div className="space-y-4">
      {role && (
        <DeskCard accent title={`Your role — ${role.label}`} subtitle="what your role does"
          activities={role.activities ?? []} tools={role.tools ?? ["/drafting"]} />
      )}
      {wing && (
        <DeskCard title={`Your desk — ${wing.label}`} subtitle="your wing, day to day"
          activities={wing.activities} tools={wing.tools} />
      )}
    </div>
  );
}

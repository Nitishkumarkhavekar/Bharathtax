// Workspace-profile config: the user's PRIMARY function → the matter
// categories to scope their dashboard to, and the tools to surface under
// "Your workspace" in the sidebar. Soft emphasis only — every tool stays
// reachable under "All tools"; this just reorders and scopes by default.

export interface ProfileConfig {
  key: string;
  label: string;
  categories: string[]; // MatterCategory values this function owns (dashboard scope)
  tools: string[];      // nav `to` paths to feature, in priority order
  calcTab: string;      // the Calculators tab this function opens on by default
  templateGroup: string; // the template-library group this function opens on
}

// Dashboard + Calendar are core for everyone, so they aren't listed per-profile
// (the sidebar always keeps them in the workspace section).
export const PROFILES: ProfileConfig[] = [
  { key: "officer", label: "Assessing Officer", categories: ["officer", "recovery"],
    tools: ["/assessments", "/calculators", "/templates", "/rulings", "/drafts"], calcTab: "interest", templateGroup: "Assessment & notices" },
  { key: "cita", label: "CIT(A) / NFAC", categories: ["cita"],
    tools: ["/appeals", "/rulings", "/templates", "/drafts"], calcTab: "interest", templateGroup: "Assessment & notices" },
  { key: "drp", label: "DRP", categories: ["drp"],
    tools: ["/appeals", "/calculators", "/templates", "/rulings"], calcTab: "alp", templateGroup: "DRP" },
  { key: "tp", label: "Transfer Pricing (TPO)", categories: ["tp"],
    tools: ["/calculators", "/templates", "/rulings"], calcTab: "alp", templateGroup: "Transfer Pricing" },
  { key: "investigation", label: "Investigation", categories: ["investigation"],
    tools: ["/calculators", "/reconcile", "/templates"], calcTab: "peak", templateGroup: "Investigation" },
  { key: "ici", label: "I&CI", categories: ["ici"],
    tools: ["/reconcile", "/calculators", "/templates"], calcTab: "peak", templateGroup: "Investigation" },
  { key: "recovery", label: "Recovery / TRO", categories: ["recovery"],
    tools: ["/calculators", "/templates", "/drafts"], calcTab: "recovery", templateGroup: "Recovery" },
  { key: "tds", label: "TDS / Exemptions", categories: ["tds"],
    tools: ["/calculators", "/templates", "/drafts"], calcTab: "tds", templateGroup: "Exemptions" },
  { key: "ca", label: "CA / Advocate", categories: ["ca"],
    tools: ["/appeals", "/assessments", "/calculators", "/templates", "/rulings", "/reconcile"], calcTab: "interest", templateGroup: "Assessee replies" },
];

const BY_KEY = new Map(PROFILES.map((p) => [p.key, p]));

export function profileConfig(key: string | null | undefined): ProfileConfig | null {
  return key ? BY_KEY.get(key) ?? null : null;
}

export function profileLabel(key: string | null | undefined): string | null {
  return profileConfig(key)?.label ?? null;
}

// The tailoring the sidebar/dashboard actually apply, resolved from the user's
// profile + (for "custom") their chosen functions.
//   mode "none"    — no profile chosen yet (first-run prompt shows).
//   mode "all"     — explicit "show everything": no scoping.
//   mode "preset"  — a single function.
//   mode "custom"  — several functions; categories/tools are the union.
export interface ResolvedWorkspace {
  mode: "none" | "all" | "preset" | "custom";
  categories: string[];
  tools: string[];
  scoped: boolean; // whether to featurize the sidebar and default the dashboard to "Mine"
  calcTab: string | null; // the Calculators tab to open on (null = app default)
  templateGroup: string | null; // the template-library group to open on
}

export function resolveWorkspace(
  profile: string | null | undefined,
  wings: string[] | null | undefined,
): ResolvedWorkspace {
  if (!profile) return { mode: "none", categories: [], tools: [], scoped: false, calcTab: null, templateGroup: null };
  if (profile === "all") return { mode: "all", categories: [], tools: [], scoped: false, calcTab: null, templateGroup: null };
  if (profile === "custom") {
    const chosen = (wings ?? []).map((k) => BY_KEY.get(k)).filter((p): p is ProfileConfig => !!p);
    const categories = Array.from(new Set(chosen.flatMap((p) => p.categories)));
    // Preserve first-seen tool order across the chosen functions.
    const tools: string[] = [];
    for (const p of chosen) for (const t of p.tools) if (!tools.includes(t)) tools.push(t);
    // No valid functions selected → behave like "all" (don't trap the user).
    if (categories.length === 0 && tools.length === 0) return { mode: "all", categories: [], tools: [], scoped: false, calcTab: null, templateGroup: null };
    return { mode: "custom", categories, tools, scoped: true, calcTab: chosen[0]?.calcTab ?? null, templateGroup: chosen[0]?.templateGroup ?? null };
  }
  const cfg = BY_KEY.get(profile);
  if (!cfg) return { mode: "all", categories: [], tools: [], scoped: false, calcTab: null, templateGroup: null };
  return { mode: "preset", categories: cfg.categories, tools: cfg.tools, scoped: true, calcTab: cfg.calcTab, templateGroup: cfg.templateGroup };
}

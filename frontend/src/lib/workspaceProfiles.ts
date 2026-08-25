// Workspace-profile config: the user's PRIMARY function → the matter
// categories to scope their dashboard to, and the tools to surface under
// "Your workspace" in the sidebar. Soft emphasis only — every tool stays
// reachable under "All tools"; this just reorders and scopes by default.

export interface ProfileConfig {
  key: string;
  label: string;
  categories: string[]; // MatterCategory values this function owns (dashboard scope)
  tools: string[];      // nav `to` paths to feature, in priority order
}

// Dashboard + Calendar are core for everyone, so they aren't listed per-profile
// (the sidebar always keeps them in the workspace section).
export const PROFILES: ProfileConfig[] = [
  { key: "officer", label: "Assessing Officer", categories: ["officer", "recovery"],
    tools: ["/assessments", "/calculators", "/templates", "/rulings", "/drafts"] },
  { key: "cita", label: "CIT(A) / NFAC", categories: ["cita"],
    tools: ["/appeals", "/rulings", "/templates", "/drafts"] },
  { key: "drp", label: "DRP", categories: ["drp"],
    tools: ["/appeals", "/calculators", "/templates", "/rulings"] },
  { key: "tp", label: "Transfer Pricing (TPO)", categories: ["tp"],
    tools: ["/calculators", "/templates", "/rulings"] },
  { key: "investigation", label: "Investigation", categories: ["investigation"],
    tools: ["/calculators", "/reconcile", "/templates"] },
  { key: "ici", label: "I&CI", categories: ["ici"],
    tools: ["/reconcile", "/calculators", "/templates"] },
  { key: "recovery", label: "Recovery / TRO", categories: ["recovery"],
    tools: ["/calculators", "/templates", "/drafts"] },
  { key: "tds", label: "TDS / Exemptions", categories: ["tds"],
    tools: ["/calculators", "/templates", "/drafts"] },
  { key: "ca", label: "CA / Advocate", categories: ["ca"],
    tools: ["/appeals", "/assessments", "/calculators", "/templates", "/rulings", "/reconcile"] },
];

const BY_KEY = new Map(PROFILES.map((p) => [p.key, p]));

export function profileConfig(key: string | null | undefined): ProfileConfig | null {
  return key ? BY_KEY.get(key) ?? null : null;
}

export function profileLabel(key: string | null | undefined): string | null {
  return profileConfig(key)?.label ?? null;
}

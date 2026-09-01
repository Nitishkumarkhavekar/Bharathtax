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
    tools: ["/drafting", "/calculators", "/templates", "/rulings"], calcTab: "interest", templateGroup: "Assessment & notices" },
  { key: "cita", label: "CIT(A) / NFAC", categories: ["cita"],
    tools: ["/drafting", "/rulings", "/templates"], calcTab: "interest", templateGroup: "Assessment & notices" },
  { key: "drp", label: "DRP", categories: ["drp"],
    tools: ["/drafting", "/calculators", "/templates", "/rulings"], calcTab: "alp", templateGroup: "DRP" },
  { key: "tp", label: "Transfer Pricing (TPO)", categories: ["tp"],
    tools: ["/drafting", "/calculators", "/templates", "/rulings"], calcTab: "alp", templateGroup: "Transfer Pricing" },
  { key: "investigation", label: "Investigation", categories: ["investigation"],
    tools: ["/drafting", "/calculators", "/reconcile", "/templates"], calcTab: "peak", templateGroup: "Investigation" },
  { key: "ici", label: "I&CI", categories: ["ici"],
    tools: ["/drafting", "/reconcile", "/calculators", "/templates"], calcTab: "peak", templateGroup: "Investigation" },
  { key: "recovery", label: "Recovery / TRO", categories: ["recovery"],
    tools: ["/drafting", "/calculators", "/templates"], calcTab: "recovery", templateGroup: "Recovery" },
  { key: "tds", label: "TDS / Exemptions", categories: ["tds"],
    tools: ["/drafting", "/calculators", "/templates"], calcTab: "tds", templateGroup: "Exemptions" },
  { key: "ca", label: "CA / Advocate", categories: ["ca"],
    tools: ["/drafting", "/calculators", "/templates", "/rulings", "/reconcile"], calcTab: "interest", templateGroup: "Assessee replies" },
  // --- wings added in the taxonomy (Phase 0), given first-class config here (Phase 3) ---
  { key: "central", label: "Central Charges (Search Assessment)", categories: ["investigation", "officer"],
    tools: ["/drafting", "/calculators", "/rulings", "/reconcile"], calcTab: "peak", templateGroup: "Investigation" },
  { key: "exemptions", label: "Exemptions (Trusts)", categories: ["tds"],
    tools: ["/drafting", "/calculators", "/rulings"], calcTab: "interest", templateGroup: "Exemptions" },
  { key: "inttax", label: "International Taxation", categories: ["tp", "officer"],
    tools: ["/drafting", "/calculators", "/rulings"], calcTab: "alp", templateGroup: "Transfer Pricing" },
  { key: "audit", label: "Internal Audit", categories: ["officer"],
    tools: ["/rulings", "/calculators", "/drafting"], calcTab: "interest", templateGroup: "Assessment & notices" },
  { key: "hq", label: "Headquarters / Admin", categories: [],
    tools: ["/workspace", "/rulings"], calcTab: "interest", templateGroup: "Assessment & notices" },
];

const BY_KEY = new Map(PROFILES.map((p) => [p.key, p]));

// The Drafting template GROUPS (from the backend `group` field) that belong to
// each function — so the Drafting library shows an officer ONLY their own
// function's templates by default, with everything else behind an "other
// functions" expander. A wing not listed → no division (everything shown).
const WING_GROUPS: Record<string, string[]> = {
  officer: ["Assessment", "Reassessment", "Penalty"],
  cita: ["Appeals & Revision"],
  drp: ["Transfer Pricing"],
  tp: ["Transfer Pricing"],
  investigation: ["Investigation", "I&CI"],
  ici: ["I&CI", "Investigation"],
  recovery: ["Recovery"],
  tds: ["TDS", "Exemptions"],
  ca: ["Assessee replies"],
  central: ["Investigation", "Assessment", "Penalty"],
  exemptions: ["Exemptions"],
  inttax: ["Transfer Pricing", "Assessment"],
  audit: ["Assessment", "Appeals & Revision"],
  hq: [],
};

// The calculators each function actually uses — so the Calculators page leads
// with those and tucks the rest behind "more". Keys are the calc tab ids.
const WING_CALC_TABS: Record<string, string[]> = {
  officer: ["interest", "234c", "bbe", "slab", "capgains", "penalty"],
  cita: ["interest", "bbe", "penalty"],
  drp: ["alp", "interest"],
  tp: ["alp"],
  investigation: ["peak", "bbe", "interest"],
  ici: ["peak"],
  recovery: ["interest", "recovery", "penalty"],
  tds: ["tds", "interest"],
  ca: ["interest", "slab", "capgains", "tds"],
  central: ["peak", "bbe", "interest", "penalty"],
  exemptions: ["interest"],
  inttax: ["alp", "interest"],
  audit: ["interest", "bbe"],
  hq: [],
};

/** The calculators this officer leads with (empty = show everything). */
export function resolveCalcTabs(
  profile: string | null | undefined,
  wings: string[] | null | undefined,
): string[] {
  if (!profile || profile === "all") return [];
  if (profile === "custom") {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const k of wings ?? []) for (const c of WING_CALC_TABS[k] ?? []) if (!seen.has(c)) { seen.add(c); out.push(c); }
    return out;
  }
  return WING_CALC_TABS[profile] ?? [];
}

/** The drafting groups this officer leads with (empty = show everything). */
export function resolveDraftingGroups(
  profile: string | null | undefined,
  wings: string[] | null | undefined,
): Set<string> {
  if (!profile || profile === "all") return new Set();
  if (profile === "custom") return new Set((wings ?? []).flatMap((k) => WING_GROUPS[k] ?? []));
  return new Set(WING_GROUPS[profile] ?? []);
}

// Per-wing chat starter prompts — the officer's own core tasks, so the new-chat
// hero reads as built for their desk instead of a generic tax chatbot. Kept
// separate from PROFILES so the content stays legible and easy to extend.
export interface WingStarter { category: string; text: string; }

export const WING_STARTERS: Record<string, WingStarter[]> = {
  officer: [
    { category: "Assessment", text: "When is an addition under section 68 for an unexplained cash credit sustainable?" },
    { category: "Limitation", text: "What is the limitation date to pass a 143(3) order for AY 2022-23?" },
    { category: "Draft", text: "Draft a show-cause notice for a large unexplained cash deposit" },
    { category: "Reassessment", text: "Section 148 — what must the reasons recorded establish before reopening?" },
    { category: "Interest", text: "Compute interest under section 234B on an addition to income" },
    { category: "Penalty", text: "Section 270A — underreporting vs misreporting and the penalty rates" },
  ],
  cita: [
    { category: "Appeals", text: "Section 249(4) — condonation of delay in filing an appeal" },
    { category: "Powers", text: "Scope of the CIT(A)'s power of enhancement under section 251" },
    { category: "Draft", text: "Draft a ground-wise finding sustaining an addition under section 69A" },
    { category: "Procedure", text: "When can the CIT(A) admit additional evidence under Rule 46A?" },
    { category: "Appeals", text: "Burden of proof on the appellant in an unexplained-investment appeal" },
    { category: "Limitation", text: "Time limit for the CIT(A) to dispose of an appeal after the 2023 amendment" },
  ],
  drp: [
    { category: "Directions", text: "Section 144C — the DRP's powers and timeline for issuing directions" },
    { category: "Transfer pricing", text: "How should the DRP deal with an objection to a transfer-pricing adjustment?" },
    { category: "Limitation", text: "Final assessment limitation after DRP directions under section 144C(13)" },
    { category: "Draft", text: "Draft DRP directions on a comparables-selection objection" },
    { category: "Procedure", text: "Can the DRP enhance the variation proposed in the draft assessment order?" },
  ],
  tp: [
    { category: "ALP", text: "Compute the arm's-length price range and the 35% proviso adjustment" },
    { category: "Method", text: "When is TNMM the most appropriate method over CUP?" },
    { category: "Reference", text: "Section 92CA — the TPO's jurisdiction on a reference from the AO" },
    { category: "Draft", text: "Draft a show-cause proposing a transfer-pricing adjustment" },
    { category: "Comparables", text: "Filters and adjustments for selecting comparables in a TNMM study" },
  ],
  investigation: [
    { category: "Peak credit", text: "Compute the peak credit from a series of unexplained deposits and withdrawals" },
    { category: "Search", text: "Evidentiary value of a statement recorded under section 132(4)" },
    { category: "Unexplained", text: "Section 69 vs 69A — when does each apply to unexplained assets?" },
    { category: "115BBE", text: "Tax rate under section 115BBE on income assessed under sections 68 to 69D" },
    { category: "Draft", text: "Draft an appraisal note summarising the seized material on one issue" },
  ],
  ici: [
    { category: "SFT", text: "Reconcile SFT / high-value transaction data against the return of income" },
    { category: "Reporting", text: "Section 285BA — reporting obligations and the SFT thresholds" },
    { category: "Information", text: "Verifying a high-value transaction flagged in the AIS" },
    { category: "Draft", text: "Draft a verification letter on an unexplained high-value transaction" },
    { category: "Penalty", text: "Section 271FA — penalty for failure to furnish the SFT" },
  ],
  recovery: [
    { category: "Interest", text: "Compute interest under section 220(2) on an outstanding demand" },
    { category: "Recovery", text: "Section 226(3) garnishee notice — when and how it is issued" },
    { category: "Installments", text: "Frame an installment plan for a disputed demand under section 220(6)" },
    { category: "Attachment", text: "Procedure for attachment and sale under the Second Schedule" },
    { category: "Stay", text: "CBDT guidelines for granting stay of demand pending first appeal" },
  ],
  tds: [
    { category: "TDS default", text: "Section 201 — when is a deductor treated as an assessee-in-default?" },
    { category: "Disallowance", text: "Section 40(a)(ia) — disallowance for non-deduction of TDS" },
    { category: "Exemption", text: "Conditions for registration of a trust under section 12A / 12AB" },
    { category: "80G", text: "Requirements for approval of a charitable institution under section 80G" },
    { category: "Draft", text: "Draft a show-cause for a short-deduction default under section 201" },
  ],
  ca: [
    { category: "Reply", text: "Draft a reply to a scrutiny notice under section 142(1)" },
    { category: "Appeal", text: "Draft the grounds of appeal against an addition under section 68" },
    { category: "Submission", text: "Prepare a written submission explaining a large cash deposit" },
    { category: "Deductions", text: "Maximum deduction available under section 80C with examples" },
    { category: "Capital gains", text: "Exemption under section 54 on sale of a residential house" },
  ],
  central: [
    { category: "Search assessment", text: "Framing an assessment under section 153A for the search year and six preceding years" },
    { category: "Approval", text: "Section 153D — what the Range Head's approval of a search assessment must establish" },
    { category: "153C", text: "When can seized material be used to assess a third party under section 153C?" },
    { category: "Penalty", text: "Section 271AAB — penalty on undisclosed income found in a search" },
    { category: "Draft", text: "Draft an assessment order on unexplained cash seized during a search" },
  ],
  exemptions: [
    { category: "Registration", text: "Conditions for registration of a trust under section 12AB and the provisional-to-final route" },
    { category: "80G", text: "Requirements for approval of a charitable institution under section 80G" },
    { category: "Violation", text: "Section 13 — when does a trust lose its section 11 exemption?" },
    { category: "115TD", text: "Accreted-income tax under section 115TD on cancellation of registration" },
    { category: "Draft", text: "Draft a show-cause for cancellation of registration under section 12AB(4)" },
  ],
  inttax: [
    { category: "Withholding", text: "Section 195 — obligation to deduct tax on a payment to a non-resident" },
    { category: "Treaty", text: "How does a DTAA override the Act where it is more beneficial to the assessee?" },
    { category: "PE", text: "When does a foreign enterprise have a permanent establishment in India?" },
    { category: "Draft order", text: "Section 144C — the draft assessment order route for a foreign company" },
    { category: "Draft", text: "Draft a show-cause on royalty characterisation under section 9(1)(vi)" },
  ],
  audit: [
    { category: "Objection", text: "Frame an internal audit objection on an under-assessment of capital gains" },
    { category: "263", text: "Section 263 — when is an assessment order erroneous and prejudicial to revenue?" },
    { category: "Errors", text: "Common assessment errors that attract a revenue-audit para" },
    { category: "Review", text: "Points to check when reviewing a completed 143(3) assessment for quality" },
  ],
  hq: [
    { category: "Monitoring", text: "Which assessments are getting time-barred this quarter and need priority?" },
    { category: "Limitation", text: "Section 153 — the current time limits for completing assessments" },
    { category: "Coordination", text: "Summarise the disposal and pendency position a Range Head should monitor" },
  ],
};

// Which summary tiles a function's desk leads with, in order. Keys map to the
// Dashboard TILE registry. Only functions that differ from the default are
// listed; every other wing (and all/none) uses DEFAULT_TILES. "demand" surfaces
// the outstanding-demand total, which matters most to Recovery and the AO.
export const DEFAULT_TILES = ["matters", "open", "overdue", "due7", "due30"];
const WING_TILES: Record<string, string[]> = {
  recovery: ["matters", "demand", "overdue", "due7", "due30"],
  officer: ["matters", "open", "overdue", "due7", "demand"],
};

export function resolveTiles(
  profile: string | null | undefined,
  wings: string[] | null | undefined,
): string[] {
  if (!profile || profile === "all") return DEFAULT_TILES;
  if (profile === "custom") {
    // If any chosen function cares about demand, give it a slot.
    if ((wings ?? []).some((k) => (WING_TILES[k] ?? []).includes("demand")))
      return ["matters", "open", "demand", "overdue", "due7"];
    return DEFAULT_TILES;
  }
  return WING_TILES[profile] ?? DEFAULT_TILES;
}

// The starter prompts to show for a resolved profile. Empty for "all"/"none"
// (the caller falls back to the global trending starters). For "custom" it
// round-robins the chosen wings' prompts so each is represented, capped at 6.
export function resolveStarters(
  profile: string | null | undefined,
  wings: string[] | null | undefined,
): WingStarter[] {
  if (!profile || profile === "all") return [];
  if (profile === "custom") {
    const lists = (wings ?? []).map((k) => WING_STARTERS[k]).filter(Boolean) as WingStarter[][];
    if (!lists.length) return [];
    const out: WingStarter[] = [];
    for (let i = 0; out.length < 6; i++) {
      let added = false;
      for (const list of lists) {
        if (i < list.length) { out.push(list[i]); added = true; if (out.length >= 6) break; }
      }
      if (!added) break;
    }
    return out;
  }
  return WING_STARTERS[profile] ?? [];
}

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

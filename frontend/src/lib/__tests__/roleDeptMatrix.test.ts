// Exhaustive wing × profile-state sweep of the frontend personalization
// resolvers — the client half of the role×dept matrix. Iterates every wing
// (plus "all" / "custom" / null) and asserts each resolver returns coherent,
// non-crashing output, then pins the specific per-wing behaviours a demo
// depends on (drafting engines, Reconcile visibility).
import { describe, it, expect } from "vitest";
import {
  PROFILES,
  resolveWorkspace,
  resolveDraftingTabs,
  resolveDraftingGroups,
  resolveCalcTabs,
  resolveTiles,
  resolveStarters,
  wingUsesTool,
  profileLabel,
} from "@/lib/workspaceProfiles";

const WING_KEYS = PROFILES.map((p) => p.key);
// The 14 canonical wings — must stay in lockstep with backend department.py.
const EXPECTED_WINGS = [
  "officer", "cita", "drp", "tp", "investigation", "ici", "recovery",
  "tds", "ca", "central", "exemptions", "inttax", "audit", "hq",
];
const VALID_TABS = new Set(["assessments", "appeals", "notices"]);
const VALID_TILES = new Set(["matters", "open", "overdue", "due7", "due30", "demand"]);

// Every profile state the app can be in: a single wing, the "all" umbrella,
// a "custom" multi-wing pick, and the not-yet-picked null.
const STATES: { profile: string | null; wings: string[] | null }[] = [
  ...WING_KEYS.map((k) => ({ profile: k, wings: null })),
  { profile: "all", wings: null },
  { profile: null, wings: null },
  { profile: "custom", wings: ["recovery", "tds"] },
  { profile: "custom", wings: ["investigation", "cita"] },
  { profile: "custom", wings: [] },
];

describe("role×dept matrix — frontend resolvers", () => {
  it("PROFILES covers exactly the 14 canonical wings", () => {
    expect(new Set(WING_KEYS)).toEqual(new Set(EXPECTED_WINGS));
    expect(WING_KEYS.length).toBe(14);
  });

  it("no resolver throws or returns garbage for any profile state", () => {
    for (const { profile, wings } of STATES) {
      const label = `${profile}/${wings}`;
      // resolveWorkspace shape
      const ws = resolveWorkspace(profile, wings);
      expect(Array.isArray(ws.tools), label).toBe(true);
      expect(Array.isArray(ws.categories), label).toBe(true);
      expect(typeof ws.scoped, label).toBe("boolean");

      // drafting tabs → null or a subset of the three valid engines
      const tabs = resolveDraftingTabs(profile, wings);
      if (tabs !== null) {
        for (const t of tabs) expect(VALID_TABS.has(t), `${label} tab ${t}`).toBe(true);
      }

      // groups / calc tabs / tiles / starters — all well-typed
      expect(resolveDraftingGroups(profile, wings) instanceof Set, label).toBe(true);
      expect(Array.isArray(resolveCalcTabs(profile, wings)), label).toBe(true);
      const tiles = resolveTiles(profile, wings);
      expect(Array.isArray(tiles), label).toBe(true);
      for (const t of tiles) expect(VALID_TILES.has(t), `${label} tile ${t}`).toBe(true);
      expect(Array.isArray(resolveStarters(profile, wings)), label).toBe(true);

      // reconcile gate is always a clean boolean
      expect(typeof wingUsesTool("/reconcile", profile, wings), label).toBe("boolean");
    }
  });

  it("assessment/appeal engines are HARD-scoped by wing (the demo-blocker)", () => {
    // Investigation & I&CI must NEVER see assessment or appeal drafting engines.
    for (const w of ["investigation", "ici", "tp", "tds", "exemptions", "recovery", "ca"]) {
      const tabs = resolveDraftingTabs(w, null)!;
      expect(tabs.has("assessments"), `${w} assessments`).toBe(false);
      expect(tabs.has("appeals"), `${w} appeals`).toBe(false);
      expect(tabs.has("notices"), `${w} notices`).toBe(true);
    }
    // Assessing-side wings frame assessment orders, not appeals.
    for (const w of ["officer", "central", "inttax", "audit"]) {
      const tabs = resolveDraftingTabs(w, null)!;
      expect(tabs.has("assessments"), `${w} assessments`).toBe(true);
      expect(tabs.has("appeals"), `${w} appeals`).toBe(false);
    }
    // Appellate wings frame appeal orders, not assessments.
    for (const w of ["cita", "drp"]) {
      const tabs = resolveDraftingTabs(w, null)!;
      expect(tabs.has("appeals"), `${w} appeals`).toBe(true);
      expect(tabs.has("assessments"), `${w} assessments`).toBe(false);
    }
    // "all" / null show everything (no restriction).
    expect(resolveDraftingTabs("all", null)).toBeNull();
    expect(resolveDraftingTabs(null, null)).toBeNull();
  });

  it("Reconcile shows only for wings that reconcile", () => {
    for (const w of ["investigation", "ici", "ca", "central"]) {
      expect(wingUsesTool("/reconcile", w, null), `${w} should see reconcile`).toBe(true);
    }
    for (const w of ["officer", "cita", "drp", "recovery", "tds", "exemptions", "audit"]) {
      expect(wingUsesTool("/reconcile", w, null), `${w} should NOT see reconcile`).toBe(false);
    }
    // no wing → show everything
    expect(wingUsesTool("/reconcile", "all", null)).toBe(true);
    expect(wingUsesTool("/reconcile", null, null)).toBe(true);
  });

  it("every wing has a human label", () => {
    for (const w of WING_KEYS) expect(profileLabel(w), w).toBeTruthy();
  });
});

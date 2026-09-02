import { describe, it, expect } from "vitest";
import { resolveDraftingTabs, wingUsesTool } from "../workspaceProfiles";

describe("resolveDraftingTabs — hard wing gating of the drafting engines", () => {
  it("gives the AO assessment + notices, never appeals", () => {
    const t = resolveDraftingTabs("officer", null)!;
    expect(t.has("assessments")).toBe(true);
    expect(t.has("notices")).toBe(true);
    expect(t.has("appeals")).toBe(false);
  });

  it("gives Investigation / I&CI only notices (no order engines)", () => {
    for (const w of ["investigation", "ici", "tds", "recovery", "exemptions", "tp"]) {
      const t = resolveDraftingTabs(w, null)!;
      expect([...t]).toEqual(["notices"]);
    }
  });

  it("gives CIT(A) / DRP appeals + notices, never assessments", () => {
    for (const w of ["cita", "drp"]) {
      const t = resolveDraftingTabs(w, null)!;
      expect(t.has("appeals")).toBe(true);
      expect(t.has("assessments")).toBe(false);
    }
  });

  it("returns null (no restriction) for 'all' / not-set / unknown", () => {
    expect(resolveDraftingTabs("all", null)).toBeNull();
    expect(resolveDraftingTabs(null, null)).toBeNull();
    expect(resolveDraftingTabs("bogus", null)).toBeNull();
  });

  it("unions the chosen wings for 'custom'", () => {
    const t = resolveDraftingTabs("custom", ["officer", "cita"])!;
    expect(t.has("assessments") && t.has("appeals") && t.has("notices")).toBe(true);
  });
});

describe("wingUsesTool — hide wing-specific tools", () => {
  it("hides Reconcile for wings that don't reconcile", () => {
    expect(wingUsesTool("/reconcile", "officer", null)).toBe(false);
    expect(wingUsesTool("/reconcile", "cita", null)).toBe(false);
    expect(wingUsesTool("/reconcile", "recovery", null)).toBe(false);
  });
  it("shows Reconcile for Investigation / I&CI / CA", () => {
    expect(wingUsesTool("/reconcile", "investigation", null)).toBe(true);
    expect(wingUsesTool("/reconcile", "ici", null)).toBe(true);
    expect(wingUsesTool("/reconcile", "ca", null)).toBe(true);
  });
  it("shows everything for 'all' / not-set", () => {
    expect(wingUsesTool("/reconcile", "all", null)).toBe(true);
    expect(wingUsesTool("/reconcile", null, null)).toBe(true);
  });
});

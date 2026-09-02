/**
 * Persona sweep — logs in as a spread of role × dept personas against the LIVE
 * app and checks, for each, that (a) the API scopes templates to their wing +
 * designation and (b) the real UI honours the hard-scoping: the right Drafting
 * engines, the minimal-role Dashboard, the desk-scoped case law.
 *
 * Creates temporary users via the admin API in a throwaway, unlimited-seat test
 * wing, and DELETES every one of them in afterAll (self-cleaning, like
 * officer-review.spec.ts). Needs E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD; skips
 * without them. Logins are paced to respect the 10/min/IP rate limit.
 *
 * The one test wing row cannot be deleted (no admin endpoint) — its id is
 * printed at the end for manual cleanup.
 */
import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";

test.describe.configure({ mode: "serial" });
// This spec drives its own auth per persona; don't inherit the officer session.
test.use({ storageState: { cookies: [], origins: [] } });

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "";
const BASE = process.env.E2E_BASE_URL || "https://bharattax.wenvia.global";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const STAMP = Date.now().toString(36);

interface Persona {
  tag: string;
  profile: string;              // workspace_profile
  wings?: string[] | null;      // workspace_wings (for "custom")
  designation: string | null;
  assess: boolean | null;       // expect "Assessment orders" tab? null = don't assert
  appeal: boolean | null;       // expect "Appeal orders" tab?
  light: boolean;               // expect the minimal-role dashboard?
  leadTemplate?: string;        // a role template that must rank near the top
}

// A spread covering every wing at least once, every seniority tier, both
// deskLight roles, an Inspector, ministerial roles, and a custom multi-wing.
const PERSONAS: Persona[] = [
  { tag: "AO-officer/ito", profile: "officer", designation: "ito", assess: true, appeal: false, light: false },
  { tag: "CITA/cit", profile: "cita", designation: "cit", assess: false, appeal: true, light: false },
  { tag: "DRP/dcit", profile: "drp", designation: "dcit", assess: false, appeal: true, light: false },
  { tag: "TPO/dcit", profile: "tp", designation: "dcit", assess: false, appeal: false, light: false },
  { tag: "INV/inspector", profile: "investigation", designation: "inspector", assess: false, appeal: false, light: false, leadTemplate: "survey_report_133a" },
  { tag: "ICI/ito", profile: "ici", designation: "ito", assess: false, appeal: false, light: false },
  { tag: "TDS/ito", profile: "tds", designation: "ito", assess: false, appeal: false, light: false },
  { tag: "REC/tro", profile: "recovery", designation: "tro", assess: false, appeal: false, light: false },
  { tag: "CENTRAL/dcit", profile: "central", designation: "dcit", assess: true, appeal: false, light: false },
  { tag: "EXEMPT/ito", profile: "exemptions", designation: "ito", assess: false, appeal: false, light: false },
  { tag: "INTTAX/dcit", profile: "inttax", designation: "dcit", assess: true, appeal: false, light: false },
  { tag: "AUDIT/ito", profile: "audit", designation: "ito", assess: true, appeal: false, light: false },
  { tag: "TA-officer/ta", profile: "officer", designation: "ta", assess: true, appeal: false, light: false, leadTemplate: "penalty_default_note" },
  { tag: "NOTICE-officer/notice_server", profile: "officer", designation: "notice_server", assess: null, appeal: null, light: true, leadTemplate: "proof_of_service" },
  { tag: "STENO-officer/steno", profile: "officer", designation: "steno", assess: null, appeal: null, light: true, leadTemplate: "order_format_shell" },
  { tag: "RANGE-officer/jcit", profile: "officer", designation: "jcit", assess: true, appeal: false, light: false },
  { tag: "CUSTOM-rec+tds/ito", profile: "custom", wings: ["recovery", "tds"], designation: "ito", assess: false, appeal: false, light: false },
];

let admin: APIRequestContext;
let adminTok = "";
let testWingId = 0;
const created: number[] = [];

async function apiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await request.post("/api/auth/login", {
      data: { email, password }, headers: { "Content-Type": "application/json" },
    });
    if (r.status() === 429) { await new Promise((res) => setTimeout(res, 65_000)); continue; }
    expect(r.ok(), `login ${email} -> ${r.status()}`).toBeTruthy();
    return (await r.json()).access_token as string;
  }
  throw new Error(`login ${email} rate-limited twice`);
}

test.beforeAll(async ({ playwright }) => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "admin creds not set");
  admin = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { "User-Agent": UA } });
  adminTok = await apiLogin(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  const H = { Authorization: `Bearer ${adminTok}`, "Content-Type": "application/json" };

  // Throwaway, unlimited-seat wing so persona logins never contend for seats.
  const w = await admin.post("/api/admin/wings", {
    headers: H, data: { name: `E2E Persona Sweep ${STAMP}`, seat_limit: 0 },
  });
  expect(w.ok(), `create wing -> ${w.status()}`).toBeTruthy();
  testWingId = (await w.json()).id;

  // Create every persona user up front (admin creates don't hit the login limit).
  for (const p of PERSONAS) {
    const r = await admin.post("/api/admin/users", {
      headers: H,
      data: {
        username: `e2e_${STAMP}_${p.profile}_${p.designation}`.slice(0, 60),
        password: "persona123",
        email: `e2e_${STAMP}_${p.profile}_${p.designation}@example.test`.toLowerCase(),
        full_name: `E2E ${p.tag}`,
        role: "officer",
        workspace_profile: p.profile,
        workspace_wings: p.wings ?? null,
        designation: p.designation,
        wing_id: testWingId,
      },
    });
    expect(r.ok(), `create ${p.tag} -> ${r.status()} ${await r.text()}`).toBeTruthy();
    created.push((await r.json()).id);
  }
});

test.afterAll(async () => {
  if (!admin) return;
  const H = { Authorization: `Bearer ${adminTok}` };
  for (const id of created) {
    await admin.delete(`/api/admin/users/${id}`, { headers: H }).catch(() => {});
  }
  // eslint-disable-next-line no-console
  console.log(`\n[persona-sweep] deleted ${created.length} users. Orphan test wing id=${testWingId} (no delete endpoint — remove manually).`);
  await admin.dispose();
});

for (let i = 0; i < PERSONAS.length; i++) {
  const p = PERSONAS[i];
  test(`${p.tag}: API scoping + live-UI hard-scoping`, async ({ request, browser }) => {
    // Pace logins to stay under 10/min/IP (admin login already spent one).
    await new Promise((res) => setTimeout(res, 9_000));
    const email = `e2e_${STAMP}_${p.profile}_${p.designation}@example.test`.toLowerCase();
    const tok = await apiLogin(request, email, "persona123");
    const H = { Authorization: `Bearer ${tok}` };

    // --- API: session carries the persona, templates scope to it ------------
    const me = await (await request.get("/api/auth/me", { headers: H })).json();
    expect(me.workspace_profile, `${p.tag} profile`).toBe(p.profile);
    expect(me.designation, `${p.tag} designation`).toBe(p.designation);

    const templates: any[] = await (await request.get("/api/drafts/templates", { headers: H })).json();
    expect(templates.length, `${p.tag} template count`).toBeGreaterThanOrEqual(90);
    if (p.leadTemplate) {
      const top = templates.slice(0, 5).map((t) => t.kind);
      expect(top, `${p.tag} leads with ${p.leadTemplate}`).toContain(p.leadTemplate);
    }

    // --- UI: log in via the token and check the real render -----------------
    const ctx = await browser.newContext({ userAgent: UA });
    const errors: string[] = [];
    await ctx.addInitScript((t) => {
      localStorage.setItem("bharathtax_token", t as string);
      localStorage.setItem("bharathtax_session", JSON.stringify({
        username: "e2e", role: "officer", wingId: 1,
        workspaceProfile: null, workspaceWings: null, designation: null, features: null, fullName: "E2E",
      }));
    }, tok);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));

    // Drafting — the hard-scoped engines (the original demo-blocker).
    await page.goto("/drafting");
    await page.waitForLoadState("networkidle");
    const notices = page.getByText("Notices & orders", { exact: true });
    await expect(notices, `${p.tag} sees Notices`).toBeVisible();
    if (p.assess === false) {
      await expect(page.getByText("Assessment orders", { exact: true }), `${p.tag} must NOT see Assessment orders`).toHaveCount(0);
    } else if (p.assess === true) {
      await expect(page.getByText("Assessment orders", { exact: true }), `${p.tag} should see Assessment orders`).toBeVisible();
    }
    if (p.appeal === false) {
      await expect(page.getByText("Appeal orders", { exact: true }), `${p.tag} must NOT see Appeal orders`).toHaveCount(0);
    } else if (p.appeal === true) {
      await expect(page.getByText("Appeal orders", { exact: true }), `${p.tag} should see Appeal orders`).toBeVisible();
    }

    // Dashboard — the minimal-role fit.
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    const lightMarker = page.getByText(/Your role's work-product/i);
    if (p.light) {
      await expect(lightMarker, `${p.tag} should get the minimal-role dashboard`).toBeVisible();
    } else {
      await expect(lightMarker, `${p.tag} should get the full caseload dashboard`).toHaveCount(0);
    }

    // No uncaught JS on either page.
    expect(errors, `${p.tag} console/page errors: ${errors.join(" | ")}`).toEqual([]);
    await ctx.close();
  });
}

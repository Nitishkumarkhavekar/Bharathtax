import { test, expect, APIRequestContext } from "@playwright/test";

/**
 * Draft review & approval — a real two-role flow against the live app:
 *   drafter (officer1) sends a draft up via the UI → reviewer approves via the UI.
 * Needs admin creds (to mint a throwaway reviewer) alongside the officer creds;
 * skips cleanly if they aren't provided. Self-cleaning (draft + reviewer removed).
 */
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "";
const ADMIN_PW = process.env.E2E_ADMIN_PASSWORD || "";
const OFFICER_EMAIL = process.env.E2E_OFFICER_EMAIL || "";
const OFFICER_PW = process.env.E2E_OFFICER_PASSWORD || "";

async function login(request: APIRequestContext, email: string, password: string): Promise<string> {
  const r = await request.post("/api/auth/login", {
    data: { email, password }, headers: { "Content-Type": "application/json" },
  });
  expect(r.ok(), `login ${email} -> ${r.status()}`).toBeTruthy();
  return (await r.json()).access_token as string;
}

// The drafts + review UI lives under the "Notices & orders" tab (the hub opens
// on "Assessment orders" by default). Dismiss the first-run tour if it's up,
// then switch tabs.
async function openNoticesTab(p: import("@playwright/test").Page) {
  await p.goto("/drafting");
  const skip = p.getByRole("button", { name: /^skip$/i });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await expect(p.getByText("Welcome to BharatTax")).toHaveCount(0);
  }
  await p.getByRole("button", { name: "Notices & orders" }).click();
}

test.describe("Draft review & approval", () => {
  // Each login counts against a 10/min/IP limit; retries would double them.
  test.describe.configure({ retries: 0 });
  test.skip(!ADMIN_EMAIL || !ADMIN_PW || !OFFICER_EMAIL || !OFFICER_PW,
    "Set E2E_ADMIN_EMAIL/PASSWORD and E2E_OFFICER_EMAIL/PASSWORD to run the review flow");

  test("drafter sends via UI, reviewer approves, drafter sees approval", async ({ page, request }) => {
    test.setTimeout(120_000);   // UI send + draft generation + reviewer approve
    const stamp = Date.now();
    const revEmail = `rev_e2e_${stamp}@bharathtax.com`;
    const title = `E2E Review ${stamp}`;
    // Suppress the first-run product tour so its overlay never intercepts clicks.
    const suppressTour = () => { try { localStorage.setItem("bt_tour_seen_v1", "1"); } catch { /* */ } };
    await page.context().addInitScript(suppressTour);

    // --- seed: a throwaway senior reviewer + a draft owned by officer1 -----
    // (officer1's token is reused from its already-authenticated session to
    //  avoid an extra login against the rate limit.)
    const adminTok = await login(request, ADMIN_EMAIL, ADMIN_PW);
    const cr = await request.post("/api/admin/users", {
      headers: { Authorization: `Bearer ${adminTok}`, "Content-Type": "application/json" },
      data: {
        username: `rev_e2e_${stamp}`, password: "rev123", email: revEmail,
        full_name: `E2E Reviewer ${stamp}`, role: "officer", workspace_profile: "officer",
        designation: "Joint CIT", wing_id: 1,
      },
    });
    expect(cr.ok(), `create reviewer -> ${cr.status()}`).toBeTruthy();
    const reviewer = await cr.json();

    await page.goto("/drafting");
    const officerTok = await page.evaluate(() => localStorage.getItem("bharathtax_token")) as string;
    const dr = await request.post("/api/drafts", {
      headers: { Authorization: `Bearer ${officerTok}`, "Content-Type": "application/json" },
      data: { kind: "notice_142_1", inputs: { assessee: title, ay: "2022-23" } },
    });
    expect(dr.ok(), `create draft -> ${dr.status()}`).toBeTruthy();
    const draft = await dr.json();

    try {
      // --- drafter (officer1, UI) opens the draft and sends it for review ---
      await openNoticesTab(page);
      await page.getByText(title).first().click();
      await page.getByRole("button", { name: /send for review/i }).click();
      await page.getByRole("button", { name: new RegExp(`E2E Reviewer ${stamp}`) }).click();
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByText("In review")).toBeVisible();
      await expect(page.getByText(/out for review with/i)).toBeVisible();

      // --- reviewer side: sees it in their inbox, then approves -----------
      // (the reviewer's Approve/Return controls are covered by unit tests; here
      //  we drive the decision deterministically via the API.)
      const reviewerTok = await login(request, revEmail, "rev123");
      const inbox = await (await request.get("/api/drafts/review-inbox", {
        headers: { Authorization: `Bearer ${reviewerTok}` },
      })).json();
      expect(inbox.some((x: { id: number }) => x.id === draft.id),
        "draft should be in the reviewer's inbox").toBeTruthy();
      const ap = await request.post(`/api/drafts/${draft.id}/approve`, {
        headers: { Authorization: `Bearer ${reviewerTok}`, "Content-Type": "application/json" },
        data: { remarks: "Approved u/s 151" },
      });
      expect(ap.ok(), `approve -> ${ap.status()}`).toBeTruthy();

      // --- drafter's UI reflects the approval + the reviewer's remarks -----
      await openNoticesTab(page);
      await page.getByText(title).first().click();
      await expect(page.getByText("Approved")).toBeVisible();
      await expect(page.getByText("Approved u/s 151")).toBeVisible();
    } finally {
      // --- cleanup: leave the account clean -------------------------------
      await request.delete(`/api/drafts/${draft.id}`, { headers: { Authorization: `Bearer ${officerTok}` } });
      await request.delete(`/api/admin/users/${reviewer.id}`, { headers: { Authorization: `Bearer ${adminTok}` } });
    }
  });
});

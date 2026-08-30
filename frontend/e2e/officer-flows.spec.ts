import { test, expect } from "@playwright/test";

// A unique source ref so repeated runs never collide and cleanup is precise.
const REF = "corpus:e2e-" + Date.now();
const TITLE = "E2E Seeded Ruling " + Date.now();

test.describe("Officer — authenticated", () => {
  test("authenticated app renders (no bounce to /login)", async ({ page }) => {
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);
    // The chat composer is an authenticated-only affordance — its presence proves
    // the session hydrated and the app shell rendered.
    await expect(page.getByRole("button", { name: /new chat/i })).toBeVisible();
  });

  test("Library page renders with filter tabs", async ({ page }) => {
    await page.goto("/library");
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: /My Library/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^All/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Rulings/ })).toBeVisible();
  });

  test("ruling-alerts endpoint returns a well-formed payload", async ({ page }) => {
    await page.goto("/library");
    const data = await page.evaluate(async () => {
      const t = localStorage.getItem("bharathtax_token");
      const r = await fetch("/api/workspace/ruling-alerts", { headers: { Authorization: `Bearer ${t}` } });
      return { status: r.status, body: await r.json() };
    });
    expect(data.status).toBe(200);
    expect(Array.isArray(data.body.items)).toBeTruthy();
    expect(["usage", "function", "none"]).toContain(data.body.source);
    expect(Array.isArray(data.body.sections)).toBeTruthy();
  });

  test("save round-trip: seed via API, see it in Library, delete via UI", async ({ page }) => {
    await page.goto("/library");
    const token = await page.evaluate(() => localStorage.getItem("bharathtax_token"));
    expect(token).toBeTruthy();

    // Seed a saved ruling through the real API (same-origin, browser context).
    const status = await page.evaluate(async ({ ref, title, t }) => {
      const r = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ kind: "ruling", title, content: "playwright seed", ref_id: ref, sections: ["68"] }),
      });
      return r.status;
    }, { ref: REF, title: TITLE, t: token });
    expect(status).toBe(201);

    await page.reload();
    await expect(page.getByText(TITLE)).toBeVisible();

    // Delete via the UI: the row's remove button, then confirm in the dialog.
    await page.getByRole("button", { name: /remove from library/i }).first().click();
    await page.getByRole("button", { name: /^Remove$/ }).click();
    await expect(page.getByText(TITLE)).toHaveCount(0);
  });

  // Belt-and-suspenders: remove the seeded item even if the UI delete failed,
  // so the test account is left clean.
  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: "e2e/.auth/officer.json" });
    const page = await ctx.newPage();
    await page.goto("/library");
    await page.evaluate(async (ref) => {
      const t = localStorage.getItem("bharathtax_token");
      await fetch(`/api/library/by-ref/ruling/${encodeURIComponent(ref)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${t}` },
      });
    }, REF);
    await ctx.close();
  });
});

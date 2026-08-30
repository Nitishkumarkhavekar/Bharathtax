import { test, expect } from "@playwright/test";

/**
 * Demo-readiness smoke: every major officer page must load without bouncing to
 * /login, without an uncaught JS error, and without a crashed (empty) app root.
 * Catches the white-screen-on-navigation class of bug before a live demo.
 */
const ROUTES = [
  ["/", "Ask / chat"],
  ["/dashboard", "Dashboard"],
  ["/workspace", "Calendar / workspace"],
  ["/drafting", "Drafting"],
  ["/rulings", "Rulings"],
  ["/calculators", "Calculators"],
  ["/library", "My Library"],
  ["/watchlists", "Watchlists"],
  ["/history", "History"],
  ["/reconcile", "Reconcile"],
  ["/templates", "Templates"],
  ["/profile", "Profile"],
];

test.describe("Officer pages — load smoke", () => {
  // Suppress the first-run tour so it doesn't mask content.
  test.beforeEach(async ({ page }) => {
    await page.context().addInitScript(() => {
      try { localStorage.setItem("bt_tour_seen_v1", "1"); } catch { /* */ }
    });
  });

  for (const [route, label] of ROUTES) {
    test(`${label} (${route}) loads cleanly`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await page.goto(route);
      await expect(page, `${route} bounced to /login`).not.toHaveURL(/\/login/, { timeout: 15_000 });
      // The app shell rendered something (not a crashed / blank root).
      await expect(page.locator("#root")).not.toBeEmpty();
      // No error-boundary fallback on screen.
      await expect(page.locator("body")).not.toContainText(/something went wrong|application error|unexpected error/i);
      // No uncaught runtime error.
      expect(errors, `uncaught errors on ${route}: ${errors.join(" | ")}`).toEqual([]);
    });
  }
});

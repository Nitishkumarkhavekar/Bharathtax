import { test, expect } from "@playwright/test";

/**
 * Anonymous (no auth). Guards the pre-login shop window: the landing page must
 * advertise the current, differentiating feature set — this is what most users
 * see before they ever sign in.
 */
test.describe("Landing page", () => {
  test("advertises the personalisation + stickiness features", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Fresh law, for you")).toBeVisible();
    await expect(page.getByText("Your library")).toBeVisible();
    await expect(page.getByText("Tuned to you, not just your wing")).toBeVisible();
    // the corrected template count, not the stale "36"
    await expect(page.getByText("77 wing templates")).toBeVisible();
    await expect(page.getByText("36 wing templates")).toHaveCount(0);
  });

  test("has a working login link", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("rejects bad credentials with an error", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("nobody@example.com");
    await page.locator('input[type="password"]').fill("wrongpassword");
    await page.getByRole("button", { name: /sign in/i }).click();
    // stays on /login and surfaces an error (does NOT navigate into the app)
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/invalid|incorrect|failed|wrong|not found|unauthor/i)).toBeVisible();
  });
});

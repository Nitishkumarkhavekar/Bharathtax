import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";

// Credentials come from the environment — never commit a password. Run with:
//   E2E_OFFICER_EMAIL=... E2E_OFFICER_PASSWORD=... npm run e2e
const AUTH_FILE = "e2e/.auth/officer.json";
const EMAIL = process.env.E2E_OFFICER_EMAIL || "";
const PASSWORD = process.env.E2E_OFFICER_PASSWORD || "";

/**
 * Log in ONCE through the real login form (acquires a single seat) and persist
 * the fully-hydrated storage state for the officer project to reuse. Doing it
 * through the UI — rather than injecting just a token — means the app stores
 * both the token AND the session object, so a reload renders the app instead of
 * bouncing to /login during the /auth/me hydration gap. It also exercises the
 * real login path end-to-end.
 */
setup("authenticate officer via the login form", async ({ page }) => {
  expect(EMAIL && PASSWORD,
    "Set E2E_OFFICER_EMAIL and E2E_OFFICER_PASSWORD to run the officer flows").toBeTruthy();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  await expect(page, "still on /login after submitting valid creds").not.toHaveURL(/\/login/, { timeout: 25_000 });
  // Session object present == the app considers itself logged in and hydrated.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("bharathtax_session")), { timeout: 25_000 })
    .not.toBeNull();

  fs.mkdirSync("e2e/.auth", { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
});

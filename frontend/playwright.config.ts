import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the live app (default: production). Override the target with
 * E2E_BASE_URL. A `setup` project logs in the officer test account ONCE and
 * saves its auth state, so the officer flows reuse a single session (one seat)
 * instead of logging in per test. The `landing` project runs anonymous.
 */
const BASE = process.env.E2E_BASE_URL || "https://bharattax.wenvia.global";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: [["list"]],
  timeout: 45_000,
  expect: { timeout: 12_000 },
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // A real desktop-Chrome UA so Cloudflare doesn't serve the bot challenge.
    ...devices["Desktop Chrome"],
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "landing", testMatch: /landing\.spec\.ts/ },
    {
      name: "officer",
      testMatch: /officer.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: "e2e/.auth/officer.json" },
    },
  ],
});

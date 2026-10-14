import { defineConfig, devices } from "@playwright/test";

// Runs against whatever E2E_BASE_URL points at, defaulting to production.
// These are black-box tests of what a stranger sees, so there is no webServer here:
// they are meant to run against a real deployment, not a local build.
export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["auth.spec.ts"],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:4720",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "auth.spec.ts",
  workers: 1,
  use: { baseURL: "http://localhost:4720" },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:4720/library",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

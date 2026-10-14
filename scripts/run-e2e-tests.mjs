#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runRoot = mkdtempSync(path.join(tmpdir(), "plays-ai-e2e-"));
const reportPath = path.join(runRoot, "e2e-results.json");
const playwrightBin = path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "playwright.cmd" : "playwright");

const LIVE_CHECKOUT = process.env.E2E_ALLOW_LIVE_CHECKOUT === "1";

// Tests that require an external checkout provider are opt-in.
const LIVE_CHECKOUT_TESTS = [
  "buy reaches checkout.stripe.com with the same price rendered",
  "back button after checkout returns to a working play page",
  "clicking buy twice does not strand the buyer",
];
// Must always run: the default-path replacement. Named here so it cannot be deleted silently.
const REQUIRED_TEST = "buy posts the shown play to our checkout route, creating no provider session";

function collectResults(report) {
  const results = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const attempts = test.results?.length ? test.results : [{ status: "skipped" }];
        for (const result of attempts) {
          results.push({ file: spec.file ?? suite.file ?? "", title: spec.title ?? "", status: result.status });
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites ?? []) visit(suite);
  return results;
}

try {
  const result = spawnSync(playwrightBin, ["test", "--config=playwright.config.ts", "--reporter=json"], {
    cwd: repoRoot,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath },
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: 10 * 60 * 1_000,
  });
  if (!existsSync(reportPath)) {
    throw new Error(`e2e runner: storefront collector produced no machine-readable report.\n${result.stderr || result.stdout || ""}`);
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const results = collectResults(report).filter(({ file }) => file.endsWith("e2e/storefront.spec.ts") || file.endsWith("storefront.spec.ts"));
  const failed = results.filter(({ status }) => status !== "passed" && status !== "skipped");
  const skipped = results.filter(({ status }) => status === "skipped");
  if (result.status !== 0 || failed.length > 0) {
    throw new Error(`e2e runner failed: ${results.length - failed.length - skipped.length} passed, ${failed.length} failed or interrupted, ${skipped.length} skipped.\n${result.stderr || result.stdout || ""}`);
  }
  if (results.length === 0) throw new Error("e2e runner: storefront.spec.ts reported zero tests.");

  const expectedSkips = LIVE_CHECKOUT ? [] : LIVE_CHECKOUT_TESTS;
  const skippedTitles = [...new Set(skipped.map(({ title }) => title))].sort();
  const unexpected = skippedTitles.filter((title) => !expectedSkips.includes(title));
  if (unexpected.length > 0) {
    throw new Error(`e2e runner: unexpected skipped storefront tests are forbidden: ${unexpected.join(" | ")}`);
  }
  const missingSkips = expectedSkips.filter((title) => !skippedTitles.includes(title));
  if (missingSkips.length > 0) {
    throw new Error(`e2e runner: expected live-checkout tests are missing from the report, so the gate cannot vouch for them: ${missingSkips.join(" | ")}`);
  }
  if (!results.some(({ title, status }) => title === REQUIRED_TEST && status === "passed")) {
    throw new Error(`e2e runner: the required default-path checkout-wiring test did not pass or is absent: ${REQUIRED_TEST}`);
  }

  const passed = results.filter(({ status }) => status === "passed").length;
  const target = process.env.E2E_BASE_URL || "http://localhost:4720";
  console.log(`e2e runner passed: ${passed} passed, 0 failed, ${skipped.length} deliberately skipped against ${target}.`);
  if (!LIVE_CHECKOUT) {
    console.log("Hosted payment behavior is not covered when external checkout tests are skipped.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(runRoot, { recursive: true, force: true });
}

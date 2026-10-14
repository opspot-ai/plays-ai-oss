#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runRoot = mkdtempSync(path.join(tmpdir(), "plays-ai-ops351-unit-"));
const reportPath = path.join(runRoot, "unit-results.json");
const vitestBin = path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "vitest.cmd" : "vitest");
const requiredFiles = [
  "lib/__tests__/plays.test.ts",
  "lib/__tests__/recovery-contract.test.ts",
  "lib/__tests__/refund-revocation.test.ts",
];

try {
  const result = spawnSync(vitestBin, [
    "run",
    "--exclude=lib/__tests__/database.test.ts",
    "--reporter=json",
    `--outputFile=${reportPath}`,
  ], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: 5 * 60 * 1_000,
  });
  if (!existsSync(reportPath)) {
    throw new Error(`unit gate: unit tests produced no machine-readable report.\n${result.stderr || result.stdout || ""}`);
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const reportedFiles = new Set((report.testResults ?? []).map(({ name }) => String(name).replaceAll("\\", "/")));
  for (const required of requiredFiles) {
    if (![...reportedFiles].some((name) => name.endsWith(required))) {
      throw new Error(`unit gate: required test file ${required} was not collected.`);
    }
  }
  if (result.status !== 0 || report.numFailedTests !== 0) {
    throw new Error(`unit gate failed: ${report.numPassedTests ?? 0} passed, ${report.numFailedTests ?? 0} failed, ${report.numPendingTests ?? 0} pending.\n${result.stderr || result.stdout || ""}`);
  }
  if (!Number.isInteger(report.numTotalTests) || report.numTotalTests === 0) {
    throw new Error("unit gate: required unit files reported zero tests.");
  }
  if (report.numPendingTests !== 0) {
    throw new Error(`unit gate: pending or skipped unit tests are forbidden; found ${report.numPendingTests}.`);
  }
  console.log(`unit gate passed: ${report.numPassedTests} passed, 0 failed, 0 pending; ${requiredFiles.length} required files collected.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(runRoot, { recursive: true, force: true });
}

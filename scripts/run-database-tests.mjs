#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import catalog from "../lib/catalog.generated.json" with { type: "json" };
import runtimeRelease from "../lib/runtime-release.generated.json" with { type: "json" };

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lane = process.argv[2] ?? "database";
if (lane !== "database" && lane !== "auth") {
  throw new Error("local integration gate: expected lane 'database' or 'auth'.");
}
const stackProjectId = "plays-ai-ops351-test";
const lockPath = path.join(tmpdir(), "plays-ai-ops351-database.lock");
const lockOwnerPath = path.join(lockPath, "owner.json");
const lockToken = randomUUID();
const runRoot = mkdtempSync(path.join(tmpdir(), "plays-ai-ops351-"));
const reportPath = path.join(runRoot, `${lane}-results.json`);
const latencyReportPath = path.join(runRoot, "fulfillment-latency.json");
const emailExpectationsPath = path.join(runRoot, "fulfillment-email-expectations.json");
const supabaseBin = path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "supabase.cmd" : "supabase");
const vitestBin = path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "vitest.cmd" : "vitest");
const playwrightBin = path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "playwright.cmd" : "playwright");
const supabaseHome = path.join(runRoot, "supabase-cli-home");
const supabaseWorkdir = path.join(runRoot, "project");
const supabaseDir = path.join(supabaseWorkdir, "supabase");
const requiredSupabaseVersion = "2.109.1";
const refundSentinel = "[refund sentinel] full refund revokes entitlement and license in the real schema";
const commandTimeoutMs = 5 * 60 * 1_000;

let lockHeld = false;
let stackStarted = false;
let cleaned = false;
let secrets = [];

const supabaseEnv = {
  ...process.env,
  SUPABASE_HOME: supabaseHome,
  SUPABASE_TELEMETRY_DISABLED: "1",
  DO_NOT_TRACK: "1",
  SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: "ops351-google-secret-fixture",
};

function redact(value) {
  let safe = String(value ?? "");
  for (const secret of secrets) {
    if (secret) safe = safe.split(secret).join("<redacted>");
  }
  return safe
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgresql://<redacted>")
    .replace(/eyJ[A-Za-z0-9._-]{40,}/g, "<redacted-jwt>")
    .replace(/((?:ANON|SERVICE_ROLE|JWT)_?(?:KEY|SECRET)?\s*[:=]\s*)\S+/gi, "$1<redacted>");
}

function command(commandName, args, options = {}) {
  return spawnSync(commandName, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: commandTimeoutMs,
  });
}

function fail(message, result) {
  if (result) {
    const detail = redact(`${result.stdout ?? ""}\n${result.stderr ?? ""}`).trim();
    if (detail) console.error(detail.split("\n").slice(-20).join("\n"));
  }
  throw new Error(message);
}

function preflight() {
  const dockerVersion = command("docker", ["--version"]);
  if (dockerVersion.error?.code === "ENOENT") {
    fail("database gate: Docker CLI missing; install Docker or Colima, then rerun pnpm test.");
  }
  if (dockerVersion.status !== 0) {
    fail("database gate: Docker CLI missing or unusable; install Docker or Colima, then rerun pnpm test.");
  }

  const dockerDaemon = command("docker", ["info", "--format", "{{.ServerVersion}}"]).status;
  if (dockerDaemon !== 0) {
    fail("database gate: Docker daemon unreachable; start Colima or Docker Desktop, then rerun pnpm test.");
  }

  try {
    accessSync(supabaseBin, constants.X_OK);
  } catch {
    fail("database gate: pinned Supabase CLI unavailable; run pnpm install --frozen-lockfile, then rerun pnpm test.");
  }
  mkdirSync(supabaseHome, { recursive: true });
  const supabaseVersion = command(supabaseBin, ["--version"], { env: supabaseEnv });
  if (supabaseVersion.status !== 0 || supabaseVersion.stdout.trim() !== requiredSupabaseVersion) {
    fail("database gate: pinned Supabase CLI unavailable; run pnpm install --frozen-lockfile, then rerun pnpm test.");
  }

  if (lane === "auth") {
    try {
      accessSync(playwrightBin, constants.X_OK);
    } catch {
      fail("auth gate: Playwright unavailable; run pnpm install --frozen-lockfile, then rerun pnpm test:auth.");
    }
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function staleLock() {
  try {
    const owner = JSON.parse(readFileSync(lockOwnerPath, "utf8"));
    return !Number.isInteger(owner.pid) || !processIsAlive(owner.pid);
  } catch {
    return Date.now() - statSync(lockPath).mtimeMs > 30_000;
  }
}

async function acquireLock() {
  const deadline = Date.now() + 10 * 60 * 1_000;
  while (Date.now() < deadline) {
    try {
      mkdirSync(lockPath);
      writeFileSync(lockOwnerPath, JSON.stringify({ pid: process.pid, token: lockToken, cwd: repoRoot, startedAt: new Date().toISOString() }));
      lockHeld = true;
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (staleLock()) {
        rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  fail("database gate: timed out waiting for another Plays database gate to release its cross-worktree lock.");
}

function releaseLock() {
  if (!lockHeld) return;
  try {
    const owner = JSON.parse(readFileSync(lockOwnerPath, "utf8"));
    if (owner.token === lockToken) rmSync(lockPath, { recursive: true, force: true });
  } finally {
    lockHeld = false;
  }
}

function writeSupabaseProject() {
  mkdirSync(supabaseDir, { recursive: true });
  cpSync(path.join(repoRoot, "supabase", "migrations"), path.join(supabaseDir, "migrations"), { recursive: true });
  cpSync(path.join(repoRoot, "supabase", "seed.sql"), path.join(supabaseDir, "seed.sql"));
  writeFileSync(path.join(supabaseDir, "config.toml"), `project_id = "${stackProjectId}"

[api]
enabled = true
port = 56321
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 56322
shadow_port = 56320
major_version = 17

[db.pooler]
enabled = false
port = 56329

[db.migrations]
enabled = true
schema_paths = []

[db.seed]
enabled = true
sql_paths = ["./seed.sql"]

[realtime]
enabled = false

[studio]
enabled = false
port = 56323
api_url = "http://127.0.0.1"

[local_smtp]
enabled = true
port = 56324

[storage]
enabled = true
file_size_limit = "1MiB"

[auth]
enabled = true
site_url = "http://localhost:4720"
additional_redirect_urls = []
enable_signup = true
enable_anonymous_sign_ins = false

[auth.rate_limit]
email_sent = 100
sign_in_sign_ups = 100
token_verifications = 100

[auth.email]
enable_signup = true
enable_confirmations = false

[auth.external.google]
enabled = true
client_id = "ops351-google-client-fixture.apps.googleusercontent.com"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
redirect_uri = ""
url = ""
skip_nonce_check = false
email_optional = false

[edge_runtime]
enabled = false
inspector_port = 56328

[analytics]
enabled = false
port = 56327
backend = "postgres"
`);
}

function stopStack() {
  const result = command(supabaseBin, ["stop", "--project-id", stackProjectId, "--no-backup"], { env: supabaseEnv, cwd: supabaseWorkdir });
  stackStarted = false;
  return result;
}

function startStack() {
  stopStack();
  const excluded = "edge-runtime,imgproxy,logflare,postgres-meta,realtime,studio,supavisor,vector";
  const started = command(supabaseBin, ["start", "--workdir", supabaseWorkdir, "--exclude", excluded, "--yes"], { env: supabaseEnv });
  if (started.status !== 0) fail("database gate: dedicated Supabase test stack failed to start.", started);
  stackStarted = true;
  const reset = command(supabaseBin, ["db", "reset", "--local", "--workdir", supabaseWorkdir], { env: supabaseEnv });
  if (reset.status !== 0) fail("database gate: dedicated Supabase test database failed to reset and migrate.", reset);
}

async function requireMailpit() {
  try {
    const response = await fetch("http://127.0.0.1:56324/api/v1/messages", { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (!body || !Array.isArray(body.messages)) throw new Error("messages response missing");
  } catch (error) {
    fail(`${lane} gate: Mailpit unhealthy at the dedicated local endpoint (${error instanceof Error ? error.message : "unknown error"}).`);
  }
}

async function requireExactMailpitDeliveries() {
  try {
    if (!existsSync(emailExpectationsPath)) {
      throw new Error("the test did not write its per-buyer email expectations");
    }
    const expectations = JSON.parse(readFileSync(emailExpectationsPath, "utf8"));
    const expected = expectations.recipients;
    if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
      throw new Error("the per-buyer email expectations were invalid");
    }
    const response = await fetch("http://127.0.0.1:56324/api/v1/messages?limit=200", { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body.messages) || !Number.isInteger(body.total) || body.messages.length !== body.total) {
      throw new Error(`Mailpit response was incomplete: total=${body.total ?? "unknown"} listed=${body.messages?.length ?? "unknown"}`);
    }
    const actual = {};
    for (const message of body.messages) {
      const recipients = message.To;
      if (!Array.isArray(recipients) || recipients.length !== 1 || typeof recipients[0]?.Address !== "string") {
        throw new Error("a Mailpit fulfillment message did not have exactly one recipient");
      }
      const address = recipients[0].Address.toLowerCase();
      actual[address] = (actual[address] ?? 0) + 1;
    }
    const expectedEntries = Object.entries(expected).sort(([left], [right]) => left.localeCompare(right));
    const unexpected = Object.keys(actual).filter((email) => !(email in expected));
    const mismatched = expectedEntries.filter(([email, count]) => actual[email] !== count);
    if (unexpected.length > 0 || mismatched.length > 0) {
      const mismatchText = mismatched.map(([email, count]) => `${email}: expected ${count}, received ${actual[email] ?? 0}`).join("; ");
      throw new Error(`per-buyer delivery mismatch${mismatchText ? ` (${mismatchText})` : ""}${unexpected.length ? `; unexpected recipients: ${unexpected.join(", ")}` : ""}`);
    }
    const expectedTotal = expectedEntries.reduce((sum, [, count]) => sum + count, 0);
    if (body.total !== expectedTotal) {
      throw new Error(`expected exactly ${expectedTotal} messages, received ${body.total}`);
    }
    console.log(`MAILPIT_DELIVERIES exact_recipients=${expectedEntries.length} exact_messages=${expectedTotal} observed=${body.total}`);
  } catch (error) {
    fail(`database gate: Mailpit per-buyer delivery proof failed (${error instanceof Error ? error.message : "unknown error"}).`);
  }
}

function stackStatus() {
  const result = command(supabaseBin, ["status", "--workdir", supabaseWorkdir, "--output", "json"], { env: supabaseEnv });
  if (result.status !== 0) fail("database gate: dedicated Supabase test stack failed its status check.", result);
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail("database gate: Supabase status did not return JSON.");
  }
}

function statusValue(status, key) {
  const value = status[key];
  if (typeof value !== "string" || value.length === 0) {
    fail(`database gate: Supabase status omitted ${key}.`);
  }
  return value;
}

async function createStorageFixtures(apiUrl, serviceRoleKey) {
  const client = createClient(apiUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const downloadablePlay = catalog.find((play) => play.bundleVersion !== "2.0.0") ?? catalog[0];
  const fixtures = [
    [`${downloadablePlay.slug}/${downloadablePlay.bundleVersion}.tgz`, Buffer.from("generated bundle fixture\n")],
    [runtimeRelease.objectPath, Buffer.from("generated runtime fixture\n")],
  ];
  for (const [objectPath, bytes] of fixtures) {
    const { error } = await client.storage.from("paid-bundles").upload(objectPath, bytes, {
      contentType: "application/gzip",
      upsert: true,
    });
    if (error) fail(`database gate: could not create generated storage fixture ${objectPath}: ${error.message}`);
  }
}

function runDatabaseTests(env) {
  try {
    accessSync(vitestBin, constants.X_OK);
  } catch {
    fail("database gate: Vitest unavailable; run pnpm install --frozen-lockfile, then rerun pnpm test.");
  }
  const result = command(vitestBin, [
    "run",
    "lib/__tests__/database.test.ts",
    "--reporter=json",
    `--outputFile=${reportPath}`,
  ], { env: { ...process.env, ...env } });
  if (!existsSync(reportPath)) fail("database gate: database test file produced no machine-readable report.", result);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const assertions = report.testResults?.flatMap((testFile) => testFile.assertionResults ?? []) ?? [];
  const sentinel = assertions.find((assertion) => assertion.title === refundSentinel || assertion.fullName?.includes(refundSentinel));
  const databaseFileReported = report.testResults?.some((testFile) => testFile.name?.endsWith("lib/__tests__/database.test.ts"));

  if (result.status !== 0 || report.numFailedTests !== 0) {
    fail(`database gate failed: ${report.numPassedTests ?? 0} passed, ${report.numFailedTests ?? 0} failed, ${report.numPendingTests ?? 0} pending.`, result);
  }
  if (!databaseFileReported || !Number.isInteger(report.numTotalTests) || report.numTotalTests === 0) {
    fail("database gate: database test file reported zero tests.");
  }
  if (report.numPendingTests !== 0) {
    fail(`database gate: pending or skipped database tests are forbidden; found ${report.numPendingTests}.`);
  }
  if (!sentinel || sentinel.status !== "passed") {
    fail("database gate: required real-schema refund sentinel was missing or did not pass.");
  }
  if (!existsSync(latencyReportPath)) fail("database gate: the full-catalog fulfillment latency measurement was missing.", result);
  const latency = JSON.parse(readFileSync(latencyReportPath, "utf8"));
  if (latency.sample !== catalog.length || !Number.isFinite(latency.p99Ms) || !Number.isFinite(latency.maxMs)) {
    fail("database gate: the full-catalog fulfillment latency measurement was invalid.");
  }
  console.log(`FULFILLMENT_LATENCY sample=${latency.sample} p99_ms=${latency.p99Ms.toFixed(1)} max_ms=${latency.maxMs.toFixed(1)}`);
  console.log(`database gate passed: ${report.numPassedTests} passed, 0 failed, 0 pending; refund sentinel passed.`);
}

function playwrightResults(report) {
  const results = [];
  function visitSuite(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          results.push({ file: spec.file ?? suite.file ?? "", title: spec.title ?? "", status: result.status });
        }
        if ((test.results ?? []).length === 0) {
          results.push({ file: spec.file ?? suite.file ?? "", title: spec.title ?? "", status: "skipped" });
        }
      }
    }
    for (const child of suite.suites ?? []) visitSuite(child);
  }
  for (const suite of report.suites ?? []) visitSuite(suite);
  return results;
}

function runAuthTests(env) {
  const result = command(playwrightBin, [
    "test",
    "--config=playwright.auth.config.ts",
    "--reporter=json",
  ], { env: { ...process.env, ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath } });

  if (!existsSync(reportPath)) {
    fail("auth gate: local Playwright web server failed before producing a machine-readable report.", result);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    fail("auth gate: Playwright did not produce valid machine-readable JSON.", result);
  }
  const results = playwrightResults(report);
  const authResults = results.filter(({ file }) => file.endsWith("e2e/auth.spec.ts") || file.endsWith("auth.spec.ts"));
  const failed = authResults.filter(({ status }) => status !== "passed");
  const skipped = authResults.filter(({ status }) => status === "skipped");
  if (result.status !== 0 || failed.length > 0) {
    fail(`auth gate failed: ${authResults.length - failed.length} passed, ${failed.length} failed or interrupted, ${skipped.length} skipped.`, result);
  }
  if (authResults.length === 0) fail("auth gate: auth.spec.ts reported zero tests.");
  if (skipped.length > 0) fail(`auth gate: skipped auth tests are forbidden; found ${skipped.length}.`);
  console.log(`auth gate passed: ${authResults.length} passed, 0 failed, 0 skipped.`);
}

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (stackStarted) stopStack();
  rmSync(runRoot, { recursive: true, force: true });
  releaseLock();
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    cleanup();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

try {
  preflight();
  await acquireLock();
  writeSupabaseProject();
  startStack();
  const status = stackStatus();
  const apiUrl = statusValue(status, "API_URL");
  const databaseUrl = statusValue(status, "DB_URL");
  const anonKey = statusValue(status, "ANON_KEY");
  const serviceRoleKey = statusValue(status, "SERVICE_ROLE_KEY");
  secrets = [databaseUrl, anonKey, serviceRoleKey];
  await requireMailpit();
  await createStorageFixtures(apiUrl, serviceRoleKey);
  const testEnv = {
    TEST_DATABASE_URL: databaseUrl,
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    NEXT_PUBLIC_SITE_URL: "http://localhost:4720",
    NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: "true",
    TEST_MAILPIT_URL: "http://127.0.0.1:56324",
    FULFILLMENT_ENABLED: "true",
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: "sk_test_fixture",
    STRIPE_WEBHOOK_SECRET: "whsec_fixture",
    DEVICE_CODE_SECRET: "ops351-device-code-fixture",
    BUNDLE_STORAGE_BUCKET: "paid-bundles",
    CRON_SECRET: "test-only-placeholder-cron-secret",
    TEST_FULFILLMENT_LATENCY_PATH: latencyReportPath,
    TEST_FULFILLMENT_EMAIL_EXPECTATIONS_PATH: emailExpectationsPath,
  };
  if (lane === "database") {
    runDatabaseTests(testEnv);
    await requireExactMailpitDeliveries();
  } else {
    runAuthTests(testEnv);
  }
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : error));
  process.exitCode = 1;
} finally {
  cleanup();
}

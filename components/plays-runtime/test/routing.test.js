import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { install } from "../dist/core.js";
import { resolveProvider } from "../dist/routing.js";
import { ProviderExhausted, runBundle } from "../dist/runner.js";

const reference = new URL("./fixtures/reference-loop", import.meta.url).pathname;

function config(providers, order = Object.keys(providers)) {
  return { providers, routing: { order, spillover: true, on_all_exhausted: "pause-and-resume" } };
}

async function project(toml) {
  const root = await mkdtemp(path.join(tmpdir(), "plays-routing-test-"));
  await install(root, reference, true);
  await writeFile(path.join(root, "plays.toml"), toml);
  return root;
}

const twoProviders = `
[providers.first]
kind = "subscription"
exec = "codex exec"
tiers = ["cheap", "working", "frontier"]
needs = ["json-out"]

[providers.second]
kind = "subscription"
exec = "claude -p"
tiers = ["cheap", "working", "frontier"]
needs = ["json-out"]

[routing]
order = ["first", "second"]
spillover = true
on_all_exhausted = "pause-and-resume"
`;

test("rule 1: tier, needs, order, and reserve_for select the eligible provider", () => {
  const result = resolveProvider(
    { step: "01-work", player: "scout", tier: "working", needs: ["json-out"], est_tokens: 1 },
    config({
      reserved: { kind: "subscription", exec: "claude -p", tiers: ["working", "frontier"], needs: ["json-out"], reserve_for: ["frontier"] },
      eligible: { kind: "subscription", exec: "codex exec", tiers: ["working"], needs: ["json-out"] },
    }),
  );
  assert.equal(result.provider?.name, "eligible");
});

test("rule 2: subscription-first beats an earlier metered endpoint", () => {
  const result = resolveProvider(
    { step: "01-work", player: "scout", tier: "working", est_tokens: 1 },
    config({
      metered: { kind: "endpoint", base_url: "http://127.0.0.1:9", model: "fixture", tiers: ["working"], cost_per_1k: 1 },
      seat: { kind: "subscription", exec: "codex exec", tiers: ["working"] },
    }),
  );
  assert.equal(result.provider?.name, "seat");
});

test("rule 3: must_differ_from uses a second provider when one exists", () => {
  const result = resolveProvider(
    { step: "02-review", player: "redpen", tier: "working", est_tokens: 1, must_differ_from: "01-draft" },
    config({
      first: { kind: "subscription", exec: "codex exec", tiers: ["working"] },
      second: { kind: "subscription", exec: "claude -p", tiers: ["working"] },
    }),
    { "01-draft": "first" },
  );
  assert.equal(result.provider?.name, "second");
});

test("rule 4: invalid cheap output escalates exactly once, then fails loud", async () => {
  const root = await project(twoProviders);
  const attempts = [];
  const receipt = await runBundle(root, "reference-loop", {
    dispatch: async (provider, _prompt, step) => {
      attempts.push(`${step.tier}:${provider.name}`);
      return "not json";
    },
  });
  assert.equal(receipt.outcome, "failed");
  assert.deepEqual(attempts, ["cheap:first", "working:first"]);
  assert.equal(receipt.steps.filter((step) => step.outcome === "invalid").length, 2);
  assert.match(receipt.reason, /schema invalid after 2/);
});

test("rule 5: exhaustion spills over, then all-exhausted pauses and resumes at the cursor", async () => {
  const root = await project(twoProviders);
  const receipt = await runBundle(root, "reference-loop", {
    dispatch: async (provider, _prompt, step) => {
      if (provider.name === "first") throw new ProviderExhausted("fixture exhaustion");
      return step.validate ? JSON.stringify({ facts: ["synthetic"] }) : "synthetic output";
    },
  });
  assert.equal(receipt.outcome, "completed");
  assert(receipt.steps.some((step) => step.provider === "first" && step.outcome === "exhausted"));
  assert(receipt.providersUsed.includes("second"));

  const pausedRoot = await project(twoProviders.replaceAll('needs = ["json-out"]', 'needs = ["json-out"]\nexhausted = true'));
  const paused = await runBundle(pausedRoot, "reference-loop", { dispatch: async () => "must not run" });
  assert.equal(paused.outcome, "paused");
  assert.equal(paused.cursor, 0);

  await writeFile(path.join(pausedRoot, "plays.toml"), twoProviders);
  const resumed = await runBundle(pausedRoot, "reference-loop", {
    dispatch: async (_provider, _prompt, step) => step.validate ? JSON.stringify({ facts: ["resumed"] }) : "resumed output",
  });
  assert.equal(resumed.outcome, "completed");
  assert.equal(resumed.cursor, 4);
});

test("rule 6: caps bind before dispatch", async () => {
  const root = await project(`
[providers.metered]
kind = "endpoint"
base_url = "http://127.0.0.1:9"
model = "fixture"
tiers = ["cheap", "working", "frontier"]
cost_per_1k = 1

[routing]
order = ["metered"]
spillover = true
on_all_exhausted = "pause-and-resume"

[caps]
per_run_usd_max = 0
`);
  let calls = 0;
  const receipt = await runBundle(root, "reference-loop", { dispatch: async () => { calls += 1; return "{}"; } });
  assert.equal(receipt.outcome, "failed");
  assert.equal(calls, 0);
  assert.match(receipt.reason, /cap blocked/);
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";
import { install } from "../dist/core.js";
import { runBundle } from "../dist/runner.js";

const reference = new URL("./fixtures/reference-loop", import.meta.url).pathname;

const subscription = `
[providers.seat]
kind = "subscription"
exec = "codex exec"
tiers = ["cheap", "working", "frontier"]
needs = ["json-out"]

[routing]
order = ["seat"]
spillover = true
on_all_exhausted = "pause-and-resume"
`;

async function project(toml) {
  const root = await mkdtemp(path.join(tmpdir(), "plays-enforcement-test-"));
  await install(root, reference, true);
  await writeFile(path.join(root, "plays.toml"), toml);
  return root;
}

const okDispatch = async (_provider, _prompt, step) =>
  step.validate ? JSON.stringify({ facts: ["synthetic"] }) : "synthetic output";

test("caps reach deterministic tools as PLAYS_CAP_* env, overrides first", async () => {
  const root = await project(`${subscription}
[caps]
daily_credit_cap = 7
`);
  const tool = path.join(root, ".plays", "reference-loop", "tools", "package.mjs");
  await writeFile(tool, [
    "import { mkdir, writeFile } from \"node:fs/promises\";",
    "await mkdir(\"output\", { recursive: true });",
    "await writeFile(\"output/caps-seen.txt\", `${process.env.PLAYS_CAP_DAILY_CREDIT_CAP} ${process.env.PLAYS_CAP_PER_RUN_USD_MAX}`);",
    "console.log(\"package written\");",
  ].join("\n"));

  const receipt = await runBundle(root, "reference-loop", { dispatch: okDispatch });
  assert.equal(receipt.outcome, "completed");
  const seen = await readFile(path.join(root, "output", "caps-seen.txt"), "utf8");
  assert.equal(seen, "7 1", "the plays.toml override and the manifest default both arrive");
});

// Rewrites the installed reference loop so a deterministic gate sits between extract and draft,
// which is the v1.1 shape: the draft step is dispatched only on the gate's proceed decision.
async function gatedProject(gateOutput) {
  const root = await project(subscription);
  const bundle = path.join(root, ".plays", "reference-loop");

  await writeFile(path.join(bundle, "tools", "gate.mjs"), `console.log("${gateOutput}");\n`);

  const manifestFile = path.join(bundle, "play.yaml");
  const manifest = YAML.parse(await readFile(manifestFile, "utf8"));
  manifest.routing = [
    { step: "01-extract", player: "scout", tier: "cheap", est_tokens: 500, validate: "schemas/facts.json" },
    { step: "02-gate", player: "scribe", tier: "none", deterministic: "tools/gate.mjs" },
    { step: "03-draft", player: "scribe", tier: "working", est_tokens: 800, gated_by: "02-gate" },
    { step: "04-package", player: "scribe", tier: "none", deterministic: "tools/package.mjs" },
  ];
  await writeFile(manifestFile, YAML.stringify(manifest, { lineWidth: 0 }));

  const teamFile = path.join(bundle, "team.yaml");
  const team = YAML.parse(await readFile(teamFile, "utf8"));
  for (const member of team.lineup) {
    if (member.player === "scribe") member.steps = ["02-gate", "03-draft", "04-package"];
  }
  await writeFile(teamFile, YAML.stringify(team, { lineWidth: 0 }));
  return root;
}

test("a gated step is skipped, not dispatched, when the gate does not say proceed", async () => {
  const root = await gatedProject("held fixture: the license is not armed");
  const dispatched = [];
  const receipt = await runBundle(root, "reference-loop", {
    dispatch: async (provider, prompt, step) => {
      dispatched.push(step.step);
      return okDispatch(provider, prompt, step);
    },
  });
  assert.equal(receipt.outcome, "completed");
  assert.deepEqual(dispatched, ["01-extract"], "the draft step must never reach a provider");
  const skipped = receipt.steps.find((step) => step.step === "03-draft");
  assert.equal(skipped.outcome, "skipped");
  assert.equal(skipped.provider, "gated");
  assert.equal(receipt.steps.find((step) => step.step === "04-package").outcome, "completed");
  assert.ok(!receipt.providersUsed.includes("gated"), "a skip is not a provider");
});

test("a gated step dispatches normally on a proceed decision", async () => {
  const root = await gatedProject("proceed fixture: caps clear");
  const dispatched = [];
  const receipt = await runBundle(root, "reference-loop", {
    dispatch: async (provider, prompt, step) => {
      dispatched.push(step.step);
      return okDispatch(provider, prompt, step);
    },
  });
  assert.equal(receipt.outcome, "completed");
  assert.deepEqual(dispatched, ["01-extract", "03-draft"]);
  assert.equal(receipt.steps.find((step) => step.step === "03-draft").outcome, "completed");
});

test("a gate that never completed fails the run loud instead of dispatching", async () => {
  const root = await gatedProject("proceed fixture: caps clear");
  const bundle = path.join(root, ".plays", "reference-loop");
  const manifestFile = path.join(bundle, "play.yaml");
  const manifest = YAML.parse(await readFile(manifestFile, "utf8"));
  // Point the gated step at a step id that exists nowhere, so no completion can ever be found.
  manifest.routing[2].gated_by = "09-nowhere";
  await writeFile(manifestFile, YAML.stringify(manifest, { lineWidth: 0 }));

  const receipt = await runBundle(root, "reference-loop", { dispatch: okDispatch });
  assert.equal(receipt.outcome, "failed");
  assert.match(receipt.reason, /gated by 09-nowhere/);
});

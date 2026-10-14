import assert from "node:assert/strict";
import { access, cp, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { doctor, install } from "../dist/core.js";
import { validateBundle } from "../dist/core.js";
import { activate } from "../dist/activation.js";
import { runBundle } from "../dist/runner.js";

const reference = new URL("./fixtures/reference-loop", import.meta.url).pathname;

async function project() {
  return mkdtemp(path.join(tmpdir(), "plays-cli-test-"));
}

test("install is bounded, idempotent, and generates idempotent Mode A adapters", async () => {
  const root = await project();
  await writeFile(path.join(root, "AGENTS.md"), "# My project\n\nnotes\n");
  assert.equal((await install(root, reference, true)).changed, true);
  assert.equal((await install(root, reference)).changed, false);
  assert.equal((await install(root, reference, true)).changed, true);

  const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
  assert.equal(agents.split("plays:begin reference-loop").length - 1, 1);
  assert.equal(agents.split("\n")[0], "# My project");
  assert.match(await readFile(path.join(root, ".claude/agents/reference-loop-scribe.md"), "utf8"), /Position: quarterback/i);
  assert.match(await readFile(path.join(root, ".codex/agents/reference-loop-redpen.toml"), "utf8"), /safety/i);
  assert.match(await readFile(path.join(root, ".cursor/rules/play-reference-loop.mdc"), "utf8"), /team\.yaml/i);
  assert.match(await readFile(path.join(root, ".plays-local/reference-loop/players/README.md"), "utf8"), /survive/i);
  assert((await stat(path.join(root, ".plays/bin/reference-loop"))).mode & 0o100);
  assert.match(await readFile(path.join(root, ".gitignore"), "utf8"), /^\.plays\/state\/$/m);
  assert.equal(await doctor(root, "reference-loop"), false);
});

test("verify completes offline with no configured provider", async () => {
  const root = await project();
  await install(root, reference, true);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network forbidden during verify"); };
  try {
    const receipt = await runBundle(root, "reference-loop", { verify: true });
    assert.equal(receipt.outcome, "completed");
    assert.equal(receipt.team, "Reference Team");
    assert(receipt.steps.every((step) => step.player && step.position));
    assert.deepEqual(receipt.providersUsed, ["offline-verify"]);
    await access(path.join(root, "output/brief.md"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("missing required tools fail before model dispatch", async () => {
  const root = await project();
  await install(root, reference, true);
  const manifestFile = path.join(root, ".plays/reference-loop/play.yaml");
  const manifest = (await readFile(manifestFile, "utf8"))
    .replace('binding: {kind: builtin, path_scope: "{{data.output}}"}', "binding: {kind: executable, command: plays-definitely-missing}");
  await writeFile(manifestFile, manifest);
  await writeFile(path.join(root, "plays.toml"), `
[providers.fixture]
kind = "subscription"
exec = "codex exec"
tiers = ["cheap", "working", "frontier"]
needs = ["json-out", "judgment"]

[routing]
order = ["fixture"]
spillover = true
on_all_exhausted = "pause-and-resume"
`);
  let dispatches = 0;
  const receipt = await runBundle(root, "reference-loop", {
    dispatch: async () => {
      dispatches += 1;
      return "{}";
    },
  });
  assert.equal(receipt.outcome, "failed");
  assert.match(receipt.reason, /unmet requirement before dispatch/);
  assert.equal(dispatches, 0);
});

test("schema and Team semantics fail closed", async () => {
  const cases = [
    ["routing without Player", "play.yaml", (text) => text.replace("player: scout, ", "")],
    ["unknown Player", "play.yaml", (text) => text.replace("player: scout", "player: ghost")],
    ["duplicate Player", "team.yaml", (text) => text.replace(
      "handoffs:",
      "  - player: scout\n    position: wide-receiver\n    assignment: Duplicate.\n    steps: [01-extract]\nhandoffs:",
    )],
    ["missing quarterback", "team.yaml", (text) => text.replace("position: quarterback", "position: safety")],
    ["invalid handoff", "team.yaml", (text) => text.replace("from: scout", "from: ghost")],
    ["unsafe handoff path", "team.yaml", (text) => text.replace("schemas/facts.json", "../facts.json")],
  ];
  for (const [name, file, change] of cases) {
    const directory = await project();
    await cp(reference, directory, { recursive: true });
    const target = path.join(directory, file);
    await writeFile(target, change(await readFile(target, "utf8")));
    await assert.rejects(() => validateBundle(directory), undefined, name);
  }
});

test("native activation previews first, confirms idempotently, and backs up changed files", async () => {
  const root = await project();
  await install(root, reference, true);
  const hermesHome = await project();
  const openclawHome = await project();
  process.env.PLAYS_HERMES_HOME = hermesHome;
  process.env.PLAYS_OPENCLAW_HOME = openclawHome;
  try {
    await activate(root, "reference-loop", "hermes", false);
    assert.equal((await readdir(hermesHome)).length, 0);
    await activate(root, "reference-loop", "hermes", true);
    await activate(root, "reference-loop", "hermes", true);
    const profiles = await readdir(path.join(hermesHome, "profiles"));
    assert.equal(profiles.length, 3);
    const soul = path.join(hermesHome, "profiles", profiles[0], "SOUL.md");
    await writeFile(soul, "buyer changed this\n");
    await activate(root, "reference-loop", "hermes", true);
    assert((await readdir(path.dirname(soul))).some((file) => file.startsWith("SOUL.md.bak-")));

    await activate(root, "reference-loop", "openclaw", false);
    await assert.rejects(() => access(path.join(openclawHome, "openclaw.json")));
    await activate(root, "reference-loop", "openclaw", true);
    await activate(root, "reference-loop", "openclaw", true);
    const config = JSON.parse(await readFile(path.join(openclawHome, "openclaw.json"), "utf8"));
    assert.equal(config.agents.list.length, 3);
  } finally {
    delete process.env.PLAYS_HERMES_HOME;
    delete process.env.PLAYS_OPENCLAW_HOME;
  }
});

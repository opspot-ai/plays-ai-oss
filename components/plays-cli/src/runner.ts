import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { bundlePath, doctor, loadConfig, loadManifest } from "./core.js";
import { frontierEquivalent, nextTier, planRoute, providerMarginalUsd, resolveProvider } from "./routing.js";
import type { PlayManifest, PlaysConfig, Provider, RoutingStep, RunReceipt, StepReceipt } from "./types.js";

export class ProviderExhausted extends Error {}

export type Dispatcher = (provider: Provider, prompt: string, step: RoutingStep) => Promise<string>;

interface Cursor {
  slug: string;
  runId: string;
  startedAt: string;
  nextIndex: number;
  steps: StepReceipt[];
  outputs: Record<string, string>;
  marginalUsd: number;
  creditUsed: number;
}

function promptFor(manifest: PlayManifest, step: RoutingStep, instruction: string, fixture: string, prior: string[]): string {
  return [
    `Play: ${manifest.name}`,
    `Outcome: ${manifest.outcome}`,
    `Step: ${step.step}`,
    instruction,
    fixture ? `Synthetic/input context:\n${fixture}` : "",
    prior.length ? `Prior step outputs:\n${prior.join("\n\n")}` : "",
    step.validate ? "Return only JSON matching the referenced schema." : "",
  ].filter(Boolean).join("\n\n");
}

function parseCommand(exec: string, prompt: string): { command: string; args: string[] } {
  if (exec === "claude -p") return { command: "claude", args: ["-p", prompt] };
  if (exec === "codex exec") return { command: "codex", args: ["exec", "--skip-git-repo-check", prompt] };
  throw new Error(`unsupported subscription exec: ${exec}`);
}

export async function dispatchProvider(provider: Provider, prompt: string): Promise<string> {
  if (provider.kind === "endpoint") {
    if (!provider.base_url || !provider.model) throw new Error(`${provider.name} endpoint is incomplete`);
    const response = await fetch(`${provider.base_url.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: provider.model, messages: [{ role: "user", content: prompt }] }),
    });
    if (response.status === 429) throw new ProviderExhausted(`${provider.name} exhausted`);
    if (!response.ok) throw new Error(`${provider.name} failed (${response.status})`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const output = body.choices?.[0]?.message?.content;
    if (!output) throw new Error(`${provider.name} returned no content`);
    return output;
  }
  if (!provider.exec) throw new Error(`${provider.name} has no exec binding`);
  const { command, args } = parseCommand(provider.exec, prompt);
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.status !== 0) {
    if (/rate.?limit|exhaust|quota|usage limit/i.test(output)) throw new ProviderExhausted(`${provider.name} exhausted`);
    throw new Error(`${provider.name} exited ${result.status}: ${output.slice(0, 500)}`);
  }
  return result.stdout.trim();
}

function jsonFromOutput(output: string): unknown {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced ? fenced[1] : output);
}

async function outputValid(bundle: string, schemaFile: string | undefined, output: string): Promise<boolean> {
  if (!schemaFile) return true;
  try {
    const schema = JSON.parse(await readFile(path.join(bundle, schemaFile), "utf8"));
    return new Ajv2020({ strict: false }).compile(schema)(jsonFromOutput(output)) as boolean;
  } catch {
    return false;
  }
}

function sampleForSchema(schema: Record<string, unknown>): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  if (schema.type === "object" || schema.properties) {
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    return Object.fromEntries((schema.required as string[] ?? Object.keys(properties)).map((key) => [
      key,
      sampleForSchema(properties[key] ?? { type: "string" }),
    ]));
  }
  if (schema.type === "array") return [sampleForSchema((schema.items ?? { type: "string" }) as Record<string, unknown>)];
  if (schema.type === "integer" || schema.type === "number") return Math.max(Number(schema.minimum ?? 1), 1);
  if (schema.type === "boolean") return true;
  return "verified fixture output";
}

async function verifyDispatcher(bundle: string, _provider: Provider, _prompt: string, step: RoutingStep): Promise<string> {
  if (!step.validate) return "verified fixture step";
  const schema = JSON.parse(await readFile(path.join(bundle, step.validate), "utf8")) as Record<string, unknown>;
  return JSON.stringify(sampleForSchema(schema));
}

async function runDeterministic(root: string, bundle: string, relative: string): Promise<string> {
  const script = path.join(bundle, relative);
  const command = script.endsWith(".py") ? "python3" : "node";
  const result = spawnSync(command, [script], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${relative} exited ${result.status}: ${result.stderr.trim()}`);
  return result.stdout.trim() || `${relative} completed`;
}

async function fixtureText(bundle: string): Promise<string> {
  try {
    return await readFile(path.join(bundle, "fixtures", "smoke", "input.txt"), "utf8");
  } catch {
    return "";
  }
}

function cap(manifest: PlayManifest, config: PlaysConfig, id: string): number {
  return config.caps?.[id] ?? manifest.requires.caps.find((item) => item.id === id)?.default ?? Number.POSITIVE_INFINITY;
}

async function writeReceipt(root: string, cursor: Cursor, manifest: PlayManifest, outcome: RunReceipt["outcome"], reason?: string): Promise<RunReceipt> {
  const equivalent = frontierEquivalent(manifest);
  const receipt: RunReceipt = {
    runId: cursor.runId,
    play: manifest.play,
    startedAt: cursor.startedAt,
    finishedAt: new Date().toISOString(),
    outcome,
    steps: cursor.steps,
    providersUsed: [...new Set(cursor.steps.filter((step) => step.provider !== "deterministic").map((step) => step.provider))],
    marginalUsd: Number(cursor.marginalUsd.toFixed(4)),
    allFrontierApiEquivalentUsd: equivalent,
    savingsUsd: Number((equivalent - cursor.marginalUsd).toFixed(4)),
    cursor: cursor.nextIndex,
    ...(reason ? { reason } : {}),
  };
  const receipts = path.join(root, ".plays", "state", "receipts");
  await mkdir(receipts, { recursive: true });
  await writeFile(path.join(receipts, `${cursor.runId}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

async function saveCursor(root: string, cursor: Cursor): Promise<void> {
  const state = path.join(root, ".plays", "state");
  await mkdir(state, { recursive: true });
  await writeFile(path.join(state, "cursor.json"), `${JSON.stringify(cursor, null, 2)}\n`);
}

async function loadCursor(root: string, slug: string): Promise<Cursor | null> {
  try {
    const cursor = JSON.parse(await readFile(path.join(root, ".plays", "state", "cursor.json"), "utf8")) as Cursor;
    return cursor.slug === slug && cursor.nextIndex >= 0 ? cursor : null;
  } catch {
    return null;
  }
}

async function dailyCreditUsed(root: string, runId: string): Promise<number> {
  const directory = path.join(root, ".plays", "state", "receipts");
  const today = new Date().toISOString().slice(0, 10);
  let used = 0;
  try {
    // ponytail: linear receipt scan; add a usage ledger only if daily receipt volume makes this slow.
    for (const file of await readdir(directory)) {
      const receipt = JSON.parse(await readFile(path.join(directory, file), "utf8")) as RunReceipt;
      if (receipt.runId === runId || !receipt.startedAt.startsWith(today)) continue;
      used += receipt.steps.filter((step) => step.outcome === "completed" && step.provider !== "deterministic").length;
    }
  } catch {
    return 0;
  }
  return used;
}

async function killed(root: string, slug: string): Promise<boolean> {
  try {
    await access(path.join(root, ".plays", "state", `${slug}.killed`));
    return true;
  } catch {
    return false;
  }
}

export async function runBundle(
  root: string,
  slug: string,
  options: { verify?: boolean; dispatch?: Dispatcher } = {},
): Promise<RunReceipt> {
  const manifest = await loadManifest(root, slug);
  const bundle = bundlePath(root, slug);
  const config = await loadConfig(root);
  const existing = options.verify ? null : await loadCursor(root, slug);
  const cursor: Cursor = existing && existing.nextIndex < manifest.routing.length ? existing : {
    slug,
    runId: `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
    startedAt: new Date().toISOString(),
    nextIndex: 0,
    steps: [],
    outputs: {},
    marginalUsd: 0,
    creditUsed: 0,
  };
  if (!options.verify && !await doctor(root, slug)) {
    return writeReceipt(root, cursor, manifest, "failed", "doctor found an unmet requirement before dispatch");
  }
  const selected = Object.fromEntries(cursor.steps.filter((step) => step.outcome === "completed").map((step) => [step.step, step.provider]));
  const fixture = await fixtureText(bundle);
  const dispatch = options.dispatch ?? dispatchProvider;
  const perRunUsdMax = cap(manifest, config, "per_run_usd_max");
  const dailyCreditCap = cap(manifest, config, "daily_credit_cap");
  const historicalCreditUsed = await dailyCreditUsed(root, cursor.runId);
  const endIndex = Math.min(manifest.routing.length, cursor.nextIndex + manifest.loop.max_steps_per_run);

  for (let index = cursor.nextIndex; index < endIndex; index += 1) {
    if (await killed(root, slug)) {
      cursor.nextIndex = index;
      await saveCursor(root, cursor);
      return writeReceipt(root, cursor, manifest, "failed", `kill file present for ${slug}`);
    }
    const original = manifest.routing[index];
    if (original.tier === "none" && original.deterministic) {
      try {
        cursor.outputs[original.step] = await runDeterministic(root, bundle, original.deterministic);
        cursor.steps.push({ step: original.step, tier: "none", provider: "deterministic", tokens: 0, marginalUsd: 0, attempt: 1, outcome: "completed" });
        cursor.nextIndex = index + 1;
        await saveCursor(root, cursor);
        continue;
      } catch (error) {
        cursor.steps.push({ step: original.step, tier: "none", provider: "deterministic", tokens: 0, marginalUsd: 0, attempt: 1, outcome: "failed" });
        return writeReceipt(root, cursor, manifest, "failed", (error as Error).message);
      }
    }

    let step = original;
    let attempt = 1;
    let escalatedFrom: string | undefined;
    const exhausted = new Set<string>();
    while (true) {
      const resolution = options.verify
        ? { provider: { name: "offline-verify", kind: "subscription" as const, exec: "codex exec", tiers: [step.tier] } }
        : resolveProvider(step, config, selected, exhausted);
      if (resolution.warning) console.warn(resolution.warning);
      const provider = resolution.provider;
      if (!provider) {
        cursor.nextIndex = index;
        await saveCursor(root, cursor);
        return writeReceipt(root, cursor, manifest, "paused", `all declared providers exhausted for ${step.step}`);
      }
      const tokens = step.est_tokens ?? 0;
      const marginalUsd = providerMarginalUsd(provider, tokens);
      if (cursor.marginalUsd + marginalUsd > perRunUsdMax || historicalCreditUsed + cursor.creditUsed + 1 > dailyCreditCap) {
        cursor.nextIndex = index;
        await saveCursor(root, cursor);
        return writeReceipt(root, cursor, manifest, "failed", `cap blocked ${step.step} before dispatch`);
      }

      let output: string;
      try {
        const instructionFile = path.join(bundle, "steps", `${step.step}.md`);
        let instruction = "";
        try { instruction = await readFile(instructionFile, "utf8"); } catch {}
        const prompt = promptFor(manifest, step, instruction, fixture, Object.values(cursor.outputs));
        output = options.verify
          ? await verifyDispatcher(bundle, provider, prompt, step)
          : await dispatch(provider, prompt, step);
      } catch (error) {
        if (error instanceof ProviderExhausted && config.routing.spillover) {
          exhausted.add(provider.name);
          cursor.steps.push({ step: step.step, tier: step.tier, provider: provider.name, tokens: 0, marginalUsd: 0, attempt, outcome: "exhausted" });
          continue;
        }
        cursor.steps.push({ step: step.step, tier: step.tier, provider: provider.name, tokens: 0, marginalUsd: 0, attempt, outcome: "failed", ...(escalatedFrom ? { escalatedFrom } : {}) });
        cursor.nextIndex = index;
        await saveCursor(root, cursor);
        return writeReceipt(root, cursor, manifest, "failed", (error as Error).message);
      }

      cursor.marginalUsd += marginalUsd;
      cursor.creditUsed += 1;
      if (!await outputValid(bundle, step.validate, output)) {
        cursor.steps.push({ step: step.step, tier: step.tier, provider: provider.name, tokens, marginalUsd, attempt, outcome: "invalid", ...(escalatedFrom ? { escalatedFrom } : {}) });
        if (attempt === 1 && manifest.models.policy.escalate_on_invalid && step.tier === "cheap") {
          const higher = nextTier(manifest, step.tier);
          if (higher) {
            escalatedFrom = step.tier;
            step = { ...step, tier: higher };
            attempt = 2;
            continue;
          }
        }
        cursor.nextIndex = index;
        await saveCursor(root, cursor);
        return writeReceipt(root, cursor, manifest, "failed", `${step.step} schema invalid after ${attempt} attempt(s)`);
      }

      cursor.outputs[step.step] = output;
      cursor.steps.push({ step: step.step, tier: step.tier, provider: provider.name, tokens, marginalUsd, attempt, outcome: "completed", ...(escalatedFrom ? { escalatedFrom } : {}) });
      selected[step.step] = provider.name;
      cursor.nextIndex = index + 1;
      await saveCursor(root, cursor);
      break;
    }
  }
  if (cursor.nextIndex < manifest.routing.length) {
    await saveCursor(root, cursor);
    return writeReceipt(root, cursor, manifest, "paused", "max_steps_per_run reached");
  }
  return writeReceipt(root, cursor, manifest, "completed");
}

export async function explainRoute(root: string, slug: string): Promise<void> {
  const manifest = await loadManifest(root, slug);
  const config = await loadConfig(root);
  console.log("step             tier       provider           est tokens   marginal $");
  let total = 0;
  for (const item of planRoute(manifest, config)) {
    total += item.marginalUsd;
    console.log(
      `${item.step.step.padEnd(16)} ${item.step.tier.padEnd(10)} ${(item.provider?.name ?? item.step.deterministic ?? "UNROUTED").padEnd(18)} ${String(item.step.est_tokens ?? "—").padStart(10)}   ${item.marginalUsd.toFixed(2).padStart(10)}`,
    );
    if (item.warning) console.warn(item.warning);
  }
  const equivalent = frontierEquivalent(manifest);
  console.log(`all-frontier-API equivalent: ~$${equivalent.toFixed(2)}/run     $${total.toFixed(2)}/run`);
}

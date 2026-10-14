#!/usr/bin/env node
import path from "node:path";
import { doctor, install, login, validateBundle } from "./core.js";
import { activate, type NativeHarness } from "./activation.js";
import { explainRoute, runBundle } from "./runner.js";

function usage(): never {
  console.error("usage: plays <login|install|update|doctor|verify|route|run|activate|validate> [play|path]");
  process.exit(2);
}

async function main(): Promise<void> {
  const [command, argument, ...flags] = process.argv.slice(2);
  const root = process.cwd();
  if (!command) usage();

  if (command === "login") {
    await login(argument);
    return;
  }
  if (command === "validate") {
    if (!argument) usage();
    const result = await validateBundle(path.resolve(argument));
    console.log(`${result.manifest.play}@${result.manifest.version}: valid playbundle/v2`);
    return;
  }
  if (!argument) usage();

  if (command === "install") {
    await install(root, argument, flags.includes("--force"));
    return;
  }
  if (command === "update") {
    await install(root, argument, true);
    return;
  }
  if (command === "doctor") {
    if (!await doctor(root, argument)) process.exitCode = 1;
    return;
  }
  if (command === "verify") {
    const receipt = await runBundle(root, argument, { verify: true });
    console.log(`verify ${receipt.outcome}: ${receipt.providersUsed.join(", ") || "deterministic"}`);
    if (receipt.outcome !== "completed") process.exitCode = 1;
    return;
  }
  if (command === "route") {
    await explainRoute(root, argument);
    return;
  }
  if (command === "run") {
    const receipt = await runBundle(root, argument);
    console.log(`${receipt.outcome}: ${receipt.providersUsed.join(", ")}; saved $${receipt.savingsUsd.toFixed(2)}`);
    if (receipt.outcome !== "completed") process.exitCode = 1;
    return;
  }
  if (command === "activate") {
    const harnessIndex = flags.indexOf("--harness");
    const harness = flags[harnessIndex + 1] as NativeHarness | undefined;
    if (harness !== "hermes" && harness !== "openclaw") {
      throw new Error("activate requires --harness hermes|openclaw");
    }
    await activate(root, argument, harness, flags.includes("--confirm"));
    return;
  }
  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

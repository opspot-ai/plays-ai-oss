#!/usr/bin/env node
import { doctor, install, login } from "./core.js";
import { explainRoute, runBundle } from "./runner.js";

function usage(): never {
  console.error("usage: plays <login|install|update|doctor|verify|route|run> [play|path]");
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
  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

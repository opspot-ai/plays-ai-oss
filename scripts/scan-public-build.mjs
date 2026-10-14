#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const denylistPath = path.join(root, "lib/public-build-denylist.generated.json");

async function loadDenylist() {
  const denylist = JSON.parse(await readFile(denylistPath, "utf8"));
  return {
    names: new Set(denylist.playerNames),
    assignments: new Set(denylist.assignments),
  };
}

const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(target);
    else if (/\.(html|js|json)$/.test(entry.name)) files.push(target);
  }
}
await walk(path.join(root, ".next/static"));
await walk(path.join(root, ".next/server/app"));
const rawPublicBuild = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
const vendorRelayError = "Relay Error invoking the Edge Function";
if (!rawPublicBuild.includes(vendorRelayError)) throw new Error("public build Relay allowlist is stale");
const publicBuild = rawPublicBuild.replaceAll(vendorRelayError, "");
const { names, assignments } = await loadDenylist();
if (names.size === 0 || assignments.size === 0) {
  throw new Error(`generated public-build denylist empty (names=${names.size}, assignments=${assignments.size})`);
}
const leaks = [...names, ...assignments].filter((value) =>
  names.has(value) ? new RegExp(`\\b${value}\\b`).test(publicBuild) : publicBuild.includes(value),
);
if (leaks.length) throw new Error(`public build contains ${leaks.length} value(s) from the generated denylist`);
console.log(
  `generated public-build denylist scan passed (${names.size} name tokens, ${assignments.size} assignment tokens)`,
);

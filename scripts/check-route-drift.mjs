#!/usr/bin/env node
/* Route drift gate for Package E: no route additions/removals.
 * Freezes the user-visible App Router page inventory.
 */
import { readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, "..", "app");

/** Canonical user-visible routes (and not-found) at Package E baseline. */
const EXPECTED = [
  "/",
  "/device",
  "/how-it-works",
  "/library",
  "/not-found",
  "/plays",
  "/plays/[slug]",
  "/success",
].sort();

async function walkPages(dir, base = APP, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "api" || entry.name === "auth") continue;
      await walkPages(full, base, out);
      continue;
    }
    if (entry.name === "page.tsx" || entry.name === "not-found.tsx") {
      const rel = relative(base, dir).replace(/\\/g, "/");
      if (entry.name === "not-found.tsx") out.push("/not-found");
      else out.push(rel === "" ? "/" : `/${rel}`);
    }
  }
  return out;
}

const found = (await walkPages(APP)).sort();
const missing = EXPECTED.filter((r) => !found.includes(r));
const extra = found.filter((r) => !EXPECTED.includes(r));

console.log("Plays route inventory");
console.log(`  expected: ${EXPECTED.length}`);
console.log(`  found:    ${found.length}`);
for (const r of found) console.log(`  - ${r}`);

if (missing.length || extra.length) {
  if (missing.length) console.error("MISSING routes:", missing.join(", "));
  if (extra.length) console.error("EXTRA routes:", extra.join(", "));
  process.exit(1);
}
console.log("RESULT: route inventory matches Package E freeze (no drift).");

#!/usr/bin/env node
/* Copy drift checks for user-visible storefront strings. */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const CHECKS = [
  { file: "app/page.tsx", needles: [
    "Buy a play. Drop it in. It runs.",
    "Your MVP plays",
    "Open the playbook",
    "The playbook for your AI team",
  ]},
  { file: "app/how-it-works/page.tsx", needles: [
    "Install the play. Use the subscriptions you already pay for.",
    "What you're buying / what you're not",
    "You are buying",
    "You are not buying",
  ]},
  { file: "app/plays/CatalogClient.tsx", needles: [
    "Every play in the book",
    "Search the playbook…",
  ]},
  { file: "app/plays/[slug]/page.tsx", needles: [
    "← All plays",
    "The scoreboard",
    "Buy this Play",
    "One-time · yours to keep",
  ]},
  { file: "app/library/page.tsx", needles: [
    "Your roster",
    "My roster",
    "Your purchased plays",
  ]},
  { file: "app/success/page.tsx", needles: [
    "Purchase complete",
    "Go to my roster",
  ]},
  { file: "app/not-found.tsx", needles: [
    "That play doesn't exist.",
    "Browse plays",
  ]},
  { file: "app/device/page.tsx", needles: [
    "Approve CLI login",
  ]},
  { file: "components/Header.tsx", needles: [
    "Playbook",
    "How it works",
    "My roster",
    "Draft a play",
  ]},
  { file: "components/Footer.tsx", needles: [
    "Playbook",
    "How it works",
  ]},
  { file: "components/PlayCard.tsx", needles: [
    "Available →",
    "one-time",
  ]},
];

let failed = 0;
for (const { file, needles } of CHECKS) {
  const text = await readFile(join(root, file), "utf8");
  // Normalize HTML entities and escapes used in TSX source.
  const normalized = text
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\{\s*"([^"]+)"\s*\}/g, "$1");
  for (const needle of needles) {
    // Allow curly apostrophe / straight apostrophe
    const variants = [
      needle,
      needle.replace(/'/g, "\u2019"),
      needle.replace(/'/g, "&rsquo;"),
      needle.replace(/'/g, "\\'"),
    ];
    const ok = variants.some((v) => text.includes(v) || normalized.includes(v));
    if (!ok) {
      console.error(`COPY DRIFT: missing in ${file}: ${JSON.stringify(needle)}`);
      failed++;
    }
  }
}

if (failed) {
  console.error(`RESULT: ${failed} copy check(s) failed.`);
  process.exit(1);
}
console.log(`RESULT: copy freeze holds (${CHECKS.reduce((n, c) => n + c.needles.length, 0)} strings across ${CHECKS.length} files).`);

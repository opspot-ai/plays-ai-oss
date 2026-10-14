#!/usr/bin/env node
/* Plays theme accessibility gate (Package E).
 *
 * Modeled on Products/OS1/pwa/scripts/check-theme-contrast.mjs.
 * Parses token values from app/globals.css :root, flattens translucent
 * colors onto real surfaces, and measures WCAG 2.1 contrast for every
 * text/background pair that actually renders in the product CSS.
 *
 *   node scripts/check-theme-contrast.mjs
 *
 * Exit 1 if any pair misses AA.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = join(__dirname, "..", "app", "globals.css");

const AA_TEXT = 4.5;
const AA_LARGE = 3; // large text / UI components (WCAG 1.4.3 large, 1.4.11 non-text)

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i;

/** Actual pairs used in app/globals.css component rules. Zero notes/exceptions. */
const PAIRS = [
  { where: "body text on canvas", fg: "text-primary", bg: "surface-canvas", kind: "text" },
  { where: "lead / secondary on canvas", fg: "text-secondary", bg: "surface-canvas", kind: "text" },
  { where: "muted / hero-note on canvas", fg: "text-muted", bg: "surface-canvas", kind: "text" },
  { where: "eyebrow on canvas", fg: "violet-600", bg: "surface-canvas", kind: "text" },
  { where: "body text on white card", fg: "text-primary", bg: "surface-card", kind: "text" },
  { where: "card tagline on white card", fg: "text-secondary", bg: "surface-card", kind: "text" },
  { where: "price small / muted on card", fg: "text-muted", bg: "surface-card", kind: "text" },
  { where: "primary button label", fg: "primary-on", bg: "primary", kind: "text" },
  { where: "primary button hover label", fg: "primary-on", bg: "primary-hover", kind: "text" },
  { where: "accent button label", fg: "accent-on", bg: "accent", kind: "text" },
  { where: "accent button hover label", fg: "accent-on", bg: "accent-hover", kind: "text" },
  { where: "ghost button label on canvas", fg: "text-primary", bg: "surface-canvas", kind: "text" },
  { where: "badge-cat on violet-50", fg: "violet-700", bg: "violet-50", kind: "text" },
  { where: "badge-flag on gold-50", fg: "neutral-600", bg: "gold-50", kind: "text" },
  { where: "badge-green on green-50", fg: "green-700", bg: "green-50", kind: "text" },
  { where: "pill idle on card", fg: "text-secondary", bg: "surface-card", kind: "text" },
  { where: "pill pressed label", fg: "neutral-0", bg: "violet-600", kind: "text" },
  { where: "tool-tag on subtle", fg: "text-secondary", bg: "surface-subtle", kind: "text" },
  { where: "checklist tick on canvas", fg: "green-700", bg: "surface-canvas", kind: "nontext" },
  { where: "outcome-box body on field", fg: "brand-ink", bg: "surface-field", kind: "text" },
  { where: "outcome-box eyebrow on field", fg: "green-700", bg: "surface-field", kind: "text" },
  { where: "notice-ok on green-50", fg: "status-ok-fg", bg: "status-ok-bg", kind: "text" },
  { where: "notice-warn on gold-50", fg: "status-warn-fg", bg: "status-warn-bg", kind: "text" },
  { where: "notice-info on violet-50", fg: "status-info-fg", bg: "status-info-bg", kind: "text" },
  { where: "step number on gold-50", fg: "neutral-600", bg: "gold-50", kind: "text" },
  { where: "stat number on canvas", fg: "violet-600", bg: "surface-canvas", kind: "large" },
  { where: "nav link on header scrim/canvas", fg: "text-secondary", bg: "surface-canvas", kind: "text" },
  { where: "brand .ai on canvas", fg: "violet-600", bg: "surface-canvas", kind: "text" },
  { where: "dark section body on plum", fg: "text-on-inverse", bg: "brand-plum", kind: "text" },
  { where: "dark section heading on plum", fg: "neutral-0", bg: "brand-plum", kind: "large" },
  { where: "dark card body on dark-card", fg: "text-on-inverse", bg: "dark-card", kind: "text" },
  { where: "dark card heading on dark-card", fg: "neutral-0", bg: "dark-card", kind: "large" },
  { where: "footer body on ink", fg: "footer-muted", bg: "brand-ink", kind: "text" },
  { where: "footer brand on ink", fg: "neutral-0", bg: "brand-ink", kind: "text" },
  { where: "backlink muted on canvas", fg: "text-muted", bg: "surface-canvas", kind: "text" },
  { where: "hero-badge text on card", fg: "text-secondary", bg: "surface-card", kind: "text" },
];

function parse(value) {
  const v = String(value || "").trim();
  const m = v.match(RGB);
  if (m) {
    return {
      r: Math.min(255, +m[1]),
      g: Math.min(255, +m[2]),
      b: Math.min(255, +m[3]),
      a: m[4] === undefined ? 1 : parseFloat(m[4]),
    };
  }
  if (!HEX.test(v)) return null;
  let h = v.slice(1);
  if (h.length === 3 || h.length === 4) {
    h = h.split("").map((c) => c + c).join("");
  }
  const n = parseInt(h.slice(0, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a };
}

function css(c) {
  const r = Math.round(c.r);
  const g = Math.round(c.g);
  const b = Math.round(c.b);
  if (c.a >= 1) {
    return (
      "#" +
      [r, g, b]
        .map((x) => ("0" + x.toString(16)).slice(-2).toUpperCase())
        .join("")
    );
  }
  return `rgba(${r}, ${g}, ${b}, ${Math.round(c.a * 1000) / 1000})`;
}

function over(fg, bg) {
  let f = parse(fg);
  let b = parse(bg);
  if (!f || !b) return null;
  if (b.a < 1) {
    const flat = over(bg, "#FFFFFF");
    b = parse(flat);
    if (!b) return null;
  }
  const a = f.a;
  return css({
    r: f.r * a + b.r * (1 - a),
    g: f.g * a + b.g * (1 - a),
    b: f.b * a + b.b * (1 - a),
    a: 1,
  });
}

function luminance(color) {
  const c = parse(color);
  if (!c) return null;
  const ch = [c.r, c.g, c.b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  if (l1 === null || l2 === null) return null;
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function parseRootTokens(cssText) {
  const rootMatch = cssText.match(/:root\s*\{([\s\S]*?)\n\}/);
  if (!rootMatch) throw new Error("Could not find :root block in app/globals.css");
  const body = rootMatch[1];
  const raw = {};
  for (const line of body.split(/;\s*\n|;/)) {
    const m = line.match(/--([a-z0-9-]+)\s*:\s*([^;]+)/i);
    if (!m) continue;
    raw[m[1]] = m[2].trim();
  }
  // Synthetic pair used by footer body (rgba white 0.7 over ink).
  raw["footer-muted"] = "rgba(250, 250, 247, 0.7)";
  return raw;
}

function resolveToken(raw, name, stack = []) {
  if (!(name in raw)) throw new Error(`Missing token --${name}`);
  if (stack.includes(name)) throw new Error(`Cycle resolving --${name}`);
  let value = raw[name];
  const ref = value.match(/^var\(--([a-z0-9-]+)\)$/i);
  if (ref) return resolveToken(raw, ref[1], [...stack, name]);
  // Multi-layer values (gradients) are not solid colors; only solid tokens used in PAIRS.
  if (value.includes("gradient(") || value.includes("url(")) {
    throw new Error(`Token --${name} is not a solid color: ${value}`);
  }
  // box-shadow / blur tokens should not be requested as colors.
  return value;
}

function minFor(kind) {
  if (kind === "text") return AA_TEXT;
  return AA_LARGE;
}

function fmt(n) {
  return (Math.round(n * 100) / 100).toFixed(2).padStart(5);
}

async function main() {
  const cssText = await readFile(CSS_PATH, "utf8");
  const raw = parseRootTokens(cssText);
  const resolved = {};
  for (const key of Object.keys(raw)) {
    try {
      const value = resolveToken(raw, key);
      if (parse(value) || value.startsWith("rgba") || value.startsWith("rgb") || value.startsWith("#")) {
        resolved[key] = value;
      }
    } catch {
      // skip non-color tokens
    }
  }

  let failed = 0;
  const rows = [];

  for (const p of PAIRS) {
    const fgRaw = resolveToken(raw, p.fg);
    const bgRaw = resolveToken(raw, p.bg);
    const bg = over(bgRaw, "#FFFFFF") || bgRaw;
    const fgFlat = over(fgRaw, bg);
    if (!fgFlat) {
      rows.push({ ...p, pass: false, ratio: 0, min: minFor(p.kind), error: `unresolvable ${p.fg}/${p.bg}` });
      failed++;
      continue;
    }
    const ratio = contrast(fgFlat, bg);
    const min = minFor(p.kind);
    const pass = ratio !== null && ratio >= min;
    if (!pass) failed++;
    rows.push({
      ...p,
      bg,
      fgFlat,
      ratio: ratio === null ? 0 : Math.round(ratio * 100) / 100,
      min,
      pass,
    });
  }

  const worst = rows
    .filter((r) => r.kind === "text")
    .reduce((m, r) => Math.min(m, r.ratio), Infinity);

  const verdict = failed ? `FAIL (${failed})` : "AA PASS";
  console.log(`Plays · tokens from app/globals.css -> ${verdict}`);
  console.log(`  pairs checked: ${rows.length}`);
  console.log(`  lowest text ratio ${fmt(worst)}  (AA needs ${AA_TEXT.toFixed(2)})`);
  for (const r of rows) {
    const mark = r.pass ? "ok  " : "FAIL";
    const extra = r.error ? `  ${r.error}` : `  ${r.fgFlat} on ${r.bg}`;
    console.log(`  ${mark} ${fmt(r.ratio)}:1  min ${r.min.toFixed(1)}  ${r.where}${extra}`);
  }
  console.log("");
  if (failed) {
    console.log(`RESULT: ${failed} contrast failure(s); Package E requires zero exceptions.`);
    process.exit(1);
  }
  console.log("RESULT: every pair meets WCAG 2.1 AA (zero exception/note pairs).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

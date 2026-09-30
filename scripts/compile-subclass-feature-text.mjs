// Compile fetched subclass page prose into per-feature text.
//
//   input : .fetch-subclass-raw.json      (scripts/fetch-subclass-feature-text.mjs)
//   output: js/data/subclassFeatureText.js  (GENERATED - do not hand-edit)
//
// Run: node scripts/compile-subclass-feature-text.mjs
//
// The wiki page is one flat run of "heading + prose" after the HTML is
// stripped, so this splits it by locating each feature's name as a line
// of its own and taking everything up to the next one. A feature whose
// heading isn't found on the page is left out rather than guessed at —
// an empty description is bad, but a feature carrying another feature's
// rules is worse.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUBCLASS_BUNDLE_MAP } from "../js/data/contentFixups.js";

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const RAW = path.join(ROOT, ".fetch-subclass-raw.json");
const OUT = path.join(ROOT, "js", "data", "subclassFeatureText.js");

/** Comparable form of a feature name. The export splits a feature that
 *  recurs across levels into "Arcane Shot (2 options)", "(3 options)"
 *  and so on; the wiki has one heading for the whole thing, so only the
 *  part before the parenthesis is the name to look for. */
const baseName = (name) => String(name || "").split("(")[0].trim();
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Wiki headings arrive as their own line, sometimes with a trailing
 *  colon or a "Primal X" prefix, and sometimes wrapped onto the
 *  following line. A heading is short; body prose is not. */
function isHeadingLine(line, targetNorms) {
  const clean = line.trim().replace(/:$/, "");
  if (!clean || clean.length > 70) return null;
  const n = norm(clean);
  if (!n) return null;
  if (targetNorms.has(n)) return clean;
  return null;
}

/** Wikidot appends site chrome after the page content: a "Help |
 *  Terms of Service | ..." nav bar, the licence notice, and the
 *  "Powered by Wikidot.com" footer. The last feature on a page has
 *  nothing after it to stop the text, so all of that lands inside the
 *  final feature's description unless it is cut here. It is prose the
 *  player would never see, and it would otherwise be the most visible
 *  artifact of having scraped at all. */
const BOILERPLATE = [
  // The nav bar renders as its own lines once the HTML is stripped, and
  // it comes BEFORE the licence notice, so cutting at the licence would
  // leave the whole nav behind. Anchor on the line.
  /\nHelp\n\|\n(?:Terms of Service\n\|\n)?Privacy\n\|\n/,
  /\n(?:edit|tags|history|print|tools)\n\|\n/,
  "Powered by Wikidot.com",
  "Unless otherwise stated, the content of this page is licensed",
  "Click here to edit contents of this page",
  "Click here to toggle editing of individual sections of this page",
  "General Wikidot.com documentation and help section",
  "View/set parent page (used for creating breadcrumbs",
  "See pages that link to and include this page",
  "Notify administrators if there is objectionable content",
  "This site is not affiliated",
  "Wiki contents",
];

function trimBoilerplate(text) {
  let cut = text.length;
  for (const marker of BOILERPLATE) {
    const at = typeof marker === "string" ? text.indexOf(marker) : text.search(marker);
    if (at >= 0 && at < cut) cut = at;
  }
  return text.slice(0, cut).replace(/[\s|]+$/, "").trim();
}

/** Split one page into { featureName: text }.
 *
 *  Returns the features it could find, and the list it could not, so the
 *  caller can report coverage instead of assuming it. */
export function segmentPage(pageText, featureNames) {
  const targets = new Map();
  for (const raw of featureNames) {
    const base = baseName(raw);
    if (base.length < 3) continue;
    if (!targets.has(norm(base))) targets.set(norm(base), raw);
  }
  const targetNorms = new Set(targets.keys());
  const lines = String(pageText || "").split("\n");
  const found = {};
  const order = [];
  let current = null;
  let buffer = [];
  const flush = () => {
    if (!current) return;
    const text = trimBoilerplate(buffer.join("\n").replace(/\n{2,}/g, "\n\n"));
    if (text) { found[current] = text; order.push(current); }
    buffer = [];
  };
  for (const line of lines) {
    const heading = isHeadingLine(line, targetNorms);
    if (heading) {
      flush();
      current = targets.get(norm(heading.replace(/:$/, ""))) || null;
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  const missing = [...targets.values()].filter((raw) => !Object.values(found).includes(raw));
  // Report by name, not by what's in `found`, since found is keyed by the
  // export's full name.
  const got = new Set(Object.entries(found).map(([k]) => k));
  return { features: found, missing: [...targets.values()].filter((raw) => !got.has(raw)) };
}

function main() {
  if (!fs.existsSync(RAW)) {
    console.error("No .fetch-subclass-raw.json. Run scripts/fetch-subclass-feature-text.mjs first.");
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(RAW, "utf8"));
  const compiled = {};
  const report = [];
  for (const [key, bundle] of SUBCLASS_BUNDLE_MAP) {
    const page = raw.pages[key];
    if (!page) { report.push({ key, found: 0, total: (bundle.featureGrants || []).length, note: "no page" }); continue; }
    const names = (bundle.featureGrants || []).map((f) => f.name);
    const { features, missing } = segmentPage(page.text, names);
    if (Object.keys(features).length) {
      compiled[key] = { url: page.url, features };
    }
    report.push({ key, found: Object.keys(features).length, total: names.length, note: missing.length ? `missing: ${missing.join(", ")}` : "" });
  }

  const lines = [];
  lines.push("// AUTO-GENERATED by scripts/compile-subclass-feature-text.mjs — DO NOT EDIT.");
  lines.push("//");
  lines.push("// Rules text for subclass features, fetched from dnd5e.wikidot.com (CC-BY-SA)");
  lines.push("// by scripts/fetch-subclass-feature-text.mjs and segmented per feature here.");
  lines.push("//");
  lines.push("// This is why 581 features used to have no description at all: the Foundry export");
  lines.push("// in docs/New Info/5e-subclasses.txt was taken from the ACTOR, so every feature");
  lines.push("// was a `@Compendium[...]{Name}` reference and the prose behind it was never in");
  lines.push("// the file. The feats export was taken from the compendium and so DOES carry its");
  lines.push("// text, which is why feats have descriptions and subclasses did not.");
  lines.push("//");
  lines.push("// Each subclass maps to { url, features: { <feature name>: <text> } }. Only");
  lines.push("// features actually found on the page appear; a feature with no entry here keeps");
  lines.push("// whatever description the compiled bundle gave it, and an empty one if it had none.");
  lines.push("// Regenerate rather than editing: node scripts/fetch-subclass-feature-text.mjs");
  lines.push("//   && node scripts/compile-subclass-feature-text.mjs");
  lines.push("");
  lines.push("export const SUBCLASS_FEATURE_TEXT = {");
  for (const key of Object.keys(compiled).sort()) {
    const entry = compiled[key];
    lines.push(`  ${JSON.stringify(key)}: {`);
    lines.push(`    url: ${JSON.stringify(entry.url)},`);
    lines.push("    features: {");
    for (const name of Object.keys(entry.features).sort()) {
      lines.push(`      ${JSON.stringify(name)}: ${JSON.stringify(entry.features[name])},`);
    }
    lines.push("    },");
    lines.push("  },");
  }
  lines.push("};");
  lines.push("");
  lines.push("export default SUBCLASS_FEATURE_TEXT;");
  lines.push("");
  fs.writeFileSync(OUT, lines.join("\n"));

  const withText = report.filter((r) => r.found > 0);
  const totalFound = report.reduce((n, r) => n + r.found, 0);
  const total = report.reduce((n, r) => n + r.total, 0);
  console.log(`subclasses with text: ${withText.length}/${report.length}`);
  console.log(`features given text: ${totalFound}/${total}`);
  const zero = report.filter((r) => r.found === 0);
  if (zero.length) console.log(`no text at all: ${zero.map((r) => r.key).join(", ")}`);
  const partial = report.filter((r) => r.found > 0 && r.found < r.total);
  console.log(`partial (${partial.length}):`);
  for (const r of partial.slice(0, 14)) console.log(`  ${r.key}: ${r.found}/${r.total} ${r.note}`);
  console.log(`\nwrote ${path.relative(ROOT, OUT)}`);
}

main();

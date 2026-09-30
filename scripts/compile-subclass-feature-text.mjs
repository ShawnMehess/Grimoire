// Compile fetched subclass page prose into per-feature text.
//
//   input : .fetch-subclass-raw.json      (scripts/fetch-subclass-feature-text.mjs)
//   output: js/data/subclassFeatureText.js  (GENERATED - do not hand-edit)
//
// Run: node scripts/fetch-subclass-feature-text.mjs
//   && node scripts/compile-subclass-feature-text.mjs
//
// HOW A PAGE BECOMES PER-FEATURE TEXT
// After the HTML is stripped a wiki page is a flat run of headings and
// prose, so the split is positional: find each feature's name and take
// everything up to the next one. Three things that a naive "line equals
// the feature name" check gets wrong, all of which cost real features
// before this was fixed:
//
//  1. A page names a feature differently from the export. The export says
//     "Expanded Spells"; the page says "Expanded Spell List". Those need
//     an alias, and the alias table below is where they go.
//  2. The export repeats one feature once per level, with the level range
//     mashed into the name: "Arcane Shot (2 options)", "Arcane Shot (3
//     options)", "Combat Superiority (d10)". The page has ONE section. So
//     a section fans out to every grant sharing that base name, rather
//     than being assigned to whichever name happened to be scanned first
//     and leaving the rest empty.
//  3. Not every feature is a heading. A paladin oath's Channel Divinity
//     options are list items - "- Peerless Athlete. As a bonus action,
//     ...". A line-equals-name check never sees them at all.
//
// A feature whose name is still not found is left out rather than guessed
// at. An empty description is recoverable; a feature carrying another
// feature's rules is worse than no description.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUBCLASS_BUNDLE_MAP } from "../js/data/contentFixups.js";

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const RAW = path.join(ROOT, ".fetch-subclass-raw.json");
const OUT = path.join(ROOT, "js", "data", "subclassFeatureText.js");

/** Export name -> the heading the page actually uses. Keys are in
 *  MATCHING FORM (see norm), which is the whole point: "Expanded Spells"
 *  matches as `expandedspells`, not `expandeds`. Getting that wrong makes
 *  the alias silently inert. */
const ALIASES = {
  // Warlock patrons: the export calls it "Expanded Spells"; the page's
  // section is "Expanded Spell List", followed by a per-patron list.
  expandedspells: ["expandedspelllist"],
  // The 2024 Thief feature; the export drops the "Second-" prefix.
  storywork: ["secondstorywork"],
  // The export records the repeat picks as separate grants; the page
  // states the rule once, under the feature that governs them.
  additionalelementaldiscipline: ["discipleoftheelements"],
  arcana: ["arcaneinitiate"],
};

/** Heading suffixes, for pages that qualify the heading with the
 *  subclass's own name. A cleric domain's page says "Arcana Domain
 *  Spells", "Life Domain Spells" and so on, while the export calls the
 *  grant "Bonus Spells" in every one of them - so no single exact heading
 *  works, only "a heading ending in this". */
const SUFFIX_ALIASES = {
  bonusspells: ["domainspells"],
  primalcompanion: ["primalcompanion"],
};

/** Strip an unmatched ")" so "improved shots)" reduces to "improved shots". */
const tidy = (s) => String(s || "").replace(/\)+/g, " ").trim();

/** The part of an export feature name that identifies it on the page.
 *  "Arcane Shot (2 options)" -> "Arcane Shot". */
const baseName = (name) => tidy(String(name || "").split("(")[0]).trim();

/** Matching form. */
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Candidate headings for one export feature name, in priority order:
 *  the name itself, its alias, and - for "Channel Divinity: Cloak of
 *  Shadows" style names - the part after the colon, which is what the
 *  page uses. */
function candidatesFor(base) {
  const out = new Set();
  const b = norm(base);
  if (!b) return out;
  out.add(b);
  for (const alias of ALIASES[b] || []) out.add(alias);
  const colon = base.indexOf(":");
  if (colon >= 0) {
    const tail = norm(base.slice(colon + 1));
    if (tail) {
      out.add(tail);
      for (const alias of ALIASES[tail] || []) out.add(alias);
    }
  }
  return out;
}

/** Suffixes a page heading may carry for this base name. */
function suffixesFor(base) {
  return SUFFIX_ALIASES[norm(base)] || [];
}

/** Wikidot appends site chrome after the page content: a nav bar, the
 *  licence notice, and a "Powered by Wikidot.com" footer. The last
 *  feature on a page has nothing after it to stop the text, so all of
 *  that lands inside the final feature's description unless it is cut
 *  here. It is prose the player would never see, and it would otherwise
 *  be the most visible artifact of having scraped at all. */
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

/** Headings are short. Body prose is not, and a long line that happens
 *  to start with a feature's name is that feature being discussed, not
 *  the heading for it. */
const MAX_HEADING = 70;

/** Strip markdown decoration so a heading can be compared.
 *  The SRD is markdown, so its headings arrive as "### Story Work" or
 *  "**Story Work**" and would never equal the export's name. */
function deMarkdown(line) {
  return String(line || "")
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*[*_]+\s*/, "")
    .replace(/[*_]+$/, "")
    .replace(/^#+\s*/, "")
    .trim();
}

/** Match a whole line as a heading, or as "- Name. rest" list item.
 *
 *  The bullet form is parsed by hand rather than with a regex because the
 *  name length has to be bounded by MAX_HEADING, and a length bound is
 *  not something a regex literal can express. */
function matchLine(line, index, suffixes) {
  const trimmed = deMarkdown(line);
  if (!trimmed) return null;

  // List item: "- Peerless Athlete. As a bonus action, ..."
  const bullet = trimmed.match(/^[-*•]\s+(\S.*)$/);
  if (bullet) {
    const body = bullet[1];
    // The name ends at the first sentence break, but only within the
    // heading-length bound - a list item with no name in it is a bullet
    // in a list of rules, not a feature section.
    const stop = body.slice(0, MAX_HEADING).search(/[.:]\s/);
    if (stop > 1) {
      const key = lookup(body.slice(0, stop), index, suffixes);
      if (key) {
        const after = body.slice(stop).replace(/^[.:]\s+/, "");
        return { key, rest: after };
      }
    }
  }

  // Whole-line heading, tolerating a trailing colon.
  const clean = trimmed.replace(/:$/, "");
  if (clean.length <= MAX_HEADING) {
    const key = lookup(clean, index, suffixes);
    if (key) return { key, rest: "" };
  }
  return null;
}

/** Exact heading match, then suffix match. The suffix pass exists because
 *  a page may qualify the heading with the subclass's name ("Arcana
 *  Domain Spells" for a grant the export calls "Bonus Spells"). */
function lookup(name, index, suffixes) {
  const n = norm(name);
  if (!n) return null;
  const exact = index.get(n);
  if (exact) return exact;
  for (const [base, sufs] of suffixes) {
    if (sufs.some((s) => n.endsWith(s))) return base;
  }
  return null;
}

/** Grants that are export artifacts, not missing text.
 *
 *  Each of these is one real feature that the export repeated - the level
 *  table re-lists it - so there is no second section on any page to find.
 *  Filling them with the first feature's text would be a lie about the
 *  rules (the repeats are separate later choices), and leaving them blank
 *  makes the report look like a sourcing failure. Recording why is the
 *  honest answer: the rule they depend on is already sourced and, where it
 *  defines a choice, already has a picker. */
const DUPLICATE_GRANTS = {
  // The Monk picks a new elemental discipline at 6, 12 and 17. The page
  // states the rule once, under the feature that governs it.
  additionalelementaldiscipline: "discipleoftheelements",
  // A fragment of the Arcane Shot options table, split across levels by
  // the export and left with an unbalanced bracket.
  improvedshots: "arcanearcher:arcane shot",
  // The name is this project's own, for a "(Optional)" variant the source
  // marks as optional; the page's own section supplies the text.
  primalcompanionoptional: "primalcompanion",
};

/** Split one page into a map of base name -> text.
 *
 *  `index` maps every normalised candidate heading to the base name it
 *  belongs to, so several headings can fan into one section. */
export function segmentPage(pageText, index, suffixes = new Map()) {
  const sections = new Map();
  const order = [];
  let current = null;
  let buffer = [];
  const flush = () => {
    if (!current) return;
    const text = trimBoilerplate(buffer.join("\n").replace(/\n{2,}/g, "\n\n"));
    if (text && !sections.has(current)) { sections.set(current, text); order.push(current); }
    buffer = [];
  };
  for (const line of String(pageText || "").split("\n")) {
    const hit = matchLine(line, index, suffixes);
    if (hit) {
      flush();
      current = hit.key;
      buffer = hit.rest ? [hit.rest] : [];
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();
  return { sections, order };
}

/** Build the heading index for a subclass: normalised heading -> base name,
 *  plus the export names that base name should fill. */
export function buildIndex(featureNames) {
  const index = new Map();
  const suffixes = new Map();
  const byBase = new Map();
  for (const raw of featureNames) {
    const base = baseName(raw);
    if (!base) continue;
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(raw);
    for (const c of candidatesFor(base)) if (!index.has(c)) index.set(c, base);
    const sufs = suffixesFor(base);
    if (sufs.length && !suffixes.has(base)) suffixes.set(base, sufs);
  }
  return { index, byBase, suffixes };
}

function main() {
  if (!fs.existsSync(RAW)) {
    console.error("No .fetch-subclass-raw.json. Run scripts/fetch-subclass-feature-text.mjs first.");
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(RAW, "utf8"));
  const compiled = {};
  const unmatched = [];
  const duplicates = [];
  let grants = 0;
  let filled = 0;

  // Second source: the 2024 SRD, used ONLY to fill what the wiki left
  // empty. It carries one subclass per class, so most of the 117 get
  // nothing from it, but where it does apply it is the 2024 rules - the
  // only free source for a feature the 2014 wiki has never heard of.
  const srdText = raw.srd?.text ? raw.srd.text : null;
  const srdFilled = [];

  for (const [key, bundle] of SUBCLASS_BUNDLE_MAP) {
    const page = raw.pages[key];
    const names = (bundle.featureGrants || []).map((f) => f.name);
    grants += names.length;
    const features = {};
    let url = page?.url || null;

    if (page) {
      const { index, byBase, suffixes } = buildIndex(names);
      const { sections } = segmentPage(page.text, index, suffixes);
      for (const [base, text] of sections) {
        for (const name of byBase.get(base) || []) features[name] = text;
      }
    }

    // SRD pass, over whatever is still blank.
    if (srdText) {
      const stillBlank = names.filter((n) => !features[n]);
      if (stillBlank.length) {
        const { index, byBase, suffixes } = buildIndex(stillBlank);
        const { sections } = segmentPage(srdText, index, suffixes);
        for (const [base, text] of sections) {
          for (const name of byBase.get(base) || []) {
            features[name] = text;
            srdFilled.push(`${key} :: ${name}`);
            if (!url) url = raw.srd.url;
          }
        }
      }
    }

    const found = Object.keys(features).length;
    filled += found;
    if (found) compiled[key] = { url, features };
    for (const n of names) {
      if (features[n]) continue;
      const dup = DUPLICATE_GRANTS[norm(baseName(n))];
      if (dup) duplicates.push(`${key} :: ${n} (repeat of ${dup})`);
      else unmatched.push(`${key} :: ${n}`);
    }
  }

  const lines = [];
  lines.push("// AUTO-GENERATED by scripts/compile-subclass-feature-text.mjs — DO NOT EDIT.");
  lines.push("//");
  lines.push("// Rules text for subclass features, fetched from dnd5e.wikidot.com (CC-BY-SA)");
  lines.push("// by scripts/fetch-subclass-feature-text.mjs and segmented per feature here.");
  lines.push("//");
  lines.push("// This is why most features used to have no description at all: the Foundry export");
  lines.push("// in docs/New Info/5e-subclasses.txt was taken from the ACTOR, so every feature");
  lines.push("// was a `@Compendium[...]{Name}` reference and the prose behind it was never in");
  lines.push("// the file. The feats export was taken from the compendium and so DOES carry its");
  lines.push("// text, which is why feats have descriptions and subclasses did not.");
  lines.push("//");
  lines.push("// Each subclass maps to { url, features: { <export name>: <text> } }. A feature");
  lines.push("// with no entry here keeps whatever description the compiled bundle gave it.");
  lines.push("// Regenerate rather than editing:");
  lines.push("//   node scripts/fetch-subclass-feature-text.mjs");
  lines.push("//   node scripts/compile-subclass-feature-text.mjs");
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

  console.log(`subclasses with text: ${Object.keys(compiled).length}/${SUBCLASS_BUNDLE_MAP.size}`);
  console.log(`features given text: ${filled}/${grants}`);
  if (srdFilled.length) {
    console.log(`  of which from the 2024 SRD: ${srdFilled.length}`);
    for (const s of srdFilled) console.log(`    ${s}`);
  }
  if (duplicates.length) {
    console.log(`repeat grants, no second section exists (${duplicates.length}):`);
    for (const d of duplicates) console.log(`  ${d}`);
  }
  console.log(`\nno source found (${unmatched.length}):`);
  for (const u of unmatched) console.log(`  ${u}`);
  console.log(`\nwrote ${path.relative(ROOT, OUT)}`);

  // The residual is committed rather than left implicit. "Still empty"
  // is only actionable if you can see WHICH items and WHY, and a blank
  // cell in a spreadsheet is neither.
  const report = [];
  report.push("# AUTO-GENERATED by scripts/compile-subclass-feature-text.mjs — DO NOT EDIT.");
  report.push("#");
  report.push(`# Generated ${new Date().toISOString()}`);
  report.push("#");
  report.push(`# ${filled} of ${grants} subclass feature grants have sourced text.`);
  report.push(`# ${duplicates.length} are repeats of a feature that is sourced (see below).`);
  report.push(`# ${unmatched.length} have NO public source, listed at the end.`);
  report.push("");
  report.push("## Repeat grants");
  report.push("");
  report.push("One real feature that the export listed once per level. There is no");
  report.push("second section on any page to find; the rule is already sourced under");
  report.push("the feature named in brackets.");
  report.push("");
  for (const d of duplicates) report.push(`- ${d}`);
  report.push("");
  report.push("## Grants with no public source");
  report.push("");
  report.push("Checked against dnd5e.wikidot.com (2014 rules) and the 2024 SRD 5.2.1.");
  report.push("These are 2024-revision features, or content outside the SRD entirely,");
  report.push("that no free source carries. They are NOT paraphrased from memory: the");
  report.push("sourcing rules in docs/SUBCLASS-CONTENT-AUDIT-2026-09.md exist to keep");
  report.push("invented rules out of the data, and a plausible-looking guess is worse");
  report.push("than a blank, because a player cannot tell the difference.");
  report.push("");
  for (const u of unmatched) report.push(`- ${u}`);
  report.push("");
  fs.writeFileSync(path.join(ROOT, "docs", "subclass-text-gaps.md"), report.join("\n"));
  console.log(`wrote ${path.relative(ROOT, path.join(ROOT, "docs", "subclass-text-gaps.md"))}`);
}

main();

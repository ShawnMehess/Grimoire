#!/usr/bin/env node
// scripts/check-subclass-sourcing.mjs
//
// Build-time sourcing gate for subclass summaries (audit §2b):
//   (a) every key in data/subclass-feature-summaries.json has a matching
//       key in data/subclass-feature-sources.json (and vice versa — an
//       orphaned source is a dangling citation);
//   (b) every sourceFile path exists on disk;
//   (c) no summary text reaches the compiled output except through the
//       summaries file: every top-level featureGrants description in
//       js/data/subclassContent.js is either empty (unsourced, omitted
//       from display) or byte-identical to some summaries-file summary.
//       (Choice-option descriptions are input-derived reference text,
//       not authored summaries — checked only for placeholder patterns.)
//       Plus a compiler cross-reference (c2): no static prose literal
//       may be assigned to a grant description in
//       scripts/compile-foundry-subclasses.mjs — dynamic templates are
//       allowed as mechanisms, but the output check still governs every
//       word they emit.
//   (d) every source entry carries a non-empty locator.
//
// Wired into the same suite as scripts/verify-content.mjs (which
// imports checkSubclassSourcing and fails on any failure), and runnable
// standalone: `node scripts/check-subclass-sourcing.mjs`.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

export function checkSubclassSourcing(rootDir = ROOT) {
  const failures = [];
  const fail = (msg) => failures.push(msg);
  const summariesPath = path.join(rootDir, "data", "subclass-feature-summaries.json");
  const sourcesPath = path.join(rootDir, "data", "subclass-feature-sources.json");
  const outputPath = path.join(rootDir, "js", "data", "subclassContent.js");

  let summaries = null;
  let sources = null;
  try {
    summaries = JSON.parse(readFileSync(summariesPath, "utf8"));
  } catch (err) {
    fail(`cannot parse ${summariesPath}: ${err.message}`);
  }
  try {
    sources = JSON.parse(readFileSync(sourcesPath, "utf8"));
  } catch (err) {
    fail(`cannot parse ${sourcesPath}: ${err.message}`);
  }
  if (!summaries || !sources) return { failures };

  // Shape check (the compiler re-validates on load; this guards
  // hand-edits between compiles).
  for (const [id, entry] of Object.entries(summaries)) {
    if (typeof entry?.summary !== "string" || entry.summary.length < 10) fail(`summaries: ${id} has no usable summary`);
    if (typeof entry?.minLevel !== "number" || entry.minLevel < 1 || entry.minLevel > 20) fail(`summaries: ${id} has bad minLevel`);
    if (typeof entry?.optional !== "boolean") fail(`summaries: ${id} has bad optional flag`);
    if (entry?.choice !== null && typeof entry?.choice !== "object") fail(`summaries: ${id} has bad choice`);
  }

  // (a) key parity, both directions.
  for (const id of Object.keys(summaries)) {
    if (!sources[id]) fail(`orphaned summary without source: ${id}`);
  }
  for (const id of Object.keys(sources)) {
    if (!summaries[id]) fail(`orphaned source without summary: ${id}`);
  }

  // (b) source files exist; (d) locators non-empty.
  for (const [id, entry] of Object.entries(sources)) {
    const file = entry?.sourceFile;
    if (typeof file !== "string" || !file) {
      fail(`sources: ${id} has no sourceFile`);
      continue;
    }
    if (!existsSync(path.join(rootDir, file))) fail(`sources: ${id} points at missing file ${file}`);
    if (typeof entry?.locator !== "string" || !entry.locator.trim()) fail(`sources: ${id} has no locator`);
  }

  // (c) compiled output carries no bypass text: every non-empty
  // top-level grant description is byte-identical to a summaries-file
  // summary (which itself passed check (a) above).
  let output = null;
  try {
    output = readFileSync(outputPath, "utf8");
  } catch (err) {
    fail(`cannot read ${outputPath}: ${err.message}`);
  }
  if (output) {
    const known = new Set(Object.values(summaries).map((e) => e.summary));
    const m = output.match(/export const SUBCLASS_SUPPLEMENT = ([\s\S]*?);\n\nexport const SUBCLASS_CHOICE_NAMES/);
    if (!m) {
      fail("cannot locate SUBCLASS_SUPPLEMENT in compiled output");
    } else {
      const supplement = JSON.parse(m[1]);
      for (const s of supplement) {
        const where = `${s.className || "?"} / ${s.name || "?"}`;
        for (const g of (s.bundle?.featureGrants || [])) {
          const desc = g.description || "";
          if (!desc) {
            if (!g.unsourced) fail(`output: ${where} :: ${g.id} has empty text without the unsourced flag`);
            continue;
          }
          if (g.unsourced) fail(`output: ${where} :: unsourced ${g.id} carries text`);
          if (!known.has(desc)) fail(`output: ${where} :: ${g.id} carries text from outside the summaries file`);
          if (/-level feature\.\s*$/.test(desc) || /placeholder/i.test(desc) || /\b3rd, 5th, 7th,/.test(desc)) {
            fail(`output: ${where} :: placeholder reaches player-facing content: ${g.id}`);
          }
        }
        for (const group of (s.bundle?.choiceGroups || [])) {
          for (const o of (group.options || [])) {
            for (const g of (o.featureGrants || [])) {
              if (/-level feature\.\s*$/.test(g.description || "") || /placeholder/i.test(g.description || "")) {
                fail(`output: ${where} :: placeholder in option text: ${g.id}`);
              }
            }
          }
        }
      }
    }
  }

  // (c2) compiler cross-reference: no static prose literal may be
  // assigned to a grant description in
  // scripts/compile-foundry-subclasses.mjs. Dynamic templates (with
  // ${...}, resolved from the Foundry input at compile time) are
  // allowed as mechanisms — the output check above still governs every
  // word they emit (unsourced text is nulled, sourced text must match
  // the summaries file exactly). A static literal with real prose
  // would be a hardcoded summary bypassing the summaries file.
  try {
    const compiler = readFileSync(path.join(rootDir, "scripts", "compile-foundry-subclasses.mjs"), "utf8");
    const assignRe = /description\s*[:=]\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
    let match;
    while ((match = assignRe.exec(compiler)) !== null) {
      const literal = match[1];
      if (literal.includes("${")) continue; // dynamic template — output check governs
      const prose = (literal.match(/[A-Za-z]/g) || []).length;
      if (prose >= 20) {
        fail(`compiler: hardcoded summary string bypasses the summaries file: ${literal.slice(0, 80)}...`);
      }
    }
  } catch (err) {
    fail(`cannot read compiler source: ${err.message}`);
  }
  return { failures };
}

const { failures } = checkSubclassSourcing();
if (failures.length) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  console.error(`check-subclass-sourcing: ${failures.length} failure(s)`);
  process.exit(1);
} else {
  console.log("check-subclass-sourcing: all checks passed");
}

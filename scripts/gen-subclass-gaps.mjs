#!/usr/bin/env node
// scripts/gen-subclass-gaps.mjs
//
// Regenerates docs/subclass-gaps.md from the compiled supplement: every
// feature grant with no entry in data/subclass-feature-summaries.json
// gets one line (feature id, subclass, level, what's missing), grouped
// by class/subclass. Re-run after recompiling or adding summaries:
//   node scripts/gen-subclass-gaps.mjs [--class Barbarian]
//
// The per-feature notes below are the only hand-written content; the
// enumeration itself is mechanical so the file can never silently drop
// an unsourced feature.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const ONLY_CLASS = (() => {
  const i = process.argv.indexOf("--class");
  return i === -1 ? null : process.argv[i + 1];
})();

const { SUBCLASS_SUPPLEMENT } = await import("../js/data/subclassContent.js");
const SUMMARIES = JSON.parse(readFileSync(path.join(ROOT, "data", "subclass-feature-summaries.json"), "utf8"));

const NAME_ONLY = "name only, no mechanics in 5e-subclasses.txt export";

function noteFor(subclassName, grant) {
  const id = grant.id;
  const name = grant.name || "";
  if (/circle-of-the-land-2-(bonus-cantrip-druid|natural-recovery)/.test(id)) {
    return "malformed spell-row text in export ('3rd, 5th, 7th,'); no mechanics — needs a sourced level-2 summary";
  }
  if (/-circle-spells$/.test(id) && /Circle/.test(subclassName)) {
    return "circle-spell list mechanics unsourced (audit templates cover domain/oath spells only)";
  }
  if (/-expanded-spells$/.test(id)) {
    return "expanded spell options, not automatically granted (correct per audit); option mechanics unsourced";
  }
  if (/psionic-spells$/.test(id)) {
    return "level-gated spell-replacement mechanics unsourced (audit: do not treat as immediately known)";
  }
  if (id === "artillerist-3-explosive-cannon") {
    return "export labels the 3rd-level feature 'Explosive Cannon' (duplicating the 9th-level name); unsourced either way";
  }
  if (/beast-focus/.test(id)) {
    return "companion mechanics need a deliberate pet/companion data model (audit); unsourced";
  }
  if (/companion|drake|drakewarden|beast-master|ranger-s-companion|primal-companion|steel-defender|homunculus|wildfire-spirit/i.test(id)) {
    return "companion/pet/summon mechanics need a deliberate pet/companion data model (audit); unsourced";
  }
  if (/spellcasting$/.test(id)) {
    return "spellcasting mechanics unsourced (EK/AT third-caster notes are the only sourced ones)";
  }
  if (/spells?$/.test(name) && !/cantrip/i.test(name)) {
    return "spell-access mechanics unsourced; no auto-grant modifiers in compiled data";
  }
  return NAME_ONLY;
}

const byClass = new Map();
for (const s of SUBCLASS_SUPPLEMENT) {
  if (ONLY_CLASS && s.className !== ONLY_CLASS) continue;
  const missing = (s.bundle.featureGrants || []).filter((g) => !SUMMARIES[g.id]);
  if (!missing.length) continue;
  if (!byClass.has(s.className)) byClass.set(s.className, []);
  byClass.get(s.className).push({ subclass: s.name, grants: missing });
}

// Choice-review dispositions (audit per-class "Choice review" items):
// implemented (with choiceKind) or logged here with the missing source
// and the choiceKind the group would carry. Built class-by-class in
// audit order; kinds: build (permanent), levelUp (revisited per
// level), playTime (chosen during play, never saved).
// Status values: "done" (real group), "by-design" (no group needed),
// "gaps" (blocked on an unsourced option list).
const CHOICE_REVIEW = {
  Barbarian: [
    ["Storm Herald environment", "gaps", "playTime", "environment chosen each rage; option list unsourced"],
    ["Totem Warrior totem choices (3rd/6th/14th)", "gaps", "levelUp", "totem options unsourced"],
    ["Form of the Beast (per-rage)", "by-design", "playTime", "chosen each rage in play state, never a saved build pick"],
  ],
  Bard: [
    ["College of Lore bonus skill proficiencies", "gaps", "build", "skill option list unsourced"],
    ["College of Swords Fighting Style", "gaps", "build", "style option list unsourced"],
    ["Magical Secrets selections", "done", "levelUp", "real picker in the wizard (see MAGICAL_SECRETS_UNLOCKS + Bard spell steps)"],
  ],
  Cleric: [
    ["Arcana Domain wizard cantrips", "gaps", "build", "cantrip option list unsourced"],
    ["Knowledge Domain Blessings of Knowledge", "gaps", "build", "skill/language option mechanics unsourced"],
    ["Nature Domain druid cantrip", "gaps", "build", "cantrip option list unsourced"],
    ["Domain spells (all 14 domains)", "done", "build", "level-gated grants + computed Domain Spells line"],
  ],
  Druid: [
    ["Circle of the Land terrain", "done", "build", "real group (category features, level 2) with level-gated circle-spell modifiers per option"],
    ["Circle of Wildfire bonus cantrip", "gaps", "build", "cantrip option list unsourced"],
    ["Circle of Stars star-map form", "gaps", "playTime", "form chosen on use; option mechanics unsourced"],
    ["Circle spells (Spores/Land/Wildfire)", "gaps", "build", "audit templates cover domain/oath spells only"],
  ],
  Fighter: [
    ["Arcane Archer Arcane Shot options", "gaps", "levelUp", "shot option list unsourced"],
    ["Battle Master maneuvers + artisan tool", "gaps", "levelUp", "maneuver option list unsourced (tool pick unsourced too)"],
    ["Cavalier bonus proficiency", "gaps", "build", "option list unsourced"],
    ["Eldritch Knight cantrips/spells", "done", "build", "chosen in the Spells step; grant carries third-caster context (minLevel 3)"],
    ["Rune Knight runes", "gaps", "levelUp", "rune option list unsourced"],
  ],
};

let total = 0;
const lines = [];
const reviewed = Object.keys(CHOICE_REVIEW).sort();
if (reviewed.length) {
  lines.push("## Choice-review dispositions", "");
  for (const className of reviewed) {
    lines.push(`### ${className}`, "");
    for (const [item, status, kind, note] of CHOICE_REVIEW[className]) {
      lines.push(`- ${item} — ${status} (choiceKind ${kind}): ${note}.`);
    }
    lines.push("");
  }
}
for (const [className, subs] of [...byClass.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push(`## ${className}`, "");
  for (const { subclass, grants } of subs.sort((a, b) => a.subclass.localeCompare(b.subclass))) {
    lines.push(`### ${subclass}`, "");
    for (const g of grants) {
      total++;
      lines.push(`- \`${g.id}\` — ${subclass}, level ${g.minLevel ?? "always"}: ${noteFor(subclass, g)}`);
    }
    lines.push("");
  }
}

const header = `# Subclass gaps — unsourced feature grants

Every feature grant below has no entry in
\`data/subclass-feature-summaries.json\` (and therefore no entry in
\`data/subclass-feature-sources.json\`), so it renders with NO mechanics
text — omitted from player-facing display until sourced — per
docs/SUBCLASS-CONTENT-AUDIT-2026-09.md §2b. One line each: feature id,
subclass name, level, what's missing. Total unsourced: ${total} of ${
  SUBCLASS_SUPPLEMENT.reduce((n, s) => n + (s.bundle.featureGrants || []).length, 0)
} grants (${Object.keys(SUMMARIES).length} sourced).

Regenerate (never hand-edit the list below):
\`node scripts/gen-subclass-gaps.mjs [--class <Class>]\`

## Merged duplicates (not gaps — intentionally folded, no omission)

- \`arcane-trickster-3-spellcasting\` — Arcane Trickster, level 3:
  section placeholder merged into the sourced third-caster note grant
  \`arcane-trickster-spellcasting\`.
- \`eldritch-knight-3-spellcasting\` — Eldritch Knight, level 3:
  section placeholder merged into the sourced third-caster note grant
  \`eldritch-knight-spellcasting\`.
- \`artillerist-3-explosive-cannon\` export quirk: the Foundry export
  labels the 3rd-level Artillerist feature "Explosive Cannon",
  duplicating the 9th-level feature name. The compiled output keeps the
  export's label input-faithfully (renaming it would assert unsourced
  mechanics); the grant is unsourced like every other feature below.

`;
writeFileSync(path.join(ROOT, "docs", "subclass-gaps.md"), header + lines.join("\n"), "utf8");
console.log(`Wrote docs/subclass-gaps.md (${total} unsourced grants)`);

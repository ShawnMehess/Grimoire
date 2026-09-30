// Audit subclass features whose prose implies the player must choose
// something, and classify each one. Analysis tool, not a build step: it
// writes nothing but the report it prints, so it can be re-run after any
// text or pick change to prove the classification still holds.
//
//   node scripts/audit-subclass-choices.mjs [--all] [--subclass <key>]
//
// WHY THIS EXISTS
// The subclass export was taken from the ACTOR, so features arrived as
// bare `@Compendium[...]{Name}` references with no prose, and a choice
// written only in prose cannot be detected. Now that the rules text is
// fetched (see fetch-subclass-feature-text.mjs) the choices are visible
// and can be checked against the choice groups that actually ship.
//
// THE CLASSIFICATION IS THE POINT
// "of your choice" appears in two very different kinds of sentence:
//
//   real build pick   "you learn two spells of your choice"        -> candidate
//   play-time target  "one or more creatures of your choice"        -> target
//   play-time effect  "create one item of your choice"              -> playTime
//   subclass choice   "When you choose this path at 3rd level"      -> subclassPick
//   conditional       "If you already have this proficiency, ..."   -> conditional
//
// A keyword scan cannot tell these apart on its own, and treating a
// play-time target as a saved pick is a real bug: it would put
// "which creature do I attack" into character creation. So the
// classifiers below run in order and the FIRST match wins, with the
// most specific/most-excluding patterns first.

import { SUBCLASS_BUNDLE_MAP, patchedSubclassBundle } from "../js/data/contentFixups.js";
import { SUBCLASS_SUPPLEMENT } from "../js/data/subclassContent.js";
import { ALL_SUBCLASS_PICKS } from "../js/data/subclassPicks.js";

const args = process.argv.slice(2);
const only = args.includes("--all") ? null : (() => {
  const i = args.indexOf("--subclass");
  return i >= 0 ? args[i + 1] : null;
})();

// Ordered. First match wins, so exclusions come before inclusions.
const CLASSIFIERS = [
  // Picking a subclass/domain/path IS the subclass dropdown, not a pick.
  ["subclassPick", /\bwhen you (?:choose|adopt|join) (?:this|the) (?:path|domain|archetype|college|circle|school|oath|order|tradition|patron|background)\b/i],
  // Already-met prerequisites: a real choice, but only conditionally.
  ["conditional", /\bif you (?:already|don't|do not) (?:have|proficient)\b/i],
  // Choosing what to hit / which spell to end is play-time.
  ["target", /\b(?:creature|creatures|ally|allies|one of the damaged|spell|spells|targets?) of your choice\b/i],
  ["target", /\byou (?:may )?choose (?:a|an|one|two) (?:creature|creatures|ally|allies|target|targets|humanoid|object)\b/i],
  // Effect chosen each time the feature is used.
  ["playTime", /\b(?:each|every) time\b/i],
  ["playTime", /\bas (?:an?|your) (?:action|bonus action|reaction)\b/i],
  ["playTime", /\byou (?:can|may) (?:also )?(?:create|cast|choose) .{0,60}\bitem of your choice\b/i],
  // Real saved build choices.
  ["candidate", /\bchoose one of the following\b/i],
  ["candidate", /\bchoose (?:four|two|three|any) (?:spells|cantrips|feats|options)\b/i],
  ["candidate", /\byou (?:learn|gain) (?:proficiency with )?(?:two|three|four|another|other)\b[^.]*\bof your choice\b/i],
  ["candidate", /\bproficiency with (?:one other|two|another)\b[^.]*\bof your choice\b/i],
  ["candidate", /\byou (?:may )?choose (?:a|an) (?:totem|spirit|boon|patron|element|discipline|form|style|shape|rune|maneuver|infusion|charm|hazard|metamagic|aspect|focus|animal|monster|fighting style)\b/i],
  ["candidate", /\bof your choice (?:from|among)\b/i],
  ["candidate", /\byou select (?:two|three|four|a number)\b/i],
];

function classify(text) {
  for (const [kind, re] of CLASSIFIERS) if (re.test(text)) return kind;
  return "none";
}

const NAME = new Map(SUBCLASS_SUPPLEMENT.map((s) => [s.name, s.name]));
const rows = [];
for (const [key, raw] of SUBCLASS_BUNDLE_MAP) {
  if (only && key !== only) continue;
  const bundle = patchedSubclassBundle(NAME.get(key) || key, raw);
  const picks = ALL_SUBCLASS_PICKS[key] || [];
  const covered = new Set(picks.map((p) => p.feature));
  for (const g of bundle.featureGrants || []) {
    const text = g.description || "";
    if (!text.trim()) continue;
    if (!/\byour choice\b|\bone of the following\b|\byou (?:may )?(?:choose|select)\b|\bof your choice\b/i.test(text)) continue;
    const kind = covered.has(g.name) ? "picked" : classify(text);
    rows.push({ key, feature: g.name, level: g.minLevel ?? "always", kind });
  }
}

const tally = new Map();
for (const r of rows) tally.set(r.kind, (tally.get(r.kind) || 0) + 1);
console.log(`subclass features whose prose mentions a choice: ${rows.length}`);
for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);

const candidates = rows.filter((r) => r.kind === "candidate");
console.log(`\nreal build choices with no picker yet: ${candidates.length}`);
for (const r of candidates) console.log(`  [${r.key}] ${r.feature} (L${r.level})`);
if (!args.includes("--all")) {
  console.log(`\n(passed --all for the full feature list, or --subclass <key> to narrow)`);
}

// spellIndex.js
//
// Finding spell names in prose.
//
// Race traits, class features and feats constantly name the spells they
// hand you - "you know the Misty Step spell", "cast Darkness once per
// long rest", "Blindness/Deafness, Blur, and Disguise Self". That's 60-odd
// mentions across the shipped content, and every one of them is a place
// the player has to hand-copy into their spell list.
//
// Matching is a data problem before it's a rendering one, so it lives
// here, pure and DOM-free, and is unit-tested against the real catalog
// and the real corpus (see tests/spell-links.test.mjs).
//
// Two rules, both earned from scanning the shipped content rather than
// guessed:
//
//  - Case-insensitive DISCOVERY, title-case CONFIRMATION. The catalog
//    writes "Gust of Wind" but a Dwarf trait says "Gust Of Wind", so a
//    case-sensitive match would miss the real name and then match the
//    shorter spell "Gust" that happens to be a prefix of it. Comparing
//    case-insensitively and then checking the matched run is still
//    title-case accepts the real name and rejects "in dim light within
//    60 feet".
//
//  - A short denylist, from the scan. "Resistance to cold damage" and
//    the Darkvision 60 ft. sense both collide with spells of the same
//    name, and in every case in the corpus they mean the mechanic, not
//    the spell. A rule we know is wrong stays unlinked rather than
//    sending the player to a cantrip they didn't ask for.
//
//  - A spell name is never a FRAGMENT of a longer shipped name. This is
//    the one that bit hardest, because it is invisible until you read
//    the sheet: the Duergar's weapon line is "Battleaxe, Handaxe, Light
//    Hammer, Warhammer", every class's armor line is "Light Armor,
//    Medium Armor", and both rendered "Light" as a link to the Light
//    cantrip - a proficiency in a hammer pointing at an evocation spell.
//    Same shape with a feature NAME: "Slow Fall", "Dragon Fear", "Shield
//    Master", "Magical Guidance" and "Light Bearer" each contain a spell
//    name as their second half. The rule that separates them from a real
//    mention is not the word, it is the PHRASE: in "Cast Light Armor" the
//    surrounding capitalised words spell out an item, in "cast Light once
//    per long rest" the spell name stands alone. So a mention is only
//    honoured when the whole capitalised phrase it sits in is a spell -
//    see properNounPhrases below.

import { SPELL_CATALOG, WEAPONS_ARMOR_CATALOG, GEAR_CATALOG } from "./contentCatalogs.js";
import { FEAT_NAMES } from "./featBundles.js";
import {
  FIXED_RACE_ENTRIES,
  FIXED_CLASS_ENTRIES,
  FIXED_BG_ENTRIES,
} from "./contentFixups.js";
import { RACE_EXTRA_ENTRIES } from "./extraRaces.js";
import { SUBCLASS_SUPPLEMENT } from "./subclassContent.js";

/** Spell names that are always the mechanic, never the spell, in the
 *  prose this sheet renders. See the note above - every entry was found
 *  by scanning the shipped races/classes/feats. */
export const SPELL_LINK_DENYLIST = new Set([
  "Resistance", // "Resistance to cold damage" / the "Reactive Resistance" feat
  "Darkvision", // the "Darkvision 60 ft." sense, on four race rows
]);

/** Words allowed to stay capitalised inside a multi-word spell name. */
const CONNECTORS = new Set(["of", "the", "and", "a"]);

/** First letter of each segment capitalised, the rest lower, allowing
 *  apostrophes and hyphens inside a segment. The slash matters: the
 *  catalog really does ship "Blindness/Deafness" as one spell. */
const TITLE_WORD = /^[A-Z][a-z'’-]*(\/[A-Z][a-z'’-]*)*$/;

let cachedIndex = null;

/** The maximal run of adjacent capitalised words around [start, end),
 *  as `{ text, start, end }`. Only capitalised words extend it - a
 *  connector never does, so "Cast Magic Missile of" is not a thing and
 *  the run cannot swallow half a sentence.
 *
 *  Returns the matched run itself when nothing capitalised touches it,
 *  which is the case for nearly every genuine mention ("cast Light once
 *  per long rest" -> "Light"). Exported because it is the whole of the
 *  fragment rule and is worth testing on its own. */
export function surroundingCapitalisedRun(text, start, end) {
  const src = String(text ?? "");
  let from = start;
  for (;;) {
    const before = src.slice(0, from);
    const m = /([A-Za-z'’/-]+)(\s+)$/.exec(before);
    if (!m || !TITLE_WORD.test(m[1])) break;
    from = before.length - m[0].length;
  }
  let to = end;
  for (;;) {
    const m = /^(\s+)([A-Za-z'’/-]+)/.exec(src.slice(to));
    if (!m || !TITLE_WORD.test(m[2])) break;
    to += m[0].length;
  }
  return { text: src.slice(from, to), start: from, end: to };
}

let cachedProperNouns = null;

/** Every shipped name that is NOT a spell, lower-cased.
 *
 *  Items, weapons and armour from the catalogs, feat names, and then
 *  everything the bundles themselves print as a name: entry names,
 *  feature-grant names, resource names, choice-group labels, choice
 *  option names, and the `grantTag` proficiency vocabulary (the values
 *  behind "Weapons: Battleaxe, Handaxe, Light Hammer, Warhammer"). So
 *  "is this capitalised phrase something other than a spell?" is a
 *  lookup instead of a guess, and an imported homebrew name is covered
 *  the moment it is in a bundle. Built once and cached, like the spell
 *  index.
 *
 *  The trailing parenthetical is stripped as well as kept: the compiled
 *  data calls a feature "Magical Guidance (Optional)", which is not the
 *  phrase the prose prints, and the phrase that has to be recognised is
 *  "Magical Guidance". */
export function properNounPhrases() {
  if (cachedProperNouns) return cachedProperNouns;
  const out = new Set();
  const add = (value) => {
    const name = String(value ?? "").trim().replace(/\s+/g, " ");
    if (!name) return;
    out.add(name.toLowerCase());
    const bare = name.replace(/\s*\((?:[^()]*)\)\s*$/, "").trim();
    if (bare && bare !== name) out.add(bare.toLowerCase());
  };
  const walkBundle = (bundle) => {
    if (!bundle) return;
    for (const mod of bundle.statModifiers || []) {
      if (mod?.op === "grantTag" || mod?.op === "grant") add(mod?.value);
    }
    for (const grant of bundle.featureGrants || []) add(grant.name);
    for (const grant of bundle.resourceGrants || []) add(grant.name);
    for (const group of bundle.choiceGroups || []) {
      add(group.label);
      for (const option of group.options || []) {
        add(option.name);
        walkBundle(option);
      }
      for (const category of group.categories || []) {
        add(category.label);
        for (const option of category.options || []) {
          add(option.name);
          walkBundle(option);
        }
      }
    }
  };
  for (const tab of WEAPONS_ARMOR_CATALOG?.tabs || []) for (const e of tab.entries || []) add(e.name);
  for (const tab of GEAR_CATALOG?.tabs || []) for (const e of tab.entries || []) add(e.name);
  for (const name of FEAT_NAMES || []) add(name);
  const bundles = [
    ...(FIXED_RACE_ENTRIES || []),
    ...(FIXED_CLASS_ENTRIES || []),
    ...(FIXED_BG_ENTRIES || []),
    ...(RACE_EXTRA_ENTRIES || []),
    ...(SUBCLASS_SUPPLEMENT?.subclasses || []),
  ];
  for (const entry of bundles) {
    add(entry.name);
    walkBundle(entry.bundle);
  }
  cachedProperNouns = out;
  return out;
}


/** Every spell in the shipped catalog, keyed for matching.
 *
 *  Built once and cached: it's 537 entries and prose rendering asks for
 *  it on every bullet of every row. `names` is sorted longest-first so a
 *  longer spell name is matched ahead of any shorter name that prefixes
 *  it, and `byLowerName` maps a case-folded run back to the catalog's
 *  own spelling. */
export function spellNameIndex() {
  if (cachedIndex) return cachedIndex;
  const tabs = SPELL_CATALOG?.tabs || [];
  const byName = new Map();
  const byLowerName = new Map();
  for (const tab of tabs) {
    for (const entry of tab.entries || []) {
      const name = String(entry?.name || "").trim();
      if (!name || byName.has(name)) continue;
      byName.set(name, entry);
      const lower = name.toLowerCase();
      // Longest spelling wins for a case collision, so "Gust of Wind"
      // can't be shadowed by a hypothetical "Gust of Wind!" entry.
      if (!byLowerName.has(lower) || name.length > byLowerName.get(lower).name.length) {
        byLowerName.set(lower, entry);
      }
    }
  }
  const names = [...byName.keys()]
    .filter((name) => !SPELL_LINK_DENYLIST.has(name))
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  // Case-insensitive alternation, longest name first. The name's own
  // letters are matched as-is; only the surrounding flag is `i`.
  const pattern = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  cachedIndex = { byName, byLowerName, names, re: new RegExp(`\\b(?:${pattern})\\b`, "gi") };
  return cachedIndex;
}

/** Is this matched run written the way a spell name is written?
 *
 *  True for "Misty Step", "Gust Of Wind" (a capitalised connector inside
 *  the name), "Light", "Blindness/Deafness". False for "dim light",
 *  "resistance to damage", "a light source" - every one of which a
 *  case-insensitive scan would happily return. */
export function looksLikeSpellName(text) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    // A connector is allowed to keep whatever case the prose gave it.
    if (i > 0 && CONNECTORS.has(word.toLowerCase())) continue;
    if (!TITLE_WORD.test(word)) return false;
  }
  return true;
}

/** Is this matched run only a PART of a longer capitalised phrase that
 *  the app prints as a name of its own?
 *
 *  True for "Light" in "Light Armor", "Light Hammer", "Light Crossbow"
 *  or "Light Bearer"; for "Fear" in "Dragon Fear"; for "Shield" in
 *  "Shield Master". False for "Light" standing alone in "cast Light
 *  once per long rest", and false for the run sitting inside a capitalised
 *  phrase that is NOT a shipped name at all - "Cast Mage Armor" is not
 *  anything in the catalog, so the run in it is still a spell mention.
 *
 *  That last clause is why this is a lookup and not a shape test: a rule
 *  like "never link a word glued to a capitalised word" also kills every
 *  "Cast X" in the corpus, which is most of the good links. */
function isFragmentOfAnotherName(src, start, end) {
  const run = surroundingCapitalisedRun(src, start, end);
  if (run.text === src.slice(start, end)) return false;
  return properNounPhrases().has(run.text.replace(/\s+/g, " ").trim().toLowerCase());
}

/** Every spell mentioned in `text`, in order.
 *
 *  Returns `[{ name, text, start, end }]` where `name` is the catalog's
 *  spelling and `text` is the run as the prose wrote it. Mentions can't
 *  overlap: the alternation is longest-first and `\b`-delimited, so
 *  "Gust Of Wind" is consumed whole instead of matching "Gust" and
 *  leaving "Of Wind" behind.
 *
 *  A run that turns out to be part of a longer capitalised phrase is
 *  dropped last, not early: the phrase test needs the run's position in
 *  the original text, so the alternation has to have found it first. */
export function findSpellMentions(text) {
  const src = String(text ?? "");
  if (!src) return [];
  const { re, byLowerName } = spellNameIndex();
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    const run = m[0];
    // Advance past the run regardless: a rejected run ("dim light") must
    // not be re-tested at every following offset.
    re.lastIndex = m.index + run.length;
    if (!looksLikeSpellName(run)) continue;
    const entry = byLowerName.get(run.toLowerCase());
    if (!entry) continue;
    if (isFragmentOfAnotherName(src, m.index, m.index + run.length)) continue;
    out.push({ name: entry.name, text: run, start: m.index, end: m.index + run.length });
  }
  return out;
}

/** The catalog entry for a spell name, or null. */
export function spellEntryByName(name) {
  if (!name) return null;
  return spellNameIndex().byName.get(String(name).trim()) || null;
}

/** Which spell level a name sits in (0 for cantrips), or null if the
 *  name isn't in the catalog. */
export function spellLevelFor(name) {
  const target = String(name || "").trim().toLowerCase();
  if (!target) return null;
  for (const tab of SPELL_CATALOG?.tabs || []) {
    if ((tab.entries || []).some((e) => String(e?.name || "").trim().toLowerCase() === target)) {
      return tab.id === "cantrips" ? 0 : Number(String(tab.id).replace("level", "")) || 0;
    }
  }
  return null;
}

/** The "meta" line a spell entry shows: level, school, casting time,
 *  range, duration - in the order the books print them. */
export function spellMetaLine(entry) {
  const f = entry?.fieldValues || {};
  const level = f.level || (spellLevelFor(entry?.name) === 0 ? "Cantrip" : "");
  return [level, f.school, f.castingTime, f.range, f.duration]
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join(" · ");
}

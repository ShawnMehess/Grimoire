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

import { SPELL_CATALOG } from "./contentCatalogs.js";

/** Spell names that are always the mechanic, never the spell, in the
 *  prose this sheet renders. See the note above - every entry was found
 *  by scanning the shipped races/classes/feats. */
export const SPELL_LINK_DENYLIST = new Set([
  "Resistance", // "Resistance to cold damage" / the "Reactive Resistance" feat
  "Darkvision", // the "Darkvision 60 ft." sense, on four races
]);

/** Words allowed to stay capitalised inside a multi-word spell name. */
const CONNECTORS = new Set(["of", "the", "and", "a"]);

/** First letter of each segment capitalised, the rest lower, allowing
 *  apostrophes and hyphens inside a segment. The slash matters: the
 *  catalog really does ship "Blindness/Deafness" as one spell. */
const TITLE_WORD = /^[A-Z][a-z'’-]*(\/[A-Z][a-z'’-]*)*$/;

let cachedIndex = null;

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

/** Every spell mentioned in `text`, in order.
 *
 *  Returns `[{ name, text, start, end }] where `name` is the catalog's
 *  spelling and `text` is the run as the prose wrote it. Mentions can't
 *  overlap: the alternation is longest-first and `\b`-delimited, so
 *  "Gust Of Wind" is consumed whole instead of matching "Gust" and
 *  leaving "Of Wind" behind. */
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

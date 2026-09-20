// Ruleset registry and plain data-driven level-up resolver, consumed
// by the Leveling tab's guided flow (see rulesEngine.js).
//
// Content here comes from DEFAULT_CONTENT (see defaultContent.js and
// RESCUE-NOTES.md) — Shawn's own classes/races/backgrounds JSON,
// compiled once rather than hand-typed. Spell-slot progression and
// caster type (full/half/pact) are the one piece that source data
// didn't cover (Schema.txt has no spellcasting section), so those
// tables below are standard 5e math, keyed by class name.

import { DEFAULT_CONTENT } from "./defaultContent.js";

const CLASSES = DEFAULT_CONTENT.classEntries.map((entry) => {
  const allowed = new Set((entry.bundle.dropdownAccess[0]?.allowedChoiceIds) || []);
  const subclasses = DEFAULT_CONTENT.subclassChoices
    .filter((c) => allowed.has(c.id))
    .map((c) => c.text);
  return {
    name: entry.name,
    subclassLevel: entry.subclassLevel || 99,
    subclasses,
    caster: entry.caster || null,
  };
});

// Artificer class (from Tasha's Cauldron of Everything) — not in DEFAULT_CONTENT.
const ARTIFICER_CLASS = {
  name: "Artificer",
  subclassLevel: 3,
  subclasses: ["Alchemist", "Armorer", "Artillerist", "Battle Smith"],
  caster: "half",
};

CLASSES.push(ARTIFICER_CLASS);

// PHB-only classes (12 core classes) — used for the PHB content pack.
const PHB_CLASSES = CLASSES.filter((c) => c.name !== "Artificer");

// Player-facing subclasses from Xanathar's Guide to Everything, as
// factual metadata only (class, subclass name, unlock level). The
// name strings deliberately match the starter Subclass choices
// (compiled from Shawn's own Foundry exports) so picking one reuses
// the same bundles and mechanics already on file — no book prose is
// reproduced here. Monster, campaign, trap, and downtime material
// from the book is intentionally out of scope.
const XANATHAR_CLASSES = [
  { name: "Barbarian", subclassLevel: 3, caster: null, subclasses: ["Path of the Ancestral Guardian", "Path of the Storm Herald", "Path of the Zealot Herald"] },
  { name: "Bard", subclassLevel: 3, caster: "full", subclasses: ["College of Glamour", "College of Swords", "College of Whispers"] },
  { name: "Cleric", subclassLevel: 1, caster: "full", subclasses: ["Forge Domain", "Grave Domain"] },
  { name: "Druid", subclassLevel: 2, caster: "full", subclasses: ["Circle of Dreams", "Circle of the Shepherd"] },
  { name: "Fighter", subclassLevel: 3, caster: null, subclasses: ["Arcane Archer", "Cavalier", "Samurai"] },
  { name: "Monk", subclassLevel: 3, caster: null, subclasses: ["Way of the Drunken Master", "Way of the Kensei", "Way of the Sun Soul"] },
  { name: "Paladin", subclassLevel: 3, caster: "half", subclasses: ["Oath of Conquest", "Oath of Redemption"] },
  { name: "Ranger", subclassLevel: 3, caster: "half", subclasses: ["Gloom Stalker Conclave", "Horizon Walker Conclave", "Monster Slayer Conclave"] },
  { name: "Rogue", subclassLevel: 3, caster: null, subclasses: ["Inquisitive", "Mastermind", "Scout", "Swashbuckler"] },
  { name: "Sorcerer", subclassLevel: 1, caster: "full", subclasses: ["Divine Soul", "Shadow Magic", "Storm Sorcery"] },
  { name: "Warlock", subclassLevel: 1, caster: "pact", subclasses: ["The Celestial", "The Hexblade"] },
  { name: "Wizard", subclassLevel: 2, caster: "full", subclasses: ["War Magic"] },
];

// A RULESET is a game system (e.g. "D&D 5e (2014)") — the thing
// level-up math, spell slots, and hit dice resolve against. Its
// content lives in CONTENT_PACKS (the books: Player's Handbook,
// Xanathar's Guide, Tasha's Cauldron), which contribute class/subclass
// metadata and are the units a player checks on/off for their
// character. A character stores its system in rules.rulesetId and its
// included books in rules.rulesetIds.
//
// Older saves used the ruleset ids themselves as the checkable units
// ("homebrew", "xanathar"); LEGACY_RULESET_MIGRATION below rewrites
// them to the new system + pack ids on normalize.

// The Xanathar subclass names as a set, so the PHB pack can be kept
// PHB-only: those names are attributed to (and offered by) the
// Xanathar's pack alone, and only surface when that pack is checked.
const XGE_SUBCLASS_NAMES = new Set((XANATHAR_CLASSES || []).flatMap((row) => row.subclasses || []));

// Tasha's Cauldron of Everything subclasses (26 subclasses across 13 classes)
// Format matches XANATHAR_CLASSES: { name, subclassLevel, caster, subclasses: [...] }
const TASHA_CLASSES = [
  { name: "Artificer", subclassLevel: 3, caster: "half", subclasses: ["Alchemist", "Armorer", "Artillerist", "Battle Smith"] },
  { name: "Barbarian", subclassLevel: 3, caster: null, subclasses: ["Path of the Beast", "Path of Wild Magic"] },
  { name: "Bard", subclassLevel: 3, caster: "full", subclasses: ["College of Creation", "College of Eloquence"] },
  { name: "Cleric", subclassLevel: 1, caster: "full", subclasses: ["Order Domain", "Peace Domain", "Twilight Domain"] },
  { name: "Druid", subclassLevel: 2, caster: "full", subclasses: ["Circle of Spores", "Circle of Stars", "Circle of Wildfire"] },
  { name: "Fighter", subclassLevel: 3, caster: null, subclasses: ["Psi Warrior", "Rune Knight"] },
  { name: "Monk", subclassLevel: 3, caster: null, subclasses: ["Way of Mercy", "Way of the Astral Self"] },
  { name: "Paladin", subclassLevel: 3, caster: "half", subclasses: ["Oath of Glory", "Oath of the Watchers"] },
  { name: "Ranger", subclassLevel: 3, caster: "half", subclasses: ["Fey Wanderer", "Swarmkeeper"] },
  { name: "Rogue", subclassLevel: 3, caster: null, subclasses: ["Phantom", "Soulknife"] },
  { name: "Sorcerer", subclassLevel: 1, caster: "full", subclasses: ["Aberrant Mind", "Clockwork Soul"] },
  { name: "Warlock", subclassLevel: 1, caster: "pact", subclasses: ["The Fathomless", "The Genie"] },
  { name: "Wizard", subclassLevel: 2, caster: "full", subclasses: ["Bladesinging", "Order of Scribes"] },
];

// The Tasha's subclass names as a set, so the PHB pack stays PHB-only
// too: those names are attributed to (and offered by) the Tasha's
// pack alone, and only surface when that pack is checked.
const TASHA_SUBCLASS_NAMES = new Set((TASHA_CLASSES || []).flatMap((row) => row.subclasses || []));

export const CONTENT_PACKS = [
  {
    id: "phb",
    rulesetId: "dnd5e-2014",
    name: "Player's Handbook",
    description: "The core 2014 rules: all twelve classes with their Player's Handbook subclasses, plus the base races, backgrounds, feats, spells, and equipment.",
    classes: PHB_CLASSES.map((row) => ({
      ...row,
      // Xanathar's and Tasha's subclasses are attributed to their own
      // packs; they appear here only in the merged (all-packs) view.
      subclasses: (row.subclasses || []).filter((name) => !XGE_SUBCLASS_NAMES.has(name) && !TASHA_SUBCLASS_NAMES.has(name)),
    })),
  },
  {
    id: "xanathar",
    rulesetId: "dnd5e-2014",
    name: "Xanathar's Guide to Everything",
    description: "Player options from Xanathar's Guide (all twelve classes gain subclasses). Subclass names are built in; tag fuller mechanics to this source in the Bundle Libraries.",
    classes: XANATHAR_CLASSES,
  },
  {
    id: "tashas",
    rulesetId: "dnd5e-2014",
    name: "Tasha's Cauldron of Everything",
    description: "Player options from Tasha's Cauldron of Everything: subclasses, optional class features, spells, feats, magic items, and more.",
    classes: TASHA_CLASSES,
  },
];

export const RULESETS = [
  {
    id: "dnd5e-2014",
    name: "D&D 5e (2014)",
    description: "The classic 2014 Fifth Edition ruleset: standard leveling, multiclassing, hit dice, and spell-slot math. Content comes from the books checked below.",
    contentPackIds: ["phb", "xanathar", "tashas"],
    defaultContentPackIds: ["phb"],
  },
];

// Older saves picked whole sources ("homebrew", "xanathar") as
// checkable units. Each legacy id maps to the new D&D 5e (2014) system
// plus the content packs it used to bundle together. canonicalContentPackId
// is what a bundle tag (or lookup) of that legacy id means in book
// terms: the old "homebrew" ruleset WAS the PHB pack, the old
// "xanathar" ruleset WAS the Xanathar's pack.
export const LEGACY_RULESET_MIGRATION = {
  homebrew: { rulesetId: "dnd5e-2014", contentPackIds: ["phb"], canonicalContentPackId: "phb" },
  xanathar: { rulesetId: "dnd5e-2014", contentPackIds: ["phb", "xanathar"], canonicalContentPackId: "xanathar" },
};

export function listRulesets() {
  return RULESETS.map(({ id, name, description }) => ({ id, name, description: description || "" }));
}

export function getRuleset(id) {
  const ruleset = RULESETS.find((entry) => entry.id === id) || null;
  if (!ruleset) return null;
  const classNames = mergedClassNamesFor(id);
  return {
    id: ruleset.id,
    name: ruleset.name,
    description: ruleset.description || "",
    contentPackIds: ruleset.contentPackIds,
    defaultContentPackIds: ruleset.defaultContentPackIds,
    classes: classNames.map((name) => mergedClassEntryFor(id, name)).filter(Boolean),
  };
}

/** Content book ids belonging to a ruleset. Pure. */
export function listContentPacks(rulesetId) {
  const ruleset = RULESETS.find((entry) => entry.id === rulesetId);
  if (!ruleset) return [];
  return ruleset.contentPackIds
    .map((pid) => CONTENT_PACKS.find((pack) => pack.id === pid))
    .filter(Boolean)
    .map(({ id, name, description }) => ({ id, name, description: description || "" }));
}

export function getContentPack(id) {
  return CONTENT_PACKS.find((pack) => pack.id === id) || null;
}

/** The books a ruleset starts a fresh character with (single source
 *  rule: one book → it, otherwise the system's stated default). Pure. */
export function defaultContentPackIds(rulesetId) {
  const ruleset = RULESETS.find((entry) => entry.id === rulesetId);
  if (!ruleset) return [];
  if (ruleset.contentPackIds.length === 1) return [...ruleset.contentPackIds];
  return [...(ruleset.defaultContentPackIds || [])];
}

/** Merges one class row across a system's content packs: subclass
 *  names union in first-seen (pack) order, subclassLevel is the lowest
 *  known, caster comes from the first pack that declares one. Pure. */
function mergedClassEntryFor(rulesetId, className) {
  const ruleset = RULESETS.find((entry) => entry.id === rulesetId);
  if (!ruleset) return null;
  let subclasses = [];
  let subclassLevel = Infinity;
  let caster = null;
  let seen = false;
  ruleset.contentPackIds.forEach((pid) => {
    const pack = CONTENT_PACKS.find((p) => p.id === pid);
    const row = pack?.classes?.find((entry) => entry.name === className);
    if (!row) return;
    seen = true;
    (row.subclasses || []).forEach((name) => {
      if (!subclasses.includes(name)) subclasses.push(name);
    });
    if (Number.isFinite(row.subclassLevel)) subclassLevel = Math.min(subclassLevel, row.subclassLevel);
    if (!caster && row.caster) caster = row.caster;
  });
  if (!seen) return null;
  return {
    name: className,
    subclassLevel: Number.isFinite(subclassLevel) ? subclassLevel : 99,
    subclasses,
    caster,
  };
}

/** Every class a system knows, in first-seen pack order. Pure. */
function mergedClassNamesFor(rulesetId) {
  const ruleset = RULESETS.find((entry) => entry.id === rulesetId);
  if (!ruleset) return [];
  const seen = new Set();
  const out = [];
  ruleset.contentPackIds.forEach((pid) => {
    const pack = CONTENT_PACKS.find((p) => p.id === pid);
    (pack?.classes || []).forEach((entry) => {
      if (!seen.has(entry.name)) {
        seen.add(entry.name);
        out.push(entry.name);
      }
    });
  });
  return out;
}

/** Canonical content-pack id for a stored source tag: legacy ruleset
 *  ids ("homebrew" → "phb", "xanathar" → "xanathar") and all current
 *  ids pass through unchanged. Pure. */
export function canonicalContentId(id) {
  return LEGACY_RULESET_MIGRATION[id]?.canonicalContentPackId || id;
}

/** Rewrites a legacy { rulesetId, rulesetIds } pair to the new shapes:
 *  rulesetId becomes the game-system id and contentPackIds the books
 *  it should list. A legacy primary bundles several books (the old
 *  "xanathar" ruleset stood for PHB + Xanathar's), so it seeds the
 *  set before the stored ids add theirs. Unknown ids are dropped
 *  rather than kept around to silently match nothing. Pure. */
export function canonicalizeSourceIds(value = {}) {
  const legacyPrimary = LEGACY_RULESET_MIGRATION[value.rulesetId];
  const primary = legacyPrimary
    ? legacyPrimary.rulesetId
    : (getRuleset(value.rulesetId) ? value.rulesetId : null);
  const rawPacks = Array.isArray(value.rulesetIds)
    ? value.rulesetIds
    : (value.rulesetId ? [value.rulesetId] : []);
  const packs = [];
  const pushPack = (pid) => {
    if (!packs.includes(pid)) packs.push(pid);
  };
  if (legacyPrimary) legacyPrimary.contentPackIds.forEach(pushPack);
  for (const id of rawPacks) {
    const legacy = LEGACY_RULESET_MIGRATION[id];
    if (legacy) legacy.contentPackIds.forEach(pushPack);
    else if (getContentPack(id)) pushPack(id);
  }
  const resolvedPrimary = primary || (getContentPack(packs[0])?.rulesetId || null);
  return { rulesetId: resolvedPrimary, contentPackIds: packs };
}

/** The content-pack ids to treat as included for a ruleset pair —
 *  the stored set when present, else the primary system's default
 *  books (so a lone system selection never faces an empty list). Pure. */
export function contentPackIdsFor(value = {}) {
  const canonical = canonicalizeSourceIds(value);
  if (canonical.contentPackIds.length > 0) return canonical.contentPackIds;
  return defaultContentPackIds(canonical.rulesetId);
}

/** Content-packs matching a match site: expands a system id to its
 *  books and canonicalizes legacy tags, so a bundle tagged "homebrew"
 *  (or, with canonicalContentId, "phb") matches whenever PHB is
 *  included, and a bundle tagged to the whole system matches any of
 *  its books. Pure. */
export function contentIdMatches(entryRulesetId, idOrIds) {
  const ids = (Array.isArray(idOrIds) ? idOrIds : [idOrIds]).filter(Boolean);
  const wanted = new Set();
  ids.forEach((id) => {
    const legacy = LEGACY_RULESET_MIGRATION[id];
    if (legacy) {
      legacy.contentPackIds.forEach((pid) => wanted.add(pid));
      return;
    }
    const ruleset = RULESETS.find((entry) => entry.id === id);
    if (ruleset) {
      ruleset.contentPackIds.forEach((pid) => wanted.add(pid));
      return;
    }
    wanted.add(id);
  });
  const entryTag = LEGACY_RULESET_MIGRATION[entryRulesetId]?.canonicalContentPackId || entryRulesetId;
  const entryRuleset = RULESETS.find((entry) => entry.id === entryTag);
  if (entryRuleset) return entryRuleset.contentPackIds.some((pid) => wanted.has(pid));
  return wanted.has(entryTag);
}

/** Class names across every included source (content pack or whole
 *  ruleset), deduplicated in first-seen order. The system's merge
 *  unions its books, so a PHB-only character still sees all twelve
 *  core classes. Pure. */
export function classNamesIn(idOrIds = []) {
  const ids = (Array.isArray(idOrIds) ? idOrIds : [idOrIds]).filter(Boolean);
  const seen = new Set();
  const out = [];
  ids.forEach((id) => {
    const pack = getContentPack(id);
    const rows = pack ? (pack.classes || []) : (getRuleset(id)?.classes || []);
    rows.forEach((entry) => {
      if (!seen.has(entry.name)) {
        seen.add(entry.name);
        out.push(entry.name);
      }
    });
  });
  return out;
}

/** Merged subclass list for one class across every included source
 *  (content pack or whole ruleset): { subclasses (deduped),
 *  subclassLevel (lowest known) }. A pack checks in only its own
 *  subclasses, which is what makes book gating work. Pure. */
export function subclassesAcrossRulesets(className, idOrIds = []) {
  const ids = (Array.isArray(idOrIds) ? idOrIds : [idOrIds]).filter(Boolean);
  const seen = new Set();
  const subclasses = [];
  let subclassLevel = Infinity;
  ids.forEach((id) => {
    const entry = getRulesetClass(id, className);
    if (!entry) return;
    (entry.subclasses || []).forEach((name) => {
      if (!seen.has(name)) {
        seen.add(name);
        subclasses.push(name);
      }
    });
    if (Number.isFinite(entry.subclassLevel)) subclassLevel = Math.min(subclassLevel, entry.subclassLevel);
  });
  return { subclasses, subclassLevel };
}

/** Class/subclass metadata for one className from one source: a
 *  content pack resolves to its own rows, a ruleset to the rows merged
 *  across its books. Pure. */
export function getRulesetClass(id, className) {
  const pack = getContentPack(id);
  if (pack) return pack.classes.find((entry) => entry.name === className) || null;
  return getRuleset(id)?.classes.find((entry) => entry.name === className) || null;
}

const FULL_CASTER_SLOTS = DEFAULT_CONTENT.fullCasterSlots;
const HALF_CASTER_SLOTS = DEFAULT_CONTENT.halfCasterSlots;
const WARLOCK_SLOTS = DEFAULT_CONTENT.warlockSlots;

// Artificer (TCE) spell slots by class level (slots1..slots5). Unlike
// Paladin/Ranger (the HALF_CASTER_SLOTS table, which starts at 2nd
// level), the Artificer casts from 1st level and tops out at 5th-level
// slots — confirmed against the TCE class table via two independent
// transcriptions (dndmc.wikidot.com/artificer and
// mactheowl.github.io/DMservices/class_aritifcer.html).
const ARTIFICER_SLOTS = {
  1: [2, 0, 0, 0, 0],
  2: [2, 0, 0, 0, 0],
  3: [3, 0, 0, 0, 0],
  4: [3, 0, 0, 0, 0],
  5: [4, 2, 0, 0, 0],
  6: [4, 2, 0, 0, 0],
  7: [4, 3, 0, 0, 0],
  8: [4, 3, 0, 0, 0],
  9: [4, 3, 2, 0, 0],
  10: [4, 3, 2, 0, 0],
  11: [4, 3, 3, 0, 0],
  12: [4, 3, 3, 0, 0],
  13: [4, 3, 3, 1, 0],
  14: [4, 3, 3, 1, 0],
  15: [4, 3, 3, 2, 0],
  16: [4, 3, 3, 2, 0],
  17: [4, 3, 3, 3, 1],
  18: [4, 3, 3, 3, 1],
  19: [4, 3, 3, 3, 2],
  20: [4, 3, 3, 3, 2],
};

function slotsFor(entry, level) {
  if (entry.name === "Artificer") {
    const row = ARTIFICER_SLOTS[level] || [];
    return row.map((count, i) => ({ fieldId: `slots${i + 1}`, options: count }));
  }
  if (entry.caster === "full") {
    const row = FULL_CASTER_SLOTS[level] || [];
    return row.map((count, i) => ({ fieldId: `slots${i + 1}`, options: count }));
  }
  if (entry.caster === "half") {
    const row = HALF_CASTER_SLOTS[level] || [];
    return row.map((count, i) => ({ fieldId: `slots${i + 1}`, options: count }));
  }
  if (entry.caster === "pact") {
    const [slotLevel, count] = WARLOCK_SLOTS[level] || [0, 0];
    if (!count) return [];
    return [{ fieldId: `slots${slotLevel}`, options: count }];
  }
  return [];
}

const SPELL_ABILITY = {
  Wizard: "int", Cleric: "wis", Druid: "wis", Ranger: "wis",
  Bard: "cha", Sorcerer: "cha", Warlock: "cha", Paladin: "cha",
  Artificer: "int",
};

// Standard hit dice by class (Schema.txt has no hit-die section).
export const CLASS_HIT_DICE = {
  Barbarian: 12,
  Fighter: 10, Paladin: 10, Ranger: 10,
  Bard: 8, Cleric: 8, Druid: 8, Monk: 8, Rogue: 8, Warlock: 8,
  Sorcerer: 6, Wizard: 6,
  Artificer: 8,
};

/** Hit die size for a class (8 when unknown — the most common die —
 *  rather than crashing a homebrew flow). Pure. */
export function hitDieFor(className) {
  return CLASS_HIT_DICE[className] || 8;
}

// PHB multiclass spellcaster table: rows are effective caster level
// (full levels + half levels/2↓ + third levels/3↓, min 1), values are
// slot counts for slots1..slots9. Eldritch Knight / Arcane Trickster
// subclasses cast as third-casters; everything else follows its
// class's own caster type.
const MULTICLASS_SLOTS = {
  1: [2, 0, 0, 0, 0, 0, 0, 0, 0],
  2: [3, 0, 0, 0, 0, 0, 0, 0, 0],
  3: [4, 2, 0, 0, 0, 0, 0, 0, 0],
  4: [4, 3, 0, 0, 0, 0, 0, 0, 0],
  5: [4, 3, 2, 0, 0, 0, 0, 0, 0],
  6: [4, 3, 3, 0, 0, 0, 0, 0, 0],
  7: [4, 3, 3, 1, 0, 0, 0, 0, 0],
  8: [4, 3, 3, 2, 0, 0, 0, 0, 0],
  9: [4, 3, 3, 3, 1, 0, 0, 0, 0],
  10: [4, 3, 3, 3, 2, 0, 0, 0, 0],
  11: [4, 3, 3, 3, 2, 1, 0, 0, 0],
  12: [4, 3, 3, 3, 2, 1, 0, 0, 0],
  13: [4, 3, 3, 3, 2, 1, 1, 0, 0],
  14: [4, 3, 3, 3, 2, 1, 1, 0, 0],
  15: [4, 3, 3, 3, 2, 1, 1, 1, 0],
  16: [4, 3, 3, 3, 2, 1, 1, 1, 0],
  17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
  18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
  19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
  20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
};

const THIRD_CASTER_SUBCLASSES = new Set(["eldritchknight", "arcanetrickster"]);

/** Effective caster level for one class slice, given its caster type
 *  and subclass (Eldritch Knight / Arcane Trickster count third). */
export function casterWeight(caster, subclass) {
  if (caster === "full") return 1;
  if (caster === "half") return 1 / 2;
  const norm = (subclass || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (THIRD_CASTER_SUBCLASSES.has(norm)) return 1 / 3;
  return 0;
}

/** Combined spell slots for a multiclassed character: [{ fieldId:
 *  "slotsN", options: count }], same shape as slotsFor. `classes` is
 *  [{ caster, levels, subclass }]. Warlock pact slots are NOT part of
 *  this table (they stay on their own short-rest track) — callers
 *  with a Warlock slice merge warlockSlots separately. Pure. */
export function multiclassSlotsFor(classes = []) {
  let effective = 0;
  for (const c of classes) {
    const levels = c.levels || 0;
    if (levels <= 0) continue;
    // Rounded down per class (PHB: half/third levels round down).
    effective += Math.floor(levels * casterWeight(c.caster, c.subclass));
  }
  if (effective <= 0) return [];
  effective = Math.min(20, effective);
  const row = MULTICLASS_SLOTS[effective] || [];
  return row
    .map((count, i) => ({ fieldId: `slots${i + 1}`, options: count }))
    .filter((change) => change.options > 0);
}

// Cantrips known and spells known, by level (1-20) — standard 5e
// tables for the "known" casters. Not derivable from Schema.txt (it
// has no spellcasting section), so hand-written here rather than
// left to crash or silently show 0.
const CANTRIPS_KNOWN = {
  Wizard: lvl => (lvl >= 10 ? 5 : lvl >= 4 ? 4 : 3),
  Cleric: lvl => (lvl >= 10 ? 5 : lvl >= 4 ? 4 : 3),
  Druid: lvl => (lvl >= 10 ? 4 : lvl >= 4 ? 3 : 2),
  Bard: lvl => (lvl >= 10 ? 4 : lvl >= 4 ? 3 : 2),
  Sorcerer: lvl => (lvl >= 10 ? 6 : lvl >= 4 ? 5 : 4),
  Warlock: lvl => (lvl >= 10 ? 4 : lvl >= 4 ? 3 : 2),
  // Artificer (TCE): 2 cantrips at 1st, a 3rd at 10th, a 4th at 14th.
  Artificer: lvl => (lvl >= 14 ? 4 : lvl >= 10 ? 3 : 2),
};

const SPELLS_KNOWN_TABLE = {
  Bard: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
  Sorcerer: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
  Warlock: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
  Ranger: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
};

function abilityMod(score) {
  return Math.floor(((Number(score) || 10) - 10) / 2);
}

export function getSpellcastingInfo(className) {
  const entry = CLASSES.find((c) => c.name === className);
  if (!entry || !entry.caster) return null;
  const ability = SPELL_ABILITY[className] || "int";
  const cantripsFn = CANTRIPS_KNOWN[className];
  const knownTable = SPELLS_KNOWN_TABLE[className];
  return {
    caster: entry.caster,
    ability,
    style: knownTable ? "known" : "prepared",
    cantrips: cantripsFn ? (lvl) => cantripsFn(lvl) : null,
    known: knownTable ? (lvl) => knownTable[Math.min(20, Math.max(1, lvl)) - 1] : null,
    // Prepared casters (Cleric/Druid/Wizard: ability mod + level;
    // Paladin/Artificer: ability mod + half level (rounded down), min 1).
    prepared: (lvl, mod) => Math.max(1, mod + ((className === "Paladin" || className === "Artificer") ? Math.floor(lvl / 2) : lvl)),
  };
}

export function getLevelUpPlan(rulesetId, className, level, selectedSubclass = "") {
  const ruleset = getRuleset(rulesetId);
  const classEntry = getRulesetClass(rulesetId, className);
  if (!ruleset || !classEntry || !Number.isInteger(level) || level < 1 || level > 20) return null;
  return {
    ruleset,
    classEntry,
    level,
    slotChanges: slotsFor(classEntry, level),
    subclassChoices: !selectedSubclass && level >= classEntry.subclassLevel ? classEntry.subclasses : [],
    needsSubclass: !selectedSubclass && level >= classEntry.subclassLevel,
  };
}

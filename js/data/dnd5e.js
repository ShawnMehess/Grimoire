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

export const RULESETS = [
  { id: "homebrew", name: "Homebrew", classes: CLASSES },
];

export function listRulesets() {
  return RULESETS.map(({ id, name }) => ({ id, name }));
}

export function getRuleset(id) {
  return RULESETS.find((ruleset) => ruleset.id === id) || null;
}

export function getRulesetClass(rulesetId, className) {
  return getRuleset(rulesetId)?.classes.find((entry) => entry.name === className) || null;
}

const FULL_CASTER_SLOTS = DEFAULT_CONTENT.fullCasterSlots;
const HALF_CASTER_SLOTS = DEFAULT_CONTENT.halfCasterSlots;
const WARLOCK_SLOTS = DEFAULT_CONTENT.warlockSlots;

function slotsFor(entry, level) {
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
};

// Standard hit dice by class (Schema.txt has no hit-die section).
export const CLASS_HIT_DICE = {
  Barbarian: 12,
  Fighter: 10, Paladin: 10, Ranger: 10,
  Bard: 8, Cleric: 8, Druid: 8, Monk: 8, Rogue: 8, Warlock: 8,
  Sorcerer: 6, Wizard: 6,
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
    // Paladin: ability mod + half level, min 1).
    prepared: (lvl, mod) => Math.max(1, mod + (className === "Paladin" ? Math.floor(lvl / 2) : lvl)),
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

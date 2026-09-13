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

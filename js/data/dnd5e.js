// Ruleset registry and plain data-driven level-up resolver.
// A ruleset is content, not sheet-rendering code.

const PHB_2014_CLASSES = [
  ["Barbarian", 3, ["Path of the Berserker", "Path of the Totem Warrior"]],
  ["Bard", 3, ["College of Lore", "College of Valor"], "full"],
  ["Cleric", 1, ["Knowledge Domain", "Life Domain", "Light Domain", "Nature Domain", "Tempest Domain", "Trickery Domain", "War Domain"], "full"],
  ["Druid", 2, ["Circle of the Land", "Circle of the Moon"], "full"],
  ["Fighter", 3, ["Champion", "Battle Master", "Eldritch Knight"]],
  ["Monk", 3, ["Way of the Open Hand", "Way of Shadow", "Way of the Four Elements"]],
  ["Paladin", 3, ["Oath of Devotion", "Oath of the Ancients", "Oath of Vengeance"], "half"],
  ["Ranger", 3, ["Hunter", "Beast Master"], "half"],
  ["Rogue", 3, ["Thief", "Assassin", "Arcane Trickster"]],
  ["Sorcerer", 1, ["Draconic Bloodline", "Wild Magic"], "full"],
  ["Warlock", 1, ["The Archfey", "The Fiend", "The Great Old One"]],
  ["Wizard", 2, ["School of Abjuration", "School of Conjuration", "School of Divination", "School of Enchantment", "School of Evocation", "School of Illusion", "School of Necromancy", "School of Transmutation"], "full"],
].map(([name, subclassLevel, subclasses, caster]) => ({ name, subclassLevel, subclasses, caster: caster || null }));

// Indexed by character level. Each entry is the maximum number of slots
// for spell levels 1 through 9.
const FULL_CASTER_SLOTS = [
  [], [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1],
  [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const HALF_CASTER_SLOTS = [
  [], [], [2], [3], [3], [4, 2], [4, 2], [4, 3], [4, 3], [4, 3, 2],
  [4, 3, 2], [4, 3, 3], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 1],
  [4, 3, 3, 2], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2], [4, 3, 3, 3, 2],
];

// Sourced from data/classes-2024.json (via scripts/compile-2024-content.mjs)
// for subclass names, and features-2024.json for subclassLevel — every
// 2024 class grants its subclass at level 3 (unlike 2014, where it
// varied 1-3 per class). Subclass lists here are only whatever's in the
// free SRD (one per class); add the rest by hand as splatbook content,
// same as the 2014 registry above. caster ("full"/"half"/null) isn't in
// the SRD class JSON itself, so it's set from known 5e/5.24 rules the
// same way the 2014 list above is.
const PHB_2024_CLASSES = [
  ["Barbarian", ["Path of the Berserker"]],
  ["Bard", ["College of Lore"], "full"],
  ["Cleric", ["Life Domain"], "full"],
  ["Druid", ["Circle of the Land"], "full"],
  ["Fighter", ["Champion"]],
  ["Monk", ["Warrior of the Open Hand"]],
  ["Paladin", ["Oath of Devotion"], "half"],
  ["Ranger", ["Hunter"], "half"],
  ["Rogue", ["Thief"]],
  ["Sorcerer", ["Draconic Sorcery"], "full"],
  ["Warlock", ["Fiend Patron"], "full"],
  ["Wizard", ["Evoker"], "full"],
].map(([name, subclasses, caster]) => ({ name, subclassLevel: 3, subclasses, caster: caster || null }));

export const RULESETS = [
  {
    id: "dnd5e-2014-phb",
    name: "D&D 5e (2014 PHB)",
    classes: PHB_2014_CLASSES,
  },
  {
    id: "dnd5e-2024-phb",
    name: "D&D 5e (2024 PHB)",
    classes: PHB_2024_CLASSES,
  },
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

// Pact Magic (Warlock's slot mechanic) doesn't fit the shared
// per-level-array shape above — a Warlock has a single slot LEVEL
// plus a slot COUNT, all recovered on a SHORT rest rather than a long
// one (that recharge-timing difference isn't modeled anywhere in this
// app for any resource, so it's not called out further below). Each
// entry is [slotLevel, slotCount] for that character level, 2014 PHB.
const WARLOCK_PACT_SLOTS = [
  null, [1, 1], [1, 2], [2, 2], [2, 2], [3, 2], [3, 2], [4, 2], [4, 2], [5, 2], [5, 2],
  [5, 3], [5, 3], [5, 3], [5, 3], [5, 3], [5, 3], [5, 4], [5, 4], [5, 4], [5, 4],
];

function slotsFor(entry, level) {
  // Checked by class NAME, not entry.caster, same reasoning as
  // getSpellcastingInfo below — Warlock's caster tag varies by
  // ruleset (see the comment on SPELLCASTING) and neither value would
  // give the right table here anyway.
  if (entry?.name === "Warlock") {
    const pact = WARLOCK_PACT_SLOTS[level];
    // Always returns one entry per slot level 1-5 (never higher — Pact
    // Magic caps at 5th-level slots), INCLUDING zeros for every level
    // that isn't the current pact slot level. That's deliberate: a
    // Warlock's pact level MOVES as they level up (2nd-level slots
    // replace 1st, not stack alongside them), unlike a full/half
    // caster's slots which only ever accumulate — so the zero entries
    // are what let the sheet's slot fields actually clear back down
    // once a level is no longer the active one, instead of leaving a
    // stale nonzero count sitting in last level's slot field.
    return Array.from({ length: 5 }, (_, index) => {
      const slotLevel = index + 1;
      return {
        fieldId: `slots${slotLevel}`,
        label: `${slotLevel}${slotLevel === 1 ? "st" : slotLevel === 2 ? "nd" : slotLevel === 3 ? "rd" : "th"}`,
        options: pact && pact[0] === slotLevel ? pact[1] : 0,
      };
    });
  }
  const table = entry.caster === "full" ? FULL_CASTER_SLOTS : entry.caster === "half" ? HALF_CASTER_SLOTS : null;
  return (table?.[level] || []).map((options, index) => ({
    fieldId: `slots${index + 1}`,
    label: `${index + 1}${index === 0 ? "st" : index === 1 ? "nd" : index === 2 ? "rd" : "th"}`,
    options,
  }));
}

// Cantrips known follow the same "+1 at level 4, +1 at level 10" shape
// for every core class that gets them, just with a different starting
// count — see cantripsKnownForClass below. Paladin/Ranger get none in
// core 5e (a few subclasses/features grant specific ones instead,
// which isn't modeled here).
function cantripsKnownForClass(base) {
  return (level) => base + (level >= 4 ? 1 : 0) + (level >= 10 ? 1 : 0);
}

// Keyed by class NAME rather than folded into PHB_2014_CLASSES/
// PHB_2024_CLASSES above on purpose — those track slot-table caster
// type ("full"/"half"/null), which Warlock's unique Pact Magic slots
// don't fit (see the 2014 list's Warlock entry, deliberately left
// caster:null), but Warlock is still very much a spellcaster for
// known-spells/cantrips purposes. Checking THIS table's presence,
// rather than classEntry.caster, is what actually gates whether the
// character-sheet Spell picker offers a class any spells at all.
//
// "Known"-style tables (Bard/Ranger/Sorcerer/Warlock) are the
// irregular values printed in the 2014 PHB, reconstructed here from
// memory rather than copied from the book — worth spot-checking
// against your copy, since a table this size is an easy place for a
// transcription slip to hide. "Prepared"-style classes use the
// standard ability-mod + level formula instead (Paladin uses HALF
// paladin level, being a half-caster).
const SPELLCASTING = {
  Bard: {
    ability: "cha", style: "known", cantrips: cantripsKnownForClass(2),
    known: (level) => [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22][level - 1] ?? 22,
  },
  Cleric: {
    ability: "wis", style: "prepared", cantrips: cantripsKnownForClass(3),
    prepared: (level, mod) => Math.max(1, level + mod),
  },
  Druid: {
    ability: "wis", style: "prepared", cantrips: cantripsKnownForClass(2),
    prepared: (level, mod) => Math.max(1, level + mod),
  },
  Paladin: {
    ability: "cha", style: "prepared", cantrips: null,
    prepared: (level, mod) => Math.max(1, Math.floor(level / 2) + mod),
  },
  Ranger: {
    ability: "wis", style: "known", cantrips: null,
    known: (level) => [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11][level - 1] ?? 11,
  },
  Sorcerer: {
    ability: "cha", style: "known", cantrips: cantripsKnownForClass(4),
    known: (level) => [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15][level - 1] ?? 15,
  },
  Warlock: {
    ability: "cha", style: "known", cantrips: cantripsKnownForClass(2),
    known: (level) => [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15][level - 1] ?? 15,
  },
  Wizard: {
    ability: "int", style: "prepared", cantrips: cantripsKnownForClass(3),
    prepared: (level, mod) => Math.max(1, level + mod),
  },
};

/** Cantrips/spells-known-or-prepared data for a class, independent of
 *  ruleset (see the SPELLCASTING comment above for why). Returns null
 *  for non-caster classes — that's the actual "does this class cast
 *  spells at all" signal to use, not classEntry.caster. */
export function getSpellcastingInfo(className) {
  return SPELLCASTING[className] || null;
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

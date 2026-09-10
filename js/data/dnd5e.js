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

function slotsFor(entry, level) {
  const table = entry.caster === "full" ? FULL_CASTER_SLOTS : entry.caster === "half" ? HALF_CASTER_SLOTS : null;
  return (table?.[level] || []).map((options, index) => ({
    fieldId: `slots${index + 1}`,
    label: `${index + 1}${index === 0 ? "st" : index === 1 ? "nd" : index === 2 ? "rd" : "th"}`,
    options,
  }));
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

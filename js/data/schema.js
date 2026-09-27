// schema.js
//
// Plain D&D 5e reference data — ABILITIES, SKILLS (with their ability
// mapping), and createBlankCharacter's starter field values. Used by
// blockModel.js (createStarterLayout pulls ABILITIES/SKILLS from here
// rather than hand-listing them). The rendering half this used to feed
// (formBuilder.js, characterSheet.js) was a fixed-schema sheet system
// that's since been replaced by the block/field engine in
// blockModel.js/customSheet.js — removed from the repo, along with the
// per-field-type constants (ATTACK_FIELDS, PERSONALITY_FIELDS, etc.)
// and factory functions (createAttack, etc.) that only that removed
// system consumed, and mockStore.js, a mock characterStore.js nothing
// actually imported. This file only supplies plain data now, nothing
// generates markup from it directly.

export const ABILITIES = [
  { id: "str", label: "Strength" },
  { id: "dex", label: "Dexterity" },
  { id: "con", label: "Constitution" },
  { id: "int", label: "Intelligence" },
  { id: "wis", label: "Wisdom" },
  { id: "cha", label: "Charisma" },
];

export const SKILLS = [
  { id: "acrobatics",     label: "Acrobatics",      ability: "dex", description: "Balance, tumbling, and acrobatic stunts." },
  { id: "animalHandling", label: "Animal Handling",  ability: "wis", description: "Calm, train, and read animals." },
  { id: "arcana",         label: "Arcana",           ability: "int", description: "Recall lore about magic, spells, and the planes." },
  { id: "athletics",      label: "Athletics",        ability: "str", description: "Climbing, jumping, swimming, feats of strength." },
  { id: "deception",      label: "Deception",        ability: "cha", description: "Lie convincingly and mislead others." },
  { id: "history",        label: "History",          ability: "int", description: "Recall lore about the past and legends." },
  { id: "insight",        label: "Insight",          ability: "wis", description: "Read motives and detect lies." },
  { id: "intimidation",   label: "Intimidation",     ability: "cha", description: "Influence through threats and menace." },
  { id: "investigation",  label: "Investigation",    ability: "int", description: "Search for clues and deduce what happened." },
  { id: "medicine",       label: "Medicine",         ability: "wis", description: "Stabilize the dying, diagnose ailments." },
  { id: "nature",         label: "Nature",           ability: "int", description: "Recall lore about terrain, plants, and beasts." },
  { id: "perception",     label: "Perception",       ability: "wis", description: "Notice hidden creatures and details." },
  { id: "performance",    label: "Performance",      ability: "cha", description: "Entertain with music, acting, storytelling." },
  { id: "persuasion",     label: "Persuasion",       ability: "cha", description: "Influence through tact and diplomacy." },
  { id: "religion",       label: "Religion",         ability: "int", description: "Recall lore about gods, rites, holy symbols." },
  { id: "sleightOfHand",  label: "Sleight of Hand",  ability: "dex", description: "Pick pockets, conceal objects, legerdemain." },
  { id: "stealth",        label: "Stealth",          ability: "dex", description: "Hide and move unseen and unheard." },
  { id: "survival",       label: "Survival",         ability: "wis", description: "Track, forage, and navigate the wilds." },
];

export const SPELL_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export const LANGUAGES = [
  "Common", "Dwarvish", "Elvish", "Giant", "Gnomish", "Goblin", "Halfling", "Orc",
  "Abyssal", "Celestial", "Deep Speech", "Draconic", "Infernal", "Primordial", "Sylvan", "Undercommon",
];

// Factory for a brand-new character document. This is the shape that
// gets written to Firestore, so keep it flat where reasonable —
// nested objects only where the data is genuinely grouped (abilities,
// skillProficiencies, spellSlots).
export function createBlankCharacter(ownerId) {
  return {
    ownerId,
    name: "New Character",
    class: "",
    level: 1,
    race: "",
    background: "",
    alignment: "",

    abilities: Object.fromEntries(ABILITIES.map(a => [a.id, 10])),
    skillProficiencies: Object.fromEntries(SKILLS.map(s => [s.id, false])),
    savingThrowProficiencies: Object.fromEntries(ABILITIES.map(a => [a.id, false])),

    armorClass: 10,
    speed: 30,
    hpMax: 0,
    hpCurrent: 0,
    hpTemp: 0,
    hitDice: "",

    deathSaves: { successes: 0, failures: 0 },

    cp: 0, sp: 0, ep: 0, gp: 0, pp: 0,

    proficienciesArmor: "",
    proficienciesWeapons: "",
    proficienciesTools: "",
    languages: "",

    spellcastingAbility: "int",
    spellSlots: Object.fromEntries(SPELL_LEVELS.map(l => [l, { max: 0, current: 0 }])),

    attacks: [],     // [{ id, name, bonus, damage, type, notes }]
    inventory: [],   // [{ id, name, quantity, weight, equipped, notes }]
    spells: [],      // [{ id, name, level, prepared, notes }]
    features: [],    // [{ id, name, source, description }]

    personalityTraits: "",
    ideals: "",
    bonds: "",
    flaws: "",

    notes: "",
    // Canonical rules state for guided creation/leveling. The editable
    // layout is presentation, while this keeps rule choices stable.
    rules: {
      rulesetId: null,
      rulesetIds: [],
      species: "",
      background: "",
      className: "",
      level: 1,
      subclass: "",
      abilityScores: Object.fromEntries(ABILITIES.map(a => [a.id, 10])),
      choices: {},
      resourceUses: {},
      appliedLevels: {},
    },
    createdAt: null,  // set server-side via serverTimestamp()
    updatedAt: null,
  };
}

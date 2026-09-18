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
  { id: "acrobatics",     label: "Acrobatics",      ability: "dex" },
  { id: "animalHandling", label: "Animal Handling",  ability: "wis" },
  { id: "arcana",         label: "Arcana",           ability: "int" },
  { id: "athletics",      label: "Athletics",        ability: "str" },
  { id: "deception",      label: "Deception",        ability: "cha" },
  { id: "history",        label: "History",          ability: "int" },
  { id: "insight",        label: "Insight",          ability: "wis" },
  { id: "intimidation",   label: "Intimidation",     ability: "cha" },
  { id: "investigation",  label: "Investigation",    ability: "int" },
  { id: "medicine",       label: "Medicine",         ability: "wis" },
  { id: "nature",         label: "Nature",           ability: "int" },
  { id: "perception",     label: "Perception",       ability: "wis" },
  { id: "performance",    label: "Performance",      ability: "cha" },
  { id: "persuasion",     label: "Persuasion",       ability: "cha" },
  { id: "religion",       label: "Religion",         ability: "int" },
  { id: "sleightOfHand",  label: "Sleight of Hand",  ability: "dex" },
  { id: "stealth",        label: "Stealth",          ability: "dex" },
  { id: "survival",       label: "Survival",         ability: "wis" },
];

export const SPELL_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

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

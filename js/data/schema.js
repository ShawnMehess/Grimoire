// schema.js
//
// This is the file you edit when you want to add a new field to a
// character sheet. Nothing else needs to change: formBuilder.js reads
// this and generates the corresponding markup + wires it to the data
// object automatically.
//
// field types: "score" | "number" | "text" | "textarea" | "select" | "toggle"

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

// Top-of-sheet identity fields. type: "select" fields expect an
// `options: []` array (kept in /data/*.json rather than hardcoded here
// since class/race/background lists are shared reference data).
export const IDENTITY_FIELDS = [
  { id: "name",       label: "Character Name", type: "text" },
  { id: "class",      label: "Class",          type: "select", optionsSource: "classes" },
  { id: "level",      label: "Level",          type: "number", min: 1, max: 20, default: 1 },
  { id: "race",       label: "Race",           type: "select", optionsSource: "races" },
  { id: "background", label: "Background",     type: "select", optionsSource: "backgrounds" },
  { id: "alignment",  label: "Alignment",      type: "text" },
];

export const COMBAT_FIELDS = [
  { id: "armorClass",   label: "Armor Class",    type: "number", default: 10 },
  { id: "initiative",   label: "Initiative",     type: "number", derived: true },
  { id: "speed",        label: "Speed",          type: "number", default: 30 },
  { id: "hpMax",        label: "Max HP",         type: "number", default: 0 },
  { id: "hpCurrent",    label: "Current HP",     type: "number", default: 0 },
  { id: "hpTemp",       label: "Temp HP",        type: "number", default: 0 },
  { id: "hitDice",      label: "Hit Dice",       type: "text" },
];

export const CURRENCY_FIELDS = [
  { id: "cp", label: "CP", type: "number", default: 0 },
  { id: "sp", label: "SP", type: "number", default: 0 },
  { id: "ep", label: "EP", type: "number", default: 0 },
  { id: "gp", label: "GP", type: "number", default: 0 },
  { id: "pp", label: "PP", type: "number", default: 0 },
];

export const PROFICIENCY_FIELDS = [
  { id: "proficienciesArmor",   label: "Armor",   type: "textarea" },
  { id: "proficienciesWeapons", label: "Weapons", type: "textarea" },
  { id: "proficienciesTools",   label: "Tools",   type: "textarea" },
  { id: "languages",            label: "Languages", type: "textarea" },
];

export const SPELLCASTING_FIELDS = [
  {
    id: "spellcastingAbility",
    label: "Spellcasting Ability",
    type: "select",
    options: ABILITIES.map(a => ({ value: a.id, label: a.label })),
  },
];

export const PERSONALITY_FIELDS = [
  { id: "personalityTraits", label: "Personality Traits", type: "textarea" },
  { id: "ideals",            label: "Ideals",             type: "textarea" },
  { id: "bonds",             label: "Bonds",               type: "textarea" },
  { id: "flaws",             label: "Flaws",               type: "textarea" },
];

// --- Field defs for repeatable list sections (attacks, inventory, etc) ----
// Each of these is passed to buildEditableList() alongside the matching
// array on the character (e.g. character.attacks) and a factory below.

export const ATTACK_FIELDS = [
  { id: "name",   label: "Name",       type: "text" },
  { id: "bonus",  label: "Atk Bonus",  type: "text" },
  { id: "damage", label: "Damage",     type: "text" },
  { id: "type",   label: "Type",       type: "text" },
  { id: "notes",  label: "Notes",      type: "text" },
];

export const INVENTORY_FIELDS = [
  { id: "name",     label: "Item",     type: "text" },
  { id: "quantity", label: "Qty",      type: "number", default: 1 },
  { id: "weight",   label: "Weight",   type: "number", default: 0 },
  { id: "equipped", label: "Equipped", type: "toggle" },
  { id: "notes",    label: "Notes",    type: "text" },
];

export const SPELL_FIELDS = [
  { id: "name",     label: "Name",     type: "text" },
  { id: "level",    label: "Level",    type: "number", min: 0, max: 9, default: 0 },
  { id: "prepared", label: "Prepared", type: "toggle" },
  { id: "notes",    label: "Notes",    type: "text" },
];

export const FEATURE_FIELDS = [
  { id: "name",        label: "Name",        type: "text" },
  { id: "source",      label: "Source",      type: "text" },
  { id: "description", label: "Description", type: "textarea" },
];

function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

export function createAttack() {
  return { id: newId(), name: "", bonus: "", damage: "", type: "", notes: "" };
}
export function createInventoryItem() {
  return { id: newId(), name: "", quantity: 1, weight: 0, equipped: false, notes: "" };
}
export function createSpell() {
  return { id: newId(), name: "", level: 0, prepared: false, notes: "" };
}
export function createFeature() {
  return { id: newId(), name: "", source: "", description: "" };
}

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
    createdAt: null,  // set server-side via serverTimestamp()
    updatedAt: null,
  };
}

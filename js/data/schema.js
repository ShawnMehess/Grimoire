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

// Factory for a brand-new character document. This is the shape that
// gets written to Firestore, so keep it flat where reasonable —
// nested objects only where the data is genuinely grouped (abilities,
// skillProficiencies).
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

    inventory: [],   // [{ id, name, quantity, weight, notes }]
    spells: [],      // [{ id, name, level, prepared, notes }]
    features: [],    // [{ id, name, source, description }]

    notes: "",
    createdAt: null,  // set server-side via serverTimestamp()
    updatedAt: null,
  };
}

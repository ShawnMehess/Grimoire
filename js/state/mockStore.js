// mockStore.js
//
// Same function shapes as state/characterStore.js, but backed by a
// plain in-memory object instead of Firestore. Lets you preview the
// UI instantly — no Firebase project, no auth, no network — before
// you've wired up real credentials. Swap the import in a page back to
// characterStore.js when you're ready to go live; nothing else needs
// to change since the function signatures match.

import { createBlankCharacter, createAttack, createInventoryItem, createSpell, createFeature } from "../data/schema.js";

const demoCharacter = {
  id: "demo-1",
  ...createBlankCharacter("demo-user"),
  name: "Elowen Brightspear",
  class: "wizard",
  level: 3,
  race: "high-elf",
  background: "sage",
  alignment: "Neutral Good",
  abilities: { str: 8, dex: 14, con: 12, int: 17, wis: 12, cha: 10 },
  skillProficiencies: { arcana: true, history: true, investigation: true },
  savingThrowProficiencies: { int: true, wis: true },
  armorClass: 12,
  speed: 30,
  hpMax: 20,
  hpCurrent: 20,
  hpTemp: 0,
  hitDice: "3d6",
  spellcastingAbility: "int",
  spellSlots: { 1: { max: 4, current: 3 }, 2: { max: 2, current: 2 }, 3: { max: 0, current: 0 }, 4: { max: 0, current: 0 }, 5: { max: 0, current: 0 }, 6: { max: 0, current: 0 }, 7: { max: 0, current: 0 }, 8: { max: 0, current: 0 }, 9: { max: 0, current: 0 } },
  cp: 12, sp: 4, ep: 0, gp: 35, pp: 0,
  proficienciesArmor: "None",
  proficienciesWeapons: "Daggers, darts, slings, quarterstaffs, light crossbows",
  proficienciesTools: "None",
  languages: "Common, Elvish, Draconic",
  attacks: [
    { ...createAttack(), name: "Dagger", bonus: "+4", damage: "1d4+2", type: "piercing", notes: "thrown, 20/60ft" },
    { ...createAttack(), name: "Fire Bolt", bonus: "+5", damage: "2d10", type: "fire", notes: "cantrip, 120ft" },
  ],
  inventory: [
    { ...createInventoryItem(), name: "Spellbook", quantity: 1, weight: 3, equipped: true, notes: "" },
    { ...createInventoryItem(), name: "Component pouch", quantity: 1, weight: 2, equipped: true, notes: "" },
  ],
  spells: [
    { ...createSpell(), name: "Fire Bolt", level: 0, prepared: true, notes: "cantrip" },
    { ...createSpell(), name: "Magic Missile", level: 1, prepared: true, notes: "" },
    { ...createSpell(), name: "Misty Step", level: 2, prepared: false, notes: "" },
  ],
  features: [
    { ...createFeature(), name: "Arcane Recovery", source: "Wizard 1", description: "Once per day, recover spell slots on a short rest." },
  ],
  personalityTraits: "Curious to a fault; can't resist an unread book.",
  notes: "This is placeholder data so you can see the sheet render without a live Firebase project connected.",
};

export async function loadCharacter(characterId) {
  return demoCharacter;
}

export async function saveCharacterField(characterId, fieldId, value) {
  console.log(`[mockStore] would save ${fieldId} =`, value);
}

export async function saveCharacterFields(characterId, patch) {
  console.log("[mockStore] would save", patch);
}

// mockStore.js
//
// Same function shapes as state/characterStore.js, but backed by a
// plain in-memory object instead of Firestore. Lets you preview the
// UI instantly — no Firebase project, no auth, no network — before
// you've wired up real credentials. Swap the import in a page back to
// characterStore.js when you're ready to go live; nothing else needs
// to change since the function signatures match.

import { createBlankCharacter } from "../data/schema.js";

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
  armorClass: 12,
  speed: 30,
  hpMax: 20,
  hpCurrent: 20,
  hpTemp: 0,
  hitDice: "3d6",
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

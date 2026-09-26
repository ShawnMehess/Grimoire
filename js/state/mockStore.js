// mockStore.js
//
// Same function shapes as state/characterStore.js, but backed by a
// plain in-memory object instead of Firestore. Lets you preview the
// UI instantly -- no Firebase project, no auth, no network -- before
// you've wired up real credentials, or want to check a sheet-engine
// change in isolation. Swap the import in a page back to
// characterStore.js when you're ready to go live; nothing else needs
// to change since the function signatures match.
//
// Images are stored as compressed Base64 Data URLs directly in the
// character document (no Firebase Storage). Picture fields use
// `imageData`; block background images use `style.bgImage`.

import { createBlankCharacter } from "../data/schema.js";
import { createStarterLayout } from "../data/blockModel.js";

function findFieldByLabel(layout, label) {
  for (const node of layout) {
    if (node.kind === "field" && node.label === label) return node;
    if (node.children) {
      const match = findFieldByLabel(node.children, label);
      if (match) return match;
    }
  }
  return null;
}

function buildDemoCharacter() {
  const layout = createStarterLayout();

  const classField = findFieldByLabel(layout, "Class");
  const barbarian = classField?.choices.find((c) => c.text === "Barbarian");
  if (barbarian) {
    barbarian.bundle = {
      statModifiers: [],
      dropdownAccess: [],
      featureGrants: [
        { id: "demo-rage", name: "Rage", minLevel: 1, description: "In battle, you fight with primal ferocity. On your turn, you can enter a rage as a bonus action, gaining bonus melee damage, resistance to bludgeoning/piercing/slashing damage, and advantage on Strength checks and saves, for 1 minute." },
        { id: "demo-unarmored", name: "Unarmored Defense", minLevel: 1, description: "While not wearing armor, your AC equals 10 + your Dexterity modifier + your Constitution modifier. You can use a shield and still gain this benefit." },
        { id: "demo-reckless", name: "Reckless Attack", minLevel: 2, description: "When you make your first attack on your turn, you can decide to attack recklessly, giving you advantage on melee weapon attack rolls using Strength this turn, but attack rolls against you have advantage until your next turn." },
        { id: "demo-danger-sense", name: "Danger Sense", minLevel: 2, description: "You have advantage on Dexterity saving throws against effects you can see, such as traps and spells, as long as you aren't blinded, deafened, or incapacitated." },
      ],
    };
    classField.selected = barbarian.id;
  }

  const levelField = findFieldByLabel(layout, "Level");
  if (levelField) levelField.value = "2";

  return {
    id: "demo-1",
    ...createBlankCharacter("demo-user"),
    name: "Grosk the Unbroken",
    layout,
    levelFieldId: levelField?.id ?? null,
  };
}

export async function loadCharacter(characterId) {
  return buildDemoCharacter();
}

export async function saveCharacterField(characterId, fieldId, value) {
  console.log(`[demo] would save ${fieldId}:`, value);
}

export async function saveCharacterFields(characterId, patch) {
  console.log("[demo] would save fields:", patch);
}

export async function listBundleLibraries() {
  return [];
}

export async function listCatalogs() {
  return [];
}

export async function loadCatalog(scope, id) {
  return null;
}

export function currentUserId() {
  return "demo-user";
}

// --- Character image upload (compressed Base64 directly in document) --------

/** Demo pass-through: keeps the compressed Base64 data URL (no path). */
export async function uploadCharacterImage(characterId, dataUrl) {
  void characterId;
  return dataUrl;
}

/** No stored object in demo — nothing to resolve. */
export async function characterImageUrl(path) {
  void path;
  return null;
}

/** No stored object in demo — nothing to delete. */
export async function deleteCharacterImage(path) {
  void path;
  return false;
}

/** No stored objects in demo — nothing to wipe. */
export async function deleteCharacterImagesFor(characterId) {
  void characterId;
  return false;
}

/** Demo images are inline Base64, already cloned with the document. */
export async function copyCharacterImages(oldId, newId) {
  void oldId;
  void newId;
  return {};
}
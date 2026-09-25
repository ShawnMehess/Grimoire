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
// Every write here just logs to the console (per demo.html's own
// banner) rather than persisting -- this is a preview, not a second
// backend to keep in sync.

import { createBlankCharacter } from "../data/schema.js";
import { createStarterLayout } from "../data/blockModel.js";

/** Depth-first walk of a layout's blocks looking for a field by label --
 *  layout is a tree (blocks contain children, which can themselves be
 *  blocks), not a flat list, so this exists purely to let the demo
 *  character below reach into its own freshly-built starter layout and
 *  pre-select/pre-bundle a couple of fields. customSheet.js has its own
 *  flattenGlobalFields() for this same shape, but it's private to that
 *  module's closure -- not worth exporting just for a one-time demo
 *  seed. */
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

/** Builds the demo character fresh each time loadCharacter runs, rather
 *  than a module-level constant -- a plain object would accumulate
 *  every edit made in the browser session (bundles, checked boxes,
 *  dragged fields...) across page reloads within the same tab, which
 *  is a confusing thing for a "preview" to do silently. */
function buildDemoCharacter() {
  const layout = createStarterLayout();

  // Pre-wire Class -> Barbarian with a bundle attached, and set Level
  // to 2, purely so opening the demo immediately shows the new
  // "Feature List" field doing something (Rage/Unarmored Defense from
  // level 1, Reckless Attack/Danger Sense unlocked at level 2) without
  // first requiring the manual "select Class, open Manage Bundles,
  // apply Barbarian" steps a real new character would need. See
  // default-bundles/classes.json for the non-demo version of this same
  // data, applied via applyBundleLibraryToChoice in customSheet.js.
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

export async function uploadCharacterImage(characterId, dataUrl) {
  void characterId;
  return { path: null, url: dataUrl };
}

export async function deleteCharacterImage(path) {
  void path;
  return false;
}

export async function deleteCharacterImagesFor(characterId) {
  void characterId;
  return false;
}

export async function characterImageUrl(path) {
  void path;
  return null;
}

export async function copyCharacterImages(oldId, newId) {
  void oldId;
  void newId;
  return {};
}

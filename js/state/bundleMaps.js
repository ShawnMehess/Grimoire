// bundleMaps.js — default-content bundle strip/hydrate, backend-agnostic.
//
// A Class/Race/Background/Subclass dropdown's `choices` carry their
// full bundle directly on each choice so a brand-new character works
// with no import step (see blockModel.js/defaultContent.js). But that
// means EVERY character document embeds full copies of those bundles —
// about 330KB+ of duplication per character against Firestore's 1MB
// document cap (and the same waste in localStorage).
//
// Fix: strip a choice's bundle down to `null` right before writing,
// whenever it's an exact match for the canonical default (a player's
// own customized bundle won't match and survives). Re-attach right
// after reading, so rendering code (which reads `choice.bundle`
// directly) never knows this happened.
//
// Shared by characterStore.js (Firestore) and localStore.js
// (localStorage) so both backends stay byte-identical. No Firebase
// imports here — pure data + the compiled content modules only.

import { DEFAULT_CONTENT } from "../data/defaultContent.js";
import { FIXED_CLASS_ENTRIES, FIXED_RACE_ENTRIES, SUBCLASS_BUNDLE_MAP, normSubclassKey } from "../data/contentFixups.js";

function normBundleName(s) { return (s || "").trim().toLowerCase(); }
const normSubclassName = normSubclassKey;

export const DEFAULT_BUNDLE_MAPS = {
  class: new Map(FIXED_CLASS_ENTRIES.map((e) => [normBundleName(e.name), e.bundle])),
  race: new Map(FIXED_RACE_ENTRIES.map((e) => [normBundleName(e.name), e.bundle])),
  background: new Map(DEFAULT_CONTENT.bgEntries.map((e) => [normBundleName(e.name), e.bundle])),
  // Subclass choices carry mechanics inline (blockModel attaches from
  // the patched supplement). Keyed by normalized choice text, which
  // matches supplement keys exactly (see scripts/verify-content.mjs).
  subclass: new Map([...SUBCLASS_BUNDLE_MAP.entries()].map(([key, bundle]) => [key, bundle])),
};

function canonicalFor(map, choiceText) {
  // Class/Race/Background keys are plain lowercased names; subclass
  // keys are alphanumeric-normalized ("Oath of Devotion" ->
  // "oathofdevotion"). Try both so one walker serves all four maps.
  return map.get(normBundleName(choiceText)) ?? map.get(normSubclassName(choiceText));
}

function walkBundleChoices(layout, visit) {
  // Recursive (blocks can nest inside blocks): a dropdown at any depth
  // must strip on save and hydrate on load, or documents keep full
  // bundle copies toward the 1MB cap — and worse, hydrate would leave
  // nested dropdowns' mechanics silently missing.
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (!node) continue;
      if (node.kind === "field") {
        const map = DEFAULT_BUNDLE_MAPS[normBundleName(node.label)];
        if (map && Array.isArray(node.choices)) node.choices.forEach((choice) => visit(choice, map));
      }
      if (node.children) walk(node.children);
    }
  };
  walk(layout);
}

function stripDefaultBundlesFromLayout(layout) {
  walkBundleChoices(layout, (choice, map) => {
    const canonical = canonicalFor(map, choice.text);
    if (canonical && choice.bundle && JSON.stringify(choice.bundle) === JSON.stringify(canonical)) {
      choice.bundle = null;
    }
  });
  return layout;
}

function hydrateDefaultBundlesInLayout(layout) {
  walkBundleChoices(layout, (choice, map) => {
    if (choice.bundle) return; // custom bundle, or already hydrated
    const canonical = canonicalFor(map, choice.text);
    if (canonical) choice.bundle = canonical;
  });
  return layout;
}

/** Strips default bundles from a clone of whichever of `layout` /
 *  `sheetTabs` are present on a save patch, leaving anything else in
 *  the patch untouched. Safe to call on any patch object — a no-op
 *  for patches that don't touch either field. */
export function stripBundlesFromPatch(patch) {
  if (!patch || (!("layout" in patch) && !("sheetTabs" in patch))) return patch;
  const out = { ...patch };
  if (out.layout) out.layout = stripDefaultBundlesFromLayout(JSON.parse(JSON.stringify(out.layout)));
  if (Array.isArray(out.sheetTabs)) {
    out.sheetTabs = JSON.parse(JSON.stringify(out.sheetTabs));
    out.sheetTabs.forEach((tab) => { if (tab && tab.layout) stripDefaultBundlesFromLayout(tab.layout); });
  }
  return out;
}

/** Re-attaches default bundles onto a character object fresh out of
 *  storage (mutates and returns it — nothing else holds a reference
 *  to it yet at that point, so this is safe). */
export function hydrateCharacter(data) {
  if (!data) return data;
  if (data.layout) hydrateDefaultBundlesInLayout(data.layout);
  if (Array.isArray(data.sheetTabs)) {
    data.sheetTabs.forEach((tab) => { if (tab && tab.layout) hydrateDefaultBundlesInLayout(tab.layout); });
  }
  return data;
}

/** Two bundles are "the same" for dedupe purposes if they share a scope
 *  plus a case/whitespace-insensitive name and category. Used by both
 *  the upload-time duplicate check and dedupeBundleLibraries. */
export function bundleDedupeKey(entry) {
  return [
    entry.scope || "",
    (entry.rulesetId || "").trim().toLowerCase(),
    (entry.category || "").trim().toLowerCase(),
    (entry.name || "").trim().toLowerCase(),
  ].join("::");
}

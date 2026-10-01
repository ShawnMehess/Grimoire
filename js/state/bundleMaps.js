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
import { FIXED_BG_ENTRIES, FIXED_CLASS_ENTRIES, FIXED_RACE_ENTRIES, SUBCLASS_BUNDLE_MAP, normSubclassKey } from "../data/contentFixups.js";
import { spellcastingModelFor } from "../data/spellcastingModels.js";
import { getSpellcastingInfo } from "../data/dnd5e.js";

function normBundleName(s) { return (s || "").trim().toLowerCase(); }
const normSubclassName = normSubclassKey;

export const DEFAULT_BUNDLE_MAPS = {
  class: new Map(FIXED_CLASS_ENTRIES.map((e) => [normBundleName(e.name), e.bundle])),
  race: new Map(FIXED_RACE_ENTRIES.map((e) => [normBundleName(e.name), e.bundle])),
  background: new Map(FIXED_BG_ENTRIES.map((e) => [normBundleName(e.name), e.bundle])),
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
  // Passed the class model AND `infoFor`, because spellcastingModelFor
  // derives most classes from getSpellcastingInfo and returns null without
  // it. Without `infoFor` every derived class looks unknown, and every save
  // takes the "trust the data" path - the Cleric's own spells would survive
  // a class change but so would anything else.
  migratePreparedSpellLists(data, {
    modelFor: (className, rulesetId) =>
      spellcastingModelFor(className, rulesetId, { infoFor: getSpellcastingInfo }),
  });
  return data;
}

/** Bring the Spells Known field's prepared list into a state the sheet can
 *  trust, once, at load.
 *
 *  Existing characters have no `preparedItems` at all, and that is the
 *  intended migration rather than a gap: an absent list reads as nothing
 *  prepared, which is exactly right for every character that predates the
 *  field. A known-only caster is unaffected in BEHAVIOUR - the sheet renders
 *  no counter and no toggles for one at all - which is what
 *  spellcastingModelFor decides, not this function.
 *
 *  Two things are repaired rather than assumed:
 *
 *  - The list becomes an array if it is missing or malformed, so every
 *    reader downstream can treat it as one. `undefined` and `null` are the
 *    shapes a hand-edited save produces and both used to reach the render.
 *  - For a class with no prepared list at all (Sorcerer, Bard), the list is
 *    emptied. There is nothing to prepare from and nothing to spend the
 *    count on, and the sheet shows no counter and no toggles for such a
 *    class - so the list is invisible AND unclearable by the player.
 *
 *  - A prepared name that is no longer in `items` is dropped, but only for
 *    the models where that means the character no longer holds it. For a
 *    full-list preparer (preparedFrom "classList") the prepared spell is
 *    SUPPOSED to be absent from `items` - that is the shape section 2
 *    settled on - so filtering on `items` there would quietly unprepared
 *    every Cleric, Druid and Paladin the first time their save loaded.
 *    Only spellbook-derived preparation ("known": a Wizard, or a domain
 *    spell added by a subclass) can go stale, and only that is filtered.
 *
 *  Runs on every load rather than once behind a version flag: it is a few
 *  string comparisons over a list already in memory, and being
 *  unconditionally true means a character fixed by hand stays fixed, and a
 *  character re-imported from an old export is fixed again.
 *
 *  Mutates, like hydrateCharacter. Returns the character for chaining. */
export function migratePreparedSpellLists(character, { modelFor } = {}) {
  // Resolved once per character, not per field: the class is on the
  // character, and a character with two spell lists has the same answer
  // twice. No model means no filtering at all - see below.
  const className = character?.rules?.className || "";
  // Same order the sheet uses: character.rules.rulesetId is the primary
  // SYSTEM, character.rulesetId is the older top-level field. Reading only
  // the latter would resolve the model against "" and silently take the
  // "unknown class, trust everything" path for every current save.
  const rulesetId = character?.rules?.rulesetId || character?.rulesetId || "";
  const model = typeof modelFor === "function" ? modelFor(className, rulesetId) : null;
  // A class with NO prepared list cannot have prepared spells, whatever else
  // is true. A Sorcerer, Bard or Wizard has nothing to prepare from and
  // nothing to spend the count on, so a name here is meaningless in the
  // strictest sense - and the sheet renders no counter and no toggles for
  // such a class, so the list is invisible and, being invisible, unclearable
  // by the player too. Only the sheet's own class-change cleanup removes it
  // today, and that fires on a dropdown change, not on a save edited
  // elsewhere. So: emptied here.
  //
  // Beyond that, only a model that says so positively counts as "prepares
  // from items". An unrecognised class yields null, and null is not
  // permission to drop: removing a prepared spell is something the player
  // cannot undo, while a name left behind is at worst a row they can clear
  // themselves.
  const noPreparedListAtAll = model?.hasPreparedList === false;
  const preparedComesFromItems = model?.preparedFrom === "known";
  for (const tab of (Array.isArray(character?.sheetTabs) ? character.sheetTabs : [])) {
    const layout = tab?.layout;
    if (!Array.isArray(layout)) continue;
    for (const block of layout) {
      for (const field of block?.children || []) {
        if (field?.id !== "spellsKnown" && !/^spells known$/i.test(String(field?.label || "").trim())) continue;
        const held = new Set(
          (Array.isArray(field.items) ? field.items : [])
            .map((item) => (typeof item === "string" ? item : item?.text))
            .filter(Boolean),
        );
        const prepared = Array.isArray(field.preparedItems) ? field.preparedItems : [];
        const names = prepared.filter((n) => typeof n === "string" && n);
        field.preparedItems = noPreparedListAtAll
          ? []
          : [...new Set(preparedComesFromItems ? names.filter((n) => held.has(n)) : names)];
      }
    }
  }
  return character;
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

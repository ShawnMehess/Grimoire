// choiceCategories.js
//
// Every choice group the wizard shows needs to land on exactly one page of
// the character-creation flow (Spells, Languages, Ability Scores, Feats,
// Ability Proficiencies, …). That was decided by keyword-matching the
// group's free-text label against the category list — see
// CREATION_CHOICE_CATEGORIES in js/render/sheet/sheetMechanics.js.
//
// That's a guess, and it happens at render time on every group forever:
// rename a label from "Pick 2 skills" to "Chosen proficiencies" and the
// group silently jumps to a different page.
//
// So the page is made explicit here instead, as data, using the same table
// — meaning the assignment below reproduces today's behavior exactly
// (verify-content.mjs asserts that) while turning a per-render guess into
// a stored, hand-correctable field. Groups that genuinely don't fit any
// category fall to the "proficiencies" catch-all, which is what they
// already did.
//
// It lands in a `pageCategory` field rather than `category` because
// `category` is already spoken for: several groups carry category
// "features", a marker from the content passes meaning "this is a
// class-feature choice" (see the favored-enemy / favored-terrain /
// Circle-of-the-Land-terrain groups). That marker is inert for page
// routing — it isn't one of the page keys — but it's real information the
// sourcing checks assert on, so overwriting it would destroy it. Two
// fields, two meanings, no guessing.
//
// Lives in its own module because two generated-data fixup paths need it
// (contentFixups.js for races/classes/backgrounds/subclasses, and the feat
// bundles), and either of those importing the other would be a cycle.

import { CREATION_CHOICE_CATEGORIES, CHOICE_GROUP_CATEGORY_KEYS } from "../render/sheet/sheetMechanics.js";

/** The catch-all: a group that matches no category belongs on the general
 *  proficiencies page. Named explicitly here rather than by indexing the
 *  category list, so reordering that list can't move the fallback. */
export const CATCH_ALL_CATEGORY = "proficiencies";

/** The field an explicit page assignment is stored in. */
export const PAGE_CATEGORY_FIELD = "pageCategory";

/** The page a group belongs to: its explicit `pageCategory` if it has one,
 *  then an explicit `category` that happens to be a valid page key, then
 *  the label heuristic. This is the whole rule in one place — the
 *  renderer and the migration both go through it, so they can't drift. */
export function inferChoiceCategory(group) {
  if (group?.[PAGE_CATEGORY_FIELD] && CHOICE_GROUP_CATEGORY_KEYS.has(group[PAGE_CATEGORY_FIELD])) {
    return group[PAGE_CATEGORY_FIELD];
  }
  if (group?.category && CHOICE_GROUP_CATEGORY_KEYS.has(group.category)) {
    return group.category;
  }
  const label = group?.label || "";
  const found = CREATION_CHOICE_CATEGORIES.find((cat) => cat.test && cat.test.test(label));
  return (found || CREATION_CHOICE_CATEGORIES[CREATION_CHOICE_CATEGORIES.length - 1]).key;
}

/** Give every choice group in a bundle an explicit page, inferred from its
 *  label exactly as the render-time fallback would have. Returns a new
 *  bundle — these are shared across the starter dropdowns, the library, and
 *  save/load canonicals, so nothing here mutates in place. An existing
 *  page assignment is preserved: that's the hand-corrected case, and
 *  re-inferring would undo it. `category` is never written. */
export function withChoiceGroupCategories(bundle) {
  if (!bundle?.choiceGroups?.length) return bundle;
  return {
    ...bundle,
    choiceGroups: bundle.choiceGroups.map((group) => {
      if (group?.[PAGE_CATEGORY_FIELD] && CHOICE_GROUP_CATEGORY_KEYS.has(group[PAGE_CATEGORY_FIELD])) {
        return group;
      }
      return { ...group, [PAGE_CATEGORY_FIELD]: inferChoiceCategory(group) };
    }),
  };
}

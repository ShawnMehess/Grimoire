// choiceCategories.js
//
// Every choice group the wizard shows needs to land on exactly one page of
// the character-creation flow (Spells, Languages, Ability Scores, Feats,
// Ability Proficiencies, …). That was decided by keyword-matching the
// group's free-text label against the category list — see
// CREATION_CHOICE_CATEGORIES below.
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
//
// The page table and the rule below used to live in
// js/render/sheet/sheetMechanics.js, with a second copy of the rule here.
// That made js/data import js/render, which contradicts the "Pure. No DOM,
// no Firebase" claim in README.md, and it had already produced a real crash
// (sheetWizard.js read `categorizeChoiceGroup` before importing it; see the
// note in scripts/smoke-dom.mjs). The rule is now written once, here, and
// sheetMechanics re-exports it under its old name so the render layer's
// import sites are unchanged.

/** The pages a choice group can land on, in the order the wizard shows them,
 *  with the keyword test used only as an import-compat fallback. The last
 *  entry is the catch-all and must stay last — the fallback below indexes
 *  the final element rather than naming a key. */
export const CREATION_CHOICE_CATEGORIES = [
  { key: "spells", title: "Spells & Special Abilities", test: /spell|cantrip|invocation/i },
  { key: "languages", title: "Languages", test: /language/i },
  { key: "equipment", title: "Starting Equipment", test: /equipment|\bgear\b|weapon|armor|\bpack\b/i },
  { key: "feats", title: "Feats", test: /\bfeat\b/i },
  { key: "abilities", title: "Ability Scores", test: /ability score|ability increase|asi/i },
  { key: "skills", title: "Skills", test: /skill/i },
  { key: "tools", title: "Tools", test: /tool/i },
  { key: "weapons", title: "Weapons", test: /weapon/i },
  { key: "armor", title: "Armor", test: /armor/i },
  { key: "vehicles", title: "Vehicles", test: /vehicle/i },
  { key: "proficiencies", title: "Ability Proficiencies", test: null },
];

/** Supported explicit category keys for choice groups. */
export const CHOICE_GROUP_CATEGORY_KEYS = new Set(
  CREATION_CHOICE_CATEGORIES.map((c) => c.key)
);

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

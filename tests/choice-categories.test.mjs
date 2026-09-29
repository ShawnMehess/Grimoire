// tests/choice-categories.test.mjs
//
// Unit tests for explicit choice-group page assignment
// (js/data/choiceCategories.js). The job is to make the wizard's
// create-a-page-for-each-group routing a stored fact instead of a
// per-render keyword guess on the label — without moving any group that
// the old guess had already placed.
//
// Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inferChoiceCategory,
  withChoiceGroupCategories,
  CATCH_ALL_CATEGORY,
  PAGE_CATEGORY_FIELD,
} from "../js/data/choiceCategories.js";
import { categorizeChoiceGroup, CHOICE_GROUP_CATEGORY_KEYS } from "../js/render/sheet/sheetMechanics.js";

describe("inferChoiceCategory", () => {
  it("reads an explicit page assignment first", () => {
    assert.equal(inferChoiceCategory({ label: "Pick 2 skills", pageCategory: "spells" }), "spells");
  });

  it("falls back to a valid page-key category", () => {
    assert.equal(inferChoiceCategory({ label: "Anything", category: "tools" }), "tools");
  });

  it("ignores a category that is not a page key", () => {
    // "features" is a class-feature marker from the content passes, not a
    // page — it must not win routing.
    assert.equal(inferChoiceCategory({ label: "Pick 2 skills", category: "features" }), "skills");
  });

  it("falls back to the label when nothing explicit applies", () => {
    assert.equal(inferChoiceCategory({ label: "Two languages of your choice" }), "languages");
    assert.equal(inferChoiceCategory({ label: "Expertise — pick 2" }), CATCH_ALL_CATEGORY);
  });

  it("ignores an unrecognized page assignment rather than trusting it", () => {
    assert.equal(inferChoiceCategory({ label: "Pick 2 skills", pageCategory: "nonsense" }), "skills");
  });

  it("tolerates a missing group", () => {
    assert.equal(inferChoiceCategory(null), CATCH_ALL_CATEGORY);
    assert.equal(inferChoiceCategory({}), CATCH_ALL_CATEGORY);
  });
});

describe("withChoiceGroupCategories", () => {
  it("assigns a page to every group in the bundle", () => {
    const bundle = { choiceGroups: [{ label: "Pick 2 skills" }, { label: "One language" }] };
    const out = withChoiceGroupCategories(bundle);
    assert.deepEqual(out.choiceGroups.map((g) => g[PAGE_CATEGORY_FIELD]), ["skills", "languages"]);
  });

  it("leaves a group with no label on the catch-all", () => {
    const out = withChoiceGroupCategories({ choiceGroups: [{}] });
    assert.equal(out.choiceGroups[0][PAGE_CATEGORY_FIELD], CATCH_ALL_CATEGORY);
  });

  it("preserves a hand-corrected page", () => {
    const bundle = { choiceGroups: [{ label: "Pick 2 skills", pageCategory: "tools" }] };
    assert.equal(withChoiceGroupCategories(bundle).choiceGroups[0][PAGE_CATEGORY_FIELD], "tools");
  });

  it("never writes `category`, so the features marker survives", () => {
    const bundle = { choiceGroups: [{ label: "Favored Enemy", category: "features" }] };
    const out = withChoiceGroupCategories(bundle);
    assert.equal(out.choiceGroups[0].category, "features");
    assert.equal(out.choiceGroups[0][PAGE_CATEGORY_FIELD], CATCH_ALL_CATEGORY);
  });

  it("does not mutate the input bundle", () => {
    const group = { label: "Pick 2 skills" };
    const bundle = { choiceGroups: [group] };
    withChoiceGroupCategories(bundle);
    assert.equal(group[PAGE_CATEGORY_FIELD], undefined);
    assert.equal(bundle.choiceGroups[0], group);
  });

  it("passes through a bundle with no choice groups", () => {
    const bundle = { statModifiers: [] };
    assert.equal(withChoiceGroupCategories(bundle), bundle);
    assert.equal(withChoiceGroupCategories(null), null);
  });
});

describe("categorizeChoiceGroup agrees with the assignment", () => {
  // The whole point: whatever withChoiceGroupCategories stores must be
  // what the renderer then returns, or the "explicit" page is a lie.
  const labels = [
    "Pick 2 skills",
    "Two languages of your choice",
    "Expertise — pick 2 of your proficiencies",
    "Ability Score Increase",
    "1st-level sorcerer spell — pick 1 (spells)",
    "Artisan's Tools",
    "Weapon Proficiencies",
    "Mystery Choice",
    "",
  ];
  for (const label of labels) {
    it(`routes "${label}" the same assigned and rendered`, () => {
      const assigned = withChoiceGroupCategories({ choiceGroups: [{ label }] }).choiceGroups[0][PAGE_CATEGORY_FIELD];
      assert.equal(categorizeChoiceGroup({ label, [PAGE_CATEGORY_FIELD]: assigned }), assigned);
      assert.ok(CHOICE_GROUP_CATEGORY_KEYS.has(assigned), `${assigned} should be a real page key`);
    });
  }
});

describe("import fallback still covers unlabeled homebrew", () => {
  it("resolves a plain label", () => {
    assert.equal(categorizeChoiceGroup({ label: "Pick 2 skills" }), "skills");
  });

  it("drops an unmatched group on the catch-all", () => {
    assert.equal(categorizeChoiceGroup({ label: "Mystery Choice" }), CATCH_ALL_CATEGORY);
  });

  it("lets an explicit page override a contradictory label", () => {
    assert.equal(categorizeChoiceGroup({ label: "Pick 2 skills", pageCategory: "spells" }), "spells");
  });
});

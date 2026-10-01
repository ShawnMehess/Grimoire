// The Review page's "Still to decide" panel: which pages are outstanding,
// what each one says is missing, and the spell-count phrasing it leans on
// hardest.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  outstandingSteps,
  spellPickShortfallPhrase,
  isStepApplicable,
} from "../js/render/sheet/sheetWizard.js";

/** A step stub shaped like the wizard's: an optional applicability check,
 *  an isComplete, and an optional missingReasons. */
function step(id, title, { applicable = true, complete = true, reasons = null } = {}) {
  return {
    id,
    title,
    isApplicable: () => applicable,
    isComplete: () => complete,
    missingReasons: reasons === null ? undefined : () => reasons,
  };
}

describe("outstandingSteps", () => {
  it("lists nothing once every page is decided", () => {
    const steps = [step("a", "A"), step("b", "B")];
    assert.deepEqual(outstandingSteps(steps), []);
  });

  it("lists only the pages that still need decisions, in step order", () => {
    const steps = [
      step("rules", "Rules", { complete: false, reasons: "No source book ticked." }),
      step("identity", "Identity"),
      step("class", "Class", { complete: false, reasons: ["No class picked yet."] }),
    ];
    assert.deepEqual(outstandingSteps(steps), [
      { stepId: "rules", title: "Rules", reasons: ["No source book ticked."] },
      { stepId: "class", title: "Class", reasons: ["No class picked yet."] },
    ]);
  });

  it("skips a page that does not apply: skipped is not the same as unfinished", () => {
    // No ASI at level 1. The wizard's dots already say "skipped", and
    // listing it here as outstanding would ask the player to go complete a
    // page that cannot be completed.
    const steps = [
      step("asi", "Ability Score Improvement", { applicable: false, complete: false }),
      step("class", "Class"),
    ];
    assert.deepEqual(outstandingSteps(steps), []);
  });

  it("stops before the page it is asked to stop at, so a page never lists itself", () => {
    const steps = [
      step("class", "Class", { complete: false, reasons: "Choices still to make." }),
      step("review", "Review", { complete: false, reasons: "nope" }),
      step("later", "Later", { complete: false, reasons: "nope" }),
    ];
    assert.deepEqual(outstandingSteps(steps, { untilStepId: "review" }), [
      { stepId: "class", title: "Class", reasons: ["Choices still to make."] },
    ]);
  });

  it("a page with no reasons still gets a row", () => {
    // An unnamed outstanding page is worse than a blunt one — a player
    // cannot act on a list entry that does not say what to do.
    const steps = [step("gear", "Gear", { complete: false })];
    assert.deepEqual(outstandingSteps(steps), [{ stepId: "gear", title: "Gear", reasons: [] }]);
  });

  it("accepts a bare string for reasons and drops blanks", () => {
    const steps = [step("gear", "Gear", { complete: false, reasons: ["  ", "Pick tools."] })];
    assert.deepEqual(outstandingSteps(steps)[0].reasons, ["Pick tools."]);
  });

  it("a page whose isComplete throws is treated as decided, not as outstanding", () => {
    // Matches stepIsComplete: one broken page must not fill the Review
    // screen with noise it cannot clear.
    const broken = { id: "broken", title: "Broken", isApplicable: () => true, isComplete: () => { throw new Error("boom"); } };
    assert.deepEqual(outstandingSteps([broken]), []);
  });

  it("a missingReasons that throws falls back to no detail rather than breaking the page", () => {
    const broken = {
      id: "broken",
      title: "Broken",
      isApplicable: () => true,
      isComplete: () => false,
      missingReasons: () => { throw new Error("boom"); },
    };
    assert.deepEqual(outstandingSteps([broken]), [{ stepId: "broken", title: "Broken", reasons: [] }]);
  });

  it("isStepApplicable defaults to true for a step with no check", () => {
    assert.equal(isStepApplicable({ id: "x" }), true);
  });
});

describe("spellPickShortfallPhrase", () => {
  const cantrips = { key: "k0", level: 0, minSelections: 3 };
  const level1 = { key: "k1", level: 1, minSelections: 3 };

  it("counts what is still short, in the user's words", () => {
    assert.equal(spellPickShortfallPhrase([cantrips, level1], { k0: ["a"], k1: ["b", "c"] }), "2 cantrips and 1 1st-level spell still to choose");
  });

  it("says nothing when every group is satisfied", () => {
    assert.equal(spellPickShortfallPhrase([cantrips, level1], { k0: ["a", "b", "c"], k1: ["x", "y", "z"] }), "");
  });

  it("does NOT credit the pick's own selections", () => {
    // minSelections is the shortfall AFTER spells held elsewhere are
    // credited; it is compared against how many the pick HAS made.
    // Crediting them here is the bug that let a half-finished pick read as
    // complete: at two cantrips of four this would return "".
    assert.equal(spellPickShortfallPhrase([cantrips], { k0: ["a", "b"] }), "1 cantrip still to choose");
  });

  it("pluralizes the level nouns and handles a zero shortfall group", () => {
    const level2 = { key: "k2", level: 2, minSelections: 2 };
    assert.equal(spellPickShortfallPhrase([level2], {}), "2 2nd-level spells still to choose");
    const done = { key: "k3", level: 3, minSelections: 0 };
    assert.equal(spellPickShortfallPhrase([done], {}), "");
  });

  it("joins three groups with 'and' for the first two, as the two-group case does", () => {
    const three = [{ key: "a", level: 0, minSelections: 1 }, { key: "b", level: 1, minSelections: 1 }, { key: "c", level: 2, minSelections: 1 }];
    assert.equal(spellPickShortfallPhrase(three, {}), "1 cantrip and 1 1st-level spell and 1 2nd-level spell still to choose");
  });

  it("handles no groups and no picks at all", () => {
    assert.equal(spellPickShortfallPhrase(), "");
    assert.equal(spellPickShortfallPhrase([], {}), "");
  });
});

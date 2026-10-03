// Multiclass level arithmetic.
//
// These are the rules that decide which class gains a level being taken and
// what level that class reaches. They were inline in
// renderRulesetLevelGuide() with no tests at all; the one divergence that
// had already crept in (the primary read as the sheet total instead of
// total-minus-secondaries) was invisible for exactly that reason - for a
// single-class character the two numbers coincide.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  primaryLevelFor,
  levelReachedByClass,
  postApplyClassSlices,
  subclassNameForClass,
} from "../js/data/multiclassLevels.js";

describe("primaryLevelFor", () => {
  test("a single-class character is at the level being taken", () => {
    assert.equal(primaryLevelFor(5, []), 5);
  });

  test("applied secondaries come off the sheet total", () => {
    // Fighter 5 / Rogue 2, taking level 8: the Fighter is level 6.
    assert.equal(primaryLevelFor(8, [{ name: "Rogue", levels: 2 }]), 6);
  });

  test("several secondaries all come off", () => {
    const entries = [{ name: "Rogue", levels: 2 }, { name: "Wizard", levels: 3 }];
    assert.equal(primaryLevelFor(11, entries), 6);
  });

  test("never drops below 1, even if the secondaries outnumber the total", () => {
    // Bookkeeping that cannot happen in play, but a persisted document can
    // hold it. Clamping beats handing a level plan a level 0.
    assert.equal(primaryLevelFor(2, [{ name: "Rogue", levels: 9 }]), 1);
  });

  test("a missing level reads as 1 rather than NaN", () => {
    assert.equal(primaryLevelFor(null, []), 1);
    assert.equal(primaryLevelFor(undefined, []), 1);
  });

  test("a non-numeric levels on a persisted entry counts as zero", () => {
    assert.equal(primaryLevelFor(4, [{ name: "Rogue", levels: null }]), 4);
    assert.equal(primaryLevelFor(4, [{ name: "Rogue", levels: "2" }]), 2);
  });
});

describe("levelReachedByClass", () => {
  const entries = [{ name: "Rogue", levels: 2 }];

  test("the primary reaches total-minus-secondaries, NOT the total", () => {
    // This is the regression. The sheet says level 8; the Fighter is 6.
    // Reading the raw total here showed the wrong features on the Class
    // step for every multiclassed character.
    assert.equal(levelReachedByClass({ level: 8, entries, primaryName: "Fighter", className: "Fighter" }), 6);
    assert.notEqual(
      levelReachedByClass({ level: 8, entries, primaryName: "Fighter", className: "Fighter" }),
      8
    );
  });

  test("an applied secondary reaches its banked levels plus one", () => {
    assert.equal(levelReachedByClass({ level: 8, entries, primaryName: "Fighter", className: "Rogue" }), 3);
  });

  test("a class not on the sheet reads as 1, never undefined", () => {
    assert.equal(levelReachedByClass({ level: 8, entries, primaryName: "Fighter", className: "Bard" }), 1);
  });

  test("no class named falls back to the level being taken", () => {
    // Nothing to offset against, so the total is the only sensible answer.
    assert.equal(levelReachedByClass({ level: 8, entries, primaryName: "Fighter", className: "" }), 8);
  });

  test("a single-class character is unaffected by the distinction", () => {
    assert.equal(levelReachedByClass({ level: 5, entries: [], primaryName: "Bard", className: "Bard" }), 5);
  });

  test("a brand-new class reaches 1", () => {
    // Not in entries and not the primary - the caller resolves it by name.
    assert.equal(levelReachedByClass({ level: 8, entries, primaryName: "Fighter", className: "__new" }), 1);
  });
});

describe("postApplyClassSlices", () => {
  const entries = [{ name: "Rogue", levels: 2 }];

  test("taking the primary grows the primary to its own post-apply level", () => {
    const slices = postApplyClassSlices({ level: 8, entries, primaryName: "Fighter", levelClass: "Fighter" });
    const fighter = slices.find((s) => s.name === "Fighter");
    assert.equal(fighter.levels, 6);
  });

  test("taking a secondary leaves the primary one lower still", () => {
    // Level 8 goes to the Rogue, so the Fighter does not grow: post-apply
    // would be 6, and not growing makes it 5.
    const slices = postApplyClassSlices({ level: 8, entries, primaryName: "Fighter", levelClass: "Rogue" });
    assert.equal(slices.find((s) => s.name === "Fighter").levels, 5);
    assert.equal(slices.find((s) => s.name === "Rogue").levels, 3);
  });

  test("a brand-new class enters at 1 alongside the primary", () => {
    const slices = postApplyClassSlices({
      level: 3, entries: [], primaryName: "Fighter", levelClass: "__new",
      takingNewClass: true, newClassName: "Wizard",
    });
    assert.equal(slices.find((s) => s.name === "Wizard").levels, 1);
    assert.equal(slices.find((s) => s.name === "Fighter").levels, 2);
  });

  test("a class with no levels is dropped, not planned at level 0", () => {
    // An applied secondary that somehow holds 0 levels contributes nothing.
    const slices = postApplyClassSlices({
      level: 4, entries: [{ name: "Rogue", levels: 0 }], primaryName: "Fighter", levelClass: "Fighter",
    });
    assert.equal(slices.some((s) => s.name === "Rogue"), false);
  });

  test("an unnamed class is dropped", () => {
    const slices = postApplyClassSlices({
      level: 4, entries: [{ levels: 2 }], primaryName: "Fighter", levelClass: "Fighter",
    });
    assert.equal(slices.length, 1);
    assert.equal(slices[0].name, "Fighter");
  });

  test("a first-level single-class character keeps its one slice", () => {
    const slices = postApplyClassSlices({ level: 1, entries: [], primaryName: "Bard", levelClass: "Bard" });
    assert.deepEqual(slices, [{ name: "Bard", levels: 1 }]);
  });
});

describe("subclassNameForClass", () => {
  const entries = [{ name: "Rogue", levels: 2, subclass: "Thief" }];

  test("the primary reads the sheet's own subclass", () => {
    assert.equal(subclassNameForClass({ primaryName: "Fighter", primarySubclass: "Champion", entries, className: "Fighter" }), "Champion");
  });

  test("a secondary reads its recorded subclass", () => {
    assert.equal(subclassNameForClass({ primaryName: "Fighter", primarySubclass: "Champion", entries, className: "Rogue" }), "Thief");
  });

  test("the not-yet-chosen new class has no subclass", () => {
    assert.equal(subclassNameForClass({ primaryName: "Fighter", primarySubclass: "Champion", entries, className: "__new" }), "");
    assert.equal(subclassNameForClass({ primaryName: "Fighter", primarySubclass: "Champion", entries, className: "" }), "");
  });

  test("an unchosen primary subclass is empty, not undefined", () => {
    assert.equal(subclassNameForClass({ primaryName: "Fighter", entries, className: "Fighter" }), "");
  });
});

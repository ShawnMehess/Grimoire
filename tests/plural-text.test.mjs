// tests/plural-text.test.mjs
//
// Unit tests for the lazy-plural fixup (js/data/pluralText.js).
//
// The compiler emits counts as "1 feat(s)" / "2 proficiency(ies)" so it
// doesn't have to know the number. That's fine in data and wrong on
// screen, so it's resolved here. The cases that matter are the ones
// where guessing would corrupt prose: an aside that happens to contain
// "(s)", and a parenthetical with no number at all.
//
// Run: node --test tests/...
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fixPluralParens, fixPluralDeep } from "../js/data/pluralText.js";
import { FIXED_RACE_ENTRIES, FIXED_CLASS_ENTRIES, SUBCLASS_BUNDLE_MAP } from "../js/data/contentFixups.js";
import { LINKED_FEAT_BUNDLES } from "../js/data/catalogLinks.js";

describe("fixPluralParens", () => {
  it("leaves the singular alone", () => {
    assert.equal(fixPluralParens("Gain 1 feat of your choice."), "Gain 1 feat of your choice.");
    assert.equal(fixPluralParens("Gain 1 skill of your choice."), "Gain 1 skill of your choice.");
  });

  it("makes the plural real when the count is above one", () => {
    assert.equal(fixPluralParens("Gain 2 feat(s)."), "Gain 2 feats.");
    assert.equal(fixPluralParens("3 skill(s)."), "3 skills.");
  });

  it("handles the (ies) form", () => {
    assert.equal(fixPluralParens("1 proficiency(ies)"), "1 proficiency");
    assert.equal(fixPluralParens("2 proficiency(ies)"), "2 proficiencies");
    assert.equal(fixPluralParens("1 ability(ies)"), "1 ability");
    assert.equal(fixPluralParens("2 ability(ies)"), "2 abilities");
    // A stem that already ends in y keeps the y: "ability" -> "abilities".
    assert.equal(fixPluralParens("2 ability(ies)"), "2 abilities");
    // Source text is only ever "(s)" for y-stems - "(ies)" appears on
    // whole words. A stem with no plural form drops the placeholder
    // rather than inventing "scoreies".
    assert.equal(fixPluralParens("2 score(ies)"), "2 score");
  });

  it("pluralizes a word ending in y correctly", () => {
    assert.equal(fixPluralParens("2 ability(s)"), "2 abilities");
    assert.equal(fixPluralParens("2 specialty(s)"), "2 specialties");
  });

  it("handles sibilant endings", () => {
    assert.equal(fixPluralParens("2 class(s)"), "2 classes");
    assert.equal(fixPluralParens("2 match(s)"), "2 matches");
  });

  it("reads a spelled-out number as a count", () => {
    assert.equal(fixPluralParens("one feat(s)"), "one feat");
    assert.equal(fixPluralParens("two feat(s)"), "two feats");
  });

  it("leaves a parenthetical with no number alone", () => {
    // Guessing here would corrupt prose: "(see below)" is not a plural.
    assert.equal(fixPluralParens("Gain a feat (see below)."), "Gain a feat (see below).");
    assert.equal(fixPluralParens("A word(s) in passing."), "A word(s) in passing.");
  });

  it("leaves an unknown number alone rather than guessing", () => {
    assert.equal(fixPluralParens("many feat(s)"), "many feat(s)");
  });

  it("leaves a capitalized word's case alone", () => {
    assert.equal(fixPluralParens("1 Feat(s)"), "1 Feat");
    assert.equal(fixPluralParens("2 Feat(s)"), "2 Feats");
  });

  it("fixes several in one string", () => {
    assert.equal(fixPluralParens("Pick 1 feat(s) and 2 skill(s)."), "Pick 1 feat and 2 skills.");
  });

  it("passes through non-strings and strings with no parentheses", () => {
    assert.equal(fixPluralParens("Nothing to do"), "Nothing to do");
    assert.equal(fixPluralParens(null), null);
    assert.equal(fixPluralParens(7), 7);
  });
});

describe("fixPluralDeep", () => {
  it("reaches strings inside nested structures", () => {
    const out = fixPluralDeep({
      description: "1 feat(s)",
      choiceGroups: [{ label: "2 skill(s)", options: [{ name: "1 language(s)" }] }],
    });
    assert.equal(out.description, "1 feat");
    assert.equal(out.choiceGroups[0].label, "2 skills");
    assert.equal(out.choiceGroups[0].options[0].name, "1 language");
  });

  it("leaves numbers, booleans and nulls alone", () => {
    assert.deepEqual(fixPluralDeep({ n: 1, b: true, z: null }), { n: 1, b: true, z: null });
  });

  it("does not rebuild a class instance", () => {
    // A bundle can carry a Timestamp or similar; rebuilding it would lose
    // the prototype and everything the store relies on.
    class Stamp { constructor() { this.when = 1; } }
    const stamp = new Stamp();
    const out = fixPluralDeep({ stamp });
    assert.equal(out.stamp, stamp, "kept by reference");
  });
});

describe("no lazy plurals survive into the shipped content", () => {
  it("finds none anywhere", () => {
    const found = [];
    const scan = (v, path) => {
      if (typeof v === "string") {
        if (/\((?:s|ies)\)/.test(v)) found.push(`${path}: ${v.slice(0, 80)}`);
        return;
      }
      if (Array.isArray(v)) { v.forEach((x, i) => scan(x, `${path}[${i}]`)); return; }
      if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) scan(x, `${path}.${k}`);
      }
    };
    for (const e of FIXED_RACE_ENTRIES) scan(e.bundle, `race:${e.name}`);
    for (const e of FIXED_CLASS_ENTRIES) scan(e.bundle, `class:${e.name}`);
    for (const [k, b] of SUBCLASS_BUNDLE_MAP) scan(b, `sub:${k}`);
    // Feat bundles are generated, so the pass runs on read in
    // catalogLinks.js rather than in contentFixups - check them too.
    for (const b of LINKED_FEAT_BUNDLES) scan(b, `feat:${b.name}`);
    assert.deepEqual(found, []);
  });
});

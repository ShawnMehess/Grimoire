// The choice-group builders.
//
// These six functions are the de-facto contract for what a choice group is.
// They feed real shipped content - contentFixups.js, classPicks.js and
// subclassPicks.js all build groups with them - so a shape change here moves
// hundreds of groups at once.
//
// The tests below lean on the properties that are deliberate rather than
// incidental. A test asserting "skillPick returns an object with an id" is
// worth little; a test asserting "skillOrLanguagePick ships NO flat options
// list" is worth a lot, because that absence is the whole safety property and
// nothing stops someone helpfully adding one.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  skillPick,
  languagePick,
  toolPick,
  spellPick,
  namedPick,
  skillOrLanguagePick,
  DWARF_BASE_TOOLS,
} from "../js/data/missingPicks.js";
import { SKILLS, LANGUAGES } from "../js/data/schema.js";

/** The contract, as one predicate, so every builder is held to the same bar. */
function assertWellFormed(g, label) {
  assert.ok(g.id, `${label}: has an id`);
  assert.ok(g.label, `${label}: has a label`);
  assert.ok(Number.isFinite(Number(g.minSelections)), `${label}: numeric minSelections`);
  assert.ok(Number.isFinite(Number(g.maxSelections)), `${label}: numeric maxSelections`);
  assert.ok(Number(g.minSelections) <= Number(g.maxSelections), `${label}: min <= max`);
  // Exactly one place options come from, except that a spell pick ships a
  // placeholder option on purpose (see the spellPick describe).
  const sources = ["options", "categories"].filter((k) => (g[k] || []).length);
  const spellish = Boolean(g.spellPick);
  assert.ok(sources.length + (spellish ? 1 : 0) > 0, `${label}: offers something`);
  assert.ok(!(sources.length > 1), `${label}: not both options and categories`);
}

describe("every builder produces the contract shape", () => {
  const all = [
    ["skillPick", skillPick("g-skills", "Pick two", 2)],
    ["languagePick", languagePick("g-langs", "Pick one", 1)],
    ["toolPick", toolPick("g-tools", "Pick one", ["Smith's Tools"])],
    ["spellPick", spellPick("g-spells", "Pick a cantrip", { list: "wizard", level: 0 })],
    ["namedPick", namedPick("g-named", "Pick a totem", ["Bear", "Elk"])],
    ["skillOrLanguagePick", skillOrLanguagePick("g-either", "Skill or language")],
  ];
  for (const [name, g] of all) {
    test(name, () => assertWellFormed(g, name));
  }
});

describe("skillPick", () => {
  test("grants a real proficiency per skill, so a pick changes the sheet", () => {
    const g = skillPick("g", "Pick two", 2);
    const stealth = g.options.find((o) => o.name === "Stealth");
    assert.deepEqual(stealth.statModifiers, [{ targetFieldId: "stealthProf", op: "grant" }]);
  });

  test("offers every skill the sheet knows, by name not by copy", () => {
    // Built from schema.js, so a skill added there appears here with no edit
    // here - which is the point of not keeping a second list.
    const g = skillPick("g", "Pick", 1);
    assert.equal(g.options.length, SKILLS.length);
    assert.deepEqual(g.options.map((o) => o.name), SKILLS.map((s) => s.label));
  });

  test("count sets both ends of the budget", () => {
    const g = skillPick("g", "Pick three", 3);
    assert.equal(g.minSelections, 3);
    assert.equal(g.maxSelections, 3);
  });

  test("option ids are namespaced by the group, so two groups cannot collide", () => {
    const a = skillPick("race-a", "Pick", 1).options[0].id;
    const b = skillPick("race-b", "Pick", 1).options[0].id;
    assert.ok(a.startsWith("race-a-"));
    assert.ok(b.startsWith("race-b-"));
    assert.notEqual(a, b);
  });
});

describe("languagePick", () => {
  test("Common is never offered - it is free", () => {
    const g = languagePick("g", "Pick one", 1);
    assert.equal(g.options.some((o) => o.name === "Common"), false);
  });

  test("grants through the languages taglist, not a checkbox", () => {
    const g = languagePick("g", "Pick one", 1);
    assert.deepEqual(g.options[0].statModifiers, [
      { targetFieldId: "languages", op: "grantTag", value: g.options[0].name },
    ]);
  });

  test("a name with punctuation still yields a usable id", () => {
    const g = languagePick("g", "Pick one", 1);
    for (const o of g.options) {
      assert.match(o.id, /^g-[a-z0-9-]+$/, `"${o.name}" -> ${o.id}`);
    }
  });
});

describe("toolPick", () => {
  test("offers exactly the tools it was handed", () => {
    const g = toolPick("g", "Pick one", ["Smith's Tools", "Brewer's Supplies"]);
    assert.deepEqual(g.options.map((o) => o.name), ["Smith's Tools", "Brewer's Supplies"]);
  });

  test("grants into the tool proficiency taglist", () => {
    const g = toolPick("g", "Pick one", ["Smith's Tools"]);
    assert.deepEqual(g.options[0].statModifiers, [
      { targetFieldId: "toolProf", op: "grantTag", value: "Smith's Tools" },
    ]);
  });

  test("the dwarf base rule is smith's, brewer's or mason's - all three real tools", () => {
    assert.deepEqual(DWARF_BASE_TOOLS, ["Smith's Tools", "Brewer's Supplies", "Mason's Tools"]);
  });
});

describe("spellPick", () => {
  test("lists no spells, because the catalog is the list", () => {
    // If this ever starts naming spells they become a second copy of the
    // spell list and can drift from it.
    const g = spellPick("g", "Pick a cantrip", { list: "wizard", level: 0 });
    const named = g.options.filter((o) => o.name !== "Choose a spell" && !/^Choose \d+ spells$/.test(o.name));
    assert.deepEqual(named, []);
  });

  test("carries the class and level the dialog filters by", () => {
    const g = spellPick("g", "Pick a 3rd-level spell", { list: "wizard", level: 3 });
    assert.deepEqual(g.spellPick, { list: "wizard", level: 3 });
  });

  test("ships a placeholder row, so the group is never rendered empty", () => {
    const one = spellPick("g1", "Pick a spell", { list: null, level: 0 });
    assert.equal(one.options.length, 1);
    assert.match(one.options[0].name, /Choose a spell/);
    const three = spellPick("g3", "Pick spells", { list: null, level: 0, count: 3 });
    assert.match(three.options[0].name, /Choose 3 spells/);
    assert.equal(three.maxSelections, 3);
  });

  test("a null class list is allowed - Bard Magical Secrets is any-class", () => {
    const g = spellPick("g", "Magical secret", { list: null, level: 3 });
    assert.equal(g.spellPick.list, null);
  });

  test("minLevel gates the group itself", () => {
    const g = spellPick("g", "Pick", { list: "wizard", level: 3, minLevel: 5 });
    assert.equal(g.minLevel, 5);
  });
});

describe("namedPick", () => {
  test("grants nothing - the choice IS the feature", () => {
    // A totem spirit has no stat to change; the effect text lives on the
    // feature. A statModifier here would be inventing a rule.
    const g = namedPick("g", "Pick a totem", ["Bear", "Elk"]);
    for (const o of g.options) {
      assert.equal(o.statModifiers, undefined);
      assert.equal(o.featureGrants, undefined);
    }
  });

  test("is marked as a class-feature choice, which the content gate requires", () => {
    const g = namedPick("g", "Pick a totem", ["Bear"]);
    assert.equal(g.category, "features");
    assert.equal(g.choiceKind, "build");
  });

  test("distinct names cannot collapse to one id", () => {
    const g = namedPick("g", "Pick", ["Sharp", "Sharf", "Shark"]);
    assert.equal(new Set(g.options.map((o) => o.id)).size, 3);
  });
});

describe("skillOrLanguagePick", () => {
  test("ships NO flat options list - that absence is the safety property", () => {
    // A flat list would let a flat renderer offer the skills with no
    // proficiency attached, which is the exact bug a cross-category group
    // exists to prevent. Everything is reachable through `categories`.
    const g = skillOrLanguagePick("g", "Skill or language");
    assert.equal(g.options, undefined);
    assert.deepEqual(g.categories.map((c) => c.label), ["A skill", "A language"]);
  });

  test("both categories attach the proficiency they imply", () => {
    const g = skillOrLanguagePick("g", "Skill or language");
    const skill = g.categories.find((c) => c.label === "A skill").options[0];
    assert.equal(skill.statModifiers[0].op, "grant");
    const lang = g.categories.find((c) => c.label === "A language").options[0];
    assert.equal(lang.statModifiers[0].op, "grantTag");
  });

  test("the language half still excludes Common", () => {
    const g = skillOrLanguagePick("g", "Skill or language");
    const langs = g.categories.find((c) => c.label === "A language").options.map((o) => o.name);
    assert.equal(langs.includes("Common"), false);
    assert.equal(langs.length, LANGUAGES.filter((n) => n !== "Common").length);
  });

  test("one pick budget covers both categories", () => {
    const g = skillOrLanguagePick("g", "Skill or language");
    assert.equal(g.minSelections, 1);
    assert.equal(g.maxSelections, 1);
  });

  test("category ids are namespaced so they cannot collide with option ids", () => {
    const g = skillOrLanguagePick("g", "Skill or language");
    const ids = g.categories.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const c of g.categories) assert.ok(c.id.startsWith("g-"));
  });
});

describe("extra overrides", () => {
  test("an extra key overrides the builder's own, and minLevel arrives that way", () => {
    const g = skillPick("g", "Pick one", 1, { minLevel: 3, label: "Overridden" });
    assert.equal(g.minLevel, 3);
    assert.equal(g.label, "Overridden");
  });

  test("an extra can narrow the budget", () => {
    const g = namedPick("g", "Pick", ["A", "B"], { maxSelections: 2 });
    assert.equal(g.maxSelections, 2);
  });
});

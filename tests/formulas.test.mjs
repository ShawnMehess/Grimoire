// tests/formulas.test.mjs
//
// Unit tests for the formula engine (js/data/formula.js), the shared
// rules/ability helpers (js/render/sheet/sheetRules.js), mechanics
// previews (js/render/sheet/sheetMechanics.js), and the pure
// level-review builders in sheetWizardSteps.js.
// Run: node --test tests/

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateExpression,
  validateExpression,
  validateCondition,
} from "../js/data/formula.js";
import {
  pointBuyCost,
  abilityModifier,
  formatModifier,
  findMoneyFieldByNameIn,
  findStarterFieldIn,
  missingSetupTargets,
  appendUniqueTextListItemTo,
  intFromRichText,
  floatFromRichText,
  classGrantsAsiIn,
} from "../js/render/sheet/sheetRules.js";
import {
  categorizeChoiceGroup,
  collapseBits,
  featureBit,
  previewBitsFor,
  mechanicsPreviewFor,
  commonPreviewBits,
  briefDescription,
  capitalizeFirst,
  statModifierSummary,
} from "../js/render/sheet/sheetMechanics.js";
import {
  levelReviewSectionsFor,
  levelReviewSummary,
  validateLevelApply,
  applyAsiToScores,
  buildLevelUpEntry,
  levelClassOptionsFor,
} from "../js/render/sheet/sheetWizardSteps.js";

describe("formula engine", () => {
  it("evaluates arithmetic with precedence", () => {
    assert.equal(evaluateExpression("2 + 3 * 4"), 14);
    assert.equal(evaluateExpression("(2 + 3) * 4"), 20);
    assert.equal(evaluateExpression("7 / 2"), 3.5);
  });

  it("validates expressions and surfaces problems", () => {
    assert.equal(validateExpression("2 + 2"), null);
    assert.ok((validateExpression("2 +") || "").includes("incomplete"));
    assert.ok((validateExpression("((2)") || "").includes("parenthesis"));
    assert.equal(validateCondition("3 > 2"), null);
  });
});

describe("abilities and point buy", () => {
  it("prices scores on the standard curve", () => {
    assert.equal(pointBuyCost(8, 8), 0);
    assert.equal(pointBuyCost(14, 8), 7);
    assert.equal(pointBuyCost(15, 8), 9);
  });

  it("derives modifiers and formats them", () => {
    assert.equal(abilityModifier(14), 2);
    assert.equal(abilityModifier(9), -1);
    assert.equal(formatModifier(2), "+2");
    assert.equal(formatModifier(-1), "-1");
  });

  it("grants ASIs at tagged levels", () => {
    assert.equal(classGrantsAsiIn([{ minLevel: 4, name: "Ability Score Improvement" }], 4), true);
    assert.equal(classGrantsAsiIn([{ minLevel: 4, name: "Ability Score Improvement" }], 5), false);
  });

  it("applies ASIs to score maps", () => {
    const scores = { str: 10 };
    assert.equal(applyAsiToScores(scores, "single", "str"), "+2 STR");
    assert.equal(scores.str, 12);
  });
});

describe("money and text parsing", () => {
  it("finds money fields by conventional names", () => {
    assert.equal(findMoneyFieldByNameIn([{ fieldType: "text", label: "GP" }])?.label, "GP");
    assert.equal(findMoneyFieldByNameIn([{ fieldType: "text", label: "Name" }]), null);
  });

  it("reads numbers out of rich text", () => {
    assert.equal(intFromRichText("<b>12</b>"), 12);
    assert.equal(floatFromRichText("<b>12</b>"), 12);
  });
});

describe("customized-sheet target lookup", () => {
  it("prefers id matches, falls back to labels", () => {
    assert.equal(findStarterFieldIn([{ id: "a", label: "X" }], "a", "Y")?.label, "X");
    assert.equal(findStarterFieldIn([{ id: "b", label: "Y" }], "a", "Y")?.id, "b");
    assert.equal(findStarterFieldIn([], "a", "Y"), null);
  });

  it("reports only deleted targets", () => {
    const fields = [
      { id: "gp-1", fieldType: "text", label: "Gold" },
      { id: "items-9", fieldType: "textlist", label: "Items", items: [] },
    ];
    const missing = missingSetupTargets(fields, [
      { id: "level", label: "Level", what: "Level" },
      { id: "gp-1", label: "GP", what: "gold" },
      { id: "nope", label: "Items", what: "items" },
    ]);
    assert.deepEqual(missing.map((t) => t.what), ["Level"]);
  });

  it("appends list items uniquely to textlists", () => {
    assert.equal(appendUniqueTextListItemTo({ fieldType: "text", items: [] }, "x"), false);
    assert.equal(appendUniqueTextListItemTo({ fieldType: "textlist", items: ["x"] }, "x"), false);
    assert.equal(appendUniqueTextListItemTo({ fieldType: "textlist", items: [] }, "x"), true);
  });
});

describe("mechanics previews", () => {
  it("categorizes groups with a proficiencies catch-all", () => {
    assert.equal(categorizeChoiceGroup({ label: "Pick a spell" }), "spells");
    assert.equal(categorizeChoiceGroup({ label: "random" }), "proficiencies");
  });

  it("collapses duplicate bits and formats features", () => {
    assert.deepEqual(collapseBits(["A", "A", "B"]), ["2 A", "B"]);
    assert.equal(featureBit({ name: "Speed", description: "25 ft. walking" }), "Speed: 25 feet");
    assert.equal(featureBit({ name: "Darkvision", description: "60 ft." }), "Darkvision: 60 feet");
  });

  it("previews bundles and filters page-common traits", () => {
    const summarize = (m) => statModifierSummary(m, { resolveLabel: m.targetFieldId === "conScore" ? "CON" : "Languages" });
    const dwarf = {
      statModifiers: [
        { targetFieldId: "conScore", op: "add", value: 2 },
        { targetFieldId: "languages", op: "grantTag", value: "Common" },
        { targetFieldId: "languages", op: "grantTag", value: "Dwarvish" },
      ],
      featureGrants: [{ name: "Speed", description: "25 ft. walking", minLevel: 1 }],
    };
    const bits = previewBitsFor(dwarf, 1, { summarize });
    assert.ok(bits.includes("+2 CON") && bits.includes("2 Languages") && bits.includes("Speed: 25 feet"));
    const mk = (extra) => ({ statModifiers: [], featureGrants: [{ name: "Starting Equipment" }, { name: extra }] });
    const common = commonPreviewBits([mk("A"), mk("B")], 1, {});
    assert.ok(common.has("Starting Equipment") && !common.has("A"));
    assert.equal(mechanicsPreviewFor(null, 1), null);
  });

  it("snips descriptions without starting mid-word", () => {
    assert.ok(briefDescription("When you score a critical hit, roll extra dice.", 120).startsWith("When you"));
    assert.equal(briefDescription("First. Second.", 200), "First.");
    assert.equal(capitalizeFirst("meditate 4 hours"), "Meditate 4 hours");
    assert.equal(capitalizeFirst(""), "");
  });
});

describe("level review builders", () => {
  it("sections identity, HP, picks, and notes", () => {
    const sections = levelReviewSectionsFor({
      classLine: "Fighter 5", race: "Elf", background: "", hp: "6", hpDetail: "d10 average +2 CON",
      subclass: "Champion", needsAsi: true, asiMode: "feat", featChoice: "", asiAbilities: [],
      slots: "", choiceLines: ["Skills: Arcana"], notes: "took the oath",
    });
    assert.ok(sections.includes("Class: Fighter 5") && sections.includes("Race: Elf"));
    assert.ok(!sections.some((s) => s.startsWith("Background:")));
    assert.ok(sections.includes("HP: +6 (d10 average +2 CON)"));
    assert.ok(sections.includes("Feat: not chosen yet"));
    assert.deepEqual(levelReviewSectionsFor({}), []);
  });

  it("summarizes and validates level application", () => {
    assert.equal(levelReviewSummary({ hp: "7", subclass: "", needsAsi: false, slots: "" }), "HP +7");
    assert.equal(validateLevelApply({ hpGain: NaN, contentGroups: [], pendingChoices: {}, needsAsi: false }),
      "Enter the HP gained for this level before applying it.");
    assert.equal(validateLevelApply({ hpGain: 5, contentGroups: [], pendingChoices: {}, needsAsi: false }), null);
    const entry = buildLevelUpEntry({ level: 2, hpGain: 7, subclassName: "", slots: "", featureEntry: "F", asiSummary: "", appliedRulesetId: "x", prev: {} });
    assert.equal(entry.hp, "+7");
  });

  it("splits taken vs untaken level-up classes", () => {
    const opts = levelClassOptionsFor({ primaryName: "Fighter", entries: [{ name: "Rogue", levels: 1 }], allClassNames: ["Fighter", "Rogue", "Wizard"], level: 5 });
    assert.deepEqual(opts.taken, ["Fighter", "Rogue"]);
    assert.deepEqual(opts.untaken, ["Wizard"]);
    assert.equal(opts.canMulticlass, true);
  });
});

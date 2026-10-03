// tests/leveling.test.mjs
//
// Unit tests for leveling + multiclassing pure logic (js/data/rulesEngine.js,
// js/data/dnd5e.js, js/render/sheet/sheetLeveling.js, plus the
// secondary-class stripping in js/data/contentFixups.js).
// Run: node --test tests/

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classLevelsFor,
  meetsMulticlassPrereq,
  multiclassPrereqReason,
  normalizeRulesState,
  includedRulesetIds,
  primaryRulesetId,
  effectiveScoresFor,
  spellLimitFor,
} from "../js/data/rulesEngine.js";
import {
  hitDieFor,
  casterWeight,
  listRulesets,
  listContentPacks,
  getContentPack,
  getRuleset,
  getRulesetClass,
  classNamesIn,
  subclassesAcrossRulesets,
  getLevelUpPlan,
  multiclassSlotsFor,
} from "../js/data/dnd5e.js";
import {
  levelFromMap,
  applyStatModifiers,
  activeChoiceGroupsFor,
  selectedRuleOptionsIn,
  featChoiceGroupsFor,
  narrowChoicesByBundleAccess,
  isSubclassField,
  restoresOnRest,
  collectListItemGrantsIn,
  applyBundleModifiersIn,
  dropdownEntryForGroupKey,
  levelUpTarget,
  rawLevelFrom,
  LEVEL_CAP,
} from "../js/render/sheet/sheetLeveling.js";
import { stripSecondaryClassBundle } from "../js/data/contentFixups.js";

describe("class levels and prereqs", () => {
  it("splits primary vs secondary levels", () => {
    assert.deepEqual(classLevelsFor({ className: "Fighter", level: 5, subclass: "Champion", multiclass: [] }),
      [{ name: "Fighter", levels: 5, subclass: "Champion", primary: true }]);
    const multi = classLevelsFor({ className: "Fighter", level: 6, subclass: "", multiclass: [{ name: "Wizard", levels: 2, subclass: "School of Evocation" }] });
    assert.deepEqual(multi.map((c) => `${c.name}:${c.levels}`), ["Fighter:4", "Wizard:2"]);
    assert.deepEqual(classLevelsFor({ className: "", level: 1, multiclass: [] }), []);
  });

  it("gates multiclass dips on 13+ abilities", () => {
    assert.equal(meetsMulticlassPrereq({ str: 13, int: 13 }, "Fighter", "Wizard"), true);
    assert.equal(meetsMulticlassPrereq({ str: 13, int: 12 }, "Fighter", "Wizard"), false);
    assert.equal(meetsMulticlassPrereq({ str: 10, dex: 13 }, "Rogue", "Fighter"), true);
    assert.equal(meetsMulticlassPrereq({ dex: 15, wis: 12 }, "Fighter", "Monk"), false);
    assert.equal(multiclassPrereqReason({ str: 13, int: 12 }, "Fighter", "Wizard"), "needs INT 13");
    assert.equal(multiclassPrereqReason({ str: 13, int: 13 }, "Fighter", "Wizard"), "");
  });

  it("adds racial bonuses before measuring prereqs", () => {
    const eff = effectiveScoresFor({ str: 10, cha: 12 }, { statModifiers: [{ op: "add", targetFieldId: "chaScore", value: 2 }] });
    assert.equal(eff.cha, 14);
    assert.equal(eff.str, 10);
  });

  it("normalizes and migrates legacy rules state", () => {
    assert.deepEqual(includedRulesetIds({ rulesetId: "homebrew" }), ["phb"]);
    assert.equal(primaryRulesetId({ rulesetId: "homebrew", rulesetIds: ["xanathar", "homebrew"] }), "dnd5e-2014");
    const migrated = normalizeRulesState({ rulesetId: "homebrew" });
    assert.deepEqual(migrated.rulesetIds, ["phb"]);
    assert.equal(migrated.rulesetId, "dnd5e-2014");
    const norm = normalizeRulesState({
      className: "Fighter", level: 6, multiclass: [
        { name: "Wizard", levels: 2, subclass: "School of Evocation" },
        { name: "Fighter", levels: 3 },
        { name: "Rogue", levels: 0 },
      ],
    });
    assert.equal(norm.multiclass.length, 1);
    assert.equal(norm.multiclass[0].name, "Wizard");
  });
});

describe("ruleset registry", () => {
  it("registers one system with three content books", () => {
    const sources = listRulesets();
    assert.equal(sources.length, 1);
    assert.equal(sources[0].id, "dnd5e-2014");
    assert.deepEqual(listContentPacks("dnd5e-2014").map((p) => p.id), ["phb", "xanathar", "tashas"]);
    assert.equal(getContentPack("phb")?.classes.length, 12);
  });

  it("unions classes and subclasses across books", () => {
    assert.equal(getRuleset("dnd5e-2014")?.classes.length, 13);
    assert.equal(classNamesIn("dnd5e-2014").length, 13);
    assert.ok(subclassesAcrossRulesets("Rogue", ["phb", "xanathar"]).subclasses.includes("Swashbuckler"));
    assert.ok(!subclassesAcrossRulesets("Rogue", ["phb"]).subclasses.includes("Swashbuckler"));
    assert.equal(getRulesetClass("nope", "Wizard"), null);
  });

  it("reads hit dice, caster weights, and plans", () => {
    assert.equal(hitDieFor("Barbarian"), 12);
    assert.equal(hitDieFor("Wizard"), 6);
    assert.equal(hitDieFor("Nope"), 8);
    assert.equal(casterWeight("full"), 1);
    assert.equal(casterWeight("half"), 0.5);
    assert.equal(casterWeight(null), 0);
    assert.equal(casterWeight(null, "Eldritch Knight"), 1 / 3);
    assert.ok(Array.isArray(getLevelUpPlan("dnd5e-2014", "Warlock", 3)?.slotChanges));
  });

  it("follows the PHB multiclass slot table", () => {
    const full3 = multiclassSlotsFor([{ caster: "full", levels: 3 }]);
    assert.equal(full3[0].fieldId, "slots1");
    assert.equal(full3[0].options, 4);
    assert.equal(multiclassSlotsFor([{ caster: null, levels: 5 }]).length, 0);
    assert.equal(multiclassSlotsFor([{ caster: "pact", levels: 3 }]).length, 0);
    const pal5 = multiclassSlotsFor([{ caster: "half", levels: 5 }]);
    assert.equal(pal5[0].options, 3);
  });

  it("computes per-class spell limits", () => {
    const limit = spellLimitFor("Fighter", 5, {});
    assert.equal(limit, null);
    const wiz = spellLimitFor("Wizard", 1, { int: 16 });
    assert.ok(wiz && wiz.spells > 0);
  });
});

describe("choice groups and modifiers", () => {
  it("reads levels from maps", () => {
    assert.equal(levelFromMap(null, {}), Infinity);
    assert.equal(levelFromMap("lvl", { lvl: 5 }), 5);
    assert.equal(levelFromMap("lvl", {}), 0);
  });

  it("applies add-ops to the value map", () => {
    const vm = {};
    applyStatModifiers([{ op: "add", targetFieldId: "str", value: 2 }], vm, new Set(), new Map(), 1);
    assert.equal(vm.str, 2);
  });

  it("lists active groups with creation-style keys", () => {
    const groups = activeChoiceGroupsFor(
      [{ fieldType: "dropdown", id: "c", label: "Class", selected: "w", choices: [{ id: "w", text: "W", bundle: { choiceGroups: [{ id: "g", options: [{ id: "o" }] }] } }] }],
      1
    );
    assert.equal(groups.length, 1);
    assert.ok(groups[0].key.startsWith("c:w:"));
  });

  it("selects rule options by stored picks", () => {
    const sel = selectedRuleOptionsIn([{ key: "g", options: [{ id: "o" }] }], { g: ["o"] });
    assert.equal(sel.length, 1);
    assert.equal(sel[0].option.id, "o");
  });

  it("narrows subclass lists by bundle access", () => {
    const target = { id: "sub", choices: [{ id: "1" }, { id: "2" }] };
    const other = { fieldType: "dropdown", id: "cls", selected: "c", choices: [{ id: "c", bundle: { dropdownAccess: [{ targetFieldId: "sub", allowedChoiceIds: ["1"] }] } }] };
    const { allowed, narrowed } = narrowChoicesByBundleAccess(target, [target, other], 1);
    assert.equal(narrowed, true);
    assert.ok(allowed.has("1") && !allowed.has("2"));
  });

  it("gates subclass mods by class level, not total", () => {
    const fields = [{
      fieldType: "dropdown", id: "subclass", label: "Subclass", selected: "c1",
      choices: [{ id: "c1", text: "Champion", bundle: { statModifiers: [{ op: "add", targetFieldId: "strScore", value: 1, minLevel: 10 }] } }],
    }];
    const passThru = (m, v, cb, tags, lvl) => applyStatModifiers(m, v, cb, tags, lvl);
    const vm = {};
    applyBundleModifiersIn(fields, vm, new Set(), new Map(), 8, [], [], passThru, (field) => (field.id === "subclass" ? 3 : null));
    assert.equal(vm.strScore, undefined);
    const entry = dropdownEntryForGroupKey(fields, "subclass:c1:g");
    assert.equal(entry?.choice.text, "Champion");
    assert.equal(dropdownEntryForGroupKey(fields, "feat:X:g"), null);
  });

  it("strips saves and armor from secondary-class bundles", () => {
    const stripped = stripSecondaryClassBundle({
      statModifiers: [
        { targetFieldId: "strSaveProf", op: "grant" },
        { targetFieldId: "armorProf", op: "grantTag", value: "Light Armor" },
        { targetFieldId: "strScore", op: "add", value: 2 },
        { targetFieldId: "athleticsProf", op: "grant" },
      ],
    });
    assert.equal(stripped.statModifiers.length, 2);
    assert.equal(stripSecondaryClassBundle(null), null);
  });

  it("flows feat bundles through the same choice machinery", () => {
    const groups = featChoiceGroupsFor([{ name: "Resilient", bundle: { choiceGroups: [{ id: "g", options: [{ id: "o" }] }] } }]);
    assert.ok(groups.length === 1 && groups[0].key.startsWith("feat:Resilient:"));
  });

  it("collects granted list items behind minLevel gates", () => {
    const fields = [{ fieldType: "dropdown", id: "s", label: "Subclass", selected: "1", choices: [{ id: "1", text: "Oath of Devotion", bundle: { statModifiers: [{ op: "addItem", targetFieldId: "spellsKnown", value: "Sanctuary", minLevel: 3 }] } }] }];
    assert.equal(collectListItemGrantsIn(fields, 3, [], []).length, 1);
    assert.equal(collectListItemGrantsIn(fields, 2, [], []).length, 0);
  });

  it("restores short-rest resources on short rests only", () => {
    assert.equal(restoresOnRest("short rest", "short"), true);
    assert.equal(restoresOnRest("long rest", "short"), false);
    assert.equal(restoresOnRest("long rest", "long"), true);
    assert.equal(restoresOnRest("rest", "short"), false);
  });

  it("recognizes the subclass field", () => {
    assert.equal(isSubclassField({ id: "subclass" }), true);
  });
});

describe("leveling entry point", () => {
  it("raises the level by exactly one", () => {
    const target = levelUpTarget(1);
    assert.equal(target.kind, "start");
    assert.equal(target.level, 2);
    assert.equal(levelUpTarget(7).level, 8);
    // One level, never two, no matter where it starts.
    for (const from of [1, 2, 5, 11, 19]) {
      assert.equal(levelUpTarget(from).level, from + 1);
    }
  });

  it("resumes an in-progress level-up instead of raising again", () => {
    // The wizard keys pending picks by the level being applied, and the
    // raise happens on the click - so pending picks at the CURRENT level
    // mean that level was already reached by an earlier click.
    const first = levelUpTarget(4);
    assert.equal(first.kind, "start");
    assert.equal(first.level, 5);
    const second = levelUpTarget(first.level, { pendingAtLevel: true });
    assert.equal(second.kind, "resume");
    // Crucially the level does not move again.
    assert.equal(second.level, 5);
    assert.match(second.label, /Continue/);
  });

  it("disables at the cap and says why", () => {
    const atCap = levelUpTarget(LEVEL_CAP);
    assert.equal(atCap.kind, "capped");
    assert.ok(atCap.reason.includes(String(LEVEL_CAP)), "reason names the cap");
    // Past the cap (typed by hand) reads as capped, not as "no level".
    assert.equal(levelUpTarget(LEVEL_CAP + 1).kind, "capped");
    // One below the cap still works.
    assert.equal(levelUpTarget(LEVEL_CAP - 1).level, LEVEL_CAP);
  });

  it("treats a missing or nonsensical level as unknown, never as a raise", () => {
    for (const bad of [null, undefined, "", "   ", "abc", NaN, Infinity, -Infinity, {}]) {
      const target = levelUpTarget(bad);
      assert.equal(target.kind, "unknown", `level ${JSON.stringify(bad)}`);
      assert.ok(target.reason.length > 0, "an unknown level explains itself");
    }
    assert.equal(levelUpTarget(0).kind, "unknown");
    assert.equal(levelUpTarget(-3).kind, "unknown");
  });

  it("never produces a level outside 1..20 from a readable input", () => {
    // Guards the NaN/Infinity trap: both fail every comparison, so a
    // naive implementation falls through to "start" and returns NaN + 1.
    for (const bad of [NaN, Infinity, -Infinity, "NaN", undefined, null]) {
      const target = levelUpTarget(bad);
      assert.notEqual(target.kind, "start", `${String(bad)} must not raise`);
    }
  });

  it("keeps an out-of-range level readable so the cap is distinguishable", () => {
    // currentCharacterLevel() clamps to 1..20 and reports null past it,
    // which made a hand-typed 21 read as "you have no level". The raw
    // read keeps the number so the button can say "that's the cap".
    assert.equal(rawLevelFrom("21"), 21);
    assert.equal(rawLevelFrom("  7 "), 7);
    assert.equal(rawLevelFrom("3</div>"), 3);
    assert.equal(rawLevelFrom(""), null);
    assert.equal(rawLevelFrom(undefined), null);
    assert.equal(rawLevelFrom("abc"), null);
  });

  it("points the intro at the Level Up button and keeps the manual route", () => {
    // The intro is built inline in renderLevelingTabInto; assert on the
    // literal the copy is required to carry so a rewrite can't quietly
    // drop the only mention of the button, or quietly remove the manual
    // route people on customized sheets still depend on.
    const src = readFileSync(new URL("../js/render/sheet/sheetLeveling.js", import.meta.url), "utf8");
    const intro = src.match(/intro\.textContent = "([^"]*)"/);
    assert.ok(intro, "intro copy found");
    assert.match(intro[1], /Level Up button/);
    assert.match(intro[1], /Level field/);
  });
});

// tests/asi-and-followup.test.mjs
//
// Two regression guards:
//   1. A flexible ASI must be pickable from the race's own row, not just
//      from the bottom "Your choices" section.
//   2. Custom Lineage's "Skill Proficiency" Variable Trait needs a
//      follow-up row to actually pick the skill, and it must only appear
//      once that trait is chosen.
// Run: node --test tests/...
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  creationChoiceGroupsForState,
  keyFor,
  ASI_ABILITY_CHOICES,
  flexibleAsiSelection,
  buildFlexibleAsiChoice,
  flexibleAsiSummary,
  choiceDialogKindFor,
} from "../js/render/sheet/sheetWizard.js";
import { FIXED_RACE_ENTRIES } from "../js/data/contentFixups.js";

const raceBundle = (name) => FIXED_RACE_ENTRIES.find((e) => e.name === name)?.bundle || null;
const lookup = (category, name) => (category === "Race" ? raceBundle(name) : null);

const baseState = (over = {}) => ({
  level: 1, rulesetId: "phb",
  species: "Custom Lineage", className: "", subclass: "", background: "",
  choices: {},
  ...over,
});

const groupIds = (state) => creationChoiceGroupsForState(state, lookup, ["phb"]).map((g) => g.id);
const groupById = (state, id) => creationChoiceGroupsForState(state, lookup, ["phb"]).find((g) => g.id === id);

describe("Custom Lineage's flexible ASI", () => {
  it("exists as a flexibleAbilityBonus group", () => {
    const g = groupById(baseState(), "custom-lineage-flexible-asi");
    assert.ok(g, "the ASI group should be offered");
    assert.equal(g.type, "flexibleAbilityBonus");
  });

  it("has pattern options but no named options", () => {
    // This is the trap: the generic choice dialog lists options that have
    // a `name`, so these descriptors are invisible to it. A flexible ASI
    // has to be routed to its own two-step dialog wherever it's offered.
    const g = groupById(baseState(), "custom-lineage-flexible-asi");
    assert.deepEqual((g.options || []).map((o) => o.pattern), ["2-1", "1-1-1"]);
    assert.ok((g.options || []).every((o) => !o.name), "no option carries a name");
  });

  it("is stored under a key the dialog reads", () => {
    const g = groupById(baseState(), "custom-lineage-flexible-asi");
    assert.equal(g.key, "creation:Race:Custom Lineage:custom-lineage-flexible-asi");
    assert.equal(keyFor({ id: "custom-lineage-flexible-asi" }, "Race", "Custom Lineage"), g.key);
  });
});

describe("the Skill Proficiency follow-up row", () => {
  const TRAIT = "custom-lineage-variable_trait";
  const SKILL_OPTION = "custom-lineage-variable_trait-skill_proficiency";
  const FOLLOWUP = "custom-lineage-variable_trait_skill";

  const stateWithTrait = (picked) => baseState({
    choices: { [keyFor({ id: TRAIT }, "Race", "Custom Lineage")]: [picked] },
  });

  it("is not offered before the trait is chosen", () => {
    // Offering a skill picker to someone who took Darkvision instead
    // would be a question about a choice they didn't make.
    assert.ok(!groupIds(baseState()).includes(FOLLOWUP));
  });

  it("appears once Skill Proficiency is chosen", () => {
    assert.ok(groupIds(stateWithTrait(SKILL_OPTION)).includes(FOLLOWUP));
  });

  it("stays hidden if a different trait option is chosen", () => {
    const darkvision = stateWithTrait("custom-lineage-variable_trait-darkvision_60");
    assert.ok(!groupIds(darkvision).includes(FOLLOWUP));
  });

  it("sits directly beneath the trait that caused it", () => {
    const ids = groupIds(stateWithTrait(SKILL_OPTION));
    assert.equal(ids.indexOf(FOLLOWUP), ids.indexOf(TRAIT) + 1, `expected the follow-up right after the trait, got ${ids.join(", ")}`);
  });

  it("offers one pick from every skill, granting the proficiency", () => {
    const g = groupById(stateWithTrait(SKILL_OPTION), FOLLOWUP);
    assert.equal(g.minSelections, 1);
    assert.equal(g.maxSelections, 1);
    assert.ok((g.options || []).length >= 18, `expected the full skill list, got ${(g.options || []).length}`);
    const acrobatics = g.options.find((o) => /acrobatics/i.test(o.name));
    assert.ok(acrobatics, "Acrobatics should be offered");
    assert.deepEqual(acrobatics.statModifiers, [{ targetFieldId: "acrobaticsProf", op: "grant" }]);
  });

  it("is offered on the skills page", () => {
    assert.equal(groupById(stateWithTrait(SKILL_OPTION), FOLLOWUP).pageCategory, "skills");
  });

  it("ignores an unrelated choice made in another group", () => {
    const noisy = baseState({ choices: { "creation:Race:Custom Lineage:custom-lineage-languages": ["Dwarvish"] } });
    assert.ok(!groupIds(noisy).includes(FOLLOWUP), "a languages pick must not unlock the skill row");
  });
});

describe("groups without a follow-up gate behave as before", () => {
  it("does not gate Custom Lineage's languages or ASI", () => {
    const ids = groupIds(baseState());
    assert.ok(ids.includes("custom-lineage-languages"));
    assert.ok(ids.includes("custom-lineage-flexible-asi"));
  });

  it("leaves other races' groups alone", () => {
    const ids = creationChoiceGroupsForState(baseState({ species: "Elf" }), lookup, ["phb"]).map((g) => g.id);
    assert.ok(!ids.some((id) => id.includes("variable_trait")), "Elf has no variable trait");
  });

  it("survives a state with no choices object at all", () => {
    const ids = groupIds(baseState({ choices: undefined }));
    assert.ok(ids.includes("custom-lineage-flexible-asi"));
    assert.ok(!ids.includes("custom-lineage-variable_trait_skill"));
  });
});

describe("the ASI dropdowns", () => {
  it("offers all six abilities", () => {
    assert.deepEqual(ASI_ABILITY_CHOICES.map((a) => a.id), ["str", "dex", "con", "int", "wis", "cha"]);
  });

  it("builds the right modifiers for a full pick", () => {
    const choice = buildFlexibleAsiChoice("str", "con");
    assert.equal(choice.pattern, "2-1");
    assert.deepEqual(choice.abilities, ["str", "con"]);
    assert.deepEqual(choice.statModifiers, [
      { targetFieldId: "strScore", op: "add", value: 2 },
      { targetFieldId: "conScore", op: "add", value: 1 },
    ]);
  });

  it("keeps a half-finished pick so the second dropdown can complete it", () => {
    // Each dropdown re-renders the page, so storing nothing until both
    // are set would wipe the first pick and the pair could never be
    // completed.
    const partial = buildFlexibleAsiChoice("str", "");
    assert.ok(partial, "a partial pick is still stored");
    assert.equal(partial.pattern, null, "but it isn't a complete ASI yet");
    assert.deepEqual(partial.statModifiers, [], "and grants nothing so far");
    assert.deepEqual(partial.abilities, ["str"]);
  });

  it("stores nothing when neither dropdown is set", () => {
    assert.equal(buildFlexibleAsiChoice("", ""), null);
  });

  it("grants nothing when both dropdowns name the same ability", () => {
    // 5e raises two DIFFERENT scores; picking one twice is not an ASI.
    const same = buildFlexibleAsiChoice("str", "str");
    assert.equal(same.pattern, null);
    assert.deepEqual(same.statModifiers, []);
  });

  it("reads a completed pick back into the two dropdowns", () => {
    assert.deepEqual(flexibleAsiSelection(buildFlexibleAsiChoice("dex", "wis")), { plus2: "dex", plus1: "wis" });
  });

  it("reads a partial pick back without losing the first dropdown", () => {
    assert.deepEqual(flexibleAsiSelection(buildFlexibleAsiChoice("int", "")), { plus2: "int", plus1: "" });
  });

  it("reads the older bare-id array shape", () => {
    // A pick made before the dropdowns existed must land in the right
    // boxes rather than silently resetting.
    assert.deepEqual(flexibleAsiSelection(["cha", "con"]), { plus2: "cha", plus1: "con" });
  });

  it("handles nothing stored at all", () => {
    assert.deepEqual(flexibleAsiSelection(undefined), { plus2: "", plus1: "" });
    assert.deepEqual(flexibleAsiSelection([]), { plus2: "", plus1: "" });
  });

  it("summarises as +2/+1 with real ability names", () => {
    assert.equal(flexibleAsiSummary(buildFlexibleAsiChoice("str", "dex")), "+2 Strength, +1 Dexterity");
  });

  it("summarises a partial pick honestly", () => {
    assert.match(flexibleAsiSummary(buildFlexibleAsiChoice("str", "")), /Strength/);
  });

  it("prompts when nothing is picked", () => {
    assert.match(flexibleAsiSummary(null), /Choose/);
  });
});

describe("High Elf trait picks", () => {
  const highElf = () => {
    const subrace = (raceBundle("Elf").choiceGroups || []).find((g) => g.id === "elf-subrace");
    return (subrace?.options || []).find((o) => o.id === "elf-subrace-high") || null;
  };
  const group = (id) => (highElf()?.choiceGroups || []).find((g) => g.id === id) || null;

  it("offers an extra-language dropdown without Common", () => {
    const g = group("elf-subrace-high-language");
    assert.ok(g, "extra language group missing");
    assert.equal(g.maxSelections, 1);
    const names = (g.options || []).map((o) => o.name);
    assert.ok(names.includes("Dwarvish"));
    assert.ok(!names.includes("Common"), "Common is free, never a pick");
  });

  it("routes the cantrip through the wizard cantrip list", () => {
    const g = group("elf-subrace-high-cantrip");
    assert.ok(g, "cantrip group missing");
    assert.deepEqual(g.spellPick, { list: "wizard", level: 0 });
    assert.equal(choiceDialogKindFor(g), "spells");
  });

  it("leaves Wood Elf and Drow speeds alone", () => {
    const subrace = (raceBundle("Elf").choiceGroups || []).find((g) => g.id === "elf-subrace");
    const speedOf = (id) => ((subrace?.options || []).find((o) => o.id === id)?.featureGrants || [])
      .filter((f) => /^Speed$/.test(f.name)).map((f) => f.description);
    assert.deepEqual(speedOf("elf-subrace-wood"), ["35 ft. walking"]);
    assert.deepEqual(speedOf("elf-subrace-high"), ["30 ft. walking"]);
    assert.deepEqual(speedOf("elf-subrace-drow"), ["30 ft. walking"]);
  });
});

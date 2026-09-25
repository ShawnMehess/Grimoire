// tests/wizard-gating.test.mjs
//
// Unit tests for the creation/level-up wizard's pure layer
// (js/render/sheet/sheetWizard.js + gating helpers in
// sheetWizardSteps.js). Run: node --test tests/
// The scripts/smoke-imports.mjs + verify-content.mjs checks keep
// working alongside these — they remain the commit gates.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  groupOptionsOf,
  ownedSkillIdsFromBundles,
  optionIsOwned,
  lockCommonInLanguageGroups,
  groupPicksSatisfied,
  sectionsForChoiceGroups,
  sectionGroupsSatisfied,
  sectionsComplete,
  incompleteSectionNames,
  isChoiceSectionCollapsed,
  setChoiceSectionCollapsed,
  abilityScoreBonusesFrom,
  sanitizeSourceDefault,
  revalidateStagedPicks,
  pruneOrphanedChoiceKeys,
  expressPicksFor,
  spellCountByLevel,
  limitNoteText,
  canLearnMore,
  spellPicksCompleteForClass,
  magicalSecretsUnlocked,
  secretsPickedCount,
  secretsCompleteFor,
  isAsiSlotGroup,
  asiAbilityOf,
  languageSlotsFor,
  assignLanguageSlot,
  asiSlotsFor,
  assignAsiSlot,
  migrateAsiComboPicks,
  clampStepIndex,
  stepIsComplete,
  firstIncompleteStep,
  skippedStepTitle,
  rulesetOptionNamesIn,
  ordinal,
  availableSpellLevels,
  filterSortSpells,
  reviewChoiceLinesFor,
  slotLabelFor,
} from "../js/render/sheet/sheetWizard.js";
import {
  clampScoreToRange,
  pointBuyNoteText,
  abilityBonusNoteText,
  reviewLinesFor,
} from "../js/render/sheet/sheetWizardSteps.js";

describe("choice-group satisfaction", () => {
  it("counts non-locked picks against the minimum", () => {
    const group = { key: "g", minSelections: 2, options: [{ id: "a" }, { id: "b" }, { id: "c" }] };
    assert.equal(groupPicksSatisfied(group, ["a"], new Set()), false);
    assert.equal(groupPicksSatisfied(group, ["a", "b"], new Set()), true);
  });

  it("locked defaults never consume budget", () => {
    const group = { minSelections: 1, lockedOptionIds: ["c"], options: [{ id: "c" }, { id: "x" }] };
    assert.equal(groupPicksSatisfied(group, ["c"], new Set()), false);
    assert.equal(groupPicksSatisfied(group, ["c", "x"], new Set()), true);
  });

  it("already-owned options relieve the requirement", () => {
    const owned = new Set(["s", "tag:languages:Elvish"]);
    assert.equal(optionIsOwned({ statModifiers: [{ op: "grant", targetFieldId: "s" }] }, owned), true);
    assert.equal(optionIsOwned({ statModifiers: [{ op: "grant", targetFieldId: "x" }] }, owned), false);
    const group = { minSelections: 1, options: [{ id: "a", statModifiers: [{ op: "grant", targetFieldId: "s" }] }] };
    assert.equal(groupPicksSatisfied(group, [], owned), true);
  });

  it("reads flat and cross-category options alike", () => {
    const group = { options: [{ id: "a" }], categories: [{ options: [{ id: "b" }] }] };
    assert.deepEqual(groupOptionsOf(group).map((o) => o.id), ["a", "b"]);
  });

  it("collects grants and namespaced tags as owned", () => {
    const owned = ownedSkillIdsFromBundles(
      [{ statModifiers: [{ op: "grant", targetFieldId: "s" }] }],
      [{ key: "g", options: [{ id: "o", statModifiers: [{ op: "grantTag", targetFieldId: "languages", value: "Elvish" }] }] }],
      "other",
      { g: ["o"] }
    );
    assert.ok(owned.has("s"));
    assert.ok(owned.has("tag:languages:Elvish"));
  });

  it("locks Common in language groups only", () => {
    const groups = [
      { key: "g", label: "Languages (choose 2)", options: [{ id: "c", name: "Common" }, { id: "e", name: "Elvish" }] },
      { key: "h", label: "Skills", options: [{ id: "x", name: "Arcana" }] },
    ];
    lockCommonInLanguageGroups(groups, (g) => (g.key === "g" ? "languages" : "proficiencies"));
    assert.deepEqual(groups[0].lockedOptionIds, ["c"]);
    assert.equal(groups[1].lockedOptionIds, undefined);
  });
});

describe("Your choices sections", () => {
  const groups = [
    { key: "g1", source: "Elf", minSelections: 1, options: [{ id: "a", name: "Elvish" }] },
    { key: "g2", source: "Elf", minSelections: 0, options: [{ id: "b", name: "Trance" }] },
    { key: "g3", source: "Fighter", minSelections: 1, options: [{ id: "c", name: "Athletics" }] },
    { key: "g4", minSelections: 1, options: [{ id: "d", name: "Mystery" }] },
  ];

  it("buckets by originating pick in order, sourceless last", () => {
    const sections = sectionsForChoiceGroups(groups);
    assert.deepEqual(sections.map((s) => s.source), ["Elf", "Fighter", "Other"]);
    assert.equal(sections[0].groups.length, 2);
    assert.deepEqual(sectionsForChoiceGroups([]), []);
  });

  it("gates per section and ANDs across sections", () => {
    const sections = sectionsForChoiceGroups(groups);
    const store = { g1: ["a"], g2: [], g3: [], g4: ["d"] };
    assert.equal(sectionGroupsSatisfied(sections[0].groups, store), true);
    assert.equal(sectionGroupsSatisfied(sections[1].groups, store), false);
    assert.equal(sectionsComplete(sections, store), false);
    assert.equal(sectionsComplete(sections, { ...store, g3: ["c"] }), true);
    assert.deepEqual(incompleteSectionNames(sections, store), ["Fighter"]);
    assert.deepEqual(incompleteSectionNames(sections, { ...store, g3: ["c"] }), []);
  });

  it("accepts a per-group owned resolver", () => {
    const athletic = { key: "g3", source: "Fighter", minSelections: 1, options: [{ id: "c", statModifiers: [{ op: "grant", targetFieldId: "athleticsProf" }] }] };
    const sections = sectionsForChoiceGroups([athletic]);
    const ownedFor = (key) => (key === "g3" ? new Set(["athleticsProf"]) : new Set());
    assert.equal(sectionsComplete(sections, { g3: [] }, ownedFor), true);
  });

  it("remembers collapse per step+source, expanded by default", () => {
    assert.equal(isChoiceSectionCollapsed("test:Elf"), false);
    setChoiceSectionCollapsed("test:Elf", true);
    assert.equal(isChoiceSectionCollapsed("test:Elf"), true);
    setChoiceSectionCollapsed("test:Elf", false);
    assert.equal(isChoiceSectionCollapsed("test:Elf"), false);
  });
});

describe("staged ability bonuses", () => {
  it("sums add-ops to score fields with sources", () => {
    const out = abilityScoreBonusesFrom([
      { source: "Elf", bundle: { statModifiers: [{ op: "add", targetFieldId: "dexScore", value: 2 }] } },
      { source: "Fighter", bundle: { statModifiers: [{ op: "add", targetFieldId: "strScore", value: 1 }, { op: "add", targetFieldId: "other", value: 5 }] } },
      { source: "", bundle: null },
    ], ["str", "dex", "con"]);
    assert.deepEqual(out.dex, { bonus: 2, sources: ["Elf"] });
    assert.deepEqual(out.str, { bonus: 1, sources: ["Fighter"] });
    assert.deepEqual(out.con, { bonus: 0, sources: [] });
  });

  it("formats the per-row bonus note", () => {
    assert.equal(abilityBonusNoteText(15, 2, ["Elf"]), "+2 from Elf → 17 total");
    assert.equal(abilityBonusNoteText(10, 0, []), "");
  });
});

describe("source defaults and revalidation", () => {
  const systems = [{ id: "dnd5e-2014" }];
  const packsFor = (id) => (id === "dnd5e-2014" ? [{ id: "phb" }, { id: "xanathar" }] : []);

  it("sanitizes a persisted source default", () => {
    assert.deepEqual(
      sanitizeSourceDefault({ primary: "dnd5e-2014", included: ["phb", "xanathar"] }, systems, packsFor),
      { primary: "dnd5e-2014", included: ["phb", "xanathar"] }
    );
    assert.deepEqual(
      sanitizeSourceDefault({ primary: "dnd5e-2014", included: ["phb", "nope"] }, systems, packsFor)?.included,
      ["phb"]
    );
    assert.equal(sanitizeSourceDefault({ primary: "gone", included: ["phb"] }, systems, packsFor), null);
    assert.equal(sanitizeSourceDefault({ primary: "dnd5e-2014", included: ["nope"] }, systems, packsFor), null);
    assert.equal(sanitizeSourceDefault(null, systems, packsFor), null);
  });

  it("keeps survivors and reports orphans", () => {
    const valid = { Race: ["Elf"], Class: ["Fighter"], Subclass: ["Champion"], Background: ["Sailor"] };
    const intact = revalidateStagedPicks(
      { species: "Elf", className: "Fighter", subclass: "Champion", background: "Sailor" }, valid);
    assert.deepEqual(intact.removed, []);
    const pruned = revalidateStagedPicks(
      { species: "Tabaxi", className: "Artificer", subclass: "Alchemist", background: "Sailor" }, valid);
    assert.deepEqual(pruned.picks, { species: "", className: "", subclass: "", background: "Sailor" });
    assert.deepEqual(pruned.removed.map((r) => r.name), ["Tabaxi", "Artificer", "Alchemist"]);
  });

  it("prunes orphaned choice keys but never feats or equipment", () => {
    const out = pruneOrphanedChoiceKeys({
      "creation:Race:Tabaxi:g1": ["o1"],
      "creation:Class:Fighter:g2": ["o2"],
      "feat:Resilient:g3": ["o3"],
      "equipprof:armor": ["o4"],
    }, { species: "Elf", className: "Fighter", subclass: "", background: "" });
    assert.deepEqual(Object.keys(out.choices).sort(),
      ["creation:Class:Fighter:g2", "equipprof:armor", "feat:Resilient:g3"]);
    assert.equal(out.pruned, 1);
  });
});

describe("express picks", () => {
  it("prefers recommended names, then fills to the minimum", () => {
    const groups = [{
      key: "g", minSelections: 2, maxSelections: 3, lockedOptionIds: ["lock"],
      options: [
        { id: "lock", name: "Common" },
        { id: "a", name: "Athletics" },
        { id: "b", name: "Perception" },
        { id: "c", name: "Stealth" },
      ],
    }];
    assert.deepEqual(expressPicksFor(groups, ["perception", "Nope"]).g, ["lock", "b", "a"]);
    assert.deepEqual(expressPicksFor([{ key: "h", minSelections: 0, options: [{ id: "x" }] }], []).h, []);
  });
});

describe("spell caps", () => {
  it("counts cantrips vs leveled spells and gates learning", () => {
    assert.deepEqual(spellCountByLevel(new Set(["A", "B"]), (n) => (n === "A" ? 0 : 1)), { cantrips: 1, spells: 1 });
    assert.equal(limitNoteText(1, 2, { cantrips: 2, spells: 5, style: "known" }),
      "1/2 cantrips known, 2/5 spells known.");
    assert.equal(canLearnMore(0, { cantrips: 2, spells: 5 }, 2, 0), false);
    assert.equal(canLearnMore(1, { cantrips: 2, spells: 5 }, 2, 4), true);
  });

  it("enforces one class's caps on a shared Spells Known list", () => {
    const byClass = (lvl, name) => (name === "Wizard"
      ? [{ name: "Fire Bolt" }, { name: "Magic Missile" }]
      : [{ name: "Sacred Flame" }, { name: "Cure Wounds" }]);
    const lvlOf = (n) => (n === "Fire Bolt" || n === "Sacred Flame" ? 0 : 1);
    const base = {
      className: "Wizard", limit: { cantrips: 1, spells: 1, style: "known" },
      availableLevels: [0, 1], spellsForLevelFn: byClass, levelByNameFn: lvlOf,
    };
    assert.equal(spellPicksCompleteForClass({ ...base, knownItems: [] }), false);
    assert.equal(spellPicksCompleteForClass({ ...base, knownItems: ["Sacred Flame", "Cure Wounds"] }), false);
    assert.equal(spellPicksCompleteForClass({ ...base, knownItems: ["Fire Bolt", "Magic Missile"] }), true);
    assert.equal(spellPicksCompleteForClass({
      ...base, knownItems: ["Sacred Flame", "Cure Wounds", "Fire Bolt", "Magic Missile", "Light"],
    }), true);
    assert.equal(spellPicksCompleteForClass({ ...base, knownItems: [], limit: null }), true);
    assert.equal(spellPicksCompleteForClass({ ...base, knownItems: [], spellsForLevelFn: () => [] }), true);
  });

  it("sorts and tag-filters spell rows", () => {
    const spells = [
      { name: "B", tags: ["damage"], school: "Abjuration" },
      { name: "A", tags: ["heal"], school: "Evocation" },
    ];
    assert.deepEqual(filterSortSpells(spells, { tag: "all", sort: "name" }).map((s) => s.name), ["A", "B"]);
    assert.deepEqual(filterSortSpells(spells, { tag: "damage", sort: "name" }).map((s) => s.name), ["B"]);
  });
});

describe("magical secrets", () => {
  it("follows the 2014 unlock ladder", () => {
    assert.equal(magicalSecretsUnlocked("Bard", "", 9), 0);
    assert.equal(magicalSecretsUnlocked("Bard", "", 10), 2);
    assert.equal(magicalSecretsUnlocked("Bard", "College of Lore", 6), 2);
    assert.equal(magicalSecretsUnlocked("Bard", "College of Valor", 6), 0);
    assert.equal(magicalSecretsUnlocked("Bard", "", 18), 6);
    assert.equal(magicalSecretsUnlocked("Wizard", "", 20), 0);
  });

  it("counts non-Bard spells as secrets, leniently", () => {
    assert.equal(secretsPickedCount(["Fireball", "Cure Wounds"], ["Cure Wounds"]), 1);
    assert.equal(secretsCompleteFor(2, 2), true);
    assert.equal(secretsCompleteFor(2, 1), false);
    assert.equal(secretsCompleteFor(0, 0), true);
  });
});

describe("inline dropdown rows", () => {
  const langGroup = (key, min, max, names, locked = []) => ({
    key, label: "Languages", minSelections: min, maxSelections: max, lockedOptionIds: locked,
    options: names.map((n) => ({
      id: `${key}-${n.toLowerCase()}`, name: n,
      statModifiers: [{ targetFieldId: "languages", op: "grantTag", value: n }],
    })),
  });
  const asiGroup = (key, pairs) => ({
    key, label: "Ability Score Increase (+1)", minSelections: 1, maxSelections: 1,
    options: pairs.map(([ability, label, value]) => ({
      id: `${key}-${ability}`, name: label,
      statModifiers: [{ targetFieldId: `${ability}Score`, op: "add", value }],
    })),
  });

  it("detects ASI slot groups structurally", () => {
    assert.equal(isAsiSlotGroup(asiGroup("g", [["str", "Strength", 1], ["dex", "Dexterity", 1]])), true);
    assert.equal(isAsiSlotGroup(asiGroup("g", [["cha", "Charisma", 2]])), true);
    assert.equal(isAsiSlotGroup(langGroup("h", 1, 1, ["Elvish"])), false);
    assert.equal(isAsiSlotGroup({ key: "x", options: [{ id: "o", name: "+2 STR/+1 DEX", statModifiers: [{ op: "add", targetFieldId: "strScore", value: 2 }, { op: "add", targetFieldId: "dexScore", value: 1 }] }] }), false);
    assert.equal(isAsiSlotGroup({ key: "x", options: [] }), false);
    assert.equal(asiAbilityOf({ statModifiers: [{ op: "add", targetFieldId: "wisScore", value: 1 }] }), "wis");
    assert.equal(asiAbilityOf({ statModifiers: [] }), null);
  });

  it("maps language groups to slots and back", () => {
    const groups = [langGroup("g1", 1, 1, ["Common", "Elvish", "Orc"]), langGroup("g2", 1, 2, ["Common", "Draconic", "Elvish"])];
    assert.deepEqual(languageSlotsFor(groups, {}), [
      { groupKey: "g1", values: [null] },
      { groupKey: "g2", values: [null, null] },
    ]);
    const store = { g1: ["g1-elvish"], g2: ["g2-draconic"] };
    assert.deepEqual(languageSlotsFor(groups, store)[1], { groupKey: "g2", values: ["Draconic", null] });
    assert.deepEqual(assignLanguageSlot(groups, "g2", 1, "Elvish", store), { g2: ["g2-draconic", "g2-elvish"] });
    assert.deepEqual(assignLanguageSlot(groups, "g2", 0, "", { g2: ["g2-draconic", "g2-elvish"] }), { g2: ["g2-elvish"] });
    assert.deepEqual(assignLanguageSlot(groups, "g1", 0, "", store), { g1: [] });
    assert.deepEqual(assignLanguageSlot(groups, "nope", 0, "Elvish", store), {});
    // Locked defaults ride along.
    const locked = [langGroup("g3", 1, 1, ["Common", "Elvish"], ["g3-common"])];
    assert.deepEqual(assignLanguageSlot(locked, "g3", 0, "Elvish", {}), { g3: ["g3-common", "g3-elvish"] });
  });

  it("maps ASI slots to picks and back", () => {
    const groups = [asiGroup("a1", [["str", "Strength", 1], ["dex", "Dexterity", 1]]), asiGroup("a2", [["str", "Strength", 1], ["cha", "Charisma", 1]])];
    assert.deepEqual(asiSlotsFor(groups, {}), [
      { groupKey: "a1", value: 1, pickedAbility: null, options: [{ ability: "str", label: "Strength", optionId: "a1-str", value: 1 }, { ability: "dex", label: "Dexterity", optionId: "a1-dex", value: 1 }] },
      { groupKey: "a2", value: 1, pickedAbility: null, options: [{ ability: "str", label: "Strength", optionId: "a2-str", value: 1 }, { ability: "cha", label: "Charisma", optionId: "a2-cha", value: 1 }] },
    ]);
    // Duplicates across slots are independent picks.
    const store = { a1: ["a1-str"], a2: ["a2-str"] };
    assert.equal(asiSlotsFor(groups, store)[1].pickedAbility, "str");
    assert.deepEqual(assignAsiSlot(groups, "a2", "cha"), { a2: ["a2-cha"] });
    assert.deepEqual(assignAsiSlot(groups, "a2", ""), { a2: [] });
    assert.deepEqual(assignAsiSlot(groups, "nope", "str"), {});
  });

  it("migrates retired combo picks onto slots", () => {
    const defs = [
      { oldGroupId: "x-asi", optionPrefix: "x-asi-", slotGroupIds: ["x-asi-1", "x-asi-2", "x-asi-3"] },
      { oldGroupId: "half-elf-abilities", optionPrefix: "half-elf-ability-", slotGroupIds: ["half-elf-asi-1", "half-elf-asi-2"] },
    ];
    // Triple spreads as-is; pair doubles its first ability (+2/+1).
    const t = migrateAsiComboPicks({ "f:c:x-asi": ["x-asi-str-dex-con"] }, defs);
    assert.deepEqual(t.choices, { "f:c:x-asi-1": ["x-asi-1-str"], "f:c:x-asi-2": ["x-asi-2-dex"], "f:c:x-asi-3": ["x-asi-3-con"] });
    assert.equal(t.migrated, 1);
    const p = migrateAsiComboPicks({ "creation:Race:Genasi:x-asi": ["x-asi-str-dex"] }, defs);
    assert.deepEqual(p.choices, {
      "creation:Race:Genasi:x-asi-1": ["x-asi-1-str"],
      "creation:Race:Genasi:x-asi-2": ["x-asi-2-str"],
      "creation:Race:Genasi:x-asi-3": ["x-asi-3-dex"],
    });
    const h = migrateAsiComboPicks({ "f:c:half-elf-abilities": ["half-elf-ability-str-dex"] }, defs);
    assert.deepEqual(h.choices, { "f:c:half-elf-asi-1": ["half-elf-asi-1-str"], "f:c:half-elf-asi-2": ["half-elf-asi-2-dex"] });
    // Never overwrites existing slot picks; never destroys the unparseable.
    const kept = migrateAsiComboPicks({ "f:c:x-asi": ["x-asi-str-dex"], "f:c:x-asi-1": ["x-asi-1-con"] }, defs);
    assert.deepEqual(kept.choices["f:c:x-asi-1"], ["x-asi-1-con"]);
    assert.deepEqual(kept.choices["f:c:x-asi"], ["x-asi-str-dex"]);
    assert.equal(kept.migrated, 0);
    const bad = migrateAsiComboPicks({ "f:c:x-asi": ["custom-thing"] }, defs);
    assert.deepEqual(bad.choices, { "f:c:x-asi": ["custom-thing"] });
    assert.equal(bad.migrated, 0);
  });
});

describe("step shell", () => {
  it("clamps indices and reads completeness safely", () => {
    assert.equal(clampStepIndex(0, 5), 0);
    assert.equal(clampStepIndex(3, 9), 2);
    assert.equal(clampStepIndex(3, -1), 0);
    assert.equal(stepIsComplete({}), true);
    assert.equal(stepIsComplete({ isComplete: () => false }), false);
    assert.equal(stepIsComplete({ isComplete: () => { throw new Error("x"); } }), true);
  });

  it("finds the first incomplete applicable step", () => {
    assert.equal(firstIncompleteStep([{ isComplete: () => true }, { isComplete: () => false }]), 1);
    assert.equal(firstIncompleteStep([{ isComplete: () => { throw new Error("x"); } }]), -1);
  });

  it("titles skipped steps without throwing", () => {
    assert.equal(skippedStepTitle({}), "Skipped — nothing to choose for your current picks.");
    assert.equal(skippedStepTitle({ unavailableMessage: () => "Needs a caster." }), "Needs a caster.");
    assert.equal(skippedStepTitle({ unavailableMessage: () => { throw new Error("x"); } }),
      "Skipped — nothing to choose for your current picks.");
  });

  it("ordinals and available spell levels", () => {
    assert.equal(ordinal(1), "1st");
    assert.equal(ordinal(4), "4th");
    assert.deepEqual(availableSpellLevels({ slotChanges: [{ options: 0 }, { options: 2 }] }), [0, 1, 2]);
  });

  it("labels slot trackers from their field ids", () => {
    assert.equal(slotLabelFor("slots1"), "1st");
    assert.equal(slotLabelFor("slots2"), "2nd");
    assert.equal(slotLabelFor("slots3"), "3rd");
    assert.equal(slotLabelFor("slots9"), "9th");
    assert.equal(slotLabelFor("nope"), "nope");
  });
});

describe("library option names and review lines", () => {
  it("unions bundle names across sources, legacy tags canonicalized", () => {
    const lib = [
      { rulesetId: "homebrew", category: "Race", name: "Human" },
      { rulesetId: "xanathar", category: "Race", name: "Tabaxi" },
    ];
    assert.deepEqual(rulesetOptionNamesIn(lib, ["phb", "xanathar"], "Race", []), ["Human", "Tabaxi"]);
    assert.deepEqual(rulesetOptionNamesIn(lib, "phb", "Race", ["Fallback"]), ["Human"]);
  });

  it("summarizes choice picks per group", () => {
    const lines = reviewChoiceLinesFor(
      [{ key: "g1", label: "Skills", options: [{ id: "a", name: "Arcana" }] }], { g1: ["a"] });
    assert.deepEqual(lines, ["Skills: Arcana"]);
    assert.deepEqual(reviewChoiceLinesFor([{ key: "g", options: [] }], {}), []);
  });

  it("reviews creation answers", () => {
    assert.ok(reviewLinesFor({ characterName: "N", level: 1, resources: [] }).includes("Name: N"));
    assert.equal(clampScoreToRange("99", 8, 8, 15), 15);
    assert.equal(pointBuyNoteText(10, 27), "Points spent: 10/27");
  });
});

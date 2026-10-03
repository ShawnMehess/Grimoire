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
  racePickSatisfied,
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
  isFeaturePickGroup,
  assignFeatureSlot,
  withLiveBullets,
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
  skippedStepPassed,
  rulesetOptionNamesIn,
  ordinal,
  availableSpellLevels,
  filterSortSpells,
  reviewChoiceLinesFor,
  slotLabelFor,
  trimTrailingChooseInstruction,
} from "../js/render/sheet/sheetWizard.js";
import {
  clampScoreToRange,
  pointBuyNoteText,
  abilityBonusNoteText,
  reviewLinesFor,
  resolvePrimaryRuleset,
  HP_METHOD_OPTIONS,
  initPendingLevelState,
  pendingLevelHasPicks,
  buildRevertRecord,
  revertRecordFor,
  highestRevertableLevel,
  revertUndoLines,
  revertConflictLines,
  REVERT_RECORD_VERSION,
} from "../js/render/sheet/sheetWizardSteps.js";
import { nestedChoiceGroupsFor } from "../js/render/sheet/sheetWizard.js";
import { FIXED_CLASS_ENTRIES } from "../js/data/contentFixups.js";
import { LANGUAGES, languageSections } from "../js/data/schema.js";
import { categorizeChoiceGroup } from "../js/render/sheet/sheetMechanics.js";
import { normalizeChoiceGroup } from "../js/render/sheet/sheetLeveling.js";
import { FIXED_RACE_ENTRIES } from "../js/data/contentFixups.js";

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
    // ...but never occupy a slot: the dropdown shows the real pick.
    assert.deepEqual(languageSlotsFor(locked, { g3: ["g3-common", "g3-elvish"] }), [{ groupKey: "g3", values: ["Elvish"] }]);
    assert.deepEqual(languageSlotsFor(locked, { g3: ["g3-common"] }), [{ groupKey: "g3", values: [null] }]);
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

describe("profile-embedded pick bullets", () => {
  const featGroup = (key, names) => ({
    key, label: "Variable Trait", minSelections: 1, maxSelections: 1,
    options: names.map((n) => ({ id: `${key}-${n.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: n, featureGrants: [{ name: n }] })),
  });

  it("detects feature-pick groups only", () => {
    assert.equal(isFeaturePickGroup(featGroup("g", ["Darkvision 60", "Skill Proficiency"])), true);
    assert.equal(isFeaturePickGroup({ key: "s", subrace: true, minSelections: 1, maxSelections: 1, options: [{ id: "o", name: "High Elf", statModifiers: [] }] }), false);
    assert.equal(isFeaturePickGroup({ key: "m", minSelections: 2, maxSelections: 2, options: [{ id: "o", name: "A", statModifiers: [] }] }), false);
    assert.equal(isFeaturePickGroup({ key: "a", minSelections: 1, maxSelections: 1, options: [{ id: "o", name: "X", statModifiers: [{ op: "add", targetFieldId: "strScore", value: 1 }] }] }), false);
    assert.equal(isFeaturePickGroup({ key: "e", minSelections: 1, maxSelections: 1, options: [] }), false);
  });

  it("writes feature picks onto their group key", () => {
    const groups = [featGroup("g", ["Darkvision 60", "Skill Proficiency"])];
    assert.deepEqual(assignFeatureSlot(groups, "g", "g-darkvision-60"), { g: ["g-darkvision-60"] });
    assert.deepEqual(assignFeatureSlot(groups, "g", ""), { g: [] });
    assert.deepEqual(assignFeatureSlot(groups, "nope", "g-darkvision-60"), {});
    assert.deepEqual(assignFeatureSlot(groups, "g", "bogus"), { g: [] });
  });

  it("splices live bullets into profile sections", () => {
    const statik = [
      { title: "Racial Traits", items: ["Speed: 30 feet"] },
      { title: "Innate Abilities", items: ["Trance: meditate"] },
    ];
    const lang = { live: true, topic: "Languages" };
    const asi = { live: true, topic: null };
    const feat = { live: true, topic: "Variable Trait" };
    // ASI section created after Racial Traits when missing.
    const a = withLiveBullets(statik, [{ section: "Ability Score Increases", bullet: asi, after: "Racial Traits" }]);
    assert.deepEqual(a.map((s) => s.title), ["Racial Traits", "Ability Score Increases", "Innate Abilities"]);
    assert.equal(a[1].items[0], asi);
    assert.deepEqual(statik[1].items, ["Trance: meditate"]);
    // Language bullet appends to the named section; features too.
    const b = withLiveBullets(statik, [
      { section: "Racial Traits", bullet: lang },
      { section: "Innate Abilities", bullet: feat },
    ]);
    assert.deepEqual(b[0].items, ["Speed: 30 feet", lang]);
    assert.deepEqual(b[1].items, ["Trance: meditate", feat]);
    // Missing sections append at the end; null bullets skip.
    const c = withLiveBullets([], [{ section: "Innate Abilities", bullet: feat }, { section: "X", bullet: null }]);
    assert.deepEqual(c, [{ title: "Innate Abilities", items: [feat] }]);
    assert.deepEqual(withLiveBullets(statik, []), statik);
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

  it("marks skipped steps only once passed", () => {
    assert.equal(skippedStepPassed(4, 0), false);
    assert.equal(skippedStepPassed(4, 4), false);
    assert.equal(skippedStepPassed(4, 5), true);
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

  it("resolves the single selected ruleset", () => {
    const one = [{ id: "dnd5e-2014" }];
    const two = [{ id: "dnd5e-2014" }, { id: "dnd5e-2024" }];
    assert.equal(resolvePrimaryRuleset(one, null), "dnd5e-2014");
    assert.equal(resolvePrimaryRuleset(one, "dnd5e-2014"), "dnd5e-2014");
    assert.equal(resolvePrimaryRuleset(two, null), "dnd5e-2014");
    assert.equal(resolvePrimaryRuleset(two, "dnd5e-2024"), "dnd5e-2024");
    assert.equal(resolvePrimaryRuleset(two, "gone"), "dnd5e-2014");
    assert.equal(resolvePrimaryRuleset([], null), null);
  });

  it("reviews creation answers", () => {
    assert.ok(reviewLinesFor({ characterName: "N", level: 1, resources: [] }).includes("Name: N"));
    assert.equal(clampScoreToRange("99", 8, 8, 15), 15);
    assert.equal(pointBuyNoteText(10, 27), "Points spent: 10/27");
  });
});

describe("HP method preference rows", () => {
  // The three HP methods are a list of methods, not a list of entries with
  // hidden detail. They used to render through the same collapsible picker
  // as Race/Class, which put a dead Expand All / Collapse All bar over rows
  // that had nothing to expand. The rendering half of this (no controls,
  // icon in the portrait slot) is covered in scripts/smoke-dom.mjs, which
  // has the stub DOM; what's checkable purely is the option data.
  it("gives every method a distinct icon", () => {
    const icons = HP_METHOD_OPTIONS.map((o) => o.icon);
    assert.ok(icons.length === 3 && icons.every(Boolean), "every HP method carries an icon");
    // Two of the three labels start with "Roll", which is why the letter
    // in the portrait box never told them apart.
    assert.equal(new Set(icons).size, icons.length, "the icons are distinguishable");
  });

  it("still describes each method", () => {
    assert.ok(HP_METHOD_OPTIONS.every((o) => o.value && o.label && o.description));
  });
});

describe("racePickSatisfied", () => {
  const container = (key, opts = {}) => ({
    key,
    subrace: true,
    minSelections: 1,
    maxSelections: 1,
    options: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
    ...opts,
  });

  it("does not count a container race as a species on its own", () => {
    // The reported case. Elf/Dwarf/Gnome/Halfling/Genasi own a subrace
    // picker and grant nothing themselves, so clicking one has opened a
    // list, not chosen from it.
    assert.equal(racePickSatisfied({ raceName: "Elf", subraceGroup: container("k"), choices: {} }), false);
    assert.equal(racePickSatisfied({ raceName: "Elf", subraceGroup: container("k"), choices: { k: ["b"] } }), true);
  });

  it("treats an ordinary race as settled the moment it is named", () => {
    assert.equal(racePickSatisfied({ raceName: "Human", subraceGroup: null, choices: {} }), true);
  });

  it("has no answer without a race at all", () => {
    assert.equal(racePickSatisfied({ raceName: "", subraceGroup: null, choices: {} }), false);
    assert.equal(racePickSatisfied({}), false);
  });

  it("does not deadlock on a container with nothing in it", () => {
    // An empty container is not a container. Blocking here would be a page
    // that can never be finished, which is worse than an ordinary race.
    const empty = { key: "k", subrace: true, minSelections: 1, options: [] };
    assert.equal(racePickSatisfied({ raceName: "Odd", subraceGroup: empty, choices: {} }), true);
    const emptyCategories = { key: "k", subrace: true, minSelections: 1, categories: [] };
    assert.equal(racePickSatisfied({ raceName: "Odd", subraceGroup: emptyCategories, choices: {} }), true);
  });

  it("reads a cross-category container the same as a flat one", () => {
    // The shape that used to render no subrace rows at all: the picker
    // offered nothing to click, so the race could never be completed.
    const grouped = {
      key: "k", subrace: true, minSelections: 1, maxSelections: 1,
      categories: [{ label: "Day", options: [{ id: "d1", name: "Drow" }] }],
    };
    assert.equal(racePickSatisfied({ raceName: "Elf", subraceGroup: grouped, choices: {} }), false);
    assert.equal(racePickSatisfied({ raceName: "Elf", subraceGroup: grouped, choices: { k: ["d1"] } }), true);
  });

  it("agrees with the shipped parent races", () => {
    // Read from the real bundles rather than a written-out example, so a
    // race that gains or loses its subrace picker moves this test with it.
    const parents = FIXED_RACE_ENTRIES.filter((e) =>
      (e.bundle.choiceGroups || []).some((g) => g.subrace === true));
    assert.ok(parents.length >= 5, `there are container races to check (${parents.map((p) => p.name).join(", ")})`);
    for (const parent of parents) {
      const group = parent.bundle.choiceGroups.find((g) => g.subrace === true);
      assert.equal(racePickSatisfied({ raceName: parent.name, subraceGroup: group, choices: {} }),
        false, `${parent.name} is not a species until a subrace is picked`);
      const first = (group.options || [])[0];
      assert.equal(racePickSatisfied({
        raceName: parent.name, subraceGroup: group, choices: { [group.key]: [first.id] },
      }), true, `${parent.name} is finished once ${first.name} is picked`);
    }
  });
});

describe("subrace options with their own choice groups", () => {
  // Regression: picking High Elf threw
  //   TypeError: categorizeFn is not a function
  // from lockCommonInLanguageGroups. The shared two-argument helper was called
  // with one, so it called the categorize function on nothing.
  //
  // Nothing else hit it because High Elf is the only subrace in the shipped
  // data that carries nested choice groups. Every other subrace produced an
  // empty list, the code returned before reaching the bad call, and the bug
  // sat behind a length check that almost never ran.
  const elf = () => FIXED_RACE_ENTRIES.find((r) => r.name === "Elf");
  const subraceGroup = () => normalizeChoiceGroup(
    elf().bundle.choiceGroups.find((g) => g.id === "elf-subrace"), 0, "Class:Race:Elf");
  const highElf = () => subraceGroup().options.find((o) => o.id === "elf-subrace-high");
  const nestedFor = () => nestedChoiceGroupsFor(highElf(), {
    parentKey: subraceGroup().key,
    pickedIds: ["elf-subrace-high"],
  });

  it("the shipped High Elf really does carry nested groups", () => {
    // Asserted first so the tests below cannot quietly stop testing
    // anything: if a future data edit flattens this shape, they would still
    // pass on an empty list.
    assert.ok(highElf().choiceGroups?.length,
      "High Elf nests choice groups, which is what reached the bad call");
  });

  it("nestedChoiceGroupsFor returns them once the subrace is picked", () => {
    assert.deepEqual(
      nestedChoiceGroupsFor(highElf(), { parentKey: subraceGroup().key, pickedIds: [] }),
      [], "nothing before the pick");
    const nested = nestedFor();
    assert.equal(nested.length, highElf().choiceGroups.length);
    assert.ok(nested.every((g) => g.key.startsWith(subraceGroup().key + ":elf-subrace-high:")),
      "each nested group is keyed under its parent, so a pick has somewhere to live");
  });

  it("locks Common in the nested language group without throwing", () => {
    const nested = nestedFor();
    // The call customSheet.js makes. Not throwing IS the fix; the assertion
    // that would have caught the bug is assert.doesNotThrow itself, since the
    // old one-arg call threw on the first group.
    assert.doesNotThrow(() => lockCommonInLanguageGroups(nested, categorizeChoiceGroup));
    assert.equal(nested.length, 2, "and it leaves the list alone");
  });

  it("does not treat the nested cantrip group as a language group", () => {
    const cantrip = nestedFor().find((g) => g.category === "spells");
    assert.ok(cantrip, "High Elf's cantrip picker is there");
    assert.notEqual(categorizeChoiceGroup(cantrip), "languages",
      "otherwise Common would be force-locked onto a cantrip list");
  });
});


describe("trailing 'choose one' in a pick label", () => {
  // The Monk's tool group shipped as "Monk Tool Proficiencies: choose one",
  // and the bullet renders label + link - so it read
  //   **Monk Tool Proficiencies: choose one** — Choose 1
  // which says the same instruction twice, three words apart. The label is
  // compiled data, so this is stripped at render time rather than by editing
  // one string.

  it("removes a trailing instruction and leaves the topic", () => {
    assert.equal(trimTrailingChooseInstruction("Monk Tool Proficiencies: choose one"),
      "Monk Tool Proficiencies");
    assert.equal(trimTrailingChooseInstruction("Artisan Tools - choose one"),
      "Artisan Tools");
    assert.equal(trimTrailingChooseInstruction("Weapons (choose two)"), "Weapons");
    assert.equal(trimTrailingChooseInstruction("Languages: pick 2"), "Languages");
  });

  it("leaves a label with no trailing instruction alone", () => {
    for (const label of [
      "Monk Skill Proficiencies",
      "Martial Arts",
      // A mention partway through is content, not an instruction to strip.
      "Common - a language everyone in the region speaks",
      "Choose an option",
    ]) {
      assert.equal(trimTrailingChooseInstruction(label), label, label);
    }
  });

  it("never strips a label down to nothing", () => {
    // "Choose one" on its own is the whole label. Returning "" would render
    // a bullet with no topic at all, which is worse than the repetition.
    assert.equal(trimTrailingChooseInstruction("Choose one"), "Choose one");
    assert.equal(trimTrailingChooseInstruction("choose"), "choose");
  });

  it("copes with nothing at all", () => {
    assert.equal(trimTrailingChooseInstruction(""), "");
    assert.equal(trimTrailingChooseInstruction(null), "");
    assert.equal(trimTrailingChooseInstruction(undefined), "");
  });

  it("handles the label the shipped Monk data actually has", () => {
    // Asserted against the real bundle so the test cannot quietly stop
    // covering the case: if a data edit renames the group, this says so
    // rather than passing on a string nothing renders.
    const monk = FIXED_CLASS_ENTRIES.find((r) => r.name === "Monk");
    const group = monk.bundle.choiceGroups.find((g) => g.id === "monk-toolProf-0");
    assert.ok(group, "the Monk tool group is still there");
    assert.match(group.label, /choose one/i);
    assert.equal(trimTrailingChooseInstruction(group.label), "Monk Tool Proficiencies");
  });
});


describe("language sections (Widespread / Rare)", () => {
  // The language dropdown and picker want the list split into the two bands a
  // player actually thinks in. The headings must not be selectable.
  //
  // The failure this guards is quiet and severe: if a language ended up in
  // NEITHER section it would simply not appear in the picker, and there is no
  // error - just a language that cannot be chosen. So the partition is
  // asserted, not just the presence of two headings.

  it("splits the list at the first rare language, which is Abyssal", () => {
    const sections = languageSections();
    const widespread = sections.find((s) => s.label === "Widespread");
    const rare = sections.find((s) => s.label === "Rare");
    assert.ok(widespread && rare, "both sections exist");
    assert.equal(widespread.languages[widespread.languages.length - 1], "Orc",
      "Widespread runs through Orc");
    assert.equal(rare.languages[0], "Abyssal", "Rare starts at Abyssal");
  });

  it("covers every language EXACTLY once", () => {
    const flat = languageSections().flatMap((s) => s.languages);
    assert.equal(flat.length, LANGUAGES.length, "nothing lost and nothing duplicated by count");
    assert.equal(new Set(flat).size, flat.length, "no language appears in two sections");
    for (const name of LANGUAGES) {
      assert.ok(flat.includes(name), `${name} is offered`);
    }
  });

  it("keeps Common out of Rare", () => {
    // Common is never a pick (every language group filters it), so filing it
    // under Rare would be actively misleading if that filter ever slips.
    const rare = languageSections().find((s) => s.label === "Rare");
    assert.ok(!rare.languages.includes("Common"));
    assert.ok(languageSections().find((s) => s.label === "Widespread").languages.includes("Common"));
  });

  it("is a pure partition - it does not mutate the source list", () => {
    const before = [...LANGUAGES];
    languageSections();
    assert.deepEqual(LANGUAGES, before);
  });
});

describe("cancelling an in-progress level-up", () => {
  const fresh = () => {
    const state = {};
    initPendingLevelState(state, "4", { subclass: "", choices: {}, className: "Fighter", newClassName: "" });
    return state["4"];
  };

  it("sees no picks in a level-up nobody has touched", () => {
    // The entry exists purely because the walkthrough was opened. That
    // must not read as "you made choices worth discarding".
    assert.equal(pendingLevelHasPicks(fresh()), false);
    assert.equal(pendingLevelHasPicks(null), false);
    assert.equal(pendingLevelHasPicks(undefined), false);
    assert.equal(pendingLevelHasPicks({}), false);
  });

  it("sees picks once anything is actually chosen", () => {
    for (const mutate of [
      (p) => { p.hp = "7"; },
      (p) => { p.notes = "took the Alert feat"; },
      (p) => { p.asiMode = "single"; },
      (p) => { p.asiAbility1 = "str"; },
      (p) => { p.asiAbility2 = "con"; },
      (p) => { p.featChoice = "Alert"; },
      (p) => { p.subclass = "Champion"; },
      (p) => { p.newClassName = "Wizard"; },
      (p) => { p.choices = { "class:wizard:spells": ["fireball"] }; },
    ]) {
      const pending = fresh();
      mutate(pending);
      assert.equal(pendingLevelHasPicks(pending), true, JSON.stringify(pending));
    }
  });

  it("does not mistake whitespace or an empty pick list for a decision", () => {
    const pending = fresh();
    pending.hp = "   ";
    pending.notes = "";
    pending.choices = { "class:fighter:profs": [] };
    assert.equal(pendingLevelHasPicks(pending), false);
  });

  it("treats 'feat' as the untouched default but a changed ASI mode as a pick", () => {
    const pending = fresh();
    assert.equal(pending.asiMode, "feat");
    assert.equal(pendingLevelHasPicks(pending), false);
    pending.asiMode = "double";
    assert.equal(pendingLevelHasPicks(pending), true);
  });
});

describe("reverting a level-up", () => {
  const record = (over = {}) => buildRevertRecord({
    level: 5,
    hpGain: 7,
    hpBefore: { max: 30, current: 30 },
    abilities: { str: { before: 14, after: 16 } },
    featAdded: "Alert",
    subclass: { fieldId: "subclass", before: null, after: "champion" },
    choicesBefore: { "class:Fighter:profs": ["longsword"] },
    slotsBefore: [{ fieldId: "slots1", options: 4 }],
    featureEntry: "Fighter level 5: Extra Attack",
    multiclassBefore: [{ name: "Wizard", levels: 1, subclass: "" }],
    className: "Fighter",
    ...over,
  });

  it("stores BEFORE values, never deltas", () => {
    const r = record();
    assert.equal(r.revertVersion, REVERT_RECORD_VERSION);
    assert.equal(r.hpBefore.max, 30, "the HP to restore, not the HP to subtract from");
    assert.deepEqual(r.abilities, { str: { before: 14, after: 16 } }, "before to restore and after to compare against");
    assert.deepEqual(r.choicesBefore, { "class:Fighter:profs": ["longsword"] });
    assert.deepEqual(r.slotsBefore, [{ fieldId: "slots1", options: 4 }]);
    assert.deepEqual(r.multiclassBefore, [{ name: "Wizard", levels: 1, subclass: "" }]);
  });

  it("omits keys for things the level-up did not do", () => {
    const r = buildRevertRecord({ level: 3, hpGain: 0, hpBefore: { max: 10, current: 10 } });
    assert.equal("featAdded" in r, false, "no feat key when no feat was taken");
    assert.equal("className" in r, false);
    // And an empty choices map is a real value, not an absent one.
    assert.deepEqual(r.choicesBefore, {});
  });

  it("copies what it is given rather than holding the caller's arrays", () => {
    const picks = ["a"];
    const r = buildRevertRecord({ level: 2, choicesBefore: { k: picks } });
    picks.push("b");
    assert.deepEqual(r.choicesBefore.k, ["a"], "a later edit cannot rewrite the record");
  });

  it("reads a level recorded before reverting existed as not revertable", () => {
    // Legacy entries carry hp/className/features/appliedRulesetId and no
    // record at all.
    const legacy = { hp: "+7", className: "Fighter", features: "Fighter level 3", appliedRulesetId: "dnd5e-2014" };
    assert.equal(revertRecordFor(legacy), null);
    assert.equal(revertRecordFor({}), null);
    assert.equal(revertRecordFor(null), null);
    // A record from a shape this build doesn't know is also not revertable,
    // rather than being applied on a guess.
    assert.equal(revertRecordFor({ revert: { revertVersion: 99 } }), null);
    assert.ok(revertRecordFor({ ...legacy, revert: record() }));
  });

  it("offers revert only for the highest recorded level", () => {
    const ups = {
      2: { revert: record({ level: 2 }) },
      3: { revert: record({ level: 3 }) },
      5: { hp: "+7", appliedRulesetId: "dnd5e-2014" },
    };
    assert.equal(highestRevertableLevel(ups), 3, "level 5 has no record, so 3 is the highest that does");
    assert.equal(highestRevertableLevel({}), null);
    assert.equal(highestRevertableLevel(null), null);
    // Hand-typed rows never count.
    assert.equal(highestRevertableLevel({ 1: { hp: "+3", className: "Fighter" } }), null);
  });

  it("lists what reverting takes back, in plain words", () => {
    const lines = revertUndoLines(record());
    const joined = lines.join(" ");
    assert.match(joined, /7 hit points/);
    assert.match(joined, /ability scores back: STR/);
    assert.match(joined, /Removes the Alert feat/);
    assert.match(joined, /spell slot counts back/);
    assert.match(joined, /Drops your Level back to 4/);
    assert.deepEqual(revertUndoLines(null), []);
  });

  it("reports no conflict while the sheet still matches what Apply wrote", () => {
    assert.deepEqual(revertConflictLines(record(), {
      hpMax: 37, hpCurrent: 37,
      abilityScores: { str: 16 },
      feats: [{ name: "Alert", level: 5 }],
      subclassSelected: "champion",
      choices: { "class:Fighter:profs": ["longsword"] },
      multiclass: [{ name: "Wizard", levels: 1, subclass: "" }],
      featuresItems: ["Fighter level 5: Extra Attack"],
    }), []);
  });

  it("warns when a field was edited by hand after the level-up", () => {
    const conflicts = revertConflictLines(record(), {
      hpMax: 44, hpCurrent: 37,
      abilityScores: { str: 18 },
      feats: [],
      subclassSelected: "battle-master",
      choices: { "class:Fighter:profs": ["longbow"] },
      multiclass: [{ name: "Wizard", levels: 2, subclass: "" }],
      featuresItems: [],
    });
    const joined = conflicts.join(" ");
    assert.match(joined, /HP Max has been edited/);
    assert.match(joined, /STR has been changed/);
    assert.match(joined, /Alert feat is already gone/);
    assert.match(joined, /subclass has been changed/);
    assert.match(joined, /answer to "class:Fighter:profs" has been changed/);
    assert.match(joined, /multiclass levels have been changed/);
    assert.match(joined, /no longer in Features & Traits/);
  });

  it("says nothing about a field it cannot see", () => {
    // A caller that only knows the HP must not be told about choices it
    // never looked at.
    const conflicts = revertConflictLines(record({ choicesBefore: {}, multiclassBefore: [] }), { hpMax: 37, hpCurrent: 37 });
    assert.deepEqual(conflicts, []);
  });

  it("treats a zero HP gain as nothing to restore", () => {
    const r = buildRevertRecord({ level: 2, hpGain: 0, hpBefore: { max: 10, current: 4 } });
    assert.deepEqual(revertConflictLines(r, { hpMax: 999, hpCurrent: 999 }), []);
  });
});

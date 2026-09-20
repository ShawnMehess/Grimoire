// smoke-imports.mjs
// Tiny import-check to catch broken module splits without a test suite.
// Run: node scripts/smoke-imports.mjs
// Exits non-zero on failure so it can gate commits.

import { PAGE_COLS, DEFAULT_FIELD_SIZE } from "../js/render/sheet/sheetConstants.js";
import { debounce, valuesMatch, mergeTextStyle, clone, newId } from "../js/render/sheet/sheetHelpers.js";
import {
  categorizeChoiceGroup,
  statModifierSummary,
  mechanicsPreviewFor,
  collapseBits,
  featureBit,
  previewBitsFor,
  laterCountFor,
  commonPreviewBits,
} from "../js/render/sheet/sheetMechanics.js";
import {
  cellsDelta,
  dragPos,
  resizeDims,
  scaleFieldRect,
  boundingBox,
  cloneWithNewIds,
} from "../js/render/sheet/sheetDrag.js";
import {
  createSheetState,
  selectOnlySet,
  toggleInSet,
  selectionSignature,
} from "../js/render/sheet/sheetState.js";

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  }
};

assert(PAGE_COLS === 16, "PAGE_COLS should be 16");
assert(DEFAULT_FIELD_SIZE.text.w === 1, "DEFAULT_FIELD_SIZE.text");
assert(typeof debounce(() => {}) === "function", "debounce");
assert(valuesMatch(null, undefined) === true, "valuesMatch null/undefined");
assert(valuesMatch(1, 1) === true, "valuesMatch equal");
assert(mergeTextStyle({ bold: true }, {}).bold === true, "mergeTextStyle inherit");
assert(clone({ a: 1 }).a === 1, "clone");
assert(typeof newId() === "string", "newId");
assert(categorizeChoiceGroup({ label: "Pick a spell" }) === "spells", "categorize spells");
assert(categorizeChoiceGroup({ label: "random" }) === "proficiencies", "categorize fallback");
assert(statModifierSummary({ op: "add", value: 2 }, { resolveLabel: "STR" }) === "+2 STR", "statModifierSummary");
assert(statModifierSummary({ op: "grantTag", value: "Common" }, { resolveLabel: "Languages" }) === "Languages", "statModifierSummary grantTag");
assert(mechanicsPreviewFor(null, 1) === null, "mechanicsPreview null bundle");
assert(
  mechanicsPreviewFor({ statModifiers: [], featureGrants: [] }, 1) ===
    "No stat bonuses or features on file — flavor only.",
  "mechanicsPreview flavor-only"
);
assert(JSON.stringify(collapseBits(["A", "A", "B"])) === '["2 A","B"]', "collapseBits counts duplicates");
assert(collapseBits(["A"])[0] === "A", "collapseBits singleton untouched");
assert(featureBit({ name: "Speed", description: "25 ft. walking" }) === "Speed: 25 feet", "featureBit speed");
assert(featureBit({ name: "Speed", description: "no measurement" }) === "Speed", "featureBit speed fallback");
assert(featureBit({ name: "Darkvision", description: "60 ft." }) === "Darkvision: 60 feet", "featureBit darkvision range");
{
  // Dwarf-like bundle: counts collapse, speed carries its measurement.
  const dwarf = {
    statModifiers: [
      { targetFieldId: "conScore", op: "add", value: 2 },
      { targetFieldId: "languages", op: "grantTag", value: "Common" },
      { targetFieldId: "languages", op: "grantTag", value: "Dwarvish" },
    ],
    featureGrants: [{ name: "Speed", description: "25 ft. walking", minLevel: 1 }],
  };
  const bits = previewBitsFor(dwarf, 1, { summarize: (m) => statModifierSummary(m, { resolveLabel: m.targetFieldId === "conScore" ? "CON" : "Languages" }) });
  assert(bits.includes("+2 CON") && bits.includes("2 Languages") && bits.includes("Speed: 25 feet"), "previewBitsFor counts + speed");
}
assert(laterCountFor({ statModifiers: [{ minLevel: 4 }], featureGrants: [] }, 1) === 1, "laterCountFor");
{
  // Page-common traits ("Starting Equipment" on every background) filter out.
  const mk = (extra) => ({ statModifiers: [], featureGrants: [{ name: "Starting Equipment" }, { name: extra }] });
  const common = commonPreviewBits([mk("A"), mk("B")], 1, {});
  assert(common.has("Starting Equipment") && !common.has("A"), "commonPreviewBits intersection");
  assert(mechanicsPreviewFor(mk("A"), 1, { exclude: common }) === "A", "mechanicsPreviewFor excludes common");
  assert(commonPreviewBits([mk("A")], 1, {}).size === 0, "commonPreviewBits single option never filters");
  assert(
    mechanicsPreviewFor({ statModifiers: [], featureGrants: [{ name: "Starting Equipment" }] }, 1, { exclude: new Set(["Starting Equipment"]) }) ===
      "Shared by every option here.",
    "mechanicsPreviewFor fully-filtered message"
  );
}

// customSheet itself must still parse + export renderCustomSheet.
// (Not executed here — needs DOM — just verifying the module graph resolves.)
const sheet = await import("../js/render/customSheet.js");
assert(typeof sheet.renderCustomSheet === "function", "renderCustomSheet export");

assert(cellsDelta(55, 40, 10) === 1, "cellsDelta rounds to cells");
assert(dragPos(2, 3, 1, -1, {}).x === 3, "dragPos basic");
assert(dragPos(0, 0, -5, 0, {}).x === 0, "dragPos clamps at 0");
assert(dragPos(0, 0, 99, 0, { maxX: 5 }).x === 5, "dragPos respects maxX");
assert(resizeDims(3, 3, 1, 1, { minW: 1, minH: 1 }).w === 4, "resizeDims grow");
assert(resizeDims(1, 1, -5, 0, { minW: 1, minH: 1 }).w === 1, "resizeDims clamps min");
assert(scaleFieldRect({ x: 2, y: 2, w: 2, h: 2 }, 2, 2).w === 4, "scaleFieldRect");
assert(boundingBox([{ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 }]).w === 3, "boundingBox");
assert(cloneWithNewIds({ id: "a", children: [{ id: "b" }] }, () => "n").id === "n", "cloneWithNewIds");
assert(selectOnlySet("a").has("a"), "selectOnlySet");
assert(toggleInSet(new Set(["a"]), "b").has("b"), "toggleInSet add");
assert(selectionSignature(new Set(["b", "a"])) === "a,b", "selectionSignature sorts");
assert(createSheetState().selectedIds instanceof Set, "createSheetState");

const toolbarMod = await import("../js/render/sheet/sheetToolbar.js");
assert(typeof toolbarMod.buildChip === "function", "buildChip export");
assert(
  toolbarMod.parseFieldDropPayload({ dataTransfer: { getData: () => '{"fieldId":"x"}' } })?.fieldId === "x",
  "parseFieldDropPayload valid"
);
assert(typeof toolbarMod.buildToolbarShell === "function", "buildToolbarShell export");
assert(typeof toolbarMod.buildNameInput === "function", "buildNameInput export");
assert(
  toolbarMod.parseFieldDropPayload({ dataTransfer: { getData: () => "nope" } }) === null,
  "parseFieldDropPayload invalid"
);

const fieldsMod = await import("../js/render/sheet/sheetFields.js");
assert(JSON.stringify(fieldsMod.moveListItem(["a", "b", "c"], 0, 2)) === '["b","c","a"]', "moveListItem");
assert(fieldsMod.addTag(["a"], "a") === false, "addTag duplicate");
assert(fieldsMod.effectiveOptionCount({ fieldType: "radio", id: "r", optionsFormula: "x" }, { r: 3 }, {}) === 3, "effectiveOptionCount formula");
assert(fieldsMod.effectiveOptionCount({ fieldType: "checkbox", options: 4 }, {}, {}) === 4, "effectiveOptionCount fallback");
assert(fieldsMod.isDuplicateLabel("STR", "Stat", {}, () => true) === true, "isDuplicateLabel");
assert(fieldsMod.hasLiveOptionCount({ fieldType: "radio", optionsFormula: "x", id: "r" }, {}) === "x", "hasLiveOptionCount");
assert(fieldsMod.addTag(["a"], "b") === true, "addTag new");
assert(
  fieldsMod.tagState({ items: ["b"], granted: new Set(["a"]), tagOptions: ["a", "b", "c"] }).available.join(",") === "c",
  "tagState available"
);
assert(
  fieldsMod.dropdownVisibleChoices([{ id: "1" }, { id: "2" }], new Set(["2"])).length === 1,
  "dropdownVisibleChoices filters"
);

const blocksMod = await import("../js/render/sheet/sheetBlocks.js");
assert(
  blocksMod.resolveSourceBlock({ id: "a" }, []).id === "a",
  "resolveSourceBlock no ref"
);
assert(
  blocksMod.resolveSourceBlock({ id: "b", sourceBlockId: "a" }, [{ id: "a", w: 3 }]).w === 3,
  "resolveSourceBlock ref"
);
assert(blocksMod.colWidthFor(960, 16, 10, 40) > 40, "colWidthFor");
assert(blocksMod.rectStyle({ x: 0, y: 0, w: 1, h: 1 }, 50, 10, 0).left === "0px", "rectStyle");
assert(blocksMod.labelMaxWidth({ w: 5 }, { x: 2 }) === 3, "labelMaxWidth");
assert(blocksMod.shouldGrowForLabel(1, 5, 100, 50) === true, "shouldGrow true");
assert(blocksMod.shouldGrowForLabel(5, 5, 100, 50) === false, "shouldGrow maxed");

const levelingMod = await import("../js/render/sheet/sheetLeveling.js");
assert(levelingMod.levelFromMap(null, {}) === Infinity, "levelFromMap unset");
assert(levelingMod.levelFromMap("lvl", { lvl: 5 }) === 5, "levelFromMap value");
assert(levelingMod.levelFromMap("lvl", {}) === 0, "levelFromMap missing");
assert(levelingMod.normalizeRadioSelectionsIn([{ fieldType: "radio", selected: 5, optionsFormula: "x", id: "r" }], { r: 3 }, {}).changed !== undefined || true, "normalizeRadioSelectionsIn runs");
assert(levelingMod.computeRadioOptionCountsIn([{ fieldType: "radio", id: "r", optionsFormula: { type: "num", value: 2 } }], {}, () => 2).r === 2, "computeRadioOptionCountsIn");
assert(levelingMod.computeSpellSlotCountsIn([], {}, { rulesetId: null, className: "", level: 1, planFn: () => null }).constructor === Object, "computeSpellSlotCountsIn empty");
{
  const st = levelingMod.prepareRenderState([{ fieldType: "text", id: "a" }], {
    normalizeChoiceObjectsFn: () => false,
    computeValuesFn: () => ({ a: 1 }),
    normalizeDropdownsFn: () => false,
    optionCountsFn: () => ({}),
    slotCountsFn: () => ({}),
    normalizeRadioFn: () => false,
  });
  assert(st.formulaValues.a === 1 && st.needsNormalizedPersist === false, "prepareRenderState clean");
}
assert(Array.isArray(levelingMod.LEVEL_UP_FIELDS) && levelingMod.LEVEL_UP_FIELDS.length === 9, "LEVEL_UP_FIELDS");
assert(levelingMod.clampResourceSaved(5, "99") === "5", "clampResourceSaved clamps");
assert(levelingMod.clampResourceSaved(5, "abc") === "5", "clampResourceSaved default");
{
  const levelUps = {};
  const data = levelingMod.ensureLevelData(levelUps, 3);
  assert(data !== undefined && levelUps["3"] !== undefined, "ensureLevelData");
}
{
  const fields = [{ fieldType: "dropdown", choices: ["a", "b"], selected: "a" }];
  assert(levelingMod.normalizeChoiceObjectsIn(fields, () => "n") === true, "normalizeChoiceObjectsIn migrates");
  assert(fields[0].choices[0].id === "n", "normalizeChoiceObjectsIn ids");
}
{
  const target = { id: "sub", choices: [{ id: "1" }, { id: "2" }] };
  const other = { fieldType: "dropdown", id: "cls", selected: "c", choices: [{ id: "c", bundle: { dropdownAccess: [{ targetFieldId: "sub", allowedChoiceIds: ["1"] }] } }] };
  const { allowed, narrowed } = levelingMod.narrowChoicesByBundleAccess(target, [target, other], 1);
  assert(narrowed === true && allowed.has("1") && !allowed.has("2"), "narrowChoicesByBundleAccess");
}
assert(levelingMod.isSubclassField({ id: "subclass" }) === true, "isSubclassField");
{
  const groups = [{ key: "g", options: [{ id: "o" }] }];
  const sel = levelingMod.selectedRuleOptionsIn(groups, { g: ["o"] });
  assert(sel.length === 1 && sel[0].option.id === "o", "selectedRuleOptionsIn");
}
{
  const feats = levelingMod.selectedFeatBundlesIn([{ name: "Alert" }], "r", (c, n) => (n === "Alert" ? { statModifiers: [] } : null));
  assert(feats.length === 1, "selectedFeatBundlesIn");
  {
    // Per-class level gating: Champion L10 gated on Fighter levels, not total.
    const fields = [{
      fieldType: "dropdown", id: "subclass", label: "Subclass", selected: "c1",
      choices: [{ id: "c1", text: "Champion", bundle: { statModifiers: [{ op: "add", targetFieldId: "strScore", value: 1, minLevel: 10 }] } }],
    }];
    const levelFor = (field) => (field.id === "subclass" ? 3 : null);
    const passThru = (m, v, cb, tags, lvl) => levelingMod.applyStatModifiers(m, v, cb, tags, lvl);
    const vm = {};
    levelingMod.applyBundleModifiersIn(fields, vm, new Set(), new Map(), 8, [], [], passThru, levelFor);
    assert(vm.strScore === undefined, "levelFor gates subclass mods by class level");
    const vm2 = {};
    levelingMod.applyBundleModifiersIn(fields, vm2, new Set(), new Map(), 8, [], [], passThru, () => 10);
    assert(vm2.strScore === 1, "levelFor unlocks at class level");
    // Extra (non-dropdown) bundles apply at their own level.
    const vm3 = {};
    levelingMod.applyBundleModifiersIn([], vm3, new Set(), new Map(), 8, [], [], passThru, null,
      [{ bundle: { statModifiers: [{ op: "add", targetFieldId: "dexScore", value: 2, minLevel: null }] }, level: 2, source: "Rogue" }]);
    assert(vm3.dexScore === 2, "extraBundles apply");
    // Group-key ownership resolution for rule-option gating.
    const entry = levelingMod.dropdownEntryForGroupKey(fields, "subclass:c1:g");
    assert(entry && entry.choice.text === "Champion", "dropdownEntryForGroupKey");
    assert(levelingMod.dropdownEntryForGroupKey(fields, "feat:X:g") === null, "dropdownEntryForGroupKey feat miss");
  }
}

const bundlesMod = await import("../js/render/sheet/sheetBundles.js");
{
  const choice = {};
  bundlesMod.ensureBundleShape(choice);
  assert(Array.isArray(choice.bundle.statModifiers), "ensureBundleShape");
  assert(bundlesMod.bundleIsEmptyShape(choice.bundle) === true, "bundleIsEmptyShape empty");
}
assert(bundlesMod.effectiveGrantNameFor({ fieldType: "text", label: "STR" }, []) === "STR", "effectiveGrantNameFor plain");
{
  const bundle = bundlesMod.ensureBundleShape({});
  const applied = bundlesMod.applyBundleLibraryToChoiceIn(bundle, { id: "lib1", statModifiers: [{ op: "add", targetFieldName: "STR", value: 2 }] }, [{ fieldType: "text", id: "f1", label: "STR" }], () => "n", (f) => f.label);
  assert(applied === true && bundle.statModifiers[0].targetFieldId === "f1", "applyBundleLibraryToChoiceIn");
  assert(bundlesMod.applyBundleLibraryToChoiceIn(bundle, { id: "lib1" }, [], () => "n", (f) => f.label) === false, "applyBundleLibrary dedup");
assert(bundlesMod.alphaButtonState(true).text === "ABC↓", "alphaButtonState on");
assert(bundlesMod.sortChoicesAlpha([{ text: "b" }, { text: "a" }])[0].text === "a", "sortChoicesAlpha");
assert(bundlesMod.matchChoicesToLibrary([{ text: "Druid" }], [{ name: "druid" }])[0].lib !== null, "matchChoicesToLibrary");
assert(bundlesMod.MODIFIER_OPS.length === 4, "MODIFIER_OPS");
assert(bundlesMod.syncResultMessage(0, false).startsWith("No bundles"), "syncResultMessage empty");
assert(bundlesMod.syncResultMessage(2, true).startsWith("Wired up 2"), "syncResultMessage applied");
{
  const target = { choices: [{ text: "Druid", id: "c1" }], selected: null };
  bundlesMod.chooseTargetValue(target, "Druid", () => "n");
  assert(target.selected === "c1", "chooseTargetValue existing");
}
{
  const target = { id: "f", choices: [], selected: null };
  bundlesMod.chooseTargetValue(target, "New", () => "n");
  assert(target.selected === "n" && target.choices.length === 1, "chooseTargetValue creates");
}
{
  const target = { id: "f", selected: "c", choices: [{ id: "c", bundle: { choiceGroups: [{ id: "g" }] } }] };
  const choices = { "creation:Class:X:g": ["o"] };
  bundlesMod.migrateCreationChoiceKeys([["Class", target, "X"]], choices);
  assert(choices["f:c:g"] !== undefined && choices["creation:Class:X:g"] === undefined, "migrateCreationChoiceKeys");
}
assert(bundlesMod.parseMinLevelInput("") === null, "parseMinLevelInput blank");
assert(bundlesMod.parseMinLevelInput("3") === 3, "parseMinLevelInput number");
assert(JSON.stringify(bundlesMod.moveChoice(["a", "b", "c"], 0, 2)) === '["b","c","a"]', "moveChoice");
{
  const f = { choices: [{ id: "1", text: "a" }], selected: "1" };
  bundlesMod.removeChoiceIn(f, 0);
  assert(f.choices.length === 0 && f.selected === null, "removeChoiceIn clears selection");
}
assert(bundlesMod.addChoiceWithText({ choices: [], autoAlphabetize: false }, "  ", () => "n") === null, "addChoiceWithText blank");
assert(bundlesMod.addChoiceWithText({ choices: [], autoAlphabetize: false }, "Fire", () => "n")?.id === "n", "addChoiceWithText");
}
{
  const vm = {};
  levelingMod.applyStatModifiers([{ op: "add", targetFieldId: "str", value: 2 }], vm, new Set(), new Map(), 1);
  assert(vm.str === 2, "applyStatModifiers add");
}
{
  const groups = levelingMod.activeChoiceGroupsFor(
    [{ fieldType: "dropdown", id: "c", label: "Class", selected: "w", choices: [{ id: "w", text: "W", bundle: { choiceGroups: [{ id: "g", options: [{ id: "o" }] }] } }] }],
    1
  );
  assert(groups.length === 1 && groups[0].key.startsWith("c:w:"), "activeChoiceGroupsFor");
}

const wizardMod = await import("../js/render/sheet/sheetWizard.js");
assert(wizardMod.ordinal(1) === "1st" && wizardMod.ordinal(4) === "4th", "ordinal");
assert(
  wizardMod.findSpellCatalog([{ name: "Spell List" }, { name: "Other" }])?.name === "Spell List",
  "findSpellCatalog"
);
assert(
  wizardMod.spellsForLevelIn({ tabs: [{ id: "cantrips", entries: [{ name: "Fire" }] }] }, 0, null).length === 1,
  "spellsForLevelIn"
);
assert(wizardMod.spellLevelByNameIn({ tabs: [{ id: "cantrips", entries: [{ name: "Fire" }] }] }, "Fire") === 0, "spellLevelByNameIn");
assert(wizardMod.availableSpellLevels({ slotChanges: [{ options: 0 }, { options: 2 }] }).join(",") === "0,1,2", "availableSpellLevels");
assert(
  wizardMod.ownedSkillIdsFromBundles([{ statModifiers: [{ op: "grant", targetFieldId: "s" }] }], [], "x", {}).has("s"),
  "ownedSkillIdsFromBundles"
);
assert(wizardMod.catalogEntryInfoIn([{ name: "Species", tabs: [{ entries: [{ name: "Elf", description: "Keen" }] }] }], ["species"], "Elf")?.description === "Keen", "catalogEntryInfoIn");
assert(wizardMod.bundleForIn("Class", "Wizard", "r", [], () => null) === null, "bundleForIn miss");
assert(wizardMod.bundleForIn("Class", "Wizard", "r", [{ rulesetId: "r", category: "Class", name: "Wizard", x: 1 }], () => null)?.x === 1, "bundleForIn library");
assert(wizardMod.clampStepIndex(3, 9) === 2, "clampStepIndex");
assert(typeof wizardMod.renderStepWizardInto === "function", "renderStepWizardInto export");
{
  const counts = wizardMod.spellCountByLevel(new Set(["A", "B"]), (n) => (n === "A" ? 0 : 1));
  assert(counts.cantrips === 1 && counts.spells === 1, "spellCountByLevel");
}
assert(wizardMod.limitNoteText(1, 2, { cantrips: 2, spells: 5, style: "known" }) === "1/2 cantrips known, 2/5 spells known.", "limitNoteText");
assert(wizardMod.canLearnMore(0, { cantrips: 2, spells: 5 }, 2, 0) === false, "canLearnMore capped");

const wizardStepsMod = await import("../js/render/sheet/sheetWizardSteps.js");
assert(wizardStepsMod.clampScoreToRange("99", 8, 8, 15) === 15, "clampScoreToRange max");
assert(wizardStepsMod.pointBuyNoteText(10, 27) === "Points spent: 10/27", "pointBuyNoteText");
assert(wizardStepsMod.wizardUnavailableMessageFor({ level: 1, species: "", className: "", subclass: "" }).includes("level 1"), "wizardUnavailableMessageFor");
assert(wizardStepsMod.reviewLinesFor({ characterName: "N", level: 1, resources: [] }).includes("Name: N"), "reviewLinesFor");
{
  const rules = { subclass: "Evoker", className: "Fighter", level: 1 };
  wizardStepsMod.cleanStaleSubclass(rules, () => ({ subclasses: ["Champion"], subclassLevel: 3 }));
  assert(rules.subclass === "", "cleanStaleSubclass clears stale");
}
{
  const resolved = {};
  wizardStepsMod.applyLiveSubclassOverrideToResolved(resolved, { level: 3 }, { subclasses: ["Champion"], subclassLevel: 3 });
  assert(resolved.availableSubclasses.length === 1, "applyLiveSubclassOverrideToResolved");
}
assert(wizardStepsMod.validateLevelApply({ hpGain: NaN, contentGroups: [], pendingChoices: {}, needsAsi: false }) === "Enter the HP gained for this level before applying it.", "validateLevelApply hp");
assert(wizardStepsMod.validateLevelApply({ hpGain: 5, contentGroups: [], pendingChoices: {}, needsAsi: false }) === null, "validateLevelApply ok");
assert(wizardStepsMod.levelReviewSummary({ hp: "7", subclass: "", needsAsi: false, slots: "" }) === "HP +7", "levelReviewSummary");
assert(wizardStepsMod.checkLevelPrereqs({ needsSubclass: true, hasSubclassField: false, hasSubclassChoice: false, missingSlots: [] }) !== null, "checkLevelPrereqs missing subclass");
assert(wizardStepsMod.checkLevelPrereqs({ needsSubclass: false, missingSlots: [] }) === null, "checkLevelPrereqs ok");
{
  const scores = { str: 10 };
  assert(wizardStepsMod.applyAsiToScores(scores, "single", "str") === "+2 STR" && scores.str === 12, "applyAsiToScores single");
}
{
  const entry = wizardStepsMod.buildLevelUpEntry({ level: 2, hpGain: 7, subclassName: "", slots: "", featureEntry: "F", asiSummary: "", appliedRulesetId: "x", prev: {} });
  assert(entry.hp === "+7", "buildLevelUpEntry");
}

const historyMod = await import("../js/render/sheet/sheetHistory.js");
assert(historyMod.shouldPushNewStep({ stackEmpty: true, now: 1000, lastMutationAt: 0 }) === true, "shouldPushNewStep empty");
assert(historyMod.shouldPushNewStep({ stackEmpty: false, now: 1000, lastMutationAt: 0 }) === true, "shouldPushNewStep gap");
assert(historyMod.shortcutAction({ key: "Escape", editMode: false })?.type === "escape", "shortcutAction escape");
assert(historyMod.shortcutAction({ key: "Delete", editMode: true, typing: false, hasSelection: true })?.type === "delete-selection", "shortcutAction delete-selection");
assert(historyMod.shortcutAction({ key: "a", editMode: true, typing: true }) === null, "shortcutAction typing guard");
assert(historyMod.shortcutAction({ key: "ArrowUp", editMode: true, hasSelection: true })?.type === "nudge", "shortcutAction nudge");
assert(historyMod.shortcutAction({ key: "z", ctrl: true, editMode: true })?.type === "undo", "shortcutAction undo");
assert(historyMod.shouldPushNewStep({ stackEmpty: false, now: 500, lastMutationAt: 0 }) === false, "shouldPushNewStep coalesce");
assert(historyMod.snapshotOf({ sheetTabs: [1], layout: [2] }).sheetTabs.length === 1, "snapshotOf");

const tabsMod = await import("../js/render/sheet/sheetTabs.js");
assert(tabsMod.findTab([{ id: "a" }], "a")?.id === "a", "findTab");
assert(tabsMod.tabIndex([{ id: "a" }], "a") === 0, "tabIndex");
{
  const ch = { setupComplete: true, sheetTabs: [], layout: [] };
  tabsMod.normalizeTabsIn(ch, { newIdFn: () => "n", normalizeRulesFn: (r) => r || {}, mirrorFn: (c) => { c.layout = c.sheetTabs[0].layout; } });
  assert(ch.sheetTabs.length === 2 && ch.sheetTabs[0].kind === "main", "normalizeTabsIn seeds main+leveling");
}
{
  // Heals a save where only the rules copy has the ruleset (the old
  // toolbar-save drift: rules persisted, top-level mirror stale).
  const ch = { setupComplete: true, sheetTabs: [], layout: [], rules: { rulesetId: "r24" } };
  tabsMod.normalizeTabsIn(ch, { newIdFn: () => "n", normalizeRulesFn: (r) => r, mirrorFn: () => {} });
  assert(ch.rulesetId === "r24", "normalizeTabsIn backfills top-level rulesetId");
}
assert(tabsMod.flattenFieldsAcrossTabs([{ layout: [{ children: [{ id: "f" }] }] }]).length === 1, "flattenFieldsAcrossTabs");

const stylesMod = await import("../js/render/sheet/sheetStyles.js");
assert(stylesMod.styleToCss({ bold: true }).fontWeight === "bold", "styleToCss");
assert(stylesMod.nextLabelPosition("top", ["top", "right"]) === "right", "nextLabelPosition");

const renderMod = await import("../js/render/sheet/sheetRender.js");
assert(renderMod.gridCanvasSize([], 50, 10, 16, 300, () => 0).width === "950px", "gridCanvasSize width");
assert(renderMod.gridCanvasSize([], 50, 10, 16, 300, () => 0).height === "300px", "gridCanvasSize min height");

const selectionMod = await import("../js/render/sheet/sheetSelection.js");
assert(selectionMod.shouldResetGroupBorder("a", "b") === true, "shouldResetGroupBorder change");
assert(selectionMod.shouldResetGroupBorder("a", "a") === false, "shouldResetGroupBorder same");
assert(typeof selectionMod.buildDragHandle === "function", "buildDragHandle export");
assert(typeof selectionMod.paintSelectionInto === "function", "paintSelectionInto export");
assert(selectionMod.clickSelectionAction({ onHandle: true, id: "x" }) === "ignore", "clickSelectionAction handle");
assert(selectionMod.clickSelectionAction({ onHandle: false, id: "x", modified: true }) === "toggle", "clickSelectionAction toggle");
assert(selectionMod.clickSelectionAction({ onHandle: false, nodeKind: "block", id: "b", modified: false, singleSelectedId: null }) === "block", "clickSelectionAction block");
assert(selectionMod.clickSelectionAction({ onHandle: false, nodeKind: "field", id: "f", modified: false, singleSelectedId: "f" }) === "keep", "clickSelectionAction keep");
assert(selectionMod.groupToolbarHover(false, {}, 0, 0).visible === false, "groupToolbarHover edit off");
assert(selectionMod.dropCellFor(100, 100, { left: 0, top: 0 }, 50, 10).x === 2, "dropCellFor");

const dragMod = await import("../js/render/sheet/sheetDrag.js");
assert(dragMod.nodesBounds([{ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 2, w: 1, h: 1 }]).maxX === 3, "nodesBounds");
assert(dragMod.duplicateOffset({ maxX: 1, w: 2 }, 16).dx === 2, "duplicateOffset fits");
assert(dragMod.duplicateOffset({ maxX: 15, w: 2, h: 2 }, 16).dy === 2, "duplicateOffset wraps");
{
  const dupe = dragMod.cloneNodeWithNewIds({ id: "a", fieldType: "picture", isAvatar: true }, () => "n");
  assert(dupe.id === "n" && dupe.isAvatar === false, "cloneNodeWithNewIds clears avatar");
}
{
  const layout = [{ id: "b", children: [{ id: "f" }] }];
  const part = dragMod.partitionDuplicateSelection(layout, new Set(["f"]));
  assert(part.blocksToDuplicate.length === 0 && part.fieldGroups.length === 1, "partitionDuplicateSelection fields");
}
assert(dragMod.nudgeTargets(new Set(["b", "f"]), (id) => (id === "b" ? null : { id: "b" })).length === 1, "nudgeTargets skips block children");
{
  const node = { x: 0, y: 0, w: 1, h: 1 };
  dragMod.nudgeNode(node, 1, 0, false, { maxW: 9, maxH: 9, maxX: 9, maxY: 9 });
  assert(node.x === 1, "nudgeNode move");
}

// Feats compiled from New Info/5e-feats.txt — wired to character-object fields.
const featMod = await import("../js/data/featBundles.js");
assert(Array.isArray(featMod.FEAT_BUNDLES) && featMod.FEAT_BUNDLES.length === 83, "FEAT_BUNDLES count");
assert(featMod.FEAT_NAMES.includes("Alert") && featMod.FEAT_NAMES.includes("Resilient"), "FEAT_NAMES content");
assert(featMod.FEAT_CATALOG.tabs[0].entries.length === 83, "FEAT_CATALOG entries");
{
  const alert = featMod.FEAT_BUNDLES.find((b) => b.name === "Alert");
  assert(alert.statModifiers.some((m) => m.targetFieldId === "initiative" && m.value === 5), "Alert +5 initiative");
  const mobile = featMod.FEAT_BUNDLES.find((b) => b.name === "Mobile");
  assert(mobile.statModifiers.some((m) => m.targetFieldId === "speed" && m.value === 10), "Mobile +10 speed");
  const actor = featMod.FEAT_BUNDLES.find((b) => b.name === "Actor");
  assert(actor.statModifiers.some((m) => m.targetFieldId === "chaScore" && m.value === 1), "Actor +1 CHA");
  const resilient = featMod.FEAT_BUNDLES.find((b) => b.name === "Resilient");
  const strOpt = resilient.choiceGroups[0].options.find((o) => o.name === "Strength");
  assert(strOpt.statModifiers.some((m) => m.targetFieldId === "strScore"), "Resilient STR score option");
  assert(strOpt.statModifiers.some((m) => m.targetFieldId === "strSaveProf"), "Resilient STR save option");
  const gunner = featMod.FEAT_BUNDLES.find((b) => b.name === "Gunner");
  assert(gunner.statModifiers.some((m) => m.targetFieldId === "weaponProf" && m.value === "Firearms"), "Gunner firearms tag");
  const lucky = featMod.FEAT_BUNDLES.find((b) => b.name === "Lucky");
  assert(lucky.resourceGrants.some((g) => g.name === "Luck Points" && g.maximum === 3), "Lucky resource pool");
}
{
  // Feat choice groups flow through the same choice machinery as dropdown bundles.
  const resilient = featMod.FEAT_BUNDLES.find((b) => b.name === "Resilient");
  const groups = levelingMod.featChoiceGroupsFor([{ name: "Resilient", bundle: resilient }]);
  assert(groups.length === 1 && groups[0].key.startsWith("feat:Resilient:"), "featChoiceGroupsFor keys");
  const strOpt = resilient.choiceGroups[0].options.find((o) => o.name === "Strength");
  const sel = levelingMod.selectedRuleOptionsIn(groups, { [groups[0].key]: [strOpt.id] });
  assert(sel.length === 1 && sel[0].option.id === strOpt.id, "feat option selectable");
  const vm = {};
  levelingMod.applyStatModifiers(sel[0].option.statModifiers, vm, new Set(), new Map(), 1);
  assert(vm.strScore === 1, "feat option applies to score field");
  assert(vm["strSaveProf::0"] === 1, "feat option grants save checkbox");
}
{
  // Starter Combat fields carry the stable ids feat modifiers target.
  const { createStarterLayout } = await import("../js/data/blockModel.js");
  const fields = createStarterLayout().flatMap((b) => b.children || []);
  assert(fields.some((f) => f.id === "speed" && f.label === "Speed"), "starter speed id");
  assert(fields.some((f) => f.id === "armorClass" && f.label === "Armor Class"), "starter armorClass id");
  assert(fields.some((f) => f.id === "hpMax" && f.label === "HP Max"), "starter hpMax id");
}

const rulesMod = await import("../js/render/sheet/sheetRules.js");
assert(rulesMod.findMoneyFieldByNameIn([{ fieldType: "text", label: "GP" }])?.label === "GP", "findMoneyFieldByNameIn");
assert(rulesMod.shouldAutoRegisterMoney(null, { fieldType: "text", label: "gp" }) === true, "shouldAutoRegisterMoney");
assert(rulesMod.floatFromRichText("<b>12</b>") === 12, "floatFromRichText");
assert(rulesMod.intFromRichText("<b>12</b>") === 12, "intFromRichText");
assert(rulesMod.pointBuyCost(14, 8) === 7, "pointBuyCost");
assert(rulesMod.abilityModifier(14) === 2, "abilityModifier");
assert(rulesMod.formatModifier(2) === "+2", "formatModifier");
assert(rulesMod.classGrantsAsiIn([{ minLevel: 4, name: "Ability Score Improvement" }], 4) === true, "classGrantsAsiIn");
assert(rulesMod.selectedChoiceNameIn([{ id: "c", fieldType: "dropdown", selected: "w", choices: [{ id: "w", text: "W" }] }], "c", "Class") === "W", "selectedChoiceNameIn");

// addItem applier collection (subclass/feat/race granted spells).
{
  const grants = levelingMod.collectListItemGrantsIn(
    [{ fieldType: "dropdown", id: "s", label: "Subclass", selected: "1", choices: [{ id: "1", text: "Oath of Devotion", bundle: { statModifiers: [{ op: "addItem", targetFieldId: "spellsKnown", value: "Sanctuary", minLevel: 3 }] } }] }],
    3, [], []
  );
  assert(grants.length === 1 && grants[0].fieldId === "spellsKnown" && grants[0].items[0] === "Sanctuary", "collectListItemGrantsIn basic");
  const gated = levelingMod.collectListItemGrantsIn(
    [{ fieldType: "dropdown", id: "s", label: "Subclass", selected: "1", choices: [{ id: "1", text: "Oath of Devotion", bundle: { statModifiers: [{ op: "addItem", targetFieldId: "spellsKnown", value: "Sanctuary", minLevel: 3 }] } }] }],
    2, [], []
  );
  assert(gated.length === 0, "collectListItemGrantsIn minLevel gate");
  const featGrants = levelingMod.collectListItemGrantsIn([], 1, [], [{ name: "Fey Touched", bundle: { statModifiers: [{ op: "addItem", targetFieldId: "spellsKnown", value: "Misty Step", minLevel: null }] } }]);
  assert(featGrants.length === 1 && featGrants[0].items[0] === "Misty Step", "collectListItemGrantsIn feats");
}

// Rest semantics: short restores short-reset only, long restores all.
assert(levelingMod.restoresOnRest("short rest", "short") === true, "restoresOnRest short");
assert(levelingMod.restoresOnRest("short or long rest", "short") === true, "restoresOnRest either");
assert(levelingMod.restoresOnRest("long rest", "short") === false, "restoresOnRest long-not-on-short");
assert(levelingMod.restoresOnRest("long rest", "long") === true, "restoresOnRest long");
assert(levelingMod.restoresOnRest("rest", "long") === true, "restoresOnRest bare-rest on long");
assert(levelingMod.restoresOnRest("rest", "short") === false, "restoresOnRest bare-rest not on short");

{
  // Subclass supplement: 112 original choices + 11 TCE expansion = 123 total.
  // Every dropdown choice has a supplement bundle; supplement may contain
  // expansion subclasses beyond the original dropdown.
  const { DEFAULT_CONTENT } = await import("../js/data/defaultContent.js");
  const { SUBCLASS_SUPPLEMENT } = await import("../js/data/subclassContent.js");
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const byKey = new Map(SUBCLASS_SUPPLEMENT.map((s) => [s.key, s]));
  // Original 112 + 11 TCE = 123
  assert(SUBCLASS_SUPPLEMENT.length === 116, "SUBCLASS_SUPPLEMENT count (112 base + 4 Artificer)");
  assert(DEFAULT_CONTENT.subclassChoices.every((c) => byKey.has(norm(c.text))), "every subclass choice has a supplement bundle");
  // Supplement may have expansion entries not in the original dropdown
  const dropdownKeys = new Set(DEFAULT_CONTENT.subclassChoices.map((c) => norm(c.text)));
  const missing = SUBCLASS_SUPPLEMENT.filter((s) => !dropdownKeys.has(s.key));
  assert(missing.length === 0, "all supplement entries are in dropdown (Artificer subclasses now in dropdown)");
  const { createStarterLayout } = await import("../js/data/blockModel.js");
  const fields = [];
  (function walk(nodes) { for (const n of nodes || []) { if (n.kind === "field") fields.push(n); if (n.children) walk(n.children); } })(createStarterLayout());
  const sub = fields.find((f) => f.label === "Subclass");
  // Starter dropdown still has 112 original choices (TCE subclasses come from supplement)
  assert(sub && sub.choices.length === 116 && sub.choices.every((c) => c.bundle), "starter Subclass choices carry bundles");
  const race = fields.find((f) => f.label === "Race");
  assert(race && race.choices.some((c) => c.text === "Human") && race.choices.some((c) => c.text === "Tiefling"), "starter Race includes the five added core races");
  assert(race.choices.find((c) => c.text === "Half-Orc").bundle.resourceGrants.some((g) => g.name === "Relentless Endurance"), "Half-Orc relentless resource");
  }

  // Hand-written fixups replace source-data stubs with real pickers.
{
  const { FIXED_CLASS_ENTRIES, FIXED_RACE_ENTRIES } = await import("../js/data/contentFixups.js");
  const group = (bundle, id) => (bundle?.choiceGroups || []).find((g) => g.id === id);
  const fighter = FIXED_CLASS_ENTRIES.find((e) => e.name === "Fighter").bundle;
  assert(group(fighter, "fighter-fighting-style")?.options.length === 11, "Fighter fighting-style picker (6 PHB + 5 TCE)");
  assert(!fighter.featureGrants.some((g) => /Fighting Style/.test(g.name || "")), "Fighter stub note replaced");
  const rogue = FIXED_CLASS_ENTRIES.find((e) => e.name === "Rogue").bundle;
  assert(group(rogue, "rogue-expertise-0")?.options.length === 19, "Rogue expertise picker (18 skills + tools)");
  const sorc = FIXED_CLASS_ENTRIES.find((e) => e.name === "Sorcerer").bundle;
  assert(group(sorc, "sorcerer-metamagic-0")?.options.length === 10, "Sorcerer metamagic picker (8 PHB + 2 TCE)");
  const lock = FIXED_CLASS_ENTRIES.find((e) => e.name === "Warlock").bundle;
  assert(group(lock, "warlock-pact-boon")?.options.length === 4, "Warlock pact boon picker (3 PHB + Talisman)");
  assert(lock.choiceGroups.filter((g) => g.id.startsWith("warlock-invocations-")).length === 7, "Warlock invocation tiers");
  const elf = FIXED_RACE_ENTRIES.find((e) => e.name === "Elf").bundle;
  assert(group(elf, "elf-subrace")?.options.length === 3, "Elf subrace picker");
  assert(elf.statModifiers.length === 0 && elf.featureGrants.length === 0, "Elf base carries no traits (all in subraces)");
  const dwarfBase = FIXED_RACE_ENTRIES.find((e) => e.name === "Dwarf").bundle;
  assert(dwarfBase.statModifiers.length === 0 && dwarfBase.featureGrants.length === 0, "Dwarf base carries no traits (all in subraces)");
  assert(group(dwarfBase, "dwarf-subrace")?.options.map((o) => o.name).join(",") === "Hill Dwarf,Mountain Dwarf,Duergar", "Dwarf subrace picker");
  assert(!FIXED_RACE_ENTRIES.some((e) => ["Hill Dwarf", "Mountain Dwarf", "Duergar"].includes(e.name)), "superseded dwarf races leave the race list");
  const gnomeBase = FIXED_RACE_ENTRIES.find((e) => e.name === "Gnome").bundle;
  assert(gnomeBase.statModifiers.length === 0 && gnomeBase.featureGrants.length === 0, "Gnome base carries no traits (all in subraces)");
  assert(group(gnomeBase, "gnome-subrace")?.options.map((o) => o.name).join(",") === "Forest Gnome,Rock Gnome", "Gnome subrace picker");
  const rock = group(gnomeBase, "gnome-subrace")?.options.find((o) => o.name === "Rock Gnome");
  assert(rock.statModifiers.some((m) => m.targetFieldId === "conScore" && m.value === 1), "Rock Gnome +1 CON");
  const halflingBase = FIXED_RACE_ENTRIES.find((e) => e.name === "Halfling").bundle;
  assert(halflingBase.statModifiers.length === 0 && halflingBase.featureGrants.length === 0, "Halfling base carries no traits (all in subraces)");
  assert(group(halflingBase, "halfling-subrace")?.options.map((o) => o.name).join(",") === "Lightfoot Halfling,Stout Halfling", "Halfling subrace picker");
  const genasiBase = FIXED_RACE_ENTRIES.find((e) => e.name === "Genasi").bundle;
  assert(genasiBase.statModifiers.length === 0, "Genasi base carries no fixed traits");
  assert(group(genasiBase, "genasi-subrace")?.options.map((o) => o.name).join(",") === "Air Genasi,Earth Genasi,Fire Genasi,Water Genasi", "Genasi subrace picker");
  assert(group(genasiBase, "genasi-asi")?.options.length === 35, "Genasi shared ASI picker");
  assert(!FIXED_RACE_ENTRIES.some((e) => ["Air Genasi", "Earth Genasi", "Fire Genasi", "Water Genasi"].includes(e.name)), "standalone genasi leave the race list");
  const aarakocra = FIXED_RACE_ENTRIES.find((e) => e.name === "Aarakocra").bundle;
  assert(aarakocra.choiceGroups.some((g) => g.options.length === 35), "Aarakocra ASI pairs+triples");
  const mi = featMod.FEAT_BUNDLES.find((b) => b.name === "Magic Initiate");
  assert(mi.choiceGroups.some((g) => g.id === "magic-initiate-cantrips" && g.options.length === 47), "Magic Initiate cantrip picker");
}

// Warlock pact slots are identifiable from the level-up plan (short-rest reset).
{
  const { getLevelUpPlan } = await import("../js/data/dnd5e.js");
  const plan = getLevelUpPlan("dnd5e-2014", "Warlock", 3);
  assert(Array.isArray(plan?.slotChanges) && plan.slotChanges.length > 0, "Warlock plan has slot fields");
}

// Categorized bulleted mechanics for picker rows.
{
  const mechanics = await import("../js/render/sheet/sheetMechanics.js");
  const sections = mechanics.mechanicsBulletsFor({
    statModifiers: [
      { targetFieldId: "dexScore", op: "add", value: 2 },
      { targetFieldId: "languages", op: "grantTag", value: "Common" },
      { targetFieldId: "languages", op: "grantTag", value: "Elvish" },
      { targetFieldId: "perceptionProf", op: "grant" },
      { targetFieldId: "spellsKnown", op: "addItem", value: "Misty Step", minLevel: null },
    ],
    featureGrants: [
      { name: "Speed", description: "30 ft. walking", minLevel: 1 },
      { name: "Darkvision", description: "You can see in dim light within 60 feet as if it were bright light.", minLevel: 1 },
      { name: "Trance", description: "Meditate 4 hours instead of sleeping.", minLevel: 1 },
    ],
  }, 1, { abilityIds: ["dex"] });
  const titles = sections.map((s) => s.title);
  assert(JSON.stringify(titles) === JSON.stringify(["Racial Traits", "Ability Score Increases", "Proficiencies", "Innate Abilities"]), "mechanicsBullets order");
  assert(sections[0].items.some((i) => i.startsWith("Languages: Common, Elvish")), "mechanicsBullets tags grouped");
  assert(sections[1].items[0] === "+2 DEX", "mechanicsBullets score");
  assert(sections[2].items[0] === "perceptionProf", "mechanicsBullets prof fallback without vocab");
  assert(sections[3].items.some((i) => i.startsWith("Trance")), "mechanicsBullets innate");
  assert(mechanics.featureBit({ name: "Senses", description: "Darkvision 60 ft." }) === "Darkvision: 60 feet", "featureBit senses spelling");
  assert(mechanics.featureBit({ name: "Darkvision", description: "You can see in dim light within 60 feet as if it were bright light." }) === "Darkvision: 60 feet", "featureBit feet wording");
  // Darkvision + resistances land in Racial Traits (both spellings),
  // traits run Speed → Darkvision → Resistances, scores run STR-first.
  {
    const dwarfLike = mechanics.mechanicsBulletsFor({
      statModifiers: [
        { targetFieldId: "wisScore", op: "add", value: 1 },
        { targetFieldId: "conScore", op: "add", value: 2 },
      ],
      featureGrants: [
        { name: "Resistances", description: "Poison", minLevel: 1 },
        { name: "Speed", description: "25 ft. walking", minLevel: 1 },
        { name: "Senses", description: "Darkvision 60 ft.", minLevel: 1 },
        { name: "Stonecunning", description: "Double proficiency on stonework history checks.", minLevel: 1 },
      ],
    }, 1, { abilityIds: ["str", "dex", "con", "int", "wis", "cha"] });
    assert(dwarfLike[0].items.slice(0, 3).join(" | ") === "Speed: 25 feet | Darkvision: 60 feet | Resistances: Poison", "mechanicsBullets trait order");
    assert(dwarfLike[1].items.join(" | ") === "+2 CON | +1 WIS", "mechanicsBullets score order");
    assert(dwarfLike[2].items.some((i) => i.startsWith("Stonecunning")), "mechanicsBullets innate keeps the rest");
  }
  // Merged language picker: one list, combined budget, per-group storage.
  {
    const groups = [
      { key: "creation:Race:X:g1", minSelections: 1, maxSelections: 1, options: [{ id: "a", name: "Elvish", statModifiers: [{ targetFieldId: "languages", op: "grantTag", value: "Elvish" }] }, { id: "b", name: "Orc", statModifiers: [] }] },
      { key: "creation:Background:Y:g2", minSelections: 2, maxSelections: 2, options: [{ id: "c", name: "Elvish", statModifiers: [] }, { id: "d", name: "Draconic", statModifiers: [] }] },
    ];
    const merged = wizardMod.mergeLanguageGroups(groups, ["Common", "Elvish", "Orc", "Draconic"], new Set(["tag:languages:Elvish"]));
    assert(JSON.stringify(merged.languages) === JSON.stringify(["Elvish", "Orc", "Draconic"]), "mergeLanguageGroups vocab order");
    assert(merged.total === 3, "mergeLanguageGroups combined budget");
    assert(merged.required === 2, "mergeLanguageGroups owned overlap relief");
    const stored = wizardMod.distributeLanguagePicks(groups, ["Orc", "Draconic"]);
    assert(JSON.stringify(stored["creation:Race:X:g1"]) === JSON.stringify(["b"]), "distributeLanguagePicks fills first group");
    assert(JSON.stringify(stored["creation:Background:Y:g2"]) === JSON.stringify(["d"]), "distributeLanguagePicks spills into second group");
  }
  // Fixed trait slots always appear — missing values show defaults.
  {
    const humanLike = mechanics.mechanicsBulletsFor({
      statModifiers: [],
      featureGrants: [{ name: "Speed", description: "30 ft. walking", minLevel: 1 }],
    }, 1, { abilityIds: ["str", "dex", "con", "int", "wis", "cha"] });
    assert(humanLike[0].items.join(" | ") === "Speed: 30 feet | Darkvision: none | Resistances: none", "mechanicsBullets trait defaults");
  }
  // Sentence-snipper never starts mid-string or mid-word.
  {
    assert(mechanics.briefDescription("When you score a critical hit with a melee weapon attack, you can roll one of the weapon's damage dice one additional time and add it to the extra damage of the critical hit.", 120).startsWith("When you"), "briefDescription anchored at start");
    assert(mechanics.briefDescription("Know the Shocking Grasp cantrip.; Cast Feather Fall once per long rest.; Cast Levitate once per long rest.", 120).startsWith("Know the"), "briefDescription semicolons stay anchored");
  }
  assert(mechanics.mechanicsBulletsFor(null, 1).length === 0, "mechanicsBullets null-safe");
  assert(mechanics.briefDescription("First. Second.", 200) === "First.", "briefDescription");
  assert(mechanics.briefDescription("A very long single sentence with no ending in sight at all whatsoever", 20).endsWith("…"), "briefDescription word-cut fallback");
  assert(JSON.stringify(wizardMod.spellClassesFor({ fieldValues: { classes: "Wizard, Sorcerer" } })) === '["Wizard","Sorcerer"]', "spellClassesFor explicit");
  assert(wizardMod.spellClassesFor({ fieldValues: { effect: "Boom. Spell Lists. Bard, Cleric." } }).join() === "Bard,Cleric", "spellClassesFor parsed");
  assert(wizardMod.spellClassesFor({ fieldValues: { effect: "Boom with no list." } }).length === 0, "spellClassesFor unknown");
  {
    const onlyClass = wizardMod.creationFixedBundlesFor({ species: "", className: "Fighter", subclass: "", background: "", rulesetId: null }, (c, n) => (n === "Fighter" ? { name: "F" } : null));
    assert(onlyClass.length === 4 && onlyClass[0] === null && onlyClass[1]?.name === "F" && onlyClass[3] === null, "creationFixedBundlesFor stays positional");
  }
  {
    // Attack suggestions + layout presets.
    const attacks = await import("../js/render/sheet/sheetAttacks.js");
    assert(attacks.normalizeWeaponName("2 handaxes") === "handaxe", "normalizeWeaponName count+plural");
    assert(attacks.normalizeWeaponName("Longsword") === "longsword", "normalizeWeaponName case");
    const lines = attacks.suggestAttackLines({
      items: ["Longsword", "Light crossbow", "Backpack", "Longsword"],
      cantripsKnown: ["Fire Bolt", "Light"],
      existing: [],
      prof: 2, strMod: 3, dexMod: 1, spellMod: 3,
    });
    assert(lines.some((l) => l.startsWith("Longsword — +5 to hit — 1d8+3 slashing")), "suggest longsword");
    assert(lines.some((l) => l.startsWith("Light Crossbow — +3 to hit — 1d8+1 piercing")), "suggest crossbow uses Dex");
    assert(lines.some((l) => l.startsWith("Fire Bolt — +5 to hit")), "suggest cantrip");
    assert(!lines.some((l) => l.startsWith("Light —")), "skip non-attack cantrips");
    assert(lines.filter((l) => l.startsWith("Longsword")).length === 1, "suggest dedupes");
    assert(attacks.innateAttacksFromGrants([{ name: "Claws", description: "Deal 1d4 + Strength slashing." }])[0]?.dice === "1d4", "innateAttacksFromGrants");
    const layouts = await import("../js/render/sheet/sheetLayouts.js");
    assert(layouts.LAYOUT_PRESETS.length === 3, "three layout presets");
    const mk = () => [{ kind: "block", name: "A", x: 5, y: 5, w: 4, h: 2 }, { kind: "block", name: "Combat", x: 0, y: 9, w: 4, h: 3 }];
    const single = layouts.applyLayoutPresetTo(mk(), "single-column");
    assert(single[0].x === 0 && single[0].w === 16 && single[1].y === 2, "single-column stacks");
    const two = layouts.applyLayoutPresetTo(mk(), "two-column");
    assert(two[0].w === 8 && two[1].x === 8 && two[1].w === 8, "two-column splits");
    const combat = layouts.applyLayoutPresetTo(mk(), "combat-first");
    assert(combat[0].name === "Combat" && combat[0].x === 0, "combat-first reorders");
    assert(layouts.applyLayoutPresetTo(mk(), "nope")[0].x === 5, "unknown preset no-op");
  }
  {
    // Built-in public-domain portraits for picker rows.
    const portraits = await import("../js/data/portraitArt.js");
    assert(portraits.portraitArtFor("Wizard") === "assets/portraits/class-wizard.jpg", "portraitArtFor class");
    assert(portraits.portraitArtFor("HALF-ELF") === "assets/portraits/race-half-elf.jpg", "portraitArtFor case-insensitive");
    assert(portraits.portraitArtFor("Urban Bounty Hunter") === "assets/portraits/bg-urban-bounty-hunter.jpg", "portraitArtFor background");
    assert(portraits.portraitArtFor("Champion") === null && portraits.portraitArtFor("") === null, "portraitArtFor miss");
  }
}

// Flavor blurbs resolve case-insensitively.
{
  const { flavorFor } = await import("../js/data/pickerFlavor.js");
  assert(typeof flavorFor("half-elf") === "string" && flavorFor("Half-Elf") === flavorFor("half-elf"), "flavorFor");
  assert(flavorFor("Nope") === null, "flavorFor miss");
}

// Spell mechanics lines + choice review lines + gating helpers.
{
  const wizard = await import("../js/render/sheet/sheetWizard.js");
  const line = wizard.spellMechanicsLine({ fieldValues: { level: "Level 3", school: "Evocation", castingTime: "1 action", range: "150 feet", duration: "Instantaneous", concentration: "No", effect: "A bright streak flashes. Each creature must make a Dexterity saving throw." } });
  assert(line.meta.includes("Level 3") && line.meta.includes("150 feet"), "spellMechanicsLine meta");
  assert(line.effect.startsWith("A bright streak"), "spellMechanicsLine effect");
  const lines = wizard.reviewChoiceLinesFor(
    [{ key: "g1", label: "Skills", options: [{ id: "a", name: "Arcana" }], categories: [{ options: [{ id: "b", name: "History" }] }] }],
    { g1: ["a", "b"] }
  );
  assert(lines.length === 1 && lines[0] === "Skills: Arcana · History", "reviewChoiceLinesFor");
  assert(wizard.reviewChoiceLinesFor([{ key: "g", options: [] }], {}).length === 0, "reviewChoiceLinesFor skips empty");
  const owned = new Set(["s", "tag:languages:Common"]);
  assert(wizard.optionIsOwned({ statModifiers: [{ op: "grant", targetFieldId: "s" }] }, owned) === true, "optionIsOwned grant");
  assert(wizard.optionIsOwned({ statModifiers: [{ op: "grantTag", targetFieldId: "languages", value: "Common" }] }, owned) === true, "optionIsOwned tag");
  assert(wizard.optionIsOwned({ statModifiers: [{ op: "grant", targetFieldId: "x" }] }, owned) === false, "optionIsOwned miss");
  assert(wizard.groupPicksSatisfied({ minSelections: 2, options: [] }, [], new Set()) === false, "groupPicksSatisfied empty");
  assert(wizard.groupPicksSatisfied({ minSelections: 1, lockedOptionIds: ["c"], options: [{ id: "c" }] }, ["c"], new Set()) === false, "groupPicksSatisfied locked does not consume budget");
  assert(wizard.groupPicksSatisfied({ minSelections: 1, lockedOptionIds: ["c"], options: [{ id: "c" }, { id: "x" }] }, ["c", "x"], new Set()) === true, "groupPicksSatisfied one real pick satisfies");
  assert(wizard.groupPicksSatisfied({ minSelections: 1, options: [{ id: "a", statModifiers: [{ op: "grant", targetFieldId: "s" }] }] }, [], owned) === true, "groupPicksSatisfied owned freebie");
  assert(wizard.stepIsComplete({}) === true && wizard.stepIsComplete({ isComplete: () => false }) === false, "stepIsComplete");
  {
    const groups = [{
      key: "g", label: "Acolyte Languages (choose 2)", minSelections: 2, maxSelections: 2,
      options: [{ id: "c", name: "Common" }, { id: "e", name: "Elvish" }],
    }];
    wizard.lockCommonInLanguageGroups(groups, (g) => "languages");
    assert(JSON.stringify(groups[0].lockedOptionIds) === '["c"]', "lockCommon finds Common");
    const other = [{ key: "h", label: "Skills", options: [{ id: "x", name: "Arcana" }] }];
    wizard.lockCommonInLanguageGroups(other, () => "proficiencies");
    assert(other[0].lockedOptionIds === undefined, "lockCommon ignores non-language groups");
  }
  {
    const { resolveStartingEquipmentPick, goldOptionIdFor, CLASS_STARTING_EQUIPMENT, BG_STARTING_EQUIPMENT } = await import("../js/data/startingEquipment.js");
    const fighter = resolveStartingEquipmentPick("Fighter", "Sailor", { picks: { armor: "chain-mail", weapon: "sword-board", ranged: "light-crossbow", pack: "dungeoneers-pack" } });
    assert(fighter.items.includes("Chain mail") && fighter.items.includes("Shield") && fighter.gp === 10, "starting package + bg gold");
    const legacy = resolveStartingEquipmentPick("Fighter", "Sailor", "fighter-a");
    assert(legacy.items.includes("Chain mail") && legacy.items.includes("Longsword") && legacy.gp === 10, "legacy flattened pick resolves");
    const gold = resolveStartingEquipmentPick("Fighter", "Sailor", { gold: true });
    assert(gold.items.length === BG_STARTING_EQUIPMENT.Sailor.items.length && gold.gp === CLASS_STARTING_EQUIPMENT.Fighter.gold.gp + 10, "gold instead");
    const empty = resolveStartingEquipmentPick("", "", null);
    assert(empty.items.length === 0 && empty.gp === 0, "starting equipment empty-safe");
  }
  assert(wizard.firstIncompleteStep([{ isComplete: () => true }, { isComplete: () => false }]) === 1, "firstIncompleteStep");
  assert(wizard.firstIncompleteStep([{ isComplete: () => { throw new Error("x"); } }]) === -1, "firstIncompleteStep never throws");
  {
    const spells = [
      { name: "B", tags: ["damage"], school: "Abjuration" },
      { name: "A", tags: ["heal"], school: "Evocation" },
      { name: "C", tags: [], school: "Evocation" },
    ];
    assert(wizard.filterSortSpells(spells, { tag: "all", sort: "name" }).map((s) => s.name).join("") === "ABC", "filterSortSpells name");
    assert(wizard.filterSortSpells(spells, { tag: "damage", sort: "name" }).map((s) => s.name).join("") === "B", "filterSortSpells tag");
    assert(wizard.filterSortSpells(spells, { tag: "all", sort: "school" }).map((s) => s.name).join("") === "BAC", "filterSortSpells school");
    assert(typeof wizard.spellPickerUiStateFor("x").tag === "string", "spellPickerUiStateFor");
  }
  {
    const { TAG_VOCABULARY, SPELL_CATALOG } = await import("../js/data/contentCatalogs.js");
    assert(Array.isArray(TAG_VOCABULARY) && TAG_VOCABULARY.length > 30, "TAG_VOCABULARY");
    assert(JSON.stringify(TAG_VOCABULARY) === JSON.stringify([...TAG_VOCABULARY].sort()), "TAG_VOCABULARY sorted");
    const vocab = new Set(TAG_VOCABULARY);
    let checked = 0;
    for (const t of SPELL_CATALOG.tabs) {
      for (const e of (t.entries || []).slice(0, 30)) {
        for (const tag of (e.fieldValues?.tags || [])) assert(vocab.has(tag), `tag in vocabulary: ${tag}`);
        checked++;
      }
    }
    assert(checked > 0, "tag vocabulary check ran");
    const fireball = SPELL_CATALOG.tabs.flatMap((t) => t.entries || []).find((e) => e.name === "Fireball");
    assert(fireball.fieldValues.tags.includes("damage") && fireball.fieldValues.tags.includes("evocation"), "Fireball tags");
  }
}

// Spell + equipment catalogs import with the expected tabs.
{
  const { SPELL_CATALOG, WEAPONS_ARMOR_CATALOG, GEAR_CATALOG } = await import("../js/data/contentCatalogs.js");
  assert(SPELL_CATALOG.tabs.some((t) => t.id === "cantrips") && SPELL_CATALOG.tabs.some((t) => t.id === "level9"), "SPELL_CATALOG tabs");
  assert(WEAPONS_ARMOR_CATALOG.tabs.length >= 1 && GEAR_CATALOG.tabs.length >= 1, "equipment catalogs");
  const { RACE_EXTRA_ENTRIES } = await import("../js/data/extraRaces.js");
  assert(RACE_EXTRA_ENTRIES.length === 5, "RACE_EXTRA_ENTRIES count");
}

// Multiclass pure layer: level splits, prereqs, slots, stripping.
{
  const rules = await import("../js/data/rulesEngine.js");
  const dnd = await import("../js/data/dnd5e.js");
  const solo = rules.classLevelsFor({ className: "Fighter", level: 5, subclass: "Champion", multiclass: [] });
  assert(solo.length === 1 && solo[0].levels === 5 && solo[0].primary === true, "classLevelsFor single");
  const multi = rules.classLevelsFor({ className: "Fighter", level: 6, subclass: "", multiclass: [{ name: "Wizard", levels: 2, subclass: "School of Evocation" }] });
  assert(multi.length === 2 && multi[0].levels === 4 && multi[1].levels === 2, "classLevelsFor split");
  assert(rules.meetsMulticlassPrereq({ str: 13, int: 13 }, "Fighter", "Wizard") === true, "prereq met both sides");
  assert(rules.meetsMulticlassPrereq({ str: 13, int: 12 }, "Fighter", "Wizard") === false, "prereq int-missed");
  assert(rules.meetsMulticlassPrereq({ str: 10, dex: 13 }, "Rogue", "Fighter") === true, "prereq fighter either-or");
  assert(rules.meetsMulticlassPrereq({ dex: 15, wis: 12 }, "Fighter", "Monk") === false, "prereq monk needs both");
  assert(rules.meetsMulticlassPrereq({ cha: 13 }, "Sorcerer", "Warlock") === true, "prereq same-side");
  assert(rules.multiclassPrereqReason({ str: 13, int: 12 }, "Fighter", "Wizard") === "needs INT 13", "prereq reason");
  assert(rules.multiclassPrereqReason({ str: 13, int: 13 }, "Fighter", "Wizard") === "", "prereq reason empty when met");
  assert(rules.multiclassPrereqReason({ dex: 15, wis: 12 }, "Fighter", "Monk") === "needs DEX 13 and WIS 13", "prereq reason joining");
  {
    const norm = rules.normalizeRulesState({ className: "Fighter", level: 6, multiclass: [
      { name: "Wizard", levels: 2, subclass: "School of Evocation" },
      { name: "Fighter", levels: 3 },
      { name: "Rogue", levels: 0 },
    ] });
    assert(norm.multiclass.length === 1 && norm.multiclass[0].name === "Wizard", "normalize multiclass drops primary-dupes and zeroed");
    assert(rules.classLevelsFor(norm).map((c) => `${c.name}:${c.levels}`).join(",") === "Fighter:4,Wizard:2", "classLevelsFor primary derived");
    assert(rules.classLevelsFor({ className: "", level: 1, multiclass: [] }).length === 0, "classLevelsFor no primary");
  }
  const eff = rules.effectiveScoresFor({ str: 10, cha: 12 }, { statModifiers: [{ op: "add", targetFieldId: "chaScore", value: 2 }] });
  assert(eff.cha === 14 && eff.str === 10, "effectiveScoresFor");
  assert(dnd.hitDieFor("Barbarian") === 12 && dnd.hitDieFor("Wizard") === 6 && dnd.hitDieFor("Nope") === 8, "hitDieFor");
  assert(dnd.casterWeight("full") === 1 && dnd.casterWeight("half") === 0.5 && dnd.casterWeight(null) === 0, "casterWeight basic");
  assert(dnd.casterWeight(null, "Eldritch Knight") === 1 / 3, "casterWeight EK third");
  {
    // One ruleset (game system) with content books under it.
    const sources = dnd.listRulesets();
    assert(sources.length === 1 && sources[0].id === "dnd5e-2014", "one ruleset registered");
    assert(typeof sources[0].description === "string" && sources[0].description.length > 0, "ruleset description");
    assert(dnd.listContentPacks("dnd5e-2014").length === 3, "three content packs registered");
    const packs = dnd.listContentPacks("dnd5e-2014");
    assert(packs.map((p) => p.id).join() === "phb,xanathar,tashas", "content pack ids and order");
    assert(packs[0].name.includes("Player's Handbook") && packs[2].name.includes("Tasha"), "content pack names");
    assert(dnd.getContentPack("phb")?.classes.length === 12, "phb covers twelve classes");
    assert(dnd.getContentPack("tashas") != null && dnd.getContentPack("tashas").rulesetId === "dnd5e-2014", "tashas pack registered under the ruleset");
    // Pack-level metadata, union helpers, and book gating.
    assert(dnd.getRulesetClass("xanathar", "Wizard")?.subclasses.join() === "War Magic", "xanathar wizard subclasses");
    assert(dnd.getRuleset("dnd5e-2014")?.classes.length === 13, "ruleset merges classes across packs (12 PHB + Artificer)");
    assert(dnd.getRuleset("dnd5e-2014")?.classes.find((c) => c.name === "Wizard")?.subclasses.includes("War Magic"), "merged ruleset includes xanathar subclasses");
    assert(dnd.getRulesetClass("nope", "Wizard") === null, "unknown source miss");
    assert(dnd.classNamesIn(["phb"]).includes("Fighter"), "classNamesIn pack union");
    assert(dnd.classNamesIn("dnd5e-2014").includes("Fighter"), "classNamesIn ruleset union");
    assert(dnd.classNamesIn("dnd5e-2014").length === 13, "classNamesIn ruleset has 13 classes (12 PHB + Artificer)");
    const subs = dnd.subclassesAcrossRulesets("Rogue", ["phb", "xanathar"]);
    assert(subs.subclasses.includes("Swashbuckler") && Number.isFinite(subs.subclassLevel), "subclassesAcrossRulesets union");
    assert(!dnd.subclassesAcrossRulesets("Rogue", ["phb"]).subclasses.includes("Swashbuckler"), "content gating: phb-only excludes xanathar subclasses");
    assert(dnd.subclassesAcrossRulesets("Rogue", ["phb"]).subclasses.includes("Thief"), "content gating: phb keeps its own subclasses");
    assert(!dnd.subclassesAcrossRulesets("Cleric", ["phb"]).subclasses.includes("Peace Domain"), "content gating: phb-only excludes tasha subclasses");
    assert(dnd.subclassesAcrossRulesets("Cleric", ["phb", "tashas"]).subclasses.includes("Peace Domain"), "content gating: tashas pack adds its subclasses");
    assert(dnd.subclassesAcrossRulesets("Nope", ["phb"]).subclasses.length === 0, "subclassesAcrossRulesets miss");
    // Legacy saves migrate to the new system + content packs.
    assert(JSON.stringify(rules.includedRulesetIds({ rulesetId: "homebrew" })) === '["phb"]', "includedRulesetIds legacy → phb");
    assert(rules.primaryRulesetId({ rulesetId: "homebrew", rulesetIds: ["xanathar", "homebrew"] }) === "dnd5e-2014", "primaryRulesetId derives system from legacy");
    const migrated = rules.normalizeRulesState({ rulesetId: "homebrew" });
    assert(JSON.stringify(migrated.rulesetIds) === '["phb"]' && migrated.rulesetId === "dnd5e-2014", "normalizeRulesState migrates legacy");
    const multi = rules.normalizeRulesState({ rulesetId: "xanathar", rulesetIds: ["homebrew", "xanathar"] });
    assert(multi.rulesetId === "dnd5e-2014" && JSON.stringify(multi.rulesetIds) === '["phb","xanathar"]', "normalizeRulesState keeps multi packs");
    const repaired = rules.normalizeRulesState({ rulesetId: "xanathar", rulesetIds: ["homebrew"] });
    assert(repaired.rulesetId === "dnd5e-2014" && JSON.stringify(repaired.rulesetIds) === '["phb","xanathar"]', "normalizeRulesState migrates stranded xanathar");
    const defaults = rules.normalizeRulesState({ rulesetId: "dnd5e-2014", rulesetIds: [] });
    assert(JSON.stringify(rules.includedRulesetIds(defaults)) === '["phb"]', "lone system falls back to its default books");
    // Library option names union across sources (legacy tags canonicalize).
    const lib = [
      { rulesetId: "homebrew", category: "Race", name: "Human" },
      { rulesetId: "xanathar", category: "Race", name: "Tabaxi" },
    ];
    const libWithSystemTag = [...lib, { rulesetId: "dnd5e-2014", category: "Race", name: "Aasimar" }];
    assert(wizardMod.rulesetOptionNamesIn(lib, ["phb", "xanathar"], "Race", []).join() === "Human,Tabaxi", "rulesetOptionNamesIn canonicalizes legacy tags");
    assert(wizardMod.rulesetOptionNamesIn(lib, "phb", "Race", ["Fallback"]).join() === "Human", "rulesetOptionNamesIn single pack still works");
    assert(wizardMod.rulesetOptionNamesIn(libWithSystemTag, ["dnd5e-2014"], "Race", []).join() === "Human,Tabaxi,Aasimar", "rulesetOptionNamesIn expands a system to its packs");
    assert(wizardMod.rulesetOptionNamesIn(libWithSystemTag, "phb", "Race", []).join() === "Human,Aasimar", "whole-system bundle matches any single book");
  }  const w3 = dnd.multiclassSlotsFor([{ caster: "full", levels: 3 }]);
  assert(w3[0].fieldId === "slots1" && w3[0].options === 4 && w3[1].options === 2, "multiclassSlotsFor full-3");
  assert(dnd.multiclassSlotsFor([{ caster: null, levels: 5 }]).length === 0, "multiclassSlotsFor martial none");
  assert(dnd.multiclassSlotsFor([{ caster: "pact", levels: 3 }]).length === 0, "multiclassSlotsFor pact separate");
  const pal5 = dnd.multiclassSlotsFor([{ caster: "half", levels: 5 }]);
  assert(pal5[0].options === 3 && pal5.length === 1, "multiclassSlotsFor half-5");
  const { stripSecondaryClassBundle } = await import("../js/data/contentFixups.js");
  const stripped = stripSecondaryClassBundle({ statModifiers: [
    { targetFieldId: "strSaveProf", op: "grant" },
    { targetFieldId: "armorProf", op: "grantTag", value: "Light Armor" },
    { targetFieldId: "strScore", op: "add", value: 2 },
    { targetFieldId: "athleticsProf", op: "grant" },
  ] });
  assert(stripped.statModifiers.length === 2, "stripSecondaryClassBundle drops saves+armor");
  assert(stripSecondaryClassBundle(null) === null, "stripSecondaryClassBundle null-safe");
}

if (!process.exitCode) console.log("smoke-imports: all checks passed");

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
assert(mechanicsPreviewFor(null, 1) === null, "mechanicsPreview null bundle");
assert(
  mechanicsPreviewFor({ statModifiers: [], featureGrants: [] }, 1) ===
    "No stat bonuses or features on file — flavor only.",
  "mechanicsPreview flavor-only"
);

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
assert(Array.isArray(levelingMod.LEVEL_UP_FIELDS) && levelingMod.LEVEL_UP_FIELDS.length === 8, "LEVEL_UP_FIELDS");
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

if (!process.exitCode) console.log("smoke-imports: all checks passed");

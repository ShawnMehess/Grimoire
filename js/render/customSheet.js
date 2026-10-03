// customSheet.js
//
// The drag/resize/style-everything character sheet builder. Renders
// character.layout (an array of blocks — see js/data/blockModel.js)
// into a hand-rolled absolute-positioned grid. No external grid/drag
// library — see the README for why (short version: this project's
// whole style is plain vanilla JS you can read top-to-bottom, and
// that mattered more here than saving code volume).
//
// GRID MATH: one consistent cell size is used at every nesting level.
// Column WIDTH is responsive (computed from the canvas's pixel width /
// PAGE_COLS, recalculated on window resize) so the sheet fills
// whatever screen it's on; row HEIGHT is a fixed pixel value. A
// block's own children use the exact same column width, with the
// block's own `w` (in page-grid cells) as their local column count —
// that's what makes "one cell" mean the same physical size whether
// you're looking at a top-level block or a field inside it.
//
// CANVAS: the draggable area breaks out to the full viewport width
// (regardless of .app-main's own max-width) and is sized to fill the
// remaining viewport height below the toolbar, so there's always open
// space to drag things into — it only scrolls (both axes) once actual
// content exceeds that.
//
// EDITING MODEL: every block/field is a DOM node with a drag handle
// (top-left) and, where resizing makes sense, a resize handle
// (bottom-right) — both only interactive in edit mode. Dragging/
// resizing snaps to the nearest whole grid cell and persists on
// release. There is deliberately NO collision handling or auto-reflow
// — overlapping other blocks/fields is allowed, and nothing tries to
// fix it up automatically. (An earlier pass had gridEngine.js do this
// automatically; it was removed by request in favor of fully manual
// placement — gridEngine.js's compact()/clampToWidth() are unused now
// and could be deleted if nothing else ends up wanting them.)
//
// KNOWN SIMPLIFICATIONS in this pass (flagged here and repeated to
// Shawn in chat, not hidden):
//   - Label repositioning (top/right/bottom/left) is a 4-state CYCLE
//     button, not a continuous drag-follow-cursor gesture. It IS
//     animated (see cycleLabelPosition's FLIP transform), just not a
//     literal drag. A true drag-based version is a reasonable follow-up
//     if it turns out to matter in practice.
//   - Side labels (left/right) reserve space WITHIN a field's existing
//     w/h rather than being an independently resizable adjacent grid
//     cell. Widen the whole field if a side label needs more room.
//   - Rich per-selection text formatting (bold/italic/underline/color/
//     font) only works inside a text field's VALUE area, not its label
//     or a block's name — those stay plain text, though they still
//     inherit whole-node font/color choices via normal CSS inheritance.
//   - Formulas (see js/data/formula.js and js/render/formulaEditor.js)
//     are only wired up for TEXT fields — a radio/checkbox field is a
//     variable SOURCE for other formulas, not itself a formula target.
//   - Images upload to Firebase Storage (see uploadImageInBackground
//     and js/state/characterImages.js), so large images no longer
//     threaten Firestore's 1MB document cap — but nothing
//     compresses/resizes them yet. Offline keeps data URLs (with the
//     old oversize warning, since the cap still applies there).

import { createStarterLayout, createBlock, createField, findNode, findParentArray, syncOptionWidth, LABEL_POSITIONS, BLOCK_HEADER_ROWS, ARMOR_PROFICIENCIES, WEAPON_PROFICIENCIES, TOOL_PROFICIENCIES, toolGroupsForLabel, TOOL_DESCRIPTIONS, VEHICLE_PROFICIENCIES } from "../data/blockModel.js";
import { calculatePrintScale, getTabsToPrint, buildPrintCss, cloneForPrint } from "./print-helpers.js";
import { contentHeight } from "./gridEngine.js";
import { computeAllFormulas, evaluateFormulaNode, formatComputedValue } from "../data/formula.js";
import { openFormulaEditor } from "./formulaEditor.js";
import { openBundleLibraryManager } from "./bundleLibraryEditor.js";
import { openCatalogLibraryManager } from "./catalogLibraryEditor.js";
import { openCatalogBrowser } from "./catalogBrowser.js";
import { getLevelUpPlan, getRuleset, getRulesetClass, getSpellcastingInfo, listRulesets, listContentPacks, getContentPack, defaultContentPackIds, hitDieFor, multiclassSlotsFor, classNamesIn, subclassesAcrossRulesets, contentIdMatches } from "../data/dnd5e.js";
import { ABILITY_IDS, normalizeRulesState, resolveRulesState, spellLimitFor, classLevelsFor, meetsMulticlassPrereq, effectiveScoresFor, multiclassPrereqReason, includedRulesetIds, primaryRulesetId } from "../data/rulesEngine.js";
import { spellcastingModelFor } from "../data/spellcastingModels.js";
import { SUBCLASS_SUPPLEMENT } from "../data/subclassContent.js";
import { stripSecondaryClassBundle, FIXED_RACE_ENTRIES, SUPERSEDED_RACE_NAMES, legacyRaceBundles, SUBCLASS_BUNDLE_MAP, normSubclassKey, LEGACY_ASI_COMBOS } from "../data/contentFixups.js";
import { DEFAULT_CONTENT } from "../data/defaultContent.js";
import { assignCatalogEntryIds, migrateBundleCatalogLinks, LINKED_FEAT_BUNDLES } from "../data/catalogLinks.js";
import { setSpellLinkOpener, openSpellDetailDialog } from "./sheet/spellLinks.js";
import { FEAT_CATALOG, FEAT_NAMES } from "../data/featBundles.js";
import { SPELL_CATALOG, WEAPONS_ARMOR_CATALOG, GEAR_CATALOG } from "../data/contentCatalogs.js";
import { RACE_EXTRA_CATALOG_ENTRIES } from "../data/extraRaces.js";
import { flavorFor } from "../data/pickerFlavor.js";
import { portraitArtFor } from "../data/portraitArt.js";
import { SHEET_THEMES, applySheetTheme, normalizeThemeId, normalizeThemeMode } from "../data/themes.js";
import { CLASS_STARTING_EQUIPMENT, BG_STARTING_EQUIPMENT, BG_EQUIPMENT_LINKS, goldOptionIdFor, slugId, resolveStartingEquipmentPick, linkedEquipmentNames, bgDisplayItems } from "../data/startingEquipment.js";
import { ABILITIES, SKILLS, languageSections } from "../data/schema.js";
import { EXPRESS_CLASS_DEFAULTS } from "../data/expressDefaults.js";
import {
  PAGE_COLS,
  GAP_PX,
  MIN_CELL_PX,
  MAX_BG_IMAGE_BYTES,
  MAX_IMAGE_BYTES,
  DEFAULT_FIELD_SIZE,
  RESIZABLE_FIELD_TYPES,
  CAPTIONLESS_FIELD_TYPES,
} from "./sheet/sheetConstants.js";
import { debounce, valuesMatch, mergeTextStyle, clone, newId, el } from "./sheet/sheetHelpers.js";
import {
  categorizeChoiceGroup as sharedCategorizeChoiceGroup,
  statModifierLabel as sharedStatModifierLabel,
  statModifierSummary as sharedStatModifierSummary,
  mechanicsBulletsFor as sharedMechanicsBulletsFor,
  autoSpellParts as sharedAutoSpellParts,
  briefDescription as sharedBriefDescription,
  abilityTooltip as sharedAbilityTooltip,
  MECHANICS_TITLES as SHARED_MECHANICS_TITLES,
  LANGUAGE_BULLET_LABEL as SHARED_LANGUAGE_BULLET_LABEL,
mechanicsSummaryForPicker as sharedMechanicsSummaryForPicker,
} from "./sheet/sheetMechanics.js";
import {
  cellsDelta,
  dragPos,
  resizeDims,
  scaleFieldRect,
  nodesBounds,
  duplicateOffset,
  cloneNodeWithNewIds,
  blockGrowthForDuplicate,
  partitionDuplicateSelection,
  nudgeTargets,
  nudgeNode,
} from "./sheet/sheetDrag.js";
import {
  parseFieldDropPayload,
  acceptsFieldDrop,
  buildHint,
  buildChip,
  showToastIn,
  buildToolbarShell,
  buildNameInput,
  buildRulesetSelect,
  buildStatusEl,
} from "./sheet/sheetToolbar.js";
import {
  resolveSourceBlock,
  effectiveStyleFor,
  effectiveBlockFor,
  blockTabsFor,
  parentBlockOfIn,
  colWidthFor,
  rectStyle,
  labelMaxWidth,
  shouldGrowForLabel,
  renderBlockFrameInto,
  applyGridLinesTo,
  renderBlockNodeInto,
  buildBlockToolbarInto,
  removeBlockFromLayout,
  removeFieldFromLayouts,
} from "./sheet/sheetBlocks.js";
import {
  dropdownVisibleChoices,
  isResizableField,
  renderFieldNodeInto,
  buildFieldToolbarInto,
  hasVisibleText as sharedHasVisibleText,
  updateFieldLabelVisibilityInto,
  wireGhostDefaultInto,
  renderFieldInnerInto,
  buildTextValueInto,
  buildLabelValueInto,
  buildTextareaValueInto,
  effectiveOptionCount,
  buildOptionsValueInto,
  personIconSvgMarkup as sharedPersonIconMarkup,
  buildAvatarPlaceholderSvg as sharedAvatarPlaceholder,
  readImageFileInto,
  clearOtherAvatarsIn,
  buildPictureValueInto,
  buildFeatureListValueInto,
  buildCatalogValueInto,
  moneyCandidatesByTab,
  openCatalogFieldConfigInto,
  buildEquationHintInto,
  cycleLabelPositionInto,
  buildTextListValueInto,
  buildTagListValueInto,
  openFieldTooltipEditorInto,
  buildCharacterLinkValueInto,
  openFieldTypeMenuInto,
} from "./sheet/sheetFields.js";
import {
levelFromMap,
activeChoiceGroupsFor,
normalizeChoiceGroup,
  applyStatModifiers as applySharedStatModifiers,
  computeSheetValuesIn,
  computeRadioOptionCountsIn,
  computeSpellSlotCountsIn,
  normalizeRadioSelectionsIn,
  prepareRenderState,
  LEVEL_UP_FIELDS as SHARED_LEVEL_UP_FIELDS,
  normalizeChoiceObjectsIn,
  narrowChoicesByBundleAccess,
  applySubclassFallback,
  isSubclassField,
  normalizeDropdownSelectionsIn,
  selectedRuleOptionsIn,
  selectedFeatBundlesIn,
  featChoiceGroupsFor,
  applyBundleModifiersIn,
  collectGrantedFeaturesIn,
  collectResourceGrantsIn,
  collectListItemGrantsIn,
  clampResourceSaved,
  ensureLevelData,
  renderResourceTrackersInto,
  renderLevelUpRowInto,
  renderLevelingTabInto,
  renderLevelingGlanceInto,
  buildLevelUpControl,
  buildRevertDialogBody,
  buildRevertControl,
  levelUpTarget,
  levelingRecordState,
  rawLevelFrom,
  LEVEL_CAP,
} from "./sheet/sheetLeveling.js";
import {
  ensureBundleShape,
  bundleIsEmptyShape,
  effectiveGrantNameFor,
  applyBundleLibraryToChoiceIn,
  MODIFIER_OPS as SHARED_MODIFIER_OPS,
  renderChoiceRowsInto,
  renderModifiersPanelInto,
  openChoicesEditorInto,
  rulesetBundleMatches,
  syncResultMessage,
  chooseTargetValue,
  migrateCreationChoiceKeys,
  matchLibraryForChosen,
} from "./sheet/sheetBundles.js";
import {
  creationChoiceGroupsForState,
  creationFixedBundlesFor,
  groupOptionsOf,
  racePickSatisfied as sharedRacePickSatisfied,
  nestedChoiceGroupsFor,
  slotLabelFor,
  isAsiSlotGroup,
  isFeaturePickGroup,
  assignFeatureSlot,
  withLiveBullets,
  languageSlotsFor,
  assignLanguageSlot,
  asiSlotsFor,
  assignAsiSlot,
  migrateAsiComboPicks,
  expressPicksFor,
  spellPicksCompleteForClass,
  magicalSecretsUnlocked,
  secretsPickedCount,
  secretsCompleteFor,
  sectionsForChoiceGroups,
  sectionsComplete,
  incompleteSectionNames,
  isChoiceSectionCollapsed,
  setChoiceSectionCollapsed,
  abilityScoreBonusesFrom,
  sanitizeSourceDefault,
  revalidateStagedPicks,
  pruneOrphanedChoiceKeys,
  orphanedSpellPickNames,
  migrateSpellPickKeys,
  preparedItemsWithAuto,
  preparedLineLock,
  applySpellPickWrite,
  preparedCountOver,
  levelUpSpellPickGroups,
  renderMagicalSecretsInto,
  spellRowView,
  preparedCounter,
  togglePreparedSpell,
  spellIsRitual,
  spellListDisplayRows,
  preparedOnlyFor,
  setPreparedOnlyFor,
  applySpellPickToItems,
  alwaysPreparedSpellNames,
  creationSpellPickGroups,
  spellPickDialogOptions,
  NO_SPELL_CATALOG_NOTE,
  spellPickShortfallPhrase,
  outstandingSteps,
  reconcileDropdownChoices,
  ownedSkillIdsFromBundles,
  optionIsOwned,
  groupPicksSatisfied,
  lockCommonInLanguageGroups as lockCommonGroups,
  reviewChoiceLinesFor,
  spellsForLevelIn,
  spellLevelByNameIn,
  findSpellCatalog,
  renderStepWizardInto,
  rulesetOptionNamesIn,
  renderPickerTableInto,
  renderChoiceGroupsInto,
  renderCrossCategoryChoiceInto,
  renderFlatChoiceOptionsInto,
  renderLiveBulletItem,
  openChoiceDialog,
  choiceDialogKindFor,
  flexibleAsiSummary,
  flexibleAsiSelection,
  buildFlexibleAsiChoice,
  ASI_ABILITY_CHOICES,
  spellCountByLevel as sharedSpellCountByLevel,
  canLearnMore as sharedCanLearnMore,
  availableSpellLevels as sharedAvailableSpellLevels,
  CATEGORY_FIELD as SHARED_CATEGORY_FIELD,
  catalogEntryInfoIn,
  bundleForIn,
  spellCountByLevel,

  ordinal,
  limitNoteText,
  canLearnMore,
  capMessage,
  ensureSpellListFieldIn,
  renderSpellPickerInto,
} from "./sheet/sheetWizard.js";
import {
  snapshotOf,
  shouldPushNewStep,
  pushBounded,
  ARROW_DELTAS as SHARED_ARROW_DELTAS,
  applyHistoryButtons,
  shortcutAction,
} from "./sheet/sheetHistory.js";
import { selectOnlySet, toggleInSet, selectionSignature } from "./sheet/sheetState.js";
import { findTab, tabIndex, layoutForTab, flattenFieldsAcrossTabs, defaultTabName, renderTabsInto, normalizeTabsIn } from "./sheet/sheetTabs.js";
import {
  styleToCss,
  applyCssToEl,
  nextLabelPosition,
  wrapSelectionWithStyle as sharedWrapSelection,
  applyDescendantTextStyleTo,
  applyTextStyleToOwnTextWith,
  applyStyleChangeInto,
  buildStylePopoverInto,
  buildStyleButtonInto,
} from "./sheet/sheetStyles.js";
import {
  wizardUnavailableMessageFor,
  renderRulesetStepInto,
  renderIdentityStepInto,
  renderClassStepInto,
  renderRowListStepInto,
  renderPreferencesStepInto,
  renderInnateAbilitiesStepInto,
  renderAbilitiesStepInto,
  reviewLinesFor,
  reviewSummaryBoxInto,
  reviewOutstandingInto,
  reviewFinishButtonInto,
  initPendingLevelState,
  pendingLevelHasPicks,
  syncPendingChoices,
  slotsSummary,
  alreadyAppliedPanel,
  conModFromScore,
  rollHpOnce,
  averageHpOnce,
  levelReviewSummary,
  levelReviewSectionsFor,
  validateLevelApply,
  renderGuideSubclassStepInto,
  renderGuideLevelClassStepInto,
  renderGuideAsiStepInto,
  renderGuideFeaturesStepInto,
  renderGuideHpStepInto,
  renderGuideNotesStepInto,
  renderStoryStepInto,
  STORY_FIELDS,
  checkLevelPrereqs,
  applyAsiToScores,
  buildLevelUpEntry,
  buildRevertRecord,
  revertRecordFor,
  highestRevertableLevel,
  revertUndoLines,
  revertConflictLines,
  ABILITY_DESCRIPTIONS as SHARED_ABILITY_DESCRIPTIONS,
  HP_METHOD_OPTIONS as SHARED_HP_METHOD_OPTIONS,
  POINT_BUY_MIN as SHARED_POINT_BUY_MIN,
  POINT_BUY_MAX as SHARED_POINT_BUY_MAX,
  POINT_BUY_BUDGET as SHARED_POINT_BUY_BUDGET,
  wizardFieldOptionNamesIn,
  applyLiveSubclassOverride,
  applyLiveSubclassOverrideToResolved,
  cleanStaleSubclass,
  appendFieldGroup,
} from "./sheet/sheetWizardSteps.js";
import { gridCanvasSize, renderMainGridInto } from "./sheet/sheetRender.js";
import { LAYOUT_PRESETS, applyLayoutPresetTo } from "./sheet/sheetLayouts.js";
import {
  ASPECT_PRESETS,
  DEFAULT_ASPECT_PRESET_ID,
  aspectPresetById,
  detectAspectPreset,
  stashedLayoutFor,
  switchTabToPreset,
  allAspectPresets,
  customAspectPresetsFor,
  makeCustomPreset,
  describeRatio,
  colsForRatio,
  parseRatio,
  clearLayoutVariant,
} from "./sheet/aspectPresets.js";
import { confirmDialog, alertDialog, promptDialog, chooseDialog } from "../ui/dialogs.js";
import { A11Y_OPTIONS, a11yEnabled, applyA11yMode } from "../ui/accessibility.js";
import { applySimpleViewOrder, narrowScreenNeedsStackedView, shouldShowIntro, INTRO_LINES } from "./sheet/simpleView.js";
import { featRowModels, renderFeatListInto } from "./sheet/featList.js";
import {
  allGrantsIn,
  levelingContextFor,
  levelingStepsIn,
} from "./sheet/levelingModel.js";
import {
  LINKED_DISPLAY_FIELDS,
  DEFAULT_LINKED_FIELDS,
  isLinkedSheetTab,
  linkedTabConfig,
  linkedSheetStatus,
  linkedSheetMessage,
  renderLinkedSheetInto,
} from "./sheet/linkedSheet.js";
import {
  ROLL_SIDES,
  rollCheck,
  openRollResultDialog,
  isRollRelevant,
} from "./sheet/sheetRolls.js";
import {
  WEAPON_STATS,
  ATTACK_CANTRIPS,
  normalizeWeaponName,
  suggestAttackLines,
  innateAttacksFromGrants,
} from "./sheet/sheetAttacks.js";
import {
  selectionBoxFor,
  paintSelectionInto,
  shouldResetGroupBorder,
  applyGroupBorderOverlay,
  buildDragHandle as sharedBuildDragHandle,
  buildResizeHandles as sharedBuildResizeHandles,
  positionFloatingToolbarAt,
  positionPopoverWithinViewportAt,
  closeOpenPopoversIn,
  wireHoverToolbarInto,
  buildGroupToolbarInto,
  groupToolbarHover,
  clickSelectionAction,
  dropCellFor,
} from "./sheet/sheetSelection.js";
import {
  MONEY_FIELD_NAMES as SHARED_MONEY_FIELD_NAMES,
  findMoneyFieldByNameIn,
  shouldAutoRegisterMoney,
  floatFromRichText,
  intFromRichText,
  appendUniqueTextListItemTo,
  selectedChoiceNameIn,
  findStarterFieldIn,
  missingSetupTargets,
  subclassNamesFromBundleRule,
  pointBuyCost as sharedPointBuyCost,
  maxAffordableScore,
  abilityModifier as sharedAbilityModifier,
  formatModifier as sharedFormatModifier,
  classGrantsAsiIn,
  classFeatureGrantsAtLevelIn,
  rollAbilityScore as sharedRollAbilityScore,
} from "./sheet/sheetRules.js";

export function renderCustomSheet(root, character, store, opts = {}) {
  // opts.onOpenCharacter(id) — used by Character Link fields (mounts,
  // companions) to jump to another sheet. Absent in contexts without
  // navigation (demo), where links display read-only instead.
  const openCharacterById = typeof opts?.onOpenCharacter === "function" ? opts.onOpenCharacter : null;
  // Set (not yet saved — see needsLevelFieldAutosave below, which
  // persists this once saveWithStatus/statusEl exist further down this
  // function; calling saveWithStatus this early would throw, since it
  // reads the `const statusEl` declared later in this same scope).
  let needsLevelFieldAutosave = false;
  if (!character.layout) {
    character.layout = createStarterLayout();
    // createStarterLayout() pins this field's id to the literal string
    // "level" (see the `field(opts, "level")` call in blockModel.js) —
    // stable and predictable specifically so callers like this one can
    // reference it before the field has even been rendered once. Without
    // this, currentLevel() has no designated field to read and every
    // minLevel-gated bundle rule (stat grants, dropdown access, feature
    // grants) treats the character as unlocked at every level — not
    // wrong exactly, just not what "leveling" should mean by default.
    // Only applies to brand-new characters; anyone who already
    // (re)designated a different field, or unset it on purpose, keeps
    // that choice — this only fires the one time layout itself is seeded.
    if (!character.levelFieldId) {
      character.levelFieldId = "level";
      needsLevelFieldAutosave = true;
    }
    // Brand-new character (this is the very first time it's ever had a
    // layout) — hold off on showing any sheet at all until the
    // Character Setup wizard finishes. See activeTab()/renderAll() for
    // where this actually hides the tab bar and forces the wizard tab.
    character.setupComplete = false;
    // Persist the unfinished flag right away (silently — statusEl
    // doesn't exist yet this early): otherwise closing before Finish
    // Setup and reopening would see a layout but no flag and jump
    // straight to the sheet instead of resuming the wizard.
    if (store.saveCharacterFields) {
      store.saveCharacterFields(character.id, { setupComplete: false }).catch((err) => {
        console.error("Failed to save setup state:", err);
      });
    } else if (store.saveCharacterField) {
      store.saveCharacterField(character.id, "setupComplete", false).catch((err) => {
        console.error("Failed to save setup state:", err);
      });
    }
  }
  // Anything that already had a layout before this feature existed
  // never touched the branch above, so it never got setupComplete set
  // at all — treat that as "already set up" rather than dropping
  // existing characters back into the wizard.
  if (character.setupComplete === undefined) character.setupComplete = true;
  normalizeTabs();
  healLegacySubsumedRaces();
  healStaleRaceChoices();

  /** Starter Race dropdown choices embed their bundles at creation, so
   *  characters made before a race rework still carry the old bundle —
   *  and the wizard reads those embedded copies, hiding new pickers
   *  (e.g. subraces) and showing retired traits. Refresh any choice
   *  whose bundle is an uncustomized older copy (identical to canonical
   *  modulo its choice groups), drop unselected choices for removed
   *  races, and add missing current races. Anything customized (or a
   *  homebrew typed-in race) is left strictly alone. Silent, once per
   *  open — same as the legacy-species heal above. */
  function healStaleRaceChoices() {
    const raceField = findStarterField("race", "Race");
    if (!raceField || !Array.isArray(raceField.choices)) return;
    const result = reconcileDropdownChoices(
      raceField.choices, raceField.selected, FIXED_RACE_ENTRIES, SUPERSEDED_RACE_NAMES,
      () => newId(), (v) => clone(v), legacyRaceBundles()
    );
    if (!result.changed) return;
    raceField.choices = result.choices;
    raceField.selected = result.selectedId;
    saveSilent({ layout: character.layout, sheetTabs: character.sheetTabs });
  }

  /** Silent store write for open-time healing (statusEl doesn't exist
   *  yet this early) — best-effort only; worst case the heal simply
   *  re-runs next open. */
  function saveSilent(patch) {
    if (store.saveCharacterFields) {
      store.saveCharacterFields(character.id, patch).catch((err) => {
        console.error("Failed to save sheet healing:", err);
      });
    } else if (store.saveCharacterField) {
      Promise.all(Object.entries(patch).map(([fieldId, value]) => store.saveCharacterField(character.id, fieldId, value))).catch((err) => {
        console.error("Failed to save sheet healing:", err);
      });
    }
  }

  /** Characters created before Hill/Mountain/Duergar became Dwarf
   *  subraces (or Air/Earth/Fire/Water Genasi became Genasi subraces)
   *  still hold the old race name, which no longer exists as a race
   *  choice: point them at the base race plus the matching subrace
   *  pick, so nothing is lost. Runs once per sheet open; silent
   *  (statusEl doesn't exist yet this early). */
  function healLegacySubsumedRaces() {
    const LEGACY_SUBRACE_OPTION = {
      "Hill Dwarf": { base: "Dwarf", groupId: "dwarf-subrace", optionId: "dwarf-subrace-hill-dwarf" },
      "Mountain Dwarf": { base: "Dwarf", groupId: "dwarf-subrace", optionId: "dwarf-subrace-mountain-dwarf" },
      "Duergar": { base: "Dwarf", groupId: "dwarf-subrace", optionId: "dwarf-subrace-duergar" },
      "Air Genasi": { base: "Genasi", groupId: "genasi-subrace", optionId: "genasi-subrace-air-genasi" },
      "Earth Genasi": { base: "Genasi", groupId: "genasi-subrace", optionId: "genasi-subrace-earth-genasi" },
      "Fire Genasi": { base: "Genasi", groupId: "genasi-subrace", optionId: "genasi-subrace-fire-genasi" },
      "Water Genasi": { base: "Genasi", groupId: "genasi-subrace", optionId: "genasi-subrace-water-genasi" },
    };
    const legacy = LEGACY_SUBRACE_OPTION[character.rules?.species];
    if (!legacy) return;
    const raceField = findStarterField("race", "Race");
    const baseChoice = raceField?.choices?.find((c) => c.text === legacy.base && c.bundle);
    if (!raceField || !baseChoice) return;
    raceField.selected = baseChoice.id;
    const group = (baseChoice.bundle?.choiceGroups || []).find((g) => g.id === legacy.groupId);
    if (group) {
      // Same key shapes the pickers use: the live creation key while
      // the setup wizard is still open, otherwise the sheet
      // dropdown's real key (ids are per-character, hence computed
      // here rather than hardcoded).
      const key = character.setupComplete === false
        ? `creation:Race:${legacy.base}:${group.id}`
        : `${raceField.id}:${baseChoice.id}:${group.id}`;
      character.rules.choices = character.rules.choices || {};
      if (!character.rules.choices[key]) character.rules.choices[key] = [legacy.optionId];
    }
    character.rules.species = legacy.base;
    if (store.saveCharacterFields) {
      store.saveCharacterFields(character.id, { rules: character.rules }).catch((err) => {
        console.error("Failed to migrate legacy subrace:", err);
      });
    } else if (store.saveCharacterField) {
      store.saveCharacterField(character.id, "rules", character.rules).catch((err) => {
        console.error("Failed to migrate legacy subrace:", err);
      });
    }
  }

  let editMode = false;
  let activeTabId = (!character.setupComplete && character.sheetTabs.find(tab => tab.kind === "rules")?.id) || character.sheetTabs[0].id;
  // Which blocks are collapsed in the sidebar's Stat Blocks list —
  // lives here (not inside renderBlockFrame) since that function
  // rebuilds the list from scratch on every call and would otherwise
  // forget the state immediately.
  const collapsedBlockIds = new Set();
  // Same reasoning, for which Leveling-tab rows are expanded.
  const expandedLevelUpRows = new Set();
  // Step position for the Character-setup and Leveling wizards — same
  // "must survive a full renderPageGrid() rebuild" reasoning as above.
  // Kept as plain {index, stepId} objects (not just a number) so step
  // definitions below can close over and mutate them directly.
  // stepId seeds from the character's persisted wizard progress (see
  // persistWizardProgress below), so closing mid-wizard and reopening
  // later resumes the same page instead of starting over.
  const creationWizardState = {
    index: 0,
    stepId: typeof character.creationStepId === "string" ? character.creationStepId : null,
  };
  const levelingWizardState = {
    index: 0,
    stepId: typeof character.levelingStepId === "string" ? character.levelingStepId : null,
  };
  // In-progress answers for whichever level's guide is currently open,
  // keyed by level so switching levels doesn't mix them up. Lives out
  // here (not as a local inside renderRulesetLevelGuide) so a value
  // typed on one wizard step survives navigating to another step and
  // back — every Next/Back/step-dot click does a full renderPageGrid(),
  // which would otherwise reset any local variable back to its default.
  // Cleared for a level once that level's changes are actually applied.
  // Seeded from the character's persisted copy (see
  // persistWizardProgress below) so in-progress level-up picks also
  // survive closing and reopening the sheet — cloned, so live edits
  // here never dirty the stored snapshot except through a real save.
  const levelingPendingState = restoreLevelingPending(character.levelingPending);
  function restoreLevelingPending(stored) {
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    try {
      return JSON.parse(JSON.stringify(stored));
    } catch {
      return {};
    }
  }
  const undoStack = [];
  const redoStack = [];
  // Multi-select: which block/field ids are currently selected. Most
  // interactions keep this at size 0 or 1 (plain click, drag, resize —
  // see selectOnly/selectBlockAndFields below); Ctrl/Shift-click grow it.
  // Kept as the source of truth for Delete/Escape and for the
  // .is-selected border styling — see paintSelection().
  let selectedIds = new Set();
  // Recomputed at the start of every renderPageGrid() — id (or
  // id::checkboxIndex) -> current numeric value. Read by buildFieldValue
  // to display a formula field's computed result.
  let formulaValues = {};
  // Same idea, for a radio field's optional "how many buttons" formula
  // (see field.optionsFormula, and the "=" button on a radio field's
  // toolbar) — kept separate from formulaValues since a button COUNT
  // isn't a meaningful variable for other formulas to reference the
  // way a field's own value is.
  let radioOptionCounts = {};
  // Same idea again, but for the sheet's standard spell-slot fields
  // (slots1-slots9 in the Spellcasting block) — {fieldId: count},
  // recomputed by computeSpellSlotCounts alongside radioOptionCounts
  // every render, from the sheet's actual Class dropdown selection and
  // current Level rather than from a user-authored optionsFormula (no
  // formula could reasonably reproduce the per-class/per-level slot
  // tables in dnd5e.js). This is what makes a slot field's button
  // count track your class/level live instead of only updating the
  // two moments something writes a fresh number into field.options
  // (Finish Setup at creation, Apply on a level-up) — see buildFieldValue's
  // "radio" branch for how it's used as a live override the same way
  // radioOptionCounts already is.
  let spellSlotCounts = {};
  // Reset at the start of every renderPageGrid() and filled in by
  // renderFieldInner as it builds each field's labelEl. A field just
  // built is off-DOM (not yet appended anywhere), so checking its
  // labelEl's scrollWidth/clientWidth right then is meaningless —
  // both read 0 until the element actually has layout. Queuing the
  // check here and running it once everything is appended (see the
  // end of renderPageGrid) is what makes a too-long DEFAULT label
  // (one nobody typed, so the existing input-event listener never
  // fires for it) grow to fit on first paint, the same way one a
  // person edits by hand already does.
  let pendingLabelOverflowChecks = [];
  // Which checkboxes are currently checked because a Race/Class (or
  // any dropdown) bundle grants them — "fieldId::index" strings — see
  // the "grant" op in applyBundleModifiers. Recomputed alongside
  // formulaValues/radioOptionCounts every render; buildFieldValue's
  // checkbox branch ORs this into a checkbox's own field.checked
  // state, and disables the box while granted (see the comment there
  // for why a granted box isn't independently uncheckable).
  let grantedCheckboxes = new Set();
  // Same idea as grantedCheckboxes, for "taglist" fields (Languages,
  // Armor/Weapon/Tool Proficiencies) — a "grantTag" statModifier op
  // adds its value here instead of toggling a checkbox, since a
  // taglist's state is an array of known tag strings rather than a
  // fixed set of indexed boxes. Map<fieldId, Set<tagValue>>.
  let grantedTags = new Map();
  // Every currently-unlocked feature grant across all active bundles, at
  // the character's current level — [{ name, description, level, source }],
  // sorted by level then source. Recomputed by collectGrantedFeatures
  // alongside grantedCheckboxes each time computeSheetValues runs; read by
  // buildFeatureListValue to render a "featureList" field. See the "grant"
  // op comment on applyBundleModifiers for why this mirrors that mechanism
  // rather than living in valueMap: like a granted checkbox, a feature's
  // presence is a per-render computed fact, not stored character data.
  let grantedFeatures = [];
  // Cached list of reusable bundle-library entries (see
  // bundleLibraryEditor.js) — refreshed on load and whenever the
  // manager reports a save/delete, so the "Apply from Library" picker
  // in a choice's Modifiers panel doesn't re-fetch on every render.
  let bundleLibraryCache = [];
  async function refreshBundleLibraryCache() {
    if (!store.listBundleLibraries) return;
    try {
      bundleLibraryCache = await store.listBundleLibraries();
      // Backfill the explicit bundle -> catalog link on any library entry
      // saved before that field existed. Purely a one-time read-time fixup:
      // the link is recomputed from the name here, and every later lookup
      // goes through the id, so a rename later can't break the pairing.
      // Nothing is written back to storage — the in-memory copy carries the
      // link, and re-saving the entry from the editor persists it.
      if (bundleLibraryCache.length) {
        const { bundles, linked, unresolved } = migrateBundleCatalogLinks(bundleLibraryCache, catalogCache);
        bundleLibraryCache = bundles;
        if (linked.length) console.info(`[catalogLinks] linked ${linked.length} bundle(s): ${linked.join(", ")}`);
        // Left unlinked rather than guessed at: the flavor lookup still
        // falls back to matching by name, which is exactly today's
        // behavior, so these render as they always have.
        if (unresolved.length) console.info(`[catalogLinks] no catalog entry for ${unresolved.length} bundle(s): ${unresolved.join(", ")}`);
      }
      // The creation wizard's Race/Class/Background row-lists (and the
      // choice-group pages derived from them) render synchronously off
      // this cache the first time the Rules tab is opened, which can
      // easily race ahead of this fetch on a slow connection — without
      // this, that first paint would be stuck showing "No options
      // found yet" forever, since nothing else re-renders once the
      // real data arrives.
      if (activeTab().kind === "rules") renderPageGrid();
    } catch (err) {
      console.error("Failed to load bundle libraries:", err);
    }
  }
  // One-off cleanup, run once when the sheet first loads (not on every
  // refreshBundleLibraryCache() call — repeat uploads are prevented up
  // front instead, see bundleLibraryEditor.js) to clear out duplicate
  // bundles that already exist in the library.
  if (store.dedupeBundleLibraries) {
    store.dedupeBundleLibraries()
      .then(({ removed }) => {
        if (removed > 0) refreshBundleLibraryCache();
      })
      .catch((err) => console.error("Failed to dedupe bundle libraries:", err));
  }
  // Same idea, for Catalog fields' "which catalog" picker (see
  // openCatalogFieldConfig below).
  // Baked-in reference catalogs (Classes/Races/Backgrounds from
  // DEFAULT_CONTENT) plus the Feats catalog compiled from
  // docs/New Info/5e-feats.txt (see js/data/featBundles.js) — the ASI step's
  // feat picker shows each feat's prerequisite + full effect text from here.
  let catalogCache = DEFAULT_CONTENT.catalogs.map((cat, i) => ({ id: `default-${i}`, scope: "default", ...cat }));
  // Descriptions for the five hand-added core races (Human/Elf/
  // Half-Elf/Half-Orc/Tiefling — see js/data/extraRaces.js) so the
  // setup wizard's Race picker shows flavor text for them too.
  // Appended once here rather than baked into defaultContent.js (which
  // is auto-generated and must stay regenerable as-is).
  const racesCatalog = catalogCache.find((c) => (c.name || "").toLowerCase() === "races");
  if (racesCatalog && !((racesCatalog.tabs?.[0]?.entries) || []).some((e) => e.name === "Human")) {
    racesCatalog.tabs[0].entries = [...racesCatalog.tabs[0].entries, ...RACE_EXTRA_CATALOG_ENTRIES];
  }
  if (!catalogCache.some((c) => (c.name || "").toLowerCase() === "feats")) {
    catalogCache = [...catalogCache, { id: "default-feats", scope: "default", ...FEAT_CATALOG }];
  }
  // Spell + equipment reference catalogs compiled from
  // docs/New Info/5e-spells.txt and 5e-items.txt (see
  // js/data/contentCatalogs.js). The setup/leveling spell picker keys
  // off the catalog whose name mentions "spell"; the equipment
  // catalogs are reference rows for the catalog browser.
  for (const [id, catalog] of [["default-spells", SPELL_CATALOG], ["default-weapons-armor", WEAPONS_ARMOR_CATALOG], ["default-gear", GEAR_CATALOG]]) {
    if (!catalogCache.some((c) => (c.name || "") === catalog.name)) {
      catalogCache = [...catalogCache, { id, scope: "default", ...catalog }];
    }
  }
  // Mint a stable id on every baked-in catalog entry that lacks one, so
  // bundles can point at their flavor/portrait entry by id instead of by
  // name — a rename on either side then can't silently break the pairing.
  // Runs last so it also covers RACE_EXTRA_CATALOG_ENTRIES, appended
  // above. User-imported catalogs (merged in by refreshCatalogCache) keep
  // whatever ids they arrived with; they're another person's data.
  assignCatalogEntryIds(catalogCache);
  // Bundle libraries load AFTER the catalogs above, because loading them is
  // also where legacy entries (saved before bundles carried an explicit
  // link) get backfilled — see migrateBundleCatalogLinks, which matches
  // those old name-only entries against the ids just minted.
  refreshBundleLibraryCache();
  async function refreshCatalogCache() {
    if (!store.listCatalogs) return;
    try {
      const fetched = await store.listCatalogs();
      catalogCache = [...catalogCache.filter((c) => c.scope === "default"), ...fetched];
      // Same race-on-first-load reasoning as refreshBundleLibraryCache
      // above — the wizard's row-list descriptions/portraits are
      // sourced from this cache, and nothing else re-renders once it
      // arrives.
      if (activeTab().kind === "rules") renderPageGrid();
    } catch (err) {
      console.error("Failed to load catalogs:", err);
    }
  }
  refreshCatalogCache();

  root.innerHTML = "";

  // Spell links.
  //
  // A spell named in a race trait, a class feature or a feat is a link to
  // that spell's entry. The links are rebuilt on every render (they're
  // produced inside the text renderers, which have no access to the
  // character), so they're bound to a module-level opener set here rather
  // than closing over this scope.
  //
  // Opening one is a dialog, because the sheet has no spell book to jump
  // to: the `spellsKnown` text list is a flat list of names, so there's an
  // entry to show for a spell the character knows and only the printed text
  // for one they don't.
  setSpellLinkOpener((spellName) => {
    if (!spellName) return;
    const known = knownSpellNames().has(spellName.toLowerCase());
    openSpellDetailDialog({
      name: spellName,
      known,
      onGoToSpellList: (name) => revealSpellOnSheet(name),
    });
  });

  // --- Toolbar: mode toggle + add-block (edit mode only) --------------
  const { toolbar, leftGroup, modeBtn, undoBtn, redoBtn, addBlockBtn } = buildToolbarShell();

  // --- Simple / Sheet view toggle ---
  //
  // Simple View is a DISPLAY mode only. It stacks every block into a
  // full-width section and every field into a full-width row, but the
  // saved x/y/w/h are never touched: switching back restores the grid
  // exactly as it was. The only thing written to the DOM is a flex
  // `order` on each node (see simpleView.js) and a class on the grid,
  // both of which are removed again on the way out.
  //
  // Persisted on the character, like sheetMode and themeId. It used to
  // start off on every single load, which made it a preference you had to
  // re-assert every session - and a display preference is exactly the kind
  // of thing anyone expects to have remembered. Read once here; every later
  // read goes through simpleView so there is one source of truth.
  let simpleView = character.simpleView === true;
  // The PREFERENCE, kept separate from the effective state below: on a
  // screen too narrow for the grid the stacked display is forced, but that
  // must not overwrite what the player chose on a screen that fits.
  let simpleViewPreferred = simpleView;
  // Why stacking is being forced, or null when it isn't. Drives the
  // disabled state and the wording of the toggle.
  let forcedStacked = false;

  /** How wide the positioned grid actually is right now, and how much room
   *  it has. Measured rather than guessed, so this follows the column
   *  count, the cell floor, the sidebar and the window. */
  function gridFitNow() {
    const wrap = scrollWrapper || root;
    const availableWidth = wrap.clientWidth || root.clientWidth || 0;
    // The grid's own DECLARED width, which the renderer stamps from the
    // cell math (see gridCanvasSize). The declaration, not the rendered
    // box: in the stacked layout the rendered box is 100% of the wrapper,
    // so measuring IT would say "it fits" the instant the sheet stacked -
    // and the next resize would un-stack it, which puts the grid back to
    // overflowing. Reading the declaration is the same number in both
    // modes, so the decision cannot oscillate. Falls back to the measured
    // box for the tabs that clear the width (leveling, rules), which are
    // fluid by design and never need stacking.
    const declared = parseFloat(pageGrid?.style?.width || "");
    const gridWidth = Number.isFinite(declared) && declared > 0
      ? declared
      : Math.max(pageGrid?.scrollWidth || 0, pageGrid?.clientWidth || 0);
    return { gridWidth, availableWidth };
  }

  /** Re-decide whether the stacked layout is being forced by width, and
   *  apply the result if it changed. Called on load, on the view toggle,
   *  and on every resize, so rotating a phone or dragging a desktop
   *  window across the threshold switches the sheet rather than leaving
   *  it unscrollable. */
  function syncStackedForWidth() {
    const forced = narrowScreenNeedsStackedView(gridFitNow());
    if (forced === forcedStacked) return false;
    forcedStacked = forced;
    const wanted = forced || simpleViewPreferred;
    if (wanted !== simpleView) applySimpleView(wanted, { persist: false });
    else syncViewToggleState();
    return true;
  }

  /** The toggle's label/title/disabled state, in one place so the forced
   *  and preferred paths can never leave it describing the wrong thing. */
  function syncViewToggleState() {
    playViewBtn.textContent = simpleView ? "Sheet View" : "Simple View";
    playViewBtn.disabled = forcedStacked;
    playViewBtn.title = forcedStacked
      ? "Sheet View is off on a screen this narrow - the grid needs about 790px and would scroll sideways instead of fitting. Everything is stacked full-width here; Sheet View returns on a wider screen."
      : (simpleView
        ? "Switch back to the editable grid - your saved layout is exactly where you left it"
        : "Switch to Simple View - every block and field stacked full-width (display only; your layout is untouched)");
  }

  /** Turn Simple View on or off: the grid class, the sort keys, the
   *  builder chrome that means nothing over a read-only stacked view, and
   *  (unless `persist` is false) the character. One function so the button,
   *  the first-load restore, the width rule and the tab switch can never
   *  disagree about what state the sheet is in. */
  function applySimpleView(on, { persist = true } = {}) {
    simpleView = Boolean(on);
    if (persist) simpleViewPreferred = simpleView;
    syncViewToggleState();
    pageGrid.classList.toggle("is-simple", simpleView);
    // The scroller gets its own class rather than being reached through
    // `:has()` on the grid: CSS relational selectors are recent enough to
    // be missing in older Safari and Firefox, and this is the rule that
    // keeps a phone sheet from scrolling sideways.
    scrollWrapper?.classList.toggle("page-grid-scroll--stacked", simpleView);
    applySimpleViewOrder(pageGrid, simpleView);
    // Which builder chrome to hide follows the CHOICE, not the layout.
    //
    // Simple View used to be something you picked, and hiding the toolbar
    // with it was right: nothing in there can act on a read-only stacked
    // view. Below the width the grid cannot fit, though, the stacked layout
    // is forced on someone who never chose it - and the Display panel (print,
    // theme, ruleset, reading options) has nothing to do with the layout at
    // all. Hiding it there would take away features a phone still needs, to
    // satisfy a rule about dragging blocks.
    const readOnly = simpleViewPreferred;
    sidebarToggleBtn.style.display = readOnly ? "none" : "";
    modeSelect.style.display = readOnly ? "none" : "";
    rulesetSelect.style.display = readOnly ? "none" : "";
    themeSelect.style.display = readOnly ? "none" : "";
    displayDetails.style.display = readOnly ? "none" : "";
    cardZonesWrap.hidden = readOnly;
    if (!persist) return;
    character.simpleView = simpleView;
    if (!store.saveCharacterFields) return;
    store.saveCharacterFields(character.id, { simpleView }).catch((err) => {
      console.error("Failed to save Simple View preference:", err);
    });
  }

  const playViewBtn = document.createElement("button");
  playViewBtn.type = "button";
  playViewBtn.className = "btn btn--secondary";
  playViewBtn.textContent = simpleView ? "Sheet View" : "Simple View";
  playViewBtn.title = "Switch to Simple View - every block and field stacked full-width (display only; your layout is untouched)";
  playViewBtn.addEventListener("click", () => {
    if (forcedStacked) return;
    const turningOn = !simpleView;
    applySimpleView(turningOn);
    if (!turningOn) {
      // Leaving Simple View is the only transition that needs a rebuild:
      // the order values are cleared above, so the grid is back to its
      // normal pixel positioning, and renderAll restamps everything that
      // depends on the grid being laid out.
      renderAll();
    }
  });
  // modeBtn lives inside leftGroup, not directly under toolbar —
  // inserting against toolbar throws NotFoundError and aborts the
  // rest of this function (leaving later consts like pageGrid in TDZ
  // for the async library/catalog refreshes).
  leftGroup.insertBefore(playViewBtn, modeBtn);

  // Toggles the Stat Blocks sidebar closed — mainly useful on
  // narrower screens (see the @media rule for .sheet-block-frame in
  // custom-sheet.css), where it becomes a floating overlay instead of
  // a permanent column, so hiding it gives the grid its full width
  // back. Available at any width, not just narrow ones, since there's
  // no harm in that.
  let sidebarCollapsed = window.innerWidth <= 860; // starts hidden on narrow screens, matching the @media breakpoint below — desktop is unaffected (false, same as before this existed)
  const sidebarToggleBtn = el("button", {
    type: "button", class: "btn", text: "☰ Blocks", title: "Show/hide the Stat Blocks list",
    onclick: () => { sidebarCollapsed = !sidebarCollapsed; syncSidebarVisibility(); },
  });
  toolbar.append(sidebarToggleBtn);

  // Bundle Libraries / Catalogs toolbar buttons — hidden for now, per
  // Shawn's call to stop fighting the import/homebrew pipeline and
  // just ship real baked-in content instead (see defaultContent.js
  // and RESCUE-NOTES.md). Not deleted: openBundleLibraryManager/
  // openCatalogLibraryManager and their Firestore-backed storage are
  // still here for whenever homebrew import comes back as its own
  // project — this just takes the two buttons out of everyday reach.
  // (A "Manage Catalogs…" button still exists inside a "catalog"
  // field's own config popover, further down this file — left alone
  // since it's a niche, rarely-reached path, not the main friction.)

  // A plain, non-customizable name field — deliberately outside the
  // draggable/relabelable grid. The character LIST view needs a
  // reliable "this is the name" field, and once everything on the
  // sheet itself can be freely relabeled and rearranged, there's no
  // way to reconstruct that from the layout alone.
  const nameInput = buildNameInput(character.name || "");
  nameInput.addEventListener("input", () => { unsavedChanges = true; });
  nameInput.addEventListener("input", debounce(() => {
    character.name = nameInput.value;
    saveWithStatus("name", nameInput.value);
  }, 400));
  toolbar.append(nameInput);

  // Display prefs (theme, light/dark, screen/print, print button)
  // live one click away in a "Display" dropdown instead of taking up
  // permanent toolbar room — the everyday row stays: mode, undo/redo,
  // blocks toggle, name, card-fields toggle, status.
  const displayPanel = el("div", { class: "toolbar-display__panel" });
  const displayDetails = el("details", { class: "toolbar-display" },
    el("summary", { class: "btn", text: "Display", title: "Visual theme, light/dark, screen/print, printing, layout presets" }),
    displayPanel);
  toolbar.append(displayDetails);

  function displayRow(labelText, ...controls) {
    const row = el("div", { class: "toolbar-display__row" },
      el("span", { class: "toolbar-display__label", text: labelText }),
      ...controls);
    displayPanel.append(row);
    return row;
  }

  // Rulesets are game systems; content comes from books (content
  // packs) under them. The generic level-up guide and subclass
  // dropdown use this saved selection instead of hardcoded class
  // logic. Single source of truth is character.rules (rulesetId = the
  // PRIMARY SYSTEM for level-up math, rulesetIds = the CONTENT PACKS
  // included for option lists); the top-level character.rulesetId
  // mirror exists for older saves and is kept in sync on every write
  // (plus backfilled in normalizeTabs), so either read path agrees.
  function currentRulesetId() {
    return primaryRulesetId(character.rules) || character.rulesetId || null;
  }
  function includedRulesetIdsFor() {
    const ids = includedRulesetIds(character.rules);
    if (ids.length > 0) return ids;
    const legacy = character.rulesetId;
    return legacy ? includedRulesetIds({ rulesetId: legacy }) : [];
  }
  function setRulesetId(next) {
    character.rulesetId = next;
    character.rules = normalizeRulesState(character.rules);
    character.rules.rulesetId = next;
    // A system with no books checked yet picks up its default books,
    // so a lone-system selection never leaves an empty content list.
    if (next && includedRulesetIds(character.rules).length === 0) {
      character.rules.rulesetIds = defaultContentPackIds(next);
    }
    // Save BOTH copies: "rules" alone would leave the top-level mirror
    // stale on reload (which is exactly how the toolbar used to come
    // back unset while everything else worked).
    saveWithStatus("rules", character.rules);
    saveWithStatus("rulesetId", character.rulesetId);
  }
  /** Sets the included content books (wizard page 1). The primary
   *  system stays put when it still owns one of the books, else falls
   *  to whatever system the first checked book belongs to. */
  function setIncludedRulesetIds(nextIds) {
    const ids = [...new Set((nextIds || []).filter(Boolean))];
    const prevRuleset = (() => {
      const prev = currentRulesetId();
      return getRuleset(prev) ? prev : null;
    })();
    character.rules = normalizeRulesState(character.rules);
    character.rules.rulesetIds = ids;
    const firstPack = getContentPack(ids.find((id) => getContentPack(id)) || "");
    character.rules.rulesetId = prevRuleset || (firstPack?.rulesetId || prevRuleset);
    character.rulesetId = character.rules.rulesetId;
    saveWithStatus("rules", character.rules);
    saveWithStatus("rulesetId", character.rulesetId);
  }
  function refreshRulesetSelect() {
    rulesetSelect.value = currentRulesetId() || "";
  }
  const rulesetSelect = buildRulesetSelect(listRulesets(), currentRulesetId() || "");
  rulesetSelect.title = "Game system for guided leveling (page 1 of Character Setup picks which content books are included)";
  rulesetSelect.addEventListener("change", () => {
    setRulesetId(rulesetSelect.value || null);
    const syncMessage = syncRulesetBundles(includedRulesetIdsFor());
    renderAll();
    if (syncMessage) statusEl.textContent = syncMessage;
  });
  displayRow("Ruleset", rulesetSelect);

  // Re-run the ruleset auto-sync on demand — e.g. after importing more
  // bundles for a ruleset that's already selected, since selecting the
  // same value again wouldn't fire the <select>'s change event.
  const rulesetSyncBtn = el("button", {
    type: "button", class: "btn formula-toolbar__btn", text: "↻ Re-apply",
    title: "Re-apply included sources' bundles (after importing more, for example)",
    onclick: () => {
      const syncMessage = syncRulesetBundles(includedRulesetIdsFor());
      renderAll();
      if (syncMessage) statusEl.textContent = syncMessage;
    },
  });

  // Display prefs (theme, light/dark, screen/print, print button,
  // layout presets, primary ruleset) live one click away in the
  // "Display" dropdown above — the everyday row stays short.

  // Display prefs, changeable anytime: color theme + light/dark
  // variant + screen/print mode + a print button. Theme, variant, and
  // mode persist on the character.
  const themeSelect = document.createElement("select");
  themeSelect.className = "input-group__control";
  themeSelect.style.maxWidth = "200px";
  themeSelect.title = "Visual theme for this character sheet";
  SHEET_THEMES.forEach((theme) => {
    themeSelect.append(el("option", { value: theme.id, text: theme.name }));
  });
  const effectiveThemeId = () => normalizeThemeId(character.themeId);
  const effectiveThemeMode = () => character.themeMode
    ? normalizeThemeMode(character.themeMode, character.themeId)
    : (character.themeId === "light" || character.sheetMode === "print" ? "light" : "dark");
  themeSelect.value = effectiveThemeId();
  const lightModeCheckbox = el("input", { type: "checkbox", checked: effectiveThemeMode() === "light" });
  const lightModeLabel = el("label", { class: "theme-mode-toggle", title: "Light mode version of this theme" }, lightModeCheckbox, " Light");
  const applyAndPersistTheme = () => {
    character.themeId = themeSelect.value;
    character.themeMode = lightModeCheckbox.checked ? "light" : "dark";
    applySheetTheme(character.themeId, character.themeMode);
    saveWithStatus("themeId", character.themeId);
    saveWithStatus("themeMode", character.themeMode);
  };
  applySheetTheme(effectiveThemeId(), effectiveThemeMode());
  themeSelect.addEventListener("change", applyAndPersistTheme);
  lightModeCheckbox.addEventListener("change", applyAndPersistTheme);
  displayRow("Theme", themeSelect);
  displayRow("Brightness", lightModeLabel);

  // Accessibility options. Stored on the character alongside themeId and
  // sheetMode, so they follow it across devices the same way - somebody who
  // needs one of these needs it on every device, and re-discovering that on
  // each login is exactly the failure an accessibility feature must not
  // have.
  //
  // Applied BEFORE the theme on the way in and not inside applyAndPersistTheme
  // on purpose: they are independent, so changing a theme must not silently
  // reset them and changing one must not reset the other.
  const a11yToggles = A11Y_OPTIONS.map((opt) => {
    const box = el("input", { type: "checkbox" });
    box.checked = a11yEnabled(character.a11y, opt.id);
    const row = el("label", {
      class: "toolbar-display__a11y",
      // The description is in the title because a Display dropdown row is
      // too narrow for a sentence, and the reason these exist is not
      // obvious from the label alone.
      title: opt.description,
    }, box, ` ${opt.name}`);
    return { opt, box, row };
  });
  const a11yRow = displayRow("Reading", ...a11yToggles.map((t) => t.row));
  a11yRow.classList.add("toolbar-display__row--stack");
  const applyA11yPrefs = () => {
    const next = {};
    for (const { opt, box } of a11yToggles) next[opt.id] = box.checked;
    character.a11y = next;
    applyA11yMode(next);
    store.saveCharacterFields(character.id, { a11y: next }).catch((err) => {
      console.error("Failed to save accessibility preferences:", err);
    });
  };
  for (const { box } of a11yToggles) box.addEventListener("change", applyA11yPrefs);
  // Restored on load, not only on change - a preference that only takes
  // effect after you toggle it off and on again is not a preference.
  applyA11yMode(character.a11y);

  const modeSelect = document.createElement("select");
  modeSelect.className = "input-group__control";
  modeSelect.style.maxWidth = "150px";
  modeSelect.title = "How you'll mainly use this sheet — changeable anytime here";
  [["screen", "Use on screen"], ["print", "Print out"]].forEach(([value, label]) => {
    modeSelect.append(el("option", { value, text: label }));
  });
  modeSelect.value = character.sheetMode || "screen";
  modeSelect.addEventListener("change", () => {
    character.sheetMode = modeSelect.value;
    // Print reads best on a light background — switch there on the
    // way in (still overridable afterward via the Light checkbox).
    if (character.sheetMode === "print" && effectiveThemeMode() !== "light") {
      lightModeCheckbox.checked = true;
      applyAndPersistTheme();
    }
    saveWithStatus("sheetMode", character.sheetMode);
  });
  displayRow("Use", modeSelect);

  // One-click block arrangements (Single Column, Two Column, Combat
  // First). Rearranges every tab's blocks in one undoable step after
  // confirming — children, styles, and content are untouched.
  const layoutSelect = document.createElement("select");
  layoutSelect.className = "input-group__control";
  layoutSelect.title = "Rearrange every tab's blocks with a preset layout (undoable)";
  layoutSelect.append(el("option", { value: "", text: "Apply a layout…" }));
  LAYOUT_PRESETS.forEach((preset) => {
    layoutSelect.append(el("option", { value: preset.id, text: preset.name }));
  });
  layoutSelect.addEventListener("change", async () => {
    const preset = LAYOUT_PRESETS.find((p) => p.id === layoutSelect.value);
    layoutSelect.value = "";
    if (!preset) return;
    const ok = await confirmDialog({
      title: `Rearrange every tab?`,
      message: `This replaces the arrangement on every tab with the ${preset.name} layout. Undo restores it.`,
      confirmLabel: `Rearrange`,
    });
    if (!ok) return;
    commitMutation(() => {
      (character.sheetTabs || []).forEach((tab) => {
        if (Array.isArray(tab.layout)) applyLayoutPresetTo(tab.layout, preset.id);
      });
      mirrorFirstTabLayout();
    });
  });
  displayRow("Layout", layoutSelect);

  // Aspect-ratio presets: reflow blocks to match a target screen shape
  // (16:9, phone portrait, tablet landscape, ...).
  //
  // Two things this deliberately does NOT do:
  //  - It never applies anything on load. The detected preset is only
  //    OFFERED as the select's placeholder, because reflowing a sheet
  //    behind the user's back is destructive and they may well be
  //    resizing the window, not redesigning.
  //  - It doesn't re-guess a shape the user has already adjusted. Each
  //    (preset, tab) pair keeps its own snapshot, so coming back to a
  //    preset restores their arrangement (switchTabToPreset handles that).
  const applyAspect = async (presetId, { force }) => {
    const preset = aspectPresetById(presetId, character);
    if (!preset) return;
    const willReflow = force || !(character.sheetTabs || []).some(
      (t) => stashedLayoutFor(character, presetId, t.id)
    );
    if (force) {
      const ok = await confirmDialog({
        title: `Re-flow into ${preset.name}?`,
        message: "This replaces the arrangement on every tab, including any hand-arranged version. Undo restores it.",
        confirmLabel: "Re-flow",
      });
      if (!ok) return;
    } else if (!willReflow) {
      // A three-way question, which is what this has always been: there is a
      // hand-arranged version for this shape, and the player has to choose
      // between it and a fresh automatic run. window.confirm could only ask
      // a yes/no and used to use one of its answers to mean "yes, re-flow",
      // so "use my layout" and "cancel" were the same click. chooseDialog
      // gives both answers their own button, plus Cancel.
      const choice = await chooseDialog({
        title: `You have a hand-arranged ${preset.name} layout`,
        options: [
          { value: "keep", label: "Use my layout", description: "Go back to the arrangement you made for this shape." },
          { value: "reflow", label: "Re-flow from scratch", description: "Replace it with the automatic arrangement. Undo restores yours." },
        ],
        cancelLabel: "Cancel",
      });
      if (choice === "reflow") willReflow = true;
      else if (choice === "keep") willReflow = false;
      else return;
    }
    commitMutation(() => {
      (character.sheetTabs || []).forEach((tab) => {
        if (Array.isArray(tab.layout)) switchTabToPreset(character, tab, presetId, { force });
      });
      mirrorFirstTabLayout();
    });
  };

  const aspectSelect = document.createElement("select");
  aspectSelect.className = "input-group__control";
  aspectSelect.title = "Switch to a target screen shape; a shape you've already arranged is restored, not re-guessed";
  // The options (and the placeholder's detected-shape offer) are filled
  // by fillAspectOptions, which has to run again whenever the character
  // gains or loses one of its own shapes.
  // The list is the shipped table plus whatever this character has
  // defined, so a custom shape behaves exactly like a built-in one from
  // here on: same reflow, same per-shape layout memory, same re-flow.
  const fillAspectOptions = () => {
    aspectSelect.innerHTML = "";
    const detectedNow = detectAspectPreset();
    aspectSelect.append(el("option", {
      value: "",
      text: detectedNow ? `Screen looks like ${detectedNow.name} — pick a shape…` : "Screen shape…",
    }));
    for (const preset of allAspectPresets(character)) {
      aspectSelect.append(el("option", { value: preset.id, text: preset.custom ? `${preset.name} (yours)` : preset.name }));
    }
  };
  fillAspectOptions();
  aspectSelect.addEventListener("change", () => {
    const presetId = aspectSelect.value;
    aspectSelect.value = "";
    applyAspect(presetId, { force: false });
  });

  // User-defined shapes. The whole definition is a name and a ratio, and the
  // column count is derived from the ratio (see colsForRatio) because
  // naming a ratio shouldn't require knowing the sheet is a 16-cell grid.
  //
  // This used to be two window.prompt calls, then a window.alert to explain
  // that what you typed wasn't a ratio, then a third prompt presenting the
  // existing shapes as a numbered list to type an index from. Four native
  // dialogs for two fields, and the ratio check happened AFTER the dialog
  // that took the ratio had already closed - so fixing a typo meant starting
  // over. The name is still asked for first (it is what the ratio prompt
  // used to refer back to), but both are now validated in place.
  const addCustomAspect = async () => {
    const name = await promptDialog({
      title: "Name this shape",
      label: "Name",
      message: "What the shape is — Desk monitor, Storybook, whatever you will recognise later.",
      placeholder: "Desk monitor",
      confirmLabel: "Next",
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return "Give it a name, or press Cancel.";
        // The old flow checked for a duplicate name only AFTER both prompts
        // had run, so a clash cost the whole sequence.
        const clash = customAspectPresetsFor(character).some((p) => p.name === trimmed);
        return clash ? `You already have a shape called "${trimmed}".` : null;
      },
    });
    if (name === null) return;
    const ratio = await promptDialog({
      title: `Ratio for "${name}"`,
      label: "Aspect ratio (width : height)",
      message: "For example 16:9 for a widescreen sheet, or 1.78 for the same thing as a decimal.",
      placeholder: "21:9",
      confirmLabel: "Add shape",
      // Refuses here rather than in a follow-up alert, and puts the caret
      // back in the field. The old flow closed, alerted, and started over.
      validate: (value) => (parseRatio(value) === null
        ? "That isn't a ratio. Try something like 21:9, 4:3, or 0.56."
        : null),
    });
    if (ratio === null) return;
    const preset = makeCustomPreset({ name, ratio });
    if (!preset) {
      // Unreachable while parseRatio and makeCustomPreset agree about what a
      // ratio is; kept so a future divergence is visible rather than silently
      // dropping the shape.
      await alertDialog({ title: "Couldn't add that shape", message: "That ratio isn't one the sheet can lay out." });
      return;
    }
    commitMutation(() => {
      character.customAspectPresets = [...customAspectPresetsFor(character), preset];
    });
    fillAspectOptions();
    applyAspect(preset.id, { force: true });
  };

  const removeCustomAspect = async () => {
    const custom = customAspectPresetsFor(character);
    if (!custom.length) {
      await alertDialog({ title: "No shapes to remove", message: "You haven't defined any shapes of your own yet." });
      return;
    }
    // A list you can click, instead of a numbered menu to type an index from.
    // Nothing to mistype, and nothing to parse back.
    const pickedId = await chooseDialog({
      title: "Remove which shape?",
      options: custom.map((p) => ({
        value: p.id,
        label: p.name,
        description: `${describeRatio(p.ratio)} — ${colsForRatio(p.ratio)} columns`,
      })),
    });
    if (pickedId === null) return;
    const target = custom.find((p) => p.id === pickedId);
    if (!target) return;
    const confirmed = await confirmDialog({
      title: `Delete "${target.name}"?`,
      message: "Tabs currently on this shape keep the layout they already have.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    commitMutation(() => {
      character.customAspectPresets = custom.filter((p) => p.id !== target.id);
      // The per-shape memory goes with it, so re-adding the name later
      // starts from a fresh best-guess rather than resurrecting an
      // arrangement for a shape that no longer exists.
      clearLayoutVariant(character, target.id);
    });
    fillAspectOptions();
  };

  const aspectAddBtn = el("button", {
    type: "button", class: "btn", text: "Add shape",
    title: "Define your own target shape by name and aspect ratio",
    onclick: addCustomAspect,
  });
  const aspectRemoveBtn = el("button", {
    type: "button", class: "btn", text: "Remove shape",
    title: "Delete one of your own shapes",
    onclick: removeCustomAspect,
  });

  const aspectReflowBtn = el("button", {
    type: "button", class: "btn", text: "Re-flow",
    title: "Re-run the automatic arrangement for the chosen shape, discarding your hand-arranged version",
    onclick: () => {
      const presetId = aspectSelect.value || detectAspectPreset()?.id || DEFAULT_ASPECT_PRESET_ID;
      applyAspect(presetId, { force: true });
    },
  });
  const aspectActions = el("div", { class: "modal-actions" }, aspectSelect, aspectReflowBtn, aspectAddBtn, aspectRemoveBtn);
  displayPanel.append(aspectActions);

  const printBtn = el("button", {
    type: "button", class: "btn", text: "Print",
    title: "Print this character sheet (or save it as PDF)",
    onclick: () => openPrintDialog(),
  });
  const displayActions = el("div", { class: "modal-actions" }, rulesetSyncBtn, printBtn);
  displayPanel.append(displayActions);

  // --- Print dialog ---
  function openPrintDialog() {
    const dialog = el("div", { class: "print-dialog" });
    const dialogContent = el("div", { class: "print-dialog__content" });

    // Orientation
    const orientationSelect = el("select", { class: "print-dialog__select" },
      el("option", { value: "portrait", text: "Portrait" }),
      el("option", { value: "landscape", text: "Landscape" }));
    const orientationRow = el("div", { class: "print-dialog__row" },
      el("span", { class: "print-dialog__label", text: "Orientation" }),
      orientationSelect);

// Scale — "Fit to page" or explicit percentage
    const scaleModeSelect = el("select", { class: "print-dialog__select" },
      el("option", { value: "fit", text: "Fit to page" }),
      el("option", { value: "actual", text: "Actual size" }),
      el("option", { value: "custom", text: "Custom scale…" }));
    const scaleInput = el("input", {
      class: "print-dialog__input", type: "range", min: "50", max: "200", value: "100",
      title: "Percentage of page size",
      style: "display: none;",
    });
    const scaleRow = el("div", { class: "print-dialog__row" },
      el("span", { class: "print-dialog__label", text: "Scale" }),
      scaleModeSelect, scaleInput);

    // Show/hide custom scale input based on mode
    scaleModeSelect.addEventListener("change", () => {
      scaleInput.style.display = scaleModeSelect.value === "custom" ? "" : "none";
    });

    // Which tabs to print — a checklist, so any number of tabs can be
    // picked and each lands on its own printed page. Defaults to the tab
    // you're looking at, since that's almost always the one you want.
    const currentTabId = activeTab().id;
    const tabList = (character.sheetTabs || []).map((tab, index) => ({
      id: tab.id,
      label: tab.name || defaultTabName(tab, index),
    }));
    const tabInputs = tabList.map((opt) =>
      el("label", { class: "print-dialog__label print-dialog__tab-label" },
        el("input", {
          type: "checkbox", value: opt.id,
          checked: opt.id === currentTabId, class: "print-dialog__tab-checkbox",
        }),
        el("span", { class: "print-dialog__tab-text" }, opt.label)));

    const allTabsBtn = el("button", {
      class: "btn btn--secondary print-dialog__linkbtn",
      type: "button",
      text: "All",
      title: "Check every tab",
      onclick: () => {
        tabInputs.forEach((wrap) => { wrap.querySelector("input").checked = true; });
      },
    });
    const noTabsBtn = el("button", {
      class: "btn btn--secondary print-dialog__linkbtn",
      type: "button",
      text: "None",
      title: "Uncheck every tab",
      onclick: () => {
        tabInputs.forEach((wrap) => { wrap.querySelector("input").checked = false; });
      },
    });

    const tabsRow = el("div", { class: "print-dialog__row print-dialog__tabs" },
      el("span", { class: "print-dialog__label", text: "Tabs" }),
      el("span", { class: "print-dialog__tab-bulk" }, allTabsBtn, noTabsBtn),
      ...tabInputs);

    // Background images
    const bgInput = el("input", { type: "checkbox", checked: false });
    const bgRow = el("div", { class: "print-dialog__row" },
      el("span", { class: "print-dialog__label", text: "Background images" }),
      el("label", { class: "print-dialog__checkbox-label" },
        bgInput,
        " Include background images"));

    // Hidden/calculation-only fields
    const hiddenInput = el("input", { type: "checkbox", checked: false });
    const hiddenRow = el("div", { class: "print-dialog__row" },
      el("span", { class: "print-dialog__label", text: "Hidden/calculation fields" }),
      el("label", { class: "print-dialog__checkbox-label" },
        hiddenInput,
        " Include hidden/calculation fields"));

const closeDialog = () => {
      document.removeEventListener("keydown", onDialogKeyDown);
      if (dialog.parentElement) dialog.parentElement.removeChild(dialog);
    };
    function onDialogKeyDown(e) {
      if (e.key === "Escape") closeDialog();
    }

    // Buttons
    const actions = el("div", { class: "print-dialog__actions" },
      el("button", {
        class: "btn btn--primary", text: "Print",
        onclick: async () => {
          const orientation = orientationSelect.value === "landscape" ? "landscape" : "portrait";
          const scaleMode = scaleModeSelect.value;
          const scale = calculatePrintScale(scaleModeSelect.value, scaleInput.value);
          const includeBg = bgInput.checked;
          const includeHidden = hiddenInput.checked;

          const picked = [...dialog.querySelectorAll("input.print-dialog__tab-checkbox:checked")]
            .map((input) => input.value);
          const tabsToPrint = getTabsToPrint(picked, currentTabId, character.sheetTabs || []);
          if (!tabsToPrint.length) {
            showToast("Pick at least one tab to print.", { isError: true });
            return;
          }

          // Build every selected tab into its own page container, then
          // print ONCE. Previously this looped window.print() per tab,
          // which popped a separate dialog (and usually a separate job)
          // per tab and left the user stitching pages together by hand.
          //
          // Each tab is rendered by pointing the live grid at it and
          // copying the result into the stage, rather than reimplementing
          // the per-tab renderers here — the rules and leveling tabs
          // don't go through the block grid at all, and duplicating
          // three render paths would guarantee they drift.
          //
          // Copied, not moved. This used to be `page.append(scrollWrapper)`,
          // which relocates the one live wrapper: each page stole it from
          // the page before, so a multi-tab print came out as blank pages
          // with the last tab's content on the final one. The clone carries
          // the rendered state (see cloneForPrint), so every page is real.
          //
          // Unselected tabs are never rendered into the stage, so they're
          // absent from the printed document entirely rather than
          // present-but-hidden (see buildPrintCss).
          const previousTabId = activeTabId;
          const stageHome = scrollWrapper.parentNode;
          const stage = el("div", { class: "print-stage" });
          const styleEl = document.createElement("style");
          try {
            for (const tabId of tabsToPrint) {
              activeTabId = tabId;
              renderPageGrid();
              const page = el("div", { class: "print-stage__page" });
              page.append(cloneForPrint(scrollWrapper));
              stage.append(page);
            }
            root.append(stage);
            styleEl.textContent = buildPrintCss({
              orientation,
              scaleMode,
              scale,
              includeBg,
              includeHidden,
              pageCount: tabsToPrint.length,
            });
            root.append(styleEl);
            // Let layout settle (the page boxes depend on measured
            // widths) before handing off to the print pipeline.
            await new Promise((r) => requestAnimationFrame(() => r()));
            window.print();
          } finally {
            styleEl.remove();
            if (stage.parentNode) stage.parentNode.removeChild(stage);
            // Put the live grid back where it belongs and re-render the
            // tab that was open before printing. The stage now holds
            // copies, so the wrapper never left its home - this stays as
            // a guard for any future path that does move it.
            if (stageHome && !scrollWrapper.parentNode) stageHome.append(scrollWrapper);
            activeTabId = previousTabId;
            renderPageGrid();
            closeDialog();
          }
        },
      }),
      el("button", { class: "btn btn--secondary", text: "Cancel", onclick: () => closeDialog() }));

    dialogContent.append(orientationRow, scaleRow, tabsRow, bgRow, hiddenRow, actions);
    dialog.append(dialogContent);
    root.append(dialog);

    // Escape closes (document-level: the dialog div itself never takes
    // keyboard focus, so a listener on it would never fire).
    document.addEventListener("keydown", onDialogKeyDown);
    actions.querySelector(".btn--primary").focus();
  }

  // Everything else the character-selection page shows on a card
  // (Race, Class, Level, whatever) is NOT intrinsic — name is the
  // only fixed identity field. Instead, drag any field here (from the
  // sidebar, same drag payload it already uses for the grid) to
  // designate it as one of the fields shown on that character's card;
  // its value there always reflects whatever's currently on the sheet.
  // Both drop zones live behind a "Card fields" toggle so the everyday
  // toolbar stays short — most days nobody needs them open.
  const cardZonesWrap = el("div", { class: "toolbar-card-zones", hidden: true });
  const cardZonesToggle = el("button", {
    type: "button", class: "btn", text: "Card fields",
    title: "Choose which fields show on the character list (and which one counts as Level)",
    onclick: () => {
      cardZonesWrap.hidden = !cardZonesWrap.hidden;
      cardZonesToggle.classList.toggle("active", !cardZonesWrap.hidden);
    },
  });
  toolbar.append(cardZonesToggle);
  if (!character.cardFieldIds) character.cardFieldIds = [];
  const cardFieldsWrap = el("div", {
    class: "identity-card-fields",
    ondragover: (e) => {
      if (acceptsFieldDrop(e)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    },
    ondrop: (e) => {
      const parsed = parseFieldDropPayload(e);
      if (!parsed) return;
      e.preventDefault();
      if (character.cardFieldIds.includes(parsed.fieldId)) return;
      character.cardFieldIds.push(parsed.fieldId);
      saveWithStatus("cardFieldIds", character.cardFieldIds);
      renderCardFieldChips();
    },
  });

  function renderCardFieldChips() {
    cardFieldsWrap.innerHTML = "";
    if (character.cardFieldIds.length === 0) {
      cardFieldsWrap.append(buildHint("Drag fields here to show on the character list"));
      return;
    }
    character.cardFieldIds.forEach((id) => {
      const field = resolveFieldById(id);
      const { chip, removeBtn } = buildChip({
        label: field ? (field.label || "Field") : "deleted field",
        missing: !field,
        removeTitle: "Stop showing this on the character list",
        removeAriaLabel: "Stop showing this on the character list",
      });
      removeBtn.addEventListener("click", () => {
        character.cardFieldIds = character.cardFieldIds.filter((x) => x !== id);
        saveWithStatus("cardFieldIds", character.cardFieldIds);
        renderCardFieldChips();
      });
      cardFieldsWrap.append(chip);
    });
  }
  renderCardFieldChips();
  cardZonesWrap.append(cardFieldsWrap);

  // A separate single-field designation (not part of cardFieldIds
  // above, which is about what shows on the character-list card) —
  // this is what bundle stat modifiers/dropdown-access rules check
  // against when they have a "Min Level" set (see currentLevel,
  // applyBundleModifiers, getAllowedChoiceIds). Single slot, not a
  // chip list: only one field can sensibly BE the character's level.
  const levelFieldWrap = el("div", {
    class: "identity-card-fields",
    ondragover: (e) => {
      if (acceptsFieldDrop(e)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    },
    ondrop: (e) => {
      const parsed = parseFieldDropPayload(e);
      if (!parsed) return;
      e.preventDefault();
      character.levelFieldId = parsed.fieldId;
      saveWithStatus("levelFieldId", character.levelFieldId);
      renderLevelFieldChip();
    },
  });

  function renderLevelFieldChip() {
    levelFieldWrap.innerHTML = "";
    if (!character.levelFieldId) {
      levelFieldWrap.append(buildHint("Drag a field here to designate it as Level (for bundle leveling)"));
      return;
    }
    const field = resolveFieldById(character.levelFieldId);
    const { chip, removeBtn } = buildChip({
      label: field ? (field.label || "Field") : "deleted field",
      missing: !field,
      removeTitle: "Unset the Level field",
      removeAriaLabel: "Unset the Level field",
    });
    removeBtn.addEventListener("click", () => {
      character.levelFieldId = null;
      saveWithStatus("levelFieldId", character.levelFieldId);
      renderLevelFieldChip();
    });
    levelFieldWrap.append(chip);
  }
  renderLevelFieldChip();
  cardZonesWrap.append(levelFieldWrap);
  toolbar.append(cardZonesWrap);

  // "Level Up" — the way in to leveling. Before this, the only route was
  // finding the Level field, typing the next number into it, and then
  // finding the Leveling tab, which is three separate discoveries for
  // something you do every single level.
  //
  // Built once (like the rest of the toolbar chrome) and re-synced from
  // renderAll, because whether it can act depends on the live level and
  // on whether picks are already in progress.
  //
  // The tab to come back to when a level-up is cancelled: the tab that
  // was open when the level-up STARTED, not whatever is open later. Held
  // in a closure rather than stored, since it's only meaningful while a
  // level-up is actually in progress.
  let levelUpReturnTabId = null;
  const levelUpControl = buildLevelUpControl(levelUpTarget(null), onLevelUpClick);
  toolbar.append(levelUpControl);

  /** Raises the Level field by one — the same mutation a manual edit of
   *  that field performs (buildTextValueInto's oninput sets
   *  field.value inside commitMutation), so formulas, spell slots,
   *  granted features and dropdown access all recompute exactly as they
   *  do when you type the number yourself. Going through
   *  commitMutation (rather than assigning the value directly) is what
   *  keeps the undo stack and the autosave honest. */
  function setCharacterLevel(next) {
    const levelField = resolveFieldById(character.levelFieldId || "level");
    if (!levelField) return false;
    levelField.value = String(next);
    return true;
  }

  function hasPendingLevelUp(level) {
    return level != null && Boolean(levelingPendingState[String(level)]);
  }

  /** Re-reads the level and re-points the toolbar button at it. Called
   *  from renderAll so a manual Level edit, a cancel, or finishing setup
   *  all leave the button saying the truth. */
  function syncLevelUpButton() {
    // Deliberately the RAW level, not currentCharacterLevel(): a field
    // holding 21 should read as "you hit the cap", not as "you have no
    // level", which is what the clamped read would report.
    const raw = rawLevelFrom(resolveFieldById(character.levelFieldId || "level")?.value);
    const outstanding = hasOutstandingLevels(raw);
    levelUpControl.syncLevelUpControl(levelUpTarget(raw, {
      // Levels a jump left unrecorded make this a resume, not a start: the
      // walkthrough has work to do at a level BELOW the sheet's own, and
      // raising again would only push the sheet further ahead of its
      // records. Same button, same place — it just takes you to the
      // outstanding level instead of past it.
      pendingAtLevel: hasPendingLevelUp(raw) || outstanding,
    }));
  }

  function onLevelUpClick() {
    // Re-resolve rather than trusting the target captured at build
    // time — the sync in renderAll is the only thing keeping it fresh,
    // and a stale "start" must never double-raise.
    const raw = rawLevelFrom(resolveFieldById(character.levelFieldId || "level")?.value);
    const pendingHere = hasPendingLevelUp(raw);
    const live = levelUpTarget(raw, { pendingAtLevel: pendingHere });
    if (live.kind === "unknown" || live.kind === "capped") {
      syncLevelUpButton();
      return;
    }
    levelUpReturnTabId = activeTabId;
    // The Leveling tab takes over from Character Setup once setup is
    // finished (see normalizeTabs), so it exists from here on; guard
    // anyway so a hand-edited sheet without one doesn't throw.
    const tab = character.sheetTabs.find((t) => t.kind === "leveling");
    if (tab) activeTabId = tab.id;
    if (live.kind === "start") {
      // Levels a jump left outstanding: DO NOT raise past them. The walk
      // through takes the lowest one, and raising first would push the
      // sheet further ahead of its own records. Resuming that
      // walkthrough is the only correct action here.
      if (hasOutstandingLevels(raw)) {
        renderAll();
        return;
      }
      // Raise FIRST, then render: the guide derives everything from the
      // Level field (the primary's post-apply level is "total minus
      // applied secondaries"), so it has to see the new total to compute
      // the step right. Raising at Apply instead would put every one of
      // those calculations a level behind.
      commitMutation(() => { setCharacterLevel(live.level); });
      return;
    }
    // Resuming: the level is already raised and the picks are already
    // there. Just show the Walkthrough half again.
    renderAll();
  }

  /** Whether a jump left levels the walkthrough still has to take. Reads
   *  the same state the banner does, so the button and the banner can
   *  never disagree. */
  function hasOutstandingLevels(sheetLevel) {
    if (sheetLevel == null) return false;
    return levelingRecordState(sheetLevel, {
      levelUps: character.levelUps,
      createdAtLevel: character.createdAtLevel,
    }).hasGap;
  }

  // Visible save-state feedback — saves happen silently in the
  // background otherwise, which means a failed save (e.g. a
  // background image pushing the character over Firestore's 1MB
  // document limit) would previously go completely unnoticed.
  const statusEl = buildStatusEl();
  toolbar.append(statusEl);

  // Tracks whether there's any edit not yet confirmed saved, for the
  // unsaved-changes warning below (real browser navigation) and the
  // in-app Back button (main.js checks hasUnsavedChanges() before
  // leaving). Set on every edit; cleared on every successful save
  // completion, from whichever of the save channels below finishes.
  // Simple, not perfectly race-proof across two channels saving
  // concurrently (rare, low-stakes if it happens — the worst case is
  // one missed warning in a sub-second window), which is a fine trade
  // against the complexity of exactly tracking multiple in-flight
  // saves for what's ultimately just a courtesy "are you sure" prompt.
  let unsavedChanges = false;

  function saveWithStatus(fieldId, value) {
    statusEl.textContent = "Saving…";
    statusEl.style.color = "";
    store.saveCharacterField(character.id, fieldId, value)
      .then(() => { statusEl.textContent = "Saved"; unsavedChanges = false; })
      .catch((err) => {
        console.error(`Failed to save "${fieldId}":`, err);
        statusEl.textContent = "⚠ Save failed — see console";
        statusEl.style.color = "var(--color-negative)";
      });
  }

  const persist = debounce(persistSheetState);

  /** Persists wizard resume state — which wizard page was last open
   *  plus in-progress level-up picks — so closing mid-wizard and
   *  reopening later resumes instead of starting over. Deliberately
   *  silent (no statusEl "Saving…" flicker on every step click) and
   *  debounced; worst case on a failed write is resuming an older
   *  page, never lost character data (answers themselves persist
   *  through their own save paths). Reads live session state at fire
   *  time, so a write scheduled before Apply/Finish Setup still sees
   *  the already-cleared state rather than resurrecting it. Runs on
   *  wizard navigation and wizard edits (see the call sites), plus one
   *  final flush in destroy() so closing the sheet keeps the latest. */
  function persistWizardProgress() {
    const save = store.saveCharacterFields
      ? (patch) => store.saveCharacterFields(character.id, patch)
      : (patch) => Promise.all(Object.entries(patch).map(([fieldId, value]) => store.saveCharacterField(character.id, fieldId, value)));
    const patch = {
      creationStepId: creationWizardState.stepId ?? null,
      levelingStepId: levelingWizardState.stepId ?? null,
      levelingPending: snapshotPending(),
    };
    // Only unfinished characters need the flag re-asserted; finished
    // ones already saved setupComplete: true at Finish Setup.
    if (character.setupComplete === false) patch.setupComplete = false;
    save(patch).catch((err) => {
      console.error("Failed to save wizard progress:", err);
    });
  }
  const persistWizardProgressSoon = debounce(persistWizardProgress, 800);

  /** Plain-data snapshot of in-progress level-up picks ({} on
   *  anything unserializable — never let a weird value break a
   *  save that carries real character data alongside it). */
  function snapshotPending() {
    try {
      return JSON.parse(JSON.stringify(levelingPendingState));
    } catch {
      return {};
    }
  }

  // See needsLevelFieldAutosave at the top of this function — this is
  // the earliest point saveWithStatus is safe to call from (it reads
  // statusEl, a const declared just above).
  if (needsLevelFieldAutosave) saveWithStatus("levelFieldId", character.levelFieldId);

  // A brief, non-blocking message — for advisories and errors that
  // happen somewhere scattered across the grid (an oversized image
  // upload, a field rename collision, a missing catalog) where there's
  // no single natural place to put a persistent inline status line the
  // way the Catalogs/Bundle Libraries managers' Save buttons have.
  // Replaces what used to be window.alert() for these.
  function showToast(message, { isError = false } = {}) {
    showToastIn(root, message, { isError });
  }

  root.append(toolbar);

  // One-time orientation, the first time a FINISHED character is opened.
  // Placed between the toolbar and the tabs because that is where the
  // buttons it describes are: everything it has to say is "these buttons do
  // things, here is which".
  //
  // Skipped entirely while the creation wizard is still running (see
  // shouldShowIntro) — the wizard is itself the guided first run, and a
  // panel about switching display modes appearing over it is noise about a
  // feature the player has not reached.
  if (shouldShowIntro(character)) {
    const intro = el("div", { class: "sheet-intro", role: "note" });
    intro.append(el("p", { class: "sheet-intro__title", text: "Getting started" }));
    const list = el("ul", { class: "sheet-intro__list" });
    INTRO_LINES.forEach((line) => list.append(el("li", { text: line })));
    intro.append(list);
    const dismiss = el("button", {
      type: "button",
      class: "btn btn--secondary sheet-intro__dismiss",
      text: "Got it",
      onclick: () => {
        intro.remove();
        character.sawIntro = true;
        if (store.saveCharacterFields) {
          store.saveCharacterFields(character.id, { sawIntro: true }).catch((err) => {
            console.error("Failed to save intro dismissal:", err);
          });
        }
      },
    });
    intro.append(dismiss);
    root.append(intro);
  }

  const tabsBar = el("div", { class: "sheet-tabs" });
  root.append(tabsBar);

  // The Stat Blocks palette belongs to the Customize editor, not
  // play mode — entering customize shows it, leaving hides it again.
  // The ☰ toggle itself only exists while customizing.
  function syncSidebarVisibility() {
    blockFrame.classList.toggle("is-collapsed", !editMode || sidebarCollapsed);
    sidebarToggleBtn.style.display = editMode ? "" : "none";
  }

  modeBtn.addEventListener("click", () => {
    editMode = !editMode;
    modeBtn.textContent = editMode ? "Done Editing" : "Customize Sheet";
    addBlockBtn.style.display = editMode ? "" : "none";
    pageGrid.classList.toggle("is-edit-mode", editMode);
    if (editMode) sidebarCollapsed = false;
    syncSidebarVisibility();
    renderAll();
  });

  undoBtn.addEventListener("click", undo);
  redoBtn.addEventListener("click", redo);
  document.addEventListener("keydown", onShortcut);

  // --- Page grid --------------------------------------------------------
  // Wrapped in a horizontally-scrolling container so narrow (phone)
  // screens scroll sideways instead of squishing cells below a usable
  // width — see MIN_CELL_PX. This also keeps a saved layout's x/y
  // coordinates meaningful across devices: the grid itself never
  // changes column count, only how much of it fits on screen at once.
  const workbench = el("div", { class: "sheet-workbench" });
  root.append(workbench);

  const blockFrame = el("aside", { class: "sheet-block-frame" + (sidebarCollapsed ? " is-collapsed" : "") });
  workbench.append(blockFrame);
  syncSidebarVisibility();

  const scrollWrapper = el("div", { class: "page-grid-scroll" });
  workbench.append(scrollWrapper);

  const pageGrid = el("div", { class: "page-grid" });
  scrollWrapper.append(pageGrid);
  pageGrid.addEventListener("dragover", (e) => {
    if (!editMode) return;
    if (e.dataTransfer.types.includes("application/x-sheet-block") ||
        e.dataTransfer.types.includes("application/x-sheet-field") ||
        e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });
  pageGrid.addEventListener("drop", (e) => {
    if (!editMode) return;
    const blockId = e.dataTransfer.getData("application/x-sheet-block");
    const fieldPayload = e.dataTransfer.getData("application/x-sheet-field");
    const imageFile = Array.from(e.dataTransfer.files || []).find((f) => f.type.startsWith("image/"));
    if (!blockId && !fieldPayload && !imageFile) return;
    e.preventDefault();

    const rect = pageGrid.getBoundingClientRect();
    const cw = colWidthPx();
    const { x, y } = dropCellFor(e.clientX, e.clientY, rect, cw, GAP_PX);

// Dropping an image file directly onto empty grid space (not onto
      // an existing picture field, which handles the drop itself and
      // stops it from bubbling here) auto-builds a new block just for it.
      if (imageFile) {
        // readImageFileInto already downscales to 500px WebP (see
        // sheetFields.js), so the stored data URL stays small enough
        // for Firestore — no extra compression step needed here.
        readImageFile(imageFile, (dataUrl) => {
          if (!dataUrl) return;
          const size = DEFAULT_FIELD_SIZE.picture;
          const block = createBlock({ name: "New Block", x, y, w: size.w, h: size.h + BLOCK_HEADER_ROWS });
          const field = createField({ fieldType: "picture", label: "Stat", x: 0, y: 0, w: size.w, h: size.h });
          commitMutation(() => {
            field.imageData = dataUrl;
            block.children.push(field);
            currentLayout().push(block);
          });
        });
        return;
      }

    commitMutation(() => {
      if (blockId) {
        addBlockReferenceToActiveTab(blockId, x, y);
      } else if (fieldPayload) {
        const { blockId: sourceBlockId, fieldId } = JSON.parse(fieldPayload);
        addFieldReferenceToActiveTab(sourceBlockId, fieldId, x, y);
      }
    });
  });

  // --- Selection ------------------------------------------------------
  //
  // selectedIds is the source of truth; native focus (tabIndex + the
  // browser's own :focus-within) rides along as a secondary channel —
  // refocusNodeById keeps SOME element in the current selection
  // actually focused so keyboard-only flows (e.g. a screen reader,
  // or just Tab-key navigation) still land somewhere sensible, but
  // Delete/Escape/the .is-selected border all key off selectedIds.
  //
  // Capture phase (not the default bubble phase) is deliberate: a
  // field's own text/value elements call stopPropagation() on
  // pointerdown so clicking into them to type doesn't ALSO trigger the
  // document-level popover-closer — which would otherwise stop this
  // listener from ever seeing the click too, if it were attached the
  // normal way. Capture-phase listeners run on the way DOWN to the
  // target, before that stopPropagation() call happens, so they see
  // every click regardless.
  pageGrid.addEventListener("pointerdown", (e) => {
    if (!editMode) return;
    // Drag/resize handles do their own hierarchy-aware selection (a
    // block's handle selects it WITH its fields; a field's doesn't) —
    // this generic handler doesn't know that distinction, so let
    // theirs be the only one that runs rather than have this one fire
    // first (capture order) with the wrong answer and get immediately
    // overwritten.
    const nodeEl = e.target.closest(".grid-node");
    const action = clickSelectionAction({
      onHandle: !!e.target.closest(".node-handle"),
      nodeKind: nodeEl ? nodeEl.dataset.nodeKind : null,
      id: nodeEl ? nodeEl.dataset.nodeId : null,
      modified: !!(e.ctrlKey || e.metaKey || e.shiftKey),
      singleSelectedId: selectedIds.size === 1 ? [...selectedIds][0] : null,
    });
    if (action === "ignore" || action === "keep") return;
    if (action === "toggle") {
      toggleSelected(nodeEl.dataset.nodeId);
      return;
    }
    if (action === "block") {
      selectBlockAndFields(nodeEl);
    } else {
      selectOnly(nodeEl.dataset.nodeId);
    }
  }, true);

  // --- Group toolbar + bounding-box border (multi-selection) ----------
  //
  // A single node's own toolbar is built fresh per-render as part of
  // that node (see buildBlockToolbar/buildFieldToolbar) — this one is
  // different, since it belongs to the SELECTION as a whole rather
  // than to any one element, so it's created once here and just
  // repositioned/shown/hidden, then re-appended at the end of every
  // renderPageGrid() (which otherwise wipes it along with everything
  // else via pageGrid.innerHTML).
  const { toolbar: groupToolbar, borderBtn: groupBorderBtn, overlay: groupBorderOverlay } =
    buildGroupToolbarInto(() => {
      groupBorderVisible = !groupBorderVisible;
      groupBorderBtn.classList.toggle("active", groupBorderVisible);
      updateGroupBorderOverlay();
    });

  // The border itself: not each selected element getting its own
  // border, but one rectangle around the smallest box that contains
  // all of them — a visible outline of the CURRENT selection, not a
  // persisted style (there's no actual "group" object in the data
  // model to attach a saved style to; select something else, or edit
  // the selection, and this resets — see the signature check in
  // paintSelection below). Both elements are created once by
  // buildGroupToolbarInto above and re-appended at the end of every
  // renderPageGrid (which otherwise wipes them via innerHTML).
  let groupBorderVisible = false;
  let lastSelectionSignature = "";

  function updateGroupBorderOverlay() {
    applyGroupBorderOverlay(groupBorderOverlay, groupBorderVisible ? selectionBoundingBox() : null);
  }

  /** The pixel bounding box (relative to pageGrid) of every currently
   *  selected element that's actually rendered right now — null if
   *  fewer than two of them are (a single selection uses its own
   *  ordinary per-node toolbar instead; see wireHoverToolbar). */
  function selectionBoundingBox() {
    return selectionBoxFor(pageGrid, selectedIds);
  }

  // Hovering ANYWHERE within the selection's bounding box — including
  // the gaps between separate selected elements, not just directly
  // over one of them — shows the group toolbar at its top-right
  // corner, the same "just outside the top-right corner" placement a
  // single node's own toolbar uses (see positionNodeToolbar).
  pageGrid.addEventListener("mousemove", (e) => {
    const box = selectionBoundingBox();
    const pageRect = pageGrid.getBoundingClientRect();
    const hover = groupToolbarHover(editMode, box, e.clientX - pageRect.left, e.clientY - pageRect.top);
    if (!hover.visible) { groupToolbar.classList.remove("is-visible"); return; }
    positionFloatingToolbar(groupToolbar, box.right, box.top);
    groupToolbar.classList.add("is-visible");
  });
  pageGrid.addEventListener("mouseleave", () => groupToolbar.classList.remove("is-visible"));

  function paintSelection() {
    paintSelectionInto(pageGrid, blockFrame, selectedIds);
    // The bounding-box border is tied to THIS selection, not a
    // persisted style — switching to a genuinely different selection
    // resets it off, rather than carrying a stale box over (or
    // requiring an extra click to turn off a border that no longer
    // makes sense for whatever's now selected). Re-painting the SAME
    // selection after an unrelated edit elsewhere does NOT reset it —
    // only an actual change to which ids are selected does.
    const signature = selectionSignature(selectedIds);
    if (shouldResetGroupBorder(lastSelectionSignature, signature)) {
      groupBorderVisible = false;
      groupBorderBtn.classList.remove("active");
      lastSelectionSignature = signature;
    }
    updateGroupBorderOverlay();
  }

  function selectOnly(id) {
    selectedIds = selectOnlySet(id);
    paintSelection();
    refocusNodeById(id);
  }

  /** Selects a block AND every field currently rendered inside it —
   *  used wherever the action about to happen (clicking the block's
   *  own chrome, or dragging it) affects the whole group together.
   *  Deliberately DOM-driven (reads the block's own rendered
   *  .grid-node--field descendants) rather than walking the data
   *  model's own .children — a block can be a reference/clone of
   *  another one (see sourceBlockFor), and what's actually on screen
   *  for THIS block, with ids that exist in THIS tab's DOM, is what
   *  selection needs to match; resolving through the data layer risks
   *  picking up a different block's ids entirely. Takes the block's
   *  own wrapper element; a null/missing element (e.g. a sidebar
   *  click for a block that isn't on the currently-viewed tab) is a
   *  harmless no-op. */
  function selectBlockAndFields(blockEl) {
    if (!blockEl) return;
    const ids = new Set([blockEl.dataset.nodeId]);
    blockEl.querySelectorAll(".grid-node--field[data-node-id]").forEach((fieldEl) => {
      ids.add(fieldEl.dataset.nodeId);
    });
    selectedIds = ids;
    paintSelection();
    refocusNodeById(blockEl.dataset.nodeId);
  }

  function toggleSelected(id) {
    selectedIds = toggleInSet(selectedIds, id);
    paintSelection();
    if (selectedIds.size > 0) refocusNodeById([...selectedIds].pop());
  }

  function clearSelectionState() {
    selectedIds = new Set();
    paintSelection();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function normalizeTabs() {
    normalizeTabsIn(character, {
      newIdFn: () => newId(),
      normalizeRulesFn: (rules) => normalizeRulesState(rules),
      mirrorFn: (ch) => mirrorFirstTabLayout(ch),
    });
  }

  function snapshot() {
    return snapshotOf(character, clone);
  }

  function restoreSnapshot(state) {
    character.sheetTabs = clone(state.sheetTabs || []);
    character.layout = clone(state.layout || []);
    normalizeTabs();
    if (!character.sheetTabs.some(tab => tab.id === activeTabId)) {
      activeTabId = character.sheetTabs[0].id;
    }
    renderAll();
    persistSheetState();
  }

  // How long a burst of rapid edits (typing, repeatedly clicking the
  // same checkbox, etc.) gets coalesced into a single undo step. Was
  // previously not coalesced at all — every keystroke pushed its own
  // full snapshot, so Ctrl+Z undid one character at a time and a long
  // session's undo stack grew without bound. A pause longer than this
  // between edits starts a fresh undo step.
  let lastMutationAt = 0;

  function commitMutation(fn, { render = true, save = true } = {}) {
    if (save) unsavedChanges = true;
    const now = Date.now();
    if (shouldPushNewStep({ stackEmpty: undoStack.length === 0, now, lastMutationAt })) {
      pushBounded(undoStack, snapshot());
    }
    lastMutationAt = now;
    redoStack.length = 0;
    fn();
    normalizeTabs();
    updateHistoryButtons();
    if (save) persist();
    if (render) renderAll();
    // Even a render:false mutation (typing into a plain text field,
    // say) can be something a Num Field's formula elsewhere depends
    // on — recompute and patch those in place so they stay live
    // without the full-grid rebuild render:false exists to avoid
    // (which would blow away the cursor/selection currently mid-edit).
    else refreshComputedValues();
  }

  /** Recomputes every formula and patches just the already-rendered
   *  computed-value text in place — no DOM rebuild, so it's safe to
   *  call after every keystroke without disturbing whatever's
   *  currently focused. Doesn't touch a radio field's own button COUNT
   *  (an optionsFormula changing how many buttons a slot tracker shows,
   *  say) since resizing that requires actually adding/removing
   *  buttons, not just patching text — a full render still does that,
   *  but debounced (scheduleOptionCountSync below) so it lands shortly
   *  after typing settles rather than interrupting it. */
  function refreshComputedValues() {
    const allFields = flattenGlobalFields();
    const previousRadioOptionCounts = radioOptionCounts;
    const previousSpellSlotCounts = spellSlotCounts;
    const previousGrantedCheckboxes = grantedCheckboxes;
    const previousGrantedFeatures = grantedFeatures;
    formulaValues = computeSheetValues(allFields); // also refreshes grantedCheckboxes/grantedFeatures as a side effect
    radioOptionCounts = computeRadioOptionCounts(allFields, formulaValues);
    spellSlotCounts = computeSpellSlotCounts(allFields, formulaValues);
    pageGrid.querySelectorAll(".field-value--computed[data-field-id]").forEach((el) => {
      el.textContent = formatComputedValue(formulaValues[el.dataset.fieldId]);
    });
    const optionCountsChanged = allFields.some((f) =>
      f.fieldType === "radio" && f.optionsFormula && radioOptionCounts[f.id] !== previousRadioOptionCounts[f.id]
    );
    const slotCountsChanged = Object.keys({ ...spellSlotCounts, ...previousSpellSlotCounts })
      .some((id) => spellSlotCounts[id] !== previousSpellSlotCounts[id]);
    const grantsChanged = grantedCheckboxes.size !== previousGrantedCheckboxes.size ||
      [...grantedCheckboxes].some((key) => !previousGrantedCheckboxes.has(key));
    const featuresChanged = grantedFeatures.length !== previousGrantedFeatures.length ||
      grantedFeatures.some((f, i) => f.name !== previousGrantedFeatures[i]?.name);
    if (optionCountsChanged || slotCountsChanged || grantsChanged || featuresChanged) scheduleDeferredRender();
  }

  // A full render actually adds/removes the radio buttons an
  // optionsFormula count change calls for, and actually re-disables/
  // checks a proficiency box a bundle's minLevel-gated "grant" just
  // turned on or off (e.g. typing a new Level past that threshold) —
  // but doing either on every keystroke would reintroduce the exact
  // focus-loss problem render:false exists to avoid. Debouncing it
  // means the grid catches up shortly after typing pauses instead of
  // on every keystroke.
  const scheduleDeferredRender = debounce(() => renderAll(), 500);

  function undo() {
    if (undoStack.length === 0) return;
    pushBounded(redoStack, snapshot());
    restoreSnapshot(undoStack.pop());
    lastMutationAt = 0; // next edit always starts a fresh undo step, never coalesced into the just-restored state
    updateHistoryButtons();
  }

  function redo() {
    if (redoStack.length === 0) return;
    pushBounded(undoStack, snapshot());
    restoreSnapshot(redoStack.pop());
    lastMutationAt = 0;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    applyHistoryButtons(undoBtn, redoBtn, undoStack.length, redoStack.length);
  }

  const ARROW_DELTAS = SHARED_ARROW_DELTAS;

  function onShortcut(e) {
    const nodeEl = e.target.closest ? e.target.closest(".grid-node") : null;
    const action = shortcutAction({
      key: e.key,
      ctrl: e.ctrlKey,
      meta: e.metaKey,
      shift: e.shiftKey,
      alt: e.altKey,
      typing: !!(e.target.closest && e.target.closest("input, textarea, select, [contenteditable='true']")),
      nodeId: nodeEl && nodeEl.dataset.nodeId ? nodeEl.dataset.nodeId : null,
      hasSelection: selectedIds.size > 0,
      editMode,
    });
    if (!action) return;
    switch (action.type) {
      case "escape":
        if (document.activeElement && document.activeElement.blur) {
          document.activeElement.blur();
        }
        clearSelectionState();
        return;
      // While actually typing/editing text, Delete and Backspace only
      // ever edit that text — shortcutAction already returns null for
      // those (typing guard above), so reaching here means a real
      // sheet-structure delete.
      case "delete-selection":
        e.preventDefault();
        deleteSelectedNodes([...selectedIds]);
        return;
      case "delete-node": {
        e.preventDefault();
        deleteSelectedNode(nodeEl);
        return;
      }
      case "duplicate":
        e.preventDefault();
        duplicateSelection();
        return;
      case "nudge":
        e.preventDefault();
        nudgeSelection(action.dx, action.dy, action.resize);
        return;
      case "undo":
        e.preventDefault();
        undo();
        return;
      case "redo":
        e.preventDefault();
        redo();
        return;
      default:
        return;
    }
  }

  function parentBlockOf(fieldId) {
    return parentBlockOfIn(fieldId, [globalLayout(), currentLayout()]);
  }

  /** Moves (plain) or resizes (Shift) every top-level selected node by
   *  one grid cell in the given direction — the keyboard path for
   *  what wireDrag/wireResize's pointer dragging below already does.
   *  "Top-level" matters here the same way it does for a mouse drag:
   *  selecting a block also selects all its own fields (see
   *  selectBlockAndFields), but only the block itself should actually
   *  move/resize in that case — its fields ride along for free via
   *  their already-relative positioning, exactly like dragging the
   *  block's own handle does. A field is only nudged on its own when
   *  it's selected WITHOUT its parent block (an individual field
   *  selection). Bounds match wireDrag/wireResize's own: a field is
   *  clamped to its parent block's content area, a block is
   *  unbounded (it can go anywhere on the canvas, same as dragging
   *  it). */
  function nudgeSelection(dx, dy, resize) {
    const targets = nudgeTargets(selectedIds, parentBlockOf);
    if (targets.length === 0) return;
    commitMutation(() => {
      targets.forEach((id) => {
        const node = findNode(globalLayout(), id) || findNode(currentLayout(), id);
        if (!node) return;
        const isField = !Array.isArray(node.children);
        const block = isField ? parentBlockOf(id) : null;
        // Bounds match wireDrag/wireResize's own: a field is clamped
        // to its parent block's content area, a block is unbounded.
        const maxW = isField && block ? block.w - node.x : Infinity;
        const maxH = isField && block ? (block.h - BLOCK_HEADER_ROWS) - node.y : Infinity;
        const maxX = isField && block ? Math.max(0, block.w - node.w) : Infinity;
        const maxY = isField && block ? Math.max(0, (block.h - BLOCK_HEADER_ROWS) - node.h) : Infinity;
        nudgeNode(node, dx, dy, resize, { maxW, maxH, maxX, maxY });
      });
    });
  }

  /** Deletes whichever block or field currently has keyboard focus (or
   *  contains the focused element) — the keyboard-driven replacement
   *  for the hover bar's old ✕ button. Looks the node up fresh from
   *  the layout by id rather than closing over it, since the DOM
   *  element's dataset is the only thing we can cheaply get from a
   *  bare keydown target. */
  function deleteSelectedNode(nodeEl) {
    const id = nodeEl.dataset.nodeId;
    const node = findNode(globalLayout(), id) || findNode(currentLayout(), id);
    if (!node) return;
    if (nodeEl.dataset.nodeKind === "block") {
      deleteBlockNode(node);
    } else {
      deleteFieldNode(node);
    }
  }

  /** Multi-select Delete/Backspace — deletes every currently-selected
   *  id. Reuses deleteSelectedNode(nodeEl) one id at a time rather
   *  than a bulk mutation: each call re-renders (so a block's own
   *  children disappearing out from under a later id in the same
   *  batch is handled automatically — the DOM lookup for an id that's
   *  already gone just comes back empty and is skipped) and a
   *  non-empty block still asks for confirmation individually. That
   *  last part means deleting several non-empty blocks at once means
   *  several confirm() dialogs in a row rather than one combined
   *  prompt — not ideal, but safe, and correct. */
  function deleteSelectedNodes(ids) {
    ids.forEach((id) => {
      const nodeEl = pageGrid.querySelector(`[data-node-id="${id}"]`);
      if (nodeEl) deleteSelectedNode(nodeEl);
    });
    clearSelectionState();
  }

  function boundingBox(nodes) {
    return nodesBounds(nodes);
  }

  /** A JSON deep clone with fresh top-level ids (block/field, and each
   *  of a block's own children) — everything nested underneath
   *  (choice ids, bundle modifier ids, a formula's own {{tokens}})
   *  stays as-is, since none of that is ever compared ACROSS two
   *  different parent fields, only within one. isAvatar is explicitly
   *  cleared on any duplicated picture field — only one field on a
   *  whole character is supposed to hold that flag at a time (see
   *  clearOtherAvatars), and a duplicate shouldn't silently create a
   *  second one. */
  function cloneWithNewIds(node) {
    return cloneNodeWithNewIds(node, newId);
  }

  /** Duplicates a set of top-level blocks, placed beside (or, if there's
   *  no room to the right on the page, below) the group's own bounding
   *  box — see the file-level note on why this is DOM-independent
   *  bounding-box math rather than "just offset by one cell": the
   *  whole selected GROUP moves as one placed block, not each item
   *  individually nudged. The page grid already grows downward for
   *  content that needs it (see contentHeight in renderPageGrid), so
   *  landing below the group never needs an explicit resize here the
   *  way the in-block field case below does. */
  function duplicateBlocksOnGrid(blocks) {
    if (blocks.length === 0) return [];
    const box = boundingBox(blocks);
    const { dx, dy } = duplicateOffset(box, PAGE_COLS);
    return blocks.map((b) => {
      const dupe = cloneWithNewIds(b);
      dupe.x = b.x + dx;
      dupe.y = b.y + dy;
      currentLayout().push(dupe);
      return dupe;
    });
  }

  /** Same idea as duplicateBlocksOnGrid, but for a set of fields
   *  within ONE block — bounded by the block's own content area
   *  instead of the page's columns, and — since a block doesn't
   *  auto-grow the way the page does — explicitly grows the block
   *  downward if landing below the group needs more room than it
   *  currently has. */
  function duplicateFieldsInBlock(block, fields) {
    if (fields.length === 0) return [];
    const box = boundingBox(fields);
    const fitsRight = box.maxX + box.w <= block.w;
    const { dx, dy } = duplicateOffset(box, block.w);
    if (!fitsRight) {
      block.h += blockGrowthForDuplicate(block, box, dy, BLOCK_HEADER_ROWS);
    }
    return fields.map((f) => {
      const dupe = cloneWithNewIds(f);
      dupe.x = f.x + dx;
      dupe.y = f.y + dy;
      block.children.push(dupe);
      return dupe;
    });
  }

  /** Ctrl+D — duplicates whatever's currently selected. A block
   *  selected as a whole (i.e. block.id itself is in selectedIds,
   *  which is how clicking/dragging a block's own chrome selects it —
   *  see selectBlockAndFields) duplicates as a complete block,
   *  children included, placed beside the original. A field selected
   *  on its own (without its parent block also selected) duplicates
   *  just that field, grouped with any other independently-selected
   *  fields from the SAME block so the whole little cluster moves
   *  together as one placed group, same as the block case. Selects
   *  the new copies afterward, same as most design tools' duplicate. */
  function duplicateSelection() {
    if (selectedIds.size === 0) return;
    const { blocksToDuplicate, fieldGroups } = partitionDuplicateSelection(currentLayout(), selectedIds);

    if (blocksToDuplicate.length === 0 && fieldGroups.length === 0) return;

    commitMutation(() => {
      const newIds = new Set();
      duplicateBlocksOnGrid(blocksToDuplicate).forEach((b) => {
        newIds.add(b.id);
        (b.children || []).forEach((f) => newIds.add(f.id));
      });
      fieldGroups.forEach(([block, fields]) => {
        duplicateFieldsInBlock(block, fields).forEach((f) => newIds.add(f.id));
      });
      selectedIds = newIds;
    });
  }

  async function deleteBlockNode(block) {
    const viewBlock = effectiveBlock(block);
    // Named count, not "everything in it": the field list can be long and
    // the sentence is the only thing telling you what is about to go.
    const childCount = (viewBlock.children || []).length;
    if (childCount > 0) {
      const ok = await confirmDialog({
        title: `Delete "${viewBlock.name}"?`,
        message: `This deletes the block and the ${childCount} ${childCount === 1 ? "field" : "fields"} in it. Undo restores it.`,
        confirmLabel: "Delete block",
        tone: "danger",
      });
      if (!ok) return;
    }
    commitMutation(() => {
      removeBlockFromLayout(currentLayout(), block.id);
    });
  }

  function deleteFieldNode(field) {
    commitMutation(() => {
      removeFieldFromLayouts([globalLayout(), currentLayout()], field.id, (layout, id) => findParentArray(layout, id));
    });
  }

  function persistSheetState() {
    mirrorFirstTabLayout();
    if (store.saveCharacterFields) {
      statusEl.textContent = "Saving…";
      statusEl.style.color = "";
      store.saveCharacterFields(character.id, {
        layout: character.layout,
        sheetTabs: character.sheetTabs,
        // Both of these live on the character but aren't part of the tab
        // or the layout, so they have to be named here or they'd be lost
        // on every reload: the user's own shapes, and the hand-arranged
        // layout saved per shape. Without the second, every shape switch
        // would re-guess over a layout the user had already tuned.
        customAspectPresets: character.customAspectPresets || [],
        aspectLayouts: character.aspectLayouts || { layouts: {}, tabs: {} },
      })
        .then(() => { statusEl.textContent = "Saved"; unsavedChanges = false; })
        .catch((err) => {
          console.error("Failed to save sheet state:", err);
          statusEl.textContent = "⚠ Save failed — see console";
          statusEl.style.color = "var(--color-negative)";
        });
      return;
    }
    saveWithStatus("layout", character.layout);
  }

  function mirrorFirstTabLayout(ch = character) {
    ch.layout = ch.sheetTabs[0]?.layout || [];
  }

  function activeTab() {
    // While character creation hasn't been finished yet, always force
    // the Character-setup (wizard) tab regardless of what activeTabId
    // says — there's nothing else to show yet, and the tab bar itself
    // is hidden during this phase anyway (see renderAll below).
    if (!character.setupComplete) {
      return character.sheetTabs.find(tab => tab.kind === "rules") || character.sheetTabs[0];
    }
    return findTab(character.sheetTabs, activeTabId) || character.sheetTabs[0];
  }

  function activeTabIndex() {
    return tabIndex(character.sheetTabs, activeTab().id);
  }

  function isGlobalTab() {
    return activeTabIndex() === 0;
  }

  function currentLayout() {
    return activeTab().layout;
  }

  function globalLayout() {
    return character.sheetTabs[0].layout;
  }

  /** Every field in the global tab — the pool the sidebar exposes as
   *  drag sources, and therefore the only fields a formula can
   *  reference. */
  function flattenGlobalFields() {
    const list = [];
    globalLayout().forEach(block => {
      (block.children || []).forEach(field => list.push(field));
    });
    return list;
  }

  /** Every field across EVERY tab — wider than flattenGlobalFields on
   *  purpose, for the label-uniqueness check below: two fields with
   *  the same label are ambiguous (as a formula variable, as a
   *  character-card field) no matter which tabs they happen to live
   *  on, not just within the global one. */
  function flattenAllFieldsAcrossTabs() {
    return flattenFieldsAcrossTabs(character.sheetTabs);
  }

  function isLabelAlreadyInUse(label, excludeField) {
    const norm = label.trim().toLowerCase();
    return flattenAllFieldsAcrossTabs().some(
      f => f !== excludeField && f.label && f.label.trim().toLowerCase() === norm
    );
  }

  // In priority order — the first of these that exists wins, when
  // scanning for a pre-existing money field (see detectMoneyFieldByName).
  const MONEY_FIELD_NAMES = SHARED_MONEY_FIELD_NAMES;

  function detectMoneyFieldByName() {
    return findMoneyFieldByNameIn(flattenAllFieldsAcrossTabs(), MONEY_FIELD_NAMES);
  }

  /** Called only from the label blur handler (never on a timer or
   *  every render) — and only actually does anything the FIRST time a
   *  field ends up named one of the conventional money names, before
   *  the character has any money field assigned at all (manually, via
   *  a Catalog field's own picker, or automatically, by this same
   *  function running earlier for some other field). Once
   *  character.moneyFieldId is set, this is permanently a no-op —
   *  exactly the "don't keep checking" behavior asked for. */
  function maybeAutoRegisterMoneyField(field) {
    if (!shouldAutoRegisterMoney(character.moneyFieldId, field, MONEY_FIELD_NAMES)) return;
    character.moneyFieldId = field.id;
    saveWithStatus("moneyFieldId", character.moneyFieldId);
  }

  /** A Catalog field's own money-field choice, resolved with a
   *  fallback chain: its own explicit pick, then the character-wide
   *  default (set either by maybeAutoRegisterMoneyField above or a
   *  previous call to this same function), then a fresh scan for an
   *  existing Money/GP/etc. field if NEITHER of those exist yet. Only
   *  ever WRITES field.moneyFieldId when it was empty to begin with —
   *  an explicit choice is never overridden. */
  function autoAssignMoneyFieldIfNeeded(field) {
    if (field.moneyFieldId) return;
    let detected = character.moneyFieldId
      ? flattenAllFieldsAcrossTabs().find(f => f.id === character.moneyFieldId)
      : null;
    if (!detected) detected = detectMoneyFieldByName();
    if (!detected) return;
    // field.moneyFieldId rides along with the layout save below, but
    // the character-wide default is top-level state — commitMutation's
    // persist() only writes layout/sheetTabs, so it needs its own
    // save or a reload silently drops it (same drift class as the old
    // ruleset-mirror bug).
    let assignedDefault = false;
    commitMutation(() => {
      field.moneyFieldId = detected.id;
      if (!character.moneyFieldId) {
        character.moneyFieldId = detected.id;
        assignedDefault = true;
      }
    }, { render: false });
    if (assignedDefault) saveWithStatus("moneyFieldId", character.moneyFieldId);
  }

  /** A field's current numeric value regardless of which tab it lives
   *  on — formulaValues (see computeSheetValues) only ever covers the
   *  global tab, since that's the only pool formulas/bundles can
   *  reference, but a Catalog's money field can now be picked from
   *  ANY tab. Prefers the live computed value for a global formula
   *  field; otherwise parses its own plain typed value directly. */
  function readFieldNumericValue(field) {
    if (!field) return 0;
    if (field.formula && Number.isFinite(formulaValues[field.id])) {
      return formulaValues[field.id];
    }
    return floatFromRichText(field.value || "");
  }

  /** Migrates a dropdown's choices from the old plain-string shape to
   *  { id, text, bundle } objects (needed once bundles exist — a
   *  choice needs somewhere to hang stat/access modifiers off of) and
   *  backfills a missing `bundle` on already-migrated choices. Also
   *  remaps `.selected` from the old text value to the new id, since
   *  selection is tracked by id from here on (stable across renames,
   *  same reasoning as everything else keyed by id in this file). */
  function normalizeChoiceObjects(allFields) {
    return normalizeChoiceObjectsIn(allFields, newId);
  }

  function resolveFieldById(id) {
    return flattenGlobalFields().find(f => f.id === id) || null;
  }

  /** Which of `field`'s own choices are currently selectable, given
   *  every OTHER dropdown's bundle-driven access rules (see the
   *  "Modifiers" editor on each choice in openDropdownChoicesEditor).
   *  A choice stays allowed unless some active bundle elsewhere
   *  explicitly restricts this field and excludes it — multiple
   *  restrictions intersect, they don't override each other. */
  /** Reads the character-designated "Level" field's current value out
   *  of a value map — used to gate any bundle modifier/access rule
   *  that sets a minLevel (see renderModifiersPanel's "Min Level"
   *  inputs). No level field designated (character.levelFieldId
   *  unset) means nothing is gated — bundles built before leveling
   *  existed, or on a sheet that doesn't use it, keep working exactly
   *  as they did before this. */
  function currentLevel(valueMap) {
    return levelFromMap(character.levelFieldId, valueMap);
  }

  function getAllowedChoiceIds(field, allFields) {
    const level = currentLevel(formulaValues);
    const { allowed, narrowed } = narrowChoicesByBundleAccess(field, allFields, level);
    // Fallback only. If an applied Class bundle already narrowed the
    // Subclass field via a real dropdownAccess rule above, that data
    // wins outright and this hardcoded table is skipped, so a full
    // imported subclass list never gets clipped back down to the
    // small built-in one. Only kicks in for sheets without a bundle
    // wired up yet.
    if (!narrowed && isSubclassField(field)) {
      const className = selectedChoiceName("class", "Class");
      const classEntry = getRulesetClass(character.rules?.rulesetId || character.rulesetId, className);
      return applySubclassFallback(allowed, field, {
        className,
        classEntry,
        level: currentCharacterLevel(),
      });
    }
    return allowed;
  }

  /** Run once per render, before anything reads .selected: if some
   *  OTHER dropdown's bundle rule (or a straight-up removed choice)
   *  invalidated a field's current selection, clear it rather than
   *  silently keep showing/using a value that's no longer a real
   *  option — e.g. changing Class away from Wizard should drop a
   *  Subclass selection that only made sense for Wizard. Returns
   *  whether anything actually changed, so the caller knows whether
   *  to persist the correction. */
  function normalizeDropdownSelections(allFields) {
    return normalizeDropdownSelectionsIn(allFields, (field, fields) => getAllowedChoiceIds(field, fields));
  }

  /** Applies every active bundle's stat modifiers on top of the plain
   *  formula results — "active" meaning: this dropdown field's
   *  currently SELECTED choice has a bundle with modifiers attached
   *  (see the per-choice "Modifiers" editor). Modifiers apply in
   *  field order, each building on whatever came before — if two
   *  different selected choices both touch the same target field,
   *  order genuinely matters (a flat +2 vs. a ×1.5 gives a different
   *  result depending which runs first).
   *
   *  KNOWN LIMITATION: computeSheetValues() re-runs formulas AFTER
   *  this, so a modifier targeting an already-FORMULA-driven field
   *  gets overwritten by that field's own formula and won't stick.
   *  That's actually the right behavior for the common case — a race
   *  bonus modifying a plainly-typed ability score, which other
   *  formulas then read off of — just not for a modifier aimed at a
   *  field that's itself computed.
   *
   *  A "grant" op is different in kind from the numeric ones — it
   *  doesn't touch valueMap at all, since a checkbox's rendered state
   *  comes straight from field.checked, not from any computed value
   *  the way a formula field's display does. It adds to
   *  grantedCheckboxes instead (a Set of "fieldId::index" strings),
   *  which buildFieldValue's checkbox branch reads to OR into its
   *  normal checked state — same "recomputed fresh every render, not
   *  a permanent mutation" model as the numeric ops, just via a
   *  different mechanism because checkboxes don't have a formula-style
   *  computed layer to hook into.
   *
   *  "grantTag" is the same idea for a "taglist" field (Languages,
   *  Armor/Weapon/Tool Proficiencies): mod.value is the specific tag
   *  string being granted (e.g. "battleaxe"), added to
   *  grantedTags.get(fieldId) — a per-field Set, since (unlike a
   *  checkbox's small fixed index range) a taglist's own vocabulary
   *  is much bigger and each grant needs to name exactly which entry
   *  it means. */
  function applyStatModifiers(modifiers, valueMap, checkboxGrants, tagGrants, level) {
    applySharedStatModifiers(modifiers, valueMap, checkboxGrants, tagGrants, level);
  }

  // --- Multiclassing -------------------------------------------------------
  // Secondary classes live in character.rules.multiclass as
  // [{ name, levels, subclass }]; the primary class's levels stay
  // derived (total minus secondary) so single-class sheets behave
  // exactly as before. Class/subclass bundle minLevel gates resolve
  // per class via bundleLevelFor, threaded through the pure appliers
  // as an optional levelFor (omitted = uniform level = old behavior).
  const SUBCLASS_CLASS_BY_NAME = new Map(
    SUBCLASS_SUPPLEMENT.map((s) => [(s.name || "").toLowerCase().replace(/[^a-z0-9]/g, ""), s.className])
  );

  function multiclassEntries() {
    return Array.isArray(character.rules?.multiclass) ? character.rules.multiclass : [];
  }

  /** Primary class = whatever the Class dropdown shows (the wizard's
   *  rules.className as fallback). */
  function primaryClassName() {
    const field = findStarterField("class", "Class");
    const selected = (field?.choices || []).find((c) => c.id === field.selected);
    return selected?.text || character.rules?.className || "";
  }

  function primaryClassLevel() {
    const total = currentCharacterLevel() ?? character.rules?.level ?? 1;
    const used = multiclassEntries().reduce((n, e) => n + (Number(e.levels) || 0), 0);
    return Math.max(1, total - used);
  }

  function classLevelOf(className) {
    if (!className) return null;
    if (className === primaryClassName()) return primaryClassLevel();
    const entry = multiclassEntries().find((e) => e.name === className);
    return entry ? entry.levels : null;
  }

  /** Class level gating a dropdown bundle's minLevel'd grants: Class
   *  field → that class's levels, Subclass field → the owning class's
   *  levels, everything else → null (uniform total level). */
  function bundleLevelFor(field, choice) {
    if (!multiclassEntries().length) return null;
    const label = (field?.label || "").toLowerCase();
    if (label === "class") return classLevelOf(choice?.text);
    if (label === "subclass" || field?.id === "subclass") {
      const cls = SUBCLASS_CLASS_BY_NAME.get(((choice?.text) || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
      if (!cls) return null;
      return classLevelOf(cls);
    }
    return null;
  }

  /** Secondary class + subclass bundles with their class levels,
   *  ready for the appliers' extraBundles param. Class bundles are
   *  stripped per PHB multiclassing (no save proficiencies, no
   *  armor/weapon fixed grants — skills/tools stay pickable, and the
   *  Equipment Proficiencies tab covers the rest by hand). */
  function extraSecondaryBundles() {
    const out = [];
    for (const entry of multiclassEntries()) {
      const lvl = entry.levels;
      const classBundle = stripSecondaryClassBundle(bundleFor("Class", entry.name, currentRulesetId()));
      if (classBundle) out.push({ bundle: classBundle, level: lvl, source: entry.name });
      if (entry.subclass) {
        const subBundle = bundleFor("Subclass", entry.subclass, currentRulesetId());
        if (subBundle) out.push({ bundle: subBundle, level: lvl, source: entry.subclass });
      }
    }
    return out;
  }

  function activeRuleChoiceGroups(fields, valueMap) {
    // Dropdown bundles' groups plus taken feats' own groups (Resilient's
    // ability pick, Skilled's skill picks, …) — feat groups are keyed
    // `feat:<name>:<groupId>` (see featChoiceGroupsFor) so their picks
    // live in character.rules.choices like every other choice group.
    // Equipment-proficiency pickers ride along too so their picks keep
    // applying after setup; Common stays locked everywhere. Pack-gated
    // groups/options (requiresPack) filter against the included books.
    return lockCommonInLanguageGroups([
      ...activeChoiceGroupsFor(fields, currentLevel(valueMap), bundleLevelFor, extraSecondaryBundles(), includedRulesetIds(character.rules)),
      ...featChoiceGroupsFor(selectedFeatBundles()),
      ...equipmentProficiencyGroups(),
    ]);
  }

  function selectedRuleOptions(fields, valueMap) {
    return selectedRuleOptionsIn(
      activeRuleChoiceGroups(fields, valueMap),
      character.rules?.choices || {}
    );
  }

  function selectedFeatBundles() {
    return selectedFeatBundlesIn(
      character.rules?.feats || [],
      character.rules?.rulesetId || character.rulesetId,
      (category, name, rulesetId) => bundleFor(category, name, rulesetId)
    );
  }

  function applyBundleModifiers(fields, valueMap, grantedCheckboxes, grantedTags) {
    return applyBundleModifiersIn(
      fields,
      valueMap,
      grantedCheckboxes,
      grantedTags,
      currentLevel(valueMap),
      selectedRuleOptions(fields, valueMap),
      selectedFeatBundles(),
      (modifiers, vm, cb, tags, level) => applyStatModifiers(modifiers, vm, cb, tags, level),
      bundleLevelFor,
      extraSecondaryBundles()
    );
  }

  function collectGrantedFeatures(fields, valueMap) {
    return collectGrantedFeaturesIn(
      fields,
      currentLevel(valueMap),
      selectedRuleOptions(fields, valueMap),
      selectedFeatBundles(),
      bundleLevelFor,
      extraSecondaryBundles(),
      includedRulesetIds(character.rules)
    );
  }

  function collectResourceGrants(fields, valueMap) {
    return collectResourceGrantsIn(
      fields,
      currentLevel(valueMap),
      valueMap,
      selectedRuleOptions(fields, valueMap),
      selectedFeatBundles(),
      (formula, vm) => evaluateFormulaNode(formula, vm),
      bundleLevelFor,
      extraSecondaryBundles()
    );
  }

  /** Applies `addItem` bundle grants (oath/domain/circle spells,
   *  feat-granted spells, racial spells) into their target textlist
   *  fields — normally the auto-created "Spells Known" list. Runs at
   *  selection-commit time (dropdown pick, setup finish, level-up
   *  apply), not every render, so granted entries are ordinary stored
   *  items afterward: the player can rename or remove them freely and
   *  they won't be re-asserted. Missing items are appended uniquely;
   *  nothing is ever removed here. `level` gates minLevel'd grants
   *  (e.g. Tiefling Darkness at character level 5). */
  /** Granted list items (oath/domain/circle spells, feat spells, …)
   *  for `level`. Returns the grants that had nowhere to land
   *  (`[{ fieldId, items }]`) so Finish Setup can report them instead
   *  of dropping them silently — callers that don't care (level-up
   *  paths) simply ignore the return. */
  function syncGrantedListItems(level) {
    const fields = flattenGlobalFields();
    const grants = collectListItemGrantsIn(fields, level, selectedRuleOptions(fields, formulaValues), selectedFeatBundles(), bundleLevelFor, extraSecondaryBundles());
    const unapplied = [];
    grants.forEach(({ fieldId, items }) => {
      let target = findSetupField(fieldId, null);
      if (!target && fieldId === "spellsKnown") target = ensureSpellListField();
      if (!target || target.fieldType !== "textlist") {
        unapplied.push({ fieldId, items: [...items] });
        return;
      }
      items.forEach((item) => appendUniqueTextListItem(target, item));
    });
    return unapplied;
  }

  function computeSheetValues(fields) {
    const { valueMap, granted } = computeSheetValuesIn(fields, {
      computeAllFormulasFn: (f) => computeAllFormulas(f),
      applyBundleModifiersFn: (f, vm, cb, tags) => applyBundleModifiers(f, vm, cb, tags),
      collectGrantedFeaturesFn: (f, vm) => collectGrantedFeatures(f, vm),
      evaluateFormulaNodeFn: (formula, vm) => evaluateFormulaNode(formula, vm),
    });
    grantedCheckboxes = granted.checkboxes;
    grantedTags = granted.tags;
    grantedFeatures = granted.features;
    return valueMap;
  }

  /** A radio field's optional optionsFormula (see the "=" button in
   *  its own toolbar) computes how many buttons it shows, using the
   *  SAME variable pool (valueMap) as every other formula on the
   *  sheet — so a spell-slot radio group can reference the character's
   *  Level field directly, no different from any Num Field's formula.
   *  Clamped to zero or more and rounded, since a fractional or
   *  negative button count isn't meaningful. */
  function computeRadioOptionCounts(fields, valueMap) {
    return computeRadioOptionCountsIn(fields, valueMap, (formula, vm) => evaluateFormulaNode(formula, vm));
  }

  /** Live spell-slot counts for the sheet's standard slots1-slots9
   *  fields — see the spellSlotCounts declaration above for why this
   *  exists alongside computeRadioOptionCounts rather than being
   *  folded into it. Sourced from the sheet's actual Class dropdown
   *  selection (not character.rules.className, which only updates
   *  when the Creation/Leveling wizard is actually used — see
   *  applyBundleModifiers/collectGrantedFeatures for why the dropdown
   *  itself, not character.rules, is what everything reactive already
   *  treats as "the current class") and the same currentLevel(valueMap)
   *  every other live computation on the sheet uses, via
   *  getLevelUpPlan/slotsFor in dnd5e.js — the same table
   *  ensureStandardSpellSlotFields and the wizard's own summary text
   *  already trust. */
  function computeSpellSlotCounts(fields, valueMap) {
    // Multiclassed casters share the PHB multiclass spellcaster table
    // (Warlock pact slots merge in separately, taking the higher count
    // per tracker since the sheet has one radio row per slot level).
    // Single-class sheets take the untouched per-class plan path below.
    const secondaries = multiclassEntries();
    if (secondaries.length) {
      const rulesetId = character.rules?.rulesetId || character.rulesetId;
      const slices = [{ name: primaryClassName(), levels: primaryClassLevel(), subclass: selectedChoiceName("subclass", "Subclass") }];
      for (const e of secondaries) slices.push({ name: e.name, levels: e.levels, subclass: e.subclass });
      const withCasters = slices.map((s) => ({
        ...s,
        caster: getRulesetClass(rulesetId, s.name)?.caster || null,
      }));
      const merged = new Map();
      for (const change of multiclassSlotsFor(withCasters)) {
        merged.set(change.fieldId, Math.max(merged.get(change.fieldId) || 0, change.options));
      }
      for (const s of withCasters) {
        if (s.caster !== "pact" || s.levels < 1) continue;
        const pact = getLevelUpPlan(rulesetId, s.name, s.levels)?.slotChanges || [];
        for (const change of pact) {
          merged.set(change.fieldId, Math.max(merged.get(change.fieldId) || 0, change.options));
        }
      }
      return Object.fromEntries(merged);
    }
    // Sourced from the sheet's actual Class dropdown selection (not
    // character.rules.className, which only updates when the
    // Creation/Leveling wizard is actually used) and the same
    // currentLevel(valueMap) every other live computation uses.
    return computeSpellSlotCountsIn(fields, valueMap, {
      rulesetId: character.rules?.rulesetId || character.rulesetId,
      className: selectedChoiceName("class", "Class"),
      level: currentLevel(valueMap),
      planFn: (rulesetId, className, level) => getLevelUpPlan(rulesetId, className, level),
    });
  }

  /** If a radio field's live button count just shrank below its
   *  current selection (a formula-driven count, or one of the
   *  standard spell-slot fields dropping as Level/Class change — e.g.
   *  editing Level back down after marking slots used), clear the now
   *  out-of-range selection rather than leave it silently pointing at
   *  a button that no longer exists — same reasoning as
   *  normalizeDropdownSelections. */
  function normalizeRadioSelections(fields, formulaCounts, slotCounts) {
    return normalizeRadioSelectionsIn(fields, formulaCounts, slotCounts);
  }

  function sourceBlockFor(block) {
    return resolveSourceBlock(block, globalLayout());
  }

  function effectiveStyle(block) {
    return effectiveStyleFor(block, sourceBlockFor(block));
  }

  function styleForEditing(node) {
    if (node.sourceBlockId) return effectiveStyle(node);
    return node.style || {};
  }

  function setNodeStyleValue(node, styleKey, value) {
    if (!node.sourceBlockId) {
      node.style[styleKey] = value;
      return;
    }

    const sourceValue = sourceBlockFor(node).style?.[styleKey];
    if (!node.styleOverrides) node.styleOverrides = {};
    if (valuesMatch(value, sourceValue)) {
      delete node.styleOverrides[styleKey];
    } else {
      node.styleOverrides[styleKey] = value;
    }
  }

  /** Flips whether a block/field's own border is drawn at all (its
   *  base color otherwise, transparent when hidden) — a plain on/off,
   *  not tied to the popover's other style fields. Goes through
   *  setNodeStyleValue like every other style property, so it
   *  respects the same block-reference-override behavior as bg/font/
   *  etc. Selection still shows through even with the border hidden —
   *  see the .grid-node.is-selected CSS. */
  function toggleBorderVisibility(node, wrapperEl) {
    const nextValue = styleForEditing(node).showBorder === false;
    commitMutation(() => {
      setNodeStyleValue(node, "showBorder", nextValue);
    }, { render: false });
    applyNodeStyle(wrapperEl, styleForEditing(node));
  }

  function buildBorderToggleButton(node, wrapperEl) {
    return el("button", {
      type: "button", title: "Toggle border", text: "▢",
      onclick: (e) => { e.stopPropagation(); toggleBorderVisibility(node, wrapperEl); },
    });
  }

  function effectiveBlock(block) {
    return effectiveBlockFor(block, sourceBlockFor(block));
  }

  function blockTabs(blockId) {
    return blockTabsFor(blockId, character.sheetTabs);
  }

  function addBlockReferenceToActiveTab(blockId, x, y) {
    const source = globalLayout().find(block => block.id === blockId);
    if (!source) return;
    if (isGlobalTab()) {
      currentLayout().push(clone({ ...source, id: newId(), x, y }));
      return;
    }
    currentLayout().push({
      id: newId(),
      kind: "block",
      sourceBlockId: blockId,
      x,
      y,
      w: source.w,
      h: source.h,
      styleOverrides: {},
    });
  }

  function addFieldReferenceToActiveTab(blockId, fieldId, x, y) {
    const source = globalLayout().find(block => block.id === blockId);
    const field = source?.children?.find(child => child.id === fieldId);
    if (!source || !field) return;
    const block = createBlock({
      name: field.label || source.name || "Stat",
      x,
      y,
      w: Math.max(1, field.w || 1),
      h: BLOCK_HEADER_ROWS + Math.max(1, field.h || 1),
    });
    block.children = [clone({ ...field, id: newId(), x: 0, y: 0 })];
    currentLayout().push(block);
  }

  function colWidthPx() {
    const availableWidth = scrollWrapper.clientWidth || root.clientWidth || 960;
    return colWidthFor(availableWidth, PAGE_COLS, GAP_PX, MIN_CELL_PX);
  }

  /** How tall the scroll wrapper should be to fill the rest of the
   *  viewport below it — recomputed on every render since window size
   *  (and thus how much vertical space remains) can change. */
  function availableViewportHeight() {
    const top = scrollWrapper.getBoundingClientRect().top;
    return Math.max(300, window.innerHeight - top - 16); // 16px breathing room at the bottom
  }

  // Only inset in edit mode — that's the only time the grid lines this
  // reveals are actually drawn (see applyGridLines), and it keeps
  // normal "play mode" sizing pixel-identical to before.
  const NODE_INSET_PX = 3;

  /** Focuses whichever .grid-node currently corresponds to `id` — used
   *  after any action that rebuilds the grid's DOM (a full render)
   *  where we want the same logical node to stay/become selected
   *  rather than losing focus just because its old DOM element was
   *  torn down and replaced. */
  function refocusNodeById(id) {
    if (!id) return;
    const el = pageGrid.querySelector(`[data-node-id="${id}"]`);
    if (el) el.focus();
  }

  function applyRect(el, node, cw) {
    const inset = editMode ? NODE_INSET_PX : 0;
    const s = rectStyle(node, cw, GAP_PX, inset);
    el.style.left = s.left;
    el.style.top = s.top;
    el.style.width = s.width;
    el.style.height = s.height;
  }

  /** The actual width-growing loop: if a field's label no longer fits
   *  in its own reserved space (one cell's worth, typically, when
   *  positioned left/right — or the full field width, top/bottom),
   *  grow the FIELD sideways by a cell rather than let the label clip
   *  or ellipsize, one cell at a time until the current text fits (or
   *  the field has consumed the rest of its parent block's width, if
   *  that comes first). Only ever grows — deleting text back down
   *  doesn't shrink the field back up. No-ops without a parentBlock
   *  (e.g. mid-way through a label-position cycle animation, where
   *  this isn't relevant yet), and reads/writes field.w and fieldEl
   *  directly without going through commitMutation — that part's up
   *  to whichever of the two callers below is using it, since they
   *  need different answers for "does this count as an edit". Returns
   *  whether it actually grew anything. */
  function growFieldToFitLabel(labelEl, field, fieldEl, parentBlock) {
    if (!parentBlock) return false;
    const maxW = labelMaxWidth(parentBlock, field);
    if (!shouldGrowForLabel(field.w, maxW, labelEl.scrollWidth, labelEl.clientWidth)) return false;
    while (shouldGrowForLabel(field.w, maxW, labelEl.scrollWidth, labelEl.clientWidth)) {
      field.w += 1;
      applyRect(fieldEl, field, colWidthPx());
    }
    return true;
  }

/** Same fit-check as growFieldToFitLabel, used after a person edits
 *  a label by hand (typing past what its cell can hold) — wrapped in
 *  commitMutation so the wider field is persisted and folds into the
 *  same undo step as the edit that caused it, the way any other
 *  consequence of an edit would. The plain pre-check before
 *  commitMutation (mirroring growFieldToFitLabel's own guard) means
 *  an already-fitting label never touches the undo stack or triggers
 *  a save for doing nothing. Grows in whole grid-cell increments.
 *  Never allows the label to extend outside its parent block. */
  function growFieldIfLabelOverflows(labelEl, field, fieldEl, parentBlock) {
    if (!parentBlock) return;
    const maxW = labelMaxWidth(parentBlock, field);
    if (!shouldGrowForLabel(field.w, maxW, labelEl.scrollWidth, labelEl.clientWidth)) return;
    commitMutation(() => {
      growFieldToFitLabel(labelEl, field, fieldEl, parentBlock);
    }, { render: false });
    // Ensure the field never extends beyond parent block boundaries
    const contentRows = parentBlock.h - BLOCK_HEADER_ROWS;
    if (field.x + field.w > parentBlock.w) {
      field.w = parentBlock.w - field.x;
    }
    if (field.y + field.h > contentRows) {
      field.h = contentRows - field.y;
    }
  }

  function applyNodeStyle(el, style) {
    applyCssToEl(el, styleToCss(style || {}));
  }

  // Sheets created before the Combat fields got stable ids (see
  // blockModel.js: "armorClass", "speed", "hpMax") carry random ids on
  // the same-labeled fields — pin them so feat bundles (Mobile's +10
  // speed, …) and formulas can target those fields by id. Skips a field
  // when anything still references its old id (a user-authored formula
  // dragging it in by id), rather than silently breaking that
  // reference — such sheets simply keep working as before, without the
  // new feat automation on that one field.
  function ensureStableCombatIds() {
    const pairs = [["armorClass", "Armor Class"], ["speed", "Speed"], ["hpMax", "HP Max"]];
    const all = flattenFieldsAcrossTabs(character.sheetTabs);
    const used = new Set(all.map((f) => f.id));
    const serialized = JSON.stringify(character.sheetTabs);
    let changed = false;
    pairs.forEach(([id, label]) => {
      if (used.has(id)) return;
      const match = all.find((f) => (f.label || "") === label && f.fieldType === "text");
      if (!match || match.id === id) return;
      if (serialized.includes(`{{${match.id}}}`) || serialized.includes(`{{${match.id}::`)) return;
      match.id = id;
      used.add(id);
      changed = true;
    });
    return changed;
  }

  /** Opts the starter sheet's check/save/attack numbers into dice
   *  rolling (ability/save/skill modifiers, initiative, spell
   *  attacks) — everything else (Level, Prof. Bonus, HP, money, …)
   *  stays quiet. Anyone can flip any field with its toolbar dice
   *  button; this only seeds the sensible defaults once. */
  function ensureRollableFlags() {
    const ids = new Set([
      ...ABILITY_IDS.map((id) => `${id}Mod`),
      ...ABILITY_IDS.map((id) => `${id}SaveMod`),
      ...SKILLS.map((skill) => `${skill.id}Mod`),
      "initiative",
      "spellAttackBonus",
    ]);
    let changed = false;
    flattenFieldsAcrossTabs(character.sheetTabs).forEach((f) => {
      if (f.fieldType === "text" && ids.has(f.id) && f.rollable !== true) {
        f.rollable = true;
        changed = true;
      }
    });
    return changed;
  }

  /** One-time upgrade for sheets created before the Spellcasting
   *  "Ability" radio became a real Intelligence/Wisdom/Charisma
   *  dropdown: converts the field in place (keeping the pick) and
   *  drops the now-redundant "1=INT 2=WIS 3=CHA" legend caption. */
  function ensureSpellAbilityDropdown() {
    let changed = false;
    const tabs = character.sheetTabs || [];
    tabs.forEach((tab) => {
      (tab.layout || []).forEach((block) => {
        const kids = block.children || [];
        const radio = kids.find((f) => f.id === "spellAbility" && f.fieldType === "radio");
        if (radio) {
          radio.fieldType = "dropdown";
          radio.label = "Spell Ability";
          radio.choices = [
            { id: "1", text: "Intelligence" },
            { id: "2", text: "Wisdom" },
            { id: "3", text: "Charisma" },
          ];
          radio.selected = radio.selected != null ? String(radio.selected) : null;
          radio.autoAlphabetize = false;
          radio.w = 3;
          delete radio.options;
          delete radio.checked;
          delete radio.optionsFormula;
          radio.tooltip = "Which ability powers your spells. Sets your Save DC and spell attacks — pick once.";
          changed = true;
        }
        const legendIndex = kids.findIndex((f) => f.fieldType === "label" && (f.value || "") === "1=INT 2=WIS 3=CHA");
        if (legendIndex !== -1) {
          kids.splice(legendIndex, 1);
          changed = true;
        }
      });
    });
    return changed;
  }

  /** One-time upgrade for sheets created before the Attacks list got
   *  a stable id: pin it by its starter label so the toolbar Suggest
   *  button can find it. Skipped when anything references the old id
   *  in a formula, same caution as ensureStableCombatIds. */
  function ensureAttacksId() {
    const all = flattenFieldsAcrossTabs(character.sheetTabs);
    if (all.some((f) => f.id === "attacks")) return false;
    const match = all.find((f) => f.fieldType === "textlist" && (f.label || "") === "Name — to hit — damage/type");
    if (!match) return false;
    const serialized = JSON.stringify(character.sheetTabs);
    if (serialized.includes(`{{${match.id}}}`) || serialized.includes(`{{${match.id}::`)) return false;
    match.id = "attacks";
    return true;
  }

  /** One-time spelling migration for saves created while the Circle
   *  of the Shepherd was misspelled "Shephard": renames the pick
   *  wherever a name (not an id) is stored, before selection
   *  normalization could clear it as invalid. */
  function ensureShepherdSpelling() {
    const OLD_NAME = "Circle of the Shephard";
    const NEW_NAME = "Circle of the Shepherd";
    let changed = false;
    flattenFieldsAcrossTabs(character.sheetTabs).forEach((f) => {
      (f.choices || []).forEach((c) => {
        if (c.text === OLD_NAME) {
          c.text = NEW_NAME;
          changed = true;
        }
      });
    });
    const rules = character.rules || {};
    if (rules.subclass === OLD_NAME) {
      rules.subclass = NEW_NAME;
      changed = true;
    }
    (rules.multiclass || []).forEach((entry) => {
      if (entry.subclass === OLD_NAME) {
        entry.subclass = NEW_NAME;
        changed = true;
      }
    });
    Object.values(character.levelUps || {}).forEach((entry) => {
      if (entry && entry.subclass === OLD_NAME) {
        entry.subclass = NEW_NAME;
        changed = true;
      }
    });
    return changed;
  }

  function renderPageGrid() {
    // A full render tears down and rebuilds every node in pageGrid, and
    // clearing it out momentarily (before the new content is appended
    // back in) can leave the browser thinking the page is empty and
    // clamp its scroll position to the top. That's what made clicking
    // a row, changing a dropdown, or editing a number field feel like
    // the whole page "refreshed" out from under you — so the position
    // is saved here and explicitly restored once the rebuild is done
    // (see both exit points below). The sheet scrolls with the page
    // itself (no inner scroll box), so this is window scroll now.
    if (ensureStableCombatIds()) persist();
    if (ensureRollableFlags()) persist();
    if (ensureSpellAbilityDropdown()) persist();
    if (ensureAttacksId()) persist();
    if (ensureShepherdSpelling()) persist();
    const preservedScrollTop = window.scrollY || 0;
    pageGrid.innerHTML = "";
    pageGrid.classList.toggle("is-edit-mode", editMode);
    pendingLabelOverflowChecks = [];
    const allFields = flattenGlobalFields();
    // Computed BEFORE normalizing dropdown selections (not after, as
    // you might expect) so that a minLevel-gated dropdown-access rule
    // checks the level this render actually computed, not last
    // render's — otherwise leveling up and a selection becoming
    // valid/invalid again would always be one render behind. If
    // normalizing invalidates a selection, that can in turn change
    // which bundle is active, so it's recomputed once more afterward.
    const renderState = prepareRenderState(allFields, {
      normalizeChoiceObjectsFn: (f) => normalizeChoiceObjects(f),
      computeValuesFn: (f) => computeSheetValues(f),
      normalizeDropdownsFn: (f) => normalizeDropdownSelections(f),
      optionCountsFn: (f, vm) => computeRadioOptionCounts(f, vm),
      slotCountsFn: (f, vm) => computeSpellSlotCounts(f, vm),
      normalizeRadioFn: (f, counts, slots) => normalizeRadioSelections(f, counts, slots),
    });
    formulaValues = renderState.formulaValues;
    radioOptionCounts = renderState.radioCounts;
    spellSlotCounts = renderState.slotCounts;
    if (renderState.needsNormalizedPersist) persist();
    // Edit mode keeps a viewport-tall canvas floor (room to drag
    // things into open space); play mode sizes exactly to content —
    // the page itself provides the scroll either way.
    const availableHeight = editMode ? availableViewportHeight() : 0;

    if (isLinkedSheetTab(activeTab())) {
      pageGrid.classList.add("page-grid--leveling");
      pageGrid.style.width = "";
      pageGrid.style.height = "";
      pageGrid.style.backgroundImage = "";
      pageGrid.style.backgroundPosition = "";
      renderLinkedSheetTab();
      window.scrollTo(0, preservedScrollTop);
      return;
    }
    if (activeTab().kind === "leveling" || activeTab().kind === "rules") {
      pageGrid.classList.add("page-grid--leveling");
      pageGrid.style.width = "";
      pageGrid.style.height = "";
      pageGrid.style.backgroundImage = "";
      pageGrid.style.backgroundPosition = "";
      if (activeTab().kind === "rules") renderRulesTab();
      else renderLevelingTab();
      window.scrollTo(0, preservedScrollTop);
      return;
    }
    pageGrid.classList.remove("page-grid--leveling");

    const cw = colWidthPx();
    renderMainGridInto(pageGrid, scrollWrapper, {
      cw,
      availableHeight,
      layout: currentLayout(),
      pageCols: PAGE_COLS,
      gapPx: GAP_PX,
      contentHeightFn: (layout) => contentHeight(layout),
      gridLinesFn: (el, w, origin) => applyGridLines(el, w, origin),
      blockNodeFn: (block, w) => renderBlockNode(block, w),
      growFn: (labelEl, field, fieldEl, parentBlock) => growFieldToFitLabel(labelEl, field, fieldEl, parentBlock),
      overflowChecks: pendingLabelOverflowChecks,
      paintFn: () => paintSelection(),
      toolbarEls: [groupToolbar, groupBorderOverlay],
      isEdit: editMode,
    });
    window.scrollTo(0, preservedScrollTop);
  }

  // --- Linked sheet tab (mounts / companions) ---
  //
  // Read-only by design - see the note at the top of linkedSheet.js for
  // why editing through a link would break undo. The linked character is
  // resolved ONLY through the owner's own character list, which is
  // already filtered by owner, so ownership needs no separate check: an
  // id that isn't in that list simply doesn't resolve.
  function renderLinkedSheetTab() {
    const tab = activeTab();
    const config = linkedTabConfig(tab);
    const ownedCharacters = linkedCharacterList();
    const ownedIds = ownedCharacters.map((c) => c.id);
    const status = linkedSheetStatus(config, { ownedIds, selfId: character.id });
    // Only a character the user actually owns is ever read. The list is
    // the same list the picker offers, so what resolves is exactly what
    // can be chosen.
    const linkedCharacter = status === "ok"
      ? ownedCharacters.find((c) => c.id === config.characterId) || null
      : null;
    const wrap = el("div", { class: "linked-sheet" });
    renderLinkedSheetInto(wrap, {
      status,
      config,
      linkedCharacter,
      ownedCharacters,
      fieldById: (id) => findStarterField(null, linkedFieldLabelFor(id)),
      fieldByLabel: (id) => findStarterField(null, linkedFieldLabelFor(id)),
      onPick: (id) => {
        commitMutation(() => {
          tab.characterId = id;
        });
      },
    });
    pageGrid.append(wrap);
    if (status === "ok" && !linkedCharacter) {
      // Listed as owned but the document didn't come back with the list.
      // Distinct from "not-owned" so the message can say "pick another"
      // rather than "isn't yours".
      wrap.append(el("p", { class: "leveling-tab__intro", text: linkedSheetMessage("missing", config) }));
    }
  }

  function linkedFieldLabelFor(id) {
    return LINKED_DISPLAY_FIELDS.find((f) => f.id === id)?.label || id;
  }

  // The owner's own characters, for the linked-sheet picker. Cached after
  // the first load because a linked tab re-renders on every grid paint
  // and this is a network call; a stale list is fine, since the picker
  // re-reads it whenever a link changes and an id that has since been
  // deleted simply stops resolving.
  let ownedCharactersCache = null;
  function linkedCharacterList() {
    if (ownedCharactersCache) return ownedCharactersCache;
    ownedCharactersCache = [];
    if (typeof store?.listMyCharacters === "function") {
      Promise.resolve(store.listMyCharacters())
        .then((list) => {
          ownedCharactersCache = (list || [])
            // Only what the picker needs: an id and a name. Keeping the
            // full documents around would hold every other character's
            // whole sheet in memory for the life of this one.
            .map((c) => ({ id: c.id, name: c.name }));
          if (activeTab() && isLinkedSheetTab(activeTab())) renderPageGrid();
        })
        .catch((err) => console.error("Failed to list characters for linking:", err));
    }
    return ownedCharactersCache;
  }

  // --- Leveling tab --------------------------------------------------
  //
  // Deliberately NOT built from the draggable block/field grid every
  // other tab uses — a fixed, hand-laid-out list of rows (one per
  // character level) instead. Nothing here can be moved, resized, or
  // relabeled the way a normal block can; that's a conscious trade for
  // a much more usable layout for "fill in a form for level 7" than
  // the general-purpose grid would give without a lot of manual
  // block/field setup. Values live in character.levelUps (a plain
  // { "1": {...}, "2": {...} } object keyed by level, saved the same
  // standalone way character.name is — NOT through commitMutation/
  // undo-redo, since this isn't sheet-structure editing) rather than
  // in any tab's layout, and are always editable regardless of edit
  // mode, same as any other field's value.

  const LEVEL_UP_FIELDS = SHARED_LEVEL_UP_FIELDS;

  const saveLevelUps = debounce(() => saveWithStatus("levelUps", character.levelUps), 400);

  /** The character's current level, read straight off the "level"
   *  field our own starter layout creates (see createStarterLayout in
   *  blockModel.js) — null if that field's been removed/renamed or
   *  doesn't hold a plain 1-20 number, so callers should treat this as
   *  "unknown" and degrade gracefully rather than assume it exists. */
  function currentCharacterLevel() {
    // Match currentLevel()'s field (character.levelFieldId), not a
    // hardcoded "level" id — that default is right for brand-new
    // characters (see the levelFieldId seeding near createStarterLayout
    // above) and for older characters that predate levelFieldId
    // existing at all, but someone who's dragged a different field
    // onto the "Level" chip in the toolbar would otherwise have the
    // Leveling tab silently keep reading the old field while the rest
    // of the sheet (granted features, resource grants, dropdown
    // access) correctly followed the reassignment.
    const levelField = resolveFieldById(character.levelFieldId || "level");
    if (!levelField) return null;
    const n = parseInt(levelField.value, 10);
    return Number.isFinite(n) && n >= 1 && n <= 20 ? n : null;
  }

  function selectedChoiceName(fieldId, label) {
    return selectedChoiceNameIn(flattenGlobalFields(), fieldId, label);
  }

  /** Same "prefer the applied bundle's real data over the hardcoded PHB
   *  table" idea as the fallback in getAllowedChoiceIds, but shared with
   *  the guided Character/Leveling tabs below so an imported classes.json
   *  (once applied to the Class dropdown's choices) drives ALL THREE
   *  places subclass lists show up, not just the live Subclass field.
   *  Falls back to the hardcoded ruleset when no such bundle rule
   *  exists yet, so un-migrated sheets keep working. */
  function liveSubclassData(className) {
    const classField = findStarterField("class", "Class");
    const subclassField = findStarterField("subclass", "Subclass");
    const classChoice = classField?.choices?.find((c) => c.text === className);
    const fromBundle = subclassNamesFromBundleRule(classChoice, subclassField);
    // Union across every included content book: an imported bundle rule
    // plus each included pack's own list (PHB, Xanathar's, ...),
    // deduplicated. Level is the lowest known unlock. Book gating: a
    // class with known pack metadata shows only the subclasses its
    // included packs contribute; classes with no metadata (homebrew
    // imports) keep their full bundle list.
    const across = subclassesAcrossRulesets(className, includedRulesetIdsFor());
    const gated = new Set(across.subclasses);
    let bundleSubs = fromBundle?.subclasses || [];
    if (gated.size > 0 && bundleSubs.length) {
      bundleSubs = bundleSubs.filter((name) => gated.has(name));
    }
    const seen = new Set();
    const subclasses = [...bundleSubs, ...across.subclasses]
      .filter((name) => (seen.has(name) ? false : (seen.add(name), true)));
    const levels = [fromBundle?.subclassLevel, across.subclassLevel].filter(Number.isFinite);
    if (!subclasses.length) return { subclasses: [], subclassLevel: Infinity };
    return { subclasses, subclassLevel: levels.length ? Math.min(...levels) : Infinity };
  }

  /** Minimal step-wizard shell shared by character creation and
   *  leveling. `steps` is an ordered array of
   *  {id, title, isApplicable(), render(container)}. isApplicable is
   *  re-checked on every render, so a step whose relevance depends on
   *  an earlier answer (e.g. "does this class grant a subclass at this
   *  level") is skipped automatically rather than needing to be
   *  pre-filtered by the caller — same idea as the level-gating already
   *  used for dropdownAccess elsewhere in this file.
   *
   *  `stepState` is a small {index} object the caller keeps around
   *  outside this function (see creationWizardState/levelingWizardState
   *  above) so the current step survives the full teardown-and-rebuild
   *  that renderPageGrid() does on every save.
   *
   *  Dots can always go back and Back always works — there's no
   *  "locking in" a step — but Next and forward dot-jumps wait until
   *  the current page's decisions are made (see isComplete on each
   *  step). Re-picking an earlier answer (e.g. Class)
   *  just edits the same live field/bundle data every other part of
   *  the sheet reads from, so nothing needs to be specially undone;
   *  see getAllowedChoiceIds/applyBundleModifiers, which recompute
   *  everything from the current selection on every render anyway. */
  function renderStepWizard(steps, stepState, { title, intro, onNavigate } = {}) {
    return renderStepWizardInto(steps, stepState, { title, intro, onNavigate }, () => renderPageGrid());
  }

  /** Re-evaluates wizard Next/dot gating in place (no full re-render)
   *  — called after mutations that save without rebuilding the page,
   *  so Next unlocks the moment the last required pick lands. */
  function refreshWizardNav() {
    const wiz = pageGrid.querySelector(".wizard");
    if (wiz && typeof wiz.refreshWizardNav === "function") wiz.refreshWizardNav();
  }

  function rulesetOptionNames(rulesetId, category, fallback = []) {
    // Feats are baked in (js/data/featBundles.js, compiled from
    // docs/New Info/5e-feats.txt), not per-ruleset library entries — so the
    // ASI step's feat picker falls back to the full feat list. A
    // same-named library Feat still wins when one is imported (see
    // rulesetOptionNamesIn: library matches take precedence over fallback).
    if ((category || "").toLowerCase() === "feat" && fallback.length === 0) fallback = FEAT_NAMES;
    // Union across every included source (passed id first), so
    // checking an extra source adds its options everywhere rather
    // than swapping one list for another.
    const ids = [rulesetId, ...includedRulesetIdsFor()].filter(Boolean);
    return rulesetOptionNamesIn(bundleLibraryCache, [...new Set(ids)], category, fallback);
  }

  /** Which catalog kind a picker's keywords are asking about. Subraces
   *  map to "race" — the subrace rows read flavor from the same Races
   *  catalog. */
  const CATALOG_LINK_KIND = {
    race: "Race", species: "Race", subrace: "Race",
    class: "Class",
    subclass: "Subclass",
    background: "Background",
    feat: "Feat",
  };

  /** Find the `catalogEntryId` a bundle carries for this name, so flavor
   *  resolves through the explicit link rather than by re-deriving it from
   *  the name on every render. Deliberately a quiet, narrow scan of the two
   *  places a bundle can live (the library cache and the baked-in starter
   *  dropdown choices) — not a call through bundleFor, which logs a warning
   *  per miss and would fire once per picker row. */
  function catalogEntryIdForName(keywords, name) {
    if (!name) return null;
    const norm = (s) => (s || "").trim().toLowerCase();
    const target = norm(name);
    const fromLibrary = (bundleLibraryCache || []).find(
      (entry) => norm(entry.name) === target && entry.catalogEntryId
    );
    if (fromLibrary) return fromLibrary.catalogEntryId;
    const kind = (keywords || []).map((kw) => CATALOG_LINK_KIND[norm(kw)]).find(Boolean);
    const fieldIds = kind && CATEGORY_FIELD[kind];
    const choice = fieldIds
      ? (findStarterField(...fieldIds)?.choices || []).find((c) => norm(c.text) === target)
      : null;
    return choice?.bundle?.catalogEntryId || null;
  }

  /** Flavor lookup for the character-creation wizard's row-list pickers
   *  (Race/Class/Subclass/Background) — the MECHANICAL source of truth
   *  for "what's selectable" is always bundleLibraryCache (see
   *  rulesetOptionNames above), while a Catalog (see
   *  catalogLibraryEditor.js) supplies the description/portrait.
   *  Resolves through the bundle's explicit `catalogEntryId` link first, so
   *  renaming either side no longer breaks the pairing, and falls back to
   *  matching by name for bundles with no link (subrace option rows, and
   *  anything hand-built before the link existed). Degrades gracefully
   *  (name + placeholder icon) when nothing matches. */
  function catalogEntryInfo(keywords, name, catalogEntryId = null) {
    const info = catalogEntryInfoIn(
      catalogCache,
      keywords,
      name,
      catalogEntryId || catalogEntryIdForName(keywords, name)
    );
    // Portrait priority: an imported catalog's own image first, then
    // the built-in public-domain portrait set (races, classes,
    // backgrounds) — never the placeholder initial when art exists.
    const portrait = info?.imageData || portraitArtFor(name);
    // Hand-written personality/social/playstyle briefs win over catalog
    // flavor text on picker rows; catalogs (with portraits) are untouched.
    const flavor = flavorFor(name);
    if (!flavor) {
      if (!info) return portrait ? { description: "", imageData: portrait } : null;
      return { description: info.description, imageData: portrait };
    }
    return { description: flavor, imageData: portrait };
  }

  /** Categorized bulleted mechanics for a Race/Class/Subclass/
   *  Background picker row (replaces the one-line preview): fixed
   *  order, empty categories omitted. Classes render with Level 1
   *  Class Features + Class Proficiencies sections (no shared
   *  speed/senses/resistances or spell lists; hit lines lead);
   *  backgrounds render Background Proficiencies + Starting Equipment
   *  + Background Feature — see mechanicsBulletsFor. `bundleOverride` renders
   *  a modified bundle through the same pipeline (the live-profile
   *  path strips superseded fixed grants before previewing). */
  function mechanicsListFor(category, name, level, bundleOverride = null) {
    const bundle = bundleOverride ?? bundleFor(category, name, includedRulesetIdsFor());
    if (!bundle) return [];
    const key = (category || "").toLowerCase();
    return sharedMechanicsBulletsFor(bundle, level, {
      abilityIds: ABILITY_IDS,
      abilities: ABILITIES,
      skills: SKILLS,
      resolveLabel: (id) => resolveFieldById(id)?.label,
      backgroundDisplay: key === "background",
      classDisplay: key === "class",
      subclassDisplay: key === "subclass",
      includedPacks: includedRulesetIdsFor(),
    });
  }

  /** The one picker-table component this sheet renders through — a
   *  portrait (or a placeholder initial when none is on file), a
   *  name, and a description per row, with the entire row clickable
   *  and an obvious selected state. Every Race/Class/Subclass/
   *  Background/Feat picker and the Spells Known check-off list
   *  funnels through here (single-select by default, `mode: "multi"`
   *  for check-offs), so one change restyles or re-behaviors every
   *  table together. Per-table traits and section names arrive via
   *  each caller's getMechanicsList/getInfo — see
   *  renderPickerTableInto. `afterRow(name, rowEl)` lets a caller
   *  inject content right after a particular row — the Class step
   *  uses this to expand a nested subclass list under whichever
   *  class is currently selected. */
  function renderPickerRows(container, names, opts = {}) {
    return renderPickerTableInto(container, names, opts);
  }

  /** Section heading plus its empty body wrapper — the repeated
   *  "wizard__section-label + wizard__subsection" pair. Returns the
   *  wrapper for the caller to fill. */
  function sectionInto(container, text) {
    container.append(el("p", { class: "wizard__section-label", text }));
    const wrap = el("div", { class: "wizard__subsection" });
    container.append(wrap);
    return wrap;
  }

  /** Short explanatory paragraph appended to a step. Returns the node
   *  for callers that set its text conditionally. */
  function noteInto(container, text = "", className = "leveling-tab__intro") {
    const note = el("p", { class: className, text });
    container.append(note);
    return note;
  }

  /** Languages granted outside the language pickers: fixed bundle
   *  grants (plus Common, always) and language tags on selected
   *  options of non-language groups (subrace options chief among
   *  them). Returns { fixed: [...], picked: [...] } — the inline
   *  profile sentences grey out the fixed set. Takes the rules state
   *  explicitly so wizard steps share one computation. */
  function grantedLanguageNames(st) {
    const fixed = new Set(["Common"]);
    const picked = new Set();
    const isLanguageField = (id) => /language/i.test(id || "")
      || /language/i.test(resolveFieldById(id)?.label || "");
    creationFixedBundles(st).forEach((bundle) => {
      (bundle?.statModifiers || []).forEach((mod) => {
        if (mod.op === "grantTag" && mod.value && isLanguageField(mod.targetFieldId)) fixed.add(mod.value);
      });
    });
    creationChoiceGroupsFor(st)
      .filter((g) => sharedCategorizeChoiceGroup(g) !== "languages")
      .forEach((group) => {
        const all = groupOptionsOf(group);
        ((character.rules.choices || {})[group.key] || []).forEach((id) => {
          const opt = all.find((o) => o.id === id);
          (opt?.statModifiers || []).forEach((mod) => {
            if (mod.op === "grantTag" && mod.value && isLanguageField(mod.targetFieldId)) picked.add(mod.value);
          });
        });
      });
    return { fixed: [...fixed], picked: [...picked] };
  }

  /** Human-readable label for a statModifier's targetFieldId — special-
   *  cased for the ability-score fields (strScore/dexScore/...) since
   *  "STR" reads far better in a preview than whatever a sheet's field
   *  happens to be labeled, and likewise for the saving-throw/skill
   *  proficiency checkboxes (strSaveProf, athleticsProf, ...) — every
   *  one of those is literally labeled "Prof." on the sheet itself
   *  (it sits next to its own name label instead of repeating it), so
   *  falling back to the field's real label for those would show
   *  "Prof." for every single save/skill grant with no way to tell
   *  which one. Everything else falls back to that field's actual
   *  label (or the raw id, if the sheet doesn't have a field with that
   *  id at all — bundles are written assuming a compatible sheet, same
   *  as applyStatModifiers itself assumes). */
  function statModifierLabel(mod) {
    return sharedStatModifierLabel(mod, {
      abilityIds: ABILITY_IDS,
      abilities: ABILITIES,
      skills: SKILLS,
      resolveLabel: (id) => resolveFieldById(id)?.label,
    });
  }

  function statModifierSummary(mod) {
    return sharedStatModifierSummary(mod, {
      abilityIds: ABILITY_IDS,
      abilities: ABILITIES,
      skills: SKILLS,
      resolveLabel: (id) => resolveFieldById(id)?.label,
    });
  }

  // Which free-text choiceGroup.label a group's checkboxes/radios land
  // under in the creation wizard — best-effort keyword match since
  // groups aren't tagged with a category anywhere upstream (see the
  // bundle library editor). "proficiencies" is the catch-all so an
  // unrecognized label still surfaces somewhere rather than silently
  // vanishing from the wizard.
  function categorizeChoiceGroup(group) {
    return sharedCategorizeChoiceGroup(group);
  }

  const CATEGORY_FIELD = SHARED_CATEGORY_FIELD;

  function bundleFor(category, name, rulesetIdOrIds) {
    // Search every included source in order (primary first), so a pick
    // from any checked ruleset resolves its mechanics. The starter
    // fallback inside bundleForIn is source-agnostic, so it only needs
    // to run once, after the per-source library search comes up empty.
    const ids = (Array.isArray(rulesetIdOrIds) ? rulesetIdOrIds : [rulesetIdOrIds]).filter(Boolean);
    const lookupIds = ids.length > 0 ? ids : includedRulesetIdsFor();
    const norm = (s) => (s || "").trim().toLowerCase();
    const starterLookup = (cat) =>
      CATEGORY_FIELD[cat] ? findStarterField(...CATEGORY_FIELD[cat]) : null;
    if ((category || "").toLowerCase() === "feat" && name) {
      // Feats are baked in (js/data/featBundles.js) rather than living
      // on a starter dropdown choice or per-ruleset library entry —
      // match by name here first. A same-named library entry still
      // wins when explicitly imported.
      for (const id of lookupIds) {
        const fromLibrary = (bundleLibraryCache || []).find((entry) =>
          contentIdMatches(entry.rulesetId, id)
          && norm(entry.category) === "feat" && norm(entry.name) === norm(name));
        if (fromLibrary) return fromLibrary;
      }
      return LINKED_FEAT_BUNDLES.find((entry) => norm(entry.name) === norm(name)) || null;
    }
    for (const id of lookupIds) {
      const fromLibrary = (bundleLibraryCache || []).find((entry) =>
        contentIdMatches(entry.rulesetId, id)
        && norm(entry.category) === norm(category) && norm(entry.name) === norm(name));
      if (fromLibrary) return fromLibrary;
    }
    const bundle = bundleForIn(category, name, lookupIds[0] || null, bundleLibraryCache, starterLookup);
    if (!bundle) {
      console.warn(`[bundleFor] Bundle not found: ${category} "${name}" (rulesetIds: ${lookupIds.join(", ")})`);
    }
    return bundle;
  }

  function creationChoiceGroupsFor(state) {
    // Choice groups resolve against EVERY included source, not just
    // the primary - a Xanathar-tagged bundle's picks surface whenever
    // that source is checked, even with Homebrew primary. Pack-gated
    // groups/options (requiresPack, e.g. Tasha's optional rules) only
    // surface when their pack is included.
    const lookup = (category, name) => bundleFor(category, name, includedRulesetIds(state));
    return lockCommonInLanguageGroups(creationChoiceGroupsForState(state, lookup, includedRulesetIds(state)));
  }

  /** The choice groups ONE row of a picker table offers, whether or not
   *  that row is the current pick.
   *
   *  creationChoiceGroupsForState only walks the state, so it can only ever
   *  describe the selected race/background - which is why an expanded but
   *  unselected row used to fall back to a static preview with no picks at
   *  all. Same function, same lookup, same pack gating; only the name in
   *  the slot is swapped, so for the selected row this returns exactly what
   *  creationChoiceGroupsFor would.
   *
   *  Keys are per-source (`creation:Race:Human:human-languages`), so a pick
   *  made while previewing lands on that row's own key and stays dormant
   *  until the player actually picks that race. */
  function choiceGroupsForRow(category, name, state) {
    const slot = category === "Race" ? "species" : category === "Background" ? "background" : null;
    if (!slot || !name) return [];
    const lookup = (cat, n) => bundleFor(cat, n, includedRulesetIds(state));
    const scoped = { ...state, [slot]: name };
    return lockCommonInLanguageGroups(creationChoiceGroupsForState(scoped, lookup, includedRulesetIds(state)))
      .filter((g) => g.source === name && (category !== "Race" || !g.subrace));
  }

  /** Common is known by default and can't be changed — applied
   *  everywhere language groups surface, creation and post-setup
   *  alike (shared pure helper, tested in smoke-imports).
   *
   *  ALWAYS call this one-argument local wrapper, never lockCommonGroups
   *  directly: the shared helper requires a categorizeFn and calling it
   *  without one throws `categorizeFn is not a function` on the first group.
   *  The import is aliased specifically so the local name wins here; that is
   *  what makes the mistake easy to make by eye, so it is worth saying. */
  function lockCommonInLanguageGroups(groups) {
    return lockCommonGroups(groups, categorizeChoiceGroup);
  }

  /** Synthetic Equipment Proficiencies pickers: one group per
   *  category over the full vocabulary (min 0 — purely optional),
   *  so picks flow through the same choices/apply machinery as every
   *  other group. The "Other" category has no vocabulary on purpose —
   *  the step renders the no-proficiencies message for it instead. */
  function equipmentProficiencyGroups() {
    const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
    const cats = [
      { key: "armor", label: "Armor", fieldId: "armorProf", vocab: ARMOR_PROFICIENCIES },
      { key: "weapons", label: "Weapons", fieldId: "weaponProf", vocab: WEAPON_PROFICIENCIES },
      { key: "tools", label: "Tools", fieldId: "toolProf", vocab: TOOL_PROFICIENCIES },
      { key: "vehicles", label: "Vehicles", fieldId: "vehicleProf", vocab: VEHICLE_PROFICIENCIES },
      { key: "other", label: "Other", fieldId: "otherProf", vocab: [] },
    ];
    return cats.map((cat) => ({
      id: `equipprof-${cat.key}`,
      key: `equipprof:${cat.key}`,
      label: `${cat.label} proficiencies`,
      category: cat.label,
      source: "Equipment Proficiencies",
      minLevel: null,
      minSelections: 0,
      maxSelections: Math.max(cat.vocab.length, 1),
      fieldId: cat.fieldId,
      options: cat.vocab.map((name) => ({
        id: `equipprof-${cat.key}-${slug(name)}`,
        name,
        description: "",
        statModifiers: [{ targetFieldId: cat.fieldId, op: "grantTag", value: name }],
        featureGrants: [],
        resourceGrants: [],
      })),
    }));
  }

  /** Whether one creation choice group is satisfied (owned-aware, via
   *  the shared pure checker). */
  function creationGroupSatisfied(group, state) {
    const owned = ownedSkillIdsFrom(
      creationFixedBundles(state),
      creationChoiceGroupsFor(state),
      group.key
    );
    return groupPicksSatisfied(group, character.rules?.choices?.[group.key], owned);
  }

  /** Fixed feature grants from the staged Race/Class/Subclass/
   *  Background, one section per source, for the automatic-grants
   *  reference step. Picks made on other pages are decisions, not
   *  automatic grants, so only fixed grants appear here. */
  function innateAbilitySections(state) {
    const bundles = creationFixedBundles(state);
    const names = [state.species, state.className, state.subclass, state.background];
    const labels = ["Race", "Class", "Subclass", "Background"];
    const level = Number.isFinite(state.level) ? state.level : Infinity;
    const packs = includedRulesetIds(state);
    return labels
      .map((label, i) => ({
        source: names[i] ? `${label}: ${names[i]}` : label,
        // Only grants at or below the chosen level — anything later
        // belongs to the Leveling tab, not here. Grants without a
        // level gate always show. Pack-gated optional grants (Tasha's)
        // show only when their source book is included; unsourced
        // subclass grants are omitted until sourced (audit 2b), and
        // auto-spell templates resolve to the currently-granted spells.
        features: (((bundles[i] || {}).featureGrants || [])
          .filter((g) => (!g.minLevel || g.minLevel <= level) && (!g.requiresPack || packs.includes(g.requiresPack)) && !g.unsourced)
          .map((g) => {
            if (String(g.description || "").includes("{spells}")) {
              const parts = sharedAutoSpellParts(g, bundles[i], level);
              return { name: parts.name, description: parts.description };
            }
            return { name: g.name, description: g.description };
          })),
      }))
      .filter((section) => section.features.length);
  }

  // spellPicksComplete used to live here. It has no caller left: the
  // creation wizard gates through the inline class-row picks, and the
  // level-up wizard moved to the same shared lines, so both read
  // groupPicksSatisfied rather than this. Removed with them.

  // Same checkbox/radio-group rendering as the Leveling wizard's
  // "Choices" step (see the contentGroups step further down) — both
  // now go through the shared renderChoiceGroups() below, which is
  // also where "can't pick more than you're told to" is enforced.
  function renderCreationChoiceGroups(container, groups, saveRules, state) {
    renderChoiceGroups(container, groups, character.rules.choices, "creation-choice", () => { saveRules(); refreshWizardNav(); },
      (excludeKey) => ownedSkillIdsFrom(creationFixedBundles(state), creationChoiceGroupsFor(state), excludeKey));
  }

  /** The Race/Class/Subclass/Background bundles implied by the Setup
   *  wizard's own staged `state` — used for the "already have this"
   *  check below during Setup, since the real sheet fields (which
   *  everywhere else reads fixed grants from) don't have anything
   *  `.selected` yet at that point in the flow. */
  function creationFixedBundles(state) {
    return creationFixedBundlesFor(state, (category, name) => bundleFor(category, name, includedRulesetIds(state)));
  }

  /** Core of "what skill proficiencies are already accounted for,
   *  other than by the group currently being rendered" — shared by
   *  both contexts that need it (see the two callers below), which
   *  differ only in WHERE a fixed grant and a sibling group's picks
   *  come from: the Setup wizard's own staged state (nothing is
   *  `.selected` on the real sheet fields yet at that point) versus
   *  the real, already-committed sheet post-Setup. `fixedBundles` is
   *  every currently-relevant Race/Class/Subclass/Background bundle
   *  (their statModifiers are always active, regardless of level);
   *  `otherGroups` is every choiceGroups entry that might have an
   *  already-made pick worth counting, in whichever key format this
   *  context actually stores picks under. Excluding the current group
   *  by its own key (not by comparing levels) is what makes "redoing
   *  a past level's own choice" behave normally: from that group's
   *  own point of view its own prior picks were never "someone
   *  else's" to begin with. */
  function ownedSkillIdsFrom(fixedBundles, otherGroups, excludeGroupKey) {
    return ownedSkillIdsFromBundles(fixedBundles, otherGroups, excludeGroupKey, character.rules?.choices || {});
  }

  /** Post-Setup version of the "already have this" check — fixed
   *  grants come from whatever's actually `.selected` on the real
   *  sheet fields now, and sibling groups come from
   *  activeRuleChoiceGroups (the real key format), rather than the
   *  Setup wizard's own staged state/temporary keys (see
   *  renderCreationChoiceGroups above for that version). Used by the
   *  Leveling wizard's Choices step. */
  function alreadyOwnedSkillIds(excludeGroupKey) {
    const fields = flattenGlobalFields();
    const fixedBundles = fields
      .filter((field) => field.fieldType === "dropdown")
      .map((field) => (field.choices || []).find((c) => c.id === field.selected)?.bundle);
    for (const { bundle } of extraSecondaryBundles()) {
      if (bundle) fixedBundles.push(bundle);
    }
    return ownedSkillIdsFrom(fixedBundles, activeRuleChoiceGroups(fields, formulaValues), excludeGroupKey);
  }

  /** Shared renderer for a choiceGroups list's checkboxes/radios —
   *  used by both the Character-setup wizard's Choices step and the
   *  Leveling wizard's Choices step. Enforces maxSelections: once a
   *  group has as many picks as it allows, every other option in that
   *  group is disabled (a radio group never needs this — picking a
   *  new one always replaces the old — so this only applies to
   *  checkbox groups with room for more than one pick). Also shows an
   *  option as already-picked-and-locked (separately from the
   *  maxSelections disabling above) whenever it grants a proficiency
   *  the character already has from elsewhere — same idea as a real
   *  5e "if you'd gain a proficiency you already have, pick something
   *  else instead" rule — so it doesn't count against this group's
   *  own maxSelections at all, leaving the full pick count available
   *  from whatever's left. Re-renders itself after every change so
   *  the disabled state always matches the current count. */
  function renderChoiceGroups(container, groups, choicesStore, namePrefix, onChange, ownedResolver) {
    return renderChoiceGroupsInto(container, groups, choicesStore, namePrefix, onChange, ownedResolver);
  }

  // A Catalog whose name mentions "spell" is treated as the spell
  // list — same best-effort keyword match as catalogEntryInfo, since
  // there's no stored link. Its tabs, per the default Spell List
  // catalog's own shape, ARE the spell levels ("cantrips", "level1"
  // ... "level5") — that's real, structured data (unlike a bundle's
  // free-text choiceGroup labels), so filtering by level here is
  // solid, not a keyword guess.
  function spellListCatalog() {
    return findSpellCatalog(catalogCache);
  }

  function spellsForLevel(levelNum, className) {
    return spellsForLevelIn(spellListCatalog(), levelNum, className);
  }

  function ensureSpellListField() {
    return ensureSpellListFieldIn(
      globalLayout(),
      (id, label) => findStarterField(id, label),
      (opts) => createField(opts),
      null
    );
  }

  /** Which of `field.items` (the sheet's whole known-spells list, which
   *  mixes cantrips and leveled spells together with no level of its
   *  own recorded) are cantrips vs. leveled spells, found by looking
   *  each name back up against the catalog. Needed to enforce the
   *  cantrips/spells limits below without changing what's actually
   *  stored on the sheet. */
  function spellLevelByName(name) {
    return spellLevelByNameIn(spellListCatalog(), name);
  }

  // renderSpellPicker used to live here: the shared picker, wired to this
  // sheet's spell list. Removed when the LEVEL-UP wizard's Spells step moved
  // to the same inline lines the creation wizard uses - so nothing called it.

  /** Names firmly on the Bard list (explicitly Bard-tagged, not merely
   *  unlisted-everywhere entries) across `levels` — shared by the
   *  Magical Secrets picker and its completeness count so both agree
   *  on what counts as a Secret. The picker itself takes the exported
   *  `firmBardSpellNames` from sheetWizard.js; this is the sheet-bound
   *  spelling of the same thing, for the Express fill below. */
  function firmBardSpellNames(levels) {
    const set = new Set();
    (levels || []).forEach((lvl) => spellsForLevel(lvl, "Bard").forEach((s) => {
      if (s?.name && (s.classList || []).some((c) => String(c).toLowerCase() === "bard")) set.add(s.name);
    }));
    return set;
  }

  /** Whether a Bard's Magical Secrets picks are done at `classLevel`
   *  (other classes trivially pass). Counts Spells Known entries
   *  outside the firm Bard list against the unlock total — lenient by
   *  design (a racial spell counts too), so the step completes rather
   *  than traps.
   *
   *  The LEVEL-UP wizard's Spells step, which is where Magical Secrets are
   *  still unpicked. Creation does not need it: Magical Secrets is a real
   *  choice group on the Bard's class bundle, so during creation they are
   *  picked on the class row and gated there. */
  function secretsSatisfiedFor(className, classLevel, subclassName) {
    const unlocked = magicalSecretsUnlocked(className, subclassName, classLevel);
    if (!unlocked) return true;
    const plan = getLevelUpPlan(character.rules?.rulesetId || character.rulesetId, "Bard", Math.max(1, classLevel));
    const levels = sharedAvailableSpellLevels(plan);
    const picked = secretsPickedCount(
      findSetupField("spellsKnown", "Spells Known")?.items || [],
      [...firmBardSpellNames(levels)]
    );
    return secretsCompleteFor(unlocked, picked);
  }

  // renderSecretsSectionInto used to live here, for the commented-out
  // creation Spells step. Removed with it: Magical Secrets during creation is
  // a choice group on the Bard's class bundle, so it renders on the class row
  // like every other pick. Nothing else called it.

  /** Equipment Proficiencies tab: one picker per category over the
   *  full vocabulary, with already-granted tags shown locked. A
   *  category with nothing left to choose renders the
   *  no-proficiencies message instead of an empty picker (listing
   *  anything already granted, so "all of them" never reads as
   *  "none of them"). Always complete — every group is optional. */
  function renderEquipmentProficienciesStepInto(container, state, saveRules) {
    const groups = equipmentProficiencyGroups();
    const siblingGroups = () => [...creationChoiceGroupsFor(state), ...equipmentProficiencyGroups()];
    const who = [state.species, state.className, state.background].filter(Boolean).join(" ") || "your character";
    // All pickable groups render in ONE choice-groups call: that
    // renderer clears its container (and re-renders into it on every
    // pick), so per-group calls would wipe each other and the notes.
    const pickWrap = el("div", { class: "wizard__subsection" });
    container.append(pickWrap);
    const pickableGroups = [];
    groups.forEach((group) => {
      const owned = ownedSkillIdsFrom(creationFixedBundles(state), siblingGroups(), group.key);
      const pickable = group.options.filter((o) => !optionIsOwned(o, owned));
      const granted = group.options.filter((o) => optionIsOwned(o, owned));
      if (!pickable.length) {
        const note = noteInto(container);
        if (granted.length) {
          note.textContent = `${group.category} — Already granted: ${granted.map((o) => o.name).join(", ")}.`;
        } else {
          note.textContent = `As a ${who} you have no proficiencies in ${group.category}.`;
        }
        return;
      }
      pickableGroups.push(group);
    });
    if (pickableGroups.length) renderCreationChoiceGroups(pickWrap, pickableGroups, saveRules, state);
    else pickWrap.remove();
  }

  /** Equipment tab: background package first (fixed, automatic),
   *  then one pick per class equipment row (PHB either/or rows, not
   *  exclusive whole-kit paths), or the gold instead — plus the free-
   *  form weapon/armor/tool proficiency pickers. Picks live on
   *  rules.startingEquipment and apply once at Finish Setup (items to
   *  Inventory, gold to GP). */
  function renderStartingEquipmentStepInto(container, state, saveRules) {
    const bg = BG_STARTING_EQUIPMENT[state.background];
    if (bg && state.background) {
      container.append(el("p", { class: "wizard__section-label", text: `Background equipment — ${state.background} (fixed, added automatically)` }));
      // Linked picks (Acolyte prayer focus, Entertainer/Folk Hero/Guild
      // Artisan tools) resolve into the package here, so the display
      // always shows what Finish Setup will actually grant.
      const bgBundle = bundleFor("Background", state.background, includedRulesetIds(state));
      const linked = linkedEquipmentNames(state.background, bgBundle, character.rules?.choices || {});
      const shown = bgDisplayItems(state.background, linked);
      const link = BG_EQUIPMENT_LINKS[state.background];
      const hint = link && !linked.length ? " (your linked choice fills the (your choice) line once picked)" : "";
      noteInto(container, `${shown.join(", ")}${bg.gp ? `, plus ${bg.gp} gp` : ""}.${hint}`);
    }
    const entry = CLASS_STARTING_EQUIPMENT[state.className];
    if (!entry) {
      noteInto(container, "Pick a class first — Its starting equipment choices will show up here.");
    } else {
      const stored = character.rules.startingEquipment || {};
      const picks = { ...(stored.picks || {}) };
      const goldId = goldOptionIdFor(state.className);
      container.append(el("p", { class: "wizard__section-label", text: `Class equipment — ${state.className}` }));
      (entry.decisions || []).forEach((decision) => {
        const group = el("div", { class: "wizard__subsection" },
          el("p", { class: "wizard__section-label", text: decision.label }));
        decision.options.forEach((opt) => {
          const input = el("input", {
            type: "radio", name: `starting-equipment-${decision.id}`, value: opt.id,
            checked: picks[decision.id] === opt.id,
            onchange: () => {
              character.rules.startingEquipment = {
                picks: { ...(character.rules.startingEquipment?.picks || {}), [decision.id]: opt.id },
              };
              saveRules();
              refreshWizardNav();
            },
          });
          group.append(el("label", { class: "level-guide__choice-option" },
            input,
            el("span", { text: opt.label }),
            el("span", { class: "level-guide__choice-description", text: opt.items.join(" · ") })));
        });
        container.append(group);
      });
      if ((entry.fixed || []).length) {
        noteInto(container, `Also included automatically: ${entry.fixed.join(", ")}.`);
      }
      {
        const input = el("input", {
          type: "radio", name: "starting-equipment-gold", value: goldId,
          checked: stored.gold === true,
          onchange: () => {
            character.rules.startingEquipment = { gold: true };
            saveRules();
            refreshWizardNav();
          },
        });
        container.append(el("label", { class: "level-guide__choice-option" },
          input,
          el("span", { text: `Take ${entry.gold.gp} gp instead` }),
          el("span", { class: "level-guide__choice-description", text: `Fixed average of your starting wealth roll (${entry.gold.formula}). Use this to buy gear yourself.` })));
      }
    }
  }

  /** Applies the Starting Equipment pick once at Finish Setup:
   *  package items to the Inventory list, gold to GP. Guarded so a
   *  second finish can't duplicate everything. Returns
   *  `{ items, gp, missing }` — `missing` names whatever had nowhere
   *  to land (deleted/renamed target fields) so the caller reports it
   *  instead of dropping it silently. Appends without touching
   *  existing entries, so user content is never overwritten. */
  function applyStartingEquipment() {
    const se = character.rules.startingEquipment;
    if (!se || se.applied) return { items: [], gp: 0, missing: [] };
    const itemsField = findSetupField(null, "Items");
    const gpField = findSetupField(null, "GP") || detectMoneyFieldByName();
    // One pick drives both proficiency and equipment: resolve the
    // background's linked tool/prayer choice into the package.
    const bgBundle = bundleFor("Background", character.rules.background, includedRulesetIds(character.rules));
    const linked = linkedEquipmentNames(character.rules.background, bgBundle, character.rules?.choices || {});
    const { items, gp } = resolveStartingEquipmentPick(
      character.rules.className, character.rules.background, se, linked
    );
    const missing = [];
    if (itemsField && itemsField.fieldType === "textlist") {
      items.forEach((item) => appendUniqueTextListItem(itemsField, item));
    } else if (items.length) {
      missing.push({ what: `starting equipment (${items.join(", ")})`, reason: "no Items list on the sheet" });
    }
    if (gp > 0) {
      if (gpField) {
        gpField.value = String((Number.parseInt(gpField.value, 10) || 0) + gp);
      } else {
        missing.push({ what: `${gp} gp starting gold`, reason: "no GP field on the sheet" });
      }
    }
    character.rules.startingEquipment = { ...se, applied: true };
    return { items, gp, missing };
  }

  /** "Pick a ruleset and the sheet just works" — walks every dropdown
   *  field on the sheet and, for each choice, applies whichever
   *  ruleset-tagged library bundle has the same name (case/whitespace
   *  -insensitive), without needing a trip to each field's ⚙ editor.
   *  Safe to call as often as you like (e.g. every time the ruleset
   *  picker changes, or by hand after importing more JSON later) —
   *  applyBundleLibraryToChoice's appliedLibraryIds guard means a
   *  choice that's already had a given library bundle applied is
   *  skipped, not re-stacked. Returns a short status string for the
   *  caller to show. */
  function syncRulesetBundles(rulesetIdOrIds) {
    const ids = (Array.isArray(rulesetIdOrIds) ? rulesetIdOrIds : [rulesetIdOrIds]).filter(Boolean);
    if (ids.length === 0) return null;
    const allFields = flattenGlobalFields();
    const rulesetBundles = bundleLibraryCache.filter((entry) => contentIdMatches(entry.rulesetId, ids));
    let applied = 0;
    rulesetBundleMatches(allFields, rulesetBundles).forEach(({ choice, lib }) => {
      if (applyBundleLibraryToChoice(lib, choice, allFields)) applied++;
    });
    if (applied > 0) {
      mirrorFirstTabLayout();
      saveWithStatus("layout", character.layout);
    }
    return syncResultMessage(applied, rulesetBundles.length > 0);
  }

  /** Whether `level` grants an Ability Score Improvement for this
   *  class — every level tagged "Ability Score Improvement" in the
   *  class's own featureGrants counts (not just the first one), so
   *  this naturally covers a class with more than one ASI level (2014
   *  Fighter at 6/14, Rogue at 10, on top of the usual 4/8/12/16/19)
   *  without hardcoding any particular cadence. */
  function classGrantsAsiAtLevel(className, level) {
    const classField = findStarterField("class", "Class");
    const choice = classField?.choices?.find((c) => c.text === className);
    const grants = choice?.bundle?.featureGrants || [];
    // Every class gets an ASI at 4/8/12/16/19, but some (2014 Fighter:
    // also 6 and 14; Rogue: also 10) get bonus ones too — checking
    // every matching grant's own minLevel (rather than just the first
    // one found, plus a fixed standard-levels set) is what catches
    // those without hardcoding them here.
    return classGrantsAsiIn(grants, level);
  }

  /** New featureGrants this class picks up exactly at `level` — shown
   *  as an informational step in the Leveling wizard. Only exact
   *  minLevel matches (not "at or above"), since anything from an
   *  earlier level was already shown when the character reached it.
   *  Excludes "Ability Score Improvement" — that one gets its own
   *  interactive step (see needsAsi below) instead of sitting here as
   *  an inert duplicate of it. */
  function classFeatureGrantsAtLevel(className, level) {
    const classField = findStarterField("class", "Class");
    const choice = classField?.choices?.find((c) => c.text === className);
    return classFeatureGrantsAtLevelIn(choice?.bundle?.featureGrants || [], level);
  }

  function findStarterField(id, label) {
    return findStarterFieldIn(flattenGlobalFields(), id, label);
  }

  /** Setup/finish field lookup across every tab (not just the global
   *  one): a target field moved to another tab still receives its
   *  picks, spells, and equipment. Id match wins, so a renamed field
   *  still resolves; a deleted one returns null for the caller to
   *  report rather than silently skip. */
  function findSetupField(id, label) {
    return findStarterField(id, label) || findStarterFieldIn(flattenAllFieldsAcrossTabs(), id, label);
  }

  /** The spell names on this character's spell list, case-folded.
   *
   *  The list is a flat `items` array of names on the `spellsKnown` text
   *  field - cantrips and leveled spells mixed, with no level recorded -
   *  so this is the only way to answer "does this character know it". */
  function knownSpellNames() {
    return new Set((findSetupField("spellsKnown", "Spells Known")?.items || [])
      .map((name) => (typeof name === "string" ? name : name?.text || name?.name || ""))
      .filter(Boolean)
      .map((name) => name.toLowerCase()));
  }

  /** Switch to the tab holding the spell list and pulse the entry.
   *
   *  Opened from the spell-entry dialog's "Show on spell list" action, so
   *  the character has to already be on some tab when it's pressed; the
   *  common case is that the spell list is on the same tab they were
   *  reading the trait from, and this is a no-op scroll. The pulse class
   *  is stripped on a timer rather than left on, so a second visit
   *  re-flashes instead of finding a permanently highlighted row. */
  function revealSpellOnSheet(spellName) {
    const target = String(spellName || "").toLowerCase();
    if (!target) return;
    renderPageGrid();
    requestAnimationFrame(() => {
      const items = [...root.querySelectorAll(".textlist-item")];
      const hit = items.find((el) => (el.textContent || "").trim().toLowerCase() === target)
        || items.find((el) => (el.textContent || "").toLowerCase().includes(target));
      if (!hit) {
        showToastIn(root, `${spellName} isn't on the sheet's spell list.`);
        return;
      }
      hit.scrollIntoView({ block: "center" });
      hit.classList.add("is-revealed");
      setTimeout(() => hit.classList.remove("is-revealed"), 1600);
    });
  }

  // Older starter sheets only had slot fields through fifth level. When a
  // compatible standard Spellcasting block is present, extend it in place
  // rather than making a high-level full caster rebuild their sheet.
  function ensureStandardSpellSlotFields(slotChanges) {
    const spellcasting = globalLayout().find((block) => block.name === "Spellcasting");
    if (!spellcasting) return;
    slotChanges.forEach((change) => {
      if (findStarterField(change.fieldId, change.label)) return;
      const match = change.fieldId.match(/^slots([6-9])$/);
      if (!match) return;
      // Plans carry no label — derive it so auto-created fields match
      // the starter sheet's own "6th".."9th" labels.
      const field = createField({ fieldType: "radio", label: change.label || slotLabelFor(change.fieldId), x: Number(match[1]) - 6, y: 2, w: 1, h: 1 });
      field.id = change.fieldId;
      field.options = 0;
      field.selected = null;
      syncOptionWidth(field);
      spellcasting.children.push(field);
      spellcasting.h = Math.max(spellcasting.h, 4);
    });
  }

  function numericFieldValue(field) {
    if (!field) return 0;
    return intFromRichText(field.value || "");
  }

  function appendUniqueTextListItem(field, item) {
    appendUniqueTextListItemTo(field, item);
  }

  /** Shared by the Character-setup wizard's Review step and (unchanged
   *  from before this was split into steps) the old single "Sync Rules
   *  To Sheet" button — pushes the plain-string character.rules answers
   *  onto the sheet's actual dropdown fields, which is what makes their
   *  bundles (stat modifiers, features) actually take effect. See the
   *  characterStore/dropdownAccess comments elsewhere in this file for
   *  why these are two separate representations of "what class is
   *  this" in the first place. */
  async function syncRulesToSheet(resolved) {
    // Customized-sheet audit first: every target field Finish Setup
    // writes (level, scores, slot trackers) is checked across all tabs
    // — renamed fields resolve by id, moved ones by the all-tabs
    // search, and deleted ones land here as issues instead of failing
    // silently. Dropdown picks below are select-or-create (a missing
    // choice is added to its dropdown), so only a wholly missing
    // dropdown is reported for those.
    const issues = [];
    const staticTargets = [
      { id: "level", label: "Level", what: "Level" },
      ...ABILITY_IDS.map((id) => ({ id: `${id}Score`, label: id.toUpperCase(), what: `ability score ${id.toUpperCase()}` })),
      ...(resolved.plan?.slotChanges || []).map((change) => ({ id: change.fieldId, label: change.label, what: `spell-slot tracker "${change.label}"` })),
    ];
    missingSetupTargets(flattenAllFieldsAcrossTabs(), staticTargets).forEach((t) => {
      issues.push(`No ${t.what} field on the sheet — left unset.`);
    });
    const classField = findSetupField("class", "Class");
    const speciesField = findSetupField("species", "Species") || findSetupField("race", "Race");
    const backgroundField = findSetupField("background", "Background");
    const levelField = findSetupField("level", "Level");
    const subclassField = findSetupField("subclass", "Subclass");
    const choose = (target, value, what) => {
      if (!value) return;
      if (!target) {
        issues.push(`${what} pick "${value}" had no dropdown to land in.`);
        return;
      }
      chooseTargetValue(target, value, newId);
    };
    choose(classField, character.rules.className, "Class");
    choose(speciesField, character.rules.species, "Race");
    choose(backgroundField, character.rules.background, "Background");
    choose(subclassField, character.rules.subclass, "Subclass");
    if (levelField) levelField.value = String(character.rules.level);
    ABILITY_IDS.forEach((id) => {
      const target = findSetupField(`${id}Score`, id.toUpperCase());
      if (target) target.value = String(character.rules.abilityScores[id]);
    });
    (resolved.plan?.slotChanges || []).forEach((change) => {
      const target = findSetupField(change.fieldId, change.label);
      if (target) { target.options = change.options; syncOptionWidth(target); }
    });
    // The Setup wizard's own "Choices" steps save picks under a
    // temporary key — creation:<category>:<name>:<groupId> — built
    // from staged state, since the real Class/Race/Background fields
    // don't have a `.selected` choice yet at that point. Every OTHER
    // choiceGroups reader uses the real key once those fields ARE set,
    // which just happened above. Without migrating here, a Setup pick
    // would silently stop being recognized the moment Setup finishes.
    migrateCreationChoiceKeys(
      [["Race", speciesField, character.rules.species], ["Class", classField, character.rules.className],
       ["Subclass", subclassField, character.rules.subclass], ["Background", backgroundField, character.rules.background]],
      character.rules.choices
    );
    // Now that the choices exist and are selected, apply any
    // ruleset-tagged library bundle whose name matches — same matching
    // rule as Bulk Apply, just run automatically for the fields the
    // wizard just touched instead of requiring a trip to each ⚙ editor.
    matchLibraryForChosen(
      [classField, speciesField, backgroundField, subclassField],
      bundleLibraryCache,
      character.rules.rulesetId
    ).forEach(({ choice, lib }) => {
      applyBundleLibraryToChoice(lib, choice, flattenGlobalFields());
    });
    // Granted spells from the chosen race/subclass (e.g. Tiefling
    // Thaumaturgy, Light Domain bonus spells) land in Spells Known now.
    syncGrantedListItems(character.rules.level).forEach(({ fieldId, items }) => {
      issues.push(`${items.length} granted ${fieldId === "spellsKnown" ? "spell(s)" : "item(s)"} (${items.join(", ")}) had no list to land in.`);
    });
    // Starting equipment pick (once — guarded against double-finish).
    applyStartingEquipment().missing.forEach(({ what, reason }) => {
      issues.push(`No ${what} applied: ${reason}.`);
    });
    mirrorFirstTabLayout();
    // This is what actually finishes character creation: once synced,
    // there's nothing left for the Character-setup tab to do, so it's
    // dropped entirely (see normalizeTabs) and Leveling takes over from
    // here — matches Shawn's ask to not keep the wizard tab around
    // afterward.
    character.setupComplete = true;
    // The level this character was MADE at, recorded once and only here.
    // Creation records nothing into character.levelUps, so without this a
    // character created at level 3 would look to the level-jump banner
    // like levels 1-3 had all been skipped. Read from the Level FIELD
    // (raw, unclamped) rather than rules.level, and only if the character
    // doesn't already have one — Finish Setup is guarded against
    // double-finish, and a second pass must not re-stamp the floor over a
    // level-up the player has since applied.
    if (character.createdAtLevel == null) {
      const made = rawLevelFrom(resolveFieldById(character.levelFieldId || "level")?.value);
      character.createdAtLevel = Number.isFinite(made) && made >= 1 ? made : 1;
    }
    normalizeTabs();
    const levelingTab = character.sheetTabs.find((tab) => tab.kind === "leveling");
    if (levelingTab) activeTabId = levelingTab.id;
    // Keep the top-level mirror in sync with the canonical rules copy.
    character.rulesetId = character.rules.rulesetId;
    await store.saveCharacterFields(character.id, { rules: character.rules, rulesetId: character.rules.rulesetId, layout: character.layout, sheetTabs: character.sheetTabs, setupComplete: true, createdAtLevel: character.createdAtLevel, creationStepId: null });
    // Setup always completes (every applicable write above was
    // attempted) — but a customized sheet may be missing targets, and
    // those are reported loudly here, never dropped silently.
    if (issues.length) {
      statusEl.textContent = `Saved with ${issues.length} issue(s) — see notice.`;
      showToastIn(root, `Setup finished, but ${issues.length} thing(s) need attention: ${issues.join(" ")}`, { isError: true });
    } else {
      statusEl.textContent = "Saved";
    }
    renderAll();
    // The toolbar inputs were built once at open (possibly before any
    // name/ruleset was picked) and renderAll doesn't rebuild them —
    // refresh here so they reflect the just-finished wizard choices
    // immediately instead of looking unset until a reload.
    nameInput.value = character.name || "";
    refreshRulesetSelect();
    maybeShowSetupCoach();
  }

  /** One-time orientation shown right after Finish Setup (per browser,
   *  via localStorage) — the three things a first-timer most needs:
   *  Customize Sheet, the Leveling tab, and hover-to-roll. */
  function maybeShowSetupCoach() {
    const key = "grimoire.setupCoachSeen.v1";
    try {
      if (window.localStorage.getItem(key) === "1") return;
    } catch {
      return; // storage blocked — never nag in that case
    }
    const overlay = el("div", { class: "modal-overlay" });
    const box = el("div", { class: "modal-box coach-note", onclick: (e) => e.stopPropagation() });
    const heading = el("h3", { text: "Character ready — Three things to know" });
    const list = el("ul", {},
      ...[
        "Customize Sheet (toolbar) rearranges anything — Drag, resize, restyle. This layout is just the starter.",
        "The Leveling tab walks you through every level-up when the time comes.",
        "Hover any number field to roll it, with Advantage/Disadvantage. Touch screens show the dice always.",
      ].map((text) => el("li", { text })));
    const row = el("div", { class: "modal-actions" });
    const close = () => {
      try { window.localStorage.setItem(key, "1"); } catch { /* private mode — show again next time */ }
      overlay.remove();
    };
    const done = el("button", { type: "button", class: "btn btn--primary", text: "Got it", onclick: close });
    overlay.addEventListener("click", close);
    row.append(done);
    box.append(heading, list, row);
    overlay.append(box);
    document.body.append(overlay);
    done.focus();
  }

  /** Saved source default (ruleset + content books), persisted per
   *  user in this browser so returning users don't re-pick sources on
   *  every new character. Applies only to characters that never chose
   *  sources themselves (per-character picks always win); validated
   *  against the known rulesets on load so stale ids never stick.
   *  localStorage works in both backends, so ?offline=1 keeps it too.
   *  Private-mode storage failures just skip persisting. */
  const SOURCE_DEFAULT_KEY_PREFIX = "grimoire.sourceDefault.v1.";
  function sourceDefaultKey() {
    let uid = null;
    try { uid = store.currentUserId?.() || null; } catch { uid = null; }
    return `${SOURCE_DEFAULT_KEY_PREFIX}${uid || "anon"}`;
  }
  function loadSourceDefault() {
    try {
      const raw = window.localStorage.getItem(sourceDefaultKey());
      if (!raw) return null;
      return sanitizeSourceDefault(JSON.parse(raw), listRulesets(), (id) => listContentPacks(id));
    } catch {
      return null;
    }
  }
  function saveSourceDefault(primary, included) {
    try {
      window.localStorage.setItem(sourceDefaultKey(), JSON.stringify({ primary, included }));
    } catch { /* storage blocked — the default just won't persist */ }
  }

  function renderRulesTab() {
    const state = character.rules = normalizeRulesState(character.rules);
    // Retired combo-option ASI picks map onto the slot groups (both
    // key shapes); unparseable leftovers stay untouched for the
    // Leveling gate to surface. Runs every render but only saves when
    // something actually migrated.
    const legacyAsi = migrateAsiComboPicks(character.rules.choices || {}, LEGACY_ASI_COMBOS);
    if (legacyAsi.migrated > 0) {
      character.rules.choices = legacyAsi.choices;
      saveWithStatus("rules", character.rules);
    }
    // First-visit source default: a returning user's last-picked
    // sources apply silently to characters that never chose their
    // own, before the single-source auto-select below runs. Anything
    // already picked on this character is left strictly alone.
    if (!state.rulesetId) {
      const fallback = loadSourceDefault();
      if (fallback) {
        state.rulesetId = fallback.primary;
        state.rulesetIds = [...fallback.included];
        character.rulesetId = fallback.primary;
        saveWithStatus("rules", character.rules);
      }
    }
    const resolved = applyLiveSubclassOverrideToResolved(
      resolveRulesState(state),
      state,
      liveSubclassData(state.className)
    );
    const saveRules = debounce(() => saveWithStatus("rules", character.rules), 400);
    // One ruleset means no choice to make — select it silently so
    // every downstream picker works on first paint.
    if (!state.rulesetId) {
      const available = listRulesets();
      if (available.length === 1) {
        state.rulesetId = available[0].id;
        character.rulesetId = available[0].id;
        saveRules();
      }
    }
    // First-visit defaults (persisted once, explicit afterward):
    // Point Buy for fresh ability scores, Fixed Average for HP.
    // Existing characters keep whatever they already use — a custom
    // spread never gets reinterpreted as point-buy.
    if (!state.abilityScoreMethod) {
      const fresh = ABILITY_IDS.every((id) => Number(state.abilityScores?.[id] ?? 10) === 10);
      state.abilityScoreMethod = fresh ? "pointbuy" : "manual";
      saveRules();
    }
    if (!state.hpMethod) {
      state.hpMethod = "average";
      saveRules();
    }
    const field = (container, label, control) => {
      appendFieldGroup(container, label, control);
    };
    const update = (key, value) => {
      character.rules[key] = value;
      character.rules = normalizeRulesState(character.rules);
      cleanStaleSubclass(character.rules, (className) => liveSubclassData(className));
      if (key === "species") cleanStaleLineageFeat();
      // Spells Known is a single global list, so switching class (or
      // subclass) has to take the old class's spell picks back out of it -
      // otherwise they stay in the spellbook as phantom picks the new class
      // never made. See dropOrphanedSpellPicks.
      if (key === "className" || key === "subclass") dropOrphanedSpellPicks();
      saveRules();
      renderPageGrid();
    };

    /** A race-granted feat (today: Custom Lineage) lives in
     *  rules.feats with source "lineage" — switching species drops it
     *  so a stale feat can't outlive the race that granted it (the new
     *  race's own feat, if any, gets picked fresh on Identity). */
    function cleanStaleLineageFeat() {
      const feats = character.rules.feats || [];
      if (!feats.some((f) => f.source === "lineage")) return;
      character.rules.feats = feats.filter((f) => f.source !== "lineage");
    }

    /** Revalidates staged creation picks against the currently included
     *  sources (call after setIncludedRulesetIds): keeps every pick
     *  still offered, clears orphaned Race/Class/Subclass/Background
     *  picks plus their choice-group picks, and drops a race-granted
     *  feat with its race. Returns `{ removed, pruned }` for the
     *  caller's notice — invalid selections never linger until Finish
     *  Setup. Adding a source calls nothing here, so adds never clear. */
    function revalidatePicksAfterSourceChange() {
      const remaining = includedRulesetIds(state);
      const validNames = {
        Race: rulesetOptionNamesIn(bundleLibraryCache, remaining, "Race", wizardFieldOptionNames("race", "Race")),
        Class: rulesetOptionNamesIn(bundleLibraryCache, remaining, "Class", wizardFieldOptionNames("class", "Class")),
        Subclass: liveSubclassData(state.className).subclasses,
        Background: rulesetOptionNamesIn(bundleLibraryCache, remaining, "Background", wizardFieldOptionNames("background", "Background")),
      };
      const lineageName = (character.rules.feats || []).find((f) => f.source === "lineage")?.name || null;
      const { picks, removed } = revalidateStagedPicks(
        { species: state.species, className: state.className, subclass: state.subclass, background: state.background },
        validNames
      );
      const raceDropped = Boolean(state.species) && !picks.species;
      state.species = picks.species;
      state.className = picks.className;
      state.subclass = picks.subclass;
      state.background = picks.background;
      if (raceDropped) {
        cleanStaleLineageFeat();
        if (lineageName) removed.push({ category: "Feat", name: lineageName });
      }
      // Prunes the orphaned choice keys AND takes the spells they granted
      // back out of Spells Known (see dropOrphanedSpellPicks).
      return { removed, ...dropOrphanedSpellPicks() };
    }

    function wizardFieldOptionNames(fieldId, fieldLabel) {
      return wizardFieldOptionNamesIn((id, label) => findStarterField(id, label), fieldId, fieldLabel);
    }

    const ABILITY_DESCRIPTIONS = SHARED_ABILITY_DESCRIPTIONS;
    const HP_METHOD_OPTIONS = SHARED_HP_METHOD_OPTIONS;
    const POINT_BUY_MIN = SHARED_POINT_BUY_MIN;
    const POINT_BUY_MAX = SHARED_POINT_BUY_MAX;
    const POINT_BUY_BUDGET = SHARED_POINT_BUY_BUDGET;
    // Standard point-buy cost (1 point per point of score) through 13,
    // then 2 points per point from 14 on, up through the standard
    // 15 cap.
    function pointBuyCost(score) {
      return sharedPointBuyCost(score, POINT_BUY_MIN);
    }
    // Highest score `id` could be raised to without pushing total
    // spend over budget, given what's already committed to every
    // other ability score — used to stop an increase right at the
    // point the budget runs out, rather than letting it go over and
    // just flagging it after the fact.
    function maxAffordablePointBuyScore(id) {
      return maxAffordableScore(id, character.rules.abilityScores, {
        budget: POINT_BUY_BUDGET,
        min: POINT_BUY_MIN,
        max: POINT_BUY_MAX,
        abilityIds: ABILITY_IDS,
      });
    }
    const rollAbilityScore = () => sharedRollAbilityScore();

    // Choices offered by whichever Race/Class/Subclass/Background are
    // currently picked, rendered as "Your choices" sections under the
    // pick that granted them (see renderYourChoicesSections) — choices
    // appear where they originate, not on separate later pages. Feat
    // groups render through the shared feats picker dialog (see
    // choiceDialogKindFor/inlineChoiceBullets), same as proficiencies.
    // See creationChoiceGroupsFor and categorizeChoiceGroup above.
    const creationGroups = creationChoiceGroupsFor(state);
    // Inline spell picks, in the same shape as every other pick (see
    // inlineSpellPickGroups). Appended here so the class row's existing
    // "groups with a dialog kind render inline" filter picks them up with
    // no change to the row renderer: a Cantrips bullet and one per level,
    // each a link into the shared spell dialog.
    const creationSpellGroups = inlineSpellPickGroups();
    const creationGroupsWithSpells = [...creationGroups, ...creationSpellGroups];
    // Per-step sections: a pick's own groups (subrace groups render
    // nested under their race, never standalone). Read from the list WITH
    // spells so a caster's class row is gated on its spell picks the same as
    // on its proficiencies.
    const pickGroupsFor = (...sources) => creationGroupsWithSpells.filter((g) =>
      !g.subrace && sources.includes(g.source));
    // Full per-pick lists — gating always counts everything, wherever
    // each group renders.
    const raceChoiceGroups = pickGroupsFor(state.species);
    const classChoiceGroups = pickGroupsFor(state.className, state.subclass);
    const backgroundChoiceGroups = pickGroupsFor(state.background);
    // Groups rendered inline in the picker tables (not in the generic
    // "Your choices" sections): language groups and ASI slot groups
    // nested under their race/background rows. Class tables render no
    // inline rows (no class grants languages or slot ASIs), so class
    // language groups — should any ever appear — keep the generic
    // rendering rather than vanishing.
    const isInlineLangGroup = (g) => categorizeChoiceGroup(g) === "languages";
    // Feature-pick dropdowns yield to the shared dialog: a feat group
    // that happens to match the single-pick shape still opens the
    // feats picker link (see inlineChoiceBullets), never a dropdown.
    const isInlineFeatDropdown = (g) => isFeaturePickGroup(g) && !choiceDialogKindFor(g);
    const raceInlineLang = raceChoiceGroups.filter(isInlineLangGroup);
    const raceInlineAsi = raceChoiceGroups.filter(isAsiSlotGroup);
    const raceInlineFeat = raceChoiceGroups.filter(isInlineFeatDropdown);
    // Whatever is left over renders in the row itself through the
    // shared choice dialog (see inlineChoiceBullets) — the bottom
    // "Your choices" sections below are now permanently empty, so
    // their render calls are gone and only the lists remain for
    // gating/hints, which count picks wherever they render.
    const raceSectionGroups = raceChoiceGroups.filter((g) => !isInlineLangGroup(g) && !isAsiSlotGroup(g) && !isFeaturePickGroup(g) && !choiceDialogKindFor(g));
    const bgInlineLang = backgroundChoiceGroups.filter(isInlineLangGroup);
    const bgInlineTool = backgroundChoiceGroups.filter((g) => g.fieldId === "toolProf");
    const bgInlineFeat = backgroundChoiceGroups.filter(isInlineFeatDropdown);
    const bgSectionGroups = backgroundChoiceGroups.filter((g) => !isInlineLangGroup(g) && g.fieldId !== "toolProf" && !isFeaturePickGroup(g) && !choiceDialogKindFor(g));
    // The race bundle's pick-1 subrace group (Elf/Dwarf) renders nested
    // under its race — the same pattern as subclasses under their
    // class — never as a standalone choice page, so it stays out of
    // the buckets above while remaining a first-class pick everywhere
    // else (review lines, owned sets, compute).
    function subraceGroupFor(raceName) {
      return creationGroups.find((g) => g.subrace && g.source === raceName) || null;
    }

    /** Whether the Race pick is finished, not merely made. A thin wrapper
     *  over the shared pure predicate, so the two call sites below read the
     *  same answer as the unit tests do. */
    function raceChoiceSettled(raceName = state.species) {
      return sharedRacePickSatisfied({
        raceName,
        subraceGroup: raceName ? subraceGroupFor(raceName) : null,
        choices: state.choices,
      });
    }


  /** Whether every group in `groups` is satisfied (owned-aware, via
   *  the shared section checker) — per-section gating for a merged
   *  wizard step: Next blocks until each section is complete. */
  function choicesComplete(groups) {
    return sectionsComplete(
      sectionsForChoiceGroups(groups),
      character.rules.choices || {},
      (key) => ownedSkillIdsFrom(creationFixedBundles(state), creationChoiceGroupsFor(state), key)
    );
  }

  /** Names of the still-open choice sections (in order), for the
   *  "still to choose" hint on a merged step. Empty when complete. */
  function openChoiceSections(groups) {
    return incompleteSectionNames(
      sectionsForChoiceGroups(groups),
      character.rules.choices || {},
      (key) => ownedSkillIdsFrom(creationFixedBundles(state), creationChoiceGroupsFor(state), key)
    );
  }

  /** "Your choices" sections for a merged wizard step: one collapsible
   *  section per originating pick (race, class, …), each rendering
   *  that pick's own choice groups directly under it. Renders nothing
   *  at all when there are no groups, so steps with nothing to decide
   *  never show an empty section. Collapse state survives re-renders
   *  (module-level memory keyed `${stepId}:${source}`); Expand All /
   *  Collapse All covers the step's sections together.
   *  `hintGroups` (optional): the FULL group list including groups
   *  rendered inline in picker tables — section status and the
   *  "still to choose" hint count those too, so a step blocked only
   *  by an inline pick still says what is missing. */
  function renderYourChoicesSections(container, stepId, groups, saveRules, hintGroups = null) {
    const sections = sectionsForChoiceGroups(groups);
    const statusGroups = hintGroups ?? groups;
    if (!sections.length) return;
    container.append(el("p", { class: "wizard__section-label", text: "Your choices" }));
    const block = el("div", { class: "wizard__subsection wizard__choice-sections" });
    const setAll = (collapsed) => {
      sections.forEach(({ source }) => {
        const key = `${stepId}:${source}`;
        setChoiceSectionCollapsed(key, collapsed);
        const body = block.querySelector(`[data-section-body="${CSS.escape(source)}"]`);
        if (body) body.hidden = collapsed;
        const btn = block.querySelector(`[data-section-toggle="${CSS.escape(source)}"]`);
        if (btn) btn.setAttribute("aria-expanded", String(!collapsed));
      });
    };
    container.append(el("div", { class: "choice-row-list__collapse-controls" },
      el("button", { type: "button", class: "btn", text: "Expand All", onclick: () => setAll(false) }),
      el("button", { type: "button", class: "btn", text: "Collapse All", onclick: () => setAll(true) })));
    container.append(block);
    sections.forEach((section) => {
      const key = `${stepId}:${section.source}`;
      // Inline-table groups share their source: a section is only
      // complete when its rendered groups AND its inline groups are.
      const inline = statusGroups.filter((g) => g.source === section.source && !groups.includes(g));
      const done = [...section.groups, ...inline].every((g) => creationGroupSatisfied(g, state));
      const toggle = el("button", {
        type: "button",
        class: "btn wizard__choice-section-toggle",
        text: `${section.source} — ${done ? "complete" : "needs picks"}`,
        "aria-expanded": String(!isChoiceSectionCollapsed(key)),
        "data-section-toggle": section.source,
        onclick: () => {
          const next = !body.hidden;
          setChoiceSectionCollapsed(key, next);
          body.hidden = next;
          toggle.setAttribute("aria-expanded", String(!next));
        },
      });
      const body = el("div", { class: "wizard__choice-section-body", "data-section-body": section.source });
      body.hidden = isChoiceSectionCollapsed(key);
      renderCreationChoiceGroups(body, section.groups, saveRules, state);
      block.append(el("div", { class: "wizard__choice-section" }, toggle, body));
    });
    const open = openChoiceSections(statusGroups);
    if (open.length) {
      noteInto(container, `Still to choose: ${open.join(" · ")}.`);
    }
  }

  /** Whether a statModifier target holds languages (field id or the
   *  sheet field's label) — shared by the fixed-language list and the
   *  live-profile stripping below. */
  function isLangFieldId(id) {
    return /language/i.test(id || "") || /language/i.test(resolveFieldById(id)?.label || "");
  }

  /** Fixed (non-choice) languages on one bundle — Common plus its
   *  grantTag language mods — for the inline bullet's known list. */
  function fixedLangsFor(bundle) {
    const names = ["Common"];
    for (const mod of bundle?.statModifiers || []) {
      if (mod.op === "grantTag" && mod.value && isLangFieldId(mod.targetFieldId)
        && !names.some((n) => n.toLowerCase() === String(mod.value).toLowerCase())) names.push(mod.value);
    }
    return names;
  }

  /** Refocuses an inline slot select after the page rebuild a pick
   *  triggers, so keyboard flow survives. Cosmetic-only: never throws. */
  /** Put keyboard focus back on an inline dropdown after the re-render that
   *  a pick triggers, so a keyboard user is not dropped at the top of the
   *  page after every choice.
   *
   *  Deliberately NOT done for a tap. Focus was the reason the dropdown used
   *  to close and immediately reopen: `change` re-rendered the page, the old
   *  <select> was destroyed, and focusing its replacement reopened the native
   *  picker on a touch device. So the player picked an option, saw the list
   *  close, and saw it open again - and because the value was already set,
   *  a second pick of the SAME option fires no `change` at all, which is why
   *  it then stayed closed and only reopened on a different choice.
   *
   *  Focus survives a tap by itself: a touch never had it to begin with, so
   *  there is nothing to restore. Restoring it for a keyboard is the whole
   *  job here, and only for a keyboard.
   *
   *  `keyboard` comes from the bullet, which is the only place that knows how
   *  the control was operated - see renderLiveBulletItem's `keyboardDriven`. */
  function refocusInlineSlot(slotKey, { keyboard = false } = {}) {
    if (!keyboard) return;
    try {
      const node = pageGrid.querySelector(`[data-inline-slot="${String(slotKey).replace(/"/g, "")}"]`);
      if (node) node.focus({ preventScroll: true });
    } catch { /* keep the pick even if focus fails */ }
  }

  /** Live Ability Score Increase bullet: one "+2 to" dropdown and one
   *  "+1 to" dropdown, each listing all six abilities.
   *
   *  This replaced a two-step dialog that asked you to pick a pattern
   *  ("+2/+1 or +1/+1/+1") and then step again for the abilities. Two
   *  dropdowns show the six stats up front, which is what the sheet's
   *  other picks (languages, variable traits) already look like.
   *
   *  The stored shape is unchanged from the dialog's
   *  ({pattern, abilities, statModifiers}), so computed bonuses, review
   *  lines, and the live ability bullets all keep working - only the
   *  input changed. The +1 dropdown greys out whatever the +2 one holds,
   *  since a single ASI can't raise the same score twice. */
  function liveAbilityAsiBullet(asiGroups, saveRules) {
    if (!asiGroups.length) return null;
    const store = character.rules.choices || {};
    const group = asiGroups[0];
    const current = flexibleAsiSelection((store[group.key] || [])[0]);
    const slotFor = (index, weight) => ({
      key: `${group.key}#${index}`,
      value: index === 0 ? current.plus2 : current.plus1,
      placeholder: "Choose…",
      // The amount sits in the sentence, not the placeholder. A placeholder
      // is what shows while the control is EMPTY, so "+2 to…" was replaced
      // by "Strength" the moment the player chose, and the line was left
      // reading "+2 to… " with a dropdown whose label said nothing about
      // which of the two slots was the +2. The number is part of what is
      // being chosen - it is the difference between the two dropdowns - so it
      // has to survive the choice.
      prefix: `+${weight} to `,
      options: ASI_ABILITY_CHOICES.map((a) => {
        const taken = index === 0 ? current.plus1 : current.plus2;
        return {
          value: a.id,
          label: a.label,
          disabled: taken === a.id,
          title: taken === a.id ? "Already in the other dropdown" : null,
        };
      }),
    });
    return {
      live: true,
      topic: group.label || "Ability Score Increase",
      lead: [],
      slots: [slotFor(0, 2), slotFor(1, 1)],
      onPick: (slotKey, value, info) => {
        const index = slotKey.endsWith("#0") ? 0 : 1;
        const next = { plus2: current.plus2, plus1: current.plus1 };
        if (index === 0) next.plus2 = value || "";
        else next.plus1 = value || "";
        const choice = buildFlexibleAsiChoice(next.plus2, next.plus1);
        character.rules.choices = {
          ...(character.rules?.choices || {}),
          [group.key]: choice ? [choice] : [],
        };
        saveRules();
        renderPageGrid();
        refocusInlineSlot(slotKey, info);
      },
    };
  }

  /** Live Languages bullet model ("Languages" topic with locked knowns
   *  + one dropdown per pick slot), or null when there are no language
   *  groups. Each dropdown lists its own group's options; locked knowns
   *  and sibling slots' picks grey out. Picks write back onto the same
   *  per-group choice keys every compute path reads, so gating, review,
   *  and apply work unchanged. */
  function liveLanguageBullet(langGroups, fixedBundle, saveRules) {
    if (!langGroups.length) return null;
    const store = character.rules.choices || {};
    const slotModels = languageSlotsFor(langGroups, store);
    const lockedNames = new Set(grantedLanguageNames(state).fixed.map((n) => String(n).toLowerCase()));
    const lead = fixedLangsFor(fixedBundle).map((name) => ({ text: name, title: name === "Common" ? "Known by everyone — free, never uses picks" : "Granted — already known" }));
    const allValues = slotModels.flatMap((m) => m.values).filter(Boolean).map((n) => n.toLowerCase());
    return {
      live: true,
      topic: SHARED_LANGUAGE_BULLET_LABEL,
      lead,
      slots: slotModels.flatMap((m) => {
        const group = langGroups.find((g) => g.key === m.groupKey);
        const offered = groupOptionsOf(group).filter((o) => o.name);
        return m.values.map((value, i) => {
          const own = (value || "").toLowerCase();
          const siblings = new Set(allValues.filter((n) => n !== own));
          const toOption = (o) => {
            const lower = o.name.toLowerCase();
            const locked = lockedNames.has(lower);
            const taken = !locked && siblings.has(lower);
            return {
              value: o.name,
              label: o.name,
              disabled: locked || taken,
              title: locked ? "Already known — pick something else" : taken ? "Picked in the other dropdown" : null,
            };
          };
          // Widespread vs Rare, as <optgroup>s. The native picker shows the
          // label and refuses to let it be picked, which is the behaviour
          // asked for; and a <select> cannot hold arbitrary elements, so this
          // is the one place a heading can exist at all.
          //
          // Grouped by name against the offered list, never rebuilt from a
          // second copy of the vocabulary: a language the group offers but
          // the split does not know about falls through to the ungrouped
          // tail rather than vanishing from the dropdown.
          const byName = new Map(offered.map((o) => [o.name, toOption(o)]));
          const optgroups = languageSections()
            .map((s) => ({
              label: s.label,
              options: s.languages.map((n) => byName.get(n)).filter(Boolean),
            }))
            .filter((g) => g.options.length);
          return {
            key: `${m.groupKey}#${i}`,
            value: value || "",
            placeholder: "Choose…",
            optgroups,
            options: offered.map(toOption),
          };
        });
      }),
      onPick: (slotKey, name, info) => {
        const hash = slotKey.lastIndexOf("#");
        const patch = assignLanguageSlot(langGroups, slotKey.slice(0, hash), Number(slotKey.slice(hash + 1)), name || null, character.rules.choices || {});
        character.rules.choices = { ...(character.rules.choices || {}), ...patch };
        saveRules();
        renderPageGrid();
        refocusInlineSlot(slotKey, info);
      },
    };
  }

  /** Live Tool Proficiencies bullet model ("Tool Proficiencies: [▾], [▾]"):
   *  one dropdown per tool slot group, with a superscript ? button
   *  that opens a dialog with all tools grouped by category. */
  function liveToolBullet(toolGroups, fixedBundle, saveRules) {
    if (!toolGroups.length) return null;
    const store = character.rules.choices || {};
    const slotModels = languageSlotsFor(toolGroups, store);
    const owned = ownedSkillIdsFrom(creationFixedBundles(state), creationChoiceGroupsFor(state), toolGroups[0]?.key);
    const ownedNames = new Set(owned);
    const lead = TOOL_PROFICIENCIES.filter((t) => ownedNames.has(t.toLowerCase())).map((name) => ({ text: name, title: "Granted — already known" }));
    const allValues = slotModels.flatMap((m) => m.values).filter(Boolean).map((n) => n.toLowerCase());
    const openDialog = (slotKey) => {
      const overlay = el("div", { class: "modal-overlay" });
      const box = el("div", { class: "modal-box tool-picker-dialog", onclick: (e) => e.stopPropagation() });
      const heading = el("h3", { text: "Choose Tool Proficiencies" });
      // Which tools to offer. The group's OWN options are authoritative
      // when it has any — an Entertainer group carries its ten musical
      // instruments, and a Folk Hero its seventeen artisan's tools, so
      // there is no reason to re-derive that from prose. Groups that ship
      // no options (a "choose 2 tool proficiencies" with no enumerated
      // list) fall back to the label, which decides whether the wording
      // means one kind of tool or any of them.
      //
      // Before this, the dialog listed the whole TOOL_PROFICIENCIES
      // vocabulary for every slot, so a background reading "one artisan's
      // tool of your choice" also offered a lute.
      const groups = toolGroups.flatMap((g) => {
        const named = (g.options || []).map((o) => o.name).filter(Boolean);
        if (named.length) return [{ label: g.label, options: named }];
        return toolGroupsForLabel(g.label);
      });
      const checked = new Set(store[toolGroups[0].key] || []);
      groups.forEach((g) => {
        const optgroup = el("div", { class: "tool-picker-group" },
          el("h4", { text: g.label }),
          ...g.options.map((tool) => {
            const id = `tool-${tool.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
            const isChecked = checked.has(tool.toLowerCase());
            const label = el("label", { class: "tool-picker-option" },
              el("input", { type: "checkbox", checked: isChecked, value: tool, onchange: (e) => {
                const newChecked = new Set(checked);
                if (e.target.checked) newChecked.add(tool.toLowerCase());
                else newChecked.delete(tool.toLowerCase());
                const max = toolGroups[0]?.maxSelections || toolGroups[0]?.options?.length || 2;
                if (newChecked.size > max) {
                  e.target.checked = !e.target.checked;
                  return;
                }
                checked.clear();
                newChecked.forEach((v) => checked.add(v));
              }}),
              el("span", { text: tool }));
            return label;
          }));
        box.append(optgroup);
      });
      const actions = el("div", { class: "modal-actions" });
      const accept = el("button", { type: "button", class: "btn btn--primary", text: "Accept", onclick: () => {
        const picks = [...checked].sort();
        const patch = assignLanguageSlot(toolGroups, toolGroups[0].key, 0, picks[0] || null, store);
        character.rules.choices = { ...(character.rules.choices || {}), ...patch };
        saveRules();
        renderPageGrid();
        overlay.remove();
      }});
      const cancel = el("button", { type: "button", class: "btn", text: "Cancel", onclick: () => overlay.remove() });
      actions.append(cancel, accept);
      box.append(heading, actions);
      overlay.append(box);
      document.body.append(overlay);
    };
    return {
      live: true,
      topic: "Tool Proficiencies",
      lead,
      slots: slotModels.flatMap((m) => {
        const group = toolGroups.find((g) => g.key === m.groupKey);
        const offered = groupOptionsOf(group).filter((o) => o.name);
        return m.values.map((value, i) => {
          const own = (value || "").toLowerCase();
          const siblings = new Set(allValues.filter((n) => n !== own));
          return {
            key: `${m.groupKey}#${i}`,
            value: value || "",
            placeholder: "Choose…",
            options: offered.map((o) => {
              const lower = o.name.toLowerCase();
              const locked = ownedNames.has(lower);
              const taken = !locked && siblings.has(lower);
              return {
                value: o.name,
                label: o.name,
                disabled: locked || taken,
                title: locked ? "Already granted — pick something else" : taken ? "Picked in the other dropdown" : null,
              };
            }),
            dialogOpener: () => openDialog(`${m.groupKey}#${i}`),
          };
        });
      }),
      onPick: (slotKey, name, info) => {
        const hash = slotKey.lastIndexOf("#");
        const patch = assignLanguageSlot(toolGroups, slotKey.slice(0, hash), Number(slotKey.slice(hash + 1)), name || null, character.rules.choices || {});
        character.rules.choices = { ...(character.rules.choices || {}), ...patch };
        saveRules();
        renderPageGrid();
        refocusInlineSlot(slotKey, info);
      },
    };
  }

  /** Live Ability Scores bullet model: one dropdown per +1/+2 slot group.
   *  Duplicates stack across slots because each slot is its own group.
   *
   *  The "+2" / "+1" lives in the sentence in front of each dropdown, not in
   *  the dropdown's placeholder - a placeholder is replaced by the chosen
   *  value, so the number used to vanish the moment the player picked, and
   *  the line became "Strength (14, +2), Dexterity (12, +1)" with nothing
   *  saying which was the +2. Two or more +1s still read as one
   *  "+1 to each of" rather than repeating the number per slot. */
  function liveAsiBullet(asiGroups, saveRules) {
    if (!asiGroups.length) return null;
    const models = asiSlotsFor(asiGroups, character.rules.choices || {});
    const allPlusOne = models.every((m) => m.value === 1);
    const collective = models.length > 1 && allPlusOne ? "+1 to each of" : null;
    return {
      live: true,
      topic: null,
      collective,
      slots: models.map((m) => ({
        key: m.groupKey,
        value: m.pickedAbility || "",
        placeholder: "Choose…",
        // With no shared "+1 to each of" to carry it, each slot names its
        // own amount. A single +2 slot reads "+2 [select]" the same way.
        prefix: collective ? null : `+${m.value} `,
        options: m.options.map((o) => ({ value: o.ability, label: o.label, title: sharedAbilityTooltip(o.ability) ?? null })),
      })),
      onPick: (slotKey, abilityId, info) => {
        const patch = assignAsiSlot(asiGroups, slotKey, abilityId || null);
        character.rules.choices = { ...(character.rules.choices || {}), ...patch };
        saveRules();
        renderPageGrid();
        refocusInlineSlot(slotKey, info);
      },
    };
  }

  /** Live feature-pick bullet models ("Variable Trait: [▾]"): one
   *  dropdown per single-pick feature group, offering option names
   *  (tooltips carry the option's own text). Stored as the option id,
   *  exactly like the generic radio UI would. */
  function liveFeatureBullets(featGroups, saveRules) {
    return (featGroups || []).map((group) => {
      const stored = character.rules.choices?.[group.key] || [];
      const picked = (group.options || []).find((o) => stored.includes(o.id)) || null;
      return {
        live: true,
        topic: group.label || "Choose",
        lead: [],
        slots: [{
          key: group.key,
          value: picked?.id || "",
          placeholder: "Choose…",
          options: (group.options || []).filter((o) => o.name).map((o) => ({
            value: o.id,
            label: o.name,
            title: o.featureGrants?.[0]?.description ? sharedBriefDescription(o.featureGrants[0].description, 120) : null,
          })),
        }],
        onPick: (slotKey, optionId, info) => {
          const patch = assignFeatureSlot(featGroups, slotKey, optionId || null);
          character.rules.choices = { ...(character.rules.choices || {}), ...patch };
          saveRules();
          renderPageGrid();
          refocusInlineSlot(slotKey, info);
        },
      };
    });
  }

  /** Live racial-feat bullet ("Feat — Alert", where the summary itself
   *  links the feats picker dialog): for a staged race granting a feat
   *  of its own (today: Custom Lineage's "Feat" trait). The dialog is
   *  the same shared table proficiencies use — single-pick, every feat
   *  with its description — and writes the same rules.feats lineage
   *  entry the Identity "Racial feat" rows use, so both pickers stay
   *  in sync. Null when the staged race grants no feat. */
  function liveLineageFeatBullet(saveRules) {
    if (!lineageFeatOffered()) return null;
    const pick = lineageFeatPick();
    const feats = LINKED_FEAT_BUNDLES.filter((b) => b?.name).map((b) => ({
      id: b.name,
      name: b.name,
      description: b.featureGrants?.[0]?.description
        ? sharedBriefDescription(b.featureGrants[0].description, 160)
        : null,
    })).sort((a, b) => a.name.localeCompare(b.name));
    return {
      live: true,
      topic: "Feat",
      lead: [{ text: pick?.name || "Choose a feat" }],
      dialogOpener: () => openChoiceDialog({
        title: `Racial feat — ${state.species}`,
        multi: false,
        maxSelections: 1,
        wide: true,
        options: feats,
        lockedIds: [],
        initialSelected: pick?.name ? [pick.name] : [],
        onAccept: (ids) => {
          character.rules.feats = [
            ...(character.rules.feats || []).filter((f) => f.source !== "lineage"),
            ...(ids[0] ? [{ name: ids[0], level: state.level, source: "lineage" }] : []),
          ];
          saveRules();
          renderPageGrid();
        },
      }),
    };
  }

  /** Description for one dialog option: the bundle's own text wins,
   *  else the proficiency reference (skills and expertise share skill
   *  names; tools have their own map; feats resolve from their own
   *  grant text or the baked feat catalog). */
  function describeChoiceOption(kind, option) {
    if (option.description) return option.description;
    if (kind === "skills" || kind === "expertise") {
      return SKILLS.find((s) => s.label === option.name)?.description || null;
    }
    if (kind === "tools") return TOOL_DESCRIPTIONS[option.name] || null;
    if (kind === "feats" || /\bfeat\b/i.test(option.name || "")) {
      const grantText = option.featureGrants?.[0]?.description;
      if (grantText) return sharedBriefDescription(grantText, 160);
      const norm = (s) => (s || "").trim().toLowerCase();
      const bundle = LINKED_FEAT_BUNDLES.find((entry) => norm(entry.name) === norm(option.name));
      const bundleText = bundle?.featureGrants?.[0]?.description;
      if (bundleText) return sharedBriefDescription(bundleText, 160);
      return null;
    }
    return null;
  }

  /** Inline summary bullets for choice groups that moved out of the
   *  bottom "Your choices" sections into their row — "Skills — Arcana,
   *  Stealth", where the summary itself links the one shared dialog
   *  for that choice kind (skills/tools/styles/expertise/feats).
   *  Writes the same choicesStore keys the bottom renderer used, so
   *  wizard gating and hints are untouched. Already-granted options
   *  lock exactly like the flat renderer. */
  /** Spell names held by any OTHER live creation pick, so a spell pick
   *  never removes one another pick still needs. Reads every `creation:`
   *  key rather than only the spell ones, because the racial cantrip and
   *  Magical Secrets groups carry their own keys; a false positive only
   *  means a spell is left in the list, which is the safe direction. */
  function spellPickNamesHeldByOthers(excludeKey) {
    const out = new Set();
    for (const [key, names] of Object.entries(character.rules?.choices || {})) {
      if (key === excludeKey || !key.startsWith("creation:")) continue;
      (names || []).forEach((n) => out.add(n));
    }
    return [...out];
  }

  function inlineChoiceBullets(choiceGroups, saveRules) {
    const store = character.rules?.choices || {};
    return (choiceGroups || []).filter((g) => choiceDialogKindFor(g)).map((group) => {
      const kind = choiceDialogKindFor(group);
      const owned = ownedSkillIdsFrom(creationFixedBundles(state), creationChoiceGroupsFor(state), group.key);
      // A flexible ASI is not a list of options at all - its options are
      // {pattern, description} descriptors. It renders as two dropdowns
      // (+2 to / +1 to) via liveAbilityAsiBullet, NOT the generic
      // dialog: that dialog lists only options carrying a `name`, so it
      // would open empty.
      if (kind === "flexibleAbilityBonus") {
        return liveAbilityAsiBullet([group], saveRules);
      }
      // Spell picks have no bundle options - the list is the spell catalog,
      // so options are built at open time from the named list/levels, and
      // each pick is written onto the sheet.
      //
      // THREE lines, and they write to three different places:
      //
      //   cantrips - the Spells Known list, like any other spell the
      //               character holds.
      //   spells   - the Spells Known list. For a Wizard this is the
      //               SPELLBOOK; for a known caster it is "Spells Known".
      //   prepared - NOT the Spells Known list. A prepared spell is a subset
      //               the character holds ready; recording it as a spell they
      //               know would put a Cleric's three prepared spells into the
      //               spellbook as if they were the only three they could
      //               ever cast.
      if (kind === "spells") {
          const isPreparedLine = group.spellPick.part === "prepared";
          const model = spellcastingModelFor(state.className, state.rulesetId, {
            infoFor: (name) => getSpellcastingInfo(name),
          });
          const field = ensureSpellListField();
          const storedSpells = store[group.key] || [];

          // The prepared line's OPTIONS depend on where this class prepares
          // from. "known" (the Wizard) means out of the character's own
          // spellbook, which is why it can be locked until that has spells;
          // "classList" means straight out of the class list, and there is
          // nothing to wait for.
          const preparingFromKnown = isPreparedLine && model?.preparedFrom === "known";
          const spellbook = (field?.items || []).map((item) => (typeof item === "string" ? item : item?.text)).filter(Boolean);
          let spellList;
          if (preparingFromKnown) {
            spellList = spellbook.map((name) => ({ id: name, name, description: "In your spellbook" }));
          } else {
            spellList = spellPickDialogOptions({
              spellPick: group.spellPick,
              spellsForLevelFn: (lvl, list) => spellsForLevel(lvl, list),
            });
          }

          // Locked: nothing to prepare from yet. Said in the bullet text as
          // well as on the button, because a title attribute does nothing on
          // a touch device and aria-disabled alone says nothing to a sighted
          // user who cannot tell it from disabled.
          const lockReason = isPreparedLine
            ? preparedLineLock({ preparedFrom: model?.preparedFrom, knownNames: spellbook })
            : null;
          if (lockReason) {
            return {
              live: true,
              topic: group.label || "Prepared Spells",
              locked: true,
              // Not indented either - see the note on the unlocked branch
              // below. A locked prepared line at a different indent from an
              // unlocked one would move sideways as the player filled in
              // their known list, which is the opposite of a stable layout.
              indent: false,
              lead: [{ text: lockReason }],
            };
          }

          const summary = storedSpells.length ? storedSpells.join(", ") : `Choose ${group.maxSelections}`;

          // Over the limit, warn - never delete. The prepared count is level
          // plus an ability modifier, and the wizard takes ability scores
          // AFTER the class, so lowering the casting ability can put a
          // finished prepared list over a limit that has since dropped.
          // Silently trimming it would delete choices the player made while
          // the number was still correct.
          const alwaysPrepared = alwaysPreparedSpellNames(spellBundles(), state.level);
          const overBy = preparedCountOver({
            prepared: (field?.preparedItems || []).concat([...alwaysPrepared]),
            limit: group.maxSelections,
            preparedFrom: model?.preparedFrom,
            cantripsCountAsPrepared: model?.countsCantrips,
            knownItems: field?.items || [],
            levelByNameFn: (name) => spellLevelByName(name),
          });
          const warning = overBy > 0
            ? `You have ${overBy} more prepared than you can cast at this level — that's fine while you are still setting ability scores.`
            : null;

          // No Spell List catalog imported means there is nothing to pick
          // from. Opening an empty dialog reads as a bug, so show the same
          // fallback note the level-up spell picker shows instead - and no
          // link, because there is nothing behind it. A Wizard preparing from
          // its own spellbook needs no catalog at all, so that check does not
          // apply to it.
          if (!spellList.length && !preparingFromKnown) {
            return { live: true, topic: group.label || "Spells", lead: [{ text: NO_SPELL_CATALOG_NOTE }] };
          }
          return {
            live: true,
            topic: group.label || "Choose a spell",
            lead: [{ text: summary }],
            warning,
            // Level with the cantrip and spellbook lines, not under them: the
            // prepared list is chosen from the class list, not from the
            // spells above it, and the indent implied otherwise. What does
            // depend on the known list - a Wizard preparing from their
            // spellbook - is said in words instead, since that IS a real
            // dependency.
            indent: false,
            dialogOpener: () => openChoiceDialog({
              title: group.label || "Choose a spell",
              multi: group.maxSelections !== 1,
              maxSelections: group.maxSelections ?? 1,
              options: spellList,
              initialSelected: storedSpells,
              onAccept: (ids) => {
                character.rules.choices = { ...(character.rules?.choices || {}), [group.key]: ids };
                const target = ensureSpellListField();
                if (target) {
                  // The routing decision - prepared spells go to their own
                  // list, never into Spells Known - is applySpellPickWrite,
                  // so it can be tested outside this closure.
                  const written = applySpellPickWrite({
                    part: group.spellPick.part,
                    items: target.items || [],
                    preparedItems: target.preparedItems || [],
                    previous: storedSpells,
                    next: ids || [],
                    heldByOtherPicks: spellPickNamesHeldByOthers(group.key),
                    alwaysPrepared: alwaysPreparedSpellNames(spellBundles(), state.level),
                  });
                  target.items = written.items;
                  target.preparedItems = written.preparedItems;
                }
                saveRules();
                // The prepared list lives on the sheet FIELD, so the layout is
                // what changed. Without this the pick survives until reload
                // and then vanishes - the same class of bug as the loading
                // screen: the UI said one thing and the saved data another.
                if (isPreparedLine) saveWithStatus("layout", character.layout);
                renderPageGrid();
              },
            }),
          };
      }
      let opts = groupOptionsOf(group).filter((o) => o.name);

      // Expertise upgrades a proficiency you ALREADY have. The rules are
      // explicit: "choose a skill in which you have proficiency", and a
      // skill you lack proficiency in has no proficiency bonus to double.
      // The group shipped every one of the 22 skills as an option, so the
      // picker offered expertise in, say, Athletics to a character who had
      // never been trained in it - a free proficiency bonus.
      //
      // So the option list is narrowed to the skills this character is
      // actually proficient in, matched by label -> skill id -> the
      // "<id>Prof" field the owned set carries. Thieves' Tools is kept
      // because it is not a SKILLS entry and the Rogue's version grants
      // its own proficiency note.
      let emptyReason = null;
      if (kind === "expertise") {
        const proficient = new Set(SKILLS.filter((s) => owned.has(`${s.id}Prof`)).map((s) => s.label));
        const narrowed = opts.filter((o) => proficient.has(o.name) || !SKILLS.some((s) => s.label === o.name));
        if (narrowed.length !== opts.length) opts = narrowed;
        emptyReason = opts.length
          ? null
          : "Expertise needs a skill you are proficient in. Pick your skill proficiencies first.";
      }

      const lockedIds = [...new Set([...(group.lockedOptionIds || []), ...opts.filter((o) => optionIsOwned(o, owned)).map((o) => o.id)])];
      const stored = store[group.key] || [];
      const pickedNames = stored.map((id) => opts.find((o) => o.id === id)?.name).filter(Boolean);
      // Languages get the Widespread/Rare split, so the dialog reads as two
      // named bands rather than one fifteen-item wall. Grouped against the
      // options actually OFFERED here (which may be a subset, e.g. expertise
      // narrowing skills), so a heading can never name a row that is absent.
      const langSections = kind === "languages"
        ? languageSections()
          .map((s) => ({
            label: s.label,
            optionIds: opts.filter((o) => s.languages.includes(o.name)).map((o) => o.id),
          }))
          .filter((s) => s.optionIds.length)
        : null;
      return {
        live: true,
        topic: group.label || "Choose",
        lead: [{ text: emptyReason || (pickedNames.length ? pickedNames.join(", ") : `Choose ${group.maxSelections}`) }],
        dialogOpener: () => openChoiceDialog({
          title: group.label || "Choose an option",
          multi: group.maxSelections !== 1,
          maxSelections: group.maxSelections,
          options: opts.map((o) => ({ id: o.id, name: o.name, description: describeChoiceOption(kind, o) })),
          sections: langSections,
          lockedIds,
          initialSelected: stored,
          onAccept: (ids) => {
            character.rules.choices = { ...(character.rules?.choices || {}), [group.key]: ids };
            saveRules();
            renderPageGrid();
          },
        }),
      };
    });
  }

  /** Appends inline choice bullets (see above) as a mechanics list
   *  into a row-details container — the inlineChoicesFn dep for class
   *  steps, which can't go through profileSectionsFor. */
  function appendInlineChoiceBullets(details, choiceGroups, saveRules) {
    const bullets = inlineChoiceBullets(choiceGroups, saveRules);
    if (!bullets.length) return;
    const ul = el("ul", { class: "choice-row__mechanics-list" });
    bullets.forEach((b) => ul.append(renderLiveBulletItem(b)));
    details.append(ul);
  }

  /** Picker-profile sections with live pick bullets spliced in — for
   *  the selected race/background only (everyone else renders the
   *  static preview). Language tags and same-named stub notes leave
   *  the static preview, with the live bullets superseding them
   *  (verified lossless: the stubs read "Choice of: …"); ASI bullets
   *  append beside fixed score lines. */
  function profileSectionsFor(category, name, saveRules) {
    const statik = mechanicsListFor(category, name, state.level);
    const isRace = category === "Race";
    const isBg = category === "Background";
    if (!isRace && !isBg) return statik;
    // The groups belong to the ROW, not to the current pick. Expanding a
    // race or background shows the choices that row actually offers, so a
    // player can read (and try) Dwarven Toughness's languages before
    // committing to the dwarf. This used to be gated on
    // `name === state.species`, so every unselected row fell back to the
    // static preview and the whole point of expanding it was missing.
    //
    // A pick made from an unselected row writes to that group's own key.
    // Those keys are only read by gating/compute for the SELECTED race
    // (see raceChoiceGroups), so a previewed pick stays dormant — and
    // becomes live, and still there, if the player goes on to pick that
    // race rather than silently losing it.
    const rowGroups = choiceGroupsForRow(category, name, state);
    const langGroups = isRace ? rowGroups.filter(isInlineLangGroup) : [];
    const toolGroups = isBg ? rowGroups.filter((g) => g.fieldId === "toolProf") : [];
    const asiGroups = isRace ? rowGroups.filter(isAsiSlotGroup) : [];
    const featGroups = rowGroups.filter((g) => isFeaturePickGroup(g) && !choiceDialogKindFor(g));
    // Dialog-pick leftovers (skills, tools, fighting styles, expertise,
    // feats) count here too — otherwise a row whose ONLY groups take
    // the dialog returns the static preview and its choices vanish.
    const dialogGroups = rowGroups.filter((g) => choiceDialogKindFor(g));
    // A race-granted feat (Custom Lineage's "Feat" trait) renders as a
    // link opening the feats picker dialog instead of a static note. It
    // reads the staged lineage's own state, so it only describes the race
    // actually in progress — never a row being previewed.
    const lineageFeat = isRace && name === state.species ? liveLineageFeatBullet(saveRules) : null;
    if (!langGroups.length && !toolGroups.length && !asiGroups.length && !featGroups.length && !dialogGroups.length && !lineageFeat) return statik;
    const full = bundleFor(category, name, includedRulesetIds(state));
    if (!full) return statik;
    const liveFeatLabels = new Set(featGroups.map((g) => (g.label || "").trim()));
    const stripped = {
      ...full,
      statModifiers: (full?.statModifiers || []).filter((m) => !(m.op === "grantTag" && isLangFieldId(m.targetFieldId))),
      featureGrants: (full?.featureGrants || []).filter((f) =>
        !liveFeatLabels.has((f.name || "").trim())
        && !(lineageFeat && /^feat$/i.test((f.name || "").trim()))),
    };
    const sections = mechanicsListFor(category, name, state.level, stripped);
    // The row's OWN bundle as the fixed-grant source, so its languages
    // come from that race rather than from whichever race is selected.
    // Identical to the old `creationFixedBundles(state)[0]/[3]` for the
    // selected row — both resolve through bundleFor.
    const fixedBundle = full;
    return withLiveBullets(sections, [
      langGroups.length
        ? { section: isRace ? SHARED_MECHANICS_TITLES.traits : SHARED_MECHANICS_TITLES.innate, bullet: liveLanguageBullet(langGroups, fixedBundle, saveRules) }
        : null,
      toolGroups.length
        ? { section: SHARED_MECHANICS_TITLES.innate, bullet: liveToolBullet(toolGroups, fixedBundle, saveRules) }
        : null,
      asiGroups.length
        ? { section: SHARED_MECHANICS_TITLES.scores, bullet: liveAsiBullet(asiGroups, saveRules), after: SHARED_MECHANICS_TITLES.traits }
        : null,
      ...liveFeatureBullets(featGroups, saveRules).map((bullet) => ({ section: SHARED_MECHANICS_TITLES.innate, bullet })),
      ...inlineChoiceBullets(dialogGroups, saveRules).map((bullet) => ({ section: SHARED_MECHANICS_TITLES.innate, bullet })),
      ...(lineageFeat ? [{ section: SHARED_MECHANICS_TITLES.traits, bullet: lineageFeat }] : []),
    ].filter(Boolean));
  }

  /** The inline spell-pick groups for the class currently staged, at the
   *  level the character is being created at. A thin adapter: the counting
   *  and key shape live in creationSpellPickGroups (sheetWizard.js) so they
   *  can be tested without a DOM, and so the picker, the gating and the
   *  Review summary all read one function.
   *
   *  Reads the CLASS-level plan only. Subclass-granted spell picks already
   *  exist as real choice groups on the subclass bundle (Arcane Domain's
   *  cantrips, the Bard's Magical Secrets, Circle of the Land's cantrip),
   *  so they arrive through creationChoiceGroupsFor and are not duplicated
   *  here. The subclass bundle is still passed for always-prepared spells -
   *  a domain's domain spells and a circle's circle spells arrive as
   *  statModifiers on it. */
  /** The staged class's and subclass's bundles. The subclass bundle is what
   *  carries a domain's domain spells and a circle's circle spells, as
   *  `spellsKnown` addItem modifiers - see alwaysPreparedSpellNames. */
  function spellBundles() {
    return [
      bundleFor("Class", state.className, includedRulesetIds(state)),
      bundleFor("Subclass", state.subclass, includedRulesetIds(state)),
    ].filter(Boolean);
  }

  function inlineSpellPickGroups() {
    const bundles = spellBundles();
    const model = spellcastingModelFor(state.className, state.rulesetId, {
      infoFor: (name) => getSpellcastingInfo(name),
    });
    const spellField = ensureSpellListField();
    const choices = migrateSpellPickKeys(character.rules?.choices || {}, { className: state.className });
    if (choices !== character.rules?.choices) {
      // Folded the old per-level spell keys into the single leveled line.
      // Persisted, because until it is the old keys are orphans and the next
      // class change would delete the spells they hold.
      character.rules.choices = choices;
      saveRules();
    }
    return creationSpellPickGroups({
      className: state.className,
      level: state.level,
      abilityScores: character.rules?.abilityScores,
      bundles,
      choices,
      knownItems: spellField?.items || [],
      preparedItems: spellField?.preparedItems || [],
      limitFor: (name, lvl, scores) => spellLimitFor(name, lvl, scores),
      availableLevelsFor: (name, lvl) => sharedAvailableSpellLevels(
        getLevelUpPlan(state.rulesetId, name, lvl)
      ),
      levelByNameFn: (name) => spellLevelByName(name),
      model,
    });
  }

  /** Removes every spell a no-longer-staged class pick put on the sheet, then
   *  lets pruneOrphanedChoiceKeys drop the keys themselves.
   *
   *  Spells Known is one global list, so a Wizard's four cantrips would
   *  otherwise sit in a Fighter's spellbook forever. Spells the player added
   *  by hand are not under any pick key and are never touched.
   *
   *  Both lists are checked. `orphanedSpellPickNames` filters by membership of
   *  a list it is given, so it is asked about each in turn: prepared spells
   *  live in `preparedItems` and never in `items`, so asking only about
   *  `items` would leave a Cleric's prepared spells behind forever - they are
   *  under the orphaned `creation-spells-prepared` key but appear on no list
   *  the old call looked at.
   *
   *  Returns how many names went from each list, for the caller's notice. */
  function dropOrphanedSpellPicks() {
    const choices = character.rules.choices || {};
    const picks = {
      species: state.species,
      className: state.className,
      subclass: state.subclass,
      background: state.background,
    };
    const field = findStarterField("spellsKnown", "Spells Known");
    const textOf = (item) => (typeof item === "string" ? item : item?.text);
    const knownOrphans = new Set(orphanedSpellPickNames(choices, picks, field?.items || []));
    const preparedOrphans = new Set(orphanedSpellPickNames(choices, picks, field?.preparedItems || []));
    if (field && Array.isArray(field.items) && knownOrphans.size) {
      field.items = field.items.filter((item) => !knownOrphans.has(textOf(item)));
    }
    if (field && Array.isArray(field.preparedItems) && preparedOrphans.size) {
      field.preparedItems = field.preparedItems.filter((name) => !preparedOrphans.has(name));
    }
    const pruned = pruneOrphanedChoiceKeys(choices, picks);
    character.rules.choices = pruned.choices;
    return {
      pruned: pruned.pruned,
      spellsRemoved: knownOrphans.size,
      preparedRemoved: preparedOrphans.size,
    };
  }
  /** Fills cantrips + leveled spells to the class cap, first-available
   *  per spell level — the Express spell fill. Respects caps exactly
   *  like the picker (same limit helpers), never exceeding them. */
  function fillSpellsToCap() {
    const limit = spellLimitFor(state.className, state.level, character.rules?.abilityScores);
    if (!limit) return;
    const plan = getLevelUpPlan(state.rulesetId, state.className, state.level);
    const field = ensureSpellListField();
    if (!field) return;
    const known = new Set(field.items || []);
    sharedAvailableSpellLevels(plan).forEach((levelNum) => {
      spellsForLevel(levelNum, state.className).forEach(({ name }) => {
        if (!name || known.has(name)) return;
        const counts = sharedSpellCountByLevel(known, (n) => spellLevelByName(n));
        if (!sharedCanLearnMore(levelNum, limit, counts.cantrips, counts.spells)) return;
        appendUniqueTextListItem(field, name);
        known.add(name);
      });
    });
    saveWithStatus("layout", character.layout);
  }

  /** Express setup: fills every choice for the picked class with its
   *  recommended defaults (data in expressDefaults.js, first-available
   *  everywhere else) and lands on Gear & Review, where dots jump back
   *  to change anything. Explicitly user-invoked, so it overwrites
   *  staged group picks with the defaults — per-character sources and
   *  already-saved sheet fields are untouched until Finish Setup. */
  function applyExpressDefaults() {
    const cls = state.className;
    if (!cls) return;
    const defaults = EXPRESS_CLASS_DEFAULTS[cls] || {};
    if (defaults.abilities) {
      ABILITY_IDS.forEach((id) => {
        if (Number.isFinite(defaults.abilities[id])) character.rules.abilityScores[id] = defaults.abilities[id];
      });
    }
    const subs = liveSubclassData(cls);
    if (!state.subclass && subs.subclasses.length && state.level >= subs.subclassLevel) {
      state.subclass = subs.subclasses[0];
    }
    const groups = creationChoiceGroupsFor(state);
    const picks = expressPicksFor(groups, defaults.skills || []);
    character.rules.choices = { ...(character.rules.choices || {}), ...picks };
    const entry = CLASS_STARTING_EQUIPMENT[cls];
    if (entry && !character.rules.startingEquipment?.applied) {
      character.rules.startingEquipment = {
        picks: Object.fromEntries((entry.decisions || []).map((d) => [d.id, d.options[0]?.id])),
      };
    }
    fillSpellsToCap();
    // Bard Secrets unlocks fill first-available too, so Express lands
    // on a complete Class step like every other class.
    const secretsUnlocked = magicalSecretsUnlocked(cls, state.subclass, state.level);
    if (secretsUnlocked > 0) {
      const bardPlan = getLevelUpPlan(state.rulesetId, "Bard", Math.max(1, state.level));
      const bardLevels = sharedAvailableSpellLevels(bardPlan);
      const bardNames = firmBardSpellNames(bardLevels);
      const secretsField = ensureSpellListField();
      if (secretsField) {
        const secretsKnown = new Set(secretsField.items || []);
        let secretsPicked = secretsPickedCount([...secretsKnown], [...bardNames]);
        for (const lvl of bardLevels) {
          for (const { name } of spellsForLevel(lvl, null)) {
            if (secretsPicked >= secretsUnlocked || !name || secretsKnown.has(name) || bardNames.has(name)) continue;
            appendUniqueTextListItem(secretsField, name);
            secretsKnown.add(name);
            secretsPicked++;
          }
        }
      }
    }
    saveRules();
    // Land on Review: the shell resolves the persisted step id to its index
    // on the next render, bypassing forward-gating (dots still gate manual
    // forward jumps; backward is always free).
    //
    // This used to say "gear-review", which has never been a step id - the
    // ids are "gear" and "review" - so the lookup failed silently and
    // dropped the player on the first step instead of the end. With the
    // Gear tab gone there is only one place worth landing, and "review" is
    // the step that follows everything they just filled in.
    creationWizardState.stepId = "review";
    persistWizardProgressSoon();
    renderPageGrid();
  }

    function wizardUnavailableMessage() {
      return wizardUnavailableMessageFor(state);
    }
    /** Whether the staged race grants a feat of its own (today:
     *  Custom Lineage's "Feat" trait) — when it does, Identity offers
     *  a real feat picker below the race rows. */
    function lineageFeatOffered() {
      const bundle = creationFixedBundles(state)[0];
      return ((bundle || {}).featureGrants || []).some((g) => /^feat$/i.test((g.name || "").trim()));
    }
    function lineageFeatPick() {
      return (character.rules.feats || []).find((f) => f.source === "lineage") || null;
    }

    /** The Story block on the sheet — the one holding Personality Traits,
     *  Ideals, Bonds and Flaws, and (on a current sheet) Appearance and
     *  Backstory. Located by a field that has been in it since the start,
     *  not by block name: the block was renamed "Personality" → "Story"
     *  when the two fields joined it, and a saved sheet still carries the
     *  old name. */
    function storyBlock() {
      return globalLayout().find((b) => (b.children || []).some((f) => f.label === "Personality Traits")) || null;
    }

    /** The sheet field a story box writes to, created on demand.
     *
     *  The wizard only runs on a character still in setup, and those are
     *  built from the current starter layout, so the boxes are normally
     *  already there. But a character can be resumed from a save written
     *  before these fields existed, and a Story step whose textareas quietly
     *  go nowhere is the worst of the available outcomes — so the field is
     *  added to the layout the first time it is written to, below whatever
     *  the block already holds. Returns null only when the character has no
     *  Story block at all, which the caller reports rather than hides.
     *
     *  Placed below the existing children rather than at the starter layout's
     *  coordinates, because an older block's rows are a different shape and
     *  writing to fixed coordinates would drop a second textbox on top of
     *  the first. */
    function ensureStoryField(label) {
      const existing = findStarterField(null, label);
      if (existing) return existing;
      const block = storyBlock();
      if (!block) return null;
      const bottom = (block.children || []).reduce((max, f) => Math.max(max, (f.y || 0) + (f.h || 1)), 0);
      const sideBySide = (block.children || []).some((f) => f.y === bottom && f.x === 0);
      const made = createField({
        fieldType: "textarea",
        label,
        x: sideBySide ? 3 : 0,
        y: bottom,
        w: 3,
        h: 4,
      });
      block.children.push(made);
      block.h = Math.max(block.h || 0, bottom + 4);
      return made;
    }

    /** Debounced writer for a story box. Saves the LAYOUT, not rules: a
     *  story box is a sheet field, so this is the first wizard step that
     *  persists layout rather than character.rules. */
    function storyFieldSaver() {
      const write = debounce(() => {
        unsavedChanges = true;
        store.saveCharacterFields(character.id, { layout: character.sheetTabs[0].layout }).catch((err) => {
          console.error("Failed to save story fields:", err);
        });
      }, 600);
      return (label, value) => {
        const target = ensureStoryField(label);
        if (!target) return;
        target.value = value;
        write();
      };
    }

    const steps = [
      {
        id: "rules",
        title: "Rules & Sources",
        // Was "Rules" + "Pick your sources and how hit points work on
        // level-up." Neither half said why this page exists or what it
        // affects. It is the page that decides what every LATER page can
        // offer, so it needs to say so before the player picks anything.
        descriptionItems: [
          "Two things to set up first: which books to build your character from, and how you want hit points worked out when you level up.",
          "Tick the books you have and every page after this offers only what comes from them — classes, species, backgrounds, feats, and spells. You can add or remove books later; anything you have already picked that only existed in a removed book will be cleared, so we will ask you first.",
          "Nothing to do here if you are just picking from the books already ticked.",
        ],
        isComplete: () => {
          if (includedRulesetIds(state).length === 0 || !primaryRulesetId(state)) return false;
          return Boolean(character.rules.hpMethod);
        },
        missingReasons() {
          const out = [];
          if (includedRulesetIds(state).length === 0) out.push("No source book ticked.");
          if (!character.rules.hpMethod) out.push("No hit-point rule chosen.");
          return out;
        },
        render(container) {
          const sourcesWrap = sectionInto(container, "Sources");
          renderRulesetStepInto(sourcesWrap, state, {
            listRulesetsFn: () => listRulesets(),
            listContentPacksFn: (rid) => listContentPacks(rid),
            defaultContentPackIdsFn: (rid) => defaultContentPackIds(rid),
            includedIds: includedRulesetIds(state),
            primaryId: primaryRulesetId(state),
            setPrimaryFn: async (rulesetId, opts) => {
              const prevPrimary = primaryRulesetId(state);
              if (rulesetId !== prevPrimary && (state.species || state.className || state.subclass || state.background)) {
                const ok = await confirmDialog({
                  title: "Change the ruleset?",
                  message: "Your Race, Class, Subclass and Background picks are cleared, because they come from the books you have selected.",
                  confirmLabel: "Change ruleset",
                  tone: "danger",
                });
                if (!ok) {
                  renderPageGrid();
                  return;
                }
                state.species = "";
                state.className = "";
                state.subclass = "";
                state.background = "";
              }
              setRulesetId(rulesetId);
              saveRules();
              saveSourceDefault(rulesetId, includedRulesetIds(state));
              if (opts?.rerender === false) return;
              const syncMessage = syncRulesetBundles(includedRulesetIdsFor());
              renderPageGrid();
              if (syncMessage) statusEl.textContent = syncMessage;
            },
            updateIdsFn: async (nextIds, opts) => {
              const prevIds = includedRulesetIds(state);
              const removed = prevIds.filter((id) => !nextIds.includes(id));
              // Adding a book never disturbs existing picks — only
              // removing one can orphan them, so only then confirm.
              // The actual cleanup below keeps every pick still offered
              // under the remaining books and reports what went away.
              if (removed.length > 0 && (state.species || state.className || state.subclass || state.background)) {
                const titles = listContentPacks()
                  .filter((p) => removed.includes(p.id))
                  .map((p) => p.name)
                  .filter(Boolean);
                const ok = await confirmDialog({
                  title: titles.length === 1 ? `Remove ${titles[0]}?` : "Remove these books?",
                  message: "Your Race, Class, Subclass and Background picks are cleared if they only come from a book being removed. Anything still available in the books that remain is kept.",
                  confirmLabel: "Remove",
                });
                if (!ok) {
                  renderPageGrid();
                  return;
                }
              }
              setIncludedRulesetIds(nextIds);
              let revalidated = { removed: [], pruned: 0 };
              if (removed.length > 0) revalidated = revalidatePicksAfterSourceChange();
              saveRules();
              saveSourceDefault(primaryRulesetId(state), nextIds);
              // Skipped when persisting mid-render (auto-select): the
              // in-progress render paints it, and bundle sync waits
              // for a real user action.
              if (opts?.rerender === false) return;
              const syncMessage = syncRulesetBundles(nextIds);
              renderPageGrid();
              if (revalidated.removed.length) {
                statusEl.textContent = `Removed ${revalidated.removed.map((r) => r.name).join(", ")} — not in the remaining sources.`;
              } else if (syncMessage) statusEl.textContent = syncMessage;
            },
          });
          // No section title here: renderPreferencesStepInto already
          // labels the picker ("Hit Points on Level Up"), so a second
          // header would read as a duplicate. A separator divides the
          // Ruleset + Content selection above from the HP rule below.
          container.append(el("hr", { class: "wizard__separator" }));
          const hpWrap = el("div", { class: "wizard__subsection" });
          container.append(hpWrap);
          renderPreferencesStepInto(hpWrap, state, {
            hpOptions: HP_METHOD_OPTIONS,
            currentMethod: character.rules.hpMethod || "average",
            updateFn: (key, value) => update(key, value),
            selectableRowsFn: (c, names, opts) => renderPickerRows(c, names, opts),
          });
        },
      },
      {
        id: "identity",
        title: "Identity",
        description: "Name your character, set starting level, and choose a species — its granted choices (languages, traits, subrace) appear right below it.",
        isComplete: () => {
          if (!((character.name || "").trim()) || !state.species) return false;
          if (!raceChoiceSettled(state.species)) return false;
          if (!choicesComplete(raceChoiceGroups)) return false;
          return !lineageFeatOffered() || Boolean(lineageFeatPick());
        },
        missingReasons() {
          const out = [];
          if (!((character.name || "").trim())) out.push("No name yet.");
          if (!state.species) out.push("No species picked yet.");
          else {
            if (!raceChoiceSettled(state.species)) out.push("Subrace pick outstanding.");
            if (!choicesComplete(raceChoiceGroups)) out.push("Choices still to make.");
            if (lineageFeatOffered() && !lineageFeatPick()) out.push("Ancestry feat not taken yet.");
          }
          return out;
        },
        render(container) {
          renderIdentityStepInto(container, state, {
            characterName: character.name,
            nameInputSetFn: (v) => { nameInput.value = v; },
            saveNameFn: (v) => {
              character.name = v;
              saveWithStatus("name", v);
              refreshWizardNav();
            },
            updateFn: (key, value) => update(key, value),
            fieldFn: (c, label, control) => field(c, label, control),
            optionNamesFn: (rulesetId, category) => rulesetOptionNames(rulesetId, category, wizardFieldOptionNames("race", "Race")),
            catalogInfoFn: (keywords, name) => catalogEntryInfo(keywords, name),
            bundleFn: (category, name, rulesetId) => bundleFor(category, name, rulesetId ?? includedRulesetIds(state)),
            summarizeFn: (m) => statModifierSummary(m),
            mechanicsListFn: (category, name) => (subraceGroupFor(name)
              ? []
              : profileSectionsFor(category, name, saveRules)),
            selectableRowsFn: (c, names, opts) => renderPickerRows(c, names, opts),
            debounceFn: (fn, ms) => debounce(fn, ms),
            getSummary: (name) => sharedMechanicsSummaryForPicker(
              bundleFor("Race", name, includedRulesetIds(state)),
              state.level,
              { abilityIds: ABILITY_IDS, abilities: ABILITIES, skills: SKILLS, resolveLabel: (id) => resolveFieldById(id)?.label }
            ),
            subraceGroupFn: (raceName) => {
              const group = subraceGroupFor(raceName);
              if (!group) return null;
              // Flat and cross-category shapes alike: the nested list used to
              // read `.options` alone, so a container race shaped as a
              // cross-category group rendered NO subrace rows at all - and
              // with no subrace to pick, such a race could be chosen and
              // never finished. A container that cannot be completed is
              // worse than no container at all.
              const options = groupOptionsOf(group);
              if (!options.length) return null;
              return { group, options, pickedIds: state.choices?.[group.key] || [] };
            },
            subraceMechanicsFn: (raceName, subName) => {
              const group = subraceGroupFor(raceName);
              const option = groupOptionsOf(group).find((o) => o.name === subName);
              if (!option) return [];
              const sections = sharedMechanicsBulletsFor(
                { statModifiers: option.statModifiers, featureGrants: option.featureGrants },
                state.level,
                {
                  abilityIds: ABILITY_IDS,
                  abilities: ABILITIES,
                  skills: SKILLS,
                  resolveLabel: (id) => resolveFieldById(id)?.label,
                }
              );
              // A subrace option can carry choice groups of its own — the
              // High Elf's extra language and cantrip do. They used to be
              // silently dropped, so those two traits showed their text
              // and offered no way to take them. Lifted into keyed groups
              // and rendered as live rows in the subrace's own picker row,
              // which is where a subrace's rules are read.
              const nested = nestedChoiceGroupsFor(option, {
                parentKey: group.key,
                pickedIds: state.choices?.[group.key] || [],
                source: option.name,
              });
              if (!nested.length) return sections;
              return withLiveBullets(sections, inlineChoiceBullets(
                lockCommonInLanguageGroups(nested),
                saveRules
              ).map((bullet) => ({ section: SHARED_MECHANICS_TITLES.innate, bullet })));
            },
            selectSubraceFn: (group, optionId) => {
              character.rules.choices = character.rules.choices || {};
              character.rules.choices[group.key] = [optionId];
              saveRules();
              renderPageGrid();
            },
          });
          // raceSectionGroups is empty for every baked-in race now
          // (leftovers render in the row via inlineChoiceBullets) — the
          // call stays as a safety net so a future/homebrew group no
          // dialog covers still surfaces instead of vanishing.
          renderYourChoicesSections(container, "identity", raceSectionGroups, saveRules, raceChoiceGroups);
          if (lineageFeatOffered()) {
            // One row, not 83. This used to call renderPickerRows with the
            // whole feat list, which put an 83-row block at the bottom of
            // the Identity step - the same feats the Custom Lineage row's
            // own "Choose a feat" link lists, so the sheet showed every
            // feat twice and the page grew to five figures of pixels before
            // the Class step. The dialog is the picker; this row is the
            // handle on it, and it shows what is currently chosen.
            const pickWrap = sectionInto(container, `Racial feat — ${state.species}`);
            const chosen = lineageFeatPick();
            const row = el("div", { class: "choice-row choice-row--selected" });
            const body = el("div", { class: "choice-row__body" });
            const open = () => {
              liveLineageFeatBullet(saveRules)?.dialogOpener?.();
            };
            body.append(
              el("div", { class: "choice-row__label", text: chosen?.name || "Choose a feat" }),
              el("div", {
                class: "choice-row__note",
                text: chosen
                  ? "Racial feat from your ancestry. Click to change it."
                  : "Your ancestry grants a feat. Click to choose one.",
              })
            );
            row.append(body);
            row.style.cursor = "pointer";
            row.addEventListener("click", open);
            pickWrap.append(row);
          }
        },
      },
      {
        id: "class",
        title: "Class",
        // Used to end "... Spells have their own page." That was true when
        // the Spells tab existed; spells moved back into this row in 0d0de51,
        // so the sentence described a page that is no longer there and read
        // as a dead end to anyone who had followed it once. Spells are now
        // part of the class row like every other choice the class makes.
        descriptionItems: [
          "Pick what your character does best — the class sets hit points, attacks, and features.",
          "If a subclass is available at your level, pick it under your class, then make that class's choices in its row.",
          "Cantrips and spells are picks here too, when your class has them: they open the same spell list as everything else, and they land on your sheet's Spells Known.",
          "Spell lines work differently by class. A class that knows its spells has one list and nothing to prepare. A class that prepares spells has a line for that instead — a Cleric picks prepared spells straight from what the class can cast. A Wizard has both: a spellbook to fill in, and prepared spells chosen from it.",
          "How many you can pick is a total across spell levels, not a number per level. Cantrips are counted on their own.",
          "Only classes from the source books you ticked on the Rules page are offered.",
        ],
        isComplete: () => {
          if (!state.className) return false;
          const subs = liveSubclassData(state.className);
          if (subs.subclasses.length && state.level >= subs.subclassLevel && !state.subclass) return false;
          return choicesComplete(classChoiceGroups);
        },
        missingReasons() {
          const out = [];
          if (!state.className) return ["No class picked yet."];
          const subs = liveSubclassData(state.className);
          if (subs.subclasses.length && state.level >= subs.subclassLevel && !state.subclass) {
            out.push("No subclass picked yet.");
          }
          // Spells get their own line with a real count. Every other
          // outstanding pick on this row (proficiencies, skills, features)
          // shares one blunt "choices" phrase, which was true when this row
          // had no numbers in it and stopped being true the moment spell
          // counts appeared — the shortfall is the one thing a player
          // standing here most needs to know.
          const spells = spellPickShortfallPhrase(inlineSpellPickGroups(), state.choices || {});
          if (spells) out.push(spells);
          if (!choicesComplete(classChoiceGroups)) out.push("Choices still to make.");
          return out;
        },
        render(container) {
          const classFallback = wizardFieldOptionNames("class", "Class");
          renderClassStepInto(container, state, {
            optionNamesFn: (rulesetId, category) => rulesetOptionNames(
              rulesetId,
              category,
              classFallback.length ? classFallback : (resolved.ruleset?.classes || []).map((c) => c.name)
            ),
            catalogInfoFn: (keywords, name) => catalogEntryInfo(keywords, name),
            bundleFn: (category, name, rulesetId) => bundleFor(category, name, rulesetId ?? includedRulesetIds(state)),
            summarizeFn: (m) => statModifierSummary(m),
            mechanicsListFn: (category, name) => mechanicsListFor(category, name, state.level),
            subclassDataFn: (name) => liveSubclassData(name),
            updateFn: (key, value) => update(key, value),
            // Collapsed by default, same as the Race table — only the
            // selected class (and its nested subclass row) expands.
            selectableRowsFn: (c, names, opts) => renderPickerRows(c, names, opts),
            creationGroups: creationGroupsWithSpells,
            categorizeChoiceGroup: sharedCategorizeChoiceGroup,
            saveRules,
            sectionIntoFn: sectionInto,
            renderCreationChoiceGroupsFn: renderCreationChoiceGroups,
            inlineChoicesFn: (details, groups) => appendInlineChoiceBullets(details, groups, saveRules),
            getSummary: (name) => sharedMechanicsSummaryForPicker(
              bundleFor("Class", name, includedRulesetIds(state)),
              state.level,
              { abilityIds: ABILITY_IDS, abilities: ABILITIES, skills: SKILLS, resolveLabel: (id) => resolveFieldById(id)?.label }
            ),
          });
          // classChoiceGroups is empty for every baked-in class now
          // (leftovers render in the row via inlineChoicesFn) — the
          // call stays as a safety net for groups no dialog covers.
          renderYourChoicesSections(container, "class", classChoiceGroups.filter((g) => !choiceDialogKindFor(g)), saveRules, classChoiceGroups);
        },
      },
      {
        id: "background",
        title: "Background",
        description: "Pick where your character comes from. It grants skill and tool proficiencies (bonuses on those rolls) plus starting gear — its granted choices appear right below it.",
        isComplete: () => {
          if (!state.background) return false;
          return choicesComplete(backgroundChoiceGroups);
        },
        missingReasons() {
          if (!state.background) return ["No background picked yet."];
          return choicesComplete(backgroundChoiceGroups) ? [] : ["Choices still to make."];
        },
        render(container) {
          renderRowListStepInto(container, state, {
            optionNamesFn: (rulesetId, category) => rulesetOptionNames(rulesetId, category, wizardFieldOptionNames("background", "Background")),
            fallbackNames: [],
            keywords: ["background"],
            category: "Background",
            selectedKey: "background",
            inputLabel: "Background",
            inputPlaceholder: "No Background options found for this ruleset yet — Type it in for now",
            updateKey: "background",
            updateFn: (key, value) => update(key, value),
            fieldFn: (c, label, control) => field(c, label, control),
            selectableRowsFn: (c, names, opts) => renderPickerRows(c, names, opts),
            catalogInfoFn: (keywords, name) => catalogEntryInfo(keywords, name),
            bundleFn: (category, name, rulesetId) => bundleFor(category, name, rulesetId ?? includedRulesetIds(state)),
            summarizeFn: (m) => statModifierSummary(m),
            mechanicsListFn: (category, name) => profileSectionsFor(category, name, saveRules),
            getSummary: (name) => sharedMechanicsSummaryForPicker(
              bundleFor("Background", name, includedRulesetIds(state)),
              state.level,
              { abilityIds: ABILITY_IDS, abilities: ABILITIES, skills: SKILLS, resolveLabel: (id) => resolveFieldById(id)?.label }
            ),
          });
          // bgSectionGroups is empty for every baked-in background now
          // (leftovers render in the row via inlineChoiceBullets) — the
          // call stays as a safety net for groups no dialog covers.
          renderYourChoicesSections(container, "background", bgSectionGroups, saveRules, backgroundChoiceGroups);
        },
      },
      {
        id: "story",
        title: "Story",
        // No isComplete, deliberately. Appearance and Backstory are free
        // text with no data behind them, so an empty one is a finished
        // character, not an unfinished page — plenty of tables start
        // playing with a backstory worked out in the first session. Gating
        // here would block Finish Setup on two boxes that have no right
        // answer, which is the same trap the spell picks nearly shipped.
        descriptionItems: [
          "Two free-text boxes, and nothing else. Write as much or as little as you like — you can fill them in later on the sheet.",
          "Both land on your sheet's Story block, next to Personality Traits, Ideals, Bonds, and Flaws, and you can edit them there at any time.",
          "Nothing here is checked against anything. It is not part of your character’s mechanics.",
        ],
        render(container) {
          // Read the values back off the sheet rather than keeping wizard
          // state for them: these ARE the sheet's fields, and a second
          // copy could disagree with the first.
          const values = {};
          const missingLabels = [];
          for (const spec of STORY_FIELDS) {
            const target = findStarterField(null, spec.label);
            if (target) values[spec.label] = target.value || "";
            else missingLabels.push(spec.label);
          }
          renderStoryStepInto(container, {
            fieldFn: (c, label, control) => field(c, label, control),
            values,
            missingLabels,
            // One debounced saver for the pair, so typing in either box
            // does not write two separate layout saves.
            saveFn: storyFieldSaver(),
          });
        },
      },
      {
        id: "abilities",
        // Renamed from "Ability Scores". This step is now where the
        // character states what they START with: their six scores and
        // their starting kit. Spells and equipment left the wizard as
        // tabs (both live in the catalogs now), so this is the last step
        // before Review and the name has to say more than "scores".
        title: "Starting Conditions",
        descriptionItems: [
          "Set your six ability scores, then pick your starting equipment. Both apply when you finish setup.",
          "Each ability has a score (raw talent) and a modifier beside it — the modifier is the number you actually add to attack rolls, saves, and checks at the table.",
          "Modifiers come from scores automatically (10–11 is +0, 12–13 is +1, 8–9 is −1, and so on) — you never set them by hand.",
          "Point Buy spends 27 points across all six (fair, no luck). Random Roll rolls dice for each. Manual Entry types in rolls from the table.",
        ],
        render(container) {
          const stagedBundles = creationFixedBundles(state);
          const stagedNames = [state.species, state.className, state.subclass, state.background];
          renderAbilitiesStepInto(container, {
            abilityIds: ABILITY_IDS,
            descriptions: ABILITY_DESCRIPTIONS,
            scores: character.rules.abilityScores,
            method: character.rules.abilityScoreMethod,
            budget: POINT_BUY_BUDGET,
            min: POINT_BUY_MIN,
            max: POINT_BUY_MAX,
            costFn: (score) => pointBuyCost(score),
            affordableFn: (id) => maxAffordablePointBuyScore(id),
            rollFn: () => rollAbilityScore(),
            modifierFn: (score) => sharedAbilityModifier(score),
            formatFn: (mod) => sharedFormatModifier(mod),
            // Under the scores, not above them: it explains what the race
            // and class add to the numbers just typed, so it reads as a
            // footnote to them rather than as an introduction to them.
            footnote: "Bonuses from your race and other picks apply on top of these scores and show under each one (e.g. +2 from Elf → 17 total) — set the base here, the sheet adds the rest.",
            saveFn: () => saveRules(),
            onMethodChange: (method) => {
              character.rules.abilityScoreMethod = method;
              saveRules();
            },
            bonuses: abilityScoreBonusesFrom(
              stagedBundles.map((bundle, i) => ({ source: stagedNames[i], bundle })),
              ABILITY_IDS
            ),
            // Feats the player has already picked (or is looking at) that
            // want a higher score than they've set, so the Abilities tab
            // can say which ones are still short and by how much.
            featNeeds: featAbilityNeeds(),
          });

          // Starting equipment moved here from the Gear tab, which is no
          // longer a step. It is the one thing that tab held which the
          // item catalog cannot reproduce: the catalog lets you add any
          // item, but only this carries the PHB "pick one of these rows,
          // or take gold instead" either/or choices and knows what Finish
          // Setup will actually grant.
          //
          // The separator is deliberate - ability scores and starting gear
          // are two unrelated things that happen to land on one page, and
          // running them together reads as one long form.
          container.append(el("hr", { class: "wizard__separator" }));
          const gearWrap = sectionInto(container, "Starting Equipment");
          renderStartingEquipmentStepInto(gearWrap, state, saveRules);
          // The free-form weapon/armor/tool/vehicle proficiency picks
          // moved to the MAIN sheet (an Equipment Proficiencies control
          // there), because they are not starting gear: they are extra
          // proficiencies you hold for the life of the character, and the
          // sheet is where everything lasting belongs.
        },
      },
      // ----------------------------------------------------------------
      // COMMENTED OUT 2026-10-01. The Gear step is still parked; the Spells
      // step is not, and its body is below with a note.
      //
      // These two creation steps were removed from the wizard at the user's
      // instruction: spells and gear are chosen from the catalogs and the
      // sheet instead. Parked, not deleted, because the code under them was
      // still live elsewhere at the time:
      //
      //   spells -> renderSpellPicker is still the LEVEL-UP wizard's
      //             picker (see the leveling steps below). The Bard's
      //             Magical Secrets moved to a picker on the Bard's class
      //             entry (patchBard in contentFixups.js) precisely because
      //             it was the one thing this step held that the spell
      //             catalog cannot reproduce - it is a count-limited
      //             cross-class pick.
      //   gear   -> renderStartingEquipmentStepInto moved to the
      //             "Starting Conditions" step (it carries the PHB
      //             either/or rows and the gold-instead option, which no
      //             catalog reproduces).
      //             renderEquipmentProficienciesStepInto moved to the
      //             main sheet as an Equipment Proficiencies control.
      //             renderInnateAbilitiesStepInto moved to Review.
      //
      // Every renderer referenced below is still called from somewhere.
      // A future audit that flags this block as dead code has not
      // followed the calls.
      // ----------------------------------------------------------------
      // The SPELLS half of this block has since been deleted rather than
      // parked, and that is a real change rather than a tidy-up: the
      // inline picks on the class row (creationSpellPickGroups) now gate
      // completeness and land on the sheet, so this step's isComplete
      // checked a thing that no longer exists. What went with it:
      //
      //   spellPicksComplete      - read the old per-level pick keys.
      //   secretsSatisfiedFor     - Magical Secrets is now a real choice
      //                             group on the Bard's class bundle.
      //   renderSecretsSectionInto- nothing called it but this block; the
      //                             Magical Secrets picker lives on the
      //                             class row now.
      //
      // renderSpellPicker survives, and is the level-up wizard's.
      // ----------------------------------------------------------------
//       {
//         id: "gear",
//         title: "Gear",
//         description: "Choose starting gear (or take gold instead) and weapon/armor/tool training.",
//         isComplete: () => {
//           const entry = CLASS_STARTING_EQUIPMENT[state.className];
//           if (!state.className || !entry) return true;
//           const se = character.rules.startingEquipment || {};
//           if (se.gold) return true;
//           if (se.picks) {
//             return (entry.decisions || []).every((d) => se.picks[d.id]
//               && d.options.some((o) => o.id === se.picks[d.id]));
//           }
//           return Boolean(se.classOptionId);
//         },
//         render(container) {
//           const gearWrap = sectionInto(container, "Starting Equipment");
//           renderStartingEquipmentStepInto(gearWrap, state, saveRules);
//           const equipWrap = sectionInto(container, "Weapons, Armor & Tools");
//           renderEquipmentProficienciesStepInto(equipWrap, state, saveRules);
//           const innateWrap = sectionInto(container, "What You Get Automatically");
//           renderInnateAbilitiesStepInto(innateWrap, innateAbilitySections(state));
//         },
//       },
      {
        id: "review",
        title: "Review",
        // "Check your three picks below" counted the three TOP-LEVEL picks
        // (race, class, background) and then said "three" to someone staring
        // at a page of sub-picks — proficiencies, skills, languages, a feat,
        // cantrips, spells — of which there can be thirty. The count was
        // never about what the page holds; it described the three
        // headliners and let the rest pass as included.
        descriptionItems: [
          "Check everything you picked, then Finish Setup. Nothing here is final — every choice stays editable from the dropdowns below, and you can walk back through the pages with the dots or Back.",
          "If anything is still outstanding, the list under this heading names it and links to the page that needs it.",
          "What You Get Automatically at the bottom is the roll-up of every race, class, subclass, and background grant at your current level — read-only, nothing to fill in.",
        ],
        // The same predicate the Identity page gates on, not just "a race
        // is named": a container race (Elf, Dwarf, Gnome, Halfling,
        // Genasi) has to have a subrace chosen before the character counts
        // as built, and Review is the page that says so out loud.
        isComplete: () => Boolean(raceChoiceSettled(state.species) && state.className && state.background),

        render(container) {
          // Only what was chosen. This step used to re-render the full
          // pickers - all 15 ancestries, all 13 classes, all 9
          // backgrounds - on a page whose job is to show the finished
          // character. You had to scroll past every ancestry you did NOT
          // pick to find your own. The selected row keeps its real markup,
          // so it still expands, still shows its mechanics, and still
          // reads exactly as it did on the step where you picked it.
          const onlyChosen = (listFn, chosen) => (rulesetId, category) => {
            const names = listFn(rulesetId, category) || [];
            return chosen && names.includes(chosen) ? [chosen] : names;
          };

          // Declared before the first use below. The summary box renders at
          // the TOP of the step, and a const arrow function called above its
          // own declaration is a ReferenceError, not a hoisted value.
          const spellsField = findStarterField("spellsKnown", "Spells Known");
          const reviewDeps = () => ({
            characterName: character.name,
            rulesetName: includedRulesetIds(state).map((id) => getRuleset(id)?.name || id).join(" + ") || null,
            spellLimit: resolved.derived.spellLimit,
            resources: resolved.derived.resources,
            abilityScores: character.rules.abilityScores,
            abilityMethod: character.rules.abilityScoreMethod,
            hpMethod: null,
            choiceLines: [],
            spellsPicked: [...(spellsField?.items || [])],
            equipmentLine: null,
            featNames: (character.rules.feats || []).map((f) => f.name).filter(Boolean),
            syncFn: () => syncRulesToSheet(resolved),
          });

          reviewSummaryBoxInto(container, state, reviewDeps());

          // Above the picks, so it is the first thing read: the wizard's
          // forward gating is a lock, not an explanation, and someone who
          // reached review with pages still unfinished had no other way to
          // find out which ones. `untilStepId` keeps review from listing
          // itself. Navigation reuses the wizard's own resume-by-id path
          // (the same one line 5338 uses) rather than a second mechanism
          // that could disagree about where a step is.
          reviewOutstandingInto(
            container,
            outstandingSteps(steps, { untilStepId: "review" }),
            (stepId) => {
              creationWizardState.stepId = stepId;
              persistWizardProgressSoon();
              renderPageGrid();
            },
          );

          const raceWrap = sectionInto(container, "Race");
          const raceOptionsFn = (rulesetId, category) => rulesetOptionNames(rulesetId, "Race", wizardFieldOptionNames("race", "Race"));
          renderRowListStepInto(raceWrap, { ...state, background: state.species }, {
            optionNamesFn: onlyChosen(raceOptionsFn, state.species),
            fallbackNames: [],
            keywords: ["race", "species"],
            category: "Race",
            selectedKey: "species",
            inputLabel: "Race/Species",
            inputPlaceholder: "Type race",
            updateKey: "species",
            updateFn: (key, value) => update(key, value),
            fieldFn: (c, label, control) => field(c, label, control),
            selectableRowsFn: (c, names, opts) => renderPickerRows(c, names, opts),
            catalogInfoFn: (keywords, name) => catalogEntryInfo(keywords, name),
            bundleFn: (category, name, rulesetId) => bundleFor(category, name, rulesetId ?? includedRulesetIds(state)),
            summarizeFn: (m) => statModifierSummary(m),
            mechanicsListFn: (category, name) => profileSectionsFor("Race", name, saveRules),
          });
          const classWrap = sectionInto(container, "Class");
          const classOptionsFn = (rulesetId, category) => rulesetOptionNames(rulesetId, category, wizardFieldOptionNames("class", "Class"));
          renderClassStepInto(classWrap, state, {
            optionNamesFn: onlyChosen(classOptionsFn, state.className),
            catalogInfoFn: (keywords, name) => catalogEntryInfo(keywords, name),
            bundleFn: (category, name, rulesetId) => bundleFor(category, name, rulesetId ?? includedRulesetIds(state)),
            summarizeFn: (m) => statModifierSummary(m),
            mechanicsListFn: (category, name) => mechanicsListFor(category, name, state.level),
            subclassDataFn: (name) => liveSubclassData(name),
            updateFn: (key, value) => update(key, value),
            selectableRowsFn: (c, names, opts) => renderPickerRows(c, names, opts),
            creationGroups,
            categorizeChoiceGroup: sharedCategorizeChoiceGroup,
            saveRules,
            sectionIntoFn: sectionInto,
            renderCreationChoiceGroupsFn: renderCreationChoiceGroups,
            inlineChoicesFn: (details, groups) => appendInlineChoiceBullets(details, groups, saveRules),
          });
          const bgWrap = sectionInto(container, "Background");
          const bgOptionsFn = (rulesetId, category) => rulesetOptionNames(rulesetId, category, wizardFieldOptionNames("background", "Background"));
          renderRowListStepInto(bgWrap, state, {
            optionNamesFn: onlyChosen(bgOptionsFn, state.background),
            fallbackNames: [],
            keywords: ["background"],
            category: "Background",
            selectedKey: "background",
            inputLabel: "Background",
            inputPlaceholder: "Type background",
            updateKey: "background",
            updateFn: (key, value) => update(key, value),
            fieldFn: (c, label, control) => field(c, label, control),
            selectableRowsFn: (c, names, opts) => renderPickerRows(c, names, opts),
            catalogInfoFn: (keywords, name) => catalogEntryInfo(keywords, name),
            bundleFn: (category, name, rulesetId) => bundleFor(category, name, rulesetId ?? includedRulesetIds(state)),
            summarizeFn: (m) => statModifierSummary(m),
            mechanicsListFn: (category, name) => profileSectionsFor(category, name, saveRules),
          });
          // The summary box goes up top, before the picks; the button stays
          // at the bottom, where "Finish Setup" belongs after reading them.
          reviewFinishButtonInto(container, reviewDeps());

          // "What You Get Automatically" moved here from the Gear tab. It
          // is a read-only roll-up of every race/class/subclass/background
          // grant at the current level, and Review is where that belongs:
          // the one place on the last step that shows what you actually
          // hold. It is the view that carries the fetched subclass feature
          // text, so before it moved here the only way to read those rules
          // during creation was a tab that no longer exists.
          const innateWrap = sectionInto(container, "What You Get Automatically");
          renderInnateAbilitiesStepInto(innateWrap, innateAbilitySections(state));
        },
      },
    ];


    const wizard = renderStepWizard(steps, creationWizardState, {
      title: "Character Setup",
      // Answers persist through their own saves; only the page
      // position needs persisting here so reopening resumes it.
      onNavigate: () => persistWizardProgressSoon(),
    });
    if (wizard) pageGrid.append(wizard);
  }

  /** Ability-score minimums the character's own feats are waiting on,
   *  as { [abilityId]: [{ feat, score }] } for the Abilities step.
   *
   *  Derived from the feats the character holds, so it stays true as the
   *  ASI/feat step changes without anything having to register itself. */
  function featAbilityNeeds() {
    const out = {};
    const held = character.rules?.feats || [];
    const bundles = held.map((f) => f?.name).map((n) => LINKED_FEAT_BUNDLES.find((b) => b.name === n)).filter(Boolean);
    for (const row of featRowModels(bundles, FEAT_CATALOG.tabs.flatMap((t) => t.entries || []), {
      takenFeats: held,
      abilityScores: character.rules?.abilityScores || {},
    })) {
      for (const s of row.shortfalls || []) {
        (out[s.ability] ||= []).push({ feat: row.name, score: s.score });
      }
    }
    return out;
  }

  /** Adapter: the level guide's ASI step knows only a list of feat NAMES.
   *  This resolves each to its bundle + catalog entry, builds the row
   *  model, and renders the spec'd feat list. The single-select behaviour
   *  of an ASI pick is a radio, not a checkbox — the guide's own
   *  "Feat" mode is one pick, unlike the list on a Feats page where
   *  several can be held. */
  function renderFeatListPicker(container, names, { selectedName, onSelect } = {}) {
    const catalogEntries = FEAT_CATALOG.tabs.flatMap((t) => t.entries || []);
    const bundles = (names || [])
      .map((name) => LINKED_FEAT_BUNDLES.find((b) => b.name === name))
      .filter(Boolean);
    const takenFeats = character.rules?.feats || [];
    // Prerequisite filtering reads what the character actually has, so the
    // list reflects this character rather than the whole catalog.
    const rows = featRowModels(bundles, catalogEntries, {
      takenFeats,
      remaining: Infinity,
      abilityScores: character.rules?.abilityScores || {},
      // The picked race, off the sheet's own Race dropdown — the same read
      // the rest of the guide uses for a class or subclass. This used to
      // read a `state` local that belonged to renderRulesTab() and was
      // never in scope here, so it threw a ReferenceError on every render
      // of this picker — and since the ASI step's DEFAULT mode is "took a
      // feat instead", that blanked the whole Leveling tab for every
      // character levelling into an ASI (every class at 4/8/12/16/19).
      // Racial feat prerequisites are checked against it (featList.js
      // featRequirementStatus), so it cannot simply be left blank.
      raceName: selectedChoiceName("race", "Race") || character.rules?.species || "",
    })
      .map((row) => ({ ...row, taken: row.id === selectedName }));
    renderFeatListInto(container, rows, {
      takenFeats,
      remaining: Infinity,
      doc: document,
      onToggle: (id, isTaken) => {
        // Radio semantics: checking one unchecks the other, so this is
        // a pick, not a toggle.
        if (isTaken) onSelect?.(id);
        else if (id === selectedName) onSelect?.(null);
      },
    });
    // Collapse the checkboxes into a single-choice group, since an ASI
    // buys exactly one feat.
    container.querySelectorAll(".feat-list__check").forEach((input, i) => {
      input.type = "radio";
      input.name = "level-guide-asi-feat";
      input.checked = rows[i]?.id === selectedName;
    });
  }

  function renderRulesetLevelGuide() {
    const primaryName = selectedChoiceName("class", "Class");
    const sheetLevel = currentCharacterLevel();
    // No Level on the sheet means no level to guide (and no "null"
    // pending keys or levelUps["null"] entries) — the tab explains
    // itself via the empty-guide note instead.
    if (sheetLevel == null) return null;
    // Which level this pass is actually about. Normally that is the sheet
    // level — you raised it to N and the walkthrough takes level N. But a
    // level typed straight in (3 -> 5) skips the levels in between, and
    // the walkthrough used to offer only 5, so level 4 was never walked
    // through and nothing said so. When levels are outstanding the pass
    // takes the LOWEST of them instead, and applying it leaves the next
    // one waiting for the pass after.
    //
    // Everything below reads `level` as "the level being taken", which is
    // exactly what the outstanding level is: primaryLevel stays
    // "total minus applied secondaries" for THAT level, so a Fighter
    // mid-jump gets level 4's HP, ASI and spell slots first and level 5's
    // on the following pass - not both computed against the sheet total.
    const recordState = levelingRecordState(sheetLevel, {
      levelUps: character.levelUps,
      createdAtLevel: character.createdAtLevel,
    });
    const level = recordState.levelToProcess;
    const entries = multiclassEntries();
    const primaryLevel = (() => {
      const used = entries.reduce((n, e) => n + (Number(e.levels) || 0), 0);
      return Math.max(1, (level ?? 1) - used);
    })();

    // In-progress answers for this level — see levelingPendingState
    // comment near its declaration for why this can't just be a local.
    // pending.className is which class gains THIS level: the primary
    // class, an existing secondary, or "__new" + pending.newClassName
    // for a brand-new multiclass (level 2+ only).
    const levelKey = String(level);
    // A level with no in-progress picks is a fresh guide open — start
    // at the first step rather than resuming a page left over from a
    // different level's session (the persisted step id only applies
    // while its level still has pending picks).
    const hadPending = Boolean(levelingPendingState[levelKey]);
    const pending = initPendingLevelState(levelingPendingState, levelKey, {
      subclass: selectedChoiceName("subclass", "Subclass"),
      choices: {},
      className: primaryName,
      newClassName: "",
    });
    if (!hadPending) {
      levelingWizardState.index = 0;
      levelingWizardState.stepId = null;
    }
    const validClassNames = [primaryName, ...entries.map((e) => e.name), "__new"].filter(Boolean);
    if (!validClassNames.includes(pending.className)) {
      pending.className = primaryName;
      pending.newClassName = "";
    }
    const takingNewClass = pending.className === "__new";
    const levelClass = takingNewClass ? (pending.newClassName || "") : (pending.className || primaryName);
    const isSecondary = Boolean(levelClass) && levelClass !== primaryName;
    const entryForLevelClass = entries.find((e) => e.name === levelClass);
    // The primary's post-apply level is the total minus applied
    // secondaries — NOT the total itself, which is what `level`
    // holds (the Level field already shows the new total).
    const newClassLevel = levelClass === primaryName
      ? primaryLevel
      : (!levelClass ? (level ?? 1) : (entryForLevelClass ? entryForLevelClass.levels + 1 : 1));
    const selectedSubclass = levelClass === primaryName
      ? selectedChoiceName("subclass", "Subclass")
      : (entryForLevelClass?.subclass || "");
    const plan = levelClass
      ? applyLiveSubclassOverride(
        getLevelUpPlan(character.rules?.rulesetId || character.rulesetId, levelClass, newClassLevel, selectedSubclass),
        { selectedSubclass, level: newClassLevel, liveSubclasses: liveSubclassData(levelClass) }
      )
      : null;
    const contentGroups = [
      ...(level == null ? [] : activeRuleChoiceGroups(flattenGlobalFields(), formulaValues)
        // Equipment-proficiency pickers live on their own creation-tab
        // page (and stay editable afterward right on the sheet's
        // taglists) — they aren't per-level offers, so the level-up
        // Choices step leaves them out. Their picks still apply via
        // activeRuleChoiceGroups at compute time.
        .filter((group) => group.minLevel <= level && !group.key.startsWith("equipprof:"))),
      ...pendingGroupsForLevel(),
    ];

    /** Choice groups from not-yet-applied picks ride along too: a
     *  brand-new multiclass's class groups and a newly chosen
     *  subclass's groups would otherwise never be offered before
     *  Apply. Keys match the post-apply real keys exactly
     *  (multiclass:<Class> for secondaries, the sheet Subclass
     *  dropdown's key for the primary), so picks carry over without
     *  re-prompting; minLevel gating mirrors the sheet's own
     *  filtering. */
    function pendingGroupsForLevel() {
      const out = [];
      if (takingNewClass && pending.newClassName) {
        const raw = bundleFor("Class", pending.newClassName, includedRulesetIdsFor());
        const bundle = raw ? stripSecondaryClassBundle(raw) : null;
        (bundle?.choiceGroups || []).forEach((group, index) => {
          if (group.minLevel && 1 < group.minLevel) return;
          out.push({
            ...normalizeChoiceGroup(group, index, `multiclass:${pending.newClassName}`),
            source: pending.newClassName,
          });
        });
      }
      if (plan?.needsSubclass && pending.subclass) {
        const subBundle = SUBCLASS_BUNDLE_MAP.get(normSubclassKey(pending.subclass));
        let prefix = null;
        if (isSecondary || takingNewClass) {
          // Keyed by subclass name to match the post-apply keys
          // (extraSecondaryBundles keys subclass bundles
          // `multiclass:<Subclass>`); keying by class would orphan
          // these picks at Apply.
          prefix = `multiclass:${pending.subclass}`;
        } else {
          const subclassField = findStarterField("subclass", "Subclass");
          const choice = (subclassField?.choices || []).find((c) => c.text === pending.subclass);
          if (choice) prefix = `${subclassField.id}:${choice.id}`;
        }
        if (prefix) {
          (subBundle?.choiceGroups || []).forEach((group, index) => {
            if (group.minLevel && newClassLevel < group.minLevel) return;
            out.push({
              ...normalizeChoiceGroup(group, index, prefix),
              source: pending.subclass,
            });
          });
        }
      }
      return out;
    }
    const newFeatures = level == null || !levelClass ? [] : classFeatureGrantsAtLevel(levelClass, newClassLevel);
    const needsAsi = level != null && levelClass ? classGrantsAsiAtLevel(levelClass, newClassLevel) : false;
    if (!plan && contentGroups.length === 0) return null;

    const priorLevelUp = character.levelUps?.[String(level)] || {};
    // Any recorded application counts, regardless of which ruleset
    // applied it — re-applying after a source change would otherwise
    // stack HP, ASIs, feats, and multiclass levels a second time.
    if (priorLevelUp.appliedRulesetId) {
      return alreadyAppliedPanel(levelClass || primaryName, level,
        getRuleset(priorLevelUp.appliedRulesetId)?.name || priorLevelUp.appliedRulesetId);
    }

    // Same retired-combo migration as the setup wizard, so stored
    // picks land on the slot groups before pending choices sync from
    // them (post-setup characters never revisit the setup tab).
    const legacyAsi = migrateAsiComboPicks(character.rules.choices || {}, LEGACY_ASI_COMBOS);
    if (legacyAsi.migrated > 0) {
      character.rules.choices = legacyAsi.choices;
      store.saveCharacterFields(character.id, { rules: character.rules }).catch((err) => {
        console.error("Failed to save migrated ASI picks:", err);
      });
    }
    syncPendingChoices(pending, contentGroups, character.rules?.choices || {});

    // Slot trackers show the COMBINED table once multiclassed (or a
    // new class is being taken) — single-class sheets keep the exact
    // per-class plan path from before. Levels here are POST-apply
    // (the level being taken counts): the primary only grows when it
    // is the class being taken, since the Level field already holds
    // the new total.
    const guideSlotChanges = (() => {
      const takingPrimary = !levelClass || levelClass === primaryName;
      const postPrimary = takingPrimary ? primaryLevel : primaryLevel - 1;
      const pendingNew = takingNewClass && pending.newClassName ? [{ name: pending.newClassName, levels: 1 }] : [];
      const slices = [{ name: primaryName, levels: postPrimary }, ...entries.map((e) => ({
        name: e.name,
        levels: e.levels + (!takingNewClass && e.name === levelClass ? 1 : 0),
      })), ...pendingNew]
        .filter((s) => s.name && s.levels > 0)
        .map((s) => {
          const cls = getRulesetClass(character.rules?.rulesetId || character.rulesetId, s.name);
          const sub = s.name === primaryName ? selectedChoiceName("subclass", "Subclass")
            : (entries.find((e) => e.name === s.name)?.subclass || (s.name === pending.newClassName ? pending.subclass : ""));
          return { name: s.name, levels: s.levels, caster: cls?.caster || null, subclass: sub };
        });
      if (!slices.some((s) => s.caster === "full" || s.caster === "half" || s.caster === "pact") && !pendingNew.length) {
        return plan?.slotChanges || [];
      }
      const merged = new Map();
      for (const change of multiclassSlotsFor(slices)) {
        merged.set(change.fieldId, Math.max(merged.get(change.fieldId) || 0, change.options));
      }
      const warlocks = slices.filter((s) => s.caster === "pact");
      for (const s of warlocks) {
        const pact = getLevelUpPlan(character.rules?.rulesetId || character.rulesetId, s.name, Math.max(1, s.levels))?.slotChanges || [];
        for (const change of pact) {
          merged.set(change.fieldId, Math.max(merged.get(change.fieldId) || 0, change.options));
        }
      }
      return [...merged.entries()].map(([fieldId, options]) => ({ fieldId, options, label: slotLabelFor(fieldId) }));
    })();
    const slots = slotsSummary({ slotChanges: guideSlotChanges });
    const feedback = el("p", { class: "level-guide__feedback" });

    const steps = [];

    // Multiclassing starts at total level 2: which class gains this
    // level — the primary, an existing secondary, or a brand-new one
    // (prereq-gated). Level 1 is always the primary class alone.
    // Effective scores (base + fixed racial adds) are what the PHB
    // measures prerequisites against.
    const raceChoiceForScores = (findStarterField("race", "Race")?.choices || [])
      .find((c) => c.id === (findStarterField("race", "Race") || {}).selected);
    const effectiveScores = effectiveScoresFor(
      character.rules?.abilityScores,
      raceChoiceForScores?.bundle
    );
    const multiclassPrereqFor = (toClass) => {
      const reason = multiclassPrereqReason(effectiveScores, primaryName, toClass);
      return reason ? { ok: false, reason } : { ok: true, reason: "" };
    };
    const subclassForLevelClass = (name) => {
      if (!name || name === "__new") return "";
      if (name === primaryName) return selectedChoiceName("subclass", "Subclass");
      return entries.find((e) => e.name === name)?.subclass || "";
    };
    /** Flavor plus what the class gains at the level taking it would
     *  reach — the same "what does this actually do" context creator
     *  rows carry, so staying vs. dipping can be compared at a glance.
     *  "__new" resolves to the pending new-class pick, if any. */
    function classLevelInfo(name) {
      const resolved = name === "__new" ? pending.newClassName : name;
      if (!resolved) return null;
      // Primary take reaches the post-apply primary level (total
      // minus applied secondaries), not the total itself.
      const atLevel = resolved === primaryName
        ? primaryLevel
        : ((entries.find((e) => e.name === resolved)?.levels || 0) + 1);
      const gains = classFeatureGrantsAtLevel(resolved, atLevel)
        .map((g) => g.name)
        .filter(Boolean);
      return {
        flavor: flavorFor(resolved),
        gainsLine: gains.length ? `Gains at ${resolved} ${atLevel}: ${gains.join(", ")}` : null,
      };
    }
    if ((level ?? 1) >= 2 && primaryName) {
      steps.push({
        id: "levelclass",
        title: "Class",
        description: "Which class gains this level? Taking a level in a new class starts multiclassing — it needs 13+ in the right abilities (checked below) and can't start before level 2.",
        isComplete: () => Boolean(levelClass) && (!takingNewClass || Boolean(pending.newClassName)),
        render(container) {
          renderGuideLevelClassStepInto(container, pending, {
            primaryName,
            primaryLevel,
            entries,
            level,
            allClassNames: classNamesIn(includedRulesetIdsFor()),
            eligibilityFn: (name) => multiclassPrereqFor(name),
            subclassForFn: (name) => subclassForLevelClass(name),
            classInfoFn: (name) => classLevelInfo(name),
            selectableRowsFn: (c, names, opts) => renderPickerRows(c, names, opts),
            getInfo: (name) => catalogEntryInfo(["class"], name),
            getMechanicsList: (name) => {
              // What the class gains at the level taking it would
              // reach — same context the creator rows carry.
              const atLevel = name === primaryName ? (level ?? 1)
                : ((entries.find((e) => e.name === name)?.levels || 0) + 1);
              return mechanicsListFor("Class", name, atLevel);
            },
            removeFn: (name) => {
              character.rules.multiclass = (character.rules.multiclass || []).filter((e) => e.name !== name);
              character.rules = normalizeRulesState(character.rules);
              store.saveCharacterFields(character.id, { rules: character.rules }).catch((err) => {
                console.error("Failed to save multiclass removal:", err);
              });
              renderPageGrid();
            },
              confirmFn: (msg) => confirmDialog({ title: "Are you sure?", message: msg, confirmLabel: "Remove", tone: "danger" }),
            onChangeFn: () => renderPageGrid(),
          });
        },
      });
    }

    if (plan?.needsSubclass) {
      steps.push({
        id: "subclass",
        title: "Subclass",
        description: `${levelClass} chooses a subclass at this level. Pick one below — this can't easily be undone once you apply this level's changes, so make sure it's the one you want.`,
        isComplete: () => Boolean(pending.subclass),
        render(container) {
          renderGuideSubclassStepInto(container, pending, plan.subclassChoices, {
            selectableRowsFn: (c, names, opts) => renderPickerRows(c, names, opts),
            getInfo: (name) => catalogEntryInfo(["subclass"], name),
            getMechanicsList: (name) => {
              const bundle = SUBCLASS_BUNDLE_MAP.get(normSubclassKey(name));
              if (!bundle) return [];
              return sharedMechanicsBulletsFor(
                { statModifiers: bundle.statModifiers, featureGrants: bundle.featureGrants },
                newClassLevel,
                {
                  abilityIds: ABILITY_IDS,
                  abilities: ABILITIES,
                  skills: SKILLS,
                  resolveLabel: (id) => resolveFieldById(id)?.label,
                  subclassDisplay: true,
                  includedPacks: includedRulesetIds(character.rules),
                }
              );
            },
            gridFn: () => renderPageGrid(),
          });
        },
      });
    }

    if (needsAsi) {
      steps.push({
        id: "asi",
        title: "Ability Score Improvement",
        description: `${levelClass} gets an Ability Score Improvement at this level. Increase one ability score by 2, two ability scores by 1 each, or take a feat instead.`,
        isComplete: () => {
          if (pending.asiMode === "feat") return Boolean((pending.featChoice || "").trim());
          if (pending.asiMode === "single") return Boolean(pending.asiAbility1);
          return Boolean(pending.asiAbility1 && pending.asiAbility2);
        },
        render(container) {
          renderGuideAsiStepInto(container, pending, {
            abilityIds: ABILITY_IDS,
            rulesetId: character.rules?.rulesetId || character.rulesetId,
            takenFeats: (character.rules?.feats || []).map((f) => f.name),
            featNamesFn: (rulesetId) => rulesetOptionNames(rulesetId, "Feat"),
            catalogInfoFn: (keywords, name) => catalogEntryInfo(keywords, name),
            selectableRowsFn: (c, names, opts) => renderPickerRows(c, names, opts),
            featListFn: (c, names, opts) => renderFeatListPicker(c, names, opts),
            gridFn: () => renderPageGrid(),
            abilityScores: character.rules?.abilityScores,
            modifierFn: (score) => sharedAbilityModifier(score),
            formatFn: (mod) => sharedFormatModifier(mod),
          });
        },
      });
    }

    if (newFeatures.length) {
      steps.push({
        id: "features",
        title: "New Features",
        description: `${levelClass} gains new features at this level — just informational, nothing to fill in here. Read them over, then move on to the next step.`,
        render(container) {
          renderGuideFeaturesStepInto(container, newFeatures);
        },
      });
    }

    if (contentGroups.length) {
      steps.push({
        id: "choices",
        title: "Choices",
        description: "This level offers you a choice — pick from the options below. Check how many selections each group wants; you won't be able to apply this level until they're all satisfied.",
        isComplete: () => contentGroups.every((g) => groupPicksSatisfied(g, pending.choices[g.key], alreadyOwnedSkillIds(g.key))),
        render(container) {
          renderChoiceGroups(container, contentGroups, pending.choices, "rule-choice", () => refreshWizardNav(), alreadyOwnedSkillIds);
        },
      });
    }

    if (slots) {
      const levelRulesetId = character.rules?.rulesetId || character.rulesetId;
      const levelModel = spellcastingModelFor(levelClass, levelRulesetId, {
        infoFor: (name) => getSpellcastingInfo(name),
      });
      /** The level-up spell lines: what THIS level adds, built by the same
       *  machinery as creation's so the two cannot disagree. */
      const levelUpGroups = () => {
        const field = ensureSpellListField();
        return levelUpSpellPickGroups({
          className: levelClass,
          level: newClassLevel,
          previousLevel: newClassLevel - 1,
          abilityScores: character.rules?.abilityScores,
          bundles: [
            bundleFor("Class", levelClass, includedRulesetIds(character.rules)),
            bundleFor("Subclass", pending.subclass || selectedSubclass || "", includedRulesetIds(character.rules)),
          ].filter(Boolean),
          choices: pending.levelUpChoices || {},
          knownItems: field?.items || [],
          preparedItems: field?.preparedItems || [],
          limitFor: (name, lvl, scores) => spellLimitFor(name, lvl, scores),
          availableLevelsFor: (name, lvl) => sharedAvailableSpellLevels(getLevelUpPlan(levelRulesetId, name, lvl)),
          levelByNameFn: (name) => spellLevelByName(name),
          model: levelModel,
        });
      };
      /** The pending level-up picks live apart from the creation picks so
       *  that pruning one - on a class change, say - cannot take the other's
       *  spells off the sheet. */
      const pendingSpellChoices = pending.levelUpChoices || {};
      const setPendingSpellChoices = (next) => {
        pending.levelUpChoices = next;
        refreshWizardNav();
      };
      steps.push({
        id: "spells",
        title: "Spells",
        description: "Your spellcasting improves at this level. Pick what this level ADDS — everything else you already have is untouched.",
        // Multiclass levels enforce this class's own caps against this
        // class's spells only, so another class's spells in the shared
        // Spells Known list can neither satisfy nor block them.
        isComplete: () => {
          if (!secretsSatisfiedFor(levelClass, newClassLevel, pending.subclass || selectedSubclass || "")) return false;
          return levelUpGroups().every((g) => groupPicksSatisfied(g, pendingSpellChoices[g.key] || []));
        },
        render(container) {
          noteInto(container, `This ruleset sets your spell slots to ${slots} at this level.`, "level-guide__summary");
          const field = ensureSpellListField();
          const bundles = [
            bundleFor("Class", levelClass, includedRulesetIds(character.rules)),
            bundleFor("Subclass", pending.subclass || selectedSubclass || "", includedRulesetIds(character.rules)),
          ].filter(Boolean);
          const alwaysPrepared = alwaysPreparedSpellNames(bundles, newClassLevel);
          const groups = levelUpGroups();
          if (!groups.length) {
            noteInto(container, "Nothing new to pick at this level.");
          }
          const list = el("ul", { class: "mechanics-list level-up-spell-lines" });
          for (const group of groups) {
            const isPrepared = group.spellPick.part === "prepared";
            const model = levelModel;
            const spellbook = (field?.items || []).map((it) => (typeof it === "string" ? it : it?.text)).filter(Boolean);
            const preparingFromKnown = isPrepared && model?.preparedFrom === "known";
            const lockReason = isPrepared
              ? preparedLineLock({ preparedFrom: model?.preparedFrom, knownNames: spellbook })
              : null;
            const options = preparingFromKnown
              ? spellbook.map((name) => ({ id: name, name, description: "In your spellbook" }))
              : spellPickDialogOptions({
                spellPick: group.spellPick,
                spellsForLevelFn: (lvl, list) => spellsForLevel(lvl, list),
              });
            const picked = pendingSpellChoices[group.key] || [];
            const overBy = isPrepared
              ? preparedCountOver({
                prepared: (field?.preparedItems || []).concat([...alwaysPrepared]),
                limit: group.maxSelections,
                preparedFrom: model?.preparedFrom,
                cantripsCountAsPrepared: model?.countsCantrips,
                knownItems: field?.items || [],
                levelByNameFn: (n) => spellLevelByName(n),
              })
              : 0;
            list.append(renderLiveBulletItem({
              live: true,
              topic: group.label,
              // The prepared line sits level with its neighbours. It is a
              // peer of the cantrip line and the spellbook line, not a
              // sub-choice of one of them - indenting it implied the
              // prepared spells were chosen from the spells above rather
              // than from the class list the label already names.
              indent: false,
              locked: Boolean(lockReason),
              warning: overBy > 0
                ? `You have ${overBy} more prepared than you can cast at this level — that's fine while you are still setting ability scores.`
                : null,
              lead: [{ text: lockReason || (picked.length ? picked.join(", ") : `Choose ${group.maxSelections}`) }],
              dialogOpener: lockReason || !options.length ? undefined : () => openChoiceDialog({
                title: group.label,
                multi: group.maxSelections !== 1,
                maxSelections: group.maxSelections ?? 1,
                options,
                initialSelected: picked,
                onAccept: (ids) => {
                  const target = ensureSpellListField();
                  if (target) {
                    const written = applySpellPickWrite({
                      part: group.spellPick.part,
                      items: target.items || [],
                      preparedItems: target.preparedItems || [],
                      previous: picked,
                      next: ids || [],
                      heldByOtherPicks: [],
                      alwaysPrepared,
                    });
                    target.items = written.items;
                    target.preparedItems = written.preparedItems;
                  }
                  setPendingSpellChoices({ ...pendingSpellChoices, [group.key]: ids || [] });
                  saveWithStatus("layout", character.layout);
                  renderPageGrid();
                },
              }),
            }));
          }
          container.append(list);
          renderMagicalSecretsInto(container, {
            className: levelClass,
            level: newClassLevel,
            subclassName: pending.subclass || selectedSubclass || "",
          }, {
            magicSecretsUnlockedFn: magicalSecretsUnlocked,
            secretsPickedCountFn: secretsPickedCount,
            bardPlanFn: (name, lvl) => getLevelUpPlan(levelRulesetId, name, lvl),
            availableLevelsFn: sharedAvailableSpellLevels,
            fieldItemsFn: () => ensureSpellListField()?.items || [],
            levelByNameFn: (n) => spellLevelByName(n),
            spellsForLevelFn: (lvl, list) => spellsForLevel(lvl, list),
            ensureFieldFn: () => ensureSpellListField(),
            appendUniqueFn: (f, name) => appendUniqueTextListItem(f, name),
            saveFn: () => saveWithStatus("layout", character.layout),
            gridFn: () => renderPageGrid(),
            multiRowsFn: (c, names, opts) => renderPickerRows(c, names, { ...opts, mode: "multi" }),
            noteFn: noteInto,
            spellcastingInfoFn: (name) => getSpellcastingInfo(name),
            planFn: (id, name, lvl) => getLevelUpPlan(id || levelRulesetId, name, lvl),
          });
        },
      });
    }

    steps.push({
      id: "hp",
      title: "Hit Points",
      description: "Record the hit points you gained this level. It's pre-filled based on your preferred method from Character Setup, but you can always edit it by hand.",
      isComplete: () => {
        const gain = Number.parseInt(pending.hp, 10);
        return Number.isFinite(gain) && gain >= 1;
      },
      render(container) {
        renderGuideHpStepInto(container, pending, {
          conScore: character.rules?.abilityScores?.con,
          dieSize: hitDieFor(levelClass),
          method: character.rules?.hpMethod || "average",
        });
      },
    });

    steps.push({
      id: "notes",
      title: "Notes",
      description: "Jot down anything else worth recording from your source book — new proficiencies, invocations, spells, or other choices that don't fit neatly into the steps above.",
      render(container) {
        renderGuideNotesStepInto(container, pending);
      },
    });

    steps.push({
      id: "review",
      title: "Review & Apply",
      description: "Here's a summary of this level's changes. If everything looks right, hit Apply — this writes your HP, subclass, ability score increase, and notes to the sheet and can't easily be undone.",
      render(container) {
        // Full creator-style review: one line per fact (class, race,
        // background, HP, subclass, ASI/feat, slots) plus every
        // pending choice-group pick, so nothing decided earlier in
        // the guide is invisible at Apply time.
        const effectiveSubclass = pending.subclass
          || (isSecondary ? entryForLevelClass?.subclass : selectedSubclass)
          || "";
        const dieSize = hitDieFor(levelClass);
        const hpMethod = character.rules?.hpMethod || "average";
        const conMod = conModFromScore(character.rules?.abilityScores?.con);
        const sections = levelReviewSectionsFor({
          classLine: levelClass ? `${levelClass} ${newClassLevel}` : "",
          race: selectedChoiceName("race", "Race"),
          background: selectedChoiceName("background", "Background"),
          hp: (pending.hp || "").trim(),
          hpDetail: levelClass ? `d${dieSize} ${hpMethod} ${sharedFormatModifier(conMod)} CON` : "",
          subclass: effectiveSubclass,
          needsAsi,
          asiMode: pending.asiMode,
          featChoice: pending.featChoice,
          asiAbilities: [pending.asiAbility1, pending.asiAbility2],
          slots,
          choiceLines: reviewChoiceLinesFor(contentGroups, pending.choices || {}),
          notes: pending.notes,
        });
        const rows = el("div", { class: "wizard__review-rows" },
          ...(!sections.length
            ? [el("p", { class: "level-guide__summary", text: "Nothing chosen yet." })]
            : sections.map((line) => el("p", { class: "wizard__review-row", text: line }))));
        container.append(rows);
        container.append(feedback);

        const applyBtn = el("button", { type: "button", class: "btn btn--primary", text: `Apply Level ${level} Changes` });
        applyBtn.addEventListener("click", async () => {
          const fail = (msg) => {
            feedback.textContent = msg;
            feedback.classList.add("level-guide__feedback--error");
          };
          const hpGain = Number.parseInt(pending.hp, 10);
          if (!levelClass) {
            fail("Pick which class gains this level before applying it.");
            return;
          }
          // Revalidate every applicable step at Apply time — picks can
          // shift under a persisted Review page (stale resume, source
          // changes mid-guide), and Next-gating alone can't catch that.
          // A broken checker must fail open here, never trap Apply.
          const openStep = steps.find((s) => {
            try {
              return (!s.isApplicable || s.isApplicable())
                && typeof s.isComplete === "function" && s.isComplete() === false;
            } catch {
              return false;
            }
          });
          if (openStep) {
            fail(`"${openStep.title}" still needs decisions — finish it before applying.`);
            return;
          }
          const error = validateLevelApply({
            hpGain,
            contentGroups,
            pendingChoices: pending.choices,
            needsAsi,
            asiMode: pending.asiMode,
            asiAbilities: [pending.asiAbility1, pending.asiAbility2],
            featChoice: pending.featChoice,
            groupSatisfiedFn: (group) => groupPicksSatisfied(group, pending.choices[group.key], alreadyOwnedSkillIds(group.key)),
          });
          if (error) {
            fail(error);
            return;
          }
          if (needsAsi && pending.asiMode !== "feat") {
            const bumps = pending.asiMode === "single"
              ? [{ id: pending.asiAbility1, amount: 2 }]
              : [{ id: pending.asiAbility1, amount: 1 }, { id: pending.asiAbility2, amount: 1 }];
            const over = bumps.find(({ id, amount }) => id && (Number(character.rules?.abilityScores?.[id]) || 10) + amount > 20);
            if (over) {
              fail(`${over.id.toUpperCase()} would pass 20 — ability scores can't exceed 20 from an ASI.`);
              return;
            }
          }
          // Brand-new multiclass levels must pass ability prerequisites
          // (checked live in the picker too — scores can change after,
          // so re-derive them here rather than trusting render time).
          const freshScores = effectiveScoresFor(character.rules?.abilityScores, raceChoiceForScores?.bundle);
          if (takingNewClass && pending.newClassName) {
            const reason = multiclassPrereqReason(freshScores, primaryName, pending.newClassName);
            if (reason) {
              fail(`Can't multiclass into ${pending.newClassName} yet: ${reason} (racial bonuses count).`);
              return;
            }
          }
          const subclassField = findStarterField("subclass", "Subclass");
          const selectedSubclassName = pending.subclass
            || (isSecondary ? entryForLevelClass?.subclass : selectedSubclass)
            || "";
          const subclassChoice = selectedSubclassName && (subclassField?.choices || []).find((choice) => choice.text === selectedSubclassName);
          const slotChanges = guideSlotChanges;
          ensureStandardSpellSlotFields(slotChanges);
          const missingSlots = slotChanges.filter((change) => !findStarterField(change.fieldId, change.label));
          // Secondary-class subclasses live in rules.multiclass, not
          // on the sheet dropdown — bypass the sheet-subclass check
          // for them (the picker's own gating already required a pick).
          const prereqError = checkLevelPrereqs({
            needsSubclass: plan?.needsSubclass,
            hasSubclassField: isSecondary || !!subclassField,
            hasSubclassChoice: isSecondary ? Boolean(pending.subclass) : !!subclassChoice,
            missingSlots,
          });
          if (prereqError) {
            feedback.textContent = prereqError;
            feedback.classList.add("level-guide__feedback--error");
            return;
          }
          // Customized-sheet audit (mirrors Finish Setup): renamed
          // fields resolve by id across tabs; deleted ones are
          // reported after Apply instead of skipped silently. Slot
          // trackers are already covered above (they block Apply).
          const applyIssues = [];
          {
            const needed = [
              { id: null, label: "HP Max", what: "HP Max" },
              { id: null, label: "HP Current", what: "HP Current" },
              { id: null, label: "Features & Traits", what: "Features & Traits" },
            ];
            if (needsAsi && pending.asiMode !== "feat") {
              const ids = pending.asiMode === "single" ? [pending.asiAbility1] : [pending.asiAbility1, pending.asiAbility2];
              ids.filter(Boolean).forEach((id) => needed.push({ id: `${id}Score`, label: id.toUpperCase(), what: `ability score ${id.toUpperCase()}` }));
            }
            missingSetupTargets(flattenAllFieldsAcrossTabs(), needed).forEach((t) => {
              applyIssues.push(`No ${t.what} field on the sheet — left unset.`);
            });
          }

          const before = clone({ layout: character.layout, sheetTabs: character.sheetTabs, levelUps: character.levelUps, rules: character.rules });
          // Everything a revert would need to put back, captured BEFORE
          // anything below changes it. Values, not deltas - see
          // buildRevertRecord for why.
          const hpMaxField = findStarterField(null, "HP Max");
          const hpCurrentField = findStarterField(null, "HP Current");
          const featuresField = findStarterField(null, "Features & Traits");
          const revertHpBefore = {
            max: hpMaxField ? numericFieldValue(hpMaxField) : null,
            current: hpCurrentField ? numericFieldValue(hpCurrentField) : null,
          };
          const revertChoicesBefore = Object.fromEntries(
            contentGroups.map((group) => [group.key, [...(character.rules.choices?.[group.key] || [])]])
          );
          const revertSlotsBefore = slotChanges.map((change) => {
            const field = findStarterField(change.fieldId, change.label);
            return { fieldId: change.fieldId, options: field ? field.options : null };
          });
          const revertMulticlassBefore = (character.rules.multiclass || []).map((e) => ({ ...e }));
          const revertSubclassBefore = subclassField ? (subclassField.selected ?? null) : null;
          const asiIds = needsAsi && pending.asiMode !== "feat"
            ? (pending.asiMode === "single" ? [pending.asiAbility1] : [pending.asiAbility1, pending.asiAbility2]).filter(Boolean)
            : [];
          const revertAbilityBefore = Object.fromEntries(
            asiIds.map((id) => [id, Number(character.rules.abilityScores?.[id] ?? 10)])
          );
          // Record the multiclass take before anything level-gated runs
          // below (syncGrantedListItems resolves per-class levels live).
          if (isSecondary && levelClass) {
            const mc = [...(character.rules.multiclass || [])];
            const existing = mc.find((e) => e.name === levelClass);
            if (existing) {
              existing.levels += 1;
              if (pending.subclass) existing.subclass = pending.subclass;
            } else {
              mc.push({ name: levelClass, levels: 1, subclass: pending.subclass || "" });
            }
            character.rules.multiclass = mc;
          }
          const hpMax = hpMaxField;
          const hpCurrent = hpCurrentField;
          const features = featuresField;
          const notes = (pending.notes || "").trim();
          const featureEntry = notes ? `${levelClass} level ${newClassLevel}: ${notes}` : `${levelClass} level ${newClassLevel}`;
          character.rules.hitDieSize = hitDieFor(levelClass);
          applyBtn.disabled = true;
          feedback.textContent = "Applying changes…";
          feedback.classList.remove("level-guide__feedback--error");
          // Primary-class subclasses live on the sheet dropdown;
          // secondary ones were already stored on the multiclass entry.
          if (subclassChoice && !isSecondary) subclassField.selected = subclassChoice.id;
          character.rules = normalizeRulesState(character.rules);
          contentGroups.forEach((group) => {
            character.rules.choices[group.key] = [...(pending.choices[group.key] || [])];
          });
          slotChanges.forEach((change) => {
            const field = findStarterField(change.fieldId, change.label);
            field.options = change.options;
            syncOptionWidth(field);
          });
          if (hpMax) hpMax.value = String(numericFieldValue(hpMax) + hpGain);
          if (hpCurrent) hpCurrent.value = String(numericFieldValue(hpCurrent) + hpGain);
          let asiSummary = "";
          if (needsAsi && pending.asiMode !== "feat") {
            const syncScoreField = (id) => {
              const target = findStarterField(`${id}Score`, id.toUpperCase());
              if (target) target.value = String(character.rules.abilityScores[id]);
            };
            if (pending.asiMode === "single") {
              asiSummary = applyAsiToScores(character.rules.abilityScores, "single", pending.asiAbility1);
              syncScoreField(pending.asiAbility1);
            } else {
              asiSummary = applyAsiToScores(character.rules.abilityScores, "double", pending.asiAbility1, pending.asiAbility2);
              syncScoreField(pending.asiAbility1);
              syncScoreField(pending.asiAbility2);
            }
          } else if (needsAsi) {
            character.rules.feats = [...(character.rules.feats || []), { name: pending.featChoice, level }];
            asiSummary = `Took the ${pending.featChoice} feat instead of an ASI`;
          }
          appendUniqueTextListItem(features, featureEntry);
          const revertRecord = buildRevertRecord({
            level,
            hpGain,
            hpBefore: revertHpBefore,
            // before/after per score, so a later hand edit reads as
            // "neither" rather than as an ordinary re-rolled total.
            abilities: Object.fromEntries(
              asiIds.map((id) => [id, {
                before: revertAbilityBefore[id],
                after: Number(character.rules.abilityScores?.[id] ?? 10),
              }])
            ),
            featAdded: needsAsi && pending.asiMode === "feat" ? pending.featChoice : null,
            subclass: subclassField && !isSecondary
              ? { fieldId: subclassField.id, before: revertSubclassBefore, after: subclassField.selected ?? null }
              : null,
            choicesBefore: revertChoicesBefore,
            slotsBefore: revertSlotsBefore,
            featureEntry,
            multiclassBefore: revertMulticlassBefore,
            className: levelClass,
            subclassName: selectedSubclassName,
          });
          character.levelUps[String(level)] = buildLevelUpEntry({
            level,
            hpGain,
            className: levelClass,
            subclassName: selectedSubclassName,
            slots,
            featureEntry,
            asiSummary,
            appliedRulesetId: plan?.ruleset?.id || "content",
            prev: character.levelUps[String(level)] || {},
          });
          // On the same entry as the level-up summary, so a character that
          // re-applies the same level keeps one record rather than growing
          // an unreachable second one.
          character.levelUps[String(level)].revert = revertRecord;
          // New subclass/feat picks at this level can carry addItem
          // grants (circle spells, feat spells, …) — gated on the
          // level being applied, not the (still previous) sheet level.
          syncGrantedListItems(level).forEach(({ fieldId, items }) => {
            applyIssues.push(`${items.length} granted ${fieldId === "spellsKnown" ? "spell(s)" : "item(s)"} (${items.join(", ")}) had no list to land in.`);
          });
          mirrorFirstTabLayout();
          unsavedChanges = true;
          // Clear this level's in-progress state BEFORE saving, so the
          // stored snapshot can't resurrect picks that were just
          // applied (and so a debounced progress write scheduled from
          // earlier typing sees the cleared state when it fires).
          // Stashed to restore if the save itself fails, so Apply can
          // still be retried with picks intact.
          const stashedPending = levelingPendingState[levelKey];
          delete levelingPendingState[levelKey];
          levelingWizardState.index = 0;
          levelingWizardState.stepId = null;
          try {
            await store.saveCharacterFields(character.id, { layout: character.layout, sheetTabs: character.sheetTabs, levelUps: character.levelUps, rules: character.rules, levelingPending: snapshotPending(), levelingStepId: null });
            unsavedChanges = false;
            // The level always applies; missing customized-sheet
            // targets are reported loudly, never dropped silently.
            if (applyIssues.length) {
              statusEl.textContent = `Saved with ${applyIssues.length} issue(s) — see notice.`;
            } else {
              statusEl.textContent = "Saved";
            }
            renderAll();
            if (applyIssues.length) {
              showToast(`Level applied, but ${applyIssues.length} thing(s) need attention: ${applyIssues.join(" ")}`, { isError: true });
            }
          } catch (err) {
            console.error("Failed to apply level-up changes:", err);
            character.layout = before.layout;
            character.sheetTabs = before.sheetTabs;
            character.levelUps = before.levelUps;
            character.rules = before.rules;
            if (stashedPending !== undefined) levelingPendingState[levelKey] = stashedPending;
            applyBtn.disabled = false;
            // The DOM still shows the mutated values — rebuild from
            // the restored data so display matches again (the guide
            // reopens at its first step with picks intact). The toast
            // survives the rebuild; inline feedback would not.
            renderAll();
            showToast("The update could not be saved — your picks are intact, please try again.", { isError: true });
          }
        });
        container.append(applyBtn);
      },
    });

    const singleClass = !entries.length && !takingNewClass;
    const guide = renderStepWizard(steps, levelingWizardState, {
      title: singleClass
        ? `${primaryName || "Character"} Level ${level}`
        : `${levelClass || "Class"} ${newClassLevel} · character level ${level}`,
      onNavigate: () => persistWizardProgressSoon(),
    });
    if (guide) {
      // In-step edits (choice toggles, ASI/HP/notes inputs, spell
      // picks) mutate the pending object without re-rendering or
      // saving — catch them all here so closing mid-step keeps the
      // picks, not just the page. Debounced, so a burst of edits is
      // still a single small write.
      ["input", "change", "click"].forEach((type) => guide.addEventListener(type, persistWizardProgressSoon, true));
      guide.append(buildCancelLevelUpButton(level));
    }
    return guide;
  }

  /** The Revert control for the tab, or null when there is nothing to
   *  offer and nothing to explain.
   *
   *  Shown for the HIGHEST recorded level only. Two cases produce no
   *  button: a character with no recorded levels (nothing happened, so
   *  there is no level to undo and no gap to explain), and a character
   *  whose highest recorded level predates reverting — that one gets the
   *  note in place of the button, because a button that cannot work is
   *  worse than a sentence saying why not. */
  function renderRevertControl() {
    const highest = highestRevertableLevel(character.levelUps);
    // The highest level with ANY entry, record or not — a legacy character
    // needs the note, which is about their highest recorded level.
    const highestAny = (() => {
      const levels = Object.keys(character.levelUps || {})
        .map(Number)
        .filter((n) => Number.isFinite(n) && n >= 1);
      return levels.length ? Math.max(...levels) : null;
    })();
    if (highest == null && highestAny == null) return null;
    const level = highest ?? highestAny;
    return buildRevertControl({
      level,
      canRevert: highest != null,
      onRevert: (lvl) => revertLevel(lvl),
    });
  }

  /** "Revert Level N", offered for the highest recorded level only.
   *
   *  Highest because reverting a lower one would leave the levels above it
   *  standing on a base that no longer includes it, and their own records
   *  would then describe a character that never existed.
   *
   *  Restores the BEFORE values in the record rather than subtracting the
   *  gains back out, so a hand edit made since the level-up is replaced by
   *  what was actually there — and, because that silently discards the
   *  edit, the dialog says so and offers a way out.
   *
   *  The whole thing is one commitMutation wrapped in the same
   *  save-then-rollback-or-restore shape Apply uses, so a failed save
   *  leaves the character exactly as it was.
   */
  async function revertLevel(level) {
    const entry = character.levelUps?.[String(level)];
    const record = revertRecordFor(entry);
    if (!record) return;
    const conflicts = revertConflictLines(record, currentRevertState());
    const lines = revertUndoLines(record);
    const ok = await confirmDialog({
      title: `Revert level ${level}?`,
      messageNode: buildRevertDialogBody(lines, conflicts),
      confirmLabel: `Revert level ${level}`,
      tone: "danger",
    });
    if (!ok) return;

    const snapshot = clone({ layout: character.layout, sheetTabs: character.sheetTabs, levelUps: character.levelUps, rules: character.rules });
    // HP: restore, don't subtract. A rolled 1 with a -5 CON modifier lands
    // on a legitimate +0, and only the stored value knows that.
    const hpMax = findStarterField(null, "HP Max");
    const hpCurrent = findStarterField(null, "HP Current");
    if (hpMax && record.hpBefore?.max != null) hpMax.value = String(record.hpBefore.max);
    if (hpCurrent && record.hpBefore?.current != null) hpCurrent.value = String(record.hpBefore.current);
    for (const [id, pair] of Object.entries(record.abilities || {})) {
      const scores = character.rules.abilityScores || {};
      if (pair.before != null) scores[id] = pair.before;
      const field = findStarterField(`${id}Score`, id.toUpperCase());
      if (field && pair.before != null) field.value = String(pair.before);
    }
    if (record.featAdded) {
      character.rules.feats = (character.rules.feats || []).filter((f) => f?.name !== record.featAdded);
    }
    if (record.subclass) {
      const field = resolveFieldById(record.subclass.fieldId) || findStarterField("subclass", "Subclass");
      if (field) field.selected = record.subclass.before ?? null;
    }
    for (const [key, picks] of Object.entries(record.choicesBefore || {})) {
      character.rules.choices[key] = [...picks];
    }
    for (const slot of record.slotsBefore || []) {
      const field = slot.fieldId ? resolveFieldById(slot.fieldId) : null;
      if (field && slot.options != null) {
        field.options = slot.options;
        syncOptionWidth(field);
      }
    }
    character.rules.multiclass = (record.multiclassBefore || []).map((e) => ({ ...e }));
    if (record.featureEntry) {
      const features = findStarterField(null, "Features & Traits");
      if (features && Array.isArray(features.items)) {
        features.items = features.items.filter((t) => t !== record.featureEntry);
      }
    }
    character.rules = normalizeRulesState(character.rules);
    // Forget the level entirely rather than leaving a half-record: a stale
    // entry would read as "recorded" to the level-jump banner while none of
    // its numbers were applied.
    delete character.levelUps[String(level)];
    statusEl.textContent = "Saving…";
    try {
      commitMutation(() => { setCharacterLevel(Math.max(1, level - 1)); }, { render: false, save: false });
      await store.saveCharacterFields(character.id, {
        layout: character.layout,
        sheetTabs: character.sheetTabs,
        levelUps: character.levelUps,
        rules: character.rules,
        levelingPending: snapshotPending(),
      });
      statusEl.textContent = "Saved";
      showToast(`Level ${level} reverted — you're back at level ${Math.max(1, level - 1)}.`);
      renderAll();
    } catch (err) {
      console.error("Failed to revert level-up:", err);
      character.layout = snapshot.layout;
      character.sheetTabs = snapshot.sheetTabs;
      character.levelUps = snapshot.levelUps;
      character.rules = snapshot.rules;
      statusEl.textContent = "⚠ Save failed — see console";
      renderAll();
      showToast(`Level ${level} could not be un-reverted — nothing was changed.`, { isError: true });
    }
  }

  /** What the record would be compared against, read live off the sheet.
   *  Only the fields the record actually mentions are collected, so a
   *  caller that knows nothing about (say) multiclass is never told about
   *  it. */
  function currentRevertState() {
    const hpMax = findStarterField(null, "HP Max");
    const hpCurrent = findStarterField(null, "HP Current");
    const features = findStarterField(null, "Features & Traits");
    const subclassField = findStarterField("subclass", "Subclass");
    return {
      hpMax: hpMax ? numericFieldValue(hpMax) : null,
      hpCurrent: hpCurrent ? numericFieldValue(hpCurrent) : null,
      abilityScores: character.rules?.abilityScores || {},
      feats: character.rules?.feats || [],
      subclassSelected: subclassField ? (subclassField.selected ?? null) : undefined,
      choices: character.rules?.choices || {},
      multiclass: character.rules?.multiclass || [],
      featuresItems: features && Array.isArray(features.items) ? features.items : undefined,
    };
  }

  /** "Cancel this level-up", at the foot of the walkthrough on every
   *  page — not just Review, because the wizard's own Next-gating means
   *  a half-finished level-up is most often abandoned from an early
   *  page, and the button has to be there when they decide to stop.
   *
   *  Undoes the raise the toolbar's Level Up button did (see
   *  onLevelUpClick): back down one level, drop this level's pending
   *  picks, and return to whatever tab the level-up started from. The
   *  picks are the only thing worth asking about — a level-up abandoned
   *  before anything was decided has nothing to lose, so it just goes.
   */
  function buildCancelLevelUpButton(level) {
    const btn = el("button", {
      type: "button",
      class: "btn btn--secondary level-guide__cancel",
      text: "Cancel this level-up",
    });
    btn.addEventListener("click", async () => {
      const key = String(level);
      // Baseline matters: pending choice groups arrive pre-populated
      // with the picks the character ALREADY had, so without it a
      // character with spells on their sheet would be asked about
      // discarding "picks" they never made this level.
      if (pendingLevelHasPicks(levelingPendingState[key], {
        baselineChoices: character.rules?.choices,
      })) {
        const ok = await confirmDialog({
          title: "Cancel this level-up?",
          message: `Your picks for level ${level} will be discarded and you'll drop back to level ${level - 1}.`,
          confirmLabel: "Cancel level-up",
          tone: "danger",
        });
        if (!ok) return;
      }
      delete levelingPendingState[key];
      levelingWizardState.index = 0;
      levelingWizardState.stepId = null;
      const returnTab = character.sheetTabs.find((t) => t.id === levelUpReturnTabId);
      if (returnTab) activeTabId = returnTab.id;
      // Same commitMutation path the raise used, so the drop back down
      // recomputes formulas, slots and granted lists identically.
      commitMutation(() => { setCharacterLevel(level - 1); });
      persistWizardProgress();
    });
    return btn;
  }

  /** Short/Long Rest: restores feature uses by reset type. A long rest
   *  also clears used spell slots and heals to full HP; a short rest
   *  clears Warlock pact slots too (single-class Warlocks — identified
   *  from the level-up plan's own slot fields, so no guessing which
   *  radio is which). One undoable commit so a mis-tap is recoverable. */
  function takeRest(kind) {
    commitMutation(() => {
      const fields = flattenGlobalFields();
      collectResourceGrants(fields, formulaValues).forEach((r) => {
        if (kind === "long" || /short/i.test(r.reset || "")) {
          character.rules.resourceUses[r.key] = r.maximum;
        }
      });
      character.rules = normalizeRulesState(character.rules);
      const pactIds = new Set(pactSlotFieldIds());
      fields.forEach((f) => {
        if (f.fieldType !== "radio" || !/^slots[1-9]$/.test(f.id || "")) return;
        if (kind === "long" || pactIds.has(f.id)) f.selected = null;
      });
      if (kind === "long") {
        const hpMax = findStarterField("hpMax", "HP Max");
        const hpCurrent = findStarterField(null, "HP Current");
        const max = numericFieldValue(hpMax);
        if (hpCurrent && max > 0) hpCurrent.value = String(max);
      }
    });
  }

  /** Slot-radio ids that are Warlock pact slots at each Warlock
   *  class level (primary or multiclassed). Read off the same
   *  level-up plans that size the slot trackers, so this can't drift
   *  from what the sheet actually shows. */
  function pactSlotFieldIds() {
    const ids = [];
    const levels = classLevelsFor(character.rules);
    for (const entry of levels) {
      if ((entry.name || "").toLowerCase() !== "warlock" || entry.levels < 1) continue;
      const plan = getLevelUpPlan(
        character.rules?.rulesetId ?? character.rulesetId,
        "Warlock",
        Math.max(1, entry.levels)
      );
      for (const change of (plan?.slotChanges || [])) {
        if (change.fieldId && !ids.includes(change.fieldId)) ids.push(change.fieldId);
      }
    }
    return ids;
  }

  function renderResourceTrackers() {
    return renderResourceTrackersInto(
      collectResourceGrants(flattenGlobalFields(), formulaValues),
      character.rules,
      {
        normalizeFn: () => { character.rules = normalizeRulesState(character.rules); },
        saveFn: (rules) => saveWithStatus("rules", rules),
        restFn: (kind) => takeRest(kind),
      }
    );
  }

  /** The "at a glance" half of the Leveling tab: every level-gated grant
   *  this character has coming, read straight off the unified model
   *  (js/render/sheet/levelingModel.js). Same model the walkthrough is
   *  built from, so the two can't disagree about what a level gives you.
   *
   *  Gathered from the same bundle sources the sheet applies, including
   *  secondary classes and taken feats, so a multiclassed character sees
   *  all of it rather than just their first class. */
  function renderLevelingGlance() {
    const level = currentCharacterLevel() ?? 1;
    const bundles = [];
    const addBundle = (kind, name) => {
      const bundle = bundleFor(kind, name, currentRulesetId());
      if (bundle) bundles.push({ name, kind, bundle });
    };
    addBundle("Race", selectedChoiceName("species", "Race"));
    addBundle("Background", selectedChoiceName("background", "Background"));
    for (const entry of multiclassEntries()) {
      addBundle("Class", entry.name);
      if (entry.subclass) addBundle("Subclass", entry.subclass);
    }
    for (const feat of character.rules?.feats || []) {
      addBundle("Feat", feat.name);
    }
    const grants = allGrantsIn(bundles, { includedPacks: includedRulesetIds() });
    return renderLevelingGlanceInto(levelingStepsIn(grants, levelingContextFor(character, level)), { currentLevel: level });
  }

  function renderLevelingTab() {
    const currentLevel = currentCharacterLevel();
    const guideEl = renderRulesetLevelGuide();
    // Same read the guide just made, so the banner and the walkthrough can
    // never disagree about which level is being worked on.
    const recordState = currentLevel == null ? null : levelingRecordState(currentLevel, {
      levelUps: character.levelUps,
      createdAtLevel: character.createdAtLevel,
    });
    // The guided panel only exists when the sheet names a class (and
    // level) the rules know — otherwise the tab reads as mysteriously
    // empty, so say what's missing and what still works by hand.
    let emptyGuideNote = null;
    if (!guideEl) {
      if (!selectedChoiceName("class", "Class")) {
        emptyGuideNote = "Pick a Class on your sheet (or finish Character Setup) and a step-by-step level-up guide appears here. The per-level rows below always work by hand.";
      } else if (currentLevel == null) {
        emptyGuideNote = "Set your Level on the sheet and the guide appears here. Until then, the per-level rows below work by hand.";
      } else {
        emptyGuideNote = "No level-up data on file for this class and level — track it in the rows below by hand.";
      }
    }
    renderLevelingTabInto(pageGrid, {
      guideEl,
      emptyGuideNote,
      glanceEl: renderLevelingGlance(),
      resourcesEl: renderResourceTrackers(),
      currentLevel,
      gapBanner: recordState?.hasGap
        ? { text: recordState.bannerText, progressLabel: recordState.progressLabel }
        : null,
      revertEl: renderRevertControl(),
      expandedSet: expandedLevelUpRows,
      gridFn: () => renderPageGrid(),
      rowFn: (level, isCurrent) => renderLevelUpRow(level, isCurrent),
      scrollFn: (level) => {
        requestAnimationFrame(() => {
          pageGrid.querySelector(`[data-level="${level}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      },
    });
  }

  function renderLevelUpRow(level, isCurrent) {
    const data = ensureLevelData(character.levelUps, level);
    return renderLevelUpRowInto(level, isCurrent, data, LEVEL_UP_FIELDS, {
      expandedSet: expandedLevelUpRows,
      toggleFn: (lvl, wasExpanded) => {
        if (wasExpanded) expandedLevelUpRows.delete(lvl);
        else expandedLevelUpRows.add(lvl);
        renderPageGrid();
      },
      inputFn: (rowData, key, value) => {
        unsavedChanges = true;
        rowData[key] = value;
        saveLevelUps();
      },
    });
  }

  function renderAll() {
    // Nothing to show yet but the wizard itself — no tab bar to switch
    // away from it with, and no toolbar chrome (edit mode, undo/redo,
    // the ruleset picker — the wizard has its own) competing with it.
    toolbar.style.display = character.setupComplete ? "" : "none";
    tabsBar.style.display = character.setupComplete ? "" : "none";
    blockFrame.style.display = character.setupComplete ? "" : "none";
    syncLevelUpButton();
    renderTabs();
    renderBlockFrame();
    renderPageGrid();
    // Simple View's sort keys live on the DOM, so they have to be
    // restamped after every rebuild - otherwise switching tabs (or any
    // re-render) would silently drop back to DOM order. The nodes were
    // just recreated, so there is nothing stale to clear first.
    if (simpleView) applySimpleViewOrder(pageGrid, true);
  }

  // Re-assert the stored Simple View preference over the freshly built
  // grid: the class on pageGrid and the chrome hiding are set by
  // applySimpleView, but they have to be applied AFTER renderAll, which is
  // what rebuilds pageGrid's children. `persist: false` because this is a
  // restore of what is already stored, not a change to it - calling this
  // on every load must not write to the character.
  if (simpleView) applySimpleView(true, { persist: false });
  // Then the width rule, which needs the grid MEASURED: a screen too
  // narrow for the grid stacks it whatever the stored preference says,
  // and a screen that fits leaves the stored preference alone.
  syncStackedForWidth();

  function renderTabs() {
    renderTabsInto(tabsBar, {
      tabs: character.sheetTabs,
      activeId: activeTab().id,
      editMode,
      defaultName: (tab, index) => defaultTabName(tab, index),
      onRename: (tab, text) => {
        commitMutation(() => {
          tab.name = text;
        }, { render: false });
        renderBlockFrame();
      },
      onSelect: (tab) => {
        activeTabId = tab.id;
        renderAll();
      },
      onReorder: (draggedId, targetId) => {
        commitMutation(() => {
          const lockedCount = character.sheetTabs.filter(t => t.kind).length;
          const from = character.sheetTabs.findIndex(t => t.id === draggedId);
          const to = character.sheetTabs.findIndex(t => t.id === targetId);
          if (from < lockedCount || to < 0) return;
          const [moved] = character.sheetTabs.splice(from, 1);
          character.sheetTabs.splice(Math.max(lockedCount, to), 0, moved);
        });
      },
      onDelete: (tab) => {
        commitMutation(() => {
          character.sheetTabs = character.sheetTabs.filter(t => t.id !== tab.id);
          activeTabId = character.sheetTabs[0].id;
        });
      },
      onAdd: (anchor) => {
        // The "+" now offers both kinds of tab, since a linked sheet is
        // a tab too and creating one by hand-editing JSON is no way to
        // use the feature.
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        const box = document.createElement("div");
        box.className = "modal-box";
        box.addEventListener("click", (e) => e.stopPropagation());
        const heading = document.createElement("h3");
        heading.textContent = "Add a tab";
        const list = document.createElement("div");
        list.className = "modal-actions";
        const add = (tab) => {
          overlay.remove();
          commitMutation(() => {
            character.sheetTabs.push(tab);
            activeTabId = tab.id;
          });
        };
        const blankBtn = document.createElement("button");
        blankBtn.type = "button";
        blankBtn.className = "btn btn--primary";
        blankBtn.textContent = "Blank tab";
        blankBtn.title = "An editable grid tab like the others";
        blankBtn.addEventListener("click", () => add({
          id: newId(), name: `Tab ${character.sheetTabs.length + 1}`, layout: [],
        }));
        const linkedBtn = document.createElement("button");
        linkedBtn.type = "button";
        linkedBtn.className = "btn";
        linkedBtn.textContent = "Linked sheet";
        linkedBtn.title = "Show another one of your characters here, read-only - a mount or companion";
        linkedBtn.addEventListener("click", () => add({
          id: newId(),
          name: "Linked sheet",
          type: "linkedSheet",
          characterId: null,
          displayFields: [...DEFAULT_LINKED_FIELDS],
          layout: [],
        }));
        list.append(blankBtn, linkedBtn);
        box.append(heading, list);
        overlay.append(box);
        root.append(overlay);
        overlay.addEventListener("click", () => overlay.remove());
      },
    });
  }

  function renderBlockFrame() {
    renderBlockFrameInto(blockFrame, {
      layout: globalLayout(),
      viewOf: (block) => effectiveBlock(block),
      tabsFor: (blockId) => blockTabs(blockId),
      tabCount: character.sheetTabs.length,
      collapsedIds: collapsedBlockIds,
      onToggle: (blockId) => {
        if (collapsedBlockIds.has(blockId)) collapsedBlockIds.delete(blockId);
        else collapsedBlockIds.add(blockId);
        renderBlockFrame();
      },
      onSelectBlock: (blockId) => selectBlockAndFields(pageGrid.querySelector(`[data-node-id="${blockId}"]`)),
      onSelectField: (fieldId) => selectOnly(fieldId),
      fieldDragPayload: (blockId, field, checkboxIndex) =>
        JSON.stringify(
          checkboxIndex === null || checkboxIndex === undefined
            ? { blockId, fieldId: field.id }
            : { blockId, fieldId: field.id, checkboxIndex }
        ),
    });
  }

  /** Draws the visible cell grid as the element's own background —
   *  paints behind all the absolutely-positioned blocks/fields on top
   *  of it, so it only shows through in empty space. Recomputed
   *  whenever cw changes since column width is responsive.
   *
   *  A block's own body draws this same pattern again locally (so
   *  fields inside it have a grid to snap to), but since it's a
   *  separate element the pattern would otherwise restart at ITS OWN
   *  top-left corner — visibly offset from the page grid lines around
   *  it. Passing `originEl` (the page grid) re-anchors the pattern to
   *  that shared origin instead, via getBoundingClientRect — which
   *  means it stays correct regardless of border/padding/nesting, but
   *  also means it only works once `el` is actually laid out in the
   *  DOM (see the post-append pass in renderPageGrid). */
  function applyGridLines(el, cw, originEl = null) {
    applyGridLinesTo(el, cw, GAP_PX, editMode, originEl);
  }

  // --- Block rendering ----------------------------------------------------

  function renderBlockNode(block, cw) {
    const el = renderBlockNodeInto(block, cw, {
      viewOf: (b) => effectiveBlock(b),
      isEdit: editMode,
      gapPx: GAP_PX,
      headerRows: BLOCK_HEADER_ROWS,
      applyRectFn: applyRect,
      applyStyleFn: applyNodeStyle,
      ghostFn: wireGhostDefault,
      ownTextFn: applyTextStyleToOwnText,
      dragHandleFn: buildDragHandle,
      resizeHandleFn: sharedBuildResizeHandles,
      toolbarFn: (b, el) => buildBlockToolbar(b, el),
      fieldNodeFn: (f, parent, w, style) => renderFieldNode(f, parent, w, style),
      dragFn: (el, node, w, onSettled) => wireDrag(el, node, w, {
        gapPx: 10,
        bounds: {},
        isEditMode: () => editMode,
        onSelectBlockOrField: (el, node) => selectOnly(node.id),
        snapshot: () => snapshotForUndo(),
        commit: (fn) => commitMutation(fn),
        settled: () => { settled(); renderAll(); },
        applyRect: applyRect,
        reselect: (el, node) => reselect(el, node),
      }),
      resizeFn: (el, node, w, opts) => wireResize(el, node, w, opts),
      commitFn: (fn, opts) => commitMutation(fn, opts),
      sourceOf: (b) => sourceBlockFor(b),
      frameFn: () => renderBlockFrame(),
      renderAllFn: () => renderAll(),
      persistFn: () => persist(),
    });
    el.classList.toggle("is-hidden-field", !!block.hidden);
    return el;
  }

  function buildBlockToolbar(block, wrapperEl) {
    return buildBlockToolbarInto(block, wrapperEl, {
      styleBtnFn: (b, el) => buildStyleButton(b, el),
      borderBtnFn: (b, el) => buildBorderToggleButton(b, el),
      viewOf: (b) => effectiveBlock(b),
      typeMenuFn: (anchor, onChoose) => openFieldTypeMenu(anchor, onChoose),
      commitFn: (fn, opts) => commitMutation(fn, opts),
      sourceOf: (b) => sourceBlockFor(b),
      // Same description editor fields use, pointed at the block's name
      // instead of a field's label.
      tooltipEditorFn: (b) => openFieldTooltipEditorInto(b, {
        commitFn: (fn, opts) => commitMutation(fn, opts),
        subject: "block",
        nameFn: () => effectiveBlock(b)?.name,
      }),
      defaultSize: DEFAULT_FIELD_SIZE,
      createFieldFn: (opts) => createField(opts),
      hoverFn: (trigger, bar) => wireHoverToolbar(trigger, bar),
    });
  }

  // --- Field rendering ------------------------------------------------------

  function renderFieldNode(field, parentBlock, cw, parentStyle = {}) {
    const el = renderFieldNodeInto(field, parentBlock, cw, parentStyle, {
      isEdit: editMode,
      resizableTypes: RESIZABLE_FIELD_TYPES,
      headerRows: BLOCK_HEADER_ROWS,
      applyRectFn: applyRect,
      applyStyleFn: applyNodeStyle,
      mergeStyleFn: mergeTextStyle,
      innerFn: (fieldEl, f, parent, w) => renderFieldInner(fieldEl, f, parent, w),
      ownTextFn: applyTextStyleToOwnText,
      dragHandleFn: buildDragHandle,
      resizeHandleFn: sharedBuildResizeHandles,
      equationHintFn: (f) => buildEquationHint(f),
      toolbarFn: (f, parent, el) => buildFieldToolbar(f, parent, el),
      dragFn: (el, node, w, onSettled, bounds) => wireDrag(el, node, w, {
        gapPx: 10,
        bounds: bounds || {},
        isEditMode: () => editMode,
        onSelectBlockOrField: (el, node) => selectOnly(node.id),
        snapshot: () => snapshotForUndo(),
        commit: (fn) => commitMutation(fn),
        settled: () => { settled(); renderAll(); },
        applyRect: applyRect,
        reselect: (el, node) => reselect(el, node),
      }),
      resizeFn: (el, node, w, opts) => wireResize(el, node, w, opts),
      renderAllFn: () => renderAll(),
      persistFn: () => persist(),
      queueOverflowFn: (entry) => pendingLabelOverflowChecks.push(entry),
    });
    // Spell-slot trackers with no live slots stay out of the way in
    // play mode — a Fighter sees no slot rows at all, a level-1
    // Wizard sees only 1st-level slots. Edit mode still shows (and
    // can resize) every tracker.
    if (!editMode && field.fieldType === "radio" && /^slots[1-9]$/.test(field.id || "")) {
      const live = Object.prototype.hasOwnProperty.call(spellSlotCounts, field.id)
        ? spellSlotCounts[field.id]
        : 0;
      if (!(live > 0)) el.style.display = "none";
    }
    el.classList.toggle("is-hidden-field", !!field.hidden);
    return el;
  }

  /** Rebuilds just the label+value area of a field (not its outer
   *  wrapper/handles/toolbar) — used both for the initial build and
   *  for the label-position cycle button's FLIP animation. Returns
   *  the label element so the caller can animate it. */
  function renderFieldInner(fieldEl, field, parentBlock) {
    const labelEl = renderFieldInnerInto(fieldEl, field, parentBlock, {
      captionlessTypes: CAPTIONLESS_FIELD_TYPES,
      buildValueFn: (f, onChange) => buildFieldValue(f, onChange),
      commitFn: (fn, opts) => commitMutation(fn, opts),
      frameFn: () => renderBlockFrame(),
      visibilityFn: (f, el) => updateFieldLabelVisibility(f, el),
      growFn: (labelEl, f, el, parent) => growFieldIfLabelOverflows(labelEl, f, el, parent),
      ghostFn: (el, text, commit) => wireGhostDefault(el, text, commit),
      labelInUseFn: (text, f) => isLabelAlreadyInUse(text, f),
      toastFn: (msg, opts) => showToast(msg, opts),
      moneyFn: (f) => maybeAutoRegisterMoneyField(f),
    });
    // The roll trigger escapes .field-inner (which clips overflow as
    // its backstop) and hangs off the grid node itself — otherwise it
    // gets cut off inside cramped fields. Stale copies from a previous
    // inner build (label cycling rebuilds in place) go first.
    fieldEl.querySelectorAll(":scope > .field-roll").forEach((t) => t.remove());
    const trigger = fieldEl.querySelector(":scope > .field-inner > .field-roll-wrap > .field-roll");
    if (trigger) fieldEl.append(trigger);
    return labelEl;
  }

  function updateFieldLabelVisibility(field, labelEl) {
    updateFieldLabelVisibilityInto(field, labelEl);
  }

  function hasVisibleText(html) {
    return sharedHasVisibleText(html);
  }

  function wireGhostDefault(el, defaultText, commit) {
    wireGhostDefaultInto(el, defaultText, commit);
  }

  /** Current numeric modifier for a text field: the live computed
   *  formula value when there is one, else whatever number is typed
   *  in it (non-numeric prose counts as +0). */
  function rollModifierFor(field) {
    if (Number.isFinite(formulaValues[field.id])) return formulaValues[field.id];
    const parsed = floatFromRichText(field.value || "");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function openFieldRollDialog(field, mode) {
    openRollResultDialog({
      fieldLabel: field.label || "Field",
      modifier: rollModifierFor(field),
      initialMode: mode,
      sides: ROLL_SIDES,
      rollFn: (m) => rollCheck({ mode: m, sides: ROLL_SIDES }),
    });
  }

  function buildRollTrigger(field) {
    // The field sits inside a draggable grid node — a click on these
    // buttons is a roll, never the start of a drag or a text edit.
    const roll = (mode) => (e) => { e.stopPropagation(); openFieldRollDialog(field, mode); };
    return el("div", { class: "field-roll", onpointerdown: (e) => e.stopPropagation() },
      el("button", {
        type: "button", class: "field-roll__die", text: "🎲",
        title: `Roll d${ROLL_SIDES} + ${field.label || "field"}`,
        "aria-label": `Roll d${ROLL_SIDES}`, onclick: roll("normal"),
      }),
      el("button", {
        type: "button", class: "field-roll__mode",
        title: `Roll d${ROLL_SIDES} with advantage (higher of two)`,
        html: `<span class="field-roll__full">Advantage</span><span class="field-roll__short">Adv.</span>`,
        onclick: roll("advantage"),
      }),
      el("button", {
        type: "button", class: "field-roll__mode",
        title: `Roll d${ROLL_SIDES} with disadvantage (lower of two)`,
        html: `<span class="field-roll__full">Disadvantage</span><span class="field-roll__short">Disadv.</span>`,
        onclick: roll("disadvantage"),
      }));
  }

  /** Wraps a text field's value element with hover-only d20 controls
   *  (always visible on touch devices) — plain numeric fields only;
   *  prose fields get no trigger. */
  function maybeWrapWithRollControls(valueEl, field) {
    const relevant = isRollRelevant({
      fieldType: field.fieldType,
      value: field.value,
      formulaValue: formulaValues[field.id],
      rollable: field.rollable,
      parseFn: (html) => floatFromRichText(html || ""),
    });
    if (!relevant) return valueEl;
    const wrap = el("div", { class: "field-roll-wrap" }, valueEl, buildRollTrigger(field));
    return wrap;
  }

  function buildFieldValue(field, onValueChange) {
    if (field.fieldType === "text") {
      const valueEl = buildTextValueInto(field, onValueChange, {
        commitFn: (fn, opts) => commitMutation(fn, opts),
        formattedValue: formatComputedValue(formulaValues[field.id]),
      });
      return maybeWrapWithRollControls(valueEl, field);
    }

    if (field.fieldType === "label") {
      return buildLabelValueInto(field, {
        commitFn: (fn, opts) => commitMutation(fn, opts),
        ghostFn: (el, text, commit) => wireGhostDefault(el, text, commit),
      });
    }

    if (field.fieldType === "textarea") {
      return buildTextareaValueInto(field, {
        commitFn: (fn, opts) => commitMutation(fn, opts),
      });
    }

    if (field.fieldType === "textlist") {
      return buildTextListValue(field);
    }

    if (field.fieldType === "taglist") {
      return buildTagListValue(field);
    }

    if (field.fieldType === "dropdown") {
      return buildDropdownValue(field);
    }

    if (field.fieldType === "picture") {
      return buildPictureValue(field);
    }

    if (field.fieldType === "catalog") {
      return buildCatalogValue(field);
    }

    if (field.fieldType === "featureList") {
      return buildFeatureListValue(field);
    }

    if (field.fieldType === "characterlink") {
      return buildCharacterLinkValue(field);
    }

    const effectiveOptions = effectiveOptionCount(field, radioOptionCounts, spellSlotCounts);
    return buildOptionsValueInto(field, effectiveOptions, {
      commitFn: (fn, opts) => commitMutation(fn, opts),
      grantedCheckboxes,
    });
  }

  /** Draggable-to-reorder bulleted list — used by the "textlist" field
   *  type. Each item's own text is independently editable; the row
   *  itself (not the text) is the drag source, so dragging never
   *  fights with placing a text caret.
   *
   *  The spell list IS a textlist, so rather than a second renderer that
   *  would have to keep its own copy of the same list in step, the generic
   *  shell asks its caller for row furniture and a header. Everything below
   *  that is spell-specific lives in spellListChrome(). */
  function buildTextListValue(field) {
    const spellChrome = isSpellListField(field) ? spellListChrome(field) : null;
    return buildTextListValueInto(field, {
      commitFn: (fn, opts) => commitMutation(fn, opts),
      headerFn: spellChrome ? () => spellChrome.header() : null,
      rowExtrasFn: spellChrome ? (name, index) => spellChrome.rowExtras(name, index) : null,
      rowClassFn: spellChrome ? (name) => spellChrome.rowClass(name) : null,
      displayItemsFn: spellChrome ? () => spellChrome.rows() : null,
      removeRowFn: spellChrome ? (name) => spellChrome.removeRow(name) : null,
    });
  }

  /** Whether this field is THE spell list, rather than any other textlist. */
  function isSpellListField(field) {
    if (!field) return false;
    return field.id === "spellsKnown" || /^spells known$/i.test(String(field.label || "").trim());
  }

  /** The spell listing's prepared chrome: the counter, the filter, and each
   *  row's toggle.
   *
   *  Every part of it is suppressed for a class with no prepared list. A
   *  Sorcerer seeing "0 / 0 prepared", a column of dead toggles and a
   *  filter that can only dim spells they do not prepare is worse than
   *  seeing none of it: it implies a prepared list exists and is empty.
   *
   *  Reads `character.rules` and the outer-scope ruleset helpers rather than
   *  the wizard's `state`, because the sheet renders outside the creation
   *  wizard - there is no `state` in this scope.
   *
    *  The filter's state lives in a module-level map rather than in this
    *  closure or the DOM, because the rows re-render on every toggle. */
  function spellListChrome(field) {
    const rules = character.rules || {};
    const levelClass = rules.className || "";
    const level = rules.level || 1;
    const model = spellcastingModelFor(levelClass, currentRulesetId(), {
      infoFor: (name) => getSpellcastingInfo(name),
    });
    const hasPreparedList = Boolean(model?.hasPreparedList);
    const limit = spellLimitFor(levelClass, level, rules.abilityScores);
    const alwaysPrepared = [...alwaysPreparedSpellNames(
      [bundleFor("Class", levelClass, includedRulesetIdsFor()), bundleFor("Subclass", rules.subclass, includedRulesetIdsFor())]
        .filter(Boolean),
      level,
    )];
    // Read once per render. A local `let` would already be back to false by
    // the time the filter's own change handler ran renderPageGrid(), so the
    // checkbox would visibly tick and then tick itself off again - the
    // filter would never hide anything.
    const preparedOnly = preparedOnlyFor(character?.id);

    const spellOf = (name) => {
      const text = typeof name === "string" ? name : name?.text;
      if (!text) return null;
      const level = spellLevelByName(text);
      return level === null ? null : spellsForLevel(level, levelClass).find((s) => s.name === text) || { name: text, level };
    };
    /** Which rows to draw. The shape rules - order, dedupe, and which array
     *  each row came from - live in spellListDisplayRows; this only supplies
     *  this field's data. */
    function rows() {
      return spellListDisplayRows({
        items: field.items || [],
        preparedItems: field.preparedItems || [],
        hasPreparedList,
      });
    }

    const viewOf = (name) => {
      const spell = spellOf(name);
      return spellRowView({
        name: typeof name === "string" ? name : name?.text,
        level: spell?.level ?? null,
        hasPreparedList,
        isPrepared: (field.preparedItems || []).includes(typeof name === "string" ? name : name?.text),
        alwaysPrepared: alwaysPrepared.includes(typeof name === "string" ? name : name?.text),
        isRitual: spellIsRitual(spell),
        showPreparedOnly: preparedOnly,
      });
    };

    return {
      rows,
      removeRow(text) {
        commitMutation(() => {
          field.preparedItems = (field.preparedItems || []).filter((n) => n !== text);
        });
      },
      header() {
        if (!hasPreparedList) return null;
        const counter = preparedCounter({
          prepared: field.preparedItems || [],
          limit: limit?.spells || 0,
          preparedFrom: model?.preparedFrom,
          cantripsCountAsPrepared: model?.countsCantrips,
          alwaysPrepared,
          levelByNameFn: (n) => spellLevelByName(n),
        });
        if (!counter) return null;
        const bar = el("div", { class: "spell-list-chrome" });
        // `aria-live` so the count is announced when a toggle changes it -
        // the number is the only feedback a toggle gives.
        const count = el("span", {
          class: `spell-list-chrome__count${counter.over ? " spell-list-chrome__count--over" : ""}`,
          text: counter.text,
          role: "status",
        });
        bar.append(count);
        if (counter.over) {
          bar.append(el("span", {
            class: "spell-list-chrome__warning",
            text: `${counter.overBy} over your limit — your casting ability may have gone down since you picked these.`,
          }));
        }
        const filterLabel = el("label", { class: "spell-list-chrome__filter" });
        const filter = el("input", { type: "checkbox", checked: preparedOnly });
        filter.addEventListener("pointerdown", (e) => e.stopPropagation());
        filter.addEventListener("change", (e) => {
          e.stopPropagation();
          setPreparedOnlyFor(character?.id, filter.checked);
          renderPageGrid();
        });
        filterLabel.append(filter, " Prepared only");
        bar.append(filterLabel);
        return bar;
      },
      rowClass(name) {
        if (!hasPreparedList) return "";
        const view = viewOf(name);
        const classes = [];
        if (view.dimmed) classes.push("spell-row--unprepared");
        if (view.hidden) classes.push("is-hidden");
        if (view.pressed) classes.push("spell-row--prepared");
        if (view.ritual) classes.push("spell-row--ritual");
        return classes.join(" ");
      },
      rowExtras(name) {
        const text = typeof name === "string" ? name : name?.text;
        const view = viewOf(name);
        const out = [];
        if (view.ritual) {
          out.push(el("span", {
            class: "spell-row__ritual",
            text: "Ritual",
            title: "A ritual spell can be cast without being prepared.",
          }));
        }
        if (!view.hasToggle) return out;
        const btn = el("button", {
          type: "button",
          class: `spell-row__prepared-toggle${view.pressed ? " is-prepared" : ""}`,
          // An accessible NAME, not a bare glyph: a screen reader announcing
          // "button, pressed" for nine identical rows tells the player
          // nothing about which spell they are on.
          "aria-label": view.pressed ? `Unprepare ${text}` : `Mark ${text} prepared`,
          "aria-pressed": String(view.pressed),
          title: view.alwaysPrepared
            ? `${text} is always prepared by your subclass.`
            : (view.pressed ? `Unprepare ${text}` : `Mark ${text} prepared`),
          text: view.pressed ? "◉" : "○",
        });
        if (view.locked) {
          btn.disabled = true;
          btn.classList.add("is-locked");
        } else {
          btn.addEventListener("pointerdown", (e) => e.stopPropagation());
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            // One tap, no confirmation. This is a reversible checkbox, and
            // asking "are you sure" about marking a spell prepared would
            // make the whole listing feel slow.
            const next = togglePreparedSpell({
              prepared: field.preparedItems || [],
              name: text,
              alwaysPrepared,
            });
            if (!next.changed) return;
            commitMutation(() => {
              field.preparedItems = next.prepared;
            });
            renderPageGrid();
          });
        }
        out.push(btn);
        return out;
      },
    };
  }

  function buildTagListValue(field) {
    return buildTagListValueInto(field, grantedTags.get(field.id) || new Set(), {
      commitFn: (fn, opts) => commitMutation(fn, opts),
    });
  }

  function buildCharacterLinkValue(field) {
    return buildCharacterLinkValueInto(field, {
      openFn: openCharacterById,
      listFn: async () => {
        if (typeof store.listMyCharacters !== "function") return [];
        return (await store.listMyCharacters()).filter((c) => c.id !== character.id);
      },
      commitFn: (fn, opts) => commitMutation(fn, opts),
    });
  }


  function buildDropdownValue(field) {
    const select = document.createElement("select");
    select.className = "field-value field-value--dropdown";
    select.addEventListener("pointerdown", (e) => e.stopPropagation());
    populateDropdownSelect(select, field);
    select.addEventListener("change", () => {
      // A full (not {render:false}) commit here on purpose: picking a
      // Class/Race/etc. can change another dropdown's available
      // choices (bundle dropdown-access rules) and other fields'
      // computed values (bundle stat modifiers) — both need the
      // normal full render to actually show up.
      commitMutation(() => {
        field.selected = select.value || null;
        // A new pick can carry addItem grants (e.g. swapping to Oath
        // of Devotion adds its oath spells to Spells Known).
        syncGrantedListItems(currentCharacterLevel());
      });
    });
    return select;
  }

  function populateDropdownSelect(select, field) {
    select.innerHTML = "";
    select.append(el("option", { value: "", text: "—" }));
    const allowed = getAllowedChoiceIds(field, flattenGlobalFields());
    dropdownVisibleChoices(field.choices || [], allowed).forEach((choice) => {
      select.append(el("option", { value: choice.id, text: choice.text }));
    });
    select.value = field.selected || "";
  }

  /** Uploads a freshly-picked data-URL image: compresses it and stores
   *  the compressed Base64 directly in the document. */
  function uploadImageInBackground(dataUrl, apply) {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return;
    // Already compressed by readImageFileInto; just store it
    commitMutation(() => apply(dataUrl));
  }

  /** Reads a File as a data URL. The "might not fit in a single
   *  Firestore document" warning only applies offline (local backend
   *  keeps data URLs) — online images upload to Storage, so there is
   *  effectively no cap to warn about. */
  function readImageFile(file, onLoaded) {
    readImageFileInto(file, store.isLocal ? MAX_IMAGE_BYTES : Infinity, (msg) => showToast(msg), onLoaded);
  }

  function personIconSvgMarkup() {
    return sharedPersonIconMarkup();
  }

  function buildAvatarPlaceholderSvg() {
    return sharedAvatarPlaceholder();
  }

  function clearOtherAvatars(exceptField) {
    clearOtherAvatarsIn(character.sheetTabs, exceptField);
  }

  function buildPictureValue(field) {
    return buildPictureValueInto(field, {
      // Compress to ~30-70KB WebP Base64 and store directly in document.
      readFileFn: (file, onLoaded) => readImageFile(file, (dataUrl) => {
        onLoaded(dataUrl);
      }),
      commitFn: (fn, opts) => commitMutation(fn, opts),
      clearAvatarsFn: (f) => clearOtherAvatars(f),
      placeholderFn: () => buildAvatarPlaceholderSvg(),
      iconMarkup: personIconSvgMarkup(),
      setImageFn: (f, url) => {
        f.imageData = url;
      },
    });
  }

  /** A "catalog" field is just a button — clicking it opens the
   *  player-facing browser (catalogBrowser.js) if it's configured, or
   *  the config popover (openCatalogFieldConfig) if it isn't yet. The
   *  catalog itself lives in Firestore (see catalogCache/store), not
   *  on the field — the field only holds WHICH one (scope + id) and
   *  which of this character's own fields is the money it spends. */
  function buildCatalogValue(field) {
    return buildCatalogValueInto(field, {
      configFn: (f, el) => openCatalogFieldConfig(f, el),
      loadCatalogFn: (scope, id) => store.loadCatalog(scope, id),
      toastFn: (msg, opts) => showToast(msg, opts),
      assignMoneyFn: (f) => autoAssignMoneyFieldIfNeeded(f),
      findFieldFn: (id) => flattenAllFieldsAcrossTabs().find((f) => f.id === id),
      readMoneyFn: (f) => readFieldNumericValue(f),
      browserFn: (opts) => openCatalogBrowser(opts),
      commitFn: (fn, opts) => commitMutation(fn, opts),
    });
  }

  function buildFeatureListValue(field) {
    return buildFeatureListValueInto(grantedFeatures);
  }

  function openCatalogFieldConfig(field, wrapperEl) {
    openCatalogFieldConfigInto(field, wrapperEl, {
      closeFn: () => closeOpenPopovers(),
      catalogs: catalogCache,
      commitFn: (fn, opts) => commitMutation(fn, opts),
      manageFn: () => openCatalogLibraryManager(store, refreshCatalogCache, resolveFieldById),
      assignMoneyFn: (f) => autoAssignMoneyFieldIfNeeded(f),
      moneyGroups: moneyCandidatesByTab(character.sheetTabs),
      positionFn: (pop) => positionPopoverWithinViewport(pop),
      setOpenPopup: (v) => { toolbarWithOpenPopup = v; },
    });
  }

  /** Popover for managing a dropdown field's choice list: add, remove,
   *  drag to reorder, and an Auto-Alphabetize toggle that keeps the
   *  list sorted (and disables manual dragging, since a fixed order
   *  would just get overwritten by the next sort). */
  const MODIFIER_OPS = SHARED_MODIFIER_OPS;

  function ensureBundle(choice) {
    return ensureBundleShape(choice);
  }

  function bundleIsEmpty(bundle) {
    return bundleIsEmptyShape(bundle);
  }

  function effectiveGrantName(field) {
    return effectiveGrantNameFor(field, globalLayout());
  }

  function applyBundleLibraryToChoice(libraryEntry, choice, allFields) {
    const bundle = ensureBundle(choice);
    return applyBundleLibraryToChoiceIn(bundle, libraryEntry, allFields, newId, effectiveGrantName);
  }

  function openDropdownChoicesEditor(field, wrapperEl) {
    openChoicesEditorInto(field, wrapperEl, {
      closeFn: () => closeOpenPopovers(),
      populateSelectFn: (select, f) => populateDropdownSelect(select, f),
      commitFn: (fn, opts) => commitMutation(fn, opts),
      positionFn: (pop) => positionPopoverWithinViewport(pop),
      setOpenPopup: (v) => { toolbarWithOpenPopup = v; },
      libraryCache: bundleLibraryCache,
      applyLibFn: (lib, choice, allFields) => applyBundleLibraryToChoice(lib, choice, allFields),
      flattenFieldsFn: () => flattenGlobalFields(),
      newIdFn: () => newId(),
      bundleEmptyFn: (bundle) => bundleIsEmpty(bundle),
      panelBase: {
        ensureBundleFn: (c) => ensureBundle(c),
        grantNameFn: (f) => effectiveGrantName(f),
        modifierOps: MODIFIER_OPS,
        newIdFn: () => newId(),
      },
    });
  }

  function buildFieldToolbar(field, parentBlock, wrapperEl) {
    const bar = buildFieldToolbarInto(field, parentBlock, wrapperEl, {
      styleBtnFn: (f, el) => buildStyleButton(f, el),
      borderBtnFn: (f, el) => buildBorderToggleButton(f, el),
      captionlessTypes: CAPTIONLESS_FIELD_TYPES,
      cycleFn: (f, parent, el) => cycleLabelPosition(f, parent, el),
      choicesEditorFn: (f, el) => openDropdownChoicesEditor(f, el),
      catalogConfigFn: (f, el) => openCatalogFieldConfig(f, el),
      formulaEditorFn: (target, resolve, onSave, opts) => openFormulaEditor(target, resolve, onSave, opts),
      tooltipEditorFn: (f) => openFieldTooltipEditorInto(f, {
        commitFn: (fn, opts) => commitMutation(fn, opts),
      }),
      resolveFn: resolveFieldById,
      commitFn: (fn, opts) => commitMutation(fn, opts),
      gridFn: () => renderPageGrid(),
      liveSlotCounts: spellSlotCounts,
      syncWidthFn: (f) => syncOptionWidth(f),
      hoverFn: (trigger, bar) => wireHoverToolbar(trigger, bar),
    });
    // The Attacks list fills itself in from weapons, attack cantrips,
    // and racial natural weapons — always as editable text, never
    // auto-managed, so anything it suggests can be fixed by hand.
    if (field.fieldType === "textlist" && field.id === "attacks") {
      bar.append(el("button", {
        type: "button", text: "⚔",
        title: "Suggest attack lines from your weapons, attack cantrips, and natural weapons (skips what's already listed)",
        onclick: (e) => { e.stopPropagation(); suggestAttacksForField(field); },
      }));
    }
    return bar;
  }

  function suggestAttacksForField(field) {
    const num = (id) => (Number.isFinite(formulaValues[id]) ? formulaValues[id] : 0);
    const se = character.rules.startingEquipment;
    let items = [];
try {
  items = resolveStartingEquipmentPick(
    character.rules.className, character.rules.background, se
  ).items || [];
} catch {
      items = [];
    }
    const spellsField = findStarterField("spellsKnown", "Spells Known");
    const raceField = findStarterField("race", "Race");
    const raceChoice = raceField?.choices?.find((c) => c.id === raceField.selected);
    const lines = suggestAttackLines({
      items,
      cantripsKnown: spellsField?.items || [],
      innate: innateAttacksFromGrants(raceChoice?.bundle?.featureGrants),
      existing: field.items || [],
      prof: num("profBonus") || 2,
      strMod: num("strMod"),
      dexMod: num("dexMod"),
      spellMod: num("spellAbilityMod"),
    });
    if (!lines.length) {
      showToast("Nothing new to suggest — pick starting equipment and attack cantrips first, or everything is already listed.");
      return;
    }
    commitMutation(() => {
      if (!Array.isArray(field.items)) field.items = [];
      lines.forEach((line) => {
        if (!field.items.includes(line)) field.items.push(line);
      });
    });
    showToast(`Added ${lines.length} attack${lines.length === 1 ? "" : "s"} — edit any line by hand.`);
  }

  function buildEquationHint(field) {
    return buildEquationHintInto(field, {
      editorFn: (f, resolve, onSave) => openFormulaEditor(f, resolve, onSave),
      resolveFn: resolveFieldById,
      commitFn: (fn, opts) => commitMutation(fn, opts),
      gridFn: () => renderPageGrid(),
    });
  }

  function cycleLabelPosition(field, parentBlock, fieldEl) {
    cycleLabelPositionInto(field, parentBlock, fieldEl, {
      commitFn: (fn, opts) => commitMutation(fn, opts),
      nextPosFn: (pos, positions) => nextLabelPosition(pos, positions),
      positions: LABEL_POSITIONS,
      innerFn: (el, f, parent) => renderFieldInner(el, f, parent),
      growFn: (labelEl, f, el, parent) => growFieldIfLabelOverflows(labelEl, f, el, parent),
      hintFn: (f) => buildEquationHint(f),
    });
  }

  // --- Drag / resize (shared by blocks and fields) ---------------------------
  // Deliberately no collision handling or auto-reflow here — dragging/
  // resizing just snaps to the nearest whole grid cell and commits.
  // Overlapping other blocks/fields is allowed; nothing tries to fix
  // it up automatically.

  function wireDrag(el, node, cw, onSettled, bounds = {}) {
    // :scope > restricts this to el's OWN handle, not any descendant's
    // (a block contains fields, which have their own drag handles too —
    // a plain, unscoped querySelector would find the first FIELD's
    // handle before ever reaching the block's own, since the fields
    // get appended into the DOM before the block's handle does).
    const handle = el.querySelector(":scope > .drag-handle");
    const { maxX = Infinity, maxY = Infinity } = bounds;
    handle.addEventListener("pointerdown", (e) => {
      if (!editMode) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.add("is-dragging");
      // Grabbing something to move it selects it too — a block also
      // pulls in its fields, since moving the block moves them right
      // along with it.
      const isBlock = Array.isArray(node.children);
      if (isBlock) selectBlockAndFields(el); else selectOnly(node.id);
      const before = snapshot();
      const startClientX = e.clientX, startClientY = e.clientY;
      const startX = node.x, startY = node.y;

      function onMove(ev) {
        const dx = cellsDelta(ev.clientX - startClientX, cw, GAP_PX);
        const dy = cellsDelta(ev.clientY - startClientY, cw, GAP_PX);
        const pos = dragPos(startX, startY, dx, dy, { maxX, maxY });
        node.x = pos.x;
        node.y = pos.y;
        applyRect(el, node, cw);
      }
      function onUp() {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        el.classList.remove("is-dragging");
        pushBounded(undoStack, before);
        redoStack.length = 0;
        updateHistoryButtons();
        normalizeTabs();
        persist();
        onSettled(); // rebuilds the DOM (renderAll) — repaints selectedIds
          // (see paintSelection at the end of renderPageGrid) but the old
          // .grid-node elements themselves are gone, so re-select by id
          // below to make sure the RIGHT thing (block+children, or just
          // the field) is what ends up highlighted on the new elements
        if (isBlock) selectBlockAndFields(el); else selectOnly(node.id);
      }
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  function wireResize(el, node, cw, { minW, minH, maxW = Infinity, maxH = Infinity, onCommit }) {
    const handle = el.querySelector(":scope > .resize-handle"); // see note in wireDrag above
    if (!handle) return;
    handle.addEventListener("pointerdown", (e) => {
      if (!editMode) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.add("is-resizing");
      const isBlock = Array.isArray(node.children);

      // Which of this block's own fields (if any) scale ALONGSIDE the
      // block's own resize:
      //  - Shift+resize: all of them — the explicit "yes, resize
      //    everything inside too" gesture.
      //  - A plain resize normally scales nothing but the block
      //    itself... UNLESS some of this block's fields were ALREADY
      //    individually selected before this resize started, in which
      //    case that pre-existing sub-selection is what scales, and
      //    stays selected throughout the drag. That's what makes
      //    "select two fields, then resize the block" a distinct,
      //    meaningful gesture from a bare resize.
      // Captured once here (not re-checked at pointerup, a separate
      // event that could see different modifier keys) so letting go
      // re-applies the same choice this drag started with.
      let scaleFieldIds = [];
      if (isBlock && e.shiftKey) {
        scaleFieldIds = (node.children || []).map((f) => f.id);
        selectBlockAndFields(el);
      } else if (isBlock) {
        const preselected = (node.children || []).map((f) => f.id).filter((id) => selectedIds.has(id));
        if (preselected.length > 0) {
          scaleFieldIds = preselected;
          selectedIds = new Set([node.id, ...preselected]);
          paintSelection();
        } else {
          selectOnly(node.id);
        }
      } else {
        selectOnly(node.id);
      }

      const scaleFields = scaleFieldIds
        .map((id) => (node.children || []).find((f) => f.id === id))
        .filter(Boolean)
        .map((f) => ({ field: f, startX: f.x, startY: f.y, startW: f.w, startH: f.h }));

      const before = snapshot();
      const startClientX = e.clientX, startClientY = e.clientY;
      const startW = node.w, startH = node.h;

      function onMove(ev) {
        const dw = cellsDelta(ev.clientX - startClientX, cw, GAP_PX);
        const dh = cellsDelta(ev.clientY - startClientY, cw, GAP_PX);
        const dims = resizeDims(startW, startH, dw, dh, { minW, minH, maxW, maxH });
        node.w = dims.w;
        node.h = dims.h;
        applyRect(el, node, cw);

        if (scaleFields.length > 0) {
          const ratioW = node.w / startW;
          const ratioH = node.h / startH;
          scaleFields.forEach(({ field, startX, startY, startW: fw, startH: fh }) => {
            const r = scaleFieldRect({ x: startX, y: startY, w: fw, h: fh }, ratioW, ratioH);
            field.x = r.x;
            field.y = r.y;
            field.w = r.w;
            field.h = r.h;
            const fieldEl = el.querySelector(`[data-node-id="${field.id}"]`);
            if (fieldEl) applyRect(fieldEl, field, cw);
          });
        }
      }
      function onUp() {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        el.classList.remove("is-resizing");
        pushBounded(undoStack, before);
        redoStack.length = 0;
        updateHistoryButtons();
        normalizeTabs();
        onCommit();
        if (scaleFieldIds.length > 0) {
          selectedIds = new Set([node.id, ...scaleFieldIds]);
          paintSelection();
          refocusNodeById(node.id);
        } else {
          selectOnly(node.id);
        }
      }
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  function buildDragHandle() {
    return sharedBuildDragHandle();
  }
  function buildResizeHandle() {
    return sharedBuildResizeHandle();
  }

  // --- Popovers: style editor, add-field type menu ---------------------------

  // Tracks which toolbar (if any) currently has a popup open from it —
  // at most one popup is ever open at a time (closeOpenPopovers() below
  // always clears any previous one before a new one opens). While set,
  // that toolbar is exempt from auto-hiding regardless of mouse
  // position, since its popup — which can be positioned well away from
  // both the toolbar and the block — should behave like it already
  // does (stays open until an outside click), not disappear because
  // the mouse wandered away from the trigger.
  let toolbarWithOpenPopup = null;

  function closeOpenPopovers() {
    closeOpenPopoversIn(
      document,
      () => toolbarWithOpenPopup,
      (v) => { toolbarWithOpenPopup = v; }
    );
  }
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".style-popover, .field-type-menu, .node-toolbar button")) {
      const hadPopover = !!document.querySelector(".style-popover, .field-type-menu");
      closeOpenPopovers();
      // A dropdown's bundle editor makes all its edits with
      // {render:false} (so it doesn't lose its place mid-edit — see
      // openDropdownChoicesEditor) — catch up here, once, on whatever
      // popover the person just clicked away from, so a race/class
      // bonus or a newly-restricted dropdown actually shows up.
      if (hadPopover) renderPageGrid();
      // Clicking outside any grid-node deselects — except a sidebar
      // item, which sets its OWN selection via a "click" listener
      // that fires right after this "pointerdown" one, so clearing it
      // here first and then immediately setting it there is fine.
      if (!e.target.closest(".grid-node, .sheet-block-list__line, .sheet-block-list__field")) {
        clearSelectionState();
      }
    }
  });

  /** Keeps a block/field's toolbar visible while the pointer is over
   *  the block/field itself OR the toolbar — with a short grace period
   *  on leaving either, so moving the mouse across the visual gap
   *  between them (the toolbar floats above the block, not flush
   *  against it) doesn't cause it to vanish mid-transit. Also stays
   *  visible unconditionally while toolbarWithOpenPopup points at this
   *  toolbar (see above). This replaces plain CSS :hover, which broke
   *  the instant the pointer crossed that gap. Apply this to any
   *  future toolbar-hosted popup the same way style-popover and
   *  field-type-menu already do — no per-popup logic needed beyond
   *  setting toolbarWithOpenPopup when it opens.
   *
   *  Only one of these toolbars is ever meant to be on screen at once:
   *  activeHoverToolbar tracks whichever one is currently shown, and a
   *  newly-shown toolbar closes it immediately (skipping its own grace
   *  period) rather than letting both stay visible for up to 250ms
   *  while the old one's hide timer runs down — e.g. moving the mouse
   *  from one stat block straight to another used to leave the first
   *  block's menu lingering on screen until its own timeout caught up. */
  let activeHoverToolbar = null;

  function wireHoverToolbar(triggerEl, toolbarEl) {
    wireHoverToolbarInto(triggerEl, toolbarEl, {
      isEditMode: () => editMode,
      scrollWrapper,
      getOpenPopup: () => toolbarWithOpenPopup,
      getActiveToolbar: () => activeHoverToolbar,
      setActiveToolbar: (v) => { activeHoverToolbar = v; },
    });
  }

  /** Positions the group toolbar (see selectionBoundingBox above) at
   *  the selection's top-right corner, just outside it — same idea as
   *  a single node's own toolbar (see wireHoverToolbar's flip-below),
   *  just computed from raw pixel coordinates since this toolbar is
   *  appended straight to pageGrid rather than living inside any one
   *  node's own wrapper. Approximates the toolbar's own width rather
   *  than measuring it, since it's only ever a button or two — close
   *  enough for a small floating control like this. */
  function positionFloatingToolbar(el, rightEdgePx, topEdgePx, bottomEdgePx) {
    positionFloatingToolbarAt(el, rightEdgePx, topEdgePx, bottomEdgePx);
  }

  /** Flips a just-appended popover to open leftward instead of
   *  rightward if it would otherwise overflow off the right edge of
   *  the viewport — the default CSS always opens to the right, which
   *  looks fine until the node it's attached to is in the right half
   *  of a wide sheet. */
  function positionPopoverWithinViewport(pop) {
    positionPopoverWithinViewportAt(pop);
  }

  function buildStyleButton(node, wrapperEl) {
    return buildStyleButtonInto(node, wrapperEl, {
      popoverFn: (n, el) => buildStylePopover(n, el),
      closeFn: () => closeOpenPopovers(),
      positionFn: (pop) => positionPopoverWithinViewport(pop),
      setOpenPopup: (v) => { toolbarWithOpenPopup = v; },
    });
  }

  function stylePopoverDeps() {
    return {
      forEditing: (n) => styleForEditing(n),
      // Background data URLs are compressed and stored directly.
      setValue: (n, k, v) => {
        if (k === "bgImage" && typeof v === "string" && v.startsWith("data:image/")) {
          setNodeStyleValue(n, k, v);
          uploadImageInBackground(v, (url) => {
            commitMutation(() => {
              setNodeStyleValue(n, "bgImage", url);
            });
          });
          return;
        }
        setNodeStyleValue(n, k, v);
      },
      commit: (fn, opts) => commitMutation(fn, opts),
      applyStyle: (el, s) => applyNodeStyle(el, s),
      styleChangeFn: (el, n, change) => applyStyleChange(el, n, change),
      toastFn: (msg) => showToast(msg),
      // No effective size cap online (images upload to Storage); the
      // oversize warning still applies to the offline backend, which
      // keeps data URLs on the document.
      maxImageBytes: store.isLocal ? MAX_BG_IMAGE_BYTES : Infinity,
    };
  }

  function buildStylePopover(node, wrapperEl) {
    return buildStylePopoverInto(node, wrapperEl, stylePopoverDeps());
  }

  function applyStyleChange(wrapperEl, node, { cssProp, cssValue, styleKey, toggle = false, rawValue }) {
    return applyStyleChangeInto(wrapperEl, node, { cssProp, cssValue, styleKey, toggle, rawValue }, {
      forEditing: (n) => styleForEditing(n),
      setValue: (n, k, v) => setNodeStyleValue(n, k, v),
      commit: (fn, opts) => commitMutation(fn, opts),
      applyStyle: (el, s) => applyNodeStyle(el, s),
      descendFn: (el, prop, val) => applyDescendantTextStyle(el, prop, val),
      persistFn: () => persist(),
    });
  }

  function wrapSelectionWithStyle(cssProp, cssValue) {
    sharedWrapSelection(cssProp, cssValue);
  }

  function applyDescendantTextStyle(wrapperEl, cssProp, cssValue) {
    applyDescendantTextStyleTo(wrapperEl, cssProp, cssValue);
  }

  function applyTextStyleToOwnText(wrapperEl, style) {
    applyTextStyleToOwnTextWith(wrapperEl, style);
  }

  function openFieldTypeMenu(anchorBtn, onChoose) {
    openFieldTypeMenuInto(anchorBtn, onChoose, {
      closeFn: () => closeOpenPopovers(),
      positionFn: (menu) => positionPopoverWithinViewport(menu),
      setOpenPopup: (v) => { toolbarWithOpenPopup = v; },
      personIconMarkup: personIconSvgMarkup(),
    });
  }

  // --- Boot + responsive re-render ---------------------------------------

  renderAll();
  // The stacked layout is forced below a width the grid cannot fit, and the
  // grid's own width is measured rather than known, so this has to run once
  // the grid has been laid out - and again whenever that answer could
  // change. Re-deciding here rather than in renderPageGrid keeps the rule in
  // one place: applySimpleView must not be called from inside the render
  // path it is itself changing.
  syncStackedForWidth();
  const onResize = debounce(() => {
    syncStackedForWidth();
    renderPageGrid();
  }, 150);
  window.addEventListener("resize", onResize);

  function hasUnsavedChanges() {
    return unsavedChanges;
  }

  // Covers real browser navigation (tab close, refresh, typing a new
  // URL) — the in-app "← Back" button is a plain DOM swap, not a real
  // navigation, so it doesn't trigger this at all; main.js checks
  // hasUnsavedChanges() itself before leaving for that case.
  const onBeforeUnload = (e) => {
    if (!hasUnsavedChanges()) return;
    e.preventDefault();
    e.returnValue = "";
  };
  window.addEventListener("beforeunload", onBeforeUnload);

  // main.js calls this before swapping this character's DOM out (for
  // another character, or back to the list) — without it, the resize
  // and beforeunload listeners above would just keep piling up, one
  // more per character opened in the same session, each holding onto
  // a whole stale render closure.
  function   destroy() {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("beforeunload", onBeforeUnload);
    // Final flush of wizard resume state (fire-and-forget): picks made
    // seconds before closing would otherwise wait out the debounce and
    // never get written, so reopening would miss the very latest.
    try {
      persistWizardProgress();
    } catch (err) {
      console.error("Failed to save wizard progress on close:", err);
    }
    // Leave the document theme clean for whatever renders next
    // (character list, another character with its own theme).
    applySheetTheme("standard", "dark");
  }

  return { hasUnsavedChanges, destroy };
}

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
//   - Background images are stored as data URLs directly on the
//     character document. Firestore caps a document at 1MB total, so
//     large images will fail to save — there's a warning on upload,
//     but no compression/resizing yet.

import { createStarterLayout, createBlock, createField, findNode, findParentArray, syncOptionWidth, LABEL_POSITIONS, BLOCK_HEADER_ROWS, ARMOR_PROFICIENCIES, WEAPON_PROFICIENCIES, TOOL_PROFICIENCIES, VEHICLE_PROFICIENCIES } from "../data/blockModel.js";
import { contentHeight } from "./gridEngine.js";
import { computeAllFormulas, evaluateFormulaNode, formatComputedValue } from "../data/formula.js";
import { openFormulaEditor } from "./formulaEditor.js";
import { openBundleLibraryManager } from "./bundleLibraryEditor.js";
import { openCatalogLibraryManager } from "./catalogLibraryEditor.js";
import { openCatalogBrowser } from "./catalogBrowser.js";
import { getLevelUpPlan, getRuleset, getRulesetClass, getSpellcastingInfo, listRulesets, listContentPacks, getContentPack, defaultContentPackIds, hitDieFor, multiclassSlotsFor, classNamesIn, subclassesAcrossRulesets, contentIdMatches } from "../data/dnd5e.js";
import { ABILITY_IDS, normalizeRulesState, resolveRulesState, spellLimitFor, classLevelsFor, meetsMulticlassPrereq, effectiveScoresFor, multiclassPrereqReason, includedRulesetIds, primaryRulesetId } from "../data/rulesEngine.js";
import { SUBCLASS_SUPPLEMENT } from "../data/subclassContent.js";
import { stripSecondaryClassBundle } from "../data/contentFixups.js";
import { DEFAULT_CONTENT } from "../data/defaultContent.js";
import { FEAT_BUNDLES, FEAT_CATALOG, FEAT_NAMES } from "../data/featBundles.js";
import { SPELL_CATALOG, WEAPONS_ARMOR_CATALOG, GEAR_CATALOG } from "../data/contentCatalogs.js";
import { RACE_EXTRA_CATALOG_ENTRIES } from "../data/extraRaces.js";
import { flavorFor } from "../data/pickerFlavor.js";
import { portraitArtFor } from "../data/portraitArt.js";
import { SHEET_THEMES, applySheetTheme, normalizeThemeId, normalizeThemeMode } from "../data/themes.js";
import { CLASS_STARTING_EQUIPMENT, BG_STARTING_EQUIPMENT, goldOptionIdFor, slugId, resolveStartingEquipmentPick } from "../data/startingEquipment.js";
import { ABILITIES, SKILLS } from "../data/schema.js";
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
import { debounce, valuesMatch, mergeTextStyle, clone, newId } from "./sheet/sheetHelpers.js";
import {
  CREATION_CHOICE_CATEGORIES as SHARED_CREATION_CHOICE_CATEGORIES,
  categorizeChoiceGroup as sharedCategorizeChoiceGroup,
  statModifierLabel as sharedStatModifierLabel,
  statModifierSummary as sharedStatModifierSummary,
  mechanicsBulletsFor as sharedMechanicsBulletsFor,
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
  buildTextPreview as sharedBuildTextPreview,
  buildLabelPreview as sharedBuildLabelPreview,
  buildTextareaPreview as sharedBuildTextareaPreview,
  openFieldTooltipEditorInto,
  buildCharacterLinkValueInto,
  buildTextlistPreview as sharedBuildTextlistPreview,
  buildDropdownPreview as sharedBuildDropdownPreview,
  buildPicturePreview as sharedBuildPicturePreview,
  buildCatalogPreview as sharedBuildCatalogPreview,
  buildFeatureListPreview as sharedBuildFeatureListPreview,
  buildOptionPreview as sharedBuildOptionPreview,
  openFieldTypeMenuInto,
} from "./sheet/sheetFields.js";
import {
  levelFromMap,
  activeChoiceGroupsFor,
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
  renderSelectableRowsInto,
  renderMultiSelectableRowsInto,
  renderChoiceGroupsInto,
  renderCrossCategoryChoiceInto,
  renderFlatChoiceOptionsInto,
  spellCountByLevel as sharedSpellCountByLevel,
  canLearnMore as sharedCanLearnMore,
  availableSpellLevels as sharedAvailableSpellLevels,
  CATEGORY_FIELD as SHARED_CATEGORY_FIELD,
  catalogEntryInfoIn,
  bundleForIn,
  spellCountByLevel,
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
  bucketGroupsByCategory,
  renderRulesetStepInto,
  renderIdentityStepInto,
  renderClassStepInto,
  renderRowListStepInto,
  renderPreferencesStepInto,
  renderChoicePageStepInto,
  renderSpellsStepInto,
  renderInnateAbilitiesStepInto,
  renderAbilitiesStepInto,
  reviewLinesFor,
  renderReviewStepInto,
  initPendingLevelState,
  syncPendingChoices,
  slotsSummary,
  alreadyAppliedPanel,
  conModFromScore,
  rollHpOnce,
  averageHpOnce,
  levelReviewSummary,
  validateLevelApply,
  renderGuideSubclassStepInto,
  renderGuideLevelClassStepInto,
  renderGuideAsiStepInto,
  renderGuideFeaturesStepInto,
  renderGuideHpStepInto,
  renderGuideNotesStepInto,
  checkLevelPrereqs,
  applyAsiToScores,
  buildLevelUpEntry,
  ABILITY_DESCRIPTIONS as SHARED_ABILITY_DESCRIPTIONS,
  HP_METHOD_OPTIONS as SHARED_HP_METHOD_OPTIONS,
  POINT_BUY_MIN as SHARED_POINT_BUY_MIN,
  POINT_BUY_MAX as SHARED_POINT_BUY_MAX,
  POINT_BUY_BUDGET as SHARED_POINT_BUY_BUDGET,
  wizardFieldOptionNamesIn,
  applyLiveSubclassOverrideToResolved,
  cleanStaleSubclass,
  appendFieldGroup,
} from "./sheet/sheetWizardSteps.js";
import { gridCanvasSize, renderMainGridInto } from "./sheet/sheetRender.js";
import { LAYOUT_PRESETS, applyLayoutPresetTo } from "./sheet/sheetLayouts.js";
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
  buildResizeHandle as sharedBuildResizeHandle,
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
  }
  // Anything that already had a layout before this feature existed
  // never touched the branch above, so it never got setupComplete set
  // at all — treat that as "already set up" rather than dropping
  // existing characters back into the wizard.
  if (character.setupComplete === undefined) character.setupComplete = true;
  normalizeTabs();

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
  // Kept as plain {index} objects (not just a number) so step
  // definitions below can close over and mutate them directly.
  const creationWizardState = { index: 0 };
  const levelingWizardState = { index: 0 };
  // In-progress answers for whichever level's guide is currently open,
  // keyed by level so switching levels doesn't mix them up. Lives out
  // here (not as a local inside renderRulesetLevelGuide) so a value
  // typed on one wizard step survives navigating to another step and
  // back — every Next/Back/step-dot click does a full renderPageGrid(),
  // which would otherwise reset any local variable back to its default.
  // Cleared for a level once that level's changes are actually applied.
  const levelingPendingState = {};
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
  refreshBundleLibraryCache();
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
  // New Info/5e-feats.txt (see js/data/featBundles.js) — the ASI step's
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
  // New Info/5e-spells.txt and 5e-items.txt (see
  // js/data/contentCatalogs.js). The setup/leveling spell picker keys
  // off the catalog whose name mentions "spell"; the equipment
  // catalogs are reference rows for the catalog browser.
  for (const [id, catalog] of [["default-spells", SPELL_CATALOG], ["default-weapons-armor", WEAPONS_ARMOR_CATALOG], ["default-gear", GEAR_CATALOG]]) {
    if (!catalogCache.some((c) => (c.name || "") === catalog.name)) {
      catalogCache = [...catalogCache, { id, scope: "default", ...catalog }];
    }
  }
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

  // --- Toolbar: mode toggle + add-block (edit mode only) --------------
  const { toolbar, modeBtn, undoBtn, redoBtn, addBlockBtn } = buildToolbarShell();
  addBlockBtn.addEventListener("click", () => {
    commitMutation(() => {
      currentLayout().push(createBlock({ name: "New Block", x: 0, y: 0, w: 3, h: 3 }));
    });
  });

  // Toggles the Stat Blocks sidebar closed — mainly useful on
  // narrower screens (see the @media rule for .sheet-block-frame in
  // custom-sheet.css), where it becomes a floating overlay instead of
  // a permanent column, so hiding it gives the grid its full width
  // back. Available at any width, not just narrow ones, since there's
  // no harm in that.
  let sidebarCollapsed = window.innerWidth <= 860; // starts hidden on narrow screens, matching the @media breakpoint below — desktop is unaffected (false, same as before this existed)
  const sidebarToggleBtn = document.createElement("button");
  sidebarToggleBtn.type = "button";
  sidebarToggleBtn.className = "btn";
  sidebarToggleBtn.textContent = "☰ Blocks";
  sidebarToggleBtn.title = "Show/hide the Stat Blocks list";
  sidebarToggleBtn.addEventListener("click", () => {
    sidebarCollapsed = !sidebarCollapsed;
    syncSidebarVisibility();
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
  const displayDetails = document.createElement("details");
  displayDetails.className = "toolbar-display";
  const displaySummary = document.createElement("summary");
  displaySummary.className = "btn";
  displaySummary.textContent = "Display";
  displaySummary.title = "Visual theme, light/dark, screen/print, printing, layout presets";
  const displayPanel = document.createElement("div");
  displayPanel.className = "toolbar-display__panel";
  displayDetails.append(displaySummary, displayPanel);
  toolbar.append(displayDetails);

  function displayRow(labelText, ...controls) {
    const row = document.createElement("div");
    row.className = "toolbar-display__row";
    const lab = document.createElement("span");
    lab.className = "toolbar-display__label";
    lab.textContent = labelText;
    row.append(lab, ...controls);
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
  const rulesetSyncBtn = document.createElement("button");
  rulesetSyncBtn.type = "button";
  rulesetSyncBtn.className = "btn formula-toolbar__btn";
  rulesetSyncBtn.textContent = "↻ Re-apply";
  rulesetSyncBtn.title = "Re-apply included sources' bundles (after importing more, for example)";
  rulesetSyncBtn.addEventListener("click", () => {
    const syncMessage = syncRulesetBundles(includedRulesetIdsFor());
    renderAll();
    if (syncMessage) statusEl.textContent = syncMessage;
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
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = theme.name;
    themeSelect.append(option);
  });
  const effectiveThemeId = () => normalizeThemeId(character.themeId);
  const effectiveThemeMode = () => character.themeMode
    ? normalizeThemeMode(character.themeMode, character.themeId)
    : (character.themeId === "light" || character.sheetMode === "print" ? "light" : "dark");
  themeSelect.value = effectiveThemeId();
  const lightModeLabel = document.createElement("label");
  lightModeLabel.className = "theme-mode-toggle";
  lightModeLabel.title = "Light mode version of this theme";
  const lightModeCheckbox = document.createElement("input");
  lightModeCheckbox.type = "checkbox";
  lightModeCheckbox.checked = effectiveThemeMode() === "light";
  lightModeLabel.append(lightModeCheckbox, document.createTextNode(" Light"));
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

  const modeSelect = document.createElement("select");
  modeSelect.className = "input-group__control";
  modeSelect.style.maxWidth = "150px";
  modeSelect.title = "How you'll mainly use this sheet — changeable anytime here";
  [["screen", "Use on screen"], ["print", "Print out"]].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    modeSelect.append(option);
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
  const layoutPlaceholder = document.createElement("option");
  layoutPlaceholder.value = "";
  layoutPlaceholder.textContent = "Apply a layout…";
  layoutSelect.append(layoutPlaceholder);
  LAYOUT_PRESETS.forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    layoutSelect.append(option);
  });
  layoutSelect.addEventListener("change", () => {
    const preset = LAYOUT_PRESETS.find((p) => p.id === layoutSelect.value);
    layoutSelect.value = "";
    if (!preset) return;
    if (!window.confirm(`Rearrange every tab with the ${preset.name} layout? (Undo restores it.)`)) return;
    commitMutation(() => {
      (character.sheetTabs || []).forEach((tab) => {
        if (Array.isArray(tab.layout)) applyLayoutPresetTo(tab.layout, preset.id);
      });
      mirrorFirstTabLayout();
    });
  });
  displayRow("Layout", layoutSelect);

  const printBtn = document.createElement("button");
  printBtn.type = "button";
  printBtn.className = "btn";
  printBtn.textContent = "Print";
  printBtn.title = "Print this character sheet (or save it as PDF)";
  printBtn.addEventListener("click", () => window.print());
  const displayActions = document.createElement("div");
  displayActions.className = "modal-actions";
  displayActions.append(rulesetSyncBtn, printBtn);
  displayPanel.append(displayActions);

  // Everything else the character-selection page shows on a card
  // (Race, Class, Level, whatever) is NOT intrinsic — name is the
  // only fixed identity field. Instead, drag any field here (from the
  // sidebar, same drag payload it already uses for the grid) to
  // designate it as one of the fields shown on that character's card;
  // its value there always reflects whatever's currently on the sheet.
  // Both drop zones live behind a "Card fields" toggle so the everyday
  // toolbar stays short — most days nobody needs them open.
  const cardZonesWrap = document.createElement("div");
  cardZonesWrap.className = "toolbar-card-zones";
  cardZonesWrap.hidden = true;
  const cardZonesToggle = document.createElement("button");
  cardZonesToggle.type = "button";
  cardZonesToggle.className = "btn";
  cardZonesToggle.textContent = "Card fields";
  cardZonesToggle.title = "Choose which fields show on the character list (and which one counts as Level)";
  cardZonesToggle.addEventListener("click", () => {
    cardZonesWrap.hidden = !cardZonesWrap.hidden;
    cardZonesToggle.classList.toggle("active", !cardZonesWrap.hidden);
  });
  toolbar.append(cardZonesToggle);
  if (!character.cardFieldIds) character.cardFieldIds = [];
  const cardFieldsWrap = document.createElement("div");
  cardFieldsWrap.className = "identity-card-fields";
  cardFieldsWrap.addEventListener("dragover", (e) => {
    if (acceptsFieldDrop(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });
  cardFieldsWrap.addEventListener("drop", (e) => {
    const parsed = parseFieldDropPayload(e);
    if (!parsed) return;
    e.preventDefault();
    if (character.cardFieldIds.includes(parsed.fieldId)) return;
    character.cardFieldIds.push(parsed.fieldId);
    saveWithStatus("cardFieldIds", character.cardFieldIds);
    renderCardFieldChips();
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
  const levelFieldWrap = document.createElement("div");
  levelFieldWrap.className = "identity-card-fields";
  levelFieldWrap.addEventListener("dragover", (e) => {
    if (acceptsFieldDrop(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });
  levelFieldWrap.addEventListener("drop", (e) => {
    const parsed = parseFieldDropPayload(e);
    if (!parsed) return;
    e.preventDefault();
    character.levelFieldId = parsed.fieldId;
    saveWithStatus("levelFieldId", character.levelFieldId);
    renderLevelFieldChip();
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

  const tabsBar = document.createElement("div");
  tabsBar.className = "sheet-tabs";
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
  const workbench = document.createElement("div");
  workbench.className = "sheet-workbench";
  root.append(workbench);

  const blockFrame = document.createElement("aside");
  blockFrame.className = "sheet-block-frame" + (sidebarCollapsed ? " is-collapsed" : "");
  workbench.append(blockFrame);
  syncSidebarVisibility();

  const scrollWrapper = document.createElement("div");
  scrollWrapper.className = "page-grid-scroll";
  workbench.append(scrollWrapper);

  const pageGrid = document.createElement("div");
  pageGrid.className = "page-grid";
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
      readImageFile(imageFile, (dataUrl) => {
        commitMutation(() => {
          const size = DEFAULT_FIELD_SIZE.picture;
          const block = createBlock({ name: "New Block", x, y, w: size.w, h: size.h + BLOCK_HEADER_ROWS });
          const field = createField({ fieldType: "picture", label: "Stat", x: 0, y: 0, w: size.w, h: size.h });
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

  function deleteBlockNode(block) {
    const viewBlock = effectiveBlock(block);
    if ((viewBlock.children || []).length > 0 && !window.confirm(`Delete block "${viewBlock.name}" and everything in it?`)) return;
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
    // applying after setup; Common stays locked everywhere.
    return lockCommonInLanguageGroups([
      ...activeChoiceGroupsFor(fields, currentLevel(valueMap), bundleLevelFor, extraSecondaryBundles()),
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
      extraSecondaryBundles()
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
  function syncGrantedListItems(level) {
    const fields = flattenGlobalFields();
    const grants = collectListItemGrantsIn(fields, level, selectedRuleOptions(fields, formulaValues), selectedFeatBundles(), bundleLevelFor, extraSecondaryBundles());
    grants.forEach(({ fieldId, items }) => {
      let target = findStarterField(fieldId, null);
      if (!target && fieldId === "spellsKnown") target = ensureSpellListField();
      if (!target || target.fieldType !== "textlist") return;
      items.forEach((item) => appendUniqueTextListItem(target, item));
    });
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
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Toggle border";
    btn.textContent = "▢";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleBorderVisibility(node, wrapperEl);
    });
    return btn;
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
   *  a save for doing nothing. */
  function growFieldIfLabelOverflows(labelEl, field, fieldEl, parentBlock) {
    if (!parentBlock) return;
    const maxW = labelMaxWidth(parentBlock, field);
    if (!shouldGrowForLabel(field.w, maxW, labelEl.scrollWidth, labelEl.clientWidth)) return;
    commitMutation(() => {
      growFieldToFitLabel(labelEl, field, fieldEl, parentBlock);
    }, { render: false });
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
  function renderStepWizard(steps, stepState, { title, intro } = {}) {
    return renderStepWizardInto(steps, stepState, { title, intro }, () => renderPageGrid());
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
    // New Info/5e-feats.txt), not per-ruleset library entries — so the
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

  /** Best-effort flavor lookup for the character-creation wizard's
   *  row-list pickers (Race/Class/Subclass/Background) — the
   *  MECHANICAL source of truth for "what's selectable" is always
   *  bundleLibraryCache (see rulesetOptionNames above), but a Catalog
   *  (see catalogLibraryEditor.js) with a matching name, if one's been
   *  imported, supplies the description/portrait shown beside it.
   *  Matches by keyword against the catalog's own name rather than a
   *  stored link, since no such link exists yet — see the "Stuff to
   *  do later" note about wiring these two systems together properly.
   *  Degrades gracefully (name + placeholder icon) when nothing matches. */
  function catalogEntryInfo(keywords, name) {
    const info = catalogEntryInfoIn(catalogCache, keywords, name);
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
   *  order, empty categories omitted. */
  function mechanicsListFor(category, name, level) {
    return sharedMechanicsBulletsFor(bundleFor(category, name, includedRulesetIdsFor()), level, {
      abilityIds: ABILITY_IDS,
      abilities: ABILITIES,
      skills: SKILLS,
      resolveLabel: (id) => resolveFieldById(id)?.label,
    });
  }

  /** Shared row-list UI for the wizard's Race/Class/Subclass/
   *  Background pickers (and reused for catalog browsing elsewhere) —
   *  a portrait (or a placeholder initial when none is on file), a
   *  name, and a description per row, with the entire row clickable
   *  and an obvious selected state. `afterRow(name, rowEl)` lets a
   *  caller inject content right after a particular row — the Class
   *  step uses this to expand a nested subclass list under whichever
   *  class is currently selected. `nested` marks a row (or list) as
   *  belonging to such a sub-list, for the "clearly part of, but
   *  distinct from, its parent" styling. `getMechanics(name)` is
   *  optional — when given, its returned string (see
   *  mechanicsPreviewFor below) renders as a third line under the
   *  description, so "what does this actually do" is visible before
   *  picking, not just its flavor text. */
  function renderSelectableRows(container, names, opts = {}) {
    return renderSelectableRowsInto(container, names, opts);
  }

  /** Every language the character already knows at Setup time:
   *  Common (always) plus fixed grants and picks so far. Shown above
   *  the pickers even when there's nothing left to choose, so the page
   *  never reads empty. */
  function knownLanguagesFor(state) {
    const seen = new Set();
    const known = [];
    const take = (name, locked) => {
      const clean = String(name || "").trim();
      const key = clean.toLowerCase();
      if (!clean || seen.has(key)) return;
      seen.add(key);
      known.push({ name: clean, locked });
    };
    take("Common", true);
    const isLanguageField = (id) => /language/i.test(id || "")
      || /language/i.test(resolveFieldById(id)?.label || "");
    creationFixedBundles(state).forEach((bundle) => {
      (bundle?.statModifiers || []).forEach((mod) => {
        if (mod.op === "grantTag" && mod.value && isLanguageField(mod.targetFieldId)) take(mod.value, true);
      });
    });
    const groups = creationChoiceGroupsFor(state).filter((g) => categorizeChoiceGroup(g) === "languages");
    const store = character.rules.choices || {};
    groups.forEach((group) => {
      const all = [...(group.options || []), ...((group.categories || []).flatMap((c) => c.options || []))];
      (store[group.key] || []).forEach((id) => {
        const opt = all.find((o) => o.id === id);
        if (opt?.name) take(opt.name, false);
      });
    });
    return known;
  }

  function renderKnownLanguagesInto(container, state) {
    const head = document.createElement("p");
    head.className = "wizard__section-label";
    head.textContent = "Known Languages";
    container.append(head);
    const chips = document.createElement("div");
    chips.className = "taglist-chips";
    knownLanguagesFor(state).forEach(({ name, locked }) => {
      const chip = document.createElement("span");
      chip.className = "taglist-chip" + (locked ? " taglist-chip--granted" : "");
      if (locked && name !== "Common") chip.title = "Granted by your race, class, or background";
      if (name === "Common") chip.title = "Known by everyone — free, never uses picks";
      chip.textContent = name;
      chips.append(chip);
    });
    container.append(chips);
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
  const CREATION_CHOICE_CATEGORIES = SHARED_CREATION_CHOICE_CATEGORIES;

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
      return FEAT_BUNDLES.find((entry) => norm(entry.name) === norm(name)) || null;
    }
    for (const id of lookupIds) {
      const fromLibrary = (bundleLibraryCache || []).find((entry) =>
        contentIdMatches(entry.rulesetId, id)
        && norm(entry.category) === norm(category) && norm(entry.name) === norm(name));
      if (fromLibrary) return fromLibrary;
    }
    return bundleForIn(category, name, lookupIds[0] || null, bundleLibraryCache, starterLookup);
  }

  function creationChoiceGroupsFor(state) {
    // Choice groups resolve against EVERY included source, not just
    // the primary — a Xanathar-tagged bundle's picks surface whenever
    // that source is checked, even with Homebrew primary.
    const lookup = (category, name) => bundleFor(category, name, includedRulesetIds(state));
    return lockCommonInLanguageGroups(creationChoiceGroupsForState(state, lookup));
  }

  /** Common is known by default and can't be changed — applied
   *  everywhere language groups surface, creation and post-setup
   *  alike (shared pure helper, tested in smoke-imports). */
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
   *  Background, one section per source, for the Innate Abilities
   *  reference step. Picks made on other pages are decisions, not
   *  innate abilities, so only fixed grants appear here. */
  function innateAbilitySections(state) {
    const bundles = creationFixedBundles(state);
    const names = [state.species, state.className, state.subclass, state.background];
    const labels = ["Race", "Class", "Subclass", "Background"];
    const level = Number.isFinite(state.level) ? state.level : Infinity;
    return labels
      .map((label, i) => ({
        source: names[i] ? `${label}: ${names[i]}` : label,
        // Only grants at or below the chosen level — anything later
        // belongs to the Leveling tab, not here. Grants without a
        // level gate always show.
        features: (((bundles[i] || {}).featureGrants || [])
          .filter((g) => !g.minLevel || g.minLevel <= level)
          .map((g) => ({ name: g.name, description: g.description }))),
      }))
      .filter((section) => section.features.length);
  }

  /** Spell picks complete for the given class/level: every available
   *  spell level is at its cantrips/spells cap. Non-casters (or a
   *  missing limit) are trivially complete. */
  function spellPicksComplete(className, level) {
    if (!getRulesetClass(character.rules?.rulesetId, className)?.caster) return true;
    const limit = spellLimitFor(className, level, character.rules?.abilityScores);
    if (!limit) return true;
    const field = findStarterField("spellsKnown", "Spells Known");
    const known = new Set(field?.items || []);
    const counts = sharedSpellCountByLevel(known, (n) => spellLevelByName(n));
    const plan = getLevelUpPlan(character.rules?.rulesetId, className, level);
    return sharedAvailableSpellLevels(plan).every(
      (lvl) => !sharedCanLearnMore(lvl, limit, counts.cantrips, counts.spells)
    );
  }

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

  function renderCrossCategoryChoice(container, group, choicesStore, rerender, onChange) {
    return renderCrossCategoryChoiceInto(container, group, choicesStore, rerender, onChange);
  }

  function renderFlatChoiceOptions(choiceGroup, group, selected, owned, choicesStore, namePrefix, rerender, onChange) {
    return renderFlatChoiceOptionsInto(choiceGroup, group, selected, owned, choicesStore, namePrefix, rerender, onChange);
  }

  function renderMultiSelectableRows(container, names, opts = {}) {
    return renderMultiSelectableRowsInto(container, names, opts);
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

  function renderSpellPicker(container, { rulesetId, className, level }) {
    renderSpellPickerInto(container, { rulesetId, className, level }, {
      spellcastingInfoFn: (name) => getSpellcastingInfo(name),
      ensureFieldFn: () => ensureSpellListField(),
      planFn: (id, name, lvl) => getLevelUpPlan(id, name, lvl),
      limitFn: (name, lvl) => spellLimitFor(name, lvl, character.rules?.abilityScores),
      levelByNameFn: (name) => spellLevelByName(name),
      spellsForLevelFn: (lvl, name) => spellsForLevel(lvl, name),
      appendUniqueFn: (field, name) => appendUniqueTextListItem(field, name),
      saveFn: () => saveWithStatus("layout", character.layout),
      gridFn: () => renderPageGrid(),
      multiRowsFn: (c, names, opts) => renderMultiSelectableRows(c, names, opts),
    });
  }

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
    const pickWrap = document.createElement("div");
    pickWrap.className = "wizard__subsection";
    container.append(pickWrap);
    const pickableGroups = [];
    groups.forEach((group) => {
      const owned = ownedSkillIdsFrom(creationFixedBundles(state), siblingGroups(), group.key);
      const pickable = group.options.filter((o) => !optionIsOwned(o, owned));
      const granted = group.options.filter((o) => optionIsOwned(o, owned));
      if (!pickable.length) {
        const note = document.createElement("p");
        note.className = "leveling-tab__intro";
        if (granted.length) {
          note.textContent = `${group.category} — already granted: ${granted.map((o) => o.name).join(", ")}.`;
        } else {
          note.textContent = `As a ${who} you have no proficiencies in ${group.category}.`;
        }
        container.append(note);
        return;
      }
      pickableGroups.push(group);
    });
    if (pickableGroups.length) renderCreationChoiceGroups(pickWrap, pickableGroups, saveRules, state);
    else pickWrap.remove();
  }

  /** Starting Equipment tab: class package variants (or the gold)
   *  plus the background's fixed package for reference. The pick is
   *  stored on rules.startingEquipment and applied once at Finish
   *  Setup (items to Inventory, gold to GP). */
  function renderStartingEquipmentStepInto(container, state, saveRules) {
    const entry = CLASS_STARTING_EQUIPMENT[state.className];
    if (!entry) {
      const note = document.createElement("p");
      note.className = "leveling-tab__intro";
      note.textContent = "Pick a class first — its starting equipment packages will show up here.";
      container.append(note);
    } else {
      const current = character.rules.startingEquipment?.classOptionId || null;
      const allOptions = [
        ...entry.options.map((opt) => ({ id: opt.id, label: opt.label, detail: opt.items.join(" · ") })),
        { id: goldOptionIdFor(state.className), label: `Take ${entry.gold.gp} gp instead`, detail: `Fixed average of your starting wealth roll (${entry.gold.formula}). Use this to buy gear yourself.` },
      ];
      allOptions.forEach((opt) => {
        const row = document.createElement("label");
        row.className = "level-guide__choice-option";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "starting-equipment";
        input.value = opt.id;
        input.checked = current === opt.id;
        input.addEventListener("change", () => {
          character.rules.startingEquipment = { classOptionId: opt.id };
          saveRules();
          refreshWizardNav();
        });
        const text = document.createElement("span");
        text.textContent = opt.label;
        row.append(input, text);
        const detail = document.createElement("span");
        detail.className = "level-guide__choice-description";
        detail.textContent = opt.detail;
        row.append(detail);
        container.append(row);
      });
    }
    const bg = BG_STARTING_EQUIPMENT[state.background];
    if (bg && state.background) {
      const note = document.createElement("p");
      note.className = "leveling-tab__intro";
      note.textContent = `Your background also grants (added automatically): ${bg.items.join(", ")}${bg.gp ? `, plus ${bg.gp} gp` : ""}.`;
      container.append(note);
    }
  }

  /** Applies the Starting Equipment pick once at Finish Setup:
   *  package items to the Inventory list, gold to GP. Guarded so a
   *  second finish can't duplicate everything. */
  function applyStartingEquipment() {
    const se = character.rules.startingEquipment;
    if (!se || se.applied) return;
    const itemsField = findStarterField(null, "Items");
    const gpField = findStarterField(null, "GP");
    const { items, gp } = resolveStartingEquipmentPick(
      character.rules.className, character.rules.background, se.classOptionId
    );
    if (itemsField) items.forEach((item) => appendUniqueTextListItem(itemsField, item));
    if (gpField && gp > 0) {
      gpField.value = String((Number.parseInt(gpField.value, 10) || 0) + gp);
    }
    character.rules.startingEquipment = { ...se, applied: true };
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
      const field = createField({ fieldType: "radio", label: change.label, x: Number(match[1]) - 6, y: 2, w: 1, h: 1 });
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
    const classField = findStarterField("class", "Class");
    const speciesField = findStarterField("species", "Species") || findStarterField("race", "Race");
    const backgroundField = findStarterField("background", "Background");
    const levelField = findStarterField("level", "Level");
    const subclassField = findStarterField("subclass", "Subclass");
    const choose = (target, value) => {
      chooseTargetValue(target, value, newId);
    };
    choose(classField, character.rules.className);
    choose(speciesField, character.rules.species);
    choose(backgroundField, character.rules.background);
    choose(subclassField, character.rules.subclass);
    if (levelField) levelField.value = String(character.rules.level);
    ABILITY_IDS.forEach((id) => {
      const target = findStarterField(`${id}Score`, id.toUpperCase());
      if (target) target.value = String(character.rules.abilityScores[id]);
    });
    (resolved.plan?.slotChanges || []).forEach((change) => {
      const target = findStarterField(change.fieldId, change.label);
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
    syncGrantedListItems(character.rules.level);
    // Starting equipment pick (once — guarded against double-finish).
    applyStartingEquipment();
    mirrorFirstTabLayout();
    // This is what actually finishes character creation: once synced,
    // there's nothing left for the Character-setup tab to do, so it's
    // dropped entirely (see normalizeTabs) and Leveling takes over from
    // here — matches Shawn's ask to not keep the wizard tab around
    // afterward.
    character.setupComplete = true;
    normalizeTabs();
    const levelingTab = character.sheetTabs.find((tab) => tab.kind === "leveling");
    if (levelingTab) activeTabId = levelingTab.id;
    // Keep the top-level mirror in sync with the canonical rules copy.
    character.rulesetId = character.rules.rulesetId;
    await store.saveCharacterFields(character.id, { rules: character.rules, rulesetId: character.rules.rulesetId, layout: character.layout, sheetTabs: character.sheetTabs, setupComplete: true });
    statusEl.textContent = "Saved";
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
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const box = document.createElement("div");
    box.className = "modal-box coach-note";
    box.addEventListener("click", (e) => e.stopPropagation());
    const heading = document.createElement("h3");
    heading.textContent = "Character ready — three things to know";
    const list = document.createElement("ul");
    [
      "Customize Sheet (toolbar) rearranges anything — drag, resize, restyle. This layout is just the starter.",
      "The Leveling tab walks you through every level-up when the time comes.",
      "Hover any number field to roll it, with Advantage/Disadvantage. Touch screens show the dice always.",
    ].forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      list.append(li);
    });
    const row = document.createElement("div");
    row.className = "modal-actions";
    const done = document.createElement("button");
    done.type = "button";
    done.className = "btn btn--primary";
    done.textContent = "Got it";
    const close = () => {
      try { window.localStorage.setItem(key, "1"); } catch { /* private mode — show again next time */ }
      overlay.remove();
    };
    done.addEventListener("click", close);
    overlay.addEventListener("click", close);
    row.append(done);
    box.append(heading, list, row);
    overlay.append(box);
    document.body.append(overlay);
    done.focus();
  }

  function renderRulesTab() {
    const state = character.rules = normalizeRulesState(character.rules);
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
      saveRules();
      renderPageGrid();
    };

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
    // currently picked, bucketed into the wizard's new Spells/
    // Languages/Equipment/Feats/Proficiencies pages — see
    // creationChoiceGroupsFor and categorizeChoiceGroup above.
    const creationGroups = creationChoiceGroupsFor(state);
    const creationGroupsByCategory = bucketGroupsByCategory(creationGroups, CREATION_CHOICE_CATEGORIES, categorizeChoiceGroup);
    function wizardUnavailableMessage() {
      return wizardUnavailableMessageFor(state);
    }

    const steps = [
      {
        id: "ruleset",
        title: "Ruleset & Content",
        description: "Pick the game system (ruleset), then check every content book your table uses. Book options combine on later pages; each book's options are only visible while it's checked.",
        isComplete: () => includedRulesetIds(state).length > 0 && Boolean(primaryRulesetId(state)),
        render(container) {
          renderRulesetStepInto(container, state, {
            listRulesetsFn: () => listRulesets(),
            listContentPacksFn: (rid) => listContentPacks(rid),
            defaultContentPackIdsFn: (rid) => defaultContentPackIds(rid),
            includedIds: includedRulesetIds(state),
            primaryId: primaryRulesetId(state),
            hasDownstreamChoices: !!(state.species || state.className || state.subclass || state.background),
            confirmFn: (msg) => window.confirm(msg),
            setPrimaryFn: (rulesetId, opts) => {
              const prevPrimary = primaryRulesetId(state);
              if (rulesetId !== prevPrimary && (state.species || state.className || state.subclass || state.background)) {
                if (!window.confirm("Changing the ruleset clears your Race, Class, Subclass, and Background choices below. Continue?")) {
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
              if (opts?.rerender === false) return;
              const syncMessage = syncRulesetBundles(includedRulesetIdsFor());
              renderPageGrid();
              if (syncMessage) statusEl.textContent = syncMessage;
            },
            updateIdsFn: (nextIds, opts) => {
              const prevIds = includedRulesetIds(state);
              const removed = prevIds.filter((id) => !nextIds.includes(id));
              // Adding a book never disturbs existing picks — only
              // removing one can strand them, so only then confirm +
              // clear downstream choices.
              if (removed.length > 0 && (state.species || state.className || state.subclass || state.background)) {
                if (!window.confirm("Removing a content book can strand your Race, Class, Subclass, and Background choices below if they only come from that book. Continue?")) {
                  renderPageGrid();
                  return;
                }
                state.species = "";
                state.className = "";
                state.subclass = "";
                state.background = "";
              }
              setIncludedRulesetIds(nextIds);
              saveRules();
              // Skipped when persisting mid-render (auto-select): the
              // in-progress render paints it, and bundle sync waits
              // for a real user action.
              if (opts?.rerender === false) return;
              const syncMessage = syncRulesetBundles(nextIds);
              renderPageGrid();
              if (syncMessage) statusEl.textContent = syncMessage;
            },
          });
        },
      },
      {
        id: "identity",
        title: "Identity",
        description: "Name your character, set starting level (usually 1), and pick a species. Species grants ability bonuses, speed, and traits you'll use all game.",
        isComplete: () => Boolean((character.name || "").trim()) && Boolean(state.species),
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
            mechanicsListFn: (category, name) => mechanicsListFor(category, name, state.level),
            selectableRowsFn: (c, names, opts) => renderSelectableRows(c, names, { ...opts, collapsible: true }),
            debounceFn: (fn, ms) => debounce(fn, ms),
          });
        },
      },
      {
        id: "class",
        title: "Class",
        description: "Pick what your character does best — class sets hit points, attacks, and features. If a subclass is available at your level, pick it under your class.",
        isComplete: () => {
          if (!state.className) return false;
          const subs = liveSubclassData(state.className);
          if (subs.subclasses.length && state.level >= subs.subclassLevel) return Boolean(state.subclass);
          return true;
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
            selectableRowsFn: (c, names, opts) => renderSelectableRows(c, names, { ...opts, collapsible: true }),
          });
        },
      },
      {
        id: "abilities",
        title: "Ability Scores",
        descriptionItems: [
          "Each ability has a score (raw talent) and a modifier beside it — the modifier is the number you actually add to attack rolls, saves, and checks at the table.",
          "Modifiers come from scores automatically (10–11 is +0, 12–13 is +1, 8–9 is −1, and so on) — you never set them by hand.",
          "Point Buy spends 27 points across all six (fair, no luck). Random Roll rolls dice for each. Manual Entry types in rolls from the table.",
        ],
        render(container) {
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
            saveFn: () => saveRules(),
            onMethodChange: (method) => {
              character.rules.abilityScoreMethod = method;
              saveRules();
            },
          });
        },
      },
      {
        id: "background",
        title: "Background",
        description: "Pick where your character comes from. It grants skill and tool proficiencies (bonuses on those rolls) plus starting gear.",
        isComplete: () => Boolean(state.background),
        render(container) {
          renderRowListStepInto(container, state, {
            optionNamesFn: (rulesetId, category) => rulesetOptionNames(rulesetId, category, wizardFieldOptionNames("background", "Background")),
            fallbackNames: [],
            keywords: ["background"],
            category: "Background",
            selectedKey: "background",
            inputLabel: "Background",
            inputPlaceholder: "No Background options found for this ruleset yet — type it in for now",
            updateKey: "background",
            updateFn: (key, value) => update(key, value),
            fieldFn: (c, label, control) => field(c, label, control),
            selectableRowsFn: (c, names, opts) => renderSelectableRows(c, names, { ...opts, collapsible: true }),
            catalogInfoFn: (keywords, name) => catalogEntryInfo(keywords, name),
            bundleFn: (category, name, rulesetId) => bundleFor(category, name, rulesetId ?? includedRulesetIds(state)),
            summarizeFn: (m) => statModifierSummary(m),
            mechanicsListFn: (category, name) => mechanicsListFor(category, name, state.level),
          });
        },
      },
      {
        id: "spells",
        title: "Spells & Abilities",
        description: "Make any spell or ability picks your race/class offers, then choose starting spells if your class casts. Limits match your class and level.",
        isApplicable: () => creationGroupsByCategory.spells.length > 0 || Boolean(getRulesetClass(state.rulesetId, state.className)?.caster),
        unavailableMessage: wizardUnavailableMessage,
        isComplete: () => creationGroupsByCategory.spells.every((g) => creationGroupSatisfied(g, state))
          && spellPicksComplete(state.className, state.level),
        render(container) {
          renderSpellsStepInto(container, state, {
            groups: creationGroupsByCategory.spells,
            saveRules,
            choiceGroupsFn: (c, groups, save) => renderCreationChoiceGroups(c, groups, save, state),
            casterInfoFn: (rulesetId, className) => getRulesetClass(rulesetId, className)?.caster,
            spellPickerFn: (c, opts) => renderSpellPicker(c, opts),
          });
        },
      },
      {
        id: "languages",
        title: "Languages",
        description: "Choose extra languages from your race, class, and background. Common is free and never uses picks — languages matter for talking to creatures in play.",
        isApplicable: () => creationGroupsByCategory.languages.length > 0,
        unavailableMessage: wizardUnavailableMessage,
        isComplete: () => creationGroupsByCategory.languages.every((g) => creationGroupSatisfied(g, state)),
        render(container) {
          renderKnownLanguagesInto(container, state);
          const pickWrap = document.createElement("div");
          pickWrap.className = "wizard__subsection";
          container.append(pickWrap);
          // Same renderer as every other choice page, but picks rebuild
          // the page so the summary above stays truthful.
          renderChoiceGroups(pickWrap, creationGroupsByCategory.languages, character.rules.choices, "creation-choice",
            () => { saveRules(); renderPageGrid(); },
            (excludeKey) => ownedSkillIdsFrom(creationFixedBundles(state), creationChoiceGroupsFor(state), excludeKey));
        },
      },
      {
        id: "equipment",
        title: "Starting Equipment",
        description: "Take your class's gear package or gold to shop instead. Background gear is fixed and included automatically — gear is what you actually use in play.",
        isComplete: () => {
          if (!state.className || !CLASS_STARTING_EQUIPMENT[state.className]) return true;
          return Boolean(character.rules.startingEquipment?.classOptionId);
        },
        render(container) { renderStartingEquipmentStepInto(container, state, saveRules); },
      },
      {
        id: "feats",
        title: "Feats",
        description: "Pick feats granted by your race or background. Feats are permanent talents that bend the rules in your favor.",
        isApplicable: () => creationGroupsByCategory.feats.length > 0,
        unavailableMessage: wizardUnavailableMessage,
        isComplete: () => creationGroupsByCategory.feats.every((g) => creationGroupSatisfied(g, state)),
        render(container) { renderChoicePageStepInto(container, creationGroupsByCategory.feats, saveRules, (c, groups, save) => renderCreationChoiceGroups(c, groups, save, state)); },
      },
      {
        id: "proficiencies",
        title: "Proficiencies",
        description: "Choose skill, tool, and save proficiencies from your race, class, and background — then any extra weapon, armor, and tool training. Already-granted ones show locked.",
        isComplete: () => creationGroupsByCategory.proficiencies.every((g) => creationGroupSatisfied(g, state)),
        render(container) {
          if (creationGroupsByCategory.proficiencies.length > 0) {
            const skillHead = document.createElement("p");
            skillHead.className = "wizard__section-label";
            skillHead.textContent = "Skills, Tools & Saving Throws";
            container.append(skillHead);
            const skillWrap = document.createElement("div");
            skillWrap.className = "wizard__subsection";
            container.append(skillWrap);
            renderChoicePageStepInto(skillWrap, creationGroupsByCategory.proficiencies, saveRules, (c, groups, save) => renderCreationChoiceGroups(c, groups, save, state));
          }
          const equipHead = document.createElement("p");
          equipHead.className = "wizard__section-label";
          equipHead.textContent = "Weapons, Armor & Tools";
          container.append(equipHead);
          const equipWrap = document.createElement("div");
          equipWrap.className = "wizard__subsection";
          container.append(equipWrap);
          renderEquipmentProficienciesStepInto(equipWrap, state, saveRules);
        },
      },
      {
        id: "review",
        title: "Review",
        description: "Set how hit points work on level-up, skim what you get automatically, and check every choice. Then Finish Setup to write it to your sheet.",
        render(container) {
          const hpHead = document.createElement("p");
          hpHead.className = "wizard__section-label";
          hpHead.textContent = "Hit Points on Level-Up";
          container.append(hpHead);
          const hpWrap = document.createElement("div");
          hpWrap.className = "wizard__subsection";
          container.append(hpWrap);
          renderPreferencesStepInto(hpWrap, state, {
            hpOptions: HP_METHOD_OPTIONS,
            currentMethod: character.rules.hpMethod || "average",
            updateFn: (key, value) => update(key, value),
            selectableRowsFn: (c, names, opts) => renderSelectableRows(c, names, opts),
          });
          const innateHead = document.createElement("p");
          innateHead.className = "wizard__section-label";
          innateHead.textContent = "What You Get Automatically";
          container.append(innateHead);
          const innateWrap = document.createElement("div");
          innateWrap.className = "wizard__subsection";
          container.append(innateWrap);
          renderInnateAbilitiesStepInto(innateWrap, innateAbilitySections(state));
          const allGroups = [...creationChoiceGroupsFor(state), ...equipmentProficiencyGroups()];
          const spellsField = findStarterField("spellsKnown", "Spells Known");
          const se = character.rules.startingEquipment;
          const seEntry = CLASS_STARTING_EQUIPMENT[state.className];
          const seOpt = seEntry?.options.find((o) => o.id === se?.classOptionId);
          const equipBits = [];
          if (seOpt) equipBits.push(`${state.className} package: ${seOpt.label}`);
          else if (se?.classOptionId && seEntry) equipBits.push(`${state.className} package: ${seEntry.gold.gp} gp instead`);
          if (state.background && BG_STARTING_EQUIPMENT[state.background]) {
            equipBits.push(`${state.background} package: fixed, applied automatically`);
          }
          renderReviewStepInto(container, state, {
            characterName: character.name,
            rulesetName: includedRulesetIds(state).map((id) => getRuleset(id)?.name || id).join(" + ") || null,
            spellLimit: resolved.derived.spellLimit,
            resources: resolved.derived.resources,
            abilityScores: character.rules.abilityScores,
            abilityMethod: character.rules.abilityScoreMethod,
            hpMethod: character.rules.hpMethod,
            choiceLines: reviewChoiceLinesFor(allGroups, character.rules.choices || {}),
            spellsPicked: [...(spellsField?.items || [])],
            equipmentLine: equipBits.length ? `Starting Equipment: ${equipBits.join(" · ")}` : null,
            featNames: (character.rules.feats || []).map((f) => f.name).filter(Boolean),
            syncFn: () => syncRulesToSheet(resolved),
          });
        },
      },
    ];


    const wizard = renderStepWizard(steps, creationWizardState, {
      title: "Character Setup",
      intro: "Step through these once to get your character started — you can always come back and change an earlier answer.",
    });
    if (wizard) pageGrid.append(wizard);
  }

  function renderRulesetLevelGuide() {
    const primaryName = selectedChoiceName("class", "Class");
    const level = currentCharacterLevel();
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
    const pending = initPendingLevelState(levelingPendingState, levelKey, {
      subclass: selectedChoiceName("subclass", "Subclass"),
      choices: {},
      className: primaryName,
      newClassName: "",
    });
    const validClassNames = [primaryName, ...entries.map((e) => e.name), "__new"].filter(Boolean);
    if (!validClassNames.includes(pending.className)) {
      pending.className = primaryName;
      pending.newClassName = "";
    }
    const takingNewClass = pending.className === "__new";
    const levelClass = takingNewClass ? (pending.newClassName || "") : (pending.className || primaryName);
    const isSecondary = Boolean(levelClass) && levelClass !== primaryName;
    const entryForLevelClass = entries.find((e) => e.name === levelClass);
    const newClassLevel = levelClass === primaryName || !levelClass
      ? (level ?? 1)
      : (entryForLevelClass ? entryForLevelClass.levels + 1 : 1);
    const selectedSubclass = levelClass === primaryName
      ? selectedChoiceName("subclass", "Subclass")
      : (entryForLevelClass?.subclass || "");
    const plan = levelClass
      ? applyLiveSubclassOverride(
        getLevelUpPlan(character.rules?.rulesetId || character.rulesetId, levelClass, newClassLevel, selectedSubclass),
        { selectedSubclass, level: newClassLevel, liveSubclasses: liveSubclassData(levelClass) }
      )
      : null;
    const contentGroups = level == null ? [] : activeRuleChoiceGroups(flattenGlobalFields(), formulaValues)
      // Equipment-proficiency pickers live on their own creation-tab
      // page (and stay editable afterward right on the sheet's
      // taglists) — they aren't per-level offers, so the level-up
      // Choices step leaves them out. Their picks still apply via
      // activeRuleChoiceGroups at compute time.
      .filter((group) => group.minLevel <= level && !group.key.startsWith("equipprof:"));
    const newFeatures = level == null || !levelClass ? [] : classFeatureGrantsAtLevel(levelClass, newClassLevel);
    const needsAsi = level != null && levelClass ? classGrantsAsiAtLevel(levelClass, newClassLevel) : false;
    if (!plan && contentGroups.length === 0) return null;

    const priorLevelUp = character.levelUps?.[String(level)] || {};
    if (plan && priorLevelUp.appliedRulesetId === plan.ruleset.id) {
      return alreadyAppliedPanel(levelClass || primaryName, level, plan.ruleset.name);
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
      return [...merged.entries()].map(([fieldId, options]) => ({ fieldId, options }));
    })();
    const slots = slotsSummary({ slotChanges: guideSlotChanges });
    const feedback = document.createElement("p");
    feedback.className = "level-guide__feedback";

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
            removeFn: (name) => {
              character.rules.multiclass = (character.rules.multiclass || []).filter((e) => e.name !== name);
              character.rules = normalizeRulesState(character.rules);
              store.saveCharacterFields(character.id, { rules: character.rules }).catch((err) => {
                console.error("Failed to save multiclass removal:", err);
              });
              renderPageGrid();
            },
            confirmFn: (msg) => window.confirm(msg),
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
          renderGuideSubclassStepInto(container, pending, plan.subclassChoices);
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
            selectableRowsFn: (c, names, opts) => renderSelectableRows(c, names, opts),
            gridFn: () => renderPageGrid(),
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
      steps.push({
        id: "spells",
        title: "Spells",
        description: "Your spellcasting improves at this level. Check off any new spells you've picked up — this writes straight to the Spells Known list on the main sheet.",
        // Multiclass spell picks span classes in ways the single-class
        // cap check can't express — unenforced there (documented).
        isComplete: () => (multiclassEntries().length || takingNewClass ? true : spellPicksComplete(levelClass, newClassLevel)),
        render(container) {
          const note = document.createElement("p");
          note.className = "level-guide__summary";
          note.textContent = `This ruleset sets your spell slots to ${slots} at this level.`;
          container.append(note);
          renderSpellPicker(container, { rulesetId: character.rules?.rulesetId || character.rulesetId, className: levelClass, level: newClassLevel });
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
        const summary = document.createElement("p");
        summary.className = "level-guide__summary";
        summary.textContent = levelReviewSummary({
          hp: pending.hp,
          subclass: pending.subclass,
          needsAsi,
          asiMode: pending.asiMode,
          featChoice: pending.featChoice,
          asiAbilities: [pending.asiAbility1, pending.asiAbility2],
          slots,
          classLabel: entries.length || takingNewClass ? `${levelClass} ${newClassLevel}` : null,
        });
        container.append(summary);
        container.append(feedback);

        const applyBtn = document.createElement("button");
        applyBtn.type = "button";
        applyBtn.className = "btn btn--primary";
        applyBtn.textContent = `Apply Level ${level} Changes`;
        applyBtn.addEventListener("click", async () => {
          const error = validateLevelApply({
            hpGain: Number.parseInt(pending.hp, 10),
            contentGroups,
            pendingChoices: pending.choices,
            needsAsi,
            asiMode: pending.asiMode,
            asiAbilities: [pending.asiAbility1, pending.asiAbility2],
            featChoice: pending.featChoice,
          });
          if (error) {
            feedback.textContent = error;
            feedback.classList.add("level-guide__feedback--error");
            return;
          }
          // Brand-new multiclass levels must pass ability prerequisites
          // (checked live in the picker too — scores can change after).
          if (takingNewClass && pending.newClassName) {
            const reason = multiclassPrereqReason(effectiveScores, primaryName, pending.newClassName);
            if (reason) {
              feedback.textContent = `Can't multiclass into ${pending.newClassName} yet: ${reason} (racial bonuses count).`;
              feedback.classList.add("level-guide__feedback--error");
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

          const before = clone({ layout: character.layout, sheetTabs: character.sheetTabs, levelUps: character.levelUps, rules: character.rules });
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
          const hpMax = findStarterField(null, "HP Max");
          const hpCurrent = findStarterField(null, "HP Current");
          const features = findStarterField(null, "Features & Traits");
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
          // New subclass/feat picks at this level can carry addItem
          // grants (circle spells, feat spells, …) — gated on the
          // level being applied, not the (still previous) sheet level.
          syncGrantedListItems(level);
          mirrorFirstTabLayout();
          unsavedChanges = true;
          try {
            await store.saveCharacterFields(character.id, { layout: character.layout, sheetTabs: character.sheetTabs, levelUps: character.levelUps, rules: character.rules });
            unsavedChanges = false;
            delete levelingPendingState[levelKey];
            levelingWizardState.index = 0;
            statusEl.textContent = "Saved";
            renderAll();
          } catch (err) {
            console.error("Failed to apply level-up changes:", err);
            character.layout = before.layout;
            character.sheetTabs = before.sheetTabs;
            character.levelUps = before.levelUps;
            character.rules = before.rules;
            feedback.textContent = "The update could not be saved. Please try again.";
            feedback.classList.add("level-guide__feedback--error");
            applyBtn.disabled = false;
          }
        });
        container.append(applyBtn);
      },
    });

    const singleClass = !entries.length && !takingNewClass;
    return renderStepWizard(steps, levelingWizardState, {
      title: singleClass
        ? `${primaryName || "Character"} Level ${level}`
        : `${levelClass || "Class"} ${newClassLevel} · character level ${level}`,
      intro: "Step through whatever applies at this level — anything that doesn't apply is skipped automatically.",
    });
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

  function renderLevelingTab() {
    const currentLevel = currentCharacterLevel();
    const guideEl = renderRulesetLevelGuide();
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
      resourcesEl: renderResourceTrackers(),
      currentLevel,
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
    renderTabs();
    renderBlockFrame();
    renderPageGrid();
  }

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
      onAdd: () => {
        commitMutation(() => {
          const tab = { id: newId(), name: `Tab ${character.sheetTabs.length + 1}`, layout: [] };
          character.sheetTabs.push(tab);
          activeTabId = tab.id;
        });
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
      resizeHandleFn: buildResizeHandle,
      toolbarFn: (b, el) => buildBlockToolbar(b, el),
      fieldNodeFn: (f, parent, w, style) => renderFieldNode(f, parent, w, style),
      dragFn: (el, node, w, onSettled) => wireDrag(el, node, w, onSettled),
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
      resizeHandleFn: buildResizeHandle,
      equationHintFn: (f) => buildEquationHint(f),
      toolbarFn: (f, parent, el) => buildFieldToolbar(f, parent, el),
      dragFn: (el, node, w, onSettled, bounds) => wireDrag(el, node, w, onSettled, bounds),
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
    const trigger = document.createElement("div");
    trigger.className = "field-roll";
    const dieBtn = document.createElement("button");
    dieBtn.type = "button";
    dieBtn.className = "field-roll__die";
    dieBtn.title = `Roll d${ROLL_SIDES} + ${field.label || "field"}`;
    dieBtn.textContent = "🎲";
    dieBtn.setAttribute("aria-label", `Roll d${ROLL_SIDES}`);
    const advBtn = document.createElement("button");
    advBtn.type = "button";
    advBtn.className = "field-roll__mode";
    advBtn.title = `Roll d${ROLL_SIDES} with advantage (higher of two)`;
    advBtn.innerHTML = `<span class="field-roll__full">Advantage</span><span class="field-roll__short">Adv.</span>`;
    const disBtn = document.createElement("button");
    disBtn.type = "button";
    disBtn.className = "field-roll__mode";
    disBtn.title = `Roll d${ROLL_SIDES} with disadvantage (lower of two)`;
    disBtn.innerHTML = `<span class="field-roll__full">Disadvantage</span><span class="field-roll__short">Disadv.</span>`;
    // The field sits inside a draggable grid node — a click on these
    // buttons is a roll, never the start of a drag or a text edit.
    trigger.addEventListener("pointerdown", (e) => e.stopPropagation());
    dieBtn.addEventListener("click", (e) => { e.stopPropagation(); openFieldRollDialog(field, "normal"); });
    advBtn.addEventListener("click", (e) => { e.stopPropagation(); openFieldRollDialog(field, "advantage"); });
    disBtn.addEventListener("click", (e) => { e.stopPropagation(); openFieldRollDialog(field, "disadvantage"); });
    trigger.append(dieBtn, advBtn, disBtn);
    return trigger;
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
    const wrap = document.createElement("div");
    wrap.className = "field-roll-wrap";
    wrap.append(valueEl, buildRollTrigger(field));
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
   *  fights with placing a text caret. */
  function buildTextListValue(field) {
    return buildTextListValueInto(field, {
      commitFn: (fn, opts) => commitMutation(fn, opts),
    });
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
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "—";
    select.append(blank);
    const allowed = getAllowedChoiceIds(field, flattenGlobalFields());
    dropdownVisibleChoices(field.choices || [], allowed).forEach((choice) => {
      const opt = document.createElement("option");
      opt.value = choice.id;
      opt.textContent = choice.text;
      select.append(opt);
    });
    select.value = field.selected || "";
  }

  /** Reads a File as a data URL, with the same "this might not fit in
   *  a single Firestore document" warning the block-background image
   *  upload already gives. */
  function readImageFile(file, onLoaded) {
    readImageFileInto(file, MAX_IMAGE_BYTES, (msg) => showToast(msg), onLoaded);
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
      readFileFn: (file, onLoaded) => readImageFile(file, onLoaded),
      commitFn: (fn, opts) => commitMutation(fn, opts),
      clearAvatarsFn: (f) => clearOtherAvatars(f),
      placeholderFn: () => buildAvatarPlaceholderSvg(),
      iconMarkup: personIconSvgMarkup(),
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
      const suggestBtn = document.createElement("button");
      suggestBtn.type = "button";
      suggestBtn.title = "Suggest attack lines from your weapons, attack cantrips, and natural weapons (skips what's already listed)";
      suggestBtn.textContent = "⚔";
      suggestBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        suggestAttacksForField(field);
      });
      bar.append(suggestBtn);
    }
    return bar;
  }

  function suggestAttacksForField(field) {
    const num = (id) => (Number.isFinite(formulaValues[id]) ? formulaValues[id] : 0);
    const se = character.rules.startingEquipment;
    let items = [];
    try {
      items = resolveStartingEquipmentPick(
        character.rules.className, character.rules.background, se?.classOptionId
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
      setValue: (n, k, v) => setNodeStyleValue(n, k, v),
      commit: (fn, opts) => commitMutation(fn, opts),
      applyStyle: (el, s) => applyNodeStyle(el, s),
      styleChangeFn: (el, n, change) => applyStyleChange(el, n, change),
      toastFn: (msg) => showToast(msg),
      maxImageBytes: MAX_BG_IMAGE_BYTES,
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

  /** A small, non-interactive preview of an empty text field — used in
   *  the field-type picker so each option shows what it'll look like. */
  function buildTextPreview() {
    return sharedBuildTextPreview();
  }

  function buildLabelPreview() {
    return sharedBuildLabelPreview();
  }

  function buildTextareaPreview() {
    return sharedBuildTextareaPreview();
  }

  function buildTextlistPreview() {
    return sharedBuildTextlistPreview();
  }

  function buildDropdownPreview() {
    return sharedBuildDropdownPreview();
  }

  function buildPicturePreview() {
    return sharedBuildPicturePreview(personIconSvgMarkup());
  }

  function buildCatalogPreview() {
    return sharedBuildCatalogPreview();
  }

  function buildFeatureListPreview() {
    return sharedBuildFeatureListPreview();
  }

  /** A small, non-interactive preview of `count` empty radio buttons
   *  or checkboxes in a row — same purpose as buildTextPreview above. */
  function buildOptionPreview(kind, count) {
    return sharedBuildOptionPreview(kind, count);
  }

  // --- Boot + responsive re-render ---------------------------------------

  renderAll();
  const onResize = debounce(renderPageGrid, 150);
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
    // Leave the document theme clean for whatever renders next
    // (character list, another character with its own theme).
    applySheetTheme("standard", "dark");
  }

  return { hasUnsavedChanges, destroy };
}

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

import { createStarterLayout, createBlock, createField, findNode, findParentArray, syncOptionWidth, LABEL_POSITIONS, BLOCK_HEADER_ROWS } from "../data/blockModel.js";
import { contentHeight } from "./gridEngine.js";
import { computeAllFormulas, evaluateFormulaNode, formatComputedValue } from "../data/formula.js";
import { openFormulaEditor } from "./formulaEditor.js";
import { openBundleLibraryManager } from "./bundleLibraryEditor.js";
import { openCatalogLibraryManager } from "./catalogLibraryEditor.js";
import { openCatalogBrowser } from "./catalogBrowser.js";
import { getLevelUpPlan, getRuleset, getRulesetClass, listRulesets } from "../data/dnd5e.js";
import { ABILITY_IDS, normalizeRulesState, resolveRulesState } from "../data/rulesEngine.js";

const PAGE_COLS = 16;
const GAP_PX = 10;
const MIN_CELL_PX = 40; // below this, the page scrolls horizontally instead of squishing cells
const MAX_BG_IMAGE_BYTES = 250_000; // warn above this — Firestore caps a whole doc at 1MB

// Sensible starting footprint per field type when it's first added —
// a 1x1 cell is fine for a short stat but far too small to be useful
// for a text area, list, or dropdown.
const DEFAULT_FIELD_SIZE = {
  text: { w: 1, h: 1 },
  label: { w: 2, h: 1 },
  textarea: { w: 3, h: 2 },
  textlist: { w: 3, h: 2 },
  dropdown: { w: 2, h: 1 },
  picture: { w: 3, h: 3 },
  catalog: { w: 2, h: 1 },
  radio: { w: 1, h: 1 },
  checkbox: { w: 1, h: 1 },
};
// Radio/checkbox auto-size via syncOptionWidth (their w/h are derived
// from option count, not user-resizable); every other field type can
// be freely resized.
const RESIZABLE_FIELD_TYPES = new Set(["text", "label", "textarea", "textlist", "dropdown", "picture", "catalog", "featureList"]);
// Field types with no separate label/value split — just one element
// filling the whole field (see renderFieldInner).
const CAPTIONLESS_FIELD_TYPES = new Set(["label", "picture", "catalog"]);
const MAX_IMAGE_BYTES = 250_000; // same Firestore-doc-size reasoning as MAX_BG_IMAGE_BYTES below

function debounce(fn, delayMs = 500) {
  let handle;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), delayMs);
  };
}

export function renderCustomSheet(root, character, store) {
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
  let catalogCache = [];
  async function refreshCatalogCache() {
    if (!store.listCatalogs) return;
    try {
      catalogCache = await store.listCatalogs();
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
  const toolbar = document.createElement("div");
  toolbar.className = "sheet-toolbar";

  const leftGroup = document.createElement("div");
  leftGroup.className = "sheet-toolbar__group";

  const modeBtn = document.createElement("button");
  modeBtn.type = "button";
  modeBtn.className = "btn btn--primary";
  modeBtn.textContent = "Customize Sheet";

  const undoBtn = document.createElement("button");
  undoBtn.type = "button";
  undoBtn.className = "btn";
  undoBtn.textContent = "Undo";
  undoBtn.disabled = true;

  const redoBtn = document.createElement("button");
  redoBtn.type = "button";
  redoBtn.className = "btn";
  redoBtn.textContent = "Redo";
  redoBtn.disabled = true;

  const addBlockBtn = document.createElement("button");
  addBlockBtn.type = "button";
  addBlockBtn.className = "btn";
  addBlockBtn.textContent = "+ Block";
  addBlockBtn.style.display = "none";
  addBlockBtn.addEventListener("click", () => {
    commitMutation(() => {
      currentLayout().push(createBlock({ name: "New Block", x: 0, y: 0, w: 3, h: 3 }));
    });
  });

  leftGroup.append(modeBtn, undoBtn, redoBtn, addBlockBtn);
  toolbar.append(leftGroup);

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
    blockFrame.classList.toggle("is-collapsed", sidebarCollapsed);
  });
  toolbar.append(sidebarToggleBtn);

  const bundleLibBtn = document.createElement("button");
  bundleLibBtn.type = "button";
  bundleLibBtn.className = "btn";
  bundleLibBtn.textContent = "Bundle Libraries";
  bundleLibBtn.title = "Manage reusable Race/Class/etc. bundles";
  bundleLibBtn.addEventListener("click", () => {
    openBundleLibraryManager(store, refreshBundleLibraryCache);
  });
  toolbar.append(bundleLibBtn);

  const catalogLibBtn = document.createElement("button");
  catalogLibBtn.type = "button";
  catalogLibBtn.className = "btn";
  catalogLibBtn.textContent = "Catalogs";
  catalogLibBtn.title = "Manage reusable item/spell catalogs";
  catalogLibBtn.addEventListener("click", () => {
    openCatalogLibraryManager(store, refreshCatalogCache, resolveFieldById);
  });
  toolbar.append(catalogLibBtn);

  // A plain, non-customizable name field — deliberately outside the
  // draggable/relabelable grid. The character LIST view needs a
  // reliable "this is the name" field, and once everything on the
  // sheet itself can be freely relabeled and rearranged, there's no
  // way to reconstruct that from the layout alone.
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "input-group__control";
  nameInput.style.maxWidth = "220px";
  nameInput.placeholder = "Character name";
  nameInput.value = character.name || "";
  nameInput.addEventListener("input", () => { unsavedChanges = true; });
  nameInput.addEventListener("input", debounce(() => {
    character.name = nameInput.value;
    saveWithStatus("name", nameInput.value);
  }, 400));
  toolbar.append(nameInput);

  // Rulesets are data packs. The generic level-up guide and subclass
  // dropdown use this saved selection instead of hardcoded class logic.
  const rulesetSelect = document.createElement("select");
  rulesetSelect.className = "input-group__control";
  rulesetSelect.style.maxWidth = "220px";
  rulesetSelect.title = "Ruleset used for guided leveling";
  const rulesetPlaceholder = document.createElement("option");
  rulesetPlaceholder.value = "";
  rulesetPlaceholder.textContent = "Choose ruleset";
  rulesetSelect.append(rulesetPlaceholder);
  listRulesets().forEach((ruleset) => {
    const option = document.createElement("option");
    option.value = ruleset.id;
    option.textContent = ruleset.name;
    rulesetSelect.append(option);
  });
  rulesetSelect.value = character.rulesetId || "";
  rulesetSelect.addEventListener("change", () => {
    character.rulesetId = rulesetSelect.value || null;
    character.rules = normalizeRulesState(character.rules);
    character.rules.rulesetId = character.rulesetId;
    saveWithStatus("rules", character.rules);
    const syncMessage = syncRulesetBundles(character.rulesetId);
    renderAll();
    if (syncMessage) statusEl.textContent = syncMessage;
  });
  toolbar.append(rulesetSelect);

  // Re-run the ruleset auto-sync on demand — e.g. after importing more
  // bundles for a ruleset that's already selected, since selecting the
  // same value again wouldn't fire the <select>'s change event.
  const rulesetSyncBtn = document.createElement("button");
  rulesetSyncBtn.type = "button";
  rulesetSyncBtn.className = "btn formula-toolbar__btn";
  rulesetSyncBtn.textContent = "↻";
  rulesetSyncBtn.title = "Re-apply this ruleset's bundles (after importing more, for example)";
  rulesetSyncBtn.addEventListener("click", () => {
    const syncMessage = syncRulesetBundles(character.rulesetId);
    renderAll();
    if (syncMessage) statusEl.textContent = syncMessage;
  });
  toolbar.append(rulesetSyncBtn);

  // Everything else the character-selection page shows on a card
  // (Race, Class, Level, whatever) is NOT intrinsic — name is the
  // only fixed identity field. Instead, drag any field here (from the
  // sidebar, same drag payload it already uses for the grid) to
  // designate it as one of the fields shown on that character's card;
  // its value there always reflects whatever's currently on the sheet.
  if (!character.cardFieldIds) character.cardFieldIds = [];
  const cardFieldsWrap = document.createElement("div");
  cardFieldsWrap.className = "identity-card-fields";
  cardFieldsWrap.addEventListener("dragover", (e) => {
    if (e.dataTransfer.types.includes("application/x-sheet-field")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });
  cardFieldsWrap.addEventListener("drop", (e) => {
    const payload = e.dataTransfer.getData("application/x-sheet-field");
    if (!payload) return;
    e.preventDefault();
    let parsed;
    try { parsed = JSON.parse(payload); } catch { return; }
    if (!parsed.fieldId || character.cardFieldIds.includes(parsed.fieldId)) return;
    character.cardFieldIds.push(parsed.fieldId);
    saveWithStatus("cardFieldIds", character.cardFieldIds);
    renderCardFieldChips();
  });

  function renderCardFieldChips() {
    cardFieldsWrap.innerHTML = "";
    if (character.cardFieldIds.length === 0) {
      const hint = document.createElement("span");
      hint.className = "identity-card-fields__hint";
      hint.textContent = "Drag fields here to show on the character list";
      cardFieldsWrap.append(hint);
      return;
    }
    character.cardFieldIds.forEach((id) => {
      const field = resolveFieldById(id);
      const chip = document.createElement("span");
      chip.className = "identity-card-fields__chip" + (field ? "" : " identity-card-fields__chip--missing");
      chip.append(document.createTextNode(field ? (field.label || "Field") : "deleted field"));
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.title = "Stop showing this on the character list";
      removeBtn.textContent = "✕";
      removeBtn.setAttribute("aria-label", "Stop showing this on the character list");
      removeBtn.addEventListener("click", () => {
        character.cardFieldIds = character.cardFieldIds.filter((x) => x !== id);
        saveWithStatus("cardFieldIds", character.cardFieldIds);
        renderCardFieldChips();
      });
      chip.append(removeBtn);
      cardFieldsWrap.append(chip);
    });
  }
  renderCardFieldChips();
  toolbar.append(cardFieldsWrap);

  // A separate single-field designation (not part of cardFieldIds
  // above, which is about what shows on the character-list card) —
  // this is what bundle stat modifiers/dropdown-access rules check
  // against when they have a "Min Level" set (see currentLevel,
  // applyBundleModifiers, getAllowedChoiceIds). Single slot, not a
  // chip list: only one field can sensibly BE the character's level.
  const levelFieldWrap = document.createElement("div");
  levelFieldWrap.className = "identity-card-fields";
  levelFieldWrap.addEventListener("dragover", (e) => {
    if (e.dataTransfer.types.includes("application/x-sheet-field")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });
  levelFieldWrap.addEventListener("drop", (e) => {
    const payload = e.dataTransfer.getData("application/x-sheet-field");
    if (!payload) return;
    e.preventDefault();
    let parsed;
    try { parsed = JSON.parse(payload); } catch { return; }
    if (!parsed.fieldId) return;
    character.levelFieldId = parsed.fieldId;
    saveWithStatus("levelFieldId", character.levelFieldId);
    renderLevelFieldChip();
  });

  function renderLevelFieldChip() {
    levelFieldWrap.innerHTML = "";
    if (!character.levelFieldId) {
      const hint = document.createElement("span");
      hint.className = "identity-card-fields__hint";
      hint.textContent = "Drag a field here to designate it as Level (for bundle leveling)";
      levelFieldWrap.append(hint);
      return;
    }
    const field = resolveFieldById(character.levelFieldId);
    const chip = document.createElement("span");
    chip.className = "identity-card-fields__chip" + (field ? "" : " identity-card-fields__chip--missing");
    chip.append(document.createTextNode(field ? (field.label || "Field") : "deleted field"));
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.title = "Unset the Level field";
    removeBtn.textContent = "✕";
    removeBtn.setAttribute("aria-label", "Unset the Level field");
    removeBtn.addEventListener("click", () => {
      character.levelFieldId = null;
      saveWithStatus("levelFieldId", character.levelFieldId);
      renderLevelFieldChip();
    });
    chip.append(removeBtn);
    levelFieldWrap.append(chip);
  }
  renderLevelFieldChip();
  toolbar.append(levelFieldWrap);

  // Visible save-state feedback — saves happen silently in the
  // background otherwise, which means a failed save (e.g. a
  // background image pushing the character over Firestore's 1MB
  // document limit) would previously go completely unnoticed.
  const statusEl = document.createElement("span");
  statusEl.className = "save-status";
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
    const toast = document.createElement("div");
    toast.className = "sheet-toast" + (isError ? " sheet-toast--error" : "");
    toast.textContent = message;
    toast.setAttribute("role", "status");
    root.append(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 200);
    }, 5000);
  }

  root.append(toolbar);

  const tabsBar = document.createElement("div");
  tabsBar.className = "sheet-tabs";
  root.append(tabsBar);

  modeBtn.addEventListener("click", () => {
    editMode = !editMode;
    modeBtn.textContent = editMode ? "Done Editing" : "Customize Sheet";
    addBlockBtn.style.display = editMode ? "" : "none";
    pageGrid.classList.toggle("is-edit-mode", editMode);
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
    const x = Math.max(0, Math.round((e.clientX - rect.left) / (cw + GAP_PX)));
    const y = Math.max(0, Math.round((e.clientY - rect.top) / (cw + GAP_PX)));

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
    if (e.target.closest(".node-handle")) return;
    const nodeEl = e.target.closest(".grid-node");
    if (!nodeEl) return;
    const id = nodeEl.dataset.nodeId;
    if (!id) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      toggleSelected(id);
      return;
    }
    // A plain click on something that's already the ENTIRE current
    // selection is left alone here — that's what lets a plain
    // click-drag on an existing multi-selection start moving the
    // whole group, instead of every drag first collapsing it to one
    // item. wireDrag/wireResize below handle re-selecting from a
    // single item when a drag/resize actually starts on one.
    if (selectedIds.size === 1 && selectedIds.has(id)) return;
    if (nodeEl.dataset.nodeKind === "block") {
      selectBlockAndFields(nodeEl);
    } else {
      selectOnly(id);
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
  const groupToolbar = document.createElement("div");
  groupToolbar.className = "node-toolbar group-toolbar";
  const groupBorderBtn = document.createElement("button");
  groupBorderBtn.type = "button";
  groupBorderBtn.title = "Toggle a border around the whole selection";
  groupBorderBtn.textContent = "▢";
  groupBorderBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    groupBorderVisible = !groupBorderVisible;
    groupBorderBtn.classList.toggle("active", groupBorderVisible);
    updateGroupBorderOverlay();
  });
  groupToolbar.append(groupBorderBtn);

  // The border itself: not each selected element getting its own
  // border, but one rectangle around the smallest box that contains
  // all of them — a visible outline of the CURRENT selection, not a
  // persisted style (there's no actual "group" object in the data
  // model to attach a saved style to; select something else, or edit
  // the selection, and this resets — see the signature check in
  // paintSelection below).
  const groupBorderOverlay = document.createElement("div");
  groupBorderOverlay.className = "group-border-overlay";
  let groupBorderVisible = false;
  let lastSelectionSignature = "";

  function updateGroupBorderOverlay() {
    const box = groupBorderVisible ? selectionBoundingBox() : null;
    if (!box) {
      groupBorderOverlay.classList.remove("is-visible");
      return;
    }
    groupBorderOverlay.style.left = `${box.left - 3}px`;
    groupBorderOverlay.style.top = `${box.top - 3}px`;
    groupBorderOverlay.style.width = `${box.right - box.left + 6}px`;
    groupBorderOverlay.style.height = `${box.bottom - box.top + 6}px`;
    groupBorderOverlay.classList.add("is-visible");
  }

  /** The pixel bounding box (relative to pageGrid) of every currently
   *  selected element that's actually rendered right now — null if
   *  fewer than two of them are (a single selection uses its own
   *  ordinary per-node toolbar instead; see wireHoverToolbar). */
  function selectionBoundingBox() {
    if (selectedIds.size < 2) return null;
    const pageRect = pageGrid.getBoundingClientRect();
    const rects = [...selectedIds]
      .map((id) => pageGrid.querySelector(`[data-node-id="${id}"]`))
      .filter(Boolean)
      .map((el) => el.getBoundingClientRect());
    if (rects.length < 2) return null;
    return {
      left: Math.min(...rects.map((r) => r.left)) - pageRect.left,
      top: Math.min(...rects.map((r) => r.top)) - pageRect.top,
      right: Math.max(...rects.map((r) => r.right)) - pageRect.left,
      bottom: Math.max(...rects.map((r) => r.bottom)) - pageRect.top,
    };
  }

  // Hovering ANYWHERE within the selection's bounding box — including
  // the gaps between separate selected elements, not just directly
  // over one of them — shows the group toolbar at its top-right
  // corner, the same "just outside the top-right corner" placement a
  // single node's own toolbar uses (see positionNodeToolbar).
  pageGrid.addEventListener("mousemove", (e) => {
    if (!editMode) { groupToolbar.classList.remove("is-visible"); return; }
    const box = selectionBoundingBox();
    if (!box) { groupToolbar.classList.remove("is-visible"); return; }
    const pageRect = pageGrid.getBoundingClientRect();
    const mx = e.clientX - pageRect.left;
    const my = e.clientY - pageRect.top;
    if (mx < box.left || mx > box.right || my < box.top || my > box.bottom) {
      groupToolbar.classList.remove("is-visible");
      return;
    }
    positionFloatingToolbar(groupToolbar, box.right, box.top);
    groupToolbar.classList.add("is-visible");
  });
  pageGrid.addEventListener("mouseleave", () => groupToolbar.classList.remove("is-visible"));

  function paintSelection() {
    pageGrid.querySelectorAll(".grid-node.is-selected").forEach((el) => el.classList.remove("is-selected"));
    blockFrame.querySelectorAll(".is-selected").forEach((el) => el.classList.remove("is-selected"));
    selectedIds.forEach((id) => {
      const el = pageGrid.querySelector(`[data-node-id="${id}"]`);
      if (el) el.classList.add("is-selected");
      const item = blockFrame.querySelector(`[data-highlight-id="${id}"]`);
      if (item) item.classList.add("is-selected");
    });
    // The bounding-box border is tied to THIS selection, not a
    // persisted style — switching to a genuinely different selection
    // resets it off, rather than carrying a stale box over (or
    // requiring an extra click to turn off a border that no longer
    // makes sense for whatever's now selected). Re-painting the SAME
    // selection after an unrelated edit elsewhere does NOT reset it —
    // only an actual change to which ids are selected does.
    const signature = [...selectedIds].sort().join(",");
    if (signature !== lastSelectionSignature) {
      groupBorderVisible = false;
      groupBorderBtn.classList.remove("active");
      lastSelectionSignature = signature;
    }
    updateGroupBorderOverlay();
  }

  function selectOnly(id) {
    selectedIds = new Set([id]);
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
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds = next;
    paintSelection();
    if (selectedIds.size > 0) refocusNodeById([...selectedIds].pop());
  }

  function clearSelectionState() {
    selectedIds = new Set();
    paintSelection();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  function normalizeTabs() {
    if (!Array.isArray(character.sheetTabs) || character.sheetTabs.length === 0) {
      character.sheetTabs = [{
        id: newId(),
        name: "Main",
        kind: "main",
        layout: Array.isArray(character.layout) ? character.layout : [],
      }];
    }
    character.sheetTabs.forEach((tab, index) => {
      if (!tab.id) tab.id = newId();
      if (index === 0 && !tab.kind) tab.kind = "main";
      if (!tab.name) tab.name = tab.kind === "main" ? "Main" : tab.kind === "rules" ? "Character" : tab.kind === "leveling" ? "Leveling" : `Tab ${index + 1}`;
      if (!Array.isArray(tab.layout)) tab.layout = [];
    });
    // The Character-setup wizard tab is mandatory ONLY until it's been
    // finished (character.setupComplete) — once finished, it's removed
    // entirely rather than kept around, per Shawn's ask; the "Finish
    // Setup" button in syncRulesToSheet is what flips the flag.
    if (!character.setupComplete) {
      if (!character.sheetTabs.some(tab => tab.kind === "rules")) {
        character.sheetTabs.splice(1, 0, { id: newId(), name: "Character", kind: "rules", layout: [] });
      }
    } else {
      const rulesIndex = character.sheetTabs.findIndex(tab => tab.kind === "rules");
      if (rulesIndex !== -1) character.sheetTabs.splice(rulesIndex, 1);
    }
    if (!character.sheetTabs.some(tab => tab.kind === "leveling")) {
      const levelingIndex = character.sheetTabs.some(tab => tab.kind === "rules") ? 2 : 1;
      character.sheetTabs.splice(levelingIndex, 0, { id: newId(), name: "Leveling", kind: "leveling", layout: [] });
    }
    if (!character.levelUps || typeof character.levelUps !== "object") {
      character.levelUps = {};
    }
    character.rules = normalizeRulesState(character.rules);
    mirrorFirstTabLayout();
  }

  function newId() {
    return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function snapshot() {
    return clone({
      sheetTabs: character.sheetTabs,
      layout: character.layout,
    });
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
  const UNDO_COALESCE_MS = 800;
  const MAX_UNDO_STEPS = 100;
  let lastMutationAt = 0;

  function commitMutation(fn, { render = true, save = true } = {}) {
    if (save) unsavedChanges = true;
    const now = Date.now();
    if (undoStack.length === 0 || now - lastMutationAt > UNDO_COALESCE_MS) {
      undoStack.push(snapshot());
      if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
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
    const previousGrantedCheckboxes = grantedCheckboxes;
    const previousGrantedFeatures = grantedFeatures;
    formulaValues = computeSheetValues(allFields); // also refreshes grantedCheckboxes/grantedFeatures as a side effect
    radioOptionCounts = computeRadioOptionCounts(allFields, formulaValues);
    pageGrid.querySelectorAll(".field-value--computed[data-field-id]").forEach((el) => {
      el.textContent = formatComputedValue(formulaValues[el.dataset.fieldId]);
    });
    const optionCountsChanged = allFields.some((f) =>
      f.fieldType === "radio" && f.optionsFormula && radioOptionCounts[f.id] !== previousRadioOptionCounts[f.id]
    );
    const grantsChanged = grantedCheckboxes.size !== previousGrantedCheckboxes.size ||
      [...grantedCheckboxes].some((key) => !previousGrantedCheckboxes.has(key));
    const featuresChanged = grantedFeatures.length !== previousGrantedFeatures.length ||
      grantedFeatures.some((f, i) => f.name !== previousGrantedFeatures[i]?.name);
    if (optionCountsChanged || grantsChanged || featuresChanged) scheduleDeferredRender();
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
    redoStack.push(snapshot());
    if (redoStack.length > MAX_UNDO_STEPS) redoStack.shift();
    restoreSnapshot(undoStack.pop());
    lastMutationAt = 0; // next edit always starts a fresh undo step, never coalesced into the just-restored state
    updateHistoryButtons();
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
    restoreSnapshot(redoStack.pop());
    lastMutationAt = 0;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }

  function onShortcut(e) {
    if (e.key === "Escape") {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
      clearSelectionState();
      return;
    }

    // Guards both cases below: while actually typing/editing text, Delete
    // and Backspace must only ever edit that text, never delete the
    // whole block/field it lives in.
    if (e.target.closest("input, textarea, select, [contenteditable='true']")) return;

    if (editMode && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "Delete" || e.key === "Backspace")) {
      if (selectedIds.size > 0) {
        e.preventDefault();
        deleteSelectedNodes([...selectedIds]);
        return;
      }
      const nodeEl = e.target.closest(".grid-node");
      if (nodeEl && nodeEl.dataset.nodeId) {
        e.preventDefault();
        deleteSelectedNode(nodeEl);
        return;
      }
    }

    if (editMode && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicateSelection();
      return;
    }

    if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
    const key = e.key.toLowerCase();
    if (key === "z") {
      e.preventDefault();
      undo();
    } else if (key === "y") {
      e.preventDefault();
      redo();
    }
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
    return {
      minX: Math.min(...nodes.map(n => n.x)),
      minY: Math.min(...nodes.map(n => n.y)),
      maxX: Math.max(...nodes.map(n => n.x + n.w)),
      maxY: Math.max(...nodes.map(n => n.y + n.h)),
      w: Math.max(...nodes.map(n => n.x + n.w)) - Math.min(...nodes.map(n => n.x)),
      h: Math.max(...nodes.map(n => n.y + n.h)) - Math.min(...nodes.map(n => n.y)),
    };
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
    const clone = JSON.parse(JSON.stringify(node));
    clone.id = newId();
    if (clone.fieldType === "picture") clone.isAvatar = false;
    if (Array.isArray(clone.children)) {
      clone.children = clone.children.map((child) => {
        const c = JSON.parse(JSON.stringify(child));
        c.id = newId();
        if (c.fieldType === "picture") c.isAvatar = false;
        return c;
      });
    }
    return clone;
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
    const fitsRight = box.maxX + box.w <= PAGE_COLS;
    const dx = fitsRight ? box.w : 0;
    const dy = fitsRight ? 0 : box.h;
    return blocks.map((b) => {
      const clone = cloneWithNewIds(b);
      clone.x = b.x + dx;
      clone.y = b.y + dy;
      currentLayout().push(clone);
      return clone;
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
    const dx = fitsRight ? box.w : 0;
    const dy = fitsRight ? 0 : box.h;
    if (!fitsRight) {
      const contentRows = block.h - BLOCK_HEADER_ROWS;
      const neededRows = box.minY + dy + box.h;
      if (neededRows > contentRows) {
        block.h += (neededRows - contentRows);
      }
    }
    return fields.map((f) => {
      const clone = cloneWithNewIds(f);
      clone.x = f.x + dx;
      clone.y = f.y + dy;
      block.children.push(clone);
      return clone;
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
    const blocksToDuplicate = currentLayout().filter((b) => selectedIds.has(b.id));
    const coveredFieldIds = new Set();
    blocksToDuplicate.forEach((b) => (b.children || []).forEach((f) => coveredFieldIds.add(f.id)));

    const fieldGroups = new Map(); // block -> [fields], for fields selected independently of their block
    currentLayout().forEach((block) => {
      if (selectedIds.has(block.id)) return;
      (block.children || []).forEach((f) => {
        if (selectedIds.has(f.id) && !coveredFieldIds.has(f.id)) {
          if (!fieldGroups.has(block)) fieldGroups.set(block, []);
          fieldGroups.get(block).push(f);
        }
      });
    });

    if (blocksToDuplicate.length === 0 && fieldGroups.size === 0) return;

    commitMutation(() => {
      const newIds = new Set();
      duplicateBlocksOnGrid(blocksToDuplicate).forEach((b) => {
        newIds.add(b.id);
        (b.children || []).forEach((f) => newIds.add(f.id));
      });
      fieldGroups.forEach((fields, block) => {
        duplicateFieldsInBlock(block, fields).forEach((f) => newIds.add(f.id));
      });
      selectedIds = newIds;
    });
  }

  function deleteBlockNode(block) {
    const viewBlock = effectiveBlock(block);
    if ((viewBlock.children || []).length > 0 && !window.confirm(`Delete block "${viewBlock.name}" and everything in it?`)) return;
    commitMutation(() => {
      const layout = currentLayout();
      const idx = layout.findIndex(b => b.id === block.id);
      if (idx >= 0) layout.splice(idx, 1);
    });
  }

  function deleteFieldNode(field) {
    commitMutation(() => {
      const arr = findParentArray(globalLayout(), field.id) || findParentArray(currentLayout(), field.id);
      if (arr) {
        const idx = arr.findIndex(n => n.id === field.id);
        arr.splice(idx, 1);
      }
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

  function mirrorFirstTabLayout() {
    character.layout = character.sheetTabs[0]?.layout || [];
  }

  function activeTab() {
    // While character creation hasn't been finished yet, always force
    // the Character-setup (wizard) tab regardless of what activeTabId
    // says — there's nothing else to show yet, and the tab bar itself
    // is hidden during this phase anyway (see renderAll below).
    if (!character.setupComplete) {
      return character.sheetTabs.find(tab => tab.kind === "rules") || character.sheetTabs[0];
    }
    return character.sheetTabs.find(tab => tab.id === activeTabId) || character.sheetTabs[0];
  }

  function activeTabIndex() {
    return character.sheetTabs.findIndex(tab => tab.id === activeTab().id);
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
    const list = [];
    character.sheetTabs.forEach(tab => {
      (tab.layout || []).forEach(block => {
        (block.children || []).forEach(field => list.push(field));
      });
    });
    return list;
  }

  function isLabelAlreadyInUse(label, excludeField) {
    const norm = label.trim().toLowerCase();
    return flattenAllFieldsAcrossTabs().some(
      f => f !== excludeField && f.label && f.label.trim().toLowerCase() === norm
    );
  }

  // In priority order — the first of these that exists wins, when
  // scanning for a pre-existing money field (see detectMoneyFieldByName).
  const MONEY_FIELD_NAMES = ["money", "gp", "currency", "$", "$$", "$$$"];

  function detectMoneyFieldByName() {
    const fields = flattenAllFieldsAcrossTabs().filter(f => f.fieldType === "text");
    for (const name of MONEY_FIELD_NAMES) {
      const match = fields.find(f => (f.label || "").trim().toLowerCase() === name);
      if (match) return match;
    }
    return null;
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
    if (character.moneyFieldId || field.fieldType !== "text") return;
    if (MONEY_FIELD_NAMES.includes((field.label || "").trim().toLowerCase())) {
      character.moneyFieldId = field.id;
      saveWithStatus("moneyFieldId", character.moneyFieldId);
    }
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
    commitMutation(() => {
      field.moneyFieldId = detected.id;
      if (!character.moneyFieldId) character.moneyFieldId = detected.id;
    }, { render: false });
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
    const tmp = document.createElement("div");
    tmp.innerHTML = field.value || "";
    const n = parseFloat((tmp.textContent || "").trim());
    return Number.isFinite(n) ? n : 0;
  }

  /** Migrates a dropdown's choices from the old plain-string shape to
   *  { id, text, bundle } objects (needed once bundles exist — a
   *  choice needs somewhere to hang stat/access modifiers off of) and
   *  backfills a missing `bundle` on already-migrated choices. Also
   *  remaps `.selected` from the old text value to the new id, since
   *  selection is tracked by id from here on (stable across renames,
   *  same reasoning as everything else keyed by id in this file). */
  function normalizeChoiceObjects(allFields) {
    let changed = false;
    allFields.forEach((field) => {
      if (field.fieldType !== "dropdown" || !Array.isArray(field.choices)) return;
      const hadStrings = field.choices.some(c => typeof c === "string");
      if (hadStrings) {
        const oldSelectedText = field.selected;
        field.choices = field.choices.map(c =>
          typeof c === "string" ? { id: newId(), text: c, bundle: null } : c
        );
        if (oldSelectedText) {
          const match = field.choices.find(c => c.text === oldSelectedText);
          field.selected = match ? match.id : null;
        }
        changed = true;
      } else {
        field.choices.forEach((c) => {
          if (c.bundle === undefined) { c.bundle = null; changed = true; }
        });
      }
    });
    return changed;
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
    if (!character.levelFieldId) return Infinity;
    const v = valueMap[character.levelFieldId];
    return Number.isFinite(v) ? v : 0;
  }

  function getAllowedChoiceIds(field, allFields) {
    let allowed = new Set((field.choices || []).map(c => c.id));
    const level = currentLevel(formulaValues);
    let narrowedByBundle = false;
    allFields.forEach((other) => {
      if (other.fieldType !== "dropdown" || other === field) return;
      const choice = (other.choices || []).find(c => c.id === other.selected);
      const bundle = choice && choice.bundle;
      if (!bundle) return;
      (bundle.dropdownAccess || []).forEach((rule) => {
        if (rule.targetFieldId !== field.id) return;
        if (rule.minLevel && level < rule.minLevel) return; // not unlocked yet
        const ruleSet = new Set(rule.allowedChoiceIds || []);
        allowed = new Set([...allowed].filter(id => ruleSet.has(id)));
        narrowedByBundle = true;
      });
    });
    // Fallback only. If an applied Class bundle already narrowed the
    // Subclass field via a real dropdownAccess rule above (imported from
    // JSON — see default-bundles/*.json), that data wins outright and
    // this hardcoded PHB table is skipped, so a full imported subclass
    // list never gets clipped back down to the small built-in one. This
    // only kicks in for sheets that don't have a bundle wired up yet.
    if (!narrowedByBundle && (field.id === "subclass" || field.label === "Subclass")) {
      const className = selectedChoiceName("class", "Class");
      const classEntry = getRulesetClass(character.rules?.rulesetId || character.rulesetId, className);
      const level = currentCharacterLevel();
      if (classEntry && level != null) {
        const names = level >= classEntry.subclassLevel ? new Set(classEntry.subclasses) : new Set();
        allowed = new Set([...allowed].filter((id) => {
          const choice = (field.choices || []).find((candidate) => candidate.id === id);
          return names.has(choice?.text);
        }));
      }
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
    let changed = false;
    allFields.forEach((field) => {
      if (field.fieldType !== "dropdown" || !field.selected) return;
      if (!getAllowedChoiceIds(field, allFields).has(field.selected)) {
        field.selected = null;
        changed = true;
      }
    });
    return changed;
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
   *  computed layer to hook into. */
  function applyStatModifiers(modifiers, valueMap, checkboxGrants, level) {
    (modifiers || []).forEach((mod) => {
      if (!mod.targetFieldId) return;
      if (mod.minLevel && level < mod.minLevel) return;
      if (mod.op === "grant") {
        const key = `${mod.targetFieldId}::${mod.targetIndex || 0}`;
        checkboxGrants.add(key);
        valueMap[key] = 1;
        return;
      }
      const current = Number.isFinite(valueMap[mod.targetFieldId]) ? valueMap[mod.targetFieldId] : 0;
      const amount = Number.isFinite(mod.value) ? mod.value : 0;
      switch (mod.op) {
        case "add": valueMap[mod.targetFieldId] = current + amount; break;
        case "subtract": valueMap[mod.targetFieldId] = current - amount; break;
        case "multiply": valueMap[mod.targetFieldId] = current * amount; break;
        case "set": valueMap[mod.targetFieldId] = amount; break;
        default: break;
      }
    });
  }

  function activeRuleChoiceGroups(fields, valueMap) {
    const level = currentLevel(valueMap);
    const groups = [];
    fields.forEach((field) => {
      if (field.fieldType !== "dropdown") return;
      const choice = (field.choices || []).find((candidate) => candidate.id === field.selected);
      const bundle = choice?.bundle;
      (bundle?.choiceGroups || []).forEach((group, index) => {
        if (group.minLevel && level < group.minLevel) return;
        if (!Array.isArray(group.options) || group.options.length === 0) return;
        groups.push({
          ...group,
          key: `${field.id}:${choice.id}:${group.id || index}`,
          source: choice.text || field.label,
          minLevel: Number.isFinite(group.minLevel) ? group.minLevel : 0,
          maxSelections: Math.max(1, Number.parseInt(group.maxSelections, 10) || 1),
          minSelections: Math.max(0, Number.parseInt(group.minSelections, 10) || 0),
        });
      });
    });
    return groups;
  }

  function selectedRuleOptions(fields, valueMap) {
    const selections = character.rules?.choices || {};
    return activeRuleChoiceGroups(fields, valueMap).flatMap((group) => {
      const selected = new Set(Array.isArray(selections[group.key]) ? selections[group.key] : []);
      return group.options
        .filter((option) => selected.has(option.id))
        .map((option) => ({ option, group }));
    });
  }

  function applyBundleModifiers(fields, valueMap, grantedCheckboxes) {
    const level = currentLevel(valueMap);
    fields.forEach((field) => {
      if (field.fieldType !== "dropdown") return;
      const choice = (field.choices || []).find(c => c.id === field.selected);
      const bundle = choice && choice.bundle;
      if (!bundle) return;
      applyStatModifiers(bundle.statModifiers, valueMap, grantedCheckboxes, level);
    });
    selectedRuleOptions(fields, valueMap).forEach(({ option }) => {
      applyStatModifiers(option.statModifiers, valueMap, grantedCheckboxes, level);
    });
  }

  /** Companion to applyBundleModifiers, same "walk every dropdown's
   *  selected bundle" shape, but for featureGrants instead of
   *  statModifiers — these are display-only (a name + description
   *  string, e.g. "Rage"), so unlike statModifiers/the "grant" op they
   *  never touch valueMap, just the returned list. Multiple bundles
   *  (Class AND Race AND Background, say) can each contribute features
   *  at the same render; entries are tagged with `source` (the
   *  dropdown field's label) so a duplicate feature name from two
   *  different bundles still shows twice rather than silently
   *  colliding. Sorted by level then source so a level-up visibly adds
   *  new entries at the bottom of "so far" rather than reshuffling
   *  the whole list. */
  function collectGrantedFeatures(fields, valueMap) {
    const level = currentLevel(valueMap);
    const features = [];
    fields.forEach((field) => {
      if (field.fieldType !== "dropdown") return;
      const choice = (field.choices || []).find(c => c.id === field.selected);
      const bundle = choice && choice.bundle;
      if (!bundle) return;
      (bundle.featureGrants || []).forEach((grant) => {
        if (grant.minLevel && level < grant.minLevel) return; // not unlocked yet
        features.push({
          name: grant.name,
          description: grant.description || "",
          level: Number.isFinite(grant.minLevel) ? grant.minLevel : 0,
          source: field.label,
        });
      });
    });
    selectedRuleOptions(fields, valueMap).forEach(({ option, group }) => {
      (option.featureGrants || []).forEach((grant) => {
        features.push({
          name: grant.name,
          description: grant.description || "",
          level: group.minLevel,
          source: option.name || group.label || group.source,
        });
      });
    });
    features.sort((a, b) => a.level - b.level || a.source.localeCompare(b.source));
    return features;
  }

  function collectResourceGrants(fields, valueMap) {
    const level = currentLevel(valueMap);
    const resources = [];
    const add = (grant, key, source) => {
      if (grant.minLevel && level < grant.minLevel) return;
      const maximum = Math.max(0, Number.parseInt(grant.maximum, 10) || 0);
      if (!grant.name || maximum < 1) return;
      resources.push({
        key,
        name: grant.name,
        maximum,
        reset: grant.reset || "rest",
        source,
      });
    };
    fields.forEach((field) => {
      if (field.fieldType !== "dropdown") return;
      const choice = (field.choices || []).find((candidate) => candidate.id === field.selected);
      const bundle = choice?.bundle;
      (bundle?.resourceGrants || []).forEach((grant, index) => {
        add(grant, `${field.id}:${choice.id}:resource:${grant.id || index}`, choice.text || field.label);
      });
    });
    selectedRuleOptions(fields, valueMap).forEach(({ option, group }) => {
      (option.resourceGrants || []).forEach((grant, index) => {
        add(grant, `${group.key}:${option.id}:resource:${grant.id || index}`, option.name || group.label || group.source);
      });
    });
    return resources;
  }

  function computeSheetValues(fields) {
    const valueMap = computeAllFormulas(fields);
    grantedCheckboxes = new Set();
    applyBundleModifiers(fields, valueMap, grantedCheckboxes);
    grantedFeatures = collectGrantedFeatures(fields, valueMap);
    // One more settle pass so anything a bundle modifier just changed
    // (e.g. a race bonus on Strength) flows through to formulas that
    // reference it (e.g. a Strength-based skill).
    const formulaFields = fields.filter(f => f.fieldType === "text" && f.formula);
    for (let pass = 0; pass < 3; pass++) {
      formulaFields.forEach((f) => {
        const result = evaluateFormulaNode(f.formula, valueMap);
        if (Number.isFinite(result)) valueMap[f.id] = result;
      });
    }
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
    const counts = {};
    fields.forEach((f) => {
      if (f.fieldType === "radio" && f.optionsFormula) {
        const result = evaluateFormulaNode(f.optionsFormula, valueMap);
        counts[f.id] = Number.isFinite(result) ? Math.max(0, Math.round(result)) : 0;
      }
    });
    return counts;
  }

  /** If a radio field's formula-driven button count just shrank below
   *  its current selection (e.g. a spell-slot tier that goes away as
   *  a multiclass split changes), clear the now out-of-range selection
   *  rather than leave it silently pointing at a button that no longer
   *  exists — same reasoning as normalizeDropdownSelections. */
  function normalizeRadioSelections(fields, counts) {
    let changed = false;
    fields.forEach((f) => {
      if (f.fieldType !== "radio" || !f.optionsFormula || f.selected == null) return;
      const count = counts[f.id] || 0;
      if (f.selected > count) {
        f.selected = count > 0 ? count : null;
        changed = true;
      }
    });
    return changed;
  }

  function sourceBlockFor(block) {
    if (!block.sourceBlockId) return block;
    return globalLayout().find(candidate => candidate.id === block.sourceBlockId) || block;
  }

  function effectiveStyle(block) {
    const source = sourceBlockFor(block);
    return { ...(source.style || {}), ...(block.styleOverrides || {}) };
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

  function valuesMatch(a, b) {
    return (a ?? null) === (b ?? null);
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

  function mergeTextStyle(baseStyle = {}, localStyle = {}) {
    return {
      ...localStyle,
      fontFamily: localStyle.fontFamily ?? baseStyle.fontFamily ?? null,
      fontSize: localStyle.fontSize ?? baseStyle.fontSize ?? null,
      bold: !!(localStyle.bold || baseStyle.bold),
      italic: !!(localStyle.italic || baseStyle.italic),
      underline: !!(localStyle.underline || baseStyle.underline),
      color: localStyle.color ?? baseStyle.color ?? null,
    };
  }

  function effectiveBlock(block) {
    const source = sourceBlockFor(block);
    return {
      ...source,
      ...block,
      blockType: source.blockType || block.blockType || "stat",
      name: source.name || block.name,
      children: source.children || block.children || [],
      style: effectiveStyle(block),
    };
  }

  function blockTabs(blockId) {
    return character.sheetTabs
      .filter(tab => tab.layout.some(block => block.id === blockId || block.sourceBlockId === blockId))
      .map(tab => tab.name);
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
    const natural = (availableWidth - (PAGE_COLS - 1) * GAP_PX) / PAGE_COLS;
    return Math.max(MIN_CELL_PX, natural);
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
    el.style.left = `${node.x * (cw + GAP_PX) + inset}px`;
    el.style.top = `${node.y * (cw + GAP_PX) + inset}px`;
    el.style.width = `${node.w * cw + (node.w - 1) * GAP_PX - inset * 2}px`;
    el.style.height = `${node.h * cw + (node.h - 1) * GAP_PX - inset * 2}px`;
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
    const maxW = parentBlock.w - field.x;
    if (field.w >= maxW || labelEl.scrollWidth <= labelEl.clientWidth + 1) return false;
    while (labelEl.scrollWidth > labelEl.clientWidth + 1 && field.w < maxW) {
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
    const maxW = parentBlock.w - field.x;
    if (field.w >= maxW || labelEl.scrollWidth <= labelEl.clientWidth + 1) return;
    commitMutation(() => {
      growFieldToFitLabel(labelEl, field, fieldEl, parentBlock);
    }, { render: false });
  }

  function applyNodeStyle(el, style) {
    el.style.background = style.bg || "";
    el.style.backgroundImage = style.bgImage ? `url(${style.bgImage})` : "";
    el.style.backgroundSize = style.bgImage ? "cover" : "";
    el.style.backgroundPosition = style.bgImage ? "center" : "";
    el.style.fontFamily = style.fontFamily || "";
    el.style.fontSize = style.fontSize ? `${style.fontSize}px` : "";
    el.style.fontWeight = style.bold ? "bold" : "";
    el.style.fontStyle = style.italic ? "italic" : "";
    el.style.textDecoration = style.underline ? "underline" : "";
    el.style.color = style.color || "";
    el.classList.toggle("border-hidden", style.showBorder === false);
  }

  function renderPageGrid() {
    pageGrid.innerHTML = "";
    pageGrid.classList.toggle("is-edit-mode", editMode);
    pendingLabelOverflowChecks = [];
    const allFields = flattenGlobalFields();
    let needsNormalizedPersist = false;
    if (normalizeChoiceObjects(allFields)) needsNormalizedPersist = true;
    // Computed BEFORE normalizing dropdown selections (not after, as
    // you might expect) so that a minLevel-gated dropdown-access rule
    // (see getAllowedChoiceIds) checks the level this render actually
    // computed, not last render's — otherwise leveling up and a
    // selection becoming valid/invalid again would always be one
    // render behind. If normalizing invalidates a selection, that can
    // in turn change which bundle is active, so it's recomputed once
    // more afterward — same "a few passes to settle" idea
    // computeSheetValues already uses internally.
    formulaValues = computeSheetValues(allFields);
    if (normalizeDropdownSelections(allFields)) {
      needsNormalizedPersist = true;
      formulaValues = computeSheetValues(allFields);
    }
    radioOptionCounts = computeRadioOptionCounts(allFields, formulaValues);
    if (normalizeRadioSelections(allFields, radioOptionCounts)) {
      needsNormalizedPersist = true;
    }
    if (needsNormalizedPersist) persist();
    const availableHeight = availableViewportHeight();
    scrollWrapper.style.height = `${availableHeight}px`;

    if (activeTab().kind === "leveling" || activeTab().kind === "rules") {
      pageGrid.classList.add("page-grid--leveling");
      pageGrid.style.width = "";
      pageGrid.style.height = "";
      pageGrid.style.backgroundImage = "";
      pageGrid.style.backgroundPosition = "";
      if (activeTab().kind === "rules") renderRulesTab();
      else renderLevelingTab();
      return;
    }
    pageGrid.classList.remove("page-grid--leveling");

    const cw = colWidthPx();
    // Explicit width so the grid can exceed the wrapper's width (and
    // scroll) once cw hits its floor, rather than being crushed to fit.
    pageGrid.style.width = `${PAGE_COLS * cw + (PAGE_COLS - 1) * GAP_PX}px`;
    // At least tall enough to fill the visible canvas (so there's
    // always room to drag things into open space), taller only if the
    // actual content needs more — in which case it scrolls.
    const contentPx = contentHeight(currentLayout()) * (cw + GAP_PX);
    pageGrid.style.height = `${Math.max(availableHeight, contentPx)}px`;
    applyGridLines(pageGrid, cw);
    currentLayout().forEach(block => {
      pageGrid.append(renderBlockNode(block, cw));
    });

    // Every field is now actually in the document and has real layout,
    // so this is the first point where checking a label against its
    // cell means anything (see the comment on pendingLabelOverflowChecks
    // above, and on growFieldToFitLabel). Deliberately not wrapped in
    // commitMutation/persist — this is a fresh, idempotent fit-up of
    // whatever's on screen right now, not a discrete edit worth its own
    // undo step, and it isn't needed for correctness on the next load
    // either: an unpersisted grow just gets recomputed the same way
    // next time this runs.
    pendingLabelOverflowChecks.forEach(({ labelEl, field, fieldEl, parentBlock }) => {
      growFieldToFitLabel(labelEl, field, fieldEl, parentBlock);
    });

    // Now that every block is actually laid out, re-anchor each one's
    // local body grid to the page grid's phase (see applyGridLines).
    if (editMode) {
      pageGrid.querySelectorAll(".block-body").forEach(bodyEl => {
        applyGridLines(bodyEl, cw, pageGrid);
      });
    }

    paintSelection(); // a full render tears down and rebuilds every
      // .grid-node — repaint .is-selected on whichever ones still
      // exist, so selection survives an unrelated edit elsewhere
    pageGrid.append(groupToolbar, groupBorderOverlay); // innerHTML="" above
      // wiped them out along with everything else — they're persistent
      // elements (created once, not per-render), so just put them back
      // rather than rebuild them
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

  const LEVEL_UP_FIELDS = [
    { key: "hp", label: "HP Gained", placeholder: "e.g. +7, or rolled 1d8+2" },
    { key: "asiFeat", label: "Ability Score Improvement / Feat", placeholder: "e.g. +2 STR, or the Alert feat" },
    { key: "subclass", label: "Subclass", placeholder: "e.g. Champion" },
    { key: "skillProfs", label: "Skill Proficiencies Gained", placeholder: "e.g. Persuasion, Insight" },
    { key: "itemProfs", label: "Tool / Weapon / Armor Proficiencies Gained", placeholder: "e.g. Thieves' Tools" },
    { key: "spells", label: "Spells Learned / Prepared", placeholder: "e.g. Fireball, Misty Step" },
    { key: "features", label: "Features Gained", placeholder: "e.g. Extra Attack, Uncanny Dodge" },
    { key: "notes", label: "Notes", placeholder: "Anything else worth remembering" },
  ];

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
    const field = flattenGlobalFields().find((candidate) => candidate.id === fieldId)
      || flattenGlobalFields().find((candidate) => candidate.fieldType === "dropdown" && candidate.label === label);
    if (!field || field.fieldType !== "dropdown") return "";
    return (field.choices || []).find((choice) => choice.id === field.selected)?.text || "";
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
    const rule = classChoice?.bundle?.dropdownAccess?.find((r) => r.targetFieldId === subclassField?.id);
    if (rule && subclassField) {
      const idSet = new Set(rule.allowedChoiceIds || []);
      const names = subclassField.choices.filter((c) => idSet.has(c.id)).map((c) => c.text);
      if (names.length) {
        return { subclasses: names, subclassLevel: Number.isFinite(rule.minLevel) ? rule.minLevel : 1 };
      }
    }
    const classEntry = getRulesetClass(character.rules?.rulesetId || character.rulesetId, className);
    return classEntry
      ? { subclasses: classEntry.subclasses, subclassLevel: classEntry.subclassLevel }
      : { subclasses: [], subclassLevel: Infinity };
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
   *  Every step's dot is clickable, and Back always works — there's no
   *  "locking in" a step. Re-picking an earlier answer (e.g. Class)
   *  just edits the same live field/bundle data every other part of
   *  the sheet reads from, so nothing needs to be specially undone;
   *  see getAllowedChoiceIds/applyBundleModifiers, which recompute
   *  everything from the current selection on every render anyway. */
  function renderStepWizard(steps, stepState, { title, intro } = {}) {
    const stepApplicable = (step) => !step.isApplicable || step.isApplicable();
    const applicableSteps = steps.filter(stepApplicable);
    if (applicableSteps.length === 0) return null;
    if (stepState.index >= applicableSteps.length) stepState.index = applicableSteps.length - 1;
    if (stepState.index < 0) stepState.index = 0;

    const wrap = document.createElement("section");
    wrap.className = "leveling-tab character-rules wizard";
    if (title) {
      const heading = document.createElement("h2");
      heading.textContent = title;
      wrap.append(heading);
    }
    if (intro) {
      const introEl = document.createElement("p");
      introEl.className = "leveling-tab__intro";
      introEl.textContent = intro;
      wrap.append(introEl);
    }

    const dots = document.createElement("div");
    dots.className = "wizard__dots";
    // Every step gets a dot, even ones that don't currently apply (e.g.
    // "Feats" for a class/level combo that doesn't grant one at
    // creation) — those render disabled with a tooltip explaining why,
    // rather than disappearing outright, so the wizard's shape doesn't
    // shift around as earlier answers change. Next/Back still only
    // walk applicableSteps, so an inapplicable step is skipped
    // automatically rather than needing to be clicked past.
    steps.forEach((step) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.textContent = step.title;
      if (!stepApplicable(step)) {
        dot.className = "wizard__dot wizard__dot--disabled";
        dot.disabled = true;
        if (step.unavailableMessage) dot.title = step.unavailableMessage();
        dots.append(dot);
        return;
      }
      const i = applicableSteps.indexOf(step);
      dot.className = "wizard__dot"
        + (i === stepState.index ? " wizard__dot--active" : "")
        + (i < stepState.index ? " wizard__dot--done" : "");
      dot.addEventListener("click", () => { stepState.index = i; renderPageGrid(); });
      dots.append(dot);
    });
    wrap.append(dots);

    const currentStep = applicableSteps[stepState.index];
    if (currentStep.descriptionItems && currentStep.descriptionItems.length) {
      const list = document.createElement("ul");
      list.className = "leveling-tab__intro wizard__step-description wizard__step-description--list";
      currentStep.descriptionItems.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        list.append(li);
      });
      wrap.append(list);
    } else if (currentStep.description) {
      const description = document.createElement("p");
      description.className = "leveling-tab__intro wizard__step-description";
      description.textContent = currentStep.description;
      wrap.append(description);
    }

    const body = document.createElement("div");
    body.className = "wizard__body level-guide__form";
    wrap.append(body);
    currentStep.render(body);

    const nav = document.createElement("div");
    nav.className = "wizard__nav";
    if (stepState.index > 0) {
      const back = document.createElement("button");
      back.type = "button";
      back.className = "btn";
      back.textContent = "← Back";
      back.addEventListener("click", () => { stepState.index -= 1; renderPageGrid(); });
      nav.append(back);
    }
    if (stepState.index < applicableSteps.length - 1) {
      const forward = document.createElement("button");
      forward.type = "button";
      forward.className = "btn btn--primary";
      forward.textContent = "Next →";
      forward.addEventListener("click", () => { stepState.index += 1; renderPageGrid(); });
      nav.append(forward);
    }
    wrap.append(nav);
    return wrap;
  }

  /** Bundle-library class/race/background names tagged to a ruleset —
   *  same live-over-hardcoded preference as liveSubclassData, so the
   *  wizard's pickers immediately reflect an imported classes.json
   *  instead of the small built-in PHB list. Falls back to the
   *  hardcoded ruleset's class list (Class only — Race/Background have
   *  no hardcoded fallback since they were never in dnd5e.js). */
  function rulesetOptionNames(rulesetId, category, fallback = []) {
    const fromBundles = bundleLibraryCache
      .filter((entry) => entry.rulesetId === rulesetId && entry.category === category)
      .map((entry) => entry.name);
    return fromBundles.length ? fromBundles : fallback;
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
    if (!name) return null;
    const norm = (s) => (s || "").trim().toLowerCase();
    const catalog = catalogCache.find((c) => keywords.some((kw) => norm(c.name).includes(kw)));
    if (!catalog) return null;
    for (const tab of catalog.tabs || []) {
      const entry = (tab.entries || []).find((e) => norm(e.name) === norm(name));
      if (entry) return { description: entry.description || "", imageData: entry.imageData || null };
    }
    return null;
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
   *  distinct from, its parent" styling. */
  function renderSelectableRows(container, names, { selectedName, onSelect, getInfo, afterRow, nested = false } = {}) {
    const list = document.createElement("div");
    list.className = "choice-row-list" + (nested ? " choice-row-list--nested" : "");
    names.forEach((name) => {
      const info = getInfo ? getInfo(name) : null;
      const selected = name === selectedName;
      const row = document.createElement("div");
      row.className = "choice-row" + (nested ? " choice-row--nested" : "") + (selected ? " choice-row--selected" : "");
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-pressed", String(selected));
      row.addEventListener("click", () => onSelect(name));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(name); }
      });
      const portrait = document.createElement("div");
      portrait.className = "choice-row__portrait";
      if (info?.imageData) {
        const img = document.createElement("img");
        img.src = info.imageData;
        img.alt = "";
        portrait.append(img);
      } else {
        portrait.textContent = (name || "?").charAt(0).toUpperCase();
      }
      row.append(portrait);
      const body = document.createElement("div");
      body.className = "choice-row__body";
      const label = document.createElement("div");
      label.className = "choice-row__label";
      label.textContent = name;
      body.append(label);
      const desc = document.createElement("div");
      desc.className = "choice-row__description";
      desc.textContent = info?.description || "No description available yet.";
      body.append(desc);
      row.append(body);
      list.append(row);
      if (afterRow) afterRow(name, row);
    });
    container.append(list);
    return list;
  }

  // Which free-text choiceGroup.label a group's checkboxes/radios land
  // under in the creation wizard — best-effort keyword match since
  // groups aren't tagged with a category anywhere upstream (see the
  // bundle library editor). "proficiencies" is the catch-all so an
  // unrecognized label still surfaces somewhere rather than silently
  // vanishing from the wizard.
  const CREATION_CHOICE_CATEGORIES = [
    { key: "spells", title: "Spells & Special Abilities", test: /spell|cantrip|invocation/i },
    { key: "languages", title: "Languages", test: /language/i },
    { key: "equipment", title: "Starting Equipment", test: /equipment|\bgear\b|weapon|armor|\bpack\b/i },
    { key: "feats", title: "Feats", test: /\bfeat\b/i },
    { key: "proficiencies", title: "Ability Proficiencies", test: null },
  ];

  function categorizeChoiceGroup(group) {
    const label = group.label || "";
    const found = CREATION_CHOICE_CATEGORIES.find((cat) => cat.test && cat.test.test(label));
    return (found || CREATION_CHOICE_CATEGORIES[CREATION_CHOICE_CATEGORIES.length - 1]).key;
  }

  /** Creation-time equivalent of activeRuleChoiceGroups (used during
   *  Leveling, see below) — that one reads a dropdown FIELD's selected
   *  choice's bundle, which doesn't exist yet at creation time since
   *  nothing's been synced to the sheet. This instead looks straight
   *  up bundleLibraryCache by category+name for whichever Race/Class/
   *  Subclass/Background the wizard's earlier steps have already set
   *  on character.rules — the same matching rule syncRulesToSheet uses
   *  when it applies these bundles for real at Finish Setup. */
  function creationChoiceGroupsFor(state) {
    const norm = (s) => (s || "").trim().toLowerCase();
    const level = state.level;
    const groups = [];
    const push = (category, name) => {
      if (!name) return;
      const lib = bundleLibraryCache.find((entry) => entry.rulesetId === state.rulesetId
        && norm(entry.category) === norm(category) && norm(entry.name) === norm(name));
      (lib?.choiceGroups || []).forEach((group, index) => {
        if (group.minLevel && level < group.minLevel) return;
        if (!Array.isArray(group.options) || group.options.length === 0) return;
        groups.push({
          ...group,
          key: `creation:${category}:${name}:${group.id || index}`,
          source: name,
          minLevel: Number.isFinite(group.minLevel) ? group.minLevel : 0,
          maxSelections: Math.max(1, Number.parseInt(group.maxSelections, 10) || 1),
          minSelections: Math.max(0, Number.parseInt(group.minSelections, 10) || 0),
        });
      });
    };
    push("Race", state.species);
    push("Class", state.className);
    push("Subclass", state.subclass);
    push("Background", state.background);
    return groups;
  }

  // Same checkbox/radio-group rendering as the Leveling wizard's
  // "Choices" step (see the contentGroups step further down), just
  // writing straight to character.rules.choices instead of a staged
  // "pending" object — the creation wizard's other steps (Race,
  // Class...) already mutate character.rules directly the same way.
  function renderCreationChoiceGroups(container, groups, saveRules) {
    if (!groups.length) {
      const note = document.createElement("p");
      note.className = "leveling-tab__intro";
      note.textContent = "Nothing to choose here yet for your current Race/Class/Background selections.";
      container.append(note);
      return;
    }
    groups.forEach((group) => {
      if (!character.rules.choices[group.key]) character.rules.choices[group.key] = [];
      const choiceGroup = document.createElement("fieldset");
      choiceGroup.className = "level-guide__choices";
      const legend = document.createElement("legend");
      const count = group.minSelections === group.maxSelections
        ? `Choose ${group.maxSelections}`
        : `Choose up to ${group.maxSelections}`;
      legend.textContent = `${group.label || "Choose an option"} (${count})`;
      choiceGroup.append(legend);
      const source = document.createElement("p");
      source.className = "level-guide__choice-source";
      source.textContent = group.source;
      choiceGroup.append(source);
      group.options.forEach((option) => {
        const optionLabel = document.createElement("label");
        optionLabel.className = "level-guide__choice-option";
        const input = document.createElement("input");
        input.type = group.maxSelections === 1 ? "radio" : "checkbox";
        input.name = `creation-choice-${group.key}`;
        input.value = option.id;
        input.checked = character.rules.choices[group.key].includes(option.id);
        input.addEventListener("change", () => {
          const selected = character.rules.choices[group.key];
          if (input.type === "radio") {
            character.rules.choices[group.key] = input.checked ? [option.id] : [];
          } else if (input.checked) {
            if (!selected.includes(option.id)) selected.push(option.id);
          } else {
            character.rules.choices[group.key] = selected.filter((id) => id !== option.id);
          }
          saveRules();
        });
        const text = document.createElement("span");
        text.textContent = option.name || "Unnamed option";
        optionLabel.append(input, text);
        if (option.description) {
          const description = document.createElement("span");
          description.className = "level-guide__choice-description";
          description.textContent = option.description;
          optionLabel.append(description);
        }
        choiceGroup.append(optionLabel);
      });
      container.append(choiceGroup);
    });
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
  function syncRulesetBundles(rulesetId) {
    if (!rulesetId) return null;
    const allFields = flattenGlobalFields();
    const norm = (s) => (s || "").trim().toLowerCase();
    const rulesetBundles = bundleLibraryCache.filter((entry) => entry.rulesetId === rulesetId);
    if (!rulesetBundles.length) return "No bundles are tagged for this ruleset yet — import some from the Bundle Libraries manager first.";
    let applied = 0;
    allFields.forEach((field) => {
      if (field.fieldType !== "dropdown") return;
      (field.choices || []).forEach((choice) => {
        const lib = rulesetBundles.find((entry) => norm(entry.name) === norm(choice.text));
        if (lib && applyBundleLibraryToChoice(lib, choice, allFields)) applied++;
      });
    });
    if (applied > 0) {
      mirrorFirstTabLayout();
      saveWithStatus("layout", character.layout);
    }
    return applied > 0
      ? `Wired up ${applied} choice${applied === 1 ? "" : "s"} from this ruleset's bundles.`
      : "Everything from this ruleset's bundles was already applied.";
  }

  const STANDARD_ASI_LEVELS = new Set([4, 8, 12, 16, 19]);

  /** Whether `level` grants an Ability Score Improvement for this
   *  class. featureGrants only records the FIRST level a feature
   *  appears (minLevel) — it has no way to say "and again at 6th,
   *  8th...", so a class that grants recurring ASIs (most of them)
   *  would only show one here if we went by minLevel alone. As a
   *  stand-in until featureGrants gains a real repeat-levels field,
   *  this trusts the standard 5e cadence (4/8/12/16/19) for any class
   *  that has an "Ability Score Improvement" feature at all, in
   *  addition to whatever minLevel it's actually tagged at (which
   *  covers homebrew classes that grant it on a different schedule,
   *  as long as they're at least tagged once). */
  function classGrantsAsiAtLevel(className, level) {
    const classField = findStarterField("class", "Class");
    const choice = classField?.choices?.find((c) => c.text === className);
    const grants = choice?.bundle?.featureGrants || [];
    const asiFeature = grants.find((g) => /ability score improvement/i.test(g.name || ""));
    if (!asiFeature) return false;
    return level === asiFeature.minLevel || STANDARD_ASI_LEVELS.has(level);
  }

  /** New featureGrants this class picks up exactly at `level` — shown
   *  as an informational step in the Leveling wizard. Only exact
   *  minLevel matches (not "at or above"), since anything from an
   *  earlier level was already shown when the character reached it. */
  function classFeatureGrantsAtLevel(className, level) {
    const classField = findStarterField("class", "Class");
    const choice = classField?.choices?.find((c) => c.text === className);
    return (choice?.bundle?.featureGrants || []).filter((g) => g.minLevel === level);
  }

  function findStarterField(id, label) {
    return flattenGlobalFields().find((field) => field.id === id)
      || flattenGlobalFields().find((field) => field.label === label);
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
    const holder = document.createElement("div");
    holder.innerHTML = field.value || "";
    const value = Number.parseInt(holder.textContent, 10);
    return Number.isFinite(value) ? value : 0;
  }

  function appendUniqueTextListItem(field, item) {
    if (!field || field.fieldType !== "textlist" || !item) return;
    if (!Array.isArray(field.items)) field.items = [];
    if (!field.items.includes(item)) field.items.push(item);
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
      if (!target || !value) return;
      let choice = target.choices?.find((entry) => entry.text === value);
      // If this ruleset's option came from an imported bundle rather
      // than a hand-built dropdown, the sheet might not have a
      // matching choice yet — create one so the bundle can still be
      // applied to it below.
      if (!choice && Array.isArray(target.choices)) {
        choice = { id: newId(), text: value, statModifiers: [] };
        target.choices.push(choice);
      }
      if (choice) target.selected = choice.id;
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
    // Now that the choices exist and are selected, apply any
    // ruleset-tagged library bundle whose name matches — same matching
    // rule as Bulk Apply, just run automatically for the three/four
    // fields the wizard just touched instead of requiring a trip to
    // each field's ⚙ editor.
    const norm = (s) => (s || "").trim().toLowerCase();
    [classField, speciesField, backgroundField, subclassField].forEach((target) => {
      if (!target) return;
      const choice = target.choices?.find((c) => c.id === target.selected);
      if (!choice) return;
      const lib = bundleLibraryCache.find((entry) => entry.rulesetId === character.rules.rulesetId && norm(entry.name) === norm(choice.text));
      if (lib) applyBundleLibraryToChoice(lib, choice, flattenGlobalFields());
    });
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
    await store.saveCharacterFields(character.id, { rules: character.rules, rulesetId: character.rules.rulesetId, layout: character.layout, sheetTabs: character.sheetTabs, setupComplete: true });
    statusEl.textContent = "Saved";
    renderAll();
  }

  function renderRulesTab() {
    const state = character.rules = normalizeRulesState(character.rules);
    const resolved = resolveRulesState(state);
    // Prefer a live, bundle-driven subclass list (from an applied
    // classes.json import) over resolveRulesState's hardcoded PHB one.
    const liveSubclasses = liveSubclassData(state.className);
    if (liveSubclasses.subclasses.length) {
      resolved.availableSubclasses = state.level >= liveSubclasses.subclassLevel ? liveSubclasses.subclasses : [];
    }
    const saveRules = debounce(() => saveWithStatus("rules", character.rules), 400);
    const field = (container, label, control) => {
      const group = document.createElement("label");
      group.className = "level-guide__field";
      group.textContent = label;
      group.append(control);
      container.append(group);
    };
    const update = (key, value) => {
      character.rules[key] = value;
      character.rules = normalizeRulesState(character.rules);
      // A subclass chosen for a different class, or one that needs a
      // higher Starting Level than is currently set, is otherwise left
      // behind stale — Review and Finish Setup would keep showing/
      // applying a subclass that no longer belongs to the current
      // Class/Starting Level pick (e.g. switching Wizard → Fighter
      // after choosing "Evoker", or dropping Starting Level back down
      // below a subclass's minimum level).
      if (character.rules.subclass) {
        const subs = liveSubclassData(character.rules.className);
        const eligible = subs.subclasses.includes(character.rules.subclass) && character.rules.level >= subs.subclassLevel;
        if (!eligible) character.rules.subclass = "";
      }
      saveRules();
      renderPageGrid();
    };

    function wizardFieldOptionNames(fieldId, fieldLabel) {
      const target = findStarterField(fieldId, fieldLabel);
      return (target?.choices || []).map((c) => c.text).filter(Boolean);
    }

    const ABILITY_DESCRIPTIONS = {
      str: "Physical power — melee attacks, carrying capacity, and Athletics checks.",
      dex: "Agility and reflexes — Armor Class, ranged attacks, initiative, and Acrobatics/Stealth checks.",
      con: "Endurance and fortitude — sets your hit points at every level.",
      int: "Reasoning and memory — Investigation/Arcana checks, and some casters' spells.",
      wis: "Awareness and intuition — Perception/Insight checks, and some casters' spells.",
      cha: "Force of personality — Persuasion/Deception checks, and some casters' spells.",
    };
    const POINT_BUY_MIN = 8;
    const POINT_BUY_MAX = 20;
    const POINT_BUY_BUDGET = 27;
    // Standard point-buy cost (1 point per point of score) through 13,
    // then 2 points per point from 14 on — extended up through 20
    // (rather than the usual 15 cap) per Shawn's ask.
    function pointBuyCost(score) {
      let cost = 0;
      for (let s = POINT_BUY_MIN + 1; s <= score; s++) cost += s >= 14 ? 2 : 1;
      return cost;
    }
    const rollAbilityScore = () => {
      const dice = [1, 2, 3, 4].map(() => 1 + Math.floor(Math.random() * 6)).sort((a, b) => a - b);
      dice.shift(); // drop the lowest of the four
      return dice.reduce((sum, n) => sum + n, 0);
    };

    // Choices offered by whichever Race/Class/Subclass/Background are
    // currently picked, bucketed into the wizard's new Spells/
    // Languages/Equipment/Feats/Proficiencies pages — see
    // creationChoiceGroupsFor and categorizeChoiceGroup above.
    const creationGroups = creationChoiceGroupsFor(state);
    const creationGroupsByCategory = Object.fromEntries(CREATION_CHOICE_CATEGORIES.map((cat) => [cat.key, []]));
    creationGroups.forEach((group) => creationGroupsByCategory[categorizeChoiceGroup(group)].push(group));
    function wizardUnavailableMessage() {
      return `As a level ${state.level} ${state.species || "character"} ${state.className || "character"}${state.subclass ? ` (${state.subclass})` : ""}, this page is not applicable.`;
    }

    const steps = [
      {
        id: "ruleset",
        title: "Ruleset",
        description: "Start by picking which rulebook you're building this character for. Everything else in this wizard — available classes, races, and backgrounds — depends on this choice, and it can't be changed later without redoing those steps.",
        render(container) {
          const ruleset = document.createElement("select");
          ruleset.className = "input-group__control";
          const blank = document.createElement("option"); blank.value = ""; blank.textContent = "Choose ruleset"; ruleset.append(blank);
          listRulesets().forEach((entry) => { const option = document.createElement("option"); option.value = entry.id; option.textContent = entry.name; ruleset.append(option); });
          ruleset.value = state.rulesetId || "";
          ruleset.addEventListener("change", () => {
            const next = ruleset.value || null;
            if (next === character.rulesetId) return;
            const hasDownstreamChoices = character.rules.species || character.rules.className || character.rules.subclass || character.rules.background;
            // Race/Class/Subclass/Background are all ruleset-specific
            // (they come from that ruleset's bundle library) — carrying
            // them over to a different ruleset would leave the wizard
            // showing choices that don't actually belong to anything
            // selectable anymore, so they're cleared here rather than
            // left stale and confusing.
            if (hasDownstreamChoices && !window.confirm("Changing rulesets clears your Race, Class, Subclass, and Background choices below, since those are specific to a ruleset. Continue?")) {
              ruleset.value = character.rulesetId || "";
              return;
            }
            character.rulesetId = next;
            character.rules.species = "";
            character.rules.className = "";
            character.rules.subclass = "";
            character.rules.background = "";
            update("rulesetId", character.rulesetId);
            const syncMessage = syncRulesetBundles(character.rulesetId);
            if (syncMessage) statusEl.textContent = syncMessage;
          });
          field(container, "Ruleset", ruleset);
        },
      },
      {
        id: "identity",
        title: "Identity",
        description: "Give your character a name, set the level you're starting at (almost always level 1 for a new character), and choose a race or species. Race/species determines ability score bonuses, speed, and racial traits.",
        render(container) {
          const nameField = document.createElement("input");
          nameField.type = "text";
          nameField.className = "input-group__control";
          nameField.value = character.name || "";
          // Debounced on "input" (not "change"/blur) to match the
          // toolbar's own name field — otherwise a name typed here and
          // followed immediately by "Next →" (no blur in between)
          // would be lost.
          nameField.addEventListener("input", debounce(() => {
            character.name = nameField.value;
            nameInput.value = nameField.value;
            saveWithStatus("name", character.name);
          }, 400));
          field(container, "Character Name", nameField);

          const level = document.createElement("input");
          level.type = "number"; level.min = "1"; level.max = "20"; level.value = String(state.level); level.className = "input-group__control";
          level.addEventListener("change", () => update("level", level.value));
          field(container, "Starting Level", level);

          const raceLabel = document.createElement("p");
          raceLabel.className = "wizard__section-label";
          raceLabel.textContent = "Race/Species";
          container.append(raceLabel);

          const liveNames = rulesetOptionNames(state.rulesetId, "Race", wizardFieldOptionNames("race", "Race"));
          if (liveNames.length) {
            renderSelectableRows(container, liveNames, {
              selectedName: state.species,
              getInfo: (name) => catalogEntryInfo(["race", "species"], name),
              onSelect: (name) => update("species", name),
            });
          } else {
            const input = document.createElement("input");
            input.type = "text"; input.className = "input-group__control";
            input.placeholder = "No Race options found for this ruleset yet — type it in for now";
            input.value = state.species || "";
            input.addEventListener("change", () => update("species", input.value));
            field(container, "Race/Species", input);
          }
        },
      },
      {
        id: "class",
        title: "Class",
        description: "Choose your class. If it picks a subclass right away at your starting level, its row expands below to let you choose one — otherwise the Leveling tab will ask when you reach the level that unlocks it.",
        render(container) {
          const classFallback = wizardFieldOptionNames("class", "Class");
          const liveNames = rulesetOptionNames(state.rulesetId, "Class", classFallback.length ? classFallback : (resolved.ruleset?.classes || []).map((c) => c.name));
          renderSelectableRows(container, liveNames, {
            selectedName: state.className,
            getInfo: (name) => catalogEntryInfo(["class"], name),
            onSelect: (name) => update("className", name),
            afterRow: (name, rowEl) => {
              if (name !== state.className) return;
              const subs = liveSubclassData(name);
              if (!(subs.subclasses.length && state.level >= subs.subclassLevel)) {
                const note = document.createElement("p");
                note.className = "leveling-tab__intro wizard__subclass-note";
                note.textContent = `${name} doesn't choose a subclass until level ${subs.subclassLevel === Infinity ? "?" : subs.subclassLevel} — the Leveling tab will ask when you get there.`;
                rowEl.after(note);
                return;
              }
              // Built against a detached holder so the nested list's
              // own container.append() call (inside
              // renderSelectableRows) doesn't land it at the end of
              // the whole class list — it belongs right under this
              // one selected class's row instead.
              const holder = document.createElement("div");
              renderSelectableRows(holder, subs.subclasses, {
                selectedName: state.subclass,
                getInfo: (n) => catalogEntryInfo(["subclass"], n),
                onSelect: (n) => update("subclass", n),
                nested: true,
              });
              rowEl.after(holder.firstElementChild);
            },
          });
        },
      },
      {
        id: "abilities",
        title: "Ability Scores",
        descriptionItems: [
          "Point Buy spends a fixed budget of points across all six scores.",
          "Random Roll rolls 4d6 (dropping the lowest die) for each score.",
          "Manual Entry lets you type in scores from a physical roll or another source.",
        ],
        render(container) {
          const intro = document.createElement("p");
          intro.className = "leveling-tab__intro";
          intro.textContent = "Set your six ability scores. Switching methods below resets the scores to fit it.";
          container.append(intro);

          const methodGroup = document.createElement("label");
          methodGroup.className = "level-guide__field wizard__ability-method";
          methodGroup.textContent = "Method";
          const methodSelect = document.createElement("select");
          methodSelect.className = "input-group__control";
          [["pointbuy", "Point Buy (27 points)"], ["roll", "Random Roll (4d6, drop lowest)"], ["manual", "Manual Entry"]].forEach(([value, label]) => {
            const option = document.createElement("option"); option.value = value; option.textContent = label; methodSelect.append(option);
          });
          methodSelect.value = character.rules.abilityScoreMethod || "manual";
          methodGroup.append(methodSelect);
          container.append(methodGroup);

          const scoresWrap = document.createElement("div");
          scoresWrap.className = "wizard__ability-scores";
          container.append(scoresWrap);

          function abilityRow(id, control) {
            const row = document.createElement("div");
            row.className = "wizard__ability-row";
            const group = document.createElement("label");
            group.className = "level-guide__field";
            group.textContent = id.toUpperCase();
            group.append(control);
            row.append(group);
            const desc = document.createElement("p");
            desc.className = "wizard__ability-row-description";
            desc.textContent = ABILITY_DESCRIPTIONS[id];
            row.append(desc);
            scoresWrap.append(row);
          }

          function renderScores() {
            scoresWrap.innerHTML = "";
            const method = methodSelect.value;

            if (method === "pointbuy") {
              const note = document.createElement("p");
              note.className = "leveling-tab__intro wizard__ability-note";
              scoresWrap.append(note);
              const updateNote = () => {
                const spent = ABILITY_IDS.reduce((sum, id) => sum + pointBuyCost(character.rules.abilityScores[id]), 0);
                note.textContent = `Points spent: ${spent}/${POINT_BUY_BUDGET}${spent > POINT_BUY_BUDGET ? " — over budget!" : ""}`;
              };
              ABILITY_IDS.forEach((id) => {
                if (character.rules.abilityScores[id] < POINT_BUY_MIN || character.rules.abilityScores[id] > POINT_BUY_MAX) character.rules.abilityScores[id] = POINT_BUY_MIN;
                const input = document.createElement("input");
                input.type = "number"; input.min = String(POINT_BUY_MIN); input.max = String(POINT_BUY_MAX);
                input.className = "input-group__control";
                input.value = String(character.rules.abilityScores[id]);
                input.addEventListener("change", () => {
                  let value = Number.parseInt(input.value, 10);
                  if (!Number.isFinite(value)) value = POINT_BUY_MIN;
                  value = Math.min(POINT_BUY_MAX, Math.max(POINT_BUY_MIN, value));
                  input.value = String(value);
                  character.rules.abilityScores[id] = value;
                  saveRules();
                  updateNote();
                });
                abilityRow(id, input);
              });
              updateNote();
            } else if (method === "roll") {
              const noteRow = document.createElement("div");
              noteRow.className = "wizard__ability-note";
              const rollIntro = document.createElement("p");
              rollIntro.className = "leveling-tab__intro";
              rollIntro.textContent = "Click Roll All to roll 4d6 (dropping the lowest die) for each score — or edit any value by hand afterward.";
              noteRow.append(rollIntro);
              const rollAllBtn = document.createElement("button");
              rollAllBtn.type = "button"; rollAllBtn.className = "btn"; rollAllBtn.textContent = "Roll All";
              noteRow.append(rollAllBtn);
              scoresWrap.append(noteRow);
              const inputs = {};
              rollAllBtn.addEventListener("click", () => {
                ABILITY_IDS.forEach((id) => {
                  character.rules.abilityScores[id] = rollAbilityScore();
                  inputs[id].value = String(character.rules.abilityScores[id]);
                });
                saveRules();
              });
              ABILITY_IDS.forEach((id) => {
                const input = document.createElement("input");
                input.type = "number"; input.min = "3"; input.max = "18"; input.className = "input-group__control";
                input.value = String(character.rules.abilityScores[id]);
                input.addEventListener("change", () => { character.rules.abilityScores[id] = Number(input.value) || 10; saveRules(); });
                inputs[id] = input;
                abilityRow(id, input);
              });
            } else {
              ABILITY_IDS.forEach((id) => {
                const input = document.createElement("input");
                input.type = "number"; input.min = "1"; input.max = "30"; input.className = "input-group__control";
                input.value = String(character.rules.abilityScores[id]);
                input.addEventListener("change", () => { character.rules.abilityScores[id] = Number(input.value) || 10; saveRules(); });
                abilityRow(id, input);
              });
            }
          }
          methodSelect.addEventListener("change", () => {
            character.rules.abilityScoreMethod = methodSelect.value;
            saveRules();
            renderScores();
          });
          renderScores();
        },
      },
      {
        id: "background",
        title: "Background",
        description: "Choose your character's background. This grants skill/tool/language proficiencies and a starting equipment package.",
        render(container) {
          const liveNames = rulesetOptionNames(state.rulesetId, "Background", wizardFieldOptionNames("background", "Background"));
          if (liveNames.length) {
            renderSelectableRows(container, liveNames, {
              selectedName: state.background,
              getInfo: (name) => catalogEntryInfo(["background"], name),
              onSelect: (name) => update("background", name),
            });
          } else {
            const input = document.createElement("input");
            input.type = "text"; input.className = "input-group__control";
            input.placeholder = "No Background options found for this ruleset yet — type it in for now";
            input.value = state.background || "";
            input.addEventListener("change", () => update("background", input.value));
            field(container, "Background", input);
          }
        },
      },
      {
        id: "preferences",
        title: "Preferences",
        description: "A couple of settings for how leveling up behaves by default — both can be changed anytime later once a Settings tab exists.",
        render(container) {
          const hpRow = document.createElement("div");
          hpRow.className = "wizard__preference-row";
          const hpGroup = document.createElement("label");
          hpGroup.className = "level-guide__field";
          hpGroup.textContent = "HP on level-up";
          const select = document.createElement("select");
          select.className = "input-group__control";
          [["average", "Fixed average"], ["roll", "Roll in-browser"], ["manual", "I'll roll at the table and type it in"]].forEach(([value, label]) => {
            const option = document.createElement("option"); option.value = value; option.textContent = label; select.append(option);
          });
          select.value = character.rules.hpMethod || "manual";
          select.addEventListener("change", () => { character.rules.hpMethod = select.value; saveRules(); });
          hpGroup.append(select);
          hpRow.append(hpGroup);
          const hpDesc = document.createElement("p");
          hpDesc.className = "wizard__preference-description";
          hpDesc.textContent = "How hit points (and similar rolled increases) are handled by default whenever you level up later. You can still override this on any individual level-up.";
          hpRow.append(hpDesc);
          container.append(hpRow);

          const dieRow = document.createElement("div");
          dieRow.className = "wizard__preference-row";
          const dieGroup = document.createElement("label");
          dieGroup.className = "level-guide__field";
          dieGroup.textContent = "Hit die";
          const dieSize = document.createElement("select");
          dieSize.className = "input-group__control";
          [4, 6, 8, 10, 12].forEach((sides) => { const option = document.createElement("option"); option.value = String(sides); option.textContent = `d${sides}`; dieSize.append(option); });
          dieSize.value = String(character.rules.hitDieSize || 8);
          dieSize.addEventListener("change", () => { character.rules.hitDieSize = Number(dieSize.value); saveRules(); });
          dieGroup.append(dieSize);
          dieRow.append(dieGroup);
          const dieDesc = document.createElement("p");
          dieDesc.className = "wizard__preference-description";
          dieDesc.textContent = "Bundles don't carry this yet — set it to match your class's hit die.";
          dieRow.append(dieDesc);
          container.append(dieRow);
        },
      },
      {
        id: "spells",
        title: "Spells & Abilities",
        description: "Spells or special abilities granted by your race, class, subclass, or background that need a choice made right now.",
        isApplicable: () => creationGroupsByCategory.spells.length > 0,
        unavailableMessage: wizardUnavailableMessage,
        render(container) { renderCreationChoiceGroups(container, creationGroupsByCategory.spells, saveRules); },
      },
      {
        id: "languages",
        title: "Languages",
        description: "Languages you get to choose from your race, class, subclass, or background.",
        isApplicable: () => creationGroupsByCategory.languages.length > 0,
        unavailableMessage: wizardUnavailableMessage,
        render(container) { renderCreationChoiceGroups(container, creationGroupsByCategory.languages, saveRules); },
      },
      {
        id: "equipment",
        title: "Starting Equipment",
        description: "Equipment packages or choices granted by your class or background.",
        isApplicable: () => creationGroupsByCategory.equipment.length > 0,
        unavailableMessage: wizardUnavailableMessage,
        render(container) { renderCreationChoiceGroups(container, creationGroupsByCategory.equipment, saveRules); },
      },
      {
        id: "feats",
        title: "Feats",
        description: "Feats granted at character creation by your race or background.",
        isApplicable: () => creationGroupsByCategory.feats.length > 0,
        unavailableMessage: wizardUnavailableMessage,
        render(container) { renderCreationChoiceGroups(container, creationGroupsByCategory.feats, saveRules); },
      },
      {
        id: "proficiencies",
        title: "Ability Proficiencies",
        description: "Skill, tool, and saving throw proficiencies granted by your race, class, subclass, or background.",
        isApplicable: () => creationGroupsByCategory.proficiencies.length > 0,
        unavailableMessage: wizardUnavailableMessage,
        render(container) { renderCreationChoiceGroups(container, creationGroupsByCategory.proficiencies, saveRules); },
      },
      {
        id: "review",
        title: "Review",
        description: "Here's everything you've chosen. If it looks right, hit Finish Setup to apply it to your sheet — this also wires up your class/race/background bundles and switches you over to the Leveling tab for next time.",
        render(container) {
          const rows = document.createElement("div");
          rows.className = "wizard__review-rows";
          const noteLines = [
            character.name && `Name: ${character.name}`,
            state.rulesetId ? getRuleset(state.rulesetId)?.name : null,
            state.species && `Race: ${state.species}`,
            state.className && `Class: ${state.className}${state.subclass ? ` (${state.subclass})` : ""}`,
            state.background && `Background: ${state.background}`,
            `Level ${state.level}`,
          ].filter(Boolean);
          if (resolved.derived.preparedSpellLimit != null) noteLines.push(`Prepared druid spells: ${resolved.derived.preparedSpellLimit}`);
          resolved.derived.resources.forEach((resource) => noteLines.push(`${resource.name}: ${resource.maximum}`));
          if (noteLines.length === 0) {
            const empty = document.createElement("p");
            empty.className = "level-guide__summary";
            empty.textContent = "Nothing chosen yet.";
            rows.append(empty);
          } else {
            noteLines.forEach((line) => {
              const row = document.createElement("p");
              row.className = "wizard__review-row";
              row.textContent = line;
              rows.append(row);
            });
          }
          container.append(rows);

          const buttonRow = document.createElement("div");
          buttonRow.className = "wizard__review-button-row";
          const sync = document.createElement("button");
          sync.type = "button"; sync.className = "btn btn--primary wizard__finish-btn"; sync.textContent = "Finish Setup";
          sync.addEventListener("click", () => syncRulesToSheet(resolved));
          buttonRow.append(sync);
          container.append(buttonRow);
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
    const className = selectedChoiceName("class", "Class");
    const level = currentCharacterLevel();
    const selectedSubclass = selectedChoiceName("subclass", "Subclass");
    const plan = getLevelUpPlan(character.rules?.rulesetId || character.rulesetId, className, level, selectedSubclass);
    // Same override as renderRulesTab above: a live, bundle-driven
    // subclass list (from an applied classes.json import) wins over
    // getLevelUpPlan's hardcoded PHB one, so new subclasses show up
    // here the moment they're imported and applied — no code edit.
    if (plan) {
      const liveSubclasses = liveSubclassData(className);
      if (liveSubclasses.subclasses.length) {
        plan.needsSubclass = !selectedSubclass && level >= liveSubclasses.subclassLevel;
        plan.subclassChoices = plan.needsSubclass ? liveSubclasses.subclasses : [];
      }
    }
    const contentGroups = level == null ? [] : activeRuleChoiceGroups(flattenGlobalFields(), formulaValues)
      .filter((group) => group.minLevel <= level);
    const newFeatures = level == null || !className ? [] : classFeatureGrantsAtLevel(className, level);
    const needsAsi = level != null && className ? classGrantsAsiAtLevel(className, level) : false;
    if (!plan && contentGroups.length === 0) return null;

    const priorLevelUp = character.levelUps?.[String(level)] || {};
    if (plan && priorLevelUp.appliedRulesetId === plan.ruleset.id) {
      const panel = document.createElement("section");
      panel.className = "level-guide";
      const heading = document.createElement("div");
      heading.className = "level-guide__heading";
      const title = document.createElement("h2");
      title.textContent = `${className || "Character"} Level ${level}`;
      heading.append(title);
      panel.append(heading);
      const complete = document.createElement("p");
      complete.className = "level-guide__feedback";
      complete.textContent = `This level was already applied using ${plan.ruleset.name}.`;
      panel.append(complete);
      return panel;
    }

    // In-progress answers for this level — see levelingPendingState
    // comment near its declaration for why this can't just be a local.
    const levelKey = String(level);
    if (!levelingPendingState[levelKey]) {
      levelingPendingState[levelKey] = {
        hp: "",
        subclass: selectedSubclass || "",
        notes: "",
        asiMode: "feat",
        asiAbility1: "",
        asiAbility2: "",
        choices: Object.fromEntries(contentGroups.map((group) => [group.key, [...(character.rules?.choices?.[group.key] || [])]])),
      };
    }
    const pending = levelingPendingState[levelKey];
    contentGroups.forEach((group) => {
      if (!pending.choices[group.key]) pending.choices[group.key] = [...(character.rules?.choices?.[group.key] || [])];
    });

    const slots = (plan?.slotChanges || []).map((change) => `${change.options} ${change.label}-level`).join(", ");
    const feedback = document.createElement("p");
    feedback.className = "level-guide__feedback";

    const steps = [];

    if (plan?.needsSubclass) {
      steps.push({
        id: "subclass",
        title: "Subclass",
        description: `${className} chooses a subclass at this level. Pick one below — this can't easily be undone once you apply this level's changes, so make sure it's the one you want.`,
        render(container) {
          const group = document.createElement("label");
          group.className = "level-guide__field";
          group.textContent = "Subclass";
          const select = document.createElement("select");
          select.className = "input-group__control";
          const blank = document.createElement("option"); blank.value = ""; blank.textContent = "Choose subclass"; select.append(blank);
          plan.subclassChoices.forEach((name) => {
            const option = document.createElement("option");
            option.value = name; option.textContent = name;
            select.append(option);
          });
          select.value = pending.subclass || "";
          select.addEventListener("change", () => { pending.subclass = select.value; });
          group.append(select);
          container.append(group);
        },
      });
    }

    if (needsAsi) {
      steps.push({
        id: "asi",
        title: "Ability Score Improvement",
        description: `${className} gets an Ability Score Improvement at this level. Increase one ability score by 2, two ability scores by 1 each, or take a feat instead (note which one on the Notes step).`,
        render(container) {
          const modeGroup = document.createElement("label");
          modeGroup.className = "level-guide__field";
          modeGroup.textContent = "This level's ASI";
          const modeSelect = document.createElement("select");
          modeSelect.className = "input-group__control";
          [["single", "+2 to one score"], ["double", "+1 to two scores"], ["feat", "Took a feat instead"]].forEach(([value, label]) => {
            const option = document.createElement("option"); option.value = value; option.textContent = label; modeSelect.append(option);
          });
          modeSelect.value = pending.asiMode;
          modeGroup.append(modeSelect);
          container.append(modeGroup);

          const abilityRow = document.createElement("div");
          const renderAbilitySelects = () => {
            abilityRow.innerHTML = "";
            if (modeSelect.value === "feat") return;
            const count = modeSelect.value === "single" ? 1 : 2;
            for (let i = 0; i < count; i++) {
              const abilityGroup = document.createElement("label");
              abilityGroup.className = "level-guide__field";
              abilityGroup.textContent = i === 0 ? "Ability" : "Second ability";
              const abilitySelect = document.createElement("select");
              abilitySelect.className = "input-group__control";
              const blank = document.createElement("option"); blank.value = ""; blank.textContent = "Choose"; abilitySelect.append(blank);
              ABILITY_IDS.forEach((id) => { const option = document.createElement("option"); option.value = id; option.textContent = id.toUpperCase(); abilitySelect.append(option); });
              abilitySelect.value = i === 0 ? pending.asiAbility1 : pending.asiAbility2;
              abilitySelect.addEventListener("change", () => { if (i === 0) pending.asiAbility1 = abilitySelect.value; else pending.asiAbility2 = abilitySelect.value; });
              abilityGroup.append(abilitySelect);
              abilityRow.append(abilityGroup);
            }
          };
          modeSelect.addEventListener("change", () => { pending.asiMode = modeSelect.value; renderAbilitySelects(); });
          renderAbilitySelects();
          container.append(abilityRow);
        },
      });
    }

    if (newFeatures.length) {
      steps.push({
        id: "features",
        title: "New Features",
        description: `${className} gains new features at this level — just informational, nothing to fill in here. Read them over, then move on to the next step.`,
        render(container) {
          newFeatures.forEach((feature) => {
            const block = document.createElement("div");
            block.className = "level-guide__choices";
            const name = document.createElement("strong");
            name.textContent = feature.name;
            const desc = document.createElement("p");
            desc.className = "level-guide__choice-description";
            desc.textContent = feature.description || "";
            block.append(name, desc);
            container.append(block);
          });
        },
      });
    }

    if (contentGroups.length) {
      steps.push({
        id: "choices",
        title: "Choices",
        description: "This level offers you a choice — pick from the options below. Check how many selections each group wants; you won't be able to apply this level until they're all satisfied.",
        render(container) {
          contentGroups.forEach((group) => {
            const choiceGroup = document.createElement("fieldset");
            choiceGroup.className = "level-guide__choices";
            const legend = document.createElement("legend");
            const count = group.minSelections === group.maxSelections
              ? `Choose ${group.maxSelections}`
              : `Choose up to ${group.maxSelections}`;
            legend.textContent = `${group.label || "Choose an option"} (${count})`;
            choiceGroup.append(legend);
            const source = document.createElement("p");
            source.className = "level-guide__choice-source";
            source.textContent = group.source;
            choiceGroup.append(source);

            group.options.forEach((option) => {
              const optionLabel = document.createElement("label");
              optionLabel.className = "level-guide__choice-option";
              const input = document.createElement("input");
              input.type = group.maxSelections === 1 ? "radio" : "checkbox";
              input.name = `rule-choice-${group.key}`;
              input.value = option.id;
              input.checked = pending.choices[group.key].includes(option.id);
              input.addEventListener("change", () => {
                const selected = pending.choices[group.key];
                if (input.type === "radio") {
                  pending.choices[group.key] = input.checked ? [option.id] : [];
                } else if (input.checked) {
                  if (!selected.includes(option.id)) selected.push(option.id);
                } else {
                  pending.choices[group.key] = selected.filter((id) => id !== option.id);
                }
              });
              const text = document.createElement("span");
              text.textContent = option.name || "Unnamed option";
              optionLabel.append(input, text);
              if (option.description) {
                const description = document.createElement("span");
                description.className = "level-guide__choice-description";
                description.textContent = option.description;
                optionLabel.append(description);
              }
              choiceGroup.append(optionLabel);
            });
            container.append(choiceGroup);
          });
        },
      });
    }

    if (slots) {
      steps.push({
        id: "spells",
        title: "Spells",
        description: "Your spellcasting improves at this level — just informational for now; update your prepared/known spells on the main sheet to match.",
        render(container) {
          const note = document.createElement("p");
          note.className = "level-guide__summary";
          note.textContent = `This ruleset sets your spell slots to ${slots} at this level.`;
          container.append(note);
        },
      });
    }

    steps.push({
      id: "hp",
      title: "Hit Points",
      description: "Record the hit points you gained this level. It's pre-filled based on your preferred method from Character Setup, but you can always edit it by hand.",
      render(container) {
        const conMod = Math.floor(((Number(character.rules?.abilityScores?.con) || 10) - 10) / 2);
        const dieSize = character.rules?.hitDieSize || 8;
        const method = character.rules?.hpMethod || "manual";
        const rollOnce = () => Math.max(1, Math.floor(Math.random() * dieSize) + 1 + conMod);
        const averageOnce = () => Math.max(1, Math.floor(dieSize / 2) + 1 + conMod);
        if (!pending.hp) {
          if (method === "average") pending.hp = String(averageOnce());
          else if (method === "roll") pending.hp = String(rollOnce());
        }

        const hpGroup = document.createElement("label");
        hpGroup.className = "level-guide__field";
        hpGroup.textContent = "HP Gained";
        const hpInput = document.createElement("input");
        hpInput.type = "number"; hpInput.min = "1"; hpInput.step = "1"; hpInput.required = true;
        hpInput.placeholder = "Rolled or average"; hpInput.className = "input-group__control";
        hpInput.value = pending.hp || "";
        hpInput.addEventListener("change", () => { pending.hp = hpInput.value; });
        hpGroup.append(hpInput);
        container.append(hpGroup);

        if (method === "roll") {
          const rerollBtn = document.createElement("button");
          rerollBtn.type = "button"; rerollBtn.className = "btn";
          rerollBtn.textContent = `Reroll (d${dieSize} ${conMod >= 0 ? "+" : ""}${conMod} CON)`;
          rerollBtn.addEventListener("click", () => { pending.hp = String(rollOnce()); hpInput.value = pending.hp; });
          container.append(rerollBtn);
        } else {
          const note = document.createElement("p");
          note.className = "leveling-tab__intro";
          note.textContent = method === "average"
            ? `Prefilled with the fixed average for a d${dieSize} (set in Character Setup) — edit it if this class's hit die is different.`
            : "Roll at the table and type the result in — change your default under Character Setup → Preferences.";
          container.append(note);
        }
      },
    });

    steps.push({
      id: "notes",
      title: "Notes",
      description: "Jot down anything else worth recording from your source book — new proficiencies, invocations, spells, or other choices that don't fit neatly into the steps above.",
      render(container) {
        const benefitsGroup = document.createElement("label");
        benefitsGroup.className = "level-guide__field level-guide__field--wide";
        benefitsGroup.textContent = "Features and Choices to Record";
        const benefitsInput = document.createElement("textarea");
        benefitsInput.placeholder = "Record features, spells, proficiencies, or other choices from your source book.";
        benefitsInput.value = pending.notes || "";
        benefitsInput.addEventListener("input", () => { pending.notes = benefitsInput.value; });
        benefitsGroup.append(benefitsInput);
        container.append(benefitsGroup);
      },
    });

    steps.push({
      id: "review",
      title: "Review & Apply",
      description: "Here's a summary of this level's changes. If everything looks right, hit Apply — this writes your HP, subclass, ability score increase, and notes to the sheet and can't easily be undone.",
      render(container) {
        const summary = document.createElement("p");
        summary.className = "level-guide__summary";
        const parts = [`HP +${pending.hp || "?"}`];
        if (pending.subclass) parts.push(`Subclass: ${pending.subclass}`);
        if (needsAsi) parts.push(pending.asiMode === "feat" ? "Took a feat" : `ASI: ${[pending.asiAbility1, pending.asiAbility2].filter(Boolean).map((id) => id.toUpperCase()).join(", ") || "not chosen yet"}`);
        if (slots) parts.push(`Spell slots: ${slots}`);
        summary.textContent = parts.join(" · ");
        container.append(summary);
        container.append(feedback);

        const applyBtn = document.createElement("button");
        applyBtn.type = "button";
        applyBtn.className = "btn btn--primary";
        applyBtn.textContent = `Apply Level ${level} Changes`;
        applyBtn.addEventListener("click", async () => {
          const hpGain = Number.parseInt(pending.hp, 10);
          if (!Number.isFinite(hpGain) || hpGain < 1) {
            feedback.textContent = "Enter the HP gained for this level before applying it.";
            feedback.classList.add("level-guide__feedback--error");
            return;
          }
          for (const group of contentGroups) {
            const selected = pending.choices[group.key] || [];
            if (selected.length < group.minSelections || selected.length > group.maxSelections) {
              feedback.textContent = `${group.label || "This choice"} needs ${group.minSelections === group.maxSelections ? group.maxSelections : `${group.minSelections}-${group.maxSelections}`} selection(s).`;
              feedback.classList.add("level-guide__feedback--error");
              return;
            }
          }
          if (needsAsi && pending.asiMode !== "feat") {
            const chosen = [pending.asiAbility1, pending.asiAbility2].filter(Boolean);
            const required = pending.asiMode === "single" ? 1 : 2;
            if (chosen.length < required || new Set(chosen).size !== chosen.length) {
              feedback.textContent = "Choose the ability score(s) for this level's Ability Score Improvement (or switch it to \"Took a feat instead\").";
              feedback.classList.add("level-guide__feedback--error");
              return;
            }
          }
          const subclassField = findStarterField("subclass", "Subclass");
          const selectedSubclassName = pending.subclass || selectedSubclass;
          const subclassChoice = selectedSubclassName && (subclassField?.choices || []).find((choice) => choice.text === selectedSubclassName);
          const slotChanges = plan?.slotChanges || [];
          ensureStandardSpellSlotFields(slotChanges);
          const missingSlots = slotChanges.filter((change) => !findStarterField(change.fieldId, change.label));
          if (plan?.needsSubclass && (!subclassField || !subclassChoice)) {
            feedback.textContent = "This sheet needs a Subclass dropdown containing the ruleset's available choices.";
            feedback.classList.add("level-guide__feedback--error");
            return;
          }
          if (missingSlots.length > 0) {
            feedback.textContent = `This sheet is missing the ${missingSlots.map((change) => change.label).join(", ")} spell-slot field(s) needed for this level.`;
            feedback.classList.add("level-guide__feedback--error");
            return;
          }

          const before = clone({ layout: character.layout, sheetTabs: character.sheetTabs, levelUps: character.levelUps, rules: character.rules });
          const hpMax = findStarterField(null, "HP Max");
          const hpCurrent = findStarterField(null, "HP Current");
          const features = findStarterField(null, "Features & Traits");
          const notes = (pending.notes || "").trim();
          const featureEntry = notes ? `${className} level ${level}: ${notes}` : `${className} level ${level}`;
          applyBtn.disabled = true;
          feedback.textContent = "Applying changes…";
          feedback.classList.remove("level-guide__feedback--error");
          if (subclassChoice) subclassField.selected = subclassChoice.id;
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
            const bump = (id, amount) => {
              character.rules.abilityScores[id] = (Number(character.rules.abilityScores[id]) || 10) + amount;
              const target = findStarterField(`${id}Score`, id.toUpperCase());
              if (target) target.value = String(character.rules.abilityScores[id]);
            };
            if (pending.asiMode === "single") { bump(pending.asiAbility1, 2); asiSummary = `+2 ${pending.asiAbility1.toUpperCase()}`; }
            else { bump(pending.asiAbility1, 1); bump(pending.asiAbility2, 1); asiSummary = `+1 ${pending.asiAbility1.toUpperCase()}, +1 ${pending.asiAbility2.toUpperCase()}`; }
          } else if (needsAsi) {
            asiSummary = "Took a feat instead of an ASI";
          }
          appendUniqueTextListItem(features, featureEntry);
          character.levelUps[String(level)] = {
            ...(character.levelUps[String(level)] || {}),
            hp: `+${hpGain}`,
            subclass: selectedSubclassName || "",
            spells: slots ? `Spell slots: ${slots}.` : "",
            features: featureEntry,
            asi: asiSummary,
            appliedRulesetId: plan?.ruleset?.id || "content",
          };
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

    return renderStepWizard(steps, levelingWizardState, {
      title: `${className || "Character"} Level ${level}`,
      intro: "Step through whatever applies at this level — anything that doesn't apply is skipped automatically.",
    });
  }

  function renderResourceTrackers() {
    const resources = collectResourceGrants(flattenGlobalFields(), formulaValues);
    if (resources.length === 0) return null;
    character.rules = normalizeRulesState(character.rules);
    const section = document.createElement("section");
    section.className = "rule-resources";
    const title = document.createElement("h2");
    title.textContent = "Feature Uses";
    section.append(title);
    resources.forEach((resource) => {
      const row = document.createElement("div");
      row.className = "rule-resources__row";
      const label = document.createElement("span");
      label.className = "rule-resources__name";
      label.textContent = resource.name;
      const reset = document.createElement("span");
      reset.className = "rule-resources__reset";
      reset.textContent = `Resets: ${resource.reset}`;
      const value = document.createElement("input");
      value.type = "number";
      value.min = "0";
      value.max = String(resource.maximum);
      value.className = "rule-resources__value";
      const saved = Number.parseInt(character.rules.resourceUses[resource.key], 10);
      value.value = String(Number.isFinite(saved) ? Math.min(resource.maximum, Math.max(0, saved)) : resource.maximum);
      value.addEventListener("change", () => {
        character.rules.resourceUses[resource.key] = Math.min(resource.maximum, Math.max(0, Number.parseInt(value.value, 10) || 0));
        value.value = String(character.rules.resourceUses[resource.key]);
        saveWithStatus("rules", character.rules);
      });
      const maximum = document.createElement("span");
      maximum.className = "rule-resources__maximum";
      maximum.textContent = `/ ${resource.maximum}`;
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "btn formula-toolbar__btn";
      restore.textContent = "Restore";
      restore.addEventListener("click", () => {
        character.rules.resourceUses[resource.key] = resource.maximum;
        value.value = String(resource.maximum);
        saveWithStatus("rules", character.rules);
      });
      row.append(label, reset, value, maximum, restore);
      section.append(row);
    });
    return section;
  }

  function renderLevelingTab() {
    const wrap = document.createElement("div");
    wrap.className = "leveling-tab";

    const intro = document.createElement("p");
    intro.className = "leveling-tab__intro";
    intro.textContent = "Come back here whenever your level goes up. Fill in whatever applies for your class at that level — leave the rest blank.";
    wrap.append(intro);

    const rulesetGuide = renderRulesetLevelGuide();
    if (rulesetGuide) wrap.append(rulesetGuide);
    const resources = renderResourceTrackers();
    if (resources) wrap.append(resources);

    const currentLevel = currentCharacterLevel();
    if (currentLevel) {
      const jumpBtn = document.createElement("button");
      jumpBtn.type = "button";
      jumpBtn.className = "btn leveling-tab__jump";
      jumpBtn.textContent = `↓ Jump to Level ${currentLevel}`;
      jumpBtn.addEventListener("click", () => {
        expandedLevelUpRows.add(currentLevel);
        renderPageGrid();
        requestAnimationFrame(() => {
          pageGrid.querySelector(`[data-level="${currentLevel}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      });
      wrap.append(jumpBtn);
    }

    for (let level = 1; level <= 20; level++) {
      wrap.append(renderLevelUpRow(level, level === currentLevel));
    }

    pageGrid.append(wrap);
  }

  function renderLevelUpRow(level, isCurrent) {
    const key = String(level);
    if (!character.levelUps[key] || typeof character.levelUps[key] !== "object") {
      character.levelUps[key] = {};
    }
    const data = character.levelUps[key];

    const row = document.createElement("div");
    row.className = "leveling-row" + (isCurrent ? " leveling-row--current" : "");
    row.dataset.level = String(level);

    const header = document.createElement("div");
    header.className = "leveling-row__header";

    const expanded = expandedLevelUpRows.has(level);
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "btn formula-toolbar__btn leveling-row__toggle";
    toggleBtn.textContent = expanded ? "▾" : "▸";
    toggleBtn.setAttribute("aria-label", expanded ? `Collapse level ${level}` : `Expand level ${level}`);
    toggleBtn.addEventListener("click", () => {
      if (expanded) expandedLevelUpRows.delete(level);
      else expandedLevelUpRows.add(level);
      renderPageGrid();
    });
    header.append(toggleBtn);

    const title = document.createElement("span");
    title.className = "leveling-row__title";
    title.textContent = `Level ${level}`;
    header.append(title);

    const filledCount = LEVEL_UP_FIELDS.filter((f) => (data[f.key] || "").trim() !== "").length;
    const summary = document.createElement("span");
    summary.className = "leveling-row__summary";
    summary.textContent = filledCount > 0 ? `${filledCount} filled in` : "Nothing yet";
    header.append(summary);

    row.append(header);

    if (expanded) {
      const fields = document.createElement("div");
      fields.className = "leveling-row__fields";
      LEVEL_UP_FIELDS.forEach((f) => {
        const group = document.createElement("div");
        group.className = "leveling-row__field";
        const label = document.createElement("label");
        label.textContent = f.label;
        const textarea = document.createElement("textarea");
        textarea.value = data[f.key] || "";
        textarea.placeholder = f.placeholder || "";
        textarea.addEventListener("input", () => {
          unsavedChanges = true;
          data[f.key] = textarea.value;
          saveLevelUps();
        });
        group.append(label, textarea);
        fields.append(group);
      });
      row.append(fields);
    }

    return row;
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
    tabsBar.innerHTML = "";
    character.sheetTabs.forEach((tab, index) => {
      const tabBtn = document.createElement("button");
      tabBtn.type = "button";
      tabBtn.className = `sheet-tab${tab.id === activeTab().id ? " active" : ""}`;
      tabBtn.draggable = editMode && !tab.kind;
      tabBtn.dataset.tabId = tab.id;

      const nameEl = document.createElement("span");
      nameEl.className = "sheet-tab__name";
      nameEl.contentEditable = editMode ? "true" : "false";
      nameEl.textContent = tab.name;
      nameEl.addEventListener("pointerdown", (e) => e.stopPropagation());
      nameEl.addEventListener("input", () => {
        commitMutation(() => {
          tab.name = nameEl.textContent.trim() || (tab.kind === "main" ? "Main" : tab.kind === "rules" ? "Character" : tab.kind === "leveling" ? "Leveling" : `Tab ${index + 1}`);
        }, { render: false });
        renderBlockFrame();
      });

      tabBtn.addEventListener("click", () => {
        activeTabId = tab.id;
        renderAll();
      });
      tabBtn.addEventListener("dragstart", (e) => {
        if (!editMode || tab.kind) return;
        e.dataTransfer.setData("application/x-sheet-tab", tab.id);
        e.dataTransfer.effectAllowed = "move";
      });
      tabBtn.addEventListener("dragover", (e) => {
        if (!editMode) return;
        e.preventDefault();
      });
      tabBtn.addEventListener("drop", (e) => {
        if (!editMode) return;
        const draggedId = e.dataTransfer.getData("application/x-sheet-tab");
        if (!draggedId || draggedId === tab.id) return;
        e.preventDefault();
        commitMutation(() => {
          const lockedCount = character.sheetTabs.filter(t => t.kind).length;
          const from = character.sheetTabs.findIndex(t => t.id === draggedId);
          const to = character.sheetTabs.findIndex(t => t.id === tab.id);
          if (from < lockedCount || to < 0) return;
          const [moved] = character.sheetTabs.splice(from, 1);
          character.sheetTabs.splice(Math.max(lockedCount, to), 0, moved);
        });
      });

      tabBtn.append(nameEl);
      if (editMode && !tab.kind) {
        const deleteBtn = document.createElement("span");
        deleteBtn.className = "sheet-tab__delete";
        deleteBtn.textContent = "×";
        deleteBtn.title = "Delete tab";
        deleteBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          commitMutation(() => {
            character.sheetTabs = character.sheetTabs.filter(t => t.id !== tab.id);
            activeTabId = character.sheetTabs[0].id;
          });
        });
        tabBtn.append(deleteBtn);
      }
      tabsBar.append(tabBtn);
    });

    if (editMode) {
      const addTabBtn = document.createElement("button");
      addTabBtn.type = "button";
      addTabBtn.className = "sheet-tab sheet-tab--add";
      addTabBtn.textContent = "+";
      addTabBtn.title = "Add tab";
      addTabBtn.addEventListener("click", () => {
        commitMutation(() => {
          const tab = { id: newId(), name: `Tab ${character.sheetTabs.length + 1}`, layout: [] };
          character.sheetTabs.push(tab);
          activeTabId = tab.id;
        });
      });
      tabsBar.append(addTabBtn);
    }
  }

  function renderBlockFrame() {
    blockFrame.innerHTML = "";
    const title = document.createElement("div");
    title.className = "sheet-block-frame__title";
    title.textContent = "Stat Blocks";
    blockFrame.append(title);

    globalLayout().forEach(block => {
      const source = effectiveBlock(block);
      const blockItem = document.createElement("div");
      blockItem.className = "sheet-block-list__block";
      blockItem.draggable = true;
      blockItem.dataset.blockId = block.id;
      blockItem.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/x-sheet-block", block.id);
        e.dataTransfer.effectAllowed = "copy";
      });

      const blockLine = document.createElement("div");
      blockLine.className = "sheet-block-list__line";
      blockLine.dataset.highlightId = block.id;
      blockLine.addEventListener("click", () => selectBlockAndFields(pageGrid.querySelector(`[data-node-id="${block.id}"]`)));

      const titleRow = document.createElement("div");
      titleRow.className = "sheet-block-list__title-row";

      const collapsed = collapsedBlockIds.has(block.id);
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "sheet-block-list__collapse-toggle";
      toggleBtn.textContent = collapsed ? "▸" : "▾";
      toggleBtn.title = collapsed ? "Expand" : "Collapse";
      toggleBtn.setAttribute("aria-label", collapsed ? "Expand" : "Collapse");
      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (collapsedBlockIds.has(block.id)) collapsedBlockIds.delete(block.id);
        else collapsedBlockIds.add(block.id);
        renderBlockFrame();
      });
      titleRow.append(toggleBtn);

      const name = document.createElement("span");
      name.textContent = source.name || "Unnamed Block";
      titleRow.append(name);
      blockLine.append(titleRow);

      if (character.sheetTabs.length > 1) {
        const tabs = document.createElement("span");
        tabs.className = "sheet-block-list__tabs";
        tabs.textContent = blockTabs(block.id).join(", ");
        blockLine.append(tabs);
      }
      blockItem.append(blockLine);

      const fieldsWrap = document.createElement("div");
      fieldsWrap.className = "sheet-block-list__fields";
      if (collapsed) fieldsWrap.hidden = true;

      (source.children || []).forEach(field => {
        const fieldItem = document.createElement("div");
        fieldItem.className = "sheet-block-list__field";
        fieldItem.textContent = field.label || "Unnamed Field";
        fieldItem.draggable = true;
        fieldItem.dataset.highlightId = field.id;
        fieldItem.addEventListener("click", (e) => {
          e.stopPropagation();
          selectOnly(field.id);
        });
        fieldItem.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          e.dataTransfer.setData("application/x-sheet-field", JSON.stringify({ blockId: block.id, fieldId: field.id }));
          e.dataTransfer.effectAllowed = "copy";
        });
        fieldsWrap.append(fieldItem);

        // Each checkbox in a checkbox field is its own boolean
        // variable for formulas — exposed as its own draggable row,
        // rather than the field as a whole.
        if (field.fieldType === "checkbox") {
          (field.checked || []).forEach((_, i) => {
            const cbItem = document.createElement("div");
            cbItem.className = "sheet-block-list__field sheet-block-list__field--sub";
            cbItem.textContent = `↳ ${field.label || "Unnamed Field"} ${i + 1}`;
            cbItem.draggable = true;
            cbItem.dataset.highlightId = field.id;
            cbItem.addEventListener("click", (e) => {
              e.stopPropagation();
              selectOnly(field.id);
            });
            cbItem.addEventListener("dragstart", (e) => {
              e.stopPropagation();
              e.dataTransfer.setData("application/x-sheet-field", JSON.stringify({ blockId: block.id, fieldId: field.id, checkboxIndex: i }));
              e.dataTransfer.effectAllowed = "copy";
            });
            fieldsWrap.append(cbItem);
          });
        }
      });
      blockItem.append(fieldsWrap);

      blockFrame.append(blockItem);
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
    if (!editMode) {
      el.style.backgroundImage = "";
      el.style.backgroundPosition = "";
      return;
    }
    const step = cw + GAP_PX; // cells are square, so column/row spacing match
    // Halfway between "too bright" in a plain window and "nearly
    // invisible" under a dark-mode browser extension that recolors it.
    const line = "rgba(255,255,255,0.16)";
    el.style.backgroundImage =
      `repeating-linear-gradient(to right, ${line} 0, ${line} 1px, transparent 1px, transparent ${step}px),` +
      `repeating-linear-gradient(to bottom, ${line} 0, ${line} 1px, transparent 1px, transparent ${step}px)`;

    if (!originEl) {
      el.style.backgroundPosition = "0 0";
      return;
    }
    const elRect = el.getBoundingClientRect();
    const originRect = originEl.getBoundingClientRect();
    const offsetX = ((elRect.left - originRect.left) % step + step) % step;
    const offsetY = ((elRect.top - originRect.top) % step + step) % step;
    el.style.backgroundPosition = `${-offsetX}px ${-offsetY}px`;
  }

  // --- Block rendering ----------------------------------------------------

  function renderBlockNode(block, cw) {
    const viewBlock = effectiveBlock(block);
    const el = document.createElement("div");
    el.className = `grid-node grid-node--block${viewBlock.blockType === "label" ? " grid-node--label-block" : ""}`;
    el.dataset.nodeId = block.id;
    el.dataset.nodeKind = "block";
    if (editMode) el.tabIndex = 0;
    applyRect(el, block, cw);
    applyNodeStyle(el, viewBlock.style);

    if (viewBlock.blockType === "label") {
      const labelEl = document.createElement("div");
      labelEl.className = "label-block-text";
      labelEl.contentEditable = "true";
      labelEl.textContent = viewBlock.name;
      labelEl.addEventListener("input", () => {
        commitMutation(() => {
          sourceBlockFor(block).name = labelEl.textContent;
        }, { render: false });
      });
      wireGhostDefault(labelEl, "Text Label", (text) => {
        commitMutation(() => {
          sourceBlockFor(block).name = text;
        }, { render: false });
      });
      el.append(labelEl);
      applyTextStyleToOwnText(el, viewBlock.style);
      el.append(buildDragHandle());
      el.append(buildResizeHandle());
      el.append(buildBlockToolbar(block, el));
      wireDrag(el, block, cw, () => renderAll());
      wireResize(el, block, cw, {
        minW: 1,
        minH: 1,
        onCommit: () => {
          persist();
          renderAll();
        },
      });
      return el;
    }

    // Name and body are explicitly positioned to occupy exactly
    // BLOCK_HEADER_ROWS worth of pixels for the name, with the body
    // starting right after — NOT flexbox auto-sizing. Flexbox sizing
    // the name to its own font-driven height (rather than a fixed
    // grid-row height) was what caused blocks to render shorter than
    // their actual content, spilling into whatever sat below them.
    const headerPx = BLOCK_HEADER_ROWS * cw + (BLOCK_HEADER_ROWS - 1) * GAP_PX;

    const nameEl = document.createElement("div");
    nameEl.className = "block-name";
    nameEl.style.height = `${headerPx}px`;
    nameEl.contentEditable = "true";
    nameEl.textContent = viewBlock.name;
    nameEl.title = viewBlock.name; // belt-and-suspenders: a native
      // tooltip for the full name on hover even where the ellipsis
      // (see .block-name in custom-sheet.css) has to cut it short
    nameEl.addEventListener("input", () => {
      commitMutation(() => {
        sourceBlockFor(block).name = nameEl.textContent;
      }, { render: false });
      nameEl.title = nameEl.textContent;
      renderBlockFrame();
    });
    wireGhostDefault(nameEl, "New Block", (text) => {
      commitMutation(() => {
        sourceBlockFor(block).name = text;
      }, { render: false });
      renderBlockFrame();
    });
    el.append(nameEl);

    const body = document.createElement("div");
    body.className = "block-body";
    body.style.top = `${headerPx + GAP_PX}px`;
    // Grid lines for this body are applied once it's actually in the
    // DOM — see the post-append pass at the end of renderPageGrid.
    el.append(body);

    applyTextStyleToOwnText(el, viewBlock.style);

    viewBlock.children.forEach(field => {
      body.append(renderFieldNode(field, block, cw, viewBlock.style));
    });

    el.append(buildDragHandle());
    el.append(buildResizeHandle());
    el.append(buildBlockToolbar(block, el));

    wireDrag(el, block, cw, () => renderAll());
    wireResize(el, block, cw, {
      minW: 1,
      minH: BLOCK_HEADER_ROWS + 1,
      onCommit: () => {
        persist();
        renderAll();
      },
    });

    return el;
  }

  function buildBlockToolbar(block, wrapperEl) {
    const bar = document.createElement("div");
    bar.className = "node-toolbar";

    bar.append(buildStyleButton(block, wrapperEl));
    bar.append(buildBorderToggleButton(block, wrapperEl));

    if (effectiveBlock(block).blockType !== "label") {
      const addFieldBtn = document.createElement("button");
      addFieldBtn.type = "button";
      addFieldBtn.title = "Add field";
      addFieldBtn.textContent = "+";
      addFieldBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openFieldTypeMenu(addFieldBtn, (fieldType) => {
          commitMutation(() => {
            const size = DEFAULT_FIELD_SIZE[fieldType] || { w: 1, h: 1 };
            const field = createField({
              fieldType, label: "Stat",
              x: 0, y: 0, w: size.w, h: size.h,
            });
            sourceBlockFor(block).children.push(field);
          });
        });
      });
      bar.append(addFieldBtn);
    }

    wireHoverToolbar(wrapperEl, bar);
    return bar;
  }

  // --- Field rendering ------------------------------------------------------

  function renderFieldNode(field, parentBlock, cw, parentStyle = {}) {
    const el = document.createElement("div");
    el.className = "grid-node grid-node--field";
    el.dataset.nodeId = field.id;
    el.dataset.nodeKind = "field";
    if (editMode) el.tabIndex = 0;
    applyRect(el, field, cw);
    const fieldStyle = mergeTextStyle(parentStyle, field.style || {});
    applyNodeStyle(el, fieldStyle);

    const labelEl = renderFieldInner(el, field, parentBlock, cw);
    // el isn't attached to the document yet at this point (the caller
    // appends it further up the tree once it's built) — labelEl has no
    // real layout yet either, so checking scrollWidth/clientWidth here
    // would just compare 0 to 0. Queue it and let renderPageGrid check
    // it once the whole grid is actually in the DOM (see
    // pendingLabelOverflowChecks above and its drain at the end of
    // renderPageGrid).
    if (labelEl) pendingLabelOverflowChecks.push({ labelEl, field, fieldEl: el, parentBlock });
    applyTextStyleToOwnText(el, fieldStyle);

    el.append(buildDragHandle());
    if (RESIZABLE_FIELD_TYPES.has(field.fieldType)) {
      el.append(buildResizeHandle());
    }
    if (field.fieldType === "text") {
      el.append(buildEquationHint(field));
    }
    el.append(buildFieldToolbar(field, parentBlock, el));

    // Fields are confined to their parent block's content area — the
    // area below the reserved name row (see BLOCK_HEADER_ROWS). They
    // can move/resize freely WITHIN that, but never past the block's
    // own edges; the block itself has no such limit (it can go
    // anywhere on the canvas).
    const contentRows = parentBlock.h - BLOCK_HEADER_ROWS;
    wireDrag(el, field, cw, () => renderAll(), {
      maxX: parentBlock.w - field.w,
      maxY: contentRows - field.h,
    });
    if (RESIZABLE_FIELD_TYPES.has(field.fieldType)) {
      wireResize(el, field, cw, {
        minW: 1, minH: 1,
        maxW: parentBlock.w - field.x,
        maxH: contentRows - field.y,
        onCommit: () => {
          persist();
          renderAll();
        },
      });
    }

    return el;
  }

  /** Rebuilds just the label+value area of a field (not its outer
   *  wrapper/handles/toolbar) — used both for the initial build and
   *  for the label-position cycle button's FLIP animation. Returns
   *  the label element so the caller can animate it. */
  function renderFieldInner(fieldEl, field, parentBlock) {
    const old = fieldEl.querySelector(".field-inner");
    if (old) old.remove();

    const inner = document.createElement("div");
    inner.className = `field-inner field-inner--${field.labelPosition}`;

    // "label" and "picture" fields are just one element filling the
    // whole box — no separate caption/value split.
    if (CAPTIONLESS_FIELD_TYPES.has(field.fieldType)) {
      const valueEl = buildFieldValue(field, () => {});
      inner.append(valueEl);
      fieldEl.prepend(inner);
      return null;
    }

    const labelEl = document.createElement("div");
    labelEl.className = "field-label";
    labelEl.contentEditable = "true";
    labelEl.textContent = field.label;
    labelEl.title = field.label; // same belt-and-suspenders tooltip as
      // block-name above, for whenever a label doesn't fit its cell
    let labelBeforeEdit = field.label;
    labelEl.addEventListener("focus", () => {
      labelBeforeEdit = field.label;
    });
    labelEl.addEventListener("keydown", (e) => {
      // Plain Enter = done editing (blur); Shift+Enter = an actual new
      // line in the label, left to the browser's normal contenteditable
      // behavior.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        labelEl.blur();
      }
    });
    labelEl.addEventListener("input", () => {
      commitMutation(() => {
        field.label = labelEl.textContent;
      }, { render: false });
      labelEl.title = labelEl.textContent;
      renderBlockFrame();
      updateFieldLabelVisibility(field, labelEl);
      growFieldIfLabelOverflows(labelEl, field, fieldEl, parentBlock);
    });
    labelEl.addEventListener("blur", () => {
      // Checked on blur (not per-keystroke) so typing itself is never
      // interrupted — labels double as formula variable names (see
      // formulaEditor.js's chips) and as the names droppable into the
      // character-card fields, so two fields sharing one would be
      // genuinely ambiguous in both places. Dragging a COPY of a field
      // in (from the sidebar, onto this tab or another) is exempt —
      // that goes through addFieldReferenceToActiveTab/
      // addBlockReferenceToActiveTab, never through this rename path,
      // so cloned duplicates are never blocked here.
      const current = field.label.trim();
      if (current && current !== labelBeforeEdit.trim() && isLabelAlreadyInUse(current, field)) {
        showToast(`The label "${current}" is already in use by another field — reverted to "${labelBeforeEdit}".`, { isError: true });
        commitMutation(() => {
          field.label = labelBeforeEdit;
        }, { render: false });
        labelEl.textContent = labelBeforeEdit;
        labelEl.classList.toggle("is-ghost-default", labelBeforeEdit === "Stat");
        updateFieldLabelVisibility(field, labelEl);
      } else {
        maybeAutoRegisterMoneyField(field);
      }
    });
    wireGhostDefault(labelEl, "Stat", (text) => {
      commitMutation(() => {
        field.label = text;
      }, { render: false });
      renderBlockFrame();
      updateFieldLabelVisibility(field, labelEl);
    });
    labelEl.addEventListener("pointerdown", (e) => e.stopPropagation());

    const valueEl = buildFieldValue(field, () => updateFieldLabelVisibility(field, labelEl));
    updateFieldLabelVisibility(field, labelEl);

    inner.append(labelEl, valueEl);
    fieldEl.prepend(inner); // prepend so handles/toolbar (appended later) stay on top
    return labelEl;
  }

  /** The default "Stat" label acts as a placeholder-style prompt: once
   *  a text field actually has a value, the still-unedited default
   *  label is redundant, so it hides — and comes right back the
   *  instant the value is cleared. A label the user has actually
   *  renamed (to "STR", say) always stays visible regardless of
   *  value, since by then it's carrying real information, not
   *  functioning as a placeholder anymore. Scoped to text fields
   *  specifically, per how this was asked for. */
  function updateFieldLabelVisibility(field, labelEl) {
    const isUnrenamedDefault = field.label === "Stat";
    const hasValue = field.fieldType === "text" && (field.formula ? true : hasVisibleText(field.value));
    // visibility, not display: the label's SPACE stays reserved either
    // way, so the value box doesn't expand into it once the label
    // (still just the unrenamed default) disappears — see the
    // .field-label/.field-value comments in custom-sheet.css.
    labelEl.style.visibility = (isUnrenamedDefault && hasValue) ? "hidden" : "";
  }

  function hasVisibleText(html) {
    if (!html) return false;
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent.trim().length > 0;
  }

  /** Makes a contentEditable element behave like a placeholder: while
   *  its content is still exactly the sentinel default text (e.g. a
   *  fresh field's label is literally the string "Stat"), it's shown
   *  faded/italic via .is-ghost-default — and focusing it clears the
   *  visible text immediately, so typing a real name doesn't require
   *  deleting the default first. Blurring with content that's
   *  genuinely EMPTY (zero characters) restores the ghost and commits
   *  the sentinel value back via `commit`; anything else — even just
   *  a space — counts as a real (if unusual) value and is left alone.
   *  Uses innerHTML rather than textContent so this also works for
   *  richly-formatted fields (a plain default string round-trips
   *  through innerHTML identically to textContent). */
  function wireGhostDefault(el, defaultText, commit) {
    function refreshGhostState() {
      el.classList.toggle("is-ghost-default", el.innerHTML === defaultText);
    }
    refreshGhostState();
    el.addEventListener("focus", () => {
      if (el.classList.contains("is-ghost-default")) {
        el.innerHTML = "";
        el.classList.remove("is-ghost-default");
      }
    });
    el.addEventListener("blur", () => {
      if (el.textContent.length === 0) {
        el.innerHTML = defaultText;
        el.classList.add("is-ghost-default");
        commit(defaultText);
      }
    });
  }

  function buildFieldValue(field, onValueChange) {
    if (field.fieldType === "text") {
      const el = document.createElement("div");
      el.addEventListener("pointerdown", (e) => e.stopPropagation());
      if (field.formula) {
        el.className = "field-value field-value--computed";
        el.contentEditable = "false";
        el.dataset.fieldId = field.id;
        el.textContent = formatComputedValue(formulaValues[field.id]);
      } else {
        el.className = "field-value";
        el.contentEditable = "true";
        el.innerHTML = field.value || "";
        el.addEventListener("input", () => {
          commitMutation(() => {
            field.value = el.innerHTML;
          }, { render: false });
          if (onValueChange) onValueChange();
        });
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter") e.preventDefault(); // single-line — see textarea for multi-line
        });
      }
      return el;
    }

    if (field.fieldType === "label") {
      const el = document.createElement("div");
      el.className = "field-value field-value--label";
      el.contentEditable = "true";
      el.innerHTML = field.value || "";
      el.addEventListener("pointerdown", (e) => e.stopPropagation());
      el.addEventListener("input", () => {
        commitMutation(() => {
          field.value = el.innerHTML;
        }, { render: false });
      });
      wireGhostDefault(el, "Label text", (text) => {
        commitMutation(() => {
          field.value = text;
        }, { render: false });
      });
      return el;
    }

    if (field.fieldType === "textarea") {
      const el = document.createElement("div");
      el.className = "field-value field-value--textarea";
      el.contentEditable = "true";
      el.innerHTML = field.value || "";
      el.addEventListener("pointerdown", (e) => e.stopPropagation());
      el.addEventListener("input", () => {
        commitMutation(() => {
          field.value = el.innerHTML;
        }, { render: false });
      });
      return el;
    }

    if (field.fieldType === "textlist") {
      return buildTextListValue(field);
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

    const el = document.createElement("div");
    el.className = "field-value field-value--options";
    // A formula-driven radio group's button count is whatever that
    // formula currently computes (see computeRadioOptionCounts) —
    // `options` becomes just the fallback default, used only while no
    // formula is set.
    const effectiveOptions = field.fieldType === "radio" && field.optionsFormula
      ? (radioOptionCounts[field.id] ?? 0)
      : (field.options || 1);
    el.style.gridTemplateColumns = `repeat(${Math.max(1, effectiveOptions)}, minmax(0, 1fr))`;

    if (field.fieldType === "radio") {
      // Filled left-to-right up through whichever one was clicked
      // (n <= field.selected), not just that one alone — these are
      // used as a "how many of N used" meter (spell slots, death
      // saves), not a real mutually-exclusive choice, even though
      // they're built from <input type="radio"> for the free grouping
      // behavior that gives. A plain click only ever checks the one
      // clicked (that's the browser's own native behavior firing
      // before our "change" handler even runs), so the rest of the
      // fill has to be patched in manually right after, via the same
      // `inputs` this loop is already building.
      const inputs = [];
      for (let n = 1; n <= effectiveOptions; n++) {
        const wrap = document.createElement("label");
        wrap.className = "option-radio";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = field.id;
        input.checked = field.selected !== null && n <= field.selected;
        input.addEventListener("change", () => {
          commitMutation(() => {
            field.selected = n;
          }, { render: false });
          inputs.forEach((otherInput, idx) => {
            otherInput.checked = idx + 1 <= n;
          });
        });
        input.addEventListener("pointerdown", (e) => e.stopPropagation());
        wrap.append(input);
        el.append(wrap);
        inputs.push(input);
      }
    } else if (field.fieldType === "checkbox") {
      for (let i = 0; i < field.options; i++) {
        const wrap = document.createElement("label");
        wrap.className = "option-checkbox";
        const granted = grantedCheckboxes.has(`${field.id}::${i}`);
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !!field.checked[i] || granted;
        if (granted) {
          // Not independently uncheckable while granted — same
          // reasoning as the numeric ops overwriting a formula field's
          // own value: this box's visible state is a computed result
          // (of the currently-selected Race/Class/etc.), not this
          // box's own stored data, while it's active. field.checked[i]
          // underneath is untouched, so a manually-checked box stays
          // checked on its own after the granting choice changes away.
          input.disabled = true;
          wrap.classList.add("option-checkbox--granted");
          wrap.title = "Granted automatically by a selected Race/Class/etc. — change that selection to remove it";
        }
        input.addEventListener("change", () => {
          commitMutation(() => {
            field.checked[i] = input.checked;
          }, { render: false });
        });
        input.addEventListener("pointerdown", (e) => e.stopPropagation());
        wrap.append(input);
        el.append(wrap);
      }
    }
    return el;
  }

  /** Draggable-to-reorder bulleted list — used by the "textlist" field
   *  type. Each item's own text is independently editable; the row
   *  itself (not the text) is the drag source, so dragging never
   *  fights with placing a text caret. */
  function buildTextListValue(field) {
    if (!field.items) field.items = [];
    const el = document.createElement("div");
    el.className = "field-value field-value--textlist";
    el.addEventListener("pointerdown", (e) => e.stopPropagation());

    const itemsWrap = document.createElement("div");
    itemsWrap.className = "textlist-items";
    let dragFromIndex = null;

    function renderItems() {
      itemsWrap.innerHTML = "";
      field.items.forEach((text, index) => {
        const row = document.createElement("div");
        row.className = "textlist-item";
        row.draggable = true;

        row.addEventListener("dragstart", (e) => {
          dragFromIndex = index;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", ""); // Firefox needs data set to allow the drag
          row.classList.add("is-dragging");
        });
        row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
        row.addEventListener("dragover", (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        });
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          if (dragFromIndex === null || dragFromIndex === index) return;
          commitMutation(() => {
            const [moved] = field.items.splice(dragFromIndex, 1);
            field.items.splice(index, 0, moved);
          }, { render: false });
          renderItems();
        });

        const handle = document.createElement("span");
        handle.className = "textlist-item__handle";
        handle.textContent = "⠿";

        const bullet = document.createElement("span");
        bullet.className = "textlist-item__bullet";
        bullet.textContent = "•";

        const textEl = document.createElement("div");
        textEl.className = "textlist-item__text";
        textEl.contentEditable = "true";
        textEl.textContent = text;
        textEl.addEventListener("pointerdown", (e) => e.stopPropagation());
        textEl.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
        textEl.addEventListener("input", () => {
          commitMutation(() => {
            field.items[index] = textEl.textContent;
          }, { render: false });
        });

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "textlist-item__remove";
        removeBtn.title = "Remove item";
        removeBtn.textContent = "✕";
        removeBtn.setAttribute("aria-label", "Remove item");
        removeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          commitMutation(() => {
            field.items.splice(index, 1);
          }, { render: false });
          renderItems();
        });

        row.append(handle, bullet, textEl, removeBtn);
        itemsWrap.append(row);
      });
    }
    renderItems();

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "textlist-add";
    addBtn.textContent = "+ Add item";
    addBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      commitMutation(() => {
        field.items.push("");
      }, { render: false });
      renderItems();
      const lastText = itemsWrap.querySelector(".textlist-item:last-child .textlist-item__text");
      if (lastText) lastText.focus();
    });

    el.append(itemsWrap, addBtn);
    return el;
  }

  /** The on-sheet control for a "dropdown" field is just a native
   *  <select> — list management (add/remove/reorder/alphabetize, plus
   *  each choice's optional stat/access "bundle") lives in a separate
   *  popover (openDropdownChoicesEditor) opened from the field's
   *  toolbar, the same way style editing does, so the sheet itself
   *  always shows a normal-looking dropdown. */
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
    (field.choices || []).forEach((choice) => {
      if (!allowed.has(choice.id)) return;
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
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result.length > MAX_IMAGE_BYTES) {
        showToast("That image is large enough that it (plus the rest of this character) may not fit in a single Firestore document (1MB limit). It'll be applied, but saving might fail — try a smaller image if so.");
      }
      onLoaded(reader.result);
    };
    reader.readAsDataURL(file);
  }

  /** A simple filled "person" glyph — used both for the avatar toggle
   *  button and (larger) as the generic placeholder when a picture
   *  field has no image yet. Built as inline SVG rather than an emoji
   *  so it renders identically everywhere instead of depending on the
   *  OS/browser's emoji font. */
  function personIconSvgMarkup() {
    return `<svg viewBox="0 0 24 24" class="person-icon" aria-hidden="true">
      <circle cx="12" cy="8" r="4.2"/>
      <path d="M4 21c0-4.8 3.6-8.6 8-8.6s8 3.8 8 8.6z"/>
    </svg>`;
  }

  function buildAvatarPlaceholderSvg() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    svg.classList.add("picture-placeholder-svg");
    svg.innerHTML = `
      <rect width="24" height="24" fill="#2a2520"/>
      <circle cx="12" cy="9.5" r="4" fill="#4a4038"/>
      <path d="M12 14.6c-4.8 0-8.2 3.2-8.2 7.7v1.7h16.4v-1.7c0-4.5-3.4-7.7-8.2-7.7z" fill="#4a4038"/>
    `;
    return svg;
  }

  /** Clears isAvatar on every OTHER picture field across every tab —
   *  only one field on the whole character can be "the" avatar shown
   *  on the character-selection page. Caller is responsible for
   *  setting the one it actually wants afterward (or leaving all of
   *  them false, to unset entirely). */
  function clearOtherAvatars(exceptField) {
    character.sheetTabs.forEach((tab) => {
      (tab.layout || []).forEach((b) => {
        (b.children || []).forEach((f) => {
          if (f.fieldType === "picture" && f !== exceptField) f.isAvatar = false;
        });
      });
    });
  }

  /** A "picture" field: shows the image if one's been set, or a
   *  generic placeholder silhouette otherwise. Click it (or drag an
   *  image file onto it) to set/replace the image. The small avatar
   *  button in the corner marks this as the character's portrait for
   *  the character-selection page (see findAvatarImageData in
   *  characterStore-adjacent code / main.js — only one field across
   *  the whole character can hold that flag at a time). */
  function buildPictureValue(field) {
    const wrap = document.createElement("div");
    wrap.className = "field-value field-value--picture";
    wrap.addEventListener("pointerdown", (e) => e.stopPropagation());

    if (field.imageData) {
      const img = document.createElement("img");
      img.className = "picture-field-image";
      img.src = field.imageData;
      img.draggable = false;
      img.alt = field.label || "Portrait";
      wrap.append(img);
    } else {
      wrap.append(buildAvatarPlaceholderSvg());
    }

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.hidden = true;
    fileInput.addEventListener("pointerdown", (e) => e.stopPropagation());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (!file) return;
      readImageFile(file, (dataUrl) => {
        commitMutation(() => {
          field.imageData = dataUrl;
        });
      });
    });
    wrap.append(fileInput);

    wrap.addEventListener("click", (e) => {
      if (e.target.closest(".picture-avatar-btn")) return;
      fileInput.click();
    });
    wrap.addEventListener("dragover", (e) => {
      if (e.dataTransfer.types.includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    });
    wrap.addEventListener("drop", (e) => {
      const file = Array.from(e.dataTransfer.files || []).find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      e.stopPropagation(); // this field is handling it — don't let the
        // page-grid's own "drop an image to create a new picture
        // block" handler also fire for the same drop
      readImageFile(file, (dataUrl) => {
        commitMutation(() => {
          field.imageData = dataUrl;
        });
      });
    });

    const avatarBtn = document.createElement("button");
    avatarBtn.type = "button";
    avatarBtn.className = "picture-avatar-btn" + (field.isAvatar ? " active" : "");
    avatarBtn.title = "Set as Avatar";
    avatarBtn.innerHTML = personIconSvgMarkup();
    avatarBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    avatarBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const makingAvatar = !field.isAvatar;
      commitMutation(() => {
        clearOtherAvatars(field);
        field.isAvatar = makingAvatar;
      });
    });
    wrap.append(avatarBtn);

    return wrap;
  }

  /** A "catalog" field is just a button — clicking it opens the
   *  player-facing browser (catalogBrowser.js) if it's configured, or
   *  the config popover (openCatalogFieldConfig) if it isn't yet. The
   *  catalog itself lives in Firestore (see catalogCache/store), not
   *  on the field — the field only holds WHICH one (scope + id) and
   *  which of this character's own fields is the money it spends. */
  function buildCatalogValue(field) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "field-value field-value--catalog";
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    btn.textContent = field.catalogSource ? "Open Catalog" : "Set up a catalog…";
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!field.catalogSource) {
        openCatalogFieldConfig(field, btn.closest(".grid-node"));
        return;
      }
      const catalog = await store.loadCatalog(field.catalogSource.scope, field.catalogSource.id);
      if (!catalog) {
        showToast("That catalog couldn't be found — it may have been deleted. Reconfigure this field from its ⚙ button.", { isError: true });
        return;
      }
      autoAssignMoneyFieldIfNeeded(field);
      const moneyField = field.moneyFieldId ? flattenAllFieldsAcrossTabs().find(f => f.id === field.moneyFieldId) : null;
      openCatalogBrowser({
        catalog,
        moneyLabel: moneyField ? moneyField.label : null,
        getMoney: () => readFieldNumericValue(moneyField),
        spendMoney: (amount) => {
          if (!moneyField) return;
          const next = readFieldNumericValue(moneyField) - amount;
          commitMutation(() => {
            moneyField.value = String(next);
          });
        },
      });
    });
    return btn;
  }

  /** Read-only — this field has no configuration or stored data of its
   *  own (see createField's featureList branch in blockModel.js). It
   *  just re-renders whatever collectGrantedFeatures currently
   *  computed for the whole character: every feature grant unlocked
   *  by the level-gated bundles on the character's dropdown choices
   *  (Class, Race, Background, etc.), sorted by level. Same "computed
   *  fresh every render" model as a granted checkbox — nothing here is
   *  ever written back to field or bundle data. */
  function buildFeatureListValue(field) {
    const el = document.createElement("div");
    el.className = "field-value field-value--featurelist";
    el.addEventListener("pointerdown", (e) => e.stopPropagation());

    if (grantedFeatures.length === 0) {
      const empty = document.createElement("div");
      empty.className = "featurelist-empty";
      empty.textContent = "No features yet — pick a Class/Race/Background with feature grants, or level up.";
      el.append(empty);
      return el;
    }

    grantedFeatures.forEach((feature) => {
      const row = document.createElement("div");
      row.className = "featurelist-row";

      const header = document.createElement("div");
      header.className = "featurelist-row__header";

      const name = document.createElement("span");
      name.className = "featurelist-row__name";
      name.textContent = feature.name;
      header.append(name);

      if (feature.level > 0) {
        const level = document.createElement("span");
        level.className = "featurelist-row__level";
        level.textContent = `Lvl ${feature.level}`;
        header.append(level);
      }

      row.append(header);

      if (feature.description) {
        const desc = document.createElement("div");
        desc.className = "featurelist-row__description";
        desc.textContent = feature.description;
        row.append(desc);
      }

      el.append(row);
    });

    return el;
  }

  /** Popover for a catalog field's own setup: which saved catalog it
   *  links to, and which of this character's own text fields is the
   *  money it spends from (dragged in from the sidebar, same
   *  "application/x-sheet-field" payload every other field-drag uses). */
  function openCatalogFieldConfig(field, wrapperEl) {
    closeOpenPopovers();
    if (!wrapperEl) return;

    const pop = document.createElement("div");
    pop.className = "style-popover catalog-field-config";
    pop.addEventListener("pointerdown", (e) => e.stopPropagation());

    const title = document.createElement("div");
    title.className = "style-popover__badge";
    title.textContent = "Catalog Setup";
    pop.append(title);

    const catalogLabel = document.createElement("label");
    catalogLabel.textContent = "Catalog";
    const catalogSelect = document.createElement("select");
    const blankOpt = document.createElement("option");
    blankOpt.value = "";
    blankOpt.textContent = catalogCache.length ? "Choose a catalog…" : "No catalogs saved yet";
    catalogSelect.append(blankOpt);
    catalogCache.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = `${cat.scope}::${cat.id}`;
      opt.textContent = cat.scope === "global" ? `${cat.name} (Global)` : cat.name;
      if (field.catalogSource && field.catalogSource.scope === cat.scope && field.catalogSource.id === cat.id) {
        opt.selected = true;
      }
      catalogSelect.append(opt);
    });
    catalogSelect.addEventListener("change", () => {
      if (!catalogSelect.value) {
        commitMutation(() => { field.catalogSource = null; }, { render: false });
        return;
      }
      const [scope, id] = catalogSelect.value.split("::");
      commitMutation(() => { field.catalogSource = { scope, id }; }, { render: false });
    });
    pop.append(catalogLabel, catalogSelect);

    const manageBtn = document.createElement("button");
    manageBtn.type = "button";
    manageBtn.className = "btn formula-toolbar__btn";
    manageBtn.textContent = "Manage Catalogs…";
    manageBtn.addEventListener("click", () => {
      openCatalogLibraryManager(store, refreshCatalogCache, resolveFieldById);
    });
    pop.append(manageBtn);

    const moneyLabel = document.createElement("label");
    moneyLabel.textContent = "Money field";
    pop.append(moneyLabel);

    // A <select> rather than a drop zone — dragging a field's own grid
    // element only ever works within its own block (by design,
    // elsewhere in this file), so a plain drag target here could only
    // ever accept fields from the SAME block a Catalog field happens
    // to live in. This lists every Num Field on the character, grouped
    // by tab, so any of them is reachable regardless of that.
    autoAssignMoneyFieldIfNeeded(field);
    const moneySelect = document.createElement("select");
    const blankMoneyOpt = document.createElement("option");
    blankMoneyOpt.value = "";
    blankMoneyOpt.textContent = "None";
    moneySelect.append(blankMoneyOpt);
    character.sheetTabs.forEach((tab) => {
      const candidates = (tab.layout || []).flatMap((block) => (block.children || []).filter(f => f.fieldType === "text"));
      if (candidates.length === 0) return;
      const group = document.createElement("optgroup");
      group.label = tab.name || "Tab";
      candidates.forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f.id;
        opt.textContent = f.label || "Field";
        if (field.moneyFieldId === f.id) opt.selected = true;
        group.append(opt);
      });
      moneySelect.append(group);
    });
    moneySelect.addEventListener("change", () => {
      commitMutation(() => { field.moneyFieldId = moneySelect.value || null; }, { render: false });
    });
    pop.append(moneySelect);

    wrapperEl.append(pop);
    positionPopoverWithinViewport(pop);
    toolbarWithOpenPopup = wrapperEl.querySelector(".node-toolbar");
  }

  /** Popover for managing a dropdown field's choice list: add, remove,
   *  drag to reorder, and an Auto-Alphabetize toggle that keeps the
   *  list sorted (and disables manual dragging, since a fixed order
   *  would just get overwritten by the next sort). */
  const MODIFIER_OPS = [
    { value: "add", label: "+" },
    { value: "subtract", label: "−" },
    { value: "multiply", label: "×" },
    { value: "set", label: "=" },
  ];

  function ensureBundle(choice) {
    if (!choice.bundle) choice.bundle = { statModifiers: [], dropdownAccess: [], featureGrants: [], resourceGrants: [], choiceGroups: [] };
    if (!choice.bundle.statModifiers) choice.bundle.statModifiers = [];
    if (!choice.bundle.dropdownAccess) choice.bundle.dropdownAccess = [];
    if (!choice.bundle.featureGrants) choice.bundle.featureGrants = [];
    if (!choice.bundle.resourceGrants) choice.bundle.resourceGrants = [];
    if (!choice.bundle.choiceGroups) choice.bundle.choiceGroups = [];
    return choice.bundle;
  }

  function bundleIsEmpty(bundle) {
    return !bundle || ((bundle.statModifiers || []).length === 0 && (bundle.dropdownAccess || []).length === 0
      && (bundle.featureGrants || []).length === 0 && (bundle.resourceGrants || []).length === 0
      && (bundle.choiceGroups || []).length === 0);
  }

  /** Materializes a reusable library bundle (see bundleLibraryEditor.js
   *  — names only, no field ids) onto one specific choice, resolving
   *  each name against THIS character's actual fields. A name that
   *  doesn't match anything still gets added (with a null target) so
   *  it's visibly there to fix by hand, rather than silently dropped —
   *  e.g. because this character's sheet spells a stat differently.
   *  Adds on top of whatever's already in the choice's bundle; doesn't
   *  replace it, so applying a library bundle is a safe starting point
   *  even if you've already hand-tweaked something here. */
  function applyBundleLibraryToChoice(libraryEntry, choice, allFields) {
    const bundle = ensureBundle(choice);
    const norm = (s) => (s || "").trim().toLowerCase();

    // Tracks which library entries have already been applied to this
    // choice (by library id, not name — a rename in the library
    // shouldn't cause a re-apply). Makes every caller of this function
    // — the single "+ Apply" button, Bulk Apply, and the ruleset
    // auto-sync below — safe to run more than once without stacking
    // duplicate stat modifiers/features each time. Only real for
    // library entries that HAVE an id (i.e. actually saved, not a
    // one-off object); that's true for every caller in this file.
    if (!bundle.appliedLibraryIds) bundle.appliedLibraryIds = [];
    if (libraryEntry.id) {
      if (bundle.appliedLibraryIds.includes(libraryEntry.id)) return false;
      bundle.appliedLibraryIds.push(libraryEntry.id);
    }

    (libraryEntry.statModifiers || []).forEach((mod) => {
      // "grant" targets a proficiency-style checkbox (single-option,
      // per the toggleField convention createStarterLayout uses for
      // every skill/save proficiency marker) by label, same as a
      // numeric op targets a plain text field by label — everything
      // else about the resolution is identical. Falls back to
      // whichever fieldType actually matches so a stray text field
      // named the same as a checkbox (or vice versa) doesn't silently
      // resolve to the wrong kind of target.
      const wantType = mod.op === "grant" ? "checkbox" : "text";
      const match = allFields.find(f => f.fieldType === wantType && norm(f.label) === norm(mod.targetFieldName));
      bundle.statModifiers.push({
        id: newId(),
        targetFieldId: match ? match.id : null,
        targetIndex: mod.op === "grant" ? 0 : null,
        op: mod.op,
        value: mod.value,
        minLevel: Number.isFinite(mod.minLevel) ? mod.minLevel : null,
      });
    });

    (libraryEntry.dropdownAccess || []).forEach((rule) => {
      const targetField = allFields.find(f => f.fieldType === "dropdown" && norm(f.label) === norm(rule.targetFieldName));
      let allowedChoiceIds = [];
      if (targetField) {
        const wanted = new Set((rule.allowedChoiceNames || []).map(norm));
        allowedChoiceIds = (targetField.choices || [])
          .filter(c => wanted.has(norm(c.text)))
          .map(c => c.id);
      }
      bundle.dropdownAccess.push({
        id: newId(),
        targetFieldId: targetField ? targetField.id : null,
        allowedChoiceIds,
        minLevel: Number.isFinite(rule.minLevel) ? rule.minLevel : null,
      });
    });

    // Feature grants are just display text (name + description) — unlike
    // statModifiers/dropdownAccess they don't target any field on this
    // character, so there's no name-resolution step: copy straight
    // through with a fresh id, same as everything else here treats the
    // library entry as a template rather than a shared reference.
    (libraryEntry.featureGrants || []).forEach((grant) => {
      bundle.featureGrants.push({
        id: newId(),
        name: grant.name,
        description: grant.description || "",
        minLevel: Number.isFinite(grant.minLevel) ? grant.minLevel : null,
      });
    });

    (libraryEntry.resourceGrants || []).forEach((grant) => {
      bundle.resourceGrants.push({
        id: newId(),
        name: grant.name || "",
        maximum: Number.isFinite(grant.maximum) ? grant.maximum : 0,
        reset: grant.reset || "rest",
        minLevel: Number.isFinite(grant.minLevel) ? grant.minLevel : null,
      });
    });

    // Choice options use the same name-based library format as ordinary
    // modifiers. Resolve them once while attaching to a sheet so later
    // play only reads stable field ids, even if the library is edited.
    const materializeModifiers = (modifiers) => (modifiers || []).map((mod) => {
      const wantType = mod.op === "grant" ? "checkbox" : "text";
      const match = allFields.find((field) => field.fieldType === wantType && norm(field.label) === norm(mod.targetFieldName));
      return {
        id: newId(),
        targetFieldId: match ? match.id : null,
        targetIndex: mod.op === "grant" ? 0 : null,
        op: mod.op,
        value: mod.value,
        minLevel: Number.isFinite(mod.minLevel) ? mod.minLevel : null,
      };
    });
    (libraryEntry.choiceGroups || []).forEach((group) => {
      bundle.choiceGroups.push({
        id: group.id || newId(),
        label: group.label || "Choose an option",
        minLevel: Number.isFinite(group.minLevel) ? group.minLevel : null,
        minSelections: Number.isFinite(group.minSelections) ? group.minSelections : 0,
        maxSelections: Number.isFinite(group.maxSelections) ? group.maxSelections : 1,
        options: (group.options || []).map((option) => ({
          id: option.id || newId(),
          name: option.name || "Unnamed option",
          description: option.description || "",
          statModifiers: materializeModifiers(option.statModifiers),
          featureGrants: (option.featureGrants || []).map((grant) => ({
            id: grant.id || newId(),
            name: grant.name || "",
            description: grant.description || "",
            minLevel: Number.isFinite(grant.minLevel) ? grant.minLevel : null,
          })),
          resourceGrants: (option.resourceGrants || []).map((grant) => ({
            id: grant.id || newId(),
            name: grant.name || "",
            maximum: Number.isFinite(grant.maximum) ? grant.maximum : 0,
            reset: grant.reset || "rest",
            minLevel: Number.isFinite(grant.minLevel) ? grant.minLevel : null,
          })),
        })),
      });
    });
    return true;
  }

  function openDropdownChoicesEditor(field, wrapperEl) {
    closeOpenPopovers();
    if (!field.choices) field.choices = [];
    // Set of choice ids whose "Modifiers" accordion is currently open —
    // survives renderRows() re-renders within this popover session, but
    // (like the rest of this popover's edits) is lost if a structural
    // edit closes the whole thing. See the file-level note on why
    // structural bundle edits do a full render rather than {render:false}.
    const expanded = new Set();

    const pop = document.createElement("div");
    pop.className = "style-popover dropdown-choices-editor";
    pop.addEventListener("pointerdown", (e) => e.stopPropagation());

    const title = document.createElement("div");
    title.className = "style-popover__badge";
    title.textContent = "Dropdown Choices";
    pop.append(title);

    function refreshFieldSelect() {
      const select = wrapperEl.querySelector("select.field-value");
      if (select) populateDropdownSelect(select, field);
    }

    const alphaRow = document.createElement("div");
    alphaRow.className = "dropdown-choices-editor__alpha-row";
    const alphaLabel = document.createElement("span");
    alphaLabel.textContent = "Alphabetize";
    const alphaBtn = document.createElement("button");
    alphaBtn.type = "button";
    function paintAlphaBtn() {
      alphaBtn.textContent = field.autoAlphabetize ? "ABC↓" : "ABC?";
      alphaBtn.title = field.autoAlphabetize
        ? "Auto-Alphabetize is on — click to turn off"
        : "Auto-Alphabetize is off — click to turn on";
      alphaBtn.className = "btn dropdown-choices-editor__alpha" + (field.autoAlphabetize ? " active" : "");
    }
    paintAlphaBtn();
    alphaBtn.addEventListener("click", () => {
      commitMutation(() => {
        field.autoAlphabetize = !field.autoAlphabetize;
        if (field.autoAlphabetize) field.choices.sort((a, b) => a.text.localeCompare(b.text));
      }, { render: false });
      paintAlphaBtn();
      renderRows();
      refreshFieldSelect();
    });
    alphaRow.append(alphaLabel, alphaBtn);
    pop.append(alphaRow);

    // --- Bulk Apply from Library ---
    // Wires an entire imported list (e.g. all 12 classes from
    // default-bundles/classes.json) to this field's choices in one
    // click, instead of opening each choice's own "Apply from Library"
    // one at a time. Matches purely by name (case/whitespace-insensitive)
    // against whatever's in the Bundle Libraries manager, so the bundle's
    // name has to match the choice text exactly (e.g. choice "Druid"
    // needs a library bundle also named "Druid"). Choices that already
    // have something applied still get the bundle layered on top, same
    // as the per-choice "+ Apply" button — safe to click again after a
    // fresh import without duplicating anything already wired by hand.
    const bulkRow = document.createElement("div");
    bulkRow.className = "dropdown-choices-editor__alpha-row";
    const bulkBtn = document.createElement("button");
    bulkBtn.type = "button";
    bulkBtn.className = "btn dropdown-choices-editor__alpha";
    bulkBtn.textContent = "Bulk Apply from Library";
    bulkBtn.title = "Matches each choice's text to a same-named bundle in your library and applies it to all of them at once";
    const bulkStatus = document.createElement("span");
    bulkStatus.className = "dropdown-choices-editor__bulk-status";
    bulkBtn.addEventListener("click", () => {
      const norm = (s) => (s || "").trim().toLowerCase();
      let applied = 0;
      const misses = [];
      commitLocal(() => {
        field.choices.forEach((choice) => {
          const lib = bundleLibraryCache.find((entry) => norm(entry.name) === norm(choice.text));
          if (lib) {
            applyBundleLibraryToChoice(lib, choice, flattenGlobalFields());
            applied++;
          } else {
            misses.push(choice.text);
          }
        });
      });
      bulkStatus.textContent = misses.length
        ? `Applied ${applied}/${field.choices.length}. No library match for: ${misses.join(", ")}`
        : `Applied ${applied}/${field.choices.length}.`;
      renderRows();
      refreshFieldSelect();
    });
    bulkRow.append(bulkBtn, bulkStatus);
    pop.append(bulkRow);

    const list = document.createElement("div");
    list.className = "dropdown-choices-editor__list";
    pop.append(list);

    /** Every edit in this whole popover — including the bundle editor
     *  below — uses {render:false} and refreshes just this popover's
     *  own DOM (renderRows/refreshFieldSelect) rather than a full
     *  page render, so a multi-step edit (configuring several stat
     *  modifiers, checking a dozen allowed-choice boxes) doesn't get
     *  interrupted or lose its accordion state along the way. The
     *  sheet-wide effects (another dropdown's options changing, a
     *  modified stat's displayed value) catch up in one full render
     *  when this popover actually closes — see the document-level
     *  pointerdown listener further down this file. */
    function commitLocal(mutator) {
      commitMutation(mutator, { render: false });
    }

    function renderRows() {
      list.innerHTML = "";
      field.choices.forEach((choice, index) => {
        const row = document.createElement("div");
        row.className = "dropdown-choices-editor__row";
        row.draggable = !field.autoAlphabetize;

        row.addEventListener("dragstart", (e) => {
          dragFromIndex = index;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", "");
        });
        row.addEventListener("dragover", (e) => {
          if (field.autoAlphabetize) return;
          e.preventDefault();
        });
        row.addEventListener("drop", (e) => {
          if (field.autoAlphabetize || dragFromIndex === null || dragFromIndex === index) return;
          e.preventDefault();
          commitLocal(() => {
            const [moved] = field.choices.splice(dragFromIndex, 1);
            field.choices.splice(index, 0, moved);
          });
          renderRows();
          refreshFieldSelect();
        });

        const handle = document.createElement("span");
        handle.className = "dropdown-choices-editor__handle";
        handle.textContent = field.autoAlphabetize ? "" : "⠿";

        const textEl = document.createElement("div");
        textEl.className = "dropdown-choices-editor__text";
        textEl.contentEditable = "true";
        textEl.textContent = choice.text;
        textEl.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
        textEl.addEventListener("input", () => {
          commitLocal(() => { choice.text = textEl.textContent; });
          refreshFieldSelect();
        });

        const modBtn = document.createElement("button");
        modBtn.type = "button";
        modBtn.className = "btn formula-toolbar__btn dropdown-choices-editor__mod-btn" +
          (!bundleIsEmpty(choice.bundle) ? " active" : "");
        modBtn.title = "Stat modifiers & dropdown access for this choice";
        modBtn.textContent = "⚙";
        modBtn.addEventListener("click", () => {
          if (expanded.has(choice.id)) expanded.delete(choice.id);
          else expanded.add(choice.id);
          renderRows();
        });

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "btn formula-toolbar__btn";
        removeBtn.textContent = "✕";
        removeBtn.setAttribute("aria-label", "Remove");
        removeBtn.addEventListener("click", () => {
          commitLocal(() => {
            if (field.selected === choice.id) field.selected = null;
            field.choices.splice(index, 1);
          });
          renderRows();
          refreshFieldSelect();
        });

        row.append(handle, textEl, modBtn, removeBtn);
        list.append(row);

        if (expanded.has(choice.id)) {
          list.append(renderModifiersPanel(field, choice, commitLocal, renderRows));
        }
      });
    }
    renderRows();

    const addRow = document.createElement("div");
    addRow.className = "dropdown-choices-editor__add";
    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.placeholder = "New choice…";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn";
    addBtn.textContent = "+ Add";
    function addChoice() {
      const text = addInput.value.trim();
      if (!text) return;
      commitLocal(() => {
        field.choices.push({ id: newId(), text, bundle: null });
        if (field.autoAlphabetize) field.choices.sort((a, b) => a.text.localeCompare(b.text));
      });
      addInput.value = "";
      renderRows();
      refreshFieldSelect();
      addInput.focus();
    }
    addBtn.addEventListener("click", addChoice);
    addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addChoice(); } });
    addRow.append(addInput, addBtn);
    pop.append(addRow);

    wrapperEl.append(pop);
    positionPopoverWithinViewport(pop);
    toolbarWithOpenPopup = wrapperEl.querySelector(".node-toolbar");
  }

  /** The expandable per-choice panel behind the ⚙ button: stat
   *  modifiers (this choice adds/subtracts/sets/multiplies some OTHER
   *  field's value) and dropdown-access rules (this choice restricts
   *  which choices some OTHER dropdown offers) — together, "a bundle"
   *  in the sense of a race/class/background entry bundling together
   *  everything it grants or restricts. `field` is the dropdown this
   *  choice belongs to (so it can exclude itself from the "restrict
   *  which OTHER dropdown" target list). `commitLocal` and
   *  `refreshPanel` are passed in from the caller so edits here share
   *  the same {render:false}-plus-local-refresh approach as the rest
   *  of this popover (refreshPanel is just the outer renderRows —
   *  calling it rebuilds this panel along with everything else). */
  function renderModifiersPanel(field, choice, commitLocal, refreshPanel) {
    const bundle = ensureBundle(choice);
    const panel = document.createElement("div");
    panel.className = "dropdown-choices-editor__mods";

    const textFields = flattenGlobalFields().filter(f => f.fieldType === "text");
    // Single-option checkboxes only (see toggleField in blockModel.js)
    // — the proficiency-marker convention every skill/save uses. A
    // "grant" modifier always targets index 0, so a multi-option
    // checkbox (like Death Saves) wouldn't have one unambiguous box to
    // grant and is left out rather than guessing which one.
    const grantableFields = flattenGlobalFields().filter(f => f.fieldType === "checkbox" && f.options === 1);
    // Excludes this same field — a dropdown restricting its own
    // choices based on its own current selection doesn't make sense.
    const dropdownFields = flattenGlobalFields().filter(f => f.fieldType === "dropdown" && f.id !== field.id);

    // --- Apply from Library ---
    const libraryHeader = document.createElement("div");
    libraryHeader.className = "dropdown-choices-editor__mods-header";
    libraryHeader.textContent = "Apply from Library";
    panel.append(libraryHeader);

    const libraryRow = document.createElement("div");
    libraryRow.className = "bundle-mod-row";
    const librarySelect = document.createElement("select");
    const blankLibOpt = document.createElement("option");
    blankLibOpt.value = "";
    blankLibOpt.textContent = bundleLibraryCache.length ? "Choose a bundle…" : "No bundles saved yet";
    librarySelect.append(blankLibOpt);
    bundleLibraryCache.forEach((lib) => {
      const opt = document.createElement("option");
      opt.value = lib.id;
      opt.textContent = lib.category ? `${lib.name} (${lib.category})` : lib.name;
      librarySelect.append(opt);
    });
    const applyLibBtn = document.createElement("button");
    applyLibBtn.type = "button";
    applyLibBtn.className = "btn formula-toolbar__btn";
    applyLibBtn.textContent = "+ Apply";
    applyLibBtn.title = "Adds this bundle's rules on top of whatever's already here — it doesn't replace them";
    applyLibBtn.addEventListener("click", () => {
      const lib = bundleLibraryCache.find(l => l.id === librarySelect.value);
      if (!lib) return;
      commitLocal(() => {
        applyBundleLibraryToChoice(lib, choice, flattenGlobalFields());
      });
      refreshPanel();
    });
    libraryRow.append(librarySelect, applyLibBtn);
    panel.append(libraryRow);

    // --- Stat modifiers ---
    const statHeader = document.createElement("div");
    statHeader.className = "dropdown-choices-editor__mods-header";
    statHeader.textContent = "Stat Modifiers";
    panel.append(statHeader);

    bundle.statModifiers.forEach((mod, i) => {
      const row = document.createElement("div");
      row.className = "bundle-mod-row";

      const targetSelect = document.createElement("select");
      const blankOpt = document.createElement("option");
      blankOpt.value = "";
      blankOpt.textContent = mod.op === "grant" ? "Choose a proficiency…" : "Choose a stat…";
      targetSelect.append(blankOpt);
      const targetFieldPool = mod.op === "grant" ? grantableFields : textFields;
      targetFieldPool.forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f.id;
        opt.textContent = f.label || "Stat";
        if (f.id === mod.targetFieldId) opt.selected = true;
        targetSelect.append(opt);
      });
      targetSelect.addEventListener("change", () => {
        commitLocal(() => { mod.targetFieldId = targetSelect.value || null; });
      });

      const opSelect = document.createElement("select");
      MODIFIER_OPS.forEach(({ value, label }) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        if (value === mod.op) opt.selected = true;
        opSelect.append(opt);
      });
      opSelect.addEventListener("change", () => {
        // Switching op also switches which field POOL the target
        // select offers (stats vs. proficiencies) — the old
        // targetFieldId almost never makes sense in the new pool, so
        // clear it rather than leave a stale, invisible-to-the-UI
        // reference behind.
        commitLocal(() => {
          mod.op = opSelect.value;
          mod.targetFieldId = null;
          if (mod.op === "grant") mod.targetIndex = 0;
        });
        refreshPanel();
      });

      const minLevelInput = document.createElement("input");
      minLevelInput.type = "number";
      minLevelInput.title = "Min level (blank = always active)";
      minLevelInput.placeholder = "Lvl";
      minLevelInput.className = "bundle-mod-row__level";
      minLevelInput.value = Number.isFinite(mod.minLevel) ? mod.minLevel : "";
      minLevelInput.addEventListener("input", () => {
        const n = Number(minLevelInput.value);
        commitLocal(() => { mod.minLevel = minLevelInput.value === "" || !Number.isFinite(n) ? null : n; });
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn formula-toolbar__btn";
      removeBtn.textContent = "✕";
      removeBtn.setAttribute("aria-label", "Remove modifier");
      removeBtn.addEventListener("click", () => {
        commitLocal(() => { bundle.statModifiers.splice(i, 1); });
        refreshPanel();
      });

      row.append(targetSelect, opSelect);
      if (mod.op !== "grant") {
        const valueInput = document.createElement("input");
        valueInput.type = "number";
        valueInput.value = Number.isFinite(mod.value) ? mod.value : 0;
        valueInput.addEventListener("input", () => {
          commitLocal(() => { mod.value = Number(valueInput.value) || 0; });
        });
        row.append(valueInput);
      }
      row.append(minLevelInput, removeBtn);
      panel.append(row);
    });

    const addModBtn = document.createElement("button");
    addModBtn.type = "button";
    addModBtn.className = "btn formula-toolbar__btn";
    addModBtn.textContent = "+ Add Modifier";
    addModBtn.addEventListener("click", () => {
      commitLocal(() => {
        bundle.statModifiers.push({ id: newId(), targetFieldId: null, op: "add", value: 0, minLevel: null });
      });
      refreshPanel();
    });
    panel.append(addModBtn);

    // --- Dropdown access ---
    const accessHeader = document.createElement("div");
    accessHeader.className = "dropdown-choices-editor__mods-header";
    accessHeader.textContent = "Dropdown Access";
    panel.append(accessHeader);

    bundle.dropdownAccess.forEach((rule, i) => {
      const ruleWrap = document.createElement("div");
      ruleWrap.className = "bundle-access-rule";

      const targetRow = document.createElement("div");
      targetRow.className = "bundle-mod-row";
      const targetSelect = document.createElement("select");
      const blankOpt = document.createElement("option");
      blankOpt.value = "";
      blankOpt.textContent = "Choose a dropdown…";
      targetSelect.append(blankOpt);
      dropdownFields.forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f.id;
        opt.textContent = f.label || "Dropdown";
        if (f.id === rule.targetFieldId) opt.selected = true;
        targetSelect.append(opt);
      });
      targetSelect.addEventListener("change", () => {
        commitLocal(() => {
          rule.targetFieldId = targetSelect.value || null;
          rule.allowedChoiceIds = [];
        });
        refreshPanel();
      });
      const minLevelInput = document.createElement("input");
      minLevelInput.type = "number";
      minLevelInput.title = "Min level (blank = always active)";
      minLevelInput.placeholder = "Lvl";
      minLevelInput.className = "bundle-mod-row__level";
      minLevelInput.value = Number.isFinite(rule.minLevel) ? rule.minLevel : "";
      minLevelInput.addEventListener("input", () => {
        const n = Number(minLevelInput.value);
        commitLocal(() => { rule.minLevel = minLevelInput.value === "" || !Number.isFinite(n) ? null : n; });
      });
      const removeRuleBtn = document.createElement("button");
      removeRuleBtn.type = "button";
      removeRuleBtn.className = "btn formula-toolbar__btn";
      removeRuleBtn.textContent = "✕";
      removeRuleBtn.setAttribute("aria-label", "Remove rule");
      removeRuleBtn.addEventListener("click", () => {
        commitLocal(() => { bundle.dropdownAccess.splice(i, 1); });
        refreshPanel();
      });
      targetRow.append(targetSelect, minLevelInput, removeRuleBtn);
      ruleWrap.append(targetRow);

      const targetField = dropdownFields.find(f => f.id === rule.targetFieldId);
      if (targetField) {
        const checklist = document.createElement("div");
        checklist.className = "bundle-access-checklist";
        (targetField.choices || []).forEach((targetChoice) => {
          const label = document.createElement("label");
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = (rule.allowedChoiceIds || []).includes(targetChoice.id);
          checkbox.addEventListener("change", () => {
            commitLocal(() => {
              const set = new Set(rule.allowedChoiceIds || []);
              if (checkbox.checked) set.add(targetChoice.id);
              else set.delete(targetChoice.id);
              rule.allowedChoiceIds = [...set];
            });
          });
          label.append(checkbox, document.createTextNode(" " + targetChoice.text));
          checklist.append(label);
        });
        ruleWrap.append(checklist);
      }

      panel.append(ruleWrap);
    });

    const addAccessBtn = document.createElement("button");
    addAccessBtn.type = "button";
    addAccessBtn.className = "btn formula-toolbar__btn";
    addAccessBtn.textContent = "+ Add Dropdown Rule";
    addAccessBtn.addEventListener("click", () => {
      commitLocal(() => {
        bundle.dropdownAccess.push({ id: newId(), targetFieldId: null, allowedChoiceIds: [], minLevel: null });
      });
      refreshPanel();
    });
    panel.append(addAccessBtn);

    return panel;
  }

  function buildFieldToolbar(field, parentBlock, wrapperEl) {
    const bar = document.createElement("div");
    bar.className = "node-toolbar";

    // A picture/catalog has nothing text-stylable about it (a picture's
    // image IS its content; a catalog is just a button whose own label
    // covers styling via the normal field-label path), so skip the
    // style button entirely rather than showing a popover of controls
    // that don't apply.
    if (field.fieldType !== "picture" && field.fieldType !== "catalog") {
      bar.append(buildStyleButton(field, wrapperEl));
    }
    bar.append(buildBorderToggleButton(field, wrapperEl));

    if (!CAPTIONLESS_FIELD_TYPES.has(field.fieldType)) {
      const cycleLabelBtn = document.createElement("button");
      cycleLabelBtn.type = "button";
      cycleLabelBtn.title = "Move label";
      cycleLabelBtn.textContent = "↻";
      cycleLabelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        cycleLabelPosition(field, parentBlock, wrapperEl);
      });
      bar.append(cycleLabelBtn);
    }

    if (field.fieldType === "dropdown") {
      const editChoicesBtn = document.createElement("button");
      editChoicesBtn.type = "button";
      editChoicesBtn.title = "Edit choices";
      editChoicesBtn.textContent = "☰";
      editChoicesBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openDropdownChoicesEditor(field, wrapperEl);
      });
      bar.append(editChoicesBtn);
    }

    if (field.fieldType === "catalog") {
      const configBtn = document.createElement("button");
      configBtn.type = "button";
      configBtn.title = "Configure catalog";
      configBtn.textContent = "⚙";
      configBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openCatalogFieldConfig(field, wrapperEl);
      });
      bar.append(configBtn);
    }

    if (field.fieldType === "radio") {
      const slotFormulaBtn = document.createElement("button");
      slotFormulaBtn.type = "button";
      slotFormulaBtn.title = field.optionsFormula
        ? "Edit the formula for how many buttons this has"
        : "Set a formula for how many buttons this has (e.g. spell slots that scale with Level)";
      slotFormulaBtn.textContent = "=";
      slotFormulaBtn.className = field.optionsFormula ? "active" : "";
      slotFormulaBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openFormulaEditor(
          { id: field.id, label: field.label, formula: field.optionsFormula },
          resolveFieldById,
          (newFormula) => {
            commitMutation(() => { field.optionsFormula = newFormula; }, { render: false });
            renderPageGrid();
          },
          {
            title: `Slot-Count Formula for "${field.label || "Field"}"`,
            hint: "This computes how many radio buttons this group shows — not which one is selected. Good for something like spell slots that scale with Level. Drag stat fields in as variables, same as any other formula.",
          }
        );
      });
      bar.append(slotFormulaBtn);
    }

    if (field.fieldType === "radio" || field.fieldType === "checkbox") {
      const minusBtn = document.createElement("button");
      minusBtn.type = "button";
      minusBtn.title = "Remove option";
      minusBtn.textContent = "−";
      minusBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (field.options <= 1) return;
        commitMutation(() => {
          field.options -= 1;
          syncOptionWidth(field);
        });
      });
      const plusBtn = document.createElement("button");
      plusBtn.type = "button";
      plusBtn.title = "Add option";
      plusBtn.textContent = "+";
      plusBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        commitMutation(() => {
          field.options += 1;
          syncOptionWidth(field);
        });
      });
      bar.append(minusBtn, plusBtn);
    }

    wireHoverToolbar(wrapperEl, bar);
    return bar;
  }

  function buildEquationHint(field) {
    const opposite = { top: "bottom", bottom: "top", left: "right", right: "left" }[field.labelPosition];
    const hint = document.createElement("div");
    hint.className = `equation-hint equation-hint--${opposite}${field.formula ? " equation-hint--active" : ""}`;
    hint.textContent = "=";
    hint.title = field.formula ? "Edit formula" : "Set up a formula";
    hint.addEventListener("click", (e) => {
      e.stopPropagation();
      openFormulaEditor(field, resolveFieldById, (newFormula) => {
        commitMutation(() => {
          field.formula = newFormula;
        }, { render: false });
        renderPageGrid();
      });
    });
    return hint;
  }

  function cycleLabelPosition(field, parentBlock, fieldEl) {
    const labelEl = fieldEl.querySelector(".field-label");
    const first = labelEl ? labelEl.getBoundingClientRect() : null;

    commitMutation(() => {
      const idx = LABEL_POSITIONS.indexOf(field.labelPosition);
      field.labelPosition = LABEL_POSITIONS[(idx + 1) % LABEL_POSITIONS.length];
    }, { render: false });

    const newLabelEl = renderFieldInner(fieldEl, field, parentBlock);
    // Unlike the initial-build call in renderFieldNode, fieldEl here is
    // already attached to the live document (we're editing an existing
    // node in place), so newLabelEl already has real layout and this
    // can run immediately rather than needing to be queued.
    if (newLabelEl) growFieldIfLabelOverflows(newLabelEl, field, fieldEl, parentBlock);
    // Refresh the equation hint since it always sits opposite the label.
    const oldHint = fieldEl.querySelector(".equation-hint");
    if (oldHint) oldHint.remove();
    if (field.fieldType === "text") {
      fieldEl.append(buildEquationHint(field));
    }

    if (first) {
      const last = newLabelEl.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      newLabelEl.style.transition = "none";
      newLabelEl.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        newLabelEl.style.transition = "transform 200ms ease";
        newLabelEl.style.transform = "";
      });
    }
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
        const dx = Math.round((ev.clientX - startClientX) / (cw + GAP_PX));
        const dy = Math.round((ev.clientY - startClientY) / (cw + GAP_PX));
        node.x = Math.min(Math.max(0, maxX), Math.max(0, startX + dx));
        node.y = Math.min(Math.max(0, maxY), Math.max(0, startY + dy));
        applyRect(el, node, cw);
      }
      function onUp() {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        el.classList.remove("is-dragging");
        undoStack.push(before);
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
        const dw = Math.round((ev.clientX - startClientX) / (cw + GAP_PX));
        const dh = Math.round((ev.clientY - startClientY) / (cw + GAP_PX));
        node.w = Math.min(maxW, Math.max(minW, startW + dw));
        node.h = Math.min(maxH, Math.max(minH, startH + dh));
        applyRect(el, node, cw);

        if (scaleFields.length > 0) {
          const ratioW = node.w / startW;
          const ratioH = node.h / startH;
          scaleFields.forEach(({ field, startX, startY, startW: fw, startH: fh }) => {
            field.x = Math.max(0, Math.round(startX * ratioW));
            field.y = Math.max(0, Math.round(startY * ratioH));
            field.w = Math.max(1, Math.round(fw * ratioW));
            field.h = Math.max(1, Math.round(fh * ratioH));
            const fieldEl = el.querySelector(`[data-node-id="${field.id}"]`);
            if (fieldEl) applyRect(fieldEl, field, cw);
          });
        }
      }
      function onUp() {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        el.classList.remove("is-resizing");
        undoStack.push(before);
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
    const h = document.createElement("div");
    h.className = "node-handle drag-handle";
    h.textContent = "⠿";
    // Mouse/touch-drag only — there's no keyboard equivalent for
    // repositioning a block, so hiding this from assistive tech is
    // more honest than labeling it as if it were operable.
    h.setAttribute("aria-hidden", "true");
    return h;
  }
  function buildResizeHandle() {
    const h = document.createElement("div");
    h.className = "node-handle resize-handle";
    h.setAttribute("aria-hidden", "true"); // see buildDragHandle
    return h;
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
    document.querySelectorAll(".style-popover, .field-type-menu").forEach(p => p.remove());
    if (toolbarWithOpenPopup) {
      const tb = toolbarWithOpenPopup;
      toolbarWithOpenPopup = null;
      if (tb._scheduleHide) tb._scheduleHide(); // re-checks real hover state now that nothing's forcing it open
    }
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
    let hideTimer = null;
    function show() {
      if (!editMode) return;
      clearTimeout(hideTimer);
      if (activeHoverToolbar && activeHoverToolbar !== toolbarEl && toolbarWithOpenPopup !== activeHoverToolbar) {
        activeHoverToolbar.classList.remove("is-visible");
      }
      activeHoverToolbar = toolbarEl;
      // If there's no real room above (the node is right up against
      // the top of the visible scroll area), flip the toolbar to sit
      // just below the node instead — otherwise it renders off the
      // top of the viewport and is never actually visible.
      const rect = triggerEl.getBoundingClientRect();
      const scrollRect = scrollWrapper.getBoundingClientRect();
      toolbarEl.classList.toggle("toolbar-flip-below", rect.top - scrollRect.top < 40);
      toolbarEl.classList.add("is-visible");
    }
    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (toolbarWithOpenPopup !== toolbarEl) {
          toolbarEl.classList.remove("is-visible");
          if (activeHoverToolbar === toolbarEl) activeHoverToolbar = null;
        }
      }, 250);
    }
    triggerEl.addEventListener("mouseenter", show);
    triggerEl.addEventListener("mouseleave", scheduleHide);
    toolbarEl.addEventListener("mouseenter", show);
    toolbarEl.addEventListener("mouseleave", scheduleHide);
    toolbarEl._scheduleHide = scheduleHide;
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
    const TOOLBAR_H = 28;
    const GAP = 8; // more clearance than a single node's own toolbar offset,
      // so the grid line between the toolbar and the selection stays visible
    const fitsAbove = topEdgePx - TOOLBAR_H - GAP >= 0;
    el.style.top = fitsAbove ? `${topEdgePx - TOOLBAR_H - GAP}px` : `${bottomEdgePx + GAP}px`;
    el.style.right = "auto";
    el.style.left = `${rightEdgePx - 90}px`;
  }

  /** Flips a just-appended popover to open leftward instead of
   *  rightward if it would otherwise overflow off the right edge of
   *  the viewport — the default CSS always opens to the right, which
   *  looks fine until the node it's attached to is in the right half
   *  of a wide sheet. */
  function positionPopoverWithinViewport(pop) {
    const rect = pop.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      pop.style.left = "auto";
      pop.style.right = "calc(100% + var(--space-2))";
    }
  }

  function buildStyleButton(node, wrapperEl) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Style";
    btn.textContent = "🎨";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const already = wrapperEl.querySelector(".style-popover");
      closeOpenPopovers();
      if (already) return; // toggle: clicking again just closes it
      const pop = buildStylePopover(node, wrapperEl);
      wrapperEl.append(pop);
      positionPopoverWithinViewport(pop);
      toolbarWithOpenPopup = btn.closest(".node-toolbar");
    });
    return btn;
  }

  function buildStylePopover(node, wrapperEl) {
    const pop = document.createElement("div");
    pop.className = "style-popover";
    pop.addEventListener("pointerdown", (e) => e.stopPropagation());
    const editableStyle = styleForEditing(node);

    function buildStyleLabel(text, styleKey) {
      const label = document.createElement("label");
      label.textContent = text;
      if (node.styleOverrides && Object.prototype.hasOwnProperty.call(node.styleOverrides, styleKey)) {
        const badge = document.createElement("span");
        badge.className = "style-popover__badge";
        badge.textContent = "local";
        label.append(document.createTextNode(" "), badge);
      }
      return label;
    }

    // Background color (whole node only — background doesn't cascade
    // to children the way font/color properties do, which is exactly
    // what keeps a field's own background from blotting out its
    // parent block's background).
    const bgRow = document.createElement("div");
    bgRow.className = "style-popover__row";
    const bgLabel = buildStyleLabel("Background", "bg");
    const bgInput = document.createElement("input");
    bgInput.type = "color";
    bgInput.value = editableStyle.bg || "#1d1a16";
    bgInput.addEventListener("input", () => {
      commitMutation(() => {
        setNodeStyleValue(node, "bg", bgInput.value);
      }, { render: false });
      applyNodeStyle(wrapperEl, styleForEditing(node));
    });
    bgRow.append(bgLabel, bgInput);
    pop.append(bgRow);

    // Background image
    const imgRow = document.createElement("div");
    imgRow.className = "style-popover__row";
    const imgLabel = buildStyleLabel("Bg image", "bgImage");
    const imgInput = document.createElement("input");
    imgInput.type = "file";
    imgInput.accept = "image/*";
    imgInput.addEventListener("change", () => {
      const file = imgInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result.length > MAX_BG_IMAGE_BYTES) {
          showToast("That image is large enough that it (plus the rest of this character) may not fit in a single Firestore document (1MB limit). It'll be applied, but saving might fail — try a smaller image if so.");
        }
        commitMutation(() => {
          setNodeStyleValue(node, "bgImage", reader.result);
        }, { render: false });
        applyNodeStyle(wrapperEl, styleForEditing(node));
      };
      reader.readAsDataURL(file);
    });
    imgRow.append(imgLabel, imgInput);
    pop.append(imgRow);

    // Font family
    const fontRow = document.createElement("div");
    fontRow.className = "style-popover__row";
    const fontLabel = buildStyleLabel("Font", "fontFamily");
    const fontSelect = document.createElement("select");
    [
      ["", "Theme default"],
      ["var(--font-body)", "Body"],
      ["var(--font-display)", "Display"],
      ["Georgia, serif", "Georgia"],
      ["'Courier New', monospace", "Monospace"],
      ["'Times New Roman', serif", "Times"],
    ].forEach(([val, label]) => {
      const opt = document.createElement("option");
      opt.value = val; opt.textContent = label;
      if ((editableStyle.fontFamily || "") === val) opt.selected = true;
      fontSelect.append(opt);
    });
    fontSelect.addEventListener("change", () => {
      applyStyleChange(wrapperEl, node, { cssProp: "fontFamily", cssValue: fontSelect.value, styleKey: "fontFamily", rawValue: fontSelect.value || null });
    });
    fontRow.append(fontLabel, fontSelect);
    pop.append(fontRow);

    // Font size
    const sizeRow = document.createElement("div");
    sizeRow.className = "style-popover__row";
    const sizeLabel = buildStyleLabel("Size (px)", "fontSize");
    const sizeInput = document.createElement("input");
    sizeInput.type = "number";
    sizeInput.min = "8"; sizeInput.max = "72";
    sizeInput.value = editableStyle.fontSize || "";
    sizeInput.addEventListener("change", () => {
      const px = Number(sizeInput.value) || null;
      applyStyleChange(wrapperEl, node, { cssProp: "fontSize", cssValue: px ? `${px}px` : "", styleKey: "fontSize", rawValue: px });
    });
    sizeRow.append(sizeLabel, sizeInput);
    pop.append(sizeRow);

    // Text color
    const colorRow = document.createElement("div");
    colorRow.className = "style-popover__row";
    const colorLabel = buildStyleLabel("Text color", "color");
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = editableStyle.color || "#e8e0d0";
    colorInput.addEventListener("input", () => {
      applyStyleChange(wrapperEl, node, { cssProp: "color", cssValue: colorInput.value, styleKey: "color", rawValue: colorInput.value });
    });
    colorRow.append(colorLabel, colorInput);
    pop.append(colorRow);

    // Bold / Italic / Underline
    const togglesRow = document.createElement("div");
    togglesRow.className = "style-popover__row";
    const togglesLabel = document.createElement("label");
    togglesLabel.textContent = "Style";
    togglesRow.append(togglesLabel);
    const toggles = document.createElement("div");
    toggles.className = "style-popover__toggles";
    [
      { key: "bold", label: "B", cssProp: "fontWeight", cssValue: "bold" },
      { key: "italic", label: "I", cssProp: "fontStyle", cssValue: "italic" },
      { key: "underline", label: "U", cssProp: "textDecoration", cssValue: "underline" },
    ].forEach(({ key, label, cssProp, cssValue }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.title = node.styleOverrides && Object.prototype.hasOwnProperty.call(node.styleOverrides, key)
        ? `${label} is locally overridden`
        : label;
      btn.className = editableStyle[key] ? "active" : "";
      if (node.styleOverrides && Object.prototype.hasOwnProperty.call(node.styleOverrides, key)) {
        btn.classList.add("has-local-override");
      }
      btn.addEventListener("click", () => {
        const changedWholeNode = applyStyleChange(wrapperEl, node, { cssProp, cssValue, styleKey: key, toggle: true });
        // Only reflect the change on the button if it actually changed
        // the WHOLE node's setting — if a text selection was styled
        // instead, this button's on/off state doesn't represent that
        // (there's no single "is this selection bold" answer to show),
        // so leave it as-is rather than showing something misleading.
        if (changedWholeNode) {
          btn.classList.toggle("active", !!styleForEditing(node)[key]);
        }
      });
      toggles.append(btn);
    });
    togglesRow.append(toggles);
    pop.append(togglesRow);

    return pop;
  }

  /** Applies a style change either to the current text SELECTION (if
   *  one exists inside this node's editable value area) or to the
   *  whole node — see the file-level comment for the selection-vs-
   *  whole-node scope note. Returns true if the WHOLE node's style
   *  was the thing that changed (false if a selection was styled
   *  instead), so callers like the B/I/U toggle buttons know whether
   *  their own on/off display should update. */
  function applyStyleChange(wrapperEl, node, { cssProp, cssValue, styleKey, toggle = false, rawValue }) {
    const sel = window.getSelection();
    // Only a FIELD has its own editable value — for a block, this must
    // be a direct-child lookup, or it would find a nested field's value
    // (same descendant-search issue as wireDrag/wireResize above) and
    // wrongly treat a block-level style change as selection-scoped.
    const valueEl = wrapperEl.querySelector(":scope > .field-inner > .field-value[contenteditable]");
    const hasSelection = sel && !sel.isCollapsed && valueEl && sel.anchorNode && valueEl.contains(sel.anchorNode);

    if (hasSelection) {
      wrapSelectionWithStyle(cssProp, cssValue);
      if (valueEl) {
        node.value = valueEl.innerHTML; // keep the field's persisted value in sync
      }
    } else if (toggle) {
      const nextValue = !styleForEditing(node)[styleKey];
      commitMutation(() => {
        setNodeStyleValue(node, styleKey, nextValue);
      }, { render: false });
      applyNodeStyle(wrapperEl, styleForEditing(node));
      applyDescendantTextStyle(wrapperEl, cssProp, nextValue ? cssValue : "");
    } else {
      const nextValue = rawValue !== undefined ? rawValue : cssValue;
      commitMutation(() => {
        setNodeStyleValue(node, styleKey, nextValue);
      }, { render: false });
      applyNodeStyle(wrapperEl, styleForEditing(node));
      applyDescendantTextStyle(wrapperEl, cssProp, cssValue);
    }
    if (hasSelection) persist();
    return !hasSelection;
  }

  function wrapSelectionWithStyle(cssProp, cssValue) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement("span");
    if (cssValue) span.style[cssProp] = cssValue;
    try {
      range.surroundContents(span);
    } catch {
      // Selection spans multiple partial nodes surroundContents can't
      // wrap directly (a known Range API limitation) — fall back to
      // extract-and-reinsert instead.
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }
    sel.removeAllRanges();
  }

  function applyDescendantTextStyle(wrapperEl, cssProp, cssValue) {
    wrapperEl
      .querySelectorAll(".block-name, .field-label, .field-value, .label-block-text")
      .forEach(el => {
        el.style[cssProp] = cssValue || "";
      });
  }

  function applyTextStyleToOwnText(wrapperEl, style) {
    const rules = [
      ["fontFamily", style.fontFamily || ""],
      ["fontSize", style.fontSize ? `${style.fontSize}px` : ""],
      ["fontWeight", style.bold ? "bold" : ""],
      ["fontStyle", style.italic ? "italic" : ""],
      ["textDecoration", style.underline ? "underline" : ""],
      ["color", style.color || ""],
    ];
    wrapperEl
      .querySelectorAll(".block-name, .field-label, .field-value, .label-block-text")
      .forEach(el => {
        if (el.closest(".style-popover")) return;
        rules.forEach(([prop, value]) => { el.style[prop] = value; });
      });
  }

  function openFieldTypeMenu(anchorBtn, onChoose) {
    closeOpenPopovers();
    const menu = document.createElement("div");
    menu.className = "style-popover field-type-menu";
    menu.addEventListener("pointerdown", (e) => e.stopPropagation());

    // Grouped rather than one flat alphabetical list — nine field
    // types is enough that a little structure helps you scan for the
    // one you want. Still alphabetical WITHIN each group.
    const GROUPS = [
      { name: "Text", types: ["text", "label", "textarea", "textlist"] },
      { name: "Choice", types: ["dropdown", "radio", "checkbox"] },
      { name: "Media", types: ["picture"] },
      { name: "Interactive", types: ["catalog", "featureList"] },
    ];
    const OPTION_DEFS = {
      text: { label: "Num Field", preview: buildTextPreview },
      label: { label: "Label", preview: buildLabelPreview },
      textarea: { label: "Text Area", preview: buildTextareaPreview },
      textlist: { label: "Text List", preview: buildTextlistPreview },
      dropdown: { label: "Dropdown", preview: buildDropdownPreview },
      radio: { label: "Radio Buttons", preview: () => buildOptionPreview("radio", 3) },
      checkbox: { label: "Checkbox", preview: () => buildOptionPreview("checkbox", 1) },
      picture: { label: "Image", preview: buildPicturePreview },
      catalog: { label: "Catalog", preview: buildCatalogPreview },
      featureList: { label: "Feature List", preview: buildFeatureListPreview },
    };

    GROUPS.forEach((group) => {
      const groupLabel = document.createElement("div");
      groupLabel.className = "field-type-menu__group";
      groupLabel.textContent = group.name;
      menu.append(groupLabel);

      group.types
        .map((type) => ({ type, ...OPTION_DEFS[type] }))
        .sort((a, b) => a.label.localeCompare(b.label))
        .forEach(({ type, label, preview }) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn field-type-option";
          const labelSpan = document.createElement("span");
          labelSpan.className = "field-type-option__label";
          labelSpan.textContent = label;
          const previewSpan = document.createElement("span");
          previewSpan.className = "field-type-option__preview";
          previewSpan.append(preview());
          btn.append(labelSpan, previewSpan);
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            onChoose(type);
            closeOpenPopovers();
          });
          menu.append(btn);
        });
    });

    // Appended to the block/field itself, NOT to the toolbar — the
    // toolbar's own visibility is hover-gated (see wireHoverToolbar),
    // and this menu needs to persist independent of that, the same
    // way style-popover already does.
    const gridNode = anchorBtn.closest(".grid-node");
    (gridNode || anchorBtn.parentElement).append(menu);
    positionPopoverWithinViewport(menu);
    toolbarWithOpenPopup = anchorBtn.closest(".node-toolbar");
  }

  /** A small, non-interactive preview of an empty text field — used in
   *  the field-type picker so each option shows what it'll look like. */
  function buildTextPreview() {
    const el = document.createElement("span");
    el.className = "field-type-preview-text";
    return el;
  }

  function buildLabelPreview() {
    const el = document.createElement("span");
    el.className = "field-type-preview-label";
    el.textContent = "Aa";
    return el;
  }

  function buildTextareaPreview() {
    const el = document.createElement("span");
    el.className = "field-type-preview-textarea";
    return el;
  }

  function buildTextlistPreview() {
    const el = document.createElement("span");
    el.className = "field-type-preview-textlist";
    for (let i = 0; i < 3; i++) {
      const line = document.createElement("span");
      line.className = "field-type-preview-textlist__line";
      el.append(line);
    }
    return el;
  }

  function buildDropdownPreview() {
    const el = document.createElement("span");
    el.className = "field-type-preview-dropdown";
    el.textContent = "▾";
    return el;
  }

  function buildPicturePreview() {
    const el = document.createElement("span");
    el.className = "field-type-preview-picture";
    el.innerHTML = personIconSvgMarkup();
    return el;
  }

  function buildCatalogPreview() {
    const el = document.createElement("span");
    el.className = "field-type-preview-catalog";
    el.textContent = "☰";
    return el;
  }

  function buildFeatureListPreview() {
    const el = document.createElement("span");
    el.className = "field-type-preview-catalog"; // same glyph treatment, no dedicated CSS needed
    el.textContent = "★";
    return el;
  }

  /** A small, non-interactive preview of `count` empty radio buttons
   *  or checkboxes in a row — same purpose as buildTextPreview above. */
  function buildOptionPreview(kind, count) {
    const wrap = document.createElement("span");
    wrap.className = "field-type-preview-options";
    for (let i = 0; i < count; i++) {
      const dot = document.createElement("span");
      dot.className = `field-type-preview-${kind}`;
      wrap.append(dot);
    }
    return wrap;
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
  function destroy() {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("beforeunload", onBeforeUnload);
  }

  return { hasUnsavedChanges, destroy };
}
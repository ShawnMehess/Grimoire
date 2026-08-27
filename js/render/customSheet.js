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

const PAGE_COLS = 16;
const GAP_PX = 8;
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
  radio: { w: 1, h: 1 },
  checkbox: { w: 1, h: 1 },
};
// Radio/checkbox auto-size via syncOptionWidth (their w/h are derived
// from option count, not user-resizable); every other field type can
// be freely resized.
const RESIZABLE_FIELD_TYPES = new Set(["text", "label", "textarea", "textlist", "dropdown", "picture"]);
// Field types with no separate label/value split — just one element
// filling the whole field (see renderFieldInner).
const CAPTIONLESS_FIELD_TYPES = new Set(["label", "picture"]);
const MAX_IMAGE_BYTES = 250_000; // same Firestore-doc-size reasoning as MAX_BG_IMAGE_BYTES below

function debounce(fn, delayMs = 500) {
  let handle;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), delayMs);
  };
}

export function renderCustomSheet(root, character, store) {
  if (!character.layout) {
    character.layout = createStarterLayout();
  }
  normalizeTabs();

  let editMode = false;
  let activeTabId = character.sheetTabs[0].id;
  const undoStack = [];
  const redoStack = [];
  // Recomputed at the start of every renderPageGrid() — id (or
  // id::checkboxIndex) -> current numeric value. Read by buildFieldValue
  // to display a formula field's computed result.
  let formulaValues = {};
  // Cached list of reusable bundle-library entries (see
  // bundleLibraryEditor.js) — refreshed on load and whenever the
  // manager reports a save/delete, so the "Apply from Library" picker
  // in a choice's Modifiers panel doesn't re-fetch on every render.
  let bundleLibraryCache = [];
  async function refreshBundleLibraryCache() {
    if (!store.listBundleLibraries) return;
    bundleLibraryCache = await store.listBundleLibraries();
  }
  refreshBundleLibraryCache();

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

  const bundleLibBtn = document.createElement("button");
  bundleLibBtn.type = "button";
  bundleLibBtn.className = "btn";
  bundleLibBtn.textContent = "Bundle Libraries";
  bundleLibBtn.title = "Manage reusable Race/Class/etc. bundles";
  bundleLibBtn.addEventListener("click", () => {
    openBundleLibraryManager(store, refreshBundleLibraryCache);
  });
  toolbar.append(bundleLibBtn);

  // A plain, non-customizable name field — deliberately outside the
  // draggable/relabelable grid. The character LIST view needs a
  // reliable "this is the name" field, and once everything on the
  // sheet itself can be freely relabeled and rearranged, there's no
  // way to reconstruct that from the layout alone. Race/Class/Level
  // are here for the same reason — the character-selection page shows
  // them on each card, and needs somewhere guaranteed to find them
  // regardless of how someone's built their custom layout.
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "input-group__control";
  nameInput.style.maxWidth = "220px";
  nameInput.placeholder = "Character name";
  nameInput.value = character.name || "";
  nameInput.addEventListener("input", debounce(() => {
    character.name = nameInput.value;
    saveWithStatus("name", nameInput.value);
  }, 400));
  toolbar.append(nameInput);

  function buildIdentityInput(field, placeholder, { type = "text", maxWidth = "110px" } = {}) {
    const input = document.createElement("input");
    input.type = type;
    input.className = "input-group__control";
    input.style.maxWidth = maxWidth;
    input.placeholder = placeholder;
    input.value = character[field] ?? "";
    input.addEventListener("input", debounce(() => {
      const value = type === "number" ? (input.value === "" ? "" : Number(input.value)) : input.value;
      character[field] = value;
      saveWithStatus(field, value);
    }, 400));
    return input;
  }
  toolbar.append(
    buildIdentityInput("race", "Race"),
    buildIdentityInput("class", "Class"),
    buildIdentityInput("level", "Level", { type: "number", maxWidth: "70px" }),
  );

  // Visible save-state feedback — saves happen silently in the
  // background otherwise, which means a failed save (e.g. a
  // background image pushing the character over Firestore's 1MB
  // document limit) would previously go completely unnoticed.
  const statusEl = document.createElement("span");
  statusEl.className = "save-status";
  toolbar.append(statusEl);

  function saveWithStatus(fieldId, value) {
    statusEl.textContent = "Saving…";
    statusEl.style.color = "";
    store.saveCharacterField(character.id, fieldId, value)
      .then(() => { statusEl.textContent = "Saved"; })
      .catch((err) => {
        console.error(`Failed to save "${fieldId}":`, err);
        statusEl.textContent = "⚠ Save failed — see console";
        statusEl.style.color = "var(--color-negative)";
      });
  }

  const persist = debounce(persistSheetState);

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
  blockFrame.className = "sheet-block-frame";
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

  function normalizeTabs() {
    if (!Array.isArray(character.sheetTabs) || character.sheetTabs.length === 0) {
      character.sheetTabs = [{
        id: newId(),
        name: "Main",
        layout: Array.isArray(character.layout) ? character.layout : [],
      }];
    }
    character.sheetTabs.forEach((tab, index) => {
      if (!tab.id) tab.id = newId();
      if (!tab.name) tab.name = index === 0 ? "Main" : `Tab ${index + 1}`;
      if (!Array.isArray(tab.layout)) tab.layout = [];
    });
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

  function commitMutation(fn, { render = true, save = true } = {}) {
    undoStack.push(snapshot());
    redoStack.length = 0;
    fn();
    normalizeTabs();
    updateHistoryButtons();
    if (save) persist();
    if (render) renderAll();
  }

  function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(snapshot());
    restoreSnapshot(undoStack.pop());
    updateHistoryButtons();
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(snapshot());
    restoreSnapshot(redoStack.pop());
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }

  function onShortcut(e) {
    // Guards both cases below: while actually typing/editing text, Delete
    // and Backspace must only ever edit that text, never delete the
    // whole block/field it lives in.
    if (e.target.closest("input, textarea, select, [contenteditable='true']")) return;

    if (editMode && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "Delete" || e.key === "Backspace")) {
      const nodeEl = e.target.closest(".grid-node");
      if (nodeEl && nodeEl.dataset.nodeId) {
        e.preventDefault();
        deleteSelectedNode(nodeEl);
        return;
      }
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
        .then(() => { statusEl.textContent = "Saved"; })
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
  function getAllowedChoiceIds(field, allFields) {
    let allowed = new Set((field.choices || []).map(c => c.id));
    allFields.forEach((other) => {
      if (other.fieldType !== "dropdown" || other === field) return;
      const choice = (other.choices || []).find(c => c.id === other.selected);
      const bundle = choice && choice.bundle;
      if (!bundle) return;
      (bundle.dropdownAccess || []).forEach((rule) => {
        if (rule.targetFieldId !== field.id) return;
        const ruleSet = new Set(rule.allowedChoiceIds || []);
        allowed = new Set([...allowed].filter(id => ruleSet.has(id)));
      });
    });
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
   *  field that's itself computed. */
  function applyBundleModifiers(fields, valueMap) {
    fields.forEach((field) => {
      if (field.fieldType !== "dropdown") return;
      const choice = (field.choices || []).find(c => c.id === field.selected);
      const bundle = choice && choice.bundle;
      if (!bundle) return;
      (bundle.statModifiers || []).forEach((mod) => {
        if (!mod.targetFieldId) return;
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
    });
  }

  function computeSheetValues(fields) {
    const valueMap = computeAllFormulas(fields);
    applyBundleModifiers(fields, valueMap);
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

  function applyRect(el, node, cw) {
    const inset = editMode ? NODE_INSET_PX : 0;
    el.style.left = `${node.x * (cw + GAP_PX) + inset}px`;
    el.style.top = `${node.y * (cw + GAP_PX) + inset}px`;
    el.style.width = `${node.w * cw + (node.w - 1) * GAP_PX - inset * 2}px`;
    el.style.height = `${node.h * cw + (node.h - 1) * GAP_PX - inset * 2}px`;
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
  }

  function renderPageGrid() {
    pageGrid.innerHTML = "";
    pageGrid.classList.toggle("is-edit-mode", editMode);
    const allFields = flattenGlobalFields();
    let needsNormalizedPersist = false;
    if (normalizeChoiceObjects(allFields)) needsNormalizedPersist = true;
    if (normalizeDropdownSelections(allFields)) needsNormalizedPersist = true;
    if (needsNormalizedPersist) persist();
    formulaValues = computeSheetValues(allFields);
    const cw = colWidthPx();
    const availableHeight = availableViewportHeight();
    scrollWrapper.style.height = `${availableHeight}px`;
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

    // Now that every block is actually laid out, re-anchor each one's
    // local body grid to the page grid's phase (see applyGridLines).
    if (editMode) {
      pageGrid.querySelectorAll(".block-body").forEach(bodyEl => {
        applyGridLines(bodyEl, cw, pageGrid);
      });
    }
  }

  function renderAll() {
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
      tabBtn.draggable = editMode;
      tabBtn.dataset.tabId = tab.id;

      const nameEl = document.createElement("span");
      nameEl.className = "sheet-tab__name";
      nameEl.contentEditable = editMode ? "true" : "false";
      nameEl.textContent = tab.name;
      nameEl.addEventListener("pointerdown", (e) => e.stopPropagation());
      nameEl.addEventListener("input", () => {
        commitMutation(() => {
          tab.name = nameEl.textContent.trim() || (index === 0 ? "Main" : `Tab ${index + 1}`);
        }, { render: false });
        renderBlockFrame();
      });

      tabBtn.addEventListener("click", () => {
        activeTabId = tab.id;
        renderAll();
      });
      tabBtn.addEventListener("dragstart", (e) => {
        if (!editMode) return;
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
          const from = character.sheetTabs.findIndex(t => t.id === draggedId);
          const to = character.sheetTabs.findIndex(t => t.id === tab.id);
          if (from <= 0 || to < 0) return;
          const [moved] = character.sheetTabs.splice(from, 1);
          character.sheetTabs.splice(Math.max(1, to), 0, moved);
        });
      });

      tabBtn.append(nameEl);
      if (editMode && index > 0) {
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
      const name = document.createElement("span");
      name.textContent = source.name || "Unnamed Block";
      blockLine.append(name);
      if (character.sheetTabs.length > 1) {
        const tabs = document.createElement("span");
        tabs.className = "sheet-block-list__tabs";
        tabs.textContent = blockTabs(block.id).join(", ");
        blockLine.append(tabs);
      }
      blockItem.append(blockLine);

      (source.children || []).forEach(field => {
        const fieldItem = document.createElement("div");
        fieldItem.className = "sheet-block-list__field";
        fieldItem.textContent = field.label || "Unnamed Field";
        fieldItem.draggable = true;
        fieldItem.addEventListener("dragstart", (e) => {
          e.stopPropagation();
          e.dataTransfer.setData("application/x-sheet-field", JSON.stringify({ blockId: block.id, fieldId: field.id }));
          e.dataTransfer.effectAllowed = "copy";
        });
        blockItem.append(fieldItem);

        // Each checkbox in a checkbox field is its own boolean
        // variable for formulas — exposed as its own draggable row,
        // rather than the field as a whole.
        if (field.fieldType === "checkbox") {
          (field.checked || []).forEach((_, i) => {
            const cbItem = document.createElement("div");
            cbItem.className = "sheet-block-list__field sheet-block-list__field--sub";
            cbItem.textContent = `↳ ${field.label || "Unnamed Field"} ${i + 1}`;
            cbItem.draggable = true;
            cbItem.addEventListener("dragstart", (e) => {
              e.stopPropagation();
              e.dataTransfer.setData("application/x-sheet-field", JSON.stringify({ blockId: block.id, fieldId: field.id, checkboxIndex: i }));
              e.dataTransfer.effectAllowed = "copy";
            });
            blockItem.append(cbItem);
          });
        }
      });

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
    nameEl.addEventListener("input", () => {
      commitMutation(() => {
        sourceBlockFor(block).name = nameEl.textContent;
      }, { render: false });
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

    renderFieldInner(el, field);
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
  function renderFieldInner(fieldEl, field) {
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
    labelEl.addEventListener("input", () => {
      commitMutation(() => {
        field.label = labelEl.textContent;
      }, { render: false });
      renderBlockFrame();
      updateFieldLabelVisibility(field, labelEl);
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
    labelEl.style.display = (isUnrenamedDefault && hasValue) ? "none" : "";
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

    const el = document.createElement("div");
    el.className = "field-value field-value--options";
    el.style.gridTemplateColumns = `repeat(${Math.max(1, field.options || 1)}, minmax(0, 1fr))`;

    if (field.fieldType === "radio") {
      for (let n = 1; n <= field.options; n++) {
        const wrap = document.createElement("label");
        wrap.className = "option-radio";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = field.id;
        input.checked = field.selected === n;
        input.addEventListener("change", () => {
          commitMutation(() => {
            field.selected = n;
          }, { render: false });
        });
        input.addEventListener("pointerdown", (e) => e.stopPropagation());
        wrap.append(input, document.createTextNode(String(n)));
        el.append(wrap);
      }
    } else if (field.fieldType === "checkbox") {
      for (let i = 0; i < field.options; i++) {
        const wrap = document.createElement("label");
        wrap.className = "option-checkbox";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !!field.checked[i];
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
        window.alert(
          "That image is large enough that it (plus the rest of this character) may not fit in a single Firestore document (1MB limit). It'll be applied, but saving might fail — try a smaller image if so."
        );
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
    if (!choice.bundle) choice.bundle = { statModifiers: [], dropdownAccess: [] };
    if (!choice.bundle.statModifiers) choice.bundle.statModifiers = [];
    if (!choice.bundle.dropdownAccess) choice.bundle.dropdownAccess = [];
    return choice.bundle;
  }

  function bundleIsEmpty(bundle) {
    return !bundle || ((bundle.statModifiers || []).length === 0 && (bundle.dropdownAccess || []).length === 0);
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

    (libraryEntry.statModifiers || []).forEach((mod) => {
      const match = allFields.find(f => f.fieldType === "text" && norm(f.label) === norm(mod.targetFieldName));
      bundle.statModifiers.push({
        id: newId(),
        targetFieldId: match ? match.id : null,
        op: mod.op,
        value: mod.value,
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
      });
    });
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
      blankOpt.textContent = "Choose a stat…";
      targetSelect.append(blankOpt);
      textFields.forEach((f) => {
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
        commitLocal(() => { mod.op = opSelect.value; });
      });

      const valueInput = document.createElement("input");
      valueInput.type = "number";
      valueInput.value = Number.isFinite(mod.value) ? mod.value : 0;
      valueInput.addEventListener("input", () => {
        commitLocal(() => { mod.value = Number(valueInput.value) || 0; });
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn formula-toolbar__btn";
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => {
        commitLocal(() => { bundle.statModifiers.splice(i, 1); });
        refreshPanel();
      });

      row.append(targetSelect, opSelect, valueInput, removeBtn);
      panel.append(row);
    });

    const addModBtn = document.createElement("button");
    addModBtn.type = "button";
    addModBtn.className = "btn formula-toolbar__btn";
    addModBtn.textContent = "+ Add Modifier";
    addModBtn.addEventListener("click", () => {
      commitLocal(() => {
        bundle.statModifiers.push({ id: newId(), targetFieldId: null, op: "add", value: 0 });
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
      const removeRuleBtn = document.createElement("button");
      removeRuleBtn.type = "button";
      removeRuleBtn.className = "btn formula-toolbar__btn";
      removeRuleBtn.textContent = "✕";
      removeRuleBtn.addEventListener("click", () => {
        commitLocal(() => { bundle.dropdownAccess.splice(i, 1); });
        refreshPanel();
      });
      targetRow.append(targetSelect, removeRuleBtn);
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
        bundle.dropdownAccess.push({ id: newId(), targetFieldId: null, allowedChoiceIds: [] });
      });
      refreshPanel();
    });
    panel.append(addAccessBtn);

    return panel;
  }

  function buildFieldToolbar(field, parentBlock, wrapperEl) {
    const bar = document.createElement("div");
    bar.className = "node-toolbar";

    // A picture has nothing text-stylable about it (no font/color/bg
    // to set — its own image IS its content), so skip the style
    // button entirely rather than showing a popover of controls that
    // don't apply to it.
    if (field.fieldType !== "picture") {
      bar.append(buildStyleButton(field, wrapperEl));
    }

    if (!CAPTIONLESS_FIELD_TYPES.has(field.fieldType)) {
      const cycleLabelBtn = document.createElement("button");
      cycleLabelBtn.type = "button";
      cycleLabelBtn.title = "Move label";
      cycleLabelBtn.textContent = "↻";
      cycleLabelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        cycleLabelPosition(field, wrapperEl);
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

  function cycleLabelPosition(field, fieldEl) {
    const labelEl = fieldEl.querySelector(".field-label");
    const first = labelEl ? labelEl.getBoundingClientRect() : null;

    commitMutation(() => {
      const idx = LABEL_POSITIONS.indexOf(field.labelPosition);
      field.labelPosition = LABEL_POSITIONS[(idx + 1) % LABEL_POSITIONS.length];
    }, { render: false });

    const newLabelEl = renderFieldInner(fieldEl, field);
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
      el.focus(); // grabbing something to move it selects it too — same
        // highlight + Delete/Backspace behavior as clicking it directly
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
        onSettled();
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
      el.focus(); // same reasoning as wireDrag above
      const before = snapshot();
      const startClientX = e.clientX, startClientY = e.clientY;
      const startW = node.w, startH = node.h;

      function onMove(ev) {
        const dw = Math.round((ev.clientX - startClientX) / (cw + GAP_PX));
        const dh = Math.round((ev.clientY - startClientY) / (cw + GAP_PX));
        node.w = Math.min(maxW, Math.max(minW, startW + dw));
        node.h = Math.min(maxH, Math.max(minH, startH + dh));
        applyRect(el, node, cw);
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
      }
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  function buildDragHandle() {
    const h = document.createElement("div");
    h.className = "node-handle drag-handle";
    h.textContent = "⠿";
    return h;
  }
  function buildResizeHandle() {
    const h = document.createElement("div");
    h.className = "node-handle resize-handle";
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
   *  setting toolbarWithOpenPopup when it opens. */
  function wireHoverToolbar(triggerEl, toolbarEl) {
    let hideTimer = null;
    function show() {
      if (!editMode) return;
      clearTimeout(hideTimer);
      toolbarEl.classList.add("is-visible");
    }
    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (toolbarWithOpenPopup !== toolbarEl) {
          toolbarEl.classList.remove("is-visible");
        }
      }, 250);
    }
    triggerEl.addEventListener("mouseenter", show);
    triggerEl.addEventListener("mouseleave", scheduleHide);
    toolbarEl.addEventListener("mouseenter", show);
    toolbarEl.addEventListener("mouseleave", scheduleHide);
    toolbarEl._scheduleHide = scheduleHide;
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
          window.alert(
            "That image is large enough that it (plus the rest of this character) may not fit in a single Firestore document (1MB limit). It'll be applied, but saving might fail — try a smaller image if so."
          );
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

    const OPTIONS = [
      { type: "checkbox", label: "Checkbox", preview: () => buildOptionPreview("checkbox", 1) },
      { type: "dropdown", label: "Dropdown", preview: buildDropdownPreview },
      { type: "label", label: "Label", preview: buildLabelPreview },
      { type: "picture", label: "Picture", preview: buildPicturePreview },
      { type: "radio", label: "Radio Buttons", preview: () => buildOptionPreview("radio", 3) },
      { type: "text", label: "Num Field", preview: buildTextPreview },
      { type: "textarea", label: "Text Area", preview: buildTextareaPreview },
      { type: "textlist", label: "Text List", preview: buildTextlistPreview },
    ].sort((a, b) => a.label.localeCompare(b.label));

    OPTIONS.forEach(({ type, label, preview }) => {
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
  window.addEventListener("resize", debounce(renderPageGrid, 150));
}

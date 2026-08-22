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
//   - Equations are a stub (see equationStub.js) — every field,
//     including ones that conceptually want to be computed, is a
//     plain manually-typed value for now, per instruction.
//   - Background images are stored as data URLs directly on the
//     character document. Firestore caps a document at 1MB total, so
//     large images will fail to save — there's a warning on upload,
//     but no compression/resizing yet.

import { createStarterLayout, createBlock, createField, createLabelBlock, findParentArray, syncOptionWidth, LABEL_POSITIONS, BLOCK_HEADER_ROWS } from "../data/blockModel.js";
import { contentHeight } from "./gridEngine.js";
import { openEquationStub } from "./equationStub.js";

const PAGE_COLS = 16;
const ROW_PX = 48;
const GAP_PX = 8;
const MIN_CELL_PX = 40; // below this, the page scrolls horizontally instead of squishing cells
const MAX_BG_IMAGE_BYTES = 250_000; // warn above this — Firestore caps a whole doc at 1MB

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

  const addLabelBtn = document.createElement("button");
  addLabelBtn.type = "button";
  addLabelBtn.className = "btn";
  addLabelBtn.textContent = "+ Label";
  addLabelBtn.style.display = "none";
  addLabelBtn.addEventListener("click", () => {
    commitMutation(() => {
      currentLayout().push(createLabelBlock({ name: "Header", x: 0, y: 0, w: 5, h: 1 }));
    });
  });

  leftGroup.append(modeBtn, undoBtn, redoBtn, addBlockBtn, addLabelBtn);
  toolbar.append(leftGroup);

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
  nameInput.addEventListener("input", debounce(() => {
    character.name = nameInput.value;
    saveWithStatus("name", nameInput.value);
  }, 400));
  toolbar.append(nameInput);

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
    addLabelBtn.style.display = editMode ? "" : "none";
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
        e.dataTransfer.types.includes("application/x-sheet-field")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });
  pageGrid.addEventListener("drop", (e) => {
    if (!editMode) return;
    const blockId = e.dataTransfer.getData("application/x-sheet-block");
    const fieldPayload = e.dataTransfer.getData("application/x-sheet-field");
    if (!blockId && !fieldPayload) return;
    e.preventDefault();

    const rect = pageGrid.getBoundingClientRect();
    const cw = colWidthPx();
    const x = Math.max(0, Math.round((e.clientX - rect.left) / (cw + GAP_PX)));
    const y = Math.max(0, Math.round((e.clientY - rect.top) / (ROW_PX + GAP_PX)));

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
    if (e.target.closest("input, textarea, select, [contenteditable='true']")) return;
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

  function applyRect(el, node, cw) {
    el.style.left = `${node.x * (cw + GAP_PX)}px`;
    el.style.top = `${node.y * (ROW_PX + GAP_PX)}px`;
    el.style.width = `${node.w * cw + (node.w - 1) * GAP_PX}px`;
    el.style.height = `${node.h * ROW_PX + (node.h - 1) * GAP_PX}px`;
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
    const cw = colWidthPx();
    const availableHeight = availableViewportHeight();
    scrollWrapper.style.height = `${availableHeight}px`;
    // Explicit width so the grid can exceed the wrapper's width (and
    // scroll) once cw hits its floor, rather than being crushed to fit.
    pageGrid.style.width = `${PAGE_COLS * cw + (PAGE_COLS - 1) * GAP_PX}px`;
    // At least tall enough to fill the visible canvas (so there's
    // always room to drag things into open space), taller only if the
    // actual content needs more — in which case it scrolls.
    const contentPx = contentHeight(currentLayout()) * (ROW_PX + GAP_PX);
    pageGrid.style.height = `${Math.max(availableHeight, contentPx)}px`;
    applyGridLines(pageGrid, cw);
    currentLayout().forEach(block => {
      pageGrid.append(renderBlockNode(block, cw));
    });
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
      });

      blockFrame.append(blockItem);
    });
  }

  /** Draws the visible cell grid as the element's own background —
   *  paints behind all the absolutely-positioned blocks/fields on top
   *  of it, so it only shows through in empty space. Recomputed
   *  whenever cw changes since column width is responsive. */
  function applyGridLines(el, cw) {
    if (!editMode) {
      el.style.backgroundImage = "";
      return;
    }
    const colStep = cw + GAP_PX;
    const rowStep = ROW_PX + GAP_PX;
    const line = "rgba(255,255,255,0.5)";
    el.style.backgroundImage =
      `repeating-linear-gradient(to right, ${line} 0, ${line} 2px, transparent 2px, transparent ${colStep}px),` +
      `repeating-linear-gradient(to bottom, ${line} 0, ${line} 2px, transparent 2px, transparent ${rowStep}px)`;
  }

  // --- Block rendering ----------------------------------------------------

  function renderBlockNode(block, cw) {
    const viewBlock = effectiveBlock(block);
    const el = document.createElement("div");
    el.className = `grid-node grid-node--block${viewBlock.blockType === "label" ? " grid-node--label-block" : ""}`;
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
    const headerPx = BLOCK_HEADER_ROWS * ROW_PX + (BLOCK_HEADER_ROWS - 1) * GAP_PX;

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
    el.append(nameEl);

    const body = document.createElement("div");
    body.className = "block-body";
    body.style.top = `${headerPx + GAP_PX}px`;
    applyGridLines(body, cw);
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
            const field = createField({
              fieldType, label: "Stat",
              x: 0, y: 0, w: 1, h: 1,
            });
            sourceBlockFor(block).children.push(field);
          });
        });
      });
      bar.append(addFieldBtn);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn--danger";
    deleteBtn.title = "Delete block";
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const viewBlock = effectiveBlock(block);
      if ((viewBlock.children || []).length > 0 && !window.confirm(`Delete block "${viewBlock.name}" and everything in it?`)) return;
      commitMutation(() => {
        const layout = currentLayout();
        const idx = layout.findIndex(b => b.id === block.id);
        if (idx >= 0) layout.splice(idx, 1);
      });
    });
    bar.append(deleteBtn);

    return bar;
  }

  // --- Field rendering ------------------------------------------------------

  function renderFieldNode(field, parentBlock, cw, parentStyle = {}) {
    const el = document.createElement("div");
    el.className = "grid-node grid-node--field";
    applyRect(el, field, cw);
    const fieldStyle = mergeTextStyle(parentStyle, field.style || {});
    applyNodeStyle(el, fieldStyle);

    renderFieldInner(el, field);
    applyTextStyleToOwnText(el, fieldStyle);

    el.append(buildDragHandle());
    if (field.fieldType === "text") {
      el.append(buildResizeHandle());
    }
    el.append(buildFieldToolbar(field, parentBlock, el));
    el.append(buildEquationHint(field));

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
    if (field.fieldType === "text") {
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

    const labelEl = document.createElement("div");
    labelEl.className = "field-label";
    labelEl.contentEditable = "true";
    labelEl.textContent = field.label;
    labelEl.addEventListener("input", () => {
      commitMutation(() => {
        field.label = labelEl.textContent;
      }, { render: false });
      renderBlockFrame();
    });
    labelEl.addEventListener("pointerdown", (e) => e.stopPropagation());

    const valueEl = buildFieldValue(field);

    inner.append(labelEl, valueEl);
    fieldEl.prepend(inner); // prepend so handles/toolbar (appended later) stay on top
    return labelEl;
  }

  function buildFieldValue(field) {
    if (field.fieldType === "text") {
      const el = document.createElement("div");
      el.className = "field-value";
      el.contentEditable = "true";
      el.innerHTML = field.value || "";
      el.addEventListener("input", () => {
        commitMutation(() => {
          field.value = el.innerHTML;
        }, { render: false });
      });
      el.addEventListener("pointerdown", (e) => e.stopPropagation());
      return el;
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

  function buildFieldToolbar(field, parentBlock, wrapperEl) {
    const bar = document.createElement("div");
    bar.className = "node-toolbar";

    bar.append(buildStyleButton(field, wrapperEl));

    const cycleLabelBtn = document.createElement("button");
    cycleLabelBtn.type = "button";
    cycleLabelBtn.title = "Move label";
    cycleLabelBtn.textContent = "↻";
    cycleLabelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cycleLabelPosition(field, wrapperEl);
    });
    bar.append(cycleLabelBtn);

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

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn--danger";
    deleteBtn.title = "Delete field";
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      commitMutation(() => {
        const arr = findParentArray(globalLayout(), field.id) || findParentArray(currentLayout(), field.id);
        if (arr) {
          const idx = arr.findIndex(n => n.id === field.id);
          arr.splice(idx, 1);
        }
      });
    });
    bar.append(deleteBtn);

    return bar;
  }

  function buildEquationHint(field) {
    const opposite = { top: "bottom", bottom: "top", left: "right", right: "left" }[field.labelPosition];
    const hint = document.createElement("div");
    hint.className = `equation-hint equation-hint--${opposite}`;
    hint.textContent = "=";
    hint.title = "Set up a formula (coming soon)";
    hint.addEventListener("click", (e) => {
      e.stopPropagation();
      openEquationStub(field.label);
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
    fieldEl.append(buildEquationHint(field));

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
      const before = snapshot();
      const startClientX = e.clientX, startClientY = e.clientY;
      const startX = node.x, startY = node.y;

      function onMove(ev) {
        const dx = Math.round((ev.clientX - startClientX) / (cw + GAP_PX));
        const dy = Math.round((ev.clientY - startClientY) / (ROW_PX + GAP_PX));
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
      const before = snapshot();
      const startClientX = e.clientX, startClientY = e.clientY;
      const startW = node.w, startH = node.h;

      function onMove(ev) {
        const dw = Math.round((ev.clientX - startClientX) / (cw + GAP_PX));
        const dh = Math.round((ev.clientY - startClientY) / (ROW_PX + GAP_PX));
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

  function closeOpenPopovers() {
    document.querySelectorAll(".style-popover, .field-type-menu").forEach(p => p.remove());
  }
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".style-popover, .field-type-menu, .node-toolbar button")) {
      closeOpenPopovers();
    }
  });

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
    imgInput.style.width = "120px";
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
    sizeInput.style.width = "60px";
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
    ["text", "radio", "checkbox"].forEach(type => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn";
      btn.textContent = type === "text" ? "Text" : type === "radio" ? "Radio group" : "Checkboxes";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onChoose(type);
        menu.remove();
      });
      menu.append(btn);
    });
    anchorBtn.parentElement.append(menu);
  }

  // --- Boot + responsive re-render ---------------------------------------

  renderAll();
  window.addEventListener("resize", debounce(renderPageGrid, 150));
}

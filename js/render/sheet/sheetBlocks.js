// sheetBlocks.js
//
// Pure block/style geometry helpers extracted from customSheet.js.
// customSheet.js owns DOM + character mutation; it delegates math here.

import { buildLabelValueInto } from "./sheetFields.js";

export function resolveSourceBlock(block, globalLayout = []) {
  if (!block?.sourceBlockId) return block;
  return globalLayout.find((candidate) => candidate.id === block.sourceBlockId) || block;
}

export function effectiveStyleFor(block, source) {
  const src = source || block;
  return { ...((src && src.style) || {}), ...(block.styleOverrides || {}) };
}

export function styleForEditingFor(node, effective) {
  if (node?.sourceBlockId) return effective || {};
  return node?.style || {};
}

/** Mutates node's style/styleOverrides like setNodeStyleValue (no commit). */
export function setStyleValueOn(node, styleKey, value, sourceValue, valuesMatchFn = (a, b) => (a ?? null) === (b ?? null)) {
  if (!node.sourceBlockId) {
    if (!node.style) node.style = {};
    node.style[styleKey] = value;
    return node;
  }
  if (!node.styleOverrides) node.styleOverrides = {};
  if (valuesMatchFn(value, sourceValue)) {
    delete node.styleOverrides[styleKey];
  } else {
    node.styleOverrides[styleKey] = value;
  }
  return node;
}

export function effectiveBlockFor(block, source) {
  const src = source || block;
  return {
    ...src,
    ...block,
    blockType: src.blockType || block.blockType || "stat",
    name: src.name || block.name,
    children: src.children || block.children || [],
    style: effectiveStyleFor(block, src),
  };
}

export function blockTabsFor(blockId, sheetTabs = []) {
  return sheetTabs
    .filter((tab) => (tab.layout || []).some((block) => block.id === blockId || block.sourceBlockId === blockId))
    .map((tab) => tab.name);
}

/** The block a field id lives inside, searching layouts in order —
 *  top-level block ids have no parent (null). Migration of
 *  parentBlockOf from customSheet.js. */
export function parentBlockOfIn(fieldId, layouts = []) {
  for (const layout of layouts) {
    for (const block of layout) {
      if ((block.children || []).some((f) => f.id === fieldId)) return block;
    }
  }
  return null;
}

export function colWidthFor(availableWidth, pageCols, gapPx, minCellPx) {
  const natural = (availableWidth - (pageCols - 1) * gapPx) / pageCols;
  return Math.max(minCellPx, natural);
}

export function rectStyle(node, cw, gapPx, insetPx = 0) {
  return {
    left: `${node.x * (cw + gapPx) + insetPx}px`,
    top: `${node.y * (cw + gapPx) + insetPx}px`,
    width: `${node.w * cw + (node.w - 1) * gapPx - insetPx * 2}px`,
    height: `${node.h * cw + (node.h - 1) * gapPx - insetPx * 2}px`,
  };
}

export function labelMaxWidth(parentBlock, field) {
  if (!parentBlock) return 0;
  return parentBlock.w - field.x;
}

export function shouldGrowForLabel(fieldW, maxW, scrollW, clientW) {
  if (fieldW >= maxW) return false;
  return scrollW > clientW + 1;
}

export function blockReferenceFor(source, newId) {  return {
    id: newId,
    kind: "block",
    sourceBlockId: source.id,
    x: 0,
    y: 0,
    w: source.w,
    h: source.h,
    styleOverrides: {},
  };
}

// --- Grid-lines background -------------------------------------------------
//
// Full migration of applyGridLines from customSheet.js. `isEdit` gates
// the pattern (play mode has no grid); `originEl` re-anchors a nested
// block body's pattern to the page grid's origin.

export function gridStep(cw, gapPx) {
  return cw + gapPx;
}

export function applyGridLinesTo(el, cw, gapPx, isEdit, originEl = null) {
  if (!isEdit) {
    el.style.backgroundImage = "";
    el.style.backgroundPosition = "";
    return;
  }
  const step = gridStep(cw, gapPx);
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

// --- Sidebar (Stat Blocks list) DOM -------------------------------------
//
// Full DOM migration of renderBlockFrame from customSheet.js. Takes an
// explicit `deps` object (no sheet closure) so the renderer is a thin
// wrapper:
//
//   renderBlockFrameInto(frameEl, {
//     layout: [...blocks],
//     viewOf: (block) => effectiveView,
//     tabsFor: (blockId) => [names],
//     tabCount: n,
//     collapsedIds: Set,
//     onToggle: (blockId) => void,   // flip collapsed + rerender
//     onSelectBlock: (blockId) => void,
//     onSelectField: (fieldId) => void,
//     fieldDragPayload: (blockId, field, checkboxIndex) => string,
//   })

// --- Block node DOM --------------------------------------------------------

export function fieldDragPayload(blockId, field, checkboxIndex = null) {
  return JSON.stringify(
    checkboxIndex === null
      ? { blockId, fieldId: field.id }
      : { blockId, fieldId: field.id, checkboxIndex }
  );
}

export function blockNodeClass(blockType) {
  return `grid-node grid-node--block${blockType === "label" ? " grid-node--label-block" : ""}`;
}

export function blockHeaderPx(headerRows, cw, gapPx) {
  return headerRows * cw + (headerRows - 1) * gapPx;
}

// --- Block toolbar DOM ------------------------------------------------------
//
// Migration of buildBlockToolbar from customSheet.js:
//
//   buildBlockToolbarInto(block, wrapperEl, {
//     styleBtnFn, borderBtnFn, viewOf,
//     typeMenuFn, commitFn, sourceOf, defaultSize, createFieldFn, hoverFn,
//   })

export function buildBlockToolbarInto(block, wrapperEl, deps) {
  const {
    styleBtnFn,
    borderBtnFn,
    viewOf,
    typeMenuFn,
    commitFn,
    sourceOf,
    defaultSize,
    createFieldFn,
    hoverFn,
  } = deps;

  const bar = document.createElement("div");
  bar.className = "node-toolbar";

  bar.append(styleBtnFn(block, wrapperEl));
  bar.append(borderBtnFn(block, wrapperEl));

  if (viewOf(block).blockType !== "label") {
    const addFieldBtn = document.createElement("button");
    addFieldBtn.type = "button";
    addFieldBtn.title = "Add field";
    addFieldBtn.textContent = "+";
    addFieldBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      typeMenuFn(addFieldBtn, (fieldType) => {
        commitFn(() => {
          const size = defaultSize[fieldType] || { w: 1, h: 1 };
          const field = createFieldFn({
            fieldType, label: "Stat",
            x: 0, y: 0, w: size.w, h: size.h,
          });
          sourceOf(block).children.push(field);
        });
      });
    });
    bar.append(addFieldBtn);
  }

  hoverFn(wrapperEl, bar);
  return bar;
}

export function renderBlockNodeInto(block, cw, deps) {
  const {
    viewOf,
    isEdit,
    gapPx,
    headerRows,
    applyRectFn,
    applyStyleFn,
    ghostFn,
    ownTextFn,
    dragHandleFn,
    resizeHandleFn,
    toolbarFn,
    fieldNodeFn,
    dragFn,
    resizeFn,
    commitFn,
    sourceOf,
    frameFn,
    renderAllFn,
    persistFn,
  } = deps;

  const viewBlock = viewOf(block);
  const el = document.createElement("div");
  el.className = blockNodeClass(viewBlock.blockType);
  el.dataset.nodeId = block.id;
  el.dataset.nodeKind = "block";
  if (isEdit) el.tabIndex = 0;
  applyRectFn(el, block, cw);
  applyStyleFn(el, viewBlock.style);

  if (viewBlock.blockType === "label") {
    const labelEl = document.createElement("div");
    labelEl.className = "label-block-text";
    labelEl.contentEditable = "true";
    labelEl.textContent = viewBlock.name;
    labelEl.addEventListener("input", () => {
      commitFn(() => {
        sourceOf(block).name = labelEl.textContent;
      }, { render: false });
    });
    ghostFn(labelEl, "Text Label", (text) => {
      commitFn(() => {
        sourceOf(block).name = text;
      }, { render: false });
    });
    el.append(labelEl);
    ownTextFn(el, viewBlock.style);
    el.append(dragHandleFn());
    el.append(resizeHandleFn());
    el.append(toolbarFn(block, el));
    dragFn(el, block, cw, () => renderAllFn());
    resizeFn(el, block, cw, {
      minW: 1,
      minH: 1,
      onCommit: () => {
        persistFn();
        renderAllFn();
      },
    });
    return el;
  }

  const headerPx = blockHeaderPx(headerRows, cw, gapPx);

  // .block-body sits flush against the inside of this block's own
  // border (it's absolutely positioned with left/right/bottom: 0,
  // which CSS measures from the padding box — i.e. right up against
  // the border, not inset from it). The fields inside it are sized
  // with the exact same per-cell math as this block itself, so
  // without this they come out fractionally too wide/tall for that
  // space and spill a couple of pixels past the border on the
  // right/bottom edges. Widening the block by twice its own border
  // width (one border's worth per side) gives the body that space
  // back — top/left stay put, only width/height grow.
  const blockBorderCompensationPx = 2; // 2 x --border-width (1px)
  el.style.width = `${parseFloat(el.style.width) + blockBorderCompensationPx}px`;
  el.style.height = `${parseFloat(el.style.height) + blockBorderCompensationPx}px`;

  // Block headers render through the same Label-element builder as
  // label-type fields (same look, editing, and ghost behavior) —
  // the text still lives on block.name, so every name lookup keeps
  // working unchanged.
  const nameEl = document.createElement("div");
  nameEl.className = "block-name";
  nameEl.style.height = `${headerPx}px`;
  const nameField = { value: viewBlock.name || "" };
  const nameLabelEl = buildLabelValueInto(nameField, {
    commitFn: (fn, opts) => {
      fn();
      commitFn(() => {
        sourceOf(block).name = nameField.value;
      }, opts);
      nameEl.title = nameField.value;
      frameFn();
    },
    ghostFn: (labelEl, _defaultText, commit) => ghostFn(labelEl, "New Block", commit),
  });
  nameEl.title = viewBlock.name;
  nameEl.append(nameLabelEl);
  el.append(nameEl);

  const body = document.createElement("div");
  body.className = "block-body";
  body.style.top = `${headerPx + gapPx}px`;
  // Grid lines for this body are applied once it's actually in the
  // DOM — see the post-append pass at the end of renderPageGrid.
  el.append(body);

  ownTextFn(el, viewBlock.style);

  viewBlock.children.forEach((field) => {
    body.append(fieldNodeFn(field, block, cw, viewBlock.style));
  });

  el.append(dragHandleFn());
  el.append(resizeHandleFn());
  el.append(toolbarFn(block, el));

  dragFn(el, block, cw, () => renderAllFn());
  resizeFn(el, block, cw, {
    minW: 1,
    minH: headerRows + 1,
    onCommit: () => {
      persistFn();
      renderAllFn();
    },
  });

  return el;
}

export function renderBlockFrameInto(frameEl, deps) {
  const {
    layout = [],
    viewOf,
    tabsFor,
    tabCount = 1,
    collapsedIds,
    onToggle,
    onSelectBlock,
    onSelectField,
    fieldDragPayload: payloadFn = fieldDragPayload,
  } = deps;

  frameEl.innerHTML = "";
  const title = document.createElement("div");
  title.className = "sheet-block-frame__title";
  title.textContent = "Stat Blocks";
  frameEl.append(title);

  layout.forEach((block) => {
    const source = viewOf(block);
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
    blockLine.addEventListener("click", () => onSelectBlock(block.id));

    const titleRow = document.createElement("div");
    titleRow.className = "sheet-block-list__title-row";

    const collapsed = collapsedIds.has(block.id);
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "sheet-block-list__collapse-toggle";
    toggleBtn.textContent = collapsed ? "▸" : "▾";
    toggleBtn.title = collapsed ? "Expand" : "Collapse";
    toggleBtn.setAttribute("aria-label", collapsed ? "Expand" : "Collapse");
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onToggle(block.id);
    });
    titleRow.append(toggleBtn);

    const name = document.createElement("span");
    name.textContent = source.name || "Unnamed Block";
    titleRow.append(name);
    blockLine.append(titleRow);

    if (tabCount > 1) {
      const tabs = document.createElement("span");
      tabs.className = "sheet-block-list__tabs";
      tabs.textContent = tabsFor(block.id).join(", ");
      blockLine.append(tabs);
    }
    blockItem.append(blockLine);

    const fieldsWrap = document.createElement("div");
    fieldsWrap.className = "sheet-block-list__fields";
    if (collapsed) fieldsWrap.hidden = true;

    (source.children || []).forEach((field) => {
      const fieldItem = document.createElement("div");
      fieldItem.className = "sheet-block-list__field";
      fieldItem.textContent = field.label || "Unnamed Field";
      fieldItem.draggable = true;
      fieldItem.dataset.highlightId = field.id;
      fieldItem.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectField(field.id);
      });
      fieldItem.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        e.dataTransfer.setData("application/x-sheet-field", payloadFn(block.id, field));
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
            onSelectField(field.id);
          });
          cbItem.addEventListener("dragstart", (e) => {
            e.stopPropagation();
            e.dataTransfer.setData("application/x-sheet-field", payloadFn(block.id, field, i));
            e.dataTransfer.effectAllowed = "copy";
          });
          fieldsWrap.append(cbItem);
        });
      }
    });
    blockItem.append(fieldsWrap);

    frameEl.append(blockItem);
  });
}

// --- Node removal ---------------------------------------------------------------
//
// Migration of deleteBlockNode / deleteFieldNode cores from
// customSheet.js. The confirm dialog + commit stay in the renderer.

export function removeBlockFromLayout(layout, blockId) {
  const idx = layout.findIndex((b) => b.id === blockId);
  if (idx < 0) return false;
  layout.splice(idx, 1);
  return true;
}

export function removeFieldFromLayouts(layouts, fieldId, findParentArrayFn) {
  for (const layout of layouts) {
    const arr = findParentArrayFn(layout, fieldId);
    if (arr) {
      const idx = arr.findIndex((n) => n.id === fieldId);
      if (idx >= 0) arr.splice(idx, 1);
      return true;
    }
  }
  return false;
}

// sheetDrag.js
//
// Drag/resize grid math + DOM wiring helpers, extracted from customSheet.js.
// The pure math (cellsDelta, clampPos, resizeDims, scaleFieldRect) has no
// sheet dependencies. wireDrag/wireResize take an explicit `deps` object so
// sub-modules don't need the whole renderCustomSheet closure:
//
//   wireDrag(el, node, cw, {
//     isEditMode: () => boolean,
//     onSelectBlockOrField: (el, node) => void,
//     snapshot: () => unknown,
//     commit: (before) => void,   // push undo, normalize, persist
//     settled: () => void,        // rebuild DOM
//     applyRect: (el, node, cw) => void,
//     reselect: (el, node) => void,
//     bounds: { maxX, maxY },
//   })
//
// customSheet.js still owns its inner versions for now; its onMove bodies
// delegate to cellsDelta/clampPos below so the math lives in exactly one place.

export function cellsDelta(clientDeltaPx, cw, gapPx) {
  return Math.round(clientDeltaPx / (cw + gapPx));
}

export function clampPos(value, max) {
  if (!Number.isFinite(max)) return Math.max(0, value);
  return Math.min(Math.max(0, max), Math.max(0, value));
}

export function dragPos(startX, startY, dxCells, dyCells, bounds = {}) {
  const { maxX = Infinity, maxY = Infinity } = bounds;
  return {
    x: clampPos(startX + dxCells, maxX),
    y: clampPos(startY + dyCells, maxY),
  };
}

export function resizeDims(startW, startH, dwCells, dhCells, { minW = 1, minH = 1, maxW = Infinity, maxH = Infinity } = {}) {
  return {
    w: Math.min(maxW, Math.max(minW, startW + dwCells)),
    h: Math.min(maxH, Math.max(minH, startH + dhCells)),
  };
}

export function scaleFieldRect(start, ratioW, ratioH) {
  return {
    x: Math.max(0, Math.round(start.x * ratioW)),
    y: Math.max(0, Math.round(start.y * ratioH)),
    w: Math.max(1, Math.round(start.w * ratioW)),
    h: Math.max(1, Math.round(start.h * ratioH)),
  };
}

/** Pure bounding-box of {x,y,w,h} nodes in grid cells (not pixels). */
export function boundingBox(nodes) {
  if (!nodes.length) return { x: 0, y: 0, w: 1, h: 1 };
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.w));
  const maxY = Math.max(...nodes.map((n) => n.y + n.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function cloneWithNewIds(node, newIdFn) {
  const clone = JSON.parse(JSON.stringify(node));
  const assign = (n) => {
    n.id = newIdFn();
    (n.children || []).forEach(assign);
  };
  assign(clone);
  return clone;
}

function scopedHandle(el, cls) {
  return el.querySelector(`:scope > .${cls}`);
}

export function wireDrag(el, node, cw, deps) {
  const {
    gapPx = 10,
    bounds = {},
    isEditMode,
    onSelectBlockOrField,
    snapshot,
    commit,
    settled,
    applyRect,
    reselect,
  } = deps;
  const handle = scopedHandle(el, "drag-handle");
  if (!handle) return;
  handle.addEventListener("pointerdown", (e) => {
    if (!isEditMode()) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.add("is-dragging");
    onSelectBlockOrField(el, node);
    const before = snapshot();
    const startClientX = e.clientX, startClientY = e.clientY;
    const startX = node.x, startY = node.y;
    const isBlock = Array.isArray(node.children);

    function onMove(ev) {
      const dx = cellsDelta(ev.clientX - startClientX, cw, gapPx);
      const dy = cellsDelta(ev.clientY - startClientY, cw, gapPx);
      const pos = dragPos(startX, startY, dx, dy, bounds);
      node.x = pos.x;
      node.y = pos.y;
      applyRect(el, node, cw);
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      el.classList.remove("is-dragging");
      commit(before);
      settled();
      reselect(el, node, isBlock);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
}

export function wireResize(el, node, cw, deps) {
  const {
    gapPx = 10,
    minW = 1,
    minH = 1,
    maxW = Infinity,
    maxH = Infinity,
    isEditMode,
    getScaleFieldIds,
    snapshot,
    commit,
    settled,
    applyRect,
    reselect,
  } = deps;
  const handle = scopedHandle(el, "resize-handle");
  if (!handle) return;
  handle.addEventListener("pointerdown", (e) => {
    if (!isEditMode()) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.add("is-resizing");
    const isBlock = Array.isArray(node.children);
    const scalePlan = getScaleFieldIds(el, node, e) || { ids: [], fields: [] };
    const before = snapshot();
    const startClientX = e.clientX, startClientY = e.clientY;
    const startW = node.w, startH = node.h;

    function onMove(ev) {
      const dw = cellsDelta(ev.clientX - startClientX, cw, gapPx);
      const dh = cellsDelta(ev.clientY - startClientY, cw, gapPx);
      const dims = resizeDims(startW, startH, dw, dh, { minW, minH, maxW, maxH });
      const ratioW = dims.w / startW;
      const ratioH = dims.h / startH;
      node.w = dims.w;
      node.h = dims.h;
      applyRect(el, node, cw);
      scalePlan.fields.forEach(({ field, start }) => {
        const r = scaleFieldRect(start, ratioW, ratioH);
        field.x = r.x; field.y = r.y; field.w = r.w; field.h = r.h;
        const fieldEl = el.querySelector(`[data-node-id="${field.id}"]`);
        if (fieldEl) applyRect(fieldEl, field, cw);
      });
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      el.classList.remove("is-resizing");
      commit(before);
      settled();
      reselect(el, node, isBlock, scalePlan.ids);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
}

// --- Duplicate / nudge math ------------------------------------------------
//
// Mirrors the inner helpers in customSheet.js (boundingBox,
// cloneWithNewIds, duplicateBlocksOnGrid, duplicateFieldsInBlock,
// duplicateSelection, nudgeSelection) with identical semantics:
//  - nodesBounds returns {minX,minY,maxX,maxY,w,h} (NOT the {x,y,w,h}
//    shape of boundingBox above — the duplicate-placement code reads
//    min/max edges directly).
//  - cloneNodeWithNewIds clears isAvatar on picture fields and only
//    re-ids one level (block + direct children), like the original.

export function nodesBounds(nodes) {
  return {
    minX: Math.min(...nodes.map((n) => n.x)),
    minY: Math.min(...nodes.map((n) => n.y)),
    maxX: Math.max(...nodes.map((n) => n.x + n.w)),
    maxY: Math.max(...nodes.map((n) => n.y + n.h)),
    w: Math.max(...nodes.map((n) => n.x + n.w)) - Math.min(...nodes.map((n) => n.x)),
    h: Math.max(...nodes.map((n) => n.y + n.h)) - Math.min(...nodes.map((n) => n.y)),
  };
}

export function duplicateOffset(box, maxCols) {
  const fitsRight = box.maxX + box.w <= maxCols;
  return fitsRight ? { dx: box.w, dy: 0 } : { dx: 0, dy: box.h };
}

export function cloneNodeWithNewIds(node, newIdFn) {
  const dupe = JSON.parse(JSON.stringify(node));
  dupe.id = newIdFn();
  if (dupe.fieldType === "picture") dupe.isAvatar = false;
  if (Array.isArray(dupe.children)) {
    dupe.children = dupe.children.map((child) => {
      const c = JSON.parse(JSON.stringify(child));
      c.id = newIdFn();
      if (c.fieldType === "picture") c.isAvatar = false;
      return c;
    });
  }
  return dupe;
}

export function blockGrowthForDuplicate(block, box, dy, headerRows) {
  const contentRows = block.h - headerRows;
  const neededRows = box.minY + dy + box.h;
  return neededRows > contentRows ? neededRows - contentRows : 0;
}

export function partitionDuplicateSelection(layout, selectedIds) {
  const blocksToDuplicate = layout.filter((b) => selectedIds.has(b.id));
  const coveredFieldIds = new Set();
  blocksToDuplicate.forEach((b) => (b.children || []).forEach((f) => coveredFieldIds.add(f.id)));

  const fieldGroups = []; // [block, fields] — block object keys don't survive pure helpers, so pairs
  layout.forEach((block) => {
    if (selectedIds.has(block.id)) return;
    const fields = (block.children || []).filter(
      (f) => selectedIds.has(f.id) && !coveredFieldIds.has(f.id)
    );
    if (fields.length) fieldGroups.push([block, fields]);
  });
  return { blocksToDuplicate, fieldGroups };
}

export function nudgeTargets(selectedIds, parentBlockOfFn) {
  return [...selectedIds].filter((id) => {
    const block = parentBlockOfFn(id);
    return !block || !selectedIds.has(block.id);
  });
}

export function nudgeNode(node, dx, dy, resize, { maxW, maxH, maxX, maxY }) {
  if (resize) {
    node.w = Math.min(maxW, Math.max(1, node.w + dx));
    node.h = Math.min(maxH, Math.max(1, node.h + dy));
  } else {
    node.x = Math.min(maxX, Math.max(0, node.x + dx));
    node.y = Math.min(maxY, Math.max(0, node.y + dy));
  }
  return node;
}

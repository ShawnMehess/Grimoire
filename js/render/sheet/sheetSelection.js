// sheetSelection.js
//
// Selection + floating-chrome DOM helpers migrated from customSheet.js.
// Functions take explicit elements/state (no sheet closure); the
// renderer keeps its `selectedIds`/`groupBorderVisible` lets as the
// source of truth and delegates DOM work here.

export function selectionBoxFor(pageGrid, selectedIds) {
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

export function paintSelectionInto(pageGrid, blockFrame, selectedIds) {
  pageGrid.querySelectorAll(".grid-node.is-selected").forEach((el) => el.classList.remove("is-selected"));
  blockFrame.querySelectorAll(".is-selected").forEach((el) => el.classList.remove("is-selected"));
  selectedIds.forEach((id) => {
    const el = pageGrid.querySelector(`[data-node-id="${id}"]`);
    if (el) el.classList.add("is-selected");
    const item = blockFrame.querySelector(`[data-highlight-id="${id}"]`);
    if (item) item.classList.add("is-selected");
  });
}

export function shouldResetGroupBorder(prevSignature, nextSignature) {
  return prevSignature !== nextSignature;
}

export function applyGroupBorderOverlay(overlayEl, box) {
  if (!box) {
    overlayEl.classList.remove("is-visible");
    return;
  }
  overlayEl.style.left = `${box.left - 3}px`;
  overlayEl.style.top = `${box.top - 3}px`;
  overlayEl.style.width = `${box.right - box.left + 6}px`;
  overlayEl.style.height = `${box.bottom - box.top + 6}px`;
  overlayEl.classList.add("is-visible");
}

export function buildDragHandle() {
  const h = document.createElement("div");
  h.className = "node-handle drag-handle";
  h.textContent = "⠿";
  // Mouse/touch-drag only — there's no keyboard equivalent for
  // repositioning a block, so hiding this from assistive tech is
  // more honest than labeling it as if it were operable.
  h.setAttribute("aria-hidden", "true");
  return h;
}

export function buildResizeHandle() {
  const h = document.createElement("div");
  h.className = "node-handle resize-handle";
  h.setAttribute("aria-hidden", "true"); // see buildDragHandle
  return h;
}

export function positionFloatingToolbarAt(el, rightEdgePx, topEdgePx, bottomEdgePx) {
  const TOOLBAR_H = 28;
  const GAP = 8; // more clearance than a single node's own toolbar offset,
    // so the grid line between the toolbar and the selection stays visible
  const fitsAbove = topEdgePx - TOOLBAR_H - GAP >= 0;
  el.style.top = fitsAbove ? `${topEdgePx - TOOLBAR_H - GAP}px` : `${bottomEdgePx + GAP}px`;
  el.style.right = "auto";
  el.style.left = `${rightEdgePx - 90}px`;
}

export function positionPopoverWithinViewportAt(pop) {
  const rect = pop.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    pop.style.left = "auto";
    pop.style.right = "calc(100% + var(--space-2))";
  }
}

// --- Group toolbar + selection click ---------------------------------------------
//
// Migration of the multi-selection group toolbar, its bounding-box
// border elements, the hover-to-show logic, and the grid click
// selection decision from customSheet.js.

export function buildGroupToolbarInto(onToggleBorder) {
  const toolbar = document.createElement("div");
  toolbar.className = "node-toolbar group-toolbar";
  const borderBtn = document.createElement("button");
  borderBtn.type = "button";
  borderBtn.title = "Toggle a border around the whole selection";
  borderBtn.textContent = "▢";
  borderBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    onToggleBorder();
  });
  toolbar.append(borderBtn);

  // The border itself: not each selected element getting its own
  // border, but one rectangle around the smallest box that contains
  // all of them — a visible outline of the CURRENT selection, not a
  // persisted style.
  const overlay = document.createElement("div");
  overlay.className = "group-border-overlay";
  return { toolbar, borderBtn, overlay };
}

/** Pure decision for the group toolbar's hover visibility. Returns
 *  { visible:boolean } — the caller positions via
 *  positionFloatingToolbarAt when visible. */
export function groupToolbarHover(editMode, box, mx, my) {
  if (!editMode) return { visible: false };
  if (!box) return { visible: false };
  if (mx < box.left || mx > box.right || my < box.top || my > box.bottom) {
    return { visible: false };
  }
  return { visible: true };
}

/** Pure decision for a grid click in edit mode (capture phase).
 *  Inputs are already-resolved DOM facts, not elements:
 *    clickSelectionAction({ onHandle, nodeKind, id, modified,
 *                            singleSelectedId })
 *  where singleSelectedId is the id when exactly one thing is
 *  selected, else null. Returns 'ignore' | 'toggle' | 'keep' |
 *  'block' | 'field'. */
export function clickSelectionAction({ onHandle, nodeKind, id, modified, singleSelectedId }) {
  if (onHandle) return "ignore";
  if (!id) return "ignore";
  if (modified) return "toggle";
  // A plain click on something that's already the ENTIRE current
  // selection is left alone — that's what lets a plain click-drag on
  // an existing multi-selection start moving the whole group.
  if (singleSelectedId !== null && singleSelectedId === id) return "keep";
  if (nodeKind === "block") return "block";
  return "field";
}

/** Grid cell a grid-drop lands in, from pointer position. */
export function dropCellFor(clientX, clientY, rect, cw, gapPx) {
  return {
    x: Math.max(0, Math.round((clientX - rect.left) / (cw + gapPx))),
    y: Math.max(0, Math.round((clientY - rect.top) / (cw + gapPx))),
  };
}

// --- Hover toolbar + popover chrome ---------------------------------------
//
// Migration of wireHoverToolbar/closeOpenPopovers from customSheet.js.
// The renderer keeps `activeHoverToolbar`/`toolbarWithOpenPopup` lets as
// the source of truth; this module takes explicit accessors so multiple
// toolbars coordinate through one shared pair:
//
//   wireHoverToolbarInto(triggerEl, toolbarEl, {
//     isEditMode: () => boolean,
//     scrollWrapper,
//     getOpenPopup: () => el|null,
//     getActiveToolbar: () => el|null,
//     setActiveToolbar: (el|null) => void,
//   })
//
// closeOpenPopoversIn(doc, getOpen, setOpen) removes any open popup and
// re-triggers the owning toolbar's hide check.

export function closeOpenPopoversIn(doc, getOpen, setOpen) {
  doc.querySelectorAll(".style-popover, .field-type-menu").forEach((p) => p.remove());
  const tb = getOpen();
  if (tb) {
    setOpen(null);
    if (tb._scheduleHide) tb._scheduleHide();
  }
}

export function wireHoverToolbarInto(triggerEl, toolbarEl, deps) {
  const { isEditMode, scrollWrapper, getOpenPopup, getActiveToolbar, setActiveToolbar } = deps;
  let hideTimer = null;
  function show() {
    if (!isEditMode()) return;
    clearTimeout(hideTimer);
    const active = getActiveToolbar();
    if (active && active !== toolbarEl && getOpenPopup() !== active) {
      active.classList.remove("is-visible");
    }
    setActiveToolbar(toolbarEl);
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
      if (getOpenPopup() !== toolbarEl) {
        toolbarEl.classList.remove("is-visible");
        if (getActiveToolbar() === toolbarEl) setActiveToolbar(null);
      }
    }, 250);
  }
  triggerEl.addEventListener("mouseenter", show);
  triggerEl.addEventListener("mouseleave", scheduleHide);
  toolbarEl.addEventListener("mouseenter", show);
  toolbarEl.addEventListener("mouseleave", scheduleHide);
  toolbarEl._scheduleHide = scheduleHide;
  // Touchscreens have no hover: tapping the node itself toggles its
  // toolbar. Mouse users keep the pure-hover behavior (toggling on
  // tap would fight normal clicking), so this only arms on
  // hover-incapable devices. Taps that start editing (text, inputs,
  // buttons, the dice roller) are never toggles.
  if (typeof window !== "undefined" && window.matchMedia
    && window.matchMedia("(hover: none)").matches) {
    triggerEl.addEventListener("click", (e) => {
      if (!isEditMode()) return;
      if (e.target.closest('[contenteditable="true"], input, select, textarea, button, a, .field-roll, .style-popover')) return;
      if (getOpenPopup() === toolbarEl) return;
      if (toolbarEl.classList.contains("is-visible")) {
        toolbarEl.classList.remove("is-visible");
        if (getActiveToolbar() === toolbarEl) setActiveToolbar(null);
      } else {
        show();
      }
    });
  }
}

// simpleView.js
//
// Simple View: a display mode that stacks the sheet into full-width
// sections instead of showing the positioned grid.
//
// The one thing that isn't CSS is the ORDER. The grid is a set of
// absolutely positioned nodes, so "stack them" is easy — but "stack them
// in their existing row-then-column order" is not, because DOM order is
// layout-array order, and a layout array can easily list a field at
// (0,2) before one at (0,0). CSS can't derive a sort key from a node's
// coordinates, so the key is computed here and applied as the flex
// `order` property.
//
// Nothing in this module writes to the saved layout. The sort keys live
// only on the DOM, and clearing them (on the way back to Sheet View)
// returns the sheet to exactly the coordinates it always had.

import { PAGE_COLS } from "./sheetLayouts.js";

/** Sort key for one node: row first, then column, packed into a single
 *  integer so flex `order` can carry it. PAGE_COLS is the column
 *  multiplier — a column index is always < PAGE_COLS, so this can't
 *  collide across rows, and it stays correct inside a narrower block
 *  because a block's cells are a prefix of the page grid. */
export function simpleViewOrder(x, y, cols = PAGE_COLS) {
  const col = Number(x);
  const row = Number(y);
  const width = Math.max(1, Number(cols) || 1);
  if (!Number.isFinite(col) || !Number.isFinite(row)) return 0;
  return Math.max(0, row) * width + Math.max(0, col);
}

/** Read a node's sort key off the data attributes the renderers stamp
 *  (see sheetFields.js / sheetBlocks.js). Returns null when the node
 *  isn't a grid node or has no stamped cell, so the caller can leave it
 *  alone rather than lumping it at order 0. */
export function simpleViewOrderFromNode(node, cols = PAGE_COLS) {
  const x = node?.dataset?.gridX;
  const y = node?.dataset?.gridY;
  if (x === undefined || y === undefined) return null;
  return simpleViewOrder(x, y, cols);
}

/** Stamp (or clear, with `on: false`) the sort key on every grid node
 *  under `container`. The only DOM write in this module; kept separate
 *  from the arithmetic above so that part stays testable without a DOM. */
export function applySimpleViewOrder(container, on, cols = PAGE_COLS) {
  if (!container?.querySelectorAll) return;
  for (const node of container.querySelectorAll(".grid-node")) {
    if (!on) {
      if (node.style) node.style.order = "";
      continue;
    }
    const order = simpleViewOrderFromNode(node, cols);
    if (order === null) continue;
    if (node.style) node.style.order = String(order);
  }
}

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

/** Whether the window is too narrow for the positioned grid, so the
 *  sheet has to be stacked instead.
 *
 *  The grid is a fixed 16 columns with a floor on how small a cell may get
 *  (MIN_CELL_PX), so it has a hard minimum width - about 790px - and no
 *  amount of shrinking will bring it under a phone's 390. Below that
 *  width the sheet either scrolls sideways for a canvas that is mostly
 *  empty space to the right of a real character, or it crushes cells into
 *  nothing. Neither is a usable sheet, so the stacked display is not a
 *  preference on a screen that small: it is the only readable one.
 *
 *  `gridWidth` is the grid's own measured width (never a hard-coded
 *  number), so this stays correct if the column count or the cell floor
 *  ever change. A missing measurement means "not too narrow" - guessing
 *  narrow on a screen that has not been measured yet would stack the
 *  sheet on every load and flicker back. */
export function narrowScreenNeedsStackedView({ gridWidth, availableWidth } = {}) {
  // parseFloat, not Number: a width read straight off `style.width` is
  // "792px", and Number() makes that NaN - which would read as "no
  // measurement yet" and silently leave the phone with a sideways
  // scrollbar, i.e. the exact failure this exists to prevent.
  const px = (value) => {
    const n = typeof value === "string" ? parseFloat(value) : Number(value);
    return Number.isFinite(n) ? n : NaN;
  };
  const grid = px(gridWidth);
  const avail = px(availableWidth);
  if (!Number.isFinite(grid) || !Number.isFinite(avail)) return false;
  if (avail <= 0) return false;
  return grid > avail + 1;
}

/** Whether to show the one-time orientation panel.
 *
 *  Shown once per character and remembered on the character, not in local
 *  storage: a new character is exactly the case where someone has no idea
 *  what the toolbar does, and a global flag would mean the second character
 *  they ever make gets no explanation at all.
 *
 *  Not shown while the creation wizard is still running. The wizard already
 *  walks a new player through building a character one page at a time, and a
 *  panel about "switching views" appearing over the top of it is noise about
 *  a feature they have not reached.
 *
 *  `sawIntro` is only ever set to true, so a character whose field is missing
 *  or falsy for any reason gets the panel again rather than never. Pure. */
export function shouldShowIntro({ setupComplete, sawIntro } = {}) {
  return setupComplete === true && sawIntro !== true;
}

/** The orientation panel's content: what this is, and the one thing about
 *  the sheet that is genuinely non-obvious. Kept as data so the wording is
 *  reviewable in one place and testable without a DOM.
 *
 *  The two-view point is the one worth making. Sheet View is a positioned
 *  grid with drag and resize handles, and a new player's first instinct on
 *  seeing handles is to move everything - which is a real, saved change to
 *  a layout that is normally well-tuned. Simple View is display-only and
 *  cannot break anything, so it is offered as the safe way to read a
 *  character. Pure. */
export const INTRO_LINES = [
  "This is your character sheet. Click any box to type in it; everything saves as you go.",
  "Sheet View lays everything out on a grid, with drag handles to move blocks around. Moving one changes your saved layout, so undo takes a click.",
  "Simple View stacks every block and field full-width in reading order instead. It is display only — you can read and fill in as normal, but nothing can be dragged out of place.",
  "Both views remember which one you were using.",
  "The Character Setup wizard builds a new character for you; toolbar buttons cover rules, themes, and layout tools.",
];


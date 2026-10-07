// tabletColumns.js
//
// How many columns the STACKED sheet uses at a given width.
//
// THE PROBLEM
// -----------
// The positioned grid is 16 columns with a 40px floor per cell, so it
// needs about 790px (see narrowScreenNeedsStackedView in simpleView.js).
// Below that the sheet is stacked - every block full width, every field
// full width. On a phone that is the right answer and has been for a
// while: css/phone.css packs a block's fields three to a row and the
// whole thing comes out around 8,000px.
//
// On a portrait tablet it is not. 768px and 834px are past the phone
// ceiling, so none of phone.css's sheet rules apply, and the sheet falls
// back to one field per full-width row: measured at 9,817px and 9,796px -
// about thirteen screens, and worse than the phone it was supposed to be
// better than, because the phone at least packs three fields to a row.
//
// WHY TWO COLUMNS AND NOT THE PHONE'S PACKING
// -------------------------------------------
// Both are needed, and they are different jobs.
//
// With blocks at full width, a block body 720px across packing three
// fields to a row gives each field a third of 720px - which is where
// "Passive Perception" and Notes stop being readable. css/phone.css
// works because a phone's block body is about 120px, so three across is
// 40px each and everything in it is a number.
//
// So: put the BLOCKS two to a row, which makes a block body about the
// width of a phone's, and then the phone's own packing applies to what
// is inside it. The result is a sheet with the phone's density and half
// the phone's height, on a screen with twice the width to spend.
//
// A phone keeps ONE column: at 390px a block two-up is 180px, and a
// three-across field inside that is 60px. Splitting the difference would
// make the phone worse to make the tablet better.
//
// Nothing here writes to the saved layout. `narrowScreenNeedsStackedView`
// decides whether the sheet is stacked at all; this only says how many
// columns the stacked version gets, and it is a class on the DOM.

/** Widths, in CSS pixels, at which the stacked sheet goes two-up.
 *
 *  700 is where a two-up block still has room for the phone's own
 *  three-across field packing: 700 / 2 blocks, less the gap and the page
 *  gutters, leaves about 330px of block body and about 105px per field -
 *  the same shape a phone has, to within a few pixels. Below it the
 *  fields start losing their labels.
 *
 *  1000 is where the positioned grid stops fitting. Above it the sheet is
 *  not stacked at all and this whole question is moot, so the ceiling is
 *  the grid's own threshold rather than a second number to keep in step
 *  with it. */
export const TABLET_TWO_COL_MIN_PX = 700;
export const TABLET_TWO_COL_MAX_PX = 1000;

/** Height at which a wide-but-short window stops being a tablet in
 *  portrait.
 *
 *  This is the same number as SHORT_VIEWPORT_CEILING_PX in simpleView.js
 *  and the same one css/phone.css breaks at, for the same reason: a phone
 *  on its side is 667-932px WIDE, so a width-only band catches it. A
 *  landscape phone is the one case where two columns are least wanted -
 *  it has 390px of height and needs every row of that - and it is the one
 *  case the phone e2e asserts a reading order for, so quietly restyling
 *  it would have been changing a tested layout as a side effect of
 *  fixing a tablet. */
export const TABLET_TWO_COL_MIN_HEIGHT_PX = 481;

/** Class put on the grid (and its scroller) while it is stacked two-up.
 *  CSS keys off this; the JS never writes inline styles for it. */
export const TWO_COL_CLASS = "is-tablet-cols";

/** How many columns the stacked sheet should use.
 *
 *  2 inside the band, 1 outside it, and 1 for an unmeasured width or
 *  height - the same "absence of a measurement reads as the safe answer"
 *  rule narrowScreenNeedsStackedView follows, so a first paint before
 *  layout cannot guess two-up and flicker back. */
export function stackedColumnCount({ availableWidth, viewportHeight } = {}) {
  const px = (value) => {
    if (value === null || value === undefined || value === "") return NaN;
    const n = typeof value === "string" ? parseFloat(value) : Number(value);
    return Number.isFinite(n) ? n : NaN;
  };
  const w = px(availableWidth);
  const h = px(viewportHeight);
  if (!Number.isFinite(w) || w <= 0) return 1;
  // Height only rules things OUT. An unmeasured height is not evidence of
  // a landscape phone, and refusing to go two-up on a missing measurement
  // would leave a tablet in one column on its very first frame. Zero and
  // negative count as unmeasured for the same reason
  // narrowScreenNeedsStackedView treats an available width of 0 as "not
  // narrow": a viewport is never actually zero tall.
  if (Number.isFinite(h) && h > 0 && h < TABLET_TWO_COL_MIN_HEIGHT_PX) return 1;
  return w >= TABLET_TWO_COL_MIN_PX && w <= TABLET_TWO_COL_MAX_PX ? 2 : 1;
}

/** Whether the stacked sheet should be two-up at this width. The shape
 *  every caller actually wants. */
export function usesTwoColumns(fit) {
  return stackedColumnCount(fit) === 2;
}

/** Put the two-up class on `els` when `count` is 2, and take it off when
 *  it is not. Idempotent, and the only DOM write in this module - so the
 *  arithmetic above stays testable without a DOM.
 *
 *  Every element is touched rather than just the first, because the class
 *  is what lets CSS keep the scroller from reintroducing a sideways
 *  scrollbar, and the scroller is a different element from the grid. */
export function applyTwoColumnClass(els, count) {
  const on = count === 2;
  for (const el of els || []) {
    if (!el || !el.classList) continue;
    el.classList.toggle(TWO_COL_CLASS, on);
  }
  return on;
}
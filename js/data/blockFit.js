// blockFit.js
//
// How many grid rows a block actually needs, and how tall it may
// therefore be drawn.
//
// WHY THIS EXISTS
// ---------------
// A block's declared `h` includes ONE reserved row at the top for its
// name (see BLOCK_HEADER_ROWS in blockModel.js) which is not available
// to its children. So the row a child ends on is measured against
// `h - BLOCK_HEADER_ROWS`, not against `h`.
//
// Nothing used to make that subtraction, and five blocks in the starter
// layout were one row short of their own content. The symptom is
// invisible in the data and very visible on screen: `.block-body` is
// `position: absolute; bottom: 0` inside a block whose height is fixed
// in pixels, and it is `overflow: hidden`. A child on the row past the
// bottom is simply not drawn. On the demo sheet that was INT, WIS and
// CHA - the three abilities D&D uses for spellcasting - rendered
// entirely below the Abilities block's own bottom edge.
//
// The gate that should have caught it (verify-content.mjs, "a child's
// box has to actually fit inside its block") compared `y + h` against
// `h` and so agreed with the mistake. Both are fixed here and pinned by
// tests/block-fit.test.mjs.
//
// Pure integer arithmetic over the layout data - no DOM - so both the
// layout and the renderer can use it and the tests can check it.

import { BLOCK_HEADER_ROWS } from "./blockModel.js";

/** The last grid row a block's children occupy, i.e. how many rows of
 *  CONTENT they need. Zero for an empty block.
 *
 *  Only direct children count: a block's grid is one level deep (see
 *  blockModel.js), and a nested block is a child here with its own
 *  `h`, so walking further would double-count. */
export function blockContentRows(block) {
  const children = block?.children || [];
  return children.reduce((max, child) => {
    const bottom = (Number(child?.y) || 0) + (Number(child?.h) || 1);
    return bottom > max ? bottom : max;
  }, 0);
}

/** How many content rows a block may draw into: its declared `h` less
 *  the reserved header row.
 *
 *  Zero when the name has been deleted (see the label toggle in
 *  sheetBlocks.js: deleting a block's name hands the row back to the
 *  body, and the matching `h` change happens in the same commit). */
export function blockUsableRows(block) {
  const headerRows = block?.showLabel === false ? 0 : BLOCK_HEADER_ROWS;
  return Math.max(0, (Number(block?.h) || 0) - headerRows);
}

/** The smallest `h` this block's own content fits in: its header row
 *  plus the rows its children need. */
export function requiredBlockHeight(block) {
  const headerRows = block?.showLabel === false ? 0 : BLOCK_HEADER_ROWS;
  return headerRows + blockContentRows(block);
}

/** The height a block should be DRAWN at: its declared `h`, or the
 *  height its content needs, whichever is more.
 *
 *  This is the half that protects a saved sheet. Correcting the starter
 *  layout fixes every character made from here on, but a sheet saved
 *  before the correction still carries the short `h` in its data, and
 *  the data is the truth for everything downstream - drag bounds, resize
 *  limits, the canvas height. The renderer therefore never draws a
 *  block shorter than its content, rather than trusting the number and
 *  clipping the child.
 *
 *  Growing is the safe direction: an over-tall block overlaps whatever
 *  sits below it, where a too-short one hides a field entirely. */
export function renderedBlockRows(block) {
  return Math.max(Number(block?.h) || 0, requiredBlockHeight(block));
}

/** Whether any child of `block` falls outside the rows it may draw
 *  into. The pure form of the clipping check, used by the content gate
 *  and by the tests; returns the offending children so a failure can
 *  say which field, not just that something was wrong. */
export function childrenOutsideBlock(block) {
  const usable = blockUsableRows(block);
  return (block?.children || []).filter((child) => {
    const y = Number(child?.y) || 0;
    const h = Number(child?.h) || 1;
    return y + h > usable;
  });
}
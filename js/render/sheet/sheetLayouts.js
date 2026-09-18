// sheetLayouts.js
//
// One-click block arrangements ("presets") for the sheet toolbar.
// Presets only move and widen top-level blocks — children, styles,
// and content are untouched, and everything stays undoable through
// the normal commit path. Pure functions over layout arrays.

export const LAYOUT_PRESETS = [
  { id: "single-column", name: "Single Column" },
  { id: "two-column", name: "Two Column" },
  { id: "combat-first", name: "Combat First" },
];

/** Block names floated to the top by the Combat First preset, in
 *  order; anything unlisted keeps its relative order underneath. */
export const COMBAT_FIRST_ORDER = [
  "Combat",
  "Attacks",
  "Spellcasting",
  "Abilities",
  "Saving Throws",
  "Skills",
];

export const PAGE_COLS = 16;

function isFullWidth(node) {
  return node?.blockType === "label";
}

/** Stack blocks in two columns (labels span the full width);
 *  `ordered` is the block array in placement order. Mutates. */
function stackTwoColumn(ordered) {
  const heights = [0, 0];
  const place = (node) => {
    if (isFullWidth(node)) {
      const y = Math.max(heights[0], heights[1]);
      node.x = 0;
      node.w = PAGE_COLS;
      node.y = y;
      heights[0] = y + (node.h || 1);
      heights[1] = heights[0];
      return;
    }
    const col = heights[1] < heights[0] ? 1 : 0;
    node.x = col === 0 ? 0 : PAGE_COLS / 2;
    node.w = PAGE_COLS / 2;
    node.y = heights[col];
    heights[col] += node.h || 1;
  };
  ordered.forEach(place);
  return ordered;
}

/** Rearrange one tab's top-level blocks per preset. Mutates the
 *  passed layout in place and returns it. Unknown ids are a no-op. */
export function applyLayoutPresetTo(layout, presetId) {
  const blocks = (layout || []).filter((n) => n && n.kind !== "field");
  if (!blocks.length) return layout;
  if (presetId === "single-column") {
    let y = 0;
    blocks.forEach((node) => {
      node.x = 0;
      node.w = PAGE_COLS;
      node.y = y;
      y += node.h || 1;
    });
    return layout;
  }
  if (presetId === "two-column") {
    stackTwoColumn(blocks);
    return layout;
  }
  if (presetId === "combat-first") {
    const rank = new Map(COMBAT_FIRST_ORDER.map((name, i) => [name.toLowerCase(), i]));
    const ordered = [...blocks].sort((a, b) => {
      const ra = rank.has(String(a.name || "").toLowerCase()) ? rank.get(String(a.name || "").toLowerCase()) : Infinity;
      const rb = rank.has(String(b.name || "").toLowerCase()) ? rank.get(String(b.name || "").toLowerCase()) : Infinity;
      return ra - rb;
    });
    // Reflect the new order in the layout array itself (tab order
    // follows array order elsewhere, e.g. the Blocks sidebar).
    ordered.forEach((node) => {
      const at = layout.indexOf(node);
      if (at !== -1) layout.splice(at, 1);
    });
    layout.push(...ordered);
    stackTwoColumn(ordered);
    return layout;
  }
  return layout;
}

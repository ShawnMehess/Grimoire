// gridEngine.js
//
// Pure grid math: collision detection and compaction. No DOM access —
// this operates on plain {x,y,w,h} shapes, so it's usable for both the
// page-level grid (top-level blocks) and any block's local grid (its
// children), which is exactly why block/field content is expressed in
// the same cell units at every nesting level.
//
// Compaction strategy: a simple top-down "gravity pack." After any
// move/resize/add/remove, every item is re-settled to the lowest y
// position that doesn't overlap an already-placed item, processed in
// (y, x) order. This is a deliberate v1 simplification — it's a full
// re-pack rather than a minimal-disturbance push, so a small drag can
// occasionally shuffle more items than strictly necessary. It's
// simple enough to trust completely, which matters more here than
// producing the mathematically minimal rearrangement.

export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Mutates each item's `y` (never x or w/h) so nothing overlaps. */
export function compact(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = [];
  sorted.forEach(item => {
    let y = 0;
    while (placed.some(p => rectsOverlap(p, { ...item, y }))) {
      y++;
    }
    item.y = y;
    placed.push(item);
  });
  return sorted;
}

/** Height (in cells) needed to contain every item, for sizing a container. */
export function contentHeight(items) {
  return items.reduce((max, i) => Math.max(max, i.y + i.h), 0);
}

/** Width (in cells) needed to contain every item — used when shrinking a
 *  block to make sure it never gets narrower than its widest child. */
export function contentWidth(items) {
  return items.reduce((max, i) => Math.max(max, i.x + i.w), 0);
}

/** Clamp every item's x/w so nothing extends past `maxW` columns, then
 *  compact. Used when a container is narrowed and its children need to
 *  be pulled back inside the new bounds. */
export function clampToWidth(items, maxW) {
  items.forEach(item => {
    if (item.w > maxW) item.w = maxW;
    if (item.x + item.w > maxW) item.x = Math.max(0, maxW - item.w);
  });
  return compact(items);
}

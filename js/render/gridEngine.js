// gridEngine.js
//
// Pure grid math. No DOM access — this operates on plain {x,y,w,h}
// shapes, usable at any nesting level.
//
// STATUS: rectsOverlap()/compact()/clampToWidth() (collision detection
// and auto-reflow) are currently UNUSED — customSheet.js used to run
// compact() after every drag/resize/add/remove, but that was removed
// by request in favor of fully manual placement: blocks and fields
// can now overlap freely, and nothing repositions them automatically.
// Only contentHeight()/contentWidth() are still called (for sizing the
// canvas and placing new items). Left in rather than deleted in case
// auto-reflow — or something like it (an optional "tidy up" button?)
// — turns out to be wanted again later.
//
// Compaction strategy, if it's ever wired back in: a simple top-down
// "gravity pack." Every item re-settles to the lowest y position that
// doesn't overlap an already-placed item, processed in (y, x) order —
// a full re-pack rather than a minimal-disturbance push, so a small
// drag could shuffle more than strictly necessary. Simple enough to
// trust completely, which mattered more than minimal rearrangement.

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

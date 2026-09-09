// collectionMenuLayout.js
//
// Shared sizing for the "collection menu" floating panels — the
// Catalogs and Bundle Libraries managers. Both are meant to span from
// the page grid's own left edge (leaving the Stat Blocks sidebar
// visible and draggable-from, same reasoning the drag-linking feature
// needs — see catalogLibraryEditor.js) all the way to the screen's
// right/top/bottom edges, with a small buffer against every one of
// those edges, including the sidebar. This is purely a layout concern
// shared between two otherwise-independent editors — it doesn't
// merge their actual content/logic, which stays separate since a
// catalog (archetypes, tabs, drag-linked fields) and a bundle (stat
// modifiers) aren't similar enough underneath to justify one generic
// editor.
//
// top/right/bottom are static (see .modal-box--collection-menu in
// custom-sheet.css) since they're plain fixed offsets from the
// viewport that never need recalculating. Only `left` depends on
// where the sidebar ends, so only that gets recomputed here, and only
// on resize.

export const COLLECTION_MENU_BUFFER = 16;

/**
 * Pins `box` (expected to carry the .modal-box--collection-menu class)
 * to the shared layout described above.
 * @returns a cleanup function — call it when the panel closes to stop
 *          listening for resizes.
 */
export function positionCollectionMenu(box) {
  function reposition() {
    const grid = document.querySelector(".page-grid-scroll");
    box.style.left = grid
      ? `${grid.getBoundingClientRect().left + COLLECTION_MENU_BUFFER}px`
      : `${COLLECTION_MENU_BUFFER}px`;
  }
  reposition();
  window.addEventListener("resize", reposition);
  return () => window.removeEventListener("resize", reposition);
}

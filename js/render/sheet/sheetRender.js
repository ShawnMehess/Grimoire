// sheetRender.js
//
// Main-grid render orchestration migrated from customSheet.js's
// renderPageGrid. The leveling/rules-tab branch stays in the renderer
// (those tab renders migrate separately); everything for the normal
// block grid lives here with explicit deps:
//
//   renderMainGridInto(pageGrid, scrollWrapper, {
//     cw, availableHeight, layout, pageCols, gapPx,
//     contentHeightFn, gridLinesFn, blockNodeFn, growFn,
//     overflowChecks, paintFn, toolbarEls: [groupToolbar, groupBorderOverlay],
//   })

export function gridCanvasSize(layout, cw, gapPx, pageCols, availableHeight, contentHeightFn) {
  return {
    width: `${pageCols * cw + (pageCols - 1) * gapPx}px`,
    // At least tall enough to fill the visible canvas (so there's
    // always room to drag things into open space), taller only if the
    // actual content needs more — in which case it scrolls.
    height: `${Math.max(availableHeight, contentHeightFn(layout) * (cw + gapPx))}px`,
  };
}

export function renderMainGridInto(pageGrid, scrollWrapper, deps) {
  const {
    cw,
    availableHeight,
    layout,
    pageCols,
    gapPx,
    contentHeightFn,
    gridLinesFn,
    blockNodeFn,
    growFn,
    overflowChecks,
    paintFn,
    toolbarEls,
    isEdit,
  } = deps;

  const size = gridCanvasSize(layout, cw, gapPx, pageCols, availableHeight, contentHeightFn);
  // Explicit width so the grid can exceed the wrapper's width (and
  // scroll) once cw hits its floor, rather than being crushed to fit.
  pageGrid.style.width = size.width;
  pageGrid.style.height = size.height;
  gridLinesFn(pageGrid, cw);
  layout.forEach((block) => {
    pageGrid.append(blockNodeFn(block, cw));
  });

  // Every field is now actually in the document and has real layout,
  // so this is the first point where checking a label against its
  // cell means anything. Deliberately not wrapped in
  // commitMutation/persist — this is a fresh, idempotent fit-up of
  // whatever's on screen right now, not a discrete edit worth its own
  // undo step, and it isn't needed for correctness on the next load
  // either: an unpersisted grow just gets recomputed the same way
  // next time this runs.
  overflowChecks.forEach(({ labelEl, field, fieldEl, parentBlock }) => {
    growFn(labelEl, field, fieldEl, parentBlock);
  });

  // Now that every block is actually laid out, re-anchor each one's
  // local body grid to the page grid's phase (see applyGridLines).
  if (isEdit) {
    pageGrid.querySelectorAll(".block-body").forEach((bodyEl) => {
      gridLinesFn(bodyEl, cw, pageGrid);
    });
  }

  paintFn(); // a full render tears down and rebuilds every
    // .grid-node — repaint .is-selected on whichever ones still
    // exist, so selection survives an unrelated edit elsewhere
  pageGrid.append(...toolbarEls); // innerHTML="" above
    // wiped them out along with everything else — they're persistent
    // elements (created once, not per-render), so just put them back
    // rather than rebuild them
}

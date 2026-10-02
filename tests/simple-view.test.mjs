// tests/simple-view.test.mjs
//
// Unit tests for Simple View's node ordering (js/render/sheet/simpleView.js).
//
// The whole mode rests on one claim: the stacked view shows fields in
// their existing row-then-column order. That is NOT DOM order — a layout
// array can list (0,2) before (0,0) — so the order is recomputed from
// each node's grid cell. If that key is wrong, the mode silently shows
// fields in the wrong sequence, which is the one thing it must not do.
//
// Also pinned here: the mode is display-only. It writes a flex `order`
// onto nodes and clears it again, and nothing else.
//
// Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  simpleViewOrder,
  simpleViewOrderFromNode,
  applySimpleViewOrder,
  narrowScreenNeedsStackedView,
  shouldShowIntro,
  INTRO_LINES,
} from "../js/render/sheet/simpleView.js";
import { PAGE_COLS } from "../js/render/sheet/sheetLayouts.js";
import { MIN_CELL_PX, GAP_PX } from "../js/render/sheet/sheetConstants.js";

const nodeAt = (x, y) => ({ dataset: { gridX: String(x), gridY: String(y) }, style: {} });

/** A stand-in for the container, holding nodes in a deliberately
 *  NON-sorted order so the tests fail if anything just trusts DOM order. */
function containerWith(cells) {
  const nodes = cells.map(([x, y]) => nodeAt(x, y));
  return {
    nodes,
    querySelectorAll: () => nodes,
  };
}

describe("simpleViewOrder", () => {
  it("sorts left-to-right within a row", () => {
    assert.ok(simpleViewOrder(0, 0) < simpleViewOrder(1, 0));
    assert.ok(simpleViewOrder(1, 0) < simpleViewOrder(2, 0));
  });

  it("sorts rows top-to-bottom", () => {
    assert.ok(simpleViewOrder(0, 0) < simpleViewOrder(0, 1));
    assert.ok(simpleViewOrder(15, 0) < simpleViewOrder(0, 1), "the last cell of a row still precedes the next row");
  });

  it("keeps row-then-column distinct from column-then-row", () => {
    // (1,0) is to the right of (0,0) and comes after it; (0,1) is below
    // and comes after that. If the key were column-major, (0,1) would
    // sort before (1,0) and every stacked sheet would read down-then-
    // across instead of across-then-down.
    const a = simpleViewOrder(1, 0);
    const b = simpleViewOrder(0, 1);
    assert.ok(a < b, "a cell to the right precedes the cell below it");
  });

  it("gives a block's later row a higher key than its whole first row", () => {
    for (let col = 0; col < PAGE_COLS; col++) {
      assert.ok(simpleViewOrder(col, 0) < simpleViewOrder(0, 1), `col ${col} of row 0`);
    }
  });

  it("is monotonic across the whole grid", () => {
    let previous = -Infinity;
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < PAGE_COLS; x++) {
        const key = simpleViewOrder(x, y);
        assert.ok(key > previous, `(${x},${y}) should follow the previous cell`);
        previous = key;
      }
    }
  });

  it("accepts numeric strings, which is how the DOM carries them", () => {
    assert.equal(simpleViewOrder("2", "1"), simpleViewOrder(2, 1));
  });

  it("treats a missing or nonsensical cell as the origin", () => {
    assert.equal(simpleViewOrder(undefined, undefined), 0);
    assert.equal(simpleViewOrder(NaN, NaN), 0);
    assert.equal(simpleViewOrder(-3, -3), 0, "negative cells clamp to the start");
  });

  it("respects a narrower block's own column count", () => {
    // Inside an 8-wide block, (7,0) must still precede (0,1).
    assert.ok(simpleViewOrder(7, 0, 8) < simpleViewOrder(0, 1, 8));
  });
});

describe("simpleViewOrderFromNode", () => {
  it("reads the stamped cell", () => {
    assert.equal(simpleViewOrderFromNode(nodeAt(3, 2)), simpleViewOrder(3, 2));
  });

  it("returns null for a node with no stamped cell, so it is left alone", () => {
    assert.equal(simpleViewOrderFromNode({ dataset: {} }), null);
    assert.equal(simpleViewOrderFromNode({}), null);
    assert.equal(simpleViewOrderFromNode(null), null);
  });
});

describe("applySimpleViewOrder", () => {
  it("stamps row-then-column keys regardless of DOM order", () => {
    // Deliberately out of order in the DOM: (0,1) listed first.
    const container = containerWith([[0, 1], [0, 0], [1, 0]]);
    applySimpleViewOrder(container, true);
    const keys = container.nodes.map((n) => Number(n.style.order));
    assert.deepEqual(keys, [simpleViewOrder(0, 1), simpleViewOrder(0, 0), simpleViewOrder(1, 0)]);
    // And the sequence they imply is the one a reader expects.
    const sorted = [...container.nodes].sort((a, b) => Number(a.style.order) - Number(b.style.order));
    assert.deepEqual(sorted.map((n) => [n.dataset.gridX, n.dataset.gridY]), [["0", "0"], ["1", "0"], ["0", "1"]]);
  });

  it("writes string values, as the DOM style property requires", () => {
    const container = containerWith([[1, 1]]);
    applySimpleViewOrder(container, true);
    assert.equal(typeof container.nodes[0].style.order, "string");
  });

  it("clears every key again on the way out", () => {
    const container = containerWith([[0, 0], [5, 5]]);
    applySimpleViewOrder(container, true);
    assert.ok(container.nodes.every((n) => n.style.order !== ""));
    applySimpleViewOrder(container, false);
    assert.ok(container.nodes.every((n) => n.style.order === ""), "nothing stale left behind");
  });

  it("leaves an unstamped node alone in both directions", () => {
    const stray = { dataset: {}, style: {} };
    const container = { querySelectorAll: () => [nodeAt(0, 0), stray] };
    applySimpleViewOrder(container, true);
    assert.equal(stray.style.order, undefined, "an unstamped node gets no key rather than order 0");
    applySimpleViewOrder(container, false);
    assert.equal(stray.style.order, "", "and is still cleared harmlessly");
  });

  it("tolerates being handed nothing", () => {
    assert.doesNotThrow(() => applySimpleViewOrder(null, true));
    assert.doesNotThrow(() => applySimpleViewOrder({}, true));
  });
});

// --- Forced stacking below the grid's own minimum width --------------------
//
// The grid is a fixed 16 columns with a floor on how small a cell may get,
// so it has a hard minimum width and no shrinking brings it under a
// phone's. Below that the sheet scrolled sideways for a canvas that was
// mostly empty space beside a real character - which is the report this
// rule answers. The stacked layout is the only readable one there, so it
// is not a preference on that screen.

describe("narrowScreenNeedsStackedView", () => {
  /** The grid's real minimum: 16 columns at the cell floor, plus gaps.
   *  Computed from the shipped constants rather than hard-coded, so this
   *  test starts failing if the floor or the column count moves. */
  const GRID_MIN = PAGE_COLS * MIN_CELL_PX + (PAGE_COLS - 1) * GAP_PX;

  it("forces stacking below the width the grid needs", () => {
    assert.equal(narrowScreenNeedsStackedView({ gridWidth: GRID_MIN, availableWidth: 390 }), true);
    assert.equal(narrowScreenNeedsStackedView({ gridWidth: GRID_MIN, availableWidth: GRID_MIN - 40 }), true);
  });

  it("leaves a screen that fits alone", () => {
    assert.equal(narrowScreenNeedsStackedView({ gridWidth: GRID_MIN, availableWidth: GRID_MIN }), false);
    assert.equal(narrowScreenNeedsStackedView({ gridWidth: 1392, availableWidth: 1440 }), false);
  });

  it("ignores a sub-pixel difference", () => {
    // A rounding wobble must not flip the whole sheet between modes on
    // every resize event.
    assert.equal(narrowScreenNeedsStackedView({ gridWidth: 1392, availableWidth: 1391 }), false);
  });

  it("says no when it has not measured yet", () => {
    // The grid is measured after it is laid out. Guessing "narrow" before
    // that would stack the sheet on every load and flicker back.
    assert.equal(narrowScreenNeedsStackedView(), false);
    assert.equal(narrowScreenNeedsStackedView({}), false);
    assert.equal(narrowScreenNeedsStackedView({ gridWidth: 792 }), false);
    assert.equal(narrowScreenNeedsStackedView({ availableWidth: 390 }), false);
    assert.equal(narrowScreenNeedsStackedView({ gridWidth: 792, availableWidth: 0 }), false);
    assert.equal(narrowScreenNeedsStackedView({ gridWidth: NaN, availableWidth: 390 }), false);
  });

  it("reads strings, because a measured width arrives as one sometimes", () => {
    assert.equal(narrowScreenNeedsStackedView({ gridWidth: "792px", availableWidth: "390px" }), true);
    assert.equal(narrowScreenNeedsStackedView({ gridWidth: "1392px", availableWidth: "1440px" }), false);
  });

  it("is the reason a phone cannot use Sheet View at all", () => {
    // Stated as the arithmetic it is: the narrowest common phone is well
    // under the grid's floor. If this ever goes false, some future change
    // made the grid genuinely narrowable and the whole rule is dead weight.
    assert.ok(GRID_MIN > 320, `the grid cannot fit a 320px phone (min ${GRID_MIN}px)`);
    assert.ok(GRID_MIN < 1440, `but it fits a desktop (min ${GRID_MIN}px)`);
  });
});

// --- First-run orientation panel --------------------------------------------
//
// Two independent reasons this exists. Simple View was not remembered, so it
// was something you had to re-assert every session; and nothing anywhere
// told a new player what the toolbar does or that dragging a block is a
// saved change to their layout.

describe("shouldShowIntro", () => {
  it("shows for a finished character that has never been told", () => {
    assert.equal(shouldShowIntro({ setupComplete: true }), true);
    assert.equal(shouldShowIntro({ setupComplete: true, sawIntro: false }), true);
  });

  it("stays away once dismissed", () => {
    assert.equal(shouldShowIntro({ setupComplete: true, sawIntro: true }), false);
  });

  it("stays away while the creation wizard is still running", () => {
    // The wizard is itself the guided first run. A panel about switching
    // display modes over the top of it is noise about a feature nobody has
    // reached yet.
    assert.equal(shouldShowIntro({ setupComplete: false }), false);
    assert.equal(shouldShowIntro({ setupComplete: false, sawIntro: true }), false);
  });

  it("only ever reads true as seen, so a lost flag means shown, not hidden", () => {
    assert.equal(shouldShowIntro({ setupComplete: true, sawIntro: "yes" }), true);
    assert.equal(shouldShowIntro({ setupComplete: true, sawIntro: 0 }), true);
    assert.equal(shouldShowIntro({ setupComplete: true, sawIntro: null }), true);
  });

  it("treats anything other than exactly true as unfinished", () => {
    // setupComplete is a boolean in the data; a truthy string from a
    // hand-edited save must not unlock the panel for an unfinished wizard.
    assert.equal(shouldShowIntro({ setupComplete: "true" }), false);
    assert.equal(shouldShowIntro({}), false);
  });
});

describe("INTRO_LINES", () => {
  it("says how to fill the sheet in and that saving is automatic", () => {
    assert.ok(INTRO_LINES.some((l) => /click any box to type/i.test(l)), "says the sheet is typeable");
    assert.ok(INTRO_LINES.some((l) => /saves as you go/i.test(l)), "says saving needs no action");
  });

  it("names both views, and warns that moving a block is a real change", () => {
    // The warning is the whole point. A new player's first instinct on
    // seeing drag handles is to move everything, and in Sheet View that is
    // a persisted layout change - so Simple View is offered as the safe way
    // to read a character.
    assert.ok(INTRO_LINES.some((l) => /Simple View/.test(l)), "names Simple View");
    assert.ok(INTRO_LINES.some((l) => /Sheet View/.test(l)), "names Sheet View");
    assert.ok(INTRO_LINES.some((l) => /saved layout|changes your saved layout/i.test(l)),
      "warns that dragging saves");
    assert.ok(INTRO_LINES.some((l) => /display only/i.test(l)),
      "says Simple View cannot break the layout");
  });

  it("says the choice is remembered", () => {
    assert.ok(INTRO_LINES.some((l) => /remember which one you were using/i.test(l)));
  });
});

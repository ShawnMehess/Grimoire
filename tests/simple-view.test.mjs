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
} from "../js/render/sheet/simpleView.js";
import { PAGE_COLS } from "../js/render/sheet/sheetLayouts.js";

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

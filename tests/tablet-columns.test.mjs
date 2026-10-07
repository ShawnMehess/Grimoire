// tests/tablet-columns.test.mjs
//
// Unit tests for js/render/sheet/tabletColumns.js.
//
// The band is the whole decision. Below 700px a two-up block is 180px and
// a three-across field inside it is 60px, which makes the phone worse to
// make a portrait tablet better; above 1000px the positioned grid fits and
// the question does not arise at all. So the numbers are the test, and so
// is the rule that a width nobody measured answers "one column" rather
// than guessing two and flickering back.
//
// Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TABLET_TWO_COL_MIN_PX,
  TABLET_TWO_COL_MAX_PX,
  TABLET_TWO_COL_MIN_HEIGHT_PX,
  TWO_COL_CLASS,
  stackedColumnCount,
  usesTwoColumns,
  applyTwoColumnClass,
} from "../js/render/sheet/tabletColumns.js";

/** A classList stand-in with just enough of the API for the one DOM write
 *  this module makes. Records calls so a test can assert the class was
 *  actually toggled rather than merely computed. */
function fakeEl() {
  const classes = new Set();
  const calls = [];
  return {
    calls,
    classes,
    classList: {
      toggle: (name, on) => {
        calls.push([name, on]);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    },
  };
}

describe("stackedColumnCount", () => {
  it("is two across a portrait tablet", () => {
    // The two widths the review named, plus the middle of the band, all
    // at a tablet's height.
    for (const w of [768, 834, 700, 850, 1000]) {
      assert.equal(stackedColumnCount({ availableWidth: w, viewportHeight: 1024 }), 2, `${w}px should be two-up`);
    }
  });

  it("is one on a phone, in both orientations", () => {
    // Portrait: too narrow. Landscape: too SHORT - which a width-only
    // band cannot see, because a phone on its side is 667-932px wide.
    // It has 390px of height and needs every row of it.
    for (const w of [320, 375, 390, 430, 667]) {
      assert.equal(stackedColumnCount({ availableWidth: w, viewportHeight: 844 }), 1, `${w}px portrait`);
    }
    for (const [w, h] of [[667, 375], [844, 390], [932, 430]]) {
      assert.equal(stackedColumnCount({ availableWidth: w, viewportHeight: h }), 1, `${w}x${h} landscape`);
    }
  });

  it("uses the same short-viewport ceiling as everything else", () => {
    // css/phone.css breaks at max-height 480px and
    // shortViewportNeedsStackedView's SHORT_VIEWPORT_CEILING_PX is 480.
    // One past that, so "not short" means the same thing here as it does
    // everywhere else - and a landscape phone is the case that has to be
    // caught by exactly one of them.
    assert.equal(TABLET_TWO_COL_MIN_HEIGHT_PX, 481);
  });

  it("is one where the positioned grid fits", () => {
    for (const w of [1001, 1200, 1440, 2560]) {
      assert.equal(stackedColumnCount({ availableWidth: w, viewportHeight: 900 }), 1, `${w}px is not stacked at all`);
    }
  });

  it("is exactly the complement of the phone ceiling", () => {
    // css/phone.css owns everything up to 720px, and this band starts at
    // 700. The 20px overlap is deliberate and harmless - a 700-720px
    // window gets phone.css's packing AND two-up, and the two are
    // compatible - but the two numbers must not drift apart silently,
    // because the overlap is where the two files would have to agree.
    assert.equal(TABLET_TWO_COL_MIN_PX, 700);
    assert.equal(TABLET_TWO_COL_MAX_PX, 1000);
  });

  it("reads a CSS length, not just a number", () => {
    // The width comes off `clientWidth`, but the same helper is asked
    // about declared widths elsewhere in the codebase, which arrive as
    // "792px". Number("792px") is NaN, and a NaN here would read as "not
    // measured" and silently leave a tablet one-up.
    assert.equal(stackedColumnCount({ availableWidth: "768px", viewportHeight: "1024px" }), 2);
    assert.equal(stackedColumnCount({ availableWidth: "390px", viewportHeight: "844px" }), 1);
  });

  it("answers one for an unmeasured width rather than guessing", () => {
    // narrowScreenNeedsStackedView has the same rule and the same reason:
    // guessing two-up before the grid has been laid out would paint a
    // two-column sheet on the first frame and flicker back.
    for (const fit of [{}, { availableWidth: 0 }, { availableWidth: -5 },
      { availableWidth: null }, { availableWidth: "wide" }, { availableWidth: NaN }]) {
      assert.equal(stackedColumnCount(fit), 1, JSON.stringify(fit));
    }
  });

  it("only lets an unmeasured HEIGHT through, never an impossible one", () => {
    // Height rules things OUT and only out: a missing height is not
    // evidence of a landscape phone, and refusing to go two-up on it would
    // leave a tablet in one column on its very first frame.
    assert.equal(stackedColumnCount({ availableWidth: 834 }), 2, "no height yet is not a short screen");
    assert.equal(stackedColumnCount({ availableWidth: 834, viewportHeight: null }), 2);
    assert.equal(stackedColumnCount({ availableWidth: 834, viewportHeight: 0 }), 2, "zero is not a viewport");
    assert.equal(stackedColumnCount({ availableWidth: 834, viewportHeight: 390 }), 1);
    assert.equal(stackedColumnCount({ availableWidth: 834, viewportHeight: "390px" }), 1);
  });

  it("has a one-word form, which is what callers actually want", () => {
    assert.equal(usesTwoColumns({ availableWidth: 834, viewportHeight: 1194 }), true);
    assert.equal(usesTwoColumns({ availableWidth: 390, viewportHeight: 844 }), false);
  });
});

describe("applyTwoColumnClass", () => {
  it("puts the class on every element it is given", () => {
    // Both the grid and its scroller: the grid is what lays out in two
    // columns and the scroller is what must stop offering a sideways
    // scrollbar once it has.
    const grid = fakeEl();
    const scroller = fakeEl();
    assert.equal(applyTwoColumnClass([grid, scroller], 2), true);
    assert.ok(grid.classes.has(TWO_COL_CLASS));
    assert.ok(scroller.classes.has(TWO_COL_CLASS));
  });

  it("takes it off again for one column", () => {
    const grid = fakeEl();
    applyTwoColumnClass([grid], 2);
    applyTwoColumnClass([grid], 1);
    assert.equal(grid.classes.has(TWO_COL_CLASS), false);
    assert.deepEqual(grid.calls, [[TWO_COL_CLASS, true], [TWO_COL_CLASS, false]]);
  });

  it("says false when it is switching to one column", () => {
    // The return value is what the caller re-renders on; returning true
    // for "applied the class" and also for "chose two" would make a
    // resize that only changes the column count look like no change.
    assert.equal(applyTwoColumnClass([fakeEl()], 1), false);
  });

  it("skips anything that is not an element", () => {
    // `scrollWrapper` is nullable in this renderer and the elements are
    // built in stages, so a missing one is normal, not exceptional.
    const grid = fakeEl();
    assert.doesNotThrow(() => applyTwoColumnClass([null, undefined, grid], 2));
    assert.ok(grid.classes.has(TWO_COL_CLASS));
    assert.doesNotThrow(() => applyTwoColumnClass(null, 2));
  });
});
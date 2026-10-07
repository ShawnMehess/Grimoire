// tests/roll-popover.test.mjs
//
// Unit tests for the touch d20 popover (js/render/sheet/sheetRollPopover.js).
//
// WHAT IS WORTH TESTING HERE, AND WHY
// -----------------------------------
// The popover exists because an absolutely positioned overlay cannot be
// made not to overlap something when it is wider than the cell it sits
// on: `.field-roll` is ~132px and an ability-score cell is 40-60px. So
// the fix moves it OUT of the cell, which means every interesting
// decision is about WHERE, and none of it is about CSS:
//
//   - does it open at all, and only where it should
//   - does it land below, flip above, or clamp - and always on screen
//   - does it stay clear of the field's own box
//
// The environment gate is the one that must not drift, and it is a single
// condition on purpose. It used to be the complement of css/phone.css's
// sheet media query, which meant two files each holding a copy of the same
// width boundary; they drifted into producing two different layouts on two
// different screens, and only the sheet that used the second one had rows
// that lined up. One condition - can this device hover? - cannot drift
// from anything.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  placeRollPopover,
  shouldUseRollPopover,
  OPEN_FIELD_CLASS,
  POPOVER_CLASS,
} from "../js/render/sheet/sheetRollPopover.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A window stand-in that reports whether the device can hover. */
const win = (noHover) => ({
  matchMedia: (q) => ({ matches: q === "(hover: none)" ? noHover : false }),
});

const rect = (left, top, width, height) => ({
  left, top, width, height,
  right: left + width,
  bottom: top + height,
});

/** A 1024x768 tablet, a field near the top-left, and the pill's real
 *  measured size (3 x 44px targets plus the pill's own padding). */
const VIEWPORT = { width: 1024, height: 768 };
const FIELD = rect(300, 200, 52, 52);
const POP = { width: 140, height: 48 };

describe("shouldUseRollPopover", () => {
  it("opens on anything that cannot hover, at any width", () => {
    // The point of the single condition. A phone, a portrait tablet, a
    // landscape tablet and a touch laptop all get the popover, and none
    // of them has to agree with a stylesheet about where the boundary is.
    for (const w of [320, 390, 768, 834, 1024, 1440]) {
      assert.equal(shouldUseRollPopover(win(true)), true, `${w}px with no hover`);
    }
  });

  it("never opens on a pointer device", () => {
    // The desktop sheet already reveals the pill on hover. Opening a
    // popover there as well would be two ways to do one thing.
    assert.equal(shouldUseRollPopover(win(false)), false);
  });

  it("says no in an environment with no matchMedia at all", () => {
    // Guessing "yes" on a screen that was never measured would open a
    // popover over a desktop sheet. Absence has to read as "no".
    assert.equal(shouldUseRollPopover({}), false);
    assert.equal(shouldUseRollPopover(undefined), false);
  });
});

describe("placeRollPopover", () => {
  it("prefers below the field, so the tapped thing stays put", () => {
    const at = placeRollPopover({ anchor: FIELD, pop: POP, viewport: VIEWPORT });
    assert.equal(at.placement, "below");
    assert.equal(at.top, FIELD.bottom + 6);
  });

  it("never overlaps the field it is anchored to", () => {
    // The whole reason the popover exists. Checked for every field
    // position that matters, not just the happy one.
    const spots = [
      rect(300, 200, 52, 52),    // near the top, room below
      rect(300, 700, 52, 52),    // near the bottom, must flip
      rect(5, 200, 52, 52),      // hard against the left edge
      rect(960, 200, 52, 52),    // hard against the right edge
      rect(300, 20, 52, 52),     // hard against the top
      rect(300, 745, 52, 52),    // the very last pixel row
    ];
    for (const anchor of spots) {
      const at = placeRollPopover({ anchor, pop: POP, viewport: VIEWPORT });
      const below = at.top >= anchor.bottom;
      const above = at.top + POP.height <= anchor.top;
      assert.ok(below || above,
        `popover at ${at.top} overlaps the field at ${anchor.top}-${anchor.bottom}`);
    }
  });

  it("flips above when below would run off the bottom", () => {
    // The common case near the bottom of a long sheet, and where "the
    // control you just opened is off-screen" would otherwise look like
    // the tap did nothing at all.
    const at = placeRollPopover({
      anchor: rect(300, 700, 52, 52), pop: POP, viewport: VIEWPORT,
    });
    assert.equal(at.placement, "above");
    assert.equal(at.top, 700 - 6 - POP.height);
  });

  it("clamps to the bottom edge when NEITHER side fits", () => {
    // A field with room neither below nor above, where the popover still
    // fits the viewport outright. Something visible beats something
    // ideal - but it must still be inside the viewport, which is the
    // part that used to go wrong.
    const at = placeRollPopover({
      anchor: rect(300, 90, 52, 52),
      pop: { width: 140, height: 120 },
      viewport: { width: 1024, height: 200 },
    });
    assert.equal(at.placement, "clamped");
    assert.ok(at.top >= 8, "stays below the top margin");
    assert.equal(at.top + 120, 200 - 8, "and sits hard against the bottom margin");
  });

  it("right-aligns to the field so the middle button lands under it", () => {
    // The plain roll button is pressed most often, so it is the one that
    // should sit under the finger's original target.
    const at = placeRollPopover({ anchor: FIELD, pop: POP, viewport: VIEWPORT });
    assert.equal(at.left + POP.width, FIELD.right);
  });

  it("clamps horizontally at both edges", () => {
    const left = placeRollPopover({
      anchor: rect(2, 200, 52, 52), pop: POP, viewport: VIEWPORT,
    });
    assert.equal(left.left, 8, "a field at the left edge does not push it off screen");
    const right = placeRollPopover({
      anchor: rect(1000, 200, 52, 52), pop: POP, viewport: VIEWPORT,
    });
    assert.ok(right.left + POP.width <= 1024 - 8, "a field at the right edge stays on screen");
  });

  it("never runs off screen for any field position on the page", () => {
    // Exhaustive rather than sampled: the popover is used on every
    // numeric field on the sheet, so "a few spot checks" is not much of
    // a claim.
    for (let x = 0; x <= VIEWPORT.width; x += 17) {
      for (let y = 0; y <= VIEWPORT.height; y += 17) {
        const at = placeRollPopover({
          anchor: rect(x, y, 52, 52), pop: POP, viewport: VIEWPORT,
        });
        assert.ok(at.left >= 0, `left ${at.left} at x=${x} y=${y}`);
        assert.ok(at.left + POP.width <= VIEWPORT.width, `right overflow at x=${x} y=${y}`);
        assert.ok(at.top >= 0, `top ${at.top} at x=${x} y=${y}`);
        assert.ok(at.top + POP.height <= VIEWPORT.height, `bottom overflow at x=${x} y=${y}`);
      }
    }
  });

  it("survives a missing measurement instead of throwing", () => {
    // The popover is placed from getBoundingClientRect on a node that
    // may have just been re-rendered out from under it. A throw here
    // would take down the pointerdown handler that was about to close it.
    const at = placeRollPopover({});
    assert.deepEqual(at, { left: 0, top: 0, placement: "below" });
  });
});

describe("the popover CSS agrees with the JS", () => {
  const css = readFileSync(join(ROOT, "css", "components", "touch-roll-popover.css"), "utf8");
  const stacked = readFileSync(join(ROOT, "css", "components", "stacked-roll-fields.css"), "utf8");

  it("is imported after phone.css, so it can supersede the phone's own pill", () => {
    const main = readFileSync(join(ROOT, "css", "main.css"), "utf8");
    const phoneAt = main.indexOf('@import url("phone.css")');
    const popAt = main.indexOf('@import url("components/touch-roll-popover.css")');
    assert.ok(phoneAt !== -1 && popAt !== -1, "both are imported");
    assert.ok(popAt > phoneAt, "the popover comes last");
  });

  it("hides the pill by default, on hover alone", () => {
    // `display: none` rather than `visibility` or opacity: it also takes
    // the three buttons out of the tab order, and an invisible control
    // that is still focusable is worse than no control at all.
    assert.ok(/@media \(hover: none\)\s*\{[\s\S]*\.grid-node--field > \.field-roll\s*\{\s*display: none;/.test(css),
      "hidden under (hover: none), with no width range to drift from");
  });

  it("has no width of its own to keep in step with phone.css", () => {
    // The regression this replaced: two files, two copies of the same
    // boundary, two different layouts. If a min-width or max-width turns
    // up in this file's only media query, the split is back.
    const query = css.match(/@media \(hover: none\)\s*\{/);
    assert.ok(query, "there is still a hover:none block");
    const block = css.slice(query.index, css.indexOf("}", css.indexOf("position: relative")));
    assert.ok(!/min-width|max-width:\s*7|max-width:\s*10/.test(block),
      "the hover:none block carries no width range");
  });

  it("keeps the 44px touch targets", () => {
    // These are the buttons pressed to roll. The base rule already sets
    // min-block-size: 44px; this is the restatement that stops a future
    // edit to the pill quietly shrinking the only place touch happens.
    assert.ok(/\.roll-popover \.field-roll__btn\s*\{[^}]*min-height: 44px/.test(css));
  });

  it("is position: fixed, which is what escapes the block's overflow clip", () => {
    // `.block-body` is `overflow: hidden`, and the anchor is inside it.
    // An absolutely positioned popover would be clipped by the block's
    // own edge - the same clipping that hid the ability scores.
    assert.ok(/\.roll-popover\s*\{[^}]*position: fixed/.test(css));
  });

  it("uses the same class names the JS stamps", () => {
    assert.ok(css.includes(`.${POPOVER_CLASS}`), POPOVER_CLASS);
    assert.ok(css.includes(`.grid-node--field.${OPEN_FIELD_CLASS}`), OPEN_FIELD_CLASS);
  });

  it("cannot reach paper", () => {
    // print.css hides the pill; the element that carries it needs the
    // same protection or a printed sheet grows a floating dice bar.
    assert.ok(/@media print\s*\{[^}]*\.roll-popover\s*\{[^}]*display: none/.test(css));
  });

  it("gives a dice field ONE cell of a packed row", () => {
    // The other half of the fix, and the half that makes the rows line
    // up: a two-column rollable field in a three-column row wraps, and a
    // dense grid then pulls everything after it up into the gap.
    assert.ok(/\.page-grid\.is-simple \.grid-node--field:has\(> \.field-roll\)\s*\{\s*grid-column: span 1;/.test(stacked));
    // ...and the abilities block keeps its own two-column pair.
    assert.ok(/\.block-body:has\(> \.grid-node--field\[data-node-id="strScore"\]\)[\s\S]*grid-column: auto;/.test(stacked));
  });
});
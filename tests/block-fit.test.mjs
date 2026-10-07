// tests/block-fit.test.mjs
//
// Unit tests for js/data/blockFit.js and, through it, for the starter
// layout's block heights.
//
// THE BUG THIS PINS
// -----------------
// A block's `h` reserves one row for its name (BLOCK_HEADER_ROWS) that
// its children cannot use, and `.block-body` is `overflow: hidden` inside
// a block whose height is a fixed pixel box. So a child one row past the
// usable area is not "a bit tight" - it is not drawn at all.
//
// Five blocks in the starter layout were exactly that short, which is why
// INT, WIS and CHA (the three abilities spellcasting depends on) were
// invisible on the demo sheet, and why the Inspiration toggle and the
// Notes line were missing too. The layout numbers are asserted here
// directly so the correction cannot quietly regress, and the arithmetic
// is asserted on its own so a future block cannot make the same mistake
// by accident.
//
// Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createStarterLayout, BLOCK_HEADER_ROWS } from "../js/data/blockModel.js";
import {
  blockContentRows,
  blockUsableRows,
  requiredBlockHeight,
  renderedBlockRows,
  childrenOutsideBlock,
} from "../js/data/blockFit.js";

const block = (h, children, extra = {}) => ({
  kind: "block", blockType: "stat", name: "B", x: 0, y: 0, w: 4, h, children, ...extra,
});
const field = (y, h = 1) => ({ kind: "field", fieldType: "text", label: "f", x: 0, y, w: 1, h });

describe("blockContentRows", () => {
  it("is the last row a child ends on", () => {
    assert.equal(blockContentRows(block(3, [field(0), field(1), field(2)])), 3);
  });

  it("counts a tall child's height, not just its row", () => {
    // A textlist at row 1 that is four rows tall ends on row 5.
    assert.equal(blockContentRows(block(6, [field(0), field(1, 4)])), 5);
  });

  it("is 0 for a block with no children", () => {
    assert.equal(blockContentRows(block(4, [])), 0);
    assert.equal(blockContentRows(block(4, null)), 0);
    assert.equal(blockContentRows(null), 0);
  });

  it("ignores a missing y or h rather than going to NaN", () => {
    // Saved data from before a property existed has neither. NaN here
    // would make Math.max return NaN and every downstream comparison
    // quietly answer "no", which is how a clip gets shipped.
    assert.equal(blockContentRows(block(4, [{ kind: "field" }, { kind: "field", y: 2 }])), 3);
  });
});

describe("requiredBlockHeight", () => {
  it("is the header row plus the content rows", () => {
    assert.equal(BLOCK_HEADER_ROWS, 1);
    assert.equal(requiredBlockHeight(block(2, [field(0), field(1)])), 3);
  });

  it("is the bug, stated as an equation: h 2 with two rows of children needs 3", () => {
    // This is the Abilities block exactly - three abilities per row in a
    // six-column block, so two rows of children, declared h: 2.
    const abilities = block(2, [field(0), field(0), field(1), field(1)]);
    assert.equal(requiredBlockHeight(abilities), 3);
    assert.ok(requiredBlockHeight(abilities) > abilities.h);
  });

  it("hands the reserved row back when the name has been deleted", () => {
    // The label toggle changes both showLabel and h in one commit, so a
    // block with no name needs no header row.
    assert.equal(requiredBlockHeight(block(2, [field(0), field(1)], { showLabel: false })), 2);
  });
});

describe("blockUsableRows and childrenOutsideBlock", () => {
  it("subtracts the reserved header row", () => {
    assert.equal(blockUsableRows(block(5, [])), 4);
    assert.equal(blockUsableRows(block(5, [], { showLabel: false })), 5);
  });

  it("names the children that fall outside", () => {
    // A field ending exactly ON the last usable row fits: rows are
    // half-open, so `y + h <= usable` is inside.
    assert.deepEqual(childrenOutsideBlock(block(3, [field(0), field(1)])), []);
    // One row short: row 0 still fits, row 1 does not. That asymmetry is
    // the whole shape of the bug - it took the bottom row away and left
    // the top one looking fine.
    assert.equal(childrenOutsideBlock(block(2, [field(0), field(1)])).length, 1);
  });

  it("is what the content gate is built on", () => {
    // The gate used to compare against `h` and so agreed with the
    // off-by-one. Compare both ways and show only the corrected one is
    // load-bearing.
    const abilities = block(2, [field(0), field(1)]);
    const loose = [field(0), field(1)].filter((f) => f.y + f.h > abilities.h);
    assert.deepEqual(loose, [], "the old check passed - which is why it shipped");
    assert.equal(childrenOutsideBlock(abilities).length, 1, "the corrected check does not");
  });
});

describe("renderedBlockRows", () => {
  it("never draws a block shorter than its content", () => {
    // The half that protects an ALREADY SAVED sheet, whose short `h` is
    // still what the drag bounds and canvas height are derived from.
    assert.equal(renderedBlockRows(block(2, [field(0), field(1)])), 3);
  });

  it("leaves a generous h alone", () => {
    assert.equal(renderedBlockRows(block(9, [field(0), field(1)])), 9);
  });
});

describe("the starter layout", () => {
  const layout = createStarterLayout();
  const byName = new Map(layout.map((b) => [b.name, b]));

  it("fits every child inside its block", () => {
    // The regression itself. Every block, every child, at every width -
    // this is pure data, so there is nothing viewport-dependent about it.
    for (const b of layout) {
      const stray = childrenOutsideBlock(b);
      assert.deepEqual(stray.map((f) => `${f.label || f.id}@${f.y}+${f.h}`), [],
        `${b.name}: these children fall outside its ${blockUsableRows(b)} usable rows`);
    }
  });

  it("has no block whose content is taller than its declared h", () => {
    for (const b of layout) {
      assert.ok(b.h >= requiredBlockHeight(b),
        `${b.name}: h ${b.h} is shorter than the ${requiredBlockHeight(b)} its content needs`);
    }
  });

  it("gives the Abilities block both rows of abilities", () => {
    // Three abilities per row in a six-column block means two content
    // rows; with the name row that is h: 3. At h: 2 the whole second row
    // - INT, WIS, CHA - was drawn below the block's bottom edge.
    const abilities = byName.get("Abilities");
    assert.equal(abilities.h, 3);
    const rows = new Set(abilities.children.map((f) => f.y));
    assert.deepEqual([...rows].sort(), [0, 1], "abilities occupy two content rows");
  });

  it("does not clip the Identity block's Inspiration row", () => {
    const identity = byName.get("Identity");
    const inspiration = identity.children.find((f) => f.id === "inspiration");
    assert.ok(inspiration, "the Inspiration toggle exists");
    assert.ok(inspiration.y + inspiration.h <= identity.h - BLOCK_HEADER_ROWS,
      "and it is inside the rows Identity may draw into");
  });

  it("does not clip the Story block's Notes line", () => {
    // Notes is the very last row of the sheet; when it was clipped, the
    // bottom of the sheet simply ended in nothing.
    const story = byName.get("Story");
    const notes = story.children.find((f) => f.label === "Notes");
    assert.ok(notes && notes.y + notes.h <= story.h - BLOCK_HEADER_ROWS);
  });

  it("ends all three columns on the same row", () => {
    // The sheet is printed and a ragged bottom edge shows. Three columns
    // of different content heights reach the same bottom only if the gaps
    // between blocks are chosen deliberately - which they now are (see
    // the column math in createStarterLayout).
    const bottoms = new Map();
    for (const b of layout) {
      const key = `${b.x}/${b.w}`;
      bottoms.set(key, Math.max(bottoms.get(key) ?? 0, b.y + b.h));
    }
    const ends = [...bottoms.values()];
    assert.equal(new Set(ends).size, 1,
      `jagged sheet columns: ${[...bottoms.entries()].map(([k, v]) => `${k} -> ${v}`).join(", ")}`);
  });

  it("has no two blocks overlapping in the same column", () => {
    const columns = new Map();
    for (const b of layout) {
      const key = `${b.x}/${b.w}`;
      if (!columns.has(key)) columns.set(key, []);
      columns.get(key).push(b);
    }
    for (const [key, blocks] of columns) {
      const sorted = [...blocks].sort((a, b) => a.y - b.y);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        assert.ok(cur.y >= prev.y + prev.h,
          `${key}: ${cur.name} starts at y${cur.y}, inside ${prev.name} (y${prev.y}+h${prev.h})`);
      }
    }
  });

  it("keeps every child inside its block horizontally too", () => {
    // The same rule on the other axis. A radio's width comes from its
    // option count (syncOptionWidth) rather than the w it was handed, so
    // only fields whose width was not overridden are checked here.
    for (const b of layout) {
      for (const f of b.children) {
        if (f.fieldType === "radio" || f.fieldType === "checkbox") continue;
        assert.ok(f.x + f.w <= b.w,
          `${b.name}: ${f.label || f.id} runs to column ${f.x + f.w} of a ${b.w}-wide block`);
      }
    }
  });
});
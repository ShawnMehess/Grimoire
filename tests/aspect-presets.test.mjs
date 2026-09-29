// tests/aspect-presets.test.mjs
//
// Unit tests for aspect-ratio presets and per-preset layout variants
// (js/render/sheet/aspectPresets.js).
//
// Two properties matter more than the rest: detection must never
// auto-apply anything (the spec is explicit about that, and reflowing a
// sheet behind the user's back is destructive), and a layout the user has
// already adjusted must come back when they revisit that preset rather
// than being re-guessed.
//
// Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ASPECT_PRESETS,
  DEFAULT_ASPECT_PRESET_ID,
  aspectPresetById,
  nearestAspectPreset,
  viewportRatio,
  detectAspectPreset,
  presetCols,
  reflowLayoutToCols,
  applyAspectPresetTo,
  layoutVariantsFor,
  stashedLayoutFor,
  stashLayoutVariant,
  clearLayoutVariant,
  switchTabToPreset,
} from "../js/render/sheet/aspectPresets.js";
import { PAGE_COLS } from "../js/render/sheet/sheetLayouts.js";

const block = (name, h = 1) => ({ id: `b-${name}`, kind: "block", blockType: "stat", name, x: 0, y: 0, w: 4, h });

describe("preset table", () => {
  it("covers every shape the spec names", () => {
    const ids = ASPECT_PRESETS.map((p) => p.id);
    for (const want of ["16:9", "16:10", "4:3", "phone-portrait", "phone-landscape", "tablet-portrait", "tablet-landscape"]) {
      assert.ok(ids.includes(want), `missing preset ${want}`);
    }
  });

  it("gives every preset a positive ratio and a sane grid shape", () => {
    for (const p of ASPECT_PRESETS) {
      assert.ok(p.ratio > 0, `${p.id} ratio`);
      assert.ok(p.cols >= 1 && p.cols <= PAGE_COLS, `${p.id} cols ${p.cols} outside 1..${PAGE_COLS}`);
      assert.ok(p.rows >= 1, `${p.id} rows`);
    }
  });

  it("has portrait shapes below 1 and landscape shapes above 1", () => {
    const portrait = ASPECT_PRESETS.filter((p) => p.id.includes("portrait"));
    const landscape = ASPECT_PRESETS.filter((p) => p.id.includes("landscape"));
    assert.ok(portrait.every((p) => p.ratio < 1), "portrait ratios should be < 1");
    assert.ok(landscape.every((p) => p.ratio > 1), "landscape ratios should be > 1");
  });

  it("looks up by id and returns null for an unknown one", () => {
    assert.equal(aspectPresetById("16:9").id, "16:9");
    assert.equal(aspectPresetById("nope"), null);
  });

  it("has a default that exists", () => {
    assert.ok(aspectPresetById(DEFAULT_ASPECT_PRESET_ID), "default preset id must resolve");
  });
});

describe("nearestAspectPreset", () => {
  it("matches a 16:9 viewport to 16:9", () => {
    assert.equal(nearestAspectPreset(16 / 9).id, "16:9");
  });

  it("matches a tall phone viewport to phone portrait", () => {
    assert.equal(nearestAspectPreset(9 / 19.5).id, "phone-portrait");
  });

  it("matches a wide phone viewport to phone landscape, not tablet", () => {
    // 19.5/9 is ~2.17; the two phone orientations sit far apart in
    // ratio, so a portrait phone must not be treated as a near
    // neighbour of a landscape one.
    assert.equal(nearestAspectPreset(19.5 / 9).id, "phone-landscape");
  });

  it("picks the closest of two near-ties rather than the first listed", () => {
    // 4:3 and tablet-landscape share a ratio, so either is correct; a
    // viewport just off 4:3 should still land on one of them.
    const hit = nearestAspectPreset(1.34);
    assert.ok(["4:3", "tablet-landscape"].includes(hit.id), `got ${hit.id}`);
  });

  it("returns null for a ratio it can't use", () => {
    assert.equal(nearestAspectPreset(0), null);
    assert.equal(nearestAspectPreset(-1), null);
    assert.equal(nearestAspectPreset(NaN), null);
    assert.equal(nearestAspectPreset("wide"), null);
  });
});

describe("viewportRatio", () => {
  it("divides width by height", () => {
    assert.equal(viewportRatio({ innerWidth: 1600, innerHeight: 900 }), 1600 / 900);
  });

  it("returns null for a zero-sized (hidden) viewport", () => {
    assert.equal(viewportRatio({ innerWidth: 0, innerHeight: 0 }), null);
  });

  it("returns null when the window has no dimensions yet", () => {
    assert.equal(viewportRatio({}), null);
  });

  it("detects a preset from a window", () => {
    const win = { innerWidth: 1440, innerHeight: 900 };
    assert.equal(detectAspectPreset(win).id, "16:10");
  });

  it("offers nothing rather than guessing when the viewport is unmeasurable", () => {
    assert.equal(detectAspectPreset({ innerWidth: 0, innerHeight: 0 }), null);
  });
});

describe("presetCols", () => {
  it("clamps a corrupt stored value into range", () => {
    assert.equal(presetCols({ cols: 999 }), PAGE_COLS);
    assert.equal(presetCols({ cols: 0 }), 1);
    assert.equal(presetCols({ cols: -4 }), 1);
    assert.equal(presetCols({}), PAGE_COLS, "missing cols falls back to the full grid");
  });
});

describe("reflowLayoutToCols", () => {
  it("stacks blocks down a single column at full width", () => {
    const layout = [block("A", 2), block("B", 1)];
    reflowLayoutToCols(layout, 1);
    assert.deepEqual(layout.map((b) => [b.x, b.y, b.w]), [[0, 0, PAGE_COLS], [0, 2, PAGE_COLS]]);
  });

  it("splits into two even columns", () => {
    const layout = [block("A", 1), block("B", 1), block("C", 1), block("D", 1)];
    reflowLayoutToCols(layout, 2);
    const half = PAGE_COLS / 2;
    assert.deepEqual(layout.map((b) => [b.x, b.y, b.w]), [[0, 0, half], [half, 0, half], [0, 1, half], [half, 1, half]]);
  });

  it("balances columns by height, not by count", () => {
    // A tall first block should push the next one to the other column
    // rather than letting column 0 run to the bottom.
    const layout = [block("Tall", 4), block("B", 1), block("C", 1)];
    reflowLayoutToCols(layout, 2);
    assert.equal(layout[1].x, PAGE_COLS / 2, "second block should start the right column");
  });

  it("never drops a block or reorders them", () => {
    const layout = [block("A"), block("B"), block("C")];
    reflowLayoutToCols(layout, 3);
    assert.deepEqual(layout.map((b) => b.name), ["A", "B", "C"]);
  });

  it("keeps a label block full width and pushes both columns down", () => {
    const layout = [block("A", 1), { ...block("HDR"), blockType: "label" }, block("B", 1)];
    reflowLayoutToCols(layout, 2);
    const hdr = layout[1];
    assert.equal(hdr.w, PAGE_COLS, "a label spans the grid");
    assert.equal(layout[2].y, 2, "content below the label starts after it");
  });

  it("widens instead of leaving empty columns when there are fewer blocks than columns", () => {
    const layout = [block("Only")];
    reflowLayoutToCols(layout, 4);
    assert.equal(layout[0].w, PAGE_COLS, "a lone block should be full width, not a quarter");
  });

  it("ignores stray field nodes at the top level", () => {
    // A field at the top level isn't a block, so it's neither repositioned
    // nor dropped from the array — this reflow only moves blocks.
    const stray = { id: "stray", kind: "field", fieldType: "text", x: 7, y: 9, w: 2, h: 1 };
    const layout = [stray, block("A")];
    reflowLayoutToCols(layout, 1);
    assert.equal(stray.x, 7, "the stray field is left untouched");
    assert.equal(stray.y, 9);
    assert.equal(layout.length, 2, "and is not dropped from the layout");
  });

  it("tolerates an empty layout", () => {
    assert.deepEqual(reflowLayoutToCols([], 2), []);
    assert.equal(reflowLayoutToCols(null, 2), null);
  });
});

describe("applyAspectPresetTo", () => {
  it("reflows to the preset's column count", () => {
    const layout = [block("A"), block("B"), block("C"), block("D")];
    applyAspectPresetTo(layout, "tablet-portrait");
    const w = layout[0].w;
    assert.ok(w < PAGE_COLS, "tablet portrait should use fewer columns than the full grid");
    assert.equal(layout[0].w, layout[1].w, "all blocks share the column width");
  });

  it("is a no-op for an unknown preset", () => {
    const layout = [block("A", 3)];
    applyAspectPresetTo(layout, "not-a-preset");
    assert.deepEqual([layout[0].x, layout[0].y, layout[0].w], [0, 0, 4], "unchanged");
  });
});

describe("layout variants", () => {
  const makeChar = () => ({
    sheetTabs: [
      { id: "t1", name: "Main", layout: [block("A", 1), block("B", 1)] },
      { id: "t2", name: "Combat", layout: [block("X", 1)] },
    ],
  });

  it("reads an absent map as empty rather than throwing", () => {
    assert.deepEqual(layoutVariantsFor({}), { layouts: {}, tabs: {} });
    assert.deepEqual(layoutVariantsFor(null), { layouts: {}, tabs: {} });
  });

  it("ignores a corrupt map", () => {
    assert.deepEqual(layoutVariantsFor({ aspectLayouts: "nope" }), { layouts: {}, tabs: {} });
    assert.deepEqual(layoutVariantsFor({ aspectLayouts: [] }), { layouts: {}, tabs: {} });
  });

  it("has nothing stashed to begin with", () => {
    assert.equal(stashedLayoutFor(makeChar(), "16:9", "t1"), null);
  });

  it("remembers a tab's layout under its preset", () => {
    const c = makeChar();
    stashLayoutVariant(c, "16:9", "t1");
    const stashed = stashedLayoutFor(c, "16:9", "t1");
    assert.equal(stashed.length, 2);
    assert.deepEqual(stashed.map((b) => b.name), ["A", "B"]);
  });

  it("keeps presets and tabs apart from each other", () => {
    const c = makeChar();
    stashLayoutVariant(c, "16:9", "t1");
    assert.equal(stashedLayoutFor(c, "4:3", "t1"), null, "another preset has no variant");
    assert.equal(stashedLayoutFor(c, "16:9", "t2"), null, "another tab has no variant");
  });

  it("deep-copies, so later drags don't rewrite the snapshot", () => {
    const c = makeChar();
    stashLayoutVariant(c, "16:9", "t1");
    c.sheetTabs[0].layout[0].x = 13;
    assert.equal(stashedLayoutFor(c, "16:9", "t1")[0].x, 0, "snapshot must not follow live edits");
  });

  it("ignores an unknown tab or preset", () => {
    const c = makeChar();
    stashLayoutVariant(c, "16:9", "nope");
    stashLayoutVariant(c, null, "t1");
    assert.equal(stashedLayoutFor(c, "16:9", "nope"), null);
  });

  it("clears one tab's variant without touching the rest", () => {
    const c = makeChar();
    stashLayoutVariant(c, "16:9", "t1");
    stashLayoutVariant(c, "16:9", "t2");
    clearLayoutVariant(c, "16:9", "t1");
    assert.equal(stashedLayoutFor(c, "16:9", "t1"), null);
    assert.ok(stashedLayoutFor(c, "16:9", "t2"), "the other tab's variant survives");
  });

  it("clears a whole preset when no tab is named", () => {
    const c = makeChar();
    stashLayoutVariant(c, "16:9", "t1");
    stashLayoutVariant(c, "16:9", "t2");
    clearLayoutVariant(c, "16:9");
    assert.equal(stashedLayoutFor(c, "16:9", "t1"), null);
    assert.equal(stashedLayoutFor(c, "16:9", "t2"), null);
  });

  it("round-trips a user's arrangement: stash, reflow away, restore", () => {
    // The point of the whole mechanism — switching preset and coming back
    // must give the user their own layout back, not a fresh guess.
    const c = makeChar();
    // The user hand-arranges tab 1 into two uneven columns.
    const custom = [
      { ...block("A", 2), x: 0, y: 0, w: 5 },
      { ...block("B", 1), x: 5, y: 0, w: 3 },
      { ...block("C", 1), x: 5, y: 1, w: 3 },
    ];
    c.sheetTabs[0].layout = custom;
    stashLayoutVariant(c, "16:9", "t1");

    // Switch to another preset — the live layout is re-guessed.
    c.sheetTabs[0].layout = [block("A"), block("B"), block("C")];
    applyAspectPresetTo(c.sheetTabs[0].layout, "tablet-portrait");
    assert.notDeepEqual(c.sheetTabs[0].layout, custom);

    // Come back to 16:9 and restore.
    const restored = stashedLayoutFor(c, "16:9", "t1");
    assert.deepEqual(restored.map((b) => [b.x, b.y, b.w]), [[0, 0, 5], [5, 0, 3], [5, 1, 3]]);
  });
});

describe("switchTabToPreset", () => {
  const makeChar = () => ({
    sheetTabs: [{ id: "t1", name: "Main", layout: [block("A"), block("B")] }],
  });

  it("reflows a shape the user has never visited", () => {
    const c = makeChar();
    const tab = c.sheetTabs[0];
    const outcome = switchTabToPreset(c, tab, "tablet-portrait");
    assert.equal(outcome, "reflowed");
    assert.equal(tab.aspectPresetId, "tablet-portrait");
  });

  it("is a no-op for an unknown preset or a missing tab", () => {
    const c = makeChar();
    assert.equal(switchTabToPreset(c, c.sheetTabs[0], "nope"), "noop");
    assert.equal(switchTabToPreset(c, null, "16:9"), "noop");
  });

  it("restores rather than re-guessing when the user comes back", () => {
    // The behaviour the spec actually asks for, end to end through the
    // public entry point rather than by poking the stash directly.
    const c = makeChar();
    const tab = c.sheetTabs[0];

    switchTabToPreset(c, tab, "16:9");
    // The user then rearranges by hand.
    const handArranged = [
      { ...block("A"), x: 1, y: 4, w: 6 },
      { ...block("B"), x: 9, y: 2, w: 7 },
    ];
    tab.layout = handArranged;
    // The reflow mutates the live layout in place, so keep a detached
    // copy of what the user built to compare against afterwards.
    const handArrangedSnapshot = JSON.parse(JSON.stringify(handArranged));

    // They go somewhere else, then come back.
    assert.equal(switchTabToPreset(c, tab, "tablet-portrait"), "reflowed");
    assert.notDeepEqual(tab.layout, handArrangedSnapshot, "leaving really does reflow");

    assert.equal(switchTabToPreset(c, tab, "16:9"), "restored");
    assert.deepEqual(tab.layout.map((b) => [b.x, b.y, b.w]), [[1, 4, 6], [9, 2, 7]]);
  });

  it("restores a deep copy, so editing the restored layout doesn't corrupt the snapshot", () => {
    const c = makeChar();
    const tab = c.sheetTabs[0];
    switchTabToPreset(c, tab, "16:9");
    tab.layout[0].x = 3;
    switchTabToPreset(c, tab, "tablet-portrait");
    switchTabToPreset(c, tab, "16:9");
    assert.equal(tab.layout[0].x, 3, "the user's own edit is what comes back");
  });

  it("force re-flows over a hand-arranged shape", () => {
    const c = makeChar();
    const tab = c.sheetTabs[0];
    switchTabToPreset(c, tab, "16:9");
    tab.layout = [{ ...block("A"), x: 2, y: 7, w: 5 }];
    switchTabToPreset(c, tab, "tablet-portrait");
    assert.equal(switchTabToPreset(c, tab, "16:9", { force: true }), "reflowed");
    assert.notDeepEqual(tab.layout.map((b) => b.x), [2], "the hand arrangement is replaced");
  });

  it("keeps per-tab variants independent", () => {
    const c = {
      sheetTabs: [
        { id: "t1", layout: [block("A")] },
        { id: "t2", layout: [block("B")] },
      ],
    };
    switchTabToPreset(c, c.sheetTabs[0], "16:9");
    // Only tab 1 is hand-arranged.
    c.sheetTabs[0].layout = [{ ...block("A"), x: 5, y: 5, w: 5 }];
    // It leaves 16:9 for 4:3, stashing the hand arrangement on the way.
    assert.equal(switchTabToPreset(c, c.sheetTabs[0], "4:3"), "reflowed");
    // Tab 2 has never been on 4:3, so it gets a fresh guess.
    assert.equal(switchTabToPreset(c, c.sheetTabs[1], "4:3"), "reflowed");
    // Coming back to 16:9 finds the hand arrangement waiting (it was
    // stashed on the way out), so it restores rather than re-guessing.
    assert.equal(switchTabToPreset(c, c.sheetTabs[0], "16:9"), "restored");
    assert.deepEqual(c.sheetTabs[0].layout.map((b) => [b.x, b.y, b.w]), [[5, 5, 5]]);
    // And 4:3 has its own snapshot for this tab now, so that restores too.
    assert.equal(switchTabToPreset(c, c.sheetTabs[0], "4:3"), "restored");
  });

  it("re-flows when the same preset is picked twice in a row", () => {
    // The select clears itself after each choice, so re-picking the
    // preset you're already on is a deliberate "re-flow this" — it
    // should not be mistaken for a request to restore.
    const c = makeChar();
    const tab = c.sheetTabs[0];
    switchTabToPreset(c, tab, "16:9");
    tab.layout = [{ ...block("A"), x: 3, y: 3, w: 4 }];
    assert.equal(switchTabToPreset(c, tab, "16:9"), "reflowed");
  });
});

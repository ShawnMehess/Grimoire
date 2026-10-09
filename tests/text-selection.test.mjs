// tests/text-selection.test.mjs
//
// Prose is selectable everywhere (css/base.css), which means the app has to
// cope with a drag that selects text landing on something clickable. These
// cover the predicate that decides it, plus the stylesheet rules the
// relaxation depends on.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { selectionCoversText } from "../js/render/sheet/sheetSelection.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = readFileSync(join(ROOT, "css", "base.css"), "utf8");
const grid = readFileSync(join(ROOT, "css", "components", "custom-sheet-grid.css"), "utf8");

/** A window whose getSelection() answers with the given fake selection. */
const withSelection = (sel) => ({ getSelection: () => sel });

/** A node stub that claims to contain the nodes it is handed. */
const node = (...contains) => ({ contains: (n) => contains.includes(n) });

const anchor = { id: "anchor" };
const focus = { id: "focus" };

describe("selectionCoversText", () => {
  it("is true for a real selection inside the node", () => {
    assert.equal(selectionCoversText(node(anchor, focus), withSelection({
      isCollapsed: false, anchorNode: anchor, focusNode: focus, toString: () => "Darkvision",
    })), true);
  });

  it("is false for a collapsed selection - an ordinary click", () => {
    assert.equal(selectionCoversText(node(anchor, focus), withSelection({
      isCollapsed: true, anchorNode: anchor, focusNode: focus, toString: () => "",
    })), false);
  });

  it("is false when the selection is whitespace only", () => {
    // A drag that ends in the gap between two words can leave a range the
    // browser calls uncollapsed with nothing in it.
    assert.equal(selectionCoversText(node(anchor, focus), withSelection({
      isCollapsed: false, anchorNode: anchor, focusNode: focus, toString: () => "  \n ",
    })), false);
  });

  it("is false when the selection is somewhere else on the page", () => {
    const elsewhere = { id: "elsewhere" };
    assert.equal(selectionCoversText(node(anchor), withSelection({
      isCollapsed: false, anchorNode: elsewhere, focusNode: anchor, toString: () => "Race",
    })), false);
    assert.equal(selectionCoversText(node(anchor), withSelection({
      isCollapsed: false, anchorNode: anchor, focusNode: elsewhere, toString: () => "Race",
    })), false);
  });

  it("is false where there is no selection to ask about", () => {
    // Every stub-DOM harness in scripts/ has no getSelection. A missing
    // answer must read as "plain click", or the whole row click path dies
    // off-browser.
    assert.equal(selectionCoversText(node(anchor, focus), {}), false);
    assert.equal(selectionCoversText(node(anchor, focus), null), false);
    assert.equal(selectionCoversText(null, withSelection({
      isCollapsed: false, anchorNode: anchor, focusNode: focus, toString: () => "x",
    })), false);
  });
});

describe("the stylesheet lets text be selected", () => {
  it("no longer opts the whole page out", () => {
    const bodyBlock = base.match(/\nbody \{([^}]*)\}/)[1];
    assert.ok(!/user-select:\s*none/.test(bodyBlock),
      "body must not set user-select: none - that is what this change removed");
    assert.ok(/user-select:\s*text/.test(bodyBlock), "and text is selectable instead");
  });

  it("keeps the interactive chrome out of the selection", () => {
    // The controls themselves, so dragging across a button does not leave a
    // blue smear on the thing you were reaching for...
    const chrome = base.match(/button,\s*\nsummary,\s*\noption,\s*\n\.drag-handle,\s*\n\.resize-handle \{([^}]*)\}/);
    assert.ok(chrome, "the chrome rule exists");
    assert.ok(/user-select:\s*none/.test(chrome[1]), "and opts out of selection");
    // ...but NOT labels, which here wrap a radio and a sentence of rules text.
    assert.ok(!/^label/m.test(chrome[0].split("{")[0]), "labels stay selectable");
  });

  it("keeps a reorder-drag from selecting the row it drags", () => {
    assert.ok(/\.textlist-item\[draggable="true"\] \{[^}]*user-select:\s*none/.test(grid),
      "draggable list rows opt out; a borrowed (non-draggable) row does not");
  });

  it("gives editable text its own cursor back", () => {
    const editable = base.match(/input\[type="text"\][^{]*\{([^}]*)\}/)[1];
    assert.ok(/cursor:\s*text/.test(editable) && /user-select:\s*text/.test(editable));
  });
});
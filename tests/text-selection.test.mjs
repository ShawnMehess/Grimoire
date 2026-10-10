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
const targets = readFileSync(join(ROOT, "css", "components", "a11y-targets.css"), "utf8");

/** A window whose getSelection() answers with the given fake selection. */const withSelection = (sel) => ({ getSelection: () => sel });

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

/* The touch floors. a11y-targets.css is the one file that owns them, and
   the numbers are the point: 24px is the desktop minimum, 32-44 is the
   coarse band. A rule that is deleted from here is a control that quietly
   goes back to being unpressed. */
describe("interactive targets clear their floor", () => {
  it("gives the wizard's step pills a height, not just a line of text", () => {
    // The pills are drawn as 2px of padding around a text-xs line: 21px
    // tall, under the 24px floor, and on a tablet or a desktop they are the
    // only way to jump between steps (the phone's step dropdown is off).
    const dot = targets.match(/\n\.wizard__dot \{([^}]*)\}/);
    assert.ok(dot, "a11y-targets.css no longer sizes .wizard__dot");
    assert.match(dot[1], /min-height:\s*24px/, `expected a 24px floor, got: ${dot[1]}`);
    const coarse = targets.match(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/);
    assert.ok(coarse, "the coarse-pointer band is gone");
    assert.match(coarse[1], /\.wizard__dot \{([^}]*)\}/, "the band no longer carries the pills");
    assert.match(coarse[1], /min-height:\s*32px/);
  });

  it("gives the wizard's in-sentence dropdowns a height too", () => {
    // 1px of padding above and below, so they read as sentence text - which
    // measured 23px, one under the floor, on the controls a player answers a
    // language or an ability increase with. The floor, not the touch band:
    // a 44px box inside a sentence turns the sentence into a stack.
    const base = targets.match(/\n\.inline-pick-select \{([^}]*)\}/);
    assert.ok(base, "a11y-targets.css no longer sizes .inline-pick-select");
    assert.match(base[1], /min-height:\s*24px/);
    const coarse = targets.match(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/)[1];
    assert.match(coarse, /\.inline-pick-select \{([^}]*)\}/, "the coarse band no longer carries the dropdowns");
    assert.match(coarse, /min-height:\s*32px/);
    // And the rule that made them 23px must still be what sizes them at
    // rest: the floor lives on top of it, it does not replace it.
    const wizard = readFileSync(join(ROOT, "css", "components", "custom-sheet-wizard.css"), "utf8");
    assert.match(wizard, /\.mechanics-pick \.inline-pick-select \{[^}]*padding-top:\s*1px/,
      "the in-sentence dropdown lost the compact padding that makes it read as text");
  });

  it("keeps the character sheet's dropdowns over the floor, without stealing the phone's 44", () => {    // The reading column's 1.3em floor left the sheet's own dropdowns 23px
    // tall at 721px and up. The floor that fixes it lives beside the rule it
    // overrides (custom-sheet-grid.css) rather than in a11y-targets.css, and
    // that placement is the assertion: a selector specific enough to beat the
    // 1.3em also ties with phone.css's 44px rule, and being in a file imported
    // later it would silently win it - which measured 26px on a phone.
    const grid = readFileSync(join(ROOT, "css", "components", "custom-sheet-grid.css"), "utf8");
    const simple = grid.match(/\.page-grid\.is-simple:not\(\.page-grid--leveling\) \.field-value \{\s*height: auto;\s*min-height: 1\.3em;\s*\}/);
    assert.ok(simple, "the reading column's 1.3em floor is gone - the 23px may have moved, not been fixed");
    const floor = grid.match(/\.page-grid\.is-simple:not\(\.page-grid--leveling\) \.field-value--dropdown \{([^}]*)\}/);
    assert.ok(floor, "custom-sheet-grid.css no longer floors the sheet's dropdowns");
    assert.match(floor[1], /min-height:\s*24px/);
    // And it must NOT be in a11y-targets.css, which is imported after
    // phone.css and would beat the phone's 44px band.
    assert.doesNotMatch(targets, /field-value--dropdown/,
      "the sheet floor moved back to a11y-targets.css, where it overrides phone.css's 44px");
  });

  it("gives the shared choice dialog's rows and buttons the floor", () => {
    // Every picker in the app funnels through this dialog - skills, spells,
    // feats, tools, fighting styles, and the starting-gear weapon pickers -
    // and a row is `var(--space-2)` of padding around one line, which
    // measured 40px, with Accept/Cancel at 38px: both under the floor at
    // every width including a phone's, on the control a player taps to
    // choose. Safe to floor here in a way the sheet's dropdowns were not:
    // nothing in phone.css names either selector, so there is no band to
    // out-specify.
    const row = targets.match(/\n\.choice-dialog-option \{([^}]*)\}/);
    assert.ok(row, "a11y-targets.css no longer sizes .choice-dialog-option");
    assert.match(row[1], /min-height:\s*44px/);
    const actions = targets.match(/\n\.modal-actions \.btn \{([^}]*)\}/);
    assert.ok(actions, "a11y-targets.css no longer sizes .modal-actions .btn");
    assert.match(actions[1], /min-height:\s*44px/);
  });
});
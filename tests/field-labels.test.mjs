// tests/field-labels.test.mjs
//
// Unit tests for multi-line field labels (js/render/sheet/sheetFields.js).
// A contenteditable div stores a hard line break as a <br>, which
// textContent reads as nothing — so without explicit conversion a second
// line would silently run into the first the moment it saved. These tests
// pin that round trip, since the bug is invisible in a single-line label.
//
// Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { labelTextFromEl, labelElToText } from "../js/render/sheet/sheetFields.js";

/** Minimal stand-in for the bits of Element these two read/write. */
function fakeEl(innerHTML) {
  return { innerHTML };
}

describe("labelElToText", () => {
  it("passes a single-line label through as plain text", () => {
    assert.equal(labelElToText("Strength"), "Strength");
  });

  it("turns newlines into hard breaks", () => {
    assert.equal(labelElToText("Melee\nAttack"), "Melee<br>Attack");
  });

  it("handles more than two lines", () => {
    assert.equal(labelElToText("a\nb\nc"), "a<br>b<br>c");
  });

  it("keeps a blank line", () => {
    assert.equal(labelElToText("a\n\nb"), "a<br><br>b");
  });

  it("treats a missing label as empty", () => {
    assert.equal(labelElToText(""), "");
    assert.equal(labelElToText(null), "");
    assert.equal(labelElToText(undefined), "");
  });

  it("escapes markup so a label can never inject a tag", () => {
    // A label is user text, not HTML — "<b>" must survive as literal
    // characters rather than becoming a bold element.
    assert.equal(labelElToText("<b>"), "&lt;b&gt;");
    assert.equal(labelElToText("a & b"), "a &amp; b");
  });
});

describe("labelTextFromEl", () => {
  it("reads a single-line label unchanged", () => {
    assert.equal(labelTextFromEl(fakeEl("Strength")), "Strength");
  });

  it("recovers newlines from hard breaks", () => {
    assert.equal(labelTextFromEl(fakeEl("Melee<br>Attack")), "Melee\nAttack");
  });

  it("accepts a self-closing break tag", () => {
    assert.equal(labelTextFromEl(fakeEl("Melee<br />Attack")), "Melee\nAttack");
  });

  it("recovers newlines from wrapping divs/p too", () => {
    // Some browsers split a contenteditable line with a block element
    // rather than a <br> when Enter is not intercepted.
    assert.equal(labelTextFromEl(fakeEl("a</div><div>b")), "a\nb");
    assert.equal(labelTextFromEl(fakeEl("a</p><p>b")), "a\nb");
  });

  it("decodes the entities the browser escapes on input", () => {
    assert.equal(labelTextFromEl(fakeEl("a &amp; b")), "a & b");
    assert.equal(labelTextFromEl(fakeEl("&lt;tag&gt;")), "<tag>");
    assert.equal(labelTextFromEl(fakeEl("&quot;q&quot;")), '"q"');
    assert.equal(labelTextFromEl(fakeEl("a&nbsp;b")), "a b");
  });

  it("tolerates an element with no content", () => {
    assert.equal(labelTextFromEl(fakeEl("")), "");
  });
});

describe("label round trip", () => {
  // The property that actually matters: what a user types comes back out
  // unchanged, so a multi-line label survives a save/reload cycle.
  // A trailing newline is excluded — both directions drop it (a
  // contenteditable always leaves a trailing <br> artifact, and a
  // trailing empty line shows nothing), which is covered separately below.
  const cases = [
    "Strength",
    "Melee\nAttack",
    "Spell\nSave\nDC",
    "Leading\nnewline",
    "a\n\nb",
    "Punctuation: & < > \"q\"",
    "Unicode: éè 漢字",
  ];
  for (const text of cases) {
    it(`preserves ${JSON.stringify(text)}`, () => {
      assert.equal(labelTextFromEl(fakeEl(labelElToText(text))), text);
    });
  }

  it("normalizes a trailing newline away rather than keeping a phantom line", () => {
    assert.equal(labelTextFromEl(fakeEl(labelElToText("Trailing\n"))), "Trailing");
  });
});

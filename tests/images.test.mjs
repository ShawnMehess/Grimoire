// tests/images.test.mjs
//
// Unit tests for the character-image layer's pure core
// (js/state/characterImages.js): data-URL detection and the document
// slot walk for inline Base64 images.
// Run: node --test tests/

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isDataUrlImage,
  forEachStoredImage,
} from "../js/state/characterImages.js";

function sampleDoc() {
  return {
    layout: [{
      kind: "block",
      style: { bgImage: "https://cdn/bg.jpg" },
      children: [
        { kind: "field", fieldType: "picture", label: "Portrait", imageData: "data:image/jpeg;base64,AA" },
        { kind: "field", fieldType: "picture", label: "Empty", imageData: null },
        { kind: "field", fieldType: "text", label: "Name", value: "N" },
      ],
    }],
    sheetTabs: [{
      layout: [{
        kind: "block",
        style: {},
        styleOverrides: { bgImage: "data:image/png;base64,BB" },
        children: [],
      }],
    }],
  };
}

describe("image values", () => {
  it("recognizes inline data URLs", () => {
    assert.equal(isDataUrlImage("data:image/png;base64,xx"), true);
    assert.equal(isDataUrlImage("data:image/svg+xml;base64,xx"), true);
    assert.equal(isDataUrlImage("https://cdn/x.jpg"), false);
    assert.equal(isDataUrlImage(null), false);
    assert.equal(isDataUrlImage(undefined), false);
  });
});

describe("stored-image slot walk", () => {
  it("visits pictures and backgrounds across tabs", () => {
    const slots = [];
    forEachStoredImage(sampleDoc(), (slot) => slots.push({ kind: slot.kind, ...slot.get() }));
    assert.equal(slots.length, 4);
    assert.deepEqual(slots.map((s) => s.kind), ["background", "picture", "picture", "background"]);
    assert.equal(slots.filter((s) => isDataUrlImage(s.data)).length, 2);
  });

  it("no refs for inline Base64 images", () => {
    const slots = [];
    forEachStoredImage(sampleDoc(), (slot) => slots.push(slot.get()));
    // All refs should be undefined/absent since we don't use Storage refs
    slots.forEach((s) => assert.equal(s.ref, undefined));
  });

  it("migrates data URLs to hosted urls in place", () => {
    const doc = sampleDoc();
    let migrated = 0;
    forEachStoredImage(doc, (slot) => {
      if (isDataUrlImage(slot.get().data)) {
        slot.set("https://cdn/x.jpg");
        migrated++;
      }
    });
    assert.equal(migrated, 2);
    let remaining = 0;
    forEachStoredImage(doc, (slot) => {
      if (isDataUrlImage(slot.get().data)) remaining++;
    });
    assert.equal(remaining, 0);
  });

  it("visits background refs with no image data", () => {
    const doc = { layout: [{ kind: "block", style: {}, styleOverrides: { bgImageRef: "characterImages/abc/old.jpg" }, children: [] }] };
    const slots = [];
    forEachStoredImage(doc, (slot) => slots.push(slot.get()));
    assert.equal(slots.length, 1);
    assert.equal(slots[0].data, null);
    // Legacy refs are still visited for migration purposes
    assert.equal(slots[0].ref, "characterImages/abc/old.jpg");
  });

  it("tolerates missing and empty documents", () => {
    assert.doesNotThrow(() => forEachStoredImage(null, () => { throw new Error("must not run"); }));
    assert.doesNotThrow(() => forEachStoredImage({}, () => { throw new Error("must not run"); }));
    assert.doesNotThrow(() => forEachStoredImage({ layout: null, sheetTabs: null }, () => { throw new Error("must not run"); }));
  });
});
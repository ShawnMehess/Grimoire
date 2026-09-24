// tests/images.test.mjs
//
// Unit tests for the character-image layer's pure core
// (js/state/characterImages.js): data-URL detection, Storage paths,
// and the document slot walk the Storage migration runs on.
// Run: node --test tests/

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isDataUrlImage,
  storagePrefixFor,
  storagePathFor,
  forEachStoredImage,
} from "../js/state/characterImages.js";

function sampleDoc() {
  return {
    layout: [{
      kind: "block",
      style: { bgImage: "https://cdn/bg.jpg", bgImageRef: "characterImages/abc/bg.jpg" },
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

describe("image values and paths", () => {
  it("recognizes inline data URLs", () => {
    assert.equal(isDataUrlImage("data:image/png;base64,xx"), true);
    assert.equal(isDataUrlImage("data:image/svg+xml;base64,xx"), true);
    assert.equal(isDataUrlImage("https://cdn/x.jpg"), false);
    assert.equal(isDataUrlImage("storage:characterImages/a/b.jpg"), false);
    assert.equal(isDataUrlImage(null), false);
    assert.equal(isDataUrlImage(undefined), false);
  });

  it("builds safe, extension-keeping Storage paths", () => {
    assert.equal(storagePrefixFor("abc"), "characterImages/abc");
    assert.equal(storagePrefixFor("a/b?c"), "characterImages/abc");
    assert.equal(storagePathFor("abc", "data:image/png;base64,xx", () => "n1"), "characterImages/abc/n1.png");
    assert.equal(storagePathFor("abc", "data:image/jpeg;base64,xx", () => "n1"), "characterImages/abc/n1.jpeg");
    assert.equal(storagePathFor("abc", "https://x/y.jpg", () => "n3"), "characterImages/abc/n3.jpeg");
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

  it("keeps refs alongside urls", () => {
    const slots = [];
    forEachStoredImage(sampleDoc(), (slot) => slots.push(slot.get()));
    assert.equal(slots[0].ref, "characterImages/abc/bg.jpg");
    assert.equal(slots[1].ref, null);
  });

  it("migrates data URLs to hosted urls in place", () => {
    const doc = sampleDoc();
    let migrated = 0;
    forEachStoredImage(doc, (slot) => {
      if (isDataUrlImage(slot.get().data)) {
        slot.set("https://cdn/x.jpg", "characterImages/abc/x.jpg");
        migrated++;
      }
    });
    assert.equal(migrated, 2);
    let remaining = 0;
    const refs = [];
    forEachStoredImage(doc, (slot) => {
      if (isDataUrlImage(slot.get().data)) remaining++;
      if (slot.get().ref) refs.push(slot.get().ref);
    });
    assert.equal(remaining, 0);
    assert.equal(refs.length, 3);
  });

  it("tolerates missing and empty documents", () => {
    assert.doesNotThrow(() => forEachStoredImage(null, () => { throw new Error("must not run"); }));
    assert.doesNotThrow(() => forEachStoredImage({}, () => { throw new Error("must not run"); }));
    assert.doesNotThrow(() => forEachStoredImage({ layout: null, sheetTabs: null }, () => { throw new Error("must not run"); }));
  });
});

// tests/linked-sheet.test.mjs
//
// Unit tests for linked-sheet tabs (js/render/sheet/linkedSheet.js).
//
// Two properties are load-bearing and worth pinning hard here:
//
//  - The tab must never resolve to a character the user doesn't own.
//    Ownership isn't a separate check; it falls out of resolution only
//    going through the owner's own (server-filtered) character list, so
//    "not-owned" has to be a distinct, reportable state rather than an
//    empty pane.
//  - A half-configured link (no character, no fields, junk fields) must
//    degrade to something usable rather than a blank pane.
//
// Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LINKED_DISPLAY_FIELDS,
  LINKED_FIELD_IDS,
  DEFAULT_LINKED_FIELDS,
  isLinkedSheetTab,
  linkedTabConfig,
  linkedSheetStatus,
  linkedFieldValue,
  linkedSheetRows,
  linkedSheetMessage,
} from "../js/render/sheet/linkedSheet.js";

describe("isLinkedSheetTab", () => {
  it("recognizes the spec's shape", () => {
    assert.equal(isLinkedSheetTab({ type: "linkedSheet", characterId: "x" }), true);
  });

  it("leaves every other tab alone", () => {
    // In particular the existing `kind` values must keep meaning what
    // they mean - `type` is this feature's own field.
    for (const kind of ["main", "rules", "leveling"]) {
      assert.equal(isLinkedSheetTab({ id: "t", kind, layout: [] }), false);
    }
    assert.equal(isLinkedSheetTab({ id: "t", layout: [] }), false);
    assert.equal(isLinkedSheetTab(null), false);
  });
});

describe("linkedTabConfig", () => {
  it("returns null for a tab that isn't a linked sheet", () => {
    assert.equal(linkedTabConfig({ kind: "main" }), null);
    assert.equal(linkedTabConfig(null), null);
  });

  it("reads the spec's fields", () => {
    const config = linkedTabConfig({ type: "linkedSheet", characterId: "abc", displayFields: ["name", "speed"] });
    assert.equal(config.characterId, "abc");
    assert.deepEqual(config.displayFields, ["name", "speed"]);
  });

  it("trims a pasted id", () => {
    assert.equal(linkedTabConfig({ type: "linkedSheet", characterId: "  abc  " }).characterId, "abc");
  });

  it("treats a blank id as unset rather than as a real one", () => {
    assert.equal(linkedTabConfig({ type: "linkedSheet", characterId: "   " }).characterId, null);
    assert.equal(linkedTabConfig({ type: "linkedSheet" }).characterId, null);
  });

  it("drops field ids it doesn't recognise", () => {
    const config = linkedTabConfig({ type: "linkedSheet", displayFields: ["name", "nonsense", "speed"] });
    assert.deepEqual(config.displayFields, ["name", "speed"]);
  });

  it("falls back to a default set when nothing usable is configured", () => {
    // A half-filled picker is far likelier than a request for a blank pane.
    for (const displayFields of [[], undefined, ["nonsense"], null, "name"]) {
      const config = linkedTabConfig({ type: "linkedSheet", characterId: "abc", displayFields });
      assert.deepEqual(config.displayFields, DEFAULT_LINKED_FIELDS);
    }
  });

  it("keeps the raw request so the UI can show what was actually asked for", () => {
    const config = linkedTabConfig({ type: "linkedSheet", displayFields: ["name", "nope"] });
    assert.deepEqual(config.requestedFields, ["name", "nope"]);
  });

  it("tolerates a link to itself existing in the data", () => {
    // Normalization shouldn't try to be clever here; status reports it.
    const config = linkedTabConfig({ type: "linkedSheet", characterId: "me" });
    assert.equal(config.characterId, "me");
  });
});

describe("linkedSheetStatus", () => {
  const owned = ["a", "b"];
  const opts = { ownedIds: owned, selfId: "me" };

  it("reports an unconfigured link", () => {
    assert.equal(linkedSheetStatus({ characterId: null }, opts), "unset");
  });

  it("reports a link to the host character", () => {
    assert.equal(linkedSheetStatus({ characterId: "me" }, opts), "self");
  });

  it("reports a character the user doesn't own", () => {
    // This is the case that must never quietly render someone else's
    // sheet: it resolves to nothing, and says so.
    assert.equal(linkedSheetStatus({ characterId: "someone-else" }, opts), "not-owned");
  });

  it("reports a good link", () => {
    assert.equal(linkedSheetStatus({ characterId: "a" }, opts), "ok");
  });

  it("does not mistake a missing selfId for a self-link", () => {
    assert.equal(linkedSheetStatus({ characterId: "a" }, { ownedIds: owned }), "ok");
  });
});

describe("linkedFieldValue / linkedSheetRows", () => {
  const character = { name: "Shadow", rules: { speed: "40 ft." } };
  const fieldById = (id) => (id === "speed" ? { value: "45 ft." } : null);
  const fieldByLabel = (id) => (id === "speed" ? { value: "30 ft." } : null);

  it("prefers a field found by id over one found by label", () => {
    assert.equal(linkedFieldValue(character, "speed", { fieldById, fieldByLabel }), "45 ft.");
  });

  it("falls back to the label lookup", () => {
    assert.equal(linkedFieldValue(character, "speed", { fieldByLabel }), "30 ft.");
  });

  it("returns null when nothing has a value", () => {
    assert.equal(linkedFieldValue(character, "armorClass", { fieldById, fieldByLabel }), null);
  });

  it("treats an empty or whitespace value as absent", () => {
    assert.equal(linkedFieldValue(character, "x", { fieldById: () => ({ value: "   " }) }), null);
  });

  it("builds rows only for fields that have a value", () => {
    const rows = linkedSheetRows(character, ["name", "speed", "armorClass"], { fieldById });
    assert.deepEqual(rows.map((r) => r.id), ["name", "speed"]);
    assert.deepEqual(rows[0], { id: "name", label: "Name", value: "Shadow" });
  });

  it("orders rows by the field table, not by the order they were requested", () => {
    // A reader wants them in a sensible order however the link was set up.
    const rows = linkedSheetRows(character, ["speed", "name"], { fieldById });
    assert.deepEqual(rows.map((r) => r.id), ["name", "speed"]);
  });

  it("returns nothing rather than blank rows for an unfilled sheet", () => {
    assert.deepEqual(linkedSheetRows({}, ["name", "speed"]), []);
    assert.deepEqual(linkedSheetRows(null, ["name"]), []);
  });

  it("ignores a requested field that isn't in the table", () => {
    assert.deepEqual(linkedSheetRows(character, ["nonsense"]), []);
  });
});

describe("linkedSheetMessage", () => {
  it("says something actionable for every unresolved state", () => {
    for (const status of ["unset", "self", "not-owned", "missing"]) {
      const message = linkedSheetMessage(status, { characterId: "x" });
      assert.ok(message.length > 10, `${status} should explain itself`);
    }
  });

  it("says nothing when the link is fine", () => {
    assert.equal(linkedSheetMessage("ok", { characterId: "x" }), "");
  });
});

describe("the field table", () => {
  it("has unique ids and non-empty labels", () => {
    assert.equal(new Set(LINKED_FIELD_IDS).size, LINKED_FIELD_IDS.length);
    assert.ok(LINKED_DISPLAY_FIELDS.every((f) => f.label && f.id));
  });

  it("only defaults to fields that exist in the table", () => {
    for (const id of DEFAULT_LINKED_FIELDS) {
      assert.ok(LINKED_FIELD_IDS.includes(id), `default field ${id} exists`);
    }
  });
});

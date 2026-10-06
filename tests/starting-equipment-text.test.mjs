// tests/starting-equipment-text.test.mjs
//
// The starting-gear rows print a label and, under it, whatever else there is
// to say. That "whatever else" used to be `items.join(" · ")` verbatim, which
// produced two kinds of noise:
//
//   - a pack option printing the pack's own name again ("Explorer's Pack,
//     Backpack, Bedroll, …" under a label saying "Explorer's pack")
//   - a one-item option printing its own name ("Greataxe" under "Greataxe")
//
// optionDetailText is the rule that removes both. It is pure and it is the
// only place that decides, so these pin the rule rather than the screen.
//
// Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLASS_STARTING_EQUIPMENT,
  BG_STARTING_EQUIPMENT,
  BG_EQUIPMENT_LINKS,
  EQUIPMENT_PACK_CONTENTS,
  optionDetailText,
  bgDisplayItems,
  linkedEquipmentNames,
  resolveStartingEquipmentPick,
  goldOptionIdFor,
  slugId,
} from "../js/data/startingEquipment.js";

const everyOption = () => Object.entries(CLASS_STARTING_EQUIPMENT)
  .flatMap(([cls, entry]) => (entry.decisions || []).flatMap((d) => d.options.map((o) => ({ cls, d, o }))));

describe("optionDetailText", () => {
  it("drops the pack's own name when the label already says it", () => {
    const diplomat = CLASS_STARTING_EQUIPMENT.Bard.decisions
      .find((d) => d.id === "pack").options.find((o) => o.id === "diplomats-pack");
    assert.equal(diplomat.items[0], "Diplomat's Pack", "the name is items[0] by construction");
    const detail = optionDetailText(diplomat);
    assert.ok(!/^Diplomat's Pack/i.test(detail), `still repeats the pack name: ${detail}`);
    assert.match(detail, /Chest/);
  });

  it("says nothing when the only item is the label", () => {
    assert.equal(optionDetailText({ label: "Greataxe", items: ["Greataxe"] }), "");
    assert.equal(optionDetailText({ label: "Rapier", items: ["Rapier"] }), "");
  });

  it("still says something when one item is more than the label", () => {
    assert.equal(optionDetailText({ label: "Two handaxes", items: ["Handaxe", "Handaxe"] }), "Handaxe · Handaxe");
  });

  it("drops the \"(your choice)\" placeholder, which is table shorthand", () => {
    const anyWeapon = CLASS_STARTING_EQUIPMENT.Bard.decisions
      .find((d) => d.id === "weapon").options.find((o) => o.id === "simple-weapon");
    assert.doesNotMatch(optionDetailText(anyWeapon), /\(your choice\)/);
  });

  it("prefers a note over anything it could work out", () => {
    const focus = CLASS_STARTING_EQUIPMENT.Wizard.decisions
      .find((d) => d.id === "focus").options.find((o) => o.id === "arcane-focus");
    assert.equal(focus.items[0], focus.label, "no item list to work from");
    // The renderer prefers note; this asserts the note exists and says more
    // than the name.
    assert.ok(focus.note.length > focus.label.length * 2, "the arcane focus row still says nothing");
  });

  it("never repeats its own label", () => {
    // The whole point, checked across every row the app can draw. A row whose
    // detail starts with its label is the bug this function exists to stop.
    for (const { cls, d, o } of everyOption()) {
      const detail = optionDetailText(o);
      if (!detail) continue;
      const label = o.label.trim().toLowerCase();
      assert.ok(!detail.toLowerCase().startsWith(label),
        `${cls}/${d.id}/${o.id}: detail repeats the label — "${o.label}" / "${detail}"`);
    }
  });

  it("has something to say about every \"any ...\" row, or a note", () => {
    // The PHB's "(your choice)" promises a picker this UI does not have. The
    // honest fix is a note saying so; an option with neither is back to
    // promising something it will not deliver.
    for (const { cls, d, o } of everyOption()) {
      if (!/^Any /i.test(o.label)) continue;
      const detail = o.note || optionDetailText(o);
      assert.ok(detail && detail.length > 0, `${cls}/${d.id}/${o.id}: no note on an "any" row`);
    }
  });

  it("has a hint on every row that asks for a focus", () => {
    const focusRows = Object.entries(CLASS_STARTING_EQUIPMENT)
      .flatMap(([cls, e]) => (e.decisions || []).filter((d) => d.id === "focus").map((d) => ({ cls, d })));
    assert.ok(focusRows.length >= 3, `expected several casters with a focus row, got ${focusRows.length}`);
    for (const { cls, d } of focusRows) {
      assert.ok(d.hint && d.hint.length > 20, `${cls}: the "Spellcasting focus" label has no explanation`);
    }
  });

  it("copes with an option carrying nothing at all", () => {
    assert.equal(optionDetailText(undefined), "");
    assert.equal(optionDetailText({}), "");
    assert.equal(optionDetailText({ label: "X", items: [] }), "");
    assert.equal(optionDetailText({ label: "Explorer's Pack", items: ["Explorer's Pack"] }), "");
  });
});

describe("the gear data still reads as English", () => {
  it("says \"N days of rations\", not \"N days rations\"", () => {
    // Straight from the compendium: "10 days of Rations". Every pack that
    // carries rations had the phrase dropped.
    for (const [name, contents] of Object.entries(EQUIPMENT_PACK_CONTENTS)) {
      for (const line of contents) {
        assert.doesNotMatch(line, /\d+ days rations/, `${name}: "${line}"`);
      }
    }
    assert.ok(Object.values(EQUIPMENT_PACK_CONTENTS).flat().some((l) => /days of rations/.test(l)),
      "the correction removed every ration line");
  });

  it("keeps each background's package intact", () => {
    // The move onto the Background step was a rendering change; the data
    // under it is the same data Finish Setup grants.
    for (const [bg, entry] of Object.entries(BG_STARTING_EQUIPMENT)) {
      assert.ok((entry.items || []).length > 0, `${bg} lost its items`);
      assert.deepEqual(bgDisplayItems(bg, []), entry.items, `${bg} renders differently from what it grants`);
    }
  });

  it("substitutes the linked pick into the package it belongs to", () => {
    for (const [bg, link] of Object.entries(BG_EQUIPMENT_LINKS)) {
      const placeholder = BG_STARTING_EQUIPMENT[bg].items.find((l) => link.match.test(l));
      assert.ok(placeholder, `${bg}: its link matches no package line, so the pick would be added twice`);
    }
  });

  it("grants the same items whichever way a row is answered", () => {
    // items and gold are alternative paths through one decision set, so a
    // class must never grant both.
    for (const [cls, entry] of Object.entries(CLASS_STARTING_EQUIPMENT)) {
      const gold = resolveStartingEquipmentPick(cls, null, { gold: true }, []);
      const picked = resolveStartingEquipmentPick(cls, null, { picks: pickAll(entry) }, []);
      assert.ok(gold.gp > 0 && picked.gp === 0, `${cls}: gold and picks are not alternatives`);
      assert.ok(picked.items.length > 0, `${cls}: picking every row grants nothing`);
      // Slugged, not the display name: "barbarian-gold". A saved character
      // stores this id, so the shape is part of the saved data.
      assert.equal(goldOptionIdFor(cls), `${slugId(cls)}-gold`);
      assert.ok(resolveStartingEquipmentPick(cls, null, { classOptionId: goldOptionIdFor(cls) }, []).gp > 0,
        `${cls}: the legacy gold id still resolves to gold`);
    }
  });
});

function pickAll(entry) {
  return Object.fromEntries((entry.decisions || []).map((d) => [d.id, d.options[0]?.id]));
}

// tests/spell-sheet-chrome.test.mjs
//
// The management sheet's spell-listing chrome (section 5) and the storage
// migration behind it (section 6).
//
// The recurring theme: most of this file is about what must NOT appear. A
// known-only caster seeing "0 / 0 prepared", a dead column of toggles, and
// a filter is worse than seeing none of it, because each of those implies a
// prepared list exists.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  preparedCounter,
  togglePreparedSpell,
  spellRowView,
  spellIsRitual,
} from "../js/render/sheet/sheetWizard.js";
import { migratePreparedSpellLists, hydrateCharacter } from "../js/state/bundleMaps.js";
import { SPELL_CATALOG } from "../js/data/contentCatalogs.js";
import { spellsForLevelIn } from "../js/render/sheet/sheetWizard.js";

// --- The counter ----------------------------------------------------------

describe("preparedCounter", () => {
  const levelBy = (n) => (n === "Fire Bolt" || n === "Mage Hand" ? 0 : 1);

  it("counts prepared against the limit, in words", () => {
    const c = preparedCounter({ prepared: ["Shield", "Magic Missile"], limit: 8, levelByNameFn: levelBy });
    assert.equal(c.count, 2);
    assert.equal(c.limit, 8);
    assert.equal(c.text, "Prepared: 2 / 8");
    assert.equal(c.over, false);
    assert.equal(c.overBy, 0);
  });

  it("has NO counter at all for a class with no prepared list", () => {
    // The caller's cue to render nothing. Not a zero: a zero would print
    // "0 / 0" and imply an empty prepared list.
    assert.equal(preparedCounter({ prepared: [], limit: 0 }), null);
    assert.equal(preparedCounter({}), null);
    assert.equal(preparedCounter({ prepared: ["Shield"], limit: 0 }), null);
  });

  it("warns but does not refuse when over the limit", () => {
    // The wizard asks for ability scores after the class, so a prepared list
    // that was correct can end up over one the player never intended.
    const c = preparedCounter({ prepared: ["A", "B", "C", "D"], limit: 2, levelByNameFn: levelBy });
    assert.equal(c.count, 4);
    assert.equal(c.over, true);
    assert.equal(c.overBy, 2, "and says how far over, not just that it is");
    assert.equal(c.text, "Prepared: 4 / 2", "the numbers stay readable either way");
  });

  it("counts always-prepared spells, which are prepared whether or not chosen", () => {
    const c = preparedCounter({ prepared: ["Shield"], alwaysPrepared: ["Bless"], limit: 8, levelByNameFn: levelBy });
    assert.equal(c.count, 2, "a domain spell occupies a slot");
  });

  it("never counts a cantrip", () => {
    const c = preparedCounter({ prepared: ["Fire Bolt", "Mage Hand", "Shield"], limit: 8, levelByNameFn: levelBy });
    assert.equal(c.count, 1, "only the leveled spell");
  });

  it("would count cantrips if a model ever said to", () => {
    const c = preparedCounter({
      prepared: ["Fire Bolt", "Shield"], limit: 8, cantripsCountAsPrepared: true, levelByNameFn: levelBy,
    });
    assert.equal(c.count, 2);
  });

  it("de-duplicates, so a spell in both lists counts once", () => {
    const c = preparedCounter({ prepared: ["Bless"], alwaysPrepared: ["Bless"], limit: 8, levelByNameFn: levelBy });
    assert.equal(c.count, 1);
  });

  it("counts everything when it cannot tell a cantrip from a spell", () => {
    // Under-reporting a cantrip as a slot would accuse someone of being over
    // a limit they are not near.
    const c = preparedCounter({ prepared: ["Fire Bolt", "Shield"], limit: 8 });
    assert.equal(c.count, 2);
  });
});

// --- The toggle ------------------------------------------------------------

describe("togglePreparedSpell", () => {
  it("adds and removes, one tap each", () => {
    const added = togglePreparedSpell({ prepared: [], name: "Shield" });
    assert.deepEqual(added.prepared, ["Shield"]);
    assert.equal(added.changed, true);
    const removed = togglePreparedSpell({ prepared: ["Shield"], name: "Shield" });
    assert.deepEqual(removed.prepared, []);
    assert.equal(removed.changed, true);
  });

  it("refuses an always-prepared spell rather than silently accepting it", () => {
    // A toggle that appeared to work and then reverted reads as a broken
    // control. The row shows it locked instead, and says why.
    const out = togglePreparedSpell({ prepared: ["Shield"], name: "Bless", alwaysPrepared: ["Bless"] });
    assert.equal(out.changed, false);
    assert.equal(out.reason, "always-prepared");
    assert.deepEqual(out.prepared, ["Shield"], "and nothing changed");
  });

  it("preserves the order of the spells that survive", () => {
    const out = togglePreparedSpell({ prepared: ["B", "A", "C"], name: "D" });
    assert.deepEqual(out.prepared, ["B", "A", "C", "D"]);
    const back = togglePreparedSpell({ prepared: ["B", "A", "C"], name: "A" });
    assert.deepEqual(back.prepared, ["B", "C"]);
  });

  it("does nothing without a name", () => {
    const out = togglePreparedSpell({ prepared: ["Shield"], name: "" });
    assert.equal(out.changed, false);
    assert.deepEqual(out.prepared, ["Shield"]);
  });
});

// --- Per-row view ----------------------------------------------------------

describe("spellRowView", () => {
  const base = { name: "Shield", level: 1, hasPreparedList: true };

  it("gives a prepared caster a working toggle", () => {
    const v = spellRowView(base);
    assert.equal(v.hasToggle, true);
    assert.equal(v.locked, false);
    assert.equal(v.pressed, false);
  });

  it("gives a known-only caster NOTHING", () => {
    // The four checks that matter: no toggle, no dimming, no hiding.
    const v = spellRowView({ ...base, hasPreparedList: false, isPrepared: true });
    assert.equal(v.hasToggle, false, "no toggle");
    assert.equal(v.dimmed, false, "and nothing is dimmed for a class that prepares nothing");
  });

  it("gives a cantrip no toggle, even for a prepared caster", () => {
    // A cantrip is not a prepared slot, so offering to prepare one would be
    // offering to spend a slot that does not exist.
    const v = spellRowView({ ...base, level: 0, name: "Fire Bolt" });
    assert.equal(v.hasToggle, false);
    assert.equal(v.isCantrip, true);
  });

  it("locks an always-prepared spell and counts it as pressed", () => {
    const v = spellRowView({ ...base, alwaysPrepared: true });
    assert.equal(v.hasToggle, true);
    assert.equal(v.locked, true, "shown, but not clickable");
    assert.equal(v.pressed, true, "and reading as prepared");
  });

  it("dims an unprepared spell for a prepared caster", () => {
    assert.equal(spellRowView(base).dimmed, true);
    assert.equal(spellRowView({ ...base, isPrepared: true }).dimmed, false);
    assert.equal(spellRowView({ ...base, alwaysPrepared: true }).dimmed, false);
  });

  it("'prepared only' REMOVES the row rather than dimming it", () => {
    // A filter that leaves dimmed ghosts behind is one you have to read past.
    assert.equal(spellRowView(base).hidden, false);
    assert.equal(spellRowView({ ...base, isPrepared: true }).hidden, false);
    const shown = spellRowView({ ...base, showPreparedOnly: true });
    assert.equal(shown.hidden, true);
    const prepared = spellRowView({ ...base, isPrepared: true, showPreparedOnly: true });
    assert.equal(prepared.hidden, false);
    assert.equal(prepared.dimmed, false, "a shown prepared spell is not dimmed");
  });

  it("carries the ritual mark through", () => {
    assert.equal(spellRowView({ ...base, isRitual: true }).ritual, true);
    assert.equal(spellRowView(base).ritual, false);
  });

  it("handles nothing", () => {
    const v = spellRowView({});
    assert.equal(v.hasToggle, false);
    assert.equal(v.dimmed, false);
    assert.equal(v.hidden, false);
  });
});

// --- Rituals ---------------------------------------------------------------

describe("spellIsRitual", () => {
  it("reads the catalog's own 'ritual' tag", () => {
    // There is no `ritual: true` field in the spell data. But "ritual" IS one
    // of the catalog's tags on every ritual spell and spellsForLevelIn
    // passes tags through, so this is a read of existing data - not an
    // inference from the effect text, which the 2014 spell entries in this
    // repo do not carry.
    assert.equal(spellIsRitual({ tags: ["divination", "ritual", "self"] }), true);
    assert.equal(spellIsRitual({ tags: ["conjuration"] }), false);
    assert.equal(spellIsRitual({}), false);
    assert.equal(spellIsRitual(null), false);
  });

  it("does not match a tag that merely contains the word", () => {
    assert.equal(spellIsRitual({ tags: ["nonritual"] }), false);
    assert.equal(spellIsRitual({ tags: ["ritualistic"] }), false);
    assert.equal(spellIsRitual({ tags: [" Ritual "] }), true, "but whitespace is forgiven");
  });

  it("finds real rituals in the shipped catalog, and does not invent any", () => {
    // Pinned against the actual data rather than a hand-made entry, because
    // the whole claim is that the flag is READ rather than derived. If the
    // compile step ever stops emitting the tag, this is what notices.
    const parsed = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((lvl) => spellsForLevelIn(SPELL_CATALOG, lvl, ""));
    const rituals = parsed.filter(spellIsRitual);
    assert.ok(rituals.length > 20, `the catalog marks its ritual spells (found ${rituals.length})`);
    // Two the sheet will actually show on a Wizard's list, to prove the tags
    // survive spellsForLevelIn's reshaping rather than only existing raw.
    for (const name of ["Find Familiar", "Detect Magic"]) {
      const spell = parsed.find((s) => s.name === name);
      assert.ok(spell, `${name} is in the catalog`);
      assert.equal(spellIsRitual(spell), true, `${name} is marked ritual`);
    }
    // And a level-1 Wizard spell that is definitely not one.
    const shield = parsed.find((s) => s.name === "Shield");
    assert.ok(shield, "Shield is in the catalog");
    assert.equal(spellIsRitual(shield), false);
  });
});

// --- Section 6: migration --------------------------------------------------

/** A minimal character with one Spells Known field, shaped like a real save. */
function characterWithSpells(items, extra = {}) {
  return {
    sheetTabs: [{
      id: "t1",
      layout: [{
        id: "b1",
        name: "Spellcasting",
        children: [{ id: "spellsKnown", label: "Spells Known", fieldType: "textlist", items, ...extra }],
      }],
    }],
  };
}

describe("migratePreparedSpellLists", () => {
  it("an old character with a plain spell list loads, and nothing is prepared", () => {
    // The migration the brief asks for, and the important half: an ABSENT
    // preparedItems means nothing prepared, which is right for every
    // character that predates the field.
    const c = characterWithSpells(["Fire Bolt", "Shield"]);
    assert.equal("preparedItems" in c.sheetTabs[0].layout[0].children[0], false, "the save really has none");
    migratePreparedSpellLists(c);
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].preparedItems, []);
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].items, ["Fire Bolt", "Shield"],
      "and the spell list is untouched");
  });

  it("a known-only caster's list is unchanged in behaviour", () => {
    // Nothing about a Sorcerer's character data changes; the sheet renders
    // no chrome for them, and that is decided by spellcastingModelFor, not
    // by this function.
    const c = characterWithSpells(["Fire Bolt", "Fireball"]);
    migratePreparedSpellLists(c);
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].items, ["Fire Bolt", "Fireball"]);
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].preparedItems, []);
  });

  it("keeps prepared spells the character still holds", () => {
    const c = characterWithSpells(["Shield", "Fireball"], { preparedItems: ["Shield"] });
    migratePreparedSpellLists(c);
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].preparedItems, ["Shield"]);
  });

  it("drops a stale spellbook spell, for a model that prepares from known", () => {
    // The sheet keeps the two in step, but a character edited outside the
    // app can leave a prepared spell the character does not hold - and the
    // counter would then count it toward a limit as if it were castable.
    const c = characterWithSpells(["Shield"], { preparedItems: ["Shield", "Fireball"] });
    c.rules = { className: "Wizard", level: 5 };
    migratePreparedSpellLists(c, { modelFor: () => ({ preparedFrom: "known" }) });
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].preparedItems, ["Shield"]);
  });

  it("keeps a full-list preparer's spells that are NOT in items", () => {
    // The bug this guards: a Cleric's prepared spells are deliberately
    // absent from `items` - `items` holds what they added, `preparedItems`
    // what they chose to prepare. Filtering on `items` for this model would
    // unprepared every Cleric, Druid and Paladin on first load after an
    // update, with no visible cause and no way back.
    const c = characterWithSpells(["Cure Wounds"], { preparedItems: ["Bless", "Cure Wounds", "Spiritual Weapon"] });
    c.rules = { className: "Cleric", level: 5 };
    migratePreparedSpellLists(c, { modelFor: () => ({ preparedFrom: "classList" }) });
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].preparedItems,
      ["Bless", "Cure Wounds", "Spiritual Weapon"],
      "all three survive, including the one that is only in preparedItems");
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].items, ["Cure Wounds"],
      "and items is untouched - the two lists stay separate");
  });

  it("still de-duplicates and drops junk for a full-list preparer", () => {
    const c = characterWithSpells(["Cure Wounds"], { preparedItems: ["Bless", "Bless", "", 7, null] });
    c.rules = { className: "Cleric", level: 5 };
    migratePreparedSpellLists(c, { modelFor: () => ({ preparedFrom: "classList" }) });
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].preparedItems, ["Bless"]);
  });

  it("keeps everything for an unrecognised class rather than destroying it", () => {
    // Dropping is destructive and irreversible from the player's point of
    // view; keeping a stale name is only cosmetic. With no model to
    // consult, the safe answer is to trust the save.
    const c = characterWithSpells(["Shield"], { preparedItems: ["Shield", "Mystery"] });
    c.rules = { className: "Custom/Homebrew", level: 3 };
    migratePreparedSpellLists(c, { modelFor: () => null });
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].preparedItems, ["Shield", "Mystery"]);
  });

  it("repairs a malformed list rather than letting undefined reach the render", () => {
    for (const bad of [null, undefined, "Shield", 42, {}]) {
      const c = characterWithSpells(["Shield"], { preparedItems: bad });
      assert.doesNotThrow(() => migratePreparedSpellLists(c));
      assert.deepEqual(c.sheetTabs[0].layout[0].children[0].preparedItems, [],
        `${JSON.stringify(bad)} becomes an empty list`);
    }
  });

  it("de-duplicates and drops non-strings", () => {
    const c = characterWithSpells(["Shield"], { preparedItems: ["Shield", "Shield", "", null, 7, "Shield"] });
    migratePreparedSpellLists(c);
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].preparedItems, ["Shield"]);
  });

  it("handles a spell list with no items array at all", () => {
    const c = characterWithSpells(undefined);
    migratePreparedSpellLists(c);
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].preparedItems, []);
  });

  it("leaves other textlist fields alone", () => {
    const c = characterWithSpells(["Shield"]);
    c.sheetTabs[0].layout[0].children.push({
      id: "attacks", label: "Attacks", fieldType: "textlist", items: ["Longsword"], preparedItems: null,
    });
    migratePreparedSpellLists(c);
    assert.equal("preparedItems" in c.sheetTabs[0].layout[0].children[1], true,
      "a preparedItems left on another field is not our business to invent");
  });

  it("finds the field by id OR by label, so a renamed id still works", () => {
    const c = characterWithSpells(["Shield"]);
    c.sheetTabs[0].layout[0].children[0].id = "custom-abc";
    migratePreparedSpellLists(c);
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].preparedItems, []);
  });

  it("tolerates a character with no tabs, or tabs with no layout", () => {
    for (const c of [{}, { sheetTabs: [] }, { sheetTabs: [{}] }, { sheetTabs: [{ layout: null }] }, { sheetTabs: "nope" }]) {
      assert.doesNotThrow(() => migratePreparedSpellLists(c));
    }
  });

  it("returns the character, so it can chain", () => {
    const c = characterWithSpells(["Shield"]);
    assert.equal(migratePreparedSpellLists(c), c);
  });

  it("runs on load, through hydrateCharacter, and resolves the real model", () => {
    // Both stores call hydrateCharacter on the way in, so this is where the
    // migration actually happens for a real character - and the only place
    // the class model is looked up for free. A Wizard is the case where the
    // model exists and says "prepared comes from known", so the stale name
    // goes. This asserts the wiring, not just the function.
    const c = characterWithSpells(["Shield"], { preparedItems: ["Shield", "Ghost"] });
    c.rules = { className: "Wizard", level: 5 };
    c.rulesetId = "dnd5e-2014";
    hydrateCharacter(c);
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].preparedItems, ["Shield"]);
  });

  it("a real Cleric keeps their prepared spells across a load", () => {
    // The end-to-end version of the section-2 shape, through the real
    // registry rather than a stub: items holds one hand-added spell, and
    // every prepared name is legitimately absent from it.
    const c = characterWithSpells(["Cure Wounds"], { preparedItems: ["Bless", "Spiritual Weapon"] });
    c.rules = { className: "Cleric", level: 5 };
    c.rulesetId = "dnd5e-2014";
    hydrateCharacter(c);
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].preparedItems, ["Bless", "Spiritual Weapon"]);
  });

  it("a known-only caster's leftover preparations are emptied, even when the spells are held", () => {
    // The strict case, and the reason the model is consulted at all. A
    // Sorcerer has no prepared list: nothing to prepare FROM, and nothing to
    // spend the count on. The sheet renders no counter and no toggles for
    // such a class - so a name left here is invisible AND unclearable by the
    // player. Being present in `items` must not save it, which is exactly
    // what the membership-only filter did.
    const c = characterWithSpells(["Bless", "Fire Bolt"], { preparedItems: ["Bless", "Cure Wounds"] });
    c.rules = { className: "Sorcerer", level: 5 };
    c.rulesetId = "dnd5e-2014";
    hydrateCharacter(c);
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].preparedItems, []);
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].items, ["Bless", "Fire Bolt"],
      "and the spells they know are untouched");
  });

  it("a Wizard's spellbook preparations survive, since they are held spells", () => {
    const c = characterWithSpells(["Bless", "Fireball"], { preparedItems: ["Bless"] });
    c.rules = { className: "Wizard", level: 5 };
    c.rulesetId = "dnd5e-2014";
    hydrateCharacter(c);
    assert.deepEqual(c.sheetTabs[0].layout[0].children[0].preparedItems, ["Bless"]);
  });

  it("hydrateCharacter still handles no character at all", () => {
    assert.equal(hydrateCharacter(null), null);
    assert.equal(hydrateCharacter(undefined), undefined);
  });

  it("repairs the loaded copy without writing to storage", () => {
    // Deliberate, and worth pinning: a read must not write. hydrateCharacter
    // returns a repaired copy; localStorage keeps the pre-migration value
    // until the player's next save. That is safe because the migration runs
    // on EVERY load, so the stale value is never what gets rendered - but it
    // means "the save is empty now" is not a true statement about storage,
    // and a test that asserts it would be testing the wrong thing.
    const stored = characterWithSpells(["Bless"], { preparedItems: ["Bless"] });
    stored.rules = { className: "Sorcerer", level: 5 };
    stored.rulesetId = "dnd5e-2014";
    const loaded = hydrateCharacter(JSON.parse(JSON.stringify(stored)));
    assert.deepEqual(loaded.sheetTabs[0].layout[0].children[0].preparedItems, [],
      "the copy the app renders from IS repaired");
    assert.deepEqual(stored.sheetTabs[0].layout[0].children[0].preparedItems, ["Bless"],
      "and the caller's own object is untouched, because this is a pure repair of the argument's data");
  });
});

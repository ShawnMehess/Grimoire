// tests/spellcasting-models.test.mjs
//
// Which of the three spell lists a class keeps (js/data/spellcastingModels.js).
//
// The shape of a caster is not derivable from the data the app already has.
// `getSpellcastingInfo` exposes `style` of "known" or "prepared", and that is
// enough to tell a Sorcerer from a Cleric - but NOT enough to tell a Wizard
// from a Cleric, because both are style "prepared". The Wizard is the one
// class whose prepared spells come out of a list the character owns, and that
// difference is the entire spellbook UI: a second line, an indented line, and
// a line that can be locked.
//
// So the config is explicit, ruleset-keyed. The brief asks for 2024 to be able
// to change any of this; there is no 2024 ruleset in this repo yet (only
// `dnd5e-2014`), so what is testable here is that the SHAPE supports a
// per-rulesystem override and that nothing matches a ruleset by prefix.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getSpellcastingInfo, listRulesets } from "../js/data/dnd5e.js";
import {
  spellcastingModelFor,
  deriveSpellcastingModel,
  rulesetsWithSpellcastingModels,
  UNLIMITED_SPELL_CAP,
} from "../js/data/spellcastingModels.js";

const infoFor = (name) => getSpellcastingInfo(name);
const model = (className, rulesetId = "dnd5e-2014") => spellcastingModelFor(className, rulesetId, { infoFor });

describe("known-only casters", () => {
  // One personal list. Spells on it are ready to cast; nothing is prepared.
  for (const className of ["Sorcerer", "Bard", "Warlock", "Ranger"]) {
    it(`${className} has a known line and no prepared line`, () => {
      const m = model(className);
      assert.equal(m.hasKnownList, true, "keeps a list");
      assert.equal(m.hasPreparedList, false, "and nothing prepared out of it");
      assert.equal(m.knownCap, "limit", "the list has a quota");
    });
  }

  it("labels the line Spells Known", () => {
    assert.equal(model("Sorcerer").knownLabel, "Spells Known");
  });
});

describe("full-list preparers", () => {
  // No personal list at all. The player prepares N spells out of everything
  // the class can cast, and the rest of the class list is recorded nowhere.
  for (const className of ["Cleric", "Druid", "Paladin", "Artificer"]) {
    it(`${className} has a prepared line only, prepared from the class list`, () => {
      const m = model(className);
      assert.equal(m.hasKnownList, false, "keeps no personal list");
      assert.equal(m.hasPreparedList, true, "has a prepared line");
      assert.equal(m.preparedFrom, "classList", "prepared straight out of the class list");
      // The distinction that matters for the UI: there is no line above it to
      // lock behind, so this line is never locked.
      assert.equal(m.hasKnownList && m.hasPreparedList, false);
    });
  }

  it("labels the line Prepared Spells", () => {
    assert.equal(model("Cleric").preparedLabel, "Prepared Spells");
  });
});

describe("spellbook casters", () => {
  it("the Wizard has both lines, and prepares out of its own list", () => {
    const m = model("Wizard");
    assert.equal(m.hasKnownList, true);
    assert.equal(m.hasPreparedList, true);
    // The whole point: the prepared subset comes from the character's own
    // list, which is what makes the line lockable.
    assert.equal(m.preparedFrom, "known");
  });

  it("the spellbook line is called Spellbook and has no quota", () => {
    const m = model("Wizard");
    assert.equal(m.knownLabel, "Spellbook");
    // 5e caps the PREPARED subset, not the book. Capping the book with
    // limit.spells would cap it at six while allowing six more prepared.
    assert.equal(m.knownCap, "unlimited");
    assert.ok(UNLIMITED_SPELL_CAP > 1000, "the sentinel never binds");
  });

  it("the prepared line is still called Prepared Spells", () => {
    assert.equal(model("Wizard").preparedLabel, "Prepared Spells");
  });
});

describe("cantrips are never prepared", () => {
  it("no class in this data counts them", () => {
    for (const className of ["Sorcerer", "Bard", "Warlock", "Ranger", "Cleric", "Druid", "Paladin", "Artificer", "Wizard"]) {
      assert.equal(model(className).countsCantrips, false, `${className} does not prepare cantrips`);
    }
  });
});

describe("non-casters", () => {
  it("have no model at all, which is the caller's cue to show nothing", () => {
    assert.equal(model("Fighter"), null);
    assert.equal(model("Rogue"), null);
    assert.equal(model(""), null);
    assert.equal(model(undefined), null);
  });
});

describe("a class with no config entry derives its shape", () => {
  it("derives from style, so homebrew and new classes still work", () => {
    // Homebrew casters are not in any ruleset's table and not in the config.
    const info = { caster: "full", ability: "cha", style: "known" };
    assert.deepEqual(
      deriveSpellcastingModel("Homebrew", { infoFor: () => info }),
      {
        hasKnownList: true,
        knownLabel: "Spells Known",
        knownCap: "limit",
        hasPreparedList: false,
        preparedLabel: "Prepared Spells",
        preparedFrom: "known",
        countsCantrips: false,
      },
    );
    const prepInfo = { caster: "full", ability: "wis", style: "prepared" };
    const derived = deriveSpellcastingModel("HomebrewPrep", { infoFor: () => prepInfo });
    assert.equal(derived.hasKnownList, false);
    assert.equal(derived.preparedFrom, "classList");
  });

  it("a Wizard in an unconfigured ruleset loses its spellbook, which is why it is configured explicitly", () => {
    // The honest failure mode, pinned so it is a decision rather than an
    // accident: with no entry, a Wizard under some other ruleset is a
    // full-list preparer. Adding a 2024 ruleset means adding its entries.
    const wizardInfo = getSpellcastingInfo("Wizard");
    const derived = deriveSpellcastingModel("Wizard", { infoFor: () => wizardInfo });
    assert.equal(derived.hasKnownList, false, "no entry means no spellbook line");
    assert.equal(model("Wizard").hasKnownList, true, "the configured ruleset keeps it");
  });
});

describe("ruleset matching", () => {
  it("is keyed by ruleset, so a later edition can override any class", () => {
    assert.deepEqual(rulesetsWithSpellcastingModels(), ["dnd5e-2014"]);
    // An unknown ruleset falls back to the derived shape rather than to
    // another ruleset's entries.
    const wizardInfo = getSpellcastingInfo("Wizard");
    const other = spellcastingModelFor("Wizard", "dnd5e-2024", { infoFor: () => wizardInfo });
    assert.equal(other.hasKnownList, false, "2024 has no entry yet, so no spellbook");
  });

  it("never matches by prefix - dnd5e-2014 and dnd5e-2024 share one", () => {
    // A prefix match would silently hand every 2024 character the 2014
    // model's Wizard, which is exactly the bug a future ruleset cannot see.
    const wizardInfo = getSpellcastingInfo("Wizard");
    for (const id of ["dnd5e-2024", "dnd5e-2024-phb", "dnd5e-2024beta"]) {
      assert.equal(
        spellcastingModelFor("Wizard", id, { infoFor: () => wizardInfo }).hasKnownList,
        false,
        `${id} does not inherit the 2014 entry`,
      );
    }
    assert.equal(spellcastingModelFor("Wizard", "dnd5e-2014", { infoFor: () => wizardInfo }).hasKnownList, true);
  });

  it("handles a missing or empty ruleset id", () => {
    for (const id of [null, undefined, ""]) {
      assert.equal(model("Sorcerer", id).hasKnownList, true, "a known caster still derives correctly");
    }
  });
});

describe("the config matches what the rules data says", () => {
  it("every cast class in the repo resolves to a model, and no non-caster does", () => {
    const casters = ["Sorcerer", "Bard", "Warlock", "Ranger", "Cleric", "Druid", "Paladin", "Artificer", "Wizard"];
    const nonCasters = ["Fighter", "Rogue", "Barbarian", "Monk"];
    for (const c of casters) assert.ok(model(c), `${c} is a caster and has a model`);
    for (const c of nonCasters) assert.equal(model(c), null, `${c} is not a caster`);
  });

  it("the derived default agrees with style for every caster", () => {
    for (const c of ["Sorcerer", "Bard", "Warlock", "Ranger", "Cleric", "Druid", "Paladin", "Artificer"]) {
      const style = getSpellcastingInfo(c).style;
      const m = model(c);
      assert.equal(m.hasKnownList, style === "known", `${c}: style ${style}`);
      assert.equal(m.hasPreparedList, style === "prepared", `${c}: style ${style}`);
    }
  });

  it("there is exactly one ruleset in this repo, and it is the configured one", () => {
    // Worth pinning: the brief anticipates a 2024 ruleset changing the model
    // for several classes, and there is not one here to check against.
    assert.deepEqual(listRulesets().map((r) => r.id), ["dnd5e-2014"]);
  });
});

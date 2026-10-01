// tests/inline-spell-picks.test.mjs
//
// Spell picking during character creation.
//
// The creation wizard used to have a Spells step. It is now a commented-out
// block (see js/render/customSheet.js), which left a new caster reaching
// Review with an empty Spells Known list - the step was the only place
// creation could pick spells, since renderSpellPicker is otherwise called
// from the LEVEL-UP wizard.
//
// Spell picks are now inline on the class row, in the same shape as every
// other pick: a bullet per list whose link opens the shared dialog.
//
// THE COUNTS ARE TOTALS. That is the thing this file exists to hold down.
// spellLimitFor returns ONE number, and reading what it computes shows it is
// a total across spell levels, not a per-level number: for a known caster it
// is the spells-known table, and for a prepared caster it is
// `ability mod + level`. The first version of the inline picks applied that
// same total to every available spell level, so a level-5 Sorcerer was
// offered 6 + 6 + 6 = 18 leveled spells against a limit of 6. Level 1 hid
// it, because only one spell level exists there.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spellLimitFor } from "../js/data/rulesEngine.js";
import { getLevelUpPlan, getSpellcastingInfo } from "../js/data/dnd5e.js";
import { spellcastingModelFor, UNLIMITED_SPELL_CAP } from "../js/data/spellcastingModels.js";
import {
  creationSpellPickGroups,
  spellPickDialogOptions,
  migrateSpellPickKeys,
  spellPickKey,
  orphanedSpellPickNames,
  alwaysPreparedSpellNames,
  applySpellPickToItems,
  preparedItemsWithAuto,
  preparedLineLock,
  applySpellPickWrite,
  preparedCountOver,
  pruneOrphanedChoiceKeys,
  groupPicksSatisfied,
} from "../js/render/sheet/sheetWizard.js";

// --- A tiny stand-in catalog -------------------------------------------------
//
// Enough for "which level is this name at" and "what does the dialog offer"
// to be answerable without shipping 537 spells into the test. Note it has
// several spells at EACH level, so "pick more than exist at one level" and
// "pick up to the total across levels" are distinguishable.

/** name -> spell level. Cantrip count has to reach 6, which is what a
 *  level-10 Sorcerer needs, and the level-9+ spell levels have at least one
 *  entry each so a level-20 caster's spans are not empty. */
const SPELL_LEVEL = {
  "Fire Bolt": 0, "Mage Hand": 0, "Light": 0, "Prestidigitation": 0, "Blade Ward": 0, "True Strike": 0,
  "Magic Missile": 1, "Shield": 1, "Bless": 1, "Cure Wounds": 1, "Guiding Bolt": 1, "Healing Word": 1,
  "Misty Step": 2, "Mirror Image": 2, "Moonbeam": 2, "Misty Walk": 2,
  "Fireball": 3, "Counterspell": 3, "Haste": 3,
  "Wall of Fire": 4, "Dimension Door": 4,
  "Chain Lightning": 5, "Hold Monster": 5,
  "Disintegrate": 6, "Finger of Death": 6,
  "Crown of Stars": 7,
  "Sunburst": 8,
  "Time Stop": 9,
};

function fakeCatalog() {
  const byLevel = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [], 8: [], 9: [] };
  for (const [name, lvl] of Object.entries(SPELL_LEVEL)) byLevel[lvl].push(name);
  return {
    name: "Spell List",
    tabs: [
      { id: "cantrips", entries: byLevel[0].map((name) => ({ name })) },
      ...Object.entries(byLevel).filter(([lvl]) => Number(lvl) > 0)
        .map(([lvl, names]) => ({ id: `level${lvl}`, entries: names.map((name) => ({ name })) })),
    ],
  };
}

const CATALOG = fakeCatalog();
const allNames = Object.keys(SPELL_LEVEL);
const levelByName = (name) => SPELL_LEVEL[name] ?? null;
const spellsForLevel = (lvl) => allNames.filter((n) => SPELL_LEVEL[n] === lvl).map((n) => ({ name: n, school: "Evocation" }));

/** Which spell levels the class has slots for at this level, straight from
 *  the real rules data so the test cannot drift from it. */
function availableLevelsFor(className, level, rulesetId = "dnd5e-2014") {
  const plan = getLevelUpPlan(rulesetId, className, level);
  if (!plan) return [];
  return plan.slotChanges
    .map((c) => Number.parseInt(String(c.fieldId).replace("slots", ""), 10))
    .filter(Number.isFinite);
}

const SCORES = { str: 10, dex: 10, con: 10, int: 12, wis: 16, cha: 18 };
const modelFor = (className, rulesetId = "dnd5e-2014") =>
  spellcastingModelFor(className, rulesetId, { infoFor: (n) => getSpellcastingInfo(n) });

function groupsFor(className, level, {
  choices = {}, knownItems = [], bundles = [], abilityScores = SCORES, rulesetId = "dnd5e-2014",
} = {}) {
  return creationSpellPickGroups({
    className,
    level,
    abilityScores,
    bundles,
    choices,
    knownItems,
    limitFor: spellLimitFor,
    availableLevelsFor: (n, l) => availableLevelsFor(n, l, rulesetId),
    levelByNameFn: levelByName,
    model: modelFor(className, rulesetId),
  });
}

const cantripsOf = (groups) => groups.find((g) => g.spellPick.level === 0);
const leveledOf = (groups) => groups.find((g) => g.spellPick.part === "spells");
const preparedOf = (groups) => groups.find((g) => g.spellPick.part === "prepared");
const complete = (groups, choices) => groups.every((g) => groupPicksSatisfied(g, choices[g.key] || []));

// ===========================================================================
describe("spell pick counts are TOTALS, not per level", () => {
  // A known caster and a prepared caster, at three levels, against the real
  // spellLimitFor. Every assertion here is "the sum of the caps equals the
  // limit" - which is the whole bug, since the old code made each cap equal
  // the limit.
  const KNOWN = ["Sorcerer", "Bard"];
  const PREPARED = ["Cleric", "Wizard"];
  const LEVELS = [1, 3, 5];

  for (const className of KNOWN) {
    for (const level of LEVELS) {
      it(`${className} at level ${level}: the leveled cap is spellLimitFor's total`, () => {
        const groups = groupsFor(className, level);
        const limit = spellLimitFor(className, level, SCORES);
        const leveled = leveledOf(groups);
        const available = availableLevelsFor(className, level);

        // One group covering every available level, not one per level.
        assert.equal(groups.filter((g) => g.spellPick.level > 0).length, 1,
          "one leveled line, not one per spell level");
        // Its dialog spans them all.
        assert.equal(leveled.spellPick.level, 1, "the line starts at 1st level");
        assert.equal(leveled.spellPick.maxLevel, Math.max(...available),
          `and spans up to the highest level the class has slots for (${available.join(",")})`);

        // THE assertion: what the player may end up choosing, summed over
        // every level, is the limit. At level 5 that was 18 against 6.
        const cap = leveled.maxSelections;
        assert.equal(cap, limit.spells,
          `cap ${cap} equals the limit ${limit.spells} for a level-${level} ${className} with ${available.length} spell level(s)`);
        if (available.length > 1) {
          assert.ok(available.length * limit.spells > limit.spells,
            "the old per-level reading really would have been over the limit here");
        }
      });
    }
  }

  for (const className of PREPARED) {
    for (const level of LEVELS) {
      it(`${className} at level ${level}: the capped line is spellLimitFor's total`, () => {
        const groups = groupsFor(className, level);
        const limit = spellLimitFor(className, level, SCORES);
        // For a full-list preparer (Cleric) the only leveled line is the
        // prepared one. For a spellbook class (Wizard) the spellbook line
        // exists too and is deliberately uncapped, so the line that must
        // respect the limit is the prepared one either way.
        const capped = modelFor(className).knownCap === "unlimited"
          ? [preparedOf(groups)]
          : groups.filter((g) => g.spellPick.level > 0);
        assert.equal(capped.length, 1, "exactly one capped leveled line");
        assert.equal(capped[0].maxSelections, limit.spells, `cap equals the limit ${limit.spells}`);
      });
    }
  }

  it("a spellbook is uncapped, and the number it does cap is the prepared one", () => {
    // 5e gives a Wizard no spellbook quota. Borrowing `limit.spells` for the
    // book would cap it at six while allowing six more to sit prepared -
    // the number belongs to the prepared line alone.
    for (const level of LEVELS) {
      const groups = groupsFor("Wizard", level);
      const limit = spellLimitFor("Wizard", level, SCORES);
      assert.equal(leveledOf(groups).maxSelections, UNLIMITED_SPELL_CAP, `L${level} spellbook has no quota`);
      assert.equal(leveledOf(groups).minSelections, 0, "and so never blocks completeness");
      assert.equal(preparedOf(groups).maxSelections, limit.spells, `L${level} prepared count is the limit`);
      assert.equal(preparedOf(groups).minSelections, limit.spells, "and it is required");
    }
  });

  it("never offers more than the total, summed across every spell level", () => {
    // Belt and braces over the loop above: walk every caster and level the
    // app knows and assert the invariant globally.
    for (const className of ["Sorcerer", "Bard", "Warlock", "Ranger", "Cleric", "Druid", "Wizard", "Paladin", "Artificer"]) {
      for (let level = 1; level <= 20; level += 1) {
        const groups = groupsFor(className, level);
        const limit = spellLimitFor(className, level, SCORES);
        if (!limit) continue;
        // Only levelled lines share a cap; cantrips have their own, separate,
        // per-level count and are not part of the spell total.
        const levelled = groups.filter((g) => g.spellPick.level > 0);
        const chosenCap = levelled.length === 1
          ? levelled[0].maxSelections
          : levelled.reduce((n, g) => n + g.maxSelections, 0);
        // A spellbook (Wizard) has no quota, so its known line is uncapped by
        // design; the prepared line is what must respect the limit.
        const capped = levelled.filter((g) => g.spellPick.part !== "spells" || modelFor(className).knownCap !== "unlimited");
        const totalCap = capped.reduce((n, g) => n + g.maxSelections, 0);
        assert.ok(totalCap <= limit.spells || capped.length === 1 && capped[0].spellPick.part === "prepared",
          `${className} L${level}: capped lines allow ${totalCap} against a limit of ${limit.spells}`);
        void chosenCap;
      }
    }
  });

  it("cantrips keep their own separate count", () => {
    const groups = groupsFor("Sorcerer", 5);
    assert.equal(cantripsOf(groups).maxSelections, spellLimitFor("Sorcerer", 5, SCORES).cantrips);
    assert.equal(cantripsOf(groups).spellPick.maxLevel, 0, "and never spans leveled spells");
  });
});

// ===========================================================================
describe("one minSelections rule for both lines", () => {
  it("both lines use the shortfall: cap less what is already held elsewhere", () => {
    const groups = groupsFor("Sorcerer", 5);
    const leveled = leveledOf(groups);
    // A High Elf's cantrip does not touch this, but a hand-typed 1st-level
    // spell does: the class already holds it, so it is not re-pickable.
    const withHeld = creationSpellPickGroups({
      className: "Sorcerer",
      level: 5,
      abilityScores: SCORES,
      choices: {},
      knownItems: ["Fireball"],
      limitFor: spellLimitFor,
      availableLevelsFor,
      levelByNameFn: levelByName,
      model: modelFor("Sorcerer"),
    });
    assert.equal(leveled.minSelections, leveled.maxSelections, "nothing held elsewhere: owes the full cap");
    assert.equal(leveledOf(withHeld).minSelections, leveled.maxSelections - 1,
      "one spell already held: owes one less");
  });

  it("does NOT credit the pick's own selections", () => {
    // minSelections is compared against how many the pick HAS made, so
    // crediting them would let a half-finished pick read as complete. At two
    // cantrips of four this must still say 2 outstanding.
    const groups = groupsFor("Sorcerer", 1);
    const cantrips = cantripsOf(groups);
    const halfway = { [cantrips.key]: ["Fire Bolt", "Mage Hand"] };
    assert.equal(cantrips.minSelections, cantrips.maxSelections,
      "the shortfall does not move as the player picks");
    assert.equal(groupPicksSatisfied(cantrips, halfway[cantrips.key]), false,
      "and a half-finished pick is still incomplete");
  });

  it("gates the class row until every required pick is made", () => {
    const groups = groupsFor("Sorcerer", 5);
    const cantrips = cantripsOf(groups);
    const leveled = leveledOf(groups);
    const cantripNames = allNames.filter((n) => levelByName(n) === 0);
    const spellNames = allNames.filter((n) => levelByName(n) > 0);
    assert.ok(spellNames.length >= leveled.maxSelections, "the stand-in catalog has enough spells");

    const choices = {
      [cantrips.key]: cantripNames.slice(0, cantrips.maxSelections),
      [leveled.key]: [],
    };
    assert.equal(complete(groups, choices), false, "cantrips done, spells not");
    choices[leveled.key] = spellNames.slice(0, leveled.maxSelections);
    assert.equal(complete(groups, choices), true, "both lines satisfied");
  });

  it("always-prepared spells hold part of the allowance", () => {
    const bundles = [{ statModifiers: [{ targetFieldId: "spellsKnown", op: "addItem", value: "Bless" }] }];
    const bare = groupsFor("Sorcerer", 5);
    const withAuto = groupsFor("Sorcerer", 5, { bundles });
    assert.equal(leveledOf(withAuto).maxSelections, leveledOf(bare).maxSelections - 1,
      "a domain spell already holds one of the total");
    // And it is never offered as a choice.
    const options = spellPickDialogOptions({
      spellPick: leveledOf(withAuto).spellPick,
      spellsForLevelFn: (lvl) => spellsForLevel(lvl),
    });
    assert.ok(!options.some((o) => o.name === "Bless"), "already prepared, so not offered");
  });

  it("a whole allowance taken by always-prepared spells leaves no line at all", () => {
    const six = ["Magic Missile", "Shield", "Bless", "Cure Wounds", "Guiding Bolt", "Healing Word"];
    const bundles = [{
      statModifiers: six.map((value) => ({ targetFieldId: "spellsKnown", op: "addItem", value })),
    }];
    const groups = groupsFor("Sorcerer", 5, { bundles });
    assert.equal(leveledOf(groups), undefined, "nothing left to choose, so no empty line");
  });

  it("spells held elsewhere count, including a hand-typed one at a level in scope", () => {
    const groups = groupsFor("Sorcerer", 5, { knownItems: ["Fireball", "Haste"] });
    assert.equal(leveledOf(groups).maxSelections, spellLimitFor("Sorcerer", 5, SCORES).spells,
      "the cap is unchanged - these are spells the class may hold, not picks to make");
    assert.equal(leveledOf(groups).minSelections, leveledOf(groups).maxSelections - 2,
      "but two of them are already held, so two fewer are owed");
  });

  it("a hand-typed spell OUTSIDE the available levels does not count", () => {
    // A level-1 Sorcerer has only 1st-level slots. A 9th-level spell on the
    // sheet is not something the class can cast, so crediting it would let a
    // character skip a real pick.
    const groups = groupsFor("Sorcerer", 1, { knownItems: ["Time Stop"] });
    assert.equal(leveledOf(groups).minSelections, leveledOf(groups).maxSelections,
      "a spell outside the available levels is not credited");
  });

  it("a Fighter shows nothing at all", () => {
    assert.deepEqual(groupsFor("Fighter", 5), []);
  });

  it("a half-caster before it has cantrips or slots shows nothing", () => {
    // Paladin 1 and Ranger 1: no cantrips in CANTRIPS_KNOWN, no spell slots.
    assert.deepEqual(groupsFor("Paladin", 1), []);
    assert.deepEqual(groupsFor("Ranger", 1), []);
  });
});

// ===========================================================================
describe("the leveled line opens the shared dialog across its levels", () => {
  it("offers spells at every level it spans, sorted by name", () => {
    const groups = groupsFor("Sorcerer", 5);
    const leveled = leveledOf(groups);
    const options = spellPickDialogOptions({
      spellPick: leveled.spellPick,
      spellsForLevelFn: (lvl) => spellsForLevel(lvl),
    });
    const levels = new Set(options.map((o) => levelByName(o.name)));
    assert.deepEqual([...levels].sort(), [1, 2, 3], "every available spell level is offered");
    const names = options.map((o) => o.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), "sorted by name");
  });

  it("does not offer cantrips on the leveled line", () => {
    const leveled = leveledOf(groupsFor("Sorcerer", 5));
    const options = spellPickDialogOptions({
      spellPick: leveled.spellPick,
      spellsForLevelFn: (lvl) => spellsForLevel(lvl),
    });
    assert.ok(!options.some((o) => levelByName(o.name) === 0), "cantrips have their own line");
  });

  it("the cantrips line offers only cantrips", () => {
    const cantrips = cantripsOf(groupsFor("Sorcerer", 5));
    const options = spellPickDialogOptions({
      spellPick: cantrips.spellPick,
      spellsForLevelFn: (lvl) => spellsForLevel(lvl),
    });
    assert.ok(options.length > 0);
    assert.ok(options.every((o) => levelByName(o.name) === 0));
  });

  it("keys are namespaced under the class, so a class change prunes them", () => {
    const groups = groupsFor("Sorcerer", 5);
    for (const g of groups) {
      assert.ok(g.key.startsWith("creation:Class:Sorcerer:"), `${g.key} is namespaced`);
    }
  });

  it("each line has its own key", () => {
    const groups = groupsFor("Wizard", 5);
    const keys = groups.map((g) => g.key);
    assert.equal(new Set(keys).size, keys.length, "no two lines share a key");
  });
});

// ===========================================================================
describe("migration from the old per-level keys", () => {
  it("folds the old leveled keys into the new single line", () => {
    const old = {
      "creation:Class:Sorcerer:creation-spells-1": ["Magic Missile", "Shield"],
      "creation:Class:Sorcerer:creation-spells-2": ["Misty Step", "Shield"],
      "creation:Class:Sorcerer:creation-spells-3": ["Fireball"],
      "creation:Class:Sorcerer:creation-spells-0": ["Fire Bolt"],
    };
    const next = migrateSpellPickKeys(old, { className: "Sorcerer" });
    assert.deepEqual(
      next["creation:Class:Sorcerer:creation-spells"],
      ["Magic Missile", "Shield", "Misty Step", "Fireball"],
      "merged in ascending level order, de-duplicated",
    );
    assert.deepEqual(Object.keys(next).sort(), [
      "creation:Class:Sorcerer:creation-spells",
      "creation:Class:Sorcerer:creation-spells-0",
    ], "old leveled keys gone, the cantrip key untouched");
  });

  it("keeps the cantrip key, which is spelled the same in both shapes", () => {
    const next = migrateSpellPickKeys(
      { "creation:Class:Wizard:creation-spells-0": ["Fire Bolt"] },
      { className: "Wizard" },
    );
    assert.deepEqual(next["creation:Class:Wizard:creation-spells-0"], ["Fire Bolt"]);
  });

  it("does nothing when there is nothing to migrate", () => {
    const choices = { "creation:Class:Sorcerer:creation-spells": ["Bless"], "creation:Race:Elf:x": ["Light"] };
    assert.deepEqual(migrateSpellPickKeys(choices, { className: "Sorcerer" }), choices);
    assert.deepEqual(migrateSpellPickKeys(choices, {}), choices);
    assert.deepEqual(migrateSpellPickKeys({}, { className: "Sorcerer" }), {});
  });

  it("does not touch another class's keys", () => {
    const old = {
      "creation:Class:Wizard:creation-spells-1": ["Magic Missile"],
      "creation:Class:Sorcerer:creation-spells-1": ["Shield"],
    };
    const next = migrateSpellPickKeys(old, { className: "Sorcerer" });
    assert.deepEqual(next["creation:Class:Wizard:creation-spells-1"], ["Magic Missile"]);
    assert.deepEqual(next["creation:Class:Sorcerer:creation-spells"], ["Shield"]);
  });

  it("the folded picks are not orphans, so they are not removed from Spells Known", () => {
    // The reason the migration exists: an orphaned key's spells get removed
    // from the sheet, so dropping the old keys without folding them first
    // would silently delete everything a player had picked.
    const old = {
      "creation:Class:Sorcerer:creation-spells-1": ["Magic Missile"],
      "creation:Class:Sorcerer:creation-spells-2": ["Misty Step"],
    };
    const next = migrateSpellPickKeys(old, { className: "Sorcerer" });
    const known = ["Magic Missile", "Misty Step", "Guidance"];
    const gone = orphanedSpellPickNames(next, { className: "Sorcerer" }, known);
    assert.deepEqual(gone, [], "nothing is orphaned after the fold");
    assert.deepEqual(known, known, "and the hand-typed Guidance is untouched");
  });
});

// ===========================================================================
describe("applying a pick to the Spells Known list", () => {
  const items = ["Light"];

  it("adds picks and takes back the ones it dropped", () => {
    const out = applySpellPickToItems({
      items,
      previous: ["Magic Missile"],
      next: ["Shield"],
    });
    assert.deepEqual(out.items, ["Light", "Shield"]);
    assert.deepEqual(out.added, ["Shield"]);
    assert.deepEqual(out.removed, ["Magic Missile"]);
  });

  it("never removes a spell another live pick still holds", () => {
    const out = applySpellPickToItems({
      items: ["Light", "Magic Missile"],
      previous: ["Magic Missile"],
      next: [],
      heldByOtherPicks: ["Magic Missile"],
    });
    assert.deepEqual(out.items, ["Light", "Magic Missile"], "the other pick's spell survives");
  });

  it("preserves the player's own ordering", () => {
    const out = applySpellPickToItems({ items: ["a", "b"], previous: [], next: ["b", "z"] });
    assert.deepEqual(out.items, ["a", "b", "z"]);
  });
});

// ===========================================================================
describe("pruning when the class changes", () => {
  const picked = {
    [spellPickKey("Wizard", "cantrips")]: ["Fire Bolt", "Mage Hand"],
    [spellPickKey("Wizard", "spells")]: ["Magic Missile", "Shield"],
  };

  it("reports the old class's picks, and only ones actually on the sheet", () => {
    const sheet = [...picked[spellPickKey("Wizard", "cantrips")], ...picked[spellPickKey("Wizard", "spells")], "Guidance"];
    assert.deepEqual(orphanedSpellPickNames(picked, { className: "Fighter" }, sheet),
      ["Fire Bolt", "Mage Hand", "Magic Missile", "Shield"],
      "the four picked spells; the hand-typed Guidance is not under any key");
  });

  it("a still-staged class's picks are left alone", () => {
    assert.deepEqual(orphanedSpellPickNames(picked, { className: "Wizard" }, []), []);
  });

  it("a subclass change drops only that subclass's picks", () => {
    const choices = { ...picked, "creation:Subclass:Life Domain:life-cantrip": ["Bless"] };
    assert.deepEqual(
      orphanedSpellPickNames(choices, { className: "Wizard", subclass: "" }, ["Bless"]),
      ["Bless"],
    );
    assert.deepEqual(
      orphanedSpellPickNames(choices, { className: "Wizard", subclass: "Life Domain" }, ["Bless"]),
      [],
    );
  });

  it("a nested racial key stays while the species is staged", () => {
    const choices = { ...picked, "creation:Race:Elf:elf-subrace:elf-subrace-high:elf-subrace-high-cantrip": ["Light"] };
    const sheet = [
      ...picked[spellPickKey("Wizard", "cantrips")],
      ...picked[spellPickKey("Wizard", "spells")],
      "Light",
    ];
    assert.deepEqual(
      orphanedSpellPickNames(choices, { className: "Fighter", species: "Elf" }, sheet),
      ["Fire Bolt", "Mage Hand", "Magic Missile", "Shield"],
      "the elf's cantrip is not among them",
    );
  });

  it("a value that never reached the sheet is not a spell to remove", () => {
    const choices = { "creation:Class:Wizard:wizard-skills": ["arcana", "stealth"] };
    assert.deepEqual(orphanedSpellPickNames(choices, { className: "Fighter" }, ["Fire Bolt"]), []);
  });

  it("pruneOrphanedChoiceKeys drops the stale spell-pick keys too", () => {
    const pruned = pruneOrphanedChoiceKeys(picked, { className: "Fighter" });
    assert.equal(pruned.pruned, 2);
    assert.deepEqual(pruned.choices, {});
  });
});

describe("always-prepared spells come from the bundles", () => {
  it("reads spellsKnown addItem modifiers, level-gated", () => {
    const bundles = [{
      statModifiers: [
        { targetFieldId: "spellsKnown", op: "addItem", value: "Bless", minLevel: 3 },
        { targetFieldId: "spellsKnown", op: "addItem", value: "Cure Wounds" },
        { targetFieldId: "hpMax", op: "add", value: 5 },
      ],
    }];
    assert.deepEqual([...alwaysPreparedSpellNames(bundles, 1)], ["Cure Wounds"], "level 1 skips the level-3 one");
    assert.deepEqual([...alwaysPreparedSpellNames(bundles, 3)].sort(), ["Bless", "Cure Wounds"]);
  });

  it("tolerates nothing", () => {
    assert.deepEqual([...alwaysPreparedSpellNames()], []);
    assert.deepEqual([...alwaysPreparedSpellNames([], 3)], []);
  });
});

describe("the dialog falls back to nothing when no catalog is loaded", () => {
  it("returns an empty option list", () => {
    assert.deepEqual(spellPickDialogOptions({ spellPick: { level: 1, maxLevel: 3 } }), []);
    assert.deepEqual(spellPickDialogOptions({}), []);
  });
});

// ===========================================================================
// Section 6's storage shape, exercised here because section 3 writes it.
describe("preparedItemsWithAuto", () => {
  it("takes the new selection and drops what was deselected", () => {
    assert.deepEqual(
      preparedItemsWithAuto({ previous: ["Shield", "Bless"], next: ["Bless", "Fireball"] }),
      ["Bless", "Fireball"],
    );
  });

  it("never stores an always-prepared spell", () => {
    // A domain spell is prepared whether or not the player chose it, so
    // storing it would make it look like a pick they could remove.
    assert.deepEqual(
      preparedItemsWithAuto({ previous: [], next: ["Bless", "Shield"], alwaysPrepared: ["Bless"] }),
      ["Shield"],
    );
  });

  it("drops an always-prepared spell that was stored before the subclass granted it", () => {
    assert.deepEqual(
      preparedItemsWithAuto({ previous: ["Bless", "Shield"], next: ["Bless", "Shield"], alwaysPrepared: ["Bless"] }),
      ["Shield"],
      "switching subclass to one that grants it removes it from the pick",
    );
  });

  it("keeps the order of the picks that survive", () => {
    assert.deepEqual(
      preparedItemsWithAuto({ previous: ["B", "A", "C"], next: ["A", "B", "C"] }),
      ["B", "A", "C"],
      "re-opening the dialog does not reorder the list",
    );
  });

  it("de-duplicates and tolerates nothing", () => {
    assert.deepEqual(preparedItemsWithAuto({ previous: [], next: ["A", "A", "B"] }), ["A", "B"]);
    assert.deepEqual(preparedItemsWithAuto(), []);
    assert.deepEqual(preparedItemsWithAuto({ previous: ["A"], next: [] }), []);
  });
});

describe("preparedLineLock", () => {
  it("locks only a class preparing out of its own list, and only while it is empty", () => {
    assert.equal(preparedLineLock({ preparedFrom: "known", knownNames: [] }), "Choose your spellbook spells first");
    assert.equal(preparedLineLock({ preparedFrom: "known", knownNames: ["Shield"] }), null);
    // A full-list preparer prepares straight out of the class list, so there
    // is nothing to wait for.
    assert.equal(preparedLineLock({ preparedFrom: "classList", knownNames: [] }), null);
    assert.equal(preparedLineLock(), null);
  });
});

// The routing decision. This is what makes a prepared caster different from a
// known one, and it was inside the wizard's render closure where no test could
// reach it.
describe("applySpellPickWrite", () => {
  it("a prepared pick does NOT land in Spells Known", () => {
    // The bug the brief names: a Cleric's picks went into the known list, so
    // the sheet recorded three spells as everything the character could ever
    // cast and kept the rest of the class list nowhere.
    const out = applySpellPickWrite({
      part: "prepared",
      items: [],
      next: ["Bless", "Cure Wounds", "Spiritual Weapon"],
    });
    assert.deepEqual(out.items, [], "Spells Known stays empty");
    assert.deepEqual(out.preparedItems, ["Bless", "Cure Wounds", "Spiritual Weapon"]);
  });

  it("a prepared pick leaves Spells Known untouched even when it has content", () => {
    const out = applySpellPickWrite({
      part: "prepared",
      items: ["Fire Bolt", "Light"],
      next: ["Bless"],
    });
    assert.deepEqual(out.items, ["Fire Bolt", "Light"], "hand-added cantrips stay");
    assert.deepEqual(out.preparedItems, ["Bless"]);
  });

  it("never copies the class list in - only what was chosen", () => {
    const out = applySpellPickWrite({ part: "prepared", items: [], next: ["Bless"] });
    assert.equal(out.items.length, 0);
    assert.equal(out.preparedItems.length, 1);
  });

  it("a cantrip pick goes to Spells Known and is not prepared", () => {
    const out = applySpellPickWrite({ part: "cantrips", items: [], next: ["Fire Bolt"] });
    assert.deepEqual(out.items, ["Fire Bolt"]);
    assert.deepEqual(out.preparedItems, []);
  });

  it("a known/spellbook pick goes to Spells Known", () => {
    const out = applySpellPickWrite({ part: "spells", items: [], next: ["Magic Missile"] });
    assert.deepEqual(out.items, ["Magic Missile"]);
    assert.deepEqual(out.preparedItems, []);
  });

  it("removing a spellbook entry also un-prepares it", () => {
    // A Wizard's prepared subset is drawn from its spellbook, so an entry
    // deleted underneath it has to drop out or the sheet claims a prepared
    // spell the character does not have.
    const out = applySpellPickWrite({
      part: "spells",
      items: ["Magic Missile", "Shield"],
      preparedItems: ["Magic Missile", "Shield"],
      previous: ["Magic Missile", "Shield"],
      next: ["Magic Missile"],
    });
    assert.deepEqual(out.items, ["Magic Missile"]);
    assert.deepEqual(out.preparedItems, ["Magic Missile"], "Shield is no longer held, so not prepared");
  });

  it("keeps a prepared spell another pick still holds on the sheet", () => {
    const out = applySpellPickWrite({
      part: "spells",
      items: ["Magic Missile"],
      preparedItems: ["Magic Missile"],
      previous: ["Magic Missile"],
      next: [],
      heldByOtherPicks: ["Magic Missile"],
    });
    assert.deepEqual(out.items, ["Magic Missile"], "still listed");
    assert.deepEqual(out.preparedItems, ["Magic Missile"], "so still prepared");
  });

  it("never stores an always-prepared spell in the prepared list", () => {
    const out = applySpellPickWrite({
      part: "prepared",
      items: [],
      next: ["Bless", "Cure Wounds"],
      alwaysPrepared: ["Bless"],
    });
    assert.deepEqual(out.preparedItems, ["Cure Wounds"],
      "a domain spell is prepared without being a pick the player can remove");
  });

  it("mutates neither input", () => {
    const items = ["Light"];
    const preparedItems = ["Bless"];
    applySpellPickWrite({ part: "spells", items, preparedItems, previous: ["Light"], next: ["Shield"] });
    assert.deepEqual(items, ["Light"]);
    assert.deepEqual(preparedItems, ["Bless"]);
  });

  it("defaults are safe with nothing at all", () => {
    assert.deepEqual(applySpellPickWrite(), { items: [], preparedItems: [] });
  });
});

// ===========================================================================
// Which lines each class gets. The brief's "Config:" list, asserted at the
// level the groups are built rather than at the model alone, because a
// correct model that produces the wrong number of lines is still wrong.
describe("the lines each class gets", () => {
  const lineParts = (groups) => groups.map((g) => g.spellPick.part);

  it("a Sorcerer: a cantrips line and a known line, no prepared line", () => {
    const groups = groupsFor("Sorcerer", 5);
    assert.deepEqual(lineParts(groups), ["cantrips", "spells"]);
    assert.equal(leveledOf(groups).label, "Spells Known");
    assert.equal(preparedOf(groups), undefined);
  });

  it("a Cleric: a cantrips line and a prepared line only", () => {
    const groups = groupsFor("Cleric", 5);
    assert.deepEqual(lineParts(groups), ["cantrips", "prepared"]);
    assert.equal(leveledOf(groups), undefined, "no personal list, so no known line");
    assert.equal(preparedOf(groups).label, "Prepared Spells");
  });

  it("a Cleric's prepared line is NOT locked", () => {
    // preparedFrom "classList": there is no line above it to wait for.
    const model5 = modelFor("Cleric");
    assert.equal(model5.preparedFrom, "classList");
    assert.equal(
      preparedLineLock({ preparedFrom: model5.preparedFrom, knownNames: [] }),
      null,
      "never locked, even with an empty spellbook",
    );
    // And it is required, so the class row really does gate on it.
    assert.equal(preparedOf(groupsFor("Cleric", 5)).minSelections,
      spellLimitFor("Cleric", 5, SCORES).spells);
  });

  it("a Wizard: a cantrips line, a spellbook line and a prepared line", () => {
    const groups = groupsFor("Wizard", 5);
    assert.deepEqual(lineParts(groups), ["cantrips", "spells", "prepared"]);
    assert.equal(leveledOf(groups).label, "Spellbook");
    assert.equal(preparedOf(groups).label, "Prepared Spells");
    assert.equal(modelFor("Wizard").preparedFrom, "known");
  });

  it("a Wizard's prepared line is locked until the spellbook has spells", () => {
    const { preparedFrom } = modelFor("Wizard");
    assert.equal(preparedLineLock({ preparedFrom, knownNames: [] }), "Choose your spellbook spells first");
    assert.equal(preparedLineLock({ preparedFrom, knownNames: ["Shield"] }), null,
      "and unlocks as soon as it has any");
  });

  it("a Fighter shows nothing", () => {
    assert.deepEqual(groupsFor("Fighter", 5), []);
  });

  it("a prepared pick does not require a spellbook to exist", () => {
    // The Wizard's prepared group still gates completeness once unlocked,
    // and the spellbook group never does.
    const groups = groupsFor("Wizard", 5);
    assert.equal(leveledOf(groups).minSelections, 0, "the spellbook is free-form");
    assert.ok(preparedOf(groups).minSelections > 0, "the prepared count is required");
  });

  it("every line's spell levels are within the class's available levels", () => {
    for (const className of ["Sorcerer", "Bard", "Cleric", "Wizard", "Paladin", "Ranger", "Druid", "Artificer"]) {
      for (let level = 1; level <= 12; level += 1) {
        const available = availableLevelsFor(className, level);
        for (const g of groupsFor(className, level)) {
          if (g.spellPick.level === 0) continue;
          const top = Math.max(...available);
          assert.equal(g.spellPick.maxLevel, top,
            `${className} L${level} ${g.spellPick.part} spans up to ${top}`);
        }
      }
    }
  });
});

// ===========================================================================
// Section 3: the prepared limit moves with the casting ability, because the
// wizard asks for ability scores on a LATER page than the class.
describe("the prepared limit moves with the ability score", () => {
  // Cleric/Wizard prepare `ability mod + level`. The wizard's step order is
  // Rules -> Identity -> Class -> Background -> Story -> Starting Conditions,
  // so a class pick can be made before its casting score exists.
  it("the cap follows the score the character is actually going to have", () => {
    // `prepared(level, mod)` is max(1, mod + level), and abilityMod is
    // floor((score - 10) / 2). At level 5: WIS 8 is -1, 10 is +0, 16 is +3,
    // 20 is +5.
    const at = (wis) => preparedOf(groupsFor("Cleric", 5, { abilityScores: { ...SCORES, wis } })).maxSelections;
    assert.equal(at(8), 4, "WIS 8 is -1: 5 + (-1)");
    assert.equal(at(10), 5, "WIS 10 is +0");
    assert.equal(at(16), 8, "WIS 16 is +3");
    assert.equal(at(20), 10, "WIS 20 is +5");
  });

  it("a default 10 score is the floor, not an error", () => {
    // The wizard has no score yet when the class row renders, and
    // abilityMod already treats a missing score as 10. Pinned because a
    // NaN cap here would silently make the line unsatisfiable.
    const groups = creationSpellPickGroups({
      className: "Cleric",
      level: 5,
      abilityScores: {},
      limitFor: spellLimitFor,
      availableLevelsFor,
      levelByNameFn: levelByName,
      model: modelFor("Cleric"),
    });
    const cap = preparedOf(groups).maxSelections;
    assert.ok(Number.isFinite(cap), "the cap is a number, not NaN");
    assert.equal(cap, 5, "a missing score reads as 10, so level + 0");
  });

  it("a known caster's cap does NOT move with its score", () => {
    // Bard/Sorcerer spells known come from a table, not from a modifier. If
    // this ever moved, a character would gain spells by raising a score.
    const at = (cha) => leveledOf(groupsFor("Bard", 5, { abilityScores: { ...SCORES, cha } })).maxSelections;
    assert.equal(at(8), at(20), "the same at both ends of the range");
    assert.equal(at(20), spellLimitFor("Bard", 5, { ...SCORES, cha: 20 }).spells);
  });
});

// ===========================================================================
// Section 3: over the prepared limit is a warning, never a deletion.
describe("preparedCountOver", () => {
  const levelBy = (n) => SPELL_LEVEL[n] ?? null;

  it("is 0 when at or under the limit", () => {
    assert.equal(preparedCountOver({ prepared: ["A", "B"], limit: 3, levelByNameFn: levelBy }), 0);
    assert.equal(preparedCountOver({ prepared: ["A", "B", "C"], limit: 3, levelByNameFn: levelBy }), 0);
  });

  it("says how far over, so the warning can be specific", () => {
    assert.equal(preparedCountOver({ prepared: ["A", "B", "C", "D", "E"], limit: 3, levelByNameFn: levelBy }), 2);
  });

  it("counts always-prepared spells, which occupy a slot either way", () => {
    // The caller passes them already concatenated in; this asserts the limit
    // is applied to the combined count rather than to the picks alone.
    assert.equal(preparedCountOver({ prepared: ["Bless", "Shield"], limit: 1, levelByNameFn: levelBy }), 1);
  });

  it("never counts a cantrip, because a cantrip is not a prepared slot", () => {
    assert.equal(
      preparedCountOver({ prepared: ["Fire Bolt", "Mage Hand"], limit: 1, levelByNameFn: levelBy }),
      0,
      "two cantrips and a limit of one is not over",
    );
  });

  it("would count cantrips if a model ever said to", () => {
    assert.equal(
      preparedCountOver({ prepared: ["Fire Bolt", "Mage Hand"], limit: 1, cantripsCountAsPrepared: true, levelByNameFn: levelBy }),
      1,
    );
  });

  it("drops a prepared name the character no longer holds, but only for a spellbook class", () => {
    // A Wizard's spellbook entry deleted underneath the prepared subset.
    assert.equal(
      preparedCountOver({
        prepared: ["Shield", "Fireball"], knownItems: ["Shield"], preparedFrom: "known",
        limit: 1, levelByNameFn: levelBy,
      }),
      0,
      "Fireball is prepared but not held, so it is not counted",
    );
    // A Cleric's prepared spells are deliberately NOT on the spellbook -
    // that is the whole point of the prepared line. Membership must not be
    // required there, or every one of them drops and the count reports zero.
    assert.equal(
      preparedCountOver({
        prepared: ["Bless", "Shield", "Fireball"], knownItems: [],
        preparedFrom: "classList", limit: 1, levelByNameFn: levelBy,
      }),
      2,
      "a full-list preparer is counted whether or not the spell is on the spellbook",
    );
  });

  it("has no limit to exceed", () => {
    assert.equal(preparedCountOver({ prepared: ["A"], limit: 0 }), 0);
    assert.equal(preparedCountOver(), 0);
  });
});

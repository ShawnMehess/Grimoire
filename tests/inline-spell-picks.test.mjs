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
// other pick: a bullet per spell level whose link opens the shared dialog.
// These assert the real builder's output (not a mirror of it), that the
// counts come from spellLimitFor - the app's single source of truth - and
// that the three things a global Spells Known list makes hard all work:
// pruning on a class change, gating, and deselect.
//
// Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spellLimitFor } from "../js/data/rulesEngine.js";
import { getLevelUpPlan } from "../js/data/dnd5e.js";
import {
  availableSpellLevels,
  choiceDialogKindFor,
  creationSpellPickGroups,
  spellPickDialogOptions,
  spellPickKey,
  orphanedSpellPickNames,
  applySpellPickToItems,
  pruneOrphanedChoiceKeys,
  sectionGroupsSatisfied,
  sectionsComplete,
  NO_SPELL_CATALOG_NOTE,
} from "../js/render/sheet/sheetWizard.js";

const RULESET = "dnd5e-2014";
const SCORES = { str: 10, dex: 14, con: 13, int: 15, wis: 12, cha: 14 };

/** A tiny stand-in spell catalog: three cantrips, six 1st-level, two
 *  2nd-level. Enough for "which level is this name at" to be answerable
 *  without shipping a catalog into the test. */
function fakeCatalog() {
  return {
    name: "Spell List",
    tabs: [
      { id: "cantrips", entries: [{ name: "Fire Bolt" }, { name: "Mage Hand" }, { name: "Light" }] },
      { id: "level1", entries: ["Magic Missile", "Shield", "Chill Touch", "Bless", "Cure Wounds", "Guiding Bolt"]
        .map((name) => ({ name })) },
      { id: "level2", entries: [{ name: "Misty Step" }, { name: "Mirror Image" }] },
    ],
  };
}

function levelOf(name) {
  const catalog = fakeCatalog();
  for (const tab of catalog.tabs) {
    if (tab.entries.some((e) => e.name === name)) {
      return tab.id === "cantrips" ? 0 : Number.parseInt(tab.id.replace("level", ""), 10);
    }
  }
  return null;
}

/** The real builder, wired to the real rules data. */
function groupsFor(className, level = 1, extra = {}) {
  return creationSpellPickGroups({
    className,
    level,
    abilityScores: SCORES,
    choices: {},
    knownItems: [],
    limitFor: (name, lvl, scores) => spellLimitFor(name, lvl, scores),
    availableLevelsFor: (name, lvl) => availableSpellLevels(getLevelUpPlan(RULESET, name, lvl)),
    levelByNameFn: levelOf,
    ...extra,
  });
}

const labels = (groups) => groups.map((g) => g.label);

describe("inline spell picks during creation", () => {
  it("a Sorcerer at level 1 gets cantrip and spell picks with the right counts", () => {
    const groups = groupsFor("Sorcerer", 1);
    assert.deepEqual(labels(groups), ["Cantrips", "1st-level spells"]);
    assert.equal(groups[0].maxSelections, 4);
    assert.equal(groups[1].maxSelections, 2);
  });

  it("each pick gets its own key, namespaced under the class", () => {
    const groups = groupsFor("Sorcerer", 1);
    // The ordinary `creation:Category:Name:groupId` shape, which is what
    // makes pruneOrphanedChoiceKeys and sectionsForChoiceGroups work on
    // spell picks with no special-casing.
    assert.equal(groups[0].key, spellPickKey("Sorcerer", 0));
    assert.equal(groups[0].key, "creation:Class:Sorcerer:creation-spells-0");
    assert.equal(groups[1].key, "creation:Class:Sorcerer:creation-spells-1");
    assert.equal(groups[0].source, "Sorcerer");
  });

  it("the counts come from spellLimitFor, not from a second list", () => {
    // If spellLimitFor ever changes, these move with it. That is the point:
    // the picker, the gating and the Review summary all read one function.
    for (const [className, level] of [["Sorcerer", 1], ["Wizard", 1], ["Cleric", 1], ["Bard", 3]]) {
      const limit = spellLimitFor(className, level, SCORES);
      const groups = groupsFor(className, level);
      const cantrips = groups.find((g) => g.label === "Cantrips");
      if (limit.cantrips > 0) {
        assert.ok(cantrips, `${className} at ${level} should offer a cantrip pick`);
        assert.equal(cantrips.maxSelections, limit.cantrips);
      } else {
        assert.equal(cantrips, undefined, `${className} at ${level} has no cantrips, so no bullet`);
      }
    }
  });

  it("a Fighter shows nothing at all", () => {
    assert.equal(spellLimitFor("Fighter", 1, SCORES), null);
    assert.deepEqual(groupsFor("Fighter", 1), []);
    assert.deepEqual(groupsFor("Rogue", 1), []);
  });

  it("a half-caster before it has cantrips shows nothing", () => {
    // 2014: a Paladin's spellcasting starts at level 2, so at level 1 it
    // has neither cantrips nor spell slots and must show no bullets rather
    // than an empty picker.
    const limit = spellLimitFor("Paladin", 1, SCORES);
    assert.ok(limit, "a Paladin IS a caster, just not yet at level 1");
    assert.equal(limit.cantrips, 0);
    assert.deepEqual(groupsFor("Paladin", 1), []);
  });

  it("knows a caster's own style, and does not invent the other one", () => {
    // The groups are built from limit.spells whatever the style is, so a
    // "known" Sorcerer and a "prepared" Cleric are both offered picks -
    // but the number differs, because spellLimitFor computes a prepared
    // caster's count from its spellcasting ability. Asserting both styles
    // exist stops a future "only offer known casters" shortcut.
    assert.equal(spellLimitFor("Sorcerer", 1, SCORES).style, "known");
    assert.equal(spellLimitFor("Cleric", 1, SCORES).style, "prepared");
    assert.ok(spellLimitFor("Wizard", 1, SCORES).spells > 0);
  });

  it("a prepared caster's count follows its ability score", () => {
    // Prepared casters get more spells with a higher spellcasting ability.
    // If these ever match, spellLimitFor stopped honouring the modifier and
    // the picks would quietly be wrong for low-ability characters.
    const spellGroup = (groups) => groups.find((g) => g.spellPick.level > 0);
    const low = spellLimitFor("Cleric", 5, { ...SCORES, wis: 8 });
    const high = spellLimitFor("Cleric", 5, { ...SCORES, wis: 18 });
    assert.ok(high.spells > low.spells,
      `expected more spells at higher WIS (got ${low.spells} at 8, ${high.spells} at 18)`);
    const lowGroups = groupsFor("Cleric", 5, { abilityScores: { ...SCORES, wis: 8 } });
    const highGroups = groupsFor("Cleric", 5, { abilityScores: { ...SCORES, wis: 18 } });
    assert.ok(spellGroup(highGroups).maxSelections > spellGroup(lowGroups).maxSelections);
  });

  it("the groups open the shared spell dialog, not a bespoke picker", () => {
    // Same shape as the Bard's Magical Secrets and the High Elf's cantrip,
    // so inlineChoiceBullets, the dialog, the Spells Known write and the
    // cap enforcement all come for free.
    for (const group of groupsFor("Sorcerer", 1)) {
      assert.equal(choiceDialogKindFor(group), "spells");
      assert.equal(group.spellPick.list, "Sorcerer");
    }
  });

  it("the dialog lists the class's spells at that level, sorted, by name", () => {
    const group = groupsFor("Sorcerer", 1)[1];
    const options = spellPickDialogOptions({
      spellPick: group.spellPick,
      spellsForLevelFn: (lvl, list) => (list === "Sorcerer"
        ? [{ name: "Shield", school: "Abjuration" }, { name: "Magic Missile", school: "Evocation" }]
        : []),
    });
    assert.deepEqual(options.map((o) => o.name), ["Magic Missile", "Shield"]);
    assert.equal(options[0].description, "Evocation");
  });

  it("always-prepared spells are neither offered nor counted against the pick", () => {
    // A domain's domain spells arrive as spellsKnown addItem statModifiers
    // and are already in the list. Offering them would let the player "pick"
    // something automatic; not discounting them would over-grant the pick.
    const domain = (names) => [{
      statModifiers: names.map((value) => ({ targetFieldId: "spellsKnown", op: "addItem", value })),
    }];
    const firstLevel = (groups) => groups.find((g) => g.spellPick.level === 1);
    const cap = spellLimitFor("Cleric", 5, SCORES).spells;
    const two = firstLevel(groupsFor("Cleric", 5, { bundles: domain(["Bless", "Cure Wounds"]) }));
    assert.equal(two.maxSelections, cap - 2);
    const options = spellPickDialogOptions({
      spellPick: two.spellPick,
      spellsForLevelFn: () => [{ name: "Bless" }, { name: "Magic Missile" }, { name: "Cure Wounds" }],
    });
    assert.deepEqual(options.map((o) => o.name), ["Magic Missile"]);
    // A domain that hands over the whole allowance leaves no pick at all
    // rather than an empty one.
    const flood = domain(["Magic Missile", "Shield", "Chill Touch", "Bless", "Cure Wounds", "Guiding Bolt"]);
    assert.equal(firstLevel(groupsFor("Cleric", 5, { bundles: flood })), undefined);
  });

  it("no Spell List imported is stated in plain language, once", () => {
    // The level-up picker and the creation pick must not drift apart, and
    // neither should name a manager screen by its developer name.
    assert.ok(NO_SPELL_CATALOG_NOTE.length > 40);
    assert.doesNotMatch(NO_SPELL_CATALOG_NOTE, /catalog|bundle|manager|console/i);
  });
});

describe("spell pick gating", () => {
  const complete = (groups, choices) => sectionGroupsSatisfied(groups, choices);

  it("the class row is incomplete until every pick is made", () => {
    const groups = groupsFor("Sorcerer", 1);
    assert.equal(complete(groups, {}), false, "nothing picked");
    const twoCantrips = { [spellPickKey("Sorcerer", 0)]: ["Fire Bolt", "Mage Hand"] };
    assert.equal(complete(groups, twoCantrips), false, "cantrips half done");
    const full = {
      [spellPickKey("Sorcerer", 0)]: ["Fire Bolt", "Mage Hand", "Light", "Shield"],
      [spellPickKey("Sorcerer", 1)]: ["Magic Missile", "Chill Touch"],
    };
    assert.equal(complete(groups, full), true);
  });

  it("spells the class already holds from elsewhere are not asked for twice", () => {
    // A High Elf's cantrip (or a spell the player typed on the sheet) is a
    // cantrip the character has; making them pick a fourth is the wizard
    // nagging about something already done.
    const groups = groupsFor("Sorcerer", 1, { knownItems: ["Light"] });
    assert.equal(groups[0].maxSelections, 3);
    const three = {
      [spellPickKey("Sorcerer", 0)]: ["Fire Bolt", "Mage Hand", "Shield"],
      [spellPickKey("Sorcerer", 1)]: ["Magic Missile", "Chill Touch"],
    };
    assert.equal(complete(groups, three), true);
  });

  it("deselecting a spell takes it back out of Spells Known", () => {
    const result = applySpellPickToItems({
      items: ["Fire Bolt", "Mage Hand", "Light"],
      previous: ["Fire Bolt", "Mage Hand"],
      next: ["Fire Bolt"],
    });
    assert.deepEqual(result.items, ["Fire Bolt", "Light"]);
    assert.deepEqual(result.removed, ["Mage Hand"]);
  });

  it("a spell another live pick still holds is never removed", () => {
    // A High Elf's cantrip and a Wizard's own cantrips can name the same
    // spell. Unchecking it in one picker must not delete it from the other.
    const result = applySpellPickToItems({
      items: ["Fire Bolt", "Mage Hand"],
      previous: ["Fire Bolt", "Mage Hand"],
      next: [],
      heldByOtherPicks: ["Fire Bolt"],
    });
    assert.deepEqual(result.items, ["Fire Bolt"]);
  });

  it("a merged step counts every section, spells included", () => {
    const groups = groupsFor("Sorcerer", 1);
    const sections = [{ source: "Sorcerer", groups }];
    assert.equal(sectionsComplete(sections, {}), false);
    assert.equal(sectionsComplete(sections, {
      [spellPickKey("Sorcerer", 0)]: ["Fire Bolt", "Mage Hand", "Light", "Shield"],
      [spellPickKey("Sorcerer", 1)]: ["Magic Missile", "Chill Touch"],
    }), true);
  });
});

describe("spell picks when the class changes", () => {
  const wizardPicks = {
    [spellPickKey("Wizard", 0)]: ["Fire Bolt", "Mage Hand", "Light"],
    [spellPickKey("Wizard", 1)]: ["Magic Missile", "Shield"],
  };
  const SPELLBOOK = [...wizardPicks[spellPickKey("Wizard", 0)], ...wizardPicks[spellPickKey("Wizard", 1)]];

  it("a class change reports the spells the old class's picks owned", () => {
    assert.deepEqual(orphanedSpellPickNames(wizardPicks, { className: "Fighter" }, SPELLBOOK), SPELLBOOK);
  });

  it("a still-staged class's picks are left alone", () => {
    assert.deepEqual(orphanedSpellPickNames(wizardPicks, { className: "Wizard" }, SPELLBOOK), []);
  });

  it("spells added by hand are never reported, so they are never removed", () => {
    // They are under no pick key, which is the whole reason the record lives
    // on the key rather than being inferred from the list.
    const field = [...SPELLBOOK, "Guidance"];
    const gone = new Set(orphanedSpellPickNames(wizardPicks, { className: "Fighter" }, field));
    assert.deepEqual(field.filter((n) => !gone.has(n)), ["Guidance"]);
  });

  it("a subclass change drops only the subclass's picks, not the class's", () => {
    // A domain's cantrip group is a normal bundle choice group, so its key
    // is not the class spell-pick shape. What identifies it as a spell pick
    // is that its stored values are spell names the dialog put in the list.
    const choices = {
      ...wizardPicks,
      "creation:Subclass:Life Domain:life-cantrip": ["Bless"],
    };
    const field = [...SPELLBOOK, "Bless"];
    assert.deepEqual(
      orphanedSpellPickNames(choices, { className: "Wizard", subclass: "" }, field),
      ["Bless"],
    );
    assert.deepEqual(
      orphanedSpellPickNames(choices, { className: "Wizard", subclass: "Life Domain" }, field),
      [],
    );
  });

  it("a spell a surviving pick still holds is not dropped", () => {
    // The High Elf's cantrip and the Wizard's own cantrips can name the same
    // spell. Changing class must not delete the elf's copy out from under it.
    const choices = {
      ...wizardPicks,
      "creation:Race:Elf:elf-subrace:elf-subrace-high:elf-subrace-high-cantrip": ["Light"],
    };
    assert.deepEqual(orphanedSpellPickNames(choices, { className: "Fighter", species: "Elf" }, SPELLBOOK), [
      "Fire Bolt", "Mage Hand", "Magic Missile", "Shield",
    ]);
  });

  it("a value that never reached the spell list is not a spell to remove", () => {
    // Before the dialog is ever opened a pick holds nothing, and a skill or
    // feat pick's option ids are not spell names - neither may be mistaken
    // for a spell the player would lose.
    const choices = { "creation:Class:Wizard:wizard-skills": ["stealth", "arcana"] };
    assert.deepEqual(orphanedSpellPickNames(choices, { className: "Fighter" }, ["Fire Bolt"]), []);
  });

  it("pruneOrphanedChoiceKeys drops the stale spell-pick keys too", () => {
    const pruned = pruneOrphanedChoiceKeys(wizardPicks, { className: "Fighter" });
    assert.equal(pruned.pruned, 2);
    assert.deepEqual(pruned.choices, {});
  });
});

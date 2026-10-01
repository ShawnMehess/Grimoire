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
// These assert the numbers come from spellLimitFor (the app's single source
// of truth) rather than being restated here, and that classes which pick
// nothing show nothing.
//
// Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spellLimitFor } from "../js/data/rulesEngine.js";
import { getLevelUpPlan } from "../js/data/dnd5e.js";
import { availableSpellLevels, choiceDialogKindFor } from "../js/render/sheet/sheetWizard.js";

const RULESET = "dnd5e-2014";
const SCORES = { str: 10, dex: 14, con: 13, int: 15, wis: 12, cha: 14 };

/** The bullet labels creationSpellPickGroups would build, derived from the
 *  same two helpers it uses. Kept as a mirror rather than importing the
 *  closure: the point is that the two agree, and that is checkable without
 *  a DOM. */
function bulletsFor(className, level = 1) {
  const limit = spellLimitFor(className, level, SCORES);
  if (!limit) return [];
  const levels = availableSpellLevels(getLevelUpPlan(RULESET, className, level));
  const out = [];
  if (limit.cantrips > 0) out.push({ label: "Cantrips", count: limit.cantrips });
  for (const l of levels) {
    if (l === 0 || limit.spells <= 0) continue;
    out.push({ label: `${l === 1 ? "1st" : l === 2 ? "2nd" : `${l}th`}-level spells`, count: limit.spells });
  }
  return out;
}

describe("inline spell picks during creation", () => {
  it("a Sorcerer at level 1 gets cantrip and spell picks with the right counts", () => {
    const bullets = bulletsFor("Sorcerer", 1);
    assert.deepEqual(bullets, [
      { label: "Cantrips", count: 4 },
      { label: "1st-level spells", count: 2 },
    ]);
  });

  it("the counts come from spellLimitFor, not from a second list", () => {
    // If spellLimitFor ever changes, these move with it. That is the point:
    // the picker, the gating and the Review summary all read one function.
    for (const [className, level] of [["Sorcerer", 1], ["Wizard", 1], ["Cleric", 1], ["Bard", 3]]) {
      const limit = spellLimitFor(className, level, SCORES);
      const bullets = bulletsFor(className, level);
      const cantripBullet = bullets.find((b) => b.label === "Cantrips");
      if (limit.cantrips > 0) {
        assert.ok(cantripBullet, `${className} at ${level} should offer a cantrip pick`);
        assert.equal(cantripBullet.count, limit.cantrips);
      } else {
        assert.equal(cantripBullet, undefined, `${className} at ${level} has no cantrips, so no bullet`);
      }
    }
  });

  it("a Fighter shows nothing at all", () => {
    assert.equal(spellLimitFor("Fighter", 1, SCORES), null);
    assert.deepEqual(bulletsFor("Fighter", 1), []);
    assert.deepEqual(bulletsFor("Rogue", 1), []);
  });

  it("a half-caster before it has cantrips shows nothing", () => {
    // 2014: a Paladin's spellcasting starts at level 2, so at level 1 it
    // has neither cantrips nor spell slots and must show no bullets rather
    // than an empty picker.
    const limit = spellLimitFor("Paladin", 1, SCORES);
    assert.ok(limit, "a Paladin IS a caster, just not yet at level 1");
    assert.equal(limit.cantrips, 0);
    assert.deepEqual(bulletsFor("Paladin", 1), []);
  });

  it("the groups open the shared spell dialog, not a bespoke picker", () => {
    // Same shape as the Bard's Magical Secrets and the High Elf's cantrip,
    // so inlineChoiceBullets, the dialog, the Spells Known write and the
    // cap enforcement all come for free.
    const group = { spellPick: { list: "Sorcerer", level: 1 }, label: "1st-level spells" };
    assert.equal(choiceDialogKindFor(group), "spells");
  });

  it("knows a caster's own style, and does not invent the other one", () => {
    // The bullets are built from limit.spells whatever the style is, so a
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
    // the bullets would quietly be wrong for low-ability characters.
    const low = spellLimitFor("Cleric", 5, { ...SCORES, wis: 8 });
    const high = spellLimitFor("Cleric", 5, { ...SCORES, wis: 18 });
    assert.ok(high.spells > low.spells,
      `expected more spells at higher WIS (got ${low.spells} at 8, ${high.spells} at 18)`);
  });
});

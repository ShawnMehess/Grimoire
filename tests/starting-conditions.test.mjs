// tests/starting-conditions.test.mjs
//
// The creation wizard used to end with ... Abilities, Spells, Gear,
// Review. Spells and Gear are gone as tabs - both live in the catalogs
// now - and what they uniquely held had to be rehomed before they went:
//
//   starting equipment   -> the "Starting Conditions" step
//   equipment profs      -> a new block on the main sheet
//   innate abilities     -> the Review step
//   Bard Magical Secrets -> a picker on the Bard's class entry
//
// These pin each of those, because every one of them is invisible if it
// silently stops being wired up: the step renders, the sheet renders, and
// the feature is simply gone.
//
// Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createStarterLayout } from "../js/data/blockModel.js";
import { FIXED_CLASS_ENTRIES } from "../js/data/contentFixups.js";
import { MAGICAL_SECRETS_UNLOCKS, magicalSecretsUnlocked, magicalSecretsMaxSpellLevel } from "../js/data/magicalSecrets.js";

const entries = (x) => (x instanceof Map ? [...x] : Object.entries(x || {}));
const bardBundle = () => entries(FIXED_CLASS_ENTRIES).find(([, e]) => e.name === "Bard")?.[1]?.bundle;

describe("the wizard has no Spells or Gear tab", () => {
  const src = fs.readFileSync(new URL("../js/render/customSheet.js", import.meta.url), "utf8");

  it("parks both steps as comments, with a reason", () => {
    // Commented, not deleted, at the user's request. The banner has to
    // survive, because a future audit that flags the block as dead code
    // needs the reason it is parked and the note that every renderer in it
    // is still called from elsewhere.
    assert.match(src, /COMMENTED OUT[^\n]*DO NOT DELETE DURING A CODE AUDIT/);
    assert.match(src, /Magical Secrets moved to/);
    assert.match(src, /renderStartingEquipmentStepInto moved to the/);
    assert.match(src, /renderInnateAbilitiesStepInto moved to Review/);
  });

  it("leaves no live Spells or Gear step in the CREATION wizard", () => {
    // A live `id: "spells"` or `id: "gear"` here would put the tab back.
    // Scoped to the creation steps array on purpose: the LEVEL-UP guide
    // has its own Spells step, which stays - that is how you learn spells
    // as you level, and it is not the creation tab that was removed.
    const creation = src.slice(src.indexOf("const steps = ["));
    const creationEnd = creation.indexOf("renderStepWizard(steps, creationWizardState");
    const live = creation.slice(0, creationEnd).split("\n")
      .filter((l) => /^\s*id: "(spells|gear)",/.test(l));
    assert.deepEqual(live, [], "a spells/gear step is still live in the creation wizard");
  });

  it("keeps the level-up guide's Spells step", () => {
    // Leveling is not creation. Losing this would mean no way to learn a
    // spell when you take a level.
    const levelUp = src.slice(src.indexOf("const steps = [];"));
    assert.match(levelUp, /id: "spells"/);
  });

  it("still calls every renderer the parked block referenced", () => {
    // The parking is UI-only. If any of these has no remaining caller, the
    // block really is dead and the comment above it is now lying.
    for (const fn of [
      "renderStartingEquipmentStepInto",
      "renderEquipmentProficienciesStepInto",
      "renderInnateAbilitiesStepInto",
    ]) {
      const calls = src.split(`\n`).filter((l) => l.includes(`${fn}(`) && !l.trim().startsWith("//"));
      assert.ok(calls.length > 0, `${fn} has no live caller left`);
    }
  });
});

describe("Starting Conditions holds scores and starting equipment", () => {
  const src = fs.readFileSync(new URL("../js/render/customSheet.js", import.meta.url), "utf8");

  it("is named for what it now covers, and is the last step before Review", () => {
    assert.match(src, /title: "Starting Conditions"/);
    // Review must follow it: the step order in the array is the tab order.
    const cond = src.indexOf('title: "Starting Conditions"');
    const review = src.indexOf('id: "review"', cond);
    assert.ok(cond > 0 && review > cond, "Starting Conditions should come before Review");
    const background = src.indexOf('id: "background"', cond - 4000);
    assert.ok(background < cond, "Starting Conditions should come after Background");
  });

  it("separates the two halves of the page", () => {
    // Ability scores and starting gear are unrelated things on one page;
    // run together they read as one long form.
    assert.match(src, /wizard__separator/);
  });

  it("carries the race/class bonus note as a footnote under the scores", () => {
    assert.match(src, /footnote: "Bonuses from your race/);
  });
});

describe("the main sheet can set equipment proficiencies", () => {
  const layout = createStarterLayout();
  const block = layout.find((b) => b.name === "Equipment Proficiencies");

  it("has a block for them", () => {
    assert.ok(block, "no Equipment Proficiencies block on the starter sheet");
  });

  it("exposes all four categories as taglists", () => {
    const rows = (block.children || []).map((c) => c.field || c);
    assert.equal(rows.length, 4);
    for (const id of ["armorProf", "weaponProf", "toolProf", "vehicleProf"]) {
      const row = rows.find((r) => r.id === id);
      assert.ok(row, `no ${id} field`);
      assert.equal(row.fieldType, "taglist", `${id} should be a taglist`);
      assert.ok((row.tagOptions || []).length > 0, `${id} has no vocabulary`);
    }
  });

  it("groups the tool options by kind, matching the picker", () => {
    // The wizard's tool picker now narrows by category; if this dropdown
    // did not, the sheet and the picker would disagree about what a "tool"
    // is.
    const tools = (block.children || []).map((c) => c.field || c).find((r) => r.id === "toolProf");
    assert.equal((tools.tagGroups || []).length, 5);
  });

  it("keeps every top-level column ending on the same row", () => {
    // The layout is printed; a ragged bottom edge shows. Nothing had a
    // spare row, so all three columns were shifted together.
    const bottoms = new Map();
    for (const b of layout) {
      const key = `${b.x}/${b.w}`;
      bottoms.set(key, Math.max(bottoms.get(key) ?? 0, b.y + b.h));
    }
    assert.equal(new Set(bottoms.values()).size, 1,
      `uneven columns: ${[...bottoms.entries()].map(([k, v]) => `${k}=>${v}`).join(", ")}`);
  });
});

describe("the Bard's Magical Secrets are a picker on the class entry", () => {
  const bundle = bardBundle();
  const groups = (bundle?.choiceGroups || []).filter((g) => /Magical Secrets/i.test(g.label || ""));

  it("has one group per unlock", () => {
    assert.equal(groups.length, MAGICAL_SECRETS_UNLOCKS.length);
  });

  it("asks for the right number of spells at each unlock", () => {
    for (const unlock of MAGICAL_SECRETS_UNLOCKS) {
      const g = groups.find((x) => x.minLevel === unlock.minLevel && String(x.subclasses || "") === String(unlock.subclasses || ""));
      assert.ok(g, `no group for the level ${unlock.minLevel} unlock`);
      assert.equal(g.minSelections, unlock.count);
      assert.equal(g.maxSelections, unlock.count);
    }
  });

  it("caps the spell level at half the Bard level", () => {
    for (const g of groups) {
      assert.equal(g.spellPick.level, 0, "a Secret can be a cantrip");
      assert.equal(g.spellPick.maxLevel, magicalSecretsMaxSpellLevel(g.minLevel),
        `${g.id} caps at the wrong level`);
    }
  });

  it("draws from ANY class list, which is the point of Secrets", () => {
    for (const g of groups) {
      assert.equal(g.spellPick.list, null, "Magical Secrets must not be limited to one list");
    }
  });

  it("marks the College of Lore's earlier unlock as subclass-only", () => {
    const lore = groups.filter((g) => Array.isArray(g.subclasses) && g.subclasses.length);
    assert.equal(lore.length, 1);
    assert.deepEqual(lore[0].subclasses, ["lore"]);
    assert.ok(!lore[0].subclasses.includes("glamour"), "only Lore gets the early unlock");
  });

  it("still agrees with the wizard's own completeness maths", () => {
    // The counts drive whether the Bard's spell picks block Finish Setup.
    // If the groups and the table drift apart, one of the two lies.
    const at6 = groups.filter((g) => g.minLevel === 6).reduce((n, g) => n + g.minSelections, 0);
    assert.equal(at6, magicalSecretsUnlocked("Bard", "College of Lore", 6));
    const nonLore = groups.filter((g) => !g.subclasses && g.minLevel <= 6)
      .reduce((n, g) => n + g.minSelections, 0);
    assert.equal(nonLore, magicalSecretsUnlocked("Bard", "College of Glamour", 6),
      "a non-Lore Bard must not get the Lore unlock");
  });

  it("survives the pack filter, which used to drop it", async () => {
    // The real bug, and a silent one. filterGroupByPack returns null for a
    // group with no baked-in options, and it runs BEFORE the caller sees
    // the group's spellPick - so a spell-pick group with only a spellPick
    // was removed from the wizard entirely. The Bard group has no options
    // by design (its list is the catalog), so the picker simply never
    // appeared, and every data-level test still passed because the group
    // was present in the bundle. Asserting it reaches the wizard is the
    // only check that would have caught it.
    const { creationChoiceGroupsForState, choiceDialogKindFor } = await import("../js/render/sheet/sheetWizard.js");
    const lookup = (category) => (category === "Class" ? { choiceGroups: bundle.choiceGroups } : null);
    const at = (level, subclass) => creationChoiceGroupsForState(
      { level, rulesetId: "srd", className: "Bard", subclass }, lookup, []
    ).filter((g) => /magical-secrets/.test(g.id)).map((g) => g.id);

    assert.deepEqual(at(6, "College of Lore"), ["bard-magical-secrets-6-lore"]);
    assert.deepEqual(at(6, "College of Glamour"), [], "a non-Lore Bard gets no level-6 unlock");
    assert.deepEqual(at(10, "College of Glamour"), ["bard-magical-secrets-10"]);
    assert.deepEqual(at(18, "College of Glamour"),
      ["bard-magical-secrets-10", "bard-magical-secrets-14", "bard-magical-secrets-18"]);

    // And it has to reach the shared spell dialog, not just the wizard.
    for (const g of groups) {
      assert.equal(choiceDialogKindFor(g), "spells",
        `${g.id} does not open the spell picker`);
    }
  });
});

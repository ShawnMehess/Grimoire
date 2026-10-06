// tests/starting-conditions.test.mjs
//
// The creation wizard used to end with ... Abilities, Spells, Gear,
// Review. Spells and Gear are gone as tabs - both live in the catalogs
// now - and what they uniquely held had to be rehomed before they went:
//
//   starting equipment   -> the Class and Background steps (2026-10-05,
//                           split in two: the class's either/or rows went
//                           to Class, the background's fixed package to
//                           Background. They shared one "Starting
//                           Equipment" section on the Ability Scores step
//                           until then, two steps from both the things
//                           that decide them.)
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
const sheetSteps = fs.readFileSync(new URL("../js/render/sheet/sheetWizardSteps.js", import.meta.url), "utf8");

describe("the wizard has no Spells or Gear tab", () => {
  const src = fs.readFileSync(new URL("../js/render/customSheet.js", import.meta.url), "utf8");

  it("still parks the Gear step, with a reason", () => {
    // Commented, not deleted, at the user's request. The banner has to
    // survive, because a future audit that flags the block as dead code
    // needs the reason it is parked and the note that every renderer in it
    // is still called from elsewhere.
    assert.match(src, /COMMENTED OUT 2026-10-01\. The Gear step is still parked/);
    assert.match(src, /renderInnateAbilitiesStepInto/);
  });

  it("documents why the Spells half was DELETED rather than parked", () => {
    // This is not a tidy-up. The inline class-row picks now gate
    // completeness and land on the sheet, so the parked step's isComplete
    // checked something that no longer exists. The note has to say that, or
    // the next reader assumes the block is merely disabled.
    assert.match(src, /SPELLS half of this block has since been deleted/);
    assert.match(src, /spellPicksComplete\s+- read the old per-level pick keys/);
    assert.match(src, /renderSpellPicker survives, and is the level-up wizard's/);
  });

  it("has no function left that only the deleted step called", () => {
    // renderSpellPicker and renderSecretsSectionInto were creation-only.
    // spellPicksComplete is ALSO gone now - the level-up Spells step moved to
    // the shared inline lines in the section-4 commit, so nothing needs it.
    // secretsSatisfiedFor survives: the level-up wizard still uses it to gate
    // Magical Secrets.
    assert.doesNotMatch(src, /function renderSecretsSectionInto/);
    assert.doesNotMatch(src, /function renderSpellPicker\(/);
    assert.doesNotMatch(src, /function spellPicksComplete\(/);
    assert.match(src, /function secretsSatisfiedFor\(/, "still used by level-up");
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

  it("still calls every renderer the parked GEAR block referenced", () => {
    // The parking is UI-only. If any of these has no remaining caller, the
    // block really is dead and the comment above it is now lying.
    //
    // Two names are NOT in the list, and both were checked here until
    // 2026-10-05:
    //
    //   renderStartingEquipmentStepInto - it drew the background's package
    //     and the class's either/or rows together under one heading, and
    //     those two now live on different steps. The two halves it was split
    //     into are checked further down instead.
    //   renderInnateAbilitiesStepInto - "What You Get Automatically" on the
    //     Review step. It restated, in a second list, the grants the Race,
    //     Class and Background rows above it already print, so it was
    //     DELETED rather than moved. A test that kept requiring a live caller
    //     for it would have been asserting the Review page keeps saying the
    //     same thing twice.
    //
    // What is left is genuinely live, and the import gate's dead-export check
    // catches anything that stops being.
    for (const fn of [
      "renderEquipmentProficienciesStepInto",
    ]) {
      const calls = src.split(`\n`).filter((l) => l.includes(`${fn}(`) && !l.trim().startsWith("//"));
      assert.ok(calls.length > 0, `${fn} has no live caller left`);
    }
    assert.doesNotMatch(src, /function renderInnateAbilitiesStepInto/,
      "the automatic-grants list should be gone from the renderer");
    assert.match(sheetSteps, /What You Get Automatically/, "and its deletion explained where it was");
  });

  it("keeps the shared spell picker alive, for Magical Secrets", () => {
    // The Spells step's own picker is gone, but renderSpellPickerInto is not:
    // renderMagicalSecretsInto is built on it, and Magical Secrets is only
    // handed out at LEVEL UP. Losing it would mean a Bard levelling into
    // their 10th-level unlock had no way to take it.
    assert.match(src, /renderSpellPickerInto/);
    const wizard = fs.readFileSync(new URL("../js/render/sheet/sheetWizard.js", import.meta.url), "utf8");
    assert.match(wizard, /export function renderSpellPickerInto/);
    assert.match(wizard, /export function renderMagicalSecretsInto/);
    assert.match(wizard, /renderSpellPickerInto\(container/, "and Magical Secrets really does call it");
  });
});

describe("the Ability Scores step is scores, and nothing else", () => {
  const src = fs.readFileSync(new URL("../js/render/customSheet.js", import.meta.url), "utf8");
  const step = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
  // Comments stripped: the deliberately-parked Gear block sits between the
  // last two creation steps and names every renderer it used to call. What
  // this file cares about is what the steps CALL.
  const live = (text) => text.split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  it("is named for what it now covers, and is the last step before Review", () => {
    assert.match(src, /title: "Ability Scores"/);
    // Nothing PLAYER-FACING still calls it the old name. A leftover here is
    // not a cosmetic miss: the step pill, the Review page and the docs all
    // read their labels from these strings, so a partial rename shows the
    // player two names for one page. Comments are excluded because the code
    // deliberately explains what the step used to be called.
    const liveSrc = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.doesNotMatch(liveSrc, /Starting Conditions/);
    // Review must follow it: the step order in the array is the tab order.
    const cond = src.indexOf('title: "Ability Scores"');
    const review = src.indexOf('id: "review"', cond);
    assert.ok(cond > 0 && review > cond, "Ability Scores should come before Review");
    const background = src.indexOf('id: "background"', cond - 4000);
    assert.ok(background < cond, "Ability Scores should come after Background");
  });

  it("keeps the step ID 'abilities', because saved characters store it", () => {
    // The rename is a title only. A character's saved state names the step
    // it was left on, and a resume that cannot find that step opens at the
    // BEGINNING of the wizard instead of the page the player left - so
    // renaming the id would silently discard everyone's place.
    assert.match(src, /id: "abilities"/);
    assert.ok(!/id: "Ability Scores"/.test(src), "the id must not have been given the new title");
  });

  it("carries no starting gear at all", () => {
    // The step is now ability scores and their one footnote. Ability scores
    // and starting gear were unrelated things sharing a page, and the gear
    // half has moved to the two steps that actually decide it - so the
    // separator that used to divide them has nothing left to divide.
    const abilities = live(step('id: "abilities"', 'id: "review"'));
    assert.doesNotMatch(abilities, /renderClassEquipmentInto/);
    assert.doesNotMatch(abilities, /renderBackgroundEquipmentInto/);
    assert.doesNotMatch(abilities, /Starting Equipment/);
  });

  it("carries the race/class bonus note as a footnote under the scores", () => {
    assert.match(src, /footnote: "Bonuses from your race/);
  });
});

describe("starting gear lives on the steps that decide it", () => {
  const src = fs.readFileSync(new URL("../js/render/customSheet.js", import.meta.url), "utf8");
  const step = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
  const classStep = step('id: "class"', 'id: "background"');
  const backgroundStep = step('id: "background"', 'id: "story"');

  it("puts the class's either/or rows on the CLASS step", () => {
    assert.match(classStep, /renderClassEquipmentInto\(gearWrap, state, saveRules\)/);
  });

  it("puts the background's fixed package on the BACKGROUND step", () => {
    assert.match(backgroundStep, /renderBackgroundEquipmentInto\(gearWrap, state\)/);
  });

  it("gates the Class step on its own rows, or moving them made them optional", () => {
    // This is the check that matters. The rows used to gate a step of their
    // own. Moving them onto the Class step without adding them to its
    // isComplete would have left nothing anywhere asking for them, and every
    // character would finish with nothing granted.
    assert.match(classStep, /if \(classEquipmentOutstanding\(state\)\.length\) return false;/);
  });

  it("says WHY Next is refusing, in the class's own gear", () => {
    // The reason under Next comes from the same predicate that disables the
    // button, so it cannot describe a different problem - but only if the
    // step actually supplies one. A dimmed Next with a generic reason is the
    // dead end this plumbing exists to avoid.
    assert.match(classStep, /Starting gear: /);
  });

  it("names the background's outstanding gear pick rather than saying \"choices\"", () => {
    // "Choices still to make." on a page with a ten-row proficiency table and
    // one unanswered tools line does not say which one.
    assert.match(backgroundStep, /backgroundEquipmentMissingReason\(state\)/);
    assert.match(src, /function backgroundEquipmentMissingReason\(/);
  });

  it("counts the gold as answering every class row at once", () => {
    // resolveStartingEquipmentPick treats gold as settling the whole entry,
    // so the gate has to agree or Next would refuse on rows the player is
    // never going to be asked again.
    assert.match(src, /if \(stored\.gold === true \|\| stored\.classOptionId === goldOptionIdFor\(state\.className\)\) return \[\];/);
  });

  it("still shows the background's fixed items in its own picker row", () => {
    // Belt and braces, and not this file: the row's mechanics bullets carry a
    // Starting Equipment section off the bundle's own grant, so a player who
    // expands a background row can read the package without leaving the step.
    const mech = fs.readFileSync(new URL("../js/render/sheet/sheetMechanics.js", import.meta.url), "utf8");
    assert.match(mech, /bgEquipment: "Starting Equipment"/);
    assert.match(mech, /isEquipmentGrant/);
    assert.match(mech, /if \(backgroundDisplay && isEquipmentGrant\(grant\)\)/);
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

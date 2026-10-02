// tests/formulas.test.mjs
//
// Unit tests for the formula engine (js/data/formula.js), the shared
// rules/ability helpers (js/render/sheet/sheetRules.js), mechanics
// previews (js/render/sheet/sheetMechanics.js), and the pure
// level-review builders in sheetWizardSteps.js.
// Run: node --test tests/

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateExpression,
  validateExpression,
  validateCondition,
} from "../js/data/formula.js";
import {
  pointBuyCost,
  abilityModifier,
  formatModifier,
  findMoneyFieldByNameIn,
  findStarterFieldIn,
  missingSetupTargets,
  appendUniqueTextListItemTo,
  intFromRichText,
  floatFromRichText,
  classGrantsAsiIn,
} from "../js/render/sheet/sheetRules.js";
import {
  categorizeChoiceGroup,
  collapseBits,
  featureBit,
  previewBitsFor,
  mechanicsPreviewFor,
  commonPreviewBits,
  briefDescription,
  capitalizeFirst,
  statModifierSummary,
  mechanicsBulletsFor,
  levelGatedText,
  ABILITY_GLOSSARY,
  abilityTooltip,
  humanizeGameText,
  splitAbilityTokens,
} from "../js/render/sheet/sheetMechanics.js";
import {
  levelReviewSectionsFor,
  levelReviewSummary,
  validateLevelApply,
  applyAsiToScores,
  buildLevelUpEntry,
  levelClassOptionsFor,
} from "../js/render/sheet/sheetWizardSteps.js";
import { grantedSpellsLine } from "../js/render/sheet/sheetMechanics.js";
import { FIXED_RACE_ENTRIES, FIXED_CLASS_ENTRIES } from "../js/data/contentFixups.js";

// The tiefling is the probe for the spell-grant line: it splits its
// legacy across three levels, so it shows whether the filter works.
const tieflingBundle = FIXED_RACE_ENTRIES.find((e) => e.name === "Tiefling").bundle;

describe("formula engine", () => {
  it("evaluates arithmetic with precedence", () => {
    assert.equal(evaluateExpression("2 + 3 * 4"), 14);
    assert.equal(evaluateExpression("(2 + 3) * 4"), 20);
    assert.equal(evaluateExpression("7 / 2"), 3.5);
  });

  it("validates expressions and surfaces problems", () => {
    assert.equal(validateExpression("2 + 2"), null);
    assert.ok((validateExpression("2 +") || "").includes("incomplete"));
    assert.ok((validateExpression("((2)") || "").includes("parenthesis"));
    assert.equal(validateCondition("3 > 2"), null);
  });
});

describe("abilities and point buy", () => {
  it("prices scores on the standard curve", () => {
    assert.equal(pointBuyCost(8, 8), 0);
    assert.equal(pointBuyCost(14, 8), 7);
    assert.equal(pointBuyCost(15, 8), 9);
  });

  it("derives modifiers and formats them", () => {
    assert.equal(abilityModifier(14), 2);
    assert.equal(abilityModifier(9), -1);
    assert.equal(formatModifier(2), "+2");
    assert.equal(formatModifier(-1), "-1");
  });

  it("grants ASIs at tagged levels", () => {
    assert.equal(classGrantsAsiIn([{ minLevel: 4, name: "Ability Score Improvement" }], 4), true);
    assert.equal(classGrantsAsiIn([{ minLevel: 4, name: "Ability Score Improvement" }], 5), false);
  });

  it("applies ASIs to score maps", () => {
    const scores = { str: 10 };
    assert.equal(applyAsiToScores(scores, "single", "str"), "+2 STR");
    assert.equal(scores.str, 12);
    // Unknown modes and blank ids never create junk score keys.
    const clean = { str: 10 };
    assert.equal(applyAsiToScores(clean, "feat", "str"), "");
    assert.deepEqual(clean, { str: 10 });
    applyAsiToScores(clean, "double", "", "dex");
    assert.equal(clean.dex, 11);
    assert.ok(!("undefined" in clean) && !("" in clean));
  });
});

describe("money and text parsing", () => {
  it("finds money fields by conventional names", () => {
    assert.equal(findMoneyFieldByNameIn([{ fieldType: "text", label: "GP" }])?.label, "GP");
    assert.equal(findMoneyFieldByNameIn([{ fieldType: "text", label: "Name" }]), null);
  });

  it("reads numbers out of rich text", () => {
    assert.equal(intFromRichText("<b>12</b>"), 12);
    assert.equal(floatFromRichText("<b>12</b>"), 12);
  });
});

describe("customized-sheet target lookup", () => {
  it("prefers id matches, falls back to labels", () => {
    assert.equal(findStarterFieldIn([{ id: "a", label: "X" }], "a", "Y")?.label, "X");
    assert.equal(findStarterFieldIn([{ id: "b", label: "Y" }], "a", "Y")?.id, "b");
    assert.equal(findStarterFieldIn([], "a", "Y"), null);
  });

  it("reports only deleted targets", () => {
    const fields = [
      { id: "gp-1", fieldType: "text", label: "Gold" },
      { id: "items-9", fieldType: "textlist", label: "Items", items: [] },
    ];
    const missing = missingSetupTargets(fields, [
      { id: "level", label: "Level", what: "Level" },
      { id: "gp-1", label: "GP", what: "gold" },
      { id: "nope", label: "Items", what: "items" },
    ]);
    assert.deepEqual(missing.map((t) => t.what), ["Level"]);
  });

  it("appends list items uniquely to textlists", () => {
    assert.equal(appendUniqueTextListItemTo({ fieldType: "text", items: [] }, "x"), false);
    assert.equal(appendUniqueTextListItemTo({ fieldType: "textlist", items: ["x"] }, "x"), false);
    assert.equal(appendUniqueTextListItemTo({ fieldType: "textlist", items: [] }, "x"), true);
  });
});

describe("mechanics previews", () => {
  it("categorizes groups with a proficiencies catch-all", () => {
    assert.equal(categorizeChoiceGroup({ label: "Pick a spell" }), "spells");
    assert.equal(categorizeChoiceGroup({ label: "random" }), "proficiencies");
  });

  it("collapses duplicate bits and formats features", () => {
    assert.deepEqual(collapseBits(["A", "A", "B"]), ["2 A", "B"]);
    assert.equal(featureBit({ name: "Speed", description: "25 ft. walking" }), "Speed: 25 feet");
    assert.equal(featureBit({ name: "Darkvision", description: "60 ft." }), "Darkvision: 60 feet");
  });

  it("previews bundles and filters page-common traits", () => {
    const summarize = (m) => statModifierSummary(m, { resolveLabel: m.targetFieldId === "conScore" ? "CON" : "Languages" });
    const dwarf = {
      statModifiers: [
        { targetFieldId: "conScore", op: "add", value: 2 },
        { targetFieldId: "languages", op: "grantTag", value: "Common" },
        { targetFieldId: "languages", op: "grantTag", value: "Dwarvish" },
      ],
      featureGrants: [{ name: "Speed", description: "25 ft. walking", minLevel: 1 }],
    };
    const bits = previewBitsFor(dwarf, 1, { summarize });
    assert.ok(bits.includes("+2 CON") && bits.includes("2 Languages") && bits.includes("Speed: 25 feet"));
    const mk = (extra) => ({ statModifiers: [], featureGrants: [{ name: "Starting Equipment" }, { name: extra }] });
    const common = commonPreviewBits([mk("A"), mk("B")], 1, {});
    assert.ok(common.has("Starting Equipment") && !common.has("A"));
    assert.equal(mechanicsPreviewFor(null, 1), null);
  });

  it("snips descriptions without starting mid-word", () => {
    assert.ok(briefDescription("When you score a critical hit, roll extra dice.", 120).startsWith("When you"));
    assert.equal(briefDescription("First. Second.", 200), "First.");
    assert.equal(capitalizeFirst("meditate 4 hours"), "Meditate 4 hours");
    assert.equal(capitalizeFirst(""), "");
  });

  it("humanizes compiled shorthand into natural language", () => {
    assert.equal(humanizeGameText("As an action, heal @profd4 HP, once per long rest."),
      "As an action, heal a number of d4 hit points equal to your proficiency bonus, once per long rest.");
    assert.equal(humanizeGameText("2d6 damage in an area (DC 8 + @con.mod + @prof), once per short or long rest."),
      "2d6 damage in an area (DC 8 + CON modifier + proficiency bonus), once per short or long rest.");
    assert.equal(humanizeGameText("uses set to @prof per Long Rest."), "uses set to proficiency bonus per Long Rest.");
    assert.equal(humanizeGameText("uses set to @abilities.wis.mod per Long Rest."), "uses set to WIS modifier per Long Rest.");
    // Exotic scaling refs pass through rather than risk wrong mechanics.
    assert.equal(humanizeGameText("extra damage equal to @scale.barbarian.brutal."), "extra damage equal to @scale.barbarian.brutal.");
    // Ability names abbreviate; lowercase prose and longer words never match.
    assert.equal(humanizeGameText("add your Strength modifier."), "add your STR modifier.");
    assert.equal(humanizeGameText("respect strength shown, not claimed."), "respect strength shown, not claimed.");
    assert.equal(humanizeGameText("You talk, sneak, cast — Charismatic."), "You talk, sneak, cast — Charismatic.");
    // Idempotent: output contains no matchable input.
    assert.equal(humanizeGameText(humanizeGameText("heal @profd4 HP with Strength.")), "heal a number of d4 hit points equal to your proficiency bonus with STR.");
  });

  it("uses background sections on background rows but keeps race defaults", () => {
    const bg = mechanicsBulletsFor(
      { statModifiers: [{ targetFieldId: "toolProf", op: "grantTag", value: "Disguise Kit" }], featureGrants: [] },
      1,
      { backgroundDisplay: true }
    );
    assert.ok(!bg.some((s) => s.title === "Racial Traits"), "no Racial Traits section for backgrounds");
    assert.ok(!bg.some((s) => s.title === "Innate Abilities"), "no Innate Abilities section for backgrounds");
    assert.ok(bg.some((s) => s.title === "Background Proficiencies"), "background tool tags list under Background Proficiencies");
    const race = mechanicsBulletsFor({ statModifiers: [], featureGrants: [] }, 1, {});
    const traits = race.find((s) => s.title === "Racial Traits");
    assert.ok(traits && traits.items.join(" ").includes("Speed: 30 feet"), "races keep standard defaults");
  });

  it("lists a race's granted spells, filtered to the level in hand", () => {
    // The data splits these by level; the trait's prose only names the
    // cantrip, so this is the only place a level-5 tiefling sees the
    // two spells their legacy actually grants.
    const spellsAt = (level) => {
      const section = mechanicsBulletsFor(tieflingBundle, level).find((s) => s.title === "Spells");
      return section ? section.items[0] : null;
    };
    assert.equal(spellsAt(1), "Spells: Thaumaturgy");
    assert.equal(spellsAt(2), "Spells: Thaumaturgy", "nothing new between 1 and 3");
    assert.equal(spellsAt(3), "Spells: Thaumaturgy, Hellish Rebuke");
    assert.equal(spellsAt(5), "Spells: Thaumaturgy, Hellish Rebuke, Darkness");
  });

  it("omits the Spells section for a race that grants no spells", () => {
    const sections = mechanicsBulletsFor({ statModifiers: [], featureGrants: [] }, 20, {});
    assert.ok(!sections.some((s) => s.title === "Spells"), "no empty Spells section");
    assert.equal(grantedSpellsLine({ statModifiers: [], featureGrants: [] }, 20), null);
  });

  it("keeps a subrace's own spell grants out of the base race", () => {
    // Drow's legacy lives on the subrace option, so the Elf row must not
    // claim spells and the Drow row must claim only its own.
    const elf = FIXED_RACE_ENTRIES.find((e) => e.name === "Elf");
    const drow = elf.bundle.choiceGroups.find((g) => g.id === "elf-subrace").options
      .find((o) => o.id === "elf-subrace-drow");
    assert.equal(grantedSpellsLine(elf.bundle, 20), null);
    assert.equal(grantedSpellsLine(drow, 1), "Spells: Dancing Lights");
    assert.equal(grantedSpellsLine(drow, 5), "Spells: Dancing Lights, Faerie Fire, Darkness");
  });

  it("ignores spell grants that aren't spells", () => {
    const bundle = {
      statModifiers: [
        { targetFieldId: "spellsKnown", op: "addItem", value: "Fireball" },
        { targetFieldId: "items", op: "addItem", value: "a lamp" },
        { targetFieldId: "spellsKnown", op: "grantTag", value: "Evoker" },
      ],
      featureGrants: [],
    };
    assert.equal(grantedSpellsLine(bundle, 5), "Spells: Fireball");
  });

  it("never contradicts a subrace on its own parent row", () => {
    // A parent race owns a `subrace` picker, so its subraces supply the real
    // traits and the base has none. The standard-default slots (30 ft, no
    // darkvision, no resistances) are a sensible floor for a finished race
    // and a lie for a container: Genasi printed all three while every one of
    // its subraces has darkvision 60 ft, three of them have a resistance, and
    // Air Genasi is 35 ft. The parent stated as fact three things each of its
    // own children contradicts.
    const deps = { abilityIds: [], abilities: [], skills: [] };
    const parents = FIXED_RACE_ENTRIES.filter((e) =>
      (e.bundle.choiceGroups || []).some((g) => g.subrace === true));
    assert.ok(parents.length >= 5, `there are parent races to check (${parents.map((p) => p.name).join(", ")})`);

    for (const parent of parents) {
      const items = mechanicsBulletsFor(parent.bundle, 1, deps)
        .flatMap((s) => s.items.map((i) => ({ title: s.title, text: i })));
      const traitLines = items.filter((i) => i.title === "Racial Traits").map((i) => i.text);
      assert.ok(!traitLines.some((t) => /^Speed:/.test(t)),
        `${parent.name} does not claim a speed its subraces don't share`);
      assert.ok(!traitLines.some((t) => /^Darkvision:/.test(t)),
        `${parent.name} does not claim darkvision its subraces don't share`);
      assert.ok(!traitLines.some((t) => /^Resistances:/.test(t)),
        `${parent.name} does not claim resistances its subraces don't share`);
      assert.ok(traitLines.some((t) => /come from your subrace/i.test(t)),
        `${parent.name} says where its traits come from instead (${JSON.stringify(traitLines)})`);
    }
  });

  it("keeps the standard defaults for a race that is not a parent", () => {
    // The defaults are only wrong for a container. An ordinary race really
    // does have a speed and may really have neither darkvision nor
    // resistances, so removing the slots outright would lose information.
    const deps = { abilityIds: [], abilities: [], skills: [] };
    const aarakocra = FIXED_RACE_ENTRIES.find((e) => e.name === "Aarakocra");
    const traits = mechanicsBulletsFor(aarakocra.bundle, 1, deps)
      .find((s) => s.title === "Racial Traits").items;
    assert.ok(traits.includes("Speed: 30 feet"), `a plain race still reads its speed (${JSON.stringify(traits)})`);
    assert.ok(traits.includes("Darkvision: none"));
    assert.ok(!traits.some((t) => /come from your subrace/i.test(t)),
      "and is not told its traits come from a subrace it does not have");
  });

  it("keeps a parent's own real grants", () => {
    // The Genasi flexible ASI is shared by all four elemental heritages, so
    // it belongs on the base and must survive the defaults being dropped.
    const genasi = FIXED_RACE_ENTRIES.find((e) => e.name === "Genasi");
    assert.ok((genasi.bundle.choiceGroups || []).some((g) => g.id === "genasi-flexible-asi"),
      "the shared ASI picker is still on the base");
    assert.ok(genasi.bundle.choiceGroups.some((g) => g.subrace === true),
      "and the base is still recognised as a parent");
  });

  it("splits ability tokens for tooltips", () => {    assert.deepEqual(splitAbilityTokens("No abilities here."), [{ text: "No abilities here." }]);
    assert.deepEqual(splitAbilityTokens("+2 DEX"), [{ text: "+2 " }, { abbr: "DEX", id: "dex", name: "Dexterity" }]);
    assert.deepEqual(splitAbilityTokens("Wizards cast with Intelligence."),
      [{ text: "Wizards cast with " }, { abbr: "INT", id: "int", name: "Intelligence" }, { text: "." }]);
    assert.deepEqual(splitAbilityTokens(""), []);
    assert.ok(abilityTooltip("str").startsWith("Strength — "));
    assert.equal(abilityTooltip("nope"), null);
    assert.equal(ABILITY_GLOSSARY.cha.abbr, "CHA");
  });
});

// The Duergar's Duergar Magic is the exact shape this exists for: one
// feature grant, two unlocks at two different levels, described in prose
// rather than in `minLevel` (which is one gate per grant, so it can only
// hide the whole thing). The Duergar Magic grant is read from the real
// fixup layer rather than pasted in, so a rename of the spell in the data
// fails here too.
const DUERGAR_TEXT = (() => {
  const dwarf = FIXED_RACE_ENTRIES.find((e) => e.name === "Dwarf");
  const group = (dwarf.bundle.choiceGroups || []).find((g) => g.subrace === true);
  const duergar = (group?.options || []).find((o) => /duergar/i.test(o.id || ""));
  const grant = (duergar?.featureGrants || []).find((g) => g.name === "Duergar Magic");
  return grant?.description || null;
})();

describe("level-gated text", () => {
  it("returns untouched text byte-for-byte when nothing is gated", () => {
    // The whole corpus is this case. Rebuilding a description that had no
    // gate would re-join its punctuation differently from how it shipped,
    // so the function exits before doing anything at all.
    for (const text of [
      "Advantage on saving throw against poison damage.",
      "You know the following spells: Blindness/Deafness, Blur, and Disguise Self.",
      "Cast the Hellish Rebuke spell as a 2nd-level spell once with this trait.",
      "You can see in dim light within 60 feet of you as if it were bright light.",
    ]) {
      assert.equal(levelGatedText(text, 1), text);
    }
    assert.equal(levelGatedText("", 1), null);
    assert.equal(levelGatedText(null, 1), null);
  });

  it("reads the three phrasings the shipped data uses", () => {
    const one = levelGatedText("Starting at level 3, you gain the Fog.", 1);
    assert.equal(one, null);
    assert.equal(levelGatedText("Starting at 3rd level, you gain the Fog.", 3), "Starting at 3rd level, you gain the Fog.");
    assert.equal(levelGatedText("When you reach 3rd level, you gain the Fog.", 2), null);
    assert.equal(levelGatedText("Once you reach 5th level, you gain the Fog.", 5), "Once you reach 5th level, you gain the Fog.");
    assert.equal(levelGatedText("You gain it at level 9.", 8), null);
    assert.equal(levelGatedText("You gain it at level 9.", 9), "You gain it at level 9.");
  });

  it("never mistakes a spell's level or a distance for the character's", () => {
    // Both are the failure that would delete the sentence explaining what
    // the trait does, so they are pinned rather than left to a regex
    // change.
    assert.ok(levelGatedText("Cast it as a 2nd-level spell once per long rest.", 1));
    assert.ok(levelGatedText("You can see in dim light within 30 feet of you.", 1));
    assert.ok(levelGatedText("Reduce the damage by 1d6, to a minimum of 1.", 1));
    assert.ok(levelGatedText("The shop sells it for 10 gp.", 1));
  });

  it("takes the FIRST gate in a sentence, not the largest", () => {
    // "at 3rd level and again at 10th level" describes something you HAVE
    // at 3. Taking the largest would hide a real benefit for seven levels.
    const text = "When you reach 3rd level and again at 10th level, you gain proficiency in Survival.";
    assert.equal(levelGatedText(text, 3), text);
    assert.equal(levelGatedText(text, 2), null);
  });

  it("keeps the punctuation of the segments that survive", () => {
    // The separators belong to the SURVIVORS, not to the ones dropped, so
    // the sentence that is left still reads as a sentence.
    const text = "Dancing Lights cantrip; Faerie Fire once per long rest at 3rd level; Darkness once per long rest at 5th. Charisma is your spellcasting ability.";
    assert.equal(levelGatedText(text, 1), "Dancing Lights cantrip. Charisma is your spellcasting ability.");
    assert.equal(levelGatedText(text, 3), "Dancing Lights cantrip; Faerie Fire once per long rest at 3rd level. Charisma is your spellcasting ability.");
    assert.equal(levelGatedText(text, 20), text);
  });

  it("does not open a sentence with the punctuation of a dropped one", () => {
    const text = "When you reach 3rd level, you gain proficiency in Survival. This is an optional class feature.";
    assert.equal(levelGatedText(text, 1), "This is an optional class feature.");
  });

  it("hides the Duergar's higher unlocks from a character below them", () => {
    assert.ok(DUERGAR_TEXT, "the shipped Duergar still carries the Duergar Magic grant");
    assert.match(DUERGAR_TEXT, /starting at level 3/);
    assert.equal(levelGatedText(DUERGAR_TEXT, 1), null);
    assert.equal(levelGatedText(DUERGAR_TEXT, 2), null);
    assert.match(levelGatedText(DUERGAR_TEXT, 3), /^Cast Enlarge\/Reduce/);
    assert.ok(!/Invisibility/.test(levelGatedText(DUERGAR_TEXT, 3)),
      "and the level 5 clause is still hidden at 3");
    assert.equal(levelGatedText(DUERGAR_TEXT, 4), levelGatedText(DUERGAR_TEXT, 3), "level 4 is still the level 3 text - Invisibility is a level 5 unlock");
    assert.match(levelGatedText(DUERGAR_TEXT, 5), /Invisibility/);
    assert.equal(levelGatedText(DUERGAR_TEXT, 20), DUERGAR_TEXT);
  });

  it("pops the grant in and out of the picker bullets as the level changes", () => {
    // The whole point: no reload. The bullet list is recomputed from the
    // level the wizard currently holds, so the same bundle yields different
    // bullets at different levels rather than one fixed answer.
    const deps = { abilityIds: [], abilities: [], skills: [] };
    const dwarf = FIXED_RACE_ENTRIES.find((e) => e.name === "Dwarf");
    const group = (dwarf.bundle.choiceGroups || []).find((g) => g.subrace === true);
    const duergar = (group?.options || []).find((o) => /duergar/i.test(o.id || ""));
    const itemsAt = (level) => mechanicsBulletsFor(duergar, level, deps).flatMap((s) => s.items);
    const magicAt = (level) => itemsAt(level).filter((i) => /^Duergar Magic/.test(i));

    assert.deepEqual(magicAt(1), [], "a level 1 Duergar is told about no Duergar Magic at all");
    assert.equal(magicAt(3).length, 1);
    assert.match(magicAt(3)[0], /Enlarge\/Reduce/);
    assert.ok(!/Invisibility/.test(magicAt(3)[0]));
    assert.equal(magicAt(5).length, 1);
    assert.match(magicAt(5)[0], /Invisibility/);
    // Everything else about the subrace is untouched by the gating.
    assert.ok(itemsAt(1).some((i) => /Duergar Resilience/.test(i)));
    assert.ok(itemsAt(1).some((i) => /Darkvision/.test(i) && /120/.test(i)));
  });

  it("never leaves a shipped description unreadable at any level", () => {
    // A sweep, not an example: every gate the fixup layer actually carries
    // is re-checked at 1, 3, 5 and 20, and the survivors must still join
    // into well-formed text (no leading separator, no doubled punctuation).
    const sources = [];
    const walk = (where, bundle) => {
      if (!bundle) return;
      for (const g of bundle.featureGrants || []) if (g.description) sources.push([`${where}/${g.name}`, g.description]);
      for (const grp of bundle.choiceGroups || []) {
        for (const o of grp.options || []) {
          walk(`${where}/${o.name}`, o);
        }
      }
    };
    for (const entry of FIXED_RACE_ENTRIES) walk(`race:${entry.name}`, entry.bundle);
    for (const entry of FIXED_CLASS_ENTRIES) walk(`class:${entry.name}`, entry.bundle);

    let gated = 0;
    for (const [where, text] of sources) {
      for (const level of [1, 3, 5, 20]) {
        const out = levelGatedText(text, level);
        if (out === null) continue;
        assert.ok(!/^[,;:.]\s/.test(out), `${where} at ${level} opens with a stray separator: ${JSON.stringify(out)}`);
        assert.ok(!/\(\s|\s\)/.test(out), `${where} at ${level} has a broken bracket: ${JSON.stringify(out)}`);
        assert.ok(!/;;/.test(out) && !/\.\./.test(out), `${where} at ${level} doubled punctuation: ${JSON.stringify(out)}`);
      }
      if (levelGatedText(text, 1) !== text) gated += 1;
    }
    assert.ok(gated >= 6, `the shipped races really do carry level gates (${gated})`);
  });
});

describe("level review builders", () => {
  it("sections identity, HP, picks, and notes", () => {
    const sections = levelReviewSectionsFor({
      classLine: "Fighter 5", race: "Elf", background: "", hp: "6", hpDetail: "d10 average +2 CON",
      subclass: "Champion", needsAsi: true, asiMode: "feat", featChoice: "", asiAbilities: [],
      slots: "", choiceLines: ["Skills: Arcana"], notes: "took the oath",
    });
    assert.ok(sections.includes("Class: Fighter 5") && sections.includes("Race: Elf"));
    assert.ok(!sections.some((s) => s.startsWith("Background:")));
    assert.ok(sections.includes("HP: +6 (d10 average +2 CON)"));
    assert.ok(sections.includes("Feat: not chosen yet"));
    assert.deepEqual(levelReviewSectionsFor({}), []);
  });

  it("summarizes and validates level application", () => {
    assert.equal(levelReviewSummary({ hp: "7", subclass: "", needsAsi: false, slots: "" }), "HP +7");
    assert.equal(validateLevelApply({ hpGain: NaN, contentGroups: [], pendingChoices: {}, needsAsi: false }),
      "Enter the HP gained for this level before applying it.");
    assert.equal(validateLevelApply({ hpGain: 5, contentGroups: [], pendingChoices: {}, needsAsi: false }), null);
    // Whitespace-only feat names fail like empty ones.
    assert.notEqual(validateLevelApply({ hpGain: 5, contentGroups: [], pendingChoices: {}, needsAsi: true, asiMode: "feat", featChoice: "   " }), null);
    // An owned-aware checker satisfies like the Choices step does.
    const groups = [{ key: "g", label: "Skills", minSelections: 1, maxSelections: 2, options: [] }];
    assert.equal(validateLevelApply({ hpGain: 5, contentGroups: groups, pendingChoices: {}, needsAsi: false, groupSatisfiedFn: () => true }), null);
    assert.notEqual(validateLevelApply({ hpGain: 5, contentGroups: groups, pendingChoices: {}, needsAsi: false, groupSatisfiedFn: () => false }), null);
    const entry = buildLevelUpEntry({ level: 2, hpGain: 7, subclassName: "", slots: "", featureEntry: "F", asiSummary: "", appliedRulesetId: "x", prev: {} });
    assert.equal(entry.hp, "+7");
  });

  it("splits taken vs untaken level-up classes", () => {
    const opts = levelClassOptionsFor({ primaryName: "Fighter", entries: [{ name: "Rogue", levels: 1 }], allClassNames: ["Fighter", "Rogue", "Wizard"], level: 5 });
    assert.deepEqual(opts.taken, ["Fighter", "Rogue"]);
    assert.deepEqual(opts.untaken, ["Wizard"]);
    assert.equal(opts.canMulticlass, true);
  });
});

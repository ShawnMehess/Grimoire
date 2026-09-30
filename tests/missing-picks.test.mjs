// tests/missing-picks.test.mjs
//
// Features whose rules define a CHOICE but which arrived with no way to
// take one. The audit these encode is: for every feature named in
// subclassPicks/classPicks, the real data must actually have that
// feature, and the pick must actually offer something to pick.
//
// The last part matters more than it looks. An earlier audit of the High
// Elf's cantrip passed because the test checked the data and the dialog
// routing, while the feature was unreachable in the UI. These assert the
// group lands on a bundle the sheet can render, that its options exist,
// and that mechanical options grant something rather than only recording
// a name. Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FIXED_RACE_ENTRIES,
  FIXED_CLASS_ENTRIES,
  SUBCLASS_BUNDLE_MAP,
  normSubclassKey,
} from "../js/data/contentFixups.js";
import { ALL_SUBCLASS_PICKS as SUBCLASS_PICKS } from "../js/data/subclassPicks.js";
import { CLASS_PICKS, CLASS_PICK_TEXT, isUnpickableNote, HUMANOID_TYPES } from "../js/data/classPicks.js";
import { LANGUAGES, SKILLS } from "../js/data/schema.js";

const raceBundle = (name) => FIXED_RACE_ENTRIES.find((e) => e.name === name)?.bundle || null;
const classBundle = (name) => FIXED_CLASS_ENTRIES.find((e) => e.name === name)?.bundle || null;
const groupById = (bundle, id) => (bundle?.choiceGroups || []).find((g) => g.id === id) || null;
const hasFeature = (bundle, name) =>
  (bundle?.featureGrants || []).some((g) => (g.name || "").trim().toLowerCase() === name.trim().toLowerCase());
const optionsOf = (group) => [
  ...(group?.options || []),
  ...(group?.categories || []).flatMap((c) => c.options || []),
];

describe("subclass picks", () => {
  it("every table entry names a feature the real data has", () => {
    const problems = [];
    for (const [key, specs] of Object.entries(SUBCLASS_PICKS)) {
      const bundle = SUBCLASS_BUNDLE_MAP.get(key);
      if (!bundle) { problems.push(`${key}: no such subclass`); continue; }
      for (const spec of specs) {
        if (!hasFeature(bundle, spec.feature)) problems.push(`${key}: no feature "${spec.feature}"`);
      }
    }
    assert.deepEqual(problems, []);
  });

  it("covers a real set of subclasses", () => {
    assert.ok(Object.keys(SUBCLASS_PICKS).length >= 25,
      `expected the 25+ subclasses with a choice feature, got ${Object.keys(SUBCLASS_PICKS).length}`);
  });

  it("lands every group on the bundle", () => {
    const missing = [];
    for (const [key, specs] of Object.entries(SUBCLASS_PICKS)) {
      const bundle = SUBCLASS_BUNDLE_MAP.get(key);
      for (const spec of specs) {
        for (const group of spec.groups || []) {
          if (!groupById(bundle, group.id)) missing.push(`${key}/${group.id}`);
          if (optionsOf(group).length === 0) missing.push(`${key}/${group.id} has no options`);
        }
      }
    }
    assert.deepEqual(missing, []);
  });

  it("gives the feature the text it was compiled without", () => {
    const totem = SUBCLASS_BUNDLE_MAP.get("pathofthetotemwarrior");
    const spirit = totem.featureGrants.find((g) => g.name === "Totem Spirit");
    assert.match(spirit.description, /totem/i, "Totem Spirit describes the choice");
    assert.equal(groupById(totem, "totem-warrior-spirit").options.length, 3);
  });

  it("scopes each pick to the level the rules give it", () => {
    const ranger = SUBCLASS_BUNDLE_MAP.get("circleoftheland");
    assert.equal(groupById(ranger, "circle-of-land-cantrip").minLevel, 2);
    const totem = SUBCLASS_BUNDLE_MAP.get("pathofthetotemwarrior");
    assert.equal(groupById(totem, "totem-warrior-aspect").minLevel, 6);
    assert.equal(groupById(totem, "totem-warrior-attunement").minLevel, 14);
  });

  it("picks the rules' own option lists", () => {
    const names = (key, id) => optionsOf(groupById(SUBCLASS_BUNDLE_MAP.get(key), id)).map((o) => o.name);
    assert.deepEqual(names("pathofthetotemwarrior", "totem-warrior-spirit"), ["Bear", "Eagle", "Wolf"]);
    assert.deepEqual(names("pathofthestormherald", "storm-herald-aura"), ["Desert", "Sea", "Tundra"]);
    assert.deepEqual(names("armorer", "armorer-model"), ["Guardian", "Infiltrator"]);
    assert.deepEqual(names("runeknight", "rune-carver"), ["Hill Rune", "Stone Rune", "Storm Rune"]);
    assert.equal(names("circleofstars", "starry-form").length, 4);
    assert.equal(names("pathofthebeast", "beast-form").length, 3);
    assert.equal(names("wayofthefourelements", "elemental-discipline").length, 4);
    assert.equal(names("alchemist", "experimental-elixir").length, 7);
    assert.equal(names("arcanearcher", "arcane-archer-shot").length, 6);
    assert.equal(names("draconicbloodline", "draconic-ancestor").length, 10);
  });

  it("grants something for every mechanical option", () => {
    // A proficiency pick that grants nothing records a name and changes
    // nothing, which is the exact failure this whole batch is fixing.
    const mechanical = [
      "collegeoflore/lore-bonus-skills",
      "knowledgedomain/knowledge-languages",
      "knowledgedomain/knowledge-skills",
      "naturedomain/nature-skill",
      "cavalier/cavalier-bonus",
      "samurai/samurai-bonus",
      "battlemaster/battle-master-tool",
      "runeknight/rune-knight-weapons",
    ];
    const blank = [];
    for (const ref of mechanical) {
      const [key, id] = ref.split("/");
      const group = groupById(SUBCLASS_BUNDLE_MAP.get(key), id);
      if (!group) { blank.push(`${ref} missing`); continue; }
      for (const option of optionsOf(group)) {
        if (!(option.statModifiers || []).length) blank.push(`${ref}/${option.name}`);
      }
    }
    assert.deepEqual(blank, []);
  });

  it("offers Common in no language pick", () => {
    const offenders = [];
    for (const [key] of Object.entries(SUBCLASS_PICKS)) {
      const bundle = SUBCLASS_BUNDLE_MAP.get(key);
      for (const group of bundle?.choiceGroups || []) {
        if (group.category !== "languages") continue;
        if (optionsOf(group).some((o) => o.name === "Common")) offenders.push(`${key}/${group.id}`);
      }
    }
    assert.deepEqual(offenders, [], "Common is free, never a pick");
  });

  it("lets the rules' multi-count picks take the count", () => {
    const lore = groupById(SUBCLASS_BUNDLE_MAP.get("collegeoflore"), "lore-bonus-skills");
    assert.equal(lore.minSelections, 3);
    assert.equal(lore.maxSelections, 3);
    assert.equal(lore.options.length, SKILLS.length);
  });
});

describe("class picks", () => {
  it("every table entry names something the real data has", () => {
    // A spec's `feature` is either a feature grant it hangs text off, or
    // the name of an existing group it extends (the ranger's "Favored
    // Terrain" is a group with no feature grant behind it). Both are
    // real; what must never happen is neither, because then the groups
    // attach to nothing and the feature stays unreachable.
    const problems = [];
    for (const [name, specs] of Object.entries(CLASS_PICKS)) {
      const bundle = classBundle(name);
      for (const spec of specs) {
        const asFeature = hasFeature(bundle, spec.feature);
        const asGroup = (bundle?.choiceGroups || []).some((g) => g.id === spec.dropFromGroup);
        if (!asFeature && !asGroup) problems.push(`${name}: nothing called "${spec.feature}"`);
      }
    }
    assert.deepEqual(problems, []);
  });

  it("drops an option it replaces, so there is one way to do it", () => {
    const ranger = classBundle("Ranger");
    const level1 = groupById(ranger, "ranger-favored-enemy");
    assert.ok(!level1.options.some((o) => o.name === "Humanoids (choose two)"),
      "the placeholder option that granted nothing is gone");
    // ...and the real humanoid list replaced it.
    const humanoids = groupById(ranger, "ranger-favored-enemy-humanoid");
    assert.equal(humanoids.minSelections, 2, "'choose two' is now actually two");
    assert.deepEqual(humanoids.options.map((o) => o.name), HUMANOID_TYPES);
  });

  it("gives the ranger the extra picks the rules grant", () => {
    const ranger = classBundle("Ranger");
    assert.equal(groupById(ranger, "ranger-favored-enemy-6").minLevel, 6);
    assert.equal(groupById(ranger, "ranger-favored-enemy-14").minLevel, 14);
    assert.equal(groupById(ranger, "ranger-favored-terrain-6").minLevel, 6);
    assert.equal(groupById(ranger, "ranger-favored-terrain-10").minLevel, 10);
  });

  it("has a language for a humanoid favored enemy", () => {
    const lang = groupById(classBundle("Ranger"), "ranger-favored-enemy-language");
    assert.equal(lang.options.length, LANGUAGES.length - 1);
    assert.ok(lang.options.every((o) => (o.statModifiers || []).length));
  });

  it("replaces the warlock's 'not a pickable list here yet'", () => {
    const warlock = classBundle("Warlock");
    assert.ok(!JSON.stringify(warlock.featureGrants).includes("not a pickable list here yet"),
      "no feature still admits it is unpickable");
    for (const [level, at] of [[6, 11], [7, 13], [8, 15], [9, 17]]) {
      const g = groupById(warlock, `warlock-mystic-arcanum-${level}`);
      assert.ok(g, `arcanum ${level} missing`);
      assert.equal(g.minLevel, at);
      assert.deepEqual(g.spellPick, { list: "warlock", level });
    }
  });

  it("gives the wizard its mastery and signature spells", () => {
    const wizard = classBundle("Wizard");
    // Spell Mastery is two 1st AND two 2nd, so two groups: one group can
    // only draw from a single spell level.
    assert.equal(groupById(wizard, "wizard-spell-mastery-1").spellPick.level, 1);
    assert.equal(groupById(wizard, "wizard-spell-mastery-2").spellPick.level, 2);
    assert.equal(groupById(wizard, "wizard-spell-mastery-1").minSelections, 2);
    const sig = groupById(wizard, "wizard-signature-spells");
    assert.equal(sig.spellPick.level, 3);
    assert.equal(sig.minSelections, 2);
    assert.equal(sig.minLevel, 20);
  });

  it("recognises the compiler's stand-in text, and nothing else", () => {
    assert.ok(isUnpickableNote("Choice (SPELL_SELECT) - not a pickable list here yet (source data only)"));
    assert.ok(!isUnpickableNote("You learn a 6th-level warlock spell that you can cast at will."));
    assert.ok(!isUnpickableNote(undefined));
  });

  it("leaves text it has no replacement for alone", () => {
    for (const name of Object.keys(CLASS_PICK_TEXT)) {
      assert.ok(CLASS_PICK_TEXT[name].length > 20, `${name} needs real text`);
    }
  });
});

describe("race picks", () => {
  it("gives every dwarf the base tool rule", () => {
    const tools = groupById(raceBundle("Dwarf"), "dwarf-base-tools");
    assert.ok(tools, "the dwarf base tool rule is missing entirely");
    assert.deepEqual(tools.options.map((o) => o.name), ["Smith's Tools", "Brewer's Supplies", "Mason's Tools"]);
    assert.ok(tools.options.every((o) => (o.statModifiers || []).length), "each tool is actually granted");
  });

  it("gives the yuan-ti its languages", () => {
    const yuan = raceBundle("Yuan-ti");
    const fixed = (yuan.statModifiers || []).filter((m) => m.targetFieldId === "languages").map((m) => m.value);
    assert.deepEqual(fixed, ["Common", "Draconic"]);
    const pick = groupById(yuan, "yuan-ti-languages");
    assert.equal(pick.options.length, LANGUAGES.length - 1);
    assert.ok(pick.options.every((o) => (o.statModifiers || []).length));
  });

  it("gives the high elf the picks it was missing", () => {
    // Reported as gaps before they were added; now they are real picks on
    // the subrace option, reachable through nestedChoiceGroupsFor.
    const elf = raceBundle("Elf");
    const subrace = elf.choiceGroups.find((g) => g.id === "elf-subrace");
    const high = subrace.options.find((o) => o.id === "elf-subrace-high");
    assert.deepEqual((high.choiceGroups || []).map((g) => g.id),
      ["elf-subrace-high-language", "elf-subrace-high-cantrip"]);
  });
});

describe("the psionic subclasses", () => {
  // Flagged as unchecked in the original audit. Both turn out to be real
  // choice features, and the soulknife's own feature list is what its
  // options are built from - so the two cannot disagree.
  it("offers the soulknife's psionic power", () => {
    const bundle = SUBCLASS_BUNDLE_MAP.get("soulknife");
    const group = groupById(bundle, "soulknife-power");
    assert.ok(group, "the soulknife's Psionic Power has no pick");
    const names = optionsOf(group).map((o) => o.name);
    // Every option is a psionic power the sheet already lists as one of
    // this subclass's own features.
    for (const name of names) {
      assert.ok(hasFeature(bundle, name), `${name} is not a soulknife feature`);
    }
    assert.ok(names.length >= 4, "the soulknife has more powers than that");
  });

  it("offers the psi warrior's three and five powers", () => {
    const bundle = SUBCLASS_BUNDLE_MAP.get("psiwarrior");
    const three = groupById(bundle, "psi-warrior-power");
    const five = groupById(bundle, "psi-warrior-power-5");
    assert.ok(three, "the psi warrior's 3-power pick is missing");
    assert.ok(five, "the psi warrior's Telekinetic Adept pick is missing");
    assert.equal(three.minSelections, 3);
    assert.equal(five.minSelections, 5);
    assert.equal(five.minLevel, 9);
    assert.deepEqual(three.options.map((o) => o.name), five.options.map((o) => o.name),
      "the same list is offered both times");
  });

  it("gives the drakewarden its gift and its breath", () => {
    const bundle = SUBCLASS_BUNDLE_MAP.get("drakewarden");
    assert.ok(groupById(bundle, "drakewarden-gift"), "Draconic Gift has no pick");
    const breath = groupById(bundle, "drakewarden-breath");
    assert.ok(breath, "Drake's Breath has no pick");
    assert.equal(breath.minLevel, 6);
    assert.equal(optionsOf(breath).length, 4);
    // The drake TYPE and the breath are two different choices, not one.
    assert.ok(groupById(bundle, "drake-type"), "the drake type pick is gone");
  });

  it("gives draconic bloodline its presence, still with its ancestor", () => {
    const bundle = SUBCLASS_BUNDLE_MAP.get("draconicbloodline");
    assert.ok(groupById(bundle, "draconic-ancestor"), "the dragon ancestor pick is gone");
    const presence = groupById(bundle, "draconic-presence");
    assert.ok(presence, "Draconic Presence has no pick");
    assert.equal(presence.minLevel, 6);
  });

  it("offers the beastmaster's optional companion without requiring it", () => {
    const bundle = SUBCLASS_BUNDLE_MAP.get("beastmasterconclave");
    const group = groupById(bundle, "primal-companion");
    assert.ok(group, "the primal companion has no pick");
    // The source marks the feature optional; the pick must not demand it.
    assert.ok(group.minSelections <= 1, "an optional feature can't be required by its picker");
  });
});

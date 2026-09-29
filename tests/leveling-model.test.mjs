// tests/leveling-model.test.mjs
//
// Unit tests for the unified leveling grant model
// (js/render/sheet/levelingModel.js).
//
// The condition semantics get the most attention here, and deliberately.
// Conditions decide whether a player is shown a feature their character
// doesn't have - so a subtly wrong AND/OR here isn't a cosmetic bug, it's
// the game lying about a character sheet. The spec is: keys WITHIN one
// entry are AND'd, entries in the array are OR'd.
//
// Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GRANT_TYPES,
  conditionsMet,
  levelingContextFor,
  statModifierType,
  grantsIn,
  allGrantsIn,
  activeGrantsIn,
  upcomingGrantsByLevel,
  levelingStepsIn,
} from "../js/render/sheet/levelingModel.js";

const ctx = (over = {}) => ({ level: 1, race: "", class: "", subclass: "", ...over });

describe("conditionsMet — AND within an entry, OR across the array", () => {
  it("treats an absent condition list as unconditional", () => {
    assert.equal(conditionsMet(undefined, ctx()), true);
    assert.equal(conditionsMet(null, ctx()), true);
    assert.equal(conditionsMet([], ctx()), true);
  });

  it("applies a single condition", () => {
    assert.equal(conditionsMet([{ minLevel: 3 }], ctx({ level: 3 })), true);
    assert.equal(conditionsMet([{ minLevel: 3 }], ctx({ level: 2 })), false);
  });

  it("ANDs the keys within one entry", () => {
    const conditions = [{ race: "Elf", minLevel: 3 }];
    assert.equal(conditionsMet(conditions, ctx({ race: "Elf", level: 3 })), true);
    assert.equal(conditionsMet(conditions, ctx({ race: "Elf", level: 2 })), false, "right race, wrong level");
    assert.equal(conditionsMet(conditions, ctx({ race: "Human", level: 3 })), false, "right level, wrong race");
  });

  it("ORs the entries in the array", () => {
    const conditions = [{ race: "Elf", minLevel: 3 }, { class: "Rogue" }];
    assert.equal(conditionsMet(conditions, ctx({ race: "Elf", level: 3 })), true, "first entry");
    assert.equal(conditionsMet(conditions, ctx({ class: "Rogue" })), true, "second entry");
    assert.equal(conditionsMet(conditions, ctx({ race: "Elf", level: 1 })), false, "neither");
  });

  it("does not let one key from a failing entry be satisfied by another entry", () => {
    // The classic AND/OR bug: an Elf at level 1 must NOT match
    // [{race:"Elf", minLevel:3}, {class:"Rogue"}] just because it's an Elf.
    assert.equal(conditionsMet([{ race: "Elf", minLevel: 3 }, { class: "Rogue" }], ctx({ race: "Elf", level: 1 })), false);
  });

  it("treats a missing key as no constraint, not as a mismatch", () => {
    // { minLevel: 3 } must mean "anyone at 3+", not "someone with no race".
    assert.equal(conditionsMet([{ minLevel: 3 }], ctx({ level: 5, race: "Tiefling" })), true);
  });

  it("ignores case and surrounding whitespace in names", () => {
    assert.equal(conditionsMet([{ class: "rogue" }], ctx({ class: "  Rogue " })), true);
  });

  it("fails an entry whose level the context can't supply", () => {
    // No level known means we cannot claim the gate is met.
    assert.equal(conditionsMet([{ minLevel: 1 }], ctx({ level: NaN })), false);
  });

  it("fails a level gate against a non-numeric minLevel rather than coercing it", () => {
    assert.equal(conditionsMet([{ minLevel: "soon" }], ctx({ level: 10 })), false);
  });

  it("accepts a bare object as a one-entry list", () => {
    assert.equal(conditionsMet({ minLevel: 2 }, ctx({ level: 2 })), true);
  });

  it("ignores a junk entry rather than throwing", () => {
    assert.equal(conditionsMet([null, "nonsense", { minLevel: 2 }], ctx({ level: 2 })), true);
    assert.equal(conditionsMet([null, "nonsense"], ctx({ level: 2 })), false);
  });

  it("matches when every stated key in an entry holds, across all three names", () => {
    const conditions = [{ race: "Elf", class: "Rogue", subclass: "Thief", minLevel: 3 }];
    assert.equal(conditionsMet(conditions, ctx({ race: "Elf", class: "Rogue", subclass: "Thief", level: 3 })), true);
    assert.equal(conditionsMet(conditions, ctx({ race: "Elf", class: "Rogue", subclass: "Assassin", level: 3 })), false);
  });
});

describe("levelingContextFor", () => {
  it("reads the character", () => {
    const c = levelingContextFor({ rules: { level: 7, species: "Elf", class: "Rogue", subclass: "Thief" } });
    assert.deepEqual(c, { level: 7, race: "Elf", class: "Rogue", subclass: "Thief" });
  });

  it("lets a caller override the level", () => {
    assert.equal(levelingContextFor({ rules: { level: 7 } }, 3).level, 3);
  });

  it("falls back to level 1 rather than NaN", () => {
    assert.equal(levelingContextFor({}).level, 1);
    assert.equal(levelingContextFor(null).level, 1);
  });
});

describe("statModifierType", () => {
  it("classifies the categories the spec names", () => {
    // The op is the discriminator, not the id: armor/weapon/tool
    // proficiencies are taglists (grantTag) while skills and saves are
    // individual checkboxes (grant), and both end in "Prof".
    assert.equal(statModifierType({ targetFieldId: "armorProf", op: "grantTag" }), "equipmentProficiency");
    assert.equal(statModifierType({ targetFieldId: "weaponProf", op: "grantTag" }), "equipmentProficiency");
    assert.equal(statModifierType({ targetFieldId: "stealthProf", op: "grant" }), "proficiency");
    assert.equal(statModifierType({ targetFieldId: "dexSaveProf", op: "grant" }), "proficiency");
    assert.equal(statModifierType({ targetFieldId: "strScore", op: "add" }), "ability");
    assert.equal(statModifierType({ targetFieldId: "initiative", op: "add" }), "stat");
  });

  it("defaults an unrecognized target to a stat rather than dropping the grant", () => {
    // A grant we can't classify is still a grant the player should see.
    assert.equal(statModifierType({ targetFieldId: "mysteryThing" }), "stat");
    assert.equal(statModifierType({}), "stat");
  });
});

describe("grantsIn", () => {
  const bundle = {
    statModifiers: [
      { targetFieldId: "initiative", op: "add", value: 5, minLevel: 3 },
      { targetFieldId: "stealthProf", op: "grant" },
    ],
    featureGrants: [{ id: "f1", name: "Keen Eye", description: "d", minLevel: 5 }],
    resourceGrants: [{ id: "r1", name: "Focus", maximum: 1, reset: "short rest" }],
    choiceGroups: [{ id: "g1", label: "Pick a skill", minSelections: 1, minLevel: 2 }],
    dropdownAccess: [{ targetFieldName: "Subclass", allowedChoiceIds: ["x"], minLevel: 3 }],
  };

  it("produces the spec's shape for every grant", () => {
    for (const grant of grantsIn(bundle, { source: "Test", kind: "Race" })) {
      assert.equal(typeof grant.id, "string");
      assert.ok(GRANT_TYPES.includes(grant.type), `type "${grant.type}" is in the vocabulary`);
      assert.ok(Array.isArray(grant.conditions));
      assert.ok(grant.effect && typeof grant.effect === "object");
      assert.ok(Array.isArray(grant.removalConditions));
    }
  });

  it("covers every source shape", () => {
    assert.equal(grantsIn(bundle).length, 2 + 1 + 1 + 1 + 1);
  });

  it("turns a minLevel into a single unconditional-besides-level condition", () => {
    const [first] = grantsIn({ statModifiers: [{ targetFieldId: "initiative", op: "add", value: 5, minLevel: 3 }] });
    assert.deepEqual(first.conditions, [{ minLevel: 3 }]);
  });

  it("gives an ungated grant no conditions at all", () => {
    const rows = grantsIn({ statModifiers: [{ targetFieldId: "stealthProf", op: "grant" }] });
    assert.deepEqual(rows[0].conditions, []);
  });

  it("gives every grant a unique id", () => {
    const ids = grantsIn(bundle, { source: "Test", kind: "Race" }).map((g) => g.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("keeps ids distinct across bundles", () => {
    const a = grantsIn(bundle, { source: "One", kind: "Race" }).map((g) => g.id);
    const b = grantsIn(bundle, { source: "Two", kind: "Race" }).map((g) => g.id);
    assert.equal(new Set([...a, ...b]).size, a.length + b.length);
  });

  it("tolerates an empty or missing bundle", () => {
    assert.deepEqual(grantsIn(null), []);
    assert.deepEqual(grantsIn({}), []);
  });
});

describe("allGrantsIn", () => {
  const bundles = [
    { name: "Elf", kind: "Race", bundle: { statModifiers: [{ targetFieldId: "initiative", op: "add", value: 5, minLevel: 3 }] } },
    { name: "Rogue", kind: "Class", bundle: { featureGrants: [{ name: "Sneak Attack", description: "d", minLevel: 3 }] } },
    { name: "Broken", kind: "Class", bundle: null },
  ];

  it("tags each grant with where it came from", () => {
    const grants = allGrantsIn(bundles);
    assert.deepEqual(grants.map((g) => `${g.kind}:${g.source}`), ["Race:Elf", "Class:Rogue"]);
  });

  it("skips bundles with no bundle", () => {
    assert.equal(allGrantsIn(bundles).length, 2);
  });

  it("drops a pack-gated grant whose pack isn't in play", () => {
    const gated = [{ name: "Tasha", kind: "Class", bundle: { statModifiers: [{ targetFieldId: "initiative", op: "add", value: 1, requiresPack: "tashas" }] } }];
    assert.equal(allGrantsIn(gated, { includedPacks: ["phb"] }).length, 0);
    assert.equal(allGrantsIn(gated, { includedPacks: ["phb", "tashas"] }).length, 1);
  });
});

describe("activeGrantsIn", () => {
  const grants = [
    { id: "a", type: "ability", conditions: [{ minLevel: 3 }], effect: {} },
    { id: "b", type: "ability", conditions: [], effect: {} },
    { id: "c", type: "ability", conditions: [{ race: "Elf" }], effect: {} },
  ];

  it("keeps grants whose conditions hold", () => {
    const elf = ctx({ level: 5, race: "Elf" });
    assert.deepEqual(activeGrantsIn(grants, elf).map((g) => g.id), ["a", "b", "c"]);
  });

  it("drops grants whose level gate has not been reached", () => {
    assert.deepEqual(activeGrantsIn(grants, ctx({ level: 1, race: "Elf" })).map((g) => g.id), ["b", "c"]);
  });

  it("drops a race-gated grant for the wrong race", () => {
    assert.deepEqual(activeGrantsIn(grants, ctx({ level: 5, race: "Human" })).map((g) => g.id), ["a", "b"]);
  });
});

describe("upcomingGrantsByLevel", () => {
  const grants = [
    { id: "l3", conditions: [{ minLevel: 3 }], effect: {} },
    { id: "l5", conditions: [{ minLevel: 5 }], effect: {} },
    { id: "now", conditions: [], effect: {} },
    { id: "raceOnly", conditions: [{ race: "Elf" }], effect: {} },
    { id: "either", conditions: [{ minLevel: 7 }, { minLevel: 9 }], effect: {} },
  ];

  it("lists only grants that haven't happened yet", () => {
    const groups = upcomingGrantsByLevel(grants, ctx({ level: 3 }));
    assert.deepEqual(groups.map((g) => g.level), [5, 7, 9]);
    assert.ok(!groups.flatMap((g) => g.grants).some((g) => g.id === "now"), "an ungated grant isn't 'coming up'");
    assert.ok(!groups.flatMap((g) => g.grants).some((g) => g.id === "raceOnly"), "nor one gated only on race");
  });

  it("orders by level ascending", () => {
    const levels = upcomingGrantsByLevel(grants, ctx({ level: 1 })).map((g) => g.level);
    assert.deepEqual(levels, [...levels].sort((a, b) => a - b));
  });

  it("puts a grant in every level its OR'd conditions name", () => {
    const groups = upcomingGrantsByLevel([grants[4]], ctx({ level: 1 }));
    assert.deepEqual(groups.map((g) => g.level), [7, 9]);
  });

  it("is empty once everything has happened", () => {
    assert.deepEqual(upcomingGrantsByLevel(grants, ctx({ level: 20 })), []);
  });
});

describe("levelingStepsIn", () => {
  const grants = [
    { id: "l1", conditions: [], effect: {} },
    { id: "l3", conditions: [{ minLevel: 3 }], effect: { name: "Keen Eye" } },
    { id: "l5", conditions: [{ minLevel: 5 }], effect: { name: "Extra Attack" } },
  ];

  it("makes one step per level gained, ascending, excluding level 1", () => {
    assert.deepEqual(levelingStepsIn(grants, ctx({ level: 7 })).map((s) => s.level), [3, 5]);
  });

  it("gives each step the grants active at that level", () => {
    const steps = levelingStepsIn(grants, ctx({ level: 7 }));
    // At level 3 only the level-3 gate has been passed; at 5 both have.
    assert.deepEqual(steps[0].grants.map((g) => g.id), ["l1", "l3"]);
    assert.deepEqual(steps[1].grants.map((g) => g.id), ["l1", "l3", "l5"]);
  });

  it("stops at the level the character is actually at", () => {
    assert.deepEqual(levelingStepsIn(grants, ctx({ level: 3 })).map((s) => s.level), [3]);
  });

  it("has no steps for a brand-new character", () => {
    assert.deepEqual(levelingStepsIn(grants, ctx({ level: 1 })), []);
  });
});

describe("the real content flows through the model", () => {
  it("builds grants for shipped bundles without throwing", async () => {
    const [{ FIXED_RACE_ENTRIES, FIXED_CLASS_ENTRIES }, { LINKED_FEAT_BUNDLES }] = await Promise.all([
      import("../js/data/contentFixups.js"),
      import("../js/data/catalogLinks.js"),
    ]);
    const bundles = [
      ...FIXED_RACE_ENTRIES.map((e) => ({ name: e.name, kind: "Race", bundle: e.bundle })),
      ...FIXED_CLASS_ENTRIES.map((e) => ({ name: e.name, kind: "Class", bundle: e.bundle })),
      ...LINKED_FEAT_BUNDLES.map((b) => ({ name: b.name, kind: "Feat", bundle: b })),
    ];
    const grants = allGrantsIn(bundles);
    assert.ok(grants.length > 100, `expected real content, got ${grants.length} grants`);
    assert.ok(grants.every((g) => GRANT_TYPES.includes(g.type)), "every grant is classifiable");
    assert.ok(grants.every((g) => typeof g.id === "string" && g.id), "every grant is identifiable");
    // Nothing should silently vanish: every source shape contributes.
    const types = new Set(grants.map((g) => g.type));
    assert.ok(types.has("ability") && types.has("optionAccess") && types.has("equipmentProficiency"),
      `expected several types, got ${[...types].join(", ")}`);
  });
});

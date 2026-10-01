// tests/choice-accuracy.test.mjs
//
// Three places where a picker offered the player choices the rules do not
// allow, or put text in the wrong order. All three were invisible to the
// pure-logic suites because each needed either the option vocabulary or a
// rendered DOM.
//
//   1. Tool proficiencies. The picker listed the whole tool vocabulary for
//      every slot, so a background reading "one artisan's tool of your
//      choice" also offered a lute.
//   2. Expertise. The rules say you double a proficiency you ALREADY have
//      ("choose a skill in which you have proficiency"), but the group
//      shipped all 22 skills as options, so expertise was available in
//      Athletics to a character with no proficiency in it - a free
//      proficiency bonus.
//   3. Order on the Abilities step. The note explaining that race and class
//      bonuses apply on top of your scores led the step, above the scores
//      it was describing.
//
// Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toolGroupsForLabel, TOOL_PROFICIENCY_GROUPS } from "../js/data/blockModel.js";

const labelsOf = (groups) => groups.map((g) => g.label);
const allLabels = TOOL_PROFICIENCY_GROUPS.map((g) => g.label);

describe("tool proficiency picks only offer the kind of tool named", () => {
  it("restricts an artisan's tool pick to artisan's tools", () => {
    const groups = toolGroupsForLabel("Guild Artisan Tool Proficiencies: choose one (artisan's tool)");
    assert.deepEqual(labelsOf(groups), ["Artisan's Tools"]);
    const tools = groups.flatMap((g) => g.options);
    assert.ok(tools.includes("Smith's Tools"), "expected the artisan's tools to be offered");
    assert.ok(!tools.includes("Lute"), "a lute is not an artisan's tool");
    assert.ok(!tools.includes("Dice Set"), "a gaming set is not an artisan's tool");
  });

  it("restricts a musical instrument pick to instruments", () => {
    const groups = toolGroupsForLabel("Entertainer Tool Proficiencies: choose one (musical instrument)");
    assert.deepEqual(labelsOf(groups), ["Musical Instruments"]);
    const tools = groups.flatMap((g) => g.options);
    assert.ok(tools.includes("Lute"));
    assert.ok(!tools.includes("Smith's Tools"), "a hammer is not a musical instrument");
  });

  it("restricts a gaming set pick to gaming sets", () => {
    const groups = toolGroupsForLabel("Noble Tool Proficiencies: choose one (gaming set)");
    assert.deepEqual(labelsOf(groups), ["Gaming Sets"]);
    assert.ok(!groups.flatMap((g) => g.options).includes("Lute"));
  });

  it("still offers everything when the wording names no kind", () => {
    // "two tool proficiencies" really is any tool, so filtering here would
    // take away a choice the rules grant. The Urban Bounty Hunter's pick is
    // this case: it ships no options and relies on the fallback.
    for (const label of [
      "Urban Bounty Hunter Tool Proficiencies: choose 2",
      "one tool of your choice",
      "tool proficiency",
    ]) {
      assert.deepEqual(labelsOf(toolGroupsForLabel(label)), allLabels,
        `${label} should still offer every kind of tool`);
    }
  });

  it("does not mistake a kits wording for artisan's tools", () => {
    // "kits or specialty tool" contains "tool", which the artisan branch
    // would otherwise catch.
    const groups = toolGroupsForLabel("one kits or specialty tool of your choice");
    assert.deepEqual(labelsOf(groups), ["Kits & Specialty Tools"]);
  });

  it("keeps every group non-empty", () => {
    for (const g of TOOL_PROFICIENCY_GROUPS) {
      assert.ok(g.options.length > 0, `${g.label} is empty`);
    }
  });
});

describe("expertise only upgrades a proficiency the character has", () => {
  // The narrowing lives in inlineChoiceBullets, which needs the full
  // renderer. What is pinned here is the data it narrows: every expertise
  // option must correspond to a real skill, so the label -> skill id ->
  // "<id>Prof" lookup can resolve it, and no option may be a skill the
  // sheet has no proficiency field for.
  it("every skill has a proficiency field id the owned set can hold", async () => {
    const { SKILLS } = await import("../js/data/schema.js");
    for (const s of SKILLS) {
      assert.match(s.id, /^[a-zA-Z]+$/, `${s.label} has an unexpected id shape: ${s.id}`);
      assert.ok(typeof s.label === "string" && s.label.length, "skill needs a label to match expertise options by");
    }
  });

  it("expertise option names all match a skill label", async () => {
    const { SKILLS } = await import("../js/data/schema.js");
    const labels = new Set(SKILLS.map((s) => s.label));
    const { FIXED_CLASS_ENTRIES } = await import("../js/data/contentFixups.js");
    const entries = FIXED_CLASS_ENTRIES instanceof Map ? [...FIXED_CLASS_ENTRIES] : Object.entries(FIXED_CLASS_ENTRIES);
    let expertiseGroups = 0;
    for (const [, entry] of entries) {
      for (const g of entry?.bundle?.choiceGroups || []) {
        if (!/expertise/i.test(g.label || "")) continue;
        expertiseGroups += 1;
        for (const o of g.options || []) {
          // Either a skill (resolvable) or Thieves' Tools, which is not a
          // SKILLS entry and carries its own proficiency note.
          assert.ok(labels.has(o.name) || /tools/i.test(o.name),
            `${entry.name} expertise option "${o.name}" is neither a skill nor a tool`);
        }
      }
    }
    assert.ok(expertiseGroups > 0, "no expertise groups found to check");
  });
});

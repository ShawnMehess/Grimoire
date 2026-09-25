// tests/bundles.test.mjs
//
// Unit tests for default-bundle strip/hydrate (js/state/bundleMaps.js):
// canonical bundles leave the document on save and reattach on load,
// at any nesting depth; customized bundles survive untouched.
// Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  stripBundlesFromPatch,
  hydrateCharacter,
  bundleDedupeKey,
  DEFAULT_BUNDLE_MAPS,
} from "../js/state/bundleMaps.js";

const firstRace = [...DEFAULT_BUNDLE_MAPS.race.keys()][0];

function dropdown(label, text, bundle) {
  return { id: `f-${label}`, kind: "field", fieldType: "dropdown", label, choices: [{ id: "c1", text, bundle }], selected: "c1" };
}

describe("bundle strip/hydrate", () => {
  it("strips canonical bundles and rehydrates them", () => {
    const canonical = DEFAULT_BUNDLE_MAPS.race.get(firstRace);
    assert.ok(canonical, "test prereq: a canonical race bundle");
    const choiceName = [...DEFAULT_BUNDLE_MAPS.race.entries()].find(([, b]) => b === canonical)[0];
    const doc = { layout: [{ id: "b", kind: "block", name: "Details", children: [dropdown("Race", choiceName, JSON.parse(JSON.stringify(canonical)))] }] };
    const stripped = stripBundlesFromPatch(doc);
    assert.equal(stripped.layout[0].children[0].choices[0].bundle, null);
    assert.ok(doc.layout[0].children[0].choices[0].bundle, "strip clones, never mutates the input");
    const hydrated = hydrateCharacter(JSON.parse(JSON.stringify(stripped)));
    assert.deepEqual(hydrated.layout[0].children[0].choices[0].bundle, canonical);
  });

  it("reaches dropdowns nested inside blocks", () => {
    const canonical = DEFAULT_BUNDLE_MAPS.class.get([...DEFAULT_BUNDLE_MAPS.class.keys()][0]);
    const choiceName = [...DEFAULT_BUNDLE_MAPS.class.entries()].find(([, b]) => b === canonical)[0];
    const doc = {
      layout: [{
        id: "outer", kind: "block", name: "Outer", children: [{
          id: "inner", kind: "block", name: "Inner",
          children: [dropdown("Class", choiceName, JSON.parse(JSON.stringify(canonical)))],
        }],
      }],
    };
    const stripped = stripBundlesFromPatch(doc);
    assert.equal(stripped.layout[0].children[0].children[0].choices[0].bundle, null);
    const hydrated = hydrateCharacter(JSON.parse(JSON.stringify(stripped)));
    assert.deepEqual(hydrated.layout[0].children[0].children[0].choices[0].bundle, canonical);
  });

  it("preserves customized bundles and unknown picks", () => {
    const custom = { id: "c9", text: "Half-Dwarf", bundle: { homebrew: true, statModifiers: [] } };
    const doc = { layout: [{ id: "b", kind: "block", children: [{ id: "f", kind: "field", fieldType: "dropdown", label: "Race", choices: [custom], selected: "c9" }] }] };
    const stripped = stripBundlesFromPatch(doc);
    assert.deepEqual(stripped.layout[0].children[0].choices[0].bundle, { homebrew: true, statModifiers: [] });
    assert.deepEqual(stripBundlesFromPatch({ name: "x" }), { name: "x" });
    assert.equal(hydrateCharacter(null), null);
  });

  it("dedupes bundles by scope, ruleset, category, and name", () => {
    assert.equal(
      bundleDedupeKey({ scope: "a", rulesetId: "PHB ", category: "Race", name: "Elf" }),
      bundleDedupeKey({ scope: "a", rulesetId: "phb", category: "race", name: "elf" })
    );
  });
});

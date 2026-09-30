// tests/subclass-feature-text.test.mjs
//
// The subclass export in docs/New Info was taken from the ACTOR, so every
// feature arrived as a bare `@Compendium[...]{Name}` reference and the
// prose behind it was never in the file. That is why 581 of 640 subclass
// feature grants had no description and were filtered out of the sheet
// entirely by customSheet.js's `!g.unsourced` filter. The feats export
// was taken from the compendium and carries its text, which is why feats
// always had descriptions.
//
// The text now comes from scripts/fetch-subclass-feature-text.mjs via the
// generated SUBCLASS_FEATURE_TEXT. These assert the pipeline end to end,
// and in particular that a scraped rule can be traced to the page it came
// from. Run: node --test tests/subclass-feature-text.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SUBCLASS_FEATURE_TEXT } from "../js/data/subclassFeatureText.js";
import { SUBCLASS_BUNDLE_MAP, patchedSubclassBundle, normSubclassKey } from "../js/data/contentFixups.js";
import { SUBCLASS_SUPPLEMENT } from "../js/data/subclassContent.js";

const patched = (key) => {
  const name = SUBCLASS_SUPPLEMENT.find((s) => normSubclassKey(s.name) === key)?.name || key;
  return patchedSubclassBundle(name, SUBCLASS_BUNDLE_MAP.get(key));
};
const allGrants = () =>
  [...SUBCLASS_BUNDLE_MAP.keys()].flatMap((k) => (patched(k).featureGrants || []).map((g) => ({ key: k, ...g })));

describe("fetched subclass feature text", () => {
  it("covers most subclasses and a clear majority of features", () => {
    const grants = allGrants();
    const withText = grants.filter((g) => (g.description || "").trim()).length;
    // The exact numbers move as the importer improves; the point of the
    // threshold is that a future regression which empties the file again
    // cannot pass quietly.
    assert.ok(withText / grants.length > 0.8, `only ${withText}/${grants.length} features have text`);
    assert.ok(Object.keys(SUBCLASS_FEATURE_TEXT).length > 100, "expected 100+ subclasses fetched");
  });

  it("clears the unsourced flag so the sheet actually renders the feature", () => {
    // This is the whole payoff: customSheet.js filters `unsourced` grants
    // out of the Features list, so filling a description without clearing
    // the flag would leave the player still unable to see it.
    const sourced = allGrants().filter((g) => g.sourceUrl);
    assert.ok(sourced.length > 400, `only ${sourced.length} grants carry fetched text`);
    for (const g of sourced) {
      assert.equal(g.unsourced, false, `${g.key} / ${g.name} is sourced but still flagged unsourced`);
    }
  });

  it("records a source URL on every grant it filled", () => {
    // A scraped rule that cannot be traced back to a page is not a source.
    for (const g of allGrants().filter((x) => x.sourceUrl)) {
      assert.match(g.sourceUrl, /^https:\/\/dnd5e\.wikidot\.com\/[a-z]+:[a-z-]+$/, `${g.key} / ${g.name} has a malformed source URL`);
    }
  });

  it("keeps a pre-existing hand-written description", () => {
    // The fixup must only ever fill a BLANK. Overwriting a deliberate one
    // would silently swap authored text for scraped text.
    const hand = SUBCLASS_SUPPLEMENT.flatMap((s) => (s?.bundle?.featureGrants || [])
      .filter((g) => (g.description || "").trim() && !g.sourceUrl)
      .map((grant) => ({ subclass: s.name, grant })));
    assert.ok(hand.length > 0, "expected some hand-written descriptions to survive");
    for (const { subclass, grant } of hand) {
      const bundle = patchedSubclassBundle(subclass, SUBCLASS_BUNDLE_MAP.get(normSubclassKey(subclass)));
      const after = (bundle?.featureGrants || []).find((x) => x.name === grant.name);
      if (after) assert.equal(after.description, grant.description, `hand-written text for ${grant.name} was overwritten`);
    }
  });

  it("keeps level gates intact on features it supplied text for", () => {
    // Being sourced is not a reason for a feature to appear earlier than
    // its level allows.
    const flare = (patched("lightdomain").featureGrants || []).find((g) => g.name === "Warding Flare");
    assert.ok(flare, "Warding Flare missing");
    assert.equal(flare.minLevel, 1, "Warding Flare is a 1st-level domain feature");
    const crit = (patched("champion").featureGrants || []).find((g) => g.name === "Improved Critical");
    assert.ok(crit, "Improved Critical missing");
    assert.equal(crit.minLevel, 3, "Improved Critical is a 3rd-level Champion feature");
  });
});

describe("fetched text is clean page text, not site chrome", () => {
  // Wikidot appends a nav bar, a licence notice and a "Powered by
  // Wikidot.com" footer after the page content. Nothing on a page stops
  // the segmenter at the end, so all of it used to land inside the LAST
  // feature's description - 113 features carrying site boilerplate.
  const BOILERPLATE = /Wikidot|Terms of Service|Report a bug|Flag as objectionable|objectionable content|Privacy\n\|/i;

  it("has no boilerplate in any fetched feature", () => {
    const bad = [];
    for (const [key, entry] of Object.entries(SUBCLASS_FEATURE_TEXT)) {
      for (const [feature, text] of Object.entries(entry.features)) {
        if (BOILERPLATE.test(text)) bad.push(`${key} / ${feature}`);
      }
    }
    assert.deepEqual(bad, [], `boilerplate found in ${bad.length} features`);
  });

  it("trims the footer off the last feature on a page", () => {
    // A specific page whose final feature previously ran into the nav.
    const text = SUBCLASS_FEATURE_TEXT.schooloftransmutation.features["Master Transmuter"];
    assert.ok(text, "Master Transmuter text missing");
    assert.ok(text.endsWith("lifespan."), `unexpected tail: ${JSON.stringify(text.slice(-60))}`);
  });
});

describe("subclass feature text module", () => {
  it("carries a source URL per subclass", () => {
    for (const [key, entry] of Object.entries(SUBCLASS_FEATURE_TEXT)) {
      assert.match(entry.url, /^https:\/\/dnd5e\.wikidot\.com\//, `${key} has no source URL`);
    }
  });

  it("has no empty feature entries", () => {
    for (const [key, entry] of Object.entries(SUBCLASS_FEATURE_TEXT)) {
      for (const [feature, text] of Object.entries(entry.features)) {
        assert.ok((text || "").trim().length > 20, `${key} / ${feature} is empty or too short to be rules text`);
      }
    }
  });
});

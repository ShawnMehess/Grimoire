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
import { readFileSync } from "node:fs";
import { SUBCLASS_FEATURE_TEXT } from "../js/data/subclassFeatureText.js";
import { SUBCLASS_BUNDLE_MAP, patchedSubclassBundle, normSubclassKey } from "../js/data/contentFixups.js";
import { ALL_SUBCLASS_PICKS } from "../js/data/subclassPicks.js";
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
      assert.match(entry.url, /^https:\/\//, `${key} has no source URL`);
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

describe("the segmenter finds the shapes a wiki page actually uses", () => {
  // Each of these cost real features before it was handled. They are
  // asserted on the real generated output, not on a fixture, so a
  // regression in matching shows up as a missing feature rather than as
  // a passing unit test over a hand-written sample.
  const has = (key, name) => Boolean(SUBCLASS_FEATURE_TEXT[key]?.features?.[name]);

  it("finds a Channel Divinity option, which is a list item and not a heading", () => {
    // A paladin oath page lists these as "- Peerless Athlete. As a bonus
    // action, ...". A "line equals the feature name" check never sees
    // them, so 19 options across 9 oaths were silently empty.
    assert.ok(has("oathofglory", "Peerless Athlete"), "Peerless Athlete not found");
    assert.ok(has("oathofglory", "Inspiring Smite"), "Inspiring Smite not found");
    assert.ok(has("oathofdevotion", "Sacred Weapon"), "Sacred Weapon not found");
    assert.ok(has("oathoftheancients", "Turn the Faithless"), "Turn the Faithless not found");
  });

  it("fans one page section out to every grant that repeats it", () => {
    // The export re-lists a feature once per level and mashes the level
    // range into the name: "Arcane Shot (2 options)" through
    // "(6 options)". The page has ONE section, so it must fill all of
    // them rather than being spent on whichever name sorted first.
    const shots = Object.keys(SUBCLASS_FEATURE_TEXT.arcanearcher.features).filter((f) => /^Arcane Shot/.test(f));
    assert.ok(shots.length >= 5, `only ${shots.length} Arcane Shot grants filled`);
    const texts = new Set(shots.map((f) => SUBCLASS_FEATURE_TEXT.arcanearcher.features[f]));
    assert.equal(texts.size, 1, "the repeated grants should all carry the one page section");
  });

  it("matches a heading the page qualifies with the subclass name", () => {
    // Every cleric domain page says "<Domain> Domain Spells"; the export
    // calls the grant "Bonus Spells" in all of them, so no single exact
    // heading works - only "a heading ending in Domain Spells".
    for (const key of ["arcanadomain", "lifedomain", "lightdomain", "tempestdomain"]) {
      assert.ok(has(key, "Bonus Spells"), `${key} / Bonus Spells not found`);
    }
  });

  it("follows an alias when the export and the page disagree on the name", () => {
    // Export "Expanded Spells" vs page "Expanded Spell List". Not every
    // patron has one - the Fiend and the Great Old One have no expanded
    // list in the 2014 rules, so their pages have no such section and
    // their grant correctly stays blank.
    for (const key of ["thearchfey", "thehexblade", "theundead", "thegenie", "thecelestial"]) {
      assert.ok(has(key, "Expanded Spells"), `${key} / Expanded Spells not found`);
    }
    // Export "Story Work" vs 2024 SRD "Second-Story Work".
    assert.ok(has("thief", "Story Work"), "thief / Story Work not found");
  });

  it("reads a markdown heading from the 2024 SRD", () => {
    // The SRD is markdown, so its headings arrive as "#### Level 3: ..."
    // and would never equal the export's name without de-markdowning.
    const text = SUBCLASS_FEATURE_TEXT.thief?.features?.["Story Work"] || "";
    assert.ok(text.length > 20, "thief / Story Work has no text");
  });
});

describe("the residual is recorded, not silently blank", () => {
  // 2024-revision features and content outside the SRD that no free
  // source carries. They stay blank on purpose - a plausible-looking
  // paraphrase is worse than an empty cell, because a player cannot tell
  // the difference - but the list has to be committed so "unfinished" is
  // visible rather than inferred from a blank.
  it("lists every grant with no public source, with a stated reason", () => {
    const doc = readFileSync(new URL("../docs/subclass-text-gaps.md", import.meta.url), "utf8");
    assert.match(doc, /## Grants with no public source/);
    assert.match(doc, /NOT paraphrased from memory/);
    const listed = [...doc.matchAll(/^- (\w+) :: (.+)$/gm)]
      // Repeat rows carry a "(repeat of X)" note; compare the grant alone.
      .map((m) => `${m[1]} :: ${m[2].replace(/\s*\(repeat of .*\)$/, "")}`);
    assert.ok(listed.length > 0, "the gaps doc lists nothing");

    // Every grant that is still blank must appear in the doc. This is the
    // check that stops a gap from being quietly reintroduced.
    for (const g of allGrants()) {
      if ((g.description || "").trim()) continue;
      assert.ok(listed.includes(`${g.key} :: ${g.name}`),
        `${g.key} :: ${g.name} is blank but missing from docs/subclass-text-gaps.md`);
    }
  });

  it("keeps the blank count small and does not let it grow unnoticed", () => {
    const blank = allGrants().filter((g) => !(g.description || "").trim()).length;
    // A floor, not an exact figure: the residual is 40 unsourceable
    // grants plus a few repeats. If this number climbs, a source has
    // stopped working and the fetcher needs re-running.
    assert.ok(blank <= 45, `${blank} subclass features have no text; the fetcher may have broken`);
  });
});

describe("choices read out of the fetched text", () => {
  // The 4 below were not in the hand-written pick table because the
  // subclass export carried no prose to read a choice out of. Each is
  // asserted against the fetched text it was taken from, so if the text
  // is regenerated and the feature disappears or changes, the pick fails
  // rather than quietly offering choices for a rule that no longer says so.
  const CASES = [
    { key: "collegeofswords", feature: "Fighting Style", level: 3, option: "Dueling",
      choice: /choose one of the following/i },
    // "choose four spells ... one from each of the following levels" -
    // a count of choices, so the phrasing differs from "of your choice".
    { key: "arcanadomain", feature: "Arcane Mastery", level: 17, option: null, groups: 4,
      choice: /choose four spells .*one from each of the following levels/i },
    { key: "deathdomain", feature: "Reaper", level: 1, option: "Chill Touch",
      choice: /one necromancy cantrip of your choice/i },
    { key: "naturedomain", feature: "Acolyte of Nature", level: 1, option: "Animal Handling",
      choice: /cantrip of your choice/i },
  ];

  const pickFor = (key, feature) =>
    (ALL_SUBCLASS_PICKS[key] || []).find((p) => p.feature === feature);

  for (const c of CASES) {
    it(`${c.key} / ${c.feature} has a pick taken from real fetched text`, () => {
      const text = SUBCLASS_FEATURE_TEXT[c.key]?.features?.[c.feature];
      assert.ok(text, `no fetched text for ${c.key} / ${c.feature}`);
      assert.match(text, c.choice,
        `${c.key} / ${c.feature} no longer reads as a choice: ${text.slice(0, 120)}`);

      const pick = pickFor(c.key, c.feature);
      assert.ok(pick, `${c.key} / ${c.feature} has no pick`);
      assert.equal(pick.level, c.level, `${c.key} / ${c.feature} pick is at the wrong level`);
      assert.ok((pick.groups || []).length, `${c.key} / ${c.feature} pick has no groups`);
      if (c.groups) assert.equal(pick.groups.length, c.groups, `${c.key} / ${c.feature} should be ${c.groups} separate picks`);
      if (c.option) {
        const names = pick.groups.flatMap((g) => (g.options || []).map((o) => o.name));
        assert.ok(names.includes(c.option), `${c.key} / ${c.feature} does not offer "${c.option}"`);
      }
    });
  }

  it("does not offer a saved pick for a choice that resets each rest", () => {
    // Bestial Soul, The Third Eye and Master Transmuter all read as
    // "choose one of the following", but the benefit ends with the rest
    // (or, for Master Transmuter, destroys the stone). Saving those would
    // ask the player to decide something that gets thrown away.
    for (const [key, feature] of [
      ["pathofthebeast", "Bestial Soul"],
      ["schoolofdivination", "The Third Eye"],
      ["schooloftransmutation", "Master Transmuter"],
    ]) {
      assert.equal(pickFor(key, feature), undefined, `${key} / ${feature} should not be a saved build pick`);
    }
  });

  it("merges the extra pick table per key instead of replacing it", () => {
    // arcanadomain and naturedomain have entries in BOTH the base table
    // and the extra table. An object spread would discard the base one, so
    // Arcane Initiate and Bonus Proficiency would disappear from the sheet.
    assert.ok(pickFor("arcanadomain", "Arcane Initiate"), "arcanadomain lost its base pick");
    assert.ok(pickFor("naturedomain", "Bonus Proficiency"), "naturedomain lost its base pick");
    assert.ok((ALL_SUBCLASS_PICKS.drakewarden || []).length >= 3, "drakewarden lost entries from one of the tables");
  });

  it("has no duplicate features within a subclass", () => {
    for (const [key, picks] of Object.entries(ALL_SUBCLASS_PICKS)) {
      const seen = new Set();
      for (const p of picks) {
        assert.ok(!seen.has(p.feature), `${key} lists ${p.feature} twice`);
        seen.add(p.feature);
      }
    }
  });
});

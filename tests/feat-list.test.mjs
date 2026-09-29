// tests/feat-list.test.mjs
//
// Unit tests for the Feats list model (js/render/sheet/featList.js).
//
// The row's "= what it modifies" line is derived from the feat bundle's
// own statModifiers rather than written by hand, which is the property
// worth pinning: a feat that stops touching initiative must stop saying
// it does, without anyone remembering to edit a string.
//
// Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  featTargetLabel,
  featEffectSummary,
  featEffectText,
  featSummaryText,
  featRowModel,
  featRowModels,
  featPickableCount,
  featPickableLabel,
  FEAT_SOURCE_DM,
} from "../js/render/sheet/featList.js";
import { FEAT_BUNDLES, FEAT_CATALOG } from "../js/data/featBundles.js";

// Alert, straight from the shipped data: +5 initiative and a long grant.
const ALERT = FEAT_BUNDLES.find((b) => b.name === "Alert");
const ALERT_CATALOG = FEAT_CATALOG.tabs[0].entries.find((e) => e.name === "Alert");

describe("featTargetLabel", () => {
  it("names a known target", () => {
    assert.equal(featTargetLabel("initiative"), "Initiative");
    assert.equal(featTargetLabel("armorClass"), "Armor Class");
  });

  it("abbreviates an ability score the way the rest of the sheet does", () => {
    assert.equal(featTargetLabel("strScore"), "STR");
    assert.equal(featTargetLabel("chaScore"), "CHA");
  });

  it("returns null for a target it can't name, rather than leaking the id", () => {
    // Leaking `initiativeBonus` into the UI would be worse than omitting it.
    assert.equal(featTargetLabel("someInternalThing"), null);
    assert.equal(featTargetLabel(""), null);
    assert.equal(featTargetLabel(null), null);
  });
});

describe("featEffectSummary", () => {
  it("describes the shipped Alert feat from its own modifiers", () => {
    assert.equal(featEffectSummary(ALERT), "Initiative +5");
  });

  it("names a granted proficiency only when the target is one it can read", () => {
    // A skill checkbox target reads as a name; an internal one we can't
    // read is left out rather than leaking `athleticsProf` into the UI.
    assert.equal(featEffectSummary({ statModifiers: [{ targetFieldId: "someInternalThing", op: "grant" }] }), "");
  });

  it("joins several changes", () => {
    const bundle = {
      statModifiers: [
        { targetFieldId: "initiative", op: "add", value: 5 },
        { targetFieldId: "stealthProf", op: "grant" },
        { targetFieldId: "chaScore", op: "add", value: 1 },
      ],
    };
    assert.equal(featEffectSummary(bundle), "Initiative +5, CHA +1");
  });

  it("dedupes a repeated change", () => {
    const bundle = {
      statModifiers: [
        { targetFieldId: "initiative", op: "add", value: 5 },
        { targetFieldId: "initiative", op: "add", value: 5 },
      ],
    };
    assert.equal(featEffectSummary(bundle), "Initiative +5");
  });

  it("skips level-gated modifiers, which aren't the feat's identity", () => {
    const bundle = {
      statModifiers: [{ targetFieldId: "initiative", op: "add", value: 5, minLevel: 5 }],
    };
    assert.equal(featEffectSummary(bundle), "");
  });

  it("is empty for a feat with no statModifiers at all", () => {
    // A real case, not a degenerate one - a feat can be purely a feature
    // note. Showing nothing beats showing noise.
    assert.equal(featEffectSummary({ statModifiers: [] }), "");
    assert.equal(featEffectSummary(null), "");
  });
});

describe("featEffectText", () => {
  it("returns the shipped feat's mechanical text", () => {
    const text = featEffectText(ALERT);
    assert.ok(text.includes("+5 bonus to initiative"), "should carry the real rule text");
  });

  it("drops the sheet's own bookkeeping block", () => {
    // The compiled grants append "Sheet notes:" for the sheet's benefit;
    // that isn't part of the feat's printed rules.
    const text = featEffectText(ALERT);
    assert.ok(!/Sheet notes:/i.test(text), `should not include the notes block: ${text.slice(-80)}`);
  });

  it("is empty for a feat with no grant text", () => {
    assert.equal(featEffectText({ featureGrants: [] }), "");
    assert.equal(featEffectText(null), "");
  });
});

describe("featSummaryText", () => {
  it("prefers the catalog summary", () => {
    assert.equal(featSummaryText(ALERT_CATALOG, ALERT), ALERT_CATALOG.description.trim());
  });

  it("falls back to the first sentence of the mechanical text", () => {
    const bundle = { featureGrants: [{ description: "First sentence here. Second sentence here." }] };
    assert.equal(featSummaryText(null, bundle), "First sentence here.");
  });

  it("uses the whole text when it has no sentence break", () => {
    const bundle = { featureGrants: [{ description: "No full stop" }] };
    assert.equal(featSummaryText(null, bundle), "No full stop");
  });
});

describe("featRowModel", () => {
  it("builds the full row for a shipped feat", () => {
    const row = featRowModel(ALERT, ALERT_CATALOG, { taken: true, remaining: 1 });
    assert.equal(row.name, "Alert");
    assert.equal(row.modifies, "Initiative +5");
    assert.equal(row.taken, true);
    assert.ok(row.effect.length > 0, "the mechanical line has real text");
    assert.ok(row.summary.length > 0, "the summary line has real text");
  });

  it("returns null for a feat with no name at all", () => {
    assert.equal(featRowModel(null, null), null);
    assert.equal(featRowModel({}, {}), null);
  });

  it("defaults to not-taken and pickable", () => {
    const row = featRowModel(ALERT, ALERT_CATALOG);
    assert.equal(row.taken, false);
    assert.equal(row.pickable, true);
    assert.equal(row.source, null);
  });

  it("records where a held feat came from", () => {
    assert.equal(featRowModel(ALERT, null, { taken: true, source: "lineage" }).source, "lineage");
    assert.equal(featRowModel(ALERT, null, { taken: true, source: FEAT_SOURCE_DM }).source, FEAT_SOURCE_DM);
  });

  it("keeps taken and pickable independent", () => {
    // A spent gate means the feat is held but no further pick is allowed,
    // which is a real state and must not collapse into "taken".
    const row = featRowModel(ALERT, null, { taken: true, pickable: false });
    assert.equal(row.taken, true);
    assert.equal(row.pickable, false);
  });

  it("uses a marker icon, because no feat ships with art", () => {
    assert.equal(featRowModel(ALERT, ALERT_CATALOG).icon, "marker");
    assert.equal(featRowModel(ALERT, { imageData: "data:image/png;base64,x" }).icon, "image");
  });
});

describe("featRowModels", () => {
  const bundles = [
    { name: "Alert", statModifiers: [{ targetFieldId: "initiative", op: "add", value: 5 }] },
    { name: "Actor", statModifiers: [] },
    { name: "Skilled", statModifiers: [] },
  ];

  it("marks later rows unpickable once no picks remain", () => {
    const rows = featRowModels(bundles, [], { takenFeats: [{ name: "Alert" }], remaining: 0 });
    const alert = rows.find((r) => r.name === "Alert");
    const actor = rows.find((r) => r.name === "Actor");
    assert.equal(alert.taken, true);
    assert.equal(actor.taken, false);
    assert.ok(rows.every((r) => !r.pickable), "no picks left, so nothing is pickable");
  });

  it("keeps a DM-granted feat from reading as spent", () => {
    // The DM granted it, so the character still has its normal pick.
    const rows = featRowModels(bundles, [], { takenFeats: [{ name: "Alert", source: FEAT_SOURCE_DM }], remaining: 1 });
    assert.equal(rows.find((r) => r.name === "Alert").taken, true);
    assert.ok(rows.every((r) => r.pickable), "the remaining pick is still available");
  });

  it("treats no remaining as unlimited", () => {
    const rows = featRowModels(bundles, [], { takenFeats: [{ name: "Alert" }], remaining: Infinity });
    assert.ok(rows.every((r) => r.pickable));
  });

  it("matches catalog entries to bundles by name", () => {
    const rows = featRowModels(bundles, [{ name: "Alert", description: "Catalog summary text." }], {});
    assert.equal(rows.find((r) => r.name === "Alert").summary, "Catalog summary text.");
  });

  it("skips nameless entries rather than rendering a blank row", () => {
    const rows = featRowModels([{ statModifiers: [] }, { name: "Alert" }], [], {});
    assert.equal(rows.length, 1);
  });
});

describe("featPickableCount / Label", () => {
  it("counts only feats that went through the gate", () => {
    const count = featPickableCount([{ name: "A" }, { name: "B", source: FEAT_SOURCE_DM }], 0);
    assert.equal(count.taken, 1, "the DM-granted one didn't use a pick");
  });

  it("reports the limit as taken plus what's left", () => {
    assert.deepEqual(featPickableCount([{ name: "A" }], 1), { taken: 1, limit: 2, remaining: 1 });
  });

  it("treats an unlimited character as having no limit", () => {
    const count = featPickableCount([{ name: "A" }], Infinity);
    assert.equal(count.limit, null);
    assert.equal(count.remaining, null);
  });

  it("never reports a negative remainder", () => {
    assert.equal(featPickableCount([], -3).remaining, 0);
  });

  it("reads naturally in each state", () => {
    assert.match(featPickableLabel([], 0), /^No feat picks left/);
    assert.match(featPickableLabel([], 1), /^1 feat pick left/);
    assert.match(featPickableLabel([], 2), /^2 feat picks left/);
    assert.match(featPickableLabel([{ name: "A" }], Infinity), /no limit/);
    assert.match(featPickableLabel([{ name: "A" }], 0), /^No feat picks left \(1\/1 used\)$/);
  });
});

describe("every shipped feat produces a usable row", () => {
  const catalogEntries = FEAT_CATALOG.tabs.flatMap((t) => t.entries || []);

  it("builds a row for all of them", () => {
    const rows = featRowModels(FEAT_BUNDLES, catalogEntries, {});
    assert.equal(rows.length, FEAT_BUNDLES.length);
    assert.ok(rows.every((r) => r.name), "no blank names");
  });

  it("gives every row a mechanical effect line", () => {
    // If this ever fails, a feat has no usable rules text and the list is
    // showing a name with nothing under it.
    const rows = featRowModels(FEAT_BUNDLES, catalogEntries, {});
    const blank = rows.filter((r) => !r.effect);
    assert.deepEqual(blank.map((r) => r.name), [], "feats with no effect text");
  });

  it("gives every row a summary line", () => {
    const rows = featRowModels(FEAT_BUNDLES, catalogEntries, {});
    const blank = rows.filter((r) => !r.summary);
    assert.deepEqual(blank.map((r) => r.name), [], "feats with no summary");
  });

  it("names every bundle a catalog entry exists for", () => {
    const bundleNames = new Set(FEAT_BUNDLES.map((b) => b.name));
    const catalogNames = new Set(catalogEntries.map((e) => e.name));
    const onlyInCatalog = catalogEntries.filter((e) => !bundleNames.has(e.name)).map((e) => e.name);
    const onlyInBundles = FEAT_BUNDLES.filter((b) => !catalogNames.has(b.name)).map((b) => b.name);
    assert.deepEqual(onlyInCatalog, [], "catalog entries with no mechanics");
    assert.deepEqual(onlyInBundles, [], "mechanics with no catalog entry");
  });
});

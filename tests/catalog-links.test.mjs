// tests/catalog-links.test.mjs
//
// Unit tests for the explicit bundle -> catalog link
// (js/data/catalogLinks.js). The point of the link is that flavor lookup
// stops depending on names matching, so most of what's tested here is
// that the id actually resolves, and that the old name match survives only
// as a fallback for entries that have no link at all.
//
// Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  slugForName,
  catalogEntryId,
  assignCatalogEntryIds,
  withCatalogLink,
  linkEntries,
  kindForBundleCategory,
  migrateBundleCatalogLinks,
} from "../js/data/catalogLinks.js";
import { catalogEntryInfoIn } from "../js/render/sheet/sheetWizard.js";
import { DEFAULT_CONTENT } from "../js/data/defaultContent.js";
import { FEAT_CATALOG } from "../js/data/featBundles.js";

function catalogWith(...entries) {
  return { name: "Classes", tabs: [{ name: "Classes", entries }] };
}

describe("catalog entry ids", () => {
  it("slugs names down to a stable key", () => {
    assert.equal(slugForName("Circle of the Land"), "circle-of-the-land");
    assert.equal(slugForName("  Urban Bounty Hunter "), "urban-bounty-hunter");
    assert.equal(slugForName("Yuan-ti"), "yuan-ti");
    // Punctuation-only names have no slug rather than a bare "-".
    assert.equal(slugForName("!!!"), "");
  });

  it("namespaces ids by kind so a class and a race can share a name", () => {
    assert.equal(catalogEntryId("class", "Hunter"), "class:hunter");
    assert.equal(catalogEntryId("race", "Hunter"), "race:hunter");
    assert.notEqual(catalogEntryId("class", "Hunter"), catalogEntryId("race", "Hunter"));
  });

  it("returns an empty id for an unnameable entry", () => {
    assert.equal(catalogEntryId("class", ""), "");
  });
});

describe("assignCatalogEntryIds", () => {
  it("mints ids from the catalog and tab names", () => {
    const catalog = catalogWith({ name: "Barbarian", description: "d" });
    assignCatalogEntryIds([catalog]);
    assert.equal(catalog.tabs[0].entries[0].id, "class:barbarian");
  });

  it("reads a subclass tab as subclasses even though the catalog is Classes", () => {
    const catalog = { name: "Classes", tabs: [{ name: "Subclasses", entries: [{ name: "Champion" }] }] };
    assignCatalogEntryIds([catalog]);
    assert.equal(catalog.tabs[0].entries[0].id, "subclass:champion");
  });

  it("leaves an entry that already has an id alone", () => {
    const catalog = catalogWith({ name: "Barbarian", id: "hand-written-id" });
    assignCatalogEntryIds([catalog]);
    assert.equal(catalog.tabs[0].entries[0].id, "hand-written-id");
  });

  it("skips catalogs it doesn't own, rather than guessing a kind", () => {
    const catalog = { name: "Adventuring Gear", tabs: [{ name: "Gear", entries: [{ name: "Rope" }] }] };
    assignCatalogEntryIds([catalog]);
    assert.equal(catalog.tabs[0].entries[0].id, undefined);
  });

  it("tolerates a catalog with no tabs", () => {
    assert.doesNotThrow(() => assignCatalogEntryIds([{ name: "Empty" }, null]));
  });
});

describe("withCatalogLink", () => {
  it("links a bundle without mutating it", () => {
    const bundle = { statModifiers: [] };
    const linked = withCatalogLink(bundle, "race", "Elf");
    assert.equal(linked.catalogEntryId, "race:elf");
    assert.equal(bundle.catalogEntryId, undefined, "input is shared, so it must not be mutated");
  });

  it("keeps an existing link rather than re-deriving it", () => {
    const bundle = { catalogEntryId: "race:deliberate-override" };
    assert.equal(withCatalogLink(bundle, "race", "Elf"), bundle);
  });

  it("passes a null bundle through", () => {
    assert.equal(withCatalogLink(null, "race", "Elf"), null);
  });

  it("links a whole entry list in one pass", () => {
    const out = linkEntries([{ name: "Elf", bundle: {} }, { name: "Dwarf", bundle: {} }], "race");
    assert.deepEqual(out.map((e) => e.bundle.catalogEntryId), ["race:elf", "race:dwarf"]);
  });
});

describe("catalogEntryInfoIn id lookup", () => {
  const catalogs = [
    catalogWith({ id: "class:barbarian", name: "Barbarian", description: "Rage." }),
    { name: "Races", tabs: [{ name: "Races", entries: [{ id: "race:elf", name: "Elf", description: "Keen." }] }] },
  ];

  it("resolves by id even when the name would not match", () => {
    const info = catalogEntryInfoIn(catalogs, ["class"], "Some Renamed Class", "class:barbarian");
    assert.equal(info?.description, "Rage.");
  });

  it("prefers the id over a same-named entry elsewhere", () => {
    const info = catalogEntryInfoIn(catalogs, ["class"], "Elf", "class:barbarian");
    assert.equal(info?.description, "Rage.", "the explicit link wins over the name match");
  });

  it("falls back to matching by name when there is no link", () => {
    const info = catalogEntryInfoIn(catalogs, ["race"], "Elf");
    assert.equal(info?.description, "Keen.");
  });

  it("falls back to the name when the link points nowhere", () => {
    const info = catalogEntryInfoIn(catalogs, ["race"], "Elf", "race:stale-id");
    assert.equal(info?.description, "Keen.");
  });

  it("returns null when neither the link nor the name resolves", () => {
    assert.equal(catalogEntryInfoIn(catalogs, ["race"], "Nobody", "race:nobody"), null);
  });

  it("returns null for a blank name with no link", () => {
    assert.equal(catalogEntryInfoIn(catalogs, ["race"], ""), null);
  });

  it("tolerates an empty catalog list", () => {
    assert.equal(catalogEntryInfoIn([], ["race"], "Elf", "race:elf"), null);
  });
});

describe("kindForBundleCategory", () => {
  it("maps the library's own category strings to kinds", () => {
    assert.equal(kindForBundleCategory("Race"), "race");
    assert.equal(kindForBundleCategory("feat"), "feat");
    assert.equal(kindForBundleCategory("Subclass"), "subclass");
    assert.equal(kindForBundleCategory("Background"), "background");
    assert.equal(kindForBundleCategory("Class"), "class");
  });

  it("returns empty for a category it doesn't recognize", () => {
    assert.equal(kindForBundleCategory("Spell Thing"), "");
    assert.equal(kindForBundleCategory(""), "");
  });
});

describe("migrateBundleCatalogLinks", () => {
  const catalogs = [
    catalogWith({ id: "class:barbarian", name: "Barbarian" }),
    { name: "Races", tabs: [{ name: "Races", entries: [{ id: "race:elf", name: "Elf" }] }] },
  ];

  it("backfills a legacy name-only entry", () => {
    const { bundles, linked } = migrateBundleCatalogLinks([{ name: "Barbarian", category: "Class" }], catalogs);
    assert.equal(bundles[0].catalogEntryId, "class:barbarian");
    assert.deepEqual(linked, ['Class "Barbarian" -> class:barbarian']);
  });

  it("leaves an already-linked entry untouched", () => {
    const entry = { name: "Barbarian", category: "Class", catalogEntryId: "class:barbarian" };
    const { bundles, linked } = migrateBundleCatalogLinks([entry], catalogs);
    assert.equal(bundles[0], entry, "no needless copy");
    assert.deepEqual(linked, []);
  });

  it("never mutates its input", () => {
    const input = [{ name: "Elf", category: "Race" }];
    migrateBundleCatalogLinks(input, catalogs);
    assert.equal(input[0].catalogEntryId, undefined);
  });

  it("reports an entry with no catalog counterpart instead of guessing", () => {
    const { bundles, unresolved } = migrateBundleCatalogLinks([{ name: "Homebrew", category: "Class" }], catalogs);
    assert.equal(bundles[0].catalogEntryId, undefined);
    assert.deepEqual(unresolved, ['Class "Homebrew"']);
  });

  it("reports an entry whose category maps to no kind", () => {
    const { unresolved } = migrateBundleCatalogLinks([{ name: "Mystery", category: "" }], catalogs);
    assert.deepEqual(unresolved, ['? "Mystery"']);
  });

  it("matches on the name across all catalogs, not just the first", () => {
    const { bundles } = migrateBundleCatalogLinks([{ name: "Elf", category: "Race" }], catalogs);
    assert.equal(bundles[0].catalogEntryId, "race:elf");
  });

  it("tolerates an empty bundle list", () => {
    const { bundles, linked, unresolved } = migrateBundleCatalogLinks([], catalogs);
    assert.deepEqual(bundles, []);
    assert.deepEqual(linked, []);
    assert.deepEqual(unresolved, []);
  });
});

describe("baked-in content is actually linked", () => {
  it("mints a unique id for every catalog entry", () => {
    assignCatalogEntryIds(DEFAULT_CONTENT.catalogs);
    assignCatalogEntryIds([FEAT_CATALOG]);
    const ids = new Set();
    let total = 0;
    for (const cat of [...DEFAULT_CONTENT.catalogs, FEAT_CATALOG]) {
      for (const tab of cat.tabs || []) {
        for (const e of tab.entries || []) {
          total++;
          assert.ok(e.id, `catalog entry "${e.name}" should have an id`);
          assert.ok(!ids.has(e.id), `duplicate catalog id: ${e.id}`);
          ids.add(e.id);
        }
      }
    }
    assert.ok(total > 200, `expected the real content, got ${total} entries`);
  });

  it("resolves a real bundle's flavor through its link", () => {
    assignCatalogEntryIds(DEFAULT_CONTENT.catalogs);
    const elves = DEFAULT_CONTENT.catalogs
      .find((c) => c.name === "Races")
      .tabs[0].entries.find((e) => e.name === "Elf");
    const info = catalogEntryInfoIn(DEFAULT_CONTENT.catalogs, ["race"], "Whatever It Is Called Now", elves.id);
    assert.equal(info?.description, elves.description);
    assert.ok(info?.description, "Elf should have real flavor text");
  });
});

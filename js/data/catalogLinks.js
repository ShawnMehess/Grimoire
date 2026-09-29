// catalogLinks.js
//
// The explicit link between the two halves of character-creation content:
//
//   - a BUNDLE (js/data/contentFixups.js and friends) is the mechanical
//     side: stat modifiers, granted proficiencies, resources, choice groups.
//   - a CATALOG ENTRY (js/data/defaultContent.js `catalogs`, plus
//     FEAT_CATALOG) is the flavor side: description text and a portrait.
//
// The wizard needs both for the same picker row, but they were only ever
// correlated by NAME (see catalogEntryInfoIn). That works right up until
// someone renames a class on one side and not the other, at which point
// the row silently loses its portrait and description with no error.
//
// So every catalog entry gets a stable id minted from its kind + name
// ("class:barbarian", "subclass:champion"), and every bundle records the
// id it should read its flavor from. The link then survives renames: only
// the flavor text inside the entry changes, not the pairing.
//
// Ids are assigned here rather than baked into defaultContent.js /
// featBundles.js because those are generated files — see RESCUE-NOTES.md
// ("Regenerating this later"). This module is the fixup layer on top.

/** Lowercase, punctuation-insensitive slug. "Circle of the Land" and
 *  "circle-of-the-land" both become "circle-of-the-land". */
export function slugForName(name) {
  return (name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The stable id for a catalog entry. `kind` is one of
 *  race | class | subclass | background | feat. */
export function catalogEntryId(kind, name) {
  const slug = slugForName(name);
  return slug ? `${kind}:${slug}` : "";
}

/** Which kind a catalog/tab holds, from its own name. Defaults to "" when
 *  the catalog is one this module doesn't own a slug scheme for (a user's
 *  imported catalog, say), which leaves those entries' ids alone. */
function kindForCatalogTab(catalogName, tabName) {
  const text = `${catalogName || ""} ${tabName || ""}`.toLowerCase();
  if (/\bsubclass/.test(text)) return "subclass";
  if (/\brace|\bspecies/.test(text)) return "race";
  if (/\bclass/.test(text)) return "class";
  if (/\bbackground/.test(text)) return "background";
  if (/\bfeat/.test(text)) return "feat";
  return "";
}

/** Fill in `entry.id` on any catalog entry that doesn't already carry one.
 *  Returns the same array (mutated in place) so callers can wrap a
 *  DEFAULT_CONTENT-derived catalog without cloning it. Entries that already
 *  have an id — a user's imported catalog — are left exactly as they are;
 *  that's their id to own. */
export function assignCatalogEntryIds(catalogs) {
  for (const cat of catalogs || []) {
    if (!cat) continue;
    for (const tab of cat.tabs || []) {
      const kind = kindForCatalogTab(cat.name, tab.name);
      if (!kind) continue;
      for (const entry of tab.entries || []) {
        if (entry.id) continue;
        const id = catalogEntryId(kind, entry.name);
        if (id) entry.id = id;
      }
    }
  }
  return catalogs || [];
}

/** Link a bundle to the catalog entry holding its flavor. Returns a new
 *  object — bundles are shared across the starter dropdowns, the library,
 *  and save/load canonicals, so this never mutates in place. An existing
 *  link is preserved: once linked, re-linking by name would undo a
 *  deliberate override. */
export function withCatalogLink(bundle, kind, name) {
  if (!bundle) return bundle;
  if (bundle.catalogEntryId) return bundle;
  const id = catalogEntryId(kind, name);
  return id ? { ...bundle, catalogEntryId: id } : bundle;
}

/** Link a list of `{ name, bundle }` entries (the shape DEFAULT_CONTENT's
 *  classEntries/raceEntries/bgEntries use) in one pass. */
export function linkEntries(entries, kind) {
  return (entries || []).map((entry) => ({
    ...entry,
    bundle: withCatalogLink(entry.bundle, kind, entry.name),
  }));
}

// Feats are baked into featBundles.js, which is generated — so the link
// is applied on read here rather than baked in at the source. Import
// last (after the pure helpers above) to keep the dependency one-way.
import { FEAT_BUNDLES } from "./featBundles.js";
import { withChoiceGroupCategories } from "./choiceCategories.js";

/** FEAT_BUNDLES with both fixups applied: linked to their FEAT_CATALOG
 *  entry (for flavor/portrait) and carrying explicit choice-group
 *  categories. Callers needing a feat's mechanics bundle should read this,
 *  not the raw export. Feat entries ARE bundles (they carry a name and
 *  category alongside their mechanics), not {name, bundle} wrappers, so
 *  they link directly. */
export const LINKED_FEAT_BUNDLES = FEAT_BUNDLES.map((bundle) =>
  withChoiceGroupCategories(withCatalogLink(bundle, "feat", bundle.name))
);

/** Which kind a bundle's own `category` claims, for migration. Mirrors
 *  kindForCatalogTab but reads a library entry's category instead of a
 *  catalog/tab name — and normalizes case, since "Feat" and "feat" both
 *  occur depending on which code path created the entry. */
export function kindForBundleCategory(category) {
  const text = (category || "").trim().toLowerCase();
  if (!text) return "";
  if (/subclass/.test(text)) return "subclass";
  if (/race|species/.test(text)) return "race";
  if (/class/.test(text)) return "class";
  if (/background/.test(text)) return "background";
  if (/feat/.test(text)) return "feat";
  return "";
}

/** Backfill `catalogEntryId` on library entries saved before the link
 *  existed, by matching their name against the catalog of their category.
 *  This is the one place name-matching is still used, and deliberately so:
 *  it's a migration reading the OLD data, not a lookup the UI depends on.
 *  Once a bundle is linked it never re-derives from its name, so a rename
 *  on either side afterwards can't break the pairing.
 *
 *  Returns `{ bundles, linked, unresolved }` — `bundles` are new objects
 *  (the caller's originals are never mutated); `unresolved` names the
 *  entries nothing matched, so a caller can surface them instead of
 *  silently shipping a broken link. */
export function migrateBundleCatalogLinks(bundles = [], catalogs = []) {
  const ids = new Set();
  for (const cat of catalogs || []) {
    for (const tab of cat.tabs || []) {
      for (const entry of tab.entries || []) if (entry.id) ids.add(entry.id);
    }
  }
  const linked = [];
  const unresolved = [];
  const out = (bundles || []).map((bundle) => {
    if (bundle.catalogEntryId) return bundle;
    const kind = kindForBundleCategory(bundle.category);
    const id = catalogEntryId(kind, bundle.name);
    // Only claim a link that actually resolves. Guessing wrong would
    // point the bundle at some other entry's portrait, which is worse
    // than the plain missing-flavor state the fallback already handles.
    if (!id || !ids.has(id)) {
      unresolved.push(`${bundle.category || "?"} "${bundle.name || ""}"`);
      return bundle;
    }
    linked.push(`${bundle.category || "?"} "${bundle.name || ""}" -> ${id}`);
    return { ...bundle, catalogEntryId: id };
  });
  return { bundles: out, linked, unresolved };
}

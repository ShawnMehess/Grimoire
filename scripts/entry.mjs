// entry.mjs — print ONE shipped content entry as JSON, so a "what's in X"
// or "does X exist" question is a cheap query instead of a grep on a
// 200k-token file.
//   node scripts/entry.mjs <catalog> <name>   -> that entry as JSON (stdout)
//   node scripts/entry.mjs --list <catalog>    -> every name, sorted
//   node scripts/entry.mjs --catalogs          -> catalog keys
// Output is the canonical data the app renders (fixed-up races/classes/bg,
// linked feats), so it matches the sheet. Hints go to stderr, JSON to stdout.

import {
  SPELL_CATALOG,
  WEAPONS_ARMOR_CATALOG,
  GEAR_CATALOG,
} from "../js/data/contentCatalogs.js";
import { LINKED_FEAT_BUNDLES } from "../js/data/catalogLinks.js";
import {
  FIXED_RACE_ENTRIES,
  FIXED_CLASS_ENTRIES,
  FIXED_BG_ENTRIES,
  SUBCLASS_BUNDLE_MAP,
} from "../js/data/contentFixups.js";
import { RACE_EXTRA_ENTRIES } from "../js/data/extraRaces.js";
import { SUBCLASS_SUPPLEMENT } from "../js/data/subclassContent.js";

const err = (msg) => process.stderr.write(msg + "\n");
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// Catalog-tab groups share { tabs: [{ id, entries: [{name,...}] }] }.
const fromTabs = (catalog) => {
  const out = [];
  for (const tab of catalog?.tabs || []) {
    for (const entry of tab.entries || []) out.push({ entry, tab: tab.id });
  }
  return out;
};
const fromList = (list) => (list || []).map((entry) => ({ entry, tab: null }));
const uniqueSorted = (items) =>
  [...new Set(items.map((i) => i.entry?.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));

const CATALOGS = {
  spell: () => fromTabs(SPELL_CATALOG),
  spells: () => fromTabs(SPELL_CATALOG),
  weapon: () => fromTabs(WEAPONS_ARMOR_CATALOG).filter((i) => i.tab === "weapons"),
  armor: () => fromTabs(WEAPONS_ARMOR_CATALOG).filter((i) => i.tab === "armor"),
  gear: () => fromTabs(GEAR_CATALOG),
  feat: () => fromList(LINKED_FEAT_BUNDLES),
  race: () => fromList([...FIXED_RACE_ENTRIES, ...RACE_EXTRA_ENTRIES]),
  class: () => fromList(FIXED_CLASS_ENTRIES),
  background: () => fromList(FIXED_BG_ENTRIES),
  bg: () => fromList(FIXED_BG_ENTRIES),
  subclass: () =>
    (SUBCLASS_SUPPLEMENT || []).map((s) => ({
      entry: {
        key: s.key,
        name: s.name,
        className: s.className,
        // Canonical (fixed-up) bundle; fall back to the raw compiled one.
        bundle: SUBCLASS_BUNDLE_MAP.get(s.key) || s.bundle,
      },
      tab: null,
    })),
};

// Exact, then prefix, then substring — so a typo still surfaces the entry.
function match(items, query) {
  const q = norm(query);
  const named = items.filter((i) => i.entry?.name);
  let hit = named.filter((i) => norm(i.entry.name) === q);
  if (!hit.length) hit = named.filter((i) => norm(i.entry.name).startsWith(q));
  if (!hit.length) hit = named.filter((i) => norm(i.entry.name).includes(q));
  return hit;
}

function levelOf(tabId) {
  if (tabId === "cantrips") return 0;
  const n = Number(String(tabId).replace("level", ""));
  return Number.isFinite(n) ? n : null;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    err("usage: node scripts/entry.mjs <catalog> <name>\n       node scripts/entry.mjs --list <catalog>\n       node scripts/entry.mjs --catalogs");
    return 2;
  }
  if (args[0] === "--catalogs") {
    process.stdout.write(Object.keys(CATALOGS).join(", ") + "\n");
    return 0;
  }
  if (args[0] === "--list") {
    const key = norm(args[1]);
    const get = CATALOGS[key];
    if (!get) { err(`unknown catalog "${args[1]}"`); return 2; }
    process.stdout.write((uniqueSorted(get()).join("\n") || "") + "\n");
    return 0;
  }

  const key = norm(args[0]);
  const get = CATALOGS[key];
  if (!get) { err(`unknown catalog "${args[0]}" - run --catalogs`); return 2; }
  const name = args.slice(1).join(" ");
  if (!name) { err(`usage: node scripts/entry.mjs ${key} <name>`); return 2; }

  const all = get();
  const hits = match(all, name);
  if (!hits.length) {
    const near = uniqueSorted(all).filter((n) => norm(n).includes(norm(name))).slice(0, 12);
    err(`no "${name}" in ${key}${near.length ? ". close: " + near.join(", ") : " - run --list " + key}`);
    return 1;
  }

  // Shallow-clone: spellNameIndex() returns tab entries by reference, so
  // adding _level must not mutate the module's cached object.
  const first = hits[0];
  const out = { ...first.entry };
  if (key === "spell" || key === "spells") {
    const lvl = levelOf(first.tab);
    if (lvl !== null) out._level = lvl;
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  if (hits.length > 1) err(`(${hits.length} matches; showing first: "${first.entry.name}")`);
  return 0;
}

process.exit(main());

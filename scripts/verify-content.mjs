#!/usr/bin/env node
// scripts/verify-content.mjs
//
// End-to-end content verification: proves every compiled bundle
// (classes, races, backgrounds, subclasses, feats, spell/item catalogs)
// resolves against the real starter sheet and that a creation-to-20
// simulation applies cleanly. No DOM, no Firebase — pure modules only.
//
//   node scripts/verify-content.mjs
//
// Exits non-zero on the first failure so it can gate commits alongside
// scripts/smoke-imports.mjs. Known hand-tracked gaps (free-form picks
// like "track your pick by hand") are counted and reported, never
// failed on.

import { readFileSync } from "node:fs";
import { DEFAULT_CONTENT } from "../js/data/defaultContent.js";
import { SUBCLASS_SUPPLEMENT } from "../js/data/subclassContent.js";
import { FEAT_BUNDLES, FEAT_CATALOG } from "../js/data/featBundles.js";
import { RACE_EXTRA_ENTRIES } from "../js/data/extraRaces.js";
import { SPELL_CATALOG, WEAPONS_ARMOR_CATALOG, GEAR_CATALOG } from "../js/data/contentCatalogs.js";
import { createStarterLayout } from "../js/data/blockModel.js";
import { assignCatalogEntryIds, migrateBundleCatalogLinks, LINKED_FEAT_BUNDLES } from "../js/data/catalogLinks.js";
import { FIXED_RACE_ENTRIES, FIXED_CLASS_ENTRIES, FIXED_BG_ENTRIES, SUBCLASS_BUNDLE_MAP } from "../js/data/contentFixups.js";
import { catalogEntryInfoIn } from "../js/render/sheet/sheetWizard.js";
import { CHOICE_GROUP_CATEGORY_KEYS, categorizeChoiceGroup } from "../js/render/sheet/sheetMechanics.js";
import { inferChoiceCategory, CATCH_ALL_CATEGORY } from "../js/data/choiceCategories.js";
import { stripBundlesFromPatch, hydrateCharacter } from "../js/state/bundleMaps.js";
import {
  activeChoiceGroupsFor,
  selectedRuleOptionsIn,
  applyStatModifiers,
  applyBundleModifiersIn,
  featChoiceGroupsFor,
  selectedFeatBundlesIn,
  collectGrantedFeaturesIn,
  collectListItemGrantsIn,
  narrowChoicesByBundleAccess,
} from "../js/render/sheet/sheetLeveling.js";

let failures = 0;
const fail = (msg) => { failures++; console.error(`FAIL: ${msg}`); };
const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function flatten(layout) {
  const out = [];
  (function walk(nodes) {
    for (const n of nodes || []) {
      if (n.kind === "field") out.push(n);
      if (n.children) walk(n.children);
    }
  })(layout);
  return out;
}

const starterFields = flatten(createStarterLayout());
const fieldById = new Map(starterFields.map((f) => [f.id, f]));
const dropdownByLabel = new Map(
  starterFields.filter((f) => f.fieldType === "dropdown").map((f) => [norm(f.label), f])
);

// --- 1. Subclass supplement <-> choices, both directions -------------------
{
  const byKey = new Map(SUBCLASS_SUPPLEMENT.map((s) => [s.key, s]));
  const missing = DEFAULT_CONTENT.subclassChoices.filter((c) => !byKey.has(norm(c.text)));
  if (missing.length) fail(`subclass choices without supplement: ${missing.map((c) => c.text).join(", ")}`);
  const choiceKeys = new Set(DEFAULT_CONTENT.subclassChoices.map((c) => norm(c.text)));
  const orphan = SUBCLASS_SUPPLEMENT.filter((s) => !choiceKeys.has(s.key));
  if (orphan.length) fail(`supplement entries with no choice: ${orphan.map((s) => s.name).join(", ")}`);
  const noBundle = [];
  const sub = starterFields.find((f) => f.label === "Subclass");
  for (const c of (sub?.choices || [])) if (!c.bundle) noBundle.push(c.text);
  if (noBundle.length) fail(`starter Subclass choices missing bundles: ${noBundle.join(", ")}`);
  console.log(`subclasses: ${SUBCLASS_SUPPLEMENT.length} supplement entries <-> ${DEFAULT_CONTENT.subclassChoices.length} choices, all wired`);
}

// --- 2. Every statModifier target resolves ---------------------------------
// Numeric/add-style ops must hit a real starter field id. grant-style
// ops hit checkbox proficiencies (<skill>Prof / <abl>SaveProf).
// grantTag ops hit the four taglist ids. addItem ops hit textlist ids
// (spellsKnown is auto-created by ensureSpellListFieldIn, so it is an
// allowed target even though it is absent from the starter layout).
const TAGLIST_IDS = new Set(["armorProf", "weaponProf", "toolProf", "languages"]);
const TEXTLIST_IDS = new Set(
  starterFields.filter((f) => f.fieldType === "textlist").map((f) => f.id).concat(["spellsKnown"])
);
const KNOWN_CHECKBOX_SUFFIXES = ["Prof", "SaveProf"];
function checkMods(mods, where) {
  for (const m of (mods || [])) {
    if (!m || !m.targetFieldId) { fail(`${where}: modifier without targetFieldId`); continue; }
    if (m.op === "grant") {
      if (!KNOWN_CHECKBOX_SUFFIXES.some((s) => m.targetFieldId.endsWith(s))) {
        fail(`${where}: grant to non-checkbox target ${m.targetFieldId}`);
      }
    } else if (m.op === "grantTag") {
      if (!TAGLIST_IDS.has(m.targetFieldId)) fail(`${where}: grantTag to non-taglist target ${m.targetFieldId}`);
      if (!m.value) fail(`${where}: grantTag without value`);
    } else if (m.op === "addItem") {
      if (!TEXTLIST_IDS.has(m.targetFieldId)) fail(`${where}: addItem to non-textlist target ${m.targetFieldId}`);
    } else if (["add", "subtract", "multiply", "set"].includes(m.op)) {
      if (!fieldById.has(m.targetFieldId)) fail(`${where}: ${m.op} to unknown field ${m.targetFieldId}`);
    } else {
      fail(`${where}: unknown op ${m.op}`);
    }
  }
}
function checkBundle(bundle, where) {
  if (!bundle) return;
  checkMods(bundle.statModifiers, where);
  for (const g of (bundle.choiceGroups || [])) {
    // Cross-category groups (Monk tools, Urban Bounty Hunter tools)
    // carry options under categories instead of a flat options list.
    const flatCount = Array.isArray(g.options) ? g.options.length : 0;
    const catCount = Array.isArray(g.categories)
      ? g.categories.reduce((n, c) => n + ((c.options || []).length), 0) : 0;
    // A spell-pick group has neither: its options are the spell catalog,
    // filtered by level when the dialog opens (the High Elf cantrip, the
    // Bard's Magical Secrets). Not having a baked-in list is the whole
    // point of a spell pick, so it is not the empty group this check is
    // looking for. Same distinction creationChoiceGroupsForState makes.
    if (g.spellPick) continue;
    if (!flatCount && !catCount) { fail(`${where}: choice group ${g.id} has no options`); continue; }
    for (const o of (g.options || [])) {
      checkMods(o.statModifiers, `${where} option ${o.name}`);
      for (const fg of (o.featureGrants || [])) {
        if (!fg.name) fail(`${where} option ${o.name}: feature grant without name`);
      }
    }
    for (const cg of (g.categories || [])) {
      for (const o of (cg.options || [])) checkMods(o.statModifiers, `${where} category ${cg.label} option ${o.name}`);
    }
  }
  for (const r of (bundle.dropdownAccess || [])) {
    if (!fieldById.has(r.targetFieldId)) fail(`${where}: dropdownAccess to unknown field ${r.targetFieldId}`);
  }
}
{
  const { FIXED_CLASS_ENTRIES, FIXED_BG_ENTRIES } = await import("../js/data/contentFixups.js");
  for (const e of FIXED_CLASS_ENTRIES) checkBundle(e.bundle, `class ${e.name}`);
  for (const e of [...DEFAULT_CONTENT.raceEntries, ...RACE_EXTRA_ENTRIES]) checkBundle(e.bundle, `race ${e.name}`);
  for (const e of FIXED_BG_ENTRIES) checkBundle(e.bundle, `background ${e.name}`);
  for (const s of SUBCLASS_SUPPLEMENT) checkBundle(s.bundle, `subclass ${s.name}`);
  for (const b of FEAT_BUNDLES) checkBundle(b, `feat ${b.name}`);
  console.log("targets: every statModifier op/target pair resolves");
}

// --- 3. Subclass dropdownAccess ids resolve to real subclass choices -------
{
  const sub = starterFields.find((f) => f.label === "Subclass");
  const ids = new Set((sub?.choices || []).map((c) => c.id));
  let checked = 0;
  for (const e of DEFAULT_CONTENT.classEntries) {
    for (const rule of ((e.bundle || {}).dropdownAccess || [])) {
      if (rule.targetFieldId !== "subclass") continue;
      for (const id of (rule.allowedChoiceIds || [])) {
        checked++;
        if (!ids.has(id)) fail(`class ${e.name}: dropdownAccess references unknown subclass choice ${id}`);
      }
    }
  }
  console.log(`dropdownAccess: ${checked} subclass id references resolve`);
}

// --- 4. Every addItem spell exists in the spell catalog --------------------
{
  const names = new Set();
  for (const t of SPELL_CATALOG.tabs) for (const e of (t.entries || [])) names.add(e.name);
  const check = (mods, where) => {
    for (const m of (mods || [])) {
      if (m?.op === "addItem" && m.targetFieldId === "spellsKnown" && !names.has(m.value)) {
        fail(`${where}: unknown spell ${JSON.stringify(m.value)}`);
      }
    }
  };
  for (const s of SUBCLASS_SUPPLEMENT) {
    check(s.bundle.statModifiers, `subclass ${s.name}`);
    for (const g of (s.bundle.choiceGroups || [])) {
      for (const o of (g.options || [])) check(o.statModifiers, `subclass ${s.name} option ${o.name}`);
    }
  }
  for (const b of FEAT_BUNDLES) check(b.statModifiers, `feat ${b.name}`);
  for (const r of RACE_EXTRA_ENTRIES) check(r.bundle.statModifiers, `race ${r.name}`);
  console.log("spells: every granted spell name exists in SPELL_CATALOG");
}

// --- 5. store strip/hydrate covers subclass + extra races ------------------
// characterStore.js imports Firebase CDN modules, which Node cannot
// load — so this is a source check, not an import check.
{
  // Bundle maps live in js/state/bundleMaps.js (patched tables from
  // js/data/contentFixups.js), shared by both backends.
  const src = readFileSync(new URL("../js/state/bundleMaps.js", import.meta.url), "utf8");
  if (!src.includes("FIXED_CLASS_ENTRIES")) fail("bundleMaps: class map not on patched entries");
  if (!src.includes("FIXED_RACE_ENTRIES")) fail("bundleMaps: race map not on patched entries (extra races would bloat saves)");
  if (!src.includes("SUBCLASS_BUNDLE_MAP")) fail("bundleMaps: no subclass bundle map (saves would bloat / loads would drop subclass mechanics)");
  const storeSrc = readFileSync(new URL("../js/state/characterStore.js", import.meta.url), "utf8");
  if (!storeSrc.includes("./bundleMaps.js")) fail("characterStore: not using shared bundleMaps");
  const localSrc = readFileSync(new URL("../js/state/localStore.js", import.meta.url), "utf8");
  if (!localSrc.includes("./bundleMaps.js")) fail("localStore: not using shared bundleMaps");
  const bm = readFileSync(new URL("../js/data/blockModel.js", import.meta.url), "utf8");
  if (!bm.includes("FIXED_CLASS_ENTRIES") || !bm.includes("FIXED_RACE_ENTRIES") || !bm.includes("SUBCLASS_BUNDLE_MAP")) {
    fail("blockModel: patched tables not wired into starter choices");
  }
  const cs = readFileSync(new URL("../js/render/customSheet.js", import.meta.url), "utf8");
  for (const token of ["SPELL_CATALOG", "WEAPONS_ARMOR_CATALOG", "GEAR_CATALOG", "syncGrantedListItems", "RACE_EXTRA_CATALOG_ENTRIES"]) {
    if (!cs.includes(token)) fail(`customSheet: missing ${token}`);
  }
  console.log("wiring: store + starter + catalog cache references present");
}

// --- 5b. Save/load strip+hydrate round-trip (both backends share it) ------
{
  const layout = createStarterLayout();
  const fields = flatten(layout);
  const pick = (label, text) => {
    const f = fields.find((x) => x.label === label);
    const c = (f?.choices || []).find((x) => norm(x.text) === norm(text));
    if (c) f.selected = c.id;
  };
  pick("Class", "Fighter");
  pick("Race", "Half-Orc");
  pick("Background", "Sailor");
  pick("Subclass", "Champion");
  const before = JSON.stringify(layout).length;
  const stripped = stripBundlesFromPatch({ layout });
  const after = JSON.stringify(stripped).length;
  if (!(after < before * 0.5)) fail(`strip barely shrank the save (${before} -> ${after})`);
  const subField = flatten(stripped.layout).find((x) => x.label === "Subclass");
  const champ = (subField?.choices || []).find((x) => x.text === "Champion");
  if (!champ || champ.bundle !== null) fail("strip: Champion bundle not nulled");
  if (!champ || !champ.id) fail("strip: Champion selection lost");
  const hydrated = hydrateCharacter(JSON.parse(JSON.stringify(stripped)));
  const champHyd = flatten(hydrated.layout).find((x) => x.label === "Subclass")
    ?.choices?.find((x) => x.text === "Champion");
  // Champion's placeholder "Additional Fighting Style" grant is
  // replaced by a real picker (contentFixups): 4 grants + the group.
  if (!champHyd?.bundle || !(champHyd.bundle.choiceGroups || []).some((g) => g.id === "champion-fighting-style")) {
    fail("hydrate: Champion bundle (with fighting-style picker) not restored");
  }
  console.log(`strip/hydrate: save ${before} -> ${after} chars, subclass mechanics survive`);
}

// --- 6. Creation-to-20 simulation ------------------------------------------
function freshFields() {
  return flatten(createStarterLayout());
}
function selectByText(fields, label, text) {
  const field = fields.find((f) => f.fieldType === "dropdown" && norm(f.label) === norm(label));
  if (!field) throw new Error(`no ${label} dropdown`);
  const choice = (field.choices || []).find((c) => norm(c.text) === norm(text));
  if (!choice) throw new Error(`no ${label} choice ${text}`);
  field.selected = choice.id;
  return field;
}
function autoPicks(groups) {
  // Mimic a player: take the first minSelections options of each group.
  const store = {};
  for (const g of groups) {
    const n = Math.max(0, Math.min(g.maxSelections ?? 99, g.minSelections ?? 1));
    store[g.key] = (g.options || []).slice(0, n).map((o) => o.id);
  }
  return store;
}
// dnd5e is DOM-free (imports defaultContent only) — safe to import here.
import { getLevelUpPlan } from "../js/data/dnd5e.js";

function applyLevel(fields, level, choicesStore, feats) {
  const groups = activeChoiceGroupsFor(fields, level);
  Object.assign(choicesStore, autoPicks(groups));
  // Taken feats carry their own bundles, so their choice groups
  // (Resilient's ability pick, …) offer picks the same way.
  const featBundles = (feats || []).map((f) => ({ name: f.name, bundle: f.bundle }));
  Object.assign(choicesStore, autoPicks(featChoiceGroupsFor(featBundles)));
  const ruleOptions = selectedRuleOptionsIn(groups, choicesStore);
  const vm = {};
  const cb = new Set();
  const tags = new Map();
  const dropdownMods = [];
  for (const f of fields) {
    if (f.fieldType !== "dropdown") continue;
    const c = (f.choices || []).find((x) => x.id === f.selected);
    if (c?.bundle?.statModifiers) dropdownMods.push(...c.bundle.statModifiers);
  }
  for (const { option } of ruleOptions) applyStatModifiers(option.statModifiers, vm, cb, tags, level);
  applyStatModifiers(dropdownMods, vm, cb, tags, level);
  for (const { bundle } of featBundles) applyStatModifiers(bundle?.statModifiers, vm, cb, tags, level);
  const features = collectGrantedFeaturesIn(fields, level, ruleOptions, featBundles);
  const items = collectListItemGrantsIn(fields, level, ruleOptions, featBundles);
  return { ruleOptions, vm, cb, tags, features, items };
}

const FEAT_BUNDLE_BY_NAME = new Map(FEAT_BUNDLES.map((b) => [norm(b.name), b]));
function featListWith(namesAndLevels) {
  return namesAndLevels.map(({ name, level }) => {
    const bundle = FEAT_BUNDLE_BY_NAME.get(norm(name));
    if (!bundle) fail(`verify setup: unknown feat ${name}`);
    return { name, level, bundle };
  });
}

{
  // Full builds: martial + feat + resource, domain caster, oath paladin.
  const builds = [
    { race: "Half-Orc", className: "Fighter", subclass: "Champion", bg: "Sailor", featName: "Resilient" },
    { race: "Elf", className: "Cleric", subclass: "Light Domain", bg: "Acolyte", featName: "Resilient" },
    { race: "Human", className: "Paladin", subclass: "Oath of Devotion", bg: "Noble", featName: "Resilient" },
  ];
  for (const b of builds) {
    const { vm, features, items } = (() => {
      const fields = freshFields();
      selectByText(fields, "Class", b.className);
      selectByText(fields, "Race", b.race);
      selectByText(fields, "Background", b.bg);
      const plan = getLevelUpPlan("dnd5e-2014", b.className, 20);
      const sl = plan?.subclassLevel || 3;
      const choicesStore = {};
      const feats = [];
      let out = null;
      let prevFeatureCount = 0;
      for (let level = 1; level <= 20; level++) {
        if (level === sl) selectByText(fields, "Subclass", b.subclass);
        if (level === 4) feats.push(...featListWith([{ name: b.featName, level }]));
        out = applyLevel(fields, level, choicesStore, feats);
        if (out.features.length < prevFeatureCount) fail(`${b.className}: features shrank at level ${level}`);
        prevFeatureCount = out.features.length;
      }
      return out;
    })();
    // Resilient (STR, first option auto-picked... verify whatever the
    // auto-pick chose actually applied: some +1 score must be present.
    const scoreGain = ["strScore", "dexScore", "conScore", "intScore", "wisScore", "chaScore"]
      .some((k) => (vm[k] || 0) >= 1);
    if (!scoreGain) fail(`${b.className}: feat ASI never applied`);
    console.log(`${b.race} ${b.className} (${b.subclass}) 1-20: ${features.length} features, ${items.flatMap((g) => g.items).length} granted spells/items`);
  }

  // Deterministic spell assertions.
  const clericFields = freshFields();
  selectByText(clericFields, "Class", "Cleric");
  selectByText(clericFields, "Race", "Elf");
  selectByText(clericFields, "Background", "Acolyte");
  selectByText(clericFields, "Subclass", "Light Domain");
  const l1 = applyLevel(clericFields, 1, {}, []);
  if (!l1.items.flatMap((g) => g.items).includes("Burning Hands")) fail("Light Domain: Burning Hands not granted at level 1");
  // Warding Flare used to be unsourced (no mechanics in the Foundry
  // export) and so was omitted from the Features list entirely. It is
  // sourced now, from the fetched page text, so it must appear at level 1
  // carrying its description and the URL it came from. What must NOT
  // change is the level gate: it is a 1st-level domain feature, and being
  // sourced is not a reason for it to show up earlier.
  if (!l1.features.some((f) => f.name === "Warding Flare")) fail("Light Domain: sourced Warding Flare missing from display at level 1");
  {
    const { SUBCLASS_BUNDLE_MAP, normSubclassKey } = await import("../js/data/contentFixups.js");
    const light = SUBCLASS_BUNDLE_MAP.get(normSubclassKey("Light Domain"));
    const flare = (light?.featureGrants || []).find((g) => g.name === "Warding Flare");
    if (!flare || flare.minLevel !== 1) fail("Light Domain: Warding Flare grant not level-gated in data");
    if (flare.unsourced) fail("Light Domain: Warding Flare still flagged unsourced despite fetched text");
    if (!(flare.description || "").trim()) fail("Light Domain: Warding Flare has no description after sourcing");
    if (!/dnd5e\.wikidot\.com\/cleric:light/.test(flare.sourceUrl || "")) fail("Light Domain: Warding Flare is missing its source URL");
  }

  const palFields = freshFields();
  selectByText(palFields, "Class", "Paladin");
  selectByText(palFields, "Race", "Human");
  selectByText(palFields, "Background", "Noble");
  const p2 = applyLevel(palFields, 2, {}, []);
  if (p2.items.length) fail("Paladin: spells granted before oath at level 3");
  selectByText(palFields, "Subclass", "Oath of Devotion");
  const p3 = applyLevel(palFields, 3, {}, []);
  if (!p3.items.flatMap((g) => g.items).includes("Sanctuary")) fail("Devotion: Sanctuary not granted at level 3");
  // Sacred Weapon is a 3rd-level Channel Divinity option. It used to be
  // unsourced, so it was omitted from display entirely; the fetched page
  // text supplies it now, so it must appear at level 3 with its text and
  // source URL. The level gate is the part that must not change - and the
  // multiclass check further down proves it does not leak into a level-2
  // sheet now that it is visible.
  if (!p3.features.some((f) => f.name === "Sacred Weapon")) fail("Devotion: sourced Sacred Weapon missing from display at level 3");
  {
    const { SUBCLASS_BUNDLE_MAP, normSubclassKey } = await import("../js/data/contentFixups.js");
    const devotion = SUBCLASS_BUNDLE_MAP.get(normSubclassKey("Oath of Devotion"));
    const sacred = (devotion?.featureGrants || []).find((g) => g.name === "Sacred Weapon");
    if (!sacred || sacred.minLevel !== 3) fail("Devotion: Sacred Weapon grant not level-gated in data");
    if (sacred.unsourced) fail("Devotion: Sacred Weapon still flagged unsourced despite fetched text");
    if (!(sacred.description || "").trim()) fail("Devotion: Sacred Weapon has no description after sourcing");
    if (!/dnd5e\.wikidot\.com\/paladin:devotion/.test(sacred.sourceUrl || "")) fail("Devotion: Sacred Weapon is missing its source URL");
  }

  // Light sweep: every class selects + subclass narrows + L1/L20 apply.
  for (const e of DEFAULT_CONTENT.classEntries) {
    const fields = freshFields();
    selectByText(fields, "Class", e.name);
    const plan = getLevelUpPlan("dnd5e-2014", e.name, 20);
    if (!plan) { fail(`${e.name}: no level-up plan (bad ruleset id?)`); continue; }
    const sl = plan.subclassLevel || 3;
    const sub = fields.find((f) => f.label === "Subclass");
    const { allowed } = narrowChoicesByBundleAccess(sub, fields, sl);
    const first = (sub.choices || []).find((c) => allowed.has(c.id));
    if (!first) { fail(`${e.name}: no subclass allowed at level ${sl}`); continue; }
    sub.selected = first.id;
    applyLevel(fields, 1, {}, []);
    const end = applyLevel(fields, 20, {}, []);
    if (!end.features.length) fail(`${e.name}: no features at level 20`);
  }
  console.log("simulation: 3 full builds + deterministic spell checks + 12-class sweep clean");

  // Races: every starter race applies its ability mods at level 1.
  const raceField = freshFields().find((f) => f.label === "Race");
  let raceCount = 0;
  for (const c of (raceField?.choices || [])) {
    const fields = freshFields();
    selectByText(fields, "Race", c.text);
    const { vm } = applyLevel(fields, 1, {}, []);
    raceCount++;
    void vm;
  }
  console.log(`simulation: ${raceCount} races apply cleanly at level 1`);
}

// --- 6b. Hand-written fixups (contentFixups.js) ------------------------------
{
  const { FIXED_CLASS_ENTRIES, FIXED_RACE_ENTRIES, SUBCLASS_BUNDLE_MAP } = await import("../js/data/contentFixups.js");
  const group = (bundle, id) => (bundle?.choiceGroups || []).find((g) => g.id === id);
  const cls = (n) => FIXED_CLASS_ENTRIES.find((e) => e.name === n)?.bundle;
  const race = (n) => FIXED_RACE_ENTRIES.find((e) => e.name === n)?.bundle;

  // Fighting styles replaced the FEATURE_SELECT stubs (11/7/7 options with TCE).
  const fs = (n, count) => {
    const g = group(cls(n), `${n.toLowerCase()}-fighting-style`);
    if (!g || g.options.length !== count) fail(`${n}: fighting-style picker missing (want ${count} options)`);
    if ((cls(n)?.featureGrants || []).some((f) => /not a pickable list here yet/.test(f.description || "") && /Fighting Style/.test(f.name || ""))) {
      fail(`${n}: stale Fighting Style stub note still present`);
    }
  };
  fs("Fighter", 11); fs("Paladin", 7); fs("Ranger", 7);

  // Expertise replaced the SKILL_EXPERTISE stubs (Rogue L1/L6, Bard L3/L10).
  for (const [n, ids] of [["Rogue", ["rogue-expertise-0", "rogue-expertise-1"]], ["Bard", ["bard-expertise-0", "bard-expertise-1"]]]) {
    for (const id of ids) {
      const g = group(cls(n), id);
      if (!g || g.minSelections !== 2 || g.maxSelections !== 2) fail(`${n}: ${id} expertise picker missing`);
    }
    if ((cls(n)?.featureGrants || []).some((f) => /SKILL_EXPERTISE/.test(f.description || ""))) {
      fail(`${n}: stale Expertise stub note still present`);
    }
  }

  // Sorcerer Metamagic: L3 pick-2, L10/L17 pick-1, 10 options each (8 PHB + 2 TCE).
  const mm = ["sorcerer-metamagic-0", "sorcerer-metamagic-1", "sorcerer-metamagic-2"]
    .map((id) => group(cls("Sorcerer"), id));
  if (mm.some((g) => !g) || mm[0].options.length !== 10 || mm[0].minSelections !== 2) {
    fail("Sorcerer: metamagic pickers missing/misshapen");
  }
  if ((cls("Sorcerer")?.featureGrants || []).some((f) => /FEATURE_SELECT/.test(f.description || "") && /Metamagic/.test(f.name || ""))) {
    fail("Sorcerer: stale Metamagic stub note still present");
  }

  // Warlock: invocation tiers + pact boon; Mystic Arcanum stays a note.
  const invo = (cls("Warlock")?.choiceGroups || []).filter((g) => g.id.startsWith("warlock-invocations-"));
  if (invo.length !== 7 || !invo.every((g) => g.options.length >= 20)) fail("Warlock: invocation tier pickers missing");
  const pact = group(cls("Warlock"), "warlock-pact-boon");
  if (!pact || pact.options.length !== 4) fail("Warlock: pact boon picker missing");
  if (!(cls("Warlock")?.featureGrants || []).some((f) => /Mystic Arcanum/.test(f.name || ""))) {
    fail("Warlock: Mystic Arcanum notes should remain (free spell choice)");
  }

  // Hunter's Prey + Champion style on the subclass side.
  const hunter = SUBCLASS_BUNDLE_MAP.get("hunterconclave");
  const prey = (hunter?.choiceGroups || []).find((g) => g.id === "hunter-conclave-prey");
  if (!prey || prey.options.length !== 3 || prey.minLevel !== 3) fail("Hunter Conclave: Hunter's Prey picker missing");
  const champ = SUBCLASS_BUNDLE_MAP.get("champion");
  if (!(champ?.choiceGroups || []).some((g) => g.id === "champion-fighting-style")) fail("Champion: fighting-style picker missing");

  // Free-form racial ASIs: flexible ability bonus picker (Phase 3b)
  // replaces the old 3-slot approach. The new picker has type "flexibleAbilityBonus"
  // with two pattern options ("2-1" and "1-1-1").
  for (const n of ["Aarakocra", "Aasimar", "Yuan-ti", "Genasi"]) {
    const group = (race(n)?.choiceGroups || []).find((g) => g.type === "flexibleAbilityBonus");
    if (!group) fail(`${n}: flexibleAbilityBonus group missing`);
    if (group.minSelections !== 1 || group.maxSelections !== 1) fail(`${n}: flexibleAbilityBonus not single-pick`);
    const opts = group.options || [];
    if (opts.length !== 2) fail(`${n}: flexibleAbilityBonus wants 2 pattern options`);
    const patterns = opts.map((o) => o.pattern).sort();
    if (patterns[0] !== "1-1-1" || patterns[1] !== "2-1") fail(`${n}: flexibleAbilityBonus patterns incorrect`);
    if ((race(n)?.featureGrants || []).some((f) => /plus_2_plus_1_or_three_plus_1s/.test(f.description || ""))) {
      fail(`${n}: stale ASI stub note still present`);
    }
  }

  // Elf subraces: High/Wood/Drow with real mods.
  const elfSub = (race("Elf")?.choiceGroups || []).find((g) => g.id === "elf-subrace");
  if (!elfSub || elfSub.options.length !== 3) fail("Elf: subrace picker missing");
  const drow = (elfSub?.options || []).find((o) => o.name === "Drow");
  if (!drow || !drow.statModifiers.some((m) => m.op === "addItem" && m.value === "Dancing Lights")) {
    fail("Elf: Drow option missing its spells");
  }

  // Feat spell pickers (compiled): Magic Initiate class + cantrips + L1.
  const mi = FEAT_BUNDLES.find((b) => b.name === "Magic Initiate");
  const miGroups = (mi?.choiceGroups || []).map((g) => g.id);
  for (const id of ["magic-initiate-class", "magic-initiate-cantrips", "magic-initiate-spell"]) {
    if (!miGroups.includes(id)) fail(`Magic Initiate: group ${id} missing`);
  }
  const cantrips = (mi?.choiceGroups || []).find((g) => g.id === "magic-initiate-cantrips");
  if (cantrips && (cantrips.minSelections !== 2 || cantrips.options.length < 40)) {
    fail(`Magic Initiate: cantrip picker misshapen (${cantrips.options.length} options)`);
  }
  console.log("fixups: fighting styles, expertise, metamagic, invocations, prey, racial ASIs, subraces, feat spell picks all present; stubs replaced");
}

// --- 6c. Starter sheet shape -------------------------------------------------
{
  const layout = createStarterLayout();
  const fields = flatten(layout);
  const byLabel = (label) => fields.find((f) => f.label === label);
  // Alphabetical dropdowns.
  for (const label of ["Race", "Class", "Background"]) {
    const names = ((byLabel(label)?.choices) || []).map((c) => c.text);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    if (JSON.stringify(names) !== JSON.stringify(sorted)) fail(`starter ${label} dropdown is not alphabetical`);
  }
  // Subclass sits beside Class in the same block (Identity).
  const blockOf = (label) => layout.find((b) => (b.children || []).some((f) => f.label === label));
  if (!blockOf("Class") || blockOf("Class") !== blockOf("Subclass")) {
    fail("Subclass field is not in the same block as Class");
  }
  const cls = blockOf("Class").children.find((f) => f.label === "Class");
  const sub = blockOf("Class").children.find((f) => f.label === "Subclass");
  if (!cls || !sub || cls.y !== sub.y) fail("Subclass is not beside Class (same row)");
  // Even column bottoms: every top-level column ends on the same row.
  const bottoms = new Map();
  for (const b of layout) {
    const key = `${b.x}/${b.w}`;
    bottoms.set(key, Math.max(bottoms.get(key) ?? 0, b.y + b.h));
  }
  const ends = [...bottoms.values()];
  if (new Set(ends).size !== 1) fail(`jagged sheet columns (bottoms: ${[...bottoms.entries()].map(([k, v]) => `${k}→${v}`).join(", ")})`);
  // Vehicle proficiency field exists for the Equipment Proficiencies tab.
  if (!byLabel("Vehicle Prof.")) fail("starter sheet has no Vehicle Prof. field");
  // Appearance and Backstory: the two blanks the sheet used to have nowhere
  // to put. Plain textareas on purpose - neither has sourced vocabulary in
  // this data, so a dropdown would only offer what the data happens to hold.
  for (const label of ["Appearance", "Backstory"]) {
    const f = byLabel(label);
    if (!f) fail(`starter sheet has no ${label} field`);
    else if (f.fieldType !== "textarea") fail(`${label} should be a free-text box, not a ${f.fieldType}`);
  }
  // Both belong with the rest of the character's story, not in their own block.
  const story = layout.find((b) => (b.children || []).some((f) => f.label === "Appearance"));
  if (!story || story !== blockOf("Personality Traits")) {
    fail("Appearance is not in the same block as Personality Traits");
  }
  if (story && !story.children.some((f) => f.label === "Backstory")) {
    fail("Backstory is not in the Appearance block");
  }
  // The Story block grew from 7 rows to 11 to make room for two more
  // textareas, and a child's box has to actually fit inside its block or the
  // sheet prints overlapping text.
  //
  // Only the overflow direction is checked. A full overlap check flags the
  // Spellcasting slot trackers, and correctly so: a radio's width comes from
  // syncOptionWidth (its option count), not from the w it was handed, so
  // "2nd" with three options is two cells wide and starts on top of "1st"'s
  // second cell by design. That arrangement is deliberate and predates
  // anything here.
  for (const b of layout) {
    for (const f of b.children || []) {
      if ((f.y || 0) + (f.h || 1) > (b.h || 0)) fail(`${b.name}: ${f.label} overflows the block (y${f.y}+h${f.h} > h${b.h})`);
    }
  }
  console.log(`sheet: dropdowns alphabetical, subclass beside class, columns even (${ends[0]}), vehicle field present, Appearance + Backstory on Story`);
}

// --- 6d. Starting equipment data ---------------------------------------------
{
  const { CLASS_STARTING_EQUIPMENT, BG_STARTING_EQUIPMENT, resolveStartingEquipmentPick } = await import("../js/data/startingEquipment.js");
  const classes = DEFAULT_CONTENT.classEntries.map((e) => e.name);
  const missing = classes.filter((c) => !CLASS_STARTING_EQUIPMENT[c]);
  if (missing.length) fail(`classes without starting packages: ${missing.join(", ")}`);
  for (const [name, entry] of Object.entries(CLASS_STARTING_EQUIPMENT)) {
    if (!Number.isFinite(entry.gold?.gp) || entry.gold.gp <= 0) fail(`${name}: no gold fallback`);
    if (!Array.isArray(entry.decisions) || !entry.decisions.length) fail(`${name}: no equipment decisions`);
    for (const d of (entry.decisions || [])) {
      if (!d.id || !d.label || !Array.isArray(d.options) || d.options.length < 2) fail(`${name}: misshapen decision ${d.id}`);
      for (const opt of (d.options || [])) {
        if (!opt.id || !opt.label || !(opt.items || []).length) fail(`${name}: malformed decision option`);
      }
    }
  }
  // Spot-check resolution: decisions combine, gold bypasses, legacy still resolves.
  const probe = resolveStartingEquipmentPick("Fighter", "Sailor", { picks: { armor: "chain-mail", weapon: "sword-board", ranged: "light-crossbow", pack: "dungeoneers-pack" } });
  if (!probe.items.includes("Chain mail") || !probe.items.includes("Shield")) fail("Fighter decisions do not resolve");
  const legacyProbe = resolveStartingEquipmentPick("Fighter", "Sailor", "fighter-a");
  if (!legacyProbe.items.includes("Longsword")) fail("legacy equipment pick stopped resolving");
  const bgs = DEFAULT_CONTENT.bgEntries.map((e) => e.name);
  const missingBg = bgs.filter((b) => !BG_STARTING_EQUIPMENT[b]);
  if (missingBg.length) fail(`backgrounds without starting packages: ${missingBg.join(", ")}`);
  const { flavorFor } = await import("../js/data/pickerFlavor.js");
  const { FIXED_RACE_ENTRIES } = await import("../js/data/contentFixups.js");
  const unflavored = [...classes, ...FIXED_RACE_ENTRIES.map((e) => e.name), ...bgs].filter((n) => !flavorFor(n));
  if (unflavored.length) fail(`missing flavor blurbs: ${unflavored.join(", ")}`);
  console.log(`equipment: ${Object.keys(CLASS_STARTING_EQUIPMENT).length} class decision packages + gold, 9 background packages, flavor blurbs complete`);
}

// --- 6e. Meta tags -----------------------------------------------------------
{
  const { TAG_VOCABULARY, SPELL_CATALOG, WEAPONS_ARMOR_CATALOG, GEAR_CATALOG } = await import("../js/data/contentCatalogs.js");
  const vocab = new Set(TAG_VOCABULARY);
  if (!Array.isArray(TAG_VOCABULARY) || !vocab.size) fail("TAG_VOCABULARY missing/empty");
  let thin = 0, stray = 0;
  const check = (entries) => {
    for (const e of entries) {
      const tags = (e.fieldValues || {}).tags || [];
      if (!tags.length) { thin++; continue; }
      for (const t of tags) if (!vocab.has(t)) stray++;
    }
  };
  for (const t of SPELL_CATALOG.tabs) check(t.entries);
  for (const t of [...WEAPONS_ARMOR_CATALOG.tabs, ...GEAR_CATALOG.tabs]) check(t.entries);
  if (thin) fail(`${thin} catalog entries without tags`);
  if (stray) fail(`${stray} tags outside TAG_VOCABULARY`);
  const need = ["damage", "heal", "protect", "buff", "social", "concentration", "rare", "magical", "attunement", "mount", "evocation"];
  for (const t of need) if (!vocab.has(t)) fail(`vocabulary missing expected tag: ${t}`);
  console.log(`tags: vocabulary ${vocab.size}, every entry tagged, no strays`);
}

// --- 6g. Multiclass simulation ------------------------------------------------
// Fighter 4 / Paladin 2 (Devotion): per-class gating must hold Paladin
// L3+ content back while keeping Fighter L4+ content, Paladin saves
// must NOT leak in (stripped), and Lay on Hands (Pal 1) must apply.
{
  const { FIXED_CLASS_ENTRIES } = await import("../js/data/contentFixups.js");
  const { stripSecondaryClassBundle } = await import("../js/data/contentFixups.js");
  const { SUBCLASS_SUPPLEMENT } = await import("../js/data/subclassContent.js");
  const { multiclassSlotsFor } = await import("../js/data/dnd5e.js");
  const fields = freshFields();
  selectByText(fields, "Class", "Fighter");
  selectByText(fields, "Race", "Human");
  selectByText(fields, "Background", "Sailor");
  selectByText(fields, "Subclass", "Champion");
  const paladinBundle = stripSecondaryClassBundle(
    FIXED_CLASS_ENTRIES.find((e) => e.name === "Paladin")?.bundle
  );
  const devotion = SUBCLASS_SUPPLEMENT.find((s) => s.name === "Oath of Devotion");
  const extra = [
    { bundle: paladinBundle, level: 2, source: "Paladin" },
    { bundle: devotion.bundle, level: 2, source: "Oath of Devotion" },
  ];
  // Primary Fighter 4 of total 6; Paladin secondary at 2.
  const levelFor = (field, choice) => {
    const label = (field?.label || "").toLowerCase();
    if (label === "class") return choice?.text === "Fighter" ? 4 : null;
    if (label === "subclass" || field?.id === "subclass") {
      return choice?.text === "Champion" ? 4 : null;
    }
    return null;
  };
  const vm = {};
  const cb = new Set();
  const tags = new Map();
  applyStatModifiersForTest(fields, vm, cb, tags, levelFor, extra);
  const granted = [...cb];
  for (const want of ["strSaveProf::0", "conSaveProf::0"]) {
    if (!granted.includes(want)) fail(`multiclass: missing primary save ${want}`);
  }
  for (const banned of ["wisSaveProf::0", "chaSaveProf::0"]) {
    if (granted.includes(banned)) fail(`multiclass: secondary save leaked in (${banned})`);
  }
  const features = collectGrantedFeaturesIn(fields, 6, [], [], levelFor, extra);
  const names = features.map((f) => f.name);
  for (const want of ["Action Surge", "Lay on Hands", "Divine Sense"]) {
    if (!names.includes(want)) fail(`multiclass: missing ${want}`);
  }
  // Improved Critical was unsourced (audit 2b) and so omitted from
  // display. It is sourced now, from the fetched page text. The level
  // gate is the part worth protecting: a 3rd-level Champion feature must
  // stay out of a level-2 multiclass sheet, and the sheet here is built
  // at total level 2 for some classes.
  {
    const grant = (SUBCLASS_SUPPLEMENT.find((s) => s.name === "Champion")?.bundle?.featureGrants || []).find((g) => g.name === "Improved Critical");
    if (!grant || grant.minLevel !== 3) fail("multiclass: Improved Critical grant not level-gated in data");
    if (grant.unsourced) fail("multiclass: Improved Critical still flagged unsourced despite fetched text");
    if (!(grant.description || "").trim()) fail("multiclass: Improved Critical has no description after sourcing");
    if (!/dnd5e\.wikidot\.com\/fighter:champion/.test(grant.sourceUrl || "")) fail("multiclass: Improved Critical is missing its source URL");
  }
  // Per-class gating proofs (total level is 6 — a total-level gate
  // would wrongly include all of these):
  for (const banned of ["Extra Attack", "Sacred Weapon", "Aura of Protection", "Indomitable"]) {
    if (names.includes(banned)) fail(`multiclass: level-gated feature leaked in (${banned})`);
  }
  // Combined slots: Paladin 2 alone on the caster table = L1 row.
  const slots = multiclassSlotsFor([
    { caster: null, levels: 4 },
    { caster: "half", levels: 2 },
  ]);
  const s1 = slots.find((s) => s.fieldId === "slots1");
  if (!s1 || s1.options !== 2) fail(`multiclass: expected 2 L1 slots, got ${JSON.stringify(slots)}`);
  console.log(`multiclass: Fighter 4/Paladin 2 gates, strips, slots, and features all correct (${names.length} features)`);
}

function applyStatModifiersForTest(fields, vm, cb, tags, levelFor, extra) {
  return applyBundleModifiersIn(fields, vm, cb, tags, 6, [], [], applyStatModifiers, levelFor, extra);
}

// --- 6h. Phase 3 gaps: multiclass caster caps, elf subraces, Bard secrets --
{
  const { spellLimitFor } = await import("../js/data/rulesEngine.js");
  const {
    spellsForLevelIn, spellPicksCompleteForClass, availableSpellLevels,
    magicalSecretsUnlocked, secretsPickedCount, secretsCompleteFor,
  } = await import("../js/render/sheet/sheetWizard.js");
  const { FIXED_RACE_ENTRIES } = await import("../js/data/contentFixups.js");

  // (a) Multiclass caster caps: a Cleric 1 / Wizard 1 shares one Spells
  // Known list, but the Wizard-1 cap counts Wizard-listed spells only.
  {
    const wizCantrips = spellsForLevelIn(SPELL_CATALOG, 0, "Wizard").map((s) => s.name);
    const wizL1 = spellsForLevelIn(SPELL_CATALOG, 1, "Wizard").map((s) => s.name);
    const clrCantrips = spellsForLevelIn(SPELL_CATALOG, 0, "Cleric").map((s) => s.name);
    const clrL1 = spellsForLevelIn(SPELL_CATALOG, 1, "Cleric").map((s) => s.name);
    const wizOnly = (names) => names.filter((n) => ![...clrCantrips, ...clrL1].includes(n));
    const wizCantripsOnly = wizOnly(wizCantrips);
    const wizL1Only = wizOnly(wizL1);
    if (!wizCantripsOnly.length || !wizL1Only.length) fail("multiclass caps: no Wizard-only spells to test against");
    const limit = spellLimitFor("Wizard", 1, { int: 16 });
    if (!limit) fail("multiclass caps: no Wizard spell limit");
    const plan = getLevelUpPlan("dnd5e-2014", "Wizard", 1);
    const levels = availableSpellLevels(plan);
    const check = (known) => spellPicksCompleteForClass({
      knownItems: known, className: "Wizard", limit, availableLevels: levels,
      spellsForLevelFn: (lvl, name) => spellsForLevelIn(SPELL_CATALOG, lvl, name),
      levelByNameFn: (n) => {
        for (const tab of SPELL_CATALOG.tabs) {
          if ((tab.entries || []).some((e) => e.name === n)) return tab.id === "cantrips" ? 0 : 1;
        }
        return null;
      },
    });
    const clericKnown = [...clrCantrips.slice(0, 3), ...clrL1.slice(0, 4)];
    if (check(clericKnown)) fail("multiclass caps: Cleric spells satisfy the Wizard cap");
    const wizardKnown = [...wizCantripsOnly.slice(0, limit.cantrips), ...wizL1Only.slice(0, limit.spells)];
    if (!check(wizardKnown)) fail("multiclass caps: Wizard-listed picks to the caps do not complete");
    if (!check([...clericKnown, ...wizardKnown])) fail("multiclass caps: Cleric flood blocks Wizard completion");
    console.log(`multiclass caps: Cleric spells neither satisfy nor block Wizard 1 (limit ${limit.cantrips} cantrips / ${limit.spells} spells)`);
  }

  // (b) Elf subraces: all three options apply cleanly at level 1.
  {
    const elf = FIXED_RACE_ENTRIES.find((e) => e.name === "Elf")?.bundle;
    const sub = (elf?.choiceGroups || []).find((g) => g.id === "elf-subrace");
    if (!sub || sub.options.length !== 3) {
      fail("elf subraces: picker missing");
    } else {
      for (const option of sub.options) {
        const vm = {};
        try {
          applyStatModifiers(option.statModifiers, vm, new Set(), new Map(), 1);
        } catch (err) {
          fail(`elf subrace ${option.name}: modifiers throw (${err?.message || err})`);
        }
        const grants = [...(option.statModifiers || []), ...((option.featureGrants || []).map((f) => ({ name: f.name })))];
        if (!grants.length) fail(`elf subrace ${option.name}: grants nothing`);
      }
      console.log(`elf subraces: ${sub.options.map((o) => o.name).join("/")} all apply at level 1`);
    }
  }

  // (c) Bard Magical Secrets: unlock ladder + a full 1-20 Lore Bard build.
  {
    const ladder = [
      ["Bard", "", 1, 0], ["Bard", "", 9, 0], ["Bard", "", 10, 2],
      ["Bard", "College of Valor", 6, 0],       ["Bard", "College of Lore", 6, 2], ["Bard", "", 14, 4],
      ["Bard", "College of Lore", 14, 6], ["Bard", "", 18, 6],
      ["Wizard", "", 20, 0],
    ];
    for (const [cls, sub, lvl, want] of ladder) {
      const got = magicalSecretsUnlocked(cls, sub, lvl);
      if (got !== want) fail(`secrets unlock: ${cls}/${sub || "-"} ${lvl} → ${got}, want ${want}`);
    }
    // Stubs are gone from the patched Bard bundle (the picker replaces them).
    const { FIXED_CLASS_ENTRIES } = await import("../js/data/contentFixups.js");
    const bard = FIXED_CLASS_ENTRIES.find((e) => e.name === "Bard")?.bundle;
    if ((bard?.featureGrants || []).some((f) => /Magical Secrets/.test(f.name || ""))) {
      fail("secrets: stale Magical Secrets stub note still on the Bard bundle");
    }
    // Lore Bard 1-20: unlock totals at 6/10/14/18, completable with
    // two non-Bard picks per unlock.
    const fields = freshFields();
    selectByText(fields, "Class", "Bard");
    selectByText(fields, "Race", "Half-Elf");
    selectByText(fields, "Background", "Entertainer");
    const plan = getLevelUpPlan("dnd5e-2014", "Bard", 20);
    const sl = plan?.subclassLevel || 3;
    const choicesStore = {};
    const bardLevels = availableSpellLevels(getLevelUpPlan("dnd5e-2014", "Bard", 20));
    const bardNames = new Set();
    for (const lvl of bardLevels) {
      for (const s of spellsForLevelIn(SPELL_CATALOG, lvl, "Bard")) bardNames.add(s.name);
    }
    const nonBardL1 = spellsForLevelIn(SPELL_CATALOG, 1, null)
      .map((s) => s.name).filter((n) => !bardNames.has(n));
    const known = [];
    let prevUnlocked = 0;
    for (let level = 1; level <= 20; level++) {
      if (level === sl) selectByText(fields, "Subclass", "College of Lore");
      const unlocked = magicalSecretsUnlocked("Bard", level >= sl ? "College of Lore" : "", level);
      if (unlocked < prevUnlocked) fail(`secrets: unlock total shrank at Bard ${level}`);
      prevUnlocked = unlocked;
      while (secretsPickedCount(known, [...bardNames]) < unlocked && nonBardL1.length) {
        known.push(nonBardL1.shift());
      }
      if (!secretsCompleteFor(unlocked, secretsPickedCount(known, [...bardNames]))) {
        fail(`secrets: Bard ${level} unlocks (${unlocked}) not completable`);
      }
      applyLevel(fields, level, choicesStore, []);
    }
    console.log(`secrets: Lore Bard 1-20 unlock ladder holds, ${known.length} Secrets picks complete every unlock`);
  }
}

// --- 9. Phase 1 content audit (docs/CONTENT-AUDIT-2026-09.md) ------------------
{
  const { CLASS_L1_REPLACEMENTS, BG_FEATURE_REPLACEMENTS, FIGHTER_STYLE_GROUP_TEXT } =
    await import("../js/data/phase1Replacements.js");
  const { FIXED_CLASS_ENTRIES, FIXED_BG_ENTRIES, PHASE1_CLASS_REPORT, PHASE1_BG_REPORT } =
    await import("../js/data/contentFixups.js");
  const { mechanicsBulletsFor } =
    await import("../js/render/sheet/sheetMechanics.js");
  const { filterGroupByPack, packAllows, creationChoiceGroupsForState } =
    await import("../js/render/sheet/sheetWizard.js");
  const { ABILITIES, SKILLS } = await import("../js/data/schema.js");
  const { CLASS_STARTING_EQUIPMENT, BG_EQUIPMENT_LINKS, linkedEquipmentNames, bgDisplayItems, resolveStartingEquipmentPick } =
    await import("../js/data/startingEquipment.js");
  const sourcesDoc = readFileSync(new URL("../docs/phase1-sources.md", import.meta.url), "utf8");
  const vocab = { abilityIds: ABILITIES.map((a) => a.id), abilities: ABILITIES, skills: SKILLS };
  const cls = (n) => FIXED_CLASS_ENTRIES.find((e) => e.name === n)?.bundle;
  const bg = (n) => FIXED_BG_ENTRIES.find((e) => e.name === n)?.bundle;

  // 9a. Every class/background choice group carries an explicit category
  // (the audit's 26, plus the Artificer's own and the new Phase 1 groups).
  const PHASE1_GROUP_IDS = ["class-skills", "monk-toolProf-0", "bard-toolProf-0",
    "acolyte-languages-0", "entertainer-toolProf-1", "folk-hero-toolProf-0",
    "guild-artisan-toolProf-0", "guild-artisan-languages-0", "noble-toolProf-0",
    "noble-languages-0", "outlander-toolProf-0", "outlander-languages-0",
    "sage-languages-0", "urban-bounty-hunter-skills", "urban-bounty-hunter-toolProf-0"];
  for (const id of PHASE1_GROUP_IDS) {
    const owners = [
      ...FIXED_CLASS_ENTRIES.filter((e) => (e.bundle.choiceGroups || []).some((g) => g.id === id)).map((e) => e.name),
      ...FIXED_BG_ENTRIES.filter((e) => (e.bundle.choiceGroups || []).some((g) => g.id === id)).map((e) => e.name),
    ];
    if (!owners.length) fail(`phase1: audit group ${id} missing from every bundle`);
  }
  for (const e of [...FIXED_CLASS_ENTRIES, ...FIXED_BG_ENTRIES]) {
    for (const g of (e.bundle.choiceGroups || [])) {
      if (!g.category) fail(`phase1: ${e.name} group ${g.id} has no category`);
    }
  }

  // 9b. Verbatim replacements: every table string lands exactly, the
  // sourcing doc names every grant, and replaced grants keep their
  // prior text on `reference`.
  const finalName = (clsName, grant) =>
    (clsName === "Druid" && grant === "Armor Restriction") ? "Armor Restriction" : grant;
  for (const [name, rows] of Object.entries(CLASS_L1_REPLACEMENTS)) {
    for (const { grant, text } of rows) {
      const found = (cls(name)?.featureGrants || []).find((g) => g.name === finalName(name, grant));
      if (!found) fail(`phase1: ${name} grant ${grant} not found after patch`);
      else if (found.description !== text) fail(`phase1: ${name} ${grant} text is not verbatim`);
      else if (grant !== "Expertise" && !found.reference) fail(`phase1: ${name} ${grant} lost its prior text (no reference)`);
      if (!sourcesDoc.includes(grant)) fail(`phase1: sources doc never names ${name} ${grant}`);
    }
    const report = PHASE1_CLASS_REPORT[name];
    if (!report) fail(`phase1: no apply report for class ${name}`);
    else if (report.missing.length) fail(`phase1: ${name} replacements missing: ${report.missing.join(", ")}`);
  }
  for (const [name, rows] of Object.entries(BG_FEATURE_REPLACEMENTS)) {
    for (const { grant, text } of rows) {
      const found = (bg(name)?.featureGrants || []).find((g) => g.name === grant);
      if (!found) fail(`phase1: background ${name} grant ${grant} not found after patch`);
      else if (found.description !== text) fail(`phase1: background ${name} ${grant} text is not verbatim`);
      else if (!found.reference) fail(`phase1: background ${name} ${grant} lost its prior text (no reference)`);
      if (!sourcesDoc.includes(grant)) fail(`phase1: sources doc never names background ${name} ${grant}`);
    }
    const report = PHASE1_BG_REPORT[name];
    if (!report) fail(`phase1: no apply report for background ${name}`);
    else if (report.missing.length) fail(`phase1: background ${name} replacements missing: ${report.missing.join(", ")}`);
  }
  const fighterStyle = (cls("Fighter")?.choiceGroups || []).find((g) => g.id === "fighter-fighting-style");
  if (fighterStyle?.description !== FIGHTER_STYLE_GROUP_TEXT) fail("phase1: Fighter style group text not attached");

  // 9c. Drops: no future-spell lists, no L1 optional grants anywhere.
  for (const e of FIXED_CLASS_ENTRIES) {
    for (const g of (e.bundle.featureGrants || [])) {
      if (/^Additional .* Spells \(Optional\)$/.test(g.name || "")) fail(`phase1: ${e.name} still lists ${g.name}`);
    }
  }
  if ((cls("Fighter")?.featureGrants || []).some((g) => / \(Optional\)$/.test(g.name || ""))) {
    fail("phase1: Fighter still shows optional style grants");
  }
  for (const n of ["Deft Explorer (Optional)", "Favored Foe (Optional)"]) {
    if ((cls("Ranger")?.featureGrants || []).some((g) => g.name === n)) fail(`phase1: Ranger still shows ${n}`);
  }
  // Every surviving "(Optional)" class grant is pack-gated to Tasha's.
  for (const e of FIXED_CLASS_ENTRIES) {
    for (const g of (e.bundle.featureGrants || [])) {
      if (/\(Optional\)$/.test(g.name || "") && g.requiresPack !== "tashas") {
        fail(`phase1: ${e.name} optional ${g.name} is not pack-gated`);
      }
    }
  }

  // 9d. Pack gating works: Tasha's styles/variant hidden without the pack.
  if (!packAllows({ requiresPack: "tashas" }, ["phb", "tashas"])) fail("phase1: packAllows rejects an included pack");
  if (packAllows({ requiresPack: "tashas" }, ["phb"])) fail("phase1: packAllows leaks a missing pack");
  if (packAllows({}, ["phb"]) !== true) fail("phase1: packAllows hides an ungated item");
  const phbStyles = filterGroupByPack(fighterStyle, ["phb"]);
  if ((phbStyles?.options || []).length !== 6) fail(`phase1: Fighter shows ${(phbStyles?.options || []).length} styles without Tasha's (want 6)`);
  const fullStyles = filterGroupByPack(fighterStyle, ["phb", "tashas"]);
  if ((fullStyles?.options || []).length !== 11) fail("phase1: Fighter loses styles with Tasha's (want 11)");
  const rangerGroups = cls("Ranger")?.choiceGroups || [];
  const enemy = rangerGroups.find((g) => g.id === "ranger-favored-enemy");
  const terrain = rangerGroups.find((g) => g.id === "ranger-favored-terrain");
  const variant = rangerGroups.find((g) => g.id === "ranger-class-variant");
  // 13, not 14: "Humanoids (choose two)" was a single option whose whole
  // text was an instruction, so taking it granted nothing. It is replaced
  // by a real humanoid-type group (asserted below), which is why the
  // level-1 list is one shorter.
  if (!enemy || enemy.options.length !== 13 || enemy.category !== "features" || enemy.minLevel !== 1) {
    fail("phase1: ranger favored-enemy group misshapen");
  }
  const enemyHumanoid = rangerGroups.find((g) => g.id === "ranger-favored-enemy-humanoid");
  if (!enemyHumanoid || enemyHumanoid.minSelections !== 2 || enemyHumanoid.maxSelections !== 2 || enemyHumanoid.options.length < 10) {
    fail("phase1: ranger favored-enemy humanoids are not a real two-pick");
  }
  if (!terrain || terrain.options.length !== 8 || terrain.category !== "features" || terrain.minLevel !== 1) {
    fail("phase1: ranger favored-terrain group misshapen");
  }
  if (!variant || variant.requiresPack !== "tashas" || variant.minSelections !== 0 || variant.maxSelections !== 1) {
    fail("phase1: ranger variant group misshapen");
  }
  if (filterGroupByPack(variant, ["phb"]) !== null) fail("phase1: ranger variant leaks without Tasha's");
  if (!filterGroupByPack(variant, ["phb", "tashas"])) fail("phase1: ranger variant hidden with Tasha's");
  const acolytePrayer = (bg("Acolyte")?.choiceGroups || []).find((g) => g.id === "acolyte-prayer-focus");
  if (!acolytePrayer || acolytePrayer.category !== "equipment" || acolytePrayer.options.length !== 2) {
    fail("phase1: acolyte prayer-focus group misshapen");
  }
  // Rogue Expertise pool shape: proficient-skills-or-thieves'-tools only.
  const rogueExp = (cls("Rogue")?.choiceGroups || []).find((g) => g.id === "rogue-expertise-0");
  const expNames = new Set((rogueExp?.options || []).map((o) => o.name));
  const skillNames = new Set(SKILLS.map((s) => s.label));
  for (const n of expNames) {
    if (!skillNames.has(n) && n !== "Thieves' Tools") fail(`phase1: rogue expertise offers non-skill ${n}`);
  }
  if (!expNames.has("Thieves' Tools")) fail("phase1: rogue expertise lacks thieves' tools");

  // 9e. Level-1 rows: audit titles only, no future-level text, no raw ids.
  const FUTURE_LEVEL = /\b((1[0-9]|[2-9])(st|nd|rd|th)[- ]levels?\b|levels? ([2-9]|1[0-9]|20)\b|levels 1-9|at higher levels)/i;
  const RAW_ID = /\b[a-z][a-zA-Z]*((Save)?Prof)\b/;
  const stripCaps = (text) => String(text || "").split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/^\s*(No|You cannot|It cannot|This cannot|Never)\b/i.test(sentence)).join(" ");
  for (const e of FIXED_CLASS_ENTRIES) {
    if (e.name === "Artificer") continue; // hand-written TCE entry, outside the audit's 12
    const sections = mechanicsBulletsFor(e.bundle, 1, { ...vocab, classDisplay: true, includedPacks: ["phb"] });
    const titles = sections.map((s) => s.title);
    for (const t of titles) {
      if (!["Level 1 Class Features", "Class Proficiencies", "Ability Score Increases"].includes(t)) {
        fail(`phase1: ${e.name} row uses unexpected section ${t}`);
      }
    }
    if (!titles.includes("Level 1 Class Features") || !titles.includes("Class Proficiencies")) {
      fail(`phase1: ${e.name} row misses an audit section (has: ${titles.join(", ")})`);
    }
    const text = sections.flatMap((s) => s.items).join(" || ");
    if (FUTURE_LEVEL.test(stripCaps(text))) fail(`phase1: ${e.name} L1 row mentions a higher level`);
    if (RAW_ID.test(text)) fail(`phase1: ${e.name} L1 row leaks a raw field id`);
    if (/\(Optional\)/.test(text)) fail(`phase1: ${e.name} L1 row shows optional text`);
  }
  for (const e of FIXED_BG_ENTRIES) {
    const sections = mechanicsBulletsFor(e.bundle, 1, { ...vocab, backgroundDisplay: true, includedPacks: ["phb"] });
    const titles = sections.map((s) => s.title);
    for (const t of titles) {
      if (!["Background Proficiencies", "Starting Equipment", "Background Feature", "Ability Score Increases"].includes(t)) {
        fail(`phase1: background ${e.name} uses unexpected section ${t}`);
      }
    }
    if (!titles.includes("Background Feature") || !titles.includes("Starting Equipment")) {
      fail(`phase1: background ${e.name} misses an audit section (has: ${titles.join(", ")})`);
    }
    const text = sections.flatMap((s) => s.items).join(" || ");
    if (RAW_ID.test(text)) fail(`phase1: background ${e.name} row leaks a raw field id`);
  }

  // 9f. Equipment links: one pick drives proficiency and inventory.
  for (const [name, link] of Object.entries(BG_EQUIPMENT_LINKS)) {
    const bundle = bg(name);
    if (!(bundle?.choiceGroups || []).some((g) => g.id === link.groupId)) {
      fail(`phase1: ${name} linked group ${link.groupId} missing`);
    }
  }
  const entBundle = bg("Entertainer");
  const luteId = ((entBundle?.choiceGroups || []).find((g) => g.id === "entertainer-toolProf-1")?.options || [])
    .find((o) => o.name === "Lute")?.id;
  const luteNames = linkedEquipmentNames("Entertainer", entBundle, { "creation:Background:Entertainer:entertainer-toolProf-1": [luteId] });
  if (luteNames.join() !== "Lute") fail("phase1: entertainer tool pick does not link");
  if (!bgDisplayItems("Entertainer", luteNames).includes("Lute")) fail("phase1: entertainer equipment does not resolve the pick");
  if (bgDisplayItems("Entertainer", luteNames).some((i) => /your choice/i.test(i))) {
    fail("phase1: entertainer placeholder survives a linked pick");
  }
  const acolWheel = resolveStartingEquipmentPick("Fighter", "Acolyte",
    { picks: { armor: "chain-mail", weapon: "sword-board", ranged: "light-crossbow", pack: "dungeoneers-pack" } },
    ["Prayer wheel"]);
  if (!acolWheel.items.includes("Prayer wheel") || acolWheel.items.includes("Prayer book")) {
    fail("phase1: acolyte prayer pick does not drive inventory");
  }
  const acolDefault = resolveStartingEquipmentPick("Fighter", "Acolyte",
    { picks: { armor: "chain-mail", weapon: "sword-board", ranged: "light-crossbow", pack: "dungeoneers-pack" } });
  if (!acolDefault.items.includes("Prayer book")) fail("phase1: acolyte legacy equipment changed");
  if (!CLASS_STARTING_EQUIPMENT.Fighter) fail("phase1: class equipment packages missing");

  console.log("phase1: 26 categories, 28 verbatim texts + sources, drops, Tasha gating, L1 rows, equipment links all hold");
}

// --- 9b. Phase 2 subclass content (docs/SUBCLASS-CONTENT-AUDIT-2026-09.md) ---
{
  const { checkSubclassSourcing } = await import("./check-subclass-sourcing.mjs");
  const { failures: sourceFailures } = checkSubclassSourcing();
  for (const f of sourceFailures) fail(`subclass-sourcing: ${f}`);
  if (!sourceFailures.length) console.log("subclass-sourcing: build-time gate passes, zero orphaned summaries");

  const gapsDoc = readFileSync(new URL("../docs/subclass-gaps.md", import.meta.url), "utf8");
  const gapsTotal = gapsDoc.match(/Total unsourced: (\d+) of (\d+) grants/);
  if (!gapsDoc.includes("docs/subclass-gaps.md") && !gapsTotal) fail("subclass gaps doc missing its total line");
  if (!gapsTotal) fail("subclass gaps doc has no total line");
  else console.log(`subclass gaps: ${gapsTotal[1]} unsourced of ${gapsTotal[2]} grants (see docs/subclass-gaps.md)`);

  const { SUBCLASS_BUNDLE_MAP, normSubclassKey } = await import("../js/data/contentFixups.js");
  const { mechanicsBulletsFor: subBullets } = await import("../js/render/sheet/sheetMechanics.js");
  const { ABILITIES: SUB_ABILITIES, SKILLS: SUB_SKILLS } = await import("../js/data/schema.js");
  const subVocab = { abilityIds: SUB_ABILITIES.map((a) => a.id), abilities: SUB_ABILITIES, skills: SUB_SKILLS };
  const subBundle = (n) => SUBCLASS_BUNDLE_MAP.get(normSubclassKey(n));

  // Every subclass choice group has a category and a choiceKind.
  for (const s of SUBCLASS_SUPPLEMENT) {
    for (const g of ((SUBCLASS_BUNDLE_MAP.get(s.key) || s.bundle)?.choiceGroups || [])) {
      if (!g.category) fail(`phase2: subclass ${s.name} group ${g.id} lacks a category`);
      if (!["build", "levelUp", "playTime"].includes(g.choiceKind)) fail(`phase2: subclass ${s.name} group ${g.id} lacks a choiceKind`);
    }
  }
  // No top-level grant is level-less without an explicit alwaysActive
  // reason (option-level grants inherit their group's level gate).
  for (const s of SUBCLASS_SUPPLEMENT) {
    for (const g of ((s.bundle || {}).featureGrants || [])) {
      if (g.minLevel == null && !(g.alwaysActive === true)) {
        fail(`phase2: subclass ${s.name} grant ${g.id} has minLevel null without alwaysActive`);
      }
    }
  }

  // Spot-check 1: Light Domain at level 1 shows only L1 domain spells.
  {
    const light = subBundle("Light Domain");
    const sections = subBullets(light, 1, { ...subVocab, subclassDisplay: true });
    const titles = sections.map((s) => s.title);
    if (!titles.includes("Subclass Features")) fail("phase2: Light Domain row misses the Subclass Features heading");
    if (titles.some((t) => /Racial Traits|Innate Abilities/.test(t))) fail("phase2: Light Domain row uses a race/innate heading");
    const text = sections.flatMap((s) => s.items).join(" || ");
    for (const want of ["Burning Hands", "Faerie Fire", "always prepared", "do not count"]) {
      if (!text.includes(want)) fail(`phase2: Light Domain L1 line misses ${want}`);
    }
    for (const banned of ["Flaming Sphere", "Fireball", "level-feature", "3rd, 5th"]) {
      if (text.includes(banned)) fail(`phase2: Light Domain L1 line leaks ${banned}`);
    }
  }
  // Spot-check 2: Oath of Devotion at level 3 shows only L3 oath spells.
  {
    const devo = subBundle("Oath of Devotion");
    const sections = subBullets(devo, 3, { ...subVocab, subclassDisplay: true });
    const text = sections.flatMap((s) => s.items).join(" || ");
    for (const want of ["Protection from Evil and Good", "Sanctuary", "always prepared"]) {
      if (!text.includes(want)) fail(`phase2: Devotion L3 line misses ${want}`);
    }
    for (const banned of ["Lesser Restoration", "Beacon of Hope", "level-feature"]) {
      if (text.includes(banned)) fail(`phase2: Devotion L3 line leaks ${banned}`);
    }
  }
  // Spot-check 3: Circle of the Land — malformed text gone, terrain
  // choice categorized, L2 shows no future rows.
  {
    const land = subBundle("Circle of the Land");
    const terrain = (land?.choiceGroups || []).find((g) => g.id === "circle-of-the-land-focus");
    if (!terrain || terrain.category !== "features" || terrain.minLevel !== 2) {
      fail("phase2: Land terrain choice not category-gated at level 2");
    }
    const sections = subBullets(land, 2, { ...subVocab, subclassDisplay: true });
    const text = sections.flatMap((s) => s.items).join(" || ");
    if (/3rd, 5th, 7th,/.test(text)) fail("phase2: Land malformed spell-row text survives");
    if (/-level feature\./.test(text)) fail("phase2: Land placeholder survives");
  }
  // Spot-check 4: Eldritch Knight — one level-3 Spellcasting grant with
  // third-caster context, no placeholder, no duplicate.
  {
    const ek = subBundle("Eldritch Knight");
    const casting = (ek?.featureGrants || []).filter((g) => g.name === "Spellcasting");
    if (casting.length !== 1) fail(`phase2: Eldritch Knight has ${casting.length} Spellcasting grants (want 1)`);
    if (casting[0]?.minLevel !== 3) fail("phase2: Eldritch Knight Spellcasting not gated at 3");
    if (!/Third-caster spellcasting using Intelligence/.test(casting[0]?.description || "")) {
      fail("phase2: Eldritch Knight Spellcasting lacks third-caster context");
    }
    const sections = subBullets(ek, 3, { ...subVocab, subclassDisplay: true });
    if (/-level feature\./.test(sections.flatMap((s) => s.items).join(" "))) fail("phase2: Eldritch Knight placeholder survives");
  }
  // Warlock patrons expand available options, never automatically
  // known spells (audit choice review): no patron auto-grants spells.
  for (const s of SUBCLASS_SUPPLEMENT) {
    if (s.className !== "Warlock") continue;
    const auto = ((s.bundle || {}).statModifiers || []).filter((m) => m.op === "addItem" && m.targetFieldId === "spellsKnown");
    if (auto.length) fail(`phase2: warlock patron ${s.name} auto-grants spells (${auto.map((m) => m.value).join(", ")})`);
  }
  // Artificer reachability (audit 2d gate): a full Artificer character
  // builds end-to-end (bundle, equipment, spell progression, subclass).
  {
    const { FIXED_CLASS_ENTRIES } = await import("../js/data/contentFixups.js");
    const { CLASS_STARTING_EQUIPMENT, resolveStartingEquipmentPick: resolveEq } = await import("../js/data/startingEquipment.js");
    const { getLevelUpPlan: planFor } = await import("../js/data/dnd5e.js");
    const art = FIXED_CLASS_ENTRIES.find((e) => e.name === "Artificer");
    if (!art || art.subclassLevel !== 3 || art.caster !== "half") fail("phase2: Artificer base bundle misshapen");
    if (!CLASS_STARTING_EQUIPMENT.Artificer) fail("phase2: Artificer has no equipment model");
    if (!resolveEq("Artificer", "Sailor", { picks: { armor: "scale-mail" } }).items.length) fail("phase2: Artificer equipment does not resolve");
    if (!planFor("dnd5e-2014", "Artificer", 20)) fail("phase2: Artificer has no spell progression");
    if (!subBundle("Alchemist")) fail("phase2: Alchemist subclass unreachable");
  }
  console.log("phase2: sourcing gate, gaps total, categories, level gates, 4 spot-checks, artificer reachability all hold");
}

// --- 7. Catalogs ------------------------------------------------------------
{
  const tabIds = SPELL_CATALOG.tabs.map((t) => t.id);
  for (const id of ["cantrips", "level1", "level9"]) {
    if (!tabIds.includes(id)) fail(`SPELL_CATALOG missing tab ${id}`);
  }
  if (!WEAPONS_ARMOR_CATALOG.tabs.length || !GEAR_CATALOG.tabs.length) fail("equipment catalogs empty");
  console.log(`catalogs: Spell List (${SPELL_CATALOG.tabs.reduce((n, t) => n + (t.entries || []).length, 0)} spells), Weapons & Armor, Adventuring Gear present`);
}

// --- 8. Known hand-tracked gaps (informational only) ------------------------
{
  let notes = 0;
  const scan = (grants) => {
    for (const g of (grants || [])) {
      if (/track .* by hand|no .* picker yet/i.test(g.description || "")) notes++;
    }
  };
  for (const e of DEFAULT_CONTENT.classEntries) scan(e.bundle?.featureGrants);
  for (const s of SUBCLASS_SUPPLEMENT) scan(s.bundle?.featureGrants);
  console.log(`known hand-tracked gaps: ${notes} feature notes (intentional, see docs/RESCUE-NOTES.md)`);
}

// --- 9. Bundle <-> catalog links (Phase 4) ----------------------------------
//
// The wizard used to pair a bundle (mechanics) with a catalog entry
// (portrait/description) by matching names, so a rename on either side
// silently dropped the row's flavor. Bundles now carry an explicit
// catalogEntryId. These checks keep that link honest: every linkable bundle
// has one, every id resolves, and the id-based lookup actually finds what
// the old name match found.
{
  // The app mints these ids at load time (customSheet.js, right after the
  // catalog cache is built); do the same here so this block checks the
  // same state the app sees.
  assignCatalogEntryIds(DEFAULT_CONTENT.catalogs);
  assignCatalogEntryIds([FEAT_CATALOG]);

  const ids = new Set();
  for (const cat of DEFAULT_CONTENT.catalogs) {
    for (const tab of cat.tabs || []) {
      for (const e of tab.entries || []) {
        if (!e.id) fail(`catalog entry "${e.name}" (${cat.name}/${tab.name}) has no id`);
        else if (ids.has(e.id)) fail(`duplicate catalog entry id: ${e.id}`);
        else ids.add(e.id);
      }
    }
  }
  for (const tab of FEAT_CATALOG.tabs || []) {
    for (const e of tab.entries || []) {
      if (!e.id) fail(`feat catalog entry "${e.name}" has no id`);
      else if (ids.has(e.id)) fail(`duplicate catalog entry id: ${e.id}`);
      else ids.add(e.id);
    }
  }

  // Bundles that legitimately have no catalog counterpart: the base
  // Genasi is a container whose four elemental subraces are the real
  // pickable options, and no flavor entry exists for it (sourcing rule —
  // see docs/subclass-gaps.md). Its rows fall back to placeholder art,
  // exactly as they did before the link existed.
  const NO_CATALOG_ENTRY = new Set(["race:genasi"]);

  const linked = [];
  const collect = (kind, entries, getBundle) => {
    for (const e of entries) linked.push({ kind, name: e.name, id: getBundle(e)?.catalogEntryId });
  };
  collect("race", FIXED_RACE_ENTRIES, (e) => e.bundle);
  collect("class", FIXED_CLASS_ENTRIES, (e) => e.bundle);
  collect("background", FIXED_BG_ENTRIES, (e) => e.bundle);
  // Subclass bundles are keyed by a normalized name in the map and don't
  // carry a name field themselves, so pair each with its supplement entry
  // to get the display name (and confirm the two stay in step).
  const subclassBundles = SUBCLASS_SUPPLEMENT.map((s) => {
    const bundle = SUBCLASS_BUNDLE_MAP.get(s.key);
    if (!bundle) fail(`SUBCLASS_BUNDLE_MAP has no bundle for "${s.name}" (key ${s.key})`);
    return { name: s.name, bundle };
  });
  collect("subclass", subclassBundles, (e) => e.bundle);
  collect("feat", LINKED_FEAT_BUNDLES, (b) => b);

  let unlinked = 0;
  let dangling = 0;
  for (const { kind, name, id } of linked) {
    if (!id) { unlinked++; fail(`${kind} "${name}" has no catalogEntryId`); continue; }
    if (ids.has(id)) continue;
    if (NO_CATALOG_ENTRY.has(id)) continue;
    dangling++;
    fail(`${kind} "${name}" links to ${id}, which resolves to no catalog entry`);
  }

  // The link must actually work, not merely exist: re-running the id
  // lookup has to return the same flavor the old name match did.
  const byName = (catalogs, tabName, name) => {
    for (const cat of catalogs) {
      if (cat.name !== tabName) continue;
      for (const tab of cat.tabs || []) {
        const e = (tab.entries || []).find((x) => norm(x.name) === norm(name));
        if (e) return e;
      }
    }
    return null;
  };
  const probes = [
    ["Classes", "Barbarian"], ["Classes", "Champion"],
    ["Races", "Elf"], ["Backgrounds", "Acolyte"],
  ];
  for (const [catalogName, entryName] of probes) {
    const expected = byName(DEFAULT_CONTENT.catalogs, catalogName, entryName);
    if (!expected) { fail(`probe target ${catalogName}/${entryName} not in catalog`); continue; }
    const got = catalogEntryInfoIn(DEFAULT_CONTENT.catalogs, ["class"], "no-such-name", expected.id);
    if (!got) fail(`catalogEntryInfoIn failed to resolve ${catalogName}/${entryName} by its id ${expected.id}`);
    else if (expected.description && got.description !== expected.description) {
      fail(`id lookup returned the wrong entry for ${expected.id}`);
    }
  }

  // Migration: a legacy name-only library entry gets linked, an already
  // linked one is left alone, and an entry with no catalog counterpart is
  // reported rather than guessed at.
  const legacy = [
    { name: "Barbarian", category: "Class" },
    { name: "Elf", category: "Race" },
    { name: "Champion", category: "Subclass" },
    { name: "Alert", category: "Feat" },
    { name: "Not A Real Thing", category: "Class" },
  ];
  const catalogs = [FEAT_CATALOG, ...DEFAULT_CONTENT.catalogs];
  const { bundles: migrated, linked: newly, unresolved } = migrateBundleCatalogLinks(legacy, catalogs);
  const byNameAfter = (n) => migrated.find((b) => b.name === n);
  for (const n of ["Barbarian", "Elf", "Champion", "Alert"]) {
    if (!byNameAfter(n)?.catalogEntryId) fail(`migration did not link legacy entry "${n}"`);
  }
  if (byNameAfter("Not A Real Thing")?.catalogEntryId) fail("migration guessed a link for an entry with no catalog counterpart");
  if (newly.length !== 4) fail(`migration linked ${newly.length} entries, expected 4`);
  if (unresolved.length !== 1) fail(`migration reported ${unresolved.length} unresolved, expected 1`);
  // Inputs are never mutated — the caller's stored objects stay untouched.
  if (legacy.some((b) => b.catalogEntryId)) fail("migrateBundleCatalogLinks mutated its input");

  console.log(`phase4: catalog links — ${ids.size} catalog ids, ${linked.length} bundles linked (${dangling} dangling, ${NO_CATALOG_ENTRY.size} known no-entry, ${unlinked} unlinked); migration + id-lookup probes hold`);
}

// --- 10. Choice-group categories are explicit (Phase 4) ----------------------
//
// The wizard used to sort a bundle's choice groups onto its own creation
// pages by keyword-matching each group's free-text label. That's now a
// stored `category` on every group the repo ships, so a rename can't
// silently move a group to a different page. The label regex survives only
// as an import-compat net for homebrew, which arrives with no category.
{
  const groups = [];
  for (const e of FIXED_RACE_ENTRIES) for (const g of e.bundle?.choiceGroups || []) groups.push([`race "${e.name}"`, g]);
  for (const e of FIXED_CLASS_ENTRIES) for (const g of e.bundle?.choiceGroups || []) groups.push([`class "${e.name}"`, g]);
  for (const e of FIXED_BG_ENTRIES) for (const g of e.bundle?.choiceGroups || []) groups.push([`background "${e.name}"`, g]);
  for (const s of SUBCLASS_SUPPLEMENT) {
    for (const g of SUBCLASS_BUNDLE_MAP.get(s.key)?.choiceGroups || []) groups.push([`subclass "${s.name}"`, g]);
  }
  for (const b of LINKED_FEAT_BUNDLES) for (const g of b.choiceGroups || []) groups.push([`feat "${b.name}"`, g]);

  for (const [src, g] of groups) {
    if (!g.pageCategory) fail(`${src} choice group "${g.label}" has no explicit pageCategory — the label fallback would be doing real work`);
    else if (!CHOICE_GROUP_CATEGORY_KEYS.has(g.pageCategory)) fail(`${src} choice group "${g.label}" has unknown pageCategory "${g.pageCategory}"`);
    // The renderer already resolved the page the same way before, so the
    // assigned value must match what it computed — anything else means
    // this "cleanup" moved a group to a different page, which is a
    // player-visible change nobody asked for.
    else if (g.pageCategory !== inferChoiceCategory(g)) {
      fail(`${src} choice group "${g.label}" changed page: was ${inferChoiceCategory(g)}, now ${g.pageCategory}`);
    }
  }

  // `category` belongs to a different vocabulary (class-feature markers
  // like "features") and must survive this pass untouched.
  const CATEGORY_CODES = new Set(["features"]);
  for (const [src, g] of groups) {
    if (g.category && !CHOICE_GROUP_CATEGORY_KEYS.has(g.category) && !CATEGORY_CODES.has(g.category)) {
      fail(`${src} choice group "${g.label}" has unrecognized category "${g.category}"`);
    }
  }
  const marked = groups.filter(([, g]) => g.category === "features").length;
  if (!marked) fail("no class-feature groups carry category \"features\" — the marker was clobbered");

  // The fallback still has to work for homebrew, which has no page.
  const unlabeled = categorizeChoiceGroup({ label: "Pick 2 skills" });
  if (unlabeled !== "skills") fail(`import fallback stopped resolving a bare skill group (got "${unlabeled}")`);
  const uncategorizable = categorizeChoiceGroup({ label: "Mystery Choice" });
  if (uncategorizable !== CATCH_ALL_CATEGORY) fail(`import fallback no longer falls back to ${CATCH_ALL_CATEGORY} (got "${uncategorizable}")`);
  // An explicit page beats the label, even a contradictory one.
  if (categorizeChoiceGroup({ label: "Pick 2 skills", pageCategory: "spells" }) !== "spells") {
    fail("an explicit pageCategory was overridden by the label heuristic");
  }
  // A group carrying only the inert "features" marker still resolves by label.
  if (categorizeChoiceGroup({ label: "Pick 2 skills", category: "features" }) !== "skills") {
    fail("the \"features\" marker stopped deferring to page resolution");
  }

  console.log(`phase4: choice pages — all ${groups.length} shipped groups carry an explicit pageCategory, none moved page, ${marked} "features" markers intact; import fallback intact`);
}

if (failures) {
  console.error(`verify-content: ${failures} failure(s)`);
  process.exit(1);
} else {
  console.log("verify-content: all checks passed");
}

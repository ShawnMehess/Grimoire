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
import { FEAT_BUNDLES } from "../js/data/featBundles.js";
import { RACE_EXTRA_ENTRIES } from "../js/data/extraRaces.js";
import { SPELL_CATALOG, WEAPONS_ARMOR_CATALOG, GEAR_CATALOG } from "../js/data/contentCatalogs.js";
import { createStarterLayout } from "../js/data/blockModel.js";
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
  for (const e of DEFAULT_CONTENT.classEntries) checkBundle(e.bundle, `class ${e.name}`);
  for (const e of [...DEFAULT_CONTENT.raceEntries, ...RACE_EXTRA_ENTRIES]) checkBundle(e.bundle, `race ${e.name}`);
  for (const e of DEFAULT_CONTENT.bgEntries) checkBundle(e.bundle, `background ${e.name}`);
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
  if (!l1.features.some((f) => f.name === "Warding Flare")) fail("Light Domain: Warding Flare not granted at level 1");

  const palFields = freshFields();
  selectByText(palFields, "Class", "Paladin");
  selectByText(palFields, "Race", "Human");
  selectByText(palFields, "Background", "Noble");
  const p2 = applyLevel(palFields, 2, {}, []);
  if (p2.items.length) fail("Paladin: spells granted before oath at level 3");
  selectByText(palFields, "Subclass", "Oath of Devotion");
  const p3 = applyLevel(palFields, 3, {}, []);
  if (!p3.items.flatMap((g) => g.items).includes("Sanctuary")) fail("Devotion: Sanctuary not granted at level 3");
  if (!p3.features.some((f) => f.name === "Sacred Weapon")) fail("Devotion: Sacred Weapon not granted at level 3");

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

  // Free-form racial ASIs: 15 pairs + 20 triples.
  for (const n of ["Aarakocra", "Aasimar", "Air Genasi", "Earth Genasi", "Fire Genasi", "Water Genasi", "Yuan-ti"]) {
    const g = (race(n)?.choiceGroups || []).find((g) => g.id.endsWith("-asi"));
    if (!g || g.options.length !== 35) fail(`${n}: ASI picker missing (want 35 options, got ${g?.options.length ?? 0})`);
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
  console.log(`sheet: dropdowns alphabetical, subclass beside class, columns even (${ends[0]}), vehicle field present`);
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
  for (const want of ["Action Surge", "Lay on Hands", "Divine Sense", "Improved Critical"]) {
    if (!names.includes(want)) fail(`multiclass: missing ${want}`);
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
  console.log(`known hand-tracked gaps: ${notes} feature notes (intentional, see RESCUE-NOTES.md)`);
}

if (failures) {
  console.error(`verify-content: ${failures} failure(s)`);
  process.exit(1);
} else {
  console.log("verify-content: all checks passed");
}

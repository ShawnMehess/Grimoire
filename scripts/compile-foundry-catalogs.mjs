#!/usr/bin/env node
// scripts/compile-foundry-catalogs.mjs
//
// Compiles the Foundry VTT exports in `New Info/` into the site's baked
// reference catalogs: spells (with level/school/casting stats) and items
// (weapons, armor, adventuring gear with cost/weight/damage).
//
// Reads:
//   New Info/5e-spells.txt   (NDJSON, one object per line)
//   New Info/5e-items.txt
//
// Writes:
//   js/data/contentCatalogs.js   (SPELL_CATALOG, WEAPONS_ARMOR_CATALOG,
//                                 GEAR_CATALOG, ITEM_NAMES)
//
// Shape notes (must match what the sheet already consumes):
//   - Spell tab ids are "cantrips", "level1".."level9" (NO dash —
//     spellLevelByNameIn parses tab.id by stripping "level", and
//     spellsForLevelIn looks up `level${N}` first). Tab names stay
//     human ("Cantrips", "1st Level", …) for the name-regex fallback.
//   - Spell entries carry fieldValues.classes ("" = shown for every
//     class — this source has no per-class spell lists) so the spell
//     picker's class filter degrades to "show all, enforce counts".
//   - Item entries carry cost/weight (+damage/properties for weapons,
//     ac/stealth for armor), same fields foundry_to_catalogs.py uses.
//   - Entries whose source object has no usable stats (the ~50
//     name-only spell stubs, the stray "feat"-typed item) are skipped
//     and logged, not emitted as empty rows.
//   - Every entry carries fieldValues.tags (see META TAG TAXONOMY
//     below): single-word lowercase tags driving the pickers' and
//     catalog browser's filter/sort UI. The full vocabulary ships as
//     TAG_VOCABULARY so runtime never hardcodes tag names.

// --- META TAG TAXONOMY -------------------------------------------------
// One word preferred, three words max. Tags are DERIVED, never
// hand-written: structured source fields first (school, activation,
// target shape, rarity), then conservative keyword mining of the
// description text. Deliberately NOT tagged (not derivable
// honestly): ally-vs-enemy intent (only explicit "ally" targets are
// tagged), per-class spell lists, item attunement prerequisites
// beyond yes/no, anything requiring rules judgment calls.
const AREA_SHAPES = new Set(["cube", "radius", "cone", "sphere", "line", "wall", "cylinder", "square"]);
const RARITY_TAG = { common: "common", uncommon: "uncommon", rare: "rare", veryRare: "very-rare", legendary: "legendary", artifact: "artifact" };
const MAGICAL_RARITIES = new Set(["uncommon", "rare", "veryRare", "legendary", "artifact"]);

// [tag, regex] in priority order — an entry can (and usually does)
// carry several. Keep patterns tight: false positives here become
// wrong filter hits on the sheet.
const SPELL_EFFECT_TAGS = [
  ["damage", /\d+d\d+[^.]{0,80}?(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder) damage|\bdeals\b[^.]{0,60}damage|\btakes\b[^.]{0,60}damage/],
  ["heal", /regain[^.]{0,60}hit points|restore[^.]{0,60}hit points|\bheal(ing|s)?\b/],
  ["revive", /return to life|reviv|raise dead|reincarnat|resurrect/],
  ["protect", /resistance to|sanctuary|bonus to ac|invulnerab|protection from |mage armor|stoneskin|barkskin|shield of faith|warding|globe of invulnerab/],
  ["buff", /advantage on|bonus to attack|bonus to ability|bless\b|haste\b|enlarge|additional action|additional attack|fly.{0,20}speed|darkvision|see invisibility|enhance ability|guidance|resistance\b/],
  ["debuff", /disadvantage|paralyz|stunn|poisoned|frighten|charmed|restrain|prone|blind|deafen|incapacitat|exhaustion|vulnerab|bestow curse|reduce.{0,40}(speed|damage)/],
  ["control", /difficult terrain|grappl|entangle|\bweb\b|forcecage|\bmaze\b|imprison|banish|hold person|hold monster|move.{0,30}unwilling|thrown.{0,20}(feet|ft)/],
  ["social", /charm person|charm monster|suggestion|disguise|persua|decept|detect thoughts|speak with|tongues|comprehend languages|modify memory|glibness|\bfriends\b|enthrall|calm emotions|zone of truth|\bdream\b/],
  ["movement", /teleport|fly\b|misty step|dimension door|blink|haste|freedom of movement|increase.{0,30}speed|plane shift|\bgate\b|passwall|spider climb|water walk|feather fall|expeditious|longstrider|phantom steed|wind walk|ethereal/],
  ["summon", /summon|conjure (minor|major|a |an )?(creature|elemental|fey|fiend|beast|celestial|animals)|animate dead|animate objects|create undead|find familiar|faithful hound|unseen servant|spirit guardians|guardian of faith|tiny hut|magnificent mansion|heroes' feast|druid grove|temple of the gods/],
  ["mount", /find steed|find greater steed|phantom steed|\bsteed\b|\bmount\b/],
  ["save", /saving throw/],
  ["attack", /spell attack|melee spell|ranged spell|make a (melee|ranged) (weapon|spell) attack/],
];

// Name-only: matching these against descriptions misfires (a longbow
// "launching arrows" is not consumable; a pack containing rations is
// not itself consumable). Effect words (heal/damage/…) mine the full
// text separately below.
const ITEM_KEYWORD_TAGS = [
  ["tool", /\btools?\b|\bkit\b|supplies|instruments?|gaming set|disguise|forgery|herbalism|navigator|poisoner|thieves|tinker|weav|carpenter|mason|smith|jeweler|painter|potter|cobbler|brewer|cook|glassblower|cartographer|calligrapher|leatherworker|woodcarver|drum|flute|lute|lyre|horn|viol|bagpipes|dulcimer|shawm|pan flute/],
  ["consumable", /potion|scroll|ammunition|rations?|torch|oil|arrows|bolts|bullets|needles|vial|acid|antitoxin|healer|chalk|ball bearings|caltrops|hempen rope|perfume|ink|parchment|paper|sand|whetstone/],
  ["container", /backpack|\bbag\b|chest|sack|pouch|saddlebag|barrel|basket|bottle|waterskin|quiver|case\b|box|jug|tankard|jar|urn|coffer|bandolier|holster|sheath|scabbard/],
  ["light", /candle|torch|lantern|lamp\b|hooded lantern|bullseye lantern|driftglobe/],
  ["mount", /saddle|barding|horseshoes|bit and bridle|carriage|\bcart\b|wagon|chariot|sled|saddlebag/],
];

// Effect words shared with spells (a potion that restores hit points
// is "heal" the same way Cure Wounds is). Spell-only tags
// (concentration, save, attack, …) stay spell-side.
const ITEM_EFFECT_TAGS = ["damage", "heal", "revive", "protect", "buff", "debuff"];

function tagSet(list) {
  return [...new Set(list.filter(Boolean))];
}

function classifySpell(system, name, text) {
  const tags = [];
  const school = (SCHOOLS[system.school] || "").toLowerCase();
  if (school && school !== "—") tags.push(school);
  const level = system.level;
  if (level === 0) tags.push("cantrip");
  const act = (system.activation || {}).type;
  if (act === "reaction") tags.push("reaction");
  if (act === "bonus") tags.push("bonus-action");
  if ((system.components || {}).concentration) tags.push("concentration");
  if ((system.components || {}).ritual) tags.push("ritual");
  const target = system.target || {};
  const ttype = (target.type || "").toLowerCase();
  const runits = ((system.range || {}).units || "").toLowerCase();
  if (ttype === "self" || runits === "self") tags.push("self");
  if (ttype === "ally") tags.push("ally");
  if (AREA_SHAPES.has(ttype)) tags.push("area");
  if (runits === "touch" || (target.units || "").toLowerCase() === "touch") tags.push("touch");
  if ((runits === "ft" || runits === "mi") && !AREA_SHAPES.has(ttype) && ttype !== "self") tags.push("ranged");
  const hay = `${name || ""}\n${text}`.toLowerCase();
  for (const [tag, re] of SPELL_EFFECT_TAGS) {
    if (re.test(hay)) tags.push(tag);
  }
  return tagSet(tags);
}

function classifyItem(tab, system, name, text) {
  const tags = [tab === "weapons" ? "weapon" : tab === "armor" ? "armor" : "gear"];
  const rarity = system.rarity;
  if (RARITY_TAG[rarity]) tags.push(RARITY_TAG[rarity]);
  const hay = `${name}\n${text}`.toLowerCase();
  if (MAGICAL_RARITIES.has(rarity) || (/\bmagical?\b/.test(hay) && !/nonmagical/.test(hay))) tags.push("magical");
  // Foundry attunement is numeric (1 = required, 0 = not) or the
  // word "required" in older exports — only those count.
  const att = system.attunement;
  if (att === 1 || att === true || String(att || "").trim().toLowerCase() === "required") {
    tags.push("attunement");
  }
  if (tab === "armor") tags.push("protect");
  return tagSet(tags);
}

function classifyItemText(tab, name, text, properties, damage) {
  // Keyword pass over the compiled row, kept separate so it also
  // applies to hand-added rows shaped like compiled ones. Category
  // words (tool/consumable/…) match the NAME only; effect words mine
  // name + description.
  const tags = [];
  const nameHay = String(name || "").toLowerCase();
  const fullHay = `${name}\n${text}\n${properties || ""}\n${damage || ""}`.toLowerCase();
  if (damage && damage !== "—") tags.push("damage");
  if (/thrown|ammunition/i.test(properties || "")) tags.push("ranged");
  for (const [tag, re] of ITEM_KEYWORD_TAGS) {
    if (re.test(nameHay)) tags.push(tag);
  }
  const effectTags = new Map(SPELL_EFFECT_TAGS.filter(([tag]) => ITEM_EFFECT_TAGS.includes(tag)));
  for (const [tag, re] of effectTags) {
    if (re.test(fullHay)) tags.push(tag);
  }
  return tagSet(tags);
}
//
// Re-run after updating New Info/:
//   node scripts/compile-foundry-catalogs.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const INFO = path.join(ROOT, "New Info");
const OUTPUT = path.join(ROOT, "js", "data", "contentCatalogs.js");

const skipped = [];
function skip(reason, name) {
  skipped.push(`${reason}: ${name}`);
}

async function loadNdjson(filename) {
  const items = [];
  for (const line of (await readFile(path.join(INFO, filename), "utf8")).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { items.push(JSON.parse(trimmed)); } catch { skip("unparseable line", filename); }
  }
  return items;
}

// --- Shared text helpers (same conventions as compile-foundry-feats.mjs) ---
function resolveRefs(text) {
  text = String(text || "").replace(/@(?:Compendium|UUID)\[[^\]]*\]\{([^}]*)\}/g, "$1");
  text = text.replace(/@(?:Compendium|UUID)\[[^\]]*\]/g, "");
  text = text.replace(/\[\[\/(?:gm)?roll\s+([^\]]+?)\]\]/g, "($1)");
  return text.replace(/[ \t]{2,}/g, " ");
}

function htmlToText(raw) {
  if (!raw) return "";
  let text = String(raw);
  text = text.replace(/<\s*li[^>]*>/gi, "\n- ");
  text = text.replace(/<\s*br[^>]*>/gi, "\n");
  text = text.replace(/<\/(p|div|section|ul|ol|table|tr|h1|h2|h3|h4)>/gi, "\n");
  text = text.replace(/<(p|div|section|ul|ol|table|tr|h1|h2|h3|h4)(\s[^>]*)?>/gi, "\n");
  text = text.replace(/<\/?t[dh](\s[^>]*)?>/gi, " ");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  text = resolveRefs(text);
  const lines = text.split("\n").map((ln) => ln.replace(/[ \t]+/g, " ").trim());
  const out = [];
  for (const ln of lines) {
    if (ln || (out.length && out[out.length - 1] !== "")) out.push(ln);
  }
  return out.join("\n").trim();
}

function firstSentence(text, limit = 160) {
  const flat = String(text || "").replace(/\n+/g, " ").trim();
  if (!flat) return "";
  const m = flat.match(new RegExp(`(.{1,${limit}}?[.!?])(\\s|$)`));
  if (m) return m[1].trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trim()}…`;
}

function emptyDiff() {
  return {
    acquisitionCosts: { added: [], removed: [] },
    requirements: { added: [], removed: [] },
    effects: { added: [], removed: [] },
  };
}

function makeEntry(name, description, fieldValues) {
  return { id: null, name, description, imageData: null, archetypeDiff: emptyDiff(), fieldValues };
}

function field(id, label, kind = "text") {
  return { id, label, kind };
}

// --- Spells ---
const SCHOOLS = {
  abj: "Abjuration", con: "Conjuration", div: "Divination", enc: "Enchantment",
  evo: "Evocation", ill: "Illusion", nec: "Necromancy", trs: "Transmutation",
};
const LEVEL_NAMES = { 0: "Cantrips", 1: "1st Level", 2: "2nd Level", 3: "3rd Level", 4: "4th Level", 5: "5th Level", 6: "6th Level", 7: "7th Level", 8: "8th Level", 9: "9th Level" };
const ACTIVATION = { action: "1 action", bonus: "1 bonus action", reaction: "1 reaction", minute: "minute(s)", hour: "hour(s)", special: "Special", none: "" };
const DURATION = { inst: "Instantaneous", round: "round(s)", minute: "minute(s)", hour: "hour(s)", day: "day(s)", spec: "Special", perm: "Until dispelled" };

function castingTime(system) {
  const act = system.activation || {};
  const label = ACTIVATION[act.type] ?? act.type ?? "";
  let text = (act.type === "minute" || act.type === "hour") && act.cost ? `${act.cost} ${label}` : label;
  if ((system.components || {}).ritual) text = text ? `${text} (Ritual)` : "Ritual";
  return text || "—";
}

function spellRange(system) {
  const rng = system.range || {};
  if (rng.units === "touch") return "Touch";
  if (rng.units === "self") return "Self";
  if (rng.units === "spec") return "Special";
  return rng.value ? `${rng.value} ${rng.units || ""}`.trim() : "—";
}

function spellDuration(system) {
  const dur = system.duration || {};
  const label = DURATION[dur.units] ?? dur.units ?? "";
  if (["round", "minute", "hour", "day"].includes(dur.units) && dur.value) return `${dur.value} ${label}`;
  return label || "—";
}

function compileSpells(raw) {
  const byLevel = new Map();
  for (const d of raw) {
    if (d.type !== "spell") { skip(`non-spell type "${d.type}"`, d.name); continue; }
    const system = d.system || d.data || {};
    const level = system.level;
    if (!Number.isInteger(level) || level < 0 || level > 9) { skip("no usable level", d.name); continue; }
    const text = htmlToText((system.description || {}).value);
    if (!text) { skip("empty description", d.name); continue; }
    const school = SCHOOLS[system.school] || "—";
    const comps = system.components || {};
    const entry = makeEntry(d.name || "Unnamed Spell", firstSentence(text), {
      castingTime: castingTime(system),
      range: spellRange(system),
      duration: spellDuration(system),
      concentration: comps.concentration ? "Yes" : "No",
      school,
      level: level === 0 ? "Cantrip" : `Level ${level}`,
      classes: "",
      effect: text,
      tags: classifySpell(system, d.name, text),
    });
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(entry);
  }
  const tabs = [...byLevel.keys()].sort((a, b) => a - b).map((level) => ({
    id: level === 0 ? "cantrips" : `level${level}`,
    name: LEVEL_NAMES[level],
    archetypeDiff: emptyDiff(),
    entries: byLevel.get(level).sort((a, b) => a.name.localeCompare(b.name)),
  }));
  return {
    name: "Spell List",
    archetype: {
      acquisitionCosts: [],
      requirements: [field("castingTime", "Casting Time"), field("range", "Range"), field("duration", "Duration"), field("concentration", "Concentration"), field("school", "School"), field("level", "Level")],
      effects: [field("effect", "Effect")],
    },
    tabs,
  };
}

// --- Items ---
const WEAPON_PROPS = {
  ada: "Adamantine", amm: "Ammunition", fin: "Finesse", fir: "Firearm", foc: "Focus",
  hvy: "Heavy", lgt: "Light", lod: "Loading", mgc: "Magical", rch: "Reach",
  rel: "Reload", ret: "Returning", sil: "Silvered", spc: "Special", thr: "Thrown",
  two: "Two-Handed", ver: "Versatile",
};
const ARMOR_TYPES = new Set(["light", "medium", "heavy", "shield"]);

function formatPrice(price) {
  if (price === null || price === undefined || price === "") return "—";
  const n = Number(price);
  if (!Number.isFinite(n)) return "—";
  return `${n} gp`;
}

function formatWeight(weight) {
  if (weight === null || weight === undefined || weight === "") return "—";
  const n = Number(weight);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : String(n);
}

function formatDamage(system) {
  const parts = ((system.damage || {}).parts) || [];
  const formulas = [];
  for (const part of parts) {
    if (!part) continue;
    const formula = String(part[0] || "").replace(/\s*\+\s*@mod\b/, "").replace(/@mod\b/, "ability modifier").trim();
    const dtype = part.length > 1 ? part[1] : "";
    if (formula) formulas.push(`${formula} ${dtype}`.trim());
  }
  return formulas.length ? formulas.join(", ") : "—";
}

function formatProperties(system) {
  const props = system.properties || {};
  const names = Object.entries(WEAPON_PROPS).filter(([code]) => props[code]).map(([, label]) => label).sort();
  return names.length ? names.join(", ") : "—";
}

function formatAC(armor) {
  const value = armor.value;
  if (value === null || value === undefined) return "—";
  if (armor.type === "light") return `${value} + Dex modifier`;
  if (armor.type === "medium") return `${value} + Dex modifier (max 2)`;
  if (armor.type === "shield") return `+${value}`;
  return String(value);
}

function compileItems(raw) {
  const weapons = [], armorPieces = [], gear = [];
  for (const d of raw) {
    const system = d.system || d.data || {};
    const name = d.name;
    if (!name) { skip("unnamed item", "?"); continue; }
    if (d.type === "feat") { skip("stray feat entry in items file", name); continue; }
    const text = htmlToText((system.description || {}).value);
    const cost = formatPrice(system.price);
    const weight = formatWeight(system.weight);
    if (d.type === "weapon") {
      const damage = formatDamage(system);
      const properties = formatProperties(system);
      weapons.push(makeEntry(name, firstSentence(text) || name, {
        cost, weight, damage, properties,
        tags: tagSet([...classifyItem("weapons", system, name, text), ...classifyItemText("weapons", name, text, properties, damage)]),
      }));
      continue;
    }
    const armor = system.armor || {};
    if (d.type === "equipment" && ARMOR_TYPES.has(armor.type)) {
      armorPieces.push(makeEntry(name, firstSentence(text) || name, {
        cost, weight, ac: formatAC(armor), stealth: system.stealth ? "Disadvantage" : "—",
        tags: tagSet([...classifyItem("armor", system, name, text), ...classifyItemText("armor", name, text, "", "")]),
      }));
      continue;
    }
    gear.push(makeEntry(name, firstSentence(text) || name, {
      cost, weight,
      tags: tagSet([...classifyItem("gear", system, name, text), ...classifyItemText("gear", name, text, "", "")]),
    }));
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  weapons.sort(byName); armorPieces.sort(byName); gear.sort(byName);
  const weaponsArmor = {
    name: "Weapons & Armor",
    archetype: {
      acquisitionCosts: [field("cost", "Cost")],
      requirements: [field("weight", "Weight (lb)")],
      effects: [],
    },
    tabs: [
      { id: "weapons", name: "Weapons", archetypeDiff: emptyDiff(), entries: weapons },
      { id: "armor", name: "Armor", archetypeDiff: emptyDiff(), entries: armorPieces },
    ],
  };
  // Per-tab added effects mirror foundry_to_catalogs.py's split.
  weaponsArmor.tabs[0].archetypeDiff.effects.added = [field("damage", "Damage"), field("properties", "Properties")];
  weaponsArmor.tabs[1].archetypeDiff.effects.added = [field("ac", "Armor Class"), field("stealth", "Stealth Penalty")];
  const adventuringGear = {
    name: "Adventuring Gear",
    archetype: {
      acquisitionCosts: [field("cost", "Cost")],
      requirements: [field("weight", "Weight (lb)")],
      effects: [],
    },
    tabs: [{ id: "gear", name: "Adventuring Gear", archetypeDiff: emptyDiff(), entries: gear }],
  };
  return { weaponsArmor, adventuringGear, itemNames: [...weapons, ...armorPieces, ...gear].map((e) => e.name) };
}

async function main() {
  const spells = compileSpells(await loadNdjson("5e-spells.txt"));
  const { weaponsArmor, adventuringGear, itemNames } = compileItems(await loadNdjson("5e-items.txt"));
  const spellCount = spells.tabs.reduce((n, t) => n + t.entries.length, 0);
  // Tag coverage report: every entry must carry at least its school
  // (spells) or tab tag (items); anything thinner gets listed.
  const vocab = new Set();
  const thin = [];
  const tagCounts = {};
  const collect = (entries, kind) => {
    for (const e of entries) {
      const tags = (e.fieldValues || {}).tags || [];
      if (!tags.length) thin.push(`${kind}: ${e.name}`);
      for (const t of tags) {
        vocab.add(t);
        tagCounts[t] = (tagCounts[t] || 0) + 1;
      }
    }
  };
  for (const t of spells.tabs) collect(t.entries, "spell");
  for (const t of [...weaponsArmor.tabs, ...adventuringGear.tabs]) collect(t.entries, "item");
  const emit = (obj) => JSON.stringify(obj, null, 2);
  const out = `// Auto-generated by scripts/compile-foundry-catalogs.mjs from New Info/5e-spells.txt\n`
    + `// and New Info/5e-items.txt. Do not hand-edit — re-run\n`
    + `// \`node scripts/compile-foundry-catalogs.mjs\` after updating the sources.\n`
    + `// ${spellCount} spells, ${weaponsArmor.tabs[0].entries.length} weapons, `
    + `${weaponsArmor.tabs[1].entries.length} armor pieces, ${adventuringGear.tabs[0].entries.length} gear items.\n`
    + `// Every entry carries fieldValues.tags (see META TAG TAXONOMY in\n`
    + `// the compiler); TAG_VOCABULARY is the full sorted vocabulary.\n`
    + `export const TAG_VOCABULARY = ${emit([...vocab].sort())};\n\n`
    + `export const SPELL_CATALOG = ${emit(spells)};\n\n`
    + `export const WEAPONS_ARMOR_CATALOG = ${emit(weaponsArmor)};\n\n`
    + `export const GEAR_CATALOG = ${emit(adventuringGear)};\n\n`
    + `export const ITEM_NAMES = ${emit(itemNames)};\n`;
  await writeFile(OUTPUT, out, "utf8");
  console.log(`Wrote ${OUTPUT} (${spellCount} spells, ${itemNames.length} items, ${vocab.size} tags)`);
  const top = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log("top tags:", top.map(([k, v]) => `${k}(${v})`).join(" "));
  if (thin.length) {
    console.log(`entries with NO tags (${thin.length}):`);
    for (const t of thin.slice(0, 20)) console.log(`  ${t}`);
  }
  console.log(`Skipped ${skipped.length}:`);
  const counts = {};
  for (const s of skipped) {
    const key = s.split(":")[0];
    counts[key] = (counts[key] || 0) + 1;
  }
  for (const [k, v] of Object.entries(counts)) console.log(`  ${v}x ${k}`);
}

main().catch((err) => { console.error(err); process.exit(1); });

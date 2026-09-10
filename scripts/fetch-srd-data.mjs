#!/usr/bin/env node
// scripts/fetch-srd-data.mjs
//
// One-time (or occasional re-run) fetch of D&D SRD reference data from
// the free dnd5eapi.co REST API, written into /data/*.json so the site
// stays fully static — no live API dependency at runtime.
//
// Usage:
//   node scripts/fetch-srd-data.mjs
//
// Requires Node 18+ (for global fetch). No dependencies.

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const API_BASE_2014 = "https://www.dnd5eapi.co/api/2014";
// Feats aren't meaningfully present in the 2014 SRD at all (Wizards kept
// almost the whole feat list out of the original OGL release — the API's
// 2014 feats endpoint has exactly one entry, Grappler). SRD 5.2 (the
// 2024/5.5e rules, released under CC-BY-4.0 in 2025) is the first time a
// real feat list was ever open-licensed, and the same API added a
// parallel /api/2024 namespace for it. Keep each edition in a separate
// output file; similar names are not a promise that their game mechanics
// are interchangeable.
const API_BASE_2024 = "https://www.dnd5eapi.co/api/2024";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

// Be polite to a free, unauthenticated API: small concurrency limit and
// a short delay between batches rather than firing everything at once.
const CONCURRENCY = 5;
const DELAY_MS = 150;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/** Fetch detail objects for a list of {index, url} refs, a batch at a time. */
async function fetchDetails(refs, transform) {
  const results = [];
  for (let i = 0; i < refs.length; i += CONCURRENCY) {
    const batch = refs.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((ref) => fetchJson(`https://www.dnd5eapi.co${ref.url}`).then(transform))
    );
    results.push(...batchResults);
    if (i + CONCURRENCY < refs.length) await sleep(DELAY_MS);
    process.stdout.write(`  ${Math.min(i + CONCURRENCY, refs.length)}/${refs.length}\r`);
  }
  console.log();
  return results;
}

async function writeData(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  console.log(`Wrote ${filePath} (${Array.isArray(data) ? data.length : Object.keys(data).length} entries)`);
}

// --- Classes & Races: list endpoint already gives {index, name} which
//     is exactly the {value, label} shape schema.js expects. -------------

async function fetchSimpleOptionList(apiBase, resource, edition) {
  console.log(`Fetching ${edition} ${resource}...`);
  const { results } = await fetchJson(`${apiBase}/${resource}`);
  return results
    .map((r) => ({ value: r.index, label: r.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// --- Spells: pull full detail per spell (level, school, description, etc). ---

async function fetchSpells(apiBase, edition) {
  console.log(`Fetching ${edition} spell list...`);
  const { results } = await fetchJson(`${apiBase}/spells`);
  console.log(`Fetching detail for ${results.length} spells (this takes a minute)...`);
  return fetchDetails(results, (spell) => ({
    index: spell.index,
    name: spell.name,
    level: spell.level, // 0 = cantrip
    school: spell.school?.name ?? "",
    castingTime: spell.casting_time,
    range: spell.range,
    components: spell.components,
    duration: spell.duration,
    concentration: spell.concentration,
    ritual: spell.ritual,
    classes: (spell.classes || []).map((c) => c.name),
    description: (spell.desc || []).join("\n\n"),
  }));
}

// --- Equipment: pull full detail per item (cost, weight, category). ---------

async function fetchEquipment(apiBase, edition) {
  console.log(`Fetching ${edition} equipment list...`);
  const { results } = await fetchJson(`${apiBase}/equipment`);
  console.log(`Fetching detail for ${results.length} items...`);
  return fetchDetails(results, (item) => ({
    index: item.index,
    name: item.name,
    category: item.equipment_category?.name ?? "",
    cost: item.cost ? `${item.cost.quantity} ${item.cost.unit}` : "",
    weight: item.weight ?? null,
    description: (item.desc || []).join("\n\n"),
  }));
}

// --- Class features: per-class, per-level feature grants (e.g. Barbarian
//     level 1 -> Rage, Unarmored Defense). Written as data/class-features.json,
//     keyed by class index, so it can be merged into a class's bundle
//     (default-bundles/classes.json) as level-gated grants alongside the
//     existing statModifiers/dropdownAccess. --------------------------------

/** Cache feature detail fetches — a handful of features (e.g. Extra Attack)
 *  are shared across classes/subclasses, no need to fetch them twice. */
const featureDetailCache = new Map();

async function fetchFeatureDescription(apiBase, index) {
  const key = `${apiBase}:${index}`;
  if (featureDetailCache.has(key)) return featureDetailCache.get(key);
  const detail = await fetchJson(`${apiBase}/features/${index}`);
  const description = (detail.desc || []).join("\n\n");
  featureDetailCache.set(key, description);
  return description;
}

async function fetch2014ClassFeatures() {
  console.log("Fetching 2014 class list for features...");
  const { results: classList } = await fetchJson(`${API_BASE_2014}/classes`);
  const byClass = {};

  for (const classRef of classList) {
    console.log(`Fetching ${classRef.name} levels...`);
    const levels = await fetchJson(`https://www.dnd5eapi.co${classRef.url}/levels`);
    // The levels endpoint mixes base-class level entries with subclass-gated
    // ones for the same level number (a subclass entry carries a truthy
    // "subclass" field) — only base-class features belong in this file.
    const baseLevels = levels.filter((lvl) => !lvl.subclass);

    const entries = [];
    for (const lvl of baseLevels) {
      for (const feature of lvl.features || []) {
        const description = await fetchFeatureDescription(API_BASE_2014, feature.index);
        entries.push({ level: lvl.level, name: feature.name, description });
        await sleep(DELAY_MS);
      }
    }
    byClass[classRef.index] = entries;
    console.log(`  ${entries.length} features across ${baseLevels.length} levels`);
  }

  return byClass;
}

/** The 2024 API exposes a feature's class and level on the feature itself.
 *  Its advertised /classes/{id}/levels route is not currently available,
 *  so build the same class-indexed output from that canonical source. */
async function fetch2024Features() {
  console.log("Fetching 2024 feature list...");
  const { results } = await fetchJson(`${API_BASE_2024}/features`);
  console.log(`Fetching detail for ${results.length} 2024 features...`);
  const all = await fetchDetails(results, (feature) => feature);
  const byClass = {};
  all.forEach((feature) => {
    // Subclass features belong in the raw features file. The class-feature
    // map intentionally mirrors the 2014 file by including base classes only.
    if (!feature.class || feature.subclass) return;
    const levelMatch = feature.level?.url?.match(/\/levels\/(\d+)$/);
    const level = levelMatch ? Number(levelMatch[1]) : null;
    if (!Number.isInteger(level)) return;
    const classIndex = feature.class.index;
    if (!byClass[classIndex]) byClass[classIndex] = [];
    byClass[classIndex].push({
      level,
      name: feature.name,
      description: feature.description || "",
    });
  });
  Object.values(byClass).forEach((features) => features.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)));
  return { all, byClass };
}

/** Fetch the full objects for a 2024 resource whose list endpoint only
 *  carries identifiers. Keeping these raw preserves source details for a
 *  later content-to-bundle converter without baking assumptions into this
 *  download script. */
async function fetchRawResource(apiBase, resource, edition) {
  console.log(`Fetching ${edition} ${resource}...`);
  const { results } = await fetchJson(`${apiBase}/${resource}`);
  console.log(`Fetching detail for ${results.length} ${edition} ${resource}...`);
  return fetchDetails(results, (entry) => entry);
}

// --- Feats: 2024/5.5e only (see API_BASE_2024 comment above). Written
//     wholesale, mostly unfiltered — unlike spells/equipment above, this
//     is the first time this project has looked at what the API's feat
//     shape actually contains, so it's worth seeing the real thing
//     (prerequisites, category, benefits — whatever's actually there)
//     before deciding what to keep and how it should map onto a
//     structured "effects" schema. Trim this down once that's settled;
//     for now, more data beats a premature guess at the right shape. ---

async function fetchFeats() {
  console.log("Fetching feat list (2024/5.5e)...");
  const { results } = await fetchJson(`${API_BASE_2024}/feats`);
  console.log(`Fetching detail for ${results.length} feats...`);
  return fetchDetails(results, (feat) => feat);
}

// --- Backgrounds: not exposed by this API. Seed with the standard SRD list. -

const SRD_BACKGROUNDS = [
  { value: "acolyte", label: "Acolyte" },
  { value: "charlatan", label: "Charlatan" },
  { value: "criminal", label: "Criminal" },
  { value: "entertainer", label: "Entertainer" },
  { value: "folk-hero", label: "Folk Hero" },
  { value: "guild-artisan", label: "Guild Artisan" },
  { value: "hermit", label: "Hermit" },
  { value: "noble", label: "Noble" },
  { value: "outlander", label: "Outlander" },
  { value: "sage", label: "Sage" },
  { value: "sailor", label: "Sailor" },
  { value: "soldier", label: "Soldier" },
  { value: "urchin", label: "Urchin" },
];

// --- Main -------------------------------------------------------------------

async function main() {
  await mkdir(DATA_DIR, { recursive: true });

  const classes = await fetchSimpleOptionList(API_BASE_2014, "classes", "2014");
  await writeData("classes.json", classes);

  const races = await fetchSimpleOptionList(API_BASE_2014, "races", "2014");
  await writeData("races.json", races);

  await writeData("backgrounds.json", SRD_BACKGROUNDS);

  const spells = await fetchSpells(API_BASE_2014, "2014");
  await writeData("spells.json", spells);

  const equipment = await fetchEquipment(API_BASE_2014, "2014");
  await writeData("equipment.json", equipment);

  const classFeatures = await fetch2014ClassFeatures();
  await writeData("class-features.json", classFeatures);

  const classes2024 = await fetchRawResource(API_BASE_2024, "classes", "2024");
  await writeData("classes-2024.json", classes2024);

  const species2024 = await fetchRawResource(API_BASE_2024, "species", "2024");
  await writeData("species-2024.json", species2024);

  const backgrounds2024 = await fetchRawResource(API_BASE_2024, "backgrounds", "2024");
  await writeData("backgrounds-2024.json", backgrounds2024);

  const equipment2024 = await fetchEquipment(API_BASE_2024, "2024");
  await writeData("equipment-2024.json", equipment2024);

  const { all: features2024, byClass: classFeatures2024 } = await fetch2024Features();
  await writeData("features-2024.json", features2024);
  await writeData("class-features-2024.json", classFeatures2024);

  const feats2024 = await fetchFeats();
  await writeData("feats-2024.json", feats2024);

  console.log("The API currently has no /api/2024/spells endpoint; spells.json remains the 2014 SRD list.");

  console.log("\nDone. Re-run any time to refresh from the live API.");
}

main().catch((err) => {
  console.error("Fetch failed:", err);
  process.exit(1);
});

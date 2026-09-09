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

const API_BASE = "https://www.dnd5eapi.co/api/2014";
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

async function fetchSimpleOptionList(resource) {
  console.log(`Fetching ${resource}...`);
  const { results } = await fetchJson(`${API_BASE}/${resource}`);
  return results
    .map((r) => ({ value: r.index, label: r.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// --- Spells: pull full detail per spell (level, school, description, etc). ---

async function fetchSpells() {
  console.log("Fetching spell list...");
  const { results } = await fetchJson(`${API_BASE}/spells`);
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

async function fetchEquipment() {
  console.log("Fetching equipment list...");
  const { results } = await fetchJson(`${API_BASE}/equipment`);
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

async function fetchFeatureDescription(index) {
  if (featureDetailCache.has(index)) return featureDetailCache.get(index);
  const detail = await fetchJson(`${API_BASE}/features/${index}`);
  const description = (detail.desc || []).join("\n\n");
  featureDetailCache.set(index, description);
  return description;
}

async function fetchClassFeatures() {
  console.log("Fetching class list for features...");
  const { results: classList } = await fetchJson(`${API_BASE}/classes`);
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
        const description = await fetchFeatureDescription(feature.index);
        entries.push({ level: lvl.level, name: feature.name, description });
        await sleep(DELAY_MS);
      }
    }
    byClass[classRef.index] = entries;
    console.log(`  ${entries.length} features across ${baseLevels.length} levels`);
  }

  return byClass;
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

  const classes = await fetchSimpleOptionList("classes");
  await writeData("classes.json", classes);

  const races = await fetchSimpleOptionList("races");
  await writeData("races.json", races);

  await writeData("backgrounds.json", SRD_BACKGROUNDS);

  const spells = await fetchSpells();
  await writeData("spells.json", spells);

  const equipment = await fetchEquipment();
  await writeData("equipment.json", equipment);

  const classFeatures = await fetchClassFeatures();
  await writeData("class-features.json", classFeatures);

  console.log("\nDone. Re-run any time to refresh from the live API.");
}

main().catch((err) => {
  console.error("Fetch failed:", err);
  process.exit(1);
});

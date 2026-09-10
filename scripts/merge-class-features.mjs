#!/usr/bin/env node
// scripts/merge-class-features.mjs
//
// Merges data/class-features.json (written by fetch-srd-data.mjs) into
// default-bundles/classes.json as each class's featureGrants — the
// level-gated feature grants the "Feature List" field type reads (see
// collectGrantedFeatures in customSheet.js). Run this any time after
// re-running fetch-srd-data.mjs to refresh feature text from the API.
//
// Usage:
//   node scripts/merge-class-features.mjs
//
// This REPLACES each class's featureGrants wholesale with the fetched
// data (rather than appending) — it's meant to be safe to re-run, and
// the two placeholder classes with hand-written test featureGrants
// (Barbarian, Wizard) will be overwritten with the real SRD text the
// first time this runs. No dependencies beyond Node 18+.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const BUNDLES_DIR = path.join(__dirname, "..", "default-bundles");

const FEATURES_PATH = path.join(DATA_DIR, "class-features.json");
const CLASSES_PATH = path.join(BUNDLES_DIR, "classes.json");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

/** classes.json entries use a display name ("Barbarian"); class-features.json
 *  is keyed by the SRD API's index slug ("barbarian") — every SRD class
 *  index happens to just be the lowercased name (no multi-word classes
 *  in the 2014 SRD), so a straight lowercase is enough. If that ever
 *  stops being true for a homebrew class you add by hand, this lookup
 *  will just quietly find nothing for it (see the warning below) rather
 *  than guess wrong. */
function slugFor(className) {
  return className.toLowerCase();
}

async function main() {
  console.log("Reading class-features.json and classes.json...");
  const [featuresByClass, classes] = await Promise.all([
    readJson(FEATURES_PATH),
    readJson(CLASSES_PATH),
  ]);

  let updated = 0;
  const missing = [];

  for (const classEntry of classes) {
    const slug = slugFor(classEntry.name);
    const fetched = featuresByClass[slug];
    if (!fetched) {
      missing.push(classEntry.name);
      continue;
    }

    classEntry.featureGrants = fetched.map((f, i) => ({
      id: `${slug}-feature-${i}`,
      name: f.name,
      description: f.description,
      minLevel: f.level,
    }));
    updated++;
  }

  await writeFile(CLASSES_PATH, JSON.stringify(classes, null, 2) + "\n", "utf8");

  console.log(`Merged featureGrants into ${updated} of ${classes.length} classes.`);
  if (missing.length) {
    console.log(`No fetched features found for: ${missing.join(", ")} — left as-is.`);
    console.log("(Homebrew classes with no SRD entry are expected here; anything else, re-check fetch-srd-data.mjs's output.)");
  }
  console.log(`Wrote ${CLASSES_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

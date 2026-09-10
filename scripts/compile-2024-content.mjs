#!/usr/bin/env node
// scripts/compile-2024-content.mjs
//
// Compiles the raw 2024/5.5e SRD JSON in /data/*-2024.json into the same
// hand-authored bundle-library / catalog shapes the app already consumes
// (see default-bundles/README.md and default-catalogs/README.md) — the
// same role fetch-srd-data.mjs + merge-class-features.mjs play for the
// 2014 pack, just pointed at the 2024 files and covering a bit more
// ground (2024 moved ability-score bonuses from Species to Background,
// and added Feats as real SRD content).
//
// Usage:
//   node scripts/compile-2024-content.mjs
//
// Writes:
//   default-bundles/classes-2024.json
//   default-bundles/species-2024.json
//   default-bundles/backgrounds-2024.json
//   default-catalogs/feats-2024.json
//
// None of these are loaded automatically at runtime — same as every
// other file in default-bundles/ and default-catalogs/, they're meant
// to be pasted into the in-app importer (Bundle Libraries / Catalogs
// manager). See this repo's default-bundles/README.md for the import +
// attach steps.
//
// What this script does NOT attempt (the "small explicit mapping" the
// SRD text can't give us automatically — same class of gap the 2014
// pipeline already leaves for skill choices):
//   - Class skill-proficiency CHOICES (still "choose 2 from this list")
//   - Feat *effects* as statModifiers/resourceGrants — feats import as
//     browsable reference text only, exactly like default-catalogs/feats.json
//     already does for the 2014 set, for the same reason given in that
//     file's README entry (most feat effects aren't a single stat bonus
//     a bundle can express, and feats aren't a fixed one-pick dropdown
//     the way Race/Background/Class are).
//   - Species traits as mechanical effects — the SRD API gives trait
//     *names* only (no description text for individual traits), so
//     they import as featureGrants with an empty description. Fill
//     those in by hand from the rulebook if you want the Feature List
//     entry to say more than the trait's name.
//
// No dependencies beyond Node 18+ (built-in fs/promises).

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const BUNDLES_DIR = path.join(ROOT, "default-bundles");
const CATALOGS_DIR = path.join(ROOT, "default-catalogs");

const ABILITY_FULL = {
  str: "Strength", dex: "Dexterity", con: "Constitution",
  int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};

function abilityFullName(shortNameOrIndex) {
  const key = shortNameOrIndex.toLowerCase();
  return ABILITY_FULL[key] || shortNameOrIndex;
}

// Ability SCORE fields on the starter sheet are labeled by 3-letter
// abbreviation ("STR", "DEX", ...) — see blockModel.js's
// `ability.label.slice(0, 3).toUpperCase()` — distinct from the
// full-name Saving Throw proficiency checkboxes ("Strength", etc.)
// that abilityFullName() targets. Numeric ability-score bonuses (add)
// need this one; "grant a save proficiency" needs abilityFullName().
function abilityAbbrev(shortNameOrIndex) {
  return shortNameOrIndex.slice(0, 3).toUpperCase();
}

// "Skill: Insight" -> "Insight", "Tool: Thieves' Tools" -> "Thieves' Tools"
function stripProficiencyPrefix(name) {
  const match = name.match(/^(Skill|Tool|Armor|Weapon|Saving Throw): (.+)$/);
  return match ? match[2] : name;
}

let idCounter = 0;
function shortId(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter.toString(16).padStart(6, "0")}`;
}

async function readJson(filename) {
  return JSON.parse(await readFile(path.join(DATA_DIR, filename), "utf8"));
}

async function writeBundle(filename, data) {
  const filePath = path.join(BUNDLES_DIR, filename);
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`Wrote ${filePath} (${data.length} entries)`);
}

async function writeCatalog(filename, data) {
  const filePath = path.join(CATALOGS_DIR, filename);
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`Wrote ${filePath}`);
}

// --- Classes: saving-throw proficiencies + subclass dropdown filter +
//     level-gated feature text. Mirrors what merge-class-features.mjs
//     already does for the 2014 pack, just sourced from the 2024 files
//     and folded into one pass since both inputs are already in the
//     shape the bundle expects. ---------------------------------------

// --- Class skill-proficiency choices ("choose 2 from this list") ---
//
// classes-2024.json's `proficiency_choices` already has exactly what a
// choiceGroup needs (a count + a flat option list) for the common case:
// a plain "pick N skills" choice, expressed as `option_type: "reference"`
// entries all named "Skill: X". Anything else in that field — nested
// "choice" options (Monk's second entry), or a list that isn't skills at
// all (Bard's "3 musical instruments") — has no matching field on the
// starter sheet to grant against, so those are skipped rather than
// guessed at; they still show up as free text via the existing
// "Skill Proficiencies Gained" field on the Leveling tab, same as before
// this script existed.
function skillChoiceGroups(cls) {
  return (cls.proficiency_choices || [])
    .map((pc, index) => {
      const options = pc.from?.options || [];
      const allSkills = options.length > 0 && options.every((o) => (
        o.option_type === "reference" && o.item?.name?.startsWith("Skill: ")
      ));
      if (!allSkills) return null;
      return {
        id: `${cls.index}-2024-skills-${index}`,
        label: "Skill Proficiencies",
        minLevel: 1,
        minSelections: pc.choose,
        maxSelections: pc.choose,
        options: options.map((o) => {
          const skillName = stripProficiencyPrefix(o.item.name);
          return {
            id: `${cls.index}-2024-skill-${o.item.index}`,
            name: skillName,
            description: "",
            statModifiers: [{
              id: shortId("mod"), targetFieldId: null, targetFieldName: skillName,
              op: "grant", value: null, minLevel: null,
            }],
            featureGrants: [],
            resourceGrants: [],
          };
        }),
      };
    })
    .filter(Boolean);
}

async function compileClasses() {
  const classes = await readJson("classes-2024.json");
  const featuresByClass = await readJson("class-features-2024.json");

  return classes.map((cls) => {
    const slug = cls.index;
    const statModifiers = (cls.saving_throws || []).map((save) => ({
      id: shortId("mod"),
      targetFieldName: abilityFullName(save.name),
      op: "grant",
      value: null,
      minLevel: null,
    }));

    const dropdownAccess = (cls.subclasses || []).length
      ? [{
        id: shortId("acc"),
        targetFieldName: "Subclass",
        // Every 2024 class grants its subclass at level 3 — see
        // features-2024.json, where every class's "<Class> Subclass"
        // feature sits at level 3 (unlike 2014, where it varied per
        // class from level 1 to level 3).
        allowedChoiceNames: cls.subclasses.map((s) => s.name),
        minLevel: null,
      }]
      : [];

    const fetched = featuresByClass[slug] || [];
    const featureGrants = fetched.map((f, i) => ({
      id: `${slug}-2024-feature-${i}`,
      name: f.name,
      description: f.description,
      minLevel: f.level,
    }));

    return {
      name: `${cls.name} (2024)`,
      category: "Class",
      statModifiers,
      dropdownAccess,
      featureGrants,
      resourceGrants: [],
      choiceGroups: skillChoiceGroups(cls),
    };
  });
}

// --- Species: 2024 species don't grant ability-score bonuses (that
//     moved to Background) — they grant traits instead. The SRD API
//     only gives trait names, not descriptions, so these come through
//     as featureGrants with an empty description; see the file-level
//     comment above. Size/speed are folded in as their own feature
//     line since they're genuinely useful at a glance and the API does
//     give us that much. ------------------------------------------------

async function compileSpecies() {
  const species = await readJson("species-2024.json");

  return species.map((sp) => {
    const featureGrants = [
      {
        id: shortId("feat"),
        name: "Size & Speed",
        description: `${sp.size}, ${sp.speed} ft. speed.`,
        minLevel: null,
      },
      ...(sp.traits || []).map((trait) => ({
        id: shortId("feat"),
        name: trait.name,
        description: "",
        minLevel: null,
      })),
    ];

    return {
      name: `${sp.name} (2024)`,
      // Targets the sheet's "Race" dropdown — the starter layout has no
      // separate "Species" field, and 2024's "species" is 2014's "race"
      // under a renamed label, so this reuses the same attach point.
      category: "Race",
      statModifiers: [],
      dropdownAccess: [],
      featureGrants,
      resourceGrants: [],
      choiceGroups: [],
    };
  });
}

// --- Backgrounds: fixed skill proficiencies (statModifiers, same as
//     the 2014 pack), a granted origin feat (featureGrant, text copied
//     from feats-2024.json), a tool proficiency (featureGrant — no
//     per-tool checkbox exists on the starter sheet to "grant" against),
//     and — new in 2024 — a real ability-score CHOICE (+2/+1 split or
//     +1/+1/+1 across the background's three listed abilities). Unlike
//     2014's Half-Elf gap (a bonus that couldn't be expressed and was
//     just left out), the bundle format's choiceGroups can express this
//     one exactly, so it's included as a genuine choice rather than a
//     partial guess. ----------------------------------------------------

// `abilities` is [{ full: "Intelligence", abbr: "INT" }, ...] — full
// name for readable option labels, abbreviation for the actual
// targetFieldName (ability-score fields are labeled "INT" etc., see
// abilityAbbrev() above).
function abilityChoiceGroup(abilities, idPrefix) {
  const options = [];
  for (let i = 0; i < abilities.length; i++) {
    for (let j = 0; j < abilities.length; j++) {
      if (i === j) continue;
      const plusTwo = abilities[i];
      const plusOne = abilities[j];
      options.push({
        id: `${idPrefix}-plus2-${plusTwo.abbr.toLowerCase()}-plus1-${plusOne.abbr.toLowerCase()}`,
        name: `+2 ${plusTwo.full}, +1 ${plusOne.full}`,
        description: "",
        statModifiers: [
          { id: shortId("mod"), targetFieldId: null, targetFieldName: plusTwo.abbr, op: "add", value: 2, minLevel: null },
          { id: shortId("mod"), targetFieldId: null, targetFieldName: plusOne.abbr, op: "add", value: 1, minLevel: null },
        ],
        featureGrants: [],
        resourceGrants: [],
      });
    }
  }
  options.push({
    id: `${idPrefix}-plus1-each`,
    name: `+1 ${abilities.map((a) => a.full).join(", +1 ")}`,
    description: "",
    statModifiers: abilities.map((a) => (
      { id: shortId("mod"), targetFieldId: null, targetFieldName: a.abbr, op: "add", value: 1, minLevel: null }
    )),
    featureGrants: [],
    resourceGrants: [],
  });
  return {
    id: `${idPrefix}-asi`,
    label: "Ability Score Improvement",
    minLevel: 1,
    minSelections: 1,
    maxSelections: 1,
    options,
  };
}

async function compileBackgrounds() {
  const backgrounds = await readJson("backgrounds-2024.json");
  const feats = await readJson("feats-2024.json");
  const featByName = new Map(feats.map((f) => [f.name.toLowerCase(), f]));

  return backgrounds.map((bg) => {
    const statModifiers = [];
    const featureGrants = [];

    (bg.proficiencies || []).forEach((prof) => {
      if (prof.name.startsWith("Skill: ")) {
        statModifiers.push({
          id: shortId("mod"),
          targetFieldName: stripProficiencyPrefix(prof.name),
          op: "grant",
          value: null,
          minLevel: null,
        });
      } else {
        // Tool/armor/weapon proficiencies: no matching checkbox exists
        // on the starter sheet, so these land as a display-only feature
        // rather than a silently-unmatched statModifier.
        featureGrants.push({
          id: shortId("feat"),
          name: "Tool Proficiency",
          description: stripProficiencyPrefix(prof.name),
          minLevel: null,
        });
      }
    });

    if (bg.feat) {
      const matched = featByName.get(bg.feat.name.toLowerCase());
      featureGrants.push({
        id: shortId("feat"),
        name: bg.feat.note ? `${bg.feat.name} (${bg.feat.note})` : bg.feat.name,
        description: matched ? matched.description : "",
        minLevel: null,
      });
    }

    const abilities = (bg.ability_scores || []).map((a) => (
      { full: abilityFullName(a.index), abbr: abilityAbbrev(a.index) }
    ));
    const choiceGroups = abilities.length === 3
      ? [abilityChoiceGroup(abilities, `${bg.index}-2024`)]
      : [];

    return {
      name: `${bg.name} (2024)`,
      category: "Background",
      statModifiers,
      dropdownAccess: [],
      featureGrants,
      resourceGrants: [],
      choiceGroups,
    };
  });
}

// --- Feats: browsable reference only, same treatment as
//     default-catalogs/feats.json gives the 2014 set (and for the same
//     reason — see that file's README entry). Prerequisite text is
//     assembled from the SRD's structured prerequisites object; the
//     "description" field is a short lead-in, and the full SRD text
//     goes in the "effect" field so nothing is lost even without a
//     hand-written flavor blurb. -----------------------------------------

function prereqText(prereq) {
  if (!prereq) return "—";
  const parts = [];
  if (Number.isFinite(prereq.minimum_level)) parts.push(`Level ${prereq.minimum_level}`);
  if (prereq.feature_named) parts.push(`Requires ${prereq.feature_named}`);
  return parts.length ? parts.join("; ") : "—";
}

function leadSentence(text) {
  const firstLine = (text || "").split("\n")[0];
  const match = firstLine.match(/^[^.]*\./);
  return (match ? match[0] : firstLine).trim();
}

async function compileFeatsCatalog() {
  const feats = await readJson("feats-2024.json");

  return {
    name: "Feats (2024)",
    archetype: {
      acquisitionCosts: [],
      requirements: [{ id: "prerequisite", label: "Prerequisite", kind: "text" }],
      effects: [{ id: "effect", label: "Effect", kind: "text" }],
    },
    tabs: [{
      id: "feats-2024",
      name: "Feats (2024)",
      archetypeDiff: {
        acquisitionCosts: { added: [], removed: [] },
        requirements: { added: [], removed: [] },
        effects: { added: [], removed: [] },
      },
      entries: feats.map((f) => ({
        id: null,
        name: f.name,
        description: leadSentence(f.description),
        imageData: null,
        archetypeDiff: {
          acquisitionCosts: { added: [], removed: [] },
          requirements: { added: [], removed: [] },
          effects: { added: [], removed: [] },
        },
        fieldValues: {
          prerequisite: prereqText(f.prerequisites),
          effect: f.repeatable ? `${f.description}\n\n${f.repeatable}` : f.description,
        },
      })),
    }],
  };
}

async function main() {
  const [classes, species, backgrounds, featsCatalog] = await Promise.all([
    compileClasses(),
    compileSpecies(),
    compileBackgrounds(),
    compileFeatsCatalog(),
  ]);

  await writeBundle("classes-2024.json", classes);
  await writeBundle("species-2024.json", species);
  await writeBundle("backgrounds-2024.json", backgrounds);
  await writeCatalog("feats-2024.json", featsCatalog);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

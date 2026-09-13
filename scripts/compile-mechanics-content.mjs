#!/usr/bin/env node
// scripts/compile-mechanics-content.mjs
//
// Compiles Shawn's hand-extracted "-mechanics.json" files (Schema.txt's
// Class/Background shape, plus a parallel typed-effects shape for
// Species/Race that Schema.txt doesn't itself document) into the same
// bundle-library JSON shape the app's Bundle Libraries importer already
// consumes (see default-bundles/README.md) — the same role
// compile-2024-content.mjs plays for the raw 2024 SRD dump, just pointed
// at a differently-shaped source.
//
// Usage:
//   node scripts/compile-mechanics-content.mjs
//
// Reads:
//   mechanics-source/classes-mechanics.json   (Schema.txt Class shape)
//   mechanics-source/races-mechanics.json     (typed-effects Species shape)
//
// Writes:
//   default-bundles/classes-from-mechanics.json
//   default-bundles/races-from-mechanics.json
//
//   default-bundles/backgrounds-from-mechanics.json
//
// What this script deliberately leaves as a documented gap (same spirit as
// compile-2024-content.mjs's own gap list — see that file's header comment):
//   - SUBCLASS / SKILL_EXPERTISE / SPELL_SELECT player_choices only carry an
//     `options_source` reference key (e.g. "barbarian_paths") in the source
//     data, not the actual option list — there's nothing here to build a
//     real choiceGroup or dropdownAccess rule FROM. These land as a
//     reference-only featureGrant instead of being silently dropped.
//   - Species ability-score bonuses using the free "+2/+1 to any two, or
//     +1 to any three" rule (`plus_2_plus_1_or_three_plus_1s`) can't be
//     expressed as a bundle — a bundle is a fixed set of modifiers, not a
//     player's free-form choice across all six abilities. Recorded as a
//     featureGrant note instead of a guess (same call the existing
//     Half-Elf/class-skill gaps in default-bundles/README.md make).
//   - Tool/weapon/armor proficiencies land as a featureGrant (display-only)
//     rather than a "grant" statModifier, because no per-tool/per-weapon
//     checkbox exists on the starter sheet to grant against — only skills
//     do. Same rule compile-2024-content.mjs already follows.
//
// No dependencies beyond Node 18+ (built-in fs/promises).

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SOURCE_DIR = path.join(ROOT, "mechanics-source");
const BUNDLES_DIR = path.join(ROOT, "default-bundles");

const ABILITY_FULL = {
  STR: "Strength", DEX: "Dexterity", CON: "Constitution",
  INT: "Intelligence", WIS: "Wisdom", CHA: "Charisma",
};
const ALL_ABBREVS = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];

let idCounter = 0;
function shortId(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter.toString(16).padStart(6, "0")}`;
}

function titleCase(raw) {
  return String(raw)
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

async function readJson(filename) {
  return JSON.parse(await readFile(path.join(SOURCE_DIR, filename), "utf8"));
}

async function writeBundle(filename, data) {
  const filePath = path.join(BUNDLES_DIR, filename);
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`Wrote ${filePath} (${data.length} entries)`);
}

function emptyOption(id, name) {
  return { id, name, description: "", statModifiers: [], featureGrants: [], resourceGrants: [] };
}

// ============================================================
// CLASSES
// ============================================================

// Every ability, "+2 to one" (6 options) plus every "+1/+1 to two
// different" pairing (15 options) — the actual 2014 ASI rule, expressed
// in full rather than left as a gap, since it applies to all six
// abilities uniformly (unlike a species/background bonus restricted to
// a named subset, which is what forces the gap treatment elsewhere in
// this file). A trailing "Feat" entry is a text-only placeholder — feat
// effects aren't in this mechanics file, so it names the option without
// mechanizing it (see default-catalogs/feats.json for the reference-text
// treatment feats already get elsewhere in this app).
function asiChoiceGroup(classId, level, index) {
  const idPrefix = `${classId}-asi-${level}-${index}`;
  const options = [];
  ALL_ABBREVS.forEach((ab) => {
    options.push({
      id: `${idPrefix}-plus2-${ab.toLowerCase()}`,
      name: `+2 ${ABILITY_FULL[ab]}`,
      description: "",
      statModifiers: [{ id: shortId("mod"), targetFieldId: null, targetFieldName: ab, op: "add", value: 2, minLevel: null }],
      featureGrants: [],
      resourceGrants: [],
    });
  });
  for (let i = 0; i < ALL_ABBREVS.length; i++) {
    for (let j = i + 1; j < ALL_ABBREVS.length; j++) {
      const a = ALL_ABBREVS[i], b = ALL_ABBREVS[j];
      options.push({
        id: `${idPrefix}-plus1-${a.toLowerCase()}-${b.toLowerCase()}`,
        name: `+1 ${ABILITY_FULL[a]}, +1 ${ABILITY_FULL[b]}`,
        description: "",
        statModifiers: [
          { id: shortId("mod"), targetFieldId: null, targetFieldName: a, op: "add", value: 1, minLevel: null },
          { id: shortId("mod"), targetFieldId: null, targetFieldName: b, op: "add", value: 1, minLevel: null },
        ],
        featureGrants: [],
        resourceGrants: [],
      });
    }
  }
  options.push(emptyOption(`${idPrefix}-feat`, "Feat (see Feats catalog)"));
  return {
    id: idPrefix,
    label: "Ability Score Improvement or Feat",
    minLevel: level,
    minSelections: 1,
    maxSelections: 1,
    options,
  };
}

function compileClass(cls) {
  const statModifiers = (cls.level_1_initialization?.proficiencies?.saving_throws || []).map((name) => ({
    id: shortId("mod"),
    targetFieldName: name,
    op: "grant",
    value: null,
    minLevel: null,
  }));

  const featureGrants = [];
  const choiceGroups = [];

  // Skill-choice ("choose 2 from this list") — same treatment
  // compile-2024-content.mjs's skillChoiceGroups() gives class skills:
  // a real choiceGroup with "grant" statModifiers, since skill checkboxes
  // (unlike tools/weapons/armor) DO exist on the starter sheet to grant
  // against.
  const skillChoice = cls.level_1_initialization?.proficiencies?.skills;
  if (skillChoice?.options?.length) {
    choiceGroups.push({
      id: `${cls.class_id}-skills`,
      label: "Skill Proficiencies",
      minLevel: 1,
      minSelections: skillChoice.choose_count || 1,
      maxSelections: skillChoice.choose_count || 1,
      options: skillChoice.options.map((skillName, i) => ({
        id: `${cls.class_id}-skill-${i}`,
        name: skillName,
        description: "",
        statModifiers: [{ id: shortId("mod"), targetFieldId: null, targetFieldName: skillName, op: "grant", value: null, minLevel: null }],
        featureGrants: [],
        resourceGrants: [],
      })),
    });
  }

  // Non-skill starting proficiencies (armor/weapons/tools): no matching
  // checkbox exists on the starter sheet, so these are a display-only
  // feature line rather than a silently-unmatched statModifier.
  const startProfs = cls.level_1_initialization?.proficiencies || {};
  const profLines = [];
  if (startProfs.armor?.length) profLines.push(`Armor: ${startProfs.armor.join(", ")}`);
  if (startProfs.weapons?.length) profLines.push(`Weapons: ${startProfs.weapons.join(", ")}`);
  if (startProfs.tools?.length) profLines.push(`Tools: ${startProfs.tools.join(", ")}`);
  if (profLines.length) {
    featureGrants.push({
      id: `${cls.class_id}-starting-proficiencies`,
      name: "Starting Proficiencies",
      description: profLines.join("\n"),
      minLevel: 1,
    });
  }
  featureGrants.push({
    id: `${cls.class_id}-hit-die`,
    name: "Hit Die & Hit Points",
    description: `Hit Die: d${cls.hit_die}. HP at 1st level: ${cls.level_1_initialization?.hp_at_1st_level || "—"}.`,
    minLevel: 1,
  });

  (cls.leveling_progression || []).forEach((lvl) => {
    (lvl.passive_grants || []).forEach((g) => {
      featureGrants.push({
        id: `${cls.class_id}-feature-${g.feature_id}`,
        name: g.name,
        description: g.description || "",
        minLevel: lvl.level,
      });
    });
    (lvl.player_choices || []).forEach((pc, i) => {
      if (pc.choice_type === "ABILITY_SCORE_IMPROVEMENT_OR_FEAT") {
        choiceGroups.push(asiChoiceGroup(cls.class_id, lvl.level, i));
      } else if (pc.choice_type === "FEATURE_SELECT" && Array.isArray(pc.options)) {
        // Named options (e.g. Fighting Style), but no per-option mechanical
        // text in this file — name-only picks, same gap as SUBCLASS below
        // but at least the pick list itself IS real, so it's a choiceGroup
        // rather than a plain featureGrant note.
        choiceGroups.push({
          id: `${cls.class_id}-${lvl.level}-choice-${i}`,
          label: pc.name,
          minLevel: lvl.level,
          minSelections: pc.count || 1,
          maxSelections: pc.count || 1,
          options: pc.options.map((optName, oi) => emptyOption(`${cls.class_id}-${lvl.level}-${i}-opt-${oi}`, optName)),
        });
      } else {
        // SUBCLASS / SKILL_EXPERTISE / SPELL_SELECT — options_source
        // points at a table this file doesn't include (see file header).
        const bits = [];
        if (pc.count) bits.push(`Choose ${pc.count}.`);
        if (pc.options_source) bits.push(`Reference table: ${pc.options_source}.`);
        featureGrants.push({
          id: `${cls.class_id}-${lvl.level}-choice-${i}`,
          name: pc.name,
          description: `Player choice (${pc.choice_type}) — options not included in the source mechanics file. ${bits.join(" ")}`.trim(),
          minLevel: lvl.level,
        });
      }
    });
  });

  return {
    name: cls.name,
    category: "Class",
    statModifiers,
    dropdownAccess: [],
    featureGrants,
    resourceGrants: [],
    choiceGroups,
  };
}

async function compileClasses() {
  const data = await readJson("classes-mechanics.json");
  return (data.classes || []).map(compileClass);
}

// ============================================================
// RACES / SPECIES
// ============================================================

// Turns one typed effect object into a human-readable line. Covers every
// effect `type` seen in races-mechanics.json; unrecognized types fall
// back to a compact JSON dump so nothing is silently lost.
function describeEffect(fx) {
  switch (fx.type) {
    case "UNARMED_STRIKE":
      return `Unarmed strike: ${fx.damage_dice} ${fx.damage_type} damage (${fx.stat}).`;
    case "GRANT_SPELL": {
      const freq = fx.frequency ? ` (${fx.frequency.replace(/_/g, " ")})` : "";
      const lvl = fx.min_level ? ` at level ${fx.min_level}` : "";
      return `Grants the ${titleCase(fx.spell_id)} spell${lvl}${freq}.`;
    }
    case "GRANT_CANTRIP":
      return `Grants the ${titleCase(fx.spell_id)} cantrip.`;
    case "HEAL_ACTION":
      return `Healing action: ${fx.dice_quantity}d${fx.dice_faces} HP${fx.frequency ? ` (${fx.frequency.replace(/_/g, " ")})` : ""}.`;
    case "AOE_SAVE_ON_TRANSFORM":
      return `${fx.radius_ft} ft. transformation: creatures fail a DC ${fx.dc} ${fx.save_type} save become ${fx.condition} for ${(fx.duration || "").replace(/_/g, " ")}.`;
    case "EXTRA_DAMAGE":
      return `Extra ${fx.damage_type} damage equal to ${fx.value} (${(fx.trigger || "").replace(/_/g, " ")}).`;
    case "AOE_END_OF_TURN_DAMAGE":
      return `${fx.radius_ft} ft. aura deals ${fx.value} ${fx.damage_type} damage at end of turn.`;
    case "GRANT_FLYING_SPEED":
      return `Grants a flying speed (${String(fx.value).replace(/_/g, " ")}).`;
    case "HOLD_BREATH":
      return `Can hold breath: ${fx.duration}.`;
    case "GRANT_FEAT":
      return `Grants ${fx.count || 1} feat(s) (see Feats catalog).`;
    case "GRANT_SENSE":
      return `${titleCase(fx.sense)} ${fx.range_ft} ft.`;
    case "GRANT_SKILL_PROFICIENCY":
      return `Grants proficiency in ${fx.count || 1} skill(s) of your choice.`;
    case "ALTER_APPEARANCE":
      return `Can alter its appearance (${(fx.action_cost || "").replace(/_/g, " ")}).`;
    case "AOE_ATTACK": {
      const scaling = fx.damage_scaling ? Object.entries(fx.damage_scaling).map(([lvl, dice]) => `${dice} at ${lvl}`).join(", ") : "";
      return `Area attack, DC ${fx.dc}${fx.frequency ? ` (${fx.frequency.replace(/_/g, " ")})` : ""}. Damage: ${scaling}.`;
    }
    case "GRANT_ADVANTAGE": {
      const on = fx.target ? String(fx.target).replace(/_/g, " ") : "certain rolls";
      const trig = fx.triggers ? ` (${Object.entries(fx.triggers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join("/") : v}`).join(", ")})` : "";
      return `Advantage on ${on}${trig}.`;
    }
    case "GRANT_DISADVANTAGE": {
      const on = Array.isArray(fx.target) ? fx.target.join(", ").replace(/_/g, " ") : String(fx.target || "").replace(/_/g, " ");
      return `Disadvantage on ${on}${fx.condition ? ` (${fx.condition.replace(/_/g, " ")})` : ""}.`;
    }
    case "DOUBLE_PROFICIENCY":
      return `Double proficiency bonus on ${(fx.skill || fx.target || "").replace(/_/g, " ")} checks${fx.condition ? ` (${fx.condition.replace(/_/g, " ")})` : ""}.`;
    case "MODIFY_HP_MAX":
      return `Max HP modifier: ${(fx.modifier || "").replace(/_/g, " ")}.`;
    case "REROLL_ON_NAT_1":
      return `Reroll a natural 1 on: ${(fx.applies_to || []).join(", ").replace(/_/g, " ")}.`;
    case "MOVE_THROUGH_LARGER_CREATURES":
      return "Can move through the space of any creature that is a size larger.";
    default:
      return JSON.stringify(fx);
  }
}

function abilityBonuses(bonuses, idPrefix) {
  const statModifiers = [];
  const choiceGroups = [];
  const gapNotes = [];
  (bonuses || []).forEach((b) => {
    if (b.type === "fixed") {
      statModifiers.push({ id: shortId("mod"), targetFieldName: b.ability, op: "add", value: b.value, minLevel: null });
    } else if (b.type === "choice") {
      if (Array.isArray(b.options)) {
        choiceGroups.push({
          id: `${idPrefix}-asi`,
          label: "Ability Score Bonus",
          minLevel: null,
          minSelections: b.count || 1,
          maxSelections: b.count || 1,
          options: b.options.map((ab) => ({
            id: `${idPrefix}-asi-${ab.toLowerCase()}`,
            name: `+${b.value} ${ABILITY_FULL[ab] || ab}`,
            description: "",
            statModifiers: [{ id: shortId("mod"), targetFieldId: null, targetFieldName: ab, op: "add", value: b.value, minLevel: null }],
            featureGrants: [],
            resourceGrants: [],
          })),
        });
      } else if (b.rule === "plus_2_plus_1_or_three_plus_1s") {
        // Free choice across all six abilities — a bundle can't express
        // "player's choice with no fixed subset" (same class of gap as
        // the 2014 Half-Elf entry in default-bundles/README.md). Recorded
        // as a note rather than guessed at.
        gapNotes.push("Ability Score Bonus: +2 to one ability and +1 to a different ability, OR +1 to three different abilities — your choice among all six. Apply manually to Ability Scores.");
      } else {
        gapNotes.push(`Ability Score Bonus: unrecognized rule (${JSON.stringify(b)}) — apply manually.`);
      }
    }
  });
  return { statModifiers, choiceGroups, gapNotes };
}

function proficiencyLines(mech) {
  const lines = [];
  if (mech.proficiencies?.weapons?.length) lines.push(`Weapons: ${mech.proficiencies.weapons.join(", ")}`);
  if (mech.proficiencies?.armor?.length) lines.push(`Armor: ${mech.proficiencies.armor.join(", ")}`);
  if (mech.proficiencies?.tools_choice) {
    const tc = mech.proficiencies.tools_choice;
    lines.push(`Tools: choose ${tc.count} of ${(tc.options || []).map(titleCase).join(", ")}`);
  }
  return lines;
}

function skillChoiceGroup(idPrefix, skillChoice) {
  if (!skillChoice?.options?.length) return null;
  return {
    id: `${idPrefix}-skills`,
    label: "Skill Proficiencies",
    minLevel: null,
    minSelections: skillChoice.count || 1,
    maxSelections: skillChoice.count || 1,
    options: skillChoice.options.map((skillName, i) => {
      const name = titleCase(skillName);
      return {
        id: `${idPrefix}-skill-${i}`,
        name,
        description: "",
        statModifiers: [{ id: shortId("mod"), targetFieldId: null, targetFieldName: name, op: "grant", value: null, minLevel: null }],
        featureGrants: [],
        resourceGrants: [],
      };
    }),
  };
}

// One feature entry -> zero-or-more featureGrants + zero-or-one choiceGroup.
function compileFeature(idPrefix, feature) {
  const featureGrants = [];
  const choiceGroups = [];

  if (feature.type === "choice_subfeature" && Array.isArray(feature.options)) {
    choiceGroups.push({
      id: `${idPrefix}-${feature.id}`,
      label: feature.name,
      minLevel: feature.min_level || null,
      minSelections: 1,
      maxSelections: 1,
      options: feature.options.map((opt, i) => {
        const lines = (opt.effects || []).map(describeEffect);
        return {
          id: `${idPrefix}-${feature.id}-${opt.id || i}`,
          name: opt.name || titleCase(opt.id || `option-${i}`),
          description: lines.join("\n"),
          statModifiers: [],
          featureGrants: [],
          resourceGrants: [],
        };
      }),
    });
  } else {
    const lines = (feature.effects || []).map(describeEffect);
    featureGrants.push({
      id: `${idPrefix}-${feature.id}`,
      name: feature.name,
      description: lines.join("\n"),
      minLevel: feature.min_level || null,
    });
  }
  return { featureGrants, choiceGroups };
}

// Builds one bundle entry for a species, OR a species+subrace pairing.
// `mech`/`features` are already the fully-merged view (base + subrace
// overrides applied) so this function itself doesn't need to know about
// subraces at all.
function compileSpeciesEntry(name, creatureType, mech, features) {
  const idPrefix = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const { statModifiers, choiceGroups, gapNotes } = abilityBonuses(mech.ability_score_bonuses, idPrefix);
  const featureGrants = [];

  featureGrants.push({
    id: `${idPrefix}-overview`,
    name: "Size & Speed",
    description: [
      `Creature Type: ${creatureType}`,
      `Size: ${(mech.size || []).join(" or ")}`,
      `Speed: ${Object.entries(mech.speed || {}).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    ].join("\n"),
    minLevel: null,
  });

  if (mech.senses?.length) {
    featureGrants.push({
      id: `${idPrefix}-senses`,
      name: "Senses",
      description: mech.senses.map((s) => `${titleCase(s.sense)} ${s.range_ft} ft.`).join("\n"),
      minLevel: null,
    });
  }
  if (mech.resistances?.length) {
    featureGrants.push({
      id: `${idPrefix}-resistances`,
      name: "Resistances",
      description: `Resistant to ${mech.resistances.join(", ")} damage.`,
      minLevel: null,
    });
  }
  if (mech.languages) {
    const known = mech.languages.known || [];
    const extra = mech.languages.choice_count ? `, plus ${mech.languages.choice_count} of your choice` : "";
    featureGrants.push({
      id: `${idPrefix}-languages`,
      name: "Languages",
      description: `${known.map(titleCase).join(", ")}${extra}`,
      minLevel: null,
    });
  }
  const profLines = proficiencyLines(mech);
  if (profLines.length) {
    featureGrants.push({ id: `${idPrefix}-proficiencies`, name: "Proficiencies", description: profLines.join("\n"), minLevel: null });
  }
  const skillGroup = skillChoiceGroup(idPrefix, mech.proficiencies?.skill_choice);
  if (skillGroup) choiceGroups.push(skillGroup);

  if (gapNotes.length) {
    featureGrants.push({ id: `${idPrefix}-asi-gap`, name: "Ability Score Bonus (manual)", description: gapNotes.join("\n"), minLevel: null });
  }

  (features || []).forEach((feature) => {
    const compiled = compileFeature(idPrefix, feature);
    featureGrants.push(...compiled.featureGrants);
    choiceGroups.push(...compiled.choiceGroups);
  });

  return {
    name,
    category: "Race",
    statModifiers,
    dropdownAccess: [],
    featureGrants,
    resourceGrants: [],
    choiceGroups,
  };
}

function mergeSubrace(baseMech, baseFeatures, sub) {
  const mech = {
    ...baseMech,
    ability_score_bonuses: [...(baseMech.ability_score_bonuses || []), ...(sub.ability_score_bonuses || [])],
    senses: sub.senses_override || baseMech.senses,
    proficiencies: sub.proficiencies
      ? { ...(baseMech.proficiencies || {}), ...sub.proficiencies }
      : baseMech.proficiencies,
  };
  const features = [...(baseFeatures || []), ...(sub.features || [])];
  return { mech, features };
}

async function compileRaces() {
  const species = await readJson("races-mechanics.json");
  const out = [];
  species.forEach((sp) => {
    out.push(compileSpeciesEntry(sp.name, sp.creature_type, sp.mechanics, sp.features));
    (sp.subraces || []).forEach((sub) => {
      const { mech, features } = mergeSubrace(sp.mechanics, sp.features, sub);
      out.push(compileSpeciesEntry(sub.name, sp.creature_type, mech, features));
    });
  });
  return out;
}

// ============================================================
// BACKGROUNDS
// ============================================================

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

// "Choose two from Deception, Insight, Persuasion, and Stealth" ->
// { count: 2, names: ["Deception","Insight","Persuasion","Stealth"] }.
// Returns null if the string isn't a recognizable "Choose N from ..."
// sentence, so callers can fall back to treating it as plain fixed text.
function parseChooseSentence(text) {
  const match = /^choose (\w+) from (.+)$/i.exec(text.trim());
  if (!match) return null;
  const count = NUMBER_WORDS[match[1].toLowerCase()];
  if (!count) return null;
  const names = match[2]
    .replace(/\band\b/gi, ",")
    .split(",")
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter(Boolean);
  return { count, names };
}

function compileBackground(bg) {
  const name = titleCase(bg.background_id.replace(/_/g, " "));
  const idPrefix = bg.background_id;
  const statModifiers = [];
  const choiceGroups = [];
  const featureGrants = [];

  // Skills: usually a fixed pair (statModifiers, "grant" op — real
  // checkboxes exist for these). Urban Bounty Hunter's single "Choose
  // two from ..." sentence instead becomes a real choiceGroups entry,
  // same treatment class/race skill choices get elsewhere in this file.
  const skills = bg.proficiencies?.skills || [];
  const chosen = skills.length === 1 ? parseChooseSentence(skills[0]) : null;
  if (chosen) {
    choiceGroups.push({
      id: `${idPrefix}-skills`,
      label: "Skill Proficiencies",
      minLevel: null,
      minSelections: chosen.count,
      maxSelections: chosen.count,
      options: chosen.names.map((skillName, i) => ({
        id: `${idPrefix}-skill-${i}`,
        name: skillName,
        description: "",
        statModifiers: [{ id: shortId("mod"), targetFieldId: null, targetFieldName: skillName, op: "grant", value: null, minLevel: null }],
        featureGrants: [],
        resourceGrants: [],
      })),
    });
  } else {
    skills.forEach((skillName) => {
      statModifiers.push({ id: shortId("mod"), targetFieldName: skillName, op: "grant", value: null, minLevel: null });
    });
  }

  // Tools and languages: no per-tool/per-language checkbox exists on the
  // starter sheet (same rule as class/race non-skill proficiencies), and
  // every entry here is already free text ("One type of artisan's
  // tools", "Two of your choice") rather than a fixed named item anyway
  // — so both land as reference featureGrants, not statModifiers.
  const tools = bg.proficiencies?.tools || [];
  if (tools.length) {
    featureGrants.push({ id: `${idPrefix}-tools`, name: "Tool Proficiencies", description: tools.join("\n"), minLevel: null });
  }
  const languages = bg.proficiencies?.languages || [];
  if (languages.length) {
    featureGrants.push({ id: `${idPrefix}-languages`, name: "Languages", description: languages.join("\n"), minLevel: null });
  }

  if (bg.equipment?.length) {
    featureGrants.push({ id: `${idPrefix}-equipment`, name: "Starting Equipment", description: bg.equipment.join("\n"), minLevel: null });
  }
  if (bg.feature) {
    featureGrants.push({ id: `${idPrefix}-feature`, name: bg.feature.name, description: bg.feature.description || "", minLevel: null });
  }

  return {
    name,
    category: "Background",
    statModifiers,
    dropdownAccess: [],
    featureGrants,
    resourceGrants: [],
    choiceGroups,
  };
}

async function compileBackgrounds() {
  const data = await readJson("backgrounds-mechanics.json");
  return data.map(compileBackground);
}

async function main() {
  const [classes, races, backgrounds] = await Promise.all([compileClasses(), compileRaces(), compileBackgrounds()]);
  await writeBundle("classes-from-mechanics.json", classes);
  await writeBundle("races-from-mechanics.json", races);
  await writeBundle("backgrounds-from-mechanics.json", backgrounds);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

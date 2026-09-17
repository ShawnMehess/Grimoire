#!/usr/bin/env node
// scripts/compile-foundry-feats.mjs
//
// Compiles the Foundry VTT feat export in `New Info/5e-feats.txt`
// (NDJSON, one feat object per line — the same "5e-complete" pack shape
// scripts/foundry_to_catalogs.py already handles) into the site's own
// bundle shape, so feats actually APPLY to the character object instead
// of living as reference text.
//
// Reads:
//   New Info/5e-feats.txt
//
// Writes:
//   js/data/featBundles.js   (FEAT_BUNDLES + FEAT_CATALOG + FEAT_NAMES)
//
// What gets linked to character-object fields ("where applicable"):
//   - Fixed +1 ability bonuses  -> { op: "add", targetFieldId: "<abl>Score" }
//   - "Increase STR or DEX / INT, WIS or CHA / any one ability" choices
//     -> choiceGroups whose options each grant the score bonus
//     (Resilient options also grant that ability's save proficiency).
//   - Skill proficiencies       -> { op: "grant", targetFieldId: "<skill>Prof" }
//     ("choose one / choose three" variants become choiceGroups.)
//   - Save proficiency          -> { op: "grant", targetFieldId: "<abl>SaveProf" }
//   - Light/Medium/Heavy armor, Shields, Firearms, Improvised Weapons,
//     Cook's Utensils, Poisoner's Kit, Sylvan
//     -> { op: "grantTag", targetFieldId: armorProf/weaponProf/toolProf/languages }
//   - Speed +10/+5 (Mobile, Squat Nimbleness)
//     -> { op: "add", targetFieldId: "speed" }          (new stable id)
//   - Initiative +5 (Alert)     -> { op: "add", targetFieldId: "initiative" }
//   - Passive Perception +5 (Observant)
//     -> { op: "add", targetFieldId: "passivePerception" }
//   - Limited-use feat pools (Luck Points, Misty Step, sorcery points,
//     superiority die, prof-scaled reactions/treats, …) -> resourceGrants,
//     which the Leveling tab's Feature Uses panel already tracks.
//   - Everything else (conditional toggles like GWM/Sharpshooter -5/+10,
//     reaction AC bonuses, alternate AC calculations, damage resistances,
//     granted spells, situational advantage) -> featureGrants text, so it
//     still shows in Features & Traits instead of being silently dropped.
//
// Deliberately NOT auto-applied (conditional — would be wrong as a flat
// bonus): Dual Wielder / Revenant Blade +1 AC (only while dual-wielding
// specific weapons), Shield Master dex-save bonus (only vs single-target
// effects, value is a Foundry @attribute reference), Dragon Hide base AC
// (an alternate calculation, not a bonus), GWM/Sharpshooter toggles
// (disabled effects in the source), Tough HP (scales per level — noted
// as text so it isn't frozen at a wrong flat number).
//
// Re-run after updating New Info/5e-feats.txt:
//   node scripts/compile-foundry-feats.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const INPUT = path.join(ROOT, "New Info", "5e-feats.txt");
const SPELLS_INPUT = path.join(ROOT, "New Info", "5e-spells.txt");
const OUTPUT = path.join(ROOT, "js", "data", "featBundles.js");

// --- Site vocabularies (must match js/data/blockModel.js + js/data/schema.js) ---
const ABILITIES = [
  { id: "str", label: "Strength" },
  { id: "dex", label: "Dexterity" },
  { id: "con", label: "Constitution" },
  { id: "int", label: "Intelligence" },
  { id: "wis", label: "Wisdom" },
  { id: "cha", label: "Charisma" },
];
const ABILITY_BY_LABEL = Object.fromEntries(ABILITIES.map((a) => [a.label.toLowerCase(), a.id]));
const SKILLS = [
  ["acrobatics", "Acrobatics"], ["animalHandling", "Animal Handling"],
  ["arcana", "Arcana"], ["athletics", "Athletics"],
  ["deception", "Deception"], ["history", "History"],
  ["insight", "Insight"], ["intimidation", "Intimidation"],
  ["investigation", "Investigation"], ["medicine", "Medicine"],
  ["nature", "Nature"], ["perception", "Perception"],
  ["performance", "Performance"], ["persuasion", "Persuasion"],
  ["religion", "Religion"], ["sleightOfHand", "Sleight of Hand"],
  ["stealth", "Stealth"], ["survival", "Survival"],
];
const LANGUAGES = [
  "Common", "Dwarvish", "Elvish", "Giant", "Gnomish", "Goblin", "Halfling", "Orc",
  "Abyssal", "Celestial", "Deep Speech", "Draconic", "Infernal", "Primordial", "Sylvan", "Undercommon",
];
const WEAPONS = [
  "Club", "Dagger", "Greatclub", "Handaxe", "Javelin", "Light Hammer", "Mace", "Quarterstaff",
  "Sickle", "Spear", "Light Crossbow", "Dart", "Shortbow", "Sling",
  "Battleaxe", "Flail", "Glaive", "Greataxe", "Greatsword", "Halberd", "Lance", "Longsword",
  "Maul", "Morningstar", "Pike", "Rapier", "Scimitar", "Shortsword", "Trident", "War Pick",
  "Warhammer", "Whip", "Blowgun", "Hand Crossbow", "Heavy Crossbow", "Longbow", "Net",
];
const TOOLS = [
  "Alchemist's Supplies", "Brewer's Supplies", "Calligrapher's Supplies", "Carpenter's Tools",
  "Cartographer's Tools", "Cobbler's Tools", "Cook's Utensils", "Glassblower's Tools",
  "Jeweler's Tools", "Leatherworker's Tools", "Mason's Tools", "Painter's Supplies",
  "Potter's Tools", "Smith's Tools", "Tinker's Tools", "Weaver's Tools", "Woodcarver's Tools",
  "Disguise Kit", "Forgery Kit", "Herbalism Kit", "Navigator's Tools", "Poisoner's Kit", "Thieves' Tools",
];

// --- Text cleaning (same conventions as scripts/foundry_to_catalogs.py) ---
function resolveRefs(text) {
  text = String(text || "").replace(/@(?:Compendium|UUID)\[[^\]]*\]\{([^}]*)\}/g, "$1");
  text = text.replace(/@(?:Compendium|UUID)\[[^\]]*\]/g, "");
  text = text.replace(/\[\[\/(?:gm)?roll\s+([^\]]+?)\]\]/g, "($1)");
  return text.replace(/[ \t]{2,}/g, " ");
}

function htmlToText(raw) {
  if (!raw) return "";
  let text = String(raw);
  // Secret GM asides stay — the site has no GM-only concept; keep them inline.
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

function slug(name) {
  return String(name || "feat").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "feat";
}

function getSystem(d) {
  return d.system || d.data || {};
}

// --- Foundry effects[].changes[] -> site statModifiers ---
// Returns { mods, notes } — notes are human lines for effects that are
// conditional/disabled/unmappable (kept as feature text, not flat bonuses).
function mapEffectChanges(feat) {
  const mods = [];
  const notes = [];
  const coveredAbilities = new Set();
  for (const effect of feat.effects || []) {
    const disabled = !!effect.disabled;
    for (const change of effect.changes || []) {
      const key = (change.key || "").trim();
      const rawValue = change.value;
      const num = typeof rawValue === "number" ? rawValue : Number.parseFloat(rawValue);
      const isNum = Number.isFinite(num);
      if (!key) continue;

      let m = /^system\.abilities\.([a-z]{3})\.value$/.exec(key);
      if (m) {
        if (disabled || !isNum) continue; // AutoCalc marker / empty draft value
        mods.push({ targetFieldId: `${m[1]}Score`, op: "add", value: num, minLevel: null });
        coveredAbilities.add(m[1]);
        continue;
      }
      if (key === "system.attributes.movement.walk") {
        if (disabled || !isNum) continue;
        mods.push({ targetFieldId: "speed", op: "add", value: num, minLevel: null });
        continue;
      }
      if (key === "system.skills.prc.bonuses.passive") {
        if (disabled || !isNum) continue;
        mods.push({ targetFieldId: "passivePerception", op: "add", value: num, minLevel: null });
        continue;
      }
      if (key === "system.skills.inv.bonuses.passive") {
        if (!disabled && isNum) notes.push(`+${num} bonus to passive Investigation (no passive-Investigation field on the sheet — tracked here).`);
        continue;
      }
      if (key === "system.traits.toolProf.value") {
        const v = String(rawValue || "").toLowerCase();
        const tool = v === "cook" ? "Cook's Utensils" : TOOLS.find((t) => t.toLowerCase() === v);
        if (tool && !disabled) mods.push({ targetFieldId: "toolProf", op: "grantTag", value: tool });
        continue;
      }
      if (key === "system.traits.weaponProf.custom") {
        if (rawValue && !disabled) mods.push({ targetFieldId: "weaponProf", op: "grantTag", value: String(rawValue) });
        continue;
      }
      if (key === "system.traits.armorProf.value") {
        const v = String(rawValue || "").toLowerCase();
        const armor = { lgt: "Light Armor", med: "Medium Armor", hvy: "Heavy Armor", shl: "Shields" }[v]
          || ["Light Armor", "Medium Armor", "Heavy Armor", "Shields"].find((a) => a.toLowerCase() === v);
        if (armor && !disabled) mods.push({ targetFieldId: "armorProf", op: "grantTag", value: armor });
        continue;
      }
      if (key === "system.traits.languages.value") {
        const lang = LANGUAGES.find((l) => l.toLowerCase() === String(rawValue || "").toLowerCase());
        if (lang && !disabled) mods.push({ targetFieldId: "languages", op: "grantTag", value: lang });
        continue;
      }
      if (key === "system.traits.dr.value") {
        if (rawValue) notes.push(`Resistance to ${rawValue} damage.`);
        continue;
      }
      if (key === "system.traits.dr.custom") {
        if (rawValue) notes.push(`Resistance to damage from ${rawValue}.`);
        continue;
      }
      if (key === "flags.dnd5e.initiativeAlert") {
        if (!disabled) {
          mods.push({ targetFieldId: "initiative", op: "add", value: 5, minLevel: null });
          notes.push("Can't be surprised while conscious; unseen attackers gain no advantage against you.");
        }
        continue;
      }
      if (key === "flags.dnd5e.elvenAccuracy") {
        if (!disabled) notes.push("Reroll one die when you have advantage on an attack using Dexterity, Intelligence, Wisdom, or Charisma.");
        continue;
      }
      // Situational toggles / alternate calculations / Foundry references:
      // kept as feature text (the description already states the rule).
      if (key === "system.bonuses.mwak.attack" || key === "system.bonuses.mwak.damage") continue;
      if (key === "system.attributes.ac.value" || key === "system.attributes.ac.bonus" || key === "system.attributes.ac.calc") continue;
      if (key === "system.abilities.dex.bonuses.save") continue;
      if (key === "system.abilities.dex.save") continue;
    }
  }
  return { mods, notes, coveredAbilities };
}

// --- Description parsing for what effects[] doesn't encode ---
function parseAbilityChoice(text) {
  // "Increase your Strength or Dexterity by 1" / "...Strength, Constitution, or Charisma…"
  // / "Increase your Intelligence score by 1" (fixed, single)
  const m = /Increase your ([^.]+?) (?:score )?by 1/i.exec(text);
  if (m) {
    const found = [...m[1].matchAll(/Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma/gi)]
      .map((x) => ABILITY_BY_LABEL[x[0].toLowerCase()]);
    if (found.length) return [...new Set(found)];
  }
  if (/Increase one ability score of your choice by 1/i.test(text)) {
    return ["str", "dex", "con", "int", "wis", "cha"];
  }
  if (/Choose one ability score/i.test(text) && /Increase the chosen ability score by 1/i.test(text)) {
    return ["str", "dex", "con", "int", "wis", "cha"];
  }
  return null;
}

function skillIdByName(name) {
  const norm = String(name || "").trim().toLowerCase();
  const hit = SKILLS.find(([, label]) => label.toLowerCase() === norm);
  return hit ? hit[0] : null;
}

function main() {
  return run().catch((err) => { console.error(err); process.exit(1); });
}

async function run() {
  const raw = await readFile(INPUT, "utf8");
  const byName = new Map(); // name -> feat (keep LAST: Shield Master drafts evolve; final one is correct)
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let feat;
    try { feat = JSON.parse(trimmed); } catch { continue; }
    if (!feat || feat.type !== "feat" || !feat.name) continue;
    byName.set(feat.name, feat);
  }

  // Spell id -> { name, level } from the Foundry spell export, so feat
  // @Compendium[....5e-spells.<id>]{Label} refs resolve to real spell
  // names (matching SPELL_CATALOG entries) instead of raw compendium
  // ids. Prefer the ref's own {Label}; fall back to this map. The
  // school/level lists below drive the "choose a spell" pickers
  // (Magic Initiate, Fey/Shadow Touched, Aberrant Dragonmark,
  // Artificer Initiate) — the source has no per-class spell lists, so
  // picks offer the full level-appropriate list, same permissiveness
  // as the wizard's own spell picker (which also doesn't enforce
  // class lists).
  const SCHOOL_FULL = { abj: "Abjuration", con: "Conjuration", div: "Divination", evo: "Evocation", enc: "Enchantment", ill: "Illusion", nec: "Necromancy", trs: "Transmutation" };
  const spellById = new Map();
  const spellsByLevel = new Map(); // level number -> [{ name, school }]
  try {
    for (const line of (await readFile(SPELLS_INPUT, "utf8")).split("\n")) {
      const t = line.trim();
      if (!t) continue;
      let s;
      try { s = JSON.parse(t); } catch { continue; }
      if (!s || !s._id || !s.name) continue;
      const sys = s.system || s.data || {};
      const levelRaw = +sys.level;
      const school = SCHOOL_FULL[sys.school] || null;
      spellById.set(s._id, { name: s.name, level: Number.isFinite(levelRaw) ? levelRaw : 0 });
      if (!Number.isFinite(levelRaw)) continue; // e.g. "Draconic Transformation (Breath Weapon)" — not a pickable spell
      const level = levelRaw;
      if (!spellsByLevel.has(level)) spellsByLevel.set(level, []);
      spellsByLevel.get(level).push({ name: s.name, school });
    }
    for (const list of spellsByLevel.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  } catch { /* spells file optional — labels still resolve */ }
  const unresolvedSpellIds = [];
  const spellsOfLevel = (level, schools = null) => {
    let list = spellsByLevel.get(level) || [];
    if (schools) {
      const want = new Set(schools);
      list = list.filter((s) => want.has(s.school));
    }
    return list.map((s) => s.name);
  };

  const bundles = [];
  const catalogEntries = [];

  for (const [name, feat] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const system = getSystem(feat);
    const rawDescription = (system.description || {}).value;
    const fullText = htmlToText(rawDescription);
if (!fullText) continue;
    
    let allMods; // computed below
    
    const id = slug(name);
    const { mods, notes, coveredAbilities } = mapEffectChanges(feat);
    const choiceGroups = [];
    const resourceGrants = [];
    const extraNotes = [...notes];

    // --- Ability score increase from prose (when effects[] lacks it) ---
    const abilityOpts = parseAbilityChoice(fullText);
    const needsAbility = abilityOpts && !abilityOpts.some((a) => coveredAbilities.has(a))
      && !mods.some((m) => /Score$/.test(m.targetFieldId || ""));
    if (needsAbility) {
      if (name === "Resilient") {
        // Each option bundles +1 to the score AND that ability's save proficiency.
        choiceGroups.push({
          id: `${id}-ability`,
          label: "Ability Score Increase",
          minLevel: null, minSelections: 1, maxSelections: 1,
          options: abilityOpts.map((a) => {
            const ability = ABILITIES.find((x) => x.id === a);
            return {
              id: `${id}-ability-${a}`, name: ability.label, description: "",
              statModifiers: [
                { targetFieldId: `${a}Score`, op: "add", value: 1, minLevel: null },
                { targetFieldId: `${a}SaveProf`, op: "grant", minLevel: null },
              ],
              featureGrants: [], resourceGrants: [],
            };
          }),
        });
      } else if (abilityOpts.length === 1) {
        mods.push({ targetFieldId: `${abilityOpts[0]}Score`, op: "add", value: 1, minLevel: null });
      } else {
        choiceGroups.push({
          id: `${id}-ability`,
          label: "Ability Score Increase",
          minLevel: null, minSelections: 1, maxSelections: 1,
          options: abilityOpts.map((a) => {
            const ability = ABILITIES.find((x) => x.id === a);
            return {
              id: `${id}-ability-${a}`, name: `+1 ${ability.label}`, description: "",
              statModifiers: [{ targetFieldId: `${a}Score`, op: "add", value: 1, minLevel: null }],
              featureGrants: [], resourceGrants: [],
            };
          }),
        });
      }
    }

    // --- Proficiencies / languages from prose (targeted, high-confidence only) ---
    const grantTag = (field, value) => {
      if (!mods.some((m) => m.op === "grantTag" && m.targetFieldId === field && m.value === value)) {
        mods.push({ targetFieldId: field, op: "grantTag", value });
      }
    };
    if (/gain proficiency with light armor/i.test(fullText)) grantTag("armorProf", "Light Armor");
    if (/gain proficiency with medium armor/i.test(fullText)) grantTag("armorProf", "Medium Armor");
    if (/gain proficiency with heavy armor/i.test(fullText)) grantTag("armorProf", "Heavy Armor");
    if (/medium armor and shields/i.test(fullText) || (/gain proficiency[^.]*shields/i.test(fullText) && /medium armor/i.test(fullText))) {
      grantTag("armorProf", "Shields");
    }
    if (/gain proficiency with firearms/i.test(fullText)) grantTag("weaponProf", "Firearms");
    if (/proficient with improvised weapons/i.test(fullText)) grantTag("weaponProf", "Improvised Weapons");
    if (/proficiency with the .?poisoner.?s kit/i.test(fullText)) grantTag("toolProf", "Poisoner's Kit");
    if (/proficiency with .?cook.?s utensils/i.test(fullText)) grantTag("toolProf", "Cook's Utensils");

    // --- Per-feat choice groups beyond abilities ---
    const skillOptions = (ids) => ids.map((sid) => {
      const label = SKILLS.find((s) => s[0] === sid)[1];
      return {
        id: `${id}-skill-${sid}`, name: label, description: "",
        statModifiers: [{ targetFieldId: `${sid}Prof`, op: "grant", minLevel: null }],
        featureGrants: [], resourceGrants: [],
      };
    });
    if (name === "Squat Nimbleness") {
      choiceGroups.push({
        id: `${id}-skill`, label: "Skill Proficiency", minLevel: null, minSelections: 1, maxSelections: 1,
        options: skillOptions(["acrobatics", "athletics"]),
      });
    }
    if (name === "Skilled") {
      choiceGroups.push({
        id: `${id}-skills`, label: "Skill Proficiencies", minLevel: null, minSelections: 3, maxSelections: 3,
        options: skillOptions(SKILLS.map((s) => s[0])),
      });
      extraNotes.push("Tools may be chosen instead of skills for any of the three picks — track tool picks on Tool Prof.");
    }
    if (name === "Skill Expert") {
      choiceGroups.push({
        id: `${id}-skill`, label: "Skill Proficiency", minLevel: null, minSelections: 1, maxSelections: 1,
        options: skillOptions(SKILLS.map((s) => s[0])),
      });
      extraNotes.push("Expertise: double your proficiency bonus for one proficient skill of your choice (no doubling mechanic on the sheet — applied as proficiency plus this note).");
    }
    if (name === "Prodigy") {
      choiceGroups.push({
        id: `${id}-skill`, label: "Skill Proficiency", minLevel: null, minSelections: 1, maxSelections: 1,
        options: skillOptions(SKILLS.map((s) => s[0])),
      });
      choiceGroups.push({
        id: `${id}-tool`, label: "Tool Proficiency", minLevel: null, minSelections: 1, maxSelections: 1,
        options: TOOLS.map((t) => ({
          id: `${id}-tool-${slug(t)}`, name: t, description: "",
          statModifiers: [{ targetFieldId: "toolProf", op: "grantTag", value: t }],
          featureGrants: [], resourceGrants: [],
        })),
      });
      choiceGroups.push({
        id: `${id}-language`, label: "Language", minLevel: null, minSelections: 1, maxSelections: 1,
        options: LANGUAGES.map((l) => ({
          id: `${id}-lang-${slug(l)}`, name: l, description: "",
          statModifiers: [{ targetFieldId: "languages", op: "grantTag", value: l }],
          featureGrants: [], resourceGrants: [],
        })),
      });
      extraNotes.push("Expertise: double your proficiency bonus for one proficient skill of your choice (tracked here as proficiency plus this note).");
    }
    if (name === "Linguist") {
      choiceGroups.push({
        id: `${id}-languages`, label: "Languages", minLevel: null, minSelections: 3, maxSelections: 3,
        options: LANGUAGES.map((l) => ({
          id: `${id}-lang-${slug(l)}`, name: l, description: "",
          statModifiers: [{ targetFieldId: "languages", op: "grantTag", value: l }],
          featureGrants: [], resourceGrants: [],
        })),
      });
    }
    if (name === "Weapon Master") {
      choiceGroups.push({
        id: `${id}-weapons`, label: "Weapon Proficiencies", minLevel: null, minSelections: 4, maxSelections: 4,
        options: WEAPONS.map((w) => ({
          id: `${id}-weapon-${slug(w)}`, name: w, description: "",
          statModifiers: [{ targetFieldId: "weaponProf", op: "grantTag", value: w }],
          featureGrants: [], resourceGrants: [],
        })),
      });
    }

    // --- "Choose a spell" pickers + prose-named fixed spells ---
    // Labels deliberately contain "spell"/"cantrip" so these land on
    // the wizard's Spells page (see categorizeChoiceGroup). The source
    // has no per-class spell lists, so picks offer the full
    // level-appropriate list — same permissiveness as the wizard's own
    // spell picker, which also doesn't enforce class lists.
    const spellNameSet = new Set([...spellById.values()].map((s) => s.name));
    const spellPickGroup = (suffix, label, spellNames, count) => {
      const unique = [...new Set(spellNames)].filter((s) => spellNameSet.has(s));
      if (!unique.length) {
        extraNotes.push(`${label}: no matching spells found in the compiled spell list — pick with your DM and track by hand.`);
        return;
      }
      choiceGroups.push({
        id: `${id}-${suffix}`, label, minLevel: null, minSelections: count, maxSelections: count,
        options: unique.map((spell) => ({
          id: `${id}-${suffix}-${slug(spell)}`, name: spell, description: "",
          statModifiers: [{ targetFieldId: "spellsKnown", op: "addItem", value: spell, minLevel: null }],
          featureGrants: [], resourceGrants: [],
        })),
      });
    };
    // Fixed spells named in prose without @refs (granted outright, so
    // they go straight into mods, not a picker). Name matching is
    // case-insensitive ("Pass Without Trace" vs "Pass without Trace")
    // but the stored value is always the catalog's canonical name.
    const grantNamedSpell = (spell) => {
      const canonical = [...spellNameSet].find((s) => s.toLowerCase() === spell.toLowerCase());
      if (!canonical) {
        extraNotes.push(`${spell} (granted by this feat) isn't in the compiled spell list — add it to Spells Known by hand.`);
        return;
      }
      if (!mods.some((m) => m.targetFieldId === "spellsKnown" && String(m.value).toLowerCase() === canonical.toLowerCase())) {
        mods.push({ targetFieldId: "spellsKnown", op: "addItem", value: canonical, minLevel: null });
      }
    };
    if (name === "Magic Initiate") {
      const classes = [
        ["Bard", "Charisma"], ["Cleric", "Wisdom"], ["Druid", "Wisdom"],
        ["Sorcerer", "Charisma"], ["Warlock", "Charisma"], ["Wizard", "Intelligence"],
      ];
      choiceGroups.push({
        id: `${id}-class`, label: "Choose a spellcasting class", minLevel: null, minSelections: 1, maxSelections: 1,
        options: classes.map(([cls, ability]) => ({
          id: `${id}-class-${slug(cls)}`, name: cls, description: "",
          statModifiers: [],
          featureGrants: [{ name: `${cls} spellcasting`, description: `Your spellcasting ability for this feat's spells is ${ability}. Pick your cantrips and 1st-level spell from that class's spell list (the full lists below — the compiled data has no per-class lists, so check the ${cls} list when choosing).`, minLevel: null }],
          resourceGrants: [],
        })),
      });
      spellPickGroup("cantrips", "Cantrips — pick 2 (spells)", spellsOfLevel(0), 2);
      spellPickGroup("spell", "1st-level spell — pick 1 (spells)", spellsOfLevel(1), 1);
    }
    if (name === "Fey Touched") {
      spellPickGroup("spell", "1st-level divination or enchantment spell — pick 1 (spells)", spellsOfLevel(1, ["Divination", "Enchantment"]), 1);
      extraNotes.push("Your Fey Touched spells use the ability increased by this feat as their spellcasting ability.");
    }
    if (name === "Shadow Touched") {
      if (/invisibility/i.test(fullText)) grantNamedSpell("Invisibility");
      spellPickGroup("spell", "1st-level illusion or necromancy spell — pick 1 (spells)", spellsOfLevel(1, ["Illusion", "Necromancy"]), 1);
      extraNotes.push("Your Shadow Touched spells use the ability increased by this feat as their spellcasting ability.");
    }
    if (name === "Telekinetic") {
      if (/mage hand/i.test(fullText)) grantNamedSpell("Mage Hand");
    }
    if (name === "Aberrant Dragonmark") {
      spellPickGroup("cantrip", "Sorcerer cantrip — pick 1 (spells)", spellsOfLevel(0), 1);
      spellPickGroup("spell", "1st-level sorcerer spell — pick 1 (spells)", spellsOfLevel(1), 1);
      extraNotes.push("Your Aberrant Dragonmark spells use Constitution as their spellcasting ability (sorcerer spell list — the compiled data has no per-class lists, so check it when choosing).");
    }
    if (name === "Artificer Initiate") {
      spellPickGroup("cantrip", "Artificer cantrip — pick 1 (spells)", spellsOfLevel(0), 1);
      spellPickGroup("spell", "1st-level artificer spell — pick 1 (spells)", spellsOfLevel(1), 1);
      choiceGroups.push({
        id: `${id}-tool`, label: "Artisan's Tools", minLevel: null, minSelections: 1, maxSelections: 1,
        options: TOOLS.filter((t) => /supplies|tools/i.test(t)).map((t) => ({
          id: `${id}-tool-${slug(t)}`, name: t, description: "",
          statModifiers: [{ targetFieldId: "toolProf", op: "grantTag", value: t }],
          featureGrants: [], resourceGrants: [],
        })),
      });
      extraNotes.push("Your Artificer Initiate spells use Intelligence as their spellcasting ability.");
    }
    if (name === "Wood Elf Magic") {
      if (/one druid cantrip/i.test(fullText)) {
        spellPickGroup("cantrip", "Druid cantrip — pick 1 (spells)", spellsOfLevel(0), 1);
      }
      if (/longstrider/i.test(fullText)) grantNamedSpell("Longstrider");
      if (/pass without trace/i.test(fullText)) grantNamedSpell("Pass Without Trace");
    }

    // --- Spells granted by the feat (from @Compendium refs in raw description) ---
    // Extract @Compendium[5e-complete.5e-spells.<id>]{Label} references
    // and wire them as addItem to spellsKnown using the real spell NAME
    // (label first, id-map fallback) so they match SPELL_CATALOG
    // entries. minLevel is null: the feat itself is the gate (picked at
    // an ASI / level 1), not the character's level.
    (() => {
      const featSpellRefs = String(rawDescription || "").match(/@Compendium\[5e-complete\.5e-spells[^\]]+\](\{[^}]*\})?/g) || [];
      const spellSeen = new Set();
      const spellMods = [];
      for (const r of featSpellRefs) {
        const m = r.match(/^\@Compendium\[5e-complete\.5e-spells\.([A-Za-z0-9]+)\](?:\{([^}]*)\})?$/);
        if (!m) continue;
        const entry = spellById.get(m[1]);
        const label = (m[2] || "").trim();
        const spell = label || entry?.name;
        if (!spell) {
          if (!unresolvedSpellIds.includes(m[1])) unresolvedSpellIds.push(m[1]);
          continue;
        }
        if (spellSeen.has(spell)) continue;
        spellSeen.add(spell);
        spellMods.push({ targetFieldId: "spellsKnown", op: "addItem", value: spell, minLevel: null });
      }
      // Extend existing mods array (if any) – the mapEffectChanges above may have already
      // added some; we just concat to avoid duplicates via Set below.
      allMods = [...mods, ...spellMods.filter((mm)=>!mods.some((x)=>x.targetFieldId===mm.targetFieldId&&x.value===mm.value))];
    })();

    // --- Limited-use pools -> resourceGrants (Feature Uses panel) ---
    const pool = (rname, def) => resourceGrants.push({ id: `${id}-${slug(rname)}`, name: rname, minLevel: null, ...def });
    const profPool = (rname, reset) => pool(rname, { maximumFormula: { type: "expr", text: "{{profBonus}}" }, reset });
    if (name === "Lucky") pool("Luck Points", { maximum: 3, reset: "long rest" });
    if (name === "Gift of the Chromatic Dragon") profPool("Reactive Resistance", "long rest");
    if (name === "Gift of the Gem Dragon") profPool("Telekinetic Reprisal", "long rest");
    if (name === "Protective Wings") profPool("Protective Wings", "long rest");
    if (name === "Chef") profPool("Special Treats", "long rest");
    if (name === "Fey Teleportation") pool("Misty Step (feat)", { maximum: 1, reset: "short or long rest" });
    if (name === "Drow High Magic") {
      pool("Levitate (feat)", { maximum: 1, reset: "long rest" });
      pool("Dispel Magic (feat)", { maximum: 1, reset: "long rest" });
    }
    if (name === "Wood Elf Magic") {
      pool("Longstrider (feat)", { maximum: 1, reset: "long rest" });
      pool("Pass Without Trace (feat)", { maximum: 1, reset: "long rest" });
    }
    if (name === "Fade Away") pool("Fade Away", { maximum: 1, reset: "short or long rest" });
    if (name === "Aberrant Dragonmark") pool("Aberrant Dragonmark Spell", { maximum: 1, reset: "short or long rest" });
    if (name === "Artificer Initiate") pool("Artificer Initiate Spell", { maximum: 1, reset: "long rest" });
    if (name === "Magic Initiate") pool("Magic Initiate Spell", { maximum: 1, reset: "long rest" });
    if (name === "Metamagic Adept") pool("Sorcery Points (feat)", { maximum: 2, reset: "long rest" });
    if (name === "Martial Adept") pool("Superiority Die (feat)", { maximum: 1, reset: "short or long rest" });

    // --- Feature grant: the full feat text, plus any mapping notes ---
    const description = extraNotes.length
      ? `${fullText}\n\nSheet notes:\n${extraNotes.map((n) => `- ${n}`).join("\n")}`
      : fullText;
    const featureGrants = [{ id: `${id}-grant`, name, description, minLevel: null }];

    bundles.push({
      name, category: "Feat",
      statModifiers: allMods, dropdownAccess: [],
      featureGrants, resourceGrants, choiceGroups,
    });

    // --- Catalog entry (reference row: prerequisite + full effect) ---
    const prereqMatch = /^Prerequisites?:\s*([^\n]+)/i.exec(fullText);
    catalogEntries.push({
      id: null, name,
      description: firstSentence(fullText.replace(/^Prerequisites?:\s*[^\n]+\n*/i, "")),
      imageData: null,
      archetypeDiff: {
        acquisitionCosts: { added: [], removed: [] },
        requirements: { added: [], removed: [] },
        effects: { added: [], removed: [] },
      },
      fieldValues: {
        prerequisite: prereqMatch ? prereqMatch[1].trim() : "—",
        effect: fullText,
      },
    });
  }

  const catalog = {
    name: "Feats",
    archetype: {
      acquisitionCosts: [],
      requirements: [{ id: "prerequisite", label: "Prerequisite", kind: "text" }],
      effects: [{ id: "effect", label: "Effect", kind: "text" }],
    },
    tabs: [{ id: "feats", name: "Feats", archetypeDiff: { acquisitionCosts: { added: [], removed: [] }, requirements: { added: [], removed: [] }, effects: { added: [], removed: [] } }, entries: catalogEntries }],
  };

  const emit = (obj) => JSON.stringify(obj, null, 2);
  const out = `// Auto-generated by scripts/compile-foundry-feats.mjs from New Info/5e-feats.txt.\n`
    + `// Do not hand-edit — re-run \`node scripts/compile-foundry-feats.mjs\` after updating the source file.\n`
    + `// ${bundles.length} feats. Ability/skill/save/tool/armor/weapon/language bonuses are wired\n`
    + `// to the starter sheet's field ids (strScore, athleticsProf, armorProf, …); conditional\n`
    + `// toggles and resistances live on as feature text + resource pools.\n`
    + `export const FEAT_BUNDLES = ${emit(bundles)};\n\n`
    + `export const FEAT_CATALOG = ${emit(catalog)};\n\n`
    + `export const FEAT_NAMES = ${emit(bundles.map((b) => b.name))};\n`;
  await writeFile(OUTPUT, out, "utf8");
  console.log(`Wrote ${OUTPUT} (${bundles.length} feats, ${catalogEntries.length} catalog entries)`);
  if (unresolvedSpellIds.length) {
    console.log(`  unresolved spell refs (no label, id not in 5e-spells.txt): ${unresolvedSpellIds.join(", ")}`);
  }
}

main();

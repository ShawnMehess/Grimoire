// extraRaces.js — hand-authored core PHB races missing from defaultContent.js.
//
// DEFAULT_CONTENT.raceEntries (compiled from Shawn's races-mechanics.json)
// covers 13 entries but omits the five most-picked core races: Human,
// Elf, Half-Elf, Half-Orc, Tiefling. The Foundry race export
// (scripts/compile-foundry-races-bg.mjs) carries almost no structured
// mechanics, so these are written by hand in exactly the defaultContent
// bundle shape ({ name, bundle: { statModifiers, dropdownAccess,
// featureGrants, resourceGrants, choiceGroups } }) using standard 2014
// PHB rules — same conventions as the Halfling/Dragonborn entries
// (ability mods target `<abl>Score`, skills `<skill>Prof` grant,
// languages grantTag, features carry minLevel).
//
// Wiring (blockModel.js + characterStore.js) treats these as an
// extension of raceEntries: starter Race dropdown lists them, bundles
// attach on select, and save/load strip+hydrate them like defaults.
//
// Known limits (flagged, not guessed):
// - Elf base carries no traits of its own — everything comes from its
//   elf-subrace picker (High/Wood/Drow), each a full kit.
// - Half-Elf's two +1s are two independent +1 slot groups (one
//   dropdown each, duplicates allowed) — same shape as the freeform
//   ASI slots in contentFixups.js.
// - Tiefling Infernal Legacy spells arrive via spellsKnown addItem at
//   character levels 1/3/5 — they need the Spell List catalog wired
//   (see customSheet.js catalogCache) to display.

import { LANGUAGES } from "./schema.js";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

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

function langOptions(id, count) {
  return {
    id: `${id}-languages`, label: count === 1 ? "Language" : "Languages",
    minLevel: 1, minSelections: count, maxSelections: count,
    options: LANGUAGES.map((l) => ({
      id: `${id}-lang-${l.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: l, description: "",
      statModifiers: [{ targetFieldId: "languages", op: "grantTag", value: l }],
      featureGrants: [], resourceGrants: [],
    })),
  };
}

// One independent +1 slot group per increasable score — same shape as
// contentFixups.js's asiSlotGroups (duplicated: that module imports
// this file's entries, so it can't export the builder back here).
// Duplicates stack across slots; see migrateAsiComboPicks for retired
// combo picks.
function asiSlotGroups(idPrefix, count, abilityIds) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${idPrefix}-${i + 1}`, label: "Ability Score Increase (+1)",
    minLevel: 1, minSelections: 1, maxSelections: 1,
    // Abbreviated labels ("STR") — tooltips carry the full names.
    options: abilityIds.map((aid) => ({
      id: `${idPrefix}-${i + 1}-${aid}`, name: aid.toUpperCase(), description: "",
      statModifiers: [{ targetFieldId: `${aid}Score`, op: "add", value: 1, minLevel: null }],
      featureGrants: [], resourceGrants: [],
    })),
  }));
}

function skillOptions(id, label, skillIds, count) {
  return {
    id: `${id}-skills`, label, minLevel: 1, minSelections: count, maxSelections: count,
    options: skillIds.map((sid) => {
      const label = SKILLS.find((s) => s[0] === sid)[1];
      return {
        id: `${id}-skill-${sid}`, name: label, description: "",
        statModifiers: [{ targetFieldId: `${sid}Prof`, op: "grant", minLevel: null }],
        featureGrants: [], resourceGrants: [],
      };
    }),
  };
}

function speedFeature(ft) {
  return { name: "Speed", description: `${ft} ft. walking`, minLevel: 1 };
}

function darkvision() {
  return { name: "Darkvision", description: "You can see in dim light within 60 feet as if it were bright light, and in darkness as if it were dim light (no color in darkness).", minLevel: 1 };
}


export const RACE_EXTRA_ENTRIES = [
  {
    name: "Human",
    bundle: {
      statModifiers: ABILITIES.map((a) => ({ targetFieldId: `${a}Score`, op: "add", value: 1 })),
      dropdownAccess: [],
      featureGrants: [speedFeature(30)],
      resourceGrants: [],
      choiceGroups: [langOptions("human", 1)],
    },
  },
  {
    name: "Elf",
    // Base elves carry no traits or bonuses of their own — everything
    // comes from the chosen subrace (High, Wood, or Drow) below.
    bundle: {
      statModifiers: [],
      dropdownAccess: [],
      featureGrants: [],
      resourceGrants: [],
      choiceGroups: [
        {
          id: "elf-subrace", label: "Elven Subrace", subrace: true, minLevel: 1, minSelections: 1, maxSelections: 1,
          options: [
            {
              id: "elf-subrace-high", name: "High Elf", description: "",
              statModifiers: [
                { targetFieldId: "dexScore", op: "add", value: 2, minLevel: null },
                { targetFieldId: "intScore", op: "add", value: 1, minLevel: null },
                { targetFieldId: "perceptionProf", op: "grant", minLevel: null },
                { targetFieldId: "languages", op: "grantTag", value: "Common" },
                { targetFieldId: "languages", op: "grantTag", value: "Elvish" },
                { targetFieldId: "weaponProf", op: "grantTag", value: "Longsword" },
                { targetFieldId: "weaponProf", op: "grantTag", value: "Shortsword" },
                { targetFieldId: "weaponProf", op: "grantTag", value: "Shortbow" },
                { targetFieldId: "weaponProf", op: "grantTag", value: "Longbow" },
              ],
              featureGrants: [
                darkvision(),
                { name: "Keen Senses", description: "You have proficiency in the Perception skill.", minLevel: null },
                { name: "Fey Ancestry", description: "You have advantage on saving throws against being charmed, and magic can't put you to sleep.", minLevel: null },
                { name: "Trance", description: "Elves don't need to sleep. You meditate for 4 hours instead (still considered a long rest).", minLevel: null },
                { name: "Elf Weapon Training", description: "Proficiency with the longsword, shortsword, shortbow, and longbow.", minLevel: null },
                { name: "Cantrip", description: "You know one cantrip of your choice from the wizard spell list (pick below); Intelligence is your spellcasting ability for it.", minLevel: null },
                { name: "Extra Language", description: "You can speak, read, and write one extra language of your choice.", minLevel: null },
                speedFeature(30),
              ],
              resourceGrants: [],
            },
            {
              id: "elf-subrace-wood", name: "Wood Elf", description: "",
              statModifiers: [
                { targetFieldId: "dexScore", op: "add", value: 2, minLevel: null },
                { targetFieldId: "wisScore", op: "add", value: 1, minLevel: null },
                { targetFieldId: "perceptionProf", op: "grant", minLevel: null },
                { targetFieldId: "speed", op: "add", value: 5, minLevel: null },
                { targetFieldId: "languages", op: "grantTag", value: "Common" },
                { targetFieldId: "languages", op: "grantTag", value: "Elvish" },
                { targetFieldId: "weaponProf", op: "grantTag", value: "Longsword" },
                { targetFieldId: "weaponProf", op: "grantTag", value: "Shortsword" },
                { targetFieldId: "weaponProf", op: "grantTag", value: "Shortbow" },
                { targetFieldId: "weaponProf", op: "grantTag", value: "Longbow" },
              ],
              featureGrants: [
                darkvision(),
                { name: "Keen Senses", description: "You have proficiency in the Perception skill.", minLevel: null },
                { name: "Fey Ancestry", description: "You have advantage on saving throws against being charmed, and magic can't put you to sleep.", minLevel: null },
                { name: "Trance", description: "Elves don't need to sleep. You meditate for 4 hours instead (still considered a long rest).", minLevel: null },
                { name: "Elf Weapon Training", description: "Proficiency with the longsword, shortsword, shortbow, and longbow.", minLevel: null },
                { name: "Fleet of Foot", description: "Your base walking speed increases to 35 feet (+5 applied here).", minLevel: null },
                { name: "Mask of the Wild", description: "You can attempt to hide even when only lightly obscured by foliage, rain, snow, mist, or other natural phenomena.", minLevel: null },
                speedFeature(30),
              ],
              resourceGrants: [],
            },
            {
              id: "elf-subrace-drow", name: "Drow", description: "",
              statModifiers: [
                { targetFieldId: "dexScore", op: "add", value: 2, minLevel: null },
                { targetFieldId: "chaScore", op: "add", value: 1, minLevel: null },
                { targetFieldId: "perceptionProf", op: "grant", minLevel: null },
                { targetFieldId: "languages", op: "grantTag", value: "Common" },
                { targetFieldId: "languages", op: "grantTag", value: "Elvish" },
                { targetFieldId: "weaponProf", op: "grantTag", value: "Rapier" },
                { targetFieldId: "weaponProf", op: "grantTag", value: "Shortsword" },
                { targetFieldId: "weaponProf", op: "grantTag", value: "Hand Crossbow" },
                { targetFieldId: "spellsKnown", op: "addItem", value: "Dancing Lights", minLevel: null },
                { targetFieldId: "spellsKnown", op: "addItem", value: "Faerie Fire", minLevel: 3 },
                { targetFieldId: "spellsKnown", op: "addItem", value: "Darkness", minLevel: 5 },
              ],
              featureGrants: [
                { name: "Senses", description: "Darkvision 120 ft.", minLevel: null },
                { name: "Keen Senses", description: "You have proficiency in the Perception skill.", minLevel: null },
                { name: "Fey Ancestry", description: "You have advantage on saving throws against being charmed, and magic can't put you to sleep.", minLevel: null },
                { name: "Trance", description: "Elves don't need to sleep. You meditate for 4 hours instead (still considered a long rest).", minLevel: null },
                { name: "Drow Weapon Training", description: "Proficiency with rapiers, shortswords, and hand crossbows.", minLevel: null },
                { name: "Sunlight Sensitivity", description: "Disadvantage on attack rolls and Wisdom (Perception) checks relying on sight when you, the target, or the thing you perceive is in direct sunlight.", minLevel: null },
                { name: "Drow Magic", description: "Dancing Lights cantrip; Faerie Fire once per long rest at 3rd level; Darkness once per long rest at 5th. Charisma is your spellcasting ability.", minLevel: null },
                speedFeature(30),
              ],
              resourceGrants: [],
            },
          ],
        },
      ],
    },
  },
  {
    name: "Half-Elf",
    bundle: {
      statModifiers: [
        { targetFieldId: "chaScore", op: "add", value: 2 },
        { targetFieldId: "languages", op: "grantTag", value: "Common" },
        { targetFieldId: "languages", op: "grantTag", value: "Elvish" },
      ],
      dropdownAccess: [],
      featureGrants: [
        darkvision(),
        { name: "Fey Ancestry", description: "You have advantage on saving throws against being charmed, and magic can't put you to sleep.", minLevel: 1 },
        speedFeature(30),
      ],
      resourceGrants: [],
      choiceGroups: [
        // +1 to two abilities other than Charisma (already +2) — one
        // dropdown per pick, duplicates allowed.
        ...asiSlotGroups("half-elf-asi", 2, ABILITIES.filter((a) => a !== "cha")),
        skillOptions("half-elf", "Skill Versatility (any two skills)", SKILLS.map((s) => s[0]), 2),
        langOptions("half-elf", 1),
      ],
    },
  },
  {
    name: "Half-Orc",
    bundle: {
      statModifiers: [
        { targetFieldId: "strScore", op: "add", value: 2 },
        { targetFieldId: "conScore", op: "add", value: 1 },
        { targetFieldId: "intimidationProf", op: "grant" },
        { targetFieldId: "languages", op: "grantTag", value: "Common" },
        { targetFieldId: "languages", op: "grantTag", value: "Orc" },
      ],
      dropdownAccess: [],
      featureGrants: [
        darkvision(),
        { name: "Menacing", description: "You gain proficiency in the Intimidation skill.", minLevel: 1 },
        { name: "Relentless Endurance", description: "When you are reduced to 0 hit points but not killed outright, you can drop to 1 hit point instead. Tracked as a once-per-long-rest use below.", minLevel: 1 },
        { name: "Savage Attacks", description: "When you score a critical hit with a melee weapon attack, you can roll one of the weapon's damage dice one additional time and add it to the extra damage of the critical hit.", minLevel: 1 },
        speedFeature(30),
      ],
      resourceGrants: [{ id: "half-orc-relentless-endurance", name: "Relentless Endurance", minLevel: 1, maximum: 1, reset: "long rest" }],
      choiceGroups: [],
    },
  },
  {
    name: "Tiefling",
    bundle: {
      statModifiers: [
        { targetFieldId: "intScore", op: "add", value: 1 },
        { targetFieldId: "chaScore", op: "add", value: 2 },
        { targetFieldId: "spellsKnown", op: "addItem", value: "Thaumaturgy", minLevel: null },
        { targetFieldId: "spellsKnown", op: "addItem", value: "Hellish Rebuke", minLevel: 3 },
        { targetFieldId: "spellsKnown", op: "addItem", value: "Darkness", minLevel: 5 },
        { targetFieldId: "languages", op: "grantTag", value: "Common" },
        { targetFieldId: "languages", op: "grantTag", value: "Infernal" },
      ],
      dropdownAccess: [],
      featureGrants: [
        darkvision(),
        { name: "Hellish Resistance", description: "You have resistance to fire damage.", minLevel: 1 },
        { name: "Infernal Legacy", description: "You know the Thaumaturgy cantrip. At 3rd level you can cast Hellish Rebuke once per long rest; at 5th level you can cast Darkness once per long rest. Charisma is your spellcasting ability for these.", minLevel: 1 },
        speedFeature(30),
      ],
      resourceGrants: [],
      choiceGroups: [],
    },
  },
];

// Flavor rows for the baked-in Races reference catalog, in the exact
// entry shape defaultContent.js uses (id/description/imageData/
// archetypeDiff/fieldValues). Wired into catalogCache in customSheet.js
// next to the default Races catalog so the wizard shows a description
// for the five added races.
const EMPTY_DIFF = {
  acquisitionCosts: { added: [], removed: [] },
  requirements: { added: [], removed: [] },
  effects: { added: [], removed: [] },
};

export const RACE_EXTRA_CATALOG_ENTRIES = [
  { name: "Human", description: "Versatile and ambitious. +1 to every ability score, one extra language of your choice." },
  { name: "Elf", description: "Graceful and long-lived. Pick a subrace — High, Wood, or Drow — for all traits and bonuses." },
  { name: "Half-Elf", description: "Diplomatic wanderers. +2 Charisma, +1 to two other abilities, two skills of your choice, Darkvision, Fey Ancestry, one extra language." },
  { name: "Half-Orc", description: "Strong tribal warriors. +2 Strength, +1 Constitution, Darkvision, Menacing (Intimidation), Relentless Endurance, Savage Attacks." },
  { name: "Tiefling", description: "Infernal heritage. +2 Charisma, +1 Intelligence, Darkvision, fire resistance, Infernal Legacy (Thaumaturgy, Hellish Rebuke, Darkness)." },
].map(({ name, description }) => ({
  id: null, name, description, imageData: null,
  archetypeDiff: JSON.parse(JSON.stringify(EMPTY_DIFF)),
  fieldValues: {},
}));

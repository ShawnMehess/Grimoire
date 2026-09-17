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
// - Elf subraces (High/Wood/Drow) are a "track by hand" note — no
//   subrace picker yet.
// - Half-Elf's two +1s are a real pick-2 pairing group (same treatment
//   the ASI choice groups already use).
// - Tiefling Infernal Legacy spells arrive via spellsKnown addItem at
//   character levels 1/3/5 — they need the Spell List catalog wired
//   (see customSheet.js catalogCache) to display.

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_LABEL = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

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
    bundle: {
      statModifiers: [
        { targetFieldId: "dexScore", op: "add", value: 2 },
        { targetFieldId: "perceptionProf", op: "grant" },
        { targetFieldId: "languages", op: "grantTag", value: "Common" },
        { targetFieldId: "languages", op: "grantTag", value: "Elvish" },
      ],
      dropdownAccess: [],
      featureGrants: [
        darkvision(),
        { name: "Keen Senses", description: "You have proficiency in the Perception skill.", minLevel: 1 },
        { name: "Fey Ancestry", description: "You have advantage on saving throws against being charmed, and magic can't put you to sleep.", minLevel: 1 },
        { name: "Trance", description: "Elves don't need to sleep. You meditate for 4 hours instead (still considered a long rest).", minLevel: 1 },
        { name: "Elven Subrace", description: "Choose a subrace with your DM (High, Wood, or Drow) — it grants extra traits. Track your subrace pick by hand for now; there is no subrace picker yet.", minLevel: 1 },
        speedFeature(30),
      ],
      resourceGrants: [],
      choiceGroups: [],
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
        {
          id: "half-elf-abilities", label: "Ability Score Increases (+1 to two other abilities)",
          minLevel: 1, minSelections: 1, maxSelections: 1,
          options: (() => {
            const others = ABILITIES.filter((a) => a !== "cha");
            const pairs = [];
            for (let i = 0; i < others.length; i++) {
              for (let j = i + 1; j < others.length; j++) {
                const [a, b] = [others[i], others[j]];
                pairs.push({
                  id: `half-elf-ability-${a}-${b}`,
                  name: `+1 ${ABILITY_LABEL[a]} / +1 ${ABILITY_LABEL[b]}`, description: "",
                  statModifiers: [
                    { targetFieldId: `${a}Score`, op: "add", value: 1, minLevel: null },
                    { targetFieldId: `${b}Score`, op: "add", value: 1, minLevel: null },
                  ],
                  featureGrants: [], resourceGrants: [],
                });
              }
            }
            return pairs;
          })(),
        },
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
  { name: "Elf", description: "Graceful and long-lived. +2 Dexterity, Darkvision, Keen Senses (Perception), Fey Ancestry, Trance. Pick a subrace (High/Wood/Drow) with your DM." },
  { name: "Half-Elf", description: "Diplomatic wanderers. +2 Charisma, +1 to two other abilities, two skills of your choice, Darkvision, Fey Ancestry, one extra language." },
  { name: "Half-Orc", description: "Strong tribal warriors. +2 Strength, +1 Constitution, Darkvision, Menacing (Intimidation), Relentless Endurance, Savage Attacks." },
  { name: "Tiefling", description: "Infernal heritage. +2 Charisma, +1 Intelligence, Darkvision, fire resistance, Infernal Legacy (Thaumaturgy, Hellish Rebuke, Darkness)." },
].map(({ name, description }) => ({
  id: null, name, description, imageData: null,
  archetypeDiff: JSON.parse(JSON.stringify(EMPTY_DIFF)),
  fieldValues: {},
}));

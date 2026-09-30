// subclassPicks.js
//
// The choice groups that subclass features are missing.
//
// Every entry here corresponds to a feature the 5e rules define as a
// CHOICE - "choose a totem spirit", "choose a rune", "choose a form" -
// which the compiled data carries as a name with an empty description
// and no way to take it. The feature text is supplied alongside the
// groups so the row reads as the rule it is, and the pick is the row's
// own control rather than a note telling the player to sort it out.
//
// Levels are the subclass levels from the source. Subclass key is
// normSubclassKey of the display name (see contentFixups.js).
//
// See missingPicks.js for the group builders and the rules these follow.

import { namedPick, skillPick, languagePick, toolPick, spellPick, skillOrLanguagePick, ARTISAN_TOOLS } from "./missingPicks.js";

/** @type {Record<string, Array<{feature: string, level: number, text: string, groups: any[]}>>} */
export const SUBCLASS_PICKS = {
  // --- Barbarian -----------------------------------------------------------
  pathoftheberserker: [
    {
      feature: "Frenzy", level: 3,
      text: "Your frenzy gives you a number of benefits that depend on the type of frenzy you choose. Bear (berserk), Totem (free), or Beast (frenzied attack).",
      groups: [namedPick("berserker-frenzy", "Frenzy type", ["Bear — Berserk", "Totem — Free", "Beast — Frenzied attack"])],
    },
  ],
  pathoftheancestralguardian: [
    {
      feature: "Ancestral Protectors", level: 3,
      text: "Choose a spirit that lends you aid: Ancestor, Spirits of the Land, or Spirits of the Dead.",
      groups: [namedPick("ancestral-guardian-spirit", "Guardian spirit", [
        "Ancestor — an elder of your bloodline",
        "Spirits of the Land — nature spirits",
        "Spirits of the Dead — spirits bound to death",
      ])],
    },
  ],
  pathofthebeast: [
    {
      feature: "Form of the Beast", level: 3,
      text: "You gain the ability to assume a beast form: Bear, Eagle, or Wolf.",
      groups: [namedPick("beast-form", "Totem form", ["Bear", "Eagle", "Wolf"])],
    },
  ],
  pathofthestormherald: [
    {
      feature: "Storm Aura", level: 3,
      text: "You gain magic from your spirit that manifests as an aura. Your storm aura comes from one of the following storm types.",
      groups: [namedPick("storm-herald-aura", "Storm aura", ["Desert", "Sea", "Tundra"])],
    },
  ],
  wildmagic: [
    {
      feature: "Wild Magic Surge", level: 3,
      text: "When you cast a spell that can be a wild surge, you can replace it with one of the following surges instead of using it as normal.",
      groups: [namedPick("wild-magic-surge", "Wild surge", [
        "Teleport", "Summon Thunderwave", "Fire burst", "Gaseous Form",
        "Gust of Wind", "Petal of Ice", "Summon Hand", "Thunder Step",
      ])],
    },
  ],
  pathofthetotemwarrior: [
    {
      feature: "Totem Spirit", level: 3,
      text: "Your spirit grants you magic that comes from one of the totem spirits of your people: Bear, Eagle, or Wolf.",
      groups: [namedPick("totem-warrior-spirit", "Totem spirit", ["Bear", "Eagle", "Wolf"])],
    },
    {
      feature: "Aspect of the Beast", level: 6,
      text: "Your choice of totem spirit grants you an aspect of the beast. Your spirit's Aspect of the Beast is one of the following.",
      groups: [namedPick("totem-warrior-aspect", "Aspect of the Beast", ["Bear Totem", "Eagle Totem", "Wolf Totem"], { minLevel: 6 })],
    },
    {
      feature: "Totemic Attunement", level: 14,
      text: "Your choice of totem spirit grants you the ability to attune to a different totem spirit from the following list each day.",
      groups: [namedPick("totem-warrior-attunement", "Totem attunement", [
        "Disciple of the Land", "Disciple of the Moon", "Disciple of the Stars", "Disciple of the Sun",
      ])],
    },
  ],

  // --- Sorcerer ------------------------------------------------------------
  draconicbloodline: [
    {
      feature: "Dragon Ancestor", level: 1,
      text: "Your magic is infused with the power of your dragon ancestor, one of the types below. This ancestry also fixes your Elemental Affinity damage type.",
      groups: [namedPick("draconic-ancestor", "Dragon ancestor", [
        "Black", "Blue", "Brass", "Bronze", "Copper",
        "Gold", "Green", "Red", "Silver", "White",
      ])],
    },
  ],

  // --- Fighter -------------------------------------------------------------
  arcanearcher: [
    {
      feature: "Arcane Shot (2 options)", level: 3,
      text: "You learn to use a magical effect as part of an arrow attack. You can use the effect once per turn, and the number of times you can use it grows with your levels.",
      groups: [namedPick("arcane-archer-shot", "Arcane Shot", [
        "Arcane Arrow", "Bouncing Arrow", "Returning Arrow",
        "Seeking Arrow", "Shatter Shot", "Split Shot",
      ])],
    },
  ],
  battlemaster: [
    {
      feature: "Combat Superiority (d8)", level: 3,
      text: "Your parting gift lets you manoeuvre on the battlefield. Choose the manoeuvres below; you gain one more whenever you gain a level here, and Counterspell at 15th.",
      groups: [namedPick("battle-master-manoeuvre", "Manoeuvre", [
        "Bait and Switch", "Commander's Strike", "Disarming Attack", "Duelist's Advance",
        "Evasive Footwork", "Goading Attack", "Menacing Attack", "Counterspell",
      ])],
    },
    {
      feature: "Student of War", level: 3,
      text: "When you gain this feature, you gain proficiency with one tool of your choice.",
      groups: [toolPick("battle-master-tool", "Artisan's tool", ARTISAN_TOOLS)],
    },
  ],
  runeknight: [
    {
      feature: "Bonus Proficiencies", level: 3,
      text: "When you gain this feature, you gain proficiency in two martial weapons of your choice.",
      groups: [toolPick("rune-knight-weapons", "Martial weapons", [
        "Longsword", "Shortsword", "Scimitar", "Rapier", "Longbow", "Shortbow",
        "Handaxe", "Battleaxe", "Warhammer", "War pick", "Javelin", "Trident",
        "Light Hammer", "Morningstar", "Glaive", "Pike", "Halberd", "Whip",
      ])],
    },
    {
      feature: "Rune Carver", level: 3,
      text: "You learn to carve and attune to one rune. Your rune comes from the runes your people pass down.",
      groups: [namedPick("rune-carver", "Rune", ["Hill Rune", "Stone Rune", "Storm Rune"])],
    },
  ],

  // --- Artificer -----------------------------------------------------------
  alchemist: [
    {
      feature: "Experimental Elixir", level: 3,
      text: "You can drink an experimental elixir to gain its effects for a limited time.",
      groups: [namedPick("experimental-elixir", "Experimental Elixir", [
        "Acid Elixir", "Fire Elixir", "Force Elixir", "Frost Elixir",
        "Natural Elixir", "Shock Elixir", "Superheated Elixir",
      ])],
    },
  ],
  armorer: [
    {
      feature: "Armor Model", level: 3,
      text: "You gain benefits from your armour's model: Guardian or Infiltrator.",
      groups: [namedPick("armorer-model", "Armor model", ["Guardian", "Infiltrator"])],
    },
  ],

  // --- Monk ---------------------------------------------------------------
  wayofthefourelements: [
    {
      feature: "Disciple of the Elements", level: 3,
      text: "Your study allows you to learn a type of elemental discipline. You learn a second at 6th, a third at 11th and a fourth at 17th.",
      groups: [namedPick("elemental-discipline", "Elemental discipline", [
        "Force", "Fire", "Form", "Void",
      ])],
    },
  ],
  wayofthedrunkenmaster: [
    {
      feature: "Bonus Proficiencies", level: 3,
      text: "When you gain this feature, you gain proficiency in a skill of your choice and one tool of your choice.",
      groups: [{
        id: "drunken-master-skill-tool",
        label: "Skill and tool",
        category: "skills",
        choiceKind: "build",
        minSelections: 1,
        maxSelections: 1,
        // Cross-category only, and each option carries its own grant -
        // see skillOrLanguagePick for why there is no flat list.
        categories: [
          {
            id: "drunken-master-skill",
            label: "A skill",
            options: skillPick("drunken-master-skill", "A skill", 1).options,
          },
          {
            id: "drunken-master-tool",
            label: "A tool",
            options: toolPick("drunken-master-tool", "A tool", ARTISAN_TOOLS).options,
          },
        ],
      }],
    },
  ],

  // --- Druid ---------------------------------------------------------------
  circleoftheland: [
    {
      feature: "Bonus Cantrip (Druid)", level: 2,
      text: "When you gain this feature, you gain proficiency in one other cantrip of the druid's list.",
      groups: [spellPick("circle-of-land-cantrip", "Druid cantrip", { list: "druid", level: 0, minLevel: 2 })],
    },
  ],
  circleofstars: [
    {
      feature: "Starry Form", level: 2,
      text: "You gain the ability to assume a starry form corresponding to a school of magic.",
      groups: [namedPick("starry-form", "Starry form", ["Bard", "Cleric", "Druid", "Wizard"])],
    },
  ],
  drakewarden: [
    {
      feature: "Drake Companion", level: 3,
      text: "You grow a drake-bonded dragon of a type you choose.",
      groups: [namedPick("drake-type", "Drake type", [
        "Black Dragon", "Blue Dragon", "Brass Dragon", "Bronze Dragon", "Copper Dragon",
        "Gold Dragon", "Green Dragon", "Red Dragon", "Silver Dragon", "White Dragon",
        "Brass Dragon (War)", "Copper Dragon (War)", "Iron Dragon",
        "Black Gem Dragon", "Crystal Dragon",
        "Dragon Turtle",
      ])],
    },
  ],

  // --- Bard ----------------------------------------------------------------
  collegeoflore: [
    {
      feature: "Bonus Proficiencies", level: 3,
      text: "When you gain this feature, choose three skill proficiencies.",
      groups: [skillPick("lore-bonus-skills", "Skill proficiencies", 3)],
    },
  ],

  // --- Cleric domains ------------------------------------------------------
  arcanadomain: [
    {
      feature: "Arcane Initiate", level: 1,
      text: "You gain proficiency in two cantrips from the wizard spell list.",
      groups: [spellPick("arcana-cantrips", "Wizard cantrips", { list: "wizard", level: 0, count: 2, minLevel: 1 })],
    },
  ],
  knowledgedomain: [
    {
      feature: "Blessings of Knowledge", level: 1,
      text: "You gain proficiency in two languages and two other skills of your choice.",
      groups: [
        languagePick("knowledge-languages", "Languages", 2, { minLevel: 1 }),
        skillPick("knowledge-skills", "Other skills", 2, { minLevel: 1 }),
      ],
    },
  ],
  naturedomain: [
    {
      feature: "Bonus Proficiency", level: 1,
      text: "You gain proficiency in one cantrip from the druid's list and proficiency in one other skill of your choice.",
      groups: [
        spellPick("nature-cantrip", "Druid cantrip", { list: "druid", level: 0, minLevel: 1 }),
        skillPick("nature-skill", "Other skill", 1, { minLevel: 1 }),
      ],
    },
  ],

  // --- Paladin -------------------------------------------------------------
  cavalier: [
    {
      feature: "Bonus Proficiency", level: 3,
      text: "When you gain this feature, choose a skill or a language of your choice.",
      groups: [skillOrLanguagePick("cavalier-bonus", "Skill or language", { minLevel: 3 })],
    },
  ],
  samurai: [
    {
      feature: "Bonus Proficiency", level: 3,
      text: "When you gain this feature, choose a skill or a language of your choice.",
      groups: [skillOrLanguagePick("samurai-bonus", "Skill or language", { minLevel: 3 })],
    },
  ],
};

/** Subclass keys whose features are the pick but which aren't in the table
 *  above, kept explicit so a future audit can tell "not yet covered" from
 *  "deliberately nothing to pick". */
export const SUBCLASS_PICK_AUDIT_NOTE =
  "A subclass with no entry here either grants its features automatically or has no feature the rules present as a choice.";

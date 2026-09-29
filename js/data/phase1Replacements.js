// phase1Replacements.js — Phase 1 content-audit source table.
//
// Every player-facing replacement string below is copied VERBATIM from
// docs/CONTENT-AUDIT-2026-09.md ("Recommended player-facing
// replacement" / "Recommended background-feature replacement" columns).
// Do not paraphrase, shorten, or extend them here: the audit table is
// itself the sourced text for this phase (see docs/phase1-sources.md
// for the per-row file/line mapping, and docs/phase1-gaps.md for items
// that could not be sourced from this repo).
//
// Shape:
//   CLASS_L1_REPLACEMENTS = { [className]: [{ grant, text }] }
//     `grant` is the exact compiled feature-grant name to replace;
//     `text` becomes its new description (the old description is kept
//     on the grant as `reference` so no long-form text is lost).
//   BG_FEATURE_REPLACEMENTS = { [backgroundName]: [{ grant, text }] }
//     Same, for background-feature grants.
//   RANGER_FAVORED_ENEMIES / RANGER_FAVORED_TERRAINS are name-only
//   option lists (no descriptions invented — none are sourced in this
//   repo; see docs/phase1-gaps.md).

export const CLASS_L1_REPLACEMENTS = {
  Barbarian: [
    {
      grant: "Rage",
      text: "As a bonus action, rage for up to 1 minute. You have advantage on Strength checks and saving throws, deal +2 damage with Strength melee attacks, and resist bludgeoning, piercing, and slashing damage. You cannot cast or concentrate on spells while raging.",
    },
  ],
  Monk: [
    {
      grant: "Martial Arts",
      text: "Use Dexterity instead of Strength for monk weapons and unarmed strikes. Your unarmed strike deals 1d4 damage, and after attacking with a monk weapon or unarmed strike you can make one unarmed strike as a bonus action.",
    },
  ],
  Rogue: [
    {
      grant: "Sneak Attack",
      text: "Once per turn, deal an extra 1d6 damage when you hit with a finesse or ranged weapon and have advantage, or when an enemy of the target is within 5 feet of it and you do not have disadvantage.",
    },
    {
      grant: "Expertise",
      text: "Choose two of your proficient skills, or choose one proficient skill and thieves' tools; double your proficiency bonus for the chosen proficiencies.",
    },
  ],
  Bard: [
    {
      grant: "Spellcasting",
      text: "You use Charisma for bard spells; choose your cantrips and spells in the Spells step.",
    },
    {
      grant: "Bardic Inspiration",
      text: "As a bonus action, give a creature within 60 feet that can hear you one d6. Within 10 minutes, it can add the die to one ability check, attack roll, or saving throw. Uses: your Charisma modifier per long rest (minimum once).",
    },
  ],
  Cleric: [
    {
      grant: "Spellcasting",
      text: "You use Wisdom for cleric spells. Prepare your spells and choose your cantrips in the Spells step.",
    },
  ],
  Druid: [
    {
      grant: "Druidic",
      text: "You know Druidic, the secret language of druids, and can leave hidden messages in it.",
    },
    {
      grant: "Spellcasting",
      text: "You use Wisdom for druid spells. Prepare your spells and choose your cantrips in the Spells step.",
    },
    {
      grant: "Armor Restriction",
      text: "You will not wear metal armor or use a metal shield.",
    },
  ],
  Paladin: [
    {
      grant: "Divine Sense",
      text: "As an action, detect celestials, fiends, undead, and consecrated or desecrated places within 60 feet until the end of your next turn. Uses: 1 + your Charisma modifier per long rest.",
    },
    {
      grant: "Lay on Hands",
      text: "You have a healing pool of 5 hit points. As an action, restore hit points from the pool or spend 5 points to cure one poison or disease.",
    },
  ],
  Ranger: [
    {
      grant: "Favored Enemy",
      text: "Choose a favored enemy type. You have advantage on Survival checks to track it and Intelligence checks to recall information about it; you learn one language spoken by that type.",
    },
    {
      grant: "Natural Explorer",
      text: "Choose a favored terrain. While traveling there, gain the listed navigation, tracking, foraging, and movement benefits.",
    },
  ],
  Warlock: [
    {
      grant: "Pact Magic",
      text: "You use Charisma for warlock spells. Choose two cantrips and two 1st-level spells in the Spells step; your spell slots return when you finish a short or long rest.",
    },
  ],
  Wizard: [
    {
      grant: "Spellcasting",
      text: "You use Intelligence for wizard spells. Your spellbook starts with six 1st-level wizard spells; choose your cantrips and prepared spells in the Spells step.",
    },
    {
      grant: "Arcane Recovery",
      text: "Once per day when you finish a short rest, recover expended spell slots with a combined level up to half your wizard level, rounded up. No recovered slot can be 6th level or higher.",
    },
  ],
  Sorcerer: [
    {
      grant: "Spellcasting",
      text: "You use Charisma for sorcerer spells. Choose your cantrips and spells known in the Spells step.",
    },
  ],
};

// Fighter's audit replacement describes the choice itself rather than
// a fixed grant ("Choose one Fighting Style. ..."). It is attached as
// the fighting-style choice group's description; each style's full
// rules already live on its own option.
export const FIGHTER_STYLE_GROUP_TEXT =
  "Choose one Fighting Style. Its benefits apply while you meet that style's requirements.";

export const BG_FEATURE_REPLACEMENTS = {
  Acolyte: [
    {
      grant: "Shelter the Faithful",
      text: "Temples and followers of your faith provide you and your companions with free healing and care, excluding costly spell components. Followers support you at a modest lifestyle, and your temple may provide safe, nonhazardous assistance while you remain in good standing.",
    },
  ],
  Entertainer: [
    {
      grant: "By Popular Demand",
      text: "You can usually find a place to perform. When you perform there each night, you receive free modest or comfortable food and lodging and may be recognized favorably by locals.",
    },
  ],
  "Folk Hero": [
    {
      grant: "Rustic Hospitality",
      text: "Common folk can shelter, hide, or help you recover unless you endanger them. They may shield you from pursuers, but will not risk their lives for you.",
    },
  ],
  "Guild Artisan": [
    {
      grant: "Guild Membership",
      text: "Your guild can provide lodging, food, a place to meet, professional connections, and support when you are in good standing. You owe 5 gp in monthly dues.",
    },
  ],
  Noble: [
    {
      grant: "Position of Privilege",
      text: "You are accepted in high society, commoners try to accommodate you, and you can usually secure an audience with a local noble.",
    },
  ],
  Outlander: [
    {
      grant: "Wanderer",
      text: "You remember maps and geography well, and can find food and fresh water for yourself and up to five others each day when the land can provide it.",
    },
  ],
  Sage: [
    {
      grant: "Researcher",
      text: "When you do not know a piece of lore, you usually know where and from whom it can be obtained, subject to the DM's ruling and the availability of the knowledge.",
    },
  ],
  Sailor: [
    {
      grant: "Ship's Passage",
      text: "You and your companions can usually secure free passage on a sailing ship with which you have ties. The route and schedule are not guaranteed, and you are expected to assist the crew.",
    },
  ],
  "Urban Bounty Hunter": [
    {
      grant: "Ear to the Ground",
      text: "In any city, you can draw on contacts connected to the social circles your quarry uses to learn about people and places.",
    },
  ],
};

// Standard PHB favored-enemy / favored-terrain vocabularies, names
// only: no per-option mechanics are sourced anywhere in this repo, so
// none are written (see docs/phase1-gaps.md).
export const RANGER_FAVORED_ENEMIES = [
  "Aberrations",
  "Beasts",
  "Celestials",
  "Constructs",
  "Dragons",
  "Elementals",
  "Fey",
  "Fiends",
  "Giants",
  "Monstrosities",
  "Oozes",
  "Plants",
  "Undead",
  "Humanoids (choose two)",
];

export const RANGER_FAVORED_TERRAINS = [
  "Arctic",
  "Coast",
  "Desert",
  "Forest",
  "Grassland",
  "Mountain",
  "Swamp",
  "Underdark",
];

// The Tasha's optional pair has no sourced mechanics in this repo, so
// the variant option carries a pointer, not rules text (see
// docs/phase1-gaps.md). It still displays — only when the Tasha's
// pack is enabled and the player picks it — satisfying the audit's
// display rule without hallucinating mechanics.
export const RANGER_VARIANT_OPTION = {
  id: "ranger-class-variant-tashas",
  name: "Favored Foe + Deft Explorer (Tasha's, replaces both above)",
  description:
    "Use the Tasha's Cauldron of Everything optional rules instead of Favored Enemy and Natural Explorer above; see that book for the full rules (level-1 effects only at 1st level).",
};

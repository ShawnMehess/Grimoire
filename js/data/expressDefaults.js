// expressDefaults.js
//
// Per-class recommended defaults for Express setup (see
// applyExpressDefaults in customSheet.js). Data, not wizard logic:
// each class names the ability-score spread and skill picks Express
// fills in, so tuning a recommendation means editing this file, never
// the wizard. Every spread is Point Buy legal (27 points, 8–15) —
// enforced by smoke-imports, so a typo here fails loudly instead of
// producing an illegal character.
//
// Skills are matched case-insensitively against whatever each choice
// group actually offers; anything unmatched (or any group with no
// recommendation, like subraces, feats, or equipment) falls back to
// first-available picks. Subclass/equipment/spell fills are
// first-available by design — taste differs, Review shows everything,
// and jumping back changes anything.

export const EXPRESS_CLASS_DEFAULTS = {
  Artificer: {
    abilities: { str: 10, dex: 14, con: 13, int: 15, wis: 12, cha: 8 },
    skills: ["Arcana", "Perception"],
  },
  Barbarian: {
    abilities: { str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 },
    skills: ["Athletics", "Intimidation"],
  },
  Bard: {
    abilities: { str: 8, dex: 14, con: 12, int: 10, wis: 13, cha: 15 },
    skills: ["Persuasion", "Perception"],
  },
  Cleric: {
    abilities: { str: 10, dex: 12, con: 14, int: 8, wis: 15, cha: 13 },
    skills: ["Religion", "Insight"],
  },
  Druid: {
    abilities: { str: 10, dex: 12, con: 14, int: 13, wis: 15, cha: 8 },
    skills: ["Nature", "Survival"],
  },
  Fighter: {
    abilities: { str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 },
    skills: ["Athletics", "Perception"],
  },
  Monk: {
    abilities: { str: 10, dex: 15, con: 13, int: 12, wis: 14, cha: 8 },
    skills: ["Acrobatics", "Stealth"],
  },
  Paladin: {
    abilities: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 },
    skills: ["Athletics", "Persuasion"],
  },
  Ranger: {
    abilities: { str: 12, dex: 15, con: 13, int: 10, wis: 14, cha: 8 },
    skills: ["Survival", "Perception"],
  },
  Rogue: {
    abilities: { str: 8, dex: 15, con: 13, int: 12, wis: 14, cha: 10 },
    skills: ["Stealth", "Perception"],
  },
  Sorcerer: {
    abilities: { str: 8, dex: 13, con: 14, int: 12, wis: 10, cha: 15 },
    skills: ["Arcana", "Persuasion"],
  },
  Warlock: {
    abilities: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
    skills: ["Deception", "Investigation"],
  },
  Wizard: {
    abilities: { str: 8, dex: 13, con: 14, int: 15, wis: 12, cha: 10 },
    skills: ["Arcana", "Investigation"],
  },
};

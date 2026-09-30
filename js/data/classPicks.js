// classPicks.js
//
// Choice groups that CLASS features are missing.
//
// Same problem as subclassPicks.js, at class level, and the same rule: the
// compiled data carries the feature name and - in these cases - a sentence
// that promises a choice the sheet never offers.
//
//   - The ranger gets more favored enemies at 6 and 14, and more favored
//     terrain at 6 and 10. Only the level-1 pick exists, so a level-12
//     ranger is shown one enemy and one terrain when the rules give them
//     two and two.
//   - "Humanoids (choose two)" is a single option whose entire text is an
//     instruction, so taking it grants nothing. Each humanoid type becomes
//     its own option and the group takes two.
//   - The warlock's Mystic Arcanum is four separate feature grants, each
//     carrying the literal text "not a pickable list here yet".
//   - The wizard's Spell Mastery and Signature Spells name spells nothing
//     lets you choose.
//
// Spells are never listed here: a group carries `spellPick` and the shared
// dialog builds its options from the spell catalog when it opens, so a
// spell pick can never drift out of step with the spell list.

import { namedPick, spellPick, languagePick } from "./missingPicks.js";

/** The humanoid types a ranger can favor, from the Monster Manual table
 *  the PHB points at. "Humanoids (choose two)" in the compiled options is
 *  a placeholder that cannot be taken, so it is replaced by these. */
export const HUMANOID_TYPES = [
  "Bugbear", "Duergar", "Githyanki", "Gnoll", "Goblin", "Grellkin",
  "Hobgoblin", "Kobold", "Lizardfolk", "Orc", "Sahuagin", "Troll",
];

const FAVORED_ENEMIES = [
  "Aberrations", "Beasts", "Celestials", "Constructs", "Dragons", "Elementals",
  "Fey", "Fiends", "Giants", "Monstrosities", "Oozes", "Plants", "Undead",
];

const FAVORED_TERRAINS = [
  "Arctic", "Coast", "Desert", "Forest", "Grassland", "Mountain", "Swamp", "Underdark",
];

/** @type {Record<string, Array<{feature: string, dropOption?: string, groups: any[]}>>} */
export const CLASS_PICKS = {
  Ranger: [
    {
      // "Humanoids (choose two)" is replaced rather than supplemented:
      // leaving it would mean two ways to favour a humanoid, one of which
      // grants nothing. Each type is its own option and the group takes
      // two, which is what the option text was asking for. It lives on the
      // level-1 group, not on a feature, so it's dropped from there.
      feature: "Favored Enemy",
      dropFromGroup: "ranger-favored-enemy",
      dropOption: "Humanoids (choose two)",
      groups: [
        namedPick("ranger-favored-enemy-humanoid", "Favored Enemy: two humanoid types", HUMANOID_TYPES, {
          minSelections: 2,
          maxSelections: 2,
        }),
        // The rules' humanoid benefit includes learning one of that type's
        // languages. Offered alongside rather than gated on the pick above,
        // because the sheet has no "this group is satisfied" condition to
        // gate on; the label says what it is for.
        languagePick("ranger-favored-enemy-language", "If one is a humanoid: a language it speaks", 1),
      ],
    },
    {
      feature: "Favored Enemy",
      groups: [
        namedPick("ranger-favored-enemy-6", "Favored Enemy (6th level)", [...FAVORED_ENEMIES, ...HUMANOID_TYPES], { minLevel: 6 }),
        namedPick("ranger-favored-enemy-14", "Favored Enemy (14th level)", [...FAVORED_ENEMIES, ...HUMANOID_TYPES], { minLevel: 14 }),
      ],
    },
    {
      // "Favored Terrain" is a group with no feature grant behind it, so
      // the extra terrain picks are named against that group instead.
      feature: "Favored Terrain",
      dropFromGroup: "ranger-favored-terrain",
      groups: [
        namedPick("ranger-favored-terrain-6", "Favored Terrain (6th level)", FAVORED_TERRAINS, { minLevel: 6 }),
        namedPick("ranger-favored-terrain-10", "Favored Terrain (10th level)", FAVORED_TERRAINS, { minLevel: 10 }),
      ],
    },
  ],
  Warlock: [
    { feature: "Mystic Arcanum (6th level)", groups: [warlockArcanum(6, 11)] },
    { feature: "Mystic Arcanum (7th level)", groups: [warlockArcanum(7, 13)] },
    { feature: "Mystic Arcanum (8th level)", groups: [warlockArcanum(8, 15)] },
    { feature: "Mystic Arcanum (9th level)", groups: [warlockArcanum(9, 17)] },
  ],
  Wizard: [
    {
      // Two 1st-level AND two 2nd-level, so two groups: one group can only
      // draw from a single spell level.
      feature: "Spell Mastery",
      groups: [
        spellPick("wizard-spell-mastery-1", "1st-level spells", { list: "wizard", level: 1, count: 2, minLevel: 18 }),
        spellPick("wizard-spell-mastery-2", "2nd-level spells", { list: "wizard", level: 2, count: 2, minLevel: 18 }),
      ],
    },
    {
      feature: "Signature Spells",
      groups: [spellPick("wizard-signature-spells", "3rd-level spells", { list: "wizard", level: 3, count: 2, minLevel: 20 })],
    },
  ],
};

function warlockArcanum(level, minLevel) {
  return spellPick(`warlock-mystic-arcanum-${level}`, `${level}th-level warlock spell`, {
    list: "warlock", level, count: 1, minLevel,
  });
}

/** Replaces the compiled text, which admits the data is incomplete. */
export const CLASS_PICK_TEXT = {
  "Mystic Arcanum (6th level)": "When you gain this feature, you learn a 6th-level warlock spell that you can cast at will.",
  "Mystic Arcanum (7th level)": "When you gain this feature, you learn a 7th-level warlock spell that you can cast at will.",
  "Mystic Arcanum (8th level)": "When you gain this feature, you learn an 8th-level warlock spell that you can cast at will.",
  "Mystic Arcanum (9th level)": "When you gain this feature, you learn a 9th-level warlock spell that you can cast at will.",
};

/** True when the compiled text is a stand-in for a pick, so the fixup
 *  knows it's allowed to replace it. Matches the literal marker the
 *  compiler writes rather than the whole sentence, so a re-export that
 *  changes the wording around it still matches. */
export function isUnpickableNote(text) {
  return /not a pickable list here yet/i.test(String(text || ""));
}

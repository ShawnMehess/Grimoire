// missingPicks.js
//
// Choice groups for features whose prose says "choose" and whose data
// stops at the noun.
//
// The compiled subclass/class/race data carries a feature NAME for these
// and nothing else - the source export lists feature names with compendium
// references, not their text, so the compiler could not produce option
// lists and the feature arrives with an empty description and no way to
// take it. On the sheet that reads as a rule with nothing attached: a
// Totem Warrior's "Totem Spirit" is the whole feature and there is
// nothing to pick.
//
// This file is the table of those missing picks. It is data, not logic,
// because there are a lot of them and they are all the same shape: a
// feature to attach to, the text that feature should carry, and the
// groups that express the choice.
//
// Rules followed throughout:
//
//  - Option names and levels are the 5e rules, not invented. Where a
//    pick grants something mechanical (a skill, a language, a tool, a
//    spell) the option carries a real statModifier, so taking it changes
//    the sheet. Where the pick only records a flavour choice (a Totem
//    Spirit, a Storm Aura) the effect text lives in the feature
//    description and the option is the choice, which is exactly how the
//    rules present it.
//  - Spells are NOT listed here. The catalog is the list; these groups
//    carry `spellPick` and the shared dialog builds the options from the
//    catalog at open time, so a spell pick can never drift out of step
//    with the spell list.
//  - Skill/language/tool options are built from the sheet's own
//    vocabulary (schema.js), not copied out of a second list, so adding
//    a language shows up in every group that offers it.

import { SKILLS, LANGUAGES } from "./schema.js";

const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "option";
const label = (s) => (s || "").replace(/'s\b/, "'s");

/** A group of skill proficiencies. */
export function skillPick(id, text, count, extra = {}) {
  return {
    id,
    label: text,
    category: "skills",
    choiceKind: "build",
    minSelections: count,
    maxSelections: count,
    options: SKILLS.map((s) => ({
      id: `${id}-${s.id}`,
      name: s.label,
      description: s.description || "",
      statModifiers: [{ targetFieldId: `${s.id}Prof`, op: "grant" }],
    })),
    ...extra,
  };
}

/** A group of languages. Common is never offered: it's free. */
export function languagePick(id, text, count, extra = {}) {
  return {
    id,
    label: text,
    category: "languages",
    choiceKind: "build",
    minSelections: count,
    maxSelections: count,
    options: LANGUAGES.filter((n) => n !== "Common").map((n) => ({
      id: `${id}-${slug(n)}`,
      name: n,
      statModifiers: [{ targetFieldId: "languages", op: "grantTag", value: n }],
    })),
    ...extra,
  };
}

/** A group of tool proficiencies. */
export function toolPick(id, text, tools, extra = {}) {
  return {
    id,
    label: text,
    category: "tools",
    choiceKind: "build",
    minSelections: 1,
    maxSelections: 1,
    options: tools.map((t) => ({
      id: `${id}-${slug(t)}`,
      name: t,
      statModifiers: [{ targetFieldId: "toolProf", op: "grantTag", value: t }],
    })),
    ...extra,
  };
}

/** A group of spells. Options come from the spell catalog when the
 *  dialog opens - see spellPick in sheetWizard.js - so nothing here has
 *  to know what spells exist. */
export function spellPick(id, text, { list, level, count = 1, minLevel = 1 }) {
  return {
    id,
    label: text,
    category: "spells",
    choiceKind: "build",
    spellPick: { list, level },
    minSelections: count,
    maxSelections: count,
    minLevel,
    options: [{
      id: `${id}-pending`,
      name: count === 1 ? "Choose a spell" : `Choose ${count} spells`,
      description: "Opens the spell list.",
    }],
  };
}

/** A group whose options are plain named choices - a totem, a constellation,
 *  a rune. The choice is the feature; there is nothing mechanical to grant,
 *  so the effect text goes on the feature itself.
 *
 *  Defaulted to `features`/`build` because that is the shape every other
 *  "the pick IS the feature" group in the project uses, and
 *  scripts/verify-content.mjs requires both on every subclass group. */
export function namedPick(id, text, names, extra = {}) {
  return {
    id,
    label: text,
    category: "features",
    choiceKind: "build",
    minSelections: 1,
    maxSelections: 1,
    options: names.map((n) => ({ id: `${id}-${slug(n)}`, name: n })),
    ...extra,
  };
}

// --- Vocabulary shared by several groups -------------------------------------

const ARTISAN_TOOLS = [
  "Alchemist's Supplies", "Brewer's Supplies", "Calligrapher's Supplies",
  "Carpenter's Tools", "Cartographer's Tools", "Cobbler's Tools",
  "Cook's Utensils", "Glassblower's Tools", "Jeweler's Tools",
  "Leatherworker's Tools", "Mason's Tools", "Painter's Supplies",
  "Potter's Tools", "Smith's Tools", "Weaver's Tools", "Woodcarver's Tools",
];

/** The 2024 dwarf base rule: smith's, brewer's or mason's tools. */
export const DWARF_BASE_TOOLS = ["Smith's Tools", "Brewer's Supplies", "Mason's Tools"];

export { ARTISAN_TOOLS };

/** Choose a skill or a language in one group (Cavalier, Samurai).
 *
 *  Cross-category shape only. A flat `options` list is NOT included as a
 *  convenience: a flat renderer would then offer the skills with nothing
 *  attached, and a pick that records a name without granting the
 *  proficiency is exactly the bug this whole batch exists to fix.
 *  `groupOptionsOf` merges the categories, so every reader still sees the
 *  full set. */
export function skillOrLanguagePick(id, text, extra = {}) {
  return {
    id,
    label: text,
    category: "skills",
    choiceKind: "build",
    minSelections: 1,
    maxSelections: 1,
    categories: [
      {
        id: `${id}-skills`,
        label: "A skill",
        options: SKILLS.map((s) => ({
          id: `${id}-${s.id}`,
          name: s.label,
          description: s.description || "",
          statModifiers: [{ targetFieldId: `${s.id}Prof`, op: "grant" }],
        })),
      },
      {
        id: `${id}-languages`,
        label: "A language",
        options: LANGUAGES.filter((n) => n !== "Common").map((n) => ({
          id: `${id}-${slug(n)}`,
          name: n,
          statModifiers: [{ targetFieldId: "languages", op: "grantTag", value: n }],
        })),
      },
    ],
    ...extra,
  };
}

export { label as titleCase };

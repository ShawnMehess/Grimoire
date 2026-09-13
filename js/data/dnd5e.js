// Ruleset registry and plain data-driven level-up resolver.
// A ruleset is content, not sheet-rendering code.
//
// This used to ship a hardcoded copy of the 2014 and 2024 PHB SRD
// content (every core class, subclass list, and spell-slot/spells-
// known table) baked directly into this file. That's exactly the
// "default D&D content" that kept showing up no matter what got
// imported or deleted from Firestore — it was never data sitting in
// a database, it was code, shipped with the site itself. It's gone
// now. Below is a single, genuinely empty "Homebrew" ruleset — the
// mechanism (rulesetId tagging, dropdownAccess narrowing, the
// Leveling tab's guided flow) is all still here, it just has nothing
// pre-loaded into it. Everything it knows comes from what you import
// into the Bundle Library and tag with this ruleset.
//
// KNOWN GAP, on purpose rather than faked: spell-slot counts and
// spells-known/prepared counts (slotsFor/SPELLCASTING below) have no
// import-driven source at all in this codebase yet — getLevelUpPlan
// only ever returns slots for a class defined right here in this
// file. With RULESETS' classes list empty, that means every class
// now correctly shows ZERO slots instead of silently reusing a real
// PHB class's numbers — but building a real fix (spell-slot tables
// coming from your imported JSON, the same way stat modifiers and
// feature grants already do) is a follow-up, not something silently
// invented here. See the project chat/notes for the suggested design
// (driving slots1-slots9 off per-level statModifiers on the Class
// bundle, gated by minLevel, the same mechanism everything else on a
// bundle already uses).

export const RULESETS = [
  {
    id: "homebrew",
    name: "Homebrew",
    classes: [], // populate via Bundle Library imports tagged "homebrew"
  },
];

export function listRulesets() {
  return RULESETS.map(({ id, name }) => ({ id, name }));
}

export function getRuleset(id) {
  return RULESETS.find((ruleset) => ruleset.id === id) || null;
}

export function getRulesetClass(rulesetId, className) {
  return getRuleset(rulesetId)?.classes.find((entry) => entry.name === className) || null;
}

function slotsFor(entry, level) {
  // No hardcoded slot tables left (see file header) — a classEntry
  // sourced purely from imported bundle data has no .caster/slot table
  // attached to it yet, so this always returns "nothing to show"
  // rather than quietly borrowing a real PHB class's numbers.
  return [];
}

// No hardcoded spellcasting tables left (see file header). Returns
// null for every class until a real import-driven source exists —
// null is exactly what "this class isn't a spellcaster" already means
// to every caller (spellLimitFor in rulesEngine.js, renderSpellPicker
// in customSheet.js), so nothing breaks; casters just show no numbers
// yet instead of PHB numbers.
export function getSpellcastingInfo(className) {
  return null;
}

export function getLevelUpPlan(rulesetId, className, level, selectedSubclass = "") {
  const ruleset = getRuleset(rulesetId);
  const classEntry = getRulesetClass(rulesetId, className);
  if (!ruleset || !classEntry || !Number.isInteger(level) || level < 1 || level > 20) return null;
  return {
    ruleset,
    classEntry,
    level,
    slotChanges: slotsFor(classEntry, level),
    subclassChoices: !selectedSubclass && level >= classEntry.subclassLevel ? classEntry.subclasses : [],
    needsSubclass: !selectedSubclass && level >= classEntry.subclassLevel,
  };
}

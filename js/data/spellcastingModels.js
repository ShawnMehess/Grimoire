// spellcastingModels.js
//
// Which of the three spell lists a class keeps, per ruleset.
//
// 5e has three caster shapes and they are not variations on one another:
//
//   known-only     Sorcerer, Bard, Warlock, 2014 Ranger. One list. Spells on
//                  it are ready to cast; nothing is "prepared".
//   full-list      Cleric, Druid, Paladin, Artificer. No personal list at
//                  all - the player prepares N spells out of everything the
//                  class can cast, and the rest of the class list is not
//                  recorded anywhere.
//   spellbook      Wizard. A personal list, AND a prepared subset of it.
//
// The UI needs to know which, because it changes what lines exist, what they
// are called, where the options come from, and whether one is locked until
// the other is filled.
//
// WHY A CONFIG AND NOT A CLASS-NAME CHECK
//
// `getSpellcastingInfo` already exposes a `style` of "known" or "prepared",
// derived from whether the class appears in a spells-known table. That is
// enough to tell known-only from prepared, and NOT enough to tell a Wizard
// from a Cleric - both are style "prepared". The Wizard is the one class whose
// prepared spells come out of a list the character owns, and that difference
// is the whole of the spellbook UI.
//
// So the config is explicit, keyed by ruleset first and class second. A new
// class or a new rulesystem adds one entry; nothing else in the app needs to
// learn its name. Ruleset-keyed rather than global because the user is right
// that 2024 changes the model for several of these - and because a global
// table would have nowhere to put a per-rulesystem override.
//
// `deriveSpellcastingModel` is the fallback for a class with no entry, so
// homebrew and any class added to a ruleset without touching this file still
// gets the correct shape for its `style`.

/** @typedef {object} SpellcastingModel
 *  @property {boolean} hasKnownList   A personal list of spells the class keeps.
 *  @property {string}  knownLabel     What to call it ("Spellbook", "Spells Known", "Spells").
 *  @property {"limit"|"unlimited"} knownCap
 *           Whether the known list has a quota. "limit" takes it from
 *           spellLimitFor's total; "unlimited" is the spellbook, where 5e
 *           caps the PREPARED subset instead and the book itself is bounded
 *           only by what the class can cast.
 *  @property {boolean} hasPreparedList Whether there is a prepared subset to choose.
 *  @property {string}  preparedLabel  What to call that line.
 *  @property {"known"|"classList"} preparedFrom
 *           "classList" - prepare straight out of the class list (no personal
 *           list is kept, so there is nothing to lock behind).
 *           "known"     - prepare out of the character's own list, which is
 *           why this one is locked until that list has spells in it.
 *  @property {boolean} countsCantrips Whether cantrips sit in the prepared
 *           count. False everywhere in this data: cantrips are always known,
 *           never prepared.
 */

/* There used to be a `UNLIMITED_SPELL_CAP = 9999` here, used as the cap for
 * any line whose model said `knownCap: "unlimited"`. It was how a Wizard's
 * spellbook was made not to bind - and it reached the player as a button
 * reading "Choose 9999", which reads as a bug in the number, not as a fact
 * about spellbooks.
 *
 * "Uncapped" never needed a stand-in number. A spellbook can hold every spell
 * the class can cast at the levels in question, and that set is countable, so
 * the line now takes that count as its cap (see creationSpellPickGroups' 
 * `spellbookCapFor`). Where it cannot be counted - no Spell List imported - the
 * line is not offered at all, because a picker whose ceiling is unknown is the
 * thing this replaces.
 *
 * The rules fact itself is unchanged and still lives in `knownCap`: 5e caps a
 * Wizard's PREPARED subset, not the book. */

/** The models that are not derivable from `style`, keyed ruleset -> class. */
const MODELS = {
  "dnd5e-2014": {
    // Known-only. `style` derives these correctly (Bard, Sorcerer, Warlock,
    // Ranger are all in the spells-known table), so they are not listed -
    // see deriveSpellcastingModel.
    //
    // Spellbook. The one class with BOTH lists, and the only one whose
    // prepared line can be locked behind a list the player owns.
    Wizard: {
      hasKnownList: true,
      knownLabel: "Spellbook",
      // 5e gives a Wizard no spellbook quota - you copy what you can cast,
      // and the number is bounded by the class list, not by a table. The
      // number that IS capped for a Wizard is the prepared subset below, so
      // the spellbook line must not borrow `limit.spells` as its own cap.
      knownCap: "unlimited",
      hasPreparedList: true,
      preparedLabel: "Prepared Spells",
      preparedFrom: "known",
    },
  },
};

/** The shape a class gets when no ruleset entry names it: derived from its
 *  `style`, which is the only per-class spellcasting fact the rules data
 *  itself carries.
 *
 *  style "known" -> one personal list, no prepared subset. This is the right
 *  default for every known caster including 2024 ones.
 *
 *  style "prepared" -> no personal list; prepare out of the class list. Also
 *  right for every full-list preparer. A Wizard that appears in a ruleset
 *  without a config entry would get this shape and its spellbook line would
 *  be missing, which is why Wizard is listed explicitly above rather than
 *  special-cased by name in here.
 *
 *  A non-caster returns null, which is the caller's cue to show nothing.
 *
 *  deps: { infoFor } — the getSpellcastingInfo-shaped accessor. Pure. */
export function deriveSpellcastingModel(className, { infoFor = () => null } = {}) {
  const info = infoFor(className);
  if (!info) return null;
  if (info.style === "known") {
    return {
      hasKnownList: true,
      knownLabel: "Spells Known",
      knownCap: "limit",
      hasPreparedList: false,
      preparedLabel: "Prepared Spells",
      preparedFrom: "known",
      countsCantrips: false,
    };
  }
  return {
    hasKnownList: false,
    knownLabel: "Spells Known",
    knownCap: "limit",
    hasPreparedList: true,
    preparedLabel: "Prepared Spells",
    // No personal list exists to prepare out of.
    preparedFrom: "classList",
    countsCantrips: false,
  };
}

/**
 * The spellcasting model for a class under a ruleset: the explicit entry when
 * the ruleset has one, else the derived shape. Ruleset-first so a future
 * 2024 ruleset can override any class here without touching this class's
 * entry under 2014.
 *
 * `rulesetId` is matched exactly, then falls back to the derived shape. It is
 * NOT matched prefix-wise on purpose: "dnd5e-2014" and "dnd5e-2024" share a
 * prefix, and a prefix match would silently give every 2024 character the
 * 2014 model's Wizard spellbook.
 *
 * deps: { infoFor }. Pure. */
export function spellcastingModelFor(className, rulesetId, { infoFor = () => null } = {}) {
  const entry = MODELS[rulesetId]?.[className];
  if (entry) return { ...entry, countsCantrips: false };
  return deriveSpellcastingModel(className, { infoFor });
}

/** Every ruleset that has explicit spellcasting models, for tests and for a
 *  future "unsupported combination" warning. */
export function rulesetsWithSpellcastingModels() {
  return Object.keys(MODELS);
}

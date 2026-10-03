// multiclassLevels.js
//
// The level arithmetic behind a guided level-up: when a character takes a
// level, WHICH class gains it and WHAT level does that class reach.
//
// WHY THIS IS ITS OWN MODULE
//
// All of this used to live inline in renderRulesetLevelGuide() in
// js/render/customSheet.js, spread across five sites. Four of them agreed.
// The fifth did not:
//
//   classLevelInfo()       took the primary's level as primaryLevel
//   getMechanicsList()     took the primary's level as `level`
//
// For a single-class character those are the same number, so the divergence
// was invisible. For a Fighter 5 / Rogue 2 taking level 8 they are 6 and 8:
// `level` is the level BEING TAKEN (the sheet total at that step), while
// `primaryLevel` is that total minus the levels already banked in
// secondaries. The Fighter is level 6 when it takes that level, not 8.
//
// The two call sites sat 30 lines apart with an identical shape and no shared
// helper, which is the only reason they could disagree. The comment above
// classLevelInfo() even stated the correct rule ("total minus applied
// secondaries, not the total itself") while the code below it did the
// opposite.
//
// So the arithmetic is written once here, and the five sites call it. The
// bug cannot recur by someone re-deriving it inline.
//
// WHAT "PRIMARY LEVEL" MEANS
//
// A sheet carries one Level field, and it is the CHARACTER's total: Fighter
// 5 + Rogue 2 shows Level 7. `primaryLevel` is not that - it is how high the
// primary class itself has risen, which is the total minus every level
// already spent on a secondary. It is the number that has to be fed to a
// class's own level plan for its features, hit die, ASI and spell slots to
// be right.
//
// This distinction is why a level typed straight in (3 -> 5) walks one level
// at a time. Level 4 is taken against the primary's post-apply level first,
// and level 5 on the next pass, rather than both being computed against the
// sheet total and double-counting HP and slots.

/** How many levels of `entries` (the applied secondaries) hold levels.
 *  Defensive on the shape: entries arrive from persisted character state,
 *  where a non-numeric `levels` is possible on old documents. */
function appliedSecondaryLevels(entries) {
  return (entries || []).reduce((n, e) => n + (Number(e?.levels) || 0), 0);
}

/**
 * The level the primary class reaches once the level being taken is applied.
 *
 * `level` is the level being taken (a sheet total), NOT the primary's own
 * level. The difference is exactly the levels already spent on secondaries.
 * Floored at 1, because a character always has at least one level in their
 * first class even if the secondary bookkeeping says otherwise.
 */
export function primaryLevelFor(level, entries = []) {
  return Math.max(1, (level ?? 1) - appliedSecondaryLevels(entries));
}

/**
 * The level a named class reaches, once the level being taken is applied to
 * it. This is the number to hand a class's level plan.
 *
 *   - the primary class      -> primaryLevelFor()
 *   - an applied secondary   -> its banked levels, plus one
 *   - no class named         -> the level being taken (nothing to offset)
 *   - a class not on the sheet -> 1
 *
 * `className` is the class that GAINS the level, which is not always the
 * primary: mid-multiclass the player picks, and a brand-new class is named
 * before it has any levels.
 */
export function levelReachedByClass({ level, entries = [], primaryName = "", className = "" } = {}) {
  if (!className) return level ?? 1;
  if (className === primaryName) return primaryLevelFor(level, entries);
  const entry = (entries || []).find((e) => e?.name === className);
  if (entry) return (Number(entry.levels) || 0) + 1;
  return 1;
}

/**
 * The per-class level breakdown to plan a guided level-up against, AFTER the
 * level being taken has been added.
 *
 * Each slice is one class with the level it will be at. The primary only
 * grows when it is the class being taken - the Level field already holds the
 * new total, so a primary that is not being taken is one lower than its own
 * post-apply figure. An applied secondary grows only if it is the one being
 * taken. A brand-new class enters at 1.
 *
 * Zero-and-negative slices are dropped: a class with no levels is not a
 * caster and contributes nothing, and including it would ask the slot
 * planner to plan level 0 for it.
 *
 * Pure, and the shape `multiclassSlotsFor()` consumes.
 */
export function postApplyClassSlices({
  level,
  entries = [],
  primaryName = "",
  levelClass = "",
  takingNewClass = false,
  newClassName = "",
} = {}) {
  const takingPrimary = !levelClass || levelClass === primaryName;
  const primary = primaryLevelFor(level, entries);
  // When the primary is NOT the class being taken it does not grow this pass,
  // so it sits one below its own post-apply figure.
  const postPrimary = takingPrimary ? primary : primary - 1;

  const pendingNew = takingNewClass && newClassName ? [{ name: newClassName, levels: 1 }] : [];
  return [
    { name: primaryName, levels: postPrimary },
    ...(entries || []).map((e) => ({
      name: e?.name,
      levels: (Number(e?.levels) || 0) + (!takingNewClass && e?.name === levelClass ? 1 : 0),
    })),
    ...pendingNew,
  ].filter((s) => s.name && s.levels > 0);
}

/**
 * The subclass a class should be read at, for a given level being taken.
 * The primary reads the sheet's own Subclass dropdown; an applied secondary
 * reads the subclass recorded against its entry. A brand-new class has
 * neither yet.
 */
export function subclassNameForClass({ primaryName = "", primarySubclass = "", entries = [], className = "" } = {}) {
  if (!className || className === "__new") return "";
  if (className === primaryName) return primarySubclass || "";
  return (entries || []).find((e) => e?.name === className)?.subclass || "";
}

// levelingModel.js
//
// One shape for every level-gated grant or removal, regardless of
// category:
//
//   {
//     id, type,
//     conditions: [ { race?, class?, subclass?, minLevel? }, ... ],
//     effect: { ... },          // shape depends on type
//     removalConditions: [ ... ]
//   }
//
// WHY THIS IS A PROJECTION AND NOT A MIGRATION
// ---------------------------------------------
// The data already exists in five shapes that each carry their own
// `minLevel`: statModifiers, featureGrants, resourceGrants, choiceGroups
// and dropdownAccess. Rewriting all of them into the shape above would
// mean touching every line of compiled content (defaultContent.js,
// subclassContent.js, featBundles.js, contentFixups.js) and would put the
// sourcing gates from docs/SUBCLASS-CONTENT-AUDIT-2026-09.md at risk -
// those check exact grant shapes and counts, and a silent content rewrite
// is precisely how unsourced text starts appearing.
//
// So the shape is COMPUTED from the existing data rather than stored in
// it. Every level-gated grant still flows through this module and is
// consumed in this shape, which is what the model is for; the difference
// is only that the source of truth stays the shapes the gates already
// vouch for. If the content is ever migrated, this becomes a pass-through
// and nothing downstream changes.
//
// The one thing that is NOT negotiable here is the condition semantics,
// because getting them subtly wrong means quietly showing a player a
// feature their character doesn't have - so conditionsMet is the most
// heavily tested function in the file.

// Kept local, mirroring packAllows in sheetLeveling.js / sheetWizard.js
// (which each keep their own copy so those modules stay dependency-free).
function packAllows(item, includedPacks) {
  if (!item || !item.requiresPack) return true;
  if (includedPacks == null) return true;
  const packs = Array.isArray(includedPacks) ? includedPacks : [includedPacks];
  return packs.includes(item.requiresPack);
}

export const GRANT_TYPES = [
  "stat",
  "proficiency",
  "spell",
  "ability",
  "feat",
  "language",
  "equipmentProficiency",
  "optionAccess",
];

/**
 * Do these conditions hold?
 *
 * Per the spec: entries in the array are OR'd, and the keys WITHIN one
 * entry are AND'd. So
 *
 *   [{ race: "Elf", minLevel: 3 }, { class: "Rogue" }]
 *
 * means "an Elf at 3+, or a Rogue". An empty entry `{}` matches
 * everything (no constraints stated), which is why the OR-reduction can't
 * just take the first truthy entry and stop - it has to check them all.
 *
 * `minLevel` compares against the context's level. Absent keys are not
 * constraints: an entry with no `race` doesn't require a race.
 */
export function conditionsMet(conditions, context = {}) {
  const list = Array.isArray(conditions) ? conditions : conditions ? [conditions] : [];
  if (!list.length) return true; // no stated conditions = unconditional
  return list.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const { race, class: className, subclass, minLevel } = entry;
    // Only a STATED key constrains. This is what makes a partial entry
    // like { minLevel: 3 } mean "anyone at 3+".
    if (race != null && !sameName(context.race, race)) return false;
    if (className != null && !sameName(context.class, className)) return false;
    if (subclass != null && !sameName(context.subclass, subclass)) return false;
    if (minLevel != null) {
      // Both sides must be real numbers. A level gate we cannot evaluate
      // fails rather than passing: treating a junk minLevel as "no
      // constraint" would show a player a feature their character hasn't
      // earned, which is the one direction of error worth being strict
      // about (see the AND/OR note at the top of this file).
      const gate = Number(minLevel);
      const level = Number(context.level);
      if (!Number.isFinite(gate) || !Number.isFinite(level) || level < gate) return false;
    }
    return true;
  });
}

function sameName(actual, expected) {
  return String(actual ?? "").trim().toLowerCase() === String(expected ?? "").trim().toLowerCase();
}

/** The context a character's grants are evaluated in. Built once per
 *  render rather than passed around, so every grant sees the same view
 *  of who the character is. */
export function levelingContextFor(character, level = null) {
  const rules = character?.rules || {};
  const resolved = Number(level ?? rules.level ?? 1);
  return {
    level: Number.isFinite(resolved) ? resolved : 1,
    race: rules.species || rules.race || character?.rules?.species || "",
    class: rules.class || rules.className || "",
    subclass: rules.subclass || "",
  };
}

/** Classify a statModifier's target into the spec's type vocabulary.
 *  Derived from the op and the field id rather than declared, so it stays
 *  right when a bundle is hand-edited. Anything unrecognized is still a
 *  "stat" grant rather than being dropped - a grant we can't classify is
 *  a grant the player can still see, which is better than one that
 *  vanished.
 *
 *  The op is the stronger signal, and specifically `grantTag` is: the
 *  armor/weapon/tool proficiency lists are TAGLISTS (a set of tag
 *  strings), so they're granted with grantTag, while skills and saving
 *  throws are individual checkboxes granted with plain `grant`. Both end
 *  in "Prof", so the id alone can't tell them apart - armorProf and
 *  stealthProf would both read as "proficiency". */
export function statModifierType(mod) {
  const id = String(mod?.targetFieldId || "");
  if (mod?.op === "grantTag") return "equipmentProficiency";
  if (/SaveProf$/.test(id)) return "proficiency";
  if (/Prof$/.test(id)) return "proficiency";
  if (/Score$/.test(id)) return "ability";
  if (/spell|Spell/.test(id)) return "spell";
  return "stat";
}

/** Turn one bundle's own grant shapes into the unified shape. Pure, and
 *  the single place the five shapes become one. */
export function grantsIn(bundle, { source = "", kind = "" } = {}) {
  if (!bundle) return [];
  const out = [];

  const push = (type, effect, minLevel, shape, index) => {
    // The source SHAPE is part of the id, not just the type: featureGrants
    // and resourceGrants both project to "ability", so keying on type
    // alone would give two different grants the same id.
    const id = [kind || "grant", source || "unnamed", shape, index].join(":");
    out.push({
      id,
      type,
      // A minLevel on the source shape becomes a single unconditional
      // entry: "everyone at N+", which is exactly what it meant.
      conditions: minLevel == null ? [] : [{ minLevel }],
      effect,
      removalConditions: [],
    });
  };

  (bundle.statModifiers || []).forEach((mod, i) => {
    push(statModifierType(mod), { ...mod }, mod.minLevel, "stat", i);
  });
  (bundle.featureGrants || []).forEach((grant, i) => {
    push("ability", { name: grant.name, description: grant.description }, grant.minLevel, "feature", i);
  });
  (bundle.resourceGrants || []).forEach((grant, i) => {
    push("ability", { name: grant.name, maximum: grant.maximum, reset: grant.reset }, grant.minLevel, "resource", i);
  });
  (bundle.choiceGroups || []).forEach((group, i) => {
    push("optionAccess", { groupId: group.id, label: group.label, minSelections: group.minSelections, maxSelections: group.maxSelections }, group.minLevel, "choice", i);
  });
  (bundle.dropdownAccess || []).forEach((rule, i) => {
    push("optionAccess", {
      targetFieldId: rule.targetFieldId,
      targetFieldName: rule.targetFieldName,
      allowedChoiceIds: rule.allowedChoiceIds,
      allowedChoiceNames: rule.allowedChoiceNames,
    }, rule.minLevel, "access", i);
  });

  return out;
}

/** Every grant from a character's active bundles, in the unified shape,
 *  tagged with where it came from so the leveling views can group and
 *  label it. `bundles` is [{ name, kind, bundle }]. */
export function allGrantsIn(bundles = [], { includedPacks = null } = {}) {
  const out = [];
  for (const entry of bundles) {
    if (!entry?.bundle) continue;
    for (const grant of grantsIn(entry.bundle, { source: entry.name, kind: entry.kind })) {
      // A pack-gated rule that isn't in play is not a grant the player
      // can rely on, so it never reaches the views.
      if (includedPacks && !packAllows(grant.effect, includedPacks)) continue;
      out.push({ ...grant, source: entry.name, kind: entry.kind });
    }
  }
  return out;
}

/** Filter to the grants that hold at `context`. */
export function activeGrantsIn(grants = [], context = {}) {
  return grants.filter((g) => conditionsMet(g.conditions, context));
}

/** Grants still to come — the "at a glance" tab's whole job. Grouped by
 *  the level they unlock at, so a tab can read straight off it. Grants
 *  with no level gate are excluded: they already apply, so listing them
 *  under "coming up" would be noise. */
export function upcomingGrantsByLevel(grants = [], context = {}) {
  const byLevel = new Map();
  for (const grant of grants) {
    const levels = levelsIn(grant.conditions);
    // A grant gated only on race/class (no level) applies now, not later.
    if (!levels.length) continue;
    for (const level of levels) {
      if (level <= context.level) continue;
      // Re-check the FULL condition set at the future level, not just the
      // level. Filtering to "active now" first would drop every future
      // grant, and would also miss a race-gated grant that starts at 5 -
      // this is where the OR/AND semantics actually have to hold up.
      if (!conditionsMet(grant.conditions, { ...context, level })) continue;
      if (!byLevel.has(level)) byLevel.set(level, []);
      byLevel.get(level).push(grant);
    }
  }
  return [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, entries]) => ({ level, grants: entries }));
}

/** Every level named in a grant's conditions, for the OR-across / AND-within
 *  shape an entry can take. */
function levelsIn(conditions) {
  const levels = new Set();
  for (const entry of Array.isArray(conditions) ? conditions : []) {
    if (entry?.minLevel != null) levels.add(Number(entry.minLevel));
  }
  return [...levels].filter(Number.isFinite);
}

/** The levels at which a character has something to do, for the guided
 *  walkthrough: one step per level gained, ascending, and only up to the
 *  level they're actually at. */
export function levelingStepsIn(grants = [], context = {}) {
  const levels = new Set();
  for (const grant of grants) {
    for (const level of levelsIn(grant.conditions)) {
      if (level > 1 && level <= context.level) levels.add(level);
    }
  }
  return [...levels].sort((a, b) => a - b).map((level) => ({
    level,
    grants: activeGrantsIn(grants, { ...context, level }),
  }));
}

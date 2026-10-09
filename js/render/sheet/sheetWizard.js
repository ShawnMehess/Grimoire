// sheetWizard.js
//
// Pure wizard helpers extracted from customSheet.js.
// DOM rendering stays in customSheet.js for now; all list math,
// step navigation, and spell-catalog lookups live here testably.

import { richGameTextNodes } from "./richText.js";
import { briefDescription, capitalizeFirst, splitAbilityTokens, abilityTooltip, humanizeGameText, categorizeChoiceGroup, ABILITY_GLOSSARY } from "./sheetMechanics.js";
import { spellGist, spellHasMoreThanGist } from "../../data/spellGists.js";
import { el, animateWith } from "./sheetHelpers.js";
import { spellLinkNodes } from "./spellLinks.js";
import { contentIdMatches } from "../../data/dnd5e.js";

export function isStepApplicable(step) {
  return !step.isApplicable || step.isApplicable();
}

/** Whether a choice group or option may show for the given content
 *  packs. Items without `requiresPack` always show; gated items show
 *  only when their named pack (e.g. "tashas" for Tasha's optional
 *  rules) is included. A null/undefined pack list means "unknown
 *  context" and shows everything, so older callers without pack
 *  plumbing keep working. Pure. */
export function packAllows(item, includedPacks) {
  if (!item || !item.requiresPack) return true;
  if (includedPacks == null) return true;
  const packs = Array.isArray(includedPacks) ? includedPacks : [includedPacks];
  return packs.includes(item.requiresPack);
}

/** A choice group filtered to the packs currently included: gated
 *  options (including inside cross-category `categories`) are
 *  removed, and a group left with nothing to offer — or itself gated
 *  — comes back null. Returns the original object untouched when
 *  nothing is gated out, so bundle identity stays stable. Pure. */
export function filterGroupByPack(group, includedPacks) {
  if (!group) return null;
  if (!packAllows(group, includedPacks)) return null;
  const filterOptions = (options) => (options || []).filter((o) => packAllows(o, includedPacks));
  const options = Array.isArray(group.options) ? filterOptions(group.options) : group.options;
  let categories = group.categories;
  if (Array.isArray(group.categories)) {
    categories = group.categories
      .map((c) => ({ ...c, options: filterOptions(c.options) }))
      .filter((c) => (c.options || []).length > 0);
  }
  const optionCount = (options || []).length
    + (categories || []).reduce((n, c) => n + ((c.options || []).length), 0);
  // A spell-pick group has no baked-in options at all: its options are the
  // spell catalog, filtered by level when the dialog opens (the High Elf
  // cantrip, the Bard's Magical Secrets). Dropping it here for having an
  // empty option list is what silently deleted those picks - the group was
  // removed before the caller could see its spellPick.
  if (optionCount === 0 && !group.spellPick) return null;
  const pruned =
    (options || []).length !== ((group.options || []).length)
    || (categories || []).length !== ((group.categories || []).length);
  if (!pruned) return group;
  return { ...group, options, categories };
}

export function creationChoiceGroupsForState(state, bundleLookup, includedPacks = null) {
  const level = state.level;
  const groups = [];
  const push = (category, name) => {
    if (!name) return;
    const lib = bundleLookup(category, name, state.rulesetId);
(lib?.choiceGroups || []).forEach((group, index) => {
      if (group.minLevel && level < group.minLevel) return;
      // Subclass-only groups. A Bard who is not a College of Lore does not
      // get that College's earlier Magical Secrets unlock, and a group
      // carrying `subclasses` says so. The name match is on fragments, the
      // same convention `magicalSecretsUnlocked` uses, so "lore" matches
      // "College of Lore".
      if (Array.isArray(group.subclasses) && group.subclasses.length) {
        const sub = String(state.subclass || "").toLowerCase();
        if (!group.subclasses.some((s) => sub.includes(String(s).toLowerCase()))) return;
      }
      const gated = filterGroupByPack(group, includedPacks);
      if (!gated) return;
      // Flat options OR cross-category options count - a group with
      // neither has nothing to offer (and a cross-category group with
      // no flat list must NOT be mistaken for an empty group). A spell
      // pick is the third case: its options are the catalog, built when
      // the dialog opens, so a group with only a `spellPick` is NOT empty.
      if (groupOptionsOf(gated).length === 0 && !gated.spellPick) return;
      const key = `creation:${category}:${name}:${group.id || index}`;
      // A group can be a FOLLOW-UP to another pick in the same bundle:
      // "Variable Trait → Skill Proficiency" needs a second row to
      // actually choose the skill. It stays out of the list until its
      // parent option is picked, so the user isn't shown a skill picker
      // for a trait they didn't take. `requiresOption` names the option
      // id; `requiresGroup` the group holding it (both relative to the
      // same bundle, so no cross-bundle keys are needed).
      if (gated.requiresOption) {
        const parent = (lib.choiceGroups || []).find((g) => g.id === gated.requiresGroup);
        const picked = choicesPickedFor(state, keyFor(parent, category, name));
        if (!picked.includes(gated.requiresOption)) return;
      }
      groups.push({
        ...gated,
        key,
        source: name,
        minLevel: Number.isFinite(group.minLevel) ? group.minLevel : 0,
        maxSelections: Math.max(1, Number.parseInt(group.maxSelections, 10) || 1),
        minSelections: Math.max(0, Number.parseInt(group.minSelections, 10) || 0),
      });
    });
  };
  push("Race", state.species);
  push("Class", state.className);
  push("Subclass", state.subclass);
  push("Background", state.background);
  return orderFollowUpGroups(groups);
}

/** The choice groups a single OPTION carries, stamped and gated.
 *
 *  Most of the project expresses "this pick needs a second pick" as a
 *  sibling top-level group with `requiresGroup`/`requiresOption` (see
 *  creationChoiceGroupsForState) — that's the pattern that works, and
 *  everything reads it. But a bundle can also hang `choiceGroups` on an
 *  option, and that shape had nowhere to go: nothing descended into it,
 *  no key was ever computed, and the option's own picker rendered only a
 *  name and a description. The High Elf's extra language and cantrip were
 *  sitting in exactly that shape, unreachable.
 *
 *  This lifts them into ordinary, keyed groups so the existing inline
 *  pick machinery (languages dropdown, dialog-backed picks) can render
 *  them with no further special-casing.
 *
 *  `parentKey` is the owning group's key, so a nested key reads
 *  `creation:Race:Elf:elf-subrace:elf-subrace-high:elf-subrace-high-cantrip`
 *  — unique by construction, since it is built from the ids above it.
 *
 *  Gated on the option being picked: an un-taken option contributes no
 *  rows, same rule as a sibling follow-up. `pickedIds` is the parent
 *  group's stored picks. Pure. */
export function nestedChoiceGroupsFor(option, { parentKey, pickedIds = [], source = null } = {}) {
  const nested = option?.choiceGroups;
  if (!Array.isArray(nested) || !nested.length) return [];
  // No parent key means no place to store a pick, so the groups would
  // render controls that write nowhere. Drop them rather than pretend.
  if (!parentKey) return [];
  if (!pickedIds.includes(option.id)) return [];
  const out = [];
  nested.forEach((group, index) => {
    if (group?.minLevel && !Number.isFinite(Number(group.minLevel))) return;
    if (groupOptionsOf(group).length === 0) return;
    out.push({
      ...group,
      key: `${parentKey}:${option.id}:${group.id || index}`,
      source: source || group.source || null,
      // An embedded group's own source is the option it hangs off, so a
      // "which trait was this from" readout names the subrace, not the
      // race's top-level pick.
      parentOptionId: option.id,
      parentGroupKey: parentKey,
      minLevel: Number.isFinite(group.minLevel) ? group.minLevel : 0,
      maxSelections: Math.max(1, Number.parseInt(group.maxSelections, 10) || 1),
      minSelections: Math.max(0, Number.parseInt(group.minSelections, 10) || 0),
    });
  });
  return out;
}

/** Move each group carrying `sortAfter` to sit directly after the group it
 *  names, so a follow-up row appears under the pick that caused it rather
 *  than wherever the bundle happened to list it. A `sortAfter` naming a
 *  group that isn't present (or that is itself gated out right now) is
 *  left where it is rather than dropped — an unpicked follow-up simply
 *  isn't in the list at all. */
function orderFollowUpGroups(groups) {
  const out = [...groups];
  for (const group of groups) {
    if (!group?.sortAfter) continue;
    const anchor = out.findIndex((g) => g.id === group.sortAfter);
    if (anchor === -1) continue;
    const at = out.indexOf(group);
    out.splice(at, 1);
    // Recomputed after the removal: removing a group ahead of the anchor
    // would otherwise shift it by one.
    out.splice(out.findIndex((g) => g.id === group.sortAfter) + 1, 0, group);
  }
  return out;
}

/** The choicesStore key a bundle's group is stored under, matching the
 *  shape built in creationChoiceGroupsForState. Shared so the follow-up
 *  gate above looks in the same place the pick was written. */
export function keyFor(group, category, name) {
  return `creation:${category}:${name}:${group?.id ?? ""}`;
}

function choicesPickedFor(state, key) {
  return state?.choices?.[key] || [];
}

export function creationFixedBundlesFor(state, bundleLookup) {
  // Positional [Race, Class, Subclass, Background] — deliberately NOT
  // filtered, so index-based readers (innateAbilitySections) stay
  // aligned when a slot is unpicked (null). Null-tolerant readers
  // (ownedSkillIdsFromBundles) skip nulls themselves.
  return [
    bundleLookup("Race", state.species, state.rulesetId),
    bundleLookup("Class", state.className, state.rulesetId),
    bundleLookup("Subclass", state.subclass, state.rulesetId),
    bundleLookup("Background", state.background, state.rulesetId),
  ];
}

/** Every option a choice group offers, flat or cross-category
 *  shaped — one helper so all readers agree on what "the group's
 *  options" means. Pure. */
export function groupOptionsOf(group) {
  return [
    ...(group?.options || []),
    ...((group?.categories || []).flatMap((c) => c.options || [])),
  ];
}

export function ownedSkillIdsFromBundles(fixedBundles = [], otherGroups = [], excludeGroupKey, choicesByKey = {}) {
  const owned = new Set();
  const collect = (mods) => {
    (mods || []).forEach((mod) => {
      if (mod.op === "grant") owned.add(mod.targetFieldId);
      // Tag grants (languages, armor/weapons/tools) join the same set
      // under a namespaced token so pickers can lock already-granted
      // tags exactly like already-granted skills.
      if (mod.op === "grantTag" && mod.value) owned.add(`tag:${mod.targetFieldId}:${mod.value}`);
    });
  };
  fixedBundles.forEach((bundle) => collect(bundle?.statModifiers));
  otherGroups.forEach((group) => {
    if (group.key === excludeGroupKey) return;
    const picks = choicesByKey[group.key] || [];
    groupOptionsOf(group).forEach((option) => {
      if (!picks.includes(option.id)) return;
      collect(option.statModifiers);
    });
  });
  return owned;
}

/** Express-setup picks for a set of choice groups: recommended names
 *  first (matched case-insensitively against what each group offers),
 *  then first-available options up to each group's minimum — locked
 *  defaults ride along on every group. Groups with no recommendation
 *  (subraces, feats, tools) fill first-available throughout, so
 *  Express always lands on a complete page the user then reviews.
 *  Returns `{ [groupKey]: [optionIds] }`. Pure. */
export function expressPicksFor(groups = [], preferredNames = []) {
  const want = new Set(
    (preferredNames || []).map((n) => String(n || "").trim().toLowerCase()).filter(Boolean)
  );
  const out = {};
  (groups || []).forEach((group) => {
    const options = groupOptionsOf(group);
    const need = Math.max(0, Math.min(group.maxSelections ?? 99, group.minSelections ?? 0));
    const picked = [...(group.lockedOptionIds || [])];
    const take = (option) => {
      if (picked.length - (group.lockedOptionIds || []).length >= need) return;
      if (!option || picked.includes(option.id)) return;
      picked.push(option.id);
    };
    // Recommended names first, in group order…
    options.forEach((option) => {
      if (option?.name && want.has(option.name.trim().toLowerCase())) take(option);
    });
    // …then first-available until the minimum is met.
    options.forEach(take);
    out[group.key] = picked;
  });
  return out;
}

/** Whether one choice option is redundant given an owned set from
 *  ownedSkillIdsFromBundles (a `grant` whose skill id is owned, or a
 *  `grantTag` whose namespaced token is owned). */
export function optionIsOwned(option, owned) {
  return (option?.statModifiers || []).some((mod) =>
    (mod.op === "grant" && owned.has(mod.targetFieldId))
    || (mod.op === "grantTag" && mod.value && owned.has(`tag:${mod.targetFieldId}:${mod.value}`)));
}

/** The family a pick group belongs to, or "" when it stands alone.
 *
 *  A single-pick list is a single decision only WITHIN itself. A sorcerer's
 *  Metamagic is one decision spread over three unlocks, and the rules let
 *  each unlock be taken once - so Quickened Spell at 3rd is Quickened Spell
 *  at 10th, and the second time has to be refused. A group that names a
 *  family shares it with its siblings, and the shared pure helpers below
 *  both read the picks and lock what is already taken. */
export function pickFamilyOf(group) {
  return typeof group?.pickFamily === "string" ? group.pickFamily : "";
}

/** Option ids already picked anywhere else in `groups` that share this
 *  group's family. The ids come back from the SIBLING groups, so the
 *  dialog has to map them onto its own options by name rather than by id
 *  - two groups build the same option id per prefix only by accident.
 *  Returns option NAMES, which is what `lockedIds` is matched against
 *  after the dialog maps its own list. Pure. */
export function familyTakenOptionNames(group, groups = [], choicesStore = {}) {
  const family = pickFamilyOf(group);
  if (!family) return [];
  const names = new Set();
  for (const other of groups || []) {
    if (other === group || pickFamilyOf(other) !== family) continue;
    const picked = choicesStore?.[other.key] || [];
    if (!picked.length) continue;
    for (const id of picked) {
      const option = (other.options || []).find((o) => o.id === id);
      if (option?.name) names.add(option.name);
    }
  }
  return [...names];
}

/** Common is known by default and can't be changed: wherever a
 *  language picker offers it, pre-select it, lock it, and keep it out
 *  of the pick budget (so "choose 2" still means two more). Operates
 *  on fresh group copies only — never bundle data. `categorizeFn`
 *  maps a group to its wizard page key ("languages" matters here). */
export function lockCommonInLanguageGroups(groups, categorizeFn) {
  (groups || []).forEach((group) => {
    if (!group || categorizeFn(group) !== "languages") return;
    const common = (group.options || []).find((o) => (o.name || "").trim().toLowerCase() === "common");
    if (!common) return;
    const locked = new Set(group.lockedOptionIds || []);
    if (!locked.has(common.id)) {
      locked.add(common.id);
      group.lockedOptionIds = [...locked];
    }
  });
  return groups;
}

/** Reconciles a starter dropdown's embedded choices against current
 *  canonical bundles (used for the Race dropdown, whose choices embed
 *  their bundles at creation): refreshes uncustomized older copies
 *  (identical to canonical modulo their choice groups — groups evolve
 *  independently and never mark a bundle customized), drops unselected
 *  choices for removed names, and appends missing current entries.
 *  Anything customized (or homebrew) is left strictly alone. Pure —
 *  returns { choices, selectedId, changed }; callers persist when
 *  changed is true. */
export function reconcileDropdownChoices(choices, selectedId, canonicalEntries, removedNames, newIdFn, cloneFn, legacyBundles = null) {
  const canonicalByName = new Map(((canonicalEntries || []).map((e) => [e.name, e.bundle])));
  const removed = new Set(removedNames || []);
  const strip = (bundle) => {
    if (!bundle) return null;
    const { choiceGroups, ...rest } = bundle;
    try {
      return JSON.stringify(rest);
    } catch {
      return null;
    }
  };
  let changed = false;
  const kept = [];
  const sameJson = (a, b) => {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  };
  for (const choice of choices || []) {
    const canonical = canonicalByName.get(choice.text);
    if (!canonical) {
      if (removed.has(choice.text) && choice.id !== selectedId) {
        changed = true;
        continue;
      }
      kept.push(choice);
      continue;
    }
    // Refresh when the embedded copy is either an uncustomized older
    // revision (same modulo its choice groups) or a recorded
    // pre-rework shape (see legacyRaceBundles) — anything else is
    // treated as customized and preserved verbatim.
    const legacies = (typeof legacyBundles?.get === "function" ? legacyBundles.get(choice.text) : null) || [];
    const isLegacy = legacies.some((legacy) => sameJson(choice.bundle, legacy));
    let refresh = isLegacy;
    if (!refresh) {
      try {
        refresh = (!choice.bundle || strip(choice.bundle) === strip(canonical))
          && !sameJson(choice.bundle, canonical);
      } catch {
        refresh = false;
      }
    }
    if (refresh) {
      kept.push({ ...choice, bundle: cloneFn(canonical) });
      changed = true;
      continue;
    }
    kept.push(choice);
  }
  for (const entry of canonicalEntries || []) {
    if (!kept.some((c) => c.text === entry.name)) {
      kept.push({ id: newIdFn(), text: entry.name, bundle: cloneFn(entry.bundle) });
      changed = true;
    }
  }
  if (!changed) return { choices, selectedId, changed: false };
  // New entries were appended in content order above; leave them there.
  // Re-sorting here undid that on every heal, which reordered a row's
  // dropdowns behind the player's back and broke up rows that read as a
  // set. Per-field alphabetizing is still available as an explicit opt-in
  // (see sortChoicesAlpha); it just isn't the default any more.
  const nextSelected = kept.some((c) => c.id === selectedId) ? selectedId : null;
  return { choices: kept, selectedId: nextSelected, changed: true };
}

/** Whether a choice group is satisfied: non-locked picks cover
 *  minSelections minus options that would grant something already
 *  owned (those don't need picking). Flat and cross-category shapes. */
export function groupPicksSatisfied(group, selectedIds = [], owned = new Set()) {
  if (!group) return true;
  const locked = new Set(group.lockedOptionIds || []);
  const allOptions = groupOptionsOf(group);
  const freebies = allOptions.filter((o) => !locked.has(o.id) && optionIsOwned(o, owned)).length;
  const counted = (selectedIds || []).filter((id) => !locked.has(id)).length;
  return counted >= Math.max(0, (group.minSelections || 0) - freebies);
}

/** Whether the Race pick is finished, not merely made.
 *
 *  A race that owns a `subrace` picker is a CONTAINER, not a choice: Elf
 *  grants nothing of its own (see isParentRace in sheetMechanics for the
 *  other half of that), so clicking Elf has not chosen a species - it has
 *  opened a list to choose one from. Treating the click as the selection is
 *  what let a player walk off the Identity page with a half-built ancestry
 *  and find out at Finish Setup.
 *
 *  Pure, so the page that gates on it and the page that lists what is still
 *  outstanding cannot disagree. `groupOptionsOf` reads the flat and the
 *  cross-category shapes alike, and a container with nothing in it counts as
 *  an ordinary race rather than blocking on a pick nothing can supply. */
export function racePickSatisfied({ raceName = "", subraceGroup = null, choices = {} } = {}) {
  if (!raceName) return false;
  if (!subraceGroup) return true;
  if (groupOptionsOf(subraceGroup).length === 0) return true;
  return groupPicksSatisfied(subraceGroup, choices?.[subraceGroup.key]);
}

/** Groups choice groups into "Your choices" sections by originating
 *  pick (the group's `source`, i.e. the race/class/subclass/background
 *  name that granted it), in first-appearance order. Groups with no
 *  source land in a trailing "Other" section so nothing silently
 *  vanishes from a merged step. Each section is
 *  `{ source, groups }` — the renderer puts one collapsible section
 *  per entry directly under its pick. Pure. */
export function sectionsForChoiceGroups(groups = []) {
  const bySource = new Map();
  for (const group of groups || []) {
    const source = (group?.source || "").trim() || "Other";
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push(group);
  }
  return [...bySource.entries()].map(([source, sectionGroups]) => ({ source, groups: sectionGroups }));
}

/** Whether every group in one section is satisfied. `ownedFor` is
 *  either a fixed owned Set (shared across groups) or a resolver
 *  `(groupKey) => Set` for callers whose owned set excludes the group
 *  being checked (see ownedSkillIdsFromBundles' excludeGroupKey).
 *  Pure — gating for one "Your choices" section. */
export function sectionGroupsSatisfied(groups = [], choicesStore = {}, ownedFor = null) {
  const ownedOf = typeof ownedFor === "function"
    ? ownedFor
    : () => (ownedFor instanceof Set ? ownedFor : new Set());
  return (groups || []).every((group) =>
    groupPicksSatisfied(group, choicesStore?.[group.key] || [], ownedOf(group.key)));
}

/** Whether every section in a merged step is satisfied — a merged
 *  step blocks Next until each of its sections is complete, not just
 *  until the page as a whole looks done. Pure. */
export function sectionsComplete(sections = [], choicesStore = {}, ownedFor = null) {
  return (sections || []).every((section) =>
    sectionGroupsSatisfied(section?.groups || [], choicesStore, ownedFor));
}

/** Sources of the sections still needing picks (in order) — for the
 *  "still to choose" hint on a merged step. Empty when complete.
 *  Pure. */
export function incompleteSectionNames(sections = [], choicesStore = {}, ownedFor = null) {
  return (sections || [])
    .filter((section) => !sectionGroupsSatisfied(section?.groups || [], choicesStore, ownedFor))
    .map((section) => section?.source || "Other");
}

/** Collapsed memory for "Your choices" sections, keyed by
 *  `${stepId}:${source}`. Choice sections rebuild on cross-step
 *  changes (full re-render), which would otherwise expand whatever
 *  the player just collapsed — same pattern as expandedChoiceRows.
 *  Not a Map of booleans: absent means expanded, the default. */
const collapsedChoiceSections = new Set();

export function isChoiceSectionCollapsed(key) {
  return collapsedChoiceSections.has(key || "");
}

export function setChoiceSectionCollapsed(key, collapsed) {
  if (collapsed) collapsedChoiceSections.add(key || "");
  else collapsedChoiceSections.delete(key || "");
}

/** A picked option's own name is the better label when it names
 *  something ("High Elf"), but an ASI slot names an ability instead
 *  ("STR"), where repeating the source reads better than the player
 *  seeing "+1 from STR".
 *
 *  An ability in a name is recognised in both forms the data uses: the
 *  abbreviation ("STR") and a signed long name ("+1 Strength"), which is
 *  what an ASI slot option is called. Without the second form, two +1
 *  Strength picks from one race read as two separate sources instead of
 *  one "+2 from Aasimar". */
function pickSourceLabel(source, option) {
  const name = String(option?.name || "").trim();
  if (!name) return source;
  const bare = name.replace(/^[+-]?\d+\s+/, "").trim();
  const isAbility = Object.values(ABILITY_GLOSSARY).some((entry) =>
    entry.abbr === name.toUpperCase() || entry.name.toLowerCase() === bare.toLowerCase());
  return isAbility ? source : name;
}

/** Ability-score bonuses granted by staged picks, broken out by where
 *  each point came from. `entries` is
 *  `[{ source, category, bundle }]` (Race/Class/Subclass/Background with
 *  their staged bundles) and `choices` is the picks store, because a
 *  racial bonus is as often on the subrace or ASI option the player
 *  CHOSE as on the race itself - and the free-form flexible-ASI groups
 *  carry their points on the stored pick, which matches no option at
 *  all. Only `add`-op modifiers targeting `${abilityId}Score` count.
 *
 *  Returns `{ [abilityId]: { bonus, sources: [{ label, value }] } }`,
 *  one `sources` entry per distinct contributor so the step can list a
 *  race bonus and a subrace bonus on their own lines. Points sharing a
 *  label are summed, so two picks off one source read as one line.
 *  Zero-bonus abilities map to `{ bonus: 0, sources: [] }`. Pure. */
export function abilityScoreBonusesFrom(entries = [], abilityIds = [], choices = {}) {
  const out = {};
  (abilityIds || []).forEach((id) => { out[id] = { bonus: 0, sources: [] }; });
  const addFrom = (mods, label) => {
    if (!label) return;
    (mods || []).forEach((mod) => {
      if (mod?.op !== "add" || !Number.isFinite(mod.value) || !mod.value) return;
      const id = (abilityIds || []).find((aid) => mod.targetFieldId === `${aid}Score`);
      if (!id) return;
      const line = out[id].sources.find((s) => s.label === label);
      if (line) line.value += mod.value;
      else out[id].sources.push({ label, value: mod.value });
      out[id].bonus += mod.value;
    });
  };
  (entries || []).forEach(({ source, category, bundle }) => {
    if (!source || !bundle) return;
    addFrom(bundle.statModifiers, source);
    (bundle.choiceGroups || []).forEach((group) => {
      const picked = choices[keyFor(group, category, source)];
      if (!Array.isArray(picked) || !picked.length) return;
      const chosen = new Set(picked.filter((value) => typeof value === "string"));
      groupOptionsOf(group).forEach((option) => {
        if (chosen.has(option.id)) addFrom(option.statModifiers, pickSourceLabel(source, option));
      });
      // The flexible-ASI store is an object holding its own modifiers,
      // not an option id, so nothing above can match it.
      picked.forEach((value) => {
        if (value && typeof value === "object") addFrom(value.statModifiers, source);
      });
    });
  });
  return out;
}

/** Revalidates staged creation picks after content books are removed:
 *  keeps every pick still offered under the remaining sources, clears
 *  only orphaned ones. `picks` is
 *  `{ species, className, subclass, background }`; `validNames` maps
 *  `"Race"|"Class"|"Subclass"|"Background"` to the names still
 *  offered. A subclass belongs to its class — when the class goes,
 *  the subclass goes with it without needing its own lookup. Returns
 *  `{ picks, removed }` where `removed` is
 *  `[{ category, name }]` for the caller's "what was removed" notice.
 *  Never clears on add (callers only invoke this for removals). Pure. */
export function revalidateStagedPicks(picks = {}, validNames = {}) {
  const next = { ...(picks || {}) };
  const removed = [];
  const drop = (key, category) => {
    if (!next[key]) return;
    const valid = validNames[category] || [];
    if (!valid.includes(next[key])) {
      removed.push({ category, name: next[key] });
      next[key] = "";
    }
  };
  drop("species", "Race");
  drop("className", "Class");
  if (!next.className) {
    if (next.subclass) {
      removed.push({ category: "Subclass", name: next.subclass });
      next.subclass = "";
    }
  } else {
    drop("subclass", "Subclass");
  }
  drop("background", "Background");
  return { picks: next, removed };
}

/** Drops staged choice-group picks whose pick no longer exists:
 *  `creation:Category:Name:group` keys survive only while `Name` is
 *  still the staged pick for that category. Feat (`feat:`),
 *  equipment-proficiency (`equipprof:`), and unknown keys pass
 *  through untouched. Returns `{ choices, pruned }` (`pruned` counts
 *  dropped keys for the caller's notice). Pure. */
export function pruneOrphanedChoiceKeys(choices = {}, picks = {}) {
  const live = [
    ["Race", picks?.species],
    ["Class", picks?.className],
    ["Subclass", picks?.subclass],
    ["Background", picks?.background],
  ]
    .filter(([, name]) => name)
    .map(([category, name]) => `creation:${category}:${name}:`);
  const kept = {};
  let pruned = 0;
  for (const [key, value] of Object.entries(choices || {})) {
    if (key.startsWith("creation:") && !live.some((prefix) => key.startsWith(prefix))) {
      pruned++;
      continue;
    }
    kept[key] = value;
  }
  return { choices: kept, pruned };
}

// --- Inline creation spell picks --------------------------------------------------------
//
// The Spells creation step is a commented-out block (see customSheet.js), so
// spell picking is an inline `spellPick` choice group on the class row - the
// same shape as proficiency, language and feat picks. These are the pure
// halves of that: which groups to offer, what their keys are, and what to do
// to the sheet's one global Spells Known list when a pick changes or dies.

/** Shown wherever a spell pick has nothing to offer because no Spell List
 *  has been imported. One sentence, in player language: it says what is
 *  missing, what to do about it, and that the sheet works without it.
 *  Exported so every spell surface says the same thing — the level-up
 *  picker and the creation wizard's inline spell picks both used to carry
 *  their own copy, one of which named a manager screen by its developer
 *  name. */
export const NO_SPELL_CATALOG_NOTE = "No Spell List imported yet, so there are no spells to pick from here. Import a Spell List from your libraries, or just type spell names straight onto the sheet's Spells Known list.";

/** The choicesStore key one inline creation spell pick is stored under.
 *  Mirrors the `creation:Category:Name:groupId` shape everything else uses, so
 *  the pick is pruned with the rest of its class and its spells can be traced
 *  back to the class that granted them. Pure.
 *
 *  `part` distinguishes the three spell lines a class can have: "cantrips",
 *  the class's known/spellbook list, and its prepared list. Before the
 *  per-level split was removed the leveled key was keyed by spell LEVEL
 *  (creation-spells-1, creation-spells-2, …) - see migrateSpellPickKeys. */
export function spellPickKey(className, part = "spells") {
  return `creation:Class:${className}:creation-${part}`;
}

/** Spell pick keys, and the picks they hold, under the pre-per-level shape.
 *
 *  `creation-spells-0` / `-1` / `-2` meant one pick per spell LEVEL, each
 *  given the full `limit.spells` total as its own cap. That was the bug this
 *  migration exists for: a level-5 Sorcerer was offered 6 + 6 + 6 against a
 *  limit of 6. The fix made the leveled line ONE pick spanning every
 *  available level, so the old keys have to be folded into it or every spell
 *  picked through them is orphaned - and an orphan key's spells are removed
 *  from Spells Known by orphanedSpellPickNames, which is a silent data loss
 *  for anyone who used the old build.
 *
 *  Folds in ascending level order and de-duplicates, so a name picked at two
 *  levels survives once. Returns the choices store with the new keys added
 *  and every old leveled key removed; the CANTRIP key is left alone, because
 *  `creation-spells-0` is spelled the same in both shapes and the spell level
 *  0 is still a real distinction.
 *
 *  Pure. Returns the input unchanged when there is nothing to migrate. */
export function migrateSpellPickKeys(choices = {}, { className } = {}) {
  const out = { ...(choices || {}) };
  if (!className) return out;
  const old = [];
  const pattern = new RegExp(`^creation:Class:${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:creation-spells-(\\d+)$`);
  for (const key of Object.keys(out)) {
    const m = key.match(pattern);
    if (m && Number(m[1]) > 0) old.push({ key, level: Number(m[1]) });
  }
  if (old.length === 0) return out;
  const merged = [];
  const seen = new Set();
  for (const { key } of old.sort((a, b) => a.level - b.level)) {
    for (const name of out[key] || []) {
      if (!name || seen.has(name)) continue;
      seen.add(name);
      merged.push(name);
    }
    delete out[key];
  }
  const target = spellPickKey(className, "spells");
  out[target] = [...new Set([...(out[target] || []), ...merged])];
  return out;
}

/** Spell names a no-longer-staged pick put on the sheet: every value of
 *  an orphaned `creation:` key that is actually in the Spells Known list,
 *  minus anything a SURVIVING creation pick still holds.
 *
 *  Spells Known is one global list, so without this a Wizard's four cantrips
 *  sit in it forever after the player switches to a Fighter. Membership of
 *  the list is the test, not a key pattern: a race's, class's or subclass's
 *  spell pick ids vary (`arcana-cantrips`, `circle-of-land-cantrip`,
 *  `bard-magical-secrets-6`, …), whereas a pick's stored VALUES are always
 *  the spell names the dialog wrote - the one shape a skill or feat pick
 *  never produces. A value that never reached the list contributes nothing,
 *  which is also the right answer for it.
 *
 *  "Surviving" is the same prefix rule pruneOrphanedChoiceKeys uses, so the
 *  two always agree about which keys are orphans - including nested keys
 *  like `creation:Race:Elf:elf-subrace:…:cantrip`, which stay as long as
 *  Elf is the staged species.
 *
 *  Spells the player added by hand are under no pick key at all, so they are
 *  never returned - which is the whole reason the record is kept on the key
 *  rather than inferred from the list. Pure. `picks` is the same
 *  `{ species, className, subclass, background }` shape
 *  pruneOrphanedChoiceKeys takes. */
export function orphanedSpellPickNames(choices = {}, picks = {}, knownItems = []) {
  const live = [
    ["Race", picks?.species],
    ["Class", picks?.className],
    ["Subclass", picks?.subclass],
    ["Background", picks?.background],
  ]
    .filter(([, name]) => name)
    .map(([category, name]) => `creation:${category}:${name}:`);
  const isLive = (key) => live.some((prefix) => key.startsWith(prefix));
  const textOf = (item) => (typeof item === "string" ? item : item?.text);
  const listed = new Set((knownItems || []).map(textOf).filter(Boolean));
  const heldElsewhere = new Set();
  for (const [key, names] of Object.entries(choices || {})) {
    if (!key.startsWith("creation:") || !isLive(key)) continue;
    (names || []).forEach((n) => heldElsewhere.add(n));
  }
  const out = [];
  for (const [key, names] of Object.entries(choices || {})) {
    if (!key.startsWith("creation:") || isLive(key)) continue;
    for (const name of names || []) {
      if (!name || !listed.has(name) || heldElsewhere.has(name) || out.includes(name)) continue;
      out.push(name);
    }
  }
  return out;
}

/** Reconciles the sheet's Spells Known list against one spell pick's new
 *  selection. Names the pick dropped come back OUT - they were the pick's to
 *  add - and names it keeps or newly adds go in, appended so the player's own
 *  ordering in the list survives. A name another live spell pick still holds
 *  is never removed, so overlapping picks (a High Elf cantrip and a Wizard's
 *  own) cannot delete each other's spells. `items` entries may be plain
 *  strings or `{ text }` objects; the shape is preserved. Returns
 *  `{ items, added, removed }`. Pure. */
export function applySpellPickToItems({ items = [], previous = [], next = [], heldByOtherPicks = [] } = {}) {
  const textOf = (item) => (typeof item === "string" ? item : item?.text);
  const held = new Set(heldByOtherPicks || []);
  const keep = new Set(next || []);
  const dropped = new Set((previous || []).filter((name) => !keep.has(name) && !held.has(name)));
  const out = [];
  const present = new Set();
  for (const item of items || []) {
    const text = textOf(item);
    if (dropped.has(text)) continue;
    if (text) present.add(text);
    out.push(item);
  }
  const added = [];
  for (const name of next || []) {
    if (present.has(name)) continue;
    present.add(name);
    out.push(name);
    added.push(name);
  }
  return { items: out, added, removed: [...dropped] };
}

/** Spells the staged bundles grant automatically - a domain's domain
 *  spells, an oath's oath spells, a circle's circle spells.
 *
 *  They arrive as `spellsKnown` statModifiers with op "addItem" and are
 *  already in the Spells Known list without the player doing anything. Two
 *  consequences for an inline pick: they must not be OFFERED (they are not a
 *  choice) and they already count toward what the class may hold, so the pick
 *  has to start from whatever is left. Deriving this from the bundles rather
 *  than a hand-written list means a new domain or oath is covered the day it
 *  is added. Pure given the bundles. */
export function alwaysPreparedSpellNames(bundles = [], level = 1) {
  const names = new Set();
  for (const bundle of bundles || []) {
    for (const mod of bundle?.statModifiers || []) {
      if (mod.targetFieldId !== "spellsKnown") continue;
      if (mod.op !== "addItem") continue;
      if (mod.minLevel && level < mod.minLevel) continue;
      if (mod.value) names.add(mod.value);
    }
  }
  return names;
}

/** The prepared-spells list after one prepared pick is accepted.
 *
 *  A parallel list of NAMES, living on the sheet field beside `items` rather
 *  than as a flag on each entry. That was the other option and it is the wrong
 *  one here: `field.items` is read as a flat array of strings by the spell
 *  link renderer, the level-up picker, `knownSpellNames`, export, print and
 *  the card meta lines. Changing the element shape to `{ text, prepared }`
 *  would touch all of them, and a saved character whose list is plain strings
 *  would read as "nothing is prepared" for every prepared caster - the exact
 *  silent behaviour the migration is supposed to avoid. A second list is
 *  additive: an existing character has no `preparedItems`, which reads as
 *  nothing prepared, which is the intended migration.
 *
 *  `previous`/`next` are the pick's old and new selections, so a deselected
 *  spell leaves. `alwaysPrepared` is the bundle-granted set, which is folded
 *  in here rather than stored: a domain spell is prepared whether or not the
 *  player chose it, and storing it would make it look like a pick they could
 *  remove. It is filtered back out of `next` so the stored list only ever
 *  holds genuine choices.
 *
 *  Preserves `previous` order for the spells that survive, so re-ordering is
 *  not a side effect of opening the dialog. Pure. */
export function preparedItemsWithAuto({ previous = [], next = [], alwaysPrepared = [] } = {}) {
  const auto = new Set(alwaysPrepared || []);
  const keep = new Set((next || []).filter((name) => name && !auto.has(name)));
  const out = [];
  for (const name of previous || []) {
    if (name && keep.has(name) && !out.includes(name)) out.push(name);
  }
  for (const name of keep) {
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** Whether a prepared pick is currently blocked: a class that prepares out of
 *  its own list has nothing to prepare from until that list has spells in it.
 *  Returns null when it is not locked, so the caller can put the reason in
 *  the bullet's own words rather than a generic string. Pure. */
export function preparedLineLock({ preparedFrom = "classList", knownNames = [] } = {}) {
  if (preparedFrom !== "known") return null;
  if ((knownNames || []).length) return null;
  return "Choose your spellbook spells first";
}

/** How many prepared spells the character has over their limit, counting 0
 *  when they are not over.
 *
 *  Always-prepared spells are counted in: they occupy a slot whether or not
 *  the player chose them, so a Cleric with a domain's two domain spells has
 *  two fewer of their own to pick.
 *
 *  Cantrips are excluded unless a model says otherwise - in this data no class
 *  prepares cantrips, and a cantrip is never a prepared slot.
 *
 *  `preparedFrom` decides whether `knownItems` is a filter at all:
 *
 *   "known"     - a Wizard prepares out of its own spellbook, so a prepared
 *                 name the character does not hold is not prepared. It can
 *                 happen: the spellbook is an editable textlist.
 *   "classList" - a Cleric prepares straight out of the class list and its
 *                 prepared spells are deliberately NOT on the spellbook (see
 *                 applySpellPickWrite). Requiring membership here would drop
 *                 every one of them and report a false zero.
 *
 *  `levelByNameFn` is optional. Without it we cannot tell a cantrip from a
 *  leveled spell, and counting a cantrip would report a false overflow - so
 *  we count everything and under-report rather than accuse someone of
 *  preparing more than they can.
 *
 *  Returns a number so the caller can say how far over they are rather than
 *  just that they are. Pure. */
export function preparedCountOver({
  prepared = [], limit = 0, preparedFrom = "classList", cantripsCountAsPrepared = false,
  knownItems = [], levelByNameFn = null,
} = {}) {
  if (!limit || limit <= 0) return 0;
  const held = new Set((knownItems || []).map((item) => (typeof item === "string" ? item : item?.text)).filter(Boolean));
  const needsHeld = preparedFrom === "known";
  const canTellLevel = typeof levelByNameFn === "function";
  const counted = (prepared || []).filter((name) => {
    if (!name) return false;
    if (canTellLevel && levelByNameFn(name) === 0) return Boolean(cantripsCountAsPrepared);
    if (needsHeld && held.size > 0 && !held.has(name)) return false;
    return true;
  });
  return Math.max(0, counted.length - limit);
}

/** Where one accepted spell pick lands on the sheet.
 *
 *  This is the single decision that separates a known caster from a prepared
 *  one, so it is one pure function rather than logic inside the wizard's
 *  render closure, where nothing could reach it from a test.
 *
 *  - `part: "prepared"` writes to `preparedItems` ONLY. Never to `items`.
 *    This is the fix for a full-list preparer: a Cleric's three prepared
 *    spells used to land in Spells Known, which recorded them as the only
 *    spells the character could ever cast and left the class list nowhere.
 *    It also means the whole class list is never copied in - only what the
 *    player actually prepares or adds by hand.
 *  - `part: "cantrips"` / `"spells"` write to `items`, the Spells Known list.
 *    Deselecting takes the spell back out, except where another live pick
 *    still holds it.
 *  - Either way, a spell that leaves `items` is no longer prepared. The
 *    Wizard's prepared subset is drawn from its spellbook, so a spellbook
 *    entry deleted underneath it has to drop out of `preparedItems` too or
 *    the sheet claims a prepared spell the character does not have.
 *
 *  Returns `{ items, preparedItems }`. Neither input is mutated. Pure. */
export function applySpellPickWrite({
  part = "spells",
  items = [],
  preparedItems = [],
  previous = [],
  next = [],
  heldByOtherPicks = [],
  alwaysPrepared = [],
} = {}) {
  if (part === "prepared") {
    return {
      items,
      preparedItems: preparedItemsWithAuto({ previous, next, alwaysPrepared }),
    };
  }
  const after = applySpellPickToItems({ items, previous, next, heldByOtherPicks });
  const stillListed = new Set(after.items.map((item) => (typeof item === "string" ? item : item?.text)));
  return {
    items: after.items,
    preparedItems: (preparedItems || []).filter((name) => stillListed.has(name)),
  };
}

/** The inline spell-pick groups for a staged class at a level: a cantrips
 *  line, a leveled-spells line, and (for classes that keep a prepared list)
 *  a prepared line under it.
 *
 *  Built as ordinary keyed choice groups carrying a `spellPick` - the shape
 *  the Bard's Magical Secrets and the High Elf's cantrip already use - so
 *  inlineChoiceBullets, the shared dialog, the Spells Known write and the cap
 *  enforcement all come for free.
 *
 *  THE COUNTS ARE TOTALS, NOT PER LEVEL. `limitFor` (spellLimitFor) returns a
 *  single `spells` number, and reading what it computes shows why: for a known
 *  caster it is the "spells known" table, which in 5e is a total across spell
 *  levels, and for a prepared caster it is `ability mod + level`, which is how
 *  many spells are held prepared at once - also a total. This used to apply
 *  that same total to every available spell level, so a level-5 Sorcerer was
 *  offered 6 + 6 + 6 = 18 leveled spells against a limit of 6, and a level-5
 *  Cleric 24 against 8. Invisible at level 1, where only one level exists,
 *  which is why it shipped.
 *
 *  So the leveled line is ONE group spanning every available level, capped at
 *  the total. `spellPick.maxLevel` is what makes the shared dialog list them
 *  all - spellPickDialogOptions already loops from `level` to `maxLevel` - and
 *  one `maxSelections` is what makes the dialog refuse the (n+1)th pick
 *  without any new cap arithmetic. There is no way to exceed the total
 *  because there is only ever one cap.
 *
 *  Always-prepared spells (a domain's, an oath's) hold part of the allowance
 *  and are excluded from the options, so the pick starts from what is left.
 *  Spells the class already holds from elsewhere - a racial cantrip, the
 *  player's own hand-typed entries - also count toward it, so nobody is made
 *  to pick a spell they already have.
 *
 *  minSelections is that shortfall for BOTH lines, by one rule: what this
 *  group still owes. It deliberately does NOT credit the group's own
 *  selections, because minSelections is compared against how many the group
 *  HAS made - crediting them would let a half-finished pick read as
 *  complete, which is the bug this phrasing exists to avoid.
 *
 *  Returns [] for a non-caster, and for a caster with nothing to pick at this
 *  level - a half-caster at level 1 has cantrips: 0 and no slot levels, and
 *  should show nothing rather than an empty picker.
 *
 *  deps: { limitFor, availableLevelsFor, levelByNameFn, model }.
 *  `model` is the per-class config (spellcastingModelFor); it decides whether
 *  the prepared line appears, what the two lines are called, and whether the
 *  known line has a quota.
 *
 *  The prepared cap is `limit.spells` too, and that is not a shortcut: for
 *  every class in this data that keeps a prepared list, `getSpellcastingInfo`
 *  reports style "prepared", and spellLimitFor computes `spells` as
 *  `prepared(level, ability mod)`. So it already IS the prepared count, and
 *  because the caller passes the live ability scores in, it moves with them -
 *  which is the whole of the "recompute when scores change" requirement.
 *
 *  Returns [] for a non-caster, and for a caster with nothing to pick at this
 *  level - a half-caster at level 1 has cantrips: 0 and no slot levels, and
 *  should show nothing rather than an empty picker.
 *
*  `spellbookCapFor(className, level, levels)` is the ceiling for a line whose
 *  model says `knownCap: "unlimited"` (the Wizard's spellbook): how many spells
 *  the class can cast across `levels`, which is exactly the list the picker
 *  offers. Return 0 for "cannot tell" and the line is not offered at all - a
 *  picker with an unknown ceiling is worse than no picker. Pure.
 *
 *  `preparedItems` is accepted but not consulted for the cap: an over-limit
 *  prepared list is a WARNING, never a reason to refuse or delete, and that
 *  check belongs where the limit can change under the player (the wizard's
 *  score step) rather than in the group builder.
 *
 *  Pure. */
export function creationSpellPickGroups({
  className,
  level = 1,
  abilityScores = {},
  bundles = [],
  choices = {},
  knownItems = [],
  preparedItems = [],
  limitFor = () => null,
  availableLevelsFor = () => [],
  levelByNameFn = () => null,
  spellbookCapFor = () => 0,
  model = null,
} = {}) {
  if (!className) return [];
  const limit = limitFor(className, level, abilityScores);
  if (!limit) return [];
  const levels = (availableLevelsFor(className, level) || []).filter((n) => Number(n) > 0);
  const lines = spellPickLineFactory({
    className, level, bundles, choices, knownItems, preparedItems, availableLevels: levels, levelByNameFn,
  });
  const topLevel = levels.length ? Math.max(...levels) : 0;

  if (limit.cantrips > 0) lines.add("cantrips", "Cantrips", limit.cantrips, 0, 0);

  // The known/spellbook line, and the prepared line under it. A class with no
  // known list (the full-list preparers) has ONLY the prepared line - see
  // spellcastingModelFor.
  if (topLevel > 0) {
    if (model?.hasKnownList !== false) {
      // A spellbook has no quota, so it does not take `limit.spells` as a
      // cap - that number is the Wizard's PREPARED count and borrowing it
      // would cap the book at six while letting six more sit prepared.
      //
      // It does take a REAL one. The book can hold every spell the class can
      // cast at these levels, and `spellbookCapFor` counts exactly the set
      // the picker offers, so the ceiling and the list can never disagree.
      // This used to be a 9999 sentinel, which surfaced to the player as a
      // button reading "Choose 9999".
      //
      // When that count cannot be had - no Spell List imported, so nothing to
      // offer - there is no line at all. A picker with an unknown ceiling is
      // the thing being replaced, not a lesser version of it.
      const bookCap = model?.knownCap === "unlimited"
        ? Math.max(0, Number(spellbookCapFor(className, level, levels)) || 0)
        : limit.spells;
      if (bookCap > 0) {
        lines.add("spells", model?.knownLabel || "Spells", bookCap, 1, topLevel);
        if (model?.knownCap === "unlimited") {
          const line = lines.groups[lines.groups.length - 1];
          // An uncapped line never blocks completeness - for a Wizard it is
          // the PREPARED line that has a required number, and requiring a
          // spellbook quota would invent a rule that does not exist.
          line.minSelections = 0;
          // So the summary can say something true. The number here is "how
          // many there are to choose from", which is not an allowance, and
          // printing it as one is what read as nonsense.
          line.uncapped = true;
        }
      }
    }
    if (model?.hasPreparedList) {
      lines.add("prepared", model?.preparedLabel || "Prepared Spells", limit.spells, 1, topLevel);
    }
  }
  return lines.groups;
}

/** The machinery every spell-pick line shares, as one closure.
 *
 *  Both the creation wizard and the level-up wizard ask the same structural
 *  question - how many of this list does this class still owe, given what is
 *  always prepared and what it already holds - and differ only in WHICH
 *  number they start from. Creation starts from the character's total; a
 *  level-up starts from the DIFFERENCE between this level and the last one.
 *  Keeping the arithmetic in one place is what stops those two from drifting
 *  into disagreeing about the same character. */
function spellPickLineFactory({
  className, level = 1, bundles = [], choices = {}, knownItems = [], preparedItems = [],
  availableLevels = [], levelByNameFn = () => null, keyFor = spellPickKey,
}) {
  const textOf = (item) => (typeof item === "string" ? item : item?.text);
  const knownNames = (knownItems || []).map(textOf).filter(Boolean);
  const preparedNames = (preparedItems || []).filter(Boolean);
  const auto = alwaysPreparedSpellNames(bundles, level);
  const groups = [];
  const levels = [...availableLevels].sort((a, b) => a - b);

  const autoAt = (levelNum) => [...auto].filter((name) => levelByNameFn(name) === levelNum).length;
  const spans = (part) => (part === "cantrips" ? [0] : levels);
  const autoHeldFor = (part) => spans(part).reduce((n, lvl) => n + autoAt(lvl), 0);

  /** What this group still owes: its cap, less what always-prepared spells
   *  and spells the class already holds elsewhere already hold. The group's
   *  own picks are excluded (see creationSpellPickGroups' note). */
  const shortfallFor = (part, cap) => {
    if (cap <= 0) return 0;
    const spanLevels = spans(part);
    const key = keyFor(className, part);
    const own = (choices?.[key] || []).length;
    const pool = part === "prepared" ? preparedNames : knownNames;
    const heldElsewhere = Math.max(
      0,
      pool.filter((name) => {
        if (auto.has(name)) return false;
        // A prepared line's pool is not spell-level-indexed the way the
        // known list is, so every held name counts toward it.
        if (part === "prepared") return true;
        return spanLevels.includes(levelByNameFn(name));
      }).length - own,
    );
    return Math.max(0, cap - autoHeldFor(part) - heldElsewhere);
  };

  /** Build one line, or nothing when its allowance is already used up. */
  function add(part, label, cap, levelNum, maxLevel) {
    // Always-prepared spells inside THIS line's spell levels hold part of its
    // allowance. Computed over the span, not just at level 0: the cantrips
    // line happens to only span 0, but a leveled line spanning 1..N holds
    // every auto spell at 1..N, and a domain's spells are leveled.
    const remaining = cap - autoHeldFor(part);
    if (remaining <= 0) return;
    groups.push({
      id: `creation-${part}`,
      key: keyFor(className, part),
      label,
      source: className,
      // `part` is carried on the pick, not only encoded in the key, so a
      // caller holding a group can tell the cantrips line from the known line
      // from the prepared one without re-parsing a key string.
      spellPick: { part, list: className, level: levelNum, maxLevel, exclude: [...auto] },
      minSelections: shortfallFor(part, remaining),
      maxSelections: remaining,
      minLevel: null,
      choiceKind: "build",
      category: "spells",
    });
  }

  return { add, groups, auto, availableLevels: levels, alwaysPrepared: auto };
}

/** How many NEW spells a class gains by taking this level - the difference
 *  between the spells-known table at this level and at the one below.
 *
 *  Read off `limitFor` rather than a second table, so it moves with the same
 *  data the totals come from. It is not always one: the table gives a Ranger
 *  +2, +1, +0, +1, +0 across levels 2-6, and a Paladin alternates its
 *  prepared count. So the caller has to handle zero as well as more than one.
 *
 *  A prepared caster returns 0 here on purpose. It does not gain "new" spells,
 *  it gains a bigger prepared allowance and re-prepares from scratch; asking
 *  for its delta would ask a Cleric to pick the one spell its new level
 *  "granted", which is not what levelling a prepared caster does.
 *
 *  `cantripDelta` likewise comes from the cantrip table, which steps at 4, 10
 *  and 14 rather than every level.
 *
 *  Pure. */
export function levelUpSpellGain({ className, level, previousLevel, abilityScores = {}, limitFor = () => null, model = null }) {
  const now = limitFor(className, level, abilityScores);
  if (!now) return null;
  const before = limitFor(className, previousLevel, abilityScores);
  if (!before) return { spellGain: 0, cantripGain: 0, limit: now, previousLimit: null };
  return {
    // 0 for a prepared caster, by the note above.
    spellGain: model?.hasPreparedList ? 0 : Math.max(0, now.spells - before.spells),
    cantripGain: Math.max(0, now.cantrips - before.cantrips),
    limit: now,
    previousLimit: before,
  };
}

/** The spell-pick groups for a level being TAKEN, as opposed to a character
 *  being created.
 *
 *  Same line shape, same keys, same dialog, same cap arithmetic - built by the
 *  same spellPickLineFactory as the creation groups, which is the point: the
 *  two wizards must not drift into disagreeing about the same character.
 *
 *  What differs is the NUMBER each line starts from:
 *
 *  - A known caster is asked only for what this level ADDS. The cap is the
 *    delta of the spells-known table, not its total - a Sorcerer at level 5
 *    knows 6 spells and gains 1, so asking for 6 again would demand six more.
 *  - A cantrip line only appears when the cantrip table actually steps at
 *    this level. A level that grants no new cantrip shows no cantrip line
 *    rather than one with a cap of zero.
 *  - A prepared caster is asked to RE-PREPARE to the new limit. Its prepared
 *    line's cap is the whole new allowance, and the shortfall is measured
 *    against what is already prepared, so a Cleric who is one short knows it.
 *  - A spellbook (Wizard) gets both, as at creation: the book is free-form,
 *    and the prepared subset is drawn from it.
 *
 *  Deliberately absent: SWAPPING a known spell. Nothing in this repo's rules
 *  data says a class may exchange one, and inventing a swap flow would be
 *  inventing a rule.
 *
 *  deps as creationSpellPickGroups, plus `previousLevel`. Pure. */
export function levelUpSpellPickGroups({
  className,
  level = 2,
  previousLevel = null,
  abilityScores = {},
  bundles = [],
  choices = {},
  knownItems = [],
  preparedItems = [],
  limitFor = () => null,
  availableLevelsFor = () => [],
  levelByNameFn = () => null,
  spellbookCapFor = () => 0,
  model = null,
} = {}) {
  if (!className) return [];
  const before = previousLevel == null ? Math.max(1, level - 1) : previousLevel;
  const gain = levelUpSpellGain({ className, level, previousLevel: before, abilityScores, limitFor, model });
  if (!gain) return [];
  const available = (availableLevelsFor(className, level) || []).filter((n) => Number(n) > 0);
  const topLevel = available.length ? Math.max(...available) : 0;
  if (!topLevel) return [];
  const lines = spellPickLineFactory({
    className,
    level,
    bundles,
    choices,
    knownItems,
    preparedItems,
    availableLevels: available,
    levelByNameFn,
    // Level-up picks live in the pending state, not under the creation key
    // they share with a character being built - the same character can pass
    // through both, and pruning one must not touch the other.
    keyFor: (name, part) => `levelup:${name}:${part}`,
  });

  if (gain.cantripGain > 0) {
    lines.add("cantrips", "New cantrips", gain.cantripGain, 0, 0);
  }
  if (model?.hasKnownList !== false) {
    // For a spellbook the book is still free-form: this level does not cap
    // what you copy into it. It does get a real ceiling, the same countable
    // one creation uses, so the summary cannot print a number that is not an
    // allowance - and no line at all when there is nothing to choose from.
    const bookCap = model?.knownCap === "unlimited"
      ? Math.max(0, Number(spellbookCapFor(className, level, available)) || 0)
      : gain.spellGain;
    if (bookCap > 0) {
      lines.add("spells", model?.knownCap === "unlimited" ? (model?.knownLabel || "Spellbook") : "New spells",
        bookCap, 1, topLevel);
      if (model?.knownCap === "unlimited") {
        const line = lines.groups[lines.groups.length - 1];
        line.minSelections = 0;
        line.uncapped = true;
      }
    }
  }
  if (model?.hasPreparedList) {
    lines.add("prepared", model?.preparedLabel || "Prepared Spells", gain.limit.spells, 1, topLevel);
  }
  return lines.groups;
}


/** Which of `items` the shared spell dialog would offer for a spell pick -
 *  the class list at the pick's level (through `maxLevel`), minus the
 *  always-prepared spells the pick already excludes, sorted by name.
 *  Empty when no Spell List catalog is imported, which is the caller's cue to
 *  show the fallback note rather than an empty dialog. Pure. */
export function spellPickDialogOptions({ spellPick = {}, spellsForLevelFn = () => [] } = {}) {
  const levelNum = spellPick.level ?? 0;
  const maxLevel = spellPick.maxLevel ?? levelNum;
  const excluded = new Set(spellPick.exclude || []);
  const out = [];
  for (let lvl = levelNum; lvl <= maxLevel; lvl += 1) {
    for (const spell of spellsForLevelFn(lvl, spellPick.list) || []) {
      const name = typeof spell === "string" ? spell : spell?.name;
      if (!name || excluded.has(name)) continue;
      // This dialog IS the spell picker - the standalone Spells step is
      // gone - so each option carries the same furniture a picker row does:
      // the basic facts, a gist that says what it deals, and the full text
      // behind a disclosure. It used to carry only the school name as its
      // description, which is why the picker read as a bare list of names.
      if (typeof spell === "string") {
        out.push({ id: name, name, description: "" });
        continue;
      }
      const meta = spell.mechanics?.meta || spell.school || "";
      const gist = spell.gist || "";
      const fullText = spell.mechanics?.effect || spell.description || "";
      out.push({
        id: name,
        name,
        description: spell.school || "",
        meta,
        gist,
        fullText,
        hasMoreThanGist: Boolean(spell.hasMoreThanGist ?? (gist && fullText.length > gist.length + 12)),
      });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Validates a persisted source default against the currently known
 *  rulesets: the primary system must still exist, and at least one
 *  stored content book must still belong to it. Returns
 *  `{ primary, included }` (books in stored order, unknown ones
 *  dropped) or null when nothing usable survives. Pure — storage
 *  access stays with the caller. */
export function sanitizeSourceDefault(stored, systems = [], packsForFn = () => []) {
  const primary = stored?.primary;
  if (!primary || !(systems || []).some((s) => s?.id === primary)) return null;
  const packIds = new Set(((packsForFn(primary) || []).map((p) => p?.id).filter(Boolean)));
  const included = [...new Set(stored?.included || [])].filter((id) => packIds.has(id));
  if (!included.length) return null;
  return { primary, included };
}

/** Whether a group is an ability-score slot (every option grants a
 *  single add to one ability score — +1 slots, or the Custom Lineage
 *  +2). Slot groups render as one ability dropdown each in the picker
 *  tables rather than as checkbox lists; duplicates stack across
 *  slots because each slot is its own group. Pure. */
export function isAsiSlotGroup(group) {
  const opts = group?.options || [];
  return opts.length > 0 && opts.every((o) => {
    const mods = o?.statModifiers || [];
    return mods.length === 1 && mods[0]?.op === "add"
      && /^[a-z]+Score$/.test(mods[0]?.targetFieldId || "")
      && Number.isFinite(mods[0]?.value);
  });
}

/** The ability id one slot option grants (from its `<abl>Score`
 *  target), or null. Pure. */
export function asiAbilityOf(option) {
  const mods = option?.statModifiers || [];
  if (mods.length !== 1) return null;
  const m = /^([a-z]+)Score$/.exec(mods[0]?.targetFieldId || "");
  return m ? m[1] : null;
}

/** Language slots for a set of groups: one slot per pick
 *  (maxSelections), values resolved to option names in group order
 *  and padded with null. Locked defaults (Common) ride along in
 *  storage but are NOT slot values — otherwise a single-slot group
 *  would display the locked pick instead of the real choice. Returns
 *  `[{ groupKey, values: [(name|null)] }]`. Pure. */
export function languageSlotsFor(groups, choicesStore = {}) {
  return (groups || []).map((group) => {
    const options = groupOptionsOf(group);
    const locked = new Set(group.lockedOptionIds || []);
    const names = [...(choicesStore?.[group.key] || [])]
      .filter((id) => !locked.has(id))
      .map((id) => options.find((o) => o.id === id)?.name)
      .filter(Boolean)
      .sort((a, b) => options.findIndex((o) => o.name === a) - options.findIndex((o) => o.name === b));
    const slots = Array.from({ length: Math.max(0, group.maxSelections || 0) }, (_, i) => names[i] ?? null);
    return { groupKey: group.key, values: slots };
  });
}

/** Writes one language slot pick back onto per-group choice keys:
 *  the slot's group keeps its locked defaults plus the option ids of
 *  its (deduped) slot names; unknown names are dropped. Returns
 *  `{ [groupKey]: [optionIds] }` for merging into the choices store.
 *  Pure. */
export function assignLanguageSlot(groups, groupKey, slotIndex, name, choicesStore = {}) {
  const group = (groups || []).find((g) => g.key === groupKey);
  if (!group) return {};
  const current = languageSlotsFor([group], choicesStore)[0]?.values || [];
  current[slotIndex] = name || null;
  const locked = [...(group.lockedOptionIds || [])];
  const seen = new Set(locked);
  const ids = [...locked];
  for (const slotName of current) {
    if (!slotName) continue;
    const opt = groupOptionsOf(group).find((o) => (o.name || "").toLowerCase() === slotName.toLowerCase());
    if (opt && !seen.has(opt.id)) {
      seen.add(opt.id);
      ids.push(opt.id);
    }
  }
  return { [groupKey]: ids };
}

/** How many times an ability may be picked across one ASI family.
 *
 *  A racial "+2 to one and +1 to another, or +1 to three" is three +1
 *  slots, so the same score twice is legal and the rules cap it there:
 *  three STR is a +3, which no such increase grants. Groups that do not
 *  name a family (Half-Elf's two independent +1s, the Custom Lineage +2)
 *  are not capped, because each of those is its own single decision. */
export const ASI_FAMILY_MAX_PER_ABILITY = 2;

/** The family a group belongs to, or "" when it is a standalone slot. */
export function asiFamilyOf(group) {
  return typeof group?.asiFamily === "string" ? group.asiFamily : "";
}

/** Every group's ASI family, siblings included: `{ family, groups }`.
 *  Groups with no family are returned under their own key so a caller
 *  counting across one row still sees them. Pure. */
export function asiFamiliesOf(groups = []) {
  const families = new Map();
  for (const group of groups || []) {
    if (!isAsiSlotGroup(group)) continue;
    const key = asiFamilyOf(group) || group.key;
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(group);
  }
  return [...families].map(([family, members]) => ({ family, groups: members }));
}

/** How many times each ability is picked ACROSS a family, ignoring the
 *  group asked about. Returns `{ ability: count }`, so a slot can grey out
 *  whatever its siblings have already taken up to the cap. Pure. */
export function asiSiblingAbilityCounts(group, groups = [], choicesStore = {}) {
  const counts = new Map();
  for (const other of groups || []) {
    if (other === group || !isAsiSlotGroup(other)) continue;
    if (asiFamilyOf(other) !== asiFamilyOf(group) || !asiFamilyOf(group)) continue;
    for (const option of other.options || []) {
      const ability = asiAbilityOf(option);
      if (!ability) continue;
      const picked = (choicesStore?.[other.key] || []).includes(option.id);
      if (picked) counts.set(ability, (counts.get(ability) || 0) + 1);
    }
  }
  return counts;
}

/** Whether a family's picks are within the cap - no ability taken more
 *  than ASI_FAMILY_MAX_PER_ABILITY times. The saved-state guard behind the
 *  UI's greyed-out options: an imported or hand-edited character can hold
 *  three STRs that no page would let a player make, and a sheet that
 *  accepted it would be a sheet granting a +3 nobody is entitled to. Pure. */
export function asiFamilyWithinCap(groups = [], choicesStore = {}) {
  for (const { groups: members } of asiFamiliesOf(groups)) {
    if (!asiFamilyOf(members[0])) continue;
    const counts = new Map();
    for (const group of members) {
      const chosen = asiAbilityOf((group.options || [])
        .find((o) => (choicesStore?.[group.key] || []).includes(o.id)) || {});
      if (!chosen) continue;
      const next = (counts.get(chosen) || 0) + 1;
      if (next > ASI_FAMILY_MAX_PER_ABILITY) return false;
      counts.set(chosen, next);
    }
  }
  return true;
}

/** ASI slots for a set of slot groups: the uniform grant value, the
 *  picked ability (or null), and the offered abilities in group
 *  order. Returns
 *  `[{ groupKey, value, pickedAbility, options: [{ ability, label, optionId }] }]`.
 *  Pure. */
export function asiSlotsFor(groups, choicesStore = {}) {
  return (groups || []).map((group) => {
    const options = (group?.options || [])
      .map((o) => {
        const ability = asiAbilityOf(o);
        if (!ability) return null;
        return { ability, label: o.name || ability, optionId: o.id, value: o.statModifiers[0].value };
      })
      .filter(Boolean);
    const stored = choicesStore?.[group.key] || [];
    const picked = options.find((o) => stored.includes(o.optionId)) || null;
    const values = new Set(options.map((o) => o.value));
    return {
      groupKey: group.key,
      value: values.size === 1 ? options[0].value : 1,
      pickedAbility: picked?.ability || null,
      options,
    };
  });
}

/** Writes one ASI slot pick back onto its group key (empty clears).
 *  Returns `{ [groupKey]: [optionId] }`. Pure. */
export function assignAsiSlot(groups, groupKey, abilityId) {
  const group = (groups || []).find((g) => g.key === groupKey);
  if (!group) return {};
  const opt = (group.options || []).find((o) => asiAbilityOf(o) === abilityId);
  return { [groupKey]: opt ? [opt.id] : [] };
}

/** Migrates retired combo-option picks onto slot groups: for every
 *  choices key ending in a retired `oldGroupId` holding a single
 *  combo option id, parses the trailing ability segments
 *  (`{prefix}-asi-{a}-{b}[-{c}]`, `{prefix}-ability-{a}-{b}`) and
 *  writes sibling keys for `slotGroupIds` with deterministic
 *  `{slotGroupId}-{ability}` option ids — doubling the first ability
 *  when a pair fills three slots (+2/+1). New keys that already hold
 *  picks are never overwritten, and unparseable picks keep their old
 *  key untouched (never destroy user data). Returns
 *  `{ choices, migrated }`. Pure — `abilityIds` is the valid ability
 *  set (abilities outside it abort that key's migration). */
export function migrateAsiComboPicks(choices = {}, defs = [], abilityIds = ["str", "dex", "con", "int", "wis", "cha"]) {
  const valid = new Set(abilityIds || []);
  const out = { ...(choices || {}) };
  let migrated = 0;
  for (const [key, picks] of Object.entries(choices || {})) {
    const groupId = key.split(":").pop();
    const def = (defs || []).find((d) => d.oldGroupId === groupId);
    if (!def || !Array.isArray(picks) || picks.length !== 1) continue;
    const optionId = picks[0];
    if (typeof optionId !== "string" || !optionId.startsWith(def.optionPrefix)) continue;
    const segs = optionId.slice(def.optionPrefix.length).split("-").filter(Boolean);
    if (!segs.length || segs.length > def.slotGroupIds.length || !segs.every((s) => valid.has(s))) continue;
    const prefix = key.slice(0, key.length - groupId.length);
    if (def.slotGroupIds.some((id) => (out[`${prefix}${id}`] || []).length)) continue;
    const expanded = [...segs];
    while (expanded.length < def.slotGroupIds.length) expanded.unshift(expanded[0]);
    def.slotGroupIds.forEach((slotId, i) => {
      out[`${prefix}${slotId}`] = [`${slotId}-${expanded[i]}`];
    });
    delete out[key];
    migrated++;
  }
  return { choices: out, migrated };
}

/** Retires a saved `flexibleAbilityBonus` pick onto the three +1 slots
 *  that replaced it.
 *
 *  A flexible pick stored ONE choice under ONE key:
 *  `{pattern, abilities, statModifiers}` for "+2 STR and +1 CON" or
 *  "+1 STR +1 DEX +1 CON". The slots that replaced it store one option id
 *  per group, so the migration expands the pattern across them: a `2-1`
 *  pick becomes two STR slots and a CON slot, a `1-1-1` pick three single
 *  slots.
 *
 *  Driven from the KEY rather than from a live group, because by the time a
 *  returning character is rendered the flexible group no longer exists in
 *  the data - that is the whole reason for the migration. The slot keys and
 *  option ids are the ones asiSlotChoiceGroups writes, so if a future data
 *  change renames them the migration simply finds nothing to do and the old
 *  key is left exactly where it was: never destroyed, and the owner is asked
 *  to repick the row. Returns `{ choices, migrated }`. Pure. */
export function migrateFlexibleAsiToSlots(choices = {}, slotCount = 3) {
  const out = { ...(choices || {}) };
  let migrated = 0;
  for (const [key, picks] of Object.entries(choices || {})) {
    const groupId = key.split(":").pop();
    if (!groupId.endsWith("-flexible-asi")) continue;
    const pick = (picks || [])[0];
    if (!pick || typeof pick === "string" || !Array.isArray(pick.abilities)) continue;
    const abilities = pick.abilities.filter((a) => typeof a === "string" && a);
    if (!abilities.length) continue;
    const stem = groupId.slice(0, -"-flexible-asi".length);
    const prefix = key.slice(0, key.length - groupId.length);
    const slotKeys = Array.from({ length: slotCount }, (_, i) => `${prefix}${stem}-asi-choice-${i + 1}`);
    // Never overwrite a slot that already holds a pick.
    if (slotKeys.some((k) => (out[k] || []).length)) continue;
    const expanded = [...abilities];
    while (expanded.length < slotCount) expanded.unshift(expanded[0]);
    slotKeys.forEach((slotKey, i) => {
      out[slotKey] = [`${stem}-asi-choice-${i + 1}-${expanded[i]}`];
    });
    delete out[key];
    migrated += 1;
  }
return { choices: out, migrated };
}

/** Why one option cannot be taken yet, or null when it can.
 *
 *  `option.requires` is the machine-readable half of a prerequisite the
 *  rules state in the option's own text - a Warlock invocation that needs
 *  a Pact of the Tome, or a 9th level. Both used to be a sentence in a
 *  tooltip, so a player could take an invocation their character has no
 *  way to use and the sheet had nothing to say.
 *
 *  A pact requirement is met by a pick in ANY group, matched by option
 *  NAME (ids differ per group); a level requirement is met by the level
 *  the character is at. `pickedNamesFor` and `level` are passed in rather
 *  than read here, so this stays a pure function. Returns a short phrase
 *  for the option's title, or null. */
export function optionRequirementNote(option, { pickedNames = [], level = 0 } = {}) {
  const requires = option?.requires || [];
  for (const req of requires) {
    if (req?.kind === "pact" && !pickedNames.includes(req.value)) {
      return `Needs ${req.value}`;
    }
    if (req?.kind === "level" && Number(level || 0) < Number(req.value || 0)) {
      return `Needs ${req.value}th level`;
    }
  }
  return null;
}

/** Every option name picked in `groups`, by choice key lookup. Used as the
 *  `pickedNames` input above, and by the pickers that need the whole set.
 *  Pure. */
export function pickedOptionNames(groups = [], choicesStore = {}) {
  const out = new Set();
  for (const group of groups || []) {
    for (const id of choicesStore?.[group.key] || []) {
      const option = groupOptionsOf(group).find((o) => o.id === id);
      if (option?.name) out.add(option.name);
    }
  }
  return [...out];
}

/** The one place that decides WHERE a choice group is rendered.
 *
 *  Every group gets exactly one answer, and both the picker row
 *  (`profileSectionsFor`) and the bottom "Your choices" sections
 *  (`raceSectionGroups` / `bgSectionGroups`) read it. Before this
 *  existed the two kept their own hand-written filters, and they
 *  disagreed: `profileSectionsFor` rendered language picks only for
 *  RACES while gating counted them for every pick, so Sage (two
 *  languages), Acolyte, Guild Artisan, Noble and Outlander all blocked
 *  Next on a picker that was never rendered. That is the whole bug
 *  class — a filter list that names some of the shapes and not the
 *  rest, so every unlisted shape is silently invisible while still
 *  being counted.
 *
 *  Returned values, in the order the row builder wants them:
 *
 *    "languages" - one dropdown per slot, Common locked in.
 *    "asiSlots"  - one ability dropdown per slot.
 *    "features"  - a one-sentence dropdown in the profile line.
 *    "dialog"    - the shared choice dialog: skills, tools, fighting
 *                  styles, expertise, feats and spell picks all open
 *                  the same one, so one bucket covers them.
 *    "section"   - nothing inline; render it as a bottom section.
 *
 *  NO CATEGORY IS PART OF THE ANSWER. A group renders the same way
 *  whether it came from a race, a class or a background: the shapes
 *  above are what the data looks like, and the one thing that must
 *  never vary by category is exactly the thing that produced the
 *  mismatch above. (The `fieldId: "toolProf"` fallback stays for the
 *  synthetic Equipment Proficiencies groups, which are built by
 *  hand and do set it.)
 *
 *  `categorizeChoiceGroup` is injected rather than imported so this
 *  stays a pure function of its argument — the same arrangement
 *  `choiceDialogKindFor` uses, and the reason this module can be
 *  unit-tested without a DOM. */
export function choiceGroupRenderTarget(group, { categorize = null } = {}) {
  if (!group) return "section";
  const categorizeFn = typeof categorize === "function" ? categorize : categorizeChoiceGroup;
  const category = typeof categorizeFn === "function" ? categorizeFn(group) : null;
  if (category === "languages") return "languages";
  if (isAsiSlotGroup(group)) return "asiSlots";
  if (choiceDialogKindFor(group)) return "dialog";
  if (isFeaturePickGroup(group)) return "features";
  return "section";
}

/** Split a pick's groups by where they render, so a caller cannot
 *  pick-and-choose between the two ends. Returns every bucket as an
 *  array (possibly empty) plus `section`, the only groups with no
 *  inline rendering. Pure; `categorize` is threaded as above. */
export function partitionChoiceGroupsByRenderTarget(groups = [], opts = {}) {
  const buckets = { languages: [], asiSlots: [], features: [], dialog: [], section: [] };
  for (const group of groups || []) {
    buckets[choiceGroupRenderTarget(group, opts)].push(group);
  }
  return buckets;
}

/** Whether a group is a feature pick (single-pick, every option
 *  named and carrying no stat modifiers — e.g. Custom Lineage's
 *  Variable Trait, Draconic Ancestry): these render as one inline
 *  sentence dropdown in the pick's profile ("Variable Trait:
 *  [Darkvision 60 ▾]"). Subrace, language, ASI-slot, and feat groups
 *  are classified elsewhere and never match here. Pure. */
export function isFeaturePickGroup(group) {
  if (group?.subrace) return false;
  if ((group?.maxSelections ?? 0) !== 1) return false;
  const opts = group?.options || [];
  return opts.length > 0 && opts.every((o) => o?.name && (o.statModifiers || []).length === 0);
}

/** Writes one feature-pick dropdown choice back onto its group key
 *  (empty clears). Returns `{ [groupKey]: [optionId] }`. Pure. */
export function assignFeatureSlot(groups, groupKey, optionId) {
  const group = (groups || []).find((g) => g.key === groupKey);
  if (!group) return {};
  const opt = optionId && (group.options || []).find((o) => o.id === optionId);
  return { [groupKey]: opt ? [opt.id] : [] };
}

/** Splices live pick bullets into a pick's static profile sections —
 *  the model behind profile-embedded dropdowns. `placements` lists
 *  `{ section, bullet, after }`: the bullet appends to the named
 *  section, creating it after the `after` section (or at the end)
 *  when missing. Language bullets are expected pre-merged (the caller
 *  strips the static language tags first, so no duplicate "Languages"
 *  line survives); feature bullets supersede same-named stub notes
 *  the same way. Returns a new array; inputs untouched. Pure. */
export function withLiveBullets(sections = [], placements = []) {
  const out = (sections || []).map((s) => ({ ...s, items: [...(s?.items || [])] }));
  for (const { section, bullet, after } of placements || []) {
    if (!bullet) continue;
    let target = out.find((s) => s.title === section);
    if (!target) {
      target = { title: section, items: [] };
      const anchor = after ? out.findIndex((s) => s.title === after) : -1;
      if (anchor === -1) out.push(target);
      else out.splice(anchor + 1, 0, target);
    }
    target.items.push(bullet);
  }
  return out;
}

export function canPickMore({ selectedCount, maxSelections, isRadio }) {
  if (isRadio) return true;
  return selectedCount < maxSelections;
}

export function ordinal(n) {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}

/** Display label for a spell-slot tracker id ("slots1" → "1st") —
 *  slot plans carry only fieldId/options, so summaries, prereq
 *  messages, and auto-created fields derive the human label here
 *  instead of printing "undefined". Pure. */
export function slotLabelFor(fieldId) {
  const n = Number.parseInt(String(fieldId || "").replace("slots", ""), 10);
  if (!Number.isFinite(n)) return String(fieldId || "spell-slot");
  return ordinal(n);
}

export function findSpellCatalog(catalogs = []) {
  return catalogs.find((c) => /spell/i.test(c.name || "")) || null;
}

export function spellsForLevelIn(catalog, levelNum, className) {
  if (!catalog) return [];
  const tabId = levelNum === 0 ? "cantrips" : `level${levelNum}`;
  const tab = (catalog.tabs || []).find((t) => t.id === tabId)
    || (catalog.tabs || []).find((t) => (levelNum === 0 ? /cantrip/i : new RegExp(`^${levelNum}`)).test(t.name || ""));
  const entries = (tab?.entries || [])
    .map((e) => {
      const rawDesc = String(e.description || "").trim();
      const fullEffect = String(e.fieldValues?.effect || "").trim();
      // Compiled descriptions are often just the first sentence
      // ("You touch a creature.") — fall back to the full effect text
      // so the row always says what the spell actually does.
      const description = (rawDesc.length <= 30 && fullEffect) ? fullEffect : (e.description || "");
      return {
        name: e.name,
        description,
        classes: (e.fieldValues?.classes || "").trim(),
        classList: spellClassesFor(e),
        tags: Array.isArray(e.fieldValues?.tags) ? [...e.fieldValues.tags] : [],
        school: (e.fieldValues?.school || "").trim(),
        mechanics: spellMechanicsLine(e),
        // The brief "what it does and what it deals" line, and whether the
        // full text is worth a disclosure. Derived from the same effect text
        // the full description shows - see spellGists.js for why these are
        // derived rather than written by hand for 537 spells.
        gist: spellGist(e),
        hasMoreThanGist: spellHasMoreThanGist(e),
      };
    })
    .filter((e) => e.name);
  if (!className) return entries;
  const norm = (s) => (s || "").toLowerCase();
  // Entries that name their classes only show for those classes;
  // entries with no class information anywhere can't be filtered and
  // still show (backgrounds never gate spell lists — racial/cantrip
  // grants arrive separately as auto-added Spells Known).
  return entries.filter((e) => e.classList.length === 0 || e.classList.some((c) => norm(c) === norm(className)));
}

/** Which classes a spell belongs to: the explicit classes field
 *  when set, else parsed from a trailing "Spell Lists. X, Y, Z" line
 *  in the effect text. Returns [] when unknowable (caller shows it
 *  everywhere rather than hiding something learnable). Pure. */
const SPELLCASTER_CLASSES = ["Artificer", "Bard", "Cleric", "Druid", "Paladin", "Ranger", "Sorcerer", "Warlock", "Wizard"];

export function spellClassesFor(entry) {
  const raw = String(entry?.fieldValues?.classes || "").trim();
  if (raw) return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const effect = String(entry?.fieldValues?.effect || entry?.description || "");
  const m = effect.match(/spell lists?\s*[:.]\s*([^\n.]+)/i);
  if (!m) return [];
  return SPELLCASTER_CLASSES.filter((cls) => new RegExp(`\\b${cls}\\b`, "i").test(m[1]));
}

/** One spell's mechanical summary for picker rows: level/school/
 *  casting/range/duration meta plus the full mechanical effect text
 *  (damage dice, save DC/ability, conditions, duration — what the spell
 *  actually does in combat). Returns { meta, effect } — either may be "". */
export function spellMechanicsLine(entry) {
  const fv = entry?.fieldValues || {};
  const bits = [];
  const lvl = String(fv.level || "").trim();
  const school = String(fv.school || "").trim();
  if (lvl && school) bits.push(`${lvl} · ${school}`);
  else if (lvl || school) bits.push(lvl || school);
  if (fv.castingTime) bits.push(String(fv.castingTime).trim());
  if (fv.range) bits.push(String(fv.range).trim());
  let dur = String(fv.duration || "").trim();
  if (dur && /concentr/i.test(String(fv.concentration || "")) && !/concentr/i.test(dur)) {
    dur += " (concentration)";
  }
  if (dur) bits.push(dur);
  const who = spellClassesFor(entry);
  if (who.length) bits.push(who.join(", "));
  // Full effect (not first-sentence truncated) so damage, saves,
  // and conditions are visible during selection.
  const rawEffect = String(fv.effect || "").trim();
  const effect = rawEffect.length > 800 ? briefDescription(rawEffect, 800) : rawEffect;
  return { meta: bits.join(" · "), effect };
}

/** The joined meta string back as discrete facts, each with a `kind` so the
 *  row can style a level or a casting time differently from a class list.
 *
 *  Derived from the string rather than rebuilt from the catalog entry, so it
 *  can never disagree with the line it replaces - both come out of the same
 *  `bits` array in spellMechanicsLine.
 *
 *  Kinds: level, school, casting, range, duration, classes, and `fact` for
 *  anything unrecognised - a field added to spellMechanicsLine shows up
 *  rather than vanishing. The trailing comma-joined run is the class list;
 *  it is read last regardless of where it sits, because that is where
 *  spellMechanicsLine puts it.
 *
 *  Pure. */
export function spellMetaFacts(meta) {
  const text = String(meta || "").trim();
  if (!text) return [];
  const parts = text.split(/\s*\u00b7\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return [{ kind: "fact", text }];

  const out = [];
  const first = parts[0];
  // "Cantrip" alone is a level; "Level 1 · Evocation" is a level and a
  // school. Either way the first token is the level when it looks like one.
  if (/^cantrip$/i.test(first) || /^level\s*\d+$/i.test(first)) {
    out.push({ kind: "level", text: first });
    const second = parts[1];
    // A second token containing a comma is the class list, already reached -
    // do not label a list of classes a school.
    if (second && !second.includes(",")) {
      out.push({ kind: "school", text: second });
      parts.splice(0, 2);
    } else {
      parts.splice(0, 1);
    }
  }

  const rest = parts.filter(Boolean);
  const classList = rest.find((p) => p.includes(","));
  if (classList) rest.splice(rest.indexOf(classList), 1);

  const classify = (p) => {
    if (/\baction\b|\breaction\b/i.test(p)) return "casting";
    if (/\bft\b|\bmi\b|\bcontact\b|^self\b|\binfinite\b|unlimited|\bspecial\b/i.test(p)) return "range";
    if (/\bminute|\bhour|\bday|concentration|until dispelled|instantaneous|permanent|\bround\b/i.test(p)) return "duration";
    return "fact";
  };
  for (const p of rest) out.push({ kind: classify(p), text: p });
  if (classList) out.push({ kind: "classes", text: classList });
  return out.length ? out : [{ kind: "fact", text }];
}

/** Review-tab lines for choice groups with picks. Groups whose label
 *  reads like a prompt ("Choose one (Smith's tools)", ...) list just
 *  the picks — the prompt adds nothing on a summary. Everything else
 *  keeps "Label: A · B". Works for flat and cross-category shapes;
 *  groups with no picks are skipped. */
export function reviewChoiceLinesFor(groups = [], choicesStore = {}) {
  const lines = [];
  for (const group of groups) {
    const picks = choicesStore[group.key] || [];
    if (!picks.length) continue;
    const allOptions = groupOptionsOf(group);
    const names = picks.map((id) => allOptions.find((o) => o.id === id)?.name || id).filter(Boolean);
    if (!names.length) continue;
    const label = (group.label || group.source || "").trim();
    if (!label || /^(choose|pick|select)\b/i.test(label)) {
      lines.push(names.join(" · "));
    } else {
      lines.push(`${label}: ${names.join(" · ")}`);
    }
  }
  return lines;
}

export function spellLevelByNameIn(catalog, name) {
  if (!catalog) return null;
  for (const tab of catalog.tabs || []) {
    if ((tab.entries || []).some((e) => e.name === name)) {
      return tab.id === "cantrips" ? 0 : Number.parseInt((tab.id || "").replace("level", ""), 10) || 0;
    }
  }
  return null;
}

export function availableSpellLevels(plan) {
  const levels = [0];
  const maxSlotLevel = (plan?.slotChanges || []).reduce(
    (max, change, index) => (change.options > 0 ? Math.max(max, index + 1) : max), 0
  );
  for (let lvl = 1; lvl <= maxSlotLevel; lvl++) levels.push(lvl);
  return levels;
}

// --- Step wizard shell + ruleset options --------------------------------------------
//
// Migration of renderStepWizard / rulesetOptionNames from customSheet.js.
// Minimal step-wizard shell shared by character creation and leveling.
// `steps` is an ordered array of {id, title, isApplicable(),
// render(container), unavailableMessage?}. isApplicable is re-checked
// on every render. Steps carry no lead-in copy: the screen states its
// own question through its headings and fields, and a paragraph
// explaining the obvious sat above every page.
// `stepState` is a small {index, stepId?} object the caller keeps so
// the step survives full re-renders — and, when the caller persists
// stepId (see creationStepId/levelingStepId), across sessions too: a
// persisted step id wins over the numeric index whenever it still
// applies, since ids are stable while positions shift as steps
// appear/disappear. `onNavigate` fires after every step change
// (dots, Back, Next) so the caller can persist the new position.
//
//   renderStepWizardInto(steps, stepState, {title, intro, onNavigate}, gridFn)

export function applicableStepsOf(steps) {
  return steps.filter((step) => isStepApplicable(step));
}

/** Whether an auto-skipped step reads as passed-over yet: only once
 *  the current position has moved beyond it in full step order. Before
 *  that it's just greyed out like any locked dot, so a fresh wizard
 *  doesn't imply anything was skipped already. Pure. */
export function skippedStepPassed(stepFullIndex, currentFullIndex) {
  return stepFullIndex < currentFullIndex;
}

/** Tooltip for an auto-skipped step's progress dot: the step's own
 *  reason when it gives one, otherwise the standard "nothing to
 *  choose" note. Never throws (a broken checker must not trap the
 *  wizard). Pure. */
export function skippedStepTitle(step) {
  try {
    const own = typeof step?.unavailableMessage === "function" ? step.unavailableMessage() : null;
    if (own) return own;
  } catch {
    /* fall through to the default */
  }
  return "Skipped — nothing to choose for your current picks.";
}

export function clampStepIndex(count, index) {
  if (count === 0) return 0;
  if (index >= count) return count - 1;
  if (index < 0) return 0;
  return index;
}

export function stepIsComplete(step) {
  if (typeof step?.isComplete !== "function") return true;
  try {
    return step.isComplete() !== false;
  } catch {
    return true;
  }
}

/** What a single step says is still outstanding, in the user's words.
 *  A step supplies this as `missingReasons()` (a string or array); the
 *  detail is what turns "Class is incomplete" into "2 cantrips and 1
 *  1st-level spell still to choose", which is the difference between a
 *  list you can act on and a wall. A step with nothing to add still gets
 *  a row - an unnamed outstanding page is worse than a blunt one. Pure,
 *  and never throws: a broken checker must not trap the Review page. */
export function stepMissingReasons(step) {
  try {
    const own = typeof step?.missingReasons === "function" ? step.missingReasons() : null;
    if (Array.isArray(own)) return own.map((r) => String(r || "").trim()).filter(Boolean);
    if (own) {
      const one = String(own).trim();
      return one ? [one] : [];
    }
  } catch {
    /* fall through to the default */
  }
  const fallback = typeof step?.missingLabel === "string" ? step.missingLabel.trim() : "";
  return fallback ? [fallback] : [];
}

/** Every applicable step that still needs decisions, as
 *  `{ stepId, title, reasons }` in step order — the "Still to decide" list
 *  on the Review page.
 *
 *  Three deliberate filters:
 *
 *  - Only APPLICABLE steps. A page that does not apply (no ASI at level 1,
 *    no feat to take) has been skipped, not left unfinished, and the
 *    wizard's dots already say so in those words.
 *  - Stops at `untilStepId`, so a page never lists itself or anything
 *    after it. Review is the last creation page, so nothing after it
 *    belongs to setup anyway; the same helper serves the level-up wizard.
 *  - A step whose own `isComplete` throws is treated as COMPLETE, the same
 *    way `stepIsComplete` treats it — one broken page must not fill the
 *    Review screen with noise.
 *
 *  Pure. */
export function outstandingSteps(steps, { untilStepId = null } = {}) {
  const out = [];
  for (const step of applicableStepsOf(steps || [])) {
    if (untilStepId && step.id === untilStepId) break;
    if (stepIsComplete(step)) continue;
    out.push({ stepId: step.id, title: step.title || "", reasons: stepMissingReasons(step) });
  }
  return out;
}

/** Human phrase for a spell pick group's shortfall: "2 cantrips and 1
 *  1st-level spell still to choose". Returns "" when every group is
 *  satisfied, so the caller can drop the phrase entirely rather than
 *  render an empty one. Deliberately compares against `minSelections`
 *  (the shortfall, after spells already held elsewhere are credited) and
 *  NOT against how many this pick has made — crediting the pick's own
 *  selections is exactly the bug this phrasing exists to avoid: at two
 *  cantrips of four it would read as done. Pure. */
export function spellPickShortfallPhrase(groups = [], picks = {}) {
  const parts = [];
  for (const group of groups || []) {
    const short = Math.max(0, (group?.minSelections ?? 0) - ((picks || {})[group.key] || []).length);
    if (!short) continue;
    const n = (word, plural) => `${short} ${word}${short === 1 ? "" : plural}`;
    // Read the spell levels off the PICK, not off the group. A spell pick
    // carries them in `spellPick` (level, and maxLevel for a line that spans
    // several); the group itself has no `level`, so reading it there produced
    // "NaN-level spells".
    //
    // A line spanning more than one level is a TOTAL across those levels - the
    // whole point of the fix - so it is phrased as a plain count rather than
    // naming one level it does not exclusively cover.
    const from = group?.spellPick?.level;
    const to = group?.spellPick?.maxLevel ?? from;
    if (from === 0) parts.push(n("cantrip", "s"));
    else if (to > from) parts.push(n("spell", "s"));
    else parts.push(n(`${ordinal(from)}-level spell`, "s"));
  }
  return parts.length ? `${parts.join(" and ")} still to choose` : "";
}

/** First applicable-step index whose page still needs decisions, or
 *  -1 when everything is decided. Dots past it stay clickable only
 *  backward — forward jumps past undecided pages are blocked, same as
 *  Next. Never throws (a broken checker must not trap the wizard). */
export function firstIncompleteStep(steps) {
  const applicable = applicableStepsOf(steps);
  for (let i = 0; i < applicable.length; i++) {
    if (!stepIsComplete(applicable[i])) return i;
  }
  return -1;
}

/** Where a wizard should open, given the step id saved by a previous session.
 *
 *  Refreshing mid-wizard should put the player back on the page they were on,
 *  with their answers still there - which is why the step is persisted as a
 *  stable ID rather than a number: the list of steps changes between sessions
 *  (a conditional page appears, one is renamed or dropped), and an index saved
 *  last week can point at a completely different page today.
 *
 *  A saved id that no longer matches any applicable step is IGNORED, and the
 *  wizard opens at its first page. That is the safe direction: the player
 *  lands on the beginning with nothing lost, rather than on whichever page
 *  happens to sit at the stale index. An unrecognised id is not an error and
 *  not worth a message - by the time it is read the step it named is gone.
 *
 *  `state` is mutated (its index is set) and returned, because the caller
 *  holds the live object. Pure otherwise. */
export function resumeStepIndex(applicableSteps = [], state = {}) {
  const count = applicableSteps.length;
  const saved = typeof state.stepId === "string" ? state.stepId : null;
  const at = saved ? applicableSteps.findIndex((s) => s?.id === saved) : -1;
  // `at === -1` covers both "nothing saved" and "saved one no longer exists".
  // Falling through leaves whatever index the state already had, which is
  // 0 for a fresh wizard.
  state.index = clampStepIndex(count, at === -1 ? state.index : at);
  return state.index;
}

export function renderStepWizardInto(steps, stepState, { title, intro, onNavigate } = {}, gridFn) {
  const applicableSteps = applicableStepsOf(steps);
  if (applicableSteps.length === 0) return null;
  resumeStepIndex(applicableSteps, stepState);
  // Single choke point for every step change — records the new
  // position (numeric index for this render, stable id for later
  // sessions) and notifies the caller before re-rendering.
  //
  // `direction` is how the player moved, and is what the arrival animation
  // reads so a screen arriving from a swipe looks different from one arriving
  // from a button press. Recorded on the state rather than passed to the
  // animation here, because `gridFn()` rebuilds the whole wizard - including
  // this function's closure - so the element that should animate does not
  // exist until after the re-render. `afterStepChange` below picks it up.
  const goTo = (i, direction = 0) => {
    stepState.index = clampStepIndex(applicableSteps.length, i);
    stepState.stepId = applicableSteps[stepState.index]?.id ?? null;
    if (direction) stepState.arrivalDirection = direction;
    // A step can ask to be shown from the top of the page. The wizard does
    // not own the scroll position - the sheet does, and it deliberately
    // PRESERVES it across every render so clicking a row does not feel like
    // the page refreshed under you - so the request is recorded here and the
    // caller reads it off the returned node after this render.
    //
    // Only on ARRIVAL, which is what `direction` means: a step that re-renders
    // while you are reading it must not yank you back to the top.
    scrollToTopOnRender = direction !== 0 && applicableSteps[stepState.index]?.opensAtTop === true;
    if (typeof onNavigate === "function") onNavigate(stepState);
    gridFn();
  };

  let scrollToTopOnRender = false;

  const wrap = document.createElement("section");
  wrap.className = "leveling-tab character-rules wizard";
  if (title) {
    const heading = document.createElement("h2");
    heading.textContent = title;
    wrap.append(heading);
  }
  if (intro) {
    const introEl = document.createElement("p");
    introEl.className = "leveling-tab__intro";
    introEl.textContent = intro;
    wrap.append(introEl);
  }

  const firstIncomplete = firstIncompleteStep(steps);
  const dots = document.createElement("div");
  dots.className = "wizard__dots";
  // Every step gets a dot, even ones that don't currently apply —
  // those render disabled with a tooltip explaining why, rather than
  // disappearing outright, so the wizard's shape doesn't shift around
  // as earlier answers change. Dots can always go back, but jumping
  // forward past a page that still needs decisions is blocked, just
  // like Next. Clicks ride on `onclick` (not addEventListener) so the
  // nav refresh below can re-arm dots without stacking handlers.
  const dotPairs = [];
  // Forward jumps past undecided pages (and inapplicable ones not
  // yet passed) share one locked tooltip with the Next button below.
  const lockedTitle = "Finish the current page first — It still needs decisions.";
  const currentFullIndex = steps.indexOf(applicableSteps[stepState.index]);
  steps.forEach((step, fullIndex) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.textContent = step.title;
    dot.dataset.stepId = step.id || "";
    if (!isStepApplicable(step)) {
      // Skipped steps read as passed-over (struck "skipped" + reason)
      // only once the wizard has moved beyond them; before that they
      // stay plain greyed-out dots like every other locked step, so a
      // fresh wizard doesn't suggest anything was skipped already.
      if (skippedStepPassed(fullIndex, currentFullIndex)) {
        dot.className = "wizard__dot wizard__dot--disabled wizard__dot--skipped";
        dot.disabled = true;
        dot.title = skippedStepTitle(step);
      } else {
        dot.className = "wizard__dot wizard__dot--disabled wizard__dot--locked";
        dot.disabled = true;
        dot.title = lockedTitle;
      }
      dots.append(dot);
      return;
    }
    const i = applicableSteps.indexOf(step);
    const pastGate = firstIncomplete !== -1 && i > firstIncomplete;
    dot.className = "wizard__dot"
      + (i === stepState.index ? " wizard__dot--active" : "")
      + (i < stepState.index ? " wizard__dot--done" : "")
      + (pastGate ? " wizard__dot--locked" : "");
    if (pastGate) {
      dot.disabled = true;
      dot.title = lockedTitle;
    }
    dot.onclick = () => { goTo(i, i === stepState.index ? 0 : (i > stepState.index ? 1 : -1)); };
    dotPairs.push({ dot, step, index: i });
    dots.append(dot);
  });
  wrap.append(dots);

  // Orientation for long wizards: "Step X of N" plus a slim progress
  // bar. Dots stay for navigation; this is for at-a-glance progress.
  const progress = document.createElement("div");
  progress.className = "wizard__progress";
  const counter = document.createElement("span");
  counter.className = "wizard__counter";
  counter.textContent = `Step ${stepState.index + 1} of ${applicableSteps.length}`;
  const bar = document.createElement("div");
  bar.className = "wizard__bar";
  const fill = document.createElement("div");
  fill.className = "wizard__bar-fill";
  fill.style.width = `${((stepState.index + 1) / applicableSteps.length) * 100}%`;
  bar.append(fill);
  progress.append(counter, bar);

  // The same position and the same step NAME, as one tappable control,
  // for a screen the seven pills do not fit on. At 390px the pills wrap
  // onto three rows (they are 53-128px each and the row is 366px), which
  // is the wizard's whole navigation before a single question is asked -
  // and it sat on top of "Step 2 of 7" and a progress bar that said the
  // same thing twice more.
  //
  // A <select> rather than a custom dropdown because the platform already
  // has the right one: it opens above the keyboard, it is reachable by
  // keyboard and by screen reader with no ARIA to get wrong, and on a
  // touch screen it is a native picker rather than a div that has to be
  // made to behave like one.
  //
  // The options are the same steps as the pills and the same gate: a step
  // past the first undecided one is disabled rather than absent, so the
  // dropdown says what is coming as well as what you can reach - which the
  // pills do, and which a filtered list would not. Both are driven by
  // `stepState.index`, so they cannot disagree about where you are.
  const stepSelect = document.createElement("select");
  stepSelect.className = "wizard__step-select";
  stepSelect.setAttribute("aria-label", "Jump to a step");
  applicableSteps.forEach((step, i) => {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = `${i + 1}. ${step.title || ""}`.trim();
    stepSelect.append(option);
  });
  stepSelect.addEventListener("change", () => {
    const target = Number(stepSelect.value);
    if (Number.isInteger(target)) goTo(target, target === stepState.index ? 0 : (target > stepState.index ? 1 : -1));
  });
  progress.append(stepSelect);

  wrap.append(progress);

  const currentStep = applicableSteps[stepState.index];

  // Why Next is refusing, in words, on the page.
  //
  // A dimmed Next button with the reason only in its `title` is a dead end
  // on a phone: there is no hover, so the tooltip is unreachable and the
  // button just looks broken. The reason comes from the SAME predicate
  // that disables the button (`stepIsComplete`) and the SAME per-step
  // `missingReasons()` the Review page reads, so it cannot describe a
  // different problem from the one that is actually blocking - and it says
  // which one, not just that there is one.
  //
  // Only the first reason is shown. A list of five is a wall, and the
  // first is the one to fix next; the rest are on the Review page, which
  // exists to hold them.
  const gateReasonTextFor = (step) => {
    const reasons = stepMissingReasons(step);
    return reasons.length ? reasons[0] : "Make your selections on this page to continue.";
  };

  /** The line under Next. A paragraph when the step has nothing to point
   *  at; a button when it does.
   *
   *  "Choices still to make." told a player there was a problem and not
   *  where it was, on a page that can be taller than the screen. A step
   *  that knows WHICH control is open says so in the reason, and offers
   *  the control: one click scrolls it into view, focuses it and flashes
   *  it in the accent colour. Still ONE reason, in the same place - the
   *  shortcut is additive, not a second list of buttons.
   *
   *  The step opts in by supplying `focusOpenChoice()`; without it the
   *  reason stays plain text, exactly as before. */
  const buildGateReasonNode = (step) => {
    if (stepIsComplete(step)) {
      const done = document.createElement("p");
      done.className = "wizard__gate-reason";
      return done;
    }
    const text = gateReasonTextFor(step);
    const focusOpen = typeof step?.focusOpenChoice === "function" ? step.focusOpenChoice : null;
    if (!focusOpen) {
      const reason = document.createElement("p");
      reason.className = "wizard__gate-reason";
      reason.textContent = text;
      return reason;
    }
    const reason = document.createElement("button");
    reason.type = "button";
    reason.className = "wizard__gate-reason wizard__gate-reason--action";
    reason.textContent = text;
    reason.title = "Go to the first choice still to make";
    reason.addEventListener("click", () => { focusOpen(); });
    return reason;
  };

  // Built fresh each call (rather than reused) since a DOM node can
  // only live in one place at a time, and this is placed both above
  // and below the step body below.
  const buildNav = (extraClass) => {
    const nav = document.createElement("div");
    nav.className = extraClass ? `wizard__nav ${extraClass}` : "wizard__nav";
    if (stepState.index > 0) {
      const back = document.createElement("button");
      back.type = "button";
      back.className = "btn";
      back.textContent = "← Back";
      back.addEventListener("click", () => { goTo(stepState.index - 1, -1); });
      nav.append(back);
    }
    if (stepState.index < applicableSteps.length - 1) {
      const forward = document.createElement("button");
      forward.type = "button";
      forward.className = "btn btn--primary wizard__next";
      forward.textContent = "Next →";
      if (!stepIsComplete(currentStep)) {
        forward.disabled = true;
        forward.title = "Make your selections on this page to continue.";
      }
      forward.addEventListener("click", () => { goTo(stepState.index + 1, 1); });
      nav.append(forward);
      const reason = buildGateReasonNode(currentStep);
      nav.append(reason);
    } else if (currentStep.finish) {
      // The LAST step's action lives here, where Next would have been.
      //
      // It used to be a button at the bottom of the step's own body, which
      // put it below a long summary and a paragraph repeating what the
      // summary already said - so the one control that ends the wizard was
      // the hardest thing on the page to find, and the thing you most want
      // once you have finished reading. In the action bar it sits where the
      // player has been pressing Next on every other page, and it is the
      // only forward control there is, because there is nothing after it.
      //
      // Back stays: a last step with no way back is a trap.
      //
      // A step opts in with `finish: { label, run }`. `run` is called with
      // no arguments. A step that supplies neither label nor run gets no
      // button, which is what every non-final step does anyway.
      const label = typeof currentStep.finish.label === "string" && currentStep.finish.label.trim()
        ? currentStep.finish.label.trim()
        : "Finish";
      const done = document.createElement("button");
      done.type = "button";
      done.className = "btn btn--primary wizard__finish-btn wizard__next";
      done.textContent = label;
      done.addEventListener("click", () => { currentStep.finish.run?.(); });
      nav.append(done);
    }
    return nav;
  };

  wrap.append(buildNav("wizard__nav--top"));

  const body = document.createElement("div");
  body.className = "wizard__body level-guide__form";
  wrap.append(body);
  currentStep.render(body);

  // The arrival animation, run once the screen is built.
  //
  // Only for a MOVE, never for the first render: arriving on the wizard at
  // all is not something the player did, and sliding the first page in would
  // delay the thing they came to read. `arrivalDirection` is set by goTo and
  // cleared here, so a re-render caused by anything else - an edit on this
  // page, a re-save - does not replay it.
  if (stepState.arrivalDirection) {
    animateStepArrival(body, stepState.arrivalDirection);
    stepState.arrivalDirection = 0;
  }

  const bottomNav = buildNav();
  wrap.append(bottomNav);

  // A single edge arrow, on the vertical middle of the step, that appears
  // once the page's own decisions are made and takes you forward.
  //
  // It exists because on a phone the Next button is at the BOTTOM of the
  // page: with the picker table expanded, that is a long scroll down and then
  // a scroll back up to see what you changed. An affordance that is already
  // on screen and says "you may continue" removes the search for it.
  //
  // Gated on exactly the same `stepIsComplete(currentStep)` as Next - one
  // predicate, so the arrow can never disagree with the button. Absent
  // entirely when there is no next step, and absent (not disabled) when the
  // page still needs decisions: an arrow you cannot press is worse than no
  // arrow, because it invites tapping and then nothing happening.
  const nextStep = applicableSteps[stepState.index + 1];
  if (nextStep) {
    const arrow = document.createElement("button");
    arrow.type = "button";
    arrow.className = "wizard__edge-next";
    arrow.textContent = "→";
    const blockedTitle = "Make your selections on this page to continue.";
    const setArrow = (blocked) => {
      if (blocked) {
        arrow.classList.add("wizard__edge-next--blocked");
        arrow.disabled = true;
        arrow.title = blockedTitle;
      } else {
        arrow.classList.remove("wizard__edge-next--blocked");
        arrow.disabled = false;
        arrow.title = `Next: ${nextStep.title || ""}`.trim();
      }
    };
    setArrow(!stepIsComplete(currentStep));
    arrow.addEventListener("click", () => { goTo(stepState.index + 1, 1); });
    wrap.append(arrow);
    // Kept beside the Next buttons so refreshWizardNav can drive them
    // together; a stale arrow would contradict the button next to it.
    wrap.refreshEdgeNext = () => setArrow(!stepIsComplete(
      applicableStepsOf(steps)[clampStepIndex(applicableStepsOf(steps).length, stepState.index)] || currentStep,
    ));
  }

  // One set of Back/Next is enough: while the bottom nav is fully on
  // screen (short pages, wide windows), the top duplicate hides
  // itself; scrolling down brings it back. No cleanup needed — the
  // observer dies with these nodes on the next re-render.
  if (typeof IntersectionObserver !== "undefined") {
    const topNav = wrap.querySelector(".wizard__nav--top");
    if (topNav) {
      const io = new IntersectionObserver((entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        topNav.classList.toggle("wizard__nav--hidden", visible);
      }, { threshold: 0.6 });
      io.observe(bottomNav);
    }
  }

  // Lightweight nav refresh for mutations that don't trigger a full
  // re-render (choice-group toggles save without rebuilding the page).
  // Re-evaluates gating in place so Next unlocks the moment the last
  // required pick lands.
  wrap.refreshWizardNav = () => {
    const applicable = applicableStepsOf(steps);
    const cur = applicable[clampStepIndex(applicable.length, stepState.index)];
    const blocked = !stepIsComplete(cur);
    wrap.querySelectorAll(".wizard__nav .wizard__next").forEach((btn) => {
      btn.disabled = blocked;
      btn.title = blocked ? "Make your selections on this page to continue." : "";
    });
    // The visible reason follows the same predicate, and is removed rather
    // than emptied when there is nothing blocking - a zero-height gap with
    // an empty paragraph in it is not "no reason shown".
    wrap.querySelectorAll(".wizard__gate-reason").forEach((node) => {
      if (blocked) node.textContent = gateReasonTextFor(cur);
      else node.remove();
    });
    // Completing the page via a no-rebuild pick (choice toggles save
    // without rebuilding) also unlocks forward dots in place — without
    // this they stay locked until the next full render, even though
    // Next already works. Step applicability only ever changes across
    // full renders, so indexes and listeners stay valid here.
    const freshFirst = firstIncompleteStep(steps);
    dotPairs.forEach(({ dot, index }) => {
      const pastGate = freshFirst !== -1 && index > freshFirst;
      dot.classList.toggle("wizard__dot--locked", pastGate);
      dot.disabled = pastGate;
      dot.title = pastGate ? lockedTitle : "";
    });
    // The step dropdown is the pills' twin, so it gets the same gate and
    // the same selected option, from the same index.
    const freshFirstForSelect = firstIncompleteStep(steps);
    [...stepSelect.options].forEach((option, i) => {
      const pastGate = freshFirstForSelect !== -1 && i > freshFirstForSelect;
      option.disabled = pastGate;
    });
    stepSelect.value = String(clampStepIndex(applicableSteps.length, stepState.index));
    // The edge arrow reads the same predicate, so it cannot disagree with
    // the Next buttons it duplicates.
    if (typeof wrap.refreshEdgeNext === "function") wrap.refreshEdgeNext();
  };
  // Picks auto-seeded while the body renders (locked defaults) can
  // satisfy the page after the navs above were already built.
  wrap.refreshWizardNav();
  // Any in-page edit (selects, checkboxes, typed input) re-evaluates
  // gating without needing each renderer to opt in. Both events:
  // 'change' covers commits, 'input' covers live typing (e.g. the
  // character-name field, whose save is debounced).
  const refreshOnEdit = () => {
    if (typeof wrap.refreshWizardNav === "function") wrap.refreshWizardNav();
  };
  wrap.addEventListener("change", refreshOnEdit);
  wrap.addEventListener("input", refreshOnEdit);

  // --- Swipe between steps -------------------------------------------------
  //
  // A horizontal drag moves to the previous or next step, subject to exactly
  // the same rules the buttons and dots obey: always back, forward only when
  // the current page is finished. So a swipe can never skip a decision.
  //
  // Vertical scrolling must still work, which is the whole difficulty: on a
  // phone the picker table IS a vertical list, and a gesture recogniser that
  // claims every touch would make the page unscrollable. Three things make it
  // safe, and the first is the one that decides whether scrolling feels
  // smooth at all:
  //
  //  - PASSIVE listeners. Nothing in here calls preventDefault(), so nothing
  //    needs the browser to wait. Without `passive: true` the browser has to
  //    hold the scroll until this handler returns, on every frame of every
  //    flick - which on a touch device puts app JavaScript on the critical
  //    path of the scroll and is the classic cause of a fling that starts,
  //    travels a screenful and then gives up. Declaring the listeners passive
  //    is free here and is the whole of the fix for that.
  //  - horizontal intent only - a gesture is a scroll as soon as its vertical
  //    travel exceeds its horizontal, and it is abandoned for good, so a
  //    diagonal scroll never becomes a page change halfway through. A
  //    diagonal SWIPE (more horizontal than vertical) still works.
  //  - a distance threshold, and one navigation per gesture.
  //
  // Also ignored: a drag that starts on a control, inside a dialog, or inside
  // anything that scrolls sideways - see swipeStartsInsideOwnSurface.
  //
  // Touch only. A mouse drag on a desktop page is a text selection or a
  // drag-and-drop elsewhere in the sheet, and hijacking it would break both.
  if (typeof wrap.addEventListener === "function") {
    // Passive, and deliberately not `capture`: the browser may start a scroll
    // and fire pointercancel at any point, and the handlers below neither need
    // to see the gesture before the target does nor want to keep it.
    const listen = { passive: true };
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let decided = false;

    wrap.addEventListener("pointerdown", (e) => {
      if (e.pointerType && e.pointerType !== "touch") return;
      if (swipeStartsInsideOwnSurface(e.target)) return;
      startX = e.clientX;
      startY = e.clientY;
      tracking = true;
      decided = false;
    }, listen);

    wrap.addEventListener("pointermove", (e) => {
      if (!tracking || decided) return;
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      // Scroll beats swipe, and once it has, this gesture is finished: the
      // browser is already scrolling and the drag belongs to it.
      if (dy > dx) { tracking = false; return; }
      if (dx < SWIPE_MIN_DISTANCE) return;
      decided = true;
      const forward = e.clientX - startX < 0;
      if (forward) {
        // Swipe left = forward.
        if (stepState.index < applicableSteps.length - 1 && stepIsComplete(currentStep)) {
          goTo(stepState.index + 1, 1);
        }
      } else if (stepState.index > 0) {
        // Swipe right = back, always allowed.
        goTo(stepState.index - 1, -1);
      }
    }, listen);

    const endSwipe = () => { tracking = false; };
    wrap.addEventListener("pointerup", endSwipe, listen);
    wrap.addEventListener("pointercancel", endSwipe, listen);
    wrap.addEventListener("pointerleave", endSwipe, listen);
  }
  return wrap;
}

/** How far a horizontal drag must travel before it counts as a swipe. Large
 *  enough that a tap, a nudge and a slow scroll-flick are all safe, small
 *  enough to be one comfortable thumb movement across a phone. */
export const SWIPE_MIN_DISTANCE = 56;

/** Where a swipe must NOT start, as a selector.
 *
 *  A control that owns its own gestures keeps them: inputs, textareas,
 *  selects and sliders are all dragged or dragged-through by the player, and
 *  a dialog or a scrolling picker list is already doing its own thing. Listed
 *  as one string so the rule is visible in one place and cannot be quietly
 *  widened by a second call site with its own idea of the list. */
export const SWIPE_IGNORED_SURFACES = [
  "input", "textarea", "select", "option", "label",
  "[contenteditable]",
  "[role='slider']", "[role='combobox']", "[role='spinbutton']",
  ".modal-overlay", ".choice-dialog-overlay", ".spell-picker-list",
  ".choice-row-list", ".level-guide__choices", ".tool-picker-dialog",
].join(", ");

/** Whether a gesture that started on `target` belongs to that surface rather
 *  than to the wizard's page navigation.
 *
 *  Two questions, and the second is the one a selector cannot answer:
 *
 *  1. Is it a control, a dialog, or one of the app's own scrolling lists?
 *  2. Is anything in its ancestor chain actually scrolled sideways? A wide
 *     table or a code-ish row on a narrow phone scrolls horizontally, and a
 *     swipe across one is a scroll. Tested by measurement rather than by
 *     naming classes, because the overflow can come from a rule nobody
 *     thought was a scroller.
 *
 *  `isHorizontallyScrollable` is injected (default: measure) so this is
 *  testable without a DOM. Pure. */
export function swipeStartsInsideOwnSurface(
  target,
  { selector = SWIPE_IGNORED_SURFACES, isHorizontallyScrollable = null } = {},
) {
  const closest = target?.closest;
  if (typeof closest !== "function") return false;
  if (closest.call(target, selector)) return true;
  const measure = isHorizontallyScrollable || ((el) => {
    const cs = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
    if (!cs) return false;
    const canScroll = /auto|scroll/.test(cs.overflowX || "");
    return canScroll && el.scrollWidth > el.clientWidth + 1;
  });
  for (let el = target; el && el.nodeType === 1; el = el.parentElement) {
    if (measure(el)) return true;
  }
  return false;
}

/** Bundle-library class/race/background names tagged to one or more
 *  content packs (or whole rulesets), alphabetically, falling back to the
 *  hardcoded list when nothing is imported yet. Accepts a single id or an
 *  array; legacy tags ("homebrew") match their new pack ("phb").
 *
 *  Sorted by name rather than left in bundle-import order: a library built
 *  by importing six books in six different sessions lists classes and races
 *  in whatever order they happened to arrive, so the same vault could show
 *  two different orderings. `localeCompare` with numeric handling so
 *  "Thief" lands between "Thief" and "Thug" and not after every "T..."
 *  neighbour by codepoint. */
export function rulesetOptionNamesIn(libraryCache, rulesetIdOrIds, category, fallback = []) {
  const ids = (Array.isArray(rulesetIdOrIds) ? rulesetIdOrIds : [rulesetIdOrIds]).filter(Boolean);
  const seen = new Set();
  const fromBundles = [];
  ids.forEach((id) => {
    libraryCache
      .filter((entry) => entry.category === category && contentIdMatches(entry.rulesetId, id))
      .map((entry) => entry.name)
      .forEach((name) => {
        if (!seen.has(name)) {
          seen.add(name);
          fromBundles.push(name);
        }
      });
  });
  return sortByName(fromBundles.length ? fromBundles : fallback);
}

/** Alphabetical by display name, case-insensitively, so "elf" and "Elf"
 *  cannot end up on either side of each other. Shared by every list the
 *  player picks a race, class, background, subrace or subclass from, so
 *  they all read as one set. Pure; returns a new array. */
export function sortByName(names) {
  return [...(names || [])].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true })
  );
}

// --- Spell picker ----------------------------------------------------------------------
//
// Migration of renderSpellPicker + ensureSpellListField cores from
// customSheet.js. Counts/limits are pure; the picker shell takes
// explicit deps:
//
//   renderSpellPickerInto(container, {rulesetId, className, level}, {
//     spellcastingInfoFn, ensureFieldFn, planFn, limitFn, levelByNameFn,
//     spellsForLevelFn, appendUniqueFn, saveFn, gridFn, multiRowsFn,
//   })

export function spellCountByLevel(knownSet, levelByNameFn) {
  let cantrips = 0;
  let spells = 0;
  [...knownSet].forEach((name) => {
    const lvl = levelByNameFn(name);
    if (lvl === 0) cantrips++;
    else if (lvl != null && lvl > 0) spells++;
  });
  return { cantrips, spells };
}

export function limitNoteText(cantripCount, spellCount, limit) {
  const bits = [];
  if (limit.cantrips) bits.push(`${cantripCount}/${limit.cantrips} cantrips known`);
  bits.push(`${spellCount}/${limit.spells} spells ${limit.style === "known" ? "known" : "prepared"}`);
  return bits.join(", ") + ".";
}

export function canLearnMore(levelNum, limit, cantripCount, spellCount) {
  const cap = levelNum === 0 ? limit.cantrips : limit.spells;
  const current = levelNum === 0 ? cantripCount : spellCount;
  return current < cap;
}

// Bard Magical Secrets lives in the data layer now
// (js/data/magicalSecrets.js), because the Bard's class bundle builds its
// pickers from the same table and js/data must not import a browser
// module - sheetWizard touches `document`, which would drag it into every
// node test and every content compile. Re-exported here so the existing
// importers in customSheet.js are unchanged.
export {
  MAGICAL_SECRETS_UNLOCKS,
  magicalSecretsUnlocked,
  magicalSecretsMaxSpellLevel,
  secretsPickedCount,
  secretsCompleteFor,
} from "../../data/magicalSecrets.js";

/** Spell-pick completeness for ONE class sharing a sheet-wide Spells
 *  Known list (multiclass level-ups): only spells on that class's own
 *  lists count toward its caps, so another class's spells can neither
 *  satisfy nor block this level's picks. `spellsForLevelFn(levelNum,
 *  className)` yields that level's entries-or-names (unfiltered when
 *  className is null); `levelByNameFn` maps a known name to its spell
 *  level. An empty class list (no catalog imported) counts as
 *  complete — hand-tracking, never a trap. Non-casters (null limit)
 *  are trivially complete. Pure. */
export function spellPicksCompleteForClass({
  knownItems = [], className, limit, availableLevels = [],
  spellsForLevelFn = () => [], levelByNameFn = () => null,
} = {}) {
  if (!className || !limit) return true;
  const classSpells = new Set();
  (availableLevels || []).forEach((levelNum) => {
    (spellsForLevelFn(levelNum, className) || []).forEach((entry) => {
      const name = typeof entry === "string" ? entry : entry?.name;
      if (name) classSpells.add(name);
    });
  });
  if (classSpells.size === 0) return true;
  const known = new Set((knownItems || []).filter((name) => classSpells.has(name)));
  const { cantrips, spells } = spellCountByLevel(known, levelByNameFn);
  return (availableLevels || []).every((levelNum) => !canLearnMore(levelNum, limit, cantrips, spells));
}

export function capMessage(levelNum, limit) {
  const cap = levelNum === 0 ? limit.cantrips : limit.spells;
  return levelNum === 0
    ? `You already know your ${cap} cantrip${cap === 1 ? "" : "s"} for this level — Uncheck one first to swap it.`
    : `You've already ${limit.style === "known" ? "learned" : "prepared"} your ${cap} spell${cap === 1 ? "" : "s"} for this level — Uncheck one first to swap it.`;
}

export function ensureSpellListFieldIn(layout, findFn, createFn, syncFn) {
  const spellcasting = layout.find((block) => block.name === "Spellcasting");
  if (!spellcasting) return null;
  const existing = findFn("spellsKnown", "Spells Known");
  if (existing) return existing;
  const field = createFn({ fieldType: "textlist", label: "Spells Known", x: 0, y: 4, w: 6, h: 2 });
  field.id = "spellsKnown";
  spellcasting.children.push(field);
  // The field sits at y4, two rows below the Spellcasting block's own h4,
  // so the block has to grow - and growing it in place pushed its bottom
  // two rows INTO whatever block starts at y4 in the same column (Attacks,
  // on the starter layout). Two absolutely positioned nodes then occupied
  // the same cells, and the one later in the layout array painted over the
  // other: the spell list was on screen but not clickable, because a real
  // button underneath an overlapping block never sees the pointer.
  //
  // So anything below the new bottom is PUSHED DOWN by the growth rather
  // than overlapped. The sheet allows overlapping blocks by design (a hand
  // placed one may sit on top of another), which is exactly why growing
  // into a neighbour cannot be left to sort itself out.
  const before = spellcasting.h || 0;
  const after = Math.max(before, 6);
  spellcasting.h = after;
  if (after > before) {
    const growth = after - before;
    for (const block of layout) {
      if (block === spellcasting) continue;
      // Only the same column, and only blocks that start at or below the row
      // the growth eats into. A block further down is left where it is -
      // there is a gap between them and the sheet is meant to have gaps.
      if ((block.x || 0) !== (spellcasting.x || 0)) continue;
      if ((block.y || 0) < before) continue;
      block.y = (block.y || 0) + growth;
      // ...and its own children move with it, since they are positioned
      // relative to the block.
      for (const child of block.children || []) {
        if (typeof child.y === "number") child.y += growth;
      }
    }
  }
  syncFn?.(field);
  return field;
}

/** Per-picker filter/sort memory, keyed by Spells Known field id so
 *  choices survive the full re-renders that toggles trigger. */
const spellPickerUiStates = new Map();
export function spellPickerUiStateFor(fieldId) {
  const key = fieldId || "spells";
  if (!spellPickerUiStates.has(key)) spellPickerUiStates.set(key, { tag: "all", sort: "name" });
  return spellPickerUiStates.get(key);
}

/** The spell listing's "prepared only" filter, per character.
 *
 *  Module-level rather than a closure local, for the same reason
 *  spellPickerUiStates above is: every toggle re-renders the whole page
 *  grid, so a value captured in the render closure is `false` again by the
 *  time the filter's own change has been applied. A filter that resets on
 *  the first re-render is a filter that does not work.
 *
 *  Keyed by character id, not by field: a filter is a way of looking at one
 *  character's list, and two characters should not inherit each other's.
 *  Kept out of the saved character deliberately - it is a viewing
 *  preference, and writing it on every toggle would be a write per click.
 *
 *  Pure reads; the caller writes. */
const preparedOnlyFilters = new Map();
export function preparedOnlyFor(characterId) {
  return preparedOnlyFilters.get(characterId || "default") === true;
}
export function setPreparedOnlyFor(characterId, on) {
  const key = characterId || "default";
  if (on) preparedOnlyFilters.set(key, true);
  else preparedOnlyFilters.delete(key);
}

/** Sort + tag-filter one level's spell rows for the picker. Pure. */
export function filterSortSpells(spells, { tag = "all", sort = "name" } = {}) {
  const filtered = tag === "all" ? [...spells] : spells.filter((s) => (s.tags || []).includes(tag));
  if (sort === "school") {
    filtered.sort((a, b) => (a.school || "").localeCompare(b.school || "") || a.name.localeCompare(b.name));
  } else {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  }
  return filtered;
}

/** Spell names on the BARD's own list at these spell levels - the spells
 *  the Bard already has through being a Bard, which Magical Secrets must not
 *  offer again. Derived from the catalog's class field rather than a
 *  hand-kept list. Pure. */
export function firmBardSpellNames(levels, spellsForLevelFn = () => []) {
  const set = new Set();
  for (const lvl of levels || []) {
    for (const spell of spellsForLevelFn(lvl, "Bard") || []) {
      if (spell?.name && (spell.classList || []).some((c) => String(c).toLowerCase() === "bard")) {
        set.add(spell.name);
      }
    }
  }
  return set;
}

/** The Magical Secrets picker for the LEVEL-UP wizard: an any-class
 *  multi-picker over the Bard's available spell levels, capped at the
 *  still-unpicked unlock total, writing straight to Spells Known.
 *
 *  It lives here, next to renderSpellPickerInto, because that is where it
 *  belongs: it is a thin configuration of the shared picker, and during
 *  CREATION it does not exist at all - Magical Secrets is a real choice group
 *  on the Bard's class bundle, so a character being built picks it on the
 *  class row like every other choice. Only levelling up hands out new
 *  Secrets, and that is where the picker is needed.
 *
 *  Renders nothing when no Secrets are unlocked, so non-Bards never see it.
 *  Says so in plain words rather than opening an empty dialog when no Spell
 *  List catalog is imported.
 *
 *  deps: the shared spell picker's, plus { magicSecretsUnlockedFn,
 *  secretsPickedCountFn, secretsCompleteForFn, bardPlanFn,
 *  availableLevelsFn, fieldItemsFn, levelByNameFn, spellsForLevelFn, ensureFieldFn,
 *  appendUniqueFn, saveFn, gridFn, multiRowsFn, noteFn }. */
export function renderMagicalSecretsInto(container, { className, level, subclassName = "" }, deps) {
  const {
    magicSecretsUnlockedFn = () => 0,
    secretsPickedCountFn = () => 0,
    bardPlanFn = () => null,
    availableLevelsFn = () => [],
    fieldItemsFn = () => [],
    levelByNameFn = () => null,
    spellsForLevelFn = () => [],
    ensureFieldFn = () => null,
    appendUniqueFn = () => {},
    saveFn = () => {},
    gridFn = () => {},
    multiRowsFn = () => {},
    noteFn = () => {},
    spellcastingInfoFn = () => null,
    planFn = () => null,
    limitsFn = () => null,
  } = deps;
  const unlocked = magicSecretsUnlockedFn(className, subclassName, level);
  if (!unlocked) return;
  const bardLevel = Math.max(1, level);
  const levels = availableLevelsFn(bardPlanFn("Bard", bardLevel));
  const bardNames = firmBardSpellNames(levels, spellsForLevelFn);
  const picked = secretsPickedCountFn(fieldItemsFn(), [...bardNames]);
  const remaining = Math.max(0, unlocked - picked);
  container.append(el("p", {
    class: "wizard__section-label",
    text: `Magical Secrets — stolen spells (${Math.min(picked, unlocked)}/${unlocked})`,
  }));
  if (!spellsForLevelFn(0, null).length && !levels.some((lvl) => lvl > 0 && spellsForLevelFn(lvl, null).length)) {
    noteFn(container, "No Spell List catalog imported yet — track Magical Secrets directly on the sheet's Spells Known list.");
    return;
  }
  renderSpellPickerInto(container, { rulesetId: null, className: "Bard", level: bardLevel }, {
    spellcastingInfoFn,
    ensureFieldFn,
    planFn,
    // Secrets are leveled spells from any list — no cantrips, and only the
    // still-unpicked unlock total (recomputed every render).
    limitFn: () => ({ cantrips: 0, spells: remaining, style: "known" }),
    levelByNameFn,
    spellsForLevelFn: (lvl) => spellsForLevelFn(lvl, null).filter((s) => !bardNames.has(s.name)),
    appendUniqueFn,
    saveFn,
    gridFn,
    multiRowsFn,
  });
  void limitsFn;
}

/** Whether a spell is a ritual, from the catalog's own tags.
 *
 *  There is no `ritual: true` field in the spell data - but "ritual" IS one
 *  of the catalog's `tags` on every ritual spell (34 of them), and
 *  spellsForLevelIn passes `tags` through, so this is a read of existing data
 *  rather than a new inference. It matters because a Wizard's ritual spells
 *  can be cast without being prepared: they are in the spellbook, so a
 *  prepared counter that required them would tell a player to prepare spells
 *  they are allowed to leave alone. Pure. */
export function spellIsRitual(spell) {
  return Array.isArray(spell?.tags) && spell.tags.some((t) => /^\s*ritual\s*$/i.test(String(t)));
}

/** The rows the spell listing draws: `items` in their own order, then any
 *  prepared spell that is not already among them.
 *
 *  A full-list preparer keeps their prepared spells in `preparedItems` and
 *  NOT in `items` - that is the shape applySpellPickWrite settled on, so
 *  neither list lies about the other. But this listing is the player's view
 *  of their own spell list, and a prepared spell they cannot see is one they
 *  cannot unprepare without going back to level-up. So the listing is the
 *  union, and each row records which array it came from.
 *
 *  `itemsIndex` is null for a prepared-only row: there is no entry in
 *  `items` behind it, so there is nothing to edit, reorder or delete. The
 *  caller makes such rows read-only and makes their remove button unprepare
 *  instead - deleting a spell the character never claimed to hold would be
 *  wrong, and so would silently rewriting `items` to make it true.
 *
 *  `hasPreparedList` false returns items untouched, so a known-only caster's
 *  listing is exactly the list they have and nothing else.
 *
 *  Pure. */
export function spellListDisplayRows({ items = [], preparedItems = [], hasPreparedList = false } = {}) {
  const held = (items || []).map((text, index) => ({ text, itemsIndex: index }));
  if (!hasPreparedList) return held;
  const seen = new Set(held.map((r) => r.text));
  const preparedOnly = (preparedItems || [])
    .filter((name) => name && !seen.has(name))
    .map((name) => {
      seen.add(name);
      return { text: name, itemsIndex: null };
    });
  return [...held, ...preparedOnly];
}

/** The prepared counter for the top of the spell listing: "Prepared: 3 / 8".
 *
 *  Returns null when the class has no prepared list at all, which is the
 *  caller's cue to render NOTHING - not a counter, not a toggle column, not
 *  a filter. A Sorcerer seeing "0 / 0 prepared" is worse than seeing
 *  nothing, because it implies they have a prepared list of size zero.
 *
 *  Always-prepared spells count: they are prepared whether or not anyone
 *  chose them, so a Life Domain Cleric with two domain spells is at 2/8
 *  before touching anything. Cantrips never count - a cantrip is not a
 *  prepared slot.
 *
 *  The limit is SOFT. `overBy` is what the counter turns its warning colour
 *  on, not a reason to refuse a toggle: the wizard's ability scores come
 *  after the class, so a correct prepared list can be over by the time the
 *  player reaches the sheet.
 *
 *  Pure. */
export function preparedCounter({
  prepared = [], limit = 0, cantripsCountAsPrepared = false,
  alwaysPrepared = [], levelByNameFn = null,
} = {}) {
  if (!limit || limit <= 0) return null;
  const names = [...new Set([...(prepared || []), ...(alwaysPrepared || [])].filter(Boolean))];
  const canTellLevel = typeof levelByNameFn === "function";
  const counted = names.filter((name) => {
    if (!canTellLevel) return true;
    return levelByNameFn(name) !== 0 || Boolean(cantripsCountAsPrepared);
  });
  const count = counted.length;
  return {
    count,
    limit,
    overBy: Math.max(0, count - limit),
    over: count > limit,
    text: `Prepared: ${count} / ${limit}`,
  };
}

/** Add or remove one spell from the prepared list. One tap, no confirmation.
 *
 *  An always-prepared spell is refused rather than silently accepted: it is
 *  prepared by definition, so a toggle that appeared to work and then
 *  reverted would read as a broken control. The caller shows it locked
 *  instead, and says why.
 *
 *  Order is preserved for the spells that survive, so tapping through a list
 *  and back does not shuffle it. Pure. */
export function togglePreparedSpell({ prepared = [], name, alwaysPrepared = [] } = {}) {
  if (!name) return { prepared: [...prepared], changed: false, reason: "no spell named" };
  if ((alwaysPrepared || []).includes(name)) {
    return { prepared: [...prepared], changed: false, reason: "always-prepared" };
  }
  const has = (prepared || []).includes(name);
  return {
    prepared: has ? prepared.filter((n) => n !== name) : [...(prepared || []), name],
    changed: true,
  };
}

/** What one row of the spell listing shows: its classes, whether it offers a
 *  prepared toggle at all, and whether that toggle is locked.
 *
 *  Four different answers, and getting them confused is the whole risk here:
 *
 *   no prepared list   - the class has none. No toggle, ever.
 *   cantrip            - a cantrip is never prepared, so no toggle, even for
 *                        a prepared caster. Showing one would offer to
 *                        prepare something that does not occupy a slot.
 *   always-prepared    - the class grants it. Toggle shown but LOCKED and
 *                        uncounted-elsewhere: the counter folds it in from
 *                        the bundles rather than from this list, so a
 *                        player cannot remove a domain spell they were given.
 *   otherwise          - a normal spell the player can prepare or not.
 *
 *  Returns `{ hasToggle, locked, pressed, dimmed, hidden, ritual }`.
 *
 *  `dimmed` is for a prepared caster looking at an unprepared spell: the
 *  list is long and the ones you can actually cast today are the ones you
 *  want to see. `hidden` is the "show prepared only" filter, which removes
 *  the row entirely rather than dimming it - a filter that leaves dimmed
 *  ghosts is a filter you have to read past.
 *
 *  Pure. */
export function spellRowView({
  name,
  level = null,
  hasPreparedList = false,
  isPrepared = false,
  alwaysPrepared = false,
  isRitual = false,
  showPreparedOnly = false,
} = {}) {
  const isCantrip = level === 0;
  const prepared = isPrepared || alwaysPrepared;
  const toggleable = hasPreparedList && !isCantrip;
  return {
    hasToggle: toggleable,
    // Locked when the class grants it. Never locked otherwise: an unprepared
    // spell the player wants to prepare must be one tap away.
    locked: toggleable && alwaysPrepared,
    pressed: prepared,
    dimmed: hasPreparedList && !prepared && !showPreparedOnly,
    hidden: showPreparedOnly && !prepared,
    ritual: Boolean(isRitual),
    alwaysPrepared,
    isCantrip,
  };
}

export function renderSpellPickerInto(container, { rulesetId, className, level }, deps) {
  const {
    spellcastingInfoFn,
    ensureFieldFn,
    planFn,
    limitFn,
    levelByNameFn,
    spellsForLevelFn,
    appendUniqueFn,
    saveFn,
    gridFn,
    multiRowsFn,
  } = deps;
  const info = spellcastingInfoFn(className);
  if (!info) {
    const note = document.createElement("p");
    note.className = "leveling-tab__intro";
    note.textContent = `${className || "This class"} doesn't cast spells, as far as this data goes.`;
    container.append(note);
    return;
  }
  const field = ensureFieldFn();
  if (!field) {
    const note = document.createElement("p");
    note.className = "leveling-tab__intro";
    note.textContent = "This sheet doesn't have a Spellcasting block to record spells in.";
    container.append(note);
    return;
  }
  const plan = planFn(rulesetId, className, level);
  const availableLevels = availableSpellLevels(plan);
  const limit = limitFn(className, level);
  const known = new Set(field.items || []);
  const limitNote = document.createElement("p");
  limitNote.className = "leveling-tab__intro";
  container.append(limitNote);
  const updateLimitNote = () => {
    const { cantrips, spells } = spellCountByLevel(known, levelByNameFn);
    limitNote.textContent = limitNoteText(cantrips, spells, limit);
  };
  // Transient cap tooltip anchored to the clicked row — replaces the
  // old top-of-table error. One shared node, re-anchored per denial.
  const tip = document.createElement("div");
  tip.className = "spell-picker-tip";
  tip.hidden = true;
  let tipTimer = null;
  const showCapTip = (anchorRow, message) => {
    if (tipTimer) clearTimeout(tipTimer);
    tip.textContent = message;
    tip.hidden = false;
    if (anchorRow && anchorRow.isConnected) anchorRow.after(tip);
    else container.append(tip);
    tipTimer = setTimeout(() => { tip.hidden = true; tip.remove(); }, 2800);
  };

  const ui = spellPickerUiStateFor(field.id);
  const byLevel = availableLevels.map((levelNum) => ({
    levelNum,
    spells: spellsForLevelFn(levelNum, className),
  }));
  const anySpellsListed = byLevel.some(({ spells }) => spells.length);
  if (!anySpellsListed) {
    updateLimitNote();
    const note = document.createElement("p");
    note.className = "leveling-tab__intro";
    note.textContent = NO_SPELL_CATALOG_NOTE;
    container.append(note);
    return;
  }
  // Filter + sort controls: tag dropdown covers the tags actually
  // present in the listed spells, so it never offers dead options.
  const controls = document.createElement("div");
  controls.className = "spell-picker-controls";
  const tagLabel = document.createElement("label");
  tagLabel.className = "spell-picker-controls__label";
  tagLabel.textContent = "Filter:";
  const tagSelect = document.createElement("select");
  tagSelect.className = "input-group__control spell-picker-controls__select";
  const presentTags = [...new Set(byLevel.flatMap(({ spells }) => spells.flatMap((s) => s.tags || [])))].sort();
  const tagOption = (value, text) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    tagSelect.append(o);
  };
  const capitalizeTag = (t) => String(t || "").replace(/(?:^|[\s-]+)\S/g, (c) => c.toUpperCase());
  tagOption("all", "All tags");
  presentTags.forEach((t) => tagOption(t, capitalizeTag(t)));
  if (!presentTags.includes(ui.tag)) ui.tag = "all";
  tagSelect.value = ui.tag;
  const sortLabel = document.createElement("label");
  sortLabel.className = "spell-picker-controls__label";
  sortLabel.textContent = "Sort:";
  const sortSelect = document.createElement("select");
  sortSelect.className = "input-group__control spell-picker-controls__select";
  [["name", "Name A–Z"], ["school", "School"]].forEach(([value, text]) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    sortSelect.append(o);
  });
  sortSelect.value = ui.sort;
  tagLabel.append(tagSelect);
  sortLabel.append(sortSelect);
  controls.append(tagLabel, sortLabel);
  container.append(controls);

  const listWrap = document.createElement("div");
  listWrap.className = "spell-picker-list";
  container.append(listWrap);

  const renderLists = () => {
    listWrap.innerHTML = "";
    let shown = 0;
    byLevel.forEach(({ levelNum, spells }) => {
      const visible = filterSortSpells(spells, ui);
      if (!visible.length) return;
      shown += visible.length;
      const heading = document.createElement("p");
      heading.className = "wizard__section-label";
      heading.textContent = levelNum === 0 ? "Cantrips" : `${ordinal(levelNum)}-Level Spells`;
      listWrap.append(heading);
      multiRowsFn(listWrap, visible.map((s) => s.name), {
        selectedSet: known,
        getInfo: (name) => visible.find((s) => s.name === name),
        onToggle: (name) => {
          if (!Array.isArray(field.items)) field.items = [];
          if (known.has(name)) {
            field.items = field.items.filter((item) => item !== name);
            known.delete(name);
          } else {
            const { cantrips, spells: spellCount } = spellCountByLevel(known, levelByNameFn);
            if (!canLearnMore(levelNum, limit, cantrips, spellCount)) {
              const anchor = listWrap.querySelector(`[data-name="${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`);
              showCapTip(anchor, `${capMessage(levelNum, limit)}`);
              return;
            }
            appendUniqueFn(field, name);
            known.add(name);
          }
          if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
          tip.hidden = true;
          tip.remove();
          saveFn();
          gridFn();
        },
      });
    });
    if (!shown) {
      const note = document.createElement("p");
      note.className = "leveling-tab__intro";
      note.textContent = "No spells match this filter — Pick another tag.";
      listWrap.append(note);
    }
  };
  tagSelect.addEventListener("change", () => { ui.tag = tagSelect.value; renderLists(); });
  sortSelect.addEventListener("change", () => { ui.sort = sortSelect.value; renderLists(); });
  renderLists();
  updateLimitNote();
}

// --- Catalog flavor + bundle lookup ---------------------------------------------------
//
// Flavor/portrait lookup. Bundles (the mechanical side) carry an explicit
// `catalogEntryId` pointing at a catalog entry (the flavor/portrait side),
// so a rename on either side no longer breaks the pairing — the link
// survives independently of the name. Legacy bundles imported before that
// field existed have no link, so `name` remains as a fallback lookup.

export const CATEGORY_FIELD = { Race: ["race", "Race"], Class: ["class", "Class"], Background: ["background", "Background"], Subclass: ["subclass", "Subclass"] };

function catalogEntryFromId(catalogs, entryId) {
  const id = (entryId || "").trim().toLowerCase();
  if (!id) return null;
  for (const cat of catalogs) {
    for (const tab of cat.tabs || []) {
      const entry = (tab.entries || []).find((e) => (e.id || "").trim().toLowerCase() === id);
      if (entry) return entry;
    }
  }
  return null;
}

/** Resolve flavor/portrait for a bundle. Prefers the explicit
 *  `catalogEntryId` link; falls back to matching by name (bundles saved
 *  before the link existed). Returns null when neither resolves. */
export function catalogEntryInfoIn(catalogs = [], keywords = [], name, catalogEntryId = null) {
  const byId = catalogEntryFromId(catalogs, catalogEntryId);
  if (byId) return { description: byId.description || "", imageData: byId.imageData || null };

  if (!name) return null;
  const norm = (s) => (s || "").trim().toLowerCase();
  const catalog = catalogs.find((c) => keywords.some((kw) => norm(c.name).includes(kw)));
  // Fall back to checking every catalog's tabs directly — covers a
  // catalog like the baked-in "Classes" one, which holds a
  // "Subclasses" tab under a name that doesn't itself contain
  // "subclass", so the keyword match above never finds it.
  const candidates = catalog ? [catalog] : catalogs;
  for (const cat of candidates) {
    for (const tab of cat.tabs || []) {
      const entry = (tab.entries || []).find((e) => norm(e.name) === norm(name));
      if (entry) return { description: entry.description || "", imageData: entry.imageData || null };
    }
  }
  return null;
}

/** Look up a Bundle Library entry by category+name+content pack,
 *  falling back to the sheet's own starter field (baked-in bundles
 *  live on the dropdown's choice, not in any library). `starterLookup`
 *  maps a category to its starter dropdown field (or null). */
export function bundleForIn(category, name, rulesetId, libraryCache = [], starterLookup = () => null) {
  if (!name) return null;
  const norm = (s) => (s || "").trim().toLowerCase();
  const fromLibrary = libraryCache.find((entry) => contentIdMatches(entry.rulesetId, rulesetId)
    && norm(entry.category) === norm(category) && norm(entry.name) === norm(name));
  if (fromLibrary) return fromLibrary;
  const target = CATEGORY_FIELD[category] && starterLookup(category);
  const choice = target?.choices?.find((c) => norm(c.text) === norm(name));
  return choice?.bundle || null;
}

// --- Row / choice-group renderers ------------------------------------------------------
//
// Full migration of renderSelectableRows / renderMultiSelectableRows /
// renderChoiceGroups / renderCrossCategoryChoice / renderFlatChoiceOptions
// from customSheet.js. All behavior arrives via params (no sheet
// closure); bodies are verbatim.

/** Expanded/collapsed memory for collapsible picker rows, keyed by
 *  option name. Picker lists rebuild on every pick (full re-render),
 *  which would otherwise collapse whatever the player just opened. */
const expandedChoiceRows = new Set();

export function isChoiceRowExpanded(name) {
  return expandedChoiceRows.has(name);
}

export function setChoiceRowExpanded(name, expanded) {
  if (expanded) expandedChoiceRows.add(name);
  else expandedChoiceRows.delete(name);
}

/** The generic picker table — the ONE row-list object every picker
 *  renders through (Race, Class, Subclass, Background, Feats, Spells
 *  Known, …). Two modes share the row look, portrait, description,
 *  and details styling:
 *    single (default) — pick one name; a second click on the open,
 *      selected row collapses it and de-selects (onSelect(null)).
 *    multi — check off a Set of names (onToggle), for lists like
 *      Spells Known; rows carry data-name and optional mechanics
 *      meta/effect + tag chips via getInfo.
 *  Per-table differences are configuration, not code: each table
 *  passes its own names plus its own trait sections and category
   *  names through getMechanicsList/getMechanics (Level 1 Class
   *  Features vs. Racial Traits, spell meta lines, … — see mechanicsBulletsFor),
 *  its own getInfo flavor/portraits, and its own onSelect/onToggle.
 *  Selection, expansion, collapse, and the Expand All / Collapse All
 *  bar live here alone — changing this function changes every table
 *  together, so the tables cannot drift apart. `afterRow` lets a
 *  caller inject content after a particular row (nested subrace /
 *  subclass lists, remove buttons); `nested` marks a sub-list's rows
 *  for the "part of, but distinct from, its parent" styling. */
export function renderPickerTableInto(container, names, opts = {}) {
  const { mode = "single" } = opts;
  if (mode === "multi") return renderMultiPickerRows(container, names, opts);
  return renderSinglePickerRows(container, names, opts);
}

/** Single-select table — legacy name, delegates to the generic
 *  picker table. Prefer renderPickerTableInto for new callers. */
export function renderSelectableRowsInto(container, names, opts = {}) {
  return renderPickerTableInto(container, names, { ...opts, mode: "single" });
}

/** Display text as DOM with ability abbreviations wrapped in tooltip
 *  abbrs ("STR" hovers "Strength — …") and gameplay vocabulary wrapped in
 *  long-pressable glossary terms. Used everywhere rich picker text
 *  renders (bullets, flavor lines, spell effects); plain-text paths
 *  (review lines, option values, aria labels) keep the bare strings.
 *  `<option>` elements can't contain markup, so dropdowns get `title`
 *  attributes instead — see the call sites.
 *
 *  The assembly itself lives in richText.js, which sheetFields.js and
 *  catalogBrowser.js share: it used to be copied into all three and drift. */
export function richAbilityNodes(text) {
  return richGameTextNodes(text);
}

/** One profile bullet with embedded dropdowns ("Languages — Common,
 *  [▾]" / "+1 to each of [▾], [▾]"). Same visual grammar as the
 *  static bullets (bold topic + em dash, or a bare sentence for
 *  topic-less ASI lines). Clicks and keypresses stop at the selects:
 *  without that, every pick would bubble to the row and toggle
 *  (collapse + de-select) the pick itself. `change` still bubbles so
 *  wizard gating refreshes. Module-private — only reachable through
 *  live descriptors in a mechanics list. */
/** A choice-group label whose tail is an instruction the link beside it
 *  already carries: "Monk Tool Proficiencies: choose one" renders as
 *
 *    **Monk Tool Proficiencies: choose one** — Choose 1
 *
 *  which says "choose one" twice, in two registers, three words apart. Only
 *  the Monk's tool group shipped with this shape, but the label is compiled
 *  data, so the next one will too - better to strip it at render time than to
 *  edit one string and call it done.
 *
 *  Returns the label with the trailing instruction removed, or the label
 *  unchanged when there is nothing to strip. Pure, so it is testable without
 *  a DOM.
 *
 *  Deliberately narrow: it only strips a TRAILING clause, never a mention
 *  partway through. "Common - a language everyone speaks" keeps its second
 *  half; "Monk Tool Proficiencies: choose one" loses its third. */
export function trimTrailingChooseInstruction(label) {
  const text = String(label ?? "");
  const trimmed = text.replace(
    // Two shapes, because the data uses both: a clause after a colon or
    // dash, and the instruction parenthesised at the end. The leading
    // separator is inside the match on purpose so "Weapons (choose two)"
    // loses the space before the bracket too.
    /\s*[:\-—]\s*\b(?:choose|select|pick)\b(?:\s+(?:one|two|three|four|an?|\d+|up to \w+))?\s*(?:\([^)]*\))?\s*$/i,
    "",
  ).replace(
    /\s*\(\s*(?:choose|select|pick)\b(?:\s+(?:one|two|three|four|an?|\d+|up to \w+))?\s*\)\s*$/i,
    "",
  );
  return trimmed.trim() || text;
}

export function renderLiveBulletItem(item) {
  const li = el("li", {
    class: "mechanics-pick" + (item.indent ? " mechanics-pick--nested" : ""),
  });
  // A bullet that is a ROW OF RELATED CONTROLS rather than a sentence with
  // dropdowns in it. The ASI trio ("choose 3 abilities to increase") is the
  // case: three dropdowns that are one decision, drawn as a <fieldset> so
  // the label is the <legend> a screen reader announces with the group and
  // so the row wraps as a unit on a narrow screen. Everything the sentence
  // form would print - the topic, the collective "+1 to each of", the "+1"
  // prefixes - is dropped in this mode: the legend already says what the
  // three dropdowns are for, and each option carries its own amount.
  const legendMode = typeof item.legend === "string" && item.legend.trim();
  let host = li;
  if (legendMode) {
    const fieldset = el("fieldset", { class: "mechanics-pick-set" });
    const controls = el("div", { class: "mechanics-pick-set__controls" });
    fieldset.append(el("legend", { class: "mechanics-pick-set__legend", text: item.legend }), controls);
    li.append(fieldset);
    host = controls;
  }
  const lead = item.lead || [];
  const slots = item.slots || [];
  // Choice-summary bullets open the shared dialog from their own summary
  // text ("Choose 2" is the link) — no superscript. The older
  // language/tool dropdown bullets keep their slot-level ? instead.
  const slotOpener = slots.some((s) => s.dialogOpener) ? () => slots.forEach((s) => s.dialogOpener?.()) : null;
  if (item.topic && !legendMode) {
    // Only when there is a link after it. Without one the label is the whole
    // line and "choose one" is the only instruction the player gets, so
    // stripping it would leave a topic with nothing after it at all.
    const topicText = typeof item.dialogOpener === "function"
      ? trimTrailingChooseInstruction(item.topic)
      : item.topic;
    const topicEl = el("strong", { text: topicText });
    if (!item.dialogOpener && slotOpener) {
      const helpBtn = el("sup", { class: "inline-pick-help", title: "Open picker dialog" },
        el("a", { href: "#", onclick: (e) => { e.preventDefault(); e.stopPropagation(); slotOpener(); } }, "?"));
      topicEl.append(document.createTextNode(" "), helpBtn);
    }
    li.append(topicEl, document.createTextNode(" — "));
  }
  if (typeof item.dialogOpener === "function") {
    const summary = lead.map((l) => l.text).join(", ") || "Choose";
    li.append(el("a", {
      href: "#", class: "inline-pick-link", text: summary, title: "Change picks",
      // The link's own text is only the summary ("Choose 2", or the names
      // already picked). A screen reader hears that with no idea WHICH
      // choice it opens, so the group label travels with it - the same
      // words the reason under Next now names.
      "aria-label": item.topic ? `${item.topic}: ${summary}` : summary,
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); item.dialogOpener(); },
    }));
  } else {
    // A LOCKED bullet still says what it is and what to do about it, in
    // plain words. Three channels on purpose: the visible text is what a
    // touch user gets (a `title` attribute does nothing there), the class is
    // what carries the dimming, and aria-disabled is what a screen reader
    // announces. A disabled-looking link with no explanation is the worst of
    // the three.
    if (item.locked) {
      li.classList.add("mechanics-pick--locked");
      li.setAttribute("aria-disabled", "true");
      lead.forEach(({ text, title }, i) => {
        if (i > 0) li.append(document.createTextNode(", "));
        li.append(el("span", { class: "inline-pick-locked", text, title }));
      });
    } else {
      lead.forEach(({ text, title }, i) => {
        if (i > 0) li.append(document.createTextNode(", "));
        li.append(el("span", { class: "inline-pick-known", text, title }));
      });
    }
  }
  if (item.collective && slots.length && !legendMode) {
    if (lead.length) li.append(document.createTextNode(", "));
    li.append(el("span", { class: "inline-pick-collective", text: `${item.collective} ` }));
  }
  // A soft-limit overflow, said in words on the bullet itself. Never a
  // deletion: the prepared limit moves with an ability modifier the wizard
  // only asks about on a LATER page, so a list that was correct when it was
  // made can be over by the time the player reaches this one.
  if (item.warning) {
    host.append(document.createTextNode(" "), el("span", { class: "mechanics-pick__warning", text: item.warning }));
  }  // Whether the CURRENT interaction with a slot came from the keyboard. The
  // pick handler re-renders the page, so focus has to be put back on the
  // replacement control - but doing that after a tap reopens the native
  // picker, which is the close-then-immediately-reopen behaviour. Recorded
  // per slot and per gesture: a keyboard user tabbing through and a finger
  // tapping the same control must not be treated the same way.
  const keyboardDriven = new Map();

  slots.forEach((slot, i) => {
    // A per-slot prefix, so "+2 to" / "+1 to" can live in the text rather
    // than in the dropdown's placeholder. A placeholder is what the control
    // shows while EMPTY - the moment an ability is chosen it is replaced by
    // that ability's name, taking the "+2" with it and leaving a line that
    // reads "Strength (10, +0), Dexterity (11, +1)" with no statement of
    // which is which. The number is part of the choice, not a hint about how
    // to make it, so it belongs in the sentence.
    if (!legendMode && (i > 0 || (lead.length && !item.collective))) host.append(document.createTextNode(", "));
    if (slot.prefix && !legendMode) {
      host.append(el("span", { class: "inline-pick-slot-prefix", text: slot.prefix }));
    }
    const select = el("select", {
      class: "input-group__control inline-pick-select",
      "data-inline-slot": slot.key,
      "aria-label": `${item.topic || "Pick"} ${i + 1}`,
      onchange: () => {
        if (typeof item.onPick === "function") {
          item.onPick(slot.key, select.value, { keyboard: keyboardDriven.get(slot.key) === true });
        }
      },
      onclick: (e) => { keyboardDriven.set(slot.key, false); e.stopPropagation(); },
      onkeydown: (e) => {
        // Arrow keys, Enter, Space. A bare modifier press does not count:
        // Tabbing past a control should not mark the next gesture as typed.
        if (["ArrowDown", "ArrowUp", "Enter", " ", "Home", "End", "PageUp", "PageDown"]
          .includes(e.key)) {
          keyboardDriven.set(slot.key, true);
        }
        e.stopPropagation();
      },
      onpointerdown: (e) => { keyboardDriven.set(slot.key, false); e.stopPropagation(); },
    });
    select.append(el("option", { value: "", text: slot.placeholder || "Choose…" }));
    // Optional [{ label, options }] rendered as <optgroup>. The native
    // dropdown's own grouping: the label is shown but cannot be picked, which
    // is exactly the Widespread/Rare split the language list wants - and it
    // costs nothing to draw, unlike a heading inside a <select>, which is
    // not allowed to hold elements.
    //
    // Options named by no optgroup still get listed, afterwards, so a caller
    // that lists some cannot hide the rest.
    const grouped = (slot.optgroups || []).flatMap((g) => g.options || []).map((o) => o.value);
    for (const group of slot.optgroups || []) {
      const opts = group.options || [];
      if (!opts.length) continue;
      const og = document.createElement("optgroup");
      og.label = group.label || "";
      for (const o of opts) {
        og.append(el("option", { value: o.value, text: o.label, disabled: o.disabled || false, title: o.title || null }));
      }
      select.append(og);
    }
    for (const o of (slot.options || []).filter((o) => !grouped.includes(o.value))) {
      select.append(el("option", { value: o.value, text: o.label, disabled: o.disabled || false, title: o.title || null }));
    }
    select.value = slot.value ?? "";
    host.append(select);
  });
  return li;
}

/** Give a native `<details>` disclosure the same open/close motion the picker
 *  rows already use.
 *
 *  The rows' own details animate because animateRowDetails owns the `hidden`
 *  attribute. A `<details>` does not: the browser owns `open`, which is why
 *  those disclosures snapped open with nothing at all while everything around
 *  them moved. This wires the same 4px rise and fade onto both directions
 *  without taking `open` away from the browser.
 *
 *  Opening is easy - let the browser toggle, then animate on the `toggle`
 *  event. Closing has to be intercepted, because by the time `toggle` fires
 *  the content is already hidden and there is nothing left to animate. So the
 *  summary's click is prevented on the way down and `open` is removed once
 *  the animation finishes. That covers the keyboard too, since Enter and
 *  Space on a focused `<summary>` both fire a click.
 *
 *  Reduced motion gets no animation and no interception: with
 *  `prefersReducedMotion` on, nothing here runs and the disclosure behaves
 *  exactly as the browser's own.
 *
 *  Best-effort and idempotent. A `<details>` with no summary, or with nothing
 *  to reveal, is left alone; calling twice wires once. */
export function animateDisclosureInto(detailsEl) {
  if (!detailsEl || typeof detailsEl.querySelector !== "function") return false;
  if (detailsEl.dataset.motionWired) return false;
  const summary = detailsEl.querySelector("summary");
  const content = detailsEl.querySelector(".choice-row__mechanics-effect");
  if (!summary || !content) return false;
  detailsEl.dataset.motionWired = "1";

  const OPEN = [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "translateY(0)" }];
  const CLOSE = [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-4px)" }];
  const OPEN_OPTS = { duration: 180, easing: "ease-out" };
  const CLOSE_OPTS = { duration: 150, easing: "ease-in" };

  detailsEl.addEventListener("toggle", () => {
    if (detailsEl.open) animateWith(content, OPEN, OPEN_OPTS);
  });
  summary.addEventListener("click", (e) => {
    if (!detailsEl.open) return;
    // Closing. If there is no animation to wait for, let the browser close it
    // rather than taking the click - same end state, one less thing to break.
    const anim = animateWith(content, CLOSE, CLOSE_OPTS);
    if (!anim) return;
    e.preventDefault();
    const finish = () => { detailsEl.open = false; };
    if (typeof anim.finished?.then === "function") anim.finished.then(finish).catch(finish);
    else { anim.onfinish = finish; setTimeout(finish, 170); }
  });
  return true;
}

function animateRowDetails(details, row, expand) {
  if (!details) return;
  try {
    if (expand) {
      details.hidden = false;
      row?.classList.add("choice-row--expanded");
      // The end state is set here, not in the last keyframe, so that
      // "reduced motion" needs no special case: the element is already where
      // it is going to be. animateWith returns null when the animation is
      // skipped, and nothing below has to know why.
      animateWith(details,
        [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 180, easing: "ease-out" });
    } else {
      row?.classList.remove("choice-row--expanded");
      const anim = animateWith(details,
        [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-4px)" }],
        { duration: 150, easing: "ease-in" });
      // Collapse is the one case that CANNOT rely on the end state already
      // being set: the element has to end up hidden, and a skipped animation
      // has to hide it too. So there is an explicit finish, and `anim` being
      // null is the normal reduced-motion path rather than a failure.
      const finish = () => { details.hidden = true; };
      if (anim && typeof anim.finished?.then === "function") anim.finished.then(finish).catch(finish);
      else if (anim) { anim.onfinish = finish; setTimeout(() => { try { details.hidden = true; } catch { /* already gone */ } }, 170); }
      else finish();
    }
  } catch {
    details.hidden = !expand;
    row?.classList.toggle("choice-row--expanded", expand);
  }
}

/** How far a wizard screen travels when you move between them. Small on
 *  purpose: this is a gesture acknowledgement, not a page turn, and a long
 *  slide on a phone reads as the page having jumped somewhere unexpected. */
const STEP_SLIDE_PX = 18;
const STEP_FADE_MS = 160;

/** Animate a wizard screen arriving, in the direction of travel.
 *
 *  Called after the new step is in the DOM, so it only ever animates the
 *  ARRIVAL. A screen that slid out would need the old one held somewhere
 *  while the new one is built, and the wizard re-renders rather than swaps -
 *  so the outgoing step is already gone before this could run. Sliding in
 *  from the side you came from is what a person actually perceives as "that
 *  went the right way", and it costs one transform.
 *
 *  `direction` is +1 going forward (a leftward swipe, a Next) and -1 going
 *  back. Reduced motion gets nothing at all - see animateWith.
 *
 *  A no-op wherever the element or the Web Animations API is missing, which
 *  includes the DOM stubs under scripts/. Never throws. */
export function animateStepArrival(el, direction = 1, win = null) {
  // No direction means no move: arriving at the wizard is not something the
  // player did, and a re-render from an edit on the same page is not a step
  // change. Neither should slide.
  if (!el || !Number.isFinite(direction) || direction === 0) return null;
  const from = direction >= 0 ? STEP_SLIDE_PX : -STEP_SLIDE_PX;
  return animateWith(el,
    [
      { opacity: 0, transform: `translateX(${from}px)` },
      { opacity: 1, transform: "translateX(0)" },
    ],
    { duration: STEP_FADE_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    win);
}

/** Run `fn` without letting the page move under the clicker's eyes.
 *
 *  Selecting a picker row re-renders the sheet, and the browser then keeps
 *  the scroll position against new content — which lands the reader
 *  somewhere else entirely, usually a long way from the row they just
 *  clicked. Captured before, restored after the re-render paints.
 *
 *  No-ops where there's no window (stub DOM harnesses) or where the
 *  scroller is the container itself, where the browser handles it. */
export function preserveScrollWhile(fn) {
  const view = typeof window === "undefined" ? null : window;
  if (!view || typeof view.scrollY !== "number") {
    fn();
    return;
  }
  const x = view.scrollX;
  const y = view.scrollY;
  fn();
  const restore = () => {
    if (view.scrollX !== x || view.scrollY !== y) view.scrollTo(x, y);
  };
  if (typeof view.requestAnimationFrame === "function") view.requestAnimationFrame(restore);
  else setTimeout(restore, 0);
}

function renderSinglePickerRows(container, names, {
  selectedName, onSelect, getInfo, getMechanics, getMechanicsList, afterRow, nested = false, getIcon = null,
  // Collapsed-by-default is the right shape for any list long enough to
  // scroll (Race, Class, Background, …): only the selected row's details
  // show, everything else is a scannable name + one-line description.
  // `showControls` is separate from `collapsible` so a nested list (a
  // race's subraces, a class's subclasses) can still collapse row-by-row
  // without adding a second Expand All/Collapse All bar to the page —
  // pass `showControls: false` for those while leaving collapsible true.
  // Row click alone toggles expand/collapse — no per-row Collapse button.
  collapsible = true, showControls = collapsible,
} = {}) {
  const list = document.createElement("div");
  list.className = "choice-row-list" + (nested ? " choice-row-list--nested" : "");
  if (showControls && names.length) {
    const controls = el("div", { class: "choice-row-list__collapse-controls" },
      el("button", {
        type: "button", class: "btn", text: "Expand All",
        onclick: () => {
          names.forEach((name) => expandedChoiceRows.add(name));
          list.querySelectorAll(".choice-row").forEach((row) => {
            const d = row.querySelector(".choice-row__details");
            if (d && d.hidden) animateRowDetails(d, row, true);
            else if (d) row.classList.add("choice-row--expanded");
          });
        },
      }),
      el("button", {
        type: "button", class: "btn", text: "Collapse All",
        onclick: () => {
          // The current pick stays expanded as the anchor while
          // everything else collapses around it (nothing selected:
          // everything collapses, as before).
          names.forEach((name) => { if (name !== selectedName) expandedChoiceRows.delete(name); });
          if (selectedName) expandedChoiceRows.add(selectedName);
          list.querySelectorAll(".choice-row").forEach((row) => {
            const keep = !!selectedName && row.dataset?.rowName === selectedName;
            const details = row.querySelector(".choice-row__details");
            if (details) {
              if (keep && details.hidden) animateRowDetails(details, row, true);
              else if (!keep && !details.hidden) animateRowDetails(details, row, false);
              else row.classList.toggle("choice-row--expanded", keep);
            }
          });
        },
      }));
    container.append(controls);
  }
  names.forEach((name) => {
    const info = getInfo ? getInfo(name) : null;
    const selected = name === selectedName;
    // Selecting a row WITHOUT ever collapsing one. Split out of toggleRow
    // because a click on a control INSIDE the row has to be able to select
    // the row it sits in, and that click must never be able to collapse it
    // - collapsing the row out from under a dropdown mid-gesture is the
    // exact failure this separation exists to prevent.
    const selectRow = () => {
      // Switching the pick collapses whatever was previously selected
      // — otherwise every race/class/background you'd ever clicked
      // through stays pinned open, and the "only the pick is expanded"
      // list slowly turns back into the wall of details this was
      // meant to avoid.
      if (collapsible && selectedName && selectedName !== name) {
        expandedChoiceRows.delete(selectedName);
        const prevRow = [...list.querySelectorAll(".choice-row")].find((r) => r.dataset?.rowName === selectedName);
        if (prevRow) {
          const prevDetails = prevRow.querySelector(".choice-row__details");
          if (prevDetails && !prevDetails.hidden) animateRowDetails(prevDetails, prevRow, false);
          else prevRow.classList.remove("choice-row--expanded");
        }
      }
      expandedChoiceRows.add(name);
      const d = row.querySelector(".choice-row__details");
      if (d && d.hidden) animateRowDetails(d, row, true);
      else if (d?.children.length) row.classList.add("choice-row--expanded");
      onSelect(name);
    };
    // First click selects the row and expands its details (animated);
    // clicking the open, selected row again collapses it and de-selects
    // (onSelect(null)). Row click alone handles collapse — no Collapse button.
    const toggleRow = () => {
      const detailsEl = row.querySelector(".choice-row__details");
      if (name === selectedName && expandedChoiceRows.has(name)) {
        expandedChoiceRows.delete(name);
        if (detailsEl) animateRowDetails(detailsEl, row, false);
        else row.classList.remove("choice-row--expanded");
        onSelect(null);
        return;
      }
      selectRow();
    };
    const row = el("div", {
      class: "choice-row" + (nested ? " choice-row--nested" : "") + (selected ? " choice-row--selected" : ""),
      "data-row-name": name,
      tabindex: 0, role: "button", "aria-pressed": String(selected),
      onclick: () => {
        preserveScrollWhile(toggleRow);
      },
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleRow(); } },
    });
    // Portrait slot: an icon when the caller has one for this option,
    // otherwise the first letter as before. Either way it repeats the row
    // label, so it's decorative to a screen reader.
    const iconGlyph = getIcon ? getIcon(name) : null;
    const portrait = el("div", { class: "choice-row__portrait" },
      iconGlyph || (info?.imageData
        ? el("img", { src: info.imageData, alt: "" })
        : (name || "?").charAt(0).toUpperCase()));
    if (iconGlyph) {
      portrait.classList.add("choice-row__portrait--icon");
      portrait.setAttribute("aria-hidden", "true");
      portrait.title = "How this option works";
    }
    row.append(portrait);
    const body = el("div", { class: "choice-row__body" },
      el("div", { class: "choice-row__label", text: name }),
      el("div", { class: "choice-row__description" },
        ...richAbilityNodes(humanizeGameText(info?.description || "No description available yet."))));
    row.append(body);
    const details = el("div", { class: "choice-row__details" });
    let hasDetails = false;
    if (getMechanicsList) {
      const sections = getMechanicsList(name) || [];
      for (const section of sections) {
        if (!section?.items?.length) continue;
        hasDetails = true;
        details.append(
          el("div", { class: "choice-row__mechanics-title", text: section.title }),
          el("ul", { class: "choice-row__mechanics-list" },
            ...section.items.map((item) => {
              // Live pick bullets (dropdowns embedded in the profile
              // sentence) render through their own builder below.
              if (item && typeof item === "object" && item.live === true) return renderLiveBulletItem(item);
              // Bold lead topic ("Speed", "Darkvision", …) joined to the
              // detail with an em dash — split on the first ": " only, so
              // colons inside descriptions never break the shape. Items
              // without a topic stay plain text. Every run goes through
              // the ability tokenizer so abbreviations tooltip.
              const colon = item.indexOf(": ");
              if (colon <= 0) {
                const alone = el("li", {});
                alone.append(...richAbilityNodes(humanizeGameText(item)));
                return alone;
              }
              const li = el("li", {},
                el("strong", {}, ...richAbilityNodes(item.slice(0, colon))),
                document.createTextNode(" — "));
              // The word after the em dash is always capitalized.
              li.append(...richAbilityNodes(humanizeGameText(capitalizeFirst(item.slice(colon + 2)))));
              return li;
            })));
      }
    } else if (getMechanics) {
      details.append(el("div", { class: "choice-row__mechanics", text: getMechanics(name) || "No mechanical data linked yet." }));
      hasDetails = true;
    }
    if (hasDetails) {
      // A click on a CONTROL inside an expanded row selects the row, and
      // stops there. Reaching the row's own handler would be wrong: the row
      // handler TOGGLES, so a click on the control of an already-selected,
      // open row would collapse it out from under the pointer.
      //
      // Clicks on anything else - the mechanics text, a trait name, the
      // padding - are left to bubble, so they select/toggle the row normally.
      // This used to stop every click, which made the expanded half of a row
      // dead to selection: with Expand All open, only the portrait-and-
      // flavour line above would take a click, and everything below it -
      // which is most of what the player is reading - did nothing.
      //
      // Which controls select on CLICK and which wait for CHANGE is the whole
      // subtlety, because selecting a row re-renders the page and every node
      // in the row is replaced. For a control whose action lives OUTSIDE the
      // row that is harmless: a dialog-opening picker link and a button are
      // already on the event path, so their own handler still runs after the
      // re-render and the dialog still opens. It is NOT harmless for a
      // native <select> - its popup never opens on a detached element - nor
      // for a text field, which would lose the caret mid-typing. Those select
      // the row on `change` instead: the moment the player has committed a
      // value, which is both safe and unambiguous about what they meant.
      //
      // The walk is hand-rolled and stops AT this details element rather than
      // using closest(): the row itself carries role="button", so closest()
      // walks past the real controls, reaches the row, matches it, and stops
      // every click again - which is precisely the bug this replaces.
      const SELECT_ON_CLICK = new Set(["BUTTON", "A"]);
      const isControl = (n) => SELECT_ON_CLICK.has(n.tagName)
        || n.tagName === "SELECT" || n.tagName === "INPUT" || n.tagName === "TEXTAREA"
        || n.tagName === "LABEL" || n.tagName === "OPTION"
        || n.classList?.contains("inline-pick-link")
        || n.getAttribute?.("role") === "button"
        || n.getAttribute?.("contenteditable") === "true";
      const survivesRerender = (n) => SELECT_ON_CLICK.has(n.tagName)
        || n.classList?.contains("inline-pick-link")
        || n.getAttribute?.("role") === "button";
      const findControl = (e) => {
        for (let n = e.target; n && n !== details; n = n.parentElement) {
          if (isControl(n)) return n;
        }
        return null;
      };
      // Capture phase, and that is not incidental. A picker link and an
      // inline-pick <select> each stop propagation in their OWN click
      // handler, so a bubble-phase listener here never sees them at all — the
      // walk below would find nothing and the row would stay unselected. In
      // capture the handler runs first, on the way down, before the control
      // has had its say.
      //
      // That ordering is also why the two cases differ in what they do to
      // propagation. A control that survives the re-render must be left alone:
      // stopping here would stop the event before it ever reached the control,
      // and a picker link's dialog would never open. A control that cannot
      // survive it is stopped, so the row's own toggle can never fire — but
      // only propagation is stopped, never the default, so a native dropdown
      // still opens on a detached-then-refreshed element and `change` still
      // arrives.
      details.addEventListener("click", (e) => {
        const control = findControl(e);
        // Plain text and padding: let it bubble, so the row selects/toggles.
        if (!control) return;
        if (survivesRerender(control)) { selectRow(); return; }
        e.stopPropagation();
      }, true);
      details.addEventListener("change", (e) => {
        const control = findControl(e);
        if (!control || survivesRerender(control)) return;
        selectRow();
      });
      if (collapsible) {
        // The selected row reads as expanded even on a fresh render
        // (e.g. resuming a saved-in-progress wizard) so picking
        // something never leaves its own details looking collapsed.
        // No Collapse button — row click alone toggles (animated).
        const expanded = expandedChoiceRows.has(name) || selected;
        details.hidden = !expanded;
        // Portrait grows from a square thumbnail to a full-body frame
        // while its row is the one showing details — a visual cue for
        // "this is the one you're looking at" alongside the highlight.
        row.classList.toggle("choice-row--expanded", expanded);
      }
      body.append(details);
    }
    row.append(body);
    list.append(row);
    if (afterRow) afterRow(name, row);
  });
  container.append(list);
  return list;
}

/** Multi-select rows — internal half of the generic picker table
 *  (see renderPickerTableInto); exported under its legacy name above.
 *  Same row/portrait/description look as single-select, but toggles
 *  membership in a Set instead of picking one name, for pickers like
 *  "which spells do you know" where more than one can be checked at
 *  once. Rows carry data-name so callers (spell-cap tooltip) can
 *  anchor feedback to the clicked row; getInfo may additionally
 *  return `mechanics` ({ meta, effect }) rendered as mechanical lines
 *  under the flavor description. */
function renderMultiPickerRows(container, names, { selectedSet, onToggle, getInfo } = {}) {
  const list = el("div", { class: "choice-row-list" });
  names.forEach((name) => {
    const info = getInfo ? getInfo(name) : null;
    const selected = selectedSet.has(name);
    const row = el("div", {
      class: "choice-row" + (selected ? " choice-row--selected" : ""),
      "data-name": name, tabindex: 0, role: "checkbox", "aria-checked": String(selected),
      onclick: () => preserveScrollWhile(() => onToggle(name)),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); preserveScrollWhile(() => onToggle(name)); } },
    });
    row.append(el("div", {
      class: "choice-row__portrait",
      text: selected ? "✓" : (name || "?").charAt(0).toUpperCase(),
    }));
    const body = el("div", { class: "choice-row__body" },
      el("div", { class: "choice-row__label", text: name }));
    // The full effect text below already says what the spell does, so
    // the short description line would just repeat it — it only shows
    // as a fallback for entries with no mechanics at all.
    if (!(info?.mechanics && (info.mechanics.meta || info.mechanics.effect))) {
      body.append(el("div", { class: "choice-row__description" },
        ...richAbilityNodes(humanizeGameText(info?.description || "No description available yet."))));
    }
    if (info?.mechanics?.meta) {
      // The basic facts get their OWN row, split into discrete facts rather
      // than one joined string. They are the things a player filters and scans
      // by - school, casting time, level, range, duration - and a single
      // "Level 1 · Evocation · 1 action · 120 ft · Instantaneous" run cannot
      // be read as anything but a wall. One element per fact also lets CSS
      // style a level or a casting time differently from a class list.
      body.append(el("div", { class: "choice-row__mechanics-meta" },
        ...spellMetaFacts(info.mechanics.meta).map((fact) => el("span", {
          class: "choice-row__fact choice-row__fact--" + fact.kind,
          text: fact.text,
        }))));
    }
    if (info?.gist) {
      // The brief gist: what the spell does AND what it deals, so a player
      // can compare spells without expanding anything. Sits below the facts
      // with a blank line above it, so the two read as separate registers.
      body.append(el("div", { class: "choice-row__mechanics-gist" },
        ...richAbilityNodes(info.gist)));
    }
    if (info?.mechanics?.effect && info.hasMoreThanGist) {
      // Disclosure for the full text. A <details> so it works with no script,
      // is keyboard accessible for free, and keeps its open state across its
      // own content updates. Rendered ONLY when the full text is actually
      // longer than the gist - a control that reveals nothing is worse than
      // no control.
      const details = el("details", { class: "choice-row__more" },
        el("summary", { class: "choice-row__more-toggle", text: "Full description" }),
        el("div", { class: "choice-row__mechanics-effect" },
          ...richAbilityNodes(info.mechanics.effect)));
      animateDisclosureInto(details);
      body.append(details);
    } else if (info?.mechanics?.effect) {
      // No gist, or the gist IS the whole text: show the effect outright
      // rather than burying it behind a toggle.
      body.append(el("div", { class: "choice-row__mechanics-effect" },
        ...richAbilityNodes(info.mechanics.effect)));
    }
    if (Array.isArray(info?.tags) && info.tags.length) {
      body.append(el("div", { class: "choice-row__tags" },
        ...[...info.tags].sort((a, b) => String(a).localeCompare(String(b)))
          .map((tag) => el("span", {
            class: "choice-row__tag",
            text: String(tag).replace(/(?:^|[\s-]+)\S/g, (c) => c.toUpperCase()),
          }))));
    }
    row.append(body);
    list.append(row);
  });
  container.append(list);
  return list;
}

/** Which shared choice dialog (if any) a bottom-section group belongs
 *  in once inlined into its row: skills, tools, fighting styles,
 *  expertise, or feats. Returns null for groups with their own inline
 *  rendering (languages, ASI slots, feature picks, subraces) or no
 *  options. Pure — customSheet uses it both to build inline bullets
 *  and to decide what stays in the bottom sections (nothing, these
 *  days). Feat groups open the same shared dialog as proficiencies:
 *  the summary itself is the link, the dialog lists every feat as a
 *  table with per-option descriptions, max enforcement, and
 *  Accept writes/Cancel discards. */
export function choiceDialogKindFor(group) {
  if (!group) return null;
  if (group.type === "flexibleAbilityBonus") return "flexibleAbilityBonus";
  // A spell pick (High Elf's cantrip) is a real pick, but its options
  // are the spell list rather than anything in the bundle, so the row
  // opens the shared dialog over catalog entries.
  if (group.spellPick) return "spells";
  const label = `${group.label || ""} ${group.source || ""}`;
  if (/fighting style/i.test(label)) return "styles";
  if (/expertise/i.test(label)) return "expertise";
  const category = typeof categorizeChoiceGroup === "function" ? categorizeChoiceGroup(group) : null;
  if (category === "feats") return "feats";
  if (/\bfeat\b/i.test(label)) return "feats";
  if (category === "skills") return "skills";
  if (category === "tools") return "tools";
  if (group.fieldId === "toolProf") return "tools";
  return null;
}

/** One shared choice dialog for every inlined pick list (skills, tools,
 *  fighting styles, expertise, feats) — a single dialog object reused
 *  across all instances of a kind, configured per open. Option list
 *  with per-option descriptions, max enforcement, locked (pre-granted)
 *  options, Accept writes/Cancel discards. `options` is a snapshot
 *  taken at open; `host` defaults to document.body (pass a container
 *  in tests).
 *
 *  opts: { title, multi, maxSelections, options,
 *    lockedIds, initialSelected, onAccept(ids), host } */
export function openChoiceDialog({
  title,
  multi = true,
  maxSelections = 1,
  options = [],
  lockedIds = [],
  initialSelected = [],
  // Optional [{ label, optionIds }] - non-selectable headings that break the
  // list into named groups, for pickers whose options fall into obvious
  // bands (the language list's Widespread/Rare split). The headings are NOT
  // options and cannot be picked; they exist so a 15-item list does not
  // read as one undifferentiated wall. Any option not named by a section is
  // listed after them, so omitting one cannot hide a choice.
  sections = null,
  onAccept,
  host = null,
  wide = false,
  // How tall the scrolling list may get. The dialog box itself is capped
  // at 80vh, so this is what decides how much of the list is on screen at
  // once. A list with a name and a sentence per row wants more than the
  // short pickers do.
  listMaxHeight = "50vh",
}) {
  const mount = host || document.body;
  // Singleton: opening a second dialog replaces the first, so there is
  // ever one dialog object no matter how many openers exist. Done by
  // direct child scan (not a :scope selector) so stub-DOM harnesses
  // enforce the same invariant as browsers.
  [...(mount.children || [])]
    .filter((c) => (c.className || "").split(/\s+/).includes("choice-dialog-overlay"))
    .forEach((c) => c.remove?.());
  const overlay = el("div", { class: "modal-overlay choice-dialog-overlay" });
  // The feat list is the one dialog with a long enough list to need the
  // width, so it's opt-in per opener rather than widening all of them.
  const box = el("div", { class: "modal-box choice-dialog" + (wide ? " choice-dialog--wide" : ""), onclick: (e) => e.stopPropagation() });
  const heading = el("h3", { text: title || "Choose an option" });
  const selected = new Set(initialSelected || []);
  const locked = new Set(lockedIds || []);
  const usable = (options || []).filter((o) => o && o.name);
  const countNote = el("p", { class: "leveling-tab__intro" });
  const listWrap = el("div", { class: "choice-dialog-list", style: `max-height: ${listMaxHeight}; overflow-y: auto;` });
  const updateCount = () => {
    const counted = [...selected].filter((id) => !locked.has(id)).length;
    countNote.textContent = multi ? `${counted}/${maxSelections} picked` : (counted ? "Picked" : "Nothing picked yet");
  };
  const renderList = () => {
    listWrap.innerHTML = "";
    // Options named by no section still have to be offered - a picker that
    // silently drops choices because the caller forgot to list them would be
    // far worse than an unheaded list.
    const named = new Set((sections || []).flatMap((s) => s.optionIds || []));
    const loose = usable.filter((o) => !named.has(o.id));
    const order = [
      ...(sections || []).map((s) => ({ label: s.label, options: usable.filter((o) => (s.optionIds || []).includes(o.id)) })),
      ...(loose.length ? [{ label: null, options: loose }] : []),
    ].filter((group) => group.options.length);

    const optionRow = (opt) => {
      const isSelected = selected.has(opt.id);
      const isLocked = locked.has(opt.id);
      const input = el("input", {
        type: multi ? "checkbox" : "radio", checked: isSelected || isLocked, disabled: isLocked, value: opt.id,
        onchange: (e) => {
          if (isLocked) return;
          if (multi) {
            const counted = [...selected].filter((id) => !locked.has(id));
            if (e.target.checked) {
              if (counted.length >= maxSelections) { e.target.checked = false; return; }
              selected.add(opt.id);
            } else {
              selected.delete(opt.id);
            }
          } else {
            selected.clear();
            selected.add(opt.id);
          }
          updateCount();
        },
      });
      if (!multi) input.name = `choice-dialog-${title}`;
      // Spell-shaped options carry their own furniture, because this dialog is
      // the LIVE spell picker: the standalone Spells step is gone, so a
      // spell's checkbox row in here is what the player actually reads.
      // Same shape as the picker rows - facts on their own row, a gist, and a
      // disclosure for the full text - so the two do not drift.
        const spellish = opt.meta || opt.gist;
        if (!spellish) {
          // The label carries the caller's own note for this option (what a
          // locked prerequisite needs, when the caller has one) so the row
          // says why it is not pickable on hover, like the rest of the app.
          const row = el("label", {
            class: "choice-dialog-option",
            ...(opt.title ? { title: opt.title } : {}),
          },
          input,
          el("span", { text: opt.name, style: "flex: 1;" }),
          opt.description ? el("span", { class: "choice-dialog-desc", text: opt.description }) : null);
          if (opt.title) {
            row.append(el("span", { class: "choice-dialog-note", text: opt.title }));
          }
          return row;
        }
      const facts = el("div", { class: "choice-row__mechanics-meta" },
        ...spellMetaFacts(opt.meta || "").map((fact) => el("span", {
          class: "choice-row__fact choice-row__fact--" + fact.kind,
          text: fact.text,
        })));
      const gist = el("div", { class: "choice-row__mechanics-gist" },
        ...richAbilityNodes(opt.gist || ""));
      const summaryBits = [facts, gist];
      if (opt.hasMoreThanGist && opt.fullText) {
        const more = el("details", { class: "choice-row__more" },
          el("summary", { class: "choice-row__more-toggle", text: "Full description" }),
          el("div", { class: "choice-row__mechanics-effect" },
            ...richAbilityNodes(opt.fullText)));
        animateDisclosureInto(more);
        summaryBits.push(more);
      }
      return el("label", { class: "choice-dialog-option choice-dialog-option--stacked" },
        input,
        el("span", { class: "choice-dialog-option__body" },
          el("span", { class: "choice-dialog-option__name", text: opt.name }),
          ...summaryBits));
    };

    for (const group of order) {
      // A heading is a div, not a label: nothing about it is pickable, and a
      // <label> would invite a click to select whatever it wrapped.
      if (group.label) listWrap.append(el("div", { class: "choice-dialog-section-label", text: group.label }));
      for (const opt of group.options) listWrap.append(optionRow(opt));
    }
    if (!listWrap.children.length) {
      listWrap.append(el("p", { class: "leveling-tab__intro", text: "No options available." }));
    }
    updateCount();
  };
  renderList();
  const close = () => {
    if (typeof document.removeEventListener === "function") document.removeEventListener("keydown", onKeyDown);
    overlay.remove();
  };
  function onKeyDown(e) {
    if (e.key === "Escape") close();
  }
  const actions = el("div", { class: "modal-actions" });
  const accept = el("button", {
    type: "button", class: "btn btn--primary", text: "Accept", onclick: () => {
      if (typeof onAccept === "function") onAccept([...locked, ...[...selected].filter((id) => !locked.has(id))].sort());
      close();
    },
  });
  const cancel = el("button", { type: "button", class: "btn", text: "Cancel", onclick: () => close() });
  actions.append(cancel, accept);
  box.append(heading, countNote, listWrap, actions);
  overlay.append(box);
  mount.append(overlay);
  // Escape closes (document-level: the overlay itself never takes
  // keyboard focus, so a listener on it would never fire).
  if (typeof document.addEventListener === "function") document.addEventListener("keydown", onKeyDown);
  return overlay;
}

/** One-line description for a feat option inside the shared choice
 *  dialog — the option's own text wins, else its first feature
 *  grant's text briefed to a table-friendly length. Pure. */
export function describeFeatOption(option) {
  if (option?.description) return option.description;
  const grantText = option?.featureGrants?.[0]?.description;
  if (grantText) {
    try {
      return briefDescription(grantText, 160);
    } catch {
      return String(grantText).slice(0, 160);
    }
  }
  return null;
}

/** Opens the shared choice dialog for a feat choice group — the
 *  exact same dialog proficiencies use: summary link opens, table
 *  lists every feat with per-option descriptions, max enforced,
 *  Accept writes/Cancel discards. */
function openFeatChoiceDialog(group, choicesStore, onChange, rerender, owned) {
  const opts = groupOptionsOf(group).filter((o) => o?.name);
  const lockedIds = [...new Set([
    ...(group.lockedOptionIds || []),
    ...opts.filter((o) => optionIsOwned(o, owned)).map((o) => o.id),
  ])];
  const stored = choicesStore[group.key] || [];
  openChoiceDialog({
    title: group.label || "Choose a feat",
    multi: group.maxSelections !== 1,
    maxSelections: group.maxSelections,
    // 83 feats with a mechanical line each; this is the dialog that
    // needs the full width on a big screen.
    wide: true,
    options: opts.map((o) => ({ id: o.id, name: o.name, description: describeFeatOption(o) })),
    lockedIds,
    initialSelected: stored,
    onAccept: (ids) => {
      choicesStore[group.key] = ids;
      if (onChange) onChange();
      rerender();
    },
  });
}

/** The six abilities a flexible ASI can raise, and the +2/+1 weights for
 *  the two dropdowns that replace the old two-step pattern dialog. */
export const ASI_ABILITY_CHOICES = [
  { id: "str", label: "Strength" },
  { id: "dex", label: "Dexterity" },
  { id: "con", label: "Constitution" },
  { id: "int", label: "Intelligence" },
  { id: "wis", label: "Wisdom" },
  { id: "cha", label: "Charisma" },
];

/** Read a stored flexible ASI pick back into the two dropdown values.
 *  Tolerates the older shape (an array of option ids) so a pick made
 *  before the dropdowns existed still shows in the right boxes instead of
 *  silently resetting. */
export function flexibleAsiSelection(pick) {
  if (!pick) return { plus2: "", plus1: "" };
  if (Array.isArray(pick)) {
    return { plus2: pick[0] || "", plus1: pick[1] || "" };
  }
  if (Array.isArray(pick.abilities) && pick.abilities.length) {
    return { plus2: pick.abilities[0] || "", plus1: pick.abilities[1] || "" };
  }
  return { plus2: "", plus1: "" };
}

/** Build the stored choice for a +2/+1 pair.
 *
 *  Deliberately the SAME shape the old two-step dialog produced
 *  ({pattern, abilities, statModifiers}), so every downstream consumer -
 *  the sheet's computed bonuses, the review lines, the live ability
 *  bullets - keeps working unchanged. Only the input UI changed: two
 *  dropdowns instead of a pattern dialog to step through.
 *
 *  Returns a PARTIAL draft while only one dropdown is filled, with no
 *  statModifiers. That matters: the two dropdowns are separate controls
 *  that each re-render the page, so storing nothing until both are set
 *  would wipe the first pick on the second dropdown's re-render and the
 *  pair could never be completed. An empty statModifiers list is inert
 *  downstream, so a half-finished pick grants nothing. */
export function buildFlexibleAsiChoice(plus2, plus1) {
  const a2 = String(plus2 || "");
  const a1 = String(plus1 || "");
  const abilities = [a2, a1].filter(Boolean);
  if (!abilities.length) return null;
  const complete = Boolean(a2 && a1 && a2 !== a1);
  return {
    id: `flexible-asi-2-1-${a2 || "none"}-${a1 || "none"}`,
    pattern: complete ? "2-1" : null,
    abilities,
    statModifiers: complete
      ? [
        { targetFieldId: `${a2}Score`, op: "add", value: 2 },
        { targetFieldId: `${a1}Score`, op: "add", value: 1 },
      ]
      : [],
  };
}

/** The summary a picked flexible ASI reads as, e.g. "+2 Strength,
 *  +1 Dexterity", or a prompt when nothing is picked yet. Shared by the
 *  row bullet and the bottom "Your choices" section so they can't drift. */
export function flexibleAsiSummary(pick) {
  if (!pick) return "Choose two ability scores";
  if (Array.isArray(pick)) {
    if (!pick.length) return "Choose two ability scores";
    return pick.map((id) => {
      const known = ASI_ABILITY_CHOICES.find((a) => a.id === id);
      return known ? known.label : String(id).toUpperCase();
    }).join(", ");
  }
  // A half-finished pick has no pattern yet, so there's no weight to
  // report — say what's chosen and what's still owed rather than
  // resetting to the empty prompt and making the first dropdown look
  // like it was forgotten.
  if (!pick.pattern) {
    if (!pick.abilities?.length) return "Choose two ability scores";
    const first = ASI_ABILITY_CHOICES.find((a) => a.id === pick.abilities[0]);
    return `${first ? first.label : String(pick.abilities[0]).toUpperCase()} — pick a second ability`;
  }
  return (pick.statModifiers || [])
    .map((m) => {
      const id = String(m.targetFieldId || "").replace(/Score$/, "");
      const known = ASI_ABILITY_CHOICES.find((a) => a.id === id);
      return `+${m.value} ${known ? known.label : id.toUpperCase()}`;
    })
    .join(", ") || "Choose two ability scores";
}


/** Shared renderer for a choiceGroups list's checkboxes/radios.
 *  Enforces maxSelections and shows already-owned proficiencies as
 *  picked-and-locked. A group may also name `lockedOptionIds`: those
 *  options are auto-selected, shown locked, and exempt from the pick
 *  budget (used for e.g. a mandatory default language). Re-renders
 *  itself after every change. */
export function renderChoiceGroupsInto(container, groups, choicesStore, namePrefix, onChange, ownedResolver, levelFor = null) {
  container.innerHTML = "";
  if (!groups.length) {
    const note = document.createElement("p");
    note.className = "leveling-tab__intro";
    note.textContent = "Nothing to choose here yet for your current Race/Class/Background selections.";
    container.append(note);
    return;
  }
  const rerender = () => renderChoiceGroupsInto(container, groups, choicesStore, namePrefix, onChange, ownedResolver);
  groups.forEach((group) => {
    console.debug("[RENDER] renderChoiceGroupsInto for group:", group.key, "choicesStore[group.key]:", JSON.stringify(choicesStore[group.key]));
    if (!choicesStore[group.key]) choicesStore[group.key] = [];
    const locked = new Set(group.lockedOptionIds || []);
    const selected = choicesStore[group.key];
    // Locked defaults persist even if some older save lacks them.
    const missingLocked = [...locked].filter((id) => !selected.includes(id));
    if (missingLocked.length) {
      choicesStore[group.key] = [...selected, ...missingLocked];
      if (onChange) onChange();
    }
    const counted = choicesStore[group.key].filter((id) => !locked.has(id));
    const owned = ownedResolver ? ownedResolver(group.key) : new Set();
    const choiceGroup = document.createElement("fieldset");
    choiceGroup.className = "level-guide__choices";
    const legend = document.createElement("legend");
    const count = group.minSelections === group.maxSelections
      ? `Choose ${group.maxSelections}`
      : `Choose up to ${group.maxSelections}`;
    legend.textContent = `${group.label || "Choose an option"} (${count} — ${counted.length}/${group.maxSelections} picked)`;
    choiceGroup.append(legend);
    const source = document.createElement("p");
    source.className = "level-guide__choice-source";
    source.textContent = group.source;
    choiceGroup.append(source);
    // Feat groups render as a summary link opening the shared choice
    // dialog — the exact same pattern proficiencies use — instead of
    // an inline checkbox wall. The dialog lists every feat as a
    // table with per-option descriptions; Accept writes, Cancel
    // discards. Choice bullets carry no superscript (see
    // renderLiveBulletItem): the summary itself is the link.
    if (choiceDialogKindFor(group) === "feats") {
      const opts = groupOptionsOf(group).filter((o) => o?.name);
      const pickedNames = (choicesStore[group.key] || [])
        .map((id) => opts.find((o) => o.id === id)?.name)
        .filter(Boolean);
      const summary = pickedNames.length ? pickedNames.join(", ") : `Choose ${group.maxSelections}`;
      const link = el("a", {
        href: "#", class: "inline-pick-link", text: summary, title: "Choose feats",
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); openFeatChoiceDialog(group, choicesStore, onChange, rerender, owned); },
      });
      choiceGroup.append(el("p", { class: "level-guide__feat-pick" }, link));
      container.append(choiceGroup);
      return;
    }
    if (choiceDialogKindFor(group) === "flexibleAbilityBonus") {
      // Two dropdowns (+2 to / +1 to), same as the row bullet. Built here
      // rather than reusing the row's bullet function so the bottom
      // section keeps its own rerender/onChange pair.
      const sel = flexibleAsiSelection((choicesStore[group.key] || [])[0]);
      const host = el("div", { class: "level-guide__asi-slots" });
      const makeSlot = (index, weight) => {
        const wrap = el("label", { class: "level-guide__asi-slot" });
        wrap.append(el("span", { text: `+${weight} to` }));
        const select = el("select", { class: "input-group__control" });
        select.append(el("option", { value: "", text: `+${weight} to…` }));
        for (const a of ASI_ABILITY_CHOICES) {
          const taken = index === 0 ? sel.plus1 : sel.plus2;
          select.append(el("option", {
            value: a.id, text: a.label, disabled: taken === a.id,
            title: taken === a.id ? "Already in the other dropdown" : null,
          }));
        }
        select.value = index === 0 ? sel.plus2 : sel.plus1;
        select.addEventListener("change", () => {
          const next = { plus2: sel.plus2, plus1: sel.plus1 };
          if (index === 0) next.plus2 = select.value; else next.plus1 = select.value;
          const choice = buildFlexibleAsiChoice(next.plus2, next.plus1);
          onChange(() => {
            choicesStore[group.key] = choice ? [choice] : [];
          });
        });
        wrap.append(select);
// Read by the caller after this render: "the step you just arrived at asked
  // to be shown from the top". Consumed and cleared here so it cannot leak
  // into the next render, which is not an arrival.
  wrap.consumeScrollTopRequest = () => {
    const wanted = scrollToTopOnRender;
    scrollToTopOnRender = false;
    return wanted;
  };

  return wrap;
      };
      host.append(makeSlot(0, 2), makeSlot(1, 1));
      choiceGroup.append(host);
      container.append(choiceGroup);
      return;
    }
    if (group.categories) {
      renderCrossCategoryChoiceInto(choiceGroup, group, choicesStore, rerender, onChange);
    } else {
      // Options a sibling unlock of the same family already holds, so a
      // later list greys out what an earlier one took. Names are the join
      // key: each group builds its option ids from its own prefix.
      const familyNames = new Set(familyTakenOptionNames(group, groups, choicesStore));
      const familyLocked = groupOptionsOf(group)
        .filter((o) => familyNames.has(o.name) && !(choicesStore[group.key] || []).includes(o.id))
        .map((o) => o.id);
      // Prerequisites the option's own text states (a pact boon, a level),
      // refused the same way: greyed, with the reason in the title.
      const taken = pickedOptionNames(groups, choicesStore);
      const level = Number(typeof levelFor === "function" ? levelFor(group) : levelFor) || 0;
      const notes = new Map();
      const unmet = [];
      for (const o of groupOptionsOf(group)) {
        if ((choicesStore[group.key] || []).includes(o.id)) continue;
        const note = optionRequirementNote(o, { pickedNames: taken, level });
        if (!note) continue;
        notes.set(o.id, note);
        unmet.push(o.id);
      }
      renderFlatChoiceOptionsInto(choiceGroup, group, selected, owned, choicesStore, namePrefix, rerender, onChange,
        new Set([...familyLocked, ...unmet]), notes);
    }
    container.append(choiceGroup);
  });
}

/** "Pick N total, but the options are split across two or more
 *  separate categories" — one <select> per category sharing ONE pick
 *  budget across all of them. */
export function renderCrossCategoryChoiceInto(container, group, choicesStore, rerender, onChange) {
  const selected = choicesStore[group.key];
  group.categories.forEach((category) => {
    const row = document.createElement("label");
    row.className = "level-guide__choice-option level-guide__category-choice";
    const text = document.createElement("span");
    text.textContent = category.label;
    const select = document.createElement("select");
    select.className = "input-group__control";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "— None —";
    select.append(noneOpt);
    category.options.forEach((option) => {
      const optionEl = document.createElement("option");
      optionEl.value = option.id;
      optionEl.textContent = option.name;
      select.append(optionEl);
    });
    const current = category.options.find((o) => selected.includes(o.id));
    select.value = current ? current.id : "";
    select.addEventListener("change", () => {
      // This dropdown can only ever hold one value, so its own
      // prior pick (if any) always drops first regardless of budget.
      let next = selected.filter((id) => !category.options.some((o) => o.id === id));
      if (select.value) next.push(select.value);
      while (next.length > group.maxSelections) next.shift(); // oldest (across ALL categories) evicted first
      choicesStore[group.key] = next;
      if (onChange) onChange();
      rerender();
    });
    row.append(text, select);
    container.append(row);
  });
}

export function renderFlatChoiceOptionsInto(choiceGroup, group, selected, owned, choicesStore, namePrefix, rerender, onChange, extraLocked = null, lockNotes = null) {
  const locked = new Set(group.lockedOptionIds || []);
  const lockedElsewhere = extraLocked instanceof Set ? extraLocked : new Set(extraLocked || []);
  const counted = selected.filter((id) => !locked.has(id));
  const atMax = counted.length >= group.maxSelections;
  group.options.forEach((option) => {
    const optionLabel = document.createElement("label");
    optionLabel.className = "level-guide__choice-option";
    const alreadyOwned = optionIsOwned(option, owned);
    const isLocked = locked.has(option.id);
    // Taken elsewhere in the same family (Metamagic at 10th, the same
    // option the 3rd already holds) or blocked by a prerequisite the
    // option's own text states. Disabled rather than hidden: the list a
    // player reads should be the whole list, and the reason goes in the
    // title, as with every other locked option here.
    const familyHeld = lockedElsewhere.has(option.id);
    const note = lockNotes instanceof Map ? lockNotes.get(option.id) : null;
    const input = document.createElement("input");
    input.type = group.maxSelections === 1 ? "radio" : "checkbox";
    input.name = `${namePrefix}-${group.key}`;
    input.value = option.id;
    const isChecked = selected.includes(option.id);
    input.checked = isChecked || alreadyOwned || isLocked;
    if (familyHeld && !isChecked) {
      input.disabled = true;
      optionLabel.classList.add("level-guide__choice-option--locked");
      optionLabel.title = note || "Already chosen at an earlier level";
    } else if (isLocked) {
      input.disabled = true;
      optionLabel.classList.add("level-guide__choice-option--locked");
      optionLabel.title = option.lockTitle || "Selected by default — this one can't be changed";
    } else if (alreadyOwned) {
      input.disabled = true;
      optionLabel.classList.add("level-guide__choice-option--granted");
      optionLabel.title = "Already have this from another selection — pick something else instead";
    } else if (input.type === "checkbox" && atMax && !isChecked) {
      // Don't disable if this option's prerequisite is now met (note is null/empty)
      // This allows prerequisite-unlocked options to be picked even when at maxSelections
      if (note) {
        input.disabled = true;
      }
    }
    input.addEventListener("change", () => {
      // Use global getter if available (updated by renderRulesTab) to handle
      // cases where character.rules.choices reference was replaced after render
      const getChoicesStore = (typeof window !== "undefined" && typeof window.__getChoicesStore === "function")
        ? window.__getChoicesStore
        : () => choicesStore;
      const liveChoicesStore = getChoicesStore();
      if (input.type === "radio") {
        // Locked defaults ride along — a radio pick must not drop them.
        const newVal = input.checked ? [option.id, ...locked].filter((id, i, arr) => arr.indexOf(id) === i) : [...locked];
        liveChoicesStore[group.key] = newVal;
      } else if (input.checked) {
        // Guards a full group even if disabling the input above
        // hasn't taken effect yet (e.g. two change events racing).
        // Locked defaults never consume budget.
        const countedNow = selected.filter((id) => !locked.has(id));
        if (countedNow.length >= group.maxSelections) { input.checked = false; return; }
        if (!selected.includes(option.id)) selected.push(option.id);
      } else {
        liveChoicesStore[group.key] = selected.filter((id) => id !== option.id);
      }
      if (onChange) onChange();
      rerender();
    });
    const text = document.createElement("span");
    text.append(...richAbilityNodes(option.name || "Unnamed option"));
    optionLabel.append(input, text);
    if (option.description) {
      const description = document.createElement("span");
      description.className = "level-guide__choice-description";
      description.append(...richAbilityNodes(humanizeGameText(option.description)));
      optionLabel.append(description);
    }
    choiceGroup.append(optionLabel);
  });
}

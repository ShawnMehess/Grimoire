// sheetWizard.js
//
// Pure wizard helpers extracted from customSheet.js.
// DOM rendering stays in customSheet.js for now; all list math,
// step navigation, and spell-catalog lookups live here testably.

import { briefDescription, capitalizeFirst } from "./sheetMechanics.js";
import { el } from "./sheetHelpers.js";
import { contentIdMatches } from "../../data/dnd5e.js";

export function isStepApplicable(step) {
  return !step.isApplicable || step.isApplicable();
}

export function nextApplicableStep(steps, fromIndex, dir = 1) {
  let i = fromIndex + dir;
  while (i >= 0 && i < steps.length) {
    if (isStepApplicable(steps[i])) return i;
    i += dir;
  }
  return fromIndex;
}

export function creationChoiceGroupsForState(state, bundleLookup) {
  const level = state.level;
  const groups = [];
  const push = (category, name) => {
    if (!name) return;
    const lib = bundleLookup(category, name, state.rulesetId);
    (lib?.choiceGroups || []).forEach((group, index) => {
      if (group.minLevel && level < group.minLevel) return;
      if (!Array.isArray(group.options) || group.options.length === 0) return;
      groups.push({
        ...group,
        key: `creation:${category}:${name}:${group.id || index}`,
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
  return groups;
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
  kept.sort((a, b) => String(a.text).localeCompare(String(b.text)));
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

/** Ability-score bonuses granted by staged picks (race bonuses
 *  chief among them), for display on the Ability Scores step so the
 *  applied total never surprises. `entries` is
 *  `[{ source, bundle }]` (e.g. Race/Class/Subclass/Background with
 *  their staged bundles); only `add`-op modifiers targeting
 *  `${abilityId}Score` count. Returns
 *  `{ [abilityId]: { bonus, sources } }` — zero-bonus abilities map
 *  to `{ bonus: 0, sources: [] }`. Pure. */
export function abilityScoreBonusesFrom(entries = [], abilityIds = []) {
  const out = {};
  (abilityIds || []).forEach((id) => { out[id] = { bonus: 0, sources: [] }; });
  (entries || []).forEach(({ source, bundle }) => {
    (bundle?.statModifiers || []).forEach((mod) => {
      if (mod?.op !== "add" || !Number.isFinite(mod.value) || !mod.value) return;
      const id = (abilityIds || []).find((aid) => mod.targetFieldId === `${aid}Score`);
      if (!id) return;
      out[id].bonus += mod.value;
      if (source && !out[id].sources.includes(source)) out[id].sources.push(source);
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

/** Merges several language choice groups into one picker: every
 *  distinct offered language (vocabulary order first, stragglers
 *  alphabetical after), the combined pick budget, and the combined
 *  requirement — each group's minSelections minus its options that
 *  would grant something already owned, mirroring
 *  groupPicksSatisfied per group. Pure. */
export function mergeLanguageGroups(groups, vocabulary = [], owned = new Set()) {
  const seen = new Set();
  const offered = [];
  (groups || []).forEach((group) => {
    groupOptionsOf(group).forEach((o) => {
      if (o.name && !seen.has(o.name)) {
        seen.add(o.name);
        offered.push(o.name);
      }
    });
  });
  const vocab = (vocabulary || []).filter((n) => seen.has(n));
  const rest = offered.filter((n) => !(vocabulary || []).includes(n)).sort((a, b) => a.localeCompare(b));
  let total = 0;
  let required = 0;
  (groups || []).forEach((group) => {
    const locked = new Set(group.lockedOptionIds || []);
    const options = groupOptionsOf(group);
    total += Math.max(0, group.maxSelections || 0);
    const freebies = options.filter((o) => !locked.has(o.id) && optionIsOwned(o, owned)).length;
    required += Math.max(0, (group.minSelections || 0) - freebies);
  });
  return { languages: [...vocab, ...rest], total, required };
}

/** Distributes a merged language pick set back onto the per-group
 *  choice keys every compute path already reads (so no downstream
 *  code changes): each language lands in the first group (in order)
 *  that offers it with budget left, locked defaults ride along on
 *  every group. Returns { [groupKey]: [optionIds] }. Pure. */
export function distributeLanguagePicks(groups, pickedNames) {
  const remaining = [...(pickedNames || [])];
  const out = {};
  (groups || []).forEach((group) => {
    const locked = [...(group.lockedOptionIds || [])];
    const mine = [...locked];
    const options = groupOptionsOf(group);
    const budget = Math.max(0, group.maxSelections || 0);
    let used = 0;
    for (let i = 0; i < remaining.length && used < budget;) {
      const opt = options.find((o) => o.name === remaining[i] && !mine.includes(o.id));
      if (!opt) { i += 1; continue; }
      mine.push(opt.id);
      remaining.splice(i, 1);
      used += 1;
    }
    out[group.key] = mine;
  });
  return out;
}

export function canPickMore({ selectedCount, maxSelections, isRadio }) {
  if (isRadio) return true;
  return selectedCount < maxSelections;
}

export function ordinal(n) {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
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
    .map((e) => ({
      name: e.name,
      description: e.description || "",
      classes: (e.fieldValues?.classes || "").trim(),
      classList: spellClassesFor(e),
      tags: Array.isArray(e.fieldValues?.tags) ? [...e.fieldValues.tags] : [],
      school: (e.fieldValues?.school || "").trim(),
      mechanics: spellMechanicsLine(e),
    }))
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
 *  casting/range/duration meta plus the effect's first sentence
 *  (damage, type, status effects live there). Returns
 *  { meta, effect } — either may be "". */
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
  return { meta: bits.join(" · "), effect: briefDescription(fv.effect, 160) };
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
// render(container), description?, descriptionItems?,
// unavailableMessage?}. isApplicable is re-checked on every render.
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

export function renderStepWizardInto(steps, stepState, { title, intro, onNavigate } = {}, gridFn) {
  const applicableSteps = applicableStepsOf(steps);
  if (applicableSteps.length === 0) return null;
  if (typeof stepState.stepId === "string") {
    const resumeAt = applicableSteps.findIndex((step) => step.id === stepState.stepId);
    if (resumeAt !== -1) stepState.index = resumeAt;
  }
  stepState.index = clampStepIndex(applicableSteps.length, stepState.index);
  // Single choke point for every step change — records the new
  // position (numeric index for this render, stable id for later
  // sessions) and notifies the caller before re-rendering.
  const goTo = (i) => {
    stepState.index = clampStepIndex(applicableSteps.length, i);
    stepState.stepId = applicableSteps[stepState.index]?.id ?? null;
    if (typeof onNavigate === "function") onNavigate(stepState);
    gridFn();
  };

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
  // like Next.
  steps.forEach((step) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.textContent = step.title;
    if (!isStepApplicable(step)) {
      dot.className = "wizard__dot wizard__dot--disabled wizard__dot--skipped";
      dot.disabled = true;
      dot.title = skippedStepTitle(step);
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
      dot.title = "Finish the current page first — It still needs decisions.";
      dots.append(dot);
      return;
    }
    dot.addEventListener("click", () => { goTo(i); });
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
  wrap.append(progress);

  const currentStep = applicableSteps[stepState.index];
  if (currentStep.descriptionItems && currentStep.descriptionItems.length) {
    const list = document.createElement("ul");
    list.className = "leveling-tab__intro wizard__step-description wizard__step-description--list";
    currentStep.descriptionItems.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.append(li);
    });
    wrap.append(list);
  } else if (currentStep.description) {
    const description = document.createElement("p");
    description.className = "leveling-tab__intro wizard__step-description";
    description.textContent = currentStep.description;
    wrap.append(description);
  }

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
      back.addEventListener("click", () => { goTo(stepState.index - 1); });
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
      forward.addEventListener("click", () => { goTo(stepState.index + 1); });
      nav.append(forward);
    }
    return nav;
  };

  wrap.append(buildNav("wizard__nav--top"));

  const body = document.createElement("div");
  body.className = "wizard__body level-guide__form";
  wrap.append(body);
  currentStep.render(body);

  const bottomNav = buildNav();
  wrap.append(bottomNav);

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
  return wrap;
}

/** Bundle-library class/race/background names tagged to one or more
 *  content packs (or whole rulesets) — unions across every included
 *  id (first-seen order), falling back to the hardcoded list (Class
 *  only) when nothing is imported yet. Accepts a single id or an
 *  array; legacy tags ("homebrew") match their new pack ("phb"). */
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
  return fromBundles.length ? fromBundles : fallback;
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
  spellcasting.h = Math.max(spellcasting.h, 6);
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
    note.textContent = "No spells found in an imported Spell List catalog yet — Import one from the Catalog Libraries manager, or just track spells directly on the sheet's Spells Known list.";
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
  tagOption("all", "All tags");
  presentTags.forEach((t) => tagOption(t, t));
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
// Migration of catalogEntryInfo / bundleFor (+ CATEGORY_FIELD) from
// customSheet.js. Best-effort flavor lookup matches by keyword since
// no stored link exists between bundle-library entries (mechanical)
// and catalog entries (flavor/portrait) yet.

export const CATEGORY_FIELD = { Race: ["race", "Race"], Class: ["class", "Class"], Background: ["background", "Background"], Subclass: ["subclass", "Subclass"] };

export function catalogEntryInfoIn(catalogs = [], keywords = [], name) {
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
 *  names through getMechanicsList/getMechanics (Class Traits vs.
 *  Racial Traits, spell meta lines, … — see mechanicsBulletsFor),
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

/** Multi-select table — legacy name, delegates to the generic
 *  picker table. Prefer renderPickerTableInto for new callers. */
export function renderMultiSelectableRowsInto(container, names, opts = {}) {
  return renderPickerTableInto(container, names, { ...opts, mode: "multi" });
}

function renderSinglePickerRows(container, names, { selectedName, onSelect, getInfo, getMechanics, getMechanicsList, afterRow, nested = false, collapsible = false } = {}) {
  const list = document.createElement("div");
  list.className = "choice-row-list" + (nested ? " choice-row-list--nested" : "");
  if (collapsible && names.length) {
    const controls = el("div", { class: "choice-row-list__collapse-controls" },
      el("button", {
        type: "button", class: "btn", text: "Expand All",
        onclick: () => {
          names.forEach((name) => expandedChoiceRows.add(name));
          list.querySelectorAll(".choice-row__details").forEach((d) => { d.hidden = false; });
          list.querySelectorAll(".choice-row__collapse-btn").forEach((b) => { b.hidden = false; b.setAttribute("aria-expanded", "true"); });
        },
      }),
      el("button", {
        type: "button", class: "btn", text: "Collapse All",
        onclick: () => {
          names.forEach((name) => expandedChoiceRows.delete(name));
          list.querySelectorAll(".choice-row__details").forEach((d) => { d.hidden = true; });
          list.querySelectorAll(".choice-row__collapse-btn").forEach((b) => { b.hidden = true; b.setAttribute("aria-expanded", "false"); });
        },
      }));
    container.append(controls);
  }
  names.forEach((name) => {
    const info = getInfo ? getInfo(name) : null;
    const selected = name === selectedName;
    // First click selects the row and expands its details; clicking
    // the open, selected row again collapses it and de-selects
    // (onSelect(null)). Collapsing is otherwise the Collapse
    // button's job alone, so a click never hides what was just picked.
    const toggleRow = () => {
      const detailsEl = row.querySelector(".choice-row__details");
      const collapseEl = row.querySelector(".choice-row__collapse-btn");
      if (name === selectedName && expandedChoiceRows.has(name)) {
        expandedChoiceRows.delete(name);
        if (detailsEl) detailsEl.hidden = true;
        if (collapseEl) {
          collapseEl.hidden = true;
          collapseEl.setAttribute("aria-expanded", "false");
        }
        onSelect(null);
        return;
      }
      expandedChoiceRows.add(name);
      if (detailsEl) detailsEl.hidden = false;
      if (collapseEl) {
        collapseEl.hidden = false;
        collapseEl.setAttribute("aria-expanded", "true");
      }
      onSelect(name);
    };
    const row = el("div", {
      class: "choice-row" + (nested ? " choice-row--nested" : "") + (selected ? " choice-row--selected" : ""),
      tabindex: 0, role: "button", "aria-pressed": String(selected),
      onclick: (e) => {
        // The Collapse button handles its own clicks (with
        // stopPropagation) — anything else on the row toggles.
        if (e.target.closest(".choice-row__collapse-btn")) return;
        toggleRow();
      },
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleRow(); } },
    });
    row.append(info?.imageData
      ? el("div", { class: "choice-row__portrait" }, el("img", { src: info.imageData, alt: "" }))
      : el("div", { class: "choice-row__portrait", text: (name || "?").charAt(0).toUpperCase() }));
    const body = el("div", { class: "choice-row__body" },
      el("div", { class: "choice-row__label", text: name }),
      el("div", { class: "choice-row__description", text: info?.description || "No description available yet." }));
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
              // Bold lead topic ("Speed", "Darkvision", …) joined to the
              // detail with an em dash — split on the first ": " only, so
              // colons inside descriptions never break the shape. Items
              // without a topic stay plain text.
              const colon = item.indexOf(": ");
              if (colon <= 0) return el("li", { text: item });
              return el("li", {},
                el("strong", { text: item.slice(0, colon) }),
                // The word after the em dash is always capitalized.
                document.createTextNode(` — ${capitalizeFirst(item.slice(colon + 2))}`));
            })));
      }
    } else if (getMechanics) {
      details.append(el("div", { class: "choice-row__mechanics", text: getMechanics(name) || "No mechanical data linked yet." }));
      hasDetails = true;
    }
    if (hasDetails) {
      if (collapsible) {
        const expanded = expandedChoiceRows.has(name);
        details.hidden = !expanded;
        // Collapse button lives at the bottom of the expanded content
        // and only exists while expanded — it collapses, never
        // expands, so it stays hidden on collapsed rows.
        const collapseBtn = document.createElement("button");
        collapseBtn.type = "button";
        collapseBtn.className = "choice-row__collapse-btn";
        collapseBtn.textContent = "Collapse";
        collapseBtn.setAttribute("aria-expanded", String(expanded));
        collapseBtn.hidden = !expanded;
        collapseBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          expandedChoiceRows.delete(name);
          details.hidden = true;
          collapseBtn.hidden = true;
          collapseBtn.setAttribute("aria-expanded", "false");
        });
        body.append(collapseBtn);
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
      onclick: () => onToggle(name),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(name); } },
    });
    row.append(el("div", {
      class: "choice-row__portrait",
      text: selected ? "✓" : (name || "?").charAt(0).toUpperCase(),
    }));
    const body = el("div", { class: "choice-row__body" },
      el("div", { class: "choice-row__label", text: name }),
      // The full effect text below already says what the spell does, so
      // the short description line would just repeat it — it only shows
      // as a fallback for entries with no mechanics at all.
      !(info?.mechanics && (info.mechanics.meta || info.mechanics.effect))
        ? el("div", { class: "choice-row__description", text: info?.description || "No description available yet." })
        : null,
      info?.mechanics?.meta ? el("div", { class: "choice-row__mechanics-meta", text: info.mechanics.meta }) : null,
      info?.mechanics?.effect ? el("div", { class: "choice-row__mechanics-effect", text: info.mechanics.effect }) : null,
      Array.isArray(info?.tags) && info.tags.length
        ? el("div", { class: "choice-row__tags" },
          ...[...info.tags].sort((a, b) => String(a).localeCompare(String(b)))
            .map((tag) => el("span", {
              class: "choice-row__tag",
              text: String(tag).replace(/(?:^|[\s-]+)\S/g, (c) => c.toUpperCase()),
            })))
        : null);
    row.append(body);
    list.append(row);
  });
  container.append(list);
  return list;
}

/** Shared renderer for a choiceGroups list's checkboxes/radios.
 *  Enforces maxSelections and shows already-owned proficiencies as
 *  picked-and-locked. A group may also name `lockedOptionIds`: those
 *  options are auto-selected, shown locked, and exempt from the pick
 *  budget (used for e.g. a mandatory default language). Re-renders
 *  itself after every change. */
export function renderChoiceGroupsInto(container, groups, choicesStore, namePrefix, onChange, ownedResolver) {
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
    if (group.categories) {
      renderCrossCategoryChoiceInto(choiceGroup, group, choicesStore, rerender, onChange);
    } else {
      renderFlatChoiceOptionsInto(choiceGroup, group, selected, owned, choicesStore, namePrefix, rerender, onChange);
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

export function renderFlatChoiceOptionsInto(choiceGroup, group, selected, owned, choicesStore, namePrefix, rerender, onChange) {
  const locked = new Set(group.lockedOptionIds || []);
  const counted = selected.filter((id) => !locked.has(id));
  const atMax = counted.length >= group.maxSelections;
  group.options.forEach((option) => {
    const optionLabel = document.createElement("label");
    optionLabel.className = "level-guide__choice-option";
    const alreadyOwned = optionIsOwned(option, owned);
    const isLocked = locked.has(option.id);
    const input = document.createElement("input");
    input.type = group.maxSelections === 1 ? "radio" : "checkbox";
    input.name = `${namePrefix}-${group.key}`;
    input.value = option.id;
    const isChecked = selected.includes(option.id);
    input.checked = isChecked || alreadyOwned || isLocked;
    if (isLocked) {
      input.disabled = true;
      optionLabel.classList.add("level-guide__choice-option--locked");
      optionLabel.title = option.lockTitle || "Selected by default — this one can't be changed";
    } else if (alreadyOwned) {
      input.disabled = true;
      optionLabel.classList.add("level-guide__choice-option--granted");
      optionLabel.title = "Already have this from another selection — pick something else instead";
    } else if (input.type === "checkbox" && atMax && !isChecked) {
      input.disabled = true;
    }
    input.addEventListener("change", () => {
      if (input.type === "radio") {
        // Locked defaults ride along — a radio pick must not drop them.
        choicesStore[group.key] = input.checked ? [option.id, ...locked].filter((id, i, arr) => arr.indexOf(id) === i) : [...locked];
      } else if (input.checked) {
        // Guards a full group even if disabling the input above
        // hasn't taken effect yet (e.g. two change events racing).
        // Locked defaults never consume budget.
        const countedNow = selected.filter((id) => !locked.has(id));
        if (countedNow.length >= group.maxSelections) { input.checked = false; return; }
        if (!selected.includes(option.id)) selected.push(option.id);
      } else {
        choicesStore[group.key] = selected.filter((id) => id !== option.id);
      }
      if (onChange) onChange();
      rerender();
    });
    const text = document.createElement("span");
    text.textContent = option.name || "Unnamed option";
    optionLabel.append(input, text);
    if (option.description) {
      const description = document.createElement("span");
      description.className = "level-guide__choice-description";
      description.textContent = option.description;
      optionLabel.append(description);
    }
    choiceGroup.append(optionLabel);
  });
}

// sheetLeveling.js
//
// Pure leveling/bundle math extracted from customSheet.js.
// All functions take explicit args (no character closure) so they are
// testable; customSheet.js thin-wraps them with its own state.

import { autoSpellParts } from "./sheetMechanics.js";

export function levelFromMap(levelFieldId, valueMap) {
  if (!levelFieldId) return Infinity;
  const v = valueMap[levelFieldId];
  return Number.isFinite(v) ? v : 0;
}

/** The highest character level the rules run to. Not a "nice to know"
 *  number but a hard edge the rest of the app already enforces in four
 *  places as a bare literal (currentCharacterLevel in customSheet.js,
 *  normalizeRulesState/classLevelsFor in rulesEngine.js, the level
 *  tables in dnd5e.js, and the per-level row loop below) - naming it
 *  here lets the level-up UI say "that's the cap" instead of letting a
 *  typed 21 read as "no level at all". */
export const LEVEL_CAP = 20;

/** Reads the Level field as a number WITHOUT the 1..20 clamp, so a
 *  character left at an out-of-range number reports what is actually
 *  there. `currentCharacterLevel` deliberately degrades to null there;
 *  the level-up button needs to tell "you typed nonsense" apart from
 *  "you typed 21 and hit the cap" to decide which message to show.
 *  Pure - returns null when the field holds no plain integer. */
export function rawLevelFrom(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

/** What clicking "Level Up" should do at the current level. Pure, and
 *  the single place the three outcomes are decided:
 *
 *    "unknown" - no readable level, so there is nothing to level up
 *                FROM. (Level missing/blank/non-numeric.)
 *    "capped"  - at the cap (or past it from a manual edit), so the
 *                button is disabled rather than silently refusing.
 *    "resume"  - this level already has in-progress picks, so the level
 *                was raised on an earlier click and the button returns
 *                to that walkthrough instead of raising AGAIN.
 *    "start"   - raise to level + 1.
 *
 *  `pendingAtLevel` is "does character.levelingPending have an entry for
 *  this level" — the wizard keys its in-progress picks by the level
 *  being applied, which (because raising happens on click) is the level
 *  the button just moved to. */
export function levelUpTarget(level, { pendingAtLevel = false, cap = LEVEL_CAP } = {}) {
  // NaN and Infinity fail every comparison silently, so either would
  // otherwise fall all the way through to "start" and produce NaN + 1
  // (or 21). Normalize to null first and treat it as unreadable.
  const parsed = Number(level);
  const at = Number.isFinite(parsed) ? parsed : null;
  if (at == null) {
    return { kind: "unknown", label: "Level Up", reason: "Set your Level on the sheet first — then this button can level you up." };
  }
  if (at >= cap) {
    return { kind: "capped", level: at, cap, label: "Level Up", reason: `Level ${cap} is the highest level in the rules — you've reached the top.` };
  }
  if (at < 1) {
    return { kind: "unknown", level: at, label: "Level Up", reason: `Level ${at} isn't a level — set it to a number from 1 to ${cap} on the sheet.` };
  }
  if (pendingAtLevel) {
    return { kind: "resume", level: at, label: "Continue Level Up", reason: `Level ${at} is already started — continue where you left off.` };
  }
  return { kind: "start", level: at + 1, label: "Level Up", reason: `Raise your Level field to ${at + 1} and walk through what you gain.` };
}

/** "4", "4 and 5", "3, 4 and 5" - a bare level list for prose, with the
 *  Oxford comma only once there are three. Pure. */
export function formatLevelList(levels) {
  const nums = (levels || []).filter(Number.isFinite);
  if (nums.length <= 1) return nums.length ? String(nums[0]) : "";
  if (nums.length === 2) return `${nums[0]} and ${nums[1]}`;
  return `${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]}`;
}

/** What has actually been recorded against a character's levels, and
 *  which levels a multi-level jump skipped over.
 *
 *  A level counts as RECORDED when its levelUps entry carries
 *  `appliedRulesetId` - the same marker renderRulesetLevelGuide already
 *  treats as "this level was applied" (re-applying would stack HP, ASIs
 *  and multiclass levels). No new flag on the character. The manual
 *  per-level rows write free text into the same object without that
 *  marker, so a hand-filled row is correctly NOT a recorded level-up.
 *
 *  The FLOOR is what makes this quiet for characters who did nothing
 *  wrong:
 *
 *  - `createdAtLevel` (written once at Finish Setup) is the level the
 *    character was MADE at. Character creation records nothing at all, so
 *    without it a character created at level 3 would look like levels 1-3
 *    were all skipped.
 *  - Legacy characters have no `createdAtLevel` and it cannot be
 *    back-filled honestly. One with no recorded level-ups at all has no
 *    evidence of a jump, so the floor becomes the current level and it is
 *    left alone; nagging every pre-existing level-5 sheet would be a worse
 *    regression than missing a jump nobody recorded. A legacy character
 *    WITH records is still measured from its highest.
 *
 *  Pure - returns the ordered list of outstanding levels, the level the
 *  wizard should process next (the LOWEST outstanding one, so the passes
 *  happen in order and each level's own numbers are computed for that
 *  level), the banner sentence, and a progress label. */
export function levelingRecordState(sheetLevel, { levelUps = {}, createdAtLevel = null } = {}) {
  const recorded = Object.entries(levelUps || {})
    .filter(([, entry]) => entry && typeof entry === "object" && entry.appliedRulesetId)
    .map(([key]) => Number(key))
    .filter((n) => Number.isFinite(n) && n >= 1)
    .sort((a, b) => a - b);
  const highestRecorded = recorded.length ? recorded[recorded.length - 1] : null;
  const creation = Number.isFinite(createdAtLevel) && createdAtLevel >= 1
    ? createdAtLevel
    : (recorded.length ? 1 : sheetLevel);
  const floor = Math.max(creation, highestRecorded ?? 0);

  const unrecorded = [];
  const seen = new Set(recorded);
  for (let l = Math.max(1, floor) + 1; l <= (sheetLevel ?? 0); l++) {
    if (!seen.has(l)) unrecorded.push(l);
  }
  const hasGap = unrecorded.length > 0;
  const levelToProcess = hasGap ? unrecorded[0] : sheetLevel;
  const first = unrecorded[0];
  const last = unrecorded[unrecorded.length - 1];

  return {
    recorded,
    highestRecorded,
    creationLevel: creation,
    unrecorded,
    hasGap,
    levelToProcess,
    progressLabel: hasGap ? `Level ${levelToProcess} of ${first === last ? first : `${first}-${last}`}` : null,
    bannerText: hasGap
      ? `You're level ${sheetLevel}, but ${unrecorded.length === 1 ? "level" : "levels"} ${formatLevelList(unrecorded)} ${unrecorded.length === 1 ? "hasn't" : "haven't"} been recorded yet.`
      : null,
  };
}

/** "Level N gives you:" — the plain-language summary at the top of the
 *  walkthrough, from `levelGainLines` (which only ever quotes sourced
 *  text).
 *
 *  Returns null when there is nothing sourced to say, so a level with no
 *  data on file shows no heading at all. An empty "Level 8 gives you:"
 *  over a blank list reads as a bug in the app rather than as an absence
 *  of data.
 *
 *  `level` is the level being worked on, which is NOT always the level on
 *  the sheet: a jump the banner is walking through shows the level the
 *  walkthrough is actually on. */
export function renderLevelGainsInto(container, lines = [], { level, doc = document } = {}) {
  const usable = (lines || []).filter((l) => l && l.name);
  if (!usable.length) return null;
  const wrap = doc.createElement("section");
  wrap.className = "level-gains";
  const heading = doc.createElement("h3");
  heading.className = "level-gains__heading";
  heading.textContent = `Level ${level} gives you:`;
  wrap.append(heading);
  const list = doc.createElement("ul");
  list.className = "level-gains__list";
  for (const line of usable) {
    const item = doc.createElement("li");
    const name = doc.createElement("strong");
    name.textContent = line.name;
    item.append(name);
    // No description means the name stands alone. Nothing is paraphrased in
    // to fill the gap - an invented rules sentence is worse than none,
    // because a player cannot tell which parts to trust.
    if (line.description) {
      item.append(doc.createTextNode(" — "));
      // Plain text, matching how renderLevelingGlanceInto renders the same
      // grant names and sources. Rich-text runs (ability highlighting, spell
      // links) would mean importing sheetWizard.js here for a summary
      // paragraph, and the glance this sits beside doesn't do them either.
      item.append(doc.createTextNode(line.description));
    }
    list.append(item);
  }
  wrap.append(list);
  container.append(wrap);
  return wrap;
}

/** The revert dialog's body: what it takes back, and - only when there is
 *  any - what has been edited by hand since and would be lost. Built as
 *  real nodes rather than a string so the list can be a list, and so the
 *  conflicts read as a separate, more serious block from the summary.
 *
 *  Pure apart from the `document` it needs; no app state. */
export function buildRevertDialogBody(lines = [], conflicts = [], doc = document) {
  const wrap = doc.createElement("div");
  wrap.className = "app-dialog__revert";
  if (lines.length) {
    const list = doc.createElement("ul");
    list.className = "app-dialog__revert-list";
    for (const line of lines) {
      const li = doc.createElement("li");
      li.textContent = line;
      list.append(li);
    }
    wrap.append(list);
  }
  if (conflicts.length) {
    const warn = doc.createElement("p");
    warn.className = "app-dialog__revert-warning";
    // role="alert" so the warning is announced as the dialog opens,
    // rather than being something a screen-reader user only finds by
    // going looking for it.
    warn.setAttribute("role", "alert");
    warn.textContent = "Since this level was applied, you have changed some of these by hand. Reverting puts the old values back, and those changes will be lost:";
    const list = doc.createElement("ul");
    list.className = "app-dialog__revert-list";
    for (const line of conflicts) {
      const li = doc.createElement("li");
      li.textContent = line;
      list.append(li);
    }
    wrap.append(warn, list);
  }
  return wrap;
}

/** The revert control for the Leveling tab: a button for the highest
 *  recorded level, or - for a character whose highest recorded level has
 *  no record - a plain note saying why it can't be done. Never a disabled
 *  button with a tooltip: nothing here is hoverable on a phone.
 *
 *  Returns null when there is nothing to say and nothing to offer, so the
 *  tab isn't carrying dead chrome. */
export function buildRevertControl({ level, canRevert, onRevert, doc = document }) {
  if (level == null) return null;
  const wrap = doc.createElement("div");
  wrap.className = "leveling-revert";
  if (!canRevert) {
    const note = doc.createElement("p");
    note.className = "leveling-revert__note";
    note.textContent = "Can't revert automatically; this level was recorded before reverting existed.";
    wrap.append(note);
    return wrap;
  }
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "btn btn--danger leveling-revert__btn";
  btn.textContent = `Revert Level ${level}`;
  btn.title = `Put back everything level ${level} changed`;
  btn.addEventListener("click", () => onRevert(level));
  wrap.append(btn);
  return wrap;
}

/** The toolbar's "Level Up" control, built from a `levelUpTarget`
 *  result. One node holding the button plus a caption that carries the

 *  reason: `aria-describedby` points at that same caption rather than
 *  only a `title`, because a tooltip is invisible to a keyboard user
 *  and unreadable on a phone. The caption is VISIBLE whenever the
 *  button is disabled (unknown level, or the cap) so the reason is
 *  never something you have to go looking for.
 *
 *  Returns the wrapper so the caller can append it to the toolbar once
 *  and re-sync it later (a level field edit, a pending pick, finishing
 *  setup) via `syncLevelUpControl`. */
export function buildLevelUpControl(target, onClick) {
  const wrap = document.createElement("span");
  wrap.className = "level-up";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn--primary level-up__btn";
  wrap.append(btn);

  const note = document.createElement("span");
  note.className = "level-up__note";
  note.id = "level-up-note";
  wrap.append(note);

  btn.addEventListener("click", () => {
    // A disabled button doesn't fire click, but a stale one (level
    // changed under us since the last sync) must still not act.
    if (btn.disabled) return;
    onClick(target);
  });

  wrap.syncLevelUpControl = (next) => {
    target = next;
    const disabled = next.kind === "unknown" || next.kind === "capped";
    btn.textContent = next.label;
    btn.disabled = disabled;
    btn.classList.toggle("level-up__btn--resume", next.kind === "resume");
    btn.title = next.reason;
    note.textContent = disabled ? next.reason : "";
    note.hidden = !disabled;
    if (disabled) btn.setAttribute("aria-describedby", note.id);
    else btn.removeAttribute("aria-describedby");
    // A disabled button drops out of the tab order, so the reason has to
    // be reachable another way or a screen-reader user just finds a dead
    // control. role="status" announces it when it appears on render.
    if (disabled) note.setAttribute("role", "status");
    else note.removeAttribute("role");
  };
  wrap.syncLevelUpControl(target);
  return wrap;
}

export function normalizeChoiceGroup(group, index, keyPrefix) {
  return {
    ...group,
    key: `${keyPrefix}:${group.id || index}`,
    minLevel: Number.isFinite(group.minLevel) ? group.minLevel : 0,
    maxSelections: Math.max(1, Number.parseInt(group.maxSelections, 10) || 1),
    minSelections: Math.max(0, Number.parseInt(group.minSelections, 10) || 0),
  };
}

/** Options a group offers across both shapes: a flat `options`
 *  list, a cross-category `categories` list, or both. Pure. */
export function groupOptionsOf(group) {
  return [
    ...(group?.options || []),
    ...((group?.categories || []).flatMap((c) => c.options || [])),
  ];
}

/** Whether a group or option may show for the given content packs —
 *  mirrors packAllows in sheetWizard.js (kept local so this module
 *  stays dependency-free). */
function packAllowsLocal(item, includedPacks) {
  if (!item || !item.requiresPack) return true;
  if (includedPacks == null) return true;
  const packs = Array.isArray(includedPacks) ? includedPacks : [includedPacks];
  return packs.includes(item.requiresPack);
}

function filterGroupByPackLocal(group, includedPacks) {
  if (!group) return null;
  if (!packAllowsLocal(group, includedPacks)) return null;
  const keep = (options) => (options || []).filter((o) => packAllowsLocal(o, includedPacks));
  const options = Array.isArray(group.options) ? keep(group.options) : group.options;
  let categories = group.categories;
  if (Array.isArray(group.categories)) {
    categories = group.categories
      .map((c) => ({ ...c, options: keep(c.options) }))
      .filter((c) => (c.options || []).length > 0);
  }
  if (groupOptionsOf({ options, categories }).length === 0) return null;
  const pruned =
    (options || []).length !== ((group.options || []).length)
    || (categories || []).length !== ((group.categories || []).length);
  if (!pruned) return group;
  return { ...group, options, categories };
}

export function activeChoiceGroupsFor(fields, level, levelFor = null, extraBundles = [], includedPacks = null) {
  const groups = [];
  fields.forEach((field) => {
    if (field.fieldType !== "dropdown") return;
    const choice = (field.choices || []).find((candidate) => candidate.id === field.selected);
    const bundle = choice?.bundle;
    const lvl = effectiveLevel(levelFor, level, field, choice, bundle);
    (bundle?.choiceGroups || []).forEach((group, index) => {
      if (group.minLevel && lvl < group.minLevel) return;
      const gated = filterGroupByPackLocal(group, includedPacks);
      if (!gated || groupOptionsOf(gated).length === 0) return;
      groups.push({
        ...normalizeChoiceGroup(gated, index, `${field.id}:${choice.id}`),
        source: choice.text || field.label,
      });
    });
  });
  // Multiclass secondary bundles surface their pickers under stable
  // `multiclass:<Class>:<group>` keys so picks persist across renders.
  (extraBundles || []).forEach(({ bundle, level: extraLevel, source }) => {
    const lvl = Number.isFinite(extraLevel) ? extraLevel : level;
    (bundle?.choiceGroups || []).forEach((group, index) => {
      if (group.minLevel && lvl < group.minLevel) return;
      const gated = filterGroupByPackLocal(group, includedPacks);
      if (!gated || groupOptionsOf(gated).length === 0) return;
      groups.push({
        ...normalizeChoiceGroup(gated, index, `multiclass:${source || "class"}`),
        source: source || "Multiclass",
      });
    });
  });
  return groups;
}

export function applyStatModifiers(modifiers, valueMap, checkboxGrants, tagGrants, level) {
  (modifiers || []).forEach((mod) => {
    if (!mod.targetFieldId) return;
    if (mod.minLevel && level < mod.minLevel) return;
    if (mod.op === "grant") {
      const key = `${mod.targetFieldId}::${mod.targetIndex || 0}`;
      checkboxGrants.add(key);
      valueMap[key] = 1;
      return;
    }
    if (mod.op === "grantTag") {
      if (!mod.value) return;
      if (!tagGrants.has(mod.targetFieldId)) tagGrants.set(mod.targetFieldId, new Set());
      tagGrants.get(mod.targetFieldId).add(mod.value);
      return;
    }
    const current = Number.isFinite(valueMap[mod.targetFieldId]) ? valueMap[mod.targetFieldId] : 0;
    const amount = Number.isFinite(mod.value) ? mod.value : 0;
    switch (mod.op) {
      case "add": valueMap[mod.targetFieldId] = current + amount; break;
      case "subtract": valueMap[mod.targetFieldId] = current - amount; break;
      case "multiply": valueMap[mod.targetFieldId] = current * amount; break;
      case "set": valueMap[mod.targetFieldId] = amount; break;
      default: break;
    }
  });
}

export function grantedFeaturesFor(fields, level) {  const features = [];
  fields.forEach((field) => {
    if (field.fieldType !== "dropdown") return;
    const choice = (field.choices || []).find((c) => c.id === field.selected);
    const bundle = choice && choice.bundle;
    if (!bundle) return;
    (bundle.featureGrants || []).forEach((grant) => {
      if (grant.minLevel && level < grant.minLevel) return;
      features.push({
        name: grant.name,
        description: grant.description || "",
        level: grant.minLevel || 0,
        source: field.label || field.id,
      });
    });
  });
  features.sort((a, b) => a.level - b.level || String(a.source).localeCompare(String(b.source)));
  return features;
}

// --- Per-render computed values ---------------------------------------------// Migration of computeSheetValues / computeRadioOptionCounts /
// computeSpellSlotCounts / normalizeRadioSelections from customSheet.js.
// The renderer keeps its `grantedCheckboxes`/`grantedTags`/
// `grantedFeatures` lets as the source of truth; these take explicit
// inputs and either mutate a passed `granted` bundle or return fresh
// data, so they stay testable.

export function computeSheetValuesIn(fields, deps) {
  const { computeAllFormulasFn, applyBundleModifiersFn, collectGrantedFeaturesFn, evaluateFormulaNodeFn } = deps;
  const valueMap = computeAllFormulasFn(fields);
  const granted = {
    checkboxes: new Set(),
    tags: new Map(),
    features: [],
  };
  applyBundleModifiersFn(fields, valueMap, granted.checkboxes, granted.tags);
  granted.features = collectGrantedFeaturesFn(fields, valueMap);
  // One more settle pass so anything a bundle modifier just changed
  // (e.g. a race bonus on Strength) flows through to formulas that
  // reference it (e.g. a Strength-based skill).
  const formulaFields = fields.filter((f) => f.fieldType === "text" && f.formula);
  for (let pass = 0; pass < 3; pass++) {
    formulaFields.forEach((f) => {
      const result = evaluateFormulaNodeFn(f.formula, valueMap);
      if (Number.isFinite(result)) valueMap[f.id] = result;
    });
  }
  return { valueMap, granted };
}

/** A radio field's optional optionsFormula computes how many buttons
 *  it shows, using the SAME variable pool (valueMap) as every other
 *  formula on the sheet. Clamped to zero or more and rounded, since
 *  a fractional or negative button count isn't meaningful. */
export function computeRadioOptionCountsIn(fields, valueMap, evaluateFormulaNodeFn) {
  const counts = {};
  fields.forEach((f) => {
    if (f.fieldType === "radio" && f.optionsFormula) {
      const result = evaluateFormulaNodeFn(f.optionsFormula, valueMap);
      counts[f.id] = Number.isFinite(result) ? Math.max(0, Math.round(result)) : 0;
    }
  });
  return counts;
}

export function computeSpellSlotCountsIn(fields, valueMap, { rulesetId, className, level, planFn }) {
  const counts = {};
  if (!rulesetId || !className) return counts;
  if (!Number.isFinite(level)) return counts;
  (planFn(rulesetId, className, level)?.slotChanges || []).forEach((change) => {
    counts[change.fieldId] = change.options;
  });
  return counts;
}

/** If a radio field's live button count just shrank below its current
 *  selection, clear the now out-of-range selection rather than leave
 *  it silently pointing at a button that no longer exists. */
export function normalizeRadioSelectionsIn(fields, formulaCounts, slotCounts) {
  let changed = false;
  fields.forEach((f) => {
    if (f.fieldType !== "radio" || f.selected == null) return;
    const isSlotField = Object.prototype.hasOwnProperty.call(slotCounts, f.id);
    if (!f.optionsFormula && !isSlotField) return;
    const count = f.optionsFormula ? (formulaCounts[f.id] || 0) : (slotCounts[f.id] || 0);
    if (f.selected > count) {
      f.selected = count > 0 ? count : null;
      changed = true;
    }
  });
  return changed;
}

export const LEVEL_UP_FIELDS = [  { key: "className", label: "Class Taken", placeholder: "e.g. Fighter" },
  { key: "hp", label: "HP Gained", placeholder: "e.g. +7, or rolled 1d8+2" },
  { key: "asiFeat", label: "Ability Score Improvement / Feat", placeholder: "e.g. +2 STR, or the Alert feat" },
  { key: "subclass", label: "Subclass", placeholder: "e.g. Champion" },
  { key: "skillProfs", label: "Skill Proficiencies Gained", placeholder: "e.g. Persuasion, Insight" },
  { key: "itemProfs", label: "Tool / Weapon / Armor Proficiencies Gained", placeholder: "e.g. Thieves' Tools" },
  { key: "spells", label: "Spells Learned / Prepared", placeholder: "e.g. Fireball, Misty Step" },
  { key: "features", label: "Features Gained", placeholder: "e.g. Extra Attack, Uncanny Dodge" },
  { key: "notes", label: "Notes", placeholder: "Anything else worth remembering" },
];

// --- Per-render settle pipeline ------------------------------------------------
//
// Migration of renderPageGrid's normalize/compute/normalize/recompute
// core (lines ~2049-2071 in customSheet.js). Computed BEFORE
// normalizing dropdown selections (not after) so a minLevel-gated
// access rule checks the level this render computed, not last
// render's; a second settle pass follows when normalization changed
// the active bundle. Takes explicit fns; returns fresh state plus
// whether the caller should persist the normalization corrections:
//
//   prepareRenderState(allFields, {
//     normalizeChoicesFn, computeValuesFn, optionCountsFn,
//     slotCountsFn, normalizeRadioFn,
//   })
export function prepareRenderState(allFields, fns) {
  const { normalizeChoiceObjectsFn, computeValuesFn, normalizeDropdownsFn, optionCountsFn, slotCountsFn, normalizeRadioFn } = fns;
  let needsNormalizedPersist = false;
  if (normalizeChoiceObjectsFn(allFields)) needsNormalizedPersist = true;
  let formulaValues = computeValuesFn(allFields);
  if (normalizeDropdownsFn(allFields)) {
    needsNormalizedPersist = true;
    formulaValues = computeValuesFn(allFields);
  }
  const radioCounts = optionCountsFn(allFields, formulaValues);
  const slotCounts = slotCountsFn(allFields, formulaValues);
  if (normalizeRadioFn(allFields, radioCounts, slotCounts)) {
    needsNormalizedPersist = true;
  }
  return { formulaValues, radioCounts, slotCounts, needsNormalizedPersist };
}

// --- Rule options / feat bundles / grant collection --------------------------------
//
// Migration of selectedRuleOptions / selectedFeatBundles /
// applyBundleModifiers / collectGrantedFeatures cores from
// customSheet.js. All take explicit data (no character closure):
// level, precomputed choice groups, choices map, feat list, and a
// bundle lookup. The renderer supplies character.rules + bundleFor.

export function selectedRuleOptionsIn(groups, choicesMap = {}) {
  return groups.flatMap((group) => {
    const selected = new Set(Array.isArray(choicesMap[group.key]) ? choicesMap[group.key] : []);
    return groupOptionsOf(group)
      .filter((option) => selected.has(option.id))
      .map((option) => ({ option, group }));
  });
}

export function selectedFeatBundlesIn(feats = [], rulesetId, bundleLookup) {
  return feats
    .map((entry) => {
      const name = entry?.name;
      if (!name) return null;
      const bundle = bundleLookup("Feat", name, rulesetId);
      return bundle ? { name, bundle } : null;
    })
    .filter(Boolean);
}

/** Choice groups carried by taken feats (e.g. Resilient's "pick the
 *  ability", Skilled's "pick three skills", Linguist's "pick three
 *  languages" — see js/data/featBundles.js). Surfaced through the
 *  same active-choice-groups path as dropdown bundles, so the Leveling
 *  guide's Choices step renders them and selectedRuleOptionsIn picks
 *  their statModifiers up. Keys are namespaced per feat
 *  (`feat:<name>:<groupId>`) so two feats with same-shaped groups
 *  never share picks. */
export function featChoiceGroupsFor(featBundles = []) {
  const groups = [];
  featBundles.forEach(({ name, bundle }) => {
    (bundle?.choiceGroups || []).forEach((group, index) => {
      if (!Array.isArray(group.options) || group.options.length === 0) return;
      groups.push({
        ...normalizeChoiceGroup(group, index, `feat:${name}`),
        source: name,
      });
    });
  });
  return groups;
}

export function dropdownBundleEntries(fields) {
  const entries = [];
  fields.forEach((field) => {
    if (field.fieldType !== "dropdown") return;
    const choice = (field.choices || []).find((c) => c.id === field.selected);
    const bundle = choice && choice.bundle;
    if (!bundle) return;
    entries.push({ field, choice, bundle });
  });
  return entries;
}

// Optional per-bundle level override for multiclassed characters:
// levelFor(field, choice, bundle) returns the class level that gates
// minLevel'd grants, or null/undefined for the uniform `level`.
// Dropdown bundles (race/class/subclass) resolve per class; feat
// bundles and feat-group picks always use the uniform level. Omitted
// (or returning null) reproduces the old single-class behavior
// exactly, so every existing caller passes nothing.
function effectiveLevel(levelFor, level, field, choice, bundle) {
  if (typeof levelFor !== "function") return level;
  const override = levelFor(field, choice, bundle);
  return Number.isFinite(override) ? override : level;
}

/** Finds the selected dropdown entry owning a choice-group key
 *  (`<fieldId>:<choiceId>[:<groupId>]`, or `feat:…` for feat groups
 *  which have no owning field). Returns null for feat groups. */
export function dropdownEntryForGroupKey(fields, key) {
  const fieldId = String(key || "").split(":")[0];
  const field = (fields || []).find((f) => f.id === fieldId && f.fieldType === "dropdown");
  if (!field) return null;
  const choice = (field.choices || []).find((c) => c.id === field.selected) || null;
  return { field, choice, bundle: (choice && choice.bundle) || null };
}

export function applyBundleModifiersIn(fields, valueMap, grantedCheckboxes, grantedTags, level, ruleOptions, featBundles, applyStatFn, levelFor = null, extraBundles = []) {
  dropdownBundleEntries(fields).forEach(({ field, choice, bundle }) => {
    applyStatFn(bundle.statModifiers, valueMap, grantedCheckboxes, grantedTags, effectiveLevel(levelFor, level, field, choice, bundle));
  });
  ruleOptions.forEach(({ option, group }) => {
    const entry = group ? dropdownEntryForGroupKey(fields, group.key) : null;
    const lvl = entry ? effectiveLevel(levelFor, level, entry.field, entry.choice, entry.bundle) : level;
    applyStatFn(option.statModifiers, valueMap, grantedCheckboxes, grantedTags, lvl);
  });
  featBundles.forEach(({ bundle }) => {
    applyStatFn(bundle.statModifiers, valueMap, grantedCheckboxes, grantedTags, level);
  });
  // Multiclass secondary class/subclass bundles (not on any dropdown)
  // arrive pre-resolved with their own class level.
  (extraBundles || []).forEach(({ bundle, level: extraLevel }) => {
    applyStatFn(bundle?.statModifiers, valueMap, grantedCheckboxes, grantedTags, Number.isFinite(extraLevel) ? extraLevel : level);
  });
}

export function collectGrantedFeaturesIn(fields, level, ruleOptions, featBundles, levelFor = null, extraBundles = [], includedPacks = null) {  const features = [];
  // Subclass grants without a sourced summary are omitted from
  // player-facing display until sourced (audit 2b); auto-spell
  // templates resolve to the currently-granted spells only.
  const pushGrant = (grant, lvl, source, bundle) => {
    if (grant.unsourced) return;
    if (String(grant.description || "").includes("{spells}")) {
      const parts = autoSpellParts(grant, bundle, lvl);
      features.push({ name: parts.name, description: parts.description, level: lvl, source });
      return;
    }
    features.push({
      name: grant.name,
      description: grant.description || "",
      level: lvl,
      source,
    });
  };
  dropdownBundleEntries(fields).forEach(({ field, choice, bundle }) => {
    const lvl = effectiveLevel(levelFor, level, field, choice, bundle);
    (bundle.featureGrants || []).forEach((grant) => {
      if (grant.minLevel && lvl < grant.minLevel) return; // not unlocked yet
      if (!packAllowsLocal(grant, includedPacks)) return; // optional source not included
      pushGrant(grant, Number.isFinite(grant.minLevel) ? grant.minLevel : 0, field.label, bundle);
    });
  });
  ruleOptions.forEach(({ option, group }) => {
    if (!packAllowsLocal(option, includedPacks)) return;
    (option.featureGrants || []).forEach((grant) => {
      if (!packAllowsLocal(grant, includedPacks)) return;
      pushGrant(grant, group.minLevel, option.name || group.label || group.source, null);
    });
  });
  featBundles.forEach(({ name, bundle }) => {
    (bundle.featureGrants || []).forEach((grant) => {
      pushGrant(grant, Number.isFinite(grant.minLevel) ? grant.minLevel : 0, name, bundle);
    });
  });
  (extraBundles || []).forEach(({ bundle, level: extraLevel, source }) => {
    const lvl = Number.isFinite(extraLevel) ? extraLevel : level;
    (bundle?.featureGrants || []).forEach((grant) => {
      if (grant.minLevel && lvl < grant.minLevel) return;
      if (!packAllowsLocal(grant, includedPacks)) return;
      pushGrant(grant, Number.isFinite(grant.minLevel) ? grant.minLevel : 0, source || "Multiclass", bundle);
    });
  });
  features.sort((a, b) => a.level - b.level || a.source.localeCompare(b.source));
  return features;
}

// --- Dropdown access + choice normalization -----------------------------------
//
// Migration of normalizeChoiceObjects / getAllowedChoiceIds /
// normalizeDropdownSelections from customSheet.js. The bundle-rule
// narrowing is pure; the subclass fallback takes resolved data so no
// ruleset lookup happens in here.

/** Migrates a dropdown's choices from the old plain-string shape to
 *  { id, text, bundle } objects and backfills missing `bundle`. Also
 *  remaps `.selected` from old text value to new id. Returns whether
 *  anything changed. */
export function normalizeChoiceObjectsIn(allFields, newIdFn) {
  let changed = false;
  allFields.forEach((field) => {
    if (field.fieldType !== "dropdown" || !Array.isArray(field.choices)) return;
    const hadStrings = field.choices.some((c) => typeof c === "string");
    if (hadStrings) {
      const oldSelectedText = field.selected;
      field.choices = field.choices.map((c) =>
        typeof c === "string" ? { id: newIdFn(), text: c, bundle: null } : c
      );
      if (oldSelectedText) {
        const match = field.choices.find((c) => c.text === oldSelectedText);
        field.selected = match ? match.id : null;
      }
      changed = true;
    } else {
      field.choices.forEach((c) => {
        if (c.bundle === undefined) { c.bundle = null; changed = true; }
      });
    }
  });
  return changed;
}

/** Which of `field`'s choices are selectable given every OTHER
 *  dropdown's bundle-driven access rules. Multiple restrictions
 *  intersect. Returns { allowed:Set, narrowed:boolean }. */
export function narrowChoicesByBundleAccess(field, allFields, level) {
  let allowed = new Set((field.choices || []).map((c) => c.id));
  let narrowed = false;
  allFields.forEach((other) => {
    if (other.fieldType !== "dropdown" || other === field) return;
    const choice = (other.choices || []).find((c) => c.id === other.selected);
    const bundle = choice && choice.bundle;
    if (!bundle) return;
    (bundle.dropdownAccess || []).forEach((rule) => {
      if (rule.targetFieldId !== field.id) return;
      if (rule.minLevel && level < rule.minLevel) return; // not unlocked yet
      const ruleSet = new Set(rule.allowedChoiceIds || []);
      allowed = new Set([...allowed].filter((id) => ruleSet.has(id)));
      narrowed = true;
    });
  });
  return { allowed, narrowed };
}

/** Fallback only: when no applied Class bundle narrowed the Subclass
 *  field via a real dropdownAccess rule, clip to the hardcoded
 *  ruleset subclass list instead. Skipped when `narrowed` is true so
 *  a full imported subclass list never gets clipped back down. */
export function applySubclassFallback(allowed, field, { className, classEntry, level }) {
  if (!classEntry || level == null) return allowed;
  const names = level >= classEntry.subclassLevel ? new Set(classEntry.subclasses) : new Set();
  return new Set([...allowed].filter((id) => {
    const choice = (field.choices || []).find((candidate) => candidate.id === id);
    return names.has(choice?.text);
  }));
}

export function isSubclassField(field) {
  return field.id === "subclass" || field.label === "Subclass";
}export function normalizeDropdownSelectionsIn(allFields, allowedFn) {
  let changed = false;
  allFields.forEach((field) => {
    if (field.fieldType !== "dropdown" || !field.selected) return;
    if (!allowedFn(field, allFields).has(field.selected)) {
      field.selected = null;
      changed = true;
    }
  });
  return changed;
}

// --- Resource grants ---------------------------------------------------------------
//
// Migration of collectResourceGrants from customSheet.js. A resource
// scaling with level is one entry per tier; candidates reduce to the
// single highest-minLevel tier per resource key. A grant's maximum is
// a flat integer, or a formula node evaluated against valueMap when
// maximumFormula is present.

export function resolveResourceMaximum(grant, valueMap, evaluateFn) {
  if (grant.maximumFormula) {
    const computed = evaluateFn(grant.maximumFormula, valueMap);
    return Number.isFinite(computed) ? Math.max(0, Math.round(computed)) : 0;
  }
  return Math.max(0, Number.parseInt(grant.maximum, 10) || 0);
}

export function dedupResourceTiers(candidates) {
  const byKey = new Map();
  candidates.forEach((candidate) => {
    const existing = byKey.get(candidate.key);
    if (!existing || candidate.minLevel >= existing.minLevel) byKey.set(candidate.key, candidate);
  });
  return [...byKey.values()];
}

export function collectResourceGrantsIn(fields, level, valueMap, ruleOptions, featBundles, evaluateFn, levelFor = null, extraBundles = []) {  const candidates = [];
  const add = (grant, keyBase, source, lvl) => {
    if (grant.minLevel && lvl < grant.minLevel) return;
    const maximum = resolveResourceMaximum(grant, valueMap, evaluateFn);
    if (!grant.name || maximum < 1) return;
    candidates.push({ key: `${keyBase}:${grant.name}`, name: grant.name, maximum, minLevel: grant.minLevel || 0, reset: grant.reset || "rest", source });
  };
  dropdownBundleEntries(fields).forEach(({ field, choice, bundle }) => {
    const lvl = effectiveLevel(levelFor, level, field, choice, bundle);
    (bundle?.resourceGrants || []).forEach((grant) => {
      add(grant, `${field.id}:${choice.id}:resource`, choice.text || field.label, lvl);
    });
  });
  ruleOptions.forEach(({ option, group }) => {
    const entry = group ? dropdownEntryForGroupKey(fields, group.key) : null;
    const lvl = entry ? effectiveLevel(levelFor, level, entry.field, entry.choice, entry.bundle) : level;
    (option.resourceGrants || []).forEach((grant) => {
      add(grant, `${group.key}:${option.id}:resource`, option.name || group.label || group.source, lvl);
    });
  });
  featBundles.forEach(({ name, bundle }) => {
    (bundle.resourceGrants || []).forEach((grant) => {
      add(grant, `feat:${name}:resource`, name, level);
    });
  });
  (extraBundles || []).forEach(({ bundle, level: extraLevel, source }) => {
    const lvl = Number.isFinite(extraLevel) ? extraLevel : level;
    (bundle?.resourceGrants || []).forEach((grant) => {
      add(grant, `multiclass:${source || "?"}:resource`, source || "Multiclass", lvl);
    });
  });
  return dedupResourceTiers(candidates);
}

// --- Granted list items (addItem applier) -------------------------------------------
//
// Migration target for the `addItem` statModifier op, which no renderer
// handled until now: subclass oath/domain/circle spells, feat-granted
// spells (Fey Touched, …), and racial spells (Tiefling Infernal Legacy)
// all declare `{ op: "addItem", targetFieldId: "spellsKnown", value:
// "<Spell Name>" }`. Unlike numeric/grant ops (applied every render
// into valueMap/checkbox/tag sets), list items are stored user data on
// a textlist field — so this only COLLECTS what's owed (deduped,
// minLevel-gated, in bundle order). customSheet.syncGrantedListItems
// appends whatever's missing at selection-commit time (dropdown pick,
// setup finish, level-up apply), which keeps granted spells
// user-editable afterward instead of re-asserted on every render.
export function collectListItemGrantsIn(fields, level, ruleOptions, featBundles, levelFor = null, extraBundles = []) {
  const grants = new Map(); // fieldId -> string[] (deduped, first-seen order)
  const add = (mods, lvl) => {
    (mods || []).forEach((mod) => {
      if (!mod || mod.op !== "addItem" || !mod.targetFieldId) return;
      if (mod.minLevel && lvl < mod.minLevel) return;
      const value = String(mod.value ?? "").trim();
      if (!value) return;
      if (!grants.has(mod.targetFieldId)) grants.set(mod.targetFieldId, []);
      const list = grants.get(mod.targetFieldId);
      if (!list.includes(value)) list.push(value);
    });
  };
  dropdownBundleEntries(fields).forEach(({ field, choice, bundle }) => {
    add(bundle && bundle.statModifiers, effectiveLevel(levelFor, level, field, choice, bundle));
  });
  (ruleOptions || []).forEach(({ option, group }) => {
    const entry = group ? dropdownEntryForGroupKey(fields, group.key) : null;
    add(option && option.statModifiers, entry ? effectiveLevel(levelFor, level, entry.field, entry.choice, entry.bundle) : level);
  });
  (featBundles || []).forEach(({ bundle }) => add(bundle && bundle.statModifiers, level));
  (extraBundles || []).forEach(({ bundle, level: extraLevel }) => {
    add(bundle && bundle.statModifiers, Number.isFinite(extraLevel) ? extraLevel : level);
  });
  return [...grants.entries()].map(([fieldId, items]) => ({ fieldId, items }));
}

// --- Leveling tab DOM -----------------------------------------------------------------
//
// Migration of renderResourceTrackers / renderLevelUpRow /
// renderLevelingTab from customSheet.js. Pure data helpers plus
// explicit-deps renderers:
//
//   renderResourceTrackersInto(resources, rules, {normalizeFn, saveFn})
//   renderLevelUpRowInto(level, isCurrent, data, fieldDefs, {expandedSet, toggleFn, inputFn})
//   renderLevelingTabInto(pageGrid, {guideEl, resourcesEl, currentLevel,
//     expandedSet, gridFn, rowFn, scrollFn})

export function clampResourceSaved(maximum, savedRaw) {
  const saved = Number.parseInt(savedRaw, 10);
  return String(Number.isFinite(saved) ? Math.min(maximum, Math.max(0, saved)) : maximum);
}

export function ensureLevelData(levelUps, level) {
  const key = String(level);
  if (!levelUps[key] || typeof levelUps[key] !== "object") {
    levelUps[key] = {};
  }
  return levelUps[key];
}

export function filledLevelFieldCount(data, fieldDefs) {
  return fieldDefs.filter((f) => (data[f.key] || "").trim() !== "").length;
}

/** Whether a resource with the given reset text restores on a rest of
 *  `kind` ("short" or "long"). Short rests restore short-rest
 *  resources (including "short or long rest"); long rests restore
 *  everything, including bare "rest" entries (grants that name no
 *  specific rest type). Pure — unit-tested in smoke-imports. */
export function restoresOnRest(reset, kind) {
  if (kind === "long") return true;
  return /short/i.test(reset || "");
}

export function renderResourceTrackersInto(resources, rules, deps) {
  const { normalizeFn, saveFn, restFn } = deps;
  if (resources.length === 0) return null;
  normalizeFn();
  const section = document.createElement("section");
  section.className = "rule-resources";
  const title = document.createElement("h2");
  title.textContent = "Feature Uses";
  section.append(title);
  if (typeof restFn === "function") {
    const restRow = document.createElement("div");
    restRow.className = "rule-resources__row rule-resources__row--rest";
    const shortBtn = document.createElement("button");
    shortBtn.type = "button";
    shortBtn.className = "btn formula-toolbar__btn";
    shortBtn.textContent = "Short Rest";
    shortBtn.title = "Restore short-rest feature uses (and Warlock pact slots). Other spell slots reset on a long rest.";
    shortBtn.addEventListener("click", () => restFn("short"));
    const longBtn = document.createElement("button");
    longBtn.type = "button";
    longBtn.className = "btn formula-toolbar__btn";
    longBtn.textContent = "Long Rest";
    longBtn.title = "Restore all feature uses and spell slots, and heal to full HP.";
    longBtn.addEventListener("click", () => restFn("long"));
    restRow.append(shortBtn, longBtn);
    section.append(restRow);
  }
  resources.forEach((resource) => {
    const row = document.createElement("div");
    row.className = "rule-resources__row";
    const label = document.createElement("span");
    label.className = "rule-resources__name";
    label.textContent = resource.name;
    const reset = document.createElement("span");
    reset.className = "rule-resources__reset";
    reset.textContent = `Resets: ${resource.reset}`;
    const value = document.createElement("input");
    value.type = "number";
    value.min = "0";
    value.max = String(resource.maximum);
    value.className = "rule-resources__value";
    value.value = clampResourceSaved(resource.maximum, rules.resourceUses[resource.key]);
    value.addEventListener("change", () => {
      rules.resourceUses[resource.key] = Math.min(resource.maximum, Math.max(0, Number.parseInt(value.value, 10) || 0));
      value.value = String(rules.resourceUses[resource.key]);
      saveFn(rules);
    });
    const maximum = document.createElement("span");
    maximum.className = "rule-resources__maximum";
    maximum.textContent = `/ ${resource.maximum}`;
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "btn formula-toolbar__btn";
    restore.textContent = "Restore";
    restore.addEventListener("click", () => {
      rules.resourceUses[resource.key] = resource.maximum;
      value.value = String(resource.maximum);
      saveFn(rules);
    });
    row.append(label, reset, value, maximum, restore);
    section.append(row);
  });
  return section;
}

export function renderLevelUpRowInto(level, isCurrent, data, fieldDefs, deps) {
  const { expandedSet, toggleFn, inputFn } = deps;
  const row = document.createElement("div");
  row.className = "leveling-row" + (isCurrent ? " leveling-row--current" : "");
  row.dataset.level = String(level);

  const header = document.createElement("div");
  header.className = "leveling-row__header";

  const expanded = expandedSet.has(level);
  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "btn formula-toolbar__btn leveling-row__toggle";
  toggleBtn.textContent = expanded ? "▾" : "▸";
  toggleBtn.setAttribute("aria-label", expanded ? `Collapse level ${level}` : `Expand level ${level}`);
  toggleBtn.addEventListener("click", () => {
    toggleFn(level, expanded);
  });
  header.append(toggleBtn);

  const title = document.createElement("span");
  title.className = "leveling-row__title";
  title.textContent = `Level ${level}`;
  header.append(title);

  const filledCount = filledLevelFieldCount(data, fieldDefs);
  const summary = document.createElement("span");
  summary.className = "leveling-row__summary";
  summary.textContent = filledCount > 0 ? `${filledCount} filled in` : "Nothing yet";
  header.append(summary);

  row.append(header);

  if (expanded) {
    const fields = document.createElement("div");
    fields.className = "leveling-row__fields";
    fieldDefs.forEach((f) => {
      const group = document.createElement("div");
      group.className = "leveling-row__field";
      const label = document.createElement("label");
      label.textContent = f.label;
      const textarea = document.createElement("textarea");
      textarea.value = data[f.key] || "";
      textarea.placeholder = f.placeholder || "";
      textarea.addEventListener("input", () => {
        inputFn(data, f.key, textarea.value);
      });
      group.append(label, textarea);
      fields.append(group);
    });
    row.append(fields);
  }

  return row;
}

/** The "at a glance" panel: a straight read of the unified grant model
 *  (js/render/sheet/levelingModel.js), grouped by the level each thing
 *  unlocks at. No interaction on purpose - this is the answer to "what
 *  does my character have, and when", and the walkthrough next door is
 *  where you act on it.
 *
 *  Built from `steps` (levelingStepsIn output) rather than re-deriving
 *  anything, so both sub-tabs read the same model and can't disagree. */
export function renderLevelingGlanceInto(steps, { currentLevel = 1 } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "leveling-glance";
  if (!steps.length) {
    const note = document.createElement("p");
    note.className = "leveling-tab__intro";
    note.textContent = currentLevel > 1
      ? "Nothing in your class data is gated behind a level yet — everything you've earned is already on your sheet."
      : "Nothing ahead of level 1 yet. Pick a class and this fills in with what each level gives you.";
    wrap.append(note);
    return wrap;
  }
  steps.forEach((step) => {
    const section = document.createElement("section");
    section.className = "leveling-glance__level";
    const heading = document.createElement("h3");
    heading.textContent = `Level ${step.level}`;
    section.append(heading);
    const list = document.createElement("ul");
    list.className = "leveling-glance__list";
    for (const grant of step.grants) {
      const item = document.createElement("li");
      item.className = "leveling-glance__item";
      item.dataset.type = grant.type;
      item.dataset.grantId = grant.id;
      const name = grant.effect?.name
        || grant.effect?.label
        || grant.effect?.targetFieldId
        || grant.type;
      item.append(Object.assign(document.createElement("span"), {
        className: "leveling-glance__name",
        textContent: String(name),
      }));
      const from = document.createElement("span");
      from.className = "leveling-glance__from";
      from.textContent = grant.source ? ` (${grant.source})` : "";
      item.append(from);
      list.append(item);
    }
    section.append(list);
    wrap.append(section);
  });
  return wrap;
}

/** The two sub-tabs the spec asks for, and the switcher between them.
 *
 *  "At a glance" is a straight read of the grant model ordered by level;
 *  "Walkthrough" is the step-by-step UI over the same model. Both are
 *  built up-front and only one is shown, because a walkthrough with
 *  20 collapsed level rows and a glance table would otherwise both be in
 *  the document and the tab would be mostly empty space.
 *
 *  Defaults to the walkthrough, not the glance: the walkthrough is the
 *  part people act on, and the Leveling tab already IS the walkthrough,
 *  so defaulting the other way would hide the main tool behind a tab
 *  click. The glance is one click away.
 */
export function renderLevelingSubTabsInto(deps) {
  const { glanceEl, walkthroughEl, currentLevel = 1, initial = "walkthrough" } = deps;
  const wrap = document.createElement("div");
  wrap.className = "leveling-subtabs";
  const bar = document.createElement("div");
  bar.className = "leveling-subtabs__bar";
  bar.setAttribute("role", "tablist");

  const panels = { glance: glanceEl, walkthrough: walkthroughEl };
  const buttons = {};
  for (const [id, label, hint] of [
    ["glance", "At a Glance", "What your character has, and at which level"],
    ["walkthrough", "Walkthrough", "Step through each level and make your picks"],
  ]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "leveling-subtabs__tab";
    btn.textContent = label;
    btn.title = hint;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(id === initial));
    btn.addEventListener("click", () => {
      for (const [otherId, otherBtn] of Object.entries(buttons)) {
        const on = otherId === id;
        otherBtn.setAttribute("aria-selected", String(on));
        otherBtn.classList.toggle("is-active", on);
      }
      for (const [otherId, panel] of Object.entries(panels)) {
        if (panel) panel.hidden = otherId !== id;
      }
    });
    buttons[id] = btn;
    bar.append(btn);
  }
  wrap.append(bar);
  for (const [id, panel] of Object.entries(panels)) {
    if (!panel) continue;
    panel.classList.add("leveling-subtabs__panel");
    panel.hidden = id !== initial;
    wrap.append(panel);
  }
  // Set the initial visual state through the same path the click uses, so
  // the classes and aria can't disagree with what's actually shown.
  buttons[initial].classList.add("is-active");
  return wrap;
}

export function renderLevelingTabInto(pageGrid, deps) {
  const { guideEl, resourcesEl, currentLevel, expandedSet, gridFn, rowFn, scrollFn, emptyGuideNote = null, glanceEl = null, gapBanner = null, revertEl = null } = deps;
  const wrap = document.createElement("div");
  wrap.className = "leveling-tab";

  const intro = document.createElement("p");
  intro.className = "leveling-tab__intro";
  intro.textContent = "When your character goes up a level, press the Level Up button up top. It moves you to the next level and walks you through what you gain, one step at a time. If you'd rather set the Level field yourself, that's fine too — everything still fills in here.";
  wrap.append(intro);

  // A level typed straight in skips the levels in between, and the old
  // walkthrough only ever offered the level on the sheet — so those levels
  // were never walked through and nothing said so. Said out loud here,
  // with the walkthrough taking the lowest outstanding level first.
  if (gapBanner?.text) {
    const banner = document.createElement("p");
    banner.className = "leveling-tab__gap";
    banner.setAttribute("role", "status");
    banner.textContent = gapBanner.text;
    if (gapBanner.progressLabel) {
      const progress = document.createElement("span");
      progress.className = "leveling-tab__gap-progress";
      progress.textContent = gapBanner.progressLabel;
      banner.append(progress);
    }
    wrap.append(banner);
  }

  // Everything the walkthrough shows (guide, feature uses, the per-level
  // rows) goes in one panel; the at-a-glance read of the grant model goes
  // in the other. Both are built now, one is shown.
  const walkthrough = document.createElement("div");
  walkthrough.className = "leveling-tab__walkthrough";
  if (guideEl) walkthrough.append(guideEl);
  else if (emptyGuideNote) {
    const note = document.createElement("p");
    note.className = "leveling-tab__intro leveling-tab__empty-guide";
    note.textContent = emptyGuideNote;
    walkthrough.append(note);
  }
  if (resourcesEl) walkthrough.append(resourcesEl);

  if (currentLevel) {
    const jumpBtn = document.createElement("button");
    jumpBtn.type = "button";
    jumpBtn.className = "btn leveling-tab__jump";
    jumpBtn.textContent = `↓ Jump to Level ${currentLevel}`;
    jumpBtn.addEventListener("click", () => {
      expandedSet.add(currentLevel);
      gridFn();
      scrollFn(currentLevel);
    });
    walkthrough.append(jumpBtn);
  }

  // Reverting belongs to the walkthrough, not the glance: it acts on the
  // recorded walkthrough of a level, which is the thing this panel is.
  if (revertEl) walkthrough.append(revertEl);

  for (let level = 1; level <= LEVEL_CAP; level++) {
    walkthrough.append(rowFn(level, level === currentLevel));
  }

  // Only offer the switcher when there's a glance view to switch to —
  // a one-tab "tab list" is just a label.
  if (glanceEl) {
    wrap.append(renderLevelingSubTabsInto({ glanceEl, walkthroughEl: walkthrough, currentLevel }));
  } else {
    wrap.append(walkthrough);
  }

  pageGrid.append(wrap);
}

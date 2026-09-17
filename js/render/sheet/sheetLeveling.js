// sheetLeveling.js
//
// Pure leveling/bundle math extracted from customSheet.js.
// All functions take explicit args (no character closure) so they are
// testable; customSheet.js thin-wraps them with its own state.

export function levelFromMap(levelFieldId, valueMap) {
  if (!levelFieldId) return Infinity;
  const v = valueMap[levelFieldId];
  return Number.isFinite(v) ? v : 0;
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

export function activeChoiceGroupsFor(fields, level, levelFor = null, extraBundles = []) {
  const groups = [];
  fields.forEach((field) => {
    if (field.fieldType !== "dropdown") return;
    const choice = (field.choices || []).find((candidate) => candidate.id === field.selected);
    const bundle = choice?.bundle;
    const lvl = effectiveLevel(levelFor, level, field, choice, bundle);
    (bundle?.choiceGroups || []).forEach((group, index) => {
      if (group.minLevel && lvl < group.minLevel) return;
      if (!Array.isArray(group.options) || group.options.length === 0) return;
      groups.push({
        ...normalizeChoiceGroup(group, index, `${field.id}:${choice.id}`),
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
      if (!Array.isArray(group.options) || group.options.length === 0) return;
      groups.push({
        ...normalizeChoiceGroup(group, index, `multiclass:${source || "class"}`),
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
    return group.options
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

export function collectGrantedFeaturesIn(fields, level, ruleOptions, featBundles, levelFor = null, extraBundles = []) {  const features = [];
  dropdownBundleEntries(fields).forEach(({ field, choice, bundle }) => {
    const lvl = effectiveLevel(levelFor, level, field, choice, bundle);
    (bundle.featureGrants || []).forEach((grant) => {
      if (grant.minLevel && lvl < grant.minLevel) return; // not unlocked yet
      features.push({
        name: grant.name,
        description: grant.description || "",
        level: Number.isFinite(grant.minLevel) ? grant.minLevel : 0,
        source: field.label,
      });
    });
  });
  ruleOptions.forEach(({ option, group }) => {
    (option.featureGrants || []).forEach((grant) => {
      features.push({
        name: grant.name,
        description: grant.description || "",
        level: group.minLevel,
        source: option.name || group.label || group.source,
      });
    });
  });
  featBundles.forEach(({ name, bundle }) => {
    (bundle.featureGrants || []).forEach((grant) => {
      features.push({
        name: grant.name,
        description: grant.description || "",
        level: Number.isFinite(grant.minLevel) ? grant.minLevel : 0,
        source: name,
      });
    });
  });
  (extraBundles || []).forEach(({ bundle, level: extraLevel, source }) => {
    const lvl = Number.isFinite(extraLevel) ? extraLevel : level;
    (bundle?.featureGrants || []).forEach((grant) => {
      if (grant.minLevel && lvl < grant.minLevel) return;
      features.push({
        name: grant.name,
        description: grant.description || "",
        level: Number.isFinite(grant.minLevel) ? grant.minLevel : 0,
        source: source || "Multiclass",
      });
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

export function collectResourceGrantsIn(fields, level, valueMap, ruleOptions, featBundles, evaluateFn, levelFor = null) {  const candidates = [];
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

export function renderLevelingTabInto(pageGrid, deps) {
  const { guideEl, resourcesEl, currentLevel, expandedSet, gridFn, rowFn, scrollFn } = deps;
  const wrap = document.createElement("div");
  wrap.className = "leveling-tab";

  const intro = document.createElement("p");
  intro.className = "leveling-tab__intro";
  intro.textContent = "Come back here whenever your level goes up. Fill in whatever applies for your class at that level — leave the rest blank.";
  wrap.append(intro);

  if (guideEl) wrap.append(guideEl);
  if (resourcesEl) wrap.append(resourcesEl);

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
    wrap.append(jumpBtn);
  }

  for (let level = 1; level <= 20; level++) {
    wrap.append(rowFn(level, level === currentLevel));
  }

  pageGrid.append(wrap);
}

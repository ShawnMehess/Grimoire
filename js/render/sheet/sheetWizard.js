// sheetWizard.js
//
// Pure wizard helpers extracted from customSheet.js.
// DOM rendering stays in customSheet.js for now; all list math,
// step navigation, and spell-catalog lookups live here testably.

import { briefDescription } from "./sheetMechanics.js";

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
  return [
    bundleLookup("Race", state.species, state.rulesetId),
    bundleLookup("Class", state.className, state.rulesetId),
    bundleLookup("Subclass", state.subclass, state.rulesetId),
    bundleLookup("Background", state.background, state.rulesetId),
  ].filter(Boolean);
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
  const groupOptions = (group) => [
    ...(group.options || []),
    ...((group.categories || []).flatMap((c) => c.options || [])),
  ];
  otherGroups.forEach((group) => {
    if (group.key === excludeGroupKey) return;
    const picks = choicesByKey[group.key] || [];
    groupOptions(group).forEach((option) => {
      if (!picks.includes(option.id)) return;
      collect(option.statModifiers);
    });
  });
  return owned;
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

/** Whether a choice group is satisfied: non-locked picks cover
 *  minSelections minus options that would grant something already
 *  owned (those don't need picking). Flat and cross-category shapes. */
export function groupPicksSatisfied(group, selectedIds = [], owned = new Set()) {
  if (!group) return true;
  const locked = new Set(group.lockedOptionIds || []);
  const allOptions = [
    ...(group.options || []),
    ...((group.categories || []).flatMap((c) => c.options || [])),
  ];
  const freebies = allOptions.filter((o) => !locked.has(o.id) && optionIsOwned(o, owned)).length;
  const counted = (selectedIds || []).filter((id) => !locked.has(id)).length;
  return counted >= Math.max(0, (group.minSelections || 0) - freebies);
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
      mechanics: spellMechanicsLine(e),
    }))
    .filter((e) => e.name);
  if (!className) return entries;
  const norm = (s) => (s || "").toLowerCase();
  return entries.filter((e) => !e.classes || norm(e.classes).includes(norm(className)));
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
  return { meta: bits.join(" · "), effect: briefDescription(fv.effect, 160) };
}

/** Review-tab lines for choice groups with picks: "Label: A, B".
 *  Groups with no picks are skipped; works for flat and
 *  cross-category option shapes. */
export function reviewChoiceLinesFor(groups = [], choicesStore = {}) {
  const lines = [];
  for (const group of groups) {
    const picks = choicesStore[group.key] || [];
    if (!picks.length) continue;
    const allOptions = [
      ...((group.options || [])),
      ...((group.categories || []).flatMap((c) => c.options || [])),
    ];
    const names = picks.map((id) => allOptions.find((o) => o.id === id)?.name || id).filter(Boolean);
    if (!names.length) continue;
    lines.push(`${group.label || group.source || "Choice"}: ${names.join(", ")}`);
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
// `stepState` is a small {index} object the caller keeps so the step
// survives full re-renders.
//
//   renderStepWizardInto(steps, stepState, {title, intro}, gridFn)

export function applicableStepsOf(steps) {
  return steps.filter((step) => isStepApplicable(step));
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

export function renderStepWizardInto(steps, stepState, { title, intro } = {}, gridFn) {
  const applicableSteps = applicableStepsOf(steps);
  if (applicableSteps.length === 0) return null;
  stepState.index = clampStepIndex(applicableSteps.length, stepState.index);

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
      dot.className = "wizard__dot wizard__dot--disabled";
      dot.disabled = true;
      if (step.unavailableMessage) dot.title = step.unavailableMessage();
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
      dot.title = "Finish the current page first — it still needs decisions.";
      dots.append(dot);
      return;
    }
    dot.addEventListener("click", () => { stepState.index = i; gridFn(); });
    dots.append(dot);
  });
  wrap.append(dots);

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
      back.addEventListener("click", () => { stepState.index -= 1; gridFn(); });
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
      forward.addEventListener("click", () => { stepState.index += 1; gridFn(); });
      nav.append(forward);
    }
    return nav;
  };

  wrap.append(buildNav("wizard__nav--top"));

  const body = document.createElement("div");
  body.className = "wizard__body level-guide__form";
  wrap.append(body);
  currentStep.render(body);

  wrap.append(buildNav());

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

/** Bundle-library class/race/background names tagged to a ruleset —
 *  falls back to the hardcoded list (Class only) when nothing is
 *  imported yet. */
export function rulesetOptionNamesIn(libraryCache, rulesetId, category, fallback = []) {
  const fromBundles = libraryCache
    .filter((entry) => entry.rulesetId === rulesetId && entry.category === category)
    .map((entry) => entry.name);
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

export function capMessage(levelNum, limit) {
  const cap = levelNum === 0 ? limit.cantrips : limit.spells;
  return levelNum === 0
    ? `You already know your ${cap} cantrip${cap === 1 ? "" : "s"} for this level — uncheck one first to swap it.`
    : `You've already ${limit.style === "known" ? "learned" : "prepared"} your ${cap} spell${cap === 1 ? "" : "s"} for this level — uncheck one first to swap it.`;
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

  let anySpellsListed = false;
  availableLevels.forEach((levelNum) => {
    const spells = spellsForLevelFn(levelNum, className);
    if (!spells.length) return;
    anySpellsListed = true;
    const heading = document.createElement("p");
    heading.className = "wizard__section-label";
    heading.textContent = levelNum === 0 ? "Cantrips" : `${ordinal(levelNum)}-Level Spells`;
    container.append(heading);
    multiRowsFn(container, spells.map((s) => s.name), {
      selectedSet: known,
      getInfo: (name) => spells.find((s) => s.name === name),
      onToggle: (name) => {
        if (!Array.isArray(field.items)) field.items = [];
        if (known.has(name)) {
          field.items = field.items.filter((item) => item !== name);
          known.delete(name);
        } else {
          const { cantrips, spells: spellCount } = spellCountByLevel(known, levelByNameFn);
          if (!canLearnMore(levelNum, limit, cantrips, spellCount)) {
            const anchor = container.querySelector(`[data-name="${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`);
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
  updateLimitNote();
  if (!anySpellsListed) {
    const note = document.createElement("p");
    note.className = "leveling-tab__intro";
    note.textContent = "No spells found in an imported Spell List catalog yet — import one from the Catalog Libraries manager, or just track spells directly on the sheet's Spells Known list.";
    container.append(note);
  }
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

/** Look up a Bundle Library entry by category+name+ruleset, falling
 *  back to the sheet's own starter field (baked-in bundles live on
 *  the dropdown's choice, not in any library). `starterLookup`
 *  maps a category to its starter dropdown field (or null). */
export function bundleForIn(category, name, rulesetId, libraryCache = [], starterLookup = () => null) {
  if (!name) return null;
  const norm = (s) => (s || "").trim().toLowerCase();
  const fromLibrary = libraryCache.find((entry) => entry.rulesetId === rulesetId
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

export function renderSelectableRowsInto(container, names, { selectedName, onSelect, getInfo, getMechanics, getMechanicsList, afterRow, nested = false, collapsible = false } = {}) {
  const list = document.createElement("div");
  list.className = "choice-row-list" + (nested ? " choice-row-list--nested" : "");
  if (collapsible && names.length) {
    const controls = document.createElement("div");
    controls.className = "choice-row-list__collapse-controls";
    const expandAll = document.createElement("button");
    expandAll.type = "button";
    expandAll.className = "btn";
    expandAll.textContent = "Expand All";
    const collapseAll = document.createElement("button");
    collapseAll.type = "button";
    collapseAll.className = "btn";
    collapseAll.textContent = "Collapse All";
    expandAll.addEventListener("click", () => {
      list.querySelectorAll(".choice-row__details").forEach((d) => { d.hidden = false; });
      list.querySelectorAll(".choice-row__expander").forEach((b) => { b.textContent = "▾ Details"; b.setAttribute("aria-expanded", "true"); });
    });
    collapseAll.addEventListener("click", () => {
      list.querySelectorAll(".choice-row__details").forEach((d) => { d.hidden = true; });
      list.querySelectorAll(".choice-row__expander").forEach((b) => { b.textContent = "▸ Details"; b.setAttribute("aria-expanded", "false"); });
    });
    controls.append(expandAll, collapseAll);
    container.append(controls);
  }
  names.forEach((name) => {
    const info = getInfo ? getInfo(name) : null;
    const selected = name === selectedName;
    const row = document.createElement("div");
    row.className = "choice-row" + (nested ? " choice-row--nested" : "") + (selected ? " choice-row--selected" : "");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-pressed", String(selected));
    row.addEventListener("click", () => onSelect(name));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(name); }
    });
    const portrait = document.createElement("div");
    portrait.className = "choice-row__portrait";
    if (info?.imageData) {
      const img = document.createElement("img");
      img.src = info.imageData;
      img.alt = "";
      portrait.append(img);
    } else {
      portrait.textContent = (name || "?").charAt(0).toUpperCase();
    }
    row.append(portrait);
    const body = document.createElement("div");
    body.className = "choice-row__body";
    const label = document.createElement("div");
    label.className = "choice-row__label";
    label.textContent = name;
    body.append(label);
    const desc = document.createElement("div");
    desc.className = "choice-row__description";
    desc.textContent = info?.description || "No description available yet.";
    body.append(desc);
    const details = document.createElement("div");
    details.className = "choice-row__details";
    let hasDetails = false;
    if (getMechanicsList) {
      const sections = getMechanicsList(name) || [];
      for (const section of sections) {
        if (!section?.items?.length) continue;
        hasDetails = true;
        const heading = document.createElement("div");
        heading.className = "choice-row__mechanics-title";
        heading.textContent = section.title;
        details.append(heading);
        const ul = document.createElement("ul");
        ul.className = "choice-row__mechanics-list";
        for (const item of section.items) {
          const li = document.createElement("li");
          li.textContent = item;
          ul.append(li);
        }
        details.append(ul);
      }
    } else if (getMechanics) {
      const mechanics = document.createElement("div");
      mechanics.className = "choice-row__mechanics";
      mechanics.textContent = getMechanics(name) || "No mechanical data linked yet.";
      details.append(mechanics);
      hasDetails = true;
    }
    if (hasDetails) {
      if (collapsible) {
        details.hidden = true;
        const expander = document.createElement("button");
        expander.type = "button";
        expander.className = "btn choice-row__expander";
        expander.textContent = "▸ Details";
        expander.setAttribute("aria-expanded", "false");
        expander.addEventListener("click", (e) => {
          e.stopPropagation();
          details.hidden = !details.hidden;
          expander.textContent = details.hidden ? "▸ Details" : "▾ Details";
          expander.setAttribute("aria-expanded", String(!details.hidden));
        });
        expander.addEventListener("keydown", (e) => e.stopPropagation());
        body.append(expander);
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

/** Multi-select sibling of renderSelectableRows — same row/portrait/
 *  description look (shares its CSS classes), but toggles membership
 *  in a Set instead of picking one name, for pickers like "which
 *  spells do you know" where more than one can be checked at once.
 *  Rows carry data-name so callers (spell-cap tooltip) can anchor
 *  feedback to the clicked row; getInfo may additionally return
 *  `mechanics` ({ meta, effect }) rendered as mechanical lines under
 *  the flavor description. */
export function renderMultiSelectableRowsInto(container, names, { selectedSet, onToggle, getInfo } = {}) {
  const list = document.createElement("div");
  list.className = "choice-row-list";
  names.forEach((name) => {
    const info = getInfo ? getInfo(name) : null;
    const selected = selectedSet.has(name);
    const row = document.createElement("div");
    row.className = "choice-row" + (selected ? " choice-row--selected" : "");
    row.dataset.name = name;
    row.tabIndex = 0;
    row.setAttribute("role", "checkbox");
    row.setAttribute("aria-checked", String(selected));
    row.addEventListener("click", () => onToggle(name));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(name); }
    });
    const portrait = document.createElement("div");
    portrait.className = "choice-row__portrait";
    portrait.textContent = selected ? "✓" : (name || "?").charAt(0).toUpperCase();
    row.append(portrait);
    const body = document.createElement("div");
    body.className = "choice-row__body";
    const label = document.createElement("div");
    label.className = "choice-row__label";
    label.textContent = name;
    body.append(label);
    const desc = document.createElement("div");
    desc.className = "choice-row__description";
    desc.textContent = info?.description || "No description available yet.";
    body.append(desc);
    if (info?.mechanics && (info.mechanics.meta || info.mechanics.effect)) {
      if (info.mechanics.meta) {
        const meta = document.createElement("div");
        meta.className = "choice-row__mechanics-meta";
        meta.textContent = info.mechanics.meta;
        body.append(meta);
      }
      if (info.mechanics.effect) {
        const effect = document.createElement("div");
        effect.className = "choice-row__mechanics-effect";
        effect.textContent = info.mechanics.effect;
        body.append(effect);
      }
    }
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

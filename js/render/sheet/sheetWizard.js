// sheetWizard.js
//
// Pure wizard helpers extracted from customSheet.js.
// DOM rendering stays in customSheet.js for now; all list math,
// step navigation, and spell-catalog lookups live here testably.

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
  fixedBundles.forEach((bundle) => {
    (bundle?.statModifiers || []).forEach((mod) => {
      if (mod.op === "grant") owned.add(mod.targetFieldId);
    });
  });
  otherGroups.forEach((group) => {
    if (group.key === excludeGroupKey) return;
    const picks = choicesByKey[group.key] || [];
    group.options.forEach((option) => {
      if (!picks.includes(option.id)) return;
      (option.statModifiers || []).forEach((mod) => {
        if (mod.op === "grant") owned.add(mod.targetFieldId);
      });
    });
  });
  return owned;
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
    .map((e) => ({ name: e.name, description: e.description || "", classes: (e.fieldValues?.classes || "").trim() }))
    .filter((e) => e.name);
  if (!className) return entries;
  const norm = (s) => (s || "").toLowerCase();
  return entries.filter((e) => !e.classes || norm(e.classes).includes(norm(className)));
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

  const dots = document.createElement("div");
  dots.className = "wizard__dots";
  // Every step gets a dot, even ones that don't currently apply —
  // those render disabled with a tooltip explaining why, rather than
  // disappearing outright, so the wizard's shape doesn't shift around
  // as earlier answers change. Next/Back still only walk
  // applicableSteps, so an inapplicable step is skipped automatically.
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
    dot.className = "wizard__dot"
      + (i === stepState.index ? " wizard__dot--active" : "")
      + (i < stepState.index ? " wizard__dot--done" : "");
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
      forward.className = "btn btn--primary";
      forward.textContent = "Next →";
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
            limitNote.textContent = capMessage(levelNum, limit);
            limitNote.classList.add("level-guide__feedback--error");
            return;
          }
          appendUniqueFn(field, name);
          known.add(name);
        }
        limitNote.classList.remove("level-guide__feedback--error");
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

export function renderSelectableRowsInto(container, names, { selectedName, onSelect, getInfo, getMechanics, afterRow, nested = false } = {}) {
  const list = document.createElement("div");
  list.className = "choice-row-list" + (nested ? " choice-row-list--nested" : "");
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
    if (getMechanics) {
      const mechanics = document.createElement("div");
      mechanics.className = "choice-row__mechanics";
      mechanics.textContent = getMechanics(name) || "No mechanical data linked yet.";
      body.append(mechanics);
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
 *  spells do you know" where more than one can be checked at once. */
export function renderMultiSelectableRowsInto(container, names, { selectedSet, onToggle, getInfo } = {}) {
  const list = document.createElement("div");
  list.className = "choice-row-list";
  names.forEach((name) => {
    const info = getInfo ? getInfo(name) : null;
    const selected = selectedSet.has(name);
    const row = document.createElement("div");
    row.className = "choice-row" + (selected ? " choice-row--selected" : "");
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
    row.append(body);
    list.append(row);
  });
  container.append(list);
  return list;
}

/** Shared renderer for a choiceGroups list's checkboxes/radios.
 *  Enforces maxSelections and shows already-owned proficiencies as
 *  picked-and-locked. Re-renders itself after every change. */
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
    const selected = choicesStore[group.key];
    const owned = ownedResolver ? ownedResolver(group.key) : new Set();
    const choiceGroup = document.createElement("fieldset");
    choiceGroup.className = "level-guide__choices";
    const legend = document.createElement("legend");
    const count = group.minSelections === group.maxSelections
      ? `Choose ${group.maxSelections}`
      : `Choose up to ${group.maxSelections}`;
    legend.textContent = `${group.label || "Choose an option"} (${count} — ${selected.length}/${group.maxSelections} picked)`;
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
  const atMax = selected.length >= group.maxSelections;
  group.options.forEach((option) => {
    const optionLabel = document.createElement("label");
    optionLabel.className = "level-guide__choice-option";
    const alreadyOwned = (option.statModifiers || []).some((mod) => mod.op === "grant" && owned.has(mod.targetFieldId));
    const input = document.createElement("input");
    input.type = group.maxSelections === 1 ? "radio" : "checkbox";
    input.name = `${namePrefix}-${group.key}`;
    input.value = option.id;
    const isChecked = selected.includes(option.id);
    input.checked = isChecked || alreadyOwned;
    if (alreadyOwned) {
      input.disabled = true;
      optionLabel.classList.add("level-guide__choice-option--granted");
      optionLabel.title = "Already have this from another selection — pick something else instead";
    } else if (input.type === "checkbox" && atMax && !isChecked) {
      input.disabled = true;
    }
    input.addEventListener("change", () => {
      if (input.type === "radio") {
        choicesStore[group.key] = input.checked ? [option.id] : [];
      } else if (input.checked) {
        // Guards a full group even if disabling the input above
        // hasn't taken effect yet (e.g. two change events racing).
        if (selected.length >= group.maxSelections) { input.checked = false; return; }
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

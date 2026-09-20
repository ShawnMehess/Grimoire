// sheetWizardSteps.js
//
// Character-creation wizard step renderers migrated from
// customSheet.js's renderRulesTab. Each step takes explicit deps (no
// sheet closure); the tab shell keeps `state`/`update`/`field` and
// passes them in.

import { commonPreviewBits, mechanicsPreviewFor } from "./sheetMechanics.js";

export const ABILITY_DESCRIPTIONS = {
  str: "Physical power: melee attacks, carrying capacity, and Athletics checks.",
  dex: "Agility and reflexes: Armor Class, initiative, ranged attacks, and Stealth and Acrobatics checks.",
  con: "Endurance and fortitude: more hit points at every level, and holding concentration on spells.",
  int: "Reasoning and memory: Investigation and Arcana checks. Wizards cast with Intelligence.",
  wis: "Awareness and intuition: Perception and Insight checks. Clerics, Druids, and Rangers cast with Wisdom.",
  cha: "Force of personality: Persuasion and Deception checks. Bards, Paladins, Sorcerers, and Warlocks cast with Charisma.",
};

export const HP_METHOD_OPTIONS = [
  { value: "average", label: "Fixed Average", description: "Always take the fixed average for your hit die (e.g. 5 for a d8), plus your Constitution modifier. Consistent and predictable, no rolling involved." },
  { value: "roll", label: "Roll In-Browser", description: "Roll your hit die right here each time you level up, plus your Constitution modifier. Keeps the randomness without needing physical dice." },
  { value: "manual", label: "Roll at the Table", description: "Roll however you prefer at the table (or elsewhere) and just type the result in when you level up." },
];

export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;
export const POINT_BUY_BUDGET = 27;

export function wizardFieldOptionNamesIn(findFn, fieldId, fieldLabel) {
  const target = findFn(fieldId, fieldLabel);
  return (target?.choices || []).map((c) => c.text).filter(Boolean);
}
export function wizardUnavailableMessageFor(state) {
  return `As a level ${state.level} ${state.species || "character"} ${state.className || "character"}${state.subclass ? ` (${state.subclass})` : ""}, this page is not applicable.`;
}

export function bucketGroupsByCategory(groups, categories, categorizeFn) {
  const byCategory = Object.fromEntries(categories.map((cat) => [cat.key, []]));
  groups.forEach((group) => byCategory[categorizeFn(group)].push(group));
  return byCategory;
}

export function renderRulesetStepInto(container, state, deps) {
  const {
    listRulesetsFn, listContentPacksFn = () => [],
    defaultContentPackIdsFn = () => [],
    primaryId = null, includedIds = [], updateIdsFn, setPrimaryFn,
  } = deps;
  const systems = listRulesetsFn();
  if (systems.length === 0) {
    const note = document.createElement("p");
    note.className = "leveling-tab__intro";
    note.textContent = "No rulesets found.";
    container.append(note);
    return;
  }
  // One game system (ruleset) per table; its content comes from the
  // books checked below. Auto-select the only system so a single-
  // system table never faces an empty picker. Persist-only here (no
  // re-render): the rest of this step paints the selection in the
  // same pass.
  const primary = (primaryId && systems.some((s) => s.id === primaryId)) ? primaryId : systems[0].id;
  if (primary !== primaryId && systems.length === 1) {
    setPrimaryFn(primary, { rerender: false });
  }

  // The ruleset section: a radio list when more than one system
  // exists, a single selected row otherwise.
  if (systems.length === 1) {
    const banner = document.createElement("div");
    banner.className = "choice-row choice-row--selected";
    const body = document.createElement("div");
    body.className = "choice-row__body";
    const label = document.createElement("div");
    label.className = "choice-row__label";
    label.textContent = systems[0].name;
    const desc = document.createElement("div");
    desc.className = "choice-row__description";
    desc.textContent = systems[0].description || "Game system for this character.";
    const badge = document.createElement("div");
    badge.className = "choice-row__mechanics-meta";
    badge.textContent = "Ruleset — used for level-up math";
    body.append(label, desc, badge);
    banner.append(body);
    container.append(banner);
  } else {
    const list = document.createElement("div");
    list.className = "choice-row-list ruleset-list";
    systems.forEach((entry) => {
      const checked = entry.id === primary;
      const row = document.createElement("label");
      row.className = "choice-row" + (checked ? " choice-row--selected" : "");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "ruleset";
      input.checked = checked;
      input.setAttribute("aria-label", entry.name);
      input.addEventListener("change", () => {
        if (input.checked) setPrimaryFn(entry.id);
      });
      const body = document.createElement("div");
      body.className = "choice-row__body";
      const label = document.createElement("div");
      label.className = "choice-row__label";
      label.textContent = entry.name;
      body.append(label);
      if (entry.description) {
        const d = document.createElement("div");
        d.className = "choice-row__description";
        d.textContent = entry.description;
        body.append(d);
      }
      if (checked) {
        const badge = document.createElement("div");
        badge.className = "choice-row__mechanics-meta";
        badge.textContent = "Ruleset — used for level-up math";
        body.append(badge);
      }
      row.append(input, body);
      list.append(row);
    });
    container.append(list);
  }

  // Content books for the primary ruleset: one checkbox per pack.
  // Auto-select the only book, or the system's default books when
  // nothing is chosen yet. A lone book stays locked on.
  const packs = listContentPacksFn(primary);
  if (packs.length === 0) {
    const note = document.createElement("p");
    note.className = "leveling-tab__intro";
    note.textContent = "This ruleset has no content books registered yet.";
    container.append(note);
    return;
  }
  let ids = [...new Set((includedIds || []).filter(Boolean))];
  if (ids.length === 0) {
    ids = packs.length === 1
      ? [packs[0].id]
      : [...new Set((defaultContentPackIdsFn(primary) || []).filter((id) => packs.some((p) => p.id === id)))];
    if (ids.length > 0) updateIdsFn(ids, { rerender: false });
  }
  const locked = packs.length === 1;
  const section = document.createElement("p");
  section.className = "wizard__section-label";
  section.textContent = "Content books";
  container.append(section);
  const list = document.createElement("div");
  list.className = "choice-row-list ruleset-list";
  packs.forEach((pack) => {
    const checked = ids.includes(pack.id);
    const row = document.createElement("label");
    row.className = "choice-row" + (checked ? " choice-row--selected" : "");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    if (locked) input.disabled = true;
    input.setAttribute("aria-label", pack.name);
    input.addEventListener("change", () => {
      const next = input.checked
        ? [...ids, pack.id]
        : ids.filter((id) => id !== pack.id);
      // Keep pack order regardless of the order boxes were ticked in.
      const ordered = packs.map((p) => p.id).filter((id) => next.includes(id));
      updateIdsFn(ordered);
    });
    const body = document.createElement("div");
    body.className = "choice-row__body";
    const label = document.createElement("div");
    label.className = "choice-row__label";
    label.textContent = pack.name;
    body.append(label);
    if (pack.description) {
      const d = document.createElement("div");
      d.className = "choice-row__description";
      d.textContent = pack.description;
      body.append(d);
    }
    if (locked) {
      const badge = document.createElement("div");
      badge.className = "choice-row__mechanics-meta";
      badge.textContent = "Only book — always on";
      body.append(badge);
    }
    row.append(input, body);
    list.append(row);
  });
  container.append(list);
}

export function renderIdentityStepInto(container, state, deps) {
  const { characterName, nameInputSetFn, saveNameFn, updateFn, fieldFn, optionNamesFn, catalogInfoFn, bundleFn, summarizeFn, mechanicsListFn, selectableRowsFn, debounceFn } = deps;
  const {
    subraceGroupFn = null,
    subraceMechanicsFn = null,
    selectSubraceFn = null,
  } = deps;
  const nameField = document.createElement("input");
  nameField.type = "text";
  nameField.className = "input-group__control";
  nameField.value = characterName || "";
  // Debounced on "input" (not "change"/blur) to match the
  // toolbar's own name field — otherwise a name typed here and
  // followed immediately by "Next →" (no blur in between)
  // would be lost.
  nameField.addEventListener("input", debounceFn(() => {
    saveNameFn(nameField.value);
    nameInputSetFn(nameField.value);
  }, 400));
  fieldFn(container, "Character Name", nameField);

  const level = document.createElement("input");
  level.type = "number"; level.min = "1"; level.max = "20"; level.value = String(state.level); level.className = "input-group__control";
  level.addEventListener("change", () => updateFn("level", level.value));
  fieldFn(container, "Starting Level", level);

  const raceLabel = document.createElement("p");
  raceLabel.className = "wizard__section-label";
  raceLabel.textContent = "Race/Species";
  container.append(raceLabel);

  const liveNames = optionNamesFn(state.rulesetId, "Race");
  if (liveNames.length) {
    selectableRowsFn(container, liveNames, {
      selectedName: state.species,
      getInfo: (name) => catalogInfoFn(["race", "species"], name),
      getMechanicsList: (name) => (mechanicsListFn ? mechanicsListFn("Race", name) : null),
      onSelect: (name) => updateFn("species", name),
      // Subrace picker nests under the selected race — the same
      // pattern the Class step uses for subclasses.
      afterRow: (raceName, rowEl) => {
        if (raceName !== state.species) return;
        const sub = subraceGroupFn ? subraceGroupFn(raceName) : null;
        if (!sub?.group?.options?.length) return;
        const picked = sub.group.options.find((o) => (sub.pickedIds || []).includes(o.id));
        const holder = document.createElement("div");
        selectableRowsFn(holder, sub.group.options.map((o) => o.name), {
          selectedName: picked ? picked.name : "",
          getInfo: (n) => catalogInfoFn(["subrace"], n),
          getMechanicsList: (n) => (subraceMechanicsFn ? subraceMechanicsFn(raceName, n) : null),
          onSelect: (n) => {
            const opt = sub.group.options.find((o) => o.name === n);
            if (opt && selectSubraceFn) selectSubraceFn(sub.group, opt.id);
          },
          nested: true,
          // No Expand All/Collapse All of its own — the race list's
          // top-level controls already cover these rows.
          collapsible: false,
        });
        if (holder.firstElementChild) rowEl.after(holder.firstElementChild);
      },
    });
  } else {
    const input = document.createElement("input");
    input.type = "text"; input.className = "input-group__control";
    input.placeholder = "No Race options found for this ruleset yet — type it in for now";
    input.value = state.species || "";
    input.addEventListener("change", () => updateFn("species", input.value));
    fieldFn(container, "Race/Species", input);
  }
}

export function renderClassStepInto(container, state, deps) {
  const { optionNamesFn, catalogInfoFn, bundleFn, summarizeFn, mechanicsListFn, subclassDataFn, updateFn, selectableRowsFn } = deps;
  const liveNames = optionNamesFn(state.rulesetId, "Class");
  selectableRowsFn(container, liveNames, {
    selectedName: state.className,
    getInfo: (name) => catalogInfoFn(["class"], name),
    getMechanicsList: (name) => (mechanicsListFn ? mechanicsListFn("Class", name) : null),
    onSelect: (name) => updateFn("className", name),
    afterRow: (name, rowEl) => {
      if (name !== state.className) return;
      const subs = subclassDataFn(name);
      // No note when there's nothing to choose yet — the nested
      // picker appears here exactly when a subclass is choosable now,
      // and the Leveling tab covers later levels.
      if (!(subs.subclasses.length && state.level >= subs.subclassLevel)) return;
      // Built against a detached holder so the nested list's
      // own container.append() call doesn't land it at the end of
      // the whole class list — it belongs right under this
      // one selected class's row instead.
      const holder = document.createElement("div");
      selectableRowsFn(holder, subs.subclasses, {
        selectedName: state.subclass,
        getInfo: (n) => catalogInfoFn(["subclass"], n),
        getMechanicsList: (n) => (mechanicsListFn ? mechanicsListFn("Subclass", n) : null),
        onSelect: (n) => updateFn("subclass", n),
        nested: true,
      });
      rowEl.after(holder.firstElementChild);
    },
  });
}

// --- Generic row-list + choice-page steps -------------------------------------------
//
// Shared by the Background step (and any future single-list picker with
// a type-in fallback), the Preferences HP-method step, and the
// Spells/Languages/Equipment/Feats/Proficiencies choice pages.

export function renderRowListStepInto(container, state, deps) {
  const {
    optionNamesFn, fallbackNames, keywords, category, selectedKey,
    inputLabel, inputPlaceholder, updateKey, updateFn, fieldFn,
    selectableRowsFn, catalogInfoFn, bundleFn, summarizeFn, mechanicsListFn,
  } = deps;
  const liveNames = optionNamesFn(state.rulesetId, category, fallbackNames);
  if (liveNames.length) {
    selectableRowsFn(container, liveNames, {
      selectedName: state[selectedKey],
      getInfo: (name) => catalogInfoFn(keywords, name),
      getMechanicsList: (name) => (mechanicsListFn ? mechanicsListFn(category, name) : null),
      onSelect: (name) => updateFn(updateKey, name),
    });
  } else {
    const input = document.createElement("input");
    input.type = "text"; input.className = "input-group__control";
    input.placeholder = inputPlaceholder;
    input.value = state[selectedKey] || "";
    input.addEventListener("change", () => updateFn(updateKey, input.value));
    fieldFn(container, inputLabel, input);
  }
}

export function renderPreferencesStepInto(container, state, deps) {
  const { hpOptions, currentMethod, updateFn, selectableRowsFn } = deps;
  const hpLabel = document.createElement("p");
  hpLabel.className = "wizard__preference-label";
  hpLabel.textContent = "HP on level-up";
  container.append(hpLabel);

  const selected = hpOptions.find((opt) => opt.value === currentMethod);
  selectableRowsFn(container, hpOptions.map((opt) => opt.label), {
    selectedName: selected?.label,
    getInfo: (label) => ({ description: hpOptions.find((opt) => opt.label === label)?.description || "" }),
    onSelect: (label) => updateFn("hpMethod", hpOptions.find((opt) => opt.label === label)?.value),
  });
}

/** One merged extra-languages picker across every source (race,
 *  class, background): the full vocabulary in one list — the same
 *  options for every character — with default-known languages
 *  (Common plus fixed grants) pre-checked and locked. The legend
 *  reads "Extra Languages (picked/total)" with no per-source
 *  explanation; picks distribute back onto the per-group choice keys
 *  via onToggle, so all downstream readers work unchanged. */
export function renderMergedLanguagePickerInto(container, deps) {
  const { languages, picked, granted, total, onToggle } = deps;
  const pickedSet = new Set(picked || []);
  const grantedSet = new Set(granted || []);
  const group = document.createElement("fieldset");
  group.className = "level-guide__choices";
  const legend = document.createElement("legend");
  legend.textContent = `Extra Languages (${pickedSet.size}/${total})`;
  group.append(legend);
  (languages || []).forEach((name) => {
    const row = document.createElement("label");
    row.className = "level-guide__choice-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = name;
    const isGranted = grantedSet.has(name);
    const isChecked = isGranted || pickedSet.has(name);
    input.checked = isChecked;
    if (isGranted) {
      input.disabled = true;
      row.classList.add("level-guide__choice-option--locked");
      row.title = name === "Common"
        ? "Known by everyone — free, never uses picks"
        : "Granted by your race, class, or background — already known";
    } else if (!isChecked && pickedSet.size >= total) {
      input.disabled = true;
    }
    input.addEventListener("change", () => onToggle(name));
    const text = document.createElement("span");
    text.textContent = name;
    row.append(input, text);
    group.append(row);
  });
  container.append(group);
}

export function renderChoicePageStepInto(container, groups, saveRules, renderChoiceGroupsFn) {
  renderChoiceGroupsFn(container, groups, saveRules);
}

/** Read-only reference list of everything the chosen Race/Class/
 *  Subclass/Background grant automatically (fixed feature grants, one
 *  section per source). `sections` is [{ source, features: [{ name,
 *  description }] }]; empty sections are skipped, and a fully empty
 *  list explains itself instead of rendering blank. */
export function renderInnateAbilitiesStepInto(container, sections) {
  const shown = (sections || []).filter((s) => (s.features || []).length);
  if (!shown.length) {
    const note = document.createElement("p");
    note.className = "leveling-tab__intro";
    note.textContent = "No innate abilities from your current Race/Class/Background selections yet — pick those first, then come back.";
    container.append(note);
    return;
  }
  shown.forEach((section) => {
    const heading = document.createElement("p");
    heading.className = "wizard__section-label";
    heading.textContent = section.source;
    container.append(heading);
    section.features.forEach((feature) => {
      const block = document.createElement("div");
      block.className = "level-guide__choices";
      const name = document.createElement("strong");
      name.textContent = feature.name || "Unnamed ability";
      block.append(name);
      if (feature.description) {
        const desc = document.createElement("p");
        desc.className = "level-guide__choice-description";
        desc.textContent = feature.description;
        block.append(desc);
      }
      container.append(block);
    });
  });
}

export function renderSpellsStepInto(container, state, deps) {  const { groups, saveRules, choiceGroupsFn, casterInfoFn, spellPickerFn } = deps;
  choiceGroupsFn(container, groups, saveRules);
  if (casterInfoFn(state.rulesetId, state.className)) {
    const heading = document.createElement("p");
    heading.className = "wizard__section-label";
    heading.textContent = "Spells Known";
    container.append(heading);
    spellPickerFn(container, { rulesetId: state.rulesetId, className: state.className, level: state.level });
  }
}

// --- Review step ------------------------------------------------------------------------
//
// Migration of the renderRulesTab "review" step: summary rows plus the
// Finish Setup button that syncs wizard answers onto the sheet.

export function reviewLinesFor({ characterName, rulesetName, species, className, subclass, background, level, spellLimit, resources = [], abilityScores = null, abilityMethod = null, hpMethod = null, choiceLines = [], spellsPicked = [], equipmentLine = null, featNames = [] }) {
  const ABILITY_METHOD_NAMES = { pointbuy: "Point Buy", roll: "Random Roll", manual: "Manual Entry" };
  const HP_METHOD_NAMES = { average: "Fixed Average", roll: "Roll In-Browser", manual: "Roll at the Table" };
  const noteLines = [
    characterName && `Name: ${characterName}`,
    rulesetName || null,
    species && `Race: ${species}`,
    className && `Class: ${className}${subclass ? ` (${subclass})` : ""}`,
    background && `Background: ${background}`,
    `Level ${level}`,
  ].filter(Boolean);
  if (abilityScores) {
    const scores = Object.entries(abilityScores)
      .map(([id, value]) => `${String(id).toUpperCase()} ${value}`)
      .join(" · ");
    noteLines.push(`Ability Scores${abilityMethod ? ` (${ABILITY_METHOD_NAMES[abilityMethod] || abilityMethod})` : ""}: ${scores}`);
  }
  if (hpMethod) noteLines.push(`HP Method: ${HP_METHOD_NAMES[hpMethod] || hpMethod}`);
  for (const line of choiceLines) noteLines.push(line);
  if (spellLimit) {
    const { style, cantrips, spells } = spellLimit;
    const bits = [];
    if (cantrips) bits.push(`${cantrips} cantrip${cantrips === 1 ? "" : "s"}`);
    bits.push(`${spells} spell${spells === 1 ? "" : "s"} ${style === "known" ? "known" : "prepared"}`);
    noteLines.push(`Spells: ${bits.join(" · ")}`);
  }
  if (spellsPicked.length) noteLines.push(`Spells Known: ${spellsPicked.join(" · ")}`);
  if (equipmentLine) noteLines.push(equipmentLine);
  if (featNames.length) noteLines.push(`Feats: ${featNames.join(" · ")}`);
  resources.forEach((resource) => noteLines.push(`${resource.name}: ${resource.maximum}`));
  return noteLines;
}

export function renderReviewStepInto(container, state, deps) {  const { characterName, rulesetName, spellLimit, resources, abilityScores, abilityMethod, hpMethod, choiceLines, spellsPicked, equipmentLine, featNames, syncFn } = deps;
  const rows = document.createElement("div");
  rows.className = "wizard__review-rows";
  const noteLines = reviewLinesFor({
    characterName,
    rulesetName,
    species: state.species,
    className: state.className,
    subclass: state.subclass,
    background: state.background,
    level: state.level,
    spellLimit,
    resources,
    abilityScores: abilityScores || null,
    abilityMethod: abilityMethod || null,
    hpMethod: hpMethod || null,
    choiceLines: choiceLines || [],
    spellsPicked: spellsPicked || [],
    equipmentLine: equipmentLine || null,
    featNames: featNames || [],
  });
  if (noteLines.length === 0) {
    const empty = document.createElement("p");
    empty.className = "level-guide__summary";
    empty.textContent = "Nothing chosen yet.";
    rows.append(empty);
  } else {
    noteLines.forEach((line) => {
      const row = document.createElement("p");
      row.className = "wizard__review-row";
      row.textContent = line;
      rows.append(row);
    });
  }
  container.append(rows);

  const buttonRow = document.createElement("div");
  buttonRow.className = "wizard__review-button-row";
  const sync = document.createElement("button");
  sync.type = "button"; sync.className = "btn btn--primary wizard__finish-btn"; sync.textContent = "Finish Setup";
  sync.addEventListener("click", () => syncFn());
  buttonRow.append(sync);
  container.append(buttonRow);
}

// --- Abilities step -------------------------------------------------------------------
//
// Migration of the renderRulesTab "abilities" step: method picker
// (Point Buy / Random Roll / Manual Entry) + per-score rows each with
// a live modifier readout.
//
//   renderAbilitiesStepInto(container, {
//     abilityIds, descriptions, scores, method, budget, min, max,
//     costFn, affordableFn, rollFn, modifierFn, formatFn, saveFn,
//     onMethodChange,
//   })

export function clampScoreToRange(value, fallback, min, max) {
  let v = Number.parseInt(value, 10);
  if (!Number.isFinite(v)) v = fallback;
  return Math.min(max, Math.max(min, v));
}

export function pointBuyNoteText(spent, budget) {
  return `Points spent: ${spent}/${budget}`;
}

export function abilityRowInto(scoresWrap, id, control, description, modifierFn, formatFn) {
  const row = document.createElement("div");
  row.className = "wizard__ability-row";
  const group = document.createElement("label");
  group.className = "level-guide__field";
  group.textContent = id.toUpperCase();
  group.append(control);
  row.append(group);

  const modGroup = document.createElement("div");
  modGroup.className = "level-guide__field wizard__ability-modifier";
  const modLabel = document.createElement("span");
  modLabel.textContent = "Modifier";
  modGroup.append(modLabel);
  const modValue = document.createElement("div");
  modValue.className = "input-group__control wizard__ability-modifier-value";
  modGroup.append(modValue);
  row.append(modGroup);

  const desc = document.createElement("p");
  desc.className = "wizard__ability-row-description";
  desc.textContent = description;
  row.append(desc);
  scoresWrap.append(row);

  // Returns an updater the caller invokes whenever `control`'s value
  // changes, so the modifier box stays in sync — nothing writes to
  // the modifier directly.
  const updateModifier = () => {
    const score = Number(control.value);
    modValue.textContent = formatFn(modifierFn(Number.isFinite(score) ? score : 10));
  };
  updateModifier();
  return updateModifier;
}

export function renderAbilitiesStepInto(container, deps) {
  const {
    abilityIds, descriptions, scores, method, budget, min, max,
    costFn, affordableFn, rollFn, modifierFn, formatFn, saveFn,
    onMethodChange,
  } = deps;
  const intro = document.createElement("p");
  intro.className = "leveling-tab__intro";
  intro.textContent = "Set your six ability scores. Switching methods below resets the scores to fit it.";
  container.append(intro);

  const methodGroup = document.createElement("label");
  methodGroup.className = "level-guide__field wizard__ability-method";
  methodGroup.textContent = "Method";
  const methodSelect = document.createElement("select");
  methodSelect.className = "input-group__control";
  [["pointbuy", "Point Buy (27 points)"], ["roll", "Random Roll (4d6, drop lowest)"], ["manual", "Manual Entry"]].forEach(([value, label]) => {
    const option = document.createElement("option"); option.value = value; option.textContent = label; methodSelect.append(option);
  });
  methodSelect.value = method || "manual";
  methodGroup.append(methodSelect);
  container.append(methodGroup);

  const scoresWrap = document.createElement("div");
  scoresWrap.className = "wizard__ability-scores";
  container.append(scoresWrap);

  function renderScores() {
    scoresWrap.innerHTML = "";
    const current = methodSelect.value;

    if (current === "pointbuy") {
      const note = document.createElement("p");
      note.className = "leveling-tab__intro wizard__ability-note";
      scoresWrap.append(note);
      const updateNote = () => {
        const spent = abilityIds.reduce((sum, id) => sum + costFn(scores[id]), 0);
        note.textContent = pointBuyNoteText(spent, budget);
      };
      abilityIds.forEach((id) => {
        if (scores[id] < min || scores[id] > max) scores[id] = min;
        const input = document.createElement("input");
        input.type = "number"; input.min = String(min); input.max = String(max);
        input.className = "input-group__control";
        input.value = String(scores[id]);
        const updateModifier = abilityRowInto(scoresWrap, id, input, descriptions[id], modifierFn, formatFn);
        input.addEventListener("change", () => {
          let value = clampScoreToRange(input.value, min, min, max);
          // Stop the increase right at whatever's still affordable
          // rather than letting it go over budget — e.g. with only 1
          // point left, typing/stepping to 12 when 11 is the last
          // thing they can afford snaps back to 11, not 12.
          const affordable = affordableFn(id);
          if (value > affordable) value = affordable;
          input.value = String(value);
          scores[id] = value;
          saveFn();
          updateNote();
          updateModifier();
        });
      });
      updateNote();
    } else if (current === "roll") {
      const noteRow = document.createElement("div");
      noteRow.className = "wizard__ability-note";
      const rollIntro = document.createElement("p");
      rollIntro.className = "leveling-tab__intro";
      rollIntro.textContent = "Click Roll All to roll 4d6 (dropping the lowest die) for each score — or edit any value by hand afterward.";
      noteRow.append(rollIntro);
      const rollAllBtn = document.createElement("button");
      rollAllBtn.type = "button"; rollAllBtn.className = "btn"; rollAllBtn.textContent = "Roll All";
      noteRow.append(rollAllBtn);
      scoresWrap.append(noteRow);
      const inputs = {};
      const modifierUpdaters = {};
      rollAllBtn.addEventListener("click", () => {
        abilityIds.forEach((id) => {
          scores[id] = rollFn();
          inputs[id].value = String(scores[id]);
          modifierUpdaters[id]();
        });
        saveFn();
      });
      abilityIds.forEach((id) => {
        const input = document.createElement("input");
        input.type = "number"; input.min = "3"; input.max = "18"; input.className = "input-group__control";
        input.value = String(scores[id]);
        const updateModifier = abilityRowInto(scoresWrap, id, input, descriptions[id], modifierFn, formatFn);
        input.addEventListener("change", () => { scores[id] = Number(input.value) || 10; saveFn(); updateModifier(); });
        inputs[id] = input;
        modifierUpdaters[id] = updateModifier;
      });
    } else {
      abilityIds.forEach((id) => {
        const input = document.createElement("input");
        input.type = "number"; input.min = "1"; input.max = "30"; input.className = "input-group__control";
        input.value = String(scores[id]);
        const updateModifier = abilityRowInto(scoresWrap, id, input, descriptions[id], modifierFn, formatFn);
        input.addEventListener("change", () => { scores[id] = Number(input.value) || 10; saveFn(); updateModifier(); });
      });
    }
  }
  methodSelect.addEventListener("change", () => {
    onMethodChange(methodSelect.value);
    renderScores();
  });
  renderScores();
}

// --- Level-guide head -------------------------------------------------------------------
//
// Migration of renderRulesetLevelGuide's plan/context setup from
// customSheet.js: live-subclass override, pending-state init,
// already-applied panel, slot summary.

export function applyLiveSubclassOverride(plan, { selectedSubclass, level, liveSubclasses }) {
  if (!plan) return plan;
  if (liveSubclasses.subclasses.length) {
    plan.needsSubclass = !selectedSubclass && level >= liveSubclasses.subclassLevel;
    plan.subclassChoices = plan.needsSubclass ? liveSubclasses.subclasses : [];
  }
  return plan;
}

export function initPendingLevelState(pendingState, levelKey, { subclass, choices, className, newClassName } = {}) {
  if (!pendingState[levelKey]) {
    pendingState[levelKey] = {
      hp: "",
      subclass: subclass || "",
      notes: "",
      asiMode: "feat",
      asiAbility1: "",
      asiAbility2: "",
      featChoice: "",
      className: className || "",
      newClassName: newClassName || "",
      choices: Object.fromEntries(
        Object.entries(choices || {}).map(([key, picks]) => [key, [...picks]])
      ),
    };
  }
  return pendingState[levelKey];
}

/** "Which class gains this level" picker for the level-up guide's
 *  optional first step (only rendered at total level 2+, since
 *  multiclassing can't start at 1st). Radios for the primary class
 *  and every existing secondary (with an ✕ to drop a secondary), plus
 *  a "new class" radio revealing a prereq-gated dropdown. All state
 *  lives on `pending` (className/newClassName); `onChangeFn`
 *  re-renders so plan, steps, and gating follow the pick. */
export function renderGuideLevelClassStepInto(container, pending, deps) {
  const {
    primaryName, primaryLevel, entries, level, allClassNames,
    eligibilityFn, subclassForFn, removeFn, confirmFn, onChangeFn,
  } = deps;
  const pick = (value) => {
    pending.className = value;
    if (value !== "__new") pending.newClassName = "";
    pending.subclass = subclassForFn(value === "__new" ? pending.newClassName : value) || "";
    if (onChangeFn) onChangeFn();
  };
  const row = (value, label, sub) => {
    const rowEl = document.createElement("label");
    rowEl.className = "level-guide__choice-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "level-class";
    input.value = value;
    input.checked = pending.className === value;
    input.addEventListener("change", () => pick(value));
    const text = document.createElement("span");
    text.textContent = label;
    rowEl.append(input, text);
    if (sub) {
      const note = document.createElement("span");
      note.className = "level-guide__choice-description";
      note.textContent = sub;
      rowEl.append(note);
    }
    container.append(rowEl);
    return rowEl;
  };
  row(primaryName, `${primaryName} (primary class)`, "Continue as your primary class.");
  entries.forEach((entry) => {
    const rowEl = row(entry.name, `${entry.name} — now ${entry.levels}${entry.subclass ? ` (${entry.subclass})` : ""}`, null);
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "btn formula-toolbar__btn";
    drop.textContent = "✕";
    drop.title = `Remove ${entry.name} levels (features recompute without them)`;
    drop.addEventListener("click", (e) => {
      e.preventDefault();
      if (confirmFn && !confirmFn(`Drop all ${entry.name} levels? Its features and spells will stop applying.`)) return;
      if (removeFn) removeFn(entry.name);
      if (pending.className === entry.name) {
        pending.className = primaryName;
        pending.newClassName = "";
        pending.subclass = subclassForFn(primaryName) || "";
      }
      if (onChangeFn) onChangeFn();
    });
    rowEl.append(drop);
  });
  if ((level ?? 1) >= 2) {
    const newRow = row("__new", "New class…", "Start multiclassing — needs 13+ in the right abilities (checked below).");
    if (pending.className === "__new") {
      const group = document.createElement("label");
      group.className = "level-guide__field";
      group.textContent = "New class";
      const select = document.createElement("select");
      select.className = "input-group__control";
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "Choose class";
      select.append(blank);
      const taken = new Set([primaryName, ...entries.map((e) => e.name)]);
      allClassNames.forEach((name) => {
        if (taken.has(name)) return;
        const eligible = eligibilityFn ? eligibilityFn(name) : { ok: true, reason: "" };
        const option = document.createElement("option");
        option.value = name;
        option.textContent = eligible.ok ? name : `${name} (${eligible.reason})`;
        option.disabled = !eligible.ok;
        select.append(option);
      });
      select.value = pending.newClassName || "";
      select.addEventListener("change", () => {
        pending.newClassName = select.value;
        pending.subclass = "";
        if (onChangeFn) onChangeFn();
      });
      group.append(select);
      newRow.append(group);
    }
  }
}

export function syncPendingChoices(pending, contentGroups, savedChoices = {}) {
  contentGroups.forEach((group) => {
    if (!pending.choices[group.key]) pending.choices[group.key] = [...(savedChoices[group.key] || [])];
  });
  return pending;
}

export function slotsSummary(plan) {
  return (plan?.slotChanges || []).filter((change) => change.options > 0).map((change) => `${change.options} ${change.label}-level`).join(", ");
}

export function alreadyAppliedPanel(className, level, rulesetName) {  const panel = document.createElement("section");
  panel.className = "level-guide";
  const heading = document.createElement("div");
  heading.className = "level-guide__heading";
  const title = document.createElement("h2");
  title.textContent = `${className || "Character"} Level ${level}`;
  heading.append(title);
  panel.append(heading);
  const complete = document.createElement("p");
  complete.className = "level-guide__feedback";
  complete.textContent = `This level was already applied using ${rulesetName}.`;
  panel.append(complete);
  return panel;
}

// --- Level-up step shells + validation --------------------------------------------------
//
// Migration of renderRulesetLevelGuide's per-level steps (subclass,
// ASI, features info, HP, notes, review) plus apply-time validation.
// Each shell takes explicit deps; validation is pure.

export function conModFromScore(conScore) {
  return Math.floor(((Number(conScore) || 10) - 10) / 2);
}

export function rollHpOnce(dieSize, conMod) {
  return Math.max(1, Math.floor(Math.random() * dieSize) + 1 + conMod);
}

export function averageHpOnce(dieSize, conMod) {
  return Math.max(1, Math.floor(dieSize / 2) + 1 + conMod);
}

export function levelReviewSummary({ hp, subclass, needsAsi, asiMode, featChoice, asiAbilities = [], slots, classLabel }) {
  const parts = [`HP +${hp || "?"}`];
  if (classLabel) parts.unshift(classLabel);
  if (subclass) parts.push(`Subclass: ${subclass}`);
  if (needsAsi) parts.push(asiMode === "feat" ? `Feat: ${featChoice || "not chosen yet"}` : `ASI: ${asiAbilities.filter(Boolean).map((id) => id.toUpperCase()).join(", ") || "not chosen yet"}`);
  if (slots) parts.push(`Spell Slots: ${slots}`);
  return parts.join(" · ");
}

export function validateLevelApply({ hpGain, contentGroups, pendingChoices, needsAsi, asiMode, asiAbilities = [], featChoice }) {
  if (!Number.isFinite(hpGain) || hpGain < 1) {
    return "Enter the HP gained for this level before applying it.";
  }
  for (const group of contentGroups) {
    const selected = pendingChoices[group.key] || [];
    if (selected.length < group.minSelections || selected.length > group.maxSelections) {
      return `${group.label || "This choice"} needs ${group.minSelections === group.maxSelections ? group.maxSelections : `${group.minSelections}-${group.maxSelections}`} selection(s).`;
    }
  }
  if (needsAsi && asiMode !== "feat") {
    const chosen = asiAbilities.filter(Boolean);
    const required = asiMode === "single" ? 1 : 2;
    if (chosen.length < required || new Set(chosen).size !== chosen.length) {
      return "Choose the ability score(s) for this level's Ability Score Improvement (or switch it to \"Took a feat instead\").";
    }
  }
  if (needsAsi && asiMode === "feat" && !featChoice) {
    return "Choose a feat for this level's Ability Score Improvement (or switch it to a stat increase).";
  }
  return null;
}

export function renderGuideSubclassStepInto(container, pending, subclassChoices) {
  const group = document.createElement("label");
  group.className = "level-guide__field";
  group.textContent = "Subclass";
  const select = document.createElement("select");
  select.className = "input-group__control";
  const blank = document.createElement("option"); blank.value = ""; blank.textContent = "Choose subclass"; select.append(blank);
  subclassChoices.forEach((name) => {
    const option = document.createElement("option");
    option.value = name; option.textContent = name;
    select.append(option);
  });
  select.value = pending.subclass || "";
  select.addEventListener("change", () => { pending.subclass = select.value; });
  group.append(select);
  container.append(group);
}

export function renderGuideAsiStepInto(container, pending, deps) {
  const { abilityIds, rulesetId, takenFeats, featNamesFn, catalogInfoFn, selectableRowsFn, gridFn } = deps;
  const modeGroup = document.createElement("label");
  modeGroup.className = "level-guide__field";
  modeGroup.textContent = "This level's ASI";
  const modeSelect = document.createElement("select");
  modeSelect.className = "input-group__control";
  [["single", "+2 to one score"], ["double", "+1 to two scores"], ["feat", "Took a feat instead"]].forEach(([value, label]) => {
    const option = document.createElement("option"); option.value = value; option.textContent = label; modeSelect.append(option);
  });
  modeSelect.value = pending.asiMode;
  modeGroup.append(modeSelect);
  container.append(modeGroup);

  const abilityRow = document.createElement("div");
  const featWrap = document.createElement("div");
  const renderModeBody = () => {
    abilityRow.innerHTML = "";
    featWrap.innerHTML = "";
    if (modeSelect.value === "feat") {
      const names = featNamesFn(rulesetId);
      if (takenFeats.length) {
        const takenNote = document.createElement("p");
        takenNote.className = "leveling-tab__intro";
        takenNote.textContent = `Already taken: ${takenFeats.join(", ")}.`;
        featWrap.append(takenNote);
      }
      if (names.length) {
        selectableRowsFn(featWrap, names, {
          selectedName: pending.featChoice,
          getInfo: (name) => catalogInfoFn(["feat"], name),
          onSelect: (name) => { pending.featChoice = name; gridFn(); },
        });
      } else {
        const featGroup = document.createElement("label");
        featGroup.className = "level-guide__field";
        featGroup.textContent = "Feat";
        const input = document.createElement("input");
        input.type = "text"; input.className = "input-group__control";
        input.placeholder = "No Feat bundles found for this ruleset yet — type it in for now";
        input.value = pending.featChoice || "";
        input.addEventListener("change", () => { pending.featChoice = input.value; });
        featGroup.append(input);
        featWrap.append(featGroup);
      }
      return;
    }
    const count = modeSelect.value === "single" ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const abilityGroup = document.createElement("label");
      abilityGroup.className = "level-guide__field";
      abilityGroup.textContent = i === 0 ? "Ability" : "Second ability";
      const abilitySelect = document.createElement("select");
      abilitySelect.className = "input-group__control";
      const blank = document.createElement("option"); blank.value = ""; blank.textContent = "Choose"; abilitySelect.append(blank);
      abilityIds.forEach((id) => { const option = document.createElement("option"); option.value = id; option.textContent = id.toUpperCase(); abilitySelect.append(option); });
      abilitySelect.value = i === 0 ? pending.asiAbility1 : pending.asiAbility2;
      abilitySelect.addEventListener("change", () => { if (i === 0) pending.asiAbility1 = abilitySelect.value; else pending.asiAbility2 = abilitySelect.value; });
      abilityGroup.append(abilitySelect);
      abilityRow.append(abilityGroup);
    }
  };
  modeSelect.addEventListener("change", () => { pending.asiMode = modeSelect.value; renderModeBody(); });
  renderModeBody();
  container.append(abilityRow);
  container.append(featWrap);
}

export function renderGuideFeaturesStepInto(container, features) {
  features.forEach((feature) => {
    const block = document.createElement("div");
    block.className = "level-guide__choices";
    const name = document.createElement("strong");
    name.textContent = feature.name;
    const desc = document.createElement("p");
    desc.className = "level-guide__choice-description";
    desc.textContent = feature.description || "";
    block.append(name, desc);
    container.append(block);
  });
}

export function renderGuideHpStepInto(container, pending, { conScore, dieSize, method }) {
  const conMod = conModFromScore(conScore);
  if (!pending.hp) {
    if (method === "average") pending.hp = String(averageHpOnce(dieSize, conMod));
    else if (method === "roll") pending.hp = String(rollHpOnce(dieSize, conMod));
  }

  const hpGroup = document.createElement("label");
  hpGroup.className = "level-guide__field";
  hpGroup.textContent = "HP Gained";
  const hpInput = document.createElement("input");
  hpInput.type = "number"; hpInput.min = "1"; hpInput.step = "1"; hpInput.required = true;
  hpInput.placeholder = "Rolled or average"; hpInput.className = "input-group__control";
  hpInput.value = pending.hp || "";
  // Update on every keystroke (not just blur) so page gating sees the
  // value while it's being typed; Apply-time validation still guards
  // the actual number.
  hpInput.addEventListener("input", () => { pending.hp = hpInput.value; });
  hpInput.addEventListener("change", () => { pending.hp = hpInput.value; });
  hpGroup.append(hpInput);
  container.append(hpGroup);

  if (method === "roll") {
    const rerollBtn = document.createElement("button");
    rerollBtn.type = "button"; rerollBtn.className = "btn";
    rerollBtn.textContent = `Reroll (d${dieSize} ${conMod >= 0 ? "+" : ""}${conMod} CON)`;
    rerollBtn.addEventListener("click", () => { pending.hp = String(rollHpOnce(dieSize, conMod)); hpInput.value = pending.hp; });
    container.append(rerollBtn);
  } else {
    const note = document.createElement("p");
    note.className = "leveling-tab__intro";
    note.textContent = method === "average"
      ? `Prefilled with the fixed average for a d${dieSize} (set in Character Setup) — edit it if this class's hit die is different.`
      : "Roll at the table and type the result in — change your default under Character Setup → Preferences.";
    container.append(note);
  }
}

export function renderGuideNotesStepInto(container, pending) {  const benefitsGroup = document.createElement("label");
  benefitsGroup.className = "level-guide__field level-guide__field--wide";
  benefitsGroup.textContent = "Features and Choices to Record";
  const benefitsInput = document.createElement("textarea");
  benefitsInput.placeholder = "Record features, spells, proficiencies, or other choices from your source book.";
  benefitsInput.value = pending.notes || "";
  benefitsInput.addEventListener("input", () => { pending.notes = benefitsInput.value; });
  benefitsGroup.append(benefitsInput);
  container.append(benefitsGroup);
}

// --- Rules-tab shell helpers ------------------------------------------------------------------
//
// Migration of renderRulesTab's shell pieces: live-subclass override,
// stale-subclass cleanup, and the label+control field group builder.

export function applyLiveSubclassOverrideToResolved(resolved, state, liveSubclasses) {
  // Prefer a live, bundle-driven subclass list (from an applied
  // classes.json import) over the hardcoded PHB one.
  if (liveSubclasses.subclasses.length) {
    resolved.availableSubclasses = state.level >= liveSubclasses.subclassLevel ? liveSubclasses.subclasses : [];
  }
  return resolved;
}

/** Clears a stale subclass pick (chosen for a different class, or one
 *  needing a higher level than currently set) so Review/Finish Setup
 *  can't apply a subclass that no longer belongs. Mutates `rules`. */
export function cleanStaleSubclass(rules, subclassDataFn) {
  if (!rules.subclass) return rules;
  const subs = subclassDataFn(rules.className);
  const eligible = subs.subclasses.includes(rules.subclass) && rules.level >= subs.subclassLevel;
  if (!eligible) rules.subclass = "";
  return rules;
}

export function appendFieldGroup(container, label, control) {
  const group = document.createElement("label");
  group.className = "level-guide__field";
  group.textContent = label;
  group.append(control);
  container.append(group);
}

// --- Level apply ------------------------------------------------------------------------
//
// Migration of renderRulesetLevelGuide's Review & Apply mutation core.
// Pure checks/builders; the store save + rollback stays in the renderer.

export function checkLevelPrereqs({ needsSubclass, hasSubclassField, hasSubclassChoice, missingSlots = [] }) {
  if (needsSubclass && (!hasSubclassField || !hasSubclassChoice)) {
    return "This sheet needs a Subclass dropdown containing the ruleset's available choices.";
  }
  if (missingSlots.length > 0) {
    return `This sheet is missing the ${missingSlots.map((change) => change.label).join(", ")} spell-slot field(s) needed for this level.`;
  }
  return null;
}

/** Applies an ASI to an ability-scores map. Returns the summary line.
 *  `mode` is "single" (+2 one score), "double" (+1 two scores), or
 *  "feat" (no score change — the feat is recorded separately). */
export function applyAsiToScores(scores, mode, ability1, ability2) {
  const bump = (id, amount) => {
    scores[id] = (Number(scores[id]) || 10) + amount;
  };
  if (mode === "single") {
    bump(ability1, 2);
    return `+2 ${ability1.toUpperCase()}`;
  }
  bump(ability1, 1);
  bump(ability2, 1);
  return `+1 ${ability1.toUpperCase()}, +1 ${ability2.toUpperCase()}`;
}

export function buildLevelUpEntry({ level, hpGain, subclassName, slots, featureEntry, asiSummary, appliedRulesetId, className, prev = {} }) {
  return {
    ...prev,
    hp: `+${hpGain}`,
    className: className || prev.className || "",
    subclass: subclassName || "",
    spells: slots ? `Spell slots: ${slots}.` : "",
    features: featureEntry,
    asi: asiSummary,
    appliedRulesetId,
  };
}

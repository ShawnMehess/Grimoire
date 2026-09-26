// sheetWizardSteps.js
//
// Character-creation wizard step renderers migrated from
// customSheet.js's renderRulesTab. Each step takes explicit deps (no
// sheet closure); the tab shell keeps `state`/`update`/`field` and
// passes them in.

import { capitalizeFirst, commonPreviewBits, mechanicsPreviewFor } from "./sheetMechanics.js";
import { slotLabelFor } from "./sheetWizard.js";
import { el } from "./sheetHelpers.js";

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

/** Which ruleset counts as selected: the persisted one when it still
 *  exists, else the first registered system (display fallback — the
 *  caller persists an explicit pick separately). Single-select by
 *  construction: exactly one id (or null when nothing is registered).
 *  Pure. */
export function resolvePrimaryRuleset(systems = [], primaryId = null) {
  if (primaryId && (systems || []).some((s) => s?.id === primaryId)) return primaryId;
  return systems?.[0]?.id ?? null;
}

export function renderRulesetStepInto(container, state, deps) {
  const {
    listRulesetsFn, listContentPacksFn = () => [],
    defaultContentPackIdsFn = () => [],
    primaryId = null, includedIds = [], updateIdsFn, setPrimaryFn,
  } = deps;
  const systems = listRulesetsFn();
  if (systems.length === 0) {
    container.append(el("p", { class: "leveling-tab__intro", text: "No rulesets found." }));
    return;
  }
  // One game system (ruleset) per table; its content comes from the
  // books checked below. Auto-select the only system so a single-
  // system table never faces an empty picker. Persist-only here (no
  // re-render): the rest of this step paints the selection in the
  // same pass.
  const primary = resolvePrimaryRuleset(systems, primaryId);
  if (primary && primary !== primaryId && systems.length === 1) {
    setPrimaryFn(primary, { rerender: false });
  }

  // The ruleset section is always a single-select radio list — one
  // row per registered system today, several when more exist. The
  // checked row drives which content books show below; clicking the
  // already-selected row is a no-op (compared against the persisted
  // pick, so a display fallback never blocks persisting it).
  const rulesetList = el("div", { class: "choice-row-list ruleset-list", role: "radiogroup" });
  systems.forEach((entry) => {
    const checked = entry.id === primary;
    // No native radio: like every other picker, the row itself is
    // the control and the highlight is the selection state.
    const pick = () => { if (entry.id !== primaryId) setPrimaryFn(entry.id); };
    const row = el("div", {
      class: "choice-row" + (checked ? " choice-row--selected" : ""),
      tabindex: 0, role: "radio", "aria-checked": String(checked),
      onclick: pick,
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } },
    });
    const body = el("div", { class: "choice-row__body" },
      el("div", { class: "choice-row__label", text: entry.name }),
      entry.description ? el("div", { class: "choice-row__description", text: entry.description }) : null);
    row.append(body);
    rulesetList.append(row);
  });
  container.append(rulesetList);

  // Content books for the primary ruleset: one toggle row per pack.
  // Auto-select the only book, or the system's default books when
  // nothing is chosen yet. A lone book stays locked on.
  const packs = listContentPacksFn(primary);
  if (packs.length === 0) {
    container.append(el("p", { class: "leveling-tab__intro", text: "This ruleset has no content books registered yet." }));
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
  container.append(el("p", { class: "wizard__section-label", text: "Content books" }));
  const list = el("div", { class: "choice-row-list ruleset-list" });
  packs.forEach((pack) => {
    const checked = ids.includes(pack.id);
    // No native checkbox: the row toggles and the highlight is the
    // state, like every other picker. A lone book is locked on.
    const toggle = () => {
      const next = checked
        ? ids.filter((id) => id !== pack.id)
        : [...ids, pack.id];
      // Keep pack order regardless of the order rows were toggled in.
      const ordered = packs.map((p) => p.id).filter((id) => next.includes(id));
      updateIdsFn(ordered);
    };
    const row = el("div", {
      class: "choice-row" + (checked ? " choice-row--selected" : ""),
      role: "checkbox", "aria-checked": String(checked),
      ...(locked ? { "aria-disabled": "true" } : {
        tabindex: 0,
        onclick: toggle,
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } },
      }),
    });
    const body = el("div", { class: "choice-row__body" },
      el("div", { class: "choice-row__label", text: pack.name }),
      pack.description ? el("div", { class: "choice-row__description", text: pack.description }) : null,
      locked ? el("div", { class: "choice-row__mechanics-meta", text: "Only book — Always on" }) : null);
    row.append(body);
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
  const nameField = el("input", {
    type: "text", class: "input-group__control", value: characterName || "",
    // Debounced on "input" (not "change"/blur) to match the
    // toolbar's own name field — otherwise a name typed here and
    // followed immediately by "Next →" (no blur in between)
    // would be lost.
    oninput: debounceFn(() => {
      saveNameFn(nameField.value);
      nameInputSetFn(nameField.value);
    }, 400),
  });
  fieldFn(container, "Character Name", nameField);

  const level = el("input", {
    type: "number", min: "1", max: "20", value: String(state.level), class: "input-group__control",
    onchange: () => updateFn("level", level.value),
  });
  fieldFn(container, "Starting Level", level);

  container.append(el("p", { class: "wizard__section-label", text: "Race/Species" }));

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
        const holder = el("div");
        selectableRowsFn(holder, sub.group.options.map((o) => o.name), {
          selectedName: picked ? picked.name : "",
          getInfo: (n) => catalogInfoFn(["subrace"], n),
          getMechanicsList: (n) => (subraceMechanicsFn ? subraceMechanicsFn(raceName, n) : null),
          onSelect: (n) => {
            const opt = sub.group.options.find((o) => o.name === n);
            if (opt && selectSubraceFn) selectSubraceFn(sub.group, opt.id);
          },
          nested: true,
          // Rows still collapse individually; just no second Expand
          // All/Collapse All bar for what's usually 2-4 subraces.
          showControls: false,
        });
        if (holder.firstElementChild) rowEl.after(holder.firstElementChild);
      },
    });
  } else {
    const input = el("input", {
      type: "text", class: "input-group__control",
      placeholder: "No Race options found for this ruleset yet — Type it in for now",
      value: state.species || "",
      onchange: () => updateFn("species", input.value),
    });
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
      const holder = el("div");
      selectableRowsFn(holder, subs.subclasses, {
        selectedName: state.subclass,
        getInfo: (n) => catalogInfoFn(["subclass"], n),
        getMechanicsList: (n) => (mechanicsListFn ? mechanicsListFn("Subclass", n) : null),
        onSelect: (n) => updateFn("subclass", n),
        nested: true,
        // Rows still collapse individually; the class list above has
        // its own Expand All/Collapse All, so this nested list skips a
        // redundant second bar for its handful of subclasses.
        showControls: false,
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
    const input = el("input", {
      type: "text", class: "input-group__control",
      placeholder: inputPlaceholder, value: state[selectedKey] || "",
      onchange: () => updateFn(updateKey, input.value),
    });
    fieldFn(container, inputLabel, input);
  }
}

export function renderPreferencesStepInto(container, state, deps) {
  const { hpOptions, currentMethod, updateFn, selectableRowsFn } = deps;
  container.append(el("p", { class: "wizard__preference-label", text: "HP on level-up" }));

  const selected = hpOptions.find((opt) => opt.value === currentMethod);
  selectableRowsFn(container, hpOptions.map((opt) => opt.label), {
    selectedName: selected?.label,
    getInfo: (label) => ({ description: hpOptions.find((opt) => opt.label === label)?.description || "" }),
    onSelect: (label) => updateFn("hpMethod", hpOptions.find((opt) => opt.label === label)?.value),
  });
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
    container.append(el("p", { class: "leveling-tab__intro", text: "No innate abilities from your current Race/Class/Background selections yet — Pick those first, then come back." }));
    return;
  }
  shown.forEach((section) => {
    container.append(el("p", { class: "wizard__section-label", text: section.source }));
    section.features.forEach((feature) => {
      const block = el("div", { class: "level-guide__choices" },
        el("strong", { text: feature.name || "Unnamed ability" }),
        feature.description ? el("p", { class: "level-guide__choice-description", text: feature.description }) : null);
      container.append(block);
    });
  });
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
  const rows = el("div", { class: "wizard__review-rows" });
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
    rows.append(el("p", { class: "level-guide__summary", text: "Nothing chosen yet." }));
  } else {
    rows.append(...noteLines.map((line) => el("p", { class: "wizard__review-row", text: line })));
  }
  container.append(rows);

  const buttonRow = el("div", { class: "wizard__review-button-row" });
  const sync = el("button", {
    type: "button", class: "btn btn--primary wizard__finish-btn", text: "Finish Setup",
    onclick: () => syncFn(),
  });
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

/** One ability's staged bonus as a display line, e.g. base 15 + 2
 *  from Elf → "+2 from Elf → 17 total". Empty string when there is
 *  no bonus (the row then shows nothing extra). Pure. */
export function abilityBonusNoteText(base, bonus, sources = []) {
  if (!bonus) return "";
  const total = (Number(base) || 0) + bonus;
  const sign = bonus > 0 ? `+${bonus}` : `${bonus}`;
  const who = (sources || []).length ? ` from ${(sources || []).join(", ")}` : "";
  return `${sign}${who} → ${total} total`;
}

export function abilityRowInto(scoresWrap, id, control, description, modifierFn, formatFn, bonusTextFn = null) {
  const modValue = el("div", { class: "input-group__control wizard__ability-modifier-value" });
  const bonusNote = bonusTextFn ? el("p", { class: "wizard__ability-row-description wizard__ability-bonus" }) : null;
  const row = el("div", { class: "wizard__ability-row" },
    el("label", { class: "level-guide__field", text: id.toUpperCase() }, control),
    el("div", { class: "level-guide__field wizard__ability-modifier" },
      el("span", { text: "Modifier" }),
      modValue),
    el("p", { class: "wizard__ability-row-description", text: description }),
    bonusNote);
  scoresWrap.append(row);

  // Returns an updater the caller invokes whenever `control`'s value
  // changes, so the modifier box stays in sync — nothing writes to
  // the modifier directly.
  const updateModifier = () => {
    const score = Number(control.value);
    const base = Number.isFinite(score) ? score : 10;
    modValue.textContent = formatFn(modifierFn(base));
    if (bonusNote) {
      bonusNote.textContent = bonusTextFn(id, base);
      bonusNote.hidden = !bonusNote.textContent;
    }
  };
  updateModifier();
  return updateModifier;
}

export function renderAbilitiesStepInto(container, deps) {
  const {
    abilityIds, descriptions, scores, method, budget, min, max,
    costFn, affordableFn, rollFn, modifierFn, formatFn, saveFn,
    onMethodChange,
    // Optional staged bonuses ({ [id]: { bonus, sources } }, see
    // abilityScoreBonusesFrom): shown per row as "+2 from Elf → 17
    // total" so granted bonuses never surprise. Absent means no
    // bonuses on file — rows render exactly as before.
    bonuses = null,
  } = deps;
  container.append(el("p", { class: "leveling-tab__intro", text: "Set your six ability scores. Switching methods below resets the scores to fit it." }));
  const bonusTextFn = bonuses
    ? (id, base) => abilityBonusNoteText(base, bonuses[id]?.bonus || 0, bonuses[id]?.sources || [])
    : null;

  const methodGroup = el("label", { class: "level-guide__field wizard__ability-method", text: "Method" });
  const methodSelect = el("select", { class: "input-group__control" });
  [["pointbuy", "Point Buy (27 points)"], ["roll", "Random Roll (4d6, drop lowest)"], ["manual", "Manual Entry"]].forEach(([value, label]) => {
    methodSelect.append(el("option", { value, text: label }));
  });
  methodSelect.value = method || "manual";
  methodGroup.append(methodSelect);
  container.append(methodGroup);

  const scoresWrap = el("div", { class: "wizard__ability-scores" });
  container.append(scoresWrap);

  function renderScores() {
    scoresWrap.innerHTML = "";
    const current = methodSelect.value;
    const scoreInput = (id, minVal, maxVal, onChange) => el("input", {
      type: "number", min: String(minVal), max: String(maxVal),
      class: "input-group__control", value: String(scores[id]),
      onchange: () => onChange(input),
    });

    if (current === "pointbuy") {
      const note = el("p", { class: "leveling-tab__intro wizard__ability-note" });
      scoresWrap.append(note);
      const updateNote = () => {
        const spent = abilityIds.reduce((sum, id) => sum + costFn(scores[id]), 0);
        note.textContent = pointBuyNoteText(spent, budget);
      };
      abilityIds.forEach((id) => {
        if (scores[id] < min || scores[id] > max) scores[id] = min;
        const input = scoreInput(id, min, max, (target) => {
          let value = clampScoreToRange(target.value, min, min, max);
          // Stop the increase right at whatever's still affordable
          // rather than letting it go over budget — e.g. with only 1
          // point left, typing/stepping to 12 when 11 is the last
          // thing they can afford snaps back to 11, not 12.
          const affordable = affordableFn(id);
          if (value > affordable) value = affordable;
          target.value = String(value);
          scores[id] = value;
          saveFn();
          updateNote();
          updateModifier();
        });
        const updateModifier = abilityRowInto(scoresWrap, id, input, descriptions[id], modifierFn, formatFn, bonusTextFn);
      });
      updateNote();
    } else if (current === "roll") {
      const rollAllBtn = el("button", { type: "button", class: "btn", text: "Roll All" });
      const noteRow = el("div", { class: "wizard__ability-note" },
        el("p", { class: "leveling-tab__intro", text: "Click Roll All to roll 4d6 (dropping the lowest die) for each score — Or edit any value by hand afterward." }),
        rollAllBtn);
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
        const input = scoreInput(id, 3, 18, (target) => { scores[id] = Number(target.value) || 10; saveFn(); updateModifier(); });
        const updateModifier = abilityRowInto(scoresWrap, id, input, descriptions[id], modifierFn, formatFn, bonusTextFn);
        inputs[id] = input;
        modifierUpdaters[id] = updateModifier;
      });
    } else {
      abilityIds.forEach((id) => {
        const input = scoreInput(id, 1, 30, (target) => { scores[id] = Number(target.value) || 10; saveFn(); updateModifier(); });
        const updateModifier = abilityRowInto(scoresWrap, id, input, descriptions[id], modifierFn, formatFn, bonusTextFn);
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
/** Splits the level-up Class step's options into taken classes
 *  (primary + existing secondaries, in that order) and not-yet-taken
 *  classes. Pure — the renderer maps these onto rich rows. */
export function levelClassOptionsFor({ primaryName, entries = [], allClassNames = [], level = 1 }) {
  const taken = [primaryName, ...(entries || []).map((e) => e.name)].filter(Boolean);
  const takenSet = new Set(taken);
  const untaken = (allClassNames || []).filter((n) => !takenSet.has(n));
  return { taken, untaken, canMulticlass: (level ?? 1) >= 2 && Boolean(primaryName) };
}

export function renderGuideLevelClassStepInto(container, pending, deps) {
  const {
    primaryName, primaryLevel, entries, level, allClassNames,
    eligibilityFn, subclassForFn, removeFn, confirmFn, onChangeFn,
    classInfoFn = null,
    selectableRowsFn = null, getInfo = null, getMechanicsList = null,
  } = deps;
  const pick = (value) => {
    pending.className = value;
    if (value !== "__new") pending.newClassName = "";
    pending.subclass = subclassForFn(value === "__new" ? pending.newClassName : value) || "";
    if (onChangeFn) onChangeFn();
  };
  const withNote = (info, note) => {
    if (!note) return info;
    const base = info || {};
    return { ...base, description: [base.description, note].filter(Boolean).join(" ") };
  };
  // Rich creator-style rows (portrait, description, collapsible
  // mechanics) when the caller wires them — the same look as the
  // creator's Class step, so staying vs. dipping can be compared at
  // a glance. Multiclass structure is unchanged: taken classes pick
  // directly, untaken ones flow through "__new" + newClassName, and
  // ineligible dips stay visible (with their requirement noted) but
  // don't select — the row still expands for reading.
  if (selectableRowsFn) {
    const { taken, untaken, canMulticlass } = levelClassOptionsFor({ primaryName, entries, allClassNames, level });
    const takenNoteFor = (name) => {
      // Primary take reaches the post-apply primary level (total
      // minus applied secondaries), not the total itself.
      if (name === primaryName) return `Primary class — Taking this level reaches ${primaryName} ${primaryLevel ?? level ?? 1}.`;
      const entry = (entries || []).find((e) => e.name === name);
      if (!entry) return null;
      return `Secondary class at ${entry.levels}${entry.subclass ? ` (${entry.subclass})` : ""} — Taking this level reaches ${name} ${entry.levels + 1}.`;
    };
    const takenLabel = el("p", { class: "wizard__section-label", text: "Your classes" });
    container.append(takenLabel);
    selectableRowsFn(container, taken, {
      selectedName: pending.className === "__new" ? "" : pending.className,
      getInfo: (name) => withNote(getInfo ? getInfo(name) : null, takenNoteFor(name)),
      getMechanicsList,
      onSelect: (name) => pick(name),
      afterRow: (name, rowEl) => {
        const entry = (entries || []).find((e) => e.name === name);
        if (!entry) return;
        rowEl.append(el("button", {
          type: "button", class: "btn formula-toolbar__btn", text: "✕",
          title: `Remove ${name} levels (features recompute without them)`,
          onclick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (confirmFn && !confirmFn(`Drop all ${name} levels? Its features and spells will stop applying.`)) return;
            if (removeFn) removeFn(name);
            if (pending.className === name) {
              pending.className = primaryName;
              pending.newClassName = "";
              pending.subclass = subclassForFn(primaryName) || "";
            }
            if (onChangeFn) onChangeFn();
          },
        }));
      },
    });
    if (canMulticlass && untaken.length) {
      container.append(el("p", { class: "wizard__section-label", text: "Start a new class…" }));
      container.append(el("p", { class: "leveling-tab__intro", text: "Multiclassing needs 13+ in the right abilities (checked below) and can't start before level 2." }));
      selectableRowsFn(container, untaken, {
        selectedName: pending.className === "__new" ? (pending.newClassName || "") : "",
        getInfo: (name) => {
          const eligible = eligibilityFn ? eligibilityFn(name) : { ok: true, reason: "" };
          return withNote(getInfo ? getInfo(name) : null,
            eligible.ok ? null : `Requires ${eligible.reason} — Raise abilities first.`);
        },
        getMechanicsList,
        onSelect: (name) => {
          // Deselect (second click on the open row) keeps the pending
          // pick — collapsing must never silently change the level's
          // target class out from under the rest of the guide.
          if (!name) return;
          const eligible = eligibilityFn ? eligibilityFn(name) : { ok: true, reason: "" };
          if (!eligible.ok) return;
          pending.className = "__new";
          pending.newClassName = name;
          pending.subclass = "";
          if (onChangeFn) onChangeFn();
        },
        // Rows still collapse individually; one Expand All/Collapse
        // All bar per step is enough (the "Your classes" list above
        // already has one), so this list skips a second.
        showControls: false,
      });
    }
    return;
  }
  const row = (value, label, sub, infoKey) => {
    const input = el("input", {
      type: "radio", name: "level-class", value,
      checked: pending.className === value,
      onchange: () => pick(value),
    });
    const rowEl = el("label", { class: "level-guide__choice-option" },
      input,
      el("span", { text: label }),
      sub ? el("span", { class: "level-guide__choice-description", text: sub }) : null);
    // Flavor blurb plus what the class gains at the level it would
    // reach — the same "what does this actually do" context creator
    // rows carry, so multiclass options can be compared at a glance.
    const info = classInfoFn ? classInfoFn(infoKey !== undefined ? infoKey : value) : null;
    if (info && (info.flavor || info.gainsLine)) {
      rowEl.append(el("div", { class: "level-guide__choice-info" },
        info.flavor ? el("div", { class: "level-guide__choice-flavor", text: info.flavor }) : null,
        info.gainsLine ? el("div", { class: "level-guide__choice-gains", text: info.gainsLine }) : null));
    }
    container.append(rowEl);
    return rowEl;
  };
  row(primaryName, `${primaryName} (primary class)`, "Continue as your primary class.");
  entries.forEach((entry) => {
    const rowEl = row(entry.name, `${entry.name} — Now ${entry.levels}${entry.subclass ? ` (${entry.subclass})` : ""}`, null);
    rowEl.append(el("button", {
      type: "button", class: "btn formula-toolbar__btn", text: "✕",
      title: `Remove ${entry.name} levels (features recompute without them)`,
      onclick: (e) => {
        e.preventDefault();
        if (confirmFn && !confirmFn(`Drop all ${entry.name} levels? Its features and spells will stop applying.`)) return;
        if (removeFn) removeFn(entry.name);
        if (pending.className === entry.name) {
          pending.className = primaryName;
          pending.newClassName = "";
          pending.subclass = subclassForFn(primaryName) || "";
        }
        if (onChangeFn) onChangeFn();
      },
    }));
  });
  if ((level ?? 1) >= 2) {
    const newRow = row("__new", "New class…", "Start multiclassing — Needs 13+ in the right abilities (checked below).");
    if (pending.className === "__new") {
      const select = el("select", { class: "input-group__control" });
      select.append(el("option", { value: "", text: "Choose class" }));
      const taken = new Set([primaryName, ...entries.map((e) => e.name)]);
      allClassNames.forEach((name) => {
        if (taken.has(name)) return;
        const eligible = eligibilityFn ? eligibilityFn(name) : { ok: true, reason: "" };
        select.append(el("option", {
          value: name,
          text: eligible.ok ? name : `${name} (${eligible.reason})`,
          disabled: !eligible.ok,
        }));
      });
      select.value = pending.newClassName || "";
      select.addEventListener("change", () => {
        pending.newClassName = select.value;
        pending.subclass = "";
        if (onChangeFn) onChangeFn();
      });
      newRow.append(el("label", { class: "level-guide__field", text: "New class" }, select));
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
  return (plan?.slotChanges || []).filter((change) => change.options > 0).map((change) => `${change.options} ${(change.label || slotLabelFor(change.fieldId))}-level`).join(", ");
}

export function alreadyAppliedPanel(className, level, rulesetName) {
  return el("section", { class: "level-guide" },
    el("div", { class: "level-guide__heading" },
      el("h2", { text: `${className || "Character"} Level ${level}` })),
    el("p", { class: "level-guide__feedback", text: `This level was already applied using ${rulesetName}.` }));
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

/** Full Review & Apply lines for the leveling guide — the same
 *  one-line-per-fact shape as the creator's review step, so the level
 *  summary reads identically everywhere it appears. Pending
 *  choice-group picks ride along as `choiceLines` (see
 *  reviewChoiceLinesFor), so nothing decided earlier in the guide is
 *  invisible at Apply time. Pure. */
export function levelReviewSectionsFor({ classLine = "", race = "", background = "", hp = "", hpDetail = "", subclass = "", needsAsi = false, asiMode = "", featChoice = "", asiAbilities = [], slots = "", choiceLines = [], notes = "" }) {
  const sections = [];
  if (classLine) sections.push(`Class: ${classLine}`);
  if (race) sections.push(`Race: ${race}`);
  if (background) sections.push(`Background: ${background}`);
  if (hp) sections.push(`HP: +${hp}${hpDetail ? ` (${hpDetail})` : ""}`);
  if (subclass) sections.push(`Subclass: ${subclass}`);
  if (needsAsi) {
    sections.push(asiMode === "feat"
      ? `Feat: ${(featChoice || "").trim() || "not chosen yet"}`
      : `ASI: ${asiAbilities.filter(Boolean).map((id) => String(id).toUpperCase()).join(", ") || "not chosen yet"}`);
  }
  if (slots) sections.push(`Spell Slots: ${slots}`);
  (choiceLines || []).forEach((line) => { if (line) sections.push(line); });
  if ((notes || "").trim()) sections.push(`Notes: ${notes.trim()}`);
  return sections;
}

export function levelReviewSummary({ hp, subclass, needsAsi, asiMode, featChoice, asiAbilities = [], slots, classLabel }) {
  const parts = [`HP +${hp || "?"}`];
  if (classLabel) parts.unshift(classLabel);
  if (subclass) parts.push(`Subclass: ${subclass}`);
  if (needsAsi) parts.push(asiMode === "feat" ? `Feat: ${featChoice || "not chosen yet"}` : `ASI: ${asiAbilities.filter(Boolean).map((id) => id.toUpperCase()).join(", ") || "not chosen yet"}`);
  if (slots) parts.push(`Spell Slots: ${slots}`);
  return parts.join(" · ");
}

export function validateLevelApply({ hpGain, contentGroups, pendingChoices, needsAsi, asiMode, asiAbilities = [], featChoice, groupSatisfiedFn = null }) {
  if (!Number.isFinite(hpGain) || hpGain < 1) {
    return "Enter the HP gained for this level before applying it.";
  }
  for (const group of contentGroups) {
    // With an owned-aware checker (same one the Choices step gates
    // on), already-owned proficiencies satisfy like they do in the
    // step; otherwise fall back to the raw count check.
    const satisfied = groupSatisfiedFn
      ? groupSatisfiedFn(group)
      : (() => {
        const selected = pendingChoices[group.key] || [];
        return selected.length >= group.minSelections && selected.length <= group.maxSelections;
      })();
    if (!satisfied) {
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
  if (needsAsi && asiMode === "feat" && !(featChoice || "").trim()) {
    return "Choose a feat for this level's Ability Score Improvement (or switch it to a stat increase).";
  }
  return null;
}

export function renderGuideSubclassStepInto(container, pending, subclassChoices, deps = {}) {
  const { selectableRowsFn = null, getInfo = null, getMechanicsList = null, gridFn = null } = deps;
  // Rich rows (portrait, description, mechanics) when the caller wires
  // them, like every creator picker; otherwise the legacy bare
  // dropdown. Either way a pick refreshes wizard gating — the shell
  // only re-checks completeness on re-render otherwise.
  if (selectableRowsFn) {
    selectableRowsFn(container, subclassChoices, {
      selectedName: pending.subclass || "",
      getInfo,
      getMechanicsList,
      onSelect: (name) => {
        pending.subclass = name;
        if (gridFn) gridFn();
      },
    });
    return;
  }
  const select = el("select", { class: "input-group__control" });
  select.append(el("option", { value: "", text: "Choose subclass" }));
  subclassChoices.forEach((name) => {
    select.append(el("option", { value: name, text: name }));
  });
  select.value = pending.subclass || "";
  select.addEventListener("change", () => { pending.subclass = select.value; });
  container.append(el("label", { class: "level-guide__field", text: "Subclass" }, select));
}

export function renderGuideAsiStepInto(container, pending, deps) {
  const { abilityIds, rulesetId, takenFeats, featNamesFn, catalogInfoFn, selectableRowsFn, gridFn, abilityScores = null, modifierFn = null, formatFn = null } = deps;
  // Ability options carry their live score + modifier (like the
  // creator's ability rows), so the pick isn't blind. Optional deps —
  // bare "STR" labels when unwired (tests, fallbacks).
  const abilityLabelFor = (id) => {
    const upper = String(id).toUpperCase();
    if (!abilityScores || typeof modifierFn !== "function" || typeof formatFn !== "function") return upper;
    const score = Number(abilityScores[id]) || 10;
    return `${upper} (${score}, ${formatFn(modifierFn(score))})`;
  };
  const modeSelect = el("select", { class: "input-group__control" });
  [["single", "+2 to one score"], ["double", "+1 to two scores"], ["feat", "Took a feat instead"]].forEach(([value, label]) => {
    modeSelect.append(el("option", { value, text: label }));
  });
  modeSelect.value = pending.asiMode;
  container.append(el("label", { class: "level-guide__field", text: "This level's ASI" }, modeSelect));

  const abilityRow = el("div");
  const featWrap = el("div");
  const renderModeBody = () => {
    abilityRow.innerHTML = "";
    featWrap.innerHTML = "";
    if (modeSelect.value === "feat") {
      const names = featNamesFn(rulesetId);
      if (takenFeats.length) {
        featWrap.append(el("p", { class: "leveling-tab__intro", text: `Already taken: ${takenFeats.join(", ")}.` }));
      }
      if (names.length) {
        selectableRowsFn(featWrap, names, {
          selectedName: pending.featChoice,
          getInfo: (name) => catalogInfoFn(["feat"], name),
          onSelect: (name) => { pending.featChoice = name; gridFn(); },
          collapsible: true,
        });
      } else {
        const input = el("input", {
          type: "text", class: "input-group__control",
          placeholder: "No Feat bundles found for this ruleset yet — Type it in for now",
          value: pending.featChoice || "",
          onchange: () => { pending.featChoice = input.value; },
        });
        featWrap.append(el("label", { class: "level-guide__field", text: "Feat" }, input));
      }
      return;
    }
    const count = modeSelect.value === "single" ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const abilitySelect = el("select", { class: "input-group__control" });
      abilitySelect.append(el("option", { value: "", text: "Choose" }));
      abilityIds.forEach((id) => { abilitySelect.append(el("option", { value: id, text: abilityLabelFor(id) })); });
      abilitySelect.value = i === 0 ? pending.asiAbility1 : pending.asiAbility2;
      abilitySelect.addEventListener("change", () => { if (i === 0) pending.asiAbility1 = abilitySelect.value; else pending.asiAbility2 = abilitySelect.value; });
      abilityRow.append(el("label", { class: "level-guide__field", text: i === 0 ? "Ability" : "Second ability" }, abilitySelect));
    }
  };
  modeSelect.addEventListener("change", () => {
    pending.asiMode = modeSelect.value;
    // Stale picks from the previous mode must not linger: Review
    // summarizes (and validation counts) both ability fields, while
    // single-mode Apply bumps only the first — a leftover second pick
    // would promise more than Apply does, or fail validation with no
    // visible second picker.
    if (modeSelect.value === "single") pending.asiAbility2 = "";
    renderModeBody();
  });
  renderModeBody();
  container.append(abilityRow);
  container.append(featWrap);
}

export function renderGuideFeaturesStepInto(container, features) {
  // Same bulleted bold-topic rows as the creator pickers so new
  // features read identically everywhere they appear.
  container.append(el("ul", { class: "choice-row__mechanics-list" },
    ...features.map((feature) => el("li", {},
      el("strong", { text: feature.name }),
      feature.description ? document.createTextNode(` — ${capitalizeFirst(feature.description.trimStart())}`) : null))));
}

export function renderGuideHpStepInto(container, pending, { conScore, dieSize, method }) {
  const conMod = conModFromScore(conScore);
  if (!pending.hp) {
    if (method === "average") pending.hp = String(averageHpOnce(dieSize, conMod));
    else if (method === "roll") pending.hp = String(rollHpOnce(dieSize, conMod));
  }

  // Show the HP math the same way the ability-scores step shows point
  // buy — the number should never look made up.
  const avg = method === "average" ? Math.floor(dieSize / 2) + 1 : 0;
  container.append(el("p", { class: "leveling-tab__intro", text: method === "average"
    ? `Fixed average: ${avg} (d${dieSize} ÷ 2, rounded up) ${conMod >= 0 ? "+" : ""}${conMod} CON = ${avg + conMod} HP`
    : `Roll 1d${dieSize} ${conMod >= 0 ? "+" : ""}${conMod} CON modifier = 1–${dieSize + conMod} HP (then type the result)` }));

  const hpInput = el("input", {
    type: "number", min: "1", step: "1", required: true,
    placeholder: "Rolled or average", class: "input-group__control",
    value: pending.hp || "",
    // Both: page gating reads keystrokes live, validation guards the number.
    oninput: () => { pending.hp = hpInput.value; },
    onchange: () => { pending.hp = hpInput.value; },
  });
  container.append(el("label", { class: "level-guide__field", text: "HP Gained" }, hpInput));

  if (method === "roll") {
    const rerollBtn = el("button", {
      type: "button", class: "btn",
      text: `Reroll (d${dieSize} ${conMod >= 0 ? "+" : ""}${conMod} CON)`,
      onclick: () => { pending.hp = String(rollHpOnce(dieSize, conMod)); hpInput.value = pending.hp; },
    });
    container.append(rerollBtn);
  } else {
    container.append(el("p", { class: "leveling-tab__intro", text: method === "average"
      ? `Prefilled with the fixed average for a d${dieSize} (set in Character Setup) — Edit it if this class's hit die is different.`
      : "Roll at the table and type the result in — Change your default under Character Setup → Preferences." }));
  }
}

export function renderGuideNotesStepInto(container, pending) {
  const benefitsInput = el("textarea", {
    placeholder: "Record features, spells, proficiencies, or other choices from your source book.",
    value: pending.notes || "",
    oninput: () => { pending.notes = benefitsInput.value; },
  });
  container.append(el("label", { class: "level-guide__field level-guide__field--wide", text: "Features and Choices to Record" }, benefitsInput));
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
  container.append(el("label", { class: "level-guide__field", text: label }, control));
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
    return `This sheet is missing the ${missingSlots.map((change) => change.label || slotLabelFor(change.fieldId)).join(", ")} spell-slot field(s) needed for this level.`;
  }
  return null;
}

/** Applies an ASI to an ability-scores map. Returns the summary line.
 *  `mode` is "single" (+2 one score), "double" (+1 two scores), or
 *  "feat" (no score change — the feat is recorded separately). */
export function applyAsiToScores(scores, mode, ability1, ability2) {
  const bump = (id, amount) => {
    if (!id) return;
    scores[id] = (Number(scores[id]) || 10) + amount;
  };
  if (mode === "single") {
    bump(ability1, 2);
    return ability1 ? `+2 ${ability1.toUpperCase()}` : "";
  }
  if (mode !== "double") return "";
  bump(ability1, 1);
  bump(ability2, 1);
  return `+1 ${String(ability1 || "").toUpperCase()}, +1 ${String(ability2 || "").toUpperCase()}`;
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

// sheetWizardSteps.js
//
// Character-creation wizard step renderers migrated from
// customSheet.js's renderRulesTab. Each step takes explicit deps (no
// sheet closure); the tab shell keeps `state`/`update`/`field` and
// passes them in.

import { capitalizeFirst, ABILITY_DESCRIPTIONS, abilityTooltip, humanizeGameText } from "./sheetMechanics.js";
import { slotLabelFor, richAbilityNodes, choiceDialogKindFor } from "./sheetWizard.js";
import { el } from "./sheetHelpers.js";

// Ability descriptions live in sheetMechanics.js (shared with the
// glossary); re-exported here so existing importers keep working.
export { ABILITY_DESCRIPTIONS };

// Each option's description has to stand alone, because the page-level
// paragraph that used to explain "this only matters when you level up" is
// gone. That sentence was doing real work for the first option especially:
// "Fixed Average" reads like a one-time total, and nothing else on the page
// says it is applied again at every level.
//
// Each description also carries the ARITHMETIC in plain words - die,
// average, CON modifier, added together - because "how is this number
// worked out" is the part a first-time player cannot get from the label,
// and it is the same three numbers every time. None of this changes the
// calculation: see averageHpOnce / rollHpOnce.
export const HP_METHOD_OPTIONS = [
  {
    value: "average",
    label: "Fixed Average",
    icon: "∑",
    description: "Every time you level up, this adds the same amount: half your hit die, rounded up (6 on a d10), plus your Constitution modifier. A Fighter with +2 Constitution gains 8 at every level. No rolling, and you always know the number.",
  },
  {
    value: "roll",
    label: "Roll In-Browser",
    icon: "⚄",
    description: "Every time you level up, this page rolls your hit die for you and adds your Constitution modifier. You might get more or less than the fixed average, so your hit points will vary level to level.",
  },
  {
    value: "manual",
    label: "Roll at the Table",
    icon: "✎",
    description: "Nothing is worked out for you. Every time you level up, roll however you like at the table (or wherever you play) and type the result in — remembering to add your Constitution modifier to the roll.",
  },
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
  // No lead-in sentence here any more. It used to read "Which game system
  // are you playing?", on the grounds that a bare radio list does not say
  // what it is a choice OF - but the rows are labelled with the system names,
  // so the sentence only restated the heading. Empty states and warnings
  // still render (see below): those say something the rows cannot.
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
  // The section label stays: "Content books" is jargon, and "Books to use"
  // is at least plain. The lead-in sentence under it used to spell out that
  // unticking a book empties pickers on every later page - true, and worth
  // saying, but it was a paragraph on the first page a new player sees,
  // describing a page whose controls are checkboxes with the book names on
  // them. The consequence is a confirm dialog away either way, which is
  // where a player meets it in context rather than before they know what a
  // book is for.
  container.append(el("p", { class: "wizard__section-label", text: "Books to use" }));
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
        // `options` is passed in rather than read off the group here, so a
        // subrace picker that splits its options across categories renders
        // the same rows as a flat one. Reading `.options` alone made a
        // cross-category container show nothing nested under it, which is
        // the one shape that cannot then be completed.
        const options = sub?.options || sub?.group?.options || [];
        if (!options.length) return;
        const picked = options.find((o) => (sub.pickedIds || []).includes(o.id));
        const holder = el("div");
        selectableRowsFn(holder, options.map((o) => o.name), {
          selectedName: picked ? picked.name : "",
          getInfo: (n) => catalogInfoFn(["subrace"], n),
          getMechanicsList: (n) => (subraceMechanicsFn ? subraceMechanicsFn(raceName, n) : null),
          onSelect: (n) => {
            const opt = options.find((o) => o.name === n);
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
  const { optionNamesFn, catalogInfoFn, bundleFn, summarizeFn, mechanicsListFn, subclassDataFn, updateFn, selectableRowsFn, creationGroups, categorizeChoiceGroup, saveRules, sectionIntoFn, renderCreationChoiceGroupsFn, inlineChoicesFn } = deps;
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
  // Dialog-pick groups (skills, tools, fighting styles, expertise) for
  // the selected class render inline in its own details through the
  // shared dialog — see inlineChoicesFn. Anything left without a dialog
  // kind keeps the bottom section below.
  if (state.className && typeof inlineChoicesFn === "function") {
    // Scoped to container (which may still be detached) — never the
    // global document.
    const details = container.querySelector(`.choice-row[data-row-name="${state.className.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"] .choice-row__details`);
    const dialogGroups = (creationGroups || []).filter((g) =>
      !g.subrace && (g.source === state.className || g.source === state.subclass) && choiceDialogKindFor(g));
    if (details && dialogGroups.length) inlineChoicesFn(details, dialogGroups);
  }
  // Inline class-specific choices (fighting style, expertise, etc.) under the selected class
  if (state.className) {
    // Include both non-feat class choices AND class-specific feat choices
    const classGroups = (creationGroups || []).filter((g) => !g.subrace && (g.source === state.className || g.source === state.subclass) && !choiceDialogKindFor(g));
    if (classGroups.length) {
      const classChoicesWrap = sectionIntoFn(container, "Class Choices");
      renderCreationChoiceGroupsFn(classChoicesWrap, classGroups, saveRules, state);
    }
  }
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
  container.append(el("p", { class: "wizard__preference-label", text: "Hit Points on Level Up" }));
  // No lead-in paragraph. It used to explain that the setting only changes
  // how the number is worked out and affects nothing until level-up - but
  // each of the three options carries that as its own description, below the
  // label, so the paragraph said the same thing twice in two places, and the
  // second mention was the one furthest from the choice.

  const selected = hpOptions.find((opt) => opt.value === currentMethod);
  selectableRowsFn(container, hpOptions.map((opt) => opt.label), {
    selectedName: selected?.label,
    getInfo: (label) => ({ description: hpOptions.find((opt) => opt.label === label)?.description || "" }),
    onSelect: (label) => updateFn("hpMethod", hpOptions.find((opt) => opt.label === label)?.value),
    // These rows have nothing to expand: each option is a method and its
    // whole text is the description beside it. They still got the default
    // collapsible treatment, which put a dead Expand All / Collapse All bar
    // over a list of rows that only ever re-selected themselves. An icon
    // carries the "how does this method work" part the letter-in-a-box
    // never did ("Roll at the Table" and "Roll In-Browser" are both R).
    collapsible: false,
    showControls: false,
    getIcon: (label) => hpOptions.find((opt) => opt.label === label)?.icon || null,
  });
}

export function renderChoicePageStepInto(container, groups, saveRules, renderChoiceGroupsFn) {
  renderChoiceGroupsFn(container, groups, saveRules);
}

// --- Story step -------------------------------------------------------------------
//
// Appearance and Backstory. Every other part of a character is picked from
// bundled data; these two are the ones with no data behind them, so they are
// free text, and they were the two blanks the sheet had nowhere to put.
//
// Free text means the step CANNOT be gated. An empty Backstory is a perfectly
// finished character - plenty of tables start playing with a backstory worked
// out in the first session - so there is no isComplete, and this page never
// appears in the Review page's "Still to decide" list.

/** The two free-text story fields, in render order. Labels are the sheet
 *  field labels they write to, not decoration: one lookup finds both the
 *  control's current value and the field it saves into. */
export const STORY_FIELDS = [
  {
    label: "Appearance",
    rows: 6,
    placeholder: "Height, build, hair, eyes, clothing, distinguishing marks — whatever you want to picture them by.",
    help: "How your character looks. Nothing here is checked against anything; it is yours to fill in.",
  },
  {
    label: "Backstory",
    rows: 6,
    placeholder: "Where they came from, and what happened before this.",
    help: "The story behind your background. Your background's mechanical benefits are picked on the Background page — this is what they are about.",
  },
];

/**
 *   renderStoryStepInto(container, {
 *     fieldFn, values, saveFn, missingLabels,
 *   })
 *
 * `values` is `{ [label]: string }` from the sheet; `saveFn(label, value)` is
 * called on input, debounced by the caller. `missingLabels` lists any story
 * field the sheet has no control for, so an unwriteable field says so instead
 * of rendering an input that quietly goes nowhere.
 *
 * No re-render on input: a step that rebuilt itself per keystroke would take
 * the caret with it. The value is already in the sheet, so there is nothing to
 * re-read either — the same reasoning as the Identity step's name field. */
export function renderStoryStepInto(container, deps) {
  const { fieldFn, values = {}, saveFn, missingLabels = [] } = deps;
  if (missingLabels.length) {
    // Better a named gap than a silent one. This step is reachable on a
    // character whose layout predates these fields, and a textarea that
    // accepts typing and loses it is the worst of the three outcomes.
    container.append(el("p", {
      class: "leveling-tab__intro",
      text: `This sheet has no ${missingLabels.join(" or ")} box, so there is nowhere to put what you type here. Everything else on this page works normally.`,
    }));
  }
  for (const spec of STORY_FIELDS) {
    if (missingLabels.includes(spec.label)) continue;
    const control = el("textarea", {
      class: "input-group__control",
      rows: spec.rows,
      placeholder: spec.placeholder,
      value: values[spec.label] || "",
      oninput: (e) => { if (typeof saveFn === "function") saveFn(spec.label, e.target.value); },
    });
    fieldFn(container, spec.label, control);
    container.append(el("p", { class: "wizard__field-help", text: spec.help }));
  }
}

/** Read-only reference list of everything the chosen Race/Class/
 *  Subclass/Background grant automatically (fixed feature grants, one
 *  section per source). `sections` is [{ source, features: [{ name,
 *  description }] }]; empty sections are skipped, and a fully empty
 *  list explains itself instead of rendering blank. */
export function renderInnateAbilitiesStepInto(container, sections) {
  const shown = (sections || []).filter((s) => (s.features || []).length);
  if (!shown.length) {
    container.append(el("p", { class: "leveling-tab__intro", text: "No automatic grants from your current Race/Class/Background selections yet — Pick those first, then come back." }));
    return;
  }
  shown.forEach((section) => {
    container.append(el("p", { class: "wizard__section-label", text: section.source }));
    section.features.forEach((feature) => {
      const block = el("div", { class: "level-guide__choices" },
        el("strong", { text: feature.name || "Unnamed ability" }),
        feature.description ? el("p", { class: "level-guide__choice-description" },
          ...richAbilityNodes(humanizeGameText(feature.description))) : null);
      container.append(block);
    });
  });
}

// --- Review step ------------------------------------------------------------------------
//
// Migration of the renderRulesTab "review" step: summary rows plus the
// Finish Setup button that syncs wizard answers onto the sheet.

export function reviewLinesFor({ characterName, rulesetName, species, className, subclass, background, level, spellLimit, resources = [], abilityScores = null, abilityBonuses = null, abilityMethod = null, hpMethod = null, choiceLines = [], spellsPicked = [], equipmentLine = null, featNames = [] }) {
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
    // What the sheet will actually carry, not the base the player typed:
    // the stored scores are pre-bonus, and the racial/subracial points are
    // applied later at sheet-render time. Showing the base here made this
    // page disagree with the sheet's own STR field by the whole racial
    // bonus. Sources are named so a total that looks wrong is traceable.
    const scores = Object.entries(abilityScores)
      .map(([id, value]) => {
        const bonus = Number(abilityBonuses?.[id]?.bonus) || 0;
        const total = Number(value) + bonus;
        const from = abilityBonusNoteLines(abilityBonuses?.[id]?.sources || []);
        return `${String(id).toUpperCase()} ${total}${from.length ? ` (${from.join(", ")})` : ""}`;
      })
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

/** The summary box - character name, ruleset, and every pick - WITHOUT
 *  the Finish button.
 *
 *  Split from renderReviewStepInto so the box can be placed at the top of
 *  the step while the button stays at the bottom. The name is what you
 *  look for on a review screen, and it was buried under three full picker
 *  tables. The whole box moves, not just the name line: the review lines
 *  are one bordered panel and detaching the name from them would leave a
 *  heading floating above a separate panel. */
export function reviewSummaryBoxInto(container, state, deps) {
  const { characterName, rulesetName, spellLimit, resources, abilityScores, abilityBonuses, abilityMethod, hpMethod, choiceLines, spellsPicked, equipmentLine, featNames } = deps;
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
    abilityBonuses: abilityBonuses || null,
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
  return rows;
}

/** The "Still to decide" panel for a review-style step: one row per
 *  unfinished page, each naming what is outstanding and linking straight
 *  to the page that needs it.
 *
 *  This exists because the wizard's forward gating is a lock, not an
 *  explanation. Dots past the first unfinished page go disabled with a
 *  tooltip saying "Finish the current page first", and a player who
 *  arrived here another way — resumed mid-wizard, jumped back from the
 *  end, or landed on review via the post-creation flow — had no way to
 *  find out WHICH page was holding them or how far off it was. They had
 *  to click Back repeatedly and hunt.
 *
 *  Each row is a real button that navigates, not a label. Returns null
 *  and appends nothing when everything is decided, so the finished flow
 *  stays uncluttered — the panel appearing and disappearing is itself the
 *  "you're done" signal.
 *
 *   reviewOutstandingInto(container, outstanding, onGoToStep)
 *
 *  `outstanding` is the shape outstandingSteps() returns. `onGoToStep` is
 *  called with the step's id. */
export function reviewOutstandingInto(container, outstanding = [], onGoToStep) {
  const rows = (outstanding || []).filter((row) => row && row.stepId);
  if (rows.length === 0) return null;

  const panel = el("div", { class: "wizard__outstanding", role: "group" });
  panel.append(el("p", {
    class: "wizard__outstanding-title",
    text: rows.length === 1
      ? "Still to decide — one page still needs you:"
      : `Still to decide — ${rows.length} pages still need you:`,
  }));
  const list = el("ul", { class: "wizard__outstanding-list" });
  for (const row of rows) {
    const li = el("li", { class: "wizard__outstanding-item" });
    const button = el("button", {
      type: "button",
      class: "btn wizard__outstanding-go",
      text: row.title || row.stepId,
      onclick: () => { if (typeof onGoToStep === "function") onGoToStep(row.stepId); },
    });
    const reasons = (row.reasons || []).filter(Boolean);
    li.append(reasons.length === 1
      ? el("span", { class: "wizard__outstanding-reason", text: reasons[0] })
      : el("span", {
        class: "wizard__outstanding-reason",
        text: `${reasons.join(" · ")}`,
      }));
    li.append(button);
    list.append(li);
  }
  panel.append(list);
  container.append(panel);
  return panel;
}

/** The Finish Setup button on its own, for a step that puts the summary
 *  box somewhere other than the bottom. */
export function reviewFinishButtonInto(container, { syncFn }) {
  const buttonRow = el("div", { class: "wizard__review-button-row" });
  const sync = el("button", {
    type: "button", class: "btn btn--primary wizard__finish-btn", text: "Finish Setup",
    onclick: () => syncFn(),
  });
  buttonRow.append(sync);
  container.append(buttonRow);
  return buttonRow;
}

export function renderReviewStepInto(container, state, deps) {
  reviewSummaryBoxInto(container, state, deps);
  reviewFinishButtonInto(container, deps);
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

/** One ability's staged bonus as display lines, one per source: a race
 *  that grants +2 and a subrace that grants another +1 read as two
 *  separate lines rather than one "+3, and sometimes these" summary, so
 *  a player can see which pick is responsible for which points. No total
 *  is shown: the score box already carries the applied number, and
 *  repeating it here invited disagreement the moment the two drifted.
 *  Returns an empty array when there is no bonus. Pure. */
export function abilityBonusNoteLines(sources = []) {
  return (sources || [])
    .filter((entry) => entry && Number.isFinite(entry.value) && entry.value)
    .map((entry) => {
      const sign = entry.value > 0 ? `+${entry.value}` : `${entry.value}`;
      return entry.label ? `${sign} from ${entry.label}` : sign;
    });
}

function flashBonusNote(bonusNote) {
  if (!bonusNote || bonusNote.hidden) return;
  bonusNote.style.transition = "color 0.2s ease, background-color 0.2s ease";
  bonusNote.style.color = "var(--color-accent, #b3492b)";
  bonusNote.style.backgroundColor = "rgba(179, 73, 43, 0.15)";
  setTimeout(() => {
    bonusNote.style.color = "";
    bonusNote.style.backgroundColor = "";
  }, 1500);
}

export function abilityRowInto(scoresWrap, id, control, description, modifierFn, formatFn, bonusLinesFn = null, bonus = 0, needTextFn = null) {
  const modValue = el("div", { class: "input-group__control wizard__ability-modifier-value" });
  // One line per bonus source, rebuilt whenever the score changes. It
  // sits directly under the ability's description because that is what
  // it qualifies: "physical power" is the ability, "+2 from Half-Orc" is
  // what this particular character starts with.
  const bonusNote = bonusLinesFn ? el("div", { class: "wizard__ability-row-description wizard__ability-bonus" }) : null;
  // Feat prerequisites the current scores don't meet yet (see
  // featRequirementStatus). Shown on the score they'd have to reach, which
  // is the one place the player can actually fix them.
  const needNote = needTextFn ? el("p", { class: "wizard__ability-row-description wizard__ability-need" }) : null;
  const row = el("div", { class: "wizard__ability-row" },
    el("label", { class: "level-guide__field", text: id.toUpperCase(), title: abilityTooltip(id) ?? null, style: "font-weight: 700;" }, control),
    el("div", { class: "level-guide__field wizard__ability-modifier" },
      el("span", { text: "Modifier" }),
      modValue),
    el("p", { class: "wizard__ability-row-description" }, ...richAbilityNodes(humanizeGameText(description))),
    bonusNote,
    needNote);
  scoresWrap.append(row);

  // Returns an updater the caller invokes whenever `control`'s value
  // changes, so the modifier box stays in sync — nothing writes to
  // the modifier directly.
  const updateModifier = () => {
    const score = Number(control.value);
    const base = Number.isFinite(score) ? score : 10;
    modValue.textContent = formatFn(modifierFn(base));
    if (bonusNote) {
      const lines = abilityBonusLineNodes(bonusLinesFn(id, base));
      bonusNote.innerHTML = "";
      bonusNote.append(...lines);
      bonusNote.hidden = !lines.length;
    }
    if (needNote) {
      needNote.textContent = needTextFn(id, base);
      needNote.hidden = !needNote.textContent;
    }
  };
  updateModifier();
  return { updateModifier, bonus, bonusNote };
}

/** The per-source bonus rows for one ability, as nodes. Kept beside
 *  abilityRowInto because it is the only place they are built. */
function abilityBonusLineNodes(lines) {
  return (lines || [])
    .filter(Boolean)
    .map((line) => el("p", { class: "wizard__ability-bonus-line", text: line }));
}

export function renderAbilitiesStepInto(container, deps) {
  const {
    abilityIds, descriptions, scores, method, budget, min, max,
    costFn, affordableFn, rollFn, modifierFn, formatFn, saveFn,
    onMethodChange,
    // Optional text rendered UNDER the six scores. The race/class bonus
    // note reads as a footnote to the scores it modifies; when it led the
    // step it was a paragraph about modifiers before the modifiers were on
    // screen.
    footnote = null,
    // Optional staged bonuses ({ [id]: { bonus, sources } }, see
    // abilityScoreBonusesFrom): shown per row as "+2 from Elf → 17
    // total" so granted bonuses never surprise. Absent means no
    // bonuses on file — rows render exactly as before.
    bonuses = null,
    // Optional { [abilityId]: [{ feat, score }] } of feat ability minimums
    // the staged feat list is waiting on. Rendered per row as a warning
    // with the shortfall, so the player sees the points they still owe
    // next to the score they'd have to raise. Absent means nothing is
    // waiting, and rows render exactly as before.
    featNeeds = null,
  } = deps;
  // The "Set your six ability scores" lead-in is gone: six labelled rows
  // with the standard array / point buy / roll methods under them says the
  // same. The half of it that was NOT redundant - switching methods RESETS
  // the scores - was destructive enough to lose work silently, so it moved
  // onto the method controls themselves (see renderAbilityScoresInto's method
  // row) where it is read at the moment it applies rather than once at the
  // top of a long page.
  const bonusLinesFn = bonuses
    ? (id) => abilityBonusNoteLines(bonuses[id]?.sources || [])
    : null;
  const needTextFn = featNeeds
    ? (id, base) => {
      const unmet = (featNeeds[id] || []).filter(({ score }) => Number(base) < Number(score));
      if (!unmet.length) return "";
      return unmet
        .map(({ feat, score }) => `${feat} needs ${Number(score)} - ${Number(score) - Number(base)} more`)
        .join(". ");
    }
    : null;

  const methodGroup = el("label", { class: "level-guide__field wizard__ability-method", text: "Method" });
  const methodSelect = el("select", { class: "input-group__control" });
  [["pointbuy", "Point Buy (27 points)"], ["roll", "Random Roll (4d6, drop lowest)"], ["manual", "Manual Entry"]].forEach(([value, label]) => {
    methodSelect.append(el("option", { value, text: label }));
  });
  methodSelect.value = method || "manual";
  methodGroup.append(methodSelect);
  container.append(methodGroup);

  // "Switching methods resets your scores" lives here, beside the control
  // that does it, rather than in the step's lead-in paragraph (removed). It
  // is a consequence that destroys typed work, so it has to be visible before
  // the switch, not recalled afterwards - and a player reads the label on the
  // dropdown they are about to touch, not a sentence several rows above it.
  container.append(el("p", {
    class: "leveling-tab__intro wizard__ability-note wizard__method-warning",
    text: "Changing this method resets the six scores above.",
  }));

  const scoresWrap = el("div", { class: "wizard__ability-scores" });
  container.append(scoresWrap);

  // A note that belongs BELOW the scores, not above them. The step blurb
  // used to carry this as its last bullet, which put "bonuses from your
  // race apply on top of these scores" ABOVE the very scores it describes -
  // explaining the modifier and the race bonus before the player had seen
  // either. Appended after the scores wrapper, so it also survives the
  // re-render that renderScores() does on every change.
  if (footnote) {
    container.append(el("p", { class: "leveling-tab__intro wizard__ability-footnote", text: footnote }));
  }

  function renderScores() {
    scoresWrap.innerHTML = "";
    const current = methodSelect.value;
    const bonusMap = bonuses || {};
    const scoreInput = (id, minVal, maxVal, onChange, displayValue) => el("input", {
      type: "number", min: String(minVal), max: String(maxVal),
      class: "input-group__control", value: String(displayValue),
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
        const bonus = bonusMap[id]?.bonus || 0;
        const effectiveMin = 8 + bonus;
        if (scores[id] < effectiveMin) scores[id] = effectiveMin;
        const displayValue = scores[id] + bonus;
        const input = scoreInput(id, effectiveMin, max + bonus, (target) => {
          let value = clampScoreToRange(target.value, effectiveMin, effectiveMin, max + bonus);
          const affordable = affordableFn(id);
          if (value > affordable + bonus) value = affordable + bonus;
          if (value < effectiveMin) {
            target.value = String(effectiveMin);
            value = effectiveMin;
          }
          target.value = String(value);
          scores[id] = value - bonus;
          saveFn();
          updateNote();
          updateModifier();
        }, displayValue);
        const { updateModifier, bonusNote } = abilityRowInto(scoresWrap, id, input, descriptions[id], modifierFn, formatFn, bonusLinesFn, bonus, needTextFn);
        input.addEventListener("keydown", (e) => {
          if ((e.key === "ArrowDown" || e.key === "-") && Number(input.value) <= effectiveMin) {
            e.preventDefault();
            flashBonusNote(bonusNote);
          }
        });
        input.addEventListener("input", () => {
          if (Number(input.value) < effectiveMin) {
            input.value = String(effectiveMin);
            flashBonusNote(bonusNote);
          }
        });
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
          const bonus = bonusMap[id]?.bonus || 0;
          inputs[id].value = String(scores[id] + bonus);
          modifierUpdaters[id].updateModifier();
        });
        saveFn();
      });
      abilityIds.forEach((id) => {
        const bonus = bonusMap[id]?.bonus || 0;
        const effectiveMin = 8 + bonus;
        const input = scoreInput(id, effectiveMin, 18 + bonus, (target) => { scores[id] = Math.max(effectiveMin, Number(target.value) || effectiveMin) - bonus; saveFn(); modifierUpdaters[id].updateModifier(); }, scores[id] + bonus);
        const { updateModifier, bonusNote } = abilityRowInto(scoresWrap, id, input, descriptions[id], modifierFn, formatFn, bonusLinesFn, bonus, needTextFn);
        input.addEventListener("keydown", (e) => {
          if ((e.key === "ArrowDown" || e.key === "-") && Number(input.value) <= effectiveMin) {
            e.preventDefault();
            flashBonusNote(bonusNote);
          }
        });
        input.addEventListener("input", () => {
          if (Number(input.value) < effectiveMin) {
            input.value = String(effectiveMin);
            flashBonusNote(bonusNote);
          }
        });
        inputs[id] = input;
        modifierUpdaters[id] = { updateModifier };
      });
    } else {
      abilityIds.forEach((id) => {
        const bonus = bonusMap[id]?.bonus || 0;
        const effectiveMin = 8 + bonus;
        const input = scoreInput(id, effectiveMin, 30 + bonus, (target) => { scores[id] = Math.max(effectiveMin, Number(target.value) || effectiveMin) - bonus; saveFn(); updateModifier(); }, scores[id] + bonus);
        const { updateModifier, bonusNote } = abilityRowInto(scoresWrap, id, input, descriptions[id], modifierFn, formatFn, bonusLinesFn, bonus, needTextFn);
        input.addEventListener("keydown", (e) => {
          if ((e.key === "ArrowDown" || e.key === "-") && Number(input.value) <= effectiveMin) {
            e.preventDefault();
            flashBonusNote(bonusNote);
          }
        });
        input.addEventListener("input", () => {
          if (Number(input.value) < effectiveMin) {
            input.value = String(effectiveMin);
            flashBonusNote(bonusNote);
          }
        });
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

/** Whether a pending level-up holds anything the player actually
 *  decided — the test behind "discard your picks?" when a level-up is
 *  cancelled.
 *
 *  `initPendingLevelState` pre-fills the object with defaults, so
 *  "the entry exists" is NOT "they chose something": merely opening the
 *  walkthrough and walking away would otherwise prompt about discarding
 *  picks nobody made. Compared against those defaults instead:
 *  `asiMode` starts at "feat", and `className` starts at the primary
 *  class (a value the wizard also resets to whenever it isn't valid, so
 *  it cannot be told apart from the default and is treated as no
 *  decision — picking your own primary for a level is not worth a
 *  prompt).
 *
 *  `choices` needs the caller's baseline to answer honestly. Pending
 *  choice groups are synced from the character's ALREADY-MADE picks
 *  (syncPendingChoices), so a wizard opened on a character with spells
 *  already on it arrives full of non-empty pick lists that nobody just
 *  chose. Passing `character.rules.choices` as `baselineChoices` counts
 *  only the groups that actually differ from what was already there;
 *  omitting it falls back to "any non-empty pick list counts", which is
 *  the safe-but-noisy answer.
 *
 *  Pure — reads its arguments, returns a boolean, mutates nothing. */
export function pendingLevelHasPicks(pending, { baselineChoices = null } = {}) {
  if (!pending || typeof pending !== "object") return false;
  const text = (v) => String(v ?? "").trim();
  // Every field the wizard leaves blank until asked.
  if (text(pending.hp) || text(pending.notes) || text(pending.asiAbility1)) return true;
  if (text(pending.asiAbility2) || text(pending.featChoice) || text(pending.newClassName)) return true;
  // A subclass pick only exists on a subclass-gated level, so anything
  // here is a decision.
  if (text(pending.subclass)) return true;
  if (text(pending.asiMode) && pending.asiMode !== "feat") return true;
  const choices = pending.choices;
  if (choices && typeof choices === "object") {
    for (const [key, picks] of Object.entries(choices)) {
      const now = [...(Array.isArray(picks) ? picks : [])].sort();
      if (!now.length) continue;
      const before = [...(Array.isArray(baselineChoices?.[key]) ? baselineChoices[key] : [])].sort();
      if (now.length !== before.length || now.some((p, i) => p !== before[i])) return true;
    }
  }
  return false;
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
            // Async because confirmFn is now a themed dialog (see
            // js/ui/dialogs.js). The removal waits for the answer rather
            // than happening first and being second-guessed, so the button
            // does nothing at all until the dialog is resolved.
            Promise.resolve(confirmFn
              ? confirmFn(`Drop all ${name} levels? Its features and spells will stop applying.`)
              : true).then((ok) => {
              if (!ok) return;
              if (removeFn) removeFn(name);
              if (pending.className === name) {
                pending.className = primaryName;
                pending.newClassName = "";
                pending.subclass = subclassForFn(primaryName) || "";
              }
              if (onChangeFn) onChangeFn();
            });
          },
        }));
      },
    });
    if (canMulticlass && untaken.length) {
      container.append(el("p", { class: "wizard__section-label", text: "Start a new class…" }));
      // The "Multiclassing needs 13+..." paragraph is gone. It said the
      // requirement is "checked below", and it is: every row carries its own
      // "Requires <reason> - Raise abilities first." note from eligibilityFn
      // below, and an ineligible one cannot be selected at all. So the
      // sentence restated a per-row fact, one screen earlier, for rows that
      // already said it.
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
        // Async for the same reason as the primary-class row above.
        Promise.resolve(confirmFn
          ? confirmFn(`Drop all ${entry.name} levels? Its features and spells will stop applying.`)
          : true).then((ok) => {
          if (!ok) return;
          if (removeFn) removeFn(entry.name);
          if (pending.className === entry.name) {
            pending.className = primaryName;
            pending.newClassName = "";
            pending.subclass = subclassForFn(primaryName) || "";
          }
          if (onChangeFn) onChangeFn();
        });
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
  const { abilityIds, rulesetId, takenFeats, featNamesFn, catalogInfoFn, selectableRowsFn, gridFn, featListFn = null, abilityScores = null, modifierFn = null, formatFn = null } = deps;
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
        // The spec'd feat list (checkbox / icon / name / summary, with
        // the mechanical effect and a derived "= modifies" line beneath)
        // rather than the generic picker rows: the generic rows hide the
        // effect text behind a click, which is the one thing this list
        // exists to show up front. Falls back to the generic rows if the
        // caller didn't wire the feat bundles in.
        if (typeof featListFn === "function") {
          featListFn(featWrap, names, {
            selectedName: pending.featChoice,
            onSelect: (name) => { pending.featChoice = name; gridFn(); },
          });
        } else {
          selectableRowsFn(featWrap, names, {
            selectedName: pending.featChoice,
            getInfo: (name) => catalogInfoFn(["feat"], name),
            onSelect: (name) => { pending.featChoice = name; gridFn(); },
            collapsible: true,
          });
        }
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
      abilityIds.forEach((id) => { abilitySelect.append(el("option", { value: id, text: abilityLabelFor(id), title: abilityTooltip(id) ?? null })); });
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
    ...features.map((feature) => {
      const li = el("li", {}, el("strong", { text: feature.name }));
      if (feature.description) {
        li.append(document.createTextNode(" — "));
        li.append(...richAbilityNodes(humanizeGameText(capitalizeFirst(feature.description.trimStart()))));
      }
      return li;
    })));
}

export function renderGuideHpStepInto(container, pending, { conScore, dieSize, method }) {
  const conMod = conModFromScore(conScore);
  if (!pending.hp) {
    if (method === "average") pending.hp = String(averageHpOnce(dieSize, conMod));
    else if (method === "roll") pending.hp = String(rollHpOnce(dieSize, conMod));
  }

  // Show the HP math the same way the ability-scores step shows point
  // buy — the number should never look made up. In words rather than
  // arithmetic symbols, because "d10 ÷ 2, rounded up" is a formula, and a
  // player who cannot read the formula still needs to know what the number
  // is made of.
  const avg = method === "average" ? Math.floor(dieSize / 2) + 1 : 0;
  const conWord = `${conMod >= 0 ? "plus" : "minus"} ${Math.abs(conMod)}`;
  container.append(el("p", { class: "leveling-tab__intro", text: method === "average"
    ? `Your hit die is a d${dieSize}. Half of that, rounded up, is ${avg} — and your Constitution modifier is ${conMod >= 0 ? "+" : ""}${conMod}. Added together, this level adds ${avg + conMod} hit points.`
    : `Your hit die is a d${dieSize}, and your Constitution modifier is ${conMod >= 0 ? "+" : ""}${conMod}. Roll the die and ${conWord} that, so this level can add anywhere from ${1 + conMod} to ${dieSize + conMod} hit points. Type in whatever you rolled.` }));

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

/** The Notes page body. One optional box, and the label says so: nothing
 *  here is required, and a blank answer is a valid one rather than a
 *  skipped step. */
export function renderGuideNotesStepInto(container, pending) {
  const benefitsInput = el("textarea", {
    placeholder: "Anything else from your source book — leave blank if there isn't anything.",
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

/** Bumped only if the record's SHAPE changes incompatibly. Reverting a
 *  record written by a future version would silently do the wrong thing,
 *  so an unrecognised version is treated as no record at all. */
export const REVERT_RECORD_VERSION = 1;

/** The compact snapshot a level-up writes so it can be undone exactly.
 *
 *  Everything here is a BEFORE value, never a delta. Subtracting the HP
 *  gain back out works right up until somebody edits HP by hand after the
 *  level-up, at which point a subtraction quietly takes the wrong number
 *  while a restore puts back the number that was actually there. Restoring
 *  is also the only version that survives the level-up's own `+0` cases
 *  (a rolled 1 with a −5 CON modifier legitimately lands on 0).
 *
 *  Compact on purpose: only the scores the ASI actually moved, only the
 *  choice keys Apply overwrote, only the slot trackers it resized. A
 *  character levelling to 20 carries twenty of these.
 *
 *  Pure — returns a fresh record, mutating nothing. */
export function buildRevertRecord({
  level,
  hpGain = 0,
  hpBefore = {},
  abilities = {},
  featAdded = null,
  subclass = null,
  choicesBefore = {},
  slotsBefore = [],
  featureEntry = "",
  multiclassBefore = [],
  className = "",
  subclassName = "",
} = {}) {
  const record = {
    revertVersion: REVERT_RECORD_VERSION,
    level,
    hpGain,
    hpBefore: { max: hpBefore.max ?? null, current: hpBefore.current ?? null },
    // before AND after, never just one: `before` is what a revert restores
    // and `after` is what Apply left behind, and a hand edit shows up as
    // "neither of those" — which a single number cannot tell apart from an
    // ordinary re-rolled score.
    abilities: Object.fromEntries(Object.entries(abilities).map(([id, pair]) => [id, {
      before: pair.before,
      after: pair.after,
    }])),
    subclass,
    choicesBefore: Object.fromEntries(
      Object.entries(choicesBefore).map(([key, picks]) => [key, [...(picks || [])]])
    ),
    slotsBefore: slotsBefore.map((s) => ({ fieldId: s.fieldId, options: s.options })),
    featureEntry: featureEntry || "",
    multiclassBefore: multiclassBefore.map((e) => ({ ...e })),
  };
  // Only present when something was actually taken, so a level-up with no
  // feat doesn't carry an empty key that later reads as "a feat was added".
  if (featAdded) record.featAdded = featAdded;
  if (className) record.className = className;
  if (subclassName) record.subclassName = subclassName;
  return record;
}

/** The revert record on a level's entry, or null. A level recorded before
 *  reverting existed has no `revertVersion` and is simply not revertable —
 *  which is the case the Leveling tab explains in place of a button
 *  rather than offering one that cannot work. */
export function revertRecordFor(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (entry.revert?.revertVersion !== REVERT_RECORD_VERSION) return null;
  return entry.revert;
}

/** The highest level on this character that can actually be reverted, or
 *  null. Only the HIGHEST: reverting a lower one would leave the levels
 *  above it standing on a base that no longer includes it, and those
 *  levels' own records would then describe a character that never existed. */
export function highestRevertableLevel(levelUps = {}) {
  const levels = Object.keys(levelUps || {})
    .map((key) => Number(key))
    .filter((n) => Number.isFinite(n) && n >= 1 && revertRecordFor(levelUps[n]))
    .sort((a, b) => a - b);
  return levels.length ? levels[levels.length - 1] : null;
}

/** Plain-language lines for the revert dialog: what pressing it takes
 *  back. Pure. */
export function revertUndoLines(record) {
  if (!record) return [];
  const lines = [];
  if (record.hpGain) {
    lines.push(`Takes back ${record.hpGain} hit points (HP Max and HP Current both go back to what they were).`);
  }
  const bumped = Object.entries(record.abilities || {});
  if (bumped.length) {
    lines.push(`Puts your ability scores back: ${bumped.map(([id]) => id.toUpperCase()).join(", ")}.`);
  }
  if (record.featAdded) lines.push(`Removes the ${record.featAdded} feat.`);
  if (record.subclassName) lines.push(`Puts your subclass back to what it was (${record.subclassName === "" ? "none" : "your earlier pick"}).`);
  if (Object.keys(record.choicesBefore || {}).length) {
    lines.push(`Puts your choices back for ${Object.keys(record.choicesBefore).length} question(s) on this level.`);
  }
  if ((record.slotsBefore || []).length) {
    lines.push("Puts your spell slot counts back the way they were.");
  }
  if (record.featureEntry) lines.push(`Removes the "${record.featureEntry}" line from Features & Traits.`);
  if ((record.multiclassBefore || []).length) lines.push("Puts your multiclass levels back.");
  lines.push(`Drops your Level back to ${Math.max(1, (record.level ?? 1) - 1)} and forgets that this level was recorded.`);
  return lines;
}

/** Whether anything the level-up wrote has since been changed by hand, as
 *  one plain sentence per conflict (empty when the record still matches
 *  what Apply left behind).
 *
 *  Reverting restores BEFORE values, so a field edited since the level-up
 *  would have that edit thrown away without warning. Saying so is the
 *  difference between an undo and data loss.
 *
 *  Pure — reads the record and a snapshot of current state. */
export function revertConflictLines(record, current = {}) {
  if (!record) return [];
  const out = [];
  const gain = Number(record.hpGain) || 0;
  const { max, current: cur } = record.hpBefore || {};
  if (gain) {
    if (Number.isFinite(Number(current.hpMax)) && Number.isFinite(Number(max))
      && Number(current.hpMax) !== Number(max) + gain) {
      out.push("HP Max has been edited since this level was applied — reverting puts back the old value and loses that edit.");
    }
    if (Number.isFinite(Number(current.hpCurrent)) && Number.isFinite(Number(cur))
      && Number(current.hpCurrent) !== Number(cur) + gain) {
      out.push("HP Current has been edited since this level was applied — reverting puts back the old value and loses that edit.");
    }
  }
  for (const [id, pair] of Object.entries(record.abilities || {})) {
    const now = current.abilityScores?.[id];
    if (Number.isFinite(Number(now)) && Number(now) !== Number(pair.after)) {
      out.push(`${id.toUpperCase()} has been changed since this level was applied — reverting puts back ${pair.before}.`);
    }
  }
  if (record.featAdded && Array.isArray(current.feats) && !current.feats.some((f) => f?.name === record.featAdded)) {
    out.push(`The ${record.featAdded} feat is already gone from your sheet.`);
  }
  if (record.subclass && typeof current.subclassSelected !== "undefined"
    && current.subclassSelected !== record.subclass.after && current.subclassSelected !== record.subclass.before) {
    out.push("Your subclass has been changed since this level was applied — reverting puts back the earlier pick.");
  }
  for (const [key, before] of Object.entries(record.choicesBefore || {})) {
    const now = current.choices?.[key];
    if (Array.isArray(now) && JSON.stringify([...now].sort()) !== JSON.stringify([...before].sort())) {
      out.push(`Your answer to "${key}" has been changed since this level was applied — reverting puts back the old one.`);
    }
  }
  if (Array.isArray(current.multiclass)
    && JSON.stringify(current.multiclass) !== JSON.stringify(record.multiclassBefore || [])) {
    out.push("Your multiclass levels have been changed since this level was applied — reverting puts back the old ones.");
  }
  if (record.featureEntry && Array.isArray(current.featuresItems)
    && !current.featuresItems.includes(record.featureEntry)) {
    out.push(`The "${record.featureEntry}" line is no longer in Features & Traits — nothing to remove there.`);
  }
  return out;
}

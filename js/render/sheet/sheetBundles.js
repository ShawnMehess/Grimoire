// sheetBundles.js
//
// Bundle-library materialization helpers migrated from customSheet.js.
// A reusable library bundle names fields by label; applying it to one
// specific choice resolves each name against the character's actual
// fields (unmatched names are kept with a null target so they're
// visible to fix by hand, not silently dropped). All functions take
// explicit inputs — the renderer supplies newId + grant-name lookup.

import { contentIdMatches } from "../../data/dnd5e.js";

export function ensureBundleShape(choice) {
  if (!choice.bundle) choice.bundle = { statModifiers: [], dropdownAccess: [], featureGrants: [], resourceGrants: [], choiceGroups: [] };
  if (!choice.bundle.statModifiers) choice.bundle.statModifiers = [];
  if (!choice.bundle.dropdownAccess) choice.bundle.dropdownAccess = [];
  if (!choice.bundle.featureGrants) choice.bundle.featureGrants = [];
  if (!choice.bundle.resourceGrants) choice.bundle.resourceGrants = [];
  if (!choice.bundle.choiceGroups) choice.bundle.choiceGroups = [];
  return choice.bundle;
}

export function bundleIsEmptyShape(bundle) {
  return !bundle || ((bundle.statModifiers || []).length === 0 && (bundle.dropdownAccess || []).length === 0
    && (bundle.featureGrants || []).length === 0 && (bundle.resourceGrants || []).length === 0
    && (bundle.choiceGroups || []).length === 0);
}

/** Every skill/save proficiency checkbox shares the literal label
 *  "Prof." — the real name lives in a sibling Label/text field on the
 *  same row. Resolves a checkbox's effective name from its row;
 *  anything else is returned unchanged. Pure lookup, never mutates. */
export function effectiveGrantNameFor(field, globalBlocks = []) {
  const label = (field.label || "").trim();
  if (field.fieldType !== "checkbox" || label.toLowerCase() !== "prof.") return label;
  for (const block of globalBlocks) {
    if (!block.children || !block.children.includes(field)) continue;
    const sibling = block.children.find((f) => f !== field && f.y === field.y
      && (f.fieldType === "label" || f.fieldType === "text") && f.value);
    if (sibling) return sibling.value;
    break;
  }
  return label;
}

const normName = (s) => (s || "").trim().toLowerCase();

export function materializeStatModifier(mod, allFields, newIdFn, grantNameFn) {
  const wantType = mod.op === "grant" ? "checkbox" : "text";
  const match = allFields.find((f) => f.fieldType === wantType && normName(grantNameFn(f)) === normName(mod.targetFieldName));
  return {
    id: newIdFn(),
    targetFieldId: match ? match.id : null,
    targetIndex: mod.op === "grant" ? 0 : null,
    op: mod.op,
    value: mod.value,
    minLevel: Number.isFinite(mod.minLevel) ? mod.minLevel : null,
  };
}

export function materializeDropdownAccess(rule, allFields, newIdFn) {
  const targetField = allFields.find((f) => f.fieldType === "dropdown" && normName(f.label) === normName(rule.targetFieldName));
  let allowedChoiceIds = [];
  if (targetField) {
    const wanted = new Set((rule.allowedChoiceNames || []).map(normName));
    allowedChoiceIds = (targetField.choices || [])
      .filter((c) => wanted.has(normName(c.text)))
      .map((c) => c.id);
  }
  return {
    id: newIdFn(),
    targetFieldId: targetField ? targetField.id : null,
    allowedChoiceIds,
    minLevel: Number.isFinite(rule.minLevel) ? rule.minLevel : null,
  };
}

export function materializeFeatureGrant(grant, newIdFn) {
  return {
    id: newIdFn(),
    name: grant.name,
    description: grant.description || "",
    minLevel: Number.isFinite(grant.minLevel) ? grant.minLevel : null,
  };
}

export function materializeResourceGrant(grant, newIdFn) {
  return {
    id: newIdFn(),
    name: grant.name || "",
    maximum: Number.isFinite(grant.maximum) ? grant.maximum : 0,
    maximumFormula: grant.maximumFormula || null,
    reset: grant.reset || "rest",
    minLevel: Number.isFinite(grant.minLevel) ? grant.minLevel : null,
  };
}

export function materializeChoiceGroup(group, allFields, newIdFn, grantNameFn) {
  const materializeModifiers = (modifiers) => (modifiers || []).map((mod) => {
    const wantType = mod.op === "grant" ? "checkbox" : "text";
    const match = allFields.find((field) => field.fieldType === wantType && normName(grantNameFn(field)) === normName(mod.targetFieldName));
    return {
      id: newIdFn(),
      targetFieldId: match ? match.id : null,
      targetIndex: mod.op === "grant" ? 0 : null,
      op: mod.op,
      value: mod.value,
      minLevel: Number.isFinite(mod.minLevel) ? mod.minLevel : null,
    };
  });
  return {
    id: group.id || newIdFn(),
    label: group.label || "Choose an option",
    minLevel: Number.isFinite(group.minLevel) ? group.minLevel : null,
    minSelections: Number.isFinite(group.minSelections) ? group.minSelections : 0,
    maxSelections: Number.isFinite(group.maxSelections) ? group.maxSelections : 1,
    options: (group.options || []).map((option) => ({
      id: option.id || newIdFn(),
      name: option.name || "Unnamed option",
      description: option.description || "",
      statModifiers: materializeModifiers(option.statModifiers),
      featureGrants: (option.featureGrants || []).map((grant) => ({
        id: grant.id || newIdFn(),
        name: grant.name || "",
        description: grant.description || "",
        minLevel: Number.isFinite(grant.minLevel) ? grant.minLevel : null,
      })),
      resourceGrants: (option.resourceGrants || []).map((grant) => ({
        id: grant.id || newIdFn(),
        name: grant.name || "",
        maximum: Number.isFinite(grant.maximum) ? grant.maximum : 0,
        reset: grant.reset || "rest",
        minLevel: Number.isFinite(grant.minLevel) ? grant.minLevel : null,
      })),
    })),
  };
}

/** Applies a library entry onto a choice's bundle (additive — never
 *  replaces existing content). Tracks applied library ids so repeat
 *  runs don't stack duplicates. Returns false when skipped as a
 *  duplicate, true when applied. */
export function applyBundleLibraryToChoiceIn(bundle, libraryEntry, allFields, newIdFn, grantNameFn) {
  // Tracks which library entries have already been applied to this
  // choice (by library id, not name — a rename in the library
  // shouldn't cause a re-apply).
  if (!bundle.appliedLibraryIds) bundle.appliedLibraryIds = [];
  if (libraryEntry.id) {
    if (bundle.appliedLibraryIds.includes(libraryEntry.id)) return false;
    bundle.appliedLibraryIds.push(libraryEntry.id);
  }

  (libraryEntry.statModifiers || []).forEach((mod) => {
    bundle.statModifiers.push(materializeStatModifier(mod, allFields, newIdFn, grantNameFn));
  });

  (libraryEntry.dropdownAccess || []).forEach((rule) => {
    bundle.dropdownAccess.push(materializeDropdownAccess(rule, allFields, newIdFn));
  });

  // Feature grants are just display text (name + description) — unlike
  // statModifiers/dropdownAccess they don't target any field, so
  // there's no name-resolution step: copy straight through.
  (libraryEntry.featureGrants || []).forEach((grant) => {
    bundle.featureGrants.push(materializeFeatureGrant(grant, newIdFn));
  });

  (libraryEntry.resourceGrants || []).forEach((grant) => {
    bundle.resourceGrants.push(materializeResourceGrant(grant, newIdFn));
  });

  // Choice options use the same name-based library format as ordinary
  // modifiers. Resolve them once while attaching to a sheet so later
  // play only reads stable field ids, even if the library is edited.
  (libraryEntry.choiceGroups || []).forEach((group) => {
    bundle.choiceGroups.push(materializeChoiceGroup(group, allFields, newIdFn, grantNameFn));
  });
  return true;
}

// --- Choices-editor helpers ------------------------------------------------------
//
// Migration of MODIFIER_OPS + bulk-apply/sort helpers from
// customSheet.js's openDropdownChoicesEditor.

export const MODIFIER_OPS = [
  { value: "add", label: "+" },
  { value: "subtract", label: "−" },
  { value: "multiply", label: "×" },
  { value: "set", label: "=" },
];

export function alphaButtonState(autoAlphabetize) {
  return {
    text: autoAlphabetize ? "ABC↓" : "ABC?",
    title: autoAlphabetize
      ? "Auto-Alphabetize is on — click to turn off"
      : "Auto-Alphabetize is off — click to turn on",
  };
}

export function sortChoicesAlpha(choices) {
  choices.sort((a, b) => a.text.localeCompare(b.text));
  return choices;
}

/** Matches each choice's text to a same-named library bundle
 *  (case/whitespace-insensitive). Returns [{ choice, lib|null }] —
 *  the renderer applies matches inside its own commit and reports
 *  misses, so undo/save stay consistent. */
export function matchChoicesToLibrary(choices, libraryCache) {
  const norm = (s) => (s || "").trim().toLowerCase();
  return choices.map((choice) => ({
    choice,
    lib: libraryCache.find((entry) => norm(entry.name) === norm(choice.text)) || null,
  }));
}

export function bulkStatusText(applied, total, misses) {
  return misses.length
    ? `Applied ${applied}/${total}. No library match for: ${misses.join(", ")}`
    : `Applied ${applied}/${total}.`;
}

// --- Choice-row data ops + rows DOM -------------------------------------------------
//
// Migration of openDropdownChoicesEditor's renderRows/addChoice cores.
// Data ops are pure; renderChoiceRowsInto takes explicit deps:
//
//   renderChoiceRowsInto(list, field, {
//     expandedSet, commitFn, refreshSelectFn, rerenderFn,
//     bundleEmptyFn, modsPanelFn,
//   })

export function moveChoice(choices, fromIndex, toIndex) {
  if (fromIndex === null || fromIndex === undefined) return choices;
  if (fromIndex === toIndex) return choices;
  const [moved] = choices.splice(fromIndex, 1);
  choices.splice(toIndex, 0, moved);
  return choices;
}

export function removeChoiceIn(field, index) {
  const [removed] = field.choices.splice(index, 1);
  if (removed && field.selected === removed.id) field.selected = null;
  return removed || null;
}

export function addChoiceWithText(field, text, newIdFn) {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;
  const choice = { id: newIdFn(), text: trimmed, bundle: null };
  field.choices.push(choice);
  if (field.autoAlphabetize) sortChoicesAlpha(field.choices);
  return choice;
}

export function renderChoiceRowsInto(list, field, deps) {
  const { expandedSet, commitFn, refreshSelectFn, rerenderFn, bundleEmptyFn, modsPanelFn } = deps;
  let dragFromIndex = null;
  list.innerHTML = "";
  field.choices.forEach((choice, index) => {
    const row = document.createElement("div");
    row.className = "dropdown-choices-editor__row";
    row.draggable = !field.autoAlphabetize;

    row.addEventListener("dragstart", (e) => {
      dragFromIndex = index;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "");
    });
    row.addEventListener("dragover", (e) => {
      if (field.autoAlphabetize) return;
      e.preventDefault();
    });
    row.addEventListener("drop", (e) => {
      if (field.autoAlphabetize || dragFromIndex === null || dragFromIndex === index) return;
      e.preventDefault();
      commitFn(() => {
        moveChoice(field.choices, dragFromIndex, index);
      });
      rerenderFn();
      refreshSelectFn();
    });

    const handle = document.createElement("span");
    handle.className = "dropdown-choices-editor__handle";
    handle.textContent = field.autoAlphabetize ? "" : "⠿";

    const textEl = document.createElement("div");
    textEl.className = "dropdown-choices-editor__text";
    textEl.contentEditable = "true";
    textEl.textContent = choice.text;
    textEl.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
    textEl.addEventListener("input", () => {
      commitFn(() => { choice.text = textEl.textContent; });
      refreshSelectFn();
    });

    const modBtn = document.createElement("button");
    modBtn.type = "button";
    modBtn.className = "btn formula-toolbar__btn dropdown-choices-editor__mod-btn" +
      (!bundleEmptyFn(choice.bundle) ? " active" : "");
    modBtn.title = "Stat modifiers & dropdown access for this choice";
    modBtn.textContent = "⚙";
    modBtn.addEventListener("click", () => {
      if (expandedSet.has(choice.id)) expandedSet.delete(choice.id);
      else expandedSet.add(choice.id);
      rerenderFn();
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn formula-toolbar__btn";
    removeBtn.textContent = "✕";
    removeBtn.setAttribute("aria-label", "Remove");
    removeBtn.addEventListener("click", () => {
      commitFn(() => {
        removeChoiceIn(field, index);
      });
      rerenderFn();
      refreshSelectFn();
    });

    row.append(handle, textEl, modBtn, removeBtn);
    list.append(row);

    if (expandedSet.has(choice.id)) {
      list.append(modsPanelFn(field, choice));
    }
  });
}

// --- Modifiers panel DOM ----------------------------------------------------------
//
// Migration of renderModifiersPanel from customSheet.js: the expandable
// per-choice panel behind the gear button — stat modifiers + dropdown
// access rules ("a bundle").
//
//   renderModifiersPanelInto(field, choice, {
//     ensureBundleFn, textFields, grantableFields, dropdownFields,
//     libraryCache, commitFn, refreshFn, applyLibFn, grantNameFn,
//     modifierOps, newIdFn,
//   })

export function parseMinLevelInput(raw) {
  const n = Number(raw);
  return raw === "" || !Number.isFinite(n) ? null : n;
}

export function renderModifiersPanelInto(field, choice, deps) {
  const {
    ensureBundleFn,
    textFields,
    grantableFields,
    dropdownFields,
    libraryCache,
    commitFn,
    refreshFn,
    applyLibFn,
    grantNameFn,
    modifierOps,
    newIdFn,
  } = deps;
  const bundle = ensureBundleFn(choice);
  const panel = document.createElement("div");
  panel.className = "dropdown-choices-editor__mods";

  // --- Apply from Library ---
  const libraryHeader = document.createElement("div");
  libraryHeader.className = "dropdown-choices-editor__mods-header";
  libraryHeader.textContent = "Apply from Library";
  panel.append(libraryHeader);

  const libraryRow = document.createElement("div");
  libraryRow.className = "bundle-mod-row";
  const librarySelect = document.createElement("select");
  const blankLibOpt = document.createElement("option");
  blankLibOpt.value = "";
  blankLibOpt.textContent = libraryCache.length ? "Choose a bundle…" : "No bundles saved yet";
  librarySelect.append(blankLibOpt);
  libraryCache.forEach((lib) => {
    const opt = document.createElement("option");
    opt.value = lib.id;
    opt.textContent = lib.category ? `${lib.name} (${lib.category})` : lib.name;
    librarySelect.append(opt);
  });
  const applyLibBtn = document.createElement("button");
  applyLibBtn.type = "button";
  applyLibBtn.className = "btn formula-toolbar__btn";
  applyLibBtn.textContent = "+ Apply";
  applyLibBtn.title = "Adds this bundle's rules on top of whatever's already here — it doesn't replace them";
  applyLibBtn.addEventListener("click", () => {
    const lib = libraryCache.find((l) => l.id === librarySelect.value);
    if (!lib) return;
    commitFn(() => {
      applyLibFn(lib, choice);
    });
    refreshFn();
  });
  libraryRow.append(librarySelect, applyLibBtn);
  panel.append(libraryRow);

  // --- Stat modifiers ---
  const statHeader = document.createElement("div");
  statHeader.className = "dropdown-choices-editor__mods-header";
  statHeader.textContent = "Stat Modifiers";
  panel.append(statHeader);

  bundle.statModifiers.forEach((mod, i) => {
    const row = document.createElement("div");
    row.className = "bundle-mod-row";

    const targetSelect = document.createElement("select");
    const blankOpt = document.createElement("option");
    blankOpt.value = "";
    blankOpt.textContent = mod.op === "grant" ? "Choose a proficiency…" : "Choose a stat…";
    targetSelect.append(blankOpt);
    const targetFieldPool = mod.op === "grant" ? grantableFields : textFields;
    targetFieldPool.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.id;
      // A checkbox's raw label is "Prof." for every skill/save row —
      // grantNameFn resolves the row's real name so this dropdown
      // doesn't show "Prof." 24 times.
      opt.textContent = (mod.op === "grant" ? grantNameFn(f) : f.label) || "Stat";
      if (f.id === mod.targetFieldId) opt.selected = true;
      targetSelect.append(opt);
    });
    targetSelect.addEventListener("change", () => {
      commitFn(() => { mod.targetFieldId = targetSelect.value || null; });
    });

    const opSelect = document.createElement("select");
    modifierOps.forEach(({ value, label }) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      if (value === mod.op) opt.selected = true;
      opSelect.append(opt);
    });
    opSelect.addEventListener("change", () => {
      // Switching op also switches which field POOL the target
      // select offers (stats vs. proficiencies) — the old
      // targetFieldId almost never makes sense in the new pool, so
      // clear it rather than leave a stale, invisible reference.
      commitFn(() => {
        mod.op = opSelect.value;
        mod.targetFieldId = null;
        if (mod.op === "grant") mod.targetIndex = 0;
      });
      refreshFn();
    });

    const minLevelInput = document.createElement("input");
    minLevelInput.type = "number";
    minLevelInput.title = "Min level (blank = always active)";
    minLevelInput.placeholder = "Lvl";
    minLevelInput.className = "bundle-mod-row__level";
    minLevelInput.value = Number.isFinite(mod.minLevel) ? mod.minLevel : "";
    minLevelInput.addEventListener("input", () => {
      commitFn(() => { mod.minLevel = parseMinLevelInput(minLevelInput.value); });
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn formula-toolbar__btn";
    removeBtn.textContent = "✕";
    removeBtn.setAttribute("aria-label", "Remove modifier");
    removeBtn.addEventListener("click", () => {
      commitFn(() => { bundle.statModifiers.splice(i, 1); });
      refreshFn();
    });

    row.append(targetSelect, opSelect);
    if (mod.op !== "grant") {
      const valueInput = document.createElement("input");
      valueInput.type = "number";
      valueInput.value = Number.isFinite(mod.value) ? mod.value : 0;
      valueInput.addEventListener("input", () => {
        commitFn(() => { mod.value = Number(valueInput.value) || 0; });
      });
      row.append(valueInput);
    }
    row.append(minLevelInput, removeBtn);
    panel.append(row);
  });

  const addModBtn = document.createElement("button");
  addModBtn.type = "button";
  addModBtn.className = "btn formula-toolbar__btn";
  addModBtn.textContent = "+ Add Modifier";
  addModBtn.addEventListener("click", () => {
    commitFn(() => {
      bundle.statModifiers.push({ id: newIdFn(), targetFieldId: null, op: "add", value: 0, minLevel: null });
    });
    refreshFn();
  });
  panel.append(addModBtn);

  // --- Dropdown access ---
  const accessHeader = document.createElement("div");
  accessHeader.className = "dropdown-choices-editor__mods-header";
  accessHeader.textContent = "Dropdown Access";
  panel.append(accessHeader);

  bundle.dropdownAccess.forEach((rule, i) => {
    const ruleWrap = document.createElement("div");
    ruleWrap.className = "bundle-access-rule";

    const targetRow = document.createElement("div");
    targetRow.className = "bundle-mod-row";
    const targetSelect = document.createElement("select");
    const blankOpt = document.createElement("option");
    blankOpt.value = "";
    blankOpt.textContent = "Choose a dropdown…";
    targetSelect.append(blankOpt);
    dropdownFields.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.label || "Dropdown";
      if (f.id === rule.targetFieldId) opt.selected = true;
      targetSelect.append(opt);
    });
    targetSelect.addEventListener("change", () => {
      commitFn(() => {
        rule.targetFieldId = targetSelect.value || null;
        rule.allowedChoiceIds = [];
      });
      refreshFn();
    });
    const minLevelInput = document.createElement("input");
    minLevelInput.type = "number";
    minLevelInput.title = "Min level (blank = always active)";
    minLevelInput.placeholder = "Lvl";
    minLevelInput.className = "bundle-mod-row__level";
    minLevelInput.value = Number.isFinite(rule.minLevel) ? rule.minLevel : "";
    minLevelInput.addEventListener("input", () => {
      commitFn(() => { rule.minLevel = parseMinLevelInput(minLevelInput.value); });
    });
    const removeRuleBtn = document.createElement("button");
    removeRuleBtn.type = "button";
    removeRuleBtn.className = "btn formula-toolbar__btn";
    removeRuleBtn.textContent = "✕";
    removeRuleBtn.setAttribute("aria-label", "Remove rule");
    removeRuleBtn.addEventListener("click", () => {
      commitFn(() => { bundle.dropdownAccess.splice(i, 1); });
      refreshFn();
    });
    targetRow.append(targetSelect, minLevelInput, removeRuleBtn);
    ruleWrap.append(targetRow);

    const targetField = dropdownFields.find((f) => f.id === rule.targetFieldId);
    if (targetField) {
      const checklist = document.createElement("div");
      checklist.className = "bundle-access-checklist";
      (targetField.choices || []).forEach((targetChoice) => {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = (rule.allowedChoiceIds || []).includes(targetChoice.id);
        checkbox.addEventListener("change", () => {
          commitFn(() => {
            const set = new Set(rule.allowedChoiceIds || []);
            if (checkbox.checked) set.add(targetChoice.id);
            else set.delete(targetChoice.id);
            rule.allowedChoiceIds = [...set];
          });
        });
        label.append(checkbox, document.createTextNode(" " + targetChoice.text));
        checklist.append(label);
      });
      ruleWrap.append(checklist);
    }

    panel.append(ruleWrap);
  });

  const addAccessBtn = document.createElement("button");
  addAccessBtn.type = "button";
  addAccessBtn.className = "btn formula-toolbar__btn";
  addAccessBtn.textContent = "+ Add Dropdown Rule";
  addAccessBtn.addEventListener("click", () => {
    commitFn(() => {
      bundle.dropdownAccess.push({ id: newIdFn(), targetFieldId: null, allowedChoiceIds: [], minLevel: null });
    });
    refreshFn();
  });
  panel.append(addAccessBtn);

  return panel;
}

// --- Ruleset sync ---------------------------------------------------------------
//
// Migration of syncRulesetBundles / syncRulesToSheet data cores from
// customSheet.js. Matching is pure; the renderer applies + saves.

export function rulesetBundleMatches(allFields, rulesetBundles) {
  const norm = (s) => (s || "").trim().toLowerCase();
  const matches = [];
  allFields.forEach((field) => {
    if (field.fieldType !== "dropdown") return;
    (field.choices || []).forEach((choice) => {
      const lib = rulesetBundles.find((entry) => norm(entry.name) === norm(choice.text));
      if (lib) matches.push({ field, choice, lib });
    });
  });
  return matches;
}

export function syncResultMessage(applied, hasBundles) {
  if (!hasBundles) return "No bundles are tagged for this ruleset yet — import some from the Bundle Libraries manager first.";
  return applied > 0
    ? `Wired up ${applied} choice${applied === 1 ? "" : "s"} from this ruleset's bundles.`
    : "Everything from this ruleset's bundles was already applied.";
}

/** Select-or-create: points a dropdown at the choice named `value`,
 *  creating the choice when the sheet doesn't have one yet. */
export function chooseTargetValue(target, value, newIdFn) {
  if (!target || !value) return null;
  let choice = target.choices?.find((entry) => entry.text === value);
  if (!choice && Array.isArray(target.choices)) {
    choice = { id: newIdFn(), text: value, statModifiers: [] };
    target.choices.push(choice);
  }
  if (choice) target.selected = choice.id;
  return choice || null;
}

/** Migrates Setup-wizard temporary choice keys
 *  (creation:<category>:<name>:<groupId>) to real keys
 *  (<fieldId>:<choiceId>:<groupId>) once fields are selected. */
export function migrateCreationChoiceKeys(pairs, choices) {
  pairs.forEach(([category, target, name]) => {
    if (!target || !name) return;
    const choice = target.choices?.find((c) => c.id === target.selected);
    (choice?.bundle?.choiceGroups || []).forEach((group, index) => {
      const oldKey = `creation:${category}:${name}:${group.id || index}`;
      const newKey = `${target.id}:${choice.id}:${group.id || index}`;
      if (choices[oldKey] && !choices[newKey]) {
        choices[newKey] = choices[oldKey];
        delete choices[oldKey];
      }
    });
  });
  return choices;
}

export function matchLibraryForChosen(targets, libraryCache, rulesetId) {
  const norm = (s) => (s || "").trim().toLowerCase();
  return targets
    .map((target) => {
      if (!target) return null;
      const choice = target.choices?.find((c) => c.id === target.selected);
      if (!choice) return null;
      const lib = libraryCache.find((entry) => contentIdMatches(entry.rulesetId, rulesetId) && norm(entry.name) === norm(choice.text));
      return lib ? { target, choice, lib } : null;
    })
    .filter(Boolean);
}

// --- Choices editor shell ----------------------------------------------------------
//
// Full migration of openDropdownChoicesEditor from customSheet.js:
// popover shell for managing a dropdown field's choice list (add,
// remove, drag to reorder, auto-alphabetize, bulk library apply).
// Session-local editing uses {render:false} + local refresh so
// multi-step edits aren't interrupted; sheet-wide effects catch up on
// popover close. Takes explicit deps (no sheet closure):
//
//   openChoicesEditorInto(field, wrapperEl, {
//     closeFn, populateSelectFn, commitFn, positionFn, setOpenPopup,
//     libraryCache, applyLibFn, flattenFieldsFn, newIdFn,
//     bundleEmptyFn, panelBase /* static panel deps minus commit/refresh */,
//   })

export function openChoicesEditorInto(field, wrapperEl, deps) {
  const {
    closeFn,
    populateSelectFn,
    commitFn,
    positionFn,
    setOpenPopup,
    libraryCache,
    applyLibFn,
    flattenFieldsFn,
    newIdFn,
    bundleEmptyFn,
    panelBase,
  } = deps;
  closeFn();
  if (!field.choices) field.choices = [];
  // Set of choice ids whose "Modifiers" accordion is currently open —
  // survives renderRows() re-renders within this popover session.
  const expanded = new Set();

  const pop = document.createElement("div");
  pop.className = "style-popover dropdown-choices-editor";
  pop.addEventListener("pointerdown", (e) => e.stopPropagation());

  const title = document.createElement("div");
  title.className = "style-popover__badge";
  title.textContent = "Dropdown Choices";
  pop.append(title);

  function refreshFieldSelect() {
    const select = wrapperEl.querySelector("select.field-value");
    if (select) populateSelectFn(select, field);
  }

  const alphaRow = document.createElement("div");
  alphaRow.className = "dropdown-choices-editor__alpha-row";
  const alphaLabel = document.createElement("span");
  alphaLabel.textContent = "Alphabetize";
  const alphaBtn = document.createElement("button");
  alphaBtn.type = "button";
  function paintAlphaBtn() {
    const state = alphaButtonState(field.autoAlphabetize);
    alphaBtn.textContent = state.text;
    alphaBtn.title = state.title;
    alphaBtn.className = "btn dropdown-choices-editor__alpha" + (field.autoAlphabetize ? " active" : "");
  }
  paintAlphaBtn();
  alphaBtn.addEventListener("click", () => {
    commitFn(() => {
      field.autoAlphabetize = !field.autoAlphabetize;
      if (field.autoAlphabetize) sortChoicesAlpha(field.choices);
    }, { render: false });
    paintAlphaBtn();
    renderRows();
    refreshFieldSelect();
  });
  alphaRow.append(alphaLabel, alphaBtn);
  pop.append(alphaRow);

  // --- Bulk Apply from Library ---
  // Wires an entire imported list to this field's choices in one
  // click, matching purely by name. Choices that already have
  // something applied still get the bundle layered on top — safe to
  // click again after a fresh import without duplicating anything.
  const bulkRow = document.createElement("div");
  bulkRow.className = "dropdown-choices-editor__alpha-row";
  const bulkBtn = document.createElement("button");
  bulkBtn.type = "button";
  bulkBtn.className = "btn dropdown-choices-editor__alpha";
  bulkBtn.textContent = "Bulk Apply from Library";
  bulkBtn.title = "Matches each choice's text to a same-named bundle in your library and applies it to all of them at once";
  const bulkStatus = document.createElement("span");
  bulkStatus.className = "dropdown-choices-editor__bulk-status";
  bulkBtn.addEventListener("click", () => {
    let applied = 0;
    const misses = [];
    commitLocal(() => {
      matchChoicesToLibrary(field.choices, libraryCache).forEach(({ choice, lib }) => {
        if (lib) {
          applyLibFn(lib, choice, flattenFieldsFn());
          applied++;
        } else {
          misses.push(choice.text);
        }
      });
    });
    bulkStatus.textContent = bulkStatusText(applied, field.choices.length, misses);
    renderRows();
    refreshFieldSelect();
  });
  bulkRow.append(bulkBtn, bulkStatus);
  pop.append(bulkRow);

  const list = document.createElement("div");
  list.className = "dropdown-choices-editor__list";
  pop.append(list);

  /** Every edit in this whole popover uses {render:false} and
   *  refreshes just this popover's own DOM rather than a full page
   *  render, so a multi-step edit doesn't get interrupted or lose
   *  its accordion state along the way. */
  function commitLocal(mutator) {
    commitFn(mutator, { render: false });
  }

  function renderRows() {
    const allFields = flattenFieldsFn();
    renderChoiceRowsInto(list, field, {
      expandedSet: expanded,
      commitFn: (fn) => commitLocal(fn),
      refreshSelectFn: () => refreshFieldSelect(),
      rerenderFn: () => renderRows(),
      bundleEmptyFn,
      modsPanelFn: (f, choice) => renderModifiersPanelInto(f, choice, {
        ...panelBase,
        textFields: allFields.filter((x) => x.fieldType === "text"),
        // Single-option checkboxes only — the proficiency-marker
        // convention. A "grant" always targets index 0.
        grantableFields: allFields.filter((x) => x.fieldType === "checkbox" && x.options === 1),
        // Excludes this same field — a dropdown restricting its own
        // choices based on its own selection doesn't make sense.
        dropdownFields: allFields.filter((x) => x.fieldType === "dropdown" && x.id !== f.id),
        libraryCache,
        commitFn: (fn) => commitLocal(fn),
        refreshFn: () => renderRows(),
        applyLibFn: (lib, c) => applyLibFn(lib, c, flattenFieldsFn()),
      }),
    });
  }
  renderRows();

  const addRow = document.createElement("div");
  addRow.className = "dropdown-choices-editor__add";
  const addInput = document.createElement("input");
  addInput.type = "text";
  addInput.placeholder = "New choice…";
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn";
  addBtn.textContent = "+ Add";
  function addChoice() {
    const added = { choice: null };
    commitLocal(() => {
      added.choice = addChoiceWithText(field, addInput.value, newIdFn);
    });
    if (!added.choice) return;
    addInput.value = "";
    renderRows();
    refreshFieldSelect();
    addInput.focus();
  }
  addBtn.addEventListener("click", addChoice);
  addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addChoice(); } });
  addRow.append(addInput, addBtn);
  pop.append(addRow);

  wrapperEl.append(pop);
  positionFn(pop);
  setOpenPopup(wrapperEl.querySelector(".node-toolbar"));
}

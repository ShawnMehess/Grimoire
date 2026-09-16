// sheetToolbar.js
//
// Toolbar building blocks extracted from customSheet.js.
// Pure DOM builders take explicit args (no sheet closure). Stateful
// wiring (commitMutation, renderAll, saveWithStatus) stays in
// customSheet.js for now — it calls these helpers so chip/drop/toast
// logic lives in exactly one place.

export function parseFieldDropPayload(e) {
  const payload = e.dataTransfer?.getData("application/x-sheet-field");
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    if (!parsed.fieldId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function acceptsFieldDrop(e) {
  return Boolean(
    e.dataTransfer &&
    Array.from(e.dataTransfer.types || []).includes("application/x-sheet-field")
  );
}

export function buildHint(text) {
  const hint = document.createElement("span");
  hint.className = "identity-card-fields__hint";
  hint.textContent = text;
  return hint;
}

export function buildChip({ label, missing = false, removeTitle, removeAriaLabel }) {
  const chip = document.createElement("span");
  chip.className = "identity-card-fields__chip" + (missing ? " identity-card-fields__chip--missing" : "");
  chip.append(document.createTextNode(label));
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.title = removeTitle;
  removeBtn.textContent = "✕";
  removeBtn.setAttribute("aria-label", removeAriaLabel);
  chip.append(removeBtn);
  return { chip, removeBtn };
}

export function buildToolbarShell() {
  const toolbar = document.createElement("div");
  toolbar.className = "sheet-toolbar";

  const leftGroup = document.createElement("div");
  leftGroup.className = "sheet-toolbar__group";

  const modeBtn = document.createElement("button");
  modeBtn.type = "button";
  modeBtn.className = "btn btn--primary";
  modeBtn.textContent = "Customize Sheet";

  const undoBtn = document.createElement("button");
  undoBtn.type = "button";
  undoBtn.className = "btn";
  undoBtn.textContent = "Undo";
  undoBtn.disabled = true;

  const redoBtn = document.createElement("button");
  redoBtn.type = "button";
  redoBtn.className = "btn";
  redoBtn.textContent = "Redo";
  redoBtn.disabled = true;

  const addBlockBtn = document.createElement("button");
  addBlockBtn.type = "button";
  addBlockBtn.className = "btn";
  addBlockBtn.textContent = "+ Block";
  addBlockBtn.style.display = "none";

  leftGroup.append(modeBtn, undoBtn, redoBtn, addBlockBtn);
  toolbar.append(leftGroup);
  return { toolbar, leftGroup, modeBtn, undoBtn, redoBtn, addBlockBtn };
}

export function buildNameInput(initialValue) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "input-group__control";
  input.style.maxWidth = "220px";
  input.placeholder = "Character name";
  input.value = initialValue || "";
  return input;
}

export function buildRulesetSelect(rulesets, currentId) {
  const select = document.createElement("select");
  select.className = "input-group__control";
  select.style.maxWidth = "220px";
  select.title = "Ruleset used for guided leveling";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose ruleset";
  select.append(placeholder);
  rulesets.forEach((ruleset) => {
    const option = document.createElement("option");
    option.value = ruleset.id;
    option.textContent = ruleset.name;
    select.append(option);
  });
  select.value = currentId || "";
  return select;
}

export function buildStatusEl() {
  const statusEl = document.createElement("span");
  statusEl.className = "save-status";
  return statusEl;
}

export function showToastIn(root, message, { isError = false } = {}) {
  const toast = document.createElement("div");
  toast.className = "sheet-toast" + (isError ? " sheet-toast--error" : "");
  toast.textContent = message;
  toast.setAttribute("role", "status");
  root.append(toast);
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 200);
  }, 5000);
}

export function createSaveController({ statusEl, store, characterId, onSaved, onFailed }) {
  return function saveWithStatus(fieldId, value) {
    statusEl.textContent = "Saving…";
    statusEl.style.color = "";
    store.saveCharacterField(characterId, fieldId, value)
      .then(() => {
        statusEl.textContent = "Saved";
        if (onSaved) onSaved();
      })
      .catch((err) => {
        console.error(`Failed to save "${fieldId}":`, err);
        statusEl.textContent = "⚠ Save failed — see console";
        statusEl.style.color = "var(--color-negative)";
        if (onFailed) onFailed(err);
      });
  };
}

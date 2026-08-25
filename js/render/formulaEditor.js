// formulaEditor.js
//
// The modal opened by a field's "=" hint. Lets you build a formula
// tree (see js/data/formula.js for the shape) by typing math/
// comparison text and dragging in other fields (from the sidebar,
// via the same "application/x-sheet-field" drag payload the page grid
// already uses) as variable "chips".
//
// Each expression/condition box is a contentEditable div rather than
// a plain <textarea>, specifically so a dropped field can render as
// an inline, non-editable chip (contentEditable="false" nested inside
// a contentEditable="true" container — the same pattern mention/tag
// inputs use elsewhere on the web) instead of a bare {{id}} token the
// user would have to read past. The chip IS the token: on save we walk
// the DOM and turn each chip back into a {{fieldId}} /
// {{fieldId::checkboxIndex}} placeholder for storage; on reopen we do
// the reverse, re-resolving each id against the CURRENT field list so
// a renamed field's chip always shows its latest label, and a deleted
// field's chip shows as visibly broken instead of silently vanishing.

import { FUNCTION_NAMES } from "../data/formula.js";

const COMPARATOR_BUTTONS = ["=", "!=", "<=", "<", ">=", ">", " AND ", " OR ", " XOR "];

function debounce(fn, delayMs) {
  let handle;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), delayMs);
  };
}

function deepClone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function makeChip(field, checkboxIndex) {
  const chip = document.createElement("span");
  chip.className = "formula-chip";
  chip.contentEditable = "false";
  chip.dataset.fieldId = field.id;
  if (checkboxIndex !== null && checkboxIndex !== undefined) {
    chip.dataset.checkboxIndex = String(checkboxIndex);
    chip.textContent = `${field.label || "Field"} ${checkboxIndex + 1}`;
  } else {
    chip.textContent = field.label || "Field";
  }
  return chip;
}

/** DOM (chips + text) -> stored token string. */
function serializeEditable(el) {
  let out = "";
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("formula-chip")) {
      const idx = node.dataset.checkboxIndex;
      out += idx !== undefined ? `{{${node.dataset.fieldId}::${idx}}}` : `{{${node.dataset.fieldId}}}`;
    } else {
      out += node.textContent || "";
    }
  });
  return out;
}

/** Stored token string -> DOM (chips + text), resolving each chip
 *  against the CURRENT field list so renames/deletions stay honest. */
function renderTokensIntoEditable(el, text, resolveField) {
  el.innerHTML = "";
  const str = text || "";
  const re = /\{\{([^:}]+)(?:::(\d+))?\}\}/g;
  let lastIndex = 0;
  let match;
  while ((match = re.exec(str))) {
    if (match.index > lastIndex) {
      el.append(document.createTextNode(str.slice(lastIndex, match.index)));
    }
    const fieldId = match[1];
    const idx = match[2] !== undefined ? Number(match[2]) : null;
    const field = resolveField(fieldId);
    if (field) {
      el.append(makeChip(field, idx));
    } else {
      const chip = document.createElement("span");
      chip.className = "formula-chip formula-chip--missing";
      chip.contentEditable = "false";
      chip.dataset.fieldId = fieldId;
      if (idx !== null) chip.dataset.checkboxIndex = String(idx);
      chip.textContent = "deleted field";
      el.append(chip);
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < str.length) {
    el.append(document.createTextNode(str.slice(lastIndex)));
  }
}

function insertTextAtCaret(editableEl, text, caretOffsetFromEnd = 0) {
  editableEl.focus();
  const sel = window.getSelection();
  let range;
  if (sel && sel.rangeCount > 0 && editableEl.contains(sel.anchorNode)) {
    range = sel.getRangeAt(0);
  } else {
    range = document.createRange();
    range.selectNodeContents(editableEl);
    range.collapse(false);
  }
  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  const caretPos = Math.max(0, Math.min(text.length, text.length + caretOffsetFromEnd));
  const newRange = document.createRange();
  newRange.setStart(textNode, caretPos);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

function insertNodeAtDropPoint(editableEl, dropEvent, node) {
  editableEl.focus();
  let range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(dropEvent.clientX, dropEvent.clientY);
  } else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(dropEvent.clientX, dropEvent.clientY);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
    }
  }
  if (!range || !editableEl.contains(range.startContainer)) {
    range = document.createRange();
    range.selectNodeContents(editableEl);
    range.collapse(false);
  }
  range.collapse(true);
  range.insertNode(node);
  const after = document.createRange();
  after.setStartAfter(node);
  after.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(after);
}

function wireVariableDrop(editableEl, resolveField, afterInsert) {
  editableEl.addEventListener("dragover", (e) => {
    if (e.dataTransfer.types.includes("application/x-sheet-field")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });
  editableEl.addEventListener("drop", (e) => {
    const payload = e.dataTransfer.getData("application/x-sheet-field");
    if (!payload) return;
    e.preventDefault();
    let parsed;
    try { parsed = JSON.parse(payload); } catch { return; }
    const field = resolveField(parsed.fieldId);
    if (!field) return;
    insertNodeAtDropPoint(editableEl, e, makeChip(field, parsed.checkboxIndex));
    afterInsert();
  });
}

function makeEditableField(initialText, resolveField, onChange) {
  const el = document.createElement("div");
  el.className = "formula-input";
  el.contentEditable = "true";
  el.spellcheck = false;
  renderTokensIntoEditable(el, initialText, resolveField);
  el.addEventListener("input", onChange);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault(); // single-line
  });
  wireVariableDrop(el, resolveField, onChange);
  return el;
}

/**
 * @param field         the field whose formula is being edited
 * @param resolveField  (id) => field object or null, for chip labels/drop lookups
 * @param onChange       (formulaTreeOrNull) => void — called (debounced) whenever
 *                        the tree changes, or immediately with null on Clear
 */
export function openFormulaEditor(field, resolveField, onChange) {
  let working = field.formula ? deepClone(field.formula) : { type: "expr", text: "" };
  const commitDebounced = debounce(() => onChange(deepClone(working)), 350);

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const box = document.createElement("div");
  box.className = "modal-box modal-box--formula";
  box.addEventListener("click", (e) => e.stopPropagation());

  const title = document.createElement("h3");
  title.textContent = `Formula for "${field.label || "Field"}"`;
  box.append(title);

  const hint = document.createElement("p");
  hint.className = "modal-copy";
  hint.textContent = "Drag stat fields in from the list on the left to use them as variables. Numbers, + − × ÷, parentheses, and the functions below all work.";
  box.append(hint);

  const body = document.createElement("div");
  body.className = "formula-editor-body";
  box.append(body);

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "btn btn--danger";
  clearBtn.textContent = "Clear formula";
  clearBtn.addEventListener("click", () => { onChange(null); close(); });
  const doneBtn = document.createElement("button");
  doneBtn.type = "button";
  doneBtn.className = "btn btn--primary";
  doneBtn.textContent = "Done";
  doneBtn.addEventListener("click", close);
  actions.append(clearBtn, doneBtn);
  box.append(actions);

  function close() { overlay.remove(); }

  function renderFormulaSlot(container, node, setNode) {
    container.innerHTML = "";
    const replace = (newNode) => {
      setNode(newNode);
      renderFormulaSlot(container, newNode, setNode);
      commitDebounced();
    };
    if (node.type === "if") {
      container.append(renderIfNode(node, replace));
    } else {
      container.append(renderLeafNode(node, replace));
    }
  }

  function renderLeafNode(node, replaceSelf) {
    const wrap = document.createElement("div");
    wrap.className = "formula-leaf";

    const editable = makeEditableField(node.text, resolveField, () => {
      node.text = serializeEditable(editable);
      commitDebounced();
    });

    const fnRow = document.createElement("div");
    fnRow.className = "formula-toolbar";
    FUNCTION_NAMES.forEach((name) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn formula-toolbar__btn";
      btn.textContent = `${name}()`;
      btn.addEventListener("click", () => {
        insertTextAtCaret(editable, `${name}()`, -1);
        node.text = serializeEditable(editable);
        commitDebounced();
      });
      fnRow.append(btn);
    });

    const addCondBtn = document.createElement("button");
    addCondBtn.type = "button";
    addCondBtn.className = "btn formula-toolbar__btn";
    addCondBtn.textContent = "+ Condition";
    addCondBtn.addEventListener("click", () => {
      replaceSelf({
        type: "if",
        condition: "",
        whenTrue: { type: "expr", text: node.text },
        whenFalse: { type: "expr", text: "" },
      });
    });

    wrap.append(fnRow, editable, addCondBtn);
    return wrap;
  }

  function renderIfNode(node, replaceSelf) {
    const wrap = document.createElement("div");
    wrap.className = "formula-if";

    const condLabel = document.createElement("label");
    condLabel.textContent = "If";
    wrap.append(condLabel);

    const condEditable = makeEditableField(node.condition, resolveField, () => {
      node.condition = serializeEditable(condEditable);
      commitDebounced();
    });

    const condRow = document.createElement("div");
    condRow.className = "formula-toolbar";
    COMPARATOR_BUTTONS.forEach((sym) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn formula-toolbar__btn";
      btn.textContent = sym.trim();
      btn.addEventListener("click", () => {
        insertTextAtCaret(condEditable, sym, 0);
        node.condition = serializeEditable(condEditable);
        commitDebounced();
      });
      condRow.append(btn);
    });
    wrap.append(condRow, condEditable);

    const removeCondBtn = document.createElement("button");
    removeCondBtn.type = "button";
    removeCondBtn.className = "btn formula-toolbar__btn";
    removeCondBtn.textContent = "− Remove condition";
    removeCondBtn.addEventListener("click", () => {
      replaceSelf({ type: "expr", text: (node.whenTrue && node.whenTrue.text) || "" });
    });
    wrap.append(removeCondBtn);

    const trueLabel = document.createElement("div");
    trueLabel.className = "formula-branch-label";
    trueLabel.textContent = "If true:";
    const trueSlot = document.createElement("div");
    trueSlot.className = "formula-branch";
    wrap.append(trueLabel, trueSlot);
    renderFormulaSlot(trueSlot, node.whenTrue, (n) => { node.whenTrue = n; });

    const falseLabel = document.createElement("div");
    falseLabel.className = "formula-branch-label";
    falseLabel.textContent = "If false:";
    const falseSlot = document.createElement("div");
    falseSlot.className = "formula-branch";
    wrap.append(falseLabel, falseSlot);
    renderFormulaSlot(falseSlot, node.whenFalse, (n) => { node.whenFalse = n; });

    return wrap;
  }

  renderFormulaSlot(body, working, (n) => { working = n; });

  overlay.append(box);
  document.body.append(overlay);
}

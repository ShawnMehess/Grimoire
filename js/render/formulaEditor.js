// formulaEditor.js
//
// The floating panel opened by a field's "=" hint. Lets you build a
// formula tree (see js/data/formula.js for the shape) by typing math/
// comparison text and dragging in other fields (from the sidebar, via
// the same "application/x-sheet-field" drag payload the page grid
// already uses) as variable "chips". Deliberately NOT a full-screen
// modal — see the .formula-overlay comment in custom-sheet.css — so
// the sidebar stays draggable-from while this is open.
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
//
// Clicking a function button inserts a GHOSTED template, e.g.
// "sqrt(x)" — the "x" is a placeholder span: clicking it selects its
// whole contents so the next keystroke replaces it outright, and the
// first ghost in a freshly-inserted template is pre-selected the same
// way. A ghost still showing its placeholder text when the formula is
// saved contributes NOTHING to the stored expression (as if that
// argument were just left blank) rather than the literal word "x".

import { FUNCTION_NAMES, FUNCTION_PARAMS, validateExpression, validateCondition } from "../data/formula.js";

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

function makeGhost(text) {
  const span = document.createElement("span");
  span.className = "formula-ghost";
  span.dataset.ghostText = text;
  span.textContent = text;
  return span;
}

/** name() -> a run of nodes ["name(", ghost, ", ", ghost, ")"] ready
 *  to insert at the caret. */
function buildFunctionTemplate(name) {
  const params = FUNCTION_PARAMS[name] || [];
  const nodes = [document.createTextNode(`${name}(`)];
  params.forEach((p, i) => {
    if (i > 0) nodes.push(document.createTextNode(", "));
    nodes.push(makeGhost(p));
  });
  nodes.push(document.createTextNode(")"));
  return nodes;
}

/** DOM (chips + ghosts + text) -> stored token string. A ghost still
 *  showing its own placeholder text (never clicked/edited) is treated
 *  as blank — see file header. */
function serializeEditable(el) {
  let out = "";
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent;
    } else if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    } else if (node.classList.contains("formula-chip")) {
      const idx = node.dataset.checkboxIndex;
      out += idx !== undefined ? `{{${node.dataset.fieldId}::${idx}}}` : `{{${node.dataset.fieldId}}}`;
    } else if (node.classList.contains("formula-ghost")) {
      if (node.textContent !== node.dataset.ghostText) out += node.textContent; // edited — keep it
      // else: still just the placeholder — contributes nothing
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

/** Inserts an arbitrary run of nodes at the current caret (or at the
 *  end, if the editable doesn't currently hold the selection). If any
 *  of the inserted nodes is a ghost, the caret ends up with that
 *  ghost's contents SELECTED (so the very next keystroke replaces it,
 *  like a snippet tool's tab stop) — otherwise it's placed right
 *  after the last inserted node. */
function insertNodesAtCaret(editableEl, nodes) {
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
  const frag = document.createDocumentFragment();
  nodes.forEach((n) => frag.append(n));
  const lastNode = nodes[nodes.length - 1];
  range.insertNode(frag);

  const firstGhost = nodes.find((n) => n.classList && n.classList.contains("formula-ghost"));
  const newRange = document.createRange();
  if (firstGhost) {
    newRange.selectNodeContents(firstGhost);
  } else {
    newRange.setStartAfter(lastNode);
    newRange.collapse(true);
  }
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

/** If a ghost's text no longer matches its original placeholder (the
 *  user typed over it), unwrap it into plain text so it stops
 *  behaving like a ghost (no more select-all-on-click) — while trying
 *  to keep the caret in the same visual spot through the swap. */
function unwrapEditedGhosts(editableEl) {
  const sel = window.getSelection();
  const activeRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  editableEl.querySelectorAll(".formula-ghost").forEach((span) => {
    if (span.textContent === span.dataset.ghostText) return; // untouched — leave it as a ghost
    const caretWasHere = !!(activeRange && span.contains(activeRange.startContainer));
    const offset = caretWasHere && activeRange.startContainer.nodeType === Node.TEXT_NODE
      ? activeRange.startOffset
      : span.textContent.length;
    const textNode = document.createTextNode(span.textContent);
    span.replaceWith(textNode);
    if (caretWasHere) {
      const newRange = document.createRange();
      newRange.setStart(textNode, Math.min(offset, textNode.length));
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }
  });
}

function showCopiedFeedback(anchorBtn) {
  const existing = anchorBtn.parentElement.querySelector(".formula-copy-feedback");
  if (existing) existing.remove();
  const badge = document.createElement("span");
  badge.className = "formula-copy-feedback";
  badge.textContent = "Copied!";
  anchorBtn.after(badge);
  requestAnimationFrame(() => badge.classList.add("is-visible"));
  setTimeout(() => badge.remove(), 1200);
}

/** Builds one expression/condition box, complete with its copy
 *  button, ghost/chip-aware editing, drag-to-insert-variable support,
 *  and a validation flag underneath. Returns the wrapping element to
 *  place in the layout, plus a couple of handles callers need:
 *  `editable` (for the function/comparator toolbar buttons to insert
 *  into) and `refreshValidation()` (serializes + validates + updates
 *  the flag, returning the current token string — callers use this
 *  after any programmatic insertion, since those don't fire a native
 *  "input" event on their own). */
function makeEditableField(initialText, resolveField, onTextChange, validateFn) {
  const wrap = document.createElement("div");
  wrap.className = "formula-field-group";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "formula-copy-btn";
  copyBtn.title = "Copy";
  copyBtn.textContent = "⧉";

  const main = document.createElement("div");
  main.className = "formula-field-group__main";

  const el = document.createElement("div");
  el.className = "formula-input";
  el.contentEditable = "true";
  el.spellcheck = false;
  renderTokensIntoEditable(el, initialText, resolveField);

  const flag = document.createElement("div");
  flag.className = "formula-flag";
  flag.hidden = true;

  function refreshValidation() {
    const text = serializeEditable(el);
    const message = validateFn ? validateFn(text) : null;
    flag.hidden = !message;
    flag.textContent = message ? `⚠ ${message}` : "";
    return text;
  }

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(el.textContent || "");
      showCopiedFeedback(copyBtn);
    } catch {
      // Clipboard permission/context issue — nothing useful to do beyond not crashing.
    }
  });

  el.addEventListener("input", () => {
    unwrapEditedGhosts(el);
    onTextChange(refreshValidation());
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault(); // single-line
  });
  el.addEventListener("mousedown", (e) => {
    const ghost = e.target.closest(".formula-ghost");
    if (!ghost) return;
    e.preventDefault(); // don't let the browser place a bare caret — we're selecting the whole placeholder instead
    const range = document.createRange();
    range.selectNodeContents(ghost);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  wireVariableDrop(el, resolveField, () => onTextChange(refreshValidation()));

  refreshValidation(); // surface any pre-existing issue immediately on reopen

  main.append(el, flag);
  wrap.append(copyBtn, main);
  return { wrap, editable: el, refreshValidation };
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
  overlay.className = "formula-overlay";
  // Deliberately NOT a full-screen click-catcher: the whole point is
  // to let the sidebar stay usable (to drag fields in) while this is
  // open, so it doesn't dim/block the rest of the page and closing is
  // only ever explicit (the × / Done buttons).

  const box = document.createElement("div");
  box.className = "modal-box modal-box--formula";
  box.addEventListener("click", (e) => e.stopPropagation());

  const titleRow = document.createElement("div");
  titleRow.className = "formula-editor-titlerow";
  const title = document.createElement("h3");
  title.textContent = `Formula for "${field.label || "Field"}"`;
  const closeX = document.createElement("button");
  closeX.type = "button";
  closeX.className = "formula-editor-close";
  closeX.title = "Close";
  closeX.textContent = "✕";
  closeX.addEventListener("click", close);
  titleRow.append(title, closeX);
  box.append(titleRow);

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

    const leafField = makeEditableField(node.text, resolveField, (text) => {
      node.text = text;
      commitDebounced();
    }, validateExpression);
    const { editable, refreshValidation } = leafField;

    const fnRow = document.createElement("div");
    fnRow.className = "formula-toolbar";
    FUNCTION_NAMES.forEach((name) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn formula-toolbar__btn";
      btn.textContent = `${name}()`;
      btn.title = `${name}(${(FUNCTION_PARAMS[name] || []).join(", ")})`;
      btn.addEventListener("click", () => {
        insertNodesAtCaret(editable, buildFunctionTemplate(name));
        node.text = refreshValidation();
        commitDebounced();
      });
      fnRow.append(btn);
    });

    const thisFieldBtn = document.createElement("button");
    thisFieldBtn.type = "button";
    thisFieldBtn.className = "btn formula-toolbar__btn";
    thisFieldBtn.textContent = "This field";
    thisFieldBtn.title = "Reference this field's own value — see the note below about self-reference";
    thisFieldBtn.addEventListener("click", () => {
      insertNodesAtCaret(editable, [makeChip(field, null)]);
      node.text = refreshValidation();
      commitDebounced();
    });
    fnRow.append(thisFieldBtn);

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

    wrap.append(fnRow, leafField.wrap, addCondBtn);
    return wrap;
  }

  function renderIfNode(node, replaceSelf) {
    const wrap = document.createElement("div");
    wrap.className = "formula-if";

    const condLabel = document.createElement("label");
    condLabel.textContent = "If";
    wrap.append(condLabel);

    const condField = makeEditableField(node.condition, resolveField, (text) => {
      node.condition = text;
      commitDebounced();
    }, validateCondition);
    const { editable: condEditable, refreshValidation: refreshCond } = condField;

    const condRow = document.createElement("div");
    condRow.className = "formula-toolbar";
    COMPARATOR_BUTTONS.forEach((sym) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn formula-toolbar__btn";
      btn.textContent = sym.trim();
      btn.addEventListener("click", () => {
        insertNodesAtCaret(condEditable, [document.createTextNode(sym)]);
        node.condition = refreshCond();
        commitDebounced();
      });
      condRow.append(btn);
    });
    wrap.append(condRow, condField.wrap);

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

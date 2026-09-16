// sheetFields.js
//
// Pure list/tag/dropdown state helpers extracted from customSheet.js.
// customSheet.js owns DOM + commitMutation; it delegates array/set math
// here so the rules live in one testable place with no DOM dependency.

// --- Field node DOM ---------------------------------------------------------
//
// Migration of renderFieldNode from customSheet.js:
//
//   renderFieldNodeInto(field, parentBlock, cw, parentStyle, {
//     isEdit, resizableTypes, headerRows,
//     applyRectFn, applyStyleFn, mergeStyleFn, innerFn, ownTextFn,
//     dragHandleFn, resizeHandleFn, equationHintFn, toolbarFn,
//     dragFn, resizeFn, renderAllFn, persistFn, queueOverflowFn,
//   })

export function isResizableField(fieldType, resizableTypes) {
  return resizableTypes.has(fieldType);
}

export function fieldContentBounds(parentBlock, headerRows) {
  return {
    contentRows: parentBlock.h - headerRows,
    maxXFor: (field) => parentBlock.w - field.w,
    maxYFor: (field, contentRows) => contentRows - field.h,
    maxWFor: (field) => parentBlock.w - field.x,
    maxHFor: (field, contentRows) => contentRows - field.y,
  };
}

export function renderFieldNodeInto(field, parentBlock, cw, parentStyle = {}, deps) {  const {
    isEdit,
    resizableTypes,
    headerRows,
    applyRectFn,
    applyStyleFn,
    mergeStyleFn,
    innerFn,
    ownTextFn,
    dragHandleFn,
    resizeHandleFn,
    equationHintFn,
    toolbarFn,
    dragFn,
    resizeFn,
    renderAllFn,
    persistFn,
    queueOverflowFn,
  } = deps;

  const el = document.createElement("div");
  el.className = "grid-node grid-node--field";
  el.dataset.nodeId = field.id;
  el.dataset.nodeKind = "field";
  if (isEdit) el.tabIndex = 0;
  applyRectFn(el, field, cw);
  const fieldStyle = mergeStyleFn(parentStyle, field.style || {});
  applyStyleFn(el, fieldStyle);

  const labelEl = innerFn(el, field, parentBlock, cw);
  // el isn't attached to the document yet at this point (the caller
  // appends it further up the tree once it's built) — labelEl has no
  // real layout yet either, so checking scrollWidth/clientWidth here
  // would just compare 0 to 0. Queue it and let renderPageGrid check
  // it once the whole grid is actually in the DOM (see
  // pendingLabelOverflowChecks above and its drain at the end of
  // renderPageGrid).
  if (labelEl) queueOverflowFn({ labelEl, field, fieldEl: el, parentBlock });
  ownTextFn(el, fieldStyle);

  el.append(dragHandleFn());
  if (isResizableField(field.fieldType, resizableTypes)) {
    el.append(resizeHandleFn());
  }
  if (field.fieldType === "text") {
    el.append(equationHintFn(field));
  }
  el.append(toolbarFn(field, parentBlock, el));

  // Fields are confined to their parent block's content area — the
  // area below the reserved name row (see BLOCK_HEADER_ROWS). They
  // can move/resize freely WITHIN that, but never past the block's
  // own edges; the block itself has no such limit (it can go
  // anywhere on the canvas).
  const contentRows = parentBlock.h - headerRows;
  dragFn(el, field, cw, () => renderAllFn(), {
    maxX: parentBlock.w - field.w,
    maxY: contentRows - field.h,
  });
  if (isResizableField(field.fieldType, resizableTypes)) {
    resizeFn(el, field, cw, {
      minW: 1, minH: 1,
      maxW: parentBlock.w - field.x,
      maxH: contentRows - field.y,
      onCommit: () => {
        persistFn();
        renderAllFn();
      },
    });
  }

  return el;
}

export function ensureItems(field) {
  if (!Array.isArray(field.items)) field.items = [];
  return field.items;
}

export function moveListItem(items, fromIndex, toIndex) {
  if (fromIndex === null || fromIndex === undefined) return items;
  if (fromIndex === toIndex) return items;
  if (fromIndex < 0 || fromIndex >= items.length) return items;
  if (toIndex < 0 || toIndex > items.length) return items;
  const [moved] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, moved);
  return items;
}

export function setListItem(items, index, text) {
  items[index] = text;
  return items;
}

export function removeListItem(items, index) {
  items.splice(index, 1);
  return items;
}

export function addListItem(items, text = "") {
  items.push(text);
  return items;
}

export function tagState({ items = [], granted = new Set(), tagOptions = [] } = {}) {
  const grantedSet = granted instanceof Set ? granted : new Set(granted || []);
  const known = new Set([...items, ...grantedSet]);
  const grantedChips = [...grantedSet].sort();
  const manualChips = items.slice().sort().filter((tag) => !grantedSet.has(tag));
  const available = (tagOptions || []).filter((opt) => !known.has(opt));
  return {
    grantedChips,
    manualChips,
    available,
    placeholder: available.length ? "Add…" : "Nothing left to add",
    disabled: available.length === 0,
  };
}

export function addTag(items, value) {
  if (!value) return false;
  if (items.includes(value)) return false;
  items.push(value);
  return true;
}

export function removeTag(items, tag) {
  const idx = items.indexOf(tag);
  if (idx === -1) return items;
  items.splice(idx, 1);
  return items;
}

export function dropdownVisibleChoices(choices = [], allowedSet) {
  if (!allowedSet) return choices.slice();
  return choices.filter((choice) => allowedSet.has(choice.id));
}

export function isCheckboxGranted(grantedSet, fieldId, index) {
  return grantedSet.has(`${fieldId}::${index}`);
}

// --- Label + ghost + field-inner DOM ------------------------------------------
//
// Migration of updateFieldLabelVisibility / hasVisibleText /
// wireGhostDefault / renderFieldInner from customSheet.js. The first
// three are dependency-free; renderFieldInner takes explicit deps:
//
//   renderFieldInnerInto(fieldEl, field, parentBlock, {
//     captionlessTypes, buildValueFn, commitFn, frameFn, visibilityFn,
//     growFn, ghostFn, labelInUseFn, toastFn, moneyFn,
//   })

export function hasVisibleText(html) {
  if (!html) return false;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent.trim().length > 0;
}

/** The default "Stat" label acts as a placeholder-style prompt: once
 *  a text field actually has a value, the still-unedited default
 *  label is redundant, so it hides — and comes right back the
 *  instant the value is cleared. */
export function updateFieldLabelVisibilityInto(field, labelEl) {
  const isUnrenamedDefault = field.label === "Stat";
  const hasValue = field.fieldType === "text" && (field.formula ? true : hasVisibleText(field.value));
  // visibility, not display: the label's SPACE stays reserved either
  // way, so the value box doesn't expand into it once the label
  // (still just the unrenamed default) disappears.
  labelEl.style.visibility = (isUnrenamedDefault && hasValue) ? "hidden" : "";
}

/** Makes a contentEditable element behave like a placeholder: while
 *  its content is still exactly the sentinel default text, it's shown
 *  faded/italic via .is-ghost-default — and focusing it clears the
 *  visible text immediately. Blurring with genuinely EMPTY content
 *  restores the ghost and commits the sentinel back via `commit`. */
export function wireGhostDefaultInto(el, defaultText, commit) {
  function refreshGhostState() {
    el.classList.toggle("is-ghost-default", el.innerHTML === defaultText);
  }
  refreshGhostState();
  el.addEventListener("focus", () => {
    if (el.classList.contains("is-ghost-default")) {
      el.innerHTML = "";
      el.classList.remove("is-ghost-default");
    }
  });
  el.addEventListener("blur", () => {
    if (el.textContent.length === 0) {
      el.innerHTML = defaultText;
      el.classList.add("is-ghost-default");
      commit(defaultText);
    }
  });
}

export function isDuplicateLabel(current, beforeEdit, field, labelInUseFn) {
  const trimmed = current.trim();
  if (!trimmed || trimmed === beforeEdit.trim()) return false;
  return labelInUseFn(trimmed, field);
}

/** Rebuilds just the label+value area of a field (not its outer
 *  wrapper/handles/toolbar). Returns the label element so the caller
 *  can animate it. */
export function renderFieldInnerInto(fieldEl, field, parentBlock, deps) {
  const {
    captionlessTypes,
    buildValueFn,
    commitFn,
    frameFn,
    visibilityFn,
    growFn,
    ghostFn,
    labelInUseFn,
    toastFn,
    moneyFn,
  } = deps;

  const old = fieldEl.querySelector(".field-inner");
  if (old) old.remove();

  const inner = document.createElement("div");
  inner.className = `field-inner field-inner--${field.labelPosition}`;

  // "label" and "picture" fields are just one element filling the
  // whole box — no separate caption/value split.
  if (captionlessTypes.has(field.fieldType)) {
    const valueEl = buildValueFn(field, () => {});
    inner.append(valueEl);
    fieldEl.prepend(inner);
    return null;
  }

  const labelEl = document.createElement("div");
  labelEl.className = "field-label";
  labelEl.contentEditable = "true";
  labelEl.textContent = field.label;
  labelEl.title = field.label;
  let labelBeforeEdit = field.label;
  labelEl.addEventListener("focus", () => {
    labelBeforeEdit = field.label;
  });
  labelEl.addEventListener("keydown", (e) => {
    // Plain Enter = done editing (blur); Shift+Enter = an actual new
    // line in the label, left to the browser's normal contenteditable
    // behavior.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      labelEl.blur();
    }
  });
  labelEl.addEventListener("input", () => {
    commitFn(() => {
      field.label = labelEl.textContent;
    }, { render: false });
    labelEl.title = labelEl.textContent;
    frameFn();
    visibilityFn(field, labelEl);
    growFn(labelEl, field, fieldEl, parentBlock);
  });
  labelEl.addEventListener("blur", () => {
    // Checked on blur (not per-keystroke) so typing itself is never
    // interrupted — labels double as formula variable names and as
    // the names droppable into the character-card fields, so two
    // fields sharing one would be genuinely ambiguous in both
    // places. Dragging a COPY of a field in (from the sidebar) is
    // exempt — that never goes through this rename path.
    const current = field.label.trim();
    if (isDuplicateLabel(current, labelBeforeEdit, field, labelInUseFn)) {
      toastFn(`The label "${current}" is already in use by another field — reverted to "${labelBeforeEdit}".`, { isError: true });
      commitFn(() => {
        field.label = labelBeforeEdit;
      }, { render: false });
      labelEl.textContent = labelBeforeEdit;
      labelEl.classList.toggle("is-ghost-default", labelBeforeEdit === "Stat");
      visibilityFn(field, labelEl);
    } else {
      moneyFn(field);
    }
  });
  ghostFn(labelEl, "Stat", (text) => {
    commitFn(() => {
      field.label = text;
    }, { render: false });
    frameFn();
    visibilityFn(field, labelEl);
  });
  labelEl.addEventListener("pointerdown", (e) => e.stopPropagation());

  const valueEl = buildValueFn(field, () => visibilityFn(field, labelEl));
  visibilityFn(field, labelEl);

  inner.append(labelEl, valueEl);
  fieldEl.prepend(inner); // prepend so handles/toolbar (appended later) stay on top
  return labelEl;
}

// --- Text / label / textarea value builders -----------------------------------
//
// Migration of buildFieldValue's text/label/textarea branches from
// customSheet.js. Each takes explicit deps (no sheet closure).

export function buildTextValueInto(field, onValueChange, deps) {
  const { commitFn, formattedValue } = deps;
  const el = document.createElement("div");
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
  if (field.formula) {
    el.className = "field-value field-value--computed";
    el.contentEditable = "false";
    el.dataset.fieldId = field.id;
    el.textContent = formattedValue;
  } else {
    el.className = "field-value";
    el.contentEditable = "true";
    el.innerHTML = field.value || "";
    el.addEventListener("input", () => {
      commitFn(() => {
        field.value = el.innerHTML;
      }, { render: false });
      if (onValueChange) onValueChange();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.preventDefault(); // single-line — see textarea for multi-line
    });
  }
  return el;
}

export function buildLabelValueInto(field, deps) {
  const { commitFn, ghostFn } = deps;
  const el = document.createElement("div");
  el.className = "field-value field-value--label";
  el.contentEditable = "true";
  el.innerHTML = field.value || "";
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
  el.addEventListener("input", () => {
    commitFn(() => {
      field.value = el.innerHTML;
    }, { render: false });
  });
  ghostFn(el, "Label text", (text) => {
    commitFn(() => {
      field.value = text;
    }, { render: false });
  });
  return el;
}

export function buildTextareaValueInto(field, deps) {
  const { commitFn } = deps;
  const el = document.createElement("div");
  el.className = "field-value field-value--textarea";
  el.contentEditable = "true";
  el.innerHTML = field.value || "";
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
  el.addEventListener("input", () => {
    commitFn(() => {
      field.value = el.innerHTML;
    }, { render: false });
  });
  return el;
}
//
// --- Radio / checkbox option grids -----------------------------------------------
//
// Migration of buildFieldValue's trailing options branch from
// customSheet.js. Count resolution is pure; the grid builder takes
// explicit deps:
//
//   effectiveOptionCount(field, radioCounts, slotCounts)
//   buildOptionsValueInto(field, effectiveOptions, {commitFn, grantedCheckboxes})

export function effectiveOptionCount(field, radioCounts = {}, slotCounts = {}) {
  // A formula-driven radio group's button count is whatever that
  // formula currently computes; one of the standard spell-slot fields
  // (no formula, but a live entry in slotCounts) instead tracks
  // class/level automatically. `options` becomes just the fallback
  // default, used only when neither applies.
  const isFormulaRadio = field.fieldType === "radio" && field.optionsFormula;
  const isLiveSlotField = field.fieldType === "radio" && !field.optionsFormula
    && Object.prototype.hasOwnProperty.call(slotCounts, field.id);
  return isFormulaRadio ? (radioCounts[field.id] ?? 0)
    : isLiveSlotField ? (slotCounts[field.id] ?? 0)
    : (field.options || 1);
}

export function buildOptionsValueInto(field, effectiveOptions, deps) {
  const { commitFn, grantedCheckboxes = new Set() } = deps;
  const el = document.createElement("div");
  el.className = "field-value field-value--options";
  el.style.gridTemplateColumns = `repeat(${Math.max(1, effectiveOptions)}, minmax(0, 1fr))`;

  if (field.fieldType === "radio") {
    // Filled left-to-right up through whichever one was clicked
    // (n <= field.selected), not just that one alone — these are
    // used as a "how many of N used" meter (spell slots, death
    // saves), not a real mutually-exclusive choice, even though
    // they're built from <input type="radio"> for the free grouping
    // behavior that gives. A plain click only ever checks the one
    // clicked (that's the browser's own native behavior firing
    // before our "change" handler even runs), so the rest of the
    // fill has to be patched in manually right after, via the same
    // `inputs` this loop is already building.
    const inputs = [];
    for (let n = 1; n <= effectiveOptions; n++) {
      const wrap = document.createElement("label");
      wrap.className = "option-radio";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = field.id;
      input.checked = field.selected !== null && n <= field.selected;
      input.addEventListener("change", () => {
        commitFn(() => {
          field.selected = n;
        }, { render: false });
        inputs.forEach((otherInput, idx) => {
          otherInput.checked = idx + 1 <= n;
        });
      });
      input.addEventListener("pointerdown", (e) => e.stopPropagation());
      wrap.append(input);
      el.append(wrap);
      inputs.push(input);
    }
  } else if (field.fieldType === "checkbox") {
    for (let i = 0; i < field.options; i++) {
      const wrap = document.createElement("label");
      wrap.className = "option-checkbox";
      const granted = grantedCheckboxes.has(`${field.id}::${i}`);
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!field.checked[i] || granted;
      if (granted) {
        // Not independently uncheckable while granted — same
        // reasoning as the numeric ops overwriting a formula field's
        // own value: this box's visible state is a computed result
        // (of the currently-selected Race/Class/etc.), not this
        // box's own stored data, while it's active. field.checked[i]
        // underneath is untouched, so a manually-checked box stays
        // checked on its own after the granting choice changes away.
        input.disabled = true;
        wrap.classList.add("option-checkbox--granted");
        wrap.title = "Granted automatically by a selected Race/Class/etc. — change that selection to remove it";
      }
      input.addEventListener("change", () => {
        commitFn(() => {
          field.checked[i] = input.checked;
        }, { render: false });
      });
      input.addEventListener("pointerdown", (e) => e.stopPropagation());
      wrap.append(input);
      el.append(wrap);
    }
  }
  return el;
}

// --- Picture / feature-list value builders --------------------------------------
//
// Migration of personIconSvgMarkup / buildAvatarPlaceholderSvg /
// readImageFile / clearOtherAvatars / buildPictureValue /
// buildFeatureListValue from customSheet.js.

export function personIconSvgMarkup() {
  return `<svg viewBox="0 0 24 24" class="person-icon" aria-hidden="true">
      <circle cx="12" cy="8" r="4.2"/>
      <path d="M4 21c0-4.8 3.6-8.6 8-8.6s8 3.8 8 8.6z"/>
    </svg>`;
}

export function buildAvatarPlaceholderSvg() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  svg.classList.add("picture-placeholder-svg");
  svg.innerHTML = `
      <rect width="24" height="24" fill="#2a2520"/>
      <circle cx="12" cy="9.5" r="4" fill="#4a4038"/>
      <path d="M12 14.6c-4.8 0-8.2 3.2-8.2 7.7v1.7h16.4v-1.7c0-4.5-3.4-7.7-8.2-7.7z" fill="#4a4038"/>
    `;
  return svg;
}

/** Reads a File as a data URL, warning when it may not fit in a
 *  single Firestore document. */
export function readImageFileInto(file, maxBytes, toastFn, onLoaded) {
  const reader = new FileReader();
  reader.onload = () => {
    if (reader.result.length > maxBytes) {
      toastFn("That image is large enough that it (plus the rest of this character) may not fit in a single Firestore document (1MB limit). It'll be applied, but saving might fail — try a smaller image if so.");
    }
    onLoaded(reader.result);
  };
  reader.readAsDataURL(file);
}

/** Clears isAvatar on every OTHER picture field — only one field on
 *  a whole character holds that flag at a time. */
export function clearOtherAvatarsIn(sheetTabs, exceptField) {
  sheetTabs.forEach((tab) => {
    (tab.layout || []).forEach((b) => {
      (b.children || []).forEach((f) => {
        if (f.fieldType === "picture" && f !== exceptField) f.isAvatar = false;
      });
    });
  });
}

export function findImageFile(files) {
  return Array.from(files || []).find((f) => f.type.startsWith("image/")) || null;
}

/** A "picture" field: shows the image if set, else a placeholder
 *  silhouette. Click/drag-drop sets the image; the corner button
 *  marks it as the character-list avatar.
 *
 *    buildPictureValueInto(field, {
 *      readFileFn, commitFn, clearAvatarsFn, placeholderFn, iconMarkup,
 *    })
 */
export function buildPictureValueInto(field, deps) {
  const { readFileFn, commitFn, clearAvatarsFn, placeholderFn, iconMarkup } = deps;
  const wrap = document.createElement("div");
  wrap.className = "field-value field-value--picture";
  wrap.addEventListener("pointerdown", (e) => e.stopPropagation());

  if (field.imageData) {
    const img = document.createElement("img");
    img.className = "picture-field-image";
    img.src = field.imageData;
    img.draggable = false;
    img.alt = field.label || "Portrait";
    wrap.append(img);
  } else {
    wrap.append(placeholderFn());
  }

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.hidden = true;
  fileInput.addEventListener("pointerdown", (e) => e.stopPropagation());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    readFileFn(file, (dataUrl) => {
      commitFn(() => {
        field.imageData = dataUrl;
      });
    });
  });
  wrap.append(fileInput);

  wrap.addEventListener("click", (e) => {
    if (e.target.closest(".picture-avatar-btn")) return;
    fileInput.click();
  });
  wrap.addEventListener("dragover", (e) => {
    if (e.dataTransfer.types.includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  });
  wrap.addEventListener("drop", (e) => {
    const file = findImageFile(e.dataTransfer.files);
    if (!file) return;
    e.preventDefault();
    e.stopPropagation(); // this field is handling it — don't let the
      // page-grid's own "drop an image to create a new picture
      // block" handler also fire for the same drop
    readFileFn(file, (dataUrl) => {
      commitFn(() => {
        field.imageData = dataUrl;
      });
    });
  });

  const avatarBtn = document.createElement("button");
  avatarBtn.type = "button";
  avatarBtn.className = "picture-avatar-btn" + (field.isAvatar ? " active" : "");
  avatarBtn.title = "Set as Avatar";
  avatarBtn.innerHTML = iconMarkup;
  avatarBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  avatarBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const makingAvatar = !field.isAvatar;
    commitFn(() => {
      clearAvatarsFn(field);
      field.isAvatar = makingAvatar;
    });
  });
  wrap.append(avatarBtn);

  return wrap;
}

/** Read-only — re-renders whatever feature grants are currently
 *  computed for the whole character. Same "computed fresh every
 *  render" model as a granted checkbox. */
export function buildFeatureListValueInto(features) {
  const el = document.createElement("div");
  el.className = "field-value field-value--featurelist";
  el.addEventListener("pointerdown", (e) => e.stopPropagation());

  if (features.length === 0) {
    const empty = document.createElement("div");
    empty.className = "featurelist-empty";
    empty.textContent = "No features yet — pick a Class/Race/Background with feature grants, or level up.";
    el.append(empty);
    return el;
  }

  features.forEach((feature) => {
    const row = document.createElement("div");
    row.className = "featurelist-row";

    const header = document.createElement("div");
    header.className = "featurelist-row__header";

    const name = document.createElement("span");
    name.className = "featurelist-row__name";
    name.textContent = feature.name;
    header.append(name);

    if (feature.level > 0) {
      const level = document.createElement("span");
      level.className = "featurelist-row__level";
      level.textContent = `Lvl ${feature.level}`;
      header.append(level);
    }

    row.append(header);

    if (feature.description) {
      const desc = document.createElement("div");
      desc.className = "featurelist-row__description";
      desc.textContent = feature.description;
      row.append(desc);
    }

    el.append(row);
  });

  return el;
}

// --- Field-type menu + previews ----------------------------------------------
//
// Migration of openFieldTypeMenu + build*Preview from customSheet.js.
// Previews are pure DOM; the menu takes explicit deps:
//
//   openFieldTypeMenuInto(anchorBtn, onChoose, {
//     closeFn, positionFn, setOpenPopup, personIconMarkup,
//   })

export const FIELD_TYPE_GROUPS = [
  { name: "Text", types: ["text", "label", "textarea", "textlist"] },
  { name: "Choice", types: ["dropdown", "radio", "checkbox"] },
  { name: "Media", types: ["picture"] },
  { name: "Interactive", types: ["catalog", "featureList"] },
];

export const FIELD_TYPE_LABELS = {
  text: "Num Field",
  label: "Label",
  textarea: "Text Area",
  textlist: "Text List",
  dropdown: "Dropdown",
  radio: "Radio Buttons",
  checkbox: "Checkbox",
  picture: "Image",
  catalog: "Catalog",
  featureList: "Feature List",
};

/** A small, non-interactive preview of an empty text field — used in
 *  the field-type picker so each option shows what it'll look like. */
export function buildTextPreview() {
  const el = document.createElement("span");
  el.className = "field-type-preview-text";
  return el;
}

export function buildLabelPreview() {
  const el = document.createElement("span");
  el.className = "field-type-preview-label";
  el.textContent = "Aa";
  return el;
}

export function buildTextareaPreview() {
  const el = document.createElement("span");
  el.className = "field-type-preview-textarea";
  return el;
}

export function buildTextlistPreview() {
  const el = document.createElement("span");
  el.className = "field-type-preview-textlist";
  for (let i = 0; i < 3; i++) {
    const line = document.createElement("span");
    line.className = "field-type-preview-textlist__line";
    el.append(line);
  }
  return el;
}

export function buildDropdownPreview() {
  const el = document.createElement("span");
  el.className = "field-type-preview-dropdown";
  el.textContent = "▾";
  return el;
}

export function buildPicturePreview(personIconMarkup) {
  const el = document.createElement("span");
  el.className = "field-type-preview-picture";
  el.innerHTML = personIconMarkup;
  return el;
}

export function buildCatalogPreview() {
  const el = document.createElement("span");
  el.className = "field-type-preview-catalog";
  el.textContent = "☰";
  return el;
}

export function buildFeatureListPreview() {
  const el = document.createElement("span");
  el.className = "field-type-preview-catalog"; // same glyph treatment, no dedicated CSS needed
  el.textContent = "★";
  return el;
}

/** A small, non-interactive preview of `count` empty radio buttons
 *  or checkboxes in a row — same purpose as buildTextPreview above. */
export function buildOptionPreview(kind, count) {
  const wrap = document.createElement("span");
  wrap.className = "field-type-preview-options";
  for (let i = 0; i < count; i++) {
    const dot = document.createElement("span");
    dot.className = `field-type-preview-${kind}`;
    wrap.append(dot);
  }
  return wrap;
}

export function previewForType(type, personIconMarkup) {
  switch (type) {
    case "text": return buildTextPreview();
    case "label": return buildLabelPreview();
    case "textarea": return buildTextareaPreview();
    case "textlist": return buildTextlistPreview();
    case "dropdown": return buildDropdownPreview();
    case "radio": return buildOptionPreview("radio", 3);
    case "checkbox": return buildOptionPreview("checkbox", 1);
    case "picture": return buildPicturePreview(personIconMarkup);
    case "catalog": return buildCatalogPreview();
    case "featureList": return buildFeatureListPreview();
    default: return buildTextPreview();
  }
}

export function openFieldTypeMenuInto(anchorBtn, onChoose, deps) {
  const { closeFn, positionFn, setOpenPopup, personIconMarkup } = deps;
  closeFn();
  const menu = document.createElement("div");
  menu.className = "style-popover field-type-menu";
  menu.addEventListener("pointerdown", (e) => e.stopPropagation());

  // Grouped rather than one flat alphabetical list — nine field
  // types is enough that a little structure helps you scan for the
  // one you want. Still alphabetical WITHIN each group.
  FIELD_TYPE_GROUPS.forEach((group) => {
    const groupLabel = document.createElement("div");
    groupLabel.className = "field-type-menu__group";
    groupLabel.textContent = group.name;
    menu.append(groupLabel);

    group.types
      .map((type) => ({ type, label: FIELD_TYPE_LABELS[type] }))
      .sort((a, b) => a.label.localeCompare(b.label))
      .forEach(({ type, label }) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn field-type-option";
        const labelSpan = document.createElement("span");
        labelSpan.className = "field-type-option__label";
        labelSpan.textContent = label;
        const previewSpan = document.createElement("span");
        previewSpan.className = "field-type-option__preview";
        previewSpan.append(previewForType(type, personIconMarkup));
        btn.append(labelSpan, previewSpan);
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          onChoose(type);
          closeFn();
        });
        menu.append(btn);
      });
  });

  // Appended to the block/field itself, NOT to the toolbar — the
  // toolbar's own visibility is hover-gated (see wireHoverToolbar),
  // and this menu needs to persist independent of that, the same
  // way style-popover already does.
  const gridNode = anchorBtn.closest(".grid-node");
  (gridNode || anchorBtn.parentElement).append(menu);
  positionFn(menu);
  setOpenPopup(anchorBtn.closest(".node-toolbar"));
}

// --- Field toolbar DOM ------------------------------------------------------
//
// Migration of buildFieldToolbar from customSheet.js:
//
//   buildFieldToolbarInto(field, parentBlock, wrapperEl, {
//     styleBtnFn, borderBtnFn, captionlessTypes, cycleFn,
//     choicesEditorFn, catalogConfigFn, formulaEditorFn, resolveFn,
//     commitFn, gridFn, liveSlotCounts, syncWidthFn, hoverFn,
//   })

export function hasLiveOptionCount(field, liveSlotCounts) {
  return field.fieldType === "radio"
    && (field.optionsFormula || Object.prototype.hasOwnProperty.call(liveSlotCounts, field.id));
}

export function buildFieldToolbarInto(field, parentBlock, wrapperEl, deps) {
  const {
    styleBtnFn,
    borderBtnFn,
    captionlessTypes,
    cycleFn,
    choicesEditorFn,
    catalogConfigFn,
    formulaEditorFn,
    resolveFn,
    commitFn,
    gridFn,
    liveSlotCounts = {},
    syncWidthFn,
    hoverFn,
  } = deps;

  const bar = document.createElement("div");
  bar.className = "node-toolbar";

  // A picture/catalog has nothing text-stylable about it (a picture's
  // image IS its content; a catalog is just a button whose own label
  // covers styling via the normal field-label path), so skip the
  // style button entirely rather than showing a popover of controls
  // that don't apply.
  if (field.fieldType !== "picture" && field.fieldType !== "catalog") {
    bar.append(styleBtnFn(field, wrapperEl));
  }
  bar.append(borderBtnFn(field, wrapperEl));

  if (!captionlessTypes.has(field.fieldType)) {
    const cycleLabelBtn = document.createElement("button");
    cycleLabelBtn.type = "button";
    cycleLabelBtn.title = "Move label";
    cycleLabelBtn.textContent = "↻";
    cycleLabelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cycleFn(field, parentBlock, wrapperEl);
    });
    bar.append(cycleLabelBtn);
  }

  if (field.fieldType === "dropdown") {
    const editChoicesBtn = document.createElement("button");
    editChoicesBtn.type = "button";
    editChoicesBtn.title = "Edit choices";
    editChoicesBtn.textContent = "☰";
    editChoicesBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      choicesEditorFn(field, wrapperEl);
    });
    bar.append(editChoicesBtn);
  }

  if (field.fieldType === "catalog") {
    const configBtn = document.createElement("button");
    configBtn.type = "button";
    configBtn.title = "Configure catalog";
    configBtn.textContent = "⚙";
    configBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      catalogConfigFn(field, wrapperEl);
    });
    bar.append(configBtn);
  }

  if (field.fieldType === "radio") {
    const slotFormulaBtn = document.createElement("button");
    slotFormulaBtn.type = "button";
    slotFormulaBtn.title = field.optionsFormula
      ? "Edit the formula for how many buttons this has"
      : "Set a formula for how many buttons this has (e.g. spell slots that scale with Level)";
    slotFormulaBtn.textContent = "=";
    slotFormulaBtn.className = field.optionsFormula ? "active" : "";
    slotFormulaBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      formulaEditorFn(
        { id: field.id, label: field.label, formula: field.optionsFormula },
        resolveFn,
        (newFormula) => {
          commitFn(() => { field.optionsFormula = newFormula; }, { render: false });
          gridFn();
        },
        {
          title: `Slot-Count Formula for "${field.label || "Field"}"`,
          hint: "This computes how many radio buttons this group shows — not which one is selected. Good for something like spell slots that scale with Level. Drag stat fields in as variables, same as any other formula.",
        }
      );
    });
    bar.append(slotFormulaBtn);
  }

  // Hidden rather than shown-but-inert for a field whose count is
  // computed live (a formula, or one of the standard spell-slot
  // fields) — options is just the ignored fallback default then, so
  // +/- clicking it wouldn't visibly do anything.
  if ((field.fieldType === "radio" || field.fieldType === "checkbox") && !hasLiveOptionCount(field, liveSlotCounts)) {
    const minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.title = "Remove option";
    minusBtn.textContent = "−";
    minusBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (field.options <= 1) return;
      commitFn(() => {
        field.options -= 1;
        syncWidthFn(field);
      });
    });
    const plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.title = "Add option";
    plusBtn.textContent = "+";
    plusBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      commitFn(() => {
        field.options += 1;
        syncWidthFn(field);
      });
    });
    bar.append(minusBtn, plusBtn);
  }

  hoverFn(wrapperEl, bar);
  return bar;
}

// --- Equation hint + label cycling ---------------------------------------------------
//
// Migration of buildEquationHint / cycleLabelPosition from
// customSheet.js. The hint sits opposite the label and opens the
// formula editor; cycling re-renders the field inner with a FLIP
// animation from the label's old position.
//
//   buildEquationHintInto(field, {editorFn, resolveFn, commitFn, gridFn})
//   cycleLabelPositionInto(field, parentBlock, fieldEl, {
//     commitFn, nextPosFn, positions, innerFn, growFn, hintFn,
//   })

export function oppositeSide(pos) {
  return { top: "bottom", bottom: "top", left: "right", right: "left" }[pos];
}

export function buildEquationHintInto(field, deps) {
  const { editorFn, resolveFn, commitFn, gridFn } = deps;
  const hint = document.createElement("div");
  hint.className = `equation-hint equation-hint--${oppositeSide(field.labelPosition)}${field.formula ? " equation-hint--active" : ""}`;
  hint.textContent = "=";
  hint.title = field.formula ? "Edit formula" : "Set up a formula";
  hint.addEventListener("click", (e) => {
    e.stopPropagation();
    editorFn(field, resolveFn, (newFormula) => {
      commitFn(() => {
        field.formula = newFormula;
      }, { render: false });
      gridFn();
    });
  });
  return hint;
}

export function cycleLabelPositionInto(field, parentBlock, fieldEl, deps) {
  const { commitFn, nextPosFn, positions, innerFn, growFn, hintFn } = deps;
  const labelEl = fieldEl.querySelector(".field-label");
  const first = labelEl ? labelEl.getBoundingClientRect() : null;

  commitFn(() => {
    field.labelPosition = nextPosFn(field.labelPosition, positions);
  }, { render: false });

  const newLabelEl = innerFn(fieldEl, field, parentBlock);
  // Unlike the initial-build call in renderFieldNode, fieldEl here is
  // already attached to the live document (we're editing an existing
  // node in place), so newLabelEl already has real layout and this
  // can run immediately rather than needing to be queued.
  if (newLabelEl) growFn(newLabelEl, field, fieldEl, parentBlock);
  // Refresh the equation hint since it always sits opposite the label.
  const oldHint = fieldEl.querySelector(".equation-hint");
  if (oldHint) oldHint.remove();
  if (field.fieldType === "text") {
    fieldEl.append(hintFn(field));
  }

  if (first) {
    const last = newLabelEl.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    newLabelEl.style.transition = "none";
    newLabelEl.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      newLabelEl.style.transition = "transform 200ms ease";
      newLabelEl.style.transform = "";
    });
  }
}

// --- Catalog value button --------------------------------------------------------
//
// Migration of buildCatalogValue from customSheet.js. A "catalog" field
// is just a button — clicking opens the player-facing browser if
// configured, or the config popover if not. The catalog lives in
// Firestore, not on the field.
//
//   buildCatalogValueInto(field, {
//     configFn, loadCatalogFn, toastFn, assignMoneyFn, findFieldFn,
//     readMoneyFn, browserFn, commitFn,
//   })

export function buildCatalogValueInto(field, deps) {  const {
    configFn,
    loadCatalogFn,
    toastFn,
    assignMoneyFn,
    findFieldFn,
    readMoneyFn,
    browserFn,
    commitFn,
  } = deps;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "field-value field-value--catalog";
  btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  btn.textContent = field.catalogSource ? "Open Catalog" : "Set up a catalog…";
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!field.catalogSource) {
      configFn(field, btn.closest(".grid-node"));
      return;
    }
    const catalog = await loadCatalogFn(field.catalogSource.scope, field.catalogSource.id);
    if (!catalog) {
      toastFn("That catalog couldn't be found — it may have been deleted. Reconfigure this field from its ⚙ button.", { isError: true });
      return;
    }
    assignMoneyFn(field);
    const moneyField = field.moneyFieldId ? findFieldFn(field.moneyFieldId) : null;
    browserFn({
      catalog,
      moneyLabel: moneyField ? moneyField.label : null,
      getMoney: () => readMoneyFn(moneyField),
      spendMoney: (amount) => {
        if (!moneyField) return;
        const next = readMoneyFn(moneyField) - amount;
        commitFn(() => {
          moneyField.value = String(next);
        });
      },
    });
  });
  return btn;
}

// --- Catalog field config popover ----------------------------------------------
//
// Migration of openCatalogFieldConfig from customSheet.js. Popover for
// a catalog field's setup: which saved catalog it links to, and which
// text field is the money it spends from.
//
//   openCatalogFieldConfigInto(field, wrapperEl, {
//     closeFn, catalogs, commitFn, manageFn, assignMoneyFn,
//     moneyGroups, positionFn, setOpenPopup,
//   })

export function moneyCandidatesByTab(sheetTabs = []) {
  return sheetTabs.map((tab) => ({
    tabName: tab.name || "Tab",
    fields: (tab.layout || []).flatMap((block) =>
      (block.children || [])
        .filter((f) => f.fieldType === "text")
        .map((f) => ({ id: f.id, label: f.label || "Field" }))
    ),
  })).filter((group) => group.fields.length > 0);
}

export function openCatalogFieldConfigInto(field, wrapperEl, deps) {
  const {
    closeFn,
    catalogs = [],
    commitFn,
    manageFn,
    assignMoneyFn,
    moneyGroups,
    positionFn,
    setOpenPopup,
  } = deps;
  closeFn();
  if (!wrapperEl) return;

  const pop = document.createElement("div");
  pop.className = "style-popover catalog-field-config";
  pop.addEventListener("pointerdown", (e) => e.stopPropagation());

  const title = document.createElement("div");
  title.className = "style-popover__badge";
  title.textContent = "Catalog Setup";
  pop.append(title);

  const catalogLabel = document.createElement("label");
  catalogLabel.textContent = "Catalog";
  const catalogSelect = document.createElement("select");
  const blankOpt = document.createElement("option");
  blankOpt.value = "";
  blankOpt.textContent = catalogs.length ? "Choose a catalog…" : "No catalogs saved yet";
  catalogSelect.append(blankOpt);
  catalogs.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = `${cat.scope}::${cat.id}`;
    opt.textContent = cat.scope === "global" ? `${cat.name} (Global)` : cat.name;
    if (field.catalogSource && field.catalogSource.scope === cat.scope && field.catalogSource.id === cat.id) {
      opt.selected = true;
    }
    catalogSelect.append(opt);
  });
  catalogSelect.addEventListener("change", () => {
    if (!catalogSelect.value) {
      commitFn(() => { field.catalogSource = null; }, { render: false });
      return;
    }
    const [scope, id] = catalogSelect.value.split("::");
    commitFn(() => { field.catalogSource = { scope, id }; }, { render: false });
  });
  pop.append(catalogLabel, catalogSelect);

  const manageBtn = document.createElement("button");
  manageBtn.type = "button";
  manageBtn.className = "btn formula-toolbar__btn";
  manageBtn.textContent = "Manage Catalogs…";
  manageBtn.addEventListener("click", () => {
    manageFn();
  });
  pop.append(manageBtn);

  const moneyLabel = document.createElement("label");
  moneyLabel.textContent = "Money field";
  pop.append(moneyLabel);

  // A <select> rather than a drop zone — dragging a field's own grid
  // element only ever works within its own block (by design), so a
  // plain drag target here could only ever accept fields from the
  // SAME block a Catalog field happens to live in. This lists every
  // text field on the character, grouped by tab.
  assignMoneyFn(field);
  const moneySelect = document.createElement("select");
  const blankMoneyOpt = document.createElement("option");
  blankMoneyOpt.value = "";
  blankMoneyOpt.textContent = "None";
  moneySelect.append(blankMoneyOpt);
  moneyGroups.forEach((group) => {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.tabName;
    group.fields.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.label;
      if (field.moneyFieldId === f.id) opt.selected = true;
      optgroup.append(opt);
    });
    moneySelect.append(optgroup);
  });
  moneySelect.addEventListener("change", () => {
    commitFn(() => { field.moneyFieldId = moneySelect.value || null; }, { render: false });
  });
  pop.append(moneySelect);

  wrapperEl.append(pop);
  positionFn(pop);
  setOpenPopup(wrapperEl.querySelector(".node-toolbar"));
}

// --- Textlist / taglist shells -----------------------------------------------------------
//
// Full migration of buildTextListValue / buildTagListValue DOM shells
// from customSheet.js. Array/set math (already exported above) is
// used directly; only persistence goes through deps:
//
//   buildTextListValueInto(field, {commitFn})
//   buildTagListValueInto(field, grantedSet, {commitFn})

export function buildTextListValueInto(field, deps) {
  const { commitFn } = deps;
  ensureItems(field);
  const el = document.createElement("div");
  el.className = "field-value field-value--textlist";
  el.addEventListener("pointerdown", (e) => e.stopPropagation());

  const itemsWrap = document.createElement("div");
  itemsWrap.className = "textlist-items";
  let dragFromIndex = null;

  function renderItems() {
    itemsWrap.innerHTML = "";
    field.items.forEach((text, index) => {
      const row = document.createElement("div");
      row.className = "textlist-item";
      row.draggable = true;

      row.addEventListener("dragstart", (e) => {
        dragFromIndex = index;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", ""); // Firefox needs data set to allow the drag
        row.classList.add("is-dragging");
      });
      row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      });
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        if (dragFromIndex === null || dragFromIndex === index) return;
        commitFn(() => {
          moveListItem(field.items, dragFromIndex, index);
        }, { render: false });
        renderItems();
      });

      const handle = document.createElement("span");
      handle.className = "textlist-item__handle";
      handle.textContent = "⠿";

      const bullet = document.createElement("span");
      bullet.className = "textlist-item__bullet";
      bullet.textContent = "•";

      const textEl = document.createElement("div");
      textEl.className = "textlist-item__text";
      textEl.contentEditable = "true";
      textEl.textContent = text;
      textEl.addEventListener("pointerdown", (e) => e.stopPropagation());
      textEl.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
      textEl.addEventListener("input", () => {
        commitFn(() => {
          setListItem(field.items, index, textEl.textContent);
        }, { render: false });
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "textlist-item__remove";
      removeBtn.title = "Remove item";
      removeBtn.textContent = "✕";
      removeBtn.setAttribute("aria-label", "Remove item");
      removeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        commitFn(() => {
          removeListItem(field.items, index);
        }, { render: false });
        renderItems();
      });

      row.append(handle, bullet, textEl, removeBtn);
      itemsWrap.append(row);
    });
  }
  renderItems();

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "textlist-add";
  addBtn.textContent = "+ Add item";
  addBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    commitFn(() => {
      addListItem(field.items, "");
    }, { render: false });
    renderItems();
    const lastText = itemsWrap.querySelector(".textlist-item:last-child .textlist-item__text");
    if (lastText) lastText.focus();
  });

  el.append(itemsWrap, addBtn);
  return el;
}

/** Dropdown-driven list widget — used by the "taglist" field type
 *  (Languages, Armor/Weapon/Tool Proficiencies). A tag granted
 *  automatically shows locked with no remove button. The dropdown
 *  only ever offers what isn't already known, so no duplicates. */
export function buildTagListValueInto(field, grantedSet, deps) {
  const { commitFn } = deps;
  ensureItems(field);
  const el = document.createElement("div");
  el.className = "field-value field-value--taglist";
  el.addEventListener("pointerdown", (e) => e.stopPropagation());

  const chipsWrap = document.createElement("div");
  chipsWrap.className = "taglist-chips";
  const select = document.createElement("select");
  select.className = "input-group__control taglist-select";
  select.addEventListener("pointerdown", (e) => e.stopPropagation());

  function buildChip(tag, locked) {
    const chip = document.createElement("span");
    chip.className = "taglist-chip" + (locked ? " taglist-chip--granted" : "");
    if (locked) chip.title = "Granted automatically by a selected Race/Class/etc. — change that selection to remove it";
    const text = document.createElement("span");
    text.textContent = tag;
    chip.append(text);
    if (!locked) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "taglist-chip__remove";
      removeBtn.title = "Remove";
      removeBtn.textContent = "✕";
      removeBtn.setAttribute("aria-label", `Remove ${tag}`);
      removeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        commitFn(() => {
          removeTag(field.items, tag);
        }, { render: false });
        refresh();
      });
      chip.append(removeBtn);
    }
    return chip;
  }

  function refresh() {
    const state = tagState({
      items: field.items,
      granted: grantedSet,
      tagOptions: field.tagOptions || [],
    });
    chipsWrap.innerHTML = "";
    state.grantedChips.forEach((tag) => chipsWrap.append(buildChip(tag, true)));
    state.manualChips.forEach((tag) => chipsWrap.append(buildChip(tag, false)));

    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = state.placeholder;
    select.append(placeholder);
    state.available.forEach((opt) => {
      const optionEl = document.createElement("option");
      optionEl.value = opt;
      optionEl.textContent = opt;
      select.append(optionEl);
    });
    select.disabled = state.disabled;
  }

  select.addEventListener("change", () => {
    const value = select.value;
    if (!value) return;
    commitFn(() => {
      addTag(field.items, value);
    }, { render: false });
    refresh();
  });

  refresh();
  el.append(chipsWrap, select);
  return el;
}

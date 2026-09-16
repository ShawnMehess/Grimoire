// sheetStyles.js
//
// Pure style-mapping helpers extracted from customSheet.js.
// DOM application stays in the renderer; css mapping here is testable.

export function styleToCss(style = {}) {
  return {
    background: style.bg || "",
    backgroundImage: style.bgImage ? `url(${style.bgImage})` : "",
    backgroundSize: style.bgImage ? "cover" : "",
    backgroundPosition: style.bgImage ? "center" : "",
    fontFamily: style.fontFamily || "",
    fontSize: style.fontSize ? `${style.fontSize}px` : "",
    fontWeight: style.bold ? "bold" : "",
    fontStyle: style.italic ? "italic" : "",
    textDecoration: style.underline ? "underline" : "",
    color: style.color || "",
    borderHidden: style.showBorder === false,
  };
}

export function applyCssToEl(el, css) {
  el.style.background = css.background;
  el.style.backgroundImage = css.backgroundImage;
  el.style.backgroundSize = css.backgroundSize;
  el.style.backgroundPosition = css.backgroundPosition;
  el.style.fontFamily = css.fontFamily;
  el.style.fontSize = css.fontSize;
  el.style.fontWeight = css.fontWeight;
  el.style.fontStyle = css.fontStyle;
  el.style.textDecoration = css.textDecoration;
  el.style.color = css.color;
  el.classList.toggle("border-hidden", css.borderHidden);
}

export function nextLabelPosition(current, positions = ["top", "right", "bottom", "left"]) {
  const i = positions.indexOf(current);
  return positions[(i + 1) % positions.length];
}

// --- Selection-scoped rich text --------------------------------------------

export function wrapSelectionWithStyle(cssProp, cssValue) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const span = document.createElement("span");
  if (cssValue) span.style[cssProp] = cssValue;
  try {
    range.surroundContents(span);
  } catch {
    // Selection spans multiple partial nodes surroundContents can't
    // wrap directly (a known Range API limitation) — fall back to
    // extract-and-reinsert instead.
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
  }
  sel.removeAllRanges();
}

export function applyDescendantTextStyleTo(wrapperEl, cssProp, cssValue) {
  wrapperEl
    .querySelectorAll(".block-name, .field-label, .field-value, .label-block-text")
    .forEach((el) => {
      el.style[cssProp] = cssValue || "";
    });
}

export function applyTextStyleToOwnTextWith(wrapperEl, style) {
  const rules = [
    ["fontFamily", style.fontFamily || ""],
    ["fontSize", style.fontSize ? `${style.fontSize}px` : ""],
    ["fontWeight", style.bold ? "bold" : ""],
    ["fontStyle", style.italic ? "italic" : ""],
    ["textDecoration", style.underline ? "underline" : ""],
    ["color", style.color || ""],
  ];
  wrapperEl
    .querySelectorAll(".block-name, .field-label, .field-value, .label-block-text")
    .forEach((el) => {
      if (el.closest(".style-popover")) return;
      rules.forEach(([prop, value]) => { el.style[prop] = value; });
    });
}

/** Applies a style change either to the current text SELECTION (if one
 *  exists inside this node's editable value area) or to the whole node.
 *  Returns true when the WHOLE node's style changed. Takes explicit
 *  deps (no sheet closure):
 *
 *    applyStyleChangeInto(wrapperEl, node, {cssProp, cssValue, styleKey,
 *      toggle, rawValue}, {forEditing, setValue, commit, applyStyle,
 *      descendFn, persistFn})
 */
export function applyStyleChangeInto(wrapperEl, node, { cssProp, cssValue, styleKey, toggle = false, rawValue }, deps) {
  const { forEditing, setValue, commit, applyStyle, descendFn, persistFn } = deps;
  const sel = window.getSelection();
  // Only a FIELD has its own editable value — for a block, this must
  // be a direct-child lookup, or it would find a nested field's value
  // and wrongly treat a block-level style change as selection-scoped.
  const valueEl = wrapperEl.querySelector(":scope > .field-inner > .field-value[contenteditable]");
  const hasSelection = sel && !sel.isCollapsed && valueEl && sel.anchorNode && valueEl.contains(sel.anchorNode);

  if (hasSelection) {
    wrapSelectionWithStyle(cssProp, cssValue);
    if (valueEl) {
      node.value = valueEl.innerHTML; // keep the field's persisted value in sync
    }
  } else if (toggle) {
    const nextValue = !forEditing(node)[styleKey];
    commit(() => {
      setValue(node, styleKey, nextValue);
    }, { render: false });
    applyStyle(wrapperEl, forEditing(node));
    descendFn(wrapperEl, cssProp, nextValue ? cssValue : "");
  } else {
    const nextValue = rawValue !== undefined ? rawValue : cssValue;
    commit(() => {
      setValue(node, styleKey, nextValue);
    }, { render: false });
    applyStyle(wrapperEl, forEditing(node));
    descendFn(wrapperEl, cssProp, cssValue);
  }
  if (hasSelection) persistFn();
  return !hasSelection;
}

// --- Style popover DOM ------------------------------------------------------

export const FONT_OPTIONS = [
  ["", "Theme default"],
  ["var(--font-body)", "Body"],
  ["var(--font-display)", "Display"],
  ["Georgia, serif", "Georgia"],
  ["'Courier New', monospace", "Monospace"],
  ["'Times New Roman', serif", "Times"],
];

export function buildStyleLabelEl(text, node) {
  // styleKey is read from the label's own data attribute so callers
  // don't thread it separately — set below in buildStylePopoverInto.
  const label = document.createElement("label");
  label.textContent = text;
  return label;
}

export function markLocalOverride(label, node, styleKey) {
  if (node.styleOverrides && Object.prototype.hasOwnProperty.call(node.styleOverrides, styleKey)) {
    const badge = document.createElement("span");
    badge.className = "style-popover__badge";
    badge.textContent = "local";
    label.append(document.createTextNode(" "), badge);
  }
  return label;
}

/** Full migration of buildStylePopover from customSheet.js:
 *
 *    buildStylePopoverInto(node, wrapperEl, {
 *      forEditing, setValue, commit, applyStyle, styleChangeFn,
 *      toastFn, maxImageBytes,
 *    })
 */
export function buildStylePopoverInto(node, wrapperEl, deps) {
  const { forEditing, setValue, commit, applyStyle, styleChangeFn, toastFn, maxImageBytes } = deps;
  const pop = document.createElement("div");
  pop.className = "style-popover";
  pop.addEventListener("pointerdown", (e) => e.stopPropagation());
  const editableStyle = forEditing(node);

  function buildStyleLabel(text, styleKey) {
    const label = buildStyleLabelEl(text, node);
    return markLocalOverride(label, node, styleKey);
  }

  // Background color (whole node only — background doesn't cascade
  // to children the way font/color properties do, which is exactly
  // what keeps a field's own background from blotting out its
  // parent block's background).
  const bgRow = document.createElement("div");
  bgRow.className = "style-popover__row";
  const bgLabel = buildStyleLabel("Background", "bg");
  const bgInput = document.createElement("input");
  bgInput.type = "color";
  bgInput.value = editableStyle.bg || "#1d1a16";
  bgInput.addEventListener("input", () => {
    commit(() => {
      setValue(node, "bg", bgInput.value);
    }, { render: false });
    applyStyle(wrapperEl, forEditing(node));
  });
  bgRow.append(bgLabel, bgInput);
  pop.append(bgRow);

  // Background image
  const imgRow = document.createElement("div");
  imgRow.className = "style-popover__row";
  const imgLabel = buildStyleLabel("Bg image", "bgImage");
  const imgInput = document.createElement("input");
  imgInput.type = "file";
  imgInput.accept = "image/*";
  imgInput.addEventListener("change", () => {
    const file = imgInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result.length > maxImageBytes) {
        toastFn("That image is large enough that it (plus the rest of this character) may not fit in a single Firestore document (1MB limit). It'll be applied, but saving might fail — try a smaller image if so.");
      }
      commit(() => {
        setValue(node, "bgImage", reader.result);
      }, { render: false });
      applyStyle(wrapperEl, forEditing(node));
    };
    reader.readAsDataURL(file);
  });
  imgRow.append(imgLabel, imgInput);
  pop.append(imgRow);

  // Font family
  const fontRow = document.createElement("div");
  fontRow.className = "style-popover__row";
  const fontLabel = buildStyleLabel("Font", "fontFamily");
  const fontSelect = document.createElement("select");
  FONT_OPTIONS.forEach(([val, label]) => {
    const opt = document.createElement("option");
    opt.value = val; opt.textContent = label;
    if ((editableStyle.fontFamily || "") === val) opt.selected = true;
    fontSelect.append(opt);
  });
  fontSelect.addEventListener("change", () => {
    styleChangeFn(wrapperEl, node, { cssProp: "fontFamily", cssValue: fontSelect.value, styleKey: "fontFamily", rawValue: fontSelect.value || null });
  });
  fontRow.append(fontLabel, fontSelect);
  pop.append(fontRow);

  // Font size
  const sizeRow = document.createElement("div");
  sizeRow.className = "style-popover__row";
  const sizeLabel = buildStyleLabel("Size (px)", "fontSize");
  const sizeInput = document.createElement("input");
  sizeInput.type = "number";
  sizeInput.min = "8"; sizeInput.max = "72";
  sizeInput.value = editableStyle.fontSize || "";
  sizeInput.addEventListener("change", () => {
    const px = Number(sizeInput.value) || null;
    styleChangeFn(wrapperEl, node, { cssProp: "fontSize", cssValue: px ? `${px}px` : "", styleKey: "fontSize", rawValue: px });
  });
  sizeRow.append(sizeLabel, sizeInput);
  pop.append(sizeRow);

  // Text color
  const colorRow = document.createElement("div");
  colorRow.className = "style-popover__row";
  const colorLabel = buildStyleLabel("Text color", "color");
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = editableStyle.color || "#e8e0d0";
  colorInput.addEventListener("input", () => {
    styleChangeFn(wrapperEl, node, { cssProp: "color", cssValue: colorInput.value, styleKey: "color", rawValue: colorInput.value });
  });
  colorRow.append(colorLabel, colorInput);
  pop.append(colorRow);

  // Bold / Italic / Underline
  const togglesRow = document.createElement("div");
  togglesRow.className = "style-popover__row";
  const togglesLabel = document.createElement("label");
  togglesLabel.textContent = "Style";
  togglesRow.append(togglesLabel);
  const toggles = document.createElement("div");
  toggles.className = "style-popover__toggles";
  [
    { key: "bold", label: "B", cssProp: "fontWeight", cssValue: "bold" },
    { key: "italic", label: "I", cssProp: "fontStyle", cssValue: "italic" },
    { key: "underline", label: "U", cssProp: "textDecoration", cssValue: "underline" },
  ].forEach(({ key, label, cssProp, cssValue }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.title = node.styleOverrides && Object.prototype.hasOwnProperty.call(node.styleOverrides, key)
      ? `${label} is locally overridden`
      : label;
    btn.className = editableStyle[key] ? "active" : "";
    if (node.styleOverrides && Object.prototype.hasOwnProperty.call(node.styleOverrides, key)) {
      btn.classList.add("has-local-override");
    }
    btn.addEventListener("click", () => {
      const changedWholeNode = styleChangeFn(wrapperEl, node, { cssProp, cssValue, styleKey: key, toggle: true });
      // Only reflect the change on the button if it actually changed
      // the WHOLE node's setting — if a text selection was styled
      // instead, this button's on/off state doesn't represent that
      // (there's no single "is this selection bold" answer to show),
      // so leave it as-is rather than showing something misleading.
      if (changedWholeNode) {
        btn.classList.toggle("active", !!forEditing(node)[key]);
      }
    });
    toggles.append(btn);
  });
  togglesRow.append(toggles);
  pop.append(togglesRow);

  return pop;
}

export function buildStyleButtonInto(node, wrapperEl, deps) {
  const { popoverFn, closeFn, positionFn, setOpenPopup } = deps;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.title = "Style";
  btn.textContent = "🎨";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const already = wrapperEl.querySelector(".style-popover");
    closeFn();
    if (already) return; // toggle: clicking again just closes it
    const pop = popoverFn(node, wrapperEl);
    wrapperEl.append(pop);
    positionFn(pop);
    setOpenPopup(btn.closest(".node-toolbar"));
  });
  return btn;
}

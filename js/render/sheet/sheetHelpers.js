// sheetHelpers.js
//
// Pure, closure-free helpers extracted verbatim from customSheet.js.
// No DOM access except where the original helper itself touches the DOM
// (applyNodeStyle) — none of these read the sheet's mutable render state,
// so they are safe to unit-test and reuse from sub-modules.

export function debounce(fn, delayMs = 500) {
  let handle;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), delayMs);
  };
}

export function valuesMatch(a, b) {
  return (a ?? null) === (b ?? null);
}

export function mergeTextStyle(baseStyle = {}, localStyle = {}) {
  return {
    ...localStyle,
    fontFamily: localStyle.fontFamily ?? baseStyle.fontFamily ?? null,
    fontSize: localStyle.fontSize ?? baseStyle.fontSize ?? null,
    bold: !!(localStyle.bold || baseStyle.bold),
    italic: !!(localStyle.italic || baseStyle.italic),
    underline: !!(localStyle.underline || baseStyle.underline),
    color: localStyle.color ?? baseStyle.color ?? null,
  };
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Falsy-guarded clone for editor working copies (blank entries start
 *  null) — shared by the catalog/bundle/formula editors. */
export function deepClone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

/** Throwaway "local-…" ids for brand-new unsaved rows/tabs/entries —
 *  shared by the catalog/bundle editors. */
export function newLocalId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Tiny element builder for the sheet's repetitive DOM construction —
 *  one call instead of createElement + className + textContent +
 *  append boilerplate. Known properties assign directly (identical to
 *  the equivalent property sets); anything else becomes an attribute.
 *  `on*` values are event listeners, extra args are children (strings
 *  become text nodes, null/false are skipped). Pure construction —
 *  no behavior of its own. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else if (key === "value") node.value = value;
    else if (key === "checked") node.checked = value;
    else if (key === "disabled") node.disabled = value;
    else if (key === "type") node.type = value;
    else if (key === "placeholder") node.placeholder = value;
    else if (key === "title") node.title = value;
    else if (key === "id") node.id = value;
    else if (key === "name") node.name = value;
    else if (key === "href") node.href = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child?.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

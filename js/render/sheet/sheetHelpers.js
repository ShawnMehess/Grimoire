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

export function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

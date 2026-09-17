// sheetConstants.js
//
// Grid + sizing constants extracted verbatim from customSheet.js so the
// sheet renderer and its sub-modules share one source of truth.
// No DOM, no imports — safe to import anywhere.

export const PAGE_COLS = 16;
export const GAP_PX = 10;
export const MIN_CELL_PX = 40; // below this, the page scrolls horizontally instead of squishing cells
export const MAX_BG_IMAGE_BYTES = 250_000; // warn above this — Firestore caps a whole doc at 1MB
export const MAX_IMAGE_BYTES = 250_000; // same Firestore-doc-size reasoning as MAX_BG_IMAGE_BYTES

// Sensible starting footprint per field type when it's first added —
// a 1x1 cell is fine for a short stat but far too small to be useful
// for a text area, list, or dropdown.
export const DEFAULT_FIELD_SIZE = {
  text: { w: 1, h: 1 },
  label: { w: 2, h: 1 },
  textarea: { w: 3, h: 2 },
  textlist: { w: 3, h: 2 },
  taglist: { w: 6, h: 2 },
  dropdown: { w: 2, h: 1 },
  picture: { w: 3, h: 3 },
  catalog: { w: 2, h: 1 },
  radio: { w: 1, h: 1 },
  checkbox: { w: 1, h: 1 },
  characterlink: { w: 3, h: 1 },
};

// Radio/checkbox auto-size via syncOptionWidth (their w/h are derived
// from option count, not user-resizable); every other field type can
// be freely resized.
export const RESIZABLE_FIELD_TYPES = new Set(["text", "label", "textarea", "textlist", "taglist", "dropdown", "picture", "catalog", "featureList", "characterlink"]);

// Field types with no separate label/value split — just one element
// filling the whole field (see renderFieldInner).
export const CAPTIONLESS_FIELD_TYPES = new Set(["label", "picture", "catalog"]);

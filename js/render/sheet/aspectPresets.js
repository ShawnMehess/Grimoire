// aspectPresets.js
//
// Named target shapes for the sheet, keyed by the screen shape they're
// designed for. The grid is a fixed cell count (PAGE_COLS in
// sheetLayouts.js) with a free row count, so a preset is really "how many
// cells wide, and roughly how many rows tall before it's a scroll" — the
// same thing the arrangement presets in sheetLayouts.js assume, just
// parameterised.
//
// Two jobs:
//   1. Work out which preset a viewport is closest to, so the toolbar can
//      offer it. Detection only ever OFFERS: the spec is explicit that
//      nothing is auto-applied, because reflowing someone's sheet behind
//      their back is destructive.
//   2. Reflow a tab's blocks into a preset's shape. This is a best-guess
//      first pass and nothing more — the user is expected to drag things
//      from there, which is why a hand-tuned layout is stashed per preset
//      (see layoutVariantsFor / stashLayoutVariant) instead of being
//      recomputed on every switch.
//
// Reflow deliberately reuses the stacking math in sheetLayouts.js rather
// than inventing a second packer: one place that knows how to lay blocks
// out means the arrangement presets and the aspect presets can't drift
// into disagreeing about what a "two column" shape is.

import { PAGE_COLS } from "./sheetLayouts.js";

/** Ratio is the real number; cols/rows are the target grid shape.
 *  `cols` never exceeds PAGE_COLS — the grid math is built around that
 *  width, and a wider "preset" would just be a narrower cell, not more
 *  room. `rows` is a target extent for the reflow pass, not a cap: a
 *  sheet with more content than that still grows and scrolls. */
export const ASPECT_PRESETS = [
  { id: "16:9", name: "16:9 (widescreen)", ratio: 16 / 9, cols: PAGE_COLS, rows: 18 },
  { id: "16:10", name: "16:10 (laptop)", ratio: 16 / 10, cols: PAGE_COLS, rows: 20 },
  { id: "4:3", name: "4:3 (classic)", ratio: 4 / 3, cols: PAGE_COLS, rows: 24 },
  { id: "phone-portrait", name: "Phone portrait", ratio: 9 / 19.5, cols: 8, rows: 40 },
  { id: "phone-landscape", name: "Phone landscape", ratio: 19.5 / 9, cols: 16, rows: 14 },
  { id: "tablet-portrait", name: "Tablet portrait", ratio: 3 / 4, cols: 12, rows: 28 },
  { id: "tablet-landscape", name: "Tablet landscape", ratio: 4 / 3, cols: PAGE_COLS, rows: 18 },
];

export const DEFAULT_ASPECT_PRESET_ID = "16:10";

/** Every preset available to a character: the shipped table plus any
 *  they defined themselves. Custom entries are looked up in their own
 *  store rather than merged into ASPECT_PRESETS, which stays the code
 *  table the shipped shapes are tested against. */
export function allAspectPresets(character) {
  return [...ASPECT_PRESETS, ...customAspectPresetsFor(character)];
}

/** A preset by id, from the shipped table or the character's own.
 *  `character` may be a character or an already-read custom list. */
export function aspectPresetById(id, character = null) {
  const custom = Array.isArray(character) ? character : customAspectPresetsFor(character);
  return ASPECT_PRESETS.find((p) => p.id === id) || custom.find((p) => p.id === id) || null;
}

// --- User-defined shapes ---------------------------------------------------
//
// The spec asks for the user to be able to make their own aspect ratios.
// Everything downstream - the reflow packer, the per-shape layout
// variants, the re-flow button - already works off a preset id, so a
// custom shape only has to be a well-formed entry and somewhere to live.
//
// They live on the character (`customAspectPresets`) rather than in a
// shared library: a shape is a personal drafting preference ("my desk
// monitor, plus one"), and there's no sharing surface for it to hang off.
//
// A custom shape needs three things, and the user shouldn't have to know
// that: a name to show, a ratio so nearestAspectPreset can offer it, and
// a column count, which is what the reflow actually does. The column
// count is derived from the ratio and the viewport width when it's left
// out, because a 3:1 shape and a 9:19 shape are the same problem at
// different sizes and a user naming a ratio doesn't know the cell grid
// exists.

/** Default column count for a ratio, mirroring the shipped table's
 *  intent: wide shapes use the full grid, tall ones narrow it.
 *  This is the same mapping the shipped presets were chosen by, not a
 *  new one. */
export function colsForRatio(ratio) {
  const r = Number(ratio);
  if (!Number.isFinite(r) || r <= 0) return PAGE_COLS;
  if (r >= 2) return PAGE_COLS; // ultrawide / multi-monitor strip
  if (r >= 1.2) return PAGE_COLS; // ordinary landscape
  if (r >= 0.95) return Math.round(PAGE_COLS * 0.8); // squarish
  if (r >= 0.7) return Math.round(PAGE_COLS * 0.75); // 4:3 portrait-ish
  if (r >= 0.5) return Math.round(PAGE_COLS * 0.5); // tablet portrait
  return Math.max(4, Math.round(PAGE_COLS * 0.5)); // phone portrait
}

/** Parse "16:9", "16/9" or "1.78" into a number, or null. */
export function parseRatio(input) {
  const text = String(input ?? "").trim();
  if (!text) return null;
  const parts = text.split(/[:x×/]/).map((s) => s.trim());
  if (parts.length === 2 && parts.every((p) => p !== "" && Number.isFinite(Number(p)))) {
    const [w, h] = parts.map(Number);
    if (h > 0 && w > 0) return w / h;
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Turn a user-entered shape into a preset entry, or null if the input
 *  isn't a usable shape. `cols` is optional; when absent it's derived
 *  from the ratio. The id is derived from the name so a custom shape and
 *  a shipped one can never collide, and so deleting and re-adding a
 *  name gives the same id. */
export function makeCustomPreset({ name, ratio, cols, rows } = {}) {
  const label = String(name ?? "").trim();
  const r = parseRatio(ratio);
  if (!label || !r) return null;
  const id = `custom:${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "shape"}`;
  const wantCols = Math.round(Number(cols));
  const wantRows = Math.round(Number(rows));
  return {
    id,
    name: label,
    ratio: r,
    cols: Number.isFinite(wantCols) && wantCols > 0 ? Math.min(PAGE_COLS, wantCols) : colsForRatio(r),
    rows: Number.isFinite(wantRows) && wantRows > 0 ? wantRows : 24,
    custom: true,
  };
}

/** "16:9" / "0.56" — a ratio written the way a person says it, for the
 *  remove-shape menu where the stored number would be meaningless. */
export function describeRatio(ratio) {
  const r = Number(ratio);
  if (!Number.isFinite(r) || r <= 0) return "—";
  for (const [w, h] of [[16, 9], [16, 10], [4, 3], [3, 4], [9, 16], [9, 19.5], [21, 9]]) {
    if (Math.abs(w / h - r) < 0.01) return `${w}:${h}`;
  }
  return r >= 1 ? r.toFixed(2) : `1:${Math.round(1 / r)}`;
}

/** The character's own shapes, read defensively — this is user data
 *  (or a hand-edited save) and must never be able to break the sheet.
 *  Entries that don't normalize are dropped, not repaired. */
export function customAspectPresetsFor(character) {
  const raw = Array.isArray(character) ? character : character?.customAspectPresets;
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set(ASPECT_PRESETS.map((p) => p.id));
  for (const entry of raw) {
    const preset = makeCustomPreset(entry);
    if (!preset || seen.has(preset.id)) continue;
    seen.add(preset.id);
    out.push(preset);
  }
  return out;
}

/** The preset whose ratio is numerically closest to `ratio`. Distance is
 *  measured on the ratio itself rather than as a percentage, so the two
 *  phone orientations (very far apart in ratio) aren't accidentally
 *  treated as near neighbours the way they would be if the distance were
 *  normalised per-preset. Ties resolve to the earlier entry, which keeps
 *  the offer stable rather than flickering between two equally-close
 *  presets across a resize. */
export function nearestAspectPreset(ratio, character = null) {
  const r = Number(ratio);
  if (!Number.isFinite(r) || r <= 0) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const preset of allAspectPresets(character)) {
    const distance = Math.abs(preset.ratio - r);
    if (distance < bestDistance) {
      best = preset;
      bestDistance = distance;
    }
  }
  return best;
}

/** Viewport w/h as a ratio, or null if it can't be measured (a hidden
 *  tab reports 0x0, which would otherwise match nothing sensibly). */
export function viewportRatio(win = globalThis) {
  const w = win?.innerWidth;
  const h = win?.innerHeight;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

/** What the toolbar should offer: the preset matching this viewport, or
 *  null when the viewport can't be measured. Offer only — see the note at
 *  the top of this file. */
export function detectAspectPreset(win = globalThis) {
  const ratio = viewportRatio(win);
  return ratio === null ? null : nearestAspectPreset(ratio);
}

// --- Reflow ---------------------------------------------------------------

function isFullWidthNode(node) {
  return node?.blockType === "label";
}

/** Column count a preset maps to, clamped to what the grid supports and
 *  never below 1 — a corrupt stored preset shouldn't produce a layout
 *  with zero-width columns. */
export function presetCols(preset) {
  const cols = Math.round(Number(preset?.cols));
  if (!Number.isFinite(cols)) return PAGE_COLS;
  return Math.min(PAGE_COLS, Math.max(1, cols));
}

/**
 * Stack a tab's top-level blocks into `cols` columns of roughly equal
 * width, in their existing array order. Mutates and returns the layout.
 *
 * This is a first guess, not an auto-layout algorithm: it preserves
 * reading order down each column, never reorders blocks, and leaves
 * every block's own height alone. Anything smarter would be guessing at
 * content the user knows and we don't.
 */
export function reflowLayoutToCols(layout, cols) {
  const blocks = (layout || []).filter((n) => n && n.kind !== "field");
  if (!blocks.length) return layout;
  const columns = Math.max(1, Math.min(PAGE_COLS, Math.round(cols) || 1));
  // With more columns requested than the sheet has blocks, widen the
  // blocks instead of leaving a column of empty space: a 16-column
  // single-block sheet should be one full-width block, not a sliver.
  const usedColumns = Math.min(columns, Math.max(1, blocks.length));
  const actualWidth = Math.max(1, Math.floor(PAGE_COLS / usedColumns));

  const heights = new Array(usedColumns).fill(0);
  for (const node of blocks) {
    if (isFullWidthNode(node)) {
      const y = Math.max(...heights);
      node.x = 0;
      node.w = PAGE_COLS;
      node.y = y;
      const next = y + (node.h || 1);
      heights.fill(next);
      continue;
    }
    // Shortest column first, so the stack evens out instead of running
    // one column to the bottom and leaving the other empty.
    let col = 0;
    for (let i = 1; i < usedColumns; i++) {
      if (heights[i] < heights[col]) col = i;
    }
    node.x = col * actualWidth;
    node.w = actualWidth;
    node.y = heights[col];
    heights[col] += node.h || 1;
  }
  return layout;
}

/** Reflow toward a preset's shape. `rows` is advisory here — the packer
 *  only produces a row count, it can't invent or destroy content — so
 *  this is cols-only by design. */
export function applyAspectPresetTo(layout, presetId, character = null) {
  const preset = aspectPresetById(presetId, character);
  if (!preset) return layout;
  return reflowLayoutToCols(layout, presetCols(preset));
}

// --- Per-preset layout variants -------------------------------------------
//
// A user's manual arrangement is the real asset once they've touched it,
// so it's kept per (character, preset). Switching back to a preset the
// user has already adjusted restores their version instead of running the
// first-guess packer over it again.
//
// Stored on the character as a map of presetId -> tabId -> layout. It's
// the only layout data in the project that isn't the tab's own `layout`,
// and it's deliberately a SEPARATE key: the live layout is the working
// copy, this is a per-shape snapshot of it.

const EMPTY = () => ({ layouts: {}, tabs: {} });

/** Read the variant map off a character, tolerating anything (older
 *  saves, hand-edited JSON) that isn't the expected shape. */
export function layoutVariantsFor(character) {
  const raw = character?.aspectLayouts;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY();
  return {
    layouts: (raw.layouts && typeof raw.layouts === "object") ? raw.layouts : {},
    tabs: (raw.tabs && typeof raw.tabs === "object") ? raw.tabs : {},
  };
}

/** The stashed layout for a preset+tab, or null if the user hasn't
 *  adjusted one. */
export function stashedLayoutFor(character, presetId, tabId) {
  const byTab = layoutVariantsFor(character).layouts[presetId];
  const layout = byTab && byTab[tabId];
  return Array.isArray(layout) ? layout : null;
}

/** Remember a tab's current layout as this preset's variant. Deep-copied
 *  via JSON because these are plain data and the live layout keeps being
 *  mutated by drags; sharing the reference would make every drag rewrite
 *  history. Returns the character for chaining. */
export function stashLayoutVariant(character, presetId, tabId) {
  if (!character || !presetId || !tabId) return character;
  const tab = (character.sheetTabs || []).find((t) => t.id === tabId);
  if (!tab || !Array.isArray(tab.layout)) return character;
  const variants = layoutVariantsFor(character);
  const forPreset = variants.layouts[presetId] || {};
  forPreset[tabId] = JSON.parse(JSON.stringify(tab.layout));
  variants.layouts[presetId] = forPreset;
  character.aspectLayouts = variants;
  return character;
}

/** Drop a preset's stashed variant — used when the user explicitly asks to
 *  re-run the best-guess pass over a shape they've already adjusted. */
export function clearLayoutVariant(character, presetId, tabId) {
  if (!character) return character;
  const variants = layoutVariantsFor(character);
  if (tabId) {
    const forPreset = variants.layouts[presetId];
    if (forPreset) {
      delete forPreset[tabId];
      variants.layouts[presetId] = forPreset;
    }
  } else {
    delete variants.layouts[presetId];
  }
  character.aspectLayouts = variants;
  return character;
}

/**
 * Move one tab onto a preset.
 *
 * The rule the spec asks for: switching BACK to a preset the user has
 * already adjusted restores their arrangement; only a shape they've
 * never visited gets the first-guess pass. So:
 *
 *   1. If the tab is leaving a different preset, snapshot the layout it's
 *      leaving — that's the arrangement the user built, and it's what
 *      they'll want back if they return.
 *   2. If the target preset already has a snapshot for this tab, restore
 *      it (deep-copied, since the live layout keeps being mutated).
 *   3. Otherwise run the best-guess reflow.
 *
 * Returns "restored" | "reflowed" so the caller can say which happened.
 * Mutates the tab and the character's variant map in place, the way the
 * rest of the layout code does.
 */
export function switchTabToPreset(character, tab, presetId, { force = false } = {}) {
  const preset = aspectPresetById(presetId, character);
  if (!preset || !character || !tab) return "noop";

  const from = tab.aspectPresetId;
  if (!force && from && from !== presetId) {
    stashLayoutVariant(character, from, tab.id);
  }

  if (!force) {
    const stashed = stashedLayoutFor(character, presetId, tab.id);
    if (stashed) {
      tab.layout = JSON.parse(JSON.stringify(stashed));
      tab.aspectPresetId = presetId;
      return "restored";
    }
  }

  applyAspectPresetTo(tab.layout, presetId, character);
  tab.aspectPresetId = presetId;
  return "reflowed";
}

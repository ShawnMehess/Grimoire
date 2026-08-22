// blockModel.js
//
// Unified data model for the custom character sheet builder.
//
// Deliberately ONE object shape for everything on the sheet: a "node"
// is used both for what used to be called "stat blocks" (containers)
// and "stat fields" (individual values). A node with children is a
// container; a node with no children and a `fieldType` is a leaf
// value. This is the literal implementation of "blocks and fields
// should really be the same object" — there is only one factory
// shape, createNode(), underneath createBlock()/createField().
//
// Grid coordinates: everything is measured in whole cells of a single
// consistent grid (see CELL_PX/GAP_PX in customSheet.js) — never free
// pixels. Top-level nodes sit on the page grid; a container's children
// sit on THAT container's own local grid, whose column count always
// equals the container's own width in cells — so "one cell" means the
// same physical size everywhere on the sheet, nested or not.

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const FIELD_TYPES = ["text", "radio", "checkbox"];
export const LABEL_POSITIONS = ["top", "right", "bottom", "left"];

// A block's declared `h` (in blockModel.js) includes ONE reserved row
// at the top for its name label — that row isn't available to its
// children. This is baked into `h` itself (rather than tracked as a
// separate "extra" number) specifically so gridEngine.js's collision/
// compaction math never needs to know blocks are special: `h` always
// means "this node's true total footprint," full stop, for every
// kind of node.
export const BLOCK_HEADER_ROWS = 1;

function defaultStyle() {
  return {
    bg: null,          // CSS color string, or null = inherit theme
    bgImage: null,      // data URL, or null
    fontFamily: null,   // CSS font-family value, or null = inherit
    fontSize: null,      // px number, or null = inherit
    bold: false,
    italic: false,
    underline: false,
    color: null,          // CSS color string, or null = inherit
  };
}

/**
 * The single underlying shape for everything on the sheet — just the
 * properties every node needs regardless of kind. createBlock() and
 * createField() each layer their own kind-specific properties on top,
 * so a block never carries unused field properties (label, options,
 * checked...) and vice versa. This keeps saved data smaller (matters
 * once background images are in the mix — see MAX_BG_IMAGE_BYTES in
 * customSheet.js) without giving up the "one shape underneath" idea:
 * both still go through this same base, and rendering code still
 * dispatches on `kind` rather than on the presence of type-specific
 * fields.
 */
function createNode(overrides) {
  return {
    id: newId(),
    kind: "block",
    style: defaultStyle(),
    x: 0, y: 0, w: 3, h: 2,
    ...overrides,
  };
}

/** Create a new container block. `h` must be at least BLOCK_HEADER_ROWS + 1
 *  (one row for the name label, at least one for content) — the default
 *  leaves room for 2 content rows. */
export function createBlock({ name = "New Block", x = 0, y = 0, w = 3, h = 3 } = {}) {
  return createNode({ kind: "block", name, x, y, w, h: Math.max(h, BLOCK_HEADER_ROWS + 1), children: [] });
}

/** Create a new leaf field. w/h default to 1 cell; radio/checkbox fields
 *  are always exactly 1 row tall and as wide as they have options — see
 *  syncOptionWidth() below, which callers should run after changing
 *  `options` on a radio/checkbox field. */
export function createField({ fieldType = "text", label = "Stat", x = 0, y = 0, w = 1, h = 1 } = {}) {
  const field = createNode({
    kind: "field", fieldType, label, labelPosition: "top", x, y, w, h,
  });
  if (fieldType === "text") {
    field.value = "";
  } else if (fieldType === "radio") {
    field.options = 3;
    field.selected = null;
    field.w = 3; field.h = 1;
  } else if (fieldType === "checkbox") {
    field.options = 3;
    field.checked = [false, false, false];
    field.w = 3; field.h = 1;
  }
  return field;
}

/** Keep a radio/checkbox field's width in sync with its option count —
 *  call after incrementing/decrementing `options`. Options are always
 *  exactly 1 cell each, arranged horizontally, 1 row tall. */
export function syncOptionWidth(field) {
  field.w = Math.max(1, field.options);
  field.h = 1;
  if (field.fieldType === "checkbox") {
    const arr = field.checked || [];
    field.checked = Array.from({ length: field.options }, (_, i) => !!arr[i]);
  }
  if (field.fieldType === "radio" && field.selected != null && field.selected > field.options) {
    field.selected = null;
  }
}

/**
 * A representative starter layout, shown on a brand-new character.
 * This is NOT an attempt to losslessly recreate every field the old
 * fixed-schema sheet had — this system replaces that one rather than
 * migrating it field-for-field. It just seeds a new sheet with one
 * real example of each field type so the builder isn't a blank,
 * confusing page on first load.
 */
export function createStarterLayout() {
  const identity = createBlock({ name: "Identity", x: 0, y: 0, w: 4, h: 3 }); // 2 content rows + header
  identity.children = [
    createField({ fieldType: "text", label: "Name", x: 0, y: 0, w: 4, h: 1 }),
    createField({ fieldType: "text", label: "Class", x: 0, y: 1, w: 2, h: 1 }),
    createField({ fieldType: "text", label: "Level", x: 2, y: 1, w: 2, h: 1 }),
  ];

  const abilities = createBlock({ name: "Abilities", x: 4, y: 0, w: 6, h: 3 }); // 2 content rows + header
  abilities.children = ["STR", "DEX", "CON", "INT", "WIS", "CHA"].map((label, i) =>
    createField({ fieldType: "text", label, x: i, y: 0, w: 1, h: 2 })
  );

  const status = createBlock({ name: "Status", x: 0, y: 3, w: 4, h: 2 }); // 1 content row + header
  status.children = [
    createField({ fieldType: "checkbox", label: "Death Saves", x: 0, y: 0, w: 3, h: 1 }),
  ];

  const example = createBlock({ name: "Example Choice", x: 4, y: 3, w: 3, h: 2 }); // 1 content row + header
  example.children = [
    createField({ fieldType: "radio", label: "Pick One", x: 0, y: 0, w: 3, h: 1 }),
  ];

  return [identity, abilities, status, example];
}

/** Find a top-level block, or a field nested one level inside a block. */
export function findNode(layout, id) {
  for (const block of layout) {
    if (block.id === id) return block;
    if (block.children) {
      const found = block.children.find(c => c.id === id);
      if (found) return found;
    }
  }
  return null;
}

/** Find the parent array a node lives in (layout itself for a top-level
 *  block, or a block's children array for a field) — needed for add/remove. */
export function findParentArray(layout, id) {
  if (layout.some(b => b.id === id)) return layout;
  for (const block of layout) {
    if (block.children && block.children.some(c => c.id === id)) return block.children;
  }
  return null;
}

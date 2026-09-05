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

import { ABILITIES, SKILLS } from "./schema.js";

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const FIELD_TYPES = ["text", "label", "textarea", "textlist", "dropdown", "picture", "catalog", "radio", "checkbox"];
export const LABEL_POSITIONS = ["top", "right", "bottom", "left"];

// A block's declared `h` (in blockModel.js) includes ONE reserved row
// at the top for its name label — that row isn't available to its
// children. This is baked into `h` itself (rather than tracked as a
// separate "extra" number) so `h` always means "this node's true
// total footprint," full stop, for every
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
export function createBlock({ name = "New Block", x = 0, y = 0, w = 3, h = 3, blockType = "stat" } = {}) {
  return createNode({ kind: "block", blockType, name, x, y, w, h: Math.max(h, BLOCK_HEADER_ROWS + 1), children: [] });
}

export function createLabelBlock({ name = "Text Label", x = 0, y = 0, w = 4, h = 1 } = {}) {
  return createNode({ kind: "block", blockType: "label", name, x, y, w, h: Math.max(1, h), children: [] });
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
  } else if (fieldType === "label") {
    field.value = "Label text";
  } else if (fieldType === "textarea") {
    field.value = "";
  } else if (fieldType === "textlist") {
    field.items = [];
  } else if (fieldType === "dropdown") {
    field.choices = [];
    field.selected = null;
    field.autoAlphabetize = false;
  } else if (fieldType === "picture") {
    field.imageData = null;
    field.isAvatar = false;
  } else if (fieldType === "catalog") {
    // catalogSource: null (unconfigured) | { scope: "library", libraryId }
    //   | { scope: "custom", tabs: [...] } — see catalogLibraryEditor.js
    //   for the shared { id, name, tabs: [{ id, name, entries: [...] }] }
    //   shape a catalog (library or custom) is built from.
    field.catalogSource = null;
    field.moneyFieldId = null;
  } else if (fieldType === "radio") {
    field.options = 3;
    field.selected = null;
    // Optional — when set, the number of buttons actually shown is
    // this formula's computed result instead of `options` above
    // (which becomes just the fallback/default). See the "=" button
    // on a radio field's own toolbar in customSheet.js — same
    // formula tree shape as a Num Field's `formula`, just interpreted
    // as a button COUNT rather than a value.
    field.optionsFormula = null;
    syncOptionWidth(field);
  } else if (fieldType === "checkbox") {
    field.options = 3;
    field.checked = [false, false, false];
    syncOptionWidth(field);
  }
  return field;
}

/** Keep a radio/checkbox field's width in sync with its option count —
 *  call after incrementing/decrementing `options`. Up to three options
 *  fit in one grid cell, so width grows by one cell for every three
 *  options. */
export function syncOptionWidth(field) {
  field.w = Math.max(1, Math.ceil((field.options || 1) / 3));
  field.h = 1;
  if (field.fieldType === "checkbox") {
    const arr = field.checked || [];
    field.checked = Array.from({ length: field.options }, (_, i) => !!arr[i]);
  }
  if (field.fieldType === "radio" && field.selected != null && field.selected > field.options) {
    field.selected = null;
  }
}

/** Formula for a plain (non-proficiency-gated) ability modifier —
 *  rounddown((score-10)/2), matching abilityModifier() in rules.js
 *  exactly (this is the block-based engine's replacement for that
 *  fixed-schema system — see the note on createStarterLayout below). */
function abilityModFormula(scoreId) {
  return { type: "expr", text: `rounddown(({{${scoreId}}}-10)/2)` };
}

/** Formula for a save/skill modifier: the ability modifier, plus the
 *  proficiency bonus IF that save/skill's single proficiency checkbox
 *  is checked. Matches skillModifier()/savingThrowModifier() in
 *  rules.js. profCheckboxId must be a single-option (options: 1)
 *  checkbox field — see toggleField() below — so `::0` is always the
 *  right (only) index. */
function proficientModFormula(scoreId, profCheckboxId) {
  const base = `rounddown(({{${scoreId}}}-10)/2)`;
  return {
    type: "if",
    condition: `{{${profCheckboxId}::0}} = 1`,
    whenTrue: { type: "expr", text: `${base} + {{profBonus}}` },
    whenFalse: { type: "expr", text: base },
  };
}

/** createField() always overwrites `id` with a fresh random one, so a
 *  formula elsewhere can't reference it by name in advance — this
 *  wraps it to pin a caller-chosen id afterward, for every field the
 *  starter layout's formulas cross-reference. */
function field(opts, id) {
  const f = createField(opts);
  if (id) f.id = id;
  if (opts.formula) f.formula = opts.formula;
  if (opts.value !== undefined) f.value = opts.value;
  if (opts.labelPosition) f.labelPosition = opts.labelPosition;
  return f;
}

/** A single on/off proficiency marker — createField()'s own checkbox
 *  default is a row of 3 (matching syncOptionWidth's "3 per cell"
 *  rule), so this pares that down to exactly 1 before re-syncing the
 *  width down to match. */
function toggleField(opts, id) {
  const f = createField({ ...opts, fieldType: "checkbox" });
  f.options = 1;
  f.checked = [false];
  syncOptionWidth(f);
  if (opts.labelPosition) f.labelPosition = opts.labelPosition;
  if (id) f.id = id;
  return f;
}

/** A radio field with a specific option count (createField()'s own
 *  radio default is 3, which is right for some of these and wrong for
 *  others — e.g. a level-5 spell slot tracker starting most
 *  characters at 0-1 max, not 3). */
function radioField(opts, options, id) {
  const f = createField({ ...opts, fieldType: "radio" });
  f.options = options;
  syncOptionWidth(f);
  if (id) f.id = id;
  return f;
}

/**
 * The starter layout shown on a brand-new character — a working D&D
 * 5e core stat block (abilities, saves, skills, proficiency bonus,
 * combat numbers, spellcasting, attacks, inventory, and features), not
 * just a field-type demo. It replaces the fixed-schema system in
 * characterSheet.js/schema.js/formBuilder.js rather than reproducing
 * it field-for-field — same underlying D&D math (see rules.js, which
 * this mirrors formula-for-formula), but expressed as ordinary
 * blocks/fields/formulas so it's just as editable as anything a
 * person builds themselves.
 *
 * Attacks/Inventory/Features are plain "textlist" fields (one line per
 * entry, freeform text) rather than structured rows — the block/field
 * grid has no repeating-row primitive, so a real per-attack to-hit/
 * damage formula or per-item weight isn't possible here the way it is
 * for abilities/skills above. That's an honest limitation, not an
 * oversight; a personal Catalog (see catalogLibraryEditor.js) is a
 * heavier-weight option later for anyone who wants structured items.
 */
export function createStarterLayout() {
  const identity = createBlock({ name: "Identity", x: 0, y: 0, w: 4, h: 4 });
  identity.children = [
    field({ fieldType: "text", label: "Name", x: 0, y: 0, w: 4, h: 1 }),
    field({ fieldType: "text", label: "Class", x: 0, y: 1, w: 2, h: 1 }),
    field({ fieldType: "text", label: "Level", x: 2, y: 1, w: 2, h: 1, value: "1" }, "level"),
    field({
      fieldType: "text", label: "Prof. Bonus", x: 0, y: 2, w: 2, h: 1,
      formula: { type: "expr", text: "roundup({{level}}/4)+1" },
    }, "profBonus"),
    toggleField({ label: "Inspiration", x: 2, y: 2, w: 1, h: 1, labelPosition: "right" }, "inspiration"),
  ];

  const abilities = createBlock({ name: "Abilities", x: 4, y: 0, w: 6, h: 3 });
  abilities.children = ABILITIES.flatMap((ability, i) => {
    const scoreId = `${ability.id}Score`;
    return [
      field({ fieldType: "text", label: ability.label.slice(0, 3).toUpperCase(), x: i, y: 0, w: 1, h: 1, value: "10" }, scoreId),
      field({ fieldType: "text", label: "Mod", x: i, y: 1, w: 1, h: 1, formula: abilityModFormula(scoreId) }, `${ability.id}Mod`),
    ];
  });

  // 3 options = INT / WIS / CHA, in that order — the only three
  // abilities D&D ever uses for spellcasting, so a plain 1/2/3 radio
  // (rather than all 6 abilities) keeps spellAbilityMod's formula a
  // 3-way, not 6-way, branch below.
  const spellcasting = createBlock({ name: "Spellcasting", x: 10, y: 0, w: 6, h: 3 });
  spellcasting.children = [
    field({ fieldType: "radio", label: "Ability (1=INT 2=WIS 3=CHA)", x: 0, y: 0, w: 1, h: 1 }, "spellAbility"),
    field({
      fieldType: "text", label: "Mod", x: 1, y: 0, w: 1, h: 1,
      formula: {
        type: "if", condition: "{{spellAbility}} = 1",
        whenTrue: { type: "expr", text: "{{intMod}}" },
        whenFalse: {
          type: "if", condition: "{{spellAbility}} = 2",
          whenTrue: { type: "expr", text: "{{wisMod}}" },
          whenFalse: {
            type: "if", condition: "{{spellAbility}} = 3",
            whenTrue: { type: "expr", text: "{{chaMod}}" },
            whenFalse: { type: "expr", text: "0" },
          },
        },
      },
    }, "spellAbilityMod"),
    field({
      fieldType: "text", label: "Save DC", x: 2, y: 0, w: 1, h: 1,
      formula: { type: "expr", text: "8 + {{profBonus}} + {{spellAbilityMod}}" },
    }, "spellSaveDC"),
    field({
      fieldType: "text", label: "Attack", x: 3, y: 0, w: 1, h: 1,
      formula: { type: "expr", text: "{{profBonus}} + {{spellAbilityMod}}" },
    }, "spellAttackBonus"),
    // Slot trackers: click the Nth button to mark N slots used (same
    // convention as everywhere else radios are used as resource
    // trackers on this sheet, e.g. death saves). Options default low
    // (most level-1 characters need only a couple of 1st-level slots,
    // none higher) — bump each one's option count as the character
    // levels, the same way you'd resize any other radio field.
    radioField({ label: "1st", x: 0, y: 1, w: 1, h: 1 }, 4, "slots1"),
    radioField({ label: "2nd", x: 1, y: 1, w: 1, h: 1 }, 3, "slots2"),
    radioField({ label: "3rd", x: 2, y: 1, w: 1, h: 1 }, 3, "slots3"),
    radioField({ label: "4th", x: 3, y: 1, w: 1, h: 1 }, 2, "slots4"),
    radioField({ label: "5th", x: 4, y: 1, w: 1, h: 1 }, 1, "slots5"),
  ];

  const saves = createBlock({ name: "Saving Throws", x: 0, y: 4, w: 2, h: 1 + ABILITIES.length });
  saves.children = ABILITIES.flatMap((ability, i) => {
    const scoreId = `${ability.id}Score`;
    const profId = `${ability.id}SaveProf`;
    return [
      toggleField({ label: ability.label, x: 0, y: i, w: 1, h: 1, labelPosition: "right" }, profId),
      field({ fieldType: "text", label: "", x: 1, y: i, w: 1, h: 1, formula: proficientModFormula(scoreId, profId) }, `${ability.id}SaveMod`),
    ];
  });

  const skills = createBlock({ name: "Skills", x: 2, y: 4, w: 2, h: 1 + SKILLS.length });
  skills.children = SKILLS.flatMap((skill, i) => {
    const scoreId = `${skill.ability}Score`;
    const profId = `${skill.id}Prof`;
    return [
      toggleField({ label: skill.label, x: 0, y: i, w: 1, h: 1, labelPosition: "right" }, profId),
      field({ fieldType: "text", label: "", x: 1, y: i, w: 1, h: 1, formula: proficientModFormula(scoreId, profId) }, `${skill.id}Mod`),
    ];
  });

  const combat = createBlock({ name: "Combat", x: 4, y: 3, w: 6, h: 4 });
  combat.children = [
    field({ fieldType: "text", label: "Armor Class", x: 0, y: 0, w: 2, h: 1 }),
    field({ fieldType: "text", label: "Initiative", x: 2, y: 0, w: 2, h: 1, formula: { type: "expr", text: "{{dexMod}}" } }, "initiative"),
    field({ fieldType: "text", label: "Speed", x: 4, y: 0, w: 2, h: 1, value: "30" }),
    field({ fieldType: "text", label: "HP Max", x: 0, y: 1, w: 2, h: 1 }),
    field({ fieldType: "text", label: "HP Current", x: 2, y: 1, w: 2, h: 1 }),
    field({ fieldType: "text", label: "Temp HP", x: 4, y: 1, w: 2, h: 1 }),
    field({
      fieldType: "text", label: "Passive Perception", x: 0, y: 2, w: 3, h: 1,
      formula: { type: "expr", text: "10 + {{perceptionMod}}" },
    }, "passivePerception"),
  ];

  const attacks = createBlock({ name: "Attacks", x: 10, y: 3, w: 6, h: 5 });
  attacks.children = [
    field({ fieldType: "textlist", label: "Name — to hit — damage/type", x: 0, y: 0, w: 6, h: 4 }),
  ];

  const inventory = createBlock({ name: "Inventory", x: 4, y: 7, w: 6, h: 7 });
  inventory.children = [
    field({ fieldType: "text", label: "CP", x: 0, y: 0, w: 1, h: 1, value: "0" }),
    field({ fieldType: "text", label: "SP", x: 1, y: 0, w: 1, h: 1, value: "0" }),
    field({ fieldType: "text", label: "EP", x: 2, y: 0, w: 1, h: 1, value: "0" }),
    field({ fieldType: "text", label: "GP", x: 3, y: 0, w: 1, h: 1, value: "0" }),
    field({ fieldType: "text", label: "PP", x: 4, y: 0, w: 1, h: 1, value: "0" }),
    field({ fieldType: "textlist", label: "Items", x: 0, y: 1, w: 6, h: 5 }),
  ];

  const features = createBlock({ name: "Features & Traits", x: 10, y: 8, w: 6, h: 6 });
  features.children = [
    field({ fieldType: "textlist", label: "Features & Traits", x: 0, y: 0, w: 6, h: 5 }),
  ];

  return [identity, abilities, spellcasting, saves, skills, combat, attacks, inventory, features];
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

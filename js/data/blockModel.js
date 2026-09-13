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

// Starter choices for the Race/Class/Background/Subclass dropdowns
// below. Deliberately EMPTY — this used to ship a hardcoded PHB
// class/race/background/subclass list on every brand-new character,
// which is exactly the "default D&D content" that kept reappearing no
// matter what got imported or deleted from Firestore: it was never
// data, it was code baked into this file and shipped with the site.
// A brand-new character now starts with genuinely empty dropdowns.
// They get populated one of two ways: (1) by hand, via the dropdown's
// own "Edit choices" popover, same as any custom dropdown a player
// builds themselves, or (2) automatically, by running the Character
// Setup wizard after importing your own Class/Race/Background bundles
// tagged with a matching ruleset — syncRulesToSheet() in
// customSheet.js adds a real choice entry for whatever you picked if
// one doesn't already exist. Nothing here seeds PHB names anymore; if
// you want a starting roster, import it.
const STARTER_RACES = [];
const STARTER_CLASSES = [];
const STARTER_BACKGROUNDS = [];

// Was a hardcoded core-PHB subclass-by-class map. Empty for the same
// reason as above — the Subclass dropdown starts with no choices at
// all. Per-class filtering is still driven entirely by dropdownAccess
// rules on the matching Class bundle (see customSheet.js's
// liveSubclassData/getAllowedChoiceIds), so once your imported Class
// bundles carry real dropdownAccess rules, this dropdown will show
// only the right subclasses for whichever class is selected — until
// then it has nothing to show, rather than quietly falling back to
// PHB subclasses.
const SUBCLASSES_BY_CLASS = {};

function makeChoices(names) {
  return names.map((text) => ({ id: newId(), text, bundle: null }));
}

function makeSubclassChoices() {
  return Object.values(SUBCLASSES_BY_CLASS).flat().map((text) => ({ id: newId(), text, bundle: null }));
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const FIELD_TYPES = ["text", "label", "textarea", "textlist", "dropdown", "picture", "catalog", "radio", "checkbox", "featureList"];
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
  } else if (fieldType === "featureList") {
    // No own stored data — fully computed each render from whichever
    // bundles (Class/Race/Background/etc. dropdown choices) are active
    // and unlocked at the character's current level. See
    // collectGrantedFeatures/buildFeatureListValue in customSheet.js.
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
 *  rounddown((score-10)/2), the standard D&D 5e ability modifier
 *  formula (this is the block-based engine's replacement for the old
 *  fixed-schema sheet system, which no longer exists in this repo). */
function abilityModFormula(scoreId) {
  return { type: "expr", text: `rounddown(({{${scoreId}}}-10)/2)` };
}

/** Formula for a save/skill modifier: the ability modifier, plus the
 *  proficiency bonus IF that save/skill's single proficiency checkbox
 *  is checked. profCheckboxId must be a single-option (options: 1)
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
  if (opts.choices) f.choices = opts.choices;
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

/** A plain, borderless caption — a "label" field pinned to a specific
 *  spot rather than a checkbox/radio's own cramped inline label.
 *  Used below for things like a skill/save's full name, which needs
 *  real width of its own: a checkbox or radio's w/h is dictated
 *  entirely by its option count (see syncOptionWidth) and can't grow
 *  to fit an inline label, so "Strength" or "Sleight of Hand" next to
 *  one just clips instead of wrapping (a single word has nowhere to
 *  break). Giving the name its own field sidesteps that rather than
 *  fighting it. */
function nameLabel(text, x, y, w, h = 1) {
  const f = createField({ fieldType: "label", label: "Label", x, y, w, h });
  f.value = text;
  return f;
}

/**
 * The starter layout shown on a brand-new character — a working D&D
 * 5e sheet (abilities, saves, skills, proficiency bonus, combat
 * numbers, spellcasting, attacks, inventory, features, and character
 * details/personality), not just a field-type demo. This is the
 * block-based engine's own take on standard D&D math (standard 5e
 * ability-modifier/proficiency-bonus formulas) and the same set of
 * fields createBlankCharacter (schema.js) still seeds on a new
 * character, expressed as ordinary blocks/fields/formulas so it's
 * just as editable as anything a person builds themselves. An earlier,
 * fixed-schema rendering of this same data (characterSheet.js/
 * formBuilder.js/rules.js) was removed once this replaced it — nothing
 * imports those anymore.
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
  // NOTE h: 5, not 4 — the extra content row is what gives Inspiration
  // room for a real "Inspiration" caption next to its checkbox instead
  // of squeezing both into one cell (see the nameLabel() comment).
  const identity = createBlock({ name: "Identity", x: 0, y: 0, w: 4, h: 5 });
  identity.children = [
    field({ fieldType: "text", label: "Name", x: 0, y: 0, w: 4, h: 1 }),
    field({ fieldType: "dropdown", label: "Class", x: 0, y: 1, w: 2, h: 1, choices: makeChoices(STARTER_CLASSES) }),
    field({ fieldType: "text", label: "Level", x: 2, y: 1, w: 2, h: 1, value: "1" }, "level"),
    field({
      fieldType: "text", label: "Prof. Bonus", x: 0, y: 2, w: 2, h: 1,
      formula: { type: "expr", text: "roundup({{level}}/4)+1" },
    }, "profBonus"),
    field({ fieldType: "text", label: "Hit Dice", x: 2, y: 2, w: 2, h: 1, value: "" }),
    toggleField({ label: "", x: 0, y: 3, w: 1, h: 1 }, "inspiration"),
    nameLabel("Inspiration", 1, 3, 3),
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
  const spellcasting = createBlock({ name: "Spellcasting", x: 10, y: 0, w: 6, h: 4 });
  spellcasting.children = [
    // The old inline label "Ability (1=INT 2=WIS 3=CHA)" was 27
    // characters trying to fit in this radio's own single cell (a
    // radio's w/h tracks its option count only — see syncOptionWidth
    // — not its label). Split it: a short "Ability" label on the
    // radio itself, and the 1/2/3 legend as its own caption with
    // proper width, in the two cells this row already had going
    // unused (x4-6, in the original layout).
    field({ fieldType: "radio", label: "Ability", x: 0, y: 0, w: 1, h: 1 }, "spellAbility"),
    nameLabel("1=INT 2=WIS 3=CHA", 1, 0, 2),
    field({
      fieldType: "text", label: "Mod", x: 3, y: 0, w: 1, h: 1,
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
      fieldType: "text", label: "Save DC", x: 4, y: 0, w: 1, h: 1,
      formula: { type: "expr", text: "8 + {{profBonus}} + {{spellAbilityMod}}" },
    }, "spellSaveDC"),
    field({
      fieldType: "text", label: "Attack", x: 5, y: 0, w: 1, h: 1,
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
    radioField({ label: "6th", x: 0, y: 2, w: 1, h: 1 }, 0, "slots6"),
    radioField({ label: "7th", x: 1, y: 2, w: 1, h: 1 }, 0, "slots7"),
    radioField({ label: "8th", x: 2, y: 2, w: 1, h: 1 }, 0, "slots8"),
    radioField({ label: "9th", x: 3, y: 2, w: 1, h: 1 }, 0, "slots9"),
  ];

  // Saves and Skills are stacked (not side by side, as an earlier pass
  // had them) — a skill/save name needs a real 2-cell-wide caption of
  // its own (see nameLabel() above) to show a full word like
  // "Investigation" or "Sleight of Hand" without clipping, and two
  // such lists side by side at half the width just reproduces the
  // same clipping one column over. Stacked, both keep the same width
  // as Identity above them (x0, w4) and the sheet stays a clean single
  // left-hand column instead of a cramped double one.
  const saves = createBlock({ name: "Saving Throws", x: 0, y: 5, w: 4, h: 1 + ABILITIES.length });
  saves.children = ABILITIES.flatMap((ability, i) => {
    const scoreId = `${ability.id}Score`;
    const profId = `${ability.id}SaveProf`;
    return [
      toggleField({ label: "Prof.", x: 0, y: i, w: 1, h: 1 }, profId),
      nameLabel(ability.label, 1, i, 2),
      field({ fieldType: "text", label: "", x: 3, y: i, w: 1, h: 1, formula: proficientModFormula(scoreId, profId) }, `${ability.id}SaveMod`),
    ];
  });

  const skills = createBlock({ name: "Skills", x: 0, y: saves.y + saves.h, w: 4, h: 1 + SKILLS.length });
  skills.children = SKILLS.flatMap((skill, i) => {
    const scoreId = `${skill.ability}Score`;
    const profId = `${skill.id}Prof`;
    return [
      toggleField({ label: "Prof.", x: 0, y: i, w: 1, h: 1 }, profId),
      nameLabel(skill.label, 1, i, 2),
      field({ fieldType: "text", label: "", x: 3, y: i, w: 1, h: 1, formula: proficientModFormula(scoreId, profId) }, `${skill.id}Mod`),
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
    field({ fieldType: "checkbox", label: "Death ✓", x: 3, y: 2, w: 1, h: 1 }, "deathSuccesses"),
    field({ fieldType: "checkbox", label: "Death ✗", x: 4, y: 2, w: 1, h: 1 }, "deathFailures"),
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
    // Computed, not manually typed — see collectGrantedFeatures in
    // customSheet.js. Shows whatever the character's Class/Race/
    // Background/etc. dropdown choices currently grant, gated by the
    // Level field. A saved character from before this field type
    // existed keeps its old plain "Features & Traits" textlist as-is;
    // this only applies to brand-new characters going forward.
    field({ fieldType: "featureList", label: "Features & Traits", x: 0, y: 0, w: 6, h: 5 }),
  ];

  const details = createBlock({ name: "Character Details", x: 4, y: 14, w: 6, h: 5 });
  details.children = [
    field({ fieldType: "dropdown", label: "Race", x: 0, y: 0, w: 2, h: 1, choices: makeChoices(STARTER_RACES) }),
    field({ fieldType: "dropdown", label: "Background", x: 2, y: 0, w: 2, h: 1, choices: makeChoices(STARTER_BACKGROUNDS) }),
    field({ fieldType: "text", label: "Alignment", x: 4, y: 0, w: 2, h: 1 }),
    field({ fieldType: "text", label: "Armor Prof.", x: 0, y: 1, w: 2, h: 1 }),
    field({ fieldType: "text", label: "Weapon Prof.", x: 2, y: 1, w: 2, h: 1 }),
    field({ fieldType: "text", label: "Tool Prof.", x: 4, y: 1, w: 2, h: 1 }),
    field({ fieldType: "text", label: "Languages", x: 0, y: 2, w: 6, h: 1 }),
    // Every core-class subclass in one flat list — which of them show
    // up here at all depends entirely on a Class-bundle dropdownAccess
    // rule (see default-bundles/classes.json) filtering by whichever
    // Class is currently selected; nothing here does that filtering
    // itself. Unfiltered (no Class bundle applied yet, or Class blank),
    // every subclass from every class is offered.
    field({ fieldType: "dropdown", label: "Subclass", x: 0, y: 3, w: 6, h: 1, choices: makeSubclassChoices() }, "subclass"),
  ];

  const personality = createBlock({ name: "Personality", x: 10, y: 14, w: 6, h: 7 });
  personality.children = [
    field({ fieldType: "textarea", label: "Personality Traits", x: 0, y: 0, w: 3, h: 2 }),
    field({ fieldType: "textarea", label: "Ideals", x: 3, y: 0, w: 3, h: 2 }),
    field({ fieldType: "textarea", label: "Bonds", x: 0, y: 2, w: 3, h: 2 }),
    field({ fieldType: "textarea", label: "Flaws", x: 3, y: 2, w: 3, h: 2 }),
    field({ fieldType: "textarea", label: "Notes", x: 0, y: 4, w: 6, h: 2 }),
  ];

  return [identity, abilities, spellcasting, saves, skills, combat, attacks, inventory, features, details, personality];
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

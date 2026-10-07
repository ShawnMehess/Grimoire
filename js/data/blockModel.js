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

import { ABILITIES, SKILLS, LANGUAGES } from "./schema.js";
export { LANGUAGES };
import { DEFAULT_CONTENT } from "./defaultContent.js";
import { FIXED_BG_ENTRIES, FIXED_CLASS_ENTRIES, FIXED_RACE_ENTRIES, SUBCLASS_BUNDLE_MAP, normSubclassKey } from "./contentFixups.js";

// Standard 5e vocabularies for the four "pick from a dropdown, it
// gets added to your list" fields below (Languages, Armor/Weapon/Tool
// Proficiencies). None of this comes from Shawn's uploaded JSON —
// same story as the spell-slot tables in dnd5e.js — so these are
// hand-written standard lists, not per-source data. LANGUAGES lives
// in schema.js (shared with extraRaces.js) rather than here.
export const ARMOR_PROFICIENCIES = ["Light Armor", "Medium Armor", "Heavy Armor", "Shields"];
export const WEAPON_PROFICIENCIES = [
  "All Simple Weapons", "All Martial Weapons",
  "Club", "Dagger", "Greatclub", "Handaxe", "Javelin", "Light Hammer", "Mace", "Quarterstaff",
  "Sickle", "Spear", "Light Crossbow", "Dart", "Shortbow", "Sling",
  "Battleaxe", "Flail", "Glaive", "Greataxe", "Greatsword", "Halberd", "Lance", "Longsword",
  "Maul", "Morningstar", "Pike", "Rapier", "Scimitar", "Shortsword", "Trident", "War Pick",
  "Warhammer", "Whip", "Blowgun", "Hand Crossbow", "Heavy Crossbow", "Longbow", "Net",
];
export const VEHICLE_PROFICIENCIES = ["Vehicles (land)", "Vehicles (water)"];

export const TOOL_PROFICIENCIES = [
  "Alchemist's Supplies", "Brewer's Supplies", "Calligrapher's Supplies", "Carpenter's Tools",
  "Cartographer's Tools", "Cobbler's Tools", "Cook's Utensils", "Glassblower's Tools",
  "Jeweler's Tools", "Leatherworker's Tools", "Mason's Tools", "Painter's Supplies",
  "Potter's Tools", "Smith's Tools", "Tinker's Tools", "Weaver's Tools", "Woodcarver's Tools",
  "Disguise Kit", "Forgery Kit", "Herbalism Kit", "Navigator's Tools", "Poisoner's Kit", "Thieves' Tools",
  "Dice Set", "Dragonchess Set", "Playing Card Set", "Three-Dragon Ante Set",
  "Bagpipes", "Drum", "Dulcimer", "Flute", "Horn", "Lute", "Lyre", "Pan Flute", "Shawm", "Viol",
  "Vehicles (land)", "Vehicles (water)",
];

/** One-line proficiency descriptions for the wizard's shared choice
 *  dialog — what being proficient with each tool lets you do. */
export const TOOL_DESCRIPTIONS = {
  "Alchemist's Supplies": "Brew potions and identify substances.",
  "Brewer's Supplies": "Brew ale and run a brewery.",
  "Calligrapher's Supplies": "Elegant writing; spot forged writing.",
  "Carpenter's Tools": "Woodwork, furniture, and structures.",
  "Cartographer's Tools": "Draft accurate maps; read them well.",
  "Cobbler's Tools": "Make and repair footwear.",
  "Cook's Utensils": "Cook filling meals from meager fare.",
  "Glassblower's Tools": "Craft glass objects and lenses.",
  "Jeweler's Tools": "Cut gems and appraise jewelry.",
  "Leatherworker's Tools": "Work leather into goods and armor.",
  "Mason's Tools": "Stonework; spot weak masonry.",
  "Painter's Supplies": "Paint portraits; spot art forgeries.",
  "Potter's Tools": "Shape clay into vessels.",
  "Smith's Tools": "Forge metal arms and armor.",
  "Tinker's Tools": "Repair and craft small mechanisms.",
  "Weaver's Tools": "Weave cloth; judge fine textiles.",
  "Woodcarver's Tools": "Carve wood tools, arrows, and art.",
  "Disguise Kit": "Alter your appearance convincingly.",
  "Forgery Kit": "Forge documents; spot fakes.",
  "Herbalism Kit": "Identify herbs; brew antitoxins.",
  "Navigator's Tools": "Navigate by stars and charts.",
  "Poisoner's Kit": "Brew poisons; spot poisoned fare.",
  "Thieves' Tools": "Pick locks and disarm traps.",
  "Dice Set": "Play dice games — and cheat at them.",
  "Dragonchess Set": "Play the draconic strategy game.",
  "Playing Card Set": "Play card games — and cheat at them.",
  "Three-Dragon Ante Set": "Play the gambling card game.",
  "Bagpipes": "Perform stirring music on the bagpipes.",
  "Drum": "Keep rhythm and signal on the drum.",
  "Dulcimer": "Perform folk tunes on the dulcimer.",
  "Flute": "Perform melodies on the flute.",
  "Horn": "Sound calls and fanfares on the horn.",
  "Lute": "Perform songs on the lute.",
  "Lyre": "Perform on the lyre.",
  "Pan Flute": "Perform pastoral tunes on pan pipes.",
  "Shawm": "Perform loud reed music on the shawm.",
  "Viol": "Perform refined pieces on the viol.",
  "Vehicles (land)": "Drive land vehicles (wagons, chariots, etc.).",
  "Vehicles (water)": "Operate water vehicles (ships, boats, etc.).",
};

/** Grouped view of the tool vocabulary for the sheet's taglist
 *  dropdown (optgroups): artisan's tools, instruments, gaming sets,
 *  specialty kits, and vehicles. Same entries as TOOL_PROFICIENCIES, only
 *  organized — the wizard's flat pickers keep using the flat list. */
const TOOL_INSTRUMENTS = new Set(["Bagpipes", "Drum", "Dulcimer", "Flute", "Horn", "Lute", "Lyre", "Pan Flute", "Shawm", "Viol"]);
const TOOL_GAMING_SETS = new Set(["Dice Set", "Dragonchess Set", "Playing Card Set", "Three-Dragon Ante Set"]);
const TOOL_KITS = new Set(["Disguise Kit", "Forgery Kit", "Herbalism Kit", "Navigator's Tools", "Poisoner's Kit", "Thieves' Tools"]);
const TOOL_VEHICLES = new Set(["Vehicles (land)", "Vehicles (water)"]);

export const TOOL_PROFICIENCY_GROUPS = [
  { label: "Artisan's Tools", options: TOOL_PROFICIENCIES.filter((t) => !TOOL_INSTRUMENTS.has(t) && !TOOL_GAMING_SETS.has(t) && !TOOL_KITS.has(t) && !TOOL_VEHICLES.has(t)) },
  { label: "Musical Instruments", options: TOOL_PROFICIENCIES.filter((t) => TOOL_INSTRUMENTS.has(t)) },
  { label: "Gaming Sets", options: TOOL_PROFICIENCIES.filter((t) => TOOL_GAMING_SETS.has(t)) },
  { label: "Kits & Specialty Tools", options: TOOL_PROFICIENCIES.filter((t) => TOOL_KITS.has(t)) },
  { label: "Vehicles", options: TOOL_PROFICIENCIES.filter((t) => TOOL_VEHICLES.has(t)) },
];

/** Which tool categories a pick is actually allowed to offer.
 *
 *  The sheet's flat picker used to offer the whole TOOL_PROFICIENCIES list
 *  for every tool slot, so a background that reads "proficiency in one
 *  artisan's tool of your choice" also let you pick a lute, a gaming set
 *  or a wagon. The grouping headings were there, but a heading is not a
 *  rule: the rules only let you choose within the kind named.
 *
 *  So the pick's own text decides. A label that names a kind gets only
 *  that kind; a label that does not ("one tool of your choice", "two tool
 *  proficiencies") keeps every category, because "tool proficiency"
 *  without a qualifier really is any of them.
 *
 *  Order matters: "musical instrument" is checked before the generic
 *  "tool" wording, and the vehicle/kits wording before artisan's, because
 *  a label like "one kits or specialty tool" must not be read as artisan's.
 */
export function toolGroupsForLabel(label) {
  const text = String(label || "").toLowerCase();
  const byLabel = (want) => TOOL_PROFICIENCY_GROUPS.filter((g) => g.label === want);
  if (/\binstrument/.test(text)) return byLabel("Musical Instruments");
  if (/gaming set|dice|card/.test(text)) return byLabel("Gaming Sets");
  if (/kits?|specialty|disguise|forgery|herbalism|poison|thieves'? tools|navigator/.test(text)) {
    return byLabel("Kits & Specialty Tools");
  }
  if (/vehicle|cart|wagon|carriage|sled|boat|ship/.test(text)) return byLabel("Vehicles");
  if (/artisan|artificer/.test(text)) return byLabel("Artisan's Tools");
  return TOOL_PROFICIENCY_GROUPS;
}

// Starter choices for the Race/Class/Background/Subclass dropdowns
// below. These come straight from DEFAULT_CONTENT (compiled from
// Shawn's own classes/races/backgrounds JSON — see RESCUE-NOTES.md
// for how it was built and how to regenerate it) rather than a
// hand-typed PHB list — each choice carries its real `bundle`
// (proficiencies, features, ability bonuses, subclass access) baked
// in directly, so selecting one on a brand-new character works
// immediately with no import step. The Bundle Library/Catalog import
// UI still exists in the code but is hidden from the toolbar for now
// (see customSheet.js) — homebrew-via-import is a later project.
// Starter dropdowns read alphabetically, and so does every picker that
// falls back to these same orders — one helper, so the sheet's dropdown
// and the wizard's row list can never disagree about the order.
// (A row that makes you choose from two or more dropdowns is NOT one of
// these: ability pickers are left in their own order on purpose.)
const byName = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
const STARTER_RACES = FIXED_RACE_ENTRIES.map((r) => r.name).sort(byName);
const STARTER_CLASSES = FIXED_CLASS_ENTRIES.map((c) => c.name).sort(byName);
const STARTER_BACKGROUNDS = FIXED_BG_ENTRIES.map((b) => b.name).sort(byName);

const RACE_BUNDLE_ENTRIES = FIXED_RACE_ENTRIES;
const CLASS_BUNDLE_ENTRIES = FIXED_CLASS_ENTRIES;
const BG_BUNDLE_ENTRIES = FIXED_BG_ENTRIES;

function bundleForName(entries, name) {
  return entries.find((e) => e.name === name)?.bundle || null;
}

function makeChoices(names, entries) {
  return names.map((text) => ({ id: newId(), text, bundle: entries ? bundleForName(entries, text) : null }));
}

export function raceBundleEntries() {
  return RACE_BUNDLE_ENTRIES;
}

export function classBundleEntries() {
  return CLASS_BUNDLE_ENTRIES;
}

export function subclassBundleFor(choiceText) {
  return SUBCLASS_BUNDLE_MAP.get(normSubclassKey(choiceText)) || null;
}

function makeSubclassChoices() {
  // Pre-built flat list (id/text) straight from the compiled content
  // — ids match exactly what each class's
  // dropdownAccess.allowedChoiceIds references, so per-class
  // filtering (see liveSubclassData in customSheet.js) works without
  // any extra wiring here. The mechanics bundle (level grants,
  // auto-prepared spells, Hunter's Prey / Champion style picks) is
  // attached from the patched supplement by normalized name; choices
  // with no supplement match keep bundle null exactly as before.
  return DEFAULT_CONTENT.subclassChoices.map((c) => ({
    ...c,
    bundle: SUBCLASS_BUNDLE_MAP.get(normSubclassKey(c.text)) || null,
  }));
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const FIELD_TYPES = ["text", "label", "textarea", "textlist", "taglist", "dropdown", "picture", "catalog", "radio", "checkbox", "featureList", "characterlink"];
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
    borderColor: null,    // CSS color string, or null = theme default
    borderShape: null,    // one of THEME_BORDER_SHAPES ids, or null = theme default
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
    // Hidden in play mode (calc-only fields for online play) — always
    // visible while editing (ghosted) and in print.
    hidden: false,
    // Whether this node's Label element is shown. Every field and block
    // ships with one (see labelToggleBtnInto in sheetStyles.js for the
    // delete/restore control); `true` is the default, stored explicitly
    // so an existing saved sheet — which has no such property — reads as
    // "has a label" rather than silently losing it. Deleting the element
    // is a rendering choice only: `label`/`name` still names the field
    // for formulas, the LHS list, and the character card.
    showLabel: true,
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
    // Whether the hover dice roller appears on this field. Off by
    // default — rolling only makes sense for checks, saves, and
    // attacks, so the starter sheet opts its modifier fields in
    // (see ensureRollableFlags in customSheet.js) and anyone can flip
    // any field with the toolbar dice button.
    field.rollable = false;
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
  } else if (fieldType === "characterlink") {
    // A link to another character sheet (mounts, companions,
    // familiars — those ARE full characters, linked here). Stores the
    // target id plus a name snapshot for display when offline.
    field.linkedCharacterId = null;
    field.linkedCharacterName = "";
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
  if (opts.tooltip) f.tooltip = opts.tooltip;
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
  if (opts.tooltip) f.tooltip = opts.tooltip;
  if (id) f.id = id;
  return f;
}

/** "Pick from a dropdown, it gets added to your list" field — used
 *  for Languages and Armor/Weapon/Tool Proficiencies below.
 *  `tagOptions` is the fixed vocabulary offered in the dropdown;
 *  `items` (empty to start) holds whatever's been manually added —
 *  see buildTagListValue in customSheet.js for the actual widget,
 *  and the "grantTag" statModifier op for how a Race/Class/
 *  Background's own fixed or chosen proficiencies show up here too,
 *  locked, without living in `items` at all. */
function tagListField(opts, tagOptions, id, tagGroups = null) {
  const f = createField({ ...opts, fieldType: "taglist" });
  f.tagOptions = tagOptions;
  if (tagGroups) f.tagGroups = tagGroups;
  f.items = [];
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
  if (opts.tooltip) f.tooltip = opts.tooltip;
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
  // NOTE h: 6. `h` is the block's TOTAL footprint and one row of it is
  // reserved for this block's name (see BLOCK_HEADER_ROWS), so the five
  // content rows below need h: 6, not h: 5. It was 5 - which reads as
  // "one spare row" and is not: the body starts BELOW the header, and
  // `.block-body` is overflow:hidden, so the Inspiration toggle on row 4
  // was drawn past the bottom edge of its own block and never seen.
  // `requiredBlockHeight` (js/data/blockFit.js) is what proves it.
  //
  // Race and Background live HERE now, moved up from Character Details.
  // They are the other two answers the Identity block already collects -
  // name, class, subclass, level - and they were the first row of a block
  // named "Character Details", three blocks down the sheet, which is a long
  // way to scroll to finish the sentence "who is this character".
  //
  // Display-only for existing characters: block children are written into
  // character.layout at creation, so a saved sheet keeps the fields it was
  // built with. See createStarterLayout's own doc comment.
  const identity = createBlock({ name: "Identity", x: 0, y: 0, w: 4, h: 6 });
  identity.children = [
    field({ fieldType: "text", label: "Name", x: 0, y: 0, w: 4, h: 1 }),
    // Class and Subclass sit side by side — the subclass id ("subclass")
    // is pinned: bundle dropdownAccess rules and formulas target it.
    field({ fieldType: "dropdown", label: "Class", x: 0, y: 1, w: 2, h: 1, choices: makeChoices(STARTER_CLASSES, CLASS_BUNDLE_ENTRIES) }),
    field({ fieldType: "dropdown", label: "Subclass", x: 2, y: 1, w: 2, h: 1, choices: makeSubclassChoices() }, "subclass"),
    // Race and Background, side by side. Both are PINNED by label, not id —
    // they have no id, and bundle statModifiers and the wizard both find
    // them by label, so renaming either breaks those in a way renaming a
    // labelled pinned id would not.
    field({ fieldType: "dropdown", label: "Race", x: 0, y: 2, w: 2, h: 1, choices: makeChoices(STARTER_RACES, RACE_BUNDLE_ENTRIES) }),
    field({ fieldType: "dropdown", label: "Background", x: 2, y: 2, w: 2, h: 1, choices: makeChoices(STARTER_BACKGROUNDS, BG_BUNDLE_ENTRIES) }),
    field({ fieldType: "text", label: "Level", x: 0, y: 3, w: 1, h: 1, value: "1", tooltip: "Total character level across all classes." }, "level"),
    field({
      fieldType: "text", label: "Prof. Bonus", x: 1, y: 3, w: 2, h: 1,
      formula: { type: "expr", text: "roundup({{level}}/4)+1" },
      tooltip: "Added to everything you're proficient in — attacks, saves, skills, spell DCs. Grows with total level.",
    }, "profBonus"),
    field({ fieldType: "text", label: "Hit Dice", x: 3, y: 3, w: 1, h: 1, value: "", tooltip: "Your class's hit die type (d6–d12). Spend these to heal on short rests." }),
    toggleField({ label: "", x: 0, y: 4, w: 1, h: 1, tooltip: "Awarded by the DM for good roleplay. Spend it for advantage on one roll." }, "inspiration"),
    nameLabel("Inspiration", 1, 4, 3),
  ];

  // Each ability's modifier sits BESIDE its score, not under it. They used
  // to be two rows of six: a row of six score boxes, then a row of six
  // "Mod" boxes directly underneath, so reading one ability meant finding
  // column three twice and trusting the columns still lined up. Side by
  // side, a score and its modifier are one thing you read once.
  //
  // Three abilities per row in a six-column block, so the CONTENT is two
  // rows tall - which with the reserved name row makes the block h: 3. It
  // was h: 2, one row short, and that is the whole of the "only STR, DEX
  // and CON are visible" bug: INT, WIS and CHA were rendered a full cell
  // below this block's own bottom edge and `.block-body`'s overflow:hidden
  // ate them. Which is where the room in the middle column went.
  const abilities = createBlock({ name: "Abilities", x: 4, y: 0, w: 6, h: 3 });
  abilities.children = ABILITIES.flatMap((ability, i) => {
    const scoreId = `${ability.id}Score`;
    const x = (i % 3) * 2;
    const y = Math.floor(i / 3);
    return [
      field({ fieldType: "text", label: ability.label.slice(0, 3).toUpperCase(), x, y, w: 1, h: 1, value: "10" }, scoreId),
      field({ fieldType: "text", label: "Mod", x: x + 1, y, w: 1, h: 1, formula: abilityModFormula(scoreId) }, `${ability.id}Mod`),
    ];
  });

  // INT / WIS / CHA are the only three abilities D&D ever uses for
  // spellcasting, so a 3-choice dropdown (rather than all 6
  // abilities) keeps spellAbilityMod's formula a 3-way, not 6-way,
  // branch below. Choice ids stay "1"/"2"/"3", which is exactly what
  // that formula compares against — and what formulas read from any
  // numeric-id dropdown.
  const spellcasting = createBlock({ name: "Spellcasting", x: 10, y: 0, w: 6, h: 4 });
  spellcasting.children = [
    field({
      fieldType: "dropdown", label: "Spell Ability", x: 0, y: 0, w: 3, h: 1,
      choices: [
        { id: "1", text: "Intelligence" },
        { id: "2", text: "Wisdom" },
        { id: "3", text: "Charisma" },
      ],
      tooltip: "Which ability powers your spells. Sets your Save DC and spell attacks — pick once.",
    }, "spellAbility"),
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
      tooltip: "Enemies must beat this number to resist your spells.",
    }, "spellSaveDC"),
    field({
      fieldType: "text", label: "Attack", x: 5, y: 0, w: 1, h: 1,
      formula: { type: "expr", text: "{{profBonus}} + {{spellAbilityMod}}" },
      tooltip: "Added to your attack rolls when you cast spells at a target.",
    }, "spellAttackBonus"),
    // Slot trackers: click the Nth button to mark N slots used (same
    // convention as everywhere else radios are used as resource
    // trackers on this sheet, e.g. death saves). Options default low
    // (most level-1 characters need only a couple of 1st-level slots,
    // none higher) — bump each one's option count as the character
    // levels, the same way you'd resize any other radio field.
    radioField({ label: "1st", x: 0, y: 1, w: 1, h: 1, tooltip: "Mark one per spell slot you've spent. Long rests restore them all." }, 4, "slots1"),
    radioField({ label: "2nd", x: 1, y: 1, w: 1, h: 1, tooltip: "Mark one per spell slot you've spent. Long rests restore them all." }, 3, "slots2"),
    radioField({ label: "3rd", x: 2, y: 1, w: 1, h: 1, tooltip: "Mark one per spell slot you've spent. Long rests restore them all." }, 3, "slots3"),
    radioField({ label: "4th", x: 3, y: 1, w: 1, h: 1, tooltip: "Mark one per spell slot you've spent. Long rests restore them all." }, 2, "slots4"),
    radioField({ label: "5th", x: 4, y: 1, w: 1, h: 1, tooltip: "Mark one per spell slot you've spent. Long rests restore them all." }, 1, "slots5"),
    radioField({ label: "6th", x: 0, y: 2, w: 1, h: 1, tooltip: "Mark one per spell slot you've spent. Long rests restore them all." }, 0, "slots6"),
    radioField({ label: "7th", x: 1, y: 2, w: 1, h: 1, tooltip: "Mark one per spell slot you've spent. Long rests restore them all." }, 0, "slots7"),
    radioField({ label: "8th", x: 2, y: 2, w: 1, h: 1, tooltip: "Mark one per spell slot you've spent. Long rests restore them all." }, 0, "slots8"),
    radioField({ label: "9th", x: 3, y: 2, w: 1, h: 1, tooltip: "Mark one per spell slot you've spent. Long rests restore them all." }, 0, "slots9"),
  ];

  // Saves and Skills are stacked (not side by side, as an earlier pass
  // had them) — a skill/save name needs a real 2-cell-wide caption of
  // its own (see nameLabel() above) to show a full word like
  // "Investigation" or "Sleight of Hand" without clipping, and two
  // such lists side by side at half the width just reproduces the
  // same clipping one column over. Stacked, both keep the same width
  // as Identity above them (x0, w4) and the sheet stays a clean single
  // left-hand column instead of a cramped double one.
  //
  // THE COLUMN MATH, which every block below participates in.
  // Content heights (name row included, per BLOCK_HEADER_ROWS):
  //
  //   x0  w4   Identity 6 + Saving Throws 7 + Combat 6 + Features 7 = 26
  //   x4  w6   Abilities 3 + Inventory 7 + Details 5 + Story 13     = 28
  //   x10 w6   Spellcasting 4 + Attacks 5 + Skills 19               = 28
  //
  // All three start at y0, so they need different gaps to finish level -
  // and they do: a single blank row after each block in the left column
  // would end it at 29, the middle at 31 and the right at 30. Hence
  // TWO blank rows between blocks on the left and the right (which need
  // 6 and 4 of them) and 1/2/1 in the middle (which needs 4). All three
  // end on row 32, which is what verify-content's even-column-bottoms
  // check is about: the sheet is printed, and a ragged bottom edge
  // shows.
  //
  // Left column (x0 w4): ends y28 - now y32.
  const saves = createBlock({ name: "Saving Throws", x: 0, y: 8, w: 4, h: 1 + ABILITIES.length });
  saves.children = ABILITIES.flatMap((ability, i) => {
    const scoreId = `${ability.id}Score`;
    const profId = `${ability.id}SaveProf`;
    return [
      toggleField({ label: "Prof.", x: 0, y: i, w: 1, h: 1 }, profId),
      nameLabel(ability.label, 1, i, 2),
      field({ fieldType: "text", label: "", x: 3, y: i, w: 1, h: 1, formula: proficientModFormula(scoreId, profId) }, `${ability.id}SaveMod`),
    ];
  });

  // Skills takes the whole width of its column (w6): proficiency box,
  // a roomy name caption, and the modifier — no clipping.
  const skills = createBlock({ name: "Skills", x: 10, y: 13, w: 6, h: 1 + SKILLS.length });
  skills.children = SKILLS.flatMap((skill, i) => {
    const scoreId = `${skill.ability}Score`;
    const profId = `${skill.id}Prof`;
    return [
      toggleField({ label: "Prof.", x: 0, y: i, w: 1, h: 1 }, profId),
      nameLabel(skill.label, 1, i, 4),
      field({ fieldType: "text", label: "", x: 5, y: i, w: 1, h: 1, formula: proficientModFormula(scoreId, profId) }, `${skill.id}Mod`),
    ];
  });

  const combat = createBlock({ name: "Combat", x: 0, y: 17, w: 4, h: 6 });
  combat.children = [
    // Stable ids ("armorClass", "initiative", "speed", "hpMax",
    // "passivePerception") are what bundle statModifiers target — e.g.
    // the Mobile feat's +10 speed or Alert's +5 initiative (see
    // js/data/featBundles.js). Keep them pinned: formulas and bundles
    // reference these ids, not labels.
    field({ fieldType: "text", label: "Armor Class", x: 0, y: 0, w: 2, h: 1 }, "armorClass"),
    field({ fieldType: "text", label: "Initiative", x: 2, y: 0, w: 2, h: 1, formula: { type: "expr", text: "{{dexMod}}" } }, "initiative"),
    field({ fieldType: "text", label: "Speed", x: 0, y: 1, w: 2, h: 1, value: "30" }, "speed"),
    field({ fieldType: "text", label: "HP Max", x: 2, y: 1, w: 2, h: 1 }, "hpMax"),
    field({ fieldType: "text", label: "HP Current", x: 0, y: 2, w: 2, h: 1 }),
    field({ fieldType: "text", label: "Temp HP", x: 2, y: 2, w: 2, h: 1, tooltip: "Extra hit points that absorb damage first. They don't stack, and fade on a long rest." }),
    field({
      fieldType: "text", label: "Passive Perception", x: 0, y: 3, w: 4, h: 1,
      formula: { type: "expr", text: "10 + {{perceptionMod}}" },
      tooltip: "What you notice without actively looking. Your DM checks this against sneaking enemies and hidden things.",
    }, "passivePerception"),
    field({ fieldType: "checkbox", label: "Death ✓", x: 0, y: 4, w: 1, h: 1, tooltip: "Death saving throw successes. Three successes stabilizes you." }, "deathSuccesses"),
    field({ fieldType: "checkbox", label: "Death ✗", x: 1, y: 4, w: 1, h: 1, tooltip: "Death saving throw failures. Three failures kills your character." }, "deathFailures"),
  ];

  // The separate "Equipment Proficiencies" block is GONE.
  //
  // It was added by the Gear-tab removal carrying the same four taglists
  // that Character Details already had - armorProf, weaponProf, toolProf,
  // vehicleProf, the same ids, the same vocabularies. A new character got
  // two sets of four identical fields on one sheet, stacked on top of each
  // other in reading order, with the Character Details copy first. Anything
  // typed into one never appeared in the other.
  //
  // It is removed rather than kept as a second home, because a proficiency
  // has exactly one value and the sheet has no rule saying which of two
  // identical fields wins.
  //
  // Display-only in the sense that this is the STARTER layout: existing
  // characters keep the block they were created with, and nothing in the
  // app reads it. see createStarterLayout's doc comment.
  // Attacks is a h: 5 list. The textlist is h: 4, so with the reserved
  // name row the block needs 5 and not the 4 it used to be declared -
  // same off-by-one as Abilities, and the same clipping: the bottom row
  // of every attack was drawn past the block's own edge. One spare row
  // over the list is also simply useful, which is why the two-row gap
  // below it is not reclaimed.
  const attacks = createBlock({ name: "Attacks", x: 10, y: 6, w: 6, h: 5 });
  attacks.children = [
    field({ fieldType: "textlist", label: "Name — to hit — damage/type", x: 0, y: 0, w: 6, h: 4 }, "attacks"),
  ];

  // Middle column (x4 w6): Abilities, Inventory, Details, Story — ends y32.
  const inventory = createBlock({ name: "Inventory", x: 4, y: 4, w: 6, h: 7 });
  inventory.children = [
    field({ fieldType: "text", label: "CP", x: 0, y: 0, w: 1, h: 1, value: "0" }),
    field({ fieldType: "text", label: "SP", x: 1, y: 0, w: 1, h: 1, value: "0" }),
    field({ fieldType: "text", label: "EP", x: 2, y: 0, w: 1, h: 1, value: "0" }),
    field({ fieldType: "text", label: "GP", x: 3, y: 0, w: 1, h: 1, value: "0" }),
    field({ fieldType: "text", label: "PP", x: 4, y: 0, w: 1, h: 1, value: "0" }),
    field({ fieldType: "textlist", label: "Items", x: 0, y: 1, w: 6, h: 5 }),
  ];

  const features = createBlock({ name: "Features & Traits", x: 0, y: 25, w: 4, h: 7 });
  features.children = [
    // Computed, not manually typed — see collectGrantedFeatures in
    // customSheet.js. Shows whatever the character's Class/Race/
    // Background/etc. dropdown choices currently grant, gated by the
    // Level field. A saved character from before this field type
    // existed keeps its old plain "Features & Traits" textlist as-is;
    // this only applies to brand-new characters going forward.
    field({ fieldType: "featureList", label: "Features & Traits", x: 0, y: 0, w: 4, h: 6, tooltip: "Everything your race, class, and background grant, unlocked automatically as you level." }),
  ];

// Character Details keeps the four proficiencies and nothing else. Race,
  // Background and Alignment moved UP to Identity, and Languages moved up to
  // the top of Story - which leaves this block holding exactly the thing it is
  // named for, laid out 2x2 instead of three rows with two full-width boxes
  // under a row of three half-width ones.
  //
  // h: 5, not 4: the four taglists run to row 4 and the name row is not one
  // of the four.
  const details = createBlock({ name: "Character Details", x: 4, y: 13, w: 6, h: 5 });
  details.children = [
    tagListField({ label: "Armor Prof.", x: 0, y: 0, w: 3, h: 2 }, ARMOR_PROFICIENCIES, "armorProf"),
    tagListField({ label: "Weapon Prof.", x: 3, y: 0, w: 3, h: 2 }, WEAPON_PROFICIENCIES, "weaponProf"),
    tagListField({ label: "Tool Prof.", x: 0, y: 2, w: 3, h: 2 }, TOOL_PROFICIENCIES, "toolProf", TOOL_PROFICIENCY_GROUPS),
    tagListField({ label: "Vehicle Prof.", x: 3, y: 2, w: 3, h: 2 }, VEHICLE_PROFICIENCIES, "vehicleProf"),
  ];

  // "Personality" became "Story" when Appearance and Backstory moved in
  // (below). Renaming the block rather than adding a second one is what
  // keeps the sheet legible: a sheet whose story is split across two
  // distant blocks, one labelled "Personality" holding bonds and flaws and
  // another holding appearance, is worse than the single blank rows it
  // replaces. Display-only change - block ids are random and generated per
  // character, so saved sheets keep the name they were built with.
  //
  // It grew from 7 rows to 13 to make room for two more textareas and for
  // its own reserved name row - the twelve rows of content below need a
  // thirteenth, and the one that was missing is why the Notes line at the
  // very bottom of the sheet was never visible. The middle column had the
  // gap to absorb that and the other two did not, which is exactly the
  // constraint verify-content's even-column-bottoms check exists to catch.
  const personality = createBlock({ name: "Story", x: 4, y: 19, w: 6, h: 13 });
  personality.children = [
    // Languages FIRST, then Alignment, then the writing.
    //
    // Both are facts about who the character IS rather than a story, and
    // both used to live in Character Details - Languages in the middle of
    // four proficiency boxes, Alignment in a row with Race and Background.
    // Languages at the TOP is deliberate: it is the one field on this sheet
    // a player reaches for during play ("what does this character speak?"),
    // so it should be the first thing under the block heading rather than
    // the fourth row of another block.
    tagListField({ label: "Languages", x: 0, y: 0, w: 6, h: 1 }, LANGUAGES, "languages"),
    field({ fieldType: "text", label: "Alignment", x: 0, y: 1, w: 6, h: 1 }),
    // Appearance and Backstory are the two blanks the sheet had nowhere to
    // put. Every other part of a character was representable and these two
    // were not, which meant a player had to keep them somewhere else and
    // re-type them every session.
    //
    // Both are plain textareas on purpose. Appearance and Backstory have no
    // sourced vocabulary in this data - no catalog carries "distinguishing
    // marks" or a list of features - so any option list here would be
    // invented, and a dropdown that only offers what the data happens to
    // hold is worse than an empty box for two fields whose whole purpose is
    // whatever you want to say.
    field({ fieldType: "textarea", label: "Appearance", x: 0, y: 2, w: 3, h: 3, tooltip: "How your character looks: height, build, hair, eyes, clothing, distinguishing marks. Anything you want to remember them by." }),
    field({ fieldType: "textarea", label: "Backstory", x: 3, y: 2, w: 3, h: 3, tooltip: "Where your character came from and what happened before this. Your background's mechanical benefits are picked elsewhere - this is the story behind them." }),
    field({ fieldType: "textarea", label: "Personality Traits", x: 0, y: 5, w: 3, h: 3 }),
    field({ fieldType: "textarea", label: "Ideals", x: 3, y: 5, w: 3, h: 3 }),
    field({ fieldType: "textarea", label: "Bonds", x: 0, y: 8, w: 3, h: 3 }),
    field({ fieldType: "textarea", label: "Flaws", x: 3, y: 8, w: 3, h: 3 }),
    field({ fieldType: "textarea", label: "Notes", x: 0, y: 11, w: 6, h: 1 }),
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

// startingEquipment.js — hand-written 2014 PHB starting packages (+ TCE
// Artificer).
//
// The PHB gives each class a FIXED list with independent either/or
// rows — e.g. the Fighter takes chain mail OR (leather + longbow),
// AND a martial weapon + shield OR two martial weapons, AND ... —
// never a set of exclusive whole-kit "paths", so the data mirrors
// that: `fixed` lines everyone of that class takes, plus `decisions`
// (one pick each), plus the take-gold-instead fallback. Every
// decision is answered through a picker dialog, so no row may offer a
// category ("any simple weapon") in place of the things in it — see
// WEAPONS and INSTRUMENTS below.
//
// Shape:
//   CLASS_STARTING_EQUIPMENT = { [className]: { gold: { gp, formula },
//     fixed: [...], decisions: [{ id, label, options: [{ id, label, items }] }] }
//     BG_STARTING_EQUIPMENT = { [bgName]: { items: [...], gp } }
// Item strings append verbatim to the Inventory Items textlist; gp
// adds to the GP field. A gold pick may carry `goldAmount`: the
// number the player rolled (or typed), in gp, which falls back to the
// class's own standard figure when blank.
//
// LEGACY_EQUIPMENT_OPTIONS translates the pre-decisions flattened
// picks ({ classOptionId: "<class>-a/b" }) so older saved characters
// keep exactly the items they chose; anything picked fresh uses the
// decisions shape above.

import { TOOL_PROFICIENCIES, TOOL_PROFICIENCY_GROUPS, TOOL_DESCRIPTIONS } from "./blockModel.js";

export const EQUIPMENT_PACK_CONTENTS = {
  "Burglar's Pack": ["Backpack", "Ball bearings (bag of 1,000)", "10 feet of string", "Bell", "5 candles", "Crowbar", "Hammer", "10 pitons", "Hooded lantern", "2 flasks of oil", "5 days of rations", "Tinderbox", "Waterskin", "50 feet of hempen rope"],
  "Diplomat's Pack": ["Chest", "2 cases for maps and scrolls", "Fine clothes", "Bottle of ink", "Ink pen", "Lamp", "2 flasks of oil", "5 sheets of paper", "Vial of perfume", "Sealing wax", "Soap"],
  "Dungeoneer's Pack": ["Backpack", "Crowbar", "Hammer", "10 pitons", "10 torches", "Tinderbox", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "Entertainer's Pack": ["Backpack", "Bedroll", "2 costumes", "5 candles", "5 days of rations", "Waterskin", "Disguise kit"],
  "Explorer's Pack": ["Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "Priest's Pack": ["Backpack", "Blanket", "10 candles", "Tinderbox", "Alms box", "2 blocks of incense", "Censer", "Vestments", "2 days of rations", "Waterskin"],
  "Scholar's Pack": ["Backpack", "Book of lore", "Bottle of ink", "Ink pen", "10 sheets of parchment", "Little bag of sand", "Small knife"],
};

const pack = (name) => [name, ...EQUIPMENT_PACK_CONTENTS[name]];

/** Shown under a spellcasting focus row's label. Sourced from the
 *  compendium item text: “An arcane focus is a special item designed to
 *  channel the power of arcane spells… using it in place of any material
 *  component which does not list a cost.” */
const FOCUS_HINT = "You need one of these to cast at all. It stands in for any material component a spell does not charge you for (PHB).";

/** The two focus options, which until now said nothing beyond their own
 *  names. Both descriptions are lifted from the compendium item text
 *  (docs/New Info/5e-items.txt) and trimmed, not invented:
 *   Component Pouch — "A component pouch is a small, watertight leather
 *     belt pouch that has compartments to hold all the material components
 *     and other special items you need to cast your spells, except for those
 *     components that have a specific cost (as indicated in a spell's
 *     description)."
 *   Arcane focus — "An arcane focus is a special item designed to channel
 *     the power of arcane spells… using it in place of any material component
 *     which does not list a cost."
 *  A player choosing between two rows that only named themselves had nothing
 *  to choose on. */
const COMPONENT_POUCH_NOTE = "A small watertight leather belt pouch with compartments for the material components and other special items your spells need, except components that carry a stated cost.";
const ARCANE_FOCUS_NOTE = "An orb, rod, staff, wand or crystal that channels spell power, used in place of any material component that lists no cost.";

/** The weapons a class may take, split by the PHB's own groups
 *  (simple/martial × melee/ranged). The PHB writes these rows as "any
 *  simple weapon", which a radio row cannot deliver: picking one granted
 *  a line reading "Simple weapon (your choice)" and left the naming to
 *  the player. Expanded into the real weapons instead, so the picker
 *  offers each of them and says what it deals. `kind` is the filter;
 *  `damage` and `ammo` are what the option says. Pure data, shared by
 *  every class row that offers any of them.
 *
 *  The same list the sheet's weapon-proficiency taglist uses (see
 *  WEAPON_PROFICIENCIES in blockModel.js), with the damage each one
 *  deals beside it - the thing a player actually chooses between a
 *  greataxe and a rapier on. */
const WEAPONS = [
  { name: "Club", kind: "simple melee", damage: "1d4 bludgeoning" },
  { name: "Dagger", kind: "simple melee", damage: "1d4 piercing" },
  { name: "Greatclub", kind: "simple melee", damage: "1d8 bludgeoning" },
  { name: "Handaxe", kind: "simple melee", damage: "1d6 slashing" },
  { name: "Javelin", kind: "simple melee", damage: "1d6 piercing" },
  { name: "Light hammer", kind: "simple melee", damage: "1d4 bludgeoning" },
  { name: "Mace", kind: "simple melee", damage: "1d6 bludgeoning" },
  { name: "Quarterstaff", kind: "simple melee", damage: "1d6 bludgeoning" },
  { name: "Sickle", kind: "simple melee", damage: "1d4 slashing" },
  { name: "Spear", kind: "simple melee", damage: "1d6 piercing" },
  { name: "Light crossbow", kind: "simple ranged", damage: "1d8 piercing", ammo: "20 crossbow bolts" },
  { name: "Dart", kind: "simple ranged", damage: "1d4 piercing" },
  { name: "Shortbow", kind: "simple ranged", damage: "1d6 piercing", ammo: "20 arrows" },
  { name: "Sling", kind: "simple ranged", damage: "1d4 bludgeoning", ammo: "20 sling bullets" },
  { name: "Battleaxe", kind: "martial melee", damage: "1d8 slashing" },
  { name: "Flail", kind: "martial melee", damage: "1d8 bludgeoning" },
  { name: "Glaive", kind: "martial melee", damage: "1d10 slashing" },
  { name: "Greataxe", kind: "martial melee", damage: "1d12 slashing" },
  { name: "Greatsword", kind: "martial melee", damage: "2d6 slashing" },
  { name: "Halberd", kind: "martial melee", damage: "1d10 slashing" },
  { name: "Lance", kind: "martial melee", damage: "1d12 piercing" },
  { name: "Longsword", kind: "martial melee", damage: "1d8 slashing" },
  { name: "Maul", kind: "martial melee", damage: "2d6 bludgeoning" },
  { name: "Morningstar", kind: "martial melee", damage: "1d8 piercing" },
  { name: "Pike", kind: "martial melee", damage: "1d10 piercing" },
  { name: "Rapier", kind: "martial melee", damage: "1d8 piercing" },
  { name: "Scimitar", kind: "martial melee", damage: "1d6 slashing" },
  { name: "Shortsword", kind: "martial melee", damage: "1d6 piercing" },
  { name: "Trident", kind: "martial melee", damage: "1d6 piercing" },
  { name: "War pick", kind: "martial melee", damage: "1d8 piercing" },
  { name: "Warhammer", kind: "martial melee", damage: "1d8 bludgeoning" },
  { name: "Whip", kind: "martial melee", damage: "1d4 slashing" },
  { name: "Blowgun", kind: "martial ranged", damage: "1 piercing", ammo: "50 blowgun needles" },
  { name: "Hand crossbow", kind: "martial ranged", damage: "1d6 piercing", ammo: "20 crossbow bolts" },
  { name: "Heavy crossbow", kind: "martial ranged", damage: "1d10 piercing", ammo: "20 crossbow bolts" },
  { name: "Longbow", kind: "martial ranged", damage: "1d8 piercing", ammo: "20 arrows" },
  { name: "Net", kind: "martial ranged", damage: "no damage; restrains on a hit" },
];

const weaponDescription = (w) => `${w.damage}${w.ammo ? `; starts with ${w.ammo}` : ""}.`;
/** A count as a word, for the labels the data already reads as words
 *  ("Two handaxes", "Five javelins"): "2 Longswords" in a list beside
 *  those is the same fact in two different registers. Falls back to the
 *  numeral for a count with no word here. */
const COUNT_WORDS = { 2: "Two", 3: "Three", 4: "Four", 5: "Five" };
const countWord = (n) => COUNT_WORDS[n] || String(n);
const weaponOption = (w, { idPrefix = "", labelSuffix = "", itemCount = 1, extraItems = [] } = {}) => ({
  id: `${idPrefix}${slugId(w.name)}`,
  label: `${itemCount > 1 ? `${countWord(itemCount)} ` : ""}${w.name}${itemCount > 1 ? "s" : ""}${labelSuffix}`,
  note: weaponDescription(w),
  items: [...Array(itemCount).fill(w.name), ...(w.ammo ? [w.ammo] : []), ...extraItems],
});
const weaponOptions = (kinds, opts = {}) => WEAPONS
  .filter((w) => (Array.isArray(kinds) ? kinds : [kinds]).includes(w.kind))
  .map((w) => weaponOption(w, opts));

/** The Bard's instrument row, for the same reason. "Any musical
 *  instrument" was one radio that granted a line reading "Musical
 *  instrument (your choice)"; the ten instruments are the actual offers,
 *  and the sheet already carries a one-line description of each (see
 *  TOOL_DESCRIPTIONS), so the picker can say what each one is for.
 *  Which names those are is not re-decided here: it is the same
 *  "Musical Instruments" group the sheet's tool-proficiency taglist
 *  offers. */
const INSTRUMENTS = (TOOL_PROFICIENCY_GROUPS.find((g) => g.label === "Musical Instruments")?.options || []);
const instrumentOptions = () => INSTRUMENTS.map((name) => ({
  id: slugId(name),
  label: name,
  note: TOOL_DESCRIPTIONS[name] || null,
  items: [name],
}));

/** What to show beneath a starting-gear option's label, or "" when the
 *  label already says it. Pure, and shared by every renderer so the wizard,
 *  the review page and anything added later agree.
 *
 *  Two kinds of repetition were on screen, both from printing `items` under
 *  the label verbatim:
 *
 *   - A pack option printed the pack's own name first — "Explorer's Pack,
 *     Backpack, Bedroll, Mess kit, …" — directly beneath a label already
 *     reading "Explorer's pack". The name is items[0] by construction (see
 *     `pack`), because the Inventory wants a line for the pack itself, but a
 *     player-facing description should start with what is INSIDE it.
 *   - A single-item option printed its one item under a label that WAS that
 *     item: "Greataxe" over "Greataxe".
 *
 *  "(your choice)" is dropped too. It is a data placeholder the PHB uses to
 *  leave a line open for the table, not something to read on a screen; the
 *  note on those options says what to do about it instead. */
export function optionDetailText(opt) {
  let items = (opt?.items || []).filter(Boolean);
  if (!items.length) return "";
  const label = String(opt?.label || "").trim().toLowerCase();
  if (items.length > 1 && items[0].trim().toLowerCase() === label) items = items.slice(1);
  const shown = items.map((s) => String(s).replace(/\s*\(your choice\)\s*$/i, "").trim()).filter(Boolean);
  if (!shown.length) return "";
  if (shown.length === 1 && shown[0].toLowerCase() === label) return "";
  return shown.join(" · ");
}

export const CLASS_STARTING_EQUIPMENT = {
  Barbarian: {
    gold: { gp: 50, formula: "2d4 × 10 gp" },
    fixed: ["4 javelins", ...pack("Explorer's Pack")],
    decisions: [
      {
        id: "main-weapon", label: "Main weapon", options: [
          { id: "greataxe", label: "Greataxe", items: ["Greataxe"] },
          ...weaponOptions("martial melee", { idPrefix: "martial-melee-" }).filter((o) => o.id !== "martial-melee-greataxe"),
        ],
      },
      {
        id: "sidearm", label: "Sidearm", options: [
          { id: "handaxes", label: "Two handaxes", items: ["Handaxe", "Handaxe"] },
          ...weaponOptions(["simple melee", "simple ranged"], { idPrefix: "simple-" }),
        ],
      },
    ],
  },
  Bard: {
    gold: { gp: 125, formula: "5d4 × 10 gp" },
    fixed: ["Leather armor", "Dagger"],
    decisions: [
      {
        id: "weapon", label: "Weapon", options: [
          { id: "rapier", label: "Rapier", items: ["Rapier"] },
          { id: "longsword", label: "Longsword", items: ["Longsword"] },
          ...weaponOptions(["simple melee", "simple ranged"], { idPrefix: "simple-" }),
        ],
      },
      {
        id: "pack", label: "Pack", options: [
          { id: "diplomats-pack", label: "Diplomat's pack", items: pack("Diplomat's Pack") },
          { id: "entertainers-pack", label: "Entertainer's pack", items: pack("Entertainer's Pack") },
        ],
      },
      {
        id: "instrument", label: "Instrument", options: [
          { id: "lute", label: "Lute", note: TOOL_DESCRIPTIONS.Lute, items: ["Lute"] },
          ...instrumentOptions().filter((o) => o.id !== "lute"),
        ],
      },
    ],
  },
  Cleric: {
    gold: { gp: 125, formula: "5d4 × 10 gp" },
    fixed: ["Shield", "Holy symbol"],
    decisions: [
      {
        id: "weapon", label: "Weapon", options: [
          { id: "mace", label: "Mace", items: ["Mace"] },
          { id: "warhammer", label: "Warhammer", items: ["Warhammer"] },
        ],
      },
      {
        id: "armor", label: "Armor", options: [
          { id: "scale-mail", label: "Scale mail", items: ["Scale mail"] },
          { id: "leather-armor", label: "Leather armor", items: ["Leather armor"] },
          { id: "chain-mail", label: "Chain mail", items: ["Chain mail"] },
        ],
      },
      {
        id: "ranged", label: "Ranged weapon", options: [
          { id: "light-crossbow", label: "Light crossbow and 20 bolts", items: ["Light crossbow", "20 crossbow bolts"] },
          ...weaponOptions(["simple melee", "simple ranged"], { idPrefix: "simple-" }),
        ],
      },
      {
        id: "pack", label: "Pack", options: [
          { id: "priests-pack", label: "Priest's pack", items: pack("Priest's Pack") },
          { id: "explorers-pack", label: "Explorer's pack", items: pack("Explorer's Pack") },
        ],
      },
    ],
  },
  Druid: {
    gold: { gp: 50, formula: "2d4 × 10 gp" },
    fixed: ["Leather armor", "Druidic focus", ...pack("Explorer's Pack")],
    decisions: [
      {
        id: "offhand", label: "Shield or weapon", options: [
          { id: "wooden-shield", label: "Wooden shield", items: ["Wooden shield"] },
          ...weaponOptions(["simple melee", "simple ranged"], { idPrefix: "simple-" }),
        ],
      },
      {
        id: "melee", label: "Melee weapon", options: [
          { id: "scimitar", label: "Scimitar", items: ["Scimitar"] },
          ...weaponOptions("simple melee", { idPrefix: "simple-melee-" }),
        ],
      },
    ],
  },
  Fighter: {
    gold: { gp: 125, formula: "5d4 × 10 gp" },
    fixed: [],
    decisions: [
      {
        id: "armor", label: "Armor", options: [
          { id: "chain-mail", label: "Chain mail", items: ["Chain mail"] },
          { id: "leather-bow", label: "Leather armor and longbow", items: ["Leather armor", "Longbow", "20 arrows"] },
        ],
      },
      {
        id: "weapon", label: "Weapons", options: [
          ...weaponOptions(["martial melee", "martial ranged"], { idPrefix: "shield-", labelSuffix: " and shield", extraItems: ["Shield"] }),
          ...weaponOptions(["martial melee", "martial ranged"], { idPrefix: "pair-", itemCount: 2 }),
        ],
      },
      {
        id: "ranged", label: "Ranged weapon", options: [
          { id: "light-crossbow", label: "Light crossbow and 20 bolts", items: ["Light crossbow", "20 crossbow bolts"] },
          { id: "handaxes", label: "Two handaxes", items: ["Handaxe", "Handaxe"] },
        ],
      },
      {
        id: "pack", label: "Pack", options: [
          { id: "dungeoneers-pack", label: "Dungeoneer's pack", items: pack("Dungeoneer's Pack") },
          { id: "explorers-pack", label: "Explorer's pack", items: pack("Explorer's Pack") },
        ],
      },
    ],
  },
  Monk: {
    gold: { gp: 12, formula: "5d4 gp" },
    fixed: ["10 darts"],
    decisions: [
      {
        id: "weapon", label: "Weapon", options: [
          { id: "shortsword", label: "Shortsword", items: ["Shortsword"] },
          ...weaponOptions(["simple melee", "simple ranged"], { idPrefix: "simple-" }),
        ],
      },
      {
        id: "pack", label: "Pack", options: [
          { id: "dungeoneers-pack", label: "Dungeoneer's pack", items: pack("Dungeoneer's Pack") },
          { id: "explorers-pack", label: "Explorer's pack", items: pack("Explorer's Pack") },
        ],
      },
    ],
  },
  Paladin: {
    gold: { gp: 125, formula: "5d4 × 10 gp" },
    fixed: ["Chain mail", "Holy symbol"],
    decisions: [
      {
        id: "weapon", label: "Weapons", options: [
          ...weaponOptions(["martial melee", "martial ranged"], { idPrefix: "shield-", labelSuffix: " and shield", extraItems: ["Shield"] }),
          ...weaponOptions(["martial melee", "martial ranged"], { idPrefix: "pair-", itemCount: 2 }),
        ],
      },
      {
        id: "ranged", label: "Ranged weapon", options: [
          { id: "javelins", label: "Five javelins", items: ["5 javelins"] },
          ...weaponOptions("simple melee", { idPrefix: "simple-melee-" }),
        ],
      },
      {
        id: "pack", label: "Pack", options: [
          { id: "priests-pack", label: "Priest's pack", items: pack("Priest's Pack") },
          { id: "explorers-pack", label: "Explorer's pack", items: pack("Explorer's Pack") },
        ],
      },
    ],
  },
  Ranger: {
    gold: { gp: 125, formula: "5d4 × 10 gp" },
    fixed: ["Longbow", "20 arrows"],
    decisions: [
      {
        id: "armor", label: "Armor", options: [
          { id: "scale-mail", label: "Scale mail", items: ["Scale mail"] },
          { id: "leather-armor", label: "Leather armor", items: ["Leather armor"] },
        ],
      },
      {
        id: "melee", label: "Melee weapons", options: [
          { id: "shortswords", label: "Two shortswords", items: ["Shortsword", "Shortsword"] },
          ...weaponOptions("simple melee", { idPrefix: "simple-pair-", itemCount: 2 }),
        ],
      },
      {
        id: "pack", label: "Pack", options: [
          { id: "dungeoneers-pack", label: "Dungeoneer's pack", items: pack("Dungeoneer's Pack") },
          { id: "explorers-pack", label: "Explorer's pack", items: pack("Explorer's Pack") },
        ],
      },
    ],
  },
  Rogue: {
    gold: { gp: 100, formula: "4d4 × 10 gp" },
    fixed: ["Leather armor", "2 daggers", "Thieves' tools"],
    decisions: [
      {
        id: "weapon", label: "Weapon", options: [
          { id: "rapier", label: "Rapier", items: ["Rapier"] },
          { id: "shortsword", label: "Shortsword", items: ["Shortsword"] },
        ],
      },
      {
        id: "ranged", label: "Ranged weapon", options: [
          { id: "shortbow", label: "Shortbow and 20 arrows", items: ["Shortbow", "20 arrows"] },
          { id: "shortsword-2", label: "Shortsword", items: ["Shortsword"] },
        ],
      },
      {
        id: "pack", label: "Pack", options: [
          { id: "burglars-pack", label: "Burglar's pack", items: pack("Burglar's Pack") },
          { id: "dungeoneers-pack", label: "Dungeoneer's pack", items: pack("Dungeoneer's Pack") },
          { id: "explorers-pack", label: "Explorer's pack", items: pack("Explorer's Pack") },
        ],
      },
    ],
  },
  Sorcerer: {
    gold: { gp: 75, formula: "3d4 × 10 gp" },
    fixed: ["2 daggers"],
    decisions: [
      {
        id: "weapon", label: "Weapon", options: [
          { id: "light-crossbow", label: "Light crossbow and 20 bolts", items: ["Light crossbow", "20 crossbow bolts"] },
          ...weaponOptions(["simple melee", "simple ranged"], { idPrefix: "simple-" }),
        ],
      },
      {
        id: "focus", label: "Spellcasting focus", hint: FOCUS_HINT, options: [
          { id: "component-pouch", label: "Component pouch", note: COMPONENT_POUCH_NOTE, items: ["Component pouch"] },
          { id: "arcane-focus", label: "Arcane focus", note: ARCANE_FOCUS_NOTE, items: ["Arcane focus"] },
        ],
      },
      {
        id: "pack", label: "Pack", options: [
          { id: "dungeoneers-pack", label: "Dungeoneer's pack", items: pack("Dungeoneer's Pack") },
          { id: "explorers-pack", label: "Explorer's pack", items: pack("Explorer's Pack") },
        ],
      },
    ],
  },
  Warlock: {
    gold: { gp: 100, formula: "4d4 × 10 gp" },
    fixed: ["Leather armor", "2 daggers"],
    decisions: [
      {
        id: "backup-weapon", label: "Backup weapon", options: weaponOptions("simple melee", { idPrefix: "backup-simple-" }),
      },
      {
        id: "weapon", label: "Weapon", options: [
          { id: "light-crossbow", label: "Light crossbow and 20 bolts", items: ["Light crossbow", "20 crossbow bolts"] },
          ...weaponOptions(["simple melee", "simple ranged"], { idPrefix: "simple-" }),
        ],
      },
      {
        id: "focus", label: "Spellcasting focus", hint: FOCUS_HINT, options: [
          { id: "component-pouch", label: "Component pouch", note: COMPONENT_POUCH_NOTE, items: ["Component pouch"] },
          { id: "arcane-focus", label: "Arcane focus", note: ARCANE_FOCUS_NOTE, items: ["Arcane focus"] },
        ],
      },
      {
        id: "pack", label: "Pack", options: [
          { id: "scholars-pack", label: "Scholar's pack", items: pack("Scholar's Pack") },
          { id: "dungeoneers-pack", label: "Dungeoneer's pack", items: pack("Dungeoneer's Pack") },
        ],
      },
    ],
  },
  Wizard: {
    gold: { gp: 100, formula: "4d4 × 10 gp" },
    fixed: ["Spellbook"],
    decisions: [
      {
        id: "weapon", label: "Weapon", options: [
          { id: "quarterstaff", label: "Quarterstaff", items: ["Quarterstaff"] },
          { id: "dagger", label: "Dagger", items: ["Dagger"] },
        ],
      },
      {
        id: "focus", label: "Spellcasting focus", hint: FOCUS_HINT, options: [
          { id: "component-pouch", label: "Component pouch", note: COMPONENT_POUCH_NOTE, items: ["Component pouch"] },
          { id: "arcane-focus", label: "Arcane focus", note: ARCANE_FOCUS_NOTE, items: ["Arcane focus"] },
        ],
      },
      {
        id: "pack", label: "Pack", options: [
          { id: "scholars-pack", label: "Scholar's pack", items: pack("Scholar's Pack") },
          { id: "explorers-pack", label: "Explorer's pack", items: pack("Explorer's Pack") },
        ],
      },
    ],
  },
  Artificer: {
    gold: { gp: 125, formula: "5d4 × 10 gp" },
    fixed: ["Light crossbow", "20 crossbow bolts", "Thieves' tools", ...pack("Dungeoneer's Pack")],
    decisions: [
      {
        id: "simple-weapons", label: "Simple weapons", options: weaponOptions(["simple melee", "simple ranged"], { idPrefix: "simple-pair-", itemCount: 2 }),
      },
      {
        id: "armor", label: "Armor", options: [
          { id: "studded-leather", label: "Studded leather armor", items: ["Studded leather armor"] },
          { id: "scale-mail", label: "Scale mail", items: ["Scale mail"] },
        ],
      },
    ],
  },
};

export function slugId(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "option";
}

export function goldOptionIdFor(className) {
  return `${slugId(className)}-gold`;
}

// Pre-decisions flattened picks ({ classOptionId: "<class>-a/b" }),
// kept verbatim so older saved characters resolve to exactly the
// items they chose. Anything picked fresh uses the decisions shape.
const LEGACY_EQUIPMENT_OPTIONS = {
  "barbarian-a": ["Greataxe", "2 handaxes", "4 javelins", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "barbarian-b": ["Martial melee weapon (your choice)", "2 handaxes", "4 javelins", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "bard-a": ["Rapier", "Leather armor", "Dagger", "Lute", "Diplomat's Pack", "Chest", "2 cases for maps and scrolls", "Fine clothes", "Bottle of ink", "Ink pen", "Lamp", "2 flasks of oil", "5 sheets of paper", "Vial of perfume", "Sealing wax", "Soap"],
  "bard-b": ["Longsword", "Leather armor", "Dagger", "Musical instrument (your choice)", "Entertainer's Pack", "Backpack", "Bedroll", "2 costumes", "5 candles", "5 days of rations", "Waterskin", "Disguise kit"],
  "cleric-a": ["Mace", "Scale mail", "Light crossbow", "20 crossbow bolts", "Shield", "Holy symbol", "Priest's Pack", "Backpack", "Blanket", "10 candles", "Tinderbox", "Alms box", "2 blocks of incense", "Censer", "Vestments", "2 days of rations", "Waterskin"],
  "cleric-b": ["Warhammer", "Chain mail", "Shield", "Holy symbol", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "druid-a": ["Wooden shield", "Scimitar", "Leather armor", "Druidic focus", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "druid-b": ["Wooden shield", "Simple melee weapon (your choice)", "Leather armor", "Druidic focus", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "fighter-a": ["Chain mail", "Longsword", "Shield", "Light crossbow", "20 crossbow bolts", "Dungeoneer's Pack", "Backpack", "Crowbar", "Hammer", "10 pitons", "10 torches", "Tinderbox", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "fighter-b": ["Leather armor", "Longbow", "20 arrows", "Battleaxe", "Handaxe", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "monk-a": ["Shortsword", "10 darts", "Dungeoneer's Pack", "Backpack", "Crowbar", "Hammer", "10 pitons", "10 torches", "Tinderbox", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "monk-b": ["Simple melee weapon (your choice)", "10 darts", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "paladin-a": ["Longsword", "Shield", "5 javelins", "Chain mail", "Holy symbol", "Priest's Pack", "Backpack", "Blanket", "10 candles", "Tinderbox", "Alms box", "2 blocks of incense", "Censer", "Vestments", "2 days of rations", "Waterskin"],
  "paladin-b": ["Battleaxe", "Warhammer", "Simple melee weapon (your choice)", "Chain mail", "Holy symbol", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "ranger-a": ["Scale mail", "2 shortswords", "Longbow", "20 arrows", "Dungeoneer's Pack", "Backpack", "Crowbar", "Hammer", "10 pitons", "10 torches", "Tinderbox", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "ranger-b": ["Leather armor", "2 simple melee weapons (your choice)", "Longbow", "20 arrows", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "rogue-a": ["Rapier", "Shortbow", "20 arrows", "Leather armor", "2 daggers", "Thieves' tools", "Burglar's Pack", "Backpack", "Ball bearings (bag of 1,000)", "10 feet of string", "Bell", "5 candles", "Crowbar", "Hammer", "10 pitons", "Hooded lantern", "2 flasks of oil", "5 days of rations", "Tinderbox", "Waterskin", "50 feet of hempen rope"],
  "rogue-b": ["Shortsword", "Shortsword", "Shortbow", "20 arrows", "Leather armor", "2 daggers", "Thieves' tools", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "sorcerer-a": ["Light crossbow", "20 crossbow bolts", "Component pouch", "2 daggers", "Dungeoneer's Pack", "Backpack", "Crowbar", "Hammer", "10 pitons", "10 torches", "Tinderbox", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "sorcerer-b": ["Simple weapon (your choice)", "Arcane focus", "2 daggers", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "warlock-a": ["Light crossbow", "20 crossbow bolts", "Component pouch", "Leather armor", "Simple melee weapon (your choice)", "2 daggers", "Scholar's Pack", "Backpack", "Book of lore", "Bottle of ink", "Ink pen", "10 sheets of parchment", "Little bag of sand", "Small knife"],
  "warlock-b": ["Simple weapon (your choice)", "Arcane focus", "Leather armor", "Simple melee weapon (your choice)", "2 daggers", "Dungeoneer's Pack", "Backpack", "Crowbar", "Hammer", "10 pitons", "10 torches", "Tinderbox", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "wizard-a": ["Quarterstaff", "Component pouch", "Spellbook", "Scholar's Pack", "Backpack", "Book of lore", "Bottle of ink", "Ink pen", "10 sheets of parchment", "Little bag of sand", "Small knife"],
  "wizard-b": ["Dagger", "Arcane focus", "Spellbook", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "artificer-a": ["Any two simple weapons (your choice)", "Light crossbow", "20 crossbow bolts", "Studded leather armor", "Thieves' tools", "Artisan's tools (your choice)", "Dungeoneer's Pack", "Backpack", "Crowbar", "Hammer", "10 pitons", "10 torches", "Tinderbox", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
  "artificer-b": ["Any two simple weapons (your choice)", "Light crossbow", "20 crossbow bolts", "Scale mail", "Thieves' tools", "Artisan's tools (your choice)", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days of rations", "Waterskin", "50 feet of hempen rope"],
};

/** Pure resolution of Starting Equipment picks: which inventory
 *  lines and how much gold they yield. `pick` is the stored
 *  rules.startingEquipment object: { picks: { decisionId: optionId } },
 *  or { gold: true, goldAmount } to take the gold instead, or
 *  { classOptionId } for legacy flattened picks (see
 *  LEGACY_EQUIPMENT_OPTIONS). `goldAmount` is what the player rolled
 *  in gp; blank or non-numeric falls back to the class's own standard
 *  figure. Used by Finish Setup and by tests; the renderer only
 *  collects the pick. */
export function resolveStartingEquipmentPick(className, background, pick, linkedNames = []) {
  const items = [];
  let gp = 0;
  const entry = CLASS_STARTING_EQUIPMENT[className];
  // Bare legacy id (pre-decisions callers) behaves like { classOptionId }.
  if (typeof pick === "string") pick = { classOptionId: pick };
  if (entry) {
    if (pick?.gold || pick?.classOptionId === goldOptionIdFor(className)) {
      const rolled = Number.parseInt(String(pick?.goldAmount ?? "").replace(/\D+/g, ""), 10);
      gp += Number.isFinite(rolled) ? rolled : entry.gold.gp;
    } else if (pick?.picks) {
      items.push(...(entry.fixed || []));
      for (const decision of (entry.decisions || [])) {
        const opt = decision.options.find((o) => o.id === pick.picks[decision.id]);
        if (opt) items.push(...opt.items);
      }
    } else if (pick?.classOptionId && LEGACY_EQUIPMENT_OPTIONS[pick.classOptionId]) {
      items.push(...LEGACY_EQUIPMENT_OPTIONS[pick.classOptionId]);
    }
  }
  const bg = BG_STARTING_EQUIPMENT[background];
  if (bg) {
    items.push(...bgDisplayItems(background, linkedNames));
    gp += bg.gp || 0;
  }
  return { items, gp };
}

export const BG_STARTING_EQUIPMENT = {
  Acolyte: { gp: 15, items: ["Holy symbol", "Prayer book", "5 sticks of incense", "Vestments", "Common clothes"] },
  Entertainer: { gp: 15, items: ["Musical instrument (your choice)", "Favor of an admirer", "Costume"] },
  "Folk Hero": { gp: 10, items: ["Artisan's tools (your choice)", "Shovel", "Iron pot", "Common clothes"] },
  "Guild Artisan": { gp: 15, items: ["Artisan's tools (your choice)", "Letter of introduction from your guild", "Traveler's clothes"] },
  Noble: { gp: 25, items: ["Fine clothes", "Signet ring", "Scroll of pedigree"] },
  Outlander: { gp: 10, items: ["Staff", "Hunting trap", "Animal trophy", "Traveler's clothes"] },
  Sage: { gp: 10, items: ["Bottle of black ink", "Quill", "Small knife", "Letter from a dead colleague", "Common clothes"] },
  Sailor: { gp: 10, items: ["Belaying pin (club)", "50 feet of silk rope", "Lucky charm", "Common clothes"] },
  // No distinct package exists for the bounty hunter; close equivalent
  // of the Criminal package it was printed alongside.
  "Urban Bounty Hunter": { gp: 15, items: ["Dark hooded common clothes", "50 feet of hempen rope", "Set of manacles"] },
};

// One pick driving both proficiency and equipment (audit systemic fix
// 7): the background tool/prayer choice's selected option name
// replaces the package's placeholder line at resolution time, so the
// player is never asked twice. `match` identifies the placeholder
// line (case-insensitive); with no pick the printed line stands.
export const BG_EQUIPMENT_LINKS = {
  Acolyte: { groupId: "acolyte-prayer-focus", match: /^prayer (book|wheel)$/i },
  Entertainer: { groupId: "entertainer-toolProf-1", match: /musical instrument/i },
  "Folk Hero": { groupId: "folk-hero-toolProf-0", match: /artisan's tools/i },
  "Guild Artisan": { groupId: "guild-artisan-toolProf-0", match: /artisan's tools/i },
};

/** Selected option names for a background's linked equipment group,
 *  across both choices-store key formats (`creation:Background:<bg>:
 *  <groupId>` from Setup, `<fieldId>:<choiceId>:<groupId>` after).
 *  Pure — `bgBundle` is the background's bundle, `choicesStore` is
 *  rules.choices. */
export function linkedEquipmentNames(bgName, bgBundle, choicesStore = {}) {
  const link = BG_EQUIPMENT_LINKS[bgName];
  if (!link) return [];
  const group = ((bgBundle || {}).choiceGroups || []).find((g) => g.id === link.groupId);
  if (!group) return [];
  const namesById = new Map();
  for (const o of (group.options || [])) namesById.set(o.id, o.name);
  for (const cats of (group.categories || [])) for (const o of (cats.options || [])) namesById.set(o.id, o.name);
  const picked = [];
  for (const [key, ids] of Object.entries(choicesStore || {})) {
    if (key !== link.groupId && !key.endsWith(`:${link.groupId}`)) continue;
    for (const id of (Array.isArray(ids) ? ids : [])) {
      if (namesById.has(id)) picked.push(namesById.get(id));
    }
  }
  return [...new Set(picked)];
}

/** Background package items with the linked pick substituted in (or
 *  the printed lines when nothing is picked yet). Pure. */
export function bgDisplayItems(bgName, linkedNames = []) {
  const bg = BG_STARTING_EQUIPMENT[bgName];
  if (!bg) return [];
  const items = [...(bg.items || [])];
  const link = BG_EQUIPMENT_LINKS[bgName];
  if (link && linkedNames.length) {
    const at = items.findIndex((line) => link.match.test(line || ""));
    if (at !== -1) items.splice(at, 1, ...linkedNames);
  }
  return items;
}

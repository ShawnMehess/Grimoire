// startingEquipment.js — hand-written 2014 PHB starting packages (+ TCE
// Artificer).
//
// The PHB gives each class a FIXED list with independent either/or
// rows — e.g. the Fighter takes chain mail OR (leather + longbow),
// AND a martial weapon + shield OR two martial weapons, AND ... —
// never a set of exclusive whole-kit "paths", so the data mirrors
// that: `fixed` lines everyone of that class takes, plus `decisions`
// (one pick each), plus the take-gold-instead fallback. Open
// "(your choice)" lines stay editable so the player can fill in
// whatever they picked at the table.
//
// Shape:
//   CLASS_STARTING_EQUIPMENT = { [className]: { gold: { gp, formula },
//     fixed: [...], decisions: [{ id, label, options: [{ id, label, items }] }] } }
//   BG_STARTING_EQUIPMENT = { [bgName]: { items: [...], gp } }
// Item strings append verbatim to the Inventory Items textlist; gp
// adds to the GP field.
//
// LEGACY_EQUIPMENT_OPTIONS translates the pre-decisions flattened
// picks ({ classOptionId: "<class>-a/b" }) so older saved characters
// keep exactly the items they chose; anything picked fresh uses the
// decisions shape above.

export const EQUIPMENT_PACK_CONTENTS = {
  "Burglar's Pack": ["Backpack", "Ball bearings (bag of 1,000)", "10 feet of string", "Bell", "5 candles", "Crowbar", "Hammer", "10 pitons", "Hooded lantern", "2 flasks of oil", "5 days rations", "Tinderbox", "Waterskin", "50 feet of hempen rope"],
  "Diplomat's Pack": ["Chest", "2 cases for maps and scrolls", "Fine clothes", "Bottle of ink", "Ink pen", "Lamp", "2 flasks of oil", "5 sheets of paper", "Vial of perfume", "Sealing wax", "Soap"],
  "Dungeoneer's Pack": ["Backpack", "Crowbar", "Hammer", "10 pitons", "10 torches", "Tinderbox", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "Entertainer's Pack": ["Backpack", "Bedroll", "2 costumes", "5 candles", "5 days rations", "Waterskin", "Disguise kit"],
  "Explorer's Pack": ["Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "Priest's Pack": ["Backpack", "Blanket", "10 candles", "Tinderbox", "Alms box", "2 blocks of incense", "Censer", "Vestments", "2 days rations", "Waterskin"],
  "Scholar's Pack": ["Backpack", "Book of lore", "Bottle of ink", "Ink pen", "10 sheets of parchment", "Little bag of sand", "Small knife"],
};

const pack = (name) => [name, ...EQUIPMENT_PACK_CONTENTS[name]];

export const CLASS_STARTING_EQUIPMENT = {
  Barbarian: {
    gold: { gp: 50, formula: "2d4 × 10 gp" },
    fixed: ["4 javelins", ...pack("Explorer's Pack")],
    decisions: [
      {
        id: "main-weapon", label: "Main weapon", options: [
          { id: "greataxe", label: "Greataxe", items: ["Greataxe"] },
          { id: "martial-melee", label: "Any martial melee weapon", items: ["Martial melee weapon (your choice)"] },
        ],
      },
      {
        id: "sidearm", label: "Sidearm", options: [
          { id: "handaxes", label: "Two handaxes", items: ["Handaxe", "Handaxe"] },
          { id: "simple-weapon", label: "Any simple weapon", items: ["Simple weapon (your choice)"] },
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
          { id: "simple-weapon", label: "Any simple weapon", items: ["Simple weapon (your choice)"] },
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
          { id: "lute", label: "Lute", items: ["Lute"] },
          { id: "any-instrument", label: "Any musical instrument", items: ["Musical instrument (your choice)"] },
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
          { id: "simple-weapon", label: "Any simple weapon", items: ["Simple weapon (your choice)"] },
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
          { id: "simple-weapon", label: "Any simple weapon", items: ["Simple weapon (your choice)"] },
        ],
      },
      {
        id: "melee", label: "Melee weapon", options: [
          { id: "scimitar", label: "Scimitar", items: ["Scimitar"] },
          { id: "simple-melee", label: "Any simple melee weapon", items: ["Simple melee weapon (your choice)"] },
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
          { id: "sword-board", label: "Martial weapon and shield", items: ["Martial weapon (your choice)", "Shield"] },
          { id: "two-martial", label: "Two martial weapons", items: ["Martial weapon (your choice)", "Martial weapon (your choice)"] },
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
          { id: "simple-weapon", label: "Any simple weapon", items: ["Simple weapon (your choice)"] },
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
          { id: "sword-board", label: "Martial weapon and shield", items: ["Martial weapon (your choice)", "Shield"] },
          { id: "two-martial", label: "Two martial weapons", items: ["Martial weapon (your choice)", "Martial weapon (your choice)"] },
        ],
      },
      {
        id: "ranged", label: "Ranged weapon", options: [
          { id: "javelins", label: "Five javelins", items: ["5 javelins"] },
          { id: "simple-melee", label: "Any simple melee weapon", items: ["Simple melee weapon (your choice)"] },
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
          { id: "simple-pair", label: "Two simple melee weapons", items: ["Simple melee weapon (your choice)", "Simple melee weapon (your choice)"] },
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
          { id: "simple-weapon", label: "Any simple weapon", items: ["Simple weapon (your choice)"] },
        ],
      },
      {
        id: "focus", label: "Spellcasting focus", options: [
          { id: "component-pouch", label: "Component pouch", items: ["Component pouch"] },
          { id: "arcane-focus", label: "Arcane focus", items: ["Arcane focus"] },
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
    fixed: ["Leather armor", "Simple melee weapon (your choice)", "2 daggers"],
    decisions: [
      {
        id: "weapon", label: "Weapon", options: [
          { id: "light-crossbow", label: "Light crossbow and 20 bolts", items: ["Light crossbow", "20 crossbow bolts"] },
          { id: "simple-weapon", label: "Any simple weapon", items: ["Simple weapon (your choice)"] },
        ],
      },
      {
        id: "focus", label: "Spellcasting focus", options: [
          { id: "component-pouch", label: "Component pouch", items: ["Component pouch"] },
          { id: "arcane-focus", label: "Arcane focus", items: ["Arcane focus"] },
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
        id: "focus", label: "Spellcasting focus", options: [
          { id: "component-pouch", label: "Component pouch", items: ["Component pouch"] },
          { id: "arcane-focus", label: "Arcane focus", items: ["Arcane focus"] },
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
    fixed: ["Simple weapon (your choice)", "Simple weapon (your choice)", "Light crossbow", "20 crossbow bolts", "Thieves' tools", ...pack("Dungeoneer's Pack")],
    decisions: [
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
  "barbarian-a": ["Greataxe", "2 handaxes", "4 javelins", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "barbarian-b": ["Martial melee weapon (your choice)", "2 handaxes", "4 javelins", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "bard-a": ["Rapier", "Leather armor", "Dagger", "Lute", "Diplomat's Pack", "Chest", "2 cases for maps and scrolls", "Fine clothes", "Bottle of ink", "Ink pen", "Lamp", "2 flasks of oil", "5 sheets of paper", "Vial of perfume", "Sealing wax", "Soap"],
  "bard-b": ["Longsword", "Leather armor", "Dagger", "Musical instrument (your choice)", "Entertainer's Pack", "Backpack", "Bedroll", "2 costumes", "5 candles", "5 days rations", "Waterskin", "Disguise kit"],
  "cleric-a": ["Mace", "Scale mail", "Light crossbow", "20 crossbow bolts", "Shield", "Holy symbol", "Priest's Pack", "Backpack", "Blanket", "10 candles", "Tinderbox", "Alms box", "2 blocks of incense", "Censer", "Vestments", "2 days rations", "Waterskin"],
  "cleric-b": ["Warhammer", "Chain mail", "Shield", "Holy symbol", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "druid-a": ["Wooden shield", "Scimitar", "Leather armor", "Druidic focus", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "druid-b": ["Wooden shield", "Simple melee weapon (your choice)", "Leather armor", "Druidic focus", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "fighter-a": ["Chain mail", "Longsword", "Shield", "Light crossbow", "20 crossbow bolts", "Dungeoneer's Pack", "Backpack", "Crowbar", "Hammer", "10 pitons", "10 torches", "Tinderbox", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "fighter-b": ["Leather armor", "Longbow", "20 arrows", "Battleaxe", "Handaxe", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "monk-a": ["Shortsword", "10 darts", "Dungeoneer's Pack", "Backpack", "Crowbar", "Hammer", "10 pitons", "10 torches", "Tinderbox", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "monk-b": ["Simple melee weapon (your choice)", "10 darts", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "paladin-a": ["Longsword", "Shield", "5 javelins", "Chain mail", "Holy symbol", "Priest's Pack", "Backpack", "Blanket", "10 candles", "Tinderbox", "Alms box", "2 blocks of incense", "Censer", "Vestments", "2 days rations", "Waterskin"],
  "paladin-b": ["Battleaxe", "Warhammer", "Simple melee weapon (your choice)", "Chain mail", "Holy symbol", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "ranger-a": ["Scale mail", "2 shortswords", "Longbow", "20 arrows", "Dungeoneer's Pack", "Backpack", "Crowbar", "Hammer", "10 pitons", "10 torches", "Tinderbox", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "ranger-b": ["Leather armor", "2 simple melee weapons (your choice)", "Longbow", "20 arrows", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "rogue-a": ["Rapier", "Shortbow", "20 arrows", "Leather armor", "2 daggers", "Thieves' tools", "Burglar's Pack", "Backpack", "Ball bearings (bag of 1,000)", "10 feet of string", "Bell", "5 candles", "Crowbar", "Hammer", "10 pitons", "Hooded lantern", "2 flasks of oil", "5 days rations", "Tinderbox", "Waterskin", "50 feet of hempen rope"],
  "rogue-b": ["Shortsword", "Shortsword", "Shortbow", "20 arrows", "Leather armor", "2 daggers", "Thieves' tools", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "sorcerer-a": ["Light crossbow", "20 crossbow bolts", "Component pouch", "2 daggers", "Dungeoneer's Pack", "Backpack", "Crowbar", "Hammer", "10 pitons", "10 torches", "Tinderbox", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "sorcerer-b": ["Simple weapon (your choice)", "Arcane focus", "2 daggers", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "warlock-a": ["Light crossbow", "20 crossbow bolts", "Component pouch", "Leather armor", "Simple melee weapon (your choice)", "2 daggers", "Scholar's Pack", "Backpack", "Book of lore", "Bottle of ink", "Ink pen", "10 sheets of parchment", "Little bag of sand", "Small knife"],
  "warlock-b": ["Simple weapon (your choice)", "Arcane focus", "Leather armor", "Simple melee weapon (your choice)", "2 daggers", "Dungeoneer's Pack", "Backpack", "Crowbar", "Hammer", "10 pitons", "10 torches", "Tinderbox", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "wizard-a": ["Quarterstaff", "Component pouch", "Spellbook", "Scholar's Pack", "Backpack", "Book of lore", "Bottle of ink", "Ink pen", "10 sheets of parchment", "Little bag of sand", "Small knife"],
  "wizard-b": ["Dagger", "Arcane focus", "Spellbook", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "artificer-a": ["Any two simple weapons (your choice)", "Light crossbow", "20 crossbow bolts", "Studded leather armor", "Thieves' tools", "Artisan's tools (your choice)", "Dungeoneer's Pack", "Backpack", "Crowbar", "Hammer", "10 pitons", "10 torches", "Tinderbox", "10 days rations", "Waterskin", "50 feet of hempen rope"],
  "artificer-b": ["Any two simple weapons (your choice)", "Light crossbow", "20 crossbow bolts", "Scale mail", "Thieves' tools", "Artisan's tools (your choice)", "Explorer's Pack", "Backpack", "Bedroll", "Mess kit", "Tinderbox", "10 torches", "10 days rations", "Waterskin", "50 feet of hempen rope"],
};

/** Pure resolution of Starting Equipment picks: which inventory
 *  lines and how much gold they yield. `pick` is the stored
 *  rules.startingEquipment object: { picks: { decisionId: optionId } }
 *  (or { gold: true }) for fresh picks, { classOptionId } for legacy
 *  flattened picks (see LEGACY_EQUIPMENT_OPTIONS). Used by Finish
 *  Setup and by tests; the renderer only collects the pick. */
export function resolveStartingEquipmentPick(className, background, pick) {
  const items = [];
  let gp = 0;
  const entry = CLASS_STARTING_EQUIPMENT[className];
  // Bare legacy id (pre-decisions callers) behaves like { classOptionId }.
  if (typeof pick === "string") pick = { classOptionId: pick };
  if (entry) {
    if (pick?.gold || pick?.classOptionId === goldOptionIdFor(className)) {
      gp += entry.gold.gp;
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
    items.push(...bg.items);
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

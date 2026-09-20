// startingEquipment.js — hand-written 2014 PHB starting packages.
//
// Neither the mechanics JSON nor the Foundry exports carry structured
// starting equipment, so class packages (with their internal either/or
// branches flattened into concrete variants) and fixed background
// packages live here. Adventuring packs are expanded into their
// contents so the Inventory list is immediately usable. Gold values
// are the fixed average of each class's starting-wealth roll
// (e.g. 5d4 × 10 gp → 125 gp); the die formula is kept alongside for
// players who'd rather roll at the table.
//
// Shape:
//   CLASS_STARTING_EQUIPMENT = { [className]: { gold: { gp, formula },
//     options: [{ id, label, items: [...] }] } }
//   BG_STARTING_EQUIPMENT = { [bgName]: { items: [...], gp } }
// Item strings append verbatim to the Inventory Items textlist; gp
// adds to the GP field. Open "(your choice)" lines stay editable so
// the player can fill in whatever they picked at the table.

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
    options: [
      { id: "barbarian-a", label: "Greataxe path", items: ["Greataxe", "2 handaxes", "4 javelins", ...pack("Explorer's Pack")] },
      { id: "barbarian-b", label: "Martial weapon path", items: ["Martial melee weapon (your choice)", "2 handaxes", "4 javelins", ...pack("Explorer's Pack")] },
    ],
  },
  Bard: {
    gold: { gp: 125, formula: "5d4 × 10 gp" },
    options: [
      { id: "bard-a", label: "Rapier + diplomat's pack + lute", items: ["Rapier", "Leather armor", "Dagger", "Lute", ...pack("Diplomat's Pack")] },
      { id: "bard-b", label: "Longsword + entertainer's pack", items: ["Longsword", "Leather armor", "Dagger", "Musical instrument (your choice)", ...pack("Entertainer's Pack")] },
    ],
  },
  Cleric: {
    gold: { gp: 125, formula: "5d4 × 10 gp" },
    options: [
      { id: "cleric-a", label: "Mace + scale mail + crossbow", items: ["Mace", "Scale mail", "Light crossbow", "20 crossbow bolts", "Shield", "Holy symbol", ...pack("Priest's Pack")] },
      { id: "cleric-b", label: "Warhammer + chain mail", items: ["Warhammer", "Chain mail", "Shield", "Holy symbol", ...pack("Explorer's Pack")] },
    ],
  },
  Druid: {
    gold: { gp: 50, formula: "2d4 × 10 gp" },
    options: [
      { id: "druid-a", label: "Scimitar path", items: ["Wooden shield", "Scimitar", "Leather armor", "Druidic focus", ...pack("Explorer's Pack")] },
      { id: "druid-b", label: "Simple weapon path", items: ["Wooden shield", "Simple melee weapon (your choice)", "Leather armor", "Druidic focus", ...pack("Explorer's Pack")] },
    ],
  },
  Fighter: {
    gold: { gp: 125, formula: "5d4 × 10 gp" },
    options: [
      { id: "fighter-a", label: "Chain mail + weapon and shield", items: ["Chain mail", "Longsword", "Shield", "Light crossbow", "20 crossbow bolts", ...pack("Dungeoneer's Pack")] },
      { id: "fighter-b", label: "Leather + longbow + two weapons", items: ["Leather armor", "Longbow", "20 arrows", "Battleaxe", "Handaxe", ...pack("Explorer's Pack")] },
    ],
  },
  Monk: {
    gold: { gp: 12, formula: "5d4 gp" },
    options: [
      { id: "monk-a", label: "Shortsword path", items: ["Shortsword", "10 darts", ...pack("Dungeoneer's Pack")] },
      { id: "monk-b", label: "Simple weapon path", items: ["Simple melee weapon (your choice)", "10 darts", ...pack("Explorer's Pack")] },
    ],
  },
  Paladin: {
    gold: { gp: 125, formula: "5d4 × 10 gp" },
    options: [
      { id: "paladin-a", label: "Weapon and shield + javelins", items: ["Longsword", "Shield", "5 javelins", "Chain mail", "Holy symbol", ...pack("Priest's Pack")] },
      { id: "paladin-b", label: "Two weapons + explorer's pack", items: ["Battleaxe", "Warhammer", "Simple melee weapon (your choice)", "Chain mail", "Holy symbol", ...pack("Explorer's Pack")] },
    ],
  },
  Ranger: {
    gold: { gp: 125, formula: "5d4 × 10 gp" },
    options: [
      { id: "ranger-a", label: "Scale mail + shortswords", items: ["Scale mail", "2 shortswords", "Longbow", "20 arrows", ...pack("Dungeoneer's Pack")] },
      { id: "ranger-b", label: "Leather + simple weapons", items: ["Leather armor", "2 simple melee weapons (your choice)", "Longbow", "20 arrows", ...pack("Explorer's Pack")] },
    ],
  },
  Rogue: {
    gold: { gp: 100, formula: "4d4 × 10 gp" },
    options: [
      { id: "rogue-a", label: "Rapier + burglar's pack", items: ["Rapier", "Shortbow", "20 arrows", "Leather armor", "2 daggers", "Thieves' tools", ...pack("Burglar's Pack")] },
      { id: "rogue-b", label: "Shortsword + explorer's pack", items: ["Shortsword", "Shortsword", "Shortbow", "20 arrows", "Leather armor", "2 daggers", "Thieves' tools", ...pack("Explorer's Pack")] },
    ],
  },
  Sorcerer: {
    gold: { gp: 75, formula: "3d4 × 10 gp" },
    options: [
      { id: "sorcerer-a", label: "Crossbow + component pouch", items: ["Light crossbow", "20 crossbow bolts", "Component pouch", "2 daggers", ...pack("Dungeoneer's Pack")] },
      { id: "sorcerer-b", label: "Simple weapon + arcane focus", items: ["Simple weapon (your choice)", "Arcane focus", "2 daggers", ...pack("Explorer's Pack")] },
    ],
  },
  Warlock: {
    gold: { gp: 100, formula: "4d4 × 10 gp" },
    options: [
      { id: "warlock-a", label: "Crossbow + scholar's pack", items: ["Light crossbow", "20 crossbow bolts", "Component pouch", "Leather armor", "Simple melee weapon (your choice)", "2 daggers", ...pack("Scholar's Pack")] },
      { id: "warlock-b", label: "Simple weapon + dungeoneer's pack", items: ["Simple weapon (your choice)", "Arcane focus", "Leather armor", "Simple melee weapon (your choice)", "2 daggers", ...pack("Dungeoneer's Pack")] },
    ],
  },
  Wizard: {
    gold: { gp: 100, formula: "4d4 × 10 gp" },
    options: [
      { id: "wizard-a", label: "Quarterstaff + scholar's pack", items: ["Quarterstaff", "Component pouch", "Spellbook", ...pack("Scholar's Pack")] },
      { id: "wizard-b", label: "Dagger + explorer's pack", items: ["Dagger", "Arcane focus", "Spellbook", ...pack("Explorer's Pack")] },
    ],
  },
  Artificer: {
    gold: { gp: 125, formula: "5d4 × 10 gp" },
    options: [
      { id: "artificer-a", label: "Studded leather + crossbow + tools", items: ["Any two simple weapons (your choice)", "Light crossbow", "20 crossbow bolts", "Studded leather armor", "Thieves' tools", "Artisan's tools (your choice)", ...pack("Dungeoneer's Pack")] },
      { id: "artificer-b", label: "Scale mail + explorer's pack", items: ["Any two simple weapons (your choice)", "Light crossbow", "20 crossbow bolts", "Scale mail", "Thieves' tools", "Artisan's tools (your choice)", ...pack("Explorer's Pack")] },
    ],
  },
};

export function slugId(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "option";
}

export function goldOptionIdFor(className) {
  return `${slugId(className)}-gold`;
}

/** Pure resolution of a Starting Equipment pick: which inventory
 *  lines and how much gold it yields. Used by Finish Setup and by
 *  tests; the renderer only collects the option id. */
export function resolveStartingEquipmentPick(className, background, classOptionId) {
  const items = [];
  let gp = 0;
  const entry = CLASS_STARTING_EQUIPMENT[className];
  if (entry) {
    if (classOptionId === goldOptionIdFor(className)) {
      gp += entry.gold.gp;
    } else {
      const opt = entry.options.find((o) => o.id === classOptionId);
      if (opt) items.push(...opt.items);
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

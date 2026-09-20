// raceCategories.js — organizational groupings for the character-creation
// Race picker. These are display buckets only (nothing mechanical reads
// them): each category has a short description plus its member races in
// alphabetical order, and the picker renders category → race → subrace
// (three levels, each expandable). Every starter race belongs to exactly
// one category — scripts/smoke-imports.mjs enforces the coverage.

export const RACE_CATEGORIES = [
  {
    id: "planetouched",
    name: "Planetouched",
    description: "Mortals with outsider blood — celestial, fiendish, or elemental. Proud, strange, and never quite of this world.",
    races: ["Aasimar", "Air Genasi", "Earth Genasi", "Fire Genasi", "Tiefling", "Water Genasi"],
  },
  {
    id: "elven-peoples",
    name: "Elven Peoples",
    description: "The fair folk and their kin — long-lived, graceful, and pleasantly aloof.",
    races: ["Elf", "Half-Elf"],
  },
  {
    id: "dwarven-peoples",
    name: "Dwarven Peoples",
    description: "Stout mountain clans — steadfast, tradition-bound, and slow to trust.",
    races: ["Dwarf"],
  },
  {
    id: "small-folk",
    name: "Small Folk",
    description: "Halflings and gnomes — lucky, curious, and underestimated by absolutely everyone.",
    races: ["Gnome", "Halfling"],
  },
  {
    id: "wondrous-peoples",
    name: "Wondrous Peoples",
    description: "Dragon heirs, tribal warriors, serpent schemers, sky hunters, and shapeshifters — peoples whose very nature bends the rules.",
    races: ["Aarakocra", "Changeling", "Dragonborn", "Half-Orc", "Yuan-ti"],
  },
  {
    id: "humankind",
    name: "Humankind",
    description: "Humans and those who define themselves — adaptable, ambitious, and endlessly varied.",
    races: ["Custom Lineage", "Human"],
  },
];

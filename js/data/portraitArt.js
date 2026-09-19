// portraitArt.js — example portraits for the character-creation
// pickers (races, classes, backgrounds).
//
// All images are public-domain or CC0 artworks (classical paintings
// and prints) stored as static files under assets/portraits, so they
// load with the site itself — never hotlinked, never stored in
// Firestore (which caps documents at 1MB). See
// assets/portraits/SOURCES.md for title/artist/source per file.
//
// Lookup is by display name (case-insensitive); anything unmapped
// simply yields null and the picker keeps its initial-letter tile.

const PORTRAITS = {
  // --- Classes ---
  "barbarian": "assets/portraits/class-barbarian.jpg",
  "bard": "assets/portraits/class-bard.jpg",
  "cleric": "assets/portraits/class-cleric.jpg",
  "druid": "assets/portraits/class-druid.jpg",
  "fighter": "assets/portraits/class-fighter.jpg",
  "monk": "assets/portraits/class-monk.jpg",
  "paladin": "assets/portraits/class-paladin.jpg",
  "ranger": "assets/portraits/class-ranger.jpg",
  "rogue": "assets/portraits/class-rogue.jpg",
  "sorcerer": "assets/portraits/class-sorcerer.jpg",
  "warlock": "assets/portraits/class-warlock.jpg",
  "wizard": "assets/portraits/class-wizard.jpg",
  // --- Races ---
  "aarakocra": "assets/portraits/race-aarakocra.jpg",
  "aasimar": "assets/portraits/race-aasimar.jpg",
  "air genasi": "assets/portraits/race-air-genasi.jpg",
  "changeling": "assets/portraits/race-changeling.jpg",
  "custom lineage": "assets/portraits/race-custom-lineage.jpg",
  "dragonborn": "assets/portraits/race-dragonborn.jpg",
  "dwarf": "assets/portraits/race-dwarf.jpg",
  "hill dwarf": "assets/portraits/race-hill-dwarf.jpg",
  "mountain dwarf": "assets/portraits/race-mountain-dwarf.jpg",
  "duergar": "assets/portraits/race-duergar.jpg",
  "gnome": "assets/portraits/race-gnome.jpg",
  "halfling": "assets/portraits/race-halfling.jpg",
  "yuan-ti": "assets/portraits/race-yuan-ti.jpg",
  "human": "assets/portraits/race-human.jpg",
  "elf": "assets/portraits/race-elf.jpg",
  "half-elf": "assets/portraits/race-half-elf.jpg",
  "half-orc": "assets/portraits/race-half-orc.jpg",
  "tiefling": "assets/portraits/race-tiefling.jpg",
  // --- Backgrounds ---
  "acolyte": "assets/portraits/bg-acolyte.jpg",
  "entertainer": "assets/portraits/bg-entertainer.jpg",
  "folk hero": "assets/portraits/bg-folk-hero.jpg",
  "guild artisan": "assets/portraits/bg-guild-artisan.jpg",
  "noble": "assets/portraits/bg-noble.jpg",
  "outlander": "assets/portraits/bg-outlander.jpg",
  "sage": "assets/portraits/bg-sage.jpg",
  "sailor": "assets/portraits/bg-sailor.jpg",
  "urban bounty hunter": "assets/portraits/bg-urban-bounty-hunter.jpg",
};

/** Static portrait path for a race/class/background display name, or
 *  null when none is on file. Pure. */
export function portraitArtFor(name) {
  if (!name) return null;
  return PORTRAITS[String(name).trim().toLowerCase()] || null;
}

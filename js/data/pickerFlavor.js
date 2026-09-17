// pickerFlavor.js — hand-written 1–2 sentence briefs for the
// character-creation pickers.
//
// Each blurb foregrounds what the catalog descriptions often bury:
// for races/backgrounds, personality + social standing (how the world
// sees you, how you tend to act); for classes, personality +
// playstyle (what you actually do at the table, and who it's for).
// Kept to ~2 sentences so rows stay scannable. customSheet's flavor
// lookup prefers these over catalog descriptions; catalogs (with
// portraits) are untouched.

export const CLASS_FLAVOR = {
  Barbarian: "Rage-fueled front-line brawler. You charge in first, soak hits, and hit back harder — best for players who want simple, brutal, high-damage melee.",
  Bard: "Charismatic jack-of-all-trades. You talk, sneak, cast, and inspire the party — best for players who want to do a little of everything and be the face.",
  Cleric: "Divine full caster in armor. You heal, protect, and smite for your god — best for players who want magic with staying power and a sacred mission.",
  Druid: "Nature's shapeshifting caster. Wild Shape, control spells, and wilderness mastery — best for players who love versatility and the wild.",
  Fighter: "Disciplined weapon specialist with unmatched staying power. Extra attacks and second chances — best for players who want dependable martial play with room to customize.",
  Monk: "Fast, unarmored striker. Stunning strikes, mobility, and ki-powered tricks — best for players who want speed and style over armor.",
  Paladin: "Holy warrior bound by oath. Heavy armor, burst smite damage, and protective auras — best for players who want righteous melee with conviction.",
  Ranger: "Wilderness hunter and tracker. Favored enemies, exploration mastery, and skirmish archery — best for players who want a self-reliant outdoors specialist.",
  Rogue: "Skill expert and ambusher. Sneak Attack, expertise, and cunning action — best for players who want clever play and big precision hits.",
  Sorcerer: "Instinctive arcane blaster. Few spells known, but metamagic bends them — best for players who want explosive, flexible casting.",
  Warlock: "Pact-bound caster with endlessly renewable tricks. Eldritch Blast plus invocations on a short-rest rhythm — best for players who like a dark bargain.",
  Wizard: "The prepared scholar of magic. The biggest spellbook in the game — best for players who love planning, utility, and always having the right spell.",
};

export const RACE_FLAVOR = {
  Aarakocra: "Reclusive bird-folk from high peaks. Aloof dreamers who distrust ground-bound politics — flight makes them peerless scouts.",
  Aasimar: "Mortals touched by celestial power. Often reluctant champions wrestling with destiny — others look to them for guidance, wanted or not.",
  "Air Genasi": "Restless descendants of djinn. Free-spirited wanderers who chafe at roots — quick, proud, and hard to pin down.",
  Changeling: "Shapeshifting outsiders. Charming, guarded, and hard to know — valued as spies, mistrusted as strangers.",
  "Custom Lineage": "One of a kind. Your story is yours alone — fey-touched, construct, or something new entirely.",
  Dragonborn: "Proud draconic heirs. Clan honor above all — direct, loyal, and slow to forgive an insult.",
  Dwarf: "Stout clanfolk of stone and forge. Gruff, steadfast, tradition-bound — slow to trust, slower to abandon an ally.",
  "Hill Dwarf": "Warm-hearted clan wardens. Tough, generous, and stubborn about hospitality — the heart of dwarven community.",
  "Mountain Dwarf": "Armored masters of war and craft. Disciplined and proud — mountain holds respect strength shown, not claimed.",
  Duergar: "Hardened gray dwarves of the Underdark. Grim survivors shaped by slavery — distrustful, disciplined, and relentless.",
  Gnome: "Curious tinkerers and tricksters. Cheerful obsessives who collect knowledge and jokes in equal measure.",
  Halfling: "Lucky, warm homebodies with wanderlust. Unassuming and brave — underestimated by everyone, once.",
  "Yuan-ti": "Serpent-blooded schemers. Cold, patient, and unreadable — even allies wonder what they're really after.",
  Human: "Ambitious and adaptable. Short-lived, so they build fast — the diplomats, empire-makers, and wild cards of every realm.",
  Elf: "Graceful and centuries-patient. Aloof aesthetes who watch kingdoms rise and fall — slow to befriend, loyal for life.",
  "Half-Elf": "Caught between two worlds. Natural diplomats and wanderers — welcome everywhere, at home nowhere.",
  "Half-Orc": "Strong outsiders proving themselves daily. Fierce, blunt, and fiercely loyal once trust is earned.",
  Tiefling: "Infernal-blooded and side-eyed since birth. Defiant survivors — mistrust made many a tiefling self-reliant and sharp.",
};

export const BG_FLAVOR = {
  Acolyte: "Raised in temple service. Pious and connected to the faithful — temples shelter you, and the gods watch.",
  Entertainer: "Born performer. You win crowds and rooms — fame opens doors that gold can't.",
  "Folk Hero": "Champion of the common folk. Humble roots; rustics hide and aid you — destiny chose you, like it or not.",
  "Guild Artisan": "Master of a craft and its guild. Connected, reputable, and owed favors — business is business.",
  Noble: "Highborn and used to deference. Your name opens doors — and paints targets.",
  Outlander: "Raised in the wilds. Self-reliant and blunt — civilization's rules feel optional to you.",
  Sage: "Lifelong researcher. You know things others don't — and know where to find the rest.",
  Sailor: "Sea-tested crew hand. Superstitious, loyal to shipmates, at ease on any vessel.",
  "Urban Bounty Hunter": "Street-smart tracker. You know the city's underbelly — and it knows you.",
};

// Case-insensitive lookup across all three tables.
const ALL = new Map();
for (const table of [CLASS_FLAVOR, RACE_FLAVOR, BG_FLAVOR]) {
  for (const [name, text] of Object.entries(table)) ALL.set(name.trim().toLowerCase(), text);
}

export function flavorFor(name) {
  if (!name) return null;
  return ALL.get(String(name).trim().toLowerCase()) || null;
}

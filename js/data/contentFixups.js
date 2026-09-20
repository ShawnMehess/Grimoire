// contentFixups.js — hand-written pickers for choices the source data
// left as reference-key stubs.
//
// DEFAULT_CONTENT (auto-generated, must stay regenerable) and
// SUBCLASS_SUPPLEMENT (same) land several real player choices as
// "track your pick by hand" feature notes because the source JSON
// carried only an options_source key. This module REPLACES those
// notes with real choiceGroups pickers, plus a few 2014-PHB gaps the
// sources never covered (Elf subraces, free-form racial ASIs).
//
// Single-source rule: FIXED_CLASS_ENTRIES / FIXED_RACE_ENTRIES /
// patched subclass bundles are built ONCE here (deep-cloned, then
// patched). blockModel.js (starter dropdowns) and bundleMaps.js
// (save/load strip+hydrate) both consume these — never the raw
// imports — so canonical-comparison stays exact. dnd5e.js keeps using
// the raw entries (it only reads names/slots/subclass lists).
//
// What stays a note on purpose (free choice from hundreds of spells
// needs a picker UI that doesn't exist — record picks in Spells Known
// via the spell browser instead):
// - Bard Magical Secrets, Warlock Mystic Arcanum.

import { DEFAULT_CONTENT } from "./defaultContent.js";
import { SUBCLASS_SUPPLEMENT } from "./subclassContent.js";
import { RACE_EXTRA_ENTRIES } from "./extraRaces.js";
import { SKILLS, ABILITIES } from "./schema.js";

const clone = (obj) => JSON.parse(JSON.stringify(obj));

function textOption(prefix, name, description) {
  return {
    id: `${prefix}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name, description,
    statModifiers: [],
    featureGrants: [{ name, description, minLevel: null }],
    resourceGrants: [],
  };
}

// Remove feature notes matching `test` (the replaced stubs) and
// return their minLevels (so the replacement group keeps the right
// unlock level even when several same-named notes exist).
function takeNotes(bundle, test) {
  const taken = [];
  bundle.featureGrants = (bundle.featureGrants || []).filter((g) => {
    if (test(g)) { taken.push(g.minLevel ?? null); return false; }
    return true;
  });
  return taken;
}

function skillExpertiseOptions(prefix) {
  return SKILLS.map((s) => ({
    id: `${prefix}-expertise-${s.id}`, name: s.label, description: "",
    statModifiers: [],
    featureGrants: [{
      name: `Expertise: ${s.label}`,
      description: `Double your proficiency bonus for ${s.label} checks. The sheet has no doubling mechanic — proficiency plus this note; apply the doubled bonus by hand.`,
      minLevel: null,
    }],
    resourceGrants: [],
  }));
}

// --- Fighting styles (2014 PHB lists) ---------------------------------------
const FIGHTING_STYLES = {
  Archery: "You gain a +2 bonus to attack rolls you make with ranged weapons.",
  Defense: "While you are wearing armor, you gain a +1 bonus to AC.",
  Dueling: "When wielding a melee weapon in one hand and no other weapon, you gain a +2 bonus to damage rolls with that weapon.",
  "Great Weapon Fighting": "When you roll a 1 or 2 on a damage die for a two-handed/melee-versatile attack, you can reroll the die (must use the new roll).",
  Protection: "When a creature you can see attacks a target other than you within 5 feet while you wield a shield, use your reaction to impose disadvantage.",
  "Two-Weapon Fighting": "When you engage in two-weapon fighting, you can add your ability modifier to the damage of the second attack.",
  "Blind Fighting": "You have blindsight with a range of 10 feet. You can see anything in range that isn't behind total cover, even blinded or in darkness, plus invisible creatures unless hidden.",
  Interception: "When a creature you can see hits another target within 5 feet of you, use your reaction to reduce the damage by 1d10 + proficiency bonus (min 0). Must wield a shield or simple/martial weapon.",
  "Superior Technique": "Learn one Battle Master maneuver; gain one d6 superiority die (short/long rest). Save DC = 8 + proficiency + Str or Dex (your choice).",
  "Thrown Weapon Fighting": "Draw a thrown weapon as part of the attack; +2 damage on ranged thrown-weapon hits.",
  "Unarmed Fighting": "Unarmed strikes deal 1d6 + Str bludgeoning (d8 if no weapons/shield). At the start of each turn deal 1d4 to one grappled creature.",
  "Blessed Warrior": "Learn two Cleric cantrips (Cha-based, count as Paladin spells); replace one per Paladin level.",
  "Druidic Warrior": "Learn two Druid cantrips (Wis-based, count as Ranger spells); replace one per Ranger level.",
};
const FS_LISTS = {
  Fighter: ["Archery", "Defense", "Dueling", "Great Weapon Fighting", "Protection", "Two-Weapon Fighting", "Blind Fighting", "Interception", "Superior Technique", "Thrown Weapon Fighting", "Unarmed Fighting"],
  Paladin: ["Defense", "Dueling", "Great Weapon Fighting", "Protection", "Blessed Warrior", "Blind Fighting", "Interception"],
  Ranger: ["Archery", "Defense", "Dueling", "Two-Weapon Fighting", "Blind Fighting", "Druidic Warrior", "Thrown Weapon Fighting"],
};

function fightingStyleGroup(prefix, minLevel, styles) {
  return {
    id: `${prefix}-fighting-style`, label: "Fighting Style", minLevel,
    minSelections: 1, maxSelections: 1,
    options: styles.map((s) => textOption(`${prefix}-fighting-style`, s,
      `${FIGHTING_STYLES[s]} (Recorded here — conditional combat mechanics like this are tracked, not auto-applied.)`)),
  };
}

// --- Sorcerer Metamagic (2014 PHB 8 + TCE Seeking/Transmuted) -------------
const METAMAGIC = {
  "Careful Spell": "Spend 1 sorcery point; chosen creatures automatically succeed on the spell's save.",
  "Distant Spell": "Spend 1 sorcery point to double range (or make touch 30 ft).",
  "Empowered Spell": "Spend 1 sorcery point to reroll up to CHA-mod damage dice.",
  "Extended Spell": "Spend 1 sorcery point to double duration (max 24 hours).",
  "Heightened Spell": "Spend 3 sorcery points to impose disadvantage on one target's first save.",
  "Quickened Spell": "Spend 2 sorcery points to cast a 1-action spell as a bonus action.",
  "Subtle Spell": "Spend 1 sorcery point to cast without somatic/verbal components.",
  "Twinned Spell": "Spend sorcery points equal to the spell's level to target a second creature.",
  "Seeking Spell": "Spend 2 sorcery points to reroll a missed spell attack (must use the new roll). Usable even with another Metamagic on the spell.",
  "Transmuted Spell": "Spend 1 sorcery point to change a spell's acid/cold/fire/lightning/poison/thunder damage to another listed type.",
};

// --- Warlock invocations (2014 PHB + TCE, with prerequisites) -------------------
const INVOCATIONS = [
  ["Agonizing Blast", "Add CHA modifier to Eldritch Blast damage. Prerequisite: Eldritch Blast cantrip."],
  ["Armor of Shadows", "Cast Mage Armor on yourself at will (no slot/materials)."],
  ["Beast Speech", "Cast Speak with Animals at will (no slot)."],
  ["Beguiling Influence", "Proficiency in Deception and Persuasion."],
  ["Book of Ancient Secrets", "Inscribe rituals in your Book of Shadows. Prerequisite: Pact of the Tome."],
  ["Devil's Sight", "See normally in darkness (magical too) to 120 feet."],
  ["Eldritch Sight", "Cast Detect Magic at will (no slot)."],
  ["Eldritch Spear", "Eldritch Blast range becomes 300 feet. Prerequisite: Eldritch Blast cantrip."],
  ["Eyes of the Rune Keeper", "Read all writing."],
  ["Fiendish Vigor", "Cast False Life on yourself at will as a 1st-level spell (no slot)."],
  ["Gaze of Two Minds", "Touch a willing humanoid to perceive through its senses until end of next turn."],
  ["Mask of Many Faces", "Cast Disguise Self at will (no slot)."],
  ["Misty Visions", "Cast Silent Image at will (no slot)."],
  ["One with Shadows", "Turn invisible in dim light/darkness until you move or act (concentration not required). Prerequisite: 5th level."],
  ["Repelling Blast", "Push Large-or-smaller creatures hit by Eldritch Blast 10 feet. Prerequisite: Eldritch Blast cantrip."],
  ["Thirsting Blade", "Extra attack with pact weapon. Prerequisite: 5th level, Pact of the Blade."],
  ["Whispers of the Grave", "Cast Speak with Dead at will (no slot). Prerequisite: 9th level."],
  ["Bond of the Talisman", "You or the talisman's wearer can action-teleport to the nearest unoccupied space by the other (same plane), proficiency times/rest. Prerequisite: 12th level, Pact of the Talisman."],
  ["Eldritch Mind", "Advantage on Constitution saves to maintain concentration."],
  ["Far Scribe", "A page in your Book of Shadows holds names (up to proficiency); cast Sending to a named creature without slot/components by writing the message. Prerequisite: 5th level, Pact of the Tome."],
  ["Gift of the Protectors", "A page in your Book of Shadows holds names (up to proficiency); a named creature reduced to 0 HP drops to 1 HP instead (once until long rest). Prerequisite: 9th level, Pact of the Tome."],
  ["Investment of the Chain Master", "Your familiar gains 40-ft fly or swim speed; bonus action to command Attack; attacks count as magical; saves use your DC; reaction grants it resistance when damaged. Prerequisite: Pact of the Chain."],
  ["Protection of the Talisman", "When the wearer fails a save, add d4 (proficiency times/rest). Prerequisite: 7th level, Pact of the Talisman."],
  ["Rebuke of the Talisman", "When the wearer is hit by an attacker you see within 30 ft, use your reaction to deal proficiency-bonus psychic damage and push it 10 ft. Prerequisite: Pact of the Talisman."],
  ["Undying Servitude", "Cast Animate Dead once without a slot (long rest to reuse). Prerequisite: 5th level."],
];
const PACT_BOONS = {
  "Pact of the Chain": "Gain a familiar (imp, pseudodragon, quasit, or sprite) with extra options.",
  "Pact of the Blade": "Create a pact weapon in your hand; proficient with it; extra attack via Thirsting Blade.",
  "Pact of the Tome": "Your Book of Shadows holds three cantrips from any class list; Book of Ancient Secrets lets you inscribe rituals.",
  "Pact of the Talisman": "Your patron gives you an amulet. When the wearer fails an ability check, add d4 (proficiency times/rest). 1-hour ceremony replaces a lost talisman.",
};

// --- Free-form racial ASIs ------------------------------------------------------
function asiPairTripleOptions(prefix) {
  const ids = ABILITIES.map((a) => a.id);
  const label = Object.fromEntries(ABILITIES.map((a) => [a.id, a.label]));
  const opts = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = [ids[i], ids[j]];
      opts.push({
        id: `${prefix}-asi-${a}-${b}`, name: `+2 ${label[a]} / +1 ${label[b]}`, description: "",
        statModifiers: [
          { targetFieldId: `${a}Score`, op: "add", value: 2, minLevel: null },
          { targetFieldId: `${b}Score`, op: "add", value: 1, minLevel: null },
        ],
        featureGrants: [], resourceGrants: [],
      });
    }
  }
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      for (let k = j + 1; k < ids.length; k++) {
        const [a, b, c] = [ids[i], ids[j], ids[k]];
        opts.push({
          id: `${prefix}-asi-${a}-${b}-${c}`, name: `+1 ${label[a]} / +1 ${label[b]} / +1 ${label[c]}`, description: "",
          statModifiers: [a, b, c].map((x) => ({ targetFieldId: `${x}Score`, op: "add", value: 1, minLevel: null })),
          featureGrants: [], resourceGrants: [],
        });
      }
    }
  }
  return opts; // 15 pairs + 20 triples
}

// --- Class patches ---------------------------------------------------------------
function patchFighter(bundle) {
  const levels = takeNotes(bundle, (g) => /Fighting Style/.test(g.name || ""));
  if (levels.length) {
    bundle.choiceGroups.push(fightingStyleGroup("fighter", Math.min(...levels.filter(Number.isFinite)), FS_LISTS.Fighter));
  }
  return bundle;
}

function patchPaladin(bundle) {
  const levels = takeNotes(bundle, (g) => /Fighting Style/.test(g.name || ""));
  if (levels.length) {
    bundle.choiceGroups.push(fightingStyleGroup("paladin", Math.min(...levels.filter(Number.isFinite)), FS_LISTS.Paladin));
  }
  return bundle;
}

function patchRanger(bundle) {
  const levels = takeNotes(bundle, (g) => /Fighting Style/.test(g.name || ""));
  if (levels.length) {
    bundle.choiceGroups.push(fightingStyleGroup("ranger", Math.min(...levels.filter(Number.isFinite)), FS_LISTS.Ranger));
  }
  return bundle;
}

function patchRogue(bundle) {
  const levels = takeNotes(bundle, (g) => /^Expertise/.test(g.name || ""));
  const thieves = {
    id: "rogue-expertise-thieves-tools", name: "Thieves' Tools", description: "",
    statModifiers: [],
    featureGrants: [{ name: "Expertise: Thieves' Tools", description: "Double your proficiency bonus with Thieves' Tools. Tracked here — apply manually.", minLevel: null }],
    resourceGrants: [],
  };
  levels.forEach((minLevel, i) => {
    bundle.choiceGroups.push({
      id: `rogue-expertise-${i}`, label: "Expertise — pick 2 of your proficiencies", minLevel,
      minSelections: 2, maxSelections: 2,
      options: [...skillExpertiseOptions("rogue"), thieves],
    });
  });
  return bundle;
}

function patchBard(bundle) {
  const levels = takeNotes(bundle, (g) => /^Expertise/.test(g.name || ""));
  levels.forEach((minLevel, i) => {
    bundle.choiceGroups.push({
      id: `bard-expertise-${i}`, label: "Expertise — pick 2 of your proficiencies", minLevel,
      minSelections: 2, maxSelections: 2,
      options: skillExpertiseOptions("bard"),
    });
  });
  // Magical Secrets intentionally stays a note (free pick from every
  // class's list — record chosen spells in Spells Known via the browser).
  return bundle;
}

function patchSorcerer(bundle) {
  const levels = takeNotes(bundle, (g) => /^Metamagic/.test(g.name || ""));
  const counts = [2, 1, 1]; // L3 two, L10 +1, L17 +1
  levels.forEach((minLevel, i) => {
    bundle.choiceGroups.push({
      id: `sorcerer-metamagic-${i}`, label: `Metamagic — pick ${counts[i] ?? 1}`, minLevel,
      minSelections: counts[i] ?? 1, maxSelections: counts[i] ?? 1,
      options: Object.entries(METAMAGIC).map(([n, d]) => textOption(`sorcerer-metamagic-${i}`, n, `${d} (Costs sorcery points — tracked, not auto-spent.)`)),
    });
  });
  return bundle;
}

function patchWarlock(bundle) {
  const invoLevels = takeNotes(bundle, (g) => /^Eldritch Invocations/.test(g.name || ""));
  const base = invoLevels.length ? Math.min(...invoLevels.filter(Number.isFinite)) : 2;
  // Known counts by level: 2, then +1 at 5/7/9/12/15/18.
  const tiers = [{ minLevel: base, count: 2 }, { minLevel: 5, count: 1 }, { minLevel: 7, count: 1 }, { minLevel: 9, count: 1 }, { minLevel: 12, count: 1 }, { minLevel: 15, count: 1 }, { minLevel: 18, count: 1 }];
  tiers.forEach((tier, i) => {
    bundle.choiceGroups.push({
      id: `warlock-invocations-${i}`, label: `Eldritch Invocations — pick ${tier.count} (level ${tier.minLevel}+)`, minLevel: tier.minLevel,
      minSelections: tier.count, maxSelections: tier.count,
      options: INVOCATIONS.map(([n, d]) => textOption(`warlock-invocations-${i}`, n, `${d} (Recorded here — prerequisites apply, see text.)`)),
    });
  });
  const pactLevels = takeNotes(bundle, (g) => /^Pact Boon/.test(g.name || ""));
  if (pactLevels.length) {
    bundle.choiceGroups.push({
      id: "warlock-pact-boon", label: "Pact Boon", minLevel: Math.min(...pactLevels.filter(Number.isFinite)),
      minSelections: 1, maxSelections: 1,
      options: Object.entries(PACT_BOONS).map(([n, d]) => textOption("warlock-pact-boon", n, d)),
    });
  }
  // Mystic Arcanum intentionally stays a note (free spell of choice —
  // record it in Spells Known via the browser).
  return bundle;
}

const CLASS_PATCHERS = {
  Fighter: patchFighter,
  Paladin: patchPaladin,
  Ranger: patchRanger,
  Rogue: patchRogue,
  Bard: patchBard,
  Sorcerer: patchSorcerer,
  Warlock: patchWarlock,
};

// --- Artificer infusions (TCE, 16 total) --------------------------------------
// Summaries below are short paraphrases of what each infusion does (item
// type, attunement, level prerequisite), matching the tone of the other
// hand-written pickers here — not the book's full prose. Level-gated
// infusions stay selectable with a "Requires Nth level" note, the same
// way warlock invocation prerequisites are handled above.
const ARTIFICER_INFUSIONS = [
  ["Enhanced Arcane Focus", "A rod, staff, or wand (requires attunement). +1 to spell attacks; ignore half cover. Improves to +2 at 10th level."],
  ["Enhanced Defense", "A suit of armor or a shield. +1 to AC while wearing/wielding it. Improves to +2 at 10th level."],
  ["Enhanced Weapon", "A simple or martial weapon. +1 to attack and damage rolls. Improves to +2 at 10th level."],
  ["Homunculus Servant", "A gem or crystal worth 100+ gp. Creates a flying scout companion that can channel your touch-range spells."],
  ["Mind Sharpener", "A suit of armor or robes (requires attunement). 4 charges; use a reaction to turn a failed concentration save into a success."],
  ["Returning Weapon", "A simple or martial weapon with the thrown property. +1 to attack and damage; returns to your hand after the attack."],
  ["Replicate Magic Item", "Learn this multiple times (each pick is a different item). Replicate a common magic item from the leveled tables — record which item on the pick."],
  ["Radiant Weapon", "Requires 6th level. A simple or martial weapon (requires attunement). +1; bonus-action light plus a reaction blind (4 charges)."],
  ["Repeating Shot", "A simple or martial weapon with the ammunition property (requires attunement). +1 to ranged attacks; ignores loading; conjures its own ammunition."],
  ["Repulsion Shield", "Requires 6th level. A shield (requires attunement). +1 to AC; reaction push when hit (4 charges)."],
  ["Resistant Armor", "Requires 6th level. A suit of armor (requires attunement). Resistance to one damage type of your choice; swap on level-up."],
  ["Spell-Refueling Ring", "Requires 6th level. A ring (requires attunement). Bonus action to regain one expended 3rd-level-or-lower slot; once per dawn."],
  ["Boots of the Winding Path", "Requires 6th level. Boots (requires attunement). Bonus action to teleport back to where you stood last turn."],
  ["Helm of Awareness", "Requires 10th level. A helmet (requires attunement). Advantage on initiative; you can't be surprised while conscious."],
  ["Armor of Magical Strength", "A suit of armor (requires attunement). 6 charges; add your Int modifier to a failed Strength check or save."],
  ["Arcane Propulsion Armor", "Requires 14th level. A suit of armor (requires attunement). Gauntlets strike at range and return; +5 walking speed; replaces missing limbs."],
];

function artificerInfusionGroup(index, minLevel, count) {
  return {
    id: `artificer-infusions-${index}`, label: `Infusions Known — pick ${count} (level ${minLevel}+)`, minLevel,
    minSelections: count, maxSelections: count,
    options: ARTIFICER_INFUSIONS.map(([n, d]) => textOption(`artificer-infusions-${index}`, n, `${d} (Recorded here — each infusion lives in one object at a time; see Infuse Item.)`)),
  };
}

// Artisan's tools for the Artificer's free "one of your choice" tool
// proficiency (thieves' + tinker's tools are fixed grants below).
const ARTIFICER_ARTISAN_TOOLS = [
  "Alchemist's Supplies", "Brewer's Supplies", "Calligrapher's Supplies",
  "Carpenter's Tools", "Cartographer's Tools", "Cobbler's Tools",
  "Cook's Utensils", "Glassblower's Tools", "Jeweler's Tools",
  "Leatherworker's Tools", "Mason's Tools", "Painter's Supplies",
  "Potter's Tools", "Smith's Tools", "Weaver's Tools", "Woodcarver's Tools",
];

// --- Race patches -----------------------------------------------------------------
function patchFreeformAsi(bundle, prefix) {
  const levels = takeNotes(bundle, (g) => /plus_2_plus_1_or_three_plus_1s/.test(g.description || ""));
  if (!levels.length) return bundle;
  bundle.choiceGroups.push({
    id: `${prefix}-asi`, label: "Ability Score Increase — +2/+1 or three +1s", minLevel: Math.min(...levels.filter(Number.isFinite).length ? levels.filter(Number.isFinite) : [1]),
    minSelections: 1, maxSelections: 1,
    options: asiPairTripleOptions(prefix),
  });
  return bundle;
}

// --- Dwarven subraces ---------------------------------------------------------------
// Base Dwarves carry no traits or bonuses of their own — Hill,
// Mountain, and Duergar each arrive as a full kit, with the shared
// dwarven traits (Constitution, darkvision, poison resilience,
// stonecunning, weapon training, languages, unslowed speed)
// duplicated onto every option, the same way elven base traits live
// on each elf-subrace option in extraRaces.js.
const DWARF_SHARED_STATS = [
  { targetFieldId: "conScore", op: "add", value: 2, minLevel: null },
  { targetFieldId: "languages", op: "grantTag", value: "Common" },
  { targetFieldId: "languages", op: "grantTag", value: "Dwarvish" },
  { targetFieldId: "weaponProf", op: "grantTag", value: "Battleaxe" },
  { targetFieldId: "weaponProf", op: "grantTag", value: "Handaxe" },
  { targetFieldId: "weaponProf", op: "grantTag", value: "Light Hammer" },
  { targetFieldId: "weaponProf", op: "grantTag", value: "Warhammer" },
];
const DWARF_SHARED_FEATS = [
  { name: "Dwarven Resilience", description: "Advantage on saving throw against poison damage.", minLevel: null },
  { name: "Stonecunning", description: "Double proficiency bonus on history checks related to stonework origin.", minLevel: null },
  { name: "Speed", description: "25 ft. walking (heavy armor doesn't slow you down)", minLevel: null },
  { name: "Senses", description: "Darkvision 60 ft.", minLevel: null },
  { name: "Resistances", description: "Poison", minLevel: null },
];

function dwarfSubraceOption(id, name, extraStats, extraFeats) {
  return {
    id, name, description: "",
    statModifiers: [...clone(DWARF_SHARED_STATS), ...extraStats],
    featureGrants: [...clone(DWARF_SHARED_FEATS), ...extraFeats],
    resourceGrants: [],
  };
}

/** Rebuilds the compiled Dwarf entry as a traitless base whose whole
 *  kit comes from its dwarf-subrace picker (Hill/Mountain/Duergar). */
function dwarfBaseEntry(entry) {
  return {
    ...entry,
    bundle: {
      statModifiers: [],
      dropdownAccess: [],
      featureGrants: [],
      resourceGrants: [],
      choiceGroups: [
        {
          id: "dwarf-subrace", label: "Dwarven Subrace", subrace: true, minLevel: 1, minSelections: 1, maxSelections: 1,
          options: [
            dwarfSubraceOption(
              "dwarf-subrace-hill-dwarf", "Hill Dwarf",
              [{ targetFieldId: "wisScore", op: "add", value: 1, minLevel: null }],
              [{ name: "Dwarven Toughness", description: "Max HP increases by 1 per level.", minLevel: null }]
            ),
            dwarfSubraceOption(
              "dwarf-subrace-mountain-dwarf", "Mountain Dwarf",
              [
                { targetFieldId: "strScore", op: "add", value: 2, minLevel: null },
                { targetFieldId: "armorProf", op: "grantTag", value: "Light Armor" },
                { targetFieldId: "armorProf", op: "grantTag", value: "Medium Armor" },
              ],
              []
            ),
            {
              id: "dwarf-subrace-duergar", name: "Duergar", description: "",
              statModifiers: [
                ...clone(DWARF_SHARED_STATS),
                { targetFieldId: "strScore", op: "add", value: 1, minLevel: null },
              ],
              // Superior darkvision replaces (not joins) the shared 60
              // ft. — only the override is listed.
              featureGrants: [
                { name: "Dwarven Resilience", description: "Advantage on saving throw against poison damage.", minLevel: null },
                { name: "Stonecunning", description: "Double proficiency bonus on history checks related to stonework origin.", minLevel: null },
                { name: "Speed", description: "25 ft. walking (heavy armor doesn't slow you down)", minLevel: null },
                { name: "Senses", description: "Darkvision 120 ft.", minLevel: null },
                { name: "Resistances", description: "Poison", minLevel: null },
                { name: "Duergar Resilience", description: "Advantage on saving throw against illusion or charm or paralyzed.", minLevel: null },
                { name: "Duergar Magic", description: "Cast Enlarge Reduce starting at level 3 once per long rest.; Cast Invisibility starting at level 5 once per long rest.", minLevel: null },
                { name: "Sunlight Sensitivity", description: "Disadvantage on attack roll, perception sight in direct sunlight.", minLevel: null },
              ],
              resourceGrants: [],
            },
          ],
        },
      ],
    },
  };
}

// Standalone Hill/Mountain/Duergar races and standalone Air/Earth/
// Fire/Water Genasi are superseded by the Dwarf/Genasi bases' subrace
// pickers below — they leave the race list (existing characters
// holding one are migrated to the base race + the matching pick on
// sheet open; see healLegacySubsumedRaces in customSheet.js).
export const SUPERSEDED_RACE_NAMES = new Set(["Hill Dwarf", "Mountain Dwarf", "Duergar", "Air Genasi", "Earth Genasi", "Fire Genasi", "Water Genasi"]);

/** Pre-subrace bundles for the gutted bases, keyed by race name —
 *  each value is the list of historical shapes that count as "an
 *  uncustomized older copy, upgrade me". Dwarf/Gnome/Halfling are
 *  computed from the still-present compiled sources via the same
 *  patchRaceEntry every sheet was built with (keep that function
 *  behavior-stable for these three, or update this registry to
 *  match); Elf's two hand-written predecessors are recorded
 *  verbatim (without, then with, the partial elf-subrace picker).
 *  Anything NOT deep-equal to a listed shape is treated as
 *  customized and left strictly alone. Used by
 *  reconcileDropdownChoices (see sheetWizard.js). */
export function legacyRaceBundles() {
  const out = new Map();
  for (const name of ["Dwarf", "Gnome", "Halfling"]) {
    const compiled = DEFAULT_CONTENT.raceEntries.find((e) => e.name === name);
    if (compiled) out.set(name, [patchRaceEntry(compiled).bundle]);
  }
  const elfBase = (extra) => ({
    statModifiers: [
      { targetFieldId: "dexScore", op: "add", value: 2 },
      { targetFieldId: "perceptionProf", op: "grant" },
      { targetFieldId: "languages", op: "grantTag", value: "Common" },
      { targetFieldId: "languages", op: "grantTag", value: "Elvish" },
    ],
    dropdownAccess: [],
    featureGrants: [
      { name: "Darkvision", description: "You can see in dim light within 60 feet as if it were bright light, and in darkness as if it were dim light (no color in darkness).", minLevel: 1 },
      { name: "Keen Senses", description: "You have proficiency in the Perception skill.", minLevel: 1 },
      { name: "Fey Ancestry", description: "You have advantage on saving throws against being charmed, and magic can't put you to sleep.", minLevel: 1 },
      { name: "Trance", description: "Elves don't need to sleep. You meditate for 4 hours instead (still considered a long rest).", minLevel: 1 },
      { name: "Elven Subrace", description: "Choose a subrace with your DM (High, Wood, or Drow) — it grants extra traits. Track your subrace pick by hand for now; there is no subrace picker yet.", minLevel: 1 },
      { name: "Speed", description: "30 ft. walking", minLevel: 1 },
    ],
    resourceGrants: [],
    ...extra,
  });
  const elfPartialSubrace = {
    choiceGroups: [
      {
        id: "elf-subrace", label: "Elven Subrace", minLevel: 1, minSelections: 1, maxSelections: 1,
        options: [
          {
            id: "elf-subrace-high", name: "High Elf", description: "",
            statModifiers: [
              { targetFieldId: "intScore", op: "add", value: 1, minLevel: null },
              { targetFieldId: "weaponProf", op: "grantTag", value: "Longsword" },
              { targetFieldId: "weaponProf", op: "grantTag", value: "Shortsword" },
              { targetFieldId: "weaponProf", op: "grantTag", value: "Shortbow" },
              { targetFieldId: "weaponProf", op: "grantTag", value: "Longbow" },
              { targetFieldId: "languages", op: "grantTag", value: "Common" },
            ],
            featureGrants: [
              { name: "Elf Weapon Training", description: "Proficiency with the longsword, shortsword, shortbow, and longbow.", minLevel: null },
              { name: "Cantrip", description: "You know one cantrip of your choice from the wizard spell list (pick below); Intelligence is your spellcasting ability for it.", minLevel: null },
              { name: "Extra Language", description: "You can speak, read, and write one extra language of your choice.", minLevel: null },
            ],
            resourceGrants: [],
          },
          {
            id: "elf-subrace-wood", name: "Wood Elf", description: "",
            statModifiers: [
              { targetFieldId: "wisScore", op: "add", value: 1, minLevel: null },
              { targetFieldId: "speed", op: "add", value: 5, minLevel: null },
              { targetFieldId: "weaponProf", op: "grantTag", value: "Longsword" },
              { targetFieldId: "weaponProf", op: "grantTag", value: "Shortsword" },
              { targetFieldId: "weaponProf", op: "grantTag", value: "Shortbow" },
              { targetFieldId: "weaponProf", op: "grantTag", value: "Longbow" },
            ],
            featureGrants: [
              { name: "Elf Weapon Training", description: "Proficiency with the longsword, shortsword, shortbow, and longbow.", minLevel: null },
              { name: "Fleet of Foot", description: "Your base walking speed increases to 35 feet (+5 applied here).", minLevel: null },
              { name: "Mask of the Wild", description: "You can attempt to hide even when only lightly obscured by foliage, rain, snow, mist, or other natural phenomena.", minLevel: null },
            ],
            resourceGrants: [],
          },
          {
            id: "elf-subrace-drow", name: "Drow", description: "",
            statModifiers: [
              { targetFieldId: "chaScore", op: "add", value: 1, minLevel: null },
              { targetFieldId: "spellsKnown", op: "addItem", value: "Dancing Lights", minLevel: null },
              { targetFieldId: "spellsKnown", op: "addItem", value: "Faerie Fire", minLevel: 3 },
              { targetFieldId: "spellsKnown", op: "addItem", value: "Darkness", minLevel: 5 },
            ],
            featureGrants: [
              { name: "Superior Darkvision", description: "Your darkvision has a radius of 120 feet.", minLevel: null },
              { name: "Sunlight Sensitivity", description: "Disadvantage on attack rolls and Wisdom (Perception) checks relying on sight when you, the target, or the thing you perceive is in direct sunlight.", minLevel: null },
              { name: "Drow Magic", description: "Dancing Lights cantrip; Faerie Fire once per long rest at 3rd level; Darkness once per long rest at 5th. Charisma is your spellcasting ability.", minLevel: null },
            ],
            resourceGrants: [],
          },
        ],
      },
    ],
  };
  out.set("Elf", [elfBase({ choiceGroups: [] }), elfBase(elfPartialSubrace)]);
  return out;
}

// --- Gnomish + Halfling subraces ------------------------------------------------
// Base Gnomes/Halflings carry no traits or bonuses of their own —
// Forest/Rock and Lightfoot/Stout each arrive as a full kit, with the
// shared traits duplicated onto every option (same rule as elves and
// dwarves above).
const GNOME_SHARED_STATS = [
  { targetFieldId: "intScore", op: "add", value: 2, minLevel: null },
  { targetFieldId: "languages", op: "grantTag", value: "Common" },
  { targetFieldId: "languages", op: "grantTag", value: "Gnomish" },
];
const GNOME_SHARED_FEATS = [
  { name: "Gnome Cunning", description: "Advantage on saving throw on INT/WIS/CHA saves against magic.", minLevel: null },
  { name: "Speed", description: "25 ft. walking", minLevel: null },
  { name: "Senses", description: "Darkvision 60 ft.", minLevel: null },
];
const HALFLING_SHARED_STATS = [
  { targetFieldId: "dexScore", op: "add", value: 2, minLevel: null },
  { targetFieldId: "languages", op: "grantTag", value: "Common" },
  { targetFieldId: "languages", op: "grantTag", value: "Halfling" },
];
const HALFLING_SHARED_FEATS = [
  { name: "Lucky", description: "Reroll a 1 on attack roll, ability check, saving throw dice (must use the new roll).", minLevel: null },
  { name: "Brave", description: "Advantage on saving throw against frightened.", minLevel: null },
  { name: "Halfling Nimbleness", description: "Can move through the space of any creature that is a size larger than you.", minLevel: null },
  { name: "Speed", description: "25 ft. walking", minLevel: null },
];

function gnomeSubraceOption(id, name, extraStats, extraFeats) {
  return {
    id, name, description: "",
    statModifiers: [...clone(GNOME_SHARED_STATS), ...extraStats],
    featureGrants: [...clone(GNOME_SHARED_FEATS), ...extraFeats],
    resourceGrants: [],
  };
}

function halflingSubraceOption(id, name, extraStats, extraFeats) {
  return {
    id, name, description: "",
    statModifiers: [...clone(HALFLING_SHARED_STATS), ...extraStats],
    featureGrants: [...clone(HALFLING_SHARED_FEATS), ...extraFeats],
    resourceGrants: [],
  };
}

/** Base Genasi: no traits of its own besides the floating ability
 *  increase all four heritages share (MotM leaves the exact split to
 *  the player, hence the shared picker rather than four copies).
 *  Speed, languages, and elemental traits live on each subrace
 *  option, like every other subrace on this site. */
function genasiBaseEntry() {
  const bundle = {
    statModifiers: [],
    dropdownAccess: [],
    featureGrants: [
      { name: "Ability Score Increase", description: "Ability Score Increase: plus_2_plus_1_or_three_plus_1s (pick by hand, not a selectable list here yet)", minLevel: 1 },
    ],
    resourceGrants: [],
    choiceGroups: [
      {
        id: "genasi-subrace", label: "Genasi Subrace", subrace: true, minLevel: 1, minSelections: 1, maxSelections: 1,
        options: [
          {
            id: "genasi-subrace-air-genasi", name: "Air Genasi", description: "",
            statModifiers: [
              { targetFieldId: "languages", op: "grantTag", value: "Common" },
            ],
            featureGrants: [
              { name: "Unending Breath", description: "Can hold your breath indefinitely.", minLevel: null },
              { name: "Mingle with the Wind", description: "Know the Shocking Grasp cantrip.; Cast Feather Fall starting at level 3 once per long rest (no material components needed).; Cast Levitate starting at level 5 once per long rest (no material components needed).", minLevel: null },
              { name: "Speed", description: "35 ft. walking", minLevel: null },
              { name: "Senses", description: "Darkvision 60 ft.", minLevel: null },
              { name: "Resistances", description: "Lightning", minLevel: null },
            ],
            resourceGrants: [],
          },
          {
            id: "genasi-subrace-earth-genasi", name: "Earth Genasi", description: "",
            statModifiers: [
              { targetFieldId: "languages", op: "grantTag", value: "Common" },
            ],
            featureGrants: [
              { name: "Earth Walk", description: "You can move across difficult terrain without expending extra movement if you are using your walking speed on the ground or a floor.", minLevel: null },
              { name: "Merge with Stone", description: "You know the Blade Ward cantrip, and can cast it as a bonus action a number of times equal to your proficiency bonus (regained on a long rest). At 5th level you can cast Pass without Trace once per long rest without material components. Intelligence, Wisdom, or Charisma is your spellcasting ability for these (choose).", minLevel: null },
              { name: "Senses", description: "Darkvision 60 ft.", minLevel: null },
              { name: "Speed", description: "30 ft. walking", minLevel: null },
            ],
            resourceGrants: [],
          },
          {
            id: "genasi-subrace-fire-genasi", name: "Fire Genasi", description: "",
            statModifiers: [
              { targetFieldId: "languages", op: "grantTag", value: "Common" },
            ],
            featureGrants: [
              { name: "Senses", description: "Darkvision 60 ft., seeing darkness in shades of red.", minLevel: null },
              { name: "Resistances", description: "Fire", minLevel: null },
              { name: "Reach to the Blaze", description: "You know the Produce Flame cantrip. At 3rd level you can cast Burning Hands once per long rest; at 5th level you can also cast Flame Blade once per long rest. Constitution is your spellcasting ability for these.", minLevel: null },
              { name: "Speed", description: "30 ft. walking", minLevel: null },
            ],
            resourceGrants: [],
          },
          {
            id: "genasi-subrace-water-genasi", name: "Water Genasi", description: "",
            statModifiers: [
              { targetFieldId: "languages", op: "grantTag", value: "Common" },
            ],
            featureGrants: [
              { name: "Resistances", description: "Acid", minLevel: null },
              { name: "Amphibious", description: "You can breathe air and water.", minLevel: null },
              { name: "Call to the Wave", description: "You know the Acid Splash cantrip. At 3rd level you can cast Create or Destroy Water as a 2nd-level spell once per long rest; at 5th level you can also cast Water Walk once per long rest. Intelligence, Wisdom, or Charisma is your spellcasting ability for these (choose).", minLevel: null },
              { name: "Speed", description: "30 ft. walking", minLevel: null },
            ],
            resourceGrants: [],
          },
        ],
      },
    ],
  };
  patchFreeformAsi(bundle, "genasi");
  return { name: "Genasi", bundle };
}

/** Rebuilds the compiled Gnome/Halfling entries as traitless bases
 *  whose whole kit comes from their subrace picker. */
function gnomeBaseEntry(entry) {
  return {
    ...entry,
    bundle: {
      statModifiers: [],
      dropdownAccess: [],
      featureGrants: [],
      resourceGrants: [],
      choiceGroups: [
        {
          id: "gnome-subrace", label: "Gnomish Subrace", subrace: true, minLevel: 1, minSelections: 1, maxSelections: 1,
          options: [
            gnomeSubraceOption(
              "gnome-subrace-forest-gnome", "Forest Gnome",
              [{ targetFieldId: "dexScore", op: "add", value: 1, minLevel: null }],
              [
                { name: "Natural Illusionist", description: "You know the Minor Illusion cantrip. Intelligence is your spellcasting ability for it.", minLevel: null },
                { name: "Speak with Small Beasts", description: "Through sounds and gestures, you can communicate simple ideas with Small or smaller beasts.", minLevel: null },
              ]
            ),
            gnomeSubraceOption(
              "gnome-subrace-rock-gnome", "Rock Gnome",
              [
                { targetFieldId: "conScore", op: "add", value: 1, minLevel: null },
                { targetFieldId: "toolProf", op: "grantTag", value: "Tinker's Tools" },
              ],
              [
                { name: "Artificer's Lore", description: "Whenever you make an Intelligence (History) check related to magic items, alchemical objects, or technological devices, you can add twice your proficiency bonus instead of any proficiency bonus you normally apply.", minLevel: null },
                { name: "Tinker", description: "You have proficiency with tinker's tools. With 1 hour and 10 gp of materials you can build a Tiny clockwork device (toy, fire starter, or music box, up to three at once).", minLevel: null },
              ]
            ),
          ],
        },
      ],
    },
  };
}

function halflingBaseEntry(entry) {
  return {
    ...entry,
    bundle: {
      statModifiers: [],
      dropdownAccess: [],
      featureGrants: [],
      resourceGrants: [],
      choiceGroups: [
        {
          id: "halfling-subrace", label: "Halfling Subrace", subrace: true, minLevel: 1, minSelections: 1, maxSelections: 1,
          options: [
            halflingSubraceOption(
              "halfling-subrace-lightfoot-halfling", "Lightfoot Halfling",
              [{ targetFieldId: "chaScore", op: "add", value: 1, minLevel: null }],
              [
                { name: "Naturally Stealthy", description: "You can attempt to hide even when you are obscured only by a creature that is at least one size larger than you.", minLevel: null },
              ]
            ),
            halflingSubraceOption(
              "halfling-subrace-stout-halfling", "Stout Halfling",
              [{ targetFieldId: "conScore", op: "add", value: 1, minLevel: null }],
              [
                { name: "Stout Resilience", description: "You have advantage on saving throws against poison, and you have resistance against poison damage.", minLevel: null },
              ]
            ),
          ],
        },
      ],
    },
  };
}

// --- Subclass patches ---------------------------------------------------------------
function patchHunterConclave(bundle) {
  if ((bundle.choiceGroups || []).some((g) => /hunter-s-prey|hunters-prey/.test(g.id))) return bundle;
  bundle.choiceGroups.push({
    id: "hunter-conclave-prey", label: "Hunter's Prey", minLevel: 3, minSelections: 1, maxSelections: 1,
    options: [
      textOption("hunter-conclave-prey", "Colossus Slayer", "Once per turn, deal an extra 1d8 damage to a creature below its hit point maximum."),
      textOption("hunter-conclave-prey", "Giant Killer", "When a Large or larger creature within 5 feet attacks you, use your reaction to attack it back."),
      textOption("hunter-conclave-prey", "Horde Breaker", "Once per turn, attack a second creature within 5 feet of your first target when you attack."),
    ],
  });
  return bundle;
}

function patchChampion(bundle) {
  const levels = takeNotes(bundle, (g) => /Additional Fighting Style/i.test(g.name || ""));
  const hasGroup = (bundle.choiceGroups || []).some((g) => g.id === "champion-fighting-style");
  if (!levels.length && hasGroup) return bundle;
  if (!hasGroup) {
    bundle.choiceGroups.push(fightingStyleGroup("champion", levels.length ? Math.min(...levels.filter(Number.isFinite)) : 10, FS_LISTS.Fighter));
  }
  return bundle;
}

// --- Built tables ----------------------------------------------------------------------
function patchClassEntry(entry) {
  const patcher = CLASS_PATCHERS[entry.name];
  if (!patcher) return entry;
  const out = { ...entry, bundle: clone(entry.bundle) };
  out.bundle.choiceGroups = [...(out.bundle.choiceGroups || [])];
  out.bundle.featureGrants = [...(out.bundle.featureGrants || [])];
  patcher(out.bundle);
  return out;
}

export const FIXED_CLASS_ENTRIES = [
  ...DEFAULT_CONTENT.classEntries.map(patchClassEntry),
  // Artificer (TCE) — the compiled sources never covered this class,
  // so it lives here with the other hand-written gaps: saves, armor/
  // weapon/tool proficiencies, subclass access to its four specialists,
  // level-gated class features, infusion pickers, tracked resources,
  // and pick-2 skill + pick-1 artisan-tool groups.
  {
    name: "Artificer",
    subclassLevel: 3,
    caster: "half",
    bundle: {
      statModifiers: [
        { targetFieldId: "conSaveProf", op: "grant" },
        { targetFieldId: "intSaveProf", op: "grant" },
        { targetFieldId: "armorProf", op: "grantTag", value: "Light Armor" },
        { targetFieldId: "armorProf", op: "grantTag", value: "Medium Armor" },
        { targetFieldId: "armorProf", op: "grantTag", value: "Shields" },
        { targetFieldId: "weaponProf", op: "grantTag", value: "All Simple Weapons" },
        { targetFieldId: "toolProf", op: "grantTag", value: "Thieves' Tools" },
        { targetFieldId: "toolProf", op: "grantTag", value: "Tinker's Tools" },
      ],
      dropdownAccess: [{ targetFieldId: "subclass", allowedChoiceIds: ["subclass-artificer-alchemist", "subclass-artificer-armorer", "subclass-artificer-artillerist", "subclass-artificer-battle-smith"], minLevel: 3 }],
      featureGrants: [
        { name: "Hit Die", description: "d8", minLevel: 1 },
        { name: "Hit Points at 1st Level", description: "8 + your Constitution modifier", minLevel: 1 },
        { name: "Firearm Proficiency (optional)", description: "If your campaign uses firearms and your artificer has been exposed to them, you are proficient with them.", minLevel: 1 },
        { name: "Magical Tinkering", description: "Touch a Tiny nonmagical object to give it light, a recorded message, an odor/sound, or a static visual effect (Int mod objects max).", minLevel: 1 },
        { name: "Spellcasting", description: "Prepare Int mod + half artificer level spells (min 1); cast through thieves' tools or artisan's tools (infused items count as a focus after 2nd level). Ritual casting for prepared ritual spells.", minLevel: 1 },
        { name: "Infuse Item", description: "After a long rest, imbue mundane items with learned infusions (4 known, 2 infused at 2nd level, growing with level). Each infusion in one object; one infusion per object.", minLevel: 2 },
        { name: "Artificer Specialist", description: "Choose Alchemist, Armorer, Artillerist, or Battle Smith.", minLevel: 3 },
        { name: "The Right Tool for the Job", description: "With tools in hand, magically create one set of artisan's tools in 1 hour (vanishes when reused).", minLevel: 3 },
        { name: "Ability Score Improvement", description: "Increase one ability score by 2, two ability scores by 1 each, or take a feat instead.", minLevel: 4 },
        { name: "Artificer Specialist feature", description: "Your specialist subclass grants additional features at 5th level (and again at 9th and 15th).", minLevel: 5 },
        { name: "Ability Score Improvement", description: "Increase one ability score by 2, two ability scores by 1 each, or take a feat instead.", minLevel: 8 },
        { name: "Tool Expertise", description: "Doubled proficiency bonus on checks using a tool you're proficient with.", minLevel: 6 },
        { name: "Flash of Genius", description: "As a reaction, add your Int modifier to an ability check or save you or a creature within 30 ft makes (Int mod uses per long rest).", minLevel: 7 },
        { name: "Artificer Specialist feature", description: "Your specialist subclass grants additional features at 9th level (and again at 15th).", minLevel: 9 },
        { name: "Ability Score Improvement", description: "Increase one ability score by 2, two ability scores by 1 each, or take a feat instead.", minLevel: 12 },
        { name: "Magic Item Adept", description: "Attune to up to 4 magic items; craft common/uncommon items in 1/4 time for 1/2 gold.", minLevel: 10 },
        { name: "Spell-Storing Item", description: "After a long rest, store a 1st/2nd-level artificer spell (1 action) in a weapon or focus; usable 2 x Int mod times (min twice).", minLevel: 11 },
        { name: "Magic Item Savant", description: "Attune to up to 5 magic items; ignore class/race/spell/level requirements.", minLevel: 14 },
        { name: "Artificer Specialist feature", description: "Your specialist subclass grants its final features at 15th level.", minLevel: 15 },
        { name: "Ability Score Improvement", description: "Increase one ability score by 2, two ability scores by 1 each, or take a feat instead.", minLevel: 16 },
        { name: "Magic Item Master", description: "Attune to up to 6 magic items.", minLevel: 18 },
        { name: "Ability Score Improvement", description: "Increase one ability score by 2, two ability scores by 1 each, or take a feat instead.", minLevel: 19 },
        { name: "Soul of Artifice", description: "+1 to all saves per attuned item; use a reaction to end an infusion and drop to 1 HP instead of 0.", minLevel: 20 },
      ],
      resourceGrants: [
        { id: "artificer-flash-of-genius-7", name: "Flash of Genius", maximumFormula: { type: "expr", text: "max(1, {{intMod}})" }, minLevel: 7, reset: "long rest" },
        { id: "artificer-spell-storing-item-11", name: "Spell-Storing Item", maximumFormula: { type: "expr", text: "max(2, 2 * {{intMod}})" }, minLevel: 11, reset: "long rest" },
      ],
      choiceGroups: [
        {
          id: "class-skills", label: "Artificer Skill Proficiencies", minLevel: 1, minSelections: 2, maxSelections: 2,
          options: [
            { id: "class-skill-arcana", name: "Arcana", statModifiers: [{ targetFieldId: "arcanaProf", op: "grant" }] },
            { id: "class-skill-history", name: "History", statModifiers: [{ targetFieldId: "historyProf", op: "grant" }] },
            { id: "class-skill-investigation", name: "Investigation", statModifiers: [{ targetFieldId: "investigationProf", op: "grant" }] },
            { id: "class-skill-medicine", name: "Medicine", statModifiers: [{ targetFieldId: "medicineProf", op: "grant" }] },
            { id: "class-skill-nature", name: "Nature", statModifiers: [{ targetFieldId: "natureProf", op: "grant" }] },
            { id: "class-skill-perception", name: "Perception", statModifiers: [{ targetFieldId: "perceptionProf", op: "grant" }] },
            { id: "class-skill-sleight-of-hand", name: "Sleight of Hand", statModifiers: [{ targetFieldId: "sleightOfHandProf", op: "grant" }] },
          ],
        },
        {
          id: "artificer-toolProf-0", label: "Artificer Tool Proficiency: one artisan's tool of your choice", minLevel: 1, minSelections: 1, maxSelections: 1,
          options: ARTIFICER_ARTISAN_TOOLS.map((name) => ({
            id: `artificer-toolProf-0-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
            name,
            statModifiers: [{ targetFieldId: "toolProf", op: "grantTag", value: name }],
          })),
        },
        artificerInfusionGroup(0, 2, 4),
        artificerInfusionGroup(1, 6, 2),
        artificerInfusionGroup(2, 10, 2),
        artificerInfusionGroup(3, 14, 2),
        artificerInfusionGroup(4, 18, 2),
      ],
    },
  },
];

function patchRaceEntry(entry) {
  const out = { ...entry, bundle: clone(entry.bundle) };
  out.bundle.choiceGroups = [...(out.bundle.choiceGroups || [])];
  out.bundle.featureGrants = [...(out.bundle.featureGrants || [])];
  if (["Aarakocra", "Aasimar", "Yuan-ti"].includes(entry.name)) {
    patchFreeformAsi(out.bundle, entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  }
  return out;
}

export const FIXED_RACE_ENTRIES = [
  ...DEFAULT_CONTENT.raceEntries
    .map(patchRaceEntry)
    .filter((entry) => !SUPERSEDED_RACE_NAMES.has(entry.name))
    .map((entry) => {
      if (entry.name === "Dwarf") return dwarfBaseEntry(entry);
      if (entry.name === "Gnome") return gnomeBaseEntry(entry);
      if (entry.name === "Halfling") return halflingBaseEntry(entry);
      return entry;
    }),
  // Extra races arrive fully formed (subrace pickers attached in
  // extraRaces.js) — no patching needed.
  ...RACE_EXTRA_ENTRIES,
  // Base Genasi with its four elemental subraces.
  genasiBaseEntry(),
];

const SUBCLASS_PATCHERS = {
  "Hunter Conclave": patchHunterConclave,
  Champion: patchChampion,
};

export function patchedSubclassBundle(name, bundle) {
  const patcher = SUBCLASS_PATCHERS[name];
  if (!patcher || !bundle) return bundle;
  const out = { ...bundle, choiceGroups: [...(bundle.choiceGroups || [])], featureGrants: [...(bundle.featureGrants || [])] };
  patcher(out);
  return out;
}

export const normSubclassKey = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// PHB multiclassing grants no saving-throw proficiencies and only a
// limited slice of the new class's armor/weapon proficiencies.
// Rather than encoding the full per-class multiclass-proficiency
// table, secondary class bundles drop save grants and armor/weapon
// fixed tags; skill/tool choice groups stay pickable as usual, and
// the Equipment Proficiencies tab covers anything else by hand.
// Subclass bundles are never stripped (their features are the point).
// Returns a fresh object per call — never persisted, only computed.
export function stripSecondaryClassBundle(bundle) {
  if (!bundle) return null;
  return {
    ...bundle,
    statModifiers: (bundle.statModifiers || []).filter((m) =>
      !(m.op === "grant" && /SaveProf$/.test(m.targetFieldId || ""))
      && !(m.op === "grantTag" && (m.targetFieldId === "armorProf" || m.targetFieldId === "weaponProf"))),
  };
}

// Patched subclass bundles keyed by normalized subclass name — the
// single source blockModel (starter choices) and bundleMaps
// (save/load canonicals) both read from.
export const SUBCLASS_BUNDLE_MAP = new Map(
  SUBCLASS_SUPPLEMENT.map((s) => [s.key, patchedSubclassBundle(s.name, s.bundle)])
);

// Alias for the historical "Shephard" misspelling: older saves (and
// older user libraries) may still reference it, and they should keep
// resolving to the same bundle.
{
  const shepherd = SUBCLASS_BUNDLE_MAP.get("circleoftheshepherd");
  if (shepherd && !SUBCLASS_BUNDLE_MAP.has("circleoftheshephard")) {
    SUBCLASS_BUNDLE_MAP.set("circleoftheshephard", shepherd);
  }
}

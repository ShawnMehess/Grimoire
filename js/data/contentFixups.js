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

function patchElf(bundle) {
  if ((bundle.choiceGroups || []).some((g) => g.id === "elf-subrace")) return bundle;
  bundle.choiceGroups.push({
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
  });
  return bundle;
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

export const FIXED_CLASS_ENTRIES = DEFAULT_CONTENT.classEntries.map(patchClassEntry);

function patchRaceEntry(entry) {
  const out = { ...entry, bundle: clone(entry.bundle) };
  out.bundle.choiceGroups = [...(out.bundle.choiceGroups || [])];
  out.bundle.featureGrants = [...(out.bundle.featureGrants || [])];
  if (["Aarakocra", "Aasimar", "Air Genasi", "Yuan-ti"].includes(entry.name)) {
    patchFreeformAsi(out.bundle, entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  }
  return out;
}

export const FIXED_RACE_ENTRIES = [
  ...DEFAULT_CONTENT.raceEntries.map(patchRaceEntry),
  ...RACE_EXTRA_ENTRIES.map((entry) => {
    // Extra races are already hand-written; only Elf needs its subraces.
    if (entry.name !== "Elf") return entry;
    const out = { ...entry, bundle: clone(entry.bundle) };
    out.bundle.choiceGroups = [...(out.bundle.choiceGroups || [])];
    patchElf(out.bundle);
    return out;
  }),
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

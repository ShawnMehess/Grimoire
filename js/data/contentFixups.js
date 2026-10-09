// contentFixups.js â€” hand-written pickers for choices the source data
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
// (save/load strip+hydrate) both consume these â€” never the raw
// imports â€” so canonical-comparison stays exact. dnd5e.js keeps using
// the raw entries (it only reads names/slots/subclass lists).
//
// What stays a note on purpose (a free spell of choice with no
// bounded picker â€” record it in Spells Known via the spell browser):
// - Warlock Mystic Arcanum. (Bard Magical Secrets used to be here too;
//   it now has a real picker â€” see MAGICAL_SECRETS_UNLOCKS.)

import { DEFAULT_CONTENT } from "./defaultContent.js";
import { SUBCLASS_SUPPLEMENT } from "./subclassContent.js";
import { RACE_EXTRA_ENTRIES } from "./extraRaces.js";
import { SKILLS, ABILITIES, LANGUAGES } from "./schema.js";
import {
  CLASS_L1_REPLACEMENTS,
  BG_FEATURE_REPLACEMENTS,
  FIGHTER_STYLE_GROUP_TEXT,
  RANGER_FAVORED_ENEMIES,
  RANGER_FAVORED_TERRAINS,
  RANGER_VARIANT_OPTION,
} from "./phase1Replacements.js";
import { withCatalogLink } from "./catalogLinks.js";
import { withChoiceGroupCategories } from "./choiceCategories.js";
import { fixPluralDeep } from "./pluralText.js";
import { ALL_SUBCLASS_PICKS as SUBCLASS_PICKS } from "./subclassPicks.js";
import { SUBCLASS_FEATURE_TEXT } from "./subclassFeatureText.js";
import { CLASS_PICKS, CLASS_PICK_TEXT, isUnpickableNote } from "./classPicks.js";
import { languagePick, toolPick, DWARF_BASE_TOOLS, ARTISAN_TOOLS } from "./missingPicks.js";
import { MAGICAL_SECRETS_UNLOCKS } from "./magicalSecrets.js";

const clone = (obj) => JSON.parse(JSON.stringify(obj));

/** The two fixups every baked-in bundle needs before it's handed to the
 *  sheet: an explicit link to its flavor/portrait catalog entry, and
 *  explicit categories on its choice groups (so the wizard doesn't have to
 *  guess either one at render time). One helper so all four entry lists
 *  below stay in step â€” see js/data/catalogLinks.js and
 *  js/data/choiceCategories.js. */
const finalizeBundle = (bundle, kind, name) =>
  fixPluralDeep(patchWoodElfSpeed(patchWording(withChoiceGroupCategories(withCatalogLink(bundle, kind, name)))));

/** Race wording corrections, applied by name rather than by rewriting
 *  compiled data (which must stay regenerable).
 *
 *  Each entry is a text replacement scoped to one feature, so a wording
 *  fix can't quietly rewrite the same phrase somewhere it was correct. */
const WORDING_FIXES = {
  // "Max HP increases by 1 per level" is right but reads like a stat line
  // rather than a rule; the player asked for the extra-per-level phrasing.
  "Dwarven Toughness": { from: "Max HP increases by 1 per level.", to: "Max HP increases by 1 at 1st level, and by an extra 1 per level after 1st." },
  // Wood Elf's +5 is applied as a stat modifier on top of the base Elf's
  // 30 ft, so the total really is 35 - the grant text was just stale.
  // Deliberately NOT a WORDING_FIXES entry: the grant is named "Speed"
  // for every elf subrace, so a name-keyed rule would also bump High Elf
  // and Drow to 35. patchWoodElfSpeed targets just the Wood Elf option.
};

/** Apply WORDING_FIXES across a bundle's feature grants.
 *
 *  Walks the WHOLE bundle, not just its top-level grants: subrace and
 *  trait grants live inside `choiceGroups[].options[].featureGrants`
 *  (Hill Dwarf's Dwarven Toughness), so a top-level-only pass silently
 *  skips every one of them. */
function patchWording(bundle) {
  if (!bundle || typeof bundle !== "object") return bundle;
  if (Array.isArray(bundle)) return bundle.map(patchWording);
  if (bundle.name && bundle.description) {
    const fix = WORDING_FIXES[bundle.name];
    if (fix) {
      const text = String(bundle.description);
      if (text.includes(fix.from)) return { ...bundle, description: text.replace(fix.from, fix.to) };
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(bundle)) {
    out[k] = (v && typeof v === "object") ? patchWording(v) : v;
  }
  return out;
}

/** Wood Elf's walking speed really is 35 - the +5 is a stat modifier on
 *  top of the base Elf's 30 - but the printed grant still read 30 ft.
 *
 *  Scoped to the subrace option by id rather than by the grant's name:
 *  every subrace has a grant called "Speed", so a name-matched fix would
 *  have quietly rewritten High Elf's 30 ft to 35 as well. */
function patchWoodElfSpeed(bundle) {
  const groups = (bundle?.choiceGroups || []).map((group) => {
    if (group.id !== "elf-subrace" || !Array.isArray(group.options)) return group;
    return {
      ...group,
      options: group.options.map((option) => {
        if (option.id !== "elf-subrace-wood") return option;
        return {
          ...option,
          featureGrants: (option.featureGrants || []).map((grant) => (
            grant.name === "Speed" && String(grant.description || "").includes("30 ft")
              ? { ...grant, description: "35 ft. walking" }
              : grant
          )),
        };
      }),
    };
  });
  return { ...bundle, choiceGroups: groups };
}

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
    id: `${prefix}-expertise-${s.id}`, name: s.label,
    // The dialog lists a bare skill name otherwise, and the point of the
    // pick is what it does to that skill - the sheet's own vocabulary
    // carries the flavour text, so this says the effect in one line of our
    // own instead of repeating it.
    description: `Add your proficiency bonus to every ${s.label} check a second time.`,
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
    // One style per character, whichever class or subclass asked: the
    // Fighter's own list and a Champion's extra pick are the same decision,
    // and a multiclassed Fighter/Paladin may not take Defense twice.
    pickFamily: "fighting-style",
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

/** The requirements an invocation's own text states, read once so the
 *  option can be REFUSED rather than merely described.
 *
 *  Two kinds appear in the text above: a Pact Boon ("Prerequisite: Pact
 *  of the Tome") and a character level ("Prerequisite: 9th level"). Both
 *  used to be words in a tooltip, so a warlock could take Far Scribe at
 *  2nd level with no Tome and no 5th level, and the sheet would not have
 *  known to object. `requires` is what the pickers read to grey an option
 *  out; the sentence stays in the description, because a player still
 *  wants to know WHY.
 *
 *  Parsed from the text rather than hand-listed beside it, so a
 *  prerequisite can never be stated in one place and forgotten in the
 *  other. Returns `[]` when the text states none. */
function invocationRequirements(description) {
  const tail = String(description || "").split("Prerequisite:").slice(1).join(", ");
  if (!tail) return [];
  const out = [];
  for (const raw of tail.split(",")) {
    const pact = /Pact of the (Tome|Chain|Talisman|Blade)\b/i.exec(raw);
    if (pact) {
      out.push({ kind: "pact", value: `Pact of the ${pact[1]}` });
      continue;
    }
    const level = /(\d+)\s*(?:st|nd|rd|th)\s+level/i.exec(raw);
    if (level) out.push({ kind: "level", value: Number(level[1]) });
  }
  return out;
}

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
// One independent +1 slot group per increasable score (three slots =
// any 3-point split, duplicates stacking) â€” the old 15-pair +
// 20-triple combo picker couldn't express duplicate picks, and the
// compute path collapses duplicate ids within a single group, so
// combos had to go. The wizard renders one ability dropdown per slot.
function asiSlotOptions(prefix, slot, abilityIds) {
  // Abbreviated labels everywhere ("STR", never "Strength") â€” tooltips
  // on the rendered dropdowns carry the full names.
  return abilityIds.map((aid) => ({
    id: `${prefix}-asi-${slot}-${aid}`, name: aid.toUpperCase(), description: "",
    statModifiers: [{ targetFieldId: `${aid}Score`, op: "add", value: 1, minLevel: null }],
    featureGrants: [], resourceGrants: [],
  }));
}
function asiSlotGroups(prefix, minLevel, count, abilityIds = ABILITIES.map((a) => a.id)) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-asi-${i + 1}`, label: "Ability Score Increase (+1)", minLevel,
    minSelections: 1, maxSelections: 1,
    options: asiSlotOptions(prefix, i + 1, abilityIds),
  }));
}
// Retired combo groups ({prefix}-asi with 35 pair/triple options,
// half-elf-abilities with 10 pair options) map onto the slot groups
// above for characters that picked under the old shape â€” see
// migrateAsiComboPicks in sheetWizard.js. optionPrefix is the combo
// option id stem; the trailing ability segments parse back into slot
// picks (a 2-segment pair doubles its first ability: +2/+1).
export const LEGACY_ASI_COMBOS = [
  { oldGroupId: "aarakocra-asi", optionPrefix: "aarakocra-asi-", slotGroupIds: ["aarakocra-asi-1", "aarakocra-asi-2", "aarakocra-asi-3"] },
  { oldGroupId: "aasimar-asi", optionPrefix: "aasimar-asi-", slotGroupIds: ["aasimar-asi-1", "aasimar-asi-2", "aasimar-asi-3"] },
  { oldGroupId: "yuan-ti-asi", optionPrefix: "yuan-ti-asi-", slotGroupIds: ["yuan-ti-asi-1", "yuan-ti-asi-2", "yuan-ti-asi-3"] },
  { oldGroupId: "genasi-asi", optionPrefix: "genasi-asi-", slotGroupIds: ["genasi-asi-1", "genasi-asi-2", "genasi-asi-3"] },
  { oldGroupId: "half-elf-abilities", optionPrefix: "half-elf-ability-", slotGroupIds: ["half-elf-asi-1", "half-elf-asi-2"] },
];

// --- Class patches ---------------------------------------------------------------
function patchFighter(bundle) {
  const levels = takeNotes(bundle, (g) => /Fighting Style/.test(g.name || ""));
  if (levels.length) {
    const group = fightingStyleGroup("fighter", Math.min(...levels.filter(Number.isFinite)), FS_LISTS.Fighter);
    group.category = "features";
    bundle.choiceGroups.push(group);
  }
  return bundle;
}

function patchPaladin(bundle) {
  const levels = takeNotes(bundle, (g) => /Fighting Style/.test(g.name || ""));
  if (levels.length) {
    const group = fightingStyleGroup("paladin", Math.min(...levels.filter(Number.isFinite)), FS_LISTS.Paladin);
    group.category = "features";
    bundle.choiceGroups.push(group);
  }
  return bundle;
}

function patchRanger(bundle) {
  const levels = takeNotes(bundle, (g) => /Fighting Style/.test(g.name || ""));
  if (levels.length) {
    const group = fightingStyleGroup("ranger", Math.min(...levels.filter(Number.isFinite)), FS_LISTS.Ranger);
    group.category = "features";
    bundle.choiceGroups.push(group);
  }
  return bundle;
}

function patchRogue(bundle) {
  const levels = takeNotes(bundle, (g) => /^Expertise/.test(g.name || ""));
  const thieves = {
    id: "rogue-expertise-thieves-tools", name: "Thieves' Tools", description: "",
    statModifiers: [],
    featureGrants: [{ name: "Expertise: Thieves' Tools", description: "Double your proficiency bonus with Thieves' Tools. Tracked here â€” apply manually.", minLevel: null }],
    resourceGrants: [],
  };
  levels.forEach((minLevel, i) => {
    const group = {
      id: `rogue-expertise-${i}`, label: "Expertise â€” pick 2 of your proficiencies", minLevel,
      minSelections: 2, maxSelections: 2,
      category: "skills",
      options: [...skillExpertiseOptions("rogue"), thieves],
    };
    bundle.choiceGroups.push(group);
  });
  return bundle;
}

function patchBard(bundle) {
  // Magical Secrets: at each unlock, steal spells from ANY class list.
  //
  // This lived on the creation wizard's Spells tab and existed nowhere
  // else, so it was the one thing that tab held which the spell catalog
  // cannot reproduce: the catalog has no notion of "2 extra spells from
  // any list", so removing that tab would silently delete the feature.
  // It is a picker on the Bard's own class entry instead.
  //
  // One group per unlock, gated by minLevel, because the count is per
  // unlock and not a running total - a Bard picks 2 at 10th, 2 more at
  // 14th, 2 more at 18th. `subclasses` marks the College of Lore's
  // earlier unlock, which is the one unlock that is subclass-specific.
  //
  // The spell level cap is half the Bard level, rounded down, which is
  // the rule for how high a Secret may be: 3 at 6th, 5 at 10th, 7 at
  // 14th, 9 at 18th. `level: 0` with `maxLevel` is how the dialog is told
  // "cantrips through this level", rather than one exact level.
  for (const unlock of MAGICAL_SECRETS_UNLOCKS) {
    const id = `bard-magical-secrets-${unlock.minLevel}${unlock.subclasses ? `-${unlock.subclasses[0]}` : ""}`;
    if ((bundle.choiceGroups || []).some((g) => g.id === id)) continue;
    bundle.choiceGroups.push({
      id,
      label: unlock.subclasses
        ? `Magical Secrets (${unlock.count} spells from any class list, College of Lore)`
        : `Magical Secrets (${unlock.count} spells from any class list)`,
      minLevel: unlock.minLevel,
      minSelections: unlock.count,
      maxSelections: unlock.count,
      choiceKind: "build",
      category: "spells",
      // Only the Lore College's early unlock. An empty list means "every
      // subclass", which is the case for the rest.
      subclasses: unlock.subclasses || null,
      spellPick: { list: null, level: 0, maxLevel: Math.floor(unlock.minLevel / 2) },
      // Deliberately NO options: the pick's options are the spell catalog,
      // filtered by level at open time. A group with neither options nor a
      // spellPick would be treated as empty and skipped.
      spellPickOnly: true,
    });
  }

  const levels = takeNotes(bundle, (g) => /^Expertise/.test(g.name || ""));
  levels.forEach((minLevel, i) => {
    const group = {
      id: `bard-expertise-${i}`, label: "Expertise â€” pick 2 of your proficiencies", minLevel,
      minSelections: 2, maxSelections: 2,
      category: "skills",
      options: skillExpertiseOptions("bard"),
    };
    bundle.choiceGroups.push(group);
  });
  // Magical Secrets stubs are removed (not replaced with a choice
  // group â€” hundreds of spell options would bloat every save). The
  // picker lives in the wizard instead: MAGICAL_SECRETS_UNLOCKS in
  // sheetWizard.js plus the Magical Secrets section on the Bard's
  // spell steps, writing straight to Spells Known.
  takeNotes(bundle, (g) => /Magical Secrets/.test(g.name || ""));
  return bundle;
}

function patchSorcerer(bundle) {
  const levels = takeNotes(bundle, (g) => /^Metamagic/.test(g.name || ""));
  const counts = [2, 1, 1]; // L3 two, L10 +1, L17 +1
  levels.forEach((minLevel, i) => {
    const group = {
      id: `sorcerer-metamagic-${i}`, label: `Metamagic â€” pick ${counts[i] ?? 1}`, minLevel,
      minSelections: counts[i] ?? 1, maxSelections: counts[i] ?? 1,
      category: "features",
      // Three unlocks, one set of options: the rules allow each option once,
      // so what 3rd-level Metamagic takes is locked at 10th and again at
      // 17th rather than offered a second time.
      pickFamily: "sorcerer-metamagic",
      options: Object.entries(METAMAGIC).map(([n, d]) => textOption(`sorcerer-metamagic-${i}`, n, `${d} (Costs sorcery points â€” tracked, not auto-spent.)`)),
    };
    bundle.choiceGroups.push(group);
  });
  return bundle;
}

function patchWarlock(bundle) {
  const invoLevels = takeNotes(bundle, (g) => /^Eldritch Invocations/.test(g.name || ""));
  const base = invoLevels.length ? Math.min(...invoLevels.filter(Number.isFinite)) : 2;
  // Known counts by level: 2, then +1 at 5/7/9/12/15/18.
  const tiers = [{ minLevel: base, count: 2 }, { minLevel: 5, count: 1 }, { minLevel: 7, count: 1 }, { minLevel: 9, count: 1 }, { minLevel: 12, count: 1 }, { minLevel: 15, count: 1 }, { minLevel: 18, count: 1 }];
  tiers.forEach((tier, i) => {
    const group = {
      id: `warlock-invocations-${i}`, label: `Eldritch Invocations â€” pick ${tier.count} (level ${tier.minLevel}+)`, minLevel: tier.minLevel,
      minSelections: tier.count, maxSelections: tier.count,
      category: "features",
      // One invocation each, however many times the tiers are taken: the
      // list at 5th is the list at 2nd minus what the 2nd already holds.
      pickFamily: "warlock-invocations",
      options: INVOCATIONS.map(([n, d]) => {
        const option = textOption(`warlock-invocations-${i}`, n, `${d} (Recorded here — the effect is tracked, not auto-applied.)`);
        const requires = invocationRequirements(d);
        if (requires.length) option.requires = requires;
        return option;
      }),
    };
    bundle.choiceGroups.push(group);
  });
  const pactLevels = takeNotes(bundle, (g) => /^Pact Boon/.test(g.name || ""));
  if (pactLevels.length) {
    const group = {
      id: "warlock-pact-boon", label: "Pact Boon", minLevel: Math.min(...pactLevels.filter(Number.isFinite)),
      minSelections: 1, maxSelections: 1,
      category: "features",
      options: Object.entries(PACT_BOONS).map(([n, d]) => textOption("warlock-pact-boon", n, d)),
    };
    bundle.choiceGroups.push(group);
  }
  // Mystic Arcanum: one spell of 6th/7th/8th/9th level at 11th/13th/15th/17th.
  // These are spell picks from ANY class list, limited to a specific level.
  // The original feature grants are kept as notes (they describe the feature).
  const arcanumTiers = [
    { minLevel: 11, spellLevel: 6, label: "Mystic Arcanum (6th level)" },
    { minLevel: 13, spellLevel: 7, label: "Mystic Arcanum (7th level)" },
    { minLevel: 15, spellLevel: 8, label: "Mystic Arcanum (8th level)" },
    { minLevel: 17, spellLevel: 9, label: "Mystic Arcanum (9th level)" },
  ];
  arcanumTiers.forEach((tier) => {
    const group = {
      id: `warlock-mystic-arcanum-${tier.spellLevel}`,
      label: `${tier.label} — pick 1 spell of level ${tier.spellLevel}`,
      minLevel: tier.minLevel,
      minSelections: 1, maxSelections: 1,
      category: "spells",
      // Spell pick from any class list, limited to the specific spell level
      spellPick: { list: "warlock", level: tier.spellLevel },
      choiceKind: "build",
    };
    bundle.choiceGroups.push(group);
  });
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

// --- Phase 1 content audit (docs/CONTENT-AUDIT-2026-09.md) ----------------------
// Compiled defaultContent.js is generated and its original inputs are
// not in this repo, so audit fixes land in this patch layer â€” the same
// layer blockModel.js (starter dropdowns) and bundleMaps.js (save/load
// canonicals) already treat as canonical. Every replacement string
// comes from js/data/phase1Replacements.js (verbatim audit-table
// text); per-row sources live in docs/phase1-sources.md, unsourced
// items in docs/phase1-gaps.md.

// Explicit choice-group categories (audit systemic fix 5). Set by
// exact group id â€” never inferred from label text. Groups created by
// patchers above carry their category at birth; this fills in the
// compiled groups. The 26 audit-listed ids are all here, plus the
// Artificer's own skill/tool groups for consistency.
const PHASE1_GROUP_CATEGORIES = {
  "class-skills": "skills",
  "monk-toolProf-0": "tools",
  "bard-toolProf-0": "tools",
  "artificer-toolProf-0": "tools",
  "acolyte-languages-0": "languages",
  "entertainer-toolProf-1": "tools",
  "folk-hero-toolProf-0": "tools",
  "guild-artisan-toolProf-0": "tools",
  "guild-artisan-languages-0": "languages",
  "noble-toolProf-0": "tools",
  "noble-languages-0": "languages",
  "outlander-toolProf-0": "tools",
  "outlander-languages-0": "languages",
  "sage-languages-0": "languages",
  "urban-bounty-hunter-skills": "skills",
  "urban-bounty-hunter-toolProf-0": "tools",
};

function applyPhase1Categories(bundle) {
  for (const g of (bundle.choiceGroups || [])) {
    if (!g.category && PHASE1_GROUP_CATEGORIES[g.id]) g.category = PHASE1_GROUP_CATEGORIES[g.id];
  }
  return bundle;
}

/** The compiled sources spell ability scores as abbreviations - "8 +
 *  CON_mod" on every class's Hit Points at 1st Level. Two of them are
 *  hand-written in this file and already read "your Constitution
 *  modifier", so the same fact reaches the player in two different
 *  registers depending on their class, which is worse than either.
 *
 *  Applied as a fixup rather than an edit to defaultContent.js because that
 *  file is auto-generated: see its own header and RESCUE-NOTES.md. Editing it
 *  would be undone by the next regeneration, silently.
 *
 *  Runs before the per-class replacement text, so a replacement that already
 *  spells the name out is left alone - the guard is "does this mention the
 *  abbreviation at all", not "does this mention Constitution". */
// Each abbreviation to its own ability name - mapping them all to
// "your Constitution modifier" would be wrong for the four that are not CON.
const ABILITY_ABBREVIATIONS = {
  CON_mod: "your Constitution modifier",
  STR_mod: "your Strength modifier",
  DEX_mod: "your Dexterity modifier",
  INT_mod: "your Intelligence modifier",
  WIS_mod: "your Wisdom modifier",
  CHA_mod: "your Charisma modifier",
};
const ABILITY_ABBREVIATION_TEXT = /\b(?:CON|STR|DEX|INT|WIS|CHA)_mod\b/g;

function humanizeAbilityAbbreviations(bundle) {
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "description" || key === "reference") {
        if (typeof item === "string" && ABILITY_ABBREVIATION_TEXT.test(item)) {
          value[key] = item.replace(ABILITY_ABBREVIATION_TEXT, (m) => ABILITY_ABBREVIATIONS[m]);
        }
        // A global regex keeps lastIndex between calls; reset so the next
        // string is not skipped.
        ABILITY_ABBREVIATION_TEXT.lastIndex = 0;
      } else {
        walk(item);
      }
    }
  };
  walk(bundle);
  return bundle;
}

// Per-entry application report, consumed by scripts/verify-content.mjs:
// every table row must land as replaced/added, never silently missing.
export const PHASE1_CLASS_REPORT = {};
export const PHASE1_BG_REPORT = {};

// Replace one feature grant's description with verbatim audit text,
// keeping the prior long text on `reference` so nothing is lost.
function replaceGrant(bundle, grantName, text, report) {
  const grant = (bundle.featureGrants || []).find((g) => (g.name || "") === grantName);
  if (!grant) {
    report.missing.push(grantName);
    return;
  }
  if (grant.description !== text) grant.reference = grant.description;
  grant.description = text;
  report.replaced.push(grantName);
}

function applyClassReplacements(name, bundle) {
  const report = (PHASE1_CLASS_REPORT[name] = { replaced: [], added: [], missing: [], dropped: [] });
  for (const { grant, text } of (CLASS_L1_REPLACEMENTS[name] || [])) {
    // Rogue's Expertise and the Druid's armor note need structural
    // handling (no compiled grant to replace); everything else is a
    // straight description swap.
    if (name === "Rogue" && grant === "Expertise") {
      if (!(bundle.featureGrants || []).some((g) => g.name === "Expertise")) {
        bundle.featureGrants.push({ id: "rogue-expertise-feature", name: "Expertise", description: text, minLevel: 1 });
        report.added.push(grant);
      } else {
        replaceGrant(bundle, grant, text, report);
      }
      continue;
    }
    if (name === "Druid" && grant === "Armor Restriction") {
      const note = (bundle.featureGrants || []).find((g) => g.name === "Armor Proficiencies (note)");
      if (note) {
        note.reference = note.description;
        note.name = "Armor Restriction";
        note.description = text;
        note.caveat = "Shields allowed (non-metal only)";
        report.replaced.push("Armor Proficiencies (note) -> Armor Restriction");
      } else {
        report.missing.push("Armor Proficiencies (note)");
      }
      continue;
    }
    replaceGrant(bundle, grant, text, report);
  }
  return report;
}

function applyBgReplacements(name, bundle) {
  const report = (PHASE1_BG_REPORT[name] = { replaced: [], added: [], missing: [], dropped: [] });
  for (const { grant, text } of (BG_FEATURE_REPLACEMENTS[name] || [])) {
    replaceGrant(bundle, grant, text, report);
  }
  return report;
}

// Grants that must never render at level 1 (audit systemic fixes 3-4):
// TCE "Additional <Class> Spells" lists (spells from levels 1-9, not
// grants), the Fighter's optional fighting-style grants (styles live
// in the pickable choice group instead), and the Ranger's optional
// pair (rebuilt below as one explicit pack-gated variant choice).
const ADDITIONAL_SPELLS_RE = /^Additional .* Spells \(Optional\)$/;
const PHASE1_CLASS_DROPS = {
  Bard: [ADDITIONAL_SPELLS_RE],
  Cleric: [ADDITIONAL_SPELLS_RE],
  Druid: [ADDITIONAL_SPELLS_RE],
  Paladin: [ADDITIONAL_SPELLS_RE],
  Ranger: [ADDITIONAL_SPELLS_RE, "Deft Explorer (Optional)", "Favored Foe (Optional)"],
  Warlock: [ADDITIONAL_SPELLS_RE],
  Wizard: [ADDITIONAL_SPELLS_RE],
  Sorcerer: [ADDITIONAL_SPELLS_RE],
  Fighter: [/ \(Optional\)$/],
};

function applyPhase1Drops(name, bundle) {
  const report = PHASE1_CLASS_REPORT[name] || (PHASE1_CLASS_REPORT[name] = { replaced: [], added: [], missing: [], dropped: [] });
  for (const pattern of (PHASE1_CLASS_DROPS[name] || [])) {
    const test = typeof pattern === "string" ? (n) => n === pattern : (n) => pattern.test(n);
    bundle.featureGrants = (bundle.featureGrants || []).filter((g) => {
      if (test(g.name || "")) {
        report.dropped.push(g.name);
        return false;
      }
      return true;
    });
  }
  return report;
}

// Every other "(Optional)" class grant is a Tasha's optional rule
// (Primal Knowledge, Steady Aim, Harness Divine Power, ...): not a
// default grant, but genuine content for characters with the Tasha's
// pack â€” so mark, don't drop. Display/compute layers filter
// `requiresPack` grants against the included books.
function markTashaOptionals(bundle) {
  for (const g of (bundle.featureGrants || [])) {
    if (/\(Optional\)$/.test(g.name || "") && !g.requiresPack) g.requiresPack = "tashas";
  }
  return bundle;
}

// Tasha's fighting styles: same single pick-1 group, but the optional
// styles only surface when the Tasha's pack is included (producers
// filter `requiresPack` options; see filterGroupByPack). Counts are
// unchanged, so the group still offers the full list under Tasha's.
const TASHA_FIGHTING_STYLES = new Set([
  "Blind Fighting", "Interception", "Superior Technique",
  "Thrown Weapon Fighting", "Unarmed Fighting",
  "Blessed Warrior", "Druidic Warrior",
]);

function markTashaStyles(bundle) {
  for (const g of (bundle.choiceGroups || [])) {
    if (!/fighting-style/.test(g.id || "")) continue;
    for (const o of (g.options || [])) {
      if (TASHA_FIGHTING_STYLES.has(o.name)) o.requiresPack = "tashas";
    }
  }
  return bundle;
}

const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "option";

function rangerPhase1Groups() {
  const enemyOptions = RANGER_FAVORED_ENEMIES.map((name) => ({
    id: `ranger-favored-enemy-${slug(name)}`,
    name,
    description: "",
    statModifiers: [],
    featureGrants: [{ name: `Favored Enemy: ${name}`, description: "", minLevel: 1 }],
    resourceGrants: [],
  }));
  const terrainOptions = RANGER_FAVORED_TERRAINS.map((name) => ({
    id: `ranger-favored-terrain-${slug(name)}`,
    name,
    description: "",
    statModifiers: [],
    featureGrants: [{ name: `Favored Terrain: ${name}`, description: "", minLevel: 1 }],
    resourceGrants: [],
  }));
  return [
    {
      id: "ranger-favored-enemy", label: "Favored Enemy", minLevel: 1,
      minSelections: 1, maxSelections: 1, category: "features",
      options: enemyOptions,
    },
    {
      id: "ranger-favored-terrain", label: "Favored Terrain", minLevel: 1,
      minSelections: 1, maxSelections: 1, category: "features",
      options: terrainOptions,
    },
    // The mutually exclusive alternative to the standard pair: one
    // explicit opt-in, visible only with the Tasha's pack, picked only
    // by choosing it. The option carries a pointer, not rules text â€”
    // no sourced mechanics exist in this repo (see phase1-gaps.md).
    {
      id: "ranger-class-variant", label: "Class Feature Variant (Tasha's Cauldron)",
      description: "You use Favored Enemy + Natural Explorer above unless you take this optional pair instead (replaces both).",
      minLevel: 1, minSelections: 0, maxSelections: 1,
      category: "features", requiresPack: "tashas",
      options: [{
        id: RANGER_VARIANT_OPTION.id,
        name: RANGER_VARIANT_OPTION.name,
        description: RANGER_VARIANT_OPTION.description,
        statModifiers: [],
        featureGrants: [{ name: "Favored Foe + Deft Explorer (Tasha's)", description: RANGER_VARIANT_OPTION.description, minLevel: 1 }],
        resourceGrants: [],
      }],
    },
  ];
}

function acolytePhase1Groups(bundle) {
  if ((bundle.choiceGroups || []).some((g) => g.id === "acolyte-prayer-focus")) return bundle;
  // Prayer book or prayer wheel: one pick, driving both the review
  // line and the starting-equipment resolution (see
  // BG_EQUIPMENT_LINKS in startingEquipment.js) â€” never two prompts.
  bundle.choiceGroups.push({
    id: "acolyte-prayer-focus", label: "Prayer Focus", minLevel: 1,
    minSelections: 1, maxSelections: 1, category: "equipment",
    options: ["Prayer book", "Prayer wheel"].map((name) => ({
      id: `acolyte-prayer-focus-${slug(name)}`,
      name,
      description: "",
      statModifiers: [],
      featureGrants: [],
      resourceGrants: [],
    })),
  });
  return bundle;
}

function phase1ClassPatch(name, bundle) {
  applyPhase1Categories(bundle);
  humanizeAbilityAbbreviations(bundle);
  applyClassReplacements(name, bundle);
  applyPhase1Drops(name, bundle);
  markTashaOptionals(bundle);
  markTashaStyles(bundle);
  if (name === "Fighter") {
    const group = (bundle.choiceGroups || []).find((g) => g.id === "fighter-fighting-style");
    if (group) group.description = FIGHTER_STYLE_GROUP_TEXT;
  }
  if (name === "Ranger") {
    for (const group of rangerPhase1Groups()) {
      if (!(bundle.choiceGroups || []).some((g) => g.id === group.id)) bundle.choiceGroups.push(group);
    }
  }
  return bundle;
}

function phase1BackgroundPatch(name, bundle) {
  applyPhase1Categories(bundle);
  applyBgReplacements(name, bundle);
  if (name === "Acolyte") acolytePhase1Groups(bundle);
  return bundle;
}

// --- Artificer infusions (TCE, 16 total) --------------------------------------
// Summaries below are short paraphrases of what each infusion does (item
// type, attunement, level prerequisite), matching the tone of the other
// hand-written pickers here â€” not the book's full prose. Level-gated
// infusions stay selectable with a "Requires Nth level" note, the same
// way warlock invocation prerequisites are handled above.
const ARTIFICER_INFUSIONS = [
  ["Enhanced Arcane Focus", "A rod, staff, or wand (requires attunement). +1 to spell attacks; ignore half cover. Improves to +2 at 10th level."],
  ["Enhanced Defense", "A suit of armor or a shield. +1 to AC while wearing/wielding it. Improves to +2 at 10th level."],
  ["Enhanced Weapon", "A simple or martial weapon. +1 to attack and damage rolls. Improves to +2 at 10th level."],
  ["Homunculus Servant", "A gem or crystal worth 100+ gp. Creates a flying scout companion that can channel your touch-range spells."],
  ["Mind Sharpener", "A suit of armor or robes (requires attunement). 4 charges; use a reaction to turn a failed concentration save into a success."],
  ["Returning Weapon", "A simple or martial weapon with the thrown property. +1 to attack and damage; returns to your hand after the attack."],
  ["Replicate Magic Item", "Learn this multiple times (each pick is a different item). Replicate a common magic item from the leveled tables â€” record which item on the pick."],
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
    id: `artificer-infusions-${index}`, label: `Infusions Known â€” pick ${count} (level ${minLevel}+)`, minLevel,
    minSelections: count, maxSelections: count,
    category: "features",
    options: ARTIFICER_INFUSIONS.map(([n, d]) => textOption(`artificer-infusions-${index}`, n, `${d} (Recorded here â€” each infusion lives in one object at a time; see Infuse Item.)`)),
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

// The six abilities a +1 slot offers, in sheet order.
const ASI_SLOT_ABILITIES = [
  ["str", "Strength"],
  ["dex", "Dexterity"],
  ["con", "Constitution"],
  ["int", "Intelligence"],
  ["wis", "Wisdom"],
  ["cha", "Charisma"],
];

/**
 * Three +1 ability slots, the shape a "+2 to one ability and +1 to another,
 * OR +1 to three" racial increase actually is.
 *
 * Three identical single-pick groups, not a pattern picker with a second
 * step behind it. Each slot is its own group, so the stat engine folds two
 * "+1 STR" picks from two groups into one +2 (applyStatModifiers adds, it
 * does not overwrite), and A,A,B and A,B,C are the same three questions - no
 * separate +2 control to understand, and no step where the player has to
 * commit to a shape before being told which abilities are free.
 *
 * `asiFamily` is what ties the three together for the two things a slot
 * cannot know alone: the cap (an ability may be taken at most twice across
 * the family, so the third pick cannot be the same one again) and the one
 * label the row is drawn under. Sibling groups are found by family rather
 * than by id shape, so the groups stay independent data.
 */
function asiSlotChoiceGroups(prefix, minLevel, count = 3) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-asi-choice-${i + 1}`,
    label: "Ability Score Increase",
    minLevel,
    minSelections: 1,
    maxSelections: 1,
    category: "abilities",
    asiFamily: `${prefix}-asi`,
    options: ASI_SLOT_ABILITIES.map(([id, name]) => ({
      id: `${prefix}-asi-choice-${i + 1}-${id}`,
      name: `+1 ${name}`,
      description: "",
      statModifiers: [{ targetFieldId: `${id}Score`, op: "add", value: 1, minLevel: null }],
      featureGrants: [],
      resourceGrants: [],
    })),
  }));
}

/**
 * Replaces a race's free-form ASI note ("pick by hand") with three real
 * +1 slot groups. The note is REMOVED by takeNotes, which is the point: it
 * used to be the only thing the sheet said, and it described a decision the
 * sheet could not record.
 */
function patchFreeformAsi(bundle, prefix) {
  const levels = takeNotes(bundle, (g) => /plus_2_plus_1_or_three_plus_1s/.test(g.description || ""));
  if (!levels.length) return bundle;
  const minLevel = Math.min(...levels.filter(Number.isFinite).length ? levels.filter(Number.isFinite) : [1]);
  bundle.choiceGroups.push(...asiSlotChoiceGroups(prefix, minLevel, 3));
  return bundle;
}

// --- Dwarven subraces ---------------------------------------------------------------
// Base Dwarves carry no traits or bonuses of their own â€” Hill,
// Mountain, and Duergar each arrive as a full kit, with the shared
// dwarven traits (Constitution, darkvision, poison resilience,
// stonecunning, weapon training, languages, unslowed speed)
// duplicated onto every option, the same way elven base traits live
// on each elf-subrace option in extraRaces.js.
const DWARF_SHARED_STATS = [
  { targetFieldId: "conScore", op: "add", value: 2, minLevel: null },
  // Dwarves walk 25 ft., not the 30 the starter sheet's Speed field ships
  // with. Declared as a stat modifier the same way Wood Elves already
  // declare their +5 (extraRaces.js), so Finish Setup has something to
  // write the Speed cell from instead of leaving it contradicting the
  // "25 ft. walking" line two rows below it in Features & Traits.
  { targetFieldId: "speed", op: "add", value: -5, minLevel: null },
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
        // The base dwarf rule, which the compiled data dropped entirely -
        // not unpickable, missing, so no subrace carried it. Every dwarf
        // has it whichever subrace they take, so it sits on the base
        // bundle rather than being repeated on each subrace.
        toolPick("dwarf-base-tools", "Smith's, brewer's or mason's tools", DWARF_BASE_TOOLS),
        {
          id: "dwarf-subrace", label: "Dwarven Subrace", subrace: true, minLevel: 1, minSelections: 1, maxSelections: 1,
          options: [
            dwarfSubraceOption(
              "dwarf-subrace-hill-dwarf", "Hill Dwarf",
              [
                { targetFieldId: "wisScore", op: "add", value: 1, minLevel: null },
                // Dwarven Toughness: +1 HP at 1st level, and +1 more at
                // every level after it. A stat modifier rather than a
                // sentence in the feature text, because that is what the
                // level-1 HP total and the Level Up guide both read - as
                // prose it only ever said to apply it by hand.
                { targetFieldId: "hpMax", op: "add", value: 1, minLevel: null },
              ],
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
              ],              // Superior darkvision replaces (not joins) the shared 60
              // ft. â€” only the override is listed.
              featureGrants: [
                { name: "Dwarven Resilience", description: "Advantage on saving throw against poison damage.", minLevel: null },
                { name: "Stonecunning", description: "Double proficiency bonus on history checks related to stonework origin.", minLevel: null },
                { name: "Speed", description: "25 ft. walking (heavy armor doesn't slow you down)", minLevel: null },
                { name: "Senses", description: "Darkvision 120 ft.", minLevel: null },
                { name: "Resistances", description: "Poison", minLevel: null },
                { name: "Duergar Resilience", description: "Advantage on saving throw against illusion or charm or paralyzed.", minLevel: null },
                // "Enlarge/Reduce" is the spell's actual name, and the link
                // the picker draws on it only resolves against the catalog's
                // spelling - so the slash has to be here, not "Enlarge Reduce",
                // or the mention reads as an ordinary phrase and links
                // nothing. Each clause also carries its own level gate in the
                // prose ("starting at level 3"), which the mechanics renderer
                // reads to hide the clause below that level - see
                // levelGatedText in sheetMechanics.js.
                { name: "Duergar Magic", description: "Cast Enlarge/Reduce starting at level 3 once per long rest.; Cast Invisibility starting at level 5 once per long rest.", minLevel: null },
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
// pickers below â€” they leave the race list (existing characters
// holding one are migrated to the base race + the matching pick on
// sheet open; see healLegacySubsumedRaces in customSheet.js).
export const SUPERSEDED_RACE_NAMES = new Set(["Hill Dwarf", "Mountain Dwarf", "Duergar", "Air Genasi", "Earth Genasi", "Fire Genasi", "Water Genasi"]);

/** Pre-subrace bundles for the gutted bases, keyed by race name â€”
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
      { name: "Elven Subrace", description: "Choose a subrace with your DM (High, Wood, or Drow) â€” it grants extra traits. Track your subrace pick by hand for now; there is no subrace picker yet.", minLevel: 1 },
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
// Base Gnomes/Halflings carry no traits or bonuses of their own â€”
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
    category: "features",
    // Chosen once at 3rd level (a permanent build decision; later Hunter
    // picks are separate level-gated groups, still unsourced â€” see
    // docs/subclass-gaps.md).
    choiceKind: "build",
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
    const group = fightingStyleGroup("champion", levels.length ? Math.min(...levels.filter(Number.isFinite)) : 10, FS_LISTS.Fighter);
    group.category = "features";
    // Chosen once at 10th level (a permanent build decision).
    group.choiceKind = "build";
    bundle.choiceGroups.push(group);
  } else {
    const group = (bundle.choiceGroups || []).find((g) => g.id === "champion-fighting-style");
    if (group && !group.category) group.category = "features";
    if (group && !group.choiceKind) group.choiceKind = "build";
  }
  return bundle;
}

// --- Built tables ----------------------------------------------------------------------
function patchClassEntry(entry) {
  const patcher = CLASS_PATCHERS[entry.name];
  const out = { ...entry, bundle: clone(entry.bundle) };
  out.bundle.choiceGroups = [...(out.bundle.choiceGroups || [])];
  out.bundle.featureGrants = [...(out.bundle.featureGrants || [])];
  if (patcher) patcher(out.bundle);
  // Phase 1 audit fixes compose on top of (and for most classes,
  // instead of) the historical patchers above.
  phase1ClassPatch(entry.name, out.bundle);
  applyClassPicks(entry.name, out.bundle);
  return out;
}

/** Attach the choice groups a class feature is missing (see classPicks.js).
 *
 *  Two jobs beyond adding the groups:
 *  - Drop an option the table replaces. "Humanoids (choose two)" grants
 *    nothing and cannot be meaningfully taken once the real humanoid
 *    options exist, so leaving it would offer two ways to do one thing.
 *  - Replace feature text that admits it is unpickable. The compiler
 *    writes "not a pickable list here yet" when it had no options to
 *    emit; now there are, so the note is worse than useless - it tells the
 *    player the feature is incomplete when it isn't. */
function applyClassPicks(className, bundle) {
  const specs = CLASS_PICKS[className] || [];
  for (const spec of specs) {
    const match = (g) => (g?.name || "").trim().toLowerCase() === spec.feature.trim().toLowerCase();
    // "Humanoids (choose two)" lives on the level-1 group, not on a
    // feature, so it is dropped from the group that offers it. Group
    // options may be a live view, so the array is rebuilt rather than
    // filtered in place.
    if (spec.dropFromGroup && spec.dropOption) {
      const host = (bundle.choiceGroups || []).find((g) => g.id === spec.dropFromGroup);
      if (host && Array.isArray(host.options)) {
        host.options = host.options.filter((o) => (o?.name || "") !== spec.dropOption);
      }
    }
    for (const group of spec.groups || []) {
      if ((bundle.choiceGroups || []).some((g) => g.id === group.id)) continue;
      bundle.choiceGroups.push({
        minLevel: 1,
        ...group,
        source: spec.feature,
      });
    }
    const target = (bundle.featureGrants || []).find(match);
    if (target && isUnpickableNote(target.description) && CLASS_PICK_TEXT[spec.feature]) {
      target.description = CLASS_PICK_TEXT[spec.feature];
    }
  }
  return bundle;
}

/** Race features the rules define as a choice but that arrived without one.
 *
 *  - The dwarf's base rule is "smith's, brewer's or mason's tools". It
 *    wasn't in the compiled data at all - not unpickable, missing - so no
 *    subrace carried it. It goes on the base bundle, not a subrace, since
 *    every dwarf has it whichever subrace they take.
 *  - The yuan-ti speaks Common and Draconic, and got neither. Aarakocra,
 *    Aasimar and Changeling all carry a language group; this is the same
 *    row, and its absence read as "this race's languages are fixed" when
 *    they were simply missing.
 *
 *  Both are the shape the rest of the project already handles: a choice
 *  group on the bundle, gated by minLevel like every other. */
function applyRacePicks(name, bundle) {
  const add = (group) => {
    if ((bundle.choiceGroups || []).some((g) => g.id === group.id)) return;
    bundle.choiceGroups.push(group);
  };
  if (name === "Dwarf") {
    add(toolPick("dwarf-base-tools", "Smith's, brewer's or mason's tools", DWARF_BASE_TOOLS));
  }
  if (name === "Yuan-ti") {
    // Common and Draconic are fixed grants, matching the other races'
    // shape; this is the "plus one of your choice".
    const have = new Set((bundle.statModifiers || [])
      .filter((m) => m.targetFieldId === "languages").map((m) => m.value));
    bundle.statModifiers = [
      ...(bundle.statModifiers || []),
      ...[...["Common", "Draconic"].filter((n) => !have.has(n))]
        .map((n) => ({ targetFieldId: "languages", op: "grantTag", value: n })),
    ];
    add(languagePick("yuan-ti-languages", "One language of your choice", 1));
  }
  return bundle;
}

function patchBackgroundEntry(entry) {  const out = { ...entry, bundle: clone(entry.bundle) };
  out.bundle.choiceGroups = [...(out.bundle.choiceGroups || [])];
  out.bundle.featureGrants = [...(out.bundle.featureGrants || [])];
  out.bundle.statModifiers = [...(out.bundle.statModifiers || [])];
  phase1BackgroundPatch(entry.name, out.bundle);
  return out;
}

export const FIXED_BG_ENTRIES = DEFAULT_CONTENT.bgEntries
  .map(patchBackgroundEntry)
  .map((entry) => ({ ...entry, bundle: finalizeBundle(entry.bundle, "background", entry.name) }));

export const FIXED_CLASS_ENTRIES = [
  ...DEFAULT_CONTENT.classEntries.map(patchClassEntry),
  // Artificer (TCE) â€” the compiled sources never covered this class,
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
          category: "skills",
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
          category: "tools",
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
].map((entry) => ({ ...entry, bundle: finalizeBundle(entry.bundle, "class", entry.name) }));

function patchRaceEntry(entry) {
  const out = { ...entry, bundle: clone(entry.bundle) };
  out.bundle.choiceGroups = [...(out.bundle.choiceGroups || [])];
  out.bundle.featureGrants = [...(out.bundle.featureGrants || [])];
  if (["Aarakocra", "Aasimar", "Yuan-ti"].includes(entry.name)) {
    patchFreeformAsi(out.bundle, entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  }
  applyRacePicks(entry.name, out.bundle);
  if (entry.name === "Custom Lineage") {
    // Custom Lineage arrived with a single +2 group and no free-form note,
    // so there is no note to take: the compiled group goes, and the same
    // three +1 slots every other free-form increase uses take its place.
    // One +2 with a free choice is the same three questions, and it keeps
    // Custom Lineage's own ASI on the renderer every other species uses.
    out.bundle.choiceGroups = out.bundle.choiceGroups.filter((g) => !/^custom-lineage-(asi-choice|flexible-asi)/.test(g.id));
    out.bundle.choiceGroups.push(...asiSlotChoiceGroups("custom-lineage", 1, 3));
    patchLineageTraitNames(out.bundle);
    // "Skill Proficiency" is a Variable Trait option that grants
    // "proficiency in 1 skill of your choice" - but with nothing to pick
    // from, the pick granted the note and no actual skill. A follow-up
    // group, gated on that option being chosen, so the row appears
    // directly beneath the trait only once the user has opted into it.
    addLineageSkillFollowUp(out.bundle);
  }
  if (entry.name === "Changeling") {
    patchAbilityOptionAbbr(out.bundle, "changeling-asi-choice-1");
  }
  return out;
}

/** The skill pick behind Custom Lineage's "Skill Proficiency" Variable
 *  Trait. `requiresGroup` / `requiresOption` gate it on that trait being
 *  chosen (see creationChoiceGroupsForState), so it isn't offered to
 *  someone who took Darkvision instead.
 *
 *  Options grant the proficiency checkbox directly, the same way every
 *  other skill pick in the project does. */
function addLineageSkillFollowUp(bundle) {
  const groupId = "custom-lineage-variable_trait_skill";
  const parentId = "custom-lineage-variable_trait";
  const group = {
    id: groupId,
    label: "Skill Proficiency",
    minLevel: 1,
    minSelections: 1,
    maxSelections: 1,
    category: "skills",
    requiresGroup: parentId,
    requiresOption: "custom-lineage-variable_trait-skill_proficiency",
    // Keeps the follow-up row directly beneath the trait that caused it,
    // rather than at the end of the bundle's groups. See
    // renderCreationChoiceGroups for how this is honored.
    sortAfter: parentId,
    options: SKILLS.map((s) => ({
      id: `${groupId}-${s.id}`,
      name: s.label,
      description: s.description || "",
      statModifiers: [{ targetFieldId: `${s.id}Prof`, op: "grant" }],
    })),
  };
  const without = (bundle.choiceGroups || []).filter((g) => g.id !== groupId);
  const at = without.findIndex((g) => g.id === parentId);
  // Splice in right after the trait. If the trait is somehow absent the
  // group still gets added, at the end, rather than being dropped.
  if (at === -1) without.push(group);
  else without.splice(at + 1, 0, group);
  bundle.choiceGroups = without;
}

/** High Elf gets two choices its trait text only describes:
 *  "one extra language of your choice" and "one cantrip of your choice
 *  from the wizard spell list". Both were bare prose, so the player had
 *  to read the rule and then work out where to make the pick. Giving each
 *  a real choice group puts the control on the row, and the existing
 *  dropdown/dialog machinery renders them like every other pick. */
function patchHighElfChoices(bundle) {
  const group = (bundle?.choiceGroups || []).find((g) => g.id === "elf-subrace");
  if (!group) return bundle;
  const high = (group.options || []).find((o) => o.id === "elf-subrace-high");
  if (!high) return bundle;
  const has = (id) => (high.choiceGroups || []).some((g) => g.id === id);
  const extra = [];
  if (!has("elf-subrace-high-language")) {
    extra.push({
      id: "elf-subrace-high-language",
      label: "Extra Language",
      minLevel: 1,
      minSelections: 1,
      maxSelections: 1,
      category: "languages",
      // Every language the sheet knows, minus Common (free and never a
      // pick) — the same vocabulary the other language groups use. Each
      // option grants the language through the usual `languages` tag, so
      // picking it puts it on the sheet rather than only recording a name.
      options: LANGUAGES
        .filter((name) => name !== "Common")
        .map((name) => ({
          id: `elf-subrace-high-language-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          name,
          statModifiers: [{ targetFieldId: "languages", op: "grantTag", value: name }],
        })),
    });
  }
  if (!has("elf-subrace-high-cantrip")) {
    extra.push({
      id: "elf-subrace-high-cantrip",
      label: "Cantrip",
      minLevel: 1,
      minSelections: 1,
      maxSelections: 1,
      category: "spells",
      // Handled by the spells dialog rather than a dropdown - the wizard
      // cantrip list is long, and the dialog already filters to the
      // right spell list and level.
      spellPick: { list: "wizard", level: 0 },
      options: [{ id: "elf-subrace-high-cantrip-pending", name: "Choose a cantrip", description: "Opens the wizard cantrip list." }],
    });
  }
  if (!extra.length) return bundle;
  return {
    ...bundle,
    choiceGroups: (bundle.choiceGroups || []).map((g) => (
      g.id === "elf-subrace" ? { ...g, options: (g.options || []).map((o) => (o.id === "elf-subrace-high" ? { ...o, choiceGroups: [...(o.choiceGroups || []), ...extra] } : o)) } : g
    )),
  };
}

// Custom Lineage's variable-trait option reads "Darkvision 60" in
// compiled data â€” parenthesized range reads better everywhere the
// name surfaces (profile dropdown, review lines, applied feature
// list). Darkvision detection matches /darkvision/i on the name, so
// categorization is unaffected. Option id untouched, so stored picks
// keep working; option objects copied before renaming, as above.
function patchLineageTraitNames(bundle) {
  bundle.choiceGroups = (bundle.choiceGroups || []).map((group) => {
    if (group.id !== "custom-lineage-variable_trait") return group;
    return {
      ...group,
      options: (group.options || []).map((o) => {
        if ((o.name || "").trim() !== "Darkvision 60") return o;
        return {
          ...o,
          name: "Darkvision (60 feet)",
          featureGrants: (o.featureGrants || []).map((f) => (
            (f.name || "").trim() === "Darkvision 60" ? { ...f, name: "Darkvision (60 feet)" } : f
          )),
        };
      }),
    };
  });
  return bundle;
}

// Ability-named options ("+2 STR", "+1 STR") read better abbreviated
// ("STR") everywhere the option name surfaces (profile dropdowns,
// review lines, Leveling radios) â€” tooltips on the rendered controls
// carry the full names. Derived from each option's own score target
// (single score-add only), never parsed from the name. Copy options
// before renaming: the array above is fresh but the option objects
// are still shared with compiled defaultContent.
function patchAbilityOptionAbbr(bundle, groupId) {
  bundle.choiceGroups = (bundle.choiceGroups || []).map((group) => {
    if (group.id !== groupId) return group;
    return {
      ...group,
      options: (group.options || []).map((o) => {
        const adds = (o.statModifiers || []).filter((m) => m.op === "add" && /Score$/.test(m.targetFieldId || ""));
        if (adds.length !== 1) return o;
        return { ...o, name: adds[0].targetFieldId.replace(/Score$/, "").toUpperCase() };
      }),
    };
  });
  return bundle;
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
  // extraRaces.js) â€” no patching needed, though the Elf's High
  // subrace still needs its two trait picks turned into real rows.
  ...RACE_EXTRA_ENTRIES.map((entry) => (
    entry.name === "Elf" ? { ...entry, bundle: patchHighElfChoices(entry.bundle) } : entry
  )),
  // Base Genasi with its four elemental subraces.
  genasiBaseEntry(),
].map((entry) => ({ ...entry, bundle: finalizeBundle(entry.bundle, "race", entry.name) }));

const SUBCLASS_PATCHERS = {
  "Hunter Conclave": patchHunterConclave,
  Champion: patchChampion,
};

/** Damage resistances a feature grants, read off the SOURCED text.
 *
 *  Once the rules text was fetched (see applyFetchedFeatureText) these
 *  became readable for the first time - the export had given the features
 *  a name and nothing else, so a resistance stated only in the prose was
 *  invisible on the sheet. The player was never told they were resistant
 *  to fire.
 *
 *  They are recorded as a "Resistances" feature grant, which is the
 *  pattern the race bundles already use (Aasimar carries one row per
 *  damage type) rather than inventing a new modifier kind for one line of
 *  content.
 *
 *  Every entry here is checked against the fetched text before it is
 *  added, and skipped if the text does not say it. That guard is the whole
 *  point: this table is a claim about the rules, and a stale claim would
 *  put a resistance on a character the rules do not give it.
 *
 *  Deliberately NOT listed:
 *   - Storm Soul (Storm Herald), because which resistance you get depends
 *     on the storm type you chose. That is a build choice, and it belongs
 *     with the storm-herald-aura picker rather than as a flat grant.
 *   - Anything conditional in the source ("while you...", "for 1
 *     minute", "when you take damage"). A modifier the sheet applies
 *     unconditionally but the rules make temporary is a wrong sheet.
 */
const SOURCED_RESISTANCES = [
  { subclass: "Alchemist", feature: "Chemical Mastery", level: 15, damage: "Acid" },
  { subclass: "Forge Domain", feature: "Soul of the Forge", level: 6, damage: "Fire" },
  { subclass: "Psi Warrior", feature: "Guarded Mind", level: 10, damage: "Psychic" },
  { subclass: "Aberrant Mind", feature: "Psychic Defenses", level: 6, damage: "Psychic" },
  { subclass: "The Fathomless", feature: "Oceanic Soul", level: 6, damage: "Cold" },
  { subclass: "The Undead", feature: "Necrotic Husk", level: 10, damage: "Necrotic" },
  { subclass: "School of Necromancy", feature: "Inured to Undeath", level: 10, damage: "Necrotic" },
];

/** Add the resistances the fetched text actually states, once each. */
function applySourcedResistances(bundle, key) {
  const mine = SOURCED_RESISTANCES.filter((r) => normSubclassKey(r.subclass) === key);
  if (!mine.length) return bundle;
  for (const r of mine) {
    const text = SUBCLASS_FEATURE_TEXT[key]?.features?.[r.feature] || "";
    // The guard. If the text changed, or the name is wrong, or the source
    // no longer grants it, add nothing rather than assert it.
    if (!new RegExp(`\\bresistance to ${r.damage.toLowerCase()} damage\\b`, "i").test(text)) continue;
    const already = (bundle.featureGrants || []).some(
      (g) => /^Resistances?$/i.test(g.name) && (g.description || "").toLowerCase() === r.damage.toLowerCase()
    );
    if (already) continue;
    bundle.featureGrants.push({
      id: `${key}-${r.level}-resistance-${r.damage.toLowerCase()}`,
      name: "Resistances",
      description: r.damage,
      minLevel: r.level,
    });
  }
  return bundle;
}

export function patchedSubclassBundle(name, bundle) {
  const patcher = SUBCLASS_PATCHERS[name];
  const key = normSubclassKey(name);
  const picks = SUBCLASS_PICKS[key];
  // The fetched-text pass below applies on its own, so a subclass with
  // neither a patcher nor any picks still needs the guard to let it run.
  if ((!patcher && !picks && !SUBCLASS_FEATURE_TEXT[key]) || !bundle) return bundle;
  const out = { ...bundle, choiceGroups: [...(bundle?.choiceGroups || [])], featureGrants: [...(bundle?.featureGrants || [])] };
  if (patcher) patcher(out);
  if (picks) applySubclassPicks(out, picks);
  applyFetchedFeatureText(out, key);
  applySourcedResistances(out, key);
  return out;
}

/** Give a feature the rules text the compiled export never carried.
 *
 *  The subclass export was taken from the ACTOR, so its features are
 *  `@Compendium[...]{Name}` references and the prose behind them was
 *  never in the file - which is why 581 of 640 features had no
 *  description at all. The text now comes from
 *  scripts/fetch-subclass-feature-text.mjs via the generated
 *  SUBCLASS_FEATURE_TEXT, which carries each feature's source URL so it
 *  can be re-checked.
 *
 *  Only fills a BLANK description, and only for a feature whose name
 *  matches exactly. A feature that already has text keeps it: some were
 *  hand-sourced during earlier phases, and this must never overwrite a
 *  deliberate one. A feature with no entry in the fetched text keeps
 *  whatever it had, including nothing - an empty description is
 *  recoverable, a feature carrying another feature's rules is not. */
function applyFetchedFeatureText(bundle, key) {
  const fetched = SUBCLASS_FEATURE_TEXT[key]?.features;
  const url = SUBCLASS_FEATURE_TEXT[key]?.url;
  if (!fetched) return bundle;
  for (const grant of bundle.featureGrants || []) {
    if ((grant.description || "").trim()) continue;
    const text = fetched[grant.name];
    if (!text) continue;
    grant.description = text;
    // customSheet.js filters `unsourced` grants out of the sheet
    // entirely, not just out of the text, so a grant that was hidden
    // only because the export carried no prose now has to be shown.
    grant.unsourced = false;
    // Keep the provenance on the grant itself. The text is scraped, and
    // a scraped rule that cannot be traced back to a page is not a
    // source - it is an unattributed assertion.
    grant.sourceUrl = url;
  }
  return bundle;
}

/** Attach the choice groups a feature is missing, and give that feature
 *  the text it was compiled without.
 *
 *  Keyed by feature name rather than by position, because the compiled
 *  data lists a feature's levels as separate grants ("Arcane Shot (2
 *  options)", "Arcane Shot (3 options)") and the one the rules define the
 *  CHOICE on is the first. A name that isn't found is skipped rather than
 *  throwing, so a source re-export that renames a feature degrades to
 *  "no picker" instead of taking the whole sheet down.
 *
 *  The group is added at the END of choiceGroups with `sortAfter` naming
 *  the feature, so the pick renders under the rule it belongs to instead
 *  of wherever the bundle happened to put it. */
function applySubclassPicks(bundle, specs) {
  for (const spec of specs) {
    const grant = (bundle.featureGrants || []).find((g) => (g.name || "").trim().toLowerCase() === spec.feature.trim().toLowerCase());
    if (!grant) continue;
    if (spec.text && !(grant.description || "").trim()) grant.description = spec.text;
    for (const group of spec.groups || []) {
      if ((bundle.choiceGroups || []).some((g) => g.id === group.id)) continue;
      bundle.choiceGroups.push({
        ...group,
        minLevel: group.minLevel ?? spec.level ?? grant.minLevel ?? 1,
        source: spec.feature,
        // Sits under the feature it belongs to when the wizard orders
        // follow-ups by name.
        sortAfter: group.sortAfter || null,
      });
    }
  }
  return bundle;
}

export const normSubclassKey = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// PHB multiclassing grants no saving-throw proficiencies and only a
// limited slice of the new class's armor/weapon proficiencies.
// Rather than encoding the full per-class multiclass-proficiency
// table, secondary class bundles drop save grants and armor/weapon
// fixed tags; skill/tool choice groups stay pickable as usual, and
// the Equipment Proficiencies tab covers anything else by hand.
// Subclass bundles are never stripped (their features are the point).
// Returns a fresh object per call â€” never persisted, only computed.
export function stripSecondaryClassBundle(bundle) {
  if (!bundle) return null;
  return {
    ...bundle,
    statModifiers: (bundle.statModifiers || []).filter((m) =>
      !(m.op === "grant" && /SaveProf$/.test(m.targetFieldId || ""))
      && !(m.op === "grantTag" && (m.targetFieldId === "armorProf" || m.targetFieldId === "weaponProf"))),
  };
}

// Patched subclass bundles keyed by normalized subclass name â€” the
// single source blockModel (starter choices) and bundleMaps
// (save/load canonicals) both read from.
export const SUBCLASS_BUNDLE_MAP = new Map(
  SUBCLASS_SUPPLEMENT.map((s) => [s.key, finalizeBundle(patchedSubclassBundle(s.name, s.bundle), "subclass", s.name)])
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

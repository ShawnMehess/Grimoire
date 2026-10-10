// sheetMechanics.js
//
// Wizard/mechanics preview helpers extracted from customSheet.js.
// These were nested inside renderCustomSheet but only depend on their
// arguments — the one exception is statModifierLabel, which previously
// closed over resolveFieldById. It now takes an optional
// `resolveLabel` callback so the pure core stays testable; callers that
// have sheet state pass `(id) => resolveFieldById(id)?.label`.

// The creation-page table and the rule that reads it live in
// js/data/choiceCategories.js, which is where they belong — they are pure
// data with no DOM in them, and keeping a copy here meant js/data had to
// import js/render. Re-exported under the old names so every existing
// import site below (sheetWizard.js, customSheet.js, the content gates, the
// tests) is unchanged.
import {
  CREATION_CHOICE_CATEGORIES,
  CHOICE_GROUP_CATEGORY_KEYS,
  inferChoiceCategory,
} from "../../data/choiceCategories.js";

export { CREATION_CHOICE_CATEGORIES, CHOICE_GROUP_CATEGORY_KEYS };

/**
 * Which page of the creation flow a choice group belongs on.
 *
 * A thin alias for `inferChoiceCategory`, which is the one implementation.
 * This previously held its own byte-identical copy of the rule; two copies
 * of a routing table is exactly the drift the data module's comment claimed
 * to prevent.
 *
 * Prefers an explicit `pageCategory`, then an explicit `category` that's
 * already a valid page key, and only then falls back to keyword-matching
 * the label. Every group the repo ships carries a `pageCategory` (assigned
 * in js/data/choiceCategories.js), so the label heuristic does no work for
 * our own content — verify-content.mjs asserts that, which is what stops it
 * quietly becoming load-bearing again.
 *
 * The heuristic is kept for imported homebrew, which arrives as JSON with
 * no page: dropping it would silently dump those groups onto the catch-all
 * page, where a label like "Pick 2 skills" would have sorted correctly.
 * Homebrew that wants a guaranteed page sets `pageCategory` to one of
 * CHOICE_GROUP_CATEGORY_KEYS.
 */
export function categorizeChoiceGroup(group) {
  return inferChoiceCategory(group);
}

export function statModifierLabel(mod, { abilityIds = [], abilities = [], skills = [], resolveLabel = null } = {}) {
  const abilityId = abilityIds.find((id) => mod.targetFieldId === `${id}Score`);
  if (abilityId) return abilityId.toUpperCase();
  const saveAbility = abilities.find((a) => mod.targetFieldId === `${a.id}SaveProf`);
  // Abbreviated like score labels ("STR Save") — tooltips on the
  // rendered controls carry the full names.
  if (saveAbility) return `${saveAbility.id.toUpperCase()} Save`;
  const skill = skills.find((s) => mod.targetFieldId === `${s.id}Prof`);
  if (skill) return skill.label;
  if (resolveLabel) return resolveLabel(mod.targetFieldId) || mod.targetFieldId;
  return mod.targetFieldId;
}

export function statModifierSummary(mod, deps = {}) {
  const label = typeof deps.resolveLabel === "string"
    ? deps.resolveLabel
    : statModifierLabel(mod, deps);
  const amount = Number.isFinite(mod.value) ? mod.value : 0;
  switch (mod.op) {
    case "grant": return label;
    case "grantTag": return label;
    case "add": return `${amount >= 0 ? "+" : ""}${amount} ${label}`;
    case "subtract": return `-${Math.abs(amount)} ${label}`;
    case "set": return `${label} = ${amount}`;
    case "multiply": return `${label} ×${amount}`;
    default: return label;
  }
}

/** Collapse exact-duplicate bits into counts, preserving
 *  first-appearance order: ["Weapon Prof.", "Weapon Prof."] becomes
 *  ["2 Weapon Prof."]. Singletons pass through untouched. */
export function collapseBits(bits) {
  const counts = new Map();
  bits.forEach((bit) => counts.set(bit, (counts.get(bit) || 0) + 1));
  return [...counts.entries()].map(([bit, count]) => (count > 1 ? `${count} ${bit}` : bit));
}

/** A feature grant's display bit. Speed and Darkvision carry their
 *  range from the description ("Speed: 25 ft", "Darkvision: 60 feet")
 *  so options can be told apart; anything else shows its plain name.
 *  Label and detail always join with a colon, site-wide. */
export function featureBit(grant) {
  const name = grant.name || "";
  if (/^speed$/i.test(name.trim())) {
    const range = rangeText(grant.description);
    if (range) return `Speed: ${range}`;
  }
  // The compiled race data spells darkvision "Senses" (every such
  // grant describes a darkvision range) while the hand-written races
  // say "Darkvision" outright — both render as Darkvision here.
  if (/darkvision/i.test(name.trim()) || (isSensesGrant(name) && /darkvision/i.test(grant.description || ""))) {
    const range = rangeText(grant.description);
    if (range) return `Darkvision: ${range}`;
    if (isSensesGrant(name)) return "Darkvision";
  }
  return name;
}

/** First character uppercased, everything else untouched — applied
 *  to the detail half of every "Topic — detail" join so the word
 *  after an em dash is always capitalized. Digits and already-upper
 *  text pass through unchanged. */
export function capitalizeFirst(text) {
  const s = String(text ?? "");
  if (!s) return s;
  const upper = s.charAt(0).toUpperCase();
  return s.charAt(0) === upper ? s : upper + s.slice(1);
}

/** First "<number> <unit>" range in a description, normalized to
 *  "<number> feet" — accepts "ft", "ft.", "foot", and "feet" ("within
 *  60 feet" and "60 ft." both yield "60 feet"). Null when no range. */
function rangeText(description) {
  const match = /(\d+)\s*(ft\.?|feet|foot)\b/i.exec(description || "");
  if (!match) return null;
  return `${match[1]} feet`;
}

/** Grants named exactly "Senses" (optionally "(override)") are the
 *  compiled data's spelling of darkvision. Anchored so "Keen Senses"
 *  and similar proficiency-style grants never match. */
function isSensesGrant(name) {
  return /^senses(\s*\(override\))?$/i.test((name || "").trim());
}

/** Darkvision by either spelling: "Darkvision…" or a "Senses" grant
 *  describing a darkvision range. */
function isDarkvisionGrant(grant) {
  const name = (grant?.name || "").trim();
  if (/darkvision/i.test(name)) return true;
  return isSensesGrant(name) && /darkvision/i.test(grant?.description || "");
}

/** Damage resistances and save resilience, both spellings: the
 *  compiled "Resistances" plus "Hellish/Magic Resistance",
 *  "Dwarven/Duergar/Poison Resilience", "Gnome Cunning",
 *  "Fey Ancestry", and "Brave" (all "this race resists harm").
 *  Deliberately NOT Lucky, Halfling Nimbleness, Savage Attacks, or
 *  Relentless Endurance (rerolls, movement, crits, death-cheats),
 *  nor Sunlight Sensitivity (a drawback, not a resistance). */
function isResistanceGrant(grant) {
  const name = (grant?.name || "").trim();
  return /resist/i.test(name) || /resili/i.test(name)
    || /^(gnome cunning|fey ancestry|brave)$/i.test(name);
}

function activeAtLevel(items, level) {
  return items.filter((item) => !item.minLevel || item.minLevel <= level);
}

/** The level a segment says it needs, or 0 when it says nothing.
 *
 *  The word "level" has to be adjacent to the number in every one of
 *  these, in either order, because "as a 2nd-level spell" is the SPELL's
 *  level and "within 30 feet of you" is a distance - reading either as a
 *  character-level gate would delete the sentence that explains what the
 *  trait does. Three lead-ins cover every phrasing in the shipped data:
 *  "starting at level 3" / "starting at 3rd level" (the Duergar, Yuan-ti,
 *  Air Genasi), "when you reach 3rd level" / "once you reach 5th level"
 *  (the tiefling bloodlines), and a bare "at level 9" / "from 3rd level".
 *  Ordinals and cardinals both accepted, and 1-20 only, so a stray number
 *  cannot swallow every clause after it.
 *
 *  The FIRST gate in a segment is the one that counts. A sentence is
 *  available from the level it first says so: "when you reach 3rd level
 *  and again at 10th level, you gain…" describes something you have at 3,
 *  and taking the largest would hide a real benefit for seven levels. */
const NUMBER_AFTER_LEVEL = String.raw`level\s*(\d{1,2})(?:st|nd|rd|th)?`;
const NUMBER_BEFORE_LEVEL = String.raw`(\d{1,2})(?:st|nd|rd|th)\s+level`;
// An ordinal alone is enough: the Drow writes "Darkness once per long
// rest at 5th" with no second "level", and an English ordinal after "at"
// reads as a level here. A bare CARDINAL is not ("within 30 feet of you",
// "at 10gp"), so that shape stays out.
const ORDINAL_ALONE = String.raw`(\d{1,2})(?:st|nd|rd|th)(?!\w)`;
const LEVEL_CLAUSE = new RegExp(
  [
    String.raw`(?:starting|beginning)\s+(?:at\s+)?(?:${NUMBER_AFTER_LEVEL}|${NUMBER_BEFORE_LEVEL})`,
    String.raw`(?:when|once|after)\s+you\s+(?:reach|are)\s+(?:${NUMBER_AFTER_LEVEL}|${NUMBER_BEFORE_LEVEL})`,
    String.raw`(?:at|from|by)\s+(?:${NUMBER_AFTER_LEVEL}|${NUMBER_BEFORE_LEVEL}|${ORDINAL_ALONE})`,
  ].join("|"),
  "gi",
);

/** A semicolon, or a full stop followed by whitespace: the two
 *  boundaries the shipped descriptions are built out of. The lookahead
 *  keeps "2nd-level" from splitting, and requiring a space after the full
 *  stop keeps a description's LAST period inside its final segment rather
 *  than swallowing it. */
const SEGMENT_BREAK = /([;!?]|\.(?=\s))\s*/g;

function levelInSegment(text) {
  LEVEL_CLAUSE.lastIndex = 0;
  const m = LEVEL_CLAUSE.exec(text);
  if (!m) return 0;
  // Every outer alternative carries its own pair of capture groups, so the
  // number is whichever group in the match actually captured.
  const n = m.slice(1)
    .map((g) => (g == null ? NaN : Number(g)))
    .find((v) => Number.isFinite(v) && v > 0);
  return n ? Math.min(20, n) : 0;
}


/** Split a description into the pieces that carry their own level gate.
 *
 *  Each piece keeps the punctuation that INTRODUCED it, so dropping a
 *  gated piece and joining the survivors back together reproduces the
 *  original's punctuation rather than inventing it: "Dancing Lights
 *  cantrip; Faerie Fire once per long rest at 3rd level; Darkness once
 *  per long rest at 5th. Charisma is your spellcasting ability." at
 *  level 1 reads "Dancing Lights cantrip. Charisma is your spellcasting
 *  ability." and not "Dancing Lights cantrip Charisma is your
 *  spellcasting ability."
 *
 *  Returns `[{ sep, text, minLevel }]`. Pure. */
function levelGatedSegments(text) {
  const src = String(text ?? "");
  const out = [];
  let sep = "";
  let last = 0;
  SEGMENT_BREAK.lastIndex = 0;
  let m;
  while ((m = SEGMENT_BREAK.exec(src)) !== null) {
    const body = src.slice(last, m.index).trim();
    if (body) out.push({ sep, text: body });
    sep = `${m[1]} `;
    last = SEGMENT_BREAK.lastIndex;
  }
  const tail = src.slice(last).trim();
  if (tail) out.push({ sep, text: tail });
  return out.map((piece) => ({ ...piece, minLevel: levelInSegment(piece.text) }));
}

/** A description with the parts you do not have at this level removed.
 *
 *  The single fix for "the Duergar tells a level 1 character it casts
 *  Enlarge/Reduce from level 3". `minLevel` on a feature grant hides the
 *  WHOLE grant above a level, which cannot express a trait that starts
 *  available and grows: one grant, one gate, so a Duergar either had no
 *  Duergar Magic at all or all of it. The rules are inside the prose, so
 *  the prose is what has to be read.
 *
 *  Returns null when nothing survives, which is the caller's signal to
 *  drop the whole bullet rather than print an empty one. Computed on
 *  every render from the level the player currently has, so changing the
 *  level in the wizard re-reads the text rather than needing a reload.
 *  Pure. */
export function levelGatedText(text, level = Infinity) {
  const src = String(text ?? "");
  if (!src.trim()) return null;
  const segments = levelGatedSegments(src);
  // Only text that actually carries a gate is rebuilt, and text whose
  // every segment survives is handed back untouched - so no description is
  // ever re-joined differently from how it shipped. The overwhelming
  // majority of the corpus takes the first exit and returns byte-identical.
  if (!segments.some((s) => s.minLevel > 0)) return src;
  const kept = segments.filter((s) => s.minLevel <= level);
  if (!kept.length) return null;
  if (kept.length === segments.length) return src;
  // The first survivor keeps no separator: when the opening segment was
  // the gated one, its successor's "; " or ". " would otherwise open the
  // sentence with punctuation.
  return kept
    .map((piece, i) => `${i === 0 ? "" : piece.sep}${piece.text}`)
    .join("")
    .trim();
}


/** Pack-gate mirror of the producers' filter (see packAllows in
 *  sheetWizard.js, kept local so this module stays dependency-free):
 *  items naming a `requiresPack` (Tasha's optional rules) show only
 *  when that pack is included; a null pack list shows everything. */
function packAllowsLocal(item, includedPacks) {
  if (!item || !item.requiresPack) return true;
  if (includedPacks == null) return true;
  const packs = Array.isArray(includedPacks) ? includedPacks : [includedPacks];
  return packs.includes(item.requiresPack);
}

/** The preview's content bits for one bundle (collapsed, optionally
 *  minus page-common traits) — without the "+N more at higher
 *  levels" tail. Unsourced subclass grants never contribute bits. */
export function previewBitsFor(bundle, level, { summarize = (m) => statModifierSummary(m), exclude = null } = {}) {
  if (!bundle) return [];
  let bits = [
    ...activeAtLevel(bundle.statModifiers || [], level).map((m) => summarize(m)),
    ...activeAtLevel(bundle.featureGrants || [], level)
      .filter((g) => !g.unsourced)
      .map((g) => featureBit(g)).filter(Boolean),
  ];
  if (exclude && exclude.size > 0) bits = bits.filter((bit) => !exclude.has(bit));
  return collapseBits(bits);
}

export function laterCountFor(bundle, level) {
  if (!bundle) return 0;
  const mods = bundle.statModifiers || [];
  const features = bundle.featureGrants || [];
  return (mods.length - activeAtLevel(mods, level).length)
    + (features.length - activeAtLevel(features, level).length);
}

/** Full one-line preview: content bits (with duplicate counts, minus
 *  page-common traits) plus the higher-level tail.
 *  `exclude` is the set of bits identical across every option on the
 *  current picker page — those carry no differentiating information.
 *  Contract: null = no bundle; flavor message = bundle genuinely
 *  empty; "Shared by every option here." = bundle has content but it
 *  was all filtered as page-common. */
export function mechanicsPreviewFor(bundle, level, { summarize = (m) => statModifierSummary(m), exclude = null } = {}) {
  if (!bundle) return null;
  const hasContent = (bundle.statModifiers || []).length > 0 || (bundle.featureGrants || []).length > 0;
  const bits = previewBitsFor(bundle, level, { summarize, exclude });
  const laterCount = laterCountFor(bundle, level);
  if (laterCount > 0) bits.push(`+${laterCount} more at higher levels`);
  if (!bits.length) {
    return hasContent
      ? "Shared by every option here."
      : "No stat bonuses or features on file — flavor only.";
  }
  return bits.join(" · ");
}

/** Bits identical across every bundle in the list (computed with the
 *  same summarize + level as the displayed previews) — the caller
 *  passes these as `exclude` so each row only shows what sets it
 *  apart. Returns an empty set for fewer than two bundles, so a
 *  single-option page never filters itself blank. */
export function commonPreviewBits(bundles, level, { summarize = (m) => statModifierSummary(m) } = {}) {
  if (!bundles || bundles.length < 2) return new Set();
  const lists = bundles.map((b) => previewBitsFor(b, level, { summarize }));
  return new Set(lists[0].filter((bit) => lists.every((other) => other.includes(bit))));
}

export function spellLevelByName(name, spellCatalog = []) {
  const norm = (s) => (s || "").toLowerCase();
  const needle = norm(name);
  const found = spellCatalog.find((s) => norm(s.name) === needle);
  return found?.level ?? null;
}

const TAG_FIELD_LABELS = {
  languages: "Languages",
  armorProf: "Armor",
  weaponProf: "Weapons",
  toolProf: "Tools",
  vehicleProf: "Vehicles",
  otherProf: "Other",
};

/** Display label of the Languages bullet ("Languages: Common, …") —
 *  exported so profile-embedded pickers can find (and replace) that
 *  bullet instead of duplicating it. */
export const LANGUAGE_BULLET_LABEL = TAG_FIELD_LABELS.languages;

/** Picker-profile section titles, exported so embedded pickers can
 *  target sections without duplicating literals. "Racial Traits" and
 *  "Innate Abilities" are race-only: classes use "Level 1 Class
 *  Features" + "Class Proficiencies", backgrounds use "Background
 *  Proficiencies" + "Starting Equipment" + "Background Feature",
 *  subclasses use "Subclass Features"
 *  (see docs/CONTENT-AUDIT-2026-09.md systemic fix 1 and
 *  docs/SUBCLASS-CONTENT-AUDIT-2026-09.md display rule 5).
 *  There is deliberately no "Spells" heading: a race's granted spells
 *  are a line of its Innate Abilities list, not a section. */
export const MECHANICS_TITLES = {
  traits: "Racial Traits",
  scores: "Ability Score Increases",
  proficiencies: "Proficiencies",
  innate: "Innate Abilities",
  classFeatures: "Level 1 Class Features",
  classProficiencies: "Class Proficiencies",
  bgProficiencies: "Background Proficiencies",
  bgEquipment: "Starting Equipment",
  bgFeature: "Background Feature",
  subclassFeatures: "Subclass Features",
};

/** Plain-language ability reference, moved here from
 *  sheetWizardSteps.js so the glossary below shares one source. Kept
 *  in full names on purpose: these strings are the tooltip bodies
 *  that teach each abbreviation back. Display layers abbreviate via
 *  humanizeGameText below. */
export const ABILITY_DESCRIPTIONS = {
  str: "Physical power: melee attacks, carrying capacity, and Athletics checks.",
  dex: "Agility and reflexes: Armor Class, initiative, ranged attacks, and Stealth and Acrobatics checks.",
  con: "Endurance and fortitude: more hit points at every level, and holding concentration on spells.",
  int: "Reasoning and memory: Investigation and Arcana checks. Wizards cast with Intelligence.",
  wis: "Awareness and intuition: Perception and Insight checks. Clerics, Druids, and Rangers cast with Wisdom.",
  cha: "Force of personality: Persuasion and Deception checks. Bards, Paladins, Sorcerers, and Warlocks cast with Charisma.",
};

/** Ability glossary backing every abbreviation + tooltip in the UI:
 *  `{ id: { abbr, name, description } }`. Tooltips read
 *  "Strength — Physical power: …" via abilityTooltip. */
export const ABILITY_GLOSSARY = Object.fromEntries(
  Object.entries(ABILITY_DESCRIPTIONS).map(([id, description]) => {
    const name = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" }[id] || id.toUpperCase();
    return [id, { abbr: id.toUpperCase(), name, description }];
  })
);

/** Tooltip text for an ability id ("str" → "Strength — Physical
 *  power: …"), or null when unknown. Pure. */
export function abilityTooltip(id) {
  const entry = ABILITY_GLOSSARY[id];
  if (!entry) return null;
  return `${entry.name} — ${entry.description}`;
}

const ABILITY_NAME_PATTERNS = Object.values(ABILITY_GLOSSARY).map((entry) => ({
  re: new RegExp(`\\b${entry.name}\\b`, "g"),
  abbr: entry.abbr,
}));

/** Turns compiled-data shorthand into natural language for display:
 *  Foundry variable refs (`@profd4` = proficiency-bonus d4s, `@prof`
 *  = proficiency bonus, `@<abl>.mod` / `@abilities.<abl>.mod` = "XXX
 *  modifier") plus full ability names to abbreviations ("Strength" →
 *  "STR"). Only known tokens change — exotic refs (`@scale.*`,
 *  `@item.*`, `@classes.*`, `@dice`) need per-instance rules research
 *  and pass through untouched rather than risk wrong mechanics.
 *  Capitalized word-boundary matching only, so lowercase prose
 *  ("respect strength shown") and longer words ("Charismatic") never
 *  match. Idempotent (output contains no matchable input). Pure. */
export function humanizeGameText(text) {
  let out = String(text ?? "");
  out = out.replace(/@profd4(\s+HP)?/gi, "a number of d4 hit points equal to your proficiency bonus");
  out = out.replace(/@abilities\.(str|dex|con|int|wis|cha)\.mod/gi, (_, a) => `${a.toUpperCase()} modifier`);
  out = out.replace(/@(str|dex|con|int|wis|cha)\.mod/gi, (_, a) => `${a.toUpperCase()} modifier`);
  out = out.replace(/@prof(?![a-z0-9_.])/gi, "proficiency bonus");
  for (const { re, abbr } of ABILITY_NAME_PATTERNS) {
    out = out.replace(re, abbr);
  }
  return out;
}

/** Splits display text into plain runs and ability runs for rich
 *  tooltips: `[{ text } | { abbr, id, name }]`. Matches abbreviations
 *  and full names (capitalized, word-boundary — homebrew text with
 *  either spelling tooltips correctly). Pure; the caller builds DOM
 *  (or keeps plain text where rich rendering is impossible). */
export function splitAbilityTokens(text) {
  const src = String(text ?? "");
  const byToken = {};
  for (const [id, entry] of Object.entries(ABILITY_GLOSSARY)) {
    byToken[entry.abbr] = id;
    byToken[entry.name] = id;
  }
  const out = [];
  let last = 0;
  const re = /\b(STR|DEX|CON|INT|WIS|CHA|Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\b/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ text: src.slice(last, m.index) });
    const id = byToken[m[1]];
    const entry = ABILITY_GLOSSARY[id];
    out.push({ abbr: entry.abbr, id, name: entry.name });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out;
}

/** Every glossary term, longest literal first.
 *
 *  Ordering matters and cannot be left to chance. A combined alternation
 *  tries its alternatives left to right at each position, so the longer
 *  phrases have to come first or "proficiency bonus" is eaten by
 *  "proficiency" and the bonus explanation never appears. Sorting by the
 *  pattern's source length does not work either - `proficienc(?:y|ies)` is
 *  more characters than `proficiency bonus` while matching less - so each
 *  entry names its own phrase and that is what gets sorted on. Pure. */
export const GAMEPLAY_TERMS = [
  // --- What a proficiency is -------------------------------------------------
  {
    id: "proficiencyBonus",
    phrase: "proficiency bonus",
    patterns: [/\bproficiency bonus\b/i],
    description: "A number you add to rolls you are trained in. It is your level, doubled, plus any bonus from your class - a level 5 character has +3, a level 9 character has +4.",
  },
  {
    id: "savingThrow",
    phrase: "saving throw",
    patterns: [/\bsaving throws?\b/i],
    description: "A roll made to resist something - a spell, a trap, a trap's effect. You roll your spell save DC against the caster's roll; if yours is higher you avoid the effect. Add your proficiency bonus if you have proficiency in that save.",
  },
  {
    id: "deathSavingThrow",
    phrase: "death saving throw",
    patterns: [/\bdeath saving throws?\b/i],
    description: "At 0 hit points, roll a d10 each turn: 10 or higher you get back up, 9 or lower you take damage. Three successes and you stabilize; three failures and you die.",
  },
  {
    id: "abilityCheck",
    phrase: "ability check",
    patterns: [/\bability checks?\b/i],
    description: "A roll to see whether you succeed at something, using one ability: STR for Athletics, DEX for Stealth, WIS for Perception, and so on.",
  },
  {
    id: "spellSaveDc",
    phrase: "spell save DC",
    patterns: [/\bspell save DC\b/i],
    description: "The number you roll against to resist one of your spells. It is 8 plus your proficiency bonus plus your spellcasting ability modifier.",
  },
  {
    id: "armorClass",
    phrase: "armor class",
    patterns: [/\barmor class\b/i],
    description: "How hard you are to hit, written as AC. An attack hits when the total of the d20, your attack bonus, is equal to or higher than the target's AC.",
  },
  {
    id: "attackRoll",
    phrase: "attack roll",
    patterns: [/\battack rolls?\b/i],
    description: "A roll to hit. Roll a d20, add your attack bonus, and beat the target's Armor Class.",
  },
  {
    id: "critical",
    phrase: "critical hit",
    patterns: [/\bcritical hits?\b/i, /\bcritical\b/i],
    description: "Rolling a natural 20 on an attack. Your damage dice are all doubled - it never doubles the modifier.",
  },
  {
    id: "hitPoints",
    phrase: "hit points",
    patterns: [/\bhit points\b/i],
    description: "How much damage you can take before going to 0. Roll your hit die plus your Constitution modifier for each level.",
  },
  {
    id: "disadvantage",
    phrase: "disadvantage",
    patterns: [/\bdisadvantage\b/i],
    description: "Roll two d20 and take the lower. You get it when something says so; you can never choose it.",
  },
  {
    id: "advantage",
    phrase: "advantage",
    patterns: [/\badvantage\b/i],
    description: "Roll two d20 and take the higher. You get it when something says so; you can never choose it.",
  },
  {
    id: "initiative",
    phrase: "initiative",
    patterns: [/\binitiative\b/i],
    description: "The roll that sets turn order. Roll a d20, add your Dexterity modifier, and higher acts first.",
  },
  {
    id: "concentration",
    phrase: "concentration",
    patterns: [/\bconcentrat(?:e|ion|ing)\b/i],
    description: "Holding a spell in mind. You can hold one thing at a time, and taking damage can force you to drop it - see the concentration rules for your spellcasting ability.",
  },
  {
    id: "expertise",
    phrase: "expertise",
    patterns: [/\bexpertise\b/i],
    description: "Doubling your proficiency bonus on a particular skill or tool. Added on top of proficiency, not instead of it.",
  },
  {
    id: "proficient",
    phrase: "proficient",
    patterns: [/\bproficient\b/i],
    description: "Trained in something, so your rolls with it add your proficiency bonus. The opposite of untrained.",
  },
  {
    id: "trainedIn",
    phrase: "trained in",
    patterns: [/\btrained in\b/i],
    description: "Practice at something. You add your proficiency bonus to rolls that use it.",
  },
  {
    id: "training",
    phrase: "training",
    patterns: [/\btraining\b/i],
    description: "Practice at something. You add your proficiency bonus to rolls that use it.",
  },
  {
    id: "proficiency",
    phrase: "proficiency",
    patterns: [/\bproficienc(?:y|ies)\b/i],
    description: "Being trained in something. You add your proficiency bonus to rolls that use it - attacks, saving throws, checks - and it is the reason a wizard's cantrip hits harder than a fighter's.",
  },
  {
    id: "modifier",
    phrase: "modifier",
    patterns: [/\bmodifier\b/i],
    description: "The number you add to a roll for one ability, worked out from its score: 10-11 is +0, 12-13 is +1, 14-15 is +2, and so on down and up. You never set it yourself.",
  },
  {
    id: "darkvision",
    phrase: "darkvision",
    patterns: [/\bdarkvision\b/i],
    description: "You see in dim light as if it were bright light, and in darkness out to the given range as if it were dim light. Colours are dim and you cannot make out fine detail.",
  },
  {
    id: "resistance",
    phrase: "resistance",
    patterns: [/\bresistances?\b/i],
    description: "You take half damage from this, rounded down. Resistance and immunity never stack - take the one that halves it most.",
  },
  {
    id: "immunity",
    phrase: "immunity",
    patterns: [/\bimmunities\b/i, /\bimmunity\b/i],
    description: "You take no damage from this at all. Immunity beats resistance.",
  },
  {
    id: "exhaustion",
    phrase: "exhaustion",
    patterns: [/\bexhaustion\b/i],
    description: "Six levels of weariness, each worse than the last. A character drops to 6 hit points at levels 2 and 5, and their speed is halved.",
  },

  // --- Conditions ------------------------------------------------------------
  ...[
    ["incapacitated", "You cannot take actions or reactions, and cannot concentrate or speak. An incapacitated creature is still conscious."],
    ["paralyzed", "You cannot move or speak, fail every STR and DEX saving throw, and take advantage on attack rolls against you. Hits land within 5 feet as critical hits."],
    ["unconscious", "You are incapacitated, unaware, and prone, and you cannot move or speak. Hits against you within 5 feet are critical hits."],
    ["invisible", "You cannot be seen without magic. Attack rolls against you have disadvantage, and your attacks have advantage."],
    ["petrified", "You are a statue, unconscious, and cannot be harmed or healed. Any damage to the petrified creature breaks it."],
    ["restrained", "Your speed is 0, your attacks and Dexterity saving throws have disadvantage, and your attacks against anyone other than the restrainer have disadvantage."],
    ["frightened", "A frightened creature has disadvantage on checks and rolls while the source is in sight, and cannot willingly move closer to it."],
    ["grappled", "A grappled creature has speed 0, cannot benefit from any bonus to speed, and has disadvantage on attack rolls against anything but the grappler."],
    ["poisoned", "You have disadvantage on attack rolls and ability checks. Being poisoned by a substance is a separate thing from this condition."],
    ["deafened", "You cannot hear and fail any check that needs hearing. Deafened creatures are unaffected by ordinary sound."],
    ["blinded", "You cannot see, and automatically fail any check that needs sight. Blinded creatures are unaffected by ordinary light and cannot be targeted by spells that require a clear path to you."],
    ["charmed", "A charmed creature treats the charmer as a friendly ally and cannot willingly attack them. It has advantage on saving throws against being charmed."],
    ["stunned", "You are incapacitated, cannot move, and speak only falteringly. Attack rolls against you have advantage, and melee attacks against you within 5 feet are critical hits."],
    ["prone", "You can only crawl or stand up on your turn, and your attacks have disadvantage while prone. Ranged attacks against you have advantage."],
  ].map(([id, description]) => ({
    id,
    // Longest form this condition is written in, for the ordering below.
    phrase: id,
    patterns: [new RegExp(`\\b${id}\\b`, "i")],
    description,
  })),

  // --- Damage types ----------------------------------------------------------
  // Capitalised on its own, or lowercase immediately before "damage".
  ...[
    ["acid", "Corrosive damage. Often ignores armour, and often leaves lingering acid behind."],
    ["bludgeoning", "Damage from being hit by something blunt - a club, a falling rock. Half damage while you wear heavy armour, if you have any."],
    ["cold", "Freezing damage. Often costs hit points on a failed save and leaves you slowed."],
    ["fire", "Burning damage. Often ignites things, and often hurts you for being close to it."],
    ["force", "Damage from pure magical pressure - a thunderwave, a magical push. Nothing to grab hold of and no resistance from armour."],
    ["lightning", "Electric shock. Often knocks you out of your reaction and leaves you stunned on a failed save."],
    ["necrotic", "Draining, withering damage that saps life away. Often drains hit points on a failed save rather than dealing them outright."],
    ["piercing", "Damage from something sharp and thin - a dagger, a spear, a arrow."],
    ["poison", "Poisoned damage. Often from a poisoned weapon or a venomous creature, and often has a lingering effect."],
    ["psychic", "Damage to the mind. Some forms blind, deafen, or confuse rather than wound, and often ignores Resistance."],
    ["radiant", "Glowing, searing damage. Usually light or fire in nature, and is what radiant defences such as Halfling resistance are for."],
    ["slashing", "Damage from something drawn across you - a blade, claws, a falling blade."],
    ["thunder", "Loud, concussive damage. Often knocks you prone and deafens you on a failed save."],
  ].map(([id, description]) => ({
    id: `${id}Damage`,
    // "necrotic damage" is the longer surface form and sorts first.
    phrase: `${id} damage`,
    patterns: [
      new RegExp(`\\b${id} damage\\b`, "i"),
      new RegExp(`\\b${id.charAt(0).toUpperCase()}${id.slice(1)}\\b(?!\\s+[A-Z])`),
    ],
    description,
  })),
];

/** `{ [id]: { id, description } }` — the glossary keyed the way the DOM
 *  layer looks terms up. */
export const GAMEPLAY_TERM_GLOSSARY = Object.fromEntries(
  GAMEPLAY_TERMS.map((entry) => [entry.id, entry])
);

/** One combined matcher, longest phrase first. Each alternative becomes
 *  exactly one capture group (the patterns themselves use only
 *  non-capturing groups), which is how a match maps back to a glossary id.
 *
 *  The sort key is the entry's declared `phrase`, NOT the pattern source:
 *  regex length and match length disagree constantly
 *  (`proficienc(?:y|ies)` is longer than `proficiency bonus` and matches
 *  less), and sorting on the source silently let the short patterns win. */
const GAMEPLAY_TERM_INDEX = (() => {
  const alts = [];
  const ids = [];
  const weights = [];
  GAMEPLAY_TERMS.forEach((entry) => {
    entry.patterns.forEach((pattern) => {
      alts.push(pattern.source);
      ids.push(entry.id);
      weights.push(String(entry.phrase || entry.id).length);
    });
  });
  const order = alts
    .map((source, i) => [source, i])
    .sort((a, b) => weights[b[1]] - weights[a[1]] || a[1] - b[1]);
  return {
    re: new RegExp(order.map(([source]) => `(${source})`).join("|"), "gi"),
    ids: order.map(([, i]) => ids[i]),
  };
})();

/** Tooltip text for a gameplay-term id, or null when unknown. Pure. */
export function gameplayTermTooltip(id) {
  const entry = GAMEPLAY_TERM_GLOSSARY[id];
  return entry ? entry.description : null;
}

/** Splits display text into plain runs and glossary runs for tooltips:
 *  `[{ text } | { term, id, description }]`. The same shape
 *  splitAbilityTokens produces, so a caller building rich text handles
 *  both the same way. Matches word-boundary and never inside a longer
 *  word, so "forceful" is not a Force damage type. Pure. */
export function splitGameplayTerms(text) {
  const src = String(text ?? "");
  const out = [];
  let last = 0;
  GAMEPLAY_TERM_INDEX.re.lastIndex = 0;
  let m;
  while ((m = GAMEPLAY_TERM_INDEX.re.exec(src)) !== null) {
    // Which alternative matched? Exactly one group participates, and the
    // index of that group is its position in the alternation.
    let picked = null;
    for (let g = 1; g < m.length; g += 1) {
      if (m[g] === undefined) continue;
      picked = GAMEPLAY_TERM_INDEX.ids[g - 1];
      break;
    }
    if (!picked) continue;
    if (m.index > last) out.push({ text: src.slice(last, m.index) });
    out.push({ term: m[0], id: picked, description: GAMEPLAY_TERM_GLOSSARY[picked].description });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out;
}

/** First sentence of a longer text, capped — keeps picker bullets brief
 *  without trailing off mid-thought: a sentence boundary inside the
 *  cap wins; otherwise the whole first sentence (up to 2× cap) rather
 *  than a word-cut fragment. The match is anchored at the start, so a
 *  text with no early boundary (e.g. clauses joined by semicolons)
 *  can never produce a mid-string or mid-word fragment. Input is
 *  humanized first, so truncation decisions land on the final text. */
export function briefDescription(text, max = 140) {
  const flat = humanizeGameText(String(text || "").replace(/\s+/g, " ").trim());
  if (!flat) return "";
  const m = flat.match(new RegExp(`^(.{1,${max}}?[.!?])(\\s|$)`));
  if (m) return m[1].trim();
  const firstEnd = flat.search(/[.!?](\s|$)/);
  if (firstEnd !== -1 && firstEnd + 1 <= max * 2) return flat.slice(0, firstEnd + 1).trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trim()}…`;
}

function abilityIdFor(mod, abilityIds = []) {
  return abilityIds.find((id) => mod.targetFieldId === `${id}Score`) || null;
}

function isProfGrant(mod) {
  // Saving-throw grants have their own bucket (full-name "Saving
  // Throws" line) — they never count as plain proficiency grants.
  if (/SaveProf$/.test(mod.targetFieldId || "")) return false;
  return mod.op === "grant" && /Prof$/.test(mod.targetFieldId || "") && !/Score$/.test(mod.targetFieldId || "");
}

/** Spells a subclass bundle currently grants (level-gated `addItem`
 *  modifiers into Spells Known), deduped in data order. The display
 *  substitutes these for the "{spells}" token in auto-spell summaries
 *  (domain/oath templates), so the shown list is computed from
 *  individual grants — never a full tier list. Pure. */
export function currentSpellsFor(bundle, level = Infinity) {
  const seen = new Set();
  const out = [];
  for (const mod of (bundle?.statModifiers || [])) {
    if (mod?.op !== "addItem" || mod?.targetFieldId !== "spellsKnown") continue;
    if (mod.minLevel && mod.minLevel > level) continue;
    const name = String(mod.value || "").trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** A grant summary with its "{spells}" token resolved (auto-spell
 *  templates only — anything else passes through untouched). Pure. */
export function resolveSpellSummary(summary, bundle, level = Infinity) {
  const text = String(summary ?? "");
  if (!text.includes("{spells}")) return text;
  const spells = currentSpellsFor(bundle, level);
  return text.replace("{spells}", spells.length ? spells.join(", ") : "(none currently granted)");
}

/** Whether a grant carries an auto-spell template (its description
 *  holds the "{spells}" token substituted at display from the
 *  bundle's own level-gated spell grants). Pure. */
export function isAutoSpellGrant(grant) {
  return String(grant?.description || "").includes("{spells}");
}

/** The spells this bundle grants at `level`, as one readable line — or
 *  null when it grants none, or none yet.
 *
 *  A race that hands you spells splits them by level in the data
 *  (Tiefling: Thaumaturgy at 1, Hellish Rebuke at 3, Darkness at 5), but
 *  the trait's own prose only names the cantrip, so the row used to show
 *  one spell and silently drop the two a level-5 character actually has.
 *  This is the mechanical list, filtered to the level in hand, which is
 *  what makes it update as the character levels: the caller passes
 *  `state.level` and the line grows.
 *
 *  Cantrips are not separated from leveled spells here: the grant list
 *  already has them in the order the trait grants them, and splitting
 *  them would imply a rule this data doesn't carry. Pure. */
export function grantedSpellsLine(bundle, level = Infinity) {
  const mods = (bundle?.statModifiers || []).filter(
    (m) => m?.op === "addItem" && m?.targetFieldId === "spellsKnown"
      && (!m.minLevel || m.minLevel <= level)
  );
  const names = [...new Set(mods.map((m) => String(m.value || "").trim()).filter(Boolean))];
  if (!names.length) return null;
  return `Spells: ${names.join(", ")}`;
}

/** Name/description parts for an auto-spell grant with its token
 *  resolved: the sourced template's own prefix ("Domain Spells")
 *  becomes the name, the rest the description — both verbatim from
 *  the summaries file, never rewritten. Pure. */
export function autoSpellParts(grant, bundle, level = Infinity) {
  const resolved = resolveSpellSummary(grant?.description || "", bundle, level);
  const cut = resolved.indexOf(": ");
  if (cut <= 0) return { name: grant?.name || "Spells", description: resolved };
  return { name: resolved.slice(0, cut), description: resolved.slice(cut + 2) };
}

/** A saving-throw grant (`<abilityId>SaveProf`) — rendered with the
 *  full ability name ("Saving Throws: Strength, Constitution"), never
 *  the raw field id. Pure. */
function isSaveGrant(mod) {
  return mod.op === "grant" && /SaveProf$/.test(mod.targetFieldId || "");
}

/** Full ability name for a saving-throw grant's target, e.g.
 *  "strSaveProf" → "Strength". Prefers the caller's `abilities`
 *  vocabulary, then the built-in glossary; unknown ids are prettified
 *  (never echoed raw, so generated picker text contains no field ids). */
function saveAbilityName(targetFieldId, abilities = []) {
  const m = /^(.*)SaveProf$/.exec(targetFieldId || "");
  const raw = (m ? m[1] : String(targetFieldId || "")).toLowerCase();
  const fromDeps = (abilities || []).find((a) => String(a.id || "").toLowerCase() === raw);
  if (fromDeps?.label) return fromDeps.label;
  if (ABILITY_GLOSSARY[raw]) return ABILITY_GLOSSARY[raw].name;
  const pretty = raw.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[^a-z0-9 ]/gi, " ").trim();
  return pretty ? pretty.charAt(0).toUpperCase() + pretty.slice(1) : "Unknown";
}

/** Canonical ability order for the Ability Score Increases list —
 *  STR, DEX, CON, INT, WIS, CHA. Abilities with no boost are omitted,
 *  never blank-filled. */
const SCORE_DISPLAY_ORDER = ["str", "dex", "con", "int", "wis", "cha"];

/** Categorized, bulleted mechanics for a picker row — the structured
 *  replacement for the one-line mechanicsPreviewFor on Race/Class/
 *  Background/Subclass rows. Fixed category order; a category with
 *  nothing in it is omitted outright.
 *
 *  Races read: Racial Traits (fixed order — Speed, then Darkvision,
 * then Resistances, then any remaining traits) → Ability Score
 * Increases (STR → DEX → CON → INT → WIS → CHA) → Proficiencies →
 * Innate Abilities. The three fixed trait slots always appear with
 * standard defaults when empty (30 ft. walking speed, no darkvision,
 * no resistances) — EXCEPT on a parent race, which owns a `subrace`
 * picker and therefore has no traits of its own to default. A parent
 * says its traits come from the subrace instead, because the defaults
 * would contradict every subrace it has (see the slot block below).
 *
 *  Classes read: "Level 1 Class Features" (hit lines lead, then every
 *  other current feature) → "Class Proficiencies" ("Saving Throws:
 *  <full names>" first, then skill proficiencies, proficiency notes
 *  such as non-metal shield restrictions, then armor/weapon/tool
 *  tag groups) → Ability Score Increases. Shared movement/senses/
 *  resistances and spell lists ("Learn the X spell" grants and
 *  Spellcasting/Pact Magic features, which the Spells step covers)
 *  are omitted outright — every class shares them, so they carry no
 *  information on a picker row.
 *
 *  Backgrounds read: "Background Proficiencies" (skill proficiencies,
 *  proficiency notes, tool/language tag groups) → "Starting
 *  Equipment" (the equipment grant split into structured items) →
 *  "Background Feature" (the named feature) → Ability Score
 *  Increases. The Racial Traits section is omitted — backgrounds have
 *  no innate speed/senses/resistances of their own, so the section
 *  would only ever restate proficiencies.
 *
 *  "Racial Traits" and "Innate Abilities" never head a class or
 *  background section (audit systemic fix 1); saving throws always
 *  render with full ability names, never raw field ids (fix 2).
 *  Returns [{ title, items: [string] }]. Only grants at or below
 *  `level` are listed (default Infinity = everything, for contexts
 *  with no level yet); label and detail always join with a colon. */
/** One section's display lines, with anything that only arrives above
 *  level 1 labelled "(Level N)" and moved below the lines a character
 *  starts with, lowest level first.
 *
 *  This used to be left unsaid. A level-20 character's race row listed a
 *  Darkvision that improves at 5 and a speed bump at 6 right among the
 *  things it has had since character creation, with nothing to say which
 *  was which - so a player could not tell what their character starts
 *  with from what it grew into. Labelling them and stacking them lowest
 *  first makes the upgrades read as the ladder they are.
 *
 *  A level-1 character is unaffected: `atLevel` has already dropped
 *  everything above 1, so there is nothing left to label. Plain strings
 *  are accepted and pass through unchanged. Pure. */
export function leveledOrder(rows = []) {
  const atStart = [];
  const later = [];
  (rows || []).forEach((row) => {
    const isRow = row && typeof row === "object";
    const text = isRow ? row.text : row;
    const minLevel = isRow ? row.minLevel : null;
    if (Number.isFinite(minLevel) && minLevel > 1) later.push({ text, minLevel });
    else atStart.push(text);
  });
  later.sort((a, b) => a.minLevel - b.minLevel);
  return [...atStart, ...later.map((row) => `(Level ${row.minLevel}) ${row.text}`)];
}

export function mechanicsBulletsFor(bundle, level = Infinity, deps = {}) {
  if (!bundle) return [];
  const { abilityIds = [], abilities = [], skills = [], resolveLabel = null, backgroundDisplay = false, classDisplay = false, subclassDisplay = false, includedPacks = null } = deps;
  const summarize = (m) => statModifierSummary(m, { abilityIds, abilities, skills, resolveLabel });
  const tagLabel = (fieldId) => TAG_FIELD_LABELS[fieldId]
    || (typeof resolveLabel === "function" && resolveLabel(fieldId))
    || fieldId;
  // No "at level N" annotation on anything above the passed level: those
  // grants never reach the bullets at all (atLevel below), because a
  // character cannot use what it has not reached yet. What DOES get
  // annotated is a grant the character has already unlocked - see
  // leveledOrder, which labels it and sinks it below the level-1 lines.
  // Pack-gated optional grants (Tasha's) likewise never reach bullets when
  // their source book is excluded.
  const atLevel = (item) => (!item.minLevel || item.minLevel <= level) && packAllowsLocal(item, includedPacks);

  // Every display line carries the level it unlocks at, or null for one
  // you start with. That is what lets leveledOrder label the late ones
  // and sink them below the rest instead of leaving a level-9 feature
  // sitting indistinguishable among the ones a level-1 character has.
  const line = (text, minLevel) => ({ text, minLevel: Number.isFinite(minLevel) ? minLevel : null });

  const otherTraits = [];
  const hitBits = [];
  const speedBits = [];
  const darkvisionBits = [];
  const resistanceBits = [];
  const scoreMods = [];
  const profs = [];
  const innate = [];
  // Class/background/subclass buckets (race path keeps the legacy buckets above).
  const saveRows = [];
  const classFeatures = [];
  const classProfLines = [];
  const bgProfLines = [];
  const bgEquipment = [];
  const bgFeatures = [];
  const subFeatures = [];
  const subProfLines = [];

  // A proficiency-note grant ("Tool Proficiencies (note)", "Armor
  // Proficiencies (note)") belongs with proficiencies, never with
  // features, on class/background rows.
  const isProficiencyNote = (grant) => /proficienc/i.test(grant?.name || "");
  const isEquipmentGrant = (grant) => /^starting equipment$/i.test((grant?.name || "").trim());

  /** A grant's display name with the internal "(note)" marker removed.
   *
   *  "(note)" is a data convention that says "this grant is a note about
   *  proficiencies, route it to the proficiencies list" - it is how
   *  isProficiencyNote above recognises these without a separate flag. It
   *  is not part of the name, and a player should never see it: it was
   *  reaching them as "Tool Proficiencies (note): Vehicles (land)", which
   *  reads as a placeholder that was never filled in. The note itself is
   *  real and stays - Folk Hero's vehicles (land) and Sailor's vehicles
   *  (water) are genuine grants, not stand-ins.
   *
   *  Matching is on the raw name, so nothing about the routing changes;
   *  only the label the player reads is cleaned. */
  const displayGrantName = (raw) => String(raw || "").replace(/\s*\(\s*note\s*\)\s*$/i, "").trim();
  const classHitDie = (() => {
    if (!classDisplay) return null;
    const hitDieGrant = (bundle.featureGrants || []).find((g) => /^hit die$/i.test(String(g?.name || "").trim()));
    const match = String(hitDieGrant?.description || "").match(/d(\d+)/i);
    return match ? Number(match[1]) : null;
  })();

  // Class/background/subclass rows show the whole current
  // description: their texts are concise replacements written to be
  // read whole (audit systemic fixes), so sentence-snipping them
  // would shorten sourced wording. Race rows keep the legacy
  // first-sentence brief.
  //
  // Both read `levelGatedText` first, so a sentence the rules gate above
  // the level in hand is dropped before anything is shortened - otherwise
  // the brief would happily quote the one sentence about a level 5 unlock
  // on a level 1 character.
  const detailFor = (description, caveat = null) => {
    const flat = humanizeGameText(String(levelGatedText(description, level) || "").replace(/\s+/g, " ").trim());
    if (!flat) return caveat ? ` (${caveat})` : "";
    if (classDisplay || backgroundDisplay || subclassDisplay) {
      return caveat ? `${flat} (${caveat})` : flat;
    }
    const brief = briefDescription(flat, 120);
    return caveat ? `${brief} (${caveat})` : brief;
  };

  const tagsByField = new Map();
  for (const mod of (bundle.statModifiers || []).filter(atLevel)) {
    if (mod.op === "grantTag") {
      if (!tagsByField.has(mod.targetFieldId)) tagsByField.set(mod.targetFieldId, []);
      if (mod.value) tagsByField.get(mod.targetFieldId).push(mod.value, mod.minLevel);
    } else if (abilityIdFor(mod, abilityIds)) {
      scoreMods.push(mod);
    } else if (isSaveGrant(mod)) {
      saveRows.push(line(saveAbilityName(mod.targetFieldId, abilities), mod.minLevel));
    } else if (isProfGrant(mod)) {
      profs.push(line(summarize(mod), mod.minLevel));
    } else if (mod.op === "addItem") {
      // Class rows skip spell access entirely (see classDisplay) —
      // the Spells step, not the picker row, covers it. Subclass rows
      // skip Spells-Known grants too — the computed Domain/Oath line
      // already lists the currently-granted spells, so per-spell lines
      // would duplicate it.
      // Skip a redundant "Learn the X spell" line when a feature grant
      // already describes that same spell (e.g. Tiefling Infernal Legacy
      // already says "You know the Thaumaturgy cantrip").
      if (subclassDisplay && mod.targetFieldId === "spellsKnown") {
        // Covered by the computed auto-spell line; nothing to add.
      } else if (subclassDisplay) {
        subFeatures.push(line(`Learn the ${mod.value} ${tagLabel(mod.targetFieldId)}`, mod.minLevel));
      } else if (!classDisplay) {
        const spellName = String(mod.value || "").trim().toLowerCase();
        const described = (bundle.featureGrants || []).some((g) =>
          String(g?.description || "").toLowerCase().includes(spellName) && spellName
        );
        if (!described) innate.push(line(`Learn the ${mod.value} spell`, mod.minLevel));
      }
    } else if (["add", "subtract", "multiply", "set"].includes(mod.op)) {
      if (subclassDisplay) subFeatures.push(line(summarize(mod), mod.minLevel));
      else otherTraits.push(line(summarize(mod), mod.minLevel));
    }
  }
  for (const [fieldId, values] of tagsByField) {
    const unique = [...new Set(values.filter((v, i) => i % 2 === 0))];
    if (!unique.length) continue;
    const line_ = `${tagLabel(fieldId)}: ${unique.join(", ")}`;
    // The line stands for every grant folded into it, so it unlocks at
    // the EARLIEST of them - a languages line that arrives partly at 3
    // still reads as something a level-1 character has.
    const firstLevel = values.filter((v, i) => i % 2 === 1)
      .filter((v) => Number.isFinite(v) && v > 1);
    const minLevel = firstLevel.length ? Math.min(...firstLevel) : null;
    // Class/background/subclass rows shelve tag proficiencies into
    // their own proficiency sections (see the assembly below); race
    // rows keep the legacy behavior of listing them among the traits.
    if (classDisplay) classProfLines.push(line(line_, minLevel));
    else if (backgroundDisplay) bgProfLines.push(line(line_, minLevel));
    else if (subclassDisplay) subProfLines.push(line(line_, minLevel));
    else otherTraits.push(line(line_, minLevel));
  }
  for (const grant of (bundle.featureGrants || []).filter(atLevel)) {
    const name = (grant.name || "").trim();
    if (!name) continue;
    // Unsourced subclass grants are omitted from player-facing display
    // until sourced (audit 2b) — traceable via docs/subclass-gaps.md.
    if (grant.unsourced) continue;
    // A grant whose whole text sits above the level in hand says nothing
    // this character has yet, so the line goes rather than rendering as a
    // bare name with no detail beside it.
    const description = levelGatedText(grant.description, level);
    if (description === null) continue;
    // Class rows skip shared movement/senses/resistances and spell
    // access (see classDisplay) — hit lines are collected below for
    // the head of Level 1 Class Features instead.
    if (classDisplay && (/^speed$/i.test(name) || isDarkvisionGrant(grant) || isResistanceGrant(grant))) continue;
    if (classDisplay && /spellcasting|pact magic|spell lists?|spells known|spell slots|ritual casting/i.test(name)) continue;
    // Proficiency notes and equipment split out on class/background
    // rows; race rows keep the legacy single-list behavior.
    if ((classDisplay || backgroundDisplay) && isProficiencyNote(grant)) {
      const why = detailFor(grant.description, grant.caveat);
      const note = `${displayGrantName(name)}${why ? `: ${why}` : ""}`;
      if (classDisplay) classProfLines.push(line(note, grant.minLevel));
      else bgProfLines.push(line(note, grant.minLevel));
      continue;
    }
    if (backgroundDisplay && isEquipmentGrant(grant)) {
      // Structured items, not one long sentence: the compiled text
      // joins pieces with semicolons, so split them back apart.
      const pieces = String(description).split(";").map((s) => s.trim()).filter(Boolean);
      if (pieces.length) pieces.forEach((piece) => bgEquipment.push(line(piece, grant.minLevel)));
      else bgEquipment.push(line(String(description).trim(), grant.minLevel));
      continue;
    }
    if (backgroundDisplay) {
      const why = detailFor(grant.description, grant.caveat);
      bgFeatures.push(line(`${displayGrantName(name)}${why ? `: ${why}` : ""}`, grant.minLevel));
      continue;
    }
    if (subclassDisplay) {
      // One concise summary per current feature (audit 2c); auto-spell
      // templates resolve to the currently-granted spells only.
      // Proficiency notes still read as proficiencies.
      if (isProficiencyNote(grant)) {
        const why = detailFor(grant.description, grant.caveat);
        subProfLines.push(line(`${displayGrantName(name)}${why ? `: ${why}` : ""}`, grant.minLevel));
      } else if (isAutoSpellGrant(grant)) {
        subFeatures.push(line(resolveSpellSummary(description, bundle, level), grant.minLevel));
      } else {
        const why = detailFor(grant.description, grant.caveat);
        subFeatures.push(line(`${displayGrantName(name)}${why ? `: ${why}` : ""}`, grant.minLevel));
      }
      continue;
    }
    if (/^speed$/i.test(name)) {
      speedBits.push(line(featureBit(grant), grant.minLevel));
    } else if (isDarkvisionGrant(grant)) {
      darkvisionBits.push(line(featureBit(grant), grant.minLevel));
    } else if (isResistanceGrant(grant)) {
      const why = briefDescription(description, 120);
      resistanceBits.push(line(`${displayGrantName(name)}${why ? `: ${why}` : ""}`, grant.minLevel));
    } else if (classDisplay && /^hit points/i.test(name)) {
      const why = detailFor(grant.description, grant.caveat);
      const first = why || (classHitDie ? `${classHitDie} + your Constitution modifier` : "");
      const later = classHitDie ? `; later levels add 1d${classHitDie} (or fixed average ${Math.floor(classHitDie / 2) + 1}) + your Constitution modifier` : "";
      hitBits.push(line(`Hit Points${first ? `: Level 1 gives ${first}` : ""}${later}`, grant.minLevel));
    } else if (classDisplay && /^hit die/i.test(name)) {
      const why = detailFor(grant.description, grant.caveat);
      hitBits.push(line(`${displayGrantName(name)}${why ? `: ${why}` : ""}`, grant.minLevel));
    } else {
      const why = detailFor(grant.description, grant.caveat);
      if (classDisplay) classFeatures.push(line(`${displayGrantName(name)}${why ? `: ${why}` : ""}`, grant.minLevel));
      else innate.push(line(`${displayGrantName(name)}${why ? `: ${why}` : ""}`, grant.minLevel));
    }
  }
  // A PARENT race - one that owns a `subrace` picker, so its subraces
  // supply the real traits - must not be given the standard-default slots
  // below. Those defaults are a sensible floor for a finished race (every
  // race has a speed) and a lie for a container: Genasi printed "Speed: 30
  // feet / Darkvision: none / Resistances: none" while all four of its
  // subraces have darkvision 60 ft, three have a resistance, and Air Genasi
  // is 35 ft. The row stated, as fact, three things every one of its own
  // children contradicts.
  //
  // So a parent says where its traits come from instead. It keeps whatever it
  // genuinely grants itself - the Genasi flexible ASI is shared by all four
  // heritages and belongs here - and only the invented slots are dropped.
  const isParentRace = (bundle.choiceGroups || []).some((g) => g && g.subrace === true);

  // A "(override)" Darkvision replaces the base range rather than
  // listing alongside it (today only Duergar has both). The three
  // fixed slots always appear outside classDisplay/backgroundDisplay —
  // a race with no value shows the standard default (30 ft. walking
  // speed, no darkvision, no resistances) instead of skipping the
  // line. Class rows lead with hit lines instead (see classDisplay
  // above); background rows omit the whole section (backgrounds have
  // no speed/senses of their own).
  if (!classDisplay && !backgroundDisplay && !isParentRace) {
    if (speedBits.length === 0) speedBits.push(line("Speed: 30 feet"));
    if (darkvisionBits.length === 0) darkvisionBits.push(line("Darkvision: none"));
    if (resistanceBits.length === 0) resistanceBits.push(line("Resistances: none"));
  }
  const traits = [
    ...hitBits,
    ...speedBits,
    ...(darkvisionBits.length > 1 ? darkvisionBits.slice(-1) : darkvisionBits),
    ...resistanceBits,
    ...otherTraits,
  ];
  // Last, so it reads as the answer to everything above it rather than as one
  // more trait among them.
  if (isParentRace) traits.push(line("Traits, speed and senses come from your subrace."));

  const scoreRank = (mod) => {
    const id = abilityIdFor(mod, abilityIds);
    const canonical = SCORE_DISPLAY_ORDER.indexOf(id);
    if (canonical !== -1) return canonical;
    const fromDeps = (abilityIds || []).indexOf(id);
    return fromDeps !== -1
      ? SCORE_DISPLAY_ORDER.length + fromDeps
      : SCORE_DISPLAY_ORDER.length + (abilityIds || []).length;
  };
  const scores = scoreMods
    .map((mod, i) => ({ mod, i }))
    .sort((a, b) => scoreRank(a.mod) - scoreRank(b.mod) || a.i - b.i)
    .map(({ mod }) => line(summarize(mod), mod.minLevel));

  // Full-name saving-throw line, in bundle order without duplicates —
  // shared by every display below that has save grants to show. One line
  // standing for several grants unlocks at the earliest of them.
  const saveNames = [...new Set(saveRows.map((row) => row.text))];
  const saveLine = saveNames.length
    ? line(`Saving Throws: ${saveNames.join(", ")}`,
      saveRows.filter((row) => saveNames.includes(row.text)).map((row) => row.minLevel)
        .filter((v) => Number.isFinite(v) && v > 1).sort((a, b) => a - b)[0])
    : null;
  // The spells this bundle grants, filtered to `level`. Null when it
  // grants none, so a race with no innate spellcasting shows no Spells
  // section at all rather than an empty one.
  const spellsLine = grantedSpellsLine(bundle, level);

  const out = [];
  if (classDisplay) {
    const features = [...hitBits, ...otherTraits, ...classFeatures];
    if (features.length) out.push({ title: MECHANICS_TITLES.classFeatures, items: leveledOrder(features) });
    const classProfs = [...(saveLine ? [saveLine] : []), ...(profs.length ? [line(`Proficiencies: ${profs.map((r) => r.text).join(", ")}`)] : []), ...classProfLines];
    if (classProfs.length) out.push({ title: MECHANICS_TITLES.classProficiencies, items: leveledOrder(classProfs) });
    if (scores.length) out.push({ title: MECHANICS_TITLES.scores, items: leveledOrder(scores) });
  } else if (backgroundDisplay) {
    const bgProfs = [...(profs.length ? [line(`Proficiencies: ${profs.map((r) => r.text).join(", ")}`)] : []), ...bgProfLines];
    if (bgProfs.length) out.push({ title: MECHANICS_TITLES.bgProficiencies, items: leveledOrder(bgProfs) });
    if (bgEquipment.length) out.push({ title: MECHANICS_TITLES.bgEquipment, items: leveledOrder(bgEquipment) });
    if (bgFeatures.length) out.push({ title: MECHANICS_TITLES.bgFeature, items: leveledOrder(bgFeatures) });
    if (scores.length) out.push({ title: MECHANICS_TITLES.scores, items: leveledOrder(scores) });
  } else if (subclassDisplay) {
    // Subclass rows: one concise summary per current sourced feature
    // under the single "Subclass Features" heading (audit display
    // rules 1-2, 5); unsourced grants were filtered above. Longer
    // reference text, if any, lives in the row's expandable details
    // alongside these bullets.
    if (subFeatures.length) out.push({ title: MECHANICS_TITLES.subclassFeatures, items: leveledOrder(subFeatures) });
    const subProfs = [...(saveLine ? [saveLine] : []), ...(profs.length ? [line(`Proficiencies: ${profs.map((r) => r.text).join(", ")}`)] : []), ...subProfLines];
    if (subProfs.length) out.push({ title: MECHANICS_TITLES.proficiencies, items: leveledOrder(subProfs) });
    if (scores.length) out.push({ title: MECHANICS_TITLES.scores, items: leveledOrder(scores) });
  } else {
    // Races (and any display without a context flag): traits → scores →
    // innate. Stray save grants, if any, read as a traits line.
    //
    // Proficiencies and granted spells are NOT sections of their own here.
    // They were, and a Half-Elf made the player hunt across three headings
    // ("Racial Traits", "Proficiencies", "Spells") for one trait; they read
    // as lines of the same list everything else is in, which is also what
    // the class, background and subclass paths already do.
    const raceTraits = [...traits, ...(saveLine ? [saveLine] : [])];
    if (raceTraits.length) out.push({ title: MECHANICS_TITLES.traits, items: leveledOrder(raceTraits) });
    if (scores.length) out.push({ title: MECHANICS_TITLES.scores, items: leveledOrder(scores) });
    const innateAll = [
      ...innate,
      ...(profs.length ? [line(`Proficiencies: ${profs.map((r) => r.text).join(", ")}`)] : []),
      ...(spellsLine ? [line(spellsLine)] : []),
    ];
    if (innateAll.length) out.push({ title: MECHANICS_TITLES.innate, items: leveledOrder(innateAll) });
  }
  return out;
}

/**
 * Generate a plain-language "What this changes" summary for a bundle,
 * suitable for the wizard's picker rows. Only includes effects at or
 * below the given level. Returns an array of plain strings suitable
 * for rendering as bullet points or a compact list.
 * Pure — no side effects, no DOM.
 */
export function mechanicsSummaryForPicker(bundle, level = Infinity, deps = {}) {
  if (!bundle) return [];
  const sections = mechanicsBulletsFor(bundle, level, deps);
  if (!sections.length) return [];
  const lines = [];
  for (const section of sections) {
    for (const item of section.items) {
      lines.push(item);
    }
  }
  return lines;
}

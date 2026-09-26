// sheetMechanics.js
//
// Wizard/mechanics preview helpers extracted from customSheet.js.
// These were nested inside renderCustomSheet but only depend on their
// arguments — the one exception is statModifierLabel, which previously
// closed over resolveFieldById. It now takes an optional
// `resolveLabel` callback so the pure core stays testable; callers that
// have sheet state pass `(id) => resolveFieldById(id)?.label`.

export const CREATION_CHOICE_CATEGORIES = [
  { key: "spells", title: "Spells & Special Abilities", test: /spell|cantrip|invocation/i },
  { key: "languages", title: "Languages", test: /language/i },
  { key: "equipment", title: "Starting Equipment", test: /equipment|\bgear\b|weapon|armor|\bpack\b/i },
  { key: "feats", title: "Feats", test: /\bfeat\b/i },
  { key: "proficiencies", title: "Ability Proficiencies", test: null },
];

export function categorizeChoiceGroup(group) {
  const label = group?.label || "";
  const found = CREATION_CHOICE_CATEGORIES.find((cat) => cat.test && cat.test.test(label));
  return (found || CREATION_CHOICE_CATEGORIES[CREATION_CHOICE_CATEGORIES.length - 1]).key;
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

/** The preview's content bits for one bundle (collapsed, optionally
 *  minus page-common traits) — without the "+N more at higher
 *  levels" tail. */
export function previewBitsFor(bundle, level, { summarize = (m) => statModifierSummary(m), exclude = null } = {}) {
  if (!bundle) return [];
  let bits = [
    ...activeAtLevel(bundle.statModifiers || [], level).map((m) => summarize(m)),
    ...activeAtLevel(bundle.featureGrants || [], level).map((g) => featureBit(g)).filter(Boolean),
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
 *  target sections without duplicating literals. */
export const MECHANICS_TITLES = {
  traits: "Racial Traits",
  scores: "Ability Score Increases",
  proficiencies: "Proficiencies",
  innate: "Innate Abilities",
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
  return mod.op === "grant" && /Prof$/.test(mod.targetFieldId || "") && !/Score$/.test(mod.targetFieldId || "");
}

/** Canonical ability order for the Ability Score Increases list —
 *  STR, DEX, CON, INT, WIS, CHA. Abilities with no boost are omitted,
 *  never blank-filled. */
const SCORE_DISPLAY_ORDER = ["str", "dex", "con", "int", "wis", "cha"];

/** Categorized, bulleted mechanics for a picker row — the structured
 *  replacement for the one-line mechanicsPreviewFor on Race/Class/
 *  Background/Subclass rows. Fixed category order (traits →
 *  Ability Score Increases → Proficiencies → Innate Abilities); a
 *  category with nothing in it is omitted outright. The traits section
 *  is titled "Racial Traits", or "Class Traits" with the `classDisplay`
 *  dep. Inside Racial Traits the order is fixed too — Speed, then
 *  Darkvision, then Resistances, then any remaining traits (numeric
 *  modifiers and proficiency tag groups, in data order) — so every
 *  race reads the same way. Those three always appear: a race with no
 *  value for one shows the standard default instead (Speed: 30 feet,
 *  Darkvision: none, Resistances: none). A superseded Darkvision
 *  ("Senses (override)") replaces the base one rather than listing
 *  twice. Ability Score Increases always run
 *  STR → DEX → CON → INT → WIS → CHA, omitting unboosted abilities.
 *  With the `backgroundDisplay` dep, proficiency tag grants (tools,
 *  languages, armor, weapons) list under Innate Abilities instead of
 *  Racial Traits, and the Racial Traits section is omitted — backgrounds
 *  have no innate speed/senses/resistances of their own, so the section
 *  would only ever restate proficiencies.
 *  With the `classDisplay` dep, Speed/Darkvision/Resistances (and their
 *  defaults) are omitted outright — every class shares them, so they
 *  carry no information — as are spell lists ("Learn the X spell"
 *  grants and Spellcasting/Pact Magic features, which the Spells step
 *  covers). "Hit Die" and "Hit Points at 1st Level" lead the traits
 *  instead, since that's what a class picker most needs at a glance.
 *  Returns [{ title, items: [string] }]. Only grants at or below
 *  `level` are listed (default Infinity = everything, for contexts
 *  with no level yet); label and detail always join with a colon. */
export function mechanicsBulletsFor(bundle, level = Infinity, deps = {}) {
  if (!bundle) return [];
  const { abilityIds = [], abilities = [], skills = [], resolveLabel = null, backgroundDisplay = false, classDisplay = false } = deps;
  const summarize = (m) => statModifierSummary(m, { abilityIds, abilities, skills, resolveLabel });
  const tagLabel = (fieldId) => TAG_FIELD_LABELS[fieldId]
    || (typeof resolveLabel === "function" && resolveLabel(fieldId))
    || fieldId;
  // No "at level N" annotations anywhere: grants above the passed
  // level never reach the bullets at all (atLevel below), and grants
  // at or below it simply apply — players care what they get, not
  // when each piece kicked in.
  const atLevel = (item) => !item.minLevel || item.minLevel <= level;

  const otherTraits = [];
  const hitBits = [];
  const speedBits = [];
  const darkvisionBits = [];
  const resistanceBits = [];
  const scoreMods = [];
  const profs = [];
  const innate = [];

  const tagsByField = new Map();
  for (const mod of (bundle.statModifiers || []).filter(atLevel)) {
    if (mod.op === "grantTag") {
      if (!tagsByField.has(mod.targetFieldId)) tagsByField.set(mod.targetFieldId, []);
      if (mod.value) tagsByField.get(mod.targetFieldId).push(mod.value);
    } else if (abilityIdFor(mod, abilityIds)) {
      scoreMods.push(mod);
    } else if (isProfGrant(mod)) {
      profs.push(summarize(mod));
    } else if (mod.op === "addItem") {
      // Class rows skip spell access entirely (see classDisplay) —
      // the Spells step, not the picker row, covers it.
      // Skip a redundant "Learn the X spell" line when a feature grant
      // already describes that same spell (e.g. Tiefling Infernal Legacy
      // already says "You know the Thaumaturgy cantrip").
      if (!classDisplay) {
        const spellName = String(mod.value || "").trim().toLowerCase();
        const described = (bundle.featureGrants || []).some((g) =>
          String(g?.description || "").toLowerCase().includes(spellName) && spellName
        );
        if (!described) innate.push(`Learn the ${mod.value} spell`);
      }
    } else if (["add", "subtract", "multiply", "set"].includes(mod.op)) {
      otherTraits.push(summarize(mod));
    }
  }
  for (const [fieldId, values] of tagsByField) {
    const unique = [...new Set(values)];
    if (!unique.length) continue;
    const line = `${tagLabel(fieldId)}: ${unique.join(", ")}`;
    // Background rows show proficiencies as innate abilities, never
    // as racial traits (see backgroundDisplay above).
    if (backgroundDisplay) innate.push(line);
    else otherTraits.push(line);
  }
  for (const grant of (bundle.featureGrants || []).filter(atLevel)) {
    const name = (grant.name || "").trim();
    if (!name) continue;
    // Class rows skip shared movement/senses/resistances and spell
    // access (see classDisplay) — hit lines are collected below for
    // the head of Class Traits instead.
    if (classDisplay && (/^speed$/i.test(name) || isDarkvisionGrant(grant) || isResistanceGrant(grant))) continue;
    if (classDisplay && /spellcasting|pact magic|spell lists?|spells known|spell slots|ritual casting/i.test(name)) continue;
    if (/^speed$/i.test(name)) {
      speedBits.push(featureBit(grant));
    } else if (isDarkvisionGrant(grant)) {
      darkvisionBits.push(featureBit(grant));
    } else if (isResistanceGrant(grant)) {
      const why = briefDescription(grant.description, 120);
      resistanceBits.push(`${name}${why ? `: ${why}` : ""}`);
    } else if (classDisplay && /^hit (die|points)/i.test(name)) {
      const why = briefDescription(grant.description, 120);
      hitBits.push(`${name}${why ? `: ${why}` : ""}`);
    } else {
      const why = briefDescription(grant.description, 120);
      innate.push(`${name}${why ? `: ${why}` : ""}`);
    }
  }
  // A "(override)" Darkvision replaces the base range rather than
  // listing alongside it (today only Duergar has both). The three
  // fixed slots always appear outside classDisplay — a race with no
  // value shows the standard default (30 ft. walking speed, no
  // darkvision, no resistances) instead of skipping the line. Class
  // rows lead with hit lines instead (see classDisplay above).
  if (!classDisplay) {
    if (speedBits.length === 0) speedBits.push("Speed: 30 feet");
    if (darkvisionBits.length === 0) darkvisionBits.push("Darkvision: none");
    if (resistanceBits.length === 0) resistanceBits.push("Resistances: none");
  }
  const traits = [
    ...hitBits,
    ...speedBits,
    ...(darkvisionBits.length > 1 ? darkvisionBits.slice(-1) : darkvisionBits),
    ...resistanceBits,
    ...otherTraits,
  ];

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
    .map(({ mod }) => summarize(mod));

  const out = [];
  if (traits.length) out.push({ title: classDisplay ? "Class Traits" : "Racial Traits", items: traits });
  if (scores.length) out.push({ title: "Ability Score Increases", items: scores });
  if (profs.length) out.push({ title: "Proficiencies", items: [profs.join(", ")] });
  if (innate.length) out.push({ title: "Innate Abilities", items: innate });
  return out;
}

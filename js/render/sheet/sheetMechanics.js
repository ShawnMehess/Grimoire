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
  if (saveAbility) return `${saveAbility.label} Save`;
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
    const match = /(\d+\s*ft\.?)/i.exec(grant.description || "");
    if (match) return `Speed: ${match[1].replace(/\.$/, "").replace(/\s*ft$/i, " feet")}`;
  }
  if (/darkvision/i.test(name.trim())) {
    const match = /(\d+\s*ft\.?)/i.exec(grant.description || "");
    if (match) return `Darkvision: ${match[1].replace(/\.$/, "").replace(/\s*ft$/i, " feet")}`;
  }
  return name;
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

/** First sentence of a longer text, capped — keeps picker bullets brief
 *  without trailing off mid-thought: a sentence boundary inside the
 *  cap wins; otherwise the whole first sentence (up to 2× cap) rather
 *  than a word-cut fragment. */
export function briefDescription(text, max = 140) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const m = flat.match(new RegExp(`(.{1,${max}}?[.!?])(\\s|$)`));
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

/** Categorized, bulleted mechanics for a picker row — the structured
 *  replacement for the one-line mechanicsPreviewFor on Race/Class/
 *  Background/Subclass rows. Fixed category order (Racial Traits →
 *  Ability Score Increases → Proficiencies → Innate Abilities); a
 *  category with nothing in it is omitted outright.
 *  Returns [{ title, items: [string] }]. Only grants at or below
 *  `level` are listed (default Infinity = everything, for contexts
 *  with no level yet); label and detail always join with a colon. */
export function mechanicsBulletsFor(bundle, level = Infinity, deps = {}) {
  if (!bundle) return [];
  const { abilityIds = [], abilities = [], skills = [], resolveLabel = null } = deps;
  const summarize = (m) => statModifierSummary(m, { abilityIds, abilities, skills, resolveLabel });
  const tagLabel = (fieldId) => TAG_FIELD_LABELS[fieldId]
    || (typeof resolveLabel === "function" && resolveLabel(fieldId))
    || fieldId;
  const levelTag = (minLevel) => (Number.isFinite(minLevel) && minLevel > 1 ? ` (level ${minLevel})` : "");
  const atLevel = (item) => !item.minLevel || item.minLevel <= level;

  const traits = [];
  const scores = [];
  const profs = [];
  const innate = [];

  const tagsByField = new Map();
  for (const mod of (bundle.statModifiers || []).filter(atLevel)) {
    if (mod.op === "grantTag") {
      if (!tagsByField.has(mod.targetFieldId)) tagsByField.set(mod.targetFieldId, []);
      if (mod.value) tagsByField.get(mod.targetFieldId).push(mod.value);
    } else if (abilityIdFor(mod, abilityIds)) {
      scores.push(summarize(mod));
    } else if (isProfGrant(mod)) {
      profs.push(summarize(mod));
    } else if (mod.op === "addItem") {
      innate.push(`Learn the ${mod.value} spell${levelTag(mod.minLevel)}`);
    } else if (["add", "subtract", "multiply", "set"].includes(mod.op)) {
      traits.push(`${summarize(mod)}${levelTag(mod.minLevel)}`);
    }
  }
  for (const [fieldId, values] of tagsByField) {
    const unique = [...new Set(values)];
    if (unique.length) traits.push(`${tagLabel(fieldId)}: ${unique.join(", ")}`);
  }
  for (const grant of (bundle.featureGrants || []).filter(atLevel)) {
    const name = (grant.name || "").trim();
    if (!name) continue;
    if (/^speed$/i.test(name) || /darkvision/i.test(name)) {
      traits.push(`${featureBit(grant)}${levelTag(grant.minLevel)}`);
    } else {
      const why = briefDescription(grant.description, 120);
      innate.push(`${name}${why ? `: ${why}` : ""}${levelTag(grant.minLevel)}`);
    }
  }

  const out = [];
  if (traits.length) out.push({ title: "Racial Traits", items: traits });
  if (scores.length) out.push({ title: "Ability Score Increases", items: scores });
  if (profs.length) out.push({ title: "Proficiencies", items: [profs.join(", ")] });
  if (innate.length) out.push({ title: "Innate Abilities", items: innate });
  return out;
}

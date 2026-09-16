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
    case "add": return `${amount >= 0 ? "+" : ""}${amount} ${label}`;
    case "subtract": return `-${Math.abs(amount)} ${label}`;
    case "set": return `${label} = ${amount}`;
    case "multiply": return `${label} ×${amount}`;
    default: return label;
  }
}

/** See mechanicsPreviewFor in customSheet.js for the full contract:
 *  null = no bundle, message = flavor-only, otherwise "A · B · +N more". */
export function mechanicsPreviewFor(bundle, level, { summarize = (m) => statModifierSummary(m) } = {}) {
  if (!bundle) return null;
  const mods = bundle.statModifiers || [];
  const features = bundle.featureGrants || [];
  const activeMods = mods.filter((m) => !m.minLevel || m.minLevel <= level);
  const activeFeatures = features.filter((g) => !g.minLevel || g.minLevel <= level);
  const laterCount = (mods.length - activeMods.length) + (features.length - activeFeatures.length);
  const bits = [
    ...activeMods.map((m) => summarize(m)),
    ...activeFeatures.map((g) => g.name).filter(Boolean),
  ];
  if (laterCount > 0) bits.push(`+${laterCount} more at higher levels`);
  if (!bits.length) return "No stat bonuses or features on file — flavor only.";
  return bits.join(" · ");
}

export function spellLevelByName(name, spellCatalog = []) {
  const norm = (s) => (s || "").toLowerCase();
  const needle = norm(name);
  const found = spellCatalog.find((s) => norm(s.name) === needle);
  return found?.level ?? null;
}

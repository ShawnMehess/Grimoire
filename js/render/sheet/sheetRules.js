// sheetRules.js
//
// Pure rules/ability/money helpers extracted from customSheet.js.
// DOM + character mutation stay in the renderer; math here is testable.

export const MONEY_FIELD_NAMES = ["money", "gp", "currency", "$", "$$", "$$$"];

export function findMoneyFieldByNameIn(allFields = [], names = MONEY_FIELD_NAMES) {
  const texts = allFields.filter((f) => f.fieldType === "text");
  for (const name of names) {
    const match = texts.find((f) => (f.label || "").trim().toLowerCase() === name);
    if (match) return match;
  }
  return null;
}

export function shouldAutoRegisterMoney(moneyFieldId, field, names = MONEY_FIELD_NAMES) {
  if (moneyFieldId || field.fieldType !== "text") return false;
  return names.includes((field.label || "").trim().toLowerCase());
}

function stripRichText(html) {
  return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function floatFromRichText(html) {
  const n = parseFloat(stripRichText(html));
  return Number.isFinite(n) ? n : 0;
}

export function intFromRichText(html) {
  const n = Number.parseInt(stripRichText(html), 10);
  return Number.isFinite(n) ? n : 0;
}

export function appendUniqueTextListItemTo(field, item) {
  if (!field || field.fieldType !== "textlist" || !item) return false;
  if (!Array.isArray(field.items)) field.items = [];
  if (field.items.includes(item)) return false;
  field.items.push(item);
  return true;
}

export function selectedChoiceNameIn(globalFields = [], fieldId, label) {
  const field = globalFields.find((c) => c.id === fieldId)
    || globalFields.find((c) => c.fieldType === "dropdown" && c.label === label);
  if (!field || field.fieldType !== "dropdown") return "";
  return (field.choices || []).find((choice) => choice.id === field.selected)?.text || "";
}

export function findStarterFieldIn(globalFields = [], id, label) {
  return globalFields.find((f) => f.id === id)
    || globalFields.find((f) => f.label === label)
    || null;
}

export function subclassNamesFromBundleRule(classChoice, subclassField) {
  const rule = classChoice?.bundle?.dropdownAccess?.find((r) => r.targetFieldId === subclassField?.id);
  if (!rule || !subclassField) return null;
  const idSet = new Set(rule.allowedChoiceIds || []);
  const names = (subclassField.choices || []).filter((c) => idSet.has(c.id)).map((c) => c.text);
  if (!names.length) return null;
  return { subclasses: names, subclassLevel: Number.isFinite(rule.minLevel) ? rule.minLevel : 1 };
}

export function pointBuyCost(score, min = 8) {
  let cost = 0;
  for (let s = min + 1; s <= score; s++) cost += s >= 14 ? 2 : 1;
  return cost;
}

export function maxAffordableScore(id, scores = {}, { budget = 27, min = 8, max = 15, abilityIds = ["str", "dex", "con", "int", "wis", "cha"] } = {}) {
  const spentElsewhere = abilityIds
    .filter((otherId) => otherId !== id)
    .reduce((sum, otherId) => sum + pointBuyCost(scores[otherId] ?? min, min), 0);
  const remaining = budget - spentElsewhere;
  let best = min;
  for (let s = min; s <= max; s++) {
    if (pointBuyCost(s, min) <= remaining) best = s;
  }
  return best;
}

export function rollAbilityScore() {
  const dice = [1, 2, 3, 4].map(() => 1 + Math.floor(Math.random() * 6)).sort((a, b) => a - b);
  dice.shift();
  return dice.reduce((sum, n) => sum + n, 0);
}

export function abilityModifier(score) {
  return Math.floor((score - 10) / 2);
}

export function formatModifier(mod) {
  return mod >= 0 ? `+${mod}` : String(mod);
}

export function classGrantsAsiIn(grants = [], level) {
  return grants.some((g) => g.minLevel === level && /ability score improvement/i.test(g.name || ""));
}

export function classFeatureGrantsAtLevelIn(grants = [], level) {
  return (grants || []).filter((g) => g.minLevel === level && !/ability score improvement/i.test(g.name || ""));
}

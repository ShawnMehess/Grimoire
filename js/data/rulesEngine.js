// Canonical, presentation-independent character rules state.
// The sheet grid remains editable; this object is the source of truth for
// guided creation and leveling.

import { getLevelUpPlan, getRuleset, getRulesetClass } from "./dnd5e.js";

export const ABILITY_IDS = ["str", "dex", "con", "int", "wis", "cha"];

export function createRulesState() {
  return {
    rulesetId: null,
    species: "",
    background: "",
    className: "",
    level: 1,
    subclass: "",
    abilityScores: Object.fromEntries(ABILITY_IDS.map((id) => [id, 10])),
    choices: {},
    appliedLevels: {},
  };
}

export function normalizeRulesState(value) {
  const defaults = createRulesState();
  const state = { ...defaults, ...(value || {}) };
  state.abilityScores = { ...defaults.abilityScores, ...(value?.abilityScores || {}) };
  state.choices = { ...(value?.choices || {}) };
  state.appliedLevels = { ...(value?.appliedLevels || {}) };
  state.level = Math.min(20, Math.max(1, Number.parseInt(state.level, 10) || 1));
  return state;
}

export function resolveRulesState(value) {
  const state = normalizeRulesState(value);
  const ruleset = getRuleset(state.rulesetId);
  const classEntry = getRulesetClass(state.rulesetId, state.className);
  const plan = getLevelUpPlan(state.rulesetId, state.className, state.level, state.subclass);
  const wisdomMod = Math.floor(((Number(state.abilityScores.wis) || 10) - 10) / 2);
  const druid = state.className === "Druid";
  return {
    state,
    ruleset,
    classEntry,
    plan,
    availableSubclasses: classEntry && state.level >= classEntry.subclassLevel ? classEntry.subclasses : [],
    derived: {
      preparedSpellLimit: druid ? Math.max(1, state.level + wisdomMod) : null,
      resources: druid && state.level >= 2 ? [{ id: "wild-shape", name: "Wild Shape", maximum: 2 }] : [],
    },
  };
}

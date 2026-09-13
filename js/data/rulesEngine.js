// Canonical, presentation-independent character rules state.
// The sheet grid remains editable; this object is the source of truth for
// guided creation and leveling.

import { getLevelUpPlan, getRuleset, getRulesetClass, getSpellcastingInfo } from "./dnd5e.js";

export const ABILITY_IDS = ["str", "dex", "con", "int", "wis", "cha"];

function abilityMod(score) {
  return Math.floor(((Number(score) || 10) - 10) / 2);
}

/** Cantrips known + spells known/prepared for a class at a level,
 *  given ability scores — shared by resolveRulesState's Review-step
 *  summary below and the actual Spell picker's enforcement (see
 *  renderSpellPicker in customSheet.js), so both agree on the same
 *  numbers rather than each computing it separately. Returns null for
 *  a non-caster class (see getSpellcastingInfo). */
export function spellLimitFor(className, level, abilityScores) {
  const info = getSpellcastingInfo(className);
  if (!info) return null;
  const mod = abilityMod(abilityScores?.[info.ability]);
  return {
    ability: info.ability,
    style: info.style,
    cantrips: info.cantrips ? info.cantrips(level) : 0,
    spells: info.style === "known" ? info.known(level) : info.prepared(level, mod),
  };
}

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
    resourceUses: {},
    appliedLevels: {},
    // Feats taken in place of an Ability Score Improvement (see the
    // Leveling wizard's ASI step) — {name, level}, one entry per feat.
    // Not keyed by level the way choices/resourceUses are, since a
    // ruleset could in principle let the same level grant more than
    // one (or none).
    feats: [],
  };
}

export function normalizeRulesState(value) {
  const defaults = createRulesState();
  const state = { ...defaults, ...(value || {}) };
  state.abilityScores = { ...defaults.abilityScores, ...(value?.abilityScores || {}) };
  state.choices = { ...(value?.choices || {}) };
  state.resourceUses = { ...(value?.resourceUses || {}) };
  state.appliedLevels = { ...(value?.appliedLevels || {}) };
  state.feats = Array.isArray(value?.feats) ? value.feats.filter((entry) => entry && entry.name) : [];
  state.level = Math.min(20, Math.max(1, Number.parseInt(state.level, 10) || 1));
  return state;
}

export function resolveRulesState(value) {
  const state = normalizeRulesState(value);
  const ruleset = getRuleset(state.rulesetId);
  const classEntry = getRulesetClass(state.rulesetId, state.className);
  const plan = getLevelUpPlan(state.rulesetId, state.className, state.level, state.subclass);
  const druid = state.className === "Druid";
  return {
    state,
    ruleset,
    classEntry,
    plan,
    availableSubclasses: classEntry && state.level >= classEntry.subclassLevel ? classEntry.subclasses : [],
    derived: {
      spellLimit: spellLimitFor(state.className, state.level, state.abilityScores),
      resources: druid && state.level >= 2 ? [{ id: "wild-shape", name: "Wild Shape", maximum: 2 }] : [],
    },
  };
}

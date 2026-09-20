// Canonical, presentation-independent character rules state.
// The sheet grid remains editable; this object is the source of truth for
// guided creation and leveling.

import { getContentPack, getLevelUpPlan, getRuleset, getRulesetClass, getSpellcastingInfo, contentPackIdsFor, canonicalizeSourceIds } from "./dnd5e.js";

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

// Multiclass ability prerequisites (2014 PHB + TCE): to take a level in a
// new class you need 13+ in its listed score(s) — Fighters need
// Strength OR Dexterity, while Monk/Paladin/Ranger need BOTH of
// theirs — and the same for your current class to leave it. The
// Artificer (TCE) needs Intelligence 13 in both directions. Checked
// against effective scores (base + fixed racial bonuses) at the
// level-up guide. Unknown/homebrew classes never gate.
export const MULTICLASS_PREREQS = {
  Artificer: { all: ["int"] },
  Barbarian: { all: ["str"] },
  Bard: { all: ["cha"] },
  Cleric: { all: ["wis"] },
  Druid: { all: ["wis"] },
  Fighter: { any: ["str", "dex"] },
  Monk: { all: ["dex", "wis"] },
  Paladin: { all: ["str", "cha"] },
  Ranger: { all: ["dex", "wis"] },
  Rogue: { all: ["dex"] },
  Sorcerer: { all: ["cha"] },
  Warlock: { all: ["cha"] },
  Wizard: { all: ["int"] },
};

function prereqMet(req, scores) {
  if (!req) return true;
  const test = (id) => Number(scores?.[id] ?? 10) >= 13;
  if (req.any) return req.any.some(test);
  return (req.all || []).every(test);
}

/** Can a character with these (effective) scores multiclass from
 *  fromClass into toClass? Pure — tested in smoke-imports. */
export function meetsMulticlassPrereq(scores = {}, fromClass, toClass) {
  return prereqMet(MULTICLASS_PREREQS[fromClass], scores)
    && prereqMet(MULTICLASS_PREREQS[toClass], scores);
}

/** Human reason a multiclass is blocked ("" when allowed) — either
 *  side's unmet requirement, e.g. "needs INT 13" or "needs DEX 13
 *  and WIS 13". Pure. */
export function multiclassPrereqReason(scores = {}, fromClass, toClass) {
  const need = (cls) => {
    const req = MULTICLASS_PREREQS[cls];
    if (!req || prereqMet(req, scores)) return "";
    const list = req.any || req.all || [];
    return `needs ${list.map((id) => `${id.toUpperCase()} 13`).join(req.any ? " or " : " and ")}`;
  };
  return need(toClass) || need(fromClass) || "";
}

/** Base scores plus a race bundle's fixed ability adds (op "add" on
 *  *Score) — what multiclass prerequisites measure against. Pure. */
export function effectiveScoresFor(baseScores = {}, raceBundle) {
  const out = { ...baseScores };
  for (const mod of ((raceBundle || {}).statModifiers || [])) {
    if (mod.op === "add" && /Score$/.test(mod.targetFieldId || "") && Number.isFinite(mod.value)) {
      const id = mod.targetFieldId.replace(/Score$/, "");
      out[id] = (Number(out[id]) || 10) + mod.value;
    }
  }
  return out;
}

/** Per-class levels for a (possibly multiclassed) rules state:
 *  [{ name, levels, subclass, primary }]. Primary levels are derived
 *  (total minus secondary, clamped to ≥1) so single-class characters
 *  — multiclass: [] — behave exactly as before. Pure. */
export function classLevelsFor(state) {
  const total = Math.min(20, Math.max(1, Number.parseInt(state?.level, 10) || 1));
  const secondary = (Array.isArray(state?.multiclass) ? state.multiclass : [])
    .filter((e) => e && e.name)
    .map((e) => ({
      name: e.name,
      levels: Math.max(0, Number.parseInt(e.levels, 10) || 0),
      subclass: e.subclass || "",
      primary: false,
    }));
  const used = secondary.reduce((n, e) => n + e.levels, 0);
  const out = [];
  if (state?.className) {
    out.push({
      name: state.className,
      levels: Math.max(1, total - used),
      subclass: state?.subclass || "",
      primary: true,
    });
  }
  return out.concat(secondary);
}

export function createRulesState() {
  return {
    // rulesetId = the game SYSTEM (e.g. "dnd5e-2014") — the source
    // level-up math and spellcasting info resolve against.
    rulesetId: null,
    // rulesetIds = the CONTENT PACKS (books) included for option
    // lists (race/class/etc. names, bundles). rulesetId above is a
    // system; these are its books, so the two are deliberately NOT
    // kept identical. Migration in normalizeRulesState rewrites the
    // legacy single-rule-source saves ("homebrew"/"xanathar") to the
    // new system + packs.
    rulesetIds: [],
    species: "",
    background: "",
    className: "",
    level: 1,
    subclass: "",
    abilityScores: Object.fromEntries(ABILITY_IDS.map((id) => [id, 10])),
    choices: {},
    resourceUses: {},
    appliedLevels: {},
    // Multiclassing (level 2+): secondary classes alongside the
    // primary className — [{ name, levels, subclass }]. The primary
    // class's own levels are DERIVED (total minus secondary), never
    // stored, so single-class characters never touch this.
    multiclass: [],
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
  // Included sources: migrate legacy single-rule-source saves to the
  // system + content-pack model, then dedupe and drop blanks. The
  // primary is a system id and the included set holds book ids, so
  // the old "primary stays inside the set" rule no longer applies.
  const canonical = canonicalizeSourceIds(value);
  state.rulesetId = canonical.rulesetId;
  state.rulesetIds = [...new Set(canonical.contentPackIds.filter((id) => typeof id === "string" && id))];
  state.abilityScores = { ...defaults.abilityScores, ...(value?.abilityScores || {}) };
  state.choices = { ...(value?.choices || {}) };
  state.resourceUses = { ...(value?.resourceUses || {}) };
  state.appliedLevels = { ...(value?.appliedLevels || {}) };
  state.feats = Array.isArray(value?.feats) ? value.feats.filter((entry) => entry && entry.name) : [];
  state.level = Math.min(20, Math.max(1, Number.parseInt(state.level, 10) || 1));
  state.multiclass = Array.isArray(value?.multiclass)
    ? value.multiclass
      .filter((entry) => entry && entry.name && entry.name !== state.className)
      .map((entry) => ({
        name: entry.name,
        levels: Math.min(19, Math.max(0, Number.parseInt(entry.levels, 10) || 0)),
        subclass: entry.subclass || "",
      }))
      .filter((entry) => entry.levels > 0)
    : [];
  return state;
}

/** Content packs included for option lists, oldest saves included:
 *  the stored set when present, else the primary system's default
 *  books (so a lone-system selection never faces an empty list).
 *  Pure. */
export function includedRulesetIds(state) {
  if (Array.isArray(state?.rulesetIds) && state.rulesetIds.length > 0) {
    return [...new Set(state.rulesetIds.filter((id) => typeof id === "string" && id))];
  }
  return contentPackIdsFor(state);
}

/** The primary system — the one level-up math and spellcasting info
 *  resolve against. Derived from the system a character's packs
 *  belong to when no explicit primary is stored. Pure. */
export function primaryRulesetId(state) {
  const canonical = canonicalizeSourceIds(state);
  if (canonical.rulesetId) return canonical.rulesetId;
  const packs = contentPackIdsFor(state);
  return packs[0] ? (getContentPack(packs[0])?.rulesetId || packs[0]) : null;
}

export function resolveRulesState(value) {  const state = normalizeRulesState(value);
  const ruleset = getRuleset(state.rulesetId);
  const classEntry = getRulesetClass(state.rulesetId, state.className);
  const plan = getLevelUpPlan(state.rulesetId, state.className, state.level, state.subclass);
  return {
    state,
    ruleset,
    classEntry,
    plan,
    availableSubclasses: classEntry && state.level >= classEntry.subclassLevel ? classEntry.subclasses : [],
    derived: {
      spellLimit: spellLimitFor(state.className, state.level, state.abilityScores),
      // Was a hardcoded `className === "Druid"` check granting a
      // "Wild Shape" resource — another spot of default D&D content
      // baked into code rather than coming from any import. Limited
      // resources (per-rest pools like this) have no bundle-driven
      // source yet; this always returns none until that exists,
      // instead of silently granting a PHB resource by class name.
      resources: [],
    },
  };
}

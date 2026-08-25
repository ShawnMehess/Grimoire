// rules.js
//
// Pure functions only — no DOM access, no Firebase access. Anything
// that's "how D&D math works" belongs here so it can be tested and
// reused independent of how it's displayed.

export function abilityModifier(score) {
  return Math.floor((score - 10) / 2);
}

export function formatModifier(mod) {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

export function proficiencyBonus(level) {
  return Math.ceil(level / 4) + 1; // +2 at 1-4, +3 at 5-8, ... +6 at 17-20
}

export function skillModifier(character, skillId, skillsList) {
  const skill = skillsList.find(s => s.id === skillId);
  if (!skill) return 0;
  const base = abilityModifier(character.abilities[skill.ability]);
  const proficient = character.skillProficiencies[skillId];
  return proficient ? base + proficiencyBonus(character.level) : base;
}

export function savingThrowModifier(character, abilityId) {
  const base = abilityModifier(character.abilities[abilityId]);
  const proficient = character.savingThrowProficiencies[abilityId];
  return proficient ? base + proficiencyBonus(character.level) : base;
}

export function initiativeModifier(character) {
  return abilityModifier(character.abilities.dex);
}

export function passivePerception(character, skillsList) {
  return 10 + skillModifier(character, "perception", skillsList);
}

// Spell save DC / spell attack bonus depend on which ability the
// character casts with (character.spellcastingAbility) — not every
// class uses the same one, so this is stored per-character rather
// than assumed.
export function spellSaveDC(character) {
  const ability = character.spellcastingAbility;
  return 8 + proficiencyBonus(character.level) + abilityModifier(character.abilities[ability]);
}

export function spellAttackBonus(character) {
  const ability = character.spellcastingAbility;
  return proficiencyBonus(character.level) + abilityModifier(character.abilities[ability]);
}

// Class-specific spell slot tables (full caster vs half-caster vs
// Warlock pact magic vs non-caster) differ enough that auto-deriving
// "max slots" from class+level reliably is a project of its own.
// Deliberately NOT doing that here — spellSlots.max is a value you set
// once from the class table (PHB or D&D Beyond) and it's stored as
// plain data on the character; only .current ticks up/down as slots
// get spent. If you want auto-calculated slots later, this is the
// function to add — keep it pure and call it from characterSheet.js,
// same as everything else here.

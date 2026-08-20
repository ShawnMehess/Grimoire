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

// Spell slot tables, class-specific carrying capacity math, etc. all
// belong here too as the sheet grows — keep them out of render/.

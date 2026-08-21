// characterSheet.js
//
// Orchestration only: pulls field definitions from schema.js, builds
// DOM via formBuilder.js, computes derived values via rules.js, and
// persists changes via characterStore.js. No Firebase calls and no
// raw DOM-building logic should live in this file — delegate.
//
// Important pattern: the abilities/skills DOM is built exactly ONCE
// per renderCharacterSheet call. When an ability score (or level)
// changes, we update the affected modifier numbers *in place* via
// updateDerivedDisplays() rather than tearing down and rebuilding the
// section — rebuilding recreates the <input> the user is actively
// typing into, which kicks it out of focus after every keystroke.

import { ABILITIES, SKILLS, IDENTITY_FIELDS, COMBAT_FIELDS } from "../data/schema.js";
import { abilityModifier, skillModifier, initiativeModifier, formatModifier } from "../data/rules.js";
import { buildSheetSection, buildStatBlock, buildInputGroup } from "./formBuilder.js";

// Debounce writes so typing a name doesn't fire a Firestore write per
// keystroke. Cheap and keeps you well within free-tier write quotas.
function debounce(fn, delayMs = 400) {
  let handle;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), delayMs);
  };
}

// `store` just needs a saveCharacterField(characterId, fieldId, value)
// function — pass the real state/characterStore.js for live Firebase
// persistence, or state/mockStore.js to preview the UI with no backend
// at all. Keeping this as a parameter (instead of importing Firebase
// directly here) is what makes that swap possible.
export function renderCharacterSheet(root, character, store) {
  root.innerHTML = "";

  const persistField = debounce((fieldId, value) => {
    store.saveCharacterField(character.id, fieldId, value);
  });

  const onFieldChange = (fieldId, value) => {
    character[fieldId] = value;
    persistField(fieldId, value);
    // Level affects proficiency bonus, which affects skill/save modifiers —
    // update those numbers in place, don't rebuild the DOM.
    if (fieldId === "level") {
      updateDerivedDisplays(root, character);
    }
  };

  root.append(buildSheetSection("Identity", IDENTITY_FIELDS, character, onFieldChange));
  root.append(buildSheetSection("Combat", COMBAT_FIELDS, character, onFieldChange));

  buildAbilitiesAndSkills(root, character, persistField);

  const notesField = buildInputGroup(
    { id: "notes", label: "Notes", type: "textarea" },
    character.notes,
    (val) => { character.notes = val; persistField("notes", val); }
  );
  root.append(notesField);

  updateDerivedDisplays(root, character);
}

/**
 * Builds the abilities + skills DOM ONCE and appends it to root. Score
 * inputs call updateDerivedDisplays() on change instead of rebuilding.
 */
function buildAbilitiesAndSkills(root, character, persistField) {
  const section = document.createElement("section");
  section.className = "sheet-section";
  section.id = "abilities-section";

  const heading = document.createElement("h3");
  heading.textContent = "Abilities & Skills";

  const grid = document.createElement("div");
  grid.className = "sheet-section__grid";

  ABILITIES.forEach(ability => {
    const score = character.abilities[ability.id];
    const mod = abilityModifier(score);
    grid.append(buildStatBlock(ability, score, mod, (newScore) => {
      character.abilities[ability.id] = newScore;
      persistField(`abilities.${ability.id}`, newScore);
      updateDerivedDisplays(root, character);
    }));
  });

  section.append(heading, grid);
  root.append(section);

  // Skills as a simple proficiency-toggle list rather than stat-blocks —
  // still built entirely from schema + rules, no hand-written markup.
  const skillsSection = document.createElement("section");
  skillsSection.className = "sheet-section";
  skillsSection.id = "skills-section";
  const skillsHeading = document.createElement("h3");
  skillsHeading.textContent = "Skills";
  const skillsCard = document.createElement("div");
  skillsCard.className = "card card-list";

  SKILLS.forEach(skill => {
    const row = document.createElement("label");
    row.dataset.skillId = skill.id;
    row.style.display = "flex";
    row.style.justifyContent = "space-between";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = character.skillProficiencies[skill.id];
    checkbox.addEventListener("change", () => {
      character.skillProficiencies[skill.id] = checkbox.checked;
      persistField(`skillProficiencies.${skill.id}`, checkbox.checked);
      updateDerivedDisplays(root, character);
    });

    const label = document.createElement("span");
    label.textContent = `${skill.label} (${skill.ability})`;

    const mod = document.createElement("span");
    mod.className = "skill-mod";
    mod.textContent = formatModifier(skillModifier(character, skill.id, SKILLS));

    row.append(checkbox, label, mod);
    skillsCard.append(row);
  });

  skillsSection.append(skillsHeading, skillsCard);
  root.append(skillsSection);
}

/**
 * Updates every derived (calculated) number on the sheet in place:
 * ability modifier badges, skill modifiers, initiative. Never creates
 * or removes DOM nodes, so it's safe to call on every keystroke —
 * focus is never lost.
 */
function updateDerivedDisplays(root, character) {
  ABILITIES.forEach(ability => {
    const badge = root.querySelector(`[data-ability-id="${ability.id}"] .stat-block__modifier`);
    if (badge) badge.textContent = formatModifier(abilityModifier(character.abilities[ability.id]));
  });

  SKILLS.forEach(skill => {
    const modEl = root.querySelector(`[data-skill-id="${skill.id}"] .skill-mod`);
    if (modEl) modEl.textContent = formatModifier(skillModifier(character, skill.id, SKILLS));
  });

  const initField = root.querySelector('[data-field-id="initiative"] .input-group__control');
  if (initField) initField.value = initiativeModifier(character);
}

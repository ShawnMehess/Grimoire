// characterSheet.js
//
// Orchestration only: pulls field definitions from schema.js, builds
// DOM via formBuilder.js, computes derived values via rules.js, and
// persists changes via characterStore.js. No Firebase calls and no
// raw DOM-building logic should live in this file — delegate.
//
// Layout: everything renders into one .sheet-grid container (see
// layout.css). Each section is marked with a size — default (packs
// two-or-more to a row), .sheet-section--wide (spans 2 columns), or
// .sheet-section--full (spans the whole row) — and CSS grid's dense
// packing does the actual arranging. Add a new section by picking
// whichever size fits its content; you don't need to hand-place it
// next to anything.
//
// Important pattern: most DOM is built exactly ONCE per
// renderCharacterSheet call. When a value that affects derived numbers
// changes (an ability score, level, a skill/save proficiency), we
// update just the affected numbers in place via updateDerivedDisplays()
// rather than tearing down and rebuilding — rebuilding recreates the
// <input> the user is actively typing into, which kicks it out of
// focus after every keystroke.
//
// List sections (attacks/inventory/spells/features) DO rebuild on
// add/remove — that's a deliberate click, not typing, so it's safe.
// Editing a field WITHIN a row never rebuilds the list. Each list gets
// a stable wrapper div (created once) so add/remove refills that div's
// contents in place instead of re-appending the section to the end of
// the grid.

import {
  ABILITIES, SKILLS, IDENTITY_FIELDS, COMBAT_FIELDS, CURRENCY_FIELDS,
  PROFICIENCY_FIELDS, SPELLCASTING_FIELDS, PERSONALITY_FIELDS, SPELL_LEVELS,
  ATTACK_FIELDS, INVENTORY_FIELDS, SPELL_FIELDS, FEATURE_FIELDS,
  createAttack, createInventoryItem, createSpell, createFeature,
} from "../data/schema.js";
import {
  abilityModifier, skillModifier, savingThrowModifier, initiativeModifier,
  formatModifier, proficiencyBonus, passivePerception, spellSaveDC, spellAttackBonus,
} from "../data/rules.js";
import {
  buildSheetSection, buildStatBlock, buildInputGroup, buildReadout,
  buildEditableList, buildSpellSlotRow,
} from "./formBuilder.js";

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
// at all.
export function renderCharacterSheet(root, character, store) {
  root.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "sheet-grid";
  root.append(grid);

  const persistField = debounce((fieldId, value) => {
    store.saveCharacterField(character.id, fieldId, value);
  });

  const onFieldChange = (fieldId, value) => {
    character[fieldId] = value;
    persistField(fieldId, value);
    // Level and spellcasting ability affect several derived numbers —
    // update those in place, don't rebuild the DOM.
    if (fieldId === "level" || fieldId === "spellcastingAbility") {
      updateDerivedDisplays(grid, character);
    }
  };

  addWide(grid, buildSheetSection("Identity", IDENTITY_FIELDS, character, onFieldChange));
  addWide(grid, buildSheetSection("Combat", COMBAT_FIELDS, character, onFieldChange));
  grid.append(buildDeathSaves(character, persistField));

  addWide(grid, buildAbilities(grid, character, persistField));
  grid.append(buildSkills(grid, character, persistField));
  grid.append(buildSavingThrows(grid, character, persistField));
  grid.append(buildPassiveStats());

  grid.append(buildSpellcastingSummary(character, onFieldChange));
  grid.append(buildSpellSlots(character, persistField));

  addWide(grid, renderListContainer(grid, character, store, {
    arrayKey: "attacks", sectionId: "attacks-section", title: "Attacks",
    fieldDefs: ATTACK_FIELDS, factory: createAttack,
  }));

  grid.append(buildSheetSection("Currency", CURRENCY_FIELDS, character, onFieldChange));
  addWide(grid, renderListContainer(grid, character, store, {
    arrayKey: "inventory", sectionId: "inventory-section", title: "Inventory",
    fieldDefs: INVENTORY_FIELDS, factory: createInventoryItem,
  }));

  const spellsContainer = renderListContainer(grid, character, store, {
    arrayKey: "spells", sectionId: "spells-section", title: "Spells",
    fieldDefs: SPELL_FIELDS, factory: createSpell, extraClass: "sheet-section--arcane",
  });
  grid.append(spellsContainer);

  addWide(grid, renderListContainer(grid, character, store, {
    arrayKey: "features", sectionId: "features-section", title: "Features & Traits",
    fieldDefs: FEATURE_FIELDS, factory: createFeature,
  }));

  addWide(grid, buildSheetSection("Proficiencies & Languages", PROFICIENCY_FIELDS, character, onFieldChange));
  addWide(grid, buildSheetSection("Personality", PERSONALITY_FIELDS, character, onFieldChange));

  const notesField = buildInputGroup(
    { id: "notes", label: "Notes", type: "textarea" },
    character.notes,
    (val) => { character.notes = val; persistField("notes", val); }
  );
  addWide(grid, notesField);

  updateDerivedDisplays(grid, character);
}

function addWide(grid, el) {
  el.classList.add("sheet-section--wide");
  grid.append(el);
}

// --- Abilities & Skills ------------------------------------------------

function buildAbilities(grid, character, persistField) {
  const section = document.createElement("section");
  section.className = "sheet-section";
  section.id = "abilities-section";

  const heading = document.createElement("h3");
  heading.textContent = "Abilities";

  const fieldGrid = document.createElement("div");
  fieldGrid.className = "sheet-section__grid";

  ABILITIES.forEach(ability => {
    const score = character.abilities[ability.id];
    const mod = abilityModifier(score);
    fieldGrid.append(buildStatBlock(ability, score, mod, (newScore) => {
      character.abilities[ability.id] = newScore;
      persistField(`abilities.${ability.id}`, newScore);
      updateDerivedDisplays(grid, character);
    }));
  });

  section.append(heading, fieldGrid);
  return section;
}

function buildSkills(grid, character, persistField) {
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
      updateDerivedDisplays(grid, character);
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
  return skillsSection;
}

// --- Saving Throws -------------------------------------------------------

function buildSavingThrows(grid, character, persistField) {
  const section = document.createElement("section");
  section.className = "sheet-section";
  section.id = "saves-section";

  const heading = document.createElement("h3");
  heading.textContent = "Saving Throws";

  const card = document.createElement("div");
  card.className = "card card-list";

  ABILITIES.forEach(ability => {
    const row = document.createElement("label");
    row.dataset.saveId = ability.id;
    row.style.display = "flex";
    row.style.justifyContent = "space-between";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = character.savingThrowProficiencies[ability.id];
    checkbox.addEventListener("change", () => {
      character.savingThrowProficiencies[ability.id] = checkbox.checked;
      persistField(`savingThrowProficiencies.${ability.id}`, checkbox.checked);
      updateDerivedDisplays(grid, character);
    });

    const label = document.createElement("span");
    label.textContent = ability.label;

    const mod = document.createElement("span");
    mod.className = "save-mod";
    mod.textContent = formatModifier(savingThrowModifier(character, ability.id));

    row.append(checkbox, label, mod);
    card.append(row);
  });

  section.append(heading, card);
  return section;
}

// --- Passive stats (proficiency bonus, passive perception) ---------------

function buildPassiveStats() {
  const section = document.createElement("section");
  section.className = "sheet-section";
  const grid = document.createElement("div");
  grid.className = "sheet-section__grid";
  grid.append(
    buildReadout("Proficiency Bonus", "+0", "proficiency-bonus"),
    buildReadout("Passive Perception", "10", "passive-perception"),
  );
  section.append(grid);
  return section;
}

// --- Spellcasting: ability + DC + attack bonus, one compact card ---------

function buildSpellcastingSummary(character, onFieldChange) {
  const section = document.createElement("section");
  section.className = "sheet-section sheet-section--arcane";
  const heading = document.createElement("h3");
  heading.textContent = "Spellcasting";

  const fieldGrid = document.createElement("div");
  fieldGrid.className = "sheet-section__grid";

  SPELLCASTING_FIELDS.forEach(def => {
    fieldGrid.append(buildInputGroup(def, character[def.id], (val) => onFieldChange(def.id, val)));
  });
  fieldGrid.append(buildReadout("Spell Save DC", "8", "spell-save-dc"));
  fieldGrid.append(buildReadout("Spell Attack Bonus", "+0", "spell-attack-bonus"));

  section.append(heading, fieldGrid);
  return section;
}

function buildSpellSlots(character, persistField) {
  const section = document.createElement("section");
  section.className = "sheet-section sheet-section--arcane";
  const heading = document.createElement("h3");
  heading.textContent = "Spell Slots";
  const list = document.createElement("div");
  list.className = "card-list";

  SPELL_LEVELS.forEach(level => {
    const slot = character.spellSlots[level];
    list.append(buildSpellSlotRow(
      level, slot,
      (newMax) => { slot.max = newMax; persistField(`spellSlots.${level}.max`, newMax); },
      (newCurrent) => { slot.current = newCurrent; persistField(`spellSlots.${level}.current`, newCurrent); },
    ));
  });

  section.append(heading, list);
  return section;
}

// --- Death saves -----------------------------------------------------------

function buildDeathSaves(character, persistField) {
  const section = document.createElement("section");
  section.className = "sheet-section";
  section.id = "death-saves-section";

  const heading = document.createElement("h3");
  heading.textContent = "Death Saves";

  const card = document.createElement("div");
  card.className = "card";
  card.style.display = "flex";
  card.style.gap = "var(--space-6)";

  ["successes", "failures"].forEach(kind => {
    const group = document.createElement("div");
    const label = document.createElement("div");
    label.className = "input-group__label";
    label.textContent = kind === "successes" ? "Successes" : "Failures";
    group.append(label);

    const boxes = document.createElement("div");
    boxes.style.display = "flex";
    boxes.style.gap = "var(--space-2)";

    for (let i = 0; i < 3; i++) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = character.deathSaves[kind] > i;
      checkbox.addEventListener("change", () => {
        const newCount = checkbox.checked ? i + 1 : i;
        character.deathSaves[kind] = newCount;
        persistField(`deathSaves.${kind}`, newCount);
      });
      boxes.append(checkbox);
    }
    group.append(boxes);
    card.append(group);
  });

  section.append(heading, card);
  return section;
}

// --- Generic list-section controller (attacks/inventory/spells/features) --
//
// Returns a stable wrapper div (created once) that the caller appends
// to the grid. Add/remove refill this div's contents in place — the
// div itself never moves, so a list section never migrates to the end
// of the page the way a naive remove()+append() would.

function renderListContainer(grid, character, store, { arrayKey, sectionId, title, fieldDefs, factory, extraClass }) {
  const persistArray = debounce(() => {
    store.saveCharacterField(character.id, arrayKey, character[arrayKey]);
  });

  const container = document.createElement("div");
  container.id = sectionId;

  function rerender() {
    container.innerHTML = "";
    const section = buildEditableList({
      title,
      items: character[arrayKey],
      fieldDefs,
      extraClass,
      onAdd: () => {
        character[arrayKey].push(factory());
        persistArray();
        rerender();
      },
      onRemove: (itemId) => {
        character[arrayKey] = character[arrayKey].filter(i => i.id !== itemId);
        persistArray();
        rerender();
      },
      onFieldChange: (itemId, fieldId, value) => {
        const item = character[arrayKey].find(i => i.id === itemId);
        if (item) item[fieldId] = value;
        persistArray();
      },
    });
    container.append(section);
  }

  rerender();
  return container;
}

// --- Derived value refresh (never rebuilds DOM — safe on every keystroke) -

function updateDerivedDisplays(grid, character) {
  ABILITIES.forEach(ability => {
    const badge = grid.querySelector(`[data-ability-id="${ability.id}"] .stat-block__modifier`);
    if (badge) badge.textContent = formatModifier(abilityModifier(character.abilities[ability.id]));
  });

  SKILLS.forEach(skill => {
    const modEl = grid.querySelector(`[data-skill-id="${skill.id}"] .skill-mod`);
    if (modEl) modEl.textContent = formatModifier(skillModifier(character, skill.id, SKILLS));
  });

  ABILITIES.forEach(ability => {
    const modEl = grid.querySelector(`[data-save-id="${ability.id}"] .save-mod`);
    if (modEl) modEl.textContent = formatModifier(savingThrowModifier(character, ability.id));
  });

  const initField = grid.querySelector('[data-field-id="initiative"] .input-group__control');
  if (initField) initField.value = initiativeModifier(character);

  const profBonusEl = grid.querySelector('[data-readout-id="proficiency-bonus"] .readout__value');
  if (profBonusEl) profBonusEl.textContent = formatModifier(proficiencyBonus(character.level));

  const passivePerceptionEl = grid.querySelector('[data-readout-id="passive-perception"] .readout__value');
  if (passivePerceptionEl) passivePerceptionEl.textContent = String(passivePerception(character, SKILLS));

  const spellDCEl = grid.querySelector('[data-readout-id="spell-save-dc"] .readout__value');
  if (spellDCEl) spellDCEl.textContent = String(spellSaveDC(character));

  const spellAtkEl = grid.querySelector('[data-readout-id="spell-attack-bonus"] .readout__value');
  if (spellAtkEl) spellAtkEl.textContent = formatModifier(spellAttackBonus(character));
}

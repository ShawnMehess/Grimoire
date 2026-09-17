// sheetTabs.js
//
// Pure tab-list helpers extracted from customSheet.js.
// Mutating normalize stays in the renderer (needs newId/rules/mirror);
// all lookups here are pure and testable.

export function findTab(tabs = [], id) {
  return tabs.find((t) => t.id === id) || null;
}

export function tabIndex(tabs = [], id) {
  return tabs.findIndex((t) => t.id === id);
}

export function isGlobalTabKind(tab) {
  return tab?.kind === "global";
}

export function layoutForTab(tab, fallbackLayout = []) {
  if (!tab) return fallbackLayout;
  return Array.isArray(tab.layout) ? tab.layout : fallbackLayout;
}

export function ensureMainTabShape(tabs, layout, newIdFn) {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return [{
      id: newIdFn(),
      name: "Main",
      kind: "main",
      layout: Array.isArray(layout) ? layout : [],
    }];
  }
  return tabs;
}

export function needsRulesTab(tabs, setupComplete) {
  if (setupComplete) return false;
  return !tabs.some((tab) => tab.kind === "rules");
}

export function shouldRemoveRulesTab(tabs, setupComplete) {
  if (!setupComplete) return false;
  return tabs.some((tab) => tab.kind === "rules");
}

export function needsLevelingTab(tabs) {
  return !tabs.some((tab) => tab.kind === "leveling");
}export function flattenFieldsAcrossTabs(tabs = []) {
  const fields = [];
  tabs.forEach((tab) => {
    (tab.layout || []).forEach((block) => {
      (block.children || []).forEach((field) => fields.push(field));
    });
  });
  return fields;
}

export function defaultTabName(tab, index) {
  if (!tab.kind) return `Tab ${index + 1}`;
  if (tab.kind === "main") return "Main";
  if (tab.kind === "rules") return "Character";
  if (tab.kind === "leveling") return "Leveling";
  return `Tab ${index + 1}`;
}

// --- Tabs bar DOM --------------------------------------------------------
//
// Full DOM migration of renderTabs from customSheet.js. Takes explicit
// `deps` (no sheet closure):
//
//   renderTabsInto(barEl, {
//     tabs: [...], activeId, editMode,
//     defaultName: (tab, index) => string,
//     onRename: (tab, text, index) => void,
//     onSelect: (tab) => void,
//     onReorder: (draggedId, targetId) => void,
//     onDelete: (tab) => void,
//     onAdd: () => void,
//   })

export function renderTabsInto(barEl, deps) {
  const {
    tabs = [],
    activeId,
    editMode,
    defaultName = defaultTabName,
    onRename,
    onSelect,
    onReorder,
    onDelete,
    onAdd,
  } = deps;

  barEl.innerHTML = "";
  tabs.forEach((tab, index) => {
    const tabBtn = document.createElement("button");
    tabBtn.type = "button";
    tabBtn.className = `sheet-tab${tab.id === activeId ? " active" : ""}`;
    tabBtn.draggable = editMode && !tab.kind;
    tabBtn.dataset.tabId = tab.id;

    const nameEl = document.createElement("span");
    nameEl.className = "sheet-tab__name";
    nameEl.contentEditable = editMode ? "true" : "false";
    nameEl.textContent = tab.name;
    nameEl.addEventListener("pointerdown", (e) => e.stopPropagation());
    nameEl.addEventListener("input", () => {
      onRename(tab, nameEl.textContent.trim() || defaultName(tab, index), index);
    });

    tabBtn.addEventListener("click", () => onSelect(tab));
    tabBtn.addEventListener("dragstart", (e) => {
      if (!editMode || tab.kind) return;
      e.dataTransfer.setData("application/x-sheet-tab", tab.id);
      e.dataTransfer.effectAllowed = "move";
    });
    tabBtn.addEventListener("dragover", (e) => {
      if (!editMode) return;
      e.preventDefault();
    });
    tabBtn.addEventListener("drop", (e) => {
      if (!editMode) return;
      const draggedId = e.dataTransfer.getData("application/x-sheet-tab");
      if (!draggedId || draggedId === tab.id) return;
      e.preventDefault();
      onReorder(draggedId, tab.id);
    });

    tabBtn.append(nameEl);
    if (editMode && !tab.kind) {
      const deleteBtn = document.createElement("span");
      deleteBtn.className = "sheet-tab__delete";
      deleteBtn.textContent = "×";
      deleteBtn.title = "Delete tab";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        onDelete(tab);
      });
      tabBtn.append(deleteBtn);
    }
    barEl.append(tabBtn);
  });

  if (editMode) {
    const addTabBtn = document.createElement("button");
    addTabBtn.type = "button";
    addTabBtn.className = "sheet-tab sheet-tab--add";
    addTabBtn.textContent = "+";
    addTabBtn.title = "Add tab";
    addTabBtn.addEventListener("click", () => onAdd());
    barEl.append(addTabBtn);
  }
}

// --- Tab normalization ---------------------------------------------------------------
//
// Full migration of normalizeTabs from customSheet.js. Mutates
// `character` in place (same as the original) with explicit deps:
//
//   normalizeTabsIn(character, {newIdFn, normalizeRulesFn, mirrorFn})

export function normalizeTabsIn(character, deps) {
  const { newIdFn, normalizeRulesFn, mirrorFn } = deps;
  if (!Array.isArray(character.sheetTabs) || character.sheetTabs.length === 0) {
    character.sheetTabs = [{
      id: newIdFn(),
      name: "Main",
      kind: "main",
      layout: Array.isArray(character.layout) ? character.layout : [],
    }];
  }
  character.sheetTabs.forEach((tab, index) => {
    if (!tab.id) tab.id = newIdFn();
    if (index === 0 && !tab.kind) tab.kind = "main";
    if (!tab.name) tab.name = defaultTabName(tab, index);
    if (!Array.isArray(tab.layout)) tab.layout = [];
  });
  // The Character-setup wizard tab is mandatory ONLY until it's been
  // finished — once finished, it's removed entirely rather than kept
  // around; the "Finish Setup" button is what flips the flag.
  if (!character.setupComplete) {
    if (!character.sheetTabs.some((tab) => tab.kind === "rules")) {
      character.sheetTabs.splice(1, 0, { id: newIdFn(), name: "Character", kind: "rules", layout: [] });
    }
  } else {
    const rulesIndex = character.sheetTabs.findIndex((tab) => tab.kind === "rules");
    if (rulesIndex !== -1) character.sheetTabs.splice(rulesIndex, 1);
  }
  if (needsLevelingTab(character.sheetTabs)) {
    const levelingIndex = character.sheetTabs.some((tab) => tab.kind === "rules") ? 2 : 1;
    character.sheetTabs.splice(levelingIndex, 0, { id: newIdFn(), name: "Leveling", kind: "leveling", layout: [] });
  }
  if (!character.levelUps || typeof character.levelUps !== "object") {
    character.levelUps = {};
  }
  character.rules = normalizeRulesFn(character.rules);
  // Heal the ruleset mirror: the toolbar historically saved only one of
  // character.rulesetId / character.rules.rulesetId, so older saves can
  // disagree (toolbar unset while everything else worked). The rules
  // copy is canonical — prefer it, but accept the top-level one when
  // it's the only copy present.
  if (character.rules && !character.rules.rulesetId && character.rulesetId) {
    character.rules.rulesetId = character.rulesetId;
  } else if (character.rules?.rulesetId && !character.rulesetId) {
    character.rulesetId = character.rules.rulesetId;
  }
  mirrorFn(character);
  return character;
}

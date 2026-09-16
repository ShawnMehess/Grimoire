// sheetState.js
//
// Mutable sheet-session state factory + pure selection-set helpers.
//
// customSheet.js currently keeps all of this as closure `let`s inside
// renderCustomSheet (selectedIds, undoStack, editMode, ...). New
// sub-modules should take an explicit `ctx` created here instead of
// closing over the renderer, so the big closure can shrink slice by
// slice without behavior changes.

export function createSheetState() {
  return {
    editMode: false,
    selectedIds: new Set(),
    undoStack: [],
    redoStack: [],
    collapsedBlockIds: new Set(),
    expandedLevelUpRows: new Set(),
    creationWizardState: { index: 0 },
    levelingWizardState: { index: 0 },
    levelingPendingState: {},
    formulaValues: {},
    radioOptionCounts: {},
    spellSlotCounts: {},
    grantedCheckboxes: new Set(),
    grantedTags: new Map(),
    grantedFeatures: [],
    sidebarCollapsed: false,
    unsavedChanges: false,
    lastSelectionSignature: "",
    groupBorderVisible: false,
  };
}

// --- Pure selection-set helpers (no DOM) -------------------------------

export function selectOnlySet(id) {
  return new Set([id]);
}

export function toggleInSet(set, id) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function selectionSignature(ids) {
  return [...ids].sort().join(",");
}

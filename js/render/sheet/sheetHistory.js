// sheetHistory.js
//
// Pure undo/redo helpers extracted from customSheet.js.
// Stacks are plain arrays passed explicitly; character snapshotting
// uses structured clone via JSON like the original.

export const UNDO_COALESCE_MS = 800;
export const MAX_UNDO_STEPS = 100;

export function snapshotOf(character, cloneFn = (v) => JSON.parse(JSON.stringify(v))) {
  return cloneFn({
    sheetTabs: character.sheetTabs,
    layout: character.layout,
  });
}

export function shouldPushNewStep({ stackEmpty, now, lastMutationAt, coalesceMs = UNDO_COALESCE_MS }) {
  if (stackEmpty) return true;
  return now - lastMutationAt > coalesceMs;
}

export function pushBounded(stack, entry, max = MAX_UNDO_STEPS) {
  stack.push(entry);
  if (stack.length > max) stack.shift();
  return stack;
}

// --- History buttons + keyboard shortcuts --------------------------------------
//
// Migration of updateHistoryButtons / onShortcut decision core from
// customSheet.js. DOM/event side effects stay in the renderer;
// shortcutAction is pure decision logic over a key event snapshot:
//
//   shortcutAction({key, ctrl, meta, shift, alt, typing, nodeId,
//                   hasSelection, editMode})
//     -> {type:'escape'} | {type:'delete-selection'} |
//        {type:'delete-node'} | {type:'duplicate'} |
//        {type:'nudge', dx, dy, resize} |
//        {type:'undo'} | {type:'redo'} | null

export const ARROW_DELTAS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

export function canUndo(stack) {
  return stack.length > 0;
}

export function canRedo(stack) {
  return stack.length > 0;
}

export function applyHistoryButtons(undoBtn, redoBtn, undoLen, redoLen) {
  undoBtn.disabled = undoLen === 0;
  redoBtn.disabled = redoLen === 0;
}

export function shortcutAction(snapshot) {
  const { key, ctrl, meta, shift, alt, typing, nodeId, hasSelection, editMode } = snapshot;
  if (key === "Escape") return { type: "escape" };
  if (typing) return null;

  if (editMode && !ctrl && !meta && !alt && (key === "Delete" || key === "Backspace")) {
    if (hasSelection) return { type: "delete-selection" };
    if (nodeId) return { type: "delete-node" };
    return null;
  }

  if (editMode && (ctrl || meta) && !shift && !alt && key.toLowerCase() === "d") {
    return { type: "duplicate" };
  }

  if (editMode && hasSelection && !ctrl && !meta && !alt && ARROW_DELTAS[key]) {
    const [dx, dy] = ARROW_DELTAS[key];
    return { type: "nudge", dx, dy, resize: shift };
  }

  if (!ctrl || shift || alt || meta) return null;
  const lower = key.toLowerCase();
  if (lower === "z") return { type: "undo" };
  if (lower === "y") return { type: "redo" };
  return null;
}

// sheetState.js
//
// Pure selection-set helpers (no DOM).
//
// A `createSheetState()` factory used to live here too, listing every
// mutable `let` inside renderCustomSheet's closure - the plan being that new
// sub-modules would take an explicit ctx built from it, so the big closure
// could shrink slice by slice. It was never adopted: nothing imported it, and
// the only reference in the repo was an assertion in smoke-imports.mjs that
// it existed. The closure `let`s it mirrored are still there.
//
// It is removed rather than kept as a promise, because a dead factory pinned
// by a test advertises an API nothing uses, and the parallel it drew (one
// place listing the closure's state) was already out of date. If the
// dependency-injection shape is ever revisited, this is where its home would
// be - but it should be written against the closure as it actually is then.

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

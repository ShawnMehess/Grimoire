// equationStub.js
//
// STUB ONLY — deliberately not implementing equation evaluation yet
// (Shawn's call, mid-spec, to keep this pass scoped). This just opens
// a modal so the hover-to-open interaction exists and is discoverable,
// with the intended future spec captured here so it's easy to pick up
// later without re-deriving the design.
//
// Intended future behavior (NOT implemented):
//   - Clicking the "=" icon (which sits on whichever edge of a field is
//     OPPOSITE its label — see customSheet.js's equationHintPosition())
//     opens this box.
//   - The user can drag any other field on the sheet into the box; it
//     appears as a variable token. The variable's name is a short,
//     collision-safe abbreviation of that field's label — Shawn
//     suggested "first three letters, uppercase" (e.g. a field labeled
//     "Strength" becomes STR). Needs a disambiguation strategy for
//     fields that abbreviate to the same three letters (append a
//     number? use more letters for the second one?) — undecided.
//   - The user can otherwise type standard math operators/numbers
//     freely alongside those variable tokens.
//   - Radio fields' internal option numbers (1..N, left to right —
//     already implemented in blockModel.js/customSheet.js) and
//     checkbox true/false values are meant to eventually be usable
//     inside these equations too (checkboxes likely as conditionals
//     rather than as numeric operands) — not decided in detail yet.
//   - On save, the field's value becomes computed rather than
//     type-able; until this exists, every field (including ones that
//     conceptually want to be computed, like an ability modifier) is
//     just a plain manually-typed text field.

export function openEquationStub(fieldLabel) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const box = document.createElement("div");
  box.className = "modal-box";
  box.innerHTML = `
    <h3>Equation editor (coming soon)</h3>
    <p class="input-group__hint">
      This will let you build a formula for <strong>${fieldLabel}</strong> by
      dragging in other fields as variables and typing standard math
      operators. Not built yet — this field stays a plain typed-in value
      for now.
    </p>
  `;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn--primary";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => overlay.remove());
  box.append(closeBtn);

  overlay.append(box);
  document.body.append(overlay);
}

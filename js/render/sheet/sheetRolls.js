// sheetRolls.js
//
// Dice-roll helpers + result dialog for numeric ("Num Field") text
// fields. Pure roll math lives here testably (no sheet closure); the
// renderer wires triggers onto fields and passes the live modifier in.
//
// A "relevant" die here is always a d20: these fields hold ability
// scores, modifiers, bonuses, and DCs — the numbers added to a d20
// check at the table. Advantage rolls 2d20 and keeps the higher;
// disadvantage keeps the lower.

export const ROLL_SIDES = 20;

export function rollDie(sides = ROLL_SIDES, rand = Math.random) {
  return Math.max(1, Math.floor(rand() * sides) + 1);
}

/** Roll one d20, or two (keeping higher/lower) for advantage /
 *  disadvantage. Returns { rolls, kept, mode, sides }. */
export function rollCheck({ mode = "normal", sides = ROLL_SIDES, rand = Math.random } = {}) {
  if (mode === "advantage" || mode === "disadvantage") {
    const rolls = [rollDie(sides, rand), rollDie(sides, rand)];
    const kept = mode === "advantage" ? Math.max(...rolls) : Math.min(...rolls);
    return { rolls, kept, mode, sides };
  }
  const kept = rollDie(sides, rand);
  return { rolls: [kept], kept, mode: "normal", sides };
}

/** "crit" on a natural max roll, "fumble" on a natural 1, else null. */
export function natStatus(kept, sides = ROLL_SIDES) {
  if (kept === sides) return "crit";
  if (kept === 1) return "fumble";
  return null;
}

export function rollTotal(kept, modifier = 0) {
  return kept + (Number.isFinite(modifier) ? modifier : 0);
}

export function formatSigned(n) {
  if (!Number.isFinite(n)) return "+0";
  return n >= 0 ? `+${n}` : `${n}`;
}

export function modeLabel(mode) {
  return mode === "advantage" ? " with Advantage"
    : mode === "disadvantage" ? " with Disadvantage"
    : "";
}

/**
 * Modal result dialog for one roll. Shows the die result(s), the
 * field's modifier being added, and the total; calls out natural
 * 20s/1s; offers re-rolls in every mode. `rollFn(mode)` performs a
 * fresh rollCheck and returns it (so the dialog never touches RNG
 * itself and stays testable); `modifier` is the field's current
 * numeric value.
 *
 *   openRollResultDialog({
 *     fieldLabel, modifier, initialMode, sides, rollFn,
 *   })
 */
export function openRollResultDialog({ fieldLabel, modifier, initialMode = "normal", sides = ROLL_SIDES, rollFn }) {
  const doRoll = typeof rollFn === "function" ? rollFn : (mode) => rollCheck({ mode, sides });
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay roll-dialog-overlay";
  const box = document.createElement("div");
  box.className = "modal-box roll-dialog";
  box.addEventListener("click", (e) => e.stopPropagation());

  const title = document.createElement("h3");
  title.className = "roll-dialog__title";
  box.append(title);

  const diceLine = document.createElement("p");
  diceLine.className = "roll-dialog__dice";
  box.append(diceLine);

  const mathLine = document.createElement("p");
  mathLine.className = "roll-dialog__math";
  box.append(mathLine);

  const totalLine = document.createElement("p");
  totalLine.className = "roll-dialog__total";
  box.append(totalLine);

  const natLine = document.createElement("p");
  natLine.className = "roll-dialog__nat";
  box.append(natLine);

  let mode = initialMode;
  function render(result) {
    const kept = result.kept;
    const rolls = result.rolls || [kept];
    title.textContent = `${fieldLabel || "Field"} — d${result.sides || sides} roll${modeLabel(mode)}`;
    if (rolls.length > 1) {
      const [a, b] = rolls;
      const dropped = a === kept && b !== kept ? b : b === kept && a !== kept ? a : null;
      diceLine.textContent = dropped === null
        ? `Rolled ${a} and ${b} — tied, kept ${kept}.`
        : `Rolled ${a} and ${b} — kept ${kept}.`;
    } else {
      diceLine.textContent = `Rolled ${kept} on the die.`;
    }
    const mod = Number.isFinite(modifier) ? modifier : 0;
    mathLine.textContent = rolls.length > 1
      ? `Die ${kept} ${formatSigned(mod)} (from ${fieldLabel || "field"}) = ${rollTotal(kept, mod)}`
      : `${kept} ${formatSigned(mod)} (from ${fieldLabel || "field"}) = ${rollTotal(kept, mod)}`;
    totalLine.textContent = `Total: ${rollTotal(kept, mod)}`;
    const nat = natStatus(kept, result.sides || sides);
    if (nat === "crit") {
      natLine.textContent = `Natural ${kept}! Critical success.`;
      natLine.hidden = false;
      natLine.className = "roll-dialog__nat roll-dialog__nat--crit";
    } else if (nat === "fumble") {
      natLine.textContent = `Natural 1! Critical fail.`;
      natLine.hidden = false;
      natLine.className = "roll-dialog__nat roll-dialog__nat--fumble";
    } else {
      natLine.textContent = "";
      natLine.hidden = true;
    }
  }

  const btnRow = document.createElement("div");
  btnRow.className = "modal-actions roll-dialog__actions";
  const rerollBtn = document.createElement("button");
  rerollBtn.type = "button";
  rerollBtn.className = "btn btn--primary";
  rerollBtn.textContent = "Re-roll";
  rerollBtn.addEventListener("click", () => render(doRoll(mode)));
  const advBtn = document.createElement("button");
  advBtn.type = "button";
  advBtn.className = "btn";
  advBtn.textContent = "Advantage";
  advBtn.addEventListener("click", () => { mode = "advantage"; render(doRoll(mode)); });
  const disBtn = document.createElement("button");
  disBtn.type = "button";
  disBtn.className = "btn";
  disBtn.textContent = "Disadvantage";
  disBtn.addEventListener("click", () => { mode = "disadvantage"; render(doRoll(mode)); });
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn";
  closeBtn.textContent = "Close";
  const close = () => overlay.remove();
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", close);
  btnRow.append(rerollBtn, advBtn, disBtn, closeBtn);
  box.append(btnRow);

  render(doRoll(mode));
  overlay.append(box);
  document.body.append(overlay);
  closeBtn.focus();
  return overlay;
}

/**
 * Whether a text field is "relevant" for rolling: it opted in (the
 * starter sheet opts in ability/save/skill modifiers, initiative, and
 * spell attacks; anyone can flip the toolbar dice button) AND holds
 * a number (a computed formula value, a typed number, or a
 * still-blank new number field). Plain prose ("Half-Elf",
 * "Chain mail") never rolls — no dice trigger is shown for those.
 */
export function isRollRelevant({ fieldType, value, formulaValue, rollable = false, parseFn } = {}) {
  if (fieldType !== "text") return false;
  if (rollable !== true) return false;
  if (Number.isFinite(formulaValue)) return true;
  const raw = (value || "").trim();
  if (!raw) return true;
  // Strip HTML (contentEditable stores rich text) before parsing.
  const tmp = document.createElement("div");
  tmp.innerHTML = value || "";
  const text = (tmp.textContent || "").trim();
  if (!text) return true;
  if (typeof parseFn === "function") return Number.isFinite(parseFn(value));
  return Number.isFinite(Number(text));
}

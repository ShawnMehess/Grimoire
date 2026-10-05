// richText.js
//
// One place that turns a line of rules text into DOM with everything the
// reader can learn from it attached: ability abbreviations, the gameplay
// glossary, and spell links.
//
// It exists because that assembly had been copied into three places -
// sheetWizard.js, sheetFields.js and catalogBrowser.js - each a local loop
// over splitAbilityTokens. They drifted (the catalog browser never
// spell-linked), and a feature that had to reach all three would have had
// to be written three times and kept in step by hand.
//
// Touch is the reason this is a component and not just a `title`
// attribute. A native tooltip needs a hover, a phone has none, and the
// words a new player most needs explained are exactly the ones they are
// reading on a tablet.
//
// It opens on a TAP, not a long press. A long press asks the player to learn
// a gesture nobody told them about, needs half a second of patience, and
// suppresses the click that follows it - so on a phone it was the slowest
// possible route to the explanation sitting right there. Opening on the
// touch's own end event is both faster and impossible to trigger by accident
// during a scroll, because a scroll either moves the pointer past the
// tolerance or cancels the pointer outright.

import { splitAbilityTokens, abilityTooltip, splitGameplayTerms } from "./sheetMechanics.js";
import { spellLinkNodes } from "./spellLinks.js";
import { findSpellMentions } from "../../data/spellIndex.js";

/** Movement, in px, between a touch going down and coming up that means the
 *  player was SCROLLING, not tapping. Generous enough to survive a shaky
 *  thumb, tight enough that a scroll is never mistaken for a tap. */
const MOVE_TOLERANCE = 10;

/** How long after a tooltip opens the trailing click stays suppressed.
 *  Only armed when the term sits inside something clickable - see
 *  toggleTooltipFor. */
const CLICK_SUPPRESS_MS = 700;

let touchInstalled = false;
let pressOrigin = null;
let pressTarget = null;
let suppressClickUntil = 0;
// The open tooltip and the term describing it, held by reference rather
// than looked up: there is at most one, and a "did I leave a stale
// aria-describedby behind" query on every dismissal is a selector to get
// wrong for no benefit.
let openTip = null;
let describedTerm = null;

/** One glossary term: a span carrying the term's own text and the
 *  explanation, as a native `title` for pointer-fine devices and as the
 *  content of the tap tooltip for the rest.
 *
 *  Focusable, deliberately. Without a focusable trigger the explanation is
 *  unreachable by keyboard and only half-reachable by a screen reader, and
 *  the tab stop is the honest cost of that: the text is already a `title`,
 *  so focusing it announces the explanation with no extra machinery. */
function termNode(run) {
  const span = document.createElement("span");
  span.className = "game-term";
  span.dataset.termId = run.id;
  span.textContent = run.term;
  span.title = run.description;
  span.tabIndex = 0;
  return span;
}

/** Glossary runs for one stretch of prose, minus any that are really a
 *  spell's name.
 *
 *  Without this, "Blindness/Deafness" and "Fire Bolt" would be swallowed as
 *  the Blindness condition and the Fire damage type and would stop being
 *  spell links - a glossary term quietly beating a spell to a mention it
 *  owns. A term whose span overlaps a spell mention is left as prose. */
function glossaryRunsSkippingSpells(text) {
  const runs = splitGameplayTerms(text);
  const mentions = findSpellMentions(text);
  if (!mentions.length) return runs;
  const insideSpell = (start, end) => mentions.some((m) => start < m.end && end > m.start);
  const out = [];
  let at = 0;
  runs.forEach((run) => {
    const len = run.text !== undefined ? run.text.length : run.term.length;
    const isTerm = run.text === undefined;
    if (isTerm && insideSpell(at, at + len)) out.push({ text: run.term });
    else out.push(run);
    at += len;
  });
  return out;
}

/** Display text as DOM, with ability abbreviations as tooltip abbrs,
 *  glossary terms as long-pressable spans, and spell names as links.
 *
 *  `spellLinks: false` is for the catalog browser, which shows spell names
 *  as plain text because it has no spell dialog to open them in - a link
 *  there would swallow the click and go nowhere.
 *
 *  Plain-text paths (review lines, `<option>` values, aria labels) cannot
 *  use this and keep the bare strings: an `<option>` holds no markup. */
export function richGameTextNodes(text, { spellLinks = true } = {}) {
  installTouchTooltips(typeof document === "undefined" ? null : document);
  const out = [];
  for (const run of splitAbilityTokens(String(text ?? ""))) {
    // Plain runs get all three treatments, and they are independent: one
    // sentence can carry an ability, a glossary term and a spell name at
    // once ("Darkvision 60 ft. lets you cast Darkness without a slot").
    if (run.text !== undefined) {
      for (const piece of glossaryRunsSkippingSpells(run.text)) {
        if (piece.text === undefined) out.push(termNode(piece));
        else if (spellLinks) out.push(...spellLinkNodes(piece.text));
        else out.push(piece.text);
      }
      continue;
    }
    const tip = abilityTooltip(run.id);
    const abbr = document.createElement("abbr");
    abbr.className = "ability-abbr";
    abbr.textContent = run.abbr;
    if (tip) abbr.title = tip;
    out.push(abbr);
  }
  return out;
}

// --- The tooltip ------------------------------------------------------------
//
// Delegated from the document rather than bound per span. Terms are
// regenerated on every re-render of every picker row, so per-node
// listeners would be attached and thrown away constantly; one set on the
// document sees every term, including ones rendered after this module was
// first used.

/** The term under an event, if any. `closest` rather than a manual walk so
 *  a term nested inside a picker row still resolves. */
function termAt(target) {
  return (target && target.closest && target.closest(".game-term")) || null;
}

function clearPress() {
  pressOrigin = null;
  pressTarget = null;
}

function hideTooltip() {
  clearPress();
  if (openTip) { openTip.remove(); openTip = null; }
  if (describedTerm) {
    describedTerm.removeAttribute("aria-describedby");
    describedTerm.dataset.termDescribed = "";
    describedTerm = null;
  }
}

/** Whether tapping this term would also hit something clickable behind it -
 *  a picker row, a button, a label wrapping a control. Only those need the
 *  trailing click swallowed; on ordinary prose there is nothing to swallow,
 *  and swallowing it would be the bug rather than the fix. */
function termSitsInSomethingClickable(term) {
  const host = term?.parentElement?.closest?.(
    "a, button, label, .choice-row, [role=button], .vault-card, .modal-box");
  return Boolean(host);
}

function showTooltipFor(doc, term) {
  const tip = doc.createElement("div");
  tip.className = "game-tooltip";
  tip.id = "game-tooltip-live";
  tip.setAttribute("role", "tooltip");
  tip.textContent = term.title || "";
  doc.body.append(tip);
  openTip = tip;

  // Fixed against the viewport, not absolute against the text: a term can
  // sit inside a scrolling panel, and an absolute tip would travel with the
  // text and can end up off the bottom of the screen.
  if (typeof term.getBoundingClientRect === "function") {
    const rect = term.getBoundingClientRect();
    const viewportWidth = (doc.documentElement && doc.documentElement.clientWidth) || 0;
    const width = tip.offsetWidth || 0;
    const left = Math.min(Math.max(8, rect.left), Math.max(8, viewportWidth - width - 8));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.round(rect.bottom + 6)}px`;
  }

  term.setAttribute("aria-describedby", tip.id);
  term.dataset.termDescribed = "1";
  describedTerm = term;
}

/** Open this term's tooltip, or close it if this term is the open one.
 *
 *  Toggling is what makes "tap the word again to dismiss" true without a
 *  separate rule for it: one open at a time is enforced by hiding whatever
 *  was open first, so there is never a second tooltip to stack.
 *
 *  The click suppression is armed ONLY when the term is inside something
 *  clickable. Opening a tooltip must not also select the picker row behind
 *  it - but on prose there is no row behind it, and eating the click there
 *  would break the page for no reason. */
function toggleTooltipFor(doc, term) {
  // A tooltip whose word has been re-rendered out from under it is not "the
  // same word tapped again" - it is an orphan pointing at a detached node,
  // and toggling against it would open a SECOND tooltip instead of closing
  // the first. Treated as closed, which is also what the player sees.
  if (openTip && describedTerm && describedTerm.isConnected === false) hideTooltip();
  if (openTip && describedTerm === term) { hideTooltip(); return false; }
  if (openTip) hideTooltip();
  showTooltipFor(doc, term);
  if (termSitsInSomethingClickable(term)) suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
  return true;
}

function onPointerDown(e, doc) {
  clearPress();
  const term = termAt(e.target);
  // Tapping anywhere that is not a term closes whatever is open. The tooltip
  // itself is not a term, so a tap on the tooltip lands here too - which is
  // the item's "closes when they tap the tooltip itself".
  if (!term) { hideTooltip(); return; }
  // A mouse already has the native title. Arming this on one would fight
  // ordinary clicking, and `pointerType` is absent on synthetic events.
  if (e.pointerType && e.pointerType !== "touch") return;
  pressOrigin = { x: e.clientX, y: e.clientY };
  pressTarget = term;
}

/** The touch's own end: a tap here is a tap, not a long press. Anything that
 *  moved past the tolerance was a scroll, and there is nothing to ask about. */
function onPointerUp(e, doc) {
  const term = pressTarget;
  const origin = pressOrigin;
  clearPress();
  if (!term || !origin) return;
  const dx = Math.abs(e.clientX - origin.x);
  const dy = Math.abs(e.clientY - origin.y);
  if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) { hideTooltip(); return; }
  toggleTooltipFor(doc, term);
}

/** Installs the delegated handlers once, on first use. Called
 *  from richGameTextNodes so no page has to remember to wire it up, and
 *  guarded because the DOM stubs under scripts/ are not full documents.
 *
 *  CAPTURE phase for the pointer and key handlers, and that is not a detail.
 *  Every field on the sheet wraps its control in a `pointerdown` handler that
 *  calls stopPropagation() so that clicking into it to type does not also
 *  trigger the sheet's own selection (see the note on the capture-phase
 *  listener in customSheet.js). In the bubble phase that meant this module
 *  never saw a pointerdown whose target was a glossary term - which is to
 *  say, never saw one anywhere on the character sheet, where all sixteen
 *  terms live inside fields. Measured: on the demo sheet, bubble-phase
 *  `onPointerDown` fired for a tap on a field and never for a tap on a term.
 *  Capture runs on the way DOWN to the target, before any of those
 *  stopPropagation() calls, so a term is reachable wherever it is.
 *
 *  The handlers never stop propagation themselves - they only ever call
 *  preventDefault, and only for the key that would otherwise activate the
 *  thing the term sits inside - so capturing costs the page nothing. */
function installTouchTooltips(doc) {
  if (touchInstalled || !doc || typeof doc.addEventListener !== "function") return;
  touchInstalled = true;
  doc.addEventListener("pointerdown", (e) => onPointerDown(e, doc), true);
  doc.addEventListener("pointermove", (e) => {
    // Scrolling out from under the finger cancels it: the player was reading
    // down the page, not asking about a word.
    if (!pressOrigin) return;
    const dx = Math.abs(e.clientX - pressOrigin.x);
    const dy = Math.abs(e.clientY - pressOrigin.y);
    if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) hideTooltip();
  }, { passive: true, capture: true });
  doc.addEventListener("pointerup", (e) => onPointerUp(e, doc), { passive: true, capture: true });
  doc.addEventListener("pointercancel", () => clearPress(), { passive: true, capture: true });
  doc.addEventListener("scroll", () => hideTooltip(), true);
  // Escape closes, whatever opened it. Keyboard and touch share one tooltip,
  // so they share one way out.
  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openTip) { hideTooltip(); return; }
    if (e.key !== "Enter" && e.key !== " ") return;
    const term = termAt(e.target);
    if (!term) return;
    // Space would otherwise scroll the page; Enter would activate whatever
    // the term happens to sit inside.
    e.preventDefault();
    toggleTooltipFor(doc, term);
  }, true);
  // A long press on a phone otherwise raises the magnifier or the callout
  // menu over the tooltip that just opened.
  doc.addEventListener("contextmenu", (e) => {
    if (Date.now() < suppressClickUntil) e.preventDefault();
  });
  doc.addEventListener("click", (e) => {
    if (Date.now() >= suppressClickUntil) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClickUntil = 0;
  }, true);
}

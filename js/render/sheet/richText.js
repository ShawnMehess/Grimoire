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
// reading on a tablet. So a long press opens the same text in a real
// element that can be positioned, announced, and closed.

import { splitAbilityTokens, abilityTooltip, splitGameplayTerms } from "./sheetMechanics.js";
import { spellLinkNodes } from "./spellLinks.js";
import { findSpellMentions } from "../../data/spellIndex.js";

/** How long a finger has to rest before it counts as asking rather than
 *  scrolling. Long enough not to fire on a tap, short enough that nobody
 *  thinks it is broken. */
const LONG_PRESS_MS = 500;

/** Movement, in px, that turns a long press into a scroll. Small, so a
 *  finger resting on a word does not drift off it. */
const MOVE_TOLERANCE = 8;

/** How long after a long press the trailing click stays suppressed. */
const CLICK_SUPPRESS_MS = 700;

let touchInstalled = false;
let pressTimer = null;
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
 *  content of the long-press tooltip for the rest. */
function termNode(run) {
  const span = document.createElement("span");
  span.className = "game-term";
  span.dataset.termId = run.id;
  span.textContent = run.term;
  span.title = run.description;
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

// --- Long press ------------------------------------------------------------
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
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
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
  // A long press always ends in a click. Swallow it, or resting on a term
  // inside a picker row also selects the row behind it.
  suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
}

function onPointerDown(e, doc) {
  clearPress();
  const term = termAt(e.target);
  if (!term) { hideTooltip(); return; }
  // A mouse already has the native title. Arming this on one would fight
  // ordinary clicking, and `pointerType` is absent on synthetic events.
  if (e.pointerType && e.pointerType !== "touch") return;
  pressOrigin = { x: e.clientX, y: e.clientY };
  pressTarget = term;
  pressTimer = setTimeout(() => {
    pressTimer = null;
    if (pressTarget) showTooltipFor(doc, pressTarget);
  }, LONG_PRESS_MS);
}

function onPointerMove(e, doc) {
  if (!pressOrigin) return;
  const dx = Math.abs(e.clientX - pressOrigin.x);
  const dy = Math.abs(e.clientY - pressOrigin.y);
  // Scrolling out from under the finger cancels it: the player was reading
  // down the page, not asking about a word.
  if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) {
    clearPress();
    hideTooltip();
  }
}

/** Installs the delegated long-press handlers once, on first use. Called
 *  from richGameTextNodes so no page has to remember to wire it up, and
 *  guarded because the DOM stubs under scripts/ are not full documents. */
function installTouchTooltips(doc) {
  if (touchInstalled || !doc || typeof doc.addEventListener !== "function") return;
  touchInstalled = true;
  doc.addEventListener("pointerdown", (e) => onPointerDown(e, doc));
  doc.addEventListener("pointermove", (e) => onPointerMove(e, doc));
  const end = () => clearPress();
  doc.addEventListener("pointerup", end);
  doc.addEventListener("pointercancel", end);
  doc.addEventListener("scroll", () => hideTooltip(), true);
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

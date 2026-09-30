// spellLinks.js
//
// The DOM half of spell linking: turning a mention in prose into a link,
// and turning a click on that link into the spell's entry.
//
// Where the link goes: a character has no spell book in the D&D sense -
// the sheet's `spellsKnown` text list is the book, and it's a flat list of
// names. So a click can't just "open the entry": if the character knows
// the spell there IS an entry to go to, and if they don't there's nothing
// to go to yet. The dialog handles both, which is the only way to make
// every mention useful rather than only the ones the character already
// acted on.
//
// Linking is bound per link, not delegated from the sheet root, for one
// concrete reason: a spell link usually sits inside a picker row, and the
// row's own click handler runs on the way up BEFORE any handler on a
// root ancestor. A delegated root handler therefore fires after the row
// has already re-rendered and detached the link it was asked about. The
// same reason the inline choice links bind directly (and stop
// propagation): a click on a link must never also be a click on whatever
// contains it.

import { findSpellMentions, spellEntryByName, spellMetaLine, spellLevelFor } from "../../data/spellIndex.js";
import { humanizeGameText } from "./sheetMechanics.js";
import { el } from "./sheetHelpers.js";

/** How a clicked spell link opens. Set once by the sheet; the links
 *  themselves are built deep inside text renderers that have no access to
 *  the character, so they can't close over it. */
let spellLinkOpener = null;

/** Register the click behaviour for every spell link. Returns a function
 *  that restores the previous opener, so a caller that owns a sheet's
 *  lifetime can hand it back. */
export function setSpellLinkOpener(fn) {
  const previous = spellLinkOpener;
  spellLinkOpener = typeof fn === "function" ? fn : null;
  return () => { spellLinkOpener = previous; };
}

/** Nodes for one run of plain prose, with every spell name wrapped in a
 *  link. Non-mention text becomes a plain text node, so the caller can
 *  interleave this with the ability-abbr runs and get one mixed sequence. */
export function spellLinkNodes(text, doc = typeof document === "undefined" ? null : document) {
  const src = String(text ?? "");
  const mentions = findSpellMentions(src);
  if (!mentions.length || !doc) return [doc ? doc.createTextNode(src) : src].slice(0, 1);
  const nodes = [];
  let at = 0;
  for (const m of mentions) {
    if (m.start > at) nodes.push(doc.createTextNode(src.slice(at, m.start)));
    nodes.push(spellLinkNode(m, doc));
    at = m.end;
  }
  if (at < src.length) nodes.push(doc.createTextNode(src.slice(at)));
  return nodes;
}

/** The link itself. `href="#"` + preventDefault + stopPropagation is the
 *  same idiom as the inline choice links, and stopPropagation is
 *  load-bearing: these links sit inside picker rows, which toggle on
 *  click, so an unstopped click would collapse the row the player was
 *  reading. */
export function spellLinkNode(mention, doc = typeof document === "undefined" ? null : document) {
  const entry = spellEntryByName(mention.name);
  const level = spellLevelFor(mention.name);
  const a = doc.createElement("a");
  a.href = "#";
  a.className = "spell-link";
  a.dataset.spell = mention.name;
  a.textContent = mention.text;
  a.setAttribute("aria-label", `${mention.name}${entry ? `, ${spellMetaLine(entry)}` : ""}`);
  a.title = entry ? `${spellMetaLine(entry)}\nClick to see the spell.` : "Click to see the spell.";
  // The level is what a player checks first when a trait hands them three
  // spells at once, so it's in the tooltip and the data attribute rather
  // than only being inferable from the name.
  if (level !== null) a.dataset.spellLevel = String(level);
  a.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    spellLinkOpener?.(mention.name, a);
  });
  return a;
}

/** The spell's entry, as a modal.
 *
 *  Deliberately not the shared choice dialog (that lists selectable
 *  options) and not the catalog browser (that's shop-shaped, wants a
 *  money balance, and only shows an entry's first sentence). This is the
 *  reader's view: the full effect text plus the stat line.
 *
 *  `known` decides the action: a spell already on the list offers to jump
 *  to it; one that isn't just says so, because inventing an "add" button
 *  here would duplicate the spell picker's own rules. */
export function openSpellDetailDialog({
  name,
  entry = null,
  known = false,
  onGoToSpellList = null,
  doc = typeof document === "undefined" ? null : document,
} = {}) {
  if (!doc) return null;
  const spell = entry || spellEntryByName(name);
  if (!spell) return null;

  const close = () => {
    if (typeof doc.removeEventListener === "function") doc.removeEventListener("keydown", onKeyDown);
    overlay.remove();
  };
  const onKeyDown = (e) => {
    if (e.key === "Escape") close();
  };

  const overlay = el("div", { class: "modal-overlay spell-detail-overlay", onclick: () => close() });
  const box = el("div", { class: "modal-box spell-detail", onclick: (e) => e.stopPropagation() });
  const f = spell.fieldValues || {};
  const level = spellLevelFor(spell.name);

  box.append(el("h3", { class: "spell-detail__name", text: spell.name }));
  const meta = spellMetaLine(spell);
  if (meta) box.append(el("p", { class: "spell-detail__meta", text: meta }));
  if (f.concentration && /^(yes|concentration)/i.test(String(f.concentration))) {
    box.append(el("p", { class: "spell-detail__meta", text: "Concentration" }));
  }

  const effect = String(f.effect || spell.description || "").trim();
  if (effect) {
    // The trailing "Spell Lists." line is a catalog breadcrumb, not part
    // of the spell; it's shown in the header row instead when known.
    const body = effect.replace(/\n*\s*Spell Lists?\.[\s\S]*$/i, "").trim();
    const para = el("div", { class: "spell-detail__effect" });
    para.append(...richTextNodes(humanizeGameText(body || effect)));
    box.append(para);
  }

  box.append(el("p", { class: "spell-detail__status", text: known
    ? "Already on this character's spell list."
    : level !== null
      ? `Not on this character's spell list yet (a ${spellLevelWord(level)} spell).`
      : "Not on this character's spell list yet." }));

  const actions = el("div", { class: "modal-actions" });
  if (known && typeof onGoToSpellList === "function") {
    actions.append(el("button", {
      type: "button", class: "btn btn--primary", text: "Show on spell list",
      onclick: () => { close(); onGoToSpellList(spell.name); },
    }));
  }
  actions.append(el("button", { type: "button", class: "btn btn--secondary", text: "Close", onclick: close }));
  box.append(actions);

  overlay.append(box);
  doc.body.append(overlay);
  doc.addEventListener("keydown", onKeyDown);
  box.querySelector("button")?.focus?.();
  return { close, overlay, box };
}

function spellLevelWord(level) {
  if (!level) return "cantrip";
  const suffix = level === 1 ? "st" : level === 2 ? "nd" : level === 3 ? "rd" : "th";
  return `${level}${suffix}-level`;
}

/** Prose for the dialog body. The effect text names other spells, and a
 *  mention you can't click is exactly the friction this whole feature
 *  exists to remove - so it renders the same links as everything else.
 *  Ability tooltips aren't needed here (the glossary duplicates the spell
 *  text), so this is the link half of richAbilityNodes only. */
function richTextNodes(text, doc = typeof document === "undefined" ? null : document) {
  return doc ? spellLinkNodes(text, doc) : [text];
}

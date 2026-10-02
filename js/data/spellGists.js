// spellGists.js — the short "what does this actually do" line under a spell's
// name in the pickers, plus the full text behind a disclosure.
//
// WHY THIS IS DERIVED RATHER THAN HAND-WRITTEN
//
// There are 537 spells. Writing a bespoke one-line summary for each would be
// 537 chances to mistype a dice number, and the mistake would be invisible:
// a gist that says "1d8" where the spell says "1d10" is worse than no gist,
// because it looks authoritative. So the default gist is DERIVED from the
// shipped `effect` text, which is the same text the full description shows.
// Nothing here can contradict the rules.
//
// The derivation is deliberately conservative. It takes the first paragraph,
// which in this catalog reliably contains what the spell DOES and what it
// deals, and drops the sections that are about scaling rather than effect
// ("At Higher Levels", "Spell Lists"). For Fire Bolt that yields "You hurl a
// mote of fire at a creature or object within range. Make a ranged spell
// attack against the target. On a hit, the target takes 1d10 fire damage. A
// flammable object hit by this spell ignites if it isn't being worn or
// carried." — which is the shape asked for: the flavour AND the number.
//
// SPELL_GIST_OVERRIDES exists for the cases derivation gets wrong, and wins
// when present. It is intentionally empty: an override is a claim about the
// rules that someone has to stand behind, so it is added deliberately with the
// spell's own text to hand, not filled in speculatively.

// Hand-written gists, keyed by spell name. Empty by design — see above.
export const SPELL_GIST_OVERRIDES = {};

// Catalog markup, not player-facing text:
//   [[/r 1d10]]        a roll the app can turn into a button
//   [[1d8 + 5]]        a bare dice expression in the same shape
//   [[/r 1d6 # note]]  a roll with an author's annotation attached
// The gist must show plain text, or the player reads a template tag as though
// it were rules.
const ROLL_TOKEN = /\[\[\s*(?:\/r\s*)?([^\]#]*?)\s*(?:#[^\]]*)?\]\]/g;

// Headings that follow the effect proper. Cutting here keeps the gist about
// what the spell does rather than how it scales.
const TAIL_HEADINGS = [
  "At Higher Levels",
  "Higher Levels",
  "Spell Lists",
  "Spell lists",
  "Spell List",
];

/** Strip catalog markup and invisible characters: roll tokens become their
 *  bare expression, any author's annotation goes with them, and format
 *  characters the source data carries (U+2060 WORD JOINER, zero-width space,
 *  BOM) are removed.
 *
 *  Those are not cosmetic. "⁠At Higher Levels" — with a word joiner
 *  in front of it — does not match a search for "\nAt Higher Levels", so the
 *  scaling section survived into the gist on Poison Spray and a handful of
 *  others. An invisible character that defeats a substring match is exactly
 *  the kind of thing that hides for years.
 *
 *  Pure. */
export function spellPlainText(text) {
  return String(text || "")
    // Invisible formatting: word joiner, ZWSP, ZWNJ, BOM, soft hyphen.
    .replace(/[⁠‌‍﻿­]/g, "")
    .replace(ROLL_TOKEN, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

/** The `effect` text with its trailing sections removed — the part that
 *  describes what the spell does, as opposed to how it scales and who can
 *  cast it. Pure. */
export function spellEffectBody(spell) {
  const raw = spellPlainText(spell?.fieldValues?.effect ?? spell?.effect ?? "");
  if (!raw) return "";
  let cut = raw.length;
  for (const heading of TAIL_HEADINGS) {
    // Matched as a line of its own, tolerating the stray punctuation and
    // spacing the source data carries around these headings.
    const at = raw.search(new RegExp(`\\n[\\s:.-]*${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
    if (at >= 0) cut = Math.min(cut, at);
  }
  return raw.slice(0, cut).trim();
}

/** Split into sentences without breaking on abbreviations or dice, which the
 *  naive /[^.!?]+/ split does ("1d6. You..." and "vs. "). Pure. */
function sentencesOf(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    // A sentence end, or a dash-bullet. The list-shaped spells ("You affect
    // it in one of the following ways: - You expand the flame...") are one
    // 600-character run without this, and no amount of budget control helps
    // while a single "sentence" is that long.
    const isBullet = ch === "-" && text[i - 1] === " " && /[A-Za-z]/.test(text[i + 1] || "");
    if (ch !== "." && ch !== "!" && ch !== "?" && !isBullet) continue;
    if (isBullet) {
      // Cut before the bullet, dropping the space in front of it.
      const piece = text.slice(start, i - 1).trim();
      if (piece) out.push(piece);
      start = i + 1;
      continue;
    }
    // A period followed by a space and a capital is a real sentence end;
    // "3.5" and "e.g." are not.
    const next = text[i + 1];
    if (next && !/\s/.test(next)) continue;
    const after = text.slice(i + 2, i + 3);
    if (after && !/[A-Z0-9"'(]/.test(after)) continue;
    out.push(text.slice(start, i + 1).trim());
    start = i + 2;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out.filter(Boolean);
}

// A sentence is "mechanical" if it carries a number the player rolls or a
// stated outcome. The gist must contain one, or it is flavour with the
// mechanics cropped off — which is the failure the summary was meant to fix.
const MECHANICAL = /\d*d\d|\d+\s*(?:damage|hit point)|saving throw|must succeed|fails?|half damage|extra damage|radiant|fire|cold|lightning|thunder|acid|poison|psychic|necrotic|radiant|force damage/i;

/** The paragraphs of the effect body, flattened into sentences.
 *
 *  Paragraph breaks alone are not enough: some spells open with a one-line
 *  lead and then a LABELLED section ("You either create or destroy water."
 *  / "Create Water" / "You create up to 10 gallons..."). Taking the first
 *  paragraph of those gives a 38-character gist that says nothing, and
 *  flattening across the boundary without noticing the label merges the label
 *  into the sentence before it - "Create Water You create up to 10 gallons".
 *
 *  So a short standalone line with no sentence punctuation is treated as its
 *  own unit: it becomes a lead-in for what follows rather than being welded to
 *  the previous sentence. That keeps the gist readable and keeps every word of
 *  it verbatim from the source. Pure. */
function gistSentences(body) {
  const paragraphs = body.split(/\n\s*\n/);
  const units = [];
  for (let p = 0; p < paragraphs.length; p++) {
    const lines = paragraphs[p].split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    // A paragraph that is ONE short line with no sentence punctuation is a
    // label, and it labels the NEXT paragraph - "Create Water" on its own,
    // then "You create up to 10 gallons...". Without this the label and the
    // sentence it introduces become two units joined by a space, which reads
    // as "Create Water You create up to 10 gallons".
    const only = lines.length === 1 ? lines[0] : null;
    if (only && only.length <= 40 && !/[.!?]$/.test(only)) {
      const next = paragraphs[p + 1];
      const joiner = only.includes(":") || /[.\-]\s*$/.test(only) ? " " : ": ";
      if (next) {
        const rest = next.replace(/\s+/g, " ").trim();
        units.push(...sentencesOf(`${only}${joiner}${rest}`));
        p += 1;
      } else {
        units.push(`${only.replace(/[.\-]\s*$/, "")}.`);
      }
      continue;
    }

    // Several lines where the first is a label and the rest is its body.
    const first = lines[0];
    const isLabel = lines.length > 1 && first.length <= 40 && !/[.!?]$/.test(first);
    if (isLabel) {
      const rest = lines.slice(1).join(" ").replace(/\s+/g, " ").trim();
      const joiner = first.includes(":") || /[.\-]\s*$/.test(first) ? " " : ": ";
      if (rest) units.push(...sentencesOf(`${first}${joiner}${rest}`));
      else units.push(`${first.replace(/[.\-]\s*$/, "")}.`);
      continue;
    }
    units.push(...sentencesOf(lines.join(" ").replace(/\s+/g, " ").trim()));
  }
  return units.filter(Boolean);
}

/** The one-paragraph gist: what the spell does, including what it deals.
 *
 *  Keeps whole sentences only, so it never ends mid-clause, and goes one
 *  sentence past the budget at most in pursuit of the numbers - that is the
 *  whole point of having a gist next to a full description you have to
 *  expand.
 *
 *  Nothing is reworded: every word of the result appears, in order, in the
 *  shipped effect text. An override wins outright when present. Pure. */
export function spellGist(spell, { maxChars = 260 } = {}) {
  const name = typeof spell === "string" ? spell : spell?.name;
  const override = name ? SPELL_GIST_OVERRIDES[name] : null;
  if (override) return spellPlainText(override);
  const body = spellEffectBody(spell);
  if (!body) {
    // No effect text: fall back to whatever short description exists, so the
    // row says something rather than showing an empty line.
    return spellPlainText(typeof spell === "string" ? "" : spell?.description || "");
  }
  const sentences = gistSentences(body);
  if (!sentences.length) return body.replace(/\s+/g, " ").trim();
  const out = [];
  let length = 0;
  let hasMechanical = false;
  for (const sentence of sentences) {
    const extra = sentence.length + (out.length ? 1 : 0);
    const overBudget = out.length > 0 && length + extra > maxChars;
    if (overBudget) {
      // Over budget, and still no numbers. Keep going for exactly ONE more
      // sentence: on about half the catalog the flavour sentence is long
      // enough to use the whole budget, and the damage lands in the sentence
      // right after it - Acid Splash is the clearest case. So a gist without a
      // number is usually just a gist that stopped one sentence early.
      //
      // One sentence, not two: the overshoot buys the number, not more reading.
      if (hasMechanical) break;
      if (out.length >= 3) break;
    }
    out.push(sentence);
    length += extra;
    if (MECHANICAL.test(sentence)) hasMechanical = true;
  }
  const dropped = sentences.length > out.length;
  const assembled = out.join(" ").trim().replace(/[.:\s]+$/, "");
  const gist = dropped ? `${assembled}...` : `${assembled}.`;
  // A hard ceiling, because the sentence budget can still be overrun by a
  // single unit on the list-shaped spells, and a gist that is longer than the
  // thing it summarises is the failure this whole module exists to avoid.
  // The ellipsis is inside the ceiling, not added on top of it.
  const ceiling = maxChars + 80;
  if (gist.length > ceiling) {
    const cut = gist.slice(0, ceiling - 3);
    const at = cut.lastIndexOf(" ");
    return `${(at > 60 ? cut.slice(0, at) : cut).replace(/[.:\s]+$/, "")}...`;
  }
  return gist;
}

/** The full text behind the disclosure. The same shipped effect, markup
 *  stripped, tail sections included - a player expanding this wants the
 *  scaling and the spell lists too. Pure. */
export function spellFullText(spell) {
  const raw = spellPlainText(spell?.fieldValues?.effect ?? spell?.effect ?? "");
  if (raw) return raw;
  return spellPlainText(typeof spell === "string" ? "" : spell?.description || "");
}

/** True when the gist is a strict prefix of the full text, i.e. the
 *  disclosure actually reveals something. A row whose gist already IS the
 *  whole text should not show a pointless expander. Pure. */
export function spellHasMoreThanGist(spell, opts) {
  const gist = spellGist(spell, opts);
  const full = spellFullText(spell);
  if (!full) return false;
  if (!gist) return true;
  const normalised = (s) => s.replace(/\s+/g, " ").replace(/[.…]+$/, "").trim().toLowerCase();
  return normalised(full).length > normalised(gist).length + 12;
}

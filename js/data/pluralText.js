// pluralText.js
//
// The compiled content writes counts with a lazy "(s)" / "(ies)" so the
// compiler doesn't have to know the number ("1 feat(s)", "2 feat(s)"),
// which reads badly anywhere it survives to the player.
//
// This resolves those to real words. It's a fixup rather than a content
// edit because the text lives in generated files (defaultContent.js and
// friends) that must stay regenerable — see RESCUE-NOTES.md.

/** Irregulars the "(ies)" convention can't derive. Keyed on the stem as
 *  written before the parenthesis. */
const IRREGULAR = {
  ability: "abilities",
  proficiency: "proficiencies",
  entry: "entries",
  specialty: "specialties",
};

/** Stem -> plural, for the cases the rules below don't cover. */
function pluralizeStem(stem) {
  const lower = stem.toLowerCase();
  if (IRREGULAR[lower]) return IRREGULAR[lower];
  // Already-plural or uncountable: leave alone.
  if (/(?:s|x|z|ch|sh)$/.test(lower)) return `${stem}es`;
  if (/[^aeiou]y$/.test(lower)) return `${stem.slice(0, -1)}ies`;
  return `${stem}s`;
}

/** The plural for a stem, honouring the "(s)" vs "(ies)" convention the
 *  compiler wrote. "proficiency" + "ies" has to become "proficiencies",
 *  not "proficiencyies" — the y is the letter that turns to ies. */
function pluralFor(stem, kind) {
  if (kind !== "ies") return pluralizeStem(stem);
  const irregular = IRREGULAR[stem.toLowerCase()];
  if (irregular) return irregular;
  // "ability" -> "abilit" + "ies". A stem with no trailing y has no
  // (ies) form, so leave it as-is rather than inventing "scoreies".
  return /[^aeiou]y$/.test(stem) ? `${stem.slice(0, -1)}ies` : stem;
}

/**
 * Resolve "(s)" and "(ies)" in `text` against any number written just
 * before them.
 *
 *   "1 feat(s) of your choice."   -> "1 feat of your choice."
 *   "2 feat(s) of your choice."   -> "2 feats of your choice."
 *   "1 proficiency(ies)"          -> "1 proficiency"
 *   "3 proficiency(ies)"          -> "3 proficiencies"
 *
 * A number spelled as a word ("one", "two", ... "ten") counts as 1, 2,
 * ... so "one feat(s)" also resolves. An unknown number is treated as
 * plural, because "(s)" in a count context nearly always meant "more
 * than one" and "2 feats" reads better than "2 feat(s)" either way.
 *
 * A parenthetical with NO number anywhere before it is left alone: it
 * might be a real aside rather than a plural, and guessing would corrupt
 * prose.
 */
export function fixPluralParens(text) {
  if (typeof text !== "string" || !text.includes("(")) return text;
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  return text.replace(
    /(\d+|[A-Za-z]+)\s+([A-Za-z][A-Za-z-]*)\((s|ies)\)/g,
    (match, count, stem, kind) => {
      const n = /^\d+$/.test(count) ? Number(count) : WORDS[count.toLowerCase()];
      // No recognizable number - leave the text alone rather than guess.
      if (!Number.isFinite(n)) return match;
      if (n === 1) return `${count} ${stem}`;
      return `${count} ${pluralFor(stem, kind)}`;
    },
  );
}

/** Walk a value and fix every string inside it — used over a whole grant
 *  or choice group so descriptions, labels, and option text are all
 *  covered by one call. Arrays and plain objects are rebuilt; anything
 *  else (numbers, nulls, DOM-ish values) is passed through untouched. */
export function fixPluralDeep(value) {
  if (typeof value === "string") return fixPluralParens(value);
  if (Array.isArray(value)) return value.map(fixPluralDeep);
  if (value && typeof value === "object") {
    // Only rebuild plain data objects. A bundle can carry non-plain values
    // (Timestamps, functions) that must survive by reference.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = fixPluralDeep(v);
    return out;
  }
  return value;
}

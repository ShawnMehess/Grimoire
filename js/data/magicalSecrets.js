// magicalSecrets.js
//
// The Bard's Magical Secrets rule, as data.
//
// This lives in the data layer because BOTH the data and the render
// layer need it. The class bundle needs it to build the Bard's pickers
// (js/data/contentFixups.js), and the wizard needs it to decide whether
// the Bard's spell picks are complete (js/render/customSheet.js). Keeping
// it in the renderer and importing it downward would invert the
// dependency: js/data importing js/render/sheet/sheetWizard.js, which
// touches `document` and would drag a browser module into every node
// test and every content compile.
//
// js/render/sheet/sheetWizard.js re-exports all of these, so existing
// importers are unaffected.

/** Each entry: at `minLevel`, a Bard gains `count` spells from any class
 *  list. `subclasses` narrows an entry to one College - the College of
 *  Lore's unlock comes at 6th level rather than 10th. */
export const MAGICAL_SECRETS_UNLOCKS = [
  { minLevel: 6, count: 2, subclasses: ["lore"] },
  { minLevel: 10, count: 2, subclasses: null },
  { minLevel: 14, count: 2, subclasses: null },
  { minLevel: 18, count: 2, subclasses: null },
];

/** Total Magical Secrets picks unlocked for a Bard of `classLevel`
 *  (0 for any other class). Pure. */
export function magicalSecretsUnlocked(className, subclassName, classLevel) {
  if (String(className || "").trim().toLowerCase() !== "bard") return 0;
  const sub = String(subclassName || "").toLowerCase();
  let total = 0;
  for (const unlock of MAGICAL_SECRETS_UNLOCKS) {
    if ((classLevel ?? 0) < unlock.minLevel) continue;
    if (unlock.subclasses && !unlock.subclasses.some((s) => sub.includes(s))) continue;
    total += unlock.count;
  }
  return total;
}

/** The highest spell level a Secret may be at a given Bard level: half
 *  the Bard level, rounded down. 3 at 6th, 5 at 10th, 7 at 14th, 9 at
 *  18th. Used to cap the Bard's spell pickers. */
export function magicalSecretsMaxSpellLevel(classLevel) {
  return Math.max(0, Math.floor((Number(classLevel) || 0) / 2));
}

/** How many of the known spells look like Secrets picks: anything in
 *  Spells Known outside the Bard's own lists. Deliberately lenient
 *  (a racial or feat spell counts too) so the Secrets step completes
 *  rather than traps - the picker, not this count, is the mechanism.
 *  Pure. */
export function secretsPickedCount(knownItems = [], bardSpellNames = []) {
  const bard = new Set(bardSpellNames || []);
  return (knownItems || []).filter((name) => !bard.has(name)).length;
}

/** Whether the Secrets picks are done: none unlocked, or at least
 *  the unlocked total picked. Pure. */
export function secretsCompleteFor(unlocked, picked) {
  return (picked ?? 0) >= (unlocked ?? 0);
}

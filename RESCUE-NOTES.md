# Why the default D&D content kept coming back

You were right that it was hardcoded — just not in Firebase. Four
separate places in the *code* (not the database) were seeding or
reusing PHB content, so clearing Firestore could never touch them:

1. **`js/data/blockModel.js`** — `STARTER_CLASSES`, `STARTER_RACES`,
   `STARTER_BACKGROUNDS`, `SUBCLASSES_BY_CLASS`. This is the starter
   layout stamped onto **every brand-new character** the moment it's
   created. Even a perfect JSON import only *added* your entries next
   to these — nothing ever removed the hardcoded 12 classes/9 races/13
   backgrounds/every core subclass baked into that starter dropdown
   list. **This was almost certainly the main thing you were fighting.**
   → Emptied. New characters now start with genuinely blank Class/
   Race/Background/Subclass dropdowns.

2. **`js/data/dnd5e.js`** — the "ruleset" registry behind the Leveling
   tab: hardcoded 2014/2024 PHB class lists, subclass lists, and full
   spell-slot / spells-known / spells-prepared tables. There was **no
   import path for this at all** — `getLevelUpPlan`/`getSpellcastingInfo`
   read straight from these hardcoded tables by class name, with no
   bundle-check step the way the rest of the app has.
   → Replaced with a single, empty `"homebrew"` ruleset. Spell slots
   and spells-known will now correctly show **0** for every class
   until you build a real source for them — see "Still open" below.

3. **`js/data/rulesEngine.js`** — a `state.className === "Druid"`
   check that silently granted a "Wild Shape" resource regardless of
   any import.
   → Removed. Limited resources like this have no bundle-driven
   source yet either (see below).

4. **`js/render/bundleLibraryEditor.js`** — the "Import JSON" dialog's
   "Ruleset for this file" dropdown defaulted to **"No ruleset"**.
   Anything imported without explicitly changing that gets tagged
   `rulesetId: null`, and every ruleset-aware picker in the app only
   shows bundles whose `rulesetId` matches your character's chosen
   ruleset — a `null`-tagged import is invisible everywhere, which
   looks exactly like "importing does nothing."
   → Now auto-selects the one ruleset ("Homebrew") that exists, so
   this is much harder to get wrong by accident. Still worth
   double-checking on any bundles you already have saved in Firebase
   from earlier attempts — open Bundle Libraries and check each
   entry's ruleset tag.

## How the working parts actually fit together (for your JSON)

- **Class/Race/Background names**: the wizard's picker prefers
  Bundle Library entries tagged `category: "Class"` (etc.) and
  `rulesetId: "homebrew"` over the (now-empty) starter list. Hitting
  **Finish Setup** in the Character-setup wizard is what pushes your
  chosen name onto the sheet's actual dropdown and wires up that
  bundle's stat modifiers/feature grants — editing the dropdown
  directly on the sheet doesn't do this automatically.
- **Subclass filtering**: the Subclass dropdown only narrows to a
  class's subclasses when that Class bundle carries a real
  `dropdownAccess` rule (target: the Subclass field, `allowedChoiceIds`:
  that class's subclass choice ids, `minLevel`: the level it unlocks).
  Per `MECHANICS-IMPORT-NOTES.md`, `compile-mechanics-content.mjs`
  deliberately did **not** generate these — `SUBCLASS`/`SKILL_EXPERTISE`/
  `SPELL_SELECT` choices only carried an `options_source` reference key
  with no real option list behind it. That's still a documented gap,
  not something this pass fixed — the compiler needs real subclass
  option data (names + descriptions) to build `dropdownAccess` from.

## Still open (needs your input, not guessed at here)

- **Spell slots / spells known / spells prepared** have no
  import-driven source anywhere in this codebase. The cleanest fit
  with what already exists: encode each class's slot progression as
  per-level `statModifiers` on the Class bundle, targeting the sheet's
  `slots1`…`slots9` fields, gated by `minLevel` — the same mechanism
  every other stat/feature grant already uses. That's a real (small)
  code change to `computeSpellSlotCounts` in `customSheet.js` plus a
  compiler change, not something to fake silently.
- **Limited resources** (Wild Shape–style per-rest pools) — same
  story, no bundle-driven source yet.
- **Subclass `dropdownAccess` generation** in
  `scripts/compile-mechanics-content.mjs` — needs real subclass option
  data in your `classes-mechanics.json` to build from.

Happy to build any of these once you've got real content JSON ready
to test against — just say which one to tackle first.

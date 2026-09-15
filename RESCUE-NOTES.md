# What changed this pass: real content, baked in, import UI hidden

Per your call to stop fighting the Bundle/Catalog import pipeline for
now: your `classes-mechanics.json`, `races-mechanics.json`,
`backgrounds-mechanics.json`, and the three catalog files
(`classes.json`, `races.json`, `backgrounds.json`) were compiled
**once**, offline, into `js/data/defaultContent.js` — a plain data
file checked into the repo. Nothing is imported at runtime and
nothing touches Firestore for this; a brand-new character just has
real content on it from the moment it's created.

## What's in it

- **12 classes** (Barbarian, Bard, Cleric, Druid, Fighter, Monk,
  Paladin, Ranger, Rogue, Sorcerer, Warlock, Wizard) — hit die, HP
  formula, saving throw proficiencies (wired as real checkbox grants),
  starting skill choices (a real pickable list), every leveled
  feature as a description, and Ability-Score-Improvement levels as a
  real +2/+1+1/Feat picker.
- **13 races** (your 10 species, plus Dwarf's three subraces broken
  out as their own selectable entries: Hill Dwarf, Mountain Dwarf,
  Duergar) — fixed ability bonuses and restricted-choice bonuses
  (e.g. Changeling) are real, live stat modifiers; everything else
  (speed, senses, resistances, languages, feature effects) shows as
  descriptive text on Features & Traits.
- **9 backgrounds** — the two fixed skill proficiencies are real
  checkbox grants (Urban Bounty Hunter's "choose two from…" is a real
  picker); tools/languages/equipment/feature text shows on Features &
  Traits.
- **112 subclasses**, correctly filtered per class (pick a class,
  only that class's subclasses show up) via real `dropdownAccess`
  rules, sourced from your `classes.json` catalog's "Subclasses" tab.
- **Spell slots**, for every class your data marks as a caster
  (Bard/Cleric/Druid/Sorcerer/Wizard = full, Paladin/Ranger = half,
  Warlock = pact) — standard 5e math, since neither Schema.txt nor
  your mechanics JSON encodes slot tables. Cantrips-known and
  spells-known/prepared numbers on the Leveling tab are the same:
  standard tables, hand-added, not from your JSON.
- **Flavor text**: the three catalog JSON files are also baked in
  as-is and wired into `catalogCache`, so the Character Setup
  wizard's Race/Class/Subclass/Background pickers show real
  descriptions next to each name, no import step needed.

## The `class-features.json` error

That file actually parsed fine. The real syntax break was in
**`classes-mechanics.json`**: partway through (right after Druid,
before Paladin) it contained a stray, unclosed `,\n{\n "classes": [\n`
fragment — looks like two separate generation batches got
concatenated without the outer array brackets ever being added. Fixed
by stripping that fragment and wrapping the whole file in `[...]`;
all 12 classes parse and are accounted for.

## Bundle Libraries / Catalogs — hidden, not deleted

The two toolbar buttons are commented out in `customSheet.js` (search
"Bundle Libraries / Catalogs toolbar buttons — hidden for now" to find
the spot and bring them back later). Nothing else was touched:
`bundleLibraryEditor.js`, `catalogLibraryEditor.js`, and their
Firestore-backed storage are all still there for whenever homebrew
import becomes its own project. One access point was deliberately
left alone since it's low-traffic: a "Manage Catalogs…" button inside
a "catalog"-type field's own config popover.

## Known gaps (flagged, not silently guessed at)

- A few player-choice types in your class data — `SKILL_EXPERTISE`,
  `FEATURE_SELECT`, `SPELL_SELECT` — only carried a reference key
  (`options_source`) in the source JSON, no real option list. Those
  show up as a text note on Features & Traits ("track your pick by
  hand") instead of a real picker. Same for a handful of races whose
  ability bonus is a free-form rule ("+2/+1 or three +1s", i.e.
  Aarakocra/Aasimar/Air Genasi/Yuan-ti/Custom Lineage) rather than a
  fixed list of options.
- ~~Limited resources~~ — done: Rage, Wild Shape, Ki Points, Sorcery
  Points, Second Wind, Action Surge, Indomitable, Channel Divinity,
  Lay on Hands, and Bardic Inspiration all track current/max uses
  with a Restore button on the Leveling tab's "Feature Uses" panel,
  reusing the resourceGrants mechanism. Bardic Inspiration's max
  scales off CHA modifier rather than level — resourceGrants now
  supports that via an optional `maximumFormula` (a formula node,
  same shape/token syntax as any field's own `formula`, evaluated
  live against the sheet) which takes priority over a flat
  `maximum` when present. Also correctly switches its reset trigger
  from long rest to short-or-long-rest at 5th level (Font of
  Inspiration).
- Racial/class weapon, armor, and tool proficiencies show as text
  (the sheet's Armor/Weapon/Tool Prof. fields are plain text boxes,
  not per-item checkboxes) rather than affecting anything mechanically.

## UI/UX pass (Character Vault + sheet editor)

- Character Vault now has a search box (once you have more than 6
  characters — no point cluttering the view before then) and a
  duplicate (⧉) button on every card. Duplicate copies a character's
  full state — layout, rules, level-up history, everything except
  id/timestamps/name — into a brand-new character owned by you, named
  "X (Copy)". It's a full independent copy, not a template.
- Sheet layout editing ("Customize Sheet") no longer requires a mouse
  drag for every move/resize: with something selected, plain arrow
  keys nudge it one grid cell, Shift+arrow resizes it by one cell,
  using the exact same bounds/undo path as dragging with a mouse. This
  fixes the biggest practical wall (a sustained drag gesture) but
  NOT full keyboard-only accessibility — selecting a block/field in
  the first place is still pointer-only (click to select); there's no
  Tab-to-focus-a-node path yet. That would need its own pass (tabindex
  + Enter/Space-to-select on every grid node) if it's wanted later.

## Proficiency cross-referencing (fixed grants + already-picked)

- Fixed proficiencies (a Class's saving throws, a Background's two
  skills, etc.) already showed as checked+disabled on the sheet
  itself before this — that part was pre-existing and working.
- New: any choiceGroups picker (Character Setup's Proficiencies step,
  or the Leveling wizard's Choices step) now greys out — checked,
  disabled, "already have this from another selection" — any option
  that would grant a skill the character already has, whether from a
  fixed grant or from an already-made pick in a DIFFERENT
  choiceGroups entry. Doesn't count against that group's own pick
  count, matching the real 5e "pick something else instead" rule.
  Redoing the level where a choice originated shows it fully
  interactive again — the exclusion is by that specific group's own
  identity, not by comparing levels, so this falls out correctly
  without needing special-case level math.
- Found and fixed a real pre-existing bug along the way: picks made
  during the very first Character Setup wizard were saved under a
  different, temporary key format than everything else uses
  afterward (activeRuleChoiceGroups's real field-based key) — meaning
  a proficiency chosen during Setup would silently stop being
  recognized as picked the moment Setup finished, showing unchecked
  on the sheet. `syncRulesToSheet` (Finish Setup) now migrates those
  keys over as part of finishing setup.

## Regenerating this later

If you get updated JSON, the compiler is a plain Python script (not
checked into the repo, since it's a one-off build step, not part of
the site) — ask me to rerun it and rewrite
`js/data/defaultContent.js` from your new files. It's a straight
recompile, not a rewrite of any of the wiring above.

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
- Limited resources (Rage uses, Wild Shape, Ki points, Sorcery
  Points, etc.) aren't tracked as their own countdown yet — they show
  as text on Features & Traits. The sheet has no generic "resource
  pool" field type yet to hang these on.
- Racial/class weapon, armor, and tool proficiencies show as text
  (the sheet's Armor/Weapon/Tool Prof. fields are plain text boxes,
  not per-item checkboxes) rather than affecting anything mechanically.

## Regenerating this later

If you get updated JSON, the compiler is a plain Python script (not
checked into the repo, since it's a one-off build step, not part of
the site) — ask me to rerun it and rewrite
`js/data/defaultContent.js` from your new files. It's a straight
recompile, not a rewrite of any of the wiring above.

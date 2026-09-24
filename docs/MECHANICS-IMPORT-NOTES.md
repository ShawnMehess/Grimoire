# Importing your `-mechanics.json` files

All three convert to real bundles now — they apply their stats, features,
and choices automatically once a character picks that Class/Race/Background,
the same way `default-bundles/classes.json` etc. already do.

## 1. `classes-mechanics.json` — needed a fix, then converted

**Your uploaded copy was corrupted**: partway through (right after the
Druid entry, before Paladin) it contained a duplicated
`,\n{\n  "classes": [\n` fragment — looks like two generation batches got
concatenated without merging their wrapper objects. I stripped the stray
fragment; the fixed file is `mechanics-source/classes-mechanics.json` in
this delivery (all 12 classes parse and round-trip correctly now — check
your working copy for the same corruption before you regenerate anything
from it).

This file's shape (Schema.txt's Class model) doesn't match what the
Bundle Libraries importer accepts directly, so `scripts/compile-mechanics-content.mjs`
converts it into that shape. Run:

```
node scripts/compile-mechanics-content.mjs
```

This writes `default-bundles/classes-from-mechanics.json` — import it the
same way as any file in `default-bundles/` (see that folder's README):
Bundle Libraries → Import JSON → pick a Ruleset → drop the file.

What made it across:
- **Saving throw proficiencies** → `statModifiers` (`grant` op)
- **Starting skill choice** (`choose 2 from [...]`) → a real `choiceGroups`
  entry, same treatment `compile-2024-content.mjs` gives 2024 class
  skills — each option grants that skill's checkbox
- **Every leveled feature** (`passive_grants`) → `featureGrants`, tagged
  with its `minLevel`
- **Ability Score Improvement** choices → a full `choiceGroups` entry:
  all six "+2 to one ability" options, all 15 "+1/+1 to two abilities"
  pairings, plus a text-only "Feat" placeholder
- **Named choices with real option lists** (e.g. Fighter's Fighting
  Style) → a `choiceGroups` entry with those options, though each
  option is name-only (no mechanical text for e.g. what Archery does —
  that detail isn't in your source file)
- Hit die, starting HP formula, and non-skill starting proficiencies
  (armor/weapons/tools) → a reference `featureGrants` entry each, since
  there's no matching checkbox on the starter sheet to grant those
  against (same rule the existing 2014/2024 bundles already follow)

**Left as a documented gap, not guessed at:** `SUBCLASS`, `SKILL_EXPERTISE`,
and `SPELL_SELECT` choices (Primal Path, Expertise, Magical Secrets, etc.)
only carry an `options_source` reference key in your file (e.g.
`"barbarian_paths"`) — the actual option lists aren't in this data, so
there's nothing to build a real `choiceGroups`/`dropdownAccess` entry
from. These land as a plain `featureGrants` note instead of being
silently dropped, naming the reference key so you know what's missing.

## 2. `races-mechanics.json` — converted

This one uses a different, more detailed shape than Schema.txt describes
(typed `effects` objects, not the Class/Background field list) — Schema.txt
only documents Class and Background, so I worked from the file's actual
structure instead. Same script, same output style:
`default-bundles/races-from-mechanics.json` (13 entries — your 10 species,
plus Dwarf's 3 subraces broken out as their own importable entries: "Dwarf",
"Hill Dwarf", "Mountain Dwarf", "Duergar", each merging the base race's
mechanics with that subrace's overrides).

What made it across:
- **Fixed ability bonuses** → `statModifiers`
- **Restricted-choice ability bonuses** (e.g. Changeling's CHA+2 fixed
  + choose 1 of 5 for +1) → a real `choiceGroups` entry
- **Skill-choice proficiencies** → `choiceGroups` with `grant` modifiers,
  same as class skills above
- **Every feature's effects** (spells, resistances, senses, damage,
  advantage/disadvantage, etc.) → readable `featureGrants` text, one
  line per effect
- **`choice_subfeature` features** (Aasimar's Celestial Revelation,
  Dragonborn's Draconic Ancestry, Custom Lineage's Variable Trait) →
  real `choiceGroups`, one option per sub-choice, with that option's
  effects written out as its description

**Left as a documented gap:** the free-form `"plus_2_plus_1_or_three_plus_1s"`
ability bonus (Aarakocra, Aasimar, Air Genasi, Yuan-ti) — "+2 to one
ability and +1 to another, or +1 to three, entirely your choice" can't be
expressed as a bundle (a bundle is a fixed set of modifiers, not an
unrestricted player choice across all six abilities — the same limitation
that makes the existing Half-Elf bundle in `default-bundles/races.json`
incomplete on purpose). It's written out as a `featureGrants` note so it's
not silently lost — apply it by hand to Ability Scores.

## 3. `backgrounds-mechanics.json` — converted

(Your first upload of this file turned out to be a duplicate of
`backgrounds.json` — plain prose in the catalog shape, not mechanics. The
real mechanics file replaced it, so this is a Bundle like Class and Race
above, not a browsable Catalog.)

Output: `default-bundles/backgrounds-from-mechanics.json` (9 entries).
Import via Bundle Libraries, same as the other two.

What made it across:
- **Fixed skill pairs** (8 of the 9 backgrounds) → `statModifiers`
  (`grant` op) — these auto-apply the moment a character picks that
  Background, same as everything else in `default-bundles/`
- **Urban Bounty Hunter's skill choice** — the only background whose
  `skills` field is a sentence ("Choose two from Deception, Insight,
  Persuasion, and Stealth") instead of a fixed pair — gets parsed into a
  real `choiceGroups` entry with those 4 named options, rather than
  falling back to plain text just because it's the odd one out
- **Tools, Languages, Equipment, Feature** → `featureGrants`, one entry
  each. Tools/Languages are display-only text (no per-tool/per-language
  checkbox exists on the starter sheet — same rule as Class/Race
  proficiencies above — and every entry here is already free text like
  "One type of artisan's tools" or "Two of your choice" rather than a
  fixed named item anyway)

The skill-choice sentence parser (`parseChooseSentence`) only recognizes
the literal pattern `"Choose <number word> from <comma/and-separated list>"`
— if you add homebrew backgrounds later with a differently-worded choice,
check the console output / resulting file to make sure it didn't fall
through to being treated as a single fixed "skill" named after the whole
sentence.

## Files in this delivery

```
mechanics-source/classes-mechanics.json        fixed copy of your file
mechanics-source/races-mechanics.json          your file, unchanged
mechanics-source/backgrounds-mechanics.json    your file, unchanged
scripts/compile-mechanics-content.mjs          the converter (Node 18+, no deps)
default-bundles/classes-from-mechanics.json    generated — import via Bundle Libraries
default-bundles/races-from-mechanics.json      generated — import via Bundle Libraries
default-bundles/backgrounds-from-mechanics.json generated — import via Bundle Libraries
```

Re-run `node scripts/compile-mechanics-content.mjs` any time you update
the `mechanics-source/*.json` inputs; it always regenerates all three
output files from scratch.

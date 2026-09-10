# Default bundles

Hand-authored bundle-library JSON, shaped exactly like what the Bundle
Libraries editor saves (`{ name, category, statModifiers, dropdownAccess }`).
Like `default-catalogs/`, nothing loads these automatically — there's no
code path that reads this folder at runtime.

## Importing

1. Open the Bundle Libraries manager (toolbar → **Bundle Libraries**).
2. Click **Import JSON** in the bundle list.
3. Paste the contents of a file below into the textarea — the importer
   accepts either one bundle object or a JSON array of several, so
   `races.json` (an array of all 9) imports in one go.
4. Click **Import (Global)** (admin rights required) to make them
   available on every character, or **Import (Mine)** to keep them
   personal.

## Attaching a bundle to your Race/Class/Background dropdown

Importing only adds the bundle to your library — it doesn't touch any
character's sheet by itself. To make picking "Hill Dwarf" (say) actually
apply its bonus:

1. Open a character, go into edit mode, and click the **⚙** on the Race
   field.
2. Find the choice you want (e.g. "Dwarf") and open its **Modifiers**
   section.
3. Under **Apply from Library**, pick the bundle and click **+ Apply**.

That's a one-time, per-choice step — once applied, every character who
picks that choice gets the bonus, and re-importing/re-editing the
library bundle later won't retroactively change what's already been
applied to a choice (each "Apply" copies the bundle's rules onto that
choice at that moment, resolved against that character's own fields).

## Level-up choices and feature uses

A bundle can also declare `choiceGroups` and `resourceGrants`. These are
content-only JSON fields: import them with the same Bundle Libraries importer,
then attach the bundle to the matching Class/Subclass/Race/etc. sheet choice.
The Leveling tab renders applicable choice groups at their `minLevel`; chosen
options persist on the character and apply their declared modifiers, features,
and resources.

```json
{
  "name": "Fighter",
  "category": "Class",
  "resourceGrants": [
    { "name": "Second Wind", "maximum": 1, "reset": "short rest", "minLevel": 1 }
  ],
  "choiceGroups": [{
    "id": "fighter-level-4-asi",
    "label": "Ability Score Improvement or Feat",
    "minLevel": 4,
    "minSelections": 1,
    "maxSelections": 1,
    "options": [{
      "id": "increase-strength",
      "name": "+2 Strength",
      "statModifiers": [{ "targetFieldName": "STR", "op": "add", "value": 2 }],
      "featureGrants": [],
      "resourceGrants": []
    }]
  }]
}
```

An option may declare `statModifiers`, `featureGrants`, and `resourceGrants`
in the same way as its parent bundle. Modifiers use `targetFieldName` because
they are resolved against the shared template when the bundle is attached.
For choices such as feats, put each feat in the choice group's `options` list;
the selected feat then appears in the sheet's Feature List and its declared
effects apply automatically.

## Files

- `races.json` — the 9 core PHB races with their standard ability score
  bonuses (Human +1 all six; Elf/Halfling DEX+2; Dwarf CON+2; Gnome
  INT+2; Dragonborn STR+2/CHA+1; Half-Orc STR+2/CON+1; Tiefling
  CHA+2/INT+1; Half-Elf CHA+2). Each modifier targets a field by the
  exact label our starter layout gives ability scores ("STR", "DEX",
  etc.) — if you've renamed those fields, the modifier just won't find
  a match (silently — see the caveat below) rather than error.

  **Half-Elf is incomplete on purpose**: the real rule is CHA+2 *and*
  +1 to two other abilities of the player's choice. A bundle can't
  express "player's choice" — it's a fixed set of modifiers — so only
  the guaranteed CHA+2 is included. Add the other +1/+1 by hand (either
  as a second small bundle you build yourself and also apply to that
  choice, or just adjust the ability score directly).

- `classes.json` — the 12 core PHB classes, each granting their two
  fixed saving-throw proficiencies (e.g. Fighter → Strength +
  Constitution) via the "✓ Grant proficiency" modifier op, AND each
  filtering the starter layout's **Subclass** dropdown (Character
  Details block) down to that class's real subclasses via a
  `dropdownAccess` rule — pick "Fighter," and Subclass only offers
  Champion / Battle Master / Eldritch Knight, not all 40. That
  filtering is entirely rules-driven, not hardcoded to the field: it
  works the same way any dropdownAccess rule does (see
  normalizeDropdownSelections in customSheet.js), including
  auto-clearing a Subclass pick that stops being valid if you change
  Class afterward.

  **Skill proficiencies aren't included**, for the same reason Half-Elf
  is incomplete above: 5e classes grant a *choice* of skills ("choose
  2 from this list"), not a fixed set, and a bundle can't express a
  choice. Add those by hand per-character.

- `backgrounds.json` — the 13 core PHB backgrounds, each granting its
  two fixed skill proficiencies (e.g. Acolyte → Insight + Religion) via
  the same "✓ Grant proficiency" op the class bundles use — unlike
  class skills, background skills in 5e *are* a fixed, non-chosen pair,
  so unlike the class bundles above, there's nothing left out here.
  Apply the same way, from the Background field's own choices.

## 2024/5.5e files

`classes-2024.json`, `species-2024.json`, and `backgrounds-2024.json` are
generated (not hand-authored) by `scripts/compile-2024-content.mjs` from
`data/*-2024.json`, the 2024 SRD dump. Same import steps as above; each
entry's name is suffixed `(2024)` so it doesn't collide with the 2014
entries above in your library. Re-run the script any time you refresh
the underlying `/data/*-2024.json` files.

- `classes-2024.json` — all 12 2024 classes, each granting its two fixed
  saving-throw proficiencies and filtering the Subclass dropdown to that
  class's SRD subclass (every 2024 class gets its subclass at level 3,
  unlike 2014's per-class range). `featureGrants` come straight from
  `class-features-2024.json`. Skill proficiency choices ("choose 2 from
  this list") ARE included as a real `choiceGroups` entry, sourced from
  `proficiency_choices` — unlike the 2014 classes above, which leave this
  as a gap. The one thing still skipped here: a proficiency choice that
  isn't a flat list of skills (Bard's "3 musical instruments" entry, and
  Monk's nested weapon-or-tool choice) — no per-item field exists on the
  starter sheet for those, so they're left as free text same as before.

- `species-2024.json` — the 9 core 2024 species. 2024 moved ability-score
  bonuses from Species to Background, so unlike `races.json` above these
  carry no `statModifiers` at all — just `featureGrants` for size/speed
  and each trait. Trait descriptions are blank: the SRD API only gives
  trait *names*, not their text, so these are closer to a checklist than
  full reference text until filled in by hand.

- `backgrounds-2024.json` — the 4 backgrounds in the free 2024 SRD (2024
  documents far fewer than the 13 in the 2014 SRD). Each grants its fixed
  skill proficiencies the same way `backgrounds.json` above does, plus a
  `featureGrants` entry for its tool proficiency (no per-tool checkbox
  exists on the starter sheet to "grant" against) and its origin feat
  (text copied from `feats-2024.json`). Unlike 2014's Half-Elf gap, the
  2024 background ability-score bonus (+2/+1 split, or +1/+1/+1, across
  three listed abilities — a real player choice) IS fully expressed, as
  a 7-option `choiceGroups` entry rather than a partial guess.

## A caveat worth knowing

If a modifier's `targetFieldName` doesn't match any field's label on a
given character (typo, renamed field, a from-scratch sheet that never
had "STR"/"Strength" fields at all), it silently resolves to nothing —
no error, just no effect. Worth a spot-check after applying a bundle
for the first time on a given sheet: for a stat bonus, change the
target field's value and confirm its dependent Mod shifts; for a
granted proficiency, confirm the checkbox shows checked-and-disabled
and its Mod field includes the proficiency bonus.

# Subclass Content Audit

## Scope and result

This audit covers every entry in `SUBCLASS_SUPPLEMENT`: 116 subclasses,
638 feature grants, 23 subclasses with automatically granted spells, and two
currently modelled subclass choice groups.

This is not a normal copy-editing pass. Every subclass has placeholder feature
copy. Of 638 grants, 610 render as `<Subclass> - <level>-level feature.`.
The remaining 28 are mostly spell-list summaries that expose future spells.

The compiler can read subclass names and feature names from
`docs/New Info/5e-subclasses.txt`, but the actual feature mechanics live behind
Foundry compendium references that were not exported with their records. The
current input therefore cannot support accurate automatic replacement copy.

## Required data-model fix

Do not hand-edit `js/data/subclassContent.js`; it is generated. Extend the
subclass compiler and its source inputs with a curated feature-summary source,
for example `data/subclass-feature-summaries.json`:

```json
{
  "feature-id-or-subclass-level-name": {
    "summary": "One or two concise, player-facing sentences describing the current mechanical effect.",
    "minLevel": 3,
    "optional": false,
    "choice": null
  }
}
```

Use the foundry feature id when it is available. The compiler should attach the
summary to the generated grant and fail verification when a feature still has a
placeholder. Do not generate rules text from a feature name and do not present
an unverified summary as a mechanical fact.

The player-facing display rule is:

1. Show only grants at or below the character's current class level.
2. Show one concise mechanics summary per current feature.
3. Put longer reference text behind an explicitly opened details control.
4. Do not show future scaling, later spell rows, or optional variants as
   current grants.
5. Use `Subclass Features`, never `Racial Traits` or `Innate Abilities`.

## Universal findings

- **All 116 subclasses:** at least one placeholder; all need curated summaries.
- **All 610 placeholder grants:** replace with a concise summary from an
  authoritative rules source or an intentionally authored homebrew source.
- **All 23 automatic-spell subclasses:** the `Bonus Spells` / `Oath Spells`
  description currently lists spells from future levels. At a given level,
  show only currently granted spells. Keep the full progression only in a
  level-by-level reference view.
- **Circle of the Land:** `Bonus Cantrip (Druid)` and `Natural Recovery` have
  malformed descriptions (`3rd, 5th, 7th,`). Replace with real level-2
  summaries. Its terrain selection is a required `features` choice.
- **Eldritch Knight and Arcane Trickster:** their `Spellcasting` grants have
  `minLevel: null`; set them to level 3. Show concise third-caster context and
  make spell selections in the Spells step, never in a static feature sentence.
- **Artificer:** four Artificer subclasses are in the supplement, while the
  base class is not in `DEFAULT_CONTENT`. Verify that the Artificer can actually
  be created before spending time on its subclass UI; otherwise hide those
  subclasses until the base class is fully supported.

## Subclasses requiring summaries

Every subclass below has placeholder mechanics and therefore requires the
curated-summary treatment above. The bracket is its first subclass level and
the number of placeholder grants / total feature grants.

### Barbarian

- Path of the Ancestral Guardian [3; 4/4]
- Path of the Battlerager [3; 4/4]
- Path of the Beast [3; 4/4]
- Path of the Berserker [3; 4/4]
- Path of the Storm Herald [3; 4/4]
- Path of the Totem Warrior [3; 5/5]
- Path of the Zealot Herald [3; 5/5]
- Path of Wild Magic [3; 5/5]

Choice review: Storm Herald environment; Totem Warrior totem choices at its
choice levels. Form of the Beast is a per-rage choice, so expose it in play
state rather than locking it permanently at character creation.

### Bard

- College of Creation [3; 4/4]
- College of Eloquence [3; 5/5]
- College of Glamour [3; 4/4]
- College of Lore [3; 4/4]
- College of Spirits [3; 5/5]
- College of Swords [3; 5/5]
- College of Valor [3; 4/4]
- College of Whispers [3; 4/4]

Choice review: College of Lore's additional skill proficiencies, College of
Swords' Fighting Style, and every later Magical Secrets selection must be
interactive groups, not feature prose.

### Cleric

- Arcana Domain [1; 5/6 plus automatic spells]
- Death Domain [1; 6/7 plus automatic spells]
- Forge Domain [1; 6/7 plus automatic spells]
- Grave Domain [1; 6/7 plus automatic spells]
- Knowledge Domain [1; 5/6 plus automatic spells]
- Life Domain [1; 6/7 plus automatic spells]
- Light Domain [1; 6/7 plus automatic spells]
- Nature Domain [1; 6/7 plus automatic spells]
- Order Domain [1; 6/7 plus automatic spells]
- Peace Domain [1; 6/7 plus automatic spells]
- Tempest Domain [1; 6/7 plus automatic spells]
- Trickery Domain [1; 5/6 plus automatic spells]
- Twilight Domain [1; 5/6 plus automatic spells]
- War Domain [1; 6/7 plus automatic spells]

Replacement rule for every domain spell entry: `Domain Spells: These spells are
always prepared and do not count against your prepared-spell total. Current
spells: <only spells granted at this class level>.` Do not append the 3rd-,
5th-, 7th-, or 9th-level rows before they unlock.

Choice review: Arcana Domain wizard cantrips; Knowledge Domain's Blessings of
Knowledge selections; Nature Domain druid cantrip; any domain feature whose
source record says choose/select. Verify each against the linked feature data.

### Druid

- Circle of Dreams [2; 4/4]
- Circle of Spores [2; 6/6]
- Circle of Stars [2; 5/5]
- Circle of the Land [2; 4/6 and one terrain choice]
- Circle of the Moon [2; 6/6]
- Circle of the Shepherd [2; 5/5]
- Circle of Wildfire [2; 5/5]

Choice review: Circle of the Land terrain is already present but needs category
`features`, a concise description for each terrain option, and level-gated
circle spells. Check Circle of Wildfire's bonus cantrip and Circle of Stars'
star-map form against feature records; only mechanical decisions deserve a
saved choice.

### Fighter

- Arcane Archer [3; 10/10]
- Banneret [3; 5/5]
- Battle Master [3; 6/6]
- Cavalier [3; 7/7]
- Champion [3; 5/5]
- Echo Knight [3; 6/6]
- Eldritch Knight [3; 6/7]
- Psi Warrior [3; 5/5]
- Rune Knight [3; 7/7]
- Samurai [3; 6/6]

Choice review: Arcane Archer Arcane Shot options; Battle Master maneuvers and
related tool choice; Cavalier bonus proficiency; Eldritch Knight cantrips and
spells; Rune Knight runes. These are character choices and must be constrained
by the relevant level and selection count.

### Monk

- Way of Mercy [3; 6/6]
- Way of Shadow [3; 4/4]
- Way of the Ascendant Dragon [3; 5/5]
- Way of the Astral Self [3; 4/4]
- Way of the Drunken Master [3; 5/5]
- Way of the Four Elements [3; 4/4]
- Way of the Kensei [3; 4/4]
- Way of the Long Death [3; 4/4]
- Way of the Open Hand [3; 4/4]
- Way of the Sun Soul [3; 4/4]

Choice review: Four Elements disciplines and Kensei weapons. Treat damage-type
or target decisions made when an ability is used as play-time choices, not
permanent build choices.

### Paladin

- Oath of Conquest [3; 6/7 plus automatic spells]
- Oath of Devotion [3; 6/7 plus automatic spells]
- Oath of Glory [3; 6/7 plus automatic spells]
- Oath of Redemption [3; 6/7 plus automatic spells]
- Oath of the Ancients [3; 6/7 plus automatic spells]
- Oath of the Crown [3; 6/7 plus automatic spells]
- Oath of the Watchers [3; 6/7 plus automatic spells]
- Oath of Vengeance [3; 6/7 plus automatic spells]
- Oathbreaker [3; 5/6 plus automatic spells]

Replacement rule for every oath spell entry: `Oath Spells: These spells are
always prepared and do not count against your prepared-spell total. Current
spells: <only spells granted at this paladin level>.` Channel Divinity options
are choices made when used, not a permanent subclass-build selection.

### Ranger

- Beast Master Conclave [3; 3/4]
- Drakewarden [3; 5/5]
- Fey Wanderer [3; 5/5]
- Gloom Stalker Conclave [3; 6/6]
- Horizon Walker Conclave [3; 6/6]
- Hunter Conclave [3; 4/4 and one prey choice]
- Monster Slayer Conclave [3; 6/6]
- Swarmkeeper [3; 5/5]

Choice review: Hunter's Prey is already present but needs category `features`,
accurate option summaries, and level-gated follow-up selections. Beast Master
companion choice and Drakewarden companion customization require a deliberate
pet/companion data model rather than a text field.

### Rogue

- Arcane Trickster [3; 6/7]
- Assassin [3; 5/5]
- Inquisitive [3; 6/6]
- Mastermind [3; 5/5]
- Phantom [3; 5/5]
- Scout [3; 5/5]
- Soulknife [3; 9/9]
- Swashbuckler [3; 5/5]
- Thief [3; 5/5]

Choice review: Arcane Trickster cantrips/spells, Assassin bonus proficiencies,
and Mastermind bonus proficiencies/languages. Feature summaries must distinguish
automatic grants from selections.

### Sorcerer

- Aberrant Mind [1; 6/6]
- Clockwork Soul [1; 5/5]
- Divine Soul [1; 5/5]
- Draconic Bloodline [1; 5/5]
- Shadow Magic [1; 5/5]
- Storm Sorcery [1; 6/6]
- Wild Magic [1; 5/5]

Choice review: Draconic ancestry and Divine Soul affinity are saved build
choices. Aberrant Mind and Clockwork Soul spell replacements are level-gated
spell choices; do not treat all listed origin spells as immediately known.

### Warlock

- The Archfey [1; 5/5]
- The Celestial [1; 6/6]
- The Fathomless [1; 7/7]
- The Fiend [1; 4/4]
- The Genie [1; 5/5]
- The Great Old One [1; 4/4]
- The Hexblade [1; 6/6]
- The Undead [1; 5/5]
- The Undying [1; 5/5]

Choice review: Genie vessel form is a saved cosmetic choice only if it affects
display; do not pretend it changes mechanics. Check each patron's expanded spell
list: it normally expands available options, not automatically known spells.

### Wizard

- Bladesinging [2; 5/5]
- Chronurgy Magic [2; 5/5]
- Graviturgy Magic [2; 4/4]
- Order of Scribes [2; 5/5]
- School of Abjuration [2; 5/5]
- School of Conjuration [2; 5/5]
- School of Divination [2; 5/5]
- School of Enchantment [2; 5/5]
- School of Evocation [2; 5/5]
- School of Illusion [2; 5/5]
- School of Necromancy [2; 5/5]
- School of Transmutation [2; 5/5]
- War Magic [2; 5/5]

Choice review: validate Bladesinger proficiency grants and Order of Scribes'
spellbook choices against the source feature records. Keep school specialization
features as automatic unless the source explicitly creates a player choice.

### Artificer reachability audit

- Alchemist [3; 6/6]
- Armorer [3; 7/7]
- Artillerist [3; 6/6]
- Battle Smith [3; 7/7]

These entries need summaries only after the application has a complete,
selectable Artificer base-class bundle, equipment model, and spell progression.

## Compiler requirements

1. Retain feature-reference ids from the input and consume a curated summary
   map keyed by that id.
2. Preserve level gating for every feature, spell, resource, and choice.
3. Add `category: "features"` to Circle of the Land and Hunter Conclave groups.
4. Add `choiceKind` metadata to distinguish permanent build choices, level-up
   choices, and play-time choices.
5. Represent automatic spells as individual level-gated grants. The description
   shown at level N must be computed from only currently active spell grants.
6. Add validation that fails when a placeholder description reaches player-facing
   content, a choice group lacks a category, or a grant has `minLevel: null`
   without an explicit `alwaysActive` reason.

## Acceptance checks

1. No rendered subclass feature equals the placeholder pattern.
2. A level-1 domain shows only its level-1 domain spells; a level-3 oath shows
   only its level-3 oath spells.
3. Level-2/3 subclass features do not render before the subclass is selected
   and its unlock level is reached.
4. Every listed persistent choice is interactive, saved, reviewed, and applied.
5. Play-time decisions are available during play without permanently changing
   the character build.
6. `verify-content` fails for placeholder subclass text, malformed summaries,
   missing choice categories, and future-level material in a current-level view.

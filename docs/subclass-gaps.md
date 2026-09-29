# Subclass gaps — unsourced feature grants

Every feature grant below has no entry in
`data/subclass-feature-summaries.json` (and therefore no entry in
`data/subclass-feature-sources.json`), so it renders with NO mechanics
text — omitted from player-facing display until sourced — per
docs/SUBCLASS-CONTENT-AUDIT-2026-09.md §2b. One line each: feature id,
subclass name, level, what's missing. Total unsourced: 611 of 636 grants (25 sourced).

Regenerate (never hand-edit the list below):
`node scripts/gen-subclass-gaps.mjs [--class <Class>]`

## Merged duplicates (not gaps — intentionally folded, no omission)

- `arcane-trickster-3-spellcasting` — Arcane Trickster, level 3:
  section placeholder merged into the sourced third-caster note grant
  `arcane-trickster-spellcasting`.
- `eldritch-knight-3-spellcasting` — Eldritch Knight, level 3:
  section placeholder merged into the sourced third-caster note grant
  `eldritch-knight-spellcasting`.
- `artillerist-3-explosive-cannon` export quirk: the Foundry export
  labels the 3rd-level Artillerist feature "Explosive Cannon",
  duplicating the 9th-level feature name. The compiled output keeps the
  export's label input-faithfully (renaming it would assert unsourced
  mechanics); the grant is unsourced like every other feature below.

## Choice-review dispositions

### Barbarian

- Storm Herald environment — gaps (choiceKind playTime): environment chosen each rage; option list unsourced.
- Totem Warrior totem choices (3rd/6th/14th) — gaps (choiceKind levelUp): totem options unsourced.
- Form of the Beast (per-rage) — by-design (choiceKind playTime): chosen each rage in play state, never a saved build pick.

### Bard

- College of Lore bonus skill proficiencies — gaps (choiceKind build): skill option list unsourced.
- College of Swords Fighting Style — gaps (choiceKind build): style option list unsourced.
- Magical Secrets selections — done (choiceKind levelUp): real picker in the wizard (see MAGICAL_SECRETS_UNLOCKS + Bard spell steps).

### Cleric

- Arcana Domain wizard cantrips — gaps (choiceKind build): cantrip option list unsourced.
- Knowledge Domain Blessings of Knowledge — gaps (choiceKind build): skill/language option mechanics unsourced.
- Nature Domain druid cantrip — gaps (choiceKind build): cantrip option list unsourced.
- Domain spells (all 14 domains) — done (choiceKind build): level-gated grants + computed Domain Spells line.

### Druid

- Circle of the Land terrain — done (choiceKind build): real group (category features, level 2) with level-gated circle-spell modifiers per option.
- Circle of Wildfire bonus cantrip — gaps (choiceKind build): cantrip option list unsourced.
- Circle of Stars star-map form — gaps (choiceKind playTime): form chosen on use; option mechanics unsourced.
- Circle spells (Spores/Land/Wildfire) — gaps (choiceKind build): audit templates cover domain/oath spells only.

### Fighter

- Arcane Archer Arcane Shot options — gaps (choiceKind levelUp): shot option list unsourced.
- Battle Master maneuvers + artisan tool — gaps (choiceKind levelUp): maneuver option list unsourced (tool pick unsourced too).
- Cavalier bonus proficiency — gaps (choiceKind build): option list unsourced.
- Eldritch Knight cantrips/spells — done (choiceKind build): chosen in the Spells step; grant carries third-caster context (minLevel 3).
- Rune Knight runes — gaps (choiceKind levelUp): rune option list unsourced.

### Monk

- Four Elements disciplines — gaps (choiceKind levelUp): discipline option list unsourced.
- Kensei weapons — gaps (choiceKind build): weapon option list unsourced.
- Damage-type/target decisions on use — by-design (choiceKind playTime): chosen when the ability is used, never a saved build pick.

### Paladin

- Oath spells (all 9 oaths) — done (choiceKind build): level-gated grants + computed Oath Spells line.
- Channel Divinity options — by-design (choiceKind playTime): chosen when used, not a permanent subclass-build selection.

### Ranger

- Hunter's Prey — done (choiceKind build): real group (category features, level 3).
- Hunter follow-up selections (7th/15th) — gaps (choiceKind levelUp): tactic/defense option lists unsourced.
- Beast Master companion — gaps (choiceKind build): needs a deliberate pet/companion data model, not a text field.
- Drakewarden companion customization — gaps (choiceKind levelUp): needs a deliberate pet/companion data model, not a text field.
- Hunter variant focuses (Beast/Slayer/Deep Stalker) — done (choiceKind build): input-derived group (category features, level 3); companion mechanics still need the pet model.

### Rogue

- Arcane Trickster cantrips/spells — done (choiceKind build): chosen in the Spells step; grant carries third-caster context (minLevel 3).
- Assassin bonus proficiencies — gaps (choiceKind build): option list unsourced.
- Mastermind bonus proficiencies/languages — gaps (choiceKind build): option list unsourced.

### Sorcerer

- Draconic ancestry — gaps (choiceKind build): ancestry option list unsourced.
- Divine Soul affinity — gaps (choiceKind build): affinity option list unsourced.
- Aberrant Mind / Clockwork Soul spell replacements — gaps (choiceKind levelUp): replacement spell mechanics unsourced (not auto-known).

### Warlock

- Genie vessel form — by-design (choiceKind build): saved cosmetic choice only if it affects display; it does not change mechanics, so no group.
- Patron expanded spell lists — by-design (choiceKind build): expand available options, never automatically known spells — correctly absent from auto-grants.

## Artificer

### Alchemist

- `alchemist-3-tool-proficiency` — Alchemist, level 3: name only, no mechanics in 5e-subclasses.txt export
- `alchemist-3-alchemist-spells` — Alchemist, level 3: name only, no mechanics in 5e-subclasses.txt export
- `alchemist-3-experimental-elixir` — Alchemist, level 3: name only, no mechanics in 5e-subclasses.txt export
- `alchemist-5-alchemical-savant` — Alchemist, level 5: name only, no mechanics in 5e-subclasses.txt export
- `alchemist-9-restorative-reagents` — Alchemist, level 9: name only, no mechanics in 5e-subclasses.txt export
- `alchemist-15-chemical-mastery` — Alchemist, level 15: name only, no mechanics in 5e-subclasses.txt export

### Armorer

- `armorer-3-tools-of-the-trade` — Armorer, level 3: name only, no mechanics in 5e-subclasses.txt export
- `armorer-3-armorer-spells` — Armorer, level 3: name only, no mechanics in 5e-subclasses.txt export
- `armorer-3-arcane-armor` — Armorer, level 3: name only, no mechanics in 5e-subclasses.txt export
- `armorer-3-armor-model` — Armorer, level 3: name only, no mechanics in 5e-subclasses.txt export
- `armorer-5-extra-attack` — Armorer, level 5: name only, no mechanics in 5e-subclasses.txt export
- `armorer-9-armor-modifications` — Armorer, level 9: name only, no mechanics in 5e-subclasses.txt export
- `armorer-15-perfected-armor` — Armorer, level 15: name only, no mechanics in 5e-subclasses.txt export

### Artillerist

- `artillerist-3-tool-proficiency` — Artillerist, level 3: name only, no mechanics in 5e-subclasses.txt export
- `artillerist-3-artillerist-spells` — Artillerist, level 3: name only, no mechanics in 5e-subclasses.txt export
- `artillerist-3-explosive-cannon` — Artillerist, level 3: export labels the 3rd-level feature 'Explosive Cannon' (duplicating the 9th-level name); unsourced either way
- `artillerist-5-arcane-firearm` — Artillerist, level 5: name only, no mechanics in 5e-subclasses.txt export
- `artillerist-9-explosive-cannon` — Artillerist, level 9: name only, no mechanics in 5e-subclasses.txt export
- `artillerist-15-fortified-position` — Artillerist, level 15: name only, no mechanics in 5e-subclasses.txt export

### Battle Smith

- `battle-smith-3-tool-proficiency` — Battle Smith, level 3: name only, no mechanics in 5e-subclasses.txt export
- `battle-smith-3-battle-smith-spells` — Battle Smith, level 3: name only, no mechanics in 5e-subclasses.txt export
- `battle-smith-3-battle-ready` — Battle Smith, level 3: name only, no mechanics in 5e-subclasses.txt export
- `battle-smith-3-steel-defender` — Battle Smith, level 3: companion/pet/summon mechanics need a deliberate pet/companion data model (audit); unsourced
- `battle-smith-5-extra-attack` — Battle Smith, level 5: name only, no mechanics in 5e-subclasses.txt export
- `battle-smith-9-arcane-jolt` — Battle Smith, level 9: name only, no mechanics in 5e-subclasses.txt export
- `battle-smith-15-improved-defender` — Battle Smith, level 15: name only, no mechanics in 5e-subclasses.txt export

## Barbarian

### Path of the Ancestral Guardian

- `path-of-the-ancestral-guardian-3-ancestral-protectors` — Path of the Ancestral Guardian, level 3: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-ancestral-guardian-6-spirit-shield` — Path of the Ancestral Guardian, level 6: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-ancestral-guardian-10-consult-the-spirits` — Path of the Ancestral Guardian, level 10: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-ancestral-guardian-14-vengeful-ancestors` — Path of the Ancestral Guardian, level 14: name only, no mechanics in 5e-subclasses.txt export

### Path of the Battlerager

- `path-of-the-battlerager-3-battlerager-armor` — Path of the Battlerager, level 3: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-battlerager-6-reckless-abandon` — Path of the Battlerager, level 6: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-battlerager-10-battlerager-charge` — Path of the Battlerager, level 10: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-battlerager-14-spiked-retribution` — Path of the Battlerager, level 14: name only, no mechanics in 5e-subclasses.txt export

### Path of the Beast

- `path-of-the-beast-3-form-of-the-beast` — Path of the Beast, level 3: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-beast-6-bestial-soul` — Path of the Beast, level 6: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-beast-10-infectious-fury` — Path of the Beast, level 10: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-beast-14-call-the-hunt` — Path of the Beast, level 14: name only, no mechanics in 5e-subclasses.txt export

### Path of the Berserker

- `path-of-the-berserker-3-frenzy` — Path of the Berserker, level 3: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-berserker-6-mindless-rage` — Path of the Berserker, level 6: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-berserker-10-intimidating-presence` — Path of the Berserker, level 10: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-berserker-14-retaliation` — Path of the Berserker, level 14: name only, no mechanics in 5e-subclasses.txt export

### Path of the Storm Herald

- `path-of-the-storm-herald-3-storm-aura` — Path of the Storm Herald, level 3: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-storm-herald-6-storm-soul` — Path of the Storm Herald, level 6: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-storm-herald-10-shielding-storm` — Path of the Storm Herald, level 10: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-storm-herald-14-raging-storm` — Path of the Storm Herald, level 14: name only, no mechanics in 5e-subclasses.txt export

### Path of the Totem Warrior

- `path-of-the-totem-warrior-3-spirit-seeker` — Path of the Totem Warrior, level 3: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-totem-warrior-3-totem-spirit` — Path of the Totem Warrior, level 3: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-totem-warrior-6-aspect-of-the-beast` — Path of the Totem Warrior, level 6: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-totem-warrior-10-spirit-walker` — Path of the Totem Warrior, level 10: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-totem-warrior-14-totemic-attunement` — Path of the Totem Warrior, level 14: name only, no mechanics in 5e-subclasses.txt export

### Path of the Zealot Herald

- `path-of-the-zealot-herald-3-divine-fury` — Path of the Zealot Herald, level 3: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-zealot-herald-3-warrior-of-gods` — Path of the Zealot Herald, level 3: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-zealot-herald-6-fanatical-focus` — Path of the Zealot Herald, level 6: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-zealot-herald-10-zealous-presence` — Path of the Zealot Herald, level 10: name only, no mechanics in 5e-subclasses.txt export
- `path-of-the-zealot-herald-14-rage-beyond-death` — Path of the Zealot Herald, level 14: name only, no mechanics in 5e-subclasses.txt export

### Path of Wild Magic

- `path-of-wild-magic-3-magic-awareness` — Path of Wild Magic, level 3: name only, no mechanics in 5e-subclasses.txt export
- `path-of-wild-magic-3-wild-surge` — Path of Wild Magic, level 3: name only, no mechanics in 5e-subclasses.txt export
- `path-of-wild-magic-6-bolstering-magic` — Path of Wild Magic, level 6: name only, no mechanics in 5e-subclasses.txt export
- `path-of-wild-magic-10-unstable-backlash` — Path of Wild Magic, level 10: name only, no mechanics in 5e-subclasses.txt export
- `path-of-wild-magic-14-controlled-surge` — Path of Wild Magic, level 14: name only, no mechanics in 5e-subclasses.txt export

## Bard

### College of Creation

- `college-of-creation-3-note-of-potential` — College of Creation, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-creation-3-performance-of-creation` — College of Creation, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-creation-6-animating-performance` — College of Creation, level 6: name only, no mechanics in 5e-subclasses.txt export
- `college-of-creation-14-creative-crescendo` — College of Creation, level 14: name only, no mechanics in 5e-subclasses.txt export

### College of Eloquence

- `college-of-eloquence-3-silver-tongue` — College of Eloquence, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-eloquence-3-unsettling-words` — College of Eloquence, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-eloquence-6-unfailing-inspiration` — College of Eloquence, level 6: name only, no mechanics in 5e-subclasses.txt export
- `college-of-eloquence-6-universal-speech` — College of Eloquence, level 6: name only, no mechanics in 5e-subclasses.txt export
- `college-of-eloquence-14-infectious-inspiration` — College of Eloquence, level 14: name only, no mechanics in 5e-subclasses.txt export

### College of Glamour

- `college-of-glamour-3-mantle-of-inspiration` — College of Glamour, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-glamour-3-enthralling-performance` — College of Glamour, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-glamour-6-mantle-of-majesty` — College of Glamour, level 6: name only, no mechanics in 5e-subclasses.txt export
- `college-of-glamour-14-unbreakable-majesty` — College of Glamour, level 14: name only, no mechanics in 5e-subclasses.txt export

### College of Lore

- `college-of-lore-3-bonus-proficiencies` — College of Lore, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-lore-3-cutting-words` — College of Lore, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-lore-6-additional-magical-secrets` — College of Lore, level 6: name only, no mechanics in 5e-subclasses.txt export
- `college-of-lore-14-peerless-skill` — College of Lore, level 14: name only, no mechanics in 5e-subclasses.txt export

### College of Spirits

- `college-of-spirits-3-guiding-whispers` — College of Spirits, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-spirits-3-spiritual-focus` — College of Spirits, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-spirits-3-tales-from-beyond` — College of Spirits, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-spirits-6-spirit-session` — College of Spirits, level 6: name only, no mechanics in 5e-subclasses.txt export
- `college-of-spirits-14-mystical-connection` — College of Spirits, level 14: name only, no mechanics in 5e-subclasses.txt export

### College of Swords

- `college-of-swords-3-bonus-proficiencies` — College of Swords, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-swords-3-fighting-style` — College of Swords, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-swords-3-blade-flourish` — College of Swords, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-swords-6-extra-attack` — College of Swords, level 6: name only, no mechanics in 5e-subclasses.txt export
- `college-of-swords-14-master-s-flourish` — College of Swords, level 14: name only, no mechanics in 5e-subclasses.txt export

### College of Valor

- `college-of-valor-3-bonus-proficiencies` — College of Valor, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-valor-3-combat-inspiration` — College of Valor, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-valor-6-extra-attack` — College of Valor, level 6: name only, no mechanics in 5e-subclasses.txt export
- `college-of-valor-14-battle-magic` — College of Valor, level 14: name only, no mechanics in 5e-subclasses.txt export

### College of Whispers

- `college-of-whispers-3-psychic-blades` — College of Whispers, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-whispers-3-words-of-terror` — College of Whispers, level 3: name only, no mechanics in 5e-subclasses.txt export
- `college-of-whispers-6-mantle-of-whispers` — College of Whispers, level 6: name only, no mechanics in 5e-subclasses.txt export
- `college-of-whispers-14-shadow-lore` — College of Whispers, level 14: name only, no mechanics in 5e-subclasses.txt export

## Cleric

### Arcana Domain

- `arcana-domain-1-arcane-initiate` — Arcana Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `arcana-domain-2-arcane-abjuration` — Arcana Domain, level 2: name only, no mechanics in 5e-subclasses.txt export
- `arcana-domain-6-spell-breaker` — Arcana Domain, level 6: name only, no mechanics in 5e-subclasses.txt export
- `arcana-domain-8-potent-spellcasting` — Arcana Domain, level 8: spellcasting mechanics unsourced (EK/AT third-caster notes are the only sourced ones)
- `arcana-domain-17-arcane-mastery` — Arcana Domain, level 17: name only, no mechanics in 5e-subclasses.txt export

### Death Domain

- `death-domain-1-bonus-proficiency` — Death Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `death-domain-1-reaper` — Death Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `death-domain-2-channel-divinity-touch-of-death` — Death Domain, level 2: name only, no mechanics in 5e-subclasses.txt export
- `death-domain-6-inescapable-destruction` — Death Domain, level 6: name only, no mechanics in 5e-subclasses.txt export
- `death-domain-8-divine-strike` — Death Domain, level 8: name only, no mechanics in 5e-subclasses.txt export
- `death-domain-17-improved-reaper` — Death Domain, level 17: name only, no mechanics in 5e-subclasses.txt export

### Forge Domain

- `forge-domain-1-bonus-proficiencies` — Forge Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `forge-domain-1-blessing-of-the-forge` — Forge Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `forge-domain-2-channel-divinity-artisan-s-blessing` — Forge Domain, level 2: name only, no mechanics in 5e-subclasses.txt export
- `forge-domain-6-soul-of-the-forge` — Forge Domain, level 6: name only, no mechanics in 5e-subclasses.txt export
- `forge-domain-8-divine-strike` — Forge Domain, level 8: name only, no mechanics in 5e-subclasses.txt export
- `forge-domain-17-saint-of-forge-and-fire` — Forge Domain, level 17: name only, no mechanics in 5e-subclasses.txt export

### Grave Domain

- `grave-domain-1-circle-of-mortality` — Grave Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `grave-domain-1-eyes-of-the-grave` — Grave Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `grave-domain-2-channel-divinity-path-to-the-grave` — Grave Domain, level 2: name only, no mechanics in 5e-subclasses.txt export
- `grave-domain-6-sentinel-at-death-s-door` — Grave Domain, level 6: name only, no mechanics in 5e-subclasses.txt export
- `grave-domain-8-potent-spellcasting` — Grave Domain, level 8: spellcasting mechanics unsourced (EK/AT third-caster notes are the only sourced ones)
- `grave-domain-17-keeper-of-souls` — Grave Domain, level 17: name only, no mechanics in 5e-subclasses.txt export

### Knowledge Domain

- `knowledge-domain-1-blessings-of-knowledge` — Knowledge Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `knowledge-domain-2-channel-divinity-knowledge-of-the-ages` — Knowledge Domain, level 2: name only, no mechanics in 5e-subclasses.txt export
- `knowledge-domain-6-channel-divinity-read-thoughts` — Knowledge Domain, level 6: name only, no mechanics in 5e-subclasses.txt export
- `knowledge-domain-8-potent-spellcasting` — Knowledge Domain, level 8: spellcasting mechanics unsourced (EK/AT third-caster notes are the only sourced ones)
- `knowledge-domain-17-visions-of-the-past` — Knowledge Domain, level 17: name only, no mechanics in 5e-subclasses.txt export

### Life Domain

- `life-domain-1-bonus-proficiency-life-domain` — Life Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `life-domain-1-disciple-of-life` — Life Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `life-domain-2-channel-divinity-preserve-life` — Life Domain, level 2: name only, no mechanics in 5e-subclasses.txt export
- `life-domain-6-blessed-healer` — Life Domain, level 6: name only, no mechanics in 5e-subclasses.txt export
- `life-domain-8-divine-strike` — Life Domain, level 8: name only, no mechanics in 5e-subclasses.txt export
- `life-domain-17-supreme-healing` — Life Domain, level 17: name only, no mechanics in 5e-subclasses.txt export

### Light Domain

- `light-domain-1-bonus-cantrip` — Light Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `light-domain-1-warding-flare` — Light Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `light-domain-2-channel-divinity-radiance-of-the-dawn` — Light Domain, level 2: name only, no mechanics in 5e-subclasses.txt export
- `light-domain-6-improved-flare` — Light Domain, level 6: name only, no mechanics in 5e-subclasses.txt export
- `light-domain-8-potent-spellcasting` — Light Domain, level 8: spellcasting mechanics unsourced (EK/AT third-caster notes are the only sourced ones)
- `light-domain-17-corona-of-light` — Light Domain, level 17: name only, no mechanics in 5e-subclasses.txt export

### Nature Domain

- `nature-domain-1-acolyte-of-nature` — Nature Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `nature-domain-1-bonus-proficiency` — Nature Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `nature-domain-2-channel-divinity-charm-animals-and-plants` — Nature Domain, level 2: name only, no mechanics in 5e-subclasses.txt export
- `nature-domain-6-dampen-elements` — Nature Domain, level 6: name only, no mechanics in 5e-subclasses.txt export
- `nature-domain-8-divine-strike` — Nature Domain, level 8: name only, no mechanics in 5e-subclasses.txt export
- `nature-domain-17-master-of-nature` — Nature Domain, level 17: name only, no mechanics in 5e-subclasses.txt export

### Order Domain

- `order-domain-1-bonus-proficiencies` — Order Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `order-domain-1-voice-of-authority` — Order Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `order-domain-2-channel-divinity-order-s-demand` — Order Domain, level 2: name only, no mechanics in 5e-subclasses.txt export
- `order-domain-6-embodiment-of-the-law` — Order Domain, level 6: name only, no mechanics in 5e-subclasses.txt export
- `order-domain-8-divine-strike` — Order Domain, level 8: name only, no mechanics in 5e-subclasses.txt export
- `order-domain-17-order-s-wrath` — Order Domain, level 17: name only, no mechanics in 5e-subclasses.txt export

### Peace Domain

- `peace-domain-1-implement-of-peace` — Peace Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `peace-domain-1-emboldening-bond` — Peace Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `peace-domain-2-channel-divinity-balm-of-peace` — Peace Domain, level 2: name only, no mechanics in 5e-subclasses.txt export
- `peace-domain-6-protective-bond` — Peace Domain, level 6: name only, no mechanics in 5e-subclasses.txt export
- `peace-domain-8-potent-spellcasting` — Peace Domain, level 8: spellcasting mechanics unsourced (EK/AT third-caster notes are the only sourced ones)
- `peace-domain-17-expansive-bond` — Peace Domain, level 17: name only, no mechanics in 5e-subclasses.txt export

### Tempest Domain

- `tempest-domain-1-bonus-proficiencies` — Tempest Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `tempest-domain-1-wrath-of-the-storm` — Tempest Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `tempest-domain-2-channel-divinity-destructive-wrath` — Tempest Domain, level 2: name only, no mechanics in 5e-subclasses.txt export
- `tempest-domain-6-thunderous-strike` — Tempest Domain, level 6: name only, no mechanics in 5e-subclasses.txt export
- `tempest-domain-8-divine-strike` — Tempest Domain, level 8: name only, no mechanics in 5e-subclasses.txt export
- `tempest-domain-17-stormborn` — Tempest Domain, level 17: name only, no mechanics in 5e-subclasses.txt export

### Trickery Domain

- `trickery-domain-1-blessing-of-the-trickster` — Trickery Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `trickery-domain-2-channel-divinity-invoke-duplicity` — Trickery Domain, level 2: name only, no mechanics in 5e-subclasses.txt export
- `trickery-domain-6-channel-divinity-cloak-of-shadows` — Trickery Domain, level 6: name only, no mechanics in 5e-subclasses.txt export
- `trickery-domain-8-divine-strike` — Trickery Domain, level 8: name only, no mechanics in 5e-subclasses.txt export
- `trickery-domain-17-improved-duplicity` — Trickery Domain, level 17: name only, no mechanics in 5e-subclasses.txt export

### Twilight Domain

- `twilight-domain-1-blessing-of-the-trickster` — Twilight Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `twilight-domain-2-channel-divinity-invoke-duplicity` — Twilight Domain, level 2: name only, no mechanics in 5e-subclasses.txt export
- `twilight-domain-6-channel-divinity-cloak-of-shadows` — Twilight Domain, level 6: name only, no mechanics in 5e-subclasses.txt export
- `twilight-domain-8-divine-strike` — Twilight Domain, level 8: name only, no mechanics in 5e-subclasses.txt export
- `twilight-domain-17-improved-duplicity` — Twilight Domain, level 17: name only, no mechanics in 5e-subclasses.txt export

### War Domain

- `war-domain-1-bonus-proficiency` — War Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `war-domain-1-war-priest` — War Domain, level 1: name only, no mechanics in 5e-subclasses.txt export
- `war-domain-2-channel-divinity-guided-strike` — War Domain, level 2: name only, no mechanics in 5e-subclasses.txt export
- `war-domain-6-channel-divinity-war-god-s-blessing` — War Domain, level 6: name only, no mechanics in 5e-subclasses.txt export
- `war-domain-8-divine-strike` — War Domain, level 8: name only, no mechanics in 5e-subclasses.txt export
- `war-domain-17-avatar-of-battle` — War Domain, level 17: name only, no mechanics in 5e-subclasses.txt export

## Druid

### Circle of Dreams

- `circle-of-dreams-2-balm-of-the-summer-court` — Circle of Dreams, level 2: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-dreams-6-hearth-of-moonlight-and-shadow` — Circle of Dreams, level 6: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-dreams-10-hidden-paths` — Circle of Dreams, level 10: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-dreams-14-walker-in-dreams` — Circle of Dreams, level 14: name only, no mechanics in 5e-subclasses.txt export

### Circle of Spores

- `circle-of-spores-2-circle-spells` — Circle of Spores, level 2: circle-spell list mechanics unsourced (audit templates cover domain/oath spells only)
- `circle-of-spores-2-halo-of-spores` — Circle of Spores, level 2: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-spores-2-symbiotic-entity` — Circle of Spores, level 2: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-spores-6-fungal-infestation` — Circle of Spores, level 6: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-spores-10-spreading-spores` — Circle of Spores, level 10: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-spores-14-fungal-body` — Circle of Spores, level 14: name only, no mechanics in 5e-subclasses.txt export

### Circle of Stars

- `circle-of-stars-2-star-map` — Circle of Stars, level 2: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-stars-2-starry-form` — Circle of Stars, level 2: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-stars-6-cosmic-omen` — Circle of Stars, level 6: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-stars-10-twinkling-constellations` — Circle of Stars, level 10: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-stars-14-full-of-stars` — Circle of Stars, level 14: name only, no mechanics in 5e-subclasses.txt export

### Circle of the Land

- `circle-of-the-land-2-bonus-cantrip-druid` — Circle of the Land, level 2: malformed spell-row text in export ('3rd, 5th, 7th,'); no mechanics — needs a sourced level-2 summary
- `circle-of-the-land-2-natural-recovery` — Circle of the Land, level 2: malformed spell-row text in export ('3rd, 5th, 7th,'); no mechanics — needs a sourced level-2 summary
- `circle-of-the-land-9-circle-spells` — Circle of the Land, level 9: circle-spell list mechanics unsourced (audit templates cover domain/oath spells only)
- `circle-of-the-land-6-land-s-stride-circle-of-the-land` — Circle of the Land, level 6: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-the-land-10-nature-s-ward` — Circle of the Land, level 10: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-the-land-14-nature-s-sanctuary` — Circle of the Land, level 14: name only, no mechanics in 5e-subclasses.txt export

### Circle of the Moon

- `circle-of-the-moon-2-combat-wild-shape` — Circle of the Moon, level 2: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-the-moon-2-circle-forms` — Circle of the Moon, level 2: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-the-moon-6-primal-strike` — Circle of the Moon, level 6: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-the-moon-6-circle-forms-improvement` — Circle of the Moon, level 6: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-the-moon-10-elemental-wild-shape` — Circle of the Moon, level 10: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-the-moon-14-thousand-forms` — Circle of the Moon, level 14: name only, no mechanics in 5e-subclasses.txt export

### Circle of the Shepherd

- `circle-of-the-shephard-2-speech-of-the-woods` — Circle of the Shepherd, level 2: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-the-shephard-2-spirit-totem` — Circle of the Shepherd, level 2: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-the-shephard-6-mighty-summoner` — Circle of the Shepherd, level 6: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-the-shephard-10-guardian-spirit` — Circle of the Shepherd, level 10: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-the-shephard-14-faithful-summons` — Circle of the Shepherd, level 14: name only, no mechanics in 5e-subclasses.txt export

### Circle of Wildfire

- `circle-of-wildfire-2-circle-spells` — Circle of Wildfire, level 2: circle-spell list mechanics unsourced (audit templates cover domain/oath spells only)
- `circle-of-wildfire-2-summon-wildfire-spirit` — Circle of Wildfire, level 2: companion/pet/summon mechanics need a deliberate pet/companion data model (audit); unsourced
- `circle-of-wildfire-6-enhanced-bond` — Circle of Wildfire, level 6: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-wildfire-10-cauterizing-flames` — Circle of Wildfire, level 10: name only, no mechanics in 5e-subclasses.txt export
- `circle-of-wildfire-14-blazing-revival` — Circle of Wildfire, level 14: name only, no mechanics in 5e-subclasses.txt export

## Fighter

### Arcane Archer

- `arcane-archer-3-arcane-archer-lore` — Arcane Archer, level 3: name only, no mechanics in 5e-subclasses.txt export
- `arcane-archer-3-arcane-shot-2-options` — Arcane Archer, level 3: name only, no mechanics in 5e-subclasses.txt export
- `arcane-archer-7-curving-shot` — Arcane Archer, level 7: name only, no mechanics in 5e-subclasses.txt export
- `arcane-archer-7-magic-arrow` — Arcane Archer, level 7: name only, no mechanics in 5e-subclasses.txt export
- `arcane-archer-7-arcane-shot-3-options` — Arcane Archer, level 7: name only, no mechanics in 5e-subclasses.txt export
- `arcane-archer-10-arcane-shot-4-options` — Arcane Archer, level 10: name only, no mechanics in 5e-subclasses.txt export
- `arcane-archer-15-ready-shot` — Arcane Archer, level 15: name only, no mechanics in 5e-subclasses.txt export
- `arcane-archer-15-arcane-shot-5-options` — Arcane Archer, level 15: name only, no mechanics in 5e-subclasses.txt export
- `arcane-archer-18-arcane-shot-6-options` — Arcane Archer, level 18: name only, no mechanics in 5e-subclasses.txt export
- `arcane-archer-18-improved-shots` — Arcane Archer, level 18: name only, no mechanics in 5e-subclasses.txt export

### Banneret

- `banneret-3-rallying-cry` — Banneret, level 3: name only, no mechanics in 5e-subclasses.txt export
- `banneret-7-royal-envoy` — Banneret, level 7: name only, no mechanics in 5e-subclasses.txt export
- `banneret-10-inspiring-surge-one-ally` — Banneret, level 10: name only, no mechanics in 5e-subclasses.txt export
- `banneret-15-bulwark` — Banneret, level 15: name only, no mechanics in 5e-subclasses.txt export
- `banneret-18-inspiring-surge-two-allies` — Banneret, level 18: name only, no mechanics in 5e-subclasses.txt export

### Battle Master

- `battle-master-3-combat-superiority-d8` — Battle Master, level 3: name only, no mechanics in 5e-subclasses.txt export
- `battle-master-3-student-of-war` — Battle Master, level 3: name only, no mechanics in 5e-subclasses.txt export
- `battle-master-7-know-your-enemy` — Battle Master, level 7: name only, no mechanics in 5e-subclasses.txt export
- `battle-master-10-combat-superiority-d10` — Battle Master, level 10: name only, no mechanics in 5e-subclasses.txt export
- `battle-master-15-relentless` — Battle Master, level 15: name only, no mechanics in 5e-subclasses.txt export
- `battle-master-18-combat-superiority-d12` — Battle Master, level 18: name only, no mechanics in 5e-subclasses.txt export

### Cavalier

- `cavalier-3-bonus-proficiency` — Cavalier, level 3: name only, no mechanics in 5e-subclasses.txt export
- `cavalier-3-born-to-the-saddle` — Cavalier, level 3: name only, no mechanics in 5e-subclasses.txt export
- `cavalier-3-unwavering-mark` — Cavalier, level 3: name only, no mechanics in 5e-subclasses.txt export
- `cavalier-7-warding-maneuver` — Cavalier, level 7: name only, no mechanics in 5e-subclasses.txt export
- `cavalier-10-hold-the-line` — Cavalier, level 10: name only, no mechanics in 5e-subclasses.txt export
- `cavalier-15-ferocious-charger` — Cavalier, level 15: name only, no mechanics in 5e-subclasses.txt export
- `cavalier-18-vigilant-defender` — Cavalier, level 18: name only, no mechanics in 5e-subclasses.txt export

### Champion

- `champion-3-improved-critical` — Champion, level 3: name only, no mechanics in 5e-subclasses.txt export
- `champion-7-remarkable-athlete` — Champion, level 7: name only, no mechanics in 5e-subclasses.txt export
- `champion-10-additional-fighting-style` — Champion, level 10: name only, no mechanics in 5e-subclasses.txt export
- `champion-15-superior-critical` — Champion, level 15: name only, no mechanics in 5e-subclasses.txt export
- `champion-18-survivor` — Champion, level 18: name only, no mechanics in 5e-subclasses.txt export

### Echo Knight

- `echo-knight-3-manifest-echo` — Echo Knight, level 3: name only, no mechanics in 5e-subclasses.txt export
- `echo-knight-3-unleash-incarnation` — Echo Knight, level 3: name only, no mechanics in 5e-subclasses.txt export
- `echo-knight-7-echo-avatar` — Echo Knight, level 7: name only, no mechanics in 5e-subclasses.txt export
- `echo-knight-10-shadow-martyr` — Echo Knight, level 10: name only, no mechanics in 5e-subclasses.txt export
- `echo-knight-15-reclaim-potential` — Echo Knight, level 15: name only, no mechanics in 5e-subclasses.txt export
- `echo-knight-18-legion-of-one` — Echo Knight, level 18: name only, no mechanics in 5e-subclasses.txt export

### Eldritch Knight

- `eldritch-knight-3-weapon-bond` — Eldritch Knight, level 3: name only, no mechanics in 5e-subclasses.txt export
- `eldritch-knight-7-war-magic` — Eldritch Knight, level 7: name only, no mechanics in 5e-subclasses.txt export
- `eldritch-knight-10-eldritch-strike` — Eldritch Knight, level 10: name only, no mechanics in 5e-subclasses.txt export
- `eldritch-knight-15-arcane-charge` — Eldritch Knight, level 15: name only, no mechanics in 5e-subclasses.txt export
- `eldritch-knight-18-improved-war-magic` — Eldritch Knight, level 18: name only, no mechanics in 5e-subclasses.txt export

### Psi Warrior

- `psi-warrior-3-psionic-power-3-psionic-powers` — Psi Warrior, level 3: name only, no mechanics in 5e-subclasses.txt export
- `psi-warrior-7-telekinetic-adept-5-psionic-powers` — Psi Warrior, level 7: name only, no mechanics in 5e-subclasses.txt export
- `psi-warrior-10-guarded-mind` — Psi Warrior, level 10: name only, no mechanics in 5e-subclasses.txt export
- `psi-warrior-15-bulwark-of-force` — Psi Warrior, level 15: name only, no mechanics in 5e-subclasses.txt export
- `psi-warrior-18-telekinetic-master` — Psi Warrior, level 18: name only, no mechanics in 5e-subclasses.txt export

### Rune Knight

- `rune-knight-3-bonus-proficiencies` — Rune Knight, level 3: name only, no mechanics in 5e-subclasses.txt export
- `rune-knight-3-rune-carver` — Rune Knight, level 3: name only, no mechanics in 5e-subclasses.txt export
- `rune-knight-3-giant-might` — Rune Knight, level 3: name only, no mechanics in 5e-subclasses.txt export
- `rune-knight-7-runic-shield` — Rune Knight, level 7: name only, no mechanics in 5e-subclasses.txt export
- `rune-knight-10-great-stature` — Rune Knight, level 10: name only, no mechanics in 5e-subclasses.txt export
- `rune-knight-15-master-of-runes` — Rune Knight, level 15: name only, no mechanics in 5e-subclasses.txt export
- `rune-knight-18-runic-juggernaut` — Rune Knight, level 18: name only, no mechanics in 5e-subclasses.txt export

### Samurai

- `samurai-3-bonus-proficiency` — Samurai, level 3: name only, no mechanics in 5e-subclasses.txt export
- `samurai-3-fighting-spirit` — Samurai, level 3: name only, no mechanics in 5e-subclasses.txt export
- `samurai-7-elegant-courtier` — Samurai, level 7: name only, no mechanics in 5e-subclasses.txt export
- `samurai-10-tireless-spirit` — Samurai, level 10: name only, no mechanics in 5e-subclasses.txt export
- `samurai-15-rapid-strike` — Samurai, level 15: name only, no mechanics in 5e-subclasses.txt export
- `samurai-18-strength-before-death` — Samurai, level 18: name only, no mechanics in 5e-subclasses.txt export

## Monk

### Way of Mercy

- `way-of-mercy-3-implements-of-mercy` — Way of Mercy, level 3: name only, no mechanics in 5e-subclasses.txt export
- `way-of-mercy-3-hands-of-healing` — Way of Mercy, level 3: name only, no mechanics in 5e-subclasses.txt export
- `way-of-mercy-3-hands-of-harm` — Way of Mercy, level 3: name only, no mechanics in 5e-subclasses.txt export
- `way-of-mercy-6-physician-s-touch` — Way of Mercy, level 6: name only, no mechanics in 5e-subclasses.txt export
- `way-of-mercy-11-flurry-of-healing-and-harm` — Way of Mercy, level 11: name only, no mechanics in 5e-subclasses.txt export
- `way-of-mercy-17-hand-of-ultimate-mercy` — Way of Mercy, level 17: name only, no mechanics in 5e-subclasses.txt export

### Way of Shadow

- `way-of-shadow-3-shadow-arts` — Way of Shadow, level 3: name only, no mechanics in 5e-subclasses.txt export
- `way-of-shadow-6-shadow-step` — Way of Shadow, level 6: name only, no mechanics in 5e-subclasses.txt export
- `way-of-shadow-11-cloak-of-shadows` — Way of Shadow, level 11: name only, no mechanics in 5e-subclasses.txt export
- `way-of-shadow-17-opportunist` — Way of Shadow, level 17: name only, no mechanics in 5e-subclasses.txt export

### Way of the Ascendant Dragon

- `way-of-the-ascendant-dragon-3-draconic-disciple` — Way of the Ascendant Dragon, level 3: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-ascendant-dragon-3-breath-of-the-dragon` — Way of the Ascendant Dragon, level 3: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-ascendant-dragon-6-wings-unfurled` — Way of the Ascendant Dragon, level 6: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-ascendant-dragon-11-aspect-of-the-wyrm` — Way of the Ascendant Dragon, level 11: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-ascendant-dragon-17-ascendant-aspect` — Way of the Ascendant Dragon, level 17: name only, no mechanics in 5e-subclasses.txt export

### Way of the Astral Self

- `way-of-the-astral-self-3-arms-of-the-astral-self` — Way of the Astral Self, level 3: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-astral-self-6-visage-of-the-astral-self` — Way of the Astral Self, level 6: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-astral-self-11-body-of-the-astral-self` — Way of the Astral Self, level 11: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-astral-self-17-awakened-astral-self` — Way of the Astral Self, level 17: name only, no mechanics in 5e-subclasses.txt export

### Way of the Drunken Master

- `way-of-the-drunken-master-3-bonus-proficiencies` — Way of the Drunken Master, level 3: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-drunken-master-3-drunken-technique` — Way of the Drunken Master, level 3: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-drunken-master-6-tipsy-sway` — Way of the Drunken Master, level 6: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-drunken-master-11-drunkard-s-luck` — Way of the Drunken Master, level 11: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-drunken-master-17-intoxicated-frenzy` — Way of the Drunken Master, level 17: name only, no mechanics in 5e-subclasses.txt export

### Way of the Four Elements

- `way-of-the-four-elements-3-disciple-of-the-elements` — Way of the Four Elements, level 3: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-four-elements-6-additional-elemental-discipline` — Way of the Four Elements, level 6: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-four-elements-11-additional-elemental-discipline` — Way of the Four Elements, level 11: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-four-elements-17-additional-elemental-discipline` — Way of the Four Elements, level 17: name only, no mechanics in 5e-subclasses.txt export

### Way of the Kensei

- `way-of-the-kensei-3-path-of-the-kensei` — Way of the Kensei, level 3: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-kensei-6-one-with-the-blade` — Way of the Kensei, level 6: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-kensei-11-sharpen-the-blade` — Way of the Kensei, level 11: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-kensei-17-unerring-accuracy` — Way of the Kensei, level 17: name only, no mechanics in 5e-subclasses.txt export

### Way of the Long Death

- `way-of-the-long-death-3-touch-of-death` — Way of the Long Death, level 3: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-long-death-6-hour-of-reaping` — Way of the Long Death, level 6: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-long-death-11-mastery-of-death` — Way of the Long Death, level 11: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-long-death-17-touch-of-the-long-death` — Way of the Long Death, level 17: name only, no mechanics in 5e-subclasses.txt export

### Way of the Open Hand

- `way-of-the-open-hand-3-open-hand-technique` — Way of the Open Hand, level 3: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-open-hand-6-wholeness-of-body` — Way of the Open Hand, level 6: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-open-hand-11-tranquility` — Way of the Open Hand, level 11: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-open-hand-17-quivering-palm` — Way of the Open Hand, level 17: name only, no mechanics in 5e-subclasses.txt export

### Way of the Sun Soul

- `way-of-the-sun-soul-3-radiant-sun-bolt` — Way of the Sun Soul, level 3: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-sun-soul-6-searing-arc-strike` — Way of the Sun Soul, level 6: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-sun-soul-11-searing-sunburst` — Way of the Sun Soul, level 11: name only, no mechanics in 5e-subclasses.txt export
- `way-of-the-sun-soul-17-sun-shield` — Way of the Sun Soul, level 17: name only, no mechanics in 5e-subclasses.txt export

## Paladin

### Oath of Conquest

- `oath-of-conquest-3-tenets-of-conquest` — Oath of Conquest, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-conquest-3-conquering-presence` — Oath of Conquest, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-conquest-3-guided-strike` — Oath of Conquest, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-conquest-7-aura-of-conquest` — Oath of Conquest, level 7: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-conquest-15-scornful-rebuke` — Oath of Conquest, level 15: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-conquest-20-invincible-conqueror` — Oath of Conquest, level 20: name only, no mechanics in 5e-subclasses.txt export

### Oath of Devotion

- `oath-of-devotion-3-tenets-of-devotion` — Oath of Devotion, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-devotion-3-sacred-weapon` — Oath of Devotion, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-devotion-3-turn-the-unholy` — Oath of Devotion, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-devotion-7-aura-of-devotion` — Oath of Devotion, level 7: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-devotion-15-purity-of-spirit` — Oath of Devotion, level 15: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-devotion-20-holy-nimbus` — Oath of Devotion, level 20: name only, no mechanics in 5e-subclasses.txt export

### Oath of Glory

- `oath-of-glory-3-tenets-of-glory` — Oath of Glory, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-glory-3-peerless-athlete` — Oath of Glory, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-glory-3-inspiring-smite` — Oath of Glory, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-glory-7-aura-of-alacrity` — Oath of Glory, level 7: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-glory-15-glorious-defense` — Oath of Glory, level 15: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-glory-20-living-legend` — Oath of Glory, level 20: name only, no mechanics in 5e-subclasses.txt export

### Oath of Redemption

- `oath-of-redemption-3-tenets-of-redemption` — Oath of Redemption, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-redemption-3-emissary-of-peace` — Oath of Redemption, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-redemption-3-rebuke-the-violent` — Oath of Redemption, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-redemption-7-aura-of-the-guardian` — Oath of Redemption, level 7: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-redemption-15-protective-spirit` — Oath of Redemption, level 15: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-redemption-20-emissary-of-redemption` — Oath of Redemption, level 20: name only, no mechanics in 5e-subclasses.txt export

### Oath of the Ancients

- `oath-of-the-ancients-3-tenets-of-the-ancients` — Oath of the Ancients, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-the-ancients-3-nature-s-wrath` — Oath of the Ancients, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-the-ancients-3-turn-the-faithless` — Oath of the Ancients, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-the-ancients-7-aura-of-warding` — Oath of the Ancients, level 7: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-the-ancients-15-undying-sentinel` — Oath of the Ancients, level 15: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-the-ancients-20-undying-sentinel` — Oath of the Ancients, level 20: name only, no mechanics in 5e-subclasses.txt export

### Oath of the Crown

- `oath-of-the-crown-3-tenets-of-the-crown` — Oath of the Crown, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-the-crown-3-champion-challenge` — Oath of the Crown, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-the-crown-3-turn-the-tide` — Oath of the Crown, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-the-crown-7-divine-allegiance` — Oath of the Crown, level 7: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-the-crown-15-unyielding-saint` — Oath of the Crown, level 15: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-the-crown-20-exalted-champion` — Oath of the Crown, level 20: name only, no mechanics in 5e-subclasses.txt export

### Oath of the Watchers

- `oath-of-the-watchers-3-tenets-of-the-watchers` — Oath of the Watchers, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-the-watchers-3-watcher-s-will` — Oath of the Watchers, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-the-watchers-3-abjure-the-extraplanar` — Oath of the Watchers, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-the-watchers-7-aura-of-the-sentinel` — Oath of the Watchers, level 7: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-the-watchers-15-vigilant-rebuke` — Oath of the Watchers, level 15: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-the-watchers-20-mortal-bulwark` — Oath of the Watchers, level 20: name only, no mechanics in 5e-subclasses.txt export

### Oath of Vengeance

- `oath-of-vengeance-3-tenets-of-vengeance` — Oath of Vengeance, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-vengeance-3-abjure-enemy` — Oath of Vengeance, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-vengeance-3-vow-of-emnity` — Oath of Vengeance, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-vengeance-7-relentless-avenger` — Oath of Vengeance, level 7: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-vengeance-15-soul-of-vengeance` — Oath of Vengeance, level 15: name only, no mechanics in 5e-subclasses.txt export
- `oath-of-vengeance-20-avenging-angel` — Oath of Vengeance, level 20: name only, no mechanics in 5e-subclasses.txt export

### Oathbreaker

- `oathbreaker-3-control-undead` — Oathbreaker, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oathbreaker-3-dreadful-aspect` — Oathbreaker, level 3: name only, no mechanics in 5e-subclasses.txt export
- `oathbreaker-7-aura-of-hate` — Oathbreaker, level 7: name only, no mechanics in 5e-subclasses.txt export
- `oathbreaker-15-supernatural-resistance` — Oathbreaker, level 15: name only, no mechanics in 5e-subclasses.txt export
- `oathbreaker-20-dread-lord` — Oathbreaker, level 20: name only, no mechanics in 5e-subclasses.txt export

## Ranger

### Beast Master Conclave

- `beast-master-conclave-3-primal-companion-optional` — Beast Master Conclave, level 3: companion/pet/summon mechanics need a deliberate pet/companion data model (audit); unsourced
- `beast-master-conclave-7-exceptional-training` — Beast Master Conclave, level 7: companion/pet/summon mechanics need a deliberate pet/companion data model (audit); unsourced
- `beast-master-conclave-11-bestial-fury` — Beast Master Conclave, level 11: companion/pet/summon mechanics need a deliberate pet/companion data model (audit); unsourced
- `beast-master-conclave-15-share-spells` — Beast Master Conclave, level 15: companion/pet/summon mechanics need a deliberate pet/companion data model (audit); unsourced

### Drakewarden

- `drakewarden-3-draconic-gift` — Drakewarden, level 3: companion/pet/summon mechanics need a deliberate pet/companion data model (audit); unsourced
- `drakewarden-3-drake-companion` — Drakewarden, level 3: companion/pet/summon mechanics need a deliberate pet/companion data model (audit); unsourced
- `drakewarden-7-bond-of-fang-and-scale` — Drakewarden, level 7: companion/pet/summon mechanics need a deliberate pet/companion data model (audit); unsourced
- `drakewarden-11-drake-s-breath` — Drakewarden, level 11: companion/pet/summon mechanics need a deliberate pet/companion data model (audit); unsourced
- `drakewarden-15-perfected-bond` — Drakewarden, level 15: companion/pet/summon mechanics need a deliberate pet/companion data model (audit); unsourced

### Fey Wanderer

- `fey-wanderer-3-dreadful-strikes` — Fey Wanderer, level 3: name only, no mechanics in 5e-subclasses.txt export
- `fey-wanderer-3-fey-wanderer-magic` — Fey Wanderer, level 3: name only, no mechanics in 5e-subclasses.txt export
- `fey-wanderer-7-beguiling-twist` — Fey Wanderer, level 7: name only, no mechanics in 5e-subclasses.txt export
- `fey-wanderer-11-fey-reinforcements` — Fey Wanderer, level 11: name only, no mechanics in 5e-subclasses.txt export
- `fey-wanderer-15-misty-wanderer` — Fey Wanderer, level 15: name only, no mechanics in 5e-subclasses.txt export

### Gloom Stalker Conclave

- `gloom-stalker-conclave-3-gloom-stalker-magic` — Gloom Stalker Conclave, level 3: name only, no mechanics in 5e-subclasses.txt export
- `gloom-stalker-conclave-3-dread-ambusher` — Gloom Stalker Conclave, level 3: name only, no mechanics in 5e-subclasses.txt export
- `gloom-stalker-conclave-3-umbral-sight` — Gloom Stalker Conclave, level 3: name only, no mechanics in 5e-subclasses.txt export
- `gloom-stalker-conclave-7-iron-mind` — Gloom Stalker Conclave, level 7: name only, no mechanics in 5e-subclasses.txt export
- `gloom-stalker-conclave-11-stalker-s-flurry` — Gloom Stalker Conclave, level 11: name only, no mechanics in 5e-subclasses.txt export
- `gloom-stalker-conclave-15-shadowy-dodge` — Gloom Stalker Conclave, level 15: name only, no mechanics in 5e-subclasses.txt export

### Horizon Walker Conclave

- `horizon-walker-conclave-3-horizon-walker-magic` — Horizon Walker Conclave, level 3: name only, no mechanics in 5e-subclasses.txt export
- `horizon-walker-conclave-3-detect-portal` — Horizon Walker Conclave, level 3: name only, no mechanics in 5e-subclasses.txt export
- `horizon-walker-conclave-3-planar-warrior` — Horizon Walker Conclave, level 3: name only, no mechanics in 5e-subclasses.txt export
- `horizon-walker-conclave-7-ethereal-step` — Horizon Walker Conclave, level 7: name only, no mechanics in 5e-subclasses.txt export
- `horizon-walker-conclave-11-distant-strike` — Horizon Walker Conclave, level 11: name only, no mechanics in 5e-subclasses.txt export
- `horizon-walker-conclave-15-spectral-defense` — Horizon Walker Conclave, level 15: name only, no mechanics in 5e-subclasses.txt export

### Hunter Conclave

- `hunter-conclave-3-hunter-s-prey` — Hunter Conclave, level 3: name only, no mechanics in 5e-subclasses.txt export
- `hunter-conclave-7-defensive-tactics` — Hunter Conclave, level 7: name only, no mechanics in 5e-subclasses.txt export
- `hunter-conclave-11-multiattack` — Hunter Conclave, level 11: name only, no mechanics in 5e-subclasses.txt export
- `hunter-conclave-15-superior-hunter-s-defense` — Hunter Conclave, level 15: name only, no mechanics in 5e-subclasses.txt export

### Monster Slayer Conclave

- `monster-slayer-conclave-3-monster-slayer-magic` — Monster Slayer Conclave, level 3: name only, no mechanics in 5e-subclasses.txt export
- `monster-slayer-conclave-3-hunter-s-sense` — Monster Slayer Conclave, level 3: name only, no mechanics in 5e-subclasses.txt export
- `monster-slayer-conclave-3-slayer-s-prey` — Monster Slayer Conclave, level 3: name only, no mechanics in 5e-subclasses.txt export
- `monster-slayer-conclave-7-supernatural-defense` — Monster Slayer Conclave, level 7: name only, no mechanics in 5e-subclasses.txt export
- `monster-slayer-conclave-11-user-s-nemesis` — Monster Slayer Conclave, level 11: name only, no mechanics in 5e-subclasses.txt export
- `monster-slayer-conclave-15-slayer-s-counter` — Monster Slayer Conclave, level 15: name only, no mechanics in 5e-subclasses.txt export

### Swarmkeeper

- `swarmkeeper-3-gathered-swarm` — Swarmkeeper, level 3: name only, no mechanics in 5e-subclasses.txt export
- `swarmkeeper-3-swarmkeeper-magic` — Swarmkeeper, level 3: name only, no mechanics in 5e-subclasses.txt export
- `swarmkeeper-7-writhing-tide` — Swarmkeeper, level 7: name only, no mechanics in 5e-subclasses.txt export
- `swarmkeeper-11-mighty-swarm` — Swarmkeeper, level 11: name only, no mechanics in 5e-subclasses.txt export
- `swarmkeeper-15-swarming-dispersal` — Swarmkeeper, level 15: name only, no mechanics in 5e-subclasses.txt export

## Rogue

### Arcane Trickster

- `arcane-trickster-3-mage-hand-legerdemain` — Arcane Trickster, level 3: name only, no mechanics in 5e-subclasses.txt export
- `arcane-trickster-3-mage-hand` — Arcane Trickster, level 3: name only, no mechanics in 5e-subclasses.txt export
- `arcane-trickster-9-magical-ambush` — Arcane Trickster, level 9: name only, no mechanics in 5e-subclasses.txt export
- `arcane-trickster-13-versatile-trickster` — Arcane Trickster, level 13: name only, no mechanics in 5e-subclasses.txt export
- `arcane-trickster-17-spell-thief` — Arcane Trickster, level 17: name only, no mechanics in 5e-subclasses.txt export

### Assassin

- `assassin-3-assassinate` — Assassin, level 3: name only, no mechanics in 5e-subclasses.txt export
- `assassin-3-bonus-proficiencies` — Assassin, level 3: name only, no mechanics in 5e-subclasses.txt export
- `assassin-9-infiltration-expertise` — Assassin, level 9: name only, no mechanics in 5e-subclasses.txt export
- `assassin-13-impostor` — Assassin, level 13: name only, no mechanics in 5e-subclasses.txt export
- `assassin-17-death-strike` — Assassin, level 17: name only, no mechanics in 5e-subclasses.txt export

### Inquisitive

- `inquisitive-3-ear-for-deceit` — Inquisitive, level 3: name only, no mechanics in 5e-subclasses.txt export
- `inquisitive-3-eye-for-detail` — Inquisitive, level 3: name only, no mechanics in 5e-subclasses.txt export
- `inquisitive-3-insightful-fighting` — Inquisitive, level 3: name only, no mechanics in 5e-subclasses.txt export
- `inquisitive-9-steady-eye` — Inquisitive, level 9: name only, no mechanics in 5e-subclasses.txt export
- `inquisitive-13-unerring-eye` — Inquisitive, level 13: name only, no mechanics in 5e-subclasses.txt export
- `inquisitive-17-eye-for-weakness` — Inquisitive, level 17: name only, no mechanics in 5e-subclasses.txt export

### Mastermind

- `mastermind-3-master-of-intrigue` — Mastermind, level 3: name only, no mechanics in 5e-subclasses.txt export
- `mastermind-3-master-of-tactics` — Mastermind, level 3: name only, no mechanics in 5e-subclasses.txt export
- `mastermind-9-insightful-manipulator` — Mastermind, level 9: name only, no mechanics in 5e-subclasses.txt export
- `mastermind-13-misdirection` — Mastermind, level 13: name only, no mechanics in 5e-subclasses.txt export
- `mastermind-17-soul-of-deceit` — Mastermind, level 17: name only, no mechanics in 5e-subclasses.txt export

### Phantom

- `phantom-3-whispers-of-the-dead` — Phantom, level 3: name only, no mechanics in 5e-subclasses.txt export
- `phantom-3-wails-from-the-grave` — Phantom, level 3: name only, no mechanics in 5e-subclasses.txt export
- `phantom-9-tokens-of-the-departed` — Phantom, level 9: name only, no mechanics in 5e-subclasses.txt export
- `phantom-13-ghost-walk` — Phantom, level 13: name only, no mechanics in 5e-subclasses.txt export
- `phantom-17-death-knell` — Phantom, level 17: name only, no mechanics in 5e-subclasses.txt export

### Scout

- `scout-3-skirmisher` — Scout, level 3: name only, no mechanics in 5e-subclasses.txt export
- `scout-3-survivalist` — Scout, level 3: name only, no mechanics in 5e-subclasses.txt export
- `scout-9-superior-mobility` — Scout, level 9: name only, no mechanics in 5e-subclasses.txt export
- `scout-13-ambush-master` — Scout, level 13: name only, no mechanics in 5e-subclasses.txt export
- `scout-17-sudden-strike` — Scout, level 17: name only, no mechanics in 5e-subclasses.txt export

### Soulknife

- `soulknife-3-psionic-power` — Soulknife, level 3: name only, no mechanics in 5e-subclasses.txt export
- `soulknife-3-psionic-energy` — Soulknife, level 3: name only, no mechanics in 5e-subclasses.txt export
- `soulknife-3-bolstered-knack` — Soulknife, level 3: name only, no mechanics in 5e-subclasses.txt export
- `soulknife-3-psychic-whispers` — Soulknife, level 3: name only, no mechanics in 5e-subclasses.txt export
- `soulknife-3-psychic-blades` — Soulknife, level 3: name only, no mechanics in 5e-subclasses.txt export
- `soulknife-9-homing-strikes` — Soulknife, level 9: name only, no mechanics in 5e-subclasses.txt export
- `soulknife-9-psychic-teleportation` — Soulknife, level 9: name only, no mechanics in 5e-subclasses.txt export
- `soulknife-13-psychic-veil` — Soulknife, level 13: name only, no mechanics in 5e-subclasses.txt export
- `soulknife-17-rend-mind` — Soulknife, level 17: name only, no mechanics in 5e-subclasses.txt export

### Swashbuckler

- `swashbuckler-3-fancy-footwork` — Swashbuckler, level 3: name only, no mechanics in 5e-subclasses.txt export
- `swashbuckler-3-rakish-audacity` — Swashbuckler, level 3: name only, no mechanics in 5e-subclasses.txt export
- `swashbuckler-9-panache` — Swashbuckler, level 9: name only, no mechanics in 5e-subclasses.txt export
- `swashbuckler-13-elegant-maneuver` — Swashbuckler, level 13: name only, no mechanics in 5e-subclasses.txt export
- `swashbuckler-17-master-duelist` — Swashbuckler, level 17: name only, no mechanics in 5e-subclasses.txt export

### Thief

- `thief-3-fast-hands` — Thief, level 3: name only, no mechanics in 5e-subclasses.txt export
- `thief-3-story-work` — Thief, level 3: name only, no mechanics in 5e-subclasses.txt export
- `thief-9-supreme-sneak` — Thief, level 9: name only, no mechanics in 5e-subclasses.txt export
- `thief-13-use-magic-device` — Thief, level 13: name only, no mechanics in 5e-subclasses.txt export
- `thief-17-thief-s-reflexes` — Thief, level 17: name only, no mechanics in 5e-subclasses.txt export

## Sorcerer

### Aberrant Mind

- `aberrant-mind-1-psionic-spells` — Aberrant Mind, level 1: level-gated spell-replacement mechanics unsourced (audit: do not treat as immediately known)
- `aberrant-mind-1-telepathic-speech` — Aberrant Mind, level 1: name only, no mechanics in 5e-subclasses.txt export
- `aberrant-mind-6-psionic-sorcery` — Aberrant Mind, level 6: name only, no mechanics in 5e-subclasses.txt export
- `aberrant-mind-6-psychic-defenses` — Aberrant Mind, level 6: name only, no mechanics in 5e-subclasses.txt export
- `aberrant-mind-14-revelation-in-flesh` — Aberrant Mind, level 14: name only, no mechanics in 5e-subclasses.txt export
- `aberrant-mind-18-warping-implosion` — Aberrant Mind, level 18: name only, no mechanics in 5e-subclasses.txt export

### Clockwork Soul

- `clockwork-soul-1-clockwork-magic` — Clockwork Soul, level 1: name only, no mechanics in 5e-subclasses.txt export
- `clockwork-soul-1-restore-balance` — Clockwork Soul, level 1: name only, no mechanics in 5e-subclasses.txt export
- `clockwork-soul-6-bastion-of-law` — Clockwork Soul, level 6: name only, no mechanics in 5e-subclasses.txt export
- `clockwork-soul-14-trance-of-order` — Clockwork Soul, level 14: name only, no mechanics in 5e-subclasses.txt export
- `clockwork-soul-18-clockwork-cavalcade` — Clockwork Soul, level 18: name only, no mechanics in 5e-subclasses.txt export

### Divine Soul

- `divine-soul-1-divine-magic` — Divine Soul, level 1: name only, no mechanics in 5e-subclasses.txt export
- `divine-soul-1-favored-by-the-gods` — Divine Soul, level 1: name only, no mechanics in 5e-subclasses.txt export
- `divine-soul-6-empowered-healing` — Divine Soul, level 6: name only, no mechanics in 5e-subclasses.txt export
- `divine-soul-14-angelic-form` — Divine Soul, level 14: name only, no mechanics in 5e-subclasses.txt export
- `divine-soul-18-unearthly-recovery` — Divine Soul, level 18: name only, no mechanics in 5e-subclasses.txt export

### Draconic Bloodline

- `draconic-bloodline-1-dragon-ancestor` — Draconic Bloodline, level 1: name only, no mechanics in 5e-subclasses.txt export
- `draconic-bloodline-1-draconic-resilience` — Draconic Bloodline, level 1: name only, no mechanics in 5e-subclasses.txt export
- `draconic-bloodline-6-elemental-affinity` — Draconic Bloodline, level 6: name only, no mechanics in 5e-subclasses.txt export
- `draconic-bloodline-14-dragon-wings` — Draconic Bloodline, level 14: name only, no mechanics in 5e-subclasses.txt export
- `draconic-bloodline-18-draconic-presence` — Draconic Bloodline, level 18: name only, no mechanics in 5e-subclasses.txt export

### Shadow Magic

- `shadow-magic-1-eyes-of-the-dark` — Shadow Magic, level 1: name only, no mechanics in 5e-subclasses.txt export
- `shadow-magic-1-strength-of-the-grave` — Shadow Magic, level 1: name only, no mechanics in 5e-subclasses.txt export
- `shadow-magic-6-hound-of-ill-omen` — Shadow Magic, level 6: name only, no mechanics in 5e-subclasses.txt export
- `shadow-magic-14-shadow-walk` — Shadow Magic, level 14: name only, no mechanics in 5e-subclasses.txt export
- `shadow-magic-18-umbral-form` — Shadow Magic, level 18: name only, no mechanics in 5e-subclasses.txt export

### Storm Sorcery

- `storm-sorcery-1-wind-speaker` — Storm Sorcery, level 1: name only, no mechanics in 5e-subclasses.txt export
- `storm-sorcery-1-tempestuous-magic` — Storm Sorcery, level 1: name only, no mechanics in 5e-subclasses.txt export
- `storm-sorcery-6-heart-of-the-storm` — Storm Sorcery, level 6: name only, no mechanics in 5e-subclasses.txt export
- `storm-sorcery-6-storm-guide` — Storm Sorcery, level 6: name only, no mechanics in 5e-subclasses.txt export
- `storm-sorcery-14-storm-s-fury` — Storm Sorcery, level 14: name only, no mechanics in 5e-subclasses.txt export
- `storm-sorcery-18-wind-soul` — Storm Sorcery, level 18: name only, no mechanics in 5e-subclasses.txt export

### Wild Magic

- `wild-magic-1-wild-magic-surge` — Wild Magic, level 1: name only, no mechanics in 5e-subclasses.txt export
- `wild-magic-1-tides-of-chaos` — Wild Magic, level 1: name only, no mechanics in 5e-subclasses.txt export
- `wild-magic-6-bend-luck` — Wild Magic, level 6: name only, no mechanics in 5e-subclasses.txt export
- `wild-magic-14-controlled-chaos` — Wild Magic, level 14: name only, no mechanics in 5e-subclasses.txt export
- `wild-magic-18-spell-bombardment` — Wild Magic, level 18: name only, no mechanics in 5e-subclasses.txt export

## Warlock

### The Archfey

- `the-archfey-1-expanded-spells` — The Archfey, level 1: expanded spell options, not automatically granted (correct per audit); option mechanics unsourced
- `the-archfey-1-fey-presence` — The Archfey, level 1: name only, no mechanics in 5e-subclasses.txt export
- `the-archfey-6-misty-escape` — The Archfey, level 6: name only, no mechanics in 5e-subclasses.txt export
- `the-archfey-10-beguiling-defenses` — The Archfey, level 10: name only, no mechanics in 5e-subclasses.txt export
- `the-archfey-14-dark-delirium` — The Archfey, level 14: name only, no mechanics in 5e-subclasses.txt export

### The Celestial

- `the-celestial-1-expanded-spells` — The Celestial, level 1: expanded spell options, not automatically granted (correct per audit); option mechanics unsourced
- `the-celestial-1-bonus-cantrips` — The Celestial, level 1: name only, no mechanics in 5e-subclasses.txt export
- `the-celestial-1-healing-light` — The Celestial, level 1: name only, no mechanics in 5e-subclasses.txt export
- `the-celestial-6-radiant-soul` — The Celestial, level 6: name only, no mechanics in 5e-subclasses.txt export
- `the-celestial-10-celestial-resistance` — The Celestial, level 10: name only, no mechanics in 5e-subclasses.txt export
- `the-celestial-14-searing-vengeance` — The Celestial, level 14: name only, no mechanics in 5e-subclasses.txt export

### The Fathomless

- `the-fathomless-1-expanded-spells` — The Fathomless, level 1: expanded spell options, not automatically granted (correct per audit); option mechanics unsourced
- `the-fathomless-1-tentacle-of-the-deep` — The Fathomless, level 1: name only, no mechanics in 5e-subclasses.txt export
- `the-fathomless-1-gift-of-the-sea` — The Fathomless, level 1: name only, no mechanics in 5e-subclasses.txt export
- `the-fathomless-6-oceanic-soul` — The Fathomless, level 6: name only, no mechanics in 5e-subclasses.txt export
- `the-fathomless-6-guardian-coil` — The Fathomless, level 6: name only, no mechanics in 5e-subclasses.txt export
- `the-fathomless-10-grasping-tentacles` — The Fathomless, level 10: name only, no mechanics in 5e-subclasses.txt export
- `the-fathomless-14-fathomless-plunge` — The Fathomless, level 14: name only, no mechanics in 5e-subclasses.txt export

### The Fiend

- `the-fiend-1-dark-one-s-blessing` — The Fiend, level 1: name only, no mechanics in 5e-subclasses.txt export
- `the-fiend-6-dark-one-s-own-luck` — The Fiend, level 6: name only, no mechanics in 5e-subclasses.txt export
- `the-fiend-10-fiendish-resilience` — The Fiend, level 10: name only, no mechanics in 5e-subclasses.txt export
- `the-fiend-14-hurl-through-hell` — The Fiend, level 14: name only, no mechanics in 5e-subclasses.txt export

### The Genie

- `the-genie-1-expanded-spells` — The Genie, level 1: expanded spell options, not automatically granted (correct per audit); option mechanics unsourced
- `the-genie-1-genie-s-vessel` — The Genie, level 1: name only, no mechanics in 5e-subclasses.txt export
- `the-genie-6-elemental-gift` — The Genie, level 6: name only, no mechanics in 5e-subclasses.txt export
- `the-genie-10-sanctuary-vessel` — The Genie, level 10: name only, no mechanics in 5e-subclasses.txt export
- `the-genie-14-limited-wish` — The Genie, level 14: name only, no mechanics in 5e-subclasses.txt export

### The Great Old One

- `the-great-old-one-1-awakened-mind` — The Great Old One, level 1: name only, no mechanics in 5e-subclasses.txt export
- `the-great-old-one-6-entropic-ward` — The Great Old One, level 6: name only, no mechanics in 5e-subclasses.txt export
- `the-great-old-one-10-thought-shield` — The Great Old One, level 10: name only, no mechanics in 5e-subclasses.txt export
- `the-great-old-one-14-create-thrall` — The Great Old One, level 14: name only, no mechanics in 5e-subclasses.txt export

### The Hexblade

- `the-hexblade-1-expanded-spells` — The Hexblade, level 1: expanded spell options, not automatically granted (correct per audit); option mechanics unsourced
- `the-hexblade-1-hexblade-s-curse` — The Hexblade, level 1: name only, no mechanics in 5e-subclasses.txt export
- `the-hexblade-1-hex-warrior` — The Hexblade, level 1: name only, no mechanics in 5e-subclasses.txt export
- `the-hexblade-6-accursed-specter` — The Hexblade, level 6: name only, no mechanics in 5e-subclasses.txt export
- `the-hexblade-10-armor-of-hexes` — The Hexblade, level 10: name only, no mechanics in 5e-subclasses.txt export
- `the-hexblade-14-master-of-hexes` — The Hexblade, level 14: name only, no mechanics in 5e-subclasses.txt export

### The Undead

- `the-undead-1-expanded-spells` — The Undead, level 1: expanded spell options, not automatically granted (correct per audit); option mechanics unsourced
- `the-undead-1-form-of-dread` — The Undead, level 1: name only, no mechanics in 5e-subclasses.txt export
- `the-undead-6-grave-touched` — The Undead, level 6: name only, no mechanics in 5e-subclasses.txt export
- `the-undead-10-necrotic-husk` — The Undead, level 10: name only, no mechanics in 5e-subclasses.txt export
- `the-undead-14-spirit-projection` — The Undead, level 14: name only, no mechanics in 5e-subclasses.txt export

### The Undying

- `the-undying-1-expanded-spells` — The Undying, level 1: expanded spell options, not automatically granted (correct per audit); option mechanics unsourced
- `the-undying-1-among-the-dead` — The Undying, level 1: name only, no mechanics in 5e-subclasses.txt export
- `the-undying-6-defy-death` — The Undying, level 6: name only, no mechanics in 5e-subclasses.txt export
- `the-undying-10-undying-nature` — The Undying, level 10: name only, no mechanics in 5e-subclasses.txt export
- `the-undying-14-indestructible-life` — The Undying, level 14: name only, no mechanics in 5e-subclasses.txt export

## Wizard

### Bladesinging

- `bladesinging-2-training-in-war-and-song` — Bladesinging, level 2: name only, no mechanics in 5e-subclasses.txt export
- `bladesinging-2-bladesong` — Bladesinging, level 2: name only, no mechanics in 5e-subclasses.txt export
- `bladesinging-6-extra-attack` — Bladesinging, level 6: name only, no mechanics in 5e-subclasses.txt export
- `bladesinging-10-song-of-defense` — Bladesinging, level 10: name only, no mechanics in 5e-subclasses.txt export
- `bladesinging-14-song-of-victory` — Bladesinging, level 14: name only, no mechanics in 5e-subclasses.txt export

### Chronurgy Magic

- `chronurgy-magic-2-chronal-shift` — Chronurgy Magic, level 2: name only, no mechanics in 5e-subclasses.txt export
- `chronurgy-magic-2-temporal-awareness` — Chronurgy Magic, level 2: name only, no mechanics in 5e-subclasses.txt export
- `chronurgy-magic-6-momentary-stasis` — Chronurgy Magic, level 6: name only, no mechanics in 5e-subclasses.txt export
- `chronurgy-magic-10-arcane-abeyance` — Chronurgy Magic, level 10: name only, no mechanics in 5e-subclasses.txt export
- `chronurgy-magic-14-convergent-future` — Chronurgy Magic, level 14: name only, no mechanics in 5e-subclasses.txt export

### Graviturgy Magic

- `graviturgy-magic-2-adjust-density` — Graviturgy Magic, level 2: name only, no mechanics in 5e-subclasses.txt export
- `graviturgy-magic-6-gravity-well` — Graviturgy Magic, level 6: name only, no mechanics in 5e-subclasses.txt export
- `graviturgy-magic-10-violent-attraction` — Graviturgy Magic, level 10: name only, no mechanics in 5e-subclasses.txt export
- `graviturgy-magic-14-event-horizon` — Graviturgy Magic, level 14: name only, no mechanics in 5e-subclasses.txt export

### Order of Scribes

- `order-of-scribes-2-wizardly-quill` — Order of Scribes, level 2: name only, no mechanics in 5e-subclasses.txt export
- `order-of-scribes-2-awakened-spellbook` — Order of Scribes, level 2: name only, no mechanics in 5e-subclasses.txt export
- `order-of-scribes-6-manifest-mind` — Order of Scribes, level 6: name only, no mechanics in 5e-subclasses.txt export
- `order-of-scribes-10-master-scriviner` — Order of Scribes, level 10: name only, no mechanics in 5e-subclasses.txt export
- `order-of-scribes-14-one-with-the-word` — Order of Scribes, level 14: name only, no mechanics in 5e-subclasses.txt export

### School of Abjuration

- `school-of-abjuration-2-abjuration-savant` — School of Abjuration, level 2: name only, no mechanics in 5e-subclasses.txt export
- `school-of-abjuration-2-arcane-ward` — School of Abjuration, level 2: name only, no mechanics in 5e-subclasses.txt export
- `school-of-abjuration-6-projected-ward` — School of Abjuration, level 6: name only, no mechanics in 5e-subclasses.txt export
- `school-of-abjuration-10-improved-abjuration` — School of Abjuration, level 10: name only, no mechanics in 5e-subclasses.txt export
- `school-of-abjuration-14-spell-resistance` — School of Abjuration, level 14: name only, no mechanics in 5e-subclasses.txt export

### School of Conjuration

- `school-of-conjuration-2-conjuration-savant` — School of Conjuration, level 2: name only, no mechanics in 5e-subclasses.txt export
- `school-of-conjuration-2-minor-conjuration` — School of Conjuration, level 2: name only, no mechanics in 5e-subclasses.txt export
- `school-of-conjuration-6-benign-transportation` — School of Conjuration, level 6: name only, no mechanics in 5e-subclasses.txt export
- `school-of-conjuration-10-focused-conjuration` — School of Conjuration, level 10: name only, no mechanics in 5e-subclasses.txt export
- `school-of-conjuration-14-durable-summons` — School of Conjuration, level 14: name only, no mechanics in 5e-subclasses.txt export

### School of Divination

- `school-of-divination-2-divination-savant` — School of Divination, level 2: name only, no mechanics in 5e-subclasses.txt export
- `school-of-divination-2-portent` — School of Divination, level 2: name only, no mechanics in 5e-subclasses.txt export
- `school-of-divination-6-expert-divination` — School of Divination, level 6: name only, no mechanics in 5e-subclasses.txt export
- `school-of-divination-10-the-third-eye` — School of Divination, level 10: name only, no mechanics in 5e-subclasses.txt export
- `school-of-divination-14-greater-portent` — School of Divination, level 14: name only, no mechanics in 5e-subclasses.txt export

### School of Enchantment

- `school-of-enchantment-2-enchantment-savant` — School of Enchantment, level 2: name only, no mechanics in 5e-subclasses.txt export
- `school-of-enchantment-2-hypnotic-gaze` — School of Enchantment, level 2: name only, no mechanics in 5e-subclasses.txt export
- `school-of-enchantment-6-instinctive-charm` — School of Enchantment, level 6: name only, no mechanics in 5e-subclasses.txt export
- `school-of-enchantment-10-split-enchantment` — School of Enchantment, level 10: name only, no mechanics in 5e-subclasses.txt export
- `school-of-enchantment-14-alter-memories` — School of Enchantment, level 14: name only, no mechanics in 5e-subclasses.txt export

### School of Evocation

- `school-of-evocation-2-evocation-savant` — School of Evocation, level 2: name only, no mechanics in 5e-subclasses.txt export
- `school-of-evocation-2-sculpt-spells` — School of Evocation, level 2: name only, no mechanics in 5e-subclasses.txt export
- `school-of-evocation-6-potent-cantrip` — School of Evocation, level 6: name only, no mechanics in 5e-subclasses.txt export
- `school-of-evocation-10-empowered-evocation` — School of Evocation, level 10: name only, no mechanics in 5e-subclasses.txt export
- `school-of-evocation-14-overchannel` — School of Evocation, level 14: name only, no mechanics in 5e-subclasses.txt export

### School of Illusion

- `school-of-illusion-2-illusion-savant` — School of Illusion, level 2: name only, no mechanics in 5e-subclasses.txt export
- `school-of-illusion-2-improved-minor-illusion` — School of Illusion, level 2: name only, no mechanics in 5e-subclasses.txt export
- `school-of-illusion-6-malleable-illusions` — School of Illusion, level 6: name only, no mechanics in 5e-subclasses.txt export
- `school-of-illusion-10-illusory-self` — School of Illusion, level 10: name only, no mechanics in 5e-subclasses.txt export
- `school-of-illusion-14-illusory-reality` — School of Illusion, level 14: name only, no mechanics in 5e-subclasses.txt export

### School of Necromancy

- `school-of-necromancy-2-necromancy-savant` — School of Necromancy, level 2: name only, no mechanics in 5e-subclasses.txt export
- `school-of-necromancy-2-grim-harvest` — School of Necromancy, level 2: name only, no mechanics in 5e-subclasses.txt export
- `school-of-necromancy-6-undead-thralls` — School of Necromancy, level 6: name only, no mechanics in 5e-subclasses.txt export
- `school-of-necromancy-10-inured-to-undeath` — School of Necromancy, level 10: name only, no mechanics in 5e-subclasses.txt export
- `school-of-necromancy-14-command-undead` — School of Necromancy, level 14: name only, no mechanics in 5e-subclasses.txt export

### School of Transmutation

- `school-of-transmutation-2-transmutation-savant` — School of Transmutation, level 2: name only, no mechanics in 5e-subclasses.txt export
- `school-of-transmutation-2-minor-alchemy` — School of Transmutation, level 2: name only, no mechanics in 5e-subclasses.txt export
- `school-of-transmutation-6-transmuter-s-stone` — School of Transmutation, level 6: name only, no mechanics in 5e-subclasses.txt export
- `school-of-transmutation-10-shapechanger` — School of Transmutation, level 10: name only, no mechanics in 5e-subclasses.txt export
- `school-of-transmutation-14-master-transmuter` — School of Transmutation, level 14: name only, no mechanics in 5e-subclasses.txt export

### War Magic

- `war-magic-2-arcane-deflection` — War Magic, level 2: name only, no mechanics in 5e-subclasses.txt export
- `war-magic-2-tactical-wit` — War Magic, level 2: name only, no mechanics in 5e-subclasses.txt export
- `war-magic-6-power-surge` — War Magic, level 6: name only, no mechanics in 5e-subclasses.txt export
- `war-magic-10-durable-magic` — War Magic, level 10: name only, no mechanics in 5e-subclasses.txt export
- `war-magic-14-deflecting-shroud` — War Magic, level 14: name only, no mechanics in 5e-subclasses.txt export

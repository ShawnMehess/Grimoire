# Class and Background Content Audit

## Scope

This audit covers the 12 base class entries and 9 background entries in
`DEFAULT_CONTENT`, as rendered by the character-creation wizard at level 1.
It does not audit the 116 subclasses, races, feats, or imported homebrew.

## Systemic fixes

These should be fixed in the presentation model before editing individual
descriptions.

1. Use context-specific section titles. Only races should use `Racial Traits`.
   Classes should use `Level 1 Class Features` and `Class Proficiencies`.
   Backgrounds should use `Background Proficiencies`, `Starting Equipment`, and
   `Background Feature`. Do not use `Innate Abilities` for classes or backgrounds.
2. Render saving throws with their player-facing names. `strSaveProf` and
   `conSaveProf` must become `Saving Throws: Strength, Constitution`.
3. Never show a feature, spell, scaling value, or optional replacement that is
   not active at the selected level. In particular, hide `Additional <Class>
   Spells (Optional)` from the class picker. Those entries list spells from
   levels 1-9 and are not grants at character creation.
4. Do not list optional rules variants as if every character receives them.
   Show a variant only after the player has opted into that rules source, and
   model mutually exclusive alternatives as a choice.
5. All 26 existing class/background choice groups lack explicit `category`.
   Add categories rather than relying on label-text inference:
   - class skill groups: `skills`
   - Monk/Bard/background tool or gaming-set groups: `tools`
   - language groups: `languages`
   - Urban Bounty Hunter's cross-category tool group: `tools`
6. Keep concise class spellcasting summaries, but do not show spell lists in
   the class row. The Spells step owns individual spell choices.
7. Represent equipment as structured grants and structured choices, rather
   than a long semicolon-delimited sentence. A choice should update both the
   equipment list and a matching proficiency where the rules grant both.

## Base classes

| Class | Problem | Recommended player-facing replacement | Required choice / data fix |
| --- | --- | --- | --- |
| Barbarian | Rage is flavor-only. | `Rage: As a bonus action, rage for up to 1 minute. You have advantage on Strength checks and saving throws, deal +2 damage with Strength melee attacks, and resist bludgeoning, piercing, and slashing damage. You cannot cast or concentrate on spells while raging.` | Existing skill group: set category to `skills`. |
| Fighter | Lists every optional Fighting Style as if all are granted; the primary Fighting Style says it is not pickable. | `Fighting Style: Choose one Fighting Style. Its benefits apply while you meet that style's requirements.` Keep each style's full rules only in the choice dialog. | Add required level-1 `Fighting Style` choice group. Do not expose optional styles unless the optional-feature rules source is enabled. Set skill group category to `skills`. |
| Monk | Martial Arts omits the bonus-action strike and the tool choice currently has no options. | `Martial Arts: Use Dexterity instead of Strength for monk weapons and unarmed strikes. Your unarmed strike deals 1d4 damage, and after attacking with a monk weapon or unarmed strike you can make one unarmed strike as a bonus action.` | Populate the required tool choice from the supported artisan-tool or musical-instrument options; category `tools`. Skill group category `skills`. |
| Rogue | Sneak Attack omits its level-1 damage; Expertise is an unimplemented placeholder. | `Sneak Attack: Once per turn, deal an extra 1d6 damage when you hit with a finesse or ranged weapon and have advantage, or when an enemy of the target is within 5 feet of it and you do not have disadvantage.` `Expertise: Choose two of your proficient skills, or choose one proficient skill and thieves' tools; double your proficiency bonus for the chosen proficiencies.` | Add required level-1 Expertise choice group constrained to skills already proficient and/or thieves' tools. Skill group category `skills`. |
| Bard | Bardic Inspiration omits die size, range, action, and uses. The optional spell-list dump includes future spells. | `Spellcasting: You use Charisma for bard spells; choose your cantrips and spells in the Spells step.` `Bardic Inspiration: As a bonus action, give a creature within 60 feet that can hear you one d6. Within 10 minutes, it can add the die to one ability check, attack roll, or saving throw. Uses: your Charisma modifier per long rest (minimum once).` | Hide `Additional Bard Spells (Optional)` from the picker. Skill group `skills`; instrument group `tools`. |
| Cleric | Hides all useful spellcasting context but shows an optional future spell list. | `Spellcasting: You use Wisdom for cleric spells. Prepare your spells and choose your cantrips in the Spells step.` | Hide `Additional Cleric Spells (Optional)`. Skill group category `skills`. |
| Druid | Shows an optional future spell list; the armor note is awkward. | `Druidic: You know Druidic, the secret language of druids, and can leave hidden messages in it.` `Spellcasting: You use Wisdom for druid spells. Prepare your spells and choose your cantrips in the Spells step.` `Armor restriction: You will not wear metal armor or use a metal shield.` | Hide `Additional Druid Spells (Optional)`. Skill group category `skills`. |
| Paladin | Divine Sense and Lay on Hands omit important limits and actions. | `Divine Sense: As an action, detect celestials, fiends, undead, and consecrated or desecrated places within 60 feet until the end of your next turn. Uses: 1 + your Charisma modifier per long rest.` `Lay on Hands: You have a healing pool of 5 hit points. As an action, restore hit points from the pool or spend 5 points to cure one poison or disease.` | Skill group category `skills`. |
| Ranger | Core features refer to choices that are never made; optional replacements and their future-level scaling are shown as current grants. | `Favored Enemy: Choose a favored enemy type. You have advantage on Survival checks to track it and Intelligence checks to recall information about it; you learn one language spoken by that type.` `Natural Explorer: Choose a favored terrain. While traveling there, gain the listed navigation, tracking, foraging, and movement benefits.` | Add required `favored enemy` and `favored terrain` groups. Model the optional rules as one mutually exclusive class-feature variant: standard `Favored Enemy + Natural Explorer` or optional `Favored Foe + Deft Explorer`; show only level-1 effects. Skill group category `skills`. |
| Warlock | Hides Pact Magic entirely and shows a future optional spell-list dump. | `Pact Magic: You use Charisma for warlock spells. Choose two cantrips and two 1st-level spells in the Spells step; your spell slots return when you finish a short or long rest.` | Hide `Additional Warlock Spells (Optional)`. Skill group category `skills`. |
| Wizard | Arcane Recovery should say rounded up and its once-per-day limit; optional future spell list is shown. | `Spellcasting: You use Intelligence for wizard spells. Your spellbook starts with six 1st-level wizard spells; choose your cantrips and prepared spells in the Spells step.` `Arcane Recovery: Once per day when you finish a short rest, recover expended spell slots with a combined level up to half your wizard level, rounded up. No recovered slot can be 6th level or higher.` | Hide `Additional Wizard Spells (Optional)`. Skill group category `skills`. |
| Sorcerer | Hides spellcasting context and shows a future optional spell-list dump. | `Spellcasting: You use Charisma for sorcerer spells. Choose your cantrips and spells known in the Spells step.` | Hide `Additional Sorcerer Spells (Optional)`. Skill group category `skills`. |

## Backgrounds

For every background, move equipment out of `Innate Abilities`. Use the three
sections named in the systemic fixes. Preserve full reference text in an
expandable details panel; use the concise replacements below in the picker.

| Background | Recommended background-feature replacement | Required choice / data fix |
| --- | --- | --- |
| Acolyte | `Shelter the Faithful: Temples and followers of your faith provide you and your companions with free healing and care, excluding costly spell components. Followers support you at a modest lifestyle, and your temple may provide safe, nonhazardous assistance while you remain in good standing.` | Languages group category `languages`. Add equipment choice: `Prayer book` or `prayer wheel`. |
| Entertainer | `By Popular Demand: You can usually find a place to perform. When you perform there each night, you receive free modest or comfortable food and lodging and may be recognized favorably by locals.` | Tool group category `tools`. Reuse the selected musical instrument for both proficiency and starting equipment. |
| Folk Hero | `Rustic Hospitality: Common folk can shelter, hide, or help you recover unless you endanger them. They may shield you from pursuers, but will not risk their lives for you.` | Tool group category `tools`. Reuse the selected artisan's tools for proficiency and starting equipment. Keep land vehicles as a fixed proficiency. |
| Guild Artisan | `Guild Membership: Your guild can provide lodging, food, a place to meet, professional connections, and support when you are in good standing. You owe 5 gp in monthly dues.` | Tool group `tools`, language group `languages`. Reuse the selected artisan's tools for proficiency and starting equipment. |
| Noble | `Position of Privilege: You are accepted in high society, commoners try to accommodate you, and you can usually secure an audience with a local noble.` | Gaming-set group category `tools`; language group `languages`. No extra starting-equipment choice is required by the current equipment list. |
| Outlander | `Wanderer: You remember maps and geography well, and can find food and fresh water for yourself and up to five others each day when the land can provide it.` | Instrument group `tools`, language group `languages`. This is a proficiency choice only unless the equipment list is intentionally expanded to include an instrument. |
| Sage | `Researcher: When you do not know a piece of lore, you usually know where and from whom it can be obtained, subject to the DM's ruling and the availability of the knowledge.` | Languages group category `languages`. |
| Sailor | `Ship's Passage: You and your companions can usually secure free passage on a sailing ship with which you have ties. The route and schedule are not guaranteed, and you are expected to assist the crew.` | Keep navigator's tools and water vehicles as fixed proficiencies. The lucky charm is flavor, not a rules-required choice. Treat the Pirate alternative feature as a separate background variant, not an automatic extra grant. |
| Urban Bounty Hunter | `Ear to the Ground: In any city, you can draw on contacts connected to the social circles your quarry uses to learn about people and places.` | Skill group category `skills`. Tool group category `tools`; retain its existing cross-category rule: choose two total from one gaming set, one musical instrument, and thieves' tools. Do not render all three categories as automatic gains. |

## Explicit choice inventory

The following choices must be interactive; they should not be presented as
descriptive text or as automatic grants.

- Fighter: one Fighting Style.
- Monk: one artisan tool or musical instrument.
- Rogue: two Expertise selections from eligible existing proficiencies.
- Ranger: one favored enemy type and one favored terrain type; optional class
  feature path only when enabled.
- Bard: three musical instruments.
- All listed class skill-proficiency groups.
- All listed background language, tool, instrument, artisan-tool, and gaming-set
  groups.
- Acolyte: prayer book or prayer wheel.
- Entertainer/Folk Hero/Guild Artisan: link equipment selection to the matching
  proficiency selection rather than asking twice.

## Acceptance checks for the implementation

1. A level-1 class row never contains text describing a level 2+ effect.
2. Optional feature text never appears unless its optional rules source is
   enabled and the player selected that variant.
3. No class or background page contains the heading `Racial Traits`.
4. No class or background page uses `Innate Abilities` as its catch-all heading.
5. Every choice group above has an explicit category and a working picker.
6. Every choice updates the character's applied mechanics and review summary.
7. The generated picker text contains no raw field ids such as `strSaveProf`.

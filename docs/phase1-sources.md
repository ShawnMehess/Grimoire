# Phase 1 sources — base class & background content

Sourcing rule (task global rules): every player-facing mechanics string
added in Phase 1 must name the exact file and line range it came from.
For Phase 1 the audit table itself is the sourced text: every
replacement below was copied VERBATIM from
`docs/CONTENT-AUDIT-2026-09.md` (never paraphrased), so the "source" of
each string is the table cell on the listed line. `verify-content.mjs`
(Phase 1 section) checks every string below against the live bundle
verbatim, and `checkverbatim2.mjs` (one-off, Temp) confirmed each
string occurs verbatim in the audit doc.

## Systemic fixes (audit lines 9-37)

- Section titles ("Level 1 Class Features", "Class Proficiencies",
  "Background Proficiencies", "Starting Equipment", "Background
  Feature"; race-only "Racial Traits"; no "Innate Abilities" for
  classes/backgrounds): audit §Systemic fixes item 1, lines 14-17.
- Saving throws as full names: item 2, lines 18-19.
- Level-gating + hiding `Additional <Class> Spells (Optional)`: item 3,
  lines 20-23.
- Optional-rules variants only when the source is enabled (Tasha's
  pack), exclusive alternatives as one choice: item 4, lines 24-26.
- Explicit `category` on all 26 choiceGroups: item 5, lines 27-32.
- Concise spellcasting summaries, no spell lists in class rows: item 6,
  lines 33-34.
- Structured equipment + one pick driving proficiency and equipment:
  item 7, lines 35-37.

## Class replacements (audit lines 41-54)

| Class | Grant | Audit line |
| --- | --- | --- |
| Barbarian | Rage | 43 |
| Monk | Martial Arts | 45 |
| Rogue | Sneak Attack | 46 |
| Rogue | Expertise (added: no compiled grant existed; stub was removed by the pre-existing Expertise picker patch) | 46 |
| Bard | Spellcasting | 47 |
| Bard | Bardic Inspiration | 47 |
| Cleric | Spellcasting | 48 |
| Druid | Druidic | 49 |
| Druid | Spellcasting | 49 |
| Druid | Armor Restriction (renamed from compiled "Armor Proficiencies (note)") | 49 |
| Paladin | Divine Sense | 50 |
| Paladin | Lay on Hands | 50 |
| Ranger | Favored Enemy | 51 |
| Ranger | Natural Explorer | 51 |
| Warlock | Pact Magic | 52 |
| Wizard | Spellcasting | 53 |
| Wizard | Arcane Recovery | 53 |
| Sorcerer | Spellcasting | 54 |
| Fighter | Fighting Style group description ("Choose one Fighting Style. ...") | 44 |

Drops (same rows): `Additional <Class> Spells (Optional)` (Bard 47,
Cleric 48, Druid 49, Paladin 50, Ranger 51, Warlock 52, Wizard 53,
Sorcerer 54), Fighter optional-style grants (44), Ranger
Deft Explorer/Favored Foe optionals (51). Tasha's fighting-style
options stay in the pick-1 group but carry `requiresPack: "tashas"`;
the Ranger optional pair becomes one explicit opt-in group
(`ranger-class-variant`, also `requiresPack: "tashas"`).

## Background replacements (audit lines 62-72; display rule lines 58-60)

| Background | Grant | Audit line |
| --- | --- | --- |
| Acolyte | Shelter the Faithful | 64 |
| Entertainer | By Popular Demand | 65 |
| Folk Hero | Rustic Hospitality | 66 |
| Guild Artisan | Guild Membership | 67 |
| Noble | Position of Privilege | 68 |
| Outlander | Wanderer | 69 |
| Sage | Researcher | 70 |
| Sailor | Ship's Passage | 71 |
| Urban Bounty Hunter | Ear to the Ground | 72 |

Prior long-form descriptions are preserved on each replaced grant as
`reference` (no text destroyed). Acolyte gains the Prayer book /
Prayer wheel equipment choice (64); Entertainer/Folk Hero/Guild
Artisan equipment resolves from the matching proficiency pick (65-67).

## Explicit choice inventory (audit lines 74-90)

Fighter style, Monk tool, Rogue expertise, Ranger enemy/terrain (new:
standard PHB vocabularies — see phase1-gaps.md for the vocabulary
provenance note), Bard instruments, all class skill groups, all
background language/tool groups, Acolyte prayer focus, and the three
linked equipment picks are all real interactive choiceGroups; the
Ranger variant is a real pack-gated group.

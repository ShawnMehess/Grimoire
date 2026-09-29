# Phase 1 gaps — items left unsourced, undecided, or open

Sourcing rule: where no repo source exists for mechanics text, no text
was written — the item is logged here instead.

## Unsourced mechanics (pointer or placeholder only, never invented)

- Ranger favored-enemy option list (Aberrations … Undead, Humanoids
  (choose two)) and favored-terrain list (Arctic … Underdark): standard
  PHB vocabularies. The CHOICE STRUCTURE (required enemy + terrain
  groups) is sourced from the audit (lines 51, 82-83); the per-type
  NAMES have no option-level source file in this repo, so options carry
  no descriptions. Status: implemented as name-only pickers.
- Ranger Tasha's variant mechanics (Favored Foe / Deft Explorer beyond
  "replaces Favored Enemy + Natural Explorer"): no sourced mechanics in
  this repo (the compiled optional grants were dropped as unsourced
  display text per the audit). The variant option
  (`ranger-class-variant-tashas`) carries a pointer to Tasha's
  Cauldron of Everything, shown only when that pack is enabled and the
  player picks it. Status: explicit choice implemented, mechanics text
  awaiting a sourced input.
- Pirate background variant (Sailor row: "treat the Pirate alternative
  feature as a separate background variant"): no Pirate feature text
  exists anywhere in this repo, so no variant was created — inventing
  it would violate the sourcing rule. The Sailor bundle contains no
  Pirate grant (verified). Status: open, needs source material.

## Soft-enforced rules (structure + label, player-applied at the table)

- Rogue Expertise eligibility ("skills already proficient and/or
  thieves' tools"): the picker's OPTION POOL is constrained to exactly
  that shape (18 skills + Thieves' Tools, asserted in
  verify-content.mjs), and the group label reads "pick 2 of your
  proficiencies". Per-pick eligibility is not hard-filtered: filtering
  against live proficiency ownership would trap the group uncompletable
  whenever it renders before its sibling skill picks, and no dialog
  state exists for "disabled with reason". Same precedent as warlock
  invocation prerequisites ("prerequisites apply, see text").
  Status: implemented as pool-shape + label; hard filtering open.

## Display debt (data preserved, rendering follow-up open)

- Replaced grants keep their prior long text on `reference`
  (verify-content.mjs asserts this). The picker bullets show the full
  concise replacement; the old long text is not yet rendered behind a
  separate "full reference" control. None of the phase acceptance
  checks require it. Status: open UI item.

## Design decisions recorded (not gaps)

- `Additional <Class> Spells (Optional)` grants were REMOVED, not
  pack-gated: they list spells from levels 1-9 and are never grants at
  character creation; the Spells step and spell catalog own spell
  access (audit systemic fixes 3 and 6).
- `categorizeChoiceGroup`'s label-keyword fallback is RETAINED for now:
  subclass/race groups are still uncategorized (Phases 2-3 add real
  categories); Phase 4 removes the fallback once nothing needs it.
- Tasha's optional fighting styles stay in the single pick-1 group
  with pack-gated OPTIONS (not a second group): a second group would
  wrongly grant two styles to Tasha's characters.

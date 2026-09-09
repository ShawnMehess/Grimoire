# Default catalogs

Hand-authored catalog JSON, shaped exactly like what the Catalogs editor
saves (`{ name, archetype, tabs }`). These aren't loaded automatically —
there's no code path that reads this folder at runtime. To actually put
one into your live Firestore:

1. Open the Catalogs manager (toolbar → **Catalogs**).
2. Click **Import JSON** in the catalog list.
3. Paste the contents of one of these files into the textarea.
4. Click **Import (Global)** (admin rights required) to make it available
   to every character, or **Import (Mine)** to keep it personal.

The import strips any `id` field and lets the app assign fresh ids, so
the same file can be imported more than once without colliding with an
earlier import.

## Files

- `adventuring-gear.json` — general adventuring equipment across two
  tabs (Adventuring Gear, Tools). Every field is plain text (Gold Cost,
  Weight) — nothing linked to a sheet field, so it's safe to import
  into any campaign regardless of what that character's sheet looks
  like.

- `spell-list.json` — 34 well-known spells (Cantrips through 5th level)
  across six tabs. Requirements (Casting Time / Range / Duration /
  Concentration) and Effects are plain text — but **Acquisition Costs
  starts empty on purpose**. Spell slots are exactly the kind of thing
  the drag-linking feature exists for, and since every character's
  "Level 1 Spell Slots"-type field is named differently (or may not
  exist at all), a global catalog can't safely assume a field name in
  advance.

  After importing, open each level tab's **Fields** panel and drag that
  level's spell-slot field from the sidebar onto **+ Add Field** —
  every spell in that tab then shares the same linked field, so it's
  one drag per tab (five total, since Cantrips needs none), not one per
  spell.

  A few spells (Magic Missile, Shield, Cure Wounds, Burning Hands,
  Fireball) have their Effects row's **Targeting** already filled in —
  scope (self/single target/area), radius for AoE, who it can affect,
  and a free-text conditions note — as a working example of that
  feature. The rest are left unset; targeting is optional per item,
  not something every effect needs.

- `weapons-armor.json` — 16 core PHB weapons and 9 armor pieces, split
  across two tabs. This one's a working example of **per-tab archetype
  overrides**: the catalog's base archetype only has Cost and Weight
  (things every item needs) — the Weapons tab adds its own Damage and
  Properties fields, the Armor tab adds its own Armor Class and Stealth
  Penalty fields instead, each via that tab's **Fields** panel. Neither
  tab's extra fields show up on the other's items.

- `feats.json` — 20 commonly-used PHB feats, as browsable reference
  (Prerequisite + Effect text), not linked to anything. Feats didn't
  get the Race/Class/Background dropdown+bundle treatment on purpose:
  a character picks zero, one, or several over a campaign (usually
  trading an Ability Score Improvement for one, already tracked as
  free text in the Leveling tab), not exactly-one-from-a-fixed-slot the
  way a Race is — there's no single dropdown a "grant" bundle could
  attach to. A few feats here (Tough, Great Weapon Master, Lucky) also
  have effects — extra HP per level, a whole attack-roll trade-off —
  that aren't a single stat bonus at all and couldn't be expressed as
  one `statModifiers` entry even if there were a field to attach it to.

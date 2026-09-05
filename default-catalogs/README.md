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

- `spell-list.json` — 17 well-known spells (Cantrips through 3rd level)
  across four tabs. Requirements (Casting Time / Range / Duration /
  Concentration) and Effects are plain text — but **Acquisition Costs
  starts empty on purpose**. Spell slots are exactly the kind of thing
  the drag-linking feature exists for, and since every character's
  "Level 1 Spell Slots"-type field is named differently (or may not
  exist at all), a global catalog can't safely assume a field name in
  advance.

  After importing, open each level tab's **Fields** panel and drag that
  level's spell-slot field from the sidebar onto **+ Add Field** —
  every spell in that tab then shares the same linked field, so it's
  one drag per tab (four total), not one per spell. Cantrips need no
  slot at all, so that tab can be left as-is.

  A few spells (Magic Missile, Shield, Cure Wounds, Burning Hands,
  Fireball) have their Effects row's **Targeting** already filled in —
  scope (self/single target/area), radius for AoE, who it can affect,
  and a free-text conditions note — as a working example of that
  feature. The rest are left unset; targeting is optional per item,
  not something every effect needs.

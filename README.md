# Character Vault (starter scaffold)

A private, D&D-only character creator/manager, hosted statically via
GitHub Pages, backed by Firebase (Firestore + Auth) for shared
persistence among friends.

## Why it's structured this way

The core problem to avoid is the one you hit last time: a single CSS
file creeping toward 3000 lines because every field on a character
sheet got its own hand-written markup and its own slightly-different
styling. This scaffold avoids that with one rule:

**Fields are data, not markup.** `js/data/schema.js` defines every
field on the sheet (id, label, type, defaults). `js/render/formBuilder.js`
turns a field definition into DOM using exactly one CSS component
(`.input-group` or `.stat-block`). Adding a new field to the sheet
means adding one entry to `schema.js` — it never means writing new
HTML or new CSS.

## Structure

```
css/
  tokens.css        design tokens (colors, spacing, type) — edit palette here
  base.css          resets, bare element defaults
  layout.css        page-level scaffolding (sidebar, grid, sections)
  components/       one file per reusable UI pattern
  main.css          @imports everything in cascade order
js/
  data/
    schema.js        field definitions + blank character factory
    rules.js          pure D&D math (modifiers, proficiency bonus) — no DOM, no Firebase
  render/
    formBuilder.js    schema -> DOM. The only place field markup is created.
    characterSheet.js orchestrates schema + rules + formBuilder + store for the sheet view
  state/
    characterStore.js the ONLY file that imports Firebase. Everything else
                       works with plain JS objects.
  main.js             auth flow + routing between character list / sheet
data/
  classes.json, races.json, backgrounds.json  shared reference data (static,
  not in Firestore — it's identical for everyone and read-heavy)
firestore.rules       security rules: users can only write their own characters
index.html
```

## Setup

1. Create a Firebase project, enable **Firestore** and **Google Auth**.
2. Copy your web app config into `js/state/characterStore.js`
   (`firebaseConfig`).
3. Deploy `firestore.rules` (`firebase deploy --only firestore:rules`)
   or paste it into the Firebase console rules editor.
4. Push to GitHub, enable GitHub Pages on the repo (serve from root or
   `/docs`, your call).

## Reference data (classes/races/spells/equipment)

`scripts/fetch-srd-data.mjs` pulls the open D&D SRD content from the
free [5e-bits SRD API](https://www.dnd5eapi.co) and writes it straight
into `/data/*.json` in the shape `schema.js` expects, so the site never
depends on a live third-party API at runtime.

```
node scripts/fetch-srd-data.mjs
```

Requires Node 18+ (built-in `fetch`), no dependencies. Takes a minute
or two — it fetches full detail for every spell and equipment item, at
a deliberately throttled rate so as not to hammer a free public API.
Re-run it any time you want to refresh the data.

Note: **backgrounds aren't available from this API** — the SRD only
documents a handful of them, so `backgrounds.json` is seeded with the
standard list directly in the script. Add homebrew backgrounds there
by hand as you invent them.

Everything this script pulls is limited to the **SRD** (System
Reference Document) — the open-licensed subset of D&D content. It
covers the core rules well but not every race/subclass from every
splatbook; anything beyond that you'll want to enter yourself as
homebrew, both for coverage and to stay on clean licensing ground.

## Extending it

- **New field on the sheet** → add an entry to `schema.js`. Done.
- **New field *type* not covered yet** (e.g. a dice-roll button) → add
  a case to `buildControl()` in `formBuilder.js`, plus one new CSS
  file in `css/components/` if it needs its own look.
- **New D&D rule/calculation** → add a pure function to `rules.js`,
  call it from `characterSheet.js`.
- **Inventory / spells / features** → these are arrays on the
  character document (see `schema.js`). They'll want their own small
  render module (`render/inventory.js` etc.) following the same
  pattern as `characterSheet.js` — build list items from data, one
  `.card` component, no page-specific CSS.

## Deliberately left out of this starter

- Race/background JSON is just a stub for classes — flesh out
  `data/races.json` and `data/backgrounds.json` the same way.
- No spell slot table or class-specific mechanics yet — those belong
  in `rules.js` as you add them.
- No inventory/spellbook UI wired up yet — `schema.js` has the data
  shape (`character.inventory`, `character.spells`) ready for it.

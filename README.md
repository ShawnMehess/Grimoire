# Character Vault

A private, D&D-only character creator/manager, hosted statically via
GitHub Pages, backed by Firebase (Firestore + Auth) for shared
persistence among friends.

## The sheet is now a drag/resize/style builder, not a fixed form

**This superseded the original fixed-schema sheet** (Identity/Combat/
Abilities/etc. as hardcoded sections). The character sheet is now
fully custom-built by each user: blocks and fields can be added,
removed, dragged, resized, restyled, and relabeled freely. The old
fixed-field system (`js/data/schema.js`, `js/render/formBuilder.js`,
`js/render/characterSheet.js`) is still in the repo but **no longer
called from `main.js`** — kept only as a reference/rollback point,
not because it's still in use.

### The core idea: one object, not two

A "stat block" and a "stat field" are the same underlying object (see
`js/data/blockModel.js`) — a **node** with `kind: "block"` (a
container with children) or `kind: "field"` (a leaf value: text,
radio group, or checkbox group). This is a direct, literal
implementation of "blocks and fields should really be the same
object" — there's one factory shape underneath, `createBlock()` and
`createField()` are just convenience wrappers around it.

### One grid, every level

Everything is positioned in whole cells of a single grid — `x, y, w, h`
in `js/data/blockModel.js`, never free pixels. Column width is
responsive (recalculated from the page's pixel width on resize); row
height is fixed. A block's children use the **exact same column
width** as the page grid, with the block's own `w` as their local
column count — that's what makes "one cell" mean the same physical
size whether you're looking at the page or inside a block. See
`js/render/customSheet.js`'s file-level comment for the full math.

### Files

- `js/data/blockModel.js` — the node shape, factories, and the
  starter layout shown on a brand-new character.
- `js/render/gridEngine.js` — pure grid math only (collision + a
  simple "gravity pack" compaction). No DOM access, so it's usable at
  every nesting level and easy to reason about in isolation.
- `js/render/customSheet.js` — the actual renderer: drag/resize
  handles, the style popover, add/delete, label positioning, the
  whole edit-mode UI. This is the file to read first if something's
  behaving oddly.
- `js/render/equationStub.js` — deliberately a stub. Opens a modal,
  computes nothing. The full intended spec for the equation editor is
  captured in that file's comments so it's easy to pick up later
  without re-deriving the design.

### Known simplifications in this pass (not hidden, just scoped)

- **Label repositioning is a 4-state cycle button**, not a literal
  continuous drag gesture — click it and the label animates (FLIP
  transform) to the next position (top → right → bottom → left → top).
  A true drag-to-reposition version is a reasonable follow-up.
- **Side labels (left/right) share their field's existing box** rather
  than being an independently resizable adjacent grid cell. Widen the
  whole field if a side label needs more room.
- **Rich per-selection text formatting** (bold/italic/underline/color/
  font applied to just a highlighted portion of text) only works
  inside a text field's *value* — not its label, not a block's name.
  Those stay plain text, though they still inherit whole-node font/
  color choices via normal CSS inheritance (that's also how "apply to
  the whole block, including its fields" works for free — style is
  set as inline CSS on the block, and font/color properties cascade
  down to children unless a field overrides them itself).
- **Compaction is a full re-pack**, not a minimal-disturbance push —
  see `gridEngine.js`'s file comment. Simple and fully trustworthy,
  occasionally shuffles more than strictly necessary.
- **Background images are stored as data URLs directly on the
  character document.** Firestore caps a whole document at 1MB, so a
  large image can push a character over that limit — there's a
  warning on upload, but no compression/resizing, and no Firebase
  Storage integration (which would be the real fix, and is a good
  next step if this becomes a real pain point).
- **Equations are a stub** — see `equationStub.js`. Every field,
  including ones that conceptually want to be computed, is a plain
  manually-typed value for now.
- **No migration from old characters' fixed-schema data.** A character
  saved under the old system just gets a fresh starter layout the
  first time it's opened under the new one — old field values
  (abilities, inventory, spells, etc. from the previous system) aren't
  ported over automatically.

## Why the OLD system was structured this way

(This section describes the retired fixed-schema sheet — kept for
context on `schema.js`/`formBuilder.js`/`characterSheet.js`, which are
no longer wired up but still in the repo.)

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
  layout.css        page-level scaffolding (header, packed section grid)
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

## Viewing it locally

ES modules (`<script type="module">`) won't load from a `file://`
path — browsers block that for security reasons — so you need a tiny
local web server, not a double-click. From the project root:

```
python3 -m http.server 8080
```
(or `npx serve .`, or VS Code's "Live Server" extension — any static
server works)

Then open **http://localhost:8080/demo.html** — this loads the
character sheet with placeholder data via `js/state/mockStore.js`
instead of Firebase, so you can see the actual layout/styling
immediately, with no project setup required. Typing in fields logs to
the browser console instead of saving anywhere.

Once you've set up Firebase (below), **http://localhost:8080/**
(`index.html`) is the real app — sign-in, character list, persistence.

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

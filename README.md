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
- **Formulas work; `equationStub.js` is dead code.** The live path
  is `js/data/formula.js` (expression engine) +
  `js/render/formulaEditor.js` (editor UI), and the starter sheet
  ships with real formulas: all six ability modifiers, save/skill
  modifiers (proficiency-gated), proficiency bonus from level, spell
  save DC / attack bonus, initiative, and passive Perception. The old
  `equationStub.js` (modal that computes nothing) is no longer
  imported anywhere and can be deleted.
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
    customSheet.js    composition root for the drag/resize/style sheet builder.
                      Owns session state + store wiring; every DOM structure and
                      every pure computation lives in sheet/ and is called with
                      explicit deps — no business logic inline.
    sheet/            one module per concern, all explicit-deps (no sheet closure):
      sheetConstants.js  grid + sizing constants (PAGE_COLS, GAP_PX, ...)
      sheetHelpers.js    debounce, clone/newId, style compare/merge
      sheetState.js      session-state factory + selection-set helpers
      sheetMechanics.js  wizard preview text (stat summaries, categories)
      sheetDrag.js       drag/resize/duplicate/nudge math + wire helpers
      sheetSelection.js  selection paint/box, hover toolbars, grid click/drop
      sheetToolbar.js    toolbar/chip/drop/toast builders
      sheetFields.js     field nodes, value builders, menus, catalog UI
      sheetBlocks.js     block nodes, sidebar, tabs helpers, grid lines
      sheetLeveling.js   bundle math, computed values, tabs data, resources
      sheetWizard.js     choice groups, spells, step shell, row renderers
      sheetWizardSteps.js  creation + level-up step bodies, review/apply
      sheetBundles.js    library materialization, choices editor, sync
      sheetHistory.js    undo stacks, history buttons, shortcut decisions
      sheetTabs.js       tab lookup/render/normalize
      sheetStyles.js     style mapping, popover, rich-text selection
      sheetRules.js      money/numeric/point-buy/ASI/ability helpers
      sheetRender.js     main-grid render orchestration
      index.js          barrel (import specific modules, not this, in new code)
  state/
    characterStore.js the ONLY file that imports Firebase. Everything else
                       works with plain JS objects.
  main.js             auth flow + routing between character list / sheet
scripts/
  smoke-imports.mjs  node import + pure-logic checks (no test suite yet —
                     run it after touching sheet/ or customSheet.js)
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
In a hurry (or offline)? Open **http://localhost:8080/?offline=1**
instead — same app, characters persist in that browser's localStorage
with no Firebase setup at all.

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

### Rulesets and guided leveling

`js/data/dnd5e.js` is a small ruleset registry, consumed by the generic
Leveling tab rather than by the sheet builder itself. A ruleset provides a
name plus class entries shaped like this:

```js
{
  name: "Druid",
  subclassLevel: 3,
  subclasses: ["Circle of the Land", "Circle of the Moon"],
  caster: "full", // "full", "half", or null
}
```

The character toolbar stores the chosen ruleset id on that character. The
guide then filters its Subclass dropdown, presents the right subclass choice
at the configured level, and applies HP and supported spell-slot progression.
Both the 2014 PHB and 2024 PHB rulesets now contain the full 12-class roster
(see `PHB_2024_CLASSES` in `js/data/dnd5e.js`), though each class's subclass
list is only whatever's in the free SRD (one per class) — add the rest by
hand as splatbook content. New games can use the same registry shape without
changing the sheet renderer.

### Importing 2024 SRD content into the Bundle Library / Catalogs

`scripts/compile-2024-content.mjs` turns the raw 2024 SRD dumps in `/data/*-2024.json`
into the same hand-authored bundle/catalog JSON shapes `default-bundles/`
and `default-catalogs/` already use — classes, species, and backgrounds as
importable bundles, feats as a browsable catalog. Run it, then import the
output the same way as any other file in those folders (see their READMEs):

```
node scripts/compile-2024-content.mjs
```

It does not (and can't, from raw SRD text alone) express class skill
*choices* or feat *effects* mechanically — those land as reference text,
same limitation the 2014 pipeline already has. See the script's file-level
comment and `default-bundles/README.md` for exactly what is and isn't
covered.

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

## Content pipeline (compiled Foundry data + hand-written core)

In addition to the SRD fetch above, `New Info/5e-*.txt` (Foundry VTT
exports) compile into the site's bundle/catalog shapes:

```
node scripts/compile-foundry-feats.mjs       # 83 feats -> js/data/featBundles.js
node scripts/compile-foundry-catalogs.mjs    # 537 spells + 831 items -> js/data/contentCatalogs.js
node scripts/compile-foundry-subclasses.mjs  # 112 subclasses -> js/data/subclassContent.js
node scripts/compile-foundry-races-bg.mjs    # thin race/bg placeholders (NOT wired — see note in the output files)
```

Plus `js/data/extraRaces.js` — hand-written bundles for the five core
races the mechanics JSON omits (Human, Elf, Half-Elf, Half-Orc,
Tiefling), in the same shape as `defaultContent.js` entries.

Plus `js/data/contentFixups.js` — hand-written pickers for choices
the sources left as reference-key stubs, applied at runtime over the
compiled bundles (so the generated files stay regenerable): Fighting
Styles (Fighter/Paladin/Ranger + Champion), Expertise (Rogue/Bard),
Metamagic, Eldritch Invocations + Pact Boon, Hunter's Prey, Elf
subraces (High/Wood/Drow), and free-form racial ASIs. Feat spell
*choices* (Magic Initiate, Fey/Shadow Touched, Aberrant Dragonmark,
Artificer Initiate, Wood Elf Magic) are compiled pickers in
`featBundles.js` too. Bard Magical Secrets and Warlock Mystic Arcanum
stay guided notes — a free pick from every class's list needs a
picker UI that doesn't exist yet.

Wiring: subclass bundles attach to the starter Subclass dropdown by
normalized name (`blockModel.js`); the Spell List + equipment catalogs
join `catalogCache` (`customSheet.js`); granted spells (`addItem`
op — oath/domain/circle spells, feat spells, Tiefling legacy) land in
the auto-created Spells Known list at selection time
(`syncGrantedListItems`). Save/load strips + rehydrates all default
bundles (class/race/background/subclass) so characters stay lean —
see `js/state/bundleMaps.js`, shared by both backends.

Checks (run both after touching content, sheet/, or compilers):

```
node scripts/smoke-imports.mjs   # module graph + pure-logic unit checks
node scripts/verify-content.mjs  # bundle<->choice wiring, target ids, creation-to-20 simulation
```

`verify-content.mjs` simulates three full 1–20 builds (Fighter,
Light Cleric, Devotion Paladin), a 12-class sweep, and all 18 starter
races — every statModifier target, dropdownAccess id, and granted
spell name must resolve or it fails.

## Character creation wizard

Step order: Ruleset → Identity → Class → Ability Scores → Background →
Preferences → Innate Abilities → Spells & Abilities → Languages →
Starting Equipment → Feats → Ability Proficiencies → Equipment
Proficiencies → Review.

Starting Equipment offers each class's 2014 packages (packs expanded
into contents) or the fixed-average gold, plus the background's fixed
package — applied once at Finish Setup. Equipment Proficiencies is a
separate picker over the full weapon/armor/tool/vehicle vocabularies
with already-granted tags locked; sheet taglists stay editable after
setup, and a category with nothing to choose shows who-you-are and
says so instead of an empty picker.

- **Gated pages.** Next (and forward dot-jumps) stay disabled until the
  current page's decisions are made — picks, subclass where choosable
  now, spell caps, HP. Dots and Back always work backward.
- **Sensible defaults.** A single ruleset selects itself; fresh ability
  scores start on Point Buy; HP defaults to Fixed Average.
- **Picker rows** show a personality/playstyle blurb plus categorized,
  bulleted mechanics (Statistical traits → Ability increases →
  Proficiencies → Innate abilities), collapsible per row with
  Expand All / Collapse All.
- **Common is locked** wherever a language picker offers it, and never
  counts against the pick budget. Spell rows show a mechanical line
  (level · school · casting · range · duration + effect); hitting a
  spell cap shows a tooltip on the row instead of an error banner.
- **Starting Equipment** offers each class's packages or the gold,
  plus the background's fixed package; applied once at Finish Setup
  (items to Inventory, gold to GP). Review lists every choice made.

## Sharing with friends / offline mode

- **Shared (default):** the Firebase project is already configured in
  `js/state/characterStore.js`. Enable Google Auth + Firestore in the
  Firebase console, deploy `firestore.rules`, and friends sign in —
  characters sync across devices.
- **Offline (`?offline=1`):** append `?offline=1` to the URL (or open
  with no connection) and the app uses `js/state/localStore.js`
  instead — same features, data in this browser's localStorage only.
  A banner on the character list says which mode you're in.

## Deliberately left out / known limits

- Elf subraces (High/Wood/Drow) are a "track by hand" note on the Elf
  bundle — no subrace picker yet.
- A few `SKILL_EXPERTISE` / `FEATURE_SELECT` / `SPELL_SELECT` class
  choices carry only a reference key in the source data, so they show
  as text notes instead of pickers (see RESCUE-NOTES.md).
- Short Rests restore short-rest feature uses plus Warlock pact slots
  (read off the level-up plan, single-class Warlocks). Long Rests
  restore all feature uses, clear used spell slots, and heal to full
  HP — all in one undoable commit (see `takeRest` in `customSheet.js`).

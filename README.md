# Grimoire

A private, D&D-only character creator/manager, hosted statically via
GitHub Pages, backed by Firebase (Firestore + Auth + Storage) for
shared persistence among friends.

## The sheet is a drag/resize/style builder, not a fixed form

The character sheet is fully custom-built by each user: blocks and
fields can be added, removed, dragged, resized, restyled, and
relabeled freely.

### The core idea: one object, not two

A "stat block" and a "stat field" are the same underlying object (see
`js/data/blockModel.js`) — a **node** with `kind: "block"` (a
container with children) or `kind: "field"` (a leaf value: text,
radio group, or checkbox group). `createBlock()` and `createField()`
are just convenience wrappers around it.

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
  every nesting level and easy to reason about in isolation. Only the
  sizing helpers are currently called (placement is fully manual);
  collision/compaction stay for a possible future "tidy up".
- `js/render/customSheet.js` — the actual renderer: drag/resize
  handles, the style popover, add/delete, label positioning, the
  whole edit-mode UI. This is the file to read first if something's
  behaving oddly.
- `js/data/formula.js` (expression engine) +
  `js/render/formulaEditor.js` (editor UI) — the live formula path.
  The starter sheet ships with real formulas: all six ability
  modifiers, save/skill modifiers (proficiency-gated), proficiency
  bonus from level, spell save DC / attack bonus, initiative, and
  passive Perception.
- `js/data/expressDefaults.js` — per-class recommended defaults for
  Express setup (ability spreads + skills). Data, not wizard logic.
- `js/state/characterImages.js` — pure Storage shapes (sidecars, path
  building, document slot walk). The Firebase side lives in
  `characterStore.js`, the offline pass-through in `localStore.js`.
- `js/render/sheet/` — one module per concern, all explicit-deps (no
  sheet closure). Import specific modules, not the barrel, in new code.

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
- **Images upload to Firebase Storage, but nothing resizes them.**
  Big uploads work (no more 1MB document pressure), but a 10MB photo
  still costs 10MB of Storage and bandwidth — client-side
  downscaling is a good follow-up. Catalog images and replaced-but-
  never-deleted field images are also still stored, not cleaned up
  (character delete wipes that character's Storage prefix).
- **No importer for outside characters.** A character built elsewhere
  (another app, paper) starts here as a fresh sheet — abilities,
  inventory, and spells are entered through the creation wizard, not
  imported.

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
    schema.js            blank character factory + ABILITIES/SKILLS/LANGUAGES vocabularies
    blockModel.js        node shape, factories, starter layout
    expressDefaults.js   per-class Express-setup defaults (data, not logic)
    characterImages.js   (in js/state/) pure Storage shapes — no Firebase imports
  render/
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
                       works with plain JS objects. Owns Storage uploads,
                       deletes, and the data-URL migration.
    localStore.js     offline backend (localStorage) — same exports, data
                       URLs stay local, no Firebase anywhere.
    characterImages.js  pure Storage shapes shared by both backends.
    bundleMaps.js     shared bundle strip/hydrate so both backends agree.
  main.js             auth flow + routing between character list / sheet
scripts/
  smoke-imports.mjs  node import + pure-logic checks (run after touching
                       sheet/ or customSheet.js)
  verify-content.mjs bundle<->choice wiring, target ids, creation-to-20
                       simulation (run after touching content, sheet/,
                       or compilers)
  check-imports.mjs  static import-graph check (customSheet + sheet/)
tests/               node:test unit suites — wizard gating, leveling,
                       formulas, images (run: node --test tests/...)
data/
  classes.json, races.json, backgrounds.json  shared reference data (static,
  not in Firestore — it's identical for everyone and read-heavy)
firestore.rules       security rules: any signed-in friend can read, only the
                        owner can write (see "Sharing" below)
storage.rules         Storage rules mirroring the above for character images
                        (deploy: firebase deploy --only storage)
docs/                 notes, raw import sources, and working files (see below)
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

1. Create a Firebase project, enable **Firestore**, **Google Auth**,
   and **Storage**.
2. Copy your web app config into `js/state/characterStore.js`
   (`firebaseConfig`).
3. Deploy `firestore.rules` (`firebase deploy --only firestore:rules`)
   or paste it into the Firebase console rules editor.
4. Deploy `storage.rules` (`firebase deploy --only storage`) or paste
   it into the Storage rules editor (needs the Blaze plan — the
   owner check reads the character document).
5. Push to GitHub, enable GitHub Pages on the repo (serve from root —
   `docs/` holds notes and import sources, not the site).

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

The character toolbar stores the primary ruleset id on that character
(the full included set lives in `rules.rulesetIds`). The
guide then filters its Subclass dropdown, presents the right subclass choice
at the configured level, and applies HP and supported spell-slot progression.
One system is registered (`dnd5e-2014`) with three content books
(`phb`, `xanathar`, `tashas`) covering 13 classes (12 PHB + Artificer);
each class's subclass list is only whatever's in the free SRD (one per
class) plus the compiled Foundry supplement — add the rest by hand as
splatbook content. New games can use the same registry shape without
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

- **New field on the sheet** → add it in the sheet builder UI, or extend
  the field types in `js/data/blockModel.js` + `js/render/sheet/sheetFields.js`.
- **New field *type* not covered yet** (e.g. a dice-roll button) → add
  a builder in `js/render/sheet/sheetFields.js`, plus one new CSS
  file in `css/components/` if it needs its own look.
- **New D&D rule/calculation** → add a pure function to the matching
  `js/render/sheet/` or `js/data/` module (explicit deps, no sheet closure).
- **Inventory / spells / features** → these are arrays on the
  character document. They'll want their own small
  render module following the same pattern as the other `sheet/`
  modules — build list items from data, reuse the picker-table
  component, no page-specific CSS.

## Content pipeline (compiled Foundry data + hand-written core)

`docs/New Info/5e-*.txt` (Foundry VTT exports) compile into the site's
bundle/catalog shapes:

```
node scripts/compile-foundry-feats.mjs       # 83 feats -> js/data/featBundles.js
node scripts/compile-foundry-catalogs.mjs    # 537 spells + 831 items -> js/data/contentCatalogs.js
node scripts/compile-foundry-subclasses.mjs  # 116 subclasses -> js/data/subclassContent.js
node scripts/compile-foundry-races-bg.mjs    # thin race/bg placeholders (NOT wired — see note in the output files)
```

Plus `js/data/extraRaces.js` — hand-written bundles for the five core
races the mechanics JSON omits (Human, Elf, Half-Elf, Half-Orc,
Tiefling), in the same shape as `defaultContent.js` entries.

Plus `js/data/contentFixups.js` — hand-written pickers for choices
the sources left as reference-key stubs, applied at runtime over the
compiled bundles (so the generated files stay regenerable): Fighting
Styles (Fighter/Paladin/Ranger + Champion), Expertise (Rogue/Bard),
Metamagic, Eldritch Invocations + Pact Boon, Hunter's Prey, Elf/Dwarf/
Gnome/Halfling/Genasi subraces, and free-form racial ASIs. Feat spell
*choices* (Magic Initiate, Fey/Shadow Touched, Aberrant Dragonmark,
Artificer Initiate, Wood Elf Magic) are compiled pickers in
`featBundles.js` too. Bard Magical Secrets has a real picker (any-class
spells, unlock-gated — see below); Warlock Mystic Arcanum stays a
guided note.

One regen caveat: the committed `subclassContent.js` carries hand
fixes a clean re-run would clobber (the source's "Shephard" typo
ships corrected as "Shepherd", plus formatting) — re-run, then
re-apply them (see the note in `compile-foundry-subclasses.mjs`).

Wiring: subclass bundles attach to the starter Subclass dropdown by
normalized name (`blockModel.js`); the Spell List + equipment catalogs
join `catalogCache` (`customSheet.js`); granted spells (`addItem`
op — oath/domain/circle spells, feat spells, Tiefling legacy) land in
the auto-created Spells Known list at selection time
(`syncGrantedListItems`). Save/load strips + rehydrates all default
bundles (class/race/background/subclass) so characters stay lean —
see `js/state/bundleMaps.js`, shared by both backends.

Checks (run all three after touching content, sheet/, or compilers):

```
node --test tests/             # fast unit suites (wizard gating, leveling, formulas, images)
node scripts/smoke-imports.mjs   # module graph + pure-logic unit checks
node scripts/verify-content.mjs  # bundle<->choice wiring, target ids, creation-to-20 simulation
```

`verify-content.mjs` simulates full 1–20 builds (Fighter, Light
Cleric, Devotion Paladin, Lore Bard), a 12-class sweep, all 15 starter
races, a Cleric/Wizard multiclass cap check, and every Elf subrace —
every statModifier target, dropdownAccess id, and granted spell name
must resolve or it fails.

## Character creation wizard

Six steps — choices appear where they originate, as collapsible "Your
choices" sections directly under the pick that grants them (with
Expand All / Collapse All), never on separate later pages:

1. **Basics** — sources/rulesets (saved as your per-user default, so
   returning users don't re-pick; always overridable per character),
   name, level, race, plus race-granted choices (languages, subrace).
2. **Class** — class, subclass if choosable now, class-granted
   choices, the spell picker for casters, and Magical Secrets for
   Bards with unlocks. **Express** lives here too: one click fills
   every choice with the class's recommended defaults
   (`expressDefaults.js`) and lands on Gear & Review.
3. **Ability Scores** — Point Buy by default (Random Roll / Manual
   Entry available); granted bonuses show under each score
   ("+2 from Elf → 17 total") so nothing surprises.
4. **Background** — background plus its granted languages, skills,
   tools.
5. **Feats** — only when a feat choice or race-granted feat (e.g.
   Custom Lineage, Variant Human-style) actually offers one; skipped
   otherwise, with a "skipped" marker on the progress dots.
6. **Gear & Review** — starting equipment decisions (or fixed-average
   gold) folded in as Gear, plus weapon/armor/tool training, the HP
   method (Fixed Average by default), automatic grants, and Finish
   Setup.

- **Gated per section.** Next (and forward dot-jumps) stay disabled
  until every section on the page is decided — picks, subclass where
  choosable now, spell caps, equipment. Dots and Back always work
  backward. A "Step X of N" counter plus progress bar tracks where
  you are; auto-skipped steps show a muted "skipped" tag instead of
  vanishing.
- **Source changes revalidate.** Unchecking a content book keeps every
  pick still offered under the remaining books, clears only orphaned
  picks (and their choice-group picks, plus a race-granted feat with
  its race), and reports what was removed. Adding a source never
  clears anything.
- **Finish Setup respects customized sheets.** Targets resolve by
  field id (renames survive) across every tab (moves survive);
  dropdown picks select-or-create their choice; list writes append
  without touching existing entries. Anything with nowhere to land
  (a deleted field) is reported in a notice — never dropped
  silently, never overwriting user content.
- **Sensible defaults.** A single source selects itself; fresh ability
  scores start on Point Buy; HP defaults to Fixed Average; sources
  persist per user.
- **Picker rows** show a personality/playstyle blurb plus categorized,
  bulleted mechanics (Statistical traits → Ability increases →
  Proficiencies → Innate abilities), collapsible per row with
  Expand All / Collapse All.
- **Common is locked** wherever a language picker offers it, and never
  counts against the pick budget. Spell rows show a mechanical line
  (level · school · casting · range · duration + effect); hitting a
  spell cap shows a tooltip on the row instead of an error banner.
- **Magical Secrets** (Bard 10/14/18, College of Lore 6): an
  any-class spell picker capped at the unlocked total, enforced in
  creation and level-ups. Counting is deliberately lenient (a racial
  spell counts too) so the step completes rather than traps.

## Multiclassing

Starting at total level 2, the Leveling tab asks which class gains
each level: the primary class, an existing secondary, or a brand-new
one (gated on 13+ in the right abilities, racial bonuses counted —
Fighters need Str or Dex, Monks/Paladins/Rangers need both of
theirs). Secondary classes live in `rules.multiclass`; the primary
class's levels stay derived (total minus secondary), so single-class
sheets behave exactly as before.

- Class/subclass features, resources, choice groups, and granted
  spells gate on each class's own levels, not the total.
- Spell slots follow the PHB multiclass table (Warlock pact slots
  stay on their own short-rest track and merge by max per tracker).
- Spell picks enforce the level's own class caps against that
  class's spells only — the other class's spells in the shared Spells
  Known list can neither satisfy nor block them.
- New classes grant no save proficiencies and no armor/weapon fixed
  grants (PHB); skills/tools stay pickable, and the Equipment
  Proficiencies tab covers the rest by hand.
- Each applied level records which class took it (visible on the
  level rows). Secondary subclasses live on the multiclass entry —
  the sheet's Subclass dropdown keeps showing the primary's.
- Simplifications, stated plainly: skill pick counts use the class's
  normal groups, and the spell picker shows the level's class
  (anything else goes in Spells Known by hand).

## Character images (Firebase Storage)

Picture fields and background images upload to Firebase Storage, not
the character document — the document keeps the renderable download
URL plus a Storage-path sidecar (`imageRef` / `bgImageRef`) for
deletes and re-resolution. Uploads apply preview-first (the picked
image shows instantly, then swaps to the hosted URL); replacing an
image deletes the replaced object, and deleting a character wipes its
whole Storage prefix. Documents that still carry legacy data-URL
images migrate on the next online load (uploaded, swapped, saved
back — failures retry later and never block the load). Offline
(`?offline=1`) keeps data URLs locally, exactly as before.

## Sharing with friends / offline mode / access model

- **Shared (default):** the Firebase project is already configured in
  `js/state/characterStore.js`. Enable Google Auth + Firestore +
  Storage in the Firebase console, deploy `firestore.rules` and
  `storage.rules`, and friends sign in — characters sync across
  devices.
- **Access model (intentional):** any signed-in friend can *read* any
  character (that's the shared table — the DM and party can open each
  other's sheets), but only the *owner* can create/update/delete their
  own. Image reads mirror this; image writes/deletes are owner-only.
  Tighten reads to owner-only only if the table should stop sharing.
- **Offline (`?offline=1`):** append `?offline=1` to the URL (or open
  with no connection) and the app uses `js/state/localStore.js`
  instead — same features, data in this browser's localStorage only.
  A banner on the character list says which mode you're in.

## `docs/` — notes and working files

Loose working files live in `docs/`, not the repo root:

- `docs/New Info/5e-*.txt` — the Foundry VTT exports the compile
  scripts read (see "Content pipeline" above).
- `docs/RESCUE-NOTES.md`, `docs/MECHANICS-IMPORT-NOTES.md` — how the
  mechanics content was built and what's still hand-tracked.
- `docs/Improvements to make.txt` (+ `.zip`) — the running wishlist.

## Deliberately left out / known limits

- A few `SKILL_EXPERTISE` / `FEATURE_SELECT` / `SPELL_SELECT` class
  choices carry only a reference key in the source data, so they show
  as text notes instead of pickers (see `docs/RESCUE-NOTES.md`).
  Warlock Mystic Arcanum is one: a free spell of choice with no
  bounded picker — record it in Spells Known via the spell browser.
- Short Rests restore short-rest feature uses plus Warlock pact slots
  (read off the level-up plan, single-class Warlocks). Long Rests
  restore all feature uses, clear used spell slots, and heal to full
  HP — all in one undoable commit (see `takeRest` in `customSheet.js`).
- The merged-language-picker utilities (`mergeLanguageGroups`,
  `distributeLanguagePicks`) and the standalone spells/languages step
  renderers (`renderSpellsStepInto`, `renderMergedLanguagePickerInto`)
  are still exported and test-covered but no longer rendered — the
  wizard shows per-source sections instead. Delete them if they stay
  unused.

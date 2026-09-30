# Grimoire

A private, D&D-only character creator and manager. Statically hosted via
GitHub Pages, backed by Firebase (Firestore + Auth + Storage) for shared
persistence among friends, with a fully functional offline mode that needs
no backend at all.

---

## The sheet is a builder, not a fixed form

Nothing about a sheet's shape is baked in. Blocks and fields are added,
removed, dragged, resized, restyled and relabelled freely, and the whole
sheet can be re-flowed to a target screen shape and then rearranged by
hand.

### One object, not two

A "stat block" and a "stat field" are the same underlying object (see
`js/data/blockModel.js`) — a **node** with `kind: "block"` (a container
with children) or `kind: "field"` (a leaf value: text, radio group,
checkbox group, dropdown, catalog, text list, formula). `createBlock()`
and `createField()` are convenience wrappers around it.

Every field and block ships with a **Label** child element that can be
deleted and restored. Deleting it is a rendering choice only, never a
rename: a field's `label` is also its formula variable name, its name in
the left-hand list, and the name you drag onto the character card.

### One grid, every level

Everything is positioned in whole cells of a single grid — `x, y, w, h` in
`js/data/blockModel.js`, never free pixels. Column width is responsive
(recalculated from the page's pixel width on resize); row height is fixed.
A block's children use the **exact same column width** as the page grid,
with the block's own `w` as their local column count — that is what makes
"one cell" mean the same physical size whether you are looking at the page
or inside a block. `js/render/customSheet.js`'s file-level comment has the
full math.

### Modes

- **Sheet View** — the 2D grid above.
- **Simple View** — a display mode that stacks every block into a
  full-width section and every field into a full-width row. Saved `x/y/w/h`
  are never written; the only DOM change is a flex `order` plus a class on
  the grid, both cleared on the way out, so switching back restores the
  grid exactly. Good for small screens.

---

## Running it

ES modules will not load from a `file://` path, so you need a static
server rather than a double-click. From the project root:

```
python3 -m http.server 8080
```

(or `npx serve .`, or VS Code's Live Server — any static server works)

- **http://localhost:8080/demo.html** — the real sheet with placeholder
  data via `js/state/mockStore.js`. No setup at all; edits log to the
  console.
- **http://localhost:8080/?offline=1** — the real app backed by this
  browser's localStorage. No Firebase, no sign-in, all features.
- **http://localhost:8080/** — the Firebase app (see Setup).

### Setup (Firebase)

1. Create a Firebase project; enable **Firestore**, **Google Auth** and
   **Storage**.
2. Copy your web app config into `js/state/characterStore.js`
   (`firebaseConfig`).
3. Deploy `firestore.rules` (`firebase deploy --only firestore:rules`).
4. Deploy `storage.rules` (`firebase deploy --only storage`) — needs the
   Blaze plan, because the owner check reads the character document.
5. Push, then enable GitHub Pages on the repo (serve from root; `docs/`
   holds notes, not the site).

---

## Structure

```
css/
  tokens.css        design tokens: palette, spacing, type, 7 sheet themes
  base.css          resets, bare element defaults
  layout.css        page-level scaffolding
  components/       one file per reusable UI pattern
  main.css          @imports everything in cascade order
js/
  main.js           auth flow + routing between character list / sheet
  data/             content and rules. Pure. No DOM, no Firebase.
    schema.js           blank-character factory + ABILITIES/SKILLS/LANGUAGES
    blockModel.js       node shape, factories, starter layout
    dnd5e.js            ruleset registry, class hit dice, level plans
    formula.js          expression engine
    rulesEngine.js      rule evaluation for level-up gating
    expressDefaults.js  per-class Express-setup defaults
    themes.js           the 7 sheet themes and their border shapes
    catalogLinks.js     stable catalog-entry ids + bundle↔catalog wiring
    choiceCategories.js which page a choice group belongs to
    pluralText.js       resolves "1 feat(s)" style lazy plurals
    spellIndex.js       finds spell names in prose
    featBundles.js      GENERATED - 83 feats
    subclassContent.js  GENERATED - 117 subclasses
    contentCatalogs.js  GENERATED - 537 spells + weapons, armour, gear
    defaultContent.js   GENERATED - the hand-authored core bundles
    raceContent.js      GENERATED - not wired; defaultContent.js +
    bgContent.js        extraRaces.js are the live race bundles
    contentFixups.js    hand-written patches over all of the above
    extraRaces.js       hand-written race bundles
    missingPicks.js     choice-group builders
    subclassPicks.js    picks the sources left as feature names
    subclassFeatureText.js  GENERATED rules text fetched from the wiki
    classPicks.js       ditto, for class-level features
    startingEquipment.js / portraitArt.js / pickerFlavor.js
  render/
    customSheet.js    composition root. Owns session state + store wiring;
                      every DOM structure and every pure computation lives
                      in sheet/ and is called with explicit deps.
    gridEngine.js     pure grid math (collision + gravity pack)
    formulaEditor.js  the live formula editor
    print-helpers.js  print scale, tab selection, the print stylesheet
    catalogBrowser.js the catalog/shop browser
    bundleLibraryEditor.js / catalogLibraryEditor.js  author-side editors
    sheet/          one module per concern, all explicit-deps
      sheetConstants, sheetHelpers, sheetState, sheetDrag, sheetSelection,
      sheetToolbar, sheetFields, sheetBlocks, sheetAttacks, sheetRolls,
      sheetLeveling, sheetWizard, sheetWizardSteps, sheetBundles,
      sheetHistory, sheetTabs, sheetStyles, sheetRules, sheetRender,
      sheetLayouts, simpleView, aspectPresets, featList, spellLinks,
      linkedSheet, levelingModel
      index.js          barrel (import specific modules, not this)
  state/
    characterStore.js the ONLY file that imports Firebase
    localStore.js     offline backend, same exports
    mockStore.js      demo.html's in-memory backend
    characterImages.js / bundleMaps.js   shared by both backends
scripts/            compilers, checks, and browser tests (see Checks)
tests/              node:test unit suites
data/               shared reference JSON + firestore.rules + storage.rules
docs/               notes and import sources (see below)
index.html  demo.html
```

---

## Checks

Six gates. The first five are fast and need no browser; the last drives
real Chrome.

```
node --test tests/*.mjs          # 480 unit tests
node scripts/check-imports.mjs   # import graph, syntax, CSS brace balance
node scripts/smoke-imports.mjs   # module graph + pure-logic assertions
node scripts/smoke-dom.mjs       # renderers against a stub DOM
node scripts/verify-content.mjs  # content wiring + a 1-20 build simulation
npm run test:e2e                 # real Chrome, desktop + mobile
```

`verify-content.mjs` simulates full level 1–20 builds (Fighter, Light
Cleric, Devotion Paladin, Lore Bard), a 12-class sweep, every starter
race, a Cleric/Wizard multiclass cap check, and every Elf subrace. Every
statModifier target, dropdownAccess id, and granted spell name must
resolve or it fails. It also asserts that every shipped choice group
carries an explicit category and choice kind.

`npm run test:e2e` needs Chrome at a standard path or
`PLAYWRIGHT_CHROME_PATH`, plus `npm install` for `playwright-core`. It
serves the repo over local HTTP, drives the real app, fails on any page
error, and writes screenshots and PDFs to `os.tmpdir()/grimoire-e2e`.

Print is verified against **real output**, not against what the CSS says:
the e2e stubs `window.print()` to capture the print stage and the injected
`@media print` stylesheet at the moment the print pipeline would have seen
them, re-attaches them, and runs `page.pdf()` against real Chrome.

---

## Content pipeline

`docs/New Info/5e-*.txt` (Foundry VTT exports) compile into the bundle and
catalog shapes the site reads:

```
node scripts/compile-foundry-feats.mjs        # 83 feats
node scripts/compile-foundry-catalogs.mjs     # 537 spells + 831 items
node scripts/compile-foundry-subclasses.mjs   # 117 subclasses
node scripts/compile-foundry-races-bg.mjs     # thin race/bg placeholders,
                                              # NOT wired (see above)
node scripts/compile-mechanics-content.mjs    # the mechanics JSON
```

**Generated files are never hand-edited.** Everything applied on top of
them lives in a fixup layer, so the generators stay regenerable:

- `js/data/contentFixups.js` — the main patch layer: Fighting Styles,
  Expertise, Metamagic, Eldritch Invocations + Pact Boon, Hunter's Prey,
  the Elf/Dwarf/Gnome/Halfling/Genasi subraces, free-form racial ASIs,
  the High Elf's extra language and cantrip, the dwarf's base tool rule,
  the yuan-ti's languages, and the class/race choice features.
- `js/data/subclassFeatureText.js` — **generated**, the rules text for 549
  of 640 subclass features, fetched from `dnd5e.wikidot.com` (CC-BY-SA).
  Built by `scripts/fetch-subclass-feature-text.mjs` (scrapes and records
  each page URL) and `scripts/compile-subclass-feature-text.mjs`
  (segments each page per feature). Regenerate with both, in that order;
  the raw scrape cache is gitignored, the compiled module is committed so
  the sheet never needs a network round trip.
  `applyFetchedFeatureText` in `contentFixups.js` fills blank descriptions
  from it, stamps `sourceUrl` on the grant, and clears the `unsourced` flag
  — which matters more than it looks, because `customSheet.js` filters
  unsourced grants out of the Features list *entirely*, so a feature with
  text but no flag change would still be invisible.
- `js/data/subclassPicks.js` — 38 subclass features whose rules define a
  *choice* but whose data arrived as a bare name (a Totem Warrior's Totem
  Spirit, an Armorer's Armor Model, a Rune Knight's runes, the bonus
  proficiency picks, and so on). Checked against the fetched text by
  `scripts/audit-subclass-choices.mjs`.
- `js/data/classPicks.js` — the same at class level: the ranger's extra
  favored enemies and terrain, the humanoid-type pick, the warlock's Mystic
  Arcanum, the wizard's Spell Mastery and Signature Spells.
- `js/data/catalogLinks.js` — every catalog entry gets a stable id
  (`subclass:champion`), and every bundle records the id it reads flavor
  from, so a rename on either side cannot break the pairing.
- `js/data/choiceCategories.js` — every shipped choice group carries an
  explicit `pageCategory`, so it isn't re-guessed from its label per
  render.

One regen caveat: the committed `subclassContent.js` carries hand fixes a
clean re-run would clobber (a source typo ships corrected, plus
formatting) — re-run, then re-apply them; see the note in
`compile-foundry-subclasses.mjs`.

Save/load strips and rehydrates all default bundles so characters stay
lean — `js/state/bundleMaps.js`, shared by both backends.

---

## Character creation wizard

Six steps. Choices appear where they originate: languages, ability-score
increases, and feature picks render as sentences with dropdowns inside the
race or background profile itself. Everything else renders as collapsible
sections directly under the pick that grants it, never on separate later
pages.

1. **Basics** — one ruleset at a time, then that ruleset's content books
   (saved as your per-user default, always overridable per character),
   character name, starting level, race, and race-granted choices.
2. **Class** — class, subclass where choosable now, class-granted
   choices, the spell picker for casters, and Magical Secrets for Bards
   with unlocks. **Express** lives here too: one click fills every choice
   with the class's recommended defaults and lands on Gear & Review.
3. **Ability Scores** — Point Buy by default (Random Roll / Manual also
   available); granted bonuses show under each score ("+2 from Elf → 17
   total") so nothing surprises. Feat ability minimums show here too, as a
   warning with the shortfall, on the score that has to rise.
4. **Background** — background plus its granted languages, skills and
   tools.
5. **Feats** — only when something actually offers one; skipped otherwise,
   with a "skipped" marker on the progress dots.
6. **Gear & Review** — starting equipment, weapon/armor/tool training, the
   HP method, automatic grants, and Finish Setup.

How it behaves:

- **Gated per section.** Next stays disabled until every section on the
  page is decided. Dots and Back always work backward. Auto-skipped steps
  stay greyed out until you pass them, then show a muted "skipped" tag.
  The progress bar is derived from the real step count.
- **An expanded row shows its own picks**, whether or not that row is the
  selected one. Each race row's mechanics and choice controls come from
  that row's own bundle, so browsing a race you haven't picked still shows
  what it would give you. Clicking a row never moves the page.
- **Picker rows** show a personality blurb plus categorized, bulleted
  mechanics, collapsible per row. Bullets list only what applies at the
  current level — never future unlocks, never "(level N)" tags.
- **Abilities read abbreviated everywhere** ("STR", never "Strength"),
  each hovering its full name. Compiled shorthand renders as prose
  ("@con.mod" → "CON modifier", "@prof" → "proficiency bonus").
- **Languages read as a profile sentence** ("Languages — Common, Dwarvish,
  [▾]"): known tongues as text, one dropdown per pick. Common is locked
  everywhere and never counts against the budget.
- **Ability increases read as a sentence too** ("+1 to each of [▾], [▾]"),
  and an ability may be picked twice. A feat that grants a free ASI offers
  "+2 to" and "+1 to" dropdowns.
- **A race's granted spells are filtered to the level in hand** — a
  tiefling sees its cantrip at 1 and gains the higher-level unlocks as it
  levels.
- **Every spell named in prose links to that spell's entry** — in traits,
  features, feats, descriptions, and the feature list on the sheet.
- **Magical Secrets** (Bard 10/14/18, College of Lore 6) is a real
  any-class spell picker, capped at the unlocked total.

### Feats

A Feats list: one row per feat — checkbox, icon, name, summary, then the
mechanical text with **each benefit on its own line**. Feat prerequisites
are parsed and acted on rather than printed: an unmet **ability** minimum
leaves the feat pickable and shows a warning with the shortfall (and the
same shortfall appears on the Ability Scores step); an unmet **race or
lineage** rule hides the row, because a row you can never tick teaches
nothing. Anything the parser cannot evaluate is treated as met — a rule we
do not understand must never be the reason a feat disappears.

The picker dialog is widened on large screens, because 83 feats with a
mechanical line each is a lot to read in a narrow column.

---

## Leveling

A **Leveling** tab, with two sub-tabs. It defaults to the walkthrough,
because that is the tool people act on; the glance table is one click away.

- **Walkthrough** — one step per level gained: which class takes it, HP,
  ASI or feat, subclass, skills, tools, spells, features, notes, and a
  review before anything is applied. Long rests restore feature uses and
  pact slots; short rests restore short-rest uses.
- **At a Glance** — everything by level, gathered from the same sources
  the sheet applies, including secondary classes and taken feats.

Every level-gated grant or removal projects into one shape regardless of
category (`js/render/sheet/levelingModel.js`):

```js
{ id, type, conditions: [...], effect, removalConditions: [...] }
```

Keys within one condition entry are AND'd; entries in the array are OR'd,
so a rule can require "an Orc **and** a Rogue" as easily as either alone.
This is a projection, not a content migration — the data already exists in
five shapes that each carry their own `minLevel`, and rewriting them would
put the sourcing gates at risk.

---

## Multiclassing

Starting at total level 2, the Leveling tab asks which class gains each
level: the primary, an existing secondary, or a new one (gated on 13+
with racial bonuses counted — fighters need Str or Dex, monks/paladins/
rangers need both of theirs).

- Features, resources, choice groups and granted spells gate on each
  class's own levels, not the total.
- Spell slots follow the PHB multiclass table; Warlock pact slots stay on
  their own short-rest track and merge by max per tracker.
- Spell picks enforce the level's own class caps against that class's
  spells only.
- New classes grant no save proficiencies and no armor/weapon fixed grants
  (PHB); skills and tools stay pickable, and the Equipment Proficiencies
  block covers the rest by hand.
- Each applied level records which class took it.

---

## Other tab types

Alongside the main, rules and leveling tabs:

- **Linked sheet** — a read-only tab showing another of your characters
  (mounts, companions, anything), from a fixed table of facts. Read-only
  is deliberate: editing through a link would write to a *different*
  character record, and undo/redo is per-character, so the player would
  undo something invisible or lose an edit. "not-owned", "self" and
  "missing" are each reported rather than rendered blank.

## Screen shape

Seven named shapes (16:9, 16:10, 4:3, phone portrait/landscape, tablet
portrait/landscape) plus **user-defined** ones — "Add shape" asks for a
name and a ratio and derives the column count from it, so naming a ratio
does not require knowing the sheet is a 16-cell grid.

Selecting a shape re-flows the blocks into that many columns as a best
guess: existing order, balanced by height, blocks never reordered, each
block's own height untouched. Detection only ever *offers* — on load the
matching shape becomes the control's placeholder text and nothing is
applied, because reflowing a sheet behind the user's back is destructive
and they may just be resizing the window.

A hand-arranged shape is **restored** when you come back to it, not
re-guessed: each (shape, tab) pair keeps its own snapshot, taken as you
leave.

---

## Printing

The Display panel's Print button opens a checklist: which tabs, page
orientation, scale (fit / actual / custom), background images, and
hidden or calculated fields. Each selected tab renders into its own
printed page, and `window.print()` is called **once** for the whole set.

Unselected tabs are never built into the print tree at all, so they are
excluded from the document rather than hidden with `display: none` — a
hidden node still occupies a box in some print pipelines, which is how a
"hidden" tab becomes a blank page.

---

## Themes and accessibility

Seven sheet themes (Standard, Fancy Medieval, Simple Medieval, Modern,
Cyberpunk, Space Sci-Fi, DOS) in light or dark mode, each with its own
border shapes. Themes are colour-token swaps only, so every theme fits
every layout.

Both fields and blocks carry an optional hover description, edited
through a "?" control in the node's toolbar. No element ships with a
*default* description — inventing one per starter field would be exactly
the unsourced guessing the content rules forbid — so the field is
author-set.

---

## Images

Picture fields and background images upload to Firebase Storage, not the
character document: the document keeps the renderable URL plus a
Storage-path sidecar for deletes and re-resolution. Uploads are
preview-first; replacing an image deletes the replaced object, and
deleting a character wipes its whole Storage prefix. Legacy data-URL
images migrate on the next online load. Offline keeps data URLs.

Uploads are downscaled in the browser (max 500px wide, WebP 0.7) before
upload, so a large photo costs a fraction of the Storage and bandwidth it
otherwise would.

---

## Sharing, offline mode, access model

- **Shared (default).** Any signed-in friend can *read* any character —
  that is the point of a shared table, so a DM and party can open each
  other's sheets — but only the *owner* can create, update or delete
  their own. Image reads mirror this; image writes and deletes are
  owner-only. Tighten reads to owner-only if the table should stop
  sharing.
- **Offline (`?offline=1`).** Same app, same features, data in this
  browser's localStorage. A banner on the character list says which mode
  you're in.

---

## Extending it

- **New field** → add it in the sheet builder, or extend the field types
  in `js/data/blockModel.js` + `js/render/sheet/sheetFields.js`.
- **New field type** → a builder in `sheetFields.js`, plus one CSS file in
  `css/components/` if it needs its own look.
- **New D&D rule** → a pure function in the matching `js/render/sheet/` or
  `js/data/` module (explicit deps, no sheet closure).
- **New race/class/subclass/background** → add it to the source export
  and recompile, then add any choice it is missing to the relevant picks
  table. Do not hand-edit a generated file.

Rulesets live in `js/data/dnd5e.js` and are consumed by the generic
Leveling tab rather than by the sheet builder, so a new game can register
its own shape without touching the renderer.

---

## `docs/`

- `docs/New Info/5e-*.txt` — the Foundry VTT exports the compilers read.
- `docs/RESCUE-NOTES.md` — how the mechanics content was built, what is
  generated, and what is hand-tracked.
- `docs/MECHANICS-IMPORT-NOTES.md` — the mechanics-JSON import model.
- `docs/SUBCLASS-CONTENT-AUDIT-2026-09.md` /
  `docs/subclass-gaps.md` — the per-subclass sourcing audit. Now reports
  0 unsourced grants of 636, and records the two things that count as a
  source: the hand-written summaries file, and the fetched wiki text.
- `docs/CONTENT-AUDIT-2026-09.md` — the same audit for races, classes and
  backgrounds.
- `docs/Improvements to make.txt` — the short list of what is still open.
  Everything already built is documented in this file instead.

---

## Known limits

Stated plainly rather than hidden:

- **Four subclasses have no feature text.** Of 117 subclasses, 113 are
  fetched from `dnd5e.wikidot.com` and 549 of 640 features carry their
  rules text, source URL and all. The four that do not — Path of Wild
  Magic, Way of the Sun Soul, Bladesinging College, Warding Magic — are
  absent from that wiki, and their features still show name only. The rest
  is not missing prose but missing *mechanics*: a feature whose text is
  prose and nothing else still needs its effects modelled, which is a
  content-authoring job rather than a missing source.
- **No importer for outside characters.** A character built elsewhere
  starts here as a fresh sheet, filled in through the creation wizard.
- **No feat icon art.** All 83 catalog entries ship with empty `imageData`
  (compiled from a text export), so every feat row shows the same marker.
- **Label repositioning is a 4-state cycle button**, not a free drag —
  click it and the label animates to the next position. Side labels share
  their field's box rather than being an independent resizable cell.
- **Rich per-selection text formatting** applies inside a text field's
  value, not to its label or a block's name. Those still inherit
  whole-node font and colour through CSS.
- **Compaction is a full re-pack**, not a minimal-disturbance push.
- **A catalog field linked to someone else's *personal* catalog** opens
  empty for the rest of the table (personal libraries are owner-only). It
  fails with a notice; link a global catalog for table-wide lists.
- **The bundle/catalog library editors have no choice-group UI.** Groups
  arrive by JSON import; the editors cover entries, fields and metadata.
- **`removalConditions`** is modelled and carried through the leveling
  model, but no source data shape expresses a removal, so nothing populates
  it. It is empty rather than guessed at.
- **No dyslexia font option and no colour-blind-specific palette.** Seven
  themes give a lot of contrast choices, but neither of those is a
  deliberate option yet.
- **No DM campaign management** — no campaigns, and no invitations binding
  several characters together. Each character stands alone.

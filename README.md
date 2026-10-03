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

- **Sheet View** - the 2D grid above.
- **Simple View** - a display mode that stacks every block into a
  full-width section and every field into a full-width row. Saved `x/y/w/h`
  are never written; the only DOM change is a flex `order` plus a class on
  the grid, both cleared on the way out, so switching back restores the
  grid exactly.

**Below the width the grid cannot fit, Simple View is not a preference.**
The grid is a fixed 16 columns with a floor on how small a cell may get
(`MIN_CELL_PX`), so its box is about 790px wide and no shrinking brings it
under a phone's 344. Under that width the sheet stacks itself: the toggle
names the view it cannot switch to, refuses, and says why, and widening the
window brings Sheet View back — so a phone is one screen you scroll up and
down, never sideways. The width rule is a pure predicate
(`narrowScreenNeedsStackedView`) over the grid's own declared width, not a
hard-coded breakpoint, so it follows the column count and the cell floor.

The choice is kept separate from the effect on purpose. Stacking below that
width is forced on someone who never asked for it, so the builder chrome the
player chose to hide is still theirs to keep or lose: the Display panel
(print, theme, reading options) has nothing to do with the layout, and
taking it away on a phone would be losing features rather than gaining them.

Phone portrait gets the same treatment from the stylesheet: the Expand All /
Collapse All pair and the Return to Character Selection / Sign out pair each
split their row evenly and span all of it (`flex: 1 1 0` rather than each
sizing to its own label), and the Display panel anchors to the page edges
instead of to a ~90px summary in a wrapped toolbar row — which used to hang
169px off the left of the screen, reachable only because the sheet grid
overflowed sideways and gave the page a scrollbar to scroll along.


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
    spellGists.js       the one-paragraph spell summary shown in pickers,
                        derived from each spell's shipped effect text
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
    loadFailure.js    why a fetch or a render failed, in words that name
                      the fix (its own module because main.js awaits the
                      backend at module scope and cannot be imported in Node)
    characterImages.js / bundleMaps.js   shared by both backends
scripts/            compilers, checks, and browser tests (see Checks)
                   gate-fast.mjs runs the five no-browser gates together
tests/              node:test unit suites
data/               shared reference JSON + firestore.rules + storage.rules
docs/               notes and import sources (see below)
index.html  demo.html
```

---

## Checks

Seven gates. The first six need no browser and run together in about three
seconds; the last drives real Chrome.

```
npm run gate              # the six fast gates, concurrently, ~3s
npm test                  # unit tests only
npm run test:watch        # unit tests, re-running on save
npm run test:content      # content invariants only
npm run test:generated    # generated modules match a fresh compile
npm run test:e2e:smoke    # real Chrome, one viewport, core flow, ~80s
npm run test:e2e:areas    # list the e2e areas you can select
npm run test:e2e -- --only AREA...   # real Chrome, only those areas
npm run test:e2e -- --only '!AREA'   # everything EXCEPT that area
npm run test:e2e          # everything, ~160s
npm run verify            # gate + the full e2e, i.e. everything
```

The six fast gates are also runnable on their own, which is occasionally
useful when one of them is what you are working on:

```
node --test "tests/**/*.mjs"   # 920 unit tests
node scripts/check-imports.mjs # import graph, syntax, CSS, and four code rules (below)
node scripts/smoke-imports.mjs # module graph + pure-logic assertions
node scripts/smoke-dom.mjs     # renderers against a stub DOM
node scripts/verify-content.mjs # content wiring + a 1-20 build simulation
node scripts/verify-generated.mjs # generated modules match a fresh compile
```

`check-imports.mjs` also enforces four rules that are cheaper to state as
checks than as conventions:

- **`markup:`** — no `innerHTML` assigned a template literal containing an
  interpolation. A library name is user-authored and persisted, so
  interpolating one runs it as markup in everyone else's session. Use `el()`.
- **`listeners:`** — no `function`/arrow handler on `document` or `window`.
  Neither node is torn down, so an inline handler cannot be removed by
  anyone, including `destroy()`.
- **`layering:`** — nothing under `js/data` may import `render`, `state` or
  `ui`. Data is the bottom of the stack; an upward import makes `js/data`
  unloadable without a DOM.
- **`di:`** — a ratchet on the injected-dependency count (currently 278,
  zero headroom). It exists because the full collapse into one context
  object was scoped and deliberately not done; see the comment in
  `check-imports.mjs` for why the original justification did not survive
  measurement. Lowering it needs no justification, raising it does.
- **`dead exports:`** — an `export` that no other module imports *and*
  nothing calls, used internally, or reaches through a dynamic or namespace
  import. Currently zero. The distinction matters: an export no other module
  imports but which its **own** module calls is live code, not dead code —
  a survey here once counted 146 such exports and ~1,300 lines as dead, and
  every one turned out to be called inside its own file.

`npm run gate` runs them as plain child processes rather than chaining npm
scripts. That is not a style preference: chaining five npm scripts spawns
five extra Node processes, and at these sizes the overhead exceeded the work
being saved — the same gates measured ~16s through a parallel runner over npm
scripts and ~3s as direct children. It also prints a per-gate summary with
each one's duration, which is the answer to "why did that get slow".

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

### Confining the checks, and why the unit tests are not confined

**Nothing is confined by default.** Every gate runs everything, every time. That
is deliberate for the fast gates and worth revisiting for the e2e — the
reasoning is below rather than a shrug.

**The unit tests stay unconfined on purpose.** The obvious thing to build is a
graph from source file to the tests that import it, and the measurement kills
it. Of the 45 `js/` modules the suite reaches:

| Change | Tests that must run |
|---|---|
| `js/data/themes.js`, `sheetConstants.js`, `simpleView.js`, `loadFailure.js` | 1 of 30 |
| `js/render/sheet/sheetWizard.js` | 8 of 30 |
| `js/data/schema.js`, `contentFixups.js`, the generated bundles | 17–18 of 30 |
| `js/render/sheet/sheetMechanics.js` | 19 of 30 |

The most-confined modules are leaf utilities; the ones you would most often
want to change are the **least** confined, because the content layer is the
*subject matter* of those tests rather than a dependency of them. Confinement
would save 1.3s of a 2.5s suite in the good case and still run 63% of it in the
bad one — while costing a graph build, and introducing a class of bug where the
graph is wrong and something silently goes unchecked. At 2.5s it is not the
problem.

**The e2e is confined by area**, because that is where the wall clock is and
because its sections are already independent. `npm run test:e2e:areas` prints
them. Ten areas, selectable by name:

```
print-pdf  shapes  vault-cards  phone-layout  widths-sweep
levelgated-text  rowclick  spell-rows  swipe-arrow  load-failure
```

A leading `!` inverts, which is the shape you usually want: you are working on
the Leveling tab, so the other 90% should run to prove you did not break it,
while the 10% you are editing will not pass yet.

The three viewport passes and the wizard walkthrough inside them are
**not** selectable. They are the app booting and rendering — the floor under
everything else — and they are also the blocks whose braces do not close where
they appear to, so they cannot be wrapped without restructuring the file. That
is stated rather than hidden, and it is why a `--only` run is ~100s rather than
the ~30s a fully-conforming selector would give.

### Why the e2e suite is not full of `waitForTimeout`

It used to be, and fixing it uncovered a real bug. There were 136 of them,
totalling 136 seconds of a suite that took eleven minutes — the tests were
mostly asleep. Three changes:

- **`settled(page, selector)`** waits for the thing the page is actually
  waiting for (`.sheet-toolbar`, the vault's New Character button, `.wizard`)
  instead of guessing a millisecond count. A guess is wrong in both
  directions: too short on a loaded machine, and pure dead time on a fast one.
- **`quiet(page)`** polls a fingerprint of what is on screen and returns when
  two consecutive samples match. It reads rendered text, selected `<select>`
  values and checked/expanded state, because a node count or a text *length*
  cannot see a dropdown commit a value.
- **The three viewport runs are concurrent.** They are independent browser
  contexts with no shared state, and they were 85% of the wall clock.

The rule for extending `quiet`'s sample list: add anything that can appear
*over* the page or replace it — dialogs, overlays, toasts. A region that is
merely part of the page is already covered.

### Three bugs the wait removal found

Worth recording, because all three presented as something else:

1. **`clickOnSheet` measured an element's box, then clicked stale
   coordinates.** If the debounced re-render moved the row in between, the
   click landed on nothing — silently, because the hit test had already run
   against the pre-move layout. It now requires the box to be identical across
   two samples before clicking, which fixes every call site at once rather
   than patching them one by one.
2. **Reading `localStorage` 700ms after a click.** The sheet persists through
   `debounce(persistSheetState)` at 500ms, and every action resets that timer,
   so a burst of clicks writes 500ms after the *last* one. 700ms left a ~200ms
   margin. Under three concurrent viewport passes that margin was being missed
   often enough to fail most runs — and to fail *differently* each time
   (`0/8`, `1/8`, `8/8`), which is what made it look like a content bug. Now
   `saved()` waits on the persisted value, and the DOM is a separate debounced
   render, so it waits for both, in that order.
3. **An area helper named `area` collided with a local `const area`** inside a
   `page.evaluate` callback. Harmless in the callback's scope, and a gate
   evaluated in that scope would have called an `Element`. Renamed `inArea`.

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

**Generated files are never hand-edited**, and that is checked rather than
promised: `npm run test:generated` recompiles each one and fails on any
difference. Everything applied on top of them lives in a fixup layer, so the
generators stay regenerable:

- `js/data/contentFixups.js` — the main patch layer: Fighting Styles,
  Expertise, Metamagic, Eldritch Invocations + Pact Boon, Hunter's Prey,
  the Elf/Dwarf/Gnome/Halfling/Genasi subraces, free-form racial ASIs,
  the High Elf's extra language and cantrip, the dwarf's base tool rule,
  the yuan-ti's languages, and the class/race choice features.
- `js/data/subclassFeatureText.js` — **generated**, the rules text for 595
  of 640 subclass features. Two sources: `dnd5e.wikidot.com` (CC-BY-SA,
  2014 rules, 113 of 117 subclasses) as the primary, and the 2024 SRD 5.2.1
  (CC-BY-4.0) as a filler for the 2024-only features the 2014 wiki has
  never heard of. Built by `scripts/fetch-subclass-feature-text.mjs`
  (fetches, records each URL) and
  `scripts/compile-subclass-feature-text.mjs` (segments per feature).
  Regenerate with both, in that order; the raw scrape cache is gitignored,
  the compiled module is committed so the sheet needs no network.

  The segmenter handles the shapes a wiki page actually uses, each of
  which silently emptied real features before: a Channel Divinity option is
  a **list item**, not a heading; the export repeats one feature per level
  ("Arcane Shot (2 options)" … "(6 options)") where the page has **one**
  section, so it fans out; a cleric domain's heading is qualified with the
  domain's own name ("Arcana Domain Spells" for a grant the export calls
  "Bonus Spells"); and the export and the page disagree on some names
  ("Expanded Spells" vs "Expanded Spell List"), so there is an alias table.

  `applyFetchedFeatureText` in `contentFixups.js` fills blank descriptions,
  stamps `sourceUrl` on the grant, and clears the `unsourced` flag — which
  matters more than it looks, because `customSheet.js` filters unsourced
  grants out of the Features list *entirely*, so a feature with text but no
  flag change would still be invisible.
- `js/data/subclassPicks.js` — 38 subclass features whose rules define a
  *choice* but whose data arrived as a bare name (a Totem Warrior's Totem
  Spirit, an Armorer's Armor Model, a Rune Knight's runes, the bonus
  proficiency picks, and so on). `scripts/audit-subclass-choices.mjs`
  reports 0 build choices without a picker, classifying the fetched prose so
  a play-time target is never mistaken for a saved pick.
- `js/data/classPicks.js` — the same at class level: the ranger's extra
  favored enemies and terrain, the humanoid-type pick, the warlock's Mystic
  Arcanum, the wizard's Spell Mastery and Signature Spells.
- `js/data/catalogLinks.js` — every catalog entry gets a stable id
  (`subclass:champion`), and every bundle records the id it reads flavor
  from, so a rename on either side cannot break the pairing.
- `js/data/choiceCategories.js` — every shipped choice group carries an
  explicit `pageCategory`, so it isn't re-guessed from its label per
  render.

A clean re-run of every compiler is byte-identical to what is committed,
including `subclassContent.js` — the fixes that used to exist only in the
output (the source's "Shephard" typo ships corrected, and the Battle Smith
`choiceId` keeps its unhyphenated byte) are encoded in
`compile-foundry-subclasses.mjs` itself. `npm run test:generated` asserts this
on every gate run: it recompiles all three into a temp directory and diffs, so
a hand-edit inside a 48,000-line generated module is a gate failure naming the
file and line rather than a silent revert months later.

Two generated modules are not covered, because there is no in-repo compiler to
compare against: `subclassFeatureText.js` (its input is the gitignored wiki
scrape cache) and `defaultContent.js` (a one-off Python script, not checked in
— see `docs/RESCUE-NOTES.md`, "Regenerating this later").

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
- **A container race is not a species.** Elf, Dwarf, Gnome, Halfling and
  Genasi own a subrace picker and grant nothing themselves, so clicking one
  has opened a list, not chosen from it: the page stays blocked and the
  outstanding list names it until a subrace is picked. The rule is one pure
  predicate (`racePickSatisfied`), read by the page that gates on it and by
  Review, so the two cannot disagree.
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
- **So is the prose.** A trait that starts available and *grows* — the
  Duergar's Magic, the Yuan-ti's Spellcasting, the Genasi's — cannot be
  expressed by `minLevel`, which is one gate per grant and would have to
  hide the whole trait. `levelGatedText` reads the level gates out of the
  prose instead ("starting at level 3", "when you reach 3rd level"), keeping
  only the clauses the character has and dropping the bullet entirely when
  none survive. Recomputed from the level on every render, so changing the
  level in the wizard re-reads the text — the trait appears and disappears as
  you type the number, with no reload. `2nd-level spell` and `within 30 feet`
  are never mistaken for character levels, and text with no gate in it comes
  back byte-identical.
- **Every spell named in prose links to that spell's entry** — in traits,
  features, feats, descriptions, and the feature list on the sheet. And only
  the whole name: "Light Hammer", "Light Armor", "Light Crossbow", "Slow
  Fall", "Dragon Fear", "Shield Master" and "Magical Guidance" are all
  names, so none of them links half a word to a cantrip. The test is on the
  PHRASE, not the word — "cast Light once per long rest" still links,
  because there the capitalised phrase is not a shipped name.
- **Magical Secrets** (Bard 10/14/18, College of Lore 6) is a real
  any-class spell picker, capped at the unlocked total.
- **A spell row says what the spell does.** Each option in a spell picker
  reads as: checkbox, name, the basic facts on their **own** row as discrete
  pieces rather than one joined string ("Level 1 · Abjuration · 1 reaction ·
  Self · 1 round(s) · Artificer, Druid, Ranger, Sorcerer, Wizard" would be an
  unreadable wall, so it is a level, a school, a casting time, a range, a
  duration, and then a muted tail naming who can cast it), then a blank line,
  then a one-paragraph **gist**, then the full text behind a collapsed
  "Full description" disclosure. The gist names what the spell *deals*, not
  only its flavour — Fire Bolt reads "…the target takes 1d10 fire damage",
  not "shoots out a small ball of fire". A row whose gist already is the
  whole text shows no disclosure, because a control that reveals nothing is
  worse than no control.

  The gists are **derived** from each spell's shipped effect text rather than
  written by hand (`js/data/spellGists.js`): there are 537 spells, and a
  hand-written summary that says 1d8 where the spell says 1d10 is worse than
  no summary, because it looks authoritative. Derivation takes the effect's
  first paragraph, drops the "At Higher Levels" and "Spell Lists" tails, keeps
  whole sentences only, and goes at most one sentence past its budget to
  reach the numbers. So **no gist can contradict its own spell** — every
  word of it appears, in order, in the source text, which the unit tests
  assert across all 537 rather than a chosen few. Roll markup
  (`[[/r 1d10]]`) is unwrapped to plain text, because a gist is prose and a
  player would read a template tag as though it were rules. A hand-written
  `SPELL_GIST_OVERRIDES` map exists for the cases derivation gets wrong and
  wins when present; it is empty by design, since an override is a claim
  about the rules that someone has to stand behind.

### Feats

A Feats list: one row per feat — checkbox, icon, name, summary, then the
mechanical text with **each benefit on its own line**. Feat prerequisites
are parsed and acted on rather than printed: an unmet **ability** minimum
leaves the feat pickable and shows a warning with the shortfall (and the
same shortfall appears on the Ability Scores step); an unmet **race or
lineage** rule hides the row, because a row you can never tick teaches
nothing. Anything the parser cannot evaluate is treated as met — a rule we
do not understand must never be the reason a feat disappears.

The picker dialog is widened above the phone breakpoint (721px), so a
tablet gets the full 94vw width rather than falling back to a fixed pixel
cap that gave a phone proportionally more room than a tablet — the one
screen where a long feat list most needs the width.

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

### When it will not open

A failed open used to be silent: the load rejected an unhandled promise, the
vault stayed on screen, and the only explanation anywhere was a browser
console line. Every failure now renders a panel with the reason, what to try,
and a Retry — and the reason distinguishes the two failures that need
opposite responses from the player:

- **Blocked.** `Status code: (null)` means there was no response at all,
  which is not what a dead network produces. Something is refusing the
  request: an ad blocker, a privacy extension, a corporate filter. The panel
  says so, names the host to allowlist, and offers a private window as a way
  to test it (`js/state/loadFailure.js`).
- **Answered.** A permission error or a missing document is a real reply, so
  it gets the ordinary "check your connection" wording rather than an
  allowlist to chase.
- **Fetched but did not render** is caught separately: a saved document the
  current build cannot lay out is a different failure from one that never
  arrived, and neither may blank the page.

The vault's own copy of every character it last listed is kept, because
`listMyCharacters` returns whole documents: a second fetch that fails opens
the character from that copy rather than not at all.

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
- `docs/subclass-text-gaps.md` — **generated**, the 40 grants no free
  source carries, and the 4 that are one feature repeated per level, with
  the reason for each. Committed so "unfinished" is visible rather than
  inferred from a blank cell.
- `docs/CONTENT-AUDIT-2026-09.md` — the same audit for races, classes and
  backgrounds.
- `docs/Improvements to make.txt` — the short list of what is still open.
  Everything already built is documented in this file instead.

---

## Known limits

Stated plainly rather than hidden:

- **40 subclass features have no sourced text**, and 4 more are one feature
  the export repeated per level. 595 of 640 grants carry rules text, a
  source URL and a cleared `unsourced` flag. The residual is 2024-revision
  or non-SRD content that no free source carries — checked against
  dnd5e.wikidot.com, the 2024 SRD 5.2.1, D&D Beyond's free tier and
  dnd5eapi. They are left blank on purpose: a paraphrase from memory would
  be indistinguishable from a real rule to the player reading it. Each one
  is listed with its reason in `docs/subclass-text-gaps.md`. Beyond that,
  features whose prose is now present still have their *effects* unmodelled
  — the sheet can show the rule, not compute it.
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

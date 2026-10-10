# AGENTS.md

Conventions for AI assistants working in this repo. The purpose of every rule
below is context economy: the source is ~1.6M tokens, `js/data/` alone is ~1.0M
of that, and no window holds it. Read narrowly, grep before reading, and never
pull generated content into a session.

## Generated content files: grep, never read

These five files carry ~940k tokens between them. Their first lines say
"auto-generated / do not hand-edit". Treat that as binding.

| File | Lines | ~Tokens | Regenerate with |
|---|---|---|---|
| js/data/contentCatalogs.js | 49k | 455k | scripts/compile-foundry-catalogs.mjs |
| js/data/defaultContent.js | 3 | 207k | no in-repo compiler - see RESCUE-NOTES.md |
| js/data/featBundles.js | 15k | 132k | scripts/compile-foundry-feats.mjs |
| js/data/subclassFeatureText.js | 1.2k | 85k | scripts/compile-subclass-feature-text.mjs |
| js/data/subclassContent.js | 8.2k | 58k | scripts/compile-foundry-subclasses.mjs |

Watch out for the line counts: defaultContent.js is 3 LINES long but 207k
tokens, because each line is a single enormous literal. Line counts are not a
guide to weight here. Reading any of these whole exceeds a context window,
which forces compaction for the rest of the session. Instead:

- To find a specific entry, grep for the name/id string in that file
- To iterate content at runtime, import the existing accessor
  (`spellIndex.js` wraps the catalog: `spellNameIndex`, `spellEntryByName`,
  `spellLevelFor`)
- Never read more than a few lines of these files directly

Content changes belong in the `docs/New Info/` sources or the compile scripts,
followed by a re-run of the script. Never hand-edit the output. Two of the
compilers are Python, not Node: `foundry_to_catalogs.py`, `merger.py`,
`gen-portraits.py`. `fetch-srd-data.mjs` and `fetch-subclass-feature-text.mjs`
hit the network - do not run them casually.

The audit and provenance notes under `docs/` (RESCUE-NOTES.md, the 2026-09
audits, MECHANICS-IMPORT-NOTES.md) are all under 15 KB - safe to read whole.

Small generated supplements also live in `js/data/` (raceContent.js,
bgContent.js, raceContent-names.js, bgContent-names.js) and `data/*.json`
(subclass-feature-sources, subclass-feature-summaries) - a few thousand tokens
each, safe to read.

## Answering content questions without reading content

| Question | Read this instead |
|---|---|
| What shape/fields does a catalog entry have? | scripts/compile-foundry-catalogs.mjs - `makeEntry` and the META TAG TAXONOMY header |
| Does spell X exist, at what level? | js/data/spellIndex.js accessors above, then one grep for the name |
| How does shipped content differ from source? | js/data/contentFixups.js (hand-written; FIXED_RACE/CLASS/BG_ENTRIES show real shapes) |
| Where did this content come from? | The file header names the script and the docs/New Info source |
| What's IN entry X (spell/feat/race/class/bg/subclass)? | `node scripts/entry.mjs <catalog> <name>` (= `npm run entry -- ...`) prints that entry as JSON; `--list <catalog>` lists names; `--catalogs` lists kinds |

A 300-line accessor or compiler beats a 49,000-line catalog every time.

**Look up, don't read.** To answer "does X exist / what's in it", run
`node scripts/entry.mjs <catalog> <name>` (or the spellIndex accessors above).
Never `import` a generated module or grep these files "to look around": a grep
match in defaultContent.js - 3 lines, ~207k tokens - can be a single ~70k-token
line. When a grep is unavoidable, read at most ~10 lines around a confirmed hit,
and never paste a catalog body back into the session. The script loads the
generated data in Node, so the query costs context in the tool, not in you.

## Round trips: batch the probes, not the payloads

Every turn re-sends the whole transcript, so N sequential tool calls cost N
full-prefix re-reads plus N round trips. Collapse independent reads, greps and
lookups into one turn: that is where the saving is. This section wins over any
other rule in this file that it contradicts.

- **Batch what is cheap, narrow and discardable.** Greps and targeted reads
  whose "wrong" answer is a few lines. A speculative probe whose miss is small
  is nearly free to be wrong about.
- **Never batch payloads.** Whole-file reads, writes, and anything that must be
  verified before acting stay serial. A wasteful batch is not paid for once -
  every result stays in the transcript and is re-read on every later prompt,
  and a bloated batch can tip the session into compaction, which costs far more
  than the round trip it saved.
- **Batch only what is independent.** If the shape of the second probe depends
  on the first answer, batching is guessing, not parallelism.
- **Send the Task agent for open-ended search.** It runs its many greps
  internally and returns one summary, so this context pays for the conclusion
  instead of the search.
- **Edit in groups, gate per group.** Independent edits for one task go in a
  single turn followed by one `npm run gate` (the exception to Verification's
  "after every edit" rule); gate again after each fix, and never group edits
  across unrelated areas.
- **Fan out laundry lists.** When one message asks for several unrelated
  changes, do not run them serially in the main session; launch one subagent
  per change with a self-contained task description (a subagent cannot see the
  parent conversation). Only the returned summaries land in the main session,
  which stays at list-size-plus-summaries instead of sum-of-explorations.
- **Serialize what could collide.** Tasks with overlapping blast radius - same
  file, the same `js/data/` catalog, one CSS file - run one at a time, or they
  fight over edits.

## CSS: no new block for a new thing

`css/` is ~10k lines, second only to `js/data/` by weight, and it bloats
the same way: one rule body copied under a new selector per element added.
Measured: ~1,400 lines are exact-body duplicates (the `font-size:
var(--text-xs); color: var(--color-text-muted)` label style alone exists
eight times), ~2,500 more are a body fully contained in a longer one. It
lands hardest in `css/components/custom-sheet-grid.css`,
`css/components/custom-sheet-wizard.css`, `css/phone.css`.

Before adding a rule:

- Grep the declarations you are about to write. If that body already
  exists, add your selector to it; do not copy it under a new name.
- Extend the file that owns the component (`.character-card*` lives in
  card.css). The trailing `*-fixes` files supersede earlier imports by
  design - there are already three (`wizard-fixes`, `simple-view-fixes`,
  `header-fixes`), so a fourth needs that reason written in its header, not
  "too small to bother".
- A single-declaration one-off earns its block only when every other use
  of that declaration has a different value; otherwise it is a modifier
  on an existing class.

Never merge identical bodies blindly. phone.css and the fix files load
last on purpose (see main.css's import comments), so their restatement of
an earlier rule is the cascade mechanism, not a duplicate. Merge only
same-file bodies with nothing in between that one of them must beat.

## Where the code lives

`js/` is 84 ES modules loaded straight from the pages with plain
`<script type="module">` - no bundler, no build step: `data/` the generated
catalogs (read-only), `render/` + `render/sheet/` the renderers, `state/`
persistence, `ui/`, and `main.js` the entry point.

- **Modules must import clean in Node.** `scripts/check-imports.mjs`
  `node --check`s every JS file in the repo, and `smoke-imports` and
  `smoke-dom` import modules under a document stub. A `document.` or
  `window.` touch at module top level, rather than inside a function that
  runs later, reddens the gate in CI before it ever reddens in a browser.
- **See the app at `demo.html`** (mock store) or `index.html?offline=1`
  (localStorage vault: the production code path minus the Firebase backend).
  Pointing at the deployed site means testing against live data.

## Comments: keep every fact, cut every repeated or expired one

Comments are ~17% of source characters (~270k tokens). Each one costs tokens
to write and to re-read on every later edit, so a comment earns its keep by
preventing a mistake - not by describing code.

When writing or editing comments:

- Keep: WHY a non-obvious choice was made; constraints and invariants ("must
  stay last", "the fallback indexes the final element"); hazards that have
  already caused a bug; what a public export promises.
- Cut: history ("used to live in X"), the same fact stated twice in a file,
  narration of what the code plainly does, and `@param`-style boilerplate on
  small obvious functions.
- File headers: five lines or fewer - what the module is for, plus the one
  trap that isn't visible in the code. Longer than that and nobody reads them.
- Test before keeping a line: if deleting it leaves no plausible way for a
  reader to break the code, delete it.

The same test applies when editing an existing comment. Do NOT mass-delete
the comments already in this repo: many encode a bug that was already found
and fixed, and a deleted constraint is a re-found bug. Trim only what you
touch.

## Verification: fast gates first, full e2e last

Run the smallest check that answers the question, in this order:

1. `npm run gate` - the six no-browser gates concurrently, ~4s. Run after
   every edit or group of edits made in one turn, no exceptions; the Round
   trips section above governs what may be grouped. All of unit, imports,
   smoke-imports, smoke-dom, content and generated are inside it, so do not
   spawn them separately - and `generated`, which re-runs the compilers and
   diffs their output, is what catches a hand-edit to `js/data/`.
2. `npm run test:e2e:smoke` - the core e2e flow at one viewport, ~30s. Use
   when a change touches the sheet, wizard, spell/feat/leveling behavior, or
   rendering.
3. `npm run test:e2e -- --only AREA...` - one named area, seconds.
   `npm run test:e2e -- --list` prints the areas. Prefer this when the blast
   radius is known. `--only '!AREA'` runs everything EXCEPT the area still
   being fixed - the right shape mid-iteration, so the other 90% keeps
   proving it while the 10% in progress is allowed to fail.
4. `npm run test:e2e` - the full suite, ~140s, 1700+ checks.
5. `npm run test:crawl:fast` - clicks EVERY control and attributes a page
   error to the action that caused it, ~4.5 min. When a breakage is "somewhere
   in the wizard", this is the tool; e2e only walks the flows.

e2e and the crawl need a real Chrome binary (a well-known install path or
`PLAYWRIGHT_CHROME_PATH`); nothing here downloads one, so a missing binary
fails like a repo bug rather than an env one.

CI parity: `.github/workflows/test.yml` runs all six gates plus e2e and
crawl-fast on every push and PR, so a green gate locally is a green CI. The
exhaustive (non-fast) crawl lives in crawl.yml and does not run on push.

The full e2e and the crawl - and `npm run verify`, which chains e2e after the
gate - run ONCE, at the end of a session, before reporting the work complete,
or when the user explicitly asks. Never after every edit, and never as a first
response to a breakage report: iterate with (1) and (2) until they are green,
then pay for the full runs exactly once.

## Finishing a batch: commit and push

Once a batch of tasks is finished - the gate, and any full verification from
above, are green - land it before stopping:

1. Inspect `git status` and `git diff`, and stage only what the batch
   touched; never blindly `git add -A`, which is how a stray edit to a
   generated `js/data/` file gets committed.
2. Commit with a message that names what the batch did.
3. `git push`.

One commit per finished batch, not per task. Still never: stage secrets or
keys, force-push, or amend a commit that is already on the remote.

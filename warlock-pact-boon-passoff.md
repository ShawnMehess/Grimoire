# Warlock Pact Boon Pass-Off

## What Was Done

### Data Layer (js/data/contentFixups.js)
- **Added `invocationRequirements()` parser** — extracts `{kind:"pact", value:"Pact of the Tome"}` and `{kind:"level", value:5}` from invocation description text (e.g., "Prerequisite: Pact of the Tome", "Prerequisite: 5th level, Pact of the Blade")
- **Attached `requires` arrays to invocation options** in `patchWarlock` — each invocation option now carries `requires: [{kind:"pact",value:"Pact of the Tome"}]` or `[{kind:"level",value:5}]` etc.
- **Added `pickFamily: "warlock-invocations"`** to each invocation tier group so the family lock mechanism prevents duplicate picks across tiers
- **Added `pickFamily: "warlock-pact-boon"`** to Pact Boon group
- **Added `pickFamily: "fighting-style"`** to fighting style groups (Fighter, Paladin, Ranger)
- **Added `pickFamily: "sorcerer-metamagic"`** to Metamagic groups
- **Added `pickFamily: "fighting-style"`** to fighting style groups (Fighter, Paladin, Ranger)
- **Removed placeholder feature grants** — `takeNotes()` strips "not a pickable list here yet" feature grants from invocations and Pact Boon; real choice groups replace them

### Renderer (js/render/sheet/sheetWizard.js)
- **`optionRequirementNote()`** — pure function returning "Needs Pact of the Tome" or "Needs 5th level" when prerequisites unmet
- **`pickedOptionNames()`** — collects all picked option names across groups for cross-group prerequisite checks
- **`pickFamilyOf()` / `familyTakenOptionNames()` / `asiFamilyWithinCap()` / `asiSiblingAbilityCounts()`** — pure helpers for family locking and prerequisite gating
- **`optionRequirementNote()` integration** in three render paths:
  - **Dialog** (`inlineChoiceBullets`): locks options, adds `title` with requirement note
  - **Feature dropdown** (`liveFeatureBullets`): disables options, adds `disabled` + `title`
  - **Section checkboxes** (`renderFlatChoiceOptionsInto`): disables via `familyLocked` set, passes `lockNotes` Map for title text
- **`renderChoiceGroupsInto`** now computes `familyLocked` + `unmet` (requirements) sets, passes both to `renderFlatChoiceOptionsInto` with `lockNotes` Map
- **`renderFlatChoiceOptionsInto`** accepts `lockNotes` Map, adds requirement titles to disabled options
- **`choiceDialogKindFor`** unchanged (still returns "feats" for feat-like groups)
- **`openChoiceDialog`** renders requirement `title` on disabled option rows
- **`openChoiceDialog`** still enforces `maxSelections` cap per dialog open

### Pact Boon Specific (js/render/customSheet.js)
- **`patchWarlock`** creates 7 invocation tier groups (L2/L5/L7/L9/L12/L15/L18) + Pact Boon group, all with `pickFamily: "warlock-invocations"` / `"warlock-pact-boon"`
- **`applyClassPicks`** attaches `pickFamily` and `requires` arrays to invocation options
- **`renderCreationChoiceGroups`** passes `state.level` to `renderChoiceGroupsInto` so level prerequisites evaluate correctly
- **Dedupe fix** in `renderYourChoicesSections`: tracks `classGroupsDrawnByStep` by `group.key` to prevent double-rendering Pact Boon (once in Class Choices, once in Your Choices)

### Warlock Pact e2e Area (`scripts/e2e-smoke.mjs` — `warlock-pact`)
- **Level 1**: Warlock not offered invocations or Pact Boon
- **Level 2**: Invocations offered (2 picks); Tome-locked invocations greyed/disabled; free ones (Agonizing Blast, Armor of Shadows) pickable
- **Level 2 → Level 3**: Level bump on Identity step, walk forward to Class step
- **Level 3**: Pact Boon offered (4 options); clicking Pact of the Tome radio writes pick
- **Post-pick**: Invocations section re-renders; Book of Ancient Secrets unlocks (no longer disabled); Chain-locked still locked
- **Assertions**:
  - Level 1: no invocations/pact offered
  - Level 2: invocations section present, Tome-locked locked, free ones enabled
  - Level 2: picking two free invocations clears reason
  - Level 3: Pact Boon radio group present (4 options), picking "Pact of the Tome" unlocks Book of Ancient Secrets
  - Post-pick: invocations section shows Book of Ancient Secrets enabled, Chain Master still locked
  - Stored choices persist across page reload

---

## What's Still Broken

### 1. Pact Boon Radio Pick Not Persisting
- **Symptom**: Clicking "Pact of the Tome" radio visually checks it, but `character.rules.choices` remains `[]` for `warlock-pact-boon`; level-up walkthrough shows Pact Boon still unchosen
- **Evidence**: Manual `change` event listener fires (`fired: 1`), but app's handler in `renderFlatChoiceOptionsInto` never fires (no "RADIO HANDLER FIRED" log)
- **Root cause suspect**: Pact Boon fieldset rendered **twice** (Class Choices + Your Choices sections) — second render detaches first listener; or `renderPageGrid()` re-render replaces DOM before handler fires
- **Evidence**: Probe found 2 Pact Boon fieldsets in DOM (one detached); manual click on radio shows `checked=true` but `choicesStore` remains `[]`

### 2. Invocations Section Not Re-rendering After Pact Pick
- After Pact of the Tome pick, invocations section should re-render with Book of Ancient Secrets unlocked
- Currently: section stays collapsed/locked until manual Expand All click; `fillEveryPick` doesn't re-query the section body after Pact pick

### 3. Level-Up Flow for Level 3 Pact Boon
- Current e2e uses Identity step level bump hack (click Identity dot → set level=3) instead of real Level Up button
- Need to verify real Level Up button flow works end-to-end

---

## Files to Fix

### Primary
- `js/render/customSheet.js` — dedupe fix verification, `renderCreationChoiceGroups` onChange full re-render
- `js/render/sheet/sheetWizard.js` — `renderFlatChoiceOptionsInto` handler attachment verification, `renderChoiceGroupsInto` family/requirement lock logic
- `js/render/sheet/sheetWizardSteps.js` — `renderClassStepInto` classGroups vs yourChoices dedupe
- `js/render/sheet/sheetWizard.js` — `renderPageGrid` full re-render trigger on Pact pick
- `scripts/e2e-smoke.mjs` — `warlock-pact` area Level Up flow via real button

### Verification Needed
1. **Dedupe works**: `classGroupsDrawnByStep` Set excludes Pact Boon from "Your Choices" — verify only ONE Pact Boon fieldset in DOM
2. **Handler attaches**: `renderFlatChoiceOptionsInto` attaches listener to radio — add `console.debug("RADIO HANDLER ATTACHED", ...)` to verify
3. **Write persists**: `choicesStore[group.key] = [option.id, ...locked]` writes to `character.rules.choices` — verify with `console.debug("RADIO WRITE", ...)`
4. **Re-render triggers**: `onChange` calls `renderPageGrid()` which re-renders invocations section — verify invocations section updates after Pact pick
5. **Level Up flow**: Real Level Up button → Leveling tab → choices step → Pact Boon pick

---

## What "Done" Looks Like
- [ ] Pact Boon radio pick persists in `character.rules.choices`
- [ ] Invocations section re-renders immediately after Pact pick (Book of Ancient Secrets enabled)
- [ ] Level 2 → Level 3 Level Up flow works end-to-end
- [ ] `warlock-pact` e2e passes all assertions
- [ ] No duplicate Pact Boon fieldsets in DOM
- [ ] Invocation prerequisites (level + pact) enforced at all unlock tiers (L2, L5, L7, L9, L12, L15, L18)
- [ ] `npm run gate` passes
- [ ] `npm run test:e2e -- --only warlock-pact` passes

---

## Next Steps
1. Add `console.debug("RADIO HANDLER ATTACHED", group.key, option.id)` in `renderFlatChoiceOptionsInto` to confirm handler attachment
2. Add `console.debug("RADIO WRITE", group.key, option.id, newVal)` in radio handler to verify write
3. Verify dedupe eliminates duplicate Pact Boon fieldset
4. Ensure `onChange` in `renderCreationChoiceGroups` triggers full `renderPageGrid()` re-render
5. Fix e2e Level Up flow to use real Level Up button
6. Run `npm run gate` + `npm run test:e2e -- --only warlock-pact` until green
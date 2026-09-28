#!/usr/bin/env node
// scripts/smoke-dom.mjs
//
// Executes the refactored DOM renderers (generic picker table, wizard
// steps) against a minimal in-memory document stub — no browser, no
// jsdom. Catches ReferenceErrors, broken queries, and structural
// regressions that node --check and the pure-logic suites cannot.
//
//   node scripts/smoke-dom.mjs
//
// Exits non-zero on the first failure so it can gate commits
// alongside scripts/smoke-imports.mjs.

// --- Minimal document stub -----------------------------------------------
function makeNode(tag) {
  const node = {
    tag, nodeType: 1, children: [], parent: null, listeners: {},
    attrs: {}, dataset: {}, style: {},
    hidden: false, title: "", tabIndex: 0, disabled: false,
    checked: false, value: "", _text: null,
    classList: null, // set below (needs node)
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === "class") this._syncClass(String(v));
      if (k.startsWith("data-")) {
        const prop = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[prop] = String(v);
      }
    },
    getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
    append(...kids) {
      for (let k of kids.flat()) {
        if (k === null || k === undefined || k === false) continue;
        if (typeof k === "string") k = { ...makeText(k), parent: this };
        else k.parent = this;
        this.children.push(k);
      }
      return this;
    },
    appendChild(k) { return this.append(k); },
    insertBefore(k, ref) {
      if (k === null || k === undefined || k === false) return k;
      // Real DOM throws when the reference node isn't a child —
      // keep that so mis-targeted insertions fail loudly here too.
      if (ref !== null && ref !== undefined && ref.parent !== this) {
        throw new Error("insertBefore: reference node is not a child of this node");
      }
      if (k.parent) k.remove();
      k.parent = this;
      const i = ref ? this.children.indexOf(ref) : this.children.length;
      this.children.splice(i < 0 ? this.children.length : i, 0, k);
      return k;
    },
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    },
    after(...kids) {
      if (!this.parent) return;
      const i = this.parent.children.indexOf(this);
      const flat = kids.flat().filter((k) => k !== null && k !== undefined && k !== false);
      flat.forEach((k) => { k.parent = this.parent; });
      this.parent.children.splice(i + 1, 0, ...flat);
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const out = [];
      const cls = sel.startsWith(".") ? sel.slice(1) : null;
      const walk = (n) => {
        for (const c of n.children || []) {
          if (!c.tag) continue;
          if (cls && c._classes?.has(cls)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    },
    closest(sel) {
      const cls = sel.startsWith(".") ? sel.slice(1) : null;
      let n = this;
      while (n) {
        if (cls && n._classes?.has(cls)) return n;
        n = n.parent;
      }
      return null;
    },
    click() { (this.listeners.click || []).forEach((f) => f({ target: this, preventDefault() {}, stopPropagation() {} })); },
    get firstElementChild() { return (this.children || []).find((c) => c.tag) || null; },
  };
  node._classes = new Set();
  node._syncClass = (v) => { node._classes = new Set(String(v || "").split(/\s+/).filter(Boolean)); };
  Object.defineProperty(node, "className", {
    get() { return [...node._classes].join(" "); },
    set(v) { node.attrs.class = String(v); node._syncClass(v); },
  });
  Object.defineProperty(node, "textContent", {
    get() {
      // Base text (set before children were appended) plus descendants,
      // mirroring real textContent serialization.
      return (node._text || "") + (node.children || []).map((c) => (c.tag ? c.textContent : c.text ?? "")).join("");
    },
    set(v) { node.children = []; node._text = String(v); },
  });
  Object.defineProperty(node, "innerHTML", {
    get() { return ""; },
    set(v) {
      node.children = [];
      if (String(v || "") !== "") node._rawHtml = String(v);
    },
  });
  node.classList = {
    add: (...c) => c.forEach((x) => node._classes.add(x)),
    remove: (...c) => c.forEach((x) => node._classes.delete(x)),
    toggle: (c, force) => {
      const on = force === undefined ? !node._classes.has(c) : !!force;
      if (on) node._classes.add(c); else node._classes.delete(c);
      return on;
    },
    contains: (c) => node._classes.has(c),
  };
  return node;
}
function makeText(text) {
  return { nodeType: 3, text: String(text), parent: null, get textContent() { return this.text; } };
}

globalThis.document = {
  createElement: (tag) => makeNode(tag),
  createElementNS: (_ns, tag) => makeNode(tag),
  createTextNode: (text) => makeText(text),
};
globalThis.window = globalThis;

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { failures++; console.error(`FAIL: ${msg}`); }
  else console.log(`ok: ${msg}`);
};
const rowsOf = (list) => (list.children || []).filter((c) => (c.className || "").includes("choice-row") && !c.className.includes("choice-row-list"));
const detailsOf = (row) => row.querySelector(".choice-row__details");
const collapseBtnOf = (row) => row.querySelector(".choice-row__collapse-btn");

// --- Generic picker table: single mode ------------------------------------
const wizard = await import("../js/render/sheet/sheetWizard.js");
{
  const calls = [];
  const box = document.createElement("div");
  const list = wizard.renderPickerTableInto(box, ["Elf", "Human"], {
    selectedName: "",
    getInfo: (n) => ({ description: `${n} flavor` }),
    getMechanicsList: () => [{ title: "Racial Traits", items: ["Speed: 30 feet"] }],
    onSelect: (n) => calls.push(n),
    collapsible: true,
  });
  assert(list.className === "choice-row-list", "table renders list");
  const rows = rowsOf(list);
  assert(rows.length === 2, "table renders two rows");
  // Controls present in collapsible mode.
  assert(box.children.some((c) => (c.className || "").includes("choice-row-list__collapse-controls")), "collapse controls render");
  // First click selects + expands (no Collapse button — row click alone toggles).
  rows[0].click();
  assert(calls.join() === "Elf", "row click selects");
  assert(detailsOf(rows[0]).hidden === false, "row click expands");
  assert(collapseBtnOf(rows[0]) == null, "no collapse button (row click toggles)");
  // The app re-renders with the new selection; clicking the open,
  // selected row again collapses + de-selects.
  const box2 = document.createElement("div");
  const list2 = wizard.renderPickerTableInto(box2, ["Elf", "Human"], {
    selectedName: "Elf",
    getInfo: (n) => ({ description: `${n} flavor` }),
    getMechanicsList: () => [{ title: "Racial Traits", items: ["Speed: 30 feet"] }],
    onSelect: (n) => calls.push(n),
    collapsible: true,
  });
  const rows2 = rowsOf(list2);
  assert(detailsOf(rows2[0]).hidden === false, "re-render keeps expansion");
  rows2[0].click();
  assert(calls[calls.length - 1] === null, "second click de-selects (null)");
  assert(detailsOf(rows2[0]).hidden === true, "second click collapses");
}

// --- Generic picker table: multi mode --------------------------------------
{
  const toggled = [];
  const box = document.createElement("div");
  wizard.renderPickerTableInto(box, ["Fireball", "Light"], {
    mode: "multi",
    selectedSet: new Set(["Light"]),
    onToggle: (n) => toggled.push(n),
    getInfo: (n) => ({
      description: `${n} desc`,
      mechanics: n === "Fireball" ? { meta: "Level 3 · Evocation", effect: "Boom." } : null,
      tags: n === "Fireball" ? ["damage"] : [],
    }),
  });
  const rows = rowsOf(box.children[0]);
  assert(rows.length === 2, "multi renders rows");
  assert(rows[1].className.includes("choice-row--selected"), "multi selected state");
  assert(rows[1].dataset.name === "Light", "multi data-name anchor");
  rows[0].click();
  assert(toggled.join() === "Fireball", "multi toggles");
}

// --- Legacy delegates still work -------------------------------------------
{
  const box = document.createElement("div");
  wizard.renderSelectableRowsInto(box, ["A"], { selectedName: "", onSelect: () => {}, collapsible: false });
  assert(rowsOf(box.children[0]).length === 1, "single delegate renders");
  const box2 = document.createElement("div");
  wizard.renderMultiSelectableRowsInto(box2, ["A"], { selectedSet: new Set(), onToggle: () => {} });
  assert(rowsOf(box2.children[0]).length === 1, "multi delegate renders");
}

// --- Ruleset step: rows without native inputs -------------------------------
const steps = await import("../js/render/sheet/sheetWizardSteps.js");
{
  const box = document.createElement("div");
  const picked = [];
  const ids = [];
  steps.renderRulesetStepInto(box, {}, {
    listRulesetsFn: () => [
      { id: "a", name: "A", description: "First" },
      { id: "b", name: "B", description: "" },
    ],
    listContentPacksFn: () => [
      { id: "p1", name: "P1", description: "" },
      { id: "p2", name: "P2", description: "" },
    ],
    defaultContentPackIdsFn: () => ["p1"],
    primaryId: "a",
    includedIds: [],
    updateIdsFn: (v) => ids.push(v),
    setPrimaryFn: (v) => picked.push(v),
  });
  const html = JSON.stringify(box, (k, v) => (k === "parent" ? undefined : v));
  assert(!html.includes('"input"') && !html.includes("INPUT"), "ruleset step has no native inputs");
  const radioRows = [];
  const walk = (n) => {
    for (const c of n.children || []) {
      if (c.attrs?.role === "radio") radioRows.push(c);
      walk(c);
    }
  };
  walk(box);
  assert(radioRows.length === 2, "two ruleset rows");
  radioRows[1].click();
  assert(picked.join() === "b", "ruleset row picks");
  // Content-book toggle rows (role=checkbox) exist and toggle.
  const boxes = [];
  const walk2 = (n) => {
    for (const c of n.children || []) {
      if (c.attrs?.role === "checkbox") boxes.push(c);
      walk2(c);
    }
  };
  walk2(box);
  assert(boxes.length === 2, "two content-book rows");
  boxes[1].click();
  assert(JSON.stringify(ids[ids.length - 1]) === '["p1","p2"]', "book toggle adds in pack order");
}

// --- Guide class step: rich rows --------------------------------------------
{
  const box = document.createElement("div");
  const pending = { className: "Fighter", newClassName: "", subclass: "" };
  steps.renderGuideLevelClassStepInto(box, pending, {
    primaryName: "Fighter",
    primaryLevel: 4,
    entries: [],
    level: 5,
    allClassNames: ["Fighter", "Wizard"],
    eligibilityFn: () => ({ ok: true, reason: "" }),
    subclassForFn: () => "",
    classInfoFn: null,
    selectableRowsFn: (c, names, opts) => wizard.renderPickerTableInto(c, names, { collapsible: true, ...opts }),
    getInfo: (n) => ({ description: `${n} flavor` }),
    getMechanicsList: () => [{ title: "Class Traits", items: ["Hit Die: d10"] }],
    onChangeFn: () => {},
  });
  const labels = [];
  const walk = (n) => {
    for (const c of n.children || []) {
      if ((c.className || "") === "choice-row__label") labels.push(c.textContent);
      walk(c);
    }
  };
  walk(box);
  assert(labels.includes("Fighter") && labels.includes("Wizard"), "guide class rows render taken + untaken");
}

// --- HP / ASI / features / review steps --------------------------------------
{
  const box = document.createElement("div");
  const pending = {};
  steps.renderGuideHpStepInto(box, pending, { conScore: 14, dieSize: 10, method: "average" });
  assert(pending.hp === "8", "HP prefilled with average + CON");
  assert(box.textContent.includes("Fixed average"), "HP math note renders");
}
{
  const box = document.createElement("div");
  const pending = { asiMode: "single", asiAbility1: "", asiAbility2: "", featChoice: "" };
  steps.renderGuideAsiStepInto(box, pending, {
    abilityIds: ["str", "dex"],
    rulesetId: null,
    takenFeats: [],
    featNamesFn: () => [],
    catalogInfoFn: () => null,
    selectableRowsFn: () => {},
    gridFn: () => {},
    abilityScores: { str: 14, dex: 10 },
    modifierFn: (s) => Math.floor((s - 10) / 2),
    formatFn: (m) => (m >= 0 ? `+${m}` : `${m}`),
  });
  assert(box.textContent.includes("STR (14, +2)"), "ASI options carry live scores");
}
{
  const box = document.createElement("div");
  steps.renderGuideFeaturesStepInto(box, [{ name: "Rage", description: "fight harder." }]);
  assert(box.textContent.includes("Rage — Fight harder."), "feature em-dash capitalization");
}
{
  const sections = steps.levelReviewSectionsFor({
    classLine: "Fighter 5", hp: "8", subclass: "Champion",
    needsAsi: true, asiMode: "double", asiAbilities: ["str", "con"],
    choiceLines: ["Skills: Arcana"],
  });
  assert(sections.includes("ASI: STR, CON") && sections.includes("Skills: Arcana"), "review sections");
}

// --- Choice-group list: feat vs non-feat branching -------------------------
// Regression guard: renderChoiceGroupsInto once called a bare
// `categorizeChoiceGroup` it never imported, crashing the creator the
// moment any race with real choice groups (e.g. Changeling) rendered.
// Feat groups render as a summary link opening the shared choice
// dialog (exact same pattern as proficiencies) — no superscript,
// no inline checkbox wall.
{
  const groups = [
    {
      key: "g-feat", label: "Choose a feat", source: "Test",
      minSelections: 0, maxSelections: 1,
      options: [{ id: "f1", name: "Alert" }],
    },
    {
      key: "g-skill", label: "Choose a skill", source: "Test",
      minSelections: 0, maxSelections: 1,
      options: [{ id: "s1", name: "Arcana" }],
    },
  ];
  const box = document.createElement("div");
  const store = {};
  let threw = null;
  try {
    wizard.renderChoiceGroupsInto(box, groups, store, "test", () => {}, () => new Set());
  } catch (err) { threw = err; }
  assert(threw === null, "choice-group list renders without missing bindings");
  if (threw === null) {
    assert(box.querySelectorAll(".level-guide__choices").length === 2, "both choice groups render fieldsets");
    assert(box.querySelector(".inline-pick-help") === null, "feat group has no superscript help");
    const featLink = box.querySelectorAll(".inline-pick-link")[0];
    assert(!!featLink && featLink.textContent.includes("Choose 1"), "feat group renders summary link");
  }
}
// --- Feat summary link opens the shared dialog -------------------------
{
  const host = document.createElement("div");
  const store = {};
  const groups = [
    {
      key: "g-feat2", label: "Choose a feat", source: "Test",
      minSelections: 0, maxSelections: 1,
      options: [
        { id: "f1", name: "Alert", description: "Act first." },
        { id: "f2", name: "Lucky" },
      ],
    },
  ];
  wizard.renderChoiceGroupsInto(host, groups, store, "test", () => {}, () => new Set());
  const link = host.querySelector(".inline-pick-link");
  assert(!!link, "feat summary link renders");
  const dialogHost = document.createElement("div");
  let accepted = null;
  wizard.openChoiceDialog({
    title: "Choose a feat", multi: false, maxSelections: 1,
    options: [
      { id: "f1", name: "Alert", description: "Act first." },
      { id: "f2", name: "Lucky", description: wizard.describeFeatOption({ name: "Lucky" }) },
    ],
    initialSelected: [],
    onAccept: (ids) => { accepted = ids; },
    host: dialogHost,
  });
  const overlay = dialogHost.children.find((c) => (c.className || "").includes("choice-dialog-overlay"));
  assert(!!overlay, "feat dialog opens via shared dialog");
  assert(overlay.textContent.includes("Alert"), "feat dialog lists feats as a table");
  const inputs = overlay.querySelectorAll(".choice-dialog-option").map((l) => l.children[0]);
  assert(inputs.every((i) => i.type === "radio"), "single feat pick renders radios like proficiencies");
  assert(accepted === null, "feat dialog writes nothing before accept");
}

// --- Toolbar shell: Play View insertion point -----------------------------
{
  const shell = await import("../js/render/sheet/sheetToolbar.js");
  const { toolbar, leftGroup, modeBtn } = shell.buildToolbarShell();
  // Regression guard: customSheet inserts the Play View button before
  // modeBtn — that only works against modeBtn's actual parent. It once
  // targeted `toolbar` instead of `leftGroup`, throwing NotFoundError
  // and aborting the whole sheet render (blank creator for new chars).
  const extra = document.createElement("button");
  let threw = null;
  try {
    leftGroup.insertBefore(extra, modeBtn);
  } catch (err) { threw = err; }
  assert(threw === null, "toolbar shell accepts insertBefore(modeBtn)");
  assert(
    leftGroup.children.indexOf(extra) === leftGroup.children.indexOf(modeBtn) - 1,
    "inserted button lands immediately before mode button"
  );
  assert(toolbar.querySelector(".sheet-toolbar__group") === leftGroup, "left group sits inside toolbar");
}

// --- Shared choice dialog: classifier --------------------------------------
{
  const kindOf = (label) => wizard.choiceDialogKindFor({ label });
  assert(kindOf("Barbarian Skill Proficiencies") === "skills", "classifier maps skill groups");
  assert(kindOf("Artificer Tool Proficiency: one artisan's tool") === "tools", "classifier maps tool groups");
  assert(kindOf("Fighting Style") === "styles", "classifier maps fighting styles");
  assert(kindOf("Expertise — pick 2 of your proficiencies") === "expertise", "classifier maps expertise");
  assert(kindOf("Choose a Feat") === "feats", "classifier maps feat groups");
  assert(wizard.choiceDialogKindFor({ label: "Pick 1", category: "feats" }) === "feats", "classifier maps feat category");
  assert(wizard.describeFeatOption({ name: "Alert", description: "Act first." }) === "Act first.", "feat option keeps its own text");
  assert(wizard.describeFeatOption({ name: "Lucky", featureGrants: [{ description: "Spend luck to reroll." }] }) === "Spend luck to reroll.", "feat option briefs its grant text");
  assert(wizard.describeFeatOption({ name: "Mystery" }) === null, "feat option without text yields null");
  assert(kindOf("Languages") === null, "classifier leaves language groups alone");
  assert(wizard.choiceDialogKindFor(null) === null, "classifier tolerates null");
}

// --- Shared choice dialog: open / search / accept / caps / cancel ---------
function openTestDialog(host, overrides = {}) {
  let accepted = null;
  wizard.openChoiceDialog({
    title: "Choose 2 Skills",
    multi: true,
    maxSelections: 2,
    options: [
      { id: "s1", name: "Arcana", description: "Magic lore" },
      { id: "s2", name: "Stealth" },
      { id: "s3", name: "Perception" },
      { id: "s4", name: "Athletics" },
    ],
    lockedIds: ["s3"],
    initialSelected: ["s1"],
    onAccept: (ids) => { accepted = ids; },
    host,
    ...overrides,
  });
  const overlay = host.children.find((c) => (c.className || "").includes("choice-dialog-overlay"));
  const acceptBtn = overlay?.querySelector(".btn--primary");
  const optionInputs = () => overlay?.querySelectorAll(".choice-dialog-option").map((l) => l.children[0]) || [];
  const fireChange = (input, checked) => {
    input.checked = checked;
    (input.listeners.change || []).forEach((f) => f({ target: input }));
  };
  const clickButton = (btn) => (btn.listeners.click || []).forEach((f) => f({ target: btn, preventDefault() {}, stopPropagation() {} }));
  return { overlay, acceptBtn, optionInputs, fireChange, clickButton, accepted: () => accepted };
}
{
  const host = document.createElement("div");
  const t = openTestDialog(host);
  assert(!!t.overlay, "choice dialog mounts in host");
  assert(t.overlay.textContent.includes("Choose 2 Skills"), "dialog shows title");
  assert(t.overlay.textContent.includes("Magic lore"), "dialog shows option descriptions");
  assert(t.overlay.textContent.includes("1/2 picked"), "dialog shows pick count");
  assert(t.optionInputs().length === 4, "dialog lists every option with no search");
  // Accept writes locked + picks.
  const [, s2] = t.optionInputs();
  t.fireChange(s2, true);
  t.clickButton(t.acceptBtn);
  assert(JSON.stringify(t.accepted()) === JSON.stringify(["s1", "s2", "s3"]), "accept writes locked plus picks");
  assert(!host.children.includes(t.overlay), "accept closes dialog");
}
{
  // Max cap: third pick is denied.
  const host = document.createElement("div");
  const t = openTestDialog(host);
  const [, s2, , s4] = t.optionInputs();
  t.fireChange(s2, true);
  t.fireChange(s4, true);
  assert(s4.checked === false, "pick beyond max is denied");
  t.clickButton(t.acceptBtn);
  assert(JSON.stringify(t.accepted()) === JSON.stringify(["s1", "s2", "s3"]), "denied pick never reaches accept");
}
{
  // Cancel discards without writing.
  const host = document.createElement("div");
  const t = openTestDialog(host);
  const [, s2] = t.optionInputs();
  t.fireChange(s2, true);
  const cancelBtn = t.overlay.querySelectorAll(".btn").find((b) => !b.className.includes("btn--primary"));
  t.clickButton(cancelBtn);
  assert(t.accepted() === null, "cancel writes nothing");
  assert(!host.children.includes(t.overlay), "cancel closes dialog");
}
{
  // Radio mode: picking replaces.
  const host = document.createElement("div");
  let accepted = null;
  wizard.openChoiceDialog({
    title: "Choose a Fighting Style", multi: false, maxSelections: 1,
    options: [{ id: "archery", name: "Archery" }, { id: "dueling", name: "Dueling", description: "Plus two." }],
    initialSelected: ["archery"],
    onAccept: (ids) => { accepted = ids; },
    host,
  });
  const overlay = host.children.find((c) => (c.className || "").includes("choice-dialog-overlay"));
  const inputs = overlay.querySelectorAll(".choice-dialog-option").map((l) => l.children[0]);
  assert(inputs.every((i) => i.type === "radio"), "single-pick renders radios");
  inputs[1].checked = true;
  (inputs[1].listeners.change || []).forEach((f) => f({ target: inputs[1] }));
  const acceptBtn = overlay.querySelector(".btn--primary");
  (acceptBtn.listeners.click || []).forEach((f) => f({ target: acceptBtn, preventDefault() {}, stopPropagation() {} }));
  assert(JSON.stringify(accepted) === JSON.stringify(["dueling"]), "radio pick replaces");
}
{
  // Second open replaces the first: ever one dialog object.
  const host = document.createElement("div");
  openTestDialog(host);
  openTestDialog(host);
  assert(host.children.filter((c) => (c.className || "").includes("choice-dialog-overlay")).length === 1, "one dialog object at a time");
}

// --- Slot-level ? opener is preserved -----------------------------------------
{
  let opened = 0;
  const box = document.createElement("div");
  box.append(wizard.renderLiveBulletItem({
    topic: "Languages",
    lead: [{ text: "Common" }],
    slots: [{ key: "k", value: "", placeholder: "Choose…", options: [], dialogOpener: () => { opened++; } }],
  }));
  const help = box.querySelector(".inline-pick-help");
  assert(!!help, "dropdown bullets keep their superscript ?");
  const anchor = help.children[0];
  (anchor.listeners.click || []).forEach((f) => f({ target: anchor, preventDefault() {}, stopPropagation() {} }));
  assert(opened === 1, "slot ? still opens its dialog");
}

// --- Inline bullet summary link ---------------------------------------------
{
  let opened = 0;
  const box = document.createElement("div");
  box.append(wizard.renderLiveBulletItem({
    topic: "Skills",
    lead: [{ text: "Choose 2" }],
    dialogOpener: () => { opened++; },
  }));
  assert(box.querySelector(".inline-pick-help") === null, "choice bullets have no superscript ?");
  const link = box.querySelector(".inline-pick-link");
  assert(!!link && link.textContent.includes("Choose 2"), "choice summary itself is the link");
  (link.listeners.click || []).forEach((f) => f({ target: link, preventDefault() {}, stopPropagation() {} }));
  assert(opened === 1, "summary link opens the shared dialog");
}

if (failures) {
  console.error(`smoke-dom: ${failures} failure(s)`);
  process.exit(1);
} else {
  console.log("smoke-dom: all checks passed");
}

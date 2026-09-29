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
    prepend(...kids) {
      const kept = this.children.filter((c) => !kids.flat().includes(c));
      this.children = [];
      this.append(...kids);
      this.children.push(...kept);
      return this;
    },
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

// --- Label element: every field/block has one, and it can be deleted -------
//
// The Label is a real element, but deleting it is a rendering choice only:
// the field keeps its `label` string, which is also its formula variable
// name, its name in the LHS list, and the name you drag onto the character
// card. These checks pin both halves — the element goes away, the identity
// stays.
{
  const styles = await import("../js/render/sheet/sheetStyles.js");

  // Toggling flips showLabel and reports which way it went.
  const field = { label: "Armor Class", showLabel: true };
  let committed = 0;
  const btn = styles.labelToggleBtnInto(field, { commitFn: (fn) => { committed++; fn(); } });
  assert(btn.title.includes("Delete"), "label toggle offers to delete when the label is shown");
  btn.click();
  assert(committed === 1 && field.showLabel === false, "clicking the label toggle deletes the element");
  assert(field.label === "Armor Class", "deleting the Label element keeps the field's name for formulas/character card");

  const gone = styles.labelToggleBtnInto(field, { commitFn: (fn) => fn() });
  assert(gone.className === "active", "a deleted label reads as active on its toggle");
  assert(gone.title.includes("Restore"), "label toggle offers to restore when the label is deleted");
  gone.click();
  assert(field.showLabel === true, "clicking again restores the label element");

  // A field saved before this control existed has no showLabel property at
  // all; that must read as "has a label", not "label was deleted".
  const legacy = { label: "Speed" };
  const legacyBtn = styles.labelToggleBtnInto(legacy, { commitFn: (fn) => fn() });
  assert(legacyBtn.title.includes("Delete"), "a node with no showLabel property still shows its label");
  legacyBtn.click();
  assert(legacy.showLabel === false, "first click on a legacy node deletes rather than restores");

  // Block wording differs from field wording, since a block's label is
  // its name.
  const block = { name: "Combat", showLabel: true };
  const blockBtn = styles.labelToggleBtnInto(block, { commitFn: (fn) => fn(), isBlock: true });
  assert(blockBtn.title.includes("name"), "block toggle talks about the name");

  // The renderer honors the flag: no .field-label element, and the value
  // takes the whole box.
  const fields = await import("../js/render/sheet/sheetFields.js");
  const renderField = (f) => {
    const el = document.createElement("div");
    fields.renderFieldInnerInto(el, f, { w: 4, h: 1 }, {
      captionlessTypes: new Set(["label", "picture"]),
      buildValueFn: (field) => {
        const v = document.createElement("div");
        v.className = "field-value";
        return v;
      },
      commitFn: () => {},
      frameFn: () => {},
      visibilityFn: () => {},
      growFn: () => {},
      ghostFn: () => {},
      labelInUseFn: () => false,
      toastFn: () => {},
      moneyFn: () => {},
    });
    return el;
  };
  const withLabel = renderField({ id: "a", fieldType: "text", label: "HP" });
  assert(!!withLabel.querySelector(".field-label"), "a field renders its Label element by default");
  const noLabel = renderField({ id: "b", fieldType: "text", label: "HP", showLabel: false });
  assert(noLabel.querySelector(".field-label") === null, "a deleted Label element is not rendered");
  assert(!!noLabel.querySelector(".field-value"), "the value still renders after the label is deleted");

  // And the same for a block header.
  const blocks = await import("../js/render/sheet/sheetBlocks.js");
  const renderBlock = (b) => {
    // renderBlockNodeInto BUILDS AND RETURNS the node; it doesn't append
    // into a container, so the return value is what gets inspected.
    return blocks.renderBlockNodeInto(b, 40, {
      viewOf: (n) => n,
      sourceOf: (n) => n,
      isEdit: true,
      gapPx: 4,
      headerRows: 1,
      applyRectFn: () => {},
      applyStyleFn: () => {},
      ghostFn: () => {},
      ownTextFn: () => {},
      dragHandleFn: () => {},
      resizeHandleFn: () => {},
      toolbarFn: () => {},
      fieldNodeFn: () => document.createElement("div"),
      styleBtnFn: () => document.createElement("button"),
      borderBtnFn: () => document.createElement("button"),
      typeMenuFn: () => {},
      commitFn: (fn) => fn(),
      createFieldFn: () => ({}),
      hoverFn: () => {},
      defaultSize: () => ({}),
      frameFn: () => {},
      persistFn: () => {},
      renderAllFn: () => {},
      dragFn: () => {},
      resizeFn: () => {},
      onSelectBlockOrField: () => {},
    });
  };
  const named = renderBlock({ id: "blk", kind: "block", blockType: "stat", name: "Combat", x: 0, y: 0, w: 2, h: 2, children: [] });
  assert(!!named.querySelector(".block-name"), "a block renders its name element by default");
  const unnamed = renderBlock({ id: "blk2", kind: "block", blockType: "stat", name: "Combat", showLabel: false, x: 0, y: 0, w: 2, h: 1, children: [] });
  assert(unnamed.querySelector(".block-name") === null, "a deleted block name is not rendered");
  const body = unnamed.querySelector(".block-body");
  assert(body && body.style.top === "0px", "the body takes the row the deleted name vacated");
}

// --- Feat list rows ------------------------------------------------------
//
// The spec'd row is checkbox / icon / name / summary, with the mechanical
// effect and a derived "= modifies" line beneath. Two of those are easy to
// get wrong silently: the effect text disappearing (the row is just a
// name, which is the one thing the list exists to avoid), and the
// "= modifies" line claiming something the feat doesn't do.
{
  const featList = await import("../js/render/sheet/featList.js");
  const bundle = {
    name: "Alert",
    statModifiers: [{ targetFieldId: "initiative", op: "add", value: 5 }],
    featureGrants: [{ name: "Alert", description: "You gain a +5 bonus to initiative.\n\nSheet notes: internal bookkeeping." }],
  };
  const catalog = { name: "Alert", description: "Always on the lookout for danger." };
  const rows = featList.featRowModels([bundle], [catalog], { takenFeats: [{ name: "Alert" }] });

  const box = document.createElement("div");
  featList.renderFeatListInto(box, rows, { takenFeats: [{ name: "Alert" }], remaining: 0, doc: document });

  assert(box.querySelector(".feat-list__intro") !== null || box.textContent.includes("No feat picks left"),
    "the list shows a pickable counter");
  const item = box.querySelector(".feat-list__row");
  assert(!!item, "a feat renders a row");
  assert(item.dataset.featId === "Alert", "the row is keyed by feat name");
  assert(item.className.includes("is-taken"), "a held feat reads as taken");

  const effect = item.querySelector(".feat-list__effect");
  assert(!!effect && effect.textContent.includes("+5 bonus to initiative"),
    "the row shows the mechanical effect in words");
  assert(!effect.textContent.includes("Sheet notes"), "the sheet's own notes block is not shown as rules text");
  const modifies = item.querySelector(".feat-list__modifies");
  assert(!!modifies && modifies.textContent === "= Initiative +5",
    "the row says what the feat modifies, derived from its own statModifiers");

  // A feat whose whole effect is a feature note has no statModifiers, so
  // it gets no "=" line — but it still has readable text underneath.
  const noteOnly = featList.featRowModel({
    name: "Resilient",
    statModifiers: [],
    featureGrants: [{ name: "Resilient", description: "Choose one ability score. You gain +1 to it." }],
  }, null);
  assert(noteOnly.modifies === "", "nothing to say means no modifies line");
  assert(noteOnly.summary.length > 0, "but it still gets a summary line");
  assert(noteOnly.effect.includes("+1 to it"), "and its real rules text");
}

// --- Block hover description ---------------------------------------------
//
// Blocks gained the same author-set hover description fields already
// had. Worth pinning that the toolbar button appears and reflects
// whether a description is set, since a block that silently lost the
// control would leave its description uneditable.
{
  const blocks = await import("../js/render/sheet/sheetBlocks.js");
  const build = (block) => {
    const commits = [];
    // The toolbar builder BUILDS AND RETURNS its bar; it doesn't append
    // into the element passed as the wrapper.
    const bar = blocks.buildBlockToolbarInto(block, document.createElement("div"), {
      styleBtnFn: () => document.createElement("button"),
      borderBtnFn: () => document.createElement("button"),
      viewOf: (b) => b,
      sourceOf: (b) => b,
      typeMenuFn: () => {},
      commitFn: (fn) => { commits.push(fn); fn(); },
      tooltipEditorFn: () => { bar.dataset.opened = "1"; },
      defaultSize: () => ({}),
      createFieldFn: () => ({}),
      hoverFn: () => {},
    });
    return { bar, commits };
  };

  // The stub DOM's querySelectorAll only understands class selectors, so
  // find buttons by walking children rather than by tag selector.
  const buttonsIn = (node) => {
    const out = [];
    const walk = (n) => {
      for (const c of n.children || []) {
        if (c.tag) out.push(c);
        walk(c);
      }
    };
    walk(node);
    return out;
  };

  const plain = build({ id: "b1", kind: "block", blockType: "stat", name: "Combat" });
  const tipBtn = buttonsIn(plain.bar).find((b) => b.textContent === "?");
  assert(!!tipBtn, "a block's toolbar has a description button");
  assert(tipBtn.title.includes("Set a hover description"), "and it offers to set one");
  assert(tipBtn.className !== "active", "unset reads as inactive");

  const described = build({ id: "b2", kind: "block", blockType: "stat", name: "Combat", tooltip: "Rolls and attacks." });
  const setBtn = buttonsIn(described.bar).find((b) => b.textContent === "?");
  assert(setBtn.className === "active", "a set description reads as active");
  assert(setBtn.title.includes("Rolls and attacks."), "and its title shows the text");
  setBtn.click();
  assert(described.bar.dataset.opened === "1", "clicking it opens the editor");
}

// --- Linked sheet tab -----------------------------------------------------
//
// Read-only by design (see linkedSheet.js): the rendered values must be
// text, not inputs, or the pane would be a second editor with none of the
// per-character undo guarantees. And every unresolved state has to say
// something rather than showing a blank pane.
{
  const linked = await import("../js/render/sheet/linkedSheet.js");
  const box = document.createElement("div");
  const owned = [{ id: "m1", name: "Shadow" }, { id: "m2", name: "Rope" }];

  const render = (over) => {
    const host = document.createElement("div");
    linked.renderLinkedSheetInto(host, { ownedCharacters: owned, ...over });
    return host;
  };

  // Unresolved states explain themselves, and offer the picker.
  for (const status of ["unset", "self", "not-owned", "missing"]) {
    const host = render({ status, config: { characterId: status === "unset" ? null : "x", displayFields: ["name"] }, linkedCharacter: null, onPick: () => {} });
    assert(host.textContent.length > 10, `a ${status} link explains itself`);
    assert(host.querySelector(".linked-sheet__picker") !== null, `a ${status} link still offers the picker`);
  }

  // A good link renders values as text, not as controls.
  const good = render({
    status: "ok",
    config: { characterId: "m1", displayFields: ["name", "size", "armorClass"] },
    linkedCharacter: { id: "m1", name: "Shadow", rules: { speed: "40 ft." } },
    onPick: () => {},
  });
  assert(good.textContent.includes("Shadow"), "a resolved link shows the linked character's name");
  const inputs = [];
  (function walk(n) { for (const c of n.children || []) { if (c.tag === "input" || c.tag === "textarea") inputs.push(c); walk(c); } })(good);
  assert(inputs.length === 0, "a linked sheet renders no editable controls");
  // Armor Class has no value here, so it should be absent rather than blank.
  assert(!good.textContent.includes("Armor Class"), "fields with no value are omitted, not shown blank");
}

// --- Leveling sub-tabs ----------------------------------------------------
//
// Both panels are built up front with one hidden. Worth pinning that the
// switcher actually swaps them, that aria follows the visible panel (a
// tab that says "selected" while showing the other one is a lie to a
// screen reader), and that a one-panel tab doesn't render a switcher at
// all - a single tab is just a label.
{
  const leveling = await import("../js/render/sheet/sheetLeveling.js");

  // The glance panel reads the model and says something when it's empty.
  const empty = leveling.renderLevelingGlanceInto([], { currentLevel: 1 });
  assert(empty.textContent.length > 10, "an empty glance explains itself");
  const steps = leveling.renderLevelingGlanceInto([
    { level: 3, grants: [{ id: "g1", type: "ability", effect: { name: "Keen Eye" }, source: "Elf" }] },
  ], { currentLevel: 3 });
  assert(steps.textContent.includes("Level 3"), "a step shows its level");
  assert(steps.textContent.includes("Keen Eye"), "and its grants");

  const buildTabs = (withGlance) => {
    const glance = document.createElement("div");
    glance.textContent = "GLANCE";
    const host = document.createElement("div");
    leveling.renderLevelingTabInto(host, {
      guideEl: null,
      glanceEl: withGlance ? glance : null,
      // The tab builds its own walkthrough panel from this note plus the
      // per-level rows, so the note is what identifies that panel.
      emptyGuideNote: "NO GUIDE HERE",
      resourcesEl: null,
      currentLevel: 3,
      expandedSet: new Set(),
      gridFn: () => {},
      rowFn: () => document.createElement("div"),
      scrollFn: () => {},
    });
    return { host, glance };
  };

  const withGlance = buildTabs(true);
  const tabButtons = (n) => {
    const out = [];
    (function walk(x) { for (const c of x.children || []) { if (c.tag === "button") out.push(c); walk(c); } })(n);
    return out;
  };
  const tabBar = withGlance.host.querySelector(".leveling-subtabs__bar");
  assert(!!tabBar, "two sub-tabs are offered");
  const [glanceBtn, walkBtn] = tabButtons(tabBar);
  assert(glanceBtn.textContent === "At a Glance" && walkBtn.textContent === "Walkthrough", "and labelled as such");
  assert(walkBtn.getAttribute("aria-selected") === "true", "the walkthrough is selected to start");
  assert(walkBtn.className.includes("is-active"), "and its class agrees with its aria");
  assert(glanceBtn.getAttribute("aria-selected") === "false", "the other is not");

  // Both panels exist; one is hidden. Clicking swaps which.
  // The glance element is passed straight through as a panel, but the
  // walkthrough is wrapped in a div the tab builds (it holds the guide,
  // the feature uses and 20 level rows), so read the panels back off the
  // DOM rather than off the elements that went in.
  const panels = withGlance.host.querySelectorAll(".leveling-subtabs__panel");
  assert(panels.length === 2, "both panels are present in the document");
  const [glancePanel, walkPanel] = panels;
  assert(glancePanel.textContent.includes("GLANCE"), "one panel is the glance");
  assert(walkPanel.textContent.includes("NO GUIDE HERE"), "the other is the walkthrough");
  assert(glancePanel.hidden === true, "the glance panel starts hidden");
  assert(walkPanel.hidden === false, "the walkthrough panel starts shown");
  (glanceBtn.listeners.click || []).forEach((f) => f({ target: glanceBtn }));
  assert(glancePanel.hidden === false, "clicking swaps the glance in");
  assert(walkPanel.hidden === true, "and hides the walkthrough");
  assert(glanceBtn.getAttribute("aria-selected") === "true", "aria follows the visible panel");
  assert(walkBtn.getAttribute("aria-selected") === "false", "for both tabs");

  // Without a glance view there's nothing to switch to, so no switcher —
  // a single tab would just be a label taking up a row.
  const single = buildTabs(false);
  assert(single.host.querySelector(".leveling-subtabs__bar") === null,
    "one panel means no tab switcher");
  assert(single.host.textContent.includes("NO GUIDE HERE"),
    "and the walkthrough is still shown");
}

if (failures) {
  console.error(`smoke-dom: ${failures} failure(s)`);
  process.exit(1);
} else {
  console.log("smoke-dom: all checks passed");
}

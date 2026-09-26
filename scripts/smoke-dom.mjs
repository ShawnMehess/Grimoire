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

if (failures) {
  console.error(`smoke-dom: ${failures} failure(s)`);
  process.exit(1);
} else {
  console.log("smoke-dom: all checks passed");
}

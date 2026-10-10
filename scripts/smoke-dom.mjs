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
// `focused` stands in for document.activeElement: the dialog module moves
// focus into the dialog and restores it on close, and a stub with no
// concept of focus makes that crash rather than merely go unasserted.
//
// WHAT THIS STUB CAN AND CANNOT ANSWER
//
// The selector engine here understands ONE shape: a single class name, and
// now a comma-separated list of them. Anything else - an attribute
// selector, a descendant combinator, `:scope >`, a compound like `.a.b` -
// used to return an empty array, and an empty array is indistinguishable
// from "no such element on the page". That is the worst failure mode a
// test harness can have: a test asserting on a node the stub cannot see
// passes on zero elements and reports green.
//
// Measured against the app: 24 literal querySelector/querySelectorAll call
// sites, of which this stub could answer 13. The 11 it could not included
//   .grid-node--field[data-node-id]      selection and drag addressing
//   .field-value--computed[data-field-id] the live-formula patch path
//   button, input, textarea, select, [tabindex]   the dialog focus trap
//   .wizard__nav .wizard__next           wizard nav gating
//
// So an unsupported selector now THROWS. That converts every silently-vacuous
// assertion into a loud failure, which is the point: a harness that refuses
// to answer is safe, and one that answers "nothing" is not. Anything the
// stub cannot model belongs in scripts/e2e-smoke.mjs, which drives real
// Chrome and can assert all of these.
//
const UNSUPPORTED_SELECTOR = (sel) =>
  new Error(
    `smoke-dom's selector stub cannot answer "${sel}". ` +
    `It supports a tag name, a class, a compound of classes, and comma-separated ` +
    `lists of those. Attribute selectors, descendant/child combinators, :scope and ` +
    `pseudo-classes match nothing here, and asserting on nothing passes - so this ` +
    `throws instead. Assert it in scripts/e2e-smoke.mjs (real Chrome), or assert the ` +
    `pure helper that produces the node rather than the node itself.`
  );

// Comma lists, compounds, bare tag names and #id are supported because they are
// cheap and were accounting for most of the misses - `buttons.querySelector
// ("button")` in the dialog focus path is a bare tag and `#app-dialog-input`
// is the prompt's initial focus, and both were silently finding nothing, so
// neither the dialog's initial focus nor its focus target had ever actually
// run. Attribute selectors, combinators and pseudo-classes are not, and
// deliberately so.
/** Parse a supported selector into matchers: { tag } / { id } / { classes }. */
function parseSelector(sel) {
  const raw = String(sel).trim();
  // Anything with selector syntax the stub does not model, in any part.
  if (/[\[\]()>+~:]/.test(raw)) throw UNSUPPORTED_SELECTOR(sel);
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw UNSUPPORTED_SELECTOR(sel);
  return parts.map((part) => {
    if (part.startsWith("#")) {
      const id = part.slice(1);
      if (!id) throw UNSUPPORTED_SELECTOR(sel);
      return { id };
    }
    if (part.startsWith(".")) {
      const classes = part.split(".").slice(1).filter(Boolean);
      if (!classes.length) throw UNSUPPORTED_SELECTOR(sel);
      return { classes };
    }
    if (!/^[a-zA-Z][\w-]*$/.test(part)) throw UNSUPPORTED_SELECTOR(sel);
    return { tag: part.toLowerCase() };
  });
}

/** Does a stub node satisfy one of the parsed alternatives? */
function selectorMatches(node, parsed) {
  return parsed.some(({ tag, id, classes }) => {
    if (tag && String(node.tag || "").toLowerCase() !== tag) return false;
    if (id != null && String(node.attrs?.id ?? node.id ?? "") !== id) return false;
    if (classes && !classes.every((k) => node._classes?.has(k))) return false;
    return Boolean(tag || id || classes);
  });
}

let focused = null;
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
    removeAttribute(k) {
      delete this.attrs[k];
      if (k.startsWith("data-")) {
        const prop = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        delete this.dataset[prop];
      }
    },
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
      const groups = parseSelector(sel);
      const out = [];
      const walk = (n) => {
        for (const c of n.children || []) {
          if (!c.tag) continue;
          if (selectorMatches(c, groups)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    },
    closest(sel) {
      const groups = parseSelector(sel);
      let n = this;
      while (n) {
        if (selectorMatches(n, groups)) return n;
        n = n.parent;
      }
      return null;
    },
    click() { (this.listeners.click || []).forEach((f) => f({ target: this, preventDefault() {}, stopPropagation() {} })); },
    focus() { focused = this; },
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

// The document itself. `body` is the node dialogs mount onto, and the
// listener registry + querySelector let a test exercise a document-level
// Escape handler and find what a dialog rendered - both things a
// hand-rolled dialog module does that the old native ones never had to.
const docNode = makeNode("body");
docNode.listeners = {};
globalThis.document = {
  createElement: (tag) => makeNode(tag),
  createElementNS: (_ns, tag) => makeNode(tag),
  createTextNode: (text) => makeText(text),
  body: docNode,
  addEventListener(t, f) { (docNode.listeners[t] ||= []).push(f); },
  removeEventListener(t, f) {
    const list = docNode.listeners[t] || [];
    const i = list.indexOf(f);
    if (i !== -1) list.splice(i, 1);
  },
  querySelector(sel) { return docNode.querySelector(sel); },
  querySelectorAll(sel) { return docNode.querySelectorAll(sel); },
  get activeElement() { return focused; },
};
// Listeners on the document are readable by tests through `document` — the
// stub puts them on the body node, so mirror the reference.
Object.defineProperty(globalThis.document, "listeners", {
  get() { return docNode.listeners; },
});
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
  wizard.renderPickerTableInto(box2, ["A"], { mode: "multi", selectedSet: new Set(), onToggle: () => {} });
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

  // The label stays in plain words - "Content books" named the section
  // without saying what it was. Read off the rendered nodes rather than a
  // substring of the serialised box, so the assertion is about the label a
  // player sees.
  const texts = [];
  const walkText = (n) => {
    for (const c of n.children || []) { texts.push(c.textContent); walkText(c); }
  };
  walkText(box);
  assert(texts.includes("Content"), "book section is labelled in plain words");
  assert(!texts.includes("Content books"), "book section drops the jargon label");

  // The explanatory PARAGRAPHS are gone, deliberately. Each one restated what
  // the rows beneath already said: the rows are named after the systems, the
  // rows are checkboxes labelled with the book names, and each HP option
  // carries its own description. Asserting their absence is the point - a
  // future edit that helpfully re-adds a lead-in paragraph fails here rather
  // than quietly reintroducing the page furniture the request asked to drop.
  assert(!/only what comes from the books ticked here/.test(html),
    "book section has no lead-in paragraph restating the checkboxes");
  assert(!html.includes("Which game system are you playing?"),
    "system list has no lead-in question over its own named rows");
}

// --- Rules step: a single registered system needs no "pick one" heading -------
{
  const box = document.createElement("div");
  steps.renderRulesetStepInto(box, {}, {
    listRulesetsFn: () => [{ id: "a", name: "A", description: "" }],
    listContentPacksFn: () => [{ id: "p1", name: "P1", description: "" }],
    defaultContentPackIdsFn: () => ["p1"],
    primaryId: "a",
    includedIds: ["p1"],
    updateIdsFn: () => {},
    setPrimaryFn: () => {},
  });
  const html = JSON.stringify(box, (k, v) => (k === "parent" ? undefined : v));
  assert(!html.includes("Which game system are you playing?"), "one system, no pick-one heading");
  assert(html.includes("Only book"), "a lone book still says it is always on");
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

// --- Story step: two free-text boxes, no gating, no lost typing --------------
{
  const box = document.createElement("div");
  const written = [];
  const labelled = [];
  steps.renderStoryStepInto(box, {
    fieldFn: (c, label, control) => { labelled.push(label); c.append(control); },
    values: { Appearance: "Tall, grey beard" },
    saveFn: (label, value) => written.push([label, value]),
    missingLabels: [],
  });
  assert(labelled.join("|") === "Appearance|Backstory", "story step offers both boxes, in order");
  const areas = [];
  const walk = (n) => {
    if (n.tag === "textarea") areas.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(box);
  assert(areas.length === 2, "both story boxes are textareas");
  // Existing text comes back off the sheet rather than starting blank.
  assert(areas[0].value === "Tall, grey beard", "appearance reads back what the sheet holds");
  assert((areas[1].placeholder || "").length > 0, "an empty box says what to write");
  // Writing reports the label, so the caller knows which field to save.
  areas[0].listeners.input[0]({ target: { value: "Tall, grey beard, red cloak" } });
  assert(written.length === 1 && written[0][0] === "Appearance", "typing writes to the named field");
  assert(box.textContent.includes("Nothing here is checked against anything"), "free-text boxes say they are not validated");
}
{
  // A sheet with nowhere to put the text must say so, not render a box that
  // silently swallows whatever you type.
  const box = document.createElement("div");
  steps.renderStoryStepInto(box, {
    fieldFn: (c, label, control) => c.append(control),
    values: {},
    saveFn: () => {},
    missingLabels: ["Backstory"],
  });
  assert(/no Backstory box/.test(box.textContent), "an unwritable field is named");
  const areas = [];
  const walk = (n) => { if (n.tag === "textarea") areas.push(n); for (const c of n.children || []) walk(c); };
  walk(box);
  assert(areas.length === 1, "the unwritable field renders no box at all");
}

// --- App dialogs (js/ui/dialogs.js) ----------------------------------------
//
// Replacements for window.alert / confirm / prompt. The behaviour worth
// pinning here is the part a native dialog gives you for free and a
// hand-rolled one usually drops: every dismissal route resolves the same
// way, and the validator refuses IN PLACE rather than closing and starting
// over.
{
  const { confirmDialog, alertDialog, promptDialog, chooseDialog } = await import("../js/ui/dialogs.js");
  const openDialog = () => document.querySelector(".app-dialog");
  const dialogButtons = () => {
    const found = [];
    const walk = (n) => {
      for (const c of n.children || []) { if (c.tag === "button") found.push(c); walk(c); }
    };
    walk(openDialog() || document.createElement("div"));
    return found;
  };
  const dismissAll = async () => { while (openDialog()) { openDialog().listeners.click[0](); await Promise.resolve(); } };

  // confirm: true / false / backdrop, and exactly one dialog per call.
  let settled = confirmDialog({ title: "Delete?", message: "Gone for good.", confirmLabel: "Delete" });
  assert(!!openDialog(), "confirm dialog mounts");
  assert(openDialog().classList.contains("app-dialog"), "confirm carries the dialog class");
  dialogButtons()[1].click();
  assert((await settled) === true, "the confirm button resolves true");

  settled = confirmDialog({ title: "Delete?" });
  dialogButtons()[0].click();
  assert((await settled) === false, "the cancel button resolves false");

  settled = confirmDialog({ title: "Delete?" });
  openDialog().listeners.click[0](); // the backdrop
  assert((await settled) === false, "a backdrop click resolves false, not true");

  // Escape is registered on the document with capture, so it is reachable
  // from anywhere in the page rather than only from inside the dialog.
  settled = alertDialog({ title: "Heads up" });
  const docKeydowns = document.listeners?.keydown || [];
  assert(docKeydowns.length > 0, "a dialog registers a document keydown listener");
  docKeydowns[docKeydowns.length - 1]({ key: "Escape", preventDefault() {} });
  // null, not undefined: "cancelled" is one answer for every dialog, and a
  // caller comparing against undefined would miss it.
  assert((await settled) === null, "Escape resolves the alert");
  assert(!openDialog(), "and closes it");
  await dismissAll();
  assert(!openDialog(), "dismissing removes the dialog from the document");

  // prompt: validator refuses in place, keeps the text, trims on accept.
  settled = promptDialog({
    title: "Name this shape",
    label: "Name",
    value: "  Desk monitor  ",
    validate: (v) => (v.trim() ? null : "Give it a name."),
  });
  await Promise.resolve();
  let input = document.querySelector(".app-dialog__input");
  assert(!!input, "prompt dialog has a field");
  assert(input.value === "  Desk monitor  ", "prompt seeds the field");
  input.value = "";
  let btns = dialogButtons();
  btns[btns.length - 1].click(); // the OK button
  assert(!!openDialog(), "a refused value leaves the dialog open");
  let error = document.querySelector(".app-dialog__error");
  assert(!!error && error.hidden === false, "and shows the complaint");
  assert(/Give it a name/.test(error.textContent || ""), "in the validator's own words");
  input.value = "  Storybook  ";
  btns = dialogButtons();
  btns[btns.length - 1].click();
  assert((await settled) === "Storybook", "prompt resolves the trimmed value");

  // A validator that throws must not strand the dialog open with nothing
  // able to close it but Escape.
  settled = promptDialog({
    title: "Boom",
    validate: () => { throw new Error("kaboom"); },
  });
  await Promise.resolve();
  input = document.querySelector(".app-dialog__input");
  input.value = "x";
  btns = dialogButtons();
  btns[btns.length - 1].click();
  assert(!!openDialog(), "a throwing validator leaves the dialog open");
  error = document.querySelector(".app-dialog__error");
  assert(!!error && error.hidden === false, "and says something went wrong rather than throwing");
  btns = dialogButtons();
  btns[0].click();
  assert((await settled) === null, "cancelling a prompt resolves null");

  // choose: a list of buttons, not an index to type.
  settled = chooseDialog({
    title: "Remove which shape?",
    options: [
      { value: "a", label: "Desk monitor", description: "21:9 - 8 columns" },
      { value: "b", label: "Storybook", description: "3:4 - 12 columns" },
    ],
  });
  let options = [];
  {
    // Exact class, not a substring: "app-dialog__option-label" and
    // "-description" both CONTAIN "app-dialog__option", so a substring match
    // collects each option three times.
    const walk = (n) => { for (const c of n.children || []) { if (c.className === "app-dialog__option") options.push(c); walk(c); } };
    walk(openDialog());
  }
  assert(options.length === 2, "choose dialog lists every option");
  assert(/Desk monitor/.test(options[0].textContent), "and names them");
  assert(/8 columns/.test(options[0].textContent), "with the description beside it");
  options[1].click();
  assert((await settled) === "b", "choose resolves the option's value, not its index");

  // An empty list still has a way out.
  settled = chooseDialog({ title: "Remove which shape?", options: [] });
  await Promise.resolve();
  assert(/nothing to choose from/i.test(openDialog().textContent || ""), "an empty choose says so");
  btns = dialogButtons();
  btns[0].click();
  assert((await settled) === null, "and can still be cancelled");

  // Nothing left behind.
  await dismissAll();
  assert(!openDialog(), "no dialogs left mounted");
}

// --- HP / ASI / features / review steps --------------------------------------
{
  const box = document.createElement("div");
  const pending = {};
  steps.renderGuideHpStepInto(box, pending, { conScore: 14, dieSize: 10, method: "average" });
  assert(pending.hp === "8", "HP prefilled with average + CON");
  // The note has to name all three ingredients in words - the die, the
  // average and the CON modifier - because "d10 ÷ 2, rounded up" is a
  // formula, and the whole point of the note is that a player who cannot
  // read the formula can still tell what the number is made of.
  assert(/d10/.test(box.textContent) && /rounded up/.test(box.textContent)
    && /Constitution modifier is \+2/.test(box.textContent),
  `HP math note renders in words (got ${JSON.stringify(box.textContent.trim())})`);
  // And the roll variant has to say the range rather than leave a bare
  // "1-8" with no indication of where it came from.
  const rollBox = document.createElement("div");
  const rollPending = {};
  steps.renderGuideHpStepInto(rollBox, rollPending, { conScore: 14, dieSize: 10, method: "roll" });
  assert(/d10/.test(rollBox.textContent) && /Constitution modifier is \+2/.test(rollBox.textContent)
    && /from 3 to 12/.test(rollBox.textContent),
  `the roll note says the die, the modifier and the range (got ${JSON.stringify(rollBox.textContent.trim())})`);

  // A racial CON bonus and a racial per-level HP bonus (Dwarven Toughness).
  // Passing only `conScore` measured the BASE score, so a Hill Dwarf - whose
  // sheet reads CON 16 and "Mod +3" - was told "+2" by a step on its own
  // sheet, and Dwarven Toughness only ever existed as a sentence in a trait
  // list. Both arrive as numbers now, and the note has to account for both or
  // the gain looks made up.
  const racialBox = document.createElement("div");
  const racialPending = {};
  steps.renderGuideHpStepInto(racialBox, racialPending, { conScore: 14, conMod: 3, hpBonus: 1, dieSize: 10, method: "average" });
  assert(racialPending.hp === "10",
    `HP counts the race's CON and its per-level bonus (got ${JSON.stringify(racialPending.hp)})`);
  assert(/Constitution modifier is \+3/.test(racialBox.textContent)
    && /your race adds 1/.test(racialBox.textContent)
    && /this level adds 10 hit points/.test(racialBox.textContent),
  `and the note names both (got ${JSON.stringify(racialBox.textContent.trim())})`);
  // An explicit conMod of 0 is a real answer (CON 10), not a missing one -
  // `Number.isFinite` is what keeps the fallback from stealing it.
  const zeroBox = document.createElement("div");
  const zeroPending = {};
  steps.renderGuideHpStepInto(zeroBox, zeroPending, { conScore: 16, conMod: 0, dieSize: 6, method: "average" });
  assert(zeroPending.hp === "4",
    `an explicit 0 modifier wins over conScore (got ${JSON.stringify(zeroPending.hp)})`);
}
// The HP method preference rows: no expand/collapse affordance (they have
// nothing to expand), and an icon in the portrait slot instead of a letter
// that couldn't tell "Roll In-Browser" from "Roll at the Table".
{
  const box = document.createElement("div");
  let captured = null;
  steps.renderPreferencesStepInto(box, {}, {
    hpOptions: steps.HP_METHOD_OPTIONS,
    currentMethod: "average",
    updateFn: () => {},
    selectableRowsFn: (c, names, opts) => { captured = { names, opts }; },
  });
  assert(captured.names.length === 3, "three HP methods render");
  assert(captured.opts.collapsible === false && captured.opts.showControls === false,
    "HP method rows carry no expand/collapse controls");
  const icons = captured.names.map((n) => captured.opts.getIcon(n));
  assert(icons.every(Boolean) && new Set(icons).size === 3, "each HP method gets its own icon");

  // And the real renderer puts that icon where the portrait letter goes.
  const real = document.createElement("div");
  const list = wizard.renderPickerTableInto(real, captured.names, {
    ...captured.opts,
    getInfo: (n) => ({ description: "x" }),
    onSelect: () => {},
  });
  const portraits = [...(list.children || [])].map((row) => row.children?.[0]);
  assert(portraits.every((p) => (p?.className || "").includes("choice-row__portrait--icon")),
    "HP method rows render an icon portrait, not a letter");

  // No page-level paragraph here any more - it said the same thing twice
  // (once above the label, once in each option's own description). The
  // options still have to carry the "when does this bite" half on their own,
  // since nothing above them says it now.
  assert(!box.textContent.includes("until you level up") && !box.textContent.includes("every time you level up"),
    "HP section has no lead-in paragraph above its label");
  assert(steps.HP_METHOD_OPTIONS.every((o) => /level up/i.test(o.description || "")),
    "each HP option says for itself that it matters at level up");
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

// --- Toolbar shell: Simple View insertion point -------------------------------
{
  const shell = await import("../js/render/sheet/sheetToolbar.js");
  const { toolbar, leftGroup, modeBtn } = shell.buildToolbarShell();
  // Regression guard: customSheet inserts the Simple View button before
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

  // "Level N gives you:" - sourced text only, and nothing at all when
  // there is nothing sourced to say.
  const gainsHost = document.createElement("div");
  const gains = leveling.renderLevelGainsInto(gainsHost, [
    { name: "Extra Attack", description: "You can attack three times instead of once." },
    { name: "Mystic Knuckles", description: "" },
  ], { level: 5 });
  assert(gains, "the gains summary renders when there is something to say");
  assert(gainsHost.textContent.includes("Level 5 gives you:"), "it names the level and asks what it gives");
  assert(gainsHost.textContent.includes("Extra Attack"), "a sourced feature is listed");
  assert(gainsHost.textContent.includes("attack three times"), "with its own description quoted, not paraphrased");
  assert(gainsHost.textContent.includes("Mystic Knuckles"), "a feature with no description is still listed");
  // Name only, with no dash and nothing standing in for the missing text.
  // Asserted on a summary of its own so the concatenation is exact.
  const bareHost = document.createElement("div");
  const bareOnly = leveling.renderLevelGainsInto(bareHost,
    [{ name: "Mystic Knuckles", description: "" }], { level: 3 });
  assert(bareOnly.textContent === "Level 3 gives you:Mystic Knuckles",
    `a feature with no description is listed by name alone (got ${JSON.stringify(bareOnly.textContent)})`);
  // Nothing sourced: no heading at all, rather than an empty heading that
  // reads as a bug in the app.
  const emptyHost = document.createElement("div");
  const nothing = leveling.renderLevelGainsInto(emptyHost, [], { level: 8 });
  assert(nothing === null && emptyHost.textContent === "",
    "a level with no sourced grants shows no summary at all");
  assert(leveling.renderLevelGainsInto(document.createElement("div"),
    [{ name: "", description: "" }], { level: 3 }) === null,
  "a blank grant is not a line of text");

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

// --- Abilities step: the race/class bonus note belongs UNDER the scores ---
// It led the step as a paragraph above the very scores it describes, so the
// player read about modifiers and racial bonuses before either was on screen.
// It is a footnote now, and each ability's own bonus lines sit directly
// beneath that ability's description.
{
  const steps = await import("../js/render/sheet/sheetWizardSteps.js");
  const box = document.createElement("div");
  const scores = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
  steps.renderAbilitiesStepInto(box, {
    abilityIds: ["str", "dex", "con", "int", "wis", "cha"],
    descriptions: { str: "Physical power.", dex: "Agility.", con: "Sturdyness.", int: "Reasoning.", wis: "Attention.", cha: "Presence." },
    scores,
    method: "manual",
    min: 1, max: 20,
    costFn: () => 1,
    affordableFn: () => 20,
    rollFn: () => 12,
    modifierFn: (s) => Math.floor((Number(s) - 10) / 2),
    formatFn: (m) => (m >= 0 ? `+${m}` : `${m}`),
    saveFn: () => {},
    onMethodChange: () => {},
    bonuses: { str: { bonus: 2, sources: [{ label: "Elf", value: 2 }] } },
    footnote: "Bonuses from your race and other picks apply on top of these scores.",
  });
  const kids = (box.children || []).map((k) => String(k.className || ""));
  const scoreIdx = kids.findIndex((c) => c.includes("wizard__ability-scores"));
  const footIdx = kids.findIndex((c) => c.includes("wizard__ability-footnote"));
  assert(scoreIdx >= 0, "abilities step renders the scores");
  assert(footIdx > scoreIdx, "the race/class bonus note comes after the scores, not before");
  assert(box.textContent.includes("Bonuses from your race"), "and the note is still there at all");
  // Per-row bonus text still works, still names its source, and states no total.
  assert(box.textContent.includes("+2 from Elf"), "the per-row bonus still names its source");
  assert(!box.textContent.includes("total"), "and states no total beside it");
  assert(box.querySelector(".wizard__ability-bonus"), "the per-row bonus node renders");
  assert(box.querySelector(".wizard__ability-bonus-line"), "the per-source line renders");
}

// --- Abilities step: typing a score, and each method keeping its own ---
//
// Two things, and the first one had never been tested. The score box's
// change handler closed over a bare `input`, which is not a name in scope,
// so every edit THREW "input is not defined" and the typed number never
// reached `scores`: a player could not type an ability score at all, and
// nothing about it looked broken - the box just ignored you. Found by
// watching for page errors while checking item 6.
//
// The second is item 6 itself: each method remembers the six numbers it had,
// so a player who tried Point Buy, typed their own spread, and came back
// finds the spread they spent their 27 points on.
{
  const steps = await import("../js/render/sheet/sheetWizardSteps.js");
  const IDS = ["str", "dex", "con", "int", "wis", "cha"];
  const scores = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
  const memory = {};
  const box = document.createElement("div");
  const fire = (node, type) => {
    (node.listeners?.[type] || []).forEach((f) => f({
      target: node, preventDefault() {}, stopPropagation() {},
      key: type === "keydown" ? "x" : undefined,
    }));
  };
  steps.renderAbilitiesStepInto(box, {
    abilityIds: IDS,
    descriptions: Object.fromEntries(IDS.map((id) => [id, `${id}.`])),
    scores,
    method: "pointbuy",
    budget: 27, min: 8, max: 15,
    costFn: (s) => Math.max(0, s - 8),
    affordableFn: () => 15,
    rollFn: () => 11,
    modifierFn: (s) => Math.floor((Number(s) - 10) / 2),
    formatFn: (m) => `${m}`,
    saveFn: () => {},
    rememberedScores: memory,
    onMethodChange: () => {},
  });
  // The stub cannot answer an attribute selector either, so the score boxes
  // are collected by walking to them.
  const walk = (node, out = []) => {
    for (const kid of node.children || []) {
      if (String(kid.tag || "").toLowerCase() === "input") out.push(kid);
      walk(kid, out);
    }
    return out;
  };
  // Score boxes only. The step now starts with three METHOD RADIOS above the
  // scores, and a blind `walk` picked those up as boxes[0] - so "typing a
  // score" was typing into the Point Buy radio and setting its value to 14.
  // Filtering by type says what is being tested instead of relying on the
  // scores being the first inputs on the page.
  const boxes = () => walk(box).filter((n) => n.type === "number");
  // The DOM stub here cannot answer a descendant selector, so the method
  // control is reached through its container - which is also the shape a
  // reader meets it in.
  //
  // It is a table of three radios, not a <select> (item 19). Driving it means
  // finding the radio by its value and firing change on it, because the
  // radios own the change handler; a <select> driver would keep passing
  // against a control that no longer exists.
  const methodBox = box.querySelector(".wizard__ability-method");
  // `el()` maps `type` onto the property, not the attribute bag, so this
  // reads `.type` where it reads getAttribute for `value` (also a
  // property) and for class (an attribute).
  const radios = () => walk(methodBox).filter((n) => n.type === "radio");
  const methodSelect = (id) => radios().find((r) => r.value === id);
  assert(methodBox, "the abilities step renders a method table");
  assert(radios().length === 3, `with one radio per method (${radios().length})`);
  assert(!!methodSelect("pointbuy") && !!methodSelect("roll") && !!methodSelect("manual"),
    "and all three methods are offered at once, not behind a dropdown");
  // Each row carries its own description, which is the reason this is a
  // table: a <select> had no room to say what any of them does.
  // Classes live in the attribute bag on this stub, not on a `.class`
  // property, so they are read with getAttribute.
  const descCount = (methodBox.children || []).filter((row) =>
    (row.children || []).some((k) => String(k.getAttribute?.("class") || "").includes("wizard__ability-method-desc"))).length;
  assert(descCount === 3, `each method has a description of its own (${descCount})`);
  // Nothing on this step may be collapsed: no details element, and no
  // Expand All / Collapse All bar anywhere in it.
  assert(!/details/i.test(String(methodBox.tag || "")), "the method table is not a disclosure");
  assert(!/Expand All|Collapse All/i.test(box.textContent || ""),
    "and this step has no Expand All / Collapse All bar");

  // Switching methods the way a player does: click the radio.
  const chooseMethod = (id) => {
    const radio = methodSelect(id);
    assert(!!radio, `the ${id} method has a radio`);
    radios().forEach((r) => { if (r !== radio) r.checked = false; });
    radio.checked = true;
    fire(radio, "change");
  };

  // Typing a score actually reaches `scores`. 14 rather than 16 because the
  // Point Buy box's own maximum is 15 and it clamps what it is given - which
  // is the point-buy budget working, not the handler failing.
  const strBox = () => boxes()[0];
  strBox().value = "14";
  fire(strBox(), "change");
  assert(scores.str === 14, `typing a score writes it (str=${scores.str})`);

  // Give Point Buy a distinctive spread, then move to Manual and give that a
  // different one, then come back.
  scores.str = 15; scores.dex = 14;
  chooseMethod("manual");
  scores.str = 12; scores.dex = 11;
  assert(scores.str === 12, `Manual Entry takes its own numbers (str=${scores.str})`);

  chooseMethod("pointbuy");
  assert(scores.str === 15 && scores.dex === 14,
    `coming back to Point Buy restores its own spread (str=${scores.str}, dex=${scores.dex})`);

  chooseMethod("manual");
  assert(scores.str === 12 && scores.dex === 11,
    `and coming back to Manual Entry restores THAT one (str=${scores.str}, dex=${scores.dex})`);

  // A method being used for the first time has nothing to restore, so it
  // really does replace the six scores - which is why the warning still says
  // so, in the new words.
  chooseMethod("roll");
  const atRoll = { str: scores.str, dex: scores.dex };
  assert(!memory.roll, "a method being used for the first time has nothing to restore");
  assert(!/resets the six scores/.test(box.textContent || ""),
    "and the warning no longer claims a method you have used is reset");
  chooseMethod("pointbuy");
  chooseMethod("roll");
  assert(!!memory.roll, "leaving a method remembers the six numbers it had");
  assert(scores.str === atRoll.str && scores.dex === atRoll.dex,
    `a second visit to Roll restores it (str=${scores.str} vs ${atRoll.str})`);
  assert(Object.keys(memory).length >= 3,
    `one set of numbers kept per method (${Object.keys(memory).join(", ")})`);
}

// --- A row's own disclosure moves like the row does -------------------------
//
// The picker rows animate because animateRowDetails owns `hidden`. A
// <details> does not - the browser owns `open` - so every "Full
// description" in the app snapped open while everything around it moved.
// animateDisclosureInto puts the same 4px rise and fade on it, in both
// directions, without taking `open` away from the browser.
//
// The stub has no `animate`, so what is asserted here is the WIRING and the
// reduced-motion path; the motion itself is covered by the motion rules in
// tests/wizard-gating.test.mjs.
{
  const { animateDisclosureInto } = await import("../js/render/sheet/sheetWizard.js");
  const { el } = await import("../js/render/sheet/sheetHelpers.js");
  const build = () => el("details", { class: "choice-row__more" },
    el("summary", { class: "choice-row__more-toggle", text: "Full description" }),
    el("div", { class: "choice-row__mechanics-effect" }, "the full text"));

  const details = build();
  assert(animateDisclosureInto(details) === true, "a disclosure with a summary and content is wired");
  assert(details.dataset.motionWired === "1", "and says so on the element");
  assert(animateDisclosureInto(details) === false, "wiring it twice would double every animation");

  assert(animateDisclosureInto(null) === false, "no element is left alone");
  assert(animateDisclosureInto({}) === false, "and so is something with no querySelector");
  assert(animateDisclosureInto(el("details")) === false, "a disclosure with no summary is left alone");
  const bare = el("details", {}, el("summary", {}, "Full description"));
  assert(animateDisclosureInto(bare) === false, "and one with nothing to reveal");

  // The opening is animated from the browser's own `toggle`, so `open` is
  // never written from here on the way IN - the disclosure stays a disclosure.
  assert((details.listeners.toggle || []).length === 1, "one toggle listener watches for the opening");
  const summary = details.querySelector("summary");
  assert(!!summary, "and the summary is there for a click to land on");
  // With no `animate` available - which is what reduced motion looks like from
  // here - the summary's click must not be prevented, so the browser closes it.
  let prevented = 0;
  const click = { preventDefault() { prevented += 1; } };
  (summary.listeners.click || []).forEach((f) => f(click));
  assert(prevented === 0, "with nothing to animate, the browser still closes it (nothing prevented)");
}

// --- Review step: the summary box leads, Finish Setup moved to the nav ---
// The name box was appended after the three picker tables, so the name you
// came to check was the last thing on the page. The whole box moves, not
// just the name line.
{
  const steps = await import("../js/render/sheet/sheetWizardSteps.js");
  const box = document.createElement("div");
  steps.reviewSummaryBoxInto(box, { species: "Elf", className: "Wizard", subclass: "Evoker", background: "Sage", level: 1 }, {
    characterName: "Alborax",
    rulesetName: "SRD",
    spellLimit: null,
    resources: [],
    abilityScores: { str: 8, dex: 14, con: 12, int: 15, wis: 13, cha: 10 },
    abilityMethod: "manual",
    hpMethod: null,
    choiceLines: [],
    spellsPicked: [],
    equipmentLine: null,
    featNames: ["Alert"],
  });
  // Stand in for the picker tables the step renders after the summary,
  // in the order customSheet.js renders them.
  for (const label of ["Race", "Class", "Background"]) {
    const d = document.createElement("div");
    d.setAttribute("class", "wizard__section-label");
    d.textContent = label;
    box.append(d);
  }
  const kids = (box.children || []).map((k) => String(k.className || ""));
  assert(kids[0].includes("wizard__review-rows"), "the summary box is the first thing on the review step");
  // Finish Setup is in the action bar now (sheetWizard's buildNav reads
  // `step.finish`), so there must be no button row stranded in the body -
  // and no "What You Get Automatically" after it either.
  assert(!kids.some((c) => c.includes("wizard__review-button-row")),
    "Finish Setup is no longer a button at the bottom of the body");
  assert(!kids.some((c) => c.includes("wizard__finish-btn")),
    "and nothing in the body offers to finish");
  const first = (box.children || [])[0];
  assert(first.textContent.includes("Alborax"), "the name is inside that first box");
  // The name must not have been split out of the box it belongs to.
  assert(first.querySelectorAll(".wizard__review-row").length >= 2,
    "the whole panel moved together, not just the name line");
  // Content sources are gone: the player ticked them on step one.
  assert(!/srd/i.test(first.textContent), "and no content-sources line in the summary");
}

// --- Review step: one row per ability, and every spell a link ----------
{
  const steps = await import("../js/render/sheet/sheetWizardSteps.js");
  const box = document.createElement("div");
  steps.reviewSummaryBoxInto(box, { species: "Half-Orc", className: "Wizard", subclass: "Evoker", background: "Sage", level: 1 }, {
    characterName: "Alborax",
    spellLimit: { style: "prepared", cantrips: 3, spells: 2 },
    resources: [],
    abilityScores: { str: 8, dex: 14, con: 12, int: 15, wis: 13, cha: 10 },
    abilityBonuses: { str: { bonus: 2, sources: [{ label: "Half-Orc", value: 2 }] } },
    abilityMethod: "manual",
    hpMethod: null,
    choiceLines: [],
    spellsPicked: ["Fire Bolt", "Mage Hand", "Magic Missile"],
    equipmentLine: null,
    featNames: [],
  });
  const rows = (box.children || [])[0].querySelectorAll(".wizard__review-row").map((r) => r.textContent.trim());
  const ability = rows.filter((r) => /Mod\)/.test(r));
  assert(ability.length === 6, `one row per ability score (${ability.length})`);
  assert(ability[0].includes("Strength 10 (0 Mod)"),
    `and the post-bonus total with its modifier (${ability[0]})`);
  assert(ability[1].includes("Dexterity 14 (+2 Mod)"),
    `and a positive one signed (${ability[1]})`);
  // Each spell its own row, and a link - href "#" plus the shared opener,
  // which is the app's own spell detail dialog. Never an external site.
  const items = (box.children || [])[0].querySelectorAll(".wizard__review-spell");
  assert(items.length === 3, `each chosen spell gets its own row (${items.length})`);
  assert(items.map((li) => li.textContent.trim()).join("|") === "Fire Bolt|Mage Hand|Magic Missile",
    "listed by name, one per line");
  // The stub cannot answer "a.spell-link" (tag+class is a compound it does
  // support, but it has no `a` element under an li selector) - so ask for the
  // class alone and check the tag separately.
  const anchors = items.map((li) => li.querySelector(".spell-link"));
  console.log("DEBUG anchors:", JSON.stringify(anchors.map((a) => a && ({ tag: a.tag, href: a.getAttribute("href"), cls: a.getAttribute("class") }))));
  // spellLinkNode sets a.href as a PROPERTY, so read the property: the stub
  // never saw an attribute and getAttribute would answer null either way.
  assert(anchors.every((a) => a && a.href === "#"),
    "and each row is a link with no external destination");
  assert(anchors.every((a) => String(a.getAttribute("class")).includes("spell-link")),
    "carrying the shared spell-link class the opener is wired to");
  assert(!rows.some((r) => /Spells Known/.test(r)),
    "and no run-together 'Spells Known' line any more");
}

// --- Review step shows only what was chosen ---
// customSheet.js narrows each review picker's option list to the selected
// name before handing it to the same row renderer, so the row keeps its
// real markup but the page stops listing every ancestry you did not pick.
// These pin the mechanism that narrowing depends on: a one-element name
// list produces one row, and it is still a full, expandable row.
{
  const opts = (names) => ({
    selectedName: names[names.length - 1],
    getInfo: (n) => ({ description: `${n} flavor` }),
    getMechanicsList: (n) => [{ title: "Traits", items: [`${n}: Speed 30 feet`] }],
    onSelect: () => {},
    collapsible: true,
  });
  const all = wizard.renderPickerTableInto(document.createElement("div"), ["Elf", "Human", "Dwarf"], opts(["Elf", "Human", "Dwarf"]));
  assert(rowsOf(all).length === 3, "given every name, the table lists every row");

  const one = wizard.renderPickerTableInto(document.createElement("div"), ["Elf"], opts(["Elf"]));
  const oneRows = rowsOf(one);
  assert(oneRows.length === 1, "given one name, the table lists one row");
  assert(one.textContent.includes("Elf"), "and it is the chosen one");
  assert(oneRows[0].className.includes("choice-row--selected"), "and it renders as selected");
  assert(detailsOf(oneRows[0]), "and it still expands, so it reads as it did where it was picked");
  assert(one.textContent.includes("Speed 30 feet"), "and still carries its mechanics");
}

// --- Gameplay glossary: terms render, and spell names survive them -----
// A term and a spell name can be the same words ("Blindness/Deafness",
// "Fire Bolt"). Without the overlap guard in richText.js the glossary wins
// and the spell stops being a link, so the guard is checked here rather
// than trusted.
{
  const { richGameTextNodes } = await import("../js/render/sheet/richText.js");
  const termIds = (box) => box.querySelectorAll(".game-term").map((n) => n.dataset.termId);
  const box = document.createElement("div");
  box.append(...richGameTextNodes("Roll a saving throw while frightened."));
  const terms = box.querySelectorAll(".game-term");
  assert(terms.length === 2, `both terms render as spans (${terms.length})`);
  assert(terms[0].className.includes("game-term"), "and carry the term class");
  assert(terms[0].dataset.termId === "savingThrow", "with the id the tooltip reads back");
  assert(terms[0].title.length > 40, "and a real explanation on the title, for a mouse");
  assert(box.textContent === "Roll a saving throw while frightened.",
    `and the prose is untouched (${box.textContent})`);

  // Ten shipped spell names contain a glossary word ("Cone of Cold",
  // "Wall of Fire", "Darkvision"). Where the text really is naming the
  // spell, the spell wins; where it is naming the thing, the glossary wins.
  const spellBox = document.createElement("div");
  spellBox.append(...richGameTextNodes("Cone of Cold hits, then take necrotic damage."));
  assert(spellBox.querySelectorAll(".spell-link").length >= 1, "a spell name is still a spell link");
  assert(!termIds(spellBox).includes("coldDamage"),
    `and was not swallowed as the Cold damage type (${termIds(spellBox).join(",")})`);
  assert(termIds(spellBox).includes("necroticDamage"),
    "while a real damage type beside it still annotates");
  assert(spellBox.textContent === "Cone of Cold hits, then take necrotic damage.",
    "with the prose still intact");

  // The other direction: "Darkvision" is a spell name too, but here it is
  // naming the sense, and findSpellMentions correctly finds no spell in it.
  const sensesBox = document.createElement("div");
  sensesBox.append(...richGameTextNodes("You have Darkvision 60 ft."));
  assert(termIds(sensesBox).includes("darkvision"),
    "a term that merely shares a spell's name still annotates");
  assert(!sensesBox.querySelector(".spell-link"), "and is not turned into a spell link");
  assert(sensesBox.textContent === "You have Darkvision 60 ft.", "with the prose intact");

  const abbrBox = document.createElement("div");
  abbrBox.append(...richGameTextNodes("Wizards cast with INT."));
  assert(abbrBox.querySelector(".ability-abbr"), "ability abbrs still render");
  assert(!abbrBox.querySelector(".game-term"), "and the plain words are not terms");

  // Long press is wired once, from the document, on first use.
  assert(document.listeners.pointerdown && document.listeners.pointerdown.length >= 1,
    "a touch pointerdown handler is installed for the long press");
  assert(document.listeners.contextmenu && document.listeners.contextmenu.length >= 1,
    "and one to swallow the magnifier a long press would otherwise raise");
}

// --- Every picker list is one row per option ----------------------------
// Race, Class and Background all render as a plain single-column list, and
// the nested subclass list has to stay aligned under the class it belongs
// to. This catches a layout variant being applied to one of them.
{
  const { renderClassStepInto } = await import("../js/render/sheet/sheetWizardSteps.js");
  const { renderPickerTableInto } = await import("../js/render/sheet/sheetWizard.js");
  let topOpts = null;
  let nestedOpts = null;
  const box = document.createElement("div");
  renderClassStepInto(box, { className: "Fighter", level: 3, subclass: "", rulesetId: "dnd5e-2014" }, {
    optionNamesFn: () => ["Fighter", "Wizard"],
    catalogInfoFn: () => null,
    subclassDataFn: () => ({ subclasses: ["Champion"], subclassLevel: 3 }),
    updateFn: () => {},
    selectableRowsFn: (container, names, opts) => {
      if (opts.nested) nestedOpts = opts;
      else topOpts = opts;
      renderPickerTableInto(container, names, opts);
    },
  });
  assert(topOpts && !topOpts.gallery, "the class list asks for the plain one-per-row layout");
  const lists = box.querySelectorAll(".choice-row-list");
  assert(lists.length >= 2, "and both the class list and its nested subclass list rendered");
  assert(nestedOpts && nestedOpts.nested === true, "the subclass list is marked nested");
  // One option per row, not a grid of cards. Matched on the class LIST, not
  // a substring: the controls bar's own class contains "choice-row".
  const rows = lists.filter((l) => !l.className.includes("choice-row-list--nested"));
  const countRows = (l) => l.children
    .filter((c) => String(c.className || "").split(/\s+/).includes("choice-row")).length;
  assert(rows.every((l) => countRows(l) === 2),
    `the top list has one row per class (${rows.map(countRows).join(",")})`);
}

// --- Long press opens the tooltip on a device that cannot hover ---------
// Real timers, because the whole feature is a timer: a synthetic event
// alone would pass whether or not the wait was ever armed.
{
  const { richGameTextNodes } = await import("../js/render/sheet/richText.js");
  const fire = (type, extra = {}) => {
    const evt = { target: null, pointerType: "touch", clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {}, ...extra };
    (document.listeners[type] || []).forEach((f) => f(evt));
    return evt;
  };
  const box = document.createElement("div");
  box.append(...richGameTextNodes("You are frightened. You are blinded."));
  document.body.append(box);
  const term = box.querySelector(".game-term");
  const otherTerm = box.querySelectorAll(".game-term")[1];
  assert(!!otherTerm, "two terms to test the one-at-a-time rule with");
  const openTooltips = () => document.querySelectorAll(".game-tooltip");

  // A mouse already has the native title; arming on one would fight
  // ordinary clicking.
  fire("pointerdown", { target: term, pointerType: "mouse" });
  fire("pointerup", { target: term, pointerType: "mouse" });
  await new Promise((r) => setTimeout(r, 700));
  assert(openTooltips().length === 0, "a mouse pointerdown opens nothing");

  // Opens on a TAP, not a hold. Used to need 500ms of finger-down first,
  // which asked the player to learn a gesture nobody had told them about.
  fire("pointerdown", { target: term });
  assert(openTooltips().length === 0, "nothing opens while the finger is still down");
  fire("pointerup", { target: term });
  const tips = openTooltips();
  assert(tips.length === 1, `a tap opens exactly one tooltip (${tips.length})`);
  assert(tips[0].getAttribute("role") === "tooltip", "announced as a tooltip");
  assert(tips[0].textContent === term.title && tips[0].textContent.length > 40,
    "carrying the same explanation the title had");
  assert(term.getAttribute("aria-describedby") === tips[0].id,
    "and the term points at it while it is open");
  assert(term.tabIndex === 0, "the trigger is focusable, so the explanation is reachable without a pointer");

  // Tapping the SAME word again closes it, and never stacks a second one.
  fire("pointerdown", { target: term });
  fire("pointerup", { target: term });
  assert(openTooltips().length === 0, "tapping the word again closes it");
  assert(!term.getAttribute("aria-describedby"), "and leaves no stale aria-describedby behind");

  // Only one at a time: a second word replaces the first rather than joining it.
  fire("pointerdown", { target: term });
  fire("pointerup", { target: term });
  const before = openTooltips()[0];
  fire("pointerdown", { target: otherTerm });
  fire("pointerup", { target: otherTerm });
  assert(openTooltips().length === 1, `still exactly one tooltip (${openTooltips().length})`);
  assert(openTooltips()[0] !== before, "and it is the newer one");
  assert(otherTerm.getAttribute("aria-describedby") === openTooltips()[0].id,
    "with the description following the word that is now open");
  assert(!term.getAttribute("aria-describedby"), "and the first word no longer claims it");

  // Escape closes, whatever opened it.
  fire("keydown", { key: "Escape", target: document.body });
  assert(openTooltips().length === 0, "Escape closes it");

  // Keyboard opens it too, so the explanation is not touch-only.
  fire("keydown", { key: "Enter", target: { closest: () => term } });
  assert(openTooltips().length === 1, "Enter on a focused term opens it");
  fire("keydown", { key: "Escape", target: document.body });
  assert(openTooltips().length === 0, "and Escape closes it again");

  // A tap anywhere that is not a term closes it - including on the tooltip
  // itself, which is a sibling of the app rather than a term.
  fire("pointerdown", { target: term });
  fire("pointerup", { target: term });
  const tipEl = openTooltips()[0];
  fire("pointerdown", { target: tipEl });
  assert(openTooltips().length === 0, "tapping the tooltip itself closes it");

  fire("pointerdown", { target: term });
  fire("pointerup", { target: term });
  assert(openTooltips().length === 1, "open again for the outside-tap check");
  fire("pointerdown", { target: document.body, closest: () => null });
  assert(openTooltips().length === 0, "tapping elsewhere on the screen closes it");
  assert(!term.getAttribute("aria-describedby"), "and leaves no stale aria-describedby behind");

  // Scrolling out from under the finger cancels it: the player was reading
  // down the page, not asking about a word. The open tooltip goes with it.
  fire("pointerdown", { target: term });
  fire("pointermove", { target: term, clientX: 0, clientY: 60 });
  fire("pointerup", { target: term, clientX: 0, clientY: 60 });
  assert(openTooltips().length === 0,
    `a tap that turns into a scroll opens nothing (${openTooltips().length})`);
  assert(!term.getAttribute("aria-describedby"),
    "and leaves no stale aria-describedby behind");
}

if (failures) {
  console.error(`smoke-dom: ${failures} failure(s)`);
  process.exit(1);
} else {
  console.log("smoke-dom: all checks passed");
}
// Choices embedded on a subrace OPTION, rendered.
//
// The High Elf's extra language and cantrip hang off the subrace option
// rather than the race's top-level groups. Nothing descended into that
// shape, so both traits printed their text with no way to take them.
// nestedChoiceGroupsFor lifts them into keyed groups; this checks they
// then render as the same live rows every other pick does.
{
  const { nestedChoiceGroupsFor, renderLiveBulletItem } = wizard;
  const { FIXED_RACE_ENTRIES } = await import("../js/data/contentFixups.js");
  const elf = FIXED_RACE_ENTRIES.find((e) => e.name === "Elf");
  const subrace = elf.bundle.choiceGroups.find((g) => g.id === "elf-subrace");
  const high = subrace.options.find((o) => o.id === "elf-subrace-high");
  const parentKey = "creation:Race:Elf:elf-subrace";

  const picked = nestedChoiceGroupsFor(high, { parentKey, pickedIds: ["elf-subrace-high"], source: "High Elf" });
  assert(picked.length === 2, "the High Elf's embedded picks are lifted when it is taken");
  assert(picked.every((g) => g.key && g.key.startsWith(`${parentKey}:elf-subrace-high:`)),
    "each embedded group is keyed under the option that owns it");
  assert(nestedChoiceGroupsFor(high, { parentKey, pickedIds: [] }).length === 0,
    "an un-taken subrace offers no embedded picks");

  // The language group is an inline dropdown, like every other language
  // pick; the cantrip is a dialog link.
  const [language, cantrip] = picked;
  const languageBullet = renderLiveBulletItem({
    live: true,
    topic: "Languages",
    lead: [{ text: "Common" }, { text: "Elvish" }],
    slots: language.options.slice(0, 1).map((o, i) => ({
      key: `${language.key}#${i}`,
      value: o.name,
      placeholder: "Choose...",
      options: groupOptionsFor(language).slice(0, 3).map((o) => ({ value: o.name, label: o.name })),
    })),
  });
  const languageBox = document.createElement("div");
  languageBox.append(languageBullet);
  assert(languageBox.querySelector(".inline-pick-select"), "the extra language renders as a dropdown in the subrace row");
  assert(languageBox.textContent.includes("Elvish"), "granted languages are shown beside the dropdown");
  assert(languageBullet.querySelector(".inline-pick-select").getAttribute("data-inline-slot") === `${language.key}#0`,
    "the slot key is the embedded group's own key, so the pick stores where it can be read back");

  const cantripBullet = renderLiveBulletItem({
    live: true,
    topic: cantrip.label,
    lead: [],
    dialogOpener: () => {},
  });
  const cantripBox = document.createElement("div");
  cantripBox.append(cantripBullet);
  assert(cantripBox.querySelector(".inline-pick-link"), "the cantrip renders as a dialog link");
  assert(cantripBox.textContent.includes("Choose"), "and says what it wants");

  // Every language option must actually grant something, or the pick
  // records a name and changes nothing.
  for (const option of language.options) {
    assert((option.statModifiers || []).length > 0, `${option.name} grants a language`);
  }
  assert(language.options.length === 15, "every language but Common is offered");
  assert(!language.options.some((o) => o.name === "Common"), "Common is free, never a pick");
}

// A bullet's label and the link after it must not say the same thing
// twice: the Monk's tool group shipped as "Monk Tool Proficiencies: choose
// one" and rendered as "... choose one — Choose 1".
{
  const { renderLiveBulletItem, trimTrailingChooseInstruction } = wizard;

  const bullet = renderLiveBulletItem({
    live: true,
    topic: "Monk Tool Proficiencies: choose one",
    lead: [{ text: "Choose 1" }],
    dialogOpener: () => {},
  });
  const box = document.createElement("div");
  box.append(bullet);
  const text = box.textContent.replace(/\s+/g, " ").trim();

  assert(!/choose one/i.test(text),
    `a label's trailing instruction is stripped next to a link, not repeated (got "${text}")`);
  assert(/Monk Tool Proficiencies/.test(text), "and the topic itself survives");
  assert(/Choose 1/.test(text), "with the link's own summary still there");

  // Without a link the label is the whole line, so the instruction has to
  // stay: stripping it would leave a topic with nothing after it.
  const noLink = document.createElement("div");
  noLink.append(renderLiveBulletItem({
    live: true,
    topic: "Monk Tool Proficiencies: choose one",
    lead: [{ text: "Smith's tools" }],
  }));
  assert(/choose one/i.test(noLink.textContent),
    "a locked bullet with no link keeps the instruction, since it is all the text there is");
}

// The prepared-spells line is a peer of the cantrip and spellbook lines, not
// a sub-choice of them, so it must not be indented.
{
  const { renderLiveBulletItem } = wizard;
  const prepared = document.createElement("div");
  prepared.append(renderLiveBulletItem({
    live: true,
    topic: "Prepared Spells",
    indent: false,
    lead: [{ text: "Bless" }],
    dialogOpener: () => {},
  }));
  assert(!prepared.querySelector(".mechanics-pick--nested"),
    "the prepared-spells line renders level with its neighbours");
}

// A tap must not put focus back on the dropdown. The pick re-renders the
// page, and focusing the replacement <select> reopens the native picker on a
// touch device - so the dropdown closed and immediately reopened. Because the
// value was already set, choosing the SAME option again fires no change event
// at all, which is why it then stayed closed until a different option was
// picked. A keyboard still gets its focus restored.
{
  const { renderLiveBulletItem } = wizard;
  const build = () => {
    const calls = [];
    const li = renderLiveBulletItem({
      live: true,
      topic: "Ability Score Increase",
      lead: [],
      slots: [{
        key: "asi#0",
        value: "",
        placeholder: "Choose…",
        options: [{ value: "str", label: "Strength" }, { value: "con", label: "Constitution" }],
      }],
      onPick: (slotKey, value, info) => calls.push({ slotKey, value, info }),
    });
    const box = document.createElement("div");
    box.append(li);
    // This stub DOM has no dispatchEvent; the renderer wires handlers as
    // properties on the node, so call them the way a browser would.
    const select = li.children.find((n) => n.tag === "select");
    assert(select, "the bullet rendered a select to operate");
    return { box, select, calls };
  };

  // el() wires on* handlers through addEventListener, so they live in
  // `listeners`. Fire them the way a browser would, in order.
  const fire = (s, type, key) => {
    (s.listeners[type] || []).forEach((f) => f({
      target: s, key, preventDefault() {}, stopPropagation() {},
    }));
  };
  const tap = (s) => { fire(s, "pointerdown"); s.value = "str"; fire(s, "change"); };
  const typeInto = (s, key) => { fire(s, "keydown", key); s.value = "str"; fire(s, "change"); };

  const tapped = build();
  tap(tapped.select);
  assert(tapped.calls.length === 1, "a tap still records the pick");
  assert(tapped.calls[0].info.keyboard === false,
    "and reports it as NOT keyboard, so nothing refocuses the replacement select");

  const typed = build();
  typeInto(typed.select, "ArrowDown");
  assert(typed.calls.length === 1, "a keyboard pick records too");
  assert(typed.calls[0].info.keyboard === true,
    "and reports keyboard: true, so focus is restored after the re-render");

  const tabbed = build();
  typeInto(tabbed.select, "Tab");
  assert(tabbed.calls[0].info.keyboard === false,
    "a Tab that merely passes over the control is not a keyboard pick");
}

// A slot may split its options into non-selectable headed groups. The native
// <optgroup> is the only heading a <select> can hold, and it is exactly the
// behaviour wanted for the language list: the label is shown, it cannot be
// picked.
{
  const { renderLiveBulletItem } = wizard;
  const li = renderLiveBulletItem({
    live: true,
    topic: "Languages",
    lead: [],
    slots: [{
      key: "lang#0",
      value: "",
      placeholder: "Choose…",
      optgroups: [
        { label: "Widespread", options: [{ value: "Dwarvish", label: "Dwarvish" }, { value: "Elvish", label: "Elvish" }] },
        { label: "Rare", options: [{ value: "Draconic", label: "Draconic" }] },
      ],
      options: [
        { value: "Dwarvish", label: "Dwarvish" },
        { value: "Elvish", label: "Elvish" },
        { value: "Draconic", label: "Draconic" },
      ],
    }],
  });
  const select = [...li.children].find((n) => n.tag === "select");
  const kids = select.children;
  const groups = kids.filter((n) => n.tag === "optgroup");
  assert(groups.length === 2, `the options sit in two headed groups (got ${groups.length})`);
  assert(groups.map((g) => g.label).join("|") === "Widespread|Rare",
    `labelled in order (got ${JSON.stringify(groups.map((g) => g.label))})`);
  // Nothing duplicated: a value that is grouped must not ALSO appear as a
  // bare option, or the picker would list it twice. The placeholder has an
  // empty value and is excluded, since it is deliberately ungrouped.
  const values = kids.flatMap((n) => (n.tag === "optgroup"
    ? n.children.map((o) => o.value)
    : [n.value])).filter((v) => v !== "");
  assert(values.join(",") === "Dwarvish,Elvish,Draconic",
    `and no option is listed twice (got ${JSON.stringify(values)})`);
  assert(kids[0].tag === "option" && kids[0].value === "", "the placeholder stays first and ungrouped");

  // An option in no optgroup must still be offered, or a caller that lists
  // only some groups would silently hide the rest.
  const partial = renderLiveBulletItem({
    live: true, topic: "x", lead: [],
    slots: [{
      key: "p#0", value: "", placeholder: "Choose…",
      optgroups: [{ label: "Widespread", options: [{ value: "Dwarvish", label: "Dwarvish" }] }],
      options: [{ value: "Dwarvish", label: "Dwarvish" }, { value: "Undercommon", label: "Undercommon" }],
    }],
  });
  const pSel = [...partial.children].find((n) => n.tag === "select");
  const tail = pSel.children.filter((n) => n.tag === "option").map((n) => n.value);
  assert(tail.includes("Undercommon"),
    `an ungrouped option is still offered (${JSON.stringify(tail)})`);
  assert(!tail.includes("Dwarvish"), "while a grouped one is not repeated outside its group");
}

// The choice dialog's own headed sections, for pickers whose options fall
// into obvious bands (the language list's Widespread/Rare split). The
// headings must be inert: a <label> would invite a click to pick whatever it
// wrapped, and an option-shaped heading would be pickable.
{
  const { openChoiceDialog } = wizard;
  let accepted = null;
  openChoiceDialog({
    title: "Languages",
    multi: true,
    maxSelections: 2,
    options: [
      { id: "l-dw", name: "Dwarvish" },
      { id: "l-el", name: "Elvish" },
      { id: "l-ab", name: "Abyssal" },
      { id: "l-dr", name: "Draconic" },
    ],
    sections: [
      { label: "Widespread", optionIds: ["l-dw", "l-el"] },
      { label: "Rare", optionIds: ["l-ab", "l-dr"] },
    ],
    initialSelected: ["l-dw"],
    onAccept: (ids) => { accepted = ids; },
  });
  const box = document.body.querySelector(".choice-dialog");
  assert(box, "the dialog rendered");
  const kids = box.querySelector(".choice-dialog-list").children;
  const labels = kids.filter((n) => (n.className || "").includes("choice-dialog-section-label"));
  assert(labels.map((n) => n.textContent).join("|") === "Widespread|Rare",
    `the headings render in order (${JSON.stringify(labels.map((n) => n.textContent))})`);
  assert(labels.every((n) => n.tag === "div"),
    "as plain divs, so a click on one cannot select anything");
  assert(!labels.some((n) => (n.children || []).some((c) => c.tag === "input")),
    "and none of them holds a checkbox");
  const opts = kids.filter((n) => (n.className || "").includes("choice-dialog-option"));
  assert(opts.length === 4, `every option is still offered (${opts.length})`);
  assert(opts.every((n) => (n.children || []).some((c) => c.tag === "input")),
    `and each still has its picker (${JSON.stringify(opts[0]?.children?.map((c) => c.tag))})`);

  // An option named by no section must still be offered - a caller that
  // lists some sections cannot silently hide the rest.
  //
  // openChoiceDialog is a singleton: opening a second one REPLACES the first,
  // so each dialog's list is read before the next is opened rather than
  // collected afterwards.
  const listOf = () => {
    const box = document.body.querySelector(".choice-dialog");
    return box ? box.querySelector(".choice-dialog-list").children : [];
  };
  const opened = [];
  openChoiceDialog({
    title: "Mixed", multi: true, maxSelections: 3,
    options: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "c", name: "Gamma" }],
    sections: [{ label: "Grouped", optionIds: ["a"] }],
    onAccept: (ids) => { accepted = ids; },
  });
  opened.push(...listOf());
  const mixedOpts = opened.filter((n) => (n.className || "").includes("choice-dialog-option"));
  assert(mixedOpts.length === 3,
    `an option in no section is still listed (${mixedOpts.length} of 3)`);

  // No sections at all must render exactly as before - this is an opt-in, so
  // every existing picker is unaffected.
  openChoiceDialog({
    title: "Plain", multi: false, maxSelections: 1,
    options: [{ id: "x", name: "X" }, { id: "y", name: "Y" }],
    onAccept: (ids) => { accepted = ids; },
  });
  assert(listOf().every((n) => !(n.className || "").includes("choice-dialog-section-label")),
    "a picker with no sections renders no headings");
  void accepted;
}

function groupOptionsFor(group) {
  return [...(group.options || []), ...(group.categories || []).flatMap((c) => c.options || [])];
}

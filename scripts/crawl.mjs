#!/usr/bin/env node
// scripts/crawl.mjs
//
// Comprehensive click-through of the real app in headless Chrome: walks
// the full setup wizard (every race/class/background row, every step),
// the level-1 guide, the finished sheet (tabs, toolbar, dialogs,
// choice inputs, leveling rows) and the vault. Every interactive
// element gets clicked; every page error is attributed to the action
// that triggered it. Exits non-zero with a grouped error report.
//
// Same backend story as e2e-smoke: no Firebase needed (offline
// localStorage vault + mock-store demo page). Needs `npm i`
// (playwright-core) plus a Chrome binary — well-known install paths
// or PLAYWRIGHT_CHROME_PATH. Screenshots go to os.tmpdir().
//
// Run: npm run test:crawl
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
let chromium;
try {
  chromium = createRequire(import.meta.url)("playwright-core").chromium;
} catch {
  console.error("crawl: playwright-core is not installed. Run `npm i` first.");
  process.exit(1);
}
function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME_PATH && fs.existsSync(process.env.PLAYWRIGHT_CHROME_PATH)) {
    return process.env.PLAYWRIGHT_CHROME_PATH;
  }
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}
const chromePath = findChrome();
if (!chromePath) {
  console.error("crawl: no Chrome binary found. Install Google Chrome, or set PLAYWRIGHT_CHROME_PATH.");
  process.exit(1);
}
const SHOT_DIR = path.join(os.tmpdir(), "grimoire-crawl");
fs.mkdirSync(SHOT_DIR, { recursive: true });
const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, name) }).catch(() => {});
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("nope"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("dialog", (d) => d.dismiss()); // never let a confirm/alert block the crawl

const errors = []; // {phase, action, message}
const seen = new Set();
let errorLog = [];
page.on("pageerror", (e) => {
  const frames = (e.stack || "").split("\n").slice(0, 7).join(" <- ");
  errorLog.push(`PAGEERROR: ${(e.message || "").split("\n")[0]} :: ${frames}`);
});
page.on("console", (m) => { if (m.type() === "error") errorLog.push(`CONSOLE: ${m.text().split("\n")[0]}`); });

async function act(phase, action, fn, opts = {}) {
  const before = errorLog.length;
  try {
    await fn();
  } catch (e) {
    // Timeouts on sweep clicks mean "not clickable" (hidden/disabled/
    // detached after a re-render) — crawler limitation, not an app bug.
    // Real crashes still surface via the pageerror listener below.
    const msg = (e.message || "").split("\n")[0];
    if (!opts.ignoreTimeouts || !/timeout|not attached|not visible|detached|subtree/i.test(msg)) {
      errors.push({ phase, action, message: `ACTION-THREW: ${msg}` });
    }
    return;
  }
  await page.waitForTimeout(500);
  for (const msg of errorLog.slice(before)) {
    const key = `${phase}|${action}|${msg}`;
    if (!seen.has(key)) { seen.add(key); errors.push({ phase, action, message: msg }); }
  }
}
// Sweep clicks: only pageerrors matter, never actionability.
const sweep = (phase, action, fn) => act(phase, action, fn, { ignoreTimeouts: true });
const click = (sel, timeout = 4000) => page.click(sel, { timeout });

async function stepLabel() {
  return page.evaluate(() => {
    const dots = [...document.querySelectorAll(".wizard__dot")].find((d) => d.className.includes("active"));
    return dots ? dots.textContent.trim() : document.querySelector(".wizard h2, h2")?.textContent?.trim();
  }).catch(() => "?");
}

// ---------- Phase A: full wizard walk ----------
await page.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await act("vault", "open + New Character", () => click("button:has-text('+ New Character')"));
await page.waitForTimeout(1500);

const visits = {};
for (let step = 0; step < 22; step++) {
  const label = await stepLabel();
  const inWizard = await page.$(".wizard");
  if (!inWizard) break; // left the wizard (finished or sheet opened)
  // 1) Sweep every choice row on this step.
  //
  // Remember which row was selected BEFORE the sweep. The sweep is
  // destructive: a row click toggles, so sweeping a page that already holds
  // a pick - the Review page repeats the race and class rows - ends with
  // whichever row happened to be swept last, and clicking the one that was
  // already selected DESELECTS it. On Review that cleared the class outright,
  // which then blocked Apply with "pick which class gains this level".
  //
  // This was hidden while row clicks were inert below the portrait strip:
  // the sweep's centre-click landed in the details and did nothing, so the
  // pre-sweep selection survived by accident.
  const selectedBefore = await page.$$eval(".choice-row--selected", (els) => els.map((e) => e.dataset.rowName)).catch(() => []);
  const names = await page.$$eval(".choice-row[data-row-name]", (els) => els.map((e) => e.dataset.rowName)).catch(() => []);
  console.log(`[wizard:${label}] sweeping ${names.length} rows`);
  for (const name of names) {
    await sweep(`wizard:${label}`, `click row ${name}`, () => click(`.choice-row[data-row-name="${name}"]`, 3000));
    await page.keyboard.press("Escape"); // close any overlay the click opened
    await page.waitForTimeout(200);
  }
  // Choice dialogs (summary links for the shared picker, superscript ?
  // for feat/tool pickers): open each one to prove it renders
  // error-free, then close without picking (Escape, else its Cancel
  // button) so state is untouched.
  const helpSel = ".wizard .inline-pick-link, .wizard .inline-pick-help a";
  const helpCount = await page.$$eval(helpSel, (els) => els.length).catch(() => 0);
  for (let i = 0; i < Math.min(helpCount, 8); i++) {
    await sweep(`wizard:${label}`, "open choice dialog", () => page.locator(helpSel).nth(i).click({ timeout: 3000 }));
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    if (await page.$(".modal-overlay")) {
      await sweep(`wizard:${label}`, "cancel dialog", () => click(".modal-overlay .btn:not(.btn--primary)", 3000));
      await page.waitForTimeout(200);
    }
  }
  // Spell-picker cards (Spells step): click-to-learn rows, capped per
  // level — cantrips list first, so burn rounds round-robin across the
  // level sections (else capped cantrips eat the whole budget and the
  // level-1 pick never happens). One click per round: each toggle
  // re-renders the list and detaches the rest.
  const headCount = await page.$$eval(".spell-picker-list .wizard__section-label", (h) => h.length).catch(() => 0);
  if (headCount) {
    for (let r = 0; r < 40; r++) {
      if (await page.$(".wizard button.wizard__next:not([disabled])")) break;
      const secIdx = r % headCount;
      const nm = await page.evaluate((idx) => {
        const heads = [...document.querySelectorAll(".spell-picker-list .wizard__section-label")];
        const head = heads[idx];
        if (!head) return null;
        let n = head.nextElementSibling;
        while (n && !n.classList?.contains("wizard__section-label")) {
          const row = n.matches?.(".choice-row:not(.choice-row--selected)")
            ? n
            : n.querySelector?.(".choice-row:not(.choice-row--selected)");
          if (row && row.isConnected) {
            const name = row.getAttribute("data-name") || "?";
            row.click();
            return name;
          }
          n = n.nextElementSibling;
        }
        return null;
      }, secIdx);
      if (nm) {
        const before = errorLog.length;
        await page.waitForTimeout(250);
        for (const msg of errorLog.slice(before)) {
          const key = `wizard:${label}|learn spell ${nm}|${msg}`;
          if (!seen.has(key)) { seen.add(key); errors.push({ phase: `wizard:${label}`, action: `learn spell ${nm}`, message: msg }); }
        }
      } else {
        await page.waitForTimeout(100);
      }
    }
  }
  // 2) Complete the step minimally: fill empties, pick first valid options.
  // Runs AFTER the sweep (row clicks replace inline choices) and again
  // after selecting the final row, so gating sees a finished page.
  //
  // Controls inside a row that is NOT selected are left alone, and that is a
  // correctness fix rather than tidiness. Committing a value in a row's
  // dropdown now selects that row (renderSinglePickerRows), so a bulk fill
  // that walks every select on the page does not merely fill fields - it
  // walks from race to race SELECTING each one, eight at a time. The sweep
  // then toggles whichever of those it clicks, and the step finishes with no
  // race selected and no enabled Next: blocked on a page a player could pass
  // easily. Filling a row you have not picked was never meaningful work, and
  // the selects that matter (ruleset, level, HP method) live outside rows.
  //
  // Written as a real function and passed in, because `page.evaluate` hands
  // the function to the page and cannot close over anything here.
  const skipUnpickedRow = (el) => {
    const row = el.closest?.(".choice-row");
    return !!row && !row.classList.contains("choice-row--selected");
  };
  const fillStep = async () => {
    await page.evaluate(() => {
      document.querySelectorAll(".wizard input[type='text'], .wizard input:not([type])").forEach((i) => { if (!i.value) { i.value = "Crawl"; i.dispatchEvent(new Event("input", { bubbles: true })); } });
    });
    // Cross-category dropdowns share ONE pick budget and re-render their
    // group on every change (evicting the oldest pick when over budget),
    // so bulk-setting every empty select in one pass stomps sibling
    // picks — fill exactly one select per round and re-query until no
    // empty select remains (same one-at-a-time rule as the radios
    // below). Capped: a full budget stays full, so extra rounds only
    // churn within the budget, never below it.
    for (let sround = 0; sround < 8; sround++) {
      const filled = await page.evaluate((skip) => {
        const live = (el) => !(skip ? skip(el) : false);
        const s = [...document.querySelectorAll(".wizard select")].find((el) => !el.value && el.isConnected && live(el));
        if (!s) return false;
        const opt = [...s.options].find((o) => o.value && !/choose|select|none/i.test(o.text));
        if (!opt) return false;
        s.value = opt.value;
        s.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }, skipUnpickedRow);
      if (!filled) break;
      await page.waitForTimeout(250);
    }
    for (let round = 0; round < 40; round++) {
      const clicked = await page.evaluate((skip) => {
        const live = (el) => !(skip ? skip(el) : false);
        const radioNames = new Set([...document.querySelectorAll(".wizard input[type='radio']")].map((r) => r.name));
        for (const name of radioNames) {
          const group = [...document.querySelectorAll(`.wizard input[type='radio'][name="${CSS.escape(name)}"]`)].filter((r) => !r.disabled && r.isConnected && live(r));
          if (group.length && !group.some((r) => r.checked)) { group[0].click(); return true; }
        }
        const box = [...document.querySelectorAll(".wizard input[type='checkbox']:not(:checked)")].find((c) => !c.disabled && c.isConnected && live(c));
        if (box) { box.click(); return true; }
        return false;
      }, skipUnpickedRow);
      if (!clicked) break;
      await page.waitForTimeout(250);
    }
  };
  await act(`wizard:${label}`, "fill inputs + first options", fillStep);
  await page.waitForTimeout(800);
  // Restore EXACTLY what was selected before the sweep - every row, not the
  // first match. The sweep's toggle had already deselected them one by one,
  // so re-picking a single row left the others cleared: on Review that is a
  // race AND a class AND a background, and restoring only the race left the
  // class empty, which then blocked Apply. Re-picking only rows that are
  // currently unselected keeps this idempotent - nothing already correct is
  // clicked, so nothing gets toggled back off.
  if (selectedBefore.length) {
    for (const name of selectedBefore) {
      const needed = await page.evaluate((n) => {
        const row = document.querySelector(`.choice-row[data-row-name="${CSS.escape(n)}"]`);
        return !!row && !row.classList.contains("choice-row--selected");
      }, name).catch(() => false);
      if (!needed) continue;
      await sweep(`wizard:${label}`, `restore row ${name}`, () => click(`.choice-row[data-row-name="${name}"]`, 3000));
      await page.waitForTimeout(500);
      await act(`wizard:${label}`, `refill after restoring ${name}`, fillStep);
      await page.waitForTimeout(500);
    }
  } else if (names.length) {
    // Nothing was selected before the sweep: take the first row so the step
    // has something canonical to work from.
    //
    // Guarded, because "nothing was selected before" no longer means nothing
    // is selected NOW. fillStep clicks select options, and committing a value
    // in a row's dropdown selects that row - so the sweep can leave a row
    // selected on its own. Clicking it again here would then TOGGLE it off
    // (a click on an open, selected row collapses and de-selects it), leaving
    // the step with nothing selected and no enabled Next. This is the exact
    // shape of the block it looks like it is fixing.
    const alreadyPicked = await page.evaluate(
      (n) => !!document.querySelector(`.choice-row[data-row-name="${CSS.escape(n)}"].choice-row--selected`),
      names[0]).catch(() => false);
    if (!alreadyPicked) {
      await sweep(`wizard:${label}`, `select first row ${names[0]}`, () => click(`.choice-row[data-row-name="${names[0]}"]`, 3000));
    }
    await page.waitForTimeout(600);
    await act(`wizard:${label}`, "refill after select", fillStep);
    await page.waitForTimeout(800);
  }
  // 2b) Complete through ? dialogs: some steps can only finish inside
  // the shared choice dialogs (skills/tools/styles/expertise live
  // there now). Open each ?, check everything checkable (max caps deny
  // the rest), Accept, repeat until Next enables or nothing changes.
  const completeViaDialogs = async (tag) => {
    const helpSel = ".wizard .inline-pick-link, .wizard .inline-pick-help a";
    for (let r = 0; r < 16; r++) {
      if (await page.$(".wizard button.wizard__next:not([disabled])")) return true;
      if (await page.$(".wizard button:has-text('Finish'), .wizard button:has-text('Complete'), .wizard button:has-text('Create'), .wizard button:has-text('Apply'):not(.wizard__dot)")) return true;
      const helpCount = await page.$$eval(helpSel, (els) => els.length).catch(() => 0);
      if (!helpCount) return false;
      const idx = r % helpCount;
      await sweep(`wizard:${label}`, `dialog-complete ${tag} round ${r}`, () => page.locator(helpSel).nth(idx).click({ timeout: 3000 }));
      await page.waitForTimeout(400);
      if (!(await page.$(".choice-dialog-overlay, .modal-overlay"))) continue;
      await page.evaluate(() => {
        const root = document.querySelector(".choice-dialog-overlay, .modal-overlay");
        if (!root) return;
        root.querySelectorAll("input[type='checkbox']:not(:checked)").forEach((c) => { if (!c.disabled) c.click(); });
        const radios = [...root.querySelectorAll("input[type='radio']")].filter((x) => !x.disabled);
        if (radios.length && !radios.some((x) => x.checked)) radios[0].click();
      });
      await page.waitForTimeout(300);
      const accept = await page.$(".choice-dialog-overlay .btn--primary, .modal-overlay .btn--primary");
      if (accept) await sweep(`wizard:${label}`, `dialog-accept ${tag}`, () => accept.click({ timeout: 3000 }));
      else await page.keyboard.press("Escape");
      await page.waitForTimeout(600);
    }
    return false;
  };
  // 2c) Complete through NESTED rows: a subrace (Elf's High/Wood/Drow) or a
  // subclass is a row nested inside the list rather than a dialog or a
  // select, so neither of the two passes above can reach it. Nothing used to
  // need this because no pass ever left a race selected that DEMANDED a
  // subrace - the step simply had nothing outstanding. It can now: committing
  // a value in an unselected row's dropdown selects that row (see
  // renderSinglePickerRows), and the sweep below commits dropdown values in
  // every row it walks. A race left selected with its subrace undecided is
  // exactly the case this closes, so the walker reports a blocked step that a
  // player could not get past.
  const completeViaNestedRows = async (tag) => {
    const enabled = async () => !!(await page.$(".wizard button.wizard__next:not([disabled])"))
      || !!(await page.$(".wizard button:has-text('Finish'), .wizard button:has-text('Complete'), .wizard button:has-text('Create'), .wizard button:has-text('Apply'):not(.wizard__dot)"));
    for (let r = 0; r < 12; r++) {
      if (await enabled()) return true;
      const nested = await page.$$(".wizard .choice-row--nested");
      if (!nested.length) return false;
      const pending = [];
      for (const row of nested) {
        const state = await row.evaluate((n) => ({
          name: n.dataset.rowName,
          selected: n.classList.contains("choice-row--selected"),
        })).catch(() => null);
        if (state?.name && !state.selected) pending.push(state.name);
      }
      if (!pending.length) return false;
      // Pick one, then let the two passes above fill in whatever that opens.
      await sweep(`wizard:${label}`, `nested-pick ${tag} ${pending[0]}`,
        () => click(`.wizard .choice-row--nested[data-row-name="${CSS.escape(pending[0])}"]`, 3000));
      await page.waitForTimeout(500);
      await act(`wizard:${label}`, `fill after nested ${tag}`, fillStep);
      await page.waitForTimeout(400);
      await act(`wizard:${label}`, `dialogs after nested ${tag}`, () => completeViaDialogs(`nested-${tag}`));
      await page.waitForTimeout(600);
    }
    return false;
  };
  await act(`wizard:${label}`, "complete via dialogs", () => completeViaDialogs("fill"));
  await page.waitForTimeout(800);
  await act(`wizard:${label}`, "complete via nested rows", () => completeViaNestedRows("fill"));
  await page.waitForTimeout(600);
  // 3) Advance, or finish, or report blocked. If the canonical pick
  // doesn't enable Next (e.g. a class with intricate level-1 choices),
  // try every row — the first one that unlocks Next wins.
  let finishBtn = await page.$(".wizard button:has-text('Finish'), .wizard button:has-text('Complete'), .wizard button:has-text('Create'), .wizard button:has-text('Apply'):not(.wizard__dot)");
  let nextBtn = await page.$(".wizard button.wizard__next:not([disabled])");
  if (!finishBtn && !nextBtn && names.length) {
    for (const name of names) {
      await sweep(`wizard:${label}`, `try pick ${name}`, () => click(`.choice-row[data-row-name="${name}"]`, 3000));
      await page.waitForTimeout(500);
      await act(`wizard:${label}`, "refill after try", fillStep);
      await page.waitForTimeout(600);
      await act(`wizard:${label}`, "dialogs after try", () => completeViaDialogs(`try-${name}`));
      await page.waitForTimeout(600);
      // A tried row may be one whose subrace is now required, and that
      // subrace is a nested row rather than a dialog - so this fallback needs
      // the same nested pass before it can call the step decided.
      await act(`wizard:${label}`, "nested after try", () => completeViaNestedRows(`try-${name}`));
      await page.waitForTimeout(400);
      finishBtn = await page.$(".wizard button:has-text('Finish'), .wizard button:has-text('Complete'), .wizard button:has-text('Create'), .wizard button:has-text('Apply'):not(.wizard__dot)");
      nextBtn = await page.$(".wizard button.wizard__next:not([disabled])");
      if (finishBtn || nextBtn) { console.log(`[wizard:${label}] unlocked via ${name}`); break; }
    }
  }
  if (finishBtn) {
    await act(`wizard:${label}`, "click Finish", () => click(".wizard button:has-text('Finish'):visible, .wizard button:has-text('Complete'):visible, .wizard button:has-text('Create'):visible, .wizard button:has-text('Apply'):visible:not(.wizard__dot)", 8000));
    await page.waitForTimeout(2000);
    // Finish Setup lands on a "Character ready" onboarding modal first.
    for (let m = 0; m < 3; m++) {
      const gotIt = await page.$("button:has-text('Got it')");
      if (!gotIt) break;
      await act(`wizard:${label}`, "dismiss onboarding", () => gotIt.click({ timeout: 5000 }));
      await page.waitForTimeout(1500);
    }
    const stillWizard = await page.$(".wizard");
    if (!stillWizard) { console.log("wizard finished — sheet opened"); break; }
    // Finish clicked cleanly but wizard persists: loop around (visit cap
    // below prevents spinning forever) — do NOT fall into BLOCKED.
    visits[label] = (visits[label] || 0) + 1;
    if (visits[label] > 2) {
      errors.push({ phase: `wizard:${label}`, action: "advance", message: "STUCK: Finish clicked cleanly twice, wizard still present" });
      break;
    }
    continue;
  }
  if (nextBtn) {
    const errBefore = errors.length;
    await act(`wizard:${label}`, "click Next", () => click(".wizard button.wizard__next:not([disabled]):visible", 5000));
    await page.waitForTimeout(1200);
    if (errors.length > errBefore) {
      // One retry: the button often re-renders mid-click.
      await act(`wizard:${label}`, "retry Next", () => click(".wizard button.wizard__next:not([disabled]):visible", 8000));
      await page.waitForTimeout(1200);
    }
    if (errors.length > errBefore) {
      await shot("stuck.png");
    }
  } else {
    errors.push({ phase: `wizard:${label}`, action: "advance", message: "BLOCKED: no enabled Next/Finish" });
    const diag = await page.evaluate(() => ({
      spellRows: document.querySelectorAll(".spell-picker-list .choice-row").length,
      limitNote: [...document.querySelectorAll(".leveling-tab__intro")].map((n) => n.textContent.trim()).join(" || ").slice(0, 500),
      fieldsets: document.querySelectorAll(".level-guide__choices").length,
      selects: [...document.querySelectorAll(".wizard select")].map((s) => s.value || "(empty)").join(","),
    })).catch(() => ({}));
    console.log(`[wizard:${label}] BLOCKED diag:`, JSON.stringify(diag).slice(0, 800));
    await shot("blocked.png");
    break;
  }
}

// ---------- Phase B: sheet sweep (only on a REAL sheet — the wizard hides
// the sheet toolbar/tabs bar, and clicking hidden nodes just times out) ----
const wizardGone = !(await page.$(".wizard"));
const toolbarVisible = await page.$(".sheet-toolbar:visible").catch(() => null);
console.log("wizard gone:", wizardGone, "toolbar visible:", !!toolbarVisible);
if (wizardGone && toolbarVisible) {
  // Tabs first (switching tabs re-renders — good crash surface).
  // Re-query every round: each click re-renders and detaches handles.
  const tabCount = await page.$$eval(".sheet-tab[data-tab-id]", (els) => els.length).catch(() => 0);
  console.log(`[sheet] sweeping ${tabCount} tabs`);
  for (let i = 0; i < tabCount; i++) {
    const id = await page.locator(".sheet-tab[data-tab-id]").nth(i).getAttribute("data-tab-id").catch(() => "?");
    await sweep("sheet", `tab ${id}`, () => page.locator(".sheet-tab[data-tab-id]").nth(i).click({ timeout: 5000 }));
  }
  // Simple View toggle round-trip. (Was "Play View", a half-dead mode
  // whose CSS targeted class names that no longer existed; replaced by the
  // real stacked display mode under the spec's own name.)
  if (await page.$(".sheet-toolbar button:has-text('Simple View')")) {
    await act("sheet", "Simple View on", () => click(".sheet-toolbar button:has-text('Simple View')", 5000));
    await sweep("sheet", "Simple View off", () => click(".sheet-toolbar button:has-text('Sheet View')", 5000));
  }
  // Display panel controls (open dialog via Print, then Escape — never
  // actually print).
  await act("sheet", "open Display panel", () => click(".toolbar-display summary"));
  if (await page.$(".toolbar-display button:has-text('Print')")) {
    await act("sheet", "open print dialog", () => click(".toolbar-display button:has-text('Print')", 5000));
    await page.waitForTimeout(400);
    const radioCount = Math.min(await page.$$eval(".print-dialog input[type='radio']", (els) => els.length).catch(() => 0), 4);
    console.log(`[sheet] print dialog radios: ${radioCount}`);
    for (let i = 0; i < radioCount; i++) {
      await sweep("sheet", "print dialog pick tab", () => page.locator(".print-dialog input[type='radio']").nth(i).click({ timeout: 5000 }));
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  // Safe toolbar buttons (skip anything delete/remove/disabled).
  const btnCount = await page.$$eval(".sheet-toolbar button:not([disabled]), .sheet-toolbar summary", (els) => els.length).catch(() => 0);
  console.log(`[sheet] sweeping ${btnCount} toolbar controls`);
  for (let i = 0; i < btnCount; i++) {
    const sel = ".sheet-toolbar button:not([disabled]), .sheet-toolbar summary";
    const loc = page.locator(sel).nth(i);
    const label = ((await loc.textContent().catch(() => "")) || "").trim().slice(0, 24);
    const title = ((await loc.getAttribute("title").catch(() => "")) || "");
    if (/delete|remove|trash|clear/i.test(label + " " + title)) continue;
    if (/^(Simple View|Sheet View)$/.test(label)) continue; // already covered
    await sweep("sheet", `toolbar ${label || title || "?"}`, () => page.locator(sel).nth(i).click({ timeout: 5000 }));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
  // Choice inputs on the sheet (checkboxes/radios in Your choices etc.).
  const inputCount = Math.min(await page.$$eval("input[type='checkbox']:not(:disabled), input[type='radio']:not(:disabled)", (els) => els.length).catch(() => 0), 25);
  console.log(`[sheet] toggling ${inputCount} choice inputs`);
  for (let i = 0; i < inputCount; i++) {
    await sweep("sheet", "toggle choice input", () => page.locator("input[type='checkbox']:not(:disabled), input[type='radio']:not(:disabled)").nth(i).click({ timeout: 5000 }));
  }
  // Leveling rows expand.
  const lvlCount = Math.min(await page.$$eval("[data-level]", (els) => els.length).catch(() => 0), 6);
  for (let i = 0; i < lvlCount; i++) {
    await sweep("sheet", "expand leveling row", () => page.locator("[data-level]").nth(i).click({ timeout: 5000 }));
  }
  await shot("sheet-end.png");
}

// ---------- Phase C: vault sweep ----------
await page.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
if (await page.$("input[type='search']")) {
  await act("vault", "type search", () => page.fill("input[type='search']", "zzz-no-match"));
  await act("vault", "clear search", () => page.fill("input[type='search']", ""));
}
const cardCount = await page.$$eval(".character-card", (els) => els.length).catch(() => 0);
console.log(`[vault] ${cardCount} cards`);
if (cardCount) {
  await act("vault", "open first character", () => page.locator(".character-card").nth(0).click({ timeout: 5000 }));
  await page.waitForTimeout(1500);
  if (await page.$("button:has-text('Return to Character Selection')")) {
    await act("vault", "return to vault", () => click("button:has-text('Return to Character Selection')", 5000));
  }
}

await browser.close();
server.close();
console.log("=== ERRORS ===");
const byMsg = new Map();
for (const e of errors) {
  const k = `${e.phase} :: ${e.action} :: ${e.message}`;
  byMsg.set(k, (byMsg.get(k) || 0) + 1);
}
console.log(byMsg.size ? [...byMsg.entries()].map(([k, n]) => `${n}x ${k}`).join("\n") : "(none)");
process.exit(byMsg.size ? 1 : 0);

#!/usr/bin/env node
// scripts/e2e-smoke.mjs
//
// Headless-Chrome end-to-end smoke test: serves this repo over local
// HTTP, drives the REAL app (not a DOM stub), and fails on any page
// error. This is the layer that catches what unit tests and the stub
// harness cannot — e.g. an insertBefore against the wrong parent that
// aborts the whole sheet render in a real engine.
//
// No Firebase, no guest account needed:
//   demo.html        full sheet via the mock store (toolbar, tabs, grid)
//   index.html?offline=1  full vault via localStorage (+ New Character,
//                    setup wizard) — the same code path as production,
//                    minus the network backend (which is a thin wrapper).
//
// Needs: `npm i` (playwright-core) plus a Chrome binary — one of the
// well-known install paths, or PLAYWRIGHT_CHROME_PATH. No browser
// download happens here, so this also runs on thin disks/CI images
// that already ship Chrome.
//
// Screenshots go to os.tmpdir(), never the repo.
//
// Run: npm run test:e2e                    everything
//      npm run test:e2e:smoke              the core flow, one viewport
//      npm run test:e2e -- --list          print the area names, then exit
//      npm run test:e2e -- --only AREA...  only the named areas
//      npm run test:e2e -- --only '!AREA'  everything EXCEPT the named areas
//
// Why areas, and not a dependency graph over the unit tests.
//
// The unit tests were the obvious candidate and the measurement said no.
// Mapping source files to the tests that import them transitively: of the 45
// js/ modules the suite reaches, the most confined are leaf utilities
// (sheetConstants, simpleView, loadFailure - one test each), and the ones you
// would most often want to change are the LEAST confined. sheetMechanics is
// reachable from 19 of 30 test files; the whole content layer - schema,
// contentFixups, every generated bundle - from 17 or 18, because those
// modules are the subject matter rather than a dependency of it. Confining on
// that graph saves 1.3s of a 2.0s suite in the good case and still runs 63%
// of it in the bad one, while costing a graph build and a class of bug where
// the graph is wrong and something goes unchecked.
//
// Areas are a different thing and they are honest here: the e2e is one long
// script whose sections exercise genuinely different parts of the app and
// share no state. There is no graph to infer because the sections were already
// written as separate page-owning blocks. Naming them costs one line each and
// turns a 140s run into a 30s one.
//
// The unit tests therefore stay unconfined, deliberately. At 2.0s they are not
// the problem, and a selector that reported "almost everything" would be worse
// than none.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// --- Area selection -------------------------------------------------------
//
// The unit of selection is a named AREA. `npm run test:e2e -- --list` prints
// them, so this is discoverable rather than something to grep for.
//
// `--only a b` runs ONLY those. `--only '!a b'` runs everything EXCEPT them,
// and that is the shape you want most of the time: you are working on the
// Leveling tab, so the other 90% should run to prove you did not break it,
// while the 10% you are editing will not pass yet.
//
// Only areas whose checks own their browser page are selectable. A few blocks
// here are nested inside a brace that does not close until much later in the
// file - the "Phone portrait: Your Characters" block opens at 2617 and does not
// close until 3580, with five other sections nested inside it - so they
// cannot be wrapped without restructuring the file around them. They stay
// unconditional rather than being faked with an early `return`, which would
// skip whatever comes after as well.
const argv = process.argv.slice(2);
const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv.slice(i + 1).filter((a) => !a.startsWith("--"));
};

// name -> what it covers. Listed rather than derived, so an area cannot
// silently vanish when a section is refactored and so --list can say what
// each one is.
const AREAS = {
  "print-pdf": "real Chrome print pipeline: page.pdf() page count and content",
  shapes: "user-defined screen shapes: name, ratio, reflow, delete",
  "vault-cards": "Your Characters on a phone: card count and meta lines",
  "phone-layout": "phone portrait: no sideways scroll, evenly split buttons",
  "widths-sweep": "320-1440px ladder: stacking threshold and cell floor",
  "levelgated-text": "level-gated prose in a trait, changing with no reload",
  rowclick: "a click inside a row selects that row (picker link vs <select>)",
  "spell-rows": "spell picker row shape: facts, gist, disclosure",
  "swipe-arrow": "edge arrow and swipe between steps on a touch viewport",
  "load-failure": "a blocked entry script produces a failure page",
  "background-gate": "every background: Next is blocked only on a visible pick",
};

// The areas the smoke preset drops. Written as an explicit drop list so a new
// area runs in smoke by default - the safer direction, since an area added
// later and forgotten here should be checked, not skipped.
const SMOKE_DROPS = new Set([
  "print-pdf", "shapes", "phone-layout", "widths-sweep", "levelgated-text",
  "rowclick", "spell-rows", "swipe-arrow",
]);

const onlyRaw = flagValue("--only");
const SMOKE_ONLY = argv.includes("--smoke");
const listed = argv.includes("--list");
const invert = Boolean(onlyRaw && onlyRaw.length && onlyRaw.some((a) => a.startsWith("!")));
const named = new Set((onlyRaw || []).map((a) => a.replace(/^!/, "")));

if (onlyRaw && onlyRaw.length) {
  const unknown = [...named].filter((a) => !(a in AREAS));
  if (unknown.length) {
    console.error(`e2e-smoke: unknown area(s): ${unknown.join(", ")}`);
    console.error(`Known areas: ${Object.keys(AREAS).join(", ")}`);
    process.exit(2);
  }
}

let selected;
if (named.size) selected = (name) => (invert ? !named.has(name) : named.has(name));
else if (SMOKE_ONLY) selected = (name) => !SMOKE_DROPS.has(name);
else selected = () => true;

if (listed) {
  console.log("e2e areas. Use --only <name> for just these, or --only '!<name>' for everything else.");
  console.log("");
  for (const [name, meaning] of Object.entries(AREAS)) {
    console.log(`  ${selected(name) ? "on " : "off"}  ${name.padEnd(16)} ${meaning}`);
  }
  console.log("");
  console.log("Unconditional (not selectable): the three viewport passes, and the");
  console.log("wizard walkthrough inside each of them. Those are the app booting and");
  console.log("rendering - the floor under everything else - and they are the blocks");
  console.log("whose braces do not close where they appear to.");
  process.exit(0);
}

// Whether an area is part of this run. A call site reads as
// `if (inArea("print-pdf")) { ... }`, so the skip is visible where the work is
// rather than hidden in a flag check far away.
const inArea = (name) => {
  if (!(name in AREAS)) throw new Error(`e2e-smoke: "${name}" is not a known area (add it to AREAS)`);
  return selected(name);
};

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
let chromium;
try {
  chromium = createRequire(import.meta.url)("playwright-core").chromium;
} catch {
  console.error("e2e-smoke: playwright-core is not installed. Run `npm i` first.");
  process.exit(1);
}

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME_PATH && existsSync(process.env.PLAYWRIGHT_CHROME_PATH)) {
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
  return candidates.find((p) => existsSync(p)) || null;
}

const chromePath = findChrome();
if (!chromePath) {
  console.error(
    "e2e-smoke: no Chrome binary found. Install Google Chrome, or set PLAYWRIGHT_CHROME_PATH to its executable."
  );
  process.exit(1);
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
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

const shotDir = path.join(os.tmpdir(), "grimoire-e2e");
mkdirSync(shotDir, { recursive: true });

// The phone ceiling, mirroring `@media (max-width: 720px)` in the
// stylesheets. Named here rather than written inline so a check that needs
// to reason about "is this screen a phone" reads the one number instead of
// guessing a threshold of its own - the guess is what made the feat-dialog
// width check wrong in both directions at once.
const PHONE_CEILING_PX = 720;

// The four phone viewports every layout change here is checked at: two
// current phones in both orientations, and two older/smaller ones.
//
// Landscape is not a rotated portrait. 844x390 is wide enough for the
// desktop rules (so it was never covered by a "is this a phone?" check
// keyed on width) and short enough that a header sized for 844px of
// height is a quarter of the screen. That is why both orientations are
// named explicitly rather than derived by swapping width and height.
//
// 360x640 is an older Android / small iPhone class screen; 667x375 is the
// short-and-narrow one, which is the hardest case in the whole set: the
// sheet's 16-column grid cannot fit either dimension.
const PHONE_VIEWPORTS = {
  "390x844": { width: 390, height: 844 },
  "844x390": { width: 844, height: 390 },
  "360x640": { width: 360, height: 640 },
  "667x375": { width: 667, height: 375 },
};

const VIEWPORTS = [
  // Phone, tablet and laptop. The sheet is specified to work at all three,
  // and 834px is the interesting one: it is above the 720px phone
  // breakpoint (so the toolbar is not in its phone arrangement) while
  // being far too narrow for the desktop grid, so it lands on the
  // tablet-only rules rather than on either of the other two.
  //
  // 1440 rather than 1280 on purpose: 1280 is the narrow end of a laptop
  // and 1440 is the common one, but what matters is that both clear the
  // ~790px the grid needs, which the tablet does not.
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 392, height: 844 },
];

const viewportSizes = SMOKE_ONLY ? VIEWPORTS.slice(0, 1) : VIEWPORTS;


const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const problems = [];
const failures = [];

// Wait for the app to be USABLE rather than for a guessed number of
// milliseconds.
//
// This suite used to spend 136 seconds of its 668 in `waitForTimeout` calls
// that were all the same guess: "the sheet has probably finished rendering by
// now". A guess like that is wrong in both directions at once - too short on a
// cold or loaded machine, and pure dead time on a fast one - and it was the
// single largest cost in the slowest gate.
//
// `settled` waits on the thing each page is actually waiting for (the sheet
// toolbar, the vault's New Character button, the wizard itself), so a fast
// machine spends no time at all and a slow one still cannot race past the
// render. The explicit timeout is still needed and still generous: a
// condition-wait that never becomes true would otherwise hang forever, which
// turns a bug into a stuck CI job rather than a failure.
//
// It also makes the suite FASTER to read, which is not nothing: "wait for
// .sheet-toolbar" says what the test needs, and "wait 1200ms" says nothing
// about it beyond that the author did not know.
const settled = async (page, selector, what) => {
  try {
    await page.waitForSelector(selector, { state: "attached", timeout: BOOT_TIMEOUT });
  } catch {
    // Not a thrown error: the caller immediately queries the same selector to
    // assert on it, and that assertion is the one that should report the
    // failure. Throwing here would replace a precise "the toolbar never
    // appeared" message with a generic timeout.
    problems.push(`BOOT TIMEOUT [${what}]: ${selector} never appeared within ${BOOT_TIMEOUT}ms`);
  }
};

const READY_SHEET = ".sheet-toolbar";
const READY_VAULT = ".vault-new__go";
const READY_WIZARD = ".wizard";

// Wait for a debounced PERSIST to land in localStorage.
//
// The sheet saves through `debounce(persistSheetState)` at 500ms, and every
// interaction resets that timer - so a write lands 500ms after the LAST
// action in a burst, plus the async localStorage write itself. The tests that
// read storage back used to wait a flat 700ms, which leaves about a 200ms
// margin and fails whenever the machine is busy. With three viewport passes
// running concurrently the machine is always busy, which is why the
// prepared-spells block was the suite's one reliably flaky section - and why
// it failed DIFFERENTLY each run (0/8, 1/8, 8/8) rather than consistently.
//
// `quiet` cannot help here: the counter in the DOM updates immediately and
// the write happens later, so there is no rendered-state change to wait for.
// The only honest condition is the persisted value.
//
// `predicate` runs in the page against the stored character and should return
// true once the save it is waiting for has happened. A timeout is swallowed,
// because the caller asserts on the real values immediately afterwards and
// that assertion is a far better failure message than "waitForFunction
// timed out".
const saved = async (page, predicate, what, arg = undefined, timeout = 15000) => {
  try {
    await page.waitForFunction(predicate, arg, { timeout });
  } catch {
    problems.push(`SAVE TIMEOUT: ${what} was not persisted within ${timeout}ms`);
  }
};

// Wait until at least `n` spells are PREPARED in the stored document.
//
// `predicateAtLeast` is a real function rather than a string so Playwright can
// serialise it; the body is kept in one place so "how the tests read storage"
// is one function instead of a convention repeated at seven call sites.
function preparedAtLeast(n) {
  const stored = JSON.parse(localStorage.getItem("grimoire.local.characters.v1") || "{}");
  const id = Object.keys(stored)[0];
  const field = stored[id]?.sheetTabs?.[0]?.layout
    ?.flatMap((b) => b.children || [])
    ?.find((f) => f.id === "spellsKnown");
  return (field?.preparedItems || []).length >= n;
}
// The prepared count, for callers that want the number rather than a boolean.
function preparedCount() {
  const stored = JSON.parse(localStorage.getItem("grimoire.local.characters.v1") || "{}");
  const id = Object.keys(stored)[0];
  const field = stored[id]?.sheetTabs?.[0]?.layout
    ?.flatMap((b) => b.children || [])
    ?.find((f) => f.id === "spellsKnown");
  return (field?.preparedItems || []).length;
}

// Wait until the page stops changing, rather than for a fixed time.
//
// Almost every remaining sleep in this suite has the same shape: click
// something, the app re-renders the whole step, wait for it. The wait was a
// guess at how long that takes, which is why there were 136 of them totalling
// two minutes - a re-render that is sometimes 80ms and sometimes 400ms still
// got the same 1200ms, so the suite paid the worst case on every interaction.
//
// `quiet` polls a fingerprint of what is actually ON SCREEN and returns as
// soon as two consecutive samples match. That makes the common case (nothing
// left to do) cost one poll interval instead of a fixed second, while still
// waiting as long as it genuinely takes when the app is slow - which is what
// keeps it from being the flaky shortcut that replacing a sleep usually is.
//
// The fingerprint is TEXT plus SELECTED VALUES, and that combination is the
// whole trick. An earlier version counted nodes and compared text LENGTHS,
// which looked sufficient and was not: a `<select>` committing a value
// changes neither the node count nor a length that happens to match, and five
// checks failed here against output that read as correct in the terminal. A
// select's chosen label is not part of its textContent at all, so it is read
// separately, and so is checked/expanded state for the same reason.
//
// The interval is 40ms, not something slower, and that matters more than it
// looks: there are ~90 of these calls in the viewport run, so every extra
// millisecond of interval is ~90ms of suite. At 40ms two samples cost 80ms,
// against 220ms at the 110ms this started with - and because the samples are
// compared for EQUALITY rather than waited on, a short interval costs only a
// few extra samples on a slow render, never a wrong answer.
//
// It is sampled from a bounded set of regions rather than the whole document
// so the cost stays flat as the sheet grows, and it is only ever an
// OPTIMISATION: every caller asserts its own condition afterwards, so
// `quiet` returning early costs a failed assertion, never a false pass.
const QUIET_SAMPLE = [
  ".wizard__steps", ".wizard", ".sheet-toolbar", ".choice-row-list",
  ".modal-overlay", ".sheet-tab-bar", ".page-grid", ".leveling-tab",
].join(",");

const quiet = async (page, { tries = 60, interval = 40 } = {}) => {
  let previous = null;
  for (let i = 0; i < tries; i += 1) {
    const fingerprint = await page.evaluate((sel) => {
      const parts = [];
      for (const node of document.querySelectorAll(sel)) {
        parts.push((node.textContent || "").slice(0, 4000));
        for (const s of node.querySelectorAll("select")) {
          parts.push(s.selectedOptions?.[0]?.textContent || "");
        }
        for (const box of node.querySelectorAll(
          "input:checked, [aria-pressed=true], [aria-checked=true], details[open]"
        )) {
          parts.push(box.tagName + (box.getAttribute("aria-label") || ""));
        }
      }
      return parts.join("");
    }, QUIET_SAMPLE).catch(() => null);
    // Two MATCHING samples, not one: a single match can be sampled
    // mid-render between two identical halves of the same update.
    if (fingerprint !== null && fingerprint === previous) return;
    if (fingerprint !== null) previous = fingerprint;
    await page.waitForTimeout(interval);
  }
};

const BOOT_TIMEOUT = 20000;

async function runViewportTests(viewport) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  page.on("pageerror", (e) => problems.push(`PAGEERROR [${viewport.name}]: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`CONSOLE [${viewport.name}]: ${m.text()}`); });

  const check = (cond, msg) => {
    if (!cond) failures.push(`[${viewport.name}] ${msg}`);
    console.log(`${cond ? "ok" : "FAIL"} [${viewport.name}]: ${msg}`);
  };

  // Open the phone's "Edit layout" panel if this viewport has one.
  //
  // On a phone the builder controls - Customize Sheet, Undo, Redo, Blocks,
  // the Display panel, Card fields and their drop zones - are one tap
  // behind that button (css/phone.css), which is what keeps the toolbar
  // from being 404px tall before the sheet's first field. Nothing is
  // removed and nothing is stubbed: the controls are still there and still
  // do exactly what they did, so a check that wants one presses this
  // first, the same way a person would. On a wide screen there is no such
  // button and this is a no-op.
  const revealBuilder = async () => {
    const btn = await page.$(".sheet-toolbar__edit-layout:visible");
    if (!btn) return false;
    const already = await btn.evaluate((el) => el.getAttribute("aria-expanded") === "true");
    if (already) return true;
    await btn.click();
    await quiet(page);
    return true;
  };

  // A: demo sheet (mock store) — toolbar, Simple View toggle, print dialog.
  //
  // The reload/persistence half of the Simple View checks lives on the
  // OFFLINE page below, not here: the demo store rebuilds its character
  // from scratch on every load and logs what it would have saved, so a
  // reload there proves nothing about persistence by construction.
  await page.goto(`${base}/demo.html`, { waitUntil: "networkidle" });
  await settled(page, READY_SHEET, `${viewport.name} demo sheet`);
  check(await page.$(READY_SHEET), "demo sheet toolbar renders (no aborted render)");

  // Editing anything re-renders the whole grid, and the grid is emptied
  // before it is refilled - at which point the document is one screen tall
  // and the browser clamps the scroll to the top. This checks the invariant
  // at depth, which is where the clamp bites, and at three depths so a fix
  // that only holds near the top cannot pass.
  {
    const deepEnough = await page.evaluate(() =>
      document.documentElement.scrollHeight - window.innerHeight > 1200);
    if (!deepEnough) {
      check(true, "this page is too short to test scroll preservation");
    } else {
      let worst = 0;
      for (const depth of [400, 1200, 2400]) {
        const max = await page.evaluate(() =>
          Math.round(document.documentElement.scrollHeight - window.innerHeight));
        const target = Math.min(depth, Math.max(0, max - 40));
        if (target < 100) continue;
        await page.evaluate((y) => window.scrollTo(0, y), target);
        await quiet(page);
        // Something that re-renders: a checkbox, which saves and repaints.
        const hit = await page.evaluate(() => {
          const box = [...document.querySelectorAll(".grid-node input[type=checkbox]")]
            .find((e) => {
              const r = e.getBoundingClientRect();
              return r.top > 70 && r.bottom < window.innerHeight - 70 && r.width > 8;
            });
          if (!box) return null;
          const r = box.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
        if (!hit) continue;
        const before = await page.evaluate(() => Math.round(window.scrollY));
        await page.mouse.click(hit.x, hit.y);
        await quiet(page);
        const after = await page.evaluate(() => Math.round(window.scrollY));
        const delta = Math.abs(after - before);
        if (delta > worst) worst = delta;
        check(delta < 4,
          `at ${viewport.name} ${target}px down, re-rendering keeps the scroll position (moved ${delta}px)`);
        // Put it back where the next depth expects it.
        await page.evaluate(() => window.scrollTo(0, 0));
        await quiet(page);
      }
    }
  }
  // Was "Play View" / .page-grid.play-mode, which turned out to be a
  // half-dead toggle: its CSS styled class names that no longer exist, so
  // the class it set did nothing beyond the editor-chrome hiding. Replaced
  // by a real stacked display mode under the spec's own "Simple View"
  // name. The assertions below are unchanged in substance — same toggle,
  // same engage/restore, same overflow check.
  //
  // On a phone the stacked layout is ALREADY engaged by width (the grid
  // needs about 790px and the page has 344), and the toggle says so by
  // naming the other view and refusing to switch. So the assertions below
  // have to work from whichever state the viewport forced, or they would be
  // asserting that a phone shows a button it has no reason to offer.
  const viewToggle = await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".sheet-toolbar button")]
      .find((b) => /^(Sheet|Simple) View$/.test(b.textContent.trim()));
    return btn
      ? { text: btn.textContent.trim(), disabled: btn.disabled, title: btn.title }
      : null;
  });
  check(!!viewToggle, `demo view toggle exists (${JSON.stringify(viewToggle)})`);
  // Whether width forces the stacked layout is the APP's call - it measures
  // the grid, which needs about 790px - so ask it rather than guessing from
  // the viewport width. Guessing is what made this wrong at 834px, where
  // the sheet is genuinely stacked but the old 800px threshold said it
  // should not be.
  const stackedByWidth = !!(await page.$(".page-grid.is-simple"));
  const forcedStacked = stackedByWidth;
  if (viewToggle) {
    if (forcedStacked) {
      // Nothing to click - and saying so is the point. The width-forced
      // stacking itself is checked further down, where the whole layout is
      // measured rather than inferred from a label.
      check(viewToggle.disabled,
        `and where width forces the stacked layout it is disabled rather than offering a switch that does nothing (${JSON.stringify(viewToggle)})`);
      check(viewToggle.text === "Sheet View",
        `naming the view it cannot go to (got "${viewToggle.text}")`);
    } else {
      check(viewToggle.text === "Simple View",
        `and offers the switch on a screen that fits (got "${viewToggle.text}")`);
    }
  }
  const playBtn = viewToggle && viewToggle.text === "Simple View" && !viewToggle.disabled
    ? await page.$(`.sheet-toolbar button:text-is("${viewToggle.text}")`)
    : null;
  if (playBtn) {
    await playBtn.click();
    await quiet(page);
    check(await page.$(".page-grid.is-simple"), "demo Simple View mode engages");
    // Simple View is a read-only display mode, so the editing chrome has
    // to actually be gone. It was silently lost once already, when the
    // half-dead Play View rules it inherited were deleted with them - the
    // toggle still "engaged", it just left a hovered node's toolbar on
    // screen inviting edits the mode can't record.
    //
    // The toolbar is display:none by default and only shown via .is-visible
    // (set on hover), so a bare "is it hidden?" check would pass for the
    // wrong reason and prove nothing. Force the hover state on first, then
    // assert Simple View overrides it - which is exactly the rule that
    // regressed.
    const chrome = await page.evaluate(() => {
      const toolbar = document.querySelector(".grid-node .node-toolbar");
      if (!toolbar) return { ok: false, reason: "no toolbar in the document" };
      toolbar.classList.add("is-visible");
      return { ok: true, withMode: getComputedStyle(toolbar).display };
    });
    check(chrome.ok, `found a node toolbar to test${chrome.reason ? ` (${chrome.reason})` : ""}`);
    if (chrome.ok) {
      // Sanity: the hover state really does show it, otherwise the test
      // below is measuring nothing again.
      const hoverShows = await page.evaluate(() => {
        const outside = document.createElement("div");
        const bar = document.createElement("div");
        bar.className = "node-toolbar is-visible";
        outside.append(bar);
        document.body.append(outside);
        const display = getComputedStyle(bar).display;
        outside.remove();
        return display;
      });
      check(hoverShows !== "none", `hover alone shows a node toolbar (control check, got ${hoverShows})`);
      check(chrome.withMode === "none", `Simple View hides it even while hovered (got ${chrome.withMode})`);
    }
    const nodes = await page.evaluate(() => {
      const all = [...document.querySelectorAll(".grid-node")];
      const ordered = all.filter((n) => n.style.order);
      return {
        total: all.length,
        withKey: ordered.length,
        keysAgree: ordered.every((n) => Number(n.style.order) === Number(n.dataset.gridY) * 16 + Number(n.dataset.gridX)),
      };
    });
    check(nodes.withKey > 0, `Simple View stamps sort keys (${nodes.withKey} of ${nodes.total} nodes)`);
    check(nodes.keysAgree, "Simple View sort keys are row-then-column, not DOM order");
    await page.screenshot({ path: path.join(shotDir, `simple-view-${viewport.name}.png`) });
    await playBtn.click();
    await quiet(page);
    check(!(await page.$(".page-grid.is-simple")), "demo Sheet View restores");
    // And the sort keys must be gone again — they live only on the DOM,
    // so a stale one would reorder the grid the next time it's painted.
    const stale = await page.evaluate(() => [...document.querySelectorAll(".grid-node")].filter((n) => n.style.order).length);
    check(stale === 0, `Sheet View clears Simple View's sort keys (${stale} left)`);

    // Equipment proficiencies on the main sheet. The creation wizard's Gear
    // tab used to offer these as free-form pickers; it is no longer a step,
    // so the sheet is where they live. Asserted on the rendered block, not
    // on the layout data, because the question is whether the player can
    // actually reach them.
    const equipProfs = await page.evaluate(() => {
      const block = [...document.querySelectorAll(".block, .sheet-block, [class*='block']")]
        .find((b) => /^Equipment Proficiencies/.test((b.textContent || "").trim().slice(0, 40)));
      if (!block) return { block: false };
      const text = block.textContent || "";
      return {
        block: true,
        armor: /Armor/.test(text),
        weapons: /Weapons/.test(text),
        tools: /Tools/.test(text),
        vehicles: /Vehicles/.test(text),
        taglists: block.querySelectorAll("[data-field-type='taglist'], .taglist").length,
      };
    });
    check(equipProfs.block, "main sheet has an Equipment Proficiencies block");
    check(equipProfs.armor && equipProfs.weapons && equipProfs.tools && equipProfs.vehicles,
      `it covers all four categories (${JSON.stringify(equipProfs)})`);
  }
  // Print dialog opens, previews, and closes via Escape.
  //
  // Skipped under --smoke: the PDF render below drives real Chrome's print
  // pipeline, which is by far the slowest thing in this function. Its failure
  // mode - a page that comes out blank, or one page short - is real but never
  // blocks further work, so it belongs in the full run rather than between
  // edits. Opening the dialog itself is still cheap, so the smoke run checks
  // the dialog opens and closes; only the PDF stage is gated.
  // On a phone the Display panel is one tap behind "Edit layout"
// (css/phone.css), so open that first when it is there. The panel is
// reachable either way, which is the claim being made; what changed is
// that reaching it is now a deliberate act rather than a visible row.
  const editLayoutBtn = await page.$(".sheet-toolbar__edit-layout:visible");
  if (editLayoutBtn) {
    await editLayoutBtn.click();
    await quiet(page);
  }
  await revealBuilder();
  const printToggle = await page.$(".toolbar-display summary");
  check(!!printToggle, "demo Display dropdown exists");
  if (printToggle) {
    await printToggle.click();
    await quiet(page);
    const printBtn = await page.$("button:has-text('Print')");
    check(!!printBtn, "demo print button exists in Display panel");
    if (printBtn) {
      await printBtn.click();
      await quiet(page);
      check(await page.$(".print-dialog"), "demo print dialog opens");
      await page.screenshot({ path: path.join(shotDir, `print-dialog-${viewport.name}.png`) });
      await page.keyboard.press("Escape");
      await quiet(page);
      check(!(await page.$(".print-dialog")), "demo print dialog closes on Escape");
    }
  }

  // Real print-to-PDF output.
  //
  // Everything above about printing is structural: the dialog opens, the
  // CSS says what it says. What has never been checked is what Chrome
  // actually emits - specifically the headline promise, one page per
  // selected tab, with the screen chrome gone.
  //
  // The trick is the capture. The print flow builds a .print-stage and
  // injects the @media print stylesheet, calls window.print(), then tears
  // both down in a finally. So window.print is stubbed to hold onto the
  // nodes at the exact moment the print pipeline would have seen them,
  // and they're re-attached afterwards for page.pdf(). That means the PDF
  // is rendered from the real stage and the real injected CSS - the only
  // thing being faked is the handoff to the OS print dialog, which
  // page.pdf() stands in for.
  //
  // Gated behind --smoke, and this is the block that makes that worth having:
  // page.pdf() runs a full layout and rasterisation pass in real Chrome, and
  // at three viewports it was a large fraction of the suite.
  if (inArea("print-pdf") && printToggle) {
    // The Display panel is a <details>, and the block above already
    // opened it — toggling again would close it and hide the button.
    // Tested for VISIBILITY, not existence: everything inside a closed
    // <details> stays in the DOM, so a found handle can still be hidden
    // and then time out on click.
    if (!await page.$("button:has-text('Print')").then((b) => b && b.isVisible())) {
      const summary = await page.$(".toolbar-display summary");
      if (summary) await summary.click();
      await quiet(page);
    }
    const printBtn2 = await page.$("button:has-text('Print')");
    if (printBtn2) {
      await printBtn2.click();
      await quiet(page);
      // Select two tabs, so "one page per selected tab" is distinguishable
      // from "one page, always" and from "a page per tab on the sheet".
      const boxes = await page.$$(".print-dialog__tab-checkbox");
      check(boxes.length >= 2, `the print dialog offers a per-tab checklist (${boxes.length})`);
      if (boxes.length >= 2) {
        // Default is just the active tab, so tick the rest.
        for (let i = 0; i < boxes.length; i += 1) {
          if (!(await boxes[i].isChecked())) await boxes[i].click();
        }
        let wanted = 0;
        for (const b of await page.$$(".print-dialog__tab-checkbox")) {
          if (await b.isChecked()) wanted += 1;
        }
        check(wanted >= 2, `two tabs are selected for printing (${wanted})`);

        await page.evaluate(() => {
          window.__printCapture = null;
          window.print = () => {
            const stage = document.querySelector(".print-stage");
            const style = [...document.querySelectorAll("style")].find((s) => /print-stage/.test(s.textContent || ""));
            window.__printCapture = { stage, style, pages: stage ? stage.children.length : 0 };
          };
        });
        await page.click(".print-dialog .btn--primary");
        await quiet(page);
        const captured = await page.evaluate(() => {
          const cap = window.__printCapture;
          if (!cap || !cap.stage || !cap.style) return null;
          document.body.append(cap.stage, cap.style);
          return { pages: cap.pages, filled: [...cap.stage.children].map((p) => (p.textContent || "").trim().length) };
        });
        check(!!captured, "the print flow built a stage for the pipeline");
        if (captured) {
          check(captured.pages === wanted,
            `the stage holds one page per selected tab (${captured.pages} for ${wanted})`);
          check(captured.filled.every((n) => n > 0),
            `no blank stage page (lengths ${captured.filled.join(",")})`);
          // What the print stylesheet actually does in a real browser,
          // rather than what its text claims. The media has to be
          // emulated, or getComputedStyle is reporting screen rules.
          await page.emulateMedia({ media: "print" });
          const printMedia = await page.evaluate(() => {
            const seen = (sel) => {
              const node = document.querySelector(sel);
              return node ? getComputedStyle(node).display : "(absent)";
            };
            return {
              toolbar: seen(".sheet-toolbar"),
              authArea: seen(".app-header #auth-area"),
              liveGrid: seen(".page-grid"),
              stage: seen(".print-stage"),
              stagePage: seen(".print-stage__page"),
            };
          });
          await page.emulateMedia({ media: null });
          check(printMedia.toolbar === "none" && printMedia.authArea !== "block",
            `print media hides the screen chrome (toolbar ${printMedia.toolbar}, auth ${printMedia.authArea})`);
          check(printMedia.liveGrid === "none",
            `print media swaps the live grid out (${printMedia.liveGrid})`);
          check(printMedia.stage === "block" && printMedia.stagePage === "block",
            `print media shows the print stage (${printMedia.stage}/${printMedia.stagePage})`);

          const pdfPath = path.join(shotDir, `sheet-${viewport.name}.pdf`);
          await page.pdf({ path: pdfPath, printBackground: false, preferCSSPageSize: true });
          const pdf = fs.readFileSync(pdfPath);
          // Chrome's output has one "/Type /Page" object per page (the
          // tree node is "/Type /Pages", hence the guard).
          const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
          // A floor, not an equality: a tab whose content runs past one
          // sheet legitimately spills onto the next. The failure this
          // replaces was 1 page for N tabs - the stage printing empty.
          check(pageCount >= wanted,
            `the PDF has at least one page per selected tab (${pageCount} for ${wanted})`);
          check(pdf.length > 50000,
            `the PDF carries the sheet, not an empty stage (${pdf.length} bytes)`);
        }
        await page.reload({ waitUntil: "networkidle" });
        await page.waitForTimeout(1200);
      }
    }
  }

  // User-defined shapes. The dialog flow is a name prompt, a ratio
  // prompt, and the "re-flow every tab?" confirm (a brand-new shape is
  // applied straight away, so it force-reflows) — answered from a queue
  // so they stay in step.
  //
  // Gated behind --smoke: it forces a full re-flow of every tab three times
  // over, and its failure mode is a shape that lays out oddly - found by the
  // full run, not between edits.
  if (inArea("shapes")) {
    // "Add shape" lives in the Display panel, which on a phone is one tap
    // behind "Edit layout".
    await revealBuilder();
    if (!await page.$("button:has-text('Add shape')").then((b) => b && b.isVisible())) {
      const summary = await page.$(".toolbar-display summary");
      if (summary) await summary.click();
      await quiet(page);
    }
    const addBtn = await page.$("button:has-text('Add shape')");
    check(!!addBtn && (await addBtn.isVisible()), "the shape control offers to define your own");
    if (addBtn && (await addBtn.isVisible())) {
      // Driven through the REAL dialogs, not answered as native ones. The
      // old flow was two window.prompts answered by a "dialog" handler; now
      // it is a themed prompt with an in-place validator, and typing into it
      // is the only way to check that works.
      //
      // The ratio prompt comes SECOND (name first, as before), so the
      // validator gets its own assertion below.
      const fillDialogInput = async (value) => {
        await page.waitForSelector(".app-dialog__input", { timeout: 5000 });
        await page.fill(".app-dialog__input", value);
      };
      const dialogButtons = () => page.$$(".app-dialog button");

      await addBtn.click();
      await fillDialogInput("Desk monitor");
      let buttons = await dialogButtons();
      await buttons[buttons.length - 1].click();
      await quiet(page);
      const ratioOpen = await page.$(".app-dialog__input");
      check(!!ratioOpen, "the name dialog leads to a ratio dialog");

      // The validator: a bad ratio must be refused IN PLACE, with the field
      // still there. The old flow closed the prompt, opened an alert, and
      // started the whole sequence over.
      await page.fill(".app-dialog__input", "21x9x");
      buttons = await dialogButtons();
      await buttons[buttons.length - 1].click();
      await quiet(page);
      const refused = await page.evaluate(() => {
        const err = document.querySelector(".app-dialog__error");
        return { open: !!document.querySelector(".app-dialog"), shown: !!err && !err.hidden, text: err?.textContent || "" };
      });
      check(refused.open && refused.shown, "a ratio that isn't one is refused in place");
      check(/isn't a ratio/i.test(refused.text), `the refusal says why (got "${refused.text}")`);
      await page.screenshot({ path: path.join(shotDir, `shape-bad-ratio-${viewport.name}.png`) });

      // Correct it and carry on - the field keeps what was already typed.
      await page.fill(".app-dialog__input", "21:9");
      buttons = await dialogButtons();
      await buttons[buttons.length - 1].click();
      await quiet(page);
      // Adding a shape applies it straight away, which reflows every tab and
      // therefore asks first. Click it through - the point of the check
      // below is the reflowed layout, not the question.
      const reflowAsk = await page.$(".app-dialog");
      check(!!reflowAsk, "applying a new shape asks before re-flowing every tab");
      if (reflowAsk) {
        const btns = await dialogButtons();
        await btns[btns.length - 1].click();
        await quiet(page);
      }

      const shapeOptions = () => page.evaluate(() => {
        const sel = [...document.querySelectorAll("select")].find((s) => /target screen shape/.test(s.title || ""));
        return sel ? [...sel.options].map((o) => ({ value: o.value, text: o.textContent })) : [];
      });
      const options = await shapeOptions();
      const mine = options.find((o) => o.value === "custom:desk-monitor");
      check(!!mine, `a custom shape joins the picker (${options.length} options)`);
      check(!!mine && /yours/i.test(mine.text), "a custom shape is marked as the user's own");
      check(options.some((o) => o.value === "16:9"), "the shipped shapes are still there");

      // And the sheet is actually laid out for it. Only the cell
      // coordinates are mirrored onto the DOM (gridX/gridY, for Simple
      // View's sort); the size is applied as an inline rect, so measure
      // the rendered box rather than looking for a data attribute.
      const widths = await page.evaluate(() => [...document.querySelectorAll(".grid-node")]
        .map((n) => Math.round(n.getBoundingClientRect().width))
        .filter((w) => w > 0));
      const distinct = [...new Set(widths)];
      check(widths.length > 0 && distinct.length > 1,
        `the reflowed sheet lays blocks out (${widths.length} sized, ${distinct.length} distinct widths)`);
      await page.screenshot({ path: path.join(shotDir, `custom-shape-${viewport.name}.png`) });

      const removeBtn = await page.$("button:has-text('Remove shape')");
      check(!!removeBtn && (await removeBtn.isVisible()), "a custom shape can be removed");
      if (removeBtn && (await removeBtn.isVisible())) {
        // Picking from a list of buttons, not typing an index into a prompt.
        await removeBtn.click();
        await page.waitForSelector(".app-dialog__option", { timeout: 5000 });
        const optionCount = (await page.$$(".app-dialog__option")).length;
        check(optionCount >= 1, `the remove dialog lists the shapes to choose from (${optionCount})`);
        const optionText = await page.textContent(".app-dialog__option");
        check(/Desk monitor/.test(optionText || ""), `the shape is named in the list (got "${(optionText || "").trim()}")`);
        await page.screenshot({ path: path.join(shotDir, `shape-remove-list-${viewport.name}.png`) });
        await page.click(".app-dialog__option");
        await quiet(page);
        // Which then asks for confirmation, as a separate dialog.
        const confirmOpen = await page.$(".app-dialog__box--danger");
        check(!!confirmOpen, "choosing a shape asks before deleting it");
        if (confirmOpen) {
          const dialogButtons2 = await page.$$(".app-dialog button");
          await dialogButtons2[dialogButtons2.length - 1].click();
          await quiet(page);
        }
        const after = await shapeOptions();
        check(!after.some((o) => o.value === "custom:desk-monitor"), "the removed shape leaves the picker");
        check(!(await page.$(".app-dialog")), "the delete dialog closes afterwards");
      }
    }
  }

  // Simple View overflow check at mobile viewport.
  //
  // The toggle is re-queried rather than reusing the handle from earlier:
  // the shape checks above reflow the sheet, which re-renders the toolbar
  // and leaves a captured handle detached. Clicking a detached element
  // throws and would take every later check down instead of reporting.
  if (viewport.name === "mobile") {
    // On a phone the stacked layout is already engaged by width, so the
    // toggle names the view it cannot switch to and refuses. Measuring the
    // result rather than clicking through it is what the check is FOR; the
    // desktop branch above still drives the toggle both ways.
    const already = await page.evaluate(() => {
      const grid = document.querySelector(".page-grid.is-simple");
      const btn = [...document.querySelectorAll(".sheet-toolbar button")]
        .find((b) => /^(Sheet|Simple) View$/.test(b.textContent.trim()));
      return {
        stacked: !!grid,
        overflow: grid ? { scrollWidth: grid.scrollWidth, clientWidth: grid.clientWidth } : null,
        toggle: btn ? { text: btn.textContent.trim(), disabled: btn.disabled } : null,
      };
    });
    check(already.stacked, "the phone-width sheet is stacked by width");
    check(already.toggle?.disabled === true,
      `and its view toggle refuses rather than offering a switch that does nothing (${JSON.stringify(already.toggle)})`);
    check(!already.overflow || already.overflow.scrollWidth <= already.overflow.clientWidth + 5,
      `Simple View has minimal horizontal overflow at ${viewport.width}px (scrollWidth: ${already.overflow?.scrollWidth}, clientWidth: ${already.overflow?.clientWidth}, diff: ${(already.overflow?.scrollWidth || 0) - (already.overflow?.clientWidth || 0)}px)`);
    // Back to Sheet View is only reachable on a screen that fits, so widen
    // first and then drive it - which is also the only way to reach the
    // stale-key check that follows it on a phone viewport.
    //
    // The width is put back afterwards. It used to be left at 1440, and
    // because every check below is labelled with `viewport.name` rather
    // than with the width the window actually is, the rest of the phone
    // run - the whole wizard, several hundred assertions' worth - was
    // quietly executed at desktop width while reporting "[mobile]". A
    // probe of the feat dialog showed it: identical 1354px boxes at 1440
    // and at 392.
    await page.setViewportSize({ width: 1440, height: viewport.height });
    await page.waitForTimeout(900);
    const back = await page.$(".sheet-toolbar button:text-is('Sheet View')");
    if (back) await back.click().catch(() => {});
    await quiet(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(900);
    check(await page.evaluate((w) => window.innerWidth === w, viewport.width),
      `and the phone-width run goes back to ${viewport.width}px afterwards (was ${await page.evaluate(() => window.innerWidth)}px)`);
  }

  // B: offline vault — the exact flow that once crashed new-character
  // creation (insertBefore against the wrong toolbar parent).
  await page.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
  await settled(page, READY_VAULT, `page vault`);
  const newBtn = await page.$(".vault-new__go");
  check(!!newBtn && (await newBtn.isVisible()), "vault + New Character button visible");
  // The new-character control is a name box with placeholder text, so the
  // name is typed here rather than on the wizard's first page - and it has
  // to survive the trip, or the box is decorative.
  const nameBox = await page.$(".vault-new__input");
  check(!!nameBox, "the vault's new-character name box is there");
  if (nameBox) {
    check((await nameBox.getAttribute("placeholder")) === "New Character",
      "and carries New Character as placeholder text");
    await nameBox.fill("Cinderhold");
    check((await nameBox.inputValue()) === "Cinderhold",
      "which the typed name replaces");
  }
  if (newBtn) await newBtn.click();
  await quiet(page);
  check(await page.$(".wizard"), "creator wizard renders after + New Character");
  // The typed name reached the character, so the wizard's name box opens
  // with it already filled rather than empty. That box is the sheet
  // toolbar's own input (buildNameInput), which the Identity step drives -
  // it is not inside .wizard, so it is found by its own placeholder.
  const nameOnWizard = await page.evaluate(() => {
    const box = document.querySelector('input[placeholder="Character name"]');
    return box ? box.value : "";
  });
  check(nameOnWizard === "Cinderhold",
    `the name typed on the vault is the character's name (got "${nameOnWizard}")`);
  // The one-time orientation panel is for a FINISHED character, so it must
  // NOT appear while the creation wizard is running - the wizard is itself
  // the guided first run, and a panel about display modes sitting on top of
  // it is noise about a feature nobody has reached yet.
  check(!(await page.$(".sheet-intro")), "no orientation panel over the creation wizard");
  await page.screenshot({ path: path.join(shotDir, `creator-${viewport.name}.png`) });
  // Advance one wizard step to prove the wizard is alive, not paint.
  // `:visible` because a phone now has exactly ONE Next on screen - the
  // fixed bottom bar - and the top copy is hidden by css/phone.css rather
  // than by the observer that used to hide it. `:visible` is the same
  // convention scripts/crawl.mjs already uses for its Next clicks ("the
  // button a person could actually press"), and the assertion below is
  // unchanged: Next moves the wizard.
  const nextBtn = await page.$(".wizard button:has-text('Next'):visible");
  if (nextBtn) {
    await nextBtn.click();
    await quiet(page);
    // Derived from the rendered counter, not hardcoded. The wizard is eight
    // steps long or six depending on which tabs exist, and a check that
    // fails when a step is removed is a check that discourages removing
    // one. What matters is that Next MOVED the wizard.
    const stepText = /Step 2 of \d+/.test(await page.textContent("body"));
    check(stepText, "creator wizard advances to step 2");
    await page.screenshot({ path: path.join(shotDir, `creator-step2-${viewport.name}.png`) });
  }
  // Changeling regression: picking a race with real choice groups once
  // crashed the creator (a bare categorizeChoiceGroup reference with no
  // binding). Step 2 is Identity, which lists the race rows. Its skill
  // pick renders inline in the row (summary + superscript ?) through
  // the shared choice dialog — never as a bottom section.
  const changeling = await page.$(`.choice-row[data-row-name="Changeling"]`);
  check(!!changeling, "Identity step lists Changeling");
  if (changeling) {
    await changeling.click();
    await quiet(page);
    check(await page.$(".choice-row--selected .inline-pick-link"), "Changeling choice summary is the dialog link");
    check(!((await page.$$(".level-guide__choices")).length), "no bottom choice sections for Changeling");
    // The summary opens the shared skills dialog; Escape closes it untouched.
    await page.click(".choice-row--selected .inline-pick-link");
    await quiet(page);
    check(await page.$(".choice-dialog-overlay"), "shared choice dialog opens");
    await page.screenshot({ path: path.join(shotDir, `changeling-${viewport.name}.png`) });
    await page.keyboard.press("Escape");
    await quiet(page);
    check(!(await page.$(".choice-dialog-overlay")), "shared choice dialog closes on Escape");
  }
  // High Elf regression: picking it threw
  //   TypeError: categorizeFn is not a function
  // and the whole creator died mid-click. High Elf is the only subrace in the
  // shipped data carrying its own nested choice groups (the extra language
  // and the cantrip), and the subrace row's rules renderer locks Common
  // across them. Every other subrace produced an empty group list and
  // returned before that line, which is why this survived until a user
  // happened to be an Elf.
  //
  // Driven through a real click, because the bug was a wrong function called
  // at a call site - only the browser reaches it.
  const elf = await page.$(`.choice-row[data-row-name="Elf"]`);
  check(!!elf, "Identity step lists Elf");
  if (elf) {
    await elf.click();
    await quiet(page);
    const highElf = await page.$('.choice-row[data-row-name="High Elf"]');
    check(!!highElf, "and the Elven Subrace row offers High Elf");
    if (highElf) {
      const before = problems.length;
      await highElf.click();
      await quiet(page);
      check(problems.length === before,
        `picking High Elf throws nothing (${problems.slice(before).join("; ") || "clean"})`);
      // Still interactive afterwards: the crash killed the render, so a
      // surviving page is not enough on its own.
      check(await page.$(".page-grid"), "and the creator is still rendered after it");
      const highState = await page.evaluate(() => {
        const row = document.querySelector('.choice-row--selected[data-row-name="High Elf"]')
          || document.querySelector('.choice-row[data-row-name="High Elf"]');
        return {
          selected: row?.classList.contains("choice-row--selected") || false,
          // The nested groups render inside High Elf's OWN row, as a
          // bullet list rather than as more choice rows. Assert on the row's
          // own words, which is what the player reads: the trait descriptions
          // already promise an extra language and a cantrip.
          nestedRows: [...(row?.querySelectorAll(".choice-row") || [])]
            .map((n) => n.dataset.rowName),
          text: (row?.textContent || "").replace(/\s+/g, " ").slice(0, 300),
        };
      });
      check(highState.selected, "the High Elf row reads as chosen");
      check(/Extra Language/i.test(highState.text) && /Cantrip/i.test(highState.text),
        `and it offers the extra language and the cantrip it promises (${highState.text})`);
      // The pick controls themselves, if they render as links: the cantrip
      // group's option is a spell-pick placeholder, so a real link is the
      // sign the group is wired rather than only described.
      const pickLinks = await page.evaluate(() => [...document.querySelectorAll(".inline-pick-link")]
        .map((n) => n.textContent.trim()));
      check(pickLinks.length >= 1,
        `with a pick control the player can actually use (${JSON.stringify(pickLinks)})`);
      await page.screenshot({ path: path.join(shotDir, `high-elf-${viewport.name}.png`) });
    }
  }

  // A nested row lives INSIDE its parent's expanded details - the Elven
  // Subrace list is rendered inside the Elf row. Its whole body was therefore
  // inside a subtree that stopped every click, so a subrace could only be
  // chosen by hitting the exact strip of its portrait and flavour text, and
  // nothing in its mechanics was clickable at all.
  const rowFor = (name) => `.choice-row[data-row-name="${name}"]`;
  const clickTraitLine = async (name, index = 0) => {
    const hit = await page.evaluate(([sel, i]) => {
      const row = document.querySelector(sel);
      const li = row?.querySelectorAll(".choice-row__mechanics-list > li")[i];
      if (!li) return { ok: false };
      // Scroll first: this page is taller than the viewport, so a coordinate
      // read before scrolling lands on whatever is painted at that point.
      li.scrollIntoView({ block: "center" });
      const r = li.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(x, y);
      return {
        ok: true, x, y,
        reached: !!(top && (top === li || li.contains(top))),
        topTag: top ? `${top.tagName}.${String(top.className).slice(0, 30)}` : "none",
        text: li.textContent.replace(/\s+/g, " ").trim().slice(0, 44),
        insideDetails: !!li.closest(".choice-row__details"),
      };
    }, [rowFor(name), index]);
    if (!hit.ok) return hit;
    await page.mouse.click(hit.x, hit.y);
    await quiet(page);
    return hit;
  };

  // Pick a species with a subrace list so there IS a nested row. Dwarf,
  // because Elf was already selected above and clicking it again would
  // toggle it off rather than re-expand it.
  await page.click(rowFor("Dwarf"));
  await quiet(page);
  const subraceRow = await page.evaluate(() => {
    const row = document.querySelector('.choice-row[data-row-name="Hill Dwarf"]');
    if (!row) return null;
    // The shape that matters: the subrace's trait list lives inside the
    // subrace's OWN .choice-row__details - the subtree that used to swallow
    // every click, which is why only the portrait/flavour strip above it
    // would take one.
    const traits = row.querySelector(".choice-row__mechanics-list");
    return {
      nested: row.classList.contains("choice-row--nested"),
      traitsInsideOwnDetails: !!traits?.closest(".choice-row__details"),
      traits: row.querySelectorAll(".choice-row__mechanics-list > li").length,
    };
  });
  check(subraceRow?.traitsInsideOwnDetails === true,
    `a subrace's trait list sits inside the details subtree that used to eat clicks (got ${JSON.stringify(subraceRow)})`);
  check(subraceRow?.traits > 0,
    `and it has trait lines of its own to click (${subraceRow?.traits})`);

  // A row's lower half must select it once it is expanded.
  //
  // This is what the picker table's own "Expand All" sets up: it opens every
  // row's details, and the details element used to stop every click that
  // reached it, so after expanding, only the portrait-and-flavour strip above
  // would take a click and the mechanics below it - which is most of what the
  // row shows - did nothing.
  //
  // There are two "Expand All" buttons on this page (this one, and the one
  // for the "Your choices" sections), so it is found as the one whose list it
  // controls rather than by text.
  const pickerExpandAll = await page.evaluateHandle(() => {
    const list = document.querySelector(".choice-row-list");
    const scope = list?.parentElement;
    return [...(scope?.querySelectorAll("button.btn") || [])]
      .find((b) => b.textContent.trim() === "Expand All") || null;
  });
  check(!!pickerExpandAll, "the picker table has its own Expand All");
  if (pickerExpandAll.asElement()) {
    await pickerExpandAll.asElement().click();
    await quiet(page);
  }
  const expandedNow = await page.evaluate(() => {
    const row = document.querySelector('.choice-row[data-row-name="Hill Dwarf"]');
    const d = row?.querySelector(".choice-row__details");
    return { hidden: d?.hidden, traits: row?.querySelectorAll(".choice-row__mechanics-list > li").length || 0 };
  });
  check(expandedNow.hidden === false && expandedNow.traits > 0,
    `after Expand All the subrace's traits are visible and clickable (${JSON.stringify(expandedNow)})`);

  // Hill Dwarf is not selected at this point (Elf and High Elf are), so
  // clicking its trait line is an observable change with no intervening
  // click to disturb the expansion state.
  const highHit = await clickTraitLine("Hill Dwarf", 0);
  check(highHit.ok, `a Hill Dwarf trait line is there to click ("${highHit.text || ""}")`);
  check(highHit.reached,
    `and the click lands on it rather than something painted over it (topmost was ${highHit.topTag})`);
  const highPicked = await page.evaluate(() =>
    document.querySelector('.choice-row[data-row-name="Hill Dwarf"]')?.getAttribute("aria-pressed"));
  check(highPicked === "true",
    `clicking a trait line selects the row (aria-pressed=${highPicked})`);

  // And the controls inside those lines must still work - that is what the
  // original stopPropagation was for, so a regression here would be as bad as
  // the bug being fixed.
  //
  // This used to be asserted on the Hill Dwarf row, where the only <a> it
  // contained was the "Light" in "Light Hammer" wrongly linked to the Light
  // cantrip - so the check passed FOR THE WRONG REASON, and removing that
  // false positive failed it. It is now two checks: the rows that genuinely
  // offer a pick control still offer one inside their details (which is what
  // the click handling is for), and the Hill Dwarf's proficiency line links
  // nothing at all (which is the bug).
  const controlStillWorks = await page.evaluate(() => {
    const withControls = [...document.querySelectorAll(".choice-row[data-row-name]")]
      .filter((r) => !r.classList.contains("choice-row--nested"))
      .map((r) => ({
        name: r.dataset.rowName,
        links: r.querySelectorAll(".choice-row__details a").length,
        selects: r.querySelectorAll(".choice-row__details select").length,
      }))
      .filter((r) => r.links || r.selects);
    const hillDwarf = document.querySelector('.choice-row[data-row-name="Hill Dwarf"]');
    return {
      rowsWithControls: withControls.length,
      sample: withControls.slice(0, 3),
      hillDwarfSpellLinks: [...(hillDwarf?.querySelectorAll(".choice-row__mechanics-list .spell-link") || [])]
        .map((a) => a.dataset.spell || a.textContent.trim()),
      hillDwarfText: (hillDwarf?.querySelector(".choice-row__mechanics-list")?.textContent || "")
        .replace(/\s+/g, " ").trim(),
    };
  });
  check(controlStillWorks.rowsWithControls > 0,
    `and the pick controls inside the details are still present (${controlStillWorks.rowsWithControls} rows offer one, e.g. ${JSON.stringify(controlStillWorks.sample)})`);
  check(controlStillWorks.hillDwarfSpellLinks.length === 0,
    `while a proficiency line links no spell (${JSON.stringify(controlStillWorks.hillDwarfSpellLinks)})`);
  check(/Light Hammer/.test(controlStillWorks.hillDwarfText),
    `and still says what it means (${JSON.stringify(controlStillWorks.hillDwarfText.slice(0, 90))})`);

  // Languages: the picker splits into Widespread / Rare, and the headings
  // cannot be picked. Languages appear as a native <optgroup> inside the
  // inline dropdown (checked here, against the High Elf's extra-language
  // slot) and as headings inside the choice dialog wherever a language group
  // opens one instead - that second shape is covered directly by smoke-dom,
  // because no row on this step happens to route a language group through it.
  await page.click(rowFor("Elf"));
  await quiet(page);
  await page.click(rowFor("High Elf"));
  await quiet(page);

  const dropdownSplit = await page.evaluate(() => {
    for (const sel of document.querySelectorAll("select")) {
      const groups = [...sel.querySelectorAll("optgroup")];
      if (groups.length) {
        return {
          // Per-group, so "Widespread runs Dwarvish..Orc" can actually fail
          // - flattened values cannot distinguish the two bands.
          groups: groups.map((g) => ({
            label: g.label,
            values: [...g.querySelectorAll("option")].map((o) => o.value),
          })),
          bare: [...sel.querySelectorAll(":scope > option")].map((o) => o.value),
        };
      }
    }
    return null;
  });
  check(!!dropdownSplit, "a language dropdown carrying headings is rendered");
  if (dropdownSplit) {
    check(dropdownSplit.groups.map((g) => g.label).join("|") === "Widespread|Rare",
      `the language list is split into Widespread then Rare (${JSON.stringify(dropdownSplit.groups.map((g) => g.label))})`);
    const widespread = dropdownSplit.groups.find((g) => g.label === "Widespread")?.values || [];
    const rare = dropdownSplit.groups.find((g) => g.label === "Rare")?.values || [];
    check(widespread.includes("Dwarvish") && widespread.includes("Orc"),
      `Widespread runs Dwarvish..Orc (${widespread.join(", ")})`);
    check(rare.includes("Abyssal") && rare.includes("Undercommon") && !rare.includes("Common"),
      `Rare holds the rest, and not Common (${rare.join(", ")})`);
    // The headings are OPTGROUPs, so the native picker shows them and cannot
    // let one be chosen - asserted as "not offered as a pickable value".
    check(!dropdownSplit.bare.includes("Widespread") && !dropdownSplit.bare.includes("Rare"),
      `and the headings are not themselves pickable values (bare: ${JSON.stringify(dropdownSplit.bare)})`);
    const all = [...widespread, ...rare];
    check(new Set(all).size === all.length && all.length > 0,
      `with no language offered twice (${all.length} entries)`);
  }

  // Custom Lineage regression: the "Feat — Gain 1 feat(s) of your
  // choice." mention is a link opening the feats picker (same shared
  // table as proficiencies), and the Racial feat control sits on Identity.
  const lineage = await page.$(`.choice-row[data-row-name="Custom Lineage"]`);
  check(!!lineage, "Identity step lists Custom Lineage");
  if (lineage) {
    await lineage.click();
    await quiet(page);
    const featLink = await page.$(".choice-row--selected .inline-pick-link");
    const featText = featLink ? await featLink.textContent() : "";
    check(!!featLink && /choose a feat/i.test(featText || ""), "lineage feat mention is the picker link");
    check((await page.textContent("body")).includes("Racial feat"), "Racial feat picker sits on Identity");

    // The feats must NOT also be listed as rows at the bottom of the
    // step. Identity used to call renderPickerRows with the whole feat
    // list as well, so the same 83 feats appeared twice: once in the
    // dialog and once as a five-figure-pixel block of rows under the
    // wizard. The dialog is the picker; there is one handle on it.
    //
    // Asserted structurally - the Identity step's only row list is the 15
    // ancestries. Matching on a list of expected race NAMES was the first
    // attempt and it reported three false failures, because maintaining an
    // allowlist of every ancestry couples this test to content it is not
    // about. "No list longer than the ancestries" states the actual defect.
    const rowLists = await page.evaluate(() =>
      [...document.querySelectorAll(".choice-row-list")].map((l) => l.querySelectorAll(".choice-row").length));
    check(rowLists.length === 1 && rowLists[0] <= 20,
      `Identity lists only the ancestries, no feat list below (row lists: ${JSON.stringify(rowLists)})`);

    if (featLink) {
      await featLink.click();
      await quiet(page);
      const featDlg = await page.$(".choice-dialog-overlay");
      check(!!featDlg, "feat picker dialog opens from lineage link");
      if (featDlg) {
        check(/alert/i.test((await featDlg.textContent()) || ""), "feat picker lists feats as a table");
        // 83 feats need the room. The width is capped by `.modal-box
        // { max-width: 420px }` in another stylesheet, so a one-class
        // override silently loses on file order - the override has to be
        // compound, and this asserts the rendered result rather than the
        // rule, so a reordering of the CSS cannot quietly undo it.
        //
        // The expected share of the screen is the CSS's own contract, and
        // the contract is about the SCREEN, not about a fixed pixel width:
        // above the phone ceiling the dialog takes 94vw; below it, it falls
        // back to the shared 560px box, which on a phone is the whole
        // screen anyway. The old rule keyed off 1100px, which is where the
        // MULTI-COLUMN list starts - a question about how much room a column
        // needs, not how wide the screen is. Reading the wrong one of those
        // two numbers gave a tablet 560px of 834 (67%) while a phone had
        // 392 of 392, i.e. the widest screen in the set got the least.
        const dlgWidth = await page.evaluate(() => {
          const box = document.querySelector(".choice-dialog-overlay .choice-dialog");
          return box ? { w: box.getBoundingClientRect().width, vw: window.innerWidth } : null;
        });
        if (dlgWidth) {
          const pct = dlgWidth.w / dlgWidth.vw;
          const wide = dlgWidth.vw > PHONE_CEILING_PX;
          check(pct >= (wide ? 0.9 : 0.85),
            `feat picker uses the screen it is on (${Math.round(dlgWidth.w)}px = ${Math.round(pct * 100)}% of ${dlgWidth.vw}, wanted ${wide ? "90%+" : "85%+"})`);
        }
        await page.screenshot({ path: path.join(shotDir, `lineage-feat-${viewport.name}.png`) });
      }
      await page.keyboard.press("Escape");
      await quiet(page);
      check(!(await page.$(".choice-dialog-overlay")), "feat picker closes on Escape");
    }

    // The compact Racial feat row opens the same dialog, and a pick made
    // there is recorded (this is the control that replaced the 83 rows).
    const compact = await page.evaluate(() => {
      const row = [...document.querySelectorAll(".choice-row")]
        .find((r) => /ancestry grants a feat/i.test(r.textContent || ""));
      if (!row) return null;
      row.click();
      return (row.querySelector(".choice-row__label")?.textContent || "").trim();
    });
    check(compact !== null, "Racial feat row is a single control, not a list");
    if (compact !== null) {
      await page.waitForTimeout(500);
      const viaRow = await page.$(".choice-dialog-overlay");
      check(!!viaRow, "Racial feat row opens the feat picker");
      if (viaRow) {
        await page.evaluate(() => {
          const opt = [...document.querySelectorAll(".choice-dialog-option")]
            .find((o) => (o.querySelector("span")?.textContent || "").trim() === "Alert");
          opt?.querySelector("input")?.click();
        });
        await page.waitForTimeout(200);
        await page.click(".choice-dialog .btn--primary");
        await quiet(page);
        const nowLabel = await page.evaluate(() => {
          const row = [...document.querySelectorAll(".choice-row")]
            .find((r) => /ancestry grants a feat|Racial feat/i.test(r.textContent || ""));
          return (row?.querySelector(".choice-row__label")?.textContent || "").trim();
        });
        check(nowLabel === "Alert", `Racial feat row records the pick (shows "${nowLabel}")`);
      }
    }

    // Flexible ASI: two dropdowns ("+2 to" / "+1 to") listing all six
    // abilities. This replaced a two-step pattern dialog, and before that
    // the row opened the GENERIC dialog, which lists only options with a
    // `name` — a flexible ASI's options are {pattern, description}
    // descriptors, so it opened EMPTY and the player saw no stats at all.
    const asiSlots = '.choice-row--selected .mechanics-pick select[data-inline-slot$="custom-lineage-flexible-asi#0"], .choice-row--selected .mechanics-pick select[data-inline-slot$="custom-lineage-flexible-asi#1"]';
    const asiState = () => page.evaluate(() => {
      const row = document.querySelector(".choice-row--selected");
      const li = [...row.querySelectorAll(".mechanics-pick")]
        .find((b) => /Ability Score/i.test(b.querySelector("strong")?.textContent || ""));
      if (!li) return { found: false };
      const sels = [...li.querySelectorAll("select")];
      return {
        found: true,
        prefixes: sels.map((s) => s.previousElementSibling?.classList.contains("inline-pick-slot-prefix")
          ? s.previousElementSibling.textContent : null),
        optionLabels: sels.map((s) => [...s.options].slice(1).map((o) => o.textContent)),
        hasDialogLink: !!li.querySelector(".inline-pick-link"),
      };
    });
    const asi = await asiState();
    check(asi.found, "lineage has an Ability Score Increase row");
    // The amounts are now in the sentence in front of each dropdown, not in
    // the placeholder. A placeholder is replaced by the chosen value, so
    // putting "+2" there meant the number disappeared the instant the player
    // chose an ability and the line stopped saying which was the +2.
    check(asi.prefixes?.join("").includes("+2") && asi.prefixes?.join("").includes("+1"),
      `the +2 and +1 are stated before their dropdowns (got ${JSON.stringify(asi.prefixes)})`);
    const six = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];
    check(six.every((a) => asi.optionLabels?.[0]?.includes(a)) && six.every((a) => asi.optionLabels?.[1]?.includes(a)),
      "both ASI dropdowns list all six abilities");
    check(!asi.hasDialogLink, "ASI is dropdowns, not a dialog link");
    if (asi.found) {
      await page.selectOption(asiSlots.split(", ")[0], "str");
      await quiet(page);
      await page.selectOption(asiSlots.split(", ")[1], "con");
      await quiet(page);
      const picked = await page.evaluate(() => {
        const row = document.querySelector(".choice-row--selected");
        const li = [...row.querySelectorAll(".mechanics-pick")]
          .find((b) => /Ability Score/i.test(b.querySelector("strong")?.textContent || ""));
        const sels = [...li.querySelectorAll("select")];
        return {
          plus2: sels[0]?.value,
          plus1: sels[1]?.value,
          strDisabledInSecond: [...(sels[1]?.options || [])].find((o) => o.value === "str")?.disabled,
          // The whole point of the fix: after choosing, does the line still
          // say which is the +2?
          prefixesStillThere: [...li.querySelectorAll(".inline-pick-slot-prefix")].map((n) => n.textContent),
        };
      });
      check(picked.plus2 === "str" && picked.plus1 === "con", `both ASI dropdowns keep their pick (got ${picked.plus2}/${picked.plus1})`);
      check(picked.strDisabledInSecond === true, "the +1 dropdown greys out the score already used by +2");
      check(picked.prefixesStillThere.length === 2
        && /\+2/.test(picked.prefixesStillThere[0]) && /\+1/.test(picked.prefixesStillThere[1]),
        `the amounts survive the choice (got ${JSON.stringify(picked.prefixesStillThere)})`);
      // A <select> reports every option in textContent, so this reads the
      // visible sentence only: prefixes plus each control's current value.
      const readLine = await page.evaluate(() => {
        const row = document.querySelector(".choice-row--selected");
        const li = [...row.querySelectorAll(".mechanics-pick")]
          .find((b) => /Ability Score/i.test(b.querySelector("strong")?.textContent || ""));
        const parts = [];
        for (const node of li.childNodes) {
          if (node.nodeType === 3) { parts.push(node.textContent); continue; }
          if (node.tagName === "SELECT") {
            parts.push(node.selectedOptions[0]?.textContent || "");
            continue;
          }
          if (node.classList?.contains("inline-pick-slot-prefix")) parts.push(node.textContent);
        }
        return parts.join("").replace(/\s+/g, " ").trim();
      });
      // The leading "— " is the separator renderLiveBulletItem puts after the
      // bold topic, so the sentence under test starts after it.
      check(readLine === "— +2 to Strength, +1 to Constitution",
        `so the line reads as "+2 to Strength, +1 to Constitution" (got "${readLine}")`);

      // The close-then-reopen bug. A pick re-renders the page, and the old
      // <select> is destroyed; focusing its replacement reopened the native
      // picker on touch. So a tap on a dropdown closed the list and opened it
      // straight back up - and since the value was already set, choosing the
      // SAME option again fired no change event at all, which is why the
      // second tap stayed closed and only a different choice reopened it.
      //
      // Measurable in a headless browser as focus: if the replacement control
      // is focused, a real touch device will open its picker.
      const focusAfterPick = async (slot) => page.evaluate((key) => {
        const row = document.querySelector(".choice-row--selected");
        const li = [...row.querySelectorAll(".mechanics-pick")]
          .find((b) => /Ability Score/i.test(b.querySelector("strong")?.textContent || ""));
        const sels = [...li.querySelectorAll("select")];
        const target = sels[Number(key)];
        return {
          // Still in the document at all - the re-render replaced it, and a
          // stale reference would make this read as focused when it is not.
          connected: document.contains(target),
          isActive: document.activeElement === target,
        };
      }, slot);

      const focusAfterFirst = await focusAfterPick(0);
      check(focusAfterFirst.connected, "the re-render left a live dropdown behind");
      check(focusAfterFirst.isActive === false,
        "and it is NOT focused after a tap, so a touch device leaves the picker closed");

      // Choosing a different value must not change that. This is the "if I
      // make a different choice, then the dropdown will again reopen" half.
      await page.selectOption(asiSlots.split(", ")[0], "dex");
      await quiet(page);
      const focusAfterSecond = await focusAfterPick(0);
      check(focusAfterSecond.isActive === false,
        `nor after choosing a different option (focused: ${focusAfterSecond.isActive})`);
      const retyped = await page.evaluate(() => {
        const row = document.querySelector(".choice-row--selected");
        const li = [...row.querySelectorAll(".mechanics-pick")]
          .find((b) => /Ability Score/i.test(b.querySelector("strong")?.textContent || ""));
        return [...li.querySelectorAll("select")].map((s) => s.value).join("/");
      });
      check(retyped === "dex/con", `and the changed pick took (got "${retyped}")`);
      await page.screenshot({ path: path.join(shotDir, `lineage-asi-${viewport.name}.png`) });
    }

    // Custom Lineage's "Skill Proficiency" trait needs a follow-up row to
    // actually choose the skill, and it must only appear once that trait
    // is picked — not for someone who took Darkvision.
    const traitTopics = () => page.evaluate(() => [...document.querySelectorAll(".choice-row--selected .mechanics-pick")]
      .map((b) => b.querySelector("strong")?.textContent?.trim()).filter(Boolean));
    check(!(await traitTopics()).includes("Skill Proficiency"), "no skill row before the trait is chosen");
    const traitSelect = '.choice-row--selected select[data-inline-slot$="custom-lineage-variable_trait"]';
    if (await page.$(traitSelect)) {
      await page.selectOption(traitSelect, "custom-lineage-variable_trait-skill_proficiency");
      await quiet(page);
      const afterSkill = await traitTopics();
      check(afterSkill.includes("Skill Proficiency"), "choosing the trait adds the skill row");
      check(afterSkill.indexOf("Skill Proficiency") === afterSkill.indexOf("Variable Trait") + 1,
        "the skill row sits directly beneath the trait");
      await page.screenshot({ path: path.join(shotDir, `lineage-skill-${viewport.name}.png`) });
    } else {
      check(false, "the Variable Trait dropdown is present");
    }

    // An expanded row shows the choices THAT row offers, even when the
    // row isn't the selected race. Human's only group is its extra
    // language, so it's the cleanest probe: before this, profileSectionsFor
    // returned the static preview for anything but state.species, so
    // expanding an unselected row showed no picks at all.
    const expandAll = await page.$(".choice-row-list__collapse-controls button:text-matches('Expand All')");
    check(!!expandAll, "Identity step has an Expand All control");
    if (expandAll) {
      await expandAll.click();
      await quiet(page);
      const humanRow = '.choice-row[data-row-name="Human"]';
      // The slot key is fully qualified: creation:Race:Human:human-languages#0
      const humanSel = `${humanRow} select[data-inline-slot*="human-languages"]`;
      check(!!(await page.$(humanSel)), "an unselected expanded row shows its own picks");
      check(!(await page.$(`${humanRow}.choice-row--selected`)), "that row is still unselected");
      await page.screenshot({ path: path.join(shotDir, `identity-expand-all-${viewport.name}.png`) });
    }

    // Clicking a row re-renders the sheet, which used to leave the page
    // scrolled somewhere else entirely. The "before" reading has to be
    // taken inside the page at click time: Playwright scrolls the target
    // into view before dispatching, so anything sampled earlier would be
    // measuring the harness, not the sheet.
    const dragonborn = await page.$('.choice-row[data-row-name="Dragonborn"]');
    if (dragonborn) {
      await page.evaluate(() => {
        window.__scrollAtClick = null;
        document.addEventListener("click", () => { window.__scrollAtClick = window.scrollY; }, { capture: true, once: true });
      });
      await dragonborn.click();
      await quiet(page);
      const scrollDelta = await page.evaluate(() => (window.__scrollAtClick ?? window.scrollY) - window.scrollY);
      check(Math.abs(scrollDelta) < 4, `clicking a picker row does not move the page (delta ${scrollDelta})`);
    }

    // A spell named in a race trait links to that spell's entry. Tiefling
    // is the probe: its Infernal Legacy names Thaumaturgy, Hellish Rebuke
    // and Darkness in one sentence, and this is where a character reads it.
    await (await page.$('.choice-row[data-row-name="Tiefling"]')).click();
    await quiet(page);
    // Scoped to the Tiefling row: the invariant under test is that a
    // spell link's click doesn't also land on the row containing it, so
    // the row has to be the one that was already selected.
    const tieflingRow = '.choice-row[data-row-name="Tiefling"]';
    // Click the label, not the row's centre: an expanded row is taller
    // than the viewport and its middle is prose, which is exactly where
    // the spell links are. Clicking the row's own centre would test a
    // spell link, not the row.
    //
    // Toggled to a known state rather than clicked once and assumed: the
    // row's click is a toggle (select, or collapse+deselect), and Expand
    // All already left it expanded, so a single click means different
    // things depending on what ran before it.
    const tieflingSelected = () => page.$(`${tieflingRow}.choice-row--selected`).then(Boolean);
    for (let i = 0; i < 3 && !(await tieflingSelected()); i += 1) {
      await page.click(`${tieflingRow} .choice-row__label`);
      await quiet(page);
    }
    check(await tieflingSelected(), "a row can be selected by clicking its label");
    // Infernal Legacy is the probe. Only its cantrip reaches the sheet
    // (the rest of the trait is a per-level unlock the sheet doesn't
    // render as prose), so this is one link, not three.
    const spellLinks = await page.$$(`${tieflingRow} .spell-link`);
    check(spellLinks.length >= 1, `a race trait links its spells (${spellLinks.length} links)`);
    if (spellLinks.length) {
      const first = spellLinks[0];
      const spellName = await first.getAttribute("data-spell");
      check(!!spellName, `a spell link names its spell (${spellName})`);
      check(/click/i.test((await first.getAttribute("title")) || ""), "a spell link says what clicking does");
      await first.click();
      await quiet(page);
      const dialog = await page.$(".spell-detail");
      check(!!dialog, "clicking a spell mention opens the spell entry");
      if (dialog) {
        const shown = (await dialog.textContent()) || "";
        check(!!spellName && shown.includes(spellName), "the entry is for the spell that was clicked");
        check(/·/.test(shown), "the entry shows the spell's stat line");
        check(await page.$(`${tieflingRow}.choice-row--selected`),
          "clicking a spell link doesn't collapse or re-select the row it sits in");
        await page.screenshot({ path: path.join(shotDir, `spell-entry-${viewport.name}.png`) });
        await page.keyboard.press("Escape");
        await quiet(page);
        check(!(await page.$(".spell-detail")), "the spell entry closes on Escape");
        check(await page.$(`${tieflingRow}.choice-row--selected`), "the row is still selected after the entry closes");
      }
    }

    // A race's granted spells, filtered to the level in hand. The tiefling
    // is the probe: Thaumaturgy at 1, Hellish Rebuke at 3, Darkness at 5.
    // The creator starts at level 1, so the two later spells must be
    // absent here - which is the point of filtering rather than printing
    // the trait's prose. (The bullet renders "Topic: detail" as
    // "Topic — detail", so the line is compared in that shape.)
    const spellsOnTiefling = async () => {
      for (let i = 0; i < 3 && !(await tieflingSelected()); i += 1) {
        await page.click(`${tieflingRow} .choice-row__label`);
        await quiet(page);
      }
      return page.evaluate((rowSel) => {
        const row = document.querySelector(rowSel);
        const heads = [...(row?.querySelectorAll(".choice-row__mechanics-title") || [])];
        // Granted spells are a LINE of the Innate Abilities list, not a
        // heading of their own any more: a race that granted Perception
        // and Misty Step was making the player hunt across three headings
        // for one trait. So read the bullet out of that list.
        const idx = heads.findIndex((h) => h.textContent === "Innate Abilities");
        if (idx === -1) return null;
        const items = [...(heads[idx].nextElementSibling?.querySelectorAll("li") || [])];
        return (items.find((li) => li.textContent.startsWith("Spells"))?.textContent || "").trim();
      }, tieflingRow);
    };
    check(await spellsOnTiefling() === "Spells — Thaumaturgy", "a level-1 tiefling sees only its cantrip");

    // The level control is on this same step (Identity opens with
    // Character Name and Starting Level), so proving the filter is
    // dynamic is just: raise it, look again, lower it, look again.
    const setLevel = async (value) => {
      const input = await page.$('label:has-text("Starting Level") input[type="number"]');
      if (!input) return false;
      await input.fill(String(value));
      await input.dispatchEvent("change");
      await page.waitForTimeout(800);
      return true;
    };
    if (await setLevel(5)) {
      const at5 = await spellsOnTiefling();
      check(/Hellish Rebuke/.test(at5 || "") && /Darkness/.test(at5 || ""),
        `the same row gains its higher-level spells as the level rises (got ${at5})`);
      if (await setLevel(1)) {
        check(await spellsOnTiefling() === "Spells — Thaumaturgy", "and loses them again when the level drops");
      }
    } else {
      check(false, "the wizard's Starting Level control is reachable");
    }
  }

  // --- Display preferences on a FINISHED character -------------------------
  //
  // Simple View and the one-time orientation panel both behave differently
  // once setup is done, and both need to SURVIVE a reload to be worth
  // anything. That cannot be checked on the demo page: the demo store
  // rebuilds its character from scratch on every load and only logs what it
  // would have saved, so a reload there proves nothing about persistence by
  // construction. The offline store is real localStorage, so this seeds a
  // finished character into it and drives the actual sheet.
  const seedFinished = async (patch) => {
    await page.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
    // Patch a character the APP created rather than writing one from scratch:
    // a hand-written document has to guess at every derived field, and a
    // probe that fails because its fixture was wrong tells you nothing.
    const ok = await page.evaluate((extra) => {
      const KEY = "grimoire.local.characters.v1";
      const stored = JSON.parse(localStorage.getItem(KEY) || "{}");
      const ids = Object.keys(stored);
      if (ids.length === 0) return { ok: false, reason: "no stored characters" };
      // Newest first: the character made by "+ New Character" above is the
      // one with a full layout and tabs, and any probe character would be
      // a bare shell.
      const target = ids[ids.length - 1];
      stored[target] = { ...stored[target], ...extra };
      localStorage.setItem(KEY, JSON.stringify(stored));
      return { ok: true, id: target, name: stored[target].name };
    }, patch);
    check(ok.ok, `finished-character fixture is patchable (${ok.reason || ok.id})`);
    if (!ok.ok) return null;
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const selector = `.character-card:has-text("${ok.name || "Unnamed"}")`;
    if (await page.$(selector)) await page.click(selector);
    await quiet(page);
    return ok;
  };

  const probe = await seedFinished({ simpleView: false, sawIntro: false, setupComplete: true });
  if (probe) {
  const reopenSheet = async () => {
    // goto, not reload: these fixtures write localStorage and then come
    // here, and a reload gives the app's own debounced persist() a window
    // to flush its in-memory state over the top of what was just written
    // (which silently un-set a patched Level). Navigating tears the app
    // down without offering it that chance.
    await page.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
    await settled(page, READY_VAULT, `page vault`);
    const sel = `.character-card:has-text("${probe.name || "Unnamed"}")`;
    if (await page.$(sel)) await page.click(sel);
    await quiet(page);
  };
  check(await page.$(".page-grid"), "a finished character opens its sheet");

  // --- The spell listing's prepared chrome -------------------------------
  //
  // Driven through real clicks on real rows. The class and the spells are
  // put on the character through the app's own storage shape, because
  // building a wizard to a Cleric through the UI would test the wizard.
  const setUpWizard = async (patch) => {
    await page.evaluate((extra) => {
      const KEY = "grimoire.local.characters.v1";
      const stored = JSON.parse(localStorage.getItem(KEY) || "{}");
      const id = Object.keys(stored)[0];
      stored[id].rules = { ...(stored[id].rules || {}), ...extra.rules };
      if (extra.spells) {
        const tab = stored[id].sheetTabs[0];
        const field = tab.layout.flatMap((b) => b.children || []).find((f) => f.id === "spellsKnown")
          || tab.layout.flatMap((b) => b.children || []).find((f) => /spell/i.test(f.label || ""));
        if (field) field.items = extra.spells;
        // Reset the prepared list too, or each fixture inherits the previous
        // one's preparations and a counter reads a number nobody set up.
        if (field && extra.clearPrepared !== false) field.preparedItems = [];
      }
      localStorage.setItem(KEY, JSON.stringify(stored));
    }, patch);
    await reopenSheet();
  };

  /** Click something on the sheet the way a player would: bring it into
   *  view FIRST, then prove it is actually the topmost thing at its own
   *  centre, then click that point.
   *
   *  The scroll matters because the sheet is a viewport-sized grid, not a
   *  scrolling list - Playwright's own "scroll into view" cannot move the
   *  canvas, so a control below the fold reports its pre-scroll position and
   *  the click lands on whatever block happens to be painted there. The
   *  hit-test assertion matters because a JS-dispatched click would succeed
   *  even if the control were permanently covered. */
  const clickOnSheet = async (selector) => {
    // Measure the element's box until it stops MOVING, then click that box.
    //
    // The obvious version - scroll into view, measure once, click - is wrong,
    // and wrong in a way that cannot fail loudly. Between the measuring
    // `evaluate` and the `mouse.click`, the sheet's debounced renderAll() can
    // fire and move or replace the row. The click then lands at stale
    // coordinates, on whatever is now there, or on nothing. No exception, and
    // the hit test does not catch it because the hit test ran against the
    // pre-move layout.
    //
    // That is what made the prepared-spells block the suite's one reliably
    // flaky section: a toggle click would silently miss, the assertion would
    // read a count of one where two were asked for, and WHICH assertion failed
    // varied per run because it depended on which click happened to miss.
    //
    // So the box is required to be identical across two consecutive samples
    // before the click is issued. That costs ~50ms on a settled sheet and
    // removes the whole class.
    let found = null;
    let previousBox = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      found = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { ok: false, reason: "not found" };
        el.scrollIntoView({ block: "center", inline: "nearest" });
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.left + r.width / 2);
        const cy = Math.round(r.top + r.height / 2);
        const top = document.elementFromPoint(cx, cy);
        return {
          ok: true,
          hittable: !!(top && (top === el || el.contains(top))),
          coveredBy: top && !(top === el || el.contains(top)) ? `${top.tagName}.${String(top.className).slice(0, 40)}` : null,
          cx, cy,
          box: `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`,
        };
      }, selector);
      if (!found.ok) return found;
      if (found.box === previousBox) break;
      previousBox = found.box;
      await page.waitForTimeout(50);
    }
    if (!found.ok) return found;
    if (!found.hittable) return found;
    await page.mouse.click(found.cx, found.cy);
    return found;
  };

  // --- The Level Up entry point ------------------------------------------
  //
  // Driven through real clicks on the real toolbar button. The fixture
  // patches the SHEET's Level field and Class dropdown rather than
  // rules.level/rules.className: those are a separate copy of the same
  // facts, and the button and the walkthrough both read the sheet.
  // (Walking a creation wizard to a Fighter here would be testing the
  // wizard, not the button.)
  /** Opens the Leveling tab the way a player would — by clicking it. The
   *  sheet remembers whichever tab was last open, so a probe that assumed
   *  the Leveling tab was showing would be asserting about a tab that may
   *  not be the one on screen. */
  const openLevelingTab = async () => {
    const tab = await page.evaluateHandle(() => [...document.querySelectorAll(".sheet-tab")]
      .find((t) => t.textContent.trim() === "Leveling"));
    const el = tab.asElement();
    if (el) {
      await el.click().catch(() => {});
      await quiet(page);
    }
  };

  /** Picks a value in one of the sheet's own dropdowns, found by its label.
   *  Through the control, not by writing a choice id into storage: the app
   *  regenerates choice ids on load, so a patched id matches nothing by the
   *  time it renders. Switches to the first tab first — the Class/Subclass
   *  pickers live on the sheet's own tab, not on Leveling, and a dropdown
   *  that isn't on screen simply isn't there to pick from. */
  const pickDropdown = async (label, value) => {
    const main = await page.evaluateHandle(() => [...document.querySelectorAll(".sheet-tab")]
      .find((t) => t.textContent.trim() !== "Leveling"));
    const mainEl = main.asElement();
    if (mainEl) {
      await mainEl.click().catch(() => {});
      await quiet(page);
    }
    const handle = await page.evaluateHandle((l) => [...document.querySelectorAll(".grid-node--field")]
      .find((n) => n.querySelector(".field-label")?.textContent?.trim() === l)
      ?.querySelector("select.field-value--dropdown"), label);
    const el = handle.asElement();
    if (!el) return false;
    await el.selectOption({ label: value }).catch(() => {});
    await quiet(page);
    return true;
  };

  /** Walks the level-up walkthrough from wherever it is to the Review
   *  page, filling whatever each page still needs, and returns the title of
   *  the page it stopped on.
   *
   *  Deliberately driven through the rendered controls rather than by
   *  writing pending state into storage: the thing under test is that the
   *  walkthrough TAKES the outstanding level, and poking its state directly
   *  would leave the very ordering this checks untouched. Feat picking is
   *  avoided because it opens a dialog; the ASI is taken as +2 to a score
   *  instead, which is the same step without the modal. */
  const walkWizardToReview = async () => {
    let lastTitle = null;
    let sameTitleRounds = 0;
    let last = null;
    for (let guard = 0; guard < 20; guard++) {
      const state = await page.evaluate(() => {
        const wizard = document.querySelector(".wizard");
        if (!wizard) {
          return {
            gone: true,
            onLeveling: !!document.querySelector(".page-grid--leveling"),
            gridText: (document.querySelector(".page-grid")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160),
          };
        }
        const activeDot = [...wizard.querySelectorAll(".wizard__dot")]
          .find((d) => d.classList.contains("wizard__dot--active"));
        const body = wizard.querySelector(".wizard__body");
        const selects = [...(body?.querySelectorAll("select.input-group__control") || [])];
        const apply = [...wizard.querySelectorAll("button")].find((b) => /^Apply Level/.test(b.textContent.trim()));
        const next = wizard.querySelector(".wizard__nav:not(.wizard__nav--top) .wizard__next");
        return {
          title: activeDot ? activeDot.textContent.trim() : null,
          atReview: !!apply,
          applyText: apply ? apply.textContent.trim() : null,
          // The ASI step defaults to "took a feat instead"; +2 to one score
          // is the same step with no dialog to dismiss.
          asiIsFeat: selects.length > 0 && selects[0].value === "feat",
          emptySelects: selects.filter((s) => !s.value).length,
          emptyNumbers: [...(body?.querySelectorAll('input[type="number"]') || [])].filter((i) => !i.value).length,
          emptyTexts: [...(body?.querySelectorAll('input[type="text"], textarea') || [])].filter((i) => !i.value).length,
          looseRadios: [...(body?.querySelectorAll('input[type="radio"]') || [])].filter((r) => !r.checked && !r.disabled).length,
          hasNext: !!next,
          nextDisabled: next ? next.disabled : null,
        };
      });
      last = state;
      if (state.gone || state.atReview) return state;
      // Fill whatever this page still needs.
      await page.evaluate(() => {
        const fire = (node, type) => node.dispatchEvent(new Event(type, { bubbles: true }));
        const mode = [...document.querySelectorAll(".wizard .wizard__body select.input-group__control")][0];
        if (mode && mode.value === "feat") { mode.value = "single"; fire(mode, "change"); }
        for (const s of [...document.querySelectorAll(".wizard .wizard__body select.input-group__control")].filter((x) => !x.value)) {
          const opt = [...s.options].find((o) => o.value);
          if (opt) { s.value = opt.value; fire(s, "change"); }
        }
        for (const i of [...document.querySelectorAll('.wizard .wizard__body input[type="number"]')].filter((x) => !x.value)) {
          i.value = "7"; fire(i, "input"); fire(i, "change");
        }
        for (const i of [...document.querySelectorAll('.wizard .wizard__body input[type="text"], .wizard .wizard__body textarea')].filter((x) => !x.value)) {
          i.value = "Probe"; fire(i, "input"); fire(i, "change");
        }
        // Choice groups are radio sets, one per <fieldset>: clicking the
        // first unchecked radio ANYWHERE would just swap the pick inside
        // whichever group happened to come first and never satisfy the
        // others. Walk each group's own first free option instead. The
        // handler re-renders the group, so every node has to be re-queried
        // between clicks.
        for (let pass = 0; pass < 6; pass++) {
          let clicked = false;
          for (const fs of document.querySelectorAll(".wizard .wizard__body .level-guide__choices")) {
            const input = [...fs.querySelectorAll("input[type=radio]:not(:disabled), input[type=checkbox]:not(:disabled)")]
              .find((r) => !r.checked);
            if (input) { input.click(); clicked = true; }
          }
          if (!clicked) break;
        }
      });
      await page.waitForTimeout(450);
      // Advance when this page is complete. Filling and advancing in the
      // same pass is what a person does; waiting for a turn where there is
      // nothing left to fill just spins on a page whose control it cannot
      // satisfy.
      const nextHandle = await page.evaluateHandle(() => {
        const n = document.querySelector(".wizard__nav:not(.wizard__nav--top) .wizard__next");
        return n && !n.disabled ? n : null;
      });
      const nextEl = nextHandle.asElement();
      if (nextEl) {
        await nextEl.click().catch(() => {});
        await quiet(page);
        sameTitleRounds = 0;
        lastTitle = null;
      } else {
        // No advance available: if the page isn't moving, say so with what
        // was still unfilled rather than looping to the guard.
        sameTitleRounds = state.title === lastTitle ? sameTitleRounds + 1 : 0;
        lastTitle = state.title;
        if (sameTitleRounds >= 3) return { ...state, stuck: true };
      }
    }
    return { ...(last || {}), gaveUp: true };
  };

  const setUpLeveling = async ({ level, className, subclass = null, recordedLevels = [], createdAtLevel = 1 }) => {
    await page.evaluate((extra) => {
      const KEY = "grimoire.local.characters.v1";
      const stored = JSON.parse(localStorage.getItem(KEY) || "{}");
      // The SAME character reopenSheet opens (it clicks this card by name).
      // Keying off Object.keys(...)[0] patches whichever character happens
      // to be first, which is only the one on screen when the vault holds a
      // single character — and a fixture that seeds a different sheet than
      // it asserts on fails in ways that look like product bugs.
      const id = Object.entries(stored)
        .find(([, c]) => (c.name || "") === extra.name)?.[0];
      if (!id) throw new Error(`fixture: no character named "${extra.name}"`);
      const walk = (nodes) => nodes.flatMap((n) => [n, ...(n.children || [])]);
      // Every copy: the renderer reads sheetTabs[i].layout, and
      // character.layout is only a mirror of the FIRST tab.
      const allFields = [stored[id].layout, ...(stored[id].sheetTabs || []).map((t) => t.layout)]
        .filter(Boolean).flatMap(walk);
      // EVERY copy of the Level field, not just the first: character.layout
      // is only a mirror of the first tab, so setting one of the two leaves
      // the copy the renderer actually reads still saying the old level.
      const levelFields = allFields.filter((f) => f.id === "level");
      levelFields.forEach((f) => { f.value = String(extra.level); });
      stored[id].rules = {
        ...(stored[id].rules || {}),
        className: extra.className,
        level: extra.level,
        abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
      };
      // Pending picks from an earlier probe would make the button think a
      // level-up is already in progress, and a recorded level-up would put
      // the walkthrough on its "already applied" panel instead of the wizard.
      delete stored[id].levelingPending;
      stored[id].levelUps = Object.fromEntries(extra.recordedLevels.map((l) => [String(l), {
        hp: `+${l}`, className: extra.className, appliedRulesetId: "dnd5e-2014",
      }]));
      stored[id].createdAtLevel = extra.createdAtLevel;
      localStorage.setItem(KEY, JSON.stringify(stored));
    }, { level, className, recordedLevels, createdAtLevel, name: probe.name });
    await reopenSheet();
    await pickDropdown("Class", className);
    // A character part-way up the levels has already chosen a subclass, and
    // that is what keeps the walkthrough's own Subclass page from gating the
    // run below (its pick lives in a rich picker row, not a plain control).
    if (subclass) await pickDropdown("Subclass", subclass);
  };

  /** The toolbar button's whole state at once. The Level is read off the
   *  STORED character rather than the DOM: the Level field lives on the
   *  Main tab's layout, so while the Leveling tab is open it is legitimately
   *  not in the document, and a probe that looked for it there would read
   *  "no level" at the exact moment the raise had just worked. */
  const readLevelUp = () => page.evaluate((name) => {
    const btn = document.querySelector(".level-up__btn");
    const note = document.querySelector(".level-up__note");
    const stored = JSON.parse(localStorage.getItem("grimoire.local.characters.v1") || "{}");
    const ch = Object.entries(stored).find(([, c]) => (c.name || "") === name)?.[1];
    const walk = (nodes) => (nodes || []).flatMap((n) => [n, ...(n.children || [])]);
    const levelField = [ch?.layout, ...(ch?.sheetTabs || []).map((t) => t.layout)]
      .filter(Boolean).flatMap(walk).find((f) => f.id === "level");
    return {
      button: btn ? {
        text: btn.textContent.trim(),
        disabled: btn.disabled,
        title: btn.title,
        describedBy: btn.getAttribute("aria-describedby"),
      } : null,
      note: note ? {
        text: note.textContent.trim(),
        hidden: note.hidden,
        shown: note.getBoundingClientRect().height > 0,
      } : null,
      level: levelField ? String(levelField.value).trim() : null,
      onLevelingTab: !!document.querySelector(".page-grid--leveling"),
      wizard: !!document.querySelector(".wizard"),
      wizardTitle: document.querySelector(".wizard h2")?.textContent.trim() || null,
      gapBanner: (() => {
        const n = document.querySelector(".leveling-tab__gap");
        if (!n) return null;
        // The progress label is a child span, so read the sentence without
        // it rather than trying to un-concatenate the two out of textContent.
        const clone = n.cloneNode(true);
        clone.querySelector(".leveling-tab__gap-progress")?.remove();
        return clone.textContent.replace(/\s+/g, " ").trim();
      })(),
      gapProgress: document.querySelector(".leveling-tab__gap-progress")?.textContent.trim() || null,
      revert: (() => {
        const btn = document.querySelector(".leveling-revert__btn");
        const note = document.querySelector(".leveling-revert__note");
        return {
          btn: btn ? btn.textContent.trim() : null,
          note: note ? note.textContent.trim() : null,
          shown: !!document.querySelector(".leveling-revert")
            && document.querySelector(".leveling-revert").getBoundingClientRect().height > 0,
        };
      })(),
      featuresItems: (() => {
        const f = [ch?.layout, ...(ch?.sheetTabs || []).map((t) => t.layout)]
          .filter(Boolean).flatMap(walk).find((x) => x.id === "features");
        return Array.isArray(f?.items) ? f.items.slice() : null;
      })(),
      hpMax: (() => {
        const f = [ch?.layout, ...(ch?.sheetTabs || []).map((t) => t.layout)]
          .filter(Boolean).flatMap(walk).find((x) => x.id === "hpMax");
        return f ? String(f.value) : null;
      })(),
      strScore: (() => {
        const f = [ch?.layout, ...(ch?.sheetTabs || []).map((t) => t.layout)]
          .filter(Boolean).flatMap(walk).find((x) => x.id === "strScore");
        return f ? String(f.value) : null;
      })(),
      rulesStr: ch?.rules?.abilityScores?.str ?? null,
      rulesFeats: (ch?.rules?.feats || []).map((f) => f?.name),
      gapBannerShown: (() => {
        const n = document.querySelector(".leveling-tab__gap");
        return n ? n.getBoundingClientRect().height > 0 : false;
      })(),
      cancel: document.querySelector(".level-guide__cancel")?.textContent.trim() || null,
    };
  }, probe.name);

  await setUpLeveling({ level: 1, className: "Fighter" });
  const startButton = await readLevelUp();
  check(!!startButton.button, "the Level Up button is on the toolbar");
  check(startButton.level === "1", `the fixture's Level field reads 1 (got ${JSON.stringify(startButton.level)})`);
  check(startButton.button.text === "Level Up", `and it is labelled plainly (got "${startButton.button.text}")`);
  check(!startButton.button.disabled, "and it is live on a level-1 character");
  check(startButton.note.hidden, "with no reason caption while it can act");

  const clickedStart = await clickOnSheet(".level-up__btn");
  check(clickedStart.hittable, `the button is really clickable, not covered (${clickedStart.coveredBy || "clear"})`);
  await page.waitForTimeout(1000);
  const afterStart = await readLevelUp();
  check(afterStart.level === "2", `clicking it raises the Level field to 2 (got ${JSON.stringify(afterStart.level)})`);
  check(afterStart.onLevelingTab, "and lands you on the Leveling tab");
  check(afterStart.wizard, "with the level-up walkthrough open");
  check(afterStart.cancel === "Cancel this level-up",
    `and a Cancel this level-up button on the walkthrough (got ${JSON.stringify(afterStart.cancel)})`);

  // A second click on the SAME level must resume, not raise to 3: the
  // first click already raised it, and the walkthrough is now holding
  // picks for level 2.
  await clickOnSheet(".level-up__btn");
  await page.waitForTimeout(1000);
  const afterSecond = await readLevelUp();
  check(afterSecond.level === "2", `a second click resumes instead of raising again (got ${JSON.stringify(afterSecond.level)})`);
  check(/continue/i.test(afterSecond.button.text), `and the button says it is continuing (got "${afterSecond.button.text}")`);

  // Cancel puts the level back and hands you off the Leveling tab.
  const cancelClicked = await clickOnSheet(".level-guide__cancel");
  check(cancelClicked.hittable, `the Cancel button is really clickable (${cancelClicked.coveredBy || "clear"})`);
  await page.waitForTimeout(1000);
  const afterCancel = await readLevelUp();
  check(afterCancel.level === "1", `cancelling restores level 1 (got ${JSON.stringify(afterCancel.level)})`);
  check(afterCancel.button.text === "Level Up", "and the button is back to offering a level-up");

  // The cap: level 20 must give a DISABLED button and a reason readable
  // without hovering anything.
  await setUpLeveling({ level: 20, className: "Fighter" });
  const atCap = await readLevelUp();
  check(atCap.button.disabled,
    `at the cap the button is disabled (level=${JSON.stringify(atCap.level)}, text="${atCap.button.text}", title="${atCap.button.title}")`);
  check(atCap.note.shown && atCap.note.text.length > 0,
    `and the reason is VISIBLE, not just a tooltip (shown=${atCap.note.shown}, text="${atCap.note.text}")`);
  check(atCap.button.describedBy === "level-up-note",
    `and the button points at that caption for screen readers (aria-describedby=${atCap.button.describedBy})`);

  // --- A level typed straight in, skipping the levels in between -------
  //
  // Seed a character whose highest recorded level is 3 but whose sheet
  // level says 5 - exactly what typing 5 into the Level field does. The
  // walkthrough used to offer only the sheet level, so level 4 was skipped
  // and nothing said so.
  await setUpLeveling({ level: 5, className: "Fighter", recordedLevels: [2, 3] });
  await openLevelingTab();
  const jumped = await readLevelUp();
  check(jumped.gapBanner === "You're level 5, but levels 4 and 5 haven't been recorded yet.",
    `the gap banner names the skipped levels exactly (got ${JSON.stringify(jumped.gapBanner)})`);
  check(jumped.gapProgress === "Level 4 of 4-5",
    `and shows progress through the range (got ${JSON.stringify(jumped.gapProgress)})`);
  check(jumped.gapBannerShown, "and the banner is actually visible");
  // The walkthrough must be working on level 4, not the sheet's 5.
  check(/Level 4$/.test(jumped.wizardTitle || ""),
    `and the walkthrough is on the LOWEST unrecorded level (title="${jumped.wizardTitle}")`);
  // The button offers to continue rather than raising past 4.
  check(/continue/i.test(jumped.button.text), `and the button offers to continue, not to level past (got "${jumped.button.text}")`);

  // Clicking it must NOT raise the sheet to 6 - that is the bug's other
  // half, and the button is the only thing that could do it.
  await clickOnSheet(".level-up__btn");
  await page.waitForTimeout(1000);
  const afterJumpClick = await readLevelUp();
  check(afterJumpClick.level === "5",
    `clicking does not raise past the outstanding levels (got ${JSON.stringify(afterJumpClick.level)})`);

  // --- A character CREATED above level 1 must not be nagged -------------
  await setUpLeveling({ level: 3, className: "Fighter", recordedLevels: [], createdAtLevel: 3 });
  await openLevelingTab();
  const createdHigh = await readLevelUp();
  check(!createdHigh.gapBanner,
    `a character created at level 3 gets no gap banner (got ${JSON.stringify(createdHigh.gapBanner)})`);
  check(!/continue/i.test(createdHigh.button.text),
    `and its button still offers a normal level-up (got "${createdHigh.button.text}")`);

  // --- Level history: closed by default, still fully working ---------------
  const levelHistory = () => page.evaluate(() => {
    const details = document.querySelector(".leveling-history");
    const rows = [...document.querySelectorAll(".leveling-row")];
    const current = rows.find((r) => r.classList.contains("leveling-row--current"));
    return {
      present: !!details,
      open: details ? details.open : null,
      label: details?.querySelector("summary")?.textContent?.trim() || null,
      rows: rows.length,
      // A row inside a closed <details> is in the document but not laid
      // out; that is what "built, just not shown" looks like from here.
      rowHeights: rows.filter((r) => r.getBoundingClientRect().height > 0).length,
      currentLevel: current ? Number(current.dataset.level) : null,
      currentSummary: current?.querySelector(".leveling-row__summary")?.textContent?.trim() || null,
      jumpBtn: document.querySelector(".leveling-tab__jump")?.textContent?.trim() || null,
    };
  });

  await setUpLeveling({ level: 5, className: "Fighter", subclass: "Champion", recordedLevels: [2, 3] });
  await openLevelingTab();
  const hist = await levelHistory();
  check(hist.present, "the manual per-level rows sit behind a disclosure");
  check(hist.rows === 0 || hist.rows === 20, `the rows are still built (${hist.rows} in the document)`);
  check(hist.label === "Level history (edit by hand)",
    `labelled as the by-hand route (got ${JSON.stringify(hist.label)})`);
  check(hist.open === false, `closed by default (open=${hist.open})`);
  check(hist.rowHeights === 0,
    `and none of the twenty rows is on the page while it is closed (${hist.rowHeights} laid out)`);
  // "Edit Level N by hand", not "Jump to Level N": the button opens the
  // by-hand history and scrolls to the row, and on a level 1 character
  // "Jump to Level 1" read like it went somewhere else on the sheet.
  check(hist.jumpBtn === "Edit Level 5 by hand", `with the by-hand button still offered (got ${JSON.stringify(hist.jumpBtn)})`);

  // Jump must OPEN the disclosure - scrolling to a row inside a closed
  // <details> scrolls to nothing.
  const jumpedToHistory = await clickOnSheet(".leveling-tab__jump");
  check(jumpedToHistory.hittable, `the Jump button is really clickable (${jumpedToHistory.coveredBy || "clear"})`);
  await page.waitForTimeout(900);
  const afterJump = await levelHistory();
  check(afterJump.open === true, `jumping opens the disclosure (open=${afterJump.open})`);
  check(afterJump.rowHeights > 0, `and the rows are laid out (${afterJump.rowHeights} visible)`);
  // A level the wizard actually recorded shows a filled-in count on its row:
  // the two routes write the same object, which is the overlap worth knowing
  // about (the commit message spells it out).
  const recordedRow = await page.evaluate(() => {
    const row = document.querySelector('.leveling-row[data-level="3"]');
    return row?.querySelector(".leveling-row__summary")?.textContent?.trim() || null;
  });
  check(recordedRow && recordedRow !== "Nothing yet",
    `a recorded level shows its filled-in count on the row (got ${JSON.stringify(recordedRow)})`);

  // The rows still save. Type into one by hand and check it persists.
  const rowTyped = await page.evaluate(() => {
    const row = document.querySelector('.leveling-row[data-level="3"] .leveling-row__toggle');
    row?.click();
    return !!row;
  });
  check(rowTyped, "a history row still expands");
  await page.waitForTimeout(700);
  // Expanding a row re-renders the whole tab. The disclosure has to stay
  // open through that, or it snaps shut under the cursor on the first
  // click - which is why its state lives beside the sheet, not on the node.
  check((await levelHistory()).open === true,
    "and expanding a row does not close the disclosure behind it");
  await page.evaluate(() => {
    // The FIRST textarea on a row is "Class Taken", not Notes - a row's
    // fields come from LEVEL_UP_FIELDS in order, so say which one is being
    // typed into rather than assuming.
    const row = document.querySelector('.leveling-row[data-level="3"]');
    const field = row?.querySelector("textarea");
    if (!field) return;
    field.value = "Hand-typed class name for level 3";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(900);
  const typed = await page.evaluate((name) => {
    const KEY = "grimoire.local.characters.v1";
    const stored = JSON.parse(localStorage.getItem(KEY) || "{}");
    const c = Object.values(stored).find((x) => (x.name || "") === name);
    return c?.levelUps?.["3"]?.className ?? null;
  }, probe.name);
  check(typed === "Hand-typed class name for level 3",
    `and a hand-typed row still saves (got ${JSON.stringify(typed)})`);

  // And it survives a reload - it is a saved row, not a transient one.
  await reopenSheet();
  await openLevelingTab();
  await page.waitForTimeout(400);
  const afterRowReload = await page.evaluate(() => {
    const details = document.querySelector(".leveling-history");
    const row = document.querySelector('.leveling-row[data-level="3"]');
    return {
      summary: row?.querySelector(".leveling-row__summary")?.textContent?.trim() || null,
      open: details ? details.open : null,
    };
  });
  check(afterRowReload.summary && afterRowReload.summary !== "Nothing yet",
    `the hand-typed row survives a reload (got ${JSON.stringify(afterRowReload.summary)})`);
  // Expanding the row again shows the saved text, not an empty box.
  await page.evaluate(() => document.querySelector('.leveling-row[data-level="3"] .leveling-row__toggle')?.click());
  await quiet(page);
  const reopened = await page.evaluate(() => {
    const row = document.querySelector('.leveling-row[data-level="3"]');
    return row?.querySelector("textarea")?.value ?? null;
  });
  check(reopened === "Hand-typed class name for level 3",
    `and reopening it shows what is in it (got ${JSON.stringify(reopened)})`);

  // --- "Level N gives you:" ----------------------------------------------
  //
  // Built from the same grant model the At a Glance table reads. This is
  // also the regression test for the bundle list that omitted the PRIMARY
  // class (multiclassEntries is the secondaries), which left a single-class
  // character with no class grants at any level.
  const gainsProbe = () => page.evaluate(() => {
    const section = document.querySelector(".level-gains");
    return {
      present: !!section,
      heading: section?.querySelector(".level-gains__heading")?.textContent?.trim() || null,
      items: [...(section?.querySelectorAll(".level-gains__list li") || [])]
        .map((li) => li.textContent.trim()),
      shown: section ? section.getBoundingClientRect().height > 0 : false,
      firstBeforeWizardTitle: (() => {
        const g = document.querySelector(".level-gains");
        const h = document.querySelector(".wizard h2");
        return !!(g && h) && !!(g.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING);
      })(),
    };
  });

  await setUpLeveling({ level: 5, className: "Fighter", subclass: "Champion", recordedLevels: [2, 3] });
  await openLevelingTab();
  const gains = await gainsProbe();
  check(gains.present, "the walkthrough opens with a 'what this level gives you' summary");
  check(gains.heading === "Level 4 gives you:",
    `for the level being walked, not the sheet's (got ${JSON.stringify(gains.heading)})`);
  check(gains.shown, "and it is visible");
  check(gains.firstBeforeWizardTitle, "sitting above the wizard's own title");
  check(gains.items.length > 0,
    `and it lists this class's level-4 features, not just race/background (${JSON.stringify(gains.items.slice(0, 4))})`);
  // At least one entry must carry real sourced text; if the primary-class
  // bundle were missing again this would be empty entirely.
  check(gains.items.some((t) => t.length > 40),
    `quoting a sourced description rather than a bare name (${JSON.stringify(gains.items.find((t) => t.length > 40))})`);

  // --- Applying the lowest leaves the next one waiting --------------------
  //
  // This is what makes the banner actionable rather than just a warning:
  // take level 4 through the walkthrough and level 5 must become the
  // outstanding one, on its own.
  await setUpLeveling({ level: 5, className: "Fighter", subclass: "Champion", recordedLevels: [2, 3] });
  await openLevelingTab();
  const walked = await walkWizardToReview();
  check(walked.atReview,
    `the level-4 walkthrough can be walked to Review (${JSON.stringify(walked).slice(0, 220)})`);
  check(walked.applyText === "Apply Level 4 Changes",
    `and it is Apply LEVEL 4, not the sheet's 5 (got ${JSON.stringify(walked.applyText)})`);
  const applyHit = await clickOnSheet(".wizard__body button.btn--primary");
  check(applyHit.hittable, `the Apply button is really clickable (${applyHit.coveredBy || "clear"})`);
  await page.waitForTimeout(1500);
  const afterApply = await readLevelUp();
  check(afterApply.gapBanner === "You're level 5, but level 5 hasn't been recorded yet.",
    `applying level 4 leaves only level 5 outstanding (got ${JSON.stringify(afterApply.gapBanner)})`);
  check(afterApply.gapProgress === "Level 5 of 5",
    `and the range collapses to it (got ${JSON.stringify(afterApply.gapProgress)})`);
  check(/Level 5$/.test(afterApply.wizardTitle || ""),
    `with the walkthrough now on level 5 (title="${afterApply.wizardTitle}")`);

  // --- Reverting the level you just applied ------------------------------
  //
  // Still on the fixture from above: level 5 sheet, level 4 recorded, so
  // level 4 is the highest recorded and therefore the only one offered.
  const beforeRevert = await readLevelUp();
  check(beforeRevert.revert.btn === "Revert Level 4",
    `the highest recorded level offers a Revert button (got ${JSON.stringify(beforeRevert.revert)})`);
  check(beforeRevert.revert.shown, "and it is actually visible");
  // Snapshot what the level-up changed, so the revert can be checked
  // against it rather than against "something moved".
  // Snapshot against the FIXTURE's base numbers, not against whatever the
  // level-up just left: comparing to the post-Apply state would only prove
  // the revert changed something, not that it changed it back.
  const strBase = 16;
  const featLinesBefore = (beforeRevert.featuresItems || []).length;

  const revertHit = await clickOnSheet(".leveling-revert__btn");
  check(revertHit.hittable, `the Revert button is really clickable (${revertHit.coveredBy || "clear"})`);
  await page.waitForTimeout(700);
  const dlg = await page.evaluate(() => {
    const box = document.querySelector(".app-dialog__box");
    return {
      open: !!box,
      danger: !!document.querySelector(".app-dialog__box--danger"),
      title: box?.querySelector(".app-dialog__title")?.textContent?.trim() || null,
      lines: [...(box?.querySelectorAll(".app-dialog__revert-list li") || [])].map((li) => li.textContent.trim()),
      buttons: [...(box?.querySelectorAll(".modal-actions button") || [])].map((b) => b.textContent.trim()),
    };
  });
  check(dlg.open, "clicking it opens a confirm dialog");
  check(dlg.danger, "marked as a destructive choice");
  check(dlg.title === "Revert level 4?", `titled for the level (got ${JSON.stringify(dlg.title)})`);
  check(dlg.lines.some((l) => /hit points/.test(l)), `and it lists what it takes back (${JSON.stringify(dlg.lines.slice(0, 3))})`);
  check(dlg.lines.some((l) => /ability scores back/.test(l)), "including the ability scores");
  check(dlg.buttons.some((b) => /Revert level 4/.test(b)), `with a confirm button naming the level (${JSON.stringify(dlg.buttons)})`);

  // Cancel first: nothing should change.
  await page.evaluate(() => [...document.querySelectorAll(".app-dialog__actions button")]
    .find((b) => /Cancel/i.test(b.textContent))?.click());
  await quiet(page);
  const afterCancelRevert = await readLevelUp();
  check(afterCancelRevert.hpMax === beforeRevert.hpMax,
    `backing out of the dialog changes nothing (HP ${afterCancelRevert.hpMax} vs ${beforeRevert.hpMax})`);
  check(afterCancelRevert.rulesStr === beforeRevert.rulesStr, "and the ability score is untouched");
  check(afterCancelRevert.revert.btn === "Revert Level 4", "and the button is still there");

  // Now actually do it.
  await clickOnSheet(".leveling-revert__btn");
  await page.waitForTimeout(700);
  await page.evaluate(() => [...document.querySelectorAll(".app-dialog__actions button")]
    .find((b) => /Revert level/i.test(b.textContent))?.click());
  await quiet(page);
  const afterRevert = await readLevelUp();
  // Back to the level BEFORE the reverted one was applied: level 4's own
  // effects are gone, so level 3 is what the character has actually earned.
  check(afterRevert.level === "3", `reverting drops the Level back to 3 (got ${JSON.stringify(afterRevert.level)})`);
  check(afterRevert.rulesStr === strBase,
    `and puts the ability score back to the fixture's ${strBase} (got ${afterRevert.rulesStr})`);
  check(afterRevert.rulesFeats.length === 0,
    `the feat taken at level 4 is gone (got ${JSON.stringify(afterRevert.rulesFeats)})`);
  check(!(afterRevert.featuresItems || []).some((t) => /level 4/.test(t)),
    `and no level-4 line is left in Features & Traits (${JSON.stringify(afterRevert.featuresItems)})`);
  check((afterRevert.featuresItems || []).length === featLinesBefore,
    "and the features list is no longer than it was before the level-up");
  // Level 4 is no longer recorded, so 5 becomes the highest recorded
  // level - and it has no record, so the note takes the button's place.
  check(afterRevert.revert.btn === null && /recorded before reverting existed/.test(afterRevert.revert.note || ""),
    `a level recorded without a record explains itself instead of offering a button (got ${JSON.stringify(afterRevert.revert)})`);

  // --- A hand edit after the level-up must be called out, not discarded ---
  //
  // Reverting restores BEFORE values, so anything typed into those fields
  // afterwards would be thrown away. Silence there is data loss.
  await setUpLeveling({ level: 5, className: "Fighter", subclass: "Champion", recordedLevels: [2, 3] });
  await openLevelingTab();
  await walkWizardToReview();
  await clickOnSheet(".wizard__body button.btn--primary");
  await page.waitForTimeout(1500);
  // Edit HP by hand, the way a player correcting a number would.
  await page.evaluate((name) => {
    const KEY = "grimoire.local.characters.v1";
    const stored = JSON.parse(localStorage.getItem(KEY) || "{}");
    const c = Object.values(stored).find((x) => (x.name || "") === name);
    const walk = (nodes) => (nodes || []).flatMap((n) => [n, ...(n.children || [])]);
    for (const layout of [c?.layout, ...(c?.sheetTabs || []).map((t) => t.layout)]) {
      for (const f of (layout ? walk(layout) : [])) {
        if (f.id === "hpMax") f.value = String(Number(f.value || 0) + 5);
      }
    }
    localStorage.setItem(KEY, JSON.stringify(stored));
  }, probe.name);
  // Reopen, or the running app keeps serving the pre-edit numbers from
  // memory and there is nothing to detect.
  await reopenSheet();
  await openLevelingTab();
  const edited = await readLevelUp();
  check(edited.revert.btn === "Revert Level 4", "the revert button is offered again after the hand edit");
  await clickOnSheet(".leveling-revert__btn");
  await page.waitForTimeout(700);
  const warnDlg = await page.evaluate(() => {
    const box = document.querySelector(".app-dialog__box");
    const warn = box?.querySelector(".app-dialog__revert-warning");
    return {
      warned: !!warn,
      role: warn?.getAttribute("role") || null,
      lead: warn?.textContent?.trim().slice(0, 60) || null,
      lines: [...(box?.querySelectorAll(".app-dialog__revert-list li") || [])].map((li) => li.textContent.trim()),
    };
  });
  check(warnDlg.warned, "the dialog warns that hand edits will be lost");
  check(warnDlg.role === "alert", "and the warning is announced (role=alert)");
  check(warnDlg.lines.some((l) => /HP Max has been edited/.test(l)),
    `naming the field that was edited (${JSON.stringify(warnDlg.lines.filter((l) => /edited/.test(l)))})`);
  // And Cancel really does back out of that.
  await page.evaluate(() => [...document.querySelectorAll(".app-dialog__actions button")]
    .find((b) => /Cancel/i.test(b.textContent))?.click());
  await quiet(page);
  const afterWarnCancel = await readLevelUp();
  check(afterWarnCancel.revert.btn === "Revert Level 4", "and cancelling the warning leaves the level alone");


  // No reset needed: the Cleric fixture below seeds its own level.

  // Nine level-1 Cleric spells against a level-5 limit of 8, so the fixture
  // can actually reach "over". Four spells could never get past 8/8 and the
  // over-limit check would have been asserting against a state the app can
  // never be in. `Detect Magic` is in here because it is a ritual, which is
  // how the ritual marker gets covered in the real UI.
  const clericSpells = [
    "Bless", "Cure Wounds", "Guiding Bolt", "Healing Word", "Inflict Wounds",
    "Sanctuary", "Shield of Faith", "Command", "Detect Magic",
  ];
  await setUpWizard({
    rules: { className: "Cleric", level: 5, abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 } },
    spells: clericSpells,
  });
  const clericChrome = await page.evaluate(() => ({
    counter: document.querySelector(".spell-list-chrome__count")?.textContent || "",
    over: !!document.querySelector(".spell-list-chrome__count--over"),
    toggles: [...document.querySelectorAll(".spell-row__prepared-toggle")].map((b) => b.getAttribute("aria-label")),
    filter: !!document.querySelector(".spell-list-chrome__filter"),
    rituals: [...document.querySelectorAll(".spell-row__ritual")].map((n) => n.textContent),
    ritualRows: [...document.querySelectorAll(".textlist-item")].filter((n) => n.querySelector(".spell-row__ritual")).length,
  }));
  check(clericChrome.counter === "Prepared: 0 / 8", `a Cleric gets a prepared counter (got "${clericChrome.counter}")`);
  check(!clericChrome.over, "and it is not over the limit to begin with");
  check(clericChrome.toggles.length === clericSpells.length, `one toggle per spell (${clericChrome.toggles.length})`);
  check(clericChrome.toggles.includes("Mark Bless prepared"), "and each toggle is NAMED, not a bare glyph");
  check(clericChrome.filter, "and there is a prepared-only filter");
  check(clericChrome.ritualRows === 1 && clericChrome.rituals[0] === "Ritual",
    `and a ritual spell is marked as one (${clericChrome.ritualRows} marked, ${clericChrome.rituals.join("/")})`);

  // One tap, no confirmation, and the counter follows.
  const tapped = await clickOnSheet('.spell-row__prepared-toggle[aria-label="Mark Bless prepared"]');
  check(tapped.hittable, `the toggle is really clickable, not covered (${tapped.coveredBy || "clear"})`);
  await page.waitForTimeout(700);
  const afterToggle = await page.evaluate(() => ({
    counter: document.querySelector(".spell-list-chrome__count")?.textContent || "",
    aria: document.querySelector('.spell-row__prepared-toggle[aria-label^="U"]')?.getAttribute("aria-label"),
    pressed: document.querySelector('.spell-row__prepared-toggle[aria-pressed="true"]')?.getAttribute("aria-label"),
    // A toggle that re-renders without the counter moving would mean the
    // number is decorative.
    preparedRow: !!document.querySelector(".spell-row--prepared"),
  }));
  check(afterToggle.counter === "Prepared: 1 / 8", `the counter follows the toggle (got "${afterToggle.counter}")`);
  check(afterToggle.aria === "Unprepare Bless", "and the toggle renames itself to the action it now does");
  check(afterToggle.pressed === "Unprepare Bless", "and reports its state to assistive tech");
  check(afterToggle.preparedRow, "and the row is marked prepared");

  // The prepared list is written to the save, and survives a reopen. A counter
  // that only lives in the DOM would pass every check above and be gone the
  // next time the sheet loads.
  const persisted = await page.evaluate((KEY) => {
    const stored = JSON.parse(localStorage.getItem(KEY) || "{}");
    const id = Object.keys(stored)[0];
    const field = stored[id].sheetTabs[0].layout
      .flatMap((b) => b.children || [])
      .find((f) => f.id === "spellsKnown");
    return field?.preparedItems || null;
  }, "grimoire.local.characters.v1");
  check(Array.isArray(persisted) && persisted.includes("Bless"),
    `the prepared spell was saved (${JSON.stringify(persisted)})`);

  await reopenSheet();
  const afterReload = await page.evaluate(() => ({
    counter: document.querySelector(".spell-list-chrome__count")?.textContent || "",
    pressed: [...document.querySelectorAll('.spell-row__prepared-toggle[aria-pressed="true"]')]
      .map((b) => b.getAttribute("aria-label")),
  }));
  check(afterReload.counter === "Prepared: 1 / 8",
    `and the counter is right after reopening the sheet (got "${afterReload.counter}")`);
  check(afterReload.pressed.length === 1 && afterReload.pressed[0] === "Unprepare Bless",
    `and the row is still ticked (${afterReload.pressed.join("/") || "none"})`);

  // Over the limit is allowed and warned about, never refused.
  //
  // `expectedPrepared` counts up as each toggle is clicked, because Bless is
  // already prepared from the step above - so the wait after the FIRST click
  // in this loop is for 2, not 1. Getting that off by one would either pass
  // vacuously or hang until the timeout.
  let expectedPrepared = 1;
  for (const name of ["Cure Wounds", "Guiding Bolt", "Healing Word", "Inflict Wounds",
    "Sanctuary", "Shield of Faith", "Command", "Detect Magic"]) {
    const hit = await clickOnSheet(`.spell-row__prepared-toggle[aria-label="Mark ${name} prepared"]`);
    check(hit.hittable, `every toggle is reachable, including ${name} (${hit.coveredBy || "clear"})`);
    // Wait for each toggle to PERSIST, not just to render. Nine clicks in a
    // row each reset the 500ms debounce, so without this the counter can be
    // read mid-sequence - which is how the "9 / 8" check below was reading
    // 8 / 8 on some runs and passing on others.
    await saved(page, preparedAtLeast, `${name} prepared`, expectedPrepared);
    // The render that follows the save, so the counter read below reflects
    // every toggle in the burst rather than the last one's render.
    await quiet(page);
    expectedPrepared += 1;
  }
  const over = await page.evaluate(() => ({
    counter: document.querySelector(".spell-list-chrome__count")?.textContent || "",
    warning: document.querySelector(".spell-list-chrome__warning")?.textContent || "",
    overClass: !!document.querySelector(".spell-list-chrome__count--over"),
    // The brief's line: over the limit warns, it does not refuse. All nine
    // spells must still be there and still prepared.
    preparedStillOn: [...document.querySelectorAll('.spell-row__prepared-toggle[aria-pressed="true"]')].length,
  }));
  check(over.counter === "Prepared: 9 / 8", `the counter counts all nine, not just the first eight (got "${over.counter}")`);
  check(over.overClass, "and marks itself as over");
  check(/over your limit/i.test(over.warning), `and going over warns in words (got "${over.warning.trim()}")`);
  check(over.preparedStillOn === 9, `and nothing was silently refused (${over.preparedStillOn} still prepared)`);

  // The filter removes rows rather than dimming ghosts.
  //
  // Each unprepare re-renders the row, so these clicks are separated by a
  // render wait. Issued back to back they land on detached nodes and are
  // silently dropped, which shows up as a filter count that is one or two
  // rows off rather than as an error.
  const beforeFilter = await page.evaluate(() => document.querySelectorAll(".textlist-item").length);
  for (const name of ["Sanctuary", "Command", "Shield of Faith", "Bless"]) {
    await clickOnSheet(`.spell-row__prepared-toggle[aria-label="Unprepare ${name}"]`);
    await quiet(page);
  }
  await saved(page, () => document.querySelectorAll('.spell-row__prepared-toggle[aria-pressed="true"]').length <= 8,
    "one unprepared");
  const filterTap = await clickOnSheet(".spell-list-chrome__filter input");
  check(filterTap.hittable, `the prepared-only filter is clickable too (${filterTap.coveredBy || "clear"})`);
  await quiet(page);
  const filtered = await page.evaluate(() => ({
    drawn: document.querySelectorAll(".textlist-item").length,
    checkbox: document.querySelector(".spell-list-chrome__filter input")?.checked,
  }));
  check(filtered.checkbox === true, "and the checkbox stays ticked across the re-render it causes");
  check(filtered.drawn === 5 && filtered.drawn < beforeFilter,
    `the filter hides the unprepared rows (${filtered.drawn} drawn of ${beforeFilter})`);

  // A KNOWN-ONLY caster sees none of it. This is the check that matters
  // most: a Sorcerer seeing "0 / 0 prepared" and a column of dead toggles
  // is worse than seeing nothing, because it implies a prepared list.
  // The spells are set explicitly rather than left over from the Cleric: a
  // known-only caster also has to show a list that is only as long as what
  // the player actually has, and inheriting nine Cleric spells would make
  // this check pass for the wrong reason.
  const sorcererSpells = ["Fire Bolt", "Fireball", "Mirror Image", "Misty Step"];
  await setUpWizard({
    rules: { className: "Sorcerer", level: 5, abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 18 } },
    spells: sorcererSpells,
  });
  const sorcererChrome = await page.evaluate(() => ({
    counter: !!document.querySelector(".spell-list-chrome"),
    toggles: document.querySelectorAll(".spell-row__prepared-toggle").length,
    dimmed: document.querySelectorAll(".spell-row--unprepared").length,
    // A known-only caster must not have gained any prepared spells either:
    // the Cleric's `preparedItems` are still on the same field, so this is
    // the check that a class change clears them rather than leaving a
    // Sorcerer counting toward a limit they do not have.
    // Read from the rendered sheet, not localStorage. The class is set on
    // the stored record directly, which bypasses the Class dropdown - and
    // so bypasses the dropOrphanedSpellPicks() call that a real class change
    // makes. Asserting on the save here would be testing the fixture's own
    // shortcut rather than the app. The cleanup itself is covered by the
    // class-change test below, which goes through the real dropdown.
    savedPrepared: (() => {
      const el = [...document.querySelectorAll(".spell-list-chrome__count")][0];
      return el ? el.textContent : null;
    })(),
    spellsStillThere: [...document.querySelectorAll(".textlist-item__text")].map((n) => n.textContent).filter(Boolean),
  }));
  check(!sorcererChrome.counter, "a Sorcerer gets no counter at all, not a 0 / 0 one");
  check(sorcererChrome.toggles === 0, "and no toggles");
  check(sorcererChrome.dimmed === 0, "and nothing dimmed");
  check(sorcererChrome.savedPrepared === null,
    "and the whole prepared block is gone, not just visually hidden");
  check(sorcererChrome.spellsStillThere.length === sorcererSpells.length
    && sorcererSpells.every((s) => sorcererChrome.spellsStillThere.includes(s)),
    `but the spell list itself is untouched (${sorcererChrome.spellsStillThere.join(", ")})`);
  await page.screenshot({ path: path.join(shotDir, `spell-list-sorcerer-${viewport.name}.png`) });

  // A Cleric's prepared spells must not outlive the Cleric. The save is
  // written by the toggle with no reference to a class, so the only thing
  // that can clear them is the load-time migration - which is why this is
  // checked after a reload rather than on the class change itself.
  //
  // Note what is NOT asserted: that switching Cleric -> Druid wipes the
  // prepared list. dropOrphanedSpellPicks only drops spells filed under the
  // OLD CLASS'S PICK KEY, and a spell prepared with the sheet toggle has no
  // pick key at all - so it survives, correctly. Bless prepared as a Cleric
  // is still a legal Druid preparation, and silently dropping it on a class
  // change would lose work the player can see and undo.
  // Wait until the spell list is rendered AND has stopped moving.
  //
  // `reopenSheet` navigates and clicks through to the character, then waits
  // for the DOM to go quiet - but "quiet" is a property of the whole page, and
  // the sheet finishes rendering its field values a beat after the structure
  // stops changing. A click issued into that window measures a rectangle, then
  // the row moves, and `page.mouse.click` lands on empty space: silently, with
  // no error and no hit-test failure, because the hit test ran against the
  // pre-move layout.
  //
  // The wait is on the specific thing the next action needs - the toggle's own
  // box being the same twice in a row - rather than on a length of time.
  await setUpWizard({
    rules: { className: "Cleric", level: 5, abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 } },
    spells: ["Bless", "Cure Wounds", "Guiding Bolt"],
  });
  await clickOnSheet('.spell-row__prepared-toggle[aria-label="Mark Bless prepared"]');
  // Settle the RENDER before the second click. Preparing a spell re-renders
  // the row, which replaces its DOM; a second click issued into that window
  // lands on a detached node and is silently lost.
  await quiet(page);
  await clickOnSheet('.spell-row__prepared-toggle[aria-label="Mark Cure Wounds prepared"]');
  // Wait for the SAVE, not for a number of milliseconds. See `saved()`.
  await saved(page, preparedAtLeast, "two spells prepared", 2);
  await quiet(page);
  const clericSaved = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("grimoire.local.characters.v1") || "{}");
    const id = Object.keys(stored)[0];
    const field = stored[id].sheetTabs[0].layout
      .flatMap((b) => b.children || [])
      .find((f) => f.id === "spellsKnown");
    return { counter: document.querySelector(".spell-list-chrome__count")?.textContent || "", prepared: field?.preparedItems || [] };
  });
  check(clericSaved.counter === "Prepared: 2 / 8" && clericSaved.prepared.length === 2,
    `a Cleric has two spells prepared and saved (${clericSaved.counter}, ${JSON.stringify(clericSaved.prepared)})`);

  // Same save, now loaded as a Sorcerer. setUpWizard writes localStorage and
  // reloads, so this goes through hydrateCharacter - the load-time
  // migration - which is the only thing that can clear a prepared list for a
  // class that has no prepared list. `clearPrepared: false` keeps the fixture
  // from doing it by hand, which would prove nothing.
  await page.evaluate(() => {
    const KEY = "grimoire.local.characters.v1";
    const stored = JSON.parse(localStorage.getItem(KEY) || "{}");
    const id = Object.keys(stored)[0];
    stored[id].rules = { ...stored[id].rules, className: "Sorcerer",
      abilityScores: { ...stored[id].rules.abilityScores, wis: 10, cha: 18 } };
    localStorage.setItem(KEY, JSON.stringify(stored));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.click(`.character-card:has-text("${probe.name || "Unnamed"}")`).catch(() => {});
  await quiet(page);
  // Not asserted here: that localStorage now reads empty. hydrateCharacter
  // repairs the LOADED copy and nothing writes it straight back, so the
  // stored record keeps its old value until the player's next save. That is
  // deliberate - a read must not write - and the migration re-runs on every
  // load, so the stale value is never rendered. The clear itself is asserted
  // against the real class registry in spell-sheet-chrome.test.mjs, where it
  // can be seen directly rather than inferred.
  const afterClassChangeUi = await page.evaluate(() => ({
    counter: !!document.querySelector(".spell-list-chrome"),
    toggles: document.querySelectorAll(".spell-row__prepared-toggle").length,
    spells: [...document.querySelectorAll(".textlist-item__text")].map((n) => n.textContent).filter(Boolean),
  }));
  check(!afterClassChangeUi.counter && afterClassChangeUi.toggles === 0,
    "and loading it as a class with no prepared list shows no prepared chrome at all");
  check(afterClassChangeUi.spells.length === 3,
    `but the spells themselves are untouched (${afterClassChangeUi.spells.join(", ")})`);

  // Undo and redo on a prepared toggle. The toggle writes through
  // commitMutation, so it is undoable in principle - but the undo stack
  // snapshots the whole character, and "in principle" is exactly the kind of
  // claim that goes stale the moment preparedItems stops being part of the
  // snapshot. Also the one gesture here with no confirmation: a mis-tap that
  // cannot be taken back is the cost of the speed in the first place.
  await setUpWizard({
    rules: { className: "Cleric", level: 5, abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 } },
    spells: ["Bless", "Cure Wounds", "Guiding Bolt"],
  });
  const undoBtn = 'button.btn:text-is("Undo")';
  const redoBtn = 'button.btn:text-is("Redo")';
  const history = async () => page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button.btn")];
    const find = (t) => buttons.find((b) => b.textContent.trim() === t);
    return {
      counter: document.querySelector(".spell-list-chrome__count")?.textContent || "",
      prepared: [...document.querySelectorAll('.spell-row__prepared-toggle[aria-pressed="true"]')]
        .map((b) => b.getAttribute("aria-label")),
      undoDisabled: find("Undo")?.disabled,
      redoDisabled: find("Redo")?.disabled,
    };
  });
  check((await history()).undoDisabled === true, "Undo starts disabled on an untouched sheet");
  await clickOnSheet('.spell-row__prepared-toggle[aria-label="Mark Bless prepared"]');
  // Both halves, in order. `saved` waits for the debounced write to land;
  // `quiet` then waits for the render that follows it. Waiting only for the
  // save is not enough - the counter in the DOM is updated by a separate
  // debounced renderAll(), so the storage can be current while the screen
  // still shows the old number, which is exactly the 0/8 this reported.
  await saved(page, preparedAtLeast, "one spell prepared", 1);
  await quiet(page);
  const afterPrepare = await history();
  check(afterPrepare.counter === "Prepared: 1 / 8", `one spell prepared (${afterPrepare.counter})`);
  check(afterPrepare.undoDisabled === false, "and Undo becomes available for it");

  await revealBuilder();
  await page.click(undoBtn);
  await quiet(page);
  const afterUndo = await history();
  check(afterUndo.counter === "Prepared: 0 / 8",
    `Undo takes the preparation back (got "${afterUndo.counter}")`);
  check(afterUndo.prepared.length === 0, "and the row's toggle goes with it");
  check(afterUndo.redoDisabled === false, "and Redo becomes available");

  await revealBuilder();
  await page.click(redoBtn);
  await quiet(page);
  const afterRedo = await history();
  check(afterRedo.counter === "Prepared: 1 / 8",
    `Redo puts it back (got "${afterRedo.counter}")`);
  check(afterRedo.prepared.length === 1 && afterRedo.prepared[0] === "Unprepare Bless",
    `with the row still ticked (${afterRedo.prepared.join("/") || "none"})`);

  const afterRedoSaved = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("grimoire.local.characters.v1") || "{}");
    const id = Object.keys(stored)[0];
    const f = stored[id].sheetTabs[0].layout.flatMap((b) => b.children || []).find((x) => x.id === "spellsKnown");
    return f?.preparedItems || [];
  });
  check(afterRedoSaved.length === 1 && afterRedoSaved[0] === "Bless",
    `and Redo saved it, not just the screen (${JSON.stringify(afterRedoSaved)})`);

  // Undo across a REOPEN. The stack is in memory, so this must not claim to
  // work - but it must not throw or leave the counter lying either.
  await reopenSheet();
  const afterReopen = await history();
  check(afterReopen.counter === "Prepared: 1 / 8",
    `a reopened sheet still shows the prepared spell (${afterReopen.counter})`);
  check(afterReopen.undoDisabled === true,
    "and its undo stack is empty, as an in-memory stack should be after a load");

  check(await page.$(".page-grid"), "a finished character opens its sheet");
  check(await page.$(".sheet-intro"), "a first-time finished character gets the orientation panel");
  const introCoversViews = await page.evaluate(() => {
    const text = document.querySelector(".sheet-intro")?.textContent || "";
    return { simple: /Simple View/.test(text), sheet: /Sheet View/.test(text), drag: /drag/i.test(text) };
  });
  check(introCoversViews.simple && introCoversViews.sheet,
    "the orientation panel explains both views");
  check(introCoversViews.drag, "the orientation panel warns that moving a block is a saved change");
  await page.screenshot({ path: path.join(shotDir, `intro-${viewport.name}.png`) });

  // Dismissing remembers, on the character - not in a module-level flag, and
  // not globally, so a SECOND character still gets told.
  const reopen = async () => {
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const sel = `.character-card:has-text("${probe.name || "Unnamed"}")`;
    if (await page.$(sel)) await page.click(sel);
    await quiet(page);
  };
  await page.click(".sheet-intro__dismiss");
  await quiet(page);
  check(!(await page.$(".sheet-intro")), "the orientation panel dismisses");
  await reopen();
  check(!(await page.$(".sheet-intro")), "a dismissed orientation panel stays dismissed after a reload");

  // Simple View on, reload, still on. Driven from a width that fits the
  // grid: on a phone the stacked layout is already engaged by width and the
  // toggle is deliberately inert, so this persistence check would be
  // measuring the forced state rather than the stored preference.
  const narrowForced = await page.evaluate(() => {
    const grid = document.querySelector(".page-grid");
    return (grid?.style?.width || "").replace("px", "") !== ""
      && document.querySelector(".page-grid-scroll")?.clientWidth < parseFloat(grid.style.width || "0");
  });
  if (narrowForced) {
    await page.setViewportSize({ width: 1440, height: viewport.height });
    await page.waitForTimeout(900);
  }
  const simpleToggle = await page.$(".sheet-toolbar button:text-is('Simple View')");
  check(!!simpleToggle, "a finished character offers the Simple View toggle");
  if (simpleToggle) {
    await simpleToggle.click();
    await quiet(page);
    check(await page.$(".page-grid.is-simple"), "Simple View engages on a finished character");
    await page.screenshot({ path: path.join(shotDir, `simple-view-persisted-${viewport.name}.png`) });
    await reopen();
    check(await page.$(".page-grid.is-simple"), "Simple View survives a reload");
    const restored = await page.evaluate(() => ({
      toggle: [...document.querySelectorAll(".sheet-toolbar button")]
        .map((b) => b.textContent || "")
        .find((t) => /View$/.test(t)) || "",
      stamped: [...document.querySelectorAll(".grid-node")].filter((n) => n.style.order).length,
    }));
    check(restored.toggle === "Sheet View", `the restored toggle offers the way back (got "${restored.toggle}")`);
    check(restored.stamped > 0, `the restored Simple View re-stamps its sort keys (${restored.stamped})`);
    // And back the other way, so the preference is a preference and not a
    // one-way door.
    await page.click(".sheet-toolbar button:text-is('Sheet View')");
    await quiet(page);
    await reopen();
    check(!(await page.$(".page-grid.is-simple")), "Sheet View survives a reload too");

    // --- Reading options ---------------------------------------------------
    //
    // Driven through the real checkboxes and asserted on the COMPUTED
    // styles, not on the attributes: an attribute can be set correctly and
    // still produce no visual change if the CSS selector does not match it,
    // which is the whole class of bug the a11y module's "always write 0, never
    // remove" rule is guarding against.
    const readingRow = '.toolbar-display__a11y input';
    const a11yOpen = async () => {
      const panel = await page.$(".toolbar-display[open]");
      if (!panel) {
        await page.click(".toolbar-display summary");
        await quiet(page);
      }
    };
    await a11yOpen();
    const readingBoxes = await page.$$(readingRow);
    check(readingBoxes.length === 2, `the Display panel offers both reading options (${readingBoxes.length})`);
    const spacingOf = (selector) => page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { letter: cs.letterSpacing, word: cs.wordSpacing, line: cs.lineHeight };
    }, selector);

    const before = await spacingOf("body");
    // Tick the dyslexia-friendly box, named by its label rather than by
    // position - a positional selector here toggled both boxes and then
    // asserted one was off, which is how the first run of this check
    // "failed".
    const clickReading = (needle) => page.evaluate((text) => {
      const box = [...document.querySelectorAll(".toolbar-display__a11y input")]
        .find((b) => b.closest("label")?.textContent.includes(text));
      if (!box || box.checked) return false;
      box.click();
      return true;
    }, needle);
    await clickReading("Dyslexia");
    await page.waitForTimeout(400);
    const dyslexiaAttrs = await page.evaluate(() => ({
      dyslexia: document.documentElement.dataset.dyslexia,
      cb: document.documentElement.dataset.cb,
    }));
    check(dyslexiaAttrs.dyslexia === "1", `the dyslexia option sets its attribute (got ${dyslexiaAttrs.dyslexia})`);
    check(dyslexiaAttrs.cb === "0", "and the other one is explicitly 0, not left unset");
    const after = await spacingOf("body");
    check(before && after && after.letter !== before.letter,
      `letter spacing actually widens (${before?.letter} -> ${after?.letter})`);
    check(before && after && parseFloat(after.line) > parseFloat(before.line),
      `line height actually grows (${before?.line} -> ${after?.line})`);

    // Reload: the preference has to survive, and has to be reapplied on the
    // way in rather than only on change.
    //
    // The card is selected by the name seedFinished reported back, not a
    // literal. A hardcoded name silently matched nothing here, no sheet
    // reopened, and the attribute came back "0" - which looked exactly like
    // a persistence bug and was not one.
    await reopen();
    const restoredAttrs = await page.evaluate(() => document.documentElement.dataset.dyslexia);
    check(restoredAttrs === "1", `the reading option survives a reload (got ${restoredAttrs})`);
    const restoredSpacing = await spacingOf("body");
    check(restoredSpacing && restoredSpacing.letter === after.letter, "and the spacing comes back with it");

    // The colour-blind option, likewise. Ticked on top of dyslexia, so the
    // two are also shown to be independent - turning one on must not clear
    // the other.
    await a11yOpen();
    const stillOn = await page.evaluate(() => document.documentElement.dataset.dyslexia);
    check(stillOn === "1", "the dyslexia option is still on while the other is toggled");
    await clickReading("Colour-blind");
    await page.waitForTimeout(400);
    const cbState = await page.evaluate(() => {
      const pos = getComputedStyle(document.documentElement).getPropertyValue("--color-positive").trim();
      const neg = getComputedStyle(document.documentElement).getPropertyValue("--color-negative").trim();
      return { attr: document.documentElement.dataset.cb, pos, neg };
    });
    check(cbState.attr === "1", `the colour-blind option sets its attribute (got ${cbState.attr})`);
    // The status colours must actually resolve to the colour-blind palette,
    // not merely flip an attribute. An earlier version of this check tried
    // to read the "default" off a probe element, which of course returns the
    // current computed value - so it compared the palette against itself.
    // The palette's own values are asserted in tests/accessibility.test.mjs;
    // here it is enough that they are the colour-blind ones.
    check(/^#(7fc4f0|e8661a|9d8cff)$/i.test(cbState.pos) && /^#(7fc4f0|e8661a|9d8cff)$/i.test(cbState.neg),
      `the colour-blind palette is what resolves (${cbState.pos} / ${cbState.neg})`);
    const stillSpaced = await spacingOf("body");
    check(stillSpaced && stillSpaced.letter === after.letter,
      "and the dyslexia spacing is untouched by it");
    await page.screenshot({ path: path.join(shotDir, `reading-options-${viewport.name}.png`) });

    // Back to off, so the next viewport's fixture starts clean.
    await page.evaluate(() => {
      const boxes = [...document.querySelectorAll(".toolbar-display__a11y input")];
      for (const b of boxes) if (b.checked) b.click();
    });
    await page.waitForTimeout(300);
  }
  }
}

// --- Phase timing ----------------------------------------------------------
//
// This suite is the slowest gate by an order of magnitude, so "which part" is
// the first question whenever it gets slower. Only the viewport runs are
// timed: they are three sequential passes over the whole app and account for
// the large majority of the wall clock, and unlike the one-off blocks further
// down they have unambiguous boundaries. Those blocks are left untimed on
// purpose - they are flat labelled sections in a script where a stopwatch
// attached to the wrong brace would report a confidently wrong number, which
// is worse than reporting nothing.
const phases = [];

// The three viewport runs are independent - separate browser contexts, no
// shared state, no ordering between them - so they run CONCURRENTLY. Each
// opens its own context against its own viewport and asserts on its own page,
// which is what makes this safe; the character data lives in each context's
// own storage, so there is nothing for them to trip over.
//
// Serial, these three were 85% of the suite's wall clock. Concurrent, the
// suite costs about as much as the slowest single pass.
//
// `problems` and `failures` are appended to from three places at once, but
// only ever pushed to, never spliced or reordered, and Node runs that as
// atomic at the granularity that matters here - so the report stays in one
// piece even when two viewports fail in the same millisecond.
await Promise.all(viewportSizes.map(async (viewport) => {
  const t0 = Date.now();
  try {
    await runViewportTests(viewport);
  } finally {
    phases.push({ label: viewport.name, ms: Date.now() - t0 });
  }
}));


// check() is scoped inside runViewportTests; this block is module level, so
// it gets its own reporter writing to the same failures array. The label is
// a parameter because the sections after this one run at more than one
// width, and a report line that says "phone" for a 1024px sweep is the same
// class of mistake as the leaked viewport this file used to have.
const reporter = (label) => (cond, msg) => {
  if (!cond) failures.push(`[${label}] ` + msg);
  console.log((cond ? "ok" : "FAIL") + ` [${label}]: ` + msg);
};
const phoneCheck = reporter("phone");
const widthCheck = reporter("widths");


// --- Phone portrait: Your Characters -------------------------------------
//
// Two complaints: the cards were three across when four fit, and the level /
// race / class lines were not displayed at all on a phone - the media query
// set .character-card__meta-lines to display:none, so a phone showed a
// portrait and a name and nothing else.
//
// NOTE on the brace: this block's own `{` does not close at the end of its
// section. It closes near the end of the file, with the phone-layout,
// widths-sweep, levelgated, rowclick and spell-rows sections nested inside it.
// That is pre-existing shape in this script, not something to tidy here, and
// it is why the sections below are gated individually rather than by wrapping
// each section header. See the note above AREAS.
if (inArea("vault-cards")) {
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  phone.on("pageerror", (e) => problems.push(`PAGEERROR [phone]: ${e.message}`));
  await phone.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
  await settled(phone, READY_VAULT, `phone vault`);
  // Assert the CSS viewport the media queries actually see. Playwright's
  // isMobile option changes device emulation and the resolved viewport, which
  // makes the layout width something other than the viewport passed in - so
  // a "phone" page can quietly fail every max-width query and still look
  // like it was tested. Read it back rather than assuming.
  const vpWidth = await phone.evaluate(() => window.innerWidth);
  phoneCheck(vpWidth <= 600,
    `the page really is a phone-width viewport (innerWidth=${vpWidth})`);
  const gridRule = await phone.evaluate(() => {
    const grid = document.querySelector(".character-card-grid");
    if (!grid) return null;
    const cs = getComputedStyle(grid);
    return { cols: cs.gridTemplateColumns, gap: cs.gap };
  });
  // The track count, read back as a measurement. It used to be asserted as
  // "four or more": four 83px cards, on the theory that the count of
  // characters is what you scan for on a phone. An 83px card truncates a
  // name, a level, a species and a class - all four of them - so the
  // density bought a list you had to open each entry of in order to read.
  // Two tracks is what a card can be and still be readable in; the
  // readability itself is asserted further down, against real text.
  phoneCheck(!!gridRule && String(gridRule.cols).trim().split(/\s+/).length === 2,
    `the phone grid lays out two tracks (${JSON.stringify(gridRule)})`);

  // This page has its OWN localStorage - it is a separate context from the
  // viewport pages - so the characters have to be seeded here rather than
  // copied from a character the earlier walk created. Minimal shape is enough:
  // the card only reads rules and the sheet layout.
  await phone.evaluate(() => {
    const layout = [{ name: "Identity", x: 0, y: 0, w: 4, h: 2, children: [] }];
    const names = ["Aramil", "Brix", "Cerys", "Doran", "Elsi", "Fen"];
    const map = {};
    names.forEach((name, i) => {
      map[name] = {
        id: name,
        name,
        rules: {
          level: (i % 5) + 1,
          species: i % 2 ? "Dwarf" : "Elf",
          className: i % 3 === 0 ? "Wizard" : "Cleric",
          abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 12, cha: 10 },
        },
        layout: JSON.parse(JSON.stringify(layout)),
        sheetTabs: [{ id: `${name}-tab`, name: "Sheet 1", layout: JSON.parse(JSON.stringify(layout)) }],
        setupComplete: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
    });
    localStorage.setItem("grimoire.local.characters.v1", JSON.stringify(map));
  });
  await phone.reload({ waitUntil: "networkidle" });
  await phone.waitForTimeout(1800);

  const grid = await phone.evaluate(() => {
    const cards = [...document.querySelectorAll(".character-card")];
    const row = [];
    // Group by vertical position into visual rows.
    const byTop = new Map();
    for (const c of cards) {
      const t = Math.round(c.getBoundingClientRect().top);
      for (const [key, arr] of byTop) {
        if (Math.abs(key - t) < 12) { arr.push(c); break; }
      }
      if (![...byTop.keys()].some((k) => Math.abs(k - t) < 12)) byTop.set(t, [c]);
    }
    for (const arr of byTop.values()) row.push(arr.length);
    const meta = document.querySelector(".character-card__meta-lines");
    const metaStyle = meta ? getComputedStyle(meta) : null;
    const visibleLines = [...document.querySelectorAll(".character-card__meta-line")]
      .filter((n) => n.textContent.trim())
      .map((n) => ({ text: n.textContent.trim(), shown: n.getBoundingClientRect().height > 0 }));
    // A name or fact whose text is wider than its own box is ellipsised -
    // the failure mode the four-across layout could not avoid, since an
    // 83px card truncates all four of them.
    const ellipsised = [];
    for (const n of document.querySelectorAll(".character-card__name, .character-card__meta-line")) {
      if (n.scrollWidth > n.clientWidth + 1) ellipsised.push(n.textContent.trim().slice(0, 24));
    }
    // The two card actions: a 44px floor, and a real gap between them
    // rather than two circles almost touching over the artwork.
    const actions = document.querySelector(".character-card__actions");
    const acts = actions ? [...actions.children].map((b) => b.getBoundingClientRect()) : [];
    const heading = document.querySelector(".page-header h2")?.getBoundingClientRect();
    const newInput = document.querySelector(".vault-new__input")?.getBoundingClientRect();
    return {
      cards: cards.length,
      firstRow: row[0] || 0,
      cardW: Math.round(cards[0]?.getBoundingClientRect().width || 0),
      cardH: Math.round(cards[0]?.getBoundingClientRect().height || 0),
      metaDisplay: metaStyle?.display || "none",
      metaHeight: Math.round(meta?.getBoundingClientRect().height || 0),
      visibleLines: visibleLines.slice(0, 8),
      anyLineClipped: visibleLines.some((l) => l.shown === false),
      ellipsised,
      actionSizes: acts.map((r) => [Math.round(r.width), Math.round(r.height)]),
      actionGap: acts.length >= 2
        ? Math.round(acts[1].left - acts[0].right)
        : null,
      headingLines: heading ? Math.round(heading.height / 26) : 0,
      newInputW: Math.round(newInput?.width || 0),
    };
  });
  phoneCheck(grid.cards >= 4, `the vault has several characters to lay out (got ${grid.cards})`);
  // Two across, not four. This USED to assert four, on the density
  // argument that the count is what you scan for on a phone. At 83px a
  // card cannot show a name, a level, a species and a class without
  // truncating all four - so the density bought a list you had to open
  // each entry of to read. The check is now the thing that actually
  // matters: wide enough to read, with nothing ellipsised.
  phoneCheck(grid.firstRow === 2,
    `two cards fit across a phone (got ${grid.firstRow} in the first row, card ${grid.cardW}x${grid.cardH})`);
  phoneCheck(grid.cardW >= 150 && grid.ellipsised.length === 0,
    `each card is wide enough to read its name and facts (${grid.cardW}px, ellipsised: ${JSON.stringify(grid.ellipsised)})`);
  phoneCheck(grid.headingLines <= 1,
    `the heading is one line, not wrapped beside the create box (${grid.headingLines})`);
  phoneCheck(grid.newInputW >= 200,
    `and the create box takes the width it needs (${grid.newInputW}px)`);
  phoneCheck(grid.actionSizes.every(([w, h]) => w >= 44 && h >= 44),
    `duplicate and delete are both 44px or more (${JSON.stringify(grid.actionSizes)})`);
  phoneCheck(grid.actionGap === null || grid.actionGap >= 8,
    `with a real gap between them, not two circles almost touching (${grid.actionGap}px)`);
  phoneCheck(grid.metaDisplay !== "none",
    `the level/race/class lines are DISPLAYED on a phone (got display:${grid.metaDisplay})`);
  const texts = grid.visibleLines.map((l) => l.text);
  phoneCheck(texts.some((t) => /level/i.test(t)),
    `including the level (${JSON.stringify(texts.slice(0, 4))})`);
  phoneCheck(texts.some((t) => /cleric|dwarf|elf|human/i.test(t)),
    `and the class or race (${JSON.stringify(texts.slice(0, 4))})`);
  phoneCheck(!grid.anyLineClipped,
    `with no line silently clipped away (${JSON.stringify(grid.visibleLines.filter((l) => !l.shown))})`);
  await phone.screenshot({ path: path.join(shotDir, "vault-phone.png") });
  await phone.close();
}

// --- Phone portrait: nothing scrolls sideways, and pairs of buttons share the
//     width evenly -------------------------------------------------------
//
// Three complaints, one cause each:
//
//  1. The sheet scrolled sideways with nothing off to either side. The grid
//     is a fixed 16 columns with a floor on cell size, so its box is about
//     790px and a phone has 344. customSheet.js now stacks the sheet below
//     that width; this checks the consequence - the PAGE has no horizontal
//     overflow and no scroller claims one, in Sheet View, Simple View and on
//     the Leveling tab, and the toggle says why rather than doing nothing.
//  2. Expand All / Collapse All were sized by their text (115px vs 124px)
//     and together covered less than half the row.
//  3. Return to Character Selection / Sign out likewise (153px vs 183px),
//     and their widths changed again with the length of the display name.
//
// Asserted at two phone widths (320 and 390) because these are exactly the
// kind of rule that happens to pass at one and fail at the other, and
// because 320 is the width the sheet's own grid floor (MIN_CELL_PX) makes
// impossible.
// Skipped under --smoke, and selectable with --only: it drives the sheet and
// the wizard at two phone widths, and the phone layout is not what a
// desktop-width smoke run can regress.
if (inArea("phone-layout")) {
for (const phoneWidth of [320, 390]) {
  {
    const sheet = await browser.newPage({ viewport: { width: phoneWidth, height: 844 } });
    sheet.on("pageerror", (e) => problems.push(`PAGEERROR [sheet@${phoneWidth}]: ${e.message}`));
    sheet.on("console", (m) => { if (m.type() === "error") problems.push(`CONSOLE [sheet@${phoneWidth}]: ${m.text()}`); });
    await sheet.goto(`${base}/demo.html`, { waitUntil: "networkidle" });
    await settled(sheet, READY_SHEET, `sheet sheet`);

    const geom = () => sheet.evaluate(() => {
      const de = document.documentElement;
      const wrap = document.querySelector(".page-grid-scroll");
      // Anything that would give the page a sideways scrollbar, and any
      // box that scrolls sideways inside itself.
      const sideways = [...document.querySelectorAll("body *")]
        .filter((el) => el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
        .map((el) => ({
          sel: el.tagName.toLowerCase() + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/)[0] : ""),
          client: el.clientWidth, scroll: el.scrollWidth,
        }));
      const toggle = [...document.querySelectorAll(".sheet-toolbar button")]
        .find((b) => /^(Sheet|Simple) View$/.test(b.textContent.trim()));
      return {
        pageScrollsSideways: de.scrollWidth > de.clientWidth + 1,
        pageWidths: { scroll: de.scrollWidth, client: de.clientWidth },
        wrapFits: wrap ? wrap.scrollWidth <= wrap.clientWidth + 1 : null,
        wrapOverflowX: wrap ? getComputedStyle(wrap).overflowX : null,
        stacked: !!document.querySelector(".page-grid.is-simple"),
        sideways: sideways.slice(0, 6),
        toggle: toggle ? { text: toggle.textContent.trim(), disabled: toggle.disabled, title: toggle.title } : null,
      };
    });

    const main = await geom();
    phoneCheck(!main.pageScrollsSideways,
      `@${phoneWidth} the sheet page does not scroll sideways (${JSON.stringify(main.pageWidths)})`);
    phoneCheck(main.wrapFits,
      `@${phoneWidth} the sheet fits its own scroller, so nothing is off to the side`);
    phoneCheck(main.wrapOverflowX === "hidden",
      `@${phoneWidth} the sheet's horizontal scroller is switched off while stacked (${main.wrapOverflowX})`);
    phoneCheck(main.stacked,
      `@${phoneWidth} the sheet is stacked, because the 16-column grid cannot fit this screen`);
    phoneCheck(!!main.toggle && main.toggle.disabled,
      `@${phoneWidth} the Sheet/Simple View toggle is disabled rather than silently doing nothing`);
    phoneCheck(!!main.toggle && /too narrow|too small|off on a screen/i.test(main.toggle.title),
      `@${phoneWidth} and it says why (${JSON.stringify((main.toggle?.title || "").slice(0, 60))})`);
    const clipping = main.sideways.filter((s) => /field-value|featurelist|input|select|textarea/.test(s.sel));
    phoneCheck(clipping.length === 0,
      `@${phoneWidth} and no field is cut off at its own edge (${JSON.stringify(clipping)})`);
    await sheet.screenshot({ path: path.join(shotDir, `sheet-phone-${phoneWidth}.png`) });

    // Widening the window has to bring Sheet View back, or the forced
    // stacking would be a one-way door.
    await sheet.setViewportSize({ width: 1440, height: 900 });
    await sheet.waitForTimeout(1400);
    const wide = await geom();
    phoneCheck(!wide.stacked,
      `@${phoneWidth} widening the window returns the sheet to the positioned grid`);
    phoneCheck(!!wide.toggle && !wide.toggle.disabled,
      `@${phoneWidth} and re-enables the view toggle`);

    // Back to phone width, and through the other tabs, so "all viewing
    // modes" is actually all of them.
    await sheet.setViewportSize({ width: phoneWidth, height: 844 });
    await sheet.waitForTimeout(1200);
    const tabCount = await sheet.evaluate(() => document.querySelectorAll(".sheet-tab").length);
    for (let t = 0; t < tabCount; t += 1) {
      await sheet.evaluate((i) => document.querySelectorAll(".sheet-tab")[i]?.click(), t);
      await quiet(sheet);
      const g = await geom();
      phoneCheck(!g.pageScrollsSideways,
        `@${phoneWidth} tab ${t} does not scroll sideways (${JSON.stringify(g.pageWidths)})`);
    }
    await sheet.close();
  }

  // The sheet itself, at every phone size and both orientations.
  //
  // Three things the review named, all measured on the demo sheet (a full
  // starter layout, so every block is present):
  //
  //  - every field was its own full-width box, so the sheet was 9,936px
  //    tall on a 390px phone: thirteen screens of one-number-per-row.
  //  - the six ability modifiers were six boxes labelled "MOD", thousands
  //    of pixels from the scores they belong to.
  //  - the toolbar was 404px of builder chrome before the first field.
  for (const [vpName, vp] of Object.entries(PHONE_VIEWPORTS)) {
    const ph = await browser.newPage({ viewport: vp, hasTouch: true });
    ph.on("pageerror", (e) => problems.push(`PAGEERROR [sheet@${vpName}]: ${e.message}`));
    await ph.route("**/fonts.googleapis.com/**", (r) => r.abort());
    await ph.goto(`${base}/demo.html`, { waitUntil: "networkidle" });
    await settled(ph, READY_SHEET, `phone sheet ${vpName}`);
    await ph.waitForTimeout(1200);
    const sh = await ph.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const shown = (el) => {
        if (!el) return false;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== "none" && r.width > 0 && r.height > 0;
      };
      const fieldOf = (id) => q(`.grid-node--field[data-node-id="${id}"]`);
      // Each modifier must sit in the SAME column as its own score: that is
      // the whole requirement, since "six boxes labelled MOD" is only wrong
      // because none of them says whose it is.
      const pairs = ["str", "dex", "con", "int", "wis", "cha"].map((a) => {
        const s = fieldOf(`${a}Score`);
        const m = fieldOf(`${a}Mod`);
        if (!s || !m) return null;
        const sr = s.getBoundingClientRect();
        const mr = m.getBoundingClientRect();
        return {
          scoreLabel: (s.querySelector(".field-label")?.textContent || "").trim(),
          modLabel: (m.querySelector(".field-label")?.textContent || "").trim(),
          // Beside its own score, on the same row, no more than one tile
          // away. "Six boxes labelled MOD" is only wrong because none of
          // them says whose it is.
          sameRow: Math.abs(sr.top - mr.top) < Math.max(sr.height, mr.height),
          adjacent: mr.left >= sr.right - 2 && mr.left - sr.right < sr.width,
        };
      }).filter(Boolean);
      const tb = q(".sheet-toolbar");
      const intro = q(".sheet-intro");
      // How many fields share a row. "One field per row" is the complaint,
      // and it is a property of the layout rather than of a pixel height -
      // a 375px-tall screen legitimately needs more scrolling than an
      // 844px one, so counting screens would only measure the phone.
      const rows = new Map();
      for (const f of document.querySelectorAll(".grid-node--field")) {
        const t = Math.round(f.getBoundingClientRect().top / 8) * 8;
        rows.set(t, (rows.get(t) || 0) + 1);
      }
      const counts = [...rows.values()];
      return {
        fields: counts.reduce((a, b) => a + b, 0),
        rows: counts.length,
        packed: counts.filter((n) => n >= 3).length,
        toolbarHeight: Math.round(tb.getBoundingClientRect().height),
        // What the first screen is supposed to show.
        firstScreen: [...tb.children].filter(shown).map((e) => (e.textContent || "").trim().slice(0, 20)),
        hasName: shown(tb.querySelector(".input-group__control")),
        hasLevelUp: shown(tb.querySelector(".level-up .btn")),
        hasSaveStatus: shown(tb.querySelector(".save-status")),
        builderVisible: shown(tb.querySelector(".sheet-toolbar__group")),
        editBtn: shown(tb.querySelector(".sheet-toolbar__edit-layout")),
        // The stacked layout is where the packing below applies; Sheet View
        // is the positioned grid, and reading it there would be reading a
        // layout this is not about.
        simple: !!document.querySelector(".page-grid.is-simple"),
        pairs,
        intro: intro
          ? { height: Math.round(intro.getBoundingClientRect().height),
              gotItTop: Math.round(intro.querySelector(".sheet-intro__dismiss").getBoundingClientRect().top) }
          : null,
        // Inspiration: a caption BESIDE its checkbox, not under it.
        inspirationBeside: (() => {
          const box = fieldOf("inspiration");
          const caption = box?.nextElementSibling;
          if (!box || !caption || !shown(box) || !shown(caption)) return null;
          const br = box.getBoundingClientRect();
          const cr = caption.getBoundingClientRect();
          return Math.abs(br.top - cr.top) < Math.max(br.height, cr.height);
        })(),
        sideScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    // Packed means FEWER ROWS THAN FIELDS, not "lots of rows of exactly
    // three". A field that carries the Adv./Disadvantage pill takes two
    // columns so the pill fits beside its value, so a three-wide grid
    // holds a mix of one, two and three across - and the number that
    // matters is how many rows the 141 fields are spread over, against
    // the one-field-per-row it used to be.
    phoneCheck(sh.rows < sh.fields * 0.6 && sh.packed >= 10,
      `@${vpName} the sheet is packed, not one field per row (${sh.rows} rows for ${sh.fields} fields, ${sh.packed} of them 3+ across)`);
    // Only meaningful in the stacked layout; skip it rather than fail when
    // the reader is looking at the editable grid on purpose.
    if (sh.simple) {
      phoneCheck(sh.pairs.length === 6 && sh.pairs.every((p) => p.sameRow && p.adjacent),
        `@${vpName} every ability modifier sits beside its own score (${JSON.stringify(sh.pairs.map((p) => [p.scoreLabel, p.sameRow, p.adjacent]))})`);
    }


      // Item 6, in one assertion: on a short viewport, no visible field
      // label or value may be clipped by its own box, and no two of them
      // may overlap. This is the scan that catches the Adv./Disadvantage
      // pill sitting on the "MOD" labels and the 40px cells that clipped
      // seventy values - both of which were real at 844x390 and neither of
      // which a "does it scroll sideways" check would ever see.
      if (vp.height <= 480) {
        const scan = await ph.evaluate(() => {
          const shown = (el) => {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 1 && r.height > 1;
          };
          const nodes = [...document.querySelectorAll(".field-label, .field-value, .block-name, .field-roll")]
            .filter(shown)
            .map((el) => ({ el, r: el.getBoundingClientRect() }));
          const clipped = nodes
            .filter(({ el }) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
            .slice(0, 6)
            .map(({ el }) => `${el.className}|${(el.textContent || "").trim().slice(0, 20)}`);
          const overlaps = [];
          for (let i = 0; i < nodes.length && overlaps.length < 6; i += 1) {
            for (let j = i + 1; j < nodes.length && overlaps.length < 6; j += 1) {
              const a = nodes[i];
              const b = nodes[j];
              if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
              const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
              const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
              // 3px of slack: adjacent grid cells and a label sitting
              // directly on its value's border line are not overlaps.
              if (ox > 3 && oy > 3) {
                overlaps.push(`${(a.el.textContent || "").trim().slice(0, 12)} x{(b.el.textContent || "").trim().slice(0, 12)}`);
              }
            }
          }
          return { clipped, overlaps };
        });
        phoneCheck(scan.clipped.length === 0 && scan.overlaps.length === 0,
          `@${vpName} no field label or value is clipped or overlapped (${scan.clipped.length} clipped ${JSON.stringify(scan.clipped)}, ${scan.overlaps.length} overlapping ${JSON.stringify(scan.overlaps)})`);
      }

    phoneCheck(sh.toolbarHeight <= 200 && !sh.builderVisible && sh.editBtn,
      `@${vpName} the builder chrome is behind one "Edit layout" tap (toolbar ${sh.toolbarHeight}px, builder visible: ${sh.builderVisible})`);
    phoneCheck(sh.hasName && sh.hasLevelUp && sh.hasSaveStatus,
      `@${vpName} and the first screen shows the name, Level Up and the save status (${JSON.stringify(sh.firstScreen)})`);
    phoneCheck(sh.inspirationBeside !== false,
      `@${vpName} Inspiration is a checkbox with its caption beside it, not underneath`);
    if (sh.intro) {
      phoneCheck(sh.intro.height <= 340 && sh.intro.gotItTop <= vp.height,
        `@${vpName} the first-run panel is a panel, not a screen (${sh.intro.height}px, "Got it" at ${sh.intro.gotItTop})`);
    }
    phoneCheck(!sh.sideScroll, `@${vpName} the sheet does not scroll sideways`);
    await ph.screenshot({ path: path.join(shotDir, `sheet-phone-${vpName}.png`) });

    // Every visible target on the sheet, not just the ones a given block
    // happens to use. This is the sweep that found the last three:
    // ".textlist-add" was 336x22 - 22px tall, which is the height of a line
    // of text - and it is the only way to add a row to Backstory,
    // Appearance, the proficiencies and the equipment.
    //
    // The same hit-box rule as the level-up check below: a checkbox is
    // pressed through its <label>, the roll pill is pressed somewhere on the
    // row, so measuring the <input> or the <button> alone would fail
    // controls that are properly hittable. 44x44 WITH SPACING, per the brief,
    // so a row of 44px-tall pills with 2px between them passes.
    const hits = await ph.evaluate(() => {
      const shown = (e) => {
        const cs = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
      };
      const hitBox = (e) => e.closest("label") || e.closest(".field-roll") || e;
      const small = new Map();
      let total = 0;
      for (const e of document.querySelectorAll('button, a[href], input, select, textarea, summary, [role="button"], [onclick]')) {
        if (!shown(e)) continue;
        total += 1;
        const hr = hitBox(e).getBoundingClientRect();
        if (hr.width >= 44 && hr.height >= 44) continue;
        const r = e.getBoundingClientRect();
        const key = `${e.tagName.toLowerCase()}.${(typeof e.className === "string" ? e.className : "").trim().split(/\s+/).slice(0, 2).join(".")}`;
        small.set(`${key}|${Math.round(r.width)}x${Math.round(r.height)}`,
          `${key} ${Math.round(r.width)}x${Math.round(r.height)} in ${Math.round(hr.width)}x${Math.round(hr.height)}`);
      }
      return { total, small: [...small.values()], count: small.size };
    });
    phoneCheck(hits.count === 0,
      `@${vpName} every visible control on the sheet clears 44x44 (${hits.total} targets, ${hits.count} short ${JSON.stringify(hits.small.slice(0, 5))})`);

    // The Leveling tab's walkthrough, on the same demo sheet. Two things
    // this catches, both of which a "does it scroll sideways" check is
    // blind to: the At a Glance / Walkthrough tabs sitting BELOW the fold
    // (they used to land at y=577 on a 390px-tall viewport, behind a
    // four-sentence paragraph), and every control in the panel being under
    // 44px - the tabs were 37, the rest buttons 20, the walkthrough's own
    // choice boxes 16.
    await ph.evaluate(() => {
      [...document.querySelectorAll(".sheet-tab")].find((x) => /leveling/i.test(x.textContent))?.click();
    });
    await ph.waitForTimeout(700);
    const lev = await ph.evaluate(() => {
      const panel = document.querySelector(".page-grid--leveling");
      const shown = (e) => {
        const cs = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 1 && r.height > 1;
      };
      const tabs = [...document.querySelectorAll(".leveling-subtabs__tab")].filter(shown)
        .map((b) => { const r = b.getBoundingClientRect();
          return { t: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; });
      // A target counts if the thing you actually press clears 44: for a
      // checkbox that is its <label>, not the box inside it.
      const small = [];
      // What the reader presses is not always the element: a checkbox is
      // pressed through its <label>, and a row of pill buttons is pressed
      // somewhere on the row. So the box that has to clear 44 is the
      // nearest enclosing label, or - for the roll pill - the .field-roll
      // wrapper around the buttons. Measuring the <input> itself would
      // fail a control that is properly hittable.
      const hitBox = (e) => e.closest("label") || e.closest(".field-roll") || e;
      for (const e of panel.querySelectorAll('button, input, select, textarea, [role="button"]')) {
        if (!shown(e)) continue;
        const hit = hitBox(e);
        const hr = hit.getBoundingClientRect();
        const r = e.getBoundingClientRect();
        if (hr.height < 44 || hr.width < 44) {
          small.push(`${(e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 14)} ${Math.round(r.width)}x${Math.round(r.height)} in ${Math.round(hr.width)}x${Math.round(hr.height)}`);
        }
      }
      return { tabs, small: [...new Set(small)].slice(0, 6), smallCount: small.length,
        // The legacy note must not be there for a character with nothing
        // recorded - that is the bug this tab had.
        revert: document.querySelector(".leveling-revert")?.textContent?.trim() || null,
        sideScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
    });
    phoneCheck(lev.tabs.length === 2 && lev.tabs.every((t) => t.w >= 44 && t.h >= 44 && t.top < vp.height),
      `@${vpName} both Leveling tabs are 44px and on screen (${JSON.stringify(lev.tabs)})`);
    phoneCheck(lev.smallCount === 0,
      `@${vpName} nothing in the level-up panel is under 44px (${lev.smallCount} ${JSON.stringify(lev.small)})`);
    phoneCheck(lev.revert === null,
      `@${vpName} and a character with no level-ups recorded is not told one "was recorded before reverting existed" (${JSON.stringify(lev.revert)})`);
    phoneCheck(!lev.sideScroll, `@${vpName} the Leveling tab does not scroll sideways`);
    await ph.screenshot({ path: path.join(shotDir, `leveling-phone-${vpName}.png`) });
    await ph.close();
  }

  {
    // The wizard: the two pairs of buttons, on a page that is the same one
    // at every phone width.
    const wiz = await browser.newPage({ viewport: { width: phoneWidth, height: 844 } });
    wiz.on("pageerror", (e) => problems.push(`PAGEERROR [wiz@${phoneWidth}]: ${e.message}`));
    wiz.on("console", (m) => { if (m.type() === "error") problems.push(`CONSOLE [wiz@${phoneWidth}]: ${m.text()}`); });
    await wiz.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
    await settled(wiz, READY_VAULT, `wiz vault`);
    await wiz.click(READY_VAULT);
    await settled(wiz, READY_WIZARD, `wiz wizard`);

    const auth = await wiz.evaluate(() => {
      const area = document.getElementById("auth-area");
      const cs = getComputedStyle(area);
      const gap = parseFloat(cs.columnGap || cs.gap || "0") || 0;
      const kids = [...area.children].filter((k) => k.getBoundingClientRect().width > 0);
      const widths = kids.map((k) => k.getBoundingClientRect().width);
      const areaWidth = area.getBoundingClientRect().width;
      return {
        labels: kids.map((k) => k.textContent.trim()),
        widths: widths.map((w) => Math.round(w)),
        areaWidth: Math.round(areaWidth),
        gap: Math.round(gap),
        equal: widths.length === 2 && Math.abs(widths[0] - widths[1]) <= 1,
        // "Together they span the row" has to allow for the one gap
        // between them - `flex: 1 1 0` divides what is LEFT after the gap,
        // so asking for the full area would fail on a correct layout.
        fills: widths.reduce((a, b) => a + b, 0) >= areaWidth - gap - 2,
      };
    });
    phoneCheck(auth.labels.some((l) => /Return to Character/i.test(l)),
      `@${phoneWidth} the header has the return and sign-out buttons (${JSON.stringify(auth.labels)})`);
    phoneCheck(auth.equal,
      `@${phoneWidth} and they are the SAME width (${JSON.stringify(auth.widths)} of ${auth.areaWidth})`);
    phoneCheck(auth.fills,
      `@${phoneWidth} spanning the whole row between them (${JSON.stringify(auth.widths)} + gap ${auth.gap} in ${auth.areaWidth})`);

    // Land on the Identity page, which is where every picker - and every
    // Expand All / Collapse All bar - lives.
    await wiz.evaluate(() => {
      const dots = [...document.querySelectorAll(".wizard__dot")];
      const identity = dots.find((d) => /identity/i.test(d.title + " " + d.getAttribute("aria-label")));
      (identity || dots[1] || dots[0]).click();
    });
    await wiz.waitForTimeout(1400);

    const bars = await wiz.evaluate(() => {
      const out = [];
      for (const bar of document.querySelectorAll(".choice-row-list__collapse-controls")) {
        const kids = [...bar.children];
        const widths = kids.map((k) => k.getBoundingClientRect().width);
        const barW = bar.getBoundingClientRect().width;
        // The PARENT's content box, not the bar's own: the bar sits inside
        // the page's padding, so "the full width available" is the parent's
        // content width and not its border box.
        const pcs = getComputedStyle(bar.parentElement);
        const inset = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"]
          .reduce((sum, k) => sum + parseFloat(pcs[k] || "0"), 0);
        const contentW = bar.parentElement.getBoundingClientRect().width - inset;
        out.push({
          labels: kids.map((k) => k.textContent.trim()),
          widths: widths.map((w) => Math.round(w)),
          equal: widths.length === 2 && Math.abs(widths[0] - widths[1]) <= 1,
          spansParent: Math.abs(barW - contentW) <= 2,
          barW: Math.round(barW),
          contentW: Math.round(contentW),
        });
      }
      return out;
    });
    phoneCheck(bars.length > 0, `@${phoneWidth} the page offers an Expand All / Collapse All bar (${bars.length})`);
    for (const bar of bars) {
      phoneCheck(bar.equal,
        `@${phoneWidth} Expand All and Collapse All are the same width (${JSON.stringify(bar.widths)})`);
      phoneCheck(bar.spansParent,
        `@${phoneWidth} and together span the full width available (${bar.barW} of ${bar.contentW})`);
    }

    // No wizard page may scroll sideways, whatever is on it.
    for (let step = 0; step < 7; step += 1) {
      const o = await wiz.evaluate(() => {
        const de = document.documentElement;
        return { scrolls: de.scrollWidth > de.clientWidth + 1, s: de.scrollWidth, c: de.clientWidth };
      });
      phoneCheck(!o.scrolls, `@${phoneWidth} wizard step ${step} does not scroll sideways (${o.s}/${o.c})`);
      const moved = await wiz.evaluate(() => {
        const next = document.querySelector(".wizard button.wizard__next:not([disabled])");
        if (next) { next.click(); return true; }
        const dot = [...document.querySelectorAll(".wizard__dot")].find((d) => !d.classList.contains("active") && !d.disabled);
        if (dot) { dot.click(); return true; }
        return false;
      });
      await wiz.waitForTimeout(800);
      if (!moved) break;
    }
    await wiz.close();
  }
}

  // The wizard's own chrome, at every phone size and both orientations.
  //
  // Three renderings of one number, two forward controls, one of them
  // dimmed for a reason only a tooltip carried, and a content column
  // with a gutter on one side only. Measured on the Identity step, which
  // is the one that is gated. Its own page per size, outside the
  // phoneWidth loop above: these are four different viewports rather than
  // two widths of one, and the loop above drives the sheet too.
  for (const [vpName, vp] of Object.entries(PHONE_VIEWPORTS)) {
    const wiz = await browser.newPage({ viewport: vp, hasTouch: true });
      wiz.on("pageerror", (e) => problems.push(`PAGEERROR [wiz@${vpName}]: ${e.message}`));
      wiz.on("console", (m) => { if (m.type() === "error") problems.push(`CONSOLE [wiz@${vpName}]: ${m.text()}`); });
      await wiz.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
      await settled(wiz, READY_VAULT, `wiz vault ${vpName}`);
      await wiz.click(READY_VAULT);
      await settled(wiz, READY_WIZARD, `wiz wizard ${vpName}`);
      await wiz.evaluate(() => {
        const dots = [...document.querySelectorAll(".wizard__dot")];
        const identity = dots.find((d) => /identity/i.test((d.title || "") + " " + (d.getAttribute("aria-label") || "")));
        (identity || dots[1] || dots[0]).click();
      });
      await wiz.waitForTimeout(1000);
      const c = await wiz.evaluate(() => {
        const shown = (el) => {
          if (!el) return false;
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
        };
        const body = document.querySelector(".wizard__body");
        const nexts = [...document.querySelectorAll(".wizard button.wizard__next")].filter(shown);
        const nav = nexts[0]?.closest(".wizard__nav");
        const reason = nav?.querySelector(".wizard__gate-reason");
        const select = document.querySelector(".wizard__step-select");
        const cs = body ? getComputedStyle(body) : null;
        return {
          vh: window.innerHeight,
          pillsShown: shown(document.querySelector(".wizard__dots")),
          barShown: shown(document.querySelector(".wizard__bar")),
          counter: document.querySelector(".wizard__counter")?.textContent.trim() || "",
          selectShown: shown(select),
          selectOpts: select ? [...select.options].length : 0,
          selectLocked: select ? [...select.options].filter((o) => o.disabled).length : 0,
          nextCount: nexts.length,
          nextDisabled: nexts.length ? nexts[0].disabled : null,
          navPinned: nav ? Math.abs(nav.getBoundingClientRect().bottom - window.innerHeight) < 4 : false,
          arrowShown: shown(document.querySelector(".wizard__edge-next")),
          reason: reason && shown(reason) ? reason.textContent.trim() : null,
          pad: cs ? [cs.paddingLeft, cs.paddingRight] : null,
          chromePct: body ? Math.round((100 * body.getBoundingClientRect().top) / window.innerHeight) : null,
          sideScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        };
      });
      phoneCheck(!c.pillsShown && !c.barShown && c.selectShown && /^Step \d+ of \d+$/.test(c.counter),
        `@${vpName} the stepper is one line: counter + a tappable dropdown, no pill rows, no third copy of the number (${JSON.stringify(c.counter)}, ${c.selectOpts} options, ${c.selectLocked} locked)`);
      phoneCheck(c.nextCount === 1 && !c.arrowShown && c.navPinned,
        `@${vpName} one forward control, pinned to the bottom (next:${c.nextCount}, edge arrow:${c.arrowShown}, pinned:${c.navPinned})`);
      phoneCheck(c.nextDisabled === true && !!c.reason,
        `@${vpName} and a blocked Next says why on the page ("${c.reason}")`);
      phoneCheck(!c.pad || c.pad[0] === c.pad[1],
        `@${vpName} the content gutters are symmetric (${JSON.stringify(c.pad)})`);

      // The species list is the longest thing in the wizard: 40-odd rows,
      // each one a portrait, a name and a description of any length. The
      // fix is a thumbnail BESIDE the name and a two-line clamp, so the
      // rows are short enough to scan - and two columns when the screen is
      // sideways, where there is width to spare and no height.
      const pick = await wiz.evaluate(() => {
        const rows = [...document.querySelectorAll(".choice-row")];
        const list = document.querySelector(".choice-row-list");
        const first = rows[0];
        const portrait = first?.querySelector(".choice-row__portrait")?.getBoundingClientRect();
        const label = first?.querySelector(".choice-row__label")?.getBoundingClientRect();
        const desc = first?.querySelector(".choice-row__description");
        return {
          rows: rows.length,
          height: first ? Math.round(first.getBoundingClientRect().height) : null,
          listHeight: list ? Math.round(list.getBoundingClientRect().height) : null,
          columns: list ? getComputedStyle(list).gridTemplateColumns.split(" ").length : 1,
          clamp: desc ? getComputedStyle(desc).webkitLineClamp : null,
          // Beside, not above: the label starts to the RIGHT of the art.
          beside: portrait && label ? label.left >= portrait.right - 1 : null,
        };
      });
      phoneCheck(pick.rows > 5 && pick.height <= 130,
        `@${vpName} each species row is compact enough to scan (${pick.rows} rows, ${pick.height}px tall, list ${pick.listHeight}px)`);
      phoneCheck(pick.beside === true,
        `@${vpName} with the thumbnail beside the name, not above it`);
      if (vp.height <= 480) {
        phoneCheck(pick.columns === 2,
          `@${vpName} and two columns of them, since sideways has width to spare (${pick.columns})`);
      }

      phoneCheck(!c.sideScroll, `@${vpName} the wizard does not scroll sideways`);
      await wiz.close();
    }

  // --- The welcome screen ---------------------------------------------------
  // The one file this whole change is not supposed to restyle, so the check
  // is deliberately narrow: on a phone the card fits and the button is on the
  // screen. It was 378px tall starting 32px down on a 390px-tall viewport, so
  // the button - the only thing on the page you can act on - sat below the
  // fold, and the document was 442px against 390.
  {
    for (const [vpName, vp] of Object.entries(PHONE_VIEWPORTS)) {
      const wc = await browser.newPage({ viewport: vp, hasTouch: true, isMobile: true });
      wc.on("pageerror", (e) => problems.push(`PAGEERROR [welcome@${vpName}]: ${e.message}`));
      await wc.route("**/fonts.googleapis.com/**", (r) => r.abort());
      await wc.goto(`${base}/welcome.html`, { waitUntil: "networkidle" });
      await wc.waitForSelector(".cta", { state: "attached", timeout: 20000 });
      await wc.waitForTimeout(250);
      const w = await wc.evaluate(() => {
        const cta = document.querySelector(".cta").getBoundingClientRect();
        const card = document.querySelector("main.card")?.getBoundingClientRect();
        const de = document.documentElement;
        return {
          fits: de.scrollHeight <= de.clientHeight + 1,
          docH: de.scrollHeight, vh: de.clientHeight,
          ctaOnScreen: cta.top >= 0 && cta.bottom <= de.clientHeight,
          ctaH: Math.round(cta.height),
          cardH: card ? Math.round(card.height) : null,
          h1: document.querySelector(".intro h1")?.textContent.trim() || null,
          artVisible: getComputedStyle(document.querySelector(".art")).display !== "none",
        };
      });
      phoneCheck(w.fits && w.ctaOnScreen,
        `@${vpName} the welcome card fits the screen and its button is on it (${w.docH}/${w.vh}, card ${w.cardH}px, button ${w.ctaH}px at ${w.ctaOnScreen})`);
      // Nothing about the page changed but the air around it.
      phoneCheck(w.h1 === "Welcome" && w.artVisible && w.ctaH >= 44,
        `@${vpName} and it is still the same page - same heading, art still there, button still a target (${JSON.stringify([w.h1, w.artVisible, w.ctaH])})`);
      await wc.close();
    }
  }

  // --- The header, at every phone size and both orientations ---------------
  //
  // What the review found was a header that wrapped "Return to Character
  // Selection" onto three lines inside a 167px half-row - 140px of an 844px
  // screen, 16.6%, on every screen - and a doubled-bracket sign-out label:
  // the local player's display name is "Local Player (this browser)", so
  // `Sign out (${name})` printed the brackets twice.
  //
  // Read back as measurements rather than as class names, because what
  // matters is that the header is ONE row, is not a sixth of the screen,
  // that the label you can SEE is short while the accessible name is the
  // full sentence, and that no label is wider than the box it sits in.
  //
  // Its own page per size, outside the phoneWidth loop above: these are
  // four different viewports rather than two widths of one, and the
  // loop above drives the sheet and the wizard as well.
  for (const [vpName, vp] of Object.entries(PHONE_VIEWPORTS)) {
    const hdr = await browser.newPage({ viewport: vp, hasTouch: true });
    hdr.on("pageerror", (e) => problems.push(`PAGEERROR [header@${vpName}]: ${e.message}`));
    await hdr.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
    await settled(hdr, READY_VAULT, `header vault ${vpName}`);
    const h = await hdr.evaluate(() => {
      const head = document.querySelector(".app-header");
      const hr = head.getBoundingClientRect();
      const btns = [...document.getElementById("auth-area").children]
        .filter((k) => k.getBoundingClientRect().width > 0)
        .map((k) => {
          const r = k.getBoundingClientRect();
          const shown = [...k.querySelectorAll(".auth-label")]
            .find((s) => getComputedStyle(s).display !== "none");
          return {
            aria: k.getAttribute("aria-label") || "",
            shown: shown ? shown.textContent.trim() : k.textContent.trim(),
            h: Math.round(r.height),
            // A label wider than its own button is the three-line wrap again.
            overflows: shown ? shown.scrollWidth > shown.clientWidth + 1 : false,
          };
        });
      return {
        height: Math.round(hr.height),
        pct: Math.round((100 * hr.height) / window.innerHeight),
        direction: getComputedStyle(head).flexDirection,
        btns,
        sideScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    phoneCheck(h.direction === "row" && h.height <= 70,
      `@${vpName} the header is one slim row (${h.direction}, ${h.height}px of ${vp.height} = ${h.pct}%)`);
    phoneCheck(h.pct <= 15,
      `@${vpName} and takes no more than a seventh of the height (${h.pct}%)`);
    phoneCheck(h.btns.every((b) => b.shown.length <= 14),
      `@${vpName} the labels on screen are short (${JSON.stringify(h.btns.map((b) => b.shown))})`);
    phoneCheck(h.btns.every((b) => b.aria.length > b.shown.length),
      `@${vpName} while the accessible name is still the full sentence (${JSON.stringify(h.btns.map((b) => b.aria))})`);
    phoneCheck(h.btns.every((b) => !b.overflows) && !h.sideScroll,
      `@${vpName} and no label overflows its button or the page`);
    phoneCheck(!/\([^)]*\([^)]*\)/.test(h.btns.map((b) => b.aria).join(" ")),
      `@${vpName} and neither label has doubled brackets (${JSON.stringify(h.btns.map((b) => b.aria))})`);
    await hdr.close();
  }
}

// --- Phone / tablet / laptop, swept in one place ----------------------------
//
// Skipped under --smoke: it re-walks ten widths to check boundary behaviour
// that no single-width smoke run can regress, and it is one of the two
// slowest standalone blocks. Its failure mode is a layout that is subtly
// wrong at one specific width - worth the full run, not worth interrupting
// an edit for.
// (The per-viewport runs below already assert that the sheet does not scroll
// sideways AT their width, so a gross overflow is still caught in smoke.)
//
//
// The per-viewport runs above each pick one width and assert a great deal at
// it. What none of them asserted is the BOUNDARIES, and the boundaries are
// where responsive work actually breaks: a rule that is right at 834px and
// wrong at 861px is invisible to a test that only ever visits 834.
//
// Three bands matter here, and each has its own question:
//
//  - Phone (320-600): everything stacks and nothing scrolls sideways. Covered
//    above at two widths; included in the sweep so the whole ladder is one
//    run and one report.
//  - The band the app itself creates: the positioned grid has a hard
//    minimum of about 790px, so the sheet is STACKED on a tablet and in
//    Sheet View on a laptop. Nothing may scroll sideways in that band
//    either - it is a stacked sheet on a screen that has room, which is
//    precisely the case a phone-only test never reaches.
//  - Laptop (1024+): the grid fits, Sheet View is available again, and the
//    grid is laid out rather than crushed.
//
// The stacking threshold is asserted as a MEASUREMENT, not as a literal: the
// grid's own declared width against its scroller's width is the same
// comparison `narrowScreenNeedsStackedView` makes, so this pins that the
// app's decision and its own reason for it cannot disagree. Reading it back
// out of the rendered sheet also means the sweep keeps working if MIN_CELL_PX
// or the column count ever change, which is the point of keeping that rule a
// predicate over a measurement rather than a hard-coded 800px.
if (inArea("widths-sweep")) {
  const ladder = [320, 390, 600, 720, 721, 834, 900, 1024, 1280, 1440];
  const sweep = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  sweep.on("pageerror", (e) => problems.push(`PAGEERROR [widths @${sweep.viewportSize().width}]: ${e.message}`));
  sweep.on("console", (m) => { if (m.type() === "error") problems.push(`CONSOLE [widths]: ${m.text()}`); });
  await sweep.goto(`${base}/demo.html`, { waitUntil: "networkidle" });
  await settled(sweep, READY_SHEET, `sweep sheet`);

  // Where the grid stopped fitting, so the assertions below can be stated as
  // "the sheet agreed with its own measurement" rather than as a magic
  // number that has to be re-guessed when the grid changes.
  const measure = () => sweep.evaluate(() => {
    const de = document.documentElement;
    const grid = document.querySelector(".page-grid");
    const scroller = document.querySelector(".page-grid-scroll");
    const toggle = [...document.querySelectorAll(".sheet-toolbar button")]
      .find((b) => /^(Sheet|Simple) View$/.test((b.textContent || "").trim()));
    const declared = parseFloat(grid?.style?.width || "0") || 0;
    return {
      vw: window.innerWidth,
      stacked: !!document.querySelector(".page-grid.is-simple"),
      declaredGrid: declared,
      scroller: scroller ? scroller.clientWidth : 0,
      // The rule itself, recomputed here rather than read off a class, so a
      // stale class left behind by a resize would be caught.
      shouldStack: declared > 0 && (scroller?.clientWidth || 0) > 0
        ? declared > scroller.clientWidth + 1 : null,
      pageScrollsSideways: de.scrollWidth > de.clientWidth + 1,
      page: { scroll: de.scrollWidth, client: de.clientWidth },
      toggle: toggle
        ? { text: (toggle.textContent || "").trim(), disabled: toggle.disabled, title: toggle.title }
        : null,
      cellPx: (() => {
        const cell = document.querySelector(".grid-cell, .grid-node");
        return cell ? Math.round(cell.getBoundingClientRect().width) : null;
      })(),
    };
  });

  let lastStacked = null;
  let firstUnstacked = null;
  for (const w of ladder) {
    await sweep.setViewportSize({ width: w, height: 900 });
    await sweep.waitForTimeout(950);
    const m = await measure();

    widthCheck(m.vw === w, `@${w} the window really is ${w}px (got ${m.vw})`);
    widthCheck(!m.pageScrollsSideways,
      `@${w} the sheet does not scroll sideways (${m.page.scroll}/${m.page.client})`);
    if (m.shouldStack !== null) {
      widthCheck(m.stacked === m.shouldStack,
        `@${w} the layout agrees with the measurement (grid ${Math.round(m.declaredGrid)}px in ${m.scroller}px, stacked=${m.stacked}, should=${m.shouldStack})`);
    }
    if (m.stacked) {
      lastStacked = w;
      widthCheck(!!m.toggle && m.toggle.disabled,
        `@${w} where the sheet is stacked by width the view toggle refuses (${JSON.stringify(m.toggle?.text)})`);
      widthCheck(!!m.toggle && m.toggle.text === "Sheet View",
        `@${w} and names the view it cannot go to (got "${m.toggle?.text}")`);
    } else {
      if (firstUnstacked === null) firstUnstacked = w;
      widthCheck(!!m.toggle && !m.toggle.disabled,
        `@${w} where the grid fits the view toggle is live again (${JSON.stringify(m.toggle?.text)})`);
      widthCheck(!!m.toggle && m.toggle.text === "Simple View",
        `@${w} and offers Simple View (got "${m.toggle?.text}")`);
      // A cell at the floor is the whole reason for stacking. Anything
      // narrower than MIN_CELL_PX in Sheet View means the floor is being
      // breached and the stacking rule has stopped matching the grid.
      widthCheck(m.cellPx === null || m.cellPx >= 40,
        `@${w} a grid cell is never crushed below the 40px floor (got ${m.cellPx}px)`);
    }
  }

  widthCheck(lastStacked !== null && firstUnstacked !== null,
    `the ladder crosses the stacking threshold rather than sitting on one side of it (stacked up to ${lastStacked}px, unstacked from ${firstUnstacked}px)`);
  widthCheck(lastStacked !== null && lastStacked > PHONE_CEILING_PX,
    `the threshold is not the phone breakpoint: it is set by the grid's own minimum, so a tablet is stacked too (stacked up to ${lastStacked}px, phone ceiling ${PHONE_CEILING_PX}px)`);
  widthCheck(firstUnstacked !== null && firstUnstacked <= 1100,
    `and it lands below a laptop (unstacked from ${firstUnstacked}px)`);
  await sweep.screenshot({ path: path.join(shotDir, "widths-final.png") });
  await sweep.close();
}

// --- Level-gated text in the picker, without a reload ----------------------
//
// The Duergar Magic grant names two unlocks at two levels in one piece of
// prose, so a level 1 character used to be told it casts Enlarge/Reduce from
// level 3. This drives the real wizard: set the level, read the bullet, raise
// the level, read it again - in the SAME page, with no reload between. That
// last part is the point, and it is why this is an e2e check rather than
// only a unit test.
if (inArea("levelgated-text")) {
  const lg = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  lg.on("pageerror", (e) => problems.push(`PAGEERROR [levelgate]: ${e.message}`));
  lg.on("console", (m) => { if (m.type() === "error") problems.push(`CONSOLE [levelgate]: ${m.text()}`); });
  await lg.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
  await settled(lg, READY_VAULT, `lg vault`);
  await lg.click(READY_VAULT);
  await settled(lg, READY_WIZARD, `lg wizard`);
  await lg.evaluate(() => {
    const dots = [...document.querySelectorAll(".wizard__dot")];
    const identity = dots.find((d) => /identity/i.test(d.title + " " + d.getAttribute("aria-label")));
    (identity || dots[1] || dots[0]).click();
  });
  await lg.waitForTimeout(1400);
  // Pick the container race, then its Duergar, so the subrace row is there.
  await lg.evaluate(() => {
    const dwarf = [...document.querySelectorAll(".choice-row[data-row-name='Dwarf']")][0];
    dwarf?.click();
  });
  await lg.waitForTimeout(1200);
  await lg.evaluate(() => {
    const duergar = [...document.querySelectorAll(".choice-row--nested[data-row-name='Duergar']")][0];
    duergar?.click();
  });
  await lg.waitForTimeout(1400);

  const readMagic = () => lg.evaluate(() => {
    const row = document.querySelector(".choice-row--nested[data-row-name='Duergar']");
    if (!row) return null;
    const details = row.querySelector(".choice-row__details");
    const text = (details || row).textContent.replace(/\s+/g, " ");
    const hit = /Duergar Magic\s*[:—-]\s*([^]*?)(?=Sunlight Sensitivity|$)/.exec(text);
    return { whole: text, magic: hit ? hit[1].trim() : "" };
  });
  const setLevel = async (value) => {
    await lg.evaluate((v) => {
      const input = document.querySelector(".wizard input[type='number']");
      if (!input) return;
      input.value = String(v);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await lg.waitForTimeout(1300);
  };

  await setLevel(1);
  const atOne = await readMagic();
  phoneCheck(!!atOne, `the Duergar row is on screen (${JSON.stringify(atOne?.whole?.slice(0, 60))})`);
  phoneCheck(!/Duergar Magic/.test(atOne?.whole || ""),
    "a level 1 Duergar is told about no Duergar Magic at all");
  phoneCheck(!/Enlarge/.test(atOne?.whole || "") && !/Invisibility/.test(atOne?.whole || ""),
    "and specifically not about the level 3 or level 5 unlocks");

  await setLevel(3);
  const atThree = await readMagic();
  phoneCheck(/Duergar Magic/.test(atThree?.whole || ""),
    "raising the level to 3 pops the trait in, with no reload");
  phoneCheck(/Enlarge\/Reduce/.test(atThree?.whole || ""),
    "and at 3 it names the level 3 spell");
  phoneCheck(!/Invisibility/.test(atThree?.whole || ""),
    "while the level 5 spell is still hidden");

  await setLevel(4);
  const atFour = await readMagic();
  phoneCheck(/Enlarge\/Reduce/.test(atFour?.whole || "") && !/Invisibility/.test(atFour?.whole || ""),
    "at 4 it is unchanged, because the second unlock is a level 5 one");

  await setLevel(5);
  const atFive = await readMagic();
  phoneCheck(/Enlarge\/Reduce/.test(atFive?.whole || "") && /Invisibility/.test(atFive?.whole || ""),
    "at 5 the second unlock appears");

  // Back down again, because a level can be lowered and a gate that only
  // ever adds is not a gate.
  await setLevel(1);
  const backToOne = await readMagic();
  phoneCheck(!/Duergar Magic/.test(backToOne?.whole || ""),
    "and lowering the level again takes it away");

  // The spell's real name is what the link has to resolve against.
  phoneCheck(/Enlarge\/Reduce/.test(atFive?.whole || "") && !/Enlarge Reduce/.test(atFive?.whole || ""),
    `the spell is named Enlarge/Reduce (${JSON.stringify((atFive?.magic || "").slice(0, 60))})`);
  await lg.close();
}

// --- A click inside a row selects that row ---------------------------------

//
// Two different controls, two different answers, and the difference is not a
// detail. Selecting a row re-renders the page, which replaces every node in
// it:
//
//   - A PICKER LINK opens a dialog that lives outside the row, so selecting on
//     click is free: the link's own handler is already on the event path and
//     still runs after the re-render. Clicking it selects the row AND opens
//     the dialog.
//   - A NATIVE <select> cannot be re-rendered mid-click. Its popup opens on
//     the element, and a detached element has no popup - so clicking one
//     selects nothing, and the row must not collapse either. It selects the
//     row on `change` instead, the moment a value is actually committed.
//
// The regression this guards is subtle: a bubble-phase listener would see
// NEITHER control, because both stop propagation in their own handlers, and
// the check would pass on a row that simply never got selected.
if (inArea("rowclick")) {
  const cr = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  cr.on("pageerror", (e) => problems.push(`PAGEERROR [rowclick]: ${e.message}`));
  await cr.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
  await settled(cr, READY_VAULT, `cr vault`);
  await cr.click(READY_VAULT);
  await settled(cr, READY_WIZARD, `cr wizard`);
  for (let hop = 0; hop < 14; hop++) {
    if (await cr.evaluate(() => !!document.querySelector('.choice-row[data-row-name="Genasi"]'))) break;
    const moved = await cr.evaluate(() => {
      const n = document.querySelector(".wizard button.wizard__next:not([disabled])");
      if (n) { n.click(); return true; }
      const d = [...document.querySelectorAll(".wizard__dot:not([disabled])")]
        .find((x) => !x.classList.contains("active"));
      if (d) { d.click(); return true; }
      return false;
    });
    if (!moved) break;
    await cr.waitForTimeout(500);
  }
  const expandAll = await cr.$(".choice-row-list__collapse-controls button:text-matches('Expand All')");
  phoneCheck(!!expandAll, "the row-click checks start from an expanded list");
  if (expandAll) {
    await expandAll.click();
    await quiet(cr);
    const rowSelected = (name) => cr.evaluate(
      (n) => !!document.querySelector(`.choice-row[data-row-name="${n}"].choice-row--selected`), name);

    // --- a picker link in an UNSELECTED row ---
    const linked = await cr.evaluate(() => {
      const row = [...document.querySelectorAll(".choice-row[data-row-name]")]
        .find((r) => !r.classList.contains("choice-row--selected")
          && r.querySelector(".choice-row__details .inline-pick-link"));
      if (!row) return null;
      const name = row.dataset.rowName;
      row.querySelector(".choice-row__details .inline-pick-link").click();
      return name;
    });
    phoneCheck(!!linked, `an unselected row offers a picker link to click (${linked})`);
    if (linked) {
      await cr.waitForTimeout(1000);
      phoneCheck(await rowSelected(linked),
        `clicking that link selects the row it sits in ("${linked}")`);
      phoneCheck(await cr.evaluate(() => !!document.querySelector(".choice-dialog")),
        "and the picker still opens");
      await cr.keyboard.press("Escape");
      await quiet(cr);
    }

    // --- a native <select> in an UNSELECTED row ---
    // The dropdown is the one control that must NOT be re-rendered on click,
    // so this asserts both halves: the click leaves it usable, and committing
    // a value is what selects the row.
    const picked = await cr.evaluate(() => {
      const row = [...document.querySelectorAll(".choice-row[data-row-name]")]
        .find((r) => !r.classList.contains("choice-row--selected")
          && r.querySelector(".choice-row__details select"));
      if (!row) return null;
      const name = row.dataset.rowName;
      const sel = row.querySelector(".choice-row__details select");
      sel.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return { name, options: sel.options.length };
    });
    phoneCheck(!!picked, `an unselected row offers a dropdown to click (${JSON.stringify(picked)})`);
    if (picked) {
      await cr.waitForTimeout(700);
      phoneCheck(!(await rowSelected(picked.name)),
        "clicking that dropdown selects nothing on its own");
      const stillUsable = await cr.evaluate((n) => {
        const row = document.querySelector(`.choice-row[data-row-name="${n}"]`);
        const sel = row?.querySelector(".choice-row__details select");
        return { inDom: !!sel, connected: sel?.isConnected ?? false, options: sel?.options.length ?? 0 };
      }, picked.name);
      phoneCheck(stillUsable.inDom && stillUsable.connected && stillUsable.options === picked.options,
        `and leaves the dropdown in the document, openable (${JSON.stringify(stillUsable)})`);

      // Committing is the gesture that selects the row.
      await cr.evaluate((n) => {
        const sel = document.querySelector(`.choice-row[data-row-name="${n}"] .choice-row__details select`);
        if (!sel || sel.options.length < 2) return;
        sel.value = sel.options[1].value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }, picked.name);
      await cr.waitForTimeout(1200);
      phoneCheck(await rowSelected(picked.name),
        `committing a value in it selects the row ("${picked.name}")`);
    }
  }
  await cr.close();
}


// --- Spell picker row shape -------------------------------------------------
//
// A box on the left, then the name, then the basic facts on their OWN row, a
// blank line, then a gist that says what the spell does AND what it deals,
// with the full text behind a disclosure.
//
// The target is the CHOICE DIALOG opened from a class row's spell line: the
// standalone Spells step was removed, so that dialog is the spell picker. An
// earlier version of this check looked for a .spell-picker-list and found
// nothing at all, which is how the row turned out to carry only a school name
// as its description.
if (inArea("spell-rows")) {
  const sp = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  sp.on("pageerror", (e) => problems.push(`PAGEERROR [spells]: ${e.message}`));
  await sp.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
  await settled(sp, READY_VAULT, `sp vault`);
  await sp.click(READY_VAULT);
  await settled(sp, READY_WIZARD, `sp wizard`);
  // Advance to Identity first (it lists species), pick Elf + High Elf, then
  // advance to Class and pick Wizard. Each stage waits for its own marker so a
  // slow re-render cannot race the click.
  const advanceTo = async (marker) => {
    for (let hop = 0; hop < 12; hop++) {
      const there = await sp.evaluate((sel) => !!document.querySelector(sel), marker);
      if (there) return true;
      const moved = await sp.evaluate(() => {
        const next = document.querySelector(".wizard button.wizard__next:not([disabled])");
        if (next) { next.click(); return "next"; }
        const dot = [...document.querySelectorAll(".wizard__dot:not([disabled])")]
          .find((d) => !d.classList.contains("active"));
        if (dot) { dot.click(); return "dot"; }
        return null;
      });
      if (!moved) return false;
      await sp.waitForTimeout(500);
    }
    return false;
  };
  await advanceTo('.choice-row[data-row-name="Elf"]');
  await sp.evaluate(() => {
    document.querySelector('.choice-row[data-row-name="Elf"]')?.click();
  });
  await sp.waitForTimeout(600);
  await sp.evaluate(() => {
    document.querySelector('.choice-row[data-row-name="High Elf"]')?.click();
  });
  await sp.waitForTimeout(700);
  const reachedClass = await advanceTo('.choice-row[data-row-name="Wizard"]');
  phoneCheck(reachedClass, "the walk reached the Class page");
  await sp.evaluate(() => {
    document.querySelector('.choice-row[data-row-name="Wizard"]')?.click();
  });
  await sp.waitForTimeout(900);

  // The row is already selected AND expanded by the single click above, and
  // nothing below may click it again: a second click on an open, selected row
  // COLLAPSES it and de-selects it (onSelect(null), see toggleRow in
  // sheetWizard.js). An earlier version of this check clicked again "to be
  // sure", which silently tore down the row it was about to measure and then
  // reported the picker as missing — the bullets really were gone, because the
  // check had just removed them.
  //
  // Aim at a SPELL line, not just any pick line. The Wizard row's bullets are
  // "Wizard Skill Proficiencies", "Cantrips", "Spellbook", "Prepared
  // Spells" — so the first .inline-pick-link is the SKILL picker, which is
  // correctly a plain name-and-description list with no facts, no gist and no
  // disclosure. An earlier version clicked links[0] and then reported the
  // spell furniture as missing, having measured the wrong dialog.
  //
  // CANTRIPS is the target, not Spellbook: Fire Bolt is a cantrip, and the
  // point of the last check below is that the gist names the damage rather
  // than only the flavour. Against Spellbook that spell is simply absent, so
  // the check would sit behind a condition that never held and never run.
  // Cantrips carries the same row shape; Spellbook gets its own coverage.
  const openSpellLine = async (topic) => {
    const picked = await sp.evaluate((want) => {
      const row = document.querySelector('.choice-row[data-row-name="Wizard"]');
      const bullets = [...(row?.querySelectorAll(".mechanics-pick") || [])];
      const bullet = bullets.find((n) =>
        new RegExp(`^${want}$`, "i").test(n.querySelector("strong")?.textContent?.trim() || ""));
      const link = bullet?.querySelector(".inline-pick-link");
      if (link) { link.click(); return true; }
      return false;
    }, topic);
    if (!picked) return null;
    await sp.waitForTimeout(900);
    return sp.evaluate(() => {
      const box = document.querySelector(".choice-dialog");
      return {
        open: !!box,
        total: box ? box.querySelectorAll(".choice-dialog-option").length : 0,
      };
    });
  };
  const opened = await openSpellLine("Cantrips");
  phoneCheck(!!opened?.open && opened.total > 0,
    `the Wizard's spell line opens a picker (${JSON.stringify(opened)})`);
  await sp.keyboard.press("Escape");
  await quiet(sp);
  const leveled = await openSpellLine("Spellbook");
  phoneCheck(!!leveled?.open && leveled.total > 0,
    `and so does the leveled list (${JSON.stringify(leveled)})`);
  await sp.keyboard.press("Escape");
  await quiet(sp);
  // Re-open Cantrips for the row-shape measurements below.
  await openSpellLine("Cantrips");
  await sp.waitForTimeout(900);

  const shape = await sp.evaluate(() => {
    const box = document.querySelector(".choice-dialog");
    if (!box) return { none: true };
    const opts = [...box.querySelectorAll(".choice-dialog-option")];
    // Fire Bolt specifically, and NOT a fallback to opts[0]. A fallback plus a
    // guard on the name meant the damage assertion below could be skipped
    // without anything failing - a check that cannot fail is not a check.
    const fire = opts.find((o) => /fire bolt/i.test(o.textContent || ""));
    if (!fire) return { none: true, total: opts.length };
    const q = (s) => fire.querySelector(s);
    const facts = [...fire.querySelectorAll(".choice-row__fact")];
    const gist = q(".choice-row__mechanics-gist");
    const metaBox = q(".choice-row__mechanics-meta");
    const details = q(".choice-row__more");
    const gr = gist?.getBoundingClientRect();
    const mr = metaBox?.getBoundingClientRect();
    const cr = fire.getBoundingClientRect();
    const cr2 = q(".choice-dialog-option__body")?.getBoundingClientRect();
    return {
      none: false,
      total: opts.length,
      name: (q(".choice-dialog-option__name")?.textContent || "").trim(),
      // Box first on the left, text block to its right.
      boxOnLeft: (fire.children[0]?.tagName || "") === "INPUT"
        && cr2 && cr2.left > cr.left,
      inputIsFirst: (fire.children[0]?.tagName || "") === "INPUT",
      factKinds: facts.map((f) => f.className.replace("choice-row__fact choice-row__fact--", "")),
      factTexts: facts.map((f) => f.textContent),
      hasGist: !!gist,
      gistText: (gist?.textContent || "").replace(/\s+/g, " ").trim(),
      hasExpander: !!q(".choice-row__more-toggle"),
      expanderText: (q(".choice-row__more-toggle")?.textContent || "").trim(),
      startsCollapsed: details ? !details.hasAttribute("open") : null,
      gapPx: gr && mr ? Math.round(gr.top - mr.bottom) : null,
      noMarkup: !/\[\[/.test(gist?.textContent || ""),
    };
  });
  phoneCheck(shape.none !== true, `the picker lists spells (${shape.total ?? 0} options)`);
  if (!shape.none) {
    phoneCheck(shape.inputIsFirst && shape.boxOnLeft,
      "each option has its box on the left, then the text beside it");
    phoneCheck(!!shape.name, `then the spell name ("${shape.name}")`);
    phoneCheck(shape.factKinds.includes("level") && shape.factKinds.includes("school"),
      `then the basic facts on their own row, as discrete pieces (${shape.factKinds.join(", ")})`);
    phoneCheck(shape.factKinds.includes("casting") && shape.factKinds.includes("range"),
      `including casting time and range (${JSON.stringify(shape.factTexts)})`);
    phoneCheck(shape.hasGist, "then the gist");
    phoneCheck(shape.gapPx !== null && shape.gapPx >= 4,
      `separated from the facts by a blank line (${shape.gapPx}px)`);
    phoneCheck(shape.hasExpander && shape.startsCollapsed === true,
      `with the full description behind a collapsed disclosure ("${shape.expanderText}")`);
    phoneCheck(shape.noMarkup, "and the gist carries no catalog markup");
    // The point of a gist next to a full description you have to expand: it
    // says what the spell deals, not only what it feels like.
    phoneCheck(/fire damage/i.test(shape.gistText),
      `and the gist names the damage, not just the flavour ("${shape.gistText}")`);
  }
  await sp.screenshot({ path: path.join(shotDir, "spell-picker-rows.png") });
  await sp.close();
}


// --- Swipe between steps, and ONE forward control on a phone ----------------
//
// The swipe is the point of this block and it is unchanged: a horizontal
// drag moves between steps on the same gate the buttons obey, so it can
// never skip a decision, and a vertical drag is left alone so the picker
// table still scrolls.
//
// What DID change is the second half. This used to assert a floating edge
// arrow was rendered, visible, hittable and gated alongside Next. That
// arrow is gone on a phone: two gated controls saying the same thing is
// one more thing to read and one more that can disagree, and the Next
// button is now pinned to the bottom of the screen so it never needs a
// floating proxy. The assertions below are rewritten to that design - ONE
// visible forward control, pinned, gated, and accompanied by a visible
// reason - and the swipe half is untouched. It is still a real touch
// viewport, because the swipe is touch-only.
if (inArea("swipe-arrow")) {
  const t = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  t.on("pageerror", (e) => problems.push(`PAGEERROR [swipe]: ${e.message}`));
  await t.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
  await settled(t, READY_VAULT, `t vault`);
  const newBtn = await t.$(".vault-new__go");
  await newBtn.click();
  await quiet(t);

  const stepOf = () => t.evaluate(() => {
    const text = document.querySelector(".wizard")?.textContent || "";
    const m = /Step (\d+) of (\d+)/.exec(text);
    return { index: m ? Number(m[1]) : 0, total: m ? Number(m[2]) : 0 };
  });
  // The forward controls a person can actually see and press right now.
  const forwards = () => t.evaluate(() => {
    const shown = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };
    const arrow = document.querySelector(".wizard__edge-next");
    const nexts = [...document.querySelectorAll(".wizard button.wizard__next")].filter(shown);
    const nav = nexts[0]?.closest(".wizard__nav");
    const nr = nav?.getBoundingClientRect();
    const reason = nav?.querySelector(".wizard__gate-reason");
    return {
      arrowShown: shown(arrow),
      nextCount: nexts.length,
      nextDisabled: nexts.length ? nexts[0].disabled : null,
      // Pinned to the bottom of the VIEWPORT, which is what makes it a
      // substitute for the arrow it replaces.
      pinned: nr ? Math.abs(nr.bottom - window.innerHeight) < 4 : false,
      reason: reason && shown(reason) ? reason.textContent.trim() : null,
      reasonH: reason && shown(reason) ? Math.round(reason.getBoundingClientRect().height) : 0,
    };
  });
  // Swipe as real touch-pointer events on the wizard, in steps so the gesture
  // passes the distance threshold the recogniser requires.
  const swipe = async (dx) => {
    await t.evaluate((delta) => {
      const wrap = document.querySelector(".wizard");
      const r = wrap.getBoundingClientRect();
      const y = Math.round(r.top + Math.min(r.height - 30, 260));
      const startX = Math.round(window.innerWidth / 2);
      const mk = (type, x, cy) => wrap.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerType: "touch",
        clientX: x, clientY: cy, pointerId: 1,
      }));
      mk("pointerdown", startX, y);
      for (let i = 1; i <= 6; i++) mk("pointermove", startX + Math.round((delta * i) / 6), y);
      mk("pointerup", startX + delta, y);
    }, dx);
    await t.waitForTimeout(1000);
  };

  const s0 = await stepOf();
  phoneCheck(s0.index >= 1, `the wizard is on a step to move away from (step ${s0.index}/${s0.total})`);

  const f0 = await forwards();
  phoneCheck(!f0.arrowShown, "no floating edge arrow competes with the Next button on a phone");
  phoneCheck(f0.nextCount === 1, `exactly one Next is on screen (${f0.nextCount})`);
  phoneCheck(f0.pinned, "and it is pinned to the bottom of the screen, so it is never below the fold");
  phoneCheck(f0.nextDisabled === false,
    `this first page is decided, so Next is live (disabled=${f0.nextDisabled})`);
  phoneCheck(f0.reason === null, `and there is no reason shown when nothing is blocking (${JSON.stringify(f0.reason)})`);

  if (f0.nextDisabled === false) {
    // Tap it where it is drawn, which is the assertion the arrow used to
    // get: a control that looks pressable and is.
    const box = await t.evaluate(() => {
      const n = [...document.querySelectorAll(".wizard button.wizard__next")]
        .find((b) => getComputedStyle(b).display !== "none" && b.getBoundingClientRect().width > 0);
      const r = n.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    const topAt = await t.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const n = [...document.querySelectorAll(".wizard button.wizard__next")]
        .find((b) => getComputedStyle(b).display !== "none" && b.getBoundingClientRect().width > 0);
      return !!(el && (el === n || n.contains(el)));
    }, box);
    phoneCheck(topAt, "and it is actually clickable where it is drawn");
    await t.mouse.click(box.x, box.y);
    await quiet(t);
    const s1 = await stepOf();
    phoneCheck(s1.index === s0.index + 1,
      `tapping Next moves to the next step (${s0.index} -> ${s1.index})`);

    // Swipe right = back, always allowed.
    const beforeBack = await stepOf();
    await swipe(170);
    const afterBack = await stepOf();
    phoneCheck(afterBack.index === beforeBack.index - 1,
      `a rightward swipe goes back a step (${beforeBack.index} -> ${afterBack.index})`);

    // The forward gate, on a page that genuinely has decisions outstanding.
    // Identity does: nothing picked yet. Walk there by tapping Next rather
    // than by tapping a species, so the page stays incomplete.
    await t.evaluate(() => {
      const b = [...document.querySelectorAll(".wizard button.wizard__next")]
        .find((x) => !x.disabled && x.getBoundingClientRect().width > 0);
      if (b) b.click();
    });
    await t.waitForTimeout(1100);
    const gateState = await forwards();
    if (gateState.nextDisabled === true) {
      phoneCheck(!!gateState.reason && gateState.reasonH > 0,
        `an incomplete page says WHY on the page, not only in a tooltip ("${gateState.reason}")`);
      const beforeFwd = await stepOf();
      await swipe(-170);
      const afterFwd = await stepOf();
      phoneCheck(afterFwd.index === beforeFwd.index,
        `and a leftward swipe is refused while the page is incomplete (${beforeFwd.index} -> ${afterFwd.index})`);
    } else {
      phoneCheck(false,
        `expected an incomplete page to block forward, but it did not (step ${(await stepOf()).index})`);
    }
  } else {
    phoneCheck(true, "first page was gated, so the tap-forward path is not exercised here");
  }

  // A vertical drag must NOT change step: it is a scroll, and claiming it
  // would make the picker table unusable on a phone.
  const beforeScroll = await stepOf();
  await t.evaluate(() => {
    const wrap = document.querySelector(".wizard");
    const r = wrap.getBoundingClientRect();
    const x = Math.round(window.innerWidth / 2);
    const y = Math.round(r.top + Math.min(r.height - 30, 260));
    const mk = (type, cy) => wrap.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerType: "touch",
      clientX: x, clientY: cy, pointerId: 2,
    }));
    mk("pointerdown", y);
    for (let i = 1; i <= 6; i++) mk("pointermove", y - i * 25);
    mk("pointerup", y - 150);
  });
  await t.waitForTimeout(900);
  const afterScroll = await stepOf();
  phoneCheck(afterScroll.index === beforeScroll.index,
    `a vertical drag scrolls and does NOT change step (${beforeScroll.index} -> ${afterScroll.index})`);

  // A DIAGONAL drag is the realistic phone scroll: the thumb arcs, so the
  // vertical travel often matches or beats the horizontal for the first
  // centimetre. It must not become a page change, and the check is on the
  // strict rule - horizontal travel has to EXCEED vertical - so a 200x100
  // drag counts as a swipe and a 100x200 drag does not.
  const diagonal = async (dx, dy) => {
    const before = await stepOf();
    await t.evaluate(({ dx: ddx, dy: ddy }) => {
      const wrap = document.querySelector(".wizard");
      const r = wrap.getBoundingClientRect();
      const x = Math.round(window.innerWidth / 2);
      const y = Math.round(r.top + Math.min(r.height - 30, 260));
      const mk = (type, cx, cy) => wrap.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerType: "touch",
        clientX: cx, clientY: cy, pointerId: 3,
      }));
      mk("pointerdown", x, y);
      for (let i = 1; i <= 6; i++) mk("pointermove", x + Math.round((ddx * i) / 6), y + Math.round((ddy * i) / 6));
      mk("pointerup", x + ddx, y + ddy);
    }, { dx, dy });
    await t.waitForTimeout(900);
    return { before, after: await stepOf() };
  };
  const mostlyDown = await diagonal(60, 200);
  phoneCheck(mostlyDown.after.index === mostlyDown.before.index,
    `a drag that is mostly vertical does NOT change step (${mostlyDown.before.index} -> ${mostlyDown.after.index})`);

  // A diagonal swipe with clearly more horizontal than vertical travel DOES
  // still work - the recogniser must not simply refuse anything with a
  // vertical component, or it would refuse every real thumb arc. Probed with
  // the RIGHTWARD (back) drag because back is always allowed: a forward drag
  // would also need a complete page, and this page is not one.
  const beforeDiag = await stepOf();
  if (beforeDiag.index > 1) {
    await diagonal(200, 60);
    const afterDiag = await stepOf();
    phoneCheck(afterDiag.index === beforeDiag.index - 1,
      `a diagonal swipe that is mostly horizontal still goes back (${beforeDiag.index} -> ${afterDiag.index})`);
    // Put it back where it was, so the checks below measure from one place.
    await diagonal(-200, -60);
    await t.waitForTimeout(400);
  } else {
    phoneCheck(true, "not far enough into the wizard to probe a diagonal swipe back");
  }

  // A swipe that starts on a control is that control's gesture. The wizard's
  // own name field is the clean probe: swiping across it must move nothing.
  const beforeField = await stepOf();
  const fieldSwipe = await t.evaluate(async () => {
    const input = document.querySelector(".wizard input[type=text]");
    if (!input) return "no field";
    const r = input.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) return "no box";
    const startX = Math.round(r.left + 10);
    const y = Math.round(r.top + r.height / 2);
    const wrap = input.closest(".wizard");
    const mk = (type, cx) => input.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerType: "touch",
      clientX: cx, clientY: y, pointerId: 4,
    }));
    mk("pointerdown", startX);
    for (let i = 1; i <= 6; i++) mk("pointermove", startX + i * 30);
    mk("pointerup", startX + 180);
    return "swiped";
  });
  await t.waitForTimeout(900);
  if (fieldSwipe === "swiped") {
    const afterField = await stepOf();
    phoneCheck(afterField.index === beforeField.index,
      `a swipe starting on the name field does NOT change step (${beforeField.index} -> ${afterField.index})`);
  } else {
    phoneCheck(false, `the name field was not available to swipe across (${fieldSwipe})`);
  }

  // And the handlers are PASSIVE. This is the difference between a scroll the
  // compositor owns and one that has to wait for app JavaScript on every
  // frame - the classic cause of a touch fling that starts, travels a
  // screenful, and then gives up. The page cannot see its own listener
  // options, so this asks CDP, which can.
  const passiveReport = await (async () => {
    const probe = await t.context().newCDPSession(t);
    try {
      const { result } = await probe.send("Runtime.evaluate", {
        expression: "document.querySelector('.wizard')",
      });
      const listeners = await probe.send("DOMDebugger.getEventListeners", {
        objectId: result.objectId,
      });
      await probe.detach();
      const ours = (listeners.listeners || []).filter((l) => /^pointer/.test(l.type));
      return {
        types: ours.map((l) => l.type),
        passive: ours.filter((l) => l.passive === true).map((l) => l.type),
        blocking: ours.filter((l) => l.passive !== true).map((l) => l.type),
      };
    } catch (err) {
      try { await probe.detach(); } catch { /* already gone */ }
      return { error: err.message };
    }
  })();
  if (passiveReport.error) {
    phoneCheck(false, `could not read the wizard's listeners (${passiveReport.error})`);
  } else {
    phoneCheck(passiveReport.types.includes("pointermove"),
      `the swipe recogniser listens for pointermove (${JSON.stringify(passiveReport.types)})`);
    phoneCheck(passiveReport.blocking.length === 0,
      `and none of its listeners blocks the browser's scrolling (blocking: ${JSON.stringify(passiveReport.blocking)})`);
  }

  // No Next on the last step, and no bar to sit there empty. Driven forward
  // by clicking Next as often as the gate allows, rather than by jumping a
  // dot - forward dots are themselves locked until the page is finished, so
  // a dot jump would not arrive.
  for (let hop = 0; hop < 12; hop++) {
    const done = await t.evaluate(() => {
      const btn = [...document.querySelectorAll(".wizard button")]
        .find((b) => /Next|Finish|Complete|Apply/.test(b.textContent) && !b.disabled
          && !b.classList.contains("wizard__dot"));
      if (!btn) return true;
      btn.click();
      return false;
    });
    await t.waitForTimeout(900);
    if (done) break;
  }
  const atEnd = await forwards();
  const hasNext = await t.evaluate(() =>
    [...document.querySelectorAll(".wizard button.wizard__next")]
      .some((b) => getComputedStyle(b).display !== "none" && b.getBoundingClientRect().width > 0));
  phoneCheck((atEnd.nextCount > 0) === hasNext,
    `a visible Next exists exactly when there is a next step (next:${atEnd.nextCount}, expected:${hasNext}, step:${(await stepOf()).index})`);
  if (hasNext === false) {
    phoneCheck(true, "and no bottom bar on the last step, where there is no next");
  }

  await t.screenshot({ path: path.join(shotDir, "wizard-one-forward-control.png") });
  await t.close();
}

const vaultPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
vaultPage.on("pageerror", (e) => problems.push(`PAGEERROR [vault]: ${e.message}`));
vaultPage.on("console", (m) => { if (m.type() === "error") problems.push(`CONSOLE [vault]: ${m.text()}`); });

const vaultCheck = (cond, msg) => {
  if (!cond) failures.push(`[vault] ${msg}`);
  console.log(`${cond ? "ok" : "FAIL"} [vault]: ${msg}`);
};

await vaultPage.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
await settled(vaultPage, READY_VAULT, `vaultPage vault`);
const newBtn = await vaultPage.$(".vault-new__go");
vaultCheck(!!newBtn && (await newBtn.isVisible()), "vault + New Character button visible");
if (newBtn) await newBtn.click();
await quiet(vaultPage);
vaultCheck(await vaultPage.$(".wizard"), "creator wizard renders after + New Character");
await vaultPage.screenshot({ path: path.join(shotDir, "creator.png") });
// Advance one wizard step to prove the wizard is alive, not paint.
const nextBtn = await vaultPage.$(".wizard button:has-text('Next')");
if (nextBtn) {
  await nextBtn.click();
  await quiet(vaultPage);
  const stepText = /Step 2 of \d+/.test(await vaultPage.textContent("body"));
  vaultCheck(stepText, "creator wizard advances to step 2");
  await vaultPage.screenshot({ path: path.join(shotDir, "creator-step2.png") });
}
// Changeling regression: picking a race with real choice groups once
// crashed the creator (a bare categorizeChoiceGroup reference with no
// binding). Step 2 is Identity, which lists the race rows. Its skill
// pick renders inline in the row (summary + superscript ?) through
// the shared choice dialog — never as a bottom section.
const changeling = await vaultPage.$(`.choice-row[data-row-name="Changeling"]`);
vaultCheck(!!changeling, "Identity step lists Changeling");
if (changeling) {
  await changeling.click();
  await quiet(vaultPage);
  vaultCheck(await vaultPage.$(".choice-row--selected .inline-pick-link"), "Changeling choice summary is the dialog link");
  vaultCheck(!((await vaultPage.$$(".level-guide__choices")).length), "no bottom choice sections for Changeling");
  // The summary opens the shared skills dialog; Escape closes it untouched.
  await vaultPage.click(".choice-row--selected .inline-pick-link");
  await quiet(vaultPage);
  vaultCheck(await vaultPage.$(".choice-dialog-overlay"), "shared choice dialog opens");
  await vaultPage.screenshot({ path: path.join(shotDir, "changeling.png") });
  await vaultPage.keyboard.press("Escape");
  await quiet(vaultPage);
  vaultCheck(!(await vaultPage.$(".choice-dialog-overlay")), "shared choice dialog closes on Escape");
}
const vaultLineage = await vaultPage.$(`.choice-row[data-row-name="Custom Lineage"]`);
vaultCheck(!!vaultLineage, "Identity step lists Custom Lineage");
if (vaultLineage) {
  await vaultLineage.click();
  await quiet(vaultPage);
  const vaultFeatLink = await vaultPage.$(".choice-row--selected .inline-pick-link");
  const vaultFeatText = vaultFeatLink ? await vaultFeatLink.textContent() : "";
  vaultCheck(!!vaultFeatLink && /choose a feat/i.test(vaultFeatText || ""), "lineage feat mention is the picker link");
  vaultCheck((await vaultPage.textContent("body")).includes("Racial feat"), "Racial feat picker sits on Identity");
  if (vaultFeatLink) {
    await vaultFeatLink.click();
    await quiet(vaultPage);
    const vaultFeatDlg = await vaultPage.$(".choice-dialog-overlay");
    vaultCheck(!!vaultFeatDlg, "feat picker dialog opens from lineage link");
    if (vaultFeatDlg) {
      vaultCheck(/alert/i.test((await vaultFeatDlg.textContent()) || ""), "feat picker lists feats as a table");
      await vaultPage.screenshot({ path: path.join(shotDir, "lineage-feat.png") });
    }
    await vaultPage.keyboard.press("Escape");
    await quiet(vaultPage);
    vaultCheck(!(await vaultPage.$(".choice-dialog-overlay")), "feat picker closes on Escape");
  }
}

// --- The page that cannot start --------------------------------------------
//
// A module script fails SILENTLY. main.js does a top-level await and a
// syntax error or a bad import path rejects the module record without
// running a line of app code, so the loading screen just sits there - no
// error, no message, nothing to click. That is the worst state a page can
// be in, and nothing about it was testable before.
//
// Driven by loading a page whose entry script is blocked, which is exactly
// what a stale cache or a missing deploy looks like from the browser's side.
if (inArea("load-failure")) {
  const brokenPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // A blocked script IS the thing under test, so this page's own errors are
  // not collected into `problems` - they are the expected result.
  await brokenPage.route("**/js/main.js*", (route) => route.abort());
  await brokenPage.goto(`${base}/index.html`, { waitUntil: "domcontentloaded" });
  await brokenPage.waitForTimeout(1500);
  const broke = await brokenPage.evaluate(() => ({
    failure: !!document.querySelector(".app-load-failure"),
    text: document.querySelector(".app-load-failure")?.textContent || "",
    hasReload: !!document.querySelector(".app-load-failure button"),
    spinnerGone: !document.querySelector(".app-loading-screen"),
    noscriptHidden: document.getElementById("app-noscript")?.hidden === true,
  }));
  vaultCheck(broke.failure, "a blocked entry script produces a failure page, not a stuck spinner");
  vaultCheck(/couldn't start/i.test(broke.text), "and it says what happened");
  vaultCheck(broke.hasReload, "with a Reload button to act on it");
  vaultCheck(broke.spinnerGone, "the loading screen is gone, not left behind under it");
  // The <noscript> panel is for a different failure (no JS at all) and must
  // not appear here. It claimed to be hidden while actually covering the
  // page and eating clicks, which this check exists to keep fixed.
  vaultCheck(broke.noscriptHidden, "the no-JavaScript panel stays out of the way when JS is merely failing");
  await brokenPage.screenshot({ path: path.join(shotDir, "load-failure.png") });
  await brokenPage.close();
}

// --- Every background agrees with itself ------------------------------------
//
// "Choices remain" with nothing to click is the worst state this wizard has:
// the page says the player owes a decision and offers no way to make it, so
// Next stays disabled forever. Sage hit it outright (two languages, no
// picker) and Acolyte hit the same bug one step removed (a Prayer Focus
// picker on screen, and its two languages still invisible underneath).
//
// The fix was at the source: profileSectionsFor and the bottom "Your choices"
// sections now read ONE partition (choiceGroupRenderTarget) instead of two
// hand-written filter lists that had drifted apart. What makes this worth a
// whole area rather than a single assertion on Sage is that nothing stops the
// lists drifting again - a new group shape is invisible and counted at the
// same time by construction. So this walks EVERY background and asserts the
// invariant both ways:
//
//   1. blocked  <=>  a visible unfilled pick is on screen, and
//   2. fill every visible pick and Next becomes enabled.
//
// (2) is the one that catches the subtle half: a background can show a pick
// for one group and hide another, so (1) alone passes while the page is still
// impossible to complete.
//
// Sailor is the control: no choices at all, so it must never block. It is
// named in the check rather than left to the loop, because "every background
// happens to agree" reads as vacuous until you see the one that has nothing
// to do and still passes.
if (inArea("background-gate")) {
  const bgPage = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  bgPage.on("pageerror", (e) => problems.push(`PAGEERROR [bg-gate]: ${e.message}`));
  bgPage.on("console", (m) => { if (m.type() === "error") problems.push(`CONSOLE [bg-gate]: ${m.text()}`); });
  const bgCheck = (cond, msg) => {
    if (!cond) failures.push(`[bg-gate] ${msg}`);
    console.log(`${cond ? "ok" : "FAIL"} [bg-gate]: ${msg}`);
  };

  const bgStep = () => bgPage.evaluate(() =>
    document.querySelector(".wizard__dot--active")?.dataset.stepId || null);
  const bgNext = () => bgPage.evaluate(() => {
    const b = document.querySelector(".wizard__next:not([disabled])");
    if (!b) return false;
    b.click();
    return true;
  });
  // Pickers and dialogs are siblings of the app root; anything left open
  // swallows the next click, and a swallowed click reads as a broken wizard.
  const bgClearOverlays = () => bgPage.evaluate(() => {
    for (const o of document.querySelectorAll("body > .modal-overlay, body > .choice-dialog-overlay")) o.remove();
  });

  /** Take one unfilled pick on the CURRENT step. Returns whether anything
   *  changed, so a caller can tell "one more to go" from "nothing left".
   *
   *  Two scopes, and only these two: the SELECTED picker row, and any open
   *  "Your choices" section body. A collapsed row keeps its dropdowns in the
   *  DOM, and driving one of those writes a pick for a race/class/background
   *  the player has NOT chosen and re-renders the page underneath the loop -
   *  which is how a step ends up reporting picks the player never made.
   *
   *  Slot values are set to the first ENABLED non-empty option rather than to
   *  index 1: a sibling slot's pick disables that option, and a browser
   *  silently refuses to select a disabled one, so the value never sticks. */
  const bgTakePick = async () => {
    const moved = await bgPage.evaluate(() => {
      const scopes = [];
      const sel = document.querySelector(".choice-row--selected");
      if (sel) scopes.push(sel);
      for (const b of document.querySelectorAll(".wizard__section-body")) {
        if (!b.hidden && !scopes.includes(b)) scopes.push(b);
      }
      if (!scopes.length) return null;
      const inScopes = (sel2) => scopes.some((s) => s.contains(sel2));
      const shown = (e) => e.getClientRects().length > 0;
      for (const scope of scopes) {
        for (const s of scope.querySelectorAll("select[data-inline-slot]")) {
          if (s.selectedIndex > 0) continue;
          const opt = [...s.options].find((o) => !o.disabled && o.value !== "");
          if (!opt) continue;
          s.value = opt.value;
          s.dispatchEvent(new Event("change", { bubbles: true }));
          return "slot";
        }
      }
      for (const l of document.querySelectorAll(".inline-pick-link")) {
        if (!inScopes(l) || !shown(l)) continue;
        const t = (l.textContent || "").trim();
        if (/^choose\b/i.test(t) || /\bchoose \d/i.test(t)) { l.click(); return "dialog"; }
      }
      for (const t of document.querySelectorAll(".wizard__section-toggle")) {
        if (/needs picks/i.test(t.textContent || "") && shown(t)) { t.click(); return "section"; }
      }
      return null;
    });
    if (!moved) return false;
    await bgPage.waitForTimeout(450);
    if (!(await bgPage.$(".choice-dialog-overlay"))) {
      await bgClearOverlays();
      await bgPage.waitForTimeout(150);
      return true;
    }
    await bgPage.evaluate(() => {
      const dlg = document.querySelector(".choice-dialog-overlay");
      const cap = Number((dlg.textContent.match(/\/\s*(\d+)\s*picked/) || [])[1] || 1);
      // Both kinds, because openChoiceDialog picks between them by
      // `maxSelections`: a one-pick group (a fighting style, a tool) opens
      // RADIOS. Querying checkboxes only left every single-pick group
      // untaken, and the harness then reported it as "an invisible pick".
      const boxes = [...dlg.querySelectorAll("input[type=checkbox]:not(:disabled), input[type=radio]:not(:disabled)")];
      let n = 0;
      for (const b of boxes) {
        if (n >= cap) break;
        if (!b.checked) { b.click(); n++; }
      }
      [...dlg.querySelectorAll("button")].find((x) => /accept/i.test(x.textContent))?.click();
    });
    await bgPage.waitForTimeout(450);
    return true;
  };
  const bgFillPicks = async () => {
    let changed = false;
    for (let i = 0; i < 16; i++) {
      if (!(await bgTakePick())) break;
      changed = true;
    }
    return changed;
  };

  await bgPage.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
  await settled(bgPage, READY_VAULT, "bg-gate vault");
  await bgPage.click(READY_VAULT);
  await settled(bgPage, READY_WIZARD, "bg-gate wizard");

  // Reach the Background step. Half-Orc and Fighter are the cheapest way
  // through: neither offers a pick the harness cannot take from a dropdown or
  // the shared dialog, so every later step is the Background step's business.
  await bgPage.waitForTimeout(600);
  await bgPage.evaluate(() => {
    for (const b of document.querySelectorAll(".wizard input[type=checkbox]")) {
      if (!b.checked) { b.click(); return; }
    }
  });
  await bgPage.waitForTimeout(300);
  await bgNext();
  await bgPage.waitForTimeout(500);
  await bgPage.evaluate(() => {
    const n = document.querySelector(".wizard input[type=text]");
    if (n) {
      n.value = "Gate Tester";
      n.dispatchEvent(new Event("input", { bubbles: true }));
      n.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await bgPage.waitForTimeout(300);
  await bgPage.click('.choice-row[data-row-name="Half-Orc"] .choice-row__label');
  await bgPage.waitForTimeout(500);
  await bgNext();
  await bgPage.waitForTimeout(600);
  // Barbarian, not Fighter: the class step's own picks have to be takeable
  // too (see bgFillPicks) and a Fighter also offers a fighting style, which
  // is one more dialog shape for the scaffolding to get right before it
  // reaches the step under test.
  await bgPage.click('.choice-row[data-row-name="Barbarian"] .choice-row__label');
  await bgPage.waitForTimeout(600);
  await bgFillPicks();
  for (let i = 0; i < 4 && (await bgStep()) !== "background"; i++) {
    await bgFillPicks();
    await bgNext();
    await bgPage.waitForTimeout(600);
  }
  bgCheck((await bgStep()) === "background",
    `the walkthrough reaches the Background step (at ${await bgStep()})`);
  if ((await bgStep()) === "background") {
    const names = await bgPage.evaluate(() =>
      [...document.querySelectorAll(".choice-row[data-row-name]")].map((r) => r.dataset.rowName));
    bgCheck(names.length > 1, `the Background step lists the backgrounds (${names.length})`);
    for (const bg of names) {
      await bgClearOverlays();
      // Click the LABEL, not the row: a selected row's centre is prose, and
      // the label is the smallest thing that reliably selects and expands.
      await bgPage.click(`.choice-row[data-row-name="${bg}"] .choice-row__label`);
      await bgPage.waitForTimeout(600);
      const before = await bgPage.evaluate(() => {
        const row = document.querySelector(".choice-row--selected");
        const body = document.querySelector(".wizard__body") || document.body;
        const shown = (e) => e.getClientRects().length > 0;
        const controls = [...body.querySelectorAll(".inline-pick-link, select[data-inline-slot], .wizard__section-toggle")]
          .filter(shown);
        const unfilled = controls.filter((e) => {
          if (e.tagName === "SELECT") return e.selectedIndex <= 0;
          const t = (e.textContent || "").trim();
          return /^choose\b/i.test(t) || /\bchoose \d/i.test(t) || /needs picks/i.test(t);
        });
        return {
          selected: row?.dataset.rowName || null,
          blocked: !document.querySelector(".wizard__next:not([disabled])"),
          unfilled: unfilled.length,
        };
      });
      bgCheck(before.selected === bg, `${bg} selects`);
      bgCheck(before.blocked === (before.unfilled > 0),
        `${bg}: Next is blocked (${before.blocked}) exactly when a visible pick is unfilled (${before.unfilled})`);
      if (before.blocked) {
        await bgFillPicks();
        const stillBlocked = await bgPage.evaluate(() =>
          !document.querySelector(".wizard__next:not([disabled])"));
        bgCheck(!stillBlocked,
          `${bg}: filling every visible pick lets Next through${stillBlocked ? " (still blocked - a pick is invisible)" : ""}`);
      }
    }
    await bgPage.screenshot({ path: path.join(shotDir, "background-gate.png") });
  }
  await bgPage.close();
}

await browser.close();
server.close();

console.log(`screenshots: ${shotDir}`);

// Where the wall clock went, so the next question ("which part?") is answered
// without hand-editing a stopwatch into a 3600-line script.
const viewportTotal = phases.reduce((a, p) => a + p.ms, 0);
console.log(`viewport runs: ${phases.map((p) => `${p.label} ${(p.ms / 1000).toFixed(1)}s`).join(", ")}  (${(viewportTotal / 1000).toFixed(1)}s total)`);
if (problems.length) {
  console.error(`PAGE PROBLEMS (${problems.length}):\n` + problems.join("\n"));
  process.exitCode = 1;
}
if (failures.length) {
  console.error(`e2e-smoke: ${failures.length} check(s) failed`);
  process.exitCode = 1;
}
if (!process.exitCode) console.log("e2e-smoke: all checks passed");




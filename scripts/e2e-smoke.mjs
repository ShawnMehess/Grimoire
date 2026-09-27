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
// Run: npm run test:e2e
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

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

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const problems = [];
const failures = [];
page.on("pageerror", (e) => problems.push(`PAGEERROR: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`CONSOLE: ${m.text()}`); });

const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`${cond ? "ok" : "FAIL"}: ${msg}`);
};

try {
  // A: demo sheet (mock store) — toolbar, Play View toggle, print dialog.
  await page.goto(`${base}/demo.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  check(await page.$(".sheet-toolbar"), "demo sheet toolbar renders (no aborted render)");
  const playBtn = await page.$("button:has-text('Play View')");
  check(!!playBtn, "demo Play View toggle exists");
  if (playBtn) {
    await playBtn.click();
    await page.waitForTimeout(400);
    check(await page.$(".page-grid.play-mode"), "demo Play View mode engages");
    await page.screenshot({ path: path.join(shotDir, "play-view.png") });
    await playBtn.click();
    await page.waitForTimeout(400);
    check(!(await page.$(".page-grid.play-mode")), "demo Sheet View restores");
  }
  // Print dialog opens, previews, and closes via Escape.
  // NOTE: the Display control is a <details>/<summary>, not a button.
  const displayToggle = await page.$(".toolbar-display summary");
  check(!!displayToggle, "demo Display dropdown exists");
  if (displayToggle) {
    await displayToggle.click();
    await page.waitForTimeout(300);
    const printBtn = await page.$("button:has-text('Print')");
    check(!!printBtn, "demo print button exists in Display panel");
    if (printBtn) {
      await printBtn.click();
      await page.waitForTimeout(400);
      check(await page.$(".print-dialog"), "demo print dialog opens");
      await page.screenshot({ path: path.join(shotDir, "print-dialog.png") });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      check(!(await page.$(".print-dialog")), "demo print dialog closes on Escape");
    }
  }

  // B: offline vault — the exact flow that once crashed new-character
  // creation (insertBefore against the wrong toolbar parent).
  await page.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const newBtn = await page.$("button:has-text('+ New Character')");
  check(!!newBtn && (await newBtn.isVisible()), "vault + New Character button visible");
  if (newBtn) await newBtn.click();
  await page.waitForTimeout(2000);
  check(await page.$(".wizard"), "creator wizard renders after + New Character");
  await page.screenshot({ path: path.join(shotDir, "creator.png") });
  // Advance one wizard step to prove the wizard is alive, not paint.
  const nextBtn = await page.$(".wizard button:has-text('Next')");
  if (nextBtn) {
    await nextBtn.click();
    await page.waitForTimeout(800);
    const stepText = (await page.textContent("body")).includes("Step 2 of 7");
    check(stepText, "creator wizard advances to step 2");
    await page.screenshot({ path: path.join(shotDir, "creator-step2.png") });
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
    await page.waitForTimeout(1500);
    check(await page.$(".choice-row--selected .inline-pick-link"), "Changeling choice summary is the dialog link");
    check(!((await page.$$(".level-guide__choices")).length), "no bottom choice sections for Changeling");
    // The summary opens the shared skills dialog; Escape closes it untouched.
    await page.click(".choice-row--selected .inline-pick-link");
    await page.waitForTimeout(400);
    check(await page.$(".choice-dialog-overlay"), "shared choice dialog opens");
    await page.screenshot({ path: path.join(shotDir, "changeling.png") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check(!(await page.$(".choice-dialog-overlay")), "shared choice dialog closes on Escape");
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`screenshots: ${shotDir}`);
if (problems.length) {
  console.error(`PAGE PROBLEMS (${problems.length}):\n` + problems.join("\n"));
  process.exitCode = 1;
}
if (failures.length) {
  console.error(`e2e-smoke: ${failures.length} check(s) failed`);
  process.exitCode = 1;
}
if (!process.exitCode) console.log("e2e-smoke: all checks passed");

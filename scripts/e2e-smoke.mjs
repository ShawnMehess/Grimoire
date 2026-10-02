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

const viewportSizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 392, height: 844 },
];

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const problems = [];
const failures = [];

async function runViewportTests(viewport) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  page.on("pageerror", (e) => problems.push(`PAGEERROR [${viewport.name}]: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`CONSOLE [${viewport.name}]: ${m.text()}`); });

  const check = (cond, msg) => {
    if (!cond) failures.push(`[${viewport.name}] ${msg}`);
    console.log(`${cond ? "ok" : "FAIL"} [${viewport.name}]: ${msg}`);
  };

  // A: demo sheet (mock store) — toolbar, Simple View toggle, print dialog.
  //
  // The reload/persistence half of the Simple View checks lives on the
  // OFFLINE page below, not here: the demo store rebuilds its character
  // from scratch on every load and logs what it would have saved, so a
  // reload there proves nothing about persistence by construction.
  await page.goto(`${base}/demo.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  check(await page.$(".sheet-toolbar"), "demo sheet toolbar renders (no aborted render)");
  // Was "Play View" / .page-grid.play-mode, which turned out to be a
  // half-dead toggle: its CSS styled class names that no longer exist, so
  // the class it set did nothing beyond the editor-chrome hiding. Replaced
  // by a real stacked display mode under the spec's own "Simple View"
  // name. The assertions below are unchanged in substance — same toggle,
  // same engage/restore, same overflow check.
  const playBtn = await page.$("button:has-text('Simple View')");
  check(!!playBtn, "demo Simple View toggle exists");
  if (playBtn) {
    await playBtn.click();
    await page.waitForTimeout(400);
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
    await page.waitForTimeout(400);
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
      await page.screenshot({ path: path.join(shotDir, `print-dialog-${viewport.name}.png`) });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
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
  if (displayToggle) {
    // The Display panel is a <details>, and the block above already
    // opened it — toggling again would close it and hide the button.
    // Tested for VISIBILITY, not existence: everything inside a closed
    // <details> stays in the DOM, so a found handle can still be hidden
    // and then time out on click.
    if (!await page.$("button:has-text('Print')").then((b) => b && b.isVisible())) {
      const summary = await page.$(".toolbar-display summary");
      if (summary) await summary.click();
      await page.waitForTimeout(300);
    }
    const printBtn2 = await page.$("button:has-text('Print')");
    if (printBtn2) {
      await printBtn2.click();
      await page.waitForTimeout(400);
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
        await page.waitForTimeout(1200);
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
  {
    if (!await page.$("button:has-text('Add shape')").then((b) => b && b.isVisible())) {
      const summary = await page.$(".toolbar-display summary");
      if (summary) await summary.click();
      await page.waitForTimeout(300);
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
      await page.waitForTimeout(400);
      const ratioOpen = await page.$(".app-dialog__input");
      check(!!ratioOpen, "the name dialog leads to a ratio dialog");

      // The validator: a bad ratio must be refused IN PLACE, with the field
      // still there. The old flow closed the prompt, opened an alert, and
      // started the whole sequence over.
      await page.fill(".app-dialog__input", "21x9x");
      buttons = await dialogButtons();
      await buttons[buttons.length - 1].click();
      await page.waitForTimeout(300);
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
      await page.waitForTimeout(600);
      // Adding a shape applies it straight away, which reflows every tab and
      // therefore asks first. Click it through - the point of the check
      // below is the reflowed layout, not the question.
      const reflowAsk = await page.$(".app-dialog");
      check(!!reflowAsk, "applying a new shape asks before re-flowing every tab");
      if (reflowAsk) {
        const btns = await dialogButtons();
        await btns[btns.length - 1].click();
        await page.waitForTimeout(1200);
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
        await page.waitForTimeout(400);
        // Which then asks for confirmation, as a separate dialog.
        const confirmOpen = await page.$(".app-dialog__box--danger");
        check(!!confirmOpen, "choosing a shape asks before deleting it");
        if (confirmOpen) {
          const dialogButtons2 = await page.$$(".app-dialog button");
          await dialogButtons2[dialogButtons2.length - 1].click();
          await page.waitForTimeout(900);
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
    const simpleToggle = await page.$("button:has-text('Simple View')");
    if (!simpleToggle) {
      check(false, "the Simple View toggle is present");
    } else if (await simpleToggle.click().then(() => true).catch(() => false)) {
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => {
      const grid = document.querySelector(".page-grid.is-simple");
      if (!grid) return { hasOverflow: true, reason: "no grid" };
      return {
        hasOverflow: grid.scrollWidth > grid.clientWidth,
        scrollWidth: grid.scrollWidth,
        clientWidth: grid.clientWidth,
      };
    });
    check(!overflow.hasOverflow || overflow.scrollWidth - overflow.clientWidth <= 5, `Simple View has minimal horizontal overflow at ${viewport.width}px (scrollWidth: ${overflow.scrollWidth}, clientWidth: ${overflow.clientWidth}, diff: ${overflow.scrollWidth - overflow.clientWidth}px)`);
    // Back to Sheet View, and the stale-key check that follows it.
    const back = await page.$("button:has-text('Sheet View')");
    if (back) await back.click().catch(() => {});
    await page.waitForTimeout(400);
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
  // The one-time orientation panel is for a FINISHED character, so it must
  // NOT appear while the creation wizard is running - the wizard is itself
  // the guided first run, and a panel about display modes sitting on top of
  // it is noise about a feature nobody has reached yet.
  check(!(await page.$(".sheet-intro")), "no orientation panel over the creation wizard");
  await page.screenshot({ path: path.join(shotDir, `creator-${viewport.name}.png`) });
  // Advance one wizard step to prove the wizard is alive, not paint.
  const nextBtn = await page.$(".wizard button:has-text('Next')");
  if (nextBtn) {
    await nextBtn.click();
    await page.waitForTimeout(800);
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
    await page.waitForTimeout(1500);
    check(await page.$(".choice-row--selected .inline-pick-link"), "Changeling choice summary is the dialog link");
    check(!((await page.$$(".level-guide__choices")).length), "no bottom choice sections for Changeling");
    // The summary opens the shared skills dialog; Escape closes it untouched.
    await page.click(".choice-row--selected .inline-pick-link");
    await page.waitForTimeout(400);
    check(await page.$(".choice-dialog-overlay"), "shared choice dialog opens");
    await page.screenshot({ path: path.join(shotDir, `changeling-${viewport.name}.png`) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
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
    await page.waitForTimeout(1400);
    const highElf = await page.$('.choice-row[data-row-name="High Elf"]');
    check(!!highElf, "and the Elven Subrace row offers High Elf");
    if (highElf) {
      const before = problems.length;
      await highElf.click();
      await page.waitForTimeout(1500);
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
    await page.waitForTimeout(900);
    return hit;
  };

  // Pick a species with a subrace list so there IS a nested row. Dwarf,
  // because Elf was already selected above and clicking it again would
  // toggle it off rather than re-expand it.
  await page.click(rowFor("Dwarf"));
  await page.waitForTimeout(1000);
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
    await page.waitForTimeout(900);
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
  const controlStillWorks = await page.evaluate(() => {
    const row = document.querySelector('.choice-row[data-row-name="Hill Dwarf"]');
    return {
      hasLink: !!row?.querySelector("a"),
      hasSelect: !!row?.querySelector("select"),
    };
  });
  check(controlStillWorks.hasLink || controlStillWorks.hasSelect,
    `and the pick controls inside the details are still present (${JSON.stringify(controlStillWorks)})`);

  // Languages: the picker splits into Widespread / Rare, and the headings
  // cannot be picked. Languages appear as a native <optgroup> inside the
  // inline dropdown (checked here, against the High Elf's extra-language
  // slot) and as headings inside the choice dialog wherever a language group
  // opens one instead - that second shape is covered directly by smoke-dom,
  // because no row on this step happens to route a language group through it.
  await page.click(rowFor("Elf"));
  await page.waitForTimeout(1200);
  await page.click(rowFor("High Elf"));
  await page.waitForTimeout(1200);

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
    await page.waitForTimeout(1500);
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
      await page.waitForTimeout(400);
      const featDlg = await page.$(".choice-dialog-overlay");
      check(!!featDlg, "feat picker dialog opens from lineage link");
      if (featDlg) {
        check(/alert/i.test((await featDlg.textContent()) || ""), "feat picker lists feats as a table");
        // 83 feats need the room. The width is capped by `.modal-box
        // { max-width: 420px }` in another stylesheet, so a one-class
        // override silently loses on file order - the override has to be
        // compound, and this asserts the rendered result rather than the
        // rule, so a reordering of the CSS cannot quietly undo it.
        const dlgWidth = await page.evaluate(() => {
          const box = document.querySelector(".choice-dialog-overlay .choice-dialog");
          return box ? { w: box.getBoundingClientRect().width, vw: window.innerWidth } : null;
        });
        if (dlgWidth) {
          const pct = dlgWidth.w / dlgWidth.vw;
          const expected = viewport.width >= 1100 ? 0.85 : 0.9;
          check(pct >= expected,
            `feat picker is wide on this screen (${Math.round(pct * 100)}% of viewport, wanted ${Math.round(expected * 100)}%)`);
        }
        await page.screenshot({ path: path.join(shotDir, `lineage-feat-${viewport.name}.png`) });
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
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
        await page.waitForTimeout(800);
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
      await page.waitForTimeout(900);
      await page.selectOption(asiSlots.split(", ")[1], "con");
      await page.waitForTimeout(1000);
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
      await page.waitForTimeout(900);
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
      await page.waitForTimeout(1200);
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
      await page.waitForTimeout(900);
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
      await page.waitForTimeout(900);
      const scrollDelta = await page.evaluate(() => (window.__scrollAtClick ?? window.scrollY) - window.scrollY);
      check(Math.abs(scrollDelta) < 4, `clicking a picker row does not move the page (delta ${scrollDelta})`);
    }

    // A spell named in a race trait links to that spell's entry. Tiefling
    // is the probe: its Infernal Legacy names Thaumaturgy, Hellish Rebuke
    // and Darkness in one sentence, and this is where a character reads it.
    await (await page.$('.choice-row[data-row-name="Tiefling"]')).click();
    await page.waitForTimeout(1200);
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
      await page.waitForTimeout(600);
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
      await page.waitForTimeout(500);
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
        await page.waitForTimeout(300);
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
        await page.waitForTimeout(600);
      }
      return page.evaluate((rowSel) => {
        const row = document.querySelector(rowSel);
        const heads = [...(row?.querySelectorAll(".choice-row__mechanics-title") || [])];
        const idx = heads.findIndex((h) => h.textContent === "Spells");
        return idx === -1 ? null : (heads[idx].nextElementSibling?.textContent || "").trim();
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
    await page.waitForTimeout(1800);
    return ok;
  };

  const probe = await seedFinished({ simpleView: false, sawIntro: false, setupComplete: true });
  if (probe) {
  const reopenSheet = async () => {
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const sel = `.character-card:has-text("${probe.name || "Unnamed"}")`;
    if (await page.$(sel)) await page.click(sel);
    await page.waitForTimeout(1600);
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
    const found = await page.evaluate((sel) => {
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
      };
    }, selector);
    if (!found.ok) return found;
    if (!found.hittable) return found;
    await page.mouse.click(found.cx, found.cy);
    return found;
  };

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
  for (const name of ["Cure Wounds", "Guiding Bolt", "Healing Word", "Inflict Wounds",
    "Sanctuary", "Shield of Faith", "Command", "Detect Magic"]) {
    const hit = await clickOnSheet(`.spell-row__prepared-toggle[aria-label="Mark ${name} prepared"]`);
    check(hit.hittable, `every toggle is reachable, including ${name} (${hit.coveredBy || "clear"})`);
    await page.waitForTimeout(400);
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
  const beforeFilter = await page.evaluate(() => document.querySelectorAll(".textlist-item").length);
  await clickOnSheet('.spell-row__prepared-toggle[aria-label="Unprepare Sanctuary"]');
  await clickOnSheet('.spell-row__prepared-toggle[aria-label="Unprepare Command"]');
  await clickOnSheet('.spell-row__prepared-toggle[aria-label="Unprepare Shield of Faith"]');
  await clickOnSheet('.spell-row__prepared-toggle[aria-label="Unprepare Bless"]');
  await page.waitForTimeout(500);
  const filterTap = await clickOnSheet(".spell-list-chrome__filter input");
  check(filterTap.hittable, `the prepared-only filter is clickable too (${filterTap.coveredBy || "clear"})`);
  await page.waitForTimeout(700);
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
  await setUpWizard({
    rules: { className: "Cleric", level: 5, abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 } },
    spells: ["Bless", "Cure Wounds", "Guiding Bolt"],
  });
  await clickOnSheet('.spell-row__prepared-toggle[aria-label="Mark Bless prepared"]');
  await clickOnSheet('.spell-row__prepared-toggle[aria-label="Mark Cure Wounds prepared"]');
  await page.waitForTimeout(700);
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
  await page.waitForTimeout(1600);
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
  await page.waitForTimeout(700);
  const afterPrepare = await history();
  check(afterPrepare.counter === "Prepared: 1 / 8", `one spell prepared (${afterPrepare.counter})`);
  check(afterPrepare.undoDisabled === false, "and Undo becomes available for it");

  await page.click(undoBtn);
  await page.waitForTimeout(800);
  const afterUndo = await history();
  check(afterUndo.counter === "Prepared: 0 / 8",
    `Undo takes the preparation back (got "${afterUndo.counter}")`);
  check(afterUndo.prepared.length === 0, "and the row's toggle goes with it");
  check(afterUndo.redoDisabled === false, "and Redo becomes available");

  await page.click(redoBtn);
  await page.waitForTimeout(800);
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
    await page.waitForTimeout(1600);
  };
  await page.click(".sheet-intro__dismiss");
  await page.waitForTimeout(500);
  check(!(await page.$(".sheet-intro")), "the orientation panel dismisses");
  await reopen();
  check(!(await page.$(".sheet-intro")), "a dismissed orientation panel stays dismissed after a reload");

  // Simple View on, reload, still on.
  const simpleToggle = await page.$("button:has-text('Simple View')");
  check(!!simpleToggle, "a finished character offers the Simple View toggle");
  if (simpleToggle) {
    await simpleToggle.click();
    await page.waitForTimeout(600);
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
    await page.click("button:has-text('Sheet View')");
    await page.waitForTimeout(600);
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
        await page.waitForTimeout(300);
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

for (const viewport of viewportSizes) {
  await runViewportTests(viewport);
}


// check() is scoped inside runViewportTests; this block is module level,
// so it uses its own reporter writing to the same failures array.
// check() is scoped inside runViewportTests; this block is module level, so
// it gets its own reporter writing to the same failures array.
const phoneCheck = (cond, msg) => {
  if (!cond) failures.push("[phone] " + msg);
  console.log((cond ? "ok" : "FAIL") + " [phone]: " + msg);
};


// --- Phone portrait: Your Characters -------------------------------------
//
// Two complaints: the cards were three across when four fit, and the level /
// race / class lines were not displayed at all on a phone - the media query
// set .character-card__meta-lines to display:none, so a phone showed a
// portrait and a name and nothing else.
{
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  phone.on("pageerror", (e) => problems.push(`PAGEERROR [phone]: ${e.message}`));
  await phone.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
  await phone.waitForTimeout(1500);
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
  phoneCheck(!!gridRule && String(gridRule.cols).split(" ").length >= 4,
    `the phone grid lays out four tracks (${JSON.stringify(gridRule)})`);

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
    return {
      cards: cards.length,
      firstRow: row[0] || 0,
      cardW: Math.round(cards[0]?.getBoundingClientRect().width || 0),
      cardH: Math.round(cards[0]?.getBoundingClientRect().height || 0),
      metaDisplay: metaStyle?.display || "none",
      metaHeight: Math.round(meta?.getBoundingClientRect().height || 0),
      visibleLines: visibleLines.slice(0, 8),
      anyLineClipped: visibleLines.some((l) => l.shown === false),
    };
  });
  phoneCheck(grid.cards >= 4, `the vault has several characters to lay out (got ${grid.cards})`);
  phoneCheck(grid.firstRow >= 4,
    `four cards fit across a phone (got ${grid.firstRow} in the first row, card ${grid.cardW}x${grid.cardH})`);
  // "Half as wide and half as tall so four fit where one did" is the stated
  // goal; the width that actually achieves it is a quarter of the old
  // single-column width, so the check is on the density and on the card being
  // small, not on a literal halving that cannot also give four across.
  phoneCheck(grid.cardW <= 95 && grid.cardH <= 170,
    `and each card is small enough that to be true (${grid.cardW}x${grid.cardH}, was 342x413 one-across)`);
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

const vaultPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
vaultPage.on("pageerror", (e) => problems.push(`PAGEERROR [vault]: ${e.message}`));
vaultPage.on("console", (m) => { if (m.type() === "error") problems.push(`CONSOLE [vault]: ${m.text()}`); });

const vaultCheck = (cond, msg) => {
  if (!cond) failures.push(`[vault] ${msg}`);
  console.log(`${cond ? "ok" : "FAIL"} [vault]: ${msg}`);
};

await vaultPage.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
await vaultPage.waitForTimeout(1200);
const newBtn = await vaultPage.$("button:has-text('+ New Character')");
vaultCheck(!!newBtn && (await newBtn.isVisible()), "vault + New Character button visible");
if (newBtn) await newBtn.click();
await vaultPage.waitForTimeout(2000);
vaultCheck(await vaultPage.$(".wizard"), "creator wizard renders after + New Character");
await vaultPage.screenshot({ path: path.join(shotDir, "creator.png") });
// Advance one wizard step to prove the wizard is alive, not paint.
const nextBtn = await vaultPage.$(".wizard button:has-text('Next')");
if (nextBtn) {
  await nextBtn.click();
  await vaultPage.waitForTimeout(800);
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
  await vaultPage.waitForTimeout(1500);
  vaultCheck(await vaultPage.$(".choice-row--selected .inline-pick-link"), "Changeling choice summary is the dialog link");
  vaultCheck(!((await vaultPage.$$(".level-guide__choices")).length), "no bottom choice sections for Changeling");
  // The summary opens the shared skills dialog; Escape closes it untouched.
  await vaultPage.click(".choice-row--selected .inline-pick-link");
  await vaultPage.waitForTimeout(400);
  vaultCheck(await vaultPage.$(".choice-dialog-overlay"), "shared choice dialog opens");
  await vaultPage.screenshot({ path: path.join(shotDir, "changeling.png") });
  await vaultPage.keyboard.press("Escape");
  await vaultPage.waitForTimeout(300);
  vaultCheck(!(await vaultPage.$(".choice-dialog-overlay")), "shared choice dialog closes on Escape");
}
const vaultLineage = await vaultPage.$(`.choice-row[data-row-name="Custom Lineage"]`);
vaultCheck(!!vaultLineage, "Identity step lists Custom Lineage");
if (vaultLineage) {
  await vaultLineage.click();
  await vaultPage.waitForTimeout(1500);
  const vaultFeatLink = await vaultPage.$(".choice-row--selected .inline-pick-link");
  const vaultFeatText = vaultFeatLink ? await vaultFeatLink.textContent() : "";
  vaultCheck(!!vaultFeatLink && /choose a feat/i.test(vaultFeatText || ""), "lineage feat mention is the picker link");
  vaultCheck((await vaultPage.textContent("body")).includes("Racial feat"), "Racial feat picker sits on Identity");
  if (vaultFeatLink) {
    await vaultFeatLink.click();
    await vaultPage.waitForTimeout(400);
    const vaultFeatDlg = await vaultPage.$(".choice-dialog-overlay");
    vaultCheck(!!vaultFeatDlg, "feat picker dialog opens from lineage link");
    if (vaultFeatDlg) {
      vaultCheck(/alert/i.test((await vaultFeatDlg.textContent()) || ""), "feat picker lists feats as a table");
      await vaultPage.screenshot({ path: path.join(shotDir, "lineage-feat.png") });
    }
    await vaultPage.keyboard.press("Escape");
    await vaultPage.waitForTimeout(300);
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
{
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

await browser.close();
server.close();

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
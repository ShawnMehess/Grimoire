// check-imports.mjs
// Static checks, no DOM or Firebase needed:
//   1. import graph: every relative import in customSheet.js and
//      js/render/sheet/*.js must resolve to a file on disk.
//   2. syntax: every repo JS file must parse (node --check) — a syntax
//      error in an entry file fails in the browser before any app code
//      runs, so this gates what smoke-imports (which can't import
//      DOM-dependent modules) never sees.
//   3. css: every repo CSS file must have balanced braces, and a bare
//      `button { display: none }` rule must live inside `@media print`
//      — a dropped `@media print {` line once applied the whole print
//      block globally and hid every button site-wide.
// Run: node scripts/check-imports.mjs
import { readdirSync, readFileSync, existsSync, mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));
const SHEET_DIR = join(ROOT, "js", "render", "sheet");
const files = [
  join(ROOT, "js", "render", "customSheet.js"),
  ...readdirSync(SHEET_DIR).filter((f) => f.endsWith(".js")).map((f) => join(SHEET_DIR, f)),
];

let missing = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const re = /from\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const spec = m[1];
    if (!spec.startsWith(".")) continue;
    const base = resolve(dirname(file), spec);
    if (!existsSync(base) && !existsSync(base + ".js")) {
      missing.push(`${file} -> ${spec}`);
    }
  }
}

console.log(`checked ${files.length} files`);
if (missing.length) {
  console.error("MISSING:\n" + missing.join("\n"));
  process.exit(1);
} else {
  console.log("imports: all resolve");
}

// Every JS file in the repo must at least parse — including entry
// points like js/main.js that no test suite imports (DOM at module
// scope), and the Firebase-backed modules Node cannot execute.
// NOTE: plain `node --check x.js` does NOT catch early errors in
// typeless .js files containing ESM (it passes files with genuine
// duplicate-binding/paren bugs), so .js sources are checked as .mjs
// copies — pure parse, no imports resolve, temp file removed after.
function jsFilesUnder(dir, extension) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full, extension));
    else if (entry.name.endsWith(extension)) out.push(full);
  }
  return out;
}
const syntaxFiles = [
  ...jsFilesUnder(join(ROOT, "js"), ".js"),
  ...jsFilesUnder(join(ROOT, "scripts"), ".mjs"),
  ...(existsSync(join(ROOT, "tests")) ? jsFilesUnder(join(ROOT, "tests"), ".mjs") : []),
];
const syntaxErrors = [];
const checkDir = mkdtempSync(join(tmpdir(), "grimoire-syntax-"));
try {
  syntaxFiles.forEach((file, i) => {
    // .mjs checks directly; .js goes through a same-bytes .mjs copy
    // so module-goal parsing applies (see NOTE above).
    const target = file.endsWith(".mjs") ? file : join(checkDir, `check-${i}.mjs`);
    if (target !== file) copyFileSync(file, target);
    try {
      execFileSync(process.execPath, ["--check", target], { stdio: "pipe" });
    } catch {
      syntaxErrors.push(file);
    }
  });
} finally {
  rmSync(checkDir, { recursive: true, force: true });
}
console.log(`parsed ${syntaxFiles.length} files`);
if (syntaxErrors.length) {
  console.error("SYNTAX ERRORS:\n" + syntaxErrors.join("\n"));
  process.exit(1);
} else {
  console.log("syntax: all parse");
}

function cssFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFilesUnder(full));
    else if (entry.name.endsWith(".css")) out.push(full);
  }
  return out;
}
const cssErrors = [];
const cssFiles = cssFilesUnder(join(ROOT, "css"));
for (const file of cssFiles) {
  const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  let balanced = true;
  for (const ch of src) {
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth < 0) { balanced = false; break; }
    }
  }
  if (!balanced || depth !== 0) {
    cssErrors.push(`${file}: unbalanced braces`);
    continue;
  }
  // Strip @media print blocks (one nesting level: selector { decls }),
  // then a bare-button display:none left over is global — fail loudly.
  //
  // Screen-mode rules are NOT stripped: they must be descendant-scoped to
  // their mode, and a rule that reads as a global `button { display: none }`
  // is the failure this catches. (An earlier version stripped every
  // .page-grid.play-mode block wholesale to let that mode hide buttons;
  // it was removed with the half-dead Play View mode itself.)
  const withoutPrint = src
    .replace(/@media\s+print\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, "")
    .replace(/@media\s*\([^)]*\)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, "");
  if (/(^|[,{\s])button\s*\{[^}]*display\s*:\s*none/.test(withoutPrint)) {
    cssErrors.push(`${file}: bare 'button { display: none }' outside @media print`);
  }

  // Nothing that renders WORDS may be smaller than 12px.
  //
  // There is a real allowlist, because the alternative is worse than the
  // problem: a drag handle (⠿), a disclosure caret (▸) and a ✕ delete button
  // are glyphs inside fixed-size affordances, and enlarging the glyph to
  // 12px overflows the affordance it lives in. Those are listed by selector
  // and left alone deliberately.
  //
  // What this catches is the case that actually matters: a text label
  // somebody set to 10px because it was a "small caption", which is how the
  // three uppercase labels in this app ended up at 10px in the first place.
  // Uppercase is the worst case at a small size, so the three that were
  // fixed were all `text-transform: uppercase`.
  const GLYPH_ONLY_SELECTORS = new Set([
    ".character-card__delete",              // ✕
    ".character-card__duplicate",           // ⧉
    ".dropdown-choices-editor__handle",    // drag handle
    ".bundle-library-list__group-caret",   // ▸ / ▾
    ".identity-card-fields__chip button",  // ✕ on a card-field chip
    ".textlist-item__handle",              // drag handle
    ".textlist-item__remove",              // ✕
    ".taglist-chip__remove",               // ✕
    ".drag-handle",                        // ⠿
    ".resize-handle",                      // corner grip
    ".node-toolbar button",                // ✕ / ⤢ in the hover toolbar
    ".equation-hint",                      // ƒ glyph
    ".field-type-preview-label",           // icon preview in the picker
    ".field-type-preview-tag",             // icon preview in the picker
    ".field-type-preview-dropdown",        // icon preview in the picker
    ".field-roll button",                  // die glyph
    ".formula-error-badge",                // glyph badge
    ".style-badge",                        // glyph badge
    "input[type=\"checkbox\"]:checked::after",   // ✓ glyph
  ]);
  for (const match of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim().split("\n").pop().trim();
    const decls = match[2];
    if (!selector || selector.startsWith("@")) continue;
    // Allowlist is matched against the whole selector AND against its last
    // compound part, with pseudo-classes stripped. Both matter: the entries
    // are written the way the rules are written (".a button"), and a
    // bare descendant like ".node-toolbar button" otherwise resolves to just
    // "button", which says nothing about what it styles.
    const strip = (s) => s.replace(/:(hover|focus|active|focus-visible)$/, "");
    const whole = strip(selector);
    const compound = strip(whole.split(/[\s,]+/).pop());
    if (GLYPH_ONLY_SELECTORS.has(whole) || GLYPH_ONLY_SELECTORS.has(compound)) continue;
    const size = decls.match(/font-size\s*:\s*(\d+(?:\.\d+)?)px/);
    if (size && Number(size[1]) < 12) {
      cssErrors.push(`${file}: ${selector} sets font-size: ${size[1]}px - text must be 12px or larger (add the selector to GLYPH_ONLY_SELECTORS in check-imports.mjs if it is a glyph in a fixed-size box)`);
    }
  }
}
console.log(`checked ${cssFiles.length} css files`);
if (cssErrors.length) {
  console.error("CSS ERRORS:\n" + cssErrors.join("\n"));
  process.exit(1);
} else {
  console.log("css: braces balanced, screen chrome visible, no sub-12px text");
}

// --- index.html: the page's only non-JS fallbacks --------------------------
//
// Both of these exist because the alternative is a page that silently does
// nothing, and neither is exercised by any other check: the loading screen
// is markup in the HTML, so a CSS or JS change cannot break it, but deleting
// the panel beside it can. Both are cheap to assert and impossible to notice
// by eye once they are gone.
{
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const htmlErrors = [];
  if (!/<noscript>/i.test(html)) {
    htmlErrors.push("index.html has no <noscript> — a visitor without JavaScript gets the loading screen forever");
  }
  if (!/id="app-noscript"/.test(html)) {
    htmlErrors.push("index.html's <noscript> has no #app-noscript panel to reveal");
  }
  // The inline <style> in <noscript> has to neutralize the loading screen,
  // or the two are stacked and only the hidden one is reachable.
  if (!/\.app-loading-screen\s*\{\s*display:\s*none\s*!important/.test(html)) {
    htmlErrors.push("index.html's <noscript> does not hide the loading screen");
  }
  // The load-failure listener must be a CLASSIC script, before the module.
  // A module that fails to parse takes the recovery down with it.
  const listenerAt = html.search(/addEventListener\(\s*["']unhandledrejection["']/);
  const moduleAt = html.search(/<script\s+type=["']module["']/);
  if (listenerAt === -1) {
    htmlErrors.push("index.html has no unhandledrejection listener — a rejected top-level await hangs the loading screen forever");
  } else if (moduleAt !== -1 && listenerAt > moduleAt) {
    htmlErrors.push("index.html's load-failure listener is AFTER the module script — it cannot catch the module failing to load");
  }
  // A 12s backstop, or the "runs but hangs" case is still a blank spinner.
  if (!/setTimeout\([\s\S]{0,400}?\b12\d{3}\b/.test(html)) {
    htmlErrors.push("index.html's load-failure watchdog is missing or not ~12s");
  }
  if (htmlErrors.length) {
    console.error("HTML ERRORS:\n" + htmlErrors.map((e) => `index.html: ${e}`).join("\n"));
    process.exit(1);
  }
  console.log("index.html: noscript fallback + load-failure recovery present and ordered correctly");
}

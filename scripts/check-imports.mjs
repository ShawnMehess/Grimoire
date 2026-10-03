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
import { execFileSync, execFile } from "node:child_process";
import { cpus } from "node:os";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Module-goal parsing, in-process. Undefined without
// --experimental-vm-modules, which is why there is a fallback below rather
// than a hard dependency on the flag.
import vm from "node:vm";

const { SourceTextModule } = vm;
const execFileAsync = promisify(execFile);

// Re-exec once WITH the flag rather than making every caller remember it.
//
// The in-process parse is ~25x faster than spawning a checker per file, so
// it is worth one extra process start (a few ms) to guarantee it is the path
// taken. Anyone running this file directly - `node scripts/check-imports.mjs`,
// which is how the README and several scripts invoke it - gets the fast path
// without editing anything or copying a flag out of this file. The env guard
// stops it recursing, and a failed re-exec is not fatal: the fallback pool
// below still produces the same verdict.
if (!SourceTextModule && !process.env.GRIMOIRE_VM_MODULES) {
  try {
    execFileSync(process.execPath, ["--no-warnings", "--experimental-vm-modules", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      stdio: "inherit",
      env: { ...process.env, GRIMOIRE_VM_MODULES: "1" },
    });
    process.exit(0);
  } catch {
    // Fall through to the subprocess pool. Whatever made the re-exec fail
    // (a locked-down sandbox, a stripped Node build) is not a reason to fail
    // the gate.
  }
}

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
//
// Two things this has to get right:
//
//  - Plain `node --check x.js` does NOT catch early errors in typeless .js
//    files containing ESM: it parses them as CommonJS-ish script and passes
//    files with genuine duplicate-binding bugs. The parse therefore has to
//    happen in MODULE GOAL, which is why the .js files were copied to .mjs
//    before being checked.
//  - It has to be fast. Spawning one `node --check` per file is 129
//    interpreter startups, and that was 7.4 seconds - 70% of this whole
//    gate - spent waiting for the same binary to boot 129 times. Overlapping
//    them helps (7.4s -> 2.6s) but bottoms out around 1.9s because the cost
//    is startup, not parsing.
//
// So the fast path parses in THIS process with `vm.SourceTextModule`, which
// is module-goal by construction and needs no temp files at all: 129 files
// in ~310ms, a 24x improvement, with identical coverage (verified to catch
// the same duplicate-binding error `node --check` catches). It is behind
// --experimental-vm-modules, so if that API is unavailable the parallel
// subprocess pool below is the fallback rather than a hard failure.
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

if (typeof SourceTextModule === "function") {
  for (const file of syntaxFiles) {
    try {
      // Parse only - no imports are resolved and nothing is evaluated, so a
      // file that touches `document` at module scope is fine here.
      // eslint-disable-next-line no-new
      new SourceTextModule(readFileSync(file, "utf8"), { identifier: file });
    } catch (e) {
      syntaxErrors.push(`${file}: ${e.message.split("\n")[0]}`);
    }
  }
} else {
  // Fallback: same checks, run concurrently rather than one at a time. The
  // pool size is the CPU count, not the file count - past one check per core
  // there is nothing left to overlap except memory bandwidth, and a 129-way
  // spawn on a small machine just thrashes.
  const checkDir = mkdtempSync(join(tmpdir(), "grimoire-syntax-"));
  try {
    // .mjs checks directly; .js goes through a same-bytes .mjs copy so
    // module-goal parsing applies (see NOTE above).
    const targets = syntaxFiles.map((file, i) => {
      const target = file.endsWith(".mjs") ? file : join(checkDir, `check-${i}.mjs`);
      if (target !== file) copyFileSync(file, target);
      return { file, target };
    });
    const CONCURRENCY = Math.max(1, Math.min(targets.length, cpus().length));
    let next = 0;
    const worker = async () => {
      while (true) {
        const i = next++;
        if (i >= targets.length) return;
        const { file, target } = targets[i];
        try {
          await execFileAsync(process.execPath, ["--check", target], { stdio: "pipe" });
        } catch {
          syntaxErrors.push(`${file}: does not parse`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } finally {
    rmSync(checkDir, { recursive: true, force: true });
  }
}
console.log(`parsed ${syntaxFiles.length} files${typeof SourceTextModule === "function" ? " (in-process)" : " (subprocess pool)"}`);
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

// --- js: no interpolated innerHTML ----------------------------------------
//
// Why this rule exists: `item.innerHTML = `<span>${lib.name}</span>`` was live
// in both library editors. A library name is user-authored and persisted, and a
// global library is written to publicBundleLibraries and read back by every
// user, so a name of `<img src=x onerror=...>` executed in every other
// session that opened the manager. Stored, cross-user, and reachable by
// anyone who can publish a global bundle.
//
// The rule is deliberately narrow - it fires only on a TEMPLATE LITERAL with
// an interpolation, which is the shape that was actually exploitable. It
// does not try to judge `x.innerHTML = someVariable`, because roughly ten of
// those exist today and are a different question: they are the rich-text
// round-trip (js/render/sheet/sheetFields.js writes `field.value` back into a
// contenteditable so bold/italic/colour survive a save, and reads it out
// again), which is stored markup by design rather than by accident. Deciding
// that one needs sanitisation at the boundary is its own piece of work, and
// folding it in here would mean either failing the gate on pre-existing
// deliberate code or quietly allowlisting a security decision.
//
// The safe path is el() in js/render/sheet/sheetHelpers.js, which puts
// strings in textContent, or `x.innerHTML = ""` to clear.
{
  const markupErrors = [];
  for (const file of jsFilesUnder(join(ROOT, "js"), ".js")) {
    // Block comments only. Stripping `//` would mangle the https:// URLs that
    // appear in string literals in these files.
    const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of src.matchAll(/\.innerHTML\s*=\s*`/g)) {
      // Walk the template literal to its closing (unescaped) backtick and
      // look for an interpolation before it.
      let i = m.index + m[0].length;
      let interpolated = false;
      while (i < src.length) {
        const ch = src[i];
        if (ch === "\\") { i += 2; continue; }
        if (ch === "`") break;
        if (ch === "$" && src[i + 1] === "{") { interpolated = true; break; }
        i++;
      }
      if (!interpolated) continue;
      const line = src.slice(0, m.index).split("\n").length;
      markupErrors.push(
        `${file}:${line}: innerHTML is assigned a template literal with an interpolation - ` +
        `a name or category reaching the DOM this way is executed as markup. Use el() from ` +
        `js/render/sheet/sheetHelpers.js so the text lands in textContent.`
      );
    }
  }
  if (markupErrors.length) {
    console.error("MARKUP ERRORS:\n" + markupErrors.join("\n"));
    process.exit(1);
  } else {
    console.log("markup: no interpolated innerHTML in js/");
  }
}

// --- js: document/window listeners must be removable ------------------------
//
// Why: a listener registered on `document` or `window` outlives the element
// it was set up for, because neither node is ever torn down. The only thing
// that removes one is destroy() holding a reference to it — and an inline
// `document.addEventListener("pointerdown", (e) => {...})` leaves no
// reference to hold. That exact line shipped in customSheet.js: the handler
// fired on every pointerdown for the rest of the session and could still call
// renderPageGrid() on a detached tree, once per character ever opened.
//
// So the rule is: on document/window, the listener must be a name, not an
// inline function. Removal is then destroy()'s job to get right, which is
// reviewable; this rule only removes the reason it silently couldn't be.
//
// Scoped to document/window on purpose. Listeners on a renderer's own nodes
// are fine either way: those nodes are discarded on the next full re-render,
// so listener churn is bounded by node churn.
{
  const listenerErrors = [];
  // A handler is removable if it resolves to a reference: a bare name, a
  // member expression (`obj.handler`), or an indexed one (`handlers[k]`).
  // It is NOT removable if it is a function or class expression, or any
  // arrow — those exist only for the duration of the call. Testing the shape
  // directly is more reliable than pattern-matching an identifier, which
  // happily matches the word `function`.
  const handlerIsReference = (expr) => {
    const s = expr.trim();
    if (/^(async\s+)?(function\b|class\b)/.test(s)) return false;
    if (s.includes("=>")) return false;
    return true;
  };
  for (const file of jsFilesUnder(join(ROOT, "js"), ".js")) {
    const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of src.matchAll(/\b(document|window)\.addEventListener\s*\(/g)) {
      // Walk from the open paren to its match, tracking nesting and strings,
      // to get exactly this call's argument list.
      let i = m.index + m[0].length;
      let depth = 1;
      let quote = null;
      const start = i;
      while (i < src.length && depth > 0) {
        const ch = src[i];
        if (quote) {
          if (ch === "\\") { i += 2; continue; }
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
        else if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth--;
        if (depth === 0) break;
        i++;
      }
      const args = src.slice(start, i);
      // Split off the event name (first argument), then look at the handler.
      const comma = args.indexOf(",");
      if (comma === -1) continue;
      const handler = args.slice(comma + 1);
      // Trailing options argument (capture, passive, once) is not the handler.
      const lastComma = handler.lastIndexOf(",");
      const handlerExpr = lastComma === -1 ? handler : handler.slice(0, lastComma);
      if (handlerIsReference(handlerExpr)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      listenerErrors.push(
        `${file}:${line}: ${m[1]}.addEventListener(<inline>) - an inline handler cannot be removed, ` +
        `and document/window outlive every element here. Hoist it to a const/function so destroy() can ` +
        `take it off again.`
      );
    }
  }
  if (listenerErrors.length) {
    console.error("LISTENER ERRORS:\n" + listenerErrors.join("\n"));
    process.exit(1);
  } else {
    console.log("listeners: no unremovable document/window listeners");
  }
}

// --- js/data must not reach up into render, state or ui ---------------------
//
// README.md describes js/data as "content and rules. Pure. No DOM, no
// Firebase." That was not true: js/data/choiceCategories.js imported the
// page-routing table from js/render/sheet/sheetMechanics.js, so the data
// layer could not be loaded in a data-only context — which is what the
// content compilers, the offline tooling and the migration work all need.
//
// Direction matters more than the specific pair. js/data is the bottom of
// the stack; anything that touches the DOM, the network or the store sits
// above it. An upward import is the one error that makes the layers a graph
// instead of a stack, and it is invisible in review because the import looks
// locally reasonable.
//
// ui -> render is deliberately NOT flagged. js/ui/dialogs.js borrows el()
// from the sheet helpers, which is untidy naming rather than an inversion:
// both layers are above data, so nothing below them is affected.
{
  const layeringErrors = [];
  const dataDir = join(ROOT, "js", "data");
  for (const file of jsFilesUnder(dataDir, ".js")) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
      const spec = m[1];
      if (!spec.startsWith(".")) continue;
      const target = resolve(dirname(file), spec).replace(/\\/g, "/");
      const rel = target.slice(ROOT.replace(/\\/g, "/").length + 1);
      if (!/^js\/(render|state|ui)\//.test(rel)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      layeringErrors.push(
        `${file}:${line}: js/data imports ${rel} - data is the bottom layer, so this inverts the ` +
        `stack and makes js/data unloadable without a DOM. Move the shared piece down into js/data, ` +
        `or up into a module both may import.`
      );
    }
  }
  if (layeringErrors.length) {
    console.error("LAYERING ERRORS:\n" + layeringErrors.join("\n"));
    process.exit(1);
  } else {
    console.log("layering: js/data imports nothing from render, state or ui");
  }
}

// --- js: the dependency-injection ratchet ------------------------------------
//
// The convention across js/render/sheet/ is that a renderer takes its
// collaborators as an explicit `deps` object rather than closing over them.
// That is a genuine improvement over reaching into a parent scope - the pure
// half of each module is callable from a test - but the shape it settled into
// passes each dependency as its own key: 265 of them from customSheet.js, and
// 278 across the five files that use it.
//
// The honest cost is that a caller has to know the name of every collaborator
// a callee reaches for, and the callee cannot tell you the list: it is
// whatever the call site happens to pass. That is the part worth shrinking.
//
// A full collapse into one context object was scoped and then not done. The
// original justification was three "monster" functions, and measuring them
// directly showed two of the three were 58 and 218 lines rather than the
// 825 and 1,976 an earlier estimate claimed - the estimate had counted
// nested functions as part of the enclosing one. There is one large function
// left (renderRulesetLevelGuide, ~880 lines), and rewriting 265 call sites
// to address a problem that size is not a trade worth making blind.
//
// So this is a ratchet rather than a refactor. The count was never
// measurable before; now it is printed on every gate run and cannot rise
// without someone editing this file and saying why in the commit that does
// it. Lowering the baseline is the intended direction and needs no
// justification; raising it does.
//
// New modules should take a single context object instead of adding to the
// count, which is why a file outside the existing set trips this too.
{
  const BASELINE = 278;
  // One recursive walk of js/render, which covers customSheet.js, everything
  // under sheet/, and the standalone editors. Walking those as separate lists
  // double-counted customSheet.js and reported 543 against a real 278.
  const depFiles = jsFilesUnder(join(ROOT, "js", "render"), ".js");
  let total = 0;
  for (const file of depFiles) {
    if (!existsSync(file)) continue;
    total += (readFileSync(file, "utf8").match(/\b[a-zA-Z_$][\w$]*Fn\s*:/g) || []).length;
  }
  if (total > BASELINE) {
    console.error(
      `DEPENDENCY-INJECTION RATCHET: ${total} injected dependency keys, baseline ${BASELINE}.\n` +
      `  New renderers should take one context object rather than adding to the count.\n` +
      `  If this genuinely had to rise, raise BASELINE in check-imports.mjs and say why in the\n` +
      `  commit - a higher number needs a reason, a lower one does not.`
    );
    process.exit(1);
  }
  console.log(`di: ${total}/${BASELINE} injected dependency keys (${BASELINE - total} of headroom)`);
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

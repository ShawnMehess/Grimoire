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
  // Also strip @media print-like blocks for Play View (which also hides buttons
  // but is not a print context — it's a legitimate screen-mode feature).
  let withoutPrint = src
    .replace(/@media\s+print\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, "")
    .replace(/@media\s*\([^)]*\)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, "");
  // Remove all .page-grid.play-mode selector blocks (they can span multiple rules)
  while (true) {
    const idx = withoutPrint.indexOf(".page-grid.play-mode");
    if (idx === -1) break;
    // Find the end of this selector block
    let depth = 0;
    let start = -1;
    for (let i = idx; i < withoutPrint.length; i++) {
      if (withoutPrint[i] === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (withoutPrint[i] === "}") {
        depth--;
        if (depth === 0) {
          withoutPrint = withoutPrint.slice(0, idx) + withoutPrint.slice(i + 1);
          break;
        }
      }
    }
  }
  if (/(^|[,{\s])button\s*\{[^}]*display\s*:\s*none/.test(withoutPrint)) {
    cssErrors.push(`${file}: bare 'button { display: none }' outside @media print`);
  }
}
console.log(`checked ${cssFiles.length} css files`);
if (cssErrors.length) {
  console.error("CSS ERRORS:\n" + cssErrors.join("\n"));
  process.exit(1);
} else {
  console.log("css: braces balanced, screen chrome visible");
}

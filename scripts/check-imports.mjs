// check-imports.mjs
// Static checks, no DOM or Firebase needed:
//   1. import graph: every relative import in customSheet.js and
//      js/render/sheet/*.js must resolve to a file on disk.
//   2. syntax: every repo JS file must parse (node --check) — a syntax
//      error in an entry file fails in the browser before any app code
//      runs, so this gates what smoke-imports (which can't import
//      DOM-dependent modules) never sees.
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

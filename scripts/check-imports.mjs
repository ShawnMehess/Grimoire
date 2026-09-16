// check-imports.mjs
// Static import-graph check: every relative import in customSheet.js
// and js/render/sheet/*.js must resolve to a file on disk.
// Run: node scripts/check-imports.mjs
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
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

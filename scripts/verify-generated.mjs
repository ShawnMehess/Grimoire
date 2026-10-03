#!/usr/bin/env node
// scripts/verify-generated.mjs
//
// Asserts that every committed generated data module is byte-identical to
// what its compiler produces right now.
//
// WHY THIS EXISTS
//
// README.md states the rule this app depends on: "Generated files are never
// hand-edited. Everything applied on top of them lives in a fixup layer, so
// the generators stay regenerable." That rule has two halves, and until now
// only one was checked:
//
//   - Nothing gets hand-edited INTO a generated file.   (was unenforced)
//   - Nothing gets applied on top that only exists there. (enforced, by
//     contentFixups.js being a separate module)
//
// So the whole design rested on a comment. A stray edit inside a 48,927-line
// generated file is invisible in review and would be silently reverted by the
// next person who regenerates - which is how a hand-curated rules fix turns
// into a content regression months later with no error anywhere.
//
// This turns the promise into a check. All three compilers are already
// byte-reproducible from committed sources (verified: a clean run of each
// leaves `git status` empty), so this gate passes on a clean tree and fails
// the moment a generated file and its source disagree.
//
// WHY IT COMPILES TO A TEMP FILE
//
// The obvious implementation - regenerate in place, then `git diff` - would
// leave the working tree dirty on failure, which is the worst possible
// outcome for a gate: it breaks the tree it was checking, and the person
// running it now has to work out which of their own edits the compiler just
// clobbered. GRIMOIRE_OUT redirects each compiler's output instead, so this
// script never writes inside the repo.
//
// NOT COVERED: js/data/subclassFeatureText.js
//
// Its input is .fetch-subclass-raw.json - the wikidot.com scrape cache, which
// is gitignored on purpose (it is a few MB of fetched HTML, and the compiled
// module is committed precisely so the sheet needs no network). With the
// input absent there is nothing to compile from, so that module's provenance
// rests on check-subclass-sourcing.mjs instead, which enforces the stronger
// property that matters for it anyway: no feature text reaches the output
// except verbatim from a recorded source.
//
// Also absent: js/data/defaultContent.js, the largest single artifact, whose
// compiler is a one-off Python script not in the repo (docs/RESCUE-NOTES.md,
// "Regenerating this later"). It is hand-maintained from here, so there is no
// compiler to compare against and nothing for this gate to say about it.
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));

// compiler -> the committed module it is supposed to have produced.
const GENERATED = [
  { compiler: "compile-foundry-catalogs.mjs", output: "js/data/contentCatalogs.js" },
  { compiler: "compile-foundry-feats.mjs", output: "js/data/featBundles.js" },
  { compiler: "compile-foundry-subclasses.mjs", output: "js/data/subclassContent.js" },
];

// Compare with line endings normalized. .gitattributes sets `* text=auto`,
// so a checkout on Windows can hold CRLF while the compilers emit LF, and a
// raw byte compare would fail on a tree that is actually clean.
const normalize = (s) => s.replace(/\r\n/g, "\n");

const tmp = mkdtempSync(join(tmpdir(), "grimoire-generated-"));
const problems = [];

try {
  for (const { compiler, output } of GENERATED) {
    const committedPath = join(ROOT, output);
    if (!existsSync(committedPath)) {
      problems.push(`${output}: committed module is missing`);
      continue;
    }
    const freshPath = join(tmp, output.replace(/[\\/]/g, "__"));
    try {
      // Compiler chatter is expected and not interesting; only a non-zero
      // exit means the compile itself broke.
      execFileSync(process.execPath, [join(ROOT, "scripts", compiler)], {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GRIMOIRE_OUT: freshPath },
      });
    } catch (err) {
      const detail = (err.stderr?.toString() || err.message || "").trim().split("\n").slice(-6).join("\n    ");
      problems.push(`${output}: ${compiler} exited non-zero\n    ${detail}`);
      continue;
    }
    if (!existsSync(freshPath)) {
      problems.push(`${output}: ${compiler} wrote no output to GRIMOIRE_OUT`);
      continue;
    }

    const committed = normalize(readFileSync(committedPath, "utf8"));
    const fresh = normalize(readFileSync(freshPath, "utf8"));
    if (committed === fresh) continue;

    // Report where, not just that. A generated file is far too large to read
    // a raw diff of, and the first diverging line is usually enough to tell a
    // stale regeneration from a hand-edit.
    const a = committed.split("\n");
    const b = fresh.split("\n");
    let firstDiff = 0;
    while (firstDiff < a.length && firstDiff < b.length && a[firstDiff] === b[firstDiff]) firstDiff++;
    problems.push(
      `${output}: committed module differs from a fresh compile of ${compiler}\n` +
      `    first difference at line ${firstDiff + 1} ` +
      `(committed ${a.length} lines, fresh ${b.length} lines)\n` +
      `    committed: ${(a[firstDiff] ?? "<eof>").trim().slice(0, 110)}\n` +
      `    fresh:     ${(b[firstDiff] ?? "<eof>").trim().slice(0, 110)}\n` +
      `    If the committed file is right, fix the compiler. If the source moved on, ` +
      `regenerate and commit both together. Do not hand-edit either side.`
    );
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (problems.length) {
  console.error("GENERATED FILES ARE STALE OR HAND-EDITED:\n" + problems.map((p) => "  - " + p).join("\n\n"));
  process.exit(1);
}

console.log(`generated: ${GENERATED.length} modules byte-identical to a fresh compile`);
console.log("  (subclassFeatureText.js and defaultContent.js have no in-repo compiler - see the header)");

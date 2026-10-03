#!/usr/bin/env node
// gate-fast.mjs
//
// The five no-browser gates, in one process tree.
//
// Why this file exists rather than five npm scripts chained with &&:
// npm spawns a fresh Node process per script, and at these gate sizes that
// overhead is the dominant cost. Measured on this repo, the same five gates
// cost ~3.9s run directly and ~16s through `concurrently` over npm scripts -
// more than four seconds of pure process startup to save two seconds of
// wall clock. So: run them as plain child processes, no npm in the loop.
//
// They still run CONCURRENTLY, because that is free here - the work is real
// parsing and simulation, not I/O wait - and it means the gate costs about
// as much as its slowest single member rather than the sum of all five.
//
// The exit code is the point: non-zero if ANY gate fails, and every gate
// still runs to completion so one broken gate does not hide the next.
//
// Run: node scripts/gate-fast.mjs
import { spawn } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));

// Each gate is spawned as a child rather than imported, because two of them
// (check-imports, smoke-imports) call process.exit on failure and because
// the unit suite needs `node --test`'s own file discovery.
const gates = [
  // `node --test "tests/**/*.mjs"`: the pattern is QUOTED and handled by
  // Node's own glob, not by the shell. Unquoted it is expanded by whatever
  // shell npm happened to use - cmd.exe does not expand it at all, and
  // PowerShell passes it through literally - so the same script behaves
  // differently depending on how it was invoked. A bare directory is not an
  // option either: Node 24 treats it as a module path and fails.
  { name: "unit", cmd: process.execPath, args: ["--test", "tests/**/*.mjs"] },
  { name: "imports", cmd: process.execPath, args: ["scripts/check-imports.mjs"] },
  { name: "smoke-imports", cmd: process.execPath, args: ["scripts/smoke-imports.mjs"] },
  { name: "smoke-dom", cmd: process.execPath, args: ["scripts/smoke-dom.mjs"] },
  { name: "content", cmd: process.execPath, args: ["scripts/verify-content.mjs"] },
];
const run = (gate) => new Promise((resolveRun) => {
  const started = Date.now();
  const child = spawn(gate.cmd, gate.args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], shell: false });
  // Prefix every line with the gate's name so a failure's output says which
  // of five interleaved streams it came from. Without this, five gates
  // printing at once is unreadable exactly when it matters.
  const tag = (line) => `[${gate.name}] ${line}`;
  const pipe = (stream, sink) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) sink(tag(l));
    });
    stream.on("end", () => { if (buf) sink(tag(buf)); });
  };
  pipe(child.stdout, (l) => console.log(l));
  pipe(child.stderr, (l) => console.error(l));
  child.on("error", (e) => { console.error(tag(`could not start: ${e.message}`)); resolveRun({ ...gate, code: 1, ms: Date.now() - started }); });
  child.on("close", (code) => resolveRun({ ...gate, code: code ?? 1, ms: Date.now() - started }));
});

const sw = Date.now();
const results = await Promise.all(gates.map(run));
const total = Date.now() - sw;

// Slower gates first in this table, so the eye goes to what mattered - but
// it is a summary, not a gate: the exit code below is what fails the build.
console.log("");
console.log("gate-fast summary");
for (const r of results.sort((a, b) => b.ms - a.ms)) {
  console.log(`  ${r.code === 0 ? "ok  " : "FAIL"}  ${r.name.padEnd(14)} ${(r.ms / 1000).toFixed(2)}s`);
}
console.log(`  ${"".padEnd(4)}  ${"total".padEnd(14)} ${(total / 1000).toFixed(2)}s  (${cpus().length} cores)`);

process.exit(results.some((r) => r.code !== 0) ? 1 : 0);

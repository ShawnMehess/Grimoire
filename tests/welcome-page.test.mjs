import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Guards the welcome page against the ways it can quietly stop being a
// standalone, unindexed, script-free page. Deliberately narrow: it checks
// the properties that are cheap to break by accident, not the prose.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "welcome.html"), "utf8");

test("welcome page has exactly one h1", () => {
  const h1s = html.match(/<h1[\s>]/gi) || [];
  assert.equal(h1s.length, 1, `expected 1 <h1>, found ${h1s.length}`);
});

test("welcome page links to the vault with a relative path", () => {
  assert.match(html, /href="\.\/"/, 'expected an href="./" link to the vault');
});

test("welcome page asks robots not to index it", () => {
  assert.match(
    html,
    /<meta\s+name="robots"\s+content="noindex"/i,
    "the vault is private, so welcome.html must stay noindex"
  );
});

test("welcome page loads no external scripts", () => {
  assert.doesNotMatch(html, /<script\b/i, "welcome.html must not contain a <script> tag");
  assert.doesNotMatch(html, /\bsrc\s*=/i, "welcome.html must not reference any external file");
});

test("welcome page does not pull in the app stylesheet", () => {
  assert.ok(
    !html.includes("css/main.css"),
    "welcome.html must not reference css/main.css"
  );

  // Matched as a real attribute rather than as a substring, so that naming
  // the app's stylesheet in a comment does not read as depending on it.
  const stylesheetLinks = html.match(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi) || [];
  for (const link of stylesheetLinks) {
    assert.doesNotMatch(
      link,
      /href=["'](?!https:\/\/fonts\.)/i,
      `welcome.html must only load its own inline CSS, found: ${link}`
    );
  }
});

test("welcome page describes only features that exist on main", () => {
  // Things another branch is building. Naming them here would describe
  // screens that are not on main yet.
  for (const banned of ["Level Up button", "scenario", "radial"]) {
    assert.ok(
      !new RegExp(banned, "i").test(html),
      `welcome.html must not mention "${banned}" - not on main`
    );
  }
});

test("welcome page is self-contained HTML with its own styling", () => {
  assert.match(html, /<html\s+lang="en"/i, 'expected <html lang="en">');
  assert.match(html, /<style>/i, "expected an inline <style> block");
  assert.match(html, /<meta\s+name="viewport"/i, "expected a viewport meta tag");
  assert.match(html, /<title>/i, "expected a <title>");
});
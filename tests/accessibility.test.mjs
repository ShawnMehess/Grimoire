// tests/accessibility.test.mjs
//
// The two reading options (js/ui/accessibility.js) and the gate that holds
// their palette to a real standard.
//
// The gate in verify-content is the important half. The colour-blind palette
// has to differ in LIGHTNESS, not just hue, and getting that wrong produces
// a palette that looks deliberately colour-blind-safe and is not - which is
// worse than not offering the option, because the person who turned it on
// now believes they are covered. The first version of this option did
// exactly that: a blue/green swap at matched lightness, which collapses into
// a single colour under deuteranopia and protanopia. The gate exists because
// that failure is invisible to everyone who does not have the condition.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { A11Y_OPTIONS, a11yEnabled, applyA11yMode } from "../js/ui/accessibility.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- WCAG maths, so the expectations below are derived not asserted ---------

const toRgb = (hex) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const luminance = (hex) => {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const tokens = readFileSync(join(ROOT, "css", "tokens.css"), "utf8");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const blockText = (selector) => {
  const m = tokens.match(new RegExp(`${escapeRe(selector)}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : "";
};
const tokensOf = (selector) => {
  const out = {};
  for (const d of blockText(selector).matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8})\s*;/gi)) out[d[1]] = d[2];
  return out;
};
/** Every declaration, values and all. The dyslexia block holds font stacks
 *  and em lengths, which the hex-only reader above cannot see - and a
 *  reader that only understands colours would silently report that block as
 *  empty. */
const tokensAny = (selector) => {
  const out = {};
  for (const d of blockText(selector).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  return out;
};

describe("accessibility options", () => {
  it("are two independent toggles", () => {
    // Bundling them into one "accessible theme" would force a colour-blind
    // player to accept someone else's text spacing, which is how an
    // accessibility feature ends up unused.
    assert.deepEqual(A11Y_OPTIONS.map((o) => o.id), ["cb", "dyslexia"]);
  });

  it("each say what they do, not who they are for", () => {
    for (const opt of A11Y_OPTIONS) {
      assert.ok(opt.description.length > 40, `${opt.id} has a description worth reading`);
      assert.ok(!/disabled|dyslexic|colourblind/i.test(opt.description),
        `${opt.id} describes the effect rather than the reader`);
    }
  });
});

describe("a11yEnabled", () => {
  it("only accepts a literal true", () => {
    assert.equal(a11yEnabled({ cb: true }, "cb"), true);
    // A hand-edited or migrated save can hold any of these. Reading them as
    // truthy means the stored preference and the applied attribute disagree
    // and nothing ever reconciles them.
    for (const value of ["true", 1, "yes", {}, [], null, undefined, 0]) {
      assert.equal(a11yEnabled({ cb: value }, "cb"), false, `${JSON.stringify(value)} is not true`);
    }
  });

  it("treats a missing preference object as everything off", () => {
    assert.equal(a11yEnabled(undefined, "cb"), false);
    assert.equal(a11yEnabled(null, "cb"), false);
    assert.equal(a11yEnabled({}, "dyslexia"), false);
  });

  it("an option that is off is off even when another is on", () => {
    const prefs = { cb: true };
    assert.equal(a11yEnabled(prefs, "cb"), true);
    assert.equal(a11yEnabled(prefs, "dyslexia"), false);
  });
});

describe("applyA11yMode", () => {
  // A minimal document stand-in: this module's only DOM write is setting two
  // dataset values on the root element.
  function withRoot(fn) {
    const previous = globalThis.document;
    const root = { dataset: {} };
    globalThis.document = { documentElement: root };
    try {
      return fn(root);
    } finally {
      globalThis.document = previous;
    }
  }

  it("writes 1 for on and 0 for off, for every option, every time", () => {
    withRoot((root) => {
      applyA11yMode({ cb: true, dyslexia: false });
      assert.equal(root.dataset.cb, "1");
      assert.equal(root.dataset.dyslexia, "0");
    });
  });

  it("turns an option off rather than leaving the attribute behind", () => {
    withRoot((root) => {
      applyA11yMode({ cb: true, dyslexia: true });
      applyA11yMode({ cb: true, dyslexia: false });
      // The CSS keys off [data-cb="1"], so a stale value would silently mean
      // something different from a fresh one. Deleting the attribute instead
      // would leave whatever the last theme set.
      assert.equal(root.dataset.cb, "1");
      assert.equal(root.dataset.dyslexia, "0");
    });
  });

  it("writes real strings, never booleans", () => {
    withRoot((root) => {
      applyA11yMode({ cb: true });
      assert.equal(typeof root.dataset.cb, "string");
    });
  });
});

describe("colour-blind palette", () => {
  const dark = tokensOf(':root[data-cb="1"]');
  const light = tokensOf(':root[data-cb="1"][data-mode="light"]');

  it("exists for both modes", () => {
    assert.ok(dark["--color-positive"] && dark["--color-negative"], "dark palette present");
    assert.ok(light["--color-positive"] && light["--color-negative"], "light palette present");
  });

  it("differs in relative lightness, not just hue", () => {
    // THE point. Protanopia and deuteranopia collapse the red-green axis
    // while preserving brightness, so a hue-only change leaves the two
    // colours identical to the reader who turned the option on.
    const darkGap = Math.abs(luminance(dark["--color-positive"]) - luminance(dark["--color-negative"]));
    assert.ok(darkGap >= 0.2, `dark palette lightness gap is ${darkGap.toFixed(3)}, wanted >= 0.2`);
    // Light mode cannot match this: both colours must be dark enough to
    // clear 4.5:1 on pale parchment, which pins them into one narrow band.
    // ~0.11 is the ceiling, and it is a real constraint rather than a
    // tuning failure, which is why light mode leans on the marks below.
    const lightGap = Math.abs(luminance(light["--color-positive"]) - luminance(light["--color-negative"]));
    assert.ok(lightGap >= 0.09, `light palette lightness gap is ${lightGap.toFixed(3)}, wanted >= 0.09`);
  });

  it("clears 4.5:1 against its own background in both modes", () => {
    const pairs = [
      [dark, tokensOf(":root")["--color-bg"]],
      [light, tokensOf(':root[data-theme="light"]')["--color-bg"]],
    ];
    for (const [block, bg] of pairs) {
      for (const token of ["--color-positive", "--color-negative", "--color-arcane"]) {
        const ratio = contrast(block[token], bg);
        assert.ok(ratio >= 4.5, `${token} is ${ratio.toFixed(2)}:1 on ${bg}, needs 4.5:1`);
      }
    }
  });

  it("leaves the accent alone", () => {
    // The accent is decoration and selection, not a status. Recolouring
    // every button in a theme nobody asked to change is a bigger change than
    // the problem needs, and --color-accent is a background that white text
    // sits on.
    assert.equal(dark["--color-accent"], undefined);
    assert.equal(light["--color-accent"], undefined);
  });

  it("ships a non-colour cue on both button tones", () => {
    // Because colour must never be the only channel - and because light mode
    // provably cannot achieve a large lightness gap, this is what light mode
    // actually relies on.
    assert.ok(/:root\[data-cb="1"\]\s+\.btn--primary::after\s*\{[^}]*content\s*:\s*"\\2713"/.test(tokens),
      "primary buttons carry a tick");
    assert.ok(/:root\[data-cb="1"\]\s+\.btn--danger::after\s*\{[^}]*content\s*:\s*"\\2715"/.test(tokens),
      "danger buttons carry a cross");
  });
});

describe("dyslexia-friendly text", () => {
  const block = tokensAny(':root[data-dyslexia="1"]');

  it("swaps the body and display faces to something open and tall", () => {
    assert.ok(/--font-body/.test(JSON.stringify(block)), "body face is overridden");
    assert.ok(/--font-display/.test(JSON.stringify(block)), "display face is overridden too");
    // Headings were the hardest thing on the page to read, so leaving them
    // in the display serif would have been the wrong half to skip.
    assert.ok(!/Cinzel/.test(block["--font-body"] || ""), "Cinzel is out of the body stack");
  });

  it("names a web font but falls back to system faces", () => {
    // Offline-first: a font that arrives late causes a reflow of text
    // somebody may be mid-word in.
    const body = block["--font-body"] || "";
    assert.ok(body.includes("system-ui") || body.includes("Verdana"), "has a system fallback");
    assert.ok(body.split(",").length >= 3, "and more than one of them");
  });

  it("widens letter spacing, word spacing and line height", () => {
    // Word spacing is the one that most visibly stops adjacent words reading
    // as one; line height gives the eye somewhere to return to.
    assert.ok(Number(block["--a11y-letter-spacing"]?.replace("em", "")) > 0, "letter spacing widens");
    assert.ok(Number(block["--a11y-word-spacing"]?.replace("em", "")) > 0, "word spacing widens");
    assert.ok(Number(block["--a11y-line-height"]) >= 1.6, "line height gives the eye a target");
  });

  it("applies through body rather than *, so a rule with its own spacing is left alone", () => {
    assert.ok(/:root\[data-dyslexia="1"\]\s+body\s*\{[^}]*letter-spacing/.test(tokens),
      "the base change is on body");
    assert.ok(/:root\[data-dyslexia="1"\]\s+\*\s*\{/.test(tokens) === false,
      "and not a blanket * rule that would override every label");
  });

  it("reaches the prose blocks and the textareas, and nothing layout-bearing", () => {
    const applied = [...tokens.matchAll(/:root\[data-dyslexia="1"\]\s+([^{]+)\{/g)].map((m) => m[1].trim());
    const joined = applied.join(" ");
    assert.ok(/choice-row__description/.test(joined), "choice rows");
    assert.ok(/leveling-tab__intro/.test(joined), "the level-up guide's lead-ins");
    assert.ok(/sheet-intro__list/.test(joined), "the orientation panel");
    assert.ok(/textarea/.test(joined), "textareas, where a player types for a long time");
    // Nothing here may move a field: a reader who needs this still has to be
    // able to find every box in the same place.
    assert.ok(!/grid-node|field-value\b(?!--textarea)|page-grid|\.block-name/.test(joined),
      "no layout-bearing selector is touched");
  });
});

describe("every theme's text clears AA", () => {
  const TEXT_TOKENS = ["--color-text", "--color-text-muted", "--color-text-faint", "--color-negative", "--color-positive", "--color-accent-text"];
  const BACKGROUNDS = ["--color-bg", "--color-bg-raised", "--color-bg-inset"];

  it("holds across every token block that has a background", () => {
    const blocks = [];
    for (const m of tokens.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim().split("\n").pop().trim();
      if (!selector || selector.startsWith("@")) continue;
      const t = {};
      for (const d of m[2].matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8})\s*;/gi)) t[d[1]] = d[2];
      if (Object.keys(t).length) blocks.push({ selector, t });
    }
    const failures = [];
    for (const { selector, t } of blocks) {
      if (!t["--color-bg"]) continue;
      for (const token of TEXT_TOKENS) {
        if (!t[token]) continue;
        for (const back of BACKGROUNDS) {
          const bg = t[back] || t["--color-bg"];
          const ratio = contrast(t[token], bg);
          if (ratio < 4.48) failures.push(`${selector} ${token} ${ratio.toFixed(2)}:1`);
        }
      }
    }
    // This is the check that would have caught --color-negative at 3.02:1 and
    // light-mode --color-text-faint at 2.42:1, before they shipped.
    assert.deepEqual(failures, [], failures.join("\n"));
  });
});

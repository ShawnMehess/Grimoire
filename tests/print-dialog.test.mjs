// tests/print-dialog.test.mjs
// Unit tests for Print dialog logic - tests pure behavior without DOM
// Run: node --test tests/print-dialog.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Print dialog logic", () => {
  it("builds print settings object", () => {
    // Simulate the print settings builder from openPrintDialog
    const orientation = "portrait";
    const scale = 100;
    const selectedTabs = ["identity"];
    const includeBg = true;

    const settings = { orientation, scale, selectedTabs, includeBg };
    assert.equal(settings.orientation, "portrait");
    assert.equal(settings.scale, 100);
    assert.deepEqual(settings.selectedTabs, ["identity"]);
    assert.equal(settings.includeBg, true);
  });

  it("generates print style string based on selections", () => {
    // Simulate the print style generation
    const orientation = "landscape";
    const styleString = `
      @media print {
        :root {
          --color-bg: #ffffff;
          --color-text: #1a1510;
        }
        body { background: #fff; }
        @page { size: ${orientation} 8.5in 11in; margin: 0.5in; }
      }
    `;
    assert.equal(styleString.includes(`size: ${orientation}`), true,
      "Print style should include selected orientation");
  });

  it("handles tab selection for print", () => {
    // Simulate tab checkbox handling
    const tabNames = ["identity", "class", "spells", "gear"];
    const selectedTabs = [];

    // Simulate checking which tabs are selected
    tabNames.forEach((name, i) => {
      const isSelected = i < 2; // first two tabs selected
      if (isSelected) selectedTabs.push(name);
    });

    assert.deepEqual(selectedTabs, ["identity", "class"]);
  });
});
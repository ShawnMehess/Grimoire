import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Import the pure helpers we extracted
import {
  calculatePrintScale,
  getTabsToPrint,
  buildPrintCss,
} from "../js/render/print-helpers.js";

describe("Print helper functions", () => {
  describe("calculatePrintScale", () => {
    it("returns 100 for 'actual' mode", () => {
      assert.equal(calculatePrintScale("actual", 100), 100);
    });

    it("returns 100 for 'fit' mode (handled by CSS)", () => {
      assert.equal(calculatePrintScale("fit", 100), 100);
    });

    it("clamps custom scale to 50-200 range", () => {
      assert.equal(calculatePrintScale("custom", 30), 50);
      assert.equal(calculatePrintScale("custom", 100), 100);
      assert.equal(calculatePrintScale("custom", 250), 200);
    });

    it("handles invalid input gracefully", () => {
      assert.equal(calculatePrintScale("custom", "invalid"), 100);
      assert.equal(calculatePrintScale("custom", null), 100);
    });
  });

  describe("getTabsToPrint", () => {
    const mockTabs = [
      { id: "tab1", name: "Identity" },
      { id: "tab2", name: "Class" },
      { id: "tab3", name: "Background" },
    ];

    it("returns current tab when 'current' selected", () => {
      const tabs = getTabsToPrint("current", "tab1", mockTabs);
      assert.deepEqual(tabs, ["tab1"]);
    });

    it("returns all tabs when 'all' selected", () => {
      const tabs = getTabsToPrint("all", "tab1", mockTabs);
      assert.deepEqual(tabs, ["tab1", "tab2", "tab3"]);
    });

    it("returns specific tab when selected", () => {
      const tabs = getTabsToPrint("tab2", "tab1", mockTabs);
      assert.deepEqual(tabs, ["tab2"]);
    });

    it("falls back to unknown selection as-is (no fallback)", () => {
      const tabs = getTabsToPrint("unknown", "tab1", mockTabs);
      assert.deepEqual(tabs, ["unknown"]);
    });
  });

  describe("buildPrintCss", () => {
    it("includes orientation in @page rule", () => {
      const css = buildPrintCss({ orientation: "landscape", scale: 100, includeBg: true, includeHidden: false });
      assert.ok(css.includes("size: landscape"));
      assert.ok(css.includes("margin: 0.5in"));
    });

    it("includes zoom for non-fit scale modes", () => {
      const css = buildPrintCss({ orientation: "portrait", scale: 150, includeBg: true, includeHidden: false });
      assert.ok(css.includes("zoom: 1.5"));
    });

    it("omits zoom for fit mode", () => {
      const css = buildPrintCss({ orientation: "portrait", scaleMode: "fit", scale: 100, includeBg: true, includeHidden: false });
      assert.ok(!css.includes("zoom:"));
    });

    it("includes background-image preservation when enabled", () => {
      const css = buildPrintCss({ orientation: "portrait", scale: 100, includeBg: true, includeHidden: false });
      assert.ok(css.includes("print-color-adjust: exact"));
    });

    it("removes background images when disabled", () => {
      const css = buildPrintCss({ orientation: "portrait", scale: 100, includeBg: false, includeHidden: false });
      assert.ok(css.includes("background-image: none !important"));
    });

    it("hides hidden/calculation fields when disabled", () => {
      const css = buildPrintCss({ orientation: "portrait", scale: 100, includeBg: true, includeHidden: false });
      assert.ok(css.includes(".field-value--computed { display: none !important; }"));
    });

    it("shows hidden/calculation fields when enabled", () => {
      const css = buildPrintCss({ orientation: "portrait", scale: 100, includeBg: true, includeHidden: true });
      assert.ok(!css.includes(".field-value--computed { display: none !important; }"));
    });

    it("hides all editor UI elements", () => {
      const css = buildPrintCss({ orientation: "portrait", scale: 100, includeBg: true, includeHidden: false });
      // The CSS groups multiple selectors in a comma-separated list
      assert.ok(css.includes(".sheet-toolbar"));
      assert.ok(css.includes("display: none !important"));
      assert.ok(css.includes(".node-toolbar"));
      assert.ok(css.includes(".drag-handle"));
      assert.ok(css.includes(".resize-handle"));
    });

    it("shows collapsed details in print", () => {
      const css = buildPrintCss({ orientation: "portrait", scale: 100, includeBg: true, includeHidden: false });
      assert.ok(css.includes(".choice-row__details[hidden] { display: block; }"));
    });

    it("sets page size and margins", () => {
      const css = buildPrintCss({ orientation: "landscape", scale: 100, includeBg: true, includeHidden: false });
      assert.ok(css.includes("@page { size: landscape; margin: 0.5in; }"));
    });
  });
});
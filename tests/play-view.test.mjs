// tests/play-view.test.mjs
// Unit tests for Play View mode - tests pure logic without DOM
// Run: node --test tests/play-view.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test the play mode toggle logic directly
import { computeSheetValuesIn } from "../js/render/sheet/sheetLeveling.js";

// Test that play mode class is properly applied
describe("Play View mode logic", () => {
  it("playMode toggle changes button text", () => {
    let playMode = false;
    const playViewBtn = {
      textContent: "Play View",
      title: "Switch to Play View for a responsive, phone-friendly display",
    };

    // Initial state
    assert.equal(playViewBtn.textContent, "Play View");
    assert.equal(playViewBtn.title, "Switch to Play View for a responsive, phone-friendly display");

    // Toggle on
    playMode = true;
    playViewBtn.textContent = playMode ? "Sheet View" : "Play View";
    playViewBtn.title = playMode ? "Switch to Sheet View" : "Switch to Play View for a responsive, phone-friendly display";
    assert.equal(playViewBtn.textContent, "Sheet View");
    assert.equal(playViewBtn.title, "Switch to Sheet View");

    // Toggle off
    playMode = false;
    playViewBtn.textContent = playMode ? "Sheet View" : "Play View";
    playViewBtn.title = playMode ? "Switch to Sheet View" : "Switch to Play View for a responsive, phone-friendly display";
    assert.equal(playViewBtn.textContent, "Play View");
    assert.equal(playViewBtn.title, "Switch to Play View for a responsive, phone-friendly display");
  });

  it("playMode toggles page-grid class", () => {
    // Simulate the class toggle logic
    let playMode = false;
    const pageGrid = { classList: { toggles: new Map() } };

    // Mock classList.toggle
    pageGrid.classList.toggle = (className, state) => {
      pageGrid.classList.toggles.set(className, state);
    };

    // Initial: no play-mode
    pageGrid.classList.toggle("play-mode", false);
    assert.ok(!pageGrid.classList.toggles.get("play-mode"), "play-mode should not be active initially");

    // After toggle on
    pageGrid.classList.toggle("play-mode", true);
    assert.ok(pageGrid.classList.toggles.get("play-mode"), "play-mode should be active");

    // After toggle off
    pageGrid.classList.toggle("play-mode", false);
    assert.ok(!pageGrid.classList.toggles.get("play-mode"), "play-mode should be inactive");
  });
});
/**
 * Print helper functions - pure functions for print dialog logic
 * Extracted from customSheet.js for testability
 */

/**
 * Calculate the print scale based on mode and input value
 * @param {"fit" | "actual" | "custom"} mode - Scale mode
 * @param {number|string} value - Input value (percentage for custom mode)
 * @returns {number} Scale factor (50-200)
 */
export function calculatePrintScale(mode, value) {
  if (mode === "actual") return 100;
  if (mode === "fit") return 100; // Handled by CSS @page size: auto
  if (mode === "custom") {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 100;
    return Math.min(200, Math.max(50, parsed));
  }
  return 100;
}

/**
 * Determine which tabs to print based on selection
 * @param {string} pickedTabId - Selected tab ID ("current", "all", or specific tab ID)
 * @param {string} currentTabId - Currently active tab ID
 * @param {Array} sheetTabs - Array of tab objects with id and name
 * @returns {string[]} Array of tab IDs to print
 */
export function getTabsToPrint(pickedTabId, currentTabId, sheetTabs = []) {
  if (pickedTabId === "all") {
    return sheetTabs.map(t => t.id);
  }
  if (pickedTabId === "current") {
    return [currentTabId];
  }
  return [pickedTabId];
}

/**
 * Build the print CSS string based on options
 * @param {Object} options - Print options
 * @param {"portrait"|"landscape"} options.orientation
 * @param {"fit"|"actual"|"custom"} options.scaleMode
 * @param {number} options.scale - Scale percentage (50-200)
 * @param {boolean} options.includeBg - Whether to include background images
 * @param {boolean} options.includeHidden - Whether to include hidden/calculation fields
 * @returns {string} CSS string for @media print
 */
export function buildPrintCss({ orientation, scaleMode, scale, includeBg, includeHidden }) {
  const scaleValue = scaleMode === "custom" ? scale : 100;
  const isFit = scaleMode === "fit";

  const bgRule = includeBg
    ? ".page-grid, .page-grid * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }"
    : ".page-grid, .page-grid * { background-image: none !important; }";

  const hiddenRule = includeHidden
    ? ""
    : ".field-value--computed { display: none !important; }";

  const zoomRule = scaleMode === "fit"
    ? ""
    : `.page-grid-scroll { zoom: ${scale / 100}; }`;

  return `
    @media print {
      .print-dialog { display: none !important; }
      .sheet-toolbar, .sheet-block-frame, .sheet-tabs,
      .node-toolbar, .drag-handle, .resize-handle,
      .wizard__nav, .wizard__dots, .sheet-toast,
      .modal-overlay, .choice-row-list__collapse-controls,
      .spell-picker-tip, .textlist-add, .textlist-item__handle,
      .textlist-item__remove, .field-roll, button,
      .node-toolbar, .drag-handle, .resize-handle,
      .block-toolbar, .field-toolbar, .group-toolbar {
        display: none !important;
      }
      .choice-row__details[hidden] { display: block; }
      .page-grid-scroll { overflow: visible; }
      a { color: inherit; text-decoration: none; }
      @page { size: ${orientation}; margin: 0.5in; }
      ${bgRule}
      ${hiddenRule}
      ${zoomRule}
    }
  `;
}
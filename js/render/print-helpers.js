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
 * Determine which tabs to print.
 *
 * Accepts either the old single-id form or a list of checked ids, since
 * the tab control is a checklist now (pick any number of tabs) rather
 * than a radio (pick exactly one). Ids are filtered against the real tab
 * list so a stale id can never smuggle a phantom page into the output,
 * and duplicates are dropped while preserving the tab bar's own order —
 * tabs print in the order they appear, not the order they were clicked.
 *
 * @param {string|string[]} pickedTabIds - "current", "all", one id, or a list of ids
 * @param {string} currentTabId - Currently active tab ID
 * @param {Array} sheetTabs - Array of tab objects with id and name
 * @returns {string[]} Array of tab IDs to print
 */
export function getTabsToPrint(pickedTabIds, currentTabId, sheetTabs = []) {
  const order = new Map(sheetTabs.map((t, i) => [t.id, i]));
  const resolve = (id) => {
    if (id === "all") return sheetTabs.map((t) => t.id);
    if (id === "current") return [currentTabId];
    return [id];
  };
  const wanted = (Array.isArray(pickedTabIds) ? pickedTabIds : [pickedTabIds])
    .flatMap(resolve)
    .filter((id) => order.has(id));
  return [...new Set(wanted)].sort((a, b) => order.get(a) - order.get(b));
}

/**
 * Build the print CSS string based on options.
 *
 * Tabs are handled two ways, and the difference matters:
 *  - SELECTED tabs are rendered into their own `.print-stage__page`
 *    container and separated by `page-break-after: always`, so each one
 *    starts on a fresh sheet of paper.
 *  - UNSELECTED tabs are never built into the print stage at all. They
 *    are excluded from the document, not hidden with display:none — a
 *    display:none'd node is still in the accessibility tree and still
 *    occupies a box in some print pipelines, which is how a "hidden" tab
 *    ends up as a blank page. Only the live editor's own grid is
 *    suppressed, and that's via a class the print stage adds to it.
 *
 * `page-break-after` is set on every page but the last; a trailing break
 * would emit one blank sheet after the final tab.
 *
 * @param {Object} options - Print options
 * @param {"portrait"|"landscape"} options.orientation
 * @param {"fit"|"actual"|"custom"} options.scaleMode
 * @param {number} options.scale - Scale percentage (50-200)
 * @param {boolean} options.includeBg - Whether to include background images
 * @param {boolean} options.includeHidden - Whether to include hidden/calculation fields
 * @param {number} options.pageCount - How many tab pages are being printed
 * @returns {string} CSS string for @media print
 */
export function buildPrintCss({ orientation, scaleMode, scale, includeBg, includeHidden, pageCount = 1 }) {
  const scaleValue = scaleMode === "custom" ? scale : 100;
  const isFit = scaleMode === "fit";

  const bgRule = includeBg
    ? ".page-grid, .page-grid *, .print-stage, .print-stage * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }"
    : ".page-grid, .page-grid *, .print-stage, .print-stage * { background-image: none !important; }";

  const hiddenRule = includeHidden
    ? ""
    : ".field-value--computed { display: none !important; }";

  const zoomRule = scaleMode === "fit"
    ? ""
    : `.page-grid-scroll, .print-stage { zoom: ${scale / 100}; }`;

  // Each printed tab starts on its own sheet. The last page is left
  // without a trailing break so the output doesn't end on a blank one.
  const pageBreakRule = pageCount > 1
    ? `.print-stage__page { break-after: page; page-break-after: always; }
       .print-stage__page:last-child { break-after: auto; page-break-after: auto; }`
    : "";

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
      /* The live editor is not part of the output at all — the print
         stage is a separate, purpose-built tree (see buildPrintStage). */
      .page-grid, .page-grid-scroll { display: none !important; }
      .print-stage { display: block !important; }
      .print-stage__page { display: block !important; }
      .choice-row__details[hidden] { display: block; }
      .page-grid-scroll { overflow: visible; }
      a { color: inherit; text-decoration: none; }
      @page { size: ${orientation}; margin: 0.5in; }
      ${bgRule}
      ${hiddenRule}
      ${zoomRule}
      ${pageBreakRule}
    }
  `;
}

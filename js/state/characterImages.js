// characterImages.js
//
// Pure (Firebase-free) helpers for character images stored as
// compressed Base64 Data URLs directly in Firestore documents.
// No Firebase Storage dependency — images live on the character
// document as `imageData` (picture fields) or `bgImage` (block
// background images). No `imageRef`/`bgImageRef` sidecars needed.

/** Whether a stored image value is an inline data URL. */
export function isDataUrlImage(value) {
  return typeof value === "string" && value.startsWith("data:image/");
}

/** Visits every stored image on a character document (picture fields
 *  plus block/field background images, across all tabs) with
 *  `{ kind, get, set }` — `get()` returns `{ data }`,
 *  `set(url)` writes the URL. Reference nodes (`sourceBlockId`)
 *  share their source block's style, so only each node's own
 *  values are visited, deduplicated by identity. */
export function forEachStoredImage(doc, fn) {
  const layouts = [];
  if (Array.isArray(doc?.layout)) layouts.push(doc.layout);
  for (const tab of doc?.sheetTabs || []) {
    if (Array.isArray(tab?.layout)) layouts.push(tab.layout);
  }
  const seen = new Set();
  const bgSlot = (holder, key) => {
    const isLegacyRef = key === "bgImageRef";
    fn({
      kind: "background",
      get: () => isLegacyRef
        ? { data: null, ref: holder?.[key] ?? null }
        : { data: holder?.[key] ?? null },
      set: (url) => {
        if (url == null) delete holder[key];
        else holder[key] = url;
      },
    });
  };
  const visit = (nodes) => {
    for (const node of nodes || []) {
      if (!node || seen.has(node)) continue;
      seen.add(node);
      if (node.kind === "field" && node.fieldType === "picture") {
        fn({
          kind: "picture",
          get: () => ({ data: node.imageData ?? null }),
          set: (url) => { node.imageData = url; },
        });
      }
      if (node.style?.bgImage != null) bgSlot(node.style, "bgImage");
      if (node.styleOverrides?.bgImage != null) bgSlot(node.styleOverrides, "bgImage");
      // Legacy: also visit orphaned bgImageRef for migration
      if (node.style?.bgImageRef != null) bgSlot(node.style, "bgImageRef");
      if (node.styleOverrides?.bgImageRef != null) bgSlot(node.styleOverrides, "bgImageRef");
      if (node.children) visit(node.children);
    }
  };
  layouts.forEach(visit);
}
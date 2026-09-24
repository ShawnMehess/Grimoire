// characterImages.js
//
// Pure (Firebase-free) helpers for moving character images out of
// Firestore documents and into Firebase Storage. The document keeps a
// sidecar per image — `imageData`/`bgImage` holds the renderable URL
// (a data URL for legacy/offline images, an https download URL once
// uploaded) plus `imageRef`/`bgImageRef` with the Storage path for
// deletes and re-resolution. Renderers only ever read the URL, so
// they work unchanged; characterStore.js (uploads, deletes,
// migration) and localStore.js (offline pass-through) implement the
// backend side under identical export names.

/** Whether a stored image value is an inline data URL (legacy or
 *  offline) as opposed to a hosted https URL. */
export function isDataUrlImage(value) {
  return typeof value === "string" && value.startsWith("data:image/");
}

/** Storage directory for one character's images (path-safe). */
export function storagePrefixFor(characterId) {
  const safe = String(characterId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "unknown";
  return `characterImages/${safe}`;
}

/** Storage path for one upload, keeping the image's own extension so
 *  downloads serve the right content type. */
export function storagePathFor(characterId, dataUrl, newIdFn) {
  const mime = (/^data:(image\/[a-z0-9.+-]+)/i.exec(dataUrl || "") || [])[1] || "image/jpeg";
  const ext = (mime.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
  return `${storagePrefixFor(characterId)}/${newIdFn()}.${ext}`;
}

/** Visits every stored image on a character document (picture fields
 *  plus block/field background images, across all tabs) with
 *  `{ kind, get, set }` — `get()` returns `{ data, ref }`,
 *  `set(url, ref)` writes the URL and (when given) the Storage path.
 *  Reference nodes (`sourceBlockId`) share their source block's style,
 *  so only each node's own values are visited, deduplicated by
 *  identity. Pure — the caller (characterStore migration, tests)
 *  decides what to do per slot. */
export function forEachStoredImage(doc, fn) {
  const layouts = [];
  if (Array.isArray(doc?.layout)) layouts.push(doc.layout);
  for (const tab of doc?.sheetTabs || []) {
    if (Array.isArray(tab?.layout)) layouts.push(tab.layout);
  }
  const seen = new Set();
  const bgSlot = (holder, key) => {
    fn({
      kind: "background",
      get: () => ({ data: holder?.[key] ?? null, ref: holder?.[`${key}Ref`] ?? null }),
      set: (url, ref) => {
        holder[key] = url;
        if (ref) holder[`${key}Ref`] = ref;
        else delete holder[`${key}Ref`];
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
          get: () => ({ data: node.imageData ?? null, ref: node.imageRef ?? null }),
          set: (url, ref) => {
            node.imageData = url;
            if (ref) node.imageRef = ref;
            else delete node.imageRef;
          },
        });
      }
      if (node.style?.bgImage != null) bgSlot(node.style, "bgImage");
      if (node.styleOverrides?.bgImage != null) bgSlot(node.styleOverrides, "bgImage");
      if (node.children) visit(node.children);
    }
  };
  layouts.forEach(visit);
}

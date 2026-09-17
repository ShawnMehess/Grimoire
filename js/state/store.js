// store.js — backend selector for Character Vault.
//
// Firebase (characterStore.js) is primary: it is already configured
// and is the only backend shared between friends. localStore.js
// (localStorage, single-browser) is the automatic fallback when
// Firebase can't be reached, plus a manual escape hatch:
//
//   ?offline=1          force the local backend (no network needed)
//   navigator.onLine    browser reports no connection -> local backend
//   import failure      Firebase CDN unreachable -> local backend
//
// Both modules expose the same named exports, so callers (main.js)
// treat whichever comes back identically. `store.isLocal` tells the
// UI whether to show the offline banner.

export async function loadStore() {
  const params = new URLSearchParams(window.location.search || "");
  if (params.get("offline") === "1") {
    return await import("./localStore.js");
  }
  if (typeof navigator !== "undefined" && "onLine" in navigator && navigator.onLine === false) {
    return await import("./localStore.js");
  }
  try {
    return await import("./characterStore.js");
  } catch (err) {
    console.warn("Firebase backend unavailable, falling back to local storage:", err);
    return await import("./localStore.js");
  }
}

// characterStore.js
//
// This is the ONLY file in the app that should import from
// firebase/firestore or firebase/auth. Everywhere else calls these
// functions and works with plain JS objects — that keeps Firebase
// swappable and keeps the rendering code testable without a live
// backend.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { bundleDedupeKey as sharedBundleDedupeKey } from "./bundleMaps.js";
import { isDataUrlImage, storagePathFor, storagePrefixFor, forEachStoredImage } from "./characterImages.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import {
  getStorage,
  ref as storageRef,
  uploadString,
  getDownloadURL,
  deleteObject,
  listAll,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-storage.js";

// Same project as the earlier Grimoire/DiceAndData attempt.
const firebaseConfig = {
  apiKey: "AIzaSyBYYgS04lxcbeawj7WDahEN7SbzYgVGLjE",
  authDomain: "diceanddata-81ebe.firebaseapp.com",
  projectId: "diceanddata-81ebe",
  storageBucket: "diceanddata-81ebe.firebasestorage.app",
  messagingSenderId: "547850961878",
  appId: "1:547850961878:web:8b2a99076d66c0ab451a77",
  measurementId: "G-LSZ59FPDTL",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// Firefox's Private Browsing mode blocks/cripples IndexedDB, which is
// what Firebase Auth's default persistence uses. The auth SDK's own
// internal IndexedDB probe can hang indefinitely in that situation
// (rather than failing fast) — which is exactly why the app used to
// sit on "Loading..." forever in a Private Browsing window: the
// onAuthChange callback below never fired because auth init itself
// never resolved. A regular Firefox tab isn't blocked, so it worked,
// just with the normal one-time delay of Firebase spinning up.
//
// Fix: probe IndexedDB ourselves first, with a short hard timeout of
// our own. If it doesn't answer quickly, assume it's blocked and tell
// Firebase to skip straight to in-memory-only persistence (sign-in
// still works for the session, it just won't be remembered next
// visit) instead of letting Firebase's own detection hang. A normal
// window still gets full persistence as before.
function probeIndexedDb() {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const req = indexedDB.open("__grimoire_persistence_probe__");
      req.onsuccess = () => {
        try {
          req.result.close();
          indexedDB.deleteDatabase("__grimoire_persistence_probe__");
        } catch { /* best-effort cleanup */ }
        finish(true);
      };
      req.onerror = () => finish(false);
      req.onblocked = () => finish(false);
    } catch {
      finish(false);
    }
    // The actual hang case: indexedDB.open() never calls back at all.
    // This timeout is what keeps the app from waiting on it forever.
    setTimeout(() => finish(false), 800);
  });
}

const indexedDbUsable = await probeIndexedDb();
const auth = initializeAuth(app, {
  persistence: indexedDbUsable
    ? [indexedDBLocalPersistence, browserSessionPersistence, inMemoryPersistence]
    : [inMemoryPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});

const CHARACTERS_COLLECTION = "characters";
const PUBLIC_TEMPLATES_COLLECTION = "publicSheetTemplates";
const USER_TEMPLATES_COLLECTION = "userSheetTemplates";
const PUBLIC_BUNDLES_COLLECTION = "publicBundleLibraries";
const USER_BUNDLES_COLLECTION = "userBundleLibraries";
const PUBLIC_CATALOGS_COLLECTION = "publicCatalogs";
const USER_CATALOGS_COLLECTION = "userCatalogs";
const ADMINS_COLLECTION = "admins";

// --- Auth -----------------------------------------------------------------

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signIn() {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
}

export async function signOutUser() {
  await signOut(auth);
}

export function currentUserId() {
  return auth.currentUser?.uid ?? null;
}

export async function isCurrentUserAdmin() {
  const uid = currentUserId();
  if (!uid) return false;
  const snap = await getDoc(doc(db, ADMINS_COLLECTION, uid));
  return snap.exists();
}

// --- Character CRUD ---------------------------------------------------------

// Default-content bundle strip/hydrate lives in ./bundleMaps.js (shared
// with localStore.js so both backends stay byte-identical) — see that
// file for the why. Imported here for the CRUD functions below.
import { stripBundlesFromPatch, hydrateCharacter } from "./bundleMaps.js";

// --- Character images (Firebase Storage) --------------------------------------
//
// Picture fields and background images used to live on the character
// document as data URLs, pushing documents toward Firestore's 1MB cap.
// New and replaced images upload here instead: the document keeps the
// renderable download URL plus the Storage path sidecar (`imageRef` /
// `bgImageRef`) for deletes and re-resolution — see
// ./characterImages.js for the shared shapes. Renderers only read the
// URL, so they work unchanged; offline keeps data URLs (localStore.js
// pass-through) and migrates on the next online load.

const downloadUrlCache = new Map();

function newImageId() {
  return crypto.randomUUID ? crypto.randomUUID() : `img-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Uploads one data-URL image for a character. Returns
 *  `{ path, url }`; non-data URLs pass through untouched (nothing to
 *  upload). Upload failures reject for the caller to fall back to the
 *  data URL. */
export async function uploadCharacterImage(characterId, dataUrl) {
  if (!isDataUrlImage(dataUrl)) return { path: null, url: dataUrl };
  const path = storagePathFor(characterId, dataUrl, newImageId);
  const ref = storageRef(storage, path);
  await uploadString(ref, dataUrl, "data_url");
  const url = await getDownloadURL(ref);
  downloadUrlCache.set(path, url);
  return { path, url };
}

/** Download URL for a stored path (memory-cached per session). */
export async function characterImageUrl(path) {
  if (!path) return null;
  if (downloadUrlCache.has(path)) return downloadUrlCache.get(path);
  const url = await getDownloadURL(storageRef(storage, path));
  downloadUrlCache.set(path, url);
  return url;
}

/** Deletes one stored image (best-effort: false, never throws). */
export async function deleteCharacterImage(path) {
  if (!path) return false;
  downloadUrlCache.delete(path);
  try {
    await deleteObject(storageRef(storage, path));
    return true;
  } catch {
    return false;
  }
}

/** Deletes every stored image under a character's prefix (best-effort:
 *  false, never throws) — called from deleteCharacter below. */
export async function deleteCharacterImagesFor(characterId) {
  try {
    const res = await listAll(storageRef(storage, storagePrefixFor(characterId)));
    await Promise.all(res.items.map((item) => deleteObject(item).catch(() => {})));
    return true;
  } catch {
    return false;
  }
}

/** Uploads every data-URL image still on the document and swaps the
 *  slots to `{ url, path }`. Returns true when any slot changed (the
 *  caller saves the migrated document back). Failed uploads keep
 *  their data URLs and retry on a later load. */
async function migrateDataUrlImages(characterId, data) {
  const jobs = [];
  forEachStoredImage(data, (slot) => {
    const { data: value } = slot.get();
    if (isDataUrlImage(value)) jobs.push({ slot, value });
  });
  if (!jobs.length) return false;
  let changed = false;
  for (const { slot, value } of jobs) {
    try {
      const { path, url } = await uploadCharacterImage(characterId, value);
      slot.set(url, path);
      changed = true;
    } catch (err) {
      console.warn("Image migration skipped:", err);
    }
  }
  return changed;
}

/** Fills stored paths missing a usable URL (best-effort, memory-only
 *  — never persisted): covers documents whose URL was lost without
 *  its path. Anything unresolvable (offline, deleted) is left alone
 *  so loads never fail for images. */
async function resolveMissingImageData(data) {
  const jobs = [];
  forEachStoredImage(data, (slot) => {
    const { data: value, ref } = slot.get();
    if (ref && typeof value !== "string") jobs.push({ slot, ref });
  });
  for (const { slot, ref } of jobs) {
    try {
      slot.set(await characterImageUrl(ref), ref);
    } catch {
      /* leave the slot as-is */
    }
  }
}

export async function loadCharacter(characterId) {
  const snap = await getDoc(doc(db, CHARACTERS_COLLECTION, characterId));
  if (!snap.exists()) return null;
  const data = { id: snap.id, ...snap.data() };
  let migrated = false;
  try {
    migrated = await migrateDataUrlImages(characterId, data);
  } catch (err) {
    console.warn("Image migration skipped:", err);
  }
  try {
    await resolveMissingImageData(data);
  } catch {
    /* images never block a load */
  }
  const hydrated = hydrateCharacter(data);
  // Save back only for the owner (any signed-in friend can read the
  // sheet, but only the owner may write it — a viewer-triggered write
  // would be denied and re-upload on every view), and only the keys
  // actually present (Firestore rejects undefined values, which would
  // fail the save-back and retry the uploads forever).
  if (migrated && data.ownerId && data.ownerId === currentUserId()) {
    try {
      const stripped = stripBundlesFromPatch({ layout: data.layout, sheetTabs: data.sheetTabs });
      const back = { updatedAt: serverTimestamp() };
      if (stripped.layout !== undefined) back.layout = stripped.layout;
      if (stripped.sheetTabs !== undefined) back.sheetTabs = stripped.sheetTabs;
      await setDoc(doc(db, CHARACTERS_COLLECTION, characterId), back, { merge: true });
    } catch (err) {
      console.warn("Migrated images could not be saved back:", err);
    }
  }
  return hydrated;
}

export async function listMyCharacters() {
  const uid = currentUserId();
  if (!uid) return [];
  const q = query(collection(db, CHARACTERS_COLLECTION), where("ownerId", "==", uid));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createCharacter(characterData) {
  const ref = doc(collection(db, CHARACTERS_COLLECTION));
  await setDoc(ref, {
    ...stripBundlesFromPatch(characterData),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function saveCharacterField(characterId, fieldId, value) {
  await updateDoc(doc(db, CHARACTERS_COLLECTION, characterId), {
    ...stripBundlesFromPatch({ [fieldId]: value }),
    updatedAt: serverTimestamp(),
  });
  if (fieldId === "name" || fieldId === "layout") {
    syncCharacterTemplate(characterId).catch((err) => {
      console.warn("Template sync skipped:", err);
    });
  }
}

export async function saveCharacterFields(characterId, patch) {
  await updateDoc(doc(db, CHARACTERS_COLLECTION, characterId), {
    ...stripBundlesFromPatch(patch),
    updatedAt: serverTimestamp(),
  });
  if ("name" in patch || "layout" in patch) {
    syncCharacterTemplate(characterId).catch((err) => {
      console.warn("Template sync skipped:", err);
    });
  }
}

export async function deleteCharacter(characterId) {
  // Storage first: the rules authorize deletes via the character
  // document's ownerId, so wiping after deleteDoc would deny every
  // delete and orphan the whole image prefix.
  await deleteCharacterImagesFor(characterId).catch(() => {});
  await deleteDoc(doc(db, CHARACTERS_COLLECTION, characterId));
}

// --- Sheet templates -------------------------------------------------------

function parseTemplateName(name) {
  const trimmed = (name || "").trim();
  const globalMatch = trimmed.match(/^(.+?)\s+GLOBAL\s+TEMPLATE$/i);
  if (globalMatch) return { kind: "global", templateName: globalMatch[1].trim() };

  const personalMatch = trimmed.match(/^(.+?)\s+TEMPLATE$/i);
  if (personalMatch) return { kind: "personal", templateName: personalMatch[1].trim() };

  return null;
}

function templatePayload(character, parsed) {
  // stripBundlesFromPatch already knows layout vs. sheetTabs are
  // shaped differently (a flat block array vs. an array of tabs each
  // with their own .layout) — reuse it here instead of the generic
  // cloneLayout, which only handled the flat-block shape correctly.
  const stripped = stripBundlesFromPatch({ layout: character.layout, sheetTabs: character.sheetTabs || [] });
  return {
    characterId: character.id,
    ownerId: character.ownerId,
    name: parsed.templateName,
    sourceName: character.name || "",
    layout: stripped.layout || [],
    sheetTabs: stripped.sheetTabs || [],
    updatedAt: serverTimestamp(),
  };
}

async function syncCharacterTemplate(characterId) {
  const character = await loadCharacter(characterId);
  if (!character) return;

  const parsed = parseTemplateName(character.name);
  const uid = currentUserId();
  if (!parsed || !uid || character.ownerId !== uid) return;

  if (parsed.kind === "global") {
    if (!(await isCurrentUserAdmin())) return;
    await setDoc(doc(db, PUBLIC_TEMPLATES_COLLECTION, character.id), templatePayload(character, parsed));
    return;
  }

  await setDoc(
    doc(db, USER_TEMPLATES_COLLECTION, uid, "templates", character.id),
    templatePayload(character, parsed)
  );
}

// --- Bundle libraries -------------------------------------------------------
//
// A reusable "Elf" or "Fighter" bundle, defined ONCE here rather than
// hand-built fresh on every character. Deliberately NOT stored in
// terms of field ids the way an in-character bundle is (see
// ensureBundle/renderModifiersPanel in customSheet.js) — a library
// bundle has to work across many different characters' sheets, each
// with their own field ids, so it references targets by NAME instead
// ("Strength", not whatever opaque id Strength happens to have on one
// particular character). Applying a library bundle to a specific
// character's dropdown choice (see applyBundleLibraryToChoice in
// customSheet.js) resolves those names against THAT character's
// fields and copies the result in — a one-time "materialize" step,
// the same way a sheet TEMPLATE gets applied rather than live-linked.
// Editing the library after the fact won't retroactively update
// characters it's already been applied to.

function bundleLibraryPayload(entry, ownerId) {
  return {
    ownerId,
    name: entry.name || "Unnamed Bundle",
    category: entry.category || "",
    rulesetId: entry.rulesetId || null,
    statModifiers: entry.statModifiers || [],
    dropdownAccess: entry.dropdownAccess || [],
    featureGrants: entry.featureGrants || [],
    resourceGrants: entry.resourceGrants || [],
    choiceGroups: entry.choiceGroups || [],
    updatedAt: serverTimestamp(),
  };
}

export async function listBundleLibraries() {
  const uid = currentUserId();
  if (!uid) return [];

  const [globalSnap, personalSnap] = await Promise.all([
    getDocs(collection(db, PUBLIC_BUNDLES_COLLECTION)),
    getDocs(collection(db, USER_BUNDLES_COLLECTION, uid, "bundles")),
  ]);

  const globals = globalSnap.docs.map(d => ({ id: d.id, scope: "global", ...d.data() }));
  const personal = personalSnap.docs.map(d => ({ id: d.id, scope: "personal", ...d.data() }));

  return [...globals, ...personal].sort((a, b) => {
    if (a.category !== b.category) return (a.category || "").localeCompare(b.category || "");
    return (a.name || "").localeCompare(b.name || "");
  });
}

/** Creates a new bundle (entry.id omitted) or overwrites an existing
 *  one (entry.id set) in the requested scope. Global bundles need
 *  admin rights — same gate the global sheet-template sync uses —
 *  and both the check and the actual write are enforced again by
 *  firestore.rules, so this isn't the only thing standing between a
 *  non-admin and the public collection. */
export async function saveBundleLibrary(scope, entry) {
  const uid = currentUserId();
  if (!uid) throw new Error("Not signed in");
  if (scope === "global" && !(await isCurrentUserAdmin())) {
    throw new Error("Only admins can save global bundle libraries");
  }

  const collectionRef = scope === "global"
    ? collection(db, PUBLIC_BUNDLES_COLLECTION)
    : collection(db, USER_BUNDLES_COLLECTION, uid, "bundles");
  const id = entry.id || doc(collectionRef).id;
  const ref = scope === "global"
    ? doc(db, PUBLIC_BUNDLES_COLLECTION, id)
    : doc(db, USER_BUNDLES_COLLECTION, uid, "bundles", id);

  await setDoc(ref, bundleLibraryPayload(entry, uid));
  return id;
}

export async function deleteBundleLibrary(scope, id) {
  const uid = currentUserId();
  if (!uid) return;
  const ref = scope === "global"
    ? doc(db, PUBLIC_BUNDLES_COLLECTION, id)
    : doc(db, USER_BUNDLES_COLLECTION, uid, "bundles", id);
  await deleteDoc(ref);
}

/** Two bundles are "the same" for dedupe purposes — shared definition
 *  in ./bundleMaps.js (also used by localStore.js); re-exported here
 *  so the upload-time duplicate check in bundleLibraryEditor.js keeps
 *  working unchanged. */
export function bundleDedupeKey(entry) {
  return sharedBundleDedupeKey(entry);
}

/** One-off cleanup pass: lists every bundle library (personal + global,
 *  same as listBundleLibraries), keeps the first entry seen per
 *  bundleDedupeKey, and deletes the rest. Meant to be run once when a
 *  character sheet first loads (see customSheet.js) to clear out
 *  duplicates that already exist, not on every refresh — repeat
 *  uploads are instead prevented up front in bundleLibraryEditor.js.
 *  Global duplicates only actually get removed if the signed-in user
 *  is an admin; deleteDoc calls that firestore.rules rejects for a
 *  non-admin fail silently per-entry (caught by the caller) rather
 *  than aborting the whole pass. */
export async function dedupeBundleLibraries() {
  const all = await listBundleLibraries();
  const seen = new Map();
  const duplicates = [];
  for (const entry of all) {
    const key = bundleDedupeKey(entry);
    if (seen.has(key)) {
      duplicates.push(entry);
    } else {
      seen.set(key, entry);
    }
  }
  let removed = 0;
  for (const dup of duplicates) {
    try {
      await deleteBundleLibrary(dup.scope, dup.id);
      removed++;
    } catch (err) {
      console.error("Failed to remove duplicate bundle library", dup, err);
    }
  }
  return { kept: [...seen.values()], removed };
}

// --- Catalogs ----------------------------------------------------------
//
// A reusable list of things a player can browse and spend an in-sheet
// currency on — "Common Weapons," a spell list, whatever — defined
// ONCE here (same global/personal-scope pattern as bundle libraries
// above) and linked to from a "Catalog" field on any character (see
// catalogLibraryEditor.js and the "catalog" fieldType in
// blockModel.js/customSheet.js). A catalog is
// { id, name, archetype, tabs: [{ id, name, archetypeDiff, entries }] },
// where archetype defines the (Acquisition Costs / Requirements /
// Effects) fields every entry gets by default, and each entry is
// { id, name, description, imageData, archetypeDiff, fieldValues }.
// Unlike a bundle, nothing here references field IDS at all — a
// catalog doesn't know or care which character it's attached to; a
// linked archetype row stores a field NAME + shape snapshot (see
// catalogLibraryEditor.js's linkFromField), and the FIELD linking to
// the catalog itself separately holds which money field on THIS
// character purchases draw from.

function catalogPayload(entry, ownerId) {
  return {
    ownerId,
    name: entry.name || "Unnamed Catalog",
    archetype: entry.archetype || null,
    tabs: entry.tabs || [],
    updatedAt: serverTimestamp(),
  };
}

export async function listCatalogs() {
  const uid = currentUserId();
  if (!uid) return [];

  const [globalSnap, personalSnap] = await Promise.all([
    getDocs(collection(db, PUBLIC_CATALOGS_COLLECTION)),
    getDocs(collection(db, USER_CATALOGS_COLLECTION, uid, "catalogs")),
  ]);

  const globals = globalSnap.docs.map(d => ({ id: d.id, scope: "global", ...d.data() }));
  const personal = personalSnap.docs.map(d => ({ id: d.id, scope: "personal", ...d.data() }));

  return [...globals, ...personal].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function loadCatalog(scope, id) {
  const uid = currentUserId();
  if (!uid) return null;
  const ref = scope === "global"
    ? doc(db, PUBLIC_CATALOGS_COLLECTION, id)
    : doc(db, USER_CATALOGS_COLLECTION, uid, "catalogs", id);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, scope, ...snap.data() } : null;
}

/** Same shape/rules as saveBundleLibrary — global needs admin rights,
 *  enforced here and again by firestore.rules. */
export async function saveCatalog(scope, entry) {
  const uid = currentUserId();
  if (!uid) throw new Error("Not signed in");
  if (scope === "global" && !(await isCurrentUserAdmin())) {
    throw new Error("Only admins can save global catalogs");
  }

  const collectionRef = scope === "global"
    ? collection(db, PUBLIC_CATALOGS_COLLECTION)
    : collection(db, USER_CATALOGS_COLLECTION, uid, "catalogs");
  const id = entry.id || doc(collectionRef).id;
  const ref = scope === "global"
    ? doc(db, PUBLIC_CATALOGS_COLLECTION, id)
    : doc(db, USER_CATALOGS_COLLECTION, uid, "catalogs", id);

  await setDoc(ref, catalogPayload(entry, uid));
  return id;
}

export async function deleteCatalog(scope, id) {
  const uid = currentUserId();
  if (!uid) return;
  const ref = scope === "global"
    ? doc(db, PUBLIC_CATALOGS_COLLECTION, id)
    : doc(db, USER_CATALOGS_COLLECTION, uid, "catalogs", id);
  await deleteDoc(ref);
}

// characterStore.js
//
// This is the ONLY file in the app that should import from
// firebase/firestore or firebase/auth. Everywhere else calls these
// functions and works with plain JS objects — that keeps Firebase
// swappable and keeps the rendering code testable without a live
// backend.
//
// Images are stored as compressed Base64 Data URLs directly in the
// character document (no Firebase Storage). Picture fields use
// `imageData`; block background images use `style.bgImage`.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { bundleDedupeKey as sharedBundleDedupeKey } from "./bundleMaps.js";
import { isDataUrlImage, forEachStoredImage } from "./characterImages.js";
import { compressDataUrl } from "./imageCompression.js";
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

import { stripBundlesFromPatch, hydrateCharacter } from "./bundleMaps.js";

export async function loadCharacter(characterId) {
  const snap = await getDoc(doc(db, CHARACTERS_COLLECTION, characterId));
  if (!snap.exists()) return null;
  const data = { id: snap.id, ...snap.data() };
  const hydrated = hydrateCharacter(data);
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
  await deleteDoc(doc(db, CHARACTERS_COLLECTION, characterId));
}

// --- Character image upload (compressed Base64 directly in document) --------

/** Compress and upload a data-URL image for a character.
 *  Returns the compressed Base64 Data URL.
 *  Non-data URLs pass through untouched. */
export async function uploadCharacterImage(characterId, dataUrl) {
  if (!isDataUrlImage(dataUrl)) return dataUrl;
  try {
    return await compressDataUrl(dataUrl);
  } catch (err) {
    console.warn("Image compression failed, using original:", err);
    return dataUrl;
  }
}

/** No-op for compatibility — images are inline Base64, no resolution needed. */
export async function characterImageUrl(path) {
  void path;
  return null;
}

/** No-op for compatibility — images are inline Base64, no Storage object to delete. */
export async function deleteCharacterImage(path) {
  void path;
  return false;
}

/** No-op — images are inline Base64, deleted with the document. */
export async function deleteCharacterImagesFor(characterId) {
  void characterId;
  return false;
}

/** Copies are no-ops since images are inline Base64 in the document. */
export async function copyCharacterImages(oldId, newId) {
  void oldId;
  void newId;
  return {};
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

export function bundleDedupeKey(entry) {
  return sharedBundleDedupeKey(entry);
}

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
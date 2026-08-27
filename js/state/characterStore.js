// characterStore.js
//
// This is the ONLY file in the app that should import from
// firebase/firestore or firebase/auth. Everywhere else (formBuilder,
// characterSheet, etc.) calls these functions and works with plain
// JS objects — that keeps Firebase swappable and keeps the rendering
// code testable without a live backend.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
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

export async function loadCharacter(characterId) {
  const snap = await getDoc(doc(db, CHARACTERS_COLLECTION, characterId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
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
    ...characterData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function saveCharacterField(characterId, fieldId, value) {
  await updateDoc(doc(db, CHARACTERS_COLLECTION, characterId), {
    [fieldId]: value,
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
    ...patch,
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

/**
 * Subscribe to realtime updates for a character (e.g. so a DM and
 * player viewing the same sheet stay in sync). Returns an unsubscribe
 * function.
 */
export function subscribeToCharacter(characterId, onUpdate) {
  return onSnapshot(doc(db, CHARACTERS_COLLECTION, characterId), (snap) => {
    if (snap.exists()) onUpdate({ id: snap.id, ...snap.data() });
  });
}

// --- Sheet templates -------------------------------------------------------

function cloneLayout(layout) {
  return JSON.parse(JSON.stringify(layout || []));
}

function parseTemplateName(name) {
  const trimmed = (name || "").trim();
  const globalMatch = trimmed.match(/^(.+?)\s+GLOBAL\s+TEMPLATE$/i);
  if (globalMatch) return { kind: "global", templateName: globalMatch[1].trim() };

  const personalMatch = trimmed.match(/^(.+?)\s+TEMPLATE$/i);
  if (personalMatch) return { kind: "personal", templateName: personalMatch[1].trim() };

  return null;
}

function templatePayload(character, parsed) {
  return {
    characterId: character.id,
    ownerId: character.ownerId,
    name: parsed.templateName,
    sourceName: character.name || "",
    layout: cloneLayout(character.layout),
    sheetTabs: cloneLayout(character.sheetTabs || []),
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

export async function listSheetTemplates() {
  const uid = currentUserId();
  if (!uid) return [];

  const [globalSnap, personalSnap] = await Promise.all([
    getDocs(collection(db, PUBLIC_TEMPLATES_COLLECTION)),
    getDocs(collection(db, USER_TEMPLATES_COLLECTION, uid, "templates")),
  ]);

  const globals = globalSnap.docs.map(d => ({ id: d.id, scope: "global", ...d.data() }));
  const personal = personalSnap.docs.map(d => ({ id: d.id, scope: "personal", ...d.data() }));

  return [...globals, ...personal].sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "global" ? -1 : 1;
    return (a.name || "").localeCompare(b.name || "");
  });
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
    statModifiers: entry.statModifiers || [],
    dropdownAccess: entry.dropdownAccess || [],
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

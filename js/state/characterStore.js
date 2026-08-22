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
  getAuth,
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
const auth = getAuth(app);

const CHARACTERS_COLLECTION = "characters";
const PUBLIC_TEMPLATES_COLLECTION = "publicSheetTemplates";
const USER_TEMPLATES_COLLECTION = "userSheetTemplates";
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

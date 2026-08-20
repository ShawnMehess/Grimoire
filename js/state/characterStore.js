// characterStore.js
//
// This is the ONLY file in the app that should import from
// firebase/firestore or firebase/auth. Everywhere else (formBuilder,
// characterSheet, etc.) calls these functions and works with plain
// JS objects — that keeps Firebase swappable and keeps the rendering
// code testable without a live backend.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// Fill in with your Firebase project config (Project Settings -> General
// -> Your apps). Fine to commit — these values are not secret, access
// control happens in Firestore security rules, not by hiding this config.
const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const CHARACTERS_COLLECTION = "characters";

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
}

export async function saveCharacterFields(characterId, patch) {
  await updateDoc(doc(db, CHARACTERS_COLLECTION, characterId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
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

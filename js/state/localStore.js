// localStore.js — offline-first backend for Character Vault.
//
// Same named exports as state/characterStore.js, backed by
// localStorage instead of Firestore. Used automatically when Firebase
// can't be reached (see state/store.js): the app stays fully usable
// single-player — create, edit, level, delete characters — with data
// living in this browser only. Bundle strip/hydrate behavior is
// identical to Firestore (shared ./bundleMaps.js), so a character
// exported from one backend imports cleanly into the other.
//
// Deliberate differences from characterStore.js:
// - Auth is a fixed local identity ("Local Player"); signIn resolves
//   immediately, signOutUser returns to the signed-out screen.
// - Templates / bundle libraries / catalogs are personal-only;
//   "global" scope reads as empty and writes fall back to personal.
// - isCurrentUserAdmin() is always true: locally you own everything,
//   so "GLOBAL TEMPLATE" sync just works.

import { stripBundlesFromPatch, hydrateCharacter, bundleDedupeKey } from "./bundleMaps.js";

export const isLocal = true;
export const authSignInLabel = () => "Continue offline";

const LS_KEYS = {
  characters: "grimoire.local.characters.v1",
  templates: "grimoire.local.templates.v1",
  bundles: "grimoire.local.bundles.v1",
  catalogs: "grimoire.local.catalogs.v1",
};

const LOCAL_USER = { uid: "local-player", displayName: "Local Player (this browser)", email: null };

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const nowIso = () => new Date().toISOString();

// --- Auth -----------------------------------------------------------------

let authCallback = null;
let signedIn = true;

export function onAuthChange(callback) {
  authCallback = callback;
  // Mirror Firebase's async initial callback.
  setTimeout(() => callback(signedIn ? { ...LOCAL_USER } : null), 0);
  return () => { authCallback = null; };
}

export async function signIn() {
  signedIn = true;
  if (authCallback) authCallback({ ...LOCAL_USER });
}

export async function signOutUser() {
  signedIn = false;
  if (authCallback) authCallback(null);
}

export function currentUserId() {
  return signedIn ? LOCAL_USER.uid : null;
}

export async function isCurrentUserAdmin() {
  return true;
}

export { bundleDedupeKey };

// --- Characters ------------------------------------------------------------

function allCharacters() {
  return readJson(LS_KEYS.characters, {});
}

function persistCharacters(map) {
  writeJson(LS_KEYS.characters, map);
}

export async function loadCharacter(characterId) {
  const doc = allCharacters()[characterId];
  return doc ? hydrateCharacter({ id: characterId, ...JSON.parse(JSON.stringify(doc)) }) : null;
}

export async function listMyCharacters() {
  const uid = currentUserId();
  if (!uid) return [];
  return Object.entries(allCharacters())
    .filter(([, doc]) => !doc.ownerId || doc.ownerId === uid)
    .map(([id, doc]) => ({ id, ...doc }));
}

export async function createCharacter(characterData) {
  const id = newId();
  const map = allCharacters();
  map[id] = {
    ...stripBundlesFromPatch(characterData),
    ownerId: currentUserId(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  persistCharacters(map);
  return id;
}

function applyPatch(characterId, patch) {
  const map = allCharacters();
  const existing = map[characterId];
  if (!existing) return false;
  map[characterId] = {
    ...existing,
    ...stripBundlesFromPatch(patch),
    updatedAt: nowIso(),
  };
  persistCharacters(map);
  return true;
}

export async function saveCharacterField(characterId, fieldId, value) {
  if (!applyPatch(characterId, { [fieldId]: value })) return;
  if (fieldId === "name" || fieldId === "layout") {
    await syncCharacterTemplate(characterId).catch(() => {});
  }
}

export async function saveCharacterFields(characterId, patch) {
  if (!applyPatch(characterId, patch)) return;
  if (patch && ("name" in patch || "layout" in patch)) {
    await syncCharacterTemplate(characterId).catch(() => {});
  }
}

export async function deleteCharacter(characterId) {
  const map = allCharacters();
  delete map[characterId];
  persistCharacters(map);
}

// --- Character images -------------------------------------------------------
//
// Same export names as characterStore.js so renderers stay
// backend-agnostic. Offline has no Storage: uploads keep the data URL
// (local documents never hit the Firestore cap), deletes are no-ops,
// and the next online load migrates data URLs it finds.

/** Offline pass-through: keeps the data URL (no path). */
export async function uploadCharacterImage(characterId, dataUrl) {
  void characterId;
  return { path: null, url: dataUrl };
}

/** No stored object offline — nothing to resolve. */
export async function characterImageUrl(path) {
  void path;
  return null;
}

/** No stored object offline — nothing to delete. */
export async function deleteCharacterImage(path) {
  void path;
  return false;
}

/** No stored objects offline — nothing to wipe. */
export async function deleteCharacterImagesFor(characterId) {
  void characterId;
  return false;
}

// --- Sheet templates ---------------------------------------------------------

function parseTemplateName(name) {
  const trimmed = (name || "").trim();
  const globalMatch = trimmed.match(/^(.+?)\s+GLOBAL\s+TEMPLATE$/i);
  if (globalMatch) return { kind: "global", templateName: globalMatch[1].trim() };
  const personalMatch = trimmed.match(/^(.+?)\s+TEMPLATE$/i);
  if (personalMatch) return { kind: "personal", templateName: personalMatch[1].trim() };
  return null;
}

async function syncCharacterTemplate(characterId) {
  const character = await loadCharacter(characterId);
  if (!character) return;
  const parsed = parseTemplateName(character.name);
  const uid = currentUserId();
  if (!parsed || !uid || (character.ownerId && character.ownerId !== uid)) return;
  const stripped = stripBundlesFromPatch({ layout: character.layout, sheetTabs: character.sheetTabs || [] });
  const templates = readJson(LS_KEYS.templates, {});
  templates[character.id] = {
    id: character.id,
    scope: parsed.kind,
    characterId: character.id,
    ownerId: uid,
    name: parsed.templateName,
    sourceName: character.name || "",
    layout: stripped.layout || [],
    sheetTabs: stripped.sheetTabs || [],
    updatedAt: nowIso(),
  };
  writeJson(LS_KEYS.templates, templates);
}

// --- Bundle libraries ----------------------------------------------------------

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
    updatedAt: nowIso(),
  };
}

export async function listBundleLibraries() {
  const uid = currentUserId();
  if (!uid) return [];
  return Object.values(readJson(LS_KEYS.bundles, {}))
    .filter((e) => !e.ownerId || e.ownerId === uid)
    .map((e) => ({ scope: "personal", ...e }))
    .sort((a, b) => {
      if (a.category !== b.category) return (a.category || "").localeCompare(b.category || "");
      return (a.name || "").localeCompare(b.name || "");
    });
}

export async function saveBundleLibrary(scope, entry) {
  const uid = currentUserId();
  if (!uid) throw new Error("Not signed in");
  const id = entry.id || newId();
  const map = readJson(LS_KEYS.bundles, {});
  // No separate global namespace offline — everything is personal.
  map[id] = { id, scope: "personal", ...bundleLibraryPayload(entry, uid) };
  writeJson(LS_KEYS.bundles, map);
  return id;
}

export async function deleteBundleLibrary(scope, id) {
  const map = readJson(LS_KEYS.bundles, {});
  delete map[id];
  writeJson(LS_KEYS.bundles, map);
}

export async function dedupeBundleLibraries() {
  const all = await listBundleLibraries();
  const seen = new Map();
  const duplicates = [];
  for (const entry of all) {
    const key = bundleDedupeKey(entry);
    if (seen.has(key)) duplicates.push(entry);
    else seen.set(key, entry);
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

// --- Catalogs --------------------------------------------------------------------

function catalogPayload(entry, ownerId) {
  return {
    ownerId,
    name: entry.name || "Unnamed Catalog",
    archetype: entry.archetype || null,
    tabs: entry.tabs || [],
    updatedAt: nowIso(),
  };
}

export async function listCatalogs() {
  const uid = currentUserId();
  if (!uid) return [];
  return Object.values(readJson(LS_KEYS.catalogs, {}))
    .filter((e) => !e.ownerId || e.ownerId === uid)
    .map((e) => ({ scope: "personal", ...e }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function loadCatalog(scope, id) {
  const uid = currentUserId();
  if (!uid) return null;
  const entry = readJson(LS_KEYS.catalogs, {})[id];
  return entry ? { id, scope: "personal", ...entry } : null;
}

export async function saveCatalog(scope, entry) {
  const uid = currentUserId();
  if (!uid) throw new Error("Not signed in");
  const id = entry.id || newId();
  const map = readJson(LS_KEYS.catalogs, {});
  map[id] = { id, scope: "personal", ...catalogPayload(entry, uid) };
  writeJson(LS_KEYS.catalogs, map);
  return id;
}

export async function deleteCatalog(scope, id) {
  const uid = currentUserId();
  if (!uid) return;
  const map = readJson(LS_KEYS.catalogs, {});
  delete map[id];
  writeJson(LS_KEYS.catalogs, map);
}

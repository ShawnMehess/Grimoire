// main.js — app entry point

import { loadStore } from "./state/store.js";
// Firebase when reachable (shared between friends), localStorage when
// not (?offline=1, no connection, or CDN failure) — same exports
// either way, so everything below is backend-agnostic.
const characterStore = await loadStore();
const { onAuthChange, signIn, signOutUser, listMyCharacters, loadCharacter, createCharacter, deleteCharacter, currentUserId } = characterStore;
import { createBlankCharacter } from "./data/schema.js";
import { renderCustomSheet } from "./render/customSheet.js";
import { computeAllFormulas } from "./data/formula.js";

const appRoot = document.getElementById("app-main");
const authArea = document.getElementById("auth-area");

const backBtn = document.createElement("button");
backBtn.className = "btn";
backBtn.textContent = "← Back";
backBtn.style.display = "none";
// The currently-open character's { hasUnsavedChanges, destroy } (see
// renderCustomSheet) — null when no character is open. Checked/torn
// down below any time we're about to leave whichever character this
// points at.
let openSheet = null;
function leaveCurrentSheet(next) {
  if (openSheet && openSheet.hasUnsavedChanges() &&
      !window.confirm("You have unsaved changes on this character. Leave anyway?")) {
    return;
  }
  if (openSheet) openSheet.destroy();
  openSheet = null;
  next();
}
backBtn.addEventListener("click", () => leaveCurrentSheet(renderCharacterList));

// Belt-and-suspenders for the "stuck on Loading..." problem: even with
// the IndexedDB-probing fix in characterStore.js, this makes sure a
// hang from any *other* cause (network down, Firebase outage, some
// browser quirk not yet seen) can't leave someone staring at
// "Loading..." with no way out. If auth hasn't resolved after a few
// seconds, swap in a message with a retry button instead of waiting
// forever.
let authResolved = false;
const loadingWatchdog = setTimeout(() => {
  if (authResolved) return;
  appRoot.innerHTML = "";
  const msg = document.createElement("p");
  msg.textContent = "This is taking longer than expected — your browser may be blocking storage Grimoire needs (this can happen in Private Browsing).";
  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.className = "btn btn--primary";
  retryBtn.textContent = "Retry";
  retryBtn.addEventListener("click", () => window.location.reload());
  appRoot.append(msg, retryBtn);
}, 6000);

onAuthChange(async (user) => {
  authResolved = true;
  clearTimeout(loadingWatchdog);
  authArea.innerHTML = "";

  if (!user) {
    const signInBtn = document.createElement("button");
    signInBtn.className = "btn btn--primary";
    signInBtn.textContent = characterStore.authSignInLabel?.() ?? "Sign in with Google";
    signInBtn.addEventListener("click", signIn);
    authArea.append(signInBtn);
    appRoot.innerHTML = "<p>Sign in to view your characters.</p>";
    return;
  }

  const signOutBtn = document.createElement("button");
  signOutBtn.className = "btn";
  signOutBtn.textContent = `Sign out (${user.displayName ?? user.email})`;
  signOutBtn.addEventListener("click", signOutUser);
  authArea.append(backBtn, signOutBtn);

  await renderCharacterList();
});

/** Same placeholder graphic as a picture field's own empty state (see
 *  buildAvatarPlaceholderSvg in customSheet.js) — duplicated rather
 *  than imported since it's a few lines of inline SVG and pulling in
 *  all of customSheet.js here just for this would be overkill. */
function buildPlaceholderPortraitSvg() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  svg.innerHTML = `
    <rect width="24" height="24" fill="#2a2520"/>
    <circle cx="12" cy="9.5" r="4" fill="#4a4038"/>
    <path d="M12 14.6c-4.8 0-8.2 3.2-8.2 7.7v1.7h16.4v-1.7c0-4.5-3.4-7.7-8.2-7.7z" fill="#4a4038"/>
  `;
  return svg;
}

/** Every field across every tab (or the legacy flat .layout) — same
 *  tabs-normalization as findAvatarImageData above, just flattened
 *  into one list instead of searching for one specific flag. */
function flattenAllFields(character) {
  const tabs = Array.isArray(character.sheetTabs) && character.sheetTabs.length > 0
    ? character.sheetTabs
    : [{ layout: Array.isArray(character.layout) ? character.layout : [] }];
  const fields = [];
  tabs.forEach((tab) => {
    (tab.layout || []).forEach((block) => {
      (block.children || []).forEach((field) => fields.push(field));
    });
  });
  return fields;
}

/** What to actually show for a field someone's dragged onto their
 *  character-card list (see the identity-card-fields drop zone in
 *  customSheet.js) — a dropdown shows its selected choice's text; a
 *  plain (non-formula) text field shows its raw typed content as-is,
 *  numeric or not, since it might just as easily be "Half-Elf" as
 *  "14"; a formula field shows its computed result. Anything else
 *  (radio/checkbox/etc.) isn't meaningful to show standalone, so it's
 *  skipped. Returns null rather than a placeholder when there's
 *  nothing to show, so the caller can filter empties out cleanly. */
function displayValueForField(field, formulaValues) {
  if (!field) return null;
  if (field.fieldType === "dropdown") {
    const choice = (field.choices || []).find((c) => c.id === field.selected);
    return choice ? choice.text : null;
  }
  if (field.fieldType === "text") {
    if (field.formula) {
      const v = formulaValues[field.id];
      return Number.isFinite(v) ? String(v) : null;
    }
    const tmp = document.createElement("div");
    tmp.innerHTML = field.value || "";
    const text = tmp.textContent.trim();
    return text || null;
  }
  return null;
}

/** The character's designated avatar image, if any — see the "Set as
 *  Avatar" button on a picture field in customSheet.js. Only ever one
 *  such field per character. */
function findAvatarImageData(character) {
  const match = flattenAllFields(character).find(
    (f) => f.fieldType === "picture" && f.isAvatar && f.imageData
  );
  return match ? match.imageData : null;
}

/** Builds the character card's meta line: Level, Race, and Class up
 *  front, then whichever extra fields were dragged into the
 *  identity-card-fields drop zone on that character's own sheet.
 *  Core values come from guided rules state, falling back to the
 *  sheet's own Race/Class/Level fields (older or hand-built sheets)
 *  — name is the only thing about a character that isn't just
 *  "whatever field you chose to show here". */
function buildCardMeta(character) {
  const rules = character.rules || {};
  const allFields = flattenAllFields(character);
  const formulaValues = computeAllFormulas(allFields);
  const byLabel = (label) => allFields.find((f) => (f.label || "").trim().toLowerCase() === label);
  const dropdownText = (label) => {
    const field = byLabel(label);
    if (!field || field.fieldType !== "dropdown") return null;
    return field.choices?.find((c) => c.id === field.selected)?.text || null;
  };
  const asLevel = (v) => {
    if (v === undefined || v === null || String(v).trim() === "" || !Number.isFinite(Number(v))) return null;
    return `Level ${Number(v)}`;
  };
  const core = [
    asLevel(rules.level) || asLevel(displayValueForField(byLabel("level"), formulaValues)),
    rules.species || dropdownText("race") || dropdownText("species"),
    rules.className || dropdownText("class"),
  ].filter(Boolean);
  const ids = Array.isArray(character.cardFieldIds) ? character.cardFieldIds : [];
  const extra = ids
    .map((id) => allFields.find((f) => f.id === id))
    .map((f) => displayValueForField(f, formulaValues))
    .filter(Boolean);
  const parts = [...core, ...extra];
  return parts.length ? parts.join(" • ") : "—";
}

async function renderCharacterList() {
  backBtn.style.display = "none";
  appRoot.innerHTML = "";

  const heading = document.createElement("div");
  heading.className = "page-header";
  const title = document.createElement("h2");
  title.textContent = "Your Characters";
  const newBtn = document.createElement("button");
  newBtn.className = "btn btn--primary";
  newBtn.textContent = "+ New Character";
  newBtn.addEventListener("click", createNewBlankCharacter);
  heading.append(title, newBtn);
  appRoot.append(heading);

  if (characterStore.isLocal) {
    const banner = document.createElement("p");
    banner.className = "leveling-tab__intro";
    banner.textContent = "Offline mode — characters save in this browser only. Drop ?offline=1 (with a connection) to use the shared backend.";
    appRoot.append(banner);
  }

  const characters = await listMyCharacters();

  const searchRow = document.createElement("div");
  searchRow.className = "character-vault__search-row";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "input-group__control character-vault__search";
  searchInput.placeholder = "Search your characters…";
  searchRow.append(searchInput);
  // Only worth showing once there's enough in the list to actually
  // need narrowing down — an empty search box above two or three
  // cards is just clutter.
  if (characters.length > 6) appRoot.append(searchRow);

  const list = document.createElement("div");
  list.className = "character-card-grid";
  appRoot.append(list);

  const emptyState = document.createElement("p");
  emptyState.className = "leveling-tab__intro";
  emptyState.textContent = "No characters match that search.";

  function renderCards(filterText) {
    list.innerHTML = "";
    const needle = filterText.trim().toLowerCase();
    const filtered = needle
      ? characters.filter((c) => (c.name || "Unnamed").toLowerCase().includes(needle))
      : characters;

    if (filtered.length === 0) {
      appRoot.append(emptyState);
      return;
    }
    emptyState.remove();

    filtered.forEach(c => {
      const card = document.createElement("div");
      card.className = "character-card";
      card.addEventListener("click", () => openCharacter(c.id));

      const portrait = document.createElement("div");
      portrait.className = "character-card__portrait";
      const avatarData = findAvatarImageData(c);
      if (avatarData) {
        const img = document.createElement("img");
        img.src = avatarData;
        img.alt = "";
        portrait.append(img);
      } else {
        portrait.append(buildPlaceholderPortraitSvg());
      }
      card.append(portrait);

      const actions = document.createElement("div");
      actions.className = "character-card__actions";

      const duplicateBtn = document.createElement("button");
      duplicateBtn.type = "button";
      duplicateBtn.className = "character-card__duplicate";
      duplicateBtn.textContent = "⧉";
      duplicateBtn.title = "Duplicate character";
      duplicateBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        duplicateBtn.disabled = true;
        try {
          await duplicateCharacter(c);
          await renderCharacterList();
        } catch (err) {
          console.error("Failed to duplicate character:", err);
          window.alert("Couldn't duplicate that character — see the console for details.");
          duplicateBtn.disabled = false;
        }
      });
      actions.append(duplicateBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "character-card__delete";
      deleteBtn.textContent = "✕";
      deleteBtn.title = "Delete character";
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const confirmed = window.confirm(`Delete "${c.name || "Unnamed"}"? This can't be undone.`);
        if (!confirmed) return;
        await deleteCharacter(c.id);
        renderCharacterList();
      });
      actions.append(deleteBtn);

      card.append(actions);

      const info = document.createElement("div");
      info.className = "character-card__info";
      const nameEl = document.createElement("div");
      nameEl.className = "character-card__name";
      nameEl.textContent = c.name || "Unnamed";
      const metaEl = document.createElement("div");
      metaEl.className = "character-card__meta";
      metaEl.textContent = buildCardMeta(c);
      if (metaEl.textContent === "—") {
        metaEl.classList.add("character-card__meta--empty");
        metaEl.title = "Tip: open the sheet and drag fields onto “Card fields” to show them here";
      }
      info.append(nameEl, metaEl);
      card.append(info);

      list.append(card);
    });
  }

  searchInput.addEventListener("input", () => renderCards(searchInput.value));
  renderCards("");
}

/** Clones a character's full saved state (layout, sheetTabs, rules,
 *  level-up history, notes — everything except id/timestamps/name)
 *  into a brand-new character owned by the current user. Handy as a
 *  starting point for a variant build, or for a friend who wants "the
 *  same character but at level 5" without redoing every choice.
 *  Deliberately NOT a template — templates are meant to be a reusable
 *  starting *shape*; this is a full,
 *  independent copy of one specific character. */
async function duplicateCharacter(character) {
  const { id, createdAt, updatedAt, ...rest } = character;
  const clone = JSON.parse(JSON.stringify(rest));
  clone.name = character.name ? `${character.name} (Copy)` : "Unnamed (Copy)";
  clone.ownerId = currentUserId();
  const newId = await createCharacter(clone);
  return newId;
}

async function createNewBlankCharacter() {
  // No `layout` key here on purpose — renderCustomSheet seeds a
  // fresh one (createStarterLayout(), now a real D&D core stat
  // block) the first time a character has none. Explicitly setting
  // layout: [] here used to defeat that check (an empty array is
  // still truthy), so new "blank" characters silently got nothing.
  // Screen mode by default; changeable anytime from the sheet's own
  // toolbar.
  const data = createBlankCharacter(currentUserId());
  data.sheetMode = "screen";
  const id = await createCharacter(data);
  openCharacter(id);
}

async function openCharacter(characterId) {
  const character = await loadCharacter(characterId);
  appRoot.innerHTML = "";
  backBtn.style.display = "";

  const sheetRoot = document.createElement("div");
  appRoot.append(sheetRoot);
  openSheet = renderCustomSheet(sheetRoot, character, characterStore, {
    onOpenCharacter: (id) => leaveCurrentSheet(() => openCharacter(id)),
  });
}

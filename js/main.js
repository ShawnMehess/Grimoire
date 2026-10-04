// main.js — app entry point

import { loadStore } from "./state/store.js";
// Firebase when reachable (shared between friends), localStorage when
// not (?offline=1, no connection, or CDN failure) — same exports
// either way, so everything below is backend-agnostic.
const characterStore = await loadStore();
const { onAuthChange, signIn, signOutUser, listMyCharacters, loadCharacter, createCharacter, deleteCharacter, currentUserId } = characterStore;
import { createBlankCharacter } from "./data/schema.js";
import { forEachStoredImage } from "./state/characterImages.js";
import { hydrateCharacter } from "./state/bundleMaps.js";
// Its own module rather than a function below, because it is pure text
// classification of a failed fetch and because it cannot be tested from
// HERE: this file awaits `loadStore()` at module scope, so importing it in
// Node would try to reach Firebase over the network.
import { explainLoadFailure } from "./state/loadFailure.js";
import { renderCustomSheet } from "./render/customSheet.js";
import { computeAllFormulas } from "./data/formula.js";
import { applySheetTheme } from "./data/themes.js";
import { el } from "./render/sheet/sheetHelpers.js";
import { alertDialog, confirmDialog } from "./ui/dialogs.js";
import { applyA11yMode } from "./ui/accessibility.js";

const appRoot = document.getElementById("app-main");
const authArea = document.getElementById("auth-area");

const backBtn = document.createElement("button");
backBtn.className = "btn";
backBtn.textContent = "Return to Character Selection";
backBtn.style.display = "none";
// The currently-open character's { hasUnsavedChanges, destroy } (see
// renderCustomSheet) — null when no character is open. Checked/torn
// down below any time we're about to leave whichever character this
// points at.
let openSheet = null;

// The most recently opened sheet's accessibility preferences. The vault
// renders before any character is opened on a first visit, so this starts
// empty and the options are simply off there until a sheet says otherwise.
let lastA11y = {};
const lastA11yPrefs = () => lastA11y;
function leaveCurrentSheet(next) {
  // window.confirm is DELIBERATE here and is the one place in the app that
  // still uses a native dialog. Browsers do not permit an asynchronous dialog
  // during unload, so a themed one cannot answer this question in time; a
  // guard that silently never resolves is worse than an inelegant one. Every
  // other native dialog has been replaced (see js/ui/dialogs.js).
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
/** The card art for a character who has not set an avatar: their initial
 *  on a themed panel.
 *
 *  It used to be the same generic head-and-shoulders silhouette on every
 *  card, which made a vault of eight read as eight copies of one thing
 *  and wasted the largest element on the card. A monogram gives each card
 *  its own mark and says something about who it belongs to. Colours come
 *  from CSS classes rather than fills, so it re-themes with everything
 *  else instead of being one more fixed-colour picture.
 *
 *  Only used by the vault card, so this is free to be card-specific. */
function buildPlaceholderPortraitSvg(name) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");

  const bg = document.createElementNS(NS, "rect");
  bg.setAttribute("class", "character-card__placeholder-bg");
  bg.setAttribute("width", "100");
  bg.setAttribute("height", "100");

  const ring = document.createElementNS(NS, "circle");
  ring.setAttribute("class", "character-card__placeholder-ring");
  ring.setAttribute("cx", "50");
  ring.setAttribute("cy", "50");
  ring.setAttribute("r", "25");

  const label = document.createElementNS(NS, "text");
  label.setAttribute("class", "character-card__placeholder-initial");
  label.setAttribute("x", "50");
  label.setAttribute("y", "50");
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "central");
  // textContent, never an interpolated innerHTML: a character called
  // "<img onerror=...>" would otherwise reach the DOM as markup. The
  // markup gate in check-imports.mjs exists for exactly this and caught
  // the first version of this function.
  label.textContent = String(name || "").trim().charAt(0).toUpperCase() || "?";

  svg.append(bg, ring, label);
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

/** Builds the character card's meta lines: Level, Race, and Class each
 *  on their own line, with a picked subrace/subclass on an indented row
 *  below its parent — then whichever extra fields were dragged into the
 *  identity-card-fields drop zone on that character's own sheet.
 *  Core values come from guided rules state, falling back to the
 *  sheet's own Race/Class/Level fields (older or hand-built sheets)
 *  — name is the only thing about a character that isn't just
 *  "whatever field you chose to show here". Returns [{ text, sub }]. */
function buildCardMetaLines(character) {
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
  const lines = [];
  const level = asLevel(rules.level) || asLevel(displayValueForField(byLabel("level"), formulaValues));
  if (level) lines.push({ text: level });
  const race = rules.species || dropdownText("race") || dropdownText("species");
  if (race) lines.push({ text: race });
  const subrace = findSubraceName(character, allFields);
  if (subrace) lines.push({ text: subrace, sub: true });
  const cls = rules.className || dropdownText("class");
  if (cls) lines.push({ text: cls });
  const subclass = rules.subclass || dropdownText("subclass");
  if (subclass) lines.push({ text: subclass, sub: true });
  const ids = Array.isArray(character.cardFieldIds) ? character.cardFieldIds : [];
  ids
    .map((id) => allFields.find((f) => f.id === id))
    .map((f) => displayValueForField(f, formulaValues))
    .filter(Boolean)
    .forEach((text) => lines.push({ text }));
  return lines;
}

/** The picked subrace name (e.g. "High Elf"), if the sheet's Race
 *  dropdown carries a subrace choice group with a saved pick. Choice
 *  keys are `${fieldId}:${choiceId}:${groupId}` (or legacy
 *  `creation:Race:…` ones) — both end with the group id, so a suffix
 *  match finds the pick without knowing the exact prefix. */
function findSubraceName(character, allFields) {
  const fields = allFields || flattenAllFields(character);
  const raceField = fields.find((f) => f.fieldType === "dropdown" && /^(race|species)$/i.test((f.label || "").trim()));
  const selected = raceField?.choices?.find((c) => c.id === raceField.selected);
  const group = (selected?.bundle?.choiceGroups || [])
    .find((g) => g.subrace === true || /subrace/i.test(g.id || ""));
  if (!group) return null;
  const store = character.rules?.choices || {};
  let ids = store[group.key];
  if (!ids && group.id) {
    const suffix = `:${group.id}`;
    for (const [key, value] of Object.entries(store)) {
      if (typeof key === "string" && key.endsWith(suffix)) { ids = value; break; }
    }
  }
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const options = [...(group.options || []), ...((group.categories || []).flatMap((c) => c.options || []))];
  const names = ids.map((id) => options.find((o) => o.id === id)?.name).filter(Boolean);
  return names.length ? names.join(" · ") : null;
}

async function renderCharacterList() {
  // Sheets apply their own theme on open and leave it on the root —
  // reset to the default (Standard/dark, the blue theme new sheets
  // use) so the vault never inherits the last-opened sheet's look
  // or the unthemed orange base palette.
  applySheetTheme("standard", "dark");
  // ...but the accessibility options are reading preferences, not a theme,
  // and they carry over on purpose. Somebody who needs wider spacing needs
  // it on the character list too, and having it silently reset here would
  // mean re-finding the toggle every time they came back from a sheet.
  applyA11yMode(lastA11yPrefs());
  backBtn.style.display = "none";
  appRoot.innerHTML = "";

  appRoot.append(el("div", { class: "page-header" },
    el("h2", { text: "Your Characters" }),
    el("button", { class: "btn btn--primary", text: "+ New Character", onclick: createNewBlankCharacter })));

  if (characterStore.isLocal) {
    appRoot.append(el("p", { class: "leveling-tab__intro", text: "Offline mode — Characters save in this browser only. Drop ?offline=1 (with a connection) to use the shared backend." }));
  }

  let characters = [];
  try {
    characters = await listMyCharacters();
  } catch (err) {
    console.error("Failed to list characters:", err);
    const retryBtn = el("button", {
      type: "button", class: "btn btn--primary", text: "Retry",
      onclick: () => renderCharacterList(),
    });
    // The actual reason, not "see the console". Nobody who hits this can
    // open a console, and the message is usually the only thing that
    // distinguishes "you're offline" from "this browser is blocking
    // storage" - which have completely different fixes.
    const why = explainLoadFailure(err, { action: "load your characters" });
    appRoot.append(el("div", { class: "vault-error", role: "alert" },
      el("h3", { text: why.title }),
      el("p", { class: "vault-error__message", text: why.message }),
      why.advice.length ? el("ul", { class: "vault-error__advice" }, ...why.advice.map((line) => el("li", { text: line }))) : null,
      why.detail ? el("p", { class: "vault-error__detail", text: why.detail }) : null,
      el("div", { class: "vault-error__actions" }, retryBtn,
        why.blocked ? el("a", {
          class: "btn", href: `${window.location.pathname}?offline=1`,
          text: "Work offline instead",
          title: "Same app, this browser's own storage. Nothing syncs.",
        }) : null),
    ));
    return;
  }
  // Remember the whole documents, not just the card summaries - see
  // listedCharacters.
  listedCharacters = new Map(characters.map((c) => [c.id, c]));

  const searchInput = el("input", { type: "search", class: "input-group__control character-vault__search", placeholder: "Search your characters…" });
  const searchRow = el("div", { class: "character-vault__search-row" }, searchInput);
  // Only worth showing once there's enough in the list to actually
  // need narrowing down — an empty search box above two or three
  // cards is just clutter.
  if (characters.length > 6) appRoot.append(searchRow);

  const list = el("div", { class: "character-card-grid" });
  appRoot.append(list);

  const emptyState = el("p", { class: "leveling-tab__intro", text: "No characters match that search." });

  function renderCards(filterText) {
    list.innerHTML = "";
    const needle = filterText.trim().toLowerCase();
    const filtered = needle
      ? characters.filter((c) => (c.name || "Unnamed").toLowerCase().includes(needle))
      : characters;

    if (filtered.length === 0) {
      // An empty vault and a search with no hits are different
      // situations — don't tell someone with zero characters that
      // "no characters match that search".
      emptyState.textContent = characters.length === 0
        ? "You don't have any characters yet — click + New Character above to create your first one."
        : "No characters match that search.";
      appRoot.append(emptyState);
      return;
    }
    emptyState.remove();

    filtered.forEach(c => {
      const avatarData = findAvatarImageData(c);
      const duplicateBtn = el("button", {
        type: "button", class: "character-card__duplicate", text: "⧉",
        title: "Duplicate character",
        onclick: async (e) => {
          e.stopPropagation();
          duplicateBtn.disabled = true;
          try {
            await duplicateCharacter(c);
            await renderCharacterList();
          } catch (err) {
            console.error("Failed to duplicate character:", err);
            await alertDialog({
              title: "Couldn't duplicate that character",
              // The real reason where there is one. "See the console for
              // details" is advice aimed at a developer, shown to a player.
              message: String(err?.message || "").trim() || "Nothing more to go on — try again in a moment.",
            });
            duplicateBtn.disabled = false;
          }
        },
      });
      const deleteBtn = el("button", {
        type: "button", class: "character-card__delete", text: "✕",
        title: "Delete character",
        onclick: async (e) => {
          e.stopPropagation();
          const confirmed = await confirmDialog({
            title: `Delete "${c.name || "Unnamed"}"?`,
            message: "This can't be undone.",
            confirmLabel: "Delete",
            tone: "danger",
          });
          if (!confirmed) return;
          deleteBtn.disabled = true;
          try {
            await deleteCharacter(c.id);
            await renderCharacterList();
          } catch (err) {
            console.error("Failed to delete character:", err);
            await alertDialog({
              title: "Couldn't delete that character",
              message: String(err?.message || "").trim() || "Nothing more to go on — try again in a moment.",
            });
            deleteBtn.disabled = false;
          }
        },
      });
      const metaLines = buildCardMetaLines(c);
      const card = el("div", {
        class: "character-card",
        onclick: () => openCharacter(c.id),
      },
        el("div", { class: "character-card__portrait" },
          avatarData ? el("img", { src: avatarData, alt: "" }) : buildPlaceholderPortraitSvg(c.name)),
        el("div", { class: "character-card__actions" }, duplicateBtn, deleteBtn),
        el("div", { class: "character-card__info" },
          el("div", { class: "character-card__name", text: c.name || "Unnamed" }),
          el("div", { class: "character-card__meta-lines" },
            ...(metaLines.length === 0
              ? [el("div", {
                class: "character-card__meta-line character-card__meta--empty", text: "—",
                title: "Tip: open the sheet and drag fields onto “Card fields” to show them here",
              })]
              : metaLines.map(({ text, sub }) => el("div", {
                class: "character-card__meta-line" + (sub ? " character-card__meta-line--sub" : ""),
                text, title: text,
              }))))));

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
  // Storage images live under per-character prefixes: copy the objects
  // so the duplicate owns its images (deleting the original must not
  // break the copy). Best-effort — failures keep the shared references.
  if (typeof characterStore.copyCharacterImages === "function") {
    try {
      const copied = await characterStore.copyCharacterImages(id, newId);
      const remap = new Map(Object.entries(copied || {}));
      if (remap.size) {
        const fresh = await loadCharacter(newId);
        if (fresh) {
          forEachStoredImage(fresh, (slot) => {
            const { ref } = slot.get();
            const hit = ref && remap.get(ref);
            if (hit) slot.set(hit.url, hit.path);
          });
          await characterStore.saveCharacterFields(newId, { layout: fresh.layout, sheetTabs: fresh.sheetTabs });
        }
      }
    } catch (err) {
      console.warn("Image copy skipped:", err);
    }
  }
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
  // Guarded like an open, because it is one: a create that fails used to
  // reject into nothing at all, leaving a "+ New Character" button that
  // silently does not work.
  let id = null;
  try {
    id = await createCharacter(data);
  } catch (err) {
    renderOpenFailure(appRoot, err, () => createNewBlankCharacter());
    return;
  }
  openCharacter(id);
}

/** The vault's own copy of every character it last listed, keyed by id.
 *
 *  `listMyCharacters` returns whole documents - layout, tabs, rules, the
 *  lot - because the card previews are built from them. So when a
 *  character fails to open on a second fetch, the data is already in this
 *  module and re-hydrating it is a local operation rather than a guess.
 *  That is the difference between "the character won't open" and "the
 *  character opens from the copy this page already holds", and it needs
 *  no new persistence: the copy is rebuilt from the next list refresh. */
let listedCharacters = new Map();

/** The error panel an open failure renders into, with the parts that are
 *  actually useful: the reason, what to try, and a Retry that re-runs the
 *  same open. Deliberately not `alertDialog` - this has to be able to
 *  stay on screen next to the vault rather than covering it, and a failed
 *  open has already torn down whatever sheet was there. */
function renderOpenFailure(root, err, retry) {
  const why = explainLoadFailure(err);
  console.error("Failed to open character:", err);
  root.innerHTML = "";
  root.append(el("div", { class: "vault-error", role: "alert" },
    el("h3", { text: why.title }),
    el("p", { class: "vault-error__message", text: why.message }),
    why.advice.length ? el("ul", { class: "vault-error__advice" }, ...why.advice.map((line) => el("li", { text: line }))) : null,
    why.detail ? el("p", { class: "vault-error__detail", text: why.detail }) : null,
    el("div", { class: "vault-error__actions" },
      el("button", { type: "button", class: "btn btn--primary", text: "Try again", onclick: retry }),
      why.blocked ? el("a", {
        class: "btn", href: `${window.location.pathname}?offline=1`,
        text: "Work offline instead",
        title: "Same app, this browser's own storage. Nothing syncs.",
      }) : null),
  ));
}

async function openCharacter(characterId) {
  // Every failure from here is caught and shown. A rejected load used to
  // reject an unhandled promise: the vault stayed up, the click looked
  // like it did nothing, and the browser console carried the only
  // explanation — which is the failure this exists to remove.
  let character = null;
  let loadError = null;
  try {
    character = await loadCharacter(characterId);
  } catch (err) {
    loadError = err;
  }
  if (!character) {
    // Fall back to the copy this page already fetched for the vault. Not
    // a repair: the sheet opens on last-known data and stays honest that
    // it did, which beats a character that will not open at all.
    const cached = listedCharacters.get(characterId);
    if (cached) {
      try {
        character = hydrateCharacter({ ...cached });
        loadError = null;
        console.warn("Opened a character from this page's own copy after the fetch failed.");
      } catch (err) {
        console.error("The cached copy could not be rehydrated:", err);
      }
    }
  }
  if (!character) {
    renderOpenFailure(appRoot, loadError || new Error("That character no longer exists."), () => openCharacter(characterId));
    backBtn.style.display = "none";
    return;
  }

  // Remember this sheet's reading preferences so the vault can restore them.
  // Kept as a plain local rather than read back from storage, because the
  // vault renders before any character is opened on a first visit and a
  // storage round trip per render is not worth it.
  lastA11y = { ...(character.a11y || {}) };
  appRoot.innerHTML = "";
  backBtn.style.display = "";

  const sheetRoot = document.createElement("div");
  appRoot.append(sheetRoot);
  // The render is guarded too, and separately: a document that loads but
  // cannot be rendered (older saved state, a field shape this build no
  // longer understands) is a different failure from a fetch that failed,
  // and it must not be able to blank the page with no way back either.
  try {
    openSheet = renderCustomSheet(sheetRoot, character, characterStore, {
      onOpenCharacter: (id) => leaveCurrentSheet(() => openCharacter(id)),
    });
  } catch (err) {
    console.error("Failed to render character sheet:", err);
    renderOpenFailure(appRoot, err, () => openCharacter(characterId));
    backBtn.style.display = "none";
    openSheet = null;
  }
}


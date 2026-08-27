// main.js — app entry point

import * as characterStore from "./state/characterStore.js";
import { onAuthChange, signIn, signOutUser, listMyCharacters, loadCharacter, createCharacter, deleteCharacter, currentUserId, listSheetTemplates } from "./state/characterStore.js";
import { createBlankCharacter } from "./data/schema.js";
import { renderCustomSheet } from "./render/customSheet.js";

const appRoot = document.getElementById("app-main");
const authArea = document.getElementById("auth-area");

const backBtn = document.createElement("button");
backBtn.className = "btn";
backBtn.textContent = "← Back";
backBtn.style.display = "none";
backBtn.addEventListener("click", renderCharacterList);

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
    signInBtn.textContent = "Sign in with Google";
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

/** Looks across every tab (or the legacy flat .layout, for characters
 *  saved before tabs existed) for a picture field flagged as the
 *  avatar — see the "Set as Avatar" button in customSheet.js. Only
 *  ever one such field per character. */
function findAvatarImageData(character) {
  const tabs = Array.isArray(character.sheetTabs) && character.sheetTabs.length > 0
    ? character.sheetTabs
    : [{ layout: Array.isArray(character.layout) ? character.layout : [] }];
  for (const tab of tabs) {
    for (const block of (tab.layout || [])) {
      for (const field of (block.children || [])) {
        if (field.fieldType === "picture" && field.isAvatar && field.imageData) {
          return field.imageData;
        }
      }
    }
  }
  return null;
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
  newBtn.addEventListener("click", openNewCharacterDialog);
  heading.append(title, newBtn);
  appRoot.append(heading);

  const characters = await listMyCharacters();
  const list = document.createElement("div");
  list.className = "character-card-grid";

  characters.forEach(c => {
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
    card.append(deleteBtn);

    const info = document.createElement("div");
    info.className = "character-card__info";
    const nameEl = document.createElement("div");
    nameEl.className = "character-card__name";
    nameEl.textContent = c.name || "Unnamed";
    const metaParts = [c.race, c.class, c.level ? `Level ${c.level}` : null].filter(Boolean);
    const metaEl = document.createElement("div");
    metaEl.className = "character-card__meta";
    metaEl.textContent = metaParts.join(" • ") || "—";
    info.append(nameEl, metaEl);
    card.append(info);

    list.append(card);
  });

  appRoot.append(list);
}

async function openNewCharacterDialog() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const box = document.createElement("div");
  box.className = "modal-box modal-box--sheet-template";
  box.addEventListener("click", (e) => e.stopPropagation());

  const title = document.createElement("h3");
  title.textContent = "Create Character";

  const copy = document.createElement("p");
  copy.className = "modal-copy";
  copy.textContent = "Start with a blank sheet or choose a saved template.";

  const templateSelect = document.createElement("select");
  templateSelect.className = "input-group__control";
  templateSelect.disabled = true;

  const loadingOpt = document.createElement("option");
  loadingOpt.textContent = "Loading templates...";
  templateSelect.append(loadingOpt);

  const buttonRow = document.createElement("div");
  buttonRow.className = "modal-actions";

  const blankBtn = document.createElement("button");
  blankBtn.type = "button";
  blankBtn.className = "btn";
  blankBtn.textContent = "Blank Sheet";

  const templateBtn = document.createElement("button");
  templateBtn.type = "button";
  templateBtn.className = "btn btn--primary";
  templateBtn.textContent = "Use Template";
  templateBtn.disabled = true;

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn";
  cancelBtn.textContent = "Cancel";

  buttonRow.append(blankBtn, templateBtn, cancelBtn);
  box.append(title, copy, templateSelect, buttonRow);
  overlay.append(box);
  document.body.append(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);

  blankBtn.addEventListener("click", async () => {
    const id = await createCharacter({ ...createBlankCharacter(currentUserId()), layout: [] });
    close();
    openCharacter(id);
  });

  let templates = [];
  try {
    templates = await listSheetTemplates();
  } catch (err) {
    console.error("Failed to load sheet templates:", err);
  }

  templateSelect.innerHTML = "";
  if (templates.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No templates found";
    templateSelect.append(opt);
  } else {
    templates.forEach((template, index) => {
      const opt = document.createElement("option");
      opt.value = String(index);
      opt.textContent = `${template.name || "Unnamed Template"} (${template.scope === "global" ? "Global" : "Mine"})`;
      templateSelect.append(opt);
    });
    templateSelect.disabled = false;
    templateBtn.disabled = false;
  }

  templateBtn.addEventListener("click", async () => {
    const template = templates[Number(templateSelect.value)];
    if (!template) return;
    const sheetTabs = cloneLayout(template.sheetTabs || []);
    const layout = sheetTabs[0]?.layout || cloneLayout(template.layout);
    const characterData = {
      ...createBlankCharacter(currentUserId()),
      layout,
    };
    if (sheetTabs.length > 0) characterData.sheetTabs = sheetTabs;
    const id = await createCharacter(characterData);
    close();
    openCharacter(id);
  });
}

function cloneLayout(layout) {
  return JSON.parse(JSON.stringify(layout || []));
}

async function openCharacter(characterId) {
  const character = await loadCharacter(characterId);
  appRoot.innerHTML = "";
  backBtn.style.display = "";

  const sheetRoot = document.createElement("div");
  appRoot.append(sheetRoot);
  renderCustomSheet(sheetRoot, character, characterStore);
}

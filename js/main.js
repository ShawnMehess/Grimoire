// main.js — app entry point

import * as characterStore from "./state/characterStore.js";
import { onAuthChange, signIn, signOutUser, listMyCharacters, loadCharacter, createCharacter, deleteCharacter, currentUserId, listSheetTemplates } from "./state/characterStore.js";
import { createBlankCharacter } from "./data/schema.js";
import { renderCustomSheet } from "./render/customSheet.js";

const appRoot = document.getElementById("app-main");
const authArea = document.getElementById("auth-area");

onAuthChange(async (user) => {
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
  authArea.append(signOutBtn);

  await renderCharacterList();
});

async function renderCharacterList() {
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
  list.className = "card-list";

  characters.forEach(c => {
    const card = document.createElement("div");
    card.className = "card";
    card.style.display = "flex";
    card.style.justifyContent = "space-between";
    card.style.alignItems = "center";

    const info = document.createElement("div");
    info.style.cursor = "pointer";
    const blockCount = c.layout ? c.layout.length : 0;
    info.innerHTML = `<div class="card__title">${c.name || "Unnamed"}</div>
      <div class="card__meta">${blockCount} block${blockCount === 1 ? "" : "s"}</div>`;
    info.addEventListener("click", () => openCharacter(c.id));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn--danger btn--icon";
    deleteBtn.textContent = "✕";
    deleteBtn.title = "Delete character";
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const confirmed = window.confirm(`Delete "${c.name || "Unnamed"}"? This can't be undone.`);
      if (!confirmed) return;
      await deleteCharacter(c.id);
      renderCharacterList();
    });

    card.append(info, deleteBtn);
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

  const backBtn = document.createElement("button");
  backBtn.className = "btn";
  backBtn.textContent = "← Back";
  backBtn.addEventListener("click", renderCharacterList);
  appRoot.append(backBtn);

  const sheetRoot = document.createElement("div");
  appRoot.append(sheetRoot);
  renderCustomSheet(sheetRoot, character, characterStore);
}

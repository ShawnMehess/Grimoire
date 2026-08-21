// main.js — app entry point

import * as characterStore from "./state/characterStore.js";
import { onAuthChange, signIn, signOutUser, listMyCharacters, loadCharacter, createCharacter, deleteCharacter } from "./state/characterStore.js";
import { createBlankCharacter } from "./data/schema.js";
import { renderCharacterSheet } from "./render/characterSheet.js";

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
  newBtn.addEventListener("click", async () => {
    const { currentUserId } = await import("./state/characterStore.js");
    const id = await createCharacter(createBlankCharacter(currentUserId()));
    openCharacter(id);
  });
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
    info.innerHTML = `<div class="card__title">${c.name || "Unnamed"}</div>
      <div class="card__meta">${c.race || "?"} ${c.class || "?"} — Level ${c.level ?? 1}</div>`;
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
  renderCharacterSheet(sheetRoot, character, characterStore);
}

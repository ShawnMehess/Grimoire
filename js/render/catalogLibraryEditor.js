// catalogLibraryEditor.js
//
// A floating panel (same non-blocking pattern as formulaEditor.js and
// bundleLibraryEditor.js) for managing reusable CATALOGS: a named,
// tabbed list of things a player can browse and spend an in-sheet
// currency on — "Common Weapons," a spell list, whatever. Defined
// once here, then linked to from a "Catalog" field on any character
// (see the fieldType in blockModel.js and its handling in
// customSheet.js/catalogBrowser.js).
//
// A catalog is entirely self-contained — { id, name, tabs: [{ id,
// name, entries: [...] }] }, each entry { id, name, description,
// imageData, cost } — and doesn't reference any character's fields at
// all, unlike a bundle. The FIELD that links to a catalog is what
// separately holds which of THAT character's own fields is the
// "money" the catalog spends from.

const MAX_IMAGE_BYTES = 250_000; // same Firestore-doc-size reasoning as elsewhere

function newLocalId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function deepClone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function blankCatalogEntry() {
  return { id: null, scope: "personal", name: "", tabs: [] };
}

function readImageFile(file, onLoaded) {
  const reader = new FileReader();
  reader.onload = () => {
    if (reader.result.length > MAX_IMAGE_BYTES) {
      window.alert(
        "That image is large enough that it (plus the rest of this catalog) may not fit in a single Firestore document (1MB limit). It'll be applied, but saving might fail — try a smaller image if so."
      );
    }
    onLoaded(reader.result);
  };
  reader.readAsDataURL(file);
}

/**
 * @param store    the characterStore module — needs
 *                 listCatalogs/loadCatalog/saveCatalog/deleteCatalog
 * @param onChange  () => void, called after any save/delete
 */
export function openCatalogLibraryManager(store, onChange) {
  let catalogs = [];
  let selected = blankCatalogEntry();
  let isNew = true;
  let expandedTabIds = new Set();

  const overlay = document.createElement("div");
  overlay.className = "formula-overlay";

  const box = document.createElement("div");
  box.className = "modal-box modal-box--formula modal-box--bundle-library";
  box.addEventListener("click", (e) => e.stopPropagation());

  const titleRow = document.createElement("div");
  titleRow.className = "formula-editor-titlerow";
  const title = document.createElement("h3");
  title.textContent = "Catalogs";
  const closeX = document.createElement("button");
  closeX.type = "button";
  closeX.className = "formula-editor-close";
  closeX.title = "Close";
  closeX.textContent = "✕";
  closeX.addEventListener("click", close);
  titleRow.append(title, closeX);
  box.append(titleRow);

  const hint = document.createElement("p");
  hint.className = "modal-copy";
  hint.textContent = "Build a browsable, tabbed list of items/spells/whatever here, then link a Catalog field on a character's sheet to it.";
  box.append(hint);

  const body = document.createElement("div");
  body.className = "bundle-library-body";
  box.append(body);

  const listCol = document.createElement("div");
  listCol.className = "bundle-library-list";
  const editorCol = document.createElement("div");
  editorCol.className = "bundle-library-editor";
  body.append(listCol, editorCol);

  const actions = document.createElement("div");
  actions.className = "modal-actions bundle-library-actions";
  box.append(actions);

  function close() { overlay.remove(); }

  async function refresh() {
    catalogs = await store.listCatalogs();
    renderList();
  }

  function selectEntry(entry, entryIsNew) {
    selected = entry ? deepClone(entry) : blankCatalogEntry();
    isNew = entryIsNew;
    expandedTabIds = new Set();
    renderList();
    renderEditor();
  }

  function renderList() {
    listCol.innerHTML = "";

    const newBtn = document.createElement("button");
    newBtn.type = "button";
    newBtn.className = "btn btn--primary bundle-library-list__new";
    newBtn.textContent = "+ New Catalog";
    newBtn.addEventListener("click", () => selectEntry(null, true));
    listCol.append(newBtn);

    if (catalogs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "bundle-library-list__empty";
      empty.textContent = "No catalogs yet.";
      listCol.append(empty);
    }

    catalogs.forEach((cat) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "bundle-library-list__item" +
        (!isNew && selected.id === cat.id ? " active" : "");
      item.innerHTML = `<span>${cat.name || "Unnamed"}</span><span class="bundle-library-list__scope">${cat.scope === "global" ? "Global" : "Mine"}</span>`;
      item.addEventListener("click", () => selectEntry(cat, false));
      listCol.append(item);
    });
  }

  function renderEditor() {
    editorCol.innerHTML = "";
    actions.innerHTML = "";

    const nameRow = document.createElement("div");
    nameRow.className = "bundle-library-field-row";
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Name";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "e.g. Common Weapons";
    nameInput.value = selected.name;
    nameInput.addEventListener("input", () => { selected.name = nameInput.value; });
    nameRow.append(nameLabel, nameInput);
    editorCol.append(nameRow);

    const tabsHeader = document.createElement("div");
    tabsHeader.className = "dropdown-choices-editor__mods-header";
    tabsHeader.textContent = "Tabs";
    editorCol.append(tabsHeader);

    if (!selected.tabs) selected.tabs = [];
    selected.tabs.forEach((tab, tabIndex) => {
      if (!tab.id) tab.id = newLocalId();
      if (!tab.entries) tab.entries = [];
      editorCol.append(renderTabSection(tab, tabIndex));
    });

    const addTabBtn = document.createElement("button");
    addTabBtn.type = "button";
    addTabBtn.className = "btn formula-toolbar__btn";
    addTabBtn.textContent = "+ Add Tab";
    addTabBtn.addEventListener("click", () => {
      const tab = { id: newLocalId(), name: `Tab ${selected.tabs.length + 1}`, entries: [] };
      selected.tabs.push(tab);
      expandedTabIds.add(tab.id);
      renderEditor();
    });
    editorCol.append(addTabBtn);

    if (!isNew) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn--danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", async () => {
        if (!window.confirm(`Delete the "${selected.name || "Unnamed"}" catalog? Any field linked to it will show as unconfigured afterward.`)) return;
        await store.deleteCatalog(selected.scope, selected.id);
        selectEntry(null, true);
        await refresh();
        onChange();
      });
      actions.append(deleteBtn);
    }

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn--primary";
    saveBtn.textContent = isNew ? "Create (Mine)" : "Save";
    saveBtn.addEventListener("click", async () => {
      if (!selected.name.trim()) {
        window.alert("Give this catalog a name first.");
        return;
      }
      const scope = isNew ? "personal" : selected.scope;
      try {
        const id = await store.saveCatalog(scope, { ...selected, scope });
        selected.id = id;
        selected.scope = scope;
        isNew = false;
        await refresh();
        onChange();
      } catch (err) {
        window.alert(err.message || "Couldn't save that catalog.");
      }
    });
    actions.append(saveBtn);

    if (isNew) {
      const saveGlobalBtn = document.createElement("button");
      saveGlobalBtn.type = "button";
      saveGlobalBtn.className = "btn";
      saveGlobalBtn.title = "Requires admin rights";
      saveGlobalBtn.textContent = "Create (Global)";
      saveGlobalBtn.addEventListener("click", async () => {
        if (!selected.name.trim()) {
          window.alert("Give this catalog a name first.");
          return;
        }
        try {
          const id = await store.saveCatalog("global", { ...selected, scope: "global" });
          selected.id = id;
          selected.scope = "global";
          isNew = false;
          await refresh();
          onChange();
        } catch (err) {
          window.alert(err.message || "Couldn't save that catalog — only admins can create global catalogs.");
        }
      });
      actions.append(saveGlobalBtn);
    }
  }

  function renderTabSection(tab, tabIndex) {
    const section = document.createElement("div");
    section.className = "catalog-tab-section";

    const header = document.createElement("div");
    header.className = "catalog-tab-section__header";
    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "btn formula-toolbar__btn";
    expandBtn.textContent = expandedTabIds.has(tab.id) ? "▾" : "▸";
    expandBtn.addEventListener("click", () => {
      if (expandedTabIds.has(tab.id)) expandedTabIds.delete(tab.id);
      else expandedTabIds.add(tab.id);
      renderEditor();
    });
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "catalog-tab-section__name";
    nameInput.value = tab.name;
    nameInput.placeholder = "Tab name";
    nameInput.addEventListener("input", () => { tab.name = nameInput.value; });
    const countBadge = document.createElement("span");
    countBadge.className = "catalog-tab-section__count";
    countBadge.textContent = `${tab.entries.length} item${tab.entries.length === 1 ? "" : "s"}`;
    const removeTabBtn = document.createElement("button");
    removeTabBtn.type = "button";
    removeTabBtn.className = "btn formula-toolbar__btn";
    removeTabBtn.textContent = "✕";
    removeTabBtn.addEventListener("click", () => {
      if (tab.entries.length > 0 && !window.confirm(`Delete tab "${tab.name}" and its ${tab.entries.length} item(s)?`)) return;
      selected.tabs.splice(tabIndex, 1);
      renderEditor();
    });
    header.append(expandBtn, nameInput, countBadge, removeTabBtn);
    section.append(header);

    if (expandedTabIds.has(tab.id)) {
      tab.entries.forEach((entry, entryIndex) => {
        section.append(renderEntryRow(tab, entry, entryIndex));
      });
      const addEntryBtn = document.createElement("button");
      addEntryBtn.type = "button";
      addEntryBtn.className = "btn formula-toolbar__btn";
      addEntryBtn.textContent = "+ Add Item";
      addEntryBtn.addEventListener("click", () => {
        tab.entries.push({ id: newLocalId(), name: "", description: "", imageData: null, cost: 0 });
        renderEditor();
      });
      section.append(addEntryBtn);
    }

    return section;
  }

  function renderEntryRow(tab, entry, entryIndex) {
    const row = document.createElement("div");
    row.className = "catalog-entry-row";

    const thumb = document.createElement("div");
    thumb.className = "catalog-entry-row__thumb";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.hidden = true;
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (!file) return;
      readImageFile(file, (dataUrl) => {
        entry.imageData = dataUrl;
        renderEditor();
      });
    });
    if (entry.imageData) {
      const img = document.createElement("img");
      img.src = entry.imageData;
      thumb.append(img);
    } else {
      thumb.textContent = "+";
    }
    thumb.addEventListener("click", () => fileInput.click());
    thumb.append(fileInput);

    const fields = document.createElement("div");
    fields.className = "catalog-entry-row__fields";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Item name";
    nameInput.value = entry.name;
    nameInput.addEventListener("input", () => { entry.name = nameInput.value; });

    const descInput = document.createElement("input");
    descInput.type = "text";
    descInput.placeholder = "Description";
    descInput.value = entry.description || "";
    descInput.addEventListener("input", () => { entry.description = descInput.value; });

    const costInput = document.createElement("input");
    costInput.type = "number";
    costInput.placeholder = "Cost";
    costInput.value = Number.isFinite(entry.cost) ? entry.cost : 0;
    costInput.addEventListener("input", () => { entry.cost = Number(costInput.value) || 0; });

    fields.append(nameInput, descInput, costInput);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn formula-toolbar__btn";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      tab.entries.splice(entryIndex, 1);
      renderEditor();
    });

    row.append(thumb, fields, removeBtn);
    return row;
  }

  overlay.append(box);
  document.body.append(overlay);
  refresh().then(() => renderEditor());
}

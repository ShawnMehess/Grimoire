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
  return { id: null, scope: "personal", name: "", archetype: blankArchetype(), tabs: [] };
}

// --- Item archetypes ---------------------------------------------------
// Every item in a catalog gets three configurable sections (Acquisition
// Costs / Requirements / Effects) plus a fixed Description (handled
// separately below — it's always just portrait + text, never
// archetype-configurable). A catalog defines the base rows for those
// three sections; a tab or an individual item can add rows of its own
// or hide inherited ones, but never remove a whole section. Diffs (not
// copies) are what tabs/items store, so the catalog's own rows stay the
// single source of truth for anything not explicitly touched.

export const ARCHETYPE_SECTIONS = [
  ["acquisitionCosts", "Acquisition Costs"],
  ["requirements", "Requirements"],
  ["effects", "Effects"],
];

function blankArchetypeRow(label) {
  return { id: newLocalId(), label, kind: "text" };
}

function blankArchetype() {
  return {
    acquisitionCosts: [blankArchetypeRow("Cost")],
    requirements: [blankArchetypeRow("Cooldown")],
    effects: [],
  };
}

function blankRowDiff() {
  return { added: [], removed: [] };
}

function blankDiffSet() {
  return { acquisitionCosts: blankRowDiff(), requirements: blankRowDiff(), effects: blankRowDiff() };
}

// Merges a catalog's base rows for one section with a tab's diff and
// (optionally) an item's diff on top of that, in that order, to get
// the actual set of fields an item ends up with. Pass entry as null to
// get just the catalog+tab-level merge (used when deciding what an
// item "inherits" before its own diff is applied).
export function effectiveSectionRows(cat, tab, entry, sectionKey) {
  const catRows = (cat.archetype && cat.archetype[sectionKey]) || [];
  const tabDiff = (tab && tab.archetypeDiff && tab.archetypeDiff[sectionKey]) || blankRowDiff();
  let rows = catRows.filter((r) => !tabDiff.removed.includes(r.id));
  rows = rows.concat(tabDiff.added);
  if (entry) {
    const entryDiff = (entry.archetypeDiff && entry.archetypeDiff[sectionKey]) || blankRowDiff();
    rows = rows.filter((r) => !entryDiff.removed.includes(r.id));
    rows = rows.concat(entryDiff.added);
  }
  return rows;
}

// Backfills anything a catalog saved before archetypes existed (or
// created mid-edit) is missing, and best-effort migrates the old flat
// `entry.cost` number into the first Acquisition Costs field's value.
export function ensureCatalogShape(cat) {
  if (!cat.archetype) cat.archetype = blankArchetype();
  ARCHETYPE_SECTIONS.forEach(([key]) => {
    if (!Array.isArray(cat.archetype[key])) cat.archetype[key] = [];
    cat.archetype[key].forEach((row) => {
      if (!row.id) row.id = newLocalId();
      if (!row.kind) row.kind = "text";
    });
  });
  if (!cat.tabs) cat.tabs = [];
  cat.tabs.forEach((tab) => {
    if (!tab.id) tab.id = newLocalId();
    if (!tab.entries) tab.entries = [];
    if (!tab.archetypeDiff) tab.archetypeDiff = blankDiffSet();
    ARCHETYPE_SECTIONS.forEach(([key]) => {
      if (!tab.archetypeDiff[key]) tab.archetypeDiff[key] = blankRowDiff();
      if (!Array.isArray(tab.archetypeDiff[key].added)) tab.archetypeDiff[key].added = [];
      if (!Array.isArray(tab.archetypeDiff[key].removed)) tab.archetypeDiff[key].removed = [];
      tab.archetypeDiff[key].added.forEach((row) => {
        if (!row.id) row.id = newLocalId();
        if (!row.kind) row.kind = "text";
      });
    });
    tab.entries.forEach((entry) => {
      if (!entry.id) entry.id = newLocalId();
      if (!entry.archetypeDiff) entry.archetypeDiff = blankDiffSet();
      ARCHETYPE_SECTIONS.forEach(([key]) => {
        if (!entry.archetypeDiff[key]) entry.archetypeDiff[key] = blankRowDiff();
        if (!Array.isArray(entry.archetypeDiff[key].added)) entry.archetypeDiff[key].added = [];
        if (!Array.isArray(entry.archetypeDiff[key].removed)) entry.archetypeDiff[key].removed = [];
        entry.archetypeDiff[key].added.forEach((row) => {
          if (!row.id) row.id = newLocalId();
          if (!row.kind) row.kind = "text";
        });
      });
      if (!entry.fieldValues) entry.fieldValues = {};
      if (entry.cost !== undefined) {
        if (Object.keys(entry.fieldValues).length === 0) {
          const firstCostRow = effectiveSectionRows(cat, tab, entry, "acquisitionCosts")[0];
          if (firstCostRow) entry.fieldValues[firstCostRow.id] = String(entry.cost);
        }
        delete entry.cost;
      }
    });
  });
  return cat;
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

// --- Linking a row to a sheet field -------------------------------------
// Dragging a field in from the sidebar (or dropping it directly onto an
// existing row to relink it) captures a plain-data snapshot of that
// field's shape — not a live reference — since a catalog is shared
// across characters and has no single field to stay in sync with. The
// snapshot is just enough to render the SAME kind of widget (radio
// buttons, a dropdown, one specific checkbox) when setting a value on
// an item, per the "click the leftmost radio button" example: clicking
// it records a value on the ITEM, it never touches the character's own
// field.
function linkFromField(field, checkboxIndex) {
  const link = { fieldName: field.label || "Field", fieldType: field.fieldType };
  if (field.fieldType === "radio") {
    link.options = field.options || 1;
  } else if (field.fieldType === "checkbox") {
    link.options = field.options || 1;
    if (checkboxIndex !== null && checkboxIndex !== undefined) link.checkboxIndex = checkboxIndex;
  } else if (field.fieldType === "dropdown") {
    link.choices = (field.choices || []).map((c) => ({ id: c.id, text: c.text }));
  }
  return link;
}

function linkedRowDisplayName(link) {
  if (!link) return "";
  return link.checkboxIndex !== null && link.checkboxIndex !== undefined
    ? `${link.fieldName} ${link.checkboxIndex + 1}`
    : link.fieldName;
}

// Wires dragover/drop listeners for the "application/x-sheet-field"
// payload onto `el`, calling onFieldDropped(field, checkboxIndex) with
// the resolved field object. A no-op (drop target never activates) if
// no resolveField function was passed to the manager — keeps this
// gracefully degrading rather than throwing if a caller forgets it.

/* @param store    the characterStore module — needs
 *                 listCatalogs/loadCatalog/saveCatalog/deleteCatalog
 * @param onChange  () => void, called after any save/delete
 * @param resolveField  (fieldId) => field object or null — lets an
 *                 archetype row be dragged in from the sidebar (same
 *                 "application/x-sheet-field" payload the page grid
 *                 and formula editor already use) and rendered/edited
 *                 as that field's own widget (radio buttons, a
 *                 dropdown, ...) instead of a bare text box. Resolved
 *                 against whichever character has the sheet editor
 *                 open — since a catalog itself is character-
 *                 independent, this is only used to build a labeled
 *                 snapshot of the field's shape (name, type, option
 *                 count/choices) at link time, not a live reference.
 */
export function openCatalogLibraryManager(store, onChange, resolveField) {
  let catalogs = [];
  let selected = ensureCatalogShape(blankCatalogEntry());
  let isNew = true;
  let expandedTabIds = new Set();
  let expandedTabFieldsIds = new Set();
  let expandedEntryIds = new Set();

  // Wires dragover/drop listeners for the "application/x-sheet-field"
  // payload onto `el`, calling onFieldDropped(field, checkboxIndex)
  // with the resolved field object. A no-op (drop target never
  // activates) if no resolveField function was passed in — degrades
  // gracefully rather than throwing if a caller forgets it.
  function makeFieldDropTarget(el, onFieldDropped) {
    if (!resolveField) return;
    el.classList.add("catalog-archetype__drop-target");
    el.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes("application/x-sheet-field")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      el.classList.add("catalog-archetype__drop-target--active");
    });
    el.addEventListener("dragleave", () => {
      el.classList.remove("catalog-archetype__drop-target--active");
    });
    el.addEventListener("drop", (e) => {
      el.classList.remove("catalog-archetype__drop-target--active");
      const payload = e.dataTransfer.getData("application/x-sheet-field");
      if (!payload) return;
      e.preventDefault();
      let parsed;
      try { parsed = JSON.parse(payload); } catch { return; }
      const field = resolveField(parsed.fieldId);
      if (!field) {
        window.alert("Couldn't find that field — try dragging it in again.");
        return;
      }
      onFieldDropped(field, parsed.checkboxIndex);
    });
  }

  // Renders the actual input for an item's field VALUE — the linked
  // field's own widget (radio buttons / checkboxes / a dropdown) when
  // the row is linked, or a plain text box otherwise. Button-style
  // widgets re-render the whole editor on click (cheap, and needed to
  // show the new selected state); the text fallback mutates silently
  // like every other text input in this file, so typing doesn't lose
  // focus on every keystroke.
  function renderValueWidget(row, entry) {
    const value = entry.fieldValues[row.id];
    const link = row.kind === "linked" ? row.link : null;

    if (link && link.fieldType === "radio") {
      const wrap = document.createElement("div");
      wrap.className = "catalog-archetype__widget";
      const count = link.options || 1;
      for (let i = 1; i <= count; i++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "catalog-archetype__radio-btn" + (Number(value) === i ? " active" : "");
        btn.title = `Option ${i}`;
        btn.addEventListener("click", () => {
          entry.fieldValues[row.id] = Number(value) === i ? undefined : i;
          renderEditor();
        });
        wrap.append(btn);
      }
      return wrap;
    }

    if (link && link.fieldType === "checkbox" && (link.checkboxIndex === null || link.checkboxIndex === undefined)) {
      const wrap = document.createElement("div");
      wrap.className = "catalog-archetype__widget";
      const count = link.options || 1;
      const arr = Array.isArray(value) ? value.slice() : new Array(count).fill(false);
      for (let i = 0; i < count; i++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "catalog-archetype__radio-btn" + (arr[i] ? " active" : "");
        btn.title = `Option ${i + 1}`;
        btn.addEventListener("click", () => {
          arr[i] = !arr[i];
          entry.fieldValues[row.id] = arr;
          renderEditor();
        });
        wrap.append(btn);
      }
      return wrap;
    }

    if (link && link.fieldType === "checkbox") {
      // A single dragged-in checkbox (the "↳ Field N" sub-row in the
      // sidebar) — one on/off toggle, not a whole row of them.
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "catalog-archetype__radio-btn" + (value ? " active" : "");
      btn.textContent = value ? "✓" : "";
      btn.addEventListener("click", () => {
        entry.fieldValues[row.id] = !value;
        renderEditor();
      });
      return btn;
    }

    if (link && link.fieldType === "dropdown") {
      const select = document.createElement("select");
      select.className = "catalog-archetype__widget-select";
      const blankOpt = document.createElement("option");
      blankOpt.value = "";
      blankOpt.textContent = "—";
      select.append(blankOpt);
      (link.choices || []).forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.text;
        if (c.id === value) opt.selected = true;
        select.append(opt);
      });
      select.addEventListener("change", () => {
        entry.fieldValues[row.id] = select.value;
        renderEditor();
      });
      return select;
    }

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Value";
    input.value = value || "";
    input.addEventListener("input", () => { entry.fieldValues[row.id] = input.value; });
    return input;
  }

  const overlay = document.createElement("div");
  overlay.className = "formula-overlay";

  const box = document.createElement("div");
  box.className = "modal-box modal-box--formula modal-box--catalog-library";
  box.addEventListener("click", (e) => e.stopPropagation());

  // Rather than the fixed/viewport-relative sizing formula.css normally
  // uses for this floating-panel pattern, this panel is pinned to
  // exactly cover the page grid's own on-screen rect — same top/left/
  // width/height the grid itself occupies — so it fills that whole
  // area (leaving only the block-frame list and the toolbar above it
  // visible) instead of floating as a narrow column over it. Recomputed
  // on resize since the grid's rect can change (e.g. window resize
  // changes how much of it fits on screen).
  function positionOverGrid() {
    const grid = document.querySelector(".page-grid-scroll");
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    box.style.top = `${rect.top}px`;
    box.style.left = `${rect.left}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }
  window.addEventListener("resize", positionOverGrid);

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

  function close() {
    window.removeEventListener("resize", positionOverGrid);
    overlay.remove();
  }

  let listLoadError = null;

  async function refresh() {
    try {
      catalogs = await store.listCatalogs();
      listLoadError = null;
    } catch (err) {
      console.error("Failed to load catalogs:", err);
      catalogs = [];
      listLoadError = err.message || "Couldn't load catalogs — see the browser console for details.";
    }
    renderList();
  }

  function selectEntry(entry, entryIsNew) {
    selected = ensureCatalogShape(entry ? deepClone(entry) : blankCatalogEntry());
    isNew = entryIsNew;
    expandedTabIds = new Set();
    expandedTabFieldsIds = new Set();
    expandedEntryIds = new Set();
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

    if (listLoadError) {
      const error = document.createElement("div");
      error.className = "bundle-library-list__empty";
      error.style.color = "var(--color-negative)";
      error.textContent = listLoadError;
      listCol.append(error);
      // Existing catalogs may just be unreachable (e.g. a Firestore
      // rules/permissions issue) — but creating a brand new one is a
      // separate operation that doesn't depend on this list load
      // having worked, so the rest of the panel still opens normally.
    } else if (catalogs.length === 0) {
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
      item.innerHTML = `<span class="catalog-list-item__name">${cat.name || "Unnamed"}</span><span class="bundle-library-list__scope">${cat.scope === "global" ? "Global" : "Mine"}</span>`;
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

    editorCol.append(renderArchetypeSection());

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
      const tab = { id: newLocalId(), name: `Tab ${selected.tabs.length + 1}`, entries: [], archetypeDiff: blankDiffSet() };
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

  function renderArchetypeSection() {
    const wrap = document.createElement("div");
    wrap.className = "catalog-archetype";

    const heading = document.createElement("div");
    heading.className = "dropdown-choices-editor__mods-header";
    heading.textContent = "Item Archetype";
    wrap.append(heading);

    const hint = document.createElement("p");
    hint.className = "modal-copy catalog-archetype__hint";
    hint.textContent = "Every item in this catalog gets these three sections (plus a portrait + description, always included). Add whatever fields items here need — tabs and individual items can add or hide fields, but can't remove a whole section.";
    wrap.append(hint);

    ARCHETYPE_SECTIONS.forEach(([key, title]) => {
      wrap.append(renderArchetypeFieldGroup(title, key));
    });

    return wrap;
  }

  // A single editable row DEFINITION (label + optional link) — used
  // for catalog-level rows and any tab/item's own added rows. Doubles
  // as a drop target: dropping a sheet field directly onto an existing
  // row relinks it in place (keeping its id, so any values already
  // set against it by tabs/items downstream aren't orphaned).
  function renderDefinitionRow(row, onRemove) {
    const rowEl = document.createElement("div");
    rowEl.className = "catalog-archetype__row";

    const defWrap = document.createElement("div");
    defWrap.className = "catalog-archetype__row-def";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.placeholder = "Field name";
    labelInput.value = row.label;
    labelInput.addEventListener("input", () => { row.label = labelInput.value; });
    defWrap.append(labelInput);

    if (row.kind === "linked" && row.link) {
      const badge = document.createElement("span");
      badge.className = "catalog-archetype__link-badge";
      badge.textContent = `🔗 ${linkedRowDisplayName(row.link)}`;
      const unlinkBtn = document.createElement("button");
      unlinkBtn.type = "button";
      unlinkBtn.className = "btn formula-toolbar__btn";
      unlinkBtn.textContent = "Unlink";
      unlinkBtn.addEventListener("click", () => {
        row.kind = "text";
        row.link = null;
        renderEditor();
      });
      defWrap.append(badge, unlinkBtn);
    }
    rowEl.append(defWrap);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn formula-toolbar__btn";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", onRemove);
    rowEl.append(removeBtn);

    makeFieldDropTarget(rowEl, (field, checkboxIndex) => {
      row.kind = "linked";
      row.link = linkFromField(field, checkboxIndex);
      if (!row.label) row.label = linkedRowDisplayName(row.link);
      renderEditor();
    });

    return rowEl;
  }

  // The "+ Add Field" button doubles as a drop target — click it to
  // add a plain unlinked text field, or drag a sheet field onto it to
  // add one already linked to that field.
  function renderAddFieldButton(onAddBlank, onAddLinked) {
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn formula-toolbar__btn";
    addBtn.textContent = "+ Add Field";
    if (resolveField) addBtn.title = "Click to add a plain field, or drag a sheet field here to link one";
    addBtn.addEventListener("click", onAddBlank);
    makeFieldDropTarget(addBtn, onAddLinked);
    return addBtn;
  }

  function renderArchetypeFieldGroup(title, sectionKey) {
    const group = document.createElement("div");
    group.className = "catalog-archetype__group";

    const label = document.createElement("div");
    label.className = "catalog-archetype__group-title";
    label.textContent = title;
    group.append(label);

    selected.archetype[sectionKey].forEach((row, rowIndex) => {
      group.append(renderDefinitionRow(row, () => {
        selected.archetype[sectionKey].splice(rowIndex, 1);
        renderEditor();
      }));
    });

    group.append(renderAddFieldButton(
      () => {
        selected.archetype[sectionKey].push(blankArchetypeRow(""));
        renderEditor();
      },
      (field, checkboxIndex) => {
        const row = blankArchetypeRow("");
        row.kind = "linked";
        row.link = linkFromField(field, checkboxIndex);
        row.label = linkedRowDisplayName(row.link);
        selected.archetype[sectionKey].push(row);
        renderEditor();
      }
    ));

    return group;
  }

  // Tab-level override: for each catalog-defined row, a Hide/Show
  // toggle (recorded as a diff, not a delete, so re-showing it later
  // doesn't lose anything); plus this tab's own added rows, which are
  // fully editable/removable since the tab owns them outright.
  function renderTabFieldsPanel(tab) {
    const wrap = document.createElement("div");
    wrap.className = "catalog-archetype catalog-archetype--override";

    const hint = document.createElement("p");
    hint.className = "modal-copy catalog-archetype__hint";
    hint.textContent = "Override which fields items in this tab get — hide ones this tab doesn't need, or add ones only this tab needs.";
    wrap.append(hint);

    ARCHETYPE_SECTIONS.forEach(([key, title]) => {
      wrap.append(renderDiffFieldGroup(title, selected.archetype[key], tab.archetypeDiff[key]));
    });

    return wrap;
  }

  // Shared by the tab-level panel above — lists inherited rows with a
  // Hide/Show toggle, then this level's own added rows as fully
  // editable (and drag-linkable) definitions.
  function renderDiffFieldGroup(title, baseRows, diff) {
    const group = document.createElement("div");
    group.className = "catalog-archetype__group";
    const label = document.createElement("div");
    label.className = "catalog-archetype__group-title";
    label.textContent = title;
    group.append(label);

    baseRows.forEach((row) => {
      const hidden = diff.removed.includes(row.id);
      const rowEl = document.createElement("div");
      rowEl.className = "catalog-archetype__row" + (hidden ? " catalog-archetype__row--hidden" : "");
      const nameSpan = document.createElement("span");
      nameSpan.className = "catalog-archetype__row-label";
      nameSpan.textContent = row.kind === "linked" ? `🔗 ${row.label || linkedRowDisplayName(row.link)}` : (row.label || "(unnamed)");
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "btn formula-toolbar__btn";
      toggleBtn.textContent = hidden ? "Show" : "Hide";
      toggleBtn.addEventListener("click", () => {
        if (hidden) diff.removed = diff.removed.filter((id) => id !== row.id);
        else diff.removed.push(row.id);
        renderEditor();
      });
      rowEl.append(nameSpan, toggleBtn);
      group.append(rowEl);
    });

    diff.added.forEach((row, rowIndex) => {
      group.append(renderDefinitionRow(row, () => {
        diff.added.splice(rowIndex, 1);
        renderEditor();
      }));
    });

    group.append(renderAddFieldButton(
      () => {
        diff.added.push(blankArchetypeRow(""));
        renderEditor();
      },
      (field, checkboxIndex) => {
        const row = blankArchetypeRow("");
        row.kind = "linked";
        row.link = linkFromField(field, checkboxIndex);
        row.label = linkedRowDisplayName(row.link);
        diff.added.push(row);
        renderEditor();
      }
    ));

    return group;
  }

  // Item-level: same Hide/Show pattern as the tab panel for inherited
  // rows, but rendered with the row's own VALUE widget (a snapshot,
  // e.g. "1" for a single level-3 spell slot — not a live link to the
  // character's own field) instead of a Hide/Show + text box. Rows
  // this item adds itself get both a definition row (name/link) and a
  // value widget, since the item owns that field outright.
  function renderItemFieldsSection(title, sectionKey, tab, entry) {
    const group = document.createElement("div");
    group.className = "catalog-archetype__group";
    const label = document.createElement("div");
    label.className = "catalog-archetype__group-title";
    label.textContent = title;
    group.append(label);

    const inheritedRows = effectiveSectionRows(selected, tab, null, sectionKey);
    const entryDiff = entry.archetypeDiff[sectionKey];

    inheritedRows.forEach((row) => {
      const hidden = entryDiff.removed.includes(row.id);
      const rowEl = document.createElement("div");
      rowEl.className = "catalog-archetype__value-row" + (hidden ? " catalog-archetype__row--hidden" : "");
      const nameSpan = document.createElement("span");
      nameSpan.className = "catalog-archetype__row-label";
      nameSpan.textContent = row.kind === "linked" ? `🔗 ${row.label || linkedRowDisplayName(row.link)}` : (row.label || "(unnamed)");
      const widget = hidden ? document.createElement("span") : renderValueWidget(row, entry);
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "btn formula-toolbar__btn";
      toggleBtn.textContent = hidden ? "Show" : "Hide";
      toggleBtn.addEventListener("click", () => {
        if (hidden) {
          entryDiff.removed = entryDiff.removed.filter((id) => id !== row.id);
        } else {
          entryDiff.removed.push(row.id);
          delete entry.fieldValues[row.id];
        }
        renderEditor();
      });
      rowEl.append(nameSpan, widget, toggleBtn);
      group.append(rowEl);
    });

    entryDiff.added.forEach((row, rowIndex) => {
      const rowEl = document.createElement("div");
      rowEl.className = "catalog-archetype__value-row";
      rowEl.append(renderDefinitionRow(row, () => {
        entryDiff.added.splice(rowIndex, 1);
        delete entry.fieldValues[row.id];
        renderEditor();
      }));
      rowEl.append(renderValueWidget(row, entry));
      group.append(rowEl);
    });

    group.append(renderAddFieldButton(
      () => {
        entryDiff.added.push(blankArchetypeRow(""));
        renderEditor();
      },
      (field, checkboxIndex) => {
        const row = blankArchetypeRow("");
        row.kind = "linked";
        row.link = linkFromField(field, checkboxIndex);
        row.label = linkedRowDisplayName(row.link);
        entryDiff.added.push(row);
        renderEditor();
      }
    ));

    return group;
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
    const fieldsBtn = document.createElement("button");
    fieldsBtn.type = "button";
    fieldsBtn.className = "btn formula-toolbar__btn";
    fieldsBtn.title = "Add or hide archetype fields for items in this tab";
    fieldsBtn.textContent = "Fields";
    fieldsBtn.addEventListener("click", () => {
      if (expandedTabFieldsIds.has(tab.id)) expandedTabFieldsIds.delete(tab.id);
      else expandedTabFieldsIds.add(tab.id);
      renderEditor();
    });
    const removeTabBtn = document.createElement("button");
    removeTabBtn.type = "button";
    removeTabBtn.className = "btn formula-toolbar__btn";
    removeTabBtn.textContent = "✕";
    removeTabBtn.addEventListener("click", () => {
      if (tab.entries.length > 0 && !window.confirm(`Delete tab "${tab.name}" and its ${tab.entries.length} item(s)?`)) return;
      selected.tabs.splice(tabIndex, 1);
      renderEditor();
    });
    header.append(expandBtn, nameInput, countBadge, fieldsBtn, removeTabBtn);
    section.append(header);

    if (expandedTabFieldsIds.has(tab.id)) {
      section.append(renderTabFieldsPanel(tab));
    }

    if (expandedTabIds.has(tab.id)) {
      tab.entries.forEach((entry, entryIndex) => {
        section.append(renderEntryCard(tab, entry, entryIndex));
      });
      const addEntryBtn = document.createElement("button");
      addEntryBtn.type = "button";
      addEntryBtn.className = "btn formula-toolbar__btn";
      addEntryBtn.textContent = "+ Add Item";
      addEntryBtn.addEventListener("click", () => {
        tab.entries.push({ id: newLocalId(), name: "", description: "", imageData: null, archetypeDiff: blankDiffSet(), fieldValues: {} });
        renderEditor();
      });
      section.append(addEntryBtn);
    }

    return section;
  }

  function renderEntryCard(tab, entry, entryIndex) {
    const card = document.createElement("div");
    card.className = "catalog-entry-card";

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

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "catalog-entry-row__name";
    nameInput.placeholder = "Item name";
    nameInput.value = entry.name;
    nameInput.addEventListener("input", () => { entry.name = nameInput.value; });

    const expanded = expandedEntryIds.has(entry.id);
    const expandBtn = document.createElement("button");
    expandBtn.type = "button";
    expandBtn.className = "btn formula-toolbar__btn catalog-entry-row__expand";
    expandBtn.textContent = expanded ? "▾ Details" : "▸ Details";
    expandBtn.addEventListener("click", () => {
      if (expanded) expandedEntryIds.delete(entry.id);
      else expandedEntryIds.add(entry.id);
      renderEditor();
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn formula-toolbar__btn catalog-entry-row__remove";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      tab.entries.splice(entryIndex, 1);
      renderEditor();
    });

    row.append(thumb, nameInput, expandBtn, removeBtn);
    card.append(row);

    if (expanded) {
      const panel = document.createElement("div");
      panel.className = "catalog-entry-card__panel";

      const descGroup = document.createElement("div");
      descGroup.className = "catalog-archetype__group";
      const descLabel = document.createElement("div");
      descLabel.className = "catalog-archetype__group-title";
      descLabel.textContent = "Description";
      const descInput = document.createElement("textarea");
      descInput.className = "catalog-entry-card__description";
      descInput.placeholder = "Flavor text / description";
      descInput.value = entry.description || "";
      descInput.addEventListener("input", () => { entry.description = descInput.value; });
      descGroup.append(descLabel, descInput);
      panel.append(descGroup);

      ARCHETYPE_SECTIONS.forEach(([key, title]) => {
        panel.append(renderItemFieldsSection(title, key, tab, entry));
      });

      card.append(panel);
    }

    return card;
  }

  overlay.append(box);
  document.body.append(overlay);
  positionOverGrid();
  refresh().then(() => renderEditor());
}

// bundleLibraryEditor.js
//
// A floating panel (same non-blocking pattern as formulaEditor.js —
// see the .formula-overlay comment in custom-sheet.css) for managing
// a reusable LIBRARY of bundles: "Elf", "Fighter", etc., defined once
// and applicable to any dropdown choice on any character, rather than
// hand-built fresh every time. See the header comment on the bundle
// library functions in characterStore.js for why a library bundle
// references its targets by NAME ("Strength") instead of by field id
// the way an in-character bundle does — it has to work across many
// different characters' sheets, each with their own field ids.
//
// This panel only edits the library itself. Attaching a library
// bundle to an actual dropdown choice — which resolves those names
// against one specific character's fields — happens from the
// per-choice "Modifiers" editor in customSheet.js
// (applyBundleLibraryToChoice).

const MODIFIER_OPS = [
  { value: "add", label: "+ Add" },
  { value: "subtract", label: "− Subtract" },
  { value: "multiply", label: "× Multiply" },
  { value: "set", label: "= Set to" },
];

function deepClone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function newLocalId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function blankLibraryEntry() {
  return {
    id: null,
    scope: "personal",
    name: "",
    category: "",
    statModifiers: [],
    dropdownAccess: [],
  };
}

/**
 * @param store    the characterStore module (same object customSheet.js
 *                 already gets as its `store` param) — needs
 *                 listBundleLibraries/saveBundleLibrary/deleteBundleLibrary
 * @param onChange  () => void, called after any save/delete, so the
 *                  caller can refresh anything that reads the library
 *                  list (e.g. the "Apply from Library" picker)
 */
export function openBundleLibraryManager(store, onChange) {
  let libraries = [];
  let selected = blankLibraryEntry();
  let isNew = true;

  const overlay = document.createElement("div");
  overlay.className = "formula-overlay";

  const box = document.createElement("div");
  box.className = "modal-box modal-box--formula modal-box--bundle-library";
  box.addEventListener("click", (e) => e.stopPropagation());

  const titleRow = document.createElement("div");
  titleRow.className = "formula-editor-titlerow";
  const title = document.createElement("h3");
  title.textContent = "Bundle Libraries";
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
  hint.textContent = "Define reusable bundles here (by field NAME, e.g. \"Strength\" — not tied to any one character), then apply them to a dropdown choice from that choice's own Modifiers editor.";
  box.append(hint);

  const body = document.createElement("div");
  body.className = "bundle-library-body";
  box.append(body);

  const listCol = document.createElement("div");
  listCol.className = "bundle-library-list";
  const editorCol = document.createElement("div");
  editorCol.className = "bundle-library-editor";
  body.append(listCol, editorCol);

  function close() { overlay.remove(); }

  async function refresh() {
    libraries = await store.listBundleLibraries();
    renderList();
  }

  function selectEntry(entry, entryIsNew) {
    selected = entry ? deepClone(entry) : blankLibraryEntry();
    isNew = entryIsNew;
    renderList();
    renderEditor();
  }

  function renderList() {
    listCol.innerHTML = "";

    const newBtn = document.createElement("button");
    newBtn.type = "button";
    newBtn.className = "btn btn--primary bundle-library-list__new";
    newBtn.textContent = "+ New Bundle";
    newBtn.addEventListener("click", () => selectEntry(null, true));
    listCol.append(newBtn);

    const grouped = new Map();
    libraries.forEach((lib) => {
      const cat = lib.category || "Uncategorized";
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat).push(lib);
    });

    grouped.forEach((entries, category) => {
      const groupLabel = document.createElement("div");
      groupLabel.className = "bundle-library-list__group";
      groupLabel.textContent = category;
      listCol.append(groupLabel);

      entries.forEach((lib) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "bundle-library-list__item" +
          (!isNew && selected.id === lib.id ? " active" : "");
        item.innerHTML = `<span>${lib.name || "Unnamed"}</span><span class="bundle-library-list__scope">${lib.scope === "global" ? "Global" : "Mine"}</span>`;
        item.addEventListener("click", () => selectEntry(lib, false));
        listCol.append(item);
      });
    });

    if (libraries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "bundle-library-list__empty";
      empty.textContent = "No bundles yet.";
      listCol.append(empty);
    }
  }

  function renderEditor() {
    editorCol.innerHTML = "";

    const nameRow = document.createElement("div");
    nameRow.className = "bundle-library-field-row";
    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Name";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "e.g. Elf";
    nameInput.value = selected.name;
    nameInput.addEventListener("input", () => { selected.name = nameInput.value; });
    nameRow.append(nameLabel, nameInput);

    const catRow = document.createElement("div");
    catRow.className = "bundle-library-field-row";
    const catLabel = document.createElement("label");
    catLabel.textContent = "Category";
    const catInput = document.createElement("input");
    catInput.type = "text";
    catInput.placeholder = "e.g. Race";
    catInput.value = selected.category;
    catInput.addEventListener("input", () => { selected.category = catInput.value; });
    catRow.append(catLabel, catInput);

    editorCol.append(nameRow, catRow);

    // --- Stat modifiers ---
    const statHeader = document.createElement("div");
    statHeader.className = "dropdown-choices-editor__mods-header";
    statHeader.textContent = "Stat Modifiers";
    editorCol.append(statHeader);

    if (!selected.statModifiers) selected.statModifiers = [];
    selected.statModifiers.forEach((mod, i) => {
      if (!mod.id) mod.id = newLocalId();
      const row = document.createElement("div");
      row.className = "bundle-mod-row";

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = "Stat name (e.g. Strength)";
      nameInput.value = mod.targetFieldName || "";
      nameInput.addEventListener("input", () => { mod.targetFieldName = nameInput.value; });

      const opSelect = document.createElement("select");
      MODIFIER_OPS.forEach(({ value, label }) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        if (value === mod.op) opt.selected = true;
        opSelect.append(opt);
      });
      opSelect.addEventListener("change", () => { mod.op = opSelect.value; });

      const valueInput = document.createElement("input");
      valueInput.type = "number";
      valueInput.value = Number.isFinite(mod.value) ? mod.value : 0;
      valueInput.addEventListener("input", () => { mod.value = Number(valueInput.value) || 0; });

      const minLevelInput = document.createElement("input");
      minLevelInput.type = "number";
      minLevelInput.title = "Min level (blank = always active)";
      minLevelInput.placeholder = "Lvl";
      minLevelInput.className = "bundle-mod-row__level";
      minLevelInput.value = Number.isFinite(mod.minLevel) ? mod.minLevel : "";
      minLevelInput.addEventListener("input", () => {
        const n = Number(minLevelInput.value);
        mod.minLevel = minLevelInput.value === "" || !Number.isFinite(n) ? null : n;
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn formula-toolbar__btn";
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => {
        selected.statModifiers.splice(i, 1);
        renderEditor();
      });

      row.append(nameInput, opSelect, valueInput, minLevelInput, removeBtn);
      editorCol.append(row);
    });

    const addModBtn = document.createElement("button");
    addModBtn.type = "button";
    addModBtn.className = "btn formula-toolbar__btn";
    addModBtn.textContent = "+ Add Modifier";
    addModBtn.addEventListener("click", () => {
      selected.statModifiers.push({ id: newLocalId(), targetFieldName: "", op: "add", value: 0, minLevel: null });
      renderEditor();
    });
    editorCol.append(addModBtn);

    // --- Dropdown access ---
    const accessHeader = document.createElement("div");
    accessHeader.className = "dropdown-choices-editor__mods-header";
    accessHeader.textContent = "Dropdown Access";
    editorCol.append(accessHeader);

    if (!selected.dropdownAccess) selected.dropdownAccess = [];
    selected.dropdownAccess.forEach((rule, i) => {
      if (!rule.id) rule.id = newLocalId();
      const ruleWrap = document.createElement("div");
      ruleWrap.className = "bundle-access-rule";

      const targetRow = document.createElement("div");
      targetRow.className = "bundle-mod-row";
      const targetInput = document.createElement("input");
      targetInput.type = "text";
      targetInput.placeholder = "Dropdown name (e.g. Subclass)";
      targetInput.value = rule.targetFieldName || "";
      targetInput.addEventListener("input", () => { rule.targetFieldName = targetInput.value; });
      const ruleMinLevelInput = document.createElement("input");
      ruleMinLevelInput.type = "number";
      ruleMinLevelInput.title = "Min level (blank = always active)";
      ruleMinLevelInput.placeholder = "Lvl";
      ruleMinLevelInput.className = "bundle-mod-row__level";
      ruleMinLevelInput.value = Number.isFinite(rule.minLevel) ? rule.minLevel : "";
      ruleMinLevelInput.addEventListener("input", () => {
        const n = Number(ruleMinLevelInput.value);
        rule.minLevel = ruleMinLevelInput.value === "" || !Number.isFinite(n) ? null : n;
      });
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn formula-toolbar__btn";
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", () => {
        selected.dropdownAccess.splice(i, 1);
        renderEditor();
      });
      targetRow.append(targetInput, ruleMinLevelInput, removeBtn);
      ruleWrap.append(targetRow);

      const choicesLabel = document.createElement("label");
      choicesLabel.className = "bundle-access-rule__label";
      choicesLabel.textContent = "Allowed choices (comma-separated)";
      const choicesInput = document.createElement("input");
      choicesInput.type = "text";
      choicesInput.className = "bundle-access-rule__input";
      choicesInput.placeholder = "e.g. Champion, Battle Master, Eldritch Knight";
      choicesInput.value = (rule.allowedChoiceNames || []).join(", ");
      choicesInput.addEventListener("input", () => {
        rule.allowedChoiceNames = choicesInput.value
          .split(",")
          .map(s => s.trim())
          .filter(Boolean);
      });
      ruleWrap.append(choicesLabel, choicesInput);

      editorCol.append(ruleWrap);
    });

    const addAccessBtn = document.createElement("button");
    addAccessBtn.type = "button";
    addAccessBtn.className = "btn formula-toolbar__btn";
    addAccessBtn.textContent = "+ Add Dropdown Rule";
    addAccessBtn.addEventListener("click", () => {
      selected.dropdownAccess.push({ id: newLocalId(), targetFieldName: "", allowedChoiceNames: [] });
      renderEditor();
    });
    editorCol.append(addAccessBtn);

    // --- Save / delete ---
    const actions = document.createElement("div");
    actions.className = "modal-actions bundle-library-actions";

    if (!isNew) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn--danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", async () => {
        if (!window.confirm(`Delete the "${selected.name || "Unnamed"}" bundle? This won't undo it on characters it's already been applied to.`)) return;
        await store.deleteBundleLibrary(selected.scope, selected.id);
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
        window.alert("Give this bundle a name first.");
        return;
      }
      const scope = isNew ? "personal" : selected.scope;
      try {
        const id = await store.saveBundleLibrary(scope, { ...selected, scope });
        selected.id = id;
        selected.scope = scope;
        isNew = false;
        await refresh();
        onChange();
      } catch (err) {
        window.alert(err.message || "Couldn't save that bundle.");
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
          window.alert("Give this bundle a name first.");
          return;
        }
        try {
          const id = await store.saveBundleLibrary("global", { ...selected, scope: "global" });
          selected.id = id;
          selected.scope = "global";
          isNew = false;
          await refresh();
          onChange();
        } catch (err) {
          window.alert(err.message || "Couldn't save that bundle — only admins can create global bundles.");
        }
      });
      actions.append(saveGlobalBtn);
    }

    editorCol.append(actions);
  }

  overlay.append(box);
  document.body.append(overlay);
  refresh().then(() => renderEditor());
}

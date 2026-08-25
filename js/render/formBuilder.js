// formBuilder.js
//
// Every labeled field on the site is created by ONE of the functions
// below. Add a new field type here (rarely) rather than hand-writing
// one-off markup on a page (never). This is what keeps the CSS file
// from growing every time a new field appears on a sheet — a new
// field is a new schema.js entry, not new markup + new CSS.

/**
 * Build a single labeled input/select/textarea field.
 * @param {object} def - field definition from schema.js
 * @param {any} value - current value
 * @param {(newValue:any) => void} onChange
 */
export function buildInputGroup(def, value, onChange) {
  const wrap = document.createElement("div");
  wrap.className = `input-group input-group--${def.type}`;
  wrap.dataset.fieldId = def.id;

  const label = document.createElement("label");
  label.className = "input-group__label";
  label.textContent = def.label;
  label.htmlFor = `field-${def.id}`;

  const control = buildControl(def, value, onChange);
  control.id = `field-${def.id}`;
  control.classList.add("input-group__control");

  wrap.append(label, control);

  if (def.hint) {
    const hint = document.createElement("div");
    hint.className = "input-group__hint";
    hint.textContent = def.hint;
    wrap.append(hint);
  }

  return wrap;
}

function buildControl(def, value, onChange) {
  let el;

  switch (def.type) {
    case "textarea":
      el = document.createElement("textarea");
      el.value = value ?? "";
      el.addEventListener("input", () => onChange(el.value));
      break;

    case "select":
      el = document.createElement("select");
      (def.options || []).forEach(opt => {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        el.append(o);
      });
      el.value = value ?? "";
      el.addEventListener("change", () => onChange(el.value));
      break;

    case "number":
    case "score":
      el = document.createElement("input");
      el.type = "number";
      if (def.min != null) el.min = def.min;
      if (def.max != null) el.max = def.max;
      el.value = value ?? def.default ?? 0;
      el.disabled = !!def.derived;
      el.addEventListener("input", () => onChange(Number(el.value)));
      break;

    case "toggle":
      el = document.createElement("input");
      el.type = "checkbox";
      el.checked = !!value;
      el.addEventListener("change", () => onChange(el.checked));
      break;

    case "text":
    default:
      el = document.createElement("input");
      el.type = "text";
      el.value = value ?? "";
      el.addEventListener("input", () => onChange(el.value));
      break;
  }

  return el;
}

/**
 * Build a stat-block (ability score + derived modifier badge).
 * @param {{id:string,label:string}} ability
 * @param {number} score
 * @param {number} modifier
 * @param {(newScore:number) => void} onChange
 */
export function buildStatBlock(ability, score, modifier, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "stat-block";
  wrap.dataset.abilityId = ability.id;

  const label = document.createElement("div");
  label.className = "stat-block__label";
  label.textContent = ability.label;

  const scoreInput = document.createElement("input");
  scoreInput.type = "number";
  scoreInput.className = "stat-block__score";
  scoreInput.value = score;
  scoreInput.addEventListener("input", () => onChange(Number(scoreInput.value)));

  const modBadge = document.createElement("div");
  modBadge.className = "stat-block__modifier";
  modBadge.textContent = modifier >= 0 ? `+${modifier}` : `${modifier}`;

  wrap.append(label, scoreInput, modBadge);
  return wrap;
}

/**
 * Build a whole section: a titled block containing a grid of fields
 * built from an array of field definitions. This is the function most
 * pages will actually call.
 */
export function buildSheetSection(title, fieldDefs, character, onFieldChange) {
  const section = document.createElement("section");
  section.className = "sheet-section";

  const heading = document.createElement("h3");
  heading.textContent = title;

  const grid = document.createElement("div");
  grid.className = "sheet-section__grid";

  fieldDefs.forEach(def => {
    const field = buildInputGroup(def, character[def.id], (val) => onFieldChange(def.id, val));
    grid.append(field);
  });

  section.append(heading, grid);
  return section;
}

/**
 * Build a small read-only value display (e.g. "Passive Perception 13").
 * Give it an id via wrap.dataset so callers can update .textContent
 * later without rebuilding.
 */
export function buildReadout(label, value, id) {
  const wrap = document.createElement("div");
  wrap.className = "stat-block";
  if (id) wrap.dataset.readoutId = id;

  const labelEl = document.createElement("div");
  labelEl.className = "stat-block__label";
  labelEl.textContent = label;

  const valueEl = document.createElement("div");
  valueEl.className = "stat-block__modifier readout__value";
  valueEl.textContent = value;

  wrap.append(labelEl, valueEl);
  return wrap;
}

/**
 * Build a repeatable list section — attacks, inventory, spells,
 * features all use this. Rows are built once; editing a field inside
 * a row calls onFieldChange directly WITHOUT rebuilding the list (so
 * typing never loses focus). Add/remove are the only actions that
 * rebuild, since those genuinely change the number of rows.
 *
 * @param {object} config
 * @param {string} config.title
 * @param {Array<object>} config.items - each needs a unique `id`
 * @param {Array<object>} config.fieldDefs - schema.js field defs (no `id` clash with item.id — these describe item properties)
 * @param {() => void} config.onAdd
 * @param {(itemId:string) => void} config.onRemove
 * @param {(itemId:string, fieldId:string, value:any) => void} config.onFieldChange
 */
export function buildEditableList({ title, items, fieldDefs, onAdd, onRemove, onFieldChange, addLabel = "+ Add", extraClass = "" }) {
  const section = document.createElement("section");
  section.className = extraClass ? `sheet-section ${extraClass}` : "sheet-section";

  const header = document.createElement("div");
  header.className = "card__header";

  const heading = document.createElement("h3");
  heading.textContent = title;

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn btn--primary";
  addBtn.textContent = addLabel;
  addBtn.addEventListener("click", onAdd);

  header.append(heading, addBtn);
  section.append(header);

  const list = document.createElement("div");
  list.className = "card-list";

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "input-group__hint";
    empty.textContent = "Nothing here yet.";
    list.append(empty);
  }

  items.forEach(item => {
    const row = document.createElement("div");
    row.className = "list-row";
    row.dataset.itemId = item.id;

    fieldDefs.forEach(def => {
      const field = buildInputGroup(def, item[def.id], (val) => onFieldChange(item.id, def.id, val));
      field.classList.add("list-row__field");
      row.append(field);
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn--danger btn--icon list-row__remove";
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove";
    removeBtn.addEventListener("click", () => onRemove(item.id));
    row.append(removeBtn);

    list.append(row);
  });

  section.append(list);
  return section;
}

/**
 * Build one spell-slot-level row: level label + max/current inputs.
 */
export function buildSpellSlotRow(level, slot, onMaxChange, onCurrentChange) {
  const row = document.createElement("div");
  row.className = "list-row";
  row.dataset.spellLevel = level;

  const label = document.createElement("div");
  label.className = "input-group__label";
  label.textContent = `Level ${level}`;
  label.style.alignSelf = "center";
  label.style.minWidth = "4.5rem";

  const maxField = buildInputGroup({ id: `max-${level}`, label: "Max", type: "number", min: 0 }, slot.max, onMaxChange);
  const currentField = buildInputGroup({ id: `current-${level}`, label: "Current", type: "number", min: 0 }, slot.current, onCurrentChange);
  maxField.classList.add("list-row__field");
  currentField.classList.add("list-row__field");

  row.append(label, maxField, currentField);
  return row;
}

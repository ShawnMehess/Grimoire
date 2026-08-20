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

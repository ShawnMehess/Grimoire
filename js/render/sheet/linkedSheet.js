// linkedSheet.js
//
// A "linked sheet" tab: a read-only view of ANOTHER character document,
// for mounts, companions, and anything else that's a full character of
// its own but lives on a second sheet.
//
//   { type: "linkedSheet", characterId: "...", displayFields: [...] }
//
// READ-ONLY IS THE DELIBERATE CHOICE (the spec left it to me)
// -----------------------------------------------------------
// Editing through a link would write to a DIFFERENT character record from
// a tab on this one. Undo/redo is per-character, so an edit made here
// would be undoable in the other document's history and not in this one -
// the user would undo something that doesn't appear to have changed, or
// lose an edit entirely. Making the linked tab read-only keeps one tab
// meaning one document, which is what makes undo trustworthy.
//
// OWNERSHIP NEEDS NO SEPARATE CHECK
// ---------------------------------
// Resolution only ever goes through the owner's own character list
// (listMyCharacters, already filtered by ownerId server-side). A
// characterId that isn't in that list resolves to nothing, so a link
// can't be pointed at someone else's sheet by editing the id by hand -
// it just stops resolving. linkedSheetStatus reports that case distinctly
// rather than showing a blank pane.

/** The fields a linked sheet can show, and how to label them. Deliberately
 *  a small fixed set: a mount sheet is a few facts (what it is, how fast,
 *  how tough), not a second full character sheet, and letting the link
 *  name arbitrary fields would make it a second editor with none of the
 *  undo guarantees. */
export const LINKED_DISPLAY_FIELDS = [
  { id: "name", label: "Name" },
  { id: "size", label: "Size" },
  { id: "type", label: "Creature Type" },
  { id: "speed", label: "Speed" },
  { id: "armorClass", label: "Armor Class" },
  { id: "hitPoints", label: "Hit Points" },
  { id: "attacks", label: "Attacks" },
  { id: "abilities", label: "Ability Scores" },
  { id: "senses", label: "Senses" },
  { id: "languages", label: "Languages" },
  { id: "features", label: "Features & Traits" },
];

export const LINKED_FIELD_IDS = LINKED_DISPLAY_FIELDS.map((f) => f.id);

/** The default set a new link starts with. */
export const DEFAULT_LINKED_FIELDS = ["name", "size", "type", "speed", "armorClass", "hitPoints"];

/** A tab is a linked sheet if it says so. `kind` is left alone: the
 *  existing main/rules/leveling kinds keep meaning what they mean, and
 *  `type` is the spec's own field for this. */
export function isLinkedSheetTab(tab) {
  return tab?.type === "linkedSheet";
}

/**
 * Normalize a tab's link config, tolerating anything (hand-edited JSON,
 * an older save, a half-filled picker). Returns null when the tab isn't a
 * linked sheet at all.
 */
export function linkedTabConfig(tab) {
  if (!isLinkedSheetTab(tab)) return null;
  const wanted = Array.isArray(tab.displayFields) ? tab.displayFields : [];
  const displayFields = LINKED_FIELD_IDS.filter((id) => wanted.includes(id));
  return {
    characterId: typeof tab.characterId === "string" && tab.characterId.trim() ? tab.characterId.trim() : null,
    // An empty or unrecognized list falls back to the default rather than
    // rendering an empty pane - a link with no fields configured is
    // almost certainly a half-finished picker, not a request for nothing.
    displayFields: displayFields.length ? displayFields : [...DEFAULT_LINKED_FIELDS],
    requestedFields: wanted,
  };
}

/**
 * Why a linked tab is (or isn't) showing something.
 *
 *   "unset"    - no character chosen yet
 *   "self"     - points at this character (a sheet linked to itself)
 *   "missing"  - the id is in the owner's list but the document is gone
 *   "not-owned"- the id isn't among the user's characters
 *   "ok"       - resolved
 *
 * "self" and "not-owned" are kept apart from "missing" on purpose: the
 * first two are fixable by re-picking a character, and "missing" is not.
 */
export function linkedSheetStatus(config, { ownedIds = [], selfId = null } = {}) {
  if (!config?.characterId) return "unset";
  if (selfId && config.characterId === selfId) return "self";
  if (!ownedIds.includes(config.characterId)) return "not-owned";
  return "ok";
}

/** Where a field id might live on the character document itself, for the
 *  facts that aren't sheet fields at all — a name is a top-level
 *  property, speed and the like sit under `rules`. */
const RECORD_PATHS = {
  name: ["name"],
  speed: ["rules.speed"],
  type: ["rules.race", "rules.type"],
  abilities: ["rules.abilityScores"],
  languages: ["rules.languages"],
};

/** Turn a field id into its display value on the linked character.
 *
 *  Reads the same places the sheet itself does - a starter field's value
 *  for the ordinary ones, then the character record for the facts that
 *  aren't fields (a name is a document property, not something you type
 *  into a box) - so a linked mount shows the numbers its own sheet shows
 *  rather than a second interpretation of them. */
export function linkedFieldValue(character, fieldId, { fieldById = null, fieldByLabel = null } = {}) {
  if (!character) return null;
  const byId = fieldById ? fieldById(fieldId) : null;
  if (byId && byId.value != null && String(byId.value).trim() !== "") return byId.value;
  const byLabel = fieldByLabel ? fieldByLabel(fieldId) : null;
  if (byLabel && byLabel.value != null && String(byLabel.value).trim() !== "") return byLabel.value;
  for (const path of RECORD_PATHS[fieldId] || []) {
    const value = path.split(".").reduce((node, key) => (node == null ? node : node[key]), character);
    if (value == null) continue;
    // Ability scores and languages are objects/arrays; render them rather
    // than dropping the row, since a mount's STR is exactly the sort of
    // thing this view exists for.
    if (typeof value === "object") {
      const text = typeof value === "array"
        ? value.filter(Boolean).join(", ")
        : Object.entries(value)
          .map(([key, v]) => `${key.toUpperCase()} ${v}`)
          .join(", ");
      if (text.trim()) return text;
      continue;
    }
    if (String(value).trim() !== "") return value;
  }
  return null;
}

/** Build the display rows for a linked character: one entry per
 *  configured field, in the order the field table defines (which is the
 *  order a reader wants), skipping fields the character has no value
 *  for. A mount sheet with nothing filled in shows fewer rows rather
 *  than a wall of blanks. */
export function linkedSheetRows(character, displayFields, { fieldById = null, fieldByLabel = null } = {}) {
  const wanted = new Set(Array.isArray(displayFields) ? displayFields : []);
  const rows = [];
  for (const field of LINKED_DISPLAY_FIELDS) {
    if (!wanted.has(field.id)) continue;
    const value = linkedFieldValue(character, field.id, { fieldById, fieldByLabel });
    if (value == null || String(value).trim() === "") continue;
    rows.push({ id: field.id, label: field.label, value: String(value) });
  }
  return rows;
}

/** Message for each non-ok status, so the pane can say something useful
 *  instead of showing nothing at all. */
export function linkedSheetMessage(status, config) {
  switch (status) {
    case "unset":
      return "No character linked yet. Pick one to show their sheet here.";
    case "self":
      return "This tab links to the character it's on. Pick a different character - a mount, a companion, or another sheet of your own.";
    case "not-owned":
      return "That character isn't one of yours, or has been deleted. Pick another to link here.";
    case "missing":
      return "That character's sheet couldn't be loaded. Pick another to link here.";
    default:
      return config?.characterId ? "" : "";
  }
}

// --- DOM -----------------------------------------------------------------

/**
 * Render a linked-sheet tab's contents.
 *
 * Read-only, as explained at the top of this file. The picker that sets
 * the link lives on the tab's toolbar (see renderLinkedSheetToolbarInto),
 * not here, so the pane itself is a plain list of facts.
 *
 * deps: { status, config, linkedCharacter, ownedCharacters, onPick,
 *         onPickField, fieldById, fieldByLabel, doc }
 */
export function renderLinkedSheetInto(container, deps = {}) {
  const {
    status = "unset",
    config = null,
    linkedCharacter = null,
    onPick = null,
    fieldById = null,
    fieldByLabel = null,
    doc = globalThis.document,
  } = deps;
  if (!container || !doc) return;
  container.innerHTML = "";

  // The picker is always present, including while a link resolves: the
  // user has to be able to change their mind, and an unresolvable link
  // is exactly when they'd want to.
  if (typeof onPick === "function") {
    const bar = doc.createElement("div");
    bar.className = "linked-sheet__picker";
    const select = doc.createElement("select");
    select.className = "input-group__control";
    const placeholder = doc.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a character to link…";
    select.append(placeholder);
    for (const owned of deps.ownedCharacters || []) {
      const option = doc.createElement("option");
      option.value = owned.id;
      option.textContent = owned.name || "Unnamed character";
      if (owned.id === config?.characterId) option.selected = true;
      select.append(option);
    }
    select.addEventListener("change", () => {
      if (select.value) onPick(select.value);
    });
    bar.append(select);
    container.append(bar);
  }

  if (status !== "ok") {
    const note = doc.createElement("p");
    note.className = "leveling-tab__intro";
    note.textContent = linkedSheetMessage(status, config);
    container.append(note);
    return;
  }

  const heading = doc.createElement("h3");
  heading.className = "linked-sheet__name";
  heading.textContent = linkedCharacter?.name || "Unnamed character";
  container.append(heading);

  const rows = linkedSheetRows(linkedCharacter, config?.displayFields, { fieldById, fieldByLabel });
  if (!rows.length) {
    const empty = doc.createElement("p");
    empty.className = "leveling-tab__intro";
    empty.textContent = "That character has nothing filled in for the fields this tab shows.";
    container.append(empty);
    return;
  }
  const list = doc.createElement("dl");
  list.className = "linked-sheet__fields";
  for (const row of rows) {
    const term = doc.createElement("dt");
    term.textContent = row.label;
    const value = doc.createElement("dd");
    // Read-only: the value is text, not an input, so there's no
    // control here to write back through.
    value.textContent = row.value;
    list.append(term, value);
  }
  container.append(list);
}

// accessibility.js
//
// Two independent display options that sit alongside the seven themes
// rather than being another theme.
//
// They are separate toggles on purpose. A colour-blind player wants legible
// status colours and nothing else changed; a dyslexic reader wants spacing
// and a different face and does not want their theme recoloured. Bundling
// them into one "accessible theme" would force the second group to accept
// the first group's changes, which is how an accessibility feature ends up
// unused.
//
// Neither is stored on the character. They are account-level reading
// preferences, like the theme, and a player who needs one needs it on the
// vault page and inside the sheet renderer too. See applyA11yMode and its
// callers.

/** The two options, in the order the toolbar offers them. `id` is the
 *  data- attribute name so the CSS can key off it directly and the stored
 *  shape stays flat. */
export const A11Y_OPTIONS = [
  {
    id: "cb",
    name: "Colour-blind safe colours",
    // Says what it DOES, not who it is for. Somebody reaching for this has
    // already worked out why they want it; what they have not is any way to
    // tell whether it worked.
    description: "Rewrites the yes/no colours so they differ in brightness as well as hue, and tells them apart for every type of colour blindness.",
  },
  {
    id: "dyslexia",
    name: "Dyslexia-friendly text",
    description: "A more open typeface, wider letter and word spacing, and taller line height. Everything stays in reading order.",
  },
];

/** Only literal true counts as on.
 *
 *  A hand-edited or migrated save can hold "true", 1, or "yes", and reading
 *  those as truthy means a mode can be half-on: the attribute says one thing
 *  and the stored preference says another, and nothing ever reconciles them.
 *  An unknown value reads as off, which is the safe default - the reader who
 *  needed it can turn it on again in one click.
 *
 *  `raw` is a plain object of stored preferences. Pure. */
export function a11yEnabled(raw, id) {
  return raw?.[id] === true;
}

/** Every option that is currently on, as `["cb", "dyslexia"]`.
 *  Used to set the root attributes and to render the toggles' states. Pure. */
export function activeA11yOptions(raw) {
  return A11Y_OPTIONS.filter((opt) => a11yEnabled(raw, opt.id)).map((opt) => opt.id);
}

/** Set the root data attributes for the active options.
 *
 *  Every attribute is written on every call, including the "off" ones, and
 *  always as a real string. Deleting the attribute instead would leave
 *  whatever a previous theme left behind, and the CSS keys off
 *  `[data-cb="1"]` rather than `[data-cb]`, so a stale value would silently
 *  mean something different from a fresh one.
 *
 *  `raw` is the whole stored preference object; this is the only place that
 *  reads it, so the toolbar and the CSS cannot disagree about what is on. */
export function applyA11yMode(raw) {
  const root = document.documentElement;
  for (const opt of A11Y_OPTIONS) {
    root.dataset[opt.id] = a11yEnabled(raw, opt.id) ? "1" : "0";
  }
}

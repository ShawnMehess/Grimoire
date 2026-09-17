// themes.js — color/style themes for the character sheet.
//
// The site's palette lives entirely in css/tokens.css variables, so a
// theme is just a [data-theme] override block there. This module is
// the registry (ids + display names) plus the one-line applicator.
// The choice persists per character (character.themeId); "default"
// means no override attribute at all.

export const SHEET_THEMES = [
  { id: "default", name: "Dark Fantasy" },
  { id: "light", name: "Parchment Light" },
  { id: "forest", name: "Forest Night" },
  { id: "arcane", name: "Arcane Night" },
];

export function sheetThemeName(id) {
  return SHEET_THEMES.find((t) => t.id === id)?.name || SHEET_THEMES[0].name;
}

export function applySheetTheme(id) {
  const root = document.documentElement;
  if (!id || id === "default") delete root.dataset.theme;
  else root.dataset.theme = id;
}

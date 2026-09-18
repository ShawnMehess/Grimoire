// themes.js — color/style themes for the character sheet.
//
// The site's palette lives entirely in css/tokens.css variables, so a
// theme is just a [data-theme] override block there (+ [data-mode] for
// the light/dark variant of that theme). This module is the registry
// (ids + display names) plus the applicator. The choice persists per
// character (character.themeId + character.themeMode); "standard" in
// dark mode is the default (no legacy override).

export const SHEET_THEMES = [
  { id: "standard", name: "Standard" },
  { id: "fancy-medieval", name: "Fancy Medieval Fantasy" },
  { id: "simple-medieval", name: "Simple Medieval Fantasy" },
  { id: "modern", name: "Modern Day" },
  { id: "cyberpunk", name: "Cyberpunk" },
  { id: "space", name: "Space Sci-Fi" },
];

// Legacy ids from before the six-theme set (Dark Fantasy / Parchment
// Light / Forest Night / Arcane Night). Existing saved characters may
// still carry these — map them onto the closest new theme + mode so
// they keep rendering instead of falling back silently.
const LEGACY_THEME_MAP = {
  default: { themeId: "fancy-medieval", mode: "dark" },
  light: { themeId: "standard", mode: "light" },
  forest: { themeId: "simple-medieval", mode: "dark" },
  arcane: { themeId: "space", mode: "dark" },
};

export function normalizeThemeId(id) {
  if (!id) return "standard";
  if (LEGACY_THEME_MAP[id]) return LEGACY_THEME_MAP[id].themeId;
  return SHEET_THEMES.some((t) => t.id === id) ? id : "standard";
}

export function normalizeThemeMode(mode, themeId) {
  if (mode === "light" || mode === "dark") return mode;
  // A legacy "light" theme id implies light mode even when no mode
  // was ever saved alongside it.
  if (themeId === "light") return "light";
  return "dark";
}

export function sheetThemeName(id) {
  return SHEET_THEMES.find((t) => t.id === normalizeThemeId(id))?.name || SHEET_THEMES[0].name;
}

// Each theme ships its own default border treatment (see the
// [data-theme] .grid-node blocks in tokens.css). The style popover's
// Border Shape picker offers these same looks per-node, so a node can
// opt into another theme's border without switching the whole sheet.
export const THEME_BORDER_SHAPES = [
  { id: "", name: "Theme default" },
  { id: "standard", name: "Standard (soft rounded)" },
  { id: "fancy-medieval", name: "Fancy Medieval (ornate double)" },
  { id: "simple-medieval", name: "Simple Medieval (plain square)" },
  { id: "modern", name: "Modern (sharp minimal)" },
  { id: "cyberpunk", name: "Cyberpunk (notched neon)" },
  { id: "space", name: "Space Sci-Fi (pill glow)" },
];

export function applySheetTheme(id, mode) {
  const root = document.documentElement;
  const themeId = normalizeThemeId(id);
  const themeMode = normalizeThemeMode(mode, id);
  root.dataset.theme = themeId;
  root.dataset.mode = themeMode;
}

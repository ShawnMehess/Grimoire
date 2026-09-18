// sheetAttacks.js
//
// Suggested attack lines for the Attacks textlist ("Suggest" button
// on the starter Attacks field). Pure line-building: the renderer
// supplies weapons (from starting equipment), known attack cantrips,
// and racial natural weapons, plus the live modifiers — everything
// stays editable text afterward, never auto-managed.
//
// Weapon damage dice are standard 5e facts (PHB equipment), keyed by
// lowercase name. `use` picks the ability: "str", "dex", "fin"
// (finesse — better of the two), or "rng" (ranged — Dexterity).

export const WEAPON_STATS = {
  "club": { dmg: "1d4", type: "bludgeoning", use: "str" },
  "dagger": { dmg: "1d4", type: "piercing", use: "fin" },
  "greatclub": { dmg: "1d8", type: "bludgeoning", use: "str" },
  "handaxe": { dmg: "1d6", type: "slashing", use: "str" },
  "javelin": { dmg: "1d6", type: "piercing", use: "str" },
  "light hammer": { dmg: "1d4", type: "bludgeoning", use: "str" },
  "mace": { dmg: "1d6", type: "bludgeoning", use: "str" },
  "quarterstaff": { dmg: "1d6", type: "bludgeoning", use: "str" },
  "sickle": { dmg: "1d4", type: "slashing", use: "str" },
  "spear": { dmg: "1d6", type: "piercing", use: "str" },
  "light crossbow": { dmg: "1d8", type: "piercing", use: "rng" },
  "dart": { dmg: "1d4", type: "piercing", use: "fin" },
  "shortbow": { dmg: "1d6", type: "piercing", use: "rng" },
  "sling": { dmg: "1d4", type: "bludgeoning", use: "rng" },
  "battleaxe": { dmg: "1d8", type: "slashing", use: "str" },
  "flail": { dmg: "1d8", type: "bludgeoning", use: "str" },
  "glaive": { dmg: "1d10", type: "slashing", use: "str" },
  "greataxe": { dmg: "1d12", type: "slashing", use: "str" },
  "greatsword": { dmg: "2d6", type: "slashing", use: "str" },
  "halberd": { dmg: "1d10", type: "slashing", use: "str" },
  "lance": { dmg: "1d12", type: "piercing", use: "str" },
  "longsword": { dmg: "1d8", type: "slashing", use: "str" },
  "maul": { dmg: "2d6", type: "bludgeoning", use: "str" },
  "morningstar": { dmg: "1d8", type: "piercing", use: "str" },
  "pike": { dmg: "1d10", type: "piercing", use: "str" },
  "rapier": { dmg: "1d8", type: "piercing", use: "fin" },
  "scimitar": { dmg: "1d6", type: "slashing", use: "fin" },
  "shortsword": { dmg: "1d6", type: "piercing", use: "fin" },
  "trident": { dmg: "1d6", type: "piercing", use: "str" },
  "war pick": { dmg: "1d8", type: "piercing", use: "str" },
  "warhammer": { dmg: "1d8", type: "bludgeoning", use: "str" },
  "whip": { dmg: "1d4", type: "slashing", use: "fin" },
  "blowgun": { dmg: "1", type: "piercing", use: "rng" },
  "hand crossbow": { dmg: "1d6", type: "piercing", use: "rng" },
  "heavy crossbow": { dmg: "1d10", type: "piercing", use: "rng" },
  "longbow": { dmg: "1d8", type: "piercing", use: "rng" },
};

export const ATTACK_CANTRIPS = {
  "fire bolt": { dmg: "1d10", type: "fire", note: "extra die at 5th/11th/17th" },
  "eldritch blast": { dmg: "1d10", type: "force", note: "extra beam at 5th/11th/17th" },
  "ray of frost": { dmg: "1d8", type: "cold", note: "extra die at 5th/11th/17th" },
  "shocking grasp": { dmg: "1d8", type: "lightning", note: "extra die at 5th/11th/17th" },
  "chill touch": { dmg: "1d8", type: "necrotic", note: "extra die at 5th/11th/17th" },
  "produce flame": { dmg: "1d8", type: "fire", note: "extra die at 5th/11th/17th" },
  "thorn whip": { dmg: "1d6", type: "piercing", note: "extra die at 5th/11th/17th" },
};

/** "2 handaxes" -> "handaxe": strips leading counts and de-plurals
 *  the common equipment phrasings. Pure. */
export function normalizeWeaponName(raw) {
  let s = String(raw || "").toLowerCase().trim();
  s = s.replace(/^\d+\s+/, "");
  const irregular = { handaxes: "handaxe", daggers: "dagger", hammers: "hammer", axes: "axe" };
  if (irregular[s]) return irregular[s];
  if (s.endsWith("s") && !s.endsWith("ss")) {
    const singular = s.slice(0, -1);
    if (WEAPON_STATS[singular]) return singular;
  }
  return s;
}

function signed(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

function attackLine(name, toHit, dmg, mod, type, note = "") {
  const damage = mod === 0 ? dmg : `${dmg}${signed(mod)}`;
  return `${name} — ${signed(toHit)} to hit — ${damage} ${type}${note ? ` (${note})` : ""}`.trim();
}

function modForWeapon(stats, strMod, dexMod) {
  if (stats.use === "dex" || stats.use === "rng") return dexMod;
  if (stats.use === "fin") return Math.max(strMod, dexMod);
  return strMod;
}

/** Full suggestion list from weapons + cantrips + innate natural
 *  weapons. `existing` (current textlist lines) filters out what's
 *  already there by name. Pure. */
export function suggestAttackLines({ items = [], cantripsKnown = [], innate = [], existing = [], prof = 2, strMod = 0, dexMod = 0, spellMod = 0 } = {}) {
  const have = new Set(
    existing.map((line) => String(line || "").split("—")[0].trim().toLowerCase()).filter(Boolean)
  );
  const lines = [];
  const take = (name, line) => {
    if (!name || have.has(name.toLowerCase())) return;
    have.add(name.toLowerCase());
    lines.push(line);
  };

  take("Unarmed Strike", attackLine("Unarmed Strike", prof + strMod, "1", strMod, "bludgeoning"));

  items.forEach((raw) => {
    if (!raw || /\(your choice\)|pack$/i.test(raw)) return;
    const key = normalizeWeaponName(raw);
    const stats = WEAPON_STATS[key];
    if (!stats) return;
    const name = key.replace(/\b\w/g, (c) => c.toUpperCase());
    const mod = modForWeapon(stats, strMod, dexMod);
    take(name, attackLine(name, prof + mod, stats.dmg, mod, stats.type));
  });

  cantripsKnown.forEach((raw) => {
    const key = String(raw || "").toLowerCase().trim();
    const cantrip = ATTACK_CANTRIPS[key];
    if (!cantrip) return;
    const name = key.replace(/\b\w/g, (c) => c.toUpperCase());
    take(name, attackLine(name, prof + spellMod, cantrip.dmg, spellMod, cantrip.type, cantrip.note));
  });

  innate.forEach((entry) => {
    if (!entry || !entry.name || !entry.dice) return;
    take(entry.name, attackLine(entry.name, prof + strMod, entry.dice, strMod, entry.type || "damage"));
  });

  return lines;
}

/** Racial natural weapons parsed from feature-grant prose: looks for
 *  claw/bite/horn/fang/talon grants carrying damage dice. Pure. */
export function innateAttacksFromGrants(grants = []) {
  const out = [];
  (grants || []).forEach((grant) => {
    const name = String(grant?.name || "");
    if (!/(claw|bite|horn|fang|talon)/i.test(name)) return;
    const dice = /(\d+d\d+)/.exec(String(grant?.description || ""))?.[1];
    if (!dice) return;
    const type = /(piercing|slashing|bludgeoning|fire|cold|lightning|acid|poison|necrotic|radiant|force|psychic|thunder)/i
      .exec(String(grant?.description || ""))?.[1]?.toLowerCase() || "damage";
    out.push({ name: name.trim(), dice, type });
  });
  return out;
}

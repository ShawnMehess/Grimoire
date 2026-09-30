// featList.js
//
// The Feats list: one row per feat, laid out as
//
//   [checkbox] [icon] [name] [summary]        <- what's selected and what it is
//   [effect in words]                          <- the actual mechanical text
//   [= what it modifies]                       <- derived from its statModifiers
//
// Three pieces here are pure and unit-tested; `renderFeatListInto` is the
// thin DOM layer over them.
//
// Two honest constraints, both visible in the data rather than guessed at:
//
//  - There are no feat icons. Every one of the 83 FEAT_CATALOG entries has
//    an empty `imageData` (they were compiled from a text export with no
//    art), so the icon slot falls back to a single consistent marker. Real
//    icons need art assets added to the catalog; nothing here should imply
//    otherwise.
//  - Feats are almost entirely mechanical. There is very little flavour
//    text to show - for most feats the catalog summary and the mechanical
//    text say much the same thing. The two lines are kept separate anyway
//    because the split is the spec's, and because a homebrew feat added
//    later can carry real flavour where the shipped ones can't.
//
// The "what it modifies" line is DERIVED from the feat's own statModifiers
// rather than written by hand, so it can't drift from the mechanics: a
// feat that stops touching initiative stops saying it does.

/** `source` value marking a feat granted outside the normal leveling
 *  gate (a DM's call at the table). Kept distinct from "asi" and
 *  "lineage" so the review can say where a feat came from. */
export const FEAT_SOURCE_DM = "dm";

/** Human-readable "= Initiative +5" line, built from the feat bundle's own
 *  statModifiers. Only `add`/`subtract` against a known target produce
 *  text; a `grant` (a proficiency checkbox) reads as a proficiency, and
 *  anything with no target we can name is skipped rather than rendered as
 *  a raw field id. */
const OP_WORDS = {
  add: "+",
  subtract: "-",
  multiply: "x",
  set: "=",
};

/** Turn a raw field id into something readable. Deliberately narrow: it
 *  knows the ids the sheet actually uses for feat targets and returns null
 *  for anything else, so an unknown target is left out of the summary
 *  instead of leaking `initiativeBonus` into the UI. */
export function featTargetLabel(targetFieldId) {
  const id = String(targetFieldId || "");
  const score = id.match(/^([a-z]{3})Score$/i);
  if (score) return score[1].toUpperCase();
  const known = {
    initiative: "Initiative",
    proficiencyBonus: "Proficiency Bonus",
    armorClass: "Armor Class",
    hitPoints: "Hit Points",
    speed: "Speed",
    passivePerception: "Passive Perception",
    maxHitPoints: "Hit Points",
  };
  return known[id] || null;
}

/** The "=" summary line for a feat. Returns "" when nothing in the
 *  bundle is a change we can name — which is a real case (a feat whose
 *  whole effect is a feature note with no statModifiers), and showing
 *  nothing is better than showing noise. */
export function featEffectSummary(bundle) {
  const parts = [];
  for (const mod of bundle?.statModifiers || []) {
    if (mod?.minLevel) continue; // gated grants are a leveling thing, not a feat's identity
    const label = featTargetLabel(mod.targetFieldId);
    if (!label) continue;
    if (mod.op === "grant") {
      parts.push(label);
      continue;
    }
    const word = OP_WORDS[mod.op];
    if (!word || mod.value === undefined || mod.value === null) continue;
    parts.push(`${label} ${word}${mod.value}`);
  }
  // Same change twice (two mods on one target) says nothing extra.
  return [...new Set(parts)].join(", ");
}

/** The mechanical effect line, in words. Uses the feat's own feature
 *  grant text — the same text the sheet shows when the feat is applied —
 *  rather than a summary, because this line's whole job is to be the
 *  authoritative "what does this actually do".
 *
 *  The compiled grants start with a "Prerequisites:" block on 35 of the 83
 *  shipped feats. That block is stripped here: the list decides what the
 *  player can actually take (see featRequirements), so repeating the rule
 *  in the description just adds a line the row can't act on. `featEffectText`
 *  takes the already-split parts so the parse happens once per row. */
export function featEffectText(bundle, grant = (bundle?.featureGrants || [])[0]) {
  const text = (grant?.description || "").trim();
  if (!text) return "";
  // The compiled grants append a "Sheet notes:" block for the sheet's own
  // bookkeeping. That's useful on the sheet but isn't part of the feat's
  // printed rules text, so the summary stops at it.
  return splitPrerequisiteBlock(text.split(/\n\s*Sheet notes:/i)[0].trim()).text;
}

/** The leading "Prerequisites: ..." block of a feat's grant text, and the
 *  text with it removed.
 *
 *  Returns `{ prerequisiteText, text, requirements }`. `requirements` is
 *  the parsed, evaluable subset — the rest is prose we deliberately don't
 *  interpret, so nothing is hidden or enabled on a guess. */
export function splitPrerequisiteBlock(text) {
  const raw = String(text || "");
  const m = raw.match(/^\s*Prerequisites:\s*([\s\S]*?)(?=\n\s*\n|$)/i);
  if (!m) return { prerequisiteText: "", text: raw.trim(), requirements: [] };
  return {
    prerequisiteText: m[1].trim().replace(/\s*\n\s*/g, ", "),
    text: raw.slice(m[0].length).replace(/^\s*\n+/, "").trim(),
    requirements: parseFeatRequirements(m[1]),
  };
}

/** Split a prerequisite sentence into what we can actually check.
 *
 *  Only two things are evaluated, because only two are reliably derivable
 *  from the sheet's own state: an ability-score minimum and a race. Anything
 *  else ("Spellcasting or Pact Magic feature", "The Alert feat", "Medium or
 *  Small size") is returned with `kind: "other"` and `met: true` — an
 *  unparsed rule must never be the reason a feat vanishes from the list. */
/** Race and lineage names as the source writes them in a prerequisite.
 *  Matched as a whole clause, so "Dragonborn" and "Elf (Drow)" both land
 *  here while "Spellcasting feature" does not. Anything not in this list
 *  stays `kind: "other"` and is never used to hide a row. */
const RACE_PREREQ_RE = /^(?:Aarakocra|Aasimar|Dragonborn|Dwarf|Elf|Gnome|Halfling|Human|Orc|Tiefling|Half-Elf|Hill Dwarf|Mountain Dwarf|High Elf|Wood Elf|Drow|Forest Gnome|Rock Gnome|Genasi|Goliath)\b(?:\s*\([^)]*\))?$/i;

export function parseFeatRequirements(text) {
  const flat = String(text || "").trim().replace(/\s*\n\s*/g, ", ");
  if (!flat) return [];
  const out = [];
  for (const clause of flat.split(/,\s*|\band\b/i).map((s) => s.trim()).filter(Boolean)) {
    const ability = clause.match(/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+score\s+of\s+(\d+)/i);
    if (ability) {
      out.push({
        kind: "ability",
        ability: ability[1].toLowerCase().slice(0, 3),
        score: Number(ability[2]),
        label: clause,
      });
      continue;
    }
    if (RACE_PREREQ_RE.test(clause)) {
      // "Elf (Drow)" names a race and a lineage. The sheet's own state
      // here only carries the race, so the base name is what's checked
      // and the lineage is recorded but never used to hide a row.
      const paren = clause.match(/\(([^)]*)\)/);
      out.push({
        kind: "race",
        race: clause.replace(/\s*\([^)]*\)/g, "").trim(),
        lineage: paren ? paren[1].trim() : null,
        label: clause,
      });
      continue;
    }
    if (/^(No other|Any other)\b/i.test(clause)) {
      out.push({ kind: "exclusive", label: clause });
      continue;
    }
    out.push({ kind: "other", label: clause });
  }
  return out;
}

/** Evaluate parsed requirements against what the character has.
 *
 *  `abilityScores` is the sheet's {str, dex, con, int, wis, cha} map and
 *  `raceName` its picked race. Ability minimums come back as `shortfalls`
 *  (the user can still take the feat, they just need points first) and
 *  unmet race/exclusive rules come back as `blocking`. */
export function featRequirementStatus(requirements, { abilityScores = {}, raceName = "" } = {}) {
  const shortfalls = [];
  const blocking = [];
  for (const req of requirements || []) {
    if (req.kind === "ability") {
      const have = Number(abilityScores?.[req.ability] ?? 0);
      if (Number.isFinite(have) && have < req.score) {
        shortfalls.push({ ...req, have, need: req.score - have });
      }
      continue;
    }
    if (req.kind === "race") {
      const wanted = req.race.toLowerCase();
      const mine = String(raceName || "").toLowerCase();
      // "Elf" is satisfied by any elf lineage, so match on the lineage
      // name's own words too (High Elf / Wood Elf / Drow).
      const satisfied = mine === wanted
        || (wanted === "elf" && /\belf\b/.test(mine))
        || new RegExp(`\\b${wanted}\\b`).test(mine);
      if (!satisfied) blocking.push(req);
      continue;
    }
    if (req.kind === "exclusive") {
      // "No other dragonmark" - the sheet has no dragonmark to have, so
      // there is nothing to conflict with.
      continue;
    }
  }
  return { shortfalls, blocking, met: !shortfalls.length && !blocking.length };
}

/** A feat's benefits as separate lines.
 *
 *  The compiled grant text is a lead sentence followed by "- " bullets
 *  (Alert: "you gain the following benefits:" then three bullets). Rendered
 *  as one blob those bullets run together, so they're split here and the
 *  row gives each its own line. Returns `{ lead, benefits }`; `lead` is the
 *  prose before the first bullet, which is the part that isn't a benefit. */
export function featBenefitLines(bundle) {
  const text = featEffectText(bundle);
  if (!text) return { lead: "", benefits: [] };
  const lead = [];
  const benefits = [];
  // Line-based, not block-based: some feats separate their bullets with a
  // blank line and some don't, so blocks alone would glue three bullets
  // into one. A bullet always starts a new benefit; any other line is prose
  // that belongs to whatever came before it.
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^[-•*]\s+(.*)$/);
    if (bullet) {
      benefits.push(bullet[1].trim());
      continue;
    }
    if (benefits.length) benefits[benefits.length - 1] += ` ${line}`;
    else lead.push(line);
  }
  return { lead: lead.join(" ").trim(), benefits };
}

/** The short summary line (the spec calls it the description line; for
 *  shipped feats it's usually a condensed mechanical sentence). */
export function featSummaryText(catalogEntry, bundle) {
  const fromCatalog = (catalogEntry?.description || "").trim();
  if (fromCatalog) return fromCatalog;
  // No catalog entry (a homebrew feat): fall back to the first sentence of
  // the mechanical text so the row still reads sensibly.
  const effect = featEffectText(bundle);
  const firstStop = effect.search(/[.!?](\s|$)/);
  return firstStop > 0 ? effect.slice(0, firstStop + 1) : effect;
}

/** The icon slot. See the note at the top: there is no art to show, so
 *  every feat gets the same marker. Returns a short token rather than
 *  markup, so the renderer decides how to draw it. */
export function featIconToken(catalogEntry) {
  return catalogEntry?.imageData ? "image" : "marker";
}

/**
 * Build the row model for one feat.
 *
 * `taken` means the character already has it; `pickable` means the
 * current leveling rules allow another pick right now. They're separate
 * on purpose — a feat can be taken but no longer pickable (the gate is
 * spent), and the row has to show that rather than just being ticked.
 */
export function featRowModel(bundle, catalogEntry, { taken = false, pickable = true, source = null, abilityScores = {}, raceName = "" } = {}) {
  const name = bundle?.name || catalogEntry?.name || "";
  if (!name) return null;
  const grant = (bundle?.featureGrants || [])[0];
  const { requirements } = splitPrerequisiteBlock((grant?.description || "").split(/\n\s*Sheet notes:/i)[0]);
  const { shortfalls, blocking } = featRequirementStatus(requirements, { abilityScores, raceName });
  const { lead, benefits } = featBenefitLines(bundle);
  return {
    id: name,
    name,
    icon: featIconToken(catalogEntry),
    summary: featSummaryText(catalogEntry, bundle),
    effect: featEffectText(bundle),
    // Each benefit on its own line (the source writes them as bullets).
    lead,
    benefits,
    modifies: featEffectSummary(bundle),
    taken: Boolean(taken),
    pickable: Boolean(pickable),
    // Unmet ability minimums: still takeable, but the player needs points
    // first. The Ability Scores tab shows the shortfall next to the score.
    shortfalls,
    // Unmet race/lineage rules: the feat can't be taken at all, so the
    // list drops it rather than showing a row that does nothing.
    hidden: blocking.length > 0 && !taken,
    // "asi" (spending an ASI), "lineage" (Custom Lineage), "dm" (granted
    // at the table). Null when the feat isn't held.
    source: taken ? (source || "asi") : null,
  };
}

/** Build the whole list, marking each row taken/pickable.
 *
 *  `remaining` is how many picks the current rules still allow — the
 *  already-held feats have been deducted from the allowance by whoever
 *  computed it, so this does NOT walk the list spending a budget again
 *  (doing that both double-counts and makes `pickable` mean "is this
 *  within N rows of the top of the list", which is meaningless). It just
 *  decides whether ANY further pick is currently allowed.
 */
export function featRowModels(bundles = [], catalogEntries = [], { takenFeats = [], remaining = Infinity, abilityScores = {}, raceName = "" } = {}) {
  const catalogByName = new Map(catalogEntries.map((e) => [e?.name, e]));
  const takenByName = new Map(takenFeats.map((f) => [f?.name, f]));
  const canPickMore = !(Number.isFinite(remaining) && remaining <= 0);
  return (bundles || [])
    .map((bundle) => {
      const held = takenByName.get(bundle?.name);
      return featRowModel(bundle, catalogByName.get(bundle?.name), {
        ...(held ? { taken: true, source: held.source } : {}),
        pickable: canPickMore,
        abilityScores,
        raceName,
      });
    })
    .filter(Boolean);
}

/** "2 of 3 feats picked" style counter. `remaining` is how many picks the
 *  current rules still allow; Infinity means "no gate" (e.g. the
 *  Custom Lineage feat, or a DM-granted one), which reads better as "no
 *  limit" than as "0 of Infinity". */
export function featPickableCount(takenFeats = [], remaining = Infinity) {
  const throughGate = takenFeats.filter((f) => f?.source !== FEAT_SOURCE_DM).length;
  if (!Number.isFinite(remaining)) return { taken: throughGate, limit: null, remaining: null };
  const allowance = throughGate + Math.max(0, remaining);
  return {
    taken: throughGate,
    limit: allowance,
    remaining: Math.max(0, remaining),
  };
}

export function featPickableLabel(takenFeats = [], remaining = Infinity) {
  const { taken, limit, remaining: left } = featPickableCount(takenFeats, remaining);
  if (limit === null) return `${taken} feat${taken === 1 ? "" : "s"} — no limit on this character`;
  if (left <= 0) return `No feat picks left (${taken}/${limit} used)`;
  return `${left} feat pick${left === 1 ? "" : "s"} left (${taken}/${limit} used)`;
}

/** How many picks the character has left, per the leveling rules.
 *
 *  The gate is one feat per ASI actually spent: every level where the
 *  character took "+2/+1" instead bought a pick. Returns Infinity for a
 *  character with an uncapped source of feats (Custom Lineage's one-off
 *  feat), where a number would be misleading. */
export function featPicksRemainingIn(pending, classLevels = []) {
  const asiLevelsSpent = Math.max(0, ...[].concat(classLevels).map((entry) => Number(entry?.asiTaken) || 0), 0);
  if (asiLevelsSpent === 0 && !(pending?.asiMode === "feat")) return 0;
  return Math.max(0, asiLevelsSpent - ((pending?.featsTakenAtAsi) || 0));
}

// --- DOM -----------------------------------------------------------------

/**
 * Render the feat list.
 *
 * Row layout, per spec: an unlabelled checkbox, an icon, the name, and
 * the summary on one line; the mechanical effect in words beneath it; and
 * a derived "= what it modifies" line. The checkbox is genuinely
 * unlabelled — the name beside it is the label, and a screen reader gets
 * the name via aria-label rather than a second visible string.
 *
 * deps: { takenFeats, remaining, onToggle(name, taken), onGrant(name) }
 */
export function renderFeatListInto(container, rows, deps = {}) {
  const { takenFeats = [], remaining = Infinity, onToggle, onGrant, doc = globalThis.document } = deps;
  if (!container || !doc) return;
  container.innerHTML = "";

  const head = doc.createElement("p");
  head.className = "leveling-tab__intro";
  head.textContent = featPickableLabel(takenFeats, remaining);
  container.append(head);

  // A DM handing out a feat at the table isn't spending anyone's ASI, so
  // it needs a way in that bypasses the gate entirely. It's here rather
  // than in the normal picker precisely because the gate says no.
  if (typeof onGrant === "function") {
    const grant = doc.createElement("button");
    grant.type = "button";
    grant.className = "btn btn--secondary feat-list__grant";
    grant.textContent = "+ Grant feat";
    grant.title = "Give this character a feat outside the normal leveling rules (a DM's call at the table)";
    const picker = doc.createElement("select");
    picker.className = "input-group__control";
    picker.append(Object.assign(doc.createElement("option"), { value: "", text: "Choose a feat to grant…" }));
    rows.filter((r) => !r.taken).forEach((r) => {
      picker.append(Object.assign(doc.createElement("option"), { value: r.id, text: r.name }));
    });
    picker.addEventListener("change", () => {
      if (!picker.value) return;
      onGrant(picker.value);
      picker.value = "";
    });
    const bar = doc.createElement("div");
    bar.className = "feat-list__grantbar";
    bar.append(picker, grant);
    container.append(bar);
  }

  const list = doc.createElement("div");
  list.className = "feat-list";
  for (const row of rows) {
    // A feat whose race/lineage prerequisite this character can't meet is
    // dropped entirely: its prerequisite isn't printed, and a row that
    // can't be ticked teaches nothing. Held feats always stay.
    if (row.hidden) continue;
    const item = doc.createElement("div");
    item.className = "feat-list__row" + (row.taken ? " is-taken" : "") + (row.pickable ? "" : " is-locked");
    item.dataset.featId = row.id;

    const check = doc.createElement("input");
    check.type = "checkbox";
    check.className = "feat-list__check";
    check.checked = row.taken;
    check.disabled = !row.pickable || typeof onToggle !== "function";
    // The visible name beside the box is the label; repeating it into
    // aria-label keeps the control itself named for assistive tech
    // without a second visible string.
    check.setAttribute("aria-label", row.name);
    check.addEventListener("change", () => {
      if (typeof onToggle === "function") onToggle(row.id, check.checked);
    });

    const icon = doc.createElement("span");
    icon.className = "feat-list__icon";
    // See the note at the top: no feat ships with art, so this is a
    // marker until a catalog carries real icons.
    icon.textContent = row.icon === "image" ? "🖼" : "✦";
    icon.setAttribute("aria-hidden", "true");

    const name = doc.createElement("span");
    name.className = "feat-list__name";
    name.textContent = row.name;

    const summary = doc.createElement("span");
    summary.className = "feat-list__summary";
    summary.textContent = row.summary;

    const main = doc.createElement("div");
    main.className = "feat-list__main";
    main.append(name, summary);

    const top = doc.createElement("div");
    top.className = "feat-list__top";
    top.append(check, icon, main);

    const effect = doc.createElement("div");
    effect.className = "feat-list__effect";
    // Each benefit gets its own line. The source writes them as bullets
    // under a lead sentence; run together they read as one wall of text.
    if (row.lead) {
      const lead = doc.createElement("p");
      lead.className = "feat-list__lead";
      lead.textContent = row.lead;
      effect.append(lead);
    }
    for (const benefit of row.benefits || []) {
      const line = doc.createElement("p");
      line.className = "feat-list__benefit";
      line.textContent = benefit;
      effect.append(line);
    }
    if (!row.lead && !(row.benefits || []).length) {
      const plain = doc.createElement("p");
      plain.textContent = row.effect;
      effect.append(plain);
    }

    item.append(top, effect);

    // An unmet ability minimum isn't a blocker - the feat stays pickable
    // - but the player needs the points first, so say so rather than
    // printing the prerequisite rule itself.
    if ((row.shortfalls || []).length) {
      const warn = doc.createElement("p");
      warn.className = "feat-list__warn";
      warn.textContent = row.shortfalls
        .map((s) => `${s.ability.toUpperCase()} ${s.score} needed - ${s.need} more from Ability Scores`)
        .join(". ");
      item.append(warn);
    }

    if (row.modifies) {
      const modifies = doc.createElement("p");
      modifies.className = "feat-list__modifies";
      modifies.textContent = `= ${row.modifies}`;
      item.append(modifies);
    }
    if (row.source && row.source !== "asi") {
      const badge = doc.createElement("span");
      badge.className = "feat-list__source";
      badge.textContent = row.source === FEAT_SOURCE_DM ? "granted" : row.source;
      top.append(badge);
    }
    list.append(item);
  }
  container.append(list);
}

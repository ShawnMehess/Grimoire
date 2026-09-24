#!/usr/bin/env node
// scripts/compile-foundry-subclasses.mjs
//
// Compiles `docs/New Info/5e-subclasses.txt` (127 Foundry subclass entries)
// into real subclass bundles: per-level feature grants parsed from the
// description's own "Nth Level: Feature" headings, auto-prepared domain /
// circle spells (spell @-labels resolved to names + class levels), and
// the odd-identifier children (circle-of-the-land terrains, hunter
// focuses) as choice groups on their parent subclass.
//
// Reads:
//   docs/New Info/5e-subclasses.txt
//
// Writes:
//   js/data/subclassContent.js   (SUBCLASS_SUPPLEMENT, SUBCLASS_CHOICE_NAMES)
//
// NOTE: the committed output carries hand fixes a clean re-run would
// clobber (e.g. the source's "Shephard" typo ships corrected as
// "Shepherd", plus formatting) — re-run, then re-apply them.
//
// Supplement entry:
//   { key, name, className, choiceId, bundle: { statModifiers: [],
//     dropdownAccess: [], featureGrants, resourceGrants: [], choiceGroups } }
//   - key: normalized-name match key used to attach the bundle to the
//     sheet's existing Subclass dropdown choices (and to add the ones
//     this data has that the sheet lacks).
//   - choiceId: stable id (`subclass-<slug>`) for newly added choices.
//   - featureGrants carry the subclass level as minLevel, so Features &
//     Traits unlocks them as the character levels.
//   - Auto-prepared spells become { op: "addItem", targetFieldId:
//     "spellsKnown", value: "<Spell>" } statModifiers gated by the class
//     level that grants them (Light Domain L1 table rows are cleric
//     levels; Land circle rows are spell levels mapped to druid levels).
//
// Skipped + logged, never silently dropped: the 5 artificer subclasses
// (no Artificer class exists on the sheet, so they'd be unreachable),
// entries with no parseable level headings.
//
// Re-run after updating docs/New Info/:
//   node scripts/compile-foundry-subclasses.mjs

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const INPUT = path.join(ROOT, "docs", "New Info", "5e-subclasses.txt");
const OUTPUT = path.join(ROOT, "js", "data", "subclassContent.js");

const log = [];
const normName = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const slug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "subclass";
const titleCaseId = (s) => String(s || "").split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");

function getSystem(d) {
  return d.system || d.data || {};
}

// @Compendium/@UUID refs -> display label (shared convention).
function resolveRefs(text) {
  text = String(text || "").replace(/@(?:Compendium|UUID)\[[^\]]*\]\{([^}]*)\}/g, "$1");
  text = text.replace(/@(?:Compendium|UUID)\[[^\]]*\]/g, "");
  text = text.replace(/\[\[\/(?:gm)?roll\s+([^\]]+?)\]\]/g, "($1)");
  return text.replace(/[ \t]{2,}/g, " ");
}

function htmlToText(raw) {
  if (!raw) return "";
  let text = String(raw);
  text = text.replace(/<\s*li[^>]*>/gi, "\n- ");
  text = text.replace(/<\s*br[^>]*>/gi, "\n");
  text = text.replace(/<\/(p|div|section|ul|ol|table|tr|h1|h2|h3|h4)>/gi, "\n");
  text = text.replace(/<(p|div|section|ul|ol|table|tr|h1|h2|h3|h4)(\s[^>]*)?>/gi, "\n");
  text = text.replace(/<\/?t[dh](\s[^>]*)?>/gi, " ");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  text = resolveRefs(text);
  const lines = text.split("\n").map((ln) => ln.replace(/[ \t]+/g, " ").trim());
  const out = [];
  for (const ln of lines) {
    if (ln || (out.length && out[out.length - 1] !== "")) out.push(ln);
  }
  return out.join("\n").trim();
}

// Spell @-labels in a raw HTML section, in order.
function spellLabelsIn(rawHtml) {
  const labels = [];
  const re = /@(?:Compendium|UUID)\[[^\]]*5e-spells\.[A-Za-z0-9]+\]\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(String(rawHtml || "")))) {
    const label = m[1].trim();
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

// Split raw description HTML into [{ level, headingNames, html }] by
// "Nth Level:" markers. Text before the first marker is the intro.
function splitSections(rawHtml) {
  const marker = /(\d+)(?:st|nd|rd|th)\s*Level\s*:?/gi;
  const hits = [...String(rawHtml || "").matchAll(marker)];
  if (!hits.length) return [];
  const sections = [];
  for (let i = 0; i < hits.length; i++) {
    const level = Number.parseInt(hits[i][1], 10);
    const start = hits[i].index + hits[i][0].length;
    const end = i + 1 < hits.length ? hits[i + 1].index : String(rawHtml).length;
    sections.push({ level, html: String(rawHtml).slice(start, end) });
  }
  // Domain/circle spell tables sit BEFORE the first "Nth Level" marker
  // (intro region) — return that preamble too so its rows aren't lost.
  sections.preamble = String(rawHtml).slice(0, hits[0].index);
  return sections;
}

// Spell-table rows ("3rd <spells…> 5th <spells…>") inside a section's
// raw HTML: [{ rowLevel, spells: [labels] }].
function spellTableRows(sectionHtml) {
  const rows = [];
  const marker = /(\d+)(?:st|nd|rd|th)\b/gi;
  const hits = [...String(sectionHtml || "").matchAll(marker)];
  if (hits.length < 2) return rows; // a lone "Nth Level" is the section heading, not a table
  for (let i = 0; i < hits.length; i++) {
    const rowLevel = Number.parseInt(hits[i][1], 10);
    const start = hits[i].index + hits[i][0].length;
    const end = i + 1 < hits.length ? hits[i + 1].index : String(sectionHtml).length;
    const spells = spellLabelsIn(String(sectionHtml).slice(start, end));
    if (spells.length) rows.push({ rowLevel, spells });
  }
  return rows;
}

// Spell-table rows under a "Cleric Level" / "Paladin Level" / "Druid
// Level" header grant those spells AT that class level (Land circle
// rows 3/5/7/9 and oath rows alike). Without such a header the row is
// just a spell level — gate on the section's own level instead.
const CLASS_LEVEL_HEADER = /(cleric|paladin|druid|ranger|wizard|sorcerer|warlock|bard)\s+level/i;

function spellMinLevel(rowLevel, sectionHtml, sectionLevel) {
  if (CLASS_LEVEL_HEADER.test(String(sectionHtml || ""))) return rowLevel;
  return sectionLevel;
}

// Paladin-oath layout: an "Oath Spells" table whose rows are PALADIN
// levels (3rd/5th/9th/13th/17th grant those spells outright) plus
// "… Features" lines of the form "7th: {Aura}, {…}".
function parseOathStyle(rawHtml, entryName, baseName) {
  const featureGrants = [];
  const statModifiers = [];
  const ordinal = (n) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
  const rows = spellTableRows(rawHtml);
  if (rows.length) {
    const rowDescs = [];
    const minLevels = [];
    for (const row of rows) {
      const minLevel = spellMinLevel(row.rowLevel, rawHtml, row.rowLevel);
      minLevels.push(minLevel);
      rowDescs.push(`${ordinal(row.rowLevel)}-level: ${row.spells.join(", ")}`);
      for (const spell of row.spells) {
        statModifiers.push({ targetFieldId: "spellsKnown", op: "addItem", value: spell, minLevel });
      }
    }
    featureGrants.push({
      id: `${slug(entryName)}-oath-spells`,
      name: "Oath Spells",
      description: `Always-prepared oath spells — added to Spells Known automatically:\n${rowDescs.map((d) => `- ${d}`).join("\n")}`,
      minLevel: Math.min(...minLevels),
    });
  }
  const text = htmlToText(rawHtml);
  const seen = new Set();
  for (const m of text.matchAll(/(\d+)(?:st|nd|rd|th)\s*:\s*([^\n]+)/g)) {
    const level = Number.parseInt(m[1], 10);
    if (level > 20) continue;
    const names = m[2].split(/[,;]/).map((s) => s.trim()).filter((s) => s && !/spells?$/i.test(s));
    for (const name of names.slice(0, 6)) {
      const key = `${level}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      featureGrants.push({
        id: `${slug(entryName)}-${level}-${slug(name)}`,
        name,
        description: `${entryName} — ${ordinal(level)}-level feature.`,
        minLevel: level,
      });
    }
  }
  return { featureGrants, statModifiers };
}

function compileSubclass(entry, childrenByParent) {
  const system = getSystem(entry);
  const classId = system.classIdentifier || "";
  const baseName = titleCaseId(classId);
  const rawHtml = ((system.description || {}).value) || "";
  const sections = splitSections(rawHtml);
  const featureGrants = [];
  const statModifiers = [];
  const seen = new Set();

  if (!sections.length) {
    // Oath-style layout ("Oath Spells" table with Paladin Level rows +
    // "Oath of X Features" lines like "3rd: {A}, {B}") has no "Nth
    // Level:" markers — parse it directly instead of leaving a stub.
    const oath = parseOathStyle(rawHtml, entry.name, baseName);
    if (oath.featureGrants.length || oath.statModifiers.length) {
      featureGrants.push(...oath.featureGrants);
      statModifiers.push(...oath.statModifiers);
    } else {
      log.push(`no level headings: ${entry.name} — single overview grant only`);
      const text = htmlToText(rawHtml);
      if (text) featureGrants.push({ id: `${slug(entry.name)}-overview`, name: entry.name, description: text, minLevel: null });
    }
  }

  for (const section of sections) {
    const text = htmlToText(section.html);
    // Feature names: {Label} refs on the heading line (first line).
    const firstLine = text.split("\n")[0] || "";
    const names = [...firstLine.matchAll(/([^,;.\n-]{2,80}?)(?=(,|;|$))/g)]
      .map((m) => m[1].trim()).filter(Boolean);
    const body = text.split("\n").slice(1).join("\n").trim();
    // Spell-table rows inside this section (domain/circle spells).
    const rows = spellTableRows(section.html);
    if (rows.length) {
      const rowDescs = [];
      const ordinal = (n) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
      for (const row of rows) {
        const minLevel = spellMinLevel(row.rowLevel, section.html, section.level);
        rowDescs.push(`${ordinal(row.rowLevel)}-level spells: ${row.spells.join(", ")}`);
        for (const spell of row.spells) {
          statModifiers.push({ targetFieldId: "spellsKnown", op: "addItem", value: spell, minLevel });
        }
      }
      const label = names.length ? names.join(", ") : "Bonus Spells";
      featureGrants.push({
        id: `${slug(entry.name)}-spells-${section.level}`,
        name: `${label} (spells)`,
        description: `Always-prepared subclass spells — added to Spells Known automatically:\n${rowDescs.map((d) => `- ${d}`).join("\n")}`,
        minLevel: section.level,
      });
      seen.add(`${section.level}:spells`);
    }
    if (names.length) {
      for (const name of names) {
        const key = `${section.level}:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        featureGrants.push({
          id: `${slug(entry.name)}-${section.level}-${slug(name)}`,
          name,
          description: body || `${entry.name} — ${section.level}${section.level === 1 ? "st" : section.level === 2 ? "nd" : section.level === 3 ? "rd" : "th"}-level feature.`,
          minLevel: section.level,
        });
      }
    } else if (!rows.length && text) {
      featureGrants.push({
        id: `${slug(entry.name)}-${section.level}`,
        name: `${entry.name} (${section.level})`,
        description: text,
        minLevel: section.level,
      });
    }
  }

  // Preamble spell tables (Light Domain Spells, etc.): rows under a
  // "Cleric Level"-style header grant at those class levels.
  const preambleRows = sections.preamble ? spellTableRows(sections.preamble) : [];
  if (preambleRows.length) {
    const rowDescs = [];
    const minLevels = [];
    for (const row of preambleRows) {
      const minLevel = spellMinLevel(row.rowLevel, sections.preamble, row.rowLevel);
      minLevels.push(minLevel);
      const ord = `${row.rowLevel}${row.rowLevel === 1 ? "st" : row.rowLevel === 2 ? "nd" : row.rowLevel === 3 ? "rd" : "th"}`;
      rowDescs.push(`${ord}-level: ${row.spells.join(", ")}`);
      for (const spell of row.spells) {
        statModifiers.push({ targetFieldId: "spellsKnown", op: "addItem", value: spell, minLevel });
      }
    }
    featureGrants.push({
      id: `${slug(entry.name)}-bonus-spells`,
      name: "Bonus Spells",
      description: `Always-prepared subclass spells — added to Spells Known automatically:\n${rowDescs.map((d) => `- ${d}`).join("\n")}`,
      minLevel: Math.min(...minLevels),
    });
  }

  // Odd-identifier children (Land terrains, Hunter focuses) become a
  // real pick on the parent instead of unreachable pseudo-subclasses.
  const choiceGroups = [];
  const children = childrenByParent[entry.name] || childrenByParent[normName(entry.name)] || [];
  if (children.length) {
    const label = /circle/i.test(entry.name) ? "Circle Land (circle spells)" : `${entry.name} Focus`;
    choiceGroups.push({
      id: `${slug(entry.name)}-focus`,
      label,
      minLevel: null,
      minSelections: 1,
      maxSelections: 1,
      options: children.map((child) => {
        const csys = getSystem(child);
        const chtml = ((csys.description || {}).value) || "";
        const ctext = htmlToText(chtml);
        const cstatModifiers = [];
        // Terrain spell tables carry their own rows (3rd/5th/7th/9th
        // under a "Druid Level" header -> those druid levels).
        const csections = splitSections(chtml);
        const tables = csections.length
          ? csections.flatMap((s) => spellTableRows(s.html).map((row) => ({ row, html: s.html, level: s.level })))
          : spellTableRows(chtml).map((row) => ({ row, html: chtml, level: null }));
        for (const { row, html, level } of tables) {
          const minLevel = spellMinLevel(row.rowLevel, html, level);
          for (const spell of row.spells) {
            cstatModifiers.push({ targetFieldId: "spellsKnown", op: "addItem", value: spell, minLevel });
          }
        }
        return {
          id: `${slug(entry.name)}-focus-${slug(child.name)}`,
          name: child.name,
          description: ctext.slice(0, 400),
          statModifiers: cstatModifiers,
          featureGrants: [{ id: `${slug(entry.name)}-focus-${slug(child.name)}-grant`, name: child.name, description: ctext, minLevel: null }],
          resourceGrants: [],
        };
      }),
    });
  }

  // Spellcasting note (e.g. Eldritch Knight third-caster progression).
  const sc = system.spellcasting || {};
  if (sc.progression && sc.progression !== "none") {
    const ability = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" }[sc.ability] || sc.ability || "";
    featureGrants.push({
      id: `${slug(entry.name)}-spellcasting`,
      name: "Spellcasting",
      description: `${entry.name} spellcasting: ${sc.progression}${ability ? ` (${ability})` : ""}.`,
      minLevel: null,
    });
  }

  return {
    key: normName(entry.name),
    name: entry.name,
    className: baseName,
    classIdentifier: classId,
    choiceId: `subclass-${slug(entry.name)}`,
    bundle: { statModifiers, dropdownAccess: [], featureGrants, resourceGrants: [], choiceGroups },
  };
}

async function main() {
  const raw = [];
  for (const line of (await readFile(INPUT, "utf8")).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { raw.push(JSON.parse(trimmed)); } catch { /* skip */ }
  }
  // Children keyed by parent subclass NAME: entries whose
  // classIdentifier is itself a subclass slug (circle-of-the-land's 7
  // terrains, hunter's 3 focuses) rather than a base class.
  const KNOWN_CHILD_PARENTS = new Set(["circle-of-the-land", "hunter"]);
  const topLevel = [];
  const childEntries = [];
  for (const e of raw) {
    const sys = getSystem(e);
    if (KNOWN_CHILD_PARENTS.has(sys.classIdentifier)) childEntries.push(e);
    else topLevel.push(e);
  }
  const topNorms = new Map(topLevel.map((e) => [normName(e.name), e.name]));
  const childrenByParent = {};
  for (const e of childEntries) {
    const sys = getSystem(e);
    const candidates = [normName(titleCaseId(sys.classIdentifier)), normName(sys.classIdentifier)];
    let parentName = null;
    for (const cand of candidates) {
      if (topNorms.has(cand)) { parentName = topNorms.get(cand); break; }
    }
    if (!parentName) {
      // Substring fallback ("hunter" -> "Hunter Conclave"), unique wins.
      const hits = topLevel.filter((t) => normName(t.name).includes(normName(sys.classIdentifier)));
      if (hits.length === 1) parentName = hits[0].name;
    }
    if (!parentName) {
      log.push(`orphaned sub-choice (no parent subclass found): ${e.name} [${sys.classIdentifier}]`);
      topLevel.push(e);
      continue;
    }
    (childrenByParent[parentName] = childrenByParent[parentName] || []).push(e);
  }

  const BASE_CLASSES = new Set(["barbarian", "bard", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard"]);
  const supplement = [];
  for (const e of topLevel) {
    const sys = getSystem(e);
    const classId = (sys.classIdentifier || "").toLowerCase();
    if (!BASE_CLASSES.has(classId)) {
      log.push(`skipped (no such class on the sheet): ${e.name} [${sys.classIdentifier}]`);
      continue;
    }
    if (e.type && e.type !== "subclass") {
      log.push(`skipped (type ${e.type}): ${e.name}`);
      continue;
    }
    supplement.push(compileSubclass(e, childrenByParent));
  }
  supplement.sort((a, b) => a.className.localeCompare(b.className) || a.name.localeCompare(b.name));

  const withFeatures = supplement.filter((s) => s.bundle.featureGrants.length > 0).length;
  const withSpells = supplement.filter((s) => s.bundle.statModifiers.length > 0).length;
  const withChoices = supplement.filter((s) => s.bundle.choiceGroups.length > 0).length;
  const emit = (obj) => JSON.stringify(obj, null, 2);
  const out = `// Auto-generated by scripts/compile-foundry-subclasses.mjs from docs/New Info/5e-subclasses.txt.\n`
    + `// Do not hand-edit — re-run \`node scripts/compile-foundry-subclasses.mjs\`.\n`
    + `// ${supplement.length} subclasses (${withFeatures} with level grants, ${withSpells} granting spells,\n`
    + `// ${withChoices} with sub-choices). Attach by normalized name to the sheet's Subclass\n`
    + `// dropdown (see js/data/contentMigration.js); choiceId is the stable id for newly\n`
    + `// added choices.\n`
    + `export const SUBCLASS_SUPPLEMENT = ${emit(supplement)};\n\n`
    + `export const SUBCLASS_CHOICE_NAMES = ${emit(supplement.map((s) => s.name))};\n`;
  await writeFile(OUTPUT, out, "utf8");
  console.log(`Wrote ${OUTPUT} (${supplement.length} subclasses)`);
  for (const line of log) console.log(`  ${line}`);
}

main().catch((err) => { console.error(err); process.exit(1); });

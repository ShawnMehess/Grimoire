// Fetch subclass feature prose from dnd5e.wikidot.com into a generated data file.
//
// Why this file exists: docs/New Info/5e-subclasses.txt was exported from
// the ACTOR, so each feature is a `@Compendium[...]{Name}` reference and
// the rules text itself was never in the export. The feats export was
// taken from the compendium and so DOES carry its text - which is why 83
// feats have descriptions and 581 subclass features do not.
//
// dnd5e.wikidot.com is CC-BY-SA and is the same 5e content the Foundry
// export was built from. Every fetched feature records its source URL so
// the text can be re-checked against it.
//
// Run: node scripts/fetch-subclass-feature-text.mjs
// Writes: js/data/subclassFeatureText.js  (GENERATED - do not hand-edit)
//
// Regenerating is the point: nothing here is hand-typed, so the text can
// be re-fetched, diffed, and refreshed when the wiki changes. A hand-edited
// copy could not be checked against anything.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const OUT = path.join(ROOT, "js", "data", "subclassFeatureText.js");
const UA = { "user-agent": "Grimoire content importer (local, one-off bulk fetch)" };

/** Subclass bundle key -> wiki page slug. Keys are normSubclassKey of the
 *  display name; slugs are the wiki's own page names, which drop
 *  "Path of the"/"Circle of the"/"College of" prefixes and hyphenate. */
const SLUG_OVERRIDES = {
  aberrantmind: "sorcerer:aberrant-mind",
  alchemist: "artificer:alchemist",
  arcanadomain: "cleric:arcana",
  arcanearcher: "fighter:arcane-archer",
  arcanetrickster: "rogue:arcane-trickster",
  armorer: "artificer:armorer",
  artillerist: "artificer:artillerist",
  assassin: "rogue:assassin",
  banneret: "fighter:banneret",
  battlemaster: "fighter:battle-master",
  battlesmith: "artificer:battle-smith",
  beastmasterconclave: "ranger:beast-master",
  bladesinging: "bard:bladesinging",
  cavalier: "fighter:cavalier",
  champion: "fighter:champion",
  chronurgymagic: "wizard:chronurgy",
  circleofdreams: "druid:dreams",
  circleofspores: "druid:spores",
  circleofstars: "druid:stars",
  circleoftheland: "druid:land",
  circleofthemoon: "druid:moon",
  circleoftheshephard: "druid:shepherd",
  circleoftheshepherd: "druid:shepherd",
  circleofwildfire: "druid:wildfire",
  clockworksoul: "sorcerer:clockwork-soul",
  collegeofcreation: "bard:creation",
  collegeofeloquence: "bard:eloquence",
  collegeofglamour: "bard:glamour",
  collegeoflore: "bard:lore",
  collegeofspirits: "bard:spirits",
  collegeofswords: "bard:swords",
  collegeofvalor: "bard:valor",
  collegeofwhispers: "bard:whispers",
  deathdomain: "cleric:death",
  divinesoul: "sorcerer:divine-soul",
  draconicbloodline: "sorcerer:draconic-bloodline",
  drakewarden: "ranger:drakewarden",
  echoknight: "fighter:echo-knight",
  eldritchknight: "fighter:eldritch-knight",
  feywanderer: "ranger:fey-wanderer",
  forgedomain: "cleric:forge",
  gloomstalkerconclave: "ranger:gloom-stalker",
  gravedomain: "cleric:grave",
  graviturgymagic: "wizard:graviturgy",
  horizonwalkerconclave: "ranger:horizon-walker",
  hunterconclave: "ranger:hunter",
  inquisitive: "rogue:inquisitive",
  knowledgedomain: "cleric:knowledge",
  lifedomain: "cleric:life",
  lightdomain: "cleric:light",
  mastermind: "rogue:mastermind",
  monsterslayerconclave: "ranger:monster-slayer",
  naturedomain: "cleric:nature",
  oathbreaker: "paladin:oathbreaker",
  oathofconquest: "paladin:conquest",
  oathofdevotion: "paladin:devotion",
  oathofglory: "paladin:glory",
  oathofredemption: "paladin:redemption",
  oathoftheancients: "paladin:ancients",
  oathofthecrown: "paladin:crown",
  oathofthewatchers: "paladin:watchers",
  oathofvengeance: "paladin:vengeance",
  orderdomain: "cleric:order",
  orderofscribes: "wizard:order-of-scribes",
  pathoftheancestralguardian: "barbarian:ancestral-guardian",
  pathofthebattlerager: "barbarian:battlerager",
  pathofthebeast: "barbarian:beast",
  pathoftheberserker: "barbarian:berserker",
  pathofthestormherald: "barbarian:storm-herald",
  pathofthetotemwarrior: "barbarian:totem-warrior",
  pathofthezealotherald: "barbarian:zealot",
  peacedomain: "cleric:peace",
  phantom: "rogue:phantom",
  psiwarrior: "fighter:psi-warrior",
  runeknight: "fighter:rune-knight",
  samurai: "fighter:samurai",
  schoolofabjuration: "wizard:abjuration",
  schoolofconjuration: "wizard:conjuration",
  schoolofdivination: "wizard:divination",
  schoolofenchantment: "wizard:enchantment",
  schoolofevocation: "wizard:evocation",
  schoolofillusion: "wizard:illusion",
  schoolofnecromancy: "wizard:necromancy",
  schooloftransmutation: "wizard:transmutation",
  scout: "rogue:scout",
  shadowmagic: "sorcerer:shadow-magic",
  soulknife: "rogue:soulknife",
  stormsorcery: "sorcerer:storm-sorcery",
  swarmkeeper: "ranger:swarmkeeper",
  swashbuckler: "rogue:swashbuckler",
  tempestdomain: "cleric:tempest",
  thearchfey: "warlock:archfey",
  thecelestial: "warlock:celestial",
  thefathomless: "warlock:fathomless",
  thefiend: "warlock:fiend",
  thegenie: "warlock:genie",
  thegreatoldone: "warlock:great-old-one",
  thehexblade: "warlock:hexblade",
  theundead: "warlock:undead",
  theundying: "warlock:undying",
  thief: "rogue:thief",
  trickerydomain: "cleric:trickery",
  twilightdomain: "cleric:twilight",
  wardomain: "cleric:war",
  wayofmercy: "monk:mercy",
  wayofshadow: "monk:shadow",
  wayoftheascendantdragon: "monk:ascendant-dragon",
  wayoftheastralself: "monk:astral-self",
  wayofthedrunkenmaster: "monk:drunken-master",
  wayofthefourelements: "monk:four-elements",
  wayofthekensei: "monk:kensei",
  wayofthelongdeath: "monk:long-death",
  wayoftheopenhand: "monk:open-hand",
  wayofthewsunsoul: "monk:sunsoul",
  wildmagic: "sorcerer:wild-magic",
};


/** Classes whose subclass page slug doesn't start with the class name. */
const DEFAULT_PREFIX = {
  "barbarian:": "barbarian:", "bard:": "bard:", "cleric:": "cleric:",
  "druid:": "druid:", "fighter:": "fighter:", "monk:": "monk:",
  "paladin:": "paladin:", "ranger:": "ranger:", "rogue:": "rogue:",
  "sorcerer:": "sorcerer:", "warlock:": "warlock:", "wizard:": "wizard:",
  "artificer:": "artificer:",
};

const stripHtml = (s) => s
  .replace(/<script[\s\S]*?<\/script>/gi, "")
  .replace(/<style[\s\S]*?<\/style>/gi, "")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/(p|div|li|h[1-6]|tr|td)>/gi, "\n")
  .replace(/<li[^>]*>/gi, "- ")
  .replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&rsquo;|&#39;/g, "'")
  .replace(/&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/&hellip;/g, "…").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/\r/g, "")
  .replace(/[ \t]+/g, " ")
  .replace(/ *\n */g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

/** The wiki's page furniture, cut off before it can be mistaken for prose. */
const NOISE = [
  /^Toggle the table of contents/i, /^edit this page/i, /^Last edited/i,
  /^Categories:/i, /^Page \d+/i, /^include url:/i, /^dnd5e wikidot/i,
  /^Quick search/i, /^Join the server/i,
];

const clean = (text) => {
  const lines = text.split("\n").filter((l) => l.trim() && !NOISE.some((re) => re.test(l.trim())));
  return lines.join("\n").trim();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(slug) {
  const url = `https://dnd5e.wikidot.com/${slug}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return { url, status: res.status, text: null };
  const html = await res.text();
  // Wikidot renders the body inside #page-content. Everything outside it
  // is navigation, and including it is how "Categories:" and the table of
  // contents end up in a feature's rules text.
  const inner = html.match(/<div[^>]+class="[^"]*page-content[^"]*"[\s\S]*?<\/div>\s*<div[^>]+class="page-info/);
  const scoped = inner ? inner[0] : html;
  return { url, status: res.status, text: stripHtml(scoped) };
}


/** fetchPage with retries.
 *
 *  A bare 404 is an answer; a socket error or a 5xx is not, and the
 *  difference matters here because a transient failure would otherwise
 *  silently drop a whole subclass's text from the generated file. */
async function fetchPageRetrying(slug, tries = 4) {
  let last = { url: `https://dnd5e.wikidot.com/${slug}`, status: 0, text: null };
  for (let i = 0; i < tries; i += 1) {
    try {
      last = await fetchPage(slug);
      if (last.status === 404) return last;
      if (last.text) return last;
    } catch {
      // fall through to the backoff
    }
    await sleep(600 * (i + 1));
  }
  return last;
}
export { SLUG_OVERRIDES, fetchPage, fetchPageRetrying, clean, stripHtml, sleep, DEFAULT_PREFIX, OUT, ROOT, UA };

// Run directly: fetch every subclass, write the generated module.
if (process.argv[1] && process.argv[1].endsWith("fetch-subclass-feature-text.mjs")) {
  const { SUBCLASS_BUNDLE_MAP } = await import("../js/data/contentFixups.js");
  const out = {};
  const missed = [];
  for (const [key, bundle] of SUBCLASS_BUNDLE_MAP) {
    const slug = SLUG_OVERRIDES[key];
    if (!slug) { missed.push(key); continue; }
    const { url, status, text } = await fetchPageRetrying(slug);
    if (status !== 200 || !text) { console.log(`  ${key}: HTTP ${status} (${slug})`); missed.push(key); continue; }
    out[key] = { url, text: clean(text) };
    console.log(`  ${key}: ok (${out[key].text.length}b)`);
    await sleep(250);
  }
  fs.writeFileSync(
    path.join(ROOT, ".fetch-subclass-raw.json"),
    JSON.stringify({ fetchedAt: new Date().toISOString(), pages: out }, null, 1)
  );
  console.log(`\nfetched ${Object.keys(out).length}, missed ${missed.length}: ${missed.join(", ")}`);
}

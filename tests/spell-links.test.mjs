// tests/spell-links.test.mjs
//
// Spell mentions in prose become links to the spell's entry.
//
// The hard part was never the rendering - it was the matching. These
// tests pin the rules that came out of scanning the shipped content, and
// then check that every mention in that content is either linked or on the
// denylist for a stated reason. A new rule or feat that introduces a
// "Resistance to X" false positive fails here rather than in front of a
// player. Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findSpellMentions,
  looksLikeSpellName,
  spellEntryByName,
  spellLevelFor,
  spellMetaLine,
  spellNameIndex,
  properNounPhrases,
  surroundingCapitalisedRun,
  SPELL_LINK_DENYLIST,
} from "../js/data/spellIndex.js";
import { FIXED_RACE_ENTRIES, FIXED_CLASS_ENTRIES } from "../js/data/contentFixups.js";
import { RACE_EXTRA_ENTRIES } from "../js/data/extraRaces.js";
import { FEAT_BUNDLES } from "../js/data/featBundles.js";
import { mechanicsBulletsFor } from "../js/render/sheet/sheetMechanics.js";

/** Every piece of prose the sheet can render for a race/class/feat. */
function proseCorpus() {
  const out = [];
  const add = (where, text) => { if (text) out.push({ where, text: String(text) }); };
  const grants = (where, obj) => {
    for (const g of obj?.featureGrants || []) add(`${where}/${g.name}`, g.description);
  };
  const groups = (where, bundle) => {
    for (const grp of bundle?.choiceGroups || []) {
      for (const o of grp.options || []) {
        add(`${where}/${o.name}`, o.description);
        grants(`${where}/${o.name}`, o);
      }
    }
  };
  for (const e of FIXED_RACE_ENTRIES) {
    add(`race:${e.name}`, e.description);
    grants(`race:${e.name}`, e.bundle);
    groups(`race:${e.name}`, e.bundle);
  }
  for (const e of FIXED_CLASS_ENTRIES) {
    add(`class:${e.name}`, e.description);
    grants(`class:${e.name}`, e.bundle);
    groups(`class:${e.name}`, e.bundle);
  }
  for (const b of FEAT_BUNDLES) {
    add(`feat:${b.name}`, b.description);
    grants(`feat:${b.name}`, b);
  }
  return out;
}

describe("spell name index", () => {
  it("indexes every catalog spell except the denylisted ones", () => {
    const { byName, names } = spellNameIndex();
    for (const denied of SPELL_LINK_DENYLIST) {
      assert.ok(byName.has(denied), `${denied} is a real spell, just not linkable`);
      assert.ok(!names.includes(denied), `${denied} is not offered for linking`);
    }
    assert.ok(names.length > 500, `expected the full catalog, got ${names.length}`);
  });

  it("orders names longest-first so a longer name beats its own prefix", () => {
    const { names } = spellNameIndex();
    for (let i = 1; i < names.length; i += 1) {
      assert.ok(names[i - 1].length >= names[i].length);
    }
  });
});

describe("title-case gate", () => {
  it("accepts spell names as written in prose", () => {
    for (const t of ["Misty Step", "Gust Of Wind", "Light", "Blindness/Deafness", "Mage's Hand"]) {
      assert.ok(looksLikeSpellName(t), `${t} should read as a name`);
    }
  });

  it("rejects the ordinary words that collide with spell names", () => {
    for (const t of ["dim light", "resistance to damage", "a light source", "MAGE'S HAND", "darkvision"]) {
      assert.ok(!looksLikeSpellName(t), `${t} should not read as a name`);
    }
  });
});

describe("findSpellMentions", () => {
  const names = (text) => findSpellMentions(text).map((m) => m.name);

  it("links a spell named in a race trait", () => {
    assert.deepEqual(names("You learn the Misty Step spell and can cast it."), ["Misty Step"]);
  });

  it("links several spells in one sentence, in order", () => {
    assert.deepEqual(
      names("You know the following spells: Blindness/Deafness, Blur, and Disguise Self."),
      ["Blindness/Deafness", "Blur", "Disguise Self"],
    );
  });

  it("returns the catalog spelling when the prose capitalises differently", () => {
    const [hit] = findSpellMentions("Cast Gust Of Wind once per long rest.");
    assert.equal(hit.name, "Gust of Wind");
    assert.equal(hit.text, "Gust Of Wind");
  });

  it("reports where the mention starts and ends", () => {
    const text = "You learn the Misty Step spell.";
    const [hit] = findSpellMentions(text);
    assert.equal(text.slice(hit.start, hit.end), "Misty Step");
  });

  it("leaves the mechanics that collide with a spell's name alone", () => {
    assert.deepEqual(names("Resistance to cold damage."), []);
    assert.deepEqual(names("Darkvision 60 ft."), []);
    assert.deepEqual(names("You have superior vision in dark and dim conditions."), []);
  });

  it("is empty for text with no spells in it", () => {
    assert.deepEqual(names("Your passive Wisdom (Perception) score is 14."), []);
    assert.deepEqual(names(""), []);
    assert.deepEqual(names(null), []);
  });

  it("does not match inside a longer word", () => {
    assert.deepEqual(names("Lightfoot is a surname."), []);
    assert.deepEqual(names("Darkvision60"), []);
  });
});

describe("spell lookups", () => {
  it("finds an entry by name and reports its level", () => {
    assert.equal(spellEntryByName("Fireball")?.name, "Fireball");
    assert.equal(spellLevelFor("Fireball"), 3);
    assert.equal(spellLevelFor("Acid Splash"), 0);
  });

  it("returns null for a name that isn't a spell", () => {
    assert.equal(spellEntryByName("Nonesuch Spell"), null);
    assert.equal(spellEntryByName(""), null);
    assert.equal(spellLevelFor("Nonesuch Spell"), null);
  });

  it("builds a readable stat line", () => {
    const meta = spellMetaLine(spellEntryByName("Misty Step"));
    assert.match(meta, /Level 2/);
    assert.match(meta, /Conjuration/);
  });
});

describe("every mention in the shipped content", () => {
  it("is found by the matcher", () => {
    const corpus = proseCorpus();
    assert.ok(corpus.length > 500, `expected the real content, got ${corpus.length} strings`);
    const found = corpus.reduce((n, { text }) => n + findSpellMentions(text).length, 0);
    // A floor, not an exact count: adding a feat shouldn't break this.
    assert.ok(found > 150, `only ${found} spell mentions found in ${corpus.length} strings`);
  });

  it("never links a name from the denylist", () => {
    for (const { where, text } of proseCorpus()) {
      for (const hit of findSpellMentions(text)) {
        assert.ok(!SPELL_LINK_DENYLIST.has(hit.name), `${where} linked the denied spell ${hit.name}`);
      }
    }
  });

  it("only links names the catalog actually has", () => {
    for (const { where, text } of proseCorpus()) {
      for (const hit of findSpellMentions(text)) {
        assert.ok(spellEntryByName(hit.name), `${where} linked an unknown spell ${hit.name}`);
      }
    }
  });
});

// Every one of these is a real line the picker prints, and every one of
// them used to link a spell the player did not ask for: the Duergar's
// weapon proficiency line turned "Light" into the Light cantrip, every
// class's armor line did the same, and five feature NAMES each contained
// a spell name as their second half.
describe("a spell name is never a fragment of a longer name", () => {
  const names = (text) => findSpellMentions(text).map((m) => m.name);

  it("leaves a proficiency line alone", () => {
    // The reported one. "Light Hammer" is a hammer; "Light" was a link to
    // an evocation cantrip.
    assert.deepEqual(names("Weapons: Battleaxe, Handaxe, Light Hammer, Warhammer"), []);
    assert.deepEqual(names("Armor: Light Armor, Medium Armor, Heavy Armor, Shields"), []);
    assert.deepEqual(names("Weapons: Dart, Sling, Quarterstaff, Light Crossbow"), []);
    assert.deepEqual(names("Armor: Light Armor"), []);
  });

  it("leaves a feature or feat NAME alone", () => {
    assert.deepEqual(names("Slow Fall: Use a reaction to reduce falling damage."), []);
    assert.deepEqual(names("Dragon Fear: Prerequisites: Dragonborn with a draconic ancestry."), []);
    assert.deepEqual(names("Shield Master: You use shields not just as armor."), []);
    assert.deepEqual(names("Magical Guidance (Optional): When you fail an ability check."), []);
    // The same line still links the one real mention in it.
    assert.deepEqual(names("Light Bearer: Know the Light cantrip."), ["Light"]);
  });

  it("still links the spell inside those very sentences", () => {
    // The rule is about the PHRASE, not the word. "Cast Light once per long
    // rest" and "Cast Mage Armor on yourself" both have a capitalised
    // neighbour, and neither neighbour is a shipped name - so a rule like
    // "never link a word glued to a capitalised word" would throw away most
    // of the good links along with the bad ones.
    assert.deepEqual(names("You can cast Light once per long rest."), ["Light"]);
    assert.deepEqual(names("Cast Mage Armor on yourself at will."), ["Mage Armor"]);
    assert.deepEqual(names("Cast Detect Magic at will (no slot)."), ["Detect Magic"]);
    assert.deepEqual(names("You know the Light cantrip. You know the Light cantrip."), ["Light", "Light"]);
  });

  it("leaves a spelled-out list of spells alone", () => {
    assert.deepEqual(
      names("Spells: Thaumaturgy, Hellish Rebuke, Darkness"),
      ["Thaumaturgy", "Hellish Rebuke", "Darkness"],
    );
  });

  it("measures the phrase around a mention", () => {
    // The unit the fragment rule is built on, pinned on its own so a change
    // to the walk fails here rather than as a mystery elsewhere.
    const run = (text) => {
      const at = text.indexOf("Light");
      return surroundingCapitalisedRun(text, at, at + "Light".length).text;
    };
    assert.equal(run("Light Armor"), "Light Armor");
    assert.equal(run("Armor: Light Armor, Medium Armor"), "Light Armor");
    assert.equal(run("Know the Light cantrip."), "Light");
    assert.equal(run("Bag of Holding and Light"), "Light");
  });

  it("indexes the shipped names it needs", () => {
    const known = properNounPhrases();
    for (const expected of ["light armor", "light hammer", "light crossbow", "shield master", "dragon fear"]) {
      assert.ok(known.has(expected), `${expected} is a shipped name`);
    }
    // A feat name that ends in "(Optional)" in the compiled data is indexed
    // with and without it, because the prose prints the bare form.
    assert.ok(known.has("magical guidance"), "the parenthetical form is stripped too");
  });
});

// The prose corpus above covers grant DESCRIPTIONS. The false positives
// that actually reach a player mostly live in the lines the mechanics
// renderer assembles from stat modifiers - "Weapons: Battleaxe, Handaxe,
// Light Hammer" is built, not written - so they are checked where they
// are built.
describe("mentions in the assembled picker bullets", () => {
  const deps = { abilityIds: [], abilities: [], skills: [] };
  const bullets = [];
  const add = (where, bundle) => {
    if (!bundle) return;
    // Three levels, not one: some of these grants only appear later (the
    // Monk's Slow Fall is a level 2 feature), and a corpus pinned at level
    // 1 would quietly stop covering them.
    for (const level of [1, 5, 20]) {
      for (const section of mechanicsBulletsFor(bundle, level, deps)) {
        for (const item of section.items) bullets.push({ where: `${where}@${level}/${section.title}`, text: item });
      }
    }
  };
  for (const e of FIXED_RACE_ENTRIES) add(`race:${e.name}`, e.bundle);
  for (const e of RACE_EXTRA_ENTRIES || []) add(`race:${e.name}`, e.bundle);
  for (const e of FIXED_CLASS_ENTRIES) add(`class:${e.name}`, e.bundle);
  for (const b of FEAT_BUNDLES) add(`feat:${b.name}`, b);

  it("covers the shipped content", () => {
    assert.ok(bullets.length > 500, `expected the real bullets, got ${bullets.length}`);
  });

  it("never links a proficiency tag as a spell", () => {
    // Every "Weapons:" / "Armor:" line in the corpus, matched by its label
    // rather than by a hand-written example, so a new race that grants a
    // Light something fails here.
    let checked = 0;
    for (const { where, text } of bullets) {
      if (!/^(Weapons|Armor|Tools|Vehicles|Other):/.test(text)) continue;
      checked += 1;
      assert.deepEqual(findSpellMentions(text), [], `${where} linked a spell out of a tag list: ${text}`);
    }
    assert.ok(checked > 10, `the tag lines are actually covered (${checked})`);
  });

  it("never links a grant's own NAME", () => {
    // "Dragon Fear: Prerequisites:…" - the name half is a name, the detail
    // half is prose, and only the second can be a spell mention. Checked on
    // the real bullets, so a new feat called e.g. "Fear of the Pit" is
    // covered without anyone remembering to add it here.
    let checked = 0;
    for (const { where, text } of bullets) {
      const cut = text.indexOf(": ");
      if (cut <= 0) continue;
      checked += 1;
      for (const hit of findSpellMentions(text)) {
        assert.ok(hit.start >= cut, `${where} linked ${hit.name} out of the grant's own name "${text.slice(0, cut)}": ${text}`);
      }
    }
    assert.ok(checked > 100, `the name half of bullets is actually covered (${checked})`);
  });

  it("drops the reported name-half false positives from the real bullets", () => {
    // The four the report named, found in the data rather than pasted in.
    // Without the fragment rule each of these linked a spell: "Fear",
    // "Shield", "Slow" and "Guidance".
    const reported = ["Dragon Fear", "Shield Master", "Slow Fall", "Magical Guidance"];
    const found = new Map();
    for (const { text } of bullets) {
      const cut = text.indexOf(": ");
      if (cut <= 0) continue;
      // The compiled data writes some of these with a trailing qualifier
      // ("Magical Guidance (Optional)"), so match on the stem.
      const name = text.slice(0, cut);
      const stem = reported.find((r) => name.startsWith(r));
      if (!stem) continue;
      if (!found.has(stem)) found.set(stem, []);
      found.get(stem).push(...findSpellMentions(text).filter((h) => h.start < cut).map((h) => h.name));
    }
    assert.deepEqual([...found.keys()].sort(), [...reported].sort(),
      `all four are real bullets to check (${[...found.keys()].join(", ") || "none found"})`);
    for (const [stem, hits] of found) assert.deepEqual(hits, [], `${stem} links ${hits.join(", ")} out of its own name`);
  });
});

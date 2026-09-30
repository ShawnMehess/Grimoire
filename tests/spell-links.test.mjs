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
  SPELL_LINK_DENYLIST,
} from "../js/data/spellIndex.js";
import { FIXED_RACE_ENTRIES, FIXED_CLASS_ENTRIES } from "../js/data/contentFixups.js";
import { FEAT_BUNDLES } from "../js/data/featBundles.js";

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

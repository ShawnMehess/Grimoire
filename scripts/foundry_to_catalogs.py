#!/usr/bin/env python3
"""
foundry_to_catalogs.py

Converts a Foundry VTT "5e-complete"-style module — NeDB compendium
packs, one JSON object per line, under a packs/ folder — into the exact
JSON shape Character Vault's Catalogs importer expects:
{ name, archetype, tabs }. This is the same shape as the hand-authored
examples already in the repo (default-catalogs/feats.json,
adventuring-gear.json, spell-list.json) — output from this script drops
into the same "Catalogs -> Import JSON" flow described in
default-catalogs/README.md.

Usage:
    python3 foundry_to_catalogs.py /path/to/5e-complete-main/packs ./out

Reads, if present in the given packs/ folder:
    5e-spells.db       -> out/spell-list.json    (Cantrips .. 9th Level tabs)
    5e-feats.db        -> out/feats.json         (single Feats tab)
    5e-items.db        -> out/weapons-armor.json    (Weapons + Armor tabs)
                       -> out/adventuring-gear.json (everything else: general
                          gear, consumables, tools, containers)
    5e-classes.db      -> out/classes.json       (Classes + Subclasses tabs)
    5e-class-features.db, 5e-subclasses.db (feed classes.json above)
    5e-races.db        -> out/races.json         (single Races tab)
    5e-racial-features.db (feeds races.json above)
    5e-backgrounds.db  -> out/backgrounds.json   (single Backgrounds tab)
    5e-background-features.db (feeds backgrounds.json above)

A file that isn't present is just skipped (a warning is printed) — you
don't need the whole module, e.g. running this against only a
5e-spells.db still produces spell-list.json.

A note on classes/races/backgrounds specifically: these correspond to
"Bundles" in Character Vault (see default-bundles/README.md), not
"Catalogs" — a bundle's whole point is granting specific stat bonuses
to specific FIELDS ON YOUR SHEET, and this source data has no way of
knowing your field names or ids. So these are converted here the same
way feats.json treats feats: as reference-only Catalogs, no stat
wiring. The field ids used (hitDie, savingThrowProficiencies, size,
speed, abilityScoreIncrease, skillProficiencies, etc.) are chosen to
match what a real Class/Race/Background Bundle's fields would
logically be named later, once bundle-building against this data
becomes worth doing — so this content can be re-pointed at real
fields then instead of re-entered.

Deliberately NOT converted here, and why:
  - 5e-creatures.db (the biggest pack by far, ~39MB of monster stat
    blocks) — Character Vault has no monster/stat-block data type;
    it's a player-character sheet builder. There's nothing to map a
    monster onto.
  - 5e-journals.db, 5e-roll-tables.db, 5e-trade-goods.db,
    5e-macros.db — narrative handouts, GM roll tables, and Foundry
    automation macros. Nothing in this app has a slot for any of them.

A heads-up on the source data itself: this module's name ("5e-complete")
undersells it a little — it's not just the free SRD. Skimming the item
pack alone turned up DMG-only magic items (Vicious Shortbow, Cloak of
Displacement, etc.) and similar non-SRD material mixed in with the SRD
content. Worth knowing if you only meant to bring in SRD-licensed
content specifically; this script doesn't try to filter by source book,
it just carries over whatever's in the file.

Only the Python standard library is used — nothing to pip install.
"""

import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path


# --- HTML -> plain text -----------------------------------------------
#
# Foundry stores every description as an HTML string (<p>, <ul>/<li>,
# <strong>, the occasional <section class="secret"> GM-only aside).
# This app's catalog fields are just plain text boxes, so descriptions
# get flattened: paragraphs and list items become their own lines,
# every tag's own markup is dropped, and only the text inside survives.

class _TextExtractor(HTMLParser):
    BLOCK_TAGS = {"p", "div", "section", "ul", "ol", "table", "tr",
                  "h1", "h2", "h3", "h4"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.chunks = []

    def handle_starttag(self, tag, attrs):
        if tag == "li":
            self.chunks.append("\n- ")
        elif tag == "br":
            self.chunks.append("\n")
        elif tag in self.BLOCK_TAGS:
            self.chunks.append("\n")

    def handle_endtag(self, tag):
        if tag in self.BLOCK_TAGS:
            self.chunks.append("\n")

    def handle_data(self, data):
        self.chunks.append(data)


def resolve_refs(text):
    """Foundry stores cross-references as literal inline markup, not
    HTML tags, so the HTML parser above leaves them as-is:
      @Compendium[5e-complete.5e-items.abc123]{Longsword}
      @UUID[Compendium.5e-complete.5e-journals.xyz789]{Multiclassing Rules}
      [[/roll 8d4 * 10]]
    This was left unhandled by the original conversion (feats.json,
    spell-list.json, and adventuring-gear.json all still contain raw
    @Compendium/@UUID markup) — cleaned up here since it reads as
    broken/leftover markup otherwise. References collapse to their
    display label; inline rolls collapse to a plain "(formula)"."""
    text = re.sub(r"@(?:Compendium|UUID)\[[^\]]*\]\{([^}]*)\}", r"\1", text)
    # A handful of refs in this data have no {Label} at all — drop them
    # rather than leave the raw bracket syntax in place.
    text = re.sub(r"@(?:Compendium|UUID)\[[^\]]*\]", "", text)
    text = re.sub(r"\[\[/(?:gm)?roll\s+([^\]]+?)\]\]", r"(\1)", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text


def html_to_text(raw):
    """Flattens a Foundry description.value HTML string to clean plain
    text — blank-line-separated paragraphs, "- " prefixed list items,
    everything else unwrapped down to its text content."""
    if not raw:
        return ""
    parser = _TextExtractor()
    parser.feed(raw)
    text = html.unescape("".join(parser.chunks))
    text = resolve_refs(text)
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.split("\n")]
    # collapse repeated blank lines down to one
    out = []
    for ln in lines:
        if ln or (out and out[-1] != ""):
            out.append(ln)
    return "\n".join(out).strip()


def get_system(d):
    """Most packs in this module use the modern "system" key, but the
    races and a chunk of the racial-features pack were authored on an
    older dnd5e schema version that used "data" instead. Same shape
    either way, so just take whichever is present."""
    return d.get("system") or d.get("data") or {}


def build_feature_lookup(packs_dir, filename):
    """Maps a features pack's Foundry _id -> (name, plain-text description),
    for resolving the @Compendium[...]{Label} links that class/race/
    background entries use to point at their granted features."""
    lookup = {}
    for d in load_ndjson(packs_dir / filename):
        fid = d.get("_id")
        if not fid:
            continue
        text = html_to_text((get_system(d).get("description") or {}).get("value"))
        lookup[fid] = (d.get("name", "Unnamed Feature"), text)
    return lookup


def compendium_ids_in_order(items):
    """Pulls the bare ids out of a list of
    "Compendium.5e-complete.<pack>.<id>" advancement-config strings,
    preserving order (order here is the book's presentation order,
    which load-order through a dict would not otherwise guarantee)."""
    return [ref.rsplit(".", 1)[-1] for ref in items or []]


def first_sentence(text, limit=160):
    """A short blurb for the entry's "description" field — the full
    text goes in "effect" instead, matching how the hand-authored
    default catalogs split a one-line summary from the full rules
    text (see e.g. default-catalogs/feats.json)."""
    flat = text.replace("\n", " ").strip()
    if not flat:
        return ""
    m = re.match(r"(.{1,%d}?[.!?])(\s|$)" % limit, flat)
    if m:
        return m.group(1).strip()
    if len(flat) <= limit:
        return flat
    return flat[:limit].rsplit(" ", 1)[0].strip() + "…"


# --- NDJSON loading ------------------------------------------------------

def load_ndjson(path):
    """Reads a Foundry .db pack: one JSON object per line. Skips any
    line that doesn't parse rather than aborting the whole file —
    these packs occasionally have stray blank lines."""
    items = []
    if not path.exists():
        print(f"  (skipping — {path.name} not found)")
        return items
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                items.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return items


# --- Catalog JSON shape ----------------------------------------------

def make_entry(name, description, field_values):
    return {
        "id": None,
        "name": name,
        "description": description,
        "imageData": None,
        "archetypeDiff": {
            "acquisitionCosts": {"added": [], "removed": []},
            "requirements": {"added": [], "removed": []},
            "effects": {"added": [], "removed": []},
        },
        "fieldValues": field_values,
    }


def make_tab(tab_id, name, entries, added_costs=None, added_reqs=None, added_effects=None):
    return {
        "id": tab_id,
        "name": name,
        "archetypeDiff": {
            "acquisitionCosts": {"added": added_costs or [], "removed": []},
            "requirements": {"added": added_reqs or [], "removed": []},
            "effects": {"added": added_effects or [], "removed": []},
        },
        "entries": entries,
    }


def make_catalog(name, requirements, effects, tabs, acquisition_costs=None):
    return {
        "name": name,
        "archetype": {
            "acquisitionCosts": acquisition_costs or [],
            "requirements": requirements,
            "effects": effects,
        },
        "tabs": tabs,
    }


def field(field_id, label, kind="text"):
    return {"id": field_id, "label": label, "kind": kind}


# --- Spells -> spell-list.json ----------------------------------------

SPELL_LEVELS = {
    0: ("cantrips", "Cantrips"), 1: ("level-1", "1st Level"),
    2: ("level-2", "2nd Level"), 3: ("level-3", "3rd Level"),
    4: ("level-4", "4th Level"), 5: ("level-5", "5th Level"),
    6: ("level-6", "6th Level"), 7: ("level-7", "7th Level"),
    8: ("level-8", "8th Level"), 9: ("level-9", "9th Level"),
}

ACTIVATION_UNITS = {
    "action": "1 action", "bonus": "1 bonus action", "reaction": "1 reaction",
    "minute": "minute(s)", "hour": "hour(s)", "special": "Special", "none": "",
}

DURATION_UNITS = {
    "inst": "Instantaneous", "round": "round(s)", "minute": "minute(s)",
    "hour": "hour(s)", "day": "day(s)", "spec": "Special", "perm": "Until dispelled",
}


def spell_casting_time(system):
    act = system.get("activation") or {}
    unit = act.get("type") or ""
    cost = act.get("cost")
    label = ACTIVATION_UNITS.get(unit, unit)
    if unit in ("minute", "hour") and cost:
        text = f"{cost} {label}"
    else:
        text = label
    comps = system.get("components") or {}
    if comps.get("ritual"):
        text = f"{text} (Ritual)" if text else "Ritual"
    return text or "-"


def spell_range(system):
    rng = system.get("range") or {}
    units = rng.get("units") or ""
    value = rng.get("value")
    if units == "touch":
        return "Touch"
    if units == "self":
        return "Self"
    if units == "spec":
        return "Special"
    if value:
        return f"{value} {units}".strip()
    return "-"


def spell_duration(system):
    dur = system.get("duration") or {}
    units = dur.get("units") or ""
    value = dur.get("value")
    label = DURATION_UNITS.get(units, units)
    if units in ("round", "minute", "hour", "day") and value:
        return f"{value} {label}"
    return label or "-"


def convert_spells(packs_dir):
    raw = load_ndjson(packs_dir / "5e-spells.db")
    by_level = {lvl: [] for lvl in SPELL_LEVELS}
    skipped = 0
    for d in raw:
        if d.get("type") != "spell":
            continue
        system = d.get("system") or {}
        level = system.get("level")
        if level not in SPELL_LEVELS:
            skipped += 1
            continue
        text = html_to_text((system.get("description") or {}).get("value"))
        comps = system.get("components") or {}
        entry = make_entry(
            name=d.get("name", "Unnamed Spell"),
            description=first_sentence(text),
            field_values={
                "castingTime": spell_casting_time(system),
                "range": spell_range(system),
                "duration": spell_duration(system),
                "concentration": "Yes" if comps.get("concentration") else "No",
                "effect": text,
            },
        )
        by_level[level].append(entry)

    tabs = []
    for lvl, (tab_id, tab_name) in SPELL_LEVELS.items():
        entries = sorted(by_level[lvl], key=lambda e: e["name"])
        if entries:
            tabs.append(make_tab(tab_id, tab_name, entries))

    if skipped:
        print(f"  ({skipped} spell(s) skipped — missing/unrecognized level)")

    # Acquisition Costs deliberately stays empty — see
    # default-catalogs/README.md's note on spell-list.json: every
    # character's spell-slot field is named differently (or may not
    # exist), so a global catalog can't safely assume one. Link slot
    # fields per-tab after importing, via each tab's Fields panel.
    return make_catalog(
        name="Spell List",
        requirements=[
            field("castingTime", "Casting Time"),
            field("range", "Range"),
            field("duration", "Duration"),
            field("concentration", "Concentration"),
        ],
        effects=[field("effect", "Effect")],
        tabs=tabs,
    )


# --- Feats -> feats.json -----------------------------------------------

def convert_feats(packs_dir):
    raw = load_ndjson(packs_dir / "5e-feats.db")
    entries = []
    for d in raw:
        if d.get("type") != "feat":
            continue
        system = d.get("system") or {}
        text = html_to_text((system.get("description") or {}).get("value"))
        if not text:
            continue
        # system.requirements in this data is inconsistent (often just
        # the literal string "Feat", not an actual prerequisite like
        # "Str 13+") — not reliable enough to surface as Prerequisite,
        # so this is left as an em dash like the hand-authored feats.json
        # does for feats with no prerequisite, rather than showing
        # something misleading.
        entries.append(make_entry(
            name=d.get("name", "Unnamed Feat"),
            description=first_sentence(text),
            field_values={"prerequisite": "\u2014", "effect": text},
        ))
    entries.sort(key=lambda e: e["name"])
    return make_catalog(
        name="Feats",
        requirements=[field("prerequisite", "Prerequisite")],
        effects=[field("effect", "Effect")],
        tabs=[make_tab("feats", "Feats", entries)],
    )


# --- Items -> weapons-armor.json + adventuring-gear.json -----------------

WEAPON_PROPERTIES = {
    "ada": "Adamantine", "amm": "Ammunition", "fin": "Finesse",
    "fir": "Firearm", "foc": "Focus", "hvy": "Heavy", "lgt": "Light",
    "lod": "Loading", "mgc": "Magical", "rch": "Reach", "rel": "Reload",
    "ret": "Returning", "sil": "Silvered", "spc": "Special",
    "thr": "Thrown", "two": "Two-Handed", "ver": "Versatile",
}

ARMOR_TYPES = {"light", "medium", "heavy", "shield"}


def format_price(price):
    if not price:
        return "-"
    try:
        price = float(price)
    except (TypeError, ValueError):
        return "-"
    if price == int(price):
        return f"{int(price)} gp"
    return f"{price:g} gp"


def format_weight(weight):
    if weight is None or weight == "":
        return "-"
    try:
        weight = float(weight)
    except (TypeError, ValueError):
        return "-"
    return str(int(weight)) if weight == int(weight) else f"{weight:g}"


def format_damage(system):
    parts = ((system.get("damage") or {}).get("parts")) or []
    formulas = []
    for part in parts:
        if not part:
            continue
        formula = (part[0] or "").strip()
        dtype = part[1] if len(part) > 1 else ""
        formula = re.sub(r"\s*\+\s*@mod\b", "", formula)
        formula = re.sub(r"@mod\b", "ability modifier", formula)
        formulas.append(f"{formula} {dtype}".strip())
    return ", ".join(formulas) if formulas else "-"


def format_properties(system):
    props = system.get("properties") or {}
    names = [label for code, label in WEAPON_PROPERTIES.items() if props.get(code)]
    return ", ".join(sorted(names)) if names else "-"


def format_ac(armor):
    value = armor.get("value")
    atype = armor.get("type")
    if value is None:
        return "-"
    if atype == "light":
        return f"{value} + Dex modifier"
    if atype == "medium":
        return f"{value} + Dex modifier (max 2)"
    if atype == "shield":
        return f"+{value}"
    return str(value)  # heavy armor — flat AC, no Dex


def convert_items(packs_dir):
    raw = load_ndjson(packs_dir / "5e-items.db")
    weapons, armor_pieces, gear = [], [], []

    for d in raw:
        itype = d.get("type")
        system = d.get("system") or {}
        name = d.get("name")
        if not name:
            continue
        text = html_to_text((system.get("description") or {}).get("value"))
        cost = format_price(system.get("price"))
        weight = format_weight(system.get("weight"))

        if itype == "weapon":
            weapons.append(make_entry(
                name=name, description=first_sentence(text) or name,
                field_values={
                    "cost": cost, "weight": weight,
                    "damage": format_damage(system),
                    "properties": format_properties(system),
                },
            ))
            continue

        armor = system.get("armor") or {}
        if itype == "equipment" and armor.get("type") in ARMOR_TYPES:
            armor_pieces.append(make_entry(
                name=name, description=first_sentence(text) or name,
                field_values={
                    "cost": cost, "weight": weight,
                    "ac": format_ac(armor),
                    "stealth": "Disadvantage" if system.get("stealth") else "\u2014",
                },
            ))
            continue

        # Everything else — general equipment, consumables, tools, loot,
        # containers — goes in the plain cost/weight gear catalog, the
        # same treatment default-catalogs/adventuring-gear.json gives
        # anything that isn't specifically a weapon or a piece of armor.
        gear.append(make_entry(
            name=name, description=first_sentence(text) or name,
            field_values={"cost": cost, "weight": weight},
        ))

    weapons.sort(key=lambda e: e["name"])
    armor_pieces.sort(key=lambda e: e["name"])
    gear.sort(key=lambda e: e["name"])

    weapons_armor = make_catalog(
        name="Weapons & Armor",
        requirements=[field("weight", "Weight (lb)")],
        effects=[],
        acquisition_costs=[field("cost", "Cost")],
        tabs=[
            make_tab("weapons", "Weapons", weapons, added_effects=[
                field("damage", "Damage"), field("properties", "Properties"),
            ]),
            make_tab("armor", "Armor", armor_pieces, added_effects=[
                field("ac", "Armor Class"), field("stealth", "Stealth Penalty"),
            ]),
        ],
    )
    adventuring_gear = make_catalog(
        name="Adventuring Gear",
        requirements=[field("weight", "Weight (lb)")],
        effects=[],
        acquisition_costs=[field("cost", "Cost")],
        tabs=[make_tab("gear", "Adventuring Gear", gear)],
    )
    return weapons_armor, adventuring_gear


# --- Classes -> classes.json --------------------------------------------
#
# Character Vault doesn't have a class sheet-template yet, so there's no
# real field to grant a stat bonus onto — that's why these were left out
# of the first pass (see module docstring). This treats classes as a
# reference Catalog instead, the same way feats.json is a reference
# catalog and not a Bundle: no stat wiring, just the class's PHB info
# filled into plainly-named fields (hitDie, savingThrowProficiencies,
# etc.) chosen to match what a future Class Bundle's fields would
# logically be named, so this data can be re-pointed at real fields
# later instead of re-entered.

ABILITY_NAMES = {
    "str": "Strength", "dex": "Dexterity", "con": "Constitution",
    "int": "Intelligence", "wis": "Wisdom", "cha": "Charisma",
}

SKILL_NAMES = {
    "acr": "Acrobatics", "ani": "Animal Handling", "arc": "Arcana",
    "ath": "Athletics", "dec": "Deception", "his": "History",
    "ins": "Insight", "itm": "Intimidation", "inv": "Investigation",
    "med": "Medicine", "nat": "Nature", "prc": "Perception",
    "prf": "Performance", "per": "Persuasion", "rel": "Religion",
    "slt": "Sleight of Hand", "ste": "Stealth", "sur": "Survival",
}

SPELLCASTING_LABELS = {
    "full": "Full caster", "half": "Half caster", "third": "Third caster",
    "pact": "Pact magic caster", "artificer": "Half caster (Artificer)",
    "none": "", "": "",
}

PROFICIENCY_LABELS = [
    ("armorProficiencies", "Armor:"), ("weaponProficiencies", "Weapons:"),
    ("toolProficiencies", "Tools:"), ("skillProficiencies", "Skills:"),
]


def extract_labeled_line(text, label):
    """Pulls the rest of the line following a "Label: value" line that
    Foundry's class/background descriptions consistently use for their
    proficiency/equipment summary block, e.g. "Armor: All armor,
    shields". Returns "-" if the label never appears."""
    m = re.search(re.escape(label) + r"\s*(.+)", text)
    return m.group(1).strip() if m and m.group(1).strip() else "-"


def compile_features_by_level(advancement, feature_lookup):
    """Walks a class or subclass's "advancement" list (ItemGrant entries
    keyed by level) and stitches each granted feature's full text in
    underneath its level heading, using feature_lookup to resolve the
    ids. This is the actual level-by-level class feature reference —
    the class's own description.value only lists feature *names* in its
    advancement table, linked out to this separate features pack."""
    by_level = {}
    for adv in advancement or []:
        if adv.get("type") != "ItemGrant":
            continue
        level = adv.get("level")
        ids = compendium_ids_in_order(adv.get("configuration", {}).get("items"))
        for fid in ids:
            name, text = feature_lookup.get(fid, (None, None))
            if name:
                by_level.setdefault(level, []).append((name, text))

    chunks = []
    for level in sorted((lv for lv in by_level if lv is not None), key=int):
        heading = f"Level {level}"
        chunks.append(heading)
        for name, text in by_level[level]:
            chunks.append(f"{name}\n{text}" if text else name)
    return "\n\n".join(chunks).strip() or "-"


def convert_classes(packs_dir):
    raw_classes = load_ndjson(packs_dir / "5e-classes.db")
    raw_subclasses = load_ndjson(packs_dir / "5e-subclasses.db")
    feature_lookup = build_feature_lookup(packs_dir, "5e-class-features.db")
    if not raw_classes:
        return None

    class_entries = []
    for d in raw_classes:
        system = get_system(d)
        text = html_to_text((system.get("description") or {}).get("value"))
        prof = {fid: extract_labeled_line(text, label) for fid, label in PROFICIENCY_LABELS}
        saves = ", ".join(ABILITY_NAMES.get(a, a) for a in (system.get("saves") or []))
        skills_cfg = system.get("skills") or {}
        n = skills_cfg.get("number")
        choices = ", ".join(SKILL_NAMES.get(s, s) for s in (skills_cfg.get("choices") or []))
        skill_summary = f"Choose {n} from {choices}" if choices else prof["skillProficiencies"]

        spellcasting = system.get("spellcasting") or {}
        ability = ABILITY_NAMES.get(spellcasting.get("ability"), "")
        progression = SPELLCASTING_LABELS.get(spellcasting.get("progression"), "")
        spell_text = f"{progression} ({ability})" if progression and ability else (progression or "-")

        equip_match = re.search(
            r"(?:Equipment\b.*?\n)(.+?)(?:\n(?:Alternatively|$))", text, re.S)
        equip_text = equip_match.group(1).strip() if equip_match else "-"

        class_entries.append(make_entry(
            name=d.get("name", "Unnamed Class"),
            description=first_sentence(text) or d.get("name", ""),
            field_values={
                "hitDie": system.get("hitDice") or "-",
                "savingThrowProficiencies": saves or "-",
                "armorProficiencies": prof["armorProficiencies"],
                "weaponProficiencies": prof["weaponProficiencies"],
                "toolProficiencies": prof["toolProficiencies"],
                "skillProficiencies": skill_summary,
                "startingEquipment": equip_text,
                "spellcastingAbility": spell_text,
                "classFeatures": compile_features_by_level(
                    system.get("advancement"), feature_lookup),
            },
        ))
    class_entries.sort(key=lambda e: e["name"])

    subclass_entries = []
    for d in raw_subclasses:
        system = get_system(d)
        text = html_to_text((system.get("description") or {}).get("value"))
        spellcasting = system.get("spellcasting") or {}
        ability = ABILITY_NAMES.get(spellcasting.get("ability"), "")
        progression = SPELLCASTING_LABELS.get(spellcasting.get("progression"), "")
        spell_text = f"{progression} ({ability})" if progression and ability else (progression or "-")
        class_id = system.get("classIdentifier") or ""
        class_name = class_id.replace("-", " ").title()

        subclass_entries.append(make_entry(
            name=d.get("name", "Unnamed Subclass"),
            description=first_sentence(text) or d.get("name", ""),
            field_values={
                "parentClass": class_name or "-",
                "spellcastingAbility": spell_text,
                "subclassFeatures": compile_features_by_level(
                    system.get("advancement"), feature_lookup),
            },
        ))
    subclass_entries.sort(key=lambda e: (e["fieldValues"]["parentClass"], e["name"]))

    return make_catalog(
        name="Classes",
        requirements=[
            field("hitDie", "Hit Die"),
            field("savingThrowProficiencies", "Saving Throw Proficiencies"),
        ],
        effects=[
            field("armorProficiencies", "Armor Proficiencies"),
            field("weaponProficiencies", "Weapon Proficiencies"),
            field("toolProficiencies", "Tool Proficiencies"),
            field("skillProficiencies", "Skill Proficiencies"),
            field("startingEquipment", "Starting Equipment"),
            field("spellcastingAbility", "Spellcasting"),
            field("classFeatures", "Class Features"),
        ],
        tabs=[
            make_tab("classes", "Classes", class_entries),
            make_tab("subclasses", "Subclasses", subclass_entries,
                     added_reqs=[field("parentClass", "Class")],
                     added_effects=[field("subclassFeatures", "Subclass Features")]),
        ],
    )


# --- Races -> races.json ------------------------------------------------
#
# Same reasoning as classes: no Race Bundle/sheet-template exists yet to
# wire an Ability Score Increase onto, so this is a reference Catalog
# with plainly-named fields (size, speed, abilityScoreIncrease, ...)
# standing in for what a future Race Bundle's fields would be named.

SIZE_WORDS = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"]


# The fixed set of bolded trait labels the PHB race write-ups use, in
# no particular order — needed as a "stop list" below because a couple
# of races (Gnome, at least) run two labels together in a single
# paragraph ("Your size is Small. Speed. Your base walking speed...")
# instead of giving Speed its own paragraph like every other race does.
RACE_TRAIT_LABELS = [
    "Ability Score Increase", "Age", "Alignment", "Size", "Speed",
    "Languages", "Darkvision", "Subrace", "Alternatively",
]


def extract_after_label(text, label_pattern):
    """Foundry's race prose bolds each trait's label
    ("<strong>Size.</strong> Dwarves stand..."), almost always as the
    start of its own paragraph. This finds the label — wherever it
    falls — and returns the text after it, stopped at whichever comes
    first: another known trait label, or the end of the paragraph."""
    stop = "|".join(re.escape(w) for w in RACE_TRAIT_LABELS)
    m = re.search(
        label_pattern + r"\s*(.+?)(?=\s(?:" + stop + r")\.|\n\n|\Z)",
        text, re.S)
    return m.group(1).strip() if m and m.group(1).strip() else None


def convert_races(packs_dir):
    raw_races = load_ndjson(packs_dir / "5e-races.db")
    if not raw_races:
        return None
    feature_lookup = build_feature_lookup(packs_dir, "5e-racial-features.db")

    entries = []
    for d in raw_races:
        system = get_system(d)
        raw_html = (system.get("description") or {}).get("value") or ""
        # Grab the linked subrace/variant ids before flattening — their
        # full text gets appended after the main trait text below.
        linked_ids = compendium_ids_in_order(re.findall(
            r"@Compendium\[[^\]]*5e-racial-features\.([A-Za-z0-9]+)\]", raw_html))
        text = html_to_text(raw_html)

        size_text = extract_after_label(text, r"Size\.?") or ""
        size_words = [w for w in SIZE_WORDS if re.search(rf"\b{w}\b", size_text)]
        size = " or ".join(size_words) if size_words else (size_text[:60] or "-")

        speed_text = extract_after_label(text, r"Speed\.?") or ""
        speed_m = re.search(r"(\d+)\s*feet", speed_text)
        speed = f"{speed_m.group(1)} ft." if speed_m else (speed_text[:60] or "-")

        asi = extract_after_label(text, r"Ability Score Increase\.?") or "-"
        languages = extract_after_label(text, r"Languages?\.?") or "-"

        variant_text = "\n\n".join(
            f"{feature_lookup[fid][0]}\n{feature_lookup[fid][1]}"
            for fid in linked_ids if fid in feature_lookup
        )
        traits = text + (f"\n\n{variant_text}" if variant_text else "")

        entries.append(make_entry(
            name=d.get("name", "Unnamed Race"),
            description=first_sentence(text) or d.get("name", ""),
            field_values={
                "size": size,
                "speed": speed,
                "abilityScoreIncrease": asi,
                "languages": languages,
                "traits": traits,
            },
        ))
    entries.sort(key=lambda e: e["name"])

    return make_catalog(
        name="Races",
        requirements=[field("size", "Size"), field("speed", "Speed")],
        effects=[
            field("abilityScoreIncrease", "Ability Score Increase"),
            field("languages", "Languages"),
            field("traits", "Traits"),
        ],
        tabs=[make_tab("races", "Races", entries)],
    )


# --- Backgrounds -> backgrounds.json -------------------------------------
#
# Same reasoning again: reference Catalog, plainly-named fields standing
# in for a future Background Bundle's real field ids.

def convert_backgrounds(packs_dir):
    raw_backgrounds = load_ndjson(packs_dir / "5e-backgrounds.db")
    if not raw_backgrounds:
        return None
    feature_lookup = build_feature_lookup(packs_dir, "5e-background-features.db")

    entries = []
    for d in raw_backgrounds:
        system = get_system(d)
        raw_html = (system.get("description") or {}).get("value") or ""
        linked_ids = compendium_ids_in_order(re.findall(
            r"@Compendium\[[^\]]*5e-background-features\.([A-Za-z0-9]+)\]", raw_html))
        text = html_to_text(raw_html)

        skills = extract_labeled_line(text, "Skill Proficiencies:")
        tools = extract_labeled_line(text, "Tool Proficiencies:")
        languages = extract_labeled_line(text, "Languages:")
        equipment = extract_labeled_line(text, "Equipment:")

        feature_text = "\n\n".join(
            f"{feature_lookup[fid][0]}\n{feature_lookup[fid][1]}"
            for fid in linked_ids if fid in feature_lookup
        )

        entries.append(make_entry(
            name=d.get("name", "Unnamed Background"),
            description=first_sentence(text) or d.get("name", ""),
            field_values={
                "skillProficiencies": skills,
                "toolProficiencies": tools,
                "languages": languages,
                "equipment": equipment,
                "feature": feature_text or "-",
            },
        ))
    entries.sort(key=lambda e: e["name"])

    return make_catalog(
        name="Backgrounds",
        requirements=[],
        effects=[
            field("skillProficiencies", "Skill Proficiencies"),
            field("toolProficiencies", "Tool Proficiencies"),
            field("languages", "Languages"),
            field("equipment", "Equipment"),
            field("feature", "Feature"),
        ],
        tabs=[make_tab("backgrounds", "Backgrounds", entries)],
    )


# --- Entry point -----------------------------------------------------

def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)

    packs_dir = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)

    print("Converting spells...")
    spells = convert_spells(packs_dir)
    spell_count = sum(len(t["entries"]) for t in spells["tabs"])
    (out_dir / "spell-list.json").write_text(json.dumps(spells, indent=2), encoding="utf-8")
    print(f"  wrote {spell_count} spells -> {out_dir / 'spell-list.json'}")

    print("Converting feats...")
    feats = convert_feats(packs_dir)
    feat_count = len(feats["tabs"][0]["entries"]) if feats["tabs"] else 0
    (out_dir / "feats.json").write_text(json.dumps(feats, indent=2), encoding="utf-8")
    print(f"  wrote {feat_count} feats -> {out_dir / 'feats.json'}")

    print("Converting items...")
    weapons_armor, gear = convert_items(packs_dir)
    wa_count = sum(len(t["entries"]) for t in weapons_armor["tabs"])
    gear_count = sum(len(t["entries"]) for t in gear["tabs"])
    (out_dir / "weapons-armor.json").write_text(json.dumps(weapons_armor, indent=2), encoding="utf-8")
    (out_dir / "adventuring-gear.json").write_text(json.dumps(gear, indent=2), encoding="utf-8")
    print(f"  wrote {wa_count} weapons/armor -> {out_dir / 'weapons-armor.json'}")
    print(f"  wrote {gear_count} other items -> {out_dir / 'adventuring-gear.json'}")

    print("Converting classes...")
    classes = convert_classes(packs_dir)
    if classes:
        class_count = len(classes["tabs"][0]["entries"])
        subclass_count = len(classes["tabs"][1]["entries"])
        (out_dir / "classes.json").write_text(json.dumps(classes, indent=2), encoding="utf-8")
        print(f"  wrote {class_count} classes, {subclass_count} subclasses -> {out_dir / 'classes.json'}")

    print("Converting races...")
    races = convert_races(packs_dir)
    if races:
        race_count = len(races["tabs"][0]["entries"])
        (out_dir / "races.json").write_text(json.dumps(races, indent=2), encoding="utf-8")
        print(f"  wrote {race_count} races -> {out_dir / 'races.json'}")

    print("Converting backgrounds...")
    backgrounds = convert_backgrounds(packs_dir)
    if backgrounds:
        bg_count = len(backgrounds["tabs"][0]["entries"])
        (out_dir / "backgrounds.json").write_text(json.dumps(backgrounds, indent=2), encoding="utf-8")
        print(f"  wrote {bg_count} backgrounds -> {out_dir / 'backgrounds.json'}")

    print(f"\nDone. In the app: toolbar -> Catalogs -> Import JSON -> "
          f"paste the contents of any file in {out_dir}/")


if __name__ == "__main__":
    main()

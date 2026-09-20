"""Generate AI portrait busts via the keyless Pollinations API, crop the
watermark band, and save as repo assets. Usage:
  python3 gen-portraits.py [start] [end]
e.g. `python3 gen-portraits.py 0 6` does entries 0..5.
"""
import io
import sys
import time
import urllib.parse
import urllib.request

from PIL import Image

STYLE = (", fantasy character portrait bust, centered, painterly, "
         "plain dark background, no text, no watermark, no logo")

# (asset key, prompt head, seed)
PORTRAITS = [
    ("class-barbarian", "raging barbarian warrior with tribal war paint, fur and axes", 101),
    ("class-bard", "cheerful bard minstrel with a lute and feathered hat", 102),
    ("class-cleric", "noble cleric priest in ornate golden vestments holding a holy symbol", 103),
    ("class-druid", "druid with an antler headdress, leaves tangled in hair, an owl on the shoulder", 104),
    ("class-fighter", "seasoned knight fighter in steel plate armor", 105),
    ("class-monk", "bald monk warrior with prayer beads and dragon tattoos", 106),
    ("class-paladin", "paladin holy knight in gleaming armor with a sun emblem, soft radiant glow", 107),
    ("class-ranger", "hooded ranger archer with a longbow, forest cloak", 108),
    ("class-rogue", "sly rogue thief with a dark hood and half-mask, daggers", 109),
    ("class-sorcerer", "sorceress with crackling blue arcane magic swirling around her hands", 110),
    ("class-warlock", "sinister warlock wreathed in purple shadow magic, glowing violet eyes", 111),
    ("class-wizard", "elderly wizard with a long grey beard, pointed hat and staff", 112),
    ("race-human", "human villager portrait, plain medieval clothes", 201),
    ("race-elf", "elegant elf with long pointed ears and silver hair", 202),
    ("race-half-elf", "half-elf with slightly pointed ears and warm smile", 203),
    ("race-dwarf", "stocky dwarf warrior with a long braided brown beard", 204),
    ("race-hill-dwarf", "jolly hill dwarf with a red beard holding a foaming mug", 205),
    ("race-mountain-dwarf", "stern mountain dwarf in heavy armor with a grey beard", 206),
    ("race-duergar", "grim grey-skinned duergar dwarf, bald, glowing pale eyes", 207),
    ("race-gnome", "cheerful gnome tinkerer with a big nose and pointed cap, goggles", 208),
    ("race-halfling", "merry halfling with curly hair and rosy cheeks", 209),
    ("race-dragonborn", "proud dragonborn warrior with bronze draconic head and scales", 210),
    ("race-tiefling", "tiefling with curved horns and crimson skin, sly grin", 211),
    ("race-aarakocra", "noble aarakocra eagle-headed humanoid with white feathers", 212),
    ("race-aasimar", "radiant aasimar angel with glowing eyes and white wings", 213),
    ("race-air-genasi", "air genasi with storm-blue skin and windblown flowing hair", 214),
    ("race-changeling", "mysterious changeling with shifting featureless pale face and white eyes", 215),
    ("race-custom-lineage", "enigmatic masked wanderer in a high-collared cloak", 216),
    ("race-half-orc", "fierce half-orc warrior with tusks and green skin", 217),
    ("race-yuan-ti", "sinister yuan-ti pureblood with serpent eyes and green scales", 218),
    ("bg-acolyte", "devout acolyte priest in white and gold temple robes", 301),
    ("bg-entertainer", "flamboyant entertainer juggler in colorful jester costume", 302),
    ("bg-folk-hero", "humble folk hero peasant holding a pitchfork, kind brave face", 303),
    ("bg-guild-artisan", "burly guild blacksmith in leather apron holding a hammer", 304),
    ("bg-noble", "arrogant noble lord in regal velvet attire with a golden circlet", 305),
    ("bg-outlander", "wild outlander hunter wrapped in furs with tribal paint", 306),
    ("bg-sage", "elderly sage scholar in robes with spectacles, books behind", 307),
    ("bg-sailor", "weathered sailor with a tricorn hat and rope over the shoulder", 308),
    ("bg-urban-bounty-hunter", "hooded city bounty hunter with a crossbow at night", 309),
]

OUT_DIR = "assets/portraits"


def fetch(key, head, seed):
    prompt = head + STYLE
    url = ("https://image.pollinations.ai/prompt/"
           + urllib.parse.quote(prompt, safe='')
           + f"?width=384&height=416&seed={seed}&nologo=true&model=flux")
    req = urllib.request.Request(url, headers={"User-Agent": "GrimoireCharacterVault/1.0 hobby site"})
    last_err = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = resp.read()
            break
        except Exception as exc:  # noqa: BLE001 - retry transient net hiccups
            last_err = exc
            print(f"  retry {attempt + 1} for {key}: {exc}", flush=True)
            time.sleep(15)
    else:
        print(f"FAIL {key}: {last_err}", flush=True)
        return False
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL {key}: bad image ({exc})", flush=True)
        return False
    w, h = img.size
    # Drop the bottom strip where the provider watermark sits.
    img = img.crop((0, 0, w, w))
    img.save(f"{OUT_DIR}/{key}.jpg", "JPEG", quality=82)
    print(f"OK {key} ({w}x{h} -> 384x384)", flush=True)
    return True


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    end = int(sys.argv[2]) if len(sys.argv) > 2 else len(PORTRAITS)
    ok = 0
    for key, head, seed in PORTRAITS[start:end]:
        if fetch(key, head, seed):
            ok += 1
        time.sleep(3)
    print(f"done: {ok}/{end - start} ok")


if __name__ == "__main__":
    main()

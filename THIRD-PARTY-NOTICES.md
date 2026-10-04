# Third-party notices

## What this repository covers, and what it does not

The code in this repository — everything under `js/`, `css/`, `scripts/`,
`tests/`, and the HTML entry points — is dedicated under **CC0 1.0
Universal** (see `LICENSE`).

**That dedication does not extend to third-party content.** Specifically, it
does not cover:

- `docs/New Info/*` — Foundry VTT exports of 5e content
- `js/data/contentCatalogs.js`, `js/data/subclassFeatureText.js`,
  `js/data/subclassContent.js`, `js/data/featBundles.js`,
  `js/data/defaultContent.js`, and the other generated content modules

Those files contain text derived from Wizards of the Coast's *Dungeons &
Dragons*, which is not ours to license. A copyright licence cannot grant
rights in someone else's work, so the CC0 dedication is void to the extent it
reaches that content — but stating the boundary is the point of this file.

## Where the content comes from

| Source | Licence / basis | Used for |
|---|---|---|
| System Reference Document 5.1 (2014 rules) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | spell, item, feat and class text marked as SRD |
| System Reference Document 5.2.1 (2024 rules, 5e) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | the 2024-revision subclass features |
| `dnd5e.wikidot.com` | asserted CC BY-SA 4.0 by that wiki | primary source for 2014-era subclass feature prose |

The CC BY attribution requirement applies to the SRD-derived text, and this
file is that attribution.

### A caveat on the wiki source

`js/data/subclassFeatureText.js` is largely scraped from
`dnd5e.wikidot.com`, which labels its content CC BY-SA. That wiki's text is
itself derived from Wizards' published material, and **a derivative work's
licence does not clear the underlying copyright.** This is flagged rather
than resolved: it is the weakest provenance claim in the project, and it
covers 595 feature texts of prose.

## Content deliberately left blank

Where no free source carries a rules text, this project leaves it empty
rather than paraphrasing from memory. Those grants are marked
`"unsourced": true` in the data and are hidden from the UI. The reasoning is
recorded in `docs/Improvements to make.txt`: a plausible-looking invention is
worse than an empty cell, because a player cannot tell which is which.

## Trademarks

`Dungeons & Dragons` is a trademark of Wizards of the Coast LLC. This project
is an unofficial, non-commercial tool. It is not affiliated with, endorsed by,
or sponsored by Wizards of the Coast. No affiliation is implied.

### Where trademarked names actually appear

Inventory taken 2026-10-04, because the answer is not the obvious one.

**Not in the shipped app at all.** `Forgotten Realms` (a Wizards trademark),
`Vecna`, `Bahamut` and `Tiamat` appear only in `docs/New Info/*`, the raw
Foundry exports. Those are compiler inputs, not shipped content: the strings
never reach `js/`, so no player receives them. Verified by searching every
file under `js/`.

**In the shipped app, but inside verbatim rules prose.** Three places:

- `defaultContent.js` — the *Truesight* description names "the vampire Count
  Strahd von Zarovich" as its worked example
- `contentCatalogs.js` — a spell effect uses "beholder" to describe what it
  summons
- `defaultContent.js` — "mind flayer" inside a class or subclass description

(For what it's worth, `mind flayer`, `beholder`, `rakshasa` and `demogorgon`
are all in the SRD 5.1 monster list, so those three are CC BY 4.0 content and
explicitly permitted.)

### Why these were not removed

Removing a proper name from a rules description corrupts the rules. A player
reading a Truesight description that no longer names the vampire is being
misled about what the spell does — and the surrounding prose remains verbatim
PHB text either way, so the copyright exposure is unchanged.

Truncating text to dodge a trademark is not a defence, and it makes the tool
worse for the six people who use it in exchange for nothing. The names are
left in place deliberately, not overlooked.

If they are ever removed, it should be as part of replacing the descriptions
with original prose — not by deleting a word from Wizards'.

## Not legal advice

This file records provenance so it can be reviewed by someone qualified to
advise on it. It is not a legal opinion, and it has not been reviewed by a
lawyer.
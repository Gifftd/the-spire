# Changelog

All notable changes to the DND web tools (maps, initiative tracker, home).

Format roughly follows [Keep a Changelog](https://keepachangelog.com/).
Dates are YYYY-MM-DD.

---

## [Unreleased] — 2026-05-21

### Maps (`map.html` + `map-dm.html`)

#### Changed
- **Pins are now solid colored teardrops.** Removed the emoji icons inside pins. Each type renders as a single solid color with a subtle inset highlight and drop shadow so pins still read as 3D markers at any zoom.
- **Mouseover info moved to a right-side panel.** Replaced the cramped bottom info bar with a 280–320px panel anchored top-right of the map area. Bigger type, full multi-line description (no longer truncated), uppercase type label above the name, fade + slide-in transition.
- **Legend redesigned for clarity.** Bigger padding, gold uppercase title with a divider, Cinzel labels at ~0.8rem, and an SVG mini-pin in each row that matches the actual map pin shape and color (instead of the prior tiny ambiguous colored dot).
- **Pin label below pin (hover) bumped from 0.5rem to 0.6rem** with slightly more padding so it's readable at normal zoom.
- **More distinct color palette** so similar-hued types no longer get confused:
  - City: `#4a90d4` (blue)
  - Dungeon: `#c43838` (crimson)
  - Wilderness: `#4ca050` (green)
  - Ruin: `#908070` (stone gray)
  - Port: `#2cb6c8` (cyan/turquoise)
  - Fort: `#b060d0` (violet) — **new**
  - Default / Location: `#e0a830` (gold)
  - Previously port/city were both blue and ruin/default were both tan/amber.

#### Added
- **Fort pin type** (icon: 🏰, color: violet). Available in the DM type dropdown, recognized by the Obsidian importer from frontmatter values `fort`, `fortress`, `castle`, `keep`, or `stronghold`.
- **Legend on the DM map.** Previously only the player map had one; the DM map now shows the same legend bottom-left of the map column.
- **Hover info panel on the DM map.** Previously the DM map had no hover info at all (clicking a pin opens the editor). Now hovering a pin shows the type + name + short description in the top-right of the map column, while click-to-select continues to work.

### Operational

#### Added
- `backups/` folder — timestamped snapshots of source files before significant changes. The first `*-baseline` snapshot captures the post-edit state of `home.html`, `index.html`, `initiative-dm.html`, `initiative-player.html`, `map.html`, `map-dm.html`, and `cloudflare-worker.js`.
- `CHANGELOG.md` — this file.
- `.gitignore` — excludes `backups/` and macOS junk.
- Git repo initialized in this directory.

---

<!--
HOW TO USE THIS FILE

- Add new edits under an "[Unreleased]" section with today's date.
- Group by file/feature (e.g. "### Maps", "### Initiative tracker", "### Operational").
- Use sub-headings: Added / Changed / Fixed / Removed / Deprecated.
- When you cut a release / push a milestone, rename "[Unreleased]" to a version
  or date heading and start a fresh "[Unreleased]" block at the top.
-->

# Changelog

All notable changes to the DND web tools (maps, initiative tracker, home).

Format roughly follows [Keep a Changelog](https://keepachangelog.com/).
Dates are YYYY-MM-DD.

---

## [Unreleased] — 2026-05-27

### Recipe book — per-character known recipes

Players now keep a recipe book in The Cauldron and grow it as they discover combos.

A recipe is a **3-ingredient combo → the potion it makes**, stored per character in
a new `potion_recipes` KV key (deduped by ingredient set + potion, so a combo that
can make more than one potion via a masterful "choose" keeps an entry per potion).

#### Added — `brew.html` (player)
- **Known recipes** panel: lists the character's recipes (potion name + ingredients
  + slot). Tapping one loads its three ingredients into the recipe slots (greyed when
  the player doesn't currently hold them all). Pre-fill only — you still roll the brew.
- New recipes are learned automatically on a **clean success** (the intended/official
  potion), and on a **masterful "choose"** once the player picks which potion they
  made. A toast announces each newly learned recipe.

#### Added — `brew-dm.html` (DM)
- **Recipes** tab: pick a character, see their known recipes (with remove), and grant
  one by choosing three ingredients — the editor computes the slot (with a tie picker)
  and lets you select which potion in that slot the recipe yields (default: official).

#### Worker (`cloudflare-worker.js`)
- `brew_player` and `potion_data_dm` now return `recipes`. POST `brew` auto-records a
  recipe on a clean success and returns the updated book. New POST `record_recipe`
  (player) validates that the combo can actually brew the chosen potion before saving
  (used by the "choose" pick). `potion_recipes` added to the DM write types + KV keys.
- ⚠️ **Requires another manual worker redeploy** for recipes to work.

### Potion brewing tool — The Cauldron (player) + The Apothecary (DM)

A new campaign tool based on Obojima: Tales from the Tall Grass potion brewing,
with a homebrew check-and-margin layer on top. Players combine three ingredients
to brew a potion; the DM stocks the ingredient/potion lists and grants inventory.

**The mechanic.** Each ingredient has Combat / Utility / Whimsy values. A recipe is
3 unique ingredients; the highest summed attribute picks the list and *is* the
potion number (1–60). Rarity comes from the number band (1–30 common, 31–50
uncommon, 51–60 rare); brewing DC is 10 / 15 / 20 by rarity. Outcome by margin
(roll − DC): **+10** choose any potion in the slot · **0..+9** the official potion ·
**−1..−5** a random potion from the slot · **−6..−9** sludge (nothing) ·
**−10 or worse** a random negative potion. Brewing consumes the 3 ingredients
(even on a botch). Ties let the brewer pick the list.

#### Added — `brew.html` (player "The Cauldron")
- Craft mode (brew from granted inventory, consumes ingredients) and Experiment
  mode (plan against the full ingredient list; shows the slot but keeps the potion
  hidden until actually brewed). Live attribute sums, slot/rarity/DC readout, and a
  d20 roller (or type your own roll + alchemy bonus). DM can test-brew without
  consuming.

#### Added — `brew-dm.html` (DM "The Apothecary")
- Tabs: Ingredients / Potions / Negatives / Inventory / Import. Full CRUD for
  ingredients (values + description + DM notes), potions (multiple per slot, with an
  *official* flag), and negative potions. Per-character ingredient inventory with
  quantities. One-time **Import** reads `obojima-seed.json` and seeds KV.

#### Added — Worker (`cloudflare-worker.js`)
- GET `brew_player` (player creds → ingredient catalogue + that character's
  inventory) and `potion_data_dm` (DM → everything for the editor).
- POST `brew` — resolves the recipe + margin **server-side** and consumes
  ingredients, so the potion and negative lists never reach the browser except as
  the resolved result (snoop-safe, like the map's player_view).
- New DM write types: `potion_ingredients`, `potions`, `negative_potions`,
  `potion_inventories`. New KV keys of the same names.
- ⚠️ **Requires the manual worker redeploy** (paste into the Cloudflare dashboard).
  Until redeployed, the tool can't load or brew.

#### Added — Hub (`home.html`)
- "The Cauldron" card (players) and "The Apothecary" card (DM).

#### Data / privacy
- Obojima ingredient/potion text is third-party copyrighted content and lives in
  KV only. `obojima-seed.json` / `obojima-potions.json` are gitignored so they
  never reach the public repo. The tool *code* is in the repo; the book *data* is not.
- Seeded from the book: 135 ingredients (69 common / 45 uncommon / 21 rare),
  180 potions (60 each Combat/Utility/Whimsy), and 10 negative potions adapted
  from the Potion Mishaps table.

### Pin color + outline refresh

Better at-a-glance distinction between pins and improved visibility on busy maps.

#### Changed (`map.html` + `map-dm.html`)
- **City and port pulled apart in hue** — they used to be two adjacent blues (city `#4a90d4`, port `#2cb6c8`). Now: city → **royal blue `#3a6fd0`**, port → **teal-green `#16b5a0`**. Clearly different at a glance.
- **Pin outline is now a light off-white ring** (`rgba(248,245,238,0.92)`) instead of the old dark semi-transparent edge. Combined with the existing drop-shadow, every pin now pops on any map background.
- **Ruin pin** specifically — the dark border used to let the stone-gray pin (`#908070`) vanish into earthy terrain. The new light ring + a slightly brighter fill (`#a89478`) make it easy to spot.
- Applied everywhere the palette lives: world pins, sub-map pins, the legend's SVG swatches, and the `TYPE_COLORS` map (which also feeds the location/sub-pin type badges and info panel).

Full palette now: city `#3a6fd0`, dungeon `#c43838`, wilderness `#4ca050`, ruin `#a89478`, port `#16b5a0`, fort `#b060d0`, default `#e0a830`.

### Editable loot + combats in the timeline editor

Follow-up to the combat→chronicle integration: loot is now fully editable directly on an existing timeline entry (no re-export needed).

#### Added — DM map (`map-dm.html`)
- The TIMELINE entry editor's read-only "attached" banner is replaced with:
  - **Editable loot rows** — item / qty / who, with add (+ Add loot) and remove (✕) per row. The "who" field autocompletes from the campaign's characters + "Party". Blank rows are dropped on save.
  - **Attached combats list** — each combat shows title + outcome + rounds with a ✕ to **detach** it (removes its summary and DM log from the entry).
- `saveTimelineEntry` now writes `loot[]` and `combats[]` from the editor, so manual edits and initiative-export attachments converge on the same data. Editing an entry no longer relies on a passive spread to preserve them.
- You can now add loot to **any** session entry (even one created by hand, with no combat attached).

### Combat + loot → Chronicle integration

The initiative tracker's combat export can now push the encounter and its loot straight into a timeline session.

#### Added — Initiative tracker (`initiative-dm.html`)
- Export modal gains an **"Add this combat to the campaign timeline"** section:
  - **Session picker** — dropdown of existing `session` timeline entries (loaded from `timeline_dm` when the box is ticked) plus **"➕ New session…"**. New uses a title (defaults to the combat title) + optional in-game date.
  - **Loot rows** — repeatable item / qty / who-got-it. The "who" field autocompletes from the current PCs + "Party".
  - **"Add to Chronicle"** button POSTs the updated timeline. The existing **Download .md** button is unchanged, so you can do both.
- Builds a structured combat object: player-safe summary (title, outcome, rounds, location, PCs downed, enemies defeated) plus `dmDetail` (the full markdown HP tables + combat notes).
- New session entries are created with `kind: 'session'`; existing ones get the combat appended to `combats[]` and loot concatenated onto `loot[]`.

#### Added — Worker (`cloudflare-worker.js`)
- `timelineForCharacter()` now strips each combat's `dmDetail` for non-DM callers. Combat summaries and the loot table remain player-visible; full HP tables + combat DM notes are DM-only.

#### Added — Chronicle (`timeline.html`)
- Session entries render attached **combats** (title, outcome, rounds, location, defeated, downed) with a collapsible **"Full combat log (DM only)"** `<details>` block shown to the DM.
- Attached **loot** renders as an item / qty / who table.

#### Added — DM map (`map-dm.html`)
- The TIMELINE entry editor shows a read-only banner when an entry has combats/loot attached from the tracker, noting they're preserved on save and edited by re-exporting.

#### Data model
- `TimelineEntry` gains optional `combats: [{id,title,date,location,outcome,rounds,summary,pcsDowned,enemiesDefeated,dmDetail}]` and `loot: [{id,item,qty,recipient}]`.

#### Action required
- **Redeploy `cloudflare-worker.js`** for the `dmDetail` stripping (otherwise full combat logs would reach players).

### Campaign timeline / Chronicle (Phase 3 of 3-feature set)

Closes out the trio: NPC tracker → sub-map pins → **campaign timeline**. A chronological log of sessions, events, and milestones, with planned (DM-only) entries for the future.

#### Added — Worker (`cloudflare-worker.js`)
- New KV key `timeline` (DM-only canonical store).
- `GET ?type=timeline` — anonymous-safe (returns entries with empty `visibleTo` and `kind != 'planned'`; `dmNotes` stripped).
- `GET ?type=timeline_view&characterId=…&code=…` — per-character (returns public + entries whose `visibleTo` includes them, non-planned, `dmNotes` stripped).
- `GET ?type=timeline_dm` — DM auth required, full data including planned entries and `dmNotes`.
- `POST type=timeline` — DM-only write.
- `timeline` added to `DM_WRITE_TYPES`.
- New `timelineForCharacter()` helper centralizes the filter logic.

#### Added — DM map (`map-dm.html`)
- **New `TIMELINE` tab** beside Locations / Zones / Players / NPCs / World.
  - Roster with search + kind filter (sessions / events / milestones / planned).
  - Entry editor: title, body, kind, in-game date (free text), sort key (YYYY-MM-DD), real-world date (auto-filled).
  - **Linked entities**: chip multi-selects for locations, characters, NPCs — chips show on the player chronicle as clickable links into the atlas.
  - **`visibleTo` chips** scope an entry to specific characters (same pattern as locations/NPCs). Planned entries are DM-only regardless.
  - Per-entry **DM notes** (never published).
- Loads / saves via worker with the standard DM-auth flow. Local cache mirror under `dm_timeline`.

#### Added — New page `timeline.html` (The Chronicle)
- Spire-themed standalone page (slate + teal, brass for DM/planned accents).
- Reads the appropriate endpoint based on `Auth.getRole()`:
  - Anonymous → `?type=timeline`
  - Player → `?type=timeline_view` with creds
  - DM → `?type=timeline_dm` with DM headers (sees planned entries in a separate "Planned" section below the past entries, with `dmNotes` shown)
- Filter bar: search box, kind dropdown, sort (newest/oldest first).
- Entry cards: kind pill (color-coded), title, in-game date, multi-line body, linked-entity chips (📍 location, ★ character, ☉ NPC). Location chips deep-link to `map.html#<id>` so a click jumps to the atlas.
- Linked-entity names are resolved by fetching `character_list` + `map_data` + (`npcs` for DM / `npc_roster` for players) on bootstrap — best-effort, falls back to the raw id if a name isn't known.

#### Added — Homepage (`home.html`)
- **The Chronicle** card added to the **Open to All** section (third card alongside The Atlas and The Round). Inline tower-of-scrolls SVG icon to match the Spire's other marks.

#### Visibility matrix

| Entry kind / setting        | Anonymous | Player | DM |
|---|---|---|---|
| Public (empty `visibleTo`)  | ✓ | ✓ | ✓ |
| Gated (`visibleTo: [id]`)   | hidden | ✓ if their character is in the list | ✓ |
| Planned (`kind: 'planned'`) | hidden | hidden | ✓ (own section + `dmNotes` shown) |
| `dmNotes` field             | stripped | stripped | shown |

#### Action required
- **Redeploy `cloudflare-worker.js`** (new endpoints).
- After redeploy, open `map-dm.html` → **TIMELINE** tab → **+ Add entry** to start the chronicle.

### Sub-map pins (Phase 2 of 3-feature set)

Each Location can now have its own detail map with the same pin/zone/visibility system as the world map. Phase 2 of: NPC tracker → sub-map pins → campaign timeline.

#### Added — Worker (`cloudflare-worker.js`)
- `filterForCharacter()` now recurses into every `Location.subMap.pins` (also accepts `subMap.locations` from the DM side) and `subMap.zones`, applying the same `visibleTo` rules.
- Sub-map pins have `dmNotes` stripped via a new `sanitizeSubPin` helper before reaching any non-DM caller.
- **Hardened**: the top-level location's `dmNotes` is now explicitly stripped by `filterForCharacter` too (it previously leaked if `player_view` fell back to `map_data_dm` when the DM had never published).

#### Added — DM map (`map-dm.html`)
- **New `worldData` / `data` split**: `worldData` is the canonical root persisted to KV. `data` is the active editing scope — equals `worldData` at the world level, points at a Location's `subMap` when inside one. Mutations flow naturally because `data.locations` / `data.zones` are array references shared with the right slot in worldData.
- **Sub-map mode**: `enterSubMap(locationId)` pushes a scope frame, swaps `data` to the embedded sub-map, rebuilds the canvas, location list and zone list against it. `exitToWorld()` (or **Esc**) pops back. Supports nested entry/exit via a stack.
- **Topbar breadcrumb** appears when in sub-map mode: `⌫ Back to World › Ironhaven` (clickable). Topbar title flips to "Sub-map — Ironhaven" with a gold accent. Map hint changes too.
- **Location modal → SUB-MAP tab**: image URL + width + height fields, **Open editor ↗** button, pin/zone count, and **Reset sub-map** button.
- All existing editor functionality (place mode, move mode, polygon zones, rect zones, visibility chips, location modal) works in sub-map context. Sub-pins can't have their own sub-maps (no recursion in this phase) — the SUB-MAP and NPCs tabs are hidden when editing a sub-pin.
- **Publish** and **Save to cloud** always operate on `worldData` regardless of mode, so you can publish while inside a sub-map editor.
- **`saveLocation`** preserves an existing sub-map's pins/zones when re-saving the parent location and strips sub-pin `dmNotes` during publish.

#### Added — Player map (`map.html`)
- Location detail page now renders an **interactive sub-map** when one is published:
  - Background image scaled to the sub-map's aspect ratio.
  - Pins as colored teardrops (same palette as the world map, slightly smaller).
  - Rectangle zones rendered as colored overlays.
  - Hover a pin → name label.
  - Click a pin → **detail card** below the map with type, name, short description, lore. `dmNotes` never reaches the player.
- Static `mapImage` URLs still work as a fallback for locations that haven't been promoted to interactive sub-maps.
- Anonymous viewers see only sub-pins with empty `visibleTo`; logged-in players see those plus pins where their character is in `visibleTo`. Server-side filtering, so dev-tools snooping won't reveal hidden sub-pins.

#### Known limitations
- Sub-map view is **fit-to-container**, no pan/zoom (the world map's pan/zoom is preserved). Flag for a polish pass if needed for big floor plans.
- Sub-pin polygon zones aren't drawn on the player side yet (rect zones work). DM polygon-zone editing on sub-maps is supported — they just don't render on the player's sub-map view.
- No recursive sub-maps (a sub-pin can't itself have a sub-map). Same intentional limit as Phase 2 scope.

### NPC tracker (Phase 1 of 3-feature set)

NPCs promoted from anonymous arrays inside locations to first-class entities with current location, current activity, status, a movement/event history, and per-character visibility. Phase 1 of: NPC tracker → sub-map pins → campaign timeline.

#### Added — Worker (`cloudflare-worker.js`)
- New KV key `npcs` (DM-only canonical store).
- `GET ?type=npcs` (DM auth) — full data.
- `GET ?type=npc_roster&characterId=…&code=…` — server-side filtered, returns only NPCs whose `knownTo` includes the character, with `dmNotes` and any `dmOnly:true` history entries stripped.
- `player_view` now also returns the character's known NPCs in `body.npcs`.
- `npcs` added to `DM_WRITE_TYPES` so saves are gated.
- New `npcsForCharacter()` helper centralizes the server-side filtering.

#### Added — DM map (`map-dm.html`)
- **New `NPCs` tab** beside Locations / Zones / Players / World.
  - Roster with status pill (alive / dead / missing / unknown), current location, current activity. Search + per-location filter.
  - Detail editor: name, role, status, current location (dropdown of locations), current activity, public description, public notes, DM notes, `knownTo` chips (which characters have encountered them).
  - **Move / Log activity composer**: append a history entry with new location, new activity, free-form note, date, and an optional `DM-only` checkbox. Updates the current state and writes a timestamped history row in one click.
  - History display sorted newest first, deletable, DM-only rows highlighted purple.
- **Auto-migration on first run**: walks every `Location.npcs[]` array, promotes each nested NPC to a first-class record with `currentLocationId` set, adds a "first recorded here" DM-only history entry, and clears the nested arrays. Idempotent — runs only when `npcs[]` is empty and at least one location still has nested data.
- **Location editor's NPC sub-tab** rewritten as a read-only "NPCs currently here" list with a "+ New NPC here" button that jumps to the NPCs tab pre-filled with this location.

#### Added — Player map (`map.html`)
- **`NPCs` button** in the topbar (next to Whispers) with an unread-style count badge of known NPCs.
- **NPC roster slide-in panel** from the right, search box, click any card to expand and see full description, public notes, and player-visible history. Esc to close.
- **Location detail page** now joins from the first-class roster: shows NPCs whose `currentLocationId` matches AND whom the character knows. Cards are clickable and pop the roster open to that NPC.
- Anonymous viewers see no NPCs anywhere — `npcs` is opt-in only.

### Restored the `maps/` folder

The original GitHub repo had a `maps/` folder with `Alden.png`, `Numira'Bad.png`, `Velmere.jpeg`, and a placeholder `readme`. It was removed from `origin/main` during the auth refactor commit (when staging deletions of files that weren't in the local working tree). The blobs were still in git's object database, so we restored them by hash.

#### Restored
- `maps/Alden.png` (PNG 4080×4080)
- `maps/Numira'Bad.png` (PNG 3345×3345)
- `maps/Velmere.jpeg`
- `maps/readme`

#### Changed
- `map.html` and `map-dm.html` default `mapImage` now points to `./maps/Velmere.jpeg` (was `./Velmere.jpeg`). The root-level duplicates of `Alden.png` and `Velmere.jpeg` are gone — `maps/` is the canonical location.
- **You should also update the World tab → "REGION MAP IMAGE URL" in `map-dm.html`** to `./maps/Velmere.jpeg` and click Publish, so the live (KV-stored) data matches and players see the map.

### Storage key renamed → `spire-auth`

- `auth.js` now stores identity under `localStorage['spire-auth']` (was `campaign-perks-auth`).
- One-shot **migration on load**: if the new key is empty and an old key exists (`campaign-perks-auth` from the auth refactor, or `campaign-perks-login` from the original player login), the value is copied across and the old key removed. Existing sessions keep working without re-login.

### Homepage rebrand → "The Spire"

Made the homepage campaign-agnostic so the same hub can front multiple games.

#### Changed (`home.html` only)
- **Name:** "Rise of a New Dawn — Hub" → **"The Spire — Hub"**. Page title, header, footer, and modal text all updated.
- **Palette:** parchment + gold + red → slate + teal + brass. New `:root` tokens (`--bg`, `--panel`, `--panel-light`, `--panel-deep`, `--border`, `--teal`, `--teal-bright`, `--teal-deep`, `--ink`, `--ink-light`, `--ink-faint`, `--brass`, `--rust`). Body background gets teal/brass radial glows instead of the old warm vignette.
- **Tower mark:** new inline SVG (spire silhouette with a beacon star) above the title.
- **Removed campaign-specific copy:** "Velemere — 684 SV" → "Archive · Chronicle · War". Footer "Rise of a New Dawn" → "The Spire". Card description "Explore the known regions and locations of Velemere" replaced with a generic line.
- **Card section names** lean into the tower metaphor:
  - "For Everyone" → **Open to All** (World Map → **The Atlas**, Initiative → **The Round**)
  - "For Players" → **For the Sworn** (Campaign Perks → **The Ledger**)
  - "For the DM" → **Keeper's Wing** (World Map Editor → **Atlas Workshop**, Initiative Tracker → **War Table**)
- **DM accent** shifted from red to brass; teal handles the "primary" accent everywhere else.
- **Role pill** colors retuned: DM = brass, Player = teal, Visitor = neutral grey.
- **Welcome subtitle** when signed in: "Welcome back, Keeper." for DMs.

All other pages, the worker, and the auth flow are untouched — only `home.html` changed.

### Project-wide auth refactor

A single shared identity model across every page, role-aware homepage, real DM username/password.

#### Added
- **`auth.js`** — single source of truth for identity. Every page includes it via `<script src="auth.js"></script>`. Exposes `Auth.getRole()`, `Auth.identity()`, `Auth.dmLogin/Setup/Status`, `Auth.playerLogin/playerCreds`, `Auth.dmHeaders()`, `Auth.characterList()`, `Auth.logout()`, `Auth.requireRole(role)`.
  - Identity is stored under the single key `campaign-perks-auth` (replaces the older `dm_token` + `campaign-perks-login` keys).
- **DM accounts**: worker now stores a salted SHA-256 hash of the DM password in KV (`dm_account` key). Endpoints:
  - `GET ?type=dm_status` → `{configured, hasMasterToken}` — used by the homepage to choose setup vs login.
  - `POST type=dm_setup` `{username, password}` — first-time setup; requires `X-DM-Token` header matching the worker secret if `DM_TOKEN` is set.
  - `POST type=dm_login` `{username, password}` — validates and returns ok.
  - DM-protected writes accept either `X-DM-Token: <DM_TOKEN secret>` (master) **or** `X-DM-User:` + `X-DM-Pass:` headers (the new normal).
- **Role-aware homepage** (`home.html`, rewritten):
  - Identity bar across the top showing "Signed in as ⟨name⟩" + DM/Player/Visitor pill, plus a Sign in / Sign out button.
  - Sections of tool cards rendered conditionally by role:
    - **For Everyone** — World Map, Initiative (player view)
    - **For Players** — Campaign Perks (and anything else gated to signed-in users)
    - **For the DM** — World Map Editor, Initiative Tracker (red-tinted DM cards)
  - Login modal with Player / DM tabs. First-time DM flow asks for `DM_TOKEN` once and uses it to claim the account.
  - Notice banner triggered by `?notice=…` query param — gated pages redirect here with a friendly reason.
- **`⌂ Home` link** added to every tool page so signed-in users can hop back without typing the URL.

#### Changed
- **DM-only pages now redirect on direct access.** `map-dm.html` and `initiative-dm.html` call `Auth.requireRole('dm')` before anything else; non-DMs land on the homepage with an explanation.
- **`map_data_dm` GET is now DM-gated** by the worker. Previously the full DM map (including `dmNotes`) was readable by anyone who knew the URL.
- **`initiative-dm.html` now sends DM auth headers** on its sync save (it previously didn't, which would have started 401'ing as soon as DM lockdown was on).
- **`index.html` (Campaign Perks) requires any signed-in user.** Anonymous visitors get bounced to home.
- **`map.html`**:
  - Uses the shared auth helper (`Auth.playerLogin`, `Auth.playerCreds`, `Auth.characterList`). The "claim a character" pill now hides for DM-signed-in viewers (they have an identity already).
  - Old `campaign-perks-login` localStorage key replaced by the unified `campaign-perks-auth` key.

#### Behavior matrix

| Page                       | Anonymous | Player | DM |
| -------------------------- | --------- | ------ | -- |
| `home.html`                | ✓ (visitor view) | ✓ (player cards) | ✓ (DM cards) |
| `map.html`                 | ✓ (gated content stripped) | ✓ (their scoped view + whispers) | ✓ (as anonymous) |
| `initiative-player.html`   | ✓ | ✓ | ✓ |
| `index.html` (Perks)       | redirected | ✓ | ✓ |
| `map-dm.html`              | redirected | redirected | ✓ |
| `initiative-dm.html`       | redirected | redirected | ✓ |

#### Action required
- **Redeploy `cloudflare-worker.js`** (new endpoints).
- **First DM login**: from `home.html`, click Sign in → DM tab → choose a username + password + paste your existing `DM_TOKEN` worker secret. After this, your normal sign-in is just username + password.
- The legacy `DM_TOKEN` still works as a master key on any write if you ever need it — it's the recovery escape hatch.



### Character login + per-character data

A claim-code login system so players can log in as a character and see only what the DM has shared with them. **Login is optional** — anyone with the URL can still browse the world map; logging in just unlocks character-scoped content.

#### Changed (follow-up)
- **Anonymous browsing is now allowed.** The login overlay no longer auto-blocks the map; instead a "Claim a character" pill appears in the topbar. The modal is dismissible (× button, "Continue without logging in" link, or Esc).
- **Worker strips gated content from anonymous `map_data` responses** so an un-authenticated visitor cannot see locations/zones/npcs/quests that have a non-empty `visibleTo`. Logged-in players still get their scoped view via `player_view`.

#### Added — Worker (`cloudflare-worker.js`)
- New KV keys: `characters` (DM-only, includes claim codes) and `journals` (per-character whisper entries).
- `GET ?type=character_list` — public, returns sanitized `{id,name,player}` only (never codes).
- `POST type=character_login` — `{characterId, code}` → validates and returns ok.
- `GET ?type=player_view&characterId=…&code=…` — re-validates the code each call and returns a **server-side filtered** map (`locations`/`zones`/`npcs`/`quests` with a `visibleTo` array are stripped if the caller isn't in that list) plus this character's journal entries.
- `GET ?type=characters` and `GET ?type=journals` — DM-only (gated by token).
- **DM lockdown**: new optional `DM_TOKEN` worker secret. When set, every write endpoint (`map_data`, `map_data_dm`, `characters`, `journals`, `initiative_state`) requires header `X-DM-Token: <value>`. When unset, writes still work (legacy mode) but the worker returns a warning so the DM notices the open door.
- CORS now allows the `X-DM-Token` request header.
- **Action required to enable lockdown:** in the Cloudflare Worker dashboard, Settings → Variables → add a Secret named `DM_TOKEN` with a long random value. Re-deploy the worker. The DM map will prompt for that token on first save.

#### Added — DM map (`map-dm.html`)
- New **Players** tab (next to Locations / Zones / World) with:
  - Add character: name, optional player name, auto-generated 6-char claim code (using a confusable-safe alphabet — no `O/0`, `I/1`), copy-to-clipboard, regenerate.
  - Per-character DM notes.
  - Inline **whisper composer**: post a title + body addressed to that character; their player sees it on login.
  - **Whispers sent** history per character, with delete.
- **"Visible to"** chip selector inside every location's INFO tab. Empty = visible to all logged-in players; selecting one or more characters scopes the location to just them.
- Deleting a character also removes their journal entries and strips their id from any location's `visibleTo`.
- **DM token modal** shown automatically the first time a write returns 401, with the queued save retried after the token is saved.
- Token persists in `localStorage['dm_token']` for this browser only.

#### Added — Player map (`map.html`)
- **Login overlay** on first visit: character dropdown (fetched from `character_list`) + claim-code input. Friendly empty/error states for "no characters yet" and "could not reach server".
- After login: small "Playing as ⟨name⟩" badge in the topbar, plus **Log out** and **Whispers** buttons.
- **Whispers panel** slides in from the right, lists journal entries (newest first), unread items get a gold left border + "new" tag. Opening the panel marks unread as read client-side.
- Map fetches use `player_view` so hidden locations never enter the browser — opening dev tools won't reveal pins meant for someone else.
- Login persists in `localStorage['campaign-perks-login']`. Pressing Enter submits the login form; Esc closes the whispers panel.

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

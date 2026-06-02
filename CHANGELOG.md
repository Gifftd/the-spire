# Changelog

All notable changes to the DND web tools (maps, initiative tracker, home).

Format roughly follows [Keep a Changelog](https://keepachangelog.com/).
Dates are YYYY-MM-DD.

---

## [Unreleased] — 2026-05-29

### Menagerie: chimera generator rewired to consume the feature library

Replaces the runtime catalog-build path (walk `allMonsters()` every
generation, classify each feature on the fly) with the pre-extracted
feature library. The library's templateFields are stat-agnostic and
get re-composed against the chimera's new stats; bodies with
`{MONSTER}` placeholders are filled in once the chimera's name is
stamped. Multiattack is now synthesized from the slotted attacks
rather than pulled from any donor.

#### Changed — `bestiary-dm.html`

- `generateMonster` drops the matchPool / wildPool construction and
  the runtime catalog build; it just calls `chimerise(crit)` against
  the loaded library. Hard-errors with a toast if the library isn't
  loaded (no silent fallback to runtime catalog).
- `chimerise` is now ~150 lines: filters the library by adjacent
  tiers around the target CR, tags each entry with role/terrain/tier
  match scores, slot-fills via a single `draw(predicate)` closure
  with soft-filter (80% strict match) and signature bias (70% reroll
  to common alternatives). Dedupe-by-canonical-name keeps duplicate
  picks out across all sections.
- `materializeFromLibrary(libEntry, newMon, allById)` builds a
  chimera feature from a library entry: templatable kinds get
  `_template` set + the body composed against `newMon`; prose kinds
  copy the `bodyTemplate` verbatim with `{MONSTER}` placeholders
  intact (resolved later).
- `recomposeTemplatedFeatures(newMon)` re-runs the template engine
  on every templatable feature after `retuneChimeraStats` changes
  the abilities + PB. Without this, attack bonus + damage would
  reflect the materialize-time stats (which match the role template
  but predate the per-CR tier bump).
- `synthesizeMultiattack(newMon, cr)` builds the multiattack at the
  end from the slotted attacks. Removes the previous "patch the
  donor's multiattack to point at our attacks" hack entirely.
- `fillMonsterPlaceholders(newMon)` does a final pass replacing
  `{MONSTER}` with the chimera's lowercased name across every
  feature's body + name and the monster description.
- Removed: `buildFeatureCatalog` (the library replaces it). Removed:
  `slotFeature` (the library entry IS the feature; `materializeFrom-
  Library` deep-clones and stamps donor metadata directly).
- `parseToTemplate` renamed to `_parseToTemplate_legacy` and left in
  the file as reference. Slated for deletion in a follow-up.

#### New helpers

- `tierForCR(cr)` → `'low'|'mid'|'high'|'epic'` — mirrors the
  Python script's TIER_BANDS so the page resolves to the same labels.
- `adjacentTiers(tier)` → 1-3 tier names around the target. Lets the
  generator pull from adjacent bands when the target tier is thin.
- `sectionForKind(kind)` → which `newMon` array the feature lives in.

#### Behavior changes (vs. runtime-catalog path)

- Signature features (1,202 of 1,980 library entries) are now
  explicitly rate-limited: a 70% chance to reroll signature picks to
  common alternatives. Previously they slotted at the same rate as
  any other feature, which over-flavored chimeras.
- The dedupe-by-canonical-name now spans all sections — a chimera
  can't roll two "Bite" entries (one mid, one high) into the same
  monster. Previously the dedupe was per-section, allowing the same
  named feature to appear in actions AND bonusActions.
- Multiattack is always coherent with the chimera's actual attacks
  because it's synthesized from the slotted attack names instead of
  pulled from a donor and patched.

---

### Menagerie: feature library — extracted, normalized, tier-stratified

Builds a flat, donor-agnostic feature catalog that the chimera
generator will pull from instead of walking the raw bestiary every
roll. The library lives in a new `feature_library` KV key, imported
the same way the bestiary is. The generator rewire to consume it
lands in a follow-up commit; this one ships the extraction pipeline
and the KV plumbing.

#### Added — `scripts/extract_features.py`

- Reads `bestiary.json` (already normalized + tagged by the prior
  scripts) and walks every monster's traits, actions, bonus actions,
  reactions, and legendary actions.
- For each feature: classifies its kind (`melee_attack`,
  `ranged_attack`, `flex_attack`, `save_effect`, `multiattack`,
  `spellcasting`, `utility`, `trait`, `bonus_action`, `reaction`,
  `legendary`), reverse-engineers the template fields for the
  templatable kinds, and normalizes the body with a `{MONSTER}`
  placeholder so the same trait reads clean on any future chimera.
- Tier-stratifies by source CR (low CR 1–4, mid CR 5–10, high CR
  11–16, epic CR 17+). Each tier gets its own library entry with the
  representative donor's dice and reach/range so a CR 5 chimera's
  Bite pulls 4d8 not 4d12.
- Aggregates role + terrain affinity across donors — `Bite` appears
  with affinity for Brute/Skirmisher/Soldier (its donor roles) so the
  generator's role filter can match on the feature itself, not the
  donor's identity.
- Flags `isSignature: true` for canonical names that appear on only
  one donor across the entire bestiary (Mind Blast, Eye Rays, Wail).
  The generator can ration these so distinctive features don't
  sprinkle onto every monster.
- Output schema: `{schemaVersion, monsterCount, featureCount,
  features: [...]}`. First run extracted **1,980 features** from
  819 monsters (692 traits, 354 utility, 303 melee attacks, 168 save
  effects, 125 legendary, 97 bonus, 93 ranged attacks, 69 reactions,
  59 flex attacks, 20 spellcasting blocks). Tier split: low 691, mid
  673, high 386, epic 230. Signature: 1,202 of 1,980.

#### Added — `cloudflare-worker.js`

- New GET endpoint `?type=feature_library` returns the KV-stored
  library (empty envelope by default). DM-gated.
- `feature_library` added to `DM_WRITE_TYPES` so POST works.

#### Added — `bestiary-dm.html`

- New page-level `featureLibrary` state; bootstrap fetches it
  alongside the bestiary and bestiary_custom on load. Tolerant of a
  missing route (older worker deploys won't break the page).
- Import tab detects feature-library shape (`{features: [...]}`)
  at file-load time, sets a `seedKind` flag, and routes to a single
  replace-only KV write (the library is regenerated as a whole from
  the Python script, so merge mode doesn't apply).
- Import preview adapts wording: "Replace the feature library with N
  features" vs. the bestiary's merge-by-id flow.

#### Required worker redeploy

The new `feature_library` GET endpoint + `DM_WRITE_TYPES` entry need
a manual paste into the Cloudflare dashboard before the page can
fetch or save the library.

---

### Menagerie: chimera slot tightening + multiattack repointing

Tightens the chimera generator's slot caps so output matches 2024 MM
canon — most monsters under CR 11 should have 2-3 actions, not 5-7.
Also repoints the Multiattack to reference an attack we actually
slotted (previously the body would still read "uses Eye Rays three
times" even when the chimera had Bite and Claws as its attacks).

#### Slot range changes

| CR    | actions (was → now) | traits |
|-------|---------------------|--------|
| 0–2   | 1–2 (unchanged)     | 0–1    |
| 3–5   | 2–3 (was 2–4)       | 0–1    |
| 6–10  | 2–3 (was 2–5)       | 1–2    |
| 11–16 | 3–5 (was 3–7)       | 1–2    |
| 17+   | 4–7 (was 4–8)       | 1–3    |

Utility action slot dropped for CR < 17; spellcasting block dropped
for CR < 9. Reaction slot trimmed to 0–1 below CR 17.

#### Cost multiplier increases

Bumped across the board so the budget binds earlier when CR-mismatched
donors get sampled (multiattack 8 → 12, single attack 4 → 6, save
effect 6 → 10, spellcasting 7 → 14, trait 2 → 5, bonus/reaction 3 → 6,
legendary 5 → 9).

#### Multiattack repointing

After all attacks are slotted, the chimera loop now finds the
Multiattack (if any) and rewrites its `_template.fields.attackName`
to one of the slotted attack names — preferring the same donor as
the multiattack for narrative coherence, else the first slotted
attack. The attack count is clamped to 2 at CR < 11 and 3 at CR ≥
11 so a Beholder's "uses Eye Rays three times" doesn't survive into
a CR 3 chimera. If no attacks were slotted at all, the Multiattack
is dropped (a solo Multiattack with nothing to swing is just noise).

---

### Menagerie: Generate tab — chimera edition (compositional rewrite)

Replaces the retune-from-similar-monster algorithm with a true
compositional generator. The chimera version pulls individual
features and actions from **multiple** bestiary monsters and slots
them into one new stat block, governed by a per-CR points budget so
the output stays roughly balanced even when it mixes wildly
different tiers (a dragon's breath weapon + a roper's tentacles + a
mage's spellcasting block).

#### Algorithm

1. **Feature catalog** — every action, trait, bonus action, reaction,
   and legendary action in `allMonsters()` becomes a draw-pile entry
   tagged with its source monster, kind, and a point cost.
2. **Cost** = `max(1, source.cr) × kind_multiplier`. Multipliers:
   multiattack 8, single attack 4, save effect 6, spellcasting 7,
   utility 3, trait 2, bonus action 3, reaction 3, legendary action 5.
3. **Budget per CR** = `max(50, cr × 30 + 30)` — CR 1 → 60, CR 5 →
   180, CR 10 → 330, CR 20 → 630, CR 30 → 930.
4. **Slot plan** — one Multiattack (required), 2–4 attacks, 0–2 save
   effects, 0–1 spellcasting block, 0–1 utility, 1–3 traits, 0–1
   bonus action, 0–2 reactions, 0–3 legendary actions (CR 11+).
5. **Soft filter** — each draw checks the criteria-matching catalog
   first; 20% of the time it draws from the full bestiary instead,
   so the chimera has occasional wild flavor.
6. **Attack-body parser** — every melee/ranged/flex/save action gets
   reverse-engineered into the Editor's `_template` shape so opening
   the result in the Editor recomputes its numbers against the new
   stats. Lore text and spellcasting bodies are cloned verbatim.
7. **Numerical retune** — CR / PB / XP from the canonical tables;
   HP / AC from the Analysis-tab CR median × role bias; ability
   scores from a per-role template (Brute = STR/CON heavy, Controller
   = INT/WIS heavy) plus +1 per tier above CR 5 on the two primary
   scores.
8. **Name** — terrain-themed adjective + hyphenated last words of the
   two highest-CR donors ("Frostbound Lich-Owlbear" / "Bogborn
   Hag-Owlbear").

#### Added — `bestiary-dm.html`

- **Donors panel** replaces the candidates panel. Lists the monsters
  that contributed parts, sorted by CR descending; clicking a row
  jumps to the Browse tab and selects that monster so the DM can
  inspect what got pulled.
- **Per-feature attribution** — the preview stat block prefixes each
  trait/action with a `⟨from <donor> · CR X⟩` label so the chimera's
  seams are visible at a glance. Labels are stripped before the
  feature is saved through the Editor.
- **Budget summary** — preview header shows the chimera's role,
  terrain, donor count, and the point budget that governed the roll.

#### Removed

- Old `retuneToCR`, `generateName`, `rebaseOnCandidate`,
  `renderGenCandidates`, `_genCandidates` — superseded by
  `chimerise`, `buildFeatureCatalog`, `parseToTemplate`, and
  `chimeraName`.

---

### Menagerie: Generate tab — procedural monster generator

Phase 3 of the random monster generator. Adds a new **Generate** tab on
`bestiary-dm.html` that procedurally retunes an existing bestiary
monster into a new variant for a chosen CR + role + terrain. Output
flows into the Editor for refinement via the same path
`cloneMonsterToEditor` already uses.

#### Algorithm (hybrid: reference-based + DMG-table retune)

1. **Filter** the bestiary by role, terrain (any match), and optional
   creature type.
2. **Score** the pool by CR distance to the target, take the top 8 as
   candidates, and **random-pick** one as the base for the retune.
3. **Retune** the numerical fields against the target CR using:
   - HP from the Analysis tab's CR-median band × a role-flavored bias
     (Brute 1.18× / Defender 1.10× / Soldier 1.00× / Skirmisher 0.92× /
     Ambusher 0.82× / Artillery 0.82× / Controller 0.95× / Leader
     0.95× / Support 0.82×) × ±12% random jitter.
   - AC from the CR-median band + a role adjustment (Defender +2,
     Brute −1, Artillery/Controller −1, Support −2, else 0), clamped
     to AC 10–22.
   - PB and XP from the canonical tables (`pbForCR`, `XP_BY_CR`).
   - Initiative from the cloned base's Dex mod + 10.
4. **Tag** the output with the chosen role / terrain and flip the
   manual flags so the Python tagger doesn't override them later.
5. **Name** combines a terrain-themed adjective (12 pools × ~6 each →
   72 adjectives) with the last 1–2 words of the base monster's name
   ("Frostbound Goblin Warrior" / "Bogborn Owlbear").
6. **Stamp** a fresh `custom-{name}Gen{ts}` id; mark `_generated:true`
   and `_generatedFrom`/`_generatedFromName` so the lineage is visible
   in saved records.

Actions are cloned **verbatim** from the base. Templated actions
auto-recompute against the new CR/PB when the DM opens the result in
the Editor (`statSnapshot` already detects CR/PB changes and triggers
`recalcTemplatedActions`). Plain-text actions retain the base's
literal damage numbers — the preview surfaces a drift warning so the
DM knows to audit them.

#### Added — `bestiary-dm.html`

- New **Generate** tab between Editor and Import. Two-column layout:
  the left column is a criteria form (CR / role / terrain chip-grid /
  optional type / optional name override) plus action row (Generate /
  Generate Another / Open in Editor) and a candidates panel; the
  right column is the live stat block preview with a Δ-strip (CR /
  HP / AC / PB before vs. after).
- **Candidates panel** lists the top 8 monsters considered for the
  current criteria, sorted by CR distance. Clicking a row re-bases
  the generation on that monster without re-rolling the criteria —
  useful when the random pick isn't the flavor you wanted.
- **"Open in Editor"** mirrors `cloneMonsterToEditor`'s contract:
  fresh `editingId = null` so Save mints a new `bestiary_custom`
  record; the templated-action auto-recalc fires on the first
  `syncEditor` after load.

---

### Menagerie: role + terrain visible in Browse, editable in Editor

Phase 2 of the random monster generator. The role and terrain tags
produced by `tag_bestiary.py` now flow into the Menagerie UI as
read-only chips on the Browse list and editable controls in the Editor.
A DM-edited tag flips a `roleManual` / `terrainManual` flag on the
record so the next `tag_bestiary.py` run won't clobber it.

#### Added — `bestiary-dm.html`

- **Browse list rows** now render a teal `role` chip next to the
  monster name and up to two `terrain` chips beneath it (with a
  `+N` overflow indicator carrying the rest in a tooltip).
- **Browse toolbar** gains a `Role` and `Terrain` filter dropdown
  alongside the existing Type / Size / CR filters. `clearFilters()`
  resets them too.
- **Editor → new "Tags" section** below Identity: a role dropdown
  (defaulting to "(auto)" so the DM can re-enable inference) and a
  12-entry terrain chip-checkbox grid. The header shows a "manual:
  role + terrain — won't be overwritten by re-tagger" indicator
  whenever the DM has overridden either.
- **Manual-override semantics**: changing the role dropdown or any
  terrain checkbox sets `roleManual: true` / `terrainManual: true` on
  the record; clearing the role back to "(auto)" removes the flag and
  lets the Python tagger re-classify on its next run.

#### Wiring

- `syncEditor()` reads both controls into `currentEdit.role` and
  `currentEdit.terrain[]`, and only flips the manual flag when the
  DM's value differs from what was loaded (so opening a monster and
  closing without edits doesn't accidentally mark every record
  manual).
- `loadFormFromEdit()` paints the dropdown + checkbox grid from the
  record. The "manual" indicator reads `m.roleManual` and
  `m.terrainManual` directly.
- `renderList()` filter chain honors the new role and terrain
  dropdowns. The chip rendering tolerates monsters without tags
  (older imports) by treating absent fields as empty arrays.

---

### Menagerie: auto-tag bestiary with role + terrain (random-generator prep)

Phase 1 of the random monster generator. Every monster in the bestiary now
gets a Flee Mortals **role** (one of Ambusher / Artillery / Brute /
Controller / Defender / Leader / Skirmisher / Soldier / Support) and a
**terrain** list drawn from a 12-entry vocabulary (arctic, coastal, desert,
forest, grassland, hill, mountain, swamp, underdark, underwater, urban,
planar). These tags are the inputs the upcoming Generate tab will use to
filter and procedurally compose new stat blocks.

#### Added — `scripts/tag_bestiary.py`

- Reads `bestiary.json` at the project root, computes `role` and
  `terrain[]` for each monster, writes the file back in place.
- Idempotent: a `roleManual: true` or `terrainManual: true` flag on any
  monster preserves its current tag (the Editor sets these when a DM
  corrects a chip — re-running the tagger never clobbers human input).
- Bumps `schemaVersion` to 5 and stashes the taxonomy under `_taxonomy`
  on the root envelope, so the page can render the chip pickers from
  the same source of truth.

#### Heuristics

- **Role** is a priority-ordered ladder fed by the same action
  classifier the Analysis tab uses (`Melee/Ranged Attack Roll`,
  `Saving Throw: DC`, `Multiattack: makes N attacks`). Order:
  Ambusher → Support/Leader → Brute (Giants/Dragons/big-HP melee) →
  Controller → Artillery → Defender → Skirmisher → Soldier. Save effects
  living in traits, bonus actions, or reactions (Petrifying Gaze,
  Frightful Presence, Death Burst) are counted toward `save_acts` so
  monsters defined by passive save-DC abilities read as controllers.
  Multi-effect bodies like Beholder Eye Rays inflate the count by every
  additional "Saving Throw" mention in the same action.
- **Terrain** combines (a) name + description keyword matches against a
  per-terrain regex library, (b) speed signals (swim 30+ → underwater,
  burrow 20+ → underdark), (c) dragon color → terrain table for the ten
  chromatic/metallic/gem colors, and (d) creature-type defaults for
  monsters that hit nothing else.
- Word-boundary matching everywhere — early drafts caught
  "magic**ally**" in `magically shoots` and wrongly flagged the Beholder
  as a Leader.

#### Spot-check accuracy

Across 31 canonical monsters (Adult Red Dragon, Lich, Mind Flayer,
Beholder, Vampire, Hill/Stone/Storm Giant, Knight, Hobgoblin, Priest,
Aboleth, Dryad, Druid, Banshee, Medusa, Owlbear, Iron/Stone Golem,
Manticore, Archmage, Mage, etc.) the classifier scores **29 / 31 = 93%**
matching the expected Flee Mortals role. The two misses (Bandit Captain
and Medusa with no explicit Petrifying Gaze trait) and the
underrepresented Artillery bucket — most spellcasters route to
Controller because we can't introspect spell lists — are documented as
expected gaps; the Editor's manual-override path will let DMs correct
specific monsters without breaking on re-runs.

---

### War Table: view stat block on a combatant card

Closes the bestiary → tracker loop. Combatants spawned via the Bestiary
picker already carry `bestiaryId` + `bestiarySource` tags; the DM-side
combatant card now uses those to surface the full stat block inline. No
worker changes, no player-side leak — the panel only appears on
initiative-dm.html.

#### Added — `initiative-dm.html`

- New **"📖 View stat block"** button at the bottom of the expanded
  combatant card. Only rendered when `c.bestiaryId` is set (PCs and
  manually-typed enemies don't get the button).
- `statblockOpenIds` Set, mirroring the existing `expandedIds` pattern,
  tracks which combatants have their stat block panel open.
- `toggleStatblock(combatantId)` opens/closes the panel and lazy-loads
  the bestiary on first open via the existing `_BP.loadBestiary()` path
  — free if the picker has already been used in this session.
- `findCombatantStatblock(c)` looks the monster up in `_BP.monsters` by
  `bestiaryId`. Gracefully reports a missing-id case (e.g. the monster
  was removed from KV after the combatant was spawned).
- `statblockHTML(monster)` — adapted from the Menagerie's Browse stat
  block. Same field coverage (header line, AC/HP/Speed/Initiative,
  ability grid with proficient-save chips, skills, all four
  resistance/immunity/vulnerability lines, senses/languages, CR/XP/PB,
  gear, traits, actions, bonus actions, reactions, legendary, lair
  actions, lair effects, description) but tighter spacing for inline
  display inside the card.
- `removeCombatant(id)` now also deletes the id from `statblockOpenIds`
  so stale entries don't linger.
- New CSS scoped to `.sb-panel` — gold-topped panel that matches the
  War Table's existing card aesthetic. Stat-block typography is
  smaller than the Menagerie's standalone version to fit inside the
  combatant card without crowding.

#### Verified
- All eight wiring identifiers present in source (state set, toggle,
  render, find, button, loading state, cleanup, CSS).
- `statblockHTML()` invoked on a synthetic Adult Black Dragon
  (CR 14 / DEX save +7 / Acid immunity / Bite +11 / one Legendary
  Action / lore description): all fields render correctly, no
  `undefined`/`null` leaks, save-proficiency chip ("Save +7") appears
  because the save bonus differs from the raw DEX mod.

### Menagerie: Import gains a Merge mode (default) — no more accidental overwrites

The Import tab used to fully overwrite the `bestiary` KV value with whatever
file the DM picked. That made re-imports destructive: a freshly normalized
file from one book would wipe content from other books already in KV.

Replaced the binary overwrite with a **two-mode import**:

- **Merge new** *(default)* — Only adds monsters whose `id` isn't already in
  KV. Existing entries are left exactly as they are. Safe for re-imports
  and for layering multiple books on top of each other (MM + ToB + future
  homebrew packs etc.).
- **Replace all** — The original behavior, kept as an explicit fallback for
  a clean reset.

#### Added — `bestiary-dm.html`

- Radio toggle at the top of the Import panel with both modes labeled and
  explained in-place.
- `computeMergeDelta(existingMonsters, newMonsters)` — partitions the file's
  monsters into `toAdd` (new id) vs `skipped` (id already in KV).
- `refreshImportPreview()` — both the preview text and the action button
  label update live as the mode toggles or the file changes:
  - Merge: `"Merge: Add N new monsters from <source>, skip M already in KV (by id)."` + button `"Add N new monsters to KV"` (disabled when N=0).
  - Replace: `"Replace the entire bestiary with this file's N monsters from <source>. The current K entries will be discarded."` + button `"Replace KV with N monsters"`.
- `doImport()` in merge mode short-circuits with a `"Nothing to do"` notice
  and skips the KV write when there's nothing new — avoids burning a write
  on no-op re-imports.
- Merge payload preserves the existing envelope's `source` / `scrapedAt` /
  `normalizedAt` metadata and stamps a `mergedAt`. The `_sources` summary
  map auto-updates to reflect the post-merge per-source counts.

#### Verified end-to-end (against a stubbed bestiary of 819 MM+ToB monsters)
- Re-importing the same `bestiary.json` → merge preview says "Add 0,
  skip 819", button disabled.
- Importing a synthetic supplement with 2 brand-new IDs + 1 id that
  matches an existing MM entry → preview says "Add 2, skip 1", button
  enabled. After the click, the posted payload contains 821 monsters
  (819 + 2 new), the duplicate is NOT present, and `_sources` correctly
  reads `{mm-2024:503, tob-v1:316, tob-supplement:2}`.
- Switching to Replace mode with the supplement loaded → button label
  flips to `"Replace KV with 3 monsters"` and preview clearly warns
  "current 821 entries will be discarded".

### Menagerie: Tome of Beasts scrape — 316 third-party monsters merged in

The bestiary grows from 503 to **819 monsters**. The original Kobold Press
*Tome of Beasts* (2017 PDF, 2014 5e edition, owned by the DM) gets a fresh
extractor that pulls every stat block, transforms the 2014 phrasing to
2024 shape, and concatenates the result into the same `bestiary.json` the
worker serves — distinguishable by an explicit `source: 'tob-v1'` tag on
each ToB entry alongside `source: 'mm-2024'` for the WotC content.

Schema bumped to v4. The PDF itself + the intermediate `tob.json` stay
gitignored (`*.pdf`, `tob*.json`) — the repo is public, the content is
copyrighted.

#### Added — `scripts/extract_tob.py` (new)

A column-aware two-pass PDF parser:

1. **Column-isolation extraction.** Each two-column page is split at x≈290.
   Words within each column are clustered into lines by y-coordinate, then
   the reading flow is concatenated as all-of-left-col then all-of-right-col
   so stat-block fields that wrap across lines reassemble in order.
2. **Anchor detection.** A monster anchor is a `<size> <type>, <alignment>`
   line whose next non-empty line starts with `Armor Class`.
3. **Multi-line field gather.** Continuation lines (long resistance lists,
   etc.) get glued onto their parent label until the next known label,
   section header, or page boundary appears. Fixes the 2014-MM-style wraps
   that defeated the naive parser.
4. **Trait + section parsing.** After `Challenge`, walk forward parsing
   feature names (`<Title Case>. <body>` or `<Title>: <body>`). Section
   headers (`ACTIONS`/`REACTIONS`/`LEGENDARY ACTIONS`/`BONUS ACTIONS`/
   `LAIR ACTIONS`/`REGIONAL EFFECTS`) route entries to the right array.
5. **Lore-bleed gate.** If a feature's body lacks game-mechanic markers
   (no `Attack Roll`, no DC, no damage dice, no recharge, no save ability),
   stop parsing — we've crossed into the next monster's lore prose
   (paragraphs like "Forest Guardians.", "Creatures of Pure Reason.").
6. **2014 → 2024 prose transform.** `Melee Weapon Attack: +9 to hit, ...,
   one target. Hit:` → `Melee Attack Roll: +9, ... Hit:`. Damage types and
   condition names get Title Cased. Unicode minus signs normalized to
   hyphens.
7. **Title-case helper preserves spaces around parens.** Splits on parens
   and re-joins with single spaces so "Thunder (only when in ethereal
   form)" doesn't collapse to "Thunder(only when in ethereal form)".

Result on the full book: **316 monsters extracted** across 409 bestiary
pages (page 8 - 416). 100% have valid CR / AC / HP / abilities; 310/316
have actions, 295/316 have traits, 23 have legendary actions. Cosmetic
imperfections (Mirror Hag has 0 actions, Spellcasting traits sometimes
split into "Cantrips"/"1st Level" sub-features, lair-action sections that
use bullet formatting are not yet parsed) are documented in the script
and hand-cleanable through the editor's "Edit a copy" flow.

#### Added — `scripts/normalize_bestiary.py`
- New `normalize(raw, patch, extras=[envelopes])` shape — the normalizer
  accepts a list of additional pre-shaped bestiary envelopes and
  concatenates their monsters through the same normalization pipeline
  (size/type repair, resistance string → array, lair-effect extraction).
- `main()` looks for `tob.json` at the project root and includes it
  automatically when present. Each entry's pre-existing `source` tag
  passes through untouched.
- `parse_immunities` now splits on the LAST `;` instead of the first.
  ToB's multi-clause damage immunities (e.g.
  `"Poison; Bludgeoning, Piercing, Slashing (Nonmagical); Charmed, ..."`)
  now route the damage and condition halves correctly. The MM 2024 format
  has at most one `;` so this also works there — verified on the Air
  Elemental and Aboleth that the existing immunity arrays are unchanged.
- Output includes a `_sources` summary so consumers can show
  per-source counts at a glance.
- Schema bumped to v4 to signal the additional `source`-tagged
  concatenated monsters.

#### Added — `.gitignore`
- `__pycache__/` and `*.pyc` for the bestiary scripts' bytecode cache.

#### Verified
- Normalized output: **819 monsters** (`{'mm-2024': 503, 'tob-v1': 316}`).
- Spot-checks: Nihilith (CR 12) parses with 6 actions / 1 reaction / 3
  legendary, condition immunities cleanly 9 items long. Algorith (CR 10)
  has 4 actions (Multiattack, Logic Razor, Cone of Negation (Recharge
  5–6), Reality Bomb (5/Day)). Young Flame Dragon (CR 9) carries Bite +
  Claw + Fire Breath (Recharge 5–6). Air Elemental unchanged
  (regression-free against the new last-`;` split).

### Menagerie: structured damage + HP that auto-derive from stats

Pushes the auto-recalculation through one level deeper. Two changes:

1. **Attack damage** is now structured as `dice (NdM) + ability mod + magic
   bonus`. The composed expression — including the `+5` inside `2d10+5` —
   recomputes when the driving ability mod changes. Previously only the
   attack roll bonus updated; the damage formula was preserved verbatim.
2. **HP** can be entered as **structured hit dice** (count · size · magic
   bonus). The HP value and the `NdM + K` formula are derived from
   `count × (size + 1)/2 + count × CON_mod + magic`. When CON changes, HP
   recomputes.

#### Damage shape (attack templates)

Each of `melee_attack`, `ranged_attack`, `flex_attack` now stores:
- `damageDice: 'NdM'` — just dice, no inline bonus
- `damageBonus: int` — explicit "magic" or non-stat-tied bonus
- `useAbilityMod: bool` — when true, the attack's ability mod is added

Compose builds the final string: `NdM + (useAbilityMod ? mod : 0) +
magicBonus`. A new "Add ability mod to damage" checkbox in each template's
form makes the linkage explicit and toggleable.

**Backward compat**: a heuristic `isLiteralDiceFormula(dice)` checks whether
the stored dice contains `+/-`. If yes, treat it as an old-style literal and
compose verbatim (no auto-recompute). New templates produce the new shape
going forward; previously composed actions on the same monster keep their
behavior until re-composed.

#### HP shape (Defense panel)

- New blank-monster fields: `hpStructured` (bool), `hitDiceCount`,
  `hitDieSize`, `hpMagicBonus`.
- New form row in the Defense panel — a "Use structured hit dice" checkbox
  + hit-dice-count + hit-die-size + magic HP bonus inputs + a derived chip
  showing `HP X · formula NdM + K`.
- When the toggle is on, the `HP` and `HP formula` inputs become read-only
  and auto-fill from the derivation each `syncEditor()` pass.
- `parseHpFormula(str)` round-trips imported `hpFormula` strings (e.g.
  `"20d10 + 40"`) back into structured fields on `loadFormFromEdit`. The
  back-derived "magic" portion is `totalBonus - count × CON_mod` — anything
  the formula has on top of the CON contribution stays as the explicit bonus.
- `hitDieSizeFor(size)` defaults the die: Tiny=d4, Small=d6, Medium=d8,
  Large=d10, Huge=d12, Gargantuan=d20.
- `statSnapshot()` now includes the structured-HP fields so the
  existing "stat changed → recalc" path also covers HP.

#### Verified end-to-end

CR 10 monster (PB +4), STR 20 (+5), CON 18 (+4), structured hit dice 12d10
with 0 magic bonus. Bite composed via melee template: dice `2d10`,
useAbilityMod=true, magicBonus=0.

- Initial: HP `114 (12d10 + 48)` · Bite `+9 to hit ... 16 (2d10+5) Slashing`.
- STR 20 → 18 (mod +5 → +4): Bite `+9 → +8`; damage `16 (2d10+5) → 15 (2d10+4)`;
  HP unchanged.
- CON 18 → 14 (mod +4 → +2): HP `114 → 90`; formula `12d10 + 48 → 12d10 + 24`;
  Bite unchanged (no STR/CON dependency).

### Menagerie: auto-recalculate templated actions when stats change

When the DM changes an ability score, the monster's CR, or the monster's
name, every action composed from a template now auto-updates its attack
bonus / save DC / subject so the numbers stay correct. Hand-edited actions
are skipped — once you edit a templated action's name or body manually, the
link severs and that action's prose is yours.

#### Behavior summary

Stamping: composing from a template attaches a `_template` field to the
action: `{ kind, fields, targetSection, trigger, legendaryCost }`. Survives
Save → KV round-trip (it's part of the saved action object).

Recalc trigger: a small stat snapshot `{ cr, pb, name, mods[] }` is compared
in `syncEditor()` before and after each form read. If anything changed,
`recalcTemplatedActions()` walks every section, re-runs `compose()` for each
`_template`-tagged feature, re-applies section wrapping (Trigger/Cost), and
updates the name + body in place. Only sections that actually changed get
re-rendered, so focus on stat inputs is preserved.

Severance: when `updateFeature(section, idx, 'name'|'body', val)` fires from
a user keystroke, the `_template` is removed from that action. Auto-recalc
won't touch hand-edited actions again. (Edits via the template modal still
re-stamp `_template`, so the link can be restored by re-composing.)

Visual cue: a small **🔗** badge sits next to the name input on linked
features, with hover text identifying the template kind. The badge
disappears the moment you edit the name or body.

#### What does and doesn't update

- ✅ **Attack bonus** (`mod + PB`) — recomputed from current ability mods + PB.
- ✅ **Save DC** (`8 + PB + mod`) — recomputed from the stored "monster
  ability driving DC" + current PB + that ability's current mod.
- ✅ **Multiattack subject** — "The X makes…" reflects the monster's current
  name.
- ✅ **"Use Existing Action" body** — same; the `<monster>` token reflows.
- ❌ **Damage dice** — the explicit `NdM+K` you typed stays as-is. We can't
  tell whether `+5` was your STR mod or a +5 magic weapon you want
  preserved. Edit the dice if you want the bonus to track.
- ❌ **Damage averages** inside the dice expression — derived from the dice
  text via `avgFromDice`, so they update automatically iff you change the
  dice text yourself.

#### Added — `bestiary-dm.html`
- `applySectionWrapping(name, body, targetSection, trigger, legendaryCost)`
  refactored to take wrapper data as parameters (was reading modal state).
  Reused by both modal preview and auto-recalc.
- `statSnapshot(monster)` — stable JSON string of stat-relevant fields.
- `recalcTemplatedActions()` — walks all FEATURE_SECTIONS, re-derives every
  templated feature, returns the count changed. Re-renders only the sections
  that actually changed.
- `syncEditor()` captures the snapshot before/after the form read; calls
  recalc when they differ.
- `updateFeature()` severs `_template` on name/body edits.
- `composeFromTemplate()` stamps `_template` on every newly added feature.
- `renderFeatureList()` paints the 🔗 badge with template-label tooltip
  for linked features.

#### Verified end-to-end

Set up CR 10 monster (STR 20 / CON 18 / PB +4 / name Glass Hydra). Composed
three templated actions: Bite (melee STR, 2d10+5 Slashing, reach 10), Fire
Breath (recharge save effect on CON DC), Multiattack.

- Initial bodies: Bite `+9 ... 16 (2d10+5) Slashing`, Fire Breath
  `DC 16, 6d6 Fire`, Multiattack `The glass hydra makes two Bite attacks`.
- STR 20 → 18 → Bite recomputed to `+8`; Fire Breath unchanged (CON
  unchanged); Multiattack unchanged (name unchanged).
- Name Glass Hydra → Crystal Wyrm → Multiattack updated to
  `The crystal wyrm makes two Bite attacks`; others unchanged.
- Hand-edited Bite's body → `_template` removed (linked=false);
  subsequent STR 18 → 14 left Bite alone (its body intact); Fire Breath
  and Multiattack still linked and not touched (no stat link triggered).

### Menagerie: load an existing monster into the editor as a copy

Two new entry points for the "I like this monster, but I want to riff on it"
workflow. The source monster is never touched — both paths deep-clone the
monster into the editor's working state with the source `id` stripped, so
the next Save mints a fresh entry in `bestiary_custom`.

#### Path 1 — Browse → "📋 Edit a copy"

A small button at the top of the Browse-tab stat block view. Click it on
any monster (imported or custom) and the page switches to the Editor tab
with the monster pre-loaded as `"<name> (copy)"` and a blank id, ready
to tweak.

#### Path 2 — Editor → "📋 From existing…"

A new button in the Editor's chip strip next to "+ New monster". Opens a
small picker modal with a name search and a scrollable list of every
monster (imported + custom) sorted by CR. Click a row → it loads into the
editor and the modal closes. The picker caps the rendered list at 200
entries to keep the DOM small; further results are reachable via the
search filter.

#### Added — `bestiary-dm.html`
- `cloneMonsterToEditor(monsterId)` — deep-clones the monster, strips the
  `_custom` runtime tag, clears the `id`, suffixes the name with `" (copy)"`,
  sets `source: 'custom'`, swaps `currentEdit` + clears `editingId`,
  refreshes the form, and switches to the Editor tab.
- `openClonePicker()` / `closeClonePicker()` / `renderCloneList()` /
  `pickCloneSource(id)` — the small picker modal and its filter.
- Modal markup `#clone-modal` reuses the existing `.modal-backdrop` +
  `.tpl-modal` styles; just three new clone-specific selectors
  (`.clone-search`, `.clone-list`, `.clone-row`).

#### Verified
- Browse path: searched "Aboleth", opened stat block, clicked "📋 Edit a
  copy". Tab switched to Editor, name became "Aboleth (copy)", id empty,
  source "custom", all 4 actions copied (Multiattack first).
- Editor path: clicked "📋 From existing…", filtered to "Adult Black
  Dragon", clicked the row. Modal closed; editor showed
  "Adult Black Dragon (copy)" with AC 19, HP 195, Multiattack as first
  action, editingId=null so Save will mint a fresh entry.

### Menagerie: action templates extended to Bonus/Reaction/Legendary sections

The "+ From template…" button — previously Actions-only — now sits on
**Bonus Actions**, **Reactions**, and **Legendary Actions** section headers
too. Composed entries land in the right section array; the modal title and
the primary button label both update to "Add to <Section>" so it's clear
where the result is going.

Two **section-specific wrappers** layer on top of the existing six
templates without changing them:

- **Reactions**: a *Trigger* textarea above the template form. When filled,
  the composed body is reframed as `Trigger: <text>\nResponse: <body>` —
  matches the 2024 MM reaction phrasing.
- **Legendary Actions**: a *Cost (actions)* numeric field (1–3, default 1).
  When > 1, the composed action name gets a `(Costs N Actions)` suffix.

#### New template — `Use Existing Action`

The most common Legendary pattern in the 2024 MM is "The X uses its Y."
A seventh template captures it: pick an existing action from this monster
(autocomplete via datalist, same shape as the Multiattack picker), and the
template emits `name: "<Action>"` + `body: "The <monster> uses its
<Action>."`. Recharge markers are stripped from the picked name.

The Legendary section defaults to this template when the modal opens —
the most common case becomes one click + Compose.

#### Added — `bestiary-dm.html`
- `openTemplateModal(targetSection)` accepts a section name. `_tpl.targetSection`
  drives the modal title, the primary button label, and where the composed
  result lands.
- `renderSectionWrapper()` paints the Trigger / Cost fields conditionally.
  `applySectionWrapping(name, body)` runs after the template's own compose,
  so all six existing templates work in any section automatically.
- `composeFromTemplate()` now pushes to `currentEdit[_tpl.targetSection]`
  rather than `currentEdit.actions`.
- Each of the four section headers has matching "+ From template…" + "+ Add
  blank" buttons.

#### Verified
- Title + button: "Add to Reactions" / "Add to Legendary Actions" / "Add to
  Bonus Actions" — all correct per opened section.
- Reactions get Trigger:/Response: framing applied; bonus actions get no
  wrapping (`tpl-section-wrap` is empty for them).
- Legendary cost defaults to 1 (no suffix), bumping to 2 emits
  `"Bite (Costs 2 Actions)"`.
- "Use Existing Action" default kind activates when opening Legendary;
  composes `"The glass hydra uses its Bite."` from a single Bite action.

### Menagerie: Multiattack template picks from this monster's defined attacks

Small UX win on top of the Phase 2 composer. The Multiattack template's
"Attack to multiply" field is now an `<input>` paired with a `<datalist>` —
typing autocompletes against attack-roll actions already defined on the
current edit, but the DM can still type a free name for an attack they'll
add later. The default value pre-fills to the monster's first defined
attack so the common path ("just added Bite, now I want a multiattack of
it") is one click + Compose.

Recharge markers on the source attack are stripped automatically — picking
"Tail Slam (Recharge 5–6)" from the dropdown produces a multiattack body
of `"…makes three Tail Slam attacks."`, not `"…three Tail Slam (Recharge
5–6) attacks."`.

#### Added — `bestiary-dm.html`
- `getAttackActionNames(monster)` returns `[{ full, base }]` for each
  attack-roll action on the monster (filtered by `Attack Roll:` in the
  body). `base` strips any trailing parenthetical from the name.
- Multiattack template's `renderForm` now emits a hybrid `<input
  list="…">` + `<datalist>`. Help text adapts: lists the picker hint when
  attacks are defined, prompts the DM to add one first (or type free)
  when none are.
- Multiattack `defaults(monster)` seeds `attackName` to the first defined
  attack's base name.

#### Verified
- Three attacks defined (Bite, Claw, Tail Slam (Recharge 5–6)) → datalist
  shows all three with full labels but base values (so the recharge
  marker on Tail Slam doesn't bleed into the multiattack body).
- Typing a custom "Spectral Bite" still produces the right body.
- Switching the picker from Spectral Bite → Claw updates the preview
  live and composes "The glass hydra makes two Claw attacks." correctly.

### Menagerie: template-driven action composer in the editor (Phase 2)

Builds on the Phase 1 classifier. The custom-monster editor's Actions section
gets a new **"+ From template…"** button that opens a structured form modal
covering the six action archetypes the Phase 1 analysis surfaced as covering
~95% of the corpus:

- **Melee Weapon Attack** — weapon name, ability, reach, damage dice + type, optional rider damage, recharge marker
- **Ranged Weapon Attack** — short/long range, otherwise same shape
- **Melee or Ranged (Flex) Attack** — both reach and range
- **Save Effect** — target's save ability, monster ability driving DC, area-text, damage on fail, "half on save" toggle, extra failure/success clauses, recharge
- **Multiattack** — attack count, named attack, optional preamble/coda
- **Spellcasting Block** — spellcasting ability, At-Will / 1·2·3/Day lists

Each template composes into the exact 2024 MM phrasing. A live preview pane
in the modal shows the body string as you type, and derived chips display the
attack bonus / save DC / damage averages computed from the monster's mods + PB.
Math goes through one shared `avgFromDice(dice)` helper (floor of `N·(M+1)/2 + K`,
which matches the book's rounding).

#### Added — `bestiary-dm.html`
- New action-template modal (`#tpl-modal`) with template selector at top,
  dynamic structured form in the middle, live preview pane at the bottom,
  Cancel / Add Action buttons in the footer.
- New `TEMPLATES` registry mapping each kind to `{ label, defaults(monster),
  renderForm(fields, monster), compose(fields, monster) }`. Easy to add more
  templates later — passive trait templates, lair-action templates, etc.
- Form re-renders on every input so the derived chips and preview update
  live. Focus + caret position preserved across re-renders so typing
  doesn't jump.
- "+ From template…" button placed next to the existing "+ Add blank"
  button on the Actions section. Other sections (Traits, Bonus, Reactions,
  Legendary, Lair) still get the blank "+ Add" only — most templates fit
  Actions; Phase 3 can expand if needed.

#### Composition examples (CR 10 monster: STR 20, CON 18, CHA 16, PB +4)

**Melee Weapon Attack** — "Bite", 2d10+5 Slashing + 2d6 Fire rider, reach 10:
> Melee Attack Roll: **+9**, reach 10 ft. Hit: **16** (2d10+5) Slashing damage plus **7** (2d6) Fire damage.

**Save Effect** — "Fire Breath", recharge 5–6, DEX save, CON DC, 6d6 Fire, half on save:
> Dexterity Saving Throw: **DC 16**, each creature in a 30-foot Cone. Failure: **21** (6d6) Fire damage. Success: Half damage only.

**Multiattack** — 3 Bite attacks:
> The glass hydra makes three Bite attacks.

**Spellcasting** — CHA, at-will Mage Hand · Message, 1/Day Lightning Bolt:
> The glass hydra casts one of the following spells, requiring no Material components and using Charisma as the spellcasting ability (spell save DC **15**):  
> At Will: Mage Hand, Message  
> 1/Day Each: Lightning Bolt

All four verified end-to-end in preview: bonuses match `mod + PB`, save DCs
match `8 + PB + mod`, damage averages match the book's rounding.

### Menagerie: action classifier + action-breakdown analysis (Phase 1)

First half of the template-driven editor work. A regex classifier walks every
action body in the imported bestiary and tags it with structured metadata
(kind, attack bonus, damage entries, save ability + DC, recharge marker,
inferred Str/Dex/Con/etc.). The Analysis tab gets a new **Action breakdown**
section showing what archetypes actually exist in the corpus — the basis
for Phase 2's template set.

#### Classifier shape — `bestiary-dm.html`

`classifyAction(action, monster) → { kind, attackBonus, damageEntries,
inferredAbility, saveAbility, saveDC, saveInferredAbility, recharge, perDay,
multiCount, reach, range }`

Action kinds covered:
- `multiattack`, `melee_attack`, `ranged_attack`, `flex_attack` (melee or ranged),
  `save_effect`, `spellcasting`, `recharge_attack`, `recharge_save`, `utility`

Inference helpers:
- **`inferAttackAbility(bonus, monster, kind)`** — matches the printed attack
  bonus to `(mod + PB)` for some ability. Tiebreaker prefers Str for melee
  and Dex for ranged.
- **`inferSaveAbility(dc, monster)`** — inverts `DC = 8 + PB + mod` to find
  the ability that powers the save. Tiebreaker prefers Con (the 2024 MM
  default for breath weapons / area saves), then Wis/Cha/Int/Str/Dex.
  Initial tiebreaker order was wrong (Wis/Cha first) and mis-attributed
  dragon-wyrmling breath weapons to CHA; verified with a sample inspection
  pass and fixed before commit.

#### Surfaces — `bestiary-dm.html` (Analysis tab)
- **Action kinds (overall)** — horizontal bar chart of total counts.
- **Attack ability (Str vs Dex)** — same shape, scoped to attack actions.
- **Action kinds × CR tier** — compact matrix (rows: 0–2, 3–5, 6–10, 11–15,
  16–20, 21+; cols: every nonzero kind).
- **Save effects by CR tier** — n, median DC, top inferred save ability with
  count.
- **Recharge / per-day** — % of monsters in each CR tier carrying at least
  one recharge action, plus total recharge action count.
- **Top action archetypes** — top-20 `(kind × ability × primary damage type)`
  tuples, sorted by frequency.

#### Spot-check numbers (full MM 2024)
- 503 monsters → 1,320 actions classified in ~7ms.
- Action kinds: Melee 506 · Multiattack 307 · Spellcasting 126 · Save 106 ·
  Save-recharge 97 · Ranged 79 · Flex 63 · Utility 34 · Attack-recharge 2.
- Attack ability split: STR 429 · DEX 178 · CHA/INT/WIS small (spell-attack-
  style cases) · CON 3 · Unknown 0.
- Top archetypes:
  - Melee · STR · Slashing — 146
  - Melee · STR · Piercing — 111
  - Melee · STR · Bludgeoning — 81
  - Melee · DEX · Piercing — 51
  - Melee · DEX · Slashing — 32
  - Save effect · CON · (no damage) — 31
  - Ranged · DEX · Piercing — 30
- Recharge scales with CR: 14% of CR 0–2 monsters → 65% of CR 16+.
- Every CR tier shows **CON** as the top save ability for save effects
  (matches 2024 MM canon: breath weapons / area saves are Con-built).

#### Phase 2 hook (not built yet)

These results suggest an ~8-template editor set covers ~95% of the corpus:
melee STR attack · melee DEX attack · ranged DEX attack · flex STR attack ·
save effect (CON) · recharge save (CON) · multiattack ("makes N attacks") ·
spellcasting block. Phase 2 will pick that taxonomy up and add a
"Quick add from template…" picker to the editor's feature sections.

### War Table: save and recall encounter presets

Caps the picker work: a DM can save a built-up Picks cart as a named
**encounter preset** under a new `encounters` KV key, then reload that exact
pick list (monsters · quantities · per-pick options · party config) into the
cart on a later session. Stored in KV (not localStorage) so encounters
follow the DM across devices, mirroring the homebrew-monsters pattern.

#### Added — `cloudflare-worker.js`
- New DM-gated **GET `?type=encounters`** endpoint returning the bare
  array of saved encounter presets.
- `'encounters'` added to `DM_WRITE_TYPES`. Requires a manual redeploy
  before saves persist.

#### Added — `initiative-dm.html`
- New **Saved encounters** section in the picker modal, between the
  bestiary list and the picks cart. Shows each preset with name, monster
  count, XP total, and the party config it was saved for. Clicking the
  row (or the explicit **Load** button) overlays the saved picks back
  into the cart; **×** deletes (with confirm).
- **💾 Save current as…** button next to the section header. Disabled
  when the cart is empty; otherwise prompts for a name, packages the
  current picks + party config + denormalized totals, and POSTs the
  full encounter array back to KV. The transient `expanded` flag is
  stripped — it's UI state, not part of the preset.
- Encounters fetched alongside the bestiary on first picker open (added
  to the parallel `loadBestiary()` Promise.all). The endpoint is
  tolerated as missing (e.g. before the worker redeploy) — picker
  still works, save flow surfaces a clear "worker may need to be
  redeployed" alert if the POST 4xxs.
- Load includes a confirm() if the cart already has picks so the DM
  doesn't accidentally clobber in-progress work. Also restores the
  preset's party config and re-persists it to localStorage so the
  budget panel snaps to match.

#### Preset shape
```js
{
  id: 'enc-<timestamp>-<rand>',
  name: 'Goblin Ambush',
  picks: [ { id, qty, rollHp, rollInit, hidden, hpOverride, initOverride }, ... ],
  party: { size, level },
  totalXp: 900,        // denormalized for fast list view
  monsterCount: 5,     // denormalized
  createdAt: ISO
}
```

#### Verification limit
Same caveat as the prior War Table changes — the page's boot-time
`pushState()` 401-races the fetch stub install in local preview, so the
full click-through couldn't be verified there. CRUD shape mirrors the
`bestiary_custom` editor save/load that *was* verified end-to-end.

### War Table: multi-pick + XP budget for the Bestiary picker

The picker shifts from "click a row, configure inline, add immediately" to a
**cart-style flow**: click rows to add them to a Picks list below the
bestiary, tweak quantities and per-pick options there, then load the whole
batch at once with a single button. A running **XP total** + **2024 DMG
difficulty thresholds** (Low / Moderate / High, per character × party size)
live at the bottom of the modal so the DM can build an encounter to
intentional difficulty rather than eyeballing it.

#### Added — `initiative-dm.html`
- Bestiary rows now show **XP per monster** in the meta column (replacing the
  per-monster init bonus, which had less value at pick time). Clicking a row
  adds it to the cart with sensible defaults (roll HP if a formula exists,
  roll init, not hidden); subsequent clicks bump qty.
- **Picks cart**: scrollable list below the bestiary. Each pick shows the
  monster name + per-monster XP + total XP, a `−/+ qty` stepper (qty=0
  removes), a remove ×, and a gear toggle that expands an inline options
  row (HP override, init override, roll-HP, roll-init, hidden).
- **Party config** (size + average level), persisted to `localStorage` as
  `init_party_config`. Default 4 chars at level 5 until overridden.
- **XP budget** panel: total XP picked, three threshold chips (Low /
  Moderate / High = per-char threshold × party size), and a one-line
  verdict colored to match the band. The chip for the band currently hit
  is highlighted gold.
- **Load button** at the modal footer disables when nothing is picked and
  labels itself "Load N monster(s) into combat". Spawning iterates the
  cart, rolls per-spawn HP and init, and posts everything in a single
  `pushState()` so the player init view updates once.
- Removed the old per-row expand UI (`bestiary-add-form` styles + the
  `addFromBestiary(id)` one-shot function) — superseded by the cart.

#### Verification
- XP math: 4 Goblins (50 ea) + 1 Ogre (700) = 900 → "low" band against
  party-of-4 level-5 thresholds (Low 2,000 / Mod 3,000 / High 4,400).
  Pushing an Adult Gold Dragon (20,000 XP) onto the cart → 20,900 → "over"
  band. A pick whose monster carries no XP value contributes 0, not NaN.
- Row markup: meta column shows XP (50) instead of INIT, the row click
  binds to `addPick('<id>')`, and the `in-picks` class renders when the
  monster is in the cart.
- Same caveat as the prior War Table change applies for the full live
  click-through (page's pushState→401→logout race kills fetch-stub
  verification); the unit tests above isolate everything that's new.

### War Table: pull monsters from the Bestiary into combat

A new **"📖 Add from Bestiary"** button under the manual Add form in the War
Table's right sidebar. Clicking it opens a modal picker that browses both the
imported MM bestiary and the DM's authored homebrew, with the same filter set
as The Menagerie (search · type · size · CR-min · CR-max). Each row expands
in-place into a small add-config form: quantity, HP/init overrides, roll-HP
toggle, roll-init toggle, hidden toggle, [Add].

Adding does the right things automatically:
- **HP rolled fresh per spawn** from `hpFormula` ("12d8 + 12") by default —
  each monster gets independent HP so a horde isn't carbon-copy. Toggle off
  to use the printed median HP, or supply an explicit HP override.
- **Initiative rolled** 1d20 + the stat block's `initiative` mod (falling
  back to dex mod). Toggle off for the static `initiativeScore`, or supply
  an explicit init override.
- **AC** comes straight from the stat block.
- **Naming**: solo picks use the raw name; multi-picks suffix " 1", " 2"…
  so the DM can rename if they want.
- **Combatant tagging**: each spawn carries `bestiaryId` + `bestiarySource`
  for future affordances (e.g. "view stat block" from the combatant card).
  Those tags are harmless to expose via `initiative_state` to players.

#### Added — `initiative-dm.html`
- New sidebar button + modal (`#bestiary-modal`) with filters, scrollable
  list, and per-row inline add-config.
- Lazy bestiary load on first open — `GET ?type=bestiary` +
  `?type=bestiary_custom` in parallel, merged into one searchable list with
  a small brass "Custom" chip on homebrew entries.
- `rollDiceFormula()` parser handles the standard "NdM[+/-K]" shape used by
  the 2024 MM (e.g. "12d8 + 12", "2d6-1", "3d8"). Floors at 1.
- `addFromBestiary(id)` reads the inline config, rolls HP and init per
  spawn, and appends N combatants to `state.combatants`. Triggers the same
  `render()` + `pushState()` the manual Add path uses, so player initiative
  views stay in sync.

#### Verification
- Dice math: `rollDiceFormula('12d8 + 12')` across 200 samples produced a
  mean of 65.2 (theoretical 66), range 44-82 within the 13-108 bounds.
  Rejects empty / garbage input.
- Row HTML: rendered a synthetic Goblin Minion through `bestiaryRowHTML()`
  — name, size/type/alignment subline, AC/HP/INIT meta column, CR chip
  all present, no undefined / null leaks. Expanded form has qty, HP and
  init override inputs, the roll-HP label, and the Add button.
- The full live click-through (open modal → search → expand → add → see
  combatant in init list) can't be cleanly verified in `python -m
  http.server` preview because the page's `pushState()` POSTs to the real
  worker on boot, gets a 401 against preview credentials, and triggers
  `Auth.logout()` + redirect before a fetch stub can be installed. The
  picker logic mirrors the bestiary-dm patterns that *were* verified
  end-to-end, so the runtime behavior should match.

### Menagerie: Editor tab — WYSIWYG homebrew monster builder

A new **Editor** tab between Analysis and Import that lets the DM author
homebrew monsters with a live stat-block preview. Custom monsters live in
their own `bestiary_custom` KV key, separate from the imported MM bestiary,
so re-imports of source-book content never trample homebrew work. They show
up in Browse with a small brass "Custom" chip and merge into the Analysis
compute alongside everything else.

#### Added — `cloudflare-worker.js`
- New DM-gated **GET `?type=bestiary_custom`** endpoint returning the bare
  array of custom monsters.
- `'bestiary_custom'` added to `DM_WRITE_TYPES`. Requires a manual redeploy
  before saves persist.

#### Added — `bestiary-dm.html`
- **Editor** tab with a two-pane layout: form on the left (scrollable), live
  preview on the right (sticky). The preview reuses the same
  `renderStatblock()` function the Browse tab uses, so what you see in the
  preview is exactly what gets saved.
- Form covers the full stat-block schema:
  identity (name · size · type · subtype · alignment · CR), defense
  (AC · AC text · HP · HP formula · speed for walk/fly/swim/burrow/climb
  with a hover toggle · initiative bonus), abilities grid (6 ability cells
  with auto-mod display and a save-bonus override per ability — the save
  follows the mod until the user deviates, then stays user-set), traits /
  defenses / senses (skills · senses · languages · resistances · damage
  immunities · condition immunities · vulnerabilities · gear), six feature
  sections (traits · actions · bonus actions · reactions · legendary
  actions · lair effects), and a description textarea.
- Each feature section has add / move-up / move-down / remove controls and
  paints a list of `{name, body}` row editors.
- **"Fill from CR median" button** wires the Editor into the Analysis tab's
  compute — fills empty AC and HP from the current CR's median (so it
  doesn't trample anything you've typed). Surfaces the suggested attack
  bonus, primary damage, and save DC for that CR cohort in a toast for the
  DM to use when authoring actions. Computes the analysis synchronously if
  the cache isn't warm yet (~4ms over 503 monsters).
- XP and PB derive automatically from CR via a baked-in 2024-MM XP table
  and the standard PB-by-CR thresholds.
- Custom monsters' speed array is round-tripped through `speedText` so the
  preview's `(hover)` suffix renders the same as imported monsters.
- **Top strip** shows clickable chips for every saved custom monster (click
  to load into the form, current selection highlighted) and a "+ New
  monster" button.
- Save / Duplicate / Delete buttons. Delete prompts a `confirm()`. Duplicate
  copies the current edit, clears the id, and renames the working copy to
  `<name> (copy)` so the next Save mints a new entry instead of overwriting.
- **Browse** and **Analysis** tabs now operate on
  `allMonsters() = bestiary + customMonsters` — the Browse list, filters,
  CR sort, and Analysis cohort medians all include custom monsters
  automatically. Custom rows in Browse carry a small "Custom" chip next
  to the name. The source line picks up a `+ N custom` suffix when present.

#### Verification
- Stubbed worker, ran end-to-end in a local preview: authored a CR 5
  "Glass Stalker" (Aberration · Neutral Evil), clicked **Fill from CR
  median** → AC autofilled to 15, HP to 94 (matches the Typical-stats-by-CR
  row from Analysis), added an action with the standard 2024 prose pattern,
  saved, switched to Browse, searched, confirmed the row carried the custom
  chip, and the stat block re-rendered identically to the editor preview.

### Menagerie: lair-effects re-scrape patch

Closes the gap the description-prose parser couldn't reach — 26 monsters
(all the Adult/Ancient dragons, plus a handful of others) carried `xpInLair`
but had no lair text anywhere in the raw scrape. A targeted re-scrape of
`<h3 id="...Lairs">` sections on the affected DDB chapter pages, fed into the
normalizer via a patch file, fills those in. The lair-effects coverage card
goes from 2% → 6% on MM 2024.

#### Re-scrape technique
- Source pages on DDB store lair effects in a shared `<h3 id="...Lairs">`
  section per lineage (`#BlackDragonLairs` covers both Adult and Ancient
  Black Dragons; `#VampireLairs` covers Vampire and Vampire Umbral Lord;
  etc.). Each effect is a `<p>` whose first child is `<strong>Name.</strong>`.
- A Chrome-side snippet (not committed — matches the existing Obojima
  technique) walks `<h3[id$="Lairs"]>` headings on whichever chapter page is
  open, gathers `<p>` siblings until the next heading, and accumulates the
  result into `localStorage` across visits. A final `__downloadLair()` call
  emits `mm2024-lair-patch.json`.

#### Added — `scripts/normalize_bestiary.py`
- `candidate_lair_section_ids(m)` derives candidate section IDs from a
  monster's name (strip "Adult"/"Ancient", drop "of Lore" / "Umbral Lord" /
  "Captain" / "Stalker" suffixes), then falls back to its `group` field. The
  first candidate present in the patch wins.
- `apply_lair_patch()` merges the patch in after monster normalization;
  monsters that already got effects from the description-prose parser are
  skipped (idempotent re-runs are safe). Logs `_patch.applied` and
  `_patch.stillMissing` on the output for traceability.
- `SCHEMA_VERSION` bumped to 3.
- Result on MM 2024: 23 of 26 gap monsters filled. 3 still missing —
  Mummy Lord and Adult/Ancient White Dragon (pending a follow-up scrape of
  `monsters-m` and `monsters-w`).

#### Added — `.gitignore`
- `mm2024-*.json` covers the new patch file (and any future MM 2024
  satellites). The patch is third-party content and stays out of the public
  repo.

### Menagerie: parse Lair Effects out of description prose

The original scraper didn't capture the 2024 MM's "Lair Effects" section — it
folded the text into the `description` field instead. A re-parse pulls them
back out into a structured `lairEffects` array on the monster. Schema bump to
v2.

The 2024 MM uses **Lair Effects** (passive environmental changes that apply
while the monster is in its lair) rather than 2014's "Lair Actions" (an
initiative-20 action). They're different mechanics; left `lairActions`
untouched (empty for MM 2024 since the book doesn't use that form) and added
`lairEffects` as a sibling.

#### Added — `scripts/normalize_bestiary.py`
- `extract_lair_effects()` finds the section between
  `"creating the following effects:"` and `"If <monster> dies/is destroyed or
  moves its lair elsewhere"`, then splits it on title boundaries. Title rule:
  1-4 tokens, each either Title-Cased or a small joiner ("and"/"of"/"the"/"in").
  Distinguishes effect titles ("Foul Water.", "Sea and Storms.", "All-Seeing.")
  from body sentences ("Creatures within 1 mile...") whose second token is
  lowercase. Bumps `SCHEMA_VERSION` to 2.
- Net result on MM 2024: **9 monsters, 18 lair effects** parsed cleanly —
  Aboleth, Arch-hag, Beholder, Death Tyrant, Demilich, Dracolich, Kraken,
  Lich, Unicorn.

#### Added — `bestiary-dm.html`
- Stat block renders a new **Lair Effects** section beneath Lair Actions.
- Analysis summary card relabeled "Lair effects" and now counts a monster as
  having a lair if it carries either `lairActions` or `lairEffects` (so the
  headline isn't misleading for MM 2024). Goes from 0% → 2%.

#### Re-scrape gap (documented, not fixed)
- 26 monsters carry an `xpInLair` value but no lair text anywhere in the
  scraped data (all Adult / Ancient dragons, plus Mind Flayer Arcanist and a
  few others). Those would need a re-scrape from DDB to recover — the source
  page presumably has a lair section the original Chrome scrape missed.

### Menagerie: Analysis tab — typical stats by CR + supporting aggregates

The Menagerie gets its own Analysis tab, modeled after the Apothecary's. The
load-bearing piece is a **Typical stats by CR** table — for each CR present in
the imported bestiary it shows n, median AC (range), median HP (range), median
attack bonus, median primary damage, and median save DC. This is the table the
upcoming stat-block editor and random generator will lean on to answer "what
should a CR X monster actually look like?".

Three supporting sections fill out the picture without bloating the tab:
- Summary cards: total · CR range · # types · % multiattack · % spellcasting · %
  legendary · % lair (the lair column reads 0% today — the scraper didn't
  capture lair actions; will need a re-scrape pass to fix).
- CR distribution as a text bar chart (one row per CR present).
- Damage-type frequency across all action prose, color-coded per the existing
  affinity palette (so Fire reads orange, Cold blue, Radiant gold, etc.).

#### Added — `bestiary-dm.html`
- New **Analysis** tab. Compute is lazy + cached (`window.__anaCache`) — first
  click runs ~4ms across 503 monsters; subsequent tab switches reuse the cache.
  Import clears the cache so a fresh bestiary forces a recompute.
- Action-prose parser (regex-based, best-effort): attack bonus from
  `Attack Roll: +X`, primary damage as the leading "(NdM) Type damage" number
  on the first non-Multiattack action, save DC from `Saving Throw...: DC X`
  (largest DC across all features). "Multiattack" is always skipped as the
  primary attack since it's an orchestration line, not a damage line.
- Spot-checked numbers align with published 2024 design guidance:
  CR 1/4 → AC ~12-13, HP ~13, atk +4, dmg 5, DC 11.
  CR 5   → AC 15, HP ~94, atk +7, dmg 13, DC 14-15.
  CR 30  → AC 25, HP 697, atk +19, dmg 36, DC 27.

### The Menagerie — DM bestiary, KV-backed

First slice of the monster-tracker effort. A new DM-only tool that ingests a
normalized bestiary (output of the new `scripts/normalize_bestiary.py`), stores
it under a `bestiary` KV key, and presents a 5e-style stat block browser with
search and CR/type/size filters. Followups (analysis tab, WYSIWYG editor,
random generator, "add to encounter" wiring into the War Table) build on this
foundation.

#### Added — `cloudflare-worker.js`
- New **GET `type=bestiary`** endpoint, DM-gated. Returns the stored bestiary
  envelope (or `{monsters:[]}` when empty). The data is from copyrighted source
  books and is never served to players directly.
- `'bestiary'` added to `DM_WRITE_TYPES` so DM POSTs save into KV.
- **Requires a manual worker redeploy** to take effect.

#### Added — `bestiary-dm.html` (new)
- **Browse** tab: filterable monster list (name search · type · size · CR-min ·
  CR-max), sorted by CR then name. Selecting a row renders a full stat block:
  header line, AC/HP/Speed/Initiative, ability grid with saves, skills,
  resistances / damage immunities / condition immunities / vulnerabilities,
  senses, languages, CR · XP · PB, gear, traits, actions, bonus actions,
  reactions, legendary actions, lair actions, and the source description.
- **Import** tab: pick a `bestiary.json` file → preview the monster count →
  push the whole envelope into the `bestiary` KV key. Tolerates either an
  envelope (`{monsters:[...]}`) or a bare array.
- Tolerant of incomplete fields (missing skills/senses/etc. degrade quietly).

#### Added — `scripts/normalize_bestiary.py` (new)
- One-shot normalizer that converts a raw DDB bestiary scrape (e.g.
  `mm2024.json`) into the canonical schema. Additive — every original field is
  preserved; structured siblings are added next to them. Re-runnable.
- Repairs 63 "Medium or Small Humanoid"-style scrape artifacts: `size` keeps the
  primary; `sizes` carries the list; `type` is the cleaned type word; `types`
  is the list (so dual-type entries like *Celestial or Fiend* parse cleanly).
- Splits the unparsed `resistancesText` / `immunitiesText` / `vulnerabilitiesText`
  strings into structured arrays (`resistances`, `damageImmunities`,
  `conditionImmunities`, `vulnerabilities`), keeping parentheticals attached
  (e.g. `"Charmed (with Mind Blank)"`).
- Stamps `schemaVersion: 1` and a `normalizedAt` timestamp on the output.

#### Added — `home.html`
- New DM tool card **The Menagerie** pointing at `bestiary-dm.html`, with a
  small "wild beast head" SVG icon to match the slate-and-brass card style.

#### Added — `.gitignore`
- Added `mm2024.json`, `mm-*.json`, `bestiary.json`, `bestiary-*.json` to the
  third-party-content block. The repo is public — book scrapes and the
  normalized bestiary stay local; the data only ever leaves your machine to
  reach your own worker's KV.

### Apply affinity tags from file — bulk-tag ingredients

A new file-import in the Apothecary's Import tab that reads a small
`{id: affinity}` map and sets each listed ingredient's affinity in one shot.
Safe to re-apply (only listed ingredients are touched), so the JSON file is a
living document — edit and re-import as you refine tags.

#### Added — `brew-dm.html`
- New **Apply affinity tags** form in the Import tab. Accepts a file shaped
  `{tags: {id: affinity}}` (or just `{id: affinity}`). Reports applied / unchanged /
  unknown-id counts after the merge.
- Re-renders the Ingredients list and invalidates the cached Analysis result so
  the next visit to the Analysis tab recomputes against the new tags.

#### Added — `obojima-affinity-tags.json` (gitignored)
- Initial affinity classification for all 135 Obojima ingredients: 95 tagged, 40
  left blank (mundane items like *Chicken Egg*, *Earwax*, *Apper Carrot* — they
  trigger the "random version" path on a brew). Themes follow the descriptions:
  *Boom Beri / Jumping Bonfire / Coal* → fire, *Bottled Lightning / Spark Plug* →
  lightning, *Pungent Sea Foam / Lionfish Poison* → poison, *Ribbon Rot / Night
  Thistle / Corrupted ___* → necrotic, *Spirit Root / Sun Shroom / Tears of the
  Moon* → radiant, etc. Per-affinity counts: nature 23, fire 16, radiant 12,
  necrotic 11, psychic 9, force 7, poison 5, acid 4, thunder 4, lightning 3, cold
  1 (the snow dragon's breath — the only obvious cold-themed ingredient).

### Analysis tab — combo coverage for affinity tagging

A new **Analysis** tab in the Apothecary that runs the full combinatorial analysis
(every C(135, 3) = 400,995 unique-ingredient combo) and shows how many combos
land on each slot, broken down by ingredient affinity. Use it to spot authored
variants you can't actually brew and to gauge whether you have enough affinity-
tagged ingredients to cover every authored variant.

#### Added — `brew-dm.html`
- New **Analysis** tab with auto-run on first open + a Recompute button.
- **Summary cards**: ingredient/affinity-tagged counts, potion/variant counts, total combos.
- **Unreachable / thin variants warning**: any authored potion with affinity X where
  no combo reaches that slot with an X-tagged ingredient is flagged red.
- **Affinity coverage table**: every authored affinity variant sorted by reach
  ascending (worst first). Each row shows the potion, slot, affinity chip, combos
  that reach it with that affinity, and total combos at the slot. Rows go red for
  0 reach and amber for &lt; 5.
- **Slot overview matrix**: 60 rows × 3 columns showing per-slot combo counts; thin
  slots (0 or &lt; 5) are tinted red/amber.

All client-side over the existing `data.ingredients` / `data.potions` — no worker
or KV changes. The C(135, 3) loop runs in ~30 ms in the browser.

### Elemental affinities — variant selection inside a slot

Potions and ingredients can carry an optional **elemental affinity** (`fire`,
`cold`, `lightning`, `nature`, etc. — any free-text element name). On a clean
brewing success, the affinities present in the 3 ingredients pick which variant
within the slot you actually brew. Lets you author "Dragon's Breath – Fire / Cold /
Lightning" at one slot, plus a fire-affinity ingredient to steer toward Fire.

**The rule (clean success, margin 0–9):**
- **0 affinities** in the 3 ingredients → random version among the slot's potions.
- **1 affinity** (any number of ingredients of that element) → the slot's variant
  with that affinity. Falls back to the official if no variant matches.
- **2+ distinct affinities** → `choose` outcome; player picks among the slot
  variants whose affinity matches one of the active elements.

Other outcomes are unchanged: a masterful +10 still gives free pick of every
potion in the slot, near-misses still roll random, sludge/negative still apply.
The brew check itself isn't affected.

#### Worker (`cloudflare-worker.js`)
- `brewResolve` now tallies ingredient affinities, returns `slot.affinity = {tally,
  active}`, and chooses the success variant per the rule above. Returns a new
  `chooseReason: 'mastery' | 'affinity'` so the UI can label the picker correctly.
- ⚠️ **Requires another manual worker redeploy.**

#### Editor (`brew-dm.html`)
- New **Elemental affinity** field on the Ingredient, Potion, and Library forms.
  Library → "Slot it" copies the affinity through to the slotted potion.
- Affinity chips render in the Ingredients / Potions / Library lists, colored by
  element (fire = red, cold = blue, lightning = gold, nature = green, etc.; unknown
  elements get a neutral chip).

#### Player (`brew.html`)
- Affinity chips show on ingredient picker rows and in the filled recipe slots.
- An **Affinity** tally appears under the Combat/Utility/Whimsy bars (e.g.
  "fire ×2  cold").
- The `choose` panel now reads "Multiple affinities — pick your variant" for
  affinity-driven picks (vs. the existing "Masterful — choose" for the +10 path),
  and each option shows its affinity chip.

#### Backward compatibility
- All affinity fields default to empty — existing ingredients/potions keep brewing
  exactly as before. Affinity only changes behaviour when both an ingredient *and*
  a slot variant carry one.

### Potion library — standard 5e potions, assignable to slots

A reference shelf of standard D&D potions the DM can drop onto Obojima brew slots.
Imported the 28 potions from the 2024 Dungeon Master's Guide (Magic Items A–Z):
Healing, Fire Breath, Flying, Giant Strength, Invisibility, the Oils, etc.

A library potion is `{id,name,rarity,attunement,effect,source}` in a new
`potion_library` KV key. It is **not** brewable on its own — the brew math is
untouched. Instead the DM places one onto a slot, after which it brews and grants
as a recipe like any other potion.

#### Added — `brew-dm.html` (DM)
- **Library** tab: manage the standard potions (search / edit / delete) and
  **Import seed** (`dnd-potions-seed.json`, merge by id — re-import skips dupes).
- **Slot it** on a library potion jumps to the Potions tab with the name + effect
  pre-filled; the DM sets the list + number and saves it as a real slotted potion.

#### Worker (`cloudflare-worker.js`)
- `potion_data_dm` now returns `library`; `potion_library` added to the DM write
  types + KV keys. (Players don't fetch the library directly — it only reaches them
  once a library potion has been slotted into `potions`.)
- ⚠️ **Requires another manual worker redeploy.**

#### Data / privacy
- DMG potion text is third-party copyrighted content: `dnd-potions-seed.json` is
  gitignored and lives in KV only, same as the Obojima data.

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

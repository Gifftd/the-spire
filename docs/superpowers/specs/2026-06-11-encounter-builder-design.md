# Encounter Builder

**Status:** Draft
**Date:** 2026-06-11
**Files affected:** `encounter-dm.html` *(new)*, `cloudflare-worker.js`, `initiative-dm.html`, `map-dm.html`, `sessions-dm.html`, `crucible-dm.html`, `home.html`, `theme.css` *(minor)*, `tests/encounter-schema.test.html` *(new)*, `CHANGELOG.md`

## Problem

There's already a partial encounter system: inside the War Table's bestiary
picker modal, the DM can save a named bundle of bestiary picks
(`encounters` KV key, DM-gated) and reload it. This handles "what monsters
appear" but nothing else.

Everything *around* the monster list lives in the DM's head or in scattered
notes:

- **Where** the fight happens (terrain, lighting, surprise side, starting
  positions, wave-arrivals).
- **How** the fight runs (per-monster tactics, retreat triggers, victory
  conditions, opening read-aloud text).
- **What** drops (pre-staged loot — currently typed in by hand at export
  time).
- **Lifecycle** (is this encounter prepped, scheduled, already resolved,
  archived?).
- **Connections** to other tools (which location it's at, which planned
  session it belongs to, which NPCs are involved).

The result: every fight requires the DM to mentally re-stitch context at
session time, prep notes live in a separate document outside the toolset,
and the rich pre-session work doesn't survive into the live tracker or the
post-session chronicle.

## Goals

- A single tool that is the canonical place to author, browse, and launch
  encounters.
- The DM's prep effort (tactics, terrain, loot, NPC bindings) flows
  automatically into the War Table at session time and into the Chronicle
  at export time — no re-typing.
- Encounters are first-class records linked to map locations, planned
  sessions, and named NPCs from the roster.
- Existing saved encounters migrate forward without manual intervention.
- DM-only end to end. No new player-visible surface.

## Non-goals

- **Player-visible foreshadowing / rumor fields.** Would re-open the
  visibility-model surface and isn't required for the core workflow.
- **Auto-wave spawning.** Wave-arrivals are surfaced as DM reminders, not
  automatic combatant additions.
- **Crucible → "Save as encounter" reverse flow.** Crucible reads; the
  builder authors.
- **NPC `history[]` auto-append on resolution.** Deferred polish.
- **Encounter inheritance / templates.** Duplicate-and-edit is the v1
  primitive.
- **Bulk operations** (multi-select archive/delete).
- **Replacing the in-modal bestiary picker for ad-hoc adds.** The picker
  stays in War Table for mid-session improvisation; only its save/library
  UI moves to the builder.

## Design

### Page architecture — `encounter-dm.html`

Three-pane layout, mirroring `map-dm.html` (Atlas Workshop). DM-only:
script body opens with `Auth.requireRole('dm', { redirect: 'home.html', notice: '...' })`.

**Left pane — Library** *(~280px on desktop)*
Vertical list of every saved encounter. Each row: name, status pill
(draft / ready / scheduled / live / completed / archived), CR-budget
difficulty band, monster count, icon row for location / session / NPC
linkages. Above the list: filter bar (text search, status multi-select,
linkage filter chips, sort options). "+ New encounter" button at top.
Selected row highlights.

**Middle pane — Editor** *(~500px, scrollable)*
Sectioned by collapsible `<details>` (existing theme styling):

1. **Identity** — name, description, tags, status
2. **Combatants** — bestiary picker UI lifted from the War Table modal.
   Reuses the existing `_BP` state shape, picker DOM, FM CR-budget math,
   per-pick options.
3. **Tactical setup** — terrain, lighting (enum), surprise side (enum),
   starting positions / distance (textarea), waves (repeatable rows),
   opening read-aloud (textarea)
4. **DM playbook** — overall tactics, per-monster tactics (one row per
   pick), retreat triggers, victory conditions, DM-only reminders
5. **Pre-staged loot** — same row shape as War Table's loot for trivial
   pre-fill at export
6. **Linkages** — location picker (Atlas), session picker (Chronicle),
   NPC roles (chip grid with role dropdown)

**Right pane — Launchpad** *(~280px, sticky)*
Always-visible summary + actions:

- CR-budget readout (FM math, color-coded difficulty band)
- Monster count, total HP, total XP
- Status pill (large) + status changer dropdown
- **▶ Run on War Table** (primary action — brass button)
- **⚗ Send to Crucible**
- "Last run" summary (timestamp, session, outcome) when status =
  completed
- Overflow menu: Duplicate, Archive, Delete

**Responsive collapse** (<1100px): right pane collapses to a sticky
bottom bar (Run button + status + CR band); left pane becomes a
hamburger drawer. Matches existing mobile patterns.

**Pop-out editor:** reuse Atlas Workshop's `:has()`-based widen-to-900px
overlay. Optional polish; CSS already exists.

### Data model

Stored in the existing `encounters` KV array, DM-only. Schema-versioned
for safe forward migration.

```js
{
  // ── Identity ──
  id: "enc_<timestamp>_<rand>",     // stable
  schemaVersion: 2,                 // existing records read as v1
  name: "Cult ambush at the chapel",
  description: "",                  // one-liner for library row
  tags: ["set-piece", "boss"],      // autocomplete from existing
  status: "draft",                  // draft | ready | scheduled | live | completed | archived

  // ── Combatants (existing shape, extended) ──
  picks: [
    {
      id: "<bestiary id>",
      qty: 3,
      rollHp: true, hpOverride: null,
      rollInit: true, initOverride: null,
      hidden: false,
      // NEW:
      pickKey: "p1",                // stable within encounter; waves reference it
      tactics: "",                  // per-pick DM notes
      startingConditions: []        // ["invisible","blessed"] — applied on stage
    }
  ],
  party: { size: 4, level: 5 },     // existing — drives FM CR-budget
  totalXp: 0,                       // existing — denormalized
  monsterCount: 0,                  // existing — denormalized

  // ── Tactical setup ──
  tactical: {
    terrain: "",
    lighting: "bright",             // bright | dim | dark | varied
    surprise: "none",               // none | party | monsters | both
    startingPositions: "",
    waves: [
      { round: 2, pickKey: "p2", count: 3, fromDirection: "south door", notes: "" }
    ],
    readAloud: ""                   // shown to DM at top of tracker on stage
  },

  // ── DM playbook ──
  playbook: {
    overallTactics: "",
    retreatTriggers: "",
    victoryConditions: "",
    reminders: ""
  },

  // ── Pre-staged loot (matches War Table loot row shape) ──
  loot: [
    { id: "lt_<random>", name: "Cultist signet ring", qty: 1, value: "—", notes: "" }
  ],

  // ── Linkages ──
  locationRef: null,                // see "Location references" below
  sessionId:  null,                 // → timeline entry id of planned session
  npcRoles: [
    { npcId: "npc_<id>", role: "enemy" }   // ally | enemy | hostage | witness
  ],

  // ── Lifecycle audit ──
  createdAt: "2026-06-11T...",
  updatedAt: "2026-06-11T...",
  lastStagedAt: null,
  resolvedAt: null,
  resolvedInTimelineId: null,       // timeline entry that recorded the outcome
  lastOutcome: null                 // won | tpk | fled | skipped | null
}
```

**Why `pickKey` exists:** `picks[].id` is the bestiary id (not unique if
"Goblin" is picked twice with different options). `pickKey` lets waves
and tactics target a specific row unambiguously. Assigned on save;
missing on v1 records, backfilled during migration.

**Location references — the sub-map disambiguation.** Map locations
are slugified from name (`map-dm.html` `slugify()` — lowercase,
alphanumeric, hyphenated). World-level pins live in
`worldData.locations[]`; sub-map pins live in
`worldData.locations[i].subMap.locations[]`. The id namespaces are
flat per scope — a world "chapel" and a sub-map "chapel" would
collide if stored as a plain string. So `locationRef` is structured:

```js
locationRef: null
  | { kind: "world",  locationId: "chapel" }
  | { kind: "submap", parentLocationId: "numira-bad", locationId: "chapel" }
```

Atlas Workshop's "Encounters here" filter compares the full ref shape,
not just `locationId`. The pre-fill at export time passes the resolved
world or sub-map context to the timeline entry. Existing v1 records
have no location ref at all — migration leaves `locationRef: null`,
and the DM picks one explicitly on first edit if desired.

### Worker changes — `cloudflare-worker.js`

The `encounters` GET + POST endpoints exist; the changes are
validation, migration support, and one new field on `initiative_state`.

**`encounters` GET**
No behavioral change. Optional: stamp `schemaVersion: 1` on records
lacking it before serialization. Lightweight, lets the front-end branch
cleanly.

**`encounters` POST — new validation**

- Enum validation: `status`, `tactical.lighting`, `tactical.surprise`,
  `npcRoles[].role`. Reject 400 on unknown values.
- `pickKey` uniqueness within each encounter when present. Reject 400
  with the offending id + duplicate key.
- `waves[].pickKey` must reference an existing `picks[].pickKey` in the
  same encounter. Reject 400 on dangling refs.
- Soft caps: 50 picks, 20 waves, 50 loot rows, 30 NPC roles per
  encounter.
- `pickKey` validation is **only enforced when present** — v1 records
  without `pickKey` still validate.
- `updatedAt` always set server-side from the `Date` header; client
  values ignored.
- Cross-record refs (`locationRef`, `sessionId`, `npcRoles[].npcId`)
  are **not** validated — too expensive, and broken refs degrade
  gracefully on display. `locationRef` IS validated for shape
  (`kind` enum + required fields when not null), but not for whether
  the referenced location actually exists.

**`initiative_state` POST — new pass-through fields**
War Table's staging code adds two top-level fields to the payload it
already POSTs:

- `encounterId: "enc_..."`
- `encounterStagedAt: "ISO timestamp"`

The worker passes them through. Both are stripped on the player GET
path via `filterInitiativeState` (defense-in-depth — same posture as
`notes` and `hidden`).

**`DM_WRITE_TYPES`** already includes `encounters` and
`initiative_state`. No additions.

**Manual redeploy required.** Front-end degrades to read-only with a
yellow banner if it detects 400s on save against an unredeployed
worker (consistent with `combat_drafts` graceful-degradation pattern).

### Migration v1 → v2

Lazy and reversible. No destructive up-front rewrite.

1. **Worker read:** stamps `schemaVersion: 1` on records missing it.
2. **Builder load:** `migrateInMemory(encounter)` walks each record. For
   `schemaVersion < 2`:
   - Assign `pickKey: 'p1', 'p2', ...` in `picks[]` array order.
   - Backfill empty defaults for new sections.
   - Set `status: 'ready'` (existing records were saved deliberately —
     safer default than `draft`).
   - Compute `updatedAt = createdAt` if not set.
   - Bump `schemaVersion: 2`.
3. **First save persists the v2 shape.** Migration writes lazily.
4. **Worker tolerates both shapes** during the transition.
5. **Optional polish:** a "Migrate all to v2" button in the builder
   topbar that batch-touches every record. One-time convenience.

**Pre-deploy backup:** snapshot the current `encounters` KV blob into
`backups/<timestamp>-encounter-builder-pre-migration/`. Standard
project hygiene.

### Cross-tool integration

#### War Table — `initiative-dm.html` (largest surface)

- **Remove:** the in-modal "💾 Save current as…" button and the saved
  encounters list inside the bestiary picker. The picker stays for
  mid-session ad-hoc adds; only the library UI moves out.
- **Receive launch via URL** — `initiative-dm.html?stage=<encounterId>`:
  1. If combat is active, modal-confirm: "Combat in progress. Stage
     this encounter and discard the current roster?" Cancel → no
     state change.
  2. Fetch the encounter (DM-auth GET).
  3. Instantiate combatants using the existing picker's
     code path (HP/init roll-vs-override, hidden, etc.).
  4. Apply `tactical.surprise` and `picks[].startingConditions` to the
     instantiated combatants.
  5. Stamp `encounterId` + `encounterStagedAt` on local state (flows
     into the next `initiative_state` POST automatically).
  6. Show `tactical.readAloud` as a dismissible banner above the
     tracker if non-empty. Reuses the existing recovery-banner CSS
     slot.
  7. Strip `?stage=` via `history.replaceState` so refresh doesn't
     re-stage.
  8. POST status update to `encounters`: `status: 'live'`,
     `lastStagedAt: <now>`. Fire-and-forget; doesn't block the stage.
- **Wave reminders** — `tactical.waves` does not auto-spawn. When the
  round counter approaches a wave's round, a banner appears: "Wave
  incoming next round: 3 cultists from south door." DM clicks "Add
  wave" to instantiate. Explicit, not magical.
- **Completion loop** — existing `exportToChronicle()` extension:
  - If `encounterId` is set on the live state, pre-fill the export
    modal: title = encounter name, target session =
    `encounter.sessionId`, target location resolved from
    `encounter.locationRef`,
    loot = `encounter.loot[]` merged with combat-acquired loot,
    participating NPCs = `encounter.npcRoles[].npcId`.
  - On successful timeline write, POST encounter update:
    `status: 'completed'`, `resolvedAt: <now>`, `resolvedInTimelineId:
    <new entry id>`, `lastOutcome` (from the export modal's outcome
    dropdown).
  - Canceled export → encounter remains `live`.
  - Combat ended without export (existing `combat_drafts` flow) →
    draft carries `encounterId` forward; later resume closes the
    loop normally.

#### Atlas Workshop — `map-dm.html`

Location detail editor (right pane) gains an "Encounters here"
subsection below the existing fields:

- Lazy-fetches `encounters` on first location open.
- Filters in-memory by matching the structured `locationRef`:
  world-level pin matches `{kind:'world', locationId:<this.id>}`;
  sub-map pin matches `{kind:'submap', parentLocationId:<parent.id>,
  locationId:<this.id>}`.
- Row shape: name, status pill, monster count, link to
  `encounter-dm.html?id=<id>`.
- "+ New encounter at this location" button → opens builder with
  `?newAt=<kind>:<parent?>:<id>` so the location ref is pre-bound.
- Same panel added to the sub-map location editor.

#### Chronicle Workshop — `sessions-dm.html`

Symmetric to Atlas. Session entry editor gains "Encounters planned":

- Filter encounters by `sessionId === <this entry.id>`.
- Same row shape.
- "+ Add encounter to this session" → builder with `?newFor=<sessionId>`.
- A "ready / drafted" tally in the session list view ("3 encounters:
  2 ready, 1 draft") so prep readiness is visible at a glance.

#### Crucible — `crucible-dm.html`

Receive-only:

- Accept `?from-encounter=<id>`. On load, fetch encounter and port
  `picks` into the Crucible's encounter pane via the existing
  add-monster code path.
- Echo a chip at the top of Pane B: "Testing: *<encounter name>*"
  with a link back to the builder.
- No reverse flow.

#### Home — `home.html`

New card in the Keeper's Wing: "The Encounter Builder," icon, link to
`encounter-dm.html`. Ordering: after **The Crucible**, before **War
Table** — reads as "design → test → run."

### Launch flow — happy path

1. **Build.** DM creates encounter in `encounter-dm.html`. Status
   `draft`. Autosave on field changes.
2. **Mark ready.** DM flips status → `ready` (or `scheduled` if bound
   to a session).
3. **Stress-test** *(optional)*. DM clicks **⚗ Send to Crucible** →
   Crucible opens with picks pre-loaded → DM runs trials → closes
   Crucible.
4. **Stage.** DM clicks **▶ Run on War Table** during session.
   Navigation: `initiative-dm.html?stage=enc_<id>`. War Table fetches,
   instantiates, applies surprise/hidden/conditions, banners
   read-aloud, stamps `encounterId`, strips URL param.
5. **Encounter status → `live`** (builder POSTs the status update on
   stage).
6. **Run combat.** Normal War Table flow. Wave banners surface near
   their round; DM clicks "Add wave" to instantiate.
7. **End combat → export.** Export modal opens pre-filled from the
   encounter. DM tweaks if needed, clicks Export.
8. **Resolve.** On successful timeline write, War Table POSTs
   encounter update: `status: 'completed'`, `resolvedAt`,
   `resolvedInTimelineId`, `lastOutcome`. Builder library row shows
   completed pill and "Last run" line.

### Edge cases

| Case | Behavior |
|---|---|
| Concurrent edits across two DM tabs on the array | Re-fetch-and-splice on save mitigates most races; documented as a known last-write-wins limitation. |
| Staging while combat is active | Modal-confirm naming the encounter + current combatant count. Cancel preserves state. |
| Linked `locationRef` / `sessionId` / `npcId` deleted from source tool | Builder shows "(deleted)" stubs with unlink button. Stage still works. Export pre-fill silently drops broken refs. |
| DM stages, then edits combatants manually, then exports | Export uses encounter's loot/linkages as pre-fill base; combat-acquired items merge on top. Resolution fires regardless of roster drift. |
| Resume from `combat_drafts` | Draft carries `encounterId`. Recovery → Export → completion loop fires normally. |
| Stage twice (Run, then re-Run for reset) | Idempotent. Each stage re-stamps `encounterStagedAt`. Status stays `live`. |
| Network failure on the resolve POST | Timeline export already succeeded. Yellow toast: "Encounter status didn't update — refresh the builder and mark complete manually." Doesn't block the DM. |
| Encounter deleted while staged in tracker | Tracker keeps running. `encounterId` becomes dangling. Export falls back to manual flow with "(encounter no longer exists)" note. |

### Error handling

Vocabulary already used elsewhere in the codebase:

- **Validation failure on save** — red field-error inline; save disabled
  until resolved. Matches Atlas Workshop pattern.
- **Worker 401 (DM auth lost)** — global session-expired redirect to
  `home.html?notice=...` via `auth.js`.
- **Worker 5xx / network down** — yellow banner: "Could not save —
  retrying in 10s." Local state preserved. Uses existing fetch-with-
  backoff pattern from `pollPlayerNotes`.
- **Worker not redeployed** — front-end detects 400s on POST → flips
  to read-only banner: "Worker needs redeploy for the new builder."

## Testing

### Automated — `tests/encounter-schema.test.html`

Pure-data tests, no DOM, no network. Vanilla HTML page with inline
assert harness (matches existing project pattern).

- Migration v1 → v2 across cases: empty record, picks-only,
  fully-populated v1, malformed (orphan ids, missing fields)
- `pickKey` generation: ordered, unique, idempotent on re-migration
- `pickKey` uniqueness validator (front-end mirror of worker rule)
- Wave reference resolution: `waves[].pickKey` → picks entry; orphan
  returns null
- Enum validation for `status`, `lighting`, `surprise`,
  `npcRoles[].role`
- Status transitions: allowed (`draft → ready → scheduled → live →
  completed`, `* → archived`) and disallowed (`completed → live`
  without explicit reopen)
- CR-budget reuse: existing FM math imported and re-asserted on
  canonical encounters to catch regressions

### Manual UI checklist (post-deploy)

- [ ] Open builder, create new encounter, fill all sections, save.
      Reload — survives.
- [ ] Save with an invalid status (via DevTools) — worker rejects 400.
- [ ] Open an existing pre-PR v1 encounter — loads, migrates on first
      edit.
- [ ] Run on War Table from a clean tracker → roster populated,
      surprise applied, read-aloud banner visible.
- [ ] Run on War Table with active combat → confirm modal blocks;
      cancel preserves state; confirm clobbers cleanly.
- [ ] Stage → end combat → export → timeline entry has correct
      title / location / session / NPCs / loot pre-filled. Encounter
      status → completed.
- [ ] Send to Crucible → picks pre-populated, "Testing: <name>" chip
      visible.
- [ ] Atlas Workshop location editor shows "Encounters here" for both
      world-level and sub-map `locationRef` matches.
- [ ] Chronicle Workshop session editor shows "Encounters planned"
      tally.
- [ ] Delete a linked location → builder shows "(deleted)" stub;
      stage still works; export skips broken ref.
- [ ] Two-tab edit on the same array → second save lands without
      clobbering the first (re-fetch-and-splice).
- [ ] Mobile (≤1100px) → right pane collapses to bottom bar; left
      becomes drawer; Run button reachable.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Last-write-wins on `encounters` array under concurrent edits | Low | Re-fetch-and-splice on every save. Documented limitation. |
| Worker not redeployed before front-end ships → validation rejects → broken UI | Medium | CHANGELOG flags redeploy in bold. Front-end degrades to read-only banner on detected 400s. |
| Wave reminders confusing or annoying mid-session | Low | Dismissible banner; one-click add. Easy to remove without schema change if it doesn't land. |
| "Run on War Table" feels too aggressive — accidental combat-clobber | Medium | Confirm modal explicitly names encounter + current combatant count. |
| Crucible chip / link-back stale after edit | Low | Crucible re-fetches encounter on load. Chip shows live name. Acceptable. |
| Future v3 has to handle v1 + v2 + v3 records | Low | Migration helper composes — v1→v2 then v2→v3. Standard ladder. |

## Out of scope (explicit non-features)

Captured to prevent scope drift mid-implementation:

- Auto-wave spawning
- Crucible → "Save as encounter" reverse flow
- NPC `history[]` auto-append on resolution
- Player-visible foreshadowing / rumor fields
- Encounter templates / inheritance
- Bulk operations (multi-select archive/delete)
- Mobile-first authoring polish beyond the responsive collapse

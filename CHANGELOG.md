# Changelog

All notable changes to the DND web tools (maps, initiative tracker, home).

Format roughly follows [Keep a Changelog](https://keepachangelog.com/).
Dates are YYYY-MM-DD.

---

## [Unreleased] — 2026-06-16

### Crucible PC features v1.1 — DSL editor + action granting + target state

Polish + extension pass on the v1 PC class features framework. Five gaps
closed:

- **`addAction` and `addBonusAction` primitives** — DSL can now express
  Flurry-of-Blows / extra-attack abilities. The `actionsAvailable` counter
  on PC combatants can be incremented, not just decremented.
- **Per-monster `hasAttacked` tracking** — the engine sets a flag on
  monsters when they attempt an attack. Three new mode predicates
  (`whenTargetHasntAttacked`, `whenTargetIsBloodied`, `whenTargetIsHostile`)
  let DSL effects react to per-target state.
- **`compileDSL` extension** — `when` predicates now receive the full
  `hookCtx` (so target-aware predicates can read the current target).
  Backward-compatible: existing predicates ignore the new arg.
- **Schema-driven DSL editor** — every primitive declares its `paramSchema`
  (param name, type, default, options). The DSL effect-row editor renders
  the right inputs for the selected primitive automatically. Picking
  `addDamageDice` now shows dice + damage-type fields; picking
  `addResistance` shows a multi-select; etc. **Critical UX bug fixed**:
  before this change, picking a parameterized primitive in the editor
  produced silent no-op effects because the params weren't enterable.
- **Built-in feature param editor** — each built-in feature also declares
  `paramSchema`. An `[edit params]` button on the feature row opens an
  inline editor. Hunter's Mark can be set to 1d8, Rage's bonus damage can
  be overridden, Bardic Inspiration's die size can be picked, etc. Divine
  Smite's per-level slot table is too complex for the v1.1 editor;
  deferred.
- **Edit-after-save for DSL features** — custom features now have an
  `[edit]` button that re-opens the modal pre-filled from the stored
  `_dslSpec`. Saved-feature iteration no longer requires deleting and
  re-authoring.
- **Per-effect `when:` dropdown** — DSL effect rows now expose the
  per-effect condition predicate. The seven target-aware and self-aware
  predicates (`whenTargetHasntAttacked`, `whenTargetIsBloodied`,
  `whenTargetIsHostile`, `whenHpBelowHalf`, `whenHpBelowQuarter`,
  `whenAnyEnemyAlive`, plus the implicit "always") are selectable inline.
  Target-conditional effects ("damage vs enemies who haven't attacked yet")
  can finally be authored from the UI; the engine already supported `when`,
  the editor was the missing piece.
- **Feature Impact attribution** — features that modify damage (Rage,
  Sneak Attack, Hex/Hunter's Mark, Divine Smite, DSL `addDamage`,
  `addDamageDice`, `addResistance`) now show actual damage dealt /
  prevented in the results panel. Previously the columns existed in the
  schema but the aggregator never incremented them — every feature read
  "—" regardless of how much damage it pushed. Fix is two-pronged:
  `dispatchHook` snapshots `dmgCtx.amount` per feature and emits an
  attribution event for flat changes (Rage +2, Rage resistance);
  the engine's bonus-die roll loop emits one event per rolled die using
  the feature's source tag (Sneak, Smite, Hex, DSL dice). DSL features
  pick up their custom name via `hookCtx.featureName` injected by
  `compileDSL`. The aggregator now reads structured `amount`/`isDamage`/
  `isPrevented`/`hpRestored` fields directly (with a regex fallback for
  events that pre-date the structured fields).
- **v1 regression fix**: `resolveAttackPc` and `resolveSave` referenced a
  bare `combatants` that wasn't in their scope (declared inside `runTrial`,
  but these functions live at module level). Under `'use strict'` that
  threw `ReferenceError: combatants is not defined` whenever a PC attacked
  or made a save with PCFeatures loaded. Latent in tests because the
  engine test suite doesn't load `pc-features.js`. `combatants` is now an
  optional final parameter, threaded through from `runTrial`.
- **DSL param inputs were silently broken since v1.1 Phase 4** —
  `dslRenderParamInput` built inline handlers with
  `dslEffects[i].params[${JSON.stringify(field.name)}] = ...`, which
  emits double quotes (`params["type"]`) inside attributes already
  wrapped in double quotes. The browser parsed the rendered
  `oninput="dslEffects[0].params["` as a truncated attribute and
  treated the rest as garbage HTML — so the onchange / oninput never
  fired and every user edit to a param input (value, dice, type, name,
  duration, …) was silently dropped. Initial values still rendered
  correctly via `<option ... selected>`, which is why the UI looked
  like it persisted: the first dropdown selection appeared to "stick"
  because it was the pre-render default. Switching to dot notation
  (`dslEffects[i].params.${field.name}`) fixes every input at once;
  paramSchema field names are validated as identifiers with a hard
  guard before rendering.
- **Uses per encounter now actually limits firings** — `compileDSL`'s
  gate ignored `state.usesLeft`. Specs declared `usesPerEncounter` and
  the state was initialized correctly, but nothing read or decremented
  it. A "Uses per encounter: 2" feature fired every round of combat.
  The gate now auto-checks `state.usesLeft > 0` when the spec sets
  `usesPerEncounter`, and auto-decrements after the feature fires. Both
  events emit a trace ("use spent (1/2 remaining)", "gated — out of
  uses (2/2 spent)") so it's visible in the trial log.
- **`addDamage` primitive now actually deals damage and accepts a type** —
  pre-fix, `addDamage` mutated `dmgCtx.amount += value`. The engine then
  applied `r.damageByType` and `bonusDice` separately, never reading
  `amount` modifications. So flat additions (and Rage's +2) were
  cosmetic-only: visible in the Feature Impact totals but never applied
  to target HP. Plus `addDamage` had no damage-type input, so users
  asking for "+5 fire" couldn't get a fire-typed contribution.
  `addDamage` now pushes a pre-rolled bonus die tagged with the picked
  type; the engine's bonus-die loop already calls `applyDamage` so the
  damage actually lands. Rage's `onAttackHit` got the same treatment so
  the +2 lands instead of being a phantom buff.
- **`onTakeDamage` reductions now actually reduce damage** — Rage
  resistance and `addResistance` halved `dmgCtx.amount`, but the engine
  then applied untouched `r.damageByType` so the reduction was lost.
  Engine now scales every base-damage and bonus-die contribution by
  `(post-takeDamage amount / pre-takeDamage amount)` before applying
  through `applyDamage`. Half-damage resistance now actually halves
  incoming damage to PC HP.
- **DSL features silently no-op-ing — the *real* bug** — `compileDSL`'s
  gate read the round only from `hookCtx.ctx`, which is `undefined` for
  any hook whose args don't contain a `combatants`-bearing object
  (onAttackHit, onTakeDamage, onAttackAttempt, onSaveAttempt — i.e. nearly
  every interesting hook). Round defaulted to 0, default `triggerRound`
  is 1, so the gate evaluated `0 < 1` → return. Every custom feature on
  those hooks silently no-op'd regardless of mode or condition. Now round
  is pulled from any of `ctx` / `dmgCtx` / `rollCtx`, and the same for
  `combatants` (so predicates like `whenAnyEnemyAlive` actually work on
  damage hooks). Engine attaches `combatants` to every dmgCtx /
  rollCtx / saveRollCtx; `resolveAttackMonster` got the same combatants
  parameter treatment as `resolveAttackPc`.
- **Gate-trace events** — when the activation gate blocks a custom
  feature (either `triggerRound` not yet reached or `conditionFn` returns
  false), the trial log now gets an explanatory event:
  "`<Feature>: gated — round 1 < triggerRound 3`" or "`<Feature>: gated —
  condition whenAnyEnemyAlive = false`". Solves the "why isn't my
  feature firing" debugging problem the previous patches couldn't.
- **DSL modal legend clarification** — the fieldset above trigger-round
  used to say "Mode policy — Sustained", which read as "this feature
  is locked to sustained mode." Renamed to "Activation gate (applies to
  all PC modes)" with a one-line explanation underneath: the PC's
  Nova / Sustained / Defensive mode is on the PC card; custom features
  use the same gate values for every mode (there's no per-mode override
  in the v1 UI).
- **Trial-log visibility for all primitives + silent built-in paths** —
  custom features authoring previously failed silently for primitives
  that don't touch damage. Now every state-mutating primitive emits a
  descriptive feature event when it actually does something:
  `addAcBonus`, `addAction`, `addBonusAction`, `flag`, `applyCondition`,
  and `heal`. Built-in silent paths got the same treatment: Shield logs
  "blocked the hit (consumed lvl-N slot)" on a successful block, and
  Bardic Inspiration logs "+X (avg dY) to <ally>'s save/attack" when an
  inspiration die is spent. Two new helpers (`eventLogFrom`,
  `emitTrace`) hide the eventLog discovery so primitives don't have to
  thread it themselves. `rollCtx` now also carries `round` so Shield /
  Bardic events get the right round number.

**Migration:** None. All changes are purely additive.

**Known limitation (carried from v1):** the 14 schema-test failures from
v1 remain. They're test-invocation patterns (free-method calls without
`this` binding); production dispatch via `dispatchHook` is unaffected. A
follow-up cleanup PR will refactor those tests.

**Manual UI checklist:**
- [ ] Author a custom DSL feature with `addDamageDice` — dice + type fields
      appear, save, run sim, Feature Impact shows non-zero damage.
- [ ] Open a Barbarian's Rage in the param editor — change bonusDamage from
      2 to 4, save, run sim — Rage Impact reflects the larger bonus.
- [ ] Open a Ranger's Hunter's Mark — change damageDice from `1d6` to
      `1d8`, run sim, Feature Impact shows higher damage.
- [ ] Click `edit` on a saved custom feature — modal opens pre-filled,
      change a value, save — verify the change persisted.
- [ ] Add a feature using `addAction` with amount=2 — run sim — PC gets
      extra actions.

### Crucible — PC class features simulation

The Crucible can now model 8 SRD class features (Rage, Sneak Attack, Action
Surge, Divine Smite, Healing Word, Shield, Hex/Hunter's Mark, Bardic
Inspiration) plus DM-authored homebrew features via a small DSL.

- **New file `pc-features.js`** — shared module owning the 9-hook surface,
  mode predicates, 8 built-in feature objects, 11 DSL primitives, and the
  `dispatchHook` / `dispatchBroadcastHook` runners.
- **Engine integration:** `crucible-engine.js` calls `dispatchHook` at 9
  points (combat start, turn start, attack attempt/hit, take damage, save
  attempt, ally/monster downed, round end). New per-combatant action-economy
  fields: `actionsAvailable`, `bonusActionAvailable`,
  `reactionAvailableThisRound`.
- **PC editor:** Each PC card gains a Features section with library picker
  and Custom-feature DSL modal. New mode picker (Nova / Sustained /
  Defensive) in the tactics row.
- **Results panel:** New Feature Impact table showing per-feature
  activations and average impact per fight. Trial logs prefix feature events
  with `⚡` and offer a filter toggle.
- **Mode preset** drives active-resource features (Rage, Action Surge,
  Smite, Healing Word, Shield, Hex/Mark, Bardic Insp.). Passive features
  (Sneak Attack rider) ignore mode and fire under their built-in rules.
- **Custom features (DSL):** DM authors via a constrained form (no `eval`).
  Features and templates persist to `localStorage`.
- **Migration:** existing PCs auto-upgrade in memory on load
  (`tactics.resources → tactics.mode`, `features:[]` added). First save
  persists. No worker / KV changes.

**Known limitations (v1):**
- Rage's Nova and Sustained modes behave identically because the sim
  doesn't track resources across an adventuring day. Documented in spec.
- 14 schema tests for direct hook invocation patterns fail in isolation
  because they don't bind `this` — production calls via `dispatchHook` work
  correctly. Tests will be updated in a polish pass.

**Manual UI checklist (post-deploy):**

- [ ] Open Crucible → existing PCs load with `tactics.mode: 'sustained'`
- [ ] Add Rage to a Barbarian via Add from library → params auto-derived
- [ ] Run 500 trials → Rage shows in Feature Impact with non-zero numbers
- [ ] Author a custom DSL feature → saves to PC + template → reusable
- [ ] Trial logs show `⚡` glyph next to feature events; filter toggle hides them
- [ ] Open the schema test page (`tests/pc-features.test.html`) → at least 58 of 72 assertions pass (14 known direct-invocation tests fail)

### Atlas Workshop v2 — DM map redesign

The DM map page (`map-dm.html`) was a 3700-line single file with a
fixed 2-pane grid, modal-stacked editing, and a topbar packed with mode
toggles. After four UX cleanup rounds patched the worst of it, the
underlying shell was still the dominant pain point.

`map-dm-v2.html` is a parallel rebuild that keeps the data layer
untouched and rewrites the shell:

- **Full-bleed map canvas** with chrome floating above (top action
  cluster, left list panel, right inspector panel, bottom status strip).
- **Click selects, drag moves** for pins. The legacy Move-mode toggle is
  gone; cursor is always `grab` over a pin, drag threshold 4 px
  (10 px on touch).
- **Right-click context menu** on the map (Add location / Add zone) and
  on pins (Edit / Duplicate / Toggle visibility / Delete).
- **Scoped wheel zoom**: wheel only zooms when the cursor is over the
  map, never when over a panel or top cluster. Fixes the "scrolling
  zooms the map even when I'm in the sidebar" complaint.
- **Debounced auto-save** to `map_data_dm` (~600 ms) with a top-cluster
  sync indicator (live → pending → saving → synced → fail). Publish
  remains an explicit button that pushes the player-safe blob.
- **Inline editors** — Location, Zone, NPC, Character, Timeline. The
  modal-inside-modal pattern is gone; selecting an item opens the editor
  in the right panel.
- **Drag-resize + collapse-to-handle** for both panels; sizes persisted
  in localStorage.
- **Persistent sub-map breadcrumb** at the top of the canvas.
- **`home.html` DM card** now links at `map-dm-v2.html`. `map-dm.html`
  stays in the repo as a fallback for one release before being deleted
  + renamed.

Deferred to future passes: undo/redo, multi-select pins, command palette
(Cmd+K), touch-tuned editor surfaces.

### Maps — UX cleanup pass (round 4)

- **DM map: styled confirm dialog for destructive operations.** Replaced
  9 native `confirm()` popups with an async `confirmDialog()` modal that
  matches the page theme. Red action button, default focus on Cancel
  (safer), Esc cancels, Enter confirms, click-outside cancels. Affected
  flows: delete location / zone / character / NPC / whisper / NPC history
  entry / timeline entry, detach combat from timeline, reset sub-map.
  `resetSubMap`, `deleteLocation`, `deleteZone`, `removeTLCombat` became
  `async`; the other five callers were already async.

  Skipped from the audit ladder: in-app keyboard-shortcut overlay
  (only ~3 shortcuts exist; not worth a help modal), "frame all pins"
  fit button (the existing reset suffices), and the touch pin-preview
  feature (out of scope for cleanup — and `pin-info-panel` is now
  hidden on touch as of round 3).

### Maps — UX cleanup pass (round 3)

- **DM map: renamed topbar buttons for clarity.** "⤢ Pop out editor" →
  "⛶ Expand editor"; "Preview ↗" → "Preview as player ↗" (and added a
  tooltip explaining it opens a new tab).
- **Player map: distinguished the NPC roster from Whispers visually.** The
  two slide-in panels were near-identical (gold border, same width). The
  NPC roster now uses a teal left-border + cyan title color, and both
  panels gained glyphs (✉ for Whispers, 👤 for NPCs) — also added to the
  topbar pill buttons that open them.
- **Player map: pin info panel hidden on small screens / touch.** Avoids
  overlap with the legend + zoom buttons at narrow widths, and avoids the
  dead-weight overlay on touch devices (hover preview never triggers
  there anyway).
- **DM map: X/Y position inputs moved into an "Advanced — pin position"
  `<details>` disclosure.** Declutters the location modal; X/Y is rarely
  needed thanks to ✥ Move mode and "📍 Click to place".

### Maps — UX cleanup pass (round 2)

- **DM map: sync-status dot.** Pre-colored 8px dot before the status text
  (green/red/amber/dim), with a soft pulse animation in the "ing" (in-flight)
  state. Glanceable status — text becomes optional detail.
- **DM map: prominent mode banner with Esc hint.** Restyled `.map-hint` from
  faint subtitle to a gold-tinted banner. Each mode message now includes an
  "Esc to exit" hint, and the keydown handler exits Move/Place/Polygon modes
  on Esc.
- **DM map: connected-locations as chip picker.** The "comma-separated IDs"
  text field on the location modal is now a chip selector mirroring
  `visibleTo`. New `tempConnected` state, `renderConnectedChips`,
  `toggleConnected`. Eliminates a typo-prone raw-ID input.
- **DM map: replaced 15 `alert()` validation popups with a styled toast.**
  Non-blocking 2.8s banner at the bottom of the screen. Destructive
  `confirm()` dialogs left untouched (9 of them) — those will get a styled
  replacement in a later pass.

### Maps — UX cleanup pass (round 1)

Top three items from the map UI/UX audit. Visual / structural cleanup only;
no behavior changes beyond filtering.

- **DM map: removed duplicate topbar tab buttons.** The six tab buttons in
  the topbar duplicated the editor-pane tabs and competed with the action
  buttons (Publish, Import, etc.) for space. Topbar now keeps only the mode
  toggles + action buttons; tab switching uses the editor pane's own tab row.
  `map-dm.html` lines ~563-568.
- **Player map: re-ordered the topbar.** Home + breadcrumb on the left
  (convention), title in the middle, player badge + Whispers/NPCs/Logout
  on the right. The breadcrumb was previously at the far right and got
  ignored. `map.html` lines ~257-275.
- **DM map: search box on Locations + Zones panes.** Matches the existing
  NPC and Timeline panes. Filters by name / id / type / shortDesc (locations)
  or name / id / shape (zones). `map-dm.html` `renderLocList`,
  `renderZoneList`.

## [Unreleased] — 2026-06-12

### The Anvil — encounter builder

A standalone DM tool for authoring, browsing, and launching encounters.
The Anvil replaces the ad-hoc "saved encounters" list that previously lived
inside the War Table's bestiary modal with a full-featured, lifecycle-aware
encounter management system.

**New files:**
- `encounter-schema.js` — shared encounter schema module (`EncounterSchema`):
  `newEncounter()`, `migrateInMemory()`, `validate()`, and the v1→v2
  migration path.
- `encounter-dm.html` — The Anvil page (DM-only). Three-pane layout:
  library sidebar, editor centre, launchpad right-pane.
- `tests/encounter-schema.test.html` — inline vanilla-JS test harness;
  26 assertions covering schema defaults, field validation, v1→v2 migration,
  and edge cases. Open in browser and click "Run tests."

**Phase breakdown:**

_Phase 1 — Shared module + tests._ `encounter-schema.js` defines the v2
schema: `id`, `schemaVersion`, `name`, `status` (draft / ready / running /
completed / archived), `picks` (monster refs with count + customisations),
`setup` (tactical notes, surprise flag, read-aloud text), `playbook`
(DM-facing notes), `loot` (pre-staged items), `locationRef`, `sessionId`,
`npcIds`, `createdAt`, `updatedAt`. `newEncounter()` stamps a UUID and both
timestamps. `migrateInMemory()` is idempotent — calling it on a v2 record is
a no-op; calling it on a v1 record fills missing fields and sets
`schemaVersion: 2`. `validate()` returns an array of human-readable errors.

_Phase 2 — Worker validation._ `cloudflare-worker.js` gains an `encounters`
KV key, a `GET type=encounters` branch (DM-gated), and `encounters` in
`DM_WRITE_TYPES` (POST also DM-gated). The POST handler runs
`EncounterSchema.validate()` server-side and rejects malformed payloads with
a 400. **Manual redeploy required** — paste `cloudflare-worker.js` into the
Cloudflare dashboard (Workers & Pages → `dnd-perk-webhook` → Edit code →
Save and deploy). Until redeployed, the front-end falls back to
`localStorage` for encounter persistence.

_Phase 3 — The Anvil page._ `encounter-dm.html` is the DM's authoring UI.
Left pane (library): searchable/filtered list of encounters with status
pills, `+ New encounter` button. Centre pane (editor): tabbed sections for
Monsters (picker reusing the merged bestiary), Setup (tactical notes,
surprise checkbox, read-aloud text), Playbook (DM-facing freeform), Loot
(pre-staged items), and Linkages (location pin, session, NPCs). Right pane
(launchpad): summary card, status progression controls, Run on War Table
button, Send to Crucible button, and Duplicate / Archive / Delete actions.
URL params `?id=`, `?newAt=`, `?newFor=` allow deep-linking from other tools.

_Phase 4 — War Table integration._ `initiative-dm.html` gains a "Run
encounter" flow: the existing "Run on War Table" button in The Anvil's
launchpad POSTs the encounter id into `localStorage['pending-encounter-id']`.
On load, the War Table checks for a pending id; if combat is inactive it
auto-loads the encounter (populates roster from picks, applies the surprise
flag, shows the read-aloud banner); if combat is active, a confirm modal
lets the DM cancel or overwrite. The old in-modal "Saved encounters" UI in
the bestiary panel is removed — The Anvil is the canonical encounter
management surface. At end-of-combat export to Chronicle, if the active
encounter has a `locationRef` / `sessionId` / `npcIds`, those are
pre-filled in the export form; after a successful export the encounter's
status flips to `completed`.

_Phase 5 — Cross-tool surfaces._
- **Atlas Workshop** (`map-dm.html`): the location editor gains an
  "Encounters here" read-only panel listing any encounter whose
  `locationRef` matches the location being edited (world or sub-map).
  Clicking an encounter name opens The Anvil at that encounter via
  `?id=` param.
- **Chronicle Workshop** (`map-dm.html` Timeline tab): the session editor
  gains an "Encounters planned" tally showing how many encounters reference
  this session's id, with a link to create a new one.
- **Crucible** (`crucible-dm.html`): the "Send to Crucible" launchpad
  action pre-populates the Crucible's monster picker with the encounter's
  picks and sets a "Testing: \<name\>" chip in the Crucible header.

**Migration strategy.** Existing encounters (if any were saved under the
old ad-hoc schema) are auto-upgraded in memory by `migrateInMemory()` on
every page load. The migration is in-memory only until the DM next saves the
record (any edit triggers a save). For bulk upgrade without editing each
record individually, a **"Persist v2 migration (N records)"** button appears
in the library whenever v1 records are detected on load — clicking it calls
`saveEncounters()` once and dismisses the button.

**Side effects on existing tools:**
- War Table (`initiative-dm.html`): the in-modal "Saved encounters" panel
  is removed. DMs who bookmarked that workflow should use The Anvil instead.
- Atlas Workshop (`map-dm.html`): location editor and Timeline tab each
  gain a new read-only panel; no existing functionality changed.
- Chronicle page (`timeline.html`): unaffected (read-only, no encounter
  data surfaced to players).
- Crucible (`crucible-dm.html`): gains "Testing: \<name\>" chip and
  pre-populated picker flow from launchpad; existing party/encounter state
  is preserved.
- Home page (`home.html`): "The Anvil" card appears in the Keeper's Wing;
  existing card ordering may shift.

**UX polish pass (post-Phase 3D).** Three user-reported blocking bugs fixed in `encounter-dm.html`: (1) Topbar was empty — the existing `#topbar` div is now populated with a "← The Spire" home link, "The Anvil" page title, a DM role chip, the signed-in username, and a Sign out button. (2) Cursor was lost every ~600ms while typing and expanded `<details>` sections collapsed at the same cadence — root cause was `saveEncounters()` success path calling `render()`, which `outerHTML`-swapped the focused input; fixed by removing `render()` from that path (all mutation paths already update the UI surgically). `renderLaunchpad()` is now also called from `updateField` when the path is `'status'` so the launchpad's status pill stays in sync without a full re-render. (3) Structural mutations (`addWave`, `addLoot`, `addNpcRole`, `setLocationRef`) invoke `renderEditor()` which `outerHTML`-swaps the 5 non-Combatants sections; any `<details>` the DM had opened would silently collapse — fixed by capturing `open` state before the swaps and restoring it after.

**Manual UI checklist (post-deploy):**
- [ ] Sign in as DM → home shows "The Anvil" card in Keeper's Wing.
- [ ] Open The Anvil → existing saved encounters appear in the library with
      auto-set status `ready`.
- [ ] Create new encounter, fill all sections, reload — survives.
- [ ] Run on War Table from a clean tracker → roster populated, surprise
      applied, read-aloud banner visible.
- [ ] Run on War Table with active combat → confirm modal blocks; cancel
      preserves; confirm clobbers.
- [ ] Stage → end combat → export → timeline entry has title / location /
      session / NPCs / loot pre-filled; Anvil row flips to `completed`.
- [ ] Send to Crucible → picks pre-populated, "Testing: \<name\>" chip visible.
- [ ] Atlas Workshop location editor shows "Encounters here" for both world
      and sub-map matches.
- [ ] Chronicle Workshop session editor shows "Encounters planned" tally.
- [ ] Delete a linked location → builder shows "(deleted)" stub; stage still
      works; export skips broken ref.
- [ ] Two-tab edit on the same array → second save lands without clobbering
      (re-fetch-and-splice).
- [ ] Mobile (≤1100px) → launchpad collapses to sticky bottom; left pane
      becomes drawer; Run button reachable.
- [ ] Run the schema test page (`tests/encounter-schema.test.html`) — 26
      assertions pass.

### Initiative DM: persistent combat drafts (recovery for forgotten exports)

- **Worker:** new DM-only KV type `combat_drafts` — added a GET branch
  (DM auth required, returns the array, `[]` default) and included
  `combat_drafts` in `DM_WRITE_TYPES` so POSTs are DM-gated.
  **Worker must be redeployed** (paste `cloudflare-worker.js` into the
  Cloudflare dashboard) for drafts to persist; until then the front-end
  degrades gracefully (POST/GET 401 silently, no errors surfaced).
- **Initiative DM:** combat data is now auto-saved to KV on every
  existing `pushState` debounce while a combat is active. `endCombat()`
  flips the draft to `pending-export` and persists immediately;
  `exportToChronicle()` removes the draft from KV after a successful
  Chronicle write.
- **Recovery banner** above the lobby banner lists any un-exported
  drafts on page load with per-row `Export` and `Discard` buttons.
  Exporting from the banner re-opens the existing export modal
  pre-bound to the recovered draft (the live combat's `combatLog` is
  stashed and restored on modal close so the live combat is not
  polluted). Banner hides during active combat and re-renders on
  return to lobby.
- In-progress drafts older than 24h auto-promote to `pending-export`
  on page load so a crashed-mid-combat orphan eventually surfaces in
  the banner instead of sitting invisible.
- Player views (`initiative-player.html`, `map.html` anonymous) are
  unaffected — drafts are DM-only end to end, with no field added to
  the `initiative_state` payload.

### Initiative tracker: player notes & defense-in-depth filter

- **Player notes on combatants.** Players can attach short combat-scoped notes to
  any combatant in `initiative-player.html` — themselves, party members, enemies.
  Notes are private (author only) or party-visible (all logged-in players + DM).
  The DM sees everything read-only in the expanded combatant card on
  `initiative-dm.html`. Notes die with the encounter (live entirely inside
  `initiative_state`).
- **Defense-in-depth filter on the player GET path.** The DM tracker already
  strips `notes` (DM-only string) and `hidden` combatants client-side before POSTing
  to the worker, so KV's `initiative_state` value has never actually contained them
  in practice. The new worker-side filter (`filterInitiativeState`) enforces the
  same rules server-side regardless of what lands in KV — so a future bug or
  malicious DM client can't accidentally leak the fields.
- **Worker change requires manual redeploy.** New endpoints
  `initiative_note` + `initiative_note_delete`; filter pass on GET
  `initiative_state`; notes-preservation merge step on the existing DM
  `initiative_state` POST handler (prevents DM HP/condition writes from
  clobbering player notes).
### Crucible: PC editor no longer drops the cursor on every keystroke

- The four action-edit handlers (`updateAction`, `updateActionDamage`,
  `updateActionSave`, `updateActionHeal`) used to call `renderParty()`
  on every `oninput` event, which did `root.innerHTML = ...` and
  destroyed the `<input>` the DM was typing in — losing focus and
  cursor position with each character.
- Replaced the keystroke-level full re-render with surgical updates:
  - PC card summary line and action row summary line both get stable
    ids (`pc-summary-<pmId>`, `act-summary-<aId>`).
  - New `refreshPCSummary` / `refreshActionSummary` helpers update
    those spans' `textContent` in place. Inputs are never recreated.
  - `refreshGate()` and `renderFmBudget()` still fire on PC field
    edits so the run gate and FM-budget pill stay current.
- Structural changes (collapse/expand, add/remove PC, add/remove
  action, change action type, cycle position override, import from
  War Table) still call `renderParty()` — they need a real DOM
  rebuild because the visible field set changes.

### Bestiary: override records overlay imported monsters at load (no more duplicate Goblins)

- New `bestiary-merge.js` shared module exporting
  `BestiaryMerge.mergeBestiaries(imported, custom)`. Override records
  (written by Crucible's `saveOverride`, identifiable by an
  `overriddenAt` stamp) now overlay their imported base by
  name+source. Homebrew records (no `overriddenAt`) pass through as
  before. Orphan overrides (no matching imported base) appear with a
  `_orphanOverride` flag so the DM can clean them up.
- The Crucible's `loadBestiary`, the War Table's `loadBestiary`, and
  the Menagerie's `allMonsters()` now all route through the same
  helper. Saved fixes propagate across tools — the DM sees one
  Owlbear with their override applied, not two.
- Worker is untouched. KV schema unchanged. Backward-compatible with
  every existing override record (no migration needed).
- 14 new test assertions in `tests/bestiary-merge.test.html` covering
  empty inputs, imported-only / homebrew-only / override-match
  paths, orphan handling, partial overrides, null-protection,
  cross-source distinctness, and a mixed-everything record-count
  scenario.

**Manual UI checklist (post-deploy):**
- [ ] Crucible: save a role override on an imported monster (set
      Owlbear to Brute). Refresh. Picker shows **one** Owlbear with
      `(currently: override)` in the Review panel — not two.
- [ ] War Table: open the bestiary picker. The same Owlbear appears
      exactly once with the override applied.
- [ ] Menagerie: browse the bestiary. The same Owlbear appears once
      with overrides visible. Edit it via the editor; the
      write-back-to-`bestiary` path still works.
- [ ] Orphan check: manually add an override record to
      `bestiary_custom` for a name that doesn't exist in `bestiary`.
      It appears in the Crucible picker with an orphan indicator.
- [ ] Backward compatibility: existing pre-merge `bestiary_custom`
      records (saved before this change) work without manual
      intervention — they have `overriddenAt`, name, _source, so they
      merge correctly.

### The Crucible — monster role policies (v1.5)

- Replaced the single "focus-fire lowest-HP" monster heuristic with a
  role-policy registry. Each monster resolves to one of nine FM roles
  (Soldier / Brute / Artillery / Ambusher / Controller / Leader /
  Skirmisher / Solo / Minion) and uses role-specific target-picking
  and action-picking rules. Soldier is the default; v1 behavior is
  preserved end-to-end.
- Role resolution priority: explicit DM override → FM `fmRole` tag →
  inferred from stat patterns (heal action → Leader, all-ranged →
  Artillery, control-save condition → Controller, high-HP + multiattack
  → Brute, 1/Day finisher + small kit → Ambusher, else Soldier).
- PC quick-form gains an `actionRange` dropdown per action
  (`melee` / `ranged` / `both`). The rangedness score derived from
  the action mix maps to a position bucket (`frontline` / `midline` /
  `backline`) which appears as a clickable pill on the PC card.
  Clicking cycles an override: `derived → frontline → midline →
  backline → derived (cleared)`.
- Monster override panel adds a Role dropdown; the choice persists in
  `bestiary_custom` alongside `parsedActions` and `regeneration`.
- Engine helpers exposed: `actionEv`, `rangedness`, `position`,
  `bucket`, `inferRole`, `resolveRole`, plus the `ROLE_POLICIES`
  registry. ~50 new test assertions including 4 integration scenarios
  (Brute prefers frontline, Artillery prefers backline, role override
  flips behavior, v1 backward compat).
- Worker untouched. No KV schema changes. New PC fields
  (`actionRange`, `positionOverride`) live in the existing
  `localStorage['crucible-party']` payload; new monster field
  (`roleOverride`) is an additional field on `bestiary_custom`
  records — backward-compatible if absent.

**Manual UI checklist (post-deploy):**
- [ ] Add a PC with one melee + one ranged action → position pill reads
      `midline`.
- [ ] Click the pill four times → cycles `midline → frontline →
      midline → backline → midline (cleared)`; persists across reload.
- [ ] Pick a Bugbear → encounter pill shows the role (FM-tagged in
      gold, inferred in slate, override in teal); modal Role dropdown
      shows `(currently: <source>)`.
- [ ] Change the role to Artillery; save; hard-refresh; the role
      persists in `bestiary_custom`.
- [ ] Run 500 trials, Bugbear-as-Brute vs. a frontline+backline mixed
      party → per-PC outcomes show frontline PC absorbing more attacks
      than backline.
- [ ] Run any v1-era encounter (Soldier-default monster) → behavior
      and verdict band are indistinguishable from pre-upgrade.

### The Crucible — UI + integration

- New page `crucible-dm.html` (DM-only): three-pane layout for party,
  encounter, and simulation results. Uses theme.css tokens (Cinzel /
  Crimson Text, slate/teal). Mobile-friendly stack layout.
- Party quick-form (Pane A): identity, ability scores, save profs,
  HP/AC/init, and an action editor that supports `attack`, `save`,
  and `heal` actions. PartyMember model is a strict subset of an
  eventual full character sheet — only inputs are stored, all combat
  numbers derive at use. Persists to `localStorage['crucible-party']`.
  "Import from War Table" pulls names/HP/AC from `localStorage.init_pcs`.
- Encounter picker (Pane B): reuses the merged bestiary (MM 2024 + FM +
  bestiary_custom). Each picked monster is parsed via
  `parseAllMonsterActions` and exposes a "Review parsed actions" panel
  that lets the DM correct the parser's output and save back to
  `bestiary_custom`. FM CR-budget footer reports intended difficulty.
- Run controls + Results (Pane C): trial selector (100/500/2000),
  progress bar + live win-rate during run, post-run verdict band
  (EASY / STANDARD / HARD / DEADLY / TPK-LIKELY) with FM comparison,
  per-PC outcomes table (down rate, ≥½-HP-loss rate, avg HP, avg
  fell-at round, avg healed), distribution histograms (PCs downed
  and rounds-to-resolution as SVG bars, no chart library), action-
  effectiveness table, and Low / Median / High representative-trial
  replay logs.
- Reproducibility: each run's seed is shown, click to copy.
  `?seed=N` URL param replays a specific run.
- "Copy report" (markdown) pastes the headline + per-PC + top actions
  into Discord / notes.
- New "The Crucible" tool card in `home.html`'s Keeper's Wing.

**Manual UI checklist (post-deploy):**
- [ ] Sign in as DM; reach `crucible-dm.html` via the home card.
- [ ] Add a PC (no defaults edited) → save works → reload preserves.
- [ ] Add a Goblin via picker → parsed actions list shows `attack`.
- [ ] Run 500 trials → verdict, per-PC, distribution, action,
      replay sections all render.
- [ ] Override panel: edit Goblin's Scimitar toHit → save → reload →
      override persists.
- [ ] `?seed=12345` reruns produce identical headline numbers.
- [ ] Mobile (≤1100px): panes stack; forms collapse comfortably.

### The Crucible — round-loop sim engine

- `crucible-engine.js` now ships a full Monte-Carlo round-loop simulator:
  `buildCombatants` (with FM solo extra-turn slot), `turnStart`
  (condition tick + recharge + regen tick with damage-type suppression),
  target selection and heal triage, action resolution for attack / save /
  heal / multiattack (including FM minion rule and crit dice doubling),
  and `runSim` aggregator with `requestAnimationFrame`-chunked trials,
  three percentile-picked representative event logs, and per-PC /
  per-action aggregation.
- `tests/engine.test.html` covers 39 assertions including the five
  spec scenarios (duel reproducibility, standard band, outnumbered band,
  healer-helps, troll-fire flips).

### The Crucible — combat-sim parser + engine helpers

- New `crucible-engine.js` with seeded Mulberry32 RNG, dice roller
  (with crit doubling of dice but not modifier), and derived-stat helpers
  (`mod`, `pb`, `saveBonus`, `toHit`, `saveDc`, `pcDamageMod`).
- New `crucible-parser.js` with five passes (multiattack / attack / save /
  heal / unparsed-fallback), a recharge + uses-per-day extractor that runs
  alongside, a `parseRegeneration` helper for trait bodies, and a memoized
  `parseAllMonsterActions` wrapper that respects pre-existing overrides.
- New `tests/parser.test.html` and `tests/engine.test.html` — vanilla
  HTML pages with inline assert harnesses. 30 parser fixtures + 13 engine
  helper assertions, all green. Tests run manually by opening the file
  and clicking "Run tests."

### Atlas Workshop: side-panel editing for NPCs, Players, Timeline

Follow-up to the pop-out editor. The previous pop-out widened
the column but the edit FORM still appeared *below* the list —
meaning with 50 NPCs you scrolled past all of them to reach the
form. User: "It should open to the side."

It does now.

How it works:
- Clicking an NPC / Player / Timeline card (or **+ Add**) now:
  1. **Auto-enters pop-out mode** if it isn't already (no need
     to click "Pop out" first — the wider canvas is implicit
     in the edit intent).
  2. The detail form **pulls out to a fixed-position side
     panel** on the right side of the drawer (500–550px wide).
  3. The list stays on the left, scrollable, with the selected
     card highlighted.
- The detail panel gets an injected **✕ Close** button at the
  top — clicking it cancels the edit and dismisses the panel.
- Sidebar mode (without pop-out) still has the inline-below
  behavior — nothing changes there.

Implementation: CSS-only layout switch via `:has()` — the panel
selectors match `#npc-detail`, `#char-detail`, `#tl-detail` when
their inline style does NOT contain `none` (i.e., they're
visible). When that's true, `position: fixed` pulls them out
and `padding-right` on the pane reserves space.

JS minimal additions:
- `ensureEditorExpanded()` — auto-toggles pop-out on edit.
- `ensureDetailCloseBtn()` — injects a close button into each
  detail panel on first open. Idempotent.
- Hooked into `addCharacter`, `editCharacter`, `addNPCEntity`,
  `editNPCEntity`, `addTimelineEntry`, `editTimelineEntry`.

No data flows changed. No existing JS logic touched. Cancel /
Save / Delete buttons continue to work as before.

Narrow viewports (<1200px): the detail panel widens to
`min(550px, 90vw)` and no longer reserves space — it overlays
the list instead. Mobile-friendly.

### Atlas Workshop: pop-out editor for comfortable editing

The 320px right sidebar editor was getting cramped — long
descriptions, dmNotes textareas, visibleTo chip grids, and the
NPC / Timeline / Player forms all had to fight for vertical and
horizontal room. Forms cut off, scrolling within scrolling.

Added a **pop-out editor mode**: the right column slides out to
900px wide and overlays the map (which gets dimmed behind a
backdrop-blurred scrim). The same editor, same forms, same JS —
just dramatically more room to work in.

How it works:
- Click **⤢ Pop out editor** in the topbar (or press Enter on it).
- The editor column animates from sidebar (320px) → overlay
  drawer (900px) sliding in from the right.
- Map area gets a translucent scrim with `backdrop-filter:
  blur(4px)` so the workspace stays visible but defocused.
- Form fields breathe: padding, font size, and textarea heights
  scale up automatically. Tabs sit more comfortably. Chip grids
  get more horizontal room.
- Toggle button flips to **✕ Collapse editor** with a brass
  background to signal active state.

Three close paths:
- Click the toggle button again.
- Click the scrim outside the drawer.
- Press **Esc** (the existing Esc handler is now priority-aware
  — modals close first, then the pop-out editor, then the
  sub-map drill-down).

Why this approach (and not a full modal): keeping the editor in
its existing DOM means no form-state churn, no breakage of any
of the dozen-or-so editor flows (locations, sub-maps, zones,
characters/journals, NPCs, timeline, world). CSS-only width
expansion + a class toggle.

No JS data flows changed. No HTML structure moved. Only CSS
adds (~50 lines) + 2 new event handlers + 1 button + 1 scrim
div.

### The Ledger: parchment → dark theme conversion

User asked for the parchment look to be retired. The Ledger
(`index.html`) is now in the same dark slate + brass + teal
palette as the rest of the site.

What changed:
- Local palette swapped: parchment cream → slate dark; ink
  dark-brown → ink light-grey; amber → brass; etc.
- `.scroll` container now a dark panel (panel surface, slate
  border, multi-layer brass-rim shadow) — was a literal
  parchment slab.
- Hero: `h1` uppercase, fluid type via `clamp()`, brass shadow.
- Class-group labels (MARTIAL / HYBRID / CASTER): pill chips
  with kind-specific borders. Martial = salmon-red; Hybrid =
  brass; Caster = purple — all picked to read against the dark
  surface without looking neon.
- Tier badges (T1/T2/T3): pill shape with semantic colors
  (green / purple / amber) re-mixed for dark backgrounds.
- Perk cards: dark panel surface, hover lift + shadow,
  selected state shows tier-colored outer ring.
- Form inputs: 3px brass focus rings everywhere, italic
  placeholders.
- Tracker: dark panel surface, brass count number, brass-glowing
  pips on fill.
- Send button: brass gradient with multi-layer shadow that
  glows on hover.
- Feedback states (sending / success / error): tier-tinted dark
  backgrounds replacing the parchment-pastel versions.
- Now links `theme.css` and aliases shared tokens to the local
  palette (the page joins the design system properly — the
  previous "intentional opt-out" comment is removed).

Per the previous audit pass, `<main id="main">` is preserved.
JS untouched.

### Mobile + a11y audit pass

Audited every page at 375px width and ran an accessibility sweep
for screen-reader and keyboard-nav gaps. Targeted fixes only —
no visual regressions.

**Mobile fix:**
- `initiative-player.html`: header didn't wrap on phones — the
  title clipped behind the ROUND pill and HOME link wrapped to
  two lines. Added `flex-wrap: wrap` + tighter type at ≤480px
  so the title/round/home now stack cleanly on narrow screens.

**Accessibility fixes:**
- **`<main>` landmarks** added to the 8 pages that were missing
  them — every page now has exactly one `<main>` (or
  `role="main"` on a layout-locked container like
  `.map-container`). Screen readers can now skip directly to
  the primary content from the page's landmark menu.
- **`aria-label`s** on every icon-only button I found:
  - Map zoom controls (`+`, `−`, `⌂`) on `map.html` and
    `map-dm.html` — were `title="…"` only; now both.
  - All 5 modal close (`✕`) buttons on `map-dm.html` and
    `initiative-dm.html`.

**Verified at scale:**
- All 11 pages have a `<main>` landmark (or `role="main"`).
- Visual screenshots at 375×812 confirm home, timeline, the
  Round, and the player pages render cleanly without overflow.
- Desktop layouts unchanged.

### Player pages: foundation + visual refresh

Brings the four player-facing pages in line with the design
system landed across the rest of the site. JS/HTML untouched
except for the inline accessibility patch on the Ledger.

#### Three dark-themed pages (map.html, brew.html,
####                          initiative-player.html)

Each now links `theme.css` + includes an aliasing block mapping
shared theme tokens (`--c-bg`, `--c-brass`, `--c-ink`, …) to
the page's existing local palette via fallback chains. Gains
focus rings, themed scrollbars, prefers-reduced-motion respect,
and component-class availability — same wins as the DM tools'
foundation pass.

On top of foundation, each gets a visual refresh:

- **map.html (The Atlas)**: topbar height 48px → 52px, brighter
  gold uppercase title with subtle shadow, breadcrumb with
  letter-spacing + uppercase; buttons modernized with easing,
  uppercase + letter-spacing, tactile `:active`.

- **brew.html (The Cauldron)**: fluid type for the hero (`clamp`),
  refined PLAYER/DM role chips (pill shape), home link with
  subtle background fill in normal state; mode tabs gain modern
  hover state + active outer ring; search input gets a 3px teal
  focus ring + italic placeholder; ingredient list rows hover
  slides 2px right.

- **initiative-player.html (The Round)**: fluid type for the
  header, brighter gold + uppercase + text-shadow; round badge
  becomes a pill shape; active banner gains a multi-layer glow;
  combatant rows gain richer transitions, active card translates
  2px right with multi-layer glow ring (mirrors War Table).

#### Light-themed page (index.html — The Ledger)

The Ledger's parchment palette is intentionally separate from
the dark design system. Rather than force theme.css adoption
(which would conflict with the in-character "ledger" feel), it
gets a small inline accessibility patch:
- `:focus-visible` ring in amber (palette-appropriate)
- `prefers-reduced-motion` respect

If a future theming layer adds light/dark/parchment variants,
the Ledger can adopt the system properly. For now it stays
visually distinct.

### Apothecary: deeper visual refresh

Final DM tool refresh in this pass. CSS-only on top of the
foundation pass — JS/HTML untouched.

What's improved:
- **Topbar**: fluid type for the hero (`clamp(1.2rem, 1rem + 1vw,
  1.55rem)`), subtle brass glow on the title, refined DM chip
  (pill shape, brighter brass).
- **Tabs**: active tab gets a subtle brass background tint plus
  the underline; hover separates from unvisited.
- **Form inputs** (`input,select,textarea`): 3px teal focus ring
  via `box-shadow`, italic 0.6-opacity placeholders, 3px radius.
- **List rows**: hover slides the row 2px right; active row gets
  a teal left border + tinted background.
- **Rarity chips** (common/uncommon/rare): pill shape, bolder
  weight, tier-tinted backgrounds.
- **Affinity chips** (fire/cold/lightning/nature/radiant/…):
  pill shape, slightly larger, subtle background fill.
- **Buttons** (`.btn`, `.btn.brass`, `.btn.ghost`, `.btn.danger`,
  `.btn.sm`): modern easing, colored glow on hover,
  `translateY(1px)` on `:active`. Primary button flips to
  brand-color background on hover for stronger contrast.
- **Quantity stepper** (`.qstep`): larger touch target (28×28),
  hover state with teal color shift, tactile press.
- **Analysis cards**: 6px radius, multi-layer shadow with hover
  elevation, brighter teal stat values with subtle glow,
  uppercase brass labels.
- **Analysis section headers**: brighter brass + uppercase +
  trailing border (consistent with the rest of the system).
- **Column heads** (`.col-head`): brighter brass + uppercase +
  trailing border.
- **Home link**: subtle background fill in normal state to
  separate from ghost buttons.
- **Toast**: refined entrance animation (translateY + opacity),
  multi-layer teal/rust glow shadow based on type.

No regressions to ingredients / potions / negatives / library /
inventory / recipes / analysis / import flows.

### Menagerie: deeper visual refresh

CSS-only refresh on top of the foundation pass. JS/HTML untouched.

What's improved:
- **Topbar**: fluid type for the hero (`clamp(1.2rem, 1rem + 1vw,
  1.55rem)`), subtle brass glow on the title, refined DM chip
  (pill shape, brighter brass).
- **Tabs**: active tab gets a subtle brass background tint **in
  addition** to the underline (matches Chronicle Workshop); hover
  state separates from unvisited.
- **Form inputs** (`input,select,textarea`): 3px teal focus ring
  via `box-shadow`, italic 0.6-opacity placeholders, slightly
  larger radius (3px).
- **List rows**: hover slides the row 2px right; active row gets
  a teal left border + tinted background.
- **CR chips**: pill shape, bolder weight, semi-transparent
  background by tier (mid/high/epic).
- **Buttons** (`.btn`, `.btn.brass`, `.btn.ghost`, `.btn.sm`):
  modern easing, colored glow on hover, `translateY(1px)` on
  `:active` for tactile feedback. Primary button now flips to
  the brand-color background on hover for stronger contrast.
- **Stat block**: 6px radius, multi-layer shadow with subtle
  brass rim, brighter title with text-shadow.
- **Editor chips**: pill shape, active state gets an outer ring
  in addition to the brass background.
- **Column heads** (`.col-head`): brighter brass + uppercase +
  trailing border (consistent with the rest of the design system).
- **Home link**: subtle background fill in normal state to
  separate from ghost buttons.
- **Toast**: refined entrance animation (translateY + opacity),
  multi-layer teal/rust glow shadow based on type.

No regressions to browse logic, filters, the editor form, the
generator, or library/import flows.

### War Table: deeper visual refresh

Same CSS-only pattern as the Atlas Workshop refresh. JS and HTML
untouched; visual polish on top of the foundation pass.

What's improved:
- **Topbar**: brighter gold title (uppercase, semibold), subtle
  drop-shadow + faint gold rim, taller padding.
- **Mode pill**: uppercase, larger padding, combat mode gets a
  red glow + softer pulse (`opacity: 1 ↔ 0.65`).
- **Round display**: uppercase label + larger semibold gold
  number for the round counter.
- **All buttons** (`.btn-gold`, `.btn-red`, `.btn-green`,
  `.btn-teal`, `.btn-purple`, `.btn-ghost`): modern easing,
  colored glow on hover, `translateY(1px)` on `:active`,
  consistent uppercase + letter-spacing.
- **Combatant cards**: smoother transitions, PC/enemy left
  border brightens on hover, active card translates 2px right
  + multi-layer glow + outer ring.
- **Form fields** (`.exp-input`, `.loot-row input`,
  `.modal-field`, `.bestiary-filters`): 3px brass focus ring
  (`box-shadow`), italic placeholders at 0.6 opacity.
- **Sidebar titles**: uppercase + brighter gold + bottom border
  separator (matches Chronicle/Sessions design).
- **Modals**: stronger backdrop-blur, fade-in + rise-in entrance
  animations, multi-layer gold-glow shadow, refined close
  button hover state.

No regressions to combatant logic, drag-and-drop, HP adjustments,
bestiary picker, or the chronicle-export flow.

### Atlas Workshop: deeper visual refresh

Follow-up to the foundation pass — `map-dm.html` gets a meaningful
visual lift on top of the shared theme.css baseline. JS / HTML
structure untouched; CSS-only refresh keeps all functionality stable.

What's improved:
- **Topbar**: 48px → 52px to match the other workshops; brighter
  gold title; subtle drop-shadow under the bar; refined
  breadcrumb with vertical-gradient background.
- **Buttons**: all `.btn-*` variants modernized — larger padding,
  better letter-spacing, modern easing on hover, colored glow
  on `:hover` for primary actions (gold/green/red/purple),
  `translateY(1px)` on `:active` for tactile feedback.
- **Editor tabs**: active tab gets a subtle gold tint background
  + the existing underline; hover state nudges background to
  separate visited/unvisited.
- **Form fields**: 3px brass focus ring (`box-shadow: 0 0 0 3px
  rgba(184,134,11,0.16)`) — matches the rest of the design
  system; placeholders styled with `opacity: 0.6` + italic.
- **Section headers**: brighter gold + uppercase + bottom border
  separator (consistent with timeline.html / sessions-dm.html).
- **Cards**: `.loc-list-item`, `.char-card`, `.item-card` —
  added hover state with subtle background lift + slight
  `translateX(1px)` for the location list; selected state shows
  a thin gold outer glow.
- **DM Token modal**: backdrop-blur upped, fade-in + rise-in
  entrance animation matching the rest of the modals;
  border-radius bumped to 6px; multi-layer shadow with gold
  glow accent.
- **Character code pill**: brighter gold + soft glow on hover.

Visual regressions: none. The aliasing block from the foundation
pass means any theme.css component classes (if used) would
inherit the local gold-deep palette — but this commit doesn't
adopt any new theme components yet; that's a future pass.

### UI foundation pass: Atlas Workshop, War Table, Apothecary, Menagerie

Path A baseline rolled out to the four remaining DM tools without
the full per-tool visual rewrites (which would risk destabilising
~10,000 lines of complex JS in one commit). Each tool now links
`theme.css` and includes a small CSS aliasing block that maps the
shared theme token names (`--c-bg`, `--c-brass`, `--c-ink`, etc.)
to that page's existing local tokens.

Practical effect:
- **Focus rings**: tab through any DM tool and you get a consistent
  teal `:focus-visible` ring (was missing or browser-default).
- **Themed scrollbars**: thin, dark, matching the rest of the
  site (was browser-default chunky bars).
- **`prefers-reduced-motion`**: respected — animations disable
  for users who opt out at the OS level (was ignored).
- **Color-scheme: dark** + base reset consistency across all
  tools (no FOUC quirks).
- **Component-class availability**: any future use of `.btn`,
  `.btn--brass`, `.chip`, `.field`, `.modal-overlay`, etc. will
  render with each tool's existing palette automatically — no
  per-tool color tweak needed when adopting components.

What did NOT change (intentionally):
- Each tool's existing color palette (Atlas + War Table stay on
  the deep-gold scheme; Apothecary + Menagerie stay on the
  slate+teal+brass scheme). No visual regressions to muscle
  memory.
- All existing JS behavior, layouts, and feature sets.
- Local component classes (e.g. each tool's `.btn-gold`,
  `.btn-red`, etc.) — left untouched and will be migrated to
  the shared kit in future per-tool passes.

This unblocks future per-tool visual refreshes: they become
incremental CSS migrations rather than ground-up rewrites.

### Chronicle Workshop: multi-kind editor + UI refresh (Path A, page 3)

Third page of the Path A rollout. `sessions-dm.html` (renamed in
the UI to "Chronicle Workshop") now uses the shared `theme.css`
tokens and components, **and** gains the ability to create + edit
every timeline kind — not just sessions.

#### Multi-kind support

- New `KIND` select at the top of the editor with options:
  Session, Event, Milestone, Planned (DM-only).
- New kind filter in the list toolbar — narrow the list to one
  kind, or browse all.
- List cards show a small color-coded kind chip beside the title
  (blue session / orange event / teal milestone / brass planned)
  and a matching left-border accent.
- "+ NEW ENTRY" button creates a session by default, but if you
  have the list filtered to (say) "Planned", the new entry adopts
  that kind so you don't have to switch in the editor.
- Default prep sections only seed for `session` / `planned` kinds
  (which are essentially "real session" and "future session");
  `event` and `milestone` entries start with no prep, just title
  / dates / body.
- Frontmatter `type:` is now driven by the entry's kind (was
  hardcoded `type: session`). Vault round-trip works for all
  four kinds.
- Import respects frontmatter `type:` and routes the entry to
  the right kind automatically.
- Sidebar "At a Glance" adds a Kind row and renames
  "Sessions total" → "Entries total".

#### UI refresh

- Links to `theme.css`; page-specific CSS shrinks ~30% and uses
  shared tokens for all colors / spacing / type / radius /
  shadow / motion.
- Local `.chip` (toggleable selector chips) renamed to
  `.pick-chip` to avoid collision with theme.css's `.chip`. The
  page now uses theme tokens consistently — brass focus rings,
  fluid type, focus-ring boxes on input focus.
- Buttons converted to `.btn` + `.btn--brass` / `.btn--ghost` /
  `.btn--danger` / `.btn--sm` modifiers.
- Modal styling refreshed — uses theme shadow + brass border +
  fade/rise entrance animations.
- Topbar title changed: "THE SESSIONS" → "CHRONICLE WORKSHOP".
- Editor empty state copy updated to reflect multi-kind scope.

#### Hub card

`home.html` card updated:
- Title: "The Sessions" → "Chronicle Workshop"
- Description: "Plan sessions, events, milestones, and planned
  threads. Round-trip with your vault."

#### Internal renames (no behavior change)

- `sessionsAll()` → `entriesAll()` (no kind filter)
- New helper `emitEntryMarkdown()` (was `emitSessionMarkdown`)
- New helper `parseEntryMarkdown()` (was `parseSessionMarkdown`)
- Function names bound to onclick handlers (`newSession`,
  `selectSession`, `saveSession`, `deleteSession`) kept for
  stability; their internal logic now handles any kind.

### UI refresh: Chronicle (timeline.html) — Path A, page 2

Second page of the Path A rollout. `timeline.html` (the player-
facing Chronicle) now uses the shared `theme.css` tokens and
components. Functional behavior — collapse on click, tags, both
dates, expand-all toggle, planned divider for DMs — is preserved.

Visible upgrades:
- Hero strip with a tagline ("A Record of the Realm") and a
  role-aware subtitle (DMs get "Every thread, every page.";
  players get "What has happened — and what your character
  has seen of it.").
- Search input gets a leading magnifying-glass icon (inline
  SVG mask, no extra requests).
- Filter bar gains a live results count: `12 of 47` while
  filtering, `47 entries` when unfiltered.
- Identity line uses the unified `.chip` system from theme.css
  (same look as the role pill on `home.html`).
- Entries stagger in on render (35ms per card, capped by the
  natural number of visible entries).
- Expanded entries get a deeper border-color tint matched to
  their kind (session blue, event orange, milestone teal,
  planned brass) and a slightly elevated shadow.
- Combat panels and loot tables refreshed with theme tokens —
  cleaner row dividers, consistent label typography.
- DM Notes block now leads with a 🔒 lock-glyph label.

Accessibility:
- `<main>` landmark with `aria-labelledby`.
- `aria-expanded` on each entry header (toggles with the
  collapse state).
- `aria-controls` ties the header to its body div.
- `<time datetime>` for ISO real-world dates.
- `aria-live="polite"` on the results count and loading state.
- Visible focus ring (from theme.css :focus-visible) on every
  interactive element.

Layout:
- Max-width nudged from 780px → 820px for slightly easier reads
  on wider screens.
- Narrow-screen (≤560px) polish: titles shrink, dates wrap
  below the title, results count wraps cleanly.

State icons (empty + no-results) added to the state block —
small line-art glyphs for visual feedback when there's nothing
to show.

### UI refresh: shared theme.css + home.html exemplar

First step of a UI/UX modernization pass. Goal: bring the tools
in line with current web design standards without giving up the
no-build-step, vanilla-JS architecture.

New shared file `theme.css` introduces:
- Design tokens (`--c-…` colors, `--text-…` fluid type via
  `clamp()`, `--space-…` spacing scale, `--radius-…`,
  `--shadow-…`, `--motion-…` durations + easings).
- Reusable components: `.btn` (with `--primary`, `--ghost`,
  `--danger`, `--brass`, `--sm`, `--lg`, `--block` modifiers),
  `.card` + `.card--interactive` + `.card--dm`, `.chip` (role
  variants), `.field` (form input wrapper with focus ring),
  `.modal` + `.modal-overlay`, `.tab` + `.tab-list`, `.banner`
  (info/warn/error), `.section-heading`, utilities (`.sr-only`,
  `.stack`, `.cluster`, `.divider-h`).
- Base reset, focus-visible rings, themed scrollbars,
  `prefers-reduced-motion` handling, `color-scheme: dark`.

`home.html` is refreshed end-to-end as the exemplar:
- Links to `theme.css`, page-specific CSS shrinks ~60%.
- Richer card design: SVG icons sit in a contained tile with
  hover lift + multi-layer shadow + colored glow (teal for
  player tools, brass for DM tools).
- Fluid typography — campaign title scales from 2.2rem on phones
  to 3.6rem on desktop via `clamp()`.
- Entrance animations: hub fades up on load, cards stagger in
  at 50ms intervals.
- Accessibility: `<main>` landmark, `role="dialog"` +
  `aria-modal` + `aria-labelledby` on the login modal,
  `aria-selected` on tabs, focus is restored to the trigger
  when the modal closes, focus rings on every interactive
  element, visible `:focus-visible` ring.
- Anonymous CTA gets explicit Player / DM sign-in buttons
  instead of a single generic "Sign in".
- Notice banner uses the new `.banner--warn` style.

This is path A of two paths discussed with the user (CSS-led
refresh vs framework rewrite). Path A keeps the static-HTML +
GitHub-Pages deploy unchanged. Future pages can `<link
rel="stylesheet" href="theme.css">` and adopt the components
incrementally; no other page needs to change until it's
refreshed.

### Sessions: prep section cards can be minimized

Prep section cards in `sessions-dm.html` were each pretty tall —
once a session had 6+ sections of even modest length, scrolling
past sections you weren't currently editing got annoying. Each
card now has a chevron (▾ / ▸) at the start of its heading bar
that minimizes the card to just the heading line, hiding the
body textarea. Click the chevron again to expand.

A pair of **MIN ALL** / **EXPAND ALL** buttons in the PREP
section header bulk-toggles every card. Useful when you want to
collapse everything and then expand just the one section you're
editing.

Minimize state is transient (lives in `work.prepCollapsed`, a Set
of section uids) — it resets when you pick a different session
or reload. Toggling a single card is a direct DOM `classList`
flip rather than a re-render, so any in-progress typing in
other sections' textareas is preserved.

### Sessions: prep is now structured section cards

The Prep field used to be a single ~340px monospace textarea full
of raw Markdown — fine for round-trip with the vault but painful
to edit in the browser. It's been replaced with a stack of
labeled section cards, one per `##` heading.

Each card has:
- An editable heading (gold, Cinzel) at the top.
- A textarea body sized to the content (auto-grows up to 14 rows).
- ▲ / ▼ / ✕ controls to reorder and delete sections.

Below the stack: a "+ Add" input with a datalist of the user's
template section names (Housekeeping, Recap, Strong start, Scenes,
NPCs, Locations, Secrets and Clues, Loot, Open Threads). Typing a
custom heading and pressing Enter creates a fresh section. New
sessions seed those nine default sections (empty bodies) so the
shape matches the vault template from the start.

Under the hood, `prep` is still stored as a single Markdown string
for byte-clean vault round-trip. The editor parses it into
`prepSections: [{heading, body}]` on load and serialises back to
`## Heading\n\nbody` markdown on save. Headings with no body still
emit (so empty placeholders survive); body without heading emits
as preamble. Import/export, the player-facing Chronicle, and the
existing map-dm Timeline tab are all unaffected.

### Chronicle: collapsible entries, both dates, tag chips

The player-facing Chronicle (`timeline.html`) was rendering every
entry fully expanded — sessions with long recaps made it hard to
scan the campaign at a glance. Entries now collapse by default to
**title + kind chip + tags + both dates (in-game and real-world)**;
clicking the entry header (or pressing Enter / Space on it)
expands it to reveal the recap, combats, loot, DM notes, and
linked location/character/NPC chips.

The filter bar gets an **Expand all** / **Collapse all** toggle
that operates on the currently-filtered entries. Per-entry
expand state lives in a Set, so search/sort/filter changes
preserve which entries you've opened.

Tags (a new field surfaced by the Sessions tool) render as small
brass `#tag` chips below the title, visible in both collapsed
and expanded states. Real-world dates render as a smaller
dim chip beside the in-game date for at-a-glance temporal
context.

### Sessions: inline NPC creation + prep-scan helper

The Sessions tool can now create NPCs without leaving the editor.
Two entry points sit next to the LINKED NPCs chip grid:

- **+ ADD NPC** opens a quick-add modal (Name, Role, Status,
  Location, Activity, Public Description, DM Notes). Saves to
  the global `npcs` KV roster and auto-links the new NPC to the
  current session. Location dropdown defaults to the session's
  first linked location.
- **↑ SCAN PREP** finds NPC candidates referenced in the prep
  block — every `[[Wikilink]]` plus bare list items under
  `## NPCs` — then filters out anything that already matches a
  location, a character, or an existing NPC. Shows the remainder
  as a checklist with optional inline role fields. One click
  creates all checked NPCs (status: alive, location: session's
  first location) and links them to the session.

Both paths POST to the existing `npcs` KV key — no worker
changes. The created NPCs are first-class records visible in
the Atlas Workshop NPCs tab for fuller editing later (history,
known-to-which-characters, public notes).

### Sessions: standalone DM tool with vault round-trip

Adds `sessions-dm.html`, a full-screen DM workspace for managing
sessions — replacing the cramped Timeline tab inside the Atlas
Workshop for session-kind entries. Other timeline kinds (events,
milestones, planned) still live in the map-dm Timeline tab; the
two tools share the same `timeline` KV key.

#### Why

Editing a session inside the 320px-wide Timeline pane on map-dm.html
was painful — long bodies and prep notes were unreadable, and there
was no way to bring vault prep into the tool. Most prep happens in
an Obsidian vault outside the browser, so the tool now imports and
exports `.md` files matching the existing Session template.

#### Layout

Three panes:
- **Left**: session list + search + year filter, with a List ↔
  Timeline view toggle. Timeline view groups cards under sticky
  month/year headers with a vertical rail.
- **Middle**: full-screen editor — title, dates, tags, Summary
  (player-facing), Prep (raw Markdown, DM-only), attendance,
  linked locations & NPCs, structured loot, attached combats,
  visibility, DM log.
- **Right**: at-a-glance sidebar with attendance badges, counts,
  and import/export buttons.

#### Vault import/export

- Drag-drop `.md` files (or paste Markdown). Frontmatter `id:`
  controls update-vs-create; matching by title is the fallback.
- `## Summary` → `body` (player-facing chronicle).
- `## Log` → `dmNotes`.
- Everything between (Housekeeping / Recap / Strong start / Scenes
  / NPCs / Locations / Secrets and Clues / Loot / …) is preserved
  verbatim as raw Markdown in a new `prep` field, including its
  section headings.
- `[[Wikilink]]` characters and locations are name-matched to the
  campaign roster; unmatched names are reported on import so the
  DM can fix them.
- Frontmatter extras (any keys we don't consume) round-trip as-is.
- Export: per-session "Download .md" button + bulk "Download all"
  (sequential downloads). Drop the files into your `Sessions/`
  folder.

#### Schema additions (backward-compat)

New optional fields on session-kind timeline entries — all pass
through the existing worker untouched:
- `prep: string` — raw Markdown prep block.
- `attendance: [characterId]` — who actually showed up.
- `tags: [string]` — vault tags.
- `frontmatterExtras: object` — unknown vault frontmatter keys for
  faithful round-trip.

Existing entries without these fields keep working in the map-dm
Timeline tab.

#### Hub

Adds a "The Sessions" card to the Keeper's Wing on `home.html`,
sitting between Atlas Workshop and War Table.

#### No worker changes

The Cloudflare Worker is untouched — the new fields ride on the
existing `timeline` POST/GET. No redeploy required.

---

## [Unreleased] — 2026-05-29

### Menagerie + War Table: Solo / Minion category chips + filter

Now that the FM scrape correctly captures `isMinion` / `isSolo` /
`fmCategory`, surface those tags in the UI so DMs can scan-and-find
at a glance — and filter the bestiary down to "show me only the
minions I have at CR 1/2 and below."

#### Menagerie (`bestiary-dm.html`)

- **Browse row** now shows a small category chip beside the role
  chip: Minion (slate blue), Solo (rust), Companion (sage green),
  Retainer (brass), Villain (purple). Standard / Custom monsters
  get no chip (the Custom chip already labels customs).
- **Browse toolbar** gains a **Category** filter dropdown: All /
  Standard / Minion / Solo / Companion / Retainer / Villain Party.
- New `categoryOf(m)` resolver and `categoryChipHTML(m)` helper that
  honors the explicit `isMinion`/`isSolo` flags first, then
  `fmCategory`, then `_custom`, then defaults to 'standard'.
- `clearFilters()` resets the new category dropdown.

#### War Table (`initiative-dm.html`)

- **Bestiary picker row** and **cart pick row** get the same chip
  next to the source chip — `.bestiary-cat-chip` with parallel
  per-category color variants.
- **Combatant card** also gets the chip: when a monster is added
  from the picker, `c.bestiaryCategory` is stamped alongside
  `c.bestiarySource`, and the card's name line renders the chip
  inline. So in live initiative you can tell at a glance that the
  three identical-name combatants are actually one Minion + two
  Standards.
- New `bestiaryCategoryChipHTML(m)` helper in the picker code.

#### Visual layout

| Chip class | Where it shows | Example |
|---|---|---|
| `cat-chip.minion` | Menagerie list row | slate-blue MINION |
| `cat-chip.solo` | Menagerie list row | rust SOLO |
| `bestiary-cat-chip.minion` | War Table picker / cart / card | slate-blue MINION |
| `fm-badge.minion` | Menagerie stat-block header | larger pill (already there) |

The big-pill `.fm-badge` on the stat-block header was added earlier;
this commit adds the smaller list-and-card variants so you don't
have to click into the detail to spot a minion.

---

### FM scrape: minion / solo capture fix (45 minions, 17 solos recovered)

The initial FM scrape captured zero `isMinion:true` and zero
`isSolo:true` monsters because the CR-line parser assumed every line
followed the `CR <X> <Role>` template with an optional Minion/Solo
suffix. The actual DDB DOM uses three variants:

```
CR 1/4 Skirmisher        ← standard (role token first)
CR 1/4 Minion            ← minion (no role token, just Minion)
CR 20 Solo               ← solo (no role token, just Solo)
```

The `(\w+)` capture group ate "Minion" / "Solo" as the role, which
then failed the `FM_ROLES.includes(r)` check — leaving both `fmRole`
and `isMinion`/`isSolo` empty.

#### Fix

Replaces the suffix-only regex with a tokenizing pass over the
post-CR portion of the line. Each token is checked independently
against three buckets:

- `'Minion'` → `isMinion = true`, `fmCategory = 'minion'`
- `'Solo'` → `isSolo = true`, `fmCategory = 'solo'`
- one of the 9 FM roles → `fmRole = <token>`

Handles all observed orderings including the hybrid `CR 20 Brute
Solo` form.

#### Re-scrape results

Across the same 5 FM pages: **45 minions** + **17 solos** captured
out of 305 FM monsters. Updated `fmCategory` distribution:

| Category | Before | After |
|----------|--------|-------|
| Standard (no special category) | 243 | 159 |
| Villain-party NPC | 35 | 35 |
| Companion | 26 | 26 |
| Retainer | 23 | 23 |
| **Minion** | 0 | **45** |
| **Solo** | 0 | **17** |

Examples now correctly tagged:
- Angulotl Tadpole — CR 1/4 Minion
- Bugbear Regular — CR 1 Minion
- Air Spark — CR 15 Minion
- Durixaviinox — CR 20 Solo (Brute)
- Yserthrax — CR 22 Solo (Brute, FM dragon)
- Shtriga Nonna — CR 6 Solo (Controller)

#### Downstream impact

- The Menagerie's Browse list shows the `Solo` / `Minion` badges in
  the header (already wired in the earlier renderer changes — just
  needed the underlying flags set).
- The War Table's FM encounter math correctly weights minions
  fractionally per the Minion Encounter Building table, and solos
  route to the Solo Creatures Encounters table.
- The chimera generator's library extractor picks up minion stat
  blocks as separate entries — useful since minions have radically
  different action shape (single attack, fixed damage, no rolls).

DM action: re-import the refreshed `bestiary.json` via the
Menagerie's Import tab (Replace recommended for a clean v7 + minion
state, or Merge with the `_legacyId` fallback for the upgrade path).
The auto-rebuild ingests the now-tagged minions and solos into the
feature library in the same operation.

#### `scripts/scrape_fm_ddb.js`

Patched the CR-line parser to use the tokenize-each-word approach
so subsequent scrapes start clean. Added a `// VERIFY` comment with
all four observed line variants.

---

### Bestiary + War Table: source chip everywhere

Adds a color-coded source chip (mm-2024 / tob-v1 / fm-v1 / custom)
next to every monster's name across the tool so DMs can tell at a
glance which book a creature came from — especially useful now that
FM imports overlap with MM names (Aboleth, Basilisk, Chimera, etc.).

#### Where the chip appears

- **Menagerie → Browse list**: row name shows the chip beside the
  monster name + role chip (already added in the dupe-fix commit;
  now uses the proper color-coded class instead of a one-off style).
- **Menagerie → Editor title**: while editing a monster, the title
  shows the source so the DM can tell which copy of a duplicate-name
  monster they're refining.
- **War Table → Bestiary picker rows**: every monster in the picker
  list gets the chip.
- **War Table → Cart row**: each picked monster line shows the source
  beside its name.
- **War Table → Combatant card**: live in initiative, beside the
  combatant name — uses the `bestiarySource` stamp already on the
  combatant (set when adding from the picker).

#### Color scheme

| Source | Color |
|--------|-------|
| `mm-2024` | Blue (`#8eb5e8`) |
| `tob-v1` | Tan (`#d2bd96`) |
| `fm-v1` | Rust (`#e3a08e`) |
| `custom` | Brass (`var(--brass-bright)`) |
| anything else | Faint ink (graceful fallback) |

#### Added

- `bestiary-dm.html`: `.source-chip` CSS class with per-source color
  variants. Wired into the Browse row and Editor title.
- `initiative-dm.html`: `.bestiary-source-chip` CSS + new
  `sourceChipHTML(src)` and `bestiarySourceChipHTML(m)` helpers.
  Wired into the picker row, cart pick row, and combatant card name.
- Both tools skip the chip when `source` is empty, `'custom'`, or
  `'imported'` (those cases either already have a different chip or
  carry no source info worth surfacing).

---

### War Table: Flee Mortals encounter math replaces 2024 DMG XP thresholds

The bestiary picker's encounter difficulty was using 2014 DMG XP-band
math (Low / Moderate / High). Switches over to the Flee Mortals system
which fits the MCDM monsters we just imported (and matches how DMs run
the FM-shaped combat encounters).

#### What's different about FM encounter building

- Encounters are sized by **CR budget**, not XP. Per-character CR
  budget by level + difficulty, then × party size for the total.
- Five difficulty bands: **Trivial / Easy / Standard / Hard / Extreme**
  — replacing the old four (Low / Moderate / High / Over).
- Each non-trivial encounter is worth **daily encounter points**
  (Easy 1, Standard 2, Hard 4, Extreme 8). Typical adventuring day
  budget is 6–8 points.
- **CR cap** per level: a single monster's CR can't exceed this even
  if the budget has room (the FM table caps level 1 at CR 1, level
  10 at CR 15, level 20 at CR 30).
- **Minions** count fractionally — the Minion Encounter Building
  table lists how many of a given CR equal one standard creature
  (5 for CR 0–4, 8 for CR 5–8, 10 for CR 9+).
- **Solo creatures** are sized against a different table entirely
  — the difficulty is (CR cap − solo CR) bucketed by party size.
  Mixing other monsters with a solo is non-standard.
- Action-economy cap: no more than **3 non-minion creatures per
  character** (party of 4 → max 12 non-minion monsters).

#### Changed — `initiative-dm.html`

- New `FM_CR_BUDGET` table (level → easy/standard/hard CR per char +
  CR cap), `FM_MINIONS_PER_STD` lookup, `fmCR` formatter (½, ¼, etc.),
  `fmDifficultyBand`, `fmSoloBand`, `FM_DAILY_POINTS`.
- `renderBudget()` rewritten end-to-end:
  - Sums monsters' CRs (weighted: minion CR ÷ minions-per-standard,
    solos handled separately, non-minions count full).
  - Displays Easy / Standard / Hard CR thresholds with the active
    band highlighted.
  - Shows daily encounter points for the resolved difficulty.
  - Surfaces warnings when a monster's CR exceeds the level cap or
    the non-minion count exceeds the action-economy cap.
  - Special-cases solo creatures via the FM Solo Creatures table.
- UI label updated: "2024 DMG XP thresholds…" → "Flee Mortals CR
  budget — per-character × party size."
- "Total XP" → "Total CR"; XP total kept as a small parenthetical
  footnote for backward reference.
- `XP_THRESHOLDS` constant removed — no callers remain.

#### Acceptance walkthrough (FM book example)

"Hard encounter for four 5th-level characters" → budget table says
2.5 CR/char × 4 = **10 CR total**, CR cap **8**. The renderer now
flags an Owlbear (CR 3) + Bugbear Predator (CR 3) + Lizardfolk
Terrorsaur (CR 4) = **10 CR**, band Hard, 4 daily encounter points,
no warnings — matching the example in the FM rulebook.

---

### Menagerie: unique slug per monster (schema v7) — fixes FM ↔ MM collisions

Every monster now gets a `slug` field of the form
`<source>-<kebab-name>` (e.g. `mm-2024-aboleth`, `fm-v1-aboleth`,
`tob-v1-kraken`). The slug is also assigned to `id` so existing
id-keyed code paths inherit the uniqueness without changes.

#### Why

Pre-v7 ids were minted from the name alone (`AbolethStatBlock`).
That collided when the same canonical creature appears in multiple
books — Flee Mortals shares 33 names with the 2024 Monster Manual
(Aboleth, Basilisk, Chimera, Crawling Claw, Ghoul, Goblin Warrior,
Green Hag, Griffon, Harpy, Kraken, etc.). The Import-tab Merge
dedup keys on `id`, so the FM versions were silently dropped on
import — a 33-monster data loss the DM only noticed by counting.

#### Schema additions

- `slug` — canonical unique key. Format: `<source-tag>-<kebab(name)>`.
- `id` is now aliased to `slug` for new normalizations. Old id values
  (`<PascalCase>StatBlock`) are preserved under `_legacyId` so
  Merge-mode dedup can match old-KV entries against newly-normalized
  entries without losing edits.

#### Updated paths

- `scripts/normalize_bestiary.py` mints slug + sets id = slug for
  every monster. SCHEMA_VERSION bumped to 7. New helper
  `make_slug(source, name)`.
- `bestiary-dm.html` `computeMergeDelta` now builds the existing-key
  set from `slug | id | _legacyId` and the incoming check matches
  on any of those. A KV holding the pre-v7 "AbolethStatBlock"
  entry will still merge correctly with the v7 "mm-2024-aboleth"
  import via the `_legacyId` fallback.

#### Migration steps for the DM

1. `python3 scripts/normalize_bestiary.py` — already done; bestiary.json
   now has slugs.
2. Menagerie → Import tab → re-import the regenerated `bestiary.json`.
   Use **Replace mode** for a clean slate, or **Merge mode** to keep
   any in-KV edits (the `_legacyId` fallback handles back-compat).
3. Library auto-rebuild runs in the same operation — donor IDs
   re-point to the new slugs.

#### Verification

Re-ran the normalizer + the tagger over the merged 1124-monster
bestiary: 1124 unique slugs (zero collisions), 1124 unique ids
(was 1091 with 33 collisions), 1124 `_legacyId` stamps preserved.

---

### Menagerie: Flee Mortals scrape — 305 monsters captured (FM v1 live)

Production run of the FM scrape pipeline against the live DDB book.
Replaces the speculative template `scripts/scrape_fm_ddb.js` from the
prior commit with the verified-working version tuned to the actual
DOM (`.mcdm-statblock` wrapper, `.mon-data` header block,
`<p class="monster--action-header">` section dividers).

#### Captured

| Category | Count |
|----------|-------|
| Standard monsters (CR + role) | 221 |
| Villain-party NPCs | 35 |
| Player companions (PB-scaled) | 26 |
| Retainers (PB-scaled) | 23 |
| **Total** | **305** |

Concatenated into `bestiary.json` alongside MM 2024 (503) and ToB
v1 (316) for a unified bestiary of **1,124 monsters**.

#### Role distribution across the merged bestiary

After running `tag_bestiary.py` (which preserved the 194 FM-supplied
roles via the `roleManual:true` flag): Brute 378, Soldier 244,
Skirmisher 187, Controller 148, Ambusher 50, Artillery 49, Support
41, Leader 27, Defender 0.

#### Workflow that worked

1. Visit each of 5 stat-block pages on DDB
   (`/sources/fm/creatures-{ad,ek,ls,tz}` + `/sources/fm/villain-parties`)
2. Paste the scrape script into devtools console on each page —
   results accumulate in `localStorage.fm_scrape`
3. On the last page, call `window.__fmDownload()` → `fm.json`
   downloads to `~/Downloads`
4. Move to project root, run `python3 scripts/normalize_bestiary.py`
   — auto-detects `fm.json` alongside `tob.json`
5. Run `python3 scripts/tag_bestiary.py` — preserves the
   FM-supplied roles, fills in terrain affinities
6. Menagerie Import tab → Merge mode → library auto-rebuilds with
   the new FM features included

#### Script changes (`scripts/scrape_fm_ddb.js`)

Production version (replaces speculation template):
- Selector locked to `.mcdm-statblock` (FM-specific class).
- `.mon-data` lines parsed for size+type, "CR X Role" line with
  optional Minion/Solo suffix, XP line. Standalone "Retainer" line
  detected via post-process pass.
- `<p>` walker stops at `<p class="monster--action-header">` to
  switch sections (Actions / Bonus Actions / Reactions / Legendary
  Actions / Villain Actions / Lair Actions).
- 2014→2024 prose modernizer included inline. "Melee Weapon Attack:
  +X to hit" → "Melee Attack Roll: +X", strip ", one target.",
  capitalize damage types.
- Multi-page accumulation via `localStorage.fm_scrape` so each page
  visit appends; final page calls `window.__fmDownload()` to build
  the envelope and trigger Blob download.
- Companion / retainer / villain-party / minion / solo all routed
  to `fmCategory` for downstream filtering.

---

### Menagerie: Flee Mortals (MCDM) scrape pipeline

Adds support for scraping the Flee Mortals book from D&D Beyond and
ingesting its MCDM-specific stat block shapes — Villain Actions,
Minion / Solo flags, and pre-tagged Flee Mortals roles (which match
the taxonomy we already use, so they slot directly into `role` with
`roleManual:true` set so the auto-tagger never overrides them).

#### Added — `scripts/scrape_fm_ddb.js`

Chrome devtools paste-and-run script. Walks the Flee Mortals source
page on DDB, extracts per-monster stat blocks, and triggers a Blob
download of `fm.json` to ~/Downloads. Output shape matches the
existing MM 2024 scrape envelope (same `source / scrapedAt / count /
monsters` keys) plus the FM extensions on each monster. Selectors
are annotated `// VERIFY` so the DM can spot-check against DDB's
actual DOM if extraction looks wrong.

Documented workflow:
1. Sit on the Flee Mortals source page on DDB
2. Paste the contents of `scrape_fm_ddb.js` into the devtools console
3. `fm.json` downloads automatically
4. Move it to the project root
5. `python3 scripts/normalize_bestiary.py` picks it up alongside
   `tob.json` (both auto-detected; multi-source extras concatenated)
6. Menagerie → Import tab → select normalized `bestiary.json` →
   Merge mode → done. The library auto-rebuild includes the FM
   monsters' actions/traits.

#### Schema additions (v6)

`scripts/normalize_bestiary.py` now passes through:
- `villainActions: [{name, body}]` — FM's 1/round boss powers,
  rendered as its own section between Legendary Actions and Lair
  Actions
- `isMinion: bool` — minion-tier monsters (the FM concept of a
  group-blob with shared HP)
- `isSolo: bool` — solo monsters (boss-tier, expected to fight a
  full party alone)
- `fmRole: string` — original FM role text, preserved as
  back-reference
- `fmCategory: string` — derived: "minion" / "solo" / "" — useful
  for filtering / encounter-building

If `fmRole` is present, the normalizer copies it to `role` and
flips `roleManual:true` — the auto-tagger won't override MCDM's
intent on a re-run. SCHEMA_VERSION bumped to 6.

#### Renderer updates

`bestiary-dm.html` `renderStatblock` now displays:
- A teal **Solo** or muted **Minion** chip beside the monster's name
  in the header
- A **Villain Actions** section (same renderer as Legendary
  Actions), positioned between Legendary Actions and Lair Actions

`renderStatblockWithDonors` walks the new `villainActions` array
too, so a chimera that slotted villain actions shows them with
proper `⟨from …⟩` donor labels.

#### Library extractor updates

Both `scripts/extract_features.py` and the JS port in
`bestiary-dm.html` gain `villainActions` → `villain_action` kind.
`KIND_COST_MULT.villain_action = 11` (between save_effect and
spellcasting — pricey because these are 1/round boss powers, not
at-will). `sectionForKind` maps `villain_action` →
`villainActions`. `blankChimera` now includes an empty
`villainActions: []` so the generator's slot allocator can extend
to support villain actions later.

`.gitignore` patterns for `fm.json` / `fm-*.json` follow the same
gitignored-book-content rule the rest of the bestiary data uses.

---

### Menagerie: bestiary import auto-rebuilds the feature library

When the DM imports a new bestiary (Merge or Replace), the page now
re-runs the feature-extraction logic in-browser and rebuilds the
feature library against the resulting bestiary — so newly-imported
monsters' actions/traits become library entries automatically with
proper role + terrain affinity, tier, cost, and `{MONSTER}` /
`{SPELL_DC}` / `{SPELL_ATK}` placeholders.

#### Added — `bestiary-dm.html`

- **JS port of `scripts/extract_features.py`**, living alongside the
  chimera generator helpers. Functions:
  - `libCanonicalName(raw)` — strip recharge markers + form qualifiers
  - `libMakeBodyTemplate(body, donorName)` — `{MONSTER}` substitution
  - `libNormalizeSpellcastingBody(body)` — strip DC / spell-attack
    bonus into `{SPELL_DC}` / `{SPELL_ATK}` placeholders
  - `libParseFeatureFields(item, monster, kind)` — extract template
    fields for attack/save/multiattack/spellcasting kinds
  - `libExtractMonsterFeatures(monster)` — generator over a monster's
    traits/actions/bonus/reactions/legendary
  - `libAggregateTemplateFields(donors)` — median dice + die size,
    median numerics, mode strings, majority booleans (mirrors the
    Python aggregator from the v2 extractor)
  - `rebuildLibraryFromBestiary(currentLibrary, allMonsters)` — the
    driver. Buckets by `(canonicalName, kind, tier)`, builds entries
    with aggregated fields + affinity unions, **preserves entries
    flagged `_custom: true` or `_manualEdit: true`** so handwritten +
    DM-tweaked library content survives the rebuild.

#### Changed — Import workflow

- `doImport`'s bestiary path (both Merge and Replace) now triggers a
  library auto-rebuild after the bestiary save succeeds. A
  `setTimeout(0)` yield lets the spinner paint before the rebuild
  starts. Result lands in the `feature_library` KV via the existing
  save path, and the in-memory `featureLibrary` updates so the
  generator picks up new features without a page reload.
- Import preview gets a second line: "Feature library auto-rebuilt:
  N entries (+M from previous)." If the rebuild fails for any
  reason, the bestiary save still succeeds and the error message
  surfaces in the preview, with a fallback note pointing the DM at
  `scripts/extract_features.py`.

#### Changed — Library tab Save

- Saving an entry via the Library tab now stamps `_manualEdit: true`
  + `_manualEditedAt: <ISO>` on the modified record. The next
  auto-rebuild on bestiary import will skip rebuilding that bucket
  and preserve the DM's edit verbatim.

#### Workflow this unlocks

- DM imports a new book (e.g. a homebrew bestiary, Volo's etc.) →
  the library updates in the same operation, no command-line step.
- Stand-alone Python pipeline (`scripts/extract_features.py` +
  Import library file) still works — useful for cold-start or for
  DMs who want to inspect the extracted JSON before importing.

---

### Menagerie: Library tab + in-place monster edit

Two related editing affordances that close out the chimera-architecture
workstream.

#### Library tab — browse, add, edit, delete library features

New tab between Generate and Import on `bestiary-dm.html`. Same
Browse-style two-column layout: a filterable list on the left
(search by name, filter by kind / tier / role affinity / signature
status) and an edit form on the right.

Form fields:
- Identity: canonical name, display name, kind (11 options), tier
  (low/mid/high/epic), cost, signature toggle
- Role affinity chip-checkboxes (the 9 Flee Mortals roles)
- Terrain affinity chip-checkboxes (12 terrains)
- Template fields as raw JSON textarea (for attack/save kinds; the
  chimera composes the body from these at slot time)
- Body template textarea with `{MONSTER}` / `{SPELL_DC}` /
  `{SPELL_ATK}` placeholder hints
- Donor lineage panel (readonly — shows which monsters contributed
  to this entry; "manually-added entry" for `_custom: true` items)

Actions: Save changes (writes the whole envelope back to
`feature_library` KV), Discard edits (re-selects from in-memory
state), Delete (only available for custom-authored or zero-donor
entries — imported entries can't be deleted to avoid accidental
mass-loss; re-extract instead).

`+ New` button mints a placeholder entry (trait + mid + cost 38)
that the DM can fill in. Auto-focus on the search field after add
so the new entry is easy to find. List caps at 250 entries
rendered; narrow with the search/filter dropdowns.

#### In-place monster edit on Browse

New **✏️ Edit this monster** button next to the existing **📋 Edit
a copy** on every monster's stat block in Browse. Loads the monster
into the Editor with `editingId` set to the source id, so Save
updates the existing record instead of minting a new one.

Save routing: a new page-level `editingSource` state
(`'custom' | 'bestiary'`) determines which KV to write back to.
Custom monsters keep going to `bestiary_custom` as before; imported
ones write back to `bestiary` (whole envelope, monsters array
mutated in place) with an `_edited: true` + `_editedAt` ISO timestamp
stamp on the modified record. Analysis cache is invalidated on
imported-monster save.

Delete is hidden for imported edits — re-importing the bestiary is
the canonical "reset" path. Duplicate stays available so a DM can
edit-as-copy if they realize mid-edit they want to keep the
original.

#### Behavior changes

- `cloneMonsterToEditor`, `newCustom`, `loadCustom`, `saveCustom`
  all set/reset `editingSource` consistently.
- `loadFormFromEdit` now keys the Delete button visibility on
  `editingSource === 'custom'` not just `editingId`.

---

### Menagerie: median-dice aggregation + spell DC/atk placeholders (lib v2)

Phase 3 of the feature library: closes the two gaps left in v1.

#### Changed — `scripts/extract_features.py`

- **Median-dice aggregation.** Previously each `(canonicalName, kind,
  tier)` bucket picked one representative donor (highest CR within
  the band) and copied its templateFields verbatim, so quirks of a
  single donor shaped the entry — `Bite-high` could land 2d10 (a
  single donor's atypical bite) when `Bite-mid` was 4d8. New
  `aggregate_template_fields(bucket)` walks every donor's fields and
  computes per-component central tendency: median dice count + die
  size for dice strings, median for numeric (reach / range / count
  / bonuses), mode for damageType / weaponName / recharge, majority
  vote for booleans. Re-extracted library shows the expected
  progression — Bite: low 1d6 → mid 2d8 → high 2d10 → epic 2d10
  reach 15 (rider grows even when base dice plateau).
- **Body-template donor pick.** Prose bodies (traits, spellcasting,
  utility, etc.) still come from a single donor — but the
  representative is now the donor closest to the tier midpoint, not
  the highest-CR outlier. Picks central phrasing over edge-case
  strongest version.
- **Spell placeholders.** `parse_spellcasting_to_template` +
  `normalize_spellcasting_body` strip donor-specific DCs ("spell
  save DC 17" → "spell save DC {SPELL_DC}") and spell-attack
  bonuses ("+10 to hit with spell attacks" → "+{SPELL_ATK} to
  hit…") so the chimera resolves them against its own ability + PB.
- **SCHEMA_VERSION = 2.** The page tolerates v1 entries (no
  placeholders, single-donor fields) so a DM who hasn't re-imported
  doesn't break, but re-running the script + re-importing
  feature_library.json picks up the new aggregation.

#### Changed — `bestiary-dm.html`

- `fillMonsterPlaceholders` gains `resolveSpellTokens(text, feat)`
  — replaces `{SPELL_DC}` with `8 + pb + mod` and `{SPELL_ATK}`
  with `pb + mod` against the chimera's spell ability. The ability
  comes from the feature's `_template.fields.spellAbility` when
  present (set by the extractor's `parse_spellcasting_to_template`);
  falls back to the chimera's best INT/WIS/CHA mod.

#### Required re-imports

- Run `python3 scripts/extract_features.py` to regenerate
  `feature_library.json` with median dice + spell placeholders.
- Re-import via the Menagerie's Import tab (Replace path —
  feature-library imports are always replace-mode).

---

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

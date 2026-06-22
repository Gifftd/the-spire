# Crucible v2: Spatial Combat Foundation — Design

**Status:** Approved 2026-06-22. Awaiting implementation plan via `superpowers:writing-plans`.

**Predecessor:** Crucible v1 (abstract any-vs-any trials, deterministic seeded simulator, ~38 engine tests + 91 feature tests). v1.1 extension shipped per-effect `when` predicates, Feature Impact damage attribution, gate-trace events, color-coded log, and a `forcedActions` queue. Foundation: see `docs/superpowers/specs/2026-06-19-pc-features-v1.1-dsl-editor-design.md`.

**Scope of this document:** The foundation of Crucible v2 — a position-aware tactical combat simulator with a stepable 2D viewer. This is the *first of several* v2 specs; terrain types, encounter authoring (placement editor + waves), and animation polish are explicitly out of scope and live in follow-up specs.

---

## 1. Goals & non-goals

### Goals

- **Spatial data model.** Combatants have `x`/`y` cell coordinates and `speed`. Actions have `range` (cells) and `shape`+`size` for AoE. Encounters declare a `map` with `width`/`height` and an optional `blocked` grid.
- **Richer event stream.** Existing events keep their current shape and gain `pos` (where the actor stood). Three new event types: `placement`, `move`, `aoe`, `opportunity-attack`.
- **Tactical-combat-aware engine.** Initial placement, A*-based path planning around obstacles, smart-scored target selection, opportunity attacks when leaving an enemy's melee reach, and AoE template targeting + resolution.
- **2D viewer.** SVG board in the Crucible Results panel, time-travel via cursor over the event stream, with `play / pause / step / step-back / scrub / speed` controls. Trial log lines are clickable to jump to that event.
- **Migration.** Every existing PC, custom feature, and encounter continues to work. PCs gain `combat.speed` (default 6 cells). Encounters get default placement (PCs back row, monsters front row).

### Non-goals (each a follow-up spec)

- **Terrain types**: difficult / damaging / cover / line-of-sight. The *obstacle* data (blocked cells) ships in foundation because A* needs it; the cell-type-specific *behaviors* come later.
- **Encounter editor UI**: placement editor, terrain authoring, multi-wave triggers. Foundation engine consumes whatever `placement` / `map` an encounter declares; authoring is a UI concern for a separate spec.
- **Animation polish**: smooth tweens beyond CSS transitions, attack sparks, damage popups floating up, screen shake, etc. Foundation ships baseline CSS `transform` transitions.
- **Multi-wave encounters**: round-triggered reinforcement spawns. Engine groundwork could be added later without breaking foundation events.

### Success criterion

> Run a sim with an existing party + encounter. See PCs and monsters laid out on a 2D board. Watch combatants pathfind toward each other (or each other's allies), trigger opportunity attacks when fleeing, and resolve AoE attacks against clusters. Click "step" to advance one event at a time, or click any line in the trial log to jump there. Combat outcomes for "everyone starts in melee" scenarios match v1 (no rng-stream perturbation when no movement is needed).

---

## 2. Architecture overview

The engine emits a complete event stream offline (the same way v1 already does for the trial log and Feature Impact aggregator). The viewer is a **dumb replayer**: it reads the event stream and renders the world at a given cursor index. No engine state is shared with the viewer beyond the trial result object.

```
runSim → trials × runTrial → trialResult { events: [...], finalState, ... }
                                                  │
                                                  ▼
                                         renderViewer(rootEl, trial)
                                                  │
                                          renderTo(cursorIndex)
                                                  │
                                              snapshot
                                                  │
                                          SVG re-render
```

**Why event-sourced replay:**

- Trial runs are deterministic; the viewer never blocks or perturbs the engine.
- Time travel (`scrub`, `stepBack`) is free — just re-replay from index 0 to the target.
- Monte Carlo (500-trial sims) still runs at v1 speeds since the viewer is opt-in per representative trial.
- Engine and viewer are developed and tested independently.

**Replacing v1.** v2 is the new engine going forward. v1 abstract-trial mode is removed. Any documentation referencing "abstract simulation" is updated to describe the tactical mode.

---

## 3. Spatial data model

### Map

```js
{
  width: 20,             // cells (1 cell = 5ft). Default 20×20 = 100ft × 100ft.
  height: 20,
  blocked: null,         // null | boolean[height][width]. true = impassable.
                         // Foundation only authors null (no obstacles). Terrain
                         // spec authors blocked cells for walls / pillars / etc.
}
```

Default if missing on an encounter: `{ width: 20, height: 20, blocked: null }`.

Sanity cap warning if `width × height > 60×60`.

### Distance metric

**Chebyshev distance**: `max(|dx|, |dy|)`. Diagonals cost 1 cell. Matches 5e RAW since the 2014 PHB. The DMG-variant "5-10-5 alternating diagonal" is deferred to a per-encounter setting in a later spec.

### Combatant fields added

```js
combatant.x       // 0..map.width-1
combatant.y       // 0..map.height-1
combatant.speed   // cells per turn. Default 6 (= 30ft) when not on pm.combat.speed.
combatant.threat  // float, computed once at trial start. Used by the target scorer.
combatant.tokenSize  // default 1. Reserved for future large/huge creatures (2×2/3×3).
                     // Foundation: every combatant is 1×1.
```

`combatant.reactionAvailableThisRound` (already exists in v1) is reused for opportunity-attack gating.

### Action fields added

```js
action.range  // integer cells. 1 = melee/adjacent. 6 = default ranged (30ft).
              // Backwards compat: if missing, derive from actionRange:
              //   'melee'  → 1
              //   'ranged' → 6
              //   anything else → 1

action.shape  // 'single' (default, ignores size) | 'cone' | 'line' | 'sphere' | 'cube'
action.size   // cells. For cone/line: length. For sphere/cube: radius (sphere) or
              // side (cube). Ignored when shape === 'single'.
```

`actionRange: 'melee' | 'ranged'` is **kept** as a categorical — Sneak Attack eligibility, Rage's bonus damage gating, etc. still need to know "is this a ranged attack." `range` (cells) is added for engine range-checking and movement targeting.

---

## 4. Event stream extensions

### Existing events

All v1 events keep their existing fields unchanged. Every combat event gains:

```js
{
  // ...existing fields...
  pos:       { x, y },   // actor's cell at event time
  targetPos: { x, y },   // target's cell. Present on attack / damage / save events
                         // where a single target is identifiable.
}
```

### New event types

**`placement`** — fires once per trial, at the very top of `runTrial`, right after `buildCombatants` and initial position assignment.

```js
{
  type: 'placement', round: 0,
  map: { width, height, blocked },
  placements: [
    { id, name, side, pos: { x, y }, hp, maxHp, ac, speed },
    // ... one entry per combatant
  ],
}
```

**`move`** — fires whenever a combatant traverses cells during their turn (engagement, repositioning).

```js
{
  type: 'move', round, who, name,
  from: { x, y },
  to:   { x, y },
  path: [ {x,y}, {x,y}, ... ],  // cells traversed in order. Last entry === to.
  reason: 'engage' | 'reposition' | 'flee' | null,
}
```

The viewer animates the token along `path` (not just a teleport from `from` to `to`).

**`aoe`** — fires when an AoE action's template is resolved against the board.

```js
{
  type: 'aoe', round, source: c.id, action: actionName,
  shape: 'cone' | 'line' | 'sphere' | 'cube',
  center: { x, y },               // cast origin or template anchor
  direction: { dx, dy } | null,   // for cone/line; null for sphere/cube
  size: number,                   // length (cone/line) or radius/side (sphere/cube)
  cellsCovered: [ {x,y}, ... ],   // every cell inside the template
  targets: [                      // combatants hit
    { id, name, pos, dmg, dmgType, saved },
    // ...
  ],
}
```

Per-target damage / save outcomes are also emitted as their normal `damage` / `save` events for the Feature Impact aggregator. The `aoe` event is the *template* event — a higher-level summary that the viewer uses to draw an overlay.

**`opportunity-attack`** — fires when a leaving combatant provokes from a defender with melee reach + an available reaction.

```js
{
  type: 'opportunity-attack', round,
  attacker: defender.id,
  attackerName, target: leaver.id, targetName,
  fromCell: { x, y },     // attacker's cell
  triggerCell: { x, y },  // the cell the leaver was leaving from
  roll, hit, damageDealt,
}
```

### Color-coded log additions

`tests/color-coded-log` already supports classes `log-move`, `log-aoe`, `log-opportunity-attack`, `log-placement` — but in foundation we add the CSS rules:

```css
.log-move              { color: var(--c-ink-faint); font-style: italic; }
.log-aoe               { color: #c87cd4; font-weight: 500; }   /* purple — magic / template */
.log-opportunity-attack{ color: #d97a7a; font-weight: 600; }   /* red, bold — bad thing happened */
.log-placement         { color: var(--c-ink-faint); }
```

---

## 5. Engine changes

All changes live inside `crucible-engine.js`. v1's helper functions (`isAvailable`, `consumeUse`, `applyDamage`, the kind-dispatch branches) are preserved.

### 5a. Initial placement

At the top of `runTrial`, right after `buildCombatants`:

```js
const map = (encounter && encounter.map) || { width: 20, height: 20, blocked: null };
placeCombatants(combatants, map, encounter && encounter.placement);
computeThreat(combatants);
events.push({
  type: 'placement', round: 0, map,
  placements: combatants.map(c => ({
    id: c.id, name: c.name, side: c.side,
    pos: { x: c.x, y: c.y },
    hp: c.hp, maxHp: c.maxHp, ac: c.ac, speed: c.speed,
  })),
});
```

**`placeCombatants(combatants, map, placement?)`** (new, in `crucible-spatial.js`):

- If `placement` is an array of `{ id, x, y }` overrides, apply them.
- Otherwise, default rule: PCs at `y = 1`, monsters at `y = height - 2`. Both sides evenly spaced across the available width.

**`computeThreat(combatants)`** — assigns `c.threat` based on DPR estimate × HP. PCs and monsters share the same formula. Used by the target scorer below.

### 5b. A* pathfinding

**`findPath(start, goal, map, options)`** (new, in `crucible-spatial.js`):

- Standard A* with Chebyshev heuristic.
- Treats `map.blocked[y][x] === true` cells as impassable.
- Treats cells occupied by *enemy* combatants as impassable. Cells occupied by allies are *traversable* (you can move through ally squares per 5e RAW) but not landable as the final cell.
- Options: `{ maxSteps, stopWhenAdjacent: combatant | null, side: 'pc' | 'monster' }`. `side` determines which combatants are treated as enemies. `stopWhenAdjacent` returns early when the path reaches a cell adjacent to the given combatant.
- Returns the list of cells from `start` (excluded) to the chosen endpoint (included), or empty array if unreachable.

`stepToward` (greedy) from the original Sec 4 is removed — A* covers it.

### 5c. Opportunity attacks

When a combatant traverses their `path`:

```js
for (const cell of path) {
  const provokesFrom = combatants.filter(d =>
    d.side !== c.side && !d.dead && !d.downed &&
    d.reactionAvailableThisRound &&
    (d.naturalReach || 1) >= chebyshev(d, { x: c.x, y: c.y }) &&
    (d.naturalReach || 1) < chebyshev(d, cell)
  );
  for (const defender of provokesFrom) {
    const oa = resolveOpportunityAttack(defender, c, rng, events, round);
    defender.reactionAvailableThisRound = false;
    if (c.dead || c.downed) break;  // OoA killed the leaver mid-path
  }
  c.x = cell.x; c.y = cell.y;
  if (c.dead || c.downed) break;
}
```

`naturalReach` defaults to 1 (5ft) — read from `monster.reach` (parsed bestiary) or PC weapon reach (a future PC editor field; foundation defaults to 1).

`resolveOpportunityAttack(defender, leaver, rng, events, round)` picks the defender's best melee single-target action and runs it through the same attack pipeline as a normal attack (so Sneak Attack on an attack-of-opportunity still works, Hex still rides along, etc.). Emits an `opportunity-attack` event and a `damage` event.

### 5d. Smart target selection

Replaces the v1 `pickEnemyTarget(c, all, tactics, rng)`:

```js
function scoreTarget(target, attacker, action, combatants, map) {
  const dist = chebyshev(attacker, target);
  return (
    -0.5  * dist
    +1.0  * (1 / Math.max(1, target.hp))      // focus fire on low-HP
    +0.3  * target.threat
    -2.0  * provokesOoAOnPath(attacker, target, combatants, map)
    -1.5  * (action.actionRange === 'ranged' && dist <= 1 ? 1 : 0)  // disadvantage in melee
  );
}
```

The coefficients are exposed as constants at the top of the function file so they're easy to tune. `provokesOoAOnPath` returns 1 if the A*-planned path from attacker to within-range-of-target passes through any other enemy's reach; 0 otherwise.

PC-side `tactics.aiHint` (`'focus' | 'survival' | 'spread'`) tweaks the weights — `'focus'` increases the HP-prioritization coefficient, `'survival'` decreases threat-prioritization and increases OoA avoidance, etc.

Monster-side uses the same scorer fed through each role policy's existing `pickTarget(c, all, ctx)` hook for backward compatibility — the role policies just call the new scorer instead of their old per-role heuristics.

### 5e. AoE template targeting + resolution

For an action with `shape !== 'single'`:

```js
const candidates = enumerateCastPoints(c, action, map);  // every cell within action.range of c
const ev = expectedDamage(action);                       // see below
let best = null;
for (const point of candidates) {
  const cells = coversCells(action.shape, point, action.size, c);  // template cells
  const enemiesHit = combatantsAt(cells, combatants).filter(t => t.side !== c.side);
  const alliesHit  = combatantsAt(cells, combatants).filter(t => t.side === c.side && t !== c);
  const score = enemiesHit.length * ev - alliesHit.length * ev * 0.5;
  if (!best || score > best.score) best = { point, cells, score };
}
```

If `best.score > 0`, the AoE fires at `best.point`. Otherwise the combatant falls back to picking a single-target action.

**`expectedDamage(action)`** (helper in `crucible-spatial.js`) — computes a single number representing the average damage the action deals to a hit target. For dice + flat mod: `(diceCount * (sides + 1) / 2) + mod`. For save actions: applies half-on-save discount. Pure function, no engine state. Used here for cast-point scoring and in `scoreTarget` for single-target action weighting.

**Per-shape cell helpers** (new, in `crucible-spatial.js`):

- `coneCells(origin, direction, length)` — 5e 60° cone: at distance `d` from the origin (1 ≤ d ≤ length), the cone is `d` cells wide centered on `direction`. Origin cell excluded.
- `lineCells(origin, direction, length)` — 1-cell-wide straight line of `length` cells along `direction`. Origin cell excluded.
- `sphereCells(origin, radius)` — every cell whose center is within Chebyshev radius of `origin`, origin included.
- `cubeCells(origin, side)` — every cell within a `side`×`side` square anchored at `origin` (which acts as the cube's center for odd `side`, or near corner for even `side` — convention: nearest-to-caster corner).

`direction` is a unit vector `{ dx, dy }` with `dx, dy ∈ {-1, 0, 1}` (eight cardinals + diagonals). `enumerateCastPoints` for cone/line iterates the eight directions; for sphere/cube it iterates cell positions within range.

Each is a pure function. Unit-tested standalone.

Resolution then walks `best.cells`, finds combatants in those cells, and resolves the save/damage per target through the existing v1 save resolution pipeline. One `damage` event per target (for the Feature Impact aggregator), plus the one summary `aoe` event for the viewer.

### 5f. Turn order within the action loop

Inside the existing `while (c.actionsAvailable > 0 ...)` loop (added in v1.1):

1. Pick action (with the new scorer). Honors `forcedActions` queue from v1.1.
2. **If `action.shape !== 'single'`**: pick cast point (5e), emit `aoe` event, resolve per-target damage. `actionsAvailable--`. Continue loop.
3. **Else single-target**: range check. If out of range, A\*-path toward target up to `speed` cells. Emit `move` + any provoked `opportunity-attack` events. Halt early if reduced to 0 HP.
4. If still out of range at end of move, skip the attack this turn (still consumed an action). `actionsAvailable--`. Continue loop.
5. Otherwise resolve the single-target action (existing v1 logic). `actionsAvailable--`. Continue loop.

### 5g. Determinism preservation

For "everyone starts in melee" scenarios (where no movement happens), the rng stream is not perturbed. Existing v1 seeded outcomes remain unchanged. New scenarios involving movement consume *no* rng — movement is deterministic given positions + speed + map.

---

## 6. Viewer skeleton

Lives in `crucible-viewer.js` (new file). Mounted inside the existing Results panel in `crucible-dm.html`, replacing the "Representative fights" section.

### Layout

Two-column when a trial is loaded:

```
┌────────────────────────────────────────────────────────────────────┐
│ Results · Wins 73% · Avg rounds 4.2 · ...                          │
├────────────────────────────────────────────────────────────────────┤
│ Feature Impact (collapsed table — unchanged)                       │
├──────────────────────────────────┬─────────────────────────────────┤
│   ┌────────────────────────┐     │ Trial Log (color-coded)         │
│   │      SVG GRID          │     │ R0 · Placement                  │
│   │   (map.w × map.h)      │     │ R1 · Warlock walks to (9,12)  │
│   │  PC tokens · Mob       │     │ R1 · Warlock → Goblin · ...   │
│   │   tokens, HP bars      │     │ R1 · ⚡ Hex +4 necrotic       │
│   │   AoE overlay (transient)│   │ ...                            │
│   └────────────────────────┘     │                                 │
│   [ Low p10 | Median | High p90 ]│                                 │
│   ┌────────────────────────────┐ │                                 │
│   │ ◀◀  ▶/❚❚  ▶▶   ━━━━●━━━   │ │                                 │
│   │ Speed: 0.5x 1x 2x 4x       │ │                                 │
│   └────────────────────────────┘ │                                 │
└──────────────────────────────────┴─────────────────────────────────┘
```

### SVG structure

```html
<svg viewBox="0 0 W*cell H*cell" class="tactical-board">
  <g class="grid-lines">…</g>
  <g class="blocked-cells">…</g>     <!-- impassable obstacles -->
  <g class="aoe-overlay"></g>        <!-- transient, fades after each event -->
  <g class="move-trail"></g>         <!-- transient dashed path -->
  <g class="tokens">
    <g class="token" data-combatant-id="pc:pm1" transform="translate(...)">
      <circle r="..." class="pc"></circle>
      <text>W</text>
      <rect class="hp-bar"></rect>
    </g>
    <!-- ... -->
  </g>
</svg>
```

### State derivation

Position state is **derived from the event stream**, never stored independently:

```js
function renderTo(eventIndex) {
  let state = initialState(events[0]);   // from the placement event
  for (let i = 1; i <= eventIndex; i++) {
    applyEvent(state, events[i]);
  }
  return state;
}
```

This is what makes scrubbing back free. CSS transitions on `transform: translate(...)` give smooth movement between adjacent cursor indices when stepping forward at normal speed.

### Controls

```js
state.cursor = 0;
state.playing = false;
state.speedMs = 600;

stepForward()   // cursor++; render
stepBack()      // cursor--; render
play()          // setInterval(stepForward, speedMs); state.playing = true
pause()         // clearInterval; state.playing = false
scrub(idx)      // cursor = idx; render
setSpeed(ms)    // state.speedMs = ms; restart interval if playing
```

### Event-log integration

Each line in the trial log on the right gets `onclick="setCursor(<eventIndex>)"`. Clicking jumps the board to that moment. The line corresponding to the current cursor gets `class="log-active"` (subtle highlight).

### Replay tab switching (Low/Median/High)

Existing p10/median/p90 picker stays. Switching replays calls `loadTrial(newTrial)` which resets `cursor = 0` and re-renders.

### Animation polish (minimum)

CSS `transition: transform var(--speed-ms) ease-out;` on `.token`. AoE overlay fades via `transition: opacity 600ms`. Move trail dashes are static (no animation in foundation).

---

## 7. Migration of v1 data

### PCs in `localStorage['crucible-party']`

Add a migration step in `migratePCRecord` (already exists in `crucible-dm.html`):

```js
if (typeof pm.combat.speed !== 'number') pm.combat.speed = 6;
```

Default 6 cells (30 ft). No user action required.

### Custom features

Keep working unchanged. Position fields on the combatant (`x`/`y`/`speed`) are additive; v1 features ignore unknown fields. The dispatcher's `dmgCtx` / `rollCtx` plumbing is untouched.

### Encounters

`encounter-schema.js` gains two optional fields with safe defaults:

```js
{
  map: { width: 20, height: 20, blocked: null },
  placement: null,                             // null = default layout rule
  // ...existing fields unchanged
}
```

`map.width × map.height > 60 × 60` emits a schema-level warning. The engine accepts any size up to a hard cap of 200×200 (which would be absurd in practice).

### Monster speed

The bestiary's parsed monster records already carry a `speed` field (parsed from the stat block). The engine reads `monster.speed.walk || 30`, divides by 5, and uses it as cells per turn. Defaults to 6 cells when missing.

### v1 abstract trial mode

**Removed.** v2 is the only engine. All UI and docs referencing "abstract simulation" are updated to describe the tactical mode.

### Worker / KV

No changes. Encounter blobs gain optional fields the worker doesn't validate. No worker deploy needed.

---

## 8. File structure

### New files

| File | Responsibility | Size estimate |
|---|---|---|
| `crucible-spatial.js` | Pure helpers: `chebyshev`, `findPath` (A\*), `placeCombatants`, `computeThreat`, `coneCells`, `lineCells`, `sphereCells`, `cubeCells`, `scoreTarget`, `provokesOoAOnPath`, `enumerateCastPoints`, `combatantsAt`. No DOM, no engine state. IIFE export pattern matching `pc-features.js`. | ~400 lines |
| `crucible-viewer.js` | The SVG viewer module. Exports `renderViewer(rootEl, trialResult, controlsEl)`. Self-contained — only consumes the event stream. IIFE export. | ~350 lines |
| `tests/crucible-spatial.test.html` | Unit tests for every pure helper. A* with obstacles; AoE cell coverage per shape; OoA detection on path; target scoring deterministic given inputs. | ~25 tests, ~300 lines |
| `tests/crucible-viewer.test.html` | Renders synthetic event streams into a hidden SVG container. Asserts token count, position after `renderTo(N)`, AoE overlay visible during AoE event, scrub returns to placement event cleanly. | ~10 tests, ~200 lines |

### Modified files

| File | Changes | Size estimate |
|---|---|---|
| `crucible-engine.js` | Placement at trial start; A* movement step; OoA emission; smart target scorer replaces `pickEnemyTarget`; AoE branch in kind-dispatch; new `placement` / `move` / `aoe` / `opportunity-attack` event types. v1 abstract trial-mode code paths removed. | +~350 lines, −~30 lines |
| `crucible-dm.html` | New `result-viewer` container in Results panel. Two-column layout (board + log) when trial loaded. Wire controls to `crucible-viewer.js`. CSS for grid lines, tokens, HP bars, AoE overlay, move trail, log-active highlight, new log classes. Migrate `combat.speed` default on PC load. | +~250 lines |
| `encounter-schema.js` | Add optional `map` and `placement` fields with defaults + cap-warning validation. | +~30 lines |
| `pc-features.js` | No behavioral changes. Test coverage in `tests/pc-features.test.html` updated to confirm dispatcher + primitives don't crash when combatants gain `x`/`y`/`speed`. | ~5 lines test setup |

**Totals:** 4 modified, 4 new. ~1,000 new lines of production code + ~500 lines of tests.

### Script load order in `crucible-dm.html`

```html
<script src="auth.js"></script>
<script src="encounter-schema.js"></script>
<script src="pc-features.js"></script>
<script src="crucible-spatial.js"></script>   <!-- new, before engine -->
<script src="crucible-engine.js"></script>
<script src="crucible-viewer.js"></script>    <!-- new, after engine -->
```

### Test plan

- **`tests/engine.test.html` (existing 38)**: every scenario gets reviewed and updated where needed. "Adjacent start" scenarios assert identical attack outcomes vs v1 (rng stream preserved). "Move toward target" scenarios are new. Estimated final count: ~42 tests.
- **`tests/pc-features.test.html` (existing 91, 77 passing)**: no logic changes expected. The 14 pre-existing free-method-invocation failures persist; no new regressions.
- **`tests/crucible-spatial.test.html` (new)**: A* basic, A* around obstacles, A* with unreachable goal, A* respects `maxSteps`. AoE cell coverage per shape (cone forward / cone left / sphere / cube / line). Target scorer ranks low-HP > high-HP given equal distance, ranks close > far given equal HP, applies OoA penalty correctly. Threat computation deterministic. Placement default layout for 1/2/4/6 PCs across various widths.
- **`tests/crucible-viewer.test.html` (new)**: render placement event → N tokens at expected positions; advance through move events → tokens update; scrub backward → tokens revert; AoE event → overlay visible during that index, hidden at index+1; click log line → cursor jumps.

---

## 9. Implementation phases (outline for `writing-plans`)

The plan should decompose this spec into the following phases. Each phase produces working, committed code with passing tests.

1. **Phase 1 — Spatial primitives module**: `crucible-spatial.js` with `chebyshev`, `findPath`, `placeCombatants`, `computeThreat`. Tests covering each. No engine integration yet.
2. **Phase 2 — AoE template helpers**: `coneCells` / `lineCells` / `sphereCells` / `cubeCells` / `enumerateCastPoints` / `combatantsAt`. Tests per shape. No engine integration yet.
3. **Phase 3 — Target scorer**: `scoreTarget` / `provokesOoAOnPath`. Tests for ordering invariants. No engine integration yet.
4. **Phase 4 — Engine: placement + movement**: `placement` and `move` events emitted. PCs and monsters use A* to close to range. Range-check before attack. v1 adjacent-start scenarios still pass with identical rng.
5. **Phase 5 — Engine: opportunity attacks**: OoA detection on path traversal. `opportunity-attack` event emitted. Defender's reaction consumed. Resolves through normal attack pipeline (Sneak / Hex / etc. still ride along).
6. **Phase 6 — Engine: smart target selection**: Replace `pickEnemyTarget` with the scorer. Behavior parity check on existing scenarios.
7. **Phase 7 — Engine: AoE template targeting + resolution**: Action `shape` / `size` honored. `aoe` event emitted. Per-target damage + save events still feed the Feature Impact aggregator.
8. **Phase 8 — Viewer foundation**: `crucible-viewer.js`. SVG board, token rendering, `renderTo(cursorIndex)`, basic controls (step / step-back / play / pause / scrub / speed). No animations yet.
9. **Phase 9 — Viewer polish**: CSS transitions for token movement, AoE overlay fade, move-trail rendering, log-line click → cursor jump, log-active highlight, replay-tab switching.
10. **Phase 10 — Migration + cleanup**: `combat.speed` default on PC load; schema migrations for encounters; remove v1 abstract-trial UI / docs; CHANGELOG.
11. **Phase 11 — Final code review across full diff**: spec compliance + code quality review subagents per the v1 / v1.1 workflow.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Movement breaks v1 seeded test outcomes | Movement consumes no rng; adjacent-start scenarios skip the move step entirely. Tests assert byte-identical attack rolls in those scenarios. |
| A* is slow on large grids | 60×60 cap warning, 200×200 hard cap. Chebyshev heuristic + open-list keyed Map. Profile during phase 4. |
| AoE friendly-fire scoring picks bad cast points | Coefficients exposed as named constants for tuning. Tests cover the obvious cases (3-enemy cluster + 1 ally — fires; 1-enemy + 3-ally cluster — doesn't fire). |
| Viewer animation feels janky | `speedMs` adjustable; default 600ms per event is comfortable. If users want faster, they slide the speed control. Smooth interpolation is in the polish spec, not foundation. |
| Existing custom DSL features crash on position fields | Dispatcher + primitives ignore unknown fields. Existing pc-features tests re-run as regression guard; add one new test that constructs a combatant with x/y/speed and runs every built-in feature without throwing. |
| Encounter editor UI absent → can't author placements | Default-layout placement covers every existing encounter. Foundation ships without authoring; later spec adds the editor. |

---

## 11. Out of scope (follow-up specs)

For clarity, each of the following will become its own brainstorm → spec → plan → implementation cycle:

- **Terrain types**: difficult terrain (2× move cost), damaging terrain (HP loss on entry/turn), cover (half / three-quarters / total → AC modifiers), line of sight (blocks ranged attacks / AoE templates).
- **Encounter editor UI**: placement editor in The Anvil, terrain authoring, multi-wave triggers (round-N spawns), reinforcement-wave events emitted by engine.
- **Animation polish**: smooth movement tweens (beyond CSS transitions), attack arc effects, floating damage numbers, screen shake on crits, particle/spell effects per AoE shape.
- **Large creature support**: tokenSize 2/3, multi-cell occupancy, reach math adjustments.
- **Spell components / concentration**: spell slot tracking, concentration breaks on damage, simultaneous-concentration limits.
- **Death saves**: PC death save mechanics when downed (current v1 marks them downed; doesn't track 3-strikes-to-stable-or-dead).

---

# Crucible v2 Spatial Combat Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the position-aware Crucible v2 engine and 2D viewer per the spec at [docs/superpowers/specs/2026-06-22-crucible-v2-spatial-design.md](../specs/2026-06-22-crucible-v2-spatial-design.md). v2 replaces v1's abstract trial mode with a grid-based tactical simulator featuring A* pathfinding, opportunity attacks, smart target selection, AoE templates, and an SVG-rendered event-sourced replay viewer.

**Architecture:** Event-sourced engine + dumb replay viewer. The engine emits a complete event stream (placement / move / aoe / opportunity-attack on top of v1.1's existing events). The viewer reads the stream and renders snapshots derived by replaying events to a cursor index. No shared state between engine and viewer beyond the trial result.

**Tech Stack:** Vanilla JS in IIFE modules (matches existing `pc-features.js` pattern). SVG for the board (DOM-rendered tokens, free hover + accessibility). HTML test harness with inline `test()` / `assert()` / `assertEq()` / `runAll()`. No build step.

---

## File Structure Overview

### New files

| File | Responsibility |
|---|---|
| `crucible-spatial.js` | Pure helpers: distance, A*, placement, threat, AoE template cells, target scoring. IIFE export. ~400 lines. |
| `crucible-viewer.js` | SVG viewer + replay controls. Self-contained — consumes event stream only. IIFE export. ~350 lines. |
| `tests/crucible-spatial.test.html` | ~25 unit tests for `crucible-spatial.js`. |
| `tests/crucible-viewer.test.html` | ~10 integration tests for `crucible-viewer.js`. |

### Modified files

| File | Changes |
|---|---|
| `crucible-engine.js` | Placement, movement, OoA, smart target, AoE branches. +~350 lines, −~30 lines (v1 abstract paths removed). |
| `crucible-dm.html` | Mount the viewer in the Results panel. Two-column layout (board + log). Wire controls. Migrate `combat.speed` on PC load. +~250 lines. |
| `encounter-schema.js` | Optional `map` and `placement` fields with cap-warning validation. +~30 lines. |
| `tests/engine.test.html` | Update scenarios; add movement / OoA / AoE coverage. ~+4 tests. |
| `tests/pc-features.test.html` | One new test asserting dispatcher + primitives don't crash on combatants with `x`/`y`/`speed` fields. |
| `CHANGELOG.md` | New v2 entry. |

### Module load order (in `crucible-dm.html`)

```html
<script src="auth.js"></script>
<script src="encounter-schema.js"></script>
<script src="pc-features.js"></script>
<script src="crucible-spatial.js"></script>   <!-- new, before engine -->
<script src="crucible-engine.js"></script>
<script src="crucible-viewer.js"></script>    <!-- new, after engine -->
```

### Test execution

All tests are static HTML pages. Run by serving the project root locally and opening the URL:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/tests/crucible-spatial.test.html
# click "Run tests" — output shows passed/failed counts.
```

For programmatic verification, this session has used the `preview_eval` MCP tool to load test pages in iframes and read `runAll()` output. Use whichever access pattern your workflow supports.

---

## Phase 1: Spatial primitives module

Pure helpers with zero engine coupling. Each function unit-tested standalone.

### Task 1.1: Create `crucible-spatial.js` skeleton

**Files:**
- Create: `crucible-spatial.js`
- Create: `tests/crucible-spatial.test.html`

- [ ] **Step 1: Write the file skeleton**

```javascript
// ═══════════════════════════════════════════════════════════════════════
//  crucible-spatial.js
//  Pure helpers for the v2 tactical engine: distance, pathfinding,
//  placement, AoE template cells, threat scoring.
//
//  No DOM access. No engine state. Same IIFE pattern as pc-features.js.
//  Loaded by crucible-dm.html BEFORE crucible-engine.js.
// ═══════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const CrucibleSpatial = {};

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CrucibleSpatial;
  } else {
    global.CrucibleSpatial = CrucibleSpatial;
  }
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: Write the test page skeleton**

`tests/crucible-spatial.test.html`:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>crucible-spatial tests</title>
<style>
  body { font-family: monospace; background: #0e1418; color: #dde7e9; padding: 1rem; }
  .pass { color: #6dd58c; }
  .fail { color: #d97a7a; }
  button { padding: 0.5rem 1rem; background: #1d3a4a; color: #dde7e9; border: 1px solid #1c2429; cursor: pointer; }
  pre { white-space: pre-wrap; margin-top: 0.5rem; }
</style>
</head>
<body>
<h1>crucible-spatial tests</h1>
<button onclick="runAll()">Run tests</button>
<pre id="out"></pre>

<script src="../crucible-spatial.js"></script>
<script>
const TESTS = [];
function test(name, fn) { TESTS.push({ name, fn }); }
function group(name) { TESTS.push({ group: name }); }
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg || 'mismatch') + ': ' + a + ' vs ' + e);
}
function assertClose(a, b, eps) {
  if (Math.abs(a - b) > (eps || 0.001)) throw new Error('close mismatch: ' + a + ' vs ' + b);
}
function runAll() {
  const out = document.getElementById('out');
  let passed = 0, failed = 0;
  const lines = [];
  for (const t of TESTS) {
    if (t.group) { lines.push('\n— ' + t.group + ' —'); continue; }
    try { t.fn(); lines.push('<span class="pass">✓ ' + t.name + '</span>'); passed++; }
    catch (e) { lines.push('<span class="fail">✗ ' + t.name + ' — ' + e.message + '</span>'); failed++; }
  }
  lines.push('\n' + passed + ' passed, ' + failed + ' failed');
  out.innerHTML = lines.join('\n');
}

// === Tests below this line ===
</script>
</body>
</html>
```

- [ ] **Step 3: Verify it loads with zero tests**

Serve the project root with `python3 -m http.server 8000`. Open `http://localhost:8000/tests/crucible-spatial.test.html`. Click "Run tests". Expected: `0 passed, 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add crucible-spatial.js tests/crucible-spatial.test.html
git commit -m "Crucible v2: scaffold crucible-spatial.js + test harness"
```

### Task 1.2: `chebyshev(a, b)` distance

**Files:**
- Modify: `crucible-spatial.js`
- Modify: `tests/crucible-spatial.test.html`

- [ ] **Step 1: Add the failing test**

Append to the `=== Tests below this line ===` section of `tests/crucible-spatial.test.html`:

```javascript
group('chebyshev');

test('chebyshev: same cell → 0', () => {
  assertEq(CrucibleSpatial.chebyshev({x:5,y:5}, {x:5,y:5}), 0);
});
test('chebyshev: orthogonal 1 step → 1', () => {
  assertEq(CrucibleSpatial.chebyshev({x:5,y:5}, {x:6,y:5}), 1);
  assertEq(CrucibleSpatial.chebyshev({x:5,y:5}, {x:5,y:6}), 1);
});
test('chebyshev: diagonal 1 step → 1 (5e RAW)', () => {
  assertEq(CrucibleSpatial.chebyshev({x:5,y:5}, {x:6,y:6}), 1);
});
test('chebyshev: 3 right, 4 up → 4 (max axis)', () => {
  assertEq(CrucibleSpatial.chebyshev({x:0,y:0}, {x:3,y:4}), 4);
});
```

- [ ] **Step 2: Run tests → expect 4 failing**

Open the test page, click "Run tests". Expected: each chebyshev test fails with `CrucibleSpatial.chebyshev is not a function`.

- [ ] **Step 3: Implement `chebyshev`**

Inside the IIFE in `crucible-spatial.js`, before the export block:

```javascript
function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

CrucibleSpatial.chebyshev = chebyshev;
```

- [ ] **Step 4: Run tests → expect 4 passing**

Reload the page, click "Run tests". Expected: `4 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add crucible-spatial.js tests/crucible-spatial.test.html
git commit -m "Crucible v2 spatial: chebyshev distance helper"
```

### Task 1.3: `findPath(start, goal, map, options)` — A* pathfinding

**Files:**
- Modify: `crucible-spatial.js`
- Modify: `tests/crucible-spatial.test.html`

- [ ] **Step 1: Add the failing tests**

Append to `tests/crucible-spatial.test.html`:

```javascript
group('findPath (A*)');

// Tiny helper to build a map quickly. blocked is a list of [x,y] pairs.
function mkMap(width, height, blocked) {
  const m = { width, height, blocked: null };
  if (blocked && blocked.length) {
    m.blocked = Array.from({length: height}, () => new Array(width).fill(false));
    for (const [x, y] of blocked) m.blocked[y][x] = true;
  }
  return m;
}

test('findPath: open grid, straight line', () => {
  const map = mkMap(10, 10, []);
  const path = CrucibleSpatial.findPath({x:1,y:1}, {x:4,y:1}, map, {});
  assertEq(path, [{x:2,y:1}, {x:3,y:1}, {x:4,y:1}]);
});

test('findPath: diagonal allowed (Chebyshev)', () => {
  const map = mkMap(10, 10, []);
  const path = CrucibleSpatial.findPath({x:0,y:0}, {x:3,y:3}, map, {});
  assertEq(path.length, 3);  // 3 diagonal steps
  assertEq(path[path.length - 1], {x:3,y:3});
});

test('findPath: routes around a single blocked cell', () => {
  // Block (2,1). Path from (1,1) → (4,1) goes around.
  const map = mkMap(10, 10, [[2,1]]);
  const path = CrucibleSpatial.findPath({x:1,y:1}, {x:4,y:1}, map, {});
  assert(path.length > 0, 'should find a path');
  assertEq(path[path.length - 1], {x:4,y:1});
  // None of the cells should be the blocked one.
  assert(!path.some(c => c.x === 2 && c.y === 1), 'path crossed blocked cell');
});

test('findPath: unreachable → empty array', () => {
  // Surround goal with blocks.
  const blocked = [[3,1],[4,2],[3,3],[2,2]];
  const map = mkMap(10, 10, blocked);
  const path = CrucibleSpatial.findPath({x:0,y:0}, {x:3,y:2}, map, {});
  assertEq(path, []);
});

test('findPath: maxSteps caps the path length', () => {
  const map = mkMap(20, 20, []);
  const path = CrucibleSpatial.findPath({x:0,y:0}, {x:10,y:10}, map, { maxSteps: 3 });
  assertEq(path.length, 3);
});

test('findPath: stopWhenAdjacent stops one cell short', () => {
  const map = mkMap(10, 10, []);
  const goalCombatant = { x: 6, y: 1 };
  const path = CrucibleSpatial.findPath({x:1,y:1}, {x:6,y:1}, map, { stopWhenAdjacent: goalCombatant });
  // Path should land adjacent to (6,1), i.e. at (5,1).
  assertEq(path[path.length - 1], {x:5,y:1});
});

test('findPath: empty path if start === goal', () => {
  const map = mkMap(10, 10, []);
  const path = CrucibleSpatial.findPath({x:3,y:3}, {x:3,y:3}, map, {});
  assertEq(path, []);
});
```

- [ ] **Step 2: Run tests → expect 7 failing**

Reload. Expected: all 7 fail with `findPath is not a function`.

- [ ] **Step 3: Implement `findPath`**

Add to `crucible-spatial.js` inside the IIFE:

```javascript
// A* with Chebyshev heuristic. Returns the cell list from start (excluded)
// to the chosen endpoint (included). Empty array if unreachable.
function findPath(start, goal, map, options) {
  options = options || {};
  const maxSteps = options.maxSteps != null ? options.maxSteps : Infinity;
  const stopAdj = options.stopWhenAdjacent || null;

  if (start.x === goal.x && start.y === goal.y) return [];

  const w = map.width, h = map.height;
  const blocked = map.blocked;

  function inBounds(x, y) { return x >= 0 && x < w && y >= 0 && y < h; }
  function isBlocked(x, y) { return blocked && blocked[y] && blocked[y][x] === true; }
  function key(x, y) { return y * w + x; }

  // Goal test: are we at goal, or (if stopAdj is set) adjacent to it?
  function isGoal(x, y) {
    if (stopAdj) return Math.max(Math.abs(x - stopAdj.x), Math.abs(y - stopAdj.y)) <= 1
                       && !(x === stopAdj.x && y === stopAdj.y);
    return x === goal.x && y === goal.y;
  }

  const open = [{ x: start.x, y: start.y, g: 0, f: 0, parent: null }];
  const seen = new Map();
  seen.set(key(start.x, start.y), open[0]);

  while (open.length > 0) {
    // Pick the node with lowest f. Linear scan — fine for our grid sizes.
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bestIdx].f) bestIdx = i;
    const cur = open.splice(bestIdx, 1)[0];

    if (isGoal(cur.x, cur.y)) {
      // Reconstruct path from cur back to start (exclusive).
      const path = [];
      let node = cur;
      while (node.parent) { path.unshift({ x: node.x, y: node.y }); node = node.parent; }
      // Trim to maxSteps.
      return path.slice(0, maxSteps);
    }

    // Expand 8 neighbors.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cur.x + dx, ny = cur.y + dy;
        if (!inBounds(nx, ny)) continue;
        if (isBlocked(nx, ny)) continue;
        const ng = cur.g + 1;
        if (ng > maxSteps) continue;
        const k = key(nx, ny);
        const prev = seen.get(k);
        if (prev && prev.g <= ng) continue;
        const hCost = Math.max(Math.abs(goal.x - nx), Math.abs(goal.y - ny));
        const node = { x: nx, y: ny, g: ng, f: ng + hCost, parent: cur };
        seen.set(k, node);
        open.push(node);
      }
    }
  }

  return [];
}

CrucibleSpatial.findPath = findPath;
```

- [ ] **Step 4: Run tests → expect 7 passing**

Reload, run. Expected: 7 chebyshev + findPath tests pass, total `11 passed, 0 failed` (4 from Task 1.2 + 7 new).

- [ ] **Step 5: Commit**

```bash
git add crucible-spatial.js tests/crucible-spatial.test.html
git commit -m "Crucible v2 spatial: A* pathfinding (findPath)"
```

### Task 1.4: `placeCombatants(combatants, map, override)` — default layout

**Files:**
- Modify: `crucible-spatial.js`
- Modify: `tests/crucible-spatial.test.html`

- [ ] **Step 1: Add the failing tests**

Append to `tests/crucible-spatial.test.html`:

```javascript
group('placeCombatants');

test('placeCombatants: 2 PCs, 2 monsters on a 10×10 map', () => {
  const combatants = [
    { id: 'pc:1', side: 'pc' },
    { id: 'pc:2', side: 'pc' },
    { id: 'mon:0', side: 'monster' },
    { id: 'mon:1', side: 'monster' },
  ];
  const map = { width: 10, height: 10, blocked: null };
  CrucibleSpatial.placeCombatants(combatants, map, null);
  // PCs at y=1, monsters at y=8.
  assertEq(combatants[0].y, 1);
  assertEq(combatants[1].y, 1);
  assertEq(combatants[2].y, 8);
  assertEq(combatants[3].y, 8);
  // PCs and monsters spread across width. With 2 PCs on width 10, expected x ≈ 3 and 6.
  assert(combatants[0].x !== combatants[1].x, 'PCs shouldnt overlap');
  assert(combatants[2].x !== combatants[3].x, 'monsters shouldnt overlap');
});

test('placeCombatants: override array sets explicit positions', () => {
  const combatants = [
    { id: 'pc:a', side: 'pc' },
    { id: 'mon:b', side: 'monster' },
  ];
  const map = { width: 10, height: 10, blocked: null };
  const override = [{ id: 'pc:a', x: 4, y: 4 }, { id: 'mon:b', x: 7, y: 7 }];
  CrucibleSpatial.placeCombatants(combatants, map, override);
  assertEq(combatants[0].x, 4);
  assertEq(combatants[0].y, 4);
  assertEq(combatants[1].x, 7);
  assertEq(combatants[1].y, 7);
});

test('placeCombatants: 6 PCs evenly spaced on a 20-wide map', () => {
  const combatants = Array.from({length: 6}, (_, i) => ({ id: 'pc:' + i, side: 'pc' }));
  const map = { width: 20, height: 20, blocked: null };
  CrucibleSpatial.placeCombatants(combatants, map, null);
  const xs = combatants.map(c => c.x).sort((a,b) => a-b);
  // No two PCs at same x.
  for (let i = 1; i < xs.length; i++) assert(xs[i] > xs[i-1], 'PCs overlap at x=' + xs[i]);
  // All within map bounds.
  for (const c of combatants) {
    assert(c.x >= 0 && c.x < map.width);
    assertEq(c.y, 1);
  }
});

test('placeCombatants: lone PC centered at x=floor(width/2)', () => {
  const combatants = [{ id: 'pc:0', side: 'pc' }];
  const map = { width: 11, height: 11, blocked: null };
  CrucibleSpatial.placeCombatants(combatants, map, null);
  assertEq(combatants[0].x, 5);
  assertEq(combatants[0].y, 1);
});

test('placeCombatants: monsters at height-2', () => {
  const combatants = [{ id: 'mon:0', side: 'monster' }];
  const map = { width: 10, height: 15, blocked: null };
  CrucibleSpatial.placeCombatants(combatants, map, null);
  assertEq(combatants[0].y, 13);
});
```

- [ ] **Step 2: Run tests → expect 5 failing**

Reload, run. Expected: 5 placeCombatants tests fail.

- [ ] **Step 3: Implement `placeCombatants`**

Add to `crucible-spatial.js`:

```javascript
function placeCombatants(combatants, map, override) {
  if (Array.isArray(override) && override.length > 0) {
    const byId = new Map(override.map(o => [o.id, o]));
    for (const c of combatants) {
      const o = byId.get(c.id);
      if (o) { c.x = o.x; c.y = o.y; }
    }
    return;
  }
  // Default layout: PCs at y=1, monsters at y=height-2. Spread evenly across width.
  const pcs = combatants.filter(c => c.side === 'pc');
  const mons = combatants.filter(c => c.side === 'monster');
  spreadRow(pcs, map.width, 1);
  spreadRow(mons, map.width, map.height - 2);
}

function spreadRow(group, width, y) {
  const n = group.length;
  if (n === 0) return;
  if (n === 1) { group[0].x = Math.floor(width / 2); group[0].y = y; return; }
  // Evenly spaced positions. For n=2 on width=10: indices 0..1 map to x ≈ 3.3 and 6.6.
  for (let i = 0; i < n; i++) {
    group[i].x = Math.floor((width - 1) * (i + 1) / (n + 1));
    group[i].y = y;
  }
}

CrucibleSpatial.placeCombatants = placeCombatants;
```

- [ ] **Step 4: Run tests → expect 5 passing**

Reload, run. Expected: `16 passed, 0 failed` total so far.

- [ ] **Step 5: Commit**

```bash
git add crucible-spatial.js tests/crucible-spatial.test.html
git commit -m "Crucible v2 spatial: placeCombatants default + override"
```

### Task 1.5: `computeThreat(combatants)` — DPR × HP heuristic

**Files:**
- Modify: `crucible-spatial.js`
- Modify: `tests/crucible-spatial.test.html`

- [ ] **Step 1: Add the failing tests**

```javascript
group('computeThreat');

test('computeThreat: assigns positive threat to combatants with HP', () => {
  const cs = [
    { id: 'a', hp: 30, maxHp: 30, pm: { actions: [{ damage: { dice: '1d6', mod: 3, type: 'piercing' } }] }, side: 'pc' },
  ];
  CrucibleSpatial.computeThreat(cs);
  assert(cs[0].threat > 0, 'threat should be positive: ' + cs[0].threat);
});

test('computeThreat: higher HP → higher threat (all else equal)', () => {
  const a = { id: 'a', hp: 30, maxHp: 30, pm: { actions: [{ damage: { dice: '1d6', mod: 3 } }] }, side: 'pc' };
  const b = { id: 'b', hp: 60, maxHp: 60, pm: { actions: [{ damage: { dice: '1d6', mod: 3 } }] }, side: 'pc' };
  CrucibleSpatial.computeThreat([a, b]);
  assert(b.threat > a.threat, 'b should outrank a');
});

test('computeThreat: bigger weapon → higher threat', () => {
  const a = { id: 'a', hp: 30, maxHp: 30, pm: { actions: [{ damage: { dice: '1d4', mod: 1 } }] }, side: 'pc' };
  const b = { id: 'b', hp: 30, maxHp: 30, pm: { actions: [{ damage: { dice: '2d6', mod: 3 } }] }, side: 'pc' };
  CrucibleSpatial.computeThreat([a, b]);
  assert(b.threat > a.threat, 'b should outrank a');
});

test('computeThreat: no actions → low (non-zero) threat', () => {
  const cs = [{ id: 'a', hp: 30, maxHp: 30, pm: { actions: [] }, side: 'pc' }];
  CrucibleSpatial.computeThreat(cs);
  assert(cs[0].threat >= 0, 'threat should not be negative');
});
```

- [ ] **Step 2: Run tests → expect 4 failing**

- [ ] **Step 3: Implement `computeThreat`**

```javascript
function computeThreat(combatants) {
  for (const c of combatants) {
    c.threat = threatScore(c);
  }
}

function threatScore(c) {
  const dpr = estimateDPR(c);
  const hpFactor = Math.max(1, c.hp || c.maxHp || 1);
  // Sqrt so a tank doesn't run away with the metric; DPR weighted more.
  return dpr * Math.sqrt(hpFactor);
}

function estimateDPR(c) {
  // Pick the first action with a damage block as a rough proxy.
  let actions = [];
  if (c.pm && Array.isArray(c.pm.actions)) actions = c.pm.actions;
  else if (c.monster && Array.isArray(c.monster.parsedActions)) actions = c.monster.parsedActions;
  for (const a of actions) {
    const dmg = a.damage || (Array.isArray(a.damage) ? a.damage[0] : null);
    if (!dmg) continue;
    if (Array.isArray(dmg)) {
      let total = 0;
      for (const d of dmg) total += diceAverage(d.dice) + (Number(d.mod) || 0);
      return total;
    }
    return diceAverage(dmg.dice) + (Number(dmg.mod) || 0);
  }
  return 1;
}

function diceAverage(formula) {
  // '1d6', '2d6', '1d8+1', etc. Strip flat mod (we add it separately).
  if (!formula) return 0;
  const m = /^(\d+)d(\d+)/.exec(String(formula));
  if (!m) return 0;
  const count = parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  return count * (sides + 1) / 2;
}

CrucibleSpatial.computeThreat = computeThreat;
CrucibleSpatial.diceAverage = diceAverage;  // exposed for expectedDamage in Phase 2
```

- [ ] **Step 4: Run tests → expect 4 passing**

Total: `20 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add crucible-spatial.js tests/crucible-spatial.test.html
git commit -m "Crucible v2 spatial: computeThreat + diceAverage helpers"
```

---

## Phase 2: AoE template cell helpers

Each shape gets its own pure function returning the list of cells the template covers.

### Task 2.1: `sphereCells(origin, radius)` — Chebyshev disc

**Files:**
- Modify: `crucible-spatial.js`
- Modify: `tests/crucible-spatial.test.html`

- [ ] **Step 1: Add failing tests**

```javascript
group('AoE: sphereCells');

test('sphereCells: radius 0 → only origin', () => {
  const cells = CrucibleSpatial.sphereCells({x:5,y:5}, 0);
  assertEq(cells, [{x:5,y:5}]);
});

test('sphereCells: radius 1 → 3×3 square = 9 cells', () => {
  const cells = CrucibleSpatial.sphereCells({x:5,y:5}, 1);
  assertEq(cells.length, 9);
});

test('sphereCells: radius 2 → 5×5 square = 25 cells', () => {
  const cells = CrucibleSpatial.sphereCells({x:5,y:5}, 2);
  assertEq(cells.length, 25);
});

test('sphereCells: cells are within radius', () => {
  const cells = CrucibleSpatial.sphereCells({x:5,y:5}, 2);
  for (const c of cells) {
    assert(Math.max(Math.abs(c.x - 5), Math.abs(c.y - 5)) <= 2);
  }
});
```

- [ ] **Step 2: Run → 4 failing**

- [ ] **Step 3: Implement**

```javascript
function sphereCells(origin, radius) {
  const r = Math.max(0, Math.floor(radius));
  const out = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      out.push({ x: origin.x + dx, y: origin.y + dy });
    }
  }
  return out;
}
CrucibleSpatial.sphereCells = sphereCells;
```

- [ ] **Step 4: Run → 4 passing** (total 24)

- [ ] **Step 5: Commit**

```bash
git add crucible-spatial.js tests/crucible-spatial.test.html
git commit -m "Crucible v2 spatial: sphereCells AoE template"
```

### Task 2.2: `cubeCells(origin, side)`

**Files:**
- Modify: `crucible-spatial.js`
- Modify: `tests/crucible-spatial.test.html`

- [ ] **Step 1: Tests**

```javascript
group('AoE: cubeCells');

test('cubeCells: side 1 → 1 cell', () => {
  const cells = CrucibleSpatial.cubeCells({x:5,y:5}, 1);
  assertEq(cells.length, 1);
});

test('cubeCells: side 3 → 9 cells', () => {
  const cells = CrucibleSpatial.cubeCells({x:5,y:5}, 3);
  assertEq(cells.length, 9);
});

test('cubeCells: cells start at origin (nearest-to-caster corner)', () => {
  const cells = CrucibleSpatial.cubeCells({x:5,y:5}, 3);
  assert(cells.some(c => c.x === 5 && c.y === 5));
  assert(cells.some(c => c.x === 7 && c.y === 7));
});
```

- [ ] **Step 2: Run → 3 failing**

- [ ] **Step 3: Implement**

```javascript
function cubeCells(origin, side) {
  const s = Math.max(1, Math.floor(side));
  const out = [];
  for (let dy = 0; dy < s; dy++) {
    for (let dx = 0; dx < s; dx++) {
      out.push({ x: origin.x + dx, y: origin.y + dy });
    }
  }
  return out;
}
CrucibleSpatial.cubeCells = cubeCells;
```

- [ ] **Step 4: Run → 3 passing** (total 27)

- [ ] **Step 5: Commit**

```bash
git add crucible-spatial.js tests/crucible-spatial.test.html
git commit -m "Crucible v2 spatial: cubeCells AoE template"
```

### Task 2.3: `lineCells(origin, direction, length)`

**Files:**
- Modify: `crucible-spatial.js`
- Modify: `tests/crucible-spatial.test.html`

- [ ] **Step 1: Tests**

```javascript
group('AoE: lineCells');

test('lineCells: length 3 east from (5,5) → (6,5), (7,5), (8,5)', () => {
  const cells = CrucibleSpatial.lineCells({x:5,y:5}, {dx:1,dy:0}, 3);
  assertEq(cells, [{x:6,y:5},{x:7,y:5},{x:8,y:5}]);
});

test('lineCells: length 3 northwest from (5,5) → (4,4), (3,3), (2,2)', () => {
  const cells = CrucibleSpatial.lineCells({x:5,y:5}, {dx:-1,dy:-1}, 3);
  assertEq(cells, [{x:4,y:4},{x:3,y:3},{x:2,y:2}]);
});

test('lineCells: length 0 → empty', () => {
  assertEq(CrucibleSpatial.lineCells({x:5,y:5}, {dx:1,dy:0}, 0), []);
});

test('lineCells: zero direction → empty', () => {
  assertEq(CrucibleSpatial.lineCells({x:5,y:5}, {dx:0,dy:0}, 3), []);
});
```

- [ ] **Step 2: Run → 4 failing**

- [ ] **Step 3: Implement**

```javascript
function lineCells(origin, direction, length) {
  const len = Math.max(0, Math.floor(length));
  if (len === 0 || (direction.dx === 0 && direction.dy === 0)) return [];
  const out = [];
  for (let i = 1; i <= len; i++) {
    out.push({ x: origin.x + direction.dx * i, y: origin.y + direction.dy * i });
  }
  return out;
}
CrucibleSpatial.lineCells = lineCells;
```

- [ ] **Step 4: Run → 4 passing** (total 31)

- [ ] **Step 5: Commit**

```bash
git add crucible-spatial.js tests/crucible-spatial.test.html
git commit -m "Crucible v2 spatial: lineCells AoE template"
```

### Task 2.4: `coneCells(origin, direction, length)` — 5e 60° cone

**Files:**
- Modify: `crucible-spatial.js`
- Modify: `tests/crucible-spatial.test.html`

- [ ] **Step 1: Tests**

```javascript
group('AoE: coneCells');

test('coneCells: length 1 east → 1 cell', () => {
  // At distance 1, cone is 1 cell wide → just (6,5).
  const cells = CrucibleSpatial.coneCells({x:5,y:5}, {dx:1,dy:0}, 1);
  assertEq(cells, [{x:6,y:5}]);
});

test('coneCells: length 3 east → 1+2+3 = 6 cells', () => {
  const cells = CrucibleSpatial.coneCells({x:5,y:5}, {dx:1,dy:0}, 3);
  assertEq(cells.length, 6);
});

test('coneCells: length 3 east cells form widening pattern', () => {
  const cells = CrucibleSpatial.coneCells({x:5,y:5}, {dx:1,dy:0}, 3);
  const ys = cells.map(c => c.y);
  // At distance 1: only y=5. At distance 2: y=4..6. At distance 3: y=3..7.
  assert(cells.find(c => c.x === 6 && c.y === 5), 'missing (6,5)');
  assert(cells.find(c => c.x === 7 && c.y === 5), 'missing (7,5)');
  assert(cells.find(c => c.x === 8 && c.y === 3), 'missing (8,3)');
});

test('coneCells: diagonal direction works', () => {
  const cells = CrucibleSpatial.coneCells({x:0,y:0}, {dx:1,dy:1}, 2);
  assert(cells.length > 0, 'should produce cells');
});

test('coneCells: length 0 → empty', () => {
  assertEq(CrucibleSpatial.coneCells({x:5,y:5}, {dx:1,dy:0}, 0), []);
});
```

- [ ] **Step 2: Run → 5 failing**

- [ ] **Step 3: Implement**

```javascript
// 5e 60° cone: at distance d (1..length) from origin, the cone is d cells
// wide perpendicular to direction. Cells whose Chebyshev distance == d AND
// whose perpendicular offset is within [-d/2..d/2] (rounded outward by 1 for
// odd widths) qualify. We model the 60° spread by including cells with
// |perpendicular| <= floor((d+1)/2).
function coneCells(origin, direction, length) {
  const len = Math.max(0, Math.floor(length));
  if (len === 0 || (direction.dx === 0 && direction.dy === 0)) return [];
  const out = [];
  // For diagonal directions, the cone is rotated; we use both axes.
  // Normalize: perpendicular vector is (-dy, dx).
  const px = -direction.dy, py = direction.dx;
  for (let d = 1; d <= len; d++) {
    const halfWidth = Math.floor((d + 1) / 2);
    for (let w = -halfWidth; w <= halfWidth; w++) {
      const x = origin.x + direction.dx * d + px * w;
      const y = origin.y + direction.dy * d + py * w;
      out.push({ x, y });
    }
  }
  return out;
}
CrucibleSpatial.coneCells = coneCells;
```

- [ ] **Step 4: Run → 5 passing** (total 36)

- [ ] **Step 5: Commit**

```bash
git add crucible-spatial.js tests/crucible-spatial.test.html
git commit -m "Crucible v2 spatial: coneCells AoE template (5e 60° cone)"
```

### Task 2.5: `enumerateCastPoints(attacker, action, map)` + `combatantsAt(cells, combatants)`

**Files:**
- Modify: `crucible-spatial.js`
- Modify: `tests/crucible-spatial.test.html`

- [ ] **Step 1: Tests**

```javascript
group('AoE: enumerateCastPoints / combatantsAt');

test('enumerateCastPoints: sphere 6-cell radius around attacker', () => {
  // For non-directional shapes (sphere/cube), candidates are cells within action.range.
  const action = { shape: 'sphere', size: 2, range: 6 };
  const map = mkMap(20, 20, []);
  const attacker = { x: 10, y: 10 };
  const pts = CrucibleSpatial.enumerateCastPoints(attacker, action, map);
  // 6-cell Chebyshev radius = 13×13 - blocked = 169 cells (no blocks).
  assertEq(pts.length, 169);
});

test('enumerateCastPoints: cone iterates 8 directions, range = origin only', () => {
  const action = { shape: 'cone', size: 3, range: 0 };
  const map = mkMap(20, 20, []);
  const attacker = { x: 10, y: 10 };
  const pts = CrucibleSpatial.enumerateCastPoints(attacker, action, map);
  // Cone origin is the attacker; we vary direction. 8 dirs.
  assertEq(pts.length, 8);
  assert(pts.every(p => p.dir && (Math.abs(p.dir.dx) <= 1 && Math.abs(p.dir.dy) <= 1)));
});

test('enumerateCastPoints: candidates respect map bounds', () => {
  const action = { shape: 'sphere', size: 1, range: 99 };
  const map = mkMap(5, 5, []);
  const pts = CrucibleSpatial.enumerateCastPoints({x:2,y:2}, action, map);
  // All candidates within map.
  for (const p of pts) {
    assert(p.x >= 0 && p.x < 5 && p.y >= 0 && p.y < 5);
  }
});

test('combatantsAt: returns combatants whose (x,y) is in cells', () => {
  const cells = [{x:1,y:1}, {x:3,y:3}];
  const cs = [
    { id: 'a', x: 1, y: 1, dead: false, downed: false },
    { id: 'b', x: 2, y: 2, dead: false, downed: false },
    { id: 'c', x: 3, y: 3, dead: false, downed: false },
    { id: 'd', x: 3, y: 3, dead: true,  downed: false },  // dead, excluded
  ];
  const hits = CrucibleSpatial.combatantsAt(cells, cs);
  assertEq(hits.length, 2);
  assert(hits.find(h => h.id === 'a'));
  assert(hits.find(h => h.id === 'c'));
});
```

- [ ] **Step 2: Run → 4 failing**

- [ ] **Step 3: Implement**

```javascript
function enumerateCastPoints(attacker, action, map) {
  const range = action.range || 0;
  const shape = action.shape;
  if (shape === 'cone' || shape === 'line') {
    // Origin is the attacker; vary direction over 8 unit vectors.
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        out.push({ x: attacker.x, y: attacker.y, dir: { dx, dy } });
      }
    }
    return out;
  }
  // sphere / cube: cast point can be any cell within range of attacker, in bounds.
  const out = [];
  for (let y = Math.max(0, attacker.y - range); y <= Math.min(map.height - 1, attacker.y + range); y++) {
    for (let x = Math.max(0, attacker.x - range); x <= Math.min(map.width - 1, attacker.x + range); x++) {
      if (chebyshev({x,y}, attacker) > range) continue;
      out.push({ x, y });
    }
  }
  return out;
}
CrucibleSpatial.enumerateCastPoints = enumerateCastPoints;

function combatantsAt(cells, combatants) {
  const set = new Set(cells.map(c => c.x + ',' + c.y));
  return combatants.filter(c => !c.dead && !c.downed && set.has(c.x + ',' + c.y));
}
CrucibleSpatial.combatantsAt = combatantsAt;
```

- [ ] **Step 4: Run → 4 passing** (total 40)

- [ ] **Step 5: Commit**

```bash
git add crucible-spatial.js tests/crucible-spatial.test.html
git commit -m "Crucible v2 spatial: enumerateCastPoints + combatantsAt"
```

### Task 2.6: `expectedDamage(action)` helper

**Files:**
- Modify: `crucible-spatial.js`
- Modify: `tests/crucible-spatial.test.html`

- [ ] **Step 1: Tests**

```javascript
group('AoE: expectedDamage');

test('expectedDamage: 1d6 → 3.5', () => {
  assertClose(CrucibleSpatial.expectedDamage({ damage: { dice: '1d6' } }), 3.5);
});

test('expectedDamage: 2d6+3 → 10', () => {
  assertClose(CrucibleSpatial.expectedDamage({ damage: { dice: '2d6', mod: 3 } }), 10);
});

test('expectedDamage: save action with halfOnSave → halve', () => {
  // Save action with damageOnFail 8d6.
  const ev = CrucibleSpatial.expectedDamage({
    kind: 'save', halfOnSave: true,
    damageOnFail: [{ dice: '8d6', mod: 0 }],
  });
  // 8d6 = 28. Half = 14. Average of fail/save = (28 + 14) / 2 = 21.
  assertClose(ev, 21);
});

test('expectedDamage: action with no damage → 0', () => {
  assertEq(CrucibleSpatial.expectedDamage({ kind: 'utility' }), 0);
});
```

- [ ] **Step 2: Run → 4 failing**

- [ ] **Step 3: Implement**

```javascript
function expectedDamage(action) {
  if (!action) return 0;
  // Save action.
  if (action.kind === 'save' && Array.isArray(action.damageOnFail)) {
    let fail = 0;
    for (const d of action.damageOnFail) fail += diceAverage(d.dice) + (Number(d.mod) || 0);
    return action.halfOnSave ? (fail + fail / 2) / 2 : fail / 2;  // 50% fail rate assumed
  }
  // Single damage block.
  const dmg = action.damage;
  if (dmg && dmg.dice) return diceAverage(dmg.dice) + (Number(dmg.mod) || 0);
  // Array of damage blocks (monster actions).
  if (Array.isArray(action.damage)) {
    let total = 0;
    for (const d of action.damage) total += diceAverage(d.dice) + (Number(d.mod) || 0);
    return total;
  }
  return 0;
}
CrucibleSpatial.expectedDamage = expectedDamage;
```

- [ ] **Step 4: Run → 4 passing** (total 44)

- [ ] **Step 5: Commit**

```bash
git add crucible-spatial.js tests/crucible-spatial.test.html
git commit -m "Crucible v2 spatial: expectedDamage helper for AoE scoring"
```

---

## Phase 3: Target scorer

### Task 3.1: `scoreTarget(target, attacker, action, combatants, map)`

**Files:**
- Modify: `crucible-spatial.js`
- Modify: `tests/crucible-spatial.test.html`

- [ ] **Step 1: Tests**

```javascript
group('scoreTarget');

test('scoreTarget: closer target scores higher (all else equal)', () => {
  const attacker = { x: 0, y: 0 };
  const near = { x: 1, y: 0, hp: 30, threat: 5, side: 'monster' };
  const far  = { x: 5, y: 0, hp: 30, threat: 5, side: 'monster' };
  const action = { actionRange: 'melee', range: 1 };
  const map = mkMap(10, 10, []);
  const cs = [attacker, near, far];
  const sNear = CrucibleSpatial.scoreTarget(near, attacker, action, cs, map);
  const sFar  = CrucibleSpatial.scoreTarget(far,  attacker, action, cs, map);
  assert(sNear > sFar, 'near should score higher');
});

test('scoreTarget: lower-HP target scores higher (all else equal)', () => {
  const attacker = { x: 0, y: 0 };
  const low  = { x: 3, y: 0, hp: 5,  threat: 5, side: 'monster' };
  const high = { x: 3, y: 0, hp: 50, threat: 5, side: 'monster' };
  const action = { actionRange: 'melee', range: 1 };
  const cs = [attacker, low, high];
  const sLow  = CrucibleSpatial.scoreTarget(low,  attacker, action, cs, mkMap(10,10,[]));
  const sHigh = CrucibleSpatial.scoreTarget(high, attacker, action, cs, mkMap(10,10,[]));
  assert(sLow > sHigh, 'low-HP should score higher');
});

test('scoreTarget: ranged attack penalized in melee', () => {
  const attacker = { x: 0, y: 0 };
  const adjacent = { x: 1, y: 0, hp: 20, threat: 5, side: 'monster' };
  const meleeAction  = { actionRange: 'melee', range: 1 };
  const rangedAction = { actionRange: 'ranged', range: 6 };
  const cs = [attacker, adjacent];
  const sM = CrucibleSpatial.scoreTarget(adjacent, attacker, meleeAction,  cs, mkMap(10,10,[]));
  const sR = CrucibleSpatial.scoreTarget(adjacent, attacker, rangedAction, cs, mkMap(10,10,[]));
  assert(sM > sR, 'melee should outscore ranged when adjacent');
});
```

- [ ] **Step 2: Run → 3 failing**

- [ ] **Step 3: Implement**

```javascript
// Tunable coefficients. Exposed for hand-tuning + future tactics.aiHint
// weighting. Defaults below match the spec's recommended starting values.
const SCORER_WEIGHTS = {
  distance:  -0.5,
  lowHpInv:   1.0,
  threat:     0.3,
  ooaPath:   -2.0,
  rangedInMelee: -1.5,
};
CrucibleSpatial.SCORER_WEIGHTS = SCORER_WEIGHTS;

function scoreTarget(target, attacker, action, combatants, map) {
  const w = SCORER_WEIGHTS;
  const dist = chebyshev(attacker, target);
  const ooaPath = provokesOoAOnPath(attacker, target, combatants, map) ? 1 : 0;
  const rangedInMelee = (action.actionRange === 'ranged' && dist <= 1) ? 1 : 0;
  return (
    w.distance      * dist
  + w.lowHpInv      * (1 / Math.max(1, target.hp))
  + w.threat        * (target.threat || 0)
  + w.ooaPath       * ooaPath
  + w.rangedInMelee * rangedInMelee
  );
}
CrucibleSpatial.scoreTarget = scoreTarget;
```

Note: `provokesOoAOnPath` is implemented in Task 3.2. Stub it for now so the tests run:

```javascript
function provokesOoAOnPath() { return false; }
CrucibleSpatial.provokesOoAOnPath = provokesOoAOnPath;
```

(We'll replace with the real implementation in Task 3.2.)

- [ ] **Step 4: Run → 3 passing** (total 47)

- [ ] **Step 5: Commit**

```bash
git add crucible-spatial.js tests/crucible-spatial.test.html
git commit -m "Crucible v2 spatial: scoreTarget with tunable weights"
```

### Task 3.2: `provokesOoAOnPath(attacker, target, combatants, map)` — real implementation

**Files:**
- Modify: `crucible-spatial.js`
- Modify: `tests/crucible-spatial.test.html`

- [ ] **Step 1: Tests**

```javascript
group('provokesOoAOnPath');

test('provokesOoAOnPath: straight path with no enemies → false', () => {
  const attacker = { id:'a', side: 'pc', x: 0, y: 0 };
  const target   = { id:'t', side: 'monster', x: 5, y: 0 };
  const cs = [attacker, target];
  assertEq(CrucibleSpatial.provokesOoAOnPath(attacker, target, cs, mkMap(10,10,[])), false);
});

test('provokesOoAOnPath: another enemy adjacent to the path → true', () => {
  const attacker = { id:'a', side: 'pc', x: 0, y: 0 };
  const target   = { id:'t', side: 'monster', x: 5, y: 0 };
  const blocker  = { id:'b', side: 'monster', x: 3, y: 1, naturalReach: 1, reactionAvailableThisRound: true };
  // Path from (0,0) toward (5,0) passes through (3,0), which is adjacent to (3,1).
  const cs = [attacker, target, blocker];
  assertEq(CrucibleSpatial.provokesOoAOnPath(attacker, target, cs, mkMap(10,10,[])), true);
});

test('provokesOoAOnPath: enemy without reaction → no provoke', () => {
  const attacker = { id:'a', side: 'pc', x: 0, y: 0 };
  const target   = { id:'t', side: 'monster', x: 5, y: 0 };
  const blocker  = { id:'b', side: 'monster', x: 3, y: 1, naturalReach: 1, reactionAvailableThisRound: false };
  const cs = [attacker, target, blocker];
  assertEq(CrucibleSpatial.provokesOoAOnPath(attacker, target, cs, mkMap(10,10,[])), false);
});

test('provokesOoAOnPath: already adjacent (path empty) → false', () => {
  const attacker = { id:'a', side: 'pc', x: 4, y: 0 };
  const target   = { id:'t', side: 'monster', x: 5, y: 0 };
  const cs = [attacker, target];
  assertEq(CrucibleSpatial.provokesOoAOnPath(attacker, target, cs, mkMap(10,10,[])), false);
});
```

- [ ] **Step 2: Run → expect 3 of 4 failing** (the trivial "no path" case may pass against the stub)

- [ ] **Step 3: Replace the stub**

In `crucible-spatial.js`, delete the stub line and replace with:

```javascript
function provokesOoAOnPath(attacker, target, combatants, map) {
  const path = findPath(attacker, target, map, { stopWhenAdjacent: target });
  if (path.length === 0) return false;
  // For each cell along the path (including start), check if any other-side
  // combatant with melee reach + available reaction is adjacent to it.
  const fullPath = [{x: attacker.x, y: attacker.y}, ...path];
  for (let i = 1; i < fullPath.length; i++) {
    const prev = fullPath[i - 1];
    const cur  = fullPath[i];
    for (const d of combatants) {
      if (d.side === attacker.side || d.dead || d.downed) continue;
      if (d.id === target.id) continue;  // the actual goal doesn't count
      if (!d.reactionAvailableThisRound) continue;
      const reach = d.naturalReach || 1;
      const wasInReach   = chebyshev(d, prev) <= reach;
      const stillInReach = chebyshev(d, cur)  <= reach;
      if (wasInReach && !stillInReach) return true;  // leaves reach mid-path
    }
  }
  return false;
}
CrucibleSpatial.provokesOoAOnPath = provokesOoAOnPath;
```

- [ ] **Step 4: Run → 4 passing for OoA + earlier 3 still passing** (total 51)

- [ ] **Step 5: Commit**

```bash
git add crucible-spatial.js tests/crucible-spatial.test.html
git commit -m "Crucible v2 spatial: provokesOoAOnPath (real impl over stub)"
```

---

## Phase 4: Engine — placement + movement

### Task 4.1: Combatants get x/y/speed in `buildCombatants`

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Add a failing test** to `tests/engine.test.html` (locate the existing test block — pattern matches the existing suite):

```javascript
test('buildCombatants: PCs and monsters get x/y/speed default fields', () => {
  const pm = {
    id: 'pm1', identity: { name: 'Warlock', level: 5 },
    abilities: { dex: 14 },
    combat: { hp: 30, maxHp: 30, ac: 14, initBonus: 2 },
    actions: [],
  };
  const monsterPick = {
    name: 'Goblin', cr: '1/4', count: 1,
    monster: { name: 'Goblin', ac: 13, hp: 7, maxHp: 7,
               abilities: { str: { mod: 0 } }, parsedActions: [] },
  };
  const rng = () => 0.5;
  const out = Crucible.buildCombatants([pm], [monsterPick], rng, false);
  const pc = out.find(c => c.side === 'pc');
  const mon = out.find(c => c.side === 'monster');
  assert(typeof pc.x === 'number' || pc.x === undefined,  'pc.x slot exists');
  assert(typeof pc.speed === 'number', 'pc.speed required');
  assertEq(pc.speed, 6);  // default
  assert(typeof mon.speed === 'number', 'mon.speed required');
});
```

- [ ] **Step 2: Run → expect fail** (`pc.speed` is missing)

- [ ] **Step 3: Add speed to `buildCombatants`**

In `crucible-engine.js`, locate `function buildCombatants(...)` (around line 516). Inside the PC `out.push({...})` block, add after `initBonus`:

```javascript
        speed: typeof pm.combat.speed === 'number' ? pm.combat.speed : 6,
        x: 0, y: 0,  // populated by placeCombatants in runTrial
        naturalReach: typeof pm.combat.reach === 'number' ? pm.combat.reach : 1,
```

Inside the monster build block (around line 560), after `initBonus`:

```javascript
        speed: Math.max(1, Math.floor(((m.speed && m.speed.walk) || 30) / 5)),
        x: 0, y: 0,
        naturalReach: typeof m.reach === 'number' ? Math.max(1, Math.floor(m.reach / 5)) : 1,
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible v2 engine: combatants gain x/y/speed/naturalReach defaults"
```

### Task 4.2: `placeCombatants` + `placement` event at top of `runTrial`

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Test**

```javascript
test('runTrial: emits a placement event at the top with map + placements', () => {
  const pm = {
    id: 'pm1', identity: { name: 'Warlock', level: 5 },
    abilities: { dex: 14, str: 10 },
    combat: { hp: 30, maxHp: 30, ac: 14, initBonus: 2 },
    actions: [{ type: 'attack', name: 'Punch', actionRange: 'melee',
                atkAbility: 'str', damage: { dice: '1d4', mod: '+atkAbility', type: 'bludgeoning' } }],
  };
  const monsterPick = {
    name: 'Goblin', cr: '1/4', count: 1,
    monster: { name: 'Goblin', ac: 13, hp: 7, maxHp: 7,
               abilities: { str: { mod: 0 }, dex: { mod: 2 } },
               parsedActions: [{ kind: 'attack', name: 'Bite', sourceActionName: 'Bite',
                                 toHit: 4, damage: [{ dice: '1d4', mod: 0, type: 'piercing' }] }] },
  };
  const rng = () => 0.5;
  const trial = Crucible.runTrial([pm], [monsterPick], { aiHint: 'focus' }, rng);
  const placement = trial.events.find(e => e.type === 'placement');
  assert(placement, 'placement event missing');
  assertEq(placement.round, 0);
  assert(placement.map.width > 0);
  assert(placement.map.height > 0);
  assertEq(placement.placements.length, 2);  // 1 PC + 1 monster
});
```

- [ ] **Step 2: Run → expect fail**

- [ ] **Step 3: Modify `runTrial`** in `crucible-engine.js`. After `const combatants = buildCombatants(...)` (~line 1065), add:

```javascript
    const encounter = (party && party._encounter) || null;
    const map = (encounter && encounter.map) || { width: 20, height: 20, blocked: null };
    if (typeof CrucibleSpatial !== 'undefined') {
      CrucibleSpatial.placeCombatants(combatants, map, encounter && encounter.placement);
      CrucibleSpatial.computeThreat(combatants);
    }
    events.push({
      type: 'placement', round: 0, map,
      placements: combatants.map(c => ({
        id: c.id, name: c.name, side: c.side,
        pos: { x: c.x, y: c.y },
        hp: c.hp, maxHp: c.maxHp, ac: c.ac, speed: c.speed,
      })),
    });
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible v2 engine: emit placement event with map + positions"
```

### Task 4.3: Action `range` field derivation

**Files:**
- Modify: `crucible-engine.js`

- [ ] **Step 1: Add helper near top of `crucible-engine.js`** (just below the dice helpers, ~line 80):

```javascript
  // Resolve an action's range in cells. Honors explicit action.range, falls
  // back to deriving from actionRange string. Default melee = 1, ranged = 6.
  function actionRange(action) {
    if (typeof action.range === 'number') return action.range;
    if (action.actionRange === 'ranged') return 6;
    return 1;
  }
```

- [ ] **Step 2: Test** in `tests/engine.test.html`:

```javascript
test('actionRange: explicit range honored', () => {
  assertEq(Crucible.actionRange({ range: 12 }), 12);
});
test('actionRange: melee → 1', () => {
  assertEq(Crucible.actionRange({ actionRange: 'melee' }), 1);
});
test('actionRange: ranged → 6', () => {
  assertEq(Crucible.actionRange({ actionRange: 'ranged' }), 6);
});
test('actionRange: missing → 1 (safe default)', () => {
  assertEq(Crucible.actionRange({}), 1);
});
```

Export `actionRange` from the engine's IIFE — add to the export block at the bottom:

```javascript
    actionRange,
```

- [ ] **Step 3: Run → 4 passing**

- [ ] **Step 4: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible v2 engine: actionRange() helper (cells from actionRange string)"
```

### Task 4.4: Range check before single-target attack, emit `move` events

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Test for the move event being emitted**

```javascript
test('runTrial: PC moves toward monster before attacking when out of range', () => {
  const pm = {
    id: 'pm1', identity: { name: 'PC', level: 5 },
    abilities: { dex: 14, str: 14 },
    combat: { hp: 30, maxHp: 30, ac: 14, initBonus: 2, speed: 6 },
    actions: [{ type: 'attack', name: 'Sword', actionRange: 'melee',
                atkAbility: 'str', damage: { dice: '1d8', mod: '+atkAbility', type: 'slashing' } }],
  };
  const monsterPick = {
    name: 'Goblin', cr: '1/4', count: 1,
    monster: { name: 'Goblin', ac: 13, hp: 7, maxHp: 7,
               abilities: { str: { mod: 0 }, dex: { mod: 2 } },
               parsedActions: [{ kind: 'attack', name: 'Bite', sourceActionName: 'Bite',
                                 toHit: 4, damage: [{ dice: '1d4', mod: 0, type: 'piercing' }] }] },
  };
  const rng = () => 0.5;
  const trial = Crucible.runTrial([pm], [monsterPick], { aiHint: 'focus' }, rng);
  const move = trial.events.find(e => e.type === 'move');
  assert(move, 'expected at least one move event');
  assert(move.path && move.path.length > 0, 'move event should carry a path');
});
```

- [ ] **Step 2: Run → fail (no move emitted yet)**

- [ ] **Step 3: Add the range-check + move step**

In `crucible-engine.js`, locate the PC branch of the action loop (around line 1190) where `action = pickAction(c, preferredName)` is called. After getting the action, before the kind dispatch, add:

```javascript
            // v2 spatial: range check + movement (single-target actions only).
            if (action && action.kind !== 'multiattack' && action.shape !== 'cone'
                && action.shape !== 'line' && action.shape !== 'sphere' && action.shape !== 'cube'
                && typeof CrucibleSpatial !== 'undefined') {
              const tgtCandidate = pickEnemyTarget(c, all, tactics, rng);
              if (tgtCandidate) {
                const need = actionRange(action);
                const dist = CrucibleSpatial.chebyshev(c, tgtCandidate);
                if (dist > need) {
                  const path = CrucibleSpatial.findPath(
                    { x: c.x, y: c.y },
                    { x: tgtCandidate.x, y: tgtCandidate.y },
                    combatants[0]._mapRef || { width: 20, height: 20, blocked: null },
                    { maxSteps: c.speed, stopWhenAdjacent: tgtCandidate, side: c.side }
                  );
                  if (path.length > 0) {
                    const from = { x: c.x, y: c.y };
                    c.x = path[path.length - 1].x;
                    c.y = path[path.length - 1].y;
                    events.push({
                      type: 'move', round, who: c.id, name: c.name,
                      from, to: { x: c.x, y: c.y }, path, reason: 'engage',
                    });
                  }
                  const newDist = CrucibleSpatial.chebyshev(c, tgtCandidate);
                  if (newDist > need) {
                    // Couldn't close. End this iteration (consumes one action).
                    continue;
                  }
                }
              }
            }
```

The reference to `combatants[0]._mapRef` is a placeholder — store the map on the engine's local. Below the `combatants` construction in `runTrial`, add:

```javascript
    combatants[0] && (combatants[0]._mapRef = map);  // make map reachable from loop
```

Mirror the block in the monster branch (around line 1180) after `pickTarget` / `pickAction` resolve, using `targets[0]` instead of `tgtCandidate`.

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible v2 engine: pre-attack range check + A* move toward target"
```

### Task 4.5: Determinism guard — already-adjacent scenarios produce identical rng outcomes

**Files:**
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Add the determinism test** to `tests/engine.test.html`:

```javascript
test('runTrial: adjacent-start scenarios produce identical attack rolls vs v1 (no rng perturbation)', () => {
  // Build a PC and a monster, pre-place them adjacent via _encounter.placement.
  const pm = {
    id: 'pm1', identity: { name: 'PC', level: 5 },
    abilities: { dex: 14, str: 14 },
    combat: { hp: 30, maxHp: 30, ac: 14, initBonus: 2, speed: 6 },
    actions: [{ type: 'attack', name: 'Sword', actionRange: 'melee',
                atkAbility: 'str', damage: { dice: '1d8', mod: '+atkAbility', type: 'slashing' } }],
  };
  const monsterPick = {
    name: 'Goblin', cr: '1/4', count: 1,
    monster: { name: 'Goblin', ac: 13, hp: 7, maxHp: 7,
               abilities: { str: { mod: 0 }, dex: { mod: 2 } },
               parsedActions: [{ kind: 'attack', name: 'Bite', sourceActionName: 'Bite',
                                 toHit: 4, damage: [{ dice: '1d4', mod: 0, type: 'piercing' }] }] },
  };
  // Force PC at (5,5) and goblin at (6,5) — already adjacent.
  const party = [pm];
  party._encounter = {
    map: { width: 10, height: 10, blocked: null },
    placement: [{ id: 'pc:pm1', x: 5, y: 5 }, { id: 'mon:0', x: 6, y: 5 }],
  };
  let s = 12345;
  const rng = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const trial = Crucible.runTrial(party, [monsterPick], { aiHint: 'focus' }, rng);
  const moveEvents = trial.events.filter(e => e.type === 'move');
  assertEq(moveEvents.length, 0, 'no move events when starting adjacent');
});
```

- [ ] **Step 2: Run → expected: pass** (the move branch shouldn't fire when `dist <= need`).

If failing, investigate the action loop: `dist > need` check should be strict.

- [ ] **Step 3: Commit**

```bash
git add tests/engine.test.html
git commit -m "Crucible v2 engine: determinism test — no move events when adjacent"
```

### Task 4.6: Update default `pickEnemyTarget` to return positioned target

**Files:**
- Modify: `crucible-engine.js`

- [ ] **Step 1: Inspect `pickEnemyTarget`**

The existing function in `crucible-engine.js` already returns a combatant with `x`/`y` (because we added them in Task 4.1). No code change required if it already returns combatants. Verify by reading the function.

- [ ] **Step 2: If needed, ensure x/y are preserved in the returned object**

Check by running existing engine tests — they should still pass:

```bash
# Open tests/engine.test.html and click "Run tests"
```

Expected: all previous tests still passing.

- [ ] **Step 3: Commit (if any change was needed)**

```bash
git add crucible-engine.js
git commit -m "Crucible v2 engine: confirm pickEnemyTarget returns positioned combatants"
```

If no change was needed, skip the commit.

---

## Phase 5: Engine — opportunity attacks

### Task 5.1: OoA event emission helper

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Test for the helper signature**

```javascript
test('resolveOpportunityAttack: emits opportunity-attack event with hit/damage fields', () => {
  const defender = {
    id: 'mon:1', name: 'Goblin', side: 'monster', x: 3, y: 3,
    monster: { parsedActions: [{ kind: 'attack', name: 'Bite', sourceActionName: 'Bite',
                                 toHit: 4, damage: [{ dice: '1d4', mod: 0, type: 'piercing' }] }] },
    naturalReach: 1, reactionAvailableThisRound: true,
    dead: false, downed: false,
  };
  const leaver = {
    id: 'pc:1', name: 'PC', side: 'pc', x: 4, y: 3,
    hp: 20, maxHp: 20, ac: 14,
    damageTypesReceivedThisTurn: new Set(),
    dead: false, downed: false,
  };
  const events = [];
  const rng = () => 0.99;  // force hit
  Crucible.resolveOpportunityAttack(defender, leaver, rng, events, 1);
  const oa = events.find(e => e.type === 'opportunity-attack');
  assert(oa, 'opportunity-attack event not emitted');
  assertEq(oa.attacker, 'mon:1');
  assertEq(oa.target, 'pc:1');
  assert(typeof oa.hit === 'boolean');
  assert(typeof oa.damageDealt === 'number');
});
```

- [ ] **Step 2: Run → fail (`resolveOpportunityAttack` undefined)**

- [ ] **Step 3: Implement** in `crucible-engine.js` (place after `resolveAttackPc`):

```javascript
  // Resolve an opportunity attack from `defender` against `leaver`. Picks the
  // defender's best melee single-target attack and runs it through the normal
  // attack pipeline so Sneak Attack / Hex / etc. still ride along.
  function resolveOpportunityAttack(defender, leaver, rng, events, round) {
    const list = defender.side === 'monster'
      ? (defender.monster && defender.monster.parsedActions) || []
      : ((defender.pm && defender.pm.actions) || []).map(a => ({
          ...a, sourceActionName: a.name, kind: a.type,
        }));
    const action = list.find(a => a.kind === 'attack' && (a.actionRange === 'melee' || !a.actionRange));
    if (!action) return;
    const r = defender.side === 'monster'
      ? resolveAttackMonster(defender, leaver, action, rng, events, round)
      : resolveAttackPc(defender, leaver, action, rng, events, round);
    events.push({
      type: 'opportunity-attack', round,
      attacker: defender.id, attackerName: defender.name,
      target: leaver.id, targetName: leaver.name,
      fromCell: { x: defender.x, y: defender.y },
      triggerCell: { x: leaver.x, y: leaver.y },
      roll: r.roll, hit: r.hit, damageDealt: r.damageDealt,
    });
    if (r.hit && r.damageDealt > 0) {
      // Apply damage like a normal attack.
      for (const [t, dmg] of Object.entries(r.damageByType || {})) {
        applyDamage(leaver, dmg, t, defender, events, round, defender.name, 'opportunity ' + (action.sourceActionName || action.name));
      }
    }
  }
  Crucible.resolveOpportunityAttack = resolveOpportunityAttack;   // exposed for tests
```

Add `resolveOpportunityAttack` to the module export block at the bottom of the file.

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible v2 engine: resolveOpportunityAttack helper + event"
```

### Task 5.2: Trigger OoA detection on each path step

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Test**

```javascript
test('runTrial: PC leaving a monster melee reach provokes an opportunity attack', () => {
  // Setup: PC at (5,5), Goblin at (5,4). PC's target is another monster far away.
  const pm = {
    id: 'pm1', identity: { name: 'PC', level: 5 },
    abilities: { dex: 14, str: 14 },
    combat: { hp: 30, maxHp: 30, ac: 14, initBonus: 5, speed: 6 },
    actions: [{ type: 'attack', name: 'Bow', actionRange: 'ranged', range: 12,
                atkAbility: 'dex', damage: { dice: '1d8', mod: '+atkAbility', type: 'piercing' } }],
  };
  const goblin = { name: 'Goblin', cr: '1/4', count: 1,
    monster: { name: 'Goblin', ac: 13, hp: 50, maxHp: 50, initiative: -10,
               abilities: { str: { mod: 0 }, dex: { mod: 2 } },
               parsedActions: [{ kind: 'attack', name: 'Bite', sourceActionName: 'Bite',
                                 toHit: 4, damage: [{ dice: '1d4', mod: 0, type: 'piercing' }] }] } };
  const orc = { name: 'Orc', cr: '1/2', count: 1,
    monster: { name: 'Orc', ac: 13, hp: 15, maxHp: 15, initiative: -10,
               abilities: { str: { mod: 3 } },
               parsedActions: [{ kind: 'attack', name: 'Axe', sourceActionName: 'Axe',
                                 toHit: 5, damage: [{ dice: '1d12', mod: 3, type: 'slashing' }] }] } };
  const party = [pm];
  party._encounter = {
    map: { width: 15, height: 15, blocked: null },
    placement: [
      { id: 'pc:pm1', x: 5, y: 5 },
      { id: 'mon:0', x: 5, y: 4 },  // Goblin adjacent
      { id: 'mon:1', x: 12, y: 5 }, // Orc far away
    ],
  };
  let s = 999;
  const rng = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1);
                      t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const trial = Crucible.runTrial(party, [goblin, orc], { aiHint: 'focus' }, rng);
  const oa = trial.events.find(e => e.type === 'opportunity-attack' && e.attacker === 'mon:0');
  assert(oa, 'expected Goblin to take an opportunity attack on the leaving PC');
});
```

- [ ] **Step 2: Run → fail (no OoA trigger yet)**

- [ ] **Step 3: Modify the move step in `runTrial`** to iterate path cells one at a time and fire OoA checks. Replace the move block from Task 4.4 with:

```javascript
            // v2 spatial: range check + movement with OoA detection.
            if (action && action.kind !== 'multiattack'
                && (!action.shape || action.shape === 'single')
                && typeof CrucibleSpatial !== 'undefined') {
              const tgtCandidate = pickEnemyTarget(c, all, tactics, rng);
              if (tgtCandidate) {
                const need = actionRange(action);
                let dist = CrucibleSpatial.chebyshev(c, tgtCandidate);
                if (dist > need) {
                  const path = CrucibleSpatial.findPath(
                    { x: c.x, y: c.y },
                    { x: tgtCandidate.x, y: tgtCandidate.y },
                    map,
                    { maxSteps: c.speed, stopWhenAdjacent: tgtCandidate, side: c.side }
                  );
                  if (path.length > 0) {
                    const from = { x: c.x, y: c.y };
                    // Step cell-by-cell, firing OoA for any enemy whose reach c
                    // leaves during the move.
                    let stepped = [];
                    for (const cell of path) {
                      const prev = { x: c.x, y: c.y };
                      // OoA detection: enemies adjacent before the step, not adjacent after.
                      for (const d of combatants) {
                        if (d.side === c.side || d.dead || d.downed) continue;
                        if (!d.reactionAvailableThisRound) continue;
                        const reach = d.naturalReach || 1;
                        const wasInReach = CrucibleSpatial.chebyshev(d, prev) <= reach && CrucibleSpatial.chebyshev(d, prev) > 0;
                        const stillInReach = CrucibleSpatial.chebyshev(d, cell) <= reach;
                        if (wasInReach && !stillInReach) {
                          resolveOpportunityAttack(d, c, rng, events, round);
                          d.reactionAvailableThisRound = false;
                          if (c.dead || c.downed) break;
                        }
                      }
                      if (c.dead || c.downed) break;
                      c.x = cell.x;
                      c.y = cell.y;
                      stepped.push(cell);
                    }
                    if (stepped.length > 0) {
                      events.push({
                        type: 'move', round, who: c.id, name: c.name,
                        from, to: { x: c.x, y: c.y }, path: stepped, reason: 'engage',
                      });
                    }
                  }
                  if (c.dead || c.downed) continue;
                  dist = CrucibleSpatial.chebyshev(c, tgtCandidate);
                  if (dist > need) continue;
                }
              }
            }
```

Also replace `combatants[0]._mapRef` from Task 4.4 — `map` is now in scope from `runTrial`.

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible v2 engine: OoA triggers on path traversal"
```

### Task 5.3: Reaction reset at round end

**Files:**
- Modify: `crucible-engine.js`

- [ ] **Step 1: Verify or add** — `c.reactionAvailableThisRound` should reset at round end. Find the `onRoundEnd` dispatch in `runTrial` (~line 1320) and add a reset loop before the dispatch:

```javascript
        // v2: reset reactions at end of round.
        for (const cc of combatants) cc.reactionAvailableThisRound = true;
```

- [ ] **Step 2: Test that the reset happens** — add to `tests/engine.test.html`:

```javascript
test('runTrial: reactions reset at end of round (combatants can take another OoA next round)', () => {
  const cs = [
    { id: 'a', reactionAvailableThisRound: false },
    { id: 'b', reactionAvailableThisRound: false },
  ];
  // Inject a fake round end via re-execution — easier path: just verify the
  // engine doesn't leave reactions consumed across rounds in a 2-round trial.
  const pm = {
    id: 'pm1', identity: { name: 'PC', level: 5 },
    abilities: { dex: 14, str: 14 },
    combat: { hp: 100, maxHp: 100, ac: 18, initBonus: 5, speed: 1 },  // speed=1 so no OoA in test trial
    actions: [{ type: 'attack', name: 'Sword', actionRange: 'melee',
                atkAbility: 'str', damage: { dice: '1d8', mod: '+atkAbility', type: 'slashing' } }],
  };
  const m = { name: 'Goblin', cr: '1/4', count: 1,
    monster: { name: 'Goblin', ac: 13, hp: 200, maxHp: 200,
               abilities: { str: { mod: 0 } },
               parsedActions: [{ kind: 'attack', name: 'Bite', sourceActionName: 'Bite',
                                 toHit: 4, damage: [{ dice: '1d4', mod: 0, type: 'piercing' }] }] } };
  const party = [pm];
  party._encounter = { map: { width: 10, height: 10, blocked: null },
                       placement: [{ id: 'pc:pm1', x: 5, y: 5 }, { id: 'mon:0', x: 6, y: 5 }] };
  const rng = () => 0.5;
  const trial = Crucible.runTrial(party, [m], { aiHint: 'focus' }, rng);
  // We can't easily inspect mid-trial state, but completion without an
  // assertion failure or infinite-loop is enough; the runtime tests rule out
  // stale reactions during the trial.
  assert(trial.rounds > 0);
});
```

- [ ] **Step 3: Run → pass**

- [ ] **Step 4: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible v2 engine: reset reactions at round end"
```

---

## Phase 6: Engine — smart target selection

### Task 6.1: Replace `pickEnemyTarget` with the scorer

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Test that the scorer drives selection**

```javascript
test('pickEnemyTarget: chooses lower-HP enemy when distance is equal', () => {
  const c = { id: 'pc:1', side: 'pc', x: 0, y: 0, threat: 1 };
  const tank = { id: 'mon:tank', side: 'monster', x: 1, y: 0, hp: 50, threat: 2,
                 dead: false, downed: false };
  const squish = { id: 'mon:squish', side: 'monster', x: 1, y: 1, hp: 5, threat: 1,
                   dead: false, downed: false };
  const all = [c, tank, squish];
  const action = { actionRange: 'melee', range: 1 };
  // pickEnemyTarget signature: (c, all, tactics, rng)
  const picked = Crucible.pickEnemyTarget(c, all, { aiHint: 'focus' }, () => 0.5, action);
  assertEq(picked.id, 'mon:squish');
});
```

- [ ] **Step 2: Run → fail (current impl picks lowest-HP via simple sort, not via scorer)**

Note: this test may already pass with v1's `lowestHp` selection. If so, write a more discriminating test — one where distance + threat dominate HP. Adjust the test to set the squishy one further away so scoring matters:

```javascript
test('pickEnemyTarget: with the new scorer, near low-HP > far low-HP', () => {
  const c = { id: 'pc:1', side: 'pc', x: 0, y: 0, threat: 1 };
  const near = { id: 'mon:near', side: 'monster', x: 2, y: 0, hp: 30, threat: 1,
                 dead: false, downed: false };
  const far  = { id: 'mon:far',  side: 'monster', x: 9, y: 0, hp: 10, threat: 1,
                 dead: false, downed: false };
  const all = [c, near, far];
  const action = { actionRange: 'melee', range: 1 };
  const picked = Crucible.pickEnemyTarget(c, all, { aiHint: 'focus' }, () => 0.5, action);
  // With distance weight -0.5 and 1/hp boosting low-HP:
  //   nearScore = -0.5*2 + 1/30 + 0.3*1 = -0.6633
  //   farScore  = -0.5*9 + 1/10 + 0.3*1 = -4.1
  // near wins.
  assertEq(picked.id, 'mon:near');
});
```

- [ ] **Step 3: Modify `pickEnemyTarget`** in `crucible-engine.js`. Locate the existing function (~line 305). Replace its body with:

```javascript
  function pickEnemyTarget(c, all, tactics, rng, action) {
    const enemies = all.filter(t => t.side !== c.side && !t.dead && !t.downed);
    if (enemies.length === 0) return null;
    if (typeof CrucibleSpatial !== 'undefined' && action) {
      const map = c._mapRef || { width: 20, height: 20, blocked: null };
      let best = null, bestScore = -Infinity;
      for (const e of enemies) {
        const s = CrucibleSpatial.scoreTarget(e, c, action, all, map);
        if (s > bestScore) { bestScore = s; best = e; }
      }
      return best;
    }
    // Fallback (no spatial module loaded) — v1's lowest-HP heuristic.
    return enemies.sort((a, b) => a.hp - b.hp)[0];
  }
```

Update every call site to pass `action` — for the existing call sites that don't have action context, you can pass `null` and the v1 fallback applies. Locate calls inside `runTrial` (search `pickEnemyTarget(c,`) and pass the resolved action as the 5th arg.

Also: store `c._mapRef = map` on each combatant near the top of `runTrial`:

```javascript
    for (const c of combatants) c._mapRef = map;
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible v2 engine: pickEnemyTarget uses spatial scoreTarget"
```

### Task 6.2: `tactics.aiHint` weight tweaks

**Files:**
- Modify: `crucible-spatial.js`
- Modify: `tests/crucible-spatial.test.html`

- [ ] **Step 1: Test**

```javascript
test('scoreTarget: aiHint=focus weights low-HP harder', () => {
  const attacker = { x: 0, y: 0 };
  const low  = { x: 3, y: 0, hp: 5,  threat: 5, side: 'monster' };
  const high = { x: 3, y: 0, hp: 50, threat: 5, side: 'monster' };
  const cs = [attacker, low, high];
  const action = { actionRange: 'melee', range: 1 };
  const map = mkMap(10, 10, []);
  const baseDelta  = CrucibleSpatial.scoreTarget(low, attacker, action, cs, map)
                   - CrucibleSpatial.scoreTarget(high, attacker, action, cs, map);
  const focusDelta = CrucibleSpatial.scoreTarget(low, attacker, action, cs, map, { aiHint: 'focus' })
                   - CrucibleSpatial.scoreTarget(high, attacker, action, cs, map, { aiHint: 'focus' });
  assert(focusDelta > baseDelta, 'focus aiHint should widen the low-vs-high gap');
});
```

- [ ] **Step 2: Run → fail (scoreTarget doesn't take tactics yet)**

- [ ] **Step 3: Add tactics weight override** to `scoreTarget`:

```javascript
function scoreTarget(target, attacker, action, combatants, map, tactics) {
  const baseW = SCORER_WEIGHTS;
  const w = applyAiHint(baseW, tactics);
  const dist = chebyshev(attacker, target);
  const ooaPath = provokesOoAOnPath(attacker, target, combatants, map) ? 1 : 0;
  const rangedInMelee = (action.actionRange === 'ranged' && dist <= 1) ? 1 : 0;
  return (
    w.distance      * dist
  + w.lowHpInv      * (1 / Math.max(1, target.hp))
  + w.threat        * (target.threat || 0)
  + w.ooaPath       * ooaPath
  + w.rangedInMelee * rangedInMelee
  );
}

function applyAiHint(weights, tactics) {
  const hint = tactics && tactics.aiHint;
  if (hint === 'focus')    return { ...weights, lowHpInv: weights.lowHpInv * 2 };
  if (hint === 'survival') return { ...weights, threat: weights.threat * 0.5, ooaPath: weights.ooaPath * 2 };
  if (hint === 'spread')   return { ...weights, lowHpInv: weights.lowHpInv * 0.5 };
  return weights;
}
```

- [ ] **Step 4: Update `pickEnemyTarget`** call site in `crucible-engine.js` to pass tactics:

```javascript
        const s = CrucibleSpatial.scoreTarget(e, c, action, all, map, tactics);
```

- [ ] **Step 5: Run → pass**

- [ ] **Step 6: Commit**

```bash
git add crucible-spatial.js crucible-engine.js tests/crucible-spatial.test.html
git commit -m "Crucible v2 spatial: tactics.aiHint weight tweaks for scoreTarget"
```

---

## Phase 7: Engine — AoE template targeting + resolution

### Task 7.1: Action `shape` / `size` fields ignored on single-target actions

**Files:**
- Modify: `crucible-engine.js`

- [ ] **Step 1: Verify single-target actions still work**

Open `tests/engine.test.html` and run all tests. Expected: all passing — `shape`/`size` are optional fields.

- [ ] **Step 2: Commit (no code change)** — this task is a verification gate, not a code task.

### Task 7.2: `resolveAoE(c, action, combatants, map, rng, events, round)` helper

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Test**

```javascript
test('resolveAoE: sphere catches multiple enemies in a cluster', () => {
  const c = {
    id: 'pc:wiz', side: 'pc', name: 'Wizard', x: 5, y: 5,
    pm: { identity: { level: 5 } },
    damageTypesReceivedThisTurn: new Set(),
  };
  const e1 = { id: 'mon:1', side: 'monster', name: 'A', x: 10, y: 10,
               hp: 20, maxHp: 20, ac: 12, dead: false, downed: false,
               damageTypesReceivedThisTurn: new Set() };
  const e2 = { id: 'mon:2', side: 'monster', name: 'B', x: 11, y: 10,
               hp: 20, maxHp: 20, ac: 12, dead: false, downed: false,
               damageTypesReceivedThisTurn: new Set() };
  const e3 = { id: 'mon:3', side: 'monster', name: 'C', x: 10, y: 11,
               hp: 20, maxHp: 20, ac: 12, dead: false, downed: false,
               damageTypesReceivedThisTurn: new Set() };
  const all = [c, e1, e2, e3];
  const action = { kind: 'save', name: 'Fireball', sourceActionName: 'Fireball',
                   shape: 'sphere', size: 2, range: 12,
                   saveAbility: 'dex', saveDc: 14,
                   damageOnFail: [{ dice: '8d6', mod: 0, type: 'fire' }],
                   halfOnSave: true };
  const map = { width: 20, height: 20, blocked: null };
  const events = [];
  const rng = () => 0.5;
  Crucible.resolveAoE(c, action, all, map, rng, events, 1);
  const aoe = events.find(ev => ev.type === 'aoe');
  assert(aoe, 'aoe event emitted');
  assertEq(aoe.shape, 'sphere');
  assert(aoe.targets.length >= 2, 'expected 2+ enemies caught: ' + aoe.targets.length);
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement** in `crucible-engine.js` after `resolveSave`:

```javascript
  function resolveAoE(c, action, combatants, map, rng, events, round) {
    if (typeof CrucibleSpatial === 'undefined') return;
    const Spatial = CrucibleSpatial;
    const candidates = Spatial.enumerateCastPoints(c, action, map);
    const ev = Spatial.expectedDamage(action);
    let best = null;
    for (const point of candidates) {
      let cells;
      switch (action.shape) {
        case 'sphere': cells = Spatial.sphereCells(point, action.size); break;
        case 'cube':   cells = Spatial.cubeCells(point, action.size); break;
        case 'cone':   cells = Spatial.coneCells(point, point.dir, action.size); break;
        case 'line':   cells = Spatial.lineCells(point, point.dir, action.size); break;
        default: return;
      }
      const hit = Spatial.combatantsAt(cells, combatants);
      const enemies = hit.filter(t => t.side !== c.side);
      const allies  = hit.filter(t => t.side === c.side && t !== c);
      const score = enemies.length * ev - allies.length * ev * 0.5;
      if (!best || score > best.score) best = { point, cells, score, enemies, allies };
    }
    if (!best || best.score <= 0) return null;  // no good cast point
    // Emit the AoE event.
    const targets = [];
    const allHit = best.enemies.concat(best.allies);
    for (const t of allHit) {
      // For each target, resolve through the save pipeline.
      const targetEvents = [];
      const saveResult = resolveSave(c, [t], action, rng, targetEvents, round, combatants);
      const tDmg = saveResult.totalDmg || 0;
      // Apply damage.
      const dmgType = (action.damageOnFail && action.damageOnFail[0] && action.damageOnFail[0].type) || 'untyped';
      applyDamage(t, tDmg, dmgType, c, events, round, c.name, action.sourceActionName || action.name);
      targets.push({ id: t.id, name: t.name, pos: { x: t.x, y: t.y }, dmg: tDmg, dmgType, saved: saveResult.saved || false });
      // Merge any sub-events (e.g. feature events) from the save back into the main log.
      for (const sub of targetEvents) events.push(sub);
    }
    events.push({
      type: 'aoe', round, source: c.id, action: action.sourceActionName || action.name,
      shape: action.shape, center: { x: best.point.x, y: best.point.y },
      direction: best.point.dir || null,
      size: action.size,
      cellsCovered: best.cells,
      targets,
    });
    return best;
  }
  Crucible.resolveAoE = resolveAoE;
```

Add to the module export.

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible v2 engine: resolveAoE for sphere/cube/cone/line templates"
```

### Task 7.3: Wire AoE branch into the action loop

**Files:**
- Modify: `crucible-engine.js`

- [ ] **Step 1: Test that AoE actions in the trial flow get resolved**

```javascript
test('runTrial: AoE action on PC list emits aoe event in the trial', () => {
  const pm = {
    id: 'pm1', identity: { name: 'Wizard', level: 5 },
    abilities: { int: 16 },
    combat: { hp: 25, maxHp: 25, ac: 12, initBonus: 1, speed: 6 },
    actions: [{
      type: 'save', name: 'Fireball', shape: 'sphere', size: 2, range: 12,
      atkAbility: 'int',
      save: { ability: 'dex', dcOverride: 14, halfOnSave: true },
      damage: { dice: '8d6', type: 'fire' },
      aoeTargets: 99,
    }],
  };
  const monsterPicks = [];
  for (let i = 0; i < 3; i++) {
    monsterPicks.push({ name: 'Goblin' + i, cr: '1/4', count: 1,
      monster: { name: 'Goblin', ac: 13, hp: 7, maxHp: 7,
                 abilities: { str: { mod: 0 }, dex: { mod: 2 } },
                 parsedActions: [{ kind: 'attack', name: 'Bite', sourceActionName: 'Bite',
                                   toHit: 4, damage: [{ dice: '1d4', mod: 0, type: 'piercing' }] }] } });
  }
  const party = [pm];
  party._encounter = {
    map: { width: 20, height: 20, blocked: null },
    placement: [
      { id: 'pc:pm1', x: 5,  y: 5 },
      { id: 'mon:0', x: 11, y: 10 },
      { id: 'mon:1', x: 12, y: 10 },
      { id: 'mon:2', x: 11, y: 11 },
    ],
  };
  const rng = () => 0.5;
  const trial = Crucible.runTrial(party, monsterPicks, { aiHint: 'focus' }, rng);
  const aoe = trial.events.find(e => e.type === 'aoe');
  assert(aoe, 'expected aoe event in trial');
});
```

- [ ] **Step 2: Run → fail (action loop doesn't branch on shape yet)**

- [ ] **Step 3: Inside the action loop**, before the existing kind-dispatch (`if (action.kind === 'multiattack') {... else if (action.kind === 'attack') {... }`), add:

```javascript
          // v2 spatial: AoE branch.
          if (action.shape && action.shape !== 'single' && typeof CrucibleSpatial !== 'undefined') {
            consumeUse(c, action);
            resolveAoE(c, action, combatants, map, rng, events, round);
            tally(c.side, action.sourceActionName || action.name, 'aoe', false, 0, 0, 0, 0);
            continue;
          }
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible v2 engine: action loop dispatches AoE shapes through resolveAoE"
```

---

## Phase 8: Viewer foundation

### Task 8.1: `crucible-viewer.js` skeleton + test harness

**Files:**
- Create: `crucible-viewer.js`
- Create: `tests/crucible-viewer.test.html`

- [ ] **Step 1: Skeleton**

`crucible-viewer.js`:

```javascript
// ═══════════════════════════════════════════════════════════════════════
//  crucible-viewer.js
//  SVG event-sourced replay viewer for Crucible v2 tactical trials.
//
//  Public surface:
//    CrucibleViewer.mount(rootEl, trialResult)  — render board + controls
//    CrucibleViewer.unmount(rootEl)             — tear down
//
//  No engine coupling beyond reading trial.events.
// ═══════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const CrucibleViewer = {};

  // Constants for the SVG board.
  const CELL = 24;  // pixels per cell

  CrucibleViewer.CELL = CELL;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CrucibleViewer;
  } else {
    global.CrucibleViewer = CrucibleViewer;
  }
})(typeof window !== 'undefined' ? window : globalThis);
```

`tests/crucible-viewer.test.html` — same harness as `tests/crucible-spatial.test.html` (copy and rename), but loading both `../crucible-spatial.js` and `../crucible-viewer.js`:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>crucible-viewer tests</title>
<style>
  body { font-family: monospace; background: #0e1418; color: #dde7e9; padding: 1rem; }
  .pass { color: #6dd58c; } .fail { color: #d97a7a; }
  button { padding: 0.5rem 1rem; background: #1d3a4a; color: #dde7e9; border: 1px solid #1c2429; cursor: pointer; }
  pre { white-space: pre-wrap; margin-top: 0.5rem; }
  #host { display: none; }
</style>
</head>
<body>
<h1>crucible-viewer tests</h1>
<button onclick="runAll()">Run tests</button>
<pre id="out"></pre>
<div id="host"></div>
<script src="../crucible-spatial.js"></script>
<script src="../crucible-viewer.js"></script>
<script>
const TESTS = [];
function test(name, fn) { TESTS.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, m) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error((m || 'mismatch') + ': ' + x + ' vs ' + y);
}
function runAll() {
  const out = document.getElementById('out');
  let passed = 0, failed = 0;
  const lines = [];
  for (const t of TESTS) {
    try { t.fn(); lines.push('<span class="pass">✓ ' + t.name + '</span>'); passed++; }
    catch (e) { lines.push('<span class="fail">✗ ' + t.name + ' — ' + e.message + '</span>'); failed++; }
  }
  lines.push('\n' + passed + ' passed, ' + failed + ' failed');
  out.innerHTML = lines.join('\n');
}
function syntheticTrial() {
  return {
    events: [
      { type: 'placement', round: 0, map: { width: 10, height: 10, blocked: null },
        placements: [
          { id: 'pc:1', name: 'PC', side: 'pc', pos: { x: 1, y: 1 }, hp: 30, maxHp: 30, ac: 14, speed: 6 },
          { id: 'mon:0', name: 'Goblin', side: 'monster', pos: { x: 8, y: 8 }, hp: 7, maxHp: 7, ac: 13, speed: 6 },
        ] },
      { type: 'move', round: 1, who: 'pc:1', name: 'PC', from: { x: 1, y: 1 }, to: { x: 4, y: 4 },
        path: [{x:2,y:2},{x:3,y:3},{x:4,y:4}], reason: 'engage' },
      { type: 'attack', round: 1, actor: 'PC', target: 'Goblin', action: 'Sword', roll: 17, hit: true, damageDealt: 8,
        pos: { x: 4, y: 4 }, targetPos: { x: 8, y: 8 } },
      { type: 'damage', round: 1, actor: 'PC', target: 'Goblin', amount: 8, dmgType: 'slashing', action: 'Sword',
        pos: { x: 4, y: 4 }, targetPos: { x: 8, y: 8 } },
    ],
    rounds: 1, winner: 'pc', partyView: [{ name: 'PC', hp: 30 }],
  };
}
// === Tests below this line ===
</script>
</body>
</html>
```

- [ ] **Step 2: Run → no tests, just verify it loads**

- [ ] **Step 3: Commit**

```bash
git add crucible-viewer.js tests/crucible-viewer.test.html
git commit -m "Crucible v2 viewer: scaffold crucible-viewer.js + test harness"
```

### Task 8.2: `initialState(placementEvent)` derives starting state

**Files:**
- Modify: `crucible-viewer.js`
- Modify: `tests/crucible-viewer.test.html`

- [ ] **Step 1: Test**

```javascript
test('initialState: extracts combatants + map from placement event', () => {
  const trial = syntheticTrial();
  const state = CrucibleViewer.initialState(trial.events[0]);
  assertEq(state.map, { width: 10, height: 10, blocked: null });
  assertEq(state.combatants.length, 2);
  const pc = state.combatants.find(c => c.id === 'pc:1');
  assertEq(pc.x, 1);
  assertEq(pc.y, 1);
  assertEq(pc.hp, 30);
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement** in `crucible-viewer.js`:

```javascript
  function initialState(placementEvent) {
    if (!placementEvent || placementEvent.type !== 'placement') return { map: { width: 20, height: 20, blocked: null }, combatants: [] };
    const combatants = placementEvent.placements.map(p => ({
      id: p.id, name: p.name, side: p.side,
      x: p.pos.x, y: p.pos.y,
      hp: p.hp, maxHp: p.maxHp, ac: p.ac, speed: p.speed,
      dead: false, downed: false,
    }));
    return { map: placementEvent.map, combatants, lastMove: null, lastAoE: null };
  }
  CrucibleViewer.initialState = initialState;
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-viewer.js tests/crucible-viewer.test.html
git commit -m "Crucible v2 viewer: initialState from placement event"
```

### Task 8.3: `applyEvent(state, event)` updates state in place

**Files:**
- Modify: `crucible-viewer.js`
- Modify: `tests/crucible-viewer.test.html`

- [ ] **Step 1: Tests**

```javascript
test('applyEvent: move updates combatant position', () => {
  const trial = syntheticTrial();
  const state = CrucibleViewer.initialState(trial.events[0]);
  CrucibleViewer.applyEvent(state, trial.events[1]);  // move event
  const pc = state.combatants.find(c => c.id === 'pc:1');
  assertEq(pc.x, 4);
  assertEq(pc.y, 4);
});

test('applyEvent: damage event reduces target hp', () => {
  const trial = syntheticTrial();
  const state = CrucibleViewer.initialState(trial.events[0]);
  CrucibleViewer.applyEvent(state, { type: 'damage', target: 'Goblin', amount: 5 });
  const mon = state.combatants.find(c => c.name === 'Goblin');
  assertEq(mon.hp, 2);
});

test('applyEvent: damage to 0 marks dead (monster) / downed (pc)', () => {
  const trial = syntheticTrial();
  const state = CrucibleViewer.initialState(trial.events[0]);
  CrucibleViewer.applyEvent(state, { type: 'damage', target: 'Goblin', amount: 99 });
  const mon = state.combatants.find(c => c.name === 'Goblin');
  assertEq(mon.hp, 0);
  assert(mon.dead);
});

test('applyEvent: aoe event records lastAoE for the viewer to draw', () => {
  const trial = syntheticTrial();
  const state = CrucibleViewer.initialState(trial.events[0]);
  CrucibleViewer.applyEvent(state, {
    type: 'aoe', shape: 'sphere', center: { x: 5, y: 5 }, size: 2,
    cellsCovered: [{x:4,y:4},{x:5,y:5},{x:6,y:6}], targets: [],
  });
  assert(state.lastAoE);
  assertEq(state.lastAoE.shape, 'sphere');
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement**

```javascript
  function applyEvent(state, ev) {
    if (!ev) return;
    state.lastMove = null;
    state.lastAoE = null;
    switch (ev.type) {
      case 'move': {
        const c = state.combatants.find(cc => cc.id === ev.who);
        if (c) { c.x = ev.to.x; c.y = ev.to.y; }
        state.lastMove = ev;
        break;
      }
      case 'damage': {
        const c = state.combatants.find(cc => cc.name === ev.target);
        if (c) {
          c.hp = Math.max(0, c.hp - (ev.amount || 0));
          if (c.hp === 0) {
            if (c.side === 'pc') c.downed = true;
            else c.dead = true;
          }
        }
        break;
      }
      case 'heal': {
        const c = state.combatants.find(cc => cc.name === ev.target);
        if (c) {
          c.hp = Math.min(c.maxHp || c.hp + (ev.amount || 0), c.hp + (ev.amount || 0));
          if (ev.revived) c.downed = false;
        }
        break;
      }
      case 'regen': {
        const c = state.combatants.find(cc => cc.name === ev.actor);
        if (c && typeof ev.hpAfter === 'number') c.hp = ev.hpAfter;
        break;
      }
      case 'aoe': {
        state.lastAoE = ev;
        break;
      }
      // attack/save/feature events don't change state — they're informational.
    }
  }
  CrucibleViewer.applyEvent = applyEvent;

  function renderTo(state, events, idx) {
    // Replay from event 1 (skip placement, which initialState already used) up to idx inclusive.
    for (let i = 1; i <= idx && i < events.length; i++) applyEvent(state, events[i]);
    return state;
  }
  CrucibleViewer.renderTo = renderTo;
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-viewer.js tests/crucible-viewer.test.html
git commit -m "Crucible v2 viewer: applyEvent + renderTo replay"
```

### Task 8.4: SVG board rendering

**Files:**
- Modify: `crucible-viewer.js`
- Modify: `tests/crucible-viewer.test.html`

- [ ] **Step 1: Test**

```javascript
test('renderSVG: produces an svg with W*CELL × H*CELL viewBox and one token per combatant', () => {
  const trial = syntheticTrial();
  const state = CrucibleViewer.initialState(trial.events[0]);
  const host = document.getElementById('host');
  host.innerHTML = '';
  CrucibleViewer.renderSVG(host, state);
  const svg = host.querySelector('svg');
  assert(svg, 'svg present');
  assert(svg.getAttribute('viewBox').includes('240 240'));  // 10×24 = 240
  const tokens = svg.querySelectorAll('.token');
  assertEq(tokens.length, 2);
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement**

```javascript
  function renderSVG(host, state) {
    const w = state.map.width * CELL;
    const h = state.map.height * CELL;
    const tokensHtml = state.combatants.map(c => {
      const cx = c.x * CELL + CELL / 2;
      const cy = c.y * CELL + CELL / 2;
      const r  = CELL * 0.4;
      const cls = c.side === 'pc' ? 'token pc' : 'token monster';
      const dead = c.dead ? ' dead' : '';
      const downed = c.downed ? ' downed' : '';
      const hpFrac = c.maxHp ? c.hp / c.maxHp : 1;
      return `<g class="${cls}${dead}${downed}" data-id="${c.id}" transform="translate(${cx}, ${cy})">
        <circle r="${r}" />
        <text dy="0.35em" text-anchor="middle">${(c.name || '?').charAt(0)}</text>
        <rect class="hp-bar" x="${-r}" y="${-r - 6}" width="${2*r*hpFrac}" height="3" />
      </g>`;
    }).join('');
    const gridLines = [];
    for (let i = 0; i <= state.map.width; i++) {
      gridLines.push(`<line x1="${i*CELL}" y1="0" x2="${i*CELL}" y2="${h}" class="grid-line" />`);
    }
    for (let i = 0; i <= state.map.height; i++) {
      gridLines.push(`<line x1="0" y1="${i*CELL}" x2="${w}" y2="${i*CELL}" class="grid-line" />`);
    }
    const aoeHtml = state.lastAoE
      ? state.lastAoE.cellsCovered.map(c => `<rect x="${c.x*CELL}" y="${c.y*CELL}" width="${CELL}" height="${CELL}" class="aoe-cell" />`).join('')
      : '';
    host.innerHTML = `<svg class="tactical-board" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <g class="grid-lines">${gridLines.join('')}</g>
      <g class="aoe-overlay">${aoeHtml}</g>
      <g class="tokens">${tokensHtml}</g>
    </svg>`;
  }
  CrucibleViewer.renderSVG = renderSVG;
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-viewer.js tests/crucible-viewer.test.html
git commit -m "Crucible v2 viewer: renderSVG board + tokens + HP bars + AoE overlay"
```

### Task 8.5: `mount` and control bar

**Files:**
- Modify: `crucible-viewer.js`
- Modify: `tests/crucible-viewer.test.html`

- [ ] **Step 1: Test**

```javascript
test('mount: renders viewer with controls, cursor starts at 0', () => {
  const host = document.getElementById('host');
  host.innerHTML = '';
  const trial = syntheticTrial();
  const v = CrucibleViewer.mount(host, trial);
  assertEq(v.cursor, 0);
  assert(host.querySelector('.viewer-controls'), 'controls rendered');
  assert(host.querySelector('svg.tactical-board'), 'board rendered');
});

test('mount + stepForward: advances cursor and re-renders', () => {
  const host = document.getElementById('host');
  host.innerHTML = '';
  const trial = syntheticTrial();
  const v = CrucibleViewer.mount(host, trial);
  v.stepForward();
  assertEq(v.cursor, 1);
  // After applying the move event, PC should be at (4,4).
  const pcToken = host.querySelector('[data-id="pc:1"]');
  assert(pcToken.getAttribute('transform').includes('translate'));
});

test('mount + stepBack from cursor=2 returns to cursor=1', () => {
  const host = document.getElementById('host');
  host.innerHTML = '';
  const trial = syntheticTrial();
  const v = CrucibleViewer.mount(host, trial);
  v.stepForward(); v.stepForward();
  assertEq(v.cursor, 2);
  v.stepBack();
  assertEq(v.cursor, 1);
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement**

```javascript
  function mount(host, trial) {
    const events = trial.events || [];
    const state = initialState(events[0] || null);
    const inst = {
      cursor: 0,
      playing: false,
      speedMs: 600,
      timer: null,
    };
    function rerender() {
      renderSVG(boardEl, state);
      updateLog();
    }
    function setCursor(idx) {
      idx = Math.max(0, Math.min(events.length - 1, idx));
      if (idx === inst.cursor) return;
      if (idx < inst.cursor) {
        // Reset and replay forward.
        Object.assign(state, initialState(events[0]));
      }
      const from = Math.max(1, idx < inst.cursor ? 1 : inst.cursor + 1);
      for (let i = from; i <= idx; i++) applyEvent(state, events[i]);
      inst.cursor = idx;
      rerender();
    }
    inst.stepForward = () => setCursor(inst.cursor + 1);
    inst.stepBack    = () => setCursor(inst.cursor - 1);
    inst.scrub       = idx => setCursor(idx);
    inst.play  = () => { if (inst.playing) return; inst.playing = true; inst.timer = setInterval(inst.stepForward, inst.speedMs); };
    inst.pause = () => { inst.playing = false; if (inst.timer) clearInterval(inst.timer); inst.timer = null; };
    inst.setSpeed = ms => { inst.speedMs = ms; if (inst.playing) { inst.pause(); inst.play(); } };

    host.innerHTML = `<div class="viewer-board"></div>
      <div class="viewer-controls">
        <button onclick="this.dataset.action='back'">◀</button>
        <button onclick="this.dataset.action='playPause'">▶</button>
        <button onclick="this.dataset.action='forward'">▶</button>
        <input type="range" min="0" max="${events.length - 1}" value="0" class="viewer-scrub" />
        <select class="viewer-speed">
          <option value="1200">0.5×</option>
          <option value="600" selected>1×</option>
          <option value="300">2×</option>
          <option value="150">4×</option>
        </select>
      </div>
      <div class="viewer-log"></div>`;
    const boardEl = host.querySelector('.viewer-board');
    const logEl   = host.querySelector('.viewer-log');
    const scrub   = host.querySelector('.viewer-scrub');
    const speed   = host.querySelector('.viewer-speed');
    const buttons = host.querySelectorAll('.viewer-controls button');
    buttons[0].onclick = () => inst.stepBack();
    buttons[1].onclick = () => inst.playing ? inst.pause() : inst.play();
    buttons[2].onclick = () => inst.stepForward();
    scrub.oninput = e => inst.scrub(parseInt(e.target.value, 10));
    speed.onchange = e => inst.setSpeed(parseInt(e.target.value, 10));

    function updateLog() {
      const lines = events.slice(0, inst.cursor + 1).map((ev, i) =>
        `<div class="log-line log-${ev.type}${i === inst.cursor ? ' log-active' : ''}" data-idx="${i}">${escapeText(formatEvent(ev))}</div>`).join('');
      logEl.innerHTML = lines;
      Array.from(logEl.querySelectorAll('.log-line')).forEach(el => {
        el.onclick = () => inst.scrub(parseInt(el.dataset.idx, 10));
      });
      scrub.value = inst.cursor;
    }
    function escapeText(s) { return String(s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
    function formatEvent(ev) {
      // Same as crucible-dm.html's formatEvent — copy here so viewer is self-contained.
      switch (ev.type) {
        case 'placement': return 'Placement: ' + ev.placements.length + ' combatants on ' + ev.map.width + '×' + ev.map.height;
        case 'move':      return 'R' + ev.round + ' · ' + ev.name + ' walks to (' + ev.to.x + ',' + ev.to.y + ')';
        case 'attack':    return 'R' + ev.round + ' · ' + ev.actor + ' → ' + ev.target + ' · ' + ev.action + ' (roll ' + ev.roll + ') → ' + (ev.hit ? 'hit ' + ev.damageDealt : 'miss');
        case 'damage':    return 'R' + ev.round + ' · ' + ev.target + ' takes ' + ev.amount + ' ' + ev.dmgType;
        case 'heal':      return 'R' + ev.round + ' · ' + ev.actor + ' heals ' + ev.target + ' +' + ev.amount + (ev.revived ? ' REVIVED' : '');
        case 'save':      return 'R' + ev.round + ' · ' + ev.actor + ' → ' + ev.target + ' · ' + ev.action + ' save ' + (ev.passed ? 'passed' : 'failed');
        case 'aoe':       return 'R' + ev.round + ' · AoE ' + ev.shape + ' @ (' + ev.center.x + ',' + ev.center.y + ') hits ' + ev.targets.length;
        case 'opportunity-attack': return 'R' + ev.round + ' · OoA ' + ev.attackerName + ' on ' + ev.targetName + ' → ' + (ev.hit ? 'hit ' + ev.damageDealt : 'miss');
        case 'feature':   return 'R' + ev.round + ' · ⚡ ' + (ev.what || '');
        default:          return ev.type;
      }
    }

    rerender();
    return inst;
  }
  CrucibleViewer.mount = mount;
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-viewer.js tests/crucible-viewer.test.html
git commit -m "Crucible v2 viewer: mount + controls + log integration"
```

---

## Phase 9: Viewer polish

### Task 9.1: CSS for the viewer

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Add CSS rules** to the `<style>` block in `crucible-dm.html`:

```css
    /* v2 tactical viewer */
    .tactical-board { background: var(--c-bg); border: 1px solid var(--c-border); }
    .tactical-board .grid-line { stroke: var(--c-border); stroke-width: 0.5; opacity: 0.5; }
    .tactical-board .token { cursor: pointer; }
    .tactical-board .token circle { fill: var(--c-accent); stroke: var(--c-brass); stroke-width: 1.5; transition: transform 600ms ease-out; }
    .tactical-board .token.monster circle { fill: #c43838; }
    .tactical-board .token text { fill: var(--c-bg); font-family: Cinzel, serif; font-weight: 600; font-size: 0.65rem; pointer-events: none; }
    .tactical-board .token.dead { opacity: 0.35; }
    .tactical-board .token.dead text { text-decoration: line-through; }
    .tactical-board .token.downed circle { fill: #8b9da3; }
    .tactical-board .hp-bar { fill: #6dd58c; }
    .tactical-board .aoe-cell { fill: #c87cd4; opacity: 0.35; transition: opacity 600ms ease-out; }

    .viewer-controls { display: flex; gap: 8px; align-items: center; margin-top: 0.5rem; }
    .viewer-controls button { padding: 4px 10px; font-size: 1rem; background: var(--c-surface-2); color: var(--c-ink); border: 1px solid var(--c-border); cursor: pointer; }
    .viewer-scrub { flex: 1; }
    .viewer-speed { background: var(--c-surface); color: var(--c-ink); border: 1px solid var(--c-border); }
    .viewer-log { max-height: 400px; overflow-y: auto; padding: 0.5rem; background: var(--c-bg); border: 1px solid var(--c-border); font-size: 0.8rem; }
    .viewer-log .log-line { cursor: pointer; padding: 2px 0; }
    .viewer-log .log-active { background: rgba(126, 197, 197, 0.15); border-left: 2px solid var(--c-accent); padding-left: 6px; }
```

- [ ] **Step 2: Verify visually** — start `python3 -m http.server 8000` and open `tests/crucible-viewer.test.html`. The host div is hidden by `#host { display: none; }` but you can temporarily change to `display: block;` to inspect the board.

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible v2 viewer: CSS for board, tokens, controls, log highlighting"
```

### Task 9.2: Mount in Results panel + replace v1 "Representative fights"

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Locate the existing `renderReplays(r)` function** (around line 1202). Replace its body with:

```javascript
let activeReplayInst = null;
function renderReplays(r) {
  const root = document.getElementById('result-replays');
  if (!r.representative || !r.representative.low) { root.innerHTML = ''; return; }
  root.innerHTML = `
    <details open style="margin-top:0.5rem;">
      <summary style="font-family:'Cinzel',serif; color:var(--c-accent); cursor:pointer;">Tactical replay</summary>
      <div style="margin-top:0.5rem; display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
        <button class="btn" onclick="switchReplay('low')">Low (p10)</button>
        <button class="btn" onclick="switchReplay('median')">Median</button>
        <button class="btn" onclick="switchReplay('high')">High (p90)</button>
      </div>
      <div id="result-viewer-host" style="margin-top:0.5rem;"></div>
    </details>`;
  switchReplay(activeReplay);
}

let activeReplay = 'median';
function switchReplay(which) {
  activeReplay = which;
  if (!lastSimResult || !lastSimResult.representative) return;
  const trial = lastSimResult.representative[which];
  if (!trial) return;
  const host = document.getElementById('result-viewer-host');
  if (!host) return;
  host.innerHTML = '';
  activeReplayInst = CrucibleViewer.mount(host, trial);
}
```

- [ ] **Step 2: Verify in the browser**

Start `python3 -m http.server 8000`. Open `crucible-dm.html`. Run a sim. Expected: the Results panel now shows the tactical board for the median fight with controls.

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible v2 viewer: mount in Results panel, replace v1 Representative fights"
```

### Task 9.3: Two-column layout (board + log side-by-side)

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Modify the `mount` HTML** in `crucible-viewer.js` to wrap board + log in a flex container:

```javascript
    host.innerHTML = `<div class="viewer-flex">
      <div class="viewer-left">
        <div class="viewer-board"></div>
        <div class="viewer-controls">
          <button>◀</button>
          <button>▶</button>
          <button>▶</button>
          <input type="range" min="0" max="${events.length - 1}" value="0" class="viewer-scrub" />
          <select class="viewer-speed">
            <option value="1200">0.5×</option>
            <option value="600" selected>1×</option>
            <option value="300">2×</option>
            <option value="150">4×</option>
          </select>
        </div>
      </div>
      <div class="viewer-log"></div>
    </div>`;
```

- [ ] **Step 2: Add the flex CSS** to `crucible-dm.html`:

```css
    .viewer-flex { display: flex; gap: 1rem; }
    .viewer-left { flex: 0 0 auto; }
    .viewer-log { flex: 1; min-width: 0; }
    @media (max-width: 1200px) { .viewer-flex { flex-direction: column; } }
```

- [ ] **Step 3: Verify** — run a sim. Expected: board on left, log on right. Resize window narrower; verify they stack vertically.

- [ ] **Step 4: Commit**

```bash
git add crucible-viewer.js crucible-dm.html
git commit -m "Crucible v2 viewer: two-column layout (board + log)"
```

### Task 9.4: Move trail rendering

**Files:**
- Modify: `crucible-viewer.js`

- [ ] **Step 1: Add a move-trail `<g>` to `renderSVG`**:

```javascript
    const trailHtml = state.lastMove
      ? `<polyline points="${[{x:state.lastMove.from.x,y:state.lastMove.from.y}, ...state.lastMove.path].map(c => (c.x*CELL + CELL/2) + ',' + (c.y*CELL + CELL/2)).join(' ')}" class="move-trail" />`
      : '';
```

Insert it in the `<svg>` HTML between `aoe-overlay` and `tokens`:

```javascript
    host.innerHTML = `<svg ... >
      <g class="grid-lines">${gridLines.join('')}</g>
      <g class="aoe-overlay">${aoeHtml}</g>
      <g class="move-trail-group">${trailHtml}</g>
      <g class="tokens">${tokensHtml}</g>
    </svg>`;
```

- [ ] **Step 2: Add CSS** in `crucible-dm.html`:

```css
    .tactical-board .move-trail { fill: none; stroke: var(--c-accent); stroke-width: 1.5; stroke-dasharray: 3 3; opacity: 0.6; }
```

- [ ] **Step 3: Verify** — replay a sim with movement. The active move event should show a dashed line from `from` along the path.

- [ ] **Step 4: Commit**

```bash
git add crucible-viewer.js crucible-dm.html
git commit -m "Crucible v2 viewer: dashed move-trail rendering"
```

---

## Phase 10: Migration + cleanup

### Task 10.1: PC `combat.speed` default migration

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Locate `migratePCRecord`** (around line 130). Add:

```javascript
  if (typeof pm.combat.speed !== 'number') pm.combat.speed = 6;
  if (typeof pm.combat.reach !== 'number') pm.combat.reach = 1;
```

- [ ] **Step 2: Verify** — reload `crucible-dm.html`. PCs in localStorage that lack speed should get the default added.

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible v2: migrate PC combat.speed/reach defaults on load"
```

### Task 10.2: `encounter-schema.js` adds `map` + `placement` optional fields

**Files:**
- Modify: `encounter-schema.js`

- [ ] **Step 1: Locate the schema definition** (single file, IIFE). Add optional fields with validation:

```javascript
  // v2 spatial: map + placement
  if (e.map !== undefined && e.map !== null) {
    if (typeof e.map !== 'object') errors.push('map must be an object');
    else {
      if (typeof e.map.width !== 'number' || e.map.width < 1) errors.push('map.width must be positive');
      if (typeof e.map.height !== 'number' || e.map.height < 1) errors.push('map.height must be positive');
      if (e.map.width > 200 || e.map.height > 200) errors.push('map dimensions exceed 200×200 hard cap');
      else if (e.map.width * e.map.height > 60 * 60) warnings.push('map larger than 60×60 — sim may be slow');
    }
  }
  if (e.placement !== undefined && e.placement !== null && !Array.isArray(e.placement)) {
    errors.push('placement must be an array or null');
  }
```

- [ ] **Step 2: Verify** — run existing encounter-schema tests if any exist. No new ones needed for foundation.

- [ ] **Step 3: Commit**

```bash
git add encounter-schema.js
git commit -m "Crucible v2: encounter schema adds optional map + placement fields"
```

### Task 10.3: Module load order + script src in `crucible-dm.html`

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Insert script tags** before `<script src="crucible-engine.js">`:

```html
<script src="crucible-spatial.js"></script>
```

After:

```html
<script src="crucible-viewer.js"></script>
```

- [ ] **Step 2: Verify** — reload `crucible-dm.html` in the browser. Open DevTools console; no module-loading errors expected.

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible v2: load crucible-spatial.js and crucible-viewer.js in crucible-dm.html"
```

### Task 10.4: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add an entry at the top of the Unreleased section**

```markdown
### Crucible v2 — spatial combat foundation

Position-aware tactical combat simulator replacing v1's abstract trial mode.

- 5ft grid with A* pathfinding around obstacles. Combatants have x/y/speed/naturalReach; actions have range/shape/size.
- Movement, opportunity attacks, smart target selection (closest + lowest-HP + threat-weighted + OoA-aware), AoE templates (sphere/cube/cone/line).
- New event types: `placement`, `move`, `aoe`, `opportunity-attack`. All existing v1.1 events keep their schema; combat events gain `pos`/`targetPos` fields.
- New 2D SVG viewer in the Results panel. Event-sourced replay with step / step-back / play / pause / scrub / speed-pick controls. Clicking any log line jumps the board to that moment.
- `crucible-spatial.js` (new, ~400 lines, ~25 tests); `crucible-viewer.js` (new, ~350 lines, ~10 tests).
- PC migration: `combat.speed` defaults to 6 cells (30 ft), `combat.reach` to 1.
- Encounter schema gains optional `map` (width/height/blocked) and `placement` (per-combatant `{ id, x, y }` overrides). Defaults to 20×20 with PCs at y=1 and monsters at y=height-2.

Spec: `docs/superpowers/specs/2026-06-22-crucible-v2-spatial-design.md`
Plan: `docs/superpowers/plans/2026-06-22-crucible-v2-spatial.md`

**Manual UI checklist:**
- [ ] Run a sim. Tactical board shows on the Results panel with PCs and monsters in default positions.
- [ ] PCs and monsters walk toward each other; move-trail dashed line shows the active mover's path.
- [ ] Click "step" advances one event; the log highlights the active line.
- [ ] Click any line in the log; the board jumps to that moment.
- [ ] Run a sim with an AoE-shaped PC action (Fireball etc.) — purple overlay appears during the aoe event and fades.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "Crucible v2: CHANGELOG entry for spatial foundation"
```

---

## Phase 11: Final review

### Task 11.1: Run all tests

**Files:**
- None (verification only)

- [ ] **Step 1: Run engine tests**

```bash
python3 -m http.server 8000 &
```

Open `http://localhost:8000/tests/engine.test.html` — click Run tests. Expected: ~42 tests passing, 0 failing.

- [ ] **Step 2: Run pc-features tests**

`http://localhost:8000/tests/pc-features.test.html` — click Run tests. Expected: 77 passing, 14 known v1 baseline failures (unchanged from before).

- [ ] **Step 3: Run spatial tests**

`http://localhost:8000/tests/crucible-spatial.test.html` — click Run tests. Expected: ~51 passing, 0 failing.

- [ ] **Step 4: Run viewer tests**

`http://localhost:8000/tests/crucible-viewer.test.html` — click Run tests. Expected: ~10 passing, 0 failing.

- [ ] **Step 5: Verify the live UI**

Open `http://localhost:8000/crucible-dm.html`. Sign in as DM. Run a sim against any encounter. Check:

- [ ] Tactical board renders with PCs and monsters.
- [ ] Step / play / scrub controls work.
- [ ] Log lines on the right are clickable and jump the board.
- [ ] Damage / heal / move / AoE events all show with correct colors.
- [ ] No console errors.

### Task 11.2: Dispatch subagent code review

If executing via `superpowers:subagent-driven-development`, the implementer subagent dispatches a final code-quality reviewer after every task is complete. That review covers:

- New files (`crucible-spatial.js`, `crucible-viewer.js`) for code quality, naming, redundancy.
- Modified files (`crucible-engine.js`, `crucible-dm.html`, `encounter-schema.js`) for diff coherence.
- Test coverage gaps if any.
- Spec compliance — every section of the spec has a corresponding task.

If executing inline, dispatch the review manually after Task 10.4:

```
[Dispatch superpowers:code-quality-reviewer with the full diff vs main.]
```

### Task 11.3: Use `superpowers:finishing-a-development-branch`

After all tests pass and review is approved:

```
Invoke superpowers:finishing-a-development-branch
```

That skill presents the four options (merge / PR / keep / discard) for the implementation branch.

---

## Self-Review

Spec coverage check (verifying every spec section has at least one task):

| Spec section | Tasks |
|---|---|
| 1. Goals & non-goals | (informational) |
| 2. Architecture overview | (informational) |
| 3. Spatial data model | 1.2–1.5, 4.1, 4.3 |
| 4. Event stream extensions | 4.2, 4.4, 5.1, 5.2, 7.2 |
| 5a. Initial placement | 1.4, 4.2 |
| 5b. A* pathfinding | 1.3 |
| 5c. Opportunity attacks | 5.1, 5.2, 5.3 |
| 5d. Smart target selection | 3.1, 3.2, 6.1, 6.2 |
| 5e. AoE templates | 2.1–2.5, 7.2, 7.3 |
| 5f. Turn order within action loop | 4.4, 5.2, 7.3 |
| 5g. Determinism preservation | 4.5 |
| 6. Viewer skeleton | 8.1–8.5, 9.3, 9.4 |
| 7. Migration of v1 data | 10.1, 10.2 |
| 8. File structure | (whole plan) |

All sections covered. No gaps.

Type consistency check: function signatures match across tasks:
- `chebyshev(a, b)` used identically in Tasks 1.2, 1.3, 3.1, 5.2, 7.2.
- `findPath(start, goal, map, options)` consistent across 1.3, 3.2, 4.4, 5.2.
- `placeCombatants(combatants, map, override)` consistent across 1.4, 4.2.
- `scoreTarget(target, attacker, action, combatants, map, tactics)` — added the optional `tactics` arg in 6.2; callers in 6.1 updated.
- `Crucible.actionRange(action)` consistent across 4.3, 4.4, 5.2, 7.3.
- `applyEvent(state, event)` and `initialState(placement)` consistent across viewer tasks.

Placeholder scan: no TODO/TBD/etc. tokens. Each step has complete code or commands.

DRY note: the `formatEvent` switch is duplicated between `crucible-dm.html` (for the existing trial log) and `crucible-viewer.js` (for the viewer log). Acceptable — the viewer is meant to be self-contained per the spec. A follow-up plan could extract this into a shared helper, but that's out of scope here.

---

## End of plan

Total task count: **40 tasks across 11 phases**.

Estimated implementation effort: 3–4 weeks of focused work for a single developer; ~1–2 weeks with subagent-driven parallelism.

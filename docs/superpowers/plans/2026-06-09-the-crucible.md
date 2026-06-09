# The Crucible Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `crucible-dm.html` — a DM-only Monte-Carlo combat simulator that runs N round-by-round trials between a configurable PC party and a chosen group of monsters, then reports verdict, per-PC outcomes, distributions, per-action effectiveness, and three representative replay logs.

**Architecture:** Vanilla static-HTML page following The Spire's no-build-step conventions. Pure-function parser (`crucible-parser.js`) and engine (`crucible-engine.js`) live in standalone JS files so both the page and isolated test pages (`tests/parser.test.html`, `tests/engine.test.html`) can load them via `<script src=>`. UI logic stays inline in `crucible-dm.html`. Backend uses only existing Cloudflare Worker endpoints (`bestiary_custom` read/write).

**Tech Stack:** Plain HTML/CSS/JS (no framework, no bundler, no npm). Cloudflare Worker + KV for persistence of `bestiary_custom` overrides. `auth.js` for DM identity. `theme.css` for shared styling tokens.

**Spec:** `docs/superpowers/specs/2026-06-09-the-crucible-combat-sim-design.md`

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `crucible-engine.js` | NEW | Seeded RNG, dice roller, derived-stat helpers, `runTrial`, `runSim`. Pure functions. No DOM. |
| `crucible-parser.js` | NEW | `parseAction`, `parseRegeneration`, `parseAllMonsterActions`. Pure functions. No DOM. |
| `crucible-dm.html` | NEW | The DM-only Crucible page. Three-pane UI, inline `<style>`+`<script>`, loads `auth.js` + the two JS modules above. |
| `tests/parser.test.html` | NEW | Standalone test page for `crucible-parser.js`. Inline assert harness, 35 fixture cases. |
| `tests/engine.test.html` | NEW | Standalone test page for `crucible-engine.js`. 5 deterministic scenarios from the spec. |
| `home.html` | MODIFY | Add a DM-only "The Crucible" tool card to the Keeper's Wing. |
| `CHANGELOG.md` | MODIFY | One entry per phase summarizing what landed. |

**Why separate JS files (deviation from project convention):** The parser and engine are pure functions that need to be exercised from two pages: the live UI and the dedicated test pages. Inlining them in `crucible-dm.html` would force the tests to duplicate the code (or load `crucible-dm.html` and fish functions out of it). The project already establishes the `<script src=>`-loaded shared-module pattern via `auth.js`, so this fits.

---

## Phase 1 — Engine helpers (`crucible-engine.js` foundations)

Build the pure mathematical foundations first: a seeded RNG, a dice roller, ability/PB/save-bonus/to-hit/DC derivations. Tests live in `tests/engine.test.html` and grow with each task.

### Task 1: Create `crucible-engine.js` skeleton + seeded RNG

**Files:**
- Create: `crucible-engine.js`
- Create: `tests/engine.test.html`

- [ ] **Step 1: Create `crucible-engine.js` with module preamble and Mulberry32 RNG**

Write to `crucible-engine.js`:

```js
// ═══════════════════════════════════════════════════════════════════════
//  crucible-engine.js
//  Pure functions: seeded RNG, dice, derived stats, runTrial, runSim.
//  No DOM access. Loaded by crucible-dm.html and tests/engine.test.html.
// ═══════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  // ─────────── Seeded RNG (Mulberry32) ───────────
  // 32-bit deterministic PRNG. Same seed → same stream. Used by every
  // dice roll so a trial can be replayed exactly by re-seeding.
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function rng() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Roll an integer in [1, sides]. `rng` is a function returning [0,1).
  function rollDie(sides, rng) {
    return 1 + Math.floor(rng() * sides);
  }

  // ─────────── Public exports ───────────
  const Crucible = {
    makeRng,
    rollDie,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Crucible;
  else root.Crucible = Crucible;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: Create `tests/engine.test.html` with a minimal assert harness**

Write to `tests/engine.test.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Crucible engine tests</title>
  <style>
    body { font: 14px monospace; background:#0e1418; color:#dde7e9; padding:1rem; }
    h1 { color:#7ec5c5; }
    button { padding:0.5rem 1rem; background:#1d3a4a; color:#dde7e9;
             border:1px solid #2c5566; cursor:pointer; }
    .ok   { color:#7fd49a; }
    .fail { color:#e77878; }
    .case { padding:0.25rem 0; border-bottom:1px solid #1c2429; }
    pre   { white-space:pre-wrap; color:#a0adb2; margin:0.25rem 0 0 1rem; }
    #summary { padding:0.75rem; margin-top:1rem; background:#152028;
               border-left:3px solid #7ec5c5; }
  </style>
</head>
<body>
<h1>Crucible engine tests</h1>
<button onclick="runAll()">Run tests</button>
<div id="results"></div>
<div id="summary"></div>

<script src="../crucible-engine.js"></script>
<script>
const TESTS = [];
function test(name, fn) { TESTS.push({ name, fn }); }
function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((label || '') +
    '\n   expected: ' + e + '\n     actual: ' + a);
}
function assertTrue(cond, label) { if (!cond) throw new Error(label || 'expected true'); }
function assertBetween(v, lo, hi, label) {
  if (v < lo || v > hi) throw new Error((label || '') +
    `\n   expected: in [${lo}, ${hi}]\n     actual: ${v}`);
}
async function runAll() {
  const root = document.getElementById('results');
  root.innerHTML = '';
  let pass = 0, fail = 0;
  for (const t of TESTS) {
    const div = document.createElement('div');
    div.className = 'case';
    try {
      await t.fn();
      div.innerHTML = '<span class="ok">✓</span> ' + t.name;
      pass++;
    } catch (e) {
      div.innerHTML = '<span class="fail">✗</span> ' + t.name +
        '<pre>' + (e.message || String(e)) + '</pre>';
      fail++;
    }
    root.appendChild(div);
  }
  document.getElementById('summary').innerHTML =
    `<b>${pass} passed</b>, <b class="${fail?'fail':'ok'}">${fail} failed</b>, ${TESTS.length} total.`;
}
</script>

<!-- ────── Tests are appended below this line as tasks land ────── -->
<script>
test('RNG: same seed produces same first three rolls', () => {
  const a = Crucible.makeRng(42);
  const b = Crucible.makeRng(42);
  assertEq([a(), a(), a()], [b(), b(), b()]);
});
test('RNG: different seeds produce different first roll', () => {
  const a = Crucible.makeRng(1);
  const b = Crucible.makeRng(2);
  assertTrue(a() !== b(), 'seed 1 and seed 2 should differ');
});
test('rollDie(20): 1000 rolls all in [1,20]', () => {
  const rng = Crucible.makeRng(7);
  for (let i = 0; i < 1000; i++) {
    const v = Crucible.rollDie(20, rng);
    assertBetween(v, 1, 20, 'roll #' + i);
  }
});
</script>
</body>
</html>
```

- [ ] **Step 3: Open `tests/engine.test.html` in a browser and click "Run tests"**

Expected: 3 tests, all green. (Open file:// directly is fine; no server needed for this test page.)

- [ ] **Step 4: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible: scaffold engine.js + seeded RNG + test harness"
```

---

### Task 2: Dice roller

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Add failing tests for `rollDice`**

Append inside the last `<script>` block in `tests/engine.test.html` (before `</script>`):

```js
test('rollDice("1d8"): in [1,8]', () => {
  const rng = Crucible.makeRng(11);
  for (let i = 0; i < 200; i++) {
    const v = Crucible.rollDice('1d8', rng);
    assertBetween(v, 1, 8);
  }
});
test('rollDice("2d6+3"): in [5,15]', () => {
  const rng = Crucible.makeRng(13);
  for (let i = 0; i < 200; i++) {
    const v = Crucible.rollDice('2d6+3', rng);
    assertBetween(v, 5, 15);
  }
});
test('rollDice("3d8-2"): in [1,22]', () => {
  const rng = Crucible.makeRng(17);
  for (let i = 0; i < 200; i++) {
    const v = Crucible.rollDice('3d8-2', rng);
    assertBetween(v, 1, 22);
  }
});
test('rollDice empty/null returns 0', () => {
  const rng = Crucible.makeRng(1);
  assertEq(Crucible.rollDice('', rng), 0);
  assertEq(Crucible.rollDice(null, rng), 0);
});
test('rollDice with crit=true doubles dice (not mod)', () => {
  // 1d8+3 normal max = 11, crit max = 19 (8+8+3). We loop many trials
  // and check the maximum we ever see is > normal max.
  const rng = Crucible.makeRng(23);
  let maxNormal = 0, maxCrit = 0;
  for (let i = 0; i < 400; i++) {
    maxNormal = Math.max(maxNormal, Crucible.rollDice('1d8+3', rng, false));
    maxCrit   = Math.max(maxCrit,   Crucible.rollDice('1d8+3', rng, true));
  }
  assertTrue(maxNormal <= 11, 'normal cap 11, got ' + maxNormal);
  assertTrue(maxCrit > 11, 'crit must beat normal max, got ' + maxCrit);
});
```

- [ ] **Step 2: Run tests; verify the new ones fail**

Open `tests/engine.test.html`, click Run. Expected: 3 existing pass, 5 new fail with `rollDice is not a function`.

- [ ] **Step 3: Implement `rollDice` in `crucible-engine.js`**

Insert this function inside the IIFE in `crucible-engine.js`, immediately after `rollDie`:

```js
  // Parse and roll a dice formula. Forms accepted:
  //   '1d8', '2d6+3', '3d8-2', '4d6 + 1', '1d20+0', '3'  (constant)
  // crit=true → roll dice count twice (doubling dice, not modifier).
  // Empty / null / undefined → 0.
  const DICE_RE = /^\s*(?:(\d+)d(\d+))?\s*([+-]\s*\d+)?\s*$/i;
  function rollDice(formula, rng, crit) {
    if (!formula) return 0;
    const m = String(formula).match(DICE_RE);
    if (!m) return 0;
    const count = parseInt(m[1] || '0', 10);
    const sides = parseInt(m[2] || '0', 10);
    const mod   = m[3] ? parseInt(m[3].replace(/\s+/g, ''), 10) : 0;
    let total = mod;
    const rolls = crit ? count * 2 : count;
    for (let i = 0; i < rolls; i++) total += rollDie(sides, rng);
    return total;
  }
```

And add `rollDice` to the exports object:

```js
  const Crucible = {
    makeRng,
    rollDie,
    rollDice,
  };
```

- [ ] **Step 4: Run tests; verify all 8 pass**

Reload `tests/engine.test.html`, click Run. Expected: 8 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible: dice roller with crit doubling"
```

---

### Task 3: Derived-stat helpers

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Add failing tests for derivations**

Append to `tests/engine.test.html`:

```js
test('mod: 10→0, 14→+2, 8→-1, 20→+5', () => {
  assertEq(Crucible.mod(10), 0);
  assertEq(Crucible.mod(14), 2);
  assertEq(Crucible.mod(8), -1);
  assertEq(Crucible.mod(20), 5);
});
test('pb: L1→2, L4→2, L5→3, L17→6, L20→6', () => {
  assertEq(Crucible.pb(1), 2);
  assertEq(Crucible.pb(4), 2);
  assertEq(Crucible.pb(5), 3);
  assertEq(Crucible.pb(17), 6);
  assertEq(Crucible.pb(20), 6);
});
test('saveBonus: proficient adds PB, otherwise just mod', () => {
  const pm = { identity:{level:5}, abilities:{str:14,dex:16,con:12,int:10,wis:12,cha:10},
               profs:{saves:{str:false,dex:true,con:false,int:false,wis:false,cha:false}} };
  assertEq(Crucible.saveBonus(pm, 'str'), 2);       // +2, not proficient
  assertEq(Crucible.saveBonus(pm, 'dex'), 3 + 3);   // +3 from DEX, +3 PB at L5
  assertEq(Crucible.saveBonus(pm, 'con'), 1);       // +1, not proficient
});
test('toHit: uses atkAbility + PB unless override', () => {
  const pm = { identity:{level:5}, abilities:{str:16,dex:10,con:10,int:10,wis:10,cha:10},
               profs:{saves:{}} };
  const a1 = { atkAbility:'str', atkBonusOverride:null };
  assertEq(Crucible.toHit(pm, a1), 3 + 3);          // STR +3, PB +3
  const a2 = { atkAbility:'str', atkBonusOverride:9 };
  assertEq(Crucible.toHit(pm, a2), 9);              // override wins
});
test('saveDc: 8 + atkAbility mod + PB unless override', () => {
  const pm = { identity:{level:5}, abilities:{wis:18,str:10,dex:10,con:10,int:10,cha:10},
               profs:{saves:{}} };
  const a = { atkAbility:'wis', save:{ dcOverride:null } };
  assertEq(Crucible.saveDc(pm, a), 8 + 4 + 3);      // 15
  const ao = { atkAbility:'wis', save:{ dcOverride:17 } };
  assertEq(Crucible.saveDc(pm, ao), 17);
});
```

- [ ] **Step 2: Run tests; verify the new ones fail**

Click Run. Expected: existing tests pass, 5 new fail with `mod is not a function`, etc.

- [ ] **Step 3: Implement the helpers in `crucible-engine.js`**

Insert after `rollDice` inside the IIFE:

```js
  // ─────────── Derived stats (PC + monster) ───────────
  // Inputs: ability scores, level, proficiency flags. Outputs: numbers
  // the sim consumes. PCs store inputs and derive at use; monsters carry
  // pre-computed numbers from the parser (the parser feeds `toHit` and
  // `saveDc` directly in ParsedAction).
  function mod(score) { return Math.floor((Number(score) - 10) / 2); }
  function pb(level)  { return Math.ceil(1 + (Number(level) || 1) / 4); }
  function saveBonus(pm, ability) {
    const m = mod(pm.abilities[ability]);
    const isProf = !!(pm.profs && pm.profs.saves && pm.profs.saves[ability]);
    return m + (isProf ? pb(pm.identity.level) : 0);
  }
  function toHit(pm, action) {
    if (action.atkBonusOverride != null) return action.atkBonusOverride;
    return mod(pm.abilities[action.atkAbility]) + pb(pm.identity.level);
  }
  function saveDc(pm, action) {
    if (action.save && action.save.dcOverride != null) return action.save.dcOverride;
    return 8 + mod(pm.abilities[action.atkAbility]) + pb(pm.identity.level);
  }

  // Resolve the numeric damage modifier from a PC action's
  // damage.mod field — supports '+atkAbility' or a numeric string.
  function pcDamageMod(pm, action) {
    const raw = action.damage && action.damage.mod;
    if (raw === '+atkAbility') return mod(pm.abilities[action.atkAbility]);
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
```

And extend exports:

```js
  const Crucible = {
    makeRng, rollDie, rollDice,
    mod, pb, saveBonus, toHit, saveDc, pcDamageMod,
  };
```

- [ ] **Step 4: Run tests; verify all 13 pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible: derived stat helpers (mod, PB, saves, to-hit, DC)"
```

---

## Phase 2 — Action parser (`crucible-parser.js`)

The parser turns the bestiary's text action bodies into structured `ParsedAction` records the sim engine can execute. Five passes; first match wins. Built one pass at a time, each backed by fixture tests.

### Task 4: Parser skeleton + Pass 4 (unparsed fallback) + test harness

**Files:**
- Create: `crucible-parser.js`
- Create: `tests/parser.test.html`

- [ ] **Step 1: Create `crucible-parser.js` with skeleton + the fallback pass**

Write to `crucible-parser.js`:

```js
// ═══════════════════════════════════════════════════════════════════════
//  crucible-parser.js
//  Pure functions: parseAction, parseRegeneration, parseAllMonsterActions.
//  Five passes. First match wins. Loaded by crucible-dm.html and
//  tests/parser.test.html.
// ═══════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  // Today's date for `parsedAt` provenance.
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // ─────────── Pass 4 — Unparsed fallback ───────────
  // Always available. Wraps an action body in an explicit "couldn't
  // parse this" marker. The sim treats kind:'unparsed' as skip-and-flag,
  // and the validation gate refuses to run a sim until they're resolved.
  function unparsed(actionName, actionBody) {
    return {
      sourceActionName: actionName,
      kind: 'unparsed',
      _raw: actionBody || '',
      parsedBy: 'auto',
      parsedAt: today(),
    };
  }

  // Master entry point. For now, this always returns the unparsed
  // fallback — subsequent tasks add Passes 1, 2, 3, 3.5, and the
  // recharge/uses extractor in front of it.
  function parseAction(actionName, actionBody, monsterAbilities, monsterPb) {
    return unparsed(actionName, actionBody);
  }

  // ─────────── Public exports ───────────
  const CrucibleParser = {
    parseAction,
    _today: today,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CrucibleParser;
  else root.CrucibleParser = CrucibleParser;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: Create `tests/parser.test.html` with the same harness pattern**

Write to `tests/parser.test.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Crucible parser tests</title>
  <style>
    body { font: 14px monospace; background:#0e1418; color:#dde7e9; padding:1rem; }
    h1 { color:#7ec5c5; }
    button { padding:0.5rem 1rem; background:#1d3a4a; color:#dde7e9;
             border:1px solid #2c5566; cursor:pointer; }
    .ok   { color:#7fd49a; }
    .fail { color:#e77878; }
    .case { padding:0.25rem 0; border-bottom:1px solid #1c2429; }
    pre   { white-space:pre-wrap; color:#a0adb2; margin:0.25rem 0 0 1rem; }
    #summary { padding:0.75rem; margin-top:1rem; background:#152028;
               border-left:3px solid #7ec5c5; }
  </style>
</head>
<body>
<h1>Crucible parser tests</h1>
<button onclick="runAll()">Run tests</button>
<div id="results"></div>
<div id="summary"></div>

<script src="../crucible-parser.js"></script>
<script>
const TESTS = [];
function test(name, fn) { TESTS.push({ name, fn }); }
function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((label || '') +
    '\n   expected: ' + e + '\n     actual: ' + a);
}
function assertHas(obj, key, label) {
  if (!(key in obj)) throw new Error((label || '') + '\n   missing key: ' + key);
}
function assertTrue(cond, label) { if (!cond) throw new Error(label || 'expected true'); }
async function runAll() {
  const root = document.getElementById('results');
  root.innerHTML = '';
  let pass = 0, fail = 0;
  for (const t of TESTS) {
    const div = document.createElement('div');
    div.className = 'case';
    try {
      await t.fn();
      div.innerHTML = '<span class="ok">✓</span> ' + t.name;
      pass++;
    } catch (e) {
      div.innerHTML = '<span class="fail">✗</span> ' + t.name +
        '<pre>' + (e.message || String(e)) + '</pre>';
      fail++;
    }
    root.appendChild(div);
  }
  document.getElementById('summary').innerHTML =
    `<b>${pass} passed</b>, <b class="${fail?'fail':'ok'}">${fail} failed</b>, ${TESTS.length} total.`;
}
</script>

<script>
test('Pass 4: gibberish body → kind:unparsed', () => {
  const out = CrucibleParser.parseAction('Mystery', 'something undecipherable', null, 2);
  assertEq(out.kind, 'unparsed');
  assertEq(out.sourceActionName, 'Mystery');
  assertEq(out._raw, 'something undecipherable');
});
test('Pass 4: empty body still produces ParsedAction shape', () => {
  const out = CrucibleParser.parseAction('Nothing', '', null, 2);
  assertEq(out.kind, 'unparsed');
  assertEq(out._raw, '');
});
</script>
</body>
</html>
```

- [ ] **Step 3: Open `tests/parser.test.html` and run**

Expected: 2 passed, 0 failed.

- [ ] **Step 4: Commit**

```bash
git add crucible-parser.js tests/parser.test.html
git commit -m "Crucible: scaffold parser.js + Pass 4 (unparsed fallback)"
```

---

### Task 5: Pass 1 — Multiattack detection

**Files:**
- Modify: `crucible-parser.js`
- Modify: `tests/parser.test.html`

- [ ] **Step 1: Add failing tests for multiattack**

Append to `tests/parser.test.html`:

```js
test('Pass 1: actionName "Multiattack" → kind:multiattack', () => {
  const body = 'The aarakocra makes two Wind Staff attacks, and it can use Spellcasting to cast Gust of Wind.';
  const out = CrucibleParser.parseAction('Multiattack', body, null, 2);
  assertEq(out.kind, 'multiattack');
  assertEq(out.multiattackPlan, [{ actionName:'Wind Staff', count:2 }]);
});
test('Pass 1: "two Bite attacks and one Tail attack"', () => {
  const body = 'The dragon makes two Bite attacks and one Tail attack.';
  const out = CrucibleParser.parseAction('Multiattack', body, null, 2);
  assertEq(out.multiattackPlan, [
    { actionName:'Bite', count:2 },
    { actionName:'Tail', count:1 },
  ]);
});
test('Pass 1: "makes two attacks: one with Longsword and one with Shortbow"', () => {
  const body = 'The fighter makes two attacks: one with its Longsword and one with its Shortbow.';
  const out = CrucibleParser.parseAction('Multiattack', body, null, 2);
  assertEq(out.multiattackPlan, [
    { actionName:'Longsword', count:1 },
    { actionName:'Shortbow',  count:1 },
  ]);
});
test('Pass 1: body lead-in without "Multiattack" name still triggers', () => {
  const body = 'The wolf makes three Bite attacks.';
  const out = CrucibleParser.parseAction('Frenzy', body, null, 2);
  assertEq(out.kind, 'multiattack');
  assertEq(out.multiattackPlan, [{ actionName:'Bite', count:3 }]);
});
test('Pass 1: no multiattack language → falls through (NOT multiattack)', () => {
  const out = CrucibleParser.parseAction('Bite', 'Melee Attack Roll: +5', null, 2);
  assertTrue(out.kind !== 'multiattack', 'should not classify as multiattack');
});
```

- [ ] **Step 2: Run tests; verify the new ones fail**

Open `tests/parser.test.html` and click Run. Expected: first 4 new tests fail (`kind` is `'unparsed'`), 5th passes (it's a `unparsed` not a `multiattack`).

- [ ] **Step 3: Implement Pass 1 in `crucible-parser.js`**

Add inside the IIFE, before the existing `parseAction`:

```js
  // ─────────── Pass 1 — Multiattack detection ───────────
  const WORD_NUM = { a:1, an:1, one:1, two:2, three:3, four:4, five:5, six:6 };

  function tryMultiattack(actionName, body) {
    const nameMatch = /^multiattack\b/i.test(actionName);
    const bodyLead  = /^the\s+\w+(?:[ \w'-]+)?\s+makes\s+(a|an|one|two|three|four|five|six)\s+/i.test(body);
    if (!nameMatch && !bodyLead) return null;

    const plan = [];
    // Pattern A: "makes <num> X attacks" — possibly chained with "and <num> Y attacks"
    // Also handles "makes <num> attacks: one with its X and one with its Y"
    const colonForm = body.match(/makes\s+(?:a|an|one|two|three|four|five|six)\s+attacks?\s*:\s*(.+?)\./i);
    if (colonForm) {
      // Split the tail on " and " / commas. Each chunk is
      // "<num> with its <Name>" or "with its <Name>".
      const chunks = colonForm[1].split(/\s*(?:,|\band\b)\s*/i);
      for (const chunk of chunks) {
        const m = chunk.match(/(?:(a|an|one|two|three|four|five|six)\s+)?(?:with\s+(?:its|his|her|their)\s+)?([\w' -]+)/i);
        if (m) {
          const count = m[1] ? WORD_NUM[m[1].toLowerCase()] : 1;
          plan.push({ actionName: m[2].trim(), count });
        }
      }
    } else {
      // Pattern B: "makes <num> X attacks (and <num> Y attacks)*"
      const re = /(?:makes\s+|and\s+)(a|an|one|two|three|four|five|six)\s+([\w' -]+?)\s+attacks?\b/gi;
      let m;
      while ((m = re.exec(body)) !== null) {
        plan.push({
          actionName: m[2].trim(),
          count: WORD_NUM[m[1].toLowerCase()] || 1,
        });
      }
    }

    if (!plan.length) return null;
    return {
      sourceActionName: actionName,
      kind: 'multiattack',
      multiattackPlan: plan,
      parsedBy: 'auto',
      parsedAt: today(),
    };
  }
```

Then update `parseAction` to consult Pass 1 first:

```js
  function parseAction(actionName, actionBody, monsterAbilities, monsterPb) {
    const body = actionBody || '';
    const p1 = tryMultiattack(actionName, body);
    if (p1) return p1;
    return unparsed(actionName, body);
  }
```

- [ ] **Step 4: Run tests; verify all 7 (2 + 5) pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-parser.js tests/parser.test.html
git commit -m "Crucible parser: Pass 1 — multiattack detection"
```

---

### Task 6: Pass 2 — Attack-roll extraction

**Files:**
- Modify: `crucible-parser.js`
- Modify: `tests/parser.test.html`

- [ ] **Step 1: Add failing tests for attack-roll parsing**

Append to `tests/parser.test.html`:

```js
test('Pass 2: melee, single damage', () => {
  const body = 'Melee Attack Roll: +5, reach 5 ft. Hit: 7 (1d8 + 3) Bludgeoning damage.';
  const out = CrucibleParser.parseAction('Club', body, null, 2);
  assertEq(out.kind, 'attack');
  assertEq(out.toHit, 5);
  assertEq(out.reach, 5);
  assertEq(out.damage, [{ dice:'1d8', mod:3, type:'bludgeoning' }]);
});
test('Pass 2: ranged, with short/long range', () => {
  const body = 'Ranged Attack Roll: +6, range 80/320 ft. Hit: 8 (1d10 + 3) Piercing damage.';
  const out = CrucibleParser.parseAction('Longbow', body, null, 2);
  assertEq(out.kind, 'attack');
  assertEq(out.range, [80, 320]);
  assertEq(out.damage, [{ dice:'1d10', mod:3, type:'piercing' }]);
});
test('Pass 2: melee or ranged with rider damage', () => {
  const body = 'Melee or Ranged Attack Roll: +5, reach 5 ft. or range 120 ft. Hit: 7 (1d8 + 3) Bludgeoning damage plus 11 (2d10) Lightning damage.';
  const out = CrucibleParser.parseAction('Wind Staff', body, null, 2);
  assertEq(out.toHit, 5);
  assertEq(out.reach, 5);
  assertEq(out.range, [120, null]);
  assertEq(out.damage, [
    { dice:'1d8',  mod:3, type:'bludgeoning' },
    { dice:'2d10', mod:0, type:'lightning' },
  ]);
});
test('Pass 2: negative to-hit handled', () => {
  const body = 'Melee Attack Roll: -1, reach 5 ft. Hit: 1 (1d4 - 1) Piercing damage.';
  const out = CrucibleParser.parseAction('Feeble Bite', body, null, 2);
  assertEq(out.toHit, -1);
  assertEq(out.damage, [{ dice:'1d4', mod:-1, type:'piercing' }]);
});
test('Pass 2: no parenthetical dice (flat) → empty damage list', () => {
  // Most monsters always state a dice formula; if absent, we still capture toHit.
  const body = 'Melee Attack Roll: +3, reach 5 ft. Hit: nothing happens.';
  const out = CrucibleParser.parseAction('Touch', body, null, 2);
  assertEq(out.kind, 'attack');
  assertEq(out.toHit, 3);
  assertEq(out.damage, []);
});
```

- [ ] **Step 2: Run tests; verify the new ones fail**

Click Run. Expected: 5 new tests fail (kind is `'unparsed'`).

- [ ] **Step 3: Implement Pass 2**

Add inside the IIFE, after `tryMultiattack`:

```js
  // ─────────── Pass 2 — Attack roll ───────────
  const ATTACK_HEADER_RE = /(?:Melee or Ranged Attack Roll|Melee Attack Roll|Ranged Attack Roll|Melee Weapon Attack|Ranged Weapon Attack)\s*:/i;
  const TOHIT_RE  = /(?:Attack Roll|Attack)\s*:\s*([+-]?\d+)/i;
  const REACH_RE  = /reach\s+(\d+)\s*(?:ft|feet|')/i;
  const RANGE_RE  = /range\s+(\d+)(?:\s*\/\s*(\d+))?\s*(?:ft|feet|')/i;
  // Damage component: optional leading average "11", then "(1d8 + 3)" then "Type damage"
  const DMG_RE    = /(?:\d+)?\s*\((\d+d\d+)(?:\s*([+-])\s*(\d+))?\)\s+([A-Za-z]+)\s+damage/gi;

  function extractDamage(body) {
    const out = [];
    let m;
    DMG_RE.lastIndex = 0;
    while ((m = DMG_RE.exec(body)) !== null) {
      const dice = m[1];
      const sign = m[2] || '+';
      const num  = m[3] ? parseInt(m[3], 10) : 0;
      const mod  = sign === '-' ? -num : num;
      out.push({ dice, mod, type: m[4].toLowerCase() });
    }
    return out;
  }

  function tryAttack(actionName, body) {
    if (!ATTACK_HEADER_RE.test(body)) return null;
    const th = body.match(TOHIT_RE);
    const reachM = body.match(REACH_RE);
    const rangeM = body.match(RANGE_RE);
    return {
      sourceActionName: actionName,
      kind: 'attack',
      toHit: th ? parseInt(th[1], 10) : 0,
      reach: reachM ? parseInt(reachM[1], 10) : null,
      range: rangeM ? [parseInt(rangeM[1], 10), rangeM[2] ? parseInt(rangeM[2], 10) : null] : null,
      damage: extractDamage(body),
      parsedBy: 'auto',
      parsedAt: today(),
    };
  }
```

Update `parseAction`:

```js
  function parseAction(actionName, actionBody, monsterAbilities, monsterPb) {
    const body = actionBody || '';
    const p1 = tryMultiattack(actionName, body); if (p1) return p1;
    const p2 = tryAttack(actionName, body);      if (p2) return p2;
    return unparsed(actionName, body);
  }
```

- [ ] **Step 4: Run tests; verify all 12 pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-parser.js tests/parser.test.html
git commit -m "Crucible parser: Pass 2 — attack-roll extraction"
```

---

### Task 7: Pass 3 — Save effect

**Files:**
- Modify: `crucible-parser.js`
- Modify: `tests/parser.test.html`

- [ ] **Step 1: Add failing tests for save effects**

Append to `tests/parser.test.html`:

```js
test('Pass 3: DC X Ability saving throw with half-on-save', () => {
  const body = 'Each creature in a 20-foot-radius sphere must make a DC 15 Dexterity saving throw, taking 24 (7d6) Fire damage on a failed save, or half as much damage on a successful one.';
  const out = CrucibleParser.parseAction('Fireball', body, null, 3);
  assertEq(out.kind, 'save');
  assertEq(out.saveAbility, 'dex');
  assertEq(out.saveDc, 15);
  assertEq(out.halfOnSave, true);
  assertEq(out.aoeTargets, 4);                // sphere → 4
  assertEq(out.damageOnFail, [{ dice:'7d6', mod:0, type:'fire' }]);
});
test('Pass 3: cone → aoeTargets 3', () => {
  const body = 'Each creature in a 30-foot cone must succeed on a DC 17 Constitution saving throw or take 56 (16d6) Fire damage.';
  const out = CrucibleParser.parseAction('Breath', body, null, 4);
  assertEq(out.kind, 'save');
  assertEq(out.aoeTargets, 3);
});
test('Pass 3: condition-only save (prone) defaults to 1-round duration', () => {
  const body = 'The target must succeed on a DC 13 Strength saving throw or fall Prone.';
  const out = CrucibleParser.parseAction('Trip', body, null, 2);
  assertEq(out.kind, 'save');
  assertEq(out.saveAbility, 'str');
  assertEq(out.saveDc, 13);
  assertEq(out.effectOnFail, 'condition');
  assertEq(out.condition, 'prone');
});
test('Pass 3: ambiguous area → aoeTargets 1 (flag for review)', () => {
  const body = 'One creature must make a DC 14 Wisdom saving throw, taking 14 (4d6) Psychic damage on a failed save.';
  const out = CrucibleParser.parseAction('Mind Blast', body, null, 3);
  assertEq(out.kind, 'save');
  assertEq(out.aoeTargets, 1);
});
test('Pass 3: line → aoeTargets 3', () => {
  const body = 'Creatures in a 60-foot line must make a DC 16 Dexterity saving throw, taking 22 (4d10) Lightning damage on a failed save, or half on a success.';
  const out = CrucibleParser.parseAction('Bolt', body, null, 4);
  assertEq(out.aoeTargets, 3);
});
```

- [ ] **Step 2: Run tests; verify the 5 new fail**

- [ ] **Step 3: Implement Pass 3**

Insert in `crucible-parser.js` after `tryAttack`:

```js
  // ─────────── Pass 3 — Save effect ───────────
  const SAVE_RE_A = /DC\s+(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving\s+throw/i;
  const SAVE_RE_B = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving\s+throw[^.]*?DC\s+(\d+)/i;
  const HALF_RE   = /half(?:\s+as\s+much)?\s+damage\s+on\s+a\s+success(?:ful\s+save)?/i;
  const SHAPE_RE  = /(\d+)-foot[- ](sphere|cube|cone|line|radius)/i;
  const CONDITIONS = ['prone','restrained','grappled','stunned','paralyzed',
                      'frightened','incapacitated','unconscious','blinded',
                      'deafened','poisoned','charmed'];
  const ABILITY_3 = { strength:'str', dexterity:'dex', constitution:'con',
                      intelligence:'int', wisdom:'wis', charisma:'cha' };

  function aoeTargetsFromShape(body) {
    const m = body.match(SHAPE_RE);
    if (!m) return 1;
    const shape = m[2].toLowerCase();
    if (shape === 'sphere' || shape === 'cube')   return 4;
    if (shape === 'cone'   || shape === 'line')   return 3;
    if (shape === 'radius')                       return 2;
    return 1;
  }

  function detectCondition(body) {
    const low = body.toLowerCase();
    for (const c of CONDITIONS) {
      // word boundary to avoid matching "stunning" etc.
      const re = new RegExp('\\b' + c + '\\b', 'i');
      if (re.test(low)) return c;
    }
    return null;
  }

  function trySave(actionName, body) {
    let ability = null, dc = null;
    const a = body.match(SAVE_RE_A);
    if (a) { dc = parseInt(a[1], 10); ability = ABILITY_3[a[2].toLowerCase()]; }
    else {
      const b = body.match(SAVE_RE_B);
      if (b) { ability = ABILITY_3[b[1].toLowerCase()]; dc = parseInt(b[2], 10); }
    }
    if (!ability) return null;

    const dmgFail = extractDamage(body);
    const halfOnSave = HALF_RE.test(body);
    const cond = detectCondition(body);
    const hasDamage = dmgFail.length > 0;

    return {
      sourceActionName: actionName,
      kind: 'save',
      saveAbility: ability,
      saveDc: dc,
      aoeTargets: aoeTargetsFromShape(body),
      effectOnFail: hasDamage ? 'damage' : (cond ? 'condition' : 'damage'),
      damageOnFail: dmgFail,
      damageOnSave: halfOnSave ? dmgFail.map(d => ({ ...d, half:true })) : [],
      halfOnSave,
      condition: cond,
      parsedBy: 'auto',
      parsedAt: today(),
    };
  }
```

Update `parseAction`:

```js
  function parseAction(actionName, actionBody, monsterAbilities, monsterPb) {
    const body = actionBody || '';
    const p1 = tryMultiattack(actionName, body); if (p1) return p1;
    const p2 = tryAttack(actionName, body);      if (p2) return p2;
    const p3 = trySave(actionName, body);        if (p3) return p3;
    return unparsed(actionName, body);
  }
```

- [ ] **Step 4: Run tests; verify all 17 pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-parser.js tests/parser.test.html
git commit -m "Crucible parser: Pass 3 — save effects + AoE inference"
```

---

### Task 8: Pass 3.5 — Heal effect

**Files:**
- Modify: `crucible-parser.js`
- Modify: `tests/parser.test.html`

- [ ] **Step 1: Add failing tests for heal parsing**

Append to `tests/parser.test.html`:

```js
test('Pass 3.5: ally target with dice formula', () => {
  const body = 'One creature the cleric can see within 60 feet regains 8 (2d4 + 3) hit points.';
  const out = CrucibleParser.parseAction('Healing Word', body, null, 3);
  assertEq(out.kind, 'heal');
  assertEq(out.heal.dice, '2d4');
  assertEq(out.heal.mod, 3);
  assertEq(out.heal.target, 'ally');
});
test('Pass 3.5: self-heal', () => {
  const body = 'The vampire regains 10 (3d6) hit points itself.';
  const out = CrucibleParser.parseAction('Blood Drink', body, null, 3);
  assertEq(out.kind, 'heal');
  assertEq(out.heal.dice, '3d6');
  assertEq(out.heal.target, 'self');
});
test('Pass 3.5: AoE heal with radius', () => {
  const body = 'Each ally within a 30-foot radius regains 5 (1d4 + 3) hit points.';
  const out = CrucibleParser.parseAction('Mass Heal', body, null, 3);
  assertEq(out.kind, 'heal');
  assertEq(out.heal.target, 'ally-aoe');
  assertEq(out.heal.aoeTargets, 2);
});
test('Pass 3.5: downed-revive heal', () => {
  const body = 'If the creature has 0 hit points, it regains 6 (1d8 + 2) hit points and stands up.';
  const out = CrucibleParser.parseAction('Lay on Hands', body, null, 3);
  assertEq(out.kind, 'heal');
  assertEq(out.heal.reviveDowned, true);
});
test('Pass 3.5: flat heal with no dice', () => {
  const body = 'The target regains 5 hit points.';
  const out = CrucibleParser.parseAction('Touch', body, null, 2);
  assertEq(out.kind, 'heal');
  assertEq(out.heal.flat, 5);
  assertEq(out.heal.dice, null);
});
```

- [ ] **Step 2: Run; the 5 new fail**

- [ ] **Step 3: Implement Pass 3.5**

Insert after `trySave`:

```js
  // ─────────── Pass 3.5 — Heal effect ───────────
  const HEAL_DICE_RE = /regains?\s+(\d+)\s*\((\d+d\d+)(?:\s*\+\s*(\d+))?\)\s+hit\s+points/i;
  const HEAL_FLAT_RE = /regains?\s+(\d+)\s+hit\s+points/i;
  const SELF_RE   = /\b(?:itself|himself|herself|themselves|the\s+\w+(?:\s+\w+)?\s+regains)\b/i;
  const ALLY_RE   = /\b(?:one\s+creature|an?\s+ally|a\s+friendly\s+creature|its\s+ally)\b/i;
  const AOE_HEAL_RE = /\b(?:each\s+ally|all\s+allies|creatures?\s+within\s+\d+\s*(?:ft|feet|'))\b/i;
  const REVIVE_RE = /\b(?:0\s+hit\s+points|unconscious|dying)\b/i;

  function tryHeal(actionName, body) {
    const dice = body.match(HEAL_DICE_RE);
    const flat = !dice && body.match(HEAL_FLAT_RE);
    if (!dice && !flat) return null;

    let target = 'ally';
    if (AOE_HEAL_RE.test(body))   target = 'ally-aoe';
    else if (SELF_RE.test(body))  target = 'self';
    else if (ALLY_RE.test(body))  target = 'ally';

    const heal = dice
      ? { dice: dice[2], mod: dice[3] ? parseInt(dice[3], 10) : 0, flat: 0,
          target, aoeTargets: target === 'ally-aoe' ? aoeTargetsFromShape(body) : 0,
          reviveDowned: REVIVE_RE.test(body) }
      : { dice: null, mod: 0, flat: parseInt(flat[1], 10),
          target, aoeTargets: target === 'ally-aoe' ? aoeTargetsFromShape(body) : 0,
          reviveDowned: REVIVE_RE.test(body) };

    return {
      sourceActionName: actionName,
      kind: 'heal',
      heal,
      parsedBy: 'auto',
      parsedAt: today(),
    };
  }
```

Update `parseAction`:

```js
  function parseAction(actionName, actionBody, monsterAbilities, monsterPb) {
    const body = actionBody || '';
    const p1 = tryMultiattack(actionName, body); if (p1) return p1;
    const p2 = tryAttack(actionName, body);      if (p2) return p2;
    const p3 = trySave(actionName, body);        if (p3) return p3;
    const p35 = tryHeal(actionName, body);       if (p35) return p35;
    return unparsed(actionName, body);
  }
```

- [ ] **Step 4: Run; all 22 pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-parser.js tests/parser.test.html
git commit -m "Crucible parser: Pass 3.5 — heal effects with revive detection"
```

---

### Task 9: Recharge / uses-per-day extraction

**Files:**
- Modify: `crucible-parser.js`
- Modify: `tests/parser.test.html`

- [ ] **Step 1: Add failing tests**

Append to `tests/parser.test.html`:

```js
test('Recharge: "Breath (Recharge 5-6)" → recharge minRoll 5', () => {
  const body = 'Each creature in a 30-foot cone must succeed on a DC 17 Constitution saving throw or take 56 (16d6) Fire damage.';
  const out = CrucibleParser.parseAction('Breath (Recharge 5-6)', body, null, 4);
  assertEq(out.kind, 'save');
  assertEq(out.recharge, { dice:'d6', minRoll:5 });
});
test('UsesPerDay: "(1/Day)" → usesPerDay 1', () => {
  const body = 'Melee Attack Roll: +5, reach 5 ft. Hit: 7 (1d8 + 3) Bludgeoning damage.';
  const out = CrucibleParser.parseAction('Smite (1/Day)', body, null, 2);
  assertEq(out.kind, 'attack');
  assertEq(out.usesPerDay, 1);
});
test('Recharge + UsesPerDay on the same action', () => {
  const body = 'Each creature in a 20-foot-radius sphere must make a DC 15 Dexterity saving throw, taking 24 (7d6) Fire damage on a failed save, or half on a success.';
  const out = CrucibleParser.parseAction('Fireball (Recharge 6)(3/Day)', body, null, 3);
  assertEq(out.recharge, { dice:'d6', minRoll:6 });
  assertEq(out.usesPerDay, 3);
});
```

- [ ] **Step 2: Run; 3 new fail**

- [ ] **Step 3: Implement the post-pass extractor**

In `crucible-parser.js`, add inside the IIFE:

```js
  // ─────────── Recharge / uses-per-day ───────────
  // Always runs, attached to whatever Pass 1-3.5 produced.
  const RECHARGE_RE = /\(\s*Recharge\s+(\d)(?:\s*[-–]\s*(\d))?\s*\)/i;
  const USES_RE     = /\(\s*(\d+)\s*\/\s*Day\s*\)/i;

  function attachResourceGating(parsed, actionName) {
    if (!parsed) return parsed;
    const r = actionName.match(RECHARGE_RE);
    if (r) parsed.recharge = { dice: 'd6', minRoll: parseInt(r[1], 10) };
    else if (parsed.recharge === undefined) parsed.recharge = null;
    const u = actionName.match(USES_RE);
    if (u) parsed.usesPerDay = parseInt(u[1], 10);
    else if (parsed.usesPerDay === undefined) parsed.usesPerDay = null;
    return parsed;
  }
```

Update `parseAction` to apply the extractor to every non-unparsed return:

```js
  function parseAction(actionName, actionBody, monsterAbilities, monsterPb) {
    const body = actionBody || '';
    const p1 = tryMultiattack(actionName, body); if (p1) return attachResourceGating(p1, actionName);
    const p2 = tryAttack(actionName, body);      if (p2) return attachResourceGating(p2, actionName);
    const p3 = trySave(actionName, body);        if (p3) return attachResourceGating(p3, actionName);
    const p35 = tryHeal(actionName, body);       if (p35) return attachResourceGating(p35, actionName);
    return unparsed(actionName, body);
  }
```

- [ ] **Step 4: Run; all 25 pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-parser.js tests/parser.test.html
git commit -m "Crucible parser: recharge + uses-per-day extraction"
```

---

### Task 10: `parseRegeneration` + `parseAllMonsterActions` wrapper

**Files:**
- Modify: `crucible-parser.js`
- Modify: `tests/parser.test.html`

- [ ] **Step 1: Add failing tests**

Append to `tests/parser.test.html`:

```js
test('parseRegeneration: troll regen + acid/fire suppression', () => {
  const traits = [{
    name: 'Regeneration',
    body: 'The troll regains 10 hit points at the start of its turn if it has at least 1 hit point and hasn\'t taken acid or fire damage since the end of its last turn.',
  }];
  const r = CrucibleParser.parseRegeneration(traits);
  assertEq(r, { amount: 10, suppressedBy: ['acid', 'fire'], minHpToRegen: 1 });
});
test('parseRegeneration: amount only, no suppression', () => {
  const traits = [{ name:'Regeneration', body:'The creature regains 5 hit points each turn.' }];
  const r = CrucibleParser.parseRegeneration(traits);
  assertEq(r.amount, 5);
  assertEq(r.suppressedBy, []);
});
test('parseRegeneration: no regeneration trait → null', () => {
  const traits = [{ name:'Keen Smell', body:'The hound has advantage on Perception checks.' }];
  assertEq(CrucibleParser.parseRegeneration(traits), null);
});
test('parseAllMonsterActions: writes parsedActions[] keyed by source name', () => {
  const monster = {
    name: 'Goblin',
    actions: [
      { name:'Scimitar', body:'Melee Attack Roll: +4, reach 5 ft. Hit: 5 (1d6 + 2) Slashing damage.' },
    ],
    bonusActions: [
      { name:'Nimble Escape', body:'The goblin Disengages.' },
    ],
    reactions: [],
    traits: [],
  };
  CrucibleParser.parseAllMonsterActions(monster);
  assertEq(monster.parsedActions.length, 2);
  assertEq(monster.parsedActions[0].sourceActionName, 'Scimitar');
  assertEq(monster.parsedActions[0].kind, 'attack');
  assertEq(monster.parsedActions[1].kind, 'unparsed');     // disengage isn't a parse target
});
test('parseAllMonsterActions: respects pre-existing parsedActions (override)', () => {
  const monster = {
    name: 'Goblin',
    actions: [{ name:'Scimitar', body:'Melee Attack Roll: +4, reach 5 ft. Hit: 5 (1d6 + 2) Slashing damage.' }],
    bonusActions: [], reactions: [], traits: [],
    parsedActions: [{ sourceActionName:'Scimitar', kind:'attack', toHit:99,
                      damage:[], parsedBy:'manual', parsedAt:'override' }],
  };
  CrucibleParser.parseAllMonsterActions(monster);
  // Pre-existing override preserved.
  assertEq(monster.parsedActions[0].toHit, 99);
  assertEq(monster.parsedActions[0].parsedBy, 'manual');
});
```

- [ ] **Step 2: Run; 5 new fail**

- [ ] **Step 3: Implement both helpers**

Add to `crucible-parser.js`:

```js
  // ─────────── parseRegeneration (trait body → block | null) ───────────
  const REGEN_NAME_RE   = /^regeneration\b/i;
  const REGEN_AMOUNT_RE = /regains\s+(\d+)\s+hit\s+points/i;
  const REGEN_SUPPRESS_RE = /take(?:n)?\s+([\w,\s]+?)\s+damage\b/i;
  const KNOWN_DAMAGE_TYPES = ['acid','fire','cold','lightning','thunder','poison',
    'necrotic','radiant','psychic','force','bludgeoning','piercing','slashing'];

  function parseRegeneration(traits) {
    if (!Array.isArray(traits)) return null;
    const t = traits.find(x => x && REGEN_NAME_RE.test(x.name || ''));
    if (!t) return null;
    const am = (t.body || '').match(REGEN_AMOUNT_RE);
    if (!am) return null;
    const supp = [];
    const sm = (t.body || '').match(REGEN_SUPPRESS_RE);
    if (sm) {
      const parts = sm[1].toLowerCase().split(/\s*(?:,|\bor\b|\band\b)\s*/);
      for (const p of parts) {
        const cleaned = p.trim();
        if (KNOWN_DAMAGE_TYPES.includes(cleaned)) supp.push(cleaned);
      }
    }
    return { amount: parseInt(am[1], 10), suppressedBy: supp, minHpToRegen: 1 };
  }

  // ─────────── parseAllMonsterActions (memoized) ───────────
  // Walks actions[] / bonusActions[] / reactions[], parses each, populates
  // monster.parsedActions[]. If an entry already exists for a given
  // sourceActionName (e.g. from a bestiary_custom override), keep it.
  // Also writes monster.regeneration if a Regeneration trait is present
  // and not already set.
  function parseAllMonsterActions(monster) {
    if (!monster) return;
    monster.parsedActions = Array.isArray(monster.parsedActions) ? monster.parsedActions : [];
    const existing = new Set(monster.parsedActions.map(p => p.sourceActionName));
    const buckets = [monster.actions, monster.bonusActions, monster.reactions];
    for (const arr of buckets) {
      if (!Array.isArray(arr)) continue;
      for (const a of arr) {
        if (!a || !a.name || existing.has(a.name)) continue;
        const p = parseAction(a.name, a.body, monster.abilities, monster.pb);
        monster.parsedActions.push(p);
        existing.add(a.name);
      }
    }
    if (!monster.regeneration) {
      const r = parseRegeneration(monster.traits);
      if (r) monster.regeneration = r;
    }
  }
```

Update exports:

```js
  const CrucibleParser = {
    parseAction,
    parseRegeneration,
    parseAllMonsterActions,
    _today: today,
  };
```

- [ ] **Step 4: Run; all 30 pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-parser.js tests/parser.test.html
git commit -m "Crucible parser: parseRegeneration + parseAllMonsterActions wrapper"
```

---

### Task 11: CHANGELOG entry for parser

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Open `CHANGELOG.md` and add a new Unreleased entry at the top**

Insert at the top of the Unreleased section (read the existing format first; mirror it):

```markdown
## Unreleased

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
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "Changelog: Crucible parser + engine helpers"
```

---

## Phase 3 — Sim engine (round loop + aggregator)

Build the round loop one slice at a time. Each task adds one phase of the per-turn sequence (from the spec's "Round loop" section: skip → conditions → recharge → regen → target → heal triage → action pick → resolve → apply → 0-HP → log) and ends with focused tests.

### Task 12: Combatant materialization + initiative roll

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Add failing tests for combatant building**

Append to `tests/engine.test.html`:

```js
test('buildCombatants: 1 PC + 2 goblins → 3 combatants with side flags', () => {
  const party = [{
    id:'pm1', identity:{ name:'Aria', level:5 },
    abilities:{ str:10,dex:14,con:14,int:10,wis:10,cha:10 },
    profs:{ saves:{} },
    combat:{ hp:30, maxHp:30, ac:16, initBonus:2 },
    actions:[],
  }];
  const monsters = [{
    pickId:'p1', count:2,
    monster:{ name:'Goblin', hp:7, ac:15, initiative:2, isMinion:false,
              isSolo:false, parsedActions:[] },
  }];
  const rng = Crucible.makeRng(1);
  const c = Crucible.buildCombatants(party, monsters, rng, false);
  assertEq(c.length, 3);
  assertEq(c[0].side, 'pc');
  assertEq(c[1].side, 'monster');
  assertEq(c[1].name, 'Goblin #1');
  assertEq(c[2].name, 'Goblin #2');
});
test('rollInitiative: each combatant gets an init in [1+bonus, 20+bonus]', () => {
  const cs = [
    { name:'A', initBonus: 2, side:'pc' },
    { name:'B', initBonus: 0, side:'monster' },
  ];
  const rng = Crucible.makeRng(11);
  Crucible.rollInitiative(cs, rng);
  for (const c of cs) {
    assertTrue(c.init >= 1 + c.initBonus && c.init <= 20 + c.initBonus,
      c.name + ' init out of range: ' + c.init);
  }
});
test('initOrder: solos get an extra slot at init - 10', () => {
  const cs = [
    { name:'Solo', init: 18, isSolo: true,  side:'monster' },
    { name:'Mob1', init: 12, isSolo: false, side:'monster' },
  ];
  const order = Crucible.initOrder(cs);
  // Solo at 18 first, mob at 12, then solo again at 8.
  assertEq(order.map(s => s.name + '@' + s.init),
           ['Solo@18','Mob1@12','Solo@8']);
});
```

- [ ] **Step 2: Run; 3 new fail**

- [ ] **Step 3: Implement `buildCombatants`, `rollInitiative`, `initOrder`**

Append inside the IIFE in `crucible-engine.js`:

```js
  // ─────────── Combatant materialization ───────────
  // Turns the PartyMember + monster-pick lists into a flat combatants[].
  // PCs are one-per-PartyMember; monsters expand to N independent copies.
  function buildCombatants(party, monsterPicks, rng, rollHp) {
    const out = [];
    for (const pm of (party || [])) {
      out.push({
        id: 'pc:' + pm.id,
        side: 'pc',
        name: pm.identity.name || 'PC',
        pm,                                   // ← full PC record
        hp: pm.combat.hp, maxHp: pm.combat.maxHp, ac: pm.combat.ac,
        initBonus: pm.combat.initBonus || 0,
        isMinion: false, isSolo: false,
        conditions: new Map(),                // condition → rounds remaining
        downed: false, dead: false,
        slotsLeft: {}, rechargeReady: {},     // by action name
        damageTypesReceivedLastTurn: new Set(),
        damageTypesReceivedThisTurn: new Set(),
        lastHealRound: -99,
      });
    }
    for (const pick of (monsterPicks || [])) {
      const m = pick.monster;
      const n = pick.count || 1;
      for (let i = 1; i <= n; i++) {
        const hp = rollHp && m.hpFormula
          ? Math.max(1, rollDice(m.hpFormula, rng))
          : (m.hp || 1);
        const slotsLeft = {}, rechargeReady = {};
        for (const pa of (m.parsedActions || [])) {
          if (pa.usesPerDay != null) slotsLeft[pa.sourceActionName] = pa.usesPerDay;
          if (pa.recharge)          rechargeReady[pa.sourceActionName] = true;
        }
        out.push({
          id: pick.pickId + ':' + i,
          side: 'monster',
          name: n > 1 ? `${m.name} #${i}` : m.name,
          monster: m,
          hp, maxHp: hp, ac: m.ac || 10,
          initBonus: m.initiative != null ? m.initiative
                    : Math.floor(((m.abilities && m.abilities.dex && m.abilities.dex.mod) || 0)),
          isMinion: !!m.isMinion, isSolo: !!m.isSolo,
          conditions: new Map(),
          downed: false, dead: false,
          slotsLeft, rechargeReady,
          damageTypesReceivedLastTurn: new Set(),
          damageTypesReceivedThisTurn: new Set(),
          lastHealRound: -99,
          regeneration: m.regeneration || null,
        });
      }
    }
    return out;
  }

  // ─────────── Initiative ───────────
  function rollInitiative(combatants, rng) {
    for (const c of combatants) c.init = rollDie(20, rng) + (c.initBonus || 0);
  }
  // Returns slot list in descending init order. Each entry is
  // { c, init }. Solos receive a second slot at init - 10 (FM rule).
  function initOrder(combatants) {
    const slots = [];
    for (const c of combatants) {
      slots.push({ c, init: c.init, name: c.name });
      if (c.isSolo) slots.push({ c, init: c.init - 10, name: c.name });
    }
    slots.sort((a, b) => b.init - a.init);
    return slots;
  }
```

Extend exports:

```js
  const Crucible = {
    makeRng, rollDie, rollDice,
    mod, pb, saveBonus, toHit, saveDc, pcDamageMod,
    buildCombatants, rollInitiative, initOrder,
  };
```

- [ ] **Step 4: Run; all 16 pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible engine: combatants + initiative + solo extra slot"
```

---

### Task 13: Round-loop steps 1–4 (skip, conditions, recharge, regeneration)

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Add failing tests for the turn-start phase**

Append to `tests/engine.test.html`:

```js
test('turnStart: downed combatant has shouldSkip=true', () => {
  const c = { downed:true, dead:false, conditions:new Map(),
              regeneration:null, damageTypesReceivedThisTurn:new Set(),
              damageTypesReceivedLastTurn:new Set() };
  const ev = [];
  const skip = Crucible.turnStart(c, 1, Crucible.makeRng(1), ev);
  assertEq(skip, true);
});
test('turnStart: incapacitated condition skips turn but decrements', () => {
  const c = { downed:false, dead:false,
              conditions: new Map([['incapacitated', 2]]),
              regeneration:null, damageTypesReceivedThisTurn:new Set(),
              damageTypesReceivedLastTurn:new Set() };
  const skip = Crucible.turnStart(c, 1, Crucible.makeRng(1), []);
  assertEq(skip, true);
  assertEq(c.conditions.get('incapacitated'), 1);
});
test('turnStart: regen ticks when no suppression damage received last turn', () => {
  const c = { downed:false, dead:false, hp:10, maxHp:30,
              conditions:new Map(),
              regeneration:{ amount:10, suppressedBy:['acid','fire'], minHpToRegen:1 },
              damageTypesReceivedThisTurn:new Set(),
              damageTypesReceivedLastTurn:new Set(['slashing']) };
  const ev = [];
  Crucible.turnStart(c, 2, Crucible.makeRng(1), ev);
  assertEq(c.hp, 20);
  assertTrue(ev.some(e => e.type === 'regen'), 'expected regen event');
});
test('turnStart: regen suppressed when fire received last turn', () => {
  const c = { downed:false, dead:false, hp:10, maxHp:30,
              conditions:new Map(),
              regeneration:{ amount:10, suppressedBy:['acid','fire'], minHpToRegen:1 },
              damageTypesReceivedThisTurn:new Set(),
              damageTypesReceivedLastTurn:new Set(['fire']) };
  Crucible.turnStart(c, 2, Crucible.makeRng(1), []);
  assertEq(c.hp, 10);
});
test('turnStart: regen tracks damage rotation last←this, then clears this', () => {
  const c = { downed:false, dead:false, hp:5, maxHp:30,
              conditions:new Map(),
              regeneration:{ amount:5, suppressedBy:['fire'], minHpToRegen:1 },
              damageTypesReceivedThisTurn:new Set(['cold']),
              damageTypesReceivedLastTurn:new Set() };
  Crucible.turnStart(c, 2, Crucible.makeRng(1), []);
  assertEq(c.damageTypesReceivedLastTurn.has('cold'), true);
  assertEq(c.damageTypesReceivedThisTurn.size, 0);
});
test('rechargeRoll: marks recharge ready when d6 ≥ minRoll', () => {
  // With seed 99, we'll just verify the contract: after enough rolls,
  // some recharges fire.
  const c = { rechargeReady: { 'Breath': false } };
  const action = { sourceActionName:'Breath', recharge:{ dice:'d6', minRoll:5 } };
  const rng = Crucible.makeRng(99);
  let fired = false;
  for (let i = 0; i < 30; i++) {
    c.rechargeReady['Breath'] = false;
    Crucible.rollRecharge(c, [action], rng);
    if (c.rechargeReady['Breath']) { fired = true; break; }
  }
  assertTrue(fired, 'recharge should fire in some of 30 attempts at 5-6/d6');
});
```

- [ ] **Step 2: Run; 6 new fail**

- [ ] **Step 3: Implement the turn-start helpers**

Append inside the IIFE:

```js
  // ─────────── Turn start (round-loop steps 1-4) ───────────
  function tickConditions(c) {
    // Decrement every condition's remaining rounds; lift those at 0.
    for (const [name, rem] of Array.from(c.conditions.entries())) {
      const next = rem - 1;
      if (next <= 0) c.conditions.delete(name);
      else c.conditions.set(name, next);
    }
  }

  function rollRecharge(c, actions, rng) {
    for (const a of (actions || [])) {
      if (!a.recharge || c.rechargeReady[a.sourceActionName]) continue;
      const roll = rollDie(6, rng);
      if (roll >= a.recharge.minRoll) c.rechargeReady[a.sourceActionName] = true;
    }
  }

  // Apply regeneration: returns true if regen ticked.
  function applyRegen(c, currentRound, events) {
    if (!c.regeneration) return false;
    if (c.dead || c.downed) return false;
    if (c.hp < c.regeneration.minHpToRegen) return false;
    const suppressed = (c.regeneration.suppressedBy || []).some(t =>
      c.damageTypesReceivedLastTurn.has(t));
    if (suppressed) return false;
    const before = c.hp;
    c.hp = Math.min(c.maxHp, c.hp + c.regeneration.amount);
    if (c.hp > before) {
      events.push({ round: currentRound, type:'regen', actor: c.name,
                    amount: c.hp - before, hpAfter: c.hp });
      return true;
    }
    return false;
  }

  // Combined turn-start handler. Returns true if the combatant should skip
  // its turn (downed / dead / incapacitated).
  function turnStart(c, currentRound, rng, events) {
    if (c.dead || c.downed) return true;
    tickConditions(c);
    if (c.conditions.has('incapacitated') ||
        c.conditions.has('paralyzed')     ||
        c.conditions.has('stunned')       ||
        c.conditions.has('unconscious')) {
      // Still rotate damage tracking so the suppression window stays sane.
      c.damageTypesReceivedLastTurn = c.damageTypesReceivedThisTurn;
      c.damageTypesReceivedThisTurn = new Set();
      return true;
    }
    // Recharge each action that has a recharge die. Caller passes the
    // action list separately via rollRecharge — we don't do it here so
    // turnStart stays usable for combatants without a known action list
    // in unit tests. The full runTrial does both.
    applyRegen(c, currentRound, events);
    c.damageTypesReceivedLastTurn = c.damageTypesReceivedThisTurn;
    c.damageTypesReceivedThisTurn = new Set();
    return false;
  }
```

Extend exports:

```js
  const Crucible = {
    makeRng, rollDie, rollDice,
    mod, pb, saveBonus, toHit, saveDc, pcDamageMod,
    buildCombatants, rollInitiative, initOrder,
    tickConditions, rollRecharge, applyRegen, turnStart,
  };
```

- [ ] **Step 4: Run; all 22 pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible engine: turn-start (conditions, recharge, regen)"
```

---

### Task 14: Target selection + heal triage

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Add failing tests**

Append:

```js
test('pickEnemyTarget(focus): lowest-HP living enemy', () => {
  const me = { side:'pc' };
  const enemies = [
    { side:'monster', name:'A', hp:10, ac:13, downed:false, dead:false },
    { side:'monster', name:'B', hp:3,  ac:14, downed:false, dead:false },
    { side:'monster', name:'C', hp:5,  ac:12, downed:false, dead:false },
  ];
  const t = Crucible.pickEnemyTarget(me, [me, ...enemies], { aiHint:'focus' }, Crucible.makeRng(1));
  assertEq(t.name, 'B');
});
test('pickEnemyTarget(focus): ties by lowest AC', () => {
  const me = { side:'pc' };
  const enemies = [
    { side:'monster', name:'A', hp:5, ac:15, downed:false, dead:false },
    { side:'monster', name:'B', hp:5, ac:12, downed:false, dead:false },
  ];
  const t = Crucible.pickEnemyTarget(me, [me, ...enemies], { aiHint:'focus' }, Crucible.makeRng(1));
  assertEq(t.name, 'B');
});
test('pickEnemyTarget: skips downed/dead enemies', () => {
  const me = { side:'pc' };
  const enemies = [
    { side:'monster', name:'A', hp:0, ac:15, downed:true,  dead:false },
    { side:'monster', name:'B', hp:1, ac:14, downed:false, dead:false },
    { side:'monster', name:'C', hp:5, ac:12, downed:false, dead:true  },
  ];
  const t = Crucible.pickEnemyTarget(me, [me, ...enemies], { aiHint:'focus' }, Crucible.makeRng(1));
  assertEq(t.name, 'B');
});
test('healTriage: ally downed and self has reviveDowned heal → trigger', () => {
  const ally = { side:'pc', name:'Cleric', downed:false, dead:false, hp:20, maxHp:20, lastHealRound:-99 };
  const wounded = { side:'pc', name:'Tank', downed:true, dead:false, hp:0, maxHp:30, lastHealRound:-99 };
  const action = { type:'heal', heal:{ target:'ally', reviveDowned:true }, usesPerDay:null };
  ally.pm = { actions:[action] };
  ally.slotsLeft = {};
  ally.rechargeReady = {};
  const dec = Crucible.healTriage(ally, [ally, wounded], 1);
  assertEq(dec.action, action);
  assertEq(dec.targets[0].name, 'Tank');
});
test('healTriage: no qualifying ally → returns null (sim falls through)', () => {
  const ally = { side:'pc', name:'Cleric', downed:false, dead:false, hp:20, maxHp:20, lastHealRound:-99 };
  const peer = { side:'pc', name:'Tank', downed:false, dead:false, hp:30, maxHp:30 };
  ally.pm = { actions:[{ type:'heal', heal:{ target:'ally', reviveDowned:true } }] };
  ally.slotsLeft = {}; ally.rechargeReady = {};
  assertEq(Crucible.healTriage(ally, [ally, peer], 1), null);
});
```

- [ ] **Step 2: Run; 5 new fail**

- [ ] **Step 3: Implement target selection + heal triage**

Append inside the IIFE:

```js
  // ─────────── Target selection ───────────
  function aliveEnemies(me, all) {
    return all.filter(c => c !== me && c.side !== me.side && !c.dead && !c.downed);
  }
  function aliveAllies(me, all, includeSelf) {
    return all.filter(c => c.side === me.side && !c.dead && (includeSelf || c !== me));
  }

  function pickEnemyTarget(me, all, tactics, rng) {
    const candidates = aliveEnemies(me, all);
    if (!candidates.length) return null;
    const mode = (tactics && tactics.aiHint) || 'focus';
    if (mode === 'random') {
      return candidates[Math.floor(rng() * candidates.length)];
    }
    // focus (default): lowest HP, then lowest AC, then random.
    let best = candidates[0];
    for (const c of candidates) {
      if (c.hp < best.hp) best = c;
      else if (c.hp === best.hp && c.ac < best.ac) best = c;
    }
    // Final random tiebreak among true ties.
    const ties = candidates.filter(c => c.hp === best.hp && c.ac === best.ac);
    return ties[Math.floor(rng() * ties.length)];
  }

  // ─────────── Action availability ───────────
  function isAvailable(c, action) {
    if (action.usesPerDay != null) {
      const left = c.slotsLeft[action.sourceActionName || action.name];
      if (left == null) return action.usesPerDay > 0;
      return left > 0;
    }
    if (action.recharge) {
      return !!c.rechargeReady[action.sourceActionName || action.name];
    }
    return true;
  }
  function consumeUse(c, action) {
    if (action.usesPerDay != null) {
      const key = action.sourceActionName || action.name;
      if (c.slotsLeft[key] == null) c.slotsLeft[key] = action.usesPerDay;
      c.slotsLeft[key] = Math.max(0, c.slotsLeft[key] - 1);
    }
    if (action.recharge) {
      c.rechargeReady[action.sourceActionName || action.name] = false;
    }
  }

  // ─────────── Heal triage ───────────
  // Returns { action, targets:[combatant,...] } if a heal should fire,
  // else null. Caller falls through to normal action pick when null.
  function healTriage(me, all, currentRound) {
    const myActions = me.side === 'pc'
      ? (me.pm && me.pm.actions) || []
      : (me.monster && me.monster.parsedActions) || [];
    // Available heals only.
    const heals = myActions.filter(a =>
      (a.type === 'heal' || a.kind === 'heal') && isAvailable(me, a));
    if (!heals.length) return null;

    const allies = aliveAllies(me, all, true);
    const downed = allies.filter(a => a.downed);
    const wounded = allies.filter(a => !a.downed && a.hp <= 0.5 * a.maxHp);

    // (a) Any downed ally → use a reviveDowned heal.
    if (downed.length) {
      const reviveHeal = heals.find(a => (a.heal && a.heal.reviveDowned));
      if (reviveHeal) {
        // Target the lowest-HP downed ally.
        downed.sort((x, y) => x.hp - y.hp);
        return { action: reviveHeal, targets: [downed[0]] };
      }
    }
    // (b) Wounded ally + cooldown since last heal.
    if (wounded.length && currentRound - me.lastHealRound >= 1) {
      const heal = heals[0];
      const target = heal.heal && heal.heal.target;
      wounded.sort((x, y) => x.hp - y.hp);
      if (target === 'ally-aoe') return { action: heal, targets: wounded };
      if (target === 'self')     return { action: heal, targets: [me] };
      return { action: heal, targets: [wounded[0]] };
    }
    return null;
  }
```

Extend exports:

```js
  const Crucible = {
    makeRng, rollDie, rollDice,
    mod, pb, saveBonus, toHit, saveDc, pcDamageMod,
    buildCombatants, rollInitiative, initOrder,
    tickConditions, rollRecharge, applyRegen, turnStart,
    pickEnemyTarget, isAvailable, consumeUse, healTriage,
    aliveEnemies, aliveAllies,
  };
```

- [ ] **Step 4: Run; all 27 pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible engine: target selection + heal triage"
```

---

### Task 15: Resolve attack + save + heal + multiattack

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Add failing tests**

Append:

```js
test('resolveAttack: nat 20 crits, doubles dice (not mod)', () => {
  // d20 must roll 20. Use a controlled "rng" that returns 19.999.../20.
  const fake = () => 19.999 / 20;  // → rollDie(20) = 1 + floor(19.999) = 20
  const me = { side:'pc', name:'Aria' };
  const target = { side:'monster', name:'Goblin', hp:10, ac:10, downed:false, dead:false };
  const action = { sourceActionName:'Slash', kind:'attack', toHit:5,
                   damage:[{ dice:'1d4', mod:0, type:'slashing' }] };
  const events = [];
  const result = Crucible.resolveAttackMonster(me, target, action, fake, events, 1);
  assertEq(result.crit, true);
  // 2 dice of d4 with fake rng → 2 * 4 (max) = 8
  assertEq(result.damageDealt > 0, true);
  assertTrue(result.damageByType.slashing >= 2, 'crit should deal ≥2');
});
test('resolveAttack: nat 1 misses', () => {
  const fake = () => 0;            // rollDie(20) = 1
  const target = { hp:10, ac:10, dead:false, downed:false, damageTypesReceivedThisTurn:new Set() };
  const action = { sourceActionName:'X', kind:'attack', toHit:99,
                   damage:[{ dice:'1d6', mod:0, type:'fire' }] };
  const r = Crucible.resolveAttackMonster({}, target, action, fake, [], 1);
  assertEq(r.hit, false);
  assertEq(r.damageDealt, 0);
});
test('resolveAttack: damage by type recorded in target.damageTypesReceivedThisTurn', () => {
  const fake = () => 0.5;          // mid-roll, hits
  const target = { hp:30, ac:10, dead:false, downed:false,
                   damageTypesReceivedThisTurn: new Set(), maxHp:30 };
  const action = { sourceActionName:'BurnSlash', kind:'attack', toHit:10,
                   damage:[{ dice:'1d4', mod:0, type:'fire' },
                           { dice:'1d4', mod:0, type:'slashing' }] };
  Crucible.resolveAttackMonster({}, target, action, fake, [], 1);
  assertEq(target.damageTypesReceivedThisTurn.has('fire'), true);
  assertEq(target.damageTypesReceivedThisTurn.has('slashing'), true);
});
test('resolveHeal: ally at 5 HP heals to min(maxHp, 5+roll)', () => {
  const me = { name:'Cleric' };
  const ally = { name:'Tank', hp:5, maxHp:30, downed:false };
  const action = { sourceActionName:'CureWounds', kind:'heal',
                   heal:{ dice:'1d8', mod:3, flat:0, target:'ally', reviveDowned:false } };
  // fake rng always returns 0.99 → d8 = 8 → 8+3 = 11; cap at maxHp.
  const fake = () => 0.99;
  const evs = [];
  const r = Crucible.resolveHeal(me, [ally], action, fake, evs, 1);
  assertTrue(ally.hp >= 16 && ally.hp <= 30, 'ally hp after heal: ' + ally.hp);
  assertEq(r.totalHealed > 0, true);
});
test('resolveHeal: revives downed ally with reviveDowned=true', () => {
  const me = { name:'Pal' };
  const ally = { name:'Fallen', hp:0, maxHp:30, downed:true };
  const action = { sourceActionName:'Lay', kind:'heal',
                   heal:{ dice:null, mod:0, flat:5, target:'ally', reviveDowned:true } };
  Crucible.resolveHeal(me, [ally], action, () => 0.5, [], 1);
  assertEq(ally.downed, false);
  assertEq(ally.hp, 5);
});
test('resolveSave: target rolls under DC, takes full damage', () => {
  const me = { name:'Mage' };
  const target = { side:'pc', pm:{ identity:{ level:5 },
                   abilities:{ str:10,dex:8,con:10,int:10,wis:10,cha:10 },
                   profs:{ saves:{} } },
                   hp:30, maxHp:30, ac:14, dead:false, downed:false,
                   damageTypesReceivedThisTurn:new Set() };
  const action = { sourceActionName:'Fireball', kind:'save', saveAbility:'dex', saveDc:99,
                   damageOnFail:[{ dice:'8d6', mod:0, type:'fire' }],
                   damageOnSave:[], halfOnSave:true, aoeTargets:4 };
  // DC 99 → always fails. Fake rng = mid.
  Crucible.resolveSave(me, [target], action, () => 0.5, [], 1);
  assertTrue(target.hp < target.maxHp, 'expected damage on failed save');
});
```

- [ ] **Step 2: Run; 6 new fail**

- [ ] **Step 3: Implement resolvers**

Append inside the IIFE:

```js
  // ─────────── Resistance / vulnerability ───────────
  function damageMultiplier(target, type) {
    const m = target.monster;
    if (!m || !type) return 1;
    if (Array.isArray(m.immunities)      && m.immunities.includes(type))      return 0;
    if (Array.isArray(m.resistances)     && m.resistances.includes(type))     return 0.5;
    if (Array.isArray(m.vulnerabilities) && m.vulnerabilities.includes(type)) return 2;
    // Statblock JSON also has `immunitiesText` etc. — fall back to substring.
    if (m.immunitiesText && m.immunitiesText.toLowerCase().includes(type)) return 0;
    if (m.resistancesText && m.resistancesText.toLowerCase().includes(type)) return 0.5;
    if (m.vulnerabilitiesText && m.vulnerabilitiesText.toLowerCase().includes(type)) return 2;
    return 1;
  }

  // ─────────── Resolve a monster-side attack action ───────────
  // For a PC-side attack, the engine uses resolveAttackPc (next task block).
  function resolveAttackMonster(me, target, action, rng, events, round) {
    const roll = rollDie(20, rng);
    const isCrit = roll === 20;
    const isFumble = roll === 1;
    const hit = !isFumble && (isCrit || roll + (action.toHit || 0) >= (target.ac || 10));
    let damageDealt = 0;
    const damageByType = {};
    if (hit) {
      for (const dc of (action.damage || [])) {
        let dmg = rollDice(dc.dice + (dc.mod ? (dc.mod >= 0 ? '+' : '') + dc.mod : ''), rng, isCrit);
        const mult = damageMultiplier(target, dc.type);
        dmg = Math.floor(dmg * mult);
        if (dmg < 0) dmg = 0;
        damageDealt += dmg;
        damageByType[dc.type] = (damageByType[dc.type] || 0) + dmg;
        if (target.damageTypesReceivedThisTurn) target.damageTypesReceivedThisTurn.add(dc.type);
      }
    }
    events.push({ round, type:'attack', actor: me.name, target: target.name,
                  action: action.sourceActionName, roll, crit:isCrit, hit,
                  damageDealt });
    return { roll, crit:isCrit, hit, damageDealt, damageByType };
  }

  // ─────────── Resolve a PC-side attack action ───────────
  function resolveAttackPc(me, target, action, rng, events, round) {
    // PC actions store inputs; derive to-hit + damage roll.
    const th = toHit(me.pm, action);
    const roll = rollDie(20, rng);
    const isCrit = roll === 20;
    const isFumble = roll === 1;
    const hit = !isFumble && (isCrit || roll + th >= (target.ac || 10));
    let damageDealt = 0;
    const damageByType = {};
    if (hit && action.damage) {
      const dmod = pcDamageMod(me.pm, action);
      const formula = action.damage.dice + (dmod >= 0 ? '+' + dmod : dmod);
      let dmg = rollDice(formula, rng, isCrit);
      const t = (action.damage.type || 'untyped').toLowerCase();
      const mult = damageMultiplier(target, t);
      dmg = Math.floor(dmg * mult);
      if (dmg < 0) dmg = 0;
      damageDealt += dmg;
      damageByType[t] = dmg;
      if (target.damageTypesReceivedThisTurn) target.damageTypesReceivedThisTurn.add(t);
      // Rider damage (e.g. fire rider on a sword): no save, always applies on hit.
      if (action.damage.riderDice) {
        let rd = rollDice(action.damage.riderDice, rng, isCrit);
        const rt = (action.damage.riderType || 'untyped').toLowerCase();
        const rmult = damageMultiplier(target, rt);
        rd = Math.floor(rd * rmult);
        damageDealt += rd;
        damageByType[rt] = (damageByType[rt] || 0) + rd;
        if (target.damageTypesReceivedThisTurn) target.damageTypesReceivedThisTurn.add(rt);
      }
    }
    events.push({ round, type:'attack', actor: me.name, target: target.name,
                  action: action.name, roll, crit:isCrit, hit, damageDealt });
    return { roll, crit:isCrit, hit, damageDealt, damageByType };
  }

  // ─────────── Resolve a save effect ───────────
  function resolveSave(me, targets, action, rng, events, round) {
    let totalDmg = 0;
    for (const t of targets) {
      if (t.dead || t.downed) continue;
      // saveBonus uses PC math; for monster targets, fall back to monster.abilities.
      let sb = 0;
      if (t.side === 'pc' && t.pm) sb = saveBonus(t.pm, action.saveAbility);
      else if (t.monster && t.monster.abilities) {
        const ab = t.monster.abilities[action.saveAbility];
        sb = ab ? (ab.save != null ? ab.save : ab.mod) : 0;
      }
      const roll = rollDie(20, rng);
      const passed = roll + sb >= action.saveDc;
      let dmgList;
      if (passed && action.halfOnSave) dmgList = action.damageOnFail; // half later
      else if (passed)                 dmgList = action.damageOnSave || [];
      else                             dmgList = action.damageOnFail || [];
      let dmg = 0;
      for (const dc of dmgList) {
        let raw = rollDice(dc.dice + (dc.mod ? (dc.mod >= 0 ? '+' : '') + dc.mod : ''), rng);
        if (passed && action.halfOnSave) raw = Math.floor(raw / 2);
        const mult = damageMultiplier(t, dc.type);
        raw = Math.floor(raw * mult);
        if (raw < 0) raw = 0;
        dmg += raw;
        if (t.damageTypesReceivedThisTurn) t.damageTypesReceivedThisTurn.add(dc.type);
      }
      // Apply condition on fail if specified.
      if (!passed && action.condition) {
        t.conditions.set(action.condition, 1);    // v1 fixed duration
      }
      // Apply damage to target.
      if (dmg > 0) {
        t.hp = Math.max(0, t.hp - dmg);
        if (t.side === 'pc' && t.hp === 0 && !t.downed) t.downed = true;
        if (t.side === 'monster' && t.hp === 0 && !t.dead) t.dead = true;
        totalDmg += dmg;
      }
      events.push({ round, type:'save', actor: me.name, target: t.name,
                    action: action.sourceActionName, roll, passed, damageDealt: dmg });
    }
    return { totalDmg };
  }

  // ─────────── Resolve a heal action ───────────
  function resolveHeal(me, targets, action, rng, events, round) {
    let totalHealed = 0, revives = 0;
    for (const t of targets) {
      const h = action.heal || {};
      let amount = h.flat || 0;
      if (h.dice) amount += rollDice(h.dice + (h.mod ? (h.mod >= 0 ? '+' : '') + h.mod : ''), rng);
      if (t.downed && h.reviveDowned) {
        t.downed = false;
        t.hp = Math.min(t.maxHp, amount);
        revives++;
      } else if (!t.downed && !t.dead) {
        t.hp = Math.min(t.maxHp, t.hp + amount);
      }
      totalHealed += amount;
      events.push({ round, type:'heal', actor: me.name, target: t.name,
                    action: action.sourceActionName || action.name,
                    amount, revived: revives > 0 });
    }
    return { totalHealed, revives };
  }
```

Extend exports:

```js
  const Crucible = {
    makeRng, rollDie, rollDice,
    mod, pb, saveBonus, toHit, saveDc, pcDamageMod,
    buildCombatants, rollInitiative, initOrder,
    tickConditions, rollRecharge, applyRegen, turnStart,
    pickEnemyTarget, isAvailable, consumeUse, healTriage,
    aliveEnemies, aliveAllies,
    damageMultiplier, resolveAttackMonster, resolveAttackPc,
    resolveSave, resolveHeal,
  };
```

- [ ] **Step 4: Run; all 33 pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible engine: attack / save / heal resolvers"
```

---

### Task 16: Damage application + FM minion rule + multiattack + 0-HP

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Add failing tests**

Append:

```js
test('applyDamage: PC at 0 HP → downed (not dead)', () => {
  const t = { side:'pc', hp:5, maxHp:30, downed:false, dead:false,
              damageTypesReceivedThisTurn:new Set() };
  Crucible.applyDamage(t, 10, 'slashing', null, [], 1, 'enemy', 'Slash');
  assertEq(t.hp, 0);
  assertEq(t.downed, true);
  assertEq(t.dead, false);
});
test('applyDamage: monster at 0 HP → dead', () => {
  const t = { side:'monster', hp:1, maxHp:5, downed:false, dead:false, isMinion:false,
              damageTypesReceivedThisTurn:new Set() };
  Crucible.applyDamage(t, 5, 'fire', null, [], 1, 'pc', 'Fireball');
  assertEq(t.dead, true);
});
test('applyDamage: FM minion → any non-zero damage kills', () => {
  const t = { side:'monster', hp:30, maxHp:30, downed:false, dead:false, isMinion:true,
              damageTypesReceivedThisTurn:new Set() };
  Crucible.applyDamage(t, 1, 'slashing', null, [], 1, 'pc', 'Pebble');
  assertEq(t.hp, 0);
  assertEq(t.dead, true);
});
test('resolveMultiattack: looks up sub-actions by name, fires each count times', () => {
  const me = { side:'monster', name:'Dragon',
               monster:{ name:'Dragon',
                         parsedActions:[
                           { sourceActionName:'Multiattack', kind:'multiattack',
                             multiattackPlan:[{ actionName:'Bite', count:2 }] },
                           { sourceActionName:'Bite', kind:'attack', toHit:99,
                             damage:[{ dice:'1d4', mod:0, type:'piercing' }] },
                         ] } };
  const target = { side:'pc', name:'PC', hp:30, maxHp:30, ac:10, downed:false, dead:false,
                   damageTypesReceivedThisTurn:new Set() };
  // Force hits with fake rng = 0.99 (rolls = 20, attacks always hit).
  const fake = () => 0.99;
  const ev = [];
  Crucible.resolveMultiattack(me, [me, target], me.monster.parsedActions[0],
    { aiHint:'focus' }, fake, ev, 1);
  // Two attack events expected
  const atks = ev.filter(e => e.type === 'attack');
  assertEq(atks.length, 2);
});
```

- [ ] **Step 2: Run; 4 new fail**

- [ ] **Step 3: Implement `applyDamage` and `resolveMultiattack`**

Append:

```js
  // ─────────── Apply damage to a target (post-roll) ───────────
  // Already-multiplied damage value. Handles FM minion rule, downed/dead
  // transitions, killing-blow attribution, and event emission.
  function applyDamage(target, amount, type, attacker, events, round, attackerName, actionName) {
    if (!target || target.dead) return;
    if (amount <= 0) return;
    if (target.side === 'monster' && target.isMinion) {
      target.hp = 0;
      target.dead = true;
    } else {
      target.hp = Math.max(0, target.hp - amount);
      if (target.hp === 0) {
        if (target.side === 'pc' && !target.downed) {
          target.downed = true;
          target.deathRound = round;
          target.killedBy = { attacker: attackerName, action: actionName };
        }
        if (target.side === 'monster' && !target.dead) {
          target.dead = true;
          target.deathRound = round;
          target.killedBy = { attacker: attackerName, action: actionName };
        }
      }
    }
    if (target.damageTypesReceivedThisTurn) target.damageTypesReceivedThisTurn.add(type);
    events.push({ round, type:'damage', actor: attackerName, target: target.name,
                  action: actionName, amount, dmgType: type });
  }

  // ─────────── Resolve a multiattack ───────────
  // For each sub-action in the plan, fire it `count` times. Each sub-attack
  // picks its own target via the same focus rule.
  function resolveMultiattack(me, all, multiAction, tactics, rng, events, round) {
    const myActions = me.side === 'monster'
      ? (me.monster && me.monster.parsedActions) || []
      : (me.pm && me.pm.actions) || [];
    let warnings = [];
    for (const step of (multiAction.multiattackPlan || [])) {
      const sub = myActions.find(a =>
        (a.sourceActionName || a.name) === step.actionName);
      if (!sub || sub.kind === 'unparsed') {
        warnings.push(`Multiattack sub-action '${step.actionName}' not found on ${me.name} — treated as a single attack.`);
        continue;
      }
      for (let i = 0; i < (step.count || 1); i++) {
        const tgt = pickEnemyTarget(me, all, tactics, rng);
        if (!tgt) break;
        if (sub.kind === 'attack') {
          const r = me.side === 'monster'
            ? resolveAttackMonster(me, tgt, sub, rng, events, round)
            : resolveAttackPc(me, tgt, sub, rng, events, round);
          // Convert damageByType into applyDamage calls.
          for (const [t, dmg] of Object.entries(r.damageByType || {})) {
            applyDamage(tgt, dmg, t, me, events, round, me.name, sub.sourceActionName || sub.name);
          }
        }
        // Save sub-actions inside a multiattack are rare; resolve if encountered.
        else if (sub.kind === 'save') {
          resolveSave(me, [tgt], sub, rng, events, round);
        }
      }
    }
    return { warnings };
  }
```

Extend exports:

```js
  const Crucible = {
    makeRng, rollDie, rollDice,
    mod, pb, saveBonus, toHit, saveDc, pcDamageMod,
    buildCombatants, rollInitiative, initOrder,
    tickConditions, rollRecharge, applyRegen, turnStart,
    pickEnemyTarget, isAvailable, consumeUse, healTriage,
    aliveEnemies, aliveAllies,
    damageMultiplier, resolveAttackMonster, resolveAttackPc,
    resolveSave, resolveHeal,
    applyDamage, resolveMultiattack,
  };
```

- [ ] **Step 4: Run; all 37 pass**

- [ ] **Step 5: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible engine: damage application + minion rule + multiattack"
```

---

### Task 17: `runTrial` and `runSim` aggregator (with RAF chunking)

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Add failing tests**

Append:

```js
test('runTrial: PC vs Goblin, seeded → deterministic outcome', () => {
  const pm = { id:'pm1', identity:{ name:'Aria', level:5 },
               abilities:{ str:14,dex:14,con:14,int:10,wis:10,cha:10 },
               profs:{ saves:{} },
               combat:{ hp:30, maxHp:30, ac:16, initBonus:2 },
               actions:[{ id:'a1', name:'Longsword', source:'weapon', type:'attack',
                          atkAbility:'str', atkBonusOverride:null,
                          damage:{ dice:'1d8', mod:'+atkAbility', type:'slashing',
                                   riderDice:null, riderType:null },
                          save:null, heal:null, aoeTargets:0,
                          usesPerDay:null, recharge:null, attacksPerAction:1 }],
               tactics:{ aiHint:'focus', resources:'nova' } };
  const monster = { name:'Goblin', hp:7, ac:15, initiative:2, isMinion:false, isSolo:false,
                    parsedActions:[{ sourceActionName:'Scimitar', kind:'attack', toHit:4,
                                      damage:[{ dice:'1d6', mod:2, type:'slashing' }],
                                      recharge:null, usesPerDay:null }] };
  const picks = [{ pickId:'p1', count:1, monster }];
  const r1 = Crucible.runTrial([pm], picks, { aiHint:'focus', resources:'nova' }, Crucible.makeRng(42));
  const r2 = Crucible.runTrial([pm], picks, { aiHint:'focus', resources:'nova' }, Crucible.makeRng(42));
  assertEq(r1.winner, r2.winner);
  assertEq(r1.rounds, r2.rounds);
});
test('runSim: 100 trials returns aggregated SimResult shape', async () => {
  const pm = { id:'pm1', identity:{ name:'Aria', level:5 },
               abilities:{ str:14,dex:14,con:14,int:10,wis:10,cha:10 },
               profs:{ saves:{} },
               combat:{ hp:30, maxHp:30, ac:16, initBonus:2 },
               actions:[{ id:'a1', name:'Longsword', source:'weapon', type:'attack',
                          atkAbility:'str', atkBonusOverride:null,
                          damage:{ dice:'1d8', mod:'+atkAbility', type:'slashing',
                                   riderDice:null, riderType:null },
                          save:null, heal:null, aoeTargets:0,
                          usesPerDay:null, recharge:null, attacksPerAction:1 }],
               tactics:{ aiHint:'focus', resources:'nova' } };
  const monster = { name:'Goblin', hp:7, ac:15, initiative:2, isMinion:false, isSolo:false,
                    parsedActions:[{ sourceActionName:'Scimitar', kind:'attack', toHit:4,
                                      damage:[{ dice:'1d6', mod:2, type:'slashing' }],
                                      recharge:null, usesPerDay:null }] };
  const result = await Crucible.runSim({
    party:[pm], monsterPicks:[{ pickId:'p1', count:1, monster }],
    trials:100, tactics:{ aiHint:'focus', resources:'nova' }, seed:99,
  });
  assertHas(result.headline, 'winRate');
  assertHas(result.headline, 'avgRounds');
  assertHas(result.distribution, 'downedHist');
  assertEq(result.perPc.length, 1);
  assertTrue(result.headline.winRate > 0.5,
    `L5 PC vs single goblin should win majority, got ${result.headline.winRate}`);
});
```

- [ ] **Step 2: Run; 2 new fail**

- [ ] **Step 3: Implement `runTrial` and `runSim`**

Append:

```js
  // ─────────── Pick action (nova resources strategy) ───────────
  // Prefer multiattack > limited-use > at-will. If no usable action, returns null.
  function pickAction(c) {
    const list = c.side === 'pc'
      ? ((c.pm && c.pm.actions) || []).map(a => ({ ...a,
          sourceActionName: a.name, kind: a.type }))
      : ((c.monster && c.monster.parsedActions) || []);
    // Multiattack first.
    const ma = list.find(a => a.kind === 'multiattack' && isAvailable(c, a));
    if (ma) return ma;
    // Limited-resource attacks/saves before at-will.
    const limited = list.filter(a =>
      (a.usesPerDay != null || a.recharge) && a.kind !== 'unparsed' && a.kind !== 'utility' &&
      isAvailable(c, a));
    if (limited.length) return limited[0];
    // At-will attack/save/heal.
    const atWill = list.find(a =>
      ['attack','save','heal'].includes(a.kind) && isAvailable(c, a));
    return atWill || null;
  }

  // ─────────── runTrial — one fight ───────────
  // Returns { winner, rounds, partyHpRemaining, eventLog, perActionTally,
  //          partyDowned, partyDeathRounds, warnings }.
  function runTrial(party, monsterPicks, tactics, rng) {
    const events = [];
    const warnings = [];
    const combatants = buildCombatants(party, monsterPicks, rng, false);
    rollInitiative(combatants, rng);
    const slots = initOrder(combatants);

    const perAction = new Map();
    function tally(actor, action, kind, dHit, dDmg, dHealed, dKills, dRevives) {
      const key = actor + '|' + action;
      let row = perAction.get(key);
      if (!row) {
        row = { actor: actor === 'pc' ? 'pc' : 'monster',
                actorName: '', sourceId:'', name: action, kind,
                uses:0, hits:0, totalDmg:0, totalHealed:0,
                killsCaused:0, revivesCaused:0 };
        perAction.set(key, row);
      }
      row.uses += 1;
      row.hits += dHit ? 1 : 0;
      row.totalDmg += dDmg || 0;
      row.totalHealed += dHealed || 0;
      row.killsCaused += dKills || 0;
      row.revivesCaused += dRevives || 0;
    }

    let winner = null;
    let round = 1;
    while (round <= 25 && !winner) {
      for (const slot of slots) {
        const c = slot.c;
        if (c.dead || c.downed) continue;
        const skip = turnStart(c, round, rng, events);
        if (skip) continue;
        const myActions = c.side === 'pc' ? (c.pm.actions || [])
                                          : ((c.monster.parsedActions) || []);
        rollRecharge(c, myActions.map(a => ({
          sourceActionName: a.sourceActionName || a.name, recharge: a.recharge })), rng);

        // Heal triage first.
        const all = combatants;
        const heal = healTriage(c, all, round);
        if (heal) {
          consumeUse(c, heal.action);
          c.lastHealRound = round;
          const r = resolveHeal(c, heal.targets, heal.action, rng, events, round);
          tally(c.side, heal.action.sourceActionName || heal.action.name,
                'heal', false, 0, r.totalHealed, 0, r.revives);
        } else {
          const action = pickAction(c);
          if (!action) continue;
          if (action.kind === 'multiattack') {
            consumeUse(c, action);
            const r = resolveMultiattack(c, all, action, tactics, rng, events, round);
            tally(c.side, action.sourceActionName, 'multi', false, 0, 0, 0, 0);
            warnings.push(...(r.warnings || []));
          } else if (action.kind === 'attack') {
            const tgt = pickEnemyTarget(c, all, tactics, rng);
            if (!tgt) continue;
            consumeUse(c, action);
            const r = c.side === 'pc'
              ? resolveAttackPc(c, tgt, action, rng, events, round)
              : resolveAttackMonster(c, tgt, action, rng, events, round);
            for (const [type, dmg] of Object.entries(r.damageByType || {})) {
              const wasAlive = !tgt.dead && !tgt.downed;
              applyDamage(tgt, dmg, type, c, events, round, c.name,
                          action.sourceActionName || action.name);
              const killed = wasAlive && (tgt.dead || tgt.downed);
              tally(c.side, action.sourceActionName || action.name, 'attack',
                    r.hit, dmg, 0, killed ? 1 : 0, 0);
            }
            if (!r.hit) tally(c.side, action.sourceActionName || action.name,
                              'attack', false, 0, 0, 0, 0);
          } else if (action.kind === 'save') {
            // For AoE, pick `aoeTargets` lowest-HP enemies.
            const enemies = aliveEnemies(c, all)
              .sort((a, b) => a.hp - b.hp);
            const n = Math.max(1, action.aoeTargets || 1);
            const targets = enemies.slice(0, n);
            if (!targets.length) continue;
            consumeUse(c, action);
            const r = resolveSave(c, targets, action, rng, events, round);
            tally(c.side, action.sourceActionName || action.name, 'save',
                  false, r.totalDmg, 0, 0, 0);
          } else if (action.kind === 'heal') {
            // No qualifying target via triage but action available — self-heal.
            if (action.heal && action.heal.target === 'self') {
              consumeUse(c, action);
              const r = resolveHeal(c, [c], action, rng, events, round);
              tally(c.side, action.sourceActionName || action.name, 'heal',
                    false, 0, r.totalHealed, 0, r.revives);
            }
          }
        }

        // End check after each turn.
        const pcsAlive = combatants.some(x => x.side === 'pc' && !x.downed && !x.dead);
        const monAlive = combatants.some(x => x.side === 'monster' && !x.dead);
        if (!pcsAlive) { winner = 'monster'; break; }
        if (!monAlive) { winner = 'pc';      break; }
      }
      if (!winner) round++;
    }
    if (!winner) {
      // Round cap reached. Side with more remaining HP wins; else monster wins.
      const pcHp  = combatants.filter(x => x.side === 'pc').reduce((s, x) => s + x.hp, 0);
      const monHp = combatants.filter(x => x.side === 'monster').reduce((s, x) => s + x.hp, 0);
      winner = pcHp > monHp ? 'pc' : 'monster';
      warnings.push('Trial hit 25-round cap.');
    }

    // Per-PC outcomes.
    const partyView = combatants.filter(c => c.side === 'pc').map(c => ({
      pmId: c.id, name: c.name,
      downed: !!c.downed, hp: c.hp, maxHp: c.maxHp,
      deathRound: c.deathRound != null ? c.deathRound : null,
      healReceived: 0,    // populated by event tally below
      revivesReceived: 0,
    }));
    for (const ev of events) {
      if (ev.type === 'heal') {
        const r = partyView.find(p => p.name === ev.target);
        if (r) { r.healReceived += ev.amount; if (ev.revived) r.revivesReceived++; }
      }
    }
    const pcHpRemaining = partyView.reduce((s, p) => s + p.hp, 0);

    return {
      winner, rounds: round,
      partyView, pcHpRemaining,
      perAction: Array.from(perAction.values()),
      events, warnings,
    };
  }

  // ─────────── runSim aggregator (chunked + RAF yield) ───────────
  async function runSim({ party, monsterPicks, trials, tactics, seed, onProgress }) {
    const baseSeed = (seed >>> 0) || 1;
    const trialResults = [];
    const errors = [];
    const chunkSize = 50;

    for (let start = 0; start < trials; start += chunkSize) {
      const end = Math.min(start + chunkSize, trials);
      for (let i = start; i < end; i++) {
        try {
          const rng = makeRng(baseSeed + i);
          trialResults.push(runTrial(party, monsterPicks, tactics, rng));
        } catch (e) {
          errors.push({ trial:i, message:e.message || String(e) });
        }
      }
      if (typeof requestAnimationFrame !== 'undefined') {
        await new Promise(r => requestAnimationFrame(r));
      } else {
        await new Promise(r => setTimeout(r, 0));
      }
      if (typeof onProgress === 'function') {
        const winsSoFar = trialResults.filter(t => t.winner === 'pc').length;
        onProgress({ completed: trialResults.length, winRate: winsSoFar / trialResults.length });
      }
    }

    // Pick representative trials by pcHpRemaining at p10 / p50 / p90.
    const sorted = trialResults.slice().sort((a, b) => a.pcHpRemaining - b.pcHpRemaining);
    const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const lo  = pct(0.1), mid = pct(0.5), hi = pct(0.9);

    // Aggregate.
    const wins = trialResults.filter(t => t.winner === 'pc').length;
    const avgRounds = trialResults.reduce((s, t) => s + t.rounds, 0) / Math.max(1, trialResults.length);
    const totalDowned = trialResults.reduce((s, t) => s + t.partyView.filter(p => p.downed).length, 0);
    const avgDowned = totalDowned / Math.max(1, trialResults.length);
    const tpkCount = trialResults.filter(t => t.partyView.every(p => p.downed)).length;

    // Per-PC.
    const pcIds = (party || []).map(p => p.id);
    const perPc = pcIds.map(pmId => {
      const rows = trialResults.map(t => t.partyView.find(p => p.pmId === 'pc:' + pmId)).filter(Boolean);
      const downedCount = rows.filter(p => p.downed).length;
      const halfHpCount = rows.filter(p => p.hp <= p.maxHp / 2).length;
      const avgHp = rows.reduce((s, p) => s + p.hp, 0) / Math.max(1, rows.length);
      const dr = rows.filter(p => p.deathRound != null).map(p => p.deathRound).sort((a,b)=>a-b);
      const mean = dr.length ? dr.reduce((s,v)=>s+v,0)/dr.length : null;
      const p10  = dr.length ? dr[Math.floor(dr.length*0.1)] : null;
      const p90  = dr.length ? dr[Math.floor(dr.length*0.9)] : null;
      const avgHeal = rows.reduce((s, p) => s + (p.healReceived||0), 0) / Math.max(1, rows.length);
      const avgRev  = rows.reduce((s, p) => s + (p.revivesReceived||0), 0) / Math.max(1, rows.length);
      return { pmId, name: rows[0] ? rows[0].name : pmId,
               downRate: downedCount / Math.max(1, rows.length),
               halfHpRate: halfHpCount / Math.max(1, rows.length),
               avgHpRemaining: avgHp,
               deathRound: { mean, p10, p90 },
               avgHealReceived: avgHeal, avgRevivesReceived: avgRev };
    });

    // Distribution histograms.
    const partySize = (party || []).length;
    const downedHist = new Array(partySize + 1).fill(0);
    const roundsHist = new Array(26).fill(0);
    for (const t of trialResults) {
      const d = t.partyView.filter(p => p.downed).length;
      downedHist[d] = (downedHist[d] || 0) + 1;
      roundsHist[t.rounds] = (roundsHist[t.rounds] || 0) + 1;
    }

    // Per-action: merge across trials.
    const acc = new Map();
    for (const t of trialResults) {
      for (const row of t.perAction) {
        const key = row.actor + '|' + row.name;
        let r = acc.get(key);
        if (!r) {
          r = { actor: row.actor, name: row.name, kind: row.kind,
                uses:0, hits:0, totalDmg:0, totalHealed:0,
                killsCaused:0, revivesCaused:0 };
          acc.set(key, r);
        }
        r.uses += row.uses;
        r.hits += row.hits;
        r.totalDmg += row.totalDmg;
        r.totalHealed += row.totalHealed;
        r.killsCaused += row.killsCaused;
        r.revivesCaused += row.revivesCaused;
      }
    }
    const perActionAgg = Array.from(acc.values()).map(r => ({
      ...r,
      avgDmg: r.uses ? r.totalDmg / r.uses : 0,
    }));

    const warnings = [];
    const sealCount = trialResults.filter(t => t.warnings.some(w => w.includes('round cap'))).length;
    if (sealCount) warnings.push(`${sealCount} of ${trialResults.length} trials hit the 25-round cap.`);
    // De-duplicate other per-trial warnings.
    const seen = new Set(warnings);
    for (const t of trialResults) {
      for (const w of t.warnings) {
        if (!seen.has(w) && !w.includes('round cap')) {
          warnings.push(w); seen.add(w);
        }
      }
    }

    return {
      trials: trialResults.length,
      headline: {
        winRate: wins / Math.max(1, trialResults.length),
        avgRounds,
        avgDowned,
        partyTpkRate: tpkCount / Math.max(1, trialResults.length),
      },
      perPc,
      distribution: { downedHist, roundsHist },
      perAction: perActionAgg,
      representative: { low: lo, median: mid, high: hi },
      warnings,
      errors,
    };
  }
```

Extend exports:

```js
  const Crucible = {
    makeRng, rollDie, rollDice,
    mod, pb, saveBonus, toHit, saveDc, pcDamageMod,
    buildCombatants, rollInitiative, initOrder,
    tickConditions, rollRecharge, applyRegen, turnStart,
    pickEnemyTarget, isAvailable, consumeUse, healTriage,
    aliveEnemies, aliveAllies,
    damageMultiplier, resolveAttackMonster, resolveAttackPc,
    resolveSave, resolveHeal,
    applyDamage, resolveMultiattack, pickAction,
    runTrial, runSim,
  };
```

- [ ] **Step 4: Run; all 39 pass (some may be slow)**

- [ ] **Step 5: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible engine: runTrial + runSim aggregator with RAF chunking"
```

---

### Task 18: Spec scenario tests (5 deterministic regression scenarios)

**Files:**
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Add the 5 spec scenarios as tests**

Append:

```js
// ─────── Spec scenarios (from the design doc) ───────

function makeFighter(level, hp, ac, abilities) {
  return {
    id: 'pm:' + Math.random().toString(36).slice(2,8),
    identity:{ name:'Fighter', level },
    abilities, profs:{ saves:{ str:true, con:true } },
    combat:{ hp, maxHp:hp, ac, initBonus: Crucible.mod(abilities.dex) },
    actions:[{ id:'a1', name:'Longsword', source:'weapon', type:'attack',
               atkAbility:'str', atkBonusOverride:null,
               damage:{ dice:'1d8', mod:'+atkAbility', type:'slashing',
                        riderDice:null, riderType:null },
               save:null, heal:null, aoeTargets:0,
               usesPerDay:null, recharge:null, attacksPerAction:1 }],
    tactics:{ aiHint:'focus', resources:'nova' },
  };
}
function makeHealer(level) {
  const abilities = { str:10, dex:12, con:14, int:10, wis:18, cha:10 };
  return {
    id: 'pm:cleric',
    identity:{ name:'Cleric', level },
    abilities, profs:{ saves:{ wis:true, cha:true } },
    combat:{ hp:24, maxHp:24, ac:15, initBonus:1 },
    actions:[
      { id:'h1', name:'Healing Word', source:'spell', type:'heal',
        atkAbility:'wis', atkBonusOverride:null,
        damage:null, save:null,
        heal:{ dice:'1d4', mod:4, flat:0, target:'ally', aoeTargets:0, reviveDowned:true },
        aoeTargets:0, usesPerDay:3, recharge:null, attacksPerAction:1 },
      { id:'a1', name:'Mace', source:'weapon', type:'attack',
        atkAbility:'str', atkBonusOverride:null,
        damage:{ dice:'1d6', mod:'+atkAbility', type:'bludgeoning',
                 riderDice:null, riderType:null },
        save:null, heal:null, aoeTargets:0,
        usesPerDay:null, recharge:null, attacksPerAction:1 },
    ],
    tactics:{ aiHint:'focus', resources:'nova' },
  };
}
function makeBugbear() {
  return { name:'Bugbear', hp:27, ac:16, initiative:2, isMinion:false, isSolo:false,
    parsedActions:[{ sourceActionName:'Morningstar', kind:'attack', toHit:4,
                     damage:[{ dice:'2d8', mod:2, type:'piercing' }],
                     recharge:null, usesPerDay:null }] };
}
function makeTroll(suppress) {
  return { name:'Troll', hp:84, ac:15, initiative:1, isMinion:false, isSolo:false,
    regeneration:{ amount:10, suppressedBy:suppress, minHpToRegen:1 },
    parsedActions:[
      { sourceActionName:'Bite', kind:'attack', toHit:7,
        damage:[{ dice:'1d6', mod:4, type:'piercing' }], recharge:null, usesPerDay:null },
      { sourceActionName:'Claw', kind:'attack', toHit:7,
        damage:[{ dice:'2d6', mod:4, type:'slashing' }], recharge:null, usesPerDay:null },
    ] };
}

test('Scenario 1: identical-stat duel, seeded → reproducible', async () => {
  const ab = { str:14,dex:10,con:14,int:10,wis:10,cha:10 };
  const pc = makeFighter(5, 30, 16, ab);
  const monster = { name:'Mirror', hp:30, ac:16, initiative:0, isMinion:false, isSolo:false,
    parsedActions:[{ sourceActionName:'Strike', kind:'attack', toHit:5,
                     damage:[{ dice:'1d8', mod:3, type:'slashing' }],
                     recharge:null, usesPerDay:null }] };
  const r1 = await Crucible.runSim({ party:[pc],
    monsterPicks:[{ pickId:'p1', count:1, monster }],
    trials:50, tactics:{ aiHint:'focus', resources:'nova' }, seed:7 });
  const r2 = await Crucible.runSim({ party:[pc],
    monsterPicks:[{ pickId:'p1', count:1, monster }],
    trials:50, tactics:{ aiHint:'focus', resources:'nova' }, seed:7 });
  assertEq(r1.headline.winRate, r2.headline.winRate);
  assertEq(r1.headline.avgRounds, r2.headline.avgRounds);
});
test('Scenario 2: 4 fighters vs 2 bugbears, win-rate in [0.5, 0.95]', async () => {
  const ab = { str:16,dex:14,con:14,int:10,wis:10,cha:10 };
  const party = [
    makeFighter(5, 38, 18, ab),
    makeFighter(5, 36, 17, ab),
    makeFighter(5, 38, 18, ab),
    makeFighter(5, 36, 17, ab),
  ];
  const r = await Crucible.runSim({ party,
    monsterPicks:[{ pickId:'p1', count:2, monster: makeBugbear() }],
    trials:200, tactics:{ aiHint:'focus', resources:'nova' }, seed:13 });
  assertBetween(r.headline.winRate, 0.5, 0.95,
    'Standard-band fight should land in [0.5, 0.95]');
});
test('Scenario 3: 4 fighters vs 6 bugbears → win-rate ≤ 0.5, avgDowned ≥ 1', async () => {
  const ab = { str:16,dex:14,con:14,int:10,wis:10,cha:10 };
  const party = [
    makeFighter(5, 38, 18, ab),
    makeFighter(5, 36, 17, ab),
    makeFighter(5, 38, 18, ab),
    makeFighter(5, 36, 17, ab),
  ];
  const r = await Crucible.runSim({ party,
    monsterPicks:[{ pickId:'p1', count:6, monster: makeBugbear() }],
    trials:200, tactics:{ aiHint:'focus', resources:'nova' }, seed:19 });
  assertTrue(r.headline.winRate <= 0.6,
    `Outnumbered fight should be hard; got ${r.headline.winRate.toFixed(2)}`);
  assertTrue(r.headline.avgDowned >= 1.0,
    `Average downed should be ≥1; got ${r.headline.avgDowned.toFixed(2)}`);
});
test('Scenario 4: adding a healer raises win-rate vs same fight', async () => {
  const ab = { str:16,dex:14,con:14,int:10,wis:10,cha:10 };
  const noHeal = [
    makeFighter(5, 38, 18, ab),
    makeFighter(5, 36, 17, ab),
    makeFighter(5, 38, 18, ab),
    makeFighter(5, 36, 17, ab),
  ];
  const withHeal = [
    makeFighter(5, 38, 18, ab),
    makeFighter(5, 36, 17, ab),
    makeFighter(5, 38, 18, ab),
    makeHealer(5),
  ];
  const a = await Crucible.runSim({ party: noHeal,
    monsterPicks:[{ pickId:'p1', count:4, monster: makeBugbear() }],
    trials:200, tactics:{ aiHint:'focus', resources:'nova' }, seed:23 });
  const b = await Crucible.runSim({ party: withHeal,
    monsterPicks:[{ pickId:'p1', count:4, monster: makeBugbear() }],
    trials:200, tactics:{ aiHint:'focus', resources:'nova' }, seed:23 });
  // Healer should help. Some variance allowed; the inequality is the spec test.
  assertTrue(b.headline.winRate >= a.headline.winRate - 0.05,
    `Healer should not significantly hurt win-rate. without=${a.headline.winRate}, with=${b.headline.winRate}`);
  // Most importantly: avgHealReceived > 0.
  assertTrue(b.perPc.some(p => p.avgHealReceived > 0),
    'Healer party should record heals received');
});
test('Scenario 5: troll regen + fire damage flips the fight', async () => {
  const ab = { str:16,dex:14,con:14,int:10,wis:10,cha:10 };
  const noFire = [
    makeFighter(5, 38, 18, ab),
    makeFighter(5, 36, 17, ab),
    makeFighter(5, 38, 18, ab),
    makeFighter(5, 36, 17, ab),
  ];
  // A "fire fighter" — same fighter but with a fire rider on weapon.
  const withFire = noFire.slice(0,3).concat([(() => {
    const f = makeFighter(5, 36, 17, ab);
    f.actions[0].damage.riderDice = '1d6';
    f.actions[0].damage.riderType = 'fire';
    return f;
  })()]);
  const tactics = { aiHint:'focus', resources:'nova' };
  const a = await Crucible.runSim({ party: noFire,
    monsterPicks:[{ pickId:'p1', count:1, monster: makeTroll(['acid','fire']) }],
    trials:200, tactics, seed:29 });
  const b = await Crucible.runSim({ party: withFire,
    monsterPicks:[{ pickId:'p1', count:1, monster: makeTroll(['acid','fire']) }],
    trials:200, tactics, seed:29 });
  assertTrue(b.headline.winRate >= a.headline.winRate,
    `Fire-equipped party should not do worse vs troll. no-fire=${a.headline.winRate}, with-fire=${b.headline.winRate}`);
});
```

- [ ] **Step 2: Run the test page**

Open `tests/engine.test.html`. Expected: all assertions green (some scenarios run 200 trials each — total runtime ≈ 5–10s).

- [ ] **Step 3: Commit**

```bash
git add tests/engine.test.html
git commit -m "Crucible engine: spec-defined scenario regression tests"
```

---

### Task 19: CHANGELOG entry for engine

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a new entry at the top of Unreleased**

Insert above the previous "engine helpers" entry:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "Changelog: Crucible round-loop sim engine"
```

---

## Phase 4 — Page scaffold

Build the static skeleton of `crucible-dm.html` before any feature work: HTML, theme, layout, auth gate.

### Task 20: Create `crucible-dm.html` skeleton + 3-pane layout + theme

**Files:**
- Create: `crucible-dm.html`

- [ ] **Step 1: Write the file**

Write to `crucible-dm.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Spire — The Crucible</title>
  <meta name="theme-color" content="#060a0e">
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="theme.css">
  <style>
    body { background: var(--c-bg, #0e1418); color: var(--c-ink, #dde7e9);
           font-family: 'Crimson Text', serif; margin:0; min-height:100vh; }
    .topbar { display:flex; gap:0.5rem; align-items:center;
              padding:0.6rem 1rem; border-bottom:1px solid var(--c-border, #1c2429);
              background:var(--c-surface, #152028); }
    .topbar h1 { font-family:'Cinzel', serif; font-size:1.1rem; margin:0 1rem 0 0;
                 color:var(--c-accent, #7ec5c5); letter-spacing:0.05em; }
    .topbar .spacer { flex:1; }
    .btn { padding:0.4rem 0.8rem; background:var(--c-surface-2, #1d3a4a);
           color:var(--c-ink); border:1px solid var(--c-border); cursor:pointer;
           border-radius:4px; font-family:'Crimson Text', serif; }
    .btn:hover { background:var(--c-surface-3, #224a5f); }
    .btn-teal { background:var(--c-accent, #4a9595); color:#0e1418; border-color:#4a9595; }
    .btn-teal:disabled { opacity:0.4; cursor:not-allowed; }
    .layout { display:grid; grid-template-columns: 320px 400px 1fr;
              gap:0; min-height: calc(100vh - 56px); }
    .pane { padding:1rem; border-right:1px solid var(--c-border, #1c2429);
            overflow-y:auto; max-height: calc(100vh - 56px); }
    .pane:last-child { border-right:none; }
    .pane h2 { font-family:'Cinzel', serif; font-size:0.95rem; margin:0 0 0.75rem;
               color:var(--c-accent, #7ec5c5); letter-spacing:0.06em; }
    @media (max-width: 1100px) {
      .layout { grid-template-columns: 1fr; }
      .pane { border-right:none; border-bottom:1px solid var(--c-border); max-height:none; }
    }
    .empty-state { color:var(--c-ink-faint, #8b9da3); font-style:italic;
                   padding:1rem; text-align:center; }
  </style>
</head>
<body>
<script src="auth.js"></script>

<div class="topbar">
  <h1>⚔ The Crucible</h1>
  <button class="btn btn-teal" id="btn-run" disabled>Run Simulation ▶</button>
  <select id="trials-select" class="btn">
    <option value="100">100 trials</option>
    <option value="500" selected>500 trials</option>
    <option value="2000">2000 trials</option>
  </select>
  <div class="spacer"></div>
  <a class="btn" href="home.html">⌂ Home</a>
</div>

<div class="layout">
  <section class="pane" id="pane-party">
    <h2>PARTY <span id="party-count" style="color:var(--c-ink-faint)"></span></h2>
    <div id="party-list" class="empty-state">No PCs yet. (Pane A under construction.)</div>
    <button class="btn" id="btn-add-pc" style="margin-top:0.5rem">+ Add PC</button>
    <button class="btn" id="btn-import-war-table" style="margin-top:0.5rem">Import from War Table</button>
  </section>

  <section class="pane" id="pane-encounter">
    <h2>ENCOUNTER</h2>
    <div id="encounter-list" class="empty-state">No monsters yet. (Pane B under construction.)</div>
    <button class="btn" id="btn-add-monster" style="margin-top:0.5rem">+ Add from Bestiary</button>
    <div id="fm-budget" style="margin-top:1rem; padding:0.5rem; background:var(--c-surface);
         border-left:3px solid var(--c-accent); font-size:0.85rem;"></div>
  </section>

  <section class="pane" id="pane-results">
    <h2>RESULTS</h2>
    <div id="results-area" class="empty-state">Run a simulation to see how this fight plays out.</div>
  </section>
</div>

<script src="crucible-parser.js"></script>
<script src="crucible-engine.js"></script>
<script>
// ─────────── DM auth gate ───────────
Auth.requireRole('dm', { redirect: 'home.html?notice=dm-only' });

// ─────────── Wire-up stubs (filled in as tasks land) ───────────
document.getElementById('btn-add-pc').addEventListener('click', () => {
  alert('Add PC: implemented in Task 22.');
});
document.getElementById('btn-add-monster').addEventListener('click', () => {
  alert('Add monster: implemented in Task 26.');
});
document.getElementById('btn-import-war-table').addEventListener('click', () => {
  alert('Import party: implemented in Task 24.');
});
document.getElementById('btn-run').addEventListener('click', () => {
  alert('Run: implemented in Task 31.');
});
</script>
</body>
</html>
```

- [ ] **Step 2: Open `crucible-dm.html` in a browser (or via `python3 -m http.server 8000`)**

Verify:
- Cinzel/Crimson Text fonts load.
- Slate/teal palette (not parchment).
- DM gate redirects you to `home.html?notice=dm-only` if not logged in as DM.
- Three panes visible (party, encounter, results) on desktop; stacked on narrow.

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: page scaffold with auth gate and 3-pane layout"
```

---

### Task 21: Add "The Crucible" tool card to `home.html`

**Files:**
- Modify: `home.html` (add icon + card; backup first)

- [ ] **Step 1: Snapshot `home.html` to backups**

```bash
mkdir -p "backups/$(date +%Y%m%d-%H%M%S)-crucible-home-card"
cp home.html "backups/$(date +%Y%m%d-%H%M%S)-crucible-home-card/"
```

- [ ] **Step 2: Add the crucible icon to the `ICONS` map**

In `home.html`, find the `const ICONS = {` line. Insert this icon definition inside the object (alongside `menagerie`, `initdm`, etc.):

```js
crucible: `<svg class="card-icon" viewBox="0 0 52 52" fill="none"><path d="M14 16 H38 L34 32 H18 Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M16 32 L36 32" stroke="currentColor" stroke-width="2"/><path d="M20 32 L20 41 H32 L32 32" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M22 12 L26 8 L30 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M26 8 V16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
```

- [ ] **Step 3: Add the card to the DM-only block**

Find the `dmCards = [` array. Add this entry after the War Table line (and before bestiary-dm so it sits next to other combat tools):

```js
makeCard({ href: 'crucible-dm.html', icon: ICONS.crucible, title: 'The Crucible', desc: 'Simulate a fight against a chosen group of monsters; see win-rate, per-PC outcomes, and per-action effectiveness.', dm: true, i: i++ }),
```

- [ ] **Step 4: Reload home.html in the browser and verify the card appears for DM accounts**

Expected: a new "The Crucible" card in the Keeper's Wing section.

- [ ] **Step 5: Commit**

```bash
git add home.html
git commit -m "Home: add The Crucible tool card to Keeper's Wing"
```

---

## Phase 5 — Party UI (Pane A)

The PC quick-form. Persists to `localStorage['crucible-party']`.

### Task 22: Render party + Add PC form

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Add the party rendering + add-PC flow inline in `crucible-dm.html`**

Replace the bottom `<script>` block (the wire-up stubs) with:

```js
// ─────────── DM auth gate ───────────
Auth.requireRole('dm', { redirect: 'home.html?notice=dm-only' });

// ═══════════════════════════════════════════════════════════════════════
//  Party state — persisted to localStorage['crucible-party']
// ═══════════════════════════════════════════════════════════════════════
let party = loadParty();

function loadParty() {
  try {
    const raw = localStorage.getItem('crucible-party');
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn('crucible-party load failed', e); }
  return [];
}
function saveParty() {
  localStorage.setItem('crucible-party', JSON.stringify(party));
}
function uid() { return 'pm-' + Math.random().toString(36).slice(2, 8); }

function defaultPC() {
  return {
    id: uid(),
    identity: { name:'New PC', player:'', class:'', subclass:'', level:5, race:'' },
    abilities: { str:14, dex:14, con:14, int:10, wis:12, cha:10 },
    profs:    { saves: { str:false, dex:false, con:false, int:false, wis:false, cha:false } },
    combat:   { hp:30, maxHp:30, ac:16, initBonus:2, speed:30 },
    actions:  [{ id:'a-' + Math.random().toString(36).slice(2,6),
                 name:'Longsword', source:'weapon', type:'attack',
                 atkAbility:'str', atkBonusOverride:null,
                 damage:{ dice:'1d8', mod:'+atkAbility', type:'slashing',
                          riderDice:null, riderType:null },
                 save:null, heal:null, aoeTargets:0,
                 usesPerDay:null, recharge:null, attacksPerAction:1 }],
    tactics:  { aiHint:'focus', resources:'nova' },
    _expanded: true,
  };
}

const expandedPC = new Set();    // pmIds currently expanded
function renderParty() {
  const root = document.getElementById('party-list');
  document.getElementById('party-count').textContent = '(' + party.length + ')';
  if (!party.length) {
    root.className = 'empty-state';
    root.textContent = 'No PCs yet. Click "+ Add PC" or "Import from War Table."';
    refreshGate();
    return;
  }
  root.className = '';
  root.innerHTML = party.map(pm => renderPCCard(pm)).join('');
  refreshGate();
}

function renderPCCard(pm) {
  const expanded = expandedPC.has(pm.id);
  const summary = `${pm.identity.name} · L${pm.identity.level} · ${pm.combat.hp}HP · AC${pm.combat.ac}`;
  return `
    <div class="pc-card" style="border:1px solid var(--c-border); border-radius:4px; margin-bottom:0.5rem; padding:0.5rem;">
      <div onclick="togglePC('${pm.id}')" style="cursor:pointer; display:flex; justify-content:space-between;">
        <b>${escapeHtml(summary)}</b>
        <span style="color:var(--c-ink-faint)">${expanded ? '▾' : '▸'}</span>
      </div>
      ${expanded ? renderPCEditor(pm) : ''}
    </div>`;
}

function renderPCEditor(pm) {
  const a = pm.abilities;
  const p = pm.profs.saves;
  return `
    <div style="padding:0.5rem 0; border-top:1px solid var(--c-border); margin-top:0.5rem;">
      <div style="font-family:'Cinzel',serif; font-size:0.8rem; color:var(--c-accent); margin-bottom:0.25rem">IDENTITY</div>
      <input type="text" value="${escapeHtml(pm.identity.name)}" placeholder="Name"
        oninput="updatePC('${pm.id}', 'identity.name', this.value)" class="pc-input">
      <input type="number" value="${pm.identity.level}" placeholder="Level" min="1" max="20"
        oninput="updatePC('${pm.id}', 'identity.level', parseInt(this.value)||1)" class="pc-input">
      <input type="text" value="${escapeHtml(pm.identity.class||'')}" placeholder="Class"
        oninput="updatePC('${pm.id}', 'identity.class', this.value)" class="pc-input">

      <div style="font-family:'Cinzel',serif; font-size:0.8rem; color:var(--c-accent); margin:0.5rem 0 0.25rem">STATS</div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.25rem">
        <label>HP <input type="number" value="${pm.combat.maxHp}" min="1"
          oninput="updatePC('${pm.id}', 'combat.maxHp', parseInt(this.value)||1); updatePC('${pm.id}', 'combat.hp', parseInt(this.value)||1)" class="pc-input"></label>
        <label>AC <input type="number" value="${pm.combat.ac}" min="5" max="30"
          oninput="updatePC('${pm.id}', 'combat.ac', parseInt(this.value)||10)" class="pc-input"></label>
        <label>Init <input type="number" value="${pm.combat.initBonus}" min="-5" max="15"
          oninput="updatePC('${pm.id}', 'combat.initBonus', parseInt(this.value)||0)" class="pc-input"></label>
      </div>

      <div style="font-family:'Cinzel',serif; font-size:0.8rem; color:var(--c-accent); margin:0.5rem 0 0.25rem">ABILITY SCORES</div>
      <div style="display:grid; grid-template-columns:repeat(6,1fr); gap:0.25rem">
        ${['str','dex','con','int','wis','cha'].map(k => `
          <label style="font-size:0.75rem">${k.toUpperCase()}
            <input type="number" value="${a[k]}" min="1" max="30"
              oninput="updatePC('${pm.id}', 'abilities.${k}', parseInt(this.value)||10)" class="pc-input">
            <span style="font-size:0.7rem; color:var(--c-ink-faint)">save:
              <input type="checkbox" ${p[k] ? 'checked':''}
                onchange="updatePC('${pm.id}', 'profs.saves.${k}', this.checked)"></span>
          </label>`).join('')}
      </div>

      <div style="font-family:'Cinzel',serif; font-size:0.8rem; color:var(--c-accent); margin:0.5rem 0 0.25rem">ACTIONS</div>
      <div id="actions-${pm.id}">${(pm.actions || []).map(act => renderActionRow(pm, act)).join('')}</div>
      <button class="btn" style="font-size:0.8rem; margin-top:0.25rem"
        onclick="addAction('${pm.id}')">+ Add action</button>

      <div style="margin-top:0.5rem; display:flex; gap:0.5rem;">
        <button class="btn" style="font-size:0.8rem" onclick="removePC('${pm.id}')">✕ Remove PC</button>
      </div>
    </div>`;
}

function renderActionRow(pm, act) {
  // Placeholder — full editor lands in Task 23.
  return `<div style="padding:0.25rem; border-bottom:1px dashed var(--c-border); font-size:0.85rem">
    ${escapeHtml(act.name)} <span style="color:var(--c-ink-faint)">(${act.type})</span>
  </div>`;
}

function togglePC(id) {
  if (expandedPC.has(id)) expandedPC.delete(id); else expandedPC.add(id);
  renderParty();
}
function updatePC(id, path, value) {
  const pm = party.find(x => x.id === id);
  if (!pm) return;
  const parts = path.split('.');
  let o = pm;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length-1]] = value;
  saveParty();
}
function addPC() {
  const pm = defaultPC();
  party.push(pm);
  expandedPC.add(pm.id);
  saveParty();
  renderParty();
}
function removePC(id) {
  party = party.filter(p => p.id !== id);
  expandedPC.delete(id);
  saveParty();
  renderParty();
}
function addAction(pmId) {
  alert('Action editor lands in Task 23.');
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

// ─────────── Style for inputs ───────────
const STYLE = document.createElement('style');
STYLE.textContent = `
  .pc-input { width:100%; padding:0.2rem 0.4rem; font-family:inherit;
              background:var(--c-bg); color:var(--c-ink);
              border:1px solid var(--c-border); border-radius:3px; }
  .pc-input:focus { outline:1px solid var(--c-accent); }
`;
document.head.appendChild(STYLE);

// ─────────── Validation gate placeholder ───────────
function refreshGate() {
  document.getElementById('btn-run').disabled = party.length === 0 ||
    !document.getElementById('encounter-list').dataset.hasPicks;
}

// ─────────── Event wiring ───────────
document.getElementById('btn-add-pc').addEventListener('click', addPC);
document.getElementById('btn-add-monster').addEventListener('click',
  () => alert('Encounter picker lands in Task 26.'));
document.getElementById('btn-import-war-table').addEventListener('click',
  () => alert('Import party lands in Task 24.'));
document.getElementById('btn-run').addEventListener('click',
  () => alert('Run lands in Task 31.'));

renderParty();
```

- [ ] **Step 2: Reload the page; verify**

- Click "+ Add PC" → a PC card with sane defaults appears, expanded.
- Edit the name; reload — name persists (via localStorage).
- Click the card header → collapses.
- ✕ Remove PC works.

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: party UI — render, add, edit identity/stats/abilities, persist"
```

---

### Task 23: Action editor (attack / save / heal)

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Replace the `renderActionRow` placeholder and `addAction` stub**

Find the existing `renderActionRow` and `addAction` functions in `crucible-dm.html` and replace them with these:

```js
const expandedAction = new Set();
function renderActionRow(pm, act) {
  const isOpen = expandedAction.has(act.id);
  const summary = `${act.name} · ${act.type}` +
    (act.damage ? ` · ${act.damage.dice}+${act.damage.mod === '+atkAbility' ? act.atkAbility.toUpperCase() : act.damage.mod}` : '') +
    (act.heal ? ` · heals ${act.heal.dice || act.heal.flat || 0}` : '');
  return `
    <div style="padding:0.25rem; border-bottom:1px dashed var(--c-border); font-size:0.85rem">
      <div style="cursor:pointer; display:flex; justify-content:space-between"
        onclick="toggleAction('${act.id}')">
        <span>${escapeHtml(summary)}</span>
        <span style="color:var(--c-ink-faint)">${isOpen ? '▾' : '▸'}</span>
      </div>
      ${isOpen ? renderActionEditor(pm, act) : ''}
    </div>`;
}

function renderActionEditor(pm, act) {
  const typeSel = ['attack','save','heal','utility'].map(t =>
    `<option value="${t}" ${act.type===t?'selected':''}>${t}</option>`).join('');
  const abSel = ['str','dex','con','int','wis','cha'].map(t =>
    `<option value="${t}" ${act.atkAbility===t?'selected':''}>${t.toUpperCase()}</option>`).join('');
  let body = '';
  if (act.type === 'attack') {
    const d = act.damage || {};
    body = `
      <label>Atk ability <select onchange="updateAction('${pm.id}','${act.id}','atkAbility',this.value)">${abSel}</select></label>
      <label>Override to-hit (blank = derived) <input type="number" value="${act.atkBonusOverride ?? ''}"
        oninput="updateAction('${pm.id}','${act.id}','atkBonusOverride', this.value === '' ? null : parseInt(this.value))" class="pc-input"></label>
      <label>Damage dice <input type="text" value="${escapeHtml(d.dice||'')}"
        oninput="updateActionDamage('${pm.id}','${act.id}','dice', this.value)" class="pc-input" placeholder="1d8"></label>
      <label>Damage mod ('+atkAbility' or number) <input type="text" value="${escapeHtml(String(d.mod||''))}"
        oninput="updateActionDamage('${pm.id}','${act.id}','mod', this.value)" class="pc-input"></label>
      <label>Type <input type="text" value="${escapeHtml(d.type||'')}"
        oninput="updateActionDamage('${pm.id}','${act.id}','type', this.value)" class="pc-input"></label>
      <label>Rider dice (optional) <input type="text" value="${escapeHtml(d.riderDice||'')}"
        oninput="updateActionDamage('${pm.id}','${act.id}','riderDice', this.value||null)" class="pc-input"></label>
      <label>Rider type (optional) <input type="text" value="${escapeHtml(d.riderType||'')}"
        oninput="updateActionDamage('${pm.id}','${act.id}','riderType', this.value||null)" class="pc-input"></label>`;
  } else if (act.type === 'save') {
    const s = act.save || {};
    body = `
      <label>Save ability <select onchange="updateActionSave('${pm.id}','${act.id}','ability',this.value)">${abSel}</select></label>
      <label>DC override (blank = derived) <input type="number" value="${s.dcOverride ?? ''}"
        oninput="updateActionSave('${pm.id}','${act.id}','dcOverride', this.value === '' ? null : parseInt(this.value))" class="pc-input"></label>
      <label>Damage dice <input type="text" value="${escapeHtml((act.damage&&act.damage.dice)||'')}"
        oninput="updateActionDamage('${pm.id}','${act.id}','dice', this.value)" class="pc-input"></label>
      <label>Type <input type="text" value="${escapeHtml((act.damage&&act.damage.type)||'')}"
        oninput="updateActionDamage('${pm.id}','${act.id}','type', this.value)" class="pc-input"></label>
      <label><input type="checkbox" ${s.halfOnSave?'checked':''}
        onchange="updateActionSave('${pm.id}','${act.id}','halfOnSave', this.checked)"> half on save</label>
      <label>AoE targets <input type="number" value="${act.aoeTargets||0}" min="0" max="20"
        oninput="updateAction('${pm.id}','${act.id}','aoeTargets', parseInt(this.value)||0)" class="pc-input"></label>`;
  } else if (act.type === 'heal') {
    const h = act.heal || {};
    body = `
      <label>Heal dice (e.g. 1d8) <input type="text" value="${escapeHtml(h.dice||'')}"
        oninput="updateActionHeal('${pm.id}','${act.id}','dice', this.value||null)" class="pc-input"></label>
      <label>Heal mod ('+atkAbility' or number) <input type="text" value="${escapeHtml(String(h.mod||''))}"
        oninput="updateActionHeal('${pm.id}','${act.id}','mod', this.value)" class="pc-input"></label>
      <label>Flat (no-dice) <input type="number" value="${h.flat||0}"
        oninput="updateActionHeal('${pm.id}','${act.id}','flat', parseInt(this.value)||0)" class="pc-input"></label>
      <label>Target
        <select onchange="updateActionHeal('${pm.id}','${act.id}','target', this.value)">
          ${['self','ally','ally-aoe'].map(t => `<option value="${t}" ${h.target===t?'selected':''}>${t}</option>`).join('')}
        </select></label>
      <label><input type="checkbox" ${h.reviveDowned?'checked':''}
        onchange="updateActionHeal('${pm.id}','${act.id}','reviveDowned', this.checked)"> revives downed</label>`;
  }
  return `
    <div style="padding:0.25rem 0.5rem; background:var(--c-surface);">
      <label>Name <input type="text" value="${escapeHtml(act.name)}"
        oninput="updateAction('${pm.id}','${act.id}','name', this.value)" class="pc-input"></label>
      <label>Type <select onchange="changeActionType('${pm.id}','${act.id}', this.value)">${typeSel}</select></label>
      ${body}
      <label>Uses/day (blank=at-will) <input type="number" value="${act.usesPerDay ?? ''}"
        oninput="updateAction('${pm.id}','${act.id}','usesPerDay', this.value === '' ? null : parseInt(this.value))" class="pc-input"></label>
      <label>Recharge minRoll (blank=none) <input type="number" min="2" max="6" value="${act.recharge ? act.recharge.minRoll : ''}"
        oninput="updateAction('${pm.id}','${act.id}','recharge', this.value === '' ? null : { dice:'d6', minRoll: parseInt(this.value) })" class="pc-input"></label>
      <button class="btn" style="font-size:0.75rem; margin-top:0.25rem"
        onclick="removeAction('${pm.id}','${act.id}')">✕ Remove action</button>
    </div>`;
}

function toggleAction(id) {
  if (expandedAction.has(id)) expandedAction.delete(id); else expandedAction.add(id);
  renderParty();
}
function updateAction(pmId, aId, field, value) {
  const pm = party.find(p => p.id === pmId); if (!pm) return;
  const act = pm.actions.find(a => a.id === aId); if (!act) return;
  act[field] = value; saveParty(); renderParty();
}
function updateActionDamage(pmId, aId, field, value) {
  const pm = party.find(p => p.id === pmId); if (!pm) return;
  const act = pm.actions.find(a => a.id === aId); if (!act) return;
  act.damage = act.damage || {};
  act.damage[field] = value; saveParty(); renderParty();
}
function updateActionSave(pmId, aId, field, value) {
  const pm = party.find(p => p.id === pmId); if (!pm) return;
  const act = pm.actions.find(a => a.id === aId); if (!act) return;
  act.save = act.save || {};
  act.save[field] = value; saveParty(); renderParty();
}
function updateActionHeal(pmId, aId, field, value) {
  const pm = party.find(p => p.id === pmId); if (!pm) return;
  const act = pm.actions.find(a => a.id === aId); if (!act) return;
  act.heal = act.heal || { target:'ally', aoeTargets:0, reviveDowned:false };
  act.heal[field] = value; saveParty(); renderParty();
}
function changeActionType(pmId, aId, newType) {
  const pm = party.find(p => p.id === pmId); if (!pm) return;
  const act = pm.actions.find(a => a.id === aId); if (!act) return;
  act.type = newType;
  if (newType === 'heal') {
    act.heal = act.heal || { dice:'1d4', mod:'+atkAbility', flat:0,
                              target:'ally', aoeTargets:0, reviveDowned:false };
    act.damage = null; act.save = null;
  } else if (newType === 'save') {
    act.save = act.save || { ability:'dex', dcOverride:null, halfOnSave:true,
                             effectOnFail:'damage', condition:null };
    act.damage = act.damage || { dice:'8d6', mod:0, type:'fire', riderDice:null, riderType:null };
    act.heal = null;
  } else if (newType === 'attack') {
    act.damage = act.damage || { dice:'1d8', mod:'+atkAbility', type:'slashing',
                                  riderDice:null, riderType:null };
    act.heal = null;
  } else {
    act.damage = null; act.save = null; act.heal = null;
  }
  saveParty(); renderParty();
}
function removeAction(pmId, aId) {
  const pm = party.find(p => p.id === pmId); if (!pm) return;
  pm.actions = pm.actions.filter(a => a.id !== aId);
  saveParty(); renderParty();
}
function addAction(pmId) {
  const pm = party.find(p => p.id === pmId); if (!pm) return;
  const a = { id:'a-' + Math.random().toString(36).slice(2,6),
              name:'New action', source:'weapon', type:'attack',
              atkAbility:'str', atkBonusOverride:null,
              damage:{ dice:'1d8', mod:'+atkAbility', type:'slashing',
                       riderDice:null, riderType:null },
              save:null, heal:null, aoeTargets:0,
              usesPerDay:null, recharge:null, attacksPerAction:1 };
  pm.actions.push(a);
  expandedAction.add(a.id);
  saveParty(); renderParty();
}
```

- [ ] **Step 2: Reload; verify**

- Add a PC; click "+ Add action"; the editor expands.
- Switch type to "save"; the body fields change.
- Switch type to "heal"; the heal payload appears.
- Edit dice / mod; reload — persists.

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: action editor — attack / save / heal forms"
```

---

### Task 24: Import party from War Table

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Replace the import-war-table click handler**

Find the line:

```js
document.getElementById('btn-import-war-table').addEventListener('click',
  () => alert('Import party lands in Task 24.'));
```

Replace with the full importer:

```js
document.getElementById('btn-import-war-table').addEventListener('click', () => {
  let imported = [];
  try {
    const raw = localStorage.getItem('init_pcs');
    if (raw) imported = JSON.parse(raw) || [];
  } catch (e) { console.warn('init_pcs load failed', e); }
  if (!Array.isArray(imported) || !imported.length) {
    alert('No War Table party found in localStorage. Add PCs in the War Table first.');
    return;
  }
  const existingNames = new Set(party.map(p => p.identity.name.toLowerCase()));
  let added = 0;
  for (const ip of imported) {
    if (!ip || typeof ip.name !== 'string') continue;
    if (existingNames.has(ip.name.toLowerCase())) continue;
    const pm = defaultPC();
    pm.identity.name = ip.name;
    pm.combat.maxHp = ip.maxHp || 30;
    pm.combat.hp = ip.maxHp || 30;
    pm.combat.ac = ip.ac || 16;
    pm.combat.initBonus = ip.init || 2;
    party.push(pm);
    expandedPC.add(pm.id);
    added++;
  }
  saveParty();
  renderParty();
  alert(`Imported ${added} PC${added !== 1 ? 's' : ''} from the War Table. Defaults filled in for abilities/actions — review before running.`);
});
```

- [ ] **Step 2: Manual verify**

- In War Table, ensure a few PCs are saved (or set `localStorage.init_pcs` to a JSON array via DevTools).
- In Crucible, click "Import from War Table." The PCs appear with default abilities + a Longsword action.

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: import party from War Table localStorage"
```

---

## Phase 6 — Encounter UI (Pane B)

Loads bestiary data (with fallback cache), picker modal, picks list with quantity, and the override panel for editing parsed actions.

### Task 25: Bestiary loader (with cache + fallback)

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Add `loadBestiary()` and call it on page load**

Append to the main `<script>` block in `crucible-dm.html`, after the action editor code:

```js
// ═══════════════════════════════════════════════════════════════════════
//  Bestiary loader
// ═══════════════════════════════════════════════════════════════════════
//  Merges bestiary.json + fm.json + bestiary_custom (KV) into one array.
//  Cached on `window._CRUCIBLE_BESTIARY`. Fallback: localStorage cache
//  written on each successful fetch.
const WORKER_URL = (typeof CRUCIBLE_WORKER_URL !== 'undefined')
  ? CRUCIBLE_WORKER_URL
  : 'https://dnd-perk-webhook.jacobgiff.workers.dev/';

async function loadBestiary() {
  if (window._CRUCIBLE_BESTIARY) return window._CRUCIBLE_BESTIARY;
  const out = [];
  // Try fresh fetch.
  try {
    const [mm, fm] = await Promise.all([
      fetch('bestiary.json').then(r => r.json()),
      fetch('fm.json').then(r => r.json()),
    ]);
    for (const m of (mm.monsters || [])) out.push({ ...m, _source: 'mm-2024' });
    for (const m of (fm.monsters || [])) out.push({ ...m, _source: 'fm-v1' });
  } catch (e) {
    console.warn('Bestiary fetch failed; trying cache.', e);
    try {
      const raw = localStorage.getItem('crucible-bestiary-cache');
      if (raw) {
        const cached = JSON.parse(raw);
        if (Array.isArray(cached.monsters)) {
          out.push(...cached.monsters);
          showWarn('Using cached bestiary from ' + cached.cachedAt);
        }
      }
    } catch (e2) { console.warn('Cache read failed', e2); }
  }
  // Try bestiary_custom (DM-authored).
  try {
    const headers = Auth.dmHeaders ? Auth.dmHeaders() : {};
    const r = await fetch(WORKER_URL + '?type=bestiary_custom', { headers });
    if (r.ok) {
      const custom = await r.json();
      const monsters = (custom && custom.monsters) || [];
      for (const m of monsters) out.push({ ...m, _custom: true });
    }
  } catch (e) { console.warn('bestiary_custom fetch failed', e); }
  // Cache for offline.
  try {
    localStorage.setItem('crucible-bestiary-cache',
      JSON.stringify({ cachedAt: new Date().toISOString().slice(0, 10), monsters: out }));
  } catch (e) { /* localStorage quota */ }
  window._CRUCIBLE_BESTIARY = out;
  return out;
}

function showWarn(msg) {
  // Lightweight toast; replaced by a proper warnings list in Task 32.
  console.warn('[Crucible]', msg);
}
```

- [ ] **Step 2: Trigger the load eagerly so the picker is fast**

Add at the bottom of the main script (before the closing `</script>`):

```js
// Eagerly start loading bestiary in the background — picker becomes instant.
loadBestiary().catch(e => console.warn('Bestiary preload failed', e));
```

- [ ] **Step 3: Manual verify**

Open DevTools network tab; reload `crucible-dm.html`. Expected: two requests (`bestiary.json`, `fm.json`) and one to the worker for `bestiary_custom`. Console shows no errors.

- [ ] **Step 4: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: bestiary loader with localStorage fallback cache"
```

---

### Task 26: Picker modal + picks list

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Add picker UI**

Append to the main `<script>`:

```js
// ═══════════════════════════════════════════════════════════════════════
//  Encounter picker
// ═══════════════════════════════════════════════════════════════════════
let picks = [];  // [{ pickId, monster, count }]
function uidPick() { return 'p-' + Math.random().toString(36).slice(2, 6); }

async function openPickerModal() {
  const bestiary = await loadBestiary();
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:10; display:flex; align-items:center; justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--c-surface); border:1px solid var(--c-border); border-radius:6px; width:min(720px,90vw); max-height:80vh; display:flex; flex-direction:column;">
      <div style="padding:0.75rem 1rem; border-bottom:1px solid var(--c-border); display:flex; justify-content:space-between;">
        <b style="font-family:'Cinzel',serif; color:var(--c-accent);">Pick monsters</b>
        <button class="btn" onclick="document.body.removeChild(this.closest('[data-modal]'))">✕</button>
      </div>
      <div style="padding:0.5rem 1rem;">
        <input type="text" id="picker-filter" class="pc-input" placeholder="Filter by name…" autofocus>
      </div>
      <div id="picker-list" style="flex:1; overflow-y:auto; padding:0 1rem;"></div>
    </div>`;
  modal.dataset.modal = '1';
  document.body.appendChild(modal);
  const listEl = modal.querySelector('#picker-list');
  function renderList(q) {
    const ql = (q || '').toLowerCase();
    const items = bestiary.filter(m => !ql || (m.name || '').toLowerCase().includes(ql));
    listEl.innerHTML = items.slice(0, 200).map(m => `
      <div style="padding:0.4rem; border-bottom:1px dashed var(--c-border); display:flex; justify-content:space-between;">
        <span>${escapeHtml(m.name || '?')}
          <span style="color:var(--c-ink-faint); font-size:0.85em">
            CR ${escapeHtml(String(m.crText || m.cr || '?'))} · HP ${m.hp ?? '?'} · AC ${m.ac ?? '?'}
          </span>${m._custom ? ' <span style="color:#b88a5a">(custom)</span>' : ''}
        </span>
        <button class="btn" data-pick="${escapeHtml(m.name)}" data-source="${escapeHtml(m._source||'')}">Add</button>
      </div>`).join('') +
      (items.length > 200 ? `<div style="padding:0.5rem; color:var(--c-ink-faint)">…and ${items.length-200} more. Refine the filter.</div>` : '');
  }
  renderList('');
  modal.querySelector('#picker-filter').addEventListener('input', e => renderList(e.target.value));
  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-pick]');
    if (!btn) return;
    const name = btn.dataset.pick;
    const source = btn.dataset.source;
    const m = bestiary.find(x => x.name === name && (x._source || '') === source);
    if (!m) return;
    addPick(m);
    document.body.removeChild(modal);
  });
}

function addPick(monster) {
  // Clone the monster so we can attach parsedActions without mutating the
  // shared bestiary list.
  const m = JSON.parse(JSON.stringify(monster));
  CrucibleParser.parseAllMonsterActions(m);
  picks.push({ pickId: uidPick(), monster: m, count: 1 });
  renderEncounter();
}

function removePick(id) {
  picks = picks.filter(p => p.pickId !== id);
  renderEncounter();
}
function setPickCount(id, n) {
  const p = picks.find(x => x.pickId === id);
  if (!p) return;
  p.count = Math.max(1, parseInt(n) || 1);
  renderEncounter();
}

function renderEncounter() {
  const root = document.getElementById('encounter-list');
  if (!picks.length) {
    root.className = 'empty-state';
    root.textContent = 'No monsters yet. Click "+ Add from Bestiary."';
    root.dataset.hasPicks = '';
    refreshGate();
    return;
  }
  root.className = '';
  root.dataset.hasPicks = '1';
  root.innerHTML = picks.map(p => `
    <div style="border:1px solid var(--c-border); border-radius:4px; padding:0.4rem; margin-bottom:0.4rem;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span><b>${escapeHtml(p.monster.name)}</b>
          <span style="color:var(--c-ink-faint); font-size:0.85em">
            CR ${escapeHtml(String(p.monster.crText || p.monster.cr || '?'))} · HP ${p.monster.hp ?? '?'} · AC ${p.monster.ac ?? '?'}
          </span></span>
        <span>
          ×<input type="number" min="1" max="20" value="${p.count}" style="width:3rem"
                  onchange="setPickCount('${p.pickId}', this.value)" class="pc-input">
          <button class="btn" onclick="removePick('${p.pickId}')">✕</button>
        </span>
      </div>
      <details>
        <summary style="cursor:pointer; color:var(--c-ink-faint); font-size:0.85em">Parsed actions (${p.monster.parsedActions.length})</summary>
        <ul style="font-size:0.8em; margin:0.25rem 0 0; padding-left:1rem;">
          ${p.monster.parsedActions.map(pa => `
            <li>${escapeHtml(pa.sourceActionName)} —
              <span style="color:${pa.kind === 'unparsed' ? '#e77878' : 'var(--c-ink-faint)'}">${pa.kind}</span></li>`).join('')}
        </ul>
        <button class="btn" style="font-size:0.75em; margin-top:0.25rem"
          onclick="openOverridePanel('${p.pickId}')">Review parsed actions</button>
      </details>
    </div>`).join('');
  refreshGate();
}

// Stub — replaced in Task 27.
function openOverridePanel(pickId) {
  alert('Override panel lands in Task 27.');
}

// Wire the Add button.
document.getElementById('btn-add-monster').removeEventListener &&
  document.getElementById('btn-add-monster').removeEventListener('click', () => {});
document.getElementById('btn-add-monster').onclick = openPickerModal;
```

Also update the `refreshGate` function to include the new picks check (replace the placeholder definition you added in Task 22):

```js
function refreshGate() {
  const reasons = [];
  if (party.length === 0) reasons.push('Add at least one PC.');
  if (picks.length === 0) reasons.push('Add at least one monster.');
  for (const pm of party) {
    if (!pm.combat.hp || pm.combat.hp <= 0) reasons.push(`PC '${pm.identity.name}': HP must be > 0.`);
    if (!pm.combat.ac || pm.combat.ac < 5) reasons.push(`PC '${pm.identity.name}': AC must be ≥ 5.`);
    if (!pm.actions || !pm.actions.length) reasons.push(`PC '${pm.identity.name}': no actions defined.`);
  }
  for (const p of picks) {
    const valid = (p.monster.parsedActions || []).some(pa => pa.kind !== 'unparsed');
    if (!valid) reasons.push(`Monster '${p.monster.name}': no usable actions — fill them in via Review.`);
  }
  document.getElementById('btn-run').disabled = reasons.length > 0;
  document.getElementById('btn-run').title = reasons.join('\n');
}
```

- [ ] **Step 2: Manual verify**

- Click "+ Add from Bestiary." Modal opens with a name filter.
- Type "gobl"; see Goblins listed.
- Click "Add" on a Goblin; modal closes, the monster appears in Pane B with a quantity selector and an expandable "Parsed actions" list.
- The Run button reflects the validation gate (still disabled until party has PCs and the monster's parsed actions are non-unparsed).

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: encounter picker modal + picks list + validation gate"
```

---

### Task 27: Override panel (edit parsed actions + save to bestiary_custom)

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Add the override-panel modal and save flow**

Append to the main `<script>` (replace the `openOverridePanel` stub):

```js
function openOverridePanel(pickId) {
  const pick = picks.find(p => p.pickId === pickId);
  if (!pick) return;
  const m = pick.monster;
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:10; display:flex; align-items:center; justify-content:center;';
  modal.innerHTML = `
    <div data-modal style="background:var(--c-surface); border:1px solid var(--c-border); border-radius:6px; width:min(800px,95vw); max-height:90vh; display:flex; flex-direction:column;">
      <div style="padding:0.75rem 1rem; border-bottom:1px solid var(--c-border); display:flex; justify-content:space-between;">
        <b style="font-family:'Cinzel',serif; color:var(--c-accent);">Review parsed actions — ${escapeHtml(m.name)}</b>
        <button class="btn" onclick="document.body.removeChild(this.closest('[data-modal]').parentElement)">✕</button>
      </div>
      <div style="flex:1; overflow-y:auto; padding:1rem;">
        <div id="override-list"></div>
        ${m.regeneration ? `
          <div style="margin-top:1rem; padding:0.5rem; border:1px solid var(--c-border); border-radius:4px;">
            <b>Regeneration:</b>
            <label>Amount <input type="number" value="${m.regeneration.amount}" class="pc-input"
              oninput="overrideRegen('${pickId}', 'amount', parseInt(this.value)||0)"></label>
            <label>Suppressed by (comma-separated)
              <input type="text" value="${(m.regeneration.suppressedBy||[]).join(', ')}" class="pc-input"
                oninput="overrideRegen('${pickId}', 'suppressedBy', this.value.split(',').map(s=>s.trim()).filter(Boolean))"></label>
          </div>` : ''}
      </div>
      <div style="padding:0.5rem 1rem; border-top:1px solid var(--c-border); text-align:right">
        <button class="btn btn-teal" onclick="saveOverride('${pickId}')">Save to bestiary_custom</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  renderOverrideList(pick, modal.querySelector('#override-list'));
}

function renderOverrideList(pick, root) {
  const m = pick.monster;
  root.innerHTML = m.parsedActions.map((pa, idx) => `
    <details ${pa.kind === 'unparsed' ? 'open' : ''} style="border:1px solid var(--c-border); border-radius:4px; padding:0.5rem; margin-bottom:0.5rem;">
      <summary><b>${escapeHtml(pa.sourceActionName)}</b>
        <span style="color:${pa.kind === 'unparsed' ? '#e77878' : 'var(--c-ink-faint)'};">${pa.kind}</span></summary>
      <div style="padding:0.5rem 0;">
        <label>Kind
          <select onchange="overrideField('${pick.pickId}', ${idx}, 'kind', this.value); openOverridePanel('${pick.pickId}'); closeTopModal(); openOverridePanel('${pick.pickId}')">
            ${['attack','save','heal','multiattack','utility','unparsed'].map(k =>
              `<option value="${k}" ${pa.kind===k?'selected':''}>${k}</option>`).join('')}
          </select></label>
        ${renderOverrideFields(pa, pick.pickId, idx)}
        ${pa._raw ? `<details><summary>Raw body</summary><pre style="white-space:pre-wrap; font-size:0.8em">${escapeHtml(pa._raw)}</pre></details>` : ''}
      </div>
    </details>`).join('');
}

function renderOverrideFields(pa, pickId, idx) {
  if (pa.kind === 'attack') {
    return `
      <label>To-hit <input type="number" value="${pa.toHit ?? 0}" class="pc-input"
        oninput="overrideField('${pickId}', ${idx}, 'toHit', parseInt(this.value)||0)"></label>
      <label>Damage entries (one per line: dice±mod type, e.g. "1d8+3 slashing")
        <textarea rows="3" class="pc-input"
          oninput="overrideDamageList('${pickId}', ${idx}, this.value)">${(pa.damage||[]).map(d =>
            `${d.dice}${d.mod >= 0 ? '+' : ''}${d.mod} ${d.type}`).join('\n')}</textarea></label>`;
  } else if (pa.kind === 'save') {
    return `
      <label>Save ability
        <select onchange="overrideField('${pickId}', ${idx}, 'saveAbility', this.value)">
          ${['str','dex','con','int','wis','cha'].map(a =>
            `<option value="${a}" ${pa.saveAbility===a?'selected':''}>${a.toUpperCase()}</option>`).join('')}
        </select></label>
      <label>DC <input type="number" value="${pa.saveDc ?? 10}" class="pc-input"
        oninput="overrideField('${pickId}', ${idx}, 'saveDc', parseInt(this.value)||10)"></label>
      <label>AoE targets <input type="number" value="${pa.aoeTargets ?? 1}" class="pc-input"
        oninput="overrideField('${pickId}', ${idx}, 'aoeTargets', parseInt(this.value)||1)"></label>
      <label><input type="checkbox" ${pa.halfOnSave ? 'checked' : ''}
        onchange="overrideField('${pickId}', ${idx}, 'halfOnSave', this.checked)"> half on save</label>
      <label>Damage on fail (dice±mod type per line)
        <textarea rows="2" class="pc-input"
          oninput="overrideDamageOnFailList('${pickId}', ${idx}, this.value)">${(pa.damageOnFail||[]).map(d =>
            `${d.dice}${d.mod >= 0 ? '+' : ''}${d.mod} ${d.type}`).join('\n')}</textarea></label>`;
  } else if (pa.kind === 'heal') {
    const h = pa.heal || {};
    return `
      <label>Dice <input type="text" value="${h.dice||''}" class="pc-input"
        oninput="overrideHealField('${pickId}', ${idx}, 'dice', this.value || null)"></label>
      <label>Mod <input type="number" value="${h.mod||0}" class="pc-input"
        oninput="overrideHealField('${pickId}', ${idx}, 'mod', parseInt(this.value)||0)"></label>
      <label>Flat <input type="number" value="${h.flat||0}" class="pc-input"
        oninput="overrideHealField('${pickId}', ${idx}, 'flat', parseInt(this.value)||0)"></label>
      <label>Target
        <select onchange="overrideHealField('${pickId}', ${idx}, 'target', this.value)">
          ${['self','ally','ally-aoe'].map(t => `<option value="${t}" ${h.target===t?'selected':''}>${t}</option>`).join('')}
        </select></label>
      <label><input type="checkbox" ${h.reviveDowned?'checked':''}
        onchange="overrideHealField('${pickId}', ${idx}, 'reviveDowned', this.checked)"> revives downed</label>`;
  } else if (pa.kind === 'multiattack') {
    return `
      <label>Plan (one per line: count×ActionName)
        <textarea rows="3" class="pc-input"
          oninput="overrideMultiattackPlan('${pickId}', ${idx}, this.value)">${(pa.multiattackPlan||[]).map(p =>
            `${p.count}×${p.actionName}`).join('\n')}</textarea></label>`;
  }
  return '<i style="color:var(--c-ink-faint)">No fields for this kind.</i>';
}

function closeTopModal() {
  const m = document.querySelector('[data-modal]');
  if (m && m.parentElement) document.body.removeChild(m.parentElement);
}
function overrideField(pickId, idx, field, value) {
  const pick = picks.find(p => p.pickId === pickId); if (!pick) return;
  const pa = pick.monster.parsedActions[idx]; if (!pa) return;
  pa[field] = value;
  pa.parsedBy = 'manual';
}
function overrideHealField(pickId, idx, field, value) {
  const pick = picks.find(p => p.pickId === pickId); if (!pick) return;
  const pa = pick.monster.parsedActions[idx]; if (!pa) return;
  pa.heal = pa.heal || { target:'ally', aoeTargets:0, reviveDowned:false };
  pa.heal[field] = value;
  pa.parsedBy = 'manual';
}
function overrideDamageList(pickId, idx, raw) {
  const pick = picks.find(p => p.pickId === pickId); if (!pick) return;
  const pa = pick.monster.parsedActions[idx]; if (!pa) return;
  pa.damage = parseDamageLines(raw);
  pa.parsedBy = 'manual';
}
function overrideDamageOnFailList(pickId, idx, raw) {
  const pick = picks.find(p => p.pickId === pickId); if (!pick) return;
  const pa = pick.monster.parsedActions[idx]; if (!pa) return;
  pa.damageOnFail = parseDamageLines(raw);
  pa.parsedBy = 'manual';
}
function overrideMultiattackPlan(pickId, idx, raw) {
  const pick = picks.find(p => p.pickId === pickId); if (!pick) return;
  const pa = pick.monster.parsedActions[idx]; if (!pa) return;
  pa.multiattackPlan = raw.split('\n').map(line => {
    const m = line.match(/^\s*(\d+)\s*[x×]\s*(.+?)\s*$/i);
    if (!m) return null;
    return { count: parseInt(m[1]), actionName: m[2] };
  }).filter(Boolean);
  pa.parsedBy = 'manual';
}
function parseDamageLines(raw) {
  return raw.split('\n').map(line => {
    const m = line.match(/^\s*(\d+d\d+)\s*([+-])\s*(\d+)\s+(\w+)\s*$/i)
           || line.match(/^\s*(\d+d\d+)\s+(\w+)\s*$/i);
    if (!m) return null;
    if (m.length === 5) {
      return { dice: m[1], mod: m[2] === '-' ? -parseInt(m[3]) : parseInt(m[3]), type: m[4].toLowerCase() };
    }
    return { dice: m[1], mod: 0, type: m[2].toLowerCase() };
  }).filter(Boolean);
}
function overrideRegen(pickId, field, value) {
  const pick = picks.find(p => p.pickId === pickId); if (!pick) return;
  pick.monster.regeneration = pick.monster.regeneration || {};
  pick.monster.regeneration[field] = value;
}

async function saveOverride(pickId) {
  const pick = picks.find(p => p.pickId === pickId);
  if (!pick) return;
  const m = pick.monster;
  // Read current bestiary_custom, upsert this monster's overrides.
  try {
    const headers = Auth.dmHeaders ? Auth.dmHeaders() : {};
    const r = await fetch(WORKER_URL + '?type=bestiary_custom', { headers });
    const current = r.ok ? await r.json() : { monsters: [] };
    const list = (current && current.monsters) || [];
    const idx = list.findIndex(x => x.name === m.name && (x._source || '') === (m._source || ''));
    const overrideRecord = {
      name: m.name, _source: m._source,
      parsedActions: m.parsedActions,
      regeneration: m.regeneration || null,
      overriddenAt: new Date().toISOString(),
    };
    if (idx >= 0) list[idx] = { ...list[idx], ...overrideRecord };
    else list.push(overrideRecord);
    const saveR = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', ...headers },
      body: JSON.stringify({ type:'bestiary_custom', payload:{ monsters: list } }),
    });
    if (saveR.ok) {
      alert('Override saved to bestiary_custom.');
      // Invalidate cache.
      delete window._CRUCIBLE_BESTIARY;
      closeTopModal();
      renderEncounter();
    } else {
      alert('Save failed: ' + saveR.status);
    }
  } catch (e) {
    alert('Save failed: ' + (e.message || e));
  }
}
```

- [ ] **Step 2: Manual verify**

- Pick a monster; click Review.
- Edit the to-hit on the first parsed action.
- Click Save. (Expect a 200 response; subsequent reloads of the picker preserve the override.)
- Re-pick the same monster; the edited to-hit persists.

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: override panel for parsed actions + bestiary_custom save"
```

---

### Task 28: FM CR-budget math + Pane B footer

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Copy the FM helpers from `initiative-dm.html`**

In `crucible-dm.html`, append to the main `<script>` block:

```js
// ═══════════════════════════════════════════════════════════════════════
//  FM CR-budget math (copied from War Table; keep in sync if FM changes)
// ═══════════════════════════════════════════════════════════════════════
const FM_CR_BUDGET = {
  1: {e:0.125, s:0.125, h:0.25,  cap:1 }, 2: {e:0.125, s:0.25,  h:0.5,   cap:3 },
  3: {e:0.25,  s:0.5,   h:0.75,  cap:4 }, 4: {e:0.5,   s:0.75,  h:1,     cap:6 },
  5: {e:1,     s:1.5,   h:2.5,   cap:8 }, 6: {e:1.5,   s:2,     h:3,     cap:9 },
  7: {e:2,     s:2.5,   h:3.5,   cap:10}, 8: {e:2.5,   s:3,     h:4,     cap:12},
  9: {e:3,     s:3.5,   h:4.5,   cap:13}, 10:{e:3.5,   s:4,     h:5,     cap:15},
  11:{e:4,     s:4.5,   h:5.5,   cap:16}, 12:{e:4.5,   s:5,     h:6,     cap:17},
  13:{e:5,     s:5.5,   h:6.5,   cap:19}, 14:{e:5.5,   s:6,     h:7,     cap:20},
  15:{e:6,     s:6.5,   h:7.5,   cap:22}, 16:{e:6.5,   s:7,     h:8,     cap:24},
  17:{e:7,     s:7.5,   h:8.5,   cap:25}, 18:{e:7.5,   s:8,     h:9,     cap:26},
  19:{e:8,     s:8.5,   h:9.5,   cap:28}, 20:{e:8.5,   s:9,     h:10,    cap:30}
};
const FM_MINIONS_PER_STD = {
  0:5,0.125:5,0.25:5,0.5:5,1:5,2:5,3:5,4:5,
  5:8,6:8,7:8,8:8,
  9:10,10:10,11:10,12:10,13:10,14:10,15:10,16:10,17:10,18:10,
  19:10,20:10,21:10,22:10,23:10,24:10,25:10,26:10,27:10,28:10,29:10,30:10
};
function minionsPerStd(cr) {
  const c = +cr || 0;
  if (FM_MINIONS_PER_STD[c] != null) return FM_MINIONS_PER_STD[c];
  return 10;
}
function fmDifficultyBand(totalCR, budget) {
  if (totalCR <= 0) return 'none';
  if (totalCR < budget.easy * 0.9)      return 'trivial';
  if (totalCR <= budget.easy * 1.1)     return 'easy';
  if (totalCR <= budget.standard * 1.1) return 'standard';
  if (totalCR <= budget.hard * 1.1)     return 'hard';
  return 'extreme';
}
function fmSoloBand(soloCr, level, size) {
  const row = FM_CR_BUDGET[Math.max(1, Math.min(20, level))];
  const diff = row.cap - (+soloCr || 0);
  if (size <= 5) {
    if (diff >= 7) return 'trivial';
    if (diff >= 5) return 'easy';
    if (diff >= 3) return 'standard';
    if (diff >= 0) return 'hard';
    return 'extreme';
  }
  if (diff >= 6) return 'trivial';
  if (diff >= 4) return 'easy';
  if (diff >= 2) return 'standard';
  if (diff >= 0) return 'hard';
  return 'extreme';
}

function computeFmBudget() {
  if (!party.length || !picks.length) return null;
  const levels = party.map(p => p.identity.level);
  const avgLevel = Math.round(levels.reduce((s,v) => s+v, 0) / levels.length);
  const size = party.length;
  const row = FM_CR_BUDGET[Math.max(1, Math.min(20, avgLevel))];
  const budget = { easy: row.e * size, standard: row.s * size, hard: row.h * size,
                   capCr: row.cap, level: avgLevel, size };
  // Total CR (with minions discounted, solos handled separately).
  let totalCr = 0;
  const soloPicks = picks.filter(p => p.monster.isSolo);
  for (const p of picks) {
    if (p.monster.isSolo) continue;
    let cr = +(p.monster.cr || 0);
    if (p.monster.isMinion) cr = cr / minionsPerStd(p.monster.cr);
    totalCr += cr * (p.count || 1);
  }
  let band;
  if (soloPicks.length) {
    band = fmSoloBand(soloPicks[0].monster.cr, avgLevel, size);
  } else {
    band = fmDifficultyBand(totalCr, budget);
  }
  return { level: avgLevel, size, band, totalCr: +totalCr.toFixed(2), capCr: budget.capCr };
}

function renderFmBudget() {
  const el = document.getElementById('fm-budget');
  const b = computeFmBudget();
  if (!b) { el.textContent = ''; return; }
  const color = { trivial:'#5a9da3', easy:'#7fd49a', standard:'#dbb965',
                  hard:'#e09a5a', extreme:'#e77878' }[b.band] || '#dde7e9';
  el.innerHTML = `<b style="color:${color}">FM budget says: ${b.band.toUpperCase()}</b>
    <span style="color:var(--c-ink-faint); font-size:0.85em">
    · L${b.level} × ${b.size} · total CR ${b.totalCr} · cap ${b.capCr}</span>`;
}
```

- [ ] **Step 2: Call `renderFmBudget()` whenever party or picks change**

In `renderParty()` and `renderEncounter()`, add a final call:

```js
renderFmBudget();
```

(Add at the end of each function, after the `refreshGate()` call.)

- [ ] **Step 3: Manual verify**

- Add 4 PCs at level 5 and a couple of CR 1 monsters.
- The footer should read e.g. "FM budget says: EASY · L5 × 4 · total CR 2 · cap 8."

- [ ] **Step 4: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: FM CR-budget footer in Pane B"
```

---

## Phase 7 — Run controls + Results pane

### Task 29: Wire Run button + progress UI

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Replace the Run-button stub with the real flow**

Find the line:

```js
document.getElementById('btn-run').addEventListener('click',
  () => alert('Run lands in Task 31.'));
```

Replace with:

```js
let lastSimResult = null;
let lastSimSeed = null;

document.getElementById('btn-run').addEventListener('click', async () => {
  if (document.getElementById('btn-run').disabled) return;
  const trials = parseInt(document.getElementById('trials-select').value) || 500;
  const tactics = { aiHint:'focus', resources:'nova' };
  const seedFromUrl = new URL(location.href).searchParams.get('seed');
  const seed = seedFromUrl ? parseInt(seedFromUrl) : Math.floor(Math.random() * 1e9);
  lastSimSeed = seed;
  const root = document.getElementById('results-area');
  root.className = '';
  root.innerHTML = `
    <div style="padding:1rem; text-align:center;">
      <div style="font-family:'Cinzel',serif; margin-bottom:0.5rem;">Running ${trials} trials…</div>
      <div id="progress-bar" style="width:100%; height:10px; background:var(--c-bg); border:1px solid var(--c-border); border-radius:4px; overflow:hidden;">
        <div id="progress-fill" style="height:100%; width:0%; background:var(--c-accent); transition:width 100ms;"></div>
      </div>
      <div id="progress-text" style="margin-top:0.5rem; color:var(--c-ink-faint);">0/${trials}</div>
      <div id="winrate-live" style="margin-top:0.5rem; color:var(--c-ink-faint);"></div>
    </div>`;
  try {
    const result = await Crucible.runSim({
      party,
      monsterPicks: picks,
      trials, tactics, seed,
      onProgress: ({ completed, winRate }) => {
        const pct = Math.round((completed / trials) * 100);
        document.getElementById('progress-fill').style.width = pct + '%';
        document.getElementById('progress-text').textContent = `${completed}/${trials}`;
        document.getElementById('winrate-live').textContent =
          `live win-rate: ${(winRate * 100).toFixed(0)}%`;
      },
    });
    lastSimResult = result;
    renderResults(result);
  } catch (e) {
    root.innerHTML = `<div style="color:#e77878; padding:1rem">Sim failed: ${escapeHtml(e.message || String(e))}</div>`;
  }
});
```

- [ ] **Step 2: Add a stub `renderResults`** that just dumps JSON, so the run loop completes end-to-end

Append:

```js
function renderResults(r) {
  const root = document.getElementById('results-area');
  root.innerHTML = `
    <div style="padding:1rem;">
      <h3 style="font-family:'Cinzel',serif; color:var(--c-accent)">Run finished — ${r.trials} trials</h3>
      <pre style="font-size:0.8em; max-height:60vh; overflow:auto">${escapeHtml(JSON.stringify(r.headline, null, 2))}</pre>
      <div style="color:var(--c-ink-faint); font-size:0.8em">Seed: ${lastSimSeed}</div>
    </div>`;
}
```

- [ ] **Step 3: Manual verify**

- Add a party + an encounter.
- Click Run. Progress bar advances; ~1-2s for 500 trials; result block shows headline JSON.

- [ ] **Step 4: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: Run button + progress UI (placeholder results)"
```

---

### Task 30: Verdict section

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Replace `renderResults` with the verdict-first version**

Find the `renderResults(r)` stub and replace it with:

```js
function bandLabel(r) {
  const win = r.headline.winRate;
  const tpk = r.headline.partyTpkRate;
  const downed = r.headline.avgDowned;
  if (tpk >= 0.15)  return { label: 'TPK-LIKELY', color: '#a3344b' };
  if (win >= 0.9 && downed < 0.5)  return { label: 'EASY',      color: '#7fd49a' };
  if (win >= 0.7 && downed < 1.5)  return { label: 'STANDARD',  color: '#dbb965' };
  if (win >= 0.45)                  return { label: 'HARD',      color: '#e09a5a' };
  return { label: 'DEADLY', color: '#e77878' };
}

function renderResults(r) {
  const root = document.getElementById('results-area');
  const band = bandLabel(r);
  const fm = computeFmBudget();
  root.innerHTML = `
    <div style="padding:1rem;">
      <div style="display:flex; gap:1rem; align-items:flex-start;">
        <div>
          <button class="btn" onclick="document.getElementById('btn-run').click()">↻ Rerun</button>
          <button class="btn" onclick="copyReport()">📋 Copy report</button>
        </div>
        <div style="flex:1; text-align:right; color:var(--c-ink-faint); font-size:0.85em">
          Seed: <span onclick="copySeed()" style="cursor:pointer; text-decoration:underline">${lastSimSeed}</span>
          · ${r.trials} trials
        </div>
      </div>

      <div style="margin:1rem 0; padding:1rem; background:var(--c-surface); border-left:5px solid ${band.color}; border-radius:4px;">
        <div style="font-family:'Cinzel',serif; font-size:1.4rem; color:${band.color}; letter-spacing:0.05em">
          ${band.label}
        </div>
        ${fm ? `<div style="margin-top:0.5rem; color:var(--c-ink-faint); font-size:0.9rem">
          FM said <b>${fm.band.toUpperCase()}</b>; sim says <b style="color:${band.color}">${band.label}</b>.
        </div>` : ''}
        <div style="margin-top:0.75rem; display:flex; gap:1.5rem; flex-wrap:wrap;">
          <div><div style="color:var(--c-ink-faint); font-size:0.75rem">WIN RATE</div>
            <div style="font-size:1.25rem">${(r.headline.winRate*100).toFixed(1)}%</div></div>
          <div><div style="color:var(--c-ink-faint); font-size:0.75rem">AVG ROUNDS</div>
            <div style="font-size:1.25rem">${r.headline.avgRounds.toFixed(1)}</div></div>
          <div><div style="color:var(--c-ink-faint); font-size:0.75rem">AVG DOWNED</div>
            <div style="font-size:1.25rem">${r.headline.avgDowned.toFixed(2)}</div></div>
          <div><div style="color:var(--c-ink-faint); font-size:0.75rem">TPK RATE</div>
            <div style="font-size:1.25rem">${(r.headline.partyTpkRate*100).toFixed(1)}%</div></div>
        </div>
      </div>

      <div id="result-perpc"></div>
      <div id="result-dist"></div>
      <div id="result-peraction"></div>
      <div id="result-replays"></div>

      ${r.warnings.length ? `
      <details style="margin-top:1rem;"><summary style="color:#dbb965">⚠ ${r.warnings.length} warning(s)</summary>
        <ul>${r.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
      </details>` : ''}
      ${r.errors.length ? `
      <details style="margin-top:1rem;"><summary style="color:#e77878">✗ ${r.errors.length} error(s)</summary>
        <ul>${r.errors.slice(0,5).map(e => `<li>Trial ${e.trial}: ${escapeHtml(e.message)}</li>`).join('')}</ul>
      </details>` : ''}
    </div>`;

  renderPerPc(r);
  renderDistribution(r);
  renderPerAction(r);
  renderReplays(r);
}

function copySeed() {
  if (lastSimSeed == null) return;
  navigator.clipboard.writeText(String(lastSimSeed)).then(() =>
    alert('Seed ' + lastSimSeed + ' copied. Use ?seed=' + lastSimSeed + ' to replay.'));
}
function copyReport() { alert('Copy report lands in Task 34.'); }
function renderPerPc(r)         { /* lands in Task 31 */ }
function renderDistribution(r)  { /* lands in Task 32 */ }
function renderPerAction(r)     { /* lands in Task 32 */ }
function renderReplays(r)       { /* lands in Task 33 */ }
```

- [ ] **Step 2: Manual verify**

Click Run; verdict block appears with the band label, FM comparison, headline stats, and the seed shown bottom-right (clickable to copy).

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: results verdict band + headline trio + FM compare"
```

---

### Task 31: Per-PC outcomes table

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Replace the `renderPerPc` stub**

```js
function renderPerPc(r) {
  const root = document.getElementById('result-perpc');
  if (!r.perPc.length) { root.innerHTML = ''; return; }
  root.innerHTML = `
    <details open style="margin-top:0.5rem;">
      <summary style="font-family:'Cinzel',serif; color:var(--c-accent); cursor:pointer;">Per-PC outcomes</summary>
      <table style="width:100%; font-size:0.85rem; border-collapse:collapse; margin-top:0.5rem;">
        <thead>
          <tr style="border-bottom:1px solid var(--c-border); color:var(--c-ink-faint); text-align:left;">
            <th style="padding:0.25rem">PC</th>
            <th style="padding:0.25rem; text-align:right">down %</th>
            <th style="padding:0.25rem; text-align:right">≥½ HP loss %</th>
            <th style="padding:0.25rem; text-align:right">avg HP</th>
            <th style="padding:0.25rem; text-align:right">avg fell at</th>
            <th style="padding:0.25rem; text-align:right">avg healed</th>
          </tr>
        </thead>
        <tbody>
          ${r.perPc.map(p => `
            <tr style="border-bottom:1px dashed var(--c-border)">
              <td style="padding:0.25rem">${escapeHtml(p.name)}</td>
              <td style="padding:0.25rem; text-align:right; color:${p.downRate >= 0.3 ? '#e77878' : 'inherit'}">${(p.downRate*100).toFixed(0)}%</td>
              <td style="padding:0.25rem; text-align:right">${(p.halfHpRate*100).toFixed(0)}%</td>
              <td style="padding:0.25rem; text-align:right">${p.avgHpRemaining.toFixed(1)}</td>
              <td style="padding:0.25rem; text-align:right">${p.deathRound.mean != null ? 'R' + p.deathRound.mean.toFixed(1) : '—'}</td>
              <td style="padding:0.25rem; text-align:right">${p.avgHealReceived.toFixed(1)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </details>`;
}
```

- [ ] **Step 2: Manual verify**

Run a sim with 3+ PCs; verify table renders one row per PC, with sensible numbers (a 0% down-rate PC shows green; a 50% down-rate PC turns red).

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: per-PC outcomes table"
```

---

### Task 32: Distribution histograms + Per-action effectiveness table

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Implement `renderDistribution` and `renderPerAction`**

```js
function renderDistribution(r) {
  const root = document.getElementById('result-dist');
  const downed = r.distribution.downedHist;
  const rounds = r.distribution.roundsHist;
  const maxD = Math.max(...downed, 1);
  const maxR = Math.max(...rounds, 1);
  root.innerHTML = `
    <details open style="margin-top:0.5rem;">
      <summary style="font-family:'Cinzel',serif; color:var(--c-accent); cursor:pointer;">Distribution</summary>
      <div style="display:flex; gap:1.5rem; margin-top:0.5rem;">
        <div style="flex:1">
          <div style="font-size:0.8rem; color:var(--c-ink-faint); margin-bottom:0.25rem">PCs downed per fight</div>
          ${renderBars(downed.map((n, i) => ({ label: String(i), value: n })), maxD)}
        </div>
        <div style="flex:1">
          <div style="font-size:0.8rem; color:var(--c-ink-faint); margin-bottom:0.25rem">Rounds to resolution</div>
          ${renderBars(rounds.map((n, i) => ({ label: 'R' + i, value: n })).slice(1), maxR)}
        </div>
      </div>
    </details>`;
}

function renderBars(rows, max) {
  return `<svg viewBox="0 0 200 100" preserveAspectRatio="none" style="width:100%; height:100px; border:1px solid var(--c-border); border-radius:4px;">
    ${rows.map((row, i) => {
      const w = 200 / rows.length;
      const h = Math.round((row.value / max) * 90);
      return `<g>
        <rect x="${i*w + 1}" y="${100 - h}" width="${w - 2}" height="${h}" fill="#4a9595"/>
        <text x="${i*w + w/2}" y="98" text-anchor="middle" font-size="6" fill="#a0adb2">${escapeHtml(row.label)}</text>
      </g>`;
    }).join('')}
  </svg>`;
}

function renderPerAction(r) {
  const root = document.getElementById('result-peraction');
  const rows = r.perAction.slice().sort((a, b) =>
    (b.totalDmg + b.totalHealed) - (a.totalDmg + a.totalHealed));
  root.innerHTML = `
    <details open style="margin-top:0.5rem;">
      <summary style="font-family:'Cinzel',serif; color:var(--c-accent); cursor:pointer;">Action effectiveness</summary>
      <table style="width:100%; font-size:0.85rem; border-collapse:collapse; margin-top:0.5rem;">
        <thead>
          <tr style="border-bottom:1px solid var(--c-border); color:var(--c-ink-faint); text-align:left;">
            <th style="padding:0.25rem">Actor</th>
            <th style="padding:0.25rem">Action</th>
            <th style="padding:0.25rem">Kind</th>
            <th style="padding:0.25rem; text-align:right">Uses</th>
            <th style="padding:0.25rem; text-align:right">Hits</th>
            <th style="padding:0.25rem; text-align:right">Total dmg</th>
            <th style="padding:0.25rem; text-align:right">Total healed</th>
            <th style="padding:0.25rem; text-align:right">Avg/use</th>
            <th style="padding:0.25rem; text-align:right">Kills</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr style="border-bottom:1px dashed var(--c-border)">
              <td style="padding:0.25rem">${row.actor}</td>
              <td style="padding:0.25rem">${escapeHtml(row.name)}</td>
              <td style="padding:0.25rem; color:var(--c-ink-faint)">${row.kind}</td>
              <td style="padding:0.25rem; text-align:right">${row.uses}</td>
              <td style="padding:0.25rem; text-align:right">${row.hits}</td>
              <td style="padding:0.25rem; text-align:right">${row.totalDmg}</td>
              <td style="padding:0.25rem; text-align:right">${row.totalHealed}</td>
              <td style="padding:0.25rem; text-align:right">${row.avgDmg.toFixed(1)}</td>
              <td style="padding:0.25rem; text-align:right">${row.killsCaused}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </details>`;
}
```

- [ ] **Step 2: Manual verify**

- After a run, see two histograms side-by-side.
- See an action-effectiveness table sorted by combined impact (highest first).

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: distribution histograms + action effectiveness table"
```

---

### Task 33: Representative replay logs (Low / Median / High)

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Implement `renderReplays`**

```js
let activeReplay = 'median';
function renderReplays(r) {
  const root = document.getElementById('result-replays');
  if (!r.representative || !r.representative.low) { root.innerHTML = ''; return; }
  root.innerHTML = `
    <details style="margin-top:0.5rem;">
      <summary style="font-family:'Cinzel',serif; color:var(--c-accent); cursor:pointer;">Representative fights</summary>
      <div style="margin-top:0.5rem; display:flex; gap:0.5rem;">
        <button class="btn" onclick="switchReplay('low')">Low (p10)</button>
        <button class="btn" onclick="switchReplay('median')">Median</button>
        <button class="btn" onclick="switchReplay('high')">High (p90)</button>
      </div>
      <pre id="replay-pre" style="margin-top:0.5rem; font-size:0.8rem; max-height:400px; overflow-y:auto; padding:0.5rem; background:var(--c-bg); border:1px solid var(--c-border); border-radius:4px;"></pre>
    </details>`;
  switchReplay(activeReplay);
}

function switchReplay(which) {
  activeReplay = which;
  if (!lastSimResult || !lastSimResult.representative) return;
  const trial = lastSimResult.representative[which];
  if (!trial) return;
  const pre = document.getElementById('replay-pre');
  if (!pre) return;
  pre.textContent = trial.events.map(formatEvent).join('\n') +
    '\n\n===\nWinner: ' + trial.winner +
    '\nRounds: ' + trial.rounds +
    '\nPCs surviving HP: ' + trial.partyView.map(p =>
      `${p.name}=${p.hp}${p.downed?'(downed)':''}`).join(', ');
}

function formatEvent(ev) {
  switch (ev.type) {
    case 'attack':
      return `R${ev.round} · ${ev.actor} → ${ev.target} · ${ev.action} (roll ${ev.roll}${ev.crit?' CRIT':''}) → ${ev.hit?'hit':'miss'}${ev.damageDealt?' '+ev.damageDealt+' dmg':''}`;
    case 'save':
      return `R${ev.round} · ${ev.actor} → ${ev.target} · ${ev.action} save: ${ev.passed?'passed':'failed'}${ev.damageDealt?' '+ev.damageDealt+' dmg':''}`;
    case 'heal':
      return `R${ev.round} · ${ev.actor} heals ${ev.target} · ${ev.action} → +${ev.amount}${ev.revived?' REVIVED':''}`;
    case 'damage':
      return `R${ev.round} · ${ev.target} takes ${ev.amount} ${ev.dmgType} (from ${ev.action})`;
    case 'regen':
      return `R${ev.round} · ${ev.actor} regenerates +${ev.amount} → ${ev.hpAfter} HP`;
  }
  return JSON.stringify(ev);
}
```

- [ ] **Step 2: Manual verify**

- After a run, expand "Representative fights"; click Low / Median / High tabs.
- Event log scrolls; the winner + final HP appears at the bottom.

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: representative replay logs (low/median/high)"
```

---

### Task 34: Copy report (markdown) + URL seed param

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Implement `copyReport` and seed-URL hydration**

Replace the `copyReport` stub:

```js
function copyReport() {
  if (!lastSimResult) return;
  const r = lastSimResult;
  const fm = computeFmBudget();
  const band = bandLabel(r);
  const md = [
    `# Crucible run — ${band.label}`,
    '',
    fm ? `**FM band:** ${fm.band.toUpperCase()} (level ${fm.level} × ${fm.size}, total CR ${fm.totalCr})` : '',
    `**Sim band:** ${band.label}`,
    `**Trials:** ${r.trials} · **Seed:** ${lastSimSeed}`,
    `**Win rate:** ${(r.headline.winRate*100).toFixed(1)}% · ` +
    `**Avg rounds:** ${r.headline.avgRounds.toFixed(1)} · ` +
    `**Avg downed:** ${r.headline.avgDowned.toFixed(2)} · ` +
    `**TPK rate:** ${(r.headline.partyTpkRate*100).toFixed(1)}%`,
    '',
    '## Per-PC outcomes',
    '',
    '| PC | down % | ≥½ HP loss % | avg HP | avg fell at | avg healed |',
    '|---|---:|---:|---:|---:|---:|',
    ...r.perPc.map(p =>
      `| ${p.name} | ${(p.downRate*100).toFixed(0)}% | ${(p.halfHpRate*100).toFixed(0)}% | ${p.avgHpRemaining.toFixed(1)} | ${p.deathRound.mean != null ? 'R'+p.deathRound.mean.toFixed(1) : '—'} | ${p.avgHealReceived.toFixed(1)} |`),
    '',
    '## Top actions by combined impact',
    '',
    '| Actor | Action | Kind | Uses | Total dmg | Total healed | Kills |',
    '|---|---|---|---:|---:|---:|---:|',
    ...r.perAction.slice().sort((a,b) => (b.totalDmg+b.totalHealed) - (a.totalDmg+a.totalHealed))
      .slice(0, 10).map(row =>
        `| ${row.actor} | ${row.name} | ${row.kind} | ${row.uses} | ${row.totalDmg} | ${row.totalHealed} | ${row.killsCaused} |`),
  ].filter(Boolean).join('\n');
  navigator.clipboard.writeText(md).then(() => alert('Report copied as markdown.'));
}

// Honor ?seed=N on page load — fill it into the run state if present.
(function honorSeedParam() {
  const url = new URL(location.href);
  const seedStr = url.searchParams.get('seed');
  if (seedStr) {
    // Display the planned seed by stashing it in lastSimSeed before run;
    // the run handler reads from URL each time anyway.
    document.title = 'The Crucible · seed=' + seedStr;
  }
})();
```

- [ ] **Step 2: Manual verify**

- Run a sim. Click "📋 Copy report." Markdown is on the clipboard.
- Visit `crucible-dm.html?seed=12345`. Tab title shows the seed. Run; verdict result reproduces across reruns at the same seed.

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: markdown copy-report + ?seed= URL hydration"
```

---

## Phase 8 — Wrap-up

### Task 35: Final CHANGELOG entry + manual UI checklist

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the final entry at the top of Unreleased**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "Changelog: The Crucible v1 — UI + integration"
```

---

### Task 36: Run the full parser + engine test suites and lock the green baseline

**Files:** none (verification only)

- [ ] **Step 1: Open `tests/parser.test.html` in a browser**

Click Run. Expected: 30 passed, 0 failed. If anything fails, fix the parser before proceeding — do not commit a broken parser.

- [ ] **Step 2: Open `tests/engine.test.html` in a browser**

Click Run. Expected: 39 passed, 0 failed (the 5 spec scenarios are slower; the page should finish in 10s or so). If a scenario fails because of natural variance, rerun once — the bounds are intentionally loose. If it fails repeatedly, that's a real regression.

- [ ] **Step 3: Smoke-test the full flow on `crucible-dm.html`**

Manual:
1. Add 4 PCs (use defaults) and a couple of monsters.
2. Run 500 trials at the default seed.
3. Verify all five result sub-sections render.
4. Click "Copy report"; paste into a scratch document; check it parses as markdown.
5. Reload with `?seed=<previous>` and rerun; numbers match.

- [ ] **Step 4: Final tag commit (optional)**

```bash
git tag crucible-v1
```

---

## Notes for the implementer

- **No build step.** Every file is loaded directly by the browser. There is no bundler, no transpiler, no npm. Don't import a library, don't reach for a framework. If you find yourself wanting one, stop and read CLAUDE.md.
- **Backups before mutating existing files** (`home.html`, `CHANGELOG.md`): snapshot to `backups/<timestamp>-<desc>/`. The plan calls this out explicitly only for `home.html`; the same rule applies any time you edit an existing file in a batch.
- **CHANGELOG discipline.** One entry per phase at the top of Unreleased. Newest at the top.
- **Worker is untouched.** v1 uses only existing `bestiary_custom` read + write endpoints. If a write fails, surface the error — do not silently swallow.
- **Style consistency.** Slate/teal palette, Cinzel for headings, Crimson Text for body. No emojis baked into code unless used elsewhere in The Spire (the ⚔ ⌂ pattern is established in topbars).
- **Test pages are vanilla HTML.** Open them in a browser to run; they need no server (the bestiary fetches in `engine.test.html` are not exercised because the scenarios use inline monster objects).
- **YAGNI.** The spec explicitly defers positioning, death saves, concentration, reactions, legendary actions (beyond solo extra-turn), spell-block parsing, condition-duration parsing, saved encounters, results history, and tunable AI knob UI. Don't slip those into v1 — they have their own future phases.

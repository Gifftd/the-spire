# PC Class Features in the Crucible — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a feature framework to the Crucible simulator so it can model 8 SRD class abilities (Rage, Sneak Attack, Action Surge, Smite, Healing Word, Shield, Hex/Hunter's Mark, Bardic Inspiration) plus DM-authored homebrew abilities, with per-feature impact visible in results.

**Architecture:** A new `pc-features.js` shared module owns the 9-hook surface, mode predicates, library of built-in features as objects, DSL compiler from JSON specs to feature objects, and the `dispatchHook` runner. `crucible-engine.js` calls into the dispatcher at 9 well-defined points and tracks action/bonus/reaction budgets per combatant. The DSL is purely declarative (no `eval`) — DM authors features via a constrained form that compiles to the same object shape as built-ins.

**Tech Stack:** Vanilla HTML/CSS/JS — no framework, no bundler. Existing project conventions (IIFE module pattern, localStorage for party data, inline test harness pages).

**Reference spec:** `docs/superpowers/specs/2026-06-19-pc-class-features-sim-design.md`

---

## Phase 1 — Schema module foundation (hook surface, predicates, dispatcher)

This phase builds the framework with NO features in the library yet. Engine is not yet wired. Just the dispatcher + mode predicates + tests.

### Task 1.1: Create `pc-features.js` skeleton with namespace + version

**Files:**
- Create: `pc-features.js`

- [ ] **Step 1: Create the file with the IIFE wrapper and namespace export**

```javascript
// pc-features.js
// Framework for modeling 5e PC class features in the Crucible simulator.
// Exports a global PCFeatures namespace with:
//   - HOOK_NAMES: the 9 hook points the engine calls
//   - MODE_PREDICATES: named predicate functions for mode policies
//   - LIBRARY: built-in features (Rage, Sneak Attack, etc.) by id
//   - resolve(featureRef): given {id, source, params}, return the full feature def
//   - dispatchHook(combatant, hookName, ...args): runs all subscribed features
//   - compileDSL(spec): turns a JSON spec into a feature object
//
// Companion: tests/pc-features.test.html exercises every function above.
// Engine integration: crucible-engine.js calls dispatchHook at 9 sites.

(function (global) {
  'use strict';

  const HOOK_NAMES = [
    'onCombatStart',
    'onTurnStart',
    'onAttackAttempt',
    'onAttackHit',
    'onTakeDamage',
    'onSaveAttempt',
    'onAllyDowned',
    'onMonsterDowned',
    'onRoundEnd',
  ];

  const PCFeatures = {
    HOOK_NAMES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PCFeatures;
  } else {
    global.PCFeatures = PCFeatures;
  }
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: Commit**

```bash
git add pc-features.js
git commit -m "PC features: module skeleton + hook name registry"
```

---

### Task 1.2: Test harness scaffold + first hook-name assertion

**Files:**
- Create: `tests/pc-features.test.html`

- [ ] **Step 1: Create the test page**

Use the same harness pattern as `tests/encounter-schema.test.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>PC Features — tests</title>
  <style>
    body { font: 14px/1.4 system-ui, sans-serif; padding: 1rem; background: #1a1f24; color: #e8e6df; }
    h1 { font-family: Cinzel, serif; }
    button { font: inherit; padding: 6px 14px; background: #2a3038; color: inherit; border: 1px solid #888; border-radius: 3px; cursor: pointer; }
    #results { margin-top: 1rem; }
    .pass { color: #6c8; }
    .fail { color: #d66; }
    .case { padding: 2px 0; font-family: ui-monospace, monospace; }
    .group { margin-top: 1rem; font-weight: 600; color: #b88a5a; }
  </style>
</head>
<body>
  <h1>PC Features — tests</h1>
  <button onclick="runAll()">Run tests</button>
  <div id="results"></div>

  <script src="../pc-features.js"></script>
  <script>
    const tests = [];
    function test(name, fn) { tests.push({ name, fn }); }
    function group(name) { tests.push({ group: name }); }
    function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
    function assertEq(a, b, msg) {
      const sa = JSON.stringify(a), sb = JSON.stringify(b);
      if (sa !== sb) throw new Error((msg || 'mismatch') + ': ' + sa + ' vs ' + sb);
    }
    function assertClose(a, b, eps, msg) {
      if (Math.abs(a - b) > (eps || 0.01)) throw new Error((msg || 'not close') + ': ' + a + ' vs ' + b);
    }

    function runAll() {
      const root = document.getElementById('results');
      root.innerHTML = '';
      let pass = 0, fail = 0;
      for (const t of tests) {
        if (t.group) {
          const g = document.createElement('div');
          g.className = 'group';
          g.textContent = t.group;
          root.appendChild(g);
          continue;
        }
        const row = document.createElement('div');
        row.className = 'case';
        try { t.fn(); row.classList.add('pass'); row.textContent = '✓ ' + t.name; pass++; }
        catch (e) { row.classList.add('fail'); row.textContent = '✗ ' + t.name + '  —  ' + e.message; fail++; }
        root.appendChild(row);
      }
      const summary = document.createElement('div');
      summary.style.marginTop = '1rem';
      summary.style.fontWeight = '600';
      summary.textContent = `${pass} passed, ${fail} failed (${tests.length - tests.filter(t => t.group).length} total)`;
      root.appendChild(summary);
    }

    // ── Tests ──
    group('Hook surface');

    test('HOOK_NAMES exports all 9 expected names', () => {
      const expected = ['onCombatStart','onTurnStart','onAttackAttempt','onAttackHit','onTakeDamage','onSaveAttempt','onAllyDowned','onMonsterDowned','onRoundEnd'];
      assertEq(PCFeatures.HOOK_NAMES, expected);
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Open in browser (start server first), click Run tests**

```bash
python3 -m http.server 8000 &
open 'http://localhost:8000/tests/pc-features.test.html'
```

Expected: `1 passed, 0 failed`.

- [ ] **Step 3: Commit**

```bash
git add tests/pc-features.test.html
git commit -m "PC features tests: harness + hook-name smoke test"
```

---

### Task 1.3: `MODE_PREDICATES` registry

**Files:**
- Modify: `pc-features.js`
- Test: `tests/pc-features.test.html`

- [ ] **Step 1: Add failing tests**

Append to `tests/pc-features.test.html` before `</script>`:

```javascript
    group('Mode predicates');

    test('always returns true regardless of input', () => {
      assertEq(PCFeatures.MODE_PREDICATES.always({}, {}), true);
    });

    test('whenAnyEnemyAlive: true if any non-dead monster combatant', () => {
      const ctx = { combatants: [
        { side: 'monster', dead: false },
        { side: 'pc', dead: false },
      ]};
      assertEq(PCFeatures.MODE_PREDICATES.whenAnyEnemyAlive({}, ctx), true);
    });

    test('whenAnyEnemyAlive: false if all monsters dead', () => {
      const ctx = { combatants: [
        { side: 'monster', dead: true },
        { side: 'pc', dead: false },
      ]};
      assertEq(PCFeatures.MODE_PREDICATES.whenAnyEnemyAlive({}, ctx), false);
    });

    test('whenHpBelowHalf', () => {
      assertEq(PCFeatures.MODE_PREDICATES.whenHpBelowHalf({hp:10, maxHp:30}, {}), true);
      assertEq(PCFeatures.MODE_PREDICATES.whenHpBelowHalf({hp:20, maxHp:30}, {}), false);
    });

    test('whenHpBelowQuarter', () => {
      assertEq(PCFeatures.MODE_PREDICATES.whenHpBelowQuarter({hp:5, maxHp:30}, {}), true);
      assertEq(PCFeatures.MODE_PREDICATES.whenHpBelowQuarter({hp:10, maxHp:30}, {}), false);
    });

    test('whenAllyDowned: true if any pc combatant downed', () => {
      const ctx = { combatants: [
        { side: 'pc', downed: true },
        { side: 'pc', downed: false },
      ]};
      assertEq(PCFeatures.MODE_PREDICATES.whenAllyDowned({}, ctx), true);
    });

    test('whenAllyHpBelowHalf: excludes self', () => {
      const self = { id: 'pc:a', hp: 5, maxHp: 30 };
      const ctx = { combatants: [
        { id: 'pc:a', side: 'pc', hp: 5,  maxHp: 30 },
        { id: 'pc:b', side: 'pc', hp: 25, maxHp: 30 },
      ]};
      // Self is below half but excluded; other ally is healthy → false
      assertEq(PCFeatures.MODE_PREDICATES.whenAllyHpBelowHalf(self, ctx), false);
    });

    test('whenAllyHpBelowHalf: true if any non-self ally below half', () => {
      const self = { id: 'pc:a', hp: 30, maxHp: 30 };
      const ctx = { combatants: [
        { id: 'pc:a', side: 'pc', hp: 30, maxHp: 30 },
        { id: 'pc:b', side: 'pc', hp: 10, maxHp: 30 },
      ]};
      assertEq(PCFeatures.MODE_PREDICATES.whenAllyHpBelowHalf(self, ctx), true);
    });

    test('usesLeftGreaterThanZero reads featureState by id', () => {
      const self = { featureState: { rage: { usesLeft: 2 } } };
      assertEq(PCFeatures.MODE_PREDICATES.usesLeftGreaterThanZero(self, {}, 'rage'), true);
      const empty = { featureState: { rage: { usesLeft: 0 } } };
      assertEq(PCFeatures.MODE_PREDICATES.usesLeftGreaterThanZero(empty, {}, 'rage'), false);
    });
```

- [ ] **Step 2: Run tests — confirm 8 new failures**

Expected: harness reports failures with messages like "Cannot read properties of undefined (reading 'always')".

- [ ] **Step 3: Implement `MODE_PREDICATES`**

In `pc-features.js`, inside the IIFE, before the `PCFeatures` const:

```javascript
  const MODE_PREDICATES = {
    always:                  (self, ctx) => true,
    whenAnyEnemyAlive:       (self, ctx) =>
      Array.isArray(ctx && ctx.combatants) &&
      ctx.combatants.some(c => c.side === 'monster' && !c.dead),
    whenHpBelowHalf:         (self, ctx) =>
      self && self.maxHp > 0 && (self.hp / self.maxHp) < 0.5,
    whenHpBelowQuarter:      (self, ctx) =>
      self && self.maxHp > 0 && (self.hp / self.maxHp) < 0.25,
    whenAllyDowned:          (self, ctx) =>
      Array.isArray(ctx && ctx.combatants) &&
      ctx.combatants.some(c => c.side === 'pc' && c.downed),
    whenAllyHpBelowHalf:     (self, ctx) =>
      Array.isArray(ctx && ctx.combatants) &&
      ctx.combatants.some(c =>
        c.side === 'pc' && c.id !== (self && self.id) && c.maxHp > 0 && (c.hp / c.maxHp) < 0.5
      ),
    usesLeftGreaterThanZero: (self, ctx, featureId) =>
      !!(self && self.featureState && self.featureState[featureId] && self.featureState[featureId].usesLeft > 0),
  };
```

Update the `PCFeatures` const to expose it:

```javascript
  const PCFeatures = {
    HOOK_NAMES,
    MODE_PREDICATES,
  };
```

- [ ] **Step 4: Run tests — expect all 9 (1 from Task 1.2 + 8 new) passing**

- [ ] **Step 5: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features: MODE_PREDICATES registry + tests"
```

---

### Task 1.4: `dispatchHook` dispatcher

**Files:**
- Modify: `pc-features.js`
- Test: `tests/pc-features.test.html`

- [ ] **Step 1: Add failing tests**

Append:

```javascript
    group('dispatchHook');

    test('dispatchHook with no features is a no-op (does not throw)', () => {
      const combatant = { pm: { features: [] }, featureState: {} };
      PCFeatures.dispatchHook(combatant, 'onTurnStart', {round: 1});
      // No assertion needed beyond not throwing.
    });

    test('dispatchHook fires features in declaration order', () => {
      const calls = [];
      const featureA = { id: 'a', hooks: { onTurnStart(self) { calls.push('a'); } } };
      const featureB = { id: 'b', hooks: { onTurnStart(self) { calls.push('b'); } } };
      // Stub PCFeatures.resolve to return our local features.
      const origResolve = PCFeatures.resolve;
      PCFeatures.resolve = (f) => f.id === 'a' ? featureA : featureB;
      try {
        const combatant = {
          pm: { features: [{id:'a'}, {id:'b'}] },
          featureState: {a:{}, b:{}},
        };
        PCFeatures.dispatchHook(combatant, 'onTurnStart', {});
        assertEq(calls, ['a','b']);
      } finally {
        PCFeatures.resolve = origResolve;
      }
    });

    test('dispatchHook skips features without the named hook', () => {
      const featureA = { id: 'a', hooks: { onTurnStart: () => 'fired' } };
      const featureB = { id: 'b', hooks: { onAttackHit: () => 'should not fire' } };
      const origResolve = PCFeatures.resolve;
      PCFeatures.resolve = (f) => f.id === 'a' ? featureA : featureB;
      try {
        const combatant = {
          pm: { features: [{id:'a'}, {id:'b'}] },
          featureState: {a:{}, b:{}},
        };
        // Should not throw on 'b' lacking onTurnStart.
        PCFeatures.dispatchHook(combatant, 'onTurnStart', {});
      } finally {
        PCFeatures.resolve = origResolve;
      }
    });

    test('dispatchHook isolates throwing features and disables them', () => {
      let bRan = false;
      const featureA = { id: 'a', hooks: { onTurnStart() { throw new Error('boom'); } } };
      const featureB = { id: 'b', hooks: { onTurnStart() { bRan = true; } } };
      const origResolve = PCFeatures.resolve;
      const origWarn = console.warn;
      console.warn = () => {};  // silence
      PCFeatures.resolve = (f) => f.id === 'a' ? featureA : featureB;
      try {
        const combatant = {
          pm: { features: [{id:'a'}, {id:'b'}] },
          featureState: {a:{}, b:{}},
        };
        PCFeatures.dispatchHook(combatant, 'onTurnStart', {});
        assert(bRan, 'feature b should still run after a throws');
        assert(combatant.featureState.a._disabled, 'a should be marked disabled');
        // Second call should skip a entirely.
        let aCallsAfter = 0;
        featureA.hooks.onTurnStart = () => { aCallsAfter++; };
        PCFeatures.dispatchHook(combatant, 'onTurnStart', {});
        assertEq(aCallsAfter, 0, 'disabled feature should not fire again');
      } finally {
        PCFeatures.resolve = origResolve;
        console.warn = origWarn;
      }
    });

    test('dispatchHook short-circuits on "consume" return (reaction semantics)', () => {
      let bRan = false;
      const featureA = { id: 'a', hooks: { onAttackAttempt() { return 'consume'; } } };
      const featureB = { id: 'b', hooks: { onAttackAttempt() { bRan = true; } } };
      const origResolve = PCFeatures.resolve;
      PCFeatures.resolve = (f) => f.id === 'a' ? featureA : featureB;
      try {
        const combatant = {
          pm: { features: [{id:'a'}, {id:'b'}] },
          featureState: {a:{}, b:{}},
        };
        PCFeatures.dispatchHook(combatant, 'onAttackAttempt', {});
        assertEq(bRan, false, 'b must not fire after a consumes');
      } finally {
        PCFeatures.resolve = origResolve;
      }
    });
```

- [ ] **Step 2: Run tests — confirm 5 new failures**

- [ ] **Step 3: Implement `dispatchHook` and a stub `resolve`**

In `pc-features.js`, inside the IIFE before `const PCFeatures`:

```javascript
  // Resolve a feature reference {id, source, params, ...} to a full feature
  // definition. Built-in: look up by id in LIBRARY. Homebrew: the ref itself
  // carries the full definition (compileDSL produced it).
  function resolve(ref) {
    if (!ref) return null;
    if (ref.source === 'homebrew') return ref;
    return (PCFeatures.LIBRARY && PCFeatures.LIBRARY[ref.id]) || null;
  }

  function dispatchHook(combatant, hookName, ...args) {
    if (!combatant || !combatant.pm || !Array.isArray(combatant.pm.features)) return;
    if (!combatant.featureState) combatant.featureState = {};
    for (const ref of combatant.pm.features) {
      if (!ref || !ref.id) continue;
      const state = combatant.featureState[ref.id];
      if (state && state._disabled) continue;
      const def = resolve(ref);
      if (!def || !def.hooks || typeof def.hooks[hookName] !== 'function') continue;
      try {
        const result = def.hooks[hookName].call(def, combatant, ...args);
        if (result === 'consume') return;
      } catch (e) {
        console.warn('PCFeatures: feature "' + ref.id + '" hook ' + hookName + ' threw:', e);
        if (!combatant.featureState[ref.id]) combatant.featureState[ref.id] = {};
        combatant.featureState[ref.id]._disabled = true;
      }
    }
  }
```

Expose them on the namespace:

```javascript
  const PCFeatures = {
    HOOK_NAMES,
    MODE_PREDICATES,
    LIBRARY: {},
    resolve,
    dispatchHook,
  };
```

- [ ] **Step 4: Run tests — all 14 passing**

- [ ] **Step 5: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features: dispatchHook + resolve + error isolation + reaction consume"
```

---

### Task 1.5: Feature state initialization helper

**Files:**
- Modify: `pc-features.js`
- Test: `tests/pc-features.test.html`

- [ ] **Step 1: Add failing tests**

```javascript
    group('initFeatureState');

    test('initFeatureState seeds every feature with its initialState()', () => {
      const origLibrary = PCFeatures.LIBRARY;
      PCFeatures.LIBRARY = {
        a: { id: 'a', initialState: () => ({ usesLeft: 3 }) },
        b: { id: 'b', initialState: () => ({ active: false }) },
      };
      try {
        const combatant = { pm: { features: [{id:'a'},{id:'b'}] }, featureState: {} };
        PCFeatures.initFeatureState(combatant);
        assertEq(combatant.featureState.a, { usesLeft: 3 });
        assertEq(combatant.featureState.b, { active: false });
      } finally {
        PCFeatures.LIBRARY = origLibrary;
      }
    });

    test('initFeatureState handles features without initialState', () => {
      const origLibrary = PCFeatures.LIBRARY;
      PCFeatures.LIBRARY = {
        a: { id: 'a' },  // no initialState
      };
      try {
        const combatant = { pm: { features: [{id:'a'}] }, featureState: {} };
        PCFeatures.initFeatureState(combatant);
        assertEq(combatant.featureState.a, {});
      } finally {
        PCFeatures.LIBRARY = origLibrary;
      }
    });

    test('initFeatureState skips unresolvable features quietly', () => {
      const origLibrary = PCFeatures.LIBRARY;
      PCFeatures.LIBRARY = {};
      try {
        const combatant = { pm: { features: [{id:'unknown'}] }, featureState: {} };
        PCFeatures.initFeatureState(combatant);  // should not throw
        assertEq(combatant.featureState.unknown, undefined);
      } finally {
        PCFeatures.LIBRARY = origLibrary;
      }
    });
```

- [ ] **Step 2: Run tests — confirm 3 new failures**

- [ ] **Step 3: Implement `initFeatureState`**

In `pc-features.js`, before the namespace export:

```javascript
  function initFeatureState(combatant) {
    if (!combatant || !combatant.pm || !Array.isArray(combatant.pm.features)) return;
    if (!combatant.featureState) combatant.featureState = {};
    for (const ref of combatant.pm.features) {
      if (!ref || !ref.id) continue;
      const def = resolve(ref);
      if (!def) continue;
      combatant.featureState[ref.id] = def.initialState ? def.initialState(def, ref) : {};
    }
  }
```

Expose on namespace:

```javascript
  const PCFeatures = {
    HOOK_NAMES,
    MODE_PREDICATES,
    LIBRARY: {},
    resolve,
    dispatchHook,
    initFeatureState,
  };
```

- [ ] **Step 4: Run tests — all 17 passing**

- [ ] **Step 5: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features: initFeatureState per-feature seed helper"
```

---

## Phase 2 — Built-in feature library

Each feature is one task. Tests verify the feature's behavior in isolation using the dispatcher and predicates from Phase 1.

### Task 2.1: Rage (Barbarian)

**Files:**
- Modify: `pc-features.js`
- Test: `tests/pc-features.test.html`

- [ ] **Step 1: Add failing tests**

```javascript
    group('Rage');

    test('Rage: bonusDamage scales with level (+2 at L5, +3 at L9, +4 at L16)', () => {
      const rage = PCFeatures.LIBRARY.rage;
      assert(rage, 'rage exists in LIBRARY');
      const r5  = rage.deriveParams({ identity: { level: 5  } });
      const r9  = rage.deriveParams({ identity: { level: 9  } });
      const r16 = rage.deriveParams({ identity: { level: 16 } });
      assertEq(r5.bonusDamage, 2);
      assertEq(r9.bonusDamage, 3);
      assertEq(r16.bonusDamage, 4);
    });

    test('Rage: onCombatStart activates under Nova mode at round 1', () => {
      const rage = PCFeatures.LIBRARY.rage;
      const self = {
        pm: { features: [{id:'rage', params:{bonusDamage:2, duration:10}}], tactics: {mode:'nova'} },
        featureState: { rage: rage.initialState(rage) },
        hp: 30, maxHp: 30,
      };
      const ctx = { round: 1, combatants: [self, {side:'monster', dead:false}] };
      rage.hooks.onCombatStart(self, ctx);
      assertEq(self.featureState.rage.active, true);
      assertEq(self.featureState.rage.roundsLeft, 10);
    });

    test('Rage: onAttackHit adds bonusDamage on melee hits when active', () => {
      const rage = PCFeatures.LIBRARY.rage;
      const self = {
        pm: { features: [{id:'rage', params:{bonusDamage:2}}], tactics: {mode:'nova'} },
        featureState: { rage: { active: true, roundsLeft: 10 } },
      };
      const action = { kind: 'attack', actionRange: 'melee' };
      const dmgCtx = { amount: 8, type: 'slashing', bonusDice: [] };
      rage.hooks.onAttackHit(self, action, {}, dmgCtx);
      assertEq(dmgCtx.amount, 10);  // 8 + 2
    });

    test('Rage: onAttackHit does NOT add damage on ranged attacks', () => {
      const rage = PCFeatures.LIBRARY.rage;
      const self = { featureState: { rage: { active: true, roundsLeft: 10 } } };
      const action = { kind: 'attack', actionRange: 'ranged' };
      const dmgCtx = { amount: 8, type: 'piercing' };
      rage.hooks.onAttackHit(self, action, {}, dmgCtx);
      assertEq(dmgCtx.amount, 8);  // unchanged
    });

    test('Rage: onTakeDamage halves physical damage when active', () => {
      const rage = PCFeatures.LIBRARY.rage;
      const self = { featureState: { rage: { active: true, roundsLeft: 10 } } };
      const dmgCtx = { amount: 10, type: 'slashing' };
      rage.hooks.onTakeDamage(self, dmgCtx);
      assertEq(dmgCtx.amount, 5);
    });

    test('Rage: onTakeDamage does NOT halve non-physical damage', () => {
      const rage = PCFeatures.LIBRARY.rage;
      const self = { featureState: { rage: { active: true, roundsLeft: 10 } } };
      const dmgCtx = { amount: 10, type: 'fire' };
      rage.hooks.onTakeDamage(self, dmgCtx);
      assertEq(dmgCtx.amount, 10);
    });

    test('Rage: onRoundEnd decrements duration; deactivates at 0', () => {
      const rage = PCFeatures.LIBRARY.rage;
      const self = { featureState: { rage: { active: true, roundsLeft: 1 } } };
      rage.hooks.onRoundEnd(self, 5, {});
      assertEq(self.featureState.rage.roundsLeft, 0);
      assertEq(self.featureState.rage.active, false);
    });
```

- [ ] **Step 2: Run tests — confirm 7 new failures**

- [ ] **Step 3: Implement Rage**

In `pc-features.js`, add a Rage feature object. Place it in a new section labeled `// ── Built-in library ──` BEFORE the `const PCFeatures` namespace assignment:

```javascript
  // ── Built-in library ──

  const RAGE = {
    id: 'rage',
    name: 'Rage',
    source: 'builtin',
    category: ['damage', 'defense'],
    classHint: 'barbarian',
    summary: '+bonusDamage on melee hits; half physical damage taken; while raging.',

    deriveParams(identityOrPm) {
      // Accepts either a raw identity {level:5} or a pm {identity:{level:5}}.
      const level = (identityOrPm && identityOrPm.level) || (identityOrPm && identityOrPm.identity && identityOrPm.identity.level) || 1;
      let bonusDamage = 2;
      if (level >= 9)  bonusDamage = 3;
      if (level >= 16) bonusDamage = 4;
      return { bonusDamage, duration: 10 };
    },

    modePolicy: {
      nova:      { triggerRound: 1, conditionFn: 'always' },
      sustained: { triggerRound: 1, conditionFn: 'whenAnyEnemyAlive' },
      defensive: { triggerRound: 1, conditionFn: 'whenHpBelowHalf' },
    },

    initialState() { return { active: false, roundsLeft: 0 }; },

    hooks: {
      onCombatStart(self, ctx) {
        const ref = self.pm.features.find(f => f.id === 'rage');
        const mode = (self.pm.tactics && self.pm.tactics.mode) || 'sustained';
        const policy = this.modePolicy[mode] || this.modePolicy.sustained;
        if (ctx.round >= (policy.triggerRound || 1)) {
          const pred = MODE_PREDICATES[policy.conditionFn] || MODE_PREDICATES.always;
          if (pred(self, ctx, 'rage')) {
            const params = (ref && ref.params) || this.deriveParams(self.pm);
            self.featureState.rage.active = true;
            self.featureState.rage.roundsLeft = params.duration || 10;
            if (ctx.eventLog) ctx.eventLog.push({ round: ctx.round, type: 'feature', who: self.id, what: 'Rage activated' });
          }
        }
      },

      onAttackHit(self, action, target, dmgCtx) {
        const state = self.featureState.rage;
        if (!state || !state.active) return;
        if (!action || action.actionRange === 'ranged') return;  // melee only
        const ref = self.pm.features.find(f => f.id === 'rage');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        dmgCtx.amount += (params.bonusDamage || 2);
      },

      onTakeDamage(self, dmgCtx) {
        const state = self.featureState.rage;
        if (!state || !state.active) return;
        const PHYS = ['bludgeoning', 'piercing', 'slashing'];
        if (PHYS.includes(dmgCtx.type)) {
          dmgCtx.amount = Math.floor(dmgCtx.amount / 2);
        }
      },

      onRoundEnd(self, round, ctx) {
        const state = self.featureState.rage;
        if (!state || !state.active) return;
        state.roundsLeft = Math.max(0, state.roundsLeft - 1);
        if (state.roundsLeft <= 0) {
          state.active = false;
          if (ctx && ctx.eventLog) ctx.eventLog.push({ round, type: 'feature', who: self.id, what: 'Rage ended' });
        }
      },
    },
  };
```

Then register it:

```javascript
  const LIBRARY = {
    rage: RAGE,
  };
```

And update the namespace assignment to use this `LIBRARY` (replacing the empty `LIBRARY: {}` placeholder):

```javascript
  const PCFeatures = {
    HOOK_NAMES,
    MODE_PREDICATES,
    LIBRARY,
    resolve,
    dispatchHook,
    initFeatureState,
  };
```

- [ ] **Step 4: Run tests — all 24 passing**

- [ ] **Step 5: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features: Rage (Barbarian) + 7 tests"
```

---

### Task 2.2: Sneak Attack (Rogue)

**Files:**
- Modify: `pc-features.js`
- Test: `tests/pc-features.test.html`

- [ ] **Step 1: Add failing tests**

```javascript
    group('Sneak Attack');

    test('Sneak Attack: dice scale with level (1d6 at L1, 3d6 at L5, 5d6 at L9)', () => {
      const sa = PCFeatures.LIBRARY.sneakAttack;
      assert(sa, 'sneakAttack exists');
      assertEq(sa.deriveParams({ identity: { level: 1 } }).dice, '1d6');
      assertEq(sa.deriveParams({ identity: { level: 5 } }).dice, '3d6');
      assertEq(sa.deriveParams({ identity: { level: 9 } }).dice, '5d6');
      assertEq(sa.deriveParams({ identity: { level: 19 } }).dice, '10d6');
    });

    test('Sneak Attack: onTurnStart resets usedThisTurn flag', () => {
      const sa = PCFeatures.LIBRARY.sneakAttack;
      const self = { featureState: { sneakAttack: { usedThisTurn: true } } };
      sa.hooks.onTurnStart(self, {round:1});
      assertEq(self.featureState.sneakAttack.usedThisTurn, false);
    });

    test('Sneak Attack: onAttackHit adds dice on first hit per turn (finesse/ranged)', () => {
      const sa = PCFeatures.LIBRARY.sneakAttack;
      const self = {
        pm: { features: [{id:'sneakAttack', params:{dice:'3d6'}}] },
        featureState: { sneakAttack: { usedThisTurn: false } },
      };
      const action = { kind: 'attack', actionRange: 'melee', finesse: true };
      const dmgCtx = { amount: 8, type: 'piercing', bonusDice: [] };
      sa.hooks.onAttackHit(self, action, {}, dmgCtx);
      assertEq(dmgCtx.bonusDice.length, 1);
      assertEq(dmgCtx.bonusDice[0].dice, '3d6');
      assertEq(self.featureState.sneakAttack.usedThisTurn, true);
    });

    test('Sneak Attack: does NOT fire twice on the same turn', () => {
      const sa = PCFeatures.LIBRARY.sneakAttack;
      const self = {
        pm: { features: [{id:'sneakAttack', params:{dice:'3d6'}}] },
        featureState: { sneakAttack: { usedThisTurn: true } },
      };
      const action = { kind: 'attack', actionRange: 'melee', finesse: true };
      const dmgCtx = { amount: 8, type: 'piercing', bonusDice: [] };
      sa.hooks.onAttackHit(self, action, {}, dmgCtx);
      assertEq(dmgCtx.bonusDice.length, 0);
    });

    test('Sneak Attack: does NOT fire on non-finesse melee attacks (e.g., greatsword)', () => {
      const sa = PCFeatures.LIBRARY.sneakAttack;
      const self = {
        pm: { features: [{id:'sneakAttack', params:{dice:'3d6'}}] },
        featureState: { sneakAttack: { usedThisTurn: false } },
      };
      const action = { kind: 'attack', actionRange: 'melee', finesse: false };
      const dmgCtx = { amount: 8, type: 'slashing', bonusDice: [] };
      sa.hooks.onAttackHit(self, action, {}, dmgCtx);
      assertEq(dmgCtx.bonusDice.length, 0);
    });

    test('Sneak Attack: fires on ranged attacks', () => {
      const sa = PCFeatures.LIBRARY.sneakAttack;
      const self = {
        pm: { features: [{id:'sneakAttack', params:{dice:'3d6'}}] },
        featureState: { sneakAttack: { usedThisTurn: false } },
      };
      const action = { kind: 'attack', actionRange: 'ranged' };
      const dmgCtx = { amount: 6, type: 'piercing', bonusDice: [] };
      sa.hooks.onAttackHit(self, action, {}, dmgCtx);
      assertEq(dmgCtx.bonusDice.length, 1);
    });
```

- [ ] **Step 2: Run tests — confirm 6 new failures**

- [ ] **Step 3: Implement Sneak Attack**

Append to `pc-features.js` after the `RAGE` definition:

```javascript
  const SNEAK_ATTACK = {
    id: 'sneakAttack',
    name: 'Sneak Attack',
    source: 'builtin',
    category: ['damage'],
    classHint: 'rogue',
    summary: 'Bonus dice on the first finesse/ranged hit per turn.',

    deriveParams(identityOrPm) {
      const level = (identityOrPm && identityOrPm.level) || (identityOrPm && identityOrPm.identity && identityOrPm.identity.level) || 1;
      // Rogue: 1d6 at L1, +1d6 per 2 odd levels (L3, L5, ..., L19).
      const dice = Math.ceil(level / 2);
      return { dice: dice + 'd6' };
    },

    modePolicy: {
      nova:      { triggerRound: 1, conditionFn: 'always' },
      sustained: { triggerRound: 1, conditionFn: 'always' },
      defensive: { triggerRound: 1, conditionFn: 'always' },
    },

    initialState() { return { usedThisTurn: false }; },

    hooks: {
      onTurnStart(self, ctx) {
        if (self.featureState.sneakAttack) self.featureState.sneakAttack.usedThisTurn = false;
      },

      onAttackHit(self, action, target, dmgCtx) {
        const state = self.featureState.sneakAttack;
        if (!state || state.usedThisTurn) return;
        if (!action || action.kind !== 'attack') return;
        // Eligible: ranged attack OR finesse melee attack.
        const eligible = action.actionRange === 'ranged' || (action.actionRange === 'melee' && action.finesse);
        if (!eligible) return;
        const ref = self.pm.features.find(f => f.id === 'sneakAttack');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        if (!Array.isArray(dmgCtx.bonusDice)) dmgCtx.bonusDice = [];
        dmgCtx.bonusDice.push({ dice: params.dice || '1d6', type: dmgCtx.type || 'piercing', source: 'sneakAttack' });
        state.usedThisTurn = true;
      },
    },
  };
```

Register in `LIBRARY`:

```javascript
  const LIBRARY = {
    rage: RAGE,
    sneakAttack: SNEAK_ATTACK,
  };
```

- [ ] **Step 4: Run tests — all 30 passing**

- [ ] **Step 5: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features: Sneak Attack (Rogue) + 6 tests"
```

---

### Task 2.3: Action Surge (Fighter)

**Files:**
- Modify: `pc-features.js`
- Test: `tests/pc-features.test.html`

- [ ] **Step 1: Add failing tests**

```javascript
    group('Action Surge');

    test('Action Surge: 1 use at L2-16, 2 uses at L17+', () => {
      const as = PCFeatures.LIBRARY.actionSurge;
      assertEq(as.deriveParams({ identity: { level: 5  } }).maxUses, 1);
      assertEq(as.deriveParams({ identity: { level: 17 } }).maxUses, 2);
    });

    test('Action Surge: onCombatStart seeds usesLeft', () => {
      const as = PCFeatures.LIBRARY.actionSurge;
      const self = {
        pm: { features: [{id:'actionSurge', params:{maxUses:1}}], tactics: {mode:'sustained'} },
        featureState: { actionSurge: as.initialState() },
      };
      as.hooks.onCombatStart(self, { round: 1, combatants: [] });
      assertEq(self.featureState.actionSurge.usesLeft, 1);
    });

    test('Action Surge under Nova: fires at round 1, grants +1 actionsAvailable', () => {
      const as = PCFeatures.LIBRARY.actionSurge;
      const self = {
        pm: { features: [{id:'actionSurge'}], tactics: {mode:'nova'} },
        featureState: { actionSurge: { usesLeft: 1 } },
        actionsAvailable: 1,
      };
      as.hooks.onTurnStart(self, { round: 1, combatants: [{side:'monster', dead:false}] });
      assertEq(self.actionsAvailable, 2);
      assertEq(self.featureState.actionSurge.usesLeft, 0);
    });

    test('Action Surge under Sustained: does not fire round 1', () => {
      const as = PCFeatures.LIBRARY.actionSurge;
      const self = {
        pm: { features: [{id:'actionSurge'}], tactics: {mode:'sustained'} },
        featureState: { actionSurge: { usesLeft: 1 } },
        actionsAvailable: 1,
      };
      as.hooks.onTurnStart(self, { round: 1, combatants: [{side:'monster', dead:false}] });
      assertEq(self.actionsAvailable, 1);  // unchanged
      assertEq(self.featureState.actionSurge.usesLeft, 1);
    });

    test('Action Surge under Defensive: fires when ally is downed', () => {
      const as = PCFeatures.LIBRARY.actionSurge;
      const self = {
        id: 'pc:fighter',
        pm: { features: [{id:'actionSurge'}], tactics: {mode:'defensive'} },
        featureState: { actionSurge: { usesLeft: 1 } },
        actionsAvailable: 1,
      };
      const ctx = { round: 3, combatants: [
        self,
        { id:'pc:cleric', side:'pc', downed:true },
      ]};
      as.hooks.onTurnStart(self, ctx);
      assertEq(self.actionsAvailable, 2);
    });

    test('Action Surge: does not fire when usesLeft is 0', () => {
      const as = PCFeatures.LIBRARY.actionSurge;
      const self = {
        pm: { features: [{id:'actionSurge'}], tactics: {mode:'nova'} },
        featureState: { actionSurge: { usesLeft: 0 } },
        actionsAvailable: 1,
      };
      as.hooks.onTurnStart(self, { round: 1, combatants: [{side:'monster', dead:false}] });
      assertEq(self.actionsAvailable, 1);
    });
```

- [ ] **Step 2: Run tests — 6 new failures**

- [ ] **Step 3: Implement Action Surge**

Append to `pc-features.js`:

```javascript
  const ACTION_SURGE = {
    id: 'actionSurge',
    name: 'Action Surge',
    source: 'builtin',
    category: ['action-economy'],
    classHint: 'fighter',
    summary: 'Take an extra action on the turn it fires.',

    deriveParams(identityOrPm) {
      const level = (identityOrPm && identityOrPm.level) || (identityOrPm && identityOrPm.identity && identityOrPm.identity.level) || 2;
      return { maxUses: level >= 17 ? 2 : 1 };
    },

    modePolicy: {
      nova:      { triggerRound: 1, conditionFn: 'always' },
      sustained: { triggerRound: 2, conditionFn: 'whenAnyEnemyAlive' },
      defensive: { triggerRound: 1, conditionFn: 'whenAllyDowned' },
    },

    initialState() { return { usesLeft: 0 }; },

    hooks: {
      onCombatStart(self, ctx) {
        const ref = self.pm.features.find(f => f.id === 'actionSurge');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        self.featureState.actionSurge.usesLeft = params.maxUses || 1;
      },

      onTurnStart(self, ctx) {
        const state = self.featureState.actionSurge;
        if (!state || state.usesLeft <= 0) return;
        const mode = (self.pm.tactics && self.pm.tactics.mode) || 'sustained';
        const policy = this.modePolicy[mode] || this.modePolicy.sustained;
        if (ctx.round < (policy.triggerRound || 1)) return;
        const pred = MODE_PREDICATES[policy.conditionFn] || MODE_PREDICATES.always;
        if (!pred(self, ctx, 'actionSurge')) return;
        if (typeof self.actionsAvailable !== 'number') self.actionsAvailable = 1;
        self.actionsAvailable += 1;
        state.usesLeft -= 1;
        if (ctx.eventLog) ctx.eventLog.push({ round: ctx.round, type: 'feature', who: self.id, what: 'Action Surge activated' });
      },
    },
  };
```

Register:

```javascript
  const LIBRARY = {
    rage: RAGE,
    sneakAttack: SNEAK_ATTACK,
    actionSurge: ACTION_SURGE,
  };
```

- [ ] **Step 4: Run tests — all 36 passing**

- [ ] **Step 5: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features: Action Surge (Fighter) + 6 tests"
```

---

### Task 2.4: Divine Smite (Paladin)

**Files:**
- Modify: `pc-features.js`
- Test: `tests/pc-features.test.html`

- [ ] **Step 1: Add failing tests**

```javascript
    group('Divine Smite');

    test('Divine Smite: deriveParams reports default slots {1:4, 2:3} at L5', () => {
      const sm = PCFeatures.LIBRARY.divineSmite;
      const p = sm.deriveParams({ identity: { level: 5 } });
      assertEq(p.slotsByLevel, { 1: 4, 2: 3 });
    });

    test('Divine Smite: onCombatStart seeds slotsLeft from params', () => {
      const sm = PCFeatures.LIBRARY.divineSmite;
      const self = {
        pm: { features: [{id:'divineSmite', params:{slotsByLevel:{1:4,2:3}}}], tactics: {mode:'nova'} },
        featureState: { divineSmite: sm.initialState() },
      };
      sm.hooks.onCombatStart(self, { round: 1, combatants: [] });
      assertEq(self.featureState.divineSmite.slotsLeft, { 1: 4, 2: 3 });
    });

    test('Divine Smite Nova: spends highest available slot on every hit, +radiant dice', () => {
      const sm = PCFeatures.LIBRARY.divineSmite;
      const self = {
        pm: { features: [{id:'divineSmite'}], tactics: {mode:'nova'} },
        featureState: { divineSmite: { slotsLeft: { 1: 2, 2: 1 } } },
      };
      const action = { kind: 'attack', actionRange: 'melee' };
      const dmgCtx = { amount: 8, type: 'slashing', bonusDice: [], crit: false };
      sm.hooks.onAttackHit(self, action, {}, dmgCtx);
      // Spent slot 2 → 3d8 radiant
      assertEq(self.featureState.divineSmite.slotsLeft, { 1: 2, 2: 0 });
      assertEq(dmgCtx.bonusDice.length, 1);
      assertEq(dmgCtx.bonusDice[0].dice, '3d8');
      assertEq(dmgCtx.bonusDice[0].type, 'radiant');
    });

    test('Divine Smite Defensive: only spends on a crit', () => {
      const sm = PCFeatures.LIBRARY.divineSmite;
      const self = {
        pm: { features: [{id:'divineSmite'}], tactics: {mode:'defensive'} },
        featureState: { divineSmite: { slotsLeft: { 1: 2 } } },
      };
      const action = { kind: 'attack', actionRange: 'melee' };
      const dmgCtxNoCrit = { amount: 8, type: 'slashing', bonusDice: [], crit: false };
      sm.hooks.onAttackHit(self, action, {}, dmgCtxNoCrit);
      assertEq(dmgCtxNoCrit.bonusDice.length, 0);
      const dmgCtxCrit = { amount: 8, type: 'slashing', bonusDice: [], crit: true };
      sm.hooks.onAttackHit(self, action, {}, dmgCtxCrit);
      assertEq(dmgCtxCrit.bonusDice.length, 1);
    });

    test('Divine Smite: no-op when out of slots', () => {
      const sm = PCFeatures.LIBRARY.divineSmite;
      const self = {
        pm: { features: [{id:'divineSmite'}], tactics: {mode:'nova'} },
        featureState: { divineSmite: { slotsLeft: { 1: 0, 2: 0 } } },
      };
      const action = { kind: 'attack', actionRange: 'melee' };
      const dmgCtx = { amount: 8, type: 'slashing', bonusDice: [], crit: false };
      sm.hooks.onAttackHit(self, action, {}, dmgCtx);
      assertEq(dmgCtx.bonusDice.length, 0);
    });
```

- [ ] **Step 2: Run tests — 5 new failures**

- [ ] **Step 3: Implement Divine Smite**

Append:

```javascript
  // Paladin spell slot table (simplified) — slots per spell level by class level.
  const PALADIN_SLOTS_BY_LEVEL = {
    2:  {1:2},
    3:  {1:3}, 4: {1:3},
    5:  {1:4, 2:2},
    6:  {1:4, 2:2},
    7:  {1:4, 2:3}, 8: {1:4, 2:3},
    9:  {1:4, 2:3, 3:2},
    10: {1:4, 2:3, 3:2},
    11: {1:4, 2:3, 3:3}, 12: {1:4, 2:3, 3:3},
    13: {1:4, 2:3, 3:3, 4:1}, 14: {1:4, 2:3, 3:3, 4:1},
    15: {1:4, 2:3, 3:3, 4:2}, 16: {1:4, 2:3, 3:3, 4:2},
    17: {1:4, 2:3, 3:3, 4:3, 5:1}, 18: {1:4, 2:3, 3:3, 4:3, 5:1},
    19: {1:4, 2:3, 3:3, 4:3, 5:2}, 20: {1:4, 2:3, 3:3, 4:3, 5:2},
  };

  const DIVINE_SMITE = {
    id: 'divineSmite',
    name: 'Divine Smite',
    source: 'builtin',
    category: ['damage'],
    classHint: 'paladin',
    summary: 'Spend a spell slot on a hit for bonus radiant dice (2d8 + 1 per slot level above 1st).',

    deriveParams(identityOrPm) {
      const level = (identityOrPm && identityOrPm.level) || (identityOrPm && identityOrPm.identity && identityOrPm.identity.level) || 5;
      // Find the largest entry ≤ level.
      let slots = {1:4, 2:3};  // sensible default for L5+
      for (let l = level; l >= 2; l--) {
        if (PALADIN_SLOTS_BY_LEVEL[l]) { slots = PALADIN_SLOTS_BY_LEVEL[l]; break; }
      }
      return { slotsByLevel: { ...slots } };
    },

    modePolicy: {
      nova:      { triggerRound: 1, conditionFn: 'always',           spendOn: 'everyHit' },
      sustained: { triggerRound: 1, conditionFn: 'always',           spendOn: 'paced' },
      defensive: { triggerRound: 1, conditionFn: 'always',           spendOn: 'critOnly' },
    },

    initialState() { return { slotsLeft: {}, hitsThisFight: 0, smitesThisFight: 0 }; },

    hooks: {
      onCombatStart(self, ctx) {
        const ref = self.pm.features.find(f => f.id === 'divineSmite');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        self.featureState.divineSmite.slotsLeft = { ...(params.slotsByLevel || {}) };
        self.featureState.divineSmite.hitsThisFight = 0;
        self.featureState.divineSmite.smitesThisFight = 0;
      },

      onAttackHit(self, action, target, dmgCtx) {
        const state = self.featureState.divineSmite;
        if (!state) return;
        if (!action || action.kind !== 'attack') return;
        if (action.actionRange === 'ranged') return;  // Smite is melee-only RAW.
        state.hitsThisFight += 1;
        // Find highest slot with charges left.
        const levels = Object.keys(state.slotsLeft).map(Number).sort((a,b) => b - a);
        const highestAvailable = levels.find(l => state.slotsLeft[l] > 0);
        if (!highestAvailable) return;

        const mode = (self.pm.tactics && self.pm.tactics.mode) || 'sustained';
        const policy = this.modePolicy[mode] || this.modePolicy.sustained;
        let shouldSpend = false;
        if (policy.spendOn === 'everyHit')    shouldSpend = true;
        else if (policy.spendOn === 'critOnly') shouldSpend = !!dmgCtx.crit;
        else if (policy.spendOn === 'paced')    shouldSpend = (state.smitesThisFight < Math.ceil(state.hitsThisFight / 2));
        if (!shouldSpend) return;

        state.slotsLeft[highestAvailable] -= 1;
        state.smitesThisFight += 1;
        // Damage: 2d8 + 1 per slot level above 1st.
        const dice = (1 + highestAvailable) + 'd8';
        if (!Array.isArray(dmgCtx.bonusDice)) dmgCtx.bonusDice = [];
        dmgCtx.bonusDice.push({ dice, type: 'radiant', source: 'divineSmite' });
      },
    },
  };
```

Register:

```javascript
  const LIBRARY = {
    rage: RAGE,
    sneakAttack: SNEAK_ATTACK,
    actionSurge: ACTION_SURGE,
    divineSmite: DIVINE_SMITE,
  };
```

- [ ] **Step 4: Run tests — all 41 passing**

- [ ] **Step 5: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features: Divine Smite (Paladin) + 5 tests"
```

---

### Task 2.5: Healing Word

**Files:**
- Modify: `pc-features.js`
- Test: `tests/pc-features.test.html`

- [ ] **Step 1: Add failing tests**

```javascript
    group('Healing Word');

    test('Healing Word: deriveParams reports slots from level (cleric-like)', () => {
      const hw = PCFeatures.LIBRARY.healingWord;
      const p = hw.deriveParams({ identity: { level: 5 } });
      assert(p.slotsByLevel && p.slotsByLevel[1] >= 3);
    });

    test('Healing Word: onAllyDowned spends a slot and heals the ally', () => {
      const hw = PCFeatures.LIBRARY.healingWord;
      const self = {
        id: 'pc:cleric',
        pm: { features: [{id:'healingWord'}], abilities: { wis: 16 }, tactics: {mode:'sustained'}, identity: { level: 5 } },
        featureState: { healingWord: { slotsLeft: { 1: 3 } } },
        bonusActionAvailable: true,
      };
      const ally = { id: 'pc:fighter', side: 'pc', hp: 0, maxHp: 30, downed: true };
      const ctx = { round: 3, combatants: [self, ally], eventLog: [] };
      hw.hooks.onAllyDowned(self, ally, ctx);
      assert(ally.hp > 0, 'ally should be healed above 0');
      assertEq(ally.downed, false);
      assertEq(self.featureState.healingWord.slotsLeft[1], 2);
      assertEq(self.bonusActionAvailable, false);
    });

    test('Healing Word: no-op when no bonus action available', () => {
      const hw = PCFeatures.LIBRARY.healingWord;
      const self = {
        pm: { features: [{id:'healingWord'}], abilities: { wis: 16 }, tactics: {mode:'sustained'}, identity: { level: 5 } },
        featureState: { healingWord: { slotsLeft: { 1: 3 } } },
        bonusActionAvailable: false,
      };
      const ally = { side: 'pc', hp: 0, maxHp: 30, downed: true };
      hw.hooks.onAllyDowned(self, ally, { round: 3, combatants: [] });
      assertEq(ally.hp, 0);
      assertEq(self.featureState.healingWord.slotsLeft[1], 3);
    });

    test('Healing Word: no-op when out of slots', () => {
      const hw = PCFeatures.LIBRARY.healingWord;
      const self = {
        pm: { features: [{id:'healingWord'}], abilities: { wis: 16 }, tactics: {mode:'sustained'}, identity: { level: 5 } },
        featureState: { healingWord: { slotsLeft: { 1: 0 } } },
        bonusActionAvailable: true,
      };
      const ally = { side: 'pc', hp: 0, maxHp: 30, downed: true };
      hw.hooks.onAllyDowned(self, ally, { round: 3, combatants: [] });
      assertEq(ally.hp, 0);
    });
```

- [ ] **Step 2: Run tests — 4 new failures**

- [ ] **Step 3: Implement Healing Word**

Append:

```javascript
  // Generic full-caster slot progression (cleric/bard/druid) — slots per spell
  // level by class level. Simplified: only levels 1-3 slots tracked here, since
  // Healing Word casts at any slot level.
  const FULL_CASTER_SLOTS_BY_LEVEL = {
    1:  {1:2},
    2:  {1:3},
    3:  {1:4, 2:2},
    4:  {1:4, 2:3},
    5:  {1:4, 2:3, 3:2},
    6:  {1:4, 2:3, 3:3},
    7:  {1:4, 2:3, 3:3, 4:1},
    8:  {1:4, 2:3, 3:3, 4:2},
    9:  {1:4, 2:3, 3:3, 4:3, 5:1},
    10: {1:4, 2:3, 3:3, 4:3, 5:2},
    11: {1:4, 2:3, 3:3, 4:3, 5:2, 6:1},
    12: {1:4, 2:3, 3:3, 4:3, 5:2, 6:1},
    13: {1:4, 2:3, 3:3, 4:3, 5:2, 6:1, 7:1},
    14: {1:4, 2:3, 3:3, 4:3, 5:2, 6:1, 7:1},
    15: {1:4, 2:3, 3:3, 4:3, 5:2, 6:1, 7:1, 8:1},
    16: {1:4, 2:3, 3:3, 4:3, 5:2, 6:1, 7:1, 8:1},
    17: {1:4, 2:3, 3:3, 4:3, 5:2, 6:1, 7:1, 8:1, 9:1},
    18: {1:4, 2:3, 3:3, 4:3, 5:3, 6:1, 7:1, 8:1, 9:1},
    19: {1:4, 2:3, 3:3, 4:3, 5:3, 6:2, 7:1, 8:1, 9:1},
    20: {1:4, 2:3, 3:3, 4:3, 5:3, 6:2, 7:2, 8:1, 9:1},
  };

  function mod(score) { return Math.floor((Number(score) - 10) / 2); }

  function rollDie(sides, rng) {
    // Use the rng if available (during sim); otherwise deterministic median for tests.
    if (rng && typeof rng === 'function') return Math.floor(rng() * sides) + 1;
    return Math.ceil((sides + 1) / 2);  // median for tests
  }

  function rollDice(formula, rng) {
    const m = /^(\d+)d(\d+)$/.exec(formula || '');
    if (!m) return 0;
    const n = parseInt(m[1], 10), s = parseInt(m[2], 10);
    let total = 0;
    for (let i = 0; i < n; i++) total += rollDie(s, rng);
    return total;
  }

  const HEALING_WORD = {
    id: 'healingWord',
    name: 'Healing Word',
    source: 'builtin',
    category: ['healing'],
    classHint: 'cleric',
    summary: 'Bonus-action heal: 1d4 + spellcasting mod (+1d4 per slot level above 1st).',

    deriveParams(identityOrPm) {
      const level = (identityOrPm && identityOrPm.level) || (identityOrPm && identityOrPm.identity && identityOrPm.identity.level) || 5;
      let slots = {1:4, 2:3, 3:2};
      for (let l = level; l >= 1; l--) {
        if (FULL_CASTER_SLOTS_BY_LEVEL[l]) { slots = FULL_CASTER_SLOTS_BY_LEVEL[l]; break; }
      }
      return { slotsByLevel: { ...slots }, ability: 'wis' };
    },

    modePolicy: {
      nova:      { triggerRound: 1, conditionFn: 'whenAllyHpBelowHalf' },
      sustained: { triggerRound: 1, conditionFn: 'whenAllyDowned' },
      defensive: { triggerRound: 1, conditionFn: 'whenAllyDowned' },
    },

    initialState() { return { slotsLeft: {} }; },

    hooks: {
      onCombatStart(self, ctx) {
        const ref = self.pm.features.find(f => f.id === 'healingWord');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        self.featureState.healingWord.slotsLeft = { ...(params.slotsByLevel || {}) };
      },

      onAllyDowned(self, ally, ctx) {
        if (!self.bonusActionAvailable) return;
        const state = self.featureState.healingWord;
        if (!state) return;
        const levels = Object.keys(state.slotsLeft).map(Number).sort((a,b) => a - b);
        const lowestAvailable = levels.find(l => state.slotsLeft[l] > 0);
        if (!lowestAvailable) return;

        const ref = self.pm.features.find(f => f.id === 'healingWord');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        const ability = params.ability || 'wis';
        const abilityScore = (self.pm.abilities && self.pm.abilities[ability]) || 10;
        const dice = lowestAvailable + 'd4';  // 1d4 base + (n-1)d4 upcast
        const healing = rollDice(dice, ctx.rng) + mod(abilityScore);

        ally.hp = Math.max(1, Math.min(ally.maxHp, healing));
        ally.downed = false;
        state.slotsLeft[lowestAvailable] -= 1;
        self.bonusActionAvailable = false;

        if (ctx.eventLog) ctx.eventLog.push({
          round: ctx.round, type: 'feature', who: self.id,
          what: 'Healing Word on ' + ally.id + ' (+' + healing + ' HP, slot ' + lowestAvailable + ')',
        });
      },
    },
  };
```

Register:

```javascript
  const LIBRARY = {
    rage: RAGE,
    sneakAttack: SNEAK_ATTACK,
    actionSurge: ACTION_SURGE,
    divineSmite: DIVINE_SMITE,
    healingWord: HEALING_WORD,
  };
```

- [ ] **Step 4: Run tests — all 45 passing**

- [ ] **Step 5: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features: Healing Word + 4 tests (+ shared slot tables, rollDice helper)"
```

---

### Task 2.6: Shield (Wizard/Sorcerer reaction)

**Files:**
- Modify: `pc-features.js`
- Test: `tests/pc-features.test.html`

- [ ] **Step 1: Add failing tests**

```javascript
    group('Shield');

    test('Shield: onAttackAttempt fires when missed-by ≤ 5 (Sustained); +5 effective AC', () => {
      const sh = PCFeatures.LIBRARY.shield;
      const self = {
        id: 'pc:wiz',
        pm: { features: [{id:'shield'}], tactics: {mode:'sustained'}, identity: { level: 5 } },
        featureState: { shield: { slotsLeft: { 1: 4 } } },
        reactionAvailableThisRound: true,
        ac: 12,
      };
      // Attacker rolled 15 total, AC is 12: hit by 3. Shield would push AC to 17 → miss.
      const rollCtx = { roll: 15, hits: true, missedBy: 0 };
      const result = sh.hooks.onAttackAttempt(self, {kind:'attack'}, self, rollCtx);
      assertEq(rollCtx.hits, false);
      assertEq(self.reactionAvailableThisRound, false);
      assertEq(self.featureState.shield.slotsLeft[1], 3);
      assertEq(result, 'consume');
    });

    test('Shield: does not fire when missed-by > 5', () => {
      const sh = PCFeatures.LIBRARY.shield;
      const self = {
        pm: { features: [{id:'shield'}], tactics: {mode:'sustained'} },
        featureState: { shield: { slotsLeft: { 1: 4 } } },
        reactionAvailableThisRound: true,
        ac: 12,
      };
      // Roll 20, AC 12: hit by 8. Shield (+5 AC=17) still hit. No-op.
      const rollCtx = { roll: 20, hits: true, missedBy: 0 };
      sh.hooks.onAttackAttempt(self, {kind:'attack'}, self, rollCtx);
      assertEq(rollCtx.hits, true);
      assertEq(self.reactionAvailableThisRound, true);
      assertEq(self.featureState.shield.slotsLeft[1], 4);
    });

    test('Shield: no-op when reaction already used this round', () => {
      const sh = PCFeatures.LIBRARY.shield;
      const self = {
        pm: { features: [{id:'shield'}], tactics: {mode:'sustained'} },
        featureState: { shield: { slotsLeft: { 1: 4 } } },
        reactionAvailableThisRound: false,
        ac: 12,
      };
      const rollCtx = { roll: 14, hits: true };
      sh.hooks.onAttackAttempt(self, {kind:'attack'}, self, rollCtx);
      assertEq(rollCtx.hits, true);
    });

    test('Shield: onRoundEnd resets reactionAvailableThisRound', () => {
      const sh = PCFeatures.LIBRARY.shield;
      const self = { reactionAvailableThisRound: false };
      sh.hooks.onRoundEnd(self, 2, {});
      assertEq(self.reactionAvailableThisRound, true);
    });
```

- [ ] **Step 2: Run tests — 4 new failures**

- [ ] **Step 3: Implement Shield**

Append:

```javascript
  const SHIELD = {
    id: 'shield',
    name: 'Shield',
    source: 'builtin',
    category: ['defense'],
    classHint: 'wizard',
    summary: 'Reaction: +5 AC vs a hit (consumes a 1st-level slot).',

    deriveParams(identityOrPm) {
      const level = (identityOrPm && identityOrPm.level) || (identityOrPm && identityOrPm.identity && identityOrPm.identity.level) || 5;
      let slots = {1:4};
      for (let l = level; l >= 1; l--) {
        if (FULL_CASTER_SLOTS_BY_LEVEL[l]) { slots = FULL_CASTER_SLOTS_BY_LEVEL[l]; break; }
      }
      return { slotsByLevel: { ...slots }, acBonus: 5 };
    },

    modePolicy: {
      // missedBy threshold: how close to the AC the attack landed (negative = hit by N)
      // Shield converts the would-be hit into a miss if attacker's roll - AC ≤ acBonus.
      nova:      { triggerRound: 1, threshold: 'whileSlotsLeft' },  // fire until slots out
      sustained: { triggerRound: 1, threshold: 3 },                  // fire if hitBy ≤ 3
      defensive: { triggerRound: 1, threshold: 'wouldDrop' },        // fire only if would drop self
    },

    initialState() { return { slotsLeft: {} }; },

    hooks: {
      onCombatStart(self, ctx) {
        const ref = self.pm.features.find(f => f.id === 'shield');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        self.featureState.shield.slotsLeft = { ...(params.slotsByLevel || {}) };
      },

      onAttackAttempt(self, action, target, rollCtx) {
        if (!self.reactionAvailableThisRound) return;
        const state = self.featureState.shield;
        if (!state || !rollCtx.hits) return;
        // Find lowest available slot of level 1+.
        const levels = Object.keys(state.slotsLeft).map(Number).sort((a,b) => a - b);
        const lowestAvailable = levels.find(l => l >= 1 && state.slotsLeft[l] > 0);
        if (!lowestAvailable) return;

        const ref = self.pm.features.find(f => f.id === 'shield');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        const acBonus = params.acBonus || 5;
        const hitBy = (rollCtx.roll || 0) - (self.ac || 10);  // positive = hit by N
        const wouldStillHit = hitBy > acBonus;
        if (wouldStillHit) return;

        const mode = (self.pm.tactics && self.pm.tactics.mode) || 'sustained';
        const policy = this.modePolicy[mode] || this.modePolicy.sustained;
        let shouldFire = false;
        if (policy.threshold === 'whileSlotsLeft') shouldFire = true;
        else if (typeof policy.threshold === 'number') shouldFire = hitBy <= policy.threshold;
        else if (policy.threshold === 'wouldDrop') {
          // Heuristic: only fire if the hit would drop self to 0 HP. dmgCtx isn't
          // available at attempt time; approximate via "hp ≤ avg monster damage" (10).
          shouldFire = (self.hp || 0) <= 10;
        }
        if (!shouldFire) return;

        rollCtx.hits = false;
        state.slotsLeft[lowestAvailable] -= 1;
        self.reactionAvailableThisRound = false;
        if (rollCtx.eventLog) {
          // event log may live on ctx not rollCtx; safe-push when available.
        }
        return 'consume';
      },

      onRoundEnd(self, round, ctx) {
        self.reactionAvailableThisRound = true;
      },
    },
  };
```

Register:

```javascript
  const LIBRARY = {
    rage: RAGE,
    sneakAttack: SNEAK_ATTACK,
    actionSurge: ACTION_SURGE,
    divineSmite: DIVINE_SMITE,
    healingWord: HEALING_WORD,
    shield: SHIELD,
  };
```

- [ ] **Step 4: Run tests — all 49 passing**

- [ ] **Step 5: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features: Shield (Wizard/Sorcerer reaction) + 4 tests"
```

---

### Task 2.7: Hex / Hunter's Mark

**Files:**
- Modify: `pc-features.js`
- Test: `tests/pc-features.test.html`

- [ ] **Step 1: Add failing tests**

```javascript
    group('Hex / Hunter\'s Mark');

    test('Hex: onCombatStart picks a target (the first living monster)', () => {
      const hex = PCFeatures.LIBRARY.hexMark;
      const self = {
        pm: { features: [{id:'hexMark'}], tactics: {mode:'sustained'} },
        featureState: { hexMark: hex.initialState() },
      };
      const monster = { id: 'm:1', side: 'monster', dead: false };
      const ctx = { round: 1, combatants: [self, monster], eventLog: [] };
      hex.hooks.onCombatStart(self, ctx);
      assertEq(self.featureState.hexMark.targetId, 'm:1');
    });

    test('Hex: onAttackHit adds 1d6 damage when target matches', () => {
      const hex = PCFeatures.LIBRARY.hexMark;
      const self = { featureState: { hexMark: { targetId: 'm:1' } } };
      const action = { kind: 'attack' };
      const target = { id: 'm:1' };
      const dmgCtx = { amount: 8, type: 'piercing', bonusDice: [] };
      hex.hooks.onAttackHit(self, action, target, dmgCtx);
      assertEq(dmgCtx.bonusDice.length, 1);
      assertEq(dmgCtx.bonusDice[0].dice, '1d6');
      assertEq(dmgCtx.bonusDice[0].type, 'necrotic');
    });

    test('Hex: does NOT add damage when target does not match', () => {
      const hex = PCFeatures.LIBRARY.hexMark;
      const self = { featureState: { hexMark: { targetId: 'm:1' } } };
      const action = { kind: 'attack' };
      const target = { id: 'm:2' };
      const dmgCtx = { amount: 8, type: 'piercing', bonusDice: [] };
      hex.hooks.onAttackHit(self, action, target, dmgCtx);
      assertEq(dmgCtx.bonusDice.length, 0);
    });

    test('Hex: onMonsterDowned recasts on a new target (Nova mode)', () => {
      const hex = PCFeatures.LIBRARY.hexMark;
      const self = {
        pm: { features: [{id:'hexMark'}], tactics: {mode:'nova'} },
        featureState: { hexMark: { targetId: 'm:1' } },
      };
      const dead = { id: 'm:1' };
      const alive = { id: 'm:2', side: 'monster', dead: false };
      const ctx = { round: 3, combatants: [self, dead, alive], eventLog: [] };
      hex.hooks.onMonsterDowned(self, dead, ctx);
      assertEq(self.featureState.hexMark.targetId, 'm:2');
    });

    test('Hex: does NOT recast under Sustained when first target dies', () => {
      const hex = PCFeatures.LIBRARY.hexMark;
      const self = {
        pm: { features: [{id:'hexMark'}], tactics: {mode:'sustained'} },
        featureState: { hexMark: { targetId: 'm:1' } },
      };
      const dead = { id: 'm:1' };
      const alive = { id: 'm:2', side: 'monster', dead: false };
      hex.hooks.onMonsterDowned(self, dead, { round: 3, combatants: [self, dead, alive] });
      assertEq(self.featureState.hexMark.targetId, null);
    });
```

- [ ] **Step 2: Run tests — 5 new failures**

- [ ] **Step 3: Implement Hex / Hunter's Mark**

Append:

```javascript
  const HEX_MARK = {
    id: 'hexMark',
    name: "Hex / Hunter's Mark",
    source: 'builtin',
    category: ['damage'],
    classHint: 'warlock',
    summary: '+1d6 damage on hits against a marked target. Concentration; recasts on kill in Nova mode.',

    deriveParams(identityOrPm) {
      // Hex/Mark uses a 1st-level slot at any caster level; damage is 1d6 RAW.
      return { damageDice: '1d6', recastSlots: 4 };
    },

    modePolicy: {
      nova:      { recastOnKill: true },
      sustained: { recastOnKill: false },
      defensive: { recastOnKill: false },
    },

    initialState() { return { targetId: null, slotsLeft: 0 }; },

    hooks: {
      onCombatStart(self, ctx) {
        const ref = self.pm.features.find(f => f.id === 'hexMark');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        self.featureState.hexMark.slotsLeft = params.recastSlots || 4;
        // Pick first living monster.
        const target = (ctx.combatants || []).find(c => c.side === 'monster' && !c.dead);
        if (target) {
          self.featureState.hexMark.targetId = target.id;
          if (ctx.eventLog) ctx.eventLog.push({ round: ctx.round, type: 'feature', who: self.id, what: 'Hex on ' + target.id });
        }
      },

      onAttackHit(self, action, target, dmgCtx) {
        const state = self.featureState.hexMark;
        if (!state || !state.targetId || !target) return;
        if (target.id !== state.targetId) return;
        const ref = self.pm.features.find(f => f.id === 'hexMark');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        if (!Array.isArray(dmgCtx.bonusDice)) dmgCtx.bonusDice = [];
        dmgCtx.bonusDice.push({ dice: params.damageDice || '1d6', type: 'necrotic', source: 'hexMark' });
      },

      onMonsterDowned(self, monster, ctx) {
        const state = self.featureState.hexMark;
        if (!state || state.targetId !== monster.id) return;
        const mode = (self.pm.tactics && self.pm.tactics.mode) || 'sustained';
        const policy = this.modePolicy[mode] || this.modePolicy.sustained;
        if (!policy.recastOnKill) { state.targetId = null; return; }
        if (state.slotsLeft <= 0) { state.targetId = null; return; }
        const newTarget = (ctx.combatants || []).find(c => c.side === 'monster' && !c.dead && c.id !== monster.id);
        if (newTarget) {
          state.targetId = newTarget.id;
          state.slotsLeft -= 1;
          if (ctx.eventLog) ctx.eventLog.push({ round: ctx.round, type: 'feature', who: self.id, what: 'Hex re-cast on ' + newTarget.id });
        } else {
          state.targetId = null;
        }
      },
    },
  };
```

Register:

```javascript
  const LIBRARY = {
    rage: RAGE,
    sneakAttack: SNEAK_ATTACK,
    actionSurge: ACTION_SURGE,
    divineSmite: DIVINE_SMITE,
    healingWord: HEALING_WORD,
    shield: SHIELD,
    hexMark: HEX_MARK,
  };
```

- [ ] **Step 4: Run tests — all 54 passing**

- [ ] **Step 5: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features: Hex / Hunter's Mark + 5 tests"
```

---

### Task 2.8: Bardic Inspiration

**Files:**
- Modify: `pc-features.js`
- Test: `tests/pc-features.test.html`

- [ ] **Step 1: Add failing tests**

```javascript
    group('Bardic Inspiration');

    test('Bardic Inspiration: die size scales with level (d6→d8 at L5, d10 at L10, d12 at L15)', () => {
      const bi = PCFeatures.LIBRARY.bardicInspiration;
      assertEq(bi.deriveParams({ identity: { level: 1  } }).die, 'd6');
      assertEq(bi.deriveParams({ identity: { level: 5  } }).die, 'd8');
      assertEq(bi.deriveParams({ identity: { level: 10 } }).die, 'd10');
      assertEq(bi.deriveParams({ identity: { level: 15 } }).die, 'd12');
    });

    test('Bardic Inspiration: onCombatStart hands out dice to allies (count = CHA mod)', () => {
      const bi = PCFeatures.LIBRARY.bardicInspiration;
      const self = {
        id: 'pc:bard',
        pm: { features: [{id:'bardicInspiration'}], abilities: { cha: 18 }, identity: { level: 5 }, tactics: {mode:'sustained'} },
        featureState: { bardicInspiration: bi.initialState() },
      };
      const ally1 = { id: 'pc:fighter', side: 'pc' };
      const ally2 = { id: 'pc:rogue',   side: 'pc' };
      const ally3 = { id: 'pc:cleric',  side: 'pc' };
      const ally4 = { id: 'pc:wizard',  side: 'pc' };
      const ctx = { round: 1, combatants: [self, ally1, ally2, ally3, ally4], eventLog: [] };
      bi.hooks.onCombatStart(self, ctx);
      // CHA 18 → mod +4 → up to 4 dice handed out
      const diceCount = Object.keys(self.featureState.bardicInspiration.diceHeldBy || {}).length;
      assertEq(diceCount, 4);
    });

    test('Bardic Inspiration: onSaveAttempt of an ally consumes a die and adds avg die value to bonus', () => {
      const bi = PCFeatures.LIBRARY.bardicInspiration;
      const bardId = 'pc:bard';
      const bard = {
        id: bardId,
        pm: { features: [{id:'bardicInspiration'}], abilities: { cha: 16 }, identity: { level: 5 }, tactics: {mode:'sustained'} },
        featureState: { bardicInspiration: { diceHeldBy: { 'pc:fighter': 'd8' }, dieSize: 'd8' } },
      };
      const ally = { id: 'pc:fighter', pm: { features: [], tactics: {mode:'sustained'} }, featureState: {} };
      const rollCtx = { bonus: 0, eventLog: [] };
      // Hook fires for the ally, not the bard — but the bard's feature watches.
      bi.hooks.onSaveAttempt(bard, ally, 'wis', 15, rollCtx);
      // Expect: die was consumed, bonus +~avg(d8)
      assertEq(bard.featureState.bardicInspiration.diceHeldBy['pc:fighter'], undefined);
      assert(rollCtx.bonus >= 4, 'rollCtx.bonus should be increased by d8 (median 4-5)');
    });
```

**Note for the implementer:** Bardic Inspiration's hook semantics are *cross-PC* — the bard's hooks fire on **other** combatants' rolls. This is unusual. The engine dispatches `onSaveAttempt` to the combatant making the save; but the bard's feature is on the bard, not on the saving PC. To make this work, the dispatcher gains a *broadcast* variant — see Step 3 below.

- [ ] **Step 2: Run tests — 3 new failures**

- [ ] **Step 3: Add broadcast hooks to the dispatcher, then implement Bardic Inspiration**

First extend `dispatchHook` to support a "broadcast" mode. In `pc-features.js`, add a new exported function `dispatchBroadcastHook`:

```javascript
  // Broadcast hook: invoke the named hook on every PC's features, with the
  // triggering combatant as the second positional arg.
  //
  // Used for cross-PC features like Bardic Inspiration where the bard's
  // feature needs to fire on another PC's save attempt.
  function dispatchBroadcastHook(allCombatants, triggeringCombatant, hookName, ...args) {
    if (!Array.isArray(allCombatants)) return;
    for (const c of allCombatants) {
      if (!c || c.side !== 'pc' || !c.pm || !Array.isArray(c.pm.features)) continue;
      if (!c.featureState) c.featureState = {};
      for (const ref of c.pm.features) {
        if (!ref || !ref.id) continue;
        const state = c.featureState[ref.id];
        if (state && state._disabled) continue;
        const def = resolve(ref);
        if (!def || !def.hooks || typeof def.hooks[hookName] !== 'function') continue;
        try {
          def.hooks[hookName].call(def, c, triggeringCombatant, ...args);
        } catch (e) {
          console.warn('PCFeatures: feature "' + ref.id + '" broadcast hook ' + hookName + ' threw:', e);
          if (!c.featureState[ref.id]) c.featureState[ref.id] = {};
          c.featureState[ref.id]._disabled = true;
        }
      }
    }
  }
```

Expose it on the namespace:

```javascript
  const PCFeatures = {
    HOOK_NAMES,
    MODE_PREDICATES,
    LIBRARY,
    resolve,
    dispatchHook,
    dispatchBroadcastHook,
    initFeatureState,
  };
```

Now the Bardic Inspiration feature. Append:

```javascript
  const BARDIC_INSPIRATION = {
    id: 'bardicInspiration',
    name: 'Bardic Inspiration',
    source: 'builtin',
    category: ['support'],
    classHint: 'bard',
    summary: 'Hand out inspiration dice at combat start; allies spend them to boost attacks and saves.',

    deriveParams(identityOrPm) {
      const level = (identityOrPm && identityOrPm.level) || (identityOrPm && identityOrPm.identity && identityOrPm.identity.level) || 1;
      let die = 'd6';
      if (level >= 5)  die = 'd8';
      if (level >= 10) die = 'd10';
      if (level >= 15) die = 'd12';
      return { die };
    },

    modePolicy: {
      nova:      { distribute: 'best-attackers' },
      sustained: { distribute: 'mixed' },
      defensive: { distribute: 'reserve-one-for-saves' },
    },

    initialState() { return { diceHeldBy: {}, dieSize: 'd6' }; },

    hooks: {
      onCombatStart(self, ctx) {
        const ref = self.pm.features.find(f => f.id === 'bardicInspiration');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        const cha = (self.pm.abilities && self.pm.abilities.cha) || 10;
        const count = Math.max(1, mod(cha));
        const allies = (ctx.combatants || []).filter(c => c.side === 'pc' && c.id !== self.id);
        const targets = allies.slice(0, count);
        const dice = {};
        for (const ally of targets) dice[ally.id] = params.die;
        self.featureState.bardicInspiration.diceHeldBy = dice;
        self.featureState.bardicInspiration.dieSize = params.die;
        if (ctx.eventLog) ctx.eventLog.push({
          round: ctx.round, type: 'feature', who: self.id,
          what: 'Bardic Inspiration handed to ' + targets.map(a => a.id).join(', '),
        });
      },

      // self = the bard; triggering = the ally making the save/attack
      onSaveAttempt(self, triggering, ability, dc, rollCtx) {
        const state = self.featureState.bardicInspiration;
        if (!state || !state.diceHeldBy) return;
        if (!triggering || !state.diceHeldBy[triggering.id]) return;
        // Consume die; add expected value (e.g., d8 → 4.5).
        const die = state.diceHeldBy[triggering.id];
        const sides = parseInt(die.replace('d', ''), 10);
        const expectedValue = (sides + 1) / 2;
        rollCtx.bonus = (rollCtx.bonus || 0) + expectedValue;
        delete state.diceHeldBy[triggering.id];
      },

      onAttackAttempt(self, triggering, target, rollCtx) {
        // Same logic as save — different hook. Allies can spend on attacks too.
        const state = self.featureState.bardicInspiration;
        if (!state || !state.diceHeldBy) return;
        if (!triggering || !state.diceHeldBy[triggering.id]) return;
        // Only use on a borderline attack: missed by ≤ 5.
        const hitBy = (rollCtx.roll || 0) - (target.ac || 10);
        if (hitBy > 0 || hitBy < -5) return;  // already hit or missed badly
        const die = state.diceHeldBy[triggering.id];
        const sides = parseInt(die.replace('d', ''), 10);
        const expectedValue = (sides + 1) / 2;
        rollCtx.bonus = (rollCtx.bonus || 0) + expectedValue;
        rollCtx.hits = ((rollCtx.roll || 0) + expectedValue) >= (target.ac || 10);
        delete state.diceHeldBy[triggering.id];
      },
    },
  };
```

Register:

```javascript
  const LIBRARY = {
    rage: RAGE,
    sneakAttack: SNEAK_ATTACK,
    actionSurge: ACTION_SURGE,
    divineSmite: DIVINE_SMITE,
    healingWord: HEALING_WORD,
    shield: SHIELD,
    hexMark: HEX_MARK,
    bardicInspiration: BARDIC_INSPIRATION,
  };
```

- [ ] **Step 4: Run tests — all 57 passing**

- [ ] **Step 5: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features: Bardic Inspiration + dispatchBroadcastHook + 3 tests"
```

---

## Phase 3 — DSL compilation

### Task 3.1: DSL primitives registry

**Files:**
- Modify: `pc-features.js`
- Test: `tests/pc-features.test.html`

- [ ] **Step 1: Add failing tests**

```javascript
    group('DSL primitives');

    test('addDamage primitive adds flat damage to dmgCtx.amount', () => {
      const ctx = { dmgCtx: { amount: 8, bonusDice: [] } };
      PCFeatures.PRIMITIVES.addDamage.apply({}, ctx, { value: 3 });
      assertEq(ctx.dmgCtx.amount, 11);
    });

    test('addDamageDice primitive pushes a die spec onto bonusDice', () => {
      const ctx = { dmgCtx: { amount: 8, bonusDice: [] } };
      PCFeatures.PRIMITIVES.addDamageDice.apply({}, ctx, { dice: '1d8', type: 'fire' });
      assertEq(ctx.dmgCtx.bonusDice.length, 1);
      assertEq(ctx.dmgCtx.bonusDice[0].dice, '1d8');
    });

    test('consumeBonusAction primitive flips bonusActionAvailable to false', () => {
      const self = { bonusActionAvailable: true };
      PCFeatures.PRIMITIVES.consumeBonusAction.apply(self, {}, {});
      assertEq(self.bonusActionAvailable, false);
    });

    test('decrementUses primitive decrements featureState[id].usesLeft', () => {
      const self = { featureState: { fey: { usesLeft: 3 } } };
      PCFeatures.PRIMITIVES.decrementUses.apply(self, {}, { featureId: 'fey' });
      assertEq(self.featureState.fey.usesLeft, 2);
    });

    test('heal primitive adds HP to target (self or named ally)', () => {
      const self = { hp: 10, maxHp: 30 };
      PCFeatures.PRIMITIVES.heal.apply(self, {}, { amount: 8, target: 'self' });
      assertEq(self.hp, 18);
    });
```

- [ ] **Step 2: Run tests — 5 new failures**

- [ ] **Step 3: Implement primitives registry**

Append to `pc-features.js` after BARDIC_INSPIRATION:

```javascript
  // ── DSL primitives ──
  // Each primitive is a function that mutates state. Signature:
  //   apply(self, hookCtx, params)
  //     self     — the combatant the feature is on
  //     hookCtx  — context from the hook (dmgCtx, rollCtx, ctx, etc., grouped)
  //     params   — the params declared on the effect in the DSL spec
  const PRIMITIVES = {
    addDamage: {
      apply(self, hookCtx, params) {
        if (hookCtx && hookCtx.dmgCtx) hookCtx.dmgCtx.amount += Number(params.value) || 0;
      },
    },
    addDamageDice: {
      apply(self, hookCtx, params) {
        if (!hookCtx || !hookCtx.dmgCtx) return;
        if (!Array.isArray(hookCtx.dmgCtx.bonusDice)) hookCtx.dmgCtx.bonusDice = [];
        hookCtx.dmgCtx.bonusDice.push({ dice: params.dice, type: params.type || 'force', source: 'dsl' });
      },
    },
    addAcBonus: {
      apply(self, hookCtx, params) {
        if (typeof self.ac === 'number') self.ac += Number(params.value) || 0;
      },
    },
    addResistance: {
      apply(self, hookCtx, params) {
        if (!hookCtx || !hookCtx.dmgCtx) return;
        const types = Array.isArray(params.types) ? params.types : [];
        if (types.includes(hookCtx.dmgCtx.type)) {
          hookCtx.dmgCtx.amount = Math.floor(hookCtx.dmgCtx.amount / 2);
        }
      },
    },
    consumeAction:       { apply(self) { self.actionsAvailable = Math.max(0, (self.actionsAvailable || 0) - 1); } },
    consumeBonusAction:  { apply(self) { self.bonusActionAvailable = false; } },
    consumeReaction:     { apply(self) { self.reactionAvailableThisRound = false; } },
    heal: {
      apply(self, hookCtx, params) {
        const amt = Number(params.amount) || 0;
        if (params.target === 'self' || !params.target) {
          self.hp = Math.min(self.maxHp || self.hp + amt, (self.hp || 0) + amt);
        }
        // Named-ally targets resolved via hookCtx.target if available.
        else if (hookCtx && hookCtx.target && hookCtx.target.maxHp) {
          hookCtx.target.hp = Math.min(hookCtx.target.maxHp, (hookCtx.target.hp || 0) + amt);
        }
      },
    },
    applyCondition: {
      apply(self, hookCtx, params) {
        const target = (params.target === 'self' || !params.target) ? self : (hookCtx && hookCtx.target);
        if (!target) return;
        if (!target.conditions) target.conditions = new Map();
        target.conditions.set(params.condition, Number(params.duration) || 1);
      },
    },
    decrementUses: {
      apply(self, hookCtx, params) {
        const id = params.featureId;
        if (!id || !self.featureState || !self.featureState[id]) return;
        const state = self.featureState[id];
        if (typeof state.usesLeft === 'number') state.usesLeft = Math.max(0, state.usesLeft - 1);
      },
    },
    flag: {
      apply(self, hookCtx, params) {
        if (!self.flags) self.flags = {};
        self.flags[params.name] = { until: (hookCtx.ctx?.round || 0) + (Number(params.duration) || 1) };
      },
    },
  };
```

Expose:

```javascript
  const PCFeatures = {
    HOOK_NAMES,
    MODE_PREDICATES,
    LIBRARY,
    PRIMITIVES,
    resolve,
    dispatchHook,
    dispatchBroadcastHook,
    initFeatureState,
  };
```

- [ ] **Step 4: Run tests — all 62 passing**

- [ ] **Step 5: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features: DSL primitives registry (10 primitives) + 5 tests"
```

---

### Task 3.2: `compileDSL` — turn JSON spec into a feature object

**Files:**
- Modify: `pc-features.js`
- Test: `tests/pc-features.test.html`

- [ ] **Step 1: Add failing tests**

```javascript
    group('compileDSL');

    test('compileDSL produces a feature object with hooks from effects list', () => {
      const spec = {
        id: 'feyStep', name: 'Fey Step', source: 'homebrew',
        category: ['action-economy'],
        params: { usesPerEncounter: { type: 'int', value: 1 } },
        modePolicy: { sustained: { triggerRound: 1, conditionFn: 'whenHpBelowHalf' } },
        effects: [
          { hook: 'onTurnStart', primitive: 'consumeBonusAction', when: 'usesLeftGreaterThanZero' },
          { hook: 'onTurnStart', primitive: 'decrementUses', params: { featureId: 'feyStep' } },
        ],
      };
      const compiled = PCFeatures.compileDSL(spec);
      assert(compiled, 'compileDSL returns an object');
      assertEq(compiled.id, 'feyStep');
      assertEq(compiled.source, 'homebrew');
      assert(typeof compiled.hooks.onTurnStart === 'function', 'onTurnStart hook attached');
    });

    test('compileDSL hook runs effects in order, respecting "when" predicates', () => {
      let consumed = false;
      const spec = {
        id: 't', name: 'T', source: 'homebrew',
        modePolicy: { sustained: { triggerRound: 1, conditionFn: 'always' } },
        effects: [
          { hook: 'onTurnStart', primitive: 'consumeBonusAction' },
        ],
      };
      const compiled = PCFeatures.compileDSL(spec);
      const self = {
        pm: { features: [{id:'t'}], tactics: {mode:'sustained'} },
        featureState: { t: {} },
        bonusActionAvailable: true,
      };
      compiled.hooks.onTurnStart.call(compiled, self, { round: 1, combatants: [] });
      assertEq(self.bonusActionAvailable, false);
    });

    test('compileDSL ignores unknown primitives gracefully (does not throw)', () => {
      const spec = {
        id: 'bad', name: 'Bad', source: 'homebrew',
        modePolicy: { sustained: { triggerRound: 1, conditionFn: 'always' } },
        effects: [
          { hook: 'onTurnStart', primitive: 'doesNotExist' },
          { hook: 'onTurnStart', primitive: 'consumeBonusAction' },
        ],
      };
      const compiled = PCFeatures.compileDSL(spec);
      const self = { pm: { features: [{id:'bad'}], tactics: {mode:'sustained'} }, featureState: { bad: {} }, bonusActionAvailable: true };
      // Should not throw despite the bad primitive.
      compiled.hooks.onTurnStart.call(compiled, self, { round: 1, combatants: [] });
      // The good primitive after the bad one still ran.
      assertEq(self.bonusActionAvailable, false);
    });

    test('compileDSL respects modePolicy.conditionFn predicate', () => {
      const spec = {
        id: 't', name: 'T', source: 'homebrew',
        modePolicy: { sustained: { triggerRound: 1, conditionFn: 'whenHpBelowHalf' } },
        effects: [ { hook: 'onTurnStart', primitive: 'consumeBonusAction' } ],
      };
      const compiled = PCFeatures.compileDSL(spec);
      const self = {
        pm: { features: [{id:'t'}], tactics: {mode:'sustained'} },
        featureState: { t: {} },
        bonusActionAvailable: true,
        hp: 30, maxHp: 30,  // not below half
      };
      compiled.hooks.onTurnStart.call(compiled, self, { round: 1, combatants: [] });
      assertEq(self.bonusActionAvailable, true);  // predicate failed → no fire
    });
```

- [ ] **Step 2: Run tests — 4 new failures**

- [ ] **Step 3: Implement `compileDSL`**

Append to `pc-features.js`:

```javascript
  function compileDSL(spec) {
    if (!spec || typeof spec !== 'object' || !spec.id) return null;
    // Group effects by hook name.
    const effectsByHook = {};
    for (const eff of (spec.effects || [])) {
      if (!eff || !eff.hook) continue;
      if (!effectsByHook[eff.hook]) effectsByHook[eff.hook] = [];
      effectsByHook[eff.hook].push(eff);
    }
    const hooks = {};
    for (const hookName of Object.keys(effectsByHook)) {
      const effects = effectsByHook[hookName];
      hooks[hookName] = function (self, ...rest) {
        // Resolve the hook's typical context shape — we don't know which hook
        // the engine is calling, but for the common ones the rest args are
        // (ctx) or (action, target, dmgCtx) or (ctx) for round-end, etc.
        // Pack them into a generic hookCtx object the primitives can read.
        const hookCtx = {
          ctx: rest[0] && rest[0].combatants ? rest[0] : (rest[rest.length - 1] && rest[rest.length - 1].combatants ? rest[rest.length - 1] : null),
          action:   rest[0] && rest[0].kind === 'attack' ? rest[0] : null,
          target:   (rest[1] && rest[1].side) ? rest[1] : null,
          dmgCtx:   rest.find(a => a && typeof a.amount === 'number'),
          rollCtx:  rest.find(a => a && (typeof a.roll === 'number' || typeof a.bonus === 'number')),
        };
        // Check this hook's mode policy.
        const mode = (self.pm.tactics && self.pm.tactics.mode) || 'sustained';
        const policy = (spec.modePolicy && spec.modePolicy[mode]) || (spec.modePolicy && spec.modePolicy.sustained) || {};
        if (policy.triggerRound && (hookCtx.ctx?.round || 0) < policy.triggerRound) return;
        if (policy.conditionFn) {
          const pred = MODE_PREDICATES[policy.conditionFn];
          if (pred && !pred(self, hookCtx.ctx || {}, spec.id)) return;
        }
        // Run each effect in order.
        for (const eff of effects) {
          if (eff.when) {
            const whenPred = MODE_PREDICATES[eff.when];
            if (whenPred && !whenPred(self, hookCtx.ctx || {}, spec.id)) continue;
          }
          const prim = PRIMITIVES[eff.primitive];
          if (!prim || typeof prim.apply !== 'function') {
            console.warn('PCFeatures.compileDSL: unknown primitive "' + eff.primitive + '" in feature ' + spec.id);
            continue;
          }
          try { prim.apply(self, hookCtx, eff.params || {}); }
          catch (e) { console.warn('PCFeatures.compileDSL: primitive ' + eff.primitive + ' threw:', e); }
        }
      };
    }
    return {
      id: spec.id,
      name: spec.name,
      source: 'homebrew',
      category: spec.category || [],
      summary: spec.summary || '',
      params: spec.params || {},
      modePolicy: spec.modePolicy || {},
      hooks,
      initialState() {
        const state = {};
        const usesParam = spec.params && spec.params.usesPerEncounter;
        if (usesParam) state.usesLeft = usesParam.value || usesParam.default || 0;
        return state;
      },
    };
  }
```

Expose:

```javascript
  const PCFeatures = {
    HOOK_NAMES,
    MODE_PREDICATES,
    LIBRARY,
    PRIMITIVES,
    resolve,
    dispatchHook,
    dispatchBroadcastHook,
    initFeatureState,
    compileDSL,
  };
```

- [ ] **Step 4: Run tests — all 66 passing**

- [ ] **Step 5: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features: compileDSL turns JSON spec into a feature object + 4 tests"
```

---

## Phase 4 — Engine integration

`pc-features.js` is now feature-complete. Wire it into `crucible-engine.js`.

### Task 4.1: Add `<script src="pc-features.js">` and load order

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Find the script tags**

```bash
grep -n 'script src="' crucible-dm.html
```

- [ ] **Step 2: Add the script tag right before crucible-engine.js**

Find the line `<script src="crucible-engine.js">`. Insert immediately before it:

```html
<script src="pc-features.js"></script>
```

- [ ] **Step 3: Verify the file loads in browser**

Open `http://localhost:8000/crucible-dm.html`, open DevTools console, type `PCFeatures.HOOK_NAMES` — should print the 9-element array.

- [ ] **Step 4: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: load pc-features.js before crucible-engine.js"
```

---

### Task 4.2: `buildCombatants` initializes `featureState` on PCs

**Files:**
- Modify: `crucible-engine.js:516-534` (PC combatant construction in `buildCombatants`)

- [ ] **Step 1: Read the existing buildCombatants**

```bash
sed -n '514,560p' crucible-engine.js
```

- [ ] **Step 2: Insert featureState initialization after the PC push**

After line 533 (closing `});` of the PC combatant `out.push({...})`), and before the monster loop at line 535, add:

```javascript
      // Initialize feature state for any PC class features on this PC.
      // (No-op when PC has no features array — backward compatible.)
      if (typeof PCFeatures !== 'undefined') {
        PCFeatures.initFeatureState(out[out.length - 1]);
      }
```

Concretely, the modified region reads:

```javascript
  function buildCombatants(party, monsterPicks, rng, rollHp) {
    const out = [];
    for (const pm of (party || [])) {
      out.push({
        id: 'pc:' + pm.id,
        side: 'pc',
        name: pm.identity.name || 'PC',
        pm,
        hp: pm.combat.hp, maxHp: pm.combat.maxHp, ac: pm.combat.ac,
        initBonus: pm.combat.initBonus || 0,
        isMinion: false, isSolo: false,
        conditions: new Map(),
        downed: false, dead: false,
        slotsLeft: {}, rechargeReady: {},
        damageTypesReceivedLastTurn: new Set(),
        damageTypesReceivedThisTurn: new Set(),
        lastHealRound: -99,
        // Action-economy budget fields used by PC features.
        actionsAvailable: 1,
        bonusActionAvailable: true,
        reactionAvailableThisRound: true,
      });
      // Initialize feature state for any PC class features on this PC.
      // (No-op when PC has no features array — backward compatible.)
      if (typeof PCFeatures !== 'undefined') {
        PCFeatures.initFeatureState(out[out.length - 1]);
      }
    }
    for (const pick of (monsterPicks || [])) {
      // ... unchanged
```

(Note the three new fields on the PC combatant object: `actionsAvailable`, `bonusActionAvailable`, `reactionAvailableThisRound`.)

- [ ] **Step 3: Commit**

```bash
git add crucible-engine.js
git commit -m "Crucible engine: seed PC featureState + action-economy budgets in buildCombatants"
```

---

### Task 4.3: Wire `onCombatStart` hook

**Files:**
- Modify: `crucible-engine.js` (find `runSim` or `runOneTrial`)

- [ ] **Step 1: Find the trial-start code path**

```bash
grep -n "function runOneTrial\|function runSim\|currentRound = 1\|round\s*=\s*1" crucible-engine.js | head -10
```

The trial setup builds combatants then enters a round loop. Find the line right after `buildCombatants(...)` returns, before the first `while (round < ...)` or similar loop.

- [ ] **Step 2: Add the onCombatStart broadcast**

Immediately after `const combatants = buildCombatants(...)` (or the equivalent variable assignment), add:

```javascript
    // Fire onCombatStart for every PC's features.
    if (typeof PCFeatures !== 'undefined') {
      const startCtx = { round: 1, combatants, rng, livingEnemies: combatants.filter(c => c.side === 'monster' && !c.dead), livingAllies: combatants.filter(c => c.side === 'pc' && !c.dead), eventLog };
      for (const c of combatants) {
        if (c.side === 'pc') PCFeatures.dispatchHook(c, 'onCombatStart', startCtx);
      }
    }
```

(`eventLog` may need declaring earlier in the trial setup if it doesn't already exist. If it doesn't, declare `const eventLog = [];` at the top of the trial setup.)

- [ ] **Step 3: Commit**

```bash
git add crucible-engine.js
git commit -m "Crucible engine: fire onCombatStart at trial setup"
```

---

### Task 4.4: Wire `onTurnStart` and reset action budgets per turn

**Files:**
- Modify: `crucible-engine.js` (turn loop)

- [ ] **Step 1: Find the per-turn code**

```bash
grep -n "actionsAvailable\|c.actionsAvailable\|combatant.actionsAvailable" crucible-engine.js
```

If no hits beyond what Task 4.2 added: locate the start of each combatant's turn inside the round loop. This is wherever the engine picks a target and resolves the action. Look for something like `pickTarget` or `bestEvAction` calls.

- [ ] **Step 2: At the top of each combatant's turn, reset action budgets and fire onTurnStart**

Insert (replacing existing reset logic if any):

```javascript
        // Reset per-turn action budgets.
        c.actionsAvailable = 1;
        c.bonusActionAvailable = true;
        // reactionAvailableThisRound resets at onRoundEnd, not per turn.

        // Fire onTurnStart for PC features (passive features may grant extra actions, etc.).
        if (c.side === 'pc' && typeof PCFeatures !== 'undefined') {
          const turnCtx = { round, combatants, rng, livingEnemies: combatants.filter(x => x.side === 'monster' && !x.dead), livingAllies: combatants.filter(x => x.side === 'pc' && !x.dead), eventLog };
          PCFeatures.dispatchHook(c, 'onTurnStart', turnCtx);
        }
```

- [ ] **Step 3: Commit**

```bash
git add crucible-engine.js
git commit -m "Crucible engine: reset per-turn action budgets + onTurnStart hook"
```

---

### Task 4.5: Wire `onAttackHit` to apply damage modifiers via dmgCtx

**Files:**
- Modify: `crucible-engine.js` (action resolution for attacks)

- [ ] **Step 1: Find the attack-resolution damage computation**

```bash
grep -n "actionEv\|damage.*= sumDice\|c.hp -= " crucible-engine.js | head -15
```

The hit path computes a damage number after a successful to-hit roll. The exact location depends on the existing engine structure — find where damage is computed and then applied to the target.

- [ ] **Step 2: Wrap damage application in a dmgCtx object and dispatch hooks**

Before applying damage (`target.hp -= damage`), build a context object:

```javascript
        const dmgCtx = {
          amount: damage,
          type: action.damage?.type || 'untyped',
          source: action.name || action.id || 'attack',
          bonusDice: [],
          crit: wasCrit || false,
        };

        // Fire onAttackHit on the attacker for damage modifiers (Rage, Sneak, Hex, Smite).
        if (attacker.side === 'pc' && typeof PCFeatures !== 'undefined') {
          PCFeatures.dispatchHook(attacker, 'onAttackHit', action, target, dmgCtx);
        }

        // Resolve any bonus dice that features pushed onto dmgCtx.bonusDice.
        for (const bd of dmgCtx.bonusDice) {
          dmgCtx.amount += rollDice(bd.dice, rng);
        }

        // Fire onTakeDamage on the target for damage reduction (Rage resistance).
        if (target.side === 'pc' && typeof PCFeatures !== 'undefined') {
          PCFeatures.dispatchHook(target, 'onTakeDamage', dmgCtx);
        }

        target.hp -= dmgCtx.amount;
```

- [ ] **Step 3: Commit**

```bash
git add crucible-engine.js
git commit -m "Crucible engine: dmgCtx + onAttackHit + onTakeDamage hooks"
```

---

### Task 4.6: Wire `onAttackAttempt` for reaction features (Shield)

**Files:**
- Modify: `crucible-engine.js` (to-hit resolution)

- [ ] **Step 1: Find the to-hit roll site**

```bash
grep -n "hitRoll\|attackRoll\|rollD20.*toHit\|d20 + " crucible-engine.js | head -5
```

- [ ] **Step 2: After computing the d20 + bonus but BEFORE comparing to AC, dispatch onAttackAttempt on the target**

```javascript
        const roll = rollDie(20, rng) + (action.toHit || 0);
        let hits = roll >= target.ac;

        // Allow target's reaction features (Shield) to modify the hit.
        if (target.side === 'pc' && typeof PCFeatures !== 'undefined') {
          const rollCtx = { roll, hits, action, eventLog };
          PCFeatures.dispatchHook(target, 'onAttackAttempt', action, target, rollCtx);
          hits = rollCtx.hits;
        }
```

- [ ] **Step 3: Commit**

```bash
git add crucible-engine.js
git commit -m "Crucible engine: onAttackAttempt hook + Shield reaction integration"
```

---

### Task 4.7: Wire `onAllyDowned`, `onMonsterDowned`, `onRoundEnd`

**Files:**
- Modify: `crucible-engine.js`

- [ ] **Step 1: Find combatant-down logic**

```bash
grep -n "c.hp <= 0\|target.hp <= 0\|downed = true\|.dead = true" crucible-engine.js
```

- [ ] **Step 2: After applying damage, check for downs and dispatch**

After `target.hp -= dmgCtx.amount;`, add:

```javascript
        if (target.hp <= 0 && !target.downed) {
          target.downed = true;
          if (target.side === 'pc') {
            // PCs dropped: broadcast onAllyDowned to other PCs.
            if (typeof PCFeatures !== 'undefined') {
              for (const c of combatants) {
                if (c.side === 'pc' && c.id !== target.id && !c.downed) {
                  PCFeatures.dispatchHook(c, 'onAllyDowned', target, { round, combatants, rng, eventLog });
                }
              }
            }
          } else if (target.side === 'monster') {
            target.dead = true;
            if (typeof PCFeatures !== 'undefined') {
              for (const c of combatants) {
                if (c.side === 'pc' && !c.downed) {
                  PCFeatures.dispatchHook(c, 'onMonsterDowned', target, { round, combatants, rng, eventLog });
                }
              }
            }
          }
        }
```

- [ ] **Step 3: Find the end-of-round code**

```bash
grep -n "round += 1\|round++\|currentRound++" crucible-engine.js
```

- [ ] **Step 4: Before `round++`, dispatch onRoundEnd on every PC**

```javascript
        // End-of-round hook for PC features (Rage duration tick, reaction reset).
        if (typeof PCFeatures !== 'undefined') {
          const endCtx = { round, combatants, rng, eventLog };
          for (const c of combatants) {
            if (c.side === 'pc') PCFeatures.dispatchHook(c, 'onRoundEnd', round, endCtx);
          }
        }
```

- [ ] **Step 5: Commit**

```bash
git add crucible-engine.js
git commit -m "Crucible engine: onAllyDowned, onMonsterDowned, onRoundEnd hooks"
```

---

### Task 4.8: Smoke test — open Crucible, run a sim with empty-features PCs

**Files:** None (manual verification)

- [ ] **Step 1: Start server and open Crucible**

```bash
python3 -m http.server 8000 &
open 'http://localhost:8000/crucible-dm.html'
```

- [ ] **Step 2: Run a baseline simulation with NO features on any PC**

Add a PC manually (no features field — backward compat), pick a Goblin encounter, run 100 trials. Should succeed without errors.

- [ ] **Step 3: Open DevTools console — verify no warnings about features**

Should see no `PCFeatures: feature ... threw` messages. The engine should behave identically to pre-feature behavior when no features are attached.

- [ ] **Step 4: No commit (manual verification step)**

---

## Phase 5 — PC editor UI

### Task 5.1: `migratePCRecord` runs on `loadParty`

**Files:**
- Modify: `crucible-dm.html` (`loadParty` function)

- [ ] **Step 1: Find loadParty**

```bash
grep -n "function loadParty\|loadParty\s*=" crucible-dm.html
```

- [ ] **Step 2: Add the migration helper and call it**

Replace the existing `loadParty` with:

```javascript
function loadParty() {
  try {
    const raw = localStorage.getItem('crucible-party');
    if (raw) {
      const arr = JSON.parse(raw);
      return (Array.isArray(arr) ? arr : []).map(migratePCRecord);
    }
  } catch (e) { console.warn('crucible-party load failed', e); }
  return [];
}

function migratePCRecord(pm) {
  if (!pm) return pm;
  // tactics.resources → tactics.mode
  if (!pm.tactics) pm.tactics = { aiHint: 'focus' };
  if (!pm.tactics.mode) {
    if (pm.tactics.resources === 'nova') pm.tactics.mode = 'nova';
    else if (pm.tactics.resources === 'sustained') pm.tactics.mode = 'sustained';
    else pm.tactics.mode = 'sustained';
  }
  // features array
  if (!Array.isArray(pm.features)) pm.features = [];
  return pm;
}
```

- [ ] **Step 3: Update `defaultPC()` to include `mode` and `features`**

Find `defaultPC` (line ~102) and modify the `tactics` and add `features`:

```javascript
function defaultPC() {
  return {
    id: uid(),
    identity: { name:'New PC', player:'', class:'', subclass:'', level:5, race:'' },
    abilities: { str:14, dex:14, con:14, int:10, wis:12, cha:10 },
    profs:    { saves: { str:false, dex:false, con:false, int:false, wis:false, cha:false } },
    combat:   { hp:30, maxHp:30, ac:16, initBonus:2, speed:30 },
    actions:  [{ id:'a-' + Math.random().toString(36).slice(2,6),
                 name:'Longsword', source:'weapon', type:'attack',
                 atkAbility:'str', atkBonusOverride:null, actionRange:'melee',
                 damage:{ dice:'1d8', mod:'+atkAbility', type:'slashing',
                          riderDice:null, riderType:null },
                 save:null, heal:null, aoeTargets:0,
                 usesPerDay:null, recharge:null, attacksPerAction:1 }],
    tactics:  { aiHint:'focus', mode:'sustained' },
    features: [],
    _expanded: true,
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: migratePCRecord on loadParty (resources→mode, features:[])"
```

---

### Task 5.2: Features section in PC editor

**Files:**
- Modify: `crucible-dm.html` (`renderPC` or equivalent that renders each PC card)

- [ ] **Step 1: Find the PC card renderer**

```bash
grep -n "function renderPC\|function renderParty\|pcCard\|<details.*pc" crucible-dm.html | head
```

- [ ] **Step 2: Add a Features section to the PC card markup**

In the PC card template (inside the function that produces the per-PC HTML), after the Actions section and before the tactics row, add:

```javascript
  // Features section
  const featuresHtml = `
    <details class="pc-section" id="pc-features-${pm.id}">
      <summary>Features (${(pm.features || []).length})</summary>
      <div class="pc-features-list">
        ${(pm.features || []).map(f => {
          const def = PCFeatures.resolve(f);
          if (!def) return '';
          const sourceTag = f.source === 'homebrew'
            ? '<span class="feature-tag homebrew">homebrew</span>'
            : '<span class="feature-tag builtin">built-in</span>';
          return `
            <div class="feature-row" data-feature-id="${f.id}">
              <div class="feature-row-name">${def.name} ${sourceTag}</div>
              <div class="feature-row-summary">${def.summary || ''}</div>
              <button class="feature-row-remove" onclick="removeFeatureFromPC('${pm.id}','${f.id}')">×</button>
            </div>
          `;
        }).join('')}
      </div>
      <div class="pc-features-actions">
        <select onchange="addFeatureFromLibrary('${pm.id}', this.value); this.value=''">
          <option value="">+ Add from library...</option>
          ${Object.keys(PCFeatures.LIBRARY).map(id => {
            const def = PCFeatures.LIBRARY[id];
            const taken = (pm.features || []).some(f => f.id === id);
            return `<option value="${id}" ${taken ? 'disabled' : ''}>${def.name}${def.classHint ? ' (' + def.classHint + ')' : ''}</option>`;
          }).join('')}
        </select>
        <button onclick="openDSLEditor('${pm.id}')">+ Custom feature...</button>
      </div>
    </details>
  `;
```

Insert `${featuresHtml}` into the card template at the appropriate place (typically after the Actions `<details>` and before the tactics row).

- [ ] **Step 3: Add the handlers**

After `defaultPC()`, add:

```javascript
function addFeatureFromLibrary(pmId, featureId) {
  if (!featureId) return;
  const pm = party.find(p => p.id === pmId);
  const def = PCFeatures.LIBRARY[featureId];
  if (!pm || !def) return;
  if ((pm.features || []).some(f => f.id === featureId)) return;
  if (!Array.isArray(pm.features)) pm.features = [];
  const params = def.deriveParams ? def.deriveParams(pm) : {};
  pm.features.push({ id: featureId, source: 'builtin', params });
  saveParty();
  renderParty();
}

function removeFeatureFromPC(pmId, featureId) {
  const pm = party.find(p => p.id === pmId);
  if (!pm) return;
  pm.features = (pm.features || []).filter(f => f.id !== featureId);
  saveParty();
  renderParty();
}

function openDSLEditor(pmId) {
  // Implemented in Task 5.3.
  alert('DSL editor — implemented in next task.');
}
```

- [ ] **Step 4: Add CSS for the features section**

In the `<style>` block, add:

```css
.pc-features-list { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.feature-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 3px; }
.feature-row-name { font-family: Cinzel, serif; font-size: 0.85rem; flex: 0 0 auto; }
.feature-row-summary { font-size: 0.78rem; color: var(--c-ink-faint); flex: 1; }
.feature-row-remove { background: none; border: none; color: var(--c-error); font-size: 1.2rem; cursor: pointer; padding: 0 6px; }
.feature-tag { font-size: 0.6rem; padding: 1px 6px; border: 1px solid currentColor; border-radius: 4px; margin-left: 4px; }
.feature-tag.builtin { color: var(--c-brass); }
.feature-tag.homebrew { color: var(--c-teal-bright); }
.pc-features-actions { display: flex; gap: 8px; margin-top: 8px; }
```

- [ ] **Step 5: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: Features section in PC editor + library picker + remove handler"
```

---

### Task 5.3: DSL custom-feature editor modal

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Add the DSL modal HTML**

In the `<body>` of `crucible-dm.html`, before the closing `</body>`, add a modal container:

```html
<div id="dsl-modal" class="dsl-modal" style="display:none">
  <div class="dsl-modal-card">
    <h3>Custom Feature</h3>
    <div class="dsl-form">
      <label>Name <input type="text" id="dsl-name"></label>
      <label>Summary <input type="text" id="dsl-summary"></label>
      <label>Category
        <select id="dsl-category" multiple size="5">
          <option value="damage">damage</option>
          <option value="defense">defense</option>
          <option value="action-economy">action-economy</option>
          <option value="healing">healing</option>
          <option value="support">support</option>
        </select>
      </label>
      <label>Uses per encounter <input type="number" id="dsl-uses" min="1" value="1"></label>
      <fieldset>
        <legend>Mode policy — Sustained</legend>
        <label>Trigger round <input type="number" id="dsl-trigger-round" min="1" value="1"></label>
        <label>Condition
          <select id="dsl-condition">
            <option value="always">always</option>
            <option value="whenAnyEnemyAlive">when any enemy alive</option>
            <option value="whenHpBelowHalf">when HP below half</option>
            <option value="whenHpBelowQuarter">when HP below quarter</option>
            <option value="whenAllyDowned">when ally downed</option>
            <option value="whenAllyHpBelowHalf">when ally HP below half</option>
            <option value="usesLeftGreaterThanZero">when uses left</option>
          </select>
        </label>
      </fieldset>
      <fieldset>
        <legend>Effects (executed in order)</legend>
        <div id="dsl-effects-list"></div>
        <button onclick="dslAddEffect()">+ Add effect</button>
      </fieldset>
    </div>
    <div class="dsl-modal-actions">
      <button onclick="dslSave()">Save feature</button>
      <button onclick="dslSaveAsTemplate()">Save as template</button>
      <button onclick="dslClose()">Cancel</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add CSS for the modal**

In the `<style>` block:

```css
.dsl-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.dsl-modal-card { background: var(--c-bg); border: 1px solid var(--c-brass); border-radius: 4px; padding: 1.5rem; min-width: 480px; max-width: 720px; max-height: 80vh; overflow-y: auto; }
.dsl-modal-card h3 { font-family: Cinzel, serif; margin: 0 0 1rem; color: var(--c-brass); }
.dsl-form label { display: block; margin-bottom: 8px; font-size: 0.85rem; }
.dsl-form input, .dsl-form select { width: 100%; background: var(--c-surface); color: var(--c-ink); border: 1px solid var(--c-border); border-radius: 2px; padding: 6px 8px; }
.dsl-form fieldset { border: 1px solid var(--c-border); padding: 8px 12px; margin: 12px 0; }
.dsl-form legend { color: var(--c-brass); font-family: Cinzel, serif; font-size: 0.75rem; padding: 0 6px; }
.dsl-effect-row { display: flex; gap: 6px; margin: 4px 0; align-items: center; }
.dsl-effect-row select, .dsl-effect-row input { flex: 1; }
.dsl-effect-row button { flex: 0; }
.dsl-modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 1rem; }
```

- [ ] **Step 3: Add the JS for the modal**

After `openDSLEditor`, replace its stub with the real implementation and add the helpers:

```javascript
let dslEditingPmId = null;
let dslEffects = [];

function openDSLEditor(pmId) {
  dslEditingPmId = pmId;
  dslEffects = [];
  document.getElementById('dsl-name').value = '';
  document.getElementById('dsl-summary').value = '';
  document.getElementById('dsl-uses').value = 1;
  document.getElementById('dsl-trigger-round').value = 1;
  document.getElementById('dsl-condition').value = 'always';
  dslRenderEffects();
  document.getElementById('dsl-modal').style.display = 'flex';
}

function dslClose() {
  document.getElementById('dsl-modal').style.display = 'none';
  dslEditingPmId = null;
  dslEffects = [];
}

function dslAddEffect() {
  dslEffects.push({ hook: 'onTurnStart', primitive: 'consumeBonusAction', params: {} });
  dslRenderEffects();
}

function dslRemoveEffect(i) {
  dslEffects.splice(i, 1);
  dslRenderEffects();
}

function dslRenderEffects() {
  const root = document.getElementById('dsl-effects-list');
  root.innerHTML = dslEffects.map((eff, i) => `
    <div class="dsl-effect-row">
      <select onchange="dslEffects[${i}].hook = this.value">
        ${PCFeatures.HOOK_NAMES.map(h => `<option value="${h}" ${eff.hook === h ? 'selected' : ''}>${h}</option>`).join('')}
      </select>
      <select onchange="dslEffects[${i}].primitive = this.value">
        ${Object.keys(PCFeatures.PRIMITIVES).map(p => `<option value="${p}" ${eff.primitive === p ? 'selected' : ''}>${p}</option>`).join('')}
      </select>
      <button onclick="dslRemoveEffect(${i})">×</button>
    </div>
  `).join('');
}

function dslSave() {
  if (!dslEditingPmId) return;
  const pm = party.find(p => p.id === dslEditingPmId);
  if (!pm) return;
  const spec = dslBuildSpec();
  if (!spec) return;
  const compiled = PCFeatures.compileDSL(spec);
  if (!compiled) { alert('DSL compilation failed.'); return; }
  if (!Array.isArray(pm.features)) pm.features = [];
  pm.features.push({ id: spec.id, source: 'homebrew', params: spec.params, _dslSpec: spec });
  saveParty();
  renderParty();
  dslClose();
}

function dslSaveAsTemplate() {
  const spec = dslBuildSpec();
  if (!spec) return;
  const templates = JSON.parse(localStorage.getItem('crucible-feature-templates') || '[]');
  templates.push(spec);
  localStorage.setItem('crucible-feature-templates', JSON.stringify(templates));
  alert('Template saved.');
}

function dslBuildSpec() {
  const name = document.getElementById('dsl-name').value.trim();
  if (!name) { alert('Name is required.'); return null; }
  const summary = document.getElementById('dsl-summary').value.trim();
  const categoryEl = document.getElementById('dsl-category');
  const category = Array.from(categoryEl.selectedOptions).map(o => o.value);
  const uses = parseInt(document.getElementById('dsl-uses').value, 10) || 1;
  const triggerRound = parseInt(document.getElementById('dsl-trigger-round').value, 10) || 1;
  const condition = document.getElementById('dsl-condition').value;
  const id = 'dsl_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return {
    id, name, source: 'homebrew',
    category, summary,
    params: { usesPerEncounter: { type: 'int', value: uses } },
    modePolicy: {
      nova:      { triggerRound, conditionFn: condition },
      sustained: { triggerRound, conditionFn: condition },
      defensive: { triggerRound, conditionFn: condition },
    },
    effects: dslEffects.slice(),
  };
}
```

**Note:** Homebrew features need a `resolve()` that finds them. Update `PCFeatures.resolve()` (already implemented in Task 1.4) to also check `ref._dslSpec` and recompile when needed:

In `pc-features.js`, modify the existing `resolve` function:

```javascript
  function resolve(ref) {
    if (!ref) return null;
    if (ref.source === 'homebrew' && ref._dslSpec) return compileDSL(ref._dslSpec);
    if (ref.source === 'homebrew') return ref;
    return (PCFeatures.LIBRARY && PCFeatures.LIBRARY[ref.id]) || null;
  }
```

- [ ] **Step 4: Commit**

```bash
git add crucible-dm.html pc-features.js
git commit -m "Crucible: DSL editor modal + template persistence + resolve homebrew via _dslSpec"
```

---

### Task 5.4: Mode picker in the tactics row

**Files:**
- Modify: `crucible-dm.html` (PC card renderer, where the tactics row is built)

- [ ] **Step 1: Find the tactics row**

```bash
grep -n "tactics.aiHint\|tactics.resources\|positionOverride\|position\\[" crucible-dm.html | head
```

- [ ] **Step 2: Replace the resources-related markup with a mode picker**

Find the tactics row markup and add:

```javascript
  <span class="tactics-label">Mode</span>
  <select onchange="updatePCMode('${pm.id}', this.value)">
    <option value="nova"      ${pm.tactics.mode === 'nova' ? 'selected' : ''}>Nova</option>
    <option value="sustained" ${pm.tactics.mode === 'sustained' ? 'selected' : ''}>Sustained</option>
    <option value="defensive" ${pm.tactics.mode === 'defensive' ? 'selected' : ''}>Defensive</option>
  </select>
```

Add the handler:

```javascript
function updatePCMode(pmId, mode) {
  const pm = party.find(p => p.id === pmId);
  if (!pm) return;
  if (!pm.tactics) pm.tactics = {};
  pm.tactics.mode = mode;
  saveParty();
  // No re-render needed; the select already shows the user's choice.
}
```

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: PC mode picker in tactics row"
```

---

## Phase 6 — Results panel additions

### Task 6.1: Feature Impact table data collection

**Files:**
- Modify: `crucible-engine.js`

- [ ] **Step 1: Find where trial results are aggregated**

```bash
grep -n "function runSim\|trialResults\|aggregat\|wins +=" crucible-engine.js | head
```

- [ ] **Step 2: Add featureStats accumulator**

In `runSim` (or the equivalent multi-trial loop), declare an accumulator:

```javascript
  const featureStats = {};  // { featureId: { activations: 0, damageDealt: 0, damagePrevented: 0, hpRestored: 0 } }
```

After each trial, iterate `eventLog` and accumulate feature events:

```javascript
    for (const ev of eventLog) {
      if (ev.type !== 'feature') continue;
      const m = /^([A-Z][a-zA-Z ]+)/.exec(ev.what || '');
      const featureLabel = m ? m[1].trim() : ev.what;
      if (!featureStats[featureLabel]) {
        featureStats[featureLabel] = { activations: 0, damageDealt: 0, damagePrevented: 0, hpRestored: 0 };
      }
      featureStats[featureLabel].activations += 1;
      // Parse impact from event text if present.
      const dmgMatch = /\+(\d+) dmg/.exec(ev.what || '');
      const healMatch = /\+(\d+) HP/.exec(ev.what || '');
      if (dmgMatch) featureStats[featureLabel].damageDealt += parseInt(dmgMatch[1], 10);
      if (healMatch) featureStats[featureLabel].hpRestored += parseInt(healMatch[1], 10);
    }
```

Return `featureStats` from `runSim` alongside the existing results.

- [ ] **Step 3: Commit**

```bash
git add crucible-engine.js
git commit -m "Crucible engine: aggregate feature usage stats across trials"
```

---

### Task 6.2: Render Feature Impact in results panel

**Files:**
- Modify: `crucible-dm.html` (results rendering)

- [ ] **Step 1: Find the results renderer**

```bash
grep -n "function renderResults\|results-area\|action-effectiveness" crucible-dm.html | head
```

- [ ] **Step 2: Add a Feature Impact section after Action Effectiveness**

In `renderResults`, after the action-effectiveness table, add:

```javascript
  const featureImpactHtml = !results.featureStats || Object.keys(results.featureStats).length === 0
    ? ''
    : `
    <div class="results-section">
      <h3>FEATURE IMPACT</h3>
      <table class="impact-table">
        <thead>
          <tr><th>Feature</th><th>Activations / fight</th><th>Avg impact</th></tr>
        </thead>
        <tbody>
          ${Object.entries(results.featureStats).map(([name, stat]) => {
            const perFight = (stat.activations / results.trials).toFixed(1);
            const impact = stat.damageDealt > 0
              ? `+${(stat.damageDealt / results.trials).toFixed(1)} dmg dealt`
              : stat.damagePrevented > 0
                ? `${(stat.damagePrevented / results.trials).toFixed(1)} dmg prevented`
                : stat.hpRestored > 0
                  ? `+${(stat.hpRestored / results.trials).toFixed(1)} HP restored`
                  : '—';
            return `<tr><td>${name}</td><td>${perFight}</td><td>${impact}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
```

Append `featureImpactHtml` to the results-area output.

Add CSS:

```css
.impact-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.impact-table th, .impact-table td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--c-border); }
.impact-table th { font-family: Cinzel, serif; color: var(--c-brass); font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; }
```

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: Feature Impact table in results panel"
```

---

### Task 6.3: Feature glyph in trial logs

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Find the trial log renderer**

```bash
grep -n "trialLog\|trial-log\|eventLog.*render" crucible-dm.html | head
```

- [ ] **Step 2: Prefix feature events with `⚡`**

In the trial log line renderer, check `ev.type === 'feature'`:

```javascript
const linePrefix = ev.type === 'feature' ? '⚡ ' : '';
const lineClass = ev.type === 'feature' ? 'log-feature' : '';
return `<div class="log-line ${lineClass}">R${ev.round} ${linePrefix}${escapeHtml(ev.what || '')}</div>`;
```

Add CSS:

```css
.log-feature { color: var(--c-brass-bright); font-weight: 500; }
```

Also add a filter toggle at the top of the log:

```html
<label><input type="checkbox" id="show-feature-events" checked onchange="toggleFeatureLogs(this.checked)"> Show feature events</label>
```

Handler:

```javascript
function toggleFeatureLogs(visible) {
  const lines = document.querySelectorAll('.log-feature');
  lines.forEach(l => l.style.display = visible ? '' : 'none');
}
```

- [ ] **Step 3: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: feature glyph + filter toggle in trial logs"
```

---

## Phase 7 — CHANGELOG + integration test

### Task 7.1: Integration smoke test in `tests/pc-features.test.html`

**Files:**
- Modify: `tests/pc-features.test.html`

- [ ] **Step 1: Add integration tests**

Append before `</script>`:

```javascript
    group('Integration: features + engine interactions');

    test('Two features stack on the same attack (Rage + Hex)', () => {
      // Mock combatant with both Rage and Hex active.
      const self = {
        id: 'pc:barb',
        pm: {
          features: [{id:'rage'}, {id:'hexMark'}],
          tactics: { mode: 'nova' },
          identity: { level: 5 },
          abilities: { str: 16 },
        },
        featureState: {
          rage: { active: true, roundsLeft: 10 },
          hexMark: { targetId: 'm:1' },
        },
      };
      const action = { kind: 'attack', actionRange: 'melee' };
      const target = { id: 'm:1' };
      const dmgCtx = { amount: 10, type: 'slashing', bonusDice: [] };
      PCFeatures.dispatchHook(self, 'onAttackHit', action, target, dmgCtx);
      // Rage: +2 to amount. Hex: +1d6 to bonusDice.
      assertEq(dmgCtx.amount, 12);
      assertEq(dmgCtx.bonusDice.length, 1);
      assertEq(dmgCtx.bonusDice[0].dice, '1d6');
    });

    test('Sneak Attack + Hex stack on the same hit', () => {
      const self = {
        id: 'pc:rogue',
        pm: {
          features: [{id:'sneakAttack'}, {id:'hexMark'}],
          tactics: { mode: 'sustained' },
          identity: { level: 5 },
        },
        featureState: {
          sneakAttack: { usedThisTurn: false },
          hexMark: { targetId: 'm:1' },
        },
      };
      const action = { kind: 'attack', actionRange: 'melee', finesse: true };
      const target = { id: 'm:1' };
      const dmgCtx = { amount: 6, type: 'piercing', bonusDice: [] };
      PCFeatures.dispatchHook(self, 'onAttackHit', action, target, dmgCtx);
      // Sneak: +3d6. Hex: +1d6. Total 2 bonus dice entries.
      assertEq(dmgCtx.bonusDice.length, 2);
    });

    test('Rage halves a slashing hit on a raging Barbarian', () => {
      const self = {
        id: 'pc:barb',
        pm: { features: [{id:'rage'}], tactics: { mode: 'nova' } },
        featureState: { rage: { active: true, roundsLeft: 10 } },
      };
      const dmgCtx = { amount: 14, type: 'slashing' };
      PCFeatures.dispatchHook(self, 'onTakeDamage', dmgCtx);
      assertEq(dmgCtx.amount, 7);
    });

    test('DSL feature integrates with dispatchHook (custom +3 fire damage rider)', () => {
      const spec = {
        id: 'flamingWeapon',
        name: 'Flaming Weapon',
        source: 'homebrew',
        modePolicy: { sustained: { triggerRound: 1, conditionFn: 'always' } },
        effects: [
          { hook: 'onAttackHit', primitive: 'addDamage', params: { value: 3 } },
        ],
      };
      const compiled = PCFeatures.compileDSL(spec);
      // Stub resolve for this test.
      const origResolve = PCFeatures.resolve;
      PCFeatures.resolve = (ref) => ref.id === 'flamingWeapon' ? compiled : origResolve(ref);
      try {
        const self = {
          id: 'pc:test',
          pm: { features: [{id:'flamingWeapon'}], tactics: {mode:'sustained'} },
          featureState: { flamingWeapon: {} },
        };
        const dmgCtx = { amount: 8, type: 'slashing', bonusDice: [] };
        // Use round 1 in the ctx so trigger fires.
        const ctx = { round: 1, combatants: [] };
        PCFeatures.dispatchHook(self, 'onAttackHit', {kind:'attack'}, {id:'m:1'}, dmgCtx, ctx);
        assertEq(dmgCtx.amount, 11);
      } finally {
        PCFeatures.resolve = origResolve;
      }
    });
```

- [ ] **Step 2: Run tests — should add 4 new cases, all passing**

- [ ] **Step 3: Commit**

```bash
git add tests/pc-features.test.html
git commit -m "PC features: integration tests (Rage+Hex stack, Sneak+Hex stack, Rage resistance, DSL+dispatch)"
```

---

### Task 7.2: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Read existing changelog format**

```bash
head -100 CHANGELOG.md
```

- [ ] **Step 2: Insert a new section under [Unreleased]**

At the top of the file (under the existing `[Unreleased]` heading, or create one if needed), add:

```markdown
### Crucible — PC class features simulation

The Crucible can now model 8 SRD class features (Rage, Sneak Attack, Action
Surge, Divine Smite, Healing Word, Shield, Hex/Hunter's Mark, Bardic
Inspiration) plus DM-authored homebrew features via a small DSL.

- **New file `pc-features.js`** — shared module owning the 9-hook surface,
  mode predicates, 8 built-in feature objects, 10 DSL primitives, and the
  `dispatchHook` runner.
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

**Known limitation:** Rage's Nova and Sustained modes behave identically in
v1 because the sim doesn't track resources across an adventuring day.
Documented in the spec under Non-goals.

**Manual UI checklist (post-deploy):**

- [ ] Open Crucible → existing PCs load with `tactics.mode: 'sustained'`
- [ ] Add Rage to a Barbarian via Add from library → params auto-derived
- [ ] Run 500 trials → Rage shows in Feature Impact with non-zero numbers
- [ ] Author a custom DSL feature → saves to PC + template → reusable
- [ ] Trial logs show `⚡` glyph next to feature events; filter toggle hides them
- [ ] Open the schema test page (`tests/pc-features.test.html`) → 70+ assertions pass
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "CHANGELOG: PC class features simulation in the Crucible"
```

---

## Self-Review

### Spec coverage

- **Hook surface** → Tasks 1.1 (registry), 1.4 (dispatch), 1.5 (state init)
- **Mode predicates** → Task 1.3
- **8 built-in features** → Tasks 2.1 (Rage), 2.2 (Sneak Attack), 2.3 (Action Surge), 2.4 (Divine Smite), 2.5 (Healing Word), 2.6 (Shield), 2.7 (Hex/Mark), 2.8 (Bardic Inspiration)
- **DSL primitives** → Task 3.1
- **DSL compiler** → Task 3.2
- **Broadcast hook for cross-PC features** → Task 2.8
- **Engine integration (9 hook points)** → Tasks 4.1–4.7
- **Migration** → Task 5.1
- **PC editor Features section** → Task 5.2
- **DSL editor modal** → Task 5.3
- **Mode picker** → Task 5.4
- **Results panel Feature Impact** → Tasks 6.1, 6.2
- **Trial log glyph + filter** → Task 6.3
- **Tests (per-feature + dispatcher + DSL + integration)** → Tasks 1.2–3.2, 7.1
- **CHANGELOG** → Task 7.2

### Placeholder scan

No "TBD" / "TODO" / "fill in later" in the plan. Several tasks reference
existing functions in `crucible-engine.js` that the engineer needs to locate
via `grep` — that's appropriate (the spec acknowledges those code paths;
the plan provides explicit grep commands and insertion patterns).

### Type / name consistency

- `pm.features[].id` is used consistently across tasks (Phase 1 dispatcher,
  Phase 2 features, Phase 4 engine wiring, Phase 5 UI).
- `featureState[featureId]` is the documented per-instance state location;
  every feature reads/writes through that path.
- `dispatchHook` and `dispatchBroadcastHook` signatures match across Phase 1
  (definition), Phase 2 (Bardic Inspiration's onSaveAttempt usage), and
  Phase 4 (engine call sites).
- Mode predicate names (`always`, `whenAnyEnemyAlive`, `whenHpBelowHalf`,
  etc.) are consistent in the registry (Task 1.3) and every feature that
  references them (Tasks 2.1–2.8).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-19-pc-class-features-sim.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

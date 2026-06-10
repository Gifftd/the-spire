# Monster Role Policies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace The Crucible's single "focus-fire lowest-HP" monster heuristic with a role-policy registry. Each monster resolves to one of 9 FM roles (Soldier / Brute / Artillery / Ambusher / Controller / Leader / Skirmisher / Solo / Minion), and each role provides its own target-picking and action-picking rules. PCs gain implicit positioning via an `actionRange` field on each action, bucketed into frontline / midline / backline.

**Architecture:** Additive change to `crucible-engine.js` — a `ROLE_POLICIES` registry of pure-function pairs, plus helpers (`actionEv`, `rangedness`, `position`, `inferRole`, `resolveRole`). The Soldier policy preserves v1 behavior so existing scenarios still pass. UI additions in `crucible-dm.html`: per-action range dropdown, position pill on PC cards, role badge + override dropdown for monsters.

**Tech Stack:** Plain HTML/CSS/JS (no build step, no framework). All new logic is in pure functions, testable via the existing `tests/engine.test.html` harness.

**Spec:** `docs/superpowers/specs/2026-06-09-monster-role-policies-design.md`

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `crucible-engine.js` | MODIFY | Add helpers (actionEv, rangedness, position, inferRole, resolveRole), the 9 role policies, the ROLE_POLICIES registry, and modify the `runTrial` monster branch to use it. |
| `crucible-dm.html` | MODIFY | Add `actionRange` field to default PC action + action-editor dropdown, position pill on PC card with cycling override, role badge on encounter card, role dropdown in override panel, persist `roleOverride` via existing save. |
| `tests/engine.test.html` | MODIFY | Add unit tests for new helpers, per-role tests for `pickTarget` + `pickAction`, and 4 integration scenarios (Brute prefers frontline, Artillery prefers backline, role override flips, v1 backward-compat). |
| `CHANGELOG.md` | MODIFY | One entry summarizing the role-policy upgrade + a manual UI checklist. |

**No new files. No worker changes. No KV schema changes.** New PC fields (`actionRange`, `positionOverride`) live in the existing `localStorage['crucible-party']` payload. New monster field (`roleOverride`) lives in existing `bestiary_custom` records — backward-compatible if absent.

---

## Phase 1 — Engine foundations (helpers)

Build the pure-function building blocks first. All testable in isolation via `tests/engine.test.html`.

### Task 1: Foundation helpers (clamp, sumDice, actionIsMelee, actionIsRanged, targetSaveBonus)

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-rolepolicy-task1"
cp crucible-engine.js tests/engine.test.html "backups/${TS}-rolepolicy-task1/"
```

- [ ] **Step 2: Append failing tests inside the last `<script>` block of `tests/engine.test.html`** (before its closing `</script>`):

```js
test('clamp01: clamps to [0.05, 0.95]', () => {
  assertEq(Crucible.clamp01(-1),  0.05);
  assertEq(Crucible.clamp01(0),   0.05);
  assertEq(Crucible.clamp01(0.5), 0.5);
  assertEq(Crucible.clamp01(1.5), 0.95);
});
test('sumDice: 1d8+3 → 7.5', () => {
  const r = Crucible.sumDice([{ dice:'1d8', mod:3, type:'slashing' }]);
  assertEq(r, 7.5);
});
test('sumDice: multiple components add', () => {
  // 1d8+3 (mean 7.5) + 2d6+0 (mean 7) = 14.5
  const r = Crucible.sumDice([
    { dice:'1d8', mod:3, type:'slashing' },
    { dice:'2d6', mod:0, type:'fire' },
  ]);
  assertEq(r, 14.5);
});
test('sumDice: empty / malformed → 0', () => {
  assertEq(Crucible.sumDice([]), 0);
  assertEq(Crucible.sumDice(null), 0);
  assertEq(Crucible.sumDice([{ dice:'garbage', mod:0, type:'x' }]), 0);
});
test('actionIsMelee: monster reach attack → true', () => {
  assertEq(Crucible.actionIsMelee({ reach:5, range:null }), true);
});
test('actionIsMelee: monster ranged attack → false', () => {
  assertEq(Crucible.actionIsMelee({ reach:null, range:[80,320] }), false);
});
test('actionIsMelee: PC action with actionRange=melee → true', () => {
  assertEq(Crucible.actionIsMelee({ actionRange:'melee' }), true);
});
test('actionIsRanged: monster range attack → true', () => {
  assertEq(Crucible.actionIsRanged({ range:[80,320] }), true);
});
test('actionIsRanged: PC action with actionRange=ranged → true', () => {
  assertEq(Crucible.actionIsRanged({ actionRange:'ranged' }), true);
});
test('targetSaveBonus: PC uses saveBonus()', () => {
  const t = { side:'pc', pm:{
    identity:{ level:5 },
    abilities:{ str:10, dex:14, con:10, int:10, wis:10, cha:10 },
    profs:{ saves:{ dex:true } }
  }};
  assertEq(Crucible.targetSaveBonus(t, 'dex'), 2 + 3);  // +2 DEX + PB 3
});
test('targetSaveBonus: monster uses statblock save or mod', () => {
  const t = { side:'monster', monster:{
    abilities:{ con:{ score:14, mod:2, save:5 } }
  }};
  assertEq(Crucible.targetSaveBonus(t, 'con'), 5);
  const t2 = { side:'monster', monster:{
    abilities:{ con:{ score:14, mod:2 } }
  }};
  assertEq(Crucible.targetSaveBonus(t2, 'con'), 2);
});
```

- [ ] **Step 3: Run tests — verify the 11 new ones fail**

Open `tests/engine.test.html` in a browser, click Run. Expected: existing tests pass; 11 new fail with `Crucible.clamp01 is not a function` etc.

- [ ] **Step 4: Add the helpers inside the IIFE of `crucible-engine.js`, after the existing `pcDamageMod` function**

```js
  // ─────────── Role-policy helpers ───────────
  function clamp01(x) {
    if (!Number.isFinite(x)) return 0.05;
    return Math.max(0.05, Math.min(0.95, x));
  }

  function sumDice(dmgList) {
    let total = 0;
    for (const d of (dmgList || [])) {
      const m = String(d && d.dice || '').match(/^(\d+)d(\d+)$/i);
      if (!m) continue;
      const n = parseInt(m[1], 10), s = parseInt(m[2], 10);
      total += n * (s + 1) / 2 + (Number(d.mod) || 0);
    }
    return total;
  }

  function actionIsMelee(action) {
    if (!action) return false;
    // PC actions carry an explicit tag.
    if (action.actionRange === 'melee') return true;
    if (action.actionRange === 'ranged') return false;
    if (action.actionRange === 'both')  return true;       // count as melee for picker purposes
    // Monster ParsedAction: has reach but no range.
    if (action.reach != null && !action.range) return true;
    return false;
  }

  function actionIsRanged(action) {
    if (!action) return false;
    if (action.actionRange === 'ranged') return true;
    if (action.actionRange === 'both')   return true;
    if (action.range) return true;
    return false;
  }

  function targetSaveBonus(target, ability) {
    if (!target || !ability) return 0;
    if (target.side === 'pc' && target.pm) return saveBonus(target.pm, ability);
    const ab = target.monster && target.monster.abilities && target.monster.abilities[ability];
    if (!ab) return 0;
    return ab.save != null ? ab.save : (ab.mod || 0);
  }
```

- [ ] **Step 5: Extend exports** — find the `const Crucible = { … }` block and add the five new helpers. Replace the block with:

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
    // Role-policy helpers (Task 1)
    clamp01, sumDice, actionIsMelee, actionIsRanged, targetSaveBonus,
  };
```

- [ ] **Step 6: Run tests — verify all pass**

Reload the test page, click Run. Expected: all 11 new tests pass.

- [ ] **Step 7: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible engine: foundation helpers for role policies (clamp/sumDice/range/save)"
```

---

### Task 2: actionEv — expected-damage scorer

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-rolepolicy-task2"
cp crucible-engine.js tests/engine.test.html "backups/${TS}-rolepolicy-task2/"
```

- [ ] **Step 2: Append failing tests inside the last `<script>` block of `tests/engine.test.html`:**

```js
test('actionEv: attack EV decreases as target AC rises', () => {
  const action = { kind:'attack', toHit:5, damage:[{ dice:'1d8', mod:3, type:'slashing' }] };
  const ctx = { livingEnemyCount: 1 };
  const ev10 = Crucible.actionEv(action, { ac:10, side:'monster' }, ctx);
  const ev18 = Crucible.actionEv(action, { ac:18, side:'monster' }, ctx);
  const ev25 = Crucible.actionEv(action, { ac:25, side:'monster' }, ctx);
  assertTrue(ev10 > ev18, `ev10=${ev10} > ev18=${ev18}`);
  assertTrue(ev18 > ev25, `ev18=${ev18} > ev25=${ev25}`);
});
test('actionEv: save EV is positive when halfOnSave is true', () => {
  const action = {
    kind:'save', saveAbility:'dex', saveDc:15, aoeTargets:1, halfOnSave:true,
    damageOnFail:[{ dice:'8d6', mod:0, type:'fire' }]
  };
  const t = { side:'pc', pm:{
    identity:{ level:5 },
    abilities:{ str:10, dex:10, con:10, int:10, wis:10, cha:10 },
    profs:{ saves:{} }
  }};
  const ev = Crucible.actionEv(action, t, { livingEnemyCount: 1 });
  // 8d6 mean = 28; even at full save, half = 14, so EV must be positive and >0.
  assertTrue(ev > 5, `expected EV > 5, got ${ev}`);
});
test('actionEv: save EV scales with aoeTargets', () => {
  const action = {
    kind:'save', saveAbility:'dex', saveDc:15, aoeTargets:4, halfOnSave:true,
    damageOnFail:[{ dice:'8d6', mod:0, type:'fire' }]
  };
  const t = { side:'pc', pm:{
    identity:{ level:5 },
    abilities:{ str:10, dex:10, con:10, int:10, wis:10, cha:10 },
    profs:{ saves:{} }
  }};
  const evOne  = Crucible.actionEv(action, t, { livingEnemyCount: 1 });
  const evFour = Crucible.actionEv(action, t, { livingEnemyCount: 4 });
  assertTrue(evFour > evOne * 3.5, `expected 4× targets ~4×EV, got ${evFour} vs ${evOne}`);
});
test('actionEv: multiattack sums sub-EVs', () => {
  const subBite = { sourceActionName:'Bite', kind:'attack', toHit:5,
                    damage:[{ dice:'1d8', mod:3, type:'piercing' }] };
  const subClaw = { sourceActionName:'Claw', kind:'attack', toHit:5,
                    damage:[{ dice:'1d6', mod:3, type:'slashing' }] };
  const multi = {
    sourceActionName:'Multiattack', kind:'multiattack',
    multiattackPlan:[{ actionName:'Bite', count:1 }, { actionName:'Claw', count:2 }],
    _ownerActions: [subBite, subClaw],
  };
  const t = { ac:13, side:'monster' };
  const ctx = { livingEnemyCount: 1 };
  const ev = Crucible.actionEv(multi, t, ctx);
  const expected = Crucible.actionEv(subBite, t, ctx) + 2 * Crucible.actionEv(subClaw, t, ctx);
  // Floating point: allow tiny tolerance.
  assertTrue(Math.abs(ev - expected) < 0.001, `ev=${ev} expected≈${expected}`);
});
test('actionEv: unknown kind → 0', () => {
  assertEq(Crucible.actionEv({ kind:'utility' }, { ac:10 }, { livingEnemyCount:1 }), 0);
  assertEq(Crucible.actionEv({ kind:'unparsed' }, { ac:10 }, { livingEnemyCount:1 }), 0);
});
```

- [ ] **Step 3: Run tests — verify the 5 new ones fail**

Reload, click Run. Expected: 5 fail with `Crucible.actionEv is not a function`.

- [ ] **Step 4: Add `actionEv` inside the IIFE of `crucible-engine.js`, after the `targetSaveBonus` helper from Task 1:**

```js
  // Expected damage of an action against a specific target.
  // For multiattack, sub-actions are resolved via the multiAction's
  // `_ownerActions` reference (set by the caller before scoring).
  function actionEv(action, target, ctx) {
    if (!action || !target) return 0;
    if (action.kind === 'attack') {
      const p = clamp01((21 + (action.toHit || 0) - (target.ac || 10)) / 20);
      const dmg = sumDice(action.damage);
      return p * dmg * 1.05;     // +5% nominal crit tail
    }
    if (action.kind === 'save') {
      const sb = targetSaveBonus(target, action.saveAbility);
      const failP = clamp01((action.saveDc - sb - 1) / 20);
      const dmgFail = sumDice(action.damageOnFail);
      const dmgSave = action.halfOnSave ? dmgFail / 2 : 0;
      const live = (ctx && ctx.livingEnemyCount) || 1;
      const targets = Math.min(action.aoeTargets || 1, live);
      return targets * (failP * dmgFail + (1 - failP) * dmgSave);
    }
    if (action.kind === 'multiattack') {
      const subs = action._ownerActions || [];
      let sum = 0;
      for (const step of (action.multiattackPlan || [])) {
        const sub = subs.find(a => (a.sourceActionName || a.name) === step.actionName);
        if (sub) sum += (step.count || 1) * actionEv(sub, target, ctx);
      }
      return sum;
    }
    return 0;
  }
```

- [ ] **Step 5: Add `actionEv` to the exports.** Replace the helper line in the exports object:

```js
    clamp01, sumDice, actionIsMelee, actionIsRanged, targetSaveBonus, actionEv,
```

- [ ] **Step 6: Run tests — verify all 5 new ones pass**

- [ ] **Step 7: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible engine: actionEv — expected-damage scorer for attack/save/multi"
```

---

### Task 3: Picker helpers (bestEvAction, tagActions, lowestPick, targetsInBucket)

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-rolepolicy-task3"
cp crucible-engine.js tests/engine.test.html "backups/${TS}-rolepolicy-task3/"
```

- [ ] **Step 2: Append failing tests inside the last `<script>` block of `tests/engine.test.html`:**

```js
test('lowestPick: returns lowest by key', () => {
  const arr = [{ n:'a', hp:10 }, { n:'b', hp:5 }, { n:'c', hp:15 }];
  const r = Crucible.lowestPick(arr, x => x.hp, null, () => 0);
  assertEq(r.n, 'b');
});
test('lowestPick: ties broken by tiebreak key', () => {
  const arr = [{ n:'a', hp:5, ac:18 }, { n:'b', hp:5, ac:12 }, { n:'c', hp:15, ac:10 }];
  const r = Crucible.lowestPick(arr, x => x.hp, x => x.ac, () => 0);
  assertEq(r.n, 'b');
});
test('tagActions: sets _isMelee/_isRanged on each action', () => {
  const acts = [
    { reach:5, range:null },
    { reach:null, range:[80,320] },
    { actionRange:'both' },
  ];
  Crucible.tagActions(acts);
  assertEq(acts[0]._isMelee, true);
  assertEq(acts[0]._isRanged, false);
  assertEq(acts[1]._isMelee, false);
  assertEq(acts[1]._isRanged, true);
  assertEq(acts[2]._isMelee, true);
  assertEq(acts[2]._isRanged, true);
});
test('bestEvAction: returns highest-EV action passing filter', () => {
  const tgt = { ac:13, side:'monster' };
  const ctx = { livingEnemyCount: 1 };
  const a1 = { kind:'attack', toHit:5, damage:[{ dice:'1d6', mod:0, type:'fire' }] };   // low EV
  const a2 = { kind:'attack', toHit:5, damage:[{ dice:'2d8', mod:4, type:'slashing' }] }; // high EV
  const a3 = { kind:'attack', toHit:0, damage:[{ dice:'1d4', mod:0, type:'piercing' }] }; // lowest
  const r = Crucible.bestEvAction([a1, a2, a3], tgt, ctx, a => a.kind === 'attack');
  assertEq(r, a2);
});
test('bestEvAction: returns null when filter excludes everything', () => {
  const r = Crucible.bestEvAction([{ kind:'utility' }], { ac:13 }, { livingEnemyCount:1 },
                                  a => a.kind === 'attack');
  assertEq(r, null);
});
test('targetsInBucket: returns enemies in preferred bucket', () => {
  // Set up combatants with PC pm carrying actionRange data so position(pm) works.
  const front = { side:'pc', pm:{ actions:[{ actionRange:'melee' }, { actionRange:'melee' }] },
                  downed:false, dead:false, hp:30 };
  const mid   = { side:'pc', pm:{ actions:[{ actionRange:'melee' }, { actionRange:'ranged' }] },
                  downed:false, dead:false, hp:20 };
  const back  = { side:'pc', pm:{ actions:[{ actionRange:'ranged' }, { actionRange:'ranged' }] },
                  downed:false, dead:false, hp:10 };
  const me = { side:'monster' };
  const all = [me, front, mid, back];
  const frontPick = Crucible.targetsInBucket(all, me, 'frontline', ['midline', 'backline']);
  assertEq(frontPick.length, 1);
  assertEq(frontPick[0], front);
  const backPick = Crucible.targetsInBucket(all, me, 'backline', ['midline', 'frontline']);
  assertEq(backPick.length, 1);
  assertEq(backPick[0], back);
});
test('targetsInBucket: falls back when bucket is empty', () => {
  const back = { side:'pc', pm:{ actions:[{ actionRange:'ranged' }, { actionRange:'ranged' }] },
                 downed:false, dead:false, hp:10 };
  const me = { side:'monster' };
  const all = [me, back];
  const r = Crucible.targetsInBucket(all, me, 'frontline', ['midline', 'backline']);
  // No frontline or midline; falls back to backline.
  assertEq(r.length, 1);
  assertEq(r[0], back);
});
```

- [ ] **Step 3: Run tests — verify the 7 new ones fail**

- [ ] **Step 4: Add the helpers inside the IIFE of `crucible-engine.js`, after `actionEv`:**

```js
  function tagActions(actions) {
    for (const a of (actions || [])) {
      a._isMelee  = actionIsMelee(a);
      a._isRanged = actionIsRanged(a);
    }
  }

  function bestEvAction(actions, target, ctx, filter) {
    const candidates = filter ? (actions || []).filter(filter) : (actions || []).slice();
    if (!candidates.length) return null;
    for (const a of candidates) a._ev = actionEv(a, target, ctx);
    candidates.sort((a, b) => (b._ev || 0) - (a._ev || 0));
    return candidates[0];
  }

  function lowestPick(arr, keyFn, tieKeyFn, rng) {
    if (!arr || !arr.length) return null;
    const minK = Math.min(...arr.map(keyFn));
    let ties = arr.filter(x => keyFn(x) === minK);
    if (tieKeyFn && ties.length > 1) {
      const minT = Math.min(...ties.map(tieKeyFn));
      ties = ties.filter(x => tieKeyFn(x) === minT);
    }
    if (ties.length === 1) return ties[0];
    const r = rng ? rng() : 0;
    return ties[Math.floor(r * ties.length)];
  }

  function targetsInBucket(all, me, prefBucket, fallbackOrder) {
    const enemies = aliveEnemies(me, all);
    const inBucket = enemies.filter(e => positionOf(e) === prefBucket);
    if (inBucket.length) return inBucket;
    for (const b of (fallbackOrder || [])) {
      const f = enemies.filter(e => positionOf(e) === b);
      if (f.length) return f;
    }
    return enemies;
  }

  // Position lookup for a combatant — only PCs have a position bucket.
  // Monster targets default to 'frontline' so they sort first when a
  // bucket-aware policy ever scores a mixed-side scenario (shouldn't happen
  // in v1.5 — monster-side roles always target PCs).
  function positionOf(combatant) {
    if (!combatant || combatant.side !== 'pc' || !combatant.pm) return 'frontline';
    return position(combatant.pm);
  }
```

NOTE: `position(pm)` is defined in Task 4. To keep this task self-contained for testing, add a temporary stub immediately above `positionOf`:

```js
  // Temporary stub — replaced by full version in Task 4.
  function position(pm) {
    if (!pm || !pm.actions || !pm.actions.length) return 'frontline';
    let ranged = 0, both = 0;
    for (const a of pm.actions) {
      if (a.actionRange === 'ranged') ranged++;
      else if (a.actionRange === 'both') both++;
    }
    const r = (ranged + 0.5 * both) / pm.actions.length;
    if (r < 0.3) return 'frontline';
    if (r > 0.7) return 'backline';
    return 'midline';
  }
```

(Task 4 will move the rangedness/bucket logic into proper helpers; the stub keeps Task 3 testable now.)

- [ ] **Step 5: Add the helpers to exports.** Replace the helper line in the exports object:

```js
    clamp01, sumDice, actionIsMelee, actionIsRanged, targetSaveBonus, actionEv,
    tagActions, bestEvAction, lowestPick, targetsInBucket, position, positionOf,
```

- [ ] **Step 6: Run tests — verify all 7 new ones pass**

- [ ] **Step 7: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible engine: picker helpers — lowestPick, bestEvAction, targetsInBucket"
```

---

### Task 4: PC rangedness + position helpers (replaces Task 3's stub)

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-rolepolicy-task4"
cp crucible-engine.js tests/engine.test.html "backups/${TS}-rolepolicy-task4/"
```

- [ ] **Step 2: Append failing tests inside the last `<script>` block of `tests/engine.test.html`:**

```js
test('rangedness: all melee → 0', () => {
  const pm = { actions:[{ actionRange:'melee' }, { actionRange:'melee' }] };
  assertEq(Crucible.rangedness(pm), 0);
});
test('rangedness: all ranged → 1', () => {
  const pm = { actions:[{ actionRange:'ranged' }, { actionRange:'ranged' }] };
  assertEq(Crucible.rangedness(pm), 1);
});
test('rangedness: half-and-half → 0.5', () => {
  const pm = { actions:[{ actionRange:'melee' }, { actionRange:'ranged' }] };
  assertEq(Crucible.rangedness(pm), 0.5);
});
test('rangedness: "both" counts as 0.5', () => {
  const pm = { actions:[{ actionRange:'both' }, { actionRange:'both' }] };
  assertEq(Crucible.rangedness(pm), 0.5);
});
test('rangedness: empty actions → 0', () => {
  assertEq(Crucible.rangedness({ actions: [] }), 0);
  assertEq(Crucible.rangedness({}), 0);
});
test('bucket: thresholds 0.3 and 0.7', () => {
  assertEq(Crucible.bucket(0),    'frontline');
  assertEq(Crucible.bucket(0.29), 'frontline');
  assertEq(Crucible.bucket(0.3),  'midline');
  assertEq(Crucible.bucket(0.5),  'midline');
  assertEq(Crucible.bucket(0.7),  'midline');
  assertEq(Crucible.bucket(0.71), 'backline');
  assertEq(Crucible.bucket(1),    'backline');
});
test('position: uses override when set', () => {
  const pm = {
    actions:[{ actionRange:'melee' }, { actionRange:'melee' }],
    positionOverride: 'backline',
  };
  assertEq(Crucible.position(pm), 'backline');
});
test('position: derives from actions when override is null', () => {
  const pm = {
    actions:[{ actionRange:'ranged' }, { actionRange:'ranged' }, { actionRange:'ranged' }],
    positionOverride: null,
  };
  assertEq(Crucible.position(pm), 'backline');
});
```

- [ ] **Step 3: Run tests — `rangedness` and `bucket` tests fail (Task 3's stub doesn't expose them); position passes because of the stub**

Reload, click Run. Expected: 6 new fail (`Crucible.rangedness is not a function`, `Crucible.bucket is not a function`), 2 position tests may pass (the stub handles them).

- [ ] **Step 4: Replace the stub in `crucible-engine.js`.** Find the existing `position(pm)` stub from Task 3 (with the comment `// Temporary stub — replaced by full version in Task 4.`) and replace it with the proper implementations:

```js
  // ─────────── Rangedness + position ───────────
  // PC's rangedness score in [0, 1]: derived from how many of their actions
  // are ranged. `both`-tagged actions count as 0.5. Empty actions → 0
  // (validation gate already blocks runs without actions).
  function rangedness(pm) {
    if (!pm || !Array.isArray(pm.actions) || !pm.actions.length) return 0;
    let ranged = 0, both = 0;
    for (const a of pm.actions) {
      if (a.actionRange === 'ranged') ranged++;
      else if (a.actionRange === 'both') both++;
    }
    return (ranged + 0.5 * both) / pm.actions.length;
  }

  // Bucket a rangedness score into a position label.
  // Thresholds match the spec: < 0.3 frontline, 0.3..0.7 midline, > 0.7 backline.
  function bucket(score) {
    if (!Number.isFinite(score)) return 'frontline';
    if (score < 0.3) return 'frontline';
    if (score > 0.7) return 'backline';
    return 'midline';
  }

  // Active position: explicit override wins over derived bucket.
  function position(pm) {
    if (pm && pm.positionOverride) return pm.positionOverride;
    return bucket(rangedness(pm));
  }
```

- [ ] **Step 5: Add `rangedness` and `bucket` to exports.** Update the helper line:

```js
    clamp01, sumDice, actionIsMelee, actionIsRanged, targetSaveBonus, actionEv,
    tagActions, bestEvAction, lowestPick, targetsInBucket,
    rangedness, bucket, position, positionOf,
```

- [ ] **Step 6: Run tests — verify all 8 new ones pass**

- [ ] **Step 7: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible engine: rangedness + position bucket with override"
```

---

### Task 5: Role inference + resolveRole (with crHpMedian table)

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-rolepolicy-task5"
cp crucible-engine.js tests/engine.test.html "backups/${TS}-rolepolicy-task5/"
```

- [ ] **Step 2: Append failing tests inside the last `<script>` block of `tests/engine.test.html`:**

```js
test('crHpMedian: lookup returns plausible numbers', () => {
  // CR 1 should be ~33, CR 5 should be ~100, CR 10 should be ~205.
  // We assert a range; the exact 2024 DMG values are in the table.
  const cr1  = Crucible.crHpMedian(1);
  const cr5  = Crucible.crHpMedian(5);
  const cr10 = Crucible.crHpMedian(10);
  assertTrue(cr1 > 0 && cr1 < 50, `cr1=${cr1}`);
  assertTrue(cr5 > 50 && cr5 < 200, `cr5=${cr5}`);
  assertTrue(cr10 > 150 && cr10 < 350, `cr10=${cr10}`);
  // Fractional CRs work.
  assertTrue(Crucible.crHpMedian(0.5) > 0, 'cr 1/2');
  assertTrue(Crucible.crHpMedian(0.25) > 0, 'cr 1/4');
});

test('inferRole: heal action → leader', () => {
  const m = { parsedActions:[{ kind:'heal', heal:{ dice:'2d4', mod:3 } }] };
  assertEq(Crucible.inferRole(m), 'leader');
});
test('inferRole: all ranged attacks → artillery', () => {
  const m = { parsedActions:[
    { kind:'attack', range:[80,320], damage:[{ dice:'1d10', mod:3, type:'piercing' }] },
    { kind:'attack', range:[60,180], damage:[{ dice:'1d8', mod:3, type:'piercing' }] },
  ]};
  assertEq(Crucible.inferRole(m), 'artillery');
});
test('inferRole: control save → controller', () => {
  const m = { parsedActions:[
    { kind:'save', saveAbility:'wis', saveDc:15, condition:'paralyzed',
      damageOnFail:[], aoeTargets:1, halfOnSave:false },
  ]};
  assertEq(Crucible.inferRole(m), 'controller');
});
test('inferRole: high HP + multiattack → brute', () => {
  const m = {
    cr: 5,
    hp: 200,  // well above CR 5 median
    parsedActions:[
      { kind:'multiattack', multiattackPlan:[{ actionName:'Slam', count:2 }] },
      { kind:'attack', sourceActionName:'Slam', reach:5,
        damage:[{ dice:'2d8', mod:5, type:'bludgeoning' }] },
    ],
  };
  assertEq(Crucible.inferRole(m), 'brute');
});
test('inferRole: 1/Day finisher + small action list → ambusher', () => {
  const m = {
    cr: 3,
    hp: 60,
    parsedActions:[
      { kind:'attack', reach:5, damage:[{ dice:'1d6', mod:3, type:'piercing' }] },
      { kind:'attack', sourceActionName:'Assassinate', reach:5,
        usesPerDay: 1, damage:[{ dice:'6d6', mod:3, type:'piercing' }] },
    ],
  };
  assertEq(Crucible.inferRole(m), 'ambusher');
});
test('inferRole: default → soldier', () => {
  const m = {
    cr: 3, hp: 50,
    parsedActions:[
      { kind:'attack', reach:5, damage:[{ dice:'1d8', mod:3, type:'slashing' }] },
    ],
  };
  assertEq(Crucible.inferRole(m), 'soldier');
});
test('inferRole: empty actions → soldier', () => {
  assertEq(Crucible.inferRole({}), 'soldier');
  assertEq(Crucible.inferRole({ parsedActions: [] }), 'soldier');
});

test('resolveRole: roleOverride wins', () => {
  const m = { roleOverride:'brute', fmRole:'soldier', inferredRole:'leader',
              parsedActions:[] };
  assertEq(Crucible.resolveRole(m), 'brute');
});
test('resolveRole: fmRole wins over inferred', () => {
  const m = { fmRole:'artillery', inferredRole:'leader', parsedActions:[] };
  assertEq(Crucible.resolveRole(m), 'artillery');
});
test('resolveRole: inferred used when no fmRole/override', () => {
  const m = { parsedActions:[{ kind:'heal', heal:{ dice:'1d8', mod:0 } }] };
  assertEq(Crucible.resolveRole(m), 'leader');
  // Also: inference is cached on the monster.
  assertEq(m.inferredRole, 'leader');
});
test('resolveRole: unknown role normalizes to soldier', () => {
  const m = { roleOverride:'made-up-role', parsedActions:[] };
  assertEq(Crucible.resolveRole(m), 'soldier');
});
```

- [ ] **Step 3: Run tests — verify the 11 new ones fail**

- [ ] **Step 4: Add the inference + resolution helpers inside the IIFE of `crucible-engine.js`, after the `position` function from Task 4:**

```js
  // ─────────── Role inference ───────────
  // Median HP per CR — sourced from the 2024 DMG monster table. Fractional
  // CRs covered for low-tier creatures. Lookups beyond CR 20 cap at CR 20.
  const CR_HP_MEDIAN = {
    0:    2,    0.125: 7,   0.25: 13,   0.5: 22,
    1:    33,   2:    52,   3:   78,    4:   97,
    5:    115,  6:   135,   7:  152,    8:  168,
    9:    188,  10:  205,   11: 222,    12: 240,
    13:   258,  14:  275,   15: 292,    16: 310,
    17:   327,  18:  345,   19: 362,    20: 380,
  };
  function crHpMedian(cr) {
    const c = +cr;
    if (!Number.isFinite(c)) return CR_HP_MEDIAN[1];
    if (CR_HP_MEDIAN[c] != null) return CR_HP_MEDIAN[c];
    // Find nearest defined CR.
    const keys = Object.keys(CR_HP_MEDIAN).map(Number);
    let best = keys[0];
    for (const k of keys) {
      if (Math.abs(k - c) < Math.abs(best - c)) best = k;
    }
    return CR_HP_MEDIAN[best];
  }

  const CONTROL_CONDITIONS = ['stunned','paralyzed','restrained','frightened','charmed'];

  function inferRole(monster) {
    const acts = (monster && monster.parsedActions) || [];
    if (!acts.length) return 'soldier';

    const hasHeal     = acts.some(a => a.kind === 'heal');
    const attackActs  = acts.filter(a => a.kind === 'attack');
    const allRanged   = attackActs.length > 0 && attackActs.every(a => actionIsRanged(a));
    const hasControl  = acts.some(a => a.kind === 'save' && a.condition &&
                                       CONTROL_CONDITIONS.includes(a.condition));
    const hasMulti    = acts.some(a => a.kind === 'multiattack');
    const highHp      = monster.hp >= crHpMedian(monster.cr) * 1.3;
    const hasFinisher = acts.some(a => a.usesPerDay === 1 && a.kind !== 'heal');

    if (hasHeal)                            return 'leader';
    if (allRanged)                          return 'artillery';
    if (hasControl)                         return 'controller';
    if (highHp && hasMulti)                 return 'brute';
    if (hasFinisher && acts.length <= 3)    return 'ambusher';
    return 'soldier';
  }

  // ─────────── Role resolution (override > fmRole > inferred > soldier) ───────────
  const KNOWN_ROLES = ['ambusher','artillery','brute','controller','leader',
                       'skirmisher','soldier','solo','minion'];

  function normalizeRole(s) {
    if (!s) return null;
    const k = String(s).toLowerCase().trim();
    return KNOWN_ROLES.includes(k) ? k : null;
  }

  function resolveRole(monster) {
    if (!monster) return 'soldier';
    const ov  = normalizeRole(monster.roleOverride);
    if (ov)  return ov;
    const fm  = normalizeRole(monster.fmRole);
    if (fm)  return fm;
    if (monster.inferredRole) return monster.inferredRole;
    monster.inferredRole = inferRole(monster);
    return monster.inferredRole;
  }
```

- [ ] **Step 5: Add to exports.** Append to the helper line:

```js
    clamp01, sumDice, actionIsMelee, actionIsRanged, targetSaveBonus, actionEv,
    tagActions, bestEvAction, lowestPick, targetsInBucket,
    rangedness, bucket, position, positionOf,
    crHpMedian, inferRole, resolveRole, normalizeRole,
```

- [ ] **Step 6: Run tests — verify all 11 new ones pass**

- [ ] **Step 7: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible engine: inferRole + resolveRole + crHpMedian lookup"
```

---

## Phase 2 — Role policies (the nine pickers)

### Task 6: Soldier policy + ROLE_POLICIES registry + runTrial integration

This task plumbs the registry into `runTrial` while preserving v1 behavior — Soldier's `pickTarget` + `pickAction` delegate to existing functions. Once this lands, all v1 scenarios still pass.

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-rolepolicy-task6"
cp crucible-engine.js tests/engine.test.html "backups/${TS}-rolepolicy-task6/"
```

- [ ] **Step 2: Append a sanity test** that the registry exists with at least the Soldier entry:

```js
test('ROLE_POLICIES: registry exposes soldier with pickTarget/pickAction', () => {
  const p = Crucible.ROLE_POLICIES.soldier;
  assertTrue(typeof p.pickTarget === 'function', 'pickTarget is function');
  assertTrue(typeof p.pickAction === 'function', 'pickAction is function');
});
test('Soldier pickTarget: lowest HP wins', () => {
  const me = { side:'monster', name:'Mob' };
  const enemies = [
    { side:'pc', name:'A', hp:30, ac:18, downed:false, dead:false, pm:{ actions:[{ actionRange:'melee' }] } },
    { side:'pc', name:'B', hp:5,  ac:14, downed:false, dead:false, pm:{ actions:[{ actionRange:'melee' }] } },
    { side:'pc', name:'C', hp:20, ac:12, downed:false, dead:false, pm:{ actions:[{ actionRange:'melee' }] } },
  ];
  const ctx = { round:1, rng:() => 0, tactics:{} };
  const t = Crucible.ROLE_POLICIES.soldier.pickTarget(me, [me, ...enemies], ctx);
  assertEq(t.name, 'B');
});
test('Soldier pickAction: multiattack wins when available', () => {
  const subAtk = { sourceActionName:'Bite', kind:'attack', toHit:5,
                   damage:[{ dice:'1d8', mod:3, type:'piercing' }] };
  const multi = {
    sourceActionName:'Multiattack', kind:'multiattack',
    multiattackPlan:[{ actionName:'Bite', count:2 }],
  };
  const me = { side:'monster',
               monster:{ parsedActions:[multi, subAtk] },
               slotsLeft:{}, rechargeReady:{} };
  const target = { ac:15 };
  const ctx = { round:1, rng:() => 0, tactics:{}, livingEnemyCount:1 };
  const a = Crucible.ROLE_POLICIES.soldier.pickAction(me, target, ctx);
  assertEq(a.sourceActionName, 'Multiattack');
});
```

- [ ] **Step 3: Run tests — verify the 3 new ones fail**

Reload, click Run. Expected: 3 fail (`Crucible.ROLE_POLICIES is undefined`).

- [ ] **Step 4: Add the Soldier policy + registry inside the IIFE of `crucible-engine.js`, after the `resolveRole` function from Task 5:**

```js
  // ─────────── Role policies ───────────
  // Return the actor's available actions (own parsedActions / pm.actions).
  // Monster-side here; PC-side keeps its own dispatch path.
  function availableMonsterActions(me) {
    const list = (me.monster && me.monster.parsedActions) || [];
    return list.filter(a => isAvailable(me, a));
  }

  // ── Soldier ──
  function pickTargetSoldier(me, all, ctx) {
    return lowestPick(aliveEnemies(me, all), c => c.hp, c => c.ac, ctx.rng);
  }
  function pickActionSoldier(me, target, ctx) {
    const actions = availableMonsterActions(me);
    tagActions(actions);
    // Multiattack first.
    const ma = actions.find(a => a.kind === 'multiattack');
    if (ma) { ma._ownerActions = actions; return ma; }
    // Limited-resource (usesPerDay/recharge) before at-will, scored by EV.
    const limited = bestEvAction(actions, target, ctx,
                                 a => (a.usesPerDay != null || a.recharge) &&
                                      ['attack','save'].includes(a.kind));
    if (limited) return limited;
    // At-will.
    return bestEvAction(actions, target, ctx,
                        a => ['attack','save'].includes(a.kind));
  }

  const ROLE_POLICIES = {
    soldier: { pickTarget: pickTargetSoldier, pickAction: pickActionSoldier },
  };
```

- [ ] **Step 5: Modify the monster branch in `runTrial`.** Find the section in `runTrial` that begins:

```js
        // Heal triage first.
        const all = combatants;
        const heal = healTriage(c, all, round);
        if (heal) {
```

After the `if (heal) { … }` block closes and before the `else { … }` that handles the non-heal case, the existing code has a single `else` for both PCs and monsters that calls `pickAction(c)`. Replace the entire non-heal else-block (everything from `} else {` after the heal triage through the end of the action-dispatch, before the end-check) with a side-aware dispatch.

The exact replacement: find this block in `runTrial`:

```js
        } else {
          const action = pickAction(c);
          if (!action) continue;
          if (action.kind === 'multiattack') {
```

and replace its opening through the start of the kind-dispatch with the role-aware version:

```js
        } else {
          let action = null;
          let targets = null;
          if (c.side === 'monster') {
            const role = resolveRole(c.monster);
            const policy = ROLE_POLICIES[role] || ROLE_POLICIES.soldier;
            const policyCtx = {
              round, rng, tactics,
              livingEnemyCount: aliveEnemies(c, all).length,
            };
            const tgt = policy.pickTarget(c, all, policyCtx);
            if (!tgt) continue;
            targets = Array.isArray(tgt) ? tgt : [tgt];
            action = policy.pickAction(c, targets[0], policyCtx);
            if (!action) continue;
          } else {
            // PC branch — unchanged from v1.
            action = pickAction(c);
            if (!action) continue;
          }
          if (action.kind === 'multiattack') {
```

Then in the multiattack and attack branches that follow, the existing code calls `pickEnemyTarget(c, all, tactics, rng)` to pick the target. For monsters now we already have `targets`. Find these existing branches and update target-picking only for the monster path:

In the attack branch (existing):

```js
          } else if (action.kind === 'attack') {
            const tgt = pickEnemyTarget(c, all, tactics, rng);
            if (!tgt) continue;
            consumeUse(c, action);
            const r = c.side === 'pc'
              ? resolveAttackPc(c, tgt, action, rng, events, round)
              : resolveAttackMonster(c, tgt, action, rng, events, round);
```

Change to:

```js
          } else if (action.kind === 'attack') {
            const tgt = (c.side === 'monster' && targets && targets[0])
                          ? targets[0]
                          : pickEnemyTarget(c, all, tactics, rng);
            if (!tgt) continue;
            consumeUse(c, action);
            const r = c.side === 'pc'
              ? resolveAttackPc(c, tgt, action, rng, events, round)
              : resolveAttackMonster(c, tgt, action, rng, events, round);
```

In the save branch (existing):

```js
          } else if (action.kind === 'save') {
            const enemies = aliveEnemies(c, all)
              .sort((a, b) => a.hp - b.hp);
            const n = Math.max(1, action.aoeTargets || 1);
            const targets = enemies.slice(0, n);
            if (!targets.length) continue;
            consumeUse(c, action);
            const r = resolveSave(c, targets, action, rng, events, round);
```

Note: the local var `targets` shadows the outer one. Rename the local to `saveTargets` and route monster-side picks through the role-policy targets:

```js
          } else if (action.kind === 'save') {
            let saveTargets;
            if (c.side === 'monster' && targets && targets.length) {
              saveTargets = targets;
            } else {
              const enemies = aliveEnemies(c, all).sort((a, b) => a.hp - b.hp);
              const n = Math.max(1, action.aoeTargets || 1);
              saveTargets = enemies.slice(0, n);
            }
            if (!saveTargets.length) continue;
            consumeUse(c, action);
            const r = resolveSave(c, saveTargets, action, rng, events, round);
```

(Update the `tally` call that follows to also reference `saveTargets` if the original referenced `targets`. The original tallies based on `r.totalDmg`, so this is just variable-rename hygiene.)

The multiattack and heal branches do not pick targets here (multiattack's sub-attacks pick per-attack via `resolveMultiattack`; heal handles its own `target:'self'` case). No changes needed in those branches for Task 6.

- [ ] **Step 6: Add `ROLE_POLICIES` to exports.** Append:

```js
    ROLE_POLICIES,
```

inside the `Crucible = { ... }` block.

- [ ] **Step 7: Run all tests — including the 5 existing spec scenarios — verify all pass**

Open `tests/engine.test.html`, click Run. Critical: scenarios 1–5 (the v1 baseline) must still pass. The 3 new Soldier tests must pass.

- [ ] **Step 8: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible engine: ROLE_POLICIES registry + Soldier policy + runTrial dispatch"
```

---

### Task 7: Brute and Minion policies

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-rolepolicy-task7"
cp crucible-engine.js tests/engine.test.html "backups/${TS}-rolepolicy-task7/"
```

- [ ] **Step 2: Append failing tests:**

```js
test('Brute pickTarget: prefers frontline, ties by lowest AC', () => {
  const front1 = { side:'pc', name:'Tank',     hp:40, ac:18,
                   pm:{ actions:[{ actionRange:'melee' }] }, downed:false, dead:false };
  const front2 = { side:'pc', name:'Fighter',  hp:35, ac:15,
                   pm:{ actions:[{ actionRange:'melee' }] }, downed:false, dead:false };
  const back   = { side:'pc', name:'Wizard',   hp:15, ac:12,
                   pm:{ actions:[{ actionRange:'ranged' }] }, downed:false, dead:false };
  const me = { side:'monster' };
  const all = [me, front1, front2, back];
  const ctx = { round:1, rng:() => 0, tactics:{} };
  const t = Crucible.ROLE_POLICIES.brute.pickTarget(me, all, ctx);
  // Both Tank and Fighter are frontline; ties by lowest AC → Fighter (AC15).
  assertEq(t.name, 'Fighter');
});
test('Brute pickAction: melee wins over higher-EV ranged', () => {
  const melee  = { kind:'attack', sourceActionName:'Slam', toHit:5, reach:5,
                   damage:[{ dice:'1d6', mod:3, type:'bludgeoning' }] };
  const ranged = { kind:'attack', sourceActionName:'Boulder', toHit:5, range:[20,60],
                   damage:[{ dice:'2d10', mod:3, type:'bludgeoning' }] };
  const me = { side:'monster',
               monster:{ parsedActions:[ranged, melee] },
               slotsLeft:{}, rechargeReady:{} };
  const target = { ac:15 };
  const ctx = { round:1, rng:()=>0, tactics:{}, livingEnemyCount:1 };
  const a = Crucible.ROLE_POLICIES.brute.pickAction(me, target, ctx);
  assertEq(a.sourceActionName, 'Slam');
});
test('Brute pickAction: falls back to ranged if no melee', () => {
  const ranged = { kind:'attack', sourceActionName:'Boulder', toHit:5, range:[20,60],
                   damage:[{ dice:'2d10', mod:3, type:'bludgeoning' }] };
  const me = { side:'monster',
               monster:{ parsedActions:[ranged] },
               slotsLeft:{}, rechargeReady:{} };
  const target = { ac:15 };
  const ctx = { round:1, rng:()=>0, tactics:{}, livingEnemyCount:1 };
  const a = Crucible.ROLE_POLICIES.brute.pickAction(me, target, ctx);
  assertEq(a.sourceActionName, 'Boulder');
});

test('Minion pickTarget: picks the first frontline enemy', () => {
  const front = { side:'pc', name:'Tank', hp:40, ac:18,
                  pm:{ actions:[{ actionRange:'melee' }] }, downed:false, dead:false };
  const back  = { side:'pc', name:'Wizard', hp:15, ac:12,
                  pm:{ actions:[{ actionRange:'ranged' }] }, downed:false, dead:false };
  const me = { side:'monster' };
  const all = [me, front, back];
  const ctx = { round:1, rng:()=>0, tactics:{} };
  const t = Crucible.ROLE_POLICIES.minion.pickTarget(me, all, ctx);
  assertEq(t.name, 'Tank');
});
test('Minion pickAction: first available at-will attack', () => {
  const a1 = { kind:'attack', sourceActionName:'Shortsword', toHit:3,
               damage:[{ dice:'1d6', mod:1, type:'piercing' }] };
  const me = { side:'monster',
               monster:{ parsedActions:[a1] },
               slotsLeft:{}, rechargeReady:{} };
  const ctx = { round:1, rng:()=>0, tactics:{}, livingEnemyCount:1 };
  const a = Crucible.ROLE_POLICIES.minion.pickAction(me, { ac:15 }, ctx);
  assertEq(a.sourceActionName, 'Shortsword');
});
```

- [ ] **Step 3: Run tests — verify the 5 new ones fail**

- [ ] **Step 4: Add the Brute and Minion policies inside the IIFE of `crucible-engine.js`, after the existing Soldier policy:**

```js
  // ── Brute ──
  function pickTargetBrute(me, all, ctx) {
    const candidates = targetsInBucket(all, me, 'frontline', ['midline', 'backline']);
    return lowestPick(candidates, c => c.ac, c => c.hp, ctx.rng);
  }
  function pickActionBrute(me, target, ctx) {
    const actions = availableMonsterActions(me);
    tagActions(actions);
    // Multiattack wins if available — Brutes love to multiattack.
    const ma = actions.find(a => a.kind === 'multiattack');
    if (ma) { ma._ownerActions = actions; return ma; }
    const melee = bestEvAction(actions, target, ctx,
                               a => a._isMelee && ['attack','save'].includes(a.kind));
    if (melee) return melee;
    return bestEvAction(actions, target, ctx,
                        a => ['attack','save'].includes(a.kind));
  }

  // ── Minion ──
  function pickTargetMinion(me, all, ctx) {
    const candidates = targetsInBucket(all, me, 'frontline', ['midline', 'backline']);
    return candidates[0] || null;
  }
  function pickActionMinion(me, target, ctx) {
    const actions = availableMonsterActions(me);
    // First available at-will attack/save — no DPR thinking.
    return actions.find(a => ['attack','save'].includes(a.kind) &&
                             a.usesPerDay == null && !a.recharge) ||
           actions.find(a => ['attack','save'].includes(a.kind)) || null;
  }
```

- [ ] **Step 5: Extend the `ROLE_POLICIES` registry.** Find the existing definition:

```js
  const ROLE_POLICIES = {
    soldier: { pickTarget: pickTargetSoldier, pickAction: pickActionSoldier },
  };
```

Replace with:

```js
  const ROLE_POLICIES = {
    soldier: { pickTarget: pickTargetSoldier, pickAction: pickActionSoldier },
    brute:   { pickTarget: pickTargetBrute,   pickAction: pickActionBrute },
    minion:  { pickTarget: pickTargetMinion,  pickAction: pickActionMinion },
  };
```

- [ ] **Step 6: Run tests — verify all 5 new ones pass**

- [ ] **Step 7: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible engine: Brute and Minion role policies"
```

---

### Task 8: Artillery, Skirmisher, Ambusher policies

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-rolepolicy-task8"
cp crucible-engine.js tests/engine.test.html "backups/${TS}-rolepolicy-task8/"
```

- [ ] **Step 2: Append failing tests:**

```js
test('Artillery pickTarget: prefers backline, ties by lowest HP', () => {
  const front = { side:'pc', name:'Tank', hp:40, ac:18,
                  pm:{ actions:[{ actionRange:'melee' }] }, downed:false, dead:false };
  const back1 = { side:'pc', name:'Wizard', hp:18, ac:12,
                  pm:{ actions:[{ actionRange:'ranged' }] }, downed:false, dead:false };
  const back2 = { side:'pc', name:'Bard',   hp:25, ac:13,
                  pm:{ actions:[{ actionRange:'ranged' }] }, downed:false, dead:false };
  const me = { side:'monster' };
  const all = [me, front, back1, back2];
  const ctx = { round:1, rng:()=>0, tactics:{} };
  const t = Crucible.ROLE_POLICIES.artillery.pickTarget(me, all, ctx);
  assertEq(t.name, 'Wizard');   // backline tie → lowest HP
});
test('Artillery pickAction: ranged wins over higher-EV melee', () => {
  const melee  = { kind:'attack', sourceActionName:'Bite',  toHit:5, reach:5,
                   damage:[{ dice:'2d10', mod:5, type:'piercing' }] };
  const ranged = { kind:'attack', sourceActionName:'Bolt', toHit:5, range:[80,320],
                   damage:[{ dice:'1d8', mod:3, type:'force' }] };
  const me = { side:'monster',
               monster:{ parsedActions:[melee, ranged] },
               slotsLeft:{}, rechargeReady:{} };
  const ctx = { round:1, rng:()=>0, tactics:{}, livingEnemyCount:1 };
  const a = Crucible.ROLE_POLICIES.artillery.pickAction(me, { ac:13 }, ctx);
  assertEq(a.sourceActionName, 'Bolt');
});

test('Skirmisher pickTarget with ranged actions: highest-rangedness, lowest HP tiebreak', () => {
  const front = { side:'pc', name:'Tank', hp:10, ac:18,
                  pm:{ actions:[{ actionRange:'melee' }, { actionRange:'melee' }] },
                  downed:false, dead:false };
  const back1 = { side:'pc', name:'Wizard', hp:18, ac:12,
                  pm:{ actions:[{ actionRange:'ranged' }, { actionRange:'ranged' }] },
                  downed:false, dead:false };
  const back2 = { side:'pc', name:'Sorcerer', hp:14, ac:13,
                  pm:{ actions:[{ actionRange:'ranged' }, { actionRange:'ranged' }] },
                  downed:false, dead:false };
  const me = { side:'monster',
               monster:{ parsedActions:[
                 { kind:'attack', sourceActionName:'Bow', toHit:5, range:[80,320],
                   damage:[{ dice:'1d8', mod:3, type:'piercing' }] }
               ]},
               slotsLeft:{}, rechargeReady:{} };
  const all = [me, front, back1, back2];
  const ctx = { round:1, rng:()=>0, tactics:{} };
  const t = Crucible.ROLE_POLICIES.skirmisher.pickTarget(me, all, ctx);
  // Both back1 and back2 are highest-rangedness (1.0); tie → lowest HP → Sorcerer (14 < 18).
  assertEq(t.name, 'Sorcerer');
});
test('Skirmisher pickAction: prefers ranged attack', () => {
  const melee  = { kind:'attack', sourceActionName:'Dagger', toHit:5, reach:5,
                   damage:[{ dice:'1d4', mod:3, type:'piercing' }] };
  const ranged = { kind:'attack', sourceActionName:'Bow', toHit:5, range:[80,320],
                   damage:[{ dice:'1d8', mod:3, type:'piercing' }] };
  const me = { side:'monster',
               monster:{ parsedActions:[melee, ranged] },
               slotsLeft:{}, rechargeReady:{} };
  const ctx = { round:1, rng:()=>0, tactics:{}, livingEnemyCount:1 };
  const a = Crucible.ROLE_POLICIES.skirmisher.pickAction(me, { ac:13 }, ctx);
  assertEq(a.sourceActionName, 'Bow');
});

test('Ambusher pickTarget: lowest HP, ties by lowest AC', () => {
  const a = { side:'pc', name:'A', hp:5, ac:18,
              pm:{ actions:[{ actionRange:'melee' }] }, downed:false, dead:false };
  const b = { side:'pc', name:'B', hp:5, ac:12,
              pm:{ actions:[{ actionRange:'melee' }] }, downed:false, dead:false };
  const c = { side:'pc', name:'C', hp:20, ac:10,
              pm:{ actions:[{ actionRange:'melee' }] }, downed:false, dead:false };
  const me = { side:'monster' };
  const all = [me, a, b, c];
  const ctx = { round:1, rng:()=>0, tactics:{} };
  const t = Crucible.ROLE_POLICIES.ambusher.pickTarget(me, all, ctx);
  assertEq(t.name, 'B');
});
test('Ambusher pickAction round 1: prefers (1/Day) finisher', () => {
  const atWill   = { kind:'attack', sourceActionName:'Stab', toHit:5, reach:5,
                     damage:[{ dice:'1d6', mod:3, type:'piercing' }] };
  const finisher = { kind:'attack', sourceActionName:'Assassinate', toHit:7, reach:5,
                     usesPerDay: 1,
                     damage:[{ dice:'6d6', mod:5, type:'piercing' }] };
  const me = { side:'monster',
               monster:{ parsedActions:[atWill, finisher] },
               slotsLeft:{}, rechargeReady:{} };
  const ctx = { round:1, rng:()=>0, tactics:{}, livingEnemyCount:1 };
  const a = Crucible.ROLE_POLICIES.ambusher.pickAction(me, { ac:14 }, ctx);
  assertEq(a.sourceActionName, 'Assassinate');
});
test('Ambusher pickAction round 2+: falls back to best EV', () => {
  const atWill   = { kind:'attack', sourceActionName:'Stab', toHit:5, reach:5,
                     damage:[{ dice:'1d6', mod:3, type:'piercing' }] };
  // After round 1, finisher's usesPerDay is exhausted; only atWill remains.
  const finisher = { kind:'attack', sourceActionName:'Assassinate', toHit:7, reach:5,
                     usesPerDay: 1,
                     damage:[{ dice:'6d6', mod:5, type:'piercing' }] };
  const me = { side:'monster',
               monster:{ parsedActions:[atWill, finisher] },
               slotsLeft:{ 'Assassinate': 0 }, rechargeReady:{} };
  const ctx = { round:2, rng:()=>0, tactics:{}, livingEnemyCount:1 };
  const a = Crucible.ROLE_POLICIES.ambusher.pickAction(me, { ac:14 }, ctx);
  assertEq(a.sourceActionName, 'Stab');
});
```

- [ ] **Step 3: Run tests — verify the 7 new ones fail**

- [ ] **Step 4: Add the policies inside the IIFE of `crucible-engine.js`, after the Brute/Minion policies:**

```js
  // ── Artillery ──
  function pickTargetArtillery(me, all, ctx) {
    const candidates = targetsInBucket(all, me, 'backline', ['midline', 'frontline']);
    return lowestPick(candidates, c => c.hp, c => c.ac, ctx.rng);
  }
  function pickActionArtillery(me, target, ctx) {
    const actions = availableMonsterActions(me);
    tagActions(actions);
    const ma = actions.find(a => a.kind === 'multiattack');
    if (ma) { ma._ownerActions = actions; return ma; }
    const ranged = bestEvAction(actions, target, ctx,
                                a => a._isRanged && ['attack','save'].includes(a.kind));
    if (ranged) return ranged;
    return bestEvAction(actions, target, ctx,
                        a => ['attack','save'].includes(a.kind));
  }

  // ── Skirmisher ──
  function pickTargetSkirmisher(me, all, ctx) {
    const enemies = aliveEnemies(me, all);
    const actions = availableMonsterActions(me);
    const hasRanged = actions.some(a => actionIsRanged(a));
    if (hasRanged && enemies.length) {
      // Pick exposed squishies: highest rangedness, then lowest HP.
      const sorted = enemies.slice().sort((a, b) => {
        const ra = a.side === 'pc' && a.pm ? rangedness(a.pm) : 0;
        const rb = b.side === 'pc' && b.pm ? rangedness(b.pm) : 0;
        if (rb !== ra) return rb - ra;
        return a.hp - b.hp;
      });
      return sorted[0];
    }
    return lowestPick(enemies, c => c.hp, c => c.ac, ctx.rng);
  }
  function pickActionSkirmisher(me, target, ctx) {
    const actions = availableMonsterActions(me);
    tagActions(actions);
    const ranged = bestEvAction(actions, target, ctx,
                                a => a._isRanged && a.kind === 'attack');
    if (ranged) return ranged;
    return bestEvAction(actions, target, ctx,
                        a => ['attack','save','multiattack'].includes(a.kind));
  }

  // ── Ambusher ──
  function pickTargetAmbusher(me, all, ctx) {
    return lowestPick(aliveEnemies(me, all), c => c.hp, c => c.ac, ctx.rng);
  }
  function pickActionAmbusher(me, target, ctx) {
    const actions = availableMonsterActions(me);
    tagActions(actions);
    // Round 1: prefer (1/Day) finishers if any available.
    if (ctx.round === 1) {
      const finisher = bestEvAction(actions, target, ctx,
                                    a => a.usesPerDay === 1 &&
                                         a.kind !== 'heal' &&
                                         a.kind !== 'utility');
      if (finisher) return finisher;
    }
    return bestEvAction(actions, target, ctx,
                        a => ['attack','save','multiattack'].includes(a.kind));
  }
```

- [ ] **Step 5: Extend `ROLE_POLICIES`.** Replace the registry with:

```js
  const ROLE_POLICIES = {
    soldier:    { pickTarget: pickTargetSoldier,    pickAction: pickActionSoldier },
    brute:      { pickTarget: pickTargetBrute,      pickAction: pickActionBrute },
    minion:     { pickTarget: pickTargetMinion,     pickAction: pickActionMinion },
    artillery:  { pickTarget: pickTargetArtillery,  pickAction: pickActionArtillery },
    skirmisher: { pickTarget: pickTargetSkirmisher, pickAction: pickActionSkirmisher },
    ambusher:   { pickTarget: pickTargetAmbusher,   pickAction: pickActionAmbusher },
  };
```

- [ ] **Step 6: Run tests — verify all 7 new ones pass**

- [ ] **Step 7: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible engine: Artillery, Skirmisher, Ambusher role policies"
```

---

### Task 9: Controller, Leader, Solo policies

**Files:**
- Modify: `crucible-engine.js`
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-rolepolicy-task9"
cp crucible-engine.js tests/engine.test.html "backups/${TS}-rolepolicy-task9/"
```

- [ ] **Step 2: Append failing tests:**

```js
test('Controller pickTarget: returns array for AoE save when ≥2 enemies', () => {
  const aoeSave = { kind:'save', saveAbility:'dex', saveDc:15, aoeTargets:4,
                    halfOnSave:true, damageOnFail:[{ dice:'8d6', mod:0, type:'fire' }] };
  const me = { side:'monster',
               monster:{ parsedActions:[aoeSave] },
               slotsLeft:{}, rechargeReady:{} };
  const e1 = { side:'pc', name:'A', hp:30, ac:14,
               pm:{ actions:[{ actionRange:'melee' }] }, downed:false, dead:false };
  const e2 = { side:'pc', name:'B', hp:20, ac:13,
               pm:{ actions:[{ actionRange:'ranged' }] }, downed:false, dead:false };
  const ctx = { round:1, rng:()=>0, tactics:{} };
  const t = Crucible.ROLE_POLICIES.controller.pickTarget(me, [me, e1, e2], ctx);
  assertTrue(Array.isArray(t), 'controller returns array for AoE');
  assertEq(t.length, 2);
});
test('Controller pickTarget: single-save picks lowest save bonus', () => {
  const singleSave = { kind:'save', saveAbility:'wis', saveDc:15, aoeTargets:1,
                       condition:'paralyzed', damageOnFail:[], halfOnSave:false };
  const me = { side:'monster',
               monster:{ parsedActions:[singleSave] },
               slotsLeft:{}, rechargeReady:{} };
  const lowWis = { side:'pc', name:'Brawler', hp:30, ac:14,
                   pm:{ identity:{ level:5 },
                        abilities:{ str:14, dex:10, con:12, int:8, wis:8, cha:8 },
                        profs:{ saves:{} },
                        actions:[{ actionRange:'melee' }] },
                   downed:false, dead:false };
  const highWis = { side:'pc', name:'Cleric', hp:30, ac:15,
                    pm:{ identity:{ level:5 },
                         abilities:{ str:10, dex:10, con:12, int:10, wis:16, cha:10 },
                         profs:{ saves:{ wis:true } },
                         actions:[{ actionRange:'melee' }] },
                    downed:false, dead:false };
  const ctx = { round:1, rng:()=>0, tactics:{} };
  const t = Crucible.ROLE_POLICIES.controller.pickTarget(me, [me, lowWis, highWis], ctx);
  assertEq(t.name, 'Brawler');
});
test('Controller pickAction: prefers save-with-condition over save-with-damage', () => {
  const saveDmg  = { kind:'save', sourceActionName:'Fireball', saveAbility:'dex', saveDc:15,
                     aoeTargets:4, halfOnSave:true,
                     damageOnFail:[{ dice:'8d6', mod:0, type:'fire' }] };
  const lockdown = { kind:'save', sourceActionName:'Hold Person', saveAbility:'wis', saveDc:15,
                     aoeTargets:1, condition:'paralyzed', halfOnSave:false,
                     damageOnFail:[] };
  const me = { side:'monster',
               monster:{ parsedActions:[saveDmg, lockdown] },
               slotsLeft:{}, rechargeReady:{} };
  const target = { side:'pc',
                   pm:{ identity:{ level:5 },
                        abilities:{ str:10, dex:10, con:10, int:10, wis:10, cha:10 },
                        profs:{ saves:{} } } };
  const ctx = { round:1, rng:()=>0, tactics:{}, livingEnemyCount:2 };
  const a = Crucible.ROLE_POLICIES.controller.pickAction(me, target, ctx);
  assertEq(a.sourceActionName, 'Hold Person');
});

test('Leader pickTarget: lowest-HP enemy when no heal trigger', () => {
  const me = { side:'monster' };
  const e1 = { side:'pc', name:'A', hp:30, ac:14,
               pm:{ actions:[{ actionRange:'melee' }] }, downed:false, dead:false };
  const e2 = { side:'pc', name:'B', hp:10, ac:13,
               pm:{ actions:[{ actionRange:'melee' }] }, downed:false, dead:false };
  const ctx = { round:1, rng:()=>0, tactics:{} };
  const t = Crucible.ROLE_POLICIES.leader.pickTarget(me, [me, e1, e2], ctx);
  assertEq(t.name, 'B');
});
test('Leader pickAction: prefers save-effect over attack', () => {
  const atk  = { kind:'attack', sourceActionName:'Mace', toHit:5, reach:5,
                 damage:[{ dice:'1d6', mod:3, type:'bludgeoning' }] };
  const save = { kind:'save', sourceActionName:'Command', saveAbility:'wis', saveDc:14,
                 aoeTargets:1, condition:'frightened', halfOnSave:false,
                 damageOnFail:[] };
  const me = { side:'monster',
               monster:{ parsedActions:[atk, save] },
               slotsLeft:{}, rechargeReady:{} };
  const target = { side:'pc', ac:13,
                   pm:{ identity:{ level:5 },
                        abilities:{ str:10, dex:10, con:10, int:10, wis:10, cha:10 },
                        profs:{ saves:{} } } };
  const ctx = { round:1, rng:()=>0, tactics:{}, livingEnemyCount:1 };
  const a = Crucible.ROLE_POLICIES.leader.pickAction(me, target, ctx);
  assertEq(a.sourceActionName, 'Command');
});

test('Solo pickAction round 1: conserves (1/Day) when no ally downed', () => {
  const atk1     = { kind:'attack', sourceActionName:'Slam', toHit:8, reach:10,
                     damage:[{ dice:'2d10', mod:6, type:'bludgeoning' }] };
  const finisher = { kind:'attack', sourceActionName:'Devastate', toHit:8, reach:10,
                     usesPerDay: 1,
                     damage:[{ dice:'10d10', mod:10, type:'bludgeoning' }] };
  const me = { side:'monster',
               monster:{ parsedActions:[atk1, finisher] },
               slotsLeft:{}, rechargeReady:{} };
  const ctx = { round:1, rng:()=>0, tactics:{}, livingEnemyCount:4 };
  const a = Crucible.ROLE_POLICIES.solo.pickAction(me, { ac:18 }, ctx);
  assertEq(a.sourceActionName, 'Slam');
});
test('Solo pickAction round 3: uses (1/Day) when available', () => {
  const atk1     = { kind:'attack', sourceActionName:'Slam', toHit:8, reach:10,
                     damage:[{ dice:'2d10', mod:6, type:'bludgeoning' }] };
  const finisher = { kind:'attack', sourceActionName:'Devastate', toHit:8, reach:10,
                     usesPerDay: 1,
                     damage:[{ dice:'10d10', mod:10, type:'bludgeoning' }] };
  const me = { side:'monster',
               monster:{ parsedActions:[atk1, finisher] },
               slotsLeft:{}, rechargeReady:{} };
  const ctx = { round:3, rng:()=>0, tactics:{}, livingEnemyCount:4 };
  const a = Crucible.ROLE_POLICIES.solo.pickAction(me, { ac:18 }, ctx);
  assertEq(a.sourceActionName, 'Devastate');
});
test('Solo pickAction: novas immediately if an ally is downed', () => {
  const atk1     = { kind:'attack', sourceActionName:'Slam', toHit:8, reach:10,
                     damage:[{ dice:'2d10', mod:6, type:'bludgeoning' }] };
  const finisher = { kind:'attack', sourceActionName:'Devastate', toHit:8, reach:10,
                     usesPerDay: 1,
                     damage:[{ dice:'10d10', mod:10, type:'bludgeoning' }] };
  const me = { side:'monster',
               monster:{ parsedActions:[atk1, finisher] },
               slotsLeft:{}, rechargeReady:{} };
  // An ally is downed → break conservation even in round 1.
  const downedAlly = { side:'monster', downed:true, dead:false };
  const ctx = { round:1, rng:()=>0, tactics:{}, livingEnemyCount:4 };
  // pickActionSolo signature uses `all` to detect downed allies; pass via test helper.
  const a = Crucible.ROLE_POLICIES.solo.pickAction(me, { ac:18 },
              Object.assign({}, ctx, { all: [me, downedAlly] }));
  assertEq(a.sourceActionName, 'Devastate');
});
```

- [ ] **Step 3: Run tests — verify the 8 new ones fail**

- [ ] **Step 4: Add the policies inside the IIFE of `crucible-engine.js`, after the Ambusher policy:**

```js
  // ── Controller ──
  function pickTargetController(me, all, ctx) {
    const enemies = aliveEnemies(me, all);
    if (!enemies.length) return null;
    const actions = availableMonsterActions(me);
    const aoeSave = actions.find(a => a.kind === 'save' && (a.aoeTargets || 0) >= 2);
    if (aoeSave && enemies.length >= 2) return enemies;   // resolver handles multi-target
    // Single-target save: pick the weakest save bonus vs that ability.
    const bestSave = actions.find(a => a.kind === 'save');
    if (bestSave) {
      let lowest = enemies[0];
      let lowestBonus = targetSaveBonus(lowest, bestSave.saveAbility);
      for (const e of enemies) {
        const b = targetSaveBonus(e, bestSave.saveAbility);
        if (b < lowestBonus) { lowest = e; lowestBonus = b; }
      }
      return lowest;
    }
    return lowestPick(enemies, c => c.hp, c => c.ac, ctx.rng);
  }
  function pickActionController(me, target, ctx) {
    const actions = availableMonsterActions(me);
    tagActions(actions);
    const scoreTarget = Array.isArray(target) ? target[0] : target;
    const lockdown = bestEvAction(actions, scoreTarget, ctx,
                                  a => a.kind === 'save' && a.condition);
    if (lockdown) return lockdown;
    const saveDmg  = bestEvAction(actions, scoreTarget, ctx,
                                  a => a.kind === 'save');
    if (saveDmg) return saveDmg;
    const ma = actions.find(a => a.kind === 'multiattack');
    if (ma) { ma._ownerActions = actions; return ma; }
    return bestEvAction(actions, scoreTarget, ctx,
                        a => a.kind === 'attack');
  }

  // ── Leader ──
  // Note: healTriage already ran and returned null (no ally to heal).
  function pickTargetLeader(me, all, ctx) {
    return lowestPick(aliveEnemies(me, all), c => c.hp, c => c.ac, ctx.rng);
  }
  function pickActionLeader(me, target, ctx) {
    const actions = availableMonsterActions(me);
    tagActions(actions);
    const saveEffect = bestEvAction(actions, target, ctx, a => a.kind === 'save');
    if (saveEffect) return saveEffect;
    const ma = actions.find(a => a.kind === 'multiattack');
    if (ma) { ma._ownerActions = actions; return ma; }
    return bestEvAction(actions, target, ctx, a => a.kind === 'attack');
  }

  // ── Solo ──
  function pickTargetSolo(me, all, ctx) {
    return lowestPick(aliveEnemies(me, all), c => c.hp, c => c.ac, ctx.rng);
  }
  function pickActionSolo(me, target, ctx) {
    const actions = availableMonsterActions(me);
    tagActions(actions);
    const ma = actions.find(a => a.kind === 'multiattack');
    if (ma) { ma._ownerActions = actions; return ma; }
    // Conservation: in rounds 1-2 with no ally downed, skip (1/Day) actions.
    const allyDowned = ctx.all
      ? ctx.all.some(c => c && c.side === me.side && c !== me && c.downed)
      : false;
    const conserve = ctx.round < 3 && !allyDowned;
    const filter = conserve
      ? (a => a.usesPerDay !== 1 && ['attack','save'].includes(a.kind))
      : (a => ['attack','save'].includes(a.kind));
    const choice = bestEvAction(actions, target, ctx, filter);
    if (choice) return choice;
    // Conservation drained the candidate pool — fall back to any available action.
    return bestEvAction(actions, target, ctx,
                        a => ['attack','save'].includes(a.kind));
  }
```

NOTE on `ctx.all`: the Solo policy needs to check whether an ally is downed. The dispatch in `runTrial` (Task 6) passes `policyCtx` without `all` today. Patch the dispatch to include it:

Find this block in `runTrial` from Task 6:

```js
            const policyCtx = {
              round, rng, tactics,
              livingEnemyCount: aliveEnemies(c, all).length,
            };
```

Replace with:

```js
            const policyCtx = {
              round, rng, tactics,
              livingEnemyCount: aliveEnemies(c, all).length,
              all,
            };
```

- [ ] **Step 5: Extend `ROLE_POLICIES`.** Replace the registry with the full 9-entry version:

```js
  const ROLE_POLICIES = {
    soldier:    { pickTarget: pickTargetSoldier,    pickAction: pickActionSoldier },
    brute:      { pickTarget: pickTargetBrute,      pickAction: pickActionBrute },
    minion:     { pickTarget: pickTargetMinion,     pickAction: pickActionMinion },
    artillery:  { pickTarget: pickTargetArtillery,  pickAction: pickActionArtillery },
    skirmisher: { pickTarget: pickTargetSkirmisher, pickAction: pickActionSkirmisher },
    ambusher:   { pickTarget: pickTargetAmbusher,   pickAction: pickActionAmbusher },
    controller: { pickTarget: pickTargetController, pickAction: pickActionController },
    leader:     { pickTarget: pickTargetLeader,     pickAction: pickActionLeader },
    solo:       { pickTarget: pickTargetSolo,       pickAction: pickActionSolo },
  };
```

- [ ] **Step 6: Run tests — verify all 8 new ones pass and existing tests still pass**

- [ ] **Step 7: Commit**

```bash
git add crucible-engine.js tests/engine.test.html
git commit -m "Crucible engine: Controller, Leader, Solo policies + ctx.all in dispatch"
```

---

### Task 10: Integration scenarios

**Files:**
- Modify: `tests/engine.test.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-rolepolicy-task10"
cp tests/engine.test.html "backups/${TS}-rolepolicy-task10/"
```

- [ ] **Step 2: Append the 4 scenarios inside the last `<script>` block of `tests/engine.test.html`:**

```js
// ─────── Role-policy integration scenarios ───────

function makePcMelee(level, hp, ac, name) {
  return {
    id: 'pm:' + Math.random().toString(36).slice(2,8),
    identity:{ name, level },
    abilities:{ str:16, dex:12, con:14, int:10, wis:10, cha:10 },
    profs:{ saves:{ str:true, con:true } },
    combat:{ hp, maxHp:hp, ac, initBonus:1 },
    actions:[
      { id:'a1', name:'Longsword', source:'weapon', type:'attack',
        atkAbility:'str', atkBonusOverride:null, actionRange:'melee',
        damage:{ dice:'1d8', mod:'+atkAbility', type:'slashing',
                 riderDice:null, riderType:null },
        save:null, heal:null, aoeTargets:0,
        usesPerDay:null, recharge:null, attacksPerAction:1 },
      { id:'a2', name:'Shortsword', source:'weapon', type:'attack',
        atkAbility:'str', atkBonusOverride:null, actionRange:'melee',
        damage:{ dice:'1d6', mod:'+atkAbility', type:'piercing',
                 riderDice:null, riderType:null },
        save:null, heal:null, aoeTargets:0,
        usesPerDay:null, recharge:null, attacksPerAction:1 },
    ],
    tactics:{ aiHint:'focus', resources:'nova' },
  };
}
function makePcRanged(level, hp, ac, name) {
  return {
    id: 'pm:' + Math.random().toString(36).slice(2,8),
    identity:{ name, level },
    abilities:{ str:8, dex:14, con:12, int:16, wis:12, cha:10 },
    profs:{ saves:{ int:true, wis:true } },
    combat:{ hp, maxHp:hp, ac, initBonus:2 },
    actions:[
      { id:'r1', name:'Firebolt', source:'spell', type:'attack',
        atkAbility:'int', atkBonusOverride:null, actionRange:'ranged',
        damage:{ dice:'1d10', mod:'+atkAbility', type:'fire',
                 riderDice:null, riderType:null },
        save:null, heal:null, aoeTargets:0,
        usesPerDay:null, recharge:null, attacksPerAction:1 },
      { id:'r2', name:'Magic Missile', source:'spell', type:'attack',
        atkAbility:'int', atkBonusOverride:99, actionRange:'ranged',
        damage:{ dice:'3d4', mod:3, type:'force',
                 riderDice:null, riderType:null },
        save:null, heal:null, aoeTargets:0,
        usesPerDay:null, recharge:null, attacksPerAction:1 },
    ],
    tactics:{ aiHint:'focus', resources:'nova' },
  };
}
function makeBrute(name, cr, hp, ac) {
  return { name, cr, hp, ac, initiative:1, isMinion:false, isSolo:false,
    fmRole: 'brute',
    parsedActions:[
      { sourceActionName:'Slam', kind:'attack', toHit:6, reach:5,
        damage:[{ dice:'2d8', mod:4, type:'bludgeoning' }],
        recharge:null, usesPerDay:null },
    ] };
}
function makeArtillery(name, cr, hp, ac) {
  return { name, cr, hp, ac, initiative:2, isMinion:false, isSolo:false,
    fmRole: 'artillery',
    parsedActions:[
      { sourceActionName:'Bolt', kind:'attack', toHit:5, range:[80,320],
        damage:[{ dice:'1d10', mod:3, type:'piercing' }],
        recharge:null, usesPerDay:null },
    ] };
}

test('Scenario 6: Brute prefers frontline target', async () => {
  const party = [
    makePcMelee (5, 38, 18, 'Tank'),       // pure melee → frontline
    makePcMelee (5, 36, 17, 'Fighter'),    // pure melee → frontline
    makePcRanged(5, 24, 13, 'Wizard'),     // pure ranged → backline
    makePcRanged(5, 24, 12, 'Sorcerer'),   // pure ranged → backline
  ];
  const r = await Crucible.runSim({ party,
    monsterPicks:[{ pickId:'p1', count:2, monster: makeBrute('Ogre', 2, 60, 14) }],
    trials:200, tactics:{ aiHint:'focus', resources:'nova' }, seed:101 });
  // Brutes should focus the frontline. Sum down-rate of frontline vs backline
  // and assert frontline is hit harder.
  const front = r.perPc.filter(p => p.name === 'Tank' || p.name === 'Fighter');
  const back  = r.perPc.filter(p => p.name === 'Wizard' || p.name === 'Sorcerer');
  const frontDmg = front.reduce((s, p) => s + (p.maxHp - p.avgHpRemaining), 0);
  const backDmg  = back.reduce ((s, p) => s + (p.maxHp - p.avgHpRemaining), 0);
  assertTrue(frontDmg > backDmg * 1.3,
    `Brute should focus frontline; front=${frontDmg.toFixed(1)} back=${backDmg.toFixed(1)}`);
});

test('Scenario 7: Artillery prefers backline target', async () => {
  const party = [
    makePcMelee (5, 38, 18, 'Tank'),
    makePcMelee (5, 36, 17, 'Fighter'),
    makePcRanged(5, 24, 13, 'Wizard'),
    makePcRanged(5, 24, 12, 'Sorcerer'),
  ];
  const r = await Crucible.runSim({ party,
    monsterPicks:[{ pickId:'p1', count:2, monster: makeArtillery('Sniper', 2, 30, 13) }],
    trials:200, tactics:{ aiHint:'focus', resources:'nova' }, seed:103 });
  const front = r.perPc.filter(p => p.name === 'Tank' || p.name === 'Fighter');
  const back  = r.perPc.filter(p => p.name === 'Wizard' || p.name === 'Sorcerer');
  const frontDmg = front.reduce((s, p) => s + (p.maxHp - p.avgHpRemaining), 0);
  const backDmg  = back.reduce ((s, p) => s + (p.maxHp - p.avgHpRemaining), 0);
  assertTrue(backDmg > frontDmg * 1.3,
    `Artillery should focus backline; front=${frontDmg.toFixed(1)} back=${backDmg.toFixed(1)}`);
});

test('Scenario 8: Role override flips Brute → Artillery target distribution', async () => {
  const party = [
    makePcMelee (5, 38, 18, 'Tank'),
    makePcMelee (5, 36, 17, 'Fighter'),
    makePcRanged(5, 24, 13, 'Wizard'),
    makePcRanged(5, 24, 12, 'Sorcerer'),
  ];
  // Take a Brute-tagged monster, override to artillery, re-run.
  const overridden = makeBrute('OverriddenBrute', 2, 60, 14);
  overridden.roleOverride = 'artillery';
  // Give it a ranged attack so the artillery policy has something to pick.
  overridden.parsedActions.push({
    sourceActionName:'Hurl Boulder', kind:'attack', toHit:6, range:[40,120],
    damage:[{ dice:'2d8', mod:4, type:'bludgeoning' }],
    recharge:null, usesPerDay:null,
  });
  const r = await Crucible.runSim({ party,
    monsterPicks:[{ pickId:'p1', count:2, monster: overridden }],
    trials:200, tactics:{ aiHint:'focus', resources:'nova' }, seed:107 });
  const front = r.perPc.filter(p => p.name === 'Tank' || p.name === 'Fighter');
  const back  = r.perPc.filter(p => p.name === 'Wizard' || p.name === 'Sorcerer');
  const frontDmg = front.reduce((s, p) => s + (p.maxHp - p.avgHpRemaining), 0);
  const backDmg  = back.reduce ((s, p) => s + (p.maxHp - p.avgHpRemaining), 0);
  // After override, behavior should flip — backline should now be hit harder.
  assertTrue(backDmg > frontDmg,
    `Override-to-Artillery should focus backline; front=${frontDmg.toFixed(1)} back=${backDmg.toFixed(1)}`);
});

test('Scenario 9: v1 spec scenario 2 still passes (backward compat)', async () => {
  // Re-runs the original FM-standard scenario from Task 18 with Soldier-default monsters.
  // Behavior must match v1 because Soldier policy delegates to existing target/action logic.
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
    'v1 standard-band scenario must still land in [0.5, 0.95] post-upgrade');
});
```

- [ ] **Step 3: Run all tests, including the 5 original spec scenarios + 4 new integration scenarios**

Open `tests/engine.test.html`, click Run. Expected: 9 scenarios in total (1-5 original, 6-9 new). All pass. Some are slow (200 trials each).

- [ ] **Step 4: Commit**

```bash
git add tests/engine.test.html
git commit -m "Crucible engine: integration scenarios for role policies"
```

---

## Phase 3 — PC data model + UI

### Task 11: Add actionRange to default PC action + action-editor dropdown

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-rolepolicy-task11"
cp crucible-dm.html "backups/${TS}-rolepolicy-task11/"
```

- [ ] **Step 2: Update `defaultPC()` to tag the default Longsword as melee.**

Find this block in `crucible-dm.html`:

```js
    actions:  [{ id:'a-' + Math.random().toString(36).slice(2,6),
                 name:'Longsword', source:'weapon', type:'attack',
                 atkAbility:'str', atkBonusOverride:null,
                 damage:{ dice:'1d8', mod:'+atkAbility', type:'slashing',
                          riderDice:null, riderType:null },
                 save:null, heal:null, aoeTargets:0,
                 usesPerDay:null, recharge:null, attacksPerAction:1 }],
```

Replace with:

```js
    actions:  [{ id:'a-' + Math.random().toString(36).slice(2,6),
                 name:'Longsword', source:'weapon', type:'attack',
                 atkAbility:'str', atkBonusOverride:null, actionRange:'melee',
                 damage:{ dice:'1d8', mod:'+atkAbility', type:'slashing',
                          riderDice:null, riderType:null },
                 save:null, heal:null, aoeTargets:0,
                 usesPerDay:null, recharge:null, attacksPerAction:1 }],
```

- [ ] **Step 3: Update `addAction(pmId)` to tag new actions as melee by default.**

Find this block:

```js
  const a = { id:'a-' + Math.random().toString(36).slice(2,6),
              name:'New action', source:'weapon', type:'attack',
              atkAbility:'str', atkBonusOverride:null,
              damage:{ dice:'1d8', mod:'+atkAbility', type:'slashing',
                       riderDice:null, riderType:null },
              save:null, heal:null, aoeTargets:0,
              usesPerDay:null, recharge:null, attacksPerAction:1 };
```

Replace with:

```js
  const a = { id:'a-' + Math.random().toString(36).slice(2,6),
              name:'New action', source:'weapon', type:'attack',
              atkAbility:'str', atkBonusOverride:null, actionRange:'melee',
              damage:{ dice:'1d8', mod:'+atkAbility', type:'slashing',
                       riderDice:null, riderType:null },
              save:null, heal:null, aoeTargets:0,
              usesPerDay:null, recharge:null, attacksPerAction:1 };
```

- [ ] **Step 4: Add the Range dropdown to the action editor.**

Find the top of `renderActionEditor` in `crucible-dm.html`:

```js
  return `
    <div style="padding:0.25rem 0.5rem; background:var(--c-surface);">
      <label>Name <input type="text" value="${escapeHtml(act.name)}"
        oninput="updateAction('${pm.id}','${act.id}','name', this.value)" class="pc-input"></label>
      <label>Type <select onchange="changeActionType('${pm.id}','${act.id}', this.value)">${typeSel}</select></label>
      ${body}
```

Insert a Range dropdown between Name and Type. Replace with:

```js
  const rangeSel = ['melee','ranged','both'].map(t =>
    `<option value="${t}" ${act.actionRange===t?'selected':''}>${t}</option>`).join('');
  return `
    <div style="padding:0.25rem 0.5rem; background:var(--c-surface);">
      <label>Name <input type="text" value="${escapeHtml(act.name)}"
        oninput="updateAction('${pm.id}','${act.id}','name', this.value)" class="pc-input"></label>
      <label>Range
        <select onchange="updateAction('${pm.id}','${act.id}','actionRange', this.value)">${rangeSel}</select>
      </label>
      <label>Type <select onchange="changeActionType('${pm.id}','${act.id}', this.value)">${typeSel}</select></label>
      ${body}
```

- [ ] **Step 5: Manual verify**

Open `crucible-dm.html` in a browser. Add a PC; expand the default Longsword action. The Range dropdown shows; defaults to `melee`. Change to `ranged`; reload — persists.

- [ ] **Step 6: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: actionRange field + per-action Range dropdown"
```

---

### Task 12: Position pill on PC card with cycling override

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-rolepolicy-task12"
cp crucible-dm.html "backups/${TS}-rolepolicy-task12/"
```

- [ ] **Step 2: Add the position-cycling helper near the other PC helpers.**

Find the `updatePC(id, path, value)` function in `crucible-dm.html`. Below it (still inside the main `<script>` block), add:

```js
// Compute a PC's active position bucket using engine helpers (Tasks 4 of the engine).
function pcPositionLabel(pm) {
  if (!pm) return 'frontline';
  const active = (typeof Crucible !== 'undefined' && Crucible.position)
                  ? Crucible.position(pm)
                  : 'frontline';
  const overridden = !!pm.positionOverride;
  return overridden ? `${active} (override)` : active;
}

// Cycle the override state machine: derived → frontline → midline → backline → derived (clear).
function cyclePositionOverride(pmId) {
  const pm = party.find(p => p.id === pmId); if (!pm) return;
  const order = [null, 'frontline', 'midline', 'backline'];
  const cur = pm.positionOverride || null;
  const idx = order.indexOf(cur);
  pm.positionOverride = order[(idx + 1) % order.length];
  saveParty(); renderParty();
}
```

- [ ] **Step 3: Add the pill to the PC card header.**

Find `renderPCCard(pm)`:

```js
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
```

Replace with:

```js
function renderPCCard(pm) {
  const expanded = expandedPC.has(pm.id);
  const summary = `${pm.identity.name} · L${pm.identity.level} · ${pm.combat.hp}HP · AC${pm.combat.ac}`;
  const posLabel = pcPositionLabel(pm);
  const pillColor = pm.positionOverride ? 'var(--c-accent)' : 'var(--c-ink-faint)';
  return `
    <div class="pc-card" style="border:1px solid var(--c-border); border-radius:4px; margin-bottom:0.5rem; padding:0.5rem;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div onclick="togglePC('${pm.id}')" style="cursor:pointer; flex:1;">
          <b>${escapeHtml(summary)}</b>
        </div>
        <span onclick="cyclePositionOverride('${pm.id}'); event.stopPropagation();"
              title="Click to cycle override"
              style="cursor:pointer; font-size:0.7rem; padding:0.15rem 0.5rem;
                     border:1px solid ${pillColor}; color:${pillColor};
                     border-radius:9999px; margin-left:0.5rem; white-space:nowrap;">
          ${escapeHtml(posLabel)}
        </span>
        <span style="color:var(--c-ink-faint); margin-left:0.5rem; cursor:pointer;"
              onclick="togglePC('${pm.id}')">${expanded ? '▾' : '▸'}</span>
      </div>
      ${expanded ? renderPCEditor(pm) : ''}
    </div>`;
}
```

- [ ] **Step 4: Manual verify**

Open `crucible-dm.html`. Add a PC with default actions (melee Longsword); pill reads `frontline`. Click the pill — cycles `frontline → midline → backline → frontline (cleared/derived)`. Override persists across reload.

- [ ] **Step 5: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: position pill on PC card with cycling override"
```

---

## Phase 4 — Monster UI

### Task 13: Role badge on encounter card + role dropdown in override panel

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-rolepolicy-task13"
cp crucible-dm.html "backups/${TS}-rolepolicy-task13/"
```

- [ ] **Step 2: Add a helper to summarize a monster's active role + provenance.**

Insert near the other rendering helpers in `crucible-dm.html` (e.g. just before `renderEncounter`):

```js
// Returns { role, source } where source is 'override' | 'fm' | 'inferred'.
function monsterActiveRole(m) {
  if (!m) return { role: 'soldier', source: 'inferred' };
  if (m.roleOverride) return { role: String(m.roleOverride).toLowerCase(), source: 'override' };
  if (m.fmRole)       return { role: String(m.fmRole).toLowerCase(),       source: 'fm' };
  // Use the engine's resolveRole to populate inferredRole the same way the sim will.
  if (typeof Crucible !== 'undefined' && Crucible.resolveRole) {
    const r = Crucible.resolveRole(m);
    return { role: r, source: m.roleOverride ? 'override' : (m.fmRole ? 'fm' : 'inferred') };
  }
  return { role: 'soldier', source: 'inferred' };
}

function roleBadgeColor(source) {
  if (source === 'override') return 'var(--c-accent)';   // teal
  if (source === 'fm')       return '#b88a5a';            // gold
  return 'var(--c-ink-faint)';                            // slate
}
```

- [ ] **Step 3: Render the role badge in each encounter monster row.**

Find `renderEncounter()` in `crucible-dm.html` — specifically the per-pick row construction. The current row template starts with:

```js
    <div style="border:1px solid var(--c-border); border-radius:4px; padding:0.4rem; margin-bottom:0.4rem;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span><b>${escapeHtml(p.monster.name)}</b>
          <span style="color:var(--c-ink-faint); font-size:0.85em">
            CR ${escapeHtml(String(p.monster.crText || p.monster.cr || '?'))} · HP ${p.monster.hp ?? '?'} · AC ${p.monster.ac ?? '?'}
          </span></span>
```

Replace that opening with a version that appends the role badge:

```js
    <div style="border:1px solid var(--c-border); border-radius:4px; padding:0.4rem; margin-bottom:0.4rem;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span><b>${escapeHtml(p.monster.name)}</b>
          <span style="color:var(--c-ink-faint); font-size:0.85em">
            CR ${escapeHtml(String(p.monster.crText || p.monster.cr || '?'))} · HP ${p.monster.hp ?? '?'} · AC ${p.monster.ac ?? '?'}
          </span>
          ${(() => {
            const info = monsterActiveRole(p.monster);
            const color = roleBadgeColor(info.source);
            return `<span style="margin-left:0.4rem; font-size:0.75em; padding:0.1rem 0.4rem;
                                  border:1px solid ${color}; color:${color}; border-radius:9999px;
                                  text-transform:capitalize;">${escapeHtml(info.role)}</span>`;
          })()}
        </span>
```

- [ ] **Step 4: Add a Role dropdown to the override panel.**

Find `openOverridePanel(pickId)` in `crucible-dm.html`. The modal's inner HTML currently contains a `<div id="override-list">` and a regeneration block. Insert a Role section above the `<div id="override-list">`. Find:

```js
      <div style="flex:1; overflow-y:auto; padding:1rem;">
        <div id="override-list"></div>
        ${m.regeneration ? `
```

Replace with:

```js
      <div style="flex:1; overflow-y:auto; padding:1rem;">
        ${(() => {
          const info = monsterActiveRole(m);
          const opts = ['ambusher','artillery','brute','controller','leader',
                        'skirmisher','soldier','solo','minion']
            .map(r => `<option value="${r}" ${info.role===r?'selected':''}>${r}</option>`).join('');
          return `<div style="margin-bottom:1rem; padding:0.5rem; border:1px solid var(--c-border); border-radius:4px;">
            <b>Role:</b>
            <select onchange="updateRoleOverride('${pickId}', this.value)">${opts}</select>
            <span style="color:var(--c-ink-faint); font-size:0.85em">
              (currently: ${info.source})
            </span>
          </div>`;
        })()}
        <div id="override-list"></div>
        ${m.regeneration ? `
```

- [ ] **Step 5: Add the `updateRoleOverride` handler near `overrideField`:**

```js
function updateRoleOverride(pickId, role) {
  const pick = picks.find(p => p.pickId === pickId); if (!pick) return;
  pick.monster.roleOverride = role;
  // Re-render encounter so the badge updates.
  renderEncounter();
}
```

- [ ] **Step 6: Manual verify**

Open `crucible-dm.html`. Add a PC, pick a monster (e.g. a Goblin from the bestiary). The encounter row shows a role pill (likely "soldier" for a typical Goblin with `inferredRole`). Click "Review parsed actions"; the modal opens with a Role dropdown showing the current role and `(currently: inferred)`. Change to `ambusher`; close modal; the encounter pill updates to "ambusher" with teal color.

- [ ] **Step 7: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: role badge on encounter card + role dropdown in override panel"
```

---

### Task 14: Persist roleOverride via saveOverride

**Files:**
- Modify: `crucible-dm.html`

- [ ] **Step 1: Backup**

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p "backups/${TS}-rolepolicy-task14"
cp crucible-dm.html "backups/${TS}-rolepolicy-task14/"
```

- [ ] **Step 2: Update `saveOverride(pickId)` to include `roleOverride` in the persisted record.**

Find the `overrideRecord` construction in `saveOverride`:

```js
    const overrideRecord = {
      name: m.name, _source: m._source || m.source || '',
      parsedActions: m.parsedActions,
      regeneration: m.regeneration || null,
      overriddenAt: new Date().toISOString(),
    };
```

Replace with:

```js
    const overrideRecord = {
      name: m.name, _source: m._source || m.source || '',
      parsedActions: m.parsedActions,
      regeneration: m.regeneration || null,
      roleOverride: m.roleOverride || null,
      overriddenAt: new Date().toISOString(),
    };
```

- [ ] **Step 3: Ensure `roleOverride` from `bestiary_custom` flows back into the in-memory monster.**

The `loadBestiary()` function spreads `bestiary_custom` entries into the merged list with `...m, _custom: true`. The `roleOverride` field comes along automatically because object spread copies all keys. No code change needed — confirm by code inspection that the spread in `loadBestiary` reads:

```js
for (const m of cust) out.push({ ...m, _source: m.source || m._source || 'custom', _custom: true });
```

If yes, `roleOverride` is preserved on the loaded monster object.

- [ ] **Step 4: Manual verify**

Open `crucible-dm.html`. Pick a monster; open the override panel; set role to `brute`; click "Save to bestiary_custom" — see the success alert. Refresh the page (hard refresh if on Pages — Cmd+Shift+R). Re-pick the same monster; the encounter pill reads `brute` and the override modal shows `(currently: override)`.

- [ ] **Step 5: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: persist roleOverride in bestiary_custom via saveOverride"
```

---

## Phase 5 — Wrap-up

### Task 15: CHANGELOG entry + final manual UI checklist

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add a new Unreleased entry at the top of `CHANGELOG.md`.**

Find the existing `## [Unreleased] — 2026-06-02` line. Below it, insert a new entry as the first item in the Unreleased section:

```markdown
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
  registry. ~25 new test assertions including 4 integration scenarios
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
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "Changelog: monster role policies for The Crucible"
```

---

## Notes for the implementer

- **No build step.** Every file is loaded directly by the browser. The engine is exposed as `window.Crucible`; the UI consumes it from inline scripts in `crucible-dm.html`. Don't introduce a bundler.
- **Tests run in the browser.** Open `tests/engine.test.html` and click Run. The harness was set up in v1; this plan just adds assertions to the existing file. No new test harness, no test runner.
- **Backups before mutating existing files.** Each task starts with a `cp` to `backups/<timestamp>-<desc>/`. Honor this — it's project convention from CLAUDE.md.
- **The Soldier policy is load-bearing.** It's the default for any monster without a recognized role tag. It must delegate exactly to v1 behavior; if it diverges, the backward-compat scenario (Task 10's Scenario 9) will fail.
- **`_ownerActions` on multiattack.** The EV scorer for multiattack needs access to the actor's other actions. Each `pickAction` policy stamps `ma._ownerActions = actions` before returning a multiattack action; the multiattack EV path reads it. This is a deliberate scratch field — don't persist it.
- **Position helpers in the UI vs. engine.** The engine owns `rangedness` / `bucket` / `position`. The UI's `pcPositionLabel(pm)` is a thin wrapper that calls `Crucible.position(pm)`. If you ever extract the engine into a worker, the UI helper is the seam.
- **YAGNI.** Concentration, reactions, advantage/disadvantage, true positioning, spell slots, and PC-side role policies are all explicitly deferred. Don't slip them in — each has its own future spec.

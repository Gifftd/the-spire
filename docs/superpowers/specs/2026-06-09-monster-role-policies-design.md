# Monster role policies — design

**Status:** design approved, awaiting implementation plan
**Date:** 2026-06-09
**Scope:** v1.5 upgrade to The Crucible's monster decision logic. PC behavior unchanged.

## Purpose

Today every monster in The Crucible uses the same heuristic: "focus-fire the lowest-HP enemy with the first available action." That picks plausible targets but obvious wrong actions (a Brute with both a Greatsword and a Heavy Crossbow uses whichever is listed first in its statblock) and ignores party composition (an all-archer party fights a Brute identically to an all-melee party).

This spec replaces that single heuristic with a **role-policy registry**: each monster resolves to a role (Brute / Artillery / Ambusher / …), and each role provides its own `pickTarget` and `pickAction` rules. As a party's composition changes — new class features, magic items, retraining — the simulator continues to model the encounter sensibly without engine edits.

## Goals + non-goals

### In scope

- Per-FM-role decision policies for monsters (target + action picking).
- Role inference for monsters lacking an `fmRole` tag (most of MM-2024 and most homebrew).
- DM override for any monster's role; persisted in `bestiary_custom`.
- Implicit-position approximation for PCs: rangedness score derived from `actionRange` tags, bucketed into `frontline / midline / backline`.
- DM override for PC position bucket.
- Expected-damage scoring (`actionEv`) for use by policies that need to rank actions against a specific target.
- Three small UI additions: per-action `actionRange` dropdown, position pill on PC card, role dropdown in monster override panel.

### Out of scope (future work)

- Concentration tracking.
- Reactions (shield, parry, hellish rebuke, etc.).
- Advantage / disadvantage flags.
- Spell slots as a tracked resource (limited-use already covers gross resource gating).
- True positioning (grids, distance, movement).
- PC-side decision policies (PCs continue to use today's `pickAction`).
- Smarter Controller condition-targeting via PC save-throw weaknesses (a defensible v1.6).
- Coordinated multi-monster tactics (two Brutes don't collude beyond their independent picks).

### Future-proofing

The role-policy registry is the extensibility point. Adding a new role is one new entry. Adding a new action `kind` (e.g. `'reaction'` for the eventual reactions spec) extends `actionEv` and the policies that care; everything else stays still.

## Architecture

A second pass on `crucible-engine.js`'s decision logic. **Additive** — all existing data without the new fields still loads and runs as v1; the default `'soldier'` policy preserves current behavior.

Five new pieces:

1. **A role-policy registry** (`ROLE_POLICIES`) keyed by role name, mapping to `{ pickTarget, pickAction }` pure function pairs.
2. **A `rangedness` derivation** at sim setup, producing a continuous score `0–1` and a bucket label for each PC.
3. **A role-inference helper** (`inferRole`) for monsters lacking `fmRole`.
4. **An expected-damage scorer** (`actionEv`) for ranking actions against a chosen target.
5. **UI additions** in `crucible-dm.html`: action-range dropdown, position pill, role dropdown.

**Persistence:**

- `actionRange` and `positionOverride` go to the existing `localStorage['crucible-party']` (additive fields, no migration).
- `roleOverride` goes to `bestiary_custom` via the existing override-save path.
- No KV schema changes. No worker changes.

## Data model

### PartyMember action gains `actionRange`

```js
// PartyMember.actions[] entry — NEW field:
actionRange: 'melee' | 'ranged' | 'both'    // defaults to 'melee' if absent
```

Surface: a dropdown in the action editor (Task 23 form). Stored in the existing PC localStorage payload.

### PartyMember gains a position override

```js
positionOverride: null | 'frontline' | 'midline' | 'backline'    // defaults null
```

Derived (never stored):

- `rangedActionCount = count(a.actionRange === 'ranged')`
- `bothActionCount = count(a.actionRange === 'both')`
- `totalActionCount = pm.actions.length`
- `rangedness(pm) = (rangedActionCount + 0.5 * bothActionCount) / max(1, totalActionCount)`
- `position(pm) = pm.positionOverride ?? bucket(rangedness(pm))`
- `bucket(r) = r < 0.3 ? 'frontline' : r <= 0.7 ? 'midline' : 'backline'`

A PC with zero actions defaults to `frontline` (the validation gate already blocks runs without actions, so the value only matters for UI rendering).

### Monster gains role provenance

```js
// On the monster record — written by parseAllMonsterActions or set by the override panel:
fmRole:        string | null   // existing — copied from bestiary JSON when present
inferredRole:  string | null   // NEW — populated by inferRole() lazily on first resolveRole()
roleOverride:  string | null   // NEW — set by DM in the override panel; persists in bestiary_custom
```

Active role at sim time:

```js
function resolveRole(monster) {
  if (monster.roleOverride)  return normalizeRole(monster.roleOverride);
  if (monster.fmRole)        return normalizeRole(monster.fmRole);
  if (monster.inferredRole)  return monster.inferredRole;
  monster.inferredRole = inferRole(monster);
  return monster.inferredRole;
}
function normalizeRole(s) {
  const k = String(s).toLowerCase().trim();
  return ROLE_POLICIES[k] ? k : 'soldier';
}
```

### ROLE_POLICIES registry

```js
const ROLE_POLICIES = {
  ambusher:   { pickTarget: pickTargetAmbusher,   pickAction: pickActionAmbusher },
  artillery:  { pickTarget: pickTargetArtillery,  pickAction: pickActionArtillery },
  brute:      { pickTarget: pickTargetBrute,      pickAction: pickActionBrute },
  controller: { pickTarget: pickTargetController, pickAction: pickActionController },
  leader:     { pickTarget: pickTargetLeader,     pickAction: pickActionLeader },
  skirmisher: { pickTarget: pickTargetSkirmisher, pickAction: pickActionSkirmisher },
  soldier:    { pickTarget: pickTargetSoldier,    pickAction: pickActionSoldier },
  solo:       { pickTarget: pickTargetSolo,       pickAction: pickActionSolo },
  minion:     { pickTarget: pickTargetMinion,     pickAction: pickActionMinion },
};
```

Each `pickTarget(me, all, ctx) → combatant | combatant[] | null` and `pickAction(me, target, ctx) → action | null`. Both are pure functions over their arguments. `ctx = { round, rng, tactics }`.

### Per-action runtime tags (scratch fields, not persisted)

Computed during action scoring, lifetime is the current turn:

```js
action._ev          // expected damage against the currently-selected target
action._isMelee     // derived: has `reach` and no `range`
action._isRanged    // derived: has `range`
```

## Policy library

### Shared helpers

```js
function clamp01(x) { return Math.max(0.05, Math.min(0.95, x)); }

function actionIsMelee(action) {
  // For monster ParsedActions: has reach but no range.
  if (action.reach != null && !action.range) return true;
  // For PC actions: explicit tag.
  if (action.actionRange === 'melee') return true;
  return false;
}
function actionIsRanged(action) {
  if (action.range) return true;
  if (action.actionRange === 'ranged') return true;
  return false;
}

function sumDice(dmgList) {
  // Mean of each (dice + mod), summed across components. Untyped components count.
  let total = 0;
  for (const d of (dmgList || [])) {
    const m = String(d.dice || '').match(/^(\d+)d(\d+)$/i);
    if (!m) continue;
    const n = parseInt(m[1], 10), s = parseInt(m[2], 10);
    total += n * (s + 1) / 2 + (Number(d.mod) || 0);
  }
  return total;
}

function targetSaveBonus(target, ability) {
  if (target.side === 'pc' && target.pm) return saveBonus(target.pm, ability);
  const ab = target.monster && target.monster.abilities && target.monster.abilities[ability];
  return ab ? (ab.save != null ? ab.save : ab.mod) : 0;
}

// EV against a specific target.
function actionEv(action, target, ctx) {
  if (action.kind === 'attack') {
    const p = clamp01((21 + (action.toHit || 0) - (target.ac || 10)) / 20);
    const dmg = sumDice(action.damage);
    return p * dmg * 1.05;  // +5% for the crit tail
  }
  if (action.kind === 'save') {
    const sb = targetSaveBonus(target, action.saveAbility);
    const failP = clamp01((action.saveDc - sb - 1) / 20);
    const dmgFail = sumDice(action.damageOnFail);
    const dmgSave = action.halfOnSave ? dmgFail / 2 : 0;
    const targets = Math.min(action.aoeTargets || 1,
                             ctx.livingEnemyCount || 1);
    return targets * (failP * dmgFail + (1 - failP) * dmgSave);
  }
  if (action.kind === 'multiattack') {
    // Sum sub-EVs; each sub-attack picks the same target by approximation.
    const myActions = action._ownerActions || [];
    let sum = 0;
    for (const step of (action.multiattackPlan || [])) {
      const sub = myActions.find(a => (a.sourceActionName || a.name) === step.actionName);
      if (sub) sum += (step.count || 1) * actionEv(sub, target, ctx);
    }
    return sum;
  }
  return 0;
}

function tagActions(actions) {
  for (const a of actions) {
    a._isMelee = actionIsMelee(a);
    a._isRanged = actionIsRanged(a);
  }
}

function bestEvAction(actions, target, ctx, filter) {
  const candidates = filter ? actions.filter(filter) : actions.slice();
  if (!candidates.length) return null;
  for (const a of candidates) a._ev = actionEv(a, target, ctx);
  candidates.sort((a, b) => b._ev - a._ev);
  return candidates[0];
}

function targetsInBucket(all, me, prefBucket, fallbackOrder) {
  const enemies = aliveEnemies(me, all);
  const inBucket = enemies.filter(e => position(e.pm) === prefBucket);
  if (inBucket.length) return inBucket;
  for (const b of fallbackOrder) {
    const f = enemies.filter(e => position(e.pm) === b);
    if (f.length) return f;
  }
  return enemies;
}

function lowestBy(arr, keyFn) {
  if (!arr.length) return null;
  let best = arr[0];
  for (const x of arr) if (keyFn(x) < keyFn(best)) best = x;
  return best;
}
function lowestPick(arr, keyFn, tieKeyFn, rng) {
  const minK = Math.min(...arr.map(keyFn));
  let ties = arr.filter(x => keyFn(x) === minK);
  if (tieKeyFn && ties.length > 1) {
    const minT = Math.min(...ties.map(tieKeyFn));
    ties = ties.filter(x => tieKeyFn(x) === minT);
  }
  return ties[Math.floor(rng() * ties.length)];
}
```

### The nine policies

Each receives the monster's own action list (with tags applied) and consults available actions only.

```js
// ── Ambusher ──
function pickTargetAmbusher(me, all, ctx) {
  return lowestPick(aliveEnemies(me, all), c => c.hp, c => c.ac, ctx.rng);
}
function pickActionAmbusher(me, target, ctx) {
  const actions = availableActions(me);
  tagActions(actions);
  // Round 1: prefer (1/Day) finishers if any.
  if (ctx.round === 1) {
    const finisher = bestEvAction(actions, target, ctx,
                                  a => a.usesPerDay === 1 && a.kind !== 'heal');
    if (finisher) return finisher;
  }
  return bestEvAction(actions, target, ctx,
                      a => ['attack','save','multiattack'].includes(a.kind));
}

// ── Artillery ──
function pickTargetArtillery(me, all, ctx) {
  const candidates = targetsInBucket(all, me, 'backline', ['midline', 'frontline']);
  return lowestPick(candidates, c => c.hp, c => c.ac, ctx.rng);
}
function pickActionArtillery(me, target, ctx) {
  const actions = availableActions(me);
  tagActions(actions);
  const ranged = bestEvAction(actions, target, ctx, a => a._isRanged);
  if (ranged) return ranged;
  // Cornered: any best attack/save.
  return bestEvAction(actions, target, ctx,
                      a => ['attack','save','multiattack'].includes(a.kind));
}

// ── Brute ──
function pickTargetBrute(me, all, ctx) {
  const candidates = targetsInBucket(all, me, 'frontline', ['midline', 'backline']);
  return lowestPick(candidates, c => c.ac, c => c.hp, ctx.rng);
}
function pickActionBrute(me, target, ctx) {
  const actions = availableActions(me);
  tagActions(actions);
  const melee = bestEvAction(actions, target, ctx, a => a._isMelee);
  if (melee) return melee;
  return bestEvAction(actions, target, ctx,
                      a => ['attack','save','multiattack'].includes(a.kind));
}

// ── Controller ──
function pickTargetController(me, all, ctx) {
  const enemies = aliveEnemies(me, all);
  const actions = availableActions(me);
  const aoeSave = actions.find(a => a.kind === 'save' && (a.aoeTargets || 0) >= 2);
  if (aoeSave && enemies.length >= 2) return enemies;   // resolver handles multi-target
  // Single-target save: pick the weakest save bonus vs that ability.
  const bestSave = actions.find(a => a.kind === 'save');
  if (bestSave) {
    return lowestBy(enemies, e => targetSaveBonus(e, bestSave.saveAbility));
  }
  return lowestPick(enemies, c => c.hp, c => c.ac, ctx.rng);
}
function pickActionController(me, target, ctx) {
  const actions = availableActions(me);
  tagActions(actions);
  // Prefer save-with-condition > save-with-damage > attack.
  const lockdown = bestEvAction(actions, Array.isArray(target) ? target[0] : target, ctx,
                                a => a.kind === 'save' && a.condition);
  if (lockdown) return lockdown;
  const saveDmg  = bestEvAction(actions, Array.isArray(target) ? target[0] : target, ctx,
                                a => a.kind === 'save');
  if (saveDmg) return saveDmg;
  return bestEvAction(actions, Array.isArray(target) ? target[0] : target, ctx,
                      a => ['attack','multiattack'].includes(a.kind));
}

// ── Leader ──
// healTriage runs before this policy; reaches here only when no heal triggers.
function pickTargetLeader(me, all, ctx) {
  return lowestPick(aliveEnemies(me, all), c => c.hp, c => c.ac, ctx.rng);
}
function pickActionLeader(me, target, ctx) {
  const actions = availableActions(me);
  tagActions(actions);
  // Buff-save (condition that boosts an ally) — not modeled in v1; treat as no-op for selection.
  // Best save effect (debuff) → best attack.
  const saveEffect = bestEvAction(actions, target, ctx, a => a.kind === 'save');
  if (saveEffect) return saveEffect;
  return bestEvAction(actions, target, ctx,
                      a => ['attack','multiattack'].includes(a.kind));
}

// ── Skirmisher ──
function pickTargetSkirmisher(me, all, ctx) {
  const enemies = aliveEnemies(me, all);
  const actions = availableActions(me);
  const hasRanged = actions.some(a => actionIsRanged(a));
  if (hasRanged) {
    // Pick exposed squishies — highest rangedness, then lowest HP.
    const sorted = enemies.slice().sort((a, b) => {
      const ra = a.side === 'pc' ? rangedness(a.pm) : 0;
      const rb = b.side === 'pc' ? rangedness(b.pm) : 0;
      if (rb !== ra) return rb - ra;
      return a.hp - b.hp;
    });
    return sorted[0];
  }
  return lowestPick(enemies, c => c.hp, c => c.ac, ctx.rng);
}
function pickActionSkirmisher(me, target, ctx) {
  const actions = availableActions(me);
  tagActions(actions);
  const ranged = bestEvAction(actions, target, ctx,
                              a => a._isRanged && a.kind === 'attack');
  if (ranged) return ranged;
  return bestEvAction(actions, target, ctx,
                      a => ['attack','multiattack'].includes(a.kind));
}

// ── Soldier (default) ──
// Equivalent to v1 behavior: matches today's pickAction + pickEnemyTarget.
function pickTargetSoldier(me, all, ctx) {
  return lowestPick(aliveEnemies(me, all), c => c.hp, c => c.ac, ctx.rng);
}
function pickActionSoldier(me, target, ctx) {
  const actions = availableActions(me);
  tagActions(actions);
  // Multiattack first.
  const ma = actions.find(a => a.kind === 'multiattack');
  if (ma) return ma;
  // Limited-resource before at-will.
  const limited = bestEvAction(actions, target, ctx,
                               a => (a.usesPerDay != null || a.recharge) &&
                                    ['attack','save'].includes(a.kind));
  if (limited) return limited;
  // At-will.
  return bestEvAction(actions, target, ctx,
                      a => ['attack','save'].includes(a.kind));
}

// ── Solo ──
// Same target rule as Soldier, but action picking conserves (1/Day) until round ≥ 3
// unless an ally is already downed.
function pickTargetSolo(me, all, ctx) {
  return lowestPick(aliveEnemies(me, all), c => c.hp, c => c.ac, ctx.rng);
}
function pickActionSolo(me, target, ctx) {
  const actions = availableActions(me);
  tagActions(actions);
  const ma = actions.find(a => a.kind === 'multiattack');
  if (ma) return ma;
  const allyDowned = all && all.some(c => c.side === me.side && c.downed);
  const conserve = ctx.round < 3 && !allyDowned;
  const filter = conserve
    ? (a => a.usesPerDay !== 1 && ['attack','save'].includes(a.kind))
    : (a => ['attack','save'].includes(a.kind));
  return bestEvAction(actions, target, ctx, filter);
}

// ── Minion ──
function pickTargetMinion(me, all, ctx) {
  const candidates = targetsInBucket(all, me, 'frontline', ['midline', 'backline']);
  return candidates[0] || null;
}
function pickActionMinion(me, target, ctx) {
  const actions = availableActions(me);
  // First available at-will attack/save — no DPR thinking.
  return actions.find(a => ['attack','save'].includes(a.kind) &&
                           a.usesPerDay == null && !a.recharge) ||
         actions.find(a => ['attack','save'].includes(a.kind)) || null;
}
```

`availableActions(me)` returns the action list (`me.monster.parsedActions` for monsters) filtered through `isAvailable(me, a)`. For multiattack EV computation it stashes the owner's action list on the multiattack action as `_ownerActions` so sub-attacks resolve their EV.

### Role inference

When `fmRole` is null and no override exists, infer:

```js
function inferRole(monster) {
  const acts = monster.parsedActions || [];
  if (!acts.length) return 'soldier';

  const hasHeal      = acts.some(a => a.kind === 'heal');
  const allRanged    = acts.filter(a => a.kind === 'attack').length > 0 &&
                       acts.filter(a => a.kind === 'attack').every(a => actionIsRanged(a));
  const hasControl   = acts.some(a => a.kind === 'save' && a.condition &&
                          ['stunned','paralyzed','restrained','frightened','charmed'].includes(a.condition));
  const hasMulti     = acts.some(a => a.kind === 'multiattack');
  const highHp       = monster.hp >= crHpMedian(monster.cr) * 1.3;
  const hasFinisher  = acts.some(a => a.usesPerDay === 1 && a.kind !== 'heal');

  if (hasHeal)                          return 'leader';
  if (allRanged)                        return 'artillery';
  if (hasControl)                       return 'controller';
  if (highHp && hasMulti)               return 'brute';
  if (hasFinisher && acts.length <= 3)  return 'ambusher';
  return 'soldier';
}
```

`crHpMedian(cr)` is a constant table lookup of median HP per CR (CR 0, 1/8, 1/4, 1/2, then integers up to CR 20+ — roughly 24 entries), sourced from the 2024 DMG monster-CR table.

The inferred role is cached on `monster.inferredRole` on first resolution.

## Round-loop integration

The change to `runTrial` is small. Inside the per-combatant turn dispatch, replace the existing monster branch:

**Before (v1):**

```js
const heal = healTriage(c, all, round);
if (heal) { /* … resolve heal … */ }
else {
  const action = pickAction(c);
  // … target picking via pickEnemyTarget, then resolve …
}
```

**After (v1.5):**

```js
const heal = healTriage(c, all, round);
if (heal) { /* … resolve heal — unchanged … */ }
else if (c.side === 'monster') {
  const role = resolveRole(c.monster);
  const policy = ROLE_POLICIES[role] || ROLE_POLICIES.soldier;
  const ctx = {
    round, rng, tactics,
    livingEnemyCount: aliveEnemies(c, all).length,
  };
  let targets = policy.pickTarget(c, all, ctx);
  if (!targets) continue;
  if (!Array.isArray(targets)) targets = [targets];
  const action = policy.pickAction(c, targets[0], ctx);
  if (!action) continue;
  consumeUse(c, action);
  // Dispatch to existing resolvers based on action.kind, passing targets
  // (the resolveSave branch uses the full array; attack/heal use targets[0]).
} else {
  // PC turn — unchanged from v1: uses today's pickAction + pickEnemyTarget.
  const action = pickAction(c);
  // …
}
```

`pickAction` and `pickEnemyTarget` remain in the engine — `pickActionSoldier` and `pickTargetSoldier` delegate to them so the Soldier policy is a thin wrapper. This preserves v1 behavior for every Soldier-default monster and keeps the existing PC code path intact.

## UI changes

Three small additions to `crucible-dm.html`.

### Action-range dropdown

In the Task 23 action editor (the expanded per-action form), insert below the Name field:

```html
<label>Range
  <select onchange="updateAction('PM_ID','A_ID','actionRange', this.value)">
    <option value="melee">melee</option>
    <option value="ranged">ranged</option>
    <option value="both">both (thrown / versatile)</option>
  </select>
</label>
```

Persisted via existing `updateAction` flow.

### Position pill on PC card

The collapsed PC card header (added in Task 22) gets a small badge to the right of the existing summary:

```
Aria · L5 · 30HP · AC16   [frontline]
```

CSS: a slate-rounded pill with teal text; subtle, non-button-feeling but clickable. Clicking advances the override state machine:

`derived → frontline → midline → backline → derived (cleared)`

Visual: `[frontline]` for derived; `[frontline (override)]` for explicit. Pure HTML/inline-CSS, no new components.

### Role section in monster override panel

The Task 27 modal's body gets a new section above the actions list:

```
┌─────────────────────────────────────────────────┐
│ Role: [ Brute ▾ ]   (currently: inferred)       │
│ Options: ambusher / artillery / brute /         │
│ controller / leader / skirmisher / soldier /    │
│ solo / minion                                   │
└─────────────────────────────────────────────────┘
```

Stored as `roleOverride` on the in-memory monster; persisted into `bestiary_custom` by the existing "Save to bestiary_custom" button — the override-record shape grows one field:

```js
{
  name, _source, parsedActions, regeneration,
  roleOverride,           // NEW
  overriddenAt,
}
```

The "(currently: …)" hint reads `fmRole`, `(inferred)`, or `(override)`.

### Encounter card role badge

The encounter row in Pane B (Task 26 render) appends an active-role pill:

```
Bugbear (CR 1) · HP 27 · AC 16  [Brute]
```

The pill color hints provenance: gold for FM-tagged, slate for inferred, teal for override.

## Testing

### Unit tests (added to `tests/engine.test.html`)

1. **Rangedness derivation** — 5 PC fixtures (all melee → 0; all ranged → 1; 50/50 → 0.5; `both` only → 0.5; empty → 0).
2. **Position override** — `positionOverride` wins; setting `null` restores derived bucket.
3. **Role inference** — 6 monster fixtures, one for each branch of `inferRole`.
4. **`resolveRole`** — 4 fixtures covering `roleOverride` > `fmRole` > `inferredRole` > default `'soldier'`.
5. **`actionEv`** — attack EV decreases monotonically across AC 10 / 18 / 25; save EV with `halfOnSave`; multiattack EV sums sub-EVs.
6. **Policy `pickTarget` per role** — 9 fixtures, one per role, against a known 4-combatant party setup.
7. **Policy `pickAction` per role** — 9 fixtures, one per role, against a known action menu (multiattack, melee, ranged, save+condition, heal, (1/Day) finisher).

### Integration scenarios

Appended to the existing 5 spec scenarios in `tests/engine.test.html`:

- **Scenario 6 — Brute prefers frontline.** 4-PC party (frontline fighter, midline cleric, 2 backline wizards) vs. 2 Brutes. 200 trials. Assert: frontline fighter takes ≥ 60% of attacks against any single PC.
- **Scenario 7 — Artillery prefers backline.** Same party vs. 2 Artillery monsters. Assert: backline wizards collectively take ≥ 60% of damage.
- **Scenario 8 — Role override.** Override a Bugbear from inferred-`brute` to `artillery`; re-run Scenario 6 — assert target distribution flips.
- **Scenario 9 — Backward compat.** Re-run the existing 5 scenarios (1–5) — they use Soldier-default monsters, so behavior must match v1.

### Edge cases pinned

- **PC with zero actions.** Validation gate already blocks runs; UI defaults the pill to `frontline`.
- **All PCs in the same bucket.** Bucket-aware policies fall through to next-bucket; eventually pick from the full enemy set. Sensible.
- **Brute facing a backline-only party.** Targets the most-frontline backliner (highest rangedness within `backline`).
- **Artillery cornered with no ranged actions.** Falls back to highest-EV melee. A soft warning records the role mismatch: *"Artillery monster '<name>' fell back to melee — has no ranged actions."*
- **Controller with no save actions.** Falls through to attack. Soft warning: *"Controller monster '<name>' has no save-effect actions — behaving as Soldier."*
- **Leader with no heals and no buff-saves.** Same fallthrough; same soft-warning shape.
- **Spellcaster monster with all-`Spellcasting` actions.** All actions are `kind:'unparsed'` → `inferRole` returns `soldier`. Validation gate still blocks the run until the DM fills in structured actions; once they do, inference re-evaluates.
- **Solo round-1 nova vs. conserve.** Conserve threshold (`round < 3 && !allyDowned`) is suspended if an ally is already downed in round 1.
- **Override pill cycling.** State machine is `derived → frontline → midline → backline → derived (clear)`. Each click advances; persists across reload.
- **`bestiary_custom` records without `roleOverride`.** Field is absent → `resolveRole` falls through; no migration required.

### Performance check

- `inferRole` runs once per monster, cached on `monster.inferredRole`.
- `actionEv` runs O(actions × turns × trials) ≈ 4 × 25 × 500 ≈ 50K calls per sim — each is a few arithmetic ops on small arrays. Estimated overhead vs. v1: < 100 ms on 500 trials. Within the existing 2s budget.

### Manual UI checklist (post-deploy, appended to existing checklist)

- [ ] Add a PC with one melee + one ranged action → position pill reads `midline`.
- [ ] Click the pill four times → cycles `midline → frontline → midline → backline → midline (cleared)`; persists across reload.
- [ ] Pick a Bugbear → override panel shows "Role: Brute (FM-tagged)" or "(inferred)"; encounter card pill matches.
- [ ] Change role to Artillery → save → reload → role persists in `bestiary_custom`.
- [ ] Run 500 trials, Bugbear-as-Brute vs. mixed party → frontline PC absorbs more attacks than backline.

## Project discipline

- Per CLAUDE.md: snapshot touched files to `backups/<timestamp>-<desc>/` before each batch of edits.
- One CHANGELOG entry per phase, newest at top of Unreleased.
- Worker is **untouched**. No KV schema additions. `bestiary_custom` records gain one optional field (`roleOverride`); absence is tolerated.

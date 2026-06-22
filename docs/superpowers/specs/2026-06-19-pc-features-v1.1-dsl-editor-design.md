# PC Features v1.1 — DSL Editor + Action Granting + Target State

**Status:** Draft
**Date:** 2026-06-19
**Files affected:** `pc-features.js`, `crucible-engine.js`, `crucible-dm.html`, `tests/pc-features.test.html`, `CHANGELOG.md`

## Problem

The v1 PC class features framework shipped with five real gaps that surfaced
in usage:

1. **No `addAction` primitive.** Users wanting Flurry-of-Blows / extra-attack
   abilities can't author them in the DSL — the engine's `actionsAvailable`
   counter can be consumed by features but not granted.

2. **No per-target state in the engine.** Features can't react to whether a
   specific monster has acted yet (e.g., "advantage on attacks against
   unaware targets," surprise damage, ambusher bonuses).

3. **The DSL effect-row editor has no params inputs.** When a DM picks
   `addDamageDice` from the primitive dropdown, the saved effect is
   `params: {}` — the dice value and damage type can't be entered. At sim
   time the primitive runs as a silent no-op. **Critical UX bug** — the
   editor implies a feature was authored but the result does nothing.

4. **No edit-after-save for custom DSL features.** Once saved, a custom
   feature can only be removed and re-authored from scratch. Iteration loop
   is broken.

5. **Built-in features have hidden params that can't be customized.** Hex's
   `damageDice` (`'1d6'` default), Rage's `bonusDamage`, Smite's slot table,
   etc. are all parameterized in code but no UI exposes them. A DM who wants
   "Hunter's Mark with d8" has to edit localStorage by hand.

## Goals

- DSL can express extra-action abilities (Flurry-style, Action-Surge-likes).
- DSL can read per-monster state for target-conditional effects.
- The DSL effect-row editor renders the right inputs for the selected
  primitive — picking `addDamageDice` shows dice + type fields.
- DM can edit a saved DSL feature without re-authoring it.
- DM can override params on built-in features (Hex damage die, Rage bonus,
  etc.) via the same UI mechanism.
- No regressions to v1 features or tests.

## Non-goals

- Spell-casting primitives ("trigger a specific spell"). Spells live on
  `pm.actions[]`, not the feature framework; granting spell-cast effects
  from features is a larger refactor.
- Multi-step conditional logic in the DSL ("if X then A else B"). Stays the
  same as v1 — pick the closest single hook + primitive list.
- Concentration tracking across encounters.
- Cross-PC effects beyond what v1 already supports (`heal`/`applyCondition`
  target='ally' + `dispatchBroadcastHook` for Bardic Inspiration).
- Migration to a different schema. v1.1 is purely additive.

## Design

### 1. `addAction` primitive

New DSL primitive in `pc-features.js#PRIMITIVES`:

```js
addAction: {
  apply(self, hookCtx, params) {
    self.actionsAvailable = (self.actionsAvailable || 0) + (Number(params.amount) || 1);
  },
  paramSchema: [
    { name: 'amount', type: 'int', default: 1, min: 1, max: 5 },
  ],
},
```

The existing `actionsAvailable` field on PC combatants (seeded in
`buildCombatants`) is incremented. The engine's action picker already
consults this counter before letting a PC act again. No engine changes
needed.

A symmetric `addBonusAction` primitive is added at the same time for
completeness:

```js
addBonusAction: {
  apply(self) { self.bonusActionAvailable = true; },
  paramSchema: [],  // no params; always grants 1 bonus action
},
```

### 2. Per-monster `hasAttacked` + target-aware predicates

**Engine change** — `crucible-engine.js`, in `resolveAttackMonster` (where a
monster attacks a PC), set the flag after the attack roll resolves
(regardless of hit/miss — the monster *attempted* to attack):

```js
attacker.hasAttacked = true;
```

The flag is reset between trials because each trial calls `buildCombatants`
fresh.

**New mode predicates** in `pc-features.js#MODE_PREDICATES`:

```js
whenTargetHasntAttacked: (self, ctx, featureId, hookCtx) =>
  !!(hookCtx && hookCtx.target && !hookCtx.target.hasAttacked),
whenTargetIsBloodied: (self, ctx, featureId, hookCtx) =>
  !!(hookCtx && hookCtx.target && hookCtx.target.maxHp > 0 &&
    (hookCtx.target.hp / hookCtx.target.maxHp) < 0.5),
whenTargetIsHostile: (self, ctx, featureId, hookCtx) =>
  !!(hookCtx && hookCtx.target && hookCtx.target.side === 'monster'),
```

**`compileDSL` change** — extend the `when` predicate signature so target-aware
predicates can read `hookCtx`. Current:

```js
if (!whenPred(self, hookCtx.ctx || {}, spec.id)) continue;
```

Updated:

```js
if (!whenPred(self, hookCtx.ctx || {}, spec.id, hookCtx)) continue;
```

Existing predicates (`always`, `whenAnyEnemyAlive`, `whenHpBelowHalf`, etc.)
ignore the 4th arg — backward compatible.

### 3. Per-primitive `paramSchema` + dynamic DSL editor

Each primitive in `PCFeatures.PRIMITIVES` declares its parameter shape:

```js
{ name: 'value', type: 'int', label: 'Amount', default: 1, min: 0, max: 99 }
{ name: 'dice', type: 'string', label: 'Dice', default: '1d6', placeholder: '1d6' }
{ name: 'type', type: 'enum', label: 'Damage type', default: 'force',
  options: ['fire','cold','lightning','thunder','acid','poison','psychic',
            'radiant','necrotic','force','bludgeoning','piercing','slashing'] }
{ name: 'types', type: 'multi-enum', label: 'Damage types', default: [],
  options: [...same as above...] }
{ name: 'target', type: 'enum', label: 'Target', default: 'self',
  options: ['self', 'ally'] }
```

Schema types supported: `int`, `string`, `enum`, `multi-enum`, `boolean`.

**Per-primitive schemas:**

| Primitive | paramSchema |
|---|---|
| `addDamage` | `value:int` |
| `addDamageDice` | `dice:string`, `type:enum(damage types)` |
| `addAcBonus` | `value:int`, `duration:int` *(rounds)* |
| `addResistance` | `types:multi-enum(damage types)` |
| `consumeAction` / `consumeBonusAction` / `consumeReaction` | *(none)* |
| `heal` | `amount:int`, `target:enum(self/ally)` |
| `applyCondition` | `condition:string`, `duration:int`, `target:enum` |
| `decrementUses` | *(none — featureId auto-derived from owning spec)* |
| `flag` | `name:string`, `duration:int` |
| `addAction` | `amount:int` |
| `addBonusAction` | *(none)* |

**DSL effect-row editor** — in `crucible-dm.html`, replace the current
two-dropdown row with a dynamic renderer. After picking a primitive, the
row re-renders to show fields matching that primitive's schema:

```
[onAttackHit ▼] [addDamageDice ▼] dice:[1d6     ] type:[fire ▼] [×]
[onTurnStart  ▼] [consumeBonusAction ▼]                          [×]
[onTakeDamage ▼] [addResistance ▼] types: [fire][cold]           [×]
```

Renderer pattern: `dslRenderEffectRow(eff, i)` reads
`PCFeatures.PRIMITIVES[eff.primitive].paramSchema` and produces an input
for each schema entry. `onchange` mutates `dslEffects[i].params[name] =
value`. No primitive list is hard-coded in the UI — the editor is fully
driven from the schema.

**`dslAddEffect` updated** to initialize `params` from the schema defaults
when a primitive is selected.

**`dslBuildSpec` unchanged** — the effects array already carries `params`,
just with values now.

### 4. Edit-after-save for DSL features

The DSL editor modal grows an "edit existing feature" code path:

- `openDSLEditorForEdit(pmId, featureId)` — finds the feature on the PC
  (must be `source === 'homebrew'`), reads its `_dslSpec`, pre-fills every
  form field including the effects list with all their params.
- On save, replaces the feature in `pm.features[]` at the same array index
  instead of appending. The `_dslSpec` is updated; `featureState` is reset
  (the engine will re-init it on next combat).
- The PC card's feature row gets an `[edit]` button for homebrew features
  (built-in features get a different `[edit params]` button — see next
  section).

UI:
```
☑ Whirling Strike   (homebrew)   [edit] [×]
☑ Rage              (built-in)   [edit params] [×]
```

### 5. Built-in feature param overrides

Built-in features in `pc-features.js#LIBRARY` declare their `paramSchema` —
new field on the feature object. Examples:

- Rage: `bonusDamage:int`, `duration:int`
- Hex: `damageDice:string`, `recastSlots:int`
- Divine Smite: *(no easy editor — slotsByLevel is a per-level table; skip
  v1.1 and leave deriveParams as-is)*
- Bardic Inspiration: `die:enum(d6/d8/d10/d12)`
- Action Surge: `maxUses:int`
- Healing Word: *(slotsByLevel skipped same as Smite)*
- Sneak Attack: `dice:string`
- Shield: `acBonus:int`

Each PC's `pm.features[i].params` already overrides the auto-derived
values; this just exposes editing in the UI.

**"Edit params" inline editor** on built-in feature rows: clicking the
button toggles a small panel showing inputs for each schema field. The
panel writes to `pm.features[i].params` and calls `saveParty()` + targeted
re-render of just the row. The same `dslRenderEffectRow` pattern (or close
cousin) renders the input row.

### 6. Test coverage

`tests/pc-features.test.html` gains new groups:

- `addAction` primitive (3 cases — basic +1, custom amount, no-op when no
  hookCtx)
- `monster.hasAttacked` tracking (2 cases — flag is set on attack, flag
  resets between trials)
- target-aware predicates (3 cases — `whenTargetHasntAttacked` true/false,
  `whenTargetIsBloodied` true/false, `whenTargetIsHostile` true/false)
- `compileDSL` with target-aware `when` (1 case — addDamageDice with
  `when: 'whenTargetHasntAttacked'` fires/doesn't based on flag)
- `paramSchema` declarations (sanity test — every primitive has a valid
  paramSchema; every built-in feature has a valid paramSchema)

Plus integration scenarios:
- "Custom Flurry of Blows feature grants +1 action" (full sim path)
- "Hunter's Mark with d8 damage" (built-in Hex with overridden `damageDice`
  params; verify dmgCtx.bonusDice carries 1d8)

Estimated +15 test cases, bringing the total from 72 to ~87.

### 7. The 14 known-failing v1 tests

These remain as-is in v1.1. They're test-invocation bugs (free-method calls
without `.call(feature, ...)` binding); production through `dispatchHook`
already works. Optional cleanup: refactor those tests to use `.call(...)`
explicitly. **Not gated to v1.1 — can be done in a parallel cleanup PR.**

## Migration

No migration. v1.1 is purely additive:

- New primitives (`addAction`, `addBonusAction`) — old features don't use
  them, so adding them doesn't affect existing data.
- `monster.hasAttacked` — engine adds the flag at runtime; not persisted.
- `paramSchema` on existing primitives — old DSL features with `params:
  {}` continue to work; the new editor would render schema-driven inputs
  for new features but old features' empty params remain valid.
- DSL feature edit — uses the existing `_dslSpec` field already stored on
  homebrew features in v1.
- Built-in `paramSchema` — `pm.features[i].params` was already
  per-PC-overridable in v1; UI just exposes it.

## Out of scope (explicit non-features)

- Custom "trigger a specific spell" primitive (would need access to PC's
  spell list / action list).
- Built-in features whose params are tables (Smite slotsByLevel, Healing
  Word slotsByLevel) — defer to v1.2 if needed.
- The DSL effect order (`hook → primitive`) doesn't change; effects within
  a hook still run in declaration order.
- No new hooks beyond the existing 9.
- No conditional branching in the DSL.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Adding `paramSchema` to every primitive misses one | Low | Sanity test asserts every primitive has a schema |
| Target-aware predicate signature change breaks existing predicates | Low | The 4th arg is optional; existing predicates ignore it |
| DSL editor UI gets crowded with many param fields | Low | One-line per primitive in the worst case; multi-enum collapsed into chips |
| Built-in `paramSchema` declarations diverge from `deriveParams` defaults | Medium | Both must be kept in sync; document as a project convention |
| Edit-after-save UI conflates with new-feature creation | Low | Different button (`[edit]` vs `+ Custom feature...`), pre-fills form |

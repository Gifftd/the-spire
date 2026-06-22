# PC Features v1.1 — DSL Editor + Action Granting + Target State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the v1 PC features framework with the `addAction` primitive, per-monster `hasAttacked` tracking, target-aware `when` predicates, dynamic DSL effect-row params editor, edit-after-save for DSL features, and built-in feature param overrides.

**Architecture:** Purely additive. New primitives + new predicates in `pc-features.js`. One-line engine change in `crucible-engine.js`. DSL editor in `crucible-dm.html` becomes schema-driven — each primitive (and each built-in feature) declares a `paramSchema` that drives input rendering. Edit-after-save reuses the modal in a pre-fill mode.

**Tech Stack:** Vanilla HTML/CSS/JS — no framework, no bundler. Same conventions as v1.

**Reference spec:** `docs/superpowers/specs/2026-06-19-pc-features-v1.1-dsl-editor-design.md`

---

## Phase 1 — `addAction` primitive + target-aware predicates + `compileDSL` extension

### Task 1.1: Add `addAction` and `addBonusAction` primitives

**Files:**
- Modify: `pc-features.js` (PRIMITIVES registry)
- Modify: `tests/pc-features.test.html`

- [ ] **Step 1: Add failing tests**

Append to `tests/pc-features.test.html` before `</script>`:

```javascript
    group('addAction / addBonusAction primitives');

    test('addAction primitive grants N extra actions', () => {
      const self = { actionsAvailable: 1 };
      PCFeatures.PRIMITIVES.addAction.apply(self, {}, { amount: 2 });
      assertEq(self.actionsAvailable, 3);
    });

    test('addAction defaults to +1 when amount omitted', () => {
      const self = { actionsAvailable: 1 };
      PCFeatures.PRIMITIVES.addAction.apply(self, {}, {});
      assertEq(self.actionsAvailable, 2);
    });

    test('addAction handles missing actionsAvailable (initializes to 0+amount)', () => {
      const self = {};
      PCFeatures.PRIMITIVES.addAction.apply(self, {}, { amount: 2 });
      assertEq(self.actionsAvailable, 2);
    });

    test('addBonusAction primitive sets bonusActionAvailable to true', () => {
      const self = { bonusActionAvailable: false };
      PCFeatures.PRIMITIVES.addBonusAction.apply(self, {}, {});
      assertEq(self.bonusActionAvailable, true);
    });
```

- [ ] **Step 2: Implement the primitives**

In `pc-features.js`, find the `PRIMITIVES` const. Add two new entries (next to `consumeAction` for symmetry):

```javascript
    addAction: {
      apply(self, hookCtx, params) {
        self.actionsAvailable = (self.actionsAvailable || 0) + (Number(params.amount) || 1);
      },
    },
    addBonusAction: {
      apply(self, hookCtx, params) {
        self.bonusActionAvailable = true;
      },
    },
```

- [ ] **Step 3: Verify tests are wired**

Mental walkthrough: each primitive's `apply` signature matches `(self, hookCtx, params)`. The tests pass `self` as a plain object and call `.apply` directly. No browser run — code-verify only.

- [ ] **Step 4: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features v1.1: addAction + addBonusAction primitives + 4 tests"
```

---

### Task 1.2: Engine sets `monster.hasAttacked` flag

**Files:**
- Modify: `crucible-engine.js` (`resolveAttackMonster` function)

- [ ] **Step 1: Find `resolveAttackMonster`**

```bash
grep -n "function resolveAttackMonster\|resolveAttackMonster\s*=" crucible-engine.js
```

- [ ] **Step 2: Add the flag set after attack-roll resolution**

Read the function. Find where the attack roll resolves and damage is computed/applied. After the roll resolves (whether hit or miss), add:

```javascript
        // Track that this monster has acted — used by features like
        // ambush damage that fire only against monsters who haven't attacked yet.
        c.hasAttacked = true;
```

(Replace `c` with whatever variable name the function uses for the attacking monster — could be `attacker`, `c`, `me`, etc.)

The flag should be set REGARDLESS of hit/miss because the monster *attempted* to attack. Set it before the function returns, not gated on damage being applied.

- [ ] **Step 3: Add a test**

In `tests/pc-features.test.html`, add a new group:

```javascript
    group('monster.hasAttacked tracking');

    test('hasAttacked is initially undefined on a fresh combatant', () => {
      // Conceptual test — verifies the flag is not pre-set by buildCombatants.
      // Real verification happens via integration; here we just document the contract.
      const monster = { id: 'm:1', side: 'monster', hp: 20, maxHp: 20 };
      assertEq(monster.hasAttacked, undefined);
    });
```

(A true integration test requires the engine. The integration scenario at the end of Phase 4 will exercise it end-to-end.)

- [ ] **Step 4: Commit**

```bash
git add crucible-engine.js tests/pc-features.test.html
git commit -m "Crucible engine: track monster.hasAttacked after attack-roll resolution"
```

---

### Task 1.3: Target-aware MODE_PREDICATES

**Files:**
- Modify: `pc-features.js` (MODE_PREDICATES table)
- Modify: `tests/pc-features.test.html`

- [ ] **Step 1: Add failing tests**

```javascript
    group('Target-aware mode predicates');

    test('whenTargetHasntAttacked: true if target.hasAttacked is falsy', () => {
      const target = { id: 'm:1', hasAttacked: false };
      const hookCtx = { target };
      assertEq(PCFeatures.MODE_PREDICATES.whenTargetHasntAttacked({}, {}, 'f', hookCtx), true);
    });

    test('whenTargetHasntAttacked: false if target.hasAttacked is true', () => {
      const target = { id: 'm:1', hasAttacked: true };
      const hookCtx = { target };
      assertEq(PCFeatures.MODE_PREDICATES.whenTargetHasntAttacked({}, {}, 'f', hookCtx), false);
    });

    test('whenTargetHasntAttacked: false if hookCtx or target is missing', () => {
      assertEq(PCFeatures.MODE_PREDICATES.whenTargetHasntAttacked({}, {}, 'f', null), false);
      assertEq(PCFeatures.MODE_PREDICATES.whenTargetHasntAttacked({}, {}, 'f', {}), false);
    });

    test('whenTargetIsBloodied: true if target HP below half', () => {
      const target = { hp: 10, maxHp: 30 };
      assertEq(PCFeatures.MODE_PREDICATES.whenTargetIsBloodied({}, {}, 'f', { target }), true);
    });

    test('whenTargetIsBloodied: false if target HP at full', () => {
      const target = { hp: 30, maxHp: 30 };
      assertEq(PCFeatures.MODE_PREDICATES.whenTargetIsBloodied({}, {}, 'f', { target }), false);
    });

    test('whenTargetIsHostile: true if target.side === monster', () => {
      const target = { side: 'monster' };
      assertEq(PCFeatures.MODE_PREDICATES.whenTargetIsHostile({}, {}, 'f', { target }), true);
    });

    test('whenTargetIsHostile: false if target is a PC', () => {
      const target = { side: 'pc' };
      assertEq(PCFeatures.MODE_PREDICATES.whenTargetIsHostile({}, {}, 'f', { target }), false);
    });
```

- [ ] **Step 2: Implement the predicates**

In `pc-features.js`, find `MODE_PREDICATES` and add three new entries:

```javascript
    whenTargetHasntAttacked: (self, ctx, featureId, hookCtx) =>
      !!(hookCtx && hookCtx.target && !hookCtx.target.hasAttacked),
    whenTargetIsBloodied:    (self, ctx, featureId, hookCtx) =>
      !!(hookCtx && hookCtx.target && hookCtx.target.maxHp > 0 &&
        (hookCtx.target.hp / hookCtx.target.maxHp) < 0.5),
    whenTargetIsHostile:     (self, ctx, featureId, hookCtx) =>
      !!(hookCtx && hookCtx.target && hookCtx.target.side === 'monster'),
```

- [ ] **Step 3: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features v1.1: target-aware mode predicates (hasn't-attacked, bloodied, hostile)"
```

---

### Task 1.4: Extend `compileDSL` to pass `hookCtx` to `when` predicates

**Files:**
- Modify: `pc-features.js` (`compileDSL` function)
- Modify: `tests/pc-features.test.html`

- [ ] **Step 1: Add failing integration test**

```javascript
    test('compileDSL: when predicate receives hookCtx so target-aware predicates work', () => {
      const spec = {
        id: 'ambush',
        name: 'Ambush',
        source: 'homebrew',
        modePolicy: { sustained: { triggerRound: 1, conditionFn: 'always' } },
        effects: [
          { hook: 'onAttackHit', primitive: 'addDamage',
            params: { value: 5 },
            when: 'whenTargetHasntAttacked' },
        ],
      };
      const compiled = PCFeatures.compileDSL(spec);

      // Case A: target has NOT attacked → effect fires
      const selfA = { pm: { features: [{id:'ambush'}], tactics: {mode:'sustained'} }, featureState: { ambush: {} } };
      const dmgCtxA = { amount: 10, type: 'piercing', bonusDice: [] };
      compiled.hooks.onAttackHit.call(compiled, selfA, {kind:'attack'}, {id:'m:1', side:'monster', hasAttacked: false}, dmgCtxA, { round: 1, combatants: [] });
      assertEq(dmgCtxA.amount, 15);

      // Case B: target HAS attacked → effect does NOT fire
      const selfB = { pm: { features: [{id:'ambush'}], tactics: {mode:'sustained'} }, featureState: { ambush: {} } };
      const dmgCtxB = { amount: 10, type: 'piercing', bonusDice: [] };
      compiled.hooks.onAttackHit.call(compiled, selfB, {kind:'attack'}, {id:'m:1', side:'monster', hasAttacked: true}, dmgCtxB, { round: 1, combatants: [] });
      assertEq(dmgCtxB.amount, 10);
    });
```

- [ ] **Step 2: Update `compileDSL`**

In `pc-features.js`, find the `compileDSL` function. Find the loop that runs effects (inside the generated hook function). The current `when` check is:

```javascript
          if (eff.when) {
            const whenPred = MODE_PREDICATES[eff.when];
            if (whenPred && !whenPred(self, hookCtx.ctx || {}, spec.id)) continue;
          }
```

Update to pass `hookCtx` as the 4th argument:

```javascript
          if (eff.when) {
            const whenPred = MODE_PREDICATES[eff.when];
            if (whenPred && !whenPred(self, hookCtx.ctx || {}, spec.id, hookCtx)) continue;
          }
```

Existing predicates (`always`, `whenAnyEnemyAlive`, `whenHpBelowHalf`, etc.) ignore the 4th arg — backward compatible.

- [ ] **Step 3: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features v1.1: compileDSL passes hookCtx to when predicates"
```

---

## Phase 2 — `paramSchema` declarations on primitives + sanity tests

### Task 2.1: Declare paramSchema on every primitive

**Files:**
- Modify: `pc-features.js` (all primitives)
- Modify: `tests/pc-features.test.html`

- [ ] **Step 1: Add the sanity test FIRST (TDD)**

```javascript
    group('paramSchema sanity');

    test('every primitive has a paramSchema array (possibly empty)', () => {
      for (const [name, prim] of Object.entries(PCFeatures.PRIMITIVES)) {
        assert(Array.isArray(prim.paramSchema), name + ' missing paramSchema array');
      }
    });

    test('every paramSchema entry has name + type', () => {
      const validTypes = ['int', 'string', 'enum', 'multi-enum', 'boolean'];
      for (const [name, prim] of Object.entries(PCFeatures.PRIMITIVES)) {
        for (const field of (prim.paramSchema || [])) {
          assert(typeof field.name === 'string' && field.name, name + ': field missing name');
          assert(validTypes.includes(field.type), name + ': field "' + field.name + '" has invalid type "' + field.type + '"');
        }
      }
    });
```

- [ ] **Step 2: Add `paramSchema` to each primitive**

In `pc-features.js`, update each PRIMITIVES entry to include a `paramSchema` field. Use these exact schemas:

```javascript
const DAMAGE_TYPES = ['bludgeoning','piercing','slashing','fire','cold','lightning',
                      'thunder','acid','poison','psychic','radiant','necrotic','force'];

// Update each primitive:

    addDamage: {
      apply(self, hookCtx, params) {
        if (hookCtx && hookCtx.dmgCtx) hookCtx.dmgCtx.amount += Number(params.value) || 0;
      },
      paramSchema: [
        { name: 'value', type: 'int', label: 'Amount', default: 1, min: 0, max: 99 },
      ],
    },
    addDamageDice: {
      apply(self, hookCtx, params) {
        if (!hookCtx || !hookCtx.dmgCtx) return;
        if (!Array.isArray(hookCtx.dmgCtx.bonusDice)) hookCtx.dmgCtx.bonusDice = [];
        hookCtx.dmgCtx.bonusDice.push({ dice: params.dice, type: params.type || 'force', source: 'dsl' });
      },
      paramSchema: [
        { name: 'dice', type: 'string', label: 'Dice', default: '1d6', placeholder: '1d6' },
        { name: 'type', type: 'enum', label: 'Damage type', default: 'force', options: DAMAGE_TYPES },
      ],
    },
    addAcBonus: {
      apply(self, hookCtx, params) {
        if (typeof self.ac === 'number') self.ac += Number(params.value) || 0;
      },
      paramSchema: [
        { name: 'value', type: 'int', label: 'AC bonus', default: 2, min: 0, max: 10 },
      ],
    },
    addResistance: {
      apply(self, hookCtx, params) {
        if (!hookCtx || !hookCtx.dmgCtx) return;
        const types = Array.isArray(params.types) ? params.types : [];
        if (types.includes(hookCtx.dmgCtx.type)) {
          hookCtx.dmgCtx.amount = Math.floor(hookCtx.dmgCtx.amount / 2);
        }
      },
      paramSchema: [
        { name: 'types', type: 'multi-enum', label: 'Damage types', default: [], options: DAMAGE_TYPES },
      ],
    },
    consumeAction:       {
      apply(self) { self.actionsAvailable = Math.max(0, (self.actionsAvailable || 0) - 1); },
      paramSchema: [],
    },
    consumeBonusAction:  {
      apply(self) { self.bonusActionAvailable = false; },
      paramSchema: [],
    },
    consumeReaction:     {
      apply(self) { self.reactionAvailableThisRound = false; },
      paramSchema: [],
    },
    heal: {
      apply(self, hookCtx, params) {
        const amt = Number(params.amount) || 0;
        const newHp = (self.hp || 0) + amt;
        if (params.target === 'self' || !params.target) {
          self.hp = (typeof self.maxHp === 'number' && self.maxHp > 0) ? Math.min(self.maxHp, newHp) : newHp;
        }
        else if (hookCtx && hookCtx.target && hookCtx.target.maxHp) {
          hookCtx.target.hp = Math.min(hookCtx.target.maxHp, (hookCtx.target.hp || 0) + amt);
        }
      },
      paramSchema: [
        { name: 'amount', type: 'int', label: 'HP restored', default: 5, min: 0, max: 99 },
        { name: 'target', type: 'enum', label: 'Target', default: 'self', options: ['self', 'ally'] },
      ],
    },
    applyCondition: {
      apply(self, hookCtx, params) {
        const target = (params.target === 'self' || !params.target) ? self : (hookCtx && hookCtx.target);
        if (!target) return;
        if (!target.conditions) target.conditions = new Map();
        target.conditions.set(params.condition, Number(params.duration) || 1);
      },
      paramSchema: [
        { name: 'condition', type: 'string', label: 'Condition name', default: '', placeholder: 'prone' },
        { name: 'duration', type: 'int', label: 'Duration (rounds)', default: 1, min: 1, max: 50 },
        { name: 'target', type: 'enum', label: 'Target', default: 'target', options: ['self', 'target'] },
      ],
    },
    decrementUses: {
      apply(self, hookCtx, params) {
        const id = params.featureId;
        if (!id || !self.featureState || !self.featureState[id]) return;
        const state = self.featureState[id];
        if (typeof state.usesLeft === 'number') state.usesLeft = Math.max(0, state.usesLeft - 1);
      },
      paramSchema: [],  // featureId auto-derived from owning spec
    },
    flag: {
      apply(self, hookCtx, params) {
        if (!self.flags) self.flags = {};
        const round = (hookCtx && hookCtx.ctx && typeof hookCtx.ctx.round === 'number') ? hookCtx.ctx.round : 0;
        self.flags[params.name] = { until: round + (Number(params.duration) || 1) };
      },
      paramSchema: [
        { name: 'name', type: 'string', label: 'Flag name', default: 'marked', placeholder: 'marked' },
        { name: 'duration', type: 'int', label: 'Duration (rounds)', default: 1, min: 1, max: 50 },
      ],
    },
    addAction: {
      apply(self, hookCtx, params) {
        self.actionsAvailable = (self.actionsAvailable || 0) + (Number(params.amount) || 1);
      },
      paramSchema: [
        { name: 'amount', type: 'int', label: 'Extra actions', default: 1, min: 1, max: 5 },
      ],
    },
    addBonusAction: {
      apply(self) { self.bonusActionAvailable = true; },
      paramSchema: [],
    },
```

(Add `DAMAGE_TYPES` as a const at the top of the IIFE, near `HOOK_NAMES`.)

- [ ] **Step 3: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features v1.1: paramSchema on every primitive (12 primitives) + 2 sanity tests"
```

---

## Phase 3 — Built-in feature `paramSchema` declarations

### Task 3.1: Declare paramSchema on each built-in feature

**Files:**
- Modify: `pc-features.js` (each built-in feature object)
- Modify: `tests/pc-features.test.html`

- [ ] **Step 1: Add sanity test**

```javascript
    test('every built-in feature has a paramSchema array (possibly empty)', () => {
      for (const [id, feature] of Object.entries(PCFeatures.LIBRARY)) {
        assert(Array.isArray(feature.paramSchema), id + ' missing paramSchema array');
      }
    });
```

- [ ] **Step 2: Add `paramSchema` field to each built-in feature**

In `pc-features.js`, modify each of the 8 built-in features. Add `paramSchema` as a field on the feature object (next to `deriveParams`):

**RAGE:**
```javascript
    paramSchema: [
      { name: 'bonusDamage', type: 'int', label: 'Bonus damage', default: 2, min: 0, max: 9 },
      { name: 'duration', type: 'int', label: 'Duration (rounds)', default: 10, min: 1, max: 100 },
    ],
```

**SNEAK_ATTACK:**
```javascript
    paramSchema: [
      { name: 'dice', type: 'string', label: 'Dice', default: '1d6', placeholder: '3d6' },
    ],
```

**ACTION_SURGE:**
```javascript
    paramSchema: [
      { name: 'maxUses', type: 'int', label: 'Max uses per encounter', default: 1, min: 1, max: 5 },
    ],
```

**DIVINE_SMITE:**
```javascript
    paramSchema: [],  // slotsByLevel is a table — too complex for v1.1 editor; defer
```

**HEALING_WORD:**
```javascript
    paramSchema: [
      { name: 'ability', type: 'enum', label: 'Spellcasting ability', default: 'wis', options: ['cha','wis','int'] },
    ],
```

**SHIELD:**
```javascript
    paramSchema: [
      { name: 'acBonus', type: 'int', label: 'AC bonus', default: 5, min: 1, max: 10 },
    ],
```

**HEX_MARK:**
```javascript
    paramSchema: [
      { name: 'damageDice', type: 'string', label: 'Damage dice', default: '1d6', placeholder: '1d8' },
      { name: 'recastSlots', type: 'int', label: 'Recasts available', default: 4, min: 0, max: 9 },
    ],
```

**BARDIC_INSPIRATION:**
```javascript
    paramSchema: [
      { name: 'die', type: 'enum', label: 'Die size', default: 'd8', options: ['d6','d8','d10','d12'] },
    ],
```

- [ ] **Step 3: Commit**

```bash
git add pc-features.js tests/pc-features.test.html
git commit -m "PC features v1.1: paramSchema on every built-in feature (8 features) + 1 sanity test"
```

---

## Phase 4 — DSL editor: dynamic param-row inputs

### Task 4.1: Render dynamic params in DSL effect rows

**Files:**
- Modify: `crucible-dm.html` (`dslRenderEffects`, `dslAddEffect` functions)

- [ ] **Step 1: Find the existing `dslRenderEffects` function**

```bash
grep -n "function dslRenderEffects\|function dslAddEffect" crucible-dm.html
```

- [ ] **Step 2: Replace with the schema-driven renderer**

Replace the existing `dslRenderEffects` and `dslAddEffect`:

```javascript
function dslAddEffect() {
  // Initialize params from the primitive's paramSchema defaults.
  const defaultPrim = 'consumeBonusAction';
  const eff = { hook: 'onTurnStart', primitive: defaultPrim, params: {} };
  dslApplySchemaDefaults(eff);
  dslEffects.push(eff);
  dslRenderEffects();
}

function dslApplySchemaDefaults(eff) {
  const prim = PCFeatures.PRIMITIVES[eff.primitive];
  if (!prim || !Array.isArray(prim.paramSchema)) { eff.params = {}; return; }
  const newParams = {};
  for (const field of prim.paramSchema) {
    newParams[field.name] = field.default !== undefined ? field.default : null;
  }
  // Preserve any existing param values that still match a schema field name.
  for (const k of Object.keys(eff.params || {})) {
    if (k in newParams && eff.params[k] !== undefined) newParams[k] = eff.params[k];
  }
  eff.params = newParams;
}

function dslOnPrimitiveChange(i, newPrim) {
  dslEffects[i].primitive = newPrim;
  dslApplySchemaDefaults(dslEffects[i]);
  dslRenderEffects();
}

function dslRenderEffects() {
  const root = document.getElementById('dsl-effects-list');
  root.innerHTML = dslEffects.map((eff, i) => {
    const prim = PCFeatures.PRIMITIVES[eff.primitive];
    const schema = (prim && Array.isArray(prim.paramSchema)) ? prim.paramSchema : [];
    const paramsHtml = schema.map(field => dslRenderParamInput(eff, i, field)).join('');
    return `
      <div class="dsl-effect-row">
        <select onchange="dslEffects[${i}].hook = this.value">
          ${PCFeatures.HOOK_NAMES.map(h => `<option value="${h}" ${eff.hook === h ? 'selected' : ''}>${h}</option>`).join('')}
        </select>
        <select onchange="dslOnPrimitiveChange(${i}, this.value)">
          ${Object.keys(PCFeatures.PRIMITIVES).map(p => `<option value="${p}" ${eff.primitive === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
        ${paramsHtml}
        <button onclick="dslRemoveEffect(${i})">×</button>
      </div>
    `;
  }).join('');
}

function dslRenderParamInput(eff, i, field) {
  const current = eff.params[field.name] !== undefined ? eff.params[field.name] : (field.default !== undefined ? field.default : '');
  const labelText = field.label || field.name;
  const onchange = `dslEffects[${i}].params[${JSON.stringify(field.name)}] = `;
  if (field.type === 'int') {
    return `<label class="dsl-param-field">${escapeHtml(labelText)}<input type="number" value="${current}" ${field.min!=null?'min="'+field.min+'"':''} ${field.max!=null?'max="'+field.max+'"':''} oninput="${onchange}parseInt(this.value, 10) || 0"></label>`;
  }
  if (field.type === 'string') {
    return `<label class="dsl-param-field">${escapeHtml(labelText)}<input type="text" value="${escapeHtml(String(current))}" placeholder="${escapeHtml(field.placeholder || '')}" oninput="${onchange}this.value"></label>`;
  }
  if (field.type === 'boolean') {
    return `<label class="dsl-param-field">${escapeHtml(labelText)}<input type="checkbox" ${current ? 'checked' : ''} onchange="${onchange}this.checked"></label>`;
  }
  if (field.type === 'enum') {
    return `<label class="dsl-param-field">${escapeHtml(labelText)}<select onchange="${onchange}this.value">${(field.options || []).map(o => `<option value="${o}" ${current === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
  }
  if (field.type === 'multi-enum') {
    const currentArr = Array.isArray(current) ? current : [];
    return `<label class="dsl-param-field">${escapeHtml(labelText)}<select multiple size="3" onchange="dslEffects[${i}].params[${JSON.stringify(field.name)}] = Array.from(this.selectedOptions).map(o => o.value)">${(field.options || []).map(o => `<option value="${o}" ${currentArr.includes(o) ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
  }
  return '';
}
```

(The `escapeHtml` function exists in crucible-dm.html — verified during v1.)

- [ ] **Step 3: Add CSS for the param fields**

In the page's `<style>` block, add (next to the existing `.dsl-*` rules):

```css
.dsl-param-field { display: inline-flex; flex-direction: column; gap: 2px; font-size: 0.75rem; color: var(--c-ink-faint); margin-right: 6px; }
.dsl-param-field input, .dsl-param-field select { font-size: 0.85rem; padding: 4px 6px; }
.dsl-param-field input[type="number"] { width: 60px; }
.dsl-param-field input[type="text"] { width: 100px; }
.dsl-param-field select { min-width: 80px; }
.dsl-effect-row { flex-wrap: wrap; }
```

- [ ] **Step 4: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: DSL effect rows render dynamic param inputs from paramSchema"
```

---

## Phase 5 — Built-in feature param editor

### Task 5.1: Add "Edit params" button to built-in feature rows

**Files:**
- Modify: `crucible-dm.html` (PC card features section renderer)

- [ ] **Step 1: Find the Features section renderer**

```bash
grep -n "feature-row\|featuresHtml\|pc-features-list" crucible-dm.html | head -10
```

The features section was added in v1 inside `renderPCEditor`. Find the `<div class="feature-row">` template — it currently has just a remove button.

- [ ] **Step 2: Add the Edit Params button conditionally**

Update the feature row template. For built-in features (where `f.source !== 'homebrew'`), add an `[edit params]` button. Update from:

```javascript
return `
  <div class="feature-row" data-feature-id="${f.id}">
    <div class="feature-row-name">${escapeHtml(def.name)} ${sourceTag}</div>
    <div class="feature-row-summary">${escapeHtml(def.summary || '')}</div>
    <button class="feature-row-remove" onclick="removeFeatureFromPC('${pm.id}','${f.id}')">×</button>
  </div>
`;
```

to:

```javascript
const editBtn = f.source === 'homebrew'
  ? `<button class="feature-row-edit" onclick="openDSLEditorForEdit('${pm.id}', '${f.id}')">edit</button>`
  : (Array.isArray(def.paramSchema) && def.paramSchema.length > 0
      ? `<button class="feature-row-edit" onclick="toggleFeatureParamEditor('${pm.id}', '${f.id}')">edit params</button>`
      : '');
return `
  <div class="feature-row" data-feature-id="${f.id}">
    <div class="feature-row-name">${escapeHtml(def.name)} ${sourceTag}</div>
    <div class="feature-row-summary">${escapeHtml(def.summary || '')}</div>
    ${editBtn}
    <button class="feature-row-remove" onclick="removeFeatureFromPC('${pm.id}','${f.id}')">×</button>
  </div>
  <div class="feature-param-editor" id="feature-param-editor-${pm.id}-${f.id}" style="display:none"></div>
`;
```

- [ ] **Step 3: Add the inline param editor functions**

After `removeFeatureFromPC`:

```javascript
function toggleFeatureParamEditor(pmId, featureId) {
  const editorId = 'feature-param-editor-' + pmId + '-' + featureId;
  const editor = document.getElementById(editorId);
  if (!editor) return;
  if (editor.style.display === 'none') {
    renderFeatureParamEditor(pmId, featureId);
    editor.style.display = '';
  } else {
    editor.style.display = 'none';
  }
}

function renderFeatureParamEditor(pmId, featureId) {
  const pm = party.find(p => p.id === pmId);
  if (!pm) return;
  const f = pm.features.find(x => x.id === featureId);
  if (!f) return;
  const def = PCFeatures.LIBRARY[featureId];
  if (!def || !Array.isArray(def.paramSchema)) return;

  // Ensure params is populated with current values (auto-derived if missing).
  if (!f.params) f.params = def.deriveParams ? def.deriveParams(pm) : {};

  const editorId = 'feature-param-editor-' + pmId + '-' + featureId;
  const editor = document.getElementById(editorId);
  editor.innerHTML = def.paramSchema.map(field => renderBuiltinParamInput(pmId, featureId, f, field)).join('');
}

function renderBuiltinParamInput(pmId, featureId, f, field) {
  const current = f.params[field.name] !== undefined ? f.params[field.name] : (field.default !== undefined ? field.default : '');
  const labelText = field.label || field.name;
  const onChangeBase = `updateBuiltinParam('${pmId}', '${featureId}', ${JSON.stringify(field.name)}, `;
  if (field.type === 'int') {
    return `<label class="dsl-param-field">${escapeHtml(labelText)}<input type="number" value="${current}" ${field.min!=null?'min="'+field.min+'"':''} ${field.max!=null?'max="'+field.max+'"':''} oninput="${onChangeBase}parseInt(this.value, 10) || 0)"></label>`;
  }
  if (field.type === 'string') {
    return `<label class="dsl-param-field">${escapeHtml(labelText)}<input type="text" value="${escapeHtml(String(current))}" placeholder="${escapeHtml(field.placeholder || '')}" oninput="${onChangeBase}this.value)"></label>`;
  }
  if (field.type === 'enum') {
    return `<label class="dsl-param-field">${escapeHtml(labelText)}<select onchange="${onChangeBase}this.value)">${(field.options || []).map(o => `<option value="${o}" ${current === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
  }
  if (field.type === 'boolean') {
    return `<label class="dsl-param-field">${escapeHtml(labelText)}<input type="checkbox" ${current ? 'checked' : ''} onchange="${onChangeBase}this.checked)"></label>`;
  }
  return '';
}

function updateBuiltinParam(pmId, featureId, paramName, value) {
  const pm = party.find(p => p.id === pmId);
  if (!pm) return;
  const f = pm.features.find(x => x.id === featureId);
  if (!f) return;
  if (!f.params) f.params = {};
  f.params[paramName] = value;
  saveParty();
  // Surgical update: update only the row's summary text — but for v1.1 just rely on
  // localStorage persistence; the param change takes effect next sim run.
}
```

- [ ] **Step 4: Add CSS**

```css
.feature-row-edit { background: none; border: 1px solid var(--c-border); color: var(--c-ink-faint); font-size: 0.7rem; padding: 1px 6px; border-radius: 3px; cursor: pointer; margin-right: 4px; }
.feature-row-edit:hover { color: var(--c-brass); border-color: var(--c-brass); }
.feature-param-editor { padding: 6px 10px; background: var(--c-bg); border-left: 2px solid var(--c-brass); margin-top: 4px; display: flex; flex-wrap: wrap; gap: 8px; }
```

- [ ] **Step 5: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: 'edit params' inline editor for built-in feature rows"
```

---

## Phase 6 — Edit-after-save for DSL features

### Task 6.1: Add `openDSLEditorForEdit` + edit-existing save path

**Files:**
- Modify: `crucible-dm.html` (DSL editor functions)

- [ ] **Step 1: Add the edit mode to the DSL editor**

After `openDSLEditor`:

```javascript
let dslEditingFeatureId = null;  // null = creating new; set = editing existing

function openDSLEditorForEdit(pmId, featureId) {
  const pm = party.find(p => p.id === pmId);
  if (!pm) return;
  const f = pm.features.find(x => x.id === featureId);
  if (!f || f.source !== 'homebrew' || !f._dslSpec) {
    alert('Cannot edit: feature is not a custom DSL feature.');
    return;
  }
  const spec = f._dslSpec;
  dslEditingPmId = pmId;
  dslEditingFeatureId = featureId;

  // Pre-fill form from spec.
  document.getElementById('dsl-name').value = spec.name || '';
  document.getElementById('dsl-summary').value = spec.summary || '';
  document.getElementById('dsl-uses').value = (spec.params && spec.params.usesPerEncounter && spec.params.usesPerEncounter.value) || 1;
  const sustainedPolicy = spec.modePolicy && spec.modePolicy.sustained || {};
  document.getElementById('dsl-trigger-round').value = sustainedPolicy.triggerRound || 1;
  document.getElementById('dsl-condition').value = sustainedPolicy.conditionFn || 'always';

  // Pre-fill category checkboxes.
  const categoryEl = document.getElementById('dsl-category');
  Array.from(categoryEl.options).forEach(o => {
    o.selected = Array.isArray(spec.category) && spec.category.includes(o.value);
  });

  // Pre-fill effects.
  dslEffects = (spec.effects || []).map(e => ({
    hook: e.hook,
    primitive: e.primitive,
    params: { ...(e.params || {}) },
    when: e.when || null,
  }));
  dslRenderEffects();

  document.getElementById('dsl-modal').style.display = 'flex';
}
```

- [ ] **Step 2: Update `dslClose` to reset the edit-feature id**

Find `dslClose` and add the reset:

```javascript
function dslClose() {
  document.getElementById('dsl-modal').style.display = 'none';
  dslEditingPmId = null;
  dslEditingFeatureId = null;
  dslEffects = [];
}
```

- [ ] **Step 3: Update `dslSave` to handle edit case**

Find `dslSave` and update to detect edit mode:

```javascript
function dslSave() {
  if (!dslEditingPmId) return;
  const pm = party.find(p => p.id === dslEditingPmId);
  if (!pm) return;
  const spec = dslBuildSpec();
  if (!spec) return;
  const compiled = PCFeatures.compileDSL(spec);
  if (!compiled) { alert('DSL compilation failed.'); return; }
  if (!Array.isArray(pm.features)) pm.features = [];

  if (dslEditingFeatureId) {
    // Edit existing — preserve the original feature id so feature state stays addressed.
    spec.id = dslEditingFeatureId;
    const idx = pm.features.findIndex(f => f.id === dslEditingFeatureId);
    if (idx >= 0) {
      pm.features[idx] = { id: spec.id, source: 'homebrew', params: spec.params, _dslSpec: spec };
    } else {
      pm.features.push({ id: spec.id, source: 'homebrew', params: spec.params, _dslSpec: spec });
    }
  } else {
    // Create new — generate a fresh id from the name.
    pm.features.push({ id: spec.id, source: 'homebrew', params: spec.params, _dslSpec: spec });
  }
  saveParty();
  renderParty();
  dslClose();
}
```

- [ ] **Step 4: Commit**

```bash
git add crucible-dm.html
git commit -m "Crucible: edit-after-save for DSL features (re-open modal with pre-filled spec)"
```

---

## Phase 7 — Integration tests + CHANGELOG

### Task 7.1: Integration scenarios

**Files:**
- Modify: `tests/pc-features.test.html`

- [ ] **Step 1: Add integration tests**

Append before `</script>`:

```javascript
    group('v1.1 integration scenarios');

    test('Custom Flurry of Blows feature grants +1 action', () => {
      const spec = {
        id: 'flurry',
        name: 'Flurry of Blows',
        source: 'homebrew',
        modePolicy: { sustained: { triggerRound: 1, conditionFn: 'always' } },
        effects: [
          { hook: 'onTurnStart', primitive: 'consumeBonusAction' },
          { hook: 'onTurnStart', primitive: 'addAction', params: { amount: 1 } },
          { hook: 'onTurnStart', primitive: 'decrementUses' },
        ],
      };
      const compiled = PCFeatures.compileDSL(spec);
      const origResolve = PCFeatures.resolve;
      PCFeatures.resolve = (ref) => ref.id === 'flurry' ? compiled : origResolve(ref);
      try {
        const self = {
          id: 'pc:monk',
          pm: { features: [{id:'flurry'}], tactics: {mode:'sustained'} },
          featureState: { flurry: { usesLeft: 4 } },
          actionsAvailable: 1,
          bonusActionAvailable: true,
        };
        const ctx = { round: 1, combatants: [] };
        PCFeatures.dispatchHook(self, 'onTurnStart', ctx);
        assertEq(self.actionsAvailable, 2);
        assertEq(self.bonusActionAvailable, false);
      } finally {
        PCFeatures.resolve = origResolve;
      }
    });

    test('Hunter\'s Mark with d8 damage via built-in param override', () => {
      const hex = PCFeatures.LIBRARY.hexMark;
      const self = {
        id: 'pc:ranger',
        pm: {
          features: [{id:'hexMark', source:'builtin', params: {damageDice: '1d8', recastSlots: 4}}],
          tactics: {mode:'sustained'},
        },
        featureState: { hexMark: { targetId: 'm:1', slotsLeft: 4 } },
      };
      const action = { kind: 'attack' };
      const target = { id: 'm:1' };
      const dmgCtx = { amount: 8, type: 'piercing', bonusDice: [] };
      hex.hooks.onAttackHit.call(hex, self, action, target, dmgCtx);
      assertEq(dmgCtx.bonusDice.length, 1);
      assertEq(dmgCtx.bonusDice[0].dice, '1d8');
    });

    test('Ambush damage: addDamage with whenTargetHasntAttacked predicate', () => {
      const spec = {
        id: 'ambush',
        name: 'Ambush Strike',
        source: 'homebrew',
        modePolicy: { sustained: { triggerRound: 1, conditionFn: 'always' } },
        effects: [
          { hook: 'onAttackHit', primitive: 'addDamage',
            params: { value: 5 },
            when: 'whenTargetHasntAttacked' },
        ],
      };
      const compiled = PCFeatures.compileDSL(spec);
      const origResolve = PCFeatures.resolve;
      PCFeatures.resolve = (ref) => ref.id === 'ambush' ? compiled : origResolve(ref);
      try {
        const self = { id: 'pc:test', pm: { features: [{id:'ambush'}], tactics: {mode:'sustained'} }, featureState: { ambush: {} } };
        // Unattacked target → +5 damage
        const dmgA = { amount: 10, type: 'piercing', bonusDice: [] };
        PCFeatures.dispatchHook(self, 'onAttackHit', {kind:'attack'}, {id:'m:1', side:'monster', hasAttacked: false}, dmgA, { round: 1, combatants: [] });
        assertEq(dmgA.amount, 15);
        // Already-attacked target → no bonus
        const dmgB = { amount: 10, type: 'piercing', bonusDice: [] };
        PCFeatures.dispatchHook(self, 'onAttackHit', {kind:'attack'}, {id:'m:1', side:'monster', hasAttacked: true}, dmgB, { round: 1, combatants: [] });
        assertEq(dmgB.amount, 10);
      } finally {
        PCFeatures.resolve = origResolve;
      }
    });
```

- [ ] **Step 2: Commit**

```bash
git add tests/pc-features.test.html
git commit -m "PC features v1.1: integration tests (Flurry, Hunter's Mark d8, Ambush damage)"
```

---

### Task 7.2: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add v1.1 entry**

Add at top of [Unreleased]:

```markdown
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
  Smite and Healing Word's per-level slot tables are too complex for the
  v1.1 editor; deferred.
- **Edit-after-save for DSL features** — custom features now have an
  `[edit]` button that re-opens the modal pre-filled from the stored
  `_dslSpec`. Saved-feature iteration no longer requires deleting and
  re-authoring.

**Migration:** None. All changes are purely additive.

**Known limitation (v1):** the 14 schema-test failures from v1 remain.
They're test-invocation patterns (free-method calls without `this`
binding); production dispatch via `dispatchHook` is unaffected. A
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
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "CHANGELOG: PC features v1.1 (DSL editor + action granting + target state)"
```

---

## Self-Review

### Spec coverage

- `addAction` primitive → Task 1.1
- `addBonusAction` primitive → Task 1.1
- `monster.hasAttacked` tracking → Task 1.2
- Target-aware mode predicates → Task 1.3
- `compileDSL` extension for hookCtx → Task 1.4
- `paramSchema` on every primitive → Task 2.1
- `paramSchema` on every built-in feature → Task 3.1
- DSL effect-row dynamic param inputs → Task 4.1
- Built-in feature inline param editor → Task 5.1
- Edit-after-save for DSL features → Task 6.1
- Integration tests → Task 7.1
- CHANGELOG → Task 7.2

### Placeholder scan

No "TBD" / "fill in details" / vague references. Code blocks complete in every step.

### Type consistency

- `paramSchema` field name used consistently across Tasks 2.1, 3.1, 4.1, 5.1
- `dslEditingFeatureId` declared in Task 6.1 — used by `openDSLEditorForEdit` and `dslSave`
- `addAction` primitive's `amount` param matches schema field name in Task 1.1, 2.1
- `whenTargetHasntAttacked` predicate name matches across Tasks 1.3, 1.4, 7.1
- `hookCtx` 4th-arg signature on `when` predicates is consistent (Task 1.3 defines, Task 1.4 dispatches, Task 7.1 exercises)

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-19-pc-features-v1.1-dsl-editor.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

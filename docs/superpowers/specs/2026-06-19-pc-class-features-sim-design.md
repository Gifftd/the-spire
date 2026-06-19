# PC Class Features in the Crucible

**Status:** Draft
**Date:** 2026-06-19
**Files affected:** `pc-features.js` *(new)*, `crucible-engine.js`, `crucible-dm.html`, `tests/pc-features.test.html` *(new)*, `CHANGELOG.md`

## Problem

The Crucible (`crucible-dm.html` + `crucible-engine.js`) simulates fights between a
party and a monster encounter to predict difficulty. The PC model treats each PC
as a flat list of `attack` / `save` / `heal` actions — same shape monsters use.
This omits the class-feature layer that actually drives 5e party output:

- Barbarian's Rage adds damage and halves incoming physical damage.
- Rogue's Sneak Attack rides every hit (effectively doubling damage for finesse weapons).
- Paladin's Divine Smite converts spell slots into burst damage.
- Wizard's Shield reaction prevents hits that would have landed.
- Cleric's Healing Word saves an ally that drops.
- Fighter's Action Surge produces nova rounds.
- Warlock's Hex / Ranger's Hunter's Mark adds sustained damage to a target.
- Bard's Bardic Inspiration shifts borderline rolls in the party's favor.

Today the sim systematically under-predicts party survival and damage output
because none of these features exist in its model. The DM also runs custom
homebrew abilities (different in every campaign) — even if the sim modeled the
8 SRD essentials, every campaign's bespoke perks would still be invisible.

## Goals

- The 8 highest-leverage 5e class features are modeled accurately enough that
  the sim's per-PC win-rate matches table experience within ~10-20%.
- The DM can add custom homebrew features via a constrained editor without
  writing JavaScript.
- Existing PCs in the party load and run unchanged; features default to none.
- Adding a feature to a PC is one click + dropdown selection.
- The runtime cost is low enough that 2000-trial runs still complete in a few seconds.
- Results panel shows per-feature impact so the DM can see which features are
  carrying the fight (or aren't).

## Non-goals

- **Strict per-PC resource accounting across an adventuring day.** Mode preset
  (Nova / Sustained / Defensive) handles this heuristically.
- **Positional mechanics or full reaction model.** Cunning Action / Disengage,
  Counterspell, Riposte, etc. are out because the sim doesn't model OAs or
  spell interrupts. Shield is the one reaction the sim supports because it's a
  pure AC-mutation reaction.
- **Class subclass features beyond what the 8 imply.** No Battle Master
  maneuvers, no Beast Master companions, no Eldritch Blast scaling. Library
  grows on demand.
- **Save-or-suck condition pipelines from PCs to monsters.** Hold Person,
  Stunning Strike, etc. — defer until the monster-side condition model is
  fleshed out (it's partial today).
- **Concentration tracking across encounters.** Concentration is intra-encounter
  only; once combat ends, all concentration drops.
- **DSL features that run arbitrary JavaScript.** The DSL is a JSON spec with
  ~10 declarative primitives; no `eval`.
- **Per-encounter feature override** (DM sets a PC's mode for one specific
  encounter without changing the PC's default). Defer to v2.
- **Counter-factual feature stacking caps.** Features sum additively; the DM
  authoring custom features owns the balance.

## Design

### Architecture & files

```
pc-features.js               (new)   ~400 lines, IIFE exporting PCFeatures
crucible-engine.js           (modify) ~65 new lines: hook dispatch + budget fields
crucible-dm.html             (modify) ~200 new lines: Features section in PC editor + DSL modal + results panel
tests/pc-features.test.html  (new)   ~70 assertions
```

Storage: feature config attached to the PC record (`pm.features: [{id, source, params}]`),
stored in `localStorage['crucible-party']` like the rest of the PC data. No worker
or KV changes — the Crucible is single-DM, localStorage-only.

A new mode field on the PC: `pm.tactics.mode: 'nova' | 'sustained' | 'defensive'`
(replaces the underused `pm.tactics.resources` slot).

DSL feature *templates* (reusable across PCs/campaigns) live in
`localStorage['crucible-feature-templates']` as an array of full feature objects.

### Feature object contract

A feature is a plain JS object with this shape:

```js
{
  // Identity
  id: 'rage',                    // unique within the library
  name: 'Rage',                  // display name
  source: 'builtin' | 'homebrew',
  category: ['damage','defense'], // tags
  classHint: 'barbarian',         // optional — for editor auto-suggest
  summary: '+2 melee damage, half phys damage taken, while raging.',

  // Per-instance parameters (auto-derived from PC level for built-ins;
  // explicitly set for DSL features).
  params: {
    bonusDamage: { type:'int', default:2, min:0, max:9 },
    duration:    { type:'int', default:10, min:1, max:100 },
  },

  // Mode policy — feature-internal logic for when to fire under each mode.
  modePolicy: {
    nova:      { triggerRound:1, conditionFn:'always', maxUses:2 },
    sustained: { triggerRound:1, conditionFn:'whenAnyEnemyAlive', maxUses:1 },
    defensive: { triggerRound:1, conditionFn:'whenHpBelowHalf', maxUses:1 },
  },

  // Hooks — all optional. Most features declare 1-3.
  hooks: {
    onCombatStart(self, ctx)              { ... },
    onTurnStart(self, ctx)                 { ... },
    onAttackAttempt(self, action, target, rollCtx) { ... },
    onAttackHit(self, action, target, dmgCtx)      { ... },
    onTakeDamage(self, dmgCtx)             { ... },
    onSaveAttempt(self, save, dc, rollCtx) { ... },
    onAllyDowned(self, ally, ctx)          { ... },
    onMonsterDowned(self, monster, ctx)    { ... },
    onRoundEnd(self, round, ctx)           { ... },
  },

  // Per-instance state. Engine preserves; feature owns the shape.
  initialState() { return { usesLeft:0, active:false, roundsLeft:0 }; },
}
```

#### Hook context objects

- **`ctx`** — present on all hooks. Read-only sim state:
  - `round` (current round number)
  - `rng` (seeded RNG; features that roll dice use this)
  - `combatants` (array; do not mutate)
  - `livingEnemies`, `livingAllies` (filtered views)
  - `eventLog` (push structured events: `{round, type:'feature', who:self.id, what:'Rage activated'}`)
- **`dmgCtx`** — passed to `onAttackHit` and `onTakeDamage`. Mutable:
  - `amount` (damage number)
  - `type` (damage type string)
  - `source` (originating action or feature id)
  - `bonusDice` (array; features push `{dice:'1d6', type:'radiant'}`)
  - `crit` (boolean)
- **`rollCtx`** — passed to `onAttackAttempt` and `onSaveAttempt`. Mutable:
  - `bonus` (the modifier)
  - `advantage`, `disadvantage` (booleans; ORed across features)
  - `reroll` (boolean; not currently used by built-ins, available for DSL)

#### Mode predicates

A small fixed table in `pc-features.js`, referenced by name from each feature's
`modePolicy.conditionFn`:

```js
const MODE_PREDICATES = {
  always:                  (self, ctx) => true,
  whenAnyEnemyAlive:       (self, ctx) => ctx.combatants.some(c => c.side==='monster' && !c.dead),
  whenHpBelowHalf:         (self, ctx) => self.hp/self.maxHp < 0.5,
  whenHpBelowQuarter:      (self, ctx) => self.hp/self.maxHp < 0.25,
  whenAllyDowned:          (self, ctx) => ctx.combatants.some(c => c.side==='pc' && c.downed),
  whenAllyHpBelowHalf:     (self, ctx) => ctx.combatants.some(c => c.side==='pc' && c.id !== self.id && c.hp/c.maxHp < 0.5),
  usesLeftGreaterThanZero: (self, ctx, featureId) => (self.featureState[featureId]?.usesLeft ?? 0) > 0,
};
```

The sim doesn't model positions, so any predicate that would otherwise ask
"is there an enemy in melee range" simplifies to "is there an enemy alive"
(which is always true at round 1 — and the policy's `triggerRound` already
handles the start-of-fight gating). The Sustained policy for Rage thus uses
`whenAnyEnemyAlive` to fire at round 1, equivalent to "the fight has started."

### Mode preset

Each PC has one mode at a time, controlling how active resource-spending
features behave. Passive features (Sneak Attack rider, Shield reaction) ignore
mode. Mode is set in the PC editor and stored as `pm.tactics.mode`.

| Mode | Semantics |
|---|---|
| **Nova** | Burst now, recover later. Spend resources liberally early. |
| **Sustained** | Pace resources across the fight. Default. |
| **Defensive** | Save resources for emergencies. |

Mode doesn't carry semantics on its own — each feature implements the three
modes in its own `modePolicy`. Worked examples for the 8 built-ins are in
**Built-in feature library** below.

### Built-in feature library

Eight curated features, hand-coded in `pc-features.js`. Each is ~30-60 lines.

| Feature | Class | Primary hooks | Mode-driven |
|---|---|---|---|
| Rage | Barbarian | onCombatStart, onAttackHit, onTakeDamage, onRoundEnd | yes |
| Sneak Attack | Rogue | onAttackHit (1/turn rider) | no — passive |
| Action Surge | Fighter | onTurnStart (request extra action) | yes |
| Divine Smite | Paladin | onAttackHit (slot spend → +radiant dice) | yes |
| Healing Word | Cleric/Bard/Druid | onAllyDowned (bonus-action heal) | yes |
| Shield | Wizard/Sorcerer | onAttackAttempt (reaction +5 AC) | yes |
| Hex / Hunter's Mark | Warlock/Ranger | onCombatStart (target), onAttackHit (+1d6 vs target) | yes (when to recast) |
| Bardic Inspiration | Bard | onCombatStart (hand out dice), onAttackAttempt/onSaveAttempt of allies (consume die) | yes |

Each feature's parameters auto-derive from `pm.identity.level` when added to a
PC. DM can override per-PC if needed.

**Worked mode policy examples:**

| Feature | Nova | Sustained | Defensive |
|---|---|---|---|
| Rage | Round 1, all fights | Round 1, all fights *(see note)* | Only when HP < 50% |
| Action Surge | Round 1 | Peak round (most enemies, or 1st on boss-only) | Reserve until ally drops |
| Smite | Highest available slot every hit | Spend slots paced ~1/2 rounds | Only on crit |
| Sneak Attack | Always (passive) | Always (passive) | Always (passive) |
| Healing Word | When ally HP < 50% | When ally HP ≤ 25% | When ally is downed |
| Shield | Use up to slot count | Use when miss-by ≤ 3 | Use only when going down |
| Hex/Mark | Round 1 + recast on kill | Round 1 only | Round 1 only, no recast |
| Bardic Insp. | Round 1 to ally most likely to crit | Spread across rounds, prefer melee | Save 1 die for healing-word target |

**Why Hex/Hunter's Mark instead of Cunning Action / Disengage:** Cunning
Action's value comes from preventing opportunity attacks. The sim doesn't
model positioning or OAs, so Cunning Action's impact is approximately zero in
this engine. Hex/Mark gives a sustained +1d6-per-hit rider that stacks with
Sneak Attack — a meaningful damage contribution the sim can express.

**Note on Rage's Nova vs Sustained equivalence in v1:** Because the sim
doesn't track resources across an adventuring day, Nova and Sustained both
activate Rage at round 1 — they produce identical behavior in v1.
The mode distinction starts to matter for multi-fight rage allocation, which
is a Non-goal. Documented as accepted limitation rather than a bug.

### DSL — custom homebrew features

The DM authors custom features as a constrained JSON form (no raw JS). DSL
features have the same object shape as library features, with hooks compiled
from declarative `effects:[]` lists.

```js
{
  id: 'fey_step_lite',
  name: 'Fey Step Lite',
  source: 'homebrew',
  category: ['action-economy'],
  summary: 'Once per fight, teleport as a bonus action. Avoids OAs.',
  params: {
    usesPerEncounter: { type:'int', value:1 },
  },
  modePolicy: {
    nova:      { conditionFn:'always',             triggerRound:1 },
    sustained: { conditionFn:'whenHpBelowHalf' },
    defensive: { conditionFn:'whenHpBelowQuarter' },
  },
  effects: [
    { hook:'onTurnStart', primitive:'consumeBonusAction', when:'usesLeftGreaterThanZero' },
    { hook:'onTurnStart', primitive:'flagDisengage', duration:1 },
    { hook:'onTurnStart', primitive:'decrementUses' },
  ],
}
```

The DSL compiler in `pc-features.js` turns this into a feature object with
hooks that invoke the primitives.

**Primitive registry** (~10 primitives):

| Primitive | What it does |
|---|---|
| `addDamage` | +X flat to damage rolls |
| `addDamageDice` | Adds dice rider to damage (e.g., '1d6') |
| `addAcBonus` | +X AC for N rounds |
| `addResistance` | Half damage from listed types |
| `consumeAction` / `consumeBonusAction` / `consumeReaction` | Mark economy used this turn |
| `heal` | Restore X HP to self or named target |
| `applyCondition` | Apply named condition |
| `decrementUses` | Tick a uses counter |
| `flag` | Set a named flag for N rounds (used by other primitives) |

**DSL editor UX:** A modal opened from the PC editor's "Features" section. Form
fields for name, category, summary, mode policy (three dropdowns), effects list
(repeatable rows: hook + primitive + params + `when`-predicate). DSL features
saved on the PC OR as templates (`localStorage['crucible-feature-templates']`).

**What the DSL cannot do (intentionally):**
- Multi-step conditional logic with branches (use multiple features instead)
- Engine internals access (re-rolling specific dice, mutating combatant order)
- Cross-PC effects beyond `heal` and `applyCondition` primitives

Covers ~80% of homebrew. Anything more complex graduates to a hand-coded
built-in.

### PC editor integration

New "Features" collapsible section inside each PC card, between Actions and
the tactics row.

```
Features ▾
  ☑ Rage              (built-in)   [edit params] [×]
    "+2 melee damage, half phys damage taken, while raging"
  ☑ Reckless Attack   (built-in)   [edit params] [×]
  ☑ Cloak of the Skull (homebrew)  [edit] [×]
  [+ Add from library ▼]   [+ Custom feature…]
```

**Add from library** opens a dropdown filtered by `pm.identity.class` (if set).
Adds the feature with auto-derived params. No modal.

**Edit params** opens an inline panel (not a modal) for the 1-2 fields the
feature exposes.

**Custom feature…** opens the DSL editor modal.

**Mode picker** sits in the existing tactics row next to Level:
```
Level [5]   Mode [Sustained ▼]   Position [frontline ▼]
```

**Surgical update discipline** — the Features section uses the same pattern as
`refreshPCSummary` (already in `crucible-dm.html`): structural changes
(add/remove feature) re-render only the Features section; field edits in
params mutate only the field's DOM node, never the wrapping section. No
keystroke-triggered `outerHTML` swaps.

### Engine integration

`crucible-engine.js` gets ~65 new lines.

**buildCombatants** — for each PC combatant, after the existing per-combatant
object is built, seed feature state:

```js
c.featureState = {};
for (const f of (pm.features || [])) {
  const def = PCFeatures.resolve(f);
  c.featureState[f.id] = def.initialState ? def.initialState(def) : {};
}
```

`PCFeatures.resolve(f)` returns the full feature definition — either looked up
from the built-in library by id, or the homebrew object stored on the PC. The
engine doesn't care about the source after resolve.

**Hook dispatch** — a `dispatchHook(combatant, hookName, ...args)` function:

```js
function dispatchHook(combatant, hookName, ...args) {
  for (const f of (combatant.pm?.features || [])) {
    const def = PCFeatures.resolve(f);
    const hook = def?.hooks?.[hookName];
    if (!hook) continue;
    if (combatant.featureState[f.id]?._disabled) continue;
    try {
      const result = hook.call(def, combatant, ...args);
      if (result === 'consume') return;  // reaction-style features short-circuit
    } catch (e) {
      console.warn(`Feature ${f.id} hook ${hookName} threw:`, e);
      combatant.featureState[f.id]._disabled = true;  // disable for rest of trial
    }
  }
}
```

**Hook call sites** in the engine — 9 total:

| Hook | Call site |
|---|---|
| `onCombatStart` | After `buildCombatants`, before round 1 |
| `onTurnStart` | Top of each combatant's turn |
| `onAttackAttempt` | Just before to-hit roll resolves |
| `onAttackHit` | After to-hit succeeds, before damage applied |
| `onTakeDamage` | When damage is about to be subtracted |
| `onSaveAttempt` | Before a save resolves |
| `onAllyDowned` | When a PC drops to 0 HP |
| `onMonsterDowned` | When a monster drops to 0 HP |
| `onRoundEnd` | After all combatants act in a round |

**Action budget fields** on each combatant, reset at appropriate times:
```js
c.actionsAvailable = 1;             // reset at onTurnStart
c.bonusActionAvailable = true;      // reset at onTurnStart
c.reactionAvailableThisRound = true; // reset at onRoundEnd
```

Features that grant economy (Action Surge) mutate these in `onTurnStart`.
Features that consume economy (Healing Word's bonus action, Shield's reaction)
set them false. Action-picker logic in the engine consults these before
letting a PC act again.

**Reaction handling:** Only one reaction per round per combatant. Dispatcher
short-circuits on `'consume'` return. Shield is the only built-in reaction.

**Composition rules:**
- Additive numeric mutations stack (Rage +2 dmg + Hex +1d6 = both apply)
- Boolean advantage/disadvantage flags use OR semantics
- Reaction consumption is exclusive — first wins
- Resistances stack as RAW: half once, second resistance on same type is a no-op

**Performance:** ~108 hook calls per round × 10 rounds × 2000 trials ≈ 2.1M
calls per run. <2s overhead at <1μs per call. Existing
`requestAnimationFrame`-chunked runner handles the scale. If it becomes hot,
pre-compute `subscribedHooks` per combatant at `onCombatStart` — deferred
5-line optimization.

### Results panel additions

**New: Feature Impact table** below the existing action-effectiveness table.
Per-feature row showing activations per fight and average impact (damage
dealt / damage prevented / HP restored / rolls assisted, by category).

**Modified: Per-PC outcomes** — new "Without features" column showing the
counter-factual win rate. Opt-in via "Compare without features" checkbox in
run controls (off by default — costs ~2x runtime).

**Modified: Representative trial logs** — feature events get `⚡` glyph and
inline in the log:

```
R1 ⚡ Karrik activated Rage (sustained mode, enemy in melee)
R1 attack | Karrik hits Goblin #1 for 14 (slash, +2 rage bonus)
R1 attack | Vex hits Goblin #2 for 9 (1d8+3) ⚡ Sneak Attack: +13 (3d6)
R2 ⚡ Bram activated Shield (incoming attack missed by 3, reaction)
```

A filter toggle in the log header hides feature events for a cleaner "just the
rolls" view.

**Modified: Markdown report** — new "Feature impact" section in the
Copy-as-markdown output, same data as the table.

### Migration

Existing `localStorage['crucible-party']` records lack `features` and use
`tactics.resources` instead of `tactics.mode`. Migration is lazy and reversible.

`loadParty()` runs each record through `migratePCRecord(pm)`:

```js
function migratePCRecord(pm) {
  if (!pm) return pm;
  if (pm.tactics && !pm.tactics.mode) {
    if (pm.tactics.resources === 'nova') pm.tactics.mode = 'nova';
    else if (pm.tactics.resources === 'sustained') pm.tactics.mode = 'sustained';
    else pm.tactics.mode = 'sustained';  // default
  }
  if (!Array.isArray(pm.features)) pm.features = [];
  return pm;
}
```

First save persists the new shape. No destructive up-front migration. No schema
version field (changes are purely additive plus one field rename). No worker
or KV impact.

## Testing

### Automated — `tests/pc-features.test.html`

Vanilla HTML test page with inline assert harness (matches
`tests/encounter-schema.test.html` etc.). Roughly 70 assertions.

**Per-feature unit tests** (~50 assertions) — for each of the 8 built-ins:
- Activates under each mode at the right round
- Doesn't activate when policy condition isn't met
- Applies the right effect (damage / heal / AC change)
- Respects uses / duration limits
- Composes with other features (Sneak + Hex stack)
- Handles edge cases (no slots, ally at full HP, no targets)

**Hook dispatcher tests** (~10 assertions):
- Hooks fire in feature declaration order
- A throwing feature is disabled for the rest of the trial but doesn't crash
- Reaction-per-round budget enforces single-reaction
- Action budget mutations from `onTurnStart` reach the action-picker
- `dmgCtx.bonusDice` accumulates from multiple features
- Missing hooks don't error

**DSL compilation tests** (~6 assertions):
- JSON spec compiles to a feature object
- Each primitive does what its docs say
- DSL feature respects `modePolicy` like a built-in
- Invalid JSON spec is rejected with useful error
- Templates round-trip through localStorage

**Integration scenarios** (~5 assertions) — highest-value tests:
1. Rage halves physical damage (500-trial avg HP loss with vs without)
2. Sneak Attack triggers 1/turn (count log events)
3. Healing Word saves a downed ally
4. Shield reaction prevents hits
5. Counter-factual sim produces lower win-rate

### Manual UI checklist (post-deploy)

- [ ] Open Crucible → existing PCs load with `tactics.mode: 'sustained'` (or 'nova')
- [ ] Add Rage to a Barbarian via Add from library → params auto-populated
- [ ] Run 500 trials → Rage shows in Feature Impact with non-zero numbers
- [ ] Toggle "Compare without features" → counter-factual column appears
- [ ] Author a custom DSL feature → saves to PC + template → reusable
- [ ] Change a PC's mode → re-running shows different activation patterns
- [ ] Trial logs show `⚡` glyph next to feature events; filter toggle hides them

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| DSL covers ~80% of homebrew; some features push DMs to "add to library" requests | Medium | Add to library on demand; track requests |
| Mode heuristics don't match how a specific player plays | Medium | Documented behavior; per-PC mode override; ~10-20% accuracy band accepted |
| Hook dispatch makes sim 10-30% slower | Low | Subscribed-hooks pre-computation (Section: Engine integration); deferred |
| Reaction race in multi-feature PCs | Low | Sequential dispatch + early-return on consume; unit tested |
| DSL feature with absurd numbers breaks balance | Low | DM's own data; not a framework problem |
| Counter-factual run doubles total runtime | Low | Opt-in via checkbox; progress bar |

## Out of scope (explicit non-features)

Captured to prevent scope drift:

- Strict per-PC resource accounting across an adventuring day
- Positional mechanics or full reaction model beyond Shield
- Class subclass features beyond what the 8 imply
- Save-or-suck condition pipelines from PCs to monsters
- Concentration tracking across encounters
- DSL features that run arbitrary JavaScript
- Per-encounter feature override
- Counter-factual feature stacking caps
- Per-feature optimization suggestions
- Per-round feature timeline charts in the UI
- Feature comparison across encounter history

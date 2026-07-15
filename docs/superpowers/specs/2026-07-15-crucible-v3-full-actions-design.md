# Crucible v3 — Full 5.5e Action Set + Tactical AI — Design Spec

**Date:** 2026-07-15
**Builds on:** the v2 spatial foundation (`feature/crucible-v2-combined`): grid, A*,
LOS (`hasLineOfSight`), terrain (wall/difficult/damaging), occupancy, Dash,
`canAttackFrom`, `findShootingCell`, OoA, AoE templates, `onBeforeOwnAttack`.

## 1. Goals

1. **Full combat-relevant 5.5e (D&D 2024) action coverage**: Attack, Dash (done),
   Disengage, Dodge, Help, Hide, Grapple, Shove, plus bonus-action economy.
2. **Advantage/disadvantage as a first-class mechanic** — the substrate that makes
   Dodge/Help/Hide/prone meaningful.
3. **Condition effects that actually change rolls and movement** (prone, grappled,
   restrained, poisoned, frightened, dodging, hidden, blinded, invisible).
4. **Per-character tactical AI**: a utility-scored decision layer that picks among
   ALL available actions per turn, driven by a per-PC tactics profile the DM edits.
5. **Custom action builder**: the DM can author arbitrary actions — attacks with
   rider conditions, AoE shapes, forced movement, buffs, bonus-action attacks.

## 2. Non-goals (documented deferrals)

- **Ready action** — trigger predicates add large complexity for low sim fidelity.
- **Influence / Study / Search / Utilize** — no exploration layer to act on.
- Mounted combat, cover (half/three-quarters), flying/climbing speeds, exhaustion.
- Concentration checks (spells modeled as actions don't track concentration).

## 3. Core mechanic: d20 advantage state

New in `crucible-engine.js` (dice layer, near `rollDie`):

```javascript
// advCount > 0 → advantage, < 0 → disadvantage, 0 → straight.
// 5e RAW: any adv + any dis = straight roll (not additive) — callers pass
// the NET of booleans: adv = (sources > 0), dis = (sources > 0), then
// rollD20(rng, adv && !dis ? 1 : dis && !adv ? -1 : 0).
function rollD20(rng, advState) {
  const a = rollDie(20, rng);
  if (!advState) return a;
  const b = rollDie(20, rng);
  return advState > 0 ? Math.max(a, b) : Math.min(a, b);
}
```

`attackAdvantageState(attacker, target, action, map)` computes the net state from:

| Source | Effect |
|---|---|
| target `prone`, attack melee (dist ≤ 1) | attacker adv |
| target `prone`, attack ranged | attacker dis |
| target `dodging` | attacker dis |
| target `restrained` | attacker adv |
| target `blinded` | attacker adv |
| target `hidden`/`invisible` | attacker dis |
| attacker `prone` | attacker dis |
| attacker `poisoned` | attacker dis |
| attacker `frightened` (source alive) | attacker dis (simplified: any) |
| attacker `restrained` | attacker dis |
| attacker `blinded` | attacker dis |
| attacker `hidden`/`invisible` | attacker adv (and hidden breaks after the attack) |
| attacker `helped` (Help action consumed) | attacker adv, flag cleared |

Both saves and attacks route through `rollD20`. `dodging` grants adv on DEX saves.
`restrained` gives dis on DEX saves. `paralyzed`/`stunned`/`unconscious` auto-fail
STR/DEX saves (already partially modeled — extend).

**Determinism note:** advantage consumes an extra rng draw. That is fine — the rng
is seeded per trial and the event stream captures outcomes.

## 4. Condition mechanics table

Central `CONDITION_EFFECTS` map in the engine (single source of truth):

| Condition | Movement | Attacks by | Attacks vs | Saves | Other |
|---|---|---|---|---|---|
| prone | costs 2/cell (crawl); stand = half speed budget | dis | melee adv / ranged dis | — | stands at turn start if able |
| grappled | speed 0 | — | — | — | escape: contested check as action (simplified: STR/DEX save DC 8+PB+STR each turn start) |
| restrained | speed 0 | dis | adv | DEX dis | — |
| poisoned | — | dis | — | — | ability checks dis (n/a) |
| frightened | can't approach source (skip move toward) | dis | — | — | — |
| blinded | — | dis | adv | — | — |
| incapacitated / stunned / paralyzed / unconscious | 0 / skip turn | — | adv (+ melee auto-crit for paralyzed/unconscious — defer) | STR/DEX auto-fail (stunned/paralyzed/unconscious) | already skips turn |
| dodging (v3, self-applied) | — | — | dis | DEX adv | ends at start of own next turn |
| hidden (v3) | — | adv (then breaks) | dis | — | broken by attacking or being found |
| helped (v3 flag) | — | adv on next attack | — | — | consumed on use |
| disengaged (v3 flag) | no OoA this turn | — | — | — | clears at end of turn |

`dodging`, `helped`, `disengaged`, `hidden` are turn-scoped flags on the combatant
(cleared at the right lifecycle point), not entries in the duration-ticked
`conditions` Map — durations there are round-based and these need turn precision.

## 5. Action economy

- Actions gain `cost: 'action' | 'bonus'` (default `'action'`). The engine's turn
  loop gets a bonus-action phase: after the action(s) resolve, if
  `c.bonusActionAvailable` and a `cost:'bonus'` action is available + useful,
  fire it (same pipeline).
- The PC action editor gets a **Cost** selector. Monster bonus actions already
  parse into `parsedActions` (from the `bonusActions` bucket) — tag them
  `cost:'bonus'` in `parseAllMonsterActions`.

## 6. Standard actions — engine semantics

Each is an engine-synthesized action (not authored), chosen by the AI layer:

- **Dash** (exists): +speed movement.
- **Disengage**: sets `c.disengagedThisTurn = true`; `executeMove`'s OoA loop
  skips checks for a disengaged mover; consumes the action; then move happens
  with the free movement budget (and the AI only picks it when retreat is the plan).
- **Dodge**: sets `c.dodging = true` until the start of its next turn. Emits
  `dodge` event.
- **Help**: adjacent ally (dist ≤ 1) gets `ally.helped = true` (adv on its next
  attack). AI picks it when the helper has no good attack of its own.
- **Hide**: requires no enemy LOS to the hider (simplified: at least one wall
  between hider and every living enemy — reuse `hasLineOfSight`). Contested
  d20+DEX vs highest enemy passive perception (10 + WIS mod). Success → `hidden`.
- **Grapple** (attack option): save-based (2024 rules): target makes STR or DEX
  save (its choice = better mod) vs 8 + PB + STR mod. Fail → `grappled`
  (speed 0). Grappler moving drags the target (defer: simplification — grappler
  doesn't move while grappling, AI treats it as lockdown).
- **Shove** (attack option): same save; fail → pushed 1 cell straight away from
  attacker (if cell is free/in-bounds/not wall) or knocked `prone` (AI choice:
  prone if ally melee nearby, push if damaging terrain behind).

Events: `dodge`, `disengage`, `help`, `hide` (with success flag), `grapple`,
`shove` (with outcome), `stand-up`. Viewer log lines for each.

## 7. Tactical AI — utility-scored action selection

Replaces the PC branch's `pickAction` priority list with a scorer; monsters keep
role policies but gain access to Dodge/Disengage via role-appropriate rules.

### Per-PC tactics profile (extends `pm.tactics`)

```javascript
tactics: {
  role: 'frontline' | 'skirmisher' | 'archer' | 'caster' | 'support',
  aiHint: 'focus' | 'survival' | 'spread',      // existing — target selection
  mode: 'nova' | 'sustained' | 'defensive',     // existing — resource pacing
}
```

`role` defaults derived from `position(pm)` (existing frontline/backline logic).

### Turn decision flow (PC)

1. Heal triage (existing) — support role weights this higher.
2. Enumerate candidates: best attack (EV via `actionEv`), Dodge, Disengage+retreat,
   Dash (to engage or retreat), Hide (if rogue-ish and possible), Help, Grapple/Shove
   (frontline), bonus-action options.
3. Score each with role-weighted utility:
   - attack: `EV vs best target` (existing scorer picks target)
   - Dodge: `threatEV * (isTank ? 1.2 : 0.6)` when ≥2 enemies threaten melee and
     HP < 50% — value of halving incoming hits
   - Disengage+retreat: for archer/caster adjacent to melee: EV of next-turn
     full attack minus OoA risk avoided
   - Kiting (archer/skirmisher): move away to max range after attacking if
     speed remains (free — movement isn't an action)
4. Execute the winner. Log a `decision` trace event (DM-visible in log filter)
   so the DM can debug why a character acted.

### Monster adjustments

- Role policies gain: `skirmisher` uses Disengage before repositioning;
  `artillery` Dodges when engaged in melee with no escape; `brute` uses Shove
  when it would push a PC into damaging terrain or prone them for allies.
- Implemented as a thin pre-pass in the monster branch (keep ROLE_POLICIES
  shape; add optional `pickManeuver(me, all, ctx)` per policy).

## 8. Custom action builder (DM-facing, crucible-dm.html)

Extend the PC action editor so each action supports:

- **Cost**: action / bonus.
- **Attack riders**: on-hit condition + save to resist (`rider: { condition,
  saveAbility, saveDc | 'derived', duration }`).
- **AoE**: shape (sphere/cube/cone/line) + size + range (already engine-supported
  via `resolveAoE`; UI only has aoeTargets — add shape/size fields).
- **Forced movement**: `push: N` cells on hit (shove-like, engine reuses shove
  push code).
- **Buff actions** (`type: 'buff'`): grant self or adjacent ally `dodging`-style
  flags or advantage (`grants: 'dodging' | 'helped' | condition`), cost usually
  bonus.
- Existing: uses/day, recharge, attacksPerAction, save actions, heals.

Schema stays backward-compatible: all new fields optional; `migratePCRecord`
fills defaults.

## 9. Parser upgrades (crucible-parser.js)

- Rider conditions on hit: "the target is grappled (escape DC 14)", "the target
  must succeed on a DC 13 Strength saving throw or be knocked prone" inside an
  attack body → `rider` field.
- Tag `cost:'bonus'` for actions parsed from the `bonusActions` bucket.

## 10. Events (additions)

`dodge`, `disengage`, `help`, `hide`, `grapple`, `shove`, `stand-up`,
`condition-applied`, `condition-ended`, `decision` (AI trace, filterable).
All carry `{ round, who, name, ... }`. Viewer `formatEvent` + `applyEvent`
updated (position changes from shove push; condition markers on tokens).

Viewer token polish: small status glyphs (● dodging, ✦ hidden, ▼ prone,
✕ grappled) above the HP bar.

## 11. File impact

| File | Change |
|---|---|
| `crucible-engine.js` | rollD20/advantage, CONDITION_EFFECTS, standard actions, bonus phase, AI scorer | 
| `crucible-spatial.js` | retreat/kite helpers (`findRetreatCell`), frightened move filter |
| `crucible-parser.js` | riders, bonus-cost tagging |
| `crucible-dm.html` | action builder UI, tactics profile UI (role select) |
| `crucible-viewer.js` | new events, status glyphs |
| `pc-features.js` | expose helped/dodging to feature hooks (no breaking change) |
| tests | per-phase coverage in existing harnesses |

## 12. Phasing (implementation order)

1. **V3.1** d20 core: rollD20 + attackAdvantageState + condition effects on rolls/saves/speed.
2. **V3.2** Action economy: cost field, bonus-action phase, parser tagging, editor Cost select.
3. **V3.3** Standard actions: Dodge, Disengage, Help, Hide, Grapple, Shove, stand-up.
4. **V3.4** Tactical AI: utility scorer, tactics.role, kiting/retreat, monster maneuvers, decision events.
5. **V3.5** Custom action builder: riders, AoE UI, push, buffs.
6. **V3.6** Parser riders + viewer polish (status glyphs).
7. **V3.7** Integration sweep: full test run, CHANGELOG, manual checklist.

Each phase lands as its own commit(s) with tests; controller reviews every diff.

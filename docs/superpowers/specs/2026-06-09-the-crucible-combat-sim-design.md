# The Crucible — combat simulation tool

**Status:** design approved, awaiting implementation plan
**Date:** 2026-06-09
**Tool name:** The Crucible (`crucible-dm.html`)

## Purpose

A DM-only tool that runs Monte-Carlo combat simulations between a configurable
PC party and an encounter of monsters, so the DM can see the *actual* difficulty
distribution of a fight — not just the FM CR-budget band. Answers questions like
"this is rated STANDARD, but does the cleric die in 30% of runs?" and "which
monster ability is doing all the work?"

## Scope

### In scope (v1)

- Static HTML page (no build step, no framework, no new dependencies — same
  conventions as the rest of The Spire).
- PC party authoring with a quick-form, persisted to `localStorage`.
- Encounter authoring via the existing bestiary picker (MM 2024 + FM + custom).
- Round-by-round simulation with real to-hit, damage, and save rolls.
- Active healing (single-target and AoE) for both PCs and monsters.
- Passive regeneration on monsters (e.g. trolls), with suppression by trigger
  damage types.
- Monster action parser that turns text bodies into structured `parsedActions[]`,
  caching corrected results in `bestiary_custom`.
- Results report covering: headline trio, per-PC outcomes, distribution
  histograms, per-action effectiveness, three representative event logs.
- FM CR-budget comparison: side-by-side "intended" vs "simulated" difficulty.

### Out of scope (v1)

- Positioning / range / line-of-effect.
- Death saves; downed PCs are out for the rest of the fight.
- Concentration tracking.
- Reactions, opportunity attacks, lair actions.
- Legendary actions (except FM "Solo" extra turn).
- Tunable AI knobs in the UI (data layer carries them; UI hides them in v1).
- Spell parsing from `Spellcasting` action bodies; affected monsters require
  manual fill-in via the override panel.
- Temporary HP. Heals and absorb effects skip the temp-HP pool entirely; the
  pool is not modelled.
- Condition duration parsing; all conditions default to 1 round in v1.
- Saved encounters or saved results history.
- Player-side view.

### Future upgrade path

The PC data model is intentionally a strict subset of an eventual full character
sheet. Stored fields are inputs (ability scores, proficiency choices, level);
all combat numbers (PB, save bonuses, to-hit, save DCs) are derived. When the
full sheet is built later, it adds `skills`, `equipment`, `spellSlots`,
`features`, `inventory`, `conditions`, etc., as *additional* fields — no
migration required.

Similarly, the monster `parsedActions[]` shape is what an eventual fully-
structured bestiary will use. The runtime parser is the seed; DM corrections
accrue into a hand-verified library over time.

## Architecture

### Page

A single new file, `crucible-dm.html`, following the same pattern as other DM
pages: inline `<style>` + `<script>`, `<script src="auth.js">` at the top, calls
`Auth.requireRole('dm', {redirect: 'home.html'})` on load. Added as a new DM-
only tool card on `home.html`.

### Reused from existing tools

- **Bestiary data** — `bestiary.json` + `fm.json` + `bestiary_custom` KV.
  Same fetch + merge pattern as the War Table's `_BP` cache.
- **FM CR-budget math** — `FM_CR_BUDGET`, `fmDifficultyBand`, `fmSoloBand`,
  `minionsPerStd` from `initiative-dm.html`. Copy-pasted into `crucible-dm.html`
  for v1; if both files diverge meaningfully later, extract to a shared module.
- **DM auth** — `Auth.requireRole`, `Auth.dmHeaders()` for `bestiary_custom`
  writes.

### New modules (all in `crucible-dm.html`)

1. **PC quick-form** — left pane; persists `localStorage['crucible-party']`.
2. **Encounter picker** — center pane; reuses the War Table's bestiary modal.
3. **Action parser** — pure function, regex-based, runs on-demand and caches
   results into `monster.parsedActions[]`.
4. **Sim engine** — pure functions; `runTrial(party, monsters, tactics, rng)`
   and `runSim(...) → SimResult` with `requestAnimationFrame` chunking.
5. **Results renderer** — verdict, per-PC, distribution, per-action,
   representative logs.
6. **Override panel** — for monsters with unparsed or imperfect actions; saves
   corrections back to `bestiary_custom`.

### KV impact

- New optional field: `bestiary_custom.monsters[].parsedActions[]`.
  Backward-compatible; existing custom monsters without the field still load.
- No new KV keys.
- No new worker endpoints (uses existing `bestiary_custom` read/write).

## Data model

### `PartyMember` — persisted in `localStorage['crucible-party']`

```js
{
  id: 'pm-1',
  identity: { name, player, class, subclass, level, race },
  abilities: { str:14, dex:14, con:14, int:10, wis:12, cha:10 },  // scores
  profs:    { saves: { str:false, dex:true, con:false,
                       int:false, wis:false, cha:false } },
  combat:   { hp:30, maxHp:30, ac:16, initBonus:2, speed:30 },
  actions: [
    { id, name:'Longsword',
      source:'weapon', type:'attack',     // 'attack' | 'save' | 'heal' | 'utility'
      atkAbility:'str', atkBonusOverride:null,
      damage: { dice:'1d8', mod:'+atkAbility', type:'slashing',
                riderDice:null, riderType:null },
      save: null, aoeTargets: 0,
      heal: null,                          // populated when type === 'heal'
      usesPerDay: null, recharge: null,
      attacksPerAction: 1
    }
    // Example heal action shape:
    // { id, name:'Healing Word', source:'spell', type:'heal',
    //   atkAbility:'wis',
    //   heal: { dice:'1d4', mod:'+atkAbility', flat:0,
    //           target:'ally', aoeTargets:0, reviveDowned:true },
    //   damage:null, save:null,
    //   usesPerDay:3, recharge:null, attacksPerAction:1 }
  ],
  tactics: { aiHint:'focus', resources:'nova' }  // hidden in v1, used by sim
}
```

**Derived values (never stored, always computed):**
- `pb = ceil(1 + level/4)`
- `mod(score) = floor((score - 10) / 2)`
- `saveBonus(pm, ab) = mod(pm.abilities[ab]) + (pm.profs.saves[ab] ? pb : 0)`
- `toHit(pm, action) = action.atkBonusOverride ?? mod(pm.abilities[action.atkAbility]) + pb`
- `saveDc(pm, action) = action.save.dcOverride ?? 8 + mod(pm.abilities[action.atkAbility]) + pb`
- `damageRoll(action) = roll(dice) + (mod === '+atkAbility' ? mod(atkAbility) : Number(mod))`

**Quick-form defaults** so a v1 PC is fillable in ~30 seconds:
- abilities `{14,14,14,10,12,10}`
- all save profs `false`
- one melee attack `Longsword`, STR-based, `1d8+STR`, slashing
- HP, AC, name, level prompted explicitly

### `ParsedAction` — cached on monster, persisted in `bestiary_custom`

```js
{
  sourceActionName: 'Wind Staff',
  kind: 'multiattack' | 'attack' | 'save' | 'heal' | 'utility' | 'unparsed',

  // kind: 'multiattack'
  multiattackPlan: [{ actionName:'Wind Staff', count:2 }, ...],

  // kind: 'attack'
  toHit: 5, reach: 5, range: [120, null],
  damage: [{ dice:'1d8', mod:3, type:'bludgeoning' },
           { dice:'2d10', mod:0, type:'lightning' }],

  // kind: 'save'
  saveAbility: 'dex', saveDc: 13, aoeTargets: 0,
  effectOnFail: 'damage' | 'condition',
  damageOnFail: [...], damageOnSave: [...],
  halfOnSave: true, condition: null,

  // kind: 'heal'
  heal: { dice:'2d8', mod:3, flat:0,
          target:'self' | 'ally' | 'ally-aoe',
          aoeTargets: 0,
          reviveDowned: true },

  // resource gating (any kind)
  recharge: null | { dice: 'd6', minRoll: 5 },
  usesPerDay: null | 1,

  // provenance
  parsedBy: 'auto' | 'manual',
  parsedAt: '2026-06-09'
}
```

`kind:'unparsed'` is the explicit failure marker — sim treats unparsed actions
as skip-and-flag.

### `Monster.regeneration` — parsed from a trait body, cached alongside `parsedActions[]`

```js
{
  amount: 10,
  suppressedBy: ['acid', 'fire'],   // damage types that block next turn's tick
  minHpToRegen: 1                    // 5e default: must be above 0
}
```

Absent on most monsters (`undefined` ⇒ no regen). The parser walks `traits[]`
looking for a `Regeneration` trait and writes this field; corrected forms can
be saved into `bestiary_custom` via the override panel.

### `SimRun` — in-memory only, not persisted in v1

```js
{
  partySnapshot, encounterSnapshot, trials: 500, tactics,
  fmBudget: { level, size, band, totalCr, capCr },
  seed,
  results: {
    headline:    { winRate, avgRounds, avgDowned, partyTpkRate },
    perPc:       [{ pmId, name, downRate, halfHpRate,
                    avgHpRemaining, deathRound: {mean, p10, p90},
                    avgHealReceived, avgRevivesReceived }],
    distribution:{ downedHist: [0..n], roundsHist: [1..25] },
    perAction:   [{ actor:'pc'|'monster', sourceId, name,
                    kind:'attack'|'save'|'heal'|'multi',
                    uses, hits, totalDmg, avgDmg, killsCaused,
                    totalHealed, revivesCaused }],
    representative: { low, median, high }  // each = full event log
  },
  warnings: [],
  errors: []
}
```

`representative.{low, median, high}` hold full event-stream logs for one trial
each, picked by sorting trials by `pcHpRemaining` at p10 / p50 / p90.

## Sim engine

A single trial is a pure function: `runTrial(party, monsters, tactics, rng) →
TrialResult`. The RNG is seedable so the same inputs reproduce — important for
the representative-replay feature.

### Setup (once per trial)

1. Materialize combatants. PCs come straight from `party`; monsters expand to N
   independent instances (`Goblin #1`, `Goblin #2`). HP rolled from `hpFormula`
   if "roll HP" is enabled, else `monster.hp` (average).
2. Roll initiative: `d20 + initBonus`. Ties: DEX mod, then random. Solos get a
   second slot at `initiative − 10` (FM "Solo extra turn").
3. Mark all `usesPerDay` and `recharge` actions available.
4. State per combatant: `{ id, side, hp, maxHp, ac, conditions:Set, downed,
   dead, slotsLeft, rechargeReady, damageTypesReceivedLastTurn:Set,
   damageTypesReceivedThisTurn:Set, lastHealRound }`.

### Round loop (max 25 rounds)

For each combatant in initiative order:

1. Skip if downed/dead.
2. Tick conditions (decrement; lift expired; if `incapacitated`, skip turn).
3. Recharge roll for each `recharge` action; mark ready on success.
4. **Regeneration tick.** If this combatant has a `regeneration` block and is
   above `minHpToRegen` and is not dead, check whether any damage type in
   `damageTypesReceivedLastTurn` is in `regeneration.suppressedBy`. If not,
   add `regeneration.amount` to `hp` capped at `maxHp`. Emit a regen event.
   After this step, rotate the damage-type tracking:
   `damageTypesReceivedLastTurn = damageTypesReceivedThisTurn;
   damageTypesReceivedThisTurn = ∅`.
5. Pick target(s) per `tactics.aiHint`:
   - `focus` (v1 default): living enemy with lowest current HP; ties by lowest
     AC, then random.
   - `random`: random living enemy.
   - `priority` (v1.5): monsters target lowest-HP PC weighted by inverse AC;
     PCs target solos first, standards next, minions last.
6. **Heal triage (preempts steps 5 and 7).** Check first, before picking an
   enemy or an attack action. If this combatant has at least one available
   action with `type:'heal'` AND
   (a) any ally is `downed` (use a heal with `reviveDowned:true`), OR
   (b) any ally is below 50% maxHp AND this combatant's `lastHealRound` is
       at least 1 round in the past,
   then short-circuit: pick the heal action; target the lowest-HP qualifying
   ally (or all qualifying allies for `target:'ally-aoe'`); jump to step 8
   (resolve) with no enemy target. Update `lastHealRound = currentRound`.
   If no trigger fires, fall through to steps 5 and 7.
7. Pick action per `tactics.resources`:
   - `nova` (v1 default): highest-expected-output available action that fits
     the situation; prefer limited-resource over at-will until exhausted;
     multiattack counts as one action containing sub-attacks.
   - `paced` / `conservative` (v1.5): hold one limited-use ability in reserve.
8. Resolve action:
   - **Attack roll:** `d20 + toHit` vs AC. Nat 20 → crit (damage dice doubled,
     modifier not). Nat 1 → miss. Apply damage by component, respecting
     resistances / immunities / vulnerabilities from the statblock.
   - **Save effect:** target rolls `d20 + saveBonus(ability)` vs DC. AoE loops
     over `aoeTargets` lowest-HP enemies. On fail, apply `damageOnFail` and/or
     `condition` for 1 round (v1 fixed duration). On success, apply
     `damageOnSave` if `halfOnSave`, else nothing.
   - **Heal:** roll `heal.dice + heal.mod + heal.flat` once per target. For
     `target:'self'`, target self; for `'ally'`, the chosen low-HP ally; for
     `'ally-aoe'`, all allies in scope (loop). If the target is `downed` and
     `heal.reviveDowned`, clear `downed`, set `hp = heal_amount` (5e: 0 HP +
     heal = `heal_amount`). Otherwise add heal amount to current HP, capped at
     `maxHp`. Track total healed in `perAction`.
   - **Multiattack:** resolve sub-attacks in order, each repicking a target.
9. Apply damage. **FM minion rule:** any non-zero damage to a minion drops it
   to 0 immediately. Standards and solos use normal HP subtraction. **Record
   each damage type dealt into the target's `damageTypesReceivedThisTurn`** —
   this is what suppresses next-turn regeneration.
10. 0 HP handling: PCs → downed (no death saves in v1); monsters → dead.
    Record `deathRound` and the action that delivered the killing blow.
11. Emit event log entry. Retained only for the three representative trials.

### End conditions (checked after each turn)

- All PCs downed → monster win.
- All monsters dead → PC win.
- Round 25 reached → "stalemate" (counted as loss for the side with more
  remaining HP; logged in warnings).

### Aggregation

Run `trials` (default 500) trials, accumulating into `SimResult`. Representative
trials picked by sorting by `pcHpRemaining` at p10 / p50 / p90; their full
event logs are retained, all others discarded.

### Performance

Target 500 trials in ≤2 seconds on a modern laptop. Plain JS, no DOM during
trials. After each chunk (~50 trials),
`await new Promise(r => requestAnimationFrame(r))` so the UI can render a
progress bar and the `winRate` live tally.

### Reproducibility

`seed` defaulted to `Date.now()`; exposed in the post-sim UI; click to copy.
`?seed=<n>` URL param rehydrates with the same party + encounter.

## Action parser

Pure function: `parseAction(actionName, actionBody, monsterAbilities,
monsterPb) → ParsedAction`. Five passes; first pass that matches wins.

### Pass 1 — Multiattack detection

If `actionName` matches `/^multiattack/i` OR `actionBody` starts with
`/^The \w+ makes (a|an|one|two|three|four|five|six) /i`, treat as multiattack.
Extract sub-action names from patterns like `"makes two Longsword attacks"`,
`"two Bite attacks and one Tail attack"`, `"makes two attacks: one with its
Longsword and one with its Shortbow"`. Convert spelled-out numbers ("one" → 1,
…). Produce `{ kind:'multiattack', multiattackPlan }`.

### Pass 2 — Attack roll

Match `/Melee Attack Roll:|Ranged Attack Roll:|Melee Weapon Attack:|Ranged
Weapon Attack:|Melee or Ranged Attack Roll:/i`. Extract:

- `toHit` from `/(?:Attack Roll|Attack):\s*\+?(-?\d+)/`
- `reach` from `/reach (\d+) ?(?:ft|feet|')/i`
- `range` from `/range (\d+)(?:\/(\d+))? ?(?:ft|feet|')/i`
- Damage components: every match of
  `/(\d+)?\s*\((\d+d\d+)(?:\s*([+-])\s*(\d+))?\)\s+(\w+)\s+damage/i` →
  `{dice, mod, type}`. Leading `\d+` (average) ignored.

Set `kind:'attack'`.

### Pass 3 — Save effect

Match `/(\w+) saving throw|saving throw:.*?DC (\d+)|DC (\d+) (\w+) saving
throw/i`. Extract `saveAbility`, `saveDc`, damage components (same as Pass 2),
`halfOnSave` from `/half (?:as much )?damage on a success(?:ful save)?/i`.

AoE target count inferred from area shape:
- `/(\d+)-foot[- ](?:cone|cube|line|radius|sphere)/i` →
- sphere/cube → 4 targets
- cone → 3
- line → 3
- radius around target → 2
- otherwise → 1 (flag for review)

Conditions matched against a whitelist (`prone`, `restrained`, `grappled`,
`stunned`, `paralyzed`, `frightened`, `incapacitated`, `unconscious`,
`blinded`, `deafened`, `poisoned`, `charmed`). Duration defaults to 1 round
(flagged "duration estimated").

Set `kind:'save'`.

### Pass 3.5 — Heal effect

Match `/regains (\d+) ?(?:\(([^)]+)\))? hit points/i` or `/restores (\d+) hit
points/i` or `/heal(?:s|ed)? .*? for (\d+) ?\((\d+d\d+)(?:\s*\+\s*(\d+))?\)/i`.
Extract `heal.dice` + `heal.mod` from the parenthetical formula, or `heal.flat`
if no dice are stated.

Determine `target`:
- Body mentions `itself` / `the <monstername>` / first-person reflexive →
  `target:'self'`.
- Mentions `one creature it can see` / `an ally` / `a friendly creature` →
  `target:'ally'`.
- AoE language (`each ally`, `all allies`, `creatures within N feet`) →
  `target:'ally-aoe'` with `aoeTargets` from the radius heuristic in Pass 3.
- Default when ambiguous → `target:'ally'`.

`reviveDowned: true` if body mentions `unconscious`, `dying`, `0 hit points`,
or matches the canonical "if the creature has 0 hit points, it regains…"
phrasing. Default `false`.

Set `kind:'heal'`.

### Recharge / uses (always runs, attached to whatever Pass 1–3.5 produced)

Parse from `actionName` parenthetical regardless of action kind. Attaches
`recharge` and `usesPerDay` to the `ParsedAction` produced by Passes 1–3:
- `/\(Recharge (\d)(?:[-–](\d))?\)/` → `recharge: { dice:'d6', minRoll }`.
- `/\((\d+)\/Day\)/i` → `usesPerDay`.

### Pass 4 — Unparsed fallback

If none of Passes 1–3.5 matched, emit `{ kind:'unparsed', sourceActionName,
_raw: actionBody }`. Sim skip-and-flag.

### Regeneration trait parse (separate function, called once per monster)

A standalone helper `parseRegeneration(traits) → RegenerationBlock | null`
walks `monster.traits[]` for a trait whose name matches `/^regeneration/i`.
On the trait body, extract:

- `amount` from `/regains (\d+) hit points/i`.
- `suppressedBy` from `/take(?:n)? (.+?) damage/i` — split on `or` / `,` /
  `and` and lowercase each, e.g. `"acid or fire"` → `['acid','fire']`.
- `minHpToRegen: 1` (hardcoded; 5e default).

Returns `null` if no `Regeneration` trait or the amount doesn't parse.
Written into `monster.regeneration`. Override panel can edit this same field.

### Caching & overrides

- First call for a given monster: parse all `actions[] / bonusActions[] /
  reactions[]` once, populate `monster.parsedActions[]` (keyed by
  `sourceActionName`).
- If `bestiary_custom` already has a `parsedActions[]` entry for that monster,
  use it — skip the parser for any action present there.
- "Review parsed actions" modal lets the DM edit any parsed form. Saving writes
  the corrected `parsedActions` into `bestiary_custom` via the existing DM
  write endpoint.

### Pre-sim validation gate

Before a run, collect every `kind:'unparsed'` action and every `aoeTargets`
flagged as defaulted. If any exist, block the run with
"N actions need review before this fight can be simulated" linking each item
to the override panel.

### Known parser limitations (documented in v1)

- Spellcasting actions (the body lists spells the monster *can* cast) are not
  parsed; flagged as `unparsed` for manual fill-in. **This includes healing
  spells listed inside `Spellcasting`** — e.g. a cleric monster whose
  `Spellcasting` lists Cure Wounds will need the DM to add a `kind:'heal'`
  action manually via the override panel.
- Condition durations not parsed; default to 1 round.
- Multiattack sub-action lookup is by exact name match; misses fail to
  `unparsed`.
- Regeneration triggered by something other than damage type (e.g. "unless
  damaged by a critical hit") not parsed; defaults to amount + empty
  `suppressedBy`, surfacing as a soft warning.

## UI layout & flow

Three-pane layout, mobile collapses to stacked. Uses `theme.css` tokens
(Cinzel headings, Crimson Text body, slate/teal accents — *not* parchment).

### Topbar

`⚔ The Crucible` title • `[Run 500 trials ▶]` • `[Trials: 100▾]`
(100/500/2000) • `[Tactics ⚙]` (button — closed in v1; reserved for later) •
`[⌂ Home]` • sync-status pip.

### Pane A — Party (left, ~320px)

- Header: `PARTY (4)` + `[+ Add PC]`.
- Per-PC card collapsed: one line `Name · L# · HP·AC`.
- Expanded: three sections — **Identity**, **Stats**, **Actions**.
- Per-action row collapsed: `Name · type · damage summary`. Expanded: full
  form (atkAbility, atkBonusOverride, damage formula, rider, save fields,
  AoE, usesPerDay, recharge).
- `[Save PC]` writes back to `localStorage['crucible-party']`.
- Bottom: `[Import from War Table party]` — pulls name/HP/AC from
  `localStorage['init_pcs']`, fills defaults for the rest.

### Pane B — Encounter (center, ~400px)

- Header: `ENCOUNTER` + `[+ Add from Bestiary]` (reuses War Table picker;
  lazy-load bestiary once on first open; cache on `window._BP_cache`).
- Per-monster row: `[#] Name (CR X) · HP·AC ✕`. Click expands a sidebar
  showing parsed actions + `[Review parsed actions]`.
- Footer: **FM budget says: STANDARD** with the existing CR-budget math
  using party level/size from Pane A.

### Pane C — Results (right, fills when sim completes)

Pre-sim empty state: validation checklist if anything's blocking. During sim:
progress bar + Cancel + live `winRate`. Post-sim: five collapsible sub-sections:

1. **Verdict** — colored band (`EASY / STANDARD / HARD / DEADLY / TPK-LIKELY`)
   derived from PC win-rate and avg-downed. Below: "FM said STANDARD; sim says
   HARD. Δ = +1 band." Headline trio shown here.
2. **Per-PC outcomes** — table: name, down-rate %, ≥50%-HP-loss %, avg HP
   remaining, avg death round (if applicable), avg HP healed (sum of heals
   received across trials, divided by trials).
3. **Distribution** — two SVG bar charts: "PCs downed" histogram, "rounds to
   resolution" histogram. No chart library.
4. **Action effectiveness** — sortable table: actor, action, kind
   (`attack/save/heal/multi`), uses, hits, total damage, total healing, avg
   per use, killing blows. Healing actions show zero for damage columns and
   vice versa. Default sort by combined-impact (damage + healing) desc.
5. **Representative fights** — three tabs (Low / Median / High); each shows the
   full event log for that trial.

Top of Results: `[Rerun]`, `[Copy report]` (markdown — headline + per-PC +
verdict, pastable into Discord / notes), seed display.

### Mobile

Three panes stack vertically. Min target 360px width. Action edit forms
collapse aggressively.

### Flow

1. Open `crucible-dm.html` → `Auth.requireRole('dm', ...)`.
2. First-time: one empty PC placeholder with default abilities; `[Import from
   War Table party]` highlighted.
3. Add monsters via picker; bestiary lazy-loads.
4. If unparsed / incomplete things exist, "Run Simulation" stays disabled.
5. Click Run; 500 trials in <2s; results render.
6. Tweak encounter; rerun is one click; party persists.

## Error handling

### Validation gates (block run)

- Empty party.
- Empty encounter.
- Any PC with HP ≤ 0 or AC < 5.
- Any PC with no actions (would silently skip turns, hiding fragility).
- Any monster with `parsedActions[]` empty after parsing.
- Any `kind:'unparsed'` action in the chosen plan.

### Soft warnings (allow run, surface in verdict)

- Multiattack sub-action name unresolved → "treated as a single attack."
- `aoeTargets` defaulted → "AoE size defaulted to 1 target — review for
  accuracy."
- Condition duration estimated → "Duration defaulted to 1 round."
- Regeneration parsed without suppression types → "Troll regenerates with no
  damage-type suppression — fight may run long; review trait."
- Trial hit 25-round cap → "N of 500 trials hit the round cap (stalemate)."

### Runtime errors

- Per-trial try/catch. Errored trials drop into `errors[]`; sim continues with
  the rest. Verdict surfaces "3 of 500 trials errored — sim ran with 497 valid
  trials" + first stack. If >10% error, abort with a prominent failure.
- Bestiary load failure → use `localStorage['crucible-bestiary-cache']`
  fallback, surface "Using cached bestiary from <date>."
- Override save failure (DM auth expired) → keep edit in memory, retry,
  surface "Override unsaved — will retry."

### Determinism for debugging

Seed shown post-sim → click to copy. `?seed=<n>` URL param rehydrates with the
same party + encounter.

### Edge cases pinned for v1

- Monster with only `Spellcasting` → all actions unparsed → blocks run until
  DM fills in at least one structured action. We accept this friction for v1.
- Mixed minion + standard encounter → minions resolve any-hit-kills rule;
  standards use normal HP. Handled naturally in damage application.
- Solo with no HP after round 1's nova → solo's extra-turn slot is skipped if
  dead. No posthumous turns.
- PC `usesPerDay` ability fired in round 1 → flagged in `perAction` table,
  showing nova-dependence.
- Hopelessly mismatched encounter (CR-20 dragon vs L1 PCs) → reports
  `winRate: 0%, partyTpkRate: 100%`. No error; verdict is the answer.
- **Healer with no offensive action** is allowed (a pure support PC). They use
  heals when triggered; on turns with no qualifying ally to heal, they skip
  (no action). Surfaced as a soft note rather than a validation failure.
- **Healer downed before they can heal** is just a normal outcome — they don't
  self-revive unless they have a self-heal with `reviveDowned:true` AND aren't
  yet at 0 (5e: a downed creature can't take actions). v1 simplification: no
  self-revive from `downed` state.
- **Troll-style regeneration loop avoidance:** if a troll heals back to full,
  is never hit by acid/fire, and the party can't out-DPR the regen, the trial
  hits the 25-round cap. Counted as a loss for the side with more remaining
  HP (which will be the troll). Working as intended; the verdict is
  "this fight grinds — bring fire."

## Testing

### Parser

`tests/parser.test.html` — vanilla HTML page with assert statements and a "Run
tests" button. No test runner (consistent with no-build-step rule).

Fixture: 35 hand-crafted action bodies covering each pass and several
pathological cases — 30 attack/save/multiattack/recharge cases plus 5 healing
cases (single-target ally heal, AoE heal, self-heal, downed-revive heal, and
a Regeneration trait body). Each test asserts the parsed shape matches a
hand-written expected value. Manual run; pass/fail counts in the page.

Goal: 100% of fixtures pass. Regressions add fixtures.

### Engine

`tests/engine.test.html` with five deterministic scenarios:

1. One-PC vs one-monster, identical stats, seeded → known event log.
2. 4-PC party vs FM "standard" encounter → win-rate at 1,000 trials lands in
   70–90%.
3. 4-PC party vs FM "extreme" encounter → win-rate ≤ 30%, downed ≥ 2 avg.
4. 4-PC party including one healer (1d8+3 Healing Word, 3 uses/day) vs the
   same FM "standard" encounter as (2) → win-rate strictly higher than (2)'s
   and `avgHealReceived > 0`. Confirms healing affects outcomes.
5. 4-PC party vs a single troll (regen 10, suppressed by acid/fire) where the
   party has no acid/fire damage → most trials hit the round cap and the
   troll wins. Add one PC with fire damage and rerun → win-rate flips.
   Confirms regeneration + suppression both work.

Bounds, not exact equality — variance is the point.

### UI

Manual checklist in `CHANGELOG.md` entry: load page, add PC, add monster, run
sim, verify results render, review override panel, save override.

## Project discipline

- Per CLAUDE.md: before each batch of edits, snapshot touched files into
  `backups/<timestamp>-crucible-<step>/`.
- Each commit's `CHANGELOG.md` entry (top of Unreleased) describes what changed
  and why.
- The new page gets a DM-only tool card on `home.html` following the existing
  card pattern.
- Worker is **not changed** in v1 — every read/write uses an existing
  endpoint. No manual Cloudflare paste required.

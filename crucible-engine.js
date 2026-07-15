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

  // rollDie(sides, rng) — sides first; matches rollDice(formula, rng, crit) convention.
  function rollDie(sides, rng) {
    if (!Number.isFinite(sides) || sides < 1) return 0;
    return 1 + Math.floor(rng() * sides);
  }

  // Roll a d20 honoring advantage state: +1 = advantage (roll twice, take
  // higher), -1 = disadvantage (lower), 0/undefined = straight roll.
  // 5e RAW: any advantage + any disadvantage = straight — callers compute
  // the NET state via netAdvantage().
  function rollD20(rng, advState) {
    const a = rollDie(20, rng);
    if (!advState) return a;
    const b = rollDie(20, rng);
    return advState > 0 ? Math.max(a, b) : Math.min(a, b);
  }

  // Collapse boolean source lists per 5e RAW.
  function netAdvantage(hasAdv, hasDis) {
    if (hasAdv && hasDis) return 0;
    return hasAdv ? 1 : (hasDis ? -1 : 0);
  }

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

  // v2 spatial: resolve an action's range in cells. Honors explicit
  // action.range; falls back to deriving from actionRange string.
  function actionRange(action) {
    // Explicit cell-range override (PC-side, or hand-tuned).
    if (typeof action.range === 'number') return action.range;
    // Parsed-monster ranged weapon: range = [near, far] in feet.
    if (Array.isArray(action.range) && typeof action.range[0] === 'number') {
      return Math.max(1, Math.floor(action.range[0] / 5));
    }
    // PC-side 'ranged' marker (no explicit cell range).
    if (action.actionRange === 'ranged') return 6;
    // Parsed-monster melee reach in feet (e.g., 5, 10).
    if (typeof action.reach === 'number') {
      return Math.max(1, Math.floor(action.reach / 5));
    }
    return 1;
  }

  // ─────────── v3.8: thrown weapons + ammo ───────────
  // A thrown weapon is a 'both' (Melee or Ranged) weapon — it can be swung in
  // melee OR hurled. Ammo (number of weapons to throw) is tracked per-combatant
  // in c.ammoLeft[name]; an untracked action (bows, pure melee) is unlimited.
  function actionIsThrown(action) {
    return !!(action && (action.thrown || action.actionRange === 'both'));
  }

  // Melee reach of an action's melee mode, in cells. Falls back to the
  // combatant's natural reach when the action carries no explicit reach.
  function actionMeleeReach(c, action) {
    if (action && typeof action.reach === 'number') return Math.max(1, Math.floor(action.reach / 5));
    return (c && typeof c.naturalReach === 'number') ? c.naturalReach : 1;
  }

  // Remaining thrown ammo for c's action: a number, or Infinity when untracked
  // (unlimited — bows/crossbows/pure-melee weapons).
  function ammoRemaining(c, action) {
    if (!c || !c.ammoLeft || !action) return Infinity;
    const name = action.sourceActionName || action.name;
    if (!(name in c.ammoLeft)) return Infinity;
    const n = c.ammoLeft[name];
    return n == null ? Infinity : n;
  }

  // Populate c.ammoLeft[name] for one action at build time. Finite ammo is
  // tracked; unlimited (bows, pure melee, or an explicit ammo:null) is left
  // absent so ammoRemaining reports Infinity. Thrown weapons default to 2.
  function initAmmoFor(c, action, name) {
    let ammo;
    if (typeof action.ammo === 'number') ammo = action.ammo;   // DM/sheet override
    else if (action.ammo === null)       ammo = null;          // explicit unlimited
    else if (actionIsThrown(action))     ammo = 2;             // thrown default
    else                                 ammo = null;          // untracked
    if (ammo != null) c.ammoLeft[name] = ammo;
  }

  // Spend one thrown weapon. Floors at 0 — the last axe stays in hand, so an
  // out-of-ammo thrown weapon remains usable as a MELEE weapon (resolvesAsRanged
  // returns false once ammo is exhausted).
  function consumeAmmo(c, action) {
    if (!c || !c.ammoLeft || !action) return;
    const name = action.sourceActionName || action.name;
    if (name in c.ammoLeft && c.ammoLeft[name] != null) {
      c.ammoLeft[name] = Math.max(0, c.ammoLeft[name] - 1);
    }
  }

  // Does firing this action from the attacker's current position resolve as a
  // RANGED attack (vs a melee swing)? Pure 'ranged' always does. A thrown
  // ('both') weapon does ONLY when the target is out of melee reach AND ammo
  // remains. No positions → treat as melee (safe default).
  function resolvesAsRanged(attacker, target, action) {
    if (!action) return false;
    if (actionIsThrown(action)) {
      // Thrown ('both') weapon: ranged only when out of melee reach AND ammo
      // remains. Out of ammo → melee-only (the last axe stays in hand).
      if (!(ammoRemaining(attacker, action) > 0)) return false;
      if (typeof CrucibleSpatial === 'undefined'
          || typeof attacker.x !== 'number' || typeof target.x !== 'number') return false;
      return CrucibleSpatial.combatDistance(attacker, target) > actionMeleeReach(attacker, action);
    }
    // Non-thrown: a ranged weapon (explicit 'ranged' tag OR a range profile with
    // no melee mode) always resolves as ranged; a pure melee weapon never does.
    return actionIsRanged(action);
  }

  // Effective range gate (cells) for firing this action at target from here:
  // the thrown/ranged range when it resolves as ranged, else the melee reach.
  // This is what makes an out-of-ammo thrown weapon melee-only at the gate.
  function effectiveAttackNeed(attacker, target, action) {
    return resolvesAsRanged(attacker, target, action)
      ? actionRange(action)
      : actionMeleeReach(attacker, action);
  }

  // Derive a monster's walking speed in cells from whatever shape the
  // bestiary data uses. Bestiary records can be { walk: 30 }, a bare number,
  // or just a "30 ft." string in speedText. Defaults to 6 cells (30 ft).
  function monsterSpeedCells(m) {
    if (!m) return 6;
    if (m.speed && typeof m.speed.walk === 'number') return Math.max(1, Math.floor(m.speed.walk / 5));
    if (typeof m.speed === 'number') return Math.max(1, Math.floor(m.speed / 5));
    const text = typeof m.speedText === 'string' ? m.speedText
                 : (typeof m.speed === 'string' ? m.speed : '');
    if (text) {
      const mm = /(\d+)\s*(?:ft|feet|')/i.exec(text) || /^(\d+)$/.exec(text.trim());
      if (mm) return Math.max(1, Math.floor(parseInt(mm[1], 10) / 5));
    }
    return 6;
  }

  // Natural melee reach in cells. m.reach is feet on imported records;
  // legacy custom records may already be in cells.
  function monsterReachCells(m) {
    if (!m) return 1;
    if (typeof m.reach !== 'number') return 1;
    return m.reach >= 5 ? Math.max(1, Math.floor(m.reach / 5)) : Math.max(1, m.reach);
  }

  // v3.8: creature size → grid footprint side length (cells).
  //   Tiny/Small/Medium → 1, Large → 2, Huge → 3, Gargantuan → 4.
  // Reads the bestiary `size` string (falls back to sizes[0]); unknown → 1.
  const SIZE_CELLS = { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };
  function sizeToCells(size) {
    if (typeof size === 'number') return Math.max(1, Math.floor(size));
    const key = String(size || '').trim().toLowerCase();
    return SIZE_CELLS[key] || 1;
  }
  function monsterSizeCells(m) {
    if (!m) return 1;
    const s = m.size || (Array.isArray(m.sizes) && m.sizes[0]);
    return sizeToCells(s);
  }

  // For multiattack actions, the effective range is the max of any sub-action's
  // range. Monster moves to within that range, then resolveMultiattack picks
  // which sub-attacks to fire per-target.
  // Names a plan step can resolve to: its dynamic options if present, else
  // the single fixed actionName.
  function stepOptionNames(step) {
    if (Array.isArray(step.options) && step.options.length) return step.options;
    if (Array.isArray(step.optionsWeighted) && step.optionsWeighted.length) {
      return step.optionsWeighted.map(o => o.actionName);
    }
    return [step.actionName];
  }

  function multiattackRange(action, allActions) {
    if (action.kind !== 'multiattack' || !Array.isArray(action.multiattackPlan)) return 1;
    let maxR = 0;
    for (const step of action.multiattackPlan) {
      for (const nm of stepOptionNames(step)) {
        const sub = allActions.find(a => (a.sourceActionName || a.name) === nm);
        if (sub) maxR = Math.max(maxR, actionRange(sub));
      }
    }
    return Math.max(1, maxR);
  }

  function targetSaveBonus(target, ability) {
    if (!target || !ability) return 0;
    if (target.side === 'pc' && target.pm) return saveBonus(target.pm, ability);
    const ab = target.monster && target.monster.abilities && target.monster.abilities[ability];
    if (!ab) return 0;
    return ab.save != null ? ab.save : (ab.mod || 0);
  }

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
      const failP = action.autoHit ? 1 : clamp01((action.saveDc - sb - 1) / 20);
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
        // Dynamic-option steps score as their best available option.
        let best = 0;
        for (const nm of stepOptionNames(step)) {
          const sub = subs.find(a => (a.sourceActionName || a.name) === nm);
          if (!sub) continue;
          const cnt = step.optionsWeighted
            ? ((step.optionsWeighted.find(o => o.actionName === nm) || {}).count || 1)
            : (step.count || 1);
          best = Math.max(best, cnt * actionEv(sub, target, ctx));
        }
        sum += best;
      }
      return sum;
    }
    return 0;
  }

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

  // v3.4: resolve a PC's tactical role for the maneuver layer. Explicit
  // tactics.role wins; else derive from the existing position/rangedness
  // heuristics. position() returns 'frontline' | 'midline' | 'backline';
  // rangedness() returns a 0..1 fraction of ranged actions.
  function resolvePcRole(pm) {
    if (pm && pm.tactics && pm.tactics.role) return pm.tactics.role;
    const acts = (pm && pm.actions) || [];
    const hasHeal = acts.some(a => a.type === 'heal');
    const hasAoE  = acts.some(a => a.shape && a.shape !== 'single');
    if (hasHeal) return 'support';
    if (position(pm) === 'frontline') return 'frontline';
    if (hasAoE) return 'caster';
    return rangedness(pm) >= 0.5 ? 'archer' : 'skirmisher';
  }

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

  // ─────────── Role policies ───────────
  // Return the actor's available actions (own parsedActions).
  // Monster-side here; PC-side keeps its own dispatch path.
  function availableMonsterActions(me) {
    const list = (me.monster && me.monster.parsedActions) || [];
    // v3.2: bonus/reaction-bucket actions are not eligible as a main action.
    // (Undefined cost predates the cost field and means 'action' — keep.)
    // This also fixes a latent bug: reaction-bucket attacks (e.g. a monster's
    // opportunity-attack-only action) were previously pickable as main actions.
    return list.filter(a => a.cost !== 'bonus' && a.cost !== 'reaction' && isAvailable(me, a));
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
    // No ranged attack available — fall back. Hand multiattack the
    // _ownerActions ref before scoring so its EV reflects sub-attack output.
    const ma = actions.find(a => a.kind === 'multiattack');
    if (ma) ma._ownerActions = actions;
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
    // Set _ownerActions on multiattack so its EV is scored against sub-attacks.
    const ma = actions.find(a => a.kind === 'multiattack');
    if (ma) ma._ownerActions = actions;
    return bestEvAction(actions, target, ctx,
                        a => ['attack','save','multiattack'].includes(a.kind));
  }

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
        actionsAvailable: 1,
        bonusActionAvailable: true,
        reactionAvailableThisRound: true,
        // v3 turn-scoped flags (NOT in the conditions duration Map).
        dodging: false, hidden: false, helped: false, disengagedThisTurn: false,
        // v3.3 grapple bookkeeping: id of the combatant grappling this one.
        _grappledBy: null,
        speed: typeof pm.combat.speed === 'number' ? pm.combat.speed : 6,
        naturalReach: typeof pm.combat.reach === 'number' ? pm.combat.reach : 1,
        // v3.8: grid footprint (cells per side). PCs default to 1×1 unless the
        // sheet carries an explicit sizeCells override.
        sizeCells: sizeToCells(pm.combat.sizeCells || pm.combat.size || 1),
        x: 0, y: 0,  // populated by placeCombatants in runTrial
      });
      // v3.8: thrown-weapon ammo. A 'both' PC action defaults to 2 throws
      // unless the sheet sets an explicit ammo count (null = unlimited).
      const pc = out[out.length - 1];
      pc.ammoLeft = {};
      for (const a of (pm.actions || [])) {
        initAmmoFor(pc, a, a.name);
      }
      // Initialize feature state for any PC class features on this PC.
      // (No-op when PC has no features array — backward compatible.)
      if (typeof PCFeatures !== 'undefined') {
        PCFeatures.initFeatureState(pc);
      }
    }
    for (const pick of (monsterPicks || [])) {
      const m = pick.monster;
      const n = pick.count || 1;
      for (let i = 1; i <= n; i++) {
        const hp = rollHp && m.hpFormula
          ? Math.max(1, rollDice(m.hpFormula, rng))
          : (m.hp || 1);
        const slotsLeft = {}, rechargeReady = {}, ammoLeft = {};
        for (const pa of (m.parsedActions || [])) {
          if (pa.usesPerDay != null) slotsLeft[pa.sourceActionName] = pa.usesPerDay;
          if (pa.recharge)          rechargeReady[pa.sourceActionName] = true;
          initAmmoFor({ ammoLeft }, pa, pa.sourceActionName);
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
          slotsLeft, rechargeReady, ammoLeft,
          damageTypesReceivedLastTurn: new Set(),
          damageTypesReceivedThisTurn: new Set(),
          lastHealRound: -99,
          regeneration: m.regeneration || null,
          speed: monsterSpeedCells(m),
          naturalReach: monsterReachCells(m),
          // v3.8: grid footprint derived from the bestiary size string.
          sizeCells: monsterSizeCells(m),
          x: 0, y: 0,
          reactionAvailableThisRound: true,
          // v3 turn-scoped flags (NOT in the conditions duration Map).
          dodging: false, hidden: false, helped: false, disengagedThisTurn: false,
          // v3.3 grapple bookkeeping: id of the combatant grappling this one.
          _grappledBy: null,
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

  // ─────────── Turn start (round-loop steps 1-4) ───────────
  function tickConditions(c) {
    // Decrement every condition's remaining rounds; lift those at 0.
    for (const [name, rem] of Array.from(c.conditions.entries())) {
      const next = rem - 1;
      if (next <= 0) c.conditions.delete(name);
      else c.conditions.set(name, next);
    }
  }

  // Effective speed in cells after condition effects. Grappled/restrained → 0.
  function effectiveSpeed(c) {
    const base = c.speed || 0;
    const cc = c.conditions;
    if (cc && (cc.has('grappled') || cc.has('restrained'))) return 0;
    return base;
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

  // ─────────── Target selection ───────────
  function aliveEnemies(me, all) {
    return all.filter(c => c !== me && c.side !== me.side && !c.dead && !c.downed);
  }
  function aliveAllies(me, all, includeSelf) {
    return all.filter(c => c.side === me.side && !c.dead && (includeSelf || c !== me));
  }

  function pickEnemyTarget(me, all, tactics, rng, action) {
    const enemies = all.filter(t => t.side !== me.side && !t.dead && !t.downed);
    if (enemies.length === 0) return null;
    if (typeof CrucibleSpatial !== 'undefined' && action) {
      const map = me._mapRef || { width: 20, height: 20, blocked: null };
      let best = null, bestScore = -Infinity;
      for (const e of enemies) {
        const s = CrucibleSpatial.scoreTarget(e, me, action, all, map, tactics);
        if (s > bestScore) { bestScore = s; best = e; }
      }
      return best;
    }
    // v1 fallback: lowest HP, ties broken by lowest AC (matches the Brute /
    // Ambusher role-policy pickers — the AC tiebreak was lost when Phase 6
    // rewrote this as an HP-only sort).
    return enemies.slice().sort((a, b) =>
      a.hp - b.hp || (a.ac || 10) - (b.ac || 10))[0];
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

  // ─────────── Advantage state for an attack roll ───────────
  // Net advantage state for an attack roll, per the spec's source table.
  // Melee = chebyshev dist <= 1 when positions exist, else actionRange check.
  function attackAdvantageState(attacker, target, action, combatants) {
    const isMelee = (typeof attacker.x === 'number' && typeof target.x === 'number'
                     && typeof CrucibleSpatial !== 'undefined')
      ? CrucibleSpatial.combatDistance(attacker, target) <= 1
      : action.actionRange !== 'ranged';
    let adv = false, dis = false;
    const tc = target.conditions, ac = attacker.conditions;
    // Target state.
    if (tc && tc.has('prone')) { if (isMelee) adv = true; else dis = true; }
    if (target.dodging) dis = true;
    if (tc && (tc.has('restrained') || tc.has('blinded') || tc.has('stunned')
               || tc.has('paralyzed') || tc.has('unconscious'))) adv = true;
    if (target.hidden) dis = true;
    // Attacker state.
    if (ac && (ac.has('prone') || ac.has('poisoned') || ac.has('frightened')
               || ac.has('restrained') || ac.has('blinded'))) dis = true;
    if (attacker.hidden) adv = true;
    if (attacker.helped) adv = true;
    // v3.8: ranged/thrown-at-range attack made while an enemy is adjacent to
    // the ATTACKER → disadvantage (5e RAW). A thrown weapon swung in melee
    // resolves as melee (resolvesAsRanged → false) and is NOT penalized.
    if (combatants && typeof CrucibleSpatial !== 'undefined'
        && typeof attacker.x === 'number'
        && resolvesAsRanged(attacker, target, action)) {
      const pinned = combatants.some(d => d !== attacker && d.side !== attacker.side
        && !d.dead && !d.downed && typeof d.x === 'number'
        && CrucibleSpatial.combatDistance(attacker, d) <= 1);
      if (pinned) dis = true;
    }
    return netAdvantage(adv, dis);
  }

  // ─────────── Resolve a monster-side attack action ───────────
  // For a PC-side attack, the engine uses resolveAttackPc (next task block).
  function resolveAttackMonster(me, target, action, rng, events, round, combatants) {
    // v2 spatial: refuse out-of-range. Prevents callers from triggering the
    // target's onAttackAttempt hooks (Shield etc.) from a position that
    // could never have hit. Returns a deterministic miss so callers that
    // tally results still get a sensible object back.
    if (typeof CrucibleSpatial !== 'undefined'
        && typeof me.x === 'number' && typeof target.x === 'number') {
      const need = effectiveAttackNeed(me, target, action);
      if (CrucibleSpatial.combatDistance(me, target) > need) {
        return { roll: 0, crit: false, hit: false, damageDealt: 0, damageByType: {} };
      }
    }
    me.hasAttacked = true;
    // v3.8: a thrown weapon fired at range expends one weapon; swung in melee
    // it does not. Determine the mode BEFORE the event so it carries `thrown`.
    const firedAsRanged = resolvesAsRanged(me, target, action);
    const isThrownThrow = firedAsRanged && actionIsThrown(action);
    if (isThrownThrow) consumeAmmo(me, action);
    const advState = attackAdvantageState(me, target, action, combatants);
    const roll = rollD20(rng, advState);
    const isCrit = roll === 20;
    const isFumble = roll === 1;
    let hit = !isFumble && (isCrit || roll + (action.toHit || 0) >= (target.ac || 10));

    // Allow target's reaction features (Shield) to modify the hit.
    if (target.side === 'pc' && typeof PCFeatures !== 'undefined') {
      const rollCtx = { roll, hits: hit, action, eventLog: events, round, combatants };
      PCFeatures.dispatchHook(target, 'onAttackAttempt', action, target, rollCtx);
      hit = rollCtx.hits;
    }

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
                  damageDealt, adv: advState,
                  ...(isThrownThrow ? { thrown: true } : {}) });
    // v3.5: on-hit rider condition + forced movement.
    if (hit) applyAttackRider(me, target, action, rng, events, round);
    if (hit && action.push > 0) pushTarget(me, target, action.push, me._mapRef, combatants, events, round);
    // Consume one-shot flags: Help grants advantage on ONE attack; attacking
    // from hiding reveals the attacker.
    if (me.hidden) me.hidden = false;
    if (me.helped) me.helped = false;
    return { roll, crit:isCrit, hit, damageDealt, damageByType };
  }

  // ─────────── Resolve a PC-side attack action ───────────
  // combatants is optional; required only for the broadcast onAttackAttempt
  // hook (Bardic Inspiration etc.). Tests call without it.
  function resolveAttackPc(me, target, action, rng, events, round, combatants) {
    // v2 spatial: refuse out-of-range, same as resolveAttackMonster.
    if (typeof CrucibleSpatial !== 'undefined'
        && typeof me.x === 'number' && typeof target.x === 'number') {
      const need = effectiveAttackNeed(me, target, action);
      if (CrucibleSpatial.combatDistance(me, target) > need) {
        return { roll: 0, crit: false, hit: false, damageDealt: 0, damageByType: {} };
      }
    }
    // Pre-attack hook — fires only when the attack will actually proceed (i.e.
    // the range guard above didn't bail). Used by Rage, Action Surge, etc.
    // PC-only by design; resolveAttackMonster does not dispatch this hook.
    if (me.side === 'pc' && typeof PCFeatures !== 'undefined') {
      PCFeatures.dispatchHook(me, 'onBeforeOwnAttack', action, target,
        { round, combatants: combatants || [], eventLog: events });
    }
    // v3.8: thrown-at-range expends a weapon; a melee swing does not.
    const firedAsRanged = resolvesAsRanged(me, target, action);
    const isThrownThrow = firedAsRanged && actionIsThrown(action);
    if (isThrownThrow) consumeAmmo(me, action);
    // PC actions store inputs; derive to-hit + damage roll.
    const th = toHit(me.pm, action);
    const advState = attackAdvantageState(me, target, action, combatants);
    const roll = rollD20(rng, advState);
    const isCrit = roll === 20;
    const isFumble = roll === 1;
    let hit = !isFumble && (isCrit || roll + th >= (target.ac || 10));
    // Broadcast onAttackAttempt: allow any PC's features (e.g., Bardic Inspiration
    // held by an ally) to boost this PC's attack roll.
    // me is the attacking PC; broadcast so the bard (or any other PC) can spend a die.
    if (typeof PCFeatures !== 'undefined' && me && combatants) {
      const rollCtx = { roll, hits: hit, action, eventLog: events, round, combatants };
      PCFeatures.dispatchBroadcastHook(combatants, me, 'onAttackAttempt',
        me, target, rollCtx);
      hit = rollCtx.hits;
    }
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
                  action: action.name, roll, crit:isCrit, hit, damageDealt,
                  adv: advState,
                  ...(isThrownThrow ? { thrown: true } : {}) });
    // v3.5: on-hit rider condition + forced movement.
    if (hit) applyAttackRider(me, target, action, rng, events, round);
    if (hit && action.push > 0) pushTarget(me, target, action.push, me._mapRef, combatants, events, round);
    // Consume one-shot flags: Help grants advantage on ONE attack; attacking
    // from hiding reveals the attacker.
    if (me.hidden) me.hidden = false;
    if (me.helped) me.helped = false;
    return { roll, crit:isCrit, hit, damageDealt, damageByType };
  }

  // ─────────── Resolve an opportunity attack ───────────
  // Resolve an opportunity attack from `defender` against `leaver`. Picks the
  // defender's best melee single-target attack and runs it through the normal
  // attack pipeline so feature dice (Sneak Attack / Hex / etc.) still ride along.
  function resolveOpportunityAttack(defender, leaver, rng, events, round, combatants) {
    const list = defender.side === 'monster'
      ? (defender.monster && defender.monster.parsedActions) || []
      : ((defender.pm && defender.pm.actions) || []).map(a => ({
          ...a, sourceActionName: a.name, kind: a.type,
        }));
    const action = list.find(a =>
      a.kind === 'attack' && (a.actionRange === 'melee' || !a.actionRange));
    if (!action) return;
    const r = defender.side === 'monster'
      ? resolveAttackMonster(defender, leaver, action, rng, events, round, combatants)
      : resolveAttackPc(defender, leaver, action, rng, events, round, combatants);
    events.push({
      type: 'opportunity-attack', round,
      attacker: defender.id, attackerName: defender.name,
      target: leaver.id, targetName: leaver.name,
      fromCell: { x: defender.x, y: defender.y },
      triggerCell: { x: leaver.x, y: leaver.y },
      roll: r.roll, hit: r.hit, damageDealt: r.damageDealt,
    });
    if (r.hit && r.damageDealt > 0) {
      for (const [t, dmg] of Object.entries(r.damageByType || {})) {
        applyDamage(leaver, dmg, t, defender, events, round, defender.name,
                    'opportunity ' + (action.sourceActionName || action.name));
      }
    }
  }

  // ─────────── v3.5: attack riders, forced movement, buff actions ───────────

  // On-hit rider condition. Target saves vs the rider DC; on a failure the
  // condition lands with a round-based duration ticked by tickConditions.
  // saveDc: null means derive (PC: 8 + atkAbility mod + PB; monster:
  // maneuverDc(attacker)). Called from inside resolveAttackPc/Monster
  // immediately after the attack event, guarded by `if (hit)`.
  function applyAttackRider(attacker, target, action, rng, events, round) {
    const r = action.rider;
    if (!r || !r.condition || target.dead) return;
    let dc = r.saveDc;
    if (dc == null) {
      dc = attacker.side === 'pc'
        ? 8 + mod((attacker.pm && attacker.pm.abilities && attacker.pm.abilities[action.atkAbility]) || 10)
            + pb((attacker.pm && attacker.pm.identity && attacker.pm.identity.level) || 1)
        : maneuverDc(attacker);
    }
    const saveAction = { saveAbility: r.saveAbility || 'con', saveDc: dc };
    let failed;
    if (autoFailsSave(target, saveAction)) {
      failed = true;
    } else {
      const roll = rollD20(rng, saveAdvantageState(target, saveAction))
                 + targetSaveBonus(target, saveAction.saveAbility);
      failed = roll < dc;
    }
    if (failed) {
      target.conditions.set(r.condition, Math.max(1, r.duration || 1));
      events.push({ type: 'condition-applied', round,
                    who: attacker.id, name: attacker.name,
                    target: target.id, targetName: target.name,
                    condition: r.condition, duration: r.duration || 1, dc });
    }
  }

  // Forced movement on hit. Push target up to `cells` straight away from the
  // attacker, stopping at map edge, wall, or another combatant. No save
  // (weapon property semantics, e.g. 2024 Push mastery). `map` comes from
  // the attacker's `_mapRef` (set on every combatant in runTrial); unit-test
  // call sites without it simply skip (no push, no crash).
  // v3.8: does target's N×N footprint fit at anchor (ax, ay) — in-bounds,
  // no wall, and not overlapping any other living combatant's footprint?
  function footprintFits(map, ax, ay, target, combatants) {
    const n = Math.max(1, (target && target.sizeCells) || 1);
    const occupied = new Set();
    for (const d of (combatants || [])) {
      if (d === target || d.dead || d.downed || typeof d.x !== 'number') continue;
      for (const cell of CrucibleSpatial.footprintCells(d)) occupied.add(cell.x + ',' + cell.y);
    }
    for (let dy = 0; dy < n; dy++) {
      for (let dx = 0; dx < n; dx++) {
        const cx = ax + dx, cy = ay + dy;
        if (cx < 0 || cx >= map.width || cy < 0 || cy >= map.height) return false;
        if (CrucibleSpatial.isWall(map, cx, cy)) return false;
        if (occupied.has(cx + ',' + cy)) return false;
      }
    }
    return true;
  }

  function pushTarget(attacker, target, cells, map, combatants, events, round) {
    if (!map || typeof CrucibleSpatial === 'undefined' || target.dead) return 0;
    const dx = Math.sign(target.x - attacker.x), dy = Math.sign(target.y - attacker.y);
    if (dx === 0 && dy === 0) return 0;
    let moved = 0;
    for (let i = 0; i < cells; i++) {
      const nx = target.x + dx, ny = target.y + dy;
      // Move the anchor only if the whole footprint clears at the new anchor.
      if (!footprintFits(map, nx, ny, target, combatants)) break;
      target.x = nx; target.y = ny; moved++;
    }
    if (moved > 0) {
      events.push({ type: 'push', round, who: attacker.id, name: attacker.name,
                    target: target.id, targetName: target.name,
                    cells: moved, to: { x: target.x, y: target.y } });
    }
    return moved;
  }

  // Buff action — grant a v3 flag to self or an adjacent ally. Returns true
  // if applied (so callers only consume resources / tally on success).
  function resolveBuff(c, all, action, events, round) {
    let recipient = c;
    if (action.buffTarget === 'ally') {
      recipient = (all || []).find(a => a.side === c.side && a !== c && !a.dead && !a.downed
        && typeof CrucibleSpatial !== 'undefined'
        && CrucibleSpatial.combatDistance(c, a) <= 1) || null;
      if (!recipient) return false;
    }
    if (action.grants === 'dodging') recipient.dodging = true;
    else if (action.grants === 'helped') recipient.helped = true;
    else return false;
    events.push({ type: 'buff', round, who: c.id, name: c.name,
                  target: recipient.id, targetName: recipient.name,
                  grants: action.grants });
    return true;
  }

  // ─────────── v3.3: standard 5.5e actions ───────────

  // Dodge: until the start of its next turn, attacks vs c have disadvantage
  // and c makes DEX saves with advantage (both already honored by
  // attackAdvantageState / saveAdvantageState via the dodging flag).
  function resolveDodge(c, events, round) {
    c.dodging = true;
    events.push({ type: 'dodge', round, who: c.id, name: c.name });
  }

  // Disengage: c's movement this turn does not provoke opportunity attacks.
  function resolveDisengage(c, events, round) {
    c.disengagedThisTurn = true;
    events.push({ type: 'disengage', round, who: c.id, name: c.name });
  }

  // Help: grant an adjacent ally advantage on its next attack roll.
  function resolveHelp(c, ally, events, round) {
    ally.helped = true;
    events.push({ type: 'help', round, who: c.id, name: c.name,
                  target: ally.id, targetName: ally.name });
  }

  // Hide: only possible when no living enemy has line of sight to c.
  // Contest: d20 + DEX mod vs the highest enemy passive perception
  // (10 + WIS mod). Success sets the hidden flag (adv on next attack,
  // attacks vs c at dis; broken when c attacks).
  function resolveHide(c, all, map, rng, events, round) {
    const enemies = all.filter(t => t.side !== c.side && !t.dead && !t.downed);
    const seen = typeof CrucibleSpatial !== 'undefined'
      && enemies.some(e => CrucibleSpatial.hasLineOfSight(map, e, c));
    if (seen) {
      events.push({ type: 'hide', round, who: c.id, name: c.name, success: false, reason: 'seen' });
      return false;
    }
    const dexMod = combatantAbilityMod(c, 'dex');
    const stealth = rollDie(20, rng) + dexMod;
    let bestPP = 10;
    for (const e of enemies) bestPP = Math.max(bestPP, 10 + combatantAbilityMod(e, 'wis'));
    const success = stealth >= bestPP;
    if (success) c.hidden = true;
    events.push({ type: 'hide', round, who: c.id, name: c.name, success, roll: stealth, dc: bestPP });
    return success;
  }

  // Shared ability-mod accessor for either side's data shape.
  // PCs store raw ability scores (mod() derives the modifier); monsters carry
  // pre-computed { mod, save } objects from the parser.
  function combatantAbilityMod(c, ability) {
    if (c.side === 'pc' && c.pm && c.pm.abilities) return mod(c.pm.abilities[ability] || 10);
    if (c.monster && c.monster.abilities && c.monster.abilities[ability]) {
      const a = c.monster.abilities[ability];
      return typeof a.mod === 'number' ? a.mod : 0;
    }
    return 0;
  }

  // Grapple/Shove DC per 5.5e unarmed strike: 8 + STR mod + PB.
  // Monster PB comes from monster.pb when present (the parser already reads it
  // at crucible-parser.js:292); bestiary monsters lacking the field default to
  // 2 (CR ≤ 4).
  function maneuverDc(attacker) {
    const str = combatantAbilityMod(attacker, 'str');
    const prof = attacker.side === 'pc'
      ? pb((attacker.pm && attacker.pm.identity && attacker.pm.identity.level) || 1)
      : ((attacker.monster && attacker.monster.pb) || 2);
    return 8 + str + prof;
  }

  // Target's maneuver save: best of STR/DEX (2024: target's choice).
  function maneuverSaveBonus(target) {
    return Math.max(combatantAbilityMod(target, 'str'), combatantAbilityMod(target, 'dex'));
  }

  // Grapple: save-based. Fail → grappled (speed 0), tracked with the
  // grappler's id so release/escape work. Requires melee adjacency.
  function resolveGrapple(attacker, target, rng, events, round) {
    const dc = maneuverDc(attacker);
    const roll = rollD20(rng, 0) + maneuverSaveBonus(target);
    const success = roll < dc;
    if (success) {
      target.conditions.set('grappled', 99);   // duration managed by escape/release, not ticking
      target._grappledBy = attacker.id;
    }
    events.push({ type: 'grapple', round, who: attacker.id, name: attacker.name,
                  target: target.id, targetName: target.name,
                  success, roll, dc });
    return success;
  }

  // Shove: save-based. mode 'push' → 1 cell straight away from attacker
  // (only if the destination is in bounds, not a wall, not occupied);
  // mode 'prone' → knocked prone. Fail-safe: an invalid push cell degrades
  // to no effect (the save still happened).
  function resolveShove(attacker, target, rng, events, round, map, combatants, mode) {
    const dc = maneuverDc(attacker);
    const roll = rollD20(rng, 0) + maneuverSaveBonus(target);
    const failed = roll < dc;
    let outcome = 'resisted';
    if (failed) {
      if (mode === 'prone') {
        target.conditions.set('prone', 99);    // cleared by stand-up
        outcome = 'prone';
      } else {
        const dx = Math.sign(target.x - attacker.x);
        const dy = Math.sign(target.y - attacker.y);
        const nx = target.x + dx, ny = target.y + dy;
        // v3.8: move the anchor only if the target's whole footprint fits.
        const fits = map && typeof CrucibleSpatial !== 'undefined'
          && footprintFits(map, nx, ny, target, combatants);
        if (fits && (dx !== 0 || dy !== 0)) {
          target.x = nx; target.y = ny;
          outcome = 'pushed';
        } else {
          outcome = 'blocked';
        }
      }
    }
    events.push({ type: 'shove', round, who: attacker.id, name: attacker.name,
                  target: target.id, targetName: target.name, mode,
                  outcome, roll, dc,
                  to: outcome === 'pushed' ? { x: target.x, y: target.y } : null });
    return outcome;
  }

  // v3.3: turn-start automatic recovery — stand up from prone, then attempt to
  // escape a grapple (or auto-release if the grappler is gone). Extracted from
  // the turn loop so it's unit-testable with hand-built combatants. Must be
  // called AFTER c.movementBudgetThisTurn has been set to effectiveSpeed(c).
  function applyTurnStartRecovery(c, combatants, rng, events, round) {
    // Stand-up: prone combatants stand at turn start if they can move,
    // spending half the turn's movement budget.
    if (c.conditions.has('prone') && c.movementBudgetThisTurn > 0) {
      c.conditions.delete('prone');
      c.movementBudgetThisTurn = Math.floor(c.movementBudgetThisTurn / 2);
      events.push({ type: 'stand-up', round, who: c.id, name: c.name });
    }
    // Grapple escape: one free attempt at turn start (RAW it's an action; the
    // sim simplifies to keep fights moving). Escape DC = grappler's maneuver DC.
    // ORDERING NOTE: a grappled+prone combatant has a 0 movement budget
    // (effectiveSpeed → 0 while grappled), so the stand-up guard above fails
    // and it stays prone this turn, then escapes the grapple here. Accepted
    // simplification — it takes two turns to fully recover from prone+grapple.
    if (c.conditions.has('grappled')) {
      const grappler = combatants.find(d => d.id === c._grappledBy);
      if (!grappler || grappler.dead || grappler.downed) {
        c.conditions.delete('grappled');
        c._grappledBy = null;
        events.push({ type: 'condition-ended', round, who: c.id, name: c.name,
                      condition: 'grappled', reason: 'grappler-down' });
        c.movementBudgetThisTurn = effectiveSpeed(c);  // recompute now that grapple is gone
      } else {
        const dc = maneuverDc(grappler);
        const roll = rollD20(rng, 0) + maneuverSaveBonus(c);
        if (roll >= dc) {
          c.conditions.delete('grappled');
          c._grappledBy = null;
          events.push({ type: 'condition-ended', round, who: c.id, name: c.name,
                        condition: 'grappled', reason: 'escaped', roll, dc });
          c.movementBudgetThisTurn = effectiveSpeed(c);  // recompute now that grapple is gone
        } else {
          events.push({ type: 'grapple-escape-failed', round, who: c.id, name: c.name, roll, dc });
        }
      }
    }
  }

  // ─────────── Move a combatant toward a target ───────────
  // Walks an A* path cell-by-cell up to `maxSteps`, firing opportunity
  // attacks whenever the mover leaves an enemy's threatened reach. Emits a
  // single `move` event tagged with `reason` (e.g. 'engage' for free
  // movement, 'dash' when the action is being spent as Dash). Returns the
  // number of cells actually traversed (may be 0 if blocked or dead mid-step).
  function executeMove(c, target, maxSteps, reason, combatants, map, rng, events, round) {
    if (typeof CrucibleSpatial === 'undefined') return 0;
    if (maxSteps <= 0) return 0;
    // Build occupied-cells set so the path can't pass through other
    // combatants. Self is excluded (we're leaving), and the target's cell
    // is implicitly avoided by stopWhenAdjacent.
    const occupied = new Set();
    for (const d of combatants) {
      if (d === c || d.dead || d.downed) continue;
      if (typeof d.x !== 'number' || typeof d.y !== 'number') continue;
      // v3.8: block every cell of the other combatant's footprint.
      for (const cell of CrucibleSpatial.footprintCells(d)) occupied.add(cell.x + ',' + cell.y);
    }
    const path = CrucibleSpatial.findPath(
      { x: c.x, y: c.y },
      { x: target.x, y: target.y },
      map,
      { maxSteps, stopWhenAdjacent: target, occupied, sizeCells: c.sizeCells }
    );
    return executePath(c, path, reason, combatants, rng, events, round);
  }

  // Walk c along an explicit, precomputed path. OoA-aware. Stops if c dies.
  // Used by the LOS-aware reposition branch (which produces a path that ends
  // exactly on the shooting cell, not one short of it).
  function executePath(c, path, reason, combatants, rng, events, round) {
    if (!path || path.length === 0) return 0;
    const from = { x: c.x, y: c.y };
    const stepped = [];
    for (const cell of path) {
      const prev = { x: c.x, y: c.y };
      // OoA detection: any enemy adjacent before step, not after.
      // v3.3 Disengage: a disengaged mover provokes no opportunity attacks
      // this turn — skip the entire enemy scan.
      if (!c.disengagedThisTurn) {
        for (const d of combatants) {
          if (d.side === c.side || d.dead || d.downed) continue;
          if (!d.reactionAvailableThisRound) continue;
          const reach = d.naturalReach || 1;
          // Footprint-aware: measure the defender against the mover's whole
          // footprint at the previous and current anchor.
          const dPrev = CrucibleSpatial.combatDistance(d, { x: prev.x, y: prev.y, sizeCells: c.sizeCells });
          const dCur  = CrucibleSpatial.combatDistance(d, { x: cell.x, y: cell.y, sizeCells: c.sizeCells });
          if (dPrev > 0 && dPrev <= reach && dCur > reach) {
            resolveOpportunityAttack(d, c, rng, events, round, combatants);
            d.reactionAvailableThisRound = false;
            if (c.dead || c.downed) break;
          }
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
        from, to: { x: c.x, y: c.y }, path: stepped, reason: reason || 'engage',
      });
    }
    return stepped.length;
  }

  // ─────────── Advantage / auto-fail on saving throws ───────────
  // Net advantage on a saving throw. Dodging grants adv on DEX saves;
  // restrained gives dis on DEX saves. Stunned/paralyzed/unconscious
  // auto-fail STR and DEX saves — callers check autoFailsSave() first.
  function saveAdvantageState(target, action) {
    const ability = action.saveAbility || 'dex';
    let adv = false, dis = false;
    if (ability === 'dex') {
      if (target.dodging) adv = true;
      if (target.conditions && target.conditions.has('restrained')) dis = true;
    }
    return netAdvantage(adv, dis);
  }

  function autoFailsSave(target, action) {
    const ability = action.saveAbility || 'dex';
    if (ability !== 'str' && ability !== 'dex') return false;
    const tc = target.conditions;
    return !!(tc && (tc.has('stunned') || tc.has('paralyzed') || tc.has('unconscious')));
  }

  // ─────────── Resolve a save effect ───────────
  function resolveSave(me, targets, action, rng, events, round, combatants) {
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
      // Stunned/paralyzed/unconscious auto-fail STR/DEX saves. This routes
      // through the same damage/condition application path as a natural
      // failure, but draws NO d20 (which shifts the rng stream for later
      // rolls — acceptable, the trial is event-sourced).
      let roll, passed;
      if (action.autoHit) {
        // v3.9: save-less automatic damage ("each creature … takes X damage").
        // No roll is drawn; damageOnFail applies in full.
        roll = 0;
        passed = false;
      } else if (autoFailsSave(t, action)) {
        roll = 0;
        passed = false;
      } else {
        const saveAdv = saveAdvantageState(t, action);
        roll = rollD20(rng, saveAdv);
        // Broadcast onSaveAttempt: allow any PC's features (e.g., Bardic
        // Inspiration held by an ally) to add a bonus to this save.
        let broadcastSaveBonus = 0;
        if (typeof PCFeatures !== 'undefined' && t && combatants) {
          const saveRollCtx = { roll, bonus: 0, eventLog: events, round, combatants };
          PCFeatures.dispatchBroadcastHook(combatants, t, 'onSaveAttempt',
            action.saveAbility, action.saveDc, saveRollCtx);
          broadcastSaveBonus = saveRollCtx.bonus || 0;
        }
        passed = (roll + broadcastSaveBonus) + sb >= action.saveDc;
      }
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
      const saveEvt = { round, type:'save', actor: me.name, target: t.name,
                        action: action.sourceActionName, roll, passed, damageDealt: dmg };
      if (action.autoHit) saveEvt.autoHit = true;
      events.push(saveEvt);
    }
    return { totalDmg };
  }

  // ─────────── v2 spatial: resolve an AoE action ───────────
  // For sphere/cube/cone/line actions, enumerate viable cast points, score each
  // by expected damage on enemies minus friendly-fire on allies, then run the
  // save pipeline per affected target. Damage is applied by resolveSave
  // internally — we don't re-apply here. Emits one 'aoe' event summarizing the
  // shape, center, and per-target outcome (alongside the per-target 'save'
  // events resolveSave pushes).
  function resolveAoE(c, action, combatants, map, rng, events, round) {
    if (typeof CrucibleSpatial === 'undefined') return null;
    const Spatial = CrucibleSpatial;
    const candidates = Spatial.enumerateCastPoints(c, action, map);
    // v2 terrain: filter cast points to those with LOS from the caster.
    // Cone/line cast points are anchored at the caster (origin = caster cell)
    // so LOS to themselves is trivially true; this primarily prunes sphere/cube
    // candidates that lie behind a wall.
    const filteredCandidates = candidates.filter(p =>
      Spatial.hasLineOfSight(map, { x: c.x, y: c.y }, { x: p.x, y: p.y })
    );
    const ev = Spatial.expectedDamage(action);
    let best = null;
    for (const point of filteredCandidates) {
      let cells;
      switch (action.shape) {
        case 'sphere': cells = Spatial.sphereCells(point, action.size); break;
        case 'cube':   cells = Spatial.cubeCells(point, action.size); break;
        case 'cone':   cells = Spatial.coneCells(point, point.dir, action.size); break;
        case 'line':   cells = Spatial.lineCells(point, point.dir, action.size); break;
        default: return null;
      }
      const hit = Spatial.combatantsAt(cells, combatants);
      const enemies = hit.filter(t => t.side !== c.side);
      const allies  = hit.filter(t => t.side === c.side && t !== c);
      const score = enemies.length * ev - allies.length * ev * 0.5;
      if (!best || score > best.score) best = { point, cells, score, enemies, allies };
    }
    if (!best || best.score <= 0) return null;
    const targets = [];
    const allHit = best.enemies.concat(best.allies);
    const dmgType = (action.damageOnFail && action.damageOnFail[0] && action.damageOnFail[0].type)
                 || (action.damage && action.damage.type)
                 || 'untyped';
    for (const t of allHit) {
      // resolveSave applies damage internally and pushes a per-target 'save'
      // event into `events`. Snapshot length before so we can find this
      // target's save event for the `saved` flag.
      const evBefore = events.length;
      const saveResult = resolveSave(c, [t], action, rng, events, round, combatants);
      const tDmg = (saveResult && saveResult.totalDmg) || 0;
      let saved = false;
      for (let i = evBefore; i < events.length; i++) {
        const ev = events[i];
        if (ev && ev.type === 'save' && ev.target === t.name) {
          saved = !!ev.passed; break;
        }
      }
      targets.push({
        id: t.id, name: t.name, pos: { x: t.x, y: t.y },
        dmg: tDmg, dmgType,
        saved,
      });
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
  // re-picks its target — for monsters, via the role policy's pickTarget so
  // Brute multiattacks honor frontline preference, Artillery favors backline,
  // etc. If the policy's chosen target drops mid-multiattack, the next swing
  // re-picks fresh (still in the policy's preferred bucket).
  function resolveMultiattack(me, all, multiAction, tactics, rng, events, round) {
    const myActions = me.side === 'monster'
      ? (me.monster && me.monster.parsedActions) || []
      : (me.pm && me.pm.actions) || [];
    let warnings = [];

    // Build the per-sub-attack target picker. For monsters with a known role,
    // use that policy's pickTarget. For PCs (and as a safety fallback for
    // monsters without role data), use the v1 focus-fire helper.
    let pickSubTarget;
    if (me.side === 'monster' && me.monster) {
      const role = resolveRole(me.monster);
      const policy = ROLE_POLICIES[role] || ROLE_POLICIES.soldier;
      const policyCtx = {
        round, rng, tactics,
        livingEnemyCount: aliveEnemies(me, all).length,
        all,
      };
      pickSubTarget = () => {
        const t = policy.pickTarget(me, all, policyCtx);
        if (!t) return null;
        // Controller AoE picks return an array; multiattack sub-attacks are
        // single-target by their nature — take the first.
        return Array.isArray(t) ? t[0] : t;
      };
    } else {
      pickSubTarget = (subAction) => pickEnemyTarget(me, all, tactics, rng, subAction);
    }

    // v3.9: pick the best usable option for one swing of a dynamic-option
    // step ("using X or Y in any combination"). Prefer a melee option when
    // the target is inside its reach (a ranged shot there takes disadvantage
    // and a thrown one wastes ammo); otherwise any option whose effective
    // range reaches; ties break toward higher average damage.
    const chooseOptionSub = (tgt, optionNames) => {
      const subs = [];
      for (const nm of optionNames) {
        const s = myActions.find(a => (a.sourceActionName || a.name) === nm);
        if (s && s.kind === 'attack') subs.push(s);
      }
      if (!subs.length) return null;
      const avg = s => sumDice(s.damage || []);
      const spatial = typeof CrucibleSpatial !== 'undefined'
        && typeof me.x === 'number' && tgt && typeof tgt.x === 'number';
      if (!spatial) return subs.slice().sort((a, b) => avg(b) - avg(a))[0];
      const dist = CrucibleSpatial.combatDistance(me, tgt);
      const usable = subs.filter(s => dist <= effectiveAttackNeed(me, tgt, s));
      const pool = usable.length ? usable : subs;
      const meleeHere = pool.filter(s => !resolvesAsRanged(me, tgt, s)
                                      && dist <= actionMeleeReach(me, s));
      return (meleeHere.length ? meleeHere : pool)
        .slice().sort((a, b) => avg(b) - avg(a))[0];
    };

    for (const step of (multiAction.multiattackPlan || [])) {
      const hasOptions = (Array.isArray(step.options) && step.options.length)
        || (Array.isArray(step.optionsWeighted) && step.optionsWeighted.length);
      const optionNames = hasOptions ? stepOptionNames(step) : null;
      const fixedSub = myActions.find(a =>
        (a.sourceActionName || a.name) === step.actionName);
      if (!hasOptions && (!fixedSub || fixedSub.kind === 'unparsed')) {
        warnings.push(`Multiattack sub-action '${step.actionName}' not found on ${me.name} — treated as a single attack.`);
        continue;
      }
      let count = step.count || 1;
      let lockedWeighted = null;   // optionsWeighted: one choice per step; its count applies
      for (let i = 0; i < count; i++) {
        const tgt = pickSubTarget(fixedSub || null);
        if (!tgt) break;
        let sub = fixedSub;
        if (hasOptions) {
          sub = lockedWeighted || chooseOptionSub(tgt, optionNames) || fixedSub;
          if (step.optionsWeighted && !lockedWeighted && sub) {
            lockedWeighted = sub;
            const w = step.optionsWeighted.find(o =>
              o.actionName === (sub.sourceActionName || sub.name));
            if (w && w.count) count = w.count;
          }
        }
        if (!sub || sub.kind === 'unparsed') {
          warnings.push(`Multiattack sub-action '${step.actionName}' not found on ${me.name} — treated as a single attack.`);
          break;
        }
        // v2 spatial: skip sub-attacks whose own range can't reach this
        // target. Multiattack range is the max across sub-actions so the
        // monster moves close enough for at least one sub-attack; the
        // shorter-ranged sub-attacks are silently dropped per swing.
        // (effectiveAttackNeed keeps out-of-ammo thrown subs melee-only.)
        if (typeof CrucibleSpatial !== 'undefined'
            && typeof me.x === 'number' && typeof tgt.x === 'number') {
          const subNeed = sub.kind === 'attack'
            ? effectiveAttackNeed(me, tgt, sub) : actionRange(sub);
          const subDist = CrucibleSpatial.combatDistance(me, tgt);
          if (subDist > subNeed) continue;
        }
        if (sub.kind === 'attack') {
          const r = me.side === 'monster'
            ? resolveAttackMonster(me, tgt, sub, rng, events, round, all)
            : resolveAttackPc(me, tgt, sub, rng, events, round, all);
          // Convert damageByType into applyDamage calls.
          for (const [t, dmg] of Object.entries(r.damageByType || {})) {
            applyDamage(tgt, dmg, t, me, events, round, me.name, sub.sourceActionName || sub.name);
          }
        }
        // Save sub-actions inside a multiattack are rare; resolve if encountered.
        else if (sub.kind === 'save') {
          resolveSave(me, [tgt], sub, rng, events, round, all);
        }
      }
    }
    return { warnings };
  }

  // ─────────── Pick action (nova resources strategy) ───────────
  // Prefer multiattack > limited-use > at-will. If no usable action, returns null.
  function pickAction(c) {
    const list = c.side === 'pc'
      ? ((c.pm && c.pm.actions) || []).map(a => {
          const base = { ...a, sourceActionName: a.name, kind: a.type };
          if (a.type === 'save') {
            // Flatten PC save action into engine's expected top-level shape.
            // DC: explicit override wins; else derive 8 + atkAbilityMod + PB.
            const dc = (a.save && a.save.dcOverride != null)
              ? a.save.dcOverride
              : 8 + mod(c.pm.abilities[a.atkAbility] || 10) + pb(c.pm.identity.level || 1);
            // Damage from the PC's flat damage block (dice + mod + type).
            const dmgEntry = a.damage
              ? [{ dice: a.damage.dice,
                    mod: pcDamageMod(c.pm, a),
                    type: (a.damage.type || 'untyped').toLowerCase() }]
              : [];
            base.saveAbility   = (a.save && a.save.ability) || a.atkAbility || 'dex';
            base.saveDc        = dc;
            base.aoeTargets    = a.aoeTargets || 1;
            base.halfOnSave    = !!(a.save && a.save.halfOnSave);
            base.damageOnFail  = dmgEntry;
            base.damageOnSave  = base.halfOnSave ? dmgEntry.map(d => ({ ...d, half:true })) : [];
            base.condition     = (a.save && a.save.condition) || null;
          }
          return base;
        }).filter(a => a.cost !== 'bonus')
      : ((c.monster && c.monster.parsedActions) || []);
    // Multiattack first.
    const ma = list.find(a => a.kind === 'multiattack' && isAvailable(c, a));
    if (ma) return ma;
    // Limited-resource attacks/saves before at-will.
    const limited = list.filter(a =>
      (a.usesPerDay != null || a.recharge) && a.kind !== 'unparsed' && a.kind !== 'utility' &&
      isAvailable(c, a));
    if (limited.length) return limited[0];
    // At-will attack/save/heal; a buff action is only picked as a last
    // resort main action (v3.5) when nothing else is available.
    const atWill = list.find(a =>
      ['attack','save','heal'].includes(a.kind) && isAvailable(c, a));
    if (atWill) return atWill;
    return list.find(a => a.kind === 'buff' && isAvailable(c, a)) || null;
  }

  // v3.4: set of "x,y" cells occupied by living combatants (excluding one).
  // v3.8: includes every cell of each combatant's N×N footprint.
  function occupiedSet(all, exclude) {
    const s = new Set();
    for (const d of all) {
      if (d === exclude || d.dead || d.downed) continue;
      if (typeof d.x !== 'number') continue;
      for (const cell of CrucibleSpatial.footprintCells(d)) s.add(cell.x + ',' + cell.y);
    }
    return s;
  }

  // v3.4: decide whether this turn's ACTION should be something other than the
  // default attack. Returns null (proceed with the normal attack flow) or a
  // plan object { kind, ...args, reason } that the turn loop executes. Rules
  // are deliberately conservative — diverting from attacking must clearly beat
  // it. Evaluated at TURN START (before any movement), so melee-adjacency
  // rules only fire for combatants already engaged.
  function chooseManeuver(c, all, tactics, map, rng) {
    if (c.side !== 'pc') return null;                       // monsters: separate pre-pass
    if (typeof CrucibleSpatial === 'undefined') return null;
    const role = resolvePcRole(c.pm);
    const enemies = all.filter(t => t.side !== c.side && !t.dead && !t.downed);
    if (!enemies.length) return null;
    const adjacentEnemies = enemies.filter(e =>
      CrucibleSpatial.combatDistance(c, e) <= (e.naturalReach || 1));
    const hpFrac = c.maxHp > 0 ? c.hp / c.maxHp : 1;

    // 1. Disengage + retreat: ranged/caster/support pinned in melee.
    if ((role === 'archer' || role === 'caster' || role === 'support')
        && adjacentEnemies.length >= 1) {
      const occupied = occupiedSet(all, c);
      const retreat = CrucibleSpatial.findRetreatCell(
        { x: c.x, y: c.y }, enemies, map,
        { maxSteps: c.movementBudgetThisTurn, occupied, sizeCells: c.sizeCells });
      if (retreat && retreat.minEnemyDist >= 2) {
        return { kind: 'disengage-retreat', path: retreat.path,
                 reason: role + ' pinned by ' + adjacentEnemies.length + ' melee' };
      }
      // No escape route → Dodge instead (fight defensively).
      return { kind: 'dodge', reason: role + ' pinned, no retreat path' };
    }

    // 2. Dodge: badly hurt frontline holding a chokepoint.
    if (role === 'frontline' && hpFrac < 0.35 && adjacentEnemies.length >= 2) {
      return { kind: 'dodge',
               reason: 'frontline at ' + Math.round(hpFrac * 100) + '% HP vs ' + adjacentEnemies.length + ' melee' };
    }

    // 3. Shove-prone: frontline + an adjacent ally also in melee with the same
    //    target → prone gives the whole melee train advantage. Conservative:
    //    a target is proned by the party only ONCE per combat (tgt._shoveProneUsed)
    //    — a control setup, not a spam. Without this cap the melee line re-prones
    //    the same target every round (it stands at its turn start) and burns an
    //    action each round for degenerate, unrealistic advantage uptime.
    if (role === 'frontline' && adjacentEnemies.length >= 1) {
      const tgt = adjacentEnemies[0];
      const allyAlsoAdjacent = all.some(a => a.side === c.side && a !== c
        && !a.dead && !a.downed
        && CrucibleSpatial.combatDistance(a, tgt) <= 1);
      if (allyAlsoAdjacent && !tgt._shoveProneUsed && !tgt.conditions.has('prone')) {
        return { kind: 'shove', target: tgt, mode: 'prone',
                 reason: 'prone sets up ally advantage' };
      }
    }

    // 4. Help: support with no useful attack of its own.
    if (role === 'support' && adjacentEnemies.length === 0) {
      const hasAttack = (c.pm.actions || []).some(a => a.type === 'attack' || a.type === 'save');
      if (!hasAttack) {
        const ally = all.find(a => a.side === c.side && a !== c && !a.dead && !a.downed
          && CrucibleSpatial.combatDistance(c, a) <= 1);
        if (ally) return { kind: 'help', ally, reason: 'support with no attack' };
      }
    }

    return null;
  }

  // ─────────── Bonus-action phase (v3.2, buff added v3.5) ───────────
  // Pick and fire one bonus-cost action, if any is available and useful.
  // Supports kinds: attack (requires a target attackable from the current
  // cell — bonus actions never move), heal (most-injured living ally,
  // including self), buff (self or adjacent ally). Other kinds are skipped.
  function resolveBonusAction(c, all, tactics, map, rng, events, round, tally) {
    const raw = c.side === 'pc'
      ? ((c.pm && c.pm.actions) || []).map(a => ({ ...a, sourceActionName: a.sourceActionName || a.name, kind: a.kind || a.type }))
      : ((c.monster && c.monster.parsedActions) || []);
    const candidates = raw.filter(a => a.cost === 'bonus' && a.kind !== 'unparsed' && isAvailable(c, a));
    if (!candidates.length) return;

    // Heals first when someone is hurt badly (mirror healTriage's spirit).
    const healAct = candidates.find(a => a.kind === 'heal');
    if (healAct) {
      const allies = all.filter(t => t.side === c.side && !t.dead && !t.downed
                                     && t.maxHp > 0 && t.hp / t.maxHp < 0.5);
      if (allies.length) {
        allies.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
        c.bonusActionAvailable = false;
        consumeUse(c, healAct);
        const r = resolveHeal(c, [allies[0]], healAct, rng, events, round);
        tally(c.side, healAct.sourceActionName || healAct.name, 'heal',
              false, 0, r.totalHealed, 0, r.revives);
        return;
      }
    }

    // v3.5: bonus-action buff. Always fire if present — self-target is
    // always valid, ally-target requires adjacency (checked by resolveBuff).
    const buffAct = candidates.find(a => a.kind === 'buff');
    if (buffAct) {
      c.bonusActionAvailable = false;
      consumeUse(c, buffAct);
      if (resolveBuff(c, all, buffAct, events, round)) {
        tally(c.side, buffAct.sourceActionName || buffAct.name, 'buff', false, 0, 0, 0, 0);
      }
      return;
    }

    const atkAct = candidates.find(a => a.kind === 'attack');
    if (atkAct) {
      const tgt = pickEnemyTarget(c, all, tactics, rng, atkAct);
      if (!tgt) return;
      if (typeof CrucibleSpatial !== 'undefined'
          && !CrucibleSpatial.canAttackFrom(c, tgt, atkAct, c._mapRef || map)) return;
      c.bonusActionAvailable = false;
      consumeUse(c, atkAct);
      const r = c.side === 'pc'
        ? resolveAttackPc(c, tgt, atkAct, rng, events, round, all)
        : resolveAttackMonster(c, tgt, atkAct, rng, events, round, all);
      const wasAlive = !tgt.dead && !tgt.downed;
      let total = 0;
      // TODO v3.5: bonus attacks bypass the feature-dice pipeline (onAttackHit
      // bonus dice, onTakeDamage reduction, etc. from the main attack branch
      // in runTrial). Raw damageByType is applied directly here.
      for (const [ty, dmg] of Object.entries(r.damageByType || {})) {
        applyDamage(tgt, dmg, ty, c, events, round, c.name,
                    atkAct.sourceActionName || atkAct.name);
        total += dmg;
      }
      const killed = wasAlive && (tgt.dead || tgt.downed);
      tally(c.side, atkAct.sourceActionName || atkAct.name, 'attack',
            r.hit, total, 0, killed ? 1 : 0, 0);
    }
  }

  // ─────────── runTrial — one fight ───────────
  // Returns { winner, rounds, partyHpRemaining, eventLog, perActionTally,
  //          partyDowned, partyDeathRounds, warnings }.
  function runTrial(party, monsterPicks, tactics, rng) {
    const events = [];
    const warnings = [];
    // Lookup: feature id (the source tag on bonus dice) → display name.
    // Used when the engine emits per-die feature events post-roll so the
    // aggregator can group damage under the right feature label.
    const FEATURE_NAMES = {};
    if (typeof PCFeatures !== 'undefined') {
      for (const pm of (party || [])) {
        for (const ref of (pm.features || [])) {
          const def = PCFeatures.resolve(ref);
          if (def && def.name) FEATURE_NAMES[ref.id] = def.name;
        }
      }
    }
    const combatants = buildCombatants(party, monsterPicks, rng, false);
    // v2 spatial: place combatants on the map, then emit a placement event.
    const encounter = (party && party._encounter) || null;
    const map = (encounter && encounter.map) || { width: 20, height: 20, blocked: null };
    if (typeof CrucibleSpatial !== 'undefined') {
      CrucibleSpatial.placeCombatants(combatants, map, encounter && encounter.placement);
      CrucibleSpatial.computeThreat(combatants);
    }
    for (const c of combatants) c._mapRef = map;
    events.push({
      type: 'placement', round: 0, map,
      placements: combatants.map(c => ({
        id: c.id, name: c.name, side: c.side,
        pos: { x: c.x, y: c.y },
        hp: c.hp, maxHp: c.maxHp, ac: c.ac, speed: c.speed,
        sizeCells: c.sizeCells || 1,
      })),
    });
    rollInitiative(combatants, rng);
    const slots = initOrder(combatants);

    // Fire onCombatStart for every PC's features.
    if (typeof PCFeatures !== 'undefined') {
      const startCtx = {
        round: 1, combatants, rng,
        livingEnemies: combatants.filter(c => c.side === 'monster' && !c.dead),
        livingAllies: combatants.filter(c => c.side === 'pc' && !c.dead),
        eventLog: events,
      };
      for (const c of combatants) {
        if (c.side === 'pc') PCFeatures.dispatchHook(c, 'onCombatStart', startCtx);
      }
    }

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

        // Reset per-turn action budgets.
        c.actionsAvailable = 1;
        c.bonusActionAvailable = true;
        // v3 turn-scoped flags. Dodge lasts until the start of your own next
        // turn; disengaged clears each turn. hidden/helped persist until
        // consumed (do NOT reset them here).
        c.dodging = false;
        c.disengagedThisTurn = false;
        // v2 spatial: free movement budget refreshes each turn. Spending the
        // action on Dash later in the loop refills it with another effectiveSpeed.
        c.movementBudgetThisTurn = effectiveSpeed(c);
        // reactionAvailableThisRound resets at onRoundEnd, not per turn.

        // v3.3 automatic turn-start recovery: stand up from prone, attempt to
        // escape a grapple, or auto-release if the grappler is gone.
        applyTurnStartRecovery(c, combatants, rng, events, round);

        // Fire onTurnStart for PC features.
        if (c.side === 'pc' && typeof PCFeatures !== 'undefined') {
          const turnCtx = {
            round,
            combatants, rng,
            livingEnemies: combatants.filter(x => x.side === 'monster' && !x.dead),
            livingAllies: combatants.filter(x => x.side === 'pc' && !x.dead),
            eventLog: events,
          };
          PCFeatures.dispatchHook(c, 'onTurnStart', turnCtx);
        }

        const myActions = c.side === 'pc' ? (c.pm.actions || [])
                                          : ((c.monster.parsedActions) || []);
        rollRecharge(c, myActions.map(a => ({
          sourceActionName: a.sourceActionName || a.name, recharge: a.recharge })), rng);

        // Heal triage first.
        const all = combatants;
        // Action execution loop. Each iteration spends one of
        // c.actionsAvailable. Features (Action Surge, custom addAction
        // for Flurry of Blows, etc.) bump c.actionsAvailable during
        // onTurnStart so the loop runs more than once. Without this
        // loop, addAction was silent — the engine took exactly one
        // action per turn regardless of action budget.
        let _firstActionOfTurn = true;
        const _MAX_ACTIONS_PER_TURN = 10;
        let _actionSafety = _MAX_ACTIONS_PER_TURN;
        while (c.actionsAvailable > 0 && !winner && _actionSafety-- > 0) {
        c.actionsAvailable -= 1;
        // Heal triage runs once at most per turn (first action only).
        const heal = _firstActionOfTurn ? healTriage(c, all, round) : null;
        _firstActionOfTurn = false;
        if (heal) {
          consumeUse(c, heal.action);
          c.lastHealRound = round;
          const r = resolveHeal(c, heal.targets, heal.action, rng, events, round);
          tally(c.side, heal.action.sourceActionName || heal.action.name,
                'heal', false, 0, r.totalHealed, 0, r.revives);
        } else {
          let action = null;
          let targets = null;
          if (c.side === 'monster') {
            const role = resolveRole(c.monster);
            const policy = ROLE_POLICIES[role] || ROLE_POLICIES.soldier;
            const policyCtx = {
              round, rng, tactics,
              livingEnemyCount: aliveEnemies(c, all).length,
              all,
            };
            const tgt = policy.pickTarget(c, all, policyCtx);
            // No target / no action → exit the action loop for this turn
            // (break instead of continue: re-picking next iteration would
            // produce the same null result and burn through the safety
            // belt, wasting compute).
            if (!tgt) break;
            targets = Array.isArray(tgt) ? tgt : [tgt];
            action = policy.pickAction(c, targets[0], policyCtx);
            if (!action) break;
            // v3.4: role-flavored maneuvers for monsters (thin pre-pass; the
            // role policy is otherwise untouched). Skirmisher disengage is
            // deferred — its hit-and-run policy already repositions. TODO v3.6+.
            if (typeof CrucibleSpatial !== 'undefined') {
              const monRole = resolveRole(c.monster);
              const pcsAdj = all.filter(t => t.side === 'pc' && !t.dead && !t.downed
                && CrucibleSpatial.combatDistance(c, t) <= 1);
              // Artillery engaged in melee → retreat if there's an escape, else Dodge.
              if (monRole === 'artillery' && pcsAdj.length >= 1) {
                const pcEnemies = all.filter(t => t.side === 'pc' && !t.dead && !t.downed);
                const occ = occupiedSet(all, c);
                const retreat = CrucibleSpatial.findRetreatCell(
                  { x: c.x, y: c.y }, pcEnemies, map,
                  { maxSteps: c.movementBudgetThisTurn, occupied: occ, sizeCells: c.sizeCells });
                if (retreat && retreat.minEnemyDist >= 2) {
                  events.push({ type: 'decision', round, who: c.id, name: c.name,
                                choice: 'disengage-retreat', reason: 'artillery escaping melee' });
                  resolveDisengage(c, events, round);
                  const stepped = executePath(c, retreat.path, 'retreat', combatants, rng, events, round);
                  c.movementBudgetThisTurn = Math.max(0, c.movementBudgetThisTurn - stepped);
                  continue;
                }
                events.push({ type: 'decision', round, who: c.id, name: c.name,
                              choice: 'dodge', reason: 'artillery pinned in melee' });
                resolveDodge(c, events, round);
                continue;
              }
              // Brute: shove a PC into adjacent damaging terrain when available.
              if (monRole === 'brute' && pcsAdj.length >= 1) {
                const tgtPc = pcsAdj[0];
                const dx = Math.sign(tgtPc.x - c.x), dy = Math.sign(tgtPc.y - c.y);
                const behind = CrucibleSpatial.terrainAt(map, tgtPc.x + dx, tgtPc.y + dy);
                if (behind && behind.type === 'damaging') {
                  events.push({ type: 'decision', round, who: c.id, name: c.name,
                                choice: 'shove', reason: 'push into ' + (behind.dmgType || 'hazard') });
                  resolveShove(c, tgtPc, rng, events, round, map, combatants, 'push');
                  continue;
                }
              }
            }
          } else {
            // PC branch.
            action = pickAction(c);
            if (!action) break;
            // v3.4 decision pre-pass: a maneuver may beat attacking.
            const plan = (typeof CrucibleSpatial !== 'undefined')
              ? chooseManeuver(c, all, tactics, map, rng) : null;
            if (plan) {
              events.push({ type: 'decision', round, who: c.id, name: c.name,
                            choice: plan.kind, reason: plan.reason });
              if (plan.kind === 'dodge') {
                resolveDodge(c, events, round);
                tally(c.side, 'Dodge', 'dodge', false, 0, 0, 0, 0);
              } else if (plan.kind === 'disengage-retreat') {
                resolveDisengage(c, events, round);
                const stepped = executePath(c, plan.path, 'retreat', combatants, rng, events, round);
                c.movementBudgetThisTurn = Math.max(0, c.movementBudgetThisTurn - stepped);
                tally(c.side, 'Disengage', 'disengage', false, 0, 0, 0, 0);
              } else if (plan.kind === 'shove') {
                // Mark the target so no ally re-prones it later this combat.
                if (plan.mode === 'prone') plan.target._shoveProneUsed = true;
                const outcome = resolveShove(c, plan.target, rng, events, round, map, combatants, plan.mode);
                tally(c.side, 'Shove', 'shove', outcome !== 'resisted', 0, 0, 0, 0);
              } else if (plan.kind === 'help') {
                resolveHelp(c, plan.ally, events, round);
                tally(c.side, 'Help', 'help', false, 0, 0, 0, 0);
              }
              continue;   // action spent on the maneuver
            }
          }
          // v2 spatial: range + LOS check + movement, with Dash + reposition.
          // For single-target attacks, gate on canAttackFrom (range AND LOS),
          // and reposition via findShootingCell so a ranged PC walks around
          // a wall rather than wasting the action with no line of sight.
          if (action && action.kind !== 'buff' && (!action.shape || action.shape === 'single')
              && typeof CrucibleSpatial !== 'undefined') {
            const tgtCandidate = (c.side === 'monster' && targets && targets[0])
              ? targets[0]
              : pickEnemyTarget(c, all, tactics, rng, action);
            if (tgtCandidate) {
              const myActions = c.side === 'pc'
                ? ((c.pm && c.pm.actions) || []).map(a => ({ ...a, sourceActionName: a.sourceActionName || a.name }))
                : ((c.monster && c.monster.parsedActions) || []);
              // For multiattack we still gate on max sub-action range; LOS
              // matters per sub-attack and is handled inside resolveMultiattack
              // (via resolveAttackPc/Monster's range guard).
              if (action.kind === 'multiattack') {
                const need = multiattackRange(action, myActions);
                let dist = CrucibleSpatial.combatDistance(c, tgtCandidate);
                if (dist > need && c.movementBudgetThisTurn > 0) {
                  const stepped = executeMove(c, tgtCandidate, c.movementBudgetThisTurn, 'engage',
                    combatants, map, rng, events, round);
                  c.movementBudgetThisTurn = Math.max(0, c.movementBudgetThisTurn - stepped);
                  if (c.dead || c.downed) continue;
                  dist = CrucibleSpatial.combatDistance(c, tgtCandidate);
                }
                if (dist > need) {
                  const dashed = executeMove(c, tgtCandidate, effectiveSpeed(c), 'dash',
                    combatants, map, rng, events, round);
                  if (dashed > 0) {
                    events.push({ type: 'dash', round, who: c.id, name: c.name, cells: dashed });
                    tally(c.side, 'Dash', 'dash', false, 0, 0, 0, 0);
                  }
                  continue;
                }
              } else if (actionIsThrown(action)) {
                // v3.8: thrown/'both' weapon — PREFER MELEE. Close to melee
                // reach with free movement; throw only when melee is
                // unreachable this turn AND ammo remains. This is the fix for
                // "toughs with infinite handaxes throw forever": a thrown
                // weapon engages in melee rather than kiting at throw range.
                const meleeNeed = actionMeleeReach(c, action);
                let dist = CrucibleSpatial.combatDistance(c, tgtCandidate);
                if (dist > meleeNeed && c.movementBudgetThisTurn > 0) {
                  const stepped = executeMove(c, tgtCandidate, c.movementBudgetThisTurn, 'engage',
                    combatants, map, rng, events, round);
                  c.movementBudgetThisTurn = Math.max(0, c.movementBudgetThisTurn - stepped);
                  if (c.dead || c.downed) continue;
                  dist = CrucibleSpatial.combatDistance(c, tgtCandidate);
                }
                if (dist <= meleeNeed) {
                  // Reached melee → fall through to attack (resolves as a melee
                  // swing: no ammo spent, no ranged-in-melee penalty).
                } else if (ammoRemaining(c, action) > 0
                           && CrucibleSpatial.canAttackFrom(c, tgtCandidate, action, map)) {
                  // Can't close to melee this turn but a throw is in range and
                  // LOS with ammo left → fall through to attack (throws).
                } else {
                  // Can't melee, can't/shouldn't throw (out of range or out of
                  // ammo) → Dash to close for a melee engage next turn.
                  const dashed = executeMove(c, tgtCandidate, effectiveSpeed(c), 'dash',
                    combatants, map, rng, events, round);
                  if (dashed > 0) {
                    events.push({ type: 'dash', round, who: c.id, name: c.name, cells: dashed });
                    tally(c.side, 'Dash', 'dash', false, 0, 0, 0, 0);
                  }
                  continue;
                }
              } else {
                // Single-target attack: check both range AND LOS via canAttackFrom.
                if (!CrucibleSpatial.canAttackFrom(c, tgtCandidate, action, map)) {
                  // Build occupied-cell set so the reposition search doesn't
                  // route through allies/enemies.
                  const occupied = new Set();
                  for (const d of combatants) {
                    if (d === c || d.dead || d.downed) continue;
                    if (typeof d.x !== 'number' || typeof d.y !== 'number') continue;
                    for (const cell of CrucibleSpatial.footprintCells(d)) occupied.add(cell.x + ',' + cell.y);
                  }
                  // Step 1: try with free-move budget. findShootingCell
                  // returns a path that ends exactly on the shooting cell,
                  // so we walk it via executePath (not executeMove, which
                  // stops one cell short via stopWhenAdjacent).
                  let result = c.movementBudgetThisTurn > 0
                    ? CrucibleSpatial.findShootingCell(
                        { x: c.x, y: c.y }, tgtCandidate, action, map,
                        { maxSteps: c.movementBudgetThisTurn, occupied, sizeCells: c.sizeCells })
                    : null;
                  if (result && result.path.length > 0) {
                    const stepped = executePath(c, result.path, 'engage',
                      combatants, rng, events, round);
                    c.movementBudgetThisTurn = Math.max(0, c.movementBudgetThisTurn - stepped);
                    if (c.dead || c.downed) continue;
                  }
                  // Step 2: if STILL can't attack, try Dash.
                  if (!CrucibleSpatial.canAttackFrom(c, tgtCandidate, action, map)) {
                    const dashResult = CrucibleSpatial.findShootingCell(
                      { x: c.x, y: c.y }, tgtCandidate, action, map,
                      { maxSteps: effectiveSpeed(c), occupied, sizeCells: c.sizeCells });
                    if (dashResult && dashResult.path.length > 0) {
                      const dashed = executePath(c, dashResult.path, 'dash',
                        combatants, rng, events, round);
                      if (dashed > 0) {
                        events.push({ type: 'dash', round, who: c.id, name: c.name, cells: dashed });
                        tally(c.side, 'Dash', 'dash', false, 0, 0, 0, 0);
                      }
                    }
                    // Dash consumes the action — skip the attack even if
                    // dashResult was null (no reachable shooting cell exists).
                    continue;
                  }
                }
              }
            }
          }
          // v2 spatial: AoE-shape actions (sphere/cube/cone/line) go through
          // the spatial resolver, which picks the best cast point.
          if (action && action.shape && action.shape !== 'single'
              && typeof CrucibleSpatial !== 'undefined') {
            consumeUse(c, action);
            resolveAoE(c, action, combatants, map, rng, events, round);
            tally(c.side, action.sourceActionName || action.name, 'aoe', false, 0, 0, 0, 0);
            continue;
          }
          if (action.kind === 'multiattack') {
            consumeUse(c, action);
            const r = resolveMultiattack(c, all, action, tactics, rng, events, round);
            tally(c.side, action.sourceActionName, 'multi', false, 0, 0, 0, 0);
            warnings.push(...(r.warnings || []));
          } else if (action.kind === 'attack') {
            const tgt = (c.side === 'monster' && targets && targets[0])
                          ? targets[0]
                          : pickEnemyTarget(c, all, tactics, rng, action);
            if (!tgt) continue;
            consumeUse(c, action);
            const r = c.side === 'pc'
              ? resolveAttackPc(c, tgt, action, rng, events, round, combatants)
              : resolveAttackMonster(c, tgt, action, rng, events, round, combatants);
            const wasAlive = !tgt.dead && !tgt.downed;
            let totalDmgThisAttack = 0;

            // Build a dmgCtx so features can inspect and modify damage.
            if (r.hit && typeof PCFeatures !== 'undefined') {
              // Compute total base damage across all types.
              let baseAmount = 0;
              for (const dmg of Object.values(r.damageByType || {})) baseAmount += dmg;
              const primaryType = Object.keys(r.damageByType || {})[0] || 'untyped';
              const dmgCtx = {
                amount: baseAmount,
                type: primaryType,
                source: action.name || action.sourceActionName || 'attack',
                bonusDice: [],
                crit: !!r.crit,
                eventLog: events,
                round,
                combatants,
              };

              // Fire onAttackHit on the attacker for damage modifiers (Rage, Sneak, Hex, Smite).
              if (c.side === 'pc') {
                PCFeatures.dispatchHook(c, 'onAttackHit', action, tgt, dmgCtx);
              }

              // Resolve bonus dice that features pushed onto dmgCtx.bonusDice.
              // Pre-rolled dice (addDamage / Rage +N) carry _rolled already; skip the reroll.
              for (const bd of dmgCtx.bonusDice) {
                if (typeof bd._rolled !== 'number') bd._rolled = rollDice(bd.dice, rng);
                dmgCtx.amount += bd._rolled;
                if (bd._rolled > 0) {
                  // Emit a feature event so the Feature Impact aggregator can
                  // attribute this damage to the feature that pushed the die.
                  const featureName = bd.featureName || FEATURE_NAMES[bd.source] || bd.source || 'Feature';
                  events.push({
                    round, type: 'feature', who: c.id,
                    what: featureName + ' +' + bd._rolled + ' ' + (bd.type || 'damage'),
                    featureName, source: bd.source,
                    amount: bd._rolled, isDamage: true,
                  });
                }
              }

              // Snapshot the post-bonus-dice amount so we can detect any
              // reduction applied by onTakeDamage features (Rage resistance,
              // addResistance). Pre-fix the engine ignored amount edits and
              // just applied raw damageByType / bonusDice as if no reduction
              // happened.
              const preTakeDamageAmount = dmgCtx.amount;

              // Fire onTakeDamage on the target for damage reduction (Rage resistance).
              if (tgt.side === 'pc') {
                PCFeatures.dispatchHook(tgt, 'onTakeDamage', dmgCtx);
              }
              const reductionRatio = preTakeDamageAmount > 0
                ? Math.max(0, dmgCtx.amount) / preTakeDamageAmount
                : 1;

              // Apply base damage types through applyDamage, scaled by any
              // onTakeDamage reduction so resistances actually reduce HP loss.
              for (const [type, dmg] of Object.entries(r.damageByType || {})) {
                const scaled = Math.floor(dmg * reductionRatio);
                if (scaled > 0) {
                  applyDamage(tgt, scaled, type, c, events, round, c.name,
                              action.sourceActionName || action.name);
                  totalDmgThisAttack += scaled;
                }
              }
              // Apply each bonus-dice roll as its declared type (or primaryType if none),
              // also scaled by the reduction ratio.
              for (const bd of dmgCtx.bonusDice) {
                if (bd._rolled > 0) {
                  const bdType = bd.type || primaryType;
                  const scaled = Math.floor(bd._rolled * reductionRatio);
                  if (scaled > 0) {
                    applyDamage(tgt, scaled, bdType, c, events, round, c.name,
                                action.sourceActionName || action.name);
                    totalDmgThisAttack += scaled;
                  }
                }
              }
            } else {
              for (const [type, dmg] of Object.entries(r.damageByType || {})) {
                applyDamage(tgt, dmg, type, c, events, round, c.name,
                            action.sourceActionName || action.name);
                totalDmgThisAttack += dmg;
              }
            }
            const killed = wasAlive && (tgt.dead || tgt.downed);

            // Fire onAllyDowned / onMonsterDowned when a combatant just dropped.
            if (killed && typeof PCFeatures !== 'undefined') {
              const downedCtx = { round, combatants, rng, eventLog: events };
              if (tgt.side === 'pc') {
                // Broadcast onAllyDowned to surviving PCs (not the downed one).
                for (const ally of combatants) {
                  if (ally.side === 'pc' && ally.id !== tgt.id && !ally.downed) {
                    PCFeatures.dispatchHook(ally, 'onAllyDowned', tgt, downedCtx);
                  }
                }
              } else if (tgt.side === 'monster') {
                // Broadcast onMonsterDowned to surviving PCs.
                for (const ally of combatants) {
                  if (ally.side === 'pc' && !ally.downed) {
                    PCFeatures.dispatchHook(ally, 'onMonsterDowned', tgt, downedCtx);
                  }
                }
              }
            }

            // Tally once per attack, summing damage across all damage types.
            tally(c.side, action.sourceActionName || action.name, 'attack',
                  r.hit, totalDmgThisAttack, 0, killed ? 1 : 0, 0);
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
            const r = resolveSave(c, saveTargets, action, rng, events, round, combatants);
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
          } else if (action.kind === 'buff') {
            consumeUse(c, action);
            if (resolveBuff(c, all, action, events, round)) {
              tally(c.side, action.sourceActionName || action.name, 'buff', false, 0, 0, 0, 0);
            }
          }
        }
        }
        // v3.4 kiting: ranged roles spend leftover movement opening distance
        // after their action. Only when it doesn't provoke: skip if any
        // adjacent enemy still has a reaction (stepping away would eat an OoA)
        // unless the PC disengaged this turn.
        if (c.side === 'pc' && !c.dead && !c.downed
            && typeof CrucibleSpatial !== 'undefined'
            && c.movementBudgetThisTurn > 0) {
          const role = resolvePcRole(c.pm);
          if (role === 'archer' || role === 'caster' || role === 'skirmisher') {
            const enemies = combatants.filter(t => t.side !== c.side && !t.dead && !t.downed);
            const wouldProvoke = !c.disengagedThisTurn && enemies.some(e =>
              e.reactionAvailableThisRound
              && CrucibleSpatial.combatDistance(c, e) <= (e.naturalReach || 1));
            if (enemies.length && !wouldProvoke) {
              const nearest = Math.min(...enemies.map(e => CrucibleSpatial.combatDistance(c, e)));
              if (nearest <= 3) {   // only bother when someone is closing in
                const retreat = CrucibleSpatial.findRetreatCell(
                  { x: c.x, y: c.y }, enemies, map,
                  { maxSteps: c.movementBudgetThisTurn, occupied: occupiedSet(combatants, c), sizeCells: c.sizeCells });
                if (retreat && retreat.path.length) {
                  events.push({ type: 'decision', round, who: c.id, name: c.name,
                                choice: 'kite', reason: 'open distance (nearest ' + nearest + 'c)' });
                  const stepped = executePath(c, retreat.path, 'kite', combatants, rng, events, round);
                  c.movementBudgetThisTurn = Math.max(0, c.movementBudgetThisTurn - stepped);
                }
              }
            }
          }
        }
        // v3: bonus-action phase. One bonus-cost action may fire per turn if
        // the combatant is still standing and a useful one is available.
        if (!winner && !c.dead && !c.downed && c.bonusActionAvailable) {
          resolveBonusAction(c, all, tactics, map, rng, events, round, tally);
        }
        // v2 terrain: damaging-cell trigger if combatant ends turn standing on it.
        if (typeof CrucibleSpatial !== 'undefined' && map && !c.dead && !c.downed) {
          const t = CrucibleSpatial.terrainAt(map, c.x, c.y);
          if (t && t.type === 'damaging') {
            const dmg = (t.dice ? rollDice(t.dice, rng) : 0) + (Number(t.mod) || 0);
            if (dmg > 0) {
              events.push({
                type: 'terrain-damage', round, who: c.id, name: c.name,
                cell: { x: c.x, y: c.y }, amount: dmg, dmgType: t.dmgType || 'untyped',
              });
              applyDamage(c, dmg, t.dmgType || 'untyped', null, events, round, 'Terrain', 'damaging cell');
            }
          }
        }
        // End-of-turn end check.
        const pcsAlive = combatants.some(x => x.side === 'pc' && !x.downed && !x.dead);
        const monAlive = combatants.some(x => x.side === 'monster' && !x.dead);
        if (!pcsAlive) { winner = 'monster'; break; }
        if (!monAlive) { winner = 'pc';      break; }
      }
      // v2: reset reactions at end of round so OoAs can fire again.
      for (const cc of combatants) cc.reactionAvailableThisRound = true;
      // End-of-round hook for PC features (Rage duration tick, reaction reset).
      if (!winner && typeof PCFeatures !== 'undefined') {
        const endCtx = { round, combatants, rng, eventLog: events };
        for (const c of combatants) {
          if (c.side === 'pc') PCFeatures.dispatchHook(c, 'onRoundEnd', round, endCtx);
        }
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
    // featureStats[label] = { activations, damageDealt, damagePrevented, hpRestored }
    const featureStats = {};

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

    // Aggregate feature events across all trials. Events carry structured
    // attribution fields (featureName, amount, isDamage, isPrevented,
    // hpRestored) from both pc-features.js and the engine's bonus-die roll
    // loop. Fall back to the legacy regex parse for any event that pre-dates
    // the structured fields.
    for (const trial of trialResults) {
      for (const ev of trial.events) {
        if (!ev || ev.type !== 'feature') continue;
        let featureLabel = ev.featureName;
        if (!featureLabel) {
          const m = /^([A-Z][a-zA-Z' /]+?)(?:\s+activated|\s+on\s|\s+ended|\s+re-cast|\s+handed|\s+\+|\s+prevented)/.exec(ev.what || '');
          featureLabel = m ? m[1].trim() : (ev.what || '').split(/[:(]/)[0].trim();
        }
        if (!featureLabel) continue;
        if (!featureStats[featureLabel]) {
          featureStats[featureLabel] = { activations: 0, damageDealt: 0, damagePrevented: 0, hpRestored: 0 };
        }
        featureStats[featureLabel].activations += 1;
        if (ev.isDamage && typeof ev.amount === 'number') {
          featureStats[featureLabel].damageDealt += ev.amount;
        } else if (ev.isPrevented && typeof ev.amount === 'number') {
          featureStats[featureLabel].damagePrevented += ev.amount;
        }
        if (typeof ev.hpRestored === 'number') {
          featureStats[featureLabel].hpRestored += ev.hpRestored;
        } else {
          const healMatch = /\+(\d+)\s*HP/.exec(ev.what || '');
          if (healMatch) featureStats[featureLabel].hpRestored += parseInt(healMatch[1], 10);
        }
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
      featureStats,
      representative: { low: lo, median: mid, high: hi },
      warnings,
      errors,
    };
  }

  // ─────────── Public exports ───────────
  const Crucible = {
    makeRng, rollDie, rollDice, rollD20, netAdvantage,
    mod, pb, saveBonus, toHit, saveDc, pcDamageMod,
    attackAdvantageState, saveAdvantageState, autoFailsSave, effectiveSpeed,
    buildCombatants, rollInitiative, initOrder,
    tickConditions, rollRecharge, applyRegen, turnStart,
    pickEnemyTarget, isAvailable, consumeUse, healTriage,
    aliveEnemies, aliveAllies,
    damageMultiplier, resolveAttackMonster, resolveAttackPc,
    resolveOpportunityAttack, executeMove, executePath,
    // v3.3 standard actions + turn-start recovery
    resolveDodge, resolveDisengage, resolveHelp, resolveHide,
    resolveGrapple, resolveShove, maneuverDc, maneuverSaveBonus,
    combatantAbilityMod, applyTurnStartRecovery,
    resolveSave, resolveAoE, resolveHeal,
    applyDamage, resolveMultiattack, pickAction,
    runTrial, runSim,
    // Role-policy helpers
    clamp01, sumDice, actionIsMelee, actionIsRanged, actionRange, multiattackRange,
    monsterSpeedCells, monsterReachCells, sizeToCells, monsterSizeCells,
    actionIsThrown, actionMeleeReach, ammoRemaining, resolvesAsRanged, effectiveAttackNeed,
    targetSaveBonus, actionEv,
    tagActions, bestEvAction, lowestPick, targetsInBucket,
    rangedness, bucket, position, positionOf,
    crHpMedian, inferRole, resolveRole, normalizeRole,
    ROLE_POLICIES,
    // v3.4 tactical AI
    resolvePcRole, chooseManeuver,
    // v3.5 custom action builder: riders, forced movement, buffs
    applyAttackRider, pushTarget, resolveBuff,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Crucible;
  else root.Crucible = Crucible;
})(typeof window !== 'undefined' ? window : globalThis);

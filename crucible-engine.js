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

  const ROLE_POLICIES = {
    soldier:    { pickTarget: pickTargetSoldier,    pickAction: pickActionSoldier },
    brute:      { pickTarget: pickTargetBrute,      pickAction: pickActionBrute },
    minion:     { pickTarget: pickTargetMinion,     pickAction: pickActionMinion },
    artillery:  { pickTarget: pickTargetArtillery,  pickAction: pickActionArtillery },
    skirmisher: { pickTarget: pickTargetSkirmisher, pickAction: pickActionSkirmisher },
    ambusher:   { pickTarget: pickTargetAmbusher,   pickAction: pickActionAmbusher },
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
        })
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
            consumeUse(c, action);
            const r = resolveMultiattack(c, all, action, tactics, rng, events, round);
            tally(c.side, action.sourceActionName, 'multi', false, 0, 0, 0, 0);
            warnings.push(...(r.warnings || []));
          } else if (action.kind === 'attack') {
            const tgt = (c.side === 'monster' && targets && targets[0])
                          ? targets[0]
                          : pickEnemyTarget(c, all, tactics, rng);
            if (!tgt) continue;
            consumeUse(c, action);
            const r = c.side === 'pc'
              ? resolveAttackPc(c, tgt, action, rng, events, round)
              : resolveAttackMonster(c, tgt, action, rng, events, round);
            const wasAlive = !tgt.dead && !tgt.downed;
            let totalDmgThisAttack = 0;
            for (const [type, dmg] of Object.entries(r.damageByType || {})) {
              applyDamage(tgt, dmg, type, c, events, round, c.name,
                          action.sourceActionName || action.name);
              totalDmgThisAttack += dmg;
            }
            const killed = wasAlive && (tgt.dead || tgt.downed);
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
            const r = resolveSave(c, saveTargets, action, rng, events, round);
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

  // ─────────── Public exports ───────────
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
    // Role-policy helpers
    clamp01, sumDice, actionIsMelee, actionIsRanged, targetSaveBonus, actionEv,
    tagActions, bestEvAction, lowestPick, targetsInBucket,
    rangedness, bucket, position, positionOf,
    crHpMedian, inferRole, resolveRole, normalizeRole,
    ROLE_POLICIES,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Crucible;
  else root.Crucible = Crucible;
})(typeof window !== 'undefined' ? window : globalThis);

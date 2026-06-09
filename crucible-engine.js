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
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Crucible;
  else root.Crucible = Crucible;
})(typeof window !== 'undefined' ? window : globalThis);

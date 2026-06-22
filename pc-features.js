// pc-features.js
// Framework for modeling 5e PC class features in the Crucible simulator.
// Exports a global PCFeatures namespace with:
//   - HOOK_NAMES: the 9 hook points the engine calls
//   - MODE_PREDICATES: named predicate functions for mode policies
//   - LIBRARY: built-in features (Rage, Sneak Attack, etc.) by id
//   - resolve(featureRef): given {id, source, params}, return the full feature def
//   - dispatchHook(combatant, hookName, ...args): runs all subscribed features
//   - dispatchBroadcastHook(combatants, triggering, hookName, ...args): cross-PC hook dispatch
//   - compileDSL(spec): turns a JSON spec into a feature object
//
// Companion: tests/pc-features.test.html exercises every function above.
// Engine integration: crucible-engine.js calls dispatchHook at 9 sites.

(function (global) {
  'use strict';

  // Find an event log + round from whichever context arg has them. Used by
  // primitives and built-in feature hooks to push trace events without
  // threading the log through every signature.
  function eventLogFrom(hookCtx) {
    return (hookCtx && hookCtx.dmgCtx && hookCtx.dmgCtx.eventLog) ||
           (hookCtx && hookCtx.ctx && hookCtx.ctx.eventLog) ||
           (hookCtx && hookCtx.rollCtx && hookCtx.rollCtx.eventLog) || null;
  }
  function roundFrom(hookCtx) {
    return (hookCtx && hookCtx.dmgCtx && typeof hookCtx.dmgCtx.round === 'number') ? hookCtx.dmgCtx.round :
           (hookCtx && hookCtx.ctx    && typeof hookCtx.ctx.round    === 'number') ? hookCtx.ctx.round :
           0;
  }
  function emitTrace(self, hookCtx, featureName, source, summary, extras) {
    const log = eventLogFrom(hookCtx);
    if (!log) return;
    log.push({
      round: roundFrom(hookCtx), type: 'feature', who: self && self.id,
      what: (featureName || source || 'Feature') + ': ' + summary,
      featureName: featureName || source || 'Feature', source: source || 'unknown',
      ...(extras || {}),
    });
  }

  const HOOK_NAMES = [
    'onCombatStart',
    'onTurnStart',
    'onAttackAttempt',
    'onAttackHit',
    'onTakeDamage',
    'onSaveAttempt',
    'onAllyDowned',
    'onMonsterDowned',
    'onRoundEnd',
  ];

  const MODE_PREDICATES = {
    always:                  (self, ctx) => true,
    whenAnyEnemyAlive:       (self, ctx) =>
      Array.isArray(ctx && ctx.combatants) &&
      ctx.combatants.some(c => c.side === 'monster' && !c.dead),
    whenHpBelowHalf:         (self, ctx) =>
      self && self.maxHp > 0 && (self.hp / self.maxHp) < 0.5,
    whenHpBelowQuarter:      (self, ctx) =>
      self && self.maxHp > 0 && (self.hp / self.maxHp) < 0.25,
    whenAllyDowned:          (self, ctx) =>
      Array.isArray(ctx && ctx.combatants) &&
      ctx.combatants.some(c => c.side === 'pc' && c.downed),
    whenAllyHpBelowHalf:     (self, ctx) =>
      Array.isArray(ctx && ctx.combatants) &&
      ctx.combatants.some(c =>
        c.side === 'pc' && c.id !== (self && self.id) && c.maxHp > 0 && (c.hp / c.maxHp) < 0.5
      ),
    usesLeftGreaterThanZero: (self, ctx, featureId) =>
      !!(self && self.featureState && self.featureState[featureId] && self.featureState[featureId].usesLeft > 0),
    whenTargetHasntAttacked: (self, ctx, featureId, hookCtx) =>
      !!(hookCtx && hookCtx.target && !hookCtx.target.hasAttacked),
    whenTargetIsBloodied:    (self, ctx, featureId, hookCtx) =>
      !!(hookCtx && hookCtx.target && hookCtx.target.maxHp > 0 &&
        (hookCtx.target.hp / hookCtx.target.maxHp) < 0.5),
    whenTargetIsHostile:     (self, ctx, featureId, hookCtx) =>
      !!(hookCtx && hookCtx.target && hookCtx.target.side === 'monster'),
  };

  function resolve(ref) {
    if (!ref) return null;
    if (ref.source === 'homebrew' && ref._dslSpec) return compileDSL(ref._dslSpec);
    if (ref.source === 'homebrew') return ref;
    return (PCFeatures.LIBRARY && PCFeatures.LIBRARY[ref.id]) || null;
  }

  function dispatchHook(combatant, hookName, ...args) {
    if (!combatant || !combatant.pm || !Array.isArray(combatant.pm.features)) return;
    if (!combatant.featureState) combatant.featureState = {};
    // For damage-shaping hooks, find a dmgCtx so we can attribute flat amount
    // changes (Rage +2, Rage resistance, DSL addDamage, DSL addResistance) to
    // the running feature. Bonus dice attribution is handled by the engine
    // after roll, since the dispatcher doesn't know the rolled value.
    const dmgCtx = args.find(a => a && typeof a.amount === 'number' && Array.isArray(a.bonusDice));
    for (const ref of combatant.pm.features) {
      if (!ref || !ref.id) continue;
      const state = combatant.featureState[ref.id];
      if (state && state._disabled) continue;
      const def = PCFeatures.resolve(ref);
      if (!def || !def.hooks || typeof def.hooks[hookName] !== 'function') continue;
      const beforeAmount = dmgCtx ? dmgCtx.amount : null;
      try {
        const result = def.hooks[hookName].call(def, combatant, ...args);
        if (dmgCtx && dmgCtx.eventLog && beforeAmount !== null) {
          const delta = dmgCtx.amount - beforeAmount;
          if (delta > 0 && hookName === 'onAttackHit') {
            dmgCtx.eventLog.push({
              round: dmgCtx.round || 0, type: 'feature', who: combatant.id,
              what: (def.name || ref.id) + ' +' + delta + ' damage',
              featureName: def.name || ref.id, source: ref.id,
              amount: delta, isDamage: true,
            });
          } else if (delta < 0 && hookName === 'onTakeDamage') {
            dmgCtx.eventLog.push({
              round: dmgCtx.round || 0, type: 'feature', who: combatant.id,
              what: (def.name || ref.id) + ' prevented ' + (-delta) + ' damage',
              featureName: def.name || ref.id, source: ref.id,
              amount: -delta, isPrevented: true,
            });
          }
        }
        if (result === 'consume') {
          // Reaction-style consume: short-circuits remaining features on THIS
          // combatant only. The engine still calls dispatchHook on other
          // combatants independently for the same event.
          return;
        }
      } catch (e) {
        console.warn('PCFeatures: feature "' + ref.id + '" hook ' + hookName + ' threw:', e);
        if (!combatant.featureState[ref.id]) combatant.featureState[ref.id] = {};
        combatant.featureState[ref.id]._disabled = true;
      }
    }
  }

  // Broadcast hook: invoke the named hook on every PC's features, with the
  // triggering combatant as the second positional arg.
  //
  // Used for cross-PC features like Bardic Inspiration where the bard's
  // feature needs to fire on another PC's save attempt.
  function dispatchBroadcastHook(allCombatants, triggeringCombatant, hookName, ...args) {
    if (!Array.isArray(allCombatants)) return;
    for (const c of allCombatants) {
      if (!c || c.side !== 'pc' || !c.pm || !Array.isArray(c.pm.features)) continue;
      if (!c.featureState) c.featureState = {};
      for (const ref of c.pm.features) {
        if (!ref || !ref.id) continue;
        const state = c.featureState[ref.id];
        if (state && state._disabled) continue;
        const def = PCFeatures.resolve(ref);
        if (!def || !def.hooks || typeof def.hooks[hookName] !== 'function') continue;
        try {
          def.hooks[hookName].call(def, c, triggeringCombatant, ...args);
        } catch (e) {
          console.warn('PCFeatures: feature "' + ref.id + '" broadcast hook ' + hookName + ' threw:', e);
          if (!c.featureState[ref.id]) c.featureState[ref.id] = {};
          c.featureState[ref.id]._disabled = true;
        }
      }
    }
  }

  function initFeatureState(combatant) {
    if (!combatant || !combatant.pm || !Array.isArray(combatant.pm.features)) return;
    if (!combatant.featureState) combatant.featureState = {};
    for (const ref of combatant.pm.features) {
      if (!ref || !ref.id) continue;
      const def = PCFeatures.resolve(ref);
      if (!def) continue;
      if (!combatant.featureState[ref.id]) {
        combatant.featureState[ref.id] = def.initialState ? def.initialState(def, ref) : {};
      }
    }
  }

  // ── Built-in library ──

  const RAGE = {
    id: 'rage',
    name: 'Rage',
    source: 'builtin',
    category: ['damage', 'defense'],
    classHint: 'barbarian',
    summary: '+bonusDamage on melee hits; half physical damage taken; while raging.',

    deriveParams(identityOrPm) {
      const level = (identityOrPm && identityOrPm.level) || (identityOrPm && identityOrPm.identity && identityOrPm.identity.level) || 1;
      let bonusDamage = 2;
      if (level >= 9)  bonusDamage = 3;
      if (level >= 16) bonusDamage = 4;
      return { bonusDamage, duration: 10 };
    },

    paramSchema: [
      { name: 'bonusDamage', type: 'int', label: 'Bonus damage', default: 2, min: 0, max: 9 },
      { name: 'duration', type: 'int', label: 'Duration (rounds)', default: 10, min: 1, max: 100 },
    ],

    modePolicy: {
      nova:      { triggerRound: 1, conditionFn: 'always' },
      sustained: { triggerRound: 1, conditionFn: 'whenAnyEnemyAlive' },
      defensive: { triggerRound: 1, conditionFn: 'whenHpBelowHalf' },
    },

    initialState() { return { active: false, roundsLeft: 0 }; },

    hooks: {
      onCombatStart(self, ctx) {
        const ref = self.pm.features.find(f => f.id === 'rage');
        const mode = (self.pm.tactics && self.pm.tactics.mode) || 'sustained';
        const policy = this.modePolicy[mode] || this.modePolicy.sustained;
        if (ctx.round >= (policy.triggerRound || 1)) {
          const pred = MODE_PREDICATES[policy.conditionFn] || MODE_PREDICATES.always;
          if (pred(self, ctx, 'rage')) {
            const params = (ref && ref.params) || this.deriveParams(self.pm);
            self.featureState.rage.active = true;
            self.featureState.rage.roundsLeft = params.duration || 10;
            if (ctx.eventLog) ctx.eventLog.push({ round: ctx.round, type: 'feature', who: self.id, what: 'Rage activated', featureName: 'Rage', source: 'rage' });
          }
        }
      },

      onAttackHit(self, action, target, dmgCtx) {
        const state = self.featureState.rage;
        if (!state || !state.active) return;
        if (!action || action.actionRange === 'ranged') return;
        const ref = self.pm.features.find(f => f.id === 'rage');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        const bonus = params.bonusDamage || 2;
        if (!Array.isArray(dmgCtx.bonusDice)) dmgCtx.bonusDice = [];
        // Pre-rolled bonus die so the engine's bonus-die loop applies the
        // damage to target HP. Previously this just bumped dmgCtx.amount,
        // which was cosmetic — the engine ignored amount modifications
        // when applying damage.
        dmgCtx.bonusDice.push({
          dice: String(bonus), type: dmgCtx.type || 'bludgeoning',
          source: 'rage', featureName: 'Rage', _rolled: bonus,
        });
      },

      onTakeDamage(self, dmgCtx) {
        const state = self.featureState.rage;
        if (!state || !state.active) return;
        const PHYS = ['bludgeoning', 'piercing', 'slashing'];
        if (PHYS.includes(dmgCtx.type)) {
          dmgCtx.amount = Math.floor(dmgCtx.amount / 2);
        }
      },

      onRoundEnd(self, round, ctx) {
        const state = self.featureState.rage;
        if (!state || !state.active) return;
        state.roundsLeft = Math.max(0, state.roundsLeft - 1);
        if (state.roundsLeft <= 0) {
          state.active = false;
          if (ctx && ctx.eventLog) ctx.eventLog.push({ round, type: 'feature', who: self.id, what: 'Rage ended', featureName: 'Rage', source: 'rage' });
        }
      },
    },
  };

  const SNEAK_ATTACK = {
    id: 'sneakAttack',
    name: 'Sneak Attack',
    source: 'builtin',
    category: ['damage'],
    classHint: 'rogue',
    summary: 'Bonus dice on the first finesse/ranged hit per turn.',

    deriveParams(identityOrPm) {
      const level = (identityOrPm && identityOrPm.level) || (identityOrPm && identityOrPm.identity && identityOrPm.identity.level) || 1;
      const dice = Math.ceil(level / 2);
      return { dice: dice + 'd6' };
    },

    paramSchema: [
      { name: 'dice', type: 'string', label: 'Dice', default: '1d6', placeholder: '3d6' },
    ],

    modePolicy: {
      nova:      { triggerRound: 1, conditionFn: 'always' },
      sustained: { triggerRound: 1, conditionFn: 'always' },
      defensive: { triggerRound: 1, conditionFn: 'always' },
    },

    initialState() { return { usedThisTurn: false }; },

    hooks: {
      onTurnStart(self, ctx) {
        if (self.featureState.sneakAttack) self.featureState.sneakAttack.usedThisTurn = false;
      },

      onAttackHit(self, action, target, dmgCtx) {
        const state = self.featureState.sneakAttack;
        if (!state || state.usedThisTurn) return;
        if (!action || action.kind !== 'attack') return;
        const eligible = action.actionRange === 'ranged' || (action.actionRange === 'melee' && action.finesse);
        if (!eligible) return;
        const ref = self.pm.features.find(f => f.id === 'sneakAttack');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        if (!Array.isArray(dmgCtx.bonusDice)) dmgCtx.bonusDice = [];
        dmgCtx.bonusDice.push({ dice: params.dice || '1d6', type: dmgCtx.type || 'piercing', source: 'sneakAttack' });
        state.usedThisTurn = true;
      },
    },
  };

  const ACTION_SURGE = {
    id: 'actionSurge',
    name: 'Action Surge',
    source: 'builtin',
    category: ['action-economy'],
    classHint: 'fighter',
    summary: 'Take an extra action on the turn it fires.',

    deriveParams(identityOrPm) {
      const level = (identityOrPm && identityOrPm.level) || (identityOrPm && identityOrPm.identity && identityOrPm.identity.level) || 2;
      return { maxUses: level >= 17 ? 2 : 1 };
    },

    paramSchema: [
      { name: 'maxUses', type: 'int', label: 'Max uses per encounter', default: 1, min: 1, max: 5 },
    ],

    modePolicy: {
      nova:      { triggerRound: 1, conditionFn: 'always' },
      sustained: { triggerRound: 2, conditionFn: 'whenAnyEnemyAlive' },
      defensive: { triggerRound: 1, conditionFn: 'whenAllyDowned' },
    },

    initialState() { return { usesLeft: 0 }; },

    hooks: {
      onCombatStart(self, ctx) {
        const ref = self.pm.features.find(f => f.id === 'actionSurge');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        self.featureState.actionSurge.usesLeft = params.maxUses || 1;
      },

      onTurnStart(self, ctx) {
        const state = self.featureState.actionSurge;
        if (!state || state.usesLeft <= 0) return;
        const mode = (self.pm.tactics && self.pm.tactics.mode) || 'sustained';
        const policy = this.modePolicy[mode] || this.modePolicy.sustained;
        if (ctx.round < (policy.triggerRound || 1)) return;
        const pred = MODE_PREDICATES[policy.conditionFn] || MODE_PREDICATES.always;
        if (!pred(self, ctx, 'actionSurge')) return;
        if (typeof self.actionsAvailable !== 'number') self.actionsAvailable = 1;
        self.actionsAvailable += 1;
        state.usesLeft -= 1;
        if (ctx.eventLog) ctx.eventLog.push({ round: ctx.round, type: 'feature', who: self.id, what: 'Action Surge activated', featureName: 'Action Surge', source: 'actionSurge' });
      },
    },
  };

  const PALADIN_SLOTS_BY_LEVEL = {
    2:  {1:2},
    3:  {1:3}, 4: {1:3},
    5:  {1:4, 2:3},
    6:  {1:4, 2:3},
    7:  {1:4, 2:3}, 8: {1:4, 2:3},
    9:  {1:4, 2:3, 3:2},
    10: {1:4, 2:3, 3:2},
    11: {1:4, 2:3, 3:3}, 12: {1:4, 2:3, 3:3},
    13: {1:4, 2:3, 3:3, 4:1}, 14: {1:4, 2:3, 3:3, 4:1},
    15: {1:4, 2:3, 3:3, 4:2}, 16: {1:4, 2:3, 3:3, 4:2},
    17: {1:4, 2:3, 3:3, 4:3, 5:1}, 18: {1:4, 2:3, 3:3, 4:3, 5:1},
    19: {1:4, 2:3, 3:3, 4:3, 5:2}, 20: {1:4, 2:3, 3:3, 4:3, 5:2},
  };

  const DIVINE_SMITE = {
    id: 'divineSmite',
    name: 'Divine Smite',
    source: 'builtin',
    category: ['damage'],
    classHint: 'paladin',
    summary: 'Spend a spell slot on a hit for bonus radiant dice (2d8 + 1 per slot level above 1st).',

    deriveParams(identityOrPm) {
      const level = (identityOrPm && identityOrPm.level) || (identityOrPm && identityOrPm.identity && identityOrPm.identity.level) || 5;
      let slots = {1:4, 2:3};
      for (let l = level; l >= 2; l--) {
        if (PALADIN_SLOTS_BY_LEVEL[l]) { slots = PALADIN_SLOTS_BY_LEVEL[l]; break; }
      }
      return { slotsByLevel: { ...slots } };
    },

    paramSchema: [],

    modePolicy: {
      nova:      { triggerRound: 1, conditionFn: 'always', spendOn: 'everyHit' },
      sustained: { triggerRound: 1, conditionFn: 'always', spendOn: 'paced' },
      defensive: { triggerRound: 1, conditionFn: 'always', spendOn: 'critOnly' },
    },

    initialState() { return { slotsLeft: {}, hitsThisFight: 0, smitesThisFight: 0 }; },

    hooks: {
      onCombatStart(self, ctx) {
        const ref = self.pm.features.find(f => f.id === 'divineSmite');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        self.featureState.divineSmite.slotsLeft = { ...(params.slotsByLevel || {}) };
        self.featureState.divineSmite.hitsThisFight = 0;
        self.featureState.divineSmite.smitesThisFight = 0;
      },

      onAttackHit(self, action, target, dmgCtx) {
        const state = self.featureState.divineSmite;
        if (!state) return;
        if (!action || action.kind !== 'attack') return;
        if (action.actionRange === 'ranged') return;
        state.hitsThisFight += 1;
        const levels = Object.keys(state.slotsLeft).map(Number).sort((a,b) => b - a);
        const highestAvailable = levels.find(l => state.slotsLeft[l] > 0);
        if (!highestAvailable) return;

        const mode = (self.pm.tactics && self.pm.tactics.mode) || 'sustained';
        const policy = this.modePolicy[mode] || this.modePolicy.sustained;
        let shouldSpend = false;
        if (policy.spendOn === 'everyHit')    shouldSpend = true;
        else if (policy.spendOn === 'critOnly') shouldSpend = !!dmgCtx.crit;
        else if (policy.spendOn === 'paced')    shouldSpend = (state.smitesThisFight < Math.ceil(state.hitsThisFight / 2));
        if (!shouldSpend) return;

        state.slotsLeft[highestAvailable] -= 1;
        state.smitesThisFight += 1;
        const dice = (1 + highestAvailable) + 'd8';
        if (!Array.isArray(dmgCtx.bonusDice)) dmgCtx.bonusDice = [];
        dmgCtx.bonusDice.push({ dice, type: 'radiant', source: 'divineSmite' });
      },
    },
  };

  const FULL_CASTER_SLOTS_BY_LEVEL = {
    1:  {1:2},
    2:  {1:3},
    3:  {1:4, 2:2},
    4:  {1:4, 2:3},
    5:  {1:4, 2:3, 3:2},
    6:  {1:4, 2:3, 3:3},
    7:  {1:4, 2:3, 3:3, 4:1},
    8:  {1:4, 2:3, 3:3, 4:2},
    9:  {1:4, 2:3, 3:3, 4:3, 5:1},
    10: {1:4, 2:3, 3:3, 4:3, 5:2},
    11: {1:4, 2:3, 3:3, 4:3, 5:2, 6:1},
    12: {1:4, 2:3, 3:3, 4:3, 5:2, 6:1},
    13: {1:4, 2:3, 3:3, 4:3, 5:2, 6:1, 7:1},
    14: {1:4, 2:3, 3:3, 4:3, 5:2, 6:1, 7:1},
    15: {1:4, 2:3, 3:3, 4:3, 5:2, 6:1, 7:1, 8:1},
    16: {1:4, 2:3, 3:3, 4:3, 5:2, 6:1, 7:1, 8:1},
    17: {1:4, 2:3, 3:3, 4:3, 5:2, 6:1, 7:1, 8:1, 9:1},
    18: {1:4, 2:3, 3:3, 4:3, 5:3, 6:1, 7:1, 8:1, 9:1},
    19: {1:4, 2:3, 3:3, 4:3, 5:3, 6:2, 7:1, 8:1, 9:1},
    20: {1:4, 2:3, 3:3, 4:3, 5:3, 6:2, 7:2, 8:1, 9:1},
  };

  function mod(score) { return Math.floor((Number(score) - 10) / 2); }

  function rollDie(sides, rng) {
    if (rng && typeof rng === 'function') return Math.floor(rng() * sides) + 1;
    return Math.ceil((sides + 1) / 2);
  }

  function rollDice(formula, rng) {
    const m = /^(\d+)d(\d+)$/.exec(formula || '');
    if (!m) return 0;
    const n = parseInt(m[1], 10), s = parseInt(m[2], 10);
    let total = 0;
    for (let i = 0; i < n; i++) total += rollDie(s, rng);
    return total;
  }

  const HEALING_WORD = {
    id: 'healingWord',
    name: 'Healing Word',
    source: 'builtin',
    category: ['healing'],
    classHint: 'cleric',
    summary: 'Bonus-action heal: 1d4 + spellcasting mod (+1d4 per slot level above 1st).',

    deriveParams(identityOrPm) {
      const level = (identityOrPm && identityOrPm.level) || (identityOrPm && identityOrPm.identity && identityOrPm.identity.level) || 5;
      let slots = {1:4, 2:3, 3:2};
      for (let l = level; l >= 1; l--) {
        if (FULL_CASTER_SLOTS_BY_LEVEL[l]) { slots = FULL_CASTER_SLOTS_BY_LEVEL[l]; break; }
      }
      return { slotsByLevel: { ...slots }, ability: 'wis' };
    },

    paramSchema: [
      { name: 'ability', type: 'enum', label: 'Spellcasting ability', default: 'wis', options: ['cha','wis','int'] },
    ],

    modePolicy: {
      nova:      { triggerRound: 1, conditionFn: 'whenAllyHpBelowHalf' },
      sustained: { triggerRound: 1, conditionFn: 'whenAllyDowned' },
      defensive: { triggerRound: 1, conditionFn: 'whenAllyDowned' },
    },

    initialState() { return { slotsLeft: {} }; },

    hooks: {
      onCombatStart(self, ctx) {
        const ref = self.pm.features.find(f => f.id === 'healingWord');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        self.featureState.healingWord.slotsLeft = { ...(params.slotsByLevel || {}) };
      },

      onAllyDowned(self, ally, ctx) {
        if (!self.bonusActionAvailable) return;
        const state = self.featureState.healingWord;
        if (!state) return;
        const levels = Object.keys(state.slotsLeft).map(Number).sort((a,b) => a - b);
        const lowestAvailable = levels.find(l => state.slotsLeft[l] > 0);
        if (!lowestAvailable) return;

        const ref = self.pm.features.find(f => f.id === 'healingWord');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        const ability = params.ability || 'wis';
        const abilityScore = (self.pm.abilities && self.pm.abilities[ability]) || 10;
        const dice = lowestAvailable + 'd4';
        const healing = rollDice(dice, ctx.rng) + mod(abilityScore);

        ally.hp = Math.max(1, Math.min(ally.maxHp, healing));
        ally.downed = false;
        state.slotsLeft[lowestAvailable] -= 1;
        self.bonusActionAvailable = false;

        if (ctx.eventLog) ctx.eventLog.push({
          round: ctx.round, type: 'feature', who: self.id,
          what: 'Healing Word on ' + ally.id + ' (+' + healing + ' HP, slot ' + lowestAvailable + ')',
          featureName: 'Healing Word', source: 'healingWord', hpRestored: healing,
        });
      },
    },
  };

  const SHIELD = {
    id: 'shield',
    name: 'Shield',
    source: 'builtin',
    category: ['defense'],
    classHint: 'wizard',
    summary: 'Reaction: +5 AC vs a hit (consumes a 1st-level slot).',

    deriveParams(identityOrPm) {
      const level = (identityOrPm && identityOrPm.level) || (identityOrPm && identityOrPm.identity && identityOrPm.identity.level) || 5;
      let slots = {1:4};
      for (let l = level; l >= 1; l--) {
        if (FULL_CASTER_SLOTS_BY_LEVEL[l]) { slots = FULL_CASTER_SLOTS_BY_LEVEL[l]; break; }
      }
      return { slotsByLevel: { ...slots }, acBonus: 5 };
    },

    paramSchema: [
      { name: 'acBonus', type: 'int', label: 'AC bonus', default: 5, min: 1, max: 10 },
    ],

    modePolicy: {
      nova:      { triggerRound: 1, threshold: 'whileSlotsLeft' },
      sustained: { triggerRound: 1, threshold: 3 },
      defensive: { triggerRound: 1, threshold: 'wouldDrop' },
    },

    initialState() { return { slotsLeft: {} }; },

    hooks: {
      onCombatStart(self, ctx) {
        const ref = self.pm.features.find(f => f.id === 'shield');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        self.featureState.shield.slotsLeft = { ...(params.slotsByLevel || {}) };
      },

      onAttackAttempt(self, action, target, rollCtx) {
        if (!self.reactionAvailableThisRound) return;
        const state = self.featureState.shield;
        if (!state || !rollCtx.hits) return;
        const levels = Object.keys(state.slotsLeft).map(Number).sort((a,b) => a - b);
        const lowestAvailable = levels.find(l => l >= 1 && state.slotsLeft[l] > 0);
        if (!lowestAvailable) return;

        const ref = self.pm.features.find(f => f.id === 'shield');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        const acBonus = params.acBonus || 5;
        const hitBy = (rollCtx.roll || 0) - (self.ac || 10);
        const wouldStillHit = hitBy > acBonus;
        if (wouldStillHit) return;

        const mode = (self.pm.tactics && self.pm.tactics.mode) || 'sustained';
        const policy = this.modePolicy[mode] || this.modePolicy.sustained;
        let shouldFire = false;
        if (policy.threshold === 'whileSlotsLeft') shouldFire = true;
        else if (typeof policy.threshold === 'number') shouldFire = hitBy <= policy.threshold;
        else if (policy.threshold === 'wouldDrop') {
          shouldFire = (self.hp || 0) <= 10;
        }
        if (!shouldFire) return;

        rollCtx.hits = false;
        state.slotsLeft[lowestAvailable] -= 1;
        self.reactionAvailableThisRound = false;
        if (rollCtx.eventLog) rollCtx.eventLog.push({
          round: rollCtx.round || 0, type: 'feature', who: self.id,
          what: 'Shield: blocked the hit (consumed lvl-' + lowestAvailable + ' slot)',
          featureName: 'Shield', source: 'shield',
        });
        return 'consume';
      },

      onRoundEnd(self, round, ctx) {
        self.reactionAvailableThisRound = true;
      },
    },
  };

  const HEX_MARK = {
    id: 'hexMark',
    name: "Hex / Hunter's Mark",
    source: 'builtin',
    category: ['damage'],
    classHint: 'warlock',
    summary: '+1d6 damage on hits against a marked target. Concentration; recasts on kill in Nova mode.',

    deriveParams(identityOrPm) {
      return { damageDice: '1d6', recastSlots: 4 };
    },

    paramSchema: [
      { name: 'damageDice', type: 'string', label: 'Damage dice', default: '1d6', placeholder: '1d8' },
      { name: 'recastSlots', type: 'int', label: 'Recasts available', default: 4, min: 0, max: 9 },
    ],

    modePolicy: {
      nova:      { recastOnKill: true },
      sustained: { recastOnKill: false },
      defensive: { recastOnKill: false },
    },

    initialState() { return { targetId: null, slotsLeft: 0 }; },

    hooks: {
      onCombatStart(self, ctx) {
        const ref = self.pm.features.find(f => f.id === 'hexMark');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        self.featureState.hexMark.slotsLeft = params.recastSlots || 4;
        const target = (ctx.combatants || []).find(c => c.side === 'monster' && !c.dead);
        if (target) {
          self.featureState.hexMark.targetId = target.id;
          if (ctx.eventLog) ctx.eventLog.push({ round: ctx.round, type: 'feature', who: self.id, what: 'Hex on ' + target.id, featureName: 'Hex / Hunter\'s Mark', source: 'hexMark' });
        }
      },

      onAttackHit(self, action, target, dmgCtx) {
        const state = self.featureState.hexMark;
        if (!state || !state.targetId || !target) return;
        if (target.id !== state.targetId) return;
        const ref = self.pm.features.find(f => f.id === 'hexMark');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        if (!Array.isArray(dmgCtx.bonusDice)) dmgCtx.bonusDice = [];
        dmgCtx.bonusDice.push({ dice: params.damageDice || '1d6', type: 'necrotic', source: 'hexMark' });
      },

      onMonsterDowned(self, monster, ctx) {
        const state = self.featureState.hexMark;
        if (!state || state.targetId !== monster.id) return;
        const mode = (self.pm.tactics && self.pm.tactics.mode) || 'sustained';
        const policy = this.modePolicy[mode] || this.modePolicy.sustained;
        if (!policy.recastOnKill) { state.targetId = null; return; }
        if (state.slotsLeft <= 0) { state.targetId = null; return; }
        const newTarget = (ctx.combatants || []).find(c => c.side === 'monster' && !c.dead && c.id !== monster.id);
        if (newTarget) {
          state.targetId = newTarget.id;
          state.slotsLeft -= 1;
          if (ctx.eventLog) ctx.eventLog.push({ round: ctx.round, type: 'feature', who: self.id, what: 'Hex re-cast on ' + newTarget.id, featureName: 'Hex / Hunter\'s Mark', source: 'hexMark' });
        } else {
          state.targetId = null;
        }
      },
    },
  };

  const BARDIC_INSPIRATION = {
    id: 'bardicInspiration',
    name: 'Bardic Inspiration',
    source: 'builtin',
    category: ['support'],
    classHint: 'bard',
    summary: 'Hand out inspiration dice at combat start; allies spend them to boost attacks and saves.',

    deriveParams(identityOrPm) {
      const level = (identityOrPm && identityOrPm.level) || (identityOrPm && identityOrPm.identity && identityOrPm.identity.level) || 1;
      let die = 'd6';
      if (level >= 5)  die = 'd8';
      if (level >= 10) die = 'd10';
      if (level >= 15) die = 'd12';
      return { die };
    },

    paramSchema: [
      { name: 'die', type: 'enum', label: 'Die size', default: 'd8', options: ['d6','d8','d10','d12'] },
    ],

    modePolicy: {
      nova:      { distribute: 'best-attackers' },
      sustained: { distribute: 'mixed' },
      defensive: { distribute: 'reserve-one-for-saves' },
    },

    initialState() { return { diceHeldBy: {}, dieSize: 'd6' }; },

    // Note: onSaveAttempt and onAttackAttempt use the broadcast-style signature
    // (self, triggering, ...). They are designed to be invoked via
    // dispatchBroadcastHook on every PC when ANY PC makes a roll, so the bard's
    // feature can react to allies' rolls. Calling via dispatchHook directly
    // would silently no-op because the second arg would be action/save object
    // rather than the triggering combatant.
    hooks: {
      onCombatStart(self, ctx) {
        const ref = self.pm.features.find(f => f.id === 'bardicInspiration');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        const cha = (self.pm.abilities && self.pm.abilities.cha) || 10;
        const count = Math.max(1, mod(cha));
        const allies = (ctx.combatants || []).filter(c => c.side === 'pc' && c.id !== self.id);
        const targets = allies.slice(0, count);
        const dice = {};
        for (const ally of targets) dice[ally.id] = params.die;
        self.featureState.bardicInspiration.diceHeldBy = dice;
        self.featureState.bardicInspiration.dieSize = params.die;
        if (ctx.eventLog) ctx.eventLog.push({
          round: ctx.round, type: 'feature', who: self.id,
          what: 'Bardic Inspiration handed to ' + targets.map(a => a.id).join(', '),
          featureName: 'Bardic Inspiration', source: 'bardicInspiration',
        });
      },

      onSaveAttempt(self, triggering, ability, dc, rollCtx) {
        const state = self.featureState.bardicInspiration;
        if (!state || !state.diceHeldBy) return;
        if (!triggering || !state.diceHeldBy[triggering.id]) return;
        const die = state.diceHeldBy[triggering.id];
        const sides = parseInt(die.replace('d', ''), 10);
        const expectedValue = (sides + 1) / 2;
        rollCtx.bonus = (rollCtx.bonus || 0) + expectedValue;
        delete state.diceHeldBy[triggering.id];
        if (rollCtx.eventLog) rollCtx.eventLog.push({
          round: rollCtx.round || 0, type: 'feature', who: self.id,
          what: 'Bardic Inspiration: +' + expectedValue + ' (avg ' + die + ') to ' + triggering.id + "'s save",
          featureName: 'Bardic Inspiration', source: 'bardicInspiration',
        });
      },

      onAttackAttempt(self, triggering, target, rollCtx) {
        const state = self.featureState.bardicInspiration;
        if (!state || !state.diceHeldBy) return;
        if (!triggering || !state.diceHeldBy[triggering.id]) return;
        const hitBy = (rollCtx.roll || 0) - (target.ac || 10);
        if (hitBy > 0 || hitBy < -5) return;
        const die = state.diceHeldBy[triggering.id];
        const sides = parseInt(die.replace('d', ''), 10);
        const expectedValue = (sides + 1) / 2;
        rollCtx.bonus = (rollCtx.bonus || 0) + expectedValue;
        rollCtx.hits = ((rollCtx.roll || 0) + expectedValue) >= (target.ac || 10);
        delete state.diceHeldBy[triggering.id];
        if (rollCtx.eventLog) rollCtx.eventLog.push({
          round: rollCtx.round || 0, type: 'feature', who: self.id,
          what: 'Bardic Inspiration: +' + expectedValue + ' (avg ' + die + ') to ' + triggering.id + "'s attack",
          featureName: 'Bardic Inspiration', source: 'bardicInspiration',
        });
      },
    },
  };

  const LIBRARY = {
    rage: RAGE,
    sneakAttack: SNEAK_ATTACK,
    actionSurge: ACTION_SURGE,
    divineSmite: DIVINE_SMITE,
    healingWord: HEALING_WORD,
    shield: SHIELD,
    hexMark: HEX_MARK,
    bardicInspiration: BARDIC_INSPIRATION,
  };

  // ── DSL primitives ──
  // Each primitive is a function that mutates state. Signature:
  //   apply(self, hookCtx, params)
  //     self     — the combatant the feature is on
  //     hookCtx  — context from the hook (dmgCtx, rollCtx, ctx, etc., grouped)
  //     params   — the params declared on the effect in the DSL spec

  const DAMAGE_TYPES = ['bludgeoning','piercing','slashing','fire','cold','lightning',
                        'thunder','acid','poison','psychic','radiant','necrotic','force'];

  const PRIMITIVES = {
    addDamage: {
      apply(self, hookCtx, params) {
        const v = Number(params.value) || 0;
        if (!v || !hookCtx || !hookCtx.dmgCtx) return;
        if (!Array.isArray(hookCtx.dmgCtx.bonusDice)) hookCtx.dmgCtx.bonusDice = [];
        // Push a pre-rolled bonus die — the engine's bonus-die loop skips
        // rerolling when _rolled is already set, then applies through
        // applyDamage so the damage actually lands on the target HP.
        // (Previously this only bumped dmgCtx.amount, which was cosmetic.)
        hookCtx.dmgCtx.bonusDice.push({
          dice: String(v), type: params.type || hookCtx.dmgCtx.type || 'untyped',
          source: (hookCtx && hookCtx.featureId) || 'dsl',
          featureName: (hookCtx && hookCtx.featureName) || 'Custom feature',
          _rolled: v,
        });
      },
      paramSchema: [
        { name: 'value', type: 'int', label: 'Amount', default: 1, min: 0, max: 99 },
        { name: 'type', type: 'enum', label: 'Damage type (optional)', default: '',
          options: ['', 'untyped', 'bludgeoning', 'piercing', 'slashing', 'fire', 'cold', 'lightning',
                    'thunder', 'acid', 'poison', 'psychic', 'radiant', 'necrotic', 'force'] },
      ],
    },
    addDamageDice: {
      apply(self, hookCtx, params) {
        if (!hookCtx || !hookCtx.dmgCtx) return;
        if (!Array.isArray(hookCtx.dmgCtx.bonusDice)) hookCtx.dmgCtx.bonusDice = [];
        hookCtx.dmgCtx.bonusDice.push({
          dice: params.dice, type: params.type || 'force',
          source: hookCtx.featureId || 'dsl',
          featureName: hookCtx.featureName || 'Custom feature',
        });
      },
      paramSchema: [
        { name: 'dice', type: 'string', label: 'Dice', default: '1d6', placeholder: '1d6' },
        { name: 'type', type: 'enum', label: 'Damage type', default: 'force', options: DAMAGE_TYPES },
      ],
    },
    addAcBonus: {
      apply(self, hookCtx, params) {
        const v = Number(params.value) || 0;
        if (typeof self.ac === 'number') self.ac += v;
        if (v) emitTrace(self, hookCtx, hookCtx && hookCtx.featureName, hookCtx && hookCtx.featureId, '+' + v + ' AC (now ' + self.ac + ')');
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
    consumeAction: {
      apply(self) { self.actionsAvailable = Math.max(0, (self.actionsAvailable || 0) - 1); },
      paramSchema: [],
    },
    consumeBonusAction: {
      apply(self) { self.bonusActionAvailable = false; },
      paramSchema: [],
    },
    consumeReaction: {
      apply(self) { self.reactionAvailableThisRound = false; },
      paramSchema: [],
    },
    heal: {
      apply(self, hookCtx, params) {
        const amt = Number(params.amount) || 0;
        if (!amt) return;
        const newHp = (self.hp || 0) + amt;
        if (params.target === 'self' || !params.target) {
          const before = self.hp;
          self.hp = (typeof self.maxHp === 'number' && self.maxHp > 0) ? Math.min(self.maxHp, newHp) : newHp;
          const delta = self.hp - before;
          emitTrace(self, hookCtx, hookCtx && hookCtx.featureName, hookCtx && hookCtx.featureId,
                    '+' + delta + ' HP (self)', { hpRestored: delta });
        }
        else if (hookCtx && hookCtx.target && hookCtx.target.maxHp) {
          const before = hookCtx.target.hp || 0;
          hookCtx.target.hp = Math.min(hookCtx.target.maxHp, before + amt);
          const delta = hookCtx.target.hp - before;
          emitTrace(self, hookCtx, hookCtx.featureName, hookCtx.featureId,
                    '+' + delta + ' HP to ' + hookCtx.target.id, { hpRestored: delta });
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
        if (!target || !params.condition) return;
        if (!target.conditions) target.conditions = new Map();
        target.conditions.set(params.condition, Number(params.duration) || 1);
        emitTrace(self, hookCtx, hookCtx && hookCtx.featureName, hookCtx && hookCtx.featureId,
                  'applied ' + params.condition + ' to ' + (target === self ? 'self' : target.id) + ' for ' + (params.duration || 1) + ' rounds');
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
      paramSchema: [],
    },
    flag: {
      apply(self, hookCtx, params) {
        if (!self.flags) self.flags = {};
        if (!params.name) return;
        const round = (hookCtx && hookCtx.ctx && typeof hookCtx.ctx.round === 'number') ? hookCtx.ctx.round : 0;
        self.flags[params.name] = { until: round + (Number(params.duration) || 1) };
        emitTrace(self, hookCtx, hookCtx && hookCtx.featureName, hookCtx && hookCtx.featureId,
                  'flag "' + params.name + '" set for ' + (params.duration || 1) + ' rounds');
      },
      paramSchema: [
        { name: 'name', type: 'string', label: 'Flag name', default: 'marked', placeholder: 'marked' },
        { name: 'duration', type: 'int', label: 'Duration (rounds)', default: 1, min: 1, max: 50 },
      ],
    },
    addAction: {
      apply(self, hookCtx, params) {
        const n = Number(params.amount) || 1;
        self.actionsAvailable = (self.actionsAvailable || 0) + n;
        // If the feature tags a specific action (e.g. Flurry of Blows →
        // "Unarmed Strike"), push it onto the forcedActions queue so the
        // engine's action loop uses that action instead of pickAction's
        // generic priority. Without a name, the granted action falls
        // through to normal action selection.
        const actionName = (params.actionName || '').trim();
        if (actionName) {
          if (!Array.isArray(self.forcedActions)) self.forcedActions = [];
          for (let i = 0; i < n; i++) self.forcedActions.push(actionName);
        }
        const suffix = actionName ? ' → forces "' + actionName + '"' : '';
        emitTrace(self, hookCtx, hookCtx && hookCtx.featureName, hookCtx && hookCtx.featureId,
                  '+' + n + ' action' + (n === 1 ? '' : 's') + ' (now ' + self.actionsAvailable + ')' + suffix);
      },
      paramSchema: [
        { name: 'amount', type: 'int', label: 'Extra actions', default: 1, min: 1, max: 5 },
        { name: 'actionName', type: 'string', label: 'Force action (by name, optional)',
          default: '', placeholder: 'Unarmed Strike' },
      ],
    },
    addBonusAction: {
      apply(self, hookCtx) {
        if (self.bonusActionAvailable) return;
        self.bonusActionAvailable = true;
        emitTrace(self, hookCtx, hookCtx && hookCtx.featureName, hookCtx && hookCtx.featureId, 'bonus action granted');
      },
      paramSchema: [],
    },
  };

  function compileDSL(spec) {
    if (!spec || typeof spec !== 'object' || !spec.id) return null;
    const effectsByHook = {};
    for (const eff of (spec.effects || [])) {
      if (!eff || !eff.hook) continue;
      if (!effectsByHook[eff.hook]) effectsByHook[eff.hook] = [];
      effectsByHook[eff.hook].push(eff);
    }
    const hooks = {};
    for (const hookName of Object.keys(effectsByHook)) {
      const effects = effectsByHook[hookName];
      hooks[hookName] = function (self, ...rest) {
        // Pack the variadic positional args into a hookCtx the primitives can read.
        const hookCtx = {
          ctx: rest.find(a => a && Array.isArray(a.combatants)),
          action:   rest[0] && rest[0].kind === 'attack' ? rest[0] : null,
          target:   (rest[1] && rest[1].side) ? rest[1] : null,
          dmgCtx:   rest.find(a => a && typeof a.amount === 'number'),
          rollCtx:  rest.find(a => a && (typeof a.roll === 'number' || typeof a.bonus === 'number')),
          featureId: spec.id,
          featureName: spec.name || spec.id,
        };
        // Round + combatants might live on any of ctx/dmgCtx/rollCtx depending
        // on the hook. Pulling from any source available so a feature on
        // onAttackHit etc. doesn't get stuck on triggerRound=1 (which used to
        // be the silent-no-op cause for nearly every custom feature).
        const round =
          (hookCtx.ctx     && hookCtx.ctx.round) ||
          (hookCtx.dmgCtx  && hookCtx.dmgCtx.round) ||
          (hookCtx.rollCtx && hookCtx.rollCtx.round) || 0;
        const combatants =
          (hookCtx.ctx     && hookCtx.ctx.combatants) ||
          (hookCtx.dmgCtx  && hookCtx.dmgCtx.combatants) ||
          (hookCtx.rollCtx && hookCtx.rollCtx.combatants) || [];
        const predCtx = hookCtx.ctx || { round, combatants };
        const mode = (self.pm && self.pm.tactics && self.pm.tactics.mode) || 'sustained';
        const policy = (spec.modePolicy && spec.modePolicy[mode]) || (spec.modePolicy && spec.modePolicy.sustained) || {};
        const eventLog =
          (hookCtx.dmgCtx  && hookCtx.dmgCtx.eventLog) ||
          (hookCtx.ctx     && hookCtx.ctx.eventLog) ||
          (hookCtx.rollCtx && hookCtx.rollCtx.eventLog) || null;
        const featureName = spec.name || spec.id;
        if (policy.triggerRound && round < policy.triggerRound) {
          if (eventLog) eventLog.push({
            round, type: 'feature', who: self && self.id,
            what: featureName + ': gated — round ' + round + ' < triggerRound ' + policy.triggerRound,
            featureName, source: spec.id, isGate: true,
          });
          return;
        }
        if (policy.conditionFn) {
          const pred = MODE_PREDICATES[policy.conditionFn];
          if (pred && !pred(self, predCtx, spec.id)) {
            if (eventLog) eventLog.push({
              round, type: 'feature', who: self && self.id,
              what: featureName + ': gated — condition ' + policy.conditionFn + ' = false',
              featureName, source: spec.id, isGate: true,
            });
            return;
          }
        }
        // Auto-gate on usesLeft when the spec declares usesPerEncounter.
        // The user expectation is: "Uses per encounter: 2 means the
        // feature fires at most twice per fight." Previously this was
        // only honored if the user manually picked the
        // usesLeftGreaterThanZero condition AND added a decrementUses
        // effect (which couldn't even be configured via the UI).
        const usesParam = spec.params && spec.params.usesPerEncounter;
        const usesCap = usesParam ? (usesParam.value || usesParam.default || 0) : 0;
        if (usesCap > 0) {
          const featState = self && self.featureState && self.featureState[spec.id];
          if (featState && typeof featState.usesLeft === 'number' && featState.usesLeft <= 0) {
            if (eventLog) eventLog.push({
              round, type: 'feature', who: self && self.id,
              what: featureName + ': gated — out of uses (' + usesCap + '/' + usesCap + ' spent)',
              featureName, source: spec.id, isGate: true,
            });
            return;
          }
        }
        for (const eff of effects) {
          if (eff.when) {
            const whenPred = MODE_PREDICATES[eff.when];
            if (whenPred && !whenPred(self, hookCtx.ctx || {}, spec.id, hookCtx)) continue;
          }
          const prim = PRIMITIVES[eff.primitive];
          if (!prim || typeof prim.apply !== 'function') {
            console.warn('PCFeatures.compileDSL: unknown primitive "' + eff.primitive + '" in feature ' + spec.id);
            continue;
          }
          try { prim.apply(self, hookCtx, eff.params || {}); }
          catch (e) { console.warn('PCFeatures.compileDSL: primitive ' + eff.primitive + ' threw:', e); }
        }
        // Auto-decrement usesLeft when this feature actually fired through
        // the gate. Pairs with the auto-gate above so usesPerEncounter is
        // self-enforcing without the user wiring a decrementUses effect.
        if (usesCap > 0) {
          const featState = self && self.featureState && self.featureState[spec.id];
          if (featState && typeof featState.usesLeft === 'number') {
            featState.usesLeft = Math.max(0, featState.usesLeft - 1);
            if (eventLog) eventLog.push({
              round, type: 'feature', who: self && self.id,
              what: featureName + ': use spent (' + featState.usesLeft + '/' + usesCap + ' remaining)',
              featureName, source: spec.id,
            });
          }
        }
      };
    }
    return {
      id: spec.id,
      name: spec.name,
      source: 'homebrew',
      category: spec.category || [],
      summary: spec.summary || '',
      params: spec.params || {},
      modePolicy: spec.modePolicy || {},
      hooks,
      initialState() {
        const state = {};
        const usesParam = spec.params && spec.params.usesPerEncounter;
        if (usesParam) state.usesLeft = usesParam.value || usesParam.default || 0;
        return state;
      },
    };
  }

  const PCFeatures = {
    HOOK_NAMES,
    MODE_PREDICATES,
    LIBRARY,
    PRIMITIVES,
    resolve,
    dispatchHook,
    dispatchBroadcastHook,
    initFeatureState,
    compileDSL,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PCFeatures;
  } else {
    global.PCFeatures = PCFeatures;
  }
})(typeof window !== 'undefined' ? window : globalThis);

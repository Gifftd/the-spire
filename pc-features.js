// pc-features.js
// Framework for modeling 5e PC class features in the Crucible simulator.
// Exports a global PCFeatures namespace with:
//   - HOOK_NAMES: the 9 hook points the engine calls
//   - MODE_PREDICATES: named predicate functions for mode policies
//   - LIBRARY: built-in features (Rage, Sneak Attack, etc.) by id
//   - resolve(featureRef): given {id, source, params}, return the full feature def
//   - dispatchHook(combatant, hookName, ...args): runs all subscribed features
//
// Companion: tests/pc-features.test.html exercises every function above.
// Engine integration: crucible-engine.js calls dispatchHook at 9 sites.

(function (global) {
  'use strict';

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
  };

  function resolve(ref) {
    if (!ref) return null;
    if (ref.source === 'homebrew') return ref;
    return (PCFeatures.LIBRARY && PCFeatures.LIBRARY[ref.id]) || null;
  }

  function dispatchHook(combatant, hookName, ...args) {
    if (!combatant || !combatant.pm || !Array.isArray(combatant.pm.features)) return;
    if (!combatant.featureState) combatant.featureState = {};
    for (const ref of combatant.pm.features) {
      if (!ref || !ref.id) continue;
      const state = combatant.featureState[ref.id];
      if (state && state._disabled) continue;
      const def = PCFeatures.resolve(ref);
      if (!def || !def.hooks || typeof def.hooks[hookName] !== 'function') continue;
      try {
        const result = def.hooks[hookName].call(def, combatant, ...args);
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
            if (ctx.eventLog) ctx.eventLog.push({ round: ctx.round, type: 'feature', who: self.id, what: 'Rage activated' });
          }
        }
      },

      onAttackHit(self, action, target, dmgCtx) {
        const state = self.featureState.rage;
        if (!state || !state.active) return;
        if (!action || action.actionRange === 'ranged') return;
        const ref = self.pm.features.find(f => f.id === 'rage');
        const params = (ref && ref.params) || this.deriveParams(self.pm);
        dmgCtx.amount += (params.bonusDamage || 2);
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
          if (ctx && ctx.eventLog) ctx.eventLog.push({ round, type: 'feature', who: self.id, what: 'Rage ended' });
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
        if (ctx.eventLog) ctx.eventLog.push({ round: ctx.round, type: 'feature', who: self.id, what: 'Action Surge activated' });
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
  };

  const PCFeatures = {
    HOOK_NAMES,
    MODE_PREDICATES,
    LIBRARY,
    resolve,
    dispatchHook,
    initFeatureState,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PCFeatures;
  } else {
    global.PCFeatures = PCFeatures;
  }
})(typeof window !== 'undefined' ? window : globalThis);

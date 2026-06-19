// pc-features.js
// Framework for modeling 5e PC class features in the Crucible simulator.
// Exports a global PCFeatures namespace with:
//   - HOOK_NAMES: the 9 hook points the engine calls
//   - MODE_PREDICATES: named predicate functions for mode policies
//   - LIBRARY: built-in features (Rage, Sneak Attack, etc.) by id
//   - resolve(featureRef): given {id, source, params}, return the full feature def
//   - dispatchHook(combatant, hookName, ...args): runs all subscribed features
//   - compileDSL(spec): turns a JSON spec into a feature object
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
      const def = resolve(ref);
      if (!def || !def.hooks || typeof def.hooks[hookName] !== 'function') continue;
      try {
        const result = def.hooks[hookName].call(def, combatant, ...args);
        if (result === 'consume') return;
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
      const def = resolve(ref);
      if (!def) continue;
      combatant.featureState[ref.id] = def.initialState ? def.initialState(def, ref) : {};
    }
  }

  const PCFeatures = {
    HOOK_NAMES,
    MODE_PREDICATES,
    LIBRARY: {},
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

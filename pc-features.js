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

  const PCFeatures = {
    HOOK_NAMES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PCFeatures;
  } else {
    global.PCFeatures = PCFeatures;
  }
})(typeof window !== 'undefined' ? window : globalThis);

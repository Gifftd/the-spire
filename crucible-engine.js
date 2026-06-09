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

  // ─────────── Public exports ───────────
  const Crucible = {
    makeRng,
    rollDie,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Crucible;
  else root.Crucible = Crucible;
})(typeof window !== 'undefined' ? window : globalThis);

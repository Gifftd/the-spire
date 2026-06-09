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

  // ─────────── Public exports ───────────
  const Crucible = {
    makeRng, rollDie, rollDice,
    mod, pb, saveBonus, toHit, saveDc, pcDamageMod,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Crucible;
  else root.Crucible = Crucible;
})(typeof window !== 'undefined' ? window : globalThis);

// ═══════════════════════════════════════════════════════════════════════
//  crucible-spatial.js
//  Pure helpers for the v2 tactical engine: distance, pathfinding,
//  placement, AoE template cells, threat scoring.
//
//  No DOM access. No engine state. Same IIFE pattern as pc-features.js.
//  Loaded by crucible-dm.html BEFORE crucible-engine.js.
// ═══════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  const CrucibleSpatial = {};

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CrucibleSpatial;
  } else {
    global.CrucibleSpatial = CrucibleSpatial;
  }
})(typeof window !== 'undefined' ? window : globalThis);

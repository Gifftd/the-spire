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

  function chebyshev(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  CrucibleSpatial.chebyshev = chebyshev;

  // A* with Chebyshev heuristic. Returns the cell list from start (excluded)
  // to the chosen endpoint (included). Empty array if unreachable.
  function findPath(start, goal, map, options) {
    options = options || {};
    const maxSteps = options.maxSteps != null ? options.maxSteps : Infinity;
    const stopAdj = options.stopWhenAdjacent || null;

    if (start.x === goal.x && start.y === goal.y) return [];

    const w = map.width, h = map.height;
    const blocked = map.blocked;

    function inBounds(x, y) { return x >= 0 && x < w && y >= 0 && y < h; }
    function isBlocked(x, y) { return blocked && blocked[y] && blocked[y][x] === true; }
    function key(x, y) { return y * w + x; }

    // Goal test: are we at goal, or (if stopAdj is set) adjacent to it?
    function isGoal(x, y) {
      if (stopAdj) return Math.max(Math.abs(x - stopAdj.x), Math.abs(y - stopAdj.y)) <= 1
                         && !(x === stopAdj.x && y === stopAdj.y);
      return x === goal.x && y === goal.y;
    }

    const open = [{ x: start.x, y: start.y, g: 0, f: 0, parent: null }];
    const seen = new Map();
    seen.set(key(start.x, start.y), open[0]);

    while (open.length > 0) {
      // Pick the node with lowest f. Linear scan — fine for our grid sizes.
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bestIdx].f) bestIdx = i;
      const cur = open.splice(bestIdx, 1)[0];

      if (isGoal(cur.x, cur.y)) {
        // Reconstruct path from cur back to start (exclusive).
        const path = [];
        let node = cur;
        while (node.parent) { path.unshift({ x: node.x, y: node.y }); node = node.parent; }
        // Trim to maxSteps.
        return path.slice(0, maxSteps);
      }

      // Expand 8 neighbors.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cur.x + dx, ny = cur.y + dy;
          if (!inBounds(nx, ny)) continue;
          if (isBlocked(nx, ny)) continue;
          const ng = cur.g + 1;
          if (ng > maxSteps) continue;
          const k = key(nx, ny);
          const prev = seen.get(k);
          if (prev && prev.g <= ng) continue;
          const hCost = Math.max(Math.abs(goal.x - nx), Math.abs(goal.y - ny));
          const node = { x: nx, y: ny, g: ng, f: ng + hCost, parent: cur };
          seen.set(k, node);
          open.push(node);
        }
      }
    }

    return [];
  }

  CrucibleSpatial.findPath = findPath;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CrucibleSpatial;
  } else {
    global.CrucibleSpatial = CrucibleSpatial;
  }
})(typeof window !== 'undefined' ? window : globalThis);

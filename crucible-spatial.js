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

  // Default layout: place combatants on the map.
  // If override is provided, use explicit positions from it.
  // Otherwise, PCs at y=1, monsters at y=height-2, spread evenly across width.
  function placeCombatants(combatants, map, override) {
    if (Array.isArray(override) && override.length > 0) {
      const byId = new Map(override.map(o => [o.id, o]));
      for (const c of combatants) {
        const o = byId.get(c.id);
        if (o) { c.x = o.x; c.y = o.y; }
      }
      return;
    }
    // Default layout: PCs at y=1, monsters at y=height-2. Spread evenly across width.
    const pcs = combatants.filter(c => c.side === 'pc');
    const mons = combatants.filter(c => c.side === 'monster');
    spreadRow(pcs, map.width, 1);
    spreadRow(mons, map.width, map.height - 2);
  }

  function spreadRow(group, width, y) {
    const n = group.length;
    if (n === 0) return;
    if (n === 1) { group[0].x = Math.floor(width / 2); group[0].y = y; return; }
    // Evenly spaced positions. For n=2 on width=10: indices 0..1 map to x ≈ 3.3 and 6.6.
    for (let i = 0; i < n; i++) {
      group[i].x = Math.floor((width - 1) * (i + 1) / (n + 1));
      group[i].y = y;
    }
  }

  CrucibleSpatial.placeCombatants = placeCombatants;

  function computeThreat(combatants) {
    for (const c of combatants) {
      c.threat = threatScore(c);
    }
  }

  function threatScore(c) {
    const dpr = estimateDPR(c);
    const hpFactor = Math.max(1, c.hp || c.maxHp || 1);
    // Sqrt so a tank doesn't run away with the metric; DPR weighted more.
    return dpr * Math.sqrt(hpFactor);
  }

  function estimateDPR(c) {
    // Pick the first action with a damage block as a rough proxy.
    let actions = [];
    if (c.pm && Array.isArray(c.pm.actions)) actions = c.pm.actions;
    else if (c.monster && Array.isArray(c.monster.parsedActions)) actions = c.monster.parsedActions;
    for (const a of actions) {
      const dmg = a.damage || (Array.isArray(a.damage) ? a.damage[0] : null);
      if (!dmg) continue;
      if (Array.isArray(dmg)) {
        let total = 0;
        for (const d of dmg) total += diceAverage(d.dice) + (Number(d.mod) || 0);
        return total;
      }
      return diceAverage(dmg.dice) + (Number(dmg.mod) || 0);
    }
    return 1;
  }

  function diceAverage(formula) {
    // '1d6', '2d6', '1d8+1', etc. Strip flat mod (we add it separately).
    if (!formula) return 0;
    const m = /^(\d+)d(\d+)/.exec(String(formula));
    if (!m) return 0;
    const count = parseInt(m[1], 10);
    const sides = parseInt(m[2], 10);
    return count * (sides + 1) / 2;
  }

  CrucibleSpatial.computeThreat = computeThreat;
  CrucibleSpatial.diceAverage = diceAverage;  // exposed for expectedDamage in Phase 2

  function sphereCells(origin, radius) {
    const r = Math.max(0, Math.floor(radius));
    const out = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        out.push({ x: origin.x + dx, y: origin.y + dy });
      }
    }
    return out;
  }
  CrucibleSpatial.sphereCells = sphereCells;

  function cubeCells(origin, side) {
    const s = Math.max(1, Math.floor(side));
    const out = [];
    for (let dy = 0; dy < s; dy++) {
      for (let dx = 0; dx < s; dx++) {
        out.push({ x: origin.x + dx, y: origin.y + dy });
      }
    }
    return out;
  }
  CrucibleSpatial.cubeCells = cubeCells;

  function lineCells(origin, direction, length) {
    const len = Math.max(0, Math.floor(length));
    if (len === 0 || (direction.dx === 0 && direction.dy === 0)) return [];
    const out = [];
    for (let i = 1; i <= len; i++) {
      out.push({ x: origin.x + direction.dx * i, y: origin.y + direction.dy * i });
    }
    return out;
  }
  CrucibleSpatial.lineCells = lineCells;

  // 5e RAW cone: at distance d (1..length), the cone is d cells wide
  // perpendicular to direction. Asymmetric for even d.
  function coneCells(origin, direction, length) {
    const len = Math.max(0, Math.floor(length));
    if (len === 0 || (direction.dx === 0 && direction.dy === 0)) return [];
    const out = [];
    const px = -direction.dy, py = direction.dx;
    for (let d = 1; d <= len; d++) {
      const halfMin = Math.floor((d - 1) / 2);
      const halfMax = d - 1 - halfMin;
      for (let w = -halfMin; w <= halfMax; w++) {
        const x = origin.x + direction.dx * d + px * w;
        const y = origin.y + direction.dy * d + py * w;
        out.push({ x, y });
      }
    }
    return out;
  }
  CrucibleSpatial.coneCells = coneCells;

  function enumerateCastPoints(attacker, action, map) {
    const range = action.range || 0;
    const shape = action.shape;
    if (shape === 'cone' || shape === 'line') {
      const out = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          out.push({ x: attacker.x, y: attacker.y, dir: { dx, dy } });
        }
      }
      return out;
    }
    const out = [];
    for (let y = Math.max(0, attacker.y - range); y <= Math.min(map.height - 1, attacker.y + range); y++) {
      for (let x = Math.max(0, attacker.x - range); x <= Math.min(map.width - 1, attacker.x + range); x++) {
        if (chebyshev({x,y}, attacker) > range) continue;
        out.push({ x, y });
      }
    }
    return out;
  }
  CrucibleSpatial.enumerateCastPoints = enumerateCastPoints;

  function combatantsAt(cells, combatants) {
    const set = new Set(cells.map(c => c.x + ',' + c.y));
    return combatants.filter(c => !c.dead && !c.downed && set.has(c.x + ',' + c.y));
  }
  CrucibleSpatial.combatantsAt = combatantsAt;

  function expectedDamage(action) {
    if (!action) return 0;
    if (action.kind === 'save' && Array.isArray(action.damageOnFail)) {
      let fail = 0;
      for (const d of action.damageOnFail) fail += diceAverage(d.dice) + (Number(d.mod) || 0);
      return action.halfOnSave ? (fail + fail / 2) / 2 : fail / 2;
    }
    const dmg = action.damage;
    if (dmg && dmg.dice) return diceAverage(dmg.dice) + (Number(dmg.mod) || 0);
    if (Array.isArray(action.damage)) {
      let total = 0;
      for (const d of action.damage) total += diceAverage(d.dice) + (Number(d.mod) || 0);
      return total;
    }
    return 0;
  }
  CrucibleSpatial.expectedDamage = expectedDamage;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CrucibleSpatial;
  } else {
    global.CrucibleSpatial = CrucibleSpatial;
  }
})(typeof window !== 'undefined' ? window : globalThis);

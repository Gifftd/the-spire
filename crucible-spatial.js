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

  // ─────────── Creature size / grid footprints (v3.8) ───────────
  // A combatant occupies an N×N block of cells anchored at its (x, y)
  // top-left corner, where N = c.sizeCells (Tiny/Small/Medium→1, Large→2,
  // Huge→3, Gargantuan→4). Absent/invalid sizeCells defaults to 1.
  function sizeOf(c) {
    const n = c && c.sizeCells;
    return (typeof n === 'number' && n >= 1) ? Math.floor(n) : 1;
  }
  CrucibleSpatial.sizeOf = sizeOf;

  // Every cell occupied by c's footprint.
  function footprintCells(c) {
    const n = sizeOf(c);
    const out = [];
    for (let dy = 0; dy < n; dy++) {
      for (let dx = 0; dx < n; dx++) out.push({ x: c.x + dx, y: c.y + dy });
    }
    return out;
  }
  CrucibleSpatial.footprintCells = footprintCells;

  // Gap between two closed integer intervals [lo1,hi1] and [lo2,hi2] on one
  // axis: 0 if they overlap/touch-with-overlap, else the positive separation.
  function axisGap(lo1, hi1, lo2, hi2) {
    if (hi1 < lo2) return lo2 - hi1;
    if (hi2 < lo1) return lo1 - hi2;
    return 0;
  }

  // Chebyshev distance between the two footprints, edge-to-edge:
  //   0 = the footprints overlap, 1 = adjacent (incl. diagonally), etc.
  // Reduces to chebyshev(a, b) when both are 1×1. This is the canonical
  // COMBATANT-to-COMBATANT distance; cell-to-cell math still uses chebyshev.
  function combatDistance(a, b) {
    const an = sizeOf(a), bn = sizeOf(b);
    const dx = axisGap(a.x, a.x + an - 1, b.x, b.x + bn - 1);
    const dy = axisGap(a.y, a.y + an - 1, b.y, b.y + bn - 1);
    return Math.max(dx, dy);
  }
  CrucibleSpatial.combatDistance = combatDistance;

  // Terrain accessors. map.terrain is an optional 2D array [y][x] of cells:
  //   null | { type: 'wall'|'difficult'|'damaging', dice?, mod?, dmgType? }
  // Empty/missing cells are open ground.
  function terrainAt(map, x, y) {
    if (!map || !map.terrain) return null;
    const row = map.terrain[y];
    return (row && row[x]) || null;
  }
  CrucibleSpatial.terrainAt = terrainAt;

  function isWall(map, x, y) {
    const t = terrainAt(map, x, y);
    if (t && t.type === 'wall') return true;
    // back-compat: legacy blocked array still respected
    if (map && map.blocked && map.blocked[y] && map.blocked[y][x] === true) return true;
    return false;
  }
  CrucibleSpatial.isWall = isWall;

  function stepCost(map, x, y) {
    const t = terrainAt(map, x, y);
    return (t && t.type === 'difficult') ? 2 : 1;
  }
  CrucibleSpatial.stepCost = stepCost;

  // Bresenham line-of-sight: returns true unless any wall blocks the line
  // segment between (from) and (to). Endpoints don't block themselves.
  function hasLineOfSight(map, from, to) {
    let x0 = from.x, y0 = from.y, x1 = to.x, y1 = to.y;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    while (true) {
      if (!(x0 === from.x && y0 === from.y) && !(x0 === to.x && y0 === to.y)) {
        if (isWall(map, x0, y0)) return false;
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 <  dx) { err += dx; y0 += sy; }
    }
    return true;
  }
  CrucibleSpatial.hasLineOfSight = hasLineOfSight;

  // A* with Chebyshev heuristic. Returns the cell list from start (excluded)
  // to the chosen endpoint (included). On maxSteps exhaustion, returns the
  // best-effort partial path toward the goal. Empty array if no progress.
  function findPath(start, goal, map, options) {
    options = options || {};
    const maxSteps = options.maxSteps != null ? options.maxSteps : Infinity;
    const stopAdj = options.stopWhenAdjacent || null;
    // v2 spatial: occupied cells (other combatants) — treated as blocked so
    // movers can't path through allies/enemies. The target's cell is
    // implicitly allowed since stopWhenAdjacent stops one cell short.
    // Pass a Set of "x,y" strings, or omit for no occupancy filtering.
    const occupied = options.occupied || null;
    // v3.8: N×N mover footprint. A cell is enterable only if all N×N cells
    // anchored there are in-bounds, non-wall, and non-occupied.
    const sizeCells = (typeof options.sizeCells === 'number' && options.sizeCells >= 1)
      ? Math.floor(options.sizeCells) : 1;

    if (start.x === goal.x && start.y === goal.y) return [];

    const w = map.width, h = map.height;

    function inBounds(x, y) { return x >= 0 && x < w && y >= 0 && y < h; }
    function key(x, y) { return y * w + x; }
    function heuristic(x, y) { return Math.max(Math.abs(goal.x - x), Math.abs(goal.y - y)); }
    // Can the mover's whole footprint sit at anchor (x, y)?
    function canOccupy(x, y) {
      for (let dy = 0; dy < sizeCells; dy++) {
        for (let dx = 0; dx < sizeCells; dx++) {
          const cx = x + dx, cy = y + dy;
          if (!inBounds(cx, cy)) return false;
          if (isWall(map, cx, cy)) return false;
          if (occupied && occupied.has(cx + ',' + cy)) return false;
        }
      }
      return true;
    }

    function isGoal(x, y) {
      if (stopAdj) {
        // Footprint-aware adjacency: the mover anchored at (x, y) is adjacent
        // to the target when their footprints are edge-to-edge distance 1
        // (0 would be overlap, prevented by occupancy).
        return combatDistance({ x, y, sizeCells }, stopAdj) === 1;
      }
      return x === goal.x && y === goal.y;
    }

    const startNode = { x: start.x, y: start.y, g: 0, f: heuristic(start.x, start.y), parent: null };
    const open = [startNode];
    const seen = new Map();
    seen.set(key(start.x, start.y), startNode);

    // Track best-h node ever expanded (excluding start), for partial-path fallback.
    let bestNode = null;
    let bestH = Infinity;
    // Whether maxSteps was the limiting factor on at least one neighbor expansion.
    let hitMaxSteps = false;

    function reconstruct(node) {
      const path = [];
      let n = node;
      while (n.parent) { path.unshift({ x: n.x, y: n.y }); n = n.parent; }
      return path;
    }

    while (open.length > 0) {
      // Pick the node with lowest f. Linear scan — fine for our grid sizes.
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bestIdx].f) bestIdx = i;
      const cur = open.splice(bestIdx, 1)[0];

      if (isGoal(cur.x, cur.y)) return reconstruct(cur);

      // Track best-h seen so far (only nodes we've actually moved to, g > 0).
      if (cur.g > 0) {
        const ch = heuristic(cur.x, cur.y);
        if (ch < bestH) {
          bestH = ch;
          bestNode = cur;
        } else if (ch === bestH && bestNode) {
          // Deterministic tiebreak: lower g first, then lower y, then lower x.
          // Stops oscillation when a PC pursues an unreachable target across
          // turns — same start → same partial-path endpoint.
          if (cur.g < bestNode.g ||
              (cur.g === bestNode.g && cur.y < bestNode.y) ||
              (cur.g === bestNode.g && cur.y === bestNode.y && cur.x < bestNode.x)) {
            bestNode = cur;
          }
        }
      }

      // Expand 8 neighbors.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cur.x + dx, ny = cur.y + dy;
          if (!canOccupy(nx, ny)) continue;
          const ng = cur.g + stepCost(map, nx, ny);
          if (ng > maxSteps) { hitMaxSteps = true; continue; }
          const k = key(nx, ny);
          const prev = seen.get(k);
          if (prev && prev.g <= ng) continue;
          const node = { x: nx, y: ny, g: ng, f: ng + heuristic(nx, ny), parent: cur };
          seen.set(k, node);
          open.push(node);
        }
      }
    }

    // Goal not reached. Return partial path ONLY when maxSteps was the
    // limiting factor; if the goal is genuinely unreachable, return [].
    if (hitMaxSteps && bestNode && bestH < heuristic(start.x, start.y)) return reconstruct(bestNode);
    return [];
  }

  CrucibleSpatial.findPath = findPath;

  // Combined gate: dist <= need AND (melee || hasLineOfSight to target).
  // Returns true if the attacker at (c.x, c.y) can hit target with action.
  function canAttackFrom(c, target, action, map) {
    if (!c || !target) return false;
    const need = (typeof action.range === 'number') ? action.range
      : (Array.isArray(action.range) && typeof action.range[0] === 'number')
        ? Math.max(1, Math.floor(action.range[0] / 5))
        : (action.actionRange === 'ranged') ? 6
          : (typeof action.reach === 'number') ? Math.max(1, Math.floor(action.reach / 5))
            : 1;
    // v3.8: footprint-aware edge-to-edge distance between the two combatants.
    // c may be a bare {x,y} candidate cell (findShootingCell) — combatDistance
    // treats a missing sizeCells as 1.
    if (combatDistance(c, target) > need) return false;
    // Ranged attacks need LOS. Melee at reach 1 doesn't.
    if (action.actionRange === 'ranged' || need > 1) {
      return hasLineOfSight(map, c, target);
    }
    return true;
  }
  CrucibleSpatial.canAttackFrom = canAttackFrom;

  // Find the shortest path from start to ANY cell that satisfies
  // canAttackFrom(cell, target, action, map). maxSteps caps the search.
  // Returns { path, cell } or null if no valid shooting cell within budget.
  function findShootingCell(start, target, action, map, options) {
    options = options || {};
    const maxSteps = options.maxSteps != null ? options.maxSteps : Infinity;
    const occupied = options.occupied || null;
    const sizeCells = (typeof options.sizeCells === 'number' && options.sizeCells >= 1)
      ? Math.floor(options.sizeCells) : 1;
    // Attach the mover's footprint size to a candidate anchor so canAttackFrom
    // and the occupancy check reason about the whole N×N block.
    const at = (x, y) => ({ x, y, sizeCells });
    // Quick win: already in a valid spot.
    if (canAttackFrom(at(start.x, start.y), target, action, map)) return { path: [], cell: start };
    const w = map.width, h = map.height;
    function inBounds(x, y) { return x >= 0 && x < w && y >= 0 && y < h; }
    function canOccupy(x, y) {
      for (let dy = 0; dy < sizeCells; dy++) {
        for (let dx = 0; dx < sizeCells; dx++) {
          const cx = x + dx, cy = y + dy;
          if (!inBounds(cx, cy)) return false;
          if (isWall(map, cx, cy)) return false;
          if (occupied && occupied.has(cx + ',' + cy)) return false;
        }
      }
      return true;
    }
    function key(x, y) { return y * w + x; }
    function heuristic(x, y) {
      // Cheap admissible heuristic: distance to target minus the attacker's
      // range. Slightly under-estimates when LOS forces a detour, which keeps
      // A* correct (admissible) while staying inexpensive.
      const need = (typeof action.range === 'number') ? action.range
        : (action.actionRange === 'ranged') ? 6 : 1;
      const distToTgt = Math.max(Math.abs(target.x - x), Math.abs(target.y - y));
      return Math.max(0, distToTgt - need);
    }
    const startNode = { x: start.x, y: start.y, g: 0, f: heuristic(start.x, start.y), parent: null };
    const open = [startNode];
    const seen = new Map();
    seen.set(key(start.x, start.y), startNode);
    function reconstruct(node) {
      const out = [];
      let n = node;
      while (n.parent) { out.unshift({ x: n.x, y: n.y }); n = n.parent; }
      return out;
    }
    // Partial-path fallback: track the explored cell with the lowest heuristic
    // (closest to the shooting-cell goal). Deterministic tiebreak by (g, y, x).
    let bestNode = null;
    let bestH = heuristic(start.x, start.y);
    let hitMaxSteps = false;
    while (open.length > 0) {
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bestIdx].f) bestIdx = i;
      const cur = open.splice(bestIdx, 1)[0];
      // Goal predicate: can attack from here?
      if (canAttackFrom(at(cur.x, cur.y), target, action, map)) {
        return { path: reconstruct(cur), cell: { x: cur.x, y: cur.y } };
      }
      if (cur.g > 0) {
        const ch = heuristic(cur.x, cur.y);
        if (ch < bestH) { bestH = ch; bestNode = cur; }
        else if (ch === bestH && bestNode) {
          if (cur.g < bestNode.g ||
              (cur.g === bestNode.g && cur.y < bestNode.y) ||
              (cur.g === bestNode.g && cur.y === bestNode.y && cur.x < bestNode.x)) {
            bestNode = cur;
          }
        }
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cur.x + dx, ny = cur.y + dy;
          if (!canOccupy(nx, ny)) continue;
          const ng = cur.g + stepCost(map, nx, ny);
          if (ng > maxSteps) { hitMaxSteps = true; continue; }
          const k = key(nx, ny);
          const prev = seen.get(k);
          if (prev && prev.g <= ng) continue;
          const node = { x: nx, y: ny, g: ng, f: ng + heuristic(nx, ny), parent: cur };
          seen.set(k, node);
          open.push(node);
        }
      }
    }
    // No cell with canAttackFrom found. If budget was the limit and we
    // made progress toward a closer-to-target cell, return that partial
    // path so the caller can keep closing the gap (and then Dash again).
    // Guarded by hitMaxSteps so unreachable goals (full wall) still return null.
    if (hitMaxSteps && bestNode) {
      return { path: reconstruct(bestNode), cell: { x: bestNode.x, y: bestNode.y }, partial: true };
    }
    return null;
  }
  CrucibleSpatial.findShootingCell = findShootingCell;

  // v3.4: Find the best retreat cell reachable within maxSteps — the cell that
  // maximizes the minimum Chebyshev distance to any living enemy. Bounded
  // Dijkstra flood from start (cost = stepCost, walls/occupied excluded),
  // then pick the reachable cell with the best score.
  //   options.requireLosTo — a combatant the retreater still needs to see
  //     (e.g. a ranged attacker's target); cells without LOS to it are excluded.
  //   options.occupied — Set of "x,y" strings the flood may not enter.
  //   options.maxSteps — movement budget (defaults to Infinity).
  // Deterministic tiebreak: larger min-dist, then lower cost, then lower y,
  // then lower x. Returns { path, cell, minEnemyDist } or null when nothing
  // reachable strictly improves on staying put.
  function findRetreatCell(start, enemies, map, options) {
    options = options || {};
    const maxSteps = options.maxSteps != null ? options.maxSteps : Infinity;
    const occupied = options.occupied || null;
    const requireLosTo = options.requireLosTo || null;
    const sizeCells = (typeof options.sizeCells === 'number' && options.sizeCells >= 1)
      ? Math.floor(options.sizeCells) : 1;
    const living = (enemies || []).filter(e => e && !e.dead && !e.downed
                                               && typeof e.x === 'number');
    if (maxSteps <= 0 || !living.length) return null;

    const w = map.width, h = map.height;
    function inBounds(x, y) { return x >= 0 && x < w && y >= 0 && y < h; }
    function canOccupy(x, y) {
      for (let dy = 0; dy < sizeCells; dy++) {
        for (let dx = 0; dx < sizeCells; dx++) {
          const cx = x + dx, cy = y + dy;
          if (!inBounds(cx, cy)) return false;
          if (isWall(map, cx, cy)) return false;
          if (occupied && occupied.has(cx + ',' + cy)) return false;
        }
      }
      return true;
    }
    function key(x, y) { return y * w + x; }
    function minEnemyDist(x, y) {
      let m = Infinity;
      for (const e of living) m = Math.min(m, chebyshev({ x, y }, e));
      return m;
    }

    const startMin = minEnemyDist(start.x, start.y);

    // Dijkstra flood. Each node stores accumulated cost g and parent for path
    // reconstruction. Start cell is g=0 (never a candidate — retreating must
    // actually move).
    const startNode = { x: start.x, y: start.y, g: 0, parent: null };
    const open = [startNode];
    const bestG = new Map();
    bestG.set(key(start.x, start.y), 0);

    function reconstruct(node) {
      const path = [];
      let n = node;
      while (n.parent) { path.unshift({ x: n.x, y: n.y }); n = n.parent; }
      return path;
    }

    let best = null;  // { node, min, g }
    function consider(node) {
      if (node.g <= 0) return;  // staying put is not a retreat
      const min = minEnemyDist(node.x, node.y);
      if (min <= startMin) return;  // must strictly improve safety
      if (requireLosTo && !hasLineOfSight(map, { x: node.x, y: node.y }, requireLosTo)) return;
      if (!best) { best = { node, min, g: node.g }; return; }
      // Tiebreak: larger min-dist, then lower cost, then lower y, then lower x.
      if (min > best.min
          || (min === best.min && node.g < best.g)
          || (min === best.min && node.g === best.g && node.y < best.node.y)
          || (min === best.min && node.g === best.g && node.y === best.node.y && node.x < best.node.x)) {
        best = { node, min, g: node.g };
      }
    }

    while (open.length > 0) {
      // Pop the lowest-g node (Dijkstra). Linear scan — fine at our grid sizes.
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) if (open[i].g < open[bestIdx].g) bestIdx = i;
      const cur = open.splice(bestIdx, 1)[0];
      // Stale-entry guard: skip if a cheaper path to this cell was already found.
      if (cur.g > (bestG.get(key(cur.x, cur.y)) != null ? bestG.get(key(cur.x, cur.y)) : Infinity)) continue;
      consider(cur);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cur.x + dx, ny = cur.y + dy;
          if (!canOccupy(nx, ny)) continue;
          const ng = cur.g + stepCost(map, nx, ny);
          if (ng > maxSteps) continue;
          const k = key(nx, ny);
          const prev = bestG.get(k);
          if (prev != null && prev <= ng) continue;
          bestG.set(k, ng);
          open.push({ x: nx, y: ny, g: ng, parent: cur });
        }
      }
    }

    if (!best) return null;
    return { path: reconstruct(best.node), cell: { x: best.node.x, y: best.node.y },
             minEnemyDist: best.min };
  }
  CrucibleSpatial.findRetreatCell = findRetreatCell;

  // Default layout: place combatants on the map.
  // If override is provided, use explicit positions from it.
  // Otherwise, PCs at y=1, monsters at y=height-2, spread evenly across width.
  function placeCombatants(combatants, map, override) {
    const overridden = new Set();
    if (Array.isArray(override) && override.length > 0) {
      const byId = new Map(override.map(o => [o.id, o]));
      for (const c of combatants) {
        const o = byId.get(c.id);
        if (o) { c.x = o.x; c.y = o.y; overridden.add(c.id); }
      }
    }
    const remaining = combatants.filter(c => !overridden.has(c.id));
    if (remaining.length === 0) { resolveFootprintOverlaps(combatants, map); return; }
    // Default layout: PCs at y=1, monsters at y=height-2. Spread evenly across width.
    const pcs = remaining.filter(c => c.side === 'pc');
    const mons = remaining.filter(c => c.side === 'monster');
    spreadRow(pcs, map.width, 1);
    spreadRow(mons, map.width, map.height - 2);
    // v3.8: large creatures (sizeCells > 1) span multiple cells, so two evenly
    // spread anchors can overlap. Nudge anchors right (then clamp in-bounds) so
    // no two footprints collide.
    resolveFootprintOverlaps(combatants, map);
  }

  // Push each combatant's anchor right until its N×N footprint clears every
  // already-placed footprint and stays in-bounds. Deterministic scan order
  // (as given); a pragmatic fallback, not an optimal packing.
  function resolveFootprintOverlaps(combatants, map) {
    const claimed = new Set();
    const clampAnchor = (v, n) => Math.max(0, Math.min(v, (n - 1)));
    for (const c of combatants) {
      if (typeof c.x !== 'number' || typeof c.y !== 'number') continue;
      const n = sizeOf(c);
      c.x = clampAnchor(c.x, map.width - n + 1 > 0 ? map.width - n + 1 : 1);
      c.y = clampAnchor(c.y, map.height - n + 1 > 0 ? map.height - n + 1 : 1);
      const fits = (ax, ay) => {
        for (let dy = 0; dy < n; dy++) {
          for (let dx = 0; dx < n; dx++) {
            const cx = ax + dx, cy = ay + dy;
            if (cx < 0 || cx >= map.width || cy < 0 || cy >= map.height) return false;
            if (claimed.has(cx + ',' + cy)) return false;
          }
        }
        return true;
      };
      // Scan right along the row, then wrap to x=0, bounded by map width.
      let placed = false;
      for (let attempt = 0; attempt < map.width && !placed; attempt++) {
        const ax = (c.x + attempt) % Math.max(1, map.width - n + 1);
        if (fits(ax, c.y)) { c.x = ax; placed = true; }
      }
      // Give up gracefully: keep clamped anchor even if it overlaps (tiny maps).
      for (const cell of footprintCells(c)) claimed.add(cell.x + ',' + cell.y);
    }
  }
  CrucibleSpatial.resolveFootprintOverlaps = resolveFootprintOverlaps;

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

  // Tunable scorer coefficients. Exposed for hand-tuning + tactics.aiHint
  // weighting in Phase 6. Defaults match the spec's starting values.
  const SCORER_WEIGHTS = {
    distance:  -0.5,
    lowHpInv:   1.0,
    threat:     0.3,
    ooaPath:   -2.0,
    rangedInMelee: -1.5,
  };
  CrucibleSpatial.SCORER_WEIGHTS = SCORER_WEIGHTS;

  function scoreTarget(target, attacker, action, combatants, map, tactics) {
    const w = applyAiHint(SCORER_WEIGHTS, tactics);
    const dist = chebyshev(attacker, target);
    const ooaPath = provokesOoAOnPath(attacker, target, combatants, map) ? 1 : 0;
    const rangedInMelee = (action.actionRange === 'ranged' && dist <= 1) ? 1 : 0;
    return (
      w.distance      * dist
    + w.lowHpInv      * (1 / Math.max(1, target.hp))
    + w.threat        * (target.threat || 0)
    + w.ooaPath       * ooaPath
    + w.rangedInMelee * rangedInMelee
    );
  }
  CrucibleSpatial.scoreTarget = scoreTarget;

  function applyAiHint(weights, tactics) {
    const hint = tactics && tactics.aiHint;
    if (hint === 'focus')    return { ...weights, lowHpInv: weights.lowHpInv * 2 };
    if (hint === 'survival') return { ...weights, threat: weights.threat * 0.5, ooaPath: weights.ooaPath * 2 };
    if (hint === 'spread')   return { ...weights, lowHpInv: weights.lowHpInv * 0.5 };
    return weights;
  }

  function provokesOoAOnPath(attacker, target, combatants, map) {
    const path = findPath(attacker, target, map, { stopWhenAdjacent: target });
    if (path.length === 0) return false;
    // For each cell along the path (including start), check if any other-side
    // combatant with melee reach + available reaction is adjacent to it.
    // We append the target's cell as the implicit final step — the attacker
    // functionally enters target's square to make the melee attack, and that
    // last step is the one that typically leaves a side-blocker's reach when
    // the rest of the path hugs y=0 alongside a blocker at e.g. (3,1).
    const fullPath = [
      { x: attacker.x, y: attacker.y },
      ...path,
      { x: target.x, y: target.y },
    ];
    for (let i = 1; i < fullPath.length; i++) {
      const prev = fullPath[i - 1];
      const cur  = fullPath[i];
      for (const d of combatants) {
        if (d.side === attacker.side || d.dead || d.downed) continue;
        if (d.id === target.id) continue;  // the actual goal doesn't count
        if (!d.reactionAvailableThisRound) continue;
        const reach = d.naturalReach || 1;
        const wasInReach   = chebyshev(d, prev) <= reach;
        const stillInReach = chebyshev(d, cur)  <= reach;
        if (wasInReach && !stillInReach) return true;
      }
    }
    return false;
  }
  CrucibleSpatial.provokesOoAOnPath = provokesOoAOnPath;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CrucibleSpatial;
  } else {
    global.CrucibleSpatial = CrucibleSpatial;
  }
})(typeof window !== 'undefined' ? window : globalThis);

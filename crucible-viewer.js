// ═══════════════════════════════════════════════════════════════════════
//  crucible-viewer.js
//  SVG event-sourced replay viewer for Crucible v2 tactical trials.
//
//  Public surface:
//    CrucibleViewer.mount(rootEl, trialResult)     — render board + controls
//    CrucibleViewer.initialState(placementEvent)   — derive starting state
//    CrucibleViewer.applyEvent(state, event)       — mutate state in place
//    CrucibleViewer.renderSVG(host, state)         — paint the board
//
//  No engine coupling beyond reading trial.events.
// ═══════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';
  const CrucibleViewer = {};

  const CELL = 24;  // pixels per cell
  CrucibleViewer.CELL = CELL;

  function initialState(placementEvent) {
    if (!placementEvent || placementEvent.type !== 'placement') {
      return { map: { width: 20, height: 20, blocked: null }, combatants: [],
               lastMove: null, lastAoE: null };
    }
    const combatants = placementEvent.placements.map(p => ({
      id: p.id, name: p.name, side: p.side,
      x: p.pos.x, y: p.pos.y,
      hp: p.hp, maxHp: p.maxHp, ac: p.ac, speed: p.speed,
      dead: false, downed: false,
    }));
    return { map: placementEvent.map, combatants, lastMove: null, lastAoE: null };
  }
  CrucibleViewer.initialState = initialState;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CrucibleViewer;
  } else {
    global.CrucibleViewer = CrucibleViewer;
  }
})(typeof window !== 'undefined' ? window : globalThis);

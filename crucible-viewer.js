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

  function applyEvent(state, ev) {
    if (!ev) return;
    state.lastMove = null;
    state.lastAoE = null;
    switch (ev.type) {
      case 'move': {
        const c = state.combatants.find(cc => cc.id === ev.who);
        if (c) { c.x = ev.to.x; c.y = ev.to.y; }
        state.lastMove = ev;
        break;
      }
      case 'damage': {
        const c = state.combatants.find(cc => cc.name === ev.target);
        if (c) {
          c.hp = Math.max(0, c.hp - (ev.amount || 0));
          if (c.hp === 0) {
            if (c.side === 'pc') c.downed = true;
            else c.dead = true;
          }
        }
        break;
      }
      case 'heal': {
        const c = state.combatants.find(cc => cc.name === ev.target);
        if (c) {
          c.hp = Math.min(c.maxHp || (c.hp + (ev.amount || 0)), c.hp + (ev.amount || 0));
          if (ev.revived) c.downed = false;
        }
        break;
      }
      case 'regen': {
        const c = state.combatants.find(cc => cc.name === ev.actor);
        if (c && typeof ev.hpAfter === 'number') c.hp = ev.hpAfter;
        break;
      }
      case 'aoe': {
        state.lastAoE = ev;
        break;
      }
      // attack/save/feature events don't change state — they're informational.
    }
  }
  CrucibleViewer.applyEvent = applyEvent;

  function renderTo(state, events, idx) {
    // Replay from event 1 (skip placement, already used by initialState) up to idx inclusive.
    for (let i = 1; i <= idx && i < events.length; i++) applyEvent(state, events[i]);
    return state;
  }
  CrucibleViewer.renderTo = renderTo;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CrucibleViewer;
  } else {
    global.CrucibleViewer = CrucibleViewer;
  }
})(typeof window !== 'undefined' ? window : globalThis);

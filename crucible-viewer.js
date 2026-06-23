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

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CrucibleViewer;
  } else {
    global.CrucibleViewer = CrucibleViewer;
  }
})(typeof window !== 'undefined' ? window : globalThis);

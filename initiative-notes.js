// ═══════════════════════════════════════════════════════════════════════
//  initiative-notes.js
//  Pure helpers for the initiative-tracker player-notes feature.
//
//  Loaded by:
//   • initiative-player.html  (renders previews, validates before POST)
//   • initiative-dm.html      (renders read-only notes panel)
//   • tests/initiative-notes.test.html
//
//  ALSO INLINED VERBATIM IN cloudflare-worker.js — search for the marker
//  "BEGIN initiative-notes.js" in the worker source. Any change to the
//  functions or constants below MUST be mirrored there or the
//  client-side and server-side rules will drift.
// ═══════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────────────
  const MAX_NOTE_LENGTH = 500;             // chars in a single note body
  const MAX_NOTES_PER_CHARACTER = 50;      // per author, per encounter
  const VISIBILITIES = ['private', 'party'];

  // Public exports populated by Tasks 2–5.
  const InitiativeNotes = {
    MAX_NOTE_LENGTH,
    MAX_NOTES_PER_CHARACTER,
    VISIBILITIES,
    // filterInitiativeState        — Task 2
    // mergeDMWritePreservingNotes  — Task 3
    // validateNote                 — Task 4
    // canDeleteNote                — Task 5
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = InitiativeNotes;
  else root.InitiativeNotes = InitiativeNotes;
})(typeof window !== 'undefined' ? window : globalThis);

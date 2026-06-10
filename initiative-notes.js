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

  // ─── filterInitiativeState(state, viewer) ──────────────────────────
  // Returns a NEW state with hidden combatants dropped (non-DM), the
  // DM-only `notes` string stripped (non-DM), and `playerNotes` filtered
  // per viewer.
  //   viewer = { role: 'dm' }                              → see everything
  //   viewer = { role: 'player', characterId: 'char_x' }   → own private + party
  //   viewer = null | { role: 'player' /* no id */ }       → party only
  function filterInitiativeState(state, viewer) {
    if (!state || typeof state !== 'object') return { combatants: [] };
    const isDM = !!(viewer && viewer.role === 'dm');
    const myId = (viewer && viewer.role === 'player' && viewer.characterId) || null;

    const combatants = Array.isArray(state.combatants) ? state.combatants : [];
    const filtered = [];
    for (const c of combatants) {
      if (!c) continue;
      if (!isDM && c.hidden) continue;          // drop hidden for non-DM

      // Shallow clone so we don't mutate input
      const clone = Object.assign({}, c);
      if (!isDM) delete clone.notes;            // strip DM secret string

      // Filter playerNotes
      const allNotes = Array.isArray(c.playerNotes) ? c.playerNotes : [];
      if (isDM) {
        clone.playerNotes = allNotes.slice();    // copy, keep all
      } else {
        clone.playerNotes = allNotes.filter(n => {
          if (!n) return false;
          if (n.visibility === 'party') return true;
          if (myId && n.authorCharId === myId) return true;
          return false;
        });
      }
      filtered.push(clone);
    }

    // Shallow-clone the outer state so other fields (mode, round, etc.) pass through
    const out = Object.assign({}, state);
    out.combatants = filtered;
    return out;
  }

  // ─── mergeDMWritePreservingNotes(prev, incoming) ───────────────────
  // Server-side merge for the DM `initiative_state` POST handler.
  // The DM tracker never authors playerNotes, so KV is authoritative.
  // We copy prev.combatants[i].playerNotes (keyed by id) onto matching
  // incoming combatants. New combatants the DM added start with [].
  // DM-supplied playerNotes on new combatants are discarded as defense
  // in depth. Returns a new state; does not mutate inputs.
  function mergeDMWritePreservingNotes(prev, incoming) {
    const prevCombatants = (prev && Array.isArray(prev.combatants)) ? prev.combatants : [];
    const prevNotesById = new Map();
    for (const c of prevCombatants) {
      if (c && c.id) prevNotesById.set(c.id, Array.isArray(c.playerNotes) ? c.playerNotes.slice() : []);
    }

    const incCombatants = (incoming && Array.isArray(incoming.combatants)) ? incoming.combatants : [];
    const mergedCombatants = incCombatants.map(c => {
      if (!c) return c;
      const clone = Object.assign({}, c);
      clone.playerNotes = prevNotesById.has(c.id) ? prevNotesById.get(c.id) : [];
      return clone;
    });

    const out = Object.assign({}, incoming || {});
    out.combatants = mergedCombatants;
    return out;
  }

  // ─── validateNote(input) ───────────────────────────────────────────
  // Validates a candidate note's body + visibility. Returns
  // { ok: true } or { ok: false, error: '<reason>' }. Pure.
  function validateNote(input) {
    if (!input || typeof input !== 'object') {
      return { ok: false, error: 'note must be an object' };
    }
    const body = typeof input.body === 'string' ? input.body : '';
    const trimmed = body.trim();
    if (!trimmed) return { ok: false, error: 'body is required' };
    if (body.length > MAX_NOTE_LENGTH) {
      return { ok: false, error: 'body too long (max ' + MAX_NOTE_LENGTH + ' chars)' };
    }
    if (!VISIBILITIES.includes(input.visibility)) {
      return { ok: false, error: 'visibility must be private or party' };
    }
    return { ok: true };
  }

  // Public exports populated by Tasks 2–5.
  const InitiativeNotes = {
    MAX_NOTE_LENGTH,
    MAX_NOTES_PER_CHARACTER,
    VISIBILITIES,
    filterInitiativeState,
    mergeDMWritePreservingNotes,
    validateNote,
    // canDeleteNote                — Task 5
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = InitiativeNotes;
  else root.InitiativeNotes = InitiativeNotes;
})(typeof window !== 'undefined' ? window : globalThis);

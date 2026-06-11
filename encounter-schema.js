// encounter-schema.js
// Shared schema, migration, and validation for the encounter builder.
// Loaded by encounter-dm.html, initiative-dm.html, map-dm.html,
// sessions-dm.html, crucible-dm.html, and tests/encounter-schema.test.html.
//
// The worker mirrors these rules in cloudflare-worker.js — keep both in sync.

(function (global) {
  const STATUSES = ['draft', 'ready', 'scheduled', 'live', 'completed', 'archived'];
  const LIGHTING = ['bright', 'dim', 'dark', 'varied'];
  const SURPRISE = ['none', 'party', 'monsters', 'both'];
  const NPC_ROLES = ['ally', 'enemy', 'hostage', 'witness'];
  const LOCATION_REF_KINDS = ['world', 'submap'];
  const OUTCOMES = ['won', 'tpk', 'fled', 'skipped'];

  // Soft caps mirrored on worker.
  const CAPS = {
    picks: 50,
    waves: 20,
    loot: 50,
    npcRoles: 30,
    waveRound: 50,
  };

  global.EncounterSchema = {
    STATUSES, LIGHTING, SURPRISE, NPC_ROLES, LOCATION_REF_KINDS, OUTCOMES, CAPS,
  };
})(typeof window !== 'undefined' ? window : globalThis);

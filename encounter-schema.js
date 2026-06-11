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

  function genId(prefix) {
    const rand = Math.floor(Math.random() * 1e9).toString(36);
    return `${prefix}_${Date.now()}_${rand}`;
  }

  function newEncounter(name) {
    const now = new Date().toISOString();
    return {
      id: genId('enc'),
      schemaVersion: 2,
      name: name || '',
      description: '',
      tags: [],
      status: 'draft',
      picks: [],
      party: { size: 4, level: 5 },
      totalXp: 0,
      monsterCount: 0,
      tactical: {
        terrain: '',
        lighting: 'bright',
        surprise: 'none',
        startingPositions: '',
        waves: [],
        readAloud: '',
      },
      playbook: {
        overallTactics: '',
        retreatTriggers: '',
        victoryConditions: '',
        reminders: '',
      },
      loot: [],
      locationRef: null,
      sessionId: null,
      npcRoles: [],
      createdAt: now,
      updatedAt: now,
      lastStagedAt: null,
      resolvedAt: null,
      resolvedInTimelineId: null,
      lastOutcome: null,
    };
  }

  function genPickKeys(picks) {
    if (!Array.isArray(picks)) return [];
    const seen = new Set();
    const out = picks.map(p => ({ ...p }));
    // Pass 1: keep unique existing keys.
    out.forEach(p => {
      if (typeof p.pickKey === 'string' && p.pickKey && !seen.has(p.pickKey)) {
        seen.add(p.pickKey);
      } else {
        p.pickKey = null;
      }
    });
    // Pass 2: assign the lowest unused pN to the unkeyed.
    let n = 1;
    out.forEach(p => {
      if (p.pickKey == null) {
        while (seen.has('p' + n)) n++;
        p.pickKey = 'p' + n;
        seen.add(p.pickKey);
      }
    });
    return out;
  }

  function migrateInMemory(rec) {
    if (rec && rec.schemaVersion === 2) return rec;
    const r = rec || {};
    const out = {
      id:            typeof r.id === 'string' && r.id ? r.id : genId('enc'),
      schemaVersion: 2,
      name:          r.name || '',
      description:   r.description || '',
      tags:          Array.isArray(r.tags) ? r.tags : [],
      status:        STATUSES.includes(r.status) ? r.status : 'ready',
      picks:         genPickKeys(Array.isArray(r.picks) ? r.picks : []),
      party:         (r.party && typeof r.party === 'object') ? { size: r.party.size || 4, level: r.party.level || 5 } : { size: 4, level: 5 },
      totalXp:       typeof r.totalXp === 'number' ? r.totalXp : 0,
      monsterCount:  typeof r.monsterCount === 'number' ? r.monsterCount : 0,
      tactical: {
        terrain:           (r.tactical && r.tactical.terrain) || '',
        lighting:          (r.tactical && LIGHTING.includes(r.tactical.lighting)) ? r.tactical.lighting : 'bright',
        surprise:          (r.tactical && SURPRISE.includes(r.tactical.surprise)) ? r.tactical.surprise : 'none',
        startingPositions: (r.tactical && r.tactical.startingPositions) || '',
        waves:             (r.tactical && Array.isArray(r.tactical.waves)) ? r.tactical.waves : [],
        readAloud:         (r.tactical && r.tactical.readAloud) || '',
      },
      playbook: {
        overallTactics:    (r.playbook && r.playbook.overallTactics) || '',
        retreatTriggers:   (r.playbook && r.playbook.retreatTriggers) || '',
        victoryConditions: (r.playbook && r.playbook.victoryConditions) || '',
        reminders:         (r.playbook && r.playbook.reminders) || '',
      },
      loot:        Array.isArray(r.loot) ? r.loot : [],
      locationRef: r.locationRef && typeof r.locationRef === 'object' ? r.locationRef : null,
      sessionId:   r.sessionId || null,
      npcRoles:    Array.isArray(r.npcRoles) ? r.npcRoles : [],
      createdAt:   r.createdAt || new Date().toISOString(),
      updatedAt:   r.updatedAt || r.createdAt || new Date().toISOString(),
      lastStagedAt:         r.lastStagedAt || null,
      resolvedAt:           r.resolvedAt || null,
      resolvedInTimelineId: r.resolvedInTimelineId || null,
      lastOutcome:          OUTCOMES.includes(r.lastOutcome) ? r.lastOutcome : null,
    };
    return out;
  }

  global.EncounterSchema = {
    STATUSES, LIGHTING, SURPRISE, NPC_ROLES, LOCATION_REF_KINDS, OUTCOMES, CAPS,
    newEncounter, genId, genPickKeys, migrateInMemory,
  };
})(typeof window !== 'undefined' ? window : globalThis);
